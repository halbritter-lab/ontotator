"""Explicit re-review of accepted translations and exact source-change causes."""

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import insert, select, update

from ontocurator.application.translation_reviews import (
    TranslationReviewRecord,
    TranslationReviewService,
)
from ontocurator.assignments.eligibility import load_variants
from ontocurator.assignments.service import Assignment, AssignmentService
from ontocurator.auth.audit import Actor, record_audit
from ontocurator.authz.policy import Access
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.errors import DomainError, RevisionConflict
from ontocurator.domain.work_rounds import derive_source_obligations
from ontocurator.jobs.queue import JobQueue
from ontocurator.storage.database import Database
from ontocurator.storage.tables import (
    AssignmentRow,
    TranslationReviewDraftRow,
)
from ontocurator.storage.workflow_tables import (
    ReviewObligationResolutionRow,
    WorkRoundRow,
    WorkRoundStateRow,
)


class TranslationWorkflowService:
    def __init__(self, db: Database, jobs: JobQueue):
        self.db = db
        self.reviews = TranslationReviewService(db, jobs)

    def assign_correction(
        self,
        actor: Actor,
        project_key: str,
        document_id: str,
        username: str,
        *,
        expected_text_sha256: str,
        reason: str,
        confirm_language: bool = False,
    ) -> Assignment:
        if not reason.strip():
            raise DomainError("ROUND_REASON_REQUIRED")
        assignments = AssignmentService(self.db)
        with self.db.transaction() as conn:
            target = assignments._target(conn, username)
            project = assignments._prepare(conn, actor, project_key, target)
            variants = load_variants(conn, project["id"])
            variant = variants.get(document_id)
            if variant is None:
                raise DomainError("DOCUMENT_NOT_FOUND")
            if variant.text_sha256 != expected_text_sha256 or any(
                v.derived_from == document_id and v.origin == "correction"
                for v in variants.values()
            ):
                raise DomainError("VARIANT_REVIEW_STALE")
            if variant.translation_status != "accepted":
                raise DomainError("TRANSLATION_NOT_ACCEPTED")
            eligibility = assignments.check_assignable(
                conn,
                project,
                document_id,
                target,
                "translation_review",
                confirm_language,
                variants=variants,
                allow_accepted_translation_review=True,
            )
            existing = assignments.active_for(
                conn, project["id"], document_id, target, "translation_review"
            )
            now = datetime.now(UTC)
            if existing is not None:
                assignments._locked(conn, existing.id)
                from ontocurator.application.workflow_guards import (
                    require_task_writable,
                )

                require_task_writable(conn, existing.id)
                if existing.status != "submitted":
                    return existing
                assignment = existing
                conn.execute(
                    update(TranslationReviewDraftRow)
                    .where(TranslationReviewDraftRow.assignment_id == assignment.id)
                    .values(
                        text=self.reviews._text(conn, project["id"], variant),
                        form={},
                        revision=TranslationReviewDraftRow.revision + 1,
                        updated_at=now,
                        updated_by=target,
                    )
                )
            else:
                assignment = assignments._create(
                    conn,
                    actor,
                    project,
                    document_id,
                    target,
                    "translation_review",
                    eligibility,
                    now,
                )
            rid = f"round-{uuid4().hex}"
            prior = assignment.active_round_id
            if prior:
                conn.execute(
                    update(WorkRoundStateRow)
                    .where(WorkRoundStateRow.round_id == prior)
                    .values(state="superseded", revision=WorkRoundStateRow.revision + 1)
                )
            conn.execute(
                insert(WorkRoundRow).values(
                    round_id=rid,
                    project_id=project["id"],
                    assignment_id=assignment.id,
                    document_id=document_id,
                    annotator_id=assignment.pseudonym,
                    kind="clean_restart" if prior else "ordinary",
                    mode=None,
                    predecessor_round_id=prior,
                    input_manifest_sha256=canonical_hash([]),
                    input_submission_ids=[],
                    workspace_key=None,
                    created_by=actor.user_id,
                    created_at=now,
                )
            )
            conn.execute(
                insert(WorkRoundStateRow).values(
                    round_id=rid, state="editable", revision=1
                )
            )
            conn.execute(
                update(AssignmentRow)
                .where(AssignmentRow.id == assignment.id)
                .values(
                    status="reopened" if existing else "open",
                    active_round_id=rid,
                    last_submission_id=None,
                    workflow_revision=assignment.workflow_revision + 1,
                    updated_at=now,
                )
            )
            record_audit(
                conn,
                actor,
                "translation.correction_requested",
                target_type="assignment",
                target_id=assignment.id,
                project_id=project["id"],
                details={
                    "reason": reason.strip(),
                    "document_id": document_id,
                    "text_sha256": expected_text_sha256,
                    "round_id": rid,
                },
            )
            return assignments._get(conn, assignment.id)

    def obligations(self, access: Access, assignment_id: int) -> list[dict[str, Any]]:
        with self.db.transaction() as conn:
            assignment, pid, _ = self.reviews._authority(conn, access, assignment_id)
            variants = load_variants(conn, pid)
            resolved = set(
                conn.execute(
                    select(ReviewObligationResolutionRow.cause_id).where(
                        ReviewObligationResolutionRow.project_id == pid
                    )
                ).scalars()
            )
            return [
                {
                    **cause.model_dump(),
                    "old_source_text": self.reviews._text(
                        conn, pid, variants[cause.old_source_document_id]
                    ),
                    "new_source_text": self.reviews._text(
                        conn, pid, variants[cause.new_source_document_id]
                    ),
                }
                for cause in derive_source_obligations(
                    assignment.project_key, variants.values(), resolved
                )
                if cause.document_id == assignment.document_id
            ]

    def resolve(
        self,
        access: Access,
        assignment_id: int,
        cause_id: str,
        *,
        expected_revision: int,
        translation_text_sha256: str,
        old_source_text_sha256: str,
        new_source_text_sha256: str,
    ) -> TranslationReviewRecord:
        with self.db.transaction() as conn:
            assignment, pid, user = self.reviews._authority(
                conn, access, assignment_id, structural=True
            )
            cause = next(
                (
                    item
                    for item in self.obligations(access, assignment_id)
                    if item["cause_id"] == cause_id
                ),
                None,
            )
            if cause is None or any(
                cause[name] != value
                for name, value in {
                    "translation_text_sha256": translation_text_sha256,
                    "old_source_text_sha256": old_source_text_sha256,
                    "new_source_text_sha256": new_source_text_sha256,
                }.items()
            ):
                raise RevisionConflict(
                    "The source obligation changed; review it again."
                )
            draft = conn.execute(
                select(TranslationReviewDraftRow.form).where(
                    TranslationReviewDraftRow.assignment_id == assignment_id
                )
            ).scalar_one_or_none()
            if not draft or draft.get("decision") not in {
                "accepted_unchanged",
                "accepted_corrected",
            }:
                raise DomainError(
                    "REVIEW_INVALID",
                    "Accept unchanged or corrected to resolve this source change.",
                )
            record = self.reviews.submit(
                access, assignment_id, expected_revision=expected_revision
            )
            causes = [cause_id]
            if record.created_variant_id:
                for inherited in derive_source_obligations(
                    assignment.project_key, load_variants(conn, pid).values(), set()
                ):
                    if (
                        inherited.document_id == record.created_variant_id
                        and inherited.old_source_document_id
                        == cause["old_source_document_id"]
                        and inherited.new_source_document_id
                        == cause["new_source_document_id"]
                    ):
                        causes.append(inherited.cause_id)
            for resolved_id in causes:
                conn.execute(
                    insert(ReviewObligationResolutionRow).values(
                        project_id=pid,
                        cause_id=resolved_id,
                        resolved_by=access.user_id,
                        created_at=datetime.now(UTC),
                        payload={
                            "cause": {
                                k: v
                                for k, v in cause.items()
                                if not k.endswith("_text")
                            },
                            "review_id": record.id,
                            "decision": record.decision,
                            "created_variant_id": record.created_variant_id,
                        },
                    )
                )
            record_audit(
                conn,
                Actor.user(access.user_id, user["username"]),
                "translation.source_reviewed",
                target_type="document",
                target_id=assignment.document_id,
                project_id=pid,
                details={
                    "cause_id": cause_id,
                    "review_id": record.id,
                    "decision": record.decision,
                },
            )
            return record
