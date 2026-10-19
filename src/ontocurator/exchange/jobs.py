"""Import and export jobs of the T1 exchange (T2d Tasks 4 and 5).

Handlers run in a job worker or inline from the CLI. They act for the user
who asked for the job (``jobs.requested_by``) with that user's rights; a job
without a user was asked for by the operator on the command line, who acts as
a system admin (Q5).
"""

from __future__ import annotations

import json
import tempfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import ontospan
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ontocurator.auth.audit import Actor, record_audit
from ontocurator.authz.memberships import MembershipService
from ontocurator.authz.policy import Access
from ontocurator.authz.scoped import ScopedRepository
from ontocurator.domain.errors import DomainError
from ontocurator.exchange.final_export import final_t1_export
from ontocurator.exchange.reanchor_job import reanchor
from ontocurator.exchange.review_export import translation_review_export
from ontocurator.exchange.t1 import (
    ExportCounts,
    layers_for,
    submission_to_unit,
)
from ontocurator.exchange.uploads import upload_commit, upload_preview
from ontocurator.jobs.queue import Handler, Job, JobContext, StructuredJobError
from ontocurator.storage.database import Database
from ontocurator.storage.repository import ProjectExport
from ontocurator.storage.tables import JobRow, ProjectRow, StoredFileRow, UserRow

# How many ontospan issues a failed job names in its error.
MAX_ISSUES = 20


def store_file(db: Database, data: bytes) -> str:
    """Put ``data`` in the blob store and record it in ``stored_files``."""
    digest = db.blobs.put(data)
    with db.transaction() as conn:
        conn.execute(
            pg_insert(StoredFileRow)
            .values(sha256=digest, size=len(data))
            .on_conflict_do_nothing()
        )
    return digest


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


def _warnings(report: ontospan.ValidationReport) -> list[str]:
    return sorted({issue.code for issue in report.warnings})


def _validate(
    units: Sequence[ontospan.AnnotatedDocument],
    ontologies: Mapping[str, ontospan.OntologyView],
) -> list[str]:
    """Validate every unit against the pinned ontologies; warnings' codes."""
    report = ontospan.ValidationReport()
    for index, unit in enumerate(units):
        for issue in ontospan.validate(unit, ontologies).issues:
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
    from ontocurator.exchange.uploads import run_import

    return run_import(job, ctx)


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
    from ontocurator.exchange.human_inputs import human_input_closure

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
    ontologies: dict[str, ontospan.OntologyView] = {
        ontology_id: ontospan.ObographOntology.load(db.blobs.path(pin.sha256))
        for ontology_id, pin in content.pins.items()
    }
    # Validate historical unresolved targets before serialization, which may
    # otherwise fail without the submission context or fill missing axes.
    from ontocurator.application.submissions import validate_annotation_completion

    ontology_by_layer = {layer.layer_id: layer.ontology.id for layer in layers}
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
                view = ontologies[ontology_by_layer[proposal.annotation.layer_id]]
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
    for submission in content.submissions:
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
            guideline_ref=content.guideline_ref,
            variant=stored.variant,
            source_variant_hashes=source_variant_hashes,
            single_native_case=stored.variant is None
            or case_sizes[stored.variant.case_id] == 1,
        )
        kind = (round_kinds or {}).get(submission.submission_id)
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
        units.append(unit)
        for name in counts:
            counts[name] += unit_counts[name]  # type: ignore[literal-required]
    # write_bundle checks the format without ontology views. Validate against
    # the same pinned ontologies as import before storing an export artifact.
    _validate(units, ontologies)
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
    with tempfile.TemporaryDirectory(prefix="ontocurator-export-") as tmp:
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
        "warnings": legacy_warnings,
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
