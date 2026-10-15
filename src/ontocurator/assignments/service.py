"""Transactional assignment administration; drafts and submissions stay untouched.

Administrative writes acquire members SHARED -> project EXCLUSIVE -> sorted
actor SHARE / target NO KEY UPDATE -> assignment NO KEY UPDATE. Membership
writes take members EXCLUSIVE, and settings/imports share the project lock.
Ordinary document commands must take compatible advisory locks before their
draft/assignment rows; they need not serialize on this administrative mutex.
"""

from __future__ import annotations

from builtins import list as List
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal, cast

from sqlalchemy import (
    Connection,
    RowMapping,
    Select,
    case,
    exists,
    func,
    insert,
    select,
    update,
)

from ontocurator.auth.accounts import normalize_username
from ontocurator.auth.audit import Actor, record_audit
from ontocurator.authz.policy import Access, Action, Role, Task, may_take
from ontocurator.authz.project_authority import require_project_management
from ontocurator.domain.errors import DomainError
from ontocurator.domain.workspace import WorkspaceMode
from ontocurator.projects.assignments import revoke_assignments
from ontocurator.storage.database import Database
from ontocurator.storage.repository import _lock_id
from ontocurator.storage.tables import (
    AssignmentRow,
    DocumentRow,
    ProjectMembershipRow,
    ProjectRow,
    UserLanguageRow,
    UserRow,
)

MODE_FOR_TASK: dict[Task, WorkspaceMode] = {
    "annotate": "independent",
    "review": "review",
}
TASK_FOR_MODE: dict[WorkspaceMode, Task] = {
    "independent": "annotate",
    "assisted": "annotate",
    "review": "review",
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
        )
        .join(ProjectRow, ProjectRow.id == AssignmentRow.project_id)
        .join(UserRow, UserRow.id == AssignmentRow.user_id)
    )


def _assignment(row: RowMapping) -> Assignment:
    return Assignment(**row)


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
        conn: Connection, actor: Actor, key: str, target: int | None = None
    ) -> RowMapping:
        conn.execute(
            select(func.pg_advisory_xact_lock_shared(_lock_id("members", key)))
        )
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
            .one()
        )
        if row["revoked_at"] is not None:
            raise DomainError("ASSIGNMENT_REVOKED")
        return row

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
        if task not in MODE_FOR_TASK:
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
    def _eligible(
        conn: Connection,
        project: RowMapping,
        document_id: str,
        target: int,
        task: Task,
        confirm_language: bool,
        *,
        excluding: int | None = None,
    ) -> tuple[str, list[str], bool]:
        AssignmentService._require_target(conn, project, target, task)
        language = conn.execute(
            select(DocumentRow.language).where(
                DocumentRow.project_id == project["id"],
                DocumentRow.document_id == document_id,
            )
        ).scalar_one_or_none()
        if language is None:
            raise DomainError("DOCUMENT_NOT_FOUND")
        languages = list(
            conn.execute(
                select(UserLanguageRow.language)
                .where(UserLanguageRow.user_id == target)
                .order_by(UserLanguageRow.language)
            ).scalars()
        )
        mismatch = language not in languages
        if mismatch and not confirm_language:
            raise DomainError(
                "LANGUAGE_CONFIRMATION_REQUIRED",
                {"document_language": language, "user_languages": languages},
            )
        if project["adjudicator_not_annotator"]:
            opposite: Task = "review" if task == "annotate" else "annotate"
            conflict = select(AssignmentRow.id).where(
                AssignmentRow.project_id == project["id"],
                AssignmentRow.document_id == document_id,
                AssignmentRow.user_id == target,
                AssignmentRow.task == opposite,
                AssignmentRow.revoked_at.is_(None),
            )
            if excluding is not None:
                conflict = conflict.where(AssignmentRow.id != excluding)
            if conn.execute(conflict.limit(1)).first() is not None:
                raise DomainError("ADJUDICATOR_IS_ANNOTATOR")
        return language, languages, mismatch

    def _create(
        self,
        conn: Connection,
        actor: Actor,
        project: RowMapping,
        document_id: str,
        target: int,
        task: Task,
        eligibility: tuple[str, list[str], bool],
        now: datetime,
    ) -> Assignment:
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
            )
            .returning(AssignmentRow.id)
        ).scalar_one()
        language, languages, mismatch = eligibility
        if mismatch:
            record_audit(
                conn,
                actor,
                "assignment.language_override",
                target_type="assignment",
                target_id=assignment_id,
                project_id=project["id"],
                details={"document_language": language, "user_languages": languages},
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
    ) -> Assignment:
        with self.db.transaction() as conn:
            target = self._target(conn, username)
            project = self._prepare(conn, actor, key, target)
            existing = self.active_for(conn, project["id"], document_id, target, task)
            if existing is not None:
                self._require_target(conn, project, target, task)
                return existing
            eligibility = self._eligible(
                conn, project, document_id, target, task, confirm_language
            )
            return self._create(
                conn,
                actor,
                project,
                document_id,
                target,
                task,
                eligibility,
                self._now(),
            )

    def reassign(
        self,
        actor: Actor,
        assignment_id: int,
        username: str,
        *,
        confirm_started: bool = False,
        confirm_language: bool = False,
    ) -> Assignment:
        with self.db.transaction() as conn:
            key = self._locate(conn, assignment_id)
            target = self._target(conn, username)
            project = self._prepare(conn, actor, key, target)
            old = self._locked(conn, assignment_id)
            if old["status"] != "open" and not confirm_started:
                raise DomainError("REASSIGN_CONFIRMATION_REQUIRED")
            task = cast(Task, old["task"])
            existing = self.active_for(
                conn, project["id"], old["document_id"], target, task
            )
            if existing is not None and existing.id != assignment_id:
                raise DomainError("ASSIGNMENT_EXISTS")
            eligibility = self._eligible(
                conn,
                project,
                old["document_id"],
                target,
                task,
                confirm_language,
                excluding=assignment_id,
            )
            now = self._now()
            revoke_assignments(
                conn, actor, project["id"], [dict(old)], now, reason="reassign"
            )
            new = self._create(
                conn, actor, project, old["document_id"], target, task, eligibility, now
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
            self._require_target(conn, project, target, cast(Task, old["task"]))
            now = self._now()
            conn.execute(
                update(AssignmentRow)
                .where(AssignmentRow.id == assignment_id)
                .values(status="reopened", updated_at=now)
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
        # One statement rechecks current account/membership/task role, including
        # retained submitted history after a membership removal (R25).
        from ontocurator.authz.policy import TASK_ROLES

        eligible = exists(
            select(ProjectMembershipRow.user_id).where(
                ProjectMembershipRow.project_id == AssignmentRow.project_id,
                ProjectMembershipRow.user_id == user_id,
                ProjectMembershipRow.role.in_(TASK_ROLES["annotate"]),
            )
        ).where(AssignmentRow.task == "annotate")
        review = exists(
            select(ProjectMembershipRow.user_id).where(
                ProjectMembershipRow.project_id == AssignmentRow.project_id,
                ProjectMembershipRow.user_id == user_id,
                ProjectMembershipRow.role.in_(TASK_ROLES["review"]),
            )
        ).where(AssignmentRow.task == "review")
        query = (
            select(
                AssignmentRow.id.label("assignment_id"),
                ProjectRow.project_key,
                ProjectRow.name.label("project_name"),
                AssignmentRow.document_id,
                DocumentRow.language,
                AssignmentRow.task,
                AssignmentRow.status,
                AssignmentRow.updated_at,
            )
            .join(ProjectRow, ProjectRow.id == AssignmentRow.project_id)
            .join(
                DocumentRow,
                (DocumentRow.project_id == AssignmentRow.project_id)
                & (DocumentRow.document_id == AssignmentRow.document_id),
            )
            .join(UserRow, UserRow.id == AssignmentRow.user_id)
            .where(
                AssignmentRow.user_id == user_id,
                AssignmentRow.revoked_at.is_(None),
                UserRow.active.is_(True),
                eligible | review,
            )
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
            return [TaskSummary(**row) for row in conn.execute(query).mappings()]
