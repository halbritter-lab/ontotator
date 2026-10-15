"""Accounts: users, single-use codes, the first admin and recovery (T2 D2).

There is no self-registration and no e-mail: an administrator creates a user
and hands over a single-use setup code out of band; a forgotten password is
replaced through a reset code issued the same way. The first administrator is
created once from a supplied Argon2id hash, and a lost administrator password
is recovered offline. Every change is audited in its own transaction.

``users.credential_generation`` ties codes to the account state: a code
remembers the generation it was issued under and is refused once the
generation moved on. Setting a password, changing the admin flag or the
activation bumps it and ends all sessions of the user.
"""

from __future__ import annotations

import re
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from sqlalchemy import (
    Connection,
    Row,
    Sequence,
    delete,
    exists,
    func,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ontocurator.application.preferences import normalize_annotator_id
from ontocurator.auth.audit import Actor, record_audit
from ontocurator.auth.passwords import (
    PasswordRuleError,
    assert_policy,
    check_password_rules,
    hash_password,
)
from ontocurator.auth.sessions import revoke_user_sessions, token_digest
from ontocurator.domain.errors import DomainError
from ontocurator.storage.database import Database, advisory_lock_id
from ontocurator.storage.tables import (
    SCHEMA,
    InstanceStateRow,
    OneTimeCodeRow,
    PasswordCredentialRow,
    UserRow,
)

CodePurpose = Literal["setup", "reset"]
BootstrapResult = Literal["created", "already_done", "not_configured"]

CODE_LIFETIME: dict[str, timedelta] = {
    "setup": timedelta(hours=24),
    "reset": timedelta(minutes=15),
}
ADMIN_USERNAME = "admin"
ADMIN_DISPLAY_NAME = "Administrator"
BOOTSTRAP_KEY = "admin_bootstrapped"
BOOTSTRAP_LOCK = advisory_lock_id("bootstrap-admin")
CODE_INVALID_MESSAGE = (
    "The code is not valid. It may be mistyped, used, expired or replaced;"
    " ask an administrator for a new one."
)

_USERNAME = re.compile(r"[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]")
_PSEUDONYMS = Sequence("pseudonym_seq", schema=SCHEMA)


@dataclass(frozen=True)
class User:
    """An account, without its credential."""

    id: int
    username: str
    display_name: str
    email: str | None
    pseudonym: str
    is_system_admin: bool
    active: bool


@dataclass(frozen=True)
class IssuedCode:
    """A single-use code; ``code`` is the clear text, which is never stored."""

    user: User
    purpose: CodePurpose
    code: str
    expires_at: datetime


def normalize_username(value: str) -> str:
    """A username: trimmed, lower-case, 3 to 64 of ``a-z 0-9 . _ -``.

    It starts and ends with a letter or digit.

    Raises:
        DomainError: ``USERNAME_INVALID``.
    """
    username = value.strip().lower()
    if not _USERNAME.fullmatch(username):
        raise DomainError(
            "USERNAME_INVALID",
            "A username has 3 to 64 lower-case letters, digits, '.', '_' or '-',"
            " and starts and ends with a letter or digit.",
        )
    return username


def _user(row: Row[Any]) -> User:
    return User(
        id=row.id,
        username=row.username,
        display_name=row.display_name,
        email=row.email,
        pseudonym=row.pseudonym,
        is_system_admin=row.is_system_admin,
        active=row.active,
    )


def _code_invalid() -> DomainError:
    """The one error for every unusable code, so none can be told apart."""
    return DomainError("CODE_INVALID", CODE_INVALID_MESSAGE)


def _password_rules(exc: PasswordRuleError) -> DomainError:
    return DomainError("PASSWORD_RULES", str(exc))


class AccountService:
    """Users, single-use codes, the first admin and the offline recovery."""

    def __init__(
        self,
        db: Database,
        *,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self.db = db
        self._now = now

    # Reading

    def get_by_username(self, username: str) -> User | None:
        """The user called ``username`` (any case), or None."""
        try:
            name = normalize_username(username)
        except DomainError:
            return None
        with self.db.transaction() as conn:
            row = conn.execute(
                select(UserRow).where(UserRow.username == name)
            ).one_or_none()
        return None if row is None else _user(row)

    def list_users(self) -> list[User]:
        """All users, by username."""
        with self.db.transaction() as conn:
            rows = conn.execute(select(UserRow).order_by(UserRow.username)).all()
        return [_user(row) for row in rows]

    # Users and codes

    def create_user(
        self,
        actor: Actor,
        username: str,
        display_name: str,
        *,
        email: str | None = None,
        system_admin: bool = False,
        pseudonym: str | None = None,
    ) -> IssuedCode:
        """Create a user and issue its setup code.

        Raises:
            DomainError: ``USERNAME_INVALID``, ``USERNAME_TAKEN``,
                ``DISPLAY_NAME_INVALID``, ``PSEUDONYM_INVALID`` or
                ``PSEUDONYM_TAKEN``.
        """
        name = normalize_username(username)
        display = display_name.strip()
        if not display:
            raise DomainError("DISPLAY_NAME_INVALID", "The display name is empty.")
        given_pseudonym = None
        if pseudonym is not None:
            try:
                given_pseudonym = normalize_annotator_id(pseudonym)
            except ValueError as exc:
                raise DomainError(
                    "PSEUDONYM_INVALID", f"The pseudonym {exc}."
                ) from None
        now = self._now()
        with self.db.transaction() as conn:
            if conn.execute(select(exists().where(UserRow.username == name))).scalar():
                raise DomainError("USERNAME_TAKEN", f"'{name}' is already taken.")
            row = self._insert_user(
                conn,
                name,
                display,
                email=(email or "").strip() or None,
                system_admin=system_admin,
                pseudonym=given_pseudonym,
                now=now,
            )
            record_audit(
                conn,
                actor,
                "user.create",
                target_type="user",
                target_id=name,
                details={
                    "pseudonym": row.pseudonym,
                    "system_admin": row.is_system_admin,
                },
                at=now,
            )
            return self._issue_code(conn, actor, row, "setup", now)

    def _insert_user(
        self,
        conn: Connection,
        username: str,
        display_name: str,
        *,
        email: str | None,
        system_admin: bool,
        pseudonym: str | None,
        now: datetime,
    ) -> Row[Any]:
        """Insert a user; a concurrent creation of the same name is taken."""
        if pseudonym is None:
            pseudonym = self._next_pseudonym(conn)
        row = conn.execute(
            pg_insert(UserRow)
            .values(
                username=username,
                display_name=display_name,
                email=email,
                pseudonym=pseudonym,
                is_system_admin=system_admin,
                created_at=now,
                updated_at=now,
            )
            .on_conflict_do_nothing()
            .returning(*UserRow.__table__.columns)
        ).one_or_none()
        if row is not None:
            return row
        # A unique column collided, possibly with a transaction that committed
        # in between; READ COMMITTED lets this statement see its row.
        if conn.execute(select(exists().where(UserRow.username == username))).scalar():
            raise DomainError("USERNAME_TAKEN", f"'{username}' is already taken.")
        raise DomainError("PSEUDONYM_TAKEN", f"'{pseudonym}' is already used.")

    @staticmethod
    def _next_pseudonym(conn: Connection) -> str:
        """The next free ``ann-NNNN``; numbers an admin assigned by hand are skipped."""
        while True:
            number = conn.execute(select(_PSEUDONYMS.next_value())).scalar_one()
            candidate = f"ann-{number:04d}"
            if not conn.execute(
                select(exists().where(UserRow.pseudonym == candidate))
            ).scalar():
                return candidate

    def issue_reset_code(self, actor: Actor, username: str) -> IssuedCode:
        """A reset code for an active user; it replaces the user's unused codes.

        Raises:
            DomainError: ``USER_NOT_FOUND`` or ``USER_INACTIVE``.
        """
        now = self._now()
        with self.db.transaction() as conn:
            row = self._lock_user(conn, username)
            if not row.active:
                raise DomainError("USER_INACTIVE", f"'{row.username}' is deactivated.")
            record_audit(
                conn,
                actor,
                "user.reset_code",
                target_type="user",
                target_id=row.username,
                at=now,
            )
            return self._issue_code(conn, actor, row, "reset", now)

    def _issue_code(
        self,
        conn: Connection,
        actor: Actor,
        user: Row[Any],
        purpose: CodePurpose,
        now: datetime,
    ) -> IssuedCode:
        """Store a new code of ``user``; its other unused codes are deleted.

        A user has at most one usable code, so a reset code also ends an
        unused setup code.
        """
        conn.execute(
            delete(OneTimeCodeRow).where(
                OneTimeCodeRow.user_id == user.id, OneTimeCodeRow.used_at.is_(None)
            )
        )
        code = secrets.token_urlsafe(32)
        expires_at = now + CODE_LIFETIME[purpose]
        conn.execute(
            pg_insert(OneTimeCodeRow).values(
                user_id=user.id,
                purpose=purpose,
                code_sha256=token_digest(code),
                issued_by=actor.user_id,
                credential_generation=user.credential_generation,
                created_at=now,
                expires_at=expires_at,
            )
        )
        return IssuedCode(_user(user), purpose, code, expires_at)

    def redeem_code(self, username: str, code: str, new_password: str) -> User:
        """Set the password of ``username`` with a setup or reset code.

        The password rules are checked first, so a refused password leaves the
        code usable.

        Raises:
            DomainError: ``PASSWORD_RULES``, or ``CODE_INVALID`` for an
                unknown, used, expired, replaced or foreign code and for an
                unknown or inactive user (one message for all).
        """
        try:
            check_password_rules(username.strip(), new_password)
        except PasswordRuleError as exc:
            raise _password_rules(exc) from None
        new_hash = hash_password(new_password)
        now = self._now()
        with self.db.transaction() as conn:
            try:
                user = self._lock_user(conn, username)
            except DomainError:
                raise _code_invalid() from None
            # The user row is locked first, as in every account change, then
            # the code row: one code cannot be redeemed twice at once.
            row = conn.execute(
                select(OneTimeCodeRow)
                .where(OneTimeCodeRow.code_sha256 == token_digest(code))
                .with_for_update()
            ).one_or_none()
            if (
                not user.active
                or row is None
                or row.user_id != user.id
                or row.used_at is not None
                or row.expires_at <= now
                or row.credential_generation != user.credential_generation
            ):
                raise _code_invalid()
            conn.execute(
                update(OneTimeCodeRow)
                .where(OneTimeCodeRow.id == row.id)
                .values(used_at=now)
            )
            self._set_password(conn, user.id, new_hash, now, reason="password_set")
            record_audit(
                conn,
                Actor.user(user.id, user.username),
                "user.password_set",
                target_type="user",
                target_id=user.username,
                details={"purpose": row.purpose},
                at=now,
            )
            return _user(user)

    # Account changes that end the user's sessions

    def set_system_admin(self, actor: Actor, username: str, on: bool) -> User:
        """Grant or withdraw the system admin role; a change ends all sessions.

        Raises:
            DomainError: ``USER_NOT_FOUND``.
        """
        return self._set_flag(
            actor, username, "is_system_admin", on, "user.system_admin"
        )

    def set_active(self, actor: Actor, username: str, active: bool) -> User:
        """Activate or deactivate a user; a change ends all sessions.

        Raises:
            DomainError: ``USER_NOT_FOUND``.
        """
        return self._set_flag(actor, username, "active", active, "user.active")

    def _set_flag(
        self, actor: Actor, username: str, column: str, value: bool, action: str
    ) -> User:
        now = self._now()
        with self.db.transaction() as conn:
            row = self._lock_user(conn, username)
            if getattr(row, column) == value:
                return _user(row)  # nothing changes, nothing to audit
            conn.execute(
                update(UserRow).where(UserRow.id == row.id).values({column: value})
            )
            self._new_generation(conn, row.id, now, reason=action)
            record_audit(
                conn,
                actor,
                action,
                target_type="user",
                target_id=row.username,
                details={column: value},
                at=now,
            )
            return _user(self._lock_user(conn, row.username))

    # The first admin and the offline recovery

    def bootstrap_admin(self, password_hash: str | None) -> BootstrapResult:
        """Create ``admin`` from a supplied Argon2id hash, once per instance.

        Raises:
            DomainError: ``PASSWORD_RULES`` for a hash that ``assert_policy``
                refuses.
        """
        now = self._now()
        with self.db.transaction() as conn:
            conn.execute(select(func.pg_advisory_xact_lock(BOOTSTRAP_LOCK)))
            if conn.execute(
                select(exists().where(InstanceStateRow.key == BOOTSTRAP_KEY))
            ).scalar():
                return "already_done"
            if password_hash is None:
                return "not_configured"
            try:
                assert_policy(password_hash)
            except PasswordRuleError as exc:
                raise _password_rules(exc) from None
            row = conn.execute(
                select(UserRow)
                .where(UserRow.username == ADMIN_USERNAME)
                .with_for_update()
            ).one_or_none()
            if row is None:
                row = self._insert_user(
                    conn,
                    ADMIN_USERNAME,
                    ADMIN_DISPLAY_NAME,
                    email=None,
                    system_admin=True,
                    pseudonym=None,
                    now=now,
                )
            else:
                conn.execute(
                    update(UserRow)
                    .where(UserRow.id == row.id)
                    .values(is_system_admin=True, active=True)
                )
            self._set_password(conn, row.id, password_hash, now, reason="bootstrap")
            conn.execute(
                pg_insert(InstanceStateRow).values(
                    key=BOOTSTRAP_KEY,
                    value={"username": ADMIN_USERNAME, "at": now.isoformat()},
                    updated_at=now,
                )
            )
            record_audit(
                conn,
                Actor(None, "system:bootstrap"),
                "user.bootstrap",
                target_type="user",
                target_id=ADMIN_USERNAME,
                at=now,
            )
            return "created"

    def recover_admin(
        self, username: str, password_hash: str, operator: str, reason: str
    ) -> User:
        """Replace the password of an active system admin (offline recovery).

        Raises:
            DomainError: ``RECOVERY_INCOMPLETE`` without an operator or a
                reason, ``PASSWORD_RULES`` for a refused hash, or
                ``NOT_AN_ACTIVE_ADMIN``.
        """
        operator, reason = operator.strip(), reason.strip()
        if not operator or not reason:
            raise DomainError(
                "RECOVERY_INCOMPLETE", "Recovery needs an operator and a reason."
            )
        try:
            assert_policy(password_hash)
        except PasswordRuleError as exc:
            raise _password_rules(exc) from None
        now = self._now()
        with self.db.transaction() as conn:
            try:
                row = self._lock_user(conn, username)
            except DomainError:
                row = None
            if row is None or not (row.active and row.is_system_admin):
                raise DomainError(
                    "NOT_AN_ACTIVE_ADMIN",
                    f"'{username.strip()}' is not an active system admin.",
                )
            self._set_password(conn, row.id, password_hash, now, reason="recovered")
            record_audit(
                conn,
                Actor(None, f"recovery:{operator}"),
                "user.recovered",
                target_type="user",
                target_id=row.username,
                details={"reason": reason},
                at=now,
            )
            return _user(row)

    # Shared steps

    @staticmethod
    def _lock_user(conn: Connection, username: str) -> Row[Any]:
        """The user row, locked until the transaction ends.

        Raises:
            DomainError: ``USERNAME_INVALID`` or ``USER_NOT_FOUND``.
        """
        name = normalize_username(username)
        row = conn.execute(
            select(UserRow).where(UserRow.username == name).with_for_update()
        ).one_or_none()
        if row is None:
            raise DomainError("USER_NOT_FOUND", f"There is no user '{name}'.")
        return row

    def _set_password(
        self,
        conn: Connection,
        user_id: int,
        password_hash: str,
        now: datetime,
        *,
        reason: str,
    ) -> None:
        """Store a password hash; this ends the user's sessions and codes."""
        statement = pg_insert(PasswordCredentialRow).values(
            user_id=user_id, password_hash=password_hash, changed_at=now
        )
        conn.execute(
            statement.on_conflict_do_update(
                index_elements=[PasswordCredentialRow.user_id],
                set_={
                    "password_hash": statement.excluded.password_hash,
                    "changed_at": statement.excluded.changed_at,
                },
            )
        )
        self._new_generation(conn, user_id, now, reason=reason)

    @staticmethod
    def _new_generation(
        conn: Connection, user_id: int, now: datetime, *, reason: str
    ) -> None:
        """Invalidate the user's outstanding codes and end its sessions."""
        conn.execute(
            update(UserRow)
            .where(UserRow.id == user_id)
            .values(
                credential_generation=UserRow.credential_generation + 1,
                updated_at=now,
            )
        )
        revoke_user_sessions(conn, user_id, reason, now)
