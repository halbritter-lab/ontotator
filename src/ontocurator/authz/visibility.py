"""Authoritative document visibility and current task authority."""

from __future__ import annotations

from dataclasses import dataclass
from typing import cast

from sqlalchemy import Connection, select

from ontocurator.authz.policy import TASK_ROLES, Access, Action, Role, can
from ontocurator.domain.errors import DomainError
from ontocurator.storage.tables import (
    AssignmentRow,
    ProjectMembershipRow,
    UserRow,
)


@dataclass(frozen=True)
class DocumentFilter:
    all: bool
    document_ids: frozenset[str] = frozenset()


def current_access(
    conn: Connection, access: Access, project_id: int, project_key: str
) -> Access:
    user = conn.execute(
        select(UserRow.active, UserRow.is_system_admin, UserRow.pseudonym).where(
            UserRow.id == access.user_id
        )
    ).one_or_none()
    roles = frozenset(
        cast(Role, role)
        for role in conn.execute(
            select(ProjectMembershipRow.role).where(
                ProjectMembershipRow.project_id == project_id,
                ProjectMembershipRow.user_id == access.user_id,
            )
        ).scalars()
    )
    if user is None or not user.active:
        return Access(access.user_id, access.pseudonym, False)
    return Access(
        access.user_id, user.pseudonym, user.is_system_admin, {project_key: roles}
    )


def visible_documents(
    conn: Connection, access: Access, project_id: int, project_key: str
) -> DocumentFilter:
    fresh = current_access(conn, access, project_id, project_key)
    if can(fresh, Action.VIEW_ALL_DOCUMENTS, project_key):
        return DocumentFilter(True)
    tasks = [
        task
        for task, roles in TASK_ROLES.items()
        if fresh.roles_in(project_key) & roles
    ]
    if not tasks:
        return DocumentFilter(False)
    ids = conn.execute(
        select(AssignmentRow.document_id)
        .where(
            AssignmentRow.project_id == project_id,
            AssignmentRow.user_id == fresh.user_id,
            AssignmentRow.task.in_(tasks),
            AssignmentRow.revoked_at.is_(None),
        )
        .distinct()
    ).scalars()
    return DocumentFilter(False, frozenset(ids))


def require_document(
    conn: Connection,
    access: Access,
    project_id: int,
    project_key: str,
    document_id: str,
) -> None:
    visibility = visible_documents(conn, access, project_id, project_key)
    if not visibility.all and document_id not in visibility.document_ids:
        raise DomainError("DOCUMENT_NOT_FOUND")
