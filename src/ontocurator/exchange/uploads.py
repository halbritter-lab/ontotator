"""Staged imports: fresh authorization, deterministic planning and atomic apply."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from datetime import datetime
from typing import Any, Literal

import ontospan
from pydantic import BaseModel
from sqlalchemy import Connection, func, insert, select, update

from ontocurator.auth.audit import Actor, record_audit
from ontocurator.authz.policy import Action
from ontocurator.authz.project_authority import require_project_management
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.errors import DomainError
from ontocurator.domain.profiles import TaskProfile
from ontocurator.domain.project_rules import ProjectRules
from ontocurator.exchange.plan import (
    ImportPlan,
    IncomingUnit,
    Issue,
    PlannedDocument,
    PlannedSet,
    ProjectImportState,
    plan_import,
    read_t1_upload,
)
from ontocurator.exchange.t1 import ImportCounts, ImportedDocument, ImportedSet
from ontocurator.exchange.text import read_text_upload
from ontocurator.jobs.queue import Job, JobContext, JobQueue
from ontocurator.projects.runtime import project_state, require_state
from ontocurator.storage.database import Database
from ontocurator.storage.repository import Repository, _lock_id
from ontocurator.storage.tables import (
    DocumentRow,
    ProjectRow,
    ProposalSetRow,
    UploadRow,
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
        {"structure": project_state(conn, key), "languages": row.languages}
    )
    state = ProjectImportState(documents, texts, sets, context)
    return (
        plan_import(
            [u for _, us in sources for u in us],
            state,
            profile,
            ProjectRules.of(row),
            issues,
        ),
        sources,
    )


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
    counts: ImportCounts = {
        "documents_added": plan.counts["documents_added"],
        "documents_skipped": plan.counts["documents_skipped"],
        "documents_only": plan.counts["documents_only"],
        "sets_added": plan.counts["sets_added"],
        "sets_skipped": plan.counts["sets_skipped"],
        "proposals": plan.counts["proposals"],
    }
    planned: dict[tuple[str | None, str, str], PlannedSet] = {}
    for item in plan.proposal_sets:
        planned.setdefault(
            (item.bundle_id, item.annotation_set_id, item.document_id), item
        )
    # For an equal identity the planner orders by label, then its stable input
    # order. Keep that exact occurrence attached to its original source blob.
    owners: dict[tuple[str | None, str, str], tuple[str, int, int]] = {}
    for source_index, (_, units) in enumerate(sources):
        for unit_index, unit in enumerate(units):
            if unit.set is None:
                continue
            identity = (
                unit.bundle_id,
                unit.set.annotation_set_id,
                unit.document.document_id,
            )
            candidate = (unit.label, source_index, unit_index)
            if identity not in owners or candidate < owners[identity]:
                owners[identity] = candidate
    canonical_documents: dict[str, PlannedDocument] = {}
    for document in plan.documents:
        canonical_documents.setdefault(document.document_id, document)
    seen: set[tuple[str | None, str, str]] = set()
    actual = {"documents_added": 0, "sets_added": 0, "proposals": 0}
    for source_index, (sha, units) in enumerate(sources):
        sets = []
        for unit_index, unit in enumerate(units):
            if unit.set is None:
                continue
            identity = (
                unit.bundle_id,
                unit.set.annotation_set_id,
                unit.document.document_id,
            )
            item = planned[identity]
            if (
                identity in seen
                or item.action != "add"
                or owners[identity][1:] != (source_index, unit_index)
            ):
                continue
            seen.add(identity)
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
        result = Repository(db).add_documents_and_proposals(
            project,
            [
                ImportedDocument(
                    unit.document.model_copy(
                        update={
                            "language": canonical_documents[
                                unit.document.document_id
                            ].language
                        }
                    ),
                    canonical_documents[unit.document.document_id].source_text_sha256,
                )
                for unit in units
            ],
            sets,
            source_sha256=sha,
            imported_by=actor.user_id,
            job_id=job_id,
        )
        for name in actual:
            actual[name] += result[name]  # type: ignore[literal-required]
    for name, value in actual.items():
        counts[name] = value  # type: ignore[literal-required]
    return counts


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
    from ontocurator.exchange.jobs import requester

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
        plan, sources = prepare_plan(
            db, conn, key, project_id, kind, language, files, prepared=prepared
        )
        counts = apply_plan(db, key, plan, sources, actor, job_id=job.id)
        summary = _summary(plan, sources, counts)
        record_audit(
            conn,
            actor,
            "project.import",
            target_type="project",
            target_id=key,
            project_id=project_id,
            details={**summary, "job_id": job.id},
        )
        return {**summary, "warnings": sorted({i.code for i in plan.warnings})}


def _upload_job(job: Job, ctx: JobContext, *, commit: bool) -> dict[str, Any]:
    from ontocurator.exchange.jobs import requester

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
            plan, sources = prepare_plan(
                db, conn, key, project_id, row.kind, row.language, row.files
            )
            if commit:
                if plan.plan_sha256 != row.plan_sha256:
                    raise DomainError(
                        "UPLOAD_STALE", "Project changed since preview; upload again."
                    )
                counts = apply_plan(db, key, plan, sources, actor, job_id=job.id)
                result = _summary(plan, sources, counts)
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

    def commit(self, key: str, upload_id: int, digest: str) -> dict[str, int]:
        with self.db.transaction() as conn:
            project_id = self._project(conn, key)
            row = self._row(conn, project_id, upload_id)
            if row.status != "ready" or row.plan_sha256 != digest:
                raise DomainError(
                    "UPLOAD_STALE", "Upload is not ready or the plan hash changed."
                )
            job_id = self.queue.enqueue(
                "upload_commit",
                {"project": key, "upload_id": upload_id},
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
