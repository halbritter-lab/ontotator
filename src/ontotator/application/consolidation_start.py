"""Consolidation start command (acceptance fixes spec "WP-B > Start command",
T3, T17, U4).

``POST /projects/{key}/consolidations`` replaces the launcher's two calls
(``createAssignments`` + ``startWorkRound``) with one lead-only transaction:

1. Locks: the members advisory lock EXCLUSIVE (as ``MembershipService``),
   then the project lock (as ``AssignmentService._prepare`` and
   ``WorkRoundService.create``), then the actor and target user rows
   (``require_project_management``) and the assignment row. Project
   management authority is re-checked under these locks.
2. Reviewer = the acting lead (role ``lead``) without the Adjudicator role: ``grant_lead_self_role``
   adds it and audits ``project.member_add``. An additive self-grant keeps the
   session: no session is revoked, and every request re-reads the caller's
   roles (``access_for`` / ``current_access``), so the next request already
   sees the role. Any other reviewer must hold the role already
   (``ASSIGNEE_ROLE_MISSING``).
3. The review assignment is created or reused through
   ``AssignmentService._assign_locked``, the seam ``createAssignments`` uses,
   with ``ADJUDICATOR_IS_ANNOTATOR`` and the language confirmation; then
   ``WorkRoundService.create_in`` starts the consolidation round.
4. One receipt per ``request_id`` (the same request answers the stored
   response) and the audit ``round.create``.

Every refusal raises inside the one transaction, so a refused start writes
nothing, the self-grant included.

``expected_workflow_revision``: ``None`` means "new assignment" (refused with
``WORKFLOW_REVISION_CONFLICT`` while the reviewer has an active review
assignment on the text); an ``int`` must equal that assignment's revision,
checked on the unlocked read and again on the locked row (``create_in``).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, insert, select

from ontotator.application.work_rounds import WorkRoundService
from ontotator.assignments.service import AssignmentService
from ontotator.auth.accounts import normalize_username
from ontotator.auth.audit import Actor, record_audit
from ontotator.authz.memberships import grant_lead_self_role
from ontotator.authz.policy import Access, Action, Role, Task
from ontotator.authz.project_authority import require_project_management
from ontotator.authz.visibility import current_access, require_document
from ontotator.domain.canonical import canonical_hash
from ontotator.domain.errors import AccessDenied, DomainError
from ontotator.domain.work_rounds import WorkRoundView
from ontotator.storage.database import Database
from ontotator.storage.repository import _lock_id
from ontotator.storage.tables import ProjectRow, UserRow
from ontotator.storage.workflow_tables import WorkflowCommandReceiptRow

__all__ = ["ConsolidationStartService", "StartConsolidation", "StartedConsolidation"]

# The consolidator's task and the role it needs (``TASK_ROLES["review"]``).
_TASK: Task = "review"
_ROLE: Role = "adjudicator"


class StartConsolidation(BaseModel):
    """The start command's body (``StartConsolidationRequest``)."""

    model_config = ConfigDict(extra="forbid")
    document_id: str = Field(min_length=1)
    # Username of the consolidator; the acting lead may name themself.
    reviewer: str = Field(min_length=1)
    source_submission_ids: list[str] = Field(min_length=2, max_length=20)
    reason: str | None = Field(default=None, max_length=2000)
    confirm_language: bool = False
    request_id: str = Field(min_length=1, max_length=128)
    # None: a new assignment; else the reviewer's current review assignment.
    expected_workflow_revision: int | None = Field(default=None, ge=0)


@dataclass(frozen=True)
class StartedConsolidation:
    round: WorkRoundView
    # The acting lead got the Adjudicator role with this command.
    role_granted: bool


class ConsolidationStartService:
    def __init__(
        self, db: Database, *, now: Callable[[], datetime] = lambda: datetime.now(UTC)
    ) -> None:
        self.db = db
        self._now = now
        self._assignments = AssignmentService(db, now=now)
        self._rounds = WorkRoundService(db)

    def start(
        self, actor: Actor, access: Access, key: str, body: StartConsolidation
    ) -> StartedConsolidation:
        """Assign ``body.reviewer`` (granting the acting lead the role) and
        start the consolidation round of ``body.source_submission_ids``.

        Raises:
            DomainError: ``PROJECT_NOT_FOUND``, ``USER_NOT_FOUND``,
                ``WORKFLOW_REQUEST_CONFLICT``, ``WORKFLOW_REVISION_CONFLICT``,
                the assignment refusals (``ASSIGNEE_ROLE_MISSING``,
                ``ADJUDICATOR_IS_ANNOTATOR``, ``LANGUAGE_CONFIRMATION_REQUIRED``,
                ...) and the round refusals of ``create_in``.
            AccessDenied: ``NOT_ALLOWED`` for a caller who does not manage
                assignments.
        """
        sources = list(body.source_submission_ids)
        if len(sources) != len(set(sources)):
            raise DomainError("ROUND_INPUT_INVALID", "Repeated source submission")
        reviewer = normalize_username(body.reviewer)
        request_hash = canonical_hash(
            {
                "command": "consolidation.start",
                "document_id": body.document_id,
                "reviewer": reviewer,
                "sources": sources,
                "reason": body.reason,
                "confirm_language": body.confirm_language,
                "revision": body.expected_workflow_revision,
            }
        )
        with self.db.transaction() as conn:
            # Members EXCLUSIVE: the self-grant is a membership write.
            conn.execute(select(func.pg_advisory_xact_lock(_lock_id("members", key))))
            conn.execute(select(func.pg_advisory_xact_lock(_lock_id("project", key))))
            project = (
                conn.execute(select(ProjectRow).where(ProjectRow.project_key == key))
                .mappings()
                .one_or_none()
            )
            if project is None:
                raise DomainError("PROJECT_NOT_FOUND", f"There is no project '{key}'.")
            pid = int(project["id"])
            target = AssignmentService._target(conn, reviewer)
            require_project_management(
                conn,
                actor,
                key,
                pid,
                Action.MANAGE_ASSIGNMENTS,
                target_user_id=target,
            )
            fresh = current_access(conn, access, pid, key)
            if actor.user_id != fresh.user_id:
                raise AccessDenied("NOT_ALLOWED")
            require_document(conn, fresh, pid, key, body.document_id)
            actor_key = str(access.user_id)
            receipt = (
                conn.execute(
                    select(WorkflowCommandReceiptRow).where(
                        WorkflowCommandReceiptRow.project_id == pid,
                        WorkflowCommandReceiptRow.actor_key == actor_key,
                        WorkflowCommandReceiptRow.request_id == body.request_id,
                    )
                )
                .mappings()
                .one_or_none()
            )
            if receipt:
                if receipt["request_hash"] != request_hash:
                    raise DomainError("WORKFLOW_REQUEST_CONFLICT")
                stored = receipt["response"]
                return StartedConsolidation(
                    round=WorkRoundView.model_validate(stored["round"]),
                    role_granted=bool(stored["role_granted"]),
                )
            existing = AssignmentService.active_for(
                conn, pid, body.document_id, target, _TASK
            )
            expected = body.expected_workflow_revision
            if (existing is None) != (expected is None) or (
                existing is not None and existing.workflow_revision != expected
            ):
                raise DomainError("WORKFLOW_REVISION_CONFLICT")
            now = self._now()
            # Only the acting lead is granted the role (U4). A system admin
            # without the lead role is refused by ``_assign_locked`` like any
            # other reviewer without the role.
            granted = grant_lead_self_role(
                conn, actor, pid, key, target, reviewer, _ROLE, now
            )
            assignment = self._assignments._assign_locked(
                conn,
                actor,
                project,
                body.document_id,
                target,
                _TASK,
                body.confirm_language,
            )
            locked = AssignmentService._locked(conn, assignment.id)
            owner = conn.execute(
                select(UserRow.pseudonym).where(UserRow.id == target)
            ).scalar_one()
            result = self._rounds.create_in(
                conn,
                project=key,
                pid=pid,
                actor=actor,
                assignment=locked,
                kind="consolidation",
                sources=sources,
                draft_sources=[],
                reason=body.reason,
                # The caller's revision, checked again on the locked row: a
                # writer without the project lock may have bumped it since
                # the unlocked ``active_for`` read.
                expected_workflow_revision=(
                    expected
                    if expected is not None
                    else int(locked["workflow_revision"])
                ),
                lead=True,
                owner=owner,
            )
            started = StartedConsolidation(round=result, role_granted=bool(granted))
            conn.execute(
                insert(WorkflowCommandReceiptRow).values(
                    project_id=pid,
                    actor_key=actor_key,
                    request_id=body.request_id,
                    request_hash=request_hash,
                    response={
                        "round": result.model_dump(mode="json"),
                        "role_granted": started.role_granted,
                    },
                    created_at=now,
                )
            )
            record_audit(
                conn,
                actor,
                "round.create",
                target_type="work_round",
                target_id=result.round_id,
                project_id=pid,
                details={
                    "kind": "consolidation",
                    "assignment_id": assignment.id,
                    "sources": sources,
                    "reason": body.reason,
                },
                at=now,
            )
            return started
