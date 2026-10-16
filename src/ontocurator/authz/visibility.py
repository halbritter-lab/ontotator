"""Authoritative document visibility and current task authority."""

from __future__ import annotations

from dataclasses import dataclass
from typing import cast

from sqlalchemy import Connection, and_, exists, or_, select
from sqlalchemy.orm import aliased
from sqlalchemy.sql.elements import ColumnElement

from ontocurator.authz.policy import TASK_ROLES, Access, Action, Role, can
from ontocurator.domain.errors import DomainError
from ontocurator.storage.tables import (
    AssignmentRow,
    DocumentRow,
    ProjectMembershipRow,
    ProjectRow,
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
            qualifying_assignment(fresh.user_id),
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


def qualifying_assignment(user_id: int) -> ColumnElement[bool]:
    """Central SQL predicate shared by document and cross-project projections."""
    return and_(
        AssignmentRow.user_id == user_id,
        AssignmentRow.revoked_at.is_(None),
        exists().where(UserRow.id == user_id, UserRow.active.is_(True)),
        or_(
            *(
                and_(
                    AssignmentRow.task == task,
                    exists().where(
                        ProjectMembershipRow.project_id == AssignmentRow.project_id,
                        ProjectMembershipRow.user_id == user_id,
                        ProjectMembershipRow.role.in_(roles),
                    ),
                )
                for task, roles in TASK_ROLES.items()
            )
        ),
    )


def readable_case_documents(
    conn: Connection, access: Access, project_id: int, project_key: str
) -> DocumentFilter:
    """Immutable sibling text only; never replace exact annotation/work guards."""
    fresh = current_access(conn, access, project_id, project_key)
    if can(fresh, Action.VIEW_ALL_DOCUMENTS, project_key):
        return DocumentFilter(True)
    assigned_cases = (
        select(DocumentRow.case_id)
        .join(
            AssignmentRow,
            and_(
                AssignmentRow.project_id == DocumentRow.project_id,
                AssignmentRow.document_id == DocumentRow.document_id,
            ),
        )
        .where(
            DocumentRow.project_id == project_id, qualifying_assignment(fresh.user_id)
        )
    )
    ids = conn.execute(
        select(DocumentRow.document_id).where(
            DocumentRow.project_id == project_id,
            DocumentRow.case_id.in_(assigned_cases),
        )
    ).scalars()
    return DocumentFilter(False, frozenset(ids))


def require_case_text(
    conn: Connection,
    access: Access,
    project_id: int,
    project_key: str,
    document_id: str,
) -> None:
    fresh = current_access(conn, access, project_id, project_key)
    if not can(fresh, Action.VIEW_PROJECT, project_key):
        raise DomainError("PROJECT_NOT_FOUND")
    if can(fresh, Action.VIEW_ALL_DOCUMENTS, project_key):
        if (
            conn.execute(
                select(DocumentRow.document_id).where(
                    DocumentRow.project_id == project_id,
                    DocumentRow.document_id == document_id,
                )
            ).first()
            is None
        ):
            raise DomainError("DOCUMENT_NOT_FOUND")
        return
    target = aliased(DocumentRow)
    sibling = aliased(DocumentRow)
    assigned_case = (
        select(AssignmentRow.id)
        .join(
            sibling,
            and_(
                sibling.project_id == AssignmentRow.project_id,
                sibling.document_id == AssignmentRow.document_id,
            ),
        )
        .where(
            AssignmentRow.project_id == project_id,
            sibling.case_id == target.case_id,
            qualifying_assignment(fresh.user_id),
        )
        .exists()
    )
    found = conn.execute(
        select(target.document_id).where(
            target.project_id == project_id,
            target.document_id == document_id,
            assigned_case,
        )
    ).first()
    if found is None:
        raise DomainError("DOCUMENT_NOT_FOUND")


def project_document_filters(
    conn: Connection, access: Access
) -> dict[str, DocumentFilter]:
    """All currently visible projects in three bounded queries."""
    user = (
        conn.execute(select(UserRow).where(UserRow.id == access.user_id))
        .mappings()
        .one_or_none()
    )
    if user is None or not user["active"]:
        return {}
    rows = conn.execute(
        select(
            ProjectRow.id, ProjectRow.project_key, ProjectMembershipRow.role
        ).outerjoin(
            ProjectMembershipRow,
            and_(
                ProjectMembershipRow.project_id == ProjectRow.id,
                ProjectMembershipRow.user_id == access.user_id,
            ),
        )
    ).all()
    roles: dict[str, set[Role]] = {}
    projects = {}
    for project_id, key, role in rows:
        projects[key] = project_id
        if role is not None:
            roles.setdefault(key, set()).add(cast(Role, role))
    fresh = Access(
        access.user_id,
        user["pseudonym"],
        user["is_system_admin"],
        {key: frozenset(value) for key, value in roles.items()},
    )
    assigned: dict[int, set[str]] = {}
    for project_id, document_id in conn.execute(
        select(AssignmentRow.project_id, AssignmentRow.document_id)
        .where(qualifying_assignment(access.user_id))
        .distinct()
    ):
        assigned.setdefault(project_id, set()).add(document_id)
    return {
        key: DocumentFilter(
            can(fresh, Action.VIEW_ALL_DOCUMENTS, key),
            frozenset(assigned.get(project_id, ())),
        )
        for key, project_id in projects.items()
        if can(fresh, Action.VIEW_PROJECT, key)
    }
