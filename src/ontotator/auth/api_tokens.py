"""API tokens for scripts and integrations (issue 305).

A token is ``ott_`` followed by 32 random bytes (URL-safe base64). The
database stores only its SHA-256 (``token_digest``); the token itself is
shown once, when it is created.

Three kinds:

- ``personal``: acts as its owner, wherever its scopes allow.
- ``project``: created by a lead for one project; acts as that lead, only in
  that project. It stops working when its owner may no longer manage the
  project.
- ``system``: created by a system administrator; the only kind that may hold
  the ``admin`` scope. It stops working when its owner is no longer one.

What a request with a token may do is the intersection of the token's
scopes (``ontotator.api.token_scopes`` maps every route to one, or to
several any one of which is enough) and the owner's own rights, read
afresh on every request. A token never reaches the token routes, so it
cannot create, list or revoke tokens. A new or reset password, deactivation
and anonymisation revoke all of the owner's tokens; a lost role only the
tokens it backed (``ontotator.auth.tokens``).
"""

from __future__ import annotations

import secrets
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal, cast, get_args

from sqlalchemy import Connection, and_, exists, func, insert, select, update

from ontotator.auth.audit import Actor, record_audit
from ontotator.auth.sessions import Principal, TokenGrant
from ontotator.auth.tokens import token_digest
from ontotator.authz.policy import Action
from ontotator.authz.project_authority import require_project_management
from ontotator.domain.errors import AccessDenied, DomainError
from ontotator.storage.database import Database
from ontotator.storage.tables import (
    ApiTokenRow,
    ProjectMembershipRow,
    ProjectRow,
    UserRow,
)

TokenScope = Literal["read", "import", "export", "project-admin", "admin"]
TOKEN_SCOPES: tuple[TokenScope, ...] = get_args(TokenScope)
TokenKind = Literal["personal", "project", "system"]
TOKEN_KINDS: tuple[TokenKind, ...] = get_args(TokenKind)
SCOPE_DESCRIPTIONS: dict[TokenScope, str] = {
    "read": "Read projects, documents, results and progress.",
    "import": "Upload and commit texts into a project.",
    "export": "Start exports and download their files.",
    "project-admin": (
        "Configure a project, assign people and work, start consolidation."
    ),
    "admin": "Upload ontologies and translations, manage users (system tokens).",
}
TOKEN_PREFIX = "ott_"
DEFAULT_LIFETIME_DAYS = 90
MAX_LIFETIME_DAYS = 365
MAX_NAME_LENGTH = 100
# ``last_used_at`` is written at most this often, not on every request.
LAST_USED_RESOLUTION = timedelta(seconds=60)
# A real token is the prefix and 43 base64 characters; this only stops junk.
MAX_TOKEN_LENGTH = 128


@dataclass(frozen=True)
class ApiToken:
    """A token as people see it; never the secret."""

    id: int
    name: str
    kind: TokenKind
    owner: str
    owner_display_name: str
    project_key: str | None
    scopes: tuple[TokenScope, ...]
    created_at: datetime
    expires_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None
    revoked_reason: str | None


@dataclass(frozen=True)
class IssuedToken:
    """A new token and, this once, its secret."""

    secret: str
    token: ApiToken


def new_token() -> str:
    """A new token secret: ``ott_`` and 32 random bytes."""
    return TOKEN_PREFIX + secrets.token_urlsafe(32)


def check_scopes(scopes: Iterable[str], kind: TokenKind) -> tuple[TokenScope, ...]:
    """The scopes in vocabulary order, or ``TOKEN_SCOPES_INVALID``."""
    given = set(scopes)
    unknown = sorted(given - set(TOKEN_SCOPES))
    if unknown:
        raise DomainError(
            "TOKEN_SCOPES_INVALID", f"Unknown scope(s): {', '.join(unknown)}."
        )
    if not given:
        raise DomainError("TOKEN_SCOPES_INVALID", "Choose at least one scope.")
    if "admin" in given and kind != "system":
        raise DomainError(
            "TOKEN_SCOPES_INVALID",
            "Only a system token, created by a system administrator, may hold"
            " the admin scope.",
        )
    return tuple(scope for scope in TOKEN_SCOPES if scope in given)


def check_name(name: str) -> str:
    cleaned = " ".join(name.split())
    if not cleaned or len(cleaned) > MAX_NAME_LENGTH:
        raise DomainError(
            "TOKEN_NAME_INVALID",
            f"Give the token a name of 1 to {MAX_NAME_LENGTH} characters.",
        )
    return cleaned


def check_lifetime(days: int) -> timedelta:
    if not 1 <= days <= MAX_LIFETIME_DAYS:
        raise DomainError(
            "TOKEN_LIFETIME_INVALID",
            f"A token is valid for 1 to {MAX_LIFETIME_DAYS} days.",
        )
    return timedelta(days=days)


def _view_columns() -> tuple[object, ...]:
    return (
        ApiTokenRow.id,
        ApiTokenRow.name,
        ApiTokenRow.kind,
        UserRow.username,
        UserRow.display_name,
        ProjectRow.project_key,
        ApiTokenRow.scopes,
        ApiTokenRow.created_at,
        ApiTokenRow.expires_at,
        ApiTokenRow.last_used_at,
        ApiTokenRow.revoked_at,
        ApiTokenRow.revoked_reason,
    )


def _views(conn: Connection, *conditions: object) -> list[ApiToken]:
    statement = (
        select(*_view_columns())  # type: ignore[call-overload]
        .join(UserRow, UserRow.id == ApiTokenRow.owner_id)
        .outerjoin(ProjectRow, ProjectRow.id == ApiTokenRow.project_id)
        .where(*conditions)
        .order_by(ApiTokenRow.created_at.desc(), ApiTokenRow.id.desc())
    )
    return [
        ApiToken(
            id=row.id,
            name=row.name,
            kind=cast(TokenKind, row.kind),
            owner=row.username,
            owner_display_name=row.display_name,
            project_key=row.project_key,
            scopes=tuple(cast(TokenScope, scope) for scope in row.scopes),
            created_at=row.created_at,
            expires_at=row.expires_at,
            last_used_at=row.last_used_at,
            revoked_at=row.revoked_at,
            revoked_reason=row.revoked_reason,
        )
        for row in conn.execute(statement)
    ]


def token_usable(conn: Connection, token_id: int, now: datetime) -> bool:
    """Whether the token is neither revoked nor expired, read under a share lock.

    For HTTP writes that recheck their authority under row locks, as the
    session check of the admin routes does for a session.
    """
    row = conn.execute(
        select(ApiTokenRow.revoked_at, ApiTokenRow.expires_at)
        .where(ApiTokenRow.id == token_id)
        .with_for_update(read=True)
    ).one_or_none()
    return row is not None and row.revoked_at is None and now < row.expires_at


def _is_lead(conn: Connection, project_id: int, user_id: int) -> bool:
    return bool(
        conn.execute(
            select(
                exists().where(
                    ProjectMembershipRow.project_id == project_id,
                    ProjectMembershipRow.user_id == user_id,
                    ProjectMembershipRow.role == "lead",
                )
            )
        ).scalar_one()
    )


class ApiTokenService:
    """Create, list, revoke and resolve API tokens."""

    def __init__(
        self, db: Database, *, now: Callable[[], datetime] = lambda: datetime.now(UTC)
    ) -> None:
        self.db = db
        self._now = now

    # Creation

    def create(
        self,
        actor: Actor,
        owner: str,
        *,
        name: str,
        scopes: Iterable[str],
        kind: TokenKind = "personal",
        project_key: str | None = None,
        lifetime_days: int = DEFAULT_LIFETIME_DAYS,
    ) -> IssuedToken:
        """A new token of ``owner``, audited as ``api_token.create``.

        ``owner`` must be active; a ``system`` token needs a system admin,
        a ``project`` token someone who may manage ``project_key`` (a lead,
        or a system admin outside practice projects). Over HTTP the owner is
        the actor; the CLI may create a token for anyone who qualifies.

        Raises:
            DomainError: ``USER_NOT_FOUND``, ``USER_INACTIVE``,
                ``PROJECT_NOT_FOUND``, ``TOKEN_KIND_INVALID``,
                ``TOKEN_NAME_INVALID``, ``TOKEN_SCOPES_INVALID`` or
                ``TOKEN_LIFETIME_INVALID``.
            AccessDenied: ``ADMIN_REQUIRED`` for a system token of a
                non-admin, ``NOT_ALLOWED`` for a project token of someone
                who may not manage the project, ``TOKEN_NOT_ALLOWED`` for a
                practice project.
        """
        if kind not in TOKEN_KINDS:
            raise DomainError("TOKEN_KIND_INVALID", f"Unknown token kind '{kind}'.")
        if (kind == "project") != (project_key is not None):
            raise DomainError(
                "TOKEN_KIND_INVALID", "Only a project token names a project."
            )
        cleaned = check_name(name)
        granted = check_scopes(scopes, kind)
        lifetime = check_lifetime(lifetime_days)
        now = self._now()
        with self.db.transaction() as conn:
            project_id: int | None = None
            if project_key is not None:
                # Same lock order as membership changes: members, then users.
                from ontotator.storage.repository import _lock_id

                conn.execute(
                    select(
                        func.pg_advisory_xact_lock_shared(
                            _lock_id("members", project_key)
                        )
                    )
                )
            user = conn.execute(
                select(UserRow)
                .where(UserRow.username == owner.strip().lower())
                .with_for_update(read=True)
            ).one_or_none()
            if user is None:
                raise DomainError("USER_NOT_FOUND", f"There is no user '{owner}'.")
            if not user.active or user.anonymised_at is not None:
                raise DomainError(
                    "USER_INACTIVE", f"'{user.username}' is not an active account."
                )
            if kind == "system" and not user.is_system_admin:
                raise AccessDenied(
                    "ADMIN_REQUIRED",
                    "Only a system administrator may own a system token.",
                )
            if project_key is not None:
                project = conn.execute(
                    select(ProjectRow.id, ProjectRow.practice).where(
                        ProjectRow.project_key == project_key
                    )
                ).one_or_none()
                if project is None:
                    raise DomainError(
                        "PROJECT_NOT_FOUND", f"There is no project '{project_key}'."
                    )
                require_project_management(
                    conn,
                    Actor.user(user.id, user.username),
                    project_key,
                    project.id,
                    Action.MANAGE_PROJECT_SETTINGS,
                )
                if project.practice:
                    raise AccessDenied(
                        "TOKEN_NOT_ALLOWED", "A practice project has no API tokens."
                    )
                project_id = project.id
            secret = new_token()
            token_id = conn.execute(
                insert(ApiTokenRow)
                .values(
                    token_sha256=token_digest(secret),
                    name=cleaned,
                    kind=kind,
                    owner_id=user.id,
                    project_id=project_id,
                    scopes=list(granted),
                    created_at=now,
                    expires_at=now + lifetime,
                )
                .returning(ApiTokenRow.id)
            ).scalar_one()
            record_audit(
                conn,
                actor,
                "api_token.create",
                target_type="api_token",
                target_id=token_id,
                project_id=project_id,
                details={
                    "name": cleaned,
                    "kind": kind,
                    "owner": user.username,
                    "scopes": list(granted),
                    "expires_at": (now + lifetime).isoformat(),
                },
                at=now,
            )
            (view,) = _views(conn, ApiTokenRow.id == token_id)
        return IssuedToken(secret=secret, token=view)

    # Reading

    def list(
        self,
        *,
        owner_id: int | None = None,
        project_key: str | None = None,
        personal_only: bool = False,
    ) -> list[ApiToken]:
        """Tokens, newest first; filtered by owner, project or both.

        ``personal_only`` leaves out project tokens (an owner's own page).
        """
        conditions: list[object] = []
        if owner_id is not None:
            conditions.append(ApiTokenRow.owner_id == owner_id)
        if project_key is not None:
            conditions.append(ProjectRow.project_key == project_key)
        if personal_only:
            conditions.append(ApiTokenRow.project_id.is_(None))
        with self.db.transaction() as conn:
            return _views(conn, *conditions)

    # Revocation

    def revoke(
        self,
        actor: Actor,
        token_id: int,
        *,
        owner_id: int | None = None,
        project_key: str | None = None,
        reason: str = "revoked",
    ) -> ApiToken:
        """Revoke one token, audited as ``api_token.revoke``; idempotent.

        ``owner_id`` and ``project_key`` restrict which token may be named:
        another one is ``TOKEN_NOT_FOUND``, as is an unknown id.
        """
        now = self._now()
        with self.db.transaction() as conn:
            conditions: list[object] = [ApiTokenRow.id == token_id]
            if owner_id is not None:
                conditions.append(ApiTokenRow.owner_id == owner_id)
            if project_key is not None:
                conditions.append(
                    ApiTokenRow.project_id
                    == select(ProjectRow.id)
                    .where(ProjectRow.project_key == project_key)
                    .scalar_subquery()
                )
            row = conn.execute(
                select(ApiTokenRow.id, ApiTokenRow.revoked_at, ApiTokenRow.project_id)
                .where(and_(*conditions))  # type: ignore[arg-type]
                .with_for_update()
            ).one_or_none()
            if row is None:
                raise DomainError("TOKEN_NOT_FOUND", "There is no such token.")
            if row.revoked_at is None:
                conn.execute(
                    update(ApiTokenRow)
                    .where(ApiTokenRow.id == row.id)
                    .values(revoked_at=now, revoked_reason=reason)
                )
                (view,) = _views(conn, ApiTokenRow.id == row.id)
                record_audit(
                    conn,
                    actor,
                    "api_token.revoke",
                    target_type="api_token",
                    target_id=row.id,
                    project_id=row.project_id,
                    details={"name": view.name, "kind": view.kind, "owner": view.owner},
                    at=now,
                )
                return view
            (view,) = _views(conn, ApiTokenRow.id == row.id)
            return view

    # Use

    def resolve(self, secret: str) -> Principal | None:
        """The principal of a usable token, or None.

        Usable: well-formed, known, not revoked, not expired, of an active
        account; a system token's owner is still a system admin, a project
        token's owner may still manage its (non-practice) project.
        """
        if (
            not secret.startswith(TOKEN_PREFIX)
            or len(secret) > MAX_TOKEN_LENGTH
            or not secret.isascii()
        ):
            return None
        now = self._now()
        with self.db.transaction() as conn:
            row = conn.execute(
                select(
                    ApiTokenRow.id,
                    ApiTokenRow.name,
                    ApiTokenRow.kind,
                    ApiTokenRow.scopes,
                    ApiTokenRow.project_id,
                    ApiTokenRow.expires_at,
                    ApiTokenRow.last_used_at,
                    ProjectRow.project_key,
                    ProjectRow.practice,
                    UserRow.id.label("user_id"),
                    UserRow.username,
                    UserRow.display_name,
                    UserRow.pseudonym,
                    UserRow.is_system_admin,
                    UserRow.active,
                    UserRow.anonymised_at,
                )
                .join(UserRow, UserRow.id == ApiTokenRow.owner_id)
                .outerjoin(ProjectRow, ProjectRow.id == ApiTokenRow.project_id)
                .where(
                    ApiTokenRow.token_sha256 == token_digest(secret),
                    ApiTokenRow.revoked_at.is_(None),
                )
            ).one_or_none()
            if row is None or not row.active or row.anonymised_at is not None:
                return None
            if now >= row.expires_at:
                return None
            if row.kind == "system" and not row.is_system_admin:
                return None
            if row.kind == "project" and (
                row.practice
                or not (
                    row.is_system_admin or _is_lead(conn, row.project_id, row.user_id)
                )
            ):
                return None
            if row.last_used_at is None or now - row.last_used_at >= (
                LAST_USED_RESOLUTION
            ):
                conn.execute(
                    update(ApiTokenRow)
                    .where(ApiTokenRow.id == row.id)
                    .values(last_used_at=now)
                )
            return Principal(
                user_id=row.user_id,
                username=row.username,
                display_name=row.display_name,
                pseudonym=row.pseudonym,
                is_system_admin=row.is_system_admin,
                session_id=None,
                csrf_token="",
                token=TokenGrant(
                    token_id=row.id,
                    name=row.name,
                    kind=row.kind,
                    scopes=frozenset(row.scopes),
                    project_key=row.project_key,
                    project_id=row.project_id,
                ),
            )

    def record_use(self, principal: Principal, method: str, path: str) -> None:
        """Audit one write made with a token (``api_token.use``), before it runs.

        It commits on its own: the trail shows the attempt even when the
        write then fails or is refused.
        """
        grant = principal.token
        assert grant is not None
        with self.db.transaction() as conn:
            record_audit(
                conn,
                Actor.user(principal.user_id, principal.username),
                "api_token.use",
                target_type="api_token",
                target_id=grant.token_id,
                project_id=grant.project_id,
                details={
                    "method": method,
                    "path": path[:500],
                    "api_token": {"id": grant.token_id, "name": grant.name},
                },
                at=self._now(),
            )
