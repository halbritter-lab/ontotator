"""Fresh project management policy while membership and user locks are held."""

from typing import cast

from sqlalchemy import Connection, select

from ontotator.auth.audit import Actor
from ontotator.auth.authority import lock_user_authority
from ontotator.authz.policy import Access, Action, Role, can
from ontotator.domain.errors import AccessDenied, DomainError, NotAuthenticated
from ontotator.storage.tables import ProjectMembershipRow, ProjectRow


def require_project_management(
    conn: Connection,
    actor: Actor,
    key: str,
    project_id: int,
    action: Action,
    *,
    target_user_id: int | None = None,
) -> None:
    """Caller holds the members lock through commit; lock fresh account flags.

    HTTP callers always have a user ID. Process actors remain trusted internal
    callers; only explicit CLI actors receive the last-lead admin exception.
    """
    if actor.user_id is None:
        return
    user = lock_user_authority(conn, actor.user_id, target_user_id=target_user_id)
    if not user["active"]:
        raise NotAuthenticated()
    roles = frozenset(
        cast(Role, role)
        for role in conn.execute(
            select(ProjectMembershipRow.role).where(
                ProjectMembershipRow.project_id == project_id,
                ProjectMembershipRow.user_id == actor.user_id,
            )
        ).scalars()
    )
    practice = conn.execute(
        select(ProjectRow.practice).where(ProjectRow.id == project_id)
    ).scalar_one_or_none()
    access = Access(
        user_id=actor.user_id,
        pseudonym=user["pseudonym"],
        is_system_admin=user["is_system_admin"],
        roles={key: roles},
        # Issue 266: admin rights do not reach a practice project.
        practice=frozenset({key}) if practice else frozenset(),
    )
    if not can(access, Action.VIEW_PROJECT, key):
        raise DomainError("PROJECT_NOT_FOUND", f"There is no project '{key}'.")
    if not can(access, action, key):
        raise AccessDenied("NOT_ALLOWED", "You may not manage this project.")
