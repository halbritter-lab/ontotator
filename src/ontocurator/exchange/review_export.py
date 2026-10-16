"""Generic review JSONL, with exact reviewed identity and inherited run context."""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping, Sequence
from datetime import UTC
from typing import Any

import ontospan
from sqlalchemy import func, select

from ontocurator.application.translation_reviews import TranslationReviewRecord
from ontocurator.auth.audit import Actor, record_audit
from ontocurator.authz.policy import Action
from ontocurator.authz.project_authority import require_project_management
from ontocurator.domain.errors import DomainError
from ontocurator.domain.variants import VariantInfo, resolve_translation_lineage
from ontocurator.jobs.queue import Job, JobContext
from ontocurator.storage.repository import Repository, _lock_id
from ontocurator.storage.tables import JobRow, ProjectRow, TranslationReviewRow

_SHA = re.compile(r"[0-9a-f]{64}")


def _invalid() -> DomainError:
    return DomainError(
        "VARIANT_SOURCE_UNKNOWN", "Invalid immutable review export context"
    )


def _hash(value: str) -> str:
    if not _SHA.fullmatch(value):
        raise _invalid()
    return value


def _translation(value: dict[str, Any] | None) -> dict[str, Any] | None:
    if value is None:
        return None
    run = ontospan.Translation.model_validate(value)
    return dict(
        provider=run.provider,
        model=run.model,
        run_id=run.run_id,
        recipe=run.recipe,
        checks=[
            dict(code=c.code, passed=c.passed, detail=c.detail) for c in run.checks
        ],
    )


def serialize_review_export(
    project: str,
    project_id: int,
    records: Sequence[TranslationReviewRecord],
    variants: Mapping[str, VariantInfo],
) -> bytes:
    """Serialize historical records; no current user/profile/status substitution.

    reviewed_variant.translation projects the translation ancestor's run context,
    while every other reviewed identity/hash remains that of the reviewed text.
    This export-only projection never changes stored or T1 correction metadata.
    """
    lines = []
    seen = set()
    for record in sorted(records, key=lambda r: r.id):
        variant = variants.get(record.document_id)
        if record.project_id != project_id or variant is None or record.id in seen:
            raise _invalid()
        seen.add(record.id)
        ancestor, source = resolve_translation_lineage(variant, variants.get)
        if _hash(record.machine_text_sha256) != _hash(variant.text_sha256):
            raise _invalid()
        if (
            _hash(record.proposed_text_sha256)
            != hashlib.sha256(record.proposed_text.encode("utf-8")).hexdigest()
        ):
            raise _invalid()
        created = None
        if record.created_variant_id is not None:
            child = variants.get(record.created_variant_id)
            if (
                child is None
                or record.decision != "accepted_corrected"
                or (
                    child.case_id,
                    child.external_id,
                    child.language,
                    child.version,
                    child.origin,
                    child.derived_from,
                    child.translation,
                    child.text_sha256,
                )
                != (
                    variant.case_id,
                    variant.external_id,
                    variant.language,
                    variant.version + 1,
                    "correction",
                    variant.document_id,
                    None,
                    record.proposed_text_sha256,
                )
            ):
                raise _invalid()
            created = dict(
                document_id=child.external_id,
                version=child.version,
                text_sha256=_hash(child.text_sha256),
            )
        elif record.decision == "accepted_corrected":
            raise _invalid()
        if record.created_at.utcoffset() is None:
            raise _invalid()
        row = dict(
            format="ontocurator-translation-review/v1",
            review_id=record.id,
            project=project,
            case_id=variant.case_id,
            reviewed_variant=dict(
                document_id=variant.external_id,
                language=variant.language,
                version=variant.version,
                origin=variant.origin,
                text_sha256=_hash(variant.text_sha256),
                translation=_translation(ancestor.translation),
            ),
            source_variant=dict(
                document_id=source.external_id,
                language=source.language,
                version=source.version,
                text_sha256=_hash(source.text_sha256),
            ),
            reviewer=dict(
                pseudonym=record.reviewer_pseudonym,
                qualification=record.reviewer_qualification,
                languages=record.reviewer_languages,
            ),
            decision=record.decision,
            clinical_change=record.clinical_change,
            categories=record.categories,
            rationale=record.rationale,
            machine_text_sha256=record.machine_text_sha256,
            proposed_text=record.proposed_text,
            proposed_text_sha256=record.proposed_text_sha256,
            created_variant=created,
            status_before=record.status_before,
            status_after=record.status_after,
            review_policy=record.review_policy,
            reviewed_at=record.created_at.astimezone(UTC).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            ),
        )
        lines.append(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
    return "".join(lines).encode("utf-8")


def translation_review_export(job: Job, ctx: JobContext) -> dict[str, Any]:
    """Authorize the persisted requester and prepare one atomic export artifact.

    Project SH excludes structural review/import writes during the complete read,
    stored-file metadata and audit transaction. Queue outcome is recorded by its
    existing finish transaction; orphan filesystem bytes alone grant no download.
    """
    from ontocurator.exchange.jobs import store_file

    db = ctx.db
    with db.transaction() as conn:
        row = conn.execute(
            select(
                JobRow.project_id,
                JobRow.payload,
                JobRow.kind,
                JobRow.requested_by,
                JobRow.requested_label,
                ProjectRow.project_key,
            )
            .join(ProjectRow, ProjectRow.id == JobRow.project_id)
            .where(JobRow.id == job.id)
        ).one_or_none()
        if (
            row is None
            or row.kind != "translation_review_export"
            or row.project_id != job.project_id
            or row.payload != job.payload
            or row.payload != {"project": row.project_key}
        ):
            raise DomainError("PROJECT_NOT_FOUND")
        key, pid = row.project_key, row.project_id
        conn.execute(
            select(func.pg_advisory_xact_lock_shared(_lock_id("members", key)))
        )
        conn.execute(
            select(func.pg_advisory_xact_lock_shared(_lock_id("project", key)))
        )
        actor = Actor(row.requested_by, row.requested_label)
        if actor.user_id is None and not actor.label.startswith("cli:"):
            raise DomainError(
                "NOT_ALLOWED",
                "Only the explicit CLI operator may export without a user",
            )
        require_project_management(conn, actor, key, pid, Action.EXPORT_ALL_WORK)
        variants = {v.document_id: v for v in Repository(db)._variants(key)}
        records = [
            TranslationReviewRecord.model_validate(r)
            for r in conn.execute(
                select(TranslationReviewRow)
                .where(TranslationReviewRow.project_id == pid)
                .order_by(TranslationReviewRow.id)
            ).mappings()
        ]
        data = serialize_review_export(key, pid, records, variants)
        sha = store_file(db, data)
        result = {"sha256": sha, "reviews": len(records)}
        record_audit(
            conn,
            actor,
            "project.translation_review_export",
            target_type="project",
            target_id=key,
            project_id=pid,
            details={**result, "job_id": job.id},
        )
        return result
