"""Staged imports: fresh authorization, deterministic planning and atomic apply."""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any, Literal, cast

import ontospan
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Connection, func, insert, select, update

from ontotator.auth.audit import Actor, record_audit
from ontotator.authz.policy import Action
from ontotator.authz.project_authority import require_project_management
from ontotator.domain.canonical import canonical_hash
from ontotator.domain.errors import DomainError
from ontotator.domain.profiles import TaskProfile
from ontotator.domain.project_rules import ProjectRules
from ontotator.domain.variants import VariantInfo
from ontotator.domain.work_plans import (
    ImportPlanSetting,
    PlanFlags,
    RowKey,
    validate,
)
from ontotator.exchange.plan import (
    ImportPlan,
    IncomingUnit,
    Issue,
    PlannedDocument,
    PlannedRow,
    PlannedSet,
    ProjectImportState,
    WorkPlanContext,
    added_documents,
    case_ids,
    plan_import,
    plan_key,
    planned_rows,
    read_t1_upload,
    row_defaults,
    with_work_plan,
)
from ontotator.exchange.t1 import ImportCounts, ImportedDocument, ImportedSet
from ontotator.exchange.text import read_text_upload
from ontotator.exchange.variant_overrides import (
    StatusOverride,
    normalize_overrides,
    validate_targets,
)
from ontotator.exchange.variant_plan import identity, package_review
from ontotator.jobs.queue import Job, JobContext, JobQueue
from ontotator.projects.runtime import project_state, require_state
from ontotator.storage import work_plan_store
from ontotator.storage.database import Database
from ontotator.storage.repository import Repository, _lock_id
from ontotator.storage.tables import (
    DocumentRow,
    ProjectRow,
    ProposalSetRow,
    UploadRow,
)


class PlanChoice(BaseModel):
    """Plan flags chosen in the upload's "Work plan" step."""

    model_config = ConfigDict(extra="forbid")
    review: bool | None = None  # None keeps the default (always for sources)
    annotate: bool


class CasePlanChoice(PlanChoice):
    case_id: str
    language: str


class ImportAcceptance(BaseModel):
    """Translations of these languages were reviewed outside Ontotator."""

    model_config = ConfigDict(extra="forbid")
    languages: list[str] = Field(min_length=1)
    reason: str = Field(min_length=1, max_length=2000)


class PlanChoices(BaseModel):
    """The commit's plan overrides and acceptance, as stored in the job."""

    plan_languages: dict[str, PlanChoice] = Field(default_factory=dict)
    plan_cases: list[CasePlanChoice] = Field(default_factory=list)
    accept_external_review: ImportAcceptance | None = None

    @property
    def any(self) -> bool:
        return bool(
            self.plan_languages or self.plan_cases or self.accept_external_review
        )


class UploadFileInfo(BaseModel):
    filename: str
    sha256: str
    size: int


class UploadView(BaseModel):
    id: int
    kind: Literal["t1", "text"]
    language: str | None
    files: list[UploadFileInfo]
    status: str
    preview: ImportPlan | None
    plan_sha256: str | None
    preview_job_id: int | None = None
    commit_job_id: int | None
    created_at: datetime


def lock_import(conn: Connection, key: str, actor: Actor) -> int:
    """Global import, members, structure, then actor; held through commit."""
    conn.execute(select(func.pg_advisory_xact_lock(_lock_id("import"))))
    conn.execute(select(func.pg_advisory_xact_lock_shared(_lock_id("members", key))))
    conn.execute(select(func.pg_advisory_xact_lock(_lock_id("project", key))))
    project_id = Repository._project_id(conn, key)
    if project_id is None:
        raise DomainError("PROJECT_NOT_FOUND", "Project not found.")
    require_project_management(conn, actor, key, project_id, Action.IMPORT_DOCUMENTS)
    return project_id


def read_sources(
    db: Database,
    conn: Connection,
    key: str,
    project_id: int,
    kind: str,
    language: str | None,
    files: Sequence[dict[str, Any]],
) -> tuple[list[tuple[str, list[IncomingUnit]]], list[Issue]]:
    """Read source bytes once, retaining original file and producer identities."""
    repo = Repository(db)
    row = conn.execute(select(ProjectRow).where(ProjectRow.id == project_id)).one()
    profile = TaskProfile.model_validate(row.task_profile)
    pins = repo.project_pins(key)
    ontologies: dict[str, ontospan.OntologyView] = (
        {
            name: ontospan.ObographOntology.load(db.blobs.path(pin.sha256))
            for name, pin in pins.items()
        }
        if kind == "t1"
        else {}
    )
    sources: list[tuple[str, list[IncomingUnit]]] = []
    issues: list[Issue] = []
    if kind == "text":
        # Reader accounts for duplicates and expanded bytes across all sources.
        units, issues = read_text_upload(
            [(f["filename"], db.blobs.get(f["sha256"])) for f in files],
            language or "",
            languages=row.languages,
        )
        for file in files:
            label = file["filename"]
            sources.append(
                (
                    file["sha256"],
                    [
                        u
                        for u in units
                        if u.label == label or u.label.startswith(label + "/")
                    ],
                )
            )
    else:
        for file in files:
            units, found = read_t1_upload(
                db.blobs.path(file["sha256"]),
                pins,
                profile,
                filename=file["filename"],
                ontologies=ontologies,
            )
            sources.append((file["sha256"], units))
            issues.extend(found)
    return sources, issues


def prepare_plan(
    db: Database,
    conn: Connection,
    key: str,
    project_id: int,
    kind: str,
    language: str | None,
    files: Sequence[dict[str, Any]],
    *,
    prepared: tuple[list[tuple[str, list[IncomingUnit]]], list[Issue]] | None = None,
) -> tuple[ImportPlan, list[tuple[str, list[IncomingUnit]]]]:
    """Caller holds import/structure locks before fresh inventory and planning."""
    plan, sources, _ = _prepare(
        db, conn, key, project_id, kind, language, files, prepared=prepared
    )
    return plan, sources


def _plan_context(
    conn: Connection, project_id: int, row: Any, cases: Sequence[str]
) -> WorkPlanContext:
    return WorkPlanContext(
        setting=cast(ImportPlanSetting, row.import_plan),
        rule_on=row.annotate_accepted_translations_only,
        versions=work_plan_store.language_versions(conn, project_id, cases),
        flags=work_plan_store.effective_plan(conn, project_id, cases),
        stored=frozenset(work_plan_store.plan_rows(conn, project_id, cases)),
    )


def _prepare(
    db: Database,
    conn: Connection,
    key: str,
    project_id: int,
    kind: str,
    language: str | None,
    files: Sequence[dict[str, Any]],
    *,
    prepared: tuple[list[tuple[str, list[IncomingUnit]]], list[Issue]] | None = None,
) -> tuple[ImportPlan, list[tuple[str, list[IncomingUnit]]], WorkPlanContext]:
    row = conn.execute(select(ProjectRow).where(ProjectRow.id == project_id)).one()
    profile = TaskProfile.model_validate(row.task_profile)
    sources, reader_issues = (
        prepared
        if prepared is not None
        else read_sources(db, conn, key, project_id, kind, language, files)
    )
    issues = list(reader_issues)
    if kind == "text" and row.languages and language not in row.languages:
        issues.append(
            Issue(
                code="LANGUAGE_NOT_IN_PROJECT",
                unit="",
                message="Language is not enabled for this project.",
            )
        )
    documents = dict(
        conn.execute(
            select(DocumentRow.document_id, DocumentRow.text_sha256).where(
                DocumentRow.project_id == project_id
            )
        )
        .tuples()
        .all()
    )
    texts: dict[str, list[str]] = defaultdict(list)
    for doc_id, sha in documents.items():
        texts[sha].append(doc_id)
    sets = frozenset(
        (bundle_id, annotation_set_id, document_id)
        for bundle_id, annotation_set_id, document_id in conn.execute(
            select(
                ProposalSetRow.bundle_id,
                ProposalSetRow.annotation_set_id,
                ProposalSetRow.document_id,
            ).where(ProposalSetRow.project_id == project_id)
        ).tuples()
    )
    context = canonical_hash(
        {
            "structure": project_state(conn, key),
            "languages": row.languages,
            "annotate_accepted_translations_only": row.annotate_accepted_translations_only,
            "import_plan": row.import_plan,
        }
    )
    state = ProjectImportState(
        documents,
        texts,
        sets,
        context,
        {v.document_id: v for v in Repository(db).list_variants(key)},
    )
    plan = plan_import(
        [u for _, us in sources for u in us],
        state,
        profile,
        ProjectRules.of(row),
        issues,
    )
    ctx = _plan_context(conn, project_id, row, case_ids(plan))
    return with_work_plan(plan, ctx), sources, ctx


def apply_plan(
    db: Database,
    project: str,
    plan: ImportPlan,
    sources: Sequence[tuple[str, list[IncomingUnit]]],
    actor: Actor,
    *,
    job_id: int,
) -> ImportCounts:
    """Apply filtered proposals, retaining the complete delivered payload per source.

    The outer transaction owns locks and audit/status atomicity. Preview document
    counts describe incoming units, whereas the repository deduplicates each call;
    retain those unit counts and aggregate actual inserted sets/proposals.
    """
    if not plan.committable:
        raise DomainError(
            "T1_INVALID",
            {
                "codes": sorted({i.code for i in plan.errors}),
                "issues": [i.model_dump() for i in plan.errors],
            },
        )
    variants = {(v.external_id, v.language, v.version): v for v in plan.variants}
    occurrences = [(sha, unit) for sha, units in sources for unit in units]
    # One physical row per logical identity, in the planner's stable topology.
    incoming: dict[str, IncomingUnit] = {}
    for _, unit in occurrences:
        incoming.setdefault(variants[identity(unit)].document_id, unit)
    # Preview ordering includes bundle/set identity and retains stable ties.
    # Use its first occurrence as the authority for immutable raw provenance.
    canonical: dict[str, PlannedDocument] = {}
    for document in plan.documents:
        canonical.setdefault(document.document_id, document)
    documents = []
    for variant in plan.variants:
        unit = incoming[variant.document_id]
        chosen = canonical[variant.document_id]
        documents.append(
            ImportedDocument(
                unit.document.model_copy(
                    update={
                        "document_id": variant.document_id,
                        "language": chosen.language,
                    }
                ),
                chosen.source_text_sha256,
                VariantInfo(
                    variant.document_id,
                    variant.case_id,
                    variant.external_id,
                    variant.language,
                    variant.version,
                    variant.origin,
                    variant.derived_from,
                    variant.translation,
                    variant.status,
                    variant.status_reason,
                    unit.document.text_sha256,
                ),
            )
        )
    repo = Repository(db)
    counts = repo.add_documents_and_proposals(
        project,
        documents,
        [],
        source_sha256=sources[0][0] if sources else "",
        imported_by=actor.user_id,
        job_id=job_id,
    )
    counts["documents_skipped"] = len(occurrences) - counts["documents_added"]
    counts["documents_only"] = len(plan.documents_only)
    counts["sets_added"] = counts["sets_skipped"] = counts["proposals"] = 0
    planned: dict[tuple[str | None, str, str], PlannedSet] = {}
    for item in plan.proposal_sets:
        planned.setdefault(
            (item.bundle_id, item.annotation_set_id, item.document_id), item
        )
    owners: dict[tuple[str | None, str, str], tuple[str, int, int]] = {}
    for source_index, (_, units) in enumerate(sources):
        for unit_index, unit in enumerate(units):
            if unit.set is not None:
                variant = variants[identity(unit)]
                key = (unit.bundle_id, unit.set.annotation_set_id, variant.document_id)
                candidate = (unit.label, source_index, unit_index)
                if key not in owners or candidate < owners[key]:
                    owners[key] = candidate
    for source_index, (sha, units) in enumerate(sources):
        sets = []
        for unit_index, unit in enumerate(units):
            if unit.set is None:
                continue
            variant = variants[identity(unit)]
            key = (unit.bundle_id, unit.set.annotation_set_id, variant.document_id)
            item = planned[key]
            if owners[key][1:] != (source_index, unit_index):
                counts["sets_skipped"] += 1
                continue
            if item.action != "add":
                counts["sets_skipped"] += 1
                continue
            sets.append(
                ImportedSet(
                    item.document_id,
                    item.bundle_id,
                    item.manifest_sha256,
                    item.annotation_set_id,
                    item.set_kind,
                    item.actors,
                    item.payload,
                    item.proposals,
                )
            )
        result = repo.add_documents_and_proposals(
            project,
            [],
            sets,
            source_sha256=sha,
            imported_by=actor.user_id,
            job_id=job_id,
        )
        for name in ("sets_added", "sets_skipped", "proposals"):
            counts[name] += result[name]
    from ontotator.exchange.reanchor_job import CorrectionPair, enqueue_import_pairs

    added = {
        document.document_id for document in plan.documents if document.action == "add"
    }
    pairs = [
        CorrectionPair(
            old_document_id=variant.derived_from, new_document_id=variant.document_id
        )
        for variant in plan.variants
        if variant.document_id in added
        and variant.origin == "correction"
        and variant.derived_from is not None
    ]
    if pairs:
        with db.transaction() as conn:
            project_id = Repository._project_id(conn, project)
            assert project_id is not None
            enqueue_import_pairs(db, project, project_id, job_id, actor, pairs)
    return counts


def _overrides(
    conn: Connection,
    actor: Actor,
    key: str,
    project_id: int,
    plan: ImportPlan,
    values: Sequence[StatusOverride | dict[str, Any]],
) -> dict[str, str]:
    normalized = normalize_overrides(values)
    if normalized:
        _require_override(conn, actor, key, project_id)
    return validate_targets(plan, normalized)


def _require_override(
    conn: Connection, actor: Actor, key: str, project_id: int
) -> None:
    if actor.user_id is None and not actor.label.startswith("cli:"):
        raise DomainError(
            "NOT_ALLOWED",
            "Only the explicit CLI operator may override without a user",
        )
    require_project_management(
        conn, actor, key, project_id, Action.OVERRIDE_TRANSLATION_STATUS
    )


def _apply_overrides(
    conn: Connection,
    actor: Actor,
    project_id: int,
    plan: ImportPlan,
    accepted: dict[str, str],
    *,
    upload_id: int | None = None,
) -> None:
    """Accept-without-review overrides.

    ``validate_targets`` also allows variants imported earlier (re-delivered in
    this upload); their status changes as before, but only documents this
    upload adds get an ``override`` acceptance record.
    """
    variants = {v.document_id: v for v in plan.variants}
    added = added_documents(plan)
    for document_id, reason in accepted.items():
        previous = variants[document_id]
        if previous.status == "accepted" and previous.status_reason == reason:
            continue
        conn.execute(
            update(DocumentRow)
            .where(
                DocumentRow.project_id == project_id,
                DocumentRow.document_id == document_id,
            )
            .values(translation_status="accepted", status_reason=reason)
        )
        if document_id in added:
            work_plan_store.add_acceptance(
                conn,
                project_id,
                document_id,
                source="override",
                reason=reason,
                accepted_by=actor.user_id,
                upload_id=upload_id,
            )
        record_audit(
            conn,
            actor,
            "variant.status_override",
            target_type="document",
            target_id=document_id,
            project_id=project_id,
            details={
                "document_id": document_id,
                "from": previous.status,
                "to": "accepted",
                "reason": reason,
                "upload_id": upload_id,
            },
        )


def _not_in_upload(details: dict[str, Any]) -> DomainError:
    return DomainError("WORK_PLAN_INVALID", {"reason": "not_in_upload", **details})


def _choose(current: PlanFlags, choice: PlanChoice) -> PlanFlags:
    review = current.review if choice.review is None else choice.review
    return PlanFlags(review, choice.annotate)


def _row_order(key: RowKey) -> tuple[str, str]:
    return key.case_id, key.language


@dataclass(frozen=True)
class ResolvedWorkPlan:
    """The validated plan of an import's new rows, resolved once per job."""

    flags: dict[RowKey, PlanFlags]  # new rows only
    rows: dict[RowKey, PlannedRow]  # every row the upload touches
    accepting: frozenset[RowKey]  # rows the lead accepts as reviewed outside


def _resolve_work_plan(
    conn: Connection,
    actor: Actor,
    key: str,
    project_id: int,
    plan: ImportPlan,
    ctx: WorkPlanContext,
    choices: PlanChoices,
    overridden: Mapping[str, str],
) -> ResolvedWorkPlan:
    """Flags of the new rows: default, then language choice, then case choice.

    Refuses an invalid plan before any write. A language named in
    ``accept_external_review`` without any eligible row (a new, not accepted
    translation row with Annotate on and Review off) is ``not_acceptable``.
    """
    rows = planned_rows(plan.variants, added_documents(plan), ctx)
    if overridden:
        for row_key, row in rows.items():
            if row.new and not row.version.is_source:
                accepted = bool(row.targets) and all(
                    t.status == "accepted" or t.document_id in overridden
                    for t in row.targets
                )
                rows[row_key] = replace(
                    row, version=replace(row.version, accepted=accepted)
                )
    new = {k: r for k, r in rows.items() if r.new}
    flags = row_defaults(rows, ctx)
    unknown = sorted(
        set(choices.plan_languages) - {plan_key(r.version) for r in new.values()}
    )
    if unknown:
        raise _not_in_upload({"languages": unknown, "rows": []})
    for row_key, row in new.items():
        choice = choices.plan_languages.get(plan_key(row.version))
        if choice is not None:
            flags[row_key] = _choose(flags[row_key], choice)
    missing = []
    for case_choice in choices.plan_cases:
        row_key = RowKey(case_choice.case_id, case_choice.language)
        if row_key in new:
            flags[row_key] = _choose(flags[row_key], case_choice)
        else:
            missing.append({"case_id": row_key.case_id, "language": row_key.language})
    if missing:
        raise _not_in_upload({"languages": [], "rows": missing})
    accepting: frozenset[RowKey] = frozenset()
    acceptance = choices.accept_external_review
    if acceptance is not None:
        if not acceptance.reason.strip():
            raise DomainError(
                "OVERRIDE_REASON_REQUIRED", "Accepting a translation requires a reason."
            )
        _require_override(conn, actor, key, project_id)
        translated = {
            r.version.language for r in new.values() if not r.version.is_source
        }
        unknown = sorted(set(acceptance.languages) - translated)
        if unknown:
            raise _not_in_upload({"languages": unknown, "rows": []})
        accepting = frozenset(
            row_key
            for row_key, row in new.items()
            if not row.version.is_source
            and row.version.language in acceptance.languages
            and not row.version.accepted
            and flags[row_key].annotate
            and not flags[row_key].review
        )
        empty = sorted(
            set(acceptance.languages) - {row_key.language for row_key in accepting}
        )
        if empty:
            raise DomainError(
                "WORK_PLAN_INVALID",
                {"reason": "not_acceptable", "languages": empty, "rows": []},
            )
    invalid = validate(
        flags,
        {k: r.version for k, r in new.items()},
        rule_on=ctx.rule_on,
        accepting=accepting,
    )
    if invalid:
        raise DomainError(
            "WORK_PLAN_INVALID",
            {
                "reason": invalid[0].reason,
                "rows": [
                    {
                        "case_id": item.key.case_id,
                        "language": item.key.language,
                        "reason": item.reason,
                        "not_accepted": not new[item.key].version.accepted,
                        "not_acceptable": item.reason == "not_acceptable",
                        "marked_in_package": new[item.key].version.marked_in_package,
                    }
                    for item in invalid
                ],
            },
        )
    return ResolvedWorkPlan(flags, rows, accepting)


def _apply_work_plan(
    conn: Connection,
    actor: Actor,
    key: str,
    project_id: int,
    plan: ImportPlan,
    ctx: WorkPlanContext,
    choices: PlanChoices,
    resolved: ResolvedWorkPlan,
    overridden: Mapping[str, str],
    *,
    upload_id: int | None,
) -> None:
    """Plan rows plus package and lead acceptances, inside the import transaction.

    Existing rows keep their (effective) flags, now stored; a fully discarded
    row that gets a new root is overwritten with its new flags. A case that
    existed before and gets new rows has its plan revision bumped, so open
    plan dialogs see ``WORK_PLAN_CHANGED``.
    """
    flags, rows, accepting = resolved.flags, resolved.rows, resolved.accepting
    overwrite = {k: v for k, v in flags.items() if rows[k].stored}
    grown = {k.case_id for k in flags} & {k.case_id for k in ctx.versions}
    grown -= {k.case_id for k in overwrite}  # write_rows bumps those
    if grown:
        work_plan_store.bump_revisions(conn, project_id, grown)
    kept = {
        row_key: value
        for row_key, value in ctx.flags.items()
        if row_key not in ctx.stored and row_key not in flags
    }
    work_plan_store.ensure_rows(
        conn,
        project_id,
        {**kept, **{k: v for k, v in flags.items() if not rows[k].stored}},
    )
    if overwrite:
        work_plan_store.write_rows(conn, project_id, overwrite, actor_id=actor.user_id)
    added = added_documents(plan)
    for variant in plan.variants:
        if variant.marked_in_package and variant.document_id in added:
            work_plan_store.add_acceptance(
                conn,
                project_id,
                variant.document_id,
                source="package",
                reason=None,
                accepted_by=None,
                upload_id=upload_id,
                metadata=package_review(variant.translation),
            )
    acceptance = choices.accept_external_review
    accepted_documents: list[str] = []
    for row_key in sorted(accepting, key=_row_order):
        assert acceptance is not None
        reason = acceptance.reason.strip()
        for target in rows[row_key].targets:
            if target.status == "accepted" or target.document_id in overridden:
                continue
            conn.execute(
                update(DocumentRow)
                .where(
                    DocumentRow.project_id == project_id,
                    DocumentRow.document_id == target.document_id,
                )
                .values(translation_status="accepted", status_reason=reason)
            )
            accepted_documents.append(target.document_id)
            work_plan_store.add_acceptance(
                conn,
                project_id,
                target.document_id,
                source="lead",
                reason=reason,
                accepted_by=actor.user_id,
                upload_id=upload_id,
            )
            record_audit(
                conn,
                actor,
                "translation.accept_external_review",
                target_type="document",
                target_id=target.document_id,
                project_id=project_id,
                details={
                    "document_id": target.document_id,
                    "from": target.status,
                    "to": "accepted",
                    "reason": reason,
                    "upload_id": upload_id,
                },
            )
    if flags:
        record_audit(
            conn,
            actor,
            "work_plan.import",
            target_type="project",
            target_id=key,
            project_id=project_id,
            details={
                "upload_id": upload_id,
                "setting": ctx.setting,
                **choices.model_dump(mode="json"),
                "accepted_documents": accepted_documents,
                "rows": [
                    {
                        "case_id": k.case_id,
                        "language": k.language,
                        "review": flags[k].review,
                        "annotate": flags[k].annotate,
                    }
                    for k in sorted(flags, key=_row_order)
                ],
            },
        )


def _summary(
    plan: ImportPlan,
    sources: Sequence[tuple[str, list[IncomingUnit]]],
    counts: ImportCounts,
) -> dict[str, Any]:
    provenance = []
    for sha, units in sources:
        producers = []
        for unit in units:
            for actor in unit.source_actors or (unit.set.actors if unit.set else []):
                entry = {
                    k: actor.get(k) for k in ("name", "version", "model", "run_id")
                }
                if actor.get("kind") == "tool" and entry not in producers:
                    producers.append(entry)
        provenance.append(
            {
                "source_sha256": sha,
                "bundle_id": units[0].bundle_id if units else None,
                "manifest_sha256": units[0].manifest_sha256 if units else None,
                "producers": producers,
            }
        )
    single = provenance[0] if len(provenance) == 1 else {}
    return {
        **single,
        "sources": provenance,
        "units": sum(len(us) for _, us in sources),
        **counts,
        "defaulted_axes": plan.counts["defaulted_axes"],
        "refused": plan.counts["refused"],
    }


def run_import(job: Job, ctx: JobContext) -> dict[str, Any]:
    from ontotator.exchange.jobs import requester

    db, key = ctx.db, job.payload["project"]
    actor, _ = requester(db, job)
    files = [
        {"filename": job.payload["filename"], "sha256": job.payload["blob_sha256"]}
    ]
    kind, language = job.payload.get("kind", "t1"), job.payload.get("language")
    # Parse once before waiting, then verify the captured structural snapshot
    # under the write locks. The actual inventory/rules/plan are loaded fresh.
    with db.transaction() as conn:
        expected = project_state(conn, key)
        project_id = Repository(db)._require_project(conn, key)
        prepared = read_sources(db, conn, key, project_id, kind, language, files)
    with db.transaction() as conn:
        project_id = lock_import(conn, key, actor)
        require_state(conn, key, expected)
        plan, sources, plan_ctx = _prepare(
            db, conn, key, project_id, kind, language, files, prepared=prepared
        )
        accepted = _overrides(
            conn, actor, key, project_id, plan, job.payload.get("status_overrides", [])
        )
        # Without a preview the new rows get the project default.
        choices = PlanChoices()
        resolved = _resolve_work_plan(
            conn, actor, key, project_id, plan, plan_ctx, choices, accepted
        )
        counts = apply_plan(db, key, plan, sources, actor, job_id=job.id)
        _apply_overrides(conn, actor, project_id, plan, accepted)
        _apply_work_plan(
            conn,
            actor,
            key,
            project_id,
            plan,
            plan_ctx,
            choices,
            resolved,
            accepted,
            upload_id=None,
        )
        from ontotator.exchange.reanchor_job import import_pair_result

        summary = {
            **_summary(plan, sources, counts),
            **import_pair_result(conn, job.id),
        }
        record_audit(
            conn,
            actor,
            "project.import",
            target_type="project",
            target_id=key,
            project_id=project_id,
            details={**summary, "job_id": job.id},
        )
        return {
            **summary,
            "warnings": sorted({i.code for i in plan.warnings}),
            "warning_counts": dict(
                sorted(Counter(i.code for i in plan.warnings).items())
            ),
        }


def _upload_job(job: Job, ctx: JobContext, *, commit: bool) -> dict[str, Any]:
    from ontotator.exchange.jobs import requester

    db, key, upload_id = ctx.db, job.payload["project"], job.payload["upload_id"]
    try:
        actor, _ = requester(db, job)
        with db.transaction() as conn:
            project_id = lock_import(conn, key, actor)
            row = conn.execute(
                select(UploadRow)
                .where(UploadRow.id == upload_id, UploadRow.project_id == project_id)
                .with_for_update()
            ).one_or_none()
            if row is None:
                raise DomainError("UPLOAD_NOT_FOUND", "Upload not found.")
            expected = "committing" if commit else "previewing"
            if (
                row.status != expected
                or (commit and row.commit_job_id != job.id)
                or (not commit and row.preview_job_id != job.id)
            ):
                raise DomainError(
                    "UPLOAD_STALE", "Upload is no longer in the expected state."
                )
            plan, sources, plan_ctx = _prepare(
                db, conn, key, project_id, row.kind, row.language, row.files
            )
            if commit:
                if plan.plan_sha256 != row.plan_sha256:
                    raise DomainError(
                        "UPLOAD_STALE", "Project changed since preview; upload again."
                    )
                accepted = _overrides(
                    conn,
                    actor,
                    key,
                    project_id,
                    plan,
                    job.payload.get("status_overrides", []),
                )
                choices = PlanChoices.model_validate(
                    {
                        name: job.payload[name]
                        for name in PlanChoices.model_fields
                        if job.payload.get(name) is not None
                    }
                )
                # Refuse an invalid plan before any document is written.
                resolved = _resolve_work_plan(
                    conn, actor, key, project_id, plan, plan_ctx, choices, accepted
                )
                counts = apply_plan(db, key, plan, sources, actor, job_id=job.id)
                _apply_overrides(
                    conn, actor, project_id, plan, accepted, upload_id=upload_id
                )
                _apply_work_plan(
                    conn,
                    actor,
                    key,
                    project_id,
                    plan,
                    plan_ctx,
                    choices,
                    resolved,
                    accepted,
                    upload_id=upload_id,
                )
                from ontotator.exchange.reanchor_job import import_pair_result

                result = {
                    **_summary(plan, sources, counts),
                    **import_pair_result(conn, job.id),
                }
                values: dict[str, Any] = {"status": "committed"}
            else:
                result = {"counts": plan.counts}
                values = {
                    "status": "ready" if plan.committable else "invalid",
                    "preview": plan.model_dump(mode="json"),
                    "plan_sha256": plan.plan_sha256,
                }
            conn.execute(
                update(UploadRow)
                .where(UploadRow.id == upload_id)
                .values(**values, updated_at=func.now())
            )
            record_audit(
                conn,
                actor,
                "project.import" if commit else "upload.preview",
                target_type="project",
                target_id=key,
                project_id=project_id,
                details={**result, "upload_id": upload_id, "job_id": job.id},
            )
            return result
    except Exception:
        # Outside the rolled-back apply transaction; never persist partial writes.
        with db.transaction() as conn:
            conn.execute(
                update(UploadRow)
                .where(
                    UploadRow.id == upload_id,
                    UploadRow.project_id
                    == select(ProjectRow.id)
                    .where(ProjectRow.project_key == key)
                    .scalar_subquery(),
                    (UploadRow.commit_job_id if commit else UploadRow.preview_job_id)
                    == job.id,
                    UploadRow.status == ("committing" if commit else "previewing"),
                )
                .values(status="failed", updated_at=func.now())
            )
        raise


def upload_preview(job: Job, ctx: JobContext) -> dict[str, Any]:
    return _upload_job(job, ctx, commit=False)


def upload_commit(job: Job, ctx: JobContext) -> dict[str, Any]:
    return _upload_job(job, ctx, commit=True)


class UploadService:
    def __init__(self, db: Database, queue: JobQueue, actor: Actor) -> None:
        self.db, self.queue, self.actor = db, queue, actor

    def _project(self, conn: Connection, key: str) -> int:
        conn.execute(
            select(func.pg_advisory_xact_lock_shared(_lock_id("members", key)))
        )
        project_id = Repository._project_id(conn, key)
        if project_id is None:
            raise DomainError("PROJECT_NOT_FOUND", "Project not found.")
        require_project_management(
            conn, self.actor, key, project_id, Action.IMPORT_DOCUMENTS
        )
        return project_id

    def create(
        self, key: str, kind: str, language: str | None, files: list[UploadFileInfo]
    ) -> dict[str, int]:
        if kind == "text" and not language:
            raise DomainError("LANGUAGE_REQUIRED", "Text uploads require a language.")
        if not files:
            raise DomainError("UPLOAD_EMPTY", "Supply at least one file.")
        with self.db.transaction() as conn:
            project_id = self._project(conn, key)
            upload_id = conn.execute(
                insert(UploadRow)
                .values(
                    project_id=project_id,
                    created_by=self.actor.user_id,
                    kind=kind,
                    language=language,
                    files=[f.model_dump() for f in files],
                    status="previewing",
                )
                .returning(UploadRow.id)
            ).scalar_one()
            job_id = self.queue.enqueue(
                "upload_preview",
                {"project": key, "upload_id": upload_id},
                project_id=project_id,
                actor=self.actor,
            )
            conn.execute(
                update(UploadRow)
                .where(UploadRow.id == upload_id)
                .values(preview_job_id=job_id)
            )
            return {"upload_id": upload_id, "job_id": job_id}

    def list(self, key: str) -> list[UploadView]:
        with self.db.transaction() as conn:
            project_id = self._project(conn, key)
            return [
                UploadView.model_validate(dict(row))
                for row in conn.execute(
                    select(UploadRow)
                    .where(UploadRow.project_id == project_id)
                    .order_by(UploadRow.created_at.desc(), UploadRow.id.desc())
                    .limit(50)
                ).mappings()
            ]

    def get(self, key: str, upload_id: int) -> UploadView:
        with self.db.transaction() as conn:
            project_id = self._project(conn, key)
            row = self._row(conn, project_id, upload_id)
            return UploadView.model_validate(dict(row))

    @staticmethod
    def _row(conn: Connection, project_id: int, upload_id: int) -> Any:
        row = (
            conn.execute(
                select(UploadRow)
                .where(UploadRow.id == upload_id, UploadRow.project_id == project_id)
                .with_for_update()
            )
            .mappings()
            .one_or_none()
        )
        if row is None:
            raise DomainError("UPLOAD_NOT_FOUND", "Upload not found.")
        return row

    def commit(
        self,
        key: str,
        upload_id: int,
        digest: str,
        status_overrides: Sequence[StatusOverride] = (),
        *,
        plan_languages: Mapping[str, PlanChoice] | None = None,
        plan_cases: Sequence[CasePlanChoice] = (),
        accept_external_review: ImportAcceptance | None = None,
    ) -> dict[str, int]:
        normalized = normalize_overrides(status_overrides)
        choices = PlanChoices(
            plan_languages=dict(plan_languages or {}),
            plan_cases=list(plan_cases),
            accept_external_review=accept_external_review.model_copy(
                update={"reason": accept_external_review.reason.strip()}
            )
            if accept_external_review is not None
            else None,
        )
        with self.db.transaction() as conn:
            project_id = lock_import(conn, key, self.actor)
            row = self._row(conn, project_id, upload_id)
            if row.status != "ready" or row.plan_sha256 != digest:
                raise DomainError(
                    "UPLOAD_STALE", "Upload is not ready or the plan hash changed."
                )
            if normalized or choices.any:
                plan, _, ctx = _prepare(
                    self.db, conn, key, project_id, row.kind, row.language, row.files
                )
                if plan.plan_sha256 != digest:
                    raise DomainError(
                        "UPLOAD_STALE", "Project changed since preview; upload again."
                    )
                accepted = _overrides(
                    conn, self.actor, key, project_id, plan, normalized
                )
                _resolve_work_plan(
                    conn, self.actor, key, project_id, plan, ctx, choices, accepted
                )
            job_id = self.queue.enqueue(
                "upload_commit",
                {
                    "project": key,
                    "upload_id": upload_id,
                    "status_overrides": [item.model_dump() for item in normalized],
                    **(choices.model_dump(mode="json") if choices.any else {}),
                },
                project_id=project_id,
                actor=self.actor,
            )
            conn.execute(
                update(UploadRow)
                .where(UploadRow.id == upload_id)
                .values(
                    status="committing", commit_job_id=job_id, updated_at=func.now()
                )
            )
            return {"upload_id": upload_id, "job_id": job_id}

    def discard(self, key: str, upload_id: int) -> UploadView:
        with self.db.transaction() as conn:
            project_id = self._project(conn, key)
            row = self._row(conn, project_id, upload_id)
            if row.status not in ("ready", "invalid"):
                raise DomainError(
                    "UPLOAD_STALE", "Only ready or invalid uploads can be discarded."
                )
            conn.execute(
                update(UploadRow)
                .where(UploadRow.id == upload_id)
                .values(status="discarded", updated_at=func.now())
            )
            return self.get(key, upload_id)
