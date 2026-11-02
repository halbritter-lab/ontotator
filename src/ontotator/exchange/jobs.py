"""Import and export jobs of the T1 exchange (T2d Tasks 4 and 5).

Handlers run in a job worker or inline from the CLI. They act for the user
who asked for the job (``jobs.requested_by``) with that user's rights; a job
without a user was asked for by the operator on the command line, who acts as
a system admin (Q5).
"""

from __future__ import annotations

import json
import tempfile
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import ontospan
from sqlalchemy import Connection, Text, cast, delete, exists, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ontotator.auth.audit import Actor, record_audit
from ontotator.authz.memberships import MembershipService
from ontotator.authz.policy import Access
from ontotator.authz.scoped import ScopedRepository
from ontotator.domain.errors import DomainError
from ontotator.domain.work_rounds import CARRY_ROUND_KINDS
from ontotator.exchange.final_export import final_t1_export
from ontotator.exchange.reanchor_job import reanchor
from ontotator.exchange.review_export import translation_review_export
from ontotator.exchange.t1 import (
    ExportCounts,
    layers_for,
    recorded_digests,
    recorded_layers,
    submission_to_unit,
    with_layers,
)
from ontotator.exchange.uploads import upload_commit, upload_preview
from ontotator.jobs.queue import Handler, Job, JobContext, StructuredJobError
from ontotator.storage.database import Database
from ontotator.storage.repository import ProjectExport
from ontotator.storage.tables import (
    JobRow,
    OntologyFileRow,
    ProjectOntologyRow,
    ProjectResourceRow,
    ProjectRow,
    ProposalSetRow,
    StoredFileRow,
    UploadRow,
    UserRow,
)

# How many ontospan issues a failed job names in its error.
MAX_ISSUES = 20


def store_file(db: Database, data: bytes) -> str:
    """Put ``data`` in the blob store and record it in ``stored_files``.

    Record the reference in the same transaction, as uploads do, so that
    ``delete_unreferenced_file`` cannot remove the file in between.
    """
    with db.transaction() as conn:
        digest = db.put_blob(conn, data)
        conn.execute(
            pg_insert(StoredFileRow)
            .values(sha256=digest, size=len(data))
            .on_conflict_do_nothing()
        )
    return digest


def delete_unreferenced_file(conn: Connection, digest: str) -> bool:
    """Delete the ``stored_files`` row of a file nothing references; whether it did.

    References are uploads that are not discarded, job payloads and results
    (imports, exports), proposal sets, project resources and ontology files.
    Runs in the caller's transaction; after it commits, ``unlink_deleted_files``
    removes the files. shortcut: a job payload or result is recorded after its
    ``store_file`` commits, so a discard of identical bytes in between drops the
    row and file it needs; hold the blob lock until the job row is written if
    exports or CLI imports ever coincide byte-for-byte with discarded uploads.
    """
    Database.lock_blob(conn, digest)
    referenced = conn.execute(
        select(
            or_(
                exists().where(
                    UploadRow.status != "discarded",
                    cast(UploadRow.files, Text).contains(digest),
                ),
                exists().where(
                    or_(
                        cast(JobRow.payload, Text).contains(digest),
                        cast(JobRow.result, Text).contains(digest),
                    )
                ),
                exists().where(ProposalSetRow.source_sha256 == digest),
                exists().where(ProjectResourceRow.sha256 == digest),
                exists().where(OntologyFileRow.sha256 == digest),
            )
        )
    ).scalar_one()
    if referenced:
        return False
    conn.execute(delete(StoredFileRow).where(StoredFileRow.sha256 == digest))
    return True


def unlink_deleted_files(db: Database, digests: Sequence[str]) -> None:
    """Remove the files whose ``stored_files`` rows a committed discard deleted.

    Under the blob lock, a file stored again since then has its row back and stays.
    """
    for digest in digests:
        with db.transaction() as conn:
            Database.lock_blob(conn, digest)
            if (
                conn.execute(
                    select(StoredFileRow.sha256).where(StoredFileRow.sha256 == digest)
                ).first()
                is None
            ):
                db.blobs.delete(digest)


def unlink_after_commit(db: Database, digests: Sequence[str]) -> None:
    """``unlink_deleted_files`` once the open transaction has committed (at
    once outside one); a rollback keeps the files, as their rows come back."""
    if digests:
        found = list(digests)
        db.after_commit(lambda: unlink_deleted_files(db, found))


def operator_access(actor: Actor) -> Access:
    """The rights of the operator on the command line: a system admin's (Q5)."""
    return Access(user_id=0, pseudonym=actor.label, is_system_admin=True)


@dataclass(frozen=True)
class _Requester:
    user_id: int
    pseudonym: str
    is_system_admin: bool


def requester(db: Database, job: Job) -> tuple[Actor, Access]:
    """Who asked for the job, as audit actor and with their rights."""
    with db.transaction() as conn:
        row = conn.execute(
            select(
                JobRow.requested_by,
                JobRow.requested_label,
                UserRow.pseudonym,
                UserRow.is_system_admin,
                UserRow.active,
            )
            .outerjoin(UserRow, UserRow.id == JobRow.requested_by)
            .where(JobRow.id == job.id)
        ).one()
    actor = Actor(row.requested_by, row.requested_label)
    if row.requested_by is None:
        # The operator of the CLI (Q5).
        return actor, operator_access(actor)
    if not row.active:
        raise DomainError("NOT_ALLOWED", "The user who asked for this job is inactive.")
    access = MembershipService(db).access_for(
        _Requester(row.requested_by, row.pseudonym, row.is_system_admin)
    )
    return actor, access


def _invalid(report: ontospan.ValidationReport) -> DomainError:
    errors = report.errors
    return DomainError(
        "T1_INVALID",
        {
            "codes": sorted({issue.code for issue in errors}),
            "issues": [
                f"{issue.code} at {issue.path}: {issue.message}"
                for issue in errors[:MAX_ISSUES]
            ],
        },
    )


def _warnings(report: ontospan.ValidationReport) -> dict[str, int]:
    """How often each warning code occurs, by code."""
    return dict(sorted(Counter(issue.code for issue in report.warnings).items()))


def _validate(
    units: Sequence[ontospan.AnnotatedDocument],
    ontologies: Sequence[Mapping[str, ontospan.OntologyView]],
) -> dict[str, int]:
    """Validate each unit against its ontologies; warning counts by code."""
    report = ontospan.ValidationReport()
    for index, (unit, views) in enumerate(zip(units, ontologies, strict=True)):
        for issue in ontospan.validate(unit, views).issues:
            report.add(
                issue.level, issue.code, f"units[{index}].{issue.path}", issue.message
            )
    if not report.ok:
        raise _invalid(report)
    return _warnings(report)


def t1_import(job: Job, ctx: JobContext) -> dict[str, Any]:
    """Import a T1 bundle or unit into a project as documents and proposals.

    The payload is ``{project, blob_sha256, filename}``. The whole delivery is
    refused if its layers differ from the project's pins (``PIN_MISMATCH``),
    if a unit cannot be represented, or if a set kind or tool provenance is
    not accepted (Q11, Q33, T7 I3). Audited as ``project.import``.
    """
    from ontotator.exchange.uploads import run_import

    return run_import(job, ctx)


def _release_history(
    db: Database, project: str
) -> tuple[dict[str, list[str]], dict[str, str]]:
    """Each ontology's stored digests, oldest first, and the release of each digest."""
    with db.transaction() as conn:
        pins = conn.execute(
            select(
                ProjectOntologyRow.ontology_id,
                ProjectOntologyRow.sha256,
                ProjectOntologyRow.superseded_sha256,
            )
            .join(ProjectRow, ProjectRow.id == ProjectOntologyRow.project_id)
            .where(ProjectRow.project_key == project)
        ).all()
        digests = [d for pin in pins for d in (*pin.superseded_sha256, pin.sha256)]
        names = dict(
            conn.execute(
                select(OntologyFileRow.sha256, OntologyFileRow.release).where(
                    OntologyFileRow.sha256.in_(digests),
                    OntologyFileRow.kind == "ontology",
                )
            )
            .tuples()
            .all()
        )
    history = {
        pin.ontology_id: [d for d in (*pin.superseded_sha256, pin.sha256) if d in names]
        for pin in pins
    }
    return history, {digest: name or "" for digest, name in names.items()}


def _project_id(db: Database, project: str) -> int:
    with db.transaction() as conn:
        project_id = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == project)
        ).scalar_one()
    return int(project_id)


def _audit(
    db: Database,
    actor: Actor,
    action: str,
    project: str,
    details: dict[str, Any],
) -> None:
    project_id = _project_id(db, project)
    with db.transaction() as conn:
        record_audit(
            conn,
            actor,
            action,
            target_type="project",
            target_id=project,
            project_id=project_id,
            details=details,
        )


def t1_export(job: Job, ctx: JobContext) -> dict[str, Any]:
    """Export the latest submissions of a project as a validated T1 bundle (D5).

    One ``individual`` set per document, annotator and mode (Q12). Only
    annotators who consented are named as contributors (T1 F10). A unit that
    does not validate fails the job with the ontospan codes. The ZIP goes to
    the blob store; audited as ``project.export``.
    """
    db = ctx.db
    project = job.payload["project"]
    actor, access = requester(db, job)
    from ontotator.exchange.human_inputs import human_input_closure

    repo = ScopedRepository(db, access, actor)
    with db.snapshot():
        content = repo.t1_export_content(project)
        latest_ids = [sub.submission_id for sub in content.submissions]
        closure, inputs, kinds = human_input_closure(repo, project, latest_ids)
        if set(closure) != set(latest_ids):
            content = repo.t1_export_content_exact(project, closure)
    submissions = {sub.submission_id: sub for sub in content.submissions}
    overrides: dict[str, str] = {}
    for entries in inputs.values():
        for entry in entries:
            if entry["source_submission_id"] is None:
                overrides[f"input-{entry['input_id']}"] = draft_input_ref(
                    project, entry
                )
            else:
                source = submissions[entry["source_submission_id"]]
                source_key = source.origin_key
                overrides[f"input-{entry['input_id']}"] = ontospan.annotation_ref(
                    f"{project}:{source_key.annotator_id}:{source_key.mode}:{source.submission_id}",
                    entry["source_ref"]["annotation_id"],
                )
            overrides[f"round-input:{entry['input_id']}"] = overrides[
                f"input-{entry['input_id']}"
            ]
    result = serialize_t1_content(
        db,
        actor,
        project,
        content,
        job.id,
        source_ref_overrides=overrides,
        round_kinds=kinds,
    )
    result["provenance_only_submission_ids"] = sorted(set(closure) - set(latest_ids))
    return result


def draft_input_ref(project: str, entry: Mapping[str, Any]) -> str:
    """The exported source reference of a round input from a frozen draft.

    The draft (``draft_snapshots``) is not part of any bundle, so the
    reference does not resolve in any bundle; it names the snapshot id, which
    is local to the exporting database, so the provenance stays traceable in
    that project only.
    """
    return ontospan.annotation_ref(
        f"{project}:draft-snapshot-{entry['source_draft_snapshot_id']}",
        entry["source_ref"]["annotation_id"],
    )


def serialize_t1_content(
    db: Database,
    actor: Actor,
    project: str,
    content: ProjectExport,
    job_id: int,
    *,
    final_snapshot_id: str | None = None,
    final_bundle_kind: str = "selected",
    source_ref_overrides: Mapping[str, str] | None = None,
    round_kinds: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Serialize exactly the supplied immutable input selection."""
    if not content.submissions:
        raise DomainError("EXPORT_EMPTY", f"Project '{project}' has no submissions.")
    layers = layers_for(content.profile, content.pins)
    views: dict[str, ontospan.OntologyView] = {}

    def view_of(digest: str) -> ontospan.OntologyView:
        if digest not in views:
            views[digest] = ontospan.ObographOntology.load(db.blobs.path(digest))
        return views[digest]

    # Validate historical unresolved targets before serialization, which may
    # otherwise fail without the submission context or fill missing axes.
    from ontotator.application.submissions import validate_annotation_completion

    ontology_by_layer = {layer.layer_id: layer.ontology.id for layer in layers}
    history, release_names = _release_history(db, project)
    submission_layers = recorded_layers(
        layers,
        [
            recorded_digests(submission, content.proposals, ontology_by_layer)
            for submission in content.submissions
        ],
        history,
        release_names,
    )
    for submission in content.submissions:
        for decision in submission.decisions:
            if decision.outcome != "uncertain":
                continue
            try:
                proposal = content.proposals.get(
                    (decision.target.annotation_id, decision.target.version)
                )
                if proposal is None:
                    raise DomainError("TARGET_NOT_FOUND", decision.target.model_dump())
                validate_annotation_completion(proposal, content.profile)
                ontology_id = ontology_by_layer[proposal.annotation.layer_id]
                view = view_of(
                    proposal.ontology_sha256
                    if proposal.ontology_sha256 in history.get(ontology_id, ())
                    else content.pins[ontology_id].sha256
                )
                term_id = proposal.annotation.term_id
                if not view.is_active(term_id):
                    code = (
                        "UNKNOWN_TERM"
                        if view.label(term_id) is None
                        else "OBSOLETE_TERM"
                    )
                    raise DomainError(
                        code,
                        {
                            "annotation_id": proposal.annotation.annotation_id,
                            "term_id": term_id,
                        },
                    )
            except DomainError as exc:
                raise StructuredJobError(
                    "EXPORT_UNRESOLVED_INVALID",
                    {
                        "document_id": submission.origin_key.document_id,
                        "submission_id": submission.submission_id,
                        "annotation_id": decision.target.annotation_id,
                        "version": decision.target.version,
                        "cause": {"code": exc.code, "details": exc.details},
                    },
                ) from exc
    units: list[ontospan.AnnotatedDocument] = []
    counts: ExportCounts = {"rejected": 0, "uncertain": 0, "defaulted_axes": 0}
    legacy_warnings = [
        {
            "code": "LEGACY_UNRESOLVED_NOTE_MISSING",
            "annotation_id": decision.target.annotation_id,
            "version": decision.target.version,
        }
        for submission in content.submissions
        for decision in submission.decisions
        if decision.outcome == "uncertain"
        and not (decision.note and decision.note.strip())
    ]
    source_variant_hashes = {
        doc_id: entry.document.text_sha256
        for doc_id, entry in content.documents.items()
    }
    case_sizes: dict[str, int] = {}
    for entry in content.documents.values():
        if entry.variant is not None:
            case_sizes[entry.variant.case_id] = (
                case_sizes.get(entry.variant.case_id, 0) + 1
            )
    for submission, by_layer in zip(
        content.submissions, submission_layers, strict=True
    ):
        key = submission.origin_key
        stored = content.documents[key.document_id]
        unit, unit_counts = submission_to_unit(
            submission,
            stored.document,
            content.profile,
            layers,
            content.proposals,
            proposal_notes=content.proposal_notes,
            source_ref_overrides=source_ref_overrides,
            set_id=(
                f"submission-{submission.submission_id}"
                if final_snapshot_id
                else f"{project}:{key.annotator_id}:{key.mode}:{submission.submission_id}"
            ),
            source_text_sha256=stored.source_text_sha256,
            guideline_ref=content.guideline_refs.get(submission.submission_id),
            variant=stored.variant,
            source_variant_hashes=source_variant_hashes,
            single_native_case=stored.variant is None
            or case_sizes[stored.variant.case_id] == 1,
        )
        kind = (round_kinds or {}).get(submission.submission_id)
        # Every carry kind exports as ``carry_forward`` (no new stage names).
        if kind in CARRY_ROUND_KINDS:
            kind = "carry_forward"
        if kind in {"consolidation", "carry_forward"}:
            unit = unit.model_copy(
                update={
                    "annotation_set": unit.annotation_set.model_copy(
                        update={
                            "set_kind": "stage_result"
                            if kind == "consolidation"
                            else "individual",
                            "stage": kind,
                        }
                    )
                }
            )
        units.append(with_layers(unit, by_layer))
        for name in counts:
            counts[name] += unit_counts[name]  # type: ignore[literal-required]
    # write_bundle checks the format without ontology views. Validate against
    # the release each unit names before storing an export artifact.
    warning_counts = _validate(
        units,
        [
            {
                layer.ontology.id: view_of(layer.ontology.sha256 or "")
                for layer in by_layer.values()
            }
            for by_layer in submission_layers
        ],
    )
    now = datetime.now(UTC).replace(microsecond=0)
    bundle_id = (
        f"{final_bundle_kind}-{final_snapshot_id}"
        if final_snapshot_id
        else f"{project}-{now:%Y%m%dT%H%M%SZ}"
    )
    contributors = [
        ontospan.Contributor(actor_id=pseudonym, name=name, orcid=orcid)
        for pseudonym, name, orcid in content.contributors
    ]
    with tempfile.TemporaryDirectory(prefix="ontotator-export-") as tmp:
        target = Path(tmp) / f"{bundle_id}.zip"
        try:
            ontospan.write_bundle(
                target,
                units,
                bundle_id=bundle_id,
                created_at=now,
                contributors=contributors,
            )
        except ontospan.FormatError as exc:
            raise _invalid(exc.report) from None
        sha = store_file(db, target.read_bytes())
    result = {
        "sha256": sha,
        "bundle_id": bundle_id,
        "units": len(units),
        "contributors": len(contributors),
        "counts": dict(counts),
        # ontospan warnings (e.g. ``cohort_frequency``, ``exclusive_modifier_class``)
        # by code, with their counts next to them.
        "warnings": [*legacy_warnings, *({"code": code} for code in warning_counts)],
        "warning_counts": warning_counts,
    }
    _audit(db, actor, "project.export", project, {**result, "job_id": job_id})
    return result


def edit_log_export(job: Job, ctx: JobContext) -> dict[str, Any]:
    """Write the project's edit log as pseudonymised JSONL (D6, Q14).

    One line per event in id order; no user ids and no session ids. Audited
    as ``project.edit_log_export``.
    """
    db = ctx.db
    project = job.payload["project"]
    actor, access = requester(db, job)
    events = ScopedRepository(db, access, actor).edit_log(project)
    data = "".join(
        json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n"
        for event in events
    ).encode("utf-8")
    sha = store_file(db, data)
    result = {"sha256": sha, "events": len(events)}
    _audit(db, actor, "project.edit_log_export", project, {**result, "job_id": job.id})
    return result


HANDLERS: dict[str, Handler] = {
    "reanchor": reanchor,
    "upload_preview": upload_preview,
    "upload_commit": upload_commit,
    "t1_import": t1_import,
    "t1_export": t1_export,
    "final_t1_export": final_t1_export,
    "edit_log_export": edit_log_export,
    "translation_review_export": translation_review_export,
}
