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

The installation always keeps an active system admin: demoting or
deactivating the last one is refused with ``LAST_SYSTEM_ADMIN``.

Erasure (GDPR Art. 17) anonymises a deactivated account in place: the row and
its pseudonym stay, so research records keep their author, while every
personal field, the credential and the login traces are removed. The
username becomes ``anonymised-<id>``, a prefix new accounts cannot take, and
the old username is rewritten wherever the account's own rows carry it (audit
trail, job labels); ``users.anonymised_at`` marks the erasure.
"""

from __future__ import annotations

import re
import secrets
from collections.abc import Callable, Iterable
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
    insert,
    select,
    text,
    union,
    update,
)
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ontotator.application.preferences import normalize_annotator_id
from ontotator.auth.audit import Actor, record_audit
from ontotator.auth.passwords import (
    PasswordRuleError,
    assert_policy,
    check_password_rules,
    hash_password,
    verify_password,
)
from ontotator.auth.tokens import revoke_user_sessions, token_digest
from ontotator.domain.errors import DomainError
from ontotator.storage.database import Database, advisory_lock_id
from ontotator.storage.tables import (
    SCHEMA,
    AnnotationSnapshotRow,
    DraftRow,
    InstanceStateRow,
    LoginAttemptRow,
    OneTimeCodeRow,
    PasswordCredentialRow,
    ReviewDecisionRow,
    SearchEventRow,
    SessionRow,
    SubmissionRow,
    UserLanguageRow,
    UserPreferencesRow,
    UserRow,
)

CodePurpose = Literal["setup", "reset"]
BootstrapResult = Literal["created", "already_done", "not_configured"]

CODE_LIFETIME: dict[str, timedelta] = {
    "setup": timedelta(hours=24),
    # Long enough to reach the person out of band; still single use.
    "reset": timedelta(hours=2),
}
# Crockford base32 (no I, L, O, U): a code read aloud has no look-alikes.
CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
# 26 symbols of 5 bits: 130 bits, far beyond guessing a single-use code that
# expires, short enough to read aloud in six groups.
CODE_GROUPS = (5, 5, 4, 4, 4, 4)
ADMIN_USERNAME = "admin"
ADMIN_DISPLAY_NAME = "Administrator"
BOOTSTRAP_KEY = "admin_bootstrapped"
BOOTSTRAP_LOCK = advisory_lock_id("bootstrap-admin")
# Serialises every change that could remove an active system admin, so two
# concurrent removals cannot both see the other admin still in place.
# Lock order: this lock, then the user row.
SYSTEM_ADMINS_LOCK = advisory_lock_id("system-admins")
ANONYMISED_PREFIX = "anonymised-"
ANONYMISED_DISPLAY_NAME = "Anonymised user"
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
    orcid: str | None = None
    orcid_consent: bool = False
    qualification: str | None = None

    anonymised: bool = False


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


class _Unset:
    """Distinguish an omitted profile value from an explicit nullable clear."""


UNSET = _Unset()


def normalize_display_name(value: str) -> str:
    display = value.strip()
    if not 1 <= len(display) <= 120:
        raise DomainError(
            "DISPLAY_NAME_INVALID", "The display name has 1 to 120 characters."
        )
    return display


def normalize_languages(values: Iterable[str]) -> frozenset[str]:
    languages = frozenset(value.lower() for value in values)
    if any(re.fullmatch(r"[a-z]{2}", value) is None for value in languages):
        raise DomainError("LANGUAGE_INVALID", "Languages use two-letter codes.")
    return languages


def validate_orcid(value: str) -> str:
    if re.fullmatch(r"[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]", value):
        digits = value.replace("-", "")
        total = 0
        for digit in digits[:-1]:
            total = (total + int(digit)) * 2
        check = (12 - total % 11) % 11
        if digits[-1] == ("X" if check == 10 else str(check)):
            return value
    raise DomainError("ORCID_INVALID", "The ORCID format or checksum is invalid.")


def _user(row: Row[Any]) -> User:
    return User(
        id=row.id,
        username=row.username,
        display_name=row.display_name,
        email=row.email,
        pseudonym=row.pseudonym,
        is_system_admin=row.is_system_admin,
        active=row.active,
        orcid=row.orcid,
        orcid_consent=row.orcid_consent,
        qualification=row.qualification,
        anonymised=row.anonymised_at is not None,
    )


def _annotator_ids_in_use(conn: Connection) -> set[str]:
    """Every ``ann-...`` id of a user or of stored work.

    Work carries annotator ids in drafts, submissions, review decisions, the
    actors of annotation snapshots and the workspace keys of search events.
    """
    actor = AnnotationSnapshotRow.payload[
        ("annotation", "provenance", "actor", "actor_id")
    ].astext
    event_annotator = SearchEventRow.payload[("workspace_key", "annotator_id")].astext
    columns = (
        UserRow.pseudonym,
        DraftRow.annotator_id,
        SubmissionRow.annotator_id,
        ReviewDecisionRow.reviewer_id,
        actor,
        event_annotator,
    )
    ids = union(*(select(column).where(column.like("ann-%")) for column in columns))
    return {str(value) for value in conn.execute(ids).scalars()}


def new_code() -> str:
    """A fresh code in six groups of five or four symbols, e.g. ``7K3QZ-...``.

    Codes of other lengths (the former 43-character ``token_urlsafe`` codes)
    still redeem: only the digest is stored and compared.
    """
    return "-".join(
        "".join(secrets.choice(CODE_ALPHABET) for _ in range(size))
        for size in CODE_GROUPS
    )


def canonical_code(code: str) -> str:
    """The stored form of a typed code: no separators, upper case, I/L as 1, O as 0."""
    return (
        "".join(code.split())
        .replace("-", "")
        .upper()
        .translate(str.maketrans("ILO", "110"))
    )


def _code_invalid() -> DomainError:
    """The one error for every unusable code, so none can be told apart."""
    return DomainError("CODE_INVALID", CODE_INVALID_MESSAGE)


def _rewrite_username(
    conn: Connection, user_id: int, pseudonym: str, old: str, new: str
) -> None:
    """Replace an erased username in the rows that carry it; drop its receipts."""
    from ontotator.storage.tables import (
        AuditEventRow,
        DraftRow,
        JobRow,
        MutationReceiptRow,
    )

    label_old, label_new = f"user:{old}", f"user:{new}"
    conn.execute(text("SET LOCAL ontotator.erasure = on"))
    conn.execute(
        update(AuditEventRow)
        .where(AuditEventRow.target_user_id == user_id)
        .values(target_id=new)
    )
    conn.execute(
        update(AuditEventRow)
        .where(
            (AuditEventRow.actor_user_id == user_id)
            | (AuditEventRow.actor_label == label_old)
        )
        .values(actor_label=label_new)
    )
    conn.execute(
        update(AuditEventRow)
        .where(AuditEventRow.details["username"].astext == old)
        .values(
            details=AuditEventRow.details.op("||")(
                func.jsonb_build_object("username", new)
            )
        )
    )
    # Only the erasure itself may rewrite history: close the window again.
    conn.execute(text("SET LOCAL ontotator.erasure = off"))
    conn.execute(
        update(JobRow)
        .where((JobRow.requested_by == user_id) | (JobRow.requested_label == label_old))
        .values(requested_label=label_new)
    )
    # Receipts only replay a request of the (now closed) account.
    conn.execute(
        delete(MutationReceiptRow).where(
            MutationReceiptRow.workspace_key.in_(
                select(DraftRow.draft_key).where(DraftRow.annotator_id == pseudonym)
            )
        )
    )


def _anonymised(username: str) -> DomainError:
    return DomainError(
        "USER_ANONYMISED", f"'{username}' is anonymised and cannot be changed."
    )


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

    def languages_of(self, user_ids: Iterable[int]) -> dict[int, frozenset[str]]:
        languages: dict[int, set[str]] = {user_id: set() for user_id in user_ids}
        if languages:
            with self.db.transaction() as conn:
                for row in conn.execute(
                    select(UserLanguageRow).where(
                        UserLanguageRow.user_id.in_(languages)
                    )
                ):
                    languages[row.user_id].add(row.language)
        return {key: frozenset(values) for key, values in languages.items()}

    def set_languages(
        self, actor: Actor, username: str, languages: Iterable[str]
    ) -> None:
        normalized = normalize_languages(languages)
        with self.db.transaction() as conn:
            user = self._lock_user(conn, username)
            if normalized and _user(user).anonymised:
                raise _anonymised(user.username)
            conn.execute(
                delete(UserLanguageRow).where(UserLanguageRow.user_id == user.id)
            )
            if normalized:
                conn.execute(
                    insert(UserLanguageRow),
                    [
                        {"user_id": user.id, "language": value}
                        for value in sorted(normalized)
                    ],
                )
            record_audit(
                conn,
                actor,
                "user.languages",
                target_type="user",
                target_id=user.username,
                at=self._now(),
            )

    def update_profile(
        self,
        actor: Actor,
        username: str,
        *,
        display_name: str | _Unset = UNSET,
        email: str | _Unset | None = UNSET,
        orcid: str | _Unset | None = UNSET,
        orcid_consent: bool | _Unset = UNSET,
        qualification: str | _Unset | None = UNSET,
    ) -> User:
        changes: dict[str, Any] = {}
        if not isinstance(display_name, _Unset):
            changes["display_name"] = normalize_display_name(display_name)
        if not isinstance(email, _Unset):
            changes["email"] = email.strip() or None if email is not None else None
        if not isinstance(orcid, _Unset):
            changes["orcid"] = validate_orcid(orcid) if orcid is not None else None
        if not isinstance(orcid_consent, _Unset):
            changes["orcid_consent"] = orcid_consent
        if not isinstance(qualification, _Unset):
            if qualification is not None and (
                not isinstance(qualification, str) or len(qualification) > 200
            ):
                raise DomainError(
                    "QUALIFICATION_INVALID", "Qualification has at most 200 characters."
                )
            changes["qualification"] = (
                qualification.strip() or None if qualification is not None else None
            )
        now = self._now()
        with self.db.transaction() as conn:
            user = self._lock_user(conn, username)
            changes = {
                key: value
                for key, value in changes.items()
                if getattr(user, key) != value
            }
            if changes and _user(user).anonymised:
                raise _anonymised(user.username)
            if changes:
                conn.execute(
                    update(UserRow)
                    .where(UserRow.id == user.id)
                    .values(**changes, updated_at=now)
                )
                record_audit(
                    conn,
                    actor,
                    "user.profile",
                    target_type="user",
                    target_id=user.username,
                    details={"fields": sorted(changes)},
                    at=now,
                )
            return _user(self._lock_user(conn, user.username))

    def change_password(
        self,
        user_id: int,
        current: str,
        new: str,
        *,
        keep_session_id: int,
        client_ip: str = "unknown",
    ) -> None:
        """Change credentials atomically; commit a failed attempt before raising.

        Like login, this operation must own its transaction. Address/name locks
        precede the user row, so login and credential changes cannot deadlock.
        """
        from ontotator.auth.login_attempts import (
            SessionPolicy,
            address_lock,
            login_locked,
            username_lock,
        )

        if self.db.in_transaction():
            raise RuntimeError(
                "A password change commits its attempt on its own; it cannot join an open transaction"
            )
        with self.db.transaction() as conn:
            username = conn.execute(
                select(UserRow.username).where(UserRow.id == user_id)
            ).scalar_one_or_none()
        if username is None:
            raise DomainError("USER_NOT_FOUND", "The user no longer exists.")
        wrong = False
        with self.db.transaction() as conn:
            conn.execute(select(func.pg_advisory_xact_lock(address_lock(client_ip))))
            conn.execute(select(func.pg_advisory_xact_lock(username_lock(username))))
            user = self._lock_user(conn, username)
            now = self._now()
            session = conn.execute(
                select(SessionRow)
                .where(SessionRow.id == keep_session_id)
                .with_for_update()
            ).one_or_none()
            if (
                not user.active
                or session is None
                or session.user_id != user_id
                or session.revoked_at is not None
                or session.expires_at <= now
                or now - session.last_seen_at > SessionPolicy().idle
            ):
                raise DomainError(
                    "SESSION_INVALID", "The current session is no longer active."
                )
            stored_hash = conn.execute(
                select(PasswordCredentialRow.password_hash).where(
                    PasswordCredentialRow.user_id == user_id
                )
            ).scalar_one_or_none()
            locked = login_locked(conn, username, client_ip, now, SessionPolicy())
            matches = not locked and verify_password(stored_hash, current)
            if not matches:
                conn.execute(
                    insert(LoginAttemptRow).values(
                        username=username,
                        client_ip=client_ip,
                        succeeded=False,
                        throttled=locked,
                        at=now,
                    )
                )
                wrong = True
            else:
                try:
                    check_password_rules(username, new)
                except PasswordRuleError as exc:
                    raise _password_rules(exc) from None
                conn.execute(
                    update(PasswordCredentialRow)
                    .where(PasswordCredentialRow.user_id == user_id)
                    .values(password_hash=hash_password(new), changed_at=now)
                )
                conn.execute(
                    update(UserRow)
                    .where(UserRow.id == user_id)
                    .values(
                        credential_generation=UserRow.credential_generation + 1,
                        updated_at=now,
                    )
                )
                conn.execute(
                    update(SessionRow)
                    .where(
                        SessionRow.user_id == user_id,
                        SessionRow.id != keep_session_id,
                        SessionRow.revoked_at.is_(None),
                    )
                    .values(revoked_at=now, revoked_reason="password_set")
                )
                record_audit(
                    conn,
                    Actor.user(user_id, username),
                    "user.password_set",
                    target_type="user",
                    target_id=username,
                    at=now,
                )
        if wrong:
            raise DomainError("PASSWORD_WRONG", "The current password is incorrect.")

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
        if name.startswith(ANONYMISED_PREFIX):
            raise DomainError(
                "USERNAME_INVALID",
                f"Usernames starting with '{ANONYMISED_PREFIX}' are reserved.",
            )
        display = normalize_display_name(display_name)
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
        """The next free ``ann-NNNN``.

        Numbers an admin assigned by hand are skipped, and so is every
        annotator id that stored work carries (see ``_annotator_ids_in_use``):
        a new account must not inherit work written before accounts existed.
        Claiming such an identity takes an explicit ``pseudonym``.
        """
        taken = _annotator_ids_in_use(conn)
        while True:
            number = conn.execute(select(_PSEUDONYMS.next_value())).scalar_one()
            candidate = f"ann-{number:04d}"
            if candidate not in taken:
                return candidate

    def issue_reset_code(self, actor: Actor, username: str) -> IssuedCode:
        """A new code for an active user; it replaces the user's unused codes.

        A user who never set a password gets a fresh setup code (24 hours)
        instead of a reset code (2 hours).

        Raises:
            DomainError: ``USER_NOT_FOUND`` or ``USER_INACTIVE``.
        """
        now = self._now()
        with self.db.transaction() as conn:
            row = self._lock_user(conn, username)
            if not row.active:
                raise DomainError("USER_INACTIVE", f"'{row.username}' is deactivated.")
            has_password = conn.execute(
                select(exists().where(PasswordCredentialRow.user_id == row.id))
            ).scalar()
            purpose: CodePurpose = "reset" if has_password else "setup"
            record_audit(
                conn,
                actor,
                "user.reset_code",
                target_type="user",
                target_id=row.username,
                details={"purpose": purpose},
                at=now,
            )
            return self._issue_code(conn, actor, row, purpose, now)

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
        code = new_code()
        expires_at = now + CODE_LIFETIME[purpose]
        conn.execute(
            pg_insert(OneTimeCodeRow).values(
                user_id=user.id,
                purpose=purpose,
                code_sha256=token_digest(canonical_code(code)),
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
            # Codes issued before the grouped format are matched verbatim.
            digests = {token_digest(code), token_digest(canonical_code(code))}
            row = conn.execute(
                select(OneTimeCodeRow)
                .where(OneTimeCodeRow.code_sha256.in_(digests))
                .with_for_update()
            ).first()
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
            DomainError: ``USER_NOT_FOUND``, or ``LAST_SYSTEM_ADMIN`` when
                the user is the last active system admin.
        """
        return self._set_flag(
            actor, username, "is_system_admin", on, "user.system_admin"
        )

    def set_active(self, actor: Actor, username: str, active: bool) -> User:
        """Activate or deactivate a user; a change ends all sessions.

        Raises:
            DomainError: ``USER_NOT_FOUND``, or ``LAST_SYSTEM_ADMIN`` when
                the user is the last active system admin.
        """
        return self._set_flag(actor, username, "active", active, "user.active")

    def _set_flag(
        self, actor: Actor, username: str, column: str, value: bool, action: str
    ) -> User:
        now = self._now()
        with self.db.transaction() as conn:
            if not value:
                # Lock first, then read: a concurrent removal has committed
                # (or not started) by the time the admins are counted below.
                conn.execute(select(func.pg_advisory_xact_lock(SYSTEM_ADMINS_LOCK)))
            row = self._lock_user(conn, username)
            if getattr(row, column) == value:
                return _user(row)  # nothing changes, nothing to audit
            if _user(row).anonymised:
                raise _anonymised(row.username)
            if (
                not value
                and row.active
                and row.is_system_admin
                and not self._other_active_admins(conn, row.id)
            ):
                raise DomainError(
                    "LAST_SYSTEM_ADMIN",
                    f"'{row.username}' is the last active system admin. Make "
                    "another user a system admin first.",
                )
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

    def anonymise(self, actor: Actor, username: str) -> User:
        """Erase the personal data of a deactivated account; irreversible.

        Kept: the row, its id and pseudonym, memberships and all work, so
        exports and the audit trail still resolve the author. Removed: name,
        e-mail, ORCID, qualification, languages, preferences, the password,
        all codes, the login attempts under the old username, the client
        addresses of its sessions and its idempotency receipts. The old
        username is replaced by ``anonymised-<id>`` in the audit trail (actor
        label, target and ``details.username``; the append-only trigger lets
        this one transaction through) and in job labels.

        Raises:
            DomainError: ``USER_NOT_FOUND``, ``USER_ACTIVE`` for an active
                account or ``USER_ANONYMISED`` when it is anonymised already.
        """
        now = self._now()
        with self.db.transaction() as conn:
            row = self._lock_user(conn, username)
            if _user(row).anonymised:
                raise _anonymised(row.username)
            if row.active:
                raise DomainError(
                    "USER_ACTIVE", f"Deactivate '{row.username}' before anonymising."
                )
            new_name = f"{ANONYMISED_PREFIX}{row.id}"
            conn.execute(
                update(UserRow)
                .where(UserRow.id == row.id)
                .values(
                    username=new_name,
                    display_name=ANONYMISED_DISPLAY_NAME,
                    email=None,
                    orcid=None,
                    orcid_consent=False,
                    qualification=None,
                    is_system_admin=False,
                    anonymised_at=now,
                )
            )
            _rewrite_username(conn, row.id, row.pseudonym, row.username, new_name)
            for table in (PasswordCredentialRow, UserLanguageRow, UserPreferencesRow):
                conn.execute(delete(table).where(table.user_id == row.id))
            conn.execute(delete(OneTimeCodeRow).where(OneTimeCodeRow.user_id == row.id))
            conn.execute(
                delete(LoginAttemptRow).where(LoginAttemptRow.username == row.username)
            )
            self._new_generation(conn, row.id, now, reason="user.anonymise")
            # Session rows stay (edit events reference them); their traces go.
            conn.execute(
                update(SessionRow)
                .where(SessionRow.user_id == row.id)
                .values(client_ip=None, user_agent=None)
            )
            record_audit(
                conn,
                actor,
                "user.anonymise",
                target_type="user",
                target_id=new_name,
                details={"pseudonym": row.pseudonym},
                at=now,
            )
            return _user(self._lock_user(conn, new_name))

    @staticmethod
    def _other_active_admins(conn: Connection, user_id: int) -> bool:
        """Whether an active system admin other than ``user_id`` exists."""
        return bool(
            conn.execute(
                select(
                    exists().where(
                        UserRow.id != user_id,
                        UserRow.active.is_(True),
                        UserRow.is_system_admin.is_(True),
                    )
                )
            ).scalar()
        )

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
        """Serialize account writes without blocking audit actor foreign keys.

        Account mutations do not change referenced keys. NO KEY UPDATE keeps
        concurrent mutations exclusive while allowing the KEY SHARE taken by
        an audit insert when two administrators act on each other's accounts.

        Raises:
            DomainError: ``USERNAME_INVALID`` or ``USER_NOT_FOUND``.
        """
        name = normalize_username(username)
        row = conn.execute(
            select(UserRow)
            .where(UserRow.username == name)
            .with_for_update(key_share=True)
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
