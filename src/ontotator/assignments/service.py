"""Transactional assignment administration; drafts and submissions stay untouched.

Administrative writes acquire members SHARED -> project EXCLUSIVE -> sorted
actor SHARE / target NO KEY UPDATE -> assignment NO KEY UPDATE. Membership
writes take members EXCLUSIVE, and settings/imports share the project lock.
Ordinary document commands must take compatible advisory locks before their
draft/assignment rows; they need not serialize on this administrative mutex.
"""

from __future__ import annotations

from builtins import list as List
from collections import Counter
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal, cast

from pydantic import ValidationError
from sqlalchemy import (
    Connection,
    RowMapping,
    Select,
    case,
    func,
    insert,
    select,
    update,
)

from ontotator.assignments.eligibility import (
    annotation_waits,
    check_variant_assignable,
    check_work_plan,
    conflicting_tasks,
    load_variants,
    open_review_rows,
    reads_all,
    translation_context,
)
from ontotator.auth.accounts import normalize_username
from ontotator.auth.audit import Actor, record_audit
from ontotator.authz.memberships import grant_lead_self_role
from ontotator.authz.policy import (
    ADMINISTRATION_TASKS,
    TASK_ROLES,
    Access,
    Action,
    Role,
    Task,
    can,
    may_take,
)
from ontotator.authz.project_authority import require_project_management
from ontotator.domain.annotation_modes import AnnotationMode, workspace_mode
from ontotator.domain.errors import DomainError
from ontotator.domain.next_steps import translations_accepted
from ontotator.domain.variants import VariantInfo
from ontotator.domain.work_plans import RowKey
from ontotator.domain.workspace import WorkspaceMode
from ontotator.projects.assignments import revoke_assignments
from ontotator.storage.database import Database
from ontotator.storage.plan_tables import DiscardedVariantRow
from ontotator.storage.repository import _lock_id
from ontotator.storage.tables import (
    AssignmentRow,
    AuditEventRow,
    DocumentRow,
    ProjectMembershipRow,
    ProjectRow,
    UserLanguageRow,
    UserRow,
)

TASK_FOR_MODE: dict[WorkspaceMode, Task] = {
    "independent": "annotate",
    "review": "review",
    "proposal_check": "annotate",
}
AssignmentStatus = Literal["open", "in_progress", "submitted", "reopened"]


@dataclass(frozen=True)
class Assignment:
    id: int
    project_key: str
    document_id: str
    user_id: int
    username: str
    pseudonym: str
    task: Task
    status: AssignmentStatus
    created_at: datetime
    updated_at: datetime
    revoked_at: datetime | None
    last_submission_id: str | None
    external_id: str | None = None
    active_round_id: str | None = None
    workflow_revision: int = 0
    held: bool = False
    hold_reason: str | None = None
    # FD1: the lead's own translation review of a rejected or queried version.
    lead_correction: bool = False
    # Fixed at creation for task ``annotate`` (plan P3); None for other tasks.
    annotation_mode: AnnotationMode | None = None


@dataclass(frozen=True)
class TaskSummary:
    assignment_id: int
    project_key: str
    project_name: str
    document_id: str
    language: str
    task: Task
    status: AssignmentStatus
    updated_at: datetime
    external_id: str | None = None
    active_round_id: str | None = None
    workflow_revision: int = 0
    held: bool = False
    hold_reason: str | None = None
    source_language: str | None = None
    target_language: str | None = None
    # The text label's case ID (spec "Text label"), and the version and its
    # origin ("v2 corrected", R-11).
    case_id: str | None = None
    version: int | None = None
    origin: str | None = None
    # Spec A.7: failed automatic checks of the reviewed variant's translation run
    # (the list ReviewWorkspace.failed_checks shows); None for other tasks.
    failed_check_count: int | None = None
    # Spec 2026-10-23 §2: the assignment date and the annotation mode fixed
    # at assignment time (annotate only).
    assigned_at: datetime | None = None
    annotation_mode: AnnotationMode | None = None
    # A reopened task: when and why the lead reopened it (the latest
    # ``assignment.reopen`` audit event); None for other statuses.
    reopened_at: datetime | None = None
    reopen_reason: str | None = None
    # An open consolidation: the lead's reason from the start command (#146);
    # None without one and for other tasks.
    consolidation_reason: str | None = None
    # R-26: a lead answered one of the owner's reports on this task since the
    # owner last opened it.
    report_answered: bool = False
    # The answered report to open (the latest answered one), for the
    # "Answer to your report" link.
    answered_report_id: str | None = None
    # Issue 213: an annotation task that opens once the translation review of
    # its version is accepted; not startable until then.
    waiting_for_translation_review: bool = False


def _assignments() -> Select[tuple[object, ...]]:
    return (
        select(
            AssignmentRow.id,
            ProjectRow.project_key,
            AssignmentRow.document_id,
            AssignmentRow.user_id,
            UserRow.username,
            UserRow.pseudonym,
            AssignmentRow.task,
            AssignmentRow.status,
            AssignmentRow.created_at,
            AssignmentRow.updated_at,
            AssignmentRow.revoked_at,
            AssignmentRow.last_submission_id,
            AssignmentRow.active_round_id,
            AssignmentRow.workflow_revision,
            AssignmentRow.held,
            AssignmentRow.hold_reason,
            AssignmentRow.lead_correction,
            AssignmentRow.annotation_mode,
            DocumentRow.external_id,
        )
        .join(ProjectRow, ProjectRow.id == AssignmentRow.project_id)
        .join(UserRow, UserRow.id == AssignmentRow.user_id)
        .join(
            DocumentRow,
            (DocumentRow.project_id == AssignmentRow.project_id)
            & (DocumentRow.document_id == AssignmentRow.document_id),
        )
    )


def _assignment(row: RowMapping) -> Assignment:
    return Assignment(**row)


ReviewReason = Literal["source_changed"]


def held_annotations(
    conn: Connection, project_id: int, document_ids: Iterable[str]
) -> Counter[str]:
    """Annotate assignments that fill a version's "annotations per text" slots:
    not revoked, or revoked with submitted work (that submission is an
    annotation of the version). The one count for ``_assign_locked`` and the
    batch planner."""
    wanted = list(document_ids)
    if not wanted:
        return Counter()
    return Counter(
        dict(
            conn.execute(
                select(AssignmentRow.document_id, func.count())
                .where(
                    AssignmentRow.project_id == project_id,
                    AssignmentRow.document_id.in_(wanted),
                    AssignmentRow.task == "annotate",
                    AssignmentRow.revoked_at.is_(None)
                    | AssignmentRow.last_submission_id.is_not(None),
                )
                .group_by(AssignmentRow.document_id)
            )
            .tuples()
            .all()
        )
    )


def _annotation_mode(
    conn: Connection, project_id: int, document_id: str
) -> AnnotationMode:
    """The mode a new annotate assignment on ``document_id`` gets (plan P3)."""
    from ontotator.application.annotation_modes import load_text_mode
    from ontotator.storage.proposal_queries import newest_proposal_refs

    mode = load_text_mode(conn, project_id, document_id)
    if (
        mode.locked
        and mode.mode == "proposals"
        and not newest_proposal_refs(conn, project_id, document_id)
    ):
        # Plan review R10: a new version of a text annotated from proposals
        # needs its own proposals; it never switches to scratch.
        raise DomainError("NO_PROPOSALS_ON_VERSION", {"document_id": document_id})
    return mode.mode


def source_obligation_documents(
    conn: Connection,
    project_id: int,
    project_key: str,
    variants: Mapping[str, Any] | None = None,
) -> frozenset[str]:
    """Versions with an unresolved ``SOURCE_UPDATE_UNREVIEWED`` obligation."""
    from ontotator.domain.work_rounds import derive_source_obligations
    from ontotator.storage.workflow_tables import ReviewObligationResolutionRow

    if variants is None:
        variants = load_variants(conn, project_id)
    resolved = set(
        conn.execute(
            select(ReviewObligationResolutionRow.cause_id).where(
                ReviewObligationResolutionRow.project_id == project_id
            )
        ).scalars()
    )
    return frozenset(
        cause.document_id
        for cause in derive_source_obligations(project_key, variants.values(), resolved)
    )


def move_waiting_tasks(
    conn: Connection,
    actor: Actor,
    project_id: int,
    from_document_id: str,
    to_document_id: str,
    now: datetime,
) -> None:
    """Waiting tasks follow a correction of their version, so that they open
    on the accepted text without a lead step (issue 213).

    Only tasks nobody ever opened: no draft or round exists to carry, so the
    assignment itself moves and keeps its id. Started work and tasks from
    proposals (a new version needs its own proposals, plan review R10) stay
    with the lead's "Handle text change". The caller holds the project lock.
    """
    rule_on, status = conn.execute(
        select(
            ProjectRow.annotate_accepted_translations_only,
            DocumentRow.translation_status,
        )
        .join(DocumentRow, DocumentRow.project_id == ProjectRow.id)
        .where(ProjectRow.id == project_id, DocumentRow.document_id == from_document_id)
    ).one()
    if not rule_on or status == "accepted":
        return
    moved = conn.execute(
        update(AssignmentRow)
        .where(
            AssignmentRow.project_id == project_id,
            AssignmentRow.document_id == from_document_id,
            AssignmentRow.task == "annotate",
            AssignmentRow.revoked_at.is_(None),
            AssignmentRow.status == "open",
            AssignmentRow.active_round_id.is_(None),
            AssignmentRow.annotation_mode != "proposals",
        )
        .values(
            document_id=to_document_id,
            workflow_revision=AssignmentRow.workflow_revision + 1,
            updated_at=now,
        )
        .returning(AssignmentRow.id)
    ).scalars()
    for assignment_id in moved.all():
        record_audit(
            conn,
            actor,
            "assignment.follow_correction",
            target_type="assignment",
            target_id=assignment_id,
            project_id=project_id,
            details={"from_document_id": from_document_id, "to": to_document_id},
            at=now,
        )


def enable_source_change_review(
    conn: Connection,
    actor: Actor,
    project_id: int,
    project_key: str,
    document_id: str,
    *,
    variants: Mapping[str, Any] | None = None,
    obligated: frozenset[str] | None = None,
) -> bool:
    """VD14: a translation review of a version whose source text changed.

    Allowed only while the version has an unresolved
    ``SOURCE_UPDATE_UNREVIEWED`` obligation (only the newest translation
    version has one); then the review may bypass
    ``translation_already_accepted`` (returns True) and Review is turned on
    for the row (D26 pattern: audited, no confirmation). The caller holds the
    project lock.

    The row must be in the plan (Review or Annotate on), the precondition
    the batch applies too (``assignments.batch``): a review of a row the lead
    took out of the plan does not turn Review back on.

    A batch passes its ``variants`` and ``obligated``
    (``source_obligation_documents``) once for all targets: assigning a review
    neither changes the variants nor resolves an obligation.

    Raises:
        DomainError: ``SOURCE_REVIEW_NOT_NEEDED`` without such an obligation
            or for a row not in the plan (``{"reason": "not_in_plan"}``).
    """
    from ontotator.application.work_plans import turn_review_on
    from ontotator.domain.work_plans import OFF, RowKey
    from ontotator.storage import work_plan_store

    if variants is None:
        variants = load_variants(conn, project_id)
    variant = variants.get(document_id)
    if variant is None:
        raise DomainError("DOCUMENT_NOT_FOUND")
    if obligated is None:
        obligated = source_obligation_documents(conn, project_id, project_key, variants)
    if document_id not in obligated:
        raise DomainError("SOURCE_REVIEW_NOT_NEEDED")
    row = RowKey(variant.case_id, variant.language)
    flags = work_plan_store.effective_plan(conn, project_id, [row.case_id]).get(
        row, OFF
    )
    if not (flags.review or flags.annotate):
        raise DomainError("SOURCE_REVIEW_NOT_NEEDED", {"reason": "not_in_plan"})
    turn_review_on(conn, actor, project_id, row)
    return True


class AssignmentService:
    def __init__(
        self, db: Database, *, now: Callable[[], datetime] = lambda: datetime.now(UTC)
    ) -> None:
        self.db = db
        self._now = now

    @staticmethod
    def _target(conn: Connection, username: str) -> int:
        name = normalize_username(username)
        user_id = conn.execute(
            select(UserRow.id).where(UserRow.username == name)
        ).scalar_one_or_none()
        if user_id is None:
            raise DomainError("USER_NOT_FOUND", f"There is no user '{name}'.")
        return user_id

    @staticmethod
    def _prepare(
        conn: Connection,
        actor: Actor,
        key: str,
        target: int | None = None,
        *,
        exclusive_members: bool = False,
    ) -> RowMapping:
        """``exclusive_members``: a membership write follows (self-grant)."""
        members_lock = (
            func.pg_advisory_xact_lock
            if exclusive_members
            else func.pg_advisory_xact_lock_shared
        )
        conn.execute(select(members_lock(_lock_id("members", key))))
        conn.execute(select(func.pg_advisory_xact_lock(_lock_id("project", key))))
        project = (
            conn.execute(select(ProjectRow).where(ProjectRow.project_key == key))
            .mappings()
            .one_or_none()
        )
        if project is None:
            raise DomainError("PROJECT_NOT_FOUND", f"There is no project '{key}'.")
        require_project_management(
            conn,
            actor,
            key,
            project["id"],
            Action.MANAGE_ASSIGNMENTS,
            target_user_id=target,
        )
        # Process actors bypass actor policy, but their assignee must still be
        # protected against account deactivation/profile language changes.
        if actor.user_id is None and target is not None:
            conn.execute(
                select(UserRow.id)
                .where(UserRow.id == target)
                .with_for_update(key_share=True)
            ).one()
        return project

    @staticmethod
    def _locate(conn: Connection, assignment_id: int) -> str:
        key = conn.execute(
            select(ProjectRow.project_key)
            .join(AssignmentRow, AssignmentRow.project_id == ProjectRow.id)
            .where(AssignmentRow.id == assignment_id)
        ).scalar_one_or_none()
        if key is None:
            raise DomainError("ASSIGNMENT_NOT_FOUND")
        return key

    @staticmethod
    def _locked(conn: Connection, assignment_id: int) -> RowMapping:
        row = (
            conn.execute(
                select(AssignmentRow)
                .where(AssignmentRow.id == assignment_id)
                .with_for_update(key_share=True)
            )
            .mappings()
            .one_or_none()
        )
        if row is None:
            raise DomainError("ASSIGNMENT_NOT_FOUND")
        if row["revoked_at"] is not None:
            raise DomainError("ASSIGNMENT_REVOKED")
        return row

    @staticmethod
    def readable(conn: Connection, assignment_id: int, access: Access) -> Assignment:
        """The assignment, for its qualifying owner or a project's manager.

        Unknown and foreign ids raise the same ASSIGNMENT_NOT_FOUND.
        """
        from ontotator.authz.visibility import qualifying_assignment

        row = (
            conn.execute(_assignments().where(AssignmentRow.id == assignment_id))
            .mappings()
            .one_or_none()
        )
        if row is None:
            raise DomainError("ASSIGNMENT_NOT_FOUND")
        assignment = _assignment(row)
        if not can(access, Action.MANAGE_ASSIGNMENTS, assignment.project_key) and (
            conn.execute(
                select(AssignmentRow.id).where(
                    AssignmentRow.id == assignment_id,
                    qualifying_assignment(access.user_id),
                )
            ).first()
            is None
        ):
            raise DomainError("ASSIGNMENT_NOT_FOUND")
        return assignment

    @staticmethod
    def _get(conn: Connection, assignment_id: int) -> Assignment:
        return _assignment(
            conn.execute(_assignments().where(AssignmentRow.id == assignment_id))
            .mappings()
            .one()
        )

    @staticmethod
    def active_for(
        conn: Connection, project_id: int, document_id: str, user_id: int, task: Task
    ) -> Assignment | None:
        """Find an unrevoked row; callers separately check current work authority.

        This read does not lock. A writing caller must retain the advisory lock
        graph and lock/revalidate the assignment inside its transaction.
        """
        row = (
            conn.execute(
                _assignments().where(
                    AssignmentRow.project_id == project_id,
                    AssignmentRow.document_id == document_id,
                    AssignmentRow.user_id == user_id,
                    AssignmentRow.task == task,
                    AssignmentRow.revoked_at.is_(None),
                )
            )
            .mappings()
            .one_or_none()
        )
        return None if row is None else _assignment(row)

    @staticmethod
    def _require_target(
        conn: Connection,
        project: RowMapping,
        target: int,
        task: Task,
    ) -> None:
        if task not in TASK_ROLES:
            raise DomainError("TASK_INVALID")
        user = (
            conn.execute(select(UserRow).where(UserRow.id == target)).mappings().one()
        )
        if not user["active"]:
            raise DomainError("ASSIGNEE_INACTIVE")
        roles = frozenset(
            cast(Role, role)
            for role in conn.execute(
                select(ProjectMembershipRow.role).where(
                    ProjectMembershipRow.project_id == project["id"],
                    ProjectMembershipRow.user_id == target,
                )
            ).scalars()
        )
        if not roles:
            raise DomainError("NOT_A_MEMBER")
        access = Access(
            target,
            user["pseudonym"],
            user["is_system_admin"],
            {project["project_key"]: roles},
        )
        if not may_take(access, project["project_key"], task):
            raise DomainError("ASSIGNEE_ROLE_MISSING")

    @staticmethod
    def check_assignable(
        conn: Connection,
        project: RowMapping,
        document_id: str,
        target: int,
        task: Task,
        confirm_language: bool,
        *,
        excluding: int | None = None,
        variants: Mapping[str, VariantInfo] | None = None,
        allow_accepted_translation_review: bool = False,
        check_plan: bool = True,
        confirm_unreviewed_translation: bool = False,
    ) -> tuple[str, list[str], bool, list[str], bool]:
        """``check_plan=False`` only for work that already exists (reassign).

        The last element: annotate work on a translation whose review is not
        accepted while the rule is off, acknowledged by the caller (spec
        2026-10-25 §2); ``_create`` audits it."""
        AssignmentService._require_target(conn, project, target, task)
        if variants is None:
            variants = load_variants(conn, project["id"], document_id)
        variant = variants.get(document_id)
        if variant is None:
            raise DomainError("DOCUMENT_NOT_FOUND")
        statuses = None
        review_open = False
        if (
            task == "annotate"
            and translation_context(variant, variants.get) is not None
        ):
            from ontotator.application.text_targets import (
                TextRow,
                text_translation_statuses,
            )

            statuses = text_translation_statuses(
                conn, project["id"], TextRow(variant.case_id, variant.language)
            )
            # A reassignment hands on a task that exists: it may wait on,
            # whatever happened to the review meanwhile.
            review_open = excluding is not None or RowKey(
                variant.case_id, variant.language
            ) in open_review_rows(conn, project["id"], variant.case_id)
        required = check_variant_assignable(
            project,
            variant,
            task,
            variants.get,
            allow_accepted_translation_review=allow_accepted_translation_review,
            row_statuses=statuses,
            review_open=review_open,
        )
        if check_plan:
            check_work_plan(conn, project["id"], variant, task)
        language = variant.language
        languages = list(
            conn.execute(
                select(UserLanguageRow.language)
                .where(UserLanguageRow.user_id == target)
                .order_by(UserLanguageRow.language)
            ).scalars()
        )
        mismatch = not reads_all(languages, required)
        if mismatch and not confirm_language:
            raise DomainError(
                "LANGUAGE_CONFIRMATION_REQUIRED",
                {
                    "document_language": language,
                    "user_languages": languages,
                    "required_languages": sorted(required),
                },
            )
        # After the language check: a caller can meet both confirmations.
        unreviewed = (
            statuses is not None
            and not project["annotate_accepted_translations_only"]
            and not translations_accepted(
                False, (variant.translation_status, *statuses)
            )
        )
        if unreviewed and not confirm_unreviewed_translation:
            raise DomainError(
                "TRANSLATION_NOT_REVIEWED", {"document_ids": [document_id]}
            )
        if project["adjudicator_not_annotator"] and conflicting_tasks(task):
            conflict = select(AssignmentRow.id).where(
                AssignmentRow.project_id == project["id"],
                AssignmentRow.document_id == document_id,
                AssignmentRow.user_id == target,
                AssignmentRow.task.in_(conflicting_tasks(task)),
                AssignmentRow.revoked_at.is_(None),
            )
            if excluding is not None:
                conflict = conflict.where(AssignmentRow.id != excluding)
            if conn.execute(conflict.limit(1)).first() is not None:
                raise DomainError("ADJUDICATOR_IS_ANNOTATOR")
        return language, languages, mismatch, sorted(required), unreviewed

    def _create(
        self,
        conn: Connection,
        actor: Actor,
        project: RowMapping,
        document_id: str,
        target: int,
        task: Task,
        eligibility: tuple[str, list[str], bool, list[str], bool],
        now: datetime,
        *,
        lead_correction: bool = False,
        annotation_mode: AnnotationMode | None = None,
    ) -> Assignment:
        if task == "annotate" and annotation_mode is None:
            annotation_mode = _annotation_mode(conn, project["id"], document_id)
        assignment_id = conn.execute(
            insert(AssignmentRow)
            .values(
                project_id=project["id"],
                document_id=document_id,
                user_id=target,
                task=task,
                status="open",
                created_by=actor.user_id,
                created_at=now,
                updated_at=now,
                lead_correction=lead_correction,
                annotation_mode=annotation_mode if task == "annotate" else None,
            )
            .returning(AssignmentRow.id)
        ).scalar_one()
        language, languages, mismatch, required, unreviewed = eligibility
        if unreviewed:
            record_audit(
                conn,
                actor,
                "assignment.unreviewed_translation",
                target_type="assignment",
                target_id=assignment_id,
                project_id=project["id"],
                details={"document_id": document_id},
                at=now,
            )
        if mismatch:
            record_audit(
                conn,
                actor,
                "assignment.language_override",
                target_type="assignment",
                target_id=assignment_id,
                project_id=project["id"],
                details={
                    "document_language": language,
                    "user_languages": languages,
                    "required_languages": required,
                },
                at=now,
            )
        record_audit(
            conn,
            actor,
            "assignment.create",
            target_type="assignment",
            target_id=assignment_id,
            project_id=project["id"],
            details={"document_id": document_id, "user_id": target, "task": task},
            at=now,
        )
        return self._get(conn, assignment_id)

    def assign(
        self,
        actor: Actor,
        key: str,
        document_id: str,
        username: str,
        task: Task,
        *,
        confirm_language: bool = False,
        confirm_unreviewed_translation: bool = False,
        review_accepted_translation: bool = False,
        review_reason: ReviewReason | None = None,
    ) -> Assignment:
        """``review_accepted_translation`` (D25): a new translation review of a
        newest version with a lead or override acceptance; turns Review on for
        its row in the same transaction. ``review_reason="source_changed"``
        (VD14): a review of a translation whose source text changed, see
        ``enable_source_change_review``. Task ``review`` is created only by
        a consolidation start (D1)."""
        if task == "review":
            raise DomainError("TASK_NOT_ASSIGNABLE", {"task": "review"})
        with self.db.transaction() as conn:
            target = self._target(conn, username)
            # "Annotate from proposals myself" (plan P3): the acting lead.
            myself = task == "annotate" and target == actor.user_id
            project = self._prepare(conn, actor, key, target, exclusive_members=myself)
            if myself:
                grant_lead_self_role(
                    conn,
                    actor,
                    project["id"],
                    key,
                    target,
                    normalize_username(username),
                    "annotator",
                    self._now(),
                )
                # The lead's own work (_create audits it); a system admin
                # who is not lead confirms the language like anybody else.
                confirm_language = confirm_language or (
                    conn.execute(
                        select(ProjectMembershipRow.role).where(
                            ProjectMembershipRow.project_id == project["id"],
                            ProjectMembershipRow.user_id == target,
                            ProjectMembershipRow.role == "lead",
                        )
                    ).first()
                    is not None
                )
            allow = False
            if review_reason == "source_changed":
                # The API refuses another task at request validation.
                if task != "translation_review":
                    raise DomainError("SOURCE_REVIEW_NOT_NEEDED")
                allow = enable_source_change_review(
                    conn, actor, project["id"], key, document_id
                )
            elif review_accepted_translation and task == "translation_review":
                from ontotator.application.work_plans import (
                    enable_review_for_accepted,
                )

                allow = enable_review_for_accepted(
                    conn, actor, project["id"], document_id
                )
            return self._assign_locked(
                conn,
                actor,
                project,
                document_id,
                target,
                task,
                confirm_language,
                allow_accepted_translation_review=allow,
                # Unlike the language, the lead's own work is not confirmed
                # implicitly (plan D5).
                confirm_unreviewed_translation=confirm_unreviewed_translation,
            )

    @staticmethod
    def _require_no_open_lead_correction(
        conn: Connection, project_id: int, document_id: str
    ) -> None:
        """An open lead correction is the version's one review (FD3)."""
        if (
            conn.execute(
                select(AssignmentRow.id)
                .where(
                    AssignmentRow.project_id == project_id,
                    AssignmentRow.document_id == document_id,
                    AssignmentRow.task == "translation_review",
                    AssignmentRow.lead_correction.is_(True),
                    AssignmentRow.status != "submitted",
                    AssignmentRow.revoked_at.is_(None),
                )
                .limit(1)
            ).first()
            is not None
        ):
            raise DomainError("ASSIGNMENT_EXISTS", {"reason": "lead_correction_open"})

    @staticmethod
    def _require_annotation_slot(
        conn: Connection, project: RowMapping, document_id: str
    ) -> None:
        """A new annotate assignment needs a free "annotations per text" slot."""
        # Per version on purpose (plan review R25).
        limit = int(project["annotations_per_text"])
        held = held_annotations(conn, project["id"], [document_id])[document_id]
        if held >= limit:
            raise DomainError(
                "ANNOTATIONS_PER_TEXT_REACHED", {"limit": limit, "assigned": held}
            )

    def _assign_locked(
        self,
        conn: Connection,
        actor: Actor,
        project: RowMapping,
        document_id: str,
        target: int,
        task: Task,
        confirm_language: bool,
        *,
        variants: Mapping[str, VariantInfo] | None = None,
        allow_accepted_translation_review: bool = False,
        confirm_unreviewed_translation: bool = False,
    ) -> Assignment:
        """Assign on caller's connection under preheld authority/target locks.

        Bulk callers acquire the complete sorted target union before this seam.
        No joined Database scope: a caller can isolate routine row refusals with
        conn.begin_nested without poisoning its outer transaction. An optional
        lookup must be server-owned, freshly revalidated under project EX; only
        metadata is reused, never current target authority/languages/conflicts.
        """
        if task not in ADMINISTRATION_TASKS:
            raise DomainError("TASK_INVALID")
        existing = self.active_for(conn, project["id"], document_id, target, task)
        if existing is not None and existing.lead_correction:
            # The target's own lead correction (FD1) is not this ordinary task.
            raise DomainError("ASSIGNMENT_EXISTS")
        if existing is not None:
            self._require_target(conn, project, target, task)
            return existing
        if task == "translation_review":
            self._require_no_open_lead_correction(conn, project["id"], document_id)
        if task == "annotate":
            self._require_annotation_slot(conn, project, document_id)
        eligibility = self.check_assignable(
            conn,
            project,
            document_id,
            target,
            task,
            confirm_language,
            variants=variants,
            allow_accepted_translation_review=allow_accepted_translation_review,
            confirm_unreviewed_translation=confirm_unreviewed_translation,
        )
        return self._create(
            conn, actor, project, document_id, target, task, eligibility, self._now()
        )

    def reassign(
        self,
        actor: Actor,
        assignment_id: int,
        username: str,
        *,
        confirm_started: bool = False,
        confirm_language: bool = False,
        confirm_unreviewed_translation: bool = False,
    ) -> Assignment:
        with self.db.transaction() as conn:
            key = self._locate(conn, assignment_id)
            target = self._target(conn, username)
            project = self._prepare(conn, actor, key, target)
            old = self._locked(conn, assignment_id)
            if old["status"] != "open" and not confirm_started:
                raise DomainError("REASSIGN_CONFIRMATION_REQUIRED")
            task = cast(Task, old["task"])
            if task not in ADMINISTRATION_TASKS:
                raise DomainError("TASK_INVALID")
            if task == "review":
                # D1: a consolidation task opens only through its round.
                raise DomainError("TASK_NOT_ASSIGNABLE", {"task": "review"})
            existing = self.active_for(
                conn, project["id"], old["document_id"], target, task
            )
            if existing is not None and existing.id != assignment_id:
                raise DomainError("ASSIGNMENT_EXISTS")
            if old["lead_correction"] and target == old["user_id"]:
                # FD9: a lead correction stays the lead's own; handing it to
                # someone else makes it an ordinary review.
                raise DomainError("ASSIGNMENT_EXISTS")
            eligibility = self.check_assignable(
                conn,
                project,
                old["document_id"],
                target,
                task,
                confirm_language,
                excluding=assignment_id,
                check_plan=False,
                confirm_unreviewed_translation=confirm_unreviewed_translation,
            )
            if task == "annotate" and old["last_submission_id"] is not None:
                # Revoked submitted work keeps its slot; an unsubmitted one frees it.
                self._require_annotation_slot(conn, project, old["document_id"])
            now = self._now()
            revoke_assignments(
                conn, actor, project["id"], [dict(old)], now, reason="reassign"
            )
            new = self._create(
                conn,
                actor,
                project,
                old["document_id"],
                target,
                task,
                eligibility,
                now,
                annotation_mode=old["annotation_mode"],
            )
            record_audit(
                conn,
                actor,
                "assignment.reassign",
                target_type="assignment",
                target_id=assignment_id,
                project_id=project["id"],
                details={
                    "from": old["user_id"],
                    "to": target,
                    "replacement_assignment_id": new.id,
                },
                at=now,
            )
            return new

    def reopen(
        self, actor: Actor, assignment_id: int, reason: str | None = None
    ) -> Assignment:
        with self.db.transaction() as conn:
            key = self._locate(conn, assignment_id)
            target = conn.execute(
                select(AssignmentRow.user_id).where(AssignmentRow.id == assignment_id)
            ).scalar_one()
            project = self._prepare(conn, actor, key, target)
            old = self._locked(conn, assignment_id)
            if old["status"] != "submitted":
                raise DomainError("ASSIGNMENT_NOT_SUBMITTED")
            # A discarded version takes no work, reopened work included.
            if (
                conn.execute(
                    select(DiscardedVariantRow.document_id).where(
                        DiscardedVariantRow.project_id == project["id"],
                        DiscardedVariantRow.document_id == old["document_id"],
                    )
                ).first()
                is not None
            ):
                raise DomainError("NOT_IN_WORK_PLAN")
            if old["lead_correction"]:
                # A submitted correction made a newer version (FD3, FD4).
                raise DomainError(
                    "LEAD_CORRECTION_NOT_AVAILABLE", {"reason": "not_newest"}
                )
            self._require_target(conn, project, target, cast(Task, old["task"]))
            if old["task"] == "translation_review":
                self._require_no_open_lead_correction(
                    conn, project["id"], old["document_id"]
                )
            now = self._now()
            conn.execute(
                update(AssignmentRow)
                .where(AssignmentRow.id == assignment_id)
                .values(status="reopened", updated_at=now)
            )
            if old["active_round_id"] is not None:
                from ontotator.storage.workflow_tables import WorkRoundStateRow

                conn.execute(
                    update(WorkRoundStateRow)
                    .where(WorkRoundStateRow.round_id == old["active_round_id"])
                    .values(state="editable", revision=WorkRoundStateRow.revision + 1)
                )
                conn.execute(
                    update(AssignmentRow)
                    .where(AssignmentRow.id == assignment_id)
                    .values(workflow_revision=AssignmentRow.workflow_revision + 1)
                )
            record_audit(
                conn,
                actor,
                "assignment.reopen",
                target_type="assignment",
                target_id=assignment_id,
                project_id=project["id"],
                details={"reason": reason},
                at=now,
            )
            return self._get(conn, assignment_id)

    def revoke(
        self, actor: Actor, assignment_id: int, reason: str | None = None
    ) -> Assignment:
        with self.db.transaction() as conn:
            key = self._locate(conn, assignment_id)
            project = self._prepare(conn, actor, key)
            old = self._locked(conn, assignment_id)
            revoke_assignments(
                conn, actor, project["id"], [dict(old)], self._now(), reason=reason
            )
            return self._get(conn, assignment_id)

    def remove(self, actor: Actor, assignment_id: int) -> Assignment:
        """Remove an unsubmitted annotate assignment and discard its draft
        (plan P3, review R12), so assigning the person again starts empty."""
        from ontotator.storage.repository import Repository
        from ontotator.storage.workflow_tables import WorkRoundStateRow

        with self.db.transaction() as conn:
            key = self._locate(conn, assignment_id)
            project = self._prepare(conn, actor, key)
            old = self._locked(conn, assignment_id)
            if old["task"] != "annotate":
                raise DomainError("TASK_INVALID")
            if old["status"] == "submitted" or old["last_submission_id"] is not None:
                raise DomainError("ASSIGNMENT_SUBMITTED")
            now = self._now()
            revoke_assignments(
                conn, actor, project["id"], [dict(old)], now, reason="removed"
            )
            pseudonym = conn.execute(
                select(UserRow.pseudonym).where(UserRow.id == old["user_id"])
            ).scalar_one()
            Repository._discard_drafts(
                conn,
                project["id"],
                old["document_id"],
                pseudonym,
                workspace_mode(old["task"], old["annotation_mode"]),
            )
            if old["active_round_id"] is not None:
                # As a clean restart abandons its prior round: never rebound.
                conn.execute(
                    update(WorkRoundStateRow)
                    .where(WorkRoundStateRow.round_id == old["active_round_id"])
                    .values(state="abandoned", revision=WorkRoundStateRow.revision + 1)
                )
            return self._get(conn, assignment_id)

    def list(
        self,
        key: str,
        *,
        document_ids: Iterable[str] | None = None,
        user: str | int | None = None,
        include_revoked: bool = False,
    ) -> list[Assignment]:
        with self.db.transaction() as conn:
            if (
                conn.execute(
                    select(ProjectRow.id).where(ProjectRow.project_key == key)
                ).first()
                is None
            ):
                raise DomainError("PROJECT_NOT_FOUND")
            query = _assignments().where(ProjectRow.project_key == key)
            if not include_revoked:
                query = query.where(AssignmentRow.revoked_at.is_(None))
            if document_ids is not None:
                query = query.where(AssignmentRow.document_id.in_(list(document_ids)))
            if user is not None:
                query = (
                    query.where(AssignmentRow.user_id == user)
                    if isinstance(user, int)
                    else query.where(UserRow.username == normalize_username(user))
                )
            return [
                _assignment(row)
                for row in conn.execute(query.order_by(AssignmentRow.id)).mappings()
            ]

    def my_tasks(self, user_id: int) -> List[TaskSummary]:
        from ontotator.application.problem_report_views import answered
        from ontotator.application.translation_reviews import (
            failed_translation_checks,
        )
        from ontotator.authz.visibility import qualifying_assignment
        from ontotator.domain.variants import resolve_translation_lineage
        from ontotator.storage.workflow_tables import (
            ProblemReportEventRow,
            ProblemReportRow,
            ProblemReportStateRow,
        )

        query = (
            select(
                AssignmentRow.id.label("assignment_id"),
                AssignmentRow.active_round_id,
                AssignmentRow.workflow_revision,
                AssignmentRow.held,
                AssignmentRow.hold_reason,
                ProjectRow.project_key,
                ProjectRow.name.label("project_name"),
                AssignmentRow.document_id,
                DocumentRow.case_id,
                DocumentRow.language,
                DocumentRow.external_id,
                DocumentRow.version,
                DocumentRow.origin,
                AssignmentRow.task,
                AssignmentRow.status,
                AssignmentRow.updated_at,
                AssignmentRow.created_at.label("assigned_at"),
                AssignmentRow.annotation_mode,
            )
            .join(ProjectRow, ProjectRow.id == AssignmentRow.project_id)
            .join(
                DocumentRow,
                (DocumentRow.project_id == AssignmentRow.project_id)
                & (DocumentRow.document_id == AssignmentRow.document_id),
            )
            .join(UserRow, UserRow.id == AssignmentRow.user_id)
            .where(qualifying_assignment(user_id))
            .order_by(
                case(
                    {"reopened": 0, "in_progress": 1, "open": 2, "submitted": 3},
                    value=AssignmentRow.status,
                ),
                DocumentRow.position.asc().nulls_last(),
                ProjectRow.project_key,
                AssignmentRow.document_id,
                AssignmentRow.id,
            )
        )
        with self.db.transaction() as conn:
            rows = list(conn.execute(query).mappings())
            # Issue 213: unsubmitted annotation tasks under the rule may wait.
            ruled = set(
                conn.execute(
                    select(ProjectRow.project_key).where(
                        ProjectRow.project_key.in_({r["project_key"] for r in rows}),
                        ProjectRow.annotate_accepted_translations_only,
                    )
                ).scalars()
            )

            def may_wait(row: RowMapping) -> bool:
                return (
                    row["task"] == "annotate"
                    and row["status"] != "submitted"
                    and row["project_key"] in ruled
                )

            projects = {
                r["project_key"]
                for r in rows
                if r["task"] == "translation_review" or may_wait(r)
            }
            # One metadata query across all task projects, never one per task/doc.
            from ontotator.assignments.eligibility import VARIANT_COLUMNS

            variants: dict[str, dict[str, VariantInfo]] = {}
            for row in conn.execute(
                select(ProjectRow.project_key, *VARIANT_COLUMNS)
                .join(ProjectRow, ProjectRow.id == DocumentRow.project_id)
                .where(ProjectRow.project_key.in_(projects))
            ).mappings():
                variant = VariantInfo(
                    **{name: row[name] for name in VariantInfo.__dataclass_fields__}
                )
                variants.setdefault(row["project_key"], {})[variant.document_id] = (
                    variant
                )
            reopened = [r for r in rows if r["status"] == "reopened"]
            reopens = (
                {
                    event.target_id: event
                    for event in conn.execute(
                        select(
                            AuditEventRow.target_id,
                            AuditEventRow.at,
                            AuditEventRow.details,
                        )
                        .where(
                            AuditEventRow.project_id.in_(
                                select(ProjectRow.id).where(
                                    ProjectRow.project_key.in_(
                                        {r["project_key"] for r in reopened}
                                    )
                                )
                            ),
                            AuditEventRow.target_type == "assignment",
                            AuditEventRow.target_id.in_(
                                [str(r["assignment_id"]) for r in reopened]
                            ),
                            AuditEventRow.action == "assignment.reopen",
                        )
                        .distinct(AuditEventRow.target_id)
                        .order_by(AuditEventRow.target_id, AuditEventRow.id.desc())
                    )
                }
                if reopened
                else {}
            )
            # #146: the lead's reason of an open consolidation, shown to the
            # consolidator in My tasks.
            from ontotator.application.consolidation import consolidation_reasons

            consolidation_reason = consolidation_reasons(
                conn,
                [
                    r["active_round_id"]
                    for r in rows
                    if r["task"] == "review"
                    and r["active_round_id"]
                    and r["status"] != "submitted"
                ],
            )
            reports = {
                r.report_id: r
                for r in conn.execute(
                    select(
                        ProblemReportRow.report_id,
                        ProblemReportRow.assignment_id,
                        ProblemReportStateRow.reporter_seen_at,
                    )
                    .join(
                        ProblemReportStateRow,
                        ProblemReportStateRow.report_id == ProblemReportRow.report_id,
                    )
                    .where(
                        ProblemReportRow.reporter_id == user_id,
                        ProblemReportRow.assignment_id.in_(
                            [r["assignment_id"] for r in rows]
                        ),
                    )
                )
            }
            events: dict[str, list[Any]] = {}
            for event in conn.execute(
                select(
                    ProblemReportEventRow.report_id,
                    ProblemReportEventRow.actor_id,
                    ProblemReportEventRow.action,
                    ProblemReportEventRow.details,
                    ProblemReportEventRow.created_at,
                ).where(
                    ProblemReportEventRow.report_id.in_(list(reports)),
                    ProblemReportEventRow.actor_id != user_id,
                )
            ):
                events.setdefault(event.report_id, []).append(event)
            answered_tasks: dict[int, str] = {}
            # Latest answer first, so each task links its newest answered report.
            for rid, r in sorted(
                reports.items(),
                key=lambda item: (
                    max((e.created_at for e in events.get(item[0], [])), default=None)
                    or datetime.min.replace(tzinfo=UTC)
                ),
                reverse=True,
            ):
                if answered(
                    events.get(rid, []), user_id, r.assignment_id, r.reporter_seen_at
                ):
                    answered_tasks.setdefault(r.assignment_id, rid)
            result = []
            for row in rows:
                source = target = None
                failed: int | None = None
                if row["task"] == "translation_review":
                    project_variants = variants[row["project_key"]]
                    ancestor, original = resolve_translation_lineage(
                        project_variants[row["document_id"]], project_variants.get
                    )
                    source, target = original.language, row["language"]
                    try:
                        failed = len(failed_translation_checks(ancestor.translation))
                    except ValidationError:
                        # A malformed stored run must not hide every task.
                        failed = None
                waiting = may_wait(row) and annotation_waits(
                    variants[row["project_key"]][row["document_id"]],
                    variants[row["project_key"]].get,
                )
                result.append(
                    TaskSummary(
                        **row,
                        waiting_for_translation_review=waiting,
                        source_language=source,
                        target_language=target,
                        failed_check_count=failed,
                        report_answered=row["assignment_id"] in answered_tasks,
                        answered_report_id=answered_tasks.get(row["assignment_id"]),
                        consolidation_reason=consolidation_reason.get(
                            row["active_round_id"] or ""
                        ),
                        **(
                            {
                                "reopened_at": reopen.at,
                                "reopen_reason": reopen.details.get("reason") or None,
                            }
                            if (reopen := reopens.get(str(row["assignment_id"])))
                            else {}
                        ),
                    )
                )
            return result
