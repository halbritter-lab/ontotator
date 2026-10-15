"""Import and export jobs of the T1 exchange (T2d Tasks 4 and 5).

Handlers run in a job worker or inline from the CLI. They act for the user
who asked for the job (``jobs.requested_by``) with that user's rights; a job
without a user was asked for by the operator on the command line, who acts as
a system admin (Q5).
"""

from __future__ import annotations

import hashlib
import zipfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
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
from ontocurator.exchange.t1 import (
    ImportCounts,
    ImportedDocument,
    ImportedSet,
    check_importable,
    document_from_unit,
    pin_differences,
    unit_to_proposals,
)
from ontocurator.jobs.queue import Handler, Job, JobContext
from ontocurator.storage.database import Database
from ontocurator.storage.tables import JobRow, StoredFileRow, UserRow

MANIFEST = "manifest.json"
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


@dataclass(frozen=True)
class _Delivery:
    bundle_id: str | None
    manifest_sha256: str | None
    units: list[ontospan.AnnotatedDocument]


def _read_delivery(path: Path, filename: str) -> tuple[_Delivery, list[str]]:
    """The units of a bundle (ZIP) or of a single ``.json`` unit, unvalidated
    against the ontologies; the format itself is checked."""
    report = ontospan.ValidationReport()
    try:
        if filename.lower().endswith(".json"):
            unit = ontospan.load_annotated_document(path.read_bytes(), report=report)
            return _Delivery(None, None, [unit]), _warnings(report)
        manifest, units = ontospan.read_bundle(path, report=report)
    except ontospan.FormatError:
        raise _invalid(report) from None
    with zipfile.ZipFile(path) as archive:
        manifest_bytes = archive.read(MANIFEST)
    return (
        _Delivery(
            manifest.bundle_id, hashlib.sha256(manifest_bytes).hexdigest(), units
        ),
        _warnings(report),
    )


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


def _producers(units: Sequence[ontospan.AnnotatedDocument]) -> list[dict[str, Any]]:
    """The distinct tool actors of the delivery, in order of appearance."""
    producers: list[dict[str, Any]] = []
    for unit in units:
        for actor in unit.annotation_set.actors:
            if actor.kind != "tool":
                continue
            entry = {
                "name": actor.name,
                "version": actor.version,
                "model": actor.model,
                "run_id": actor.run_id,
            }
            if entry not in producers:
                producers.append(entry)
    return producers


def t1_import(job: Job, ctx: JobContext) -> dict[str, Any]:
    """Import a T1 bundle or unit into a project as documents and proposals.

    The payload is ``{project, blob_sha256, filename}``. The whole delivery is
    refused if its layers differ from the project's pins (``PIN_MISMATCH``),
    if a unit cannot be represented, or if a set kind or tool provenance is
    not accepted (Q11, Q33, T7 I3). Audited as ``project.import``.
    """
    db = ctx.db
    project = job.payload["project"]
    blob = job.payload["blob_sha256"]
    filename = job.payload.get("filename") or ""
    actor, access = requester(db, job)
    repo = ScopedRepository(db, access, actor)
    profile = repo.get_task_profile(project)
    pins = repo.project_pins(project)

    delivery, warnings = _read_delivery(db.blobs.path(blob), filename)
    layers = [layer for unit in delivery.units for layer in unit.annotation_set.layers]
    differences = pin_differences(layers, profile, pins)
    if differences:
        raise DomainError("PIN_MISMATCH", {"differences": differences})
    check_importable(delivery.units)
    documents: list[ImportedDocument] = []
    sets: list[ImportedSet] = []
    dropped_basis = 0
    for unit in delivery.units:
        document = document_from_unit(unit)
        documents.append(ImportedDocument(document, unit.document.source_text_sha256))
        aset = unit.annotation_set
        if not aset.annotations:
            continue  # T7 O2: the document only
        proposals = unit_to_proposals(
            unit, profile, document, bundle_id=delivery.bundle_id
        )
        dropped_basis += proposals.dropped_basis
        sets.append(
            ImportedSet(
                document_id=document.document_id,
                bundle_id=delivery.bundle_id,
                manifest_sha256=delivery.manifest_sha256,
                annotation_set_id=aset.annotation_set_id,
                set_kind=aset.set_kind,
                actors=[a.model_dump(mode="json") for a in aset.actors],
                payload=aset.model_dump(mode="json"),
                proposals=proposals,
            )
        )
    # Against the pinned ontologies, once every unit can be represented.
    ontologies: dict[str, ontospan.OntologyView] = {
        ontology_id: ontospan.ObographOntology.load(db.blobs.path(pin.sha256))
        for ontology_id, pin in pins.items()
    }
    warnings = sorted({*warnings, *_validate(delivery.units, ontologies)})
    summary: dict[str, Any] = {}

    def audit(conn: Any, project_id: int, counts: ImportCounts) -> None:
        summary.update(
            {
                "bundle_id": delivery.bundle_id,
                "manifest_sha256": delivery.manifest_sha256,
                "producers": _producers(delivery.units),
                "units": len(delivery.units),
                **counts,
                "dropped_basis": dropped_basis,
            }
        )
        record_audit(
            conn,
            actor,
            "project.import",
            target_type="project",
            target_id=project,
            project_id=project_id,
            details={**summary, "job_id": job.id, "source_sha256": blob},
        )

    repo.add_documents_and_proposals(
        project,
        documents,
        sets,
        source_sha256=blob,
        imported_by=actor.user_id,
        job_id=job.id,
        on_done=audit,
    )
    return {**summary, "warnings": warnings}


HANDLERS: dict[str, Handler] = {"t1_import": t1_import}
