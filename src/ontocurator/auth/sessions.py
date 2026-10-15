"""Server-side sessions and login throttling (T2 D2, index D-j, Q6, Q8).

A session token is a random secret held by the browser; the database stores
only its SHA-256. Every failed login is recorded in ``login_attempts``, and
too many failures of one account or from one address within the window lock
further logins until older failures leave the window. Every failure, whatever
its reason, raises the same ``LoginFailed``.
"""

from __future__ import annotations

import hashlib
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import Connection, func, insert, select, update

from ontocurator.auth.passwords import hash_password, needs_rehash, verify_password
from ontocurator.domain.errors import DomainError, LoginFailed
from ontocurator.storage.database import Database
from ontocurator.storage.tables import (
    LoginAttemptRow,
    PasswordCredentialRow,
    SessionRow,
    UserRow,
)

# ``last_seen_at`` is written at most this often, not on every request.
LAST_SEEN_RESOLUTION = timedelta(seconds=60)
# Longer input is cut before it is recorded as an attempt.
MAX_RECORDED_USERNAME = 128
MAX_RECORDED_USER_AGENT = 512


@dataclass(frozen=True)
class SessionPolicy:
    """Session lifetimes (Q6) and the login lockout (Q8)."""

    idle: timedelta = timedelta(hours=12)
    absolute: timedelta = timedelta(days=14)
    window: timedelta = timedelta(minutes=15)
    failures_per_account: int = 5
    failures_per_address: int = 30


@dataclass(frozen=True)
class Principal:
    """The logged-in user behind a request."""

    user_id: int
    username: str
    display_name: str
    pseudonym: str
    is_system_admin: bool
    session_id: int
    csrf_token: str


def token_digest(token: str) -> str:
    """The stored form of a session token or a single-use code."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def revoke_user_sessions(
    conn: Connection, user_id: int, reason: str, at: datetime
) -> int:
    """End every open session of ``user_id``; the number of sessions ended."""
    result = conn.execute(
        update(SessionRow)
        .where(SessionRow.user_id == user_id, SessionRow.revoked_at.is_(None))
        .values(revoked_at=at, revoked_reason=reason)
    )
    return result.rowcount


def _attempt_name(username: str) -> str:
    """The name a login attempt is counted under, also for invalid input."""
    # Imported here: ``accounts`` imports this module for revoking sessions.
    from ontocurator.auth.accounts import normalize_username

    try:
        return normalize_username(username)
    except DomainError:
        return username.strip().lower()[:MAX_RECORDED_USERNAME]


class SessionService:
    """Login, session lookup and logout."""

    def __init__(
        self,
        db: Database,
        policy: SessionPolicy | None = None,
        *,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self.db = db
        self.policy = policy or SessionPolicy()
        self._now = now

    def login(
        self,
        username: str,
        password: str,
        *,
        client_ip: str,
        user_agent: str | None = None,
    ) -> tuple[str, Principal]:
        """A new session token and its principal.

        Raises:
            LoginFailed: for a wrong password, an unknown or inactive user, or
                a locked account or address. The attempt is committed first,
                so the failure counts towards the lockout.
        """
        now = self._now()
        name = _attempt_name(username)
        started: tuple[str, Principal] | None = None
        with self.db.transaction() as conn:
            user = conn.execute(
                select(UserRow).where(UserRow.username == name)
            ).one_or_none()
            stored_hash = None
            if user is not None and user.active:
                stored_hash = conn.execute(
                    select(PasswordCredentialRow.password_hash).where(
                        PasswordCredentialRow.user_id == user.id
                    )
                ).scalar_one_or_none()
            locked = self._locked(conn, name, client_ip, now)
            # Argon2 runs once in every case, locked or not (index D-j).
            matches = verify_password(stored_hash, password)
            succeeded = matches and not locked and user is not None
            conn.execute(
                insert(LoginAttemptRow).values(
                    username=name, client_ip=client_ip, succeeded=succeeded, at=now
                )
            )
            if succeeded and user is not None and stored_hash is not None:
                if needs_rehash(stored_hash):
                    conn.execute(
                        update(PasswordCredentialRow)
                        .where(PasswordCredentialRow.user_id == user.id)
                        .values(password_hash=hash_password(password), changed_at=now)
                    )
                token = secrets.token_urlsafe(32)
                csrf_token = secrets.token_urlsafe(32)
                session_id = conn.execute(
                    insert(SessionRow)
                    .values(
                        user_id=user.id,
                        token_sha256=token_digest(token),
                        csrf_token=csrf_token,
                        created_at=now,
                        last_seen_at=now,
                        expires_at=now + self.policy.absolute,
                        client_ip=client_ip,
                        user_agent=user_agent[:MAX_RECORDED_USER_AGENT]
                        if user_agent
                        else None,
                    )
                    .returning(SessionRow.id)
                ).scalar_one()
                started = (
                    token,
                    Principal(
                        user_id=user.id,
                        username=user.username,
                        display_name=user.display_name,
                        pseudonym=user.pseudonym,
                        is_system_admin=user.is_system_admin,
                        session_id=session_id,
                        csrf_token=csrf_token,
                    ),
                )
        # Raised only now: inside the transaction it would roll back the attempt.
        if started is None:
            raise LoginFailed()
        return started

    def _locked(
        self, conn: Connection, username: str, client_ip: str, now: datetime
    ) -> bool:
        """Whether recent failures lock this account or this address."""
        since = now - self.policy.window
        recent_failures = (
            select(func.count())
            .select_from(LoginAttemptRow)
            .where(
                LoginAttemptRow.succeeded.is_(False),
                LoginAttemptRow.at >= since,
                LoginAttemptRow.at <= now,
            )
        )
        account = conn.execute(
            recent_failures.where(LoginAttemptRow.username == username)
        ).scalar_one()
        if account >= self.policy.failures_per_account:
            return True
        address = conn.execute(
            recent_failures.where(LoginAttemptRow.client_ip == client_ip)
        ).scalar_one()
        return bool(address >= self.policy.failures_per_address)

    def resolve(self, token: str) -> Principal | None:
        """The principal of an open session of an active user, or None.

        A session past its lifetime or idle for too long is revoked as
        ``expired``.
        """
        if not token:
            return None
        now = self._now()
        with self.db.transaction() as conn:
            row = conn.execute(
                select(
                    SessionRow.id,
                    SessionRow.csrf_token,
                    SessionRow.last_seen_at,
                    SessionRow.expires_at,
                    UserRow.id.label("user_id"),
                    UserRow.username,
                    UserRow.display_name,
                    UserRow.pseudonym,
                    UserRow.is_system_admin,
                    UserRow.active,
                )
                .join(UserRow, UserRow.id == SessionRow.user_id)
                .where(
                    SessionRow.token_sha256 == token_digest(token),
                    SessionRow.revoked_at.is_(None),
                )
            ).one_or_none()
            if row is None or not row.active:
                return None
            if now >= row.expires_at or now - row.last_seen_at > self.policy.idle:
                conn.execute(
                    update(SessionRow)
                    .where(SessionRow.id == row.id, SessionRow.revoked_at.is_(None))
                    .values(revoked_at=now, revoked_reason="expired")
                )
                return None
            if now - row.last_seen_at >= LAST_SEEN_RESOLUTION:
                conn.execute(
                    update(SessionRow)
                    .where(SessionRow.id == row.id)
                    .values(last_seen_at=now)
                )
            return Principal(
                user_id=row.user_id,
                username=row.username,
                display_name=row.display_name,
                pseudonym=row.pseudonym,
                is_system_admin=row.is_system_admin,
                session_id=row.id,
                csrf_token=row.csrf_token,
            )

    def logout(self, session_id: int) -> None:
        """End one session; the user's other sessions stay open."""
        now = self._now()
        with self.db.transaction() as conn:
            conn.execute(
                update(SessionRow)
                .where(SessionRow.id == session_id, SessionRow.revoked_at.is_(None))
                .values(revoked_at=now, revoked_reason="logout")
            )
