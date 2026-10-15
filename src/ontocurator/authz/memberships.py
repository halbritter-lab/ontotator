"""Project memberships: who holds which roles in which project (T2 P5, E9).

A membership is one row per role. Adding or removing roles is audited and
ends the user's sessions (D2: a role change revokes the affected sessions).
``access_for`` reads a principal's roles once per request.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from datetime import UTC, datetime
from typing import Any, Protocol, cast

from sqlalchemy import Connection, Row, delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ontocurator.auth.accounts import normalize_username
from ontocurator.auth.audit import Actor, record_audit
from ontocurator.auth.tokens import revoke_user_sessions
from ontocurator.authz.policy import ROLES, Access, Action, Role
from ontocurator.authz.project_authority import require_project_management
from ontocurator.domain.errors import DomainError
from ontocurator.storage.database import Database
from ontocurator.storage.tables import ProjectMembershipRow, ProjectRow, UserRow


class Identity(Protocol):
    """What ``access_for`` needs of a principal."""

    @property
    def user_id(self) -> int: ...

    @property
    def pseudonym(self) -> str: ...

    @property
    def is_system_admin(self) -> bool: ...


def check_roles(roles: Iterable[str]) -> frozenset[Role]:
    """The roles as a set; empty or unknown roles are refused.

    Raises:
        DomainError: ``ROLE_INVALID``.
    """
    given = frozenset(roles)
    unknown = sorted(given - set(ROLES))
    if not given or unknown:
        raise DomainError(
            "ROLE_INVALID",
            f"Roles are {', '.join(ROLES)}"
            + (f"; unknown: {', '.join(unknown)}." if unknown else "; none given."),
        )
    return cast(frozenset[Role], given)


def _project_id(conn: Connection, project_key: str) -> int:
    project_id = conn.execute(
        select(ProjectRow.id).where(ProjectRow.project_key == project_key)
    ).scalar_one_or_none()
    if project_id is None:
        raise DomainError("PROJECT_NOT_FOUND", f"There is no project '{project_key}'.")
    return project_id


def _lock_user(conn: Connection, username: str) -> Row[Any]:
    """Lock the target after its membership lock, compatible with audit FKs."""
    name = normalize_username(username)
    row = conn.execute(
        select(UserRow.id, UserRow.username)
        .where(UserRow.username == name)
        .with_for_update(key_share=True)
    ).one_or_none()
    if row is None:
        raise DomainError("USER_NOT_FOUND", f"There is no user '{name}'.")
    return row


def grant_roles(
    conn: Connection,
    actor: Actor,
    project_id: int,
    user_id: int,
    username: str,
    roles: Iterable[Role],
    now: datetime,
) -> list[Role]:
    """Insert the roles the user lacks and audit them; the roles added.

    Ends no session: the caller decides (see ``MembershipService.add``).
    """
    added = [
        role
        for role in sorted(roles)
        if conn.execute(
            pg_insert(ProjectMembershipRow)
            .values(
                project_id=project_id,
                user_id=user_id,
                role=role,
                added_at=now,
                added_by=actor.user_id,
            )
            .on_conflict_do_nothing()
            .returning(ProjectMembershipRow.role)
        ).scalar_one_or_none()
        is not None
    ]
    if added:
        record_audit(
            conn,
            actor,
            "project.member_add",
            target_type="user",
            target_id=username,
            project_id=project_id,
            details={"username": username, "roles": added},
            at=now,
        )
    return added


class MembershipService:
    """Members of projects and the request access derived from them."""

    def __init__(
        self,
        db: Database,
        *,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self.db = db
        self._now = now

    def add(
        self, actor: Actor, project_key: str, username: str, roles: Iterable[str]
    ) -> frozenset[Role]:
        """Give ``username`` these roles in the project; their sessions end.

        Roles the user holds already change nothing; when no role is new,
        nothing is audited and no session ends. Returns the user's roles in
        the project afterwards.

        Raises:
            DomainError: ``ROLE_INVALID``, ``PROJECT_NOT_FOUND``,
                ``USERNAME_INVALID`` or ``USER_NOT_FOUND``.
        """
        wanted = check_roles(roles)
        now = self._now()
        with self.db.transaction() as conn:
            self._lock_project(conn, project_key)
            project_id = _project_id(conn, project_key)
            user_id = self._user_id(conn, username)
            require_project_management(
                conn,
                actor,
                project_key,
                project_id,
                Action.MANAGE_MEMBERS,
                target_user_id=user_id,
            )
            user = _lock_user(conn, username)
            added = grant_roles(
                conn, actor, project_id, user.id, user.username, wanted, now
            )
            if added:
                revoke_user_sessions(conn, user.id, "project.member_add", now)
            return self._roles(conn, project_id, user.id)

    def remove(
        self,
        actor: Actor,
        project_key: str,
        username: str,
        roles: Iterable[str] | None = None,
        *,
        revoke_assignments: bool = False,
    ) -> frozenset[Role]:
        """Take roles (all if ``roles`` is None) from ``username``; sessions end.

        Removing roles the user does not hold changes nothing, audits nothing
        and ends no session. Returns the user's roles in the project afterwards.

        Raises:
            DomainError: ``ROLE_INVALID``, ``PROJECT_NOT_FOUND``,
                ``USERNAME_INVALID`` or ``USER_NOT_FOUND``.
        """
        wanted = None if roles is None else check_roles(roles)
        with self.db.transaction() as conn:
            self._lock_project(conn, project_key)
            project_id = _project_id(conn, project_key)
            user_id = self._user_id(conn, username)
            current = self._roles(conn, project_id, user_id)
            return self.set_roles(
                actor,
                project_key,
                username,
                current - (wanted if wanted is not None else current),
                revoke_assignments=revoke_assignments,
            )

    @staticmethod
    def _user_id(conn: Connection, username: str) -> int:
        name = normalize_username(username)
        user_id = conn.execute(
            select(UserRow.id).where(UserRow.username == name)
        ).scalar_one_or_none()
        if user_id is None:
            raise DomainError("USER_NOT_FOUND", f"There is no user '{name}'.")
        return user_id

    @staticmethod
    def _lock_project(conn: Connection, key: str) -> None:
        # A dedicated project membership lock serializes last-lead checks.
        # It is always acquired before user/assignment rows. NO KEY UPDATE on
        # targets remains compatible with audit actor and added_by FK locks.
        from ontocurator.storage.repository import _lock_id

        conn.execute(select(func.pg_advisory_xact_lock(_lock_id("members", key))))

    def set_roles(
        self,
        actor: Actor,
        project_key: str,
        username: str,
        roles: Iterable[str],
        *,
        revoke_assignments: bool = False,
    ) -> frozenset[Role]:
        """Replace roles atomically; removal confirms and revokes open work."""
        from ontocurator.projects.assignments import revoke_assignments as revoke_work
        from ontocurator.projects.assignments import unsupported_assignments

        given = frozenset(roles)
        wanted = check_roles(given) if given else frozenset()
        now = self._now()
        with self.db.transaction() as conn:
            self._lock_project(conn, project_key)
            project_id = _project_id(conn, project_key)
            user_id = self._user_id(conn, username)
            require_project_management(
                conn,
                actor,
                project_key,
                project_id,
                Action.MANAGE_MEMBERS,
                target_user_id=user_id,
            )
            user = _lock_user(conn, username)
            current = self._roles(conn, project_id, user.id)
            if current == wanted:
                return current
            removed = current - wanted
            admin = actor.user_id is None and actor.label.startswith("cli:")
            if actor.user_id is not None:
                admin = bool(
                    conn.execute(
                        select(UserRow.is_system_admin).where(
                            UserRow.id == actor.user_id
                        )
                    ).scalar_one()
                )
            if "lead" in removed and not admin:
                another = conn.execute(
                    select(ProjectMembershipRow.user_id)
                    .where(
                        ProjectMembershipRow.project_id == project_id,
                        ProjectMembershipRow.role == "lead",
                        ProjectMembershipRow.user_id != user.id,
                    )
                    .limit(1)
                ).first()
                if another is None:
                    raise DomainError(
                        "LAST_LEAD", "The project's last lead cannot be removed."
                    )
            # Only tasks whose actual required role is being removed need confirmation.
            affected = (
                unsupported_assignments(conn, project_id, user.id, removed)
                if removed & {"annotator", "adjudicator"}
                else []
            )
            if affected and not revoke_assignments:
                raise DomainError("MEMBER_HAS_ASSIGNMENTS", {"assignments": affected})
            revoke_work(conn, actor, project_id, affected, now)
            if removed:
                conn.execute(
                    delete(ProjectMembershipRow).where(
                        ProjectMembershipRow.project_id == project_id,
                        ProjectMembershipRow.user_id == user.id,
                        ProjectMembershipRow.role.in_(removed),
                    )
                )
                record_audit(
                    conn,
                    actor,
                    "project.member_remove",
                    target_type="user",
                    target_id=user.username,
                    project_id=project_id,
                    details={"username": user.username, "roles": sorted(removed)},
                    at=now,
                )
            grant_roles(
                conn, actor, project_id, user.id, user.username, wanted - current, now
            )
            revoke_user_sessions(conn, user.id, "project.member_roles", now)
            return wanted

    def members(self, project_key: str) -> list[tuple[str, str, frozenset[Role]]]:
        """``(username, pseudonym, roles)`` of every member, by username.

        Raises:
            DomainError: ``PROJECT_NOT_FOUND``.
        """
        with self.db.transaction() as conn:
            project_id = _project_id(conn, project_key)
            rows = conn.execute(
                select(UserRow.username, UserRow.pseudonym, ProjectMembershipRow.role)
                .join(UserRow, UserRow.id == ProjectMembershipRow.user_id)
                .where(ProjectMembershipRow.project_id == project_id)
                .order_by(UserRow.username, ProjectMembershipRow.role)
            ).all()
        members: dict[str, tuple[str, set[Role]]] = {}
        for username, pseudonym, role in rows:
            members.setdefault(username, (pseudonym, set()))[1].add(role)
        return [
            (username, pseudonym, frozenset(roles))
            for username, (pseudonym, roles) in members.items()
        ]

    def access_for(self, principal: Identity) -> Access:
        """The principal's system flag and roles per project key."""
        with self.db.transaction() as conn:
            rows = conn.execute(
                select(ProjectRow.project_key, ProjectMembershipRow.role)
                .join(ProjectRow, ProjectRow.id == ProjectMembershipRow.project_id)
                .where(ProjectMembershipRow.user_id == principal.user_id)
            ).all()
        roles: dict[str, set[Role]] = {}
        for project_key, role in rows:
            roles.setdefault(project_key, set()).add(role)
        return Access(
            user_id=principal.user_id,
            pseudonym=principal.pseudonym,
            is_system_admin=principal.is_system_admin,
            roles={key: frozenset(value) for key, value in roles.items()},
        )

    @staticmethod
    def _roles(conn: Connection, project_id: int, user_id: int) -> frozenset[Role]:
        roles = conn.execute(
            select(ProjectMembershipRow.role).where(
                ProjectMembershipRow.project_id == project_id,
                ProjectMembershipRow.user_id == user_id,
            )
        ).scalars()
        return frozenset(cast(Role, role) for role in roles)
