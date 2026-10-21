"""Assigned translation-review drafts and atomic immutable review records."""

from collections.abc import Callable
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime
from typing import Any

from ontospan import TranslationCheck, canonical_text
from pydantic import BaseModel, ConfigDict, ValidationError
from sqlalchemy import Connection, RowMapping, func, insert, select, update

from ontocurator.assignments.service import Assignment, AssignmentService
from ontocurator.auth.audit import Actor, record_audit
from ontocurator.auth.authority import lock_user_authority
from ontocurator.authz.policy import Access, Action, can
from ontocurator.authz.visibility import (
    current_access,
    qualifying_assignment,
    require_document,
)
from ontocurator.domain.errors import DomainError, RevisionConflict
from ontocurator.domain.translation_review import (
    LEAD_CORRECTION_DECISION,
    REVIEW_POLICY,
    ClinicalCategory,
    ReviewDecisionCode,
    ReviewForm,
    check_review,
    next_status,
)
from ontocurator.domain.variants import (
    VariantInfo,
    resolve_translation_lineage,
    translation_review_comparisons,
    variant_document_id,
)
from ontocurator.jobs.queue import JobQueue
from ontocurator.storage.database import Database
from ontocurator.storage.guidelines import current_guideline_version, guideline_facts
from ontocurator.storage.repository import Repository, _lock_id
from ontocurator.storage.tables import (
    AssignmentRow,
    DocumentRow,
    ProjectRow,
    TranslationReviewDraftRow,
    TranslationReviewRow,
    UserLanguageRow,
)


class TranslationReviewRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    project_id: int
    document_id: str
    assignment_id: int
    reviewer_user_id: int
    reviewer_pseudonym: str
    reviewer_qualification: str
    reviewer_languages: list[str]
    decision: ReviewDecisionCode
    clinical_change: bool
    categories: list[ClinicalCategory]
    rationale: str | None
    machine_text_sha256: str
    proposed_text: str
    proposed_text_sha256: str
    status_before: str
    status_after: str
    created_variant_id: str | None
    review_policy: str
    created_at: datetime
    # The guideline version in force at submit (G15); NULL when none was.
    guideline_version: int | None = None
    guideline_withdrawn: bool = False


def with_guideline_withdrawn(
    conn: Connection, project_id: int, records: list[TranslationReviewRecord]
) -> list[TranslationReviewRecord]:
    """``records`` with ``guideline_withdrawn`` set from the stamped versions."""
    if not any(r.guideline_version is not None for r in records):
        return records
    facts = guideline_facts(conn, project_id)
    # The stamp has a foreign key to its version, so every stamp has a fact.
    return [
        r
        if r.guideline_version is None
        else r.model_copy(
            update={"guideline_withdrawn": facts[r.guideline_version].withdrawn}
        )
        for r in records
    ]


def failed_translation_checks(
    translation: dict[str, Any] | None,
) -> list[TranslationCheck]:
    """Failed automatic checks of a translation run (spec A.7).

    The review workspace lists them; My tasks shows their count.
    """
    checks = (translation or {}).get("checks", [])
    return [
        check
        for check in (TranslationCheck.model_validate(c) for c in checks)
        if not check.passed
    ]


@dataclass(frozen=True)
class ReviewText:
    variant: VariantInfo
    text: str


@dataclass(frozen=True)
class ReviewDraft:
    text: str
    form: dict[str, Any]
    revision: int


@dataclass(frozen=True)
class ReviewWorkspace:
    assignment: Assignment
    variant: VariantInfo
    translation_ancestor: VariantInfo
    text: str
    source: ReviewText
    comparisons: list[ReviewText]
    failed_checks: list[TranslationCheck]
    draft: ReviewDraft
    qualification: str | None
    previous_reviews: list[TranslationReviewRecord]
    read_only: bool
    submitted_record: TranslationReviewRecord | None
    # FD1: the lead reviews this version themselves (accepted_corrected only).
    lead_correction: bool = False


class TranslationReviewService:
    def __init__(
        self,
        db: Database,
        jobs: JobQueue,
        *,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self.db, self.jobs, self._now = db, jobs, now

    def _authority(
        self,
        conn: Connection,
        access: Access,
        assignment_id: int,
        *,
        structural: bool = False,
    ) -> tuple[Assignment, int, RowMapping]:
        located = conn.execute(
            select(ProjectRow.project_key)
            .join(AssignmentRow, AssignmentRow.project_id == ProjectRow.id)
            .where(
                AssignmentRow.id == assignment_id,
                AssignmentRow.user_id == access.user_id,
                AssignmentRow.task == "translation_review",
                AssignmentRow.revoked_at.is_(None),
            )
        ).scalar_one_or_none()
        if located is None:
            raise DomainError("ASSIGNMENT_NOT_FOUND")
        if structural:
            conn.execute(select(func.pg_advisory_xact_lock(_lock_id("import"))))
        conn.execute(
            select(func.pg_advisory_xact_lock_shared(_lock_id("members", located)))
        )
        lock = (
            func.pg_advisory_xact_lock
            if structural
            else func.pg_advisory_xact_lock_shared
        )
        conn.execute(select(lock(_lock_id("project", located))))
        user = lock_user_authority(conn, access.user_id)
        # Shared central SQL policy rechecks account/current role after all waits.
        valid = conn.execute(
            select(AssignmentRow.project_id)
            .where(
                AssignmentRow.id == assignment_id,
                AssignmentRow.task == "translation_review",
                qualifying_assignment(access.user_id),
            )
            .with_for_update(key_share=True)
        ).scalar_one_or_none()
        if valid is None:
            raise DomainError("ASSIGNMENT_NOT_FOUND")
        assignment = AssignmentService._get(conn, assignment_id)
        return assignment, valid, user

    def _context(
        self, assignment: Assignment
    ) -> tuple[VariantInfo, VariantInfo, VariantInfo, dict[str, VariantInfo]]:
        variants = {
            v.document_id: v
            for v in Repository(self.db)._variants(assignment.project_key)
        }
        variant = variants.get(assignment.document_id)
        if variant is None:
            raise DomainError("DOCUMENT_NOT_FOUND")
        ancestor, source = resolve_translation_lineage(variant, variants.get)
        return variant, ancestor, source, variants

    @staticmethod
    def _text(conn: Connection, project_id: int, variant: VariantInfo) -> str:
        import hashlib

        text = conn.execute(
            select(DocumentRow.text).where(
                DocumentRow.project_id == project_id,
                DocumentRow.document_id == variant.document_id,
            )
        ).scalar_one()
        if hashlib.sha256(text.encode("utf-8")).hexdigest() != variant.text_sha256:
            raise DomainError(
                "VARIANT_SOURCE_UNKNOWN", "Immutable variant hash mismatch"
            )
        return text

    @staticmethod
    def _editable(assignment: Assignment) -> None:
        if assignment.held:
            raise DomainError(
                "TASK_HELD",
                {"reason": assignment.hold_reason, "assignment_id": assignment.id},
            )
        if assignment.status == "submitted":
            raise DomainError("ASSIGNMENT_SUBMITTED")

    def _draft(
        self,
        conn: Connection,
        assignment: Assignment,
        project_id: int,
        variant: VariantInfo,
    ) -> ReviewDraft:
        row = (
            conn.execute(
                select(TranslationReviewDraftRow)
                .where(TranslationReviewDraftRow.assignment_id == assignment.id)
                .with_for_update()
            )
            .mappings()
            .one_or_none()
        )
        if row is None:
            text = self._text(conn, project_id, variant)
            conn.execute(
                insert(TranslationReviewDraftRow).values(
                    assignment_id=assignment.id,
                    text=text,
                    form={},
                    revision=0,
                    updated_at=self._now(),
                    updated_by=assignment.user_id,
                )
            )
            return ReviewDraft(text, {}, 0)
        return ReviewDraft(row["text"], row["form"], row["revision"])

    def _records(
        self,
        conn: Connection,
        access: Access,
        key: str,
        project_id: int,
        document_id: str,
    ) -> list[TranslationReviewRecord]:
        fresh = current_access(conn, access, project_id, key)
        require_document(conn, fresh, project_id, key, document_id)
        baseline_hash = conn.execute(
            select(DocumentRow.text_sha256).where(
                DocumentRow.project_id == project_id,
                DocumentRow.document_id == document_id,
            )
        ).scalar_one_or_none()
        if baseline_hash is None:
            raise DomainError("DOCUMENT_NOT_FOUND")
        query = select(TranslationReviewRow).where(
            TranslationReviewRow.project_id == project_id,
            TranslationReviewRow.document_id == document_id,
        )
        if not can(fresh, Action.VIEW_ALL_DOCUMENTS, key):
            query = query.where(TranslationReviewRow.reviewer_user_id == fresh.user_id)
        records = with_guideline_withdrawn(
            conn,
            project_id,
            [
                TranslationReviewRecord.model_validate(r)
                for r in conn.execute(
                    query.order_by(TranslationReviewRow.id)
                ).mappings()
            ],
        )
        if any(r.machine_text_sha256 != baseline_hash for r in records):
            raise DomainError("VARIANT_SOURCE_UNKNOWN", "Review baseline hash mismatch")
        return records

    def open(self, access: Access, assignment_id: int) -> ReviewWorkspace:
        with self.db.transaction() as conn:
            assignment, pid, user = self._authority(conn, access, assignment_id)
            variant, ancestor, source, variants = self._context(assignment)
            submitted = None
            if assignment.status == "submitted":
                records = (
                    conn.execute(
                        select(TranslationReviewRow).where(
                            TranslationReviewRow.assignment_id == assignment.id,
                            TranslationReviewRow.project_id == pid,
                            TranslationReviewRow.document_id == variant.document_id,
                        )
                    )
                    .mappings()
                    .all()
                )
                submitted = next(
                    (
                        TranslationReviewRecord.model_validate(r)
                        for r in records
                        if f"tr-{r['id']}" == assignment.last_submission_id
                    ),
                    None,
                )
                if (
                    submitted is None
                    or submitted.machine_text_sha256 != variant.text_sha256
                ):
                    raise DomainError("ASSIGNMENT_NOT_FOUND")
                (submitted,) = with_guideline_withdrawn(conn, pid, [submitted])
                row = conn.execute(
                    select(TranslationReviewDraftRow.revision).where(
                        TranslationReviewDraftRow.assignment_id == assignment.id
                    )
                ).scalar_one_or_none()
                draft = ReviewDraft(
                    submitted.proposed_text,
                    {
                        "decision": submitted.decision,
                        "clinical_change": submitted.clinical_change,
                        "categories": submitted.categories,
                        "rationale": submitted.rationale,
                    },
                    row or 0,
                )
            else:
                draft = self._draft(conn, assignment, pid, variant)
            comparisons = translation_review_comparisons(
                variant, ancestor, variants.values()
            )
            texts = conn.execute(
                select(DocumentRow.document_id, DocumentRow.text).where(
                    DocumentRow.project_id == pid,
                    DocumentRow.document_id.in_([v.document_id for v in comparisons]),
                )
            ).all()
            by_id = {document_id: text for document_id, text in texts}
            return ReviewWorkspace(
                assignment,
                variant,
                ancestor,
                self._text(conn, pid, variant),
                ReviewText(source, self._text(conn, pid, source)),
                [ReviewText(v, by_id[v.document_id]) for v in comparisons],
                failed_translation_checks(ancestor.translation),
                draft,
                user["qualification"],
                self._records(
                    conn, access, assignment.project_key, pid, variant.document_id
                ),
                assignment.status == "submitted" or assignment.held,
                submitted,
                assignment.lead_correction,
            )

    def save_draft(
        self,
        access: Access,
        assignment_id: int,
        *,
        expected_revision: int,
        text: str,
        form: dict[str, Any],
    ) -> int:
        with self.db.transaction() as conn:
            assignment, pid, _ = self._authority(conn, access, assignment_id)
            self._editable(assignment)
            variant, _, _, _ = self._context(assignment)
            draft = self._draft(conn, assignment, pid, variant)
            if draft.revision != expected_revision:
                raise RevisionConflict()
            revision = draft.revision + 1
            now = self._now()
            conn.execute(
                update(TranslationReviewDraftRow)
                .where(TranslationReviewDraftRow.assignment_id == assignment.id)
                .values(
                    text=text,
                    form=form,
                    revision=revision,
                    updated_at=now,
                    updated_by=access.user_id,
                )
            )
            conn.execute(
                update(AssignmentRow)
                .where(AssignmentRow.id == assignment.id)
                .values(
                    status="in_progress"
                    if assignment.status == "open"
                    else assignment.status,
                    updated_at=now,
                )
            )
            return revision

    def submit(
        self, access: Access, assignment_id: int, *, expected_revision: int
    ) -> TranslationReviewRecord:
        import hashlib

        with self.db.transaction() as conn:
            assignment, pid, user = self._authority(
                conn, access, assignment_id, structural=True
            )
            self._editable(assignment)
            variant, _, _, variants = self._context(assignment)
            draft = self._draft(conn, assignment, pid, variant)
            if draft.revision != expected_revision:
                raise RevisionConflict()
            if not (user["qualification"] or "").strip():
                raise DomainError("QUALIFICATION_REQUIRED")
            machine = self._text(conn, pid, variant)
            try:
                form = ReviewForm.model_validate(draft.form)
            except ValidationError as exc:
                raise DomainError(
                    "REVIEW_INVALID",
                    {
                        "issues": ["FORM_INVALID"],
                        "fields": [".".join(map(str, e["loc"])) for e in exc.errors()],
                    },
                ) from None
            if assignment.lead_correction and form.decision != "accepted_corrected":
                raise DomainError(
                    "REVIEW_INVALID", {"issues": [LEAD_CORRECTION_DECISION]}
                )
            issues = check_review(form, machine_text=machine, proposed_text=draft.text)
            if issues:
                raise DomainError("REVIEW_INVALID", {"issues": issues})
            before = variant.translation_status
            assert before is not None
            after, child_status = next_status(form.decision)
            child = None
            if child_status:
                latest = max(
                    v.version
                    for v in variants.values()
                    if (v.external_id, v.language)
                    == (variant.external_id, variant.language)
                )
                if latest != variant.version:
                    raise DomainError("VARIANT_REVIEW_STALE")
                child = replace(
                    variant,
                    document_id=variant_document_id(
                        variant.external_id, variant.language, latest + 1, set(variants)
                    ),
                    version=latest + 1,
                    origin="correction",
                    derived_from=variant.document_id,
                    translation=None,
                    translation_status=child_status,
                )
            proposed = canonical_text(draft.text)
            sha = hashlib.sha256(proposed.encode("utf-8")).hexdigest()
            languages = list(
                conn.execute(
                    select(UserLanguageRow.language)
                    .where(UserLanguageRow.user_id == access.user_id)
                    .order_by(UserLanguageRow.language)
                ).scalars()
            )
            now = self._now()
            values = dict(
                project_id=pid,
                document_id=variant.document_id,
                assignment_id=assignment.id,
                reviewer_user_id=access.user_id,
                reviewer_pseudonym=user["pseudonym"],
                reviewer_qualification=user["qualification"],
                reviewer_languages=languages,
                decision=form.decision,
                clinical_change=form.clinical_change,
                categories=sorted(set(form.categories)),
                rationale=form.rationale,
                machine_text_sha256=variant.text_sha256,
                proposed_text=proposed,
                proposed_text_sha256=sha,
                status_before=before,
                status_after=after,
                created_variant_id=child.document_id if child else None,
                review_policy=REVIEW_POLICY,
                created_at=now,
                guideline_version=current_guideline_version(conn, pid),
            )
            record_id = conn.execute(
                insert(TranslationReviewRow)
                .values(**values)
                .returning(TranslationReviewRow.id)
            ).scalar_one()
            if child:
                metadata = asdict(child)
                metadata.update(
                    text_sha256=sha, status_reason=f"translation review {record_id}"
                )
                conn.execute(
                    insert(DocumentRow).values(
                        project_id=pid, text=proposed, **metadata
                    )
                )
            conn.execute(
                update(DocumentRow)
                .where(
                    DocumentRow.project_id == pid,
                    DocumentRow.document_id == variant.document_id,
                )
                .values(translation_status=after)
            )
            conn.execute(
                update(TranslationReviewDraftRow)
                .where(TranslationReviewDraftRow.assignment_id == assignment.id)
                .values(
                    revision=draft.revision + 1,
                    updated_at=now,
                    updated_by=access.user_id,
                )
            )
            conn.execute(
                update(AssignmentRow)
                .where(AssignmentRow.id == assignment.id)
                .values(
                    status="submitted",
                    last_submission_id=f"tr-{record_id}",
                    updated_at=now,
                )
            )
            if assignment.active_round_id is not None:
                from ontocurator.storage.workflow_tables import WorkRoundStateRow

                conn.execute(
                    update(WorkRoundStateRow)
                    .where(WorkRoundStateRow.round_id == assignment.active_round_id)
                    .values(
                        state="submitted",
                        latest_submission_id=f"tr-{record_id}",
                        revision=WorkRoundStateRow.revision + 1,
                    )
                )
            record_audit(
                conn,
                Actor.user(access.user_id, user["username"]),
                "translation.review",
                target_type="document",
                target_id=variant.document_id,
                project_id=pid,
                details={
                    "document_id": variant.document_id,
                    "decision": form.decision,
                    "status_before": before,
                    "status_after": after,
                    "created_variant_id": child.document_id if child else None,
                },
                at=now,
            )
            if child:
                from ontocurator.exchange.reanchor_job import enqueue_review_pair

                enqueue_review_pair(
                    self.jobs,
                    assignment.project_key,
                    pid,
                    variant.document_id,
                    child.document_id,
                    record_id,
                    Actor.user(access.user_id, user["username"]),
                )
            return TranslationReviewRecord(id=record_id, **values)

    def records(
        self, access: Access, project: str, document_id: str
    ) -> list[TranslationReviewRecord]:
        with self.db.transaction() as conn:
            conn.execute(
                select(func.pg_advisory_xact_lock_shared(_lock_id("members", project)))
            )
            conn.execute(
                select(func.pg_advisory_xact_lock_shared(_lock_id("project", project)))
            )
            lock_user_authority(conn, access.user_id)
            pid = Repository._project_id(conn, project)
            if pid is None:
                raise DomainError("PROJECT_NOT_FOUND")
            return self._records(conn, access, project, pid, document_id)
