"""Explicit re-review of accepted translations and exact source-change causes."""

from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import Connection, insert, select, update

from ontocurator.application.translation_reviews import (
    TranslationReviewRecord,
    TranslationReviewService,
)
from ontocurator.assignments.eligibility import (
    check_variant_assignable,
    load_variants,
)
from ontocurator.assignments.service import Assignment, AssignmentService
from ontocurator.auth.audit import Actor, record_audit
from ontocurator.authz.policy import Access
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.errors import AccessDenied, DomainError, RevisionConflict
from ontocurator.domain.variants import VariantInfo
from ontocurator.domain.work_plans import RowKey
from ontocurator.domain.work_rounds import derive_source_obligations
from ontocurator.jobs.queue import JobQueue
from ontocurator.projects.assignments import revoke_assignments
from ontocurator.storage.database import Database
from ontocurator.storage.plan_tables import DiscardedVariantRow
from ontocurator.storage.tables import (
    AssignmentRow,
    ProjectMembershipRow,
    TranslationReviewDraftRow,
    TranslationReviewRow,
    UserLanguageRow,
    UserRow,
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
                check_plan=False,
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
            self._plan_review(conn, actor, project["id"], variant)
            if existing is not None:
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

    def start_lead_correction(
        self,
        actor: Actor,
        project_key: str,
        document_id: str,
        *,
        expected_text_sha256: str,
        confirm_language: bool = False,
    ) -> Assignment:
        """F1: the lead reviews a rejected or queried version themselves.

        An ordinary translation review assigned to the lead with
        ``lead_correction`` (FD1); only the lead role grants it (FD2), so the
        task-role check is not applied. Submitted only as
        ``accepted_corrected`` (FD4, ``TranslationReviewService.submit``).
        """
        if actor.user_id is None:
            raise AccessDenied("NOT_ALLOWED", "Only a project lead can do this.")
        lead = actor.user_id
        assignments = AssignmentService(self.db)
        with self.db.transaction() as conn:
            project = assignments._prepare(conn, actor, project_key, lead)
            pid = project["id"]
            if "lead" not in set(
                conn.execute(
                    select(ProjectMembershipRow.role).where(
                        ProjectMembershipRow.project_id == pid,
                        ProjectMembershipRow.user_id == lead,
                    )
                ).scalars()
            ):
                raise AccessDenied("NOT_ALLOWED", "You may not manage this project.")
            variants = load_variants(conn, pid)
            variant = variants.get(document_id)
            if variant is None:
                raise DomainError("DOCUMENT_NOT_FOUND")
            if variant.text_sha256 != expected_text_sha256:
                raise DomainError("VARIANT_REVIEW_STALE")
            existing = assignments.active_for(
                conn, pid, document_id, lead, "translation_review"
            )
            if existing is not None and existing.lead_correction:
                assignments._locked(conn, existing.id)
                from ontocurator.application.workflow_guards import (
                    require_task_writable,
                )

                require_task_writable(conn, existing.id)
                if existing.status != "submitted":
                    return existing
            self._require_lead_correction_available(conn, pid, variant, variants, lead)
            if existing is not None and existing.status != "submitted":
                # The lead's own ordinary review (as annotator) is still open.
                raise DomainError(
                    "LEAD_CORRECTION_NOT_AVAILABLE", {"reason": "review_open"}
                )
            qualification = conn.execute(
                select(UserRow.qualification).where(UserRow.id == lead)
            ).scalar_one()
            required = check_variant_assignable(
                project, variant, "translation_review", variants.get
            )
            languages = list(
                conn.execute(
                    select(UserLanguageRow.language)
                    .where(UserLanguageRow.user_id == lead)
                    .order_by(UserLanguageRow.language)
                ).scalars()
            )
            mismatch = not set(languages) >= required
            if mismatch and not confirm_language:
                raise DomainError(
                    "LANGUAGE_CONFIRMATION_REQUIRED",
                    {
                        "document_language": variant.language,
                        "user_languages": languages,
                        "required_languages": sorted(required),
                    },
                )
            if not (qualification or "").strip():
                raise DomainError("QUALIFICATION_REQUIRED")
            self._plan_review(conn, actor, pid, variant)
            now = datetime.now(UTC)
            if existing is not None:
                # A submitted earlier review of this lead (also an annotator)
                # holds the one active slot; the correction is a new task.
                revoke_assignments(
                    conn,
                    actor,
                    pid,
                    [dict(assignments._locked(conn, existing.id))],
                    now,
                    reason="lead_correction",
                )
            assignment = assignments._create(
                conn,
                actor,
                project,
                document_id,
                lead,
                "translation_review",
                (variant.language, languages, mismatch, sorted(required)),
                now,
                lead_correction=True,
            )
            record_audit(
                conn,
                actor,
                "translation.lead_correction_started",
                target_type="assignment",
                target_id=assignment.id,
                project_id=pid,
                details={
                    "document_id": document_id,
                    "text_sha256": expected_text_sha256,
                    "assignment_id": assignment.id,
                },
                at=now,
            )
            return assignment

    @staticmethod
    def _require_lead_correction_available(
        conn: Connection,
        project_id: int,
        variant: VariantInfo,
        variants: Mapping[str, VariantInfo],
        lead: int,
    ) -> None:
        """FD3: the newest version of its chain, last decided rejected or
        query, with no open translation review of someone else."""
        decision = conn.execute(
            select(TranslationReviewRow.decision)
            .where(
                TranslationReviewRow.project_id == project_id,
                TranslationReviewRow.document_id == variant.document_id,
            )
            .order_by(TranslationReviewRow.id.desc())
            .limit(1)
        ).scalar_one_or_none()
        reason = None
        if variant.version != max(
            v.version
            for v in variants.values()
            if (v.external_id, v.language) == (variant.external_id, variant.language)
        ):
            reason = "not_newest"
        elif variant.translation_status != "reviewed" or decision not in (
            "rejected",
            "query",
        ):
            reason = "not_rejected_or_queried"
        elif (
            conn.execute(
                select(AssignmentRow.id)
                .where(
                    AssignmentRow.project_id == project_id,
                    AssignmentRow.document_id == variant.document_id,
                    AssignmentRow.task == "translation_review",
                    AssignmentRow.revoked_at.is_(None),
                    AssignmentRow.status != "submitted",
                    AssignmentRow.user_id != lead,
                )
                .limit(1)
            ).first()
            is not None
        ):
            reason = "review_open"
        if reason is not None:
            raise DomainError("LEAD_CORRECTION_NOT_AVAILABLE", {"reason": reason})

    @staticmethod
    def _plan_review(
        conn: Connection, actor: Actor, project_id: int, variant: VariantInfo
    ) -> None:
        """D26: a correction needs Review; turn it on (audited, no consequences).

        A discarded version takes no new work (``NOT_IN_WORK_PLAN``).
        """
        from ontocurator.application.work_plans import turn_review_on

        discarded = conn.execute(
            select(DiscardedVariantRow.document_id).where(
                DiscardedVariantRow.project_id == project_id,
                DiscardedVariantRow.document_id == variant.document_id,
            )
        ).first()
        if discarded is not None:
            raise DomainError("NOT_IN_WORK_PLAN")
        turn_review_on(
            conn, actor, project_id, RowKey(variant.case_id, variant.language)
        )

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
