"""Accounts: users, single-use codes, the first admin, recovery and the audit trail."""

from __future__ import annotations

import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from pg_harness import column_values, database_for
from sqlalchemy import select

from ontocurator.auth.accounts import CODE_LIFETIME, AccountService
from ontocurator.auth.audit import Actor
from ontocurator.auth.passwords import hash_password
from ontocurator.auth.sessions import SessionService
from ontocurator.domain.errors import DomainError, LoginFailed
from ontocurator.storage.tables import AuditEventRow

PASSWORD = "correct horse battery"
NEW_PASSWORD = "another long passphrase"
ADMIN = Actor(None, "test:admin")


class Clock:
    """A clock that only moves when the test moves it."""

    def __init__(self) -> None:
        self.at = datetime(2026, 10, 15, 9, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.at

    def advance(self, **delta: float) -> None:
        self.at += timedelta(**delta)


@dataclass
class Services:
    accounts: AccountService
    sessions: SessionService
    clock: Clock


@pytest.fixture
def services(tmp_path: Path) -> Services:
    db = database_for(tmp_path / "accounts.db")
    clock = Clock()
    return Services(AccountService(db, now=clock), SessionService(db, now=clock), clock)


def _ready_user(s: Services, username: str = "alice") -> str:
    """Create ``username`` and set its password with the setup code."""
    issued = s.accounts.create_user(ADMIN, username, username.title())
    s.accounts.redeem_code(username, issued.code, PASSWORD)
    return username


def _code(error: pytest.ExceptionInfo[DomainError]) -> str:
    return error.value.code


def test_a_new_user_gets_a_pseudonym_and_a_setup_code(services: Services) -> None:
    first = services.accounts.create_user(
        ADMIN, "Alice", "Alice Example", email="alice@example.org"
    )
    second = services.accounts.create_user(ADMIN, "bob", "Bob")

    assert first.user.username == "alice"
    assert first.user.pseudonym == "ann-0001"
    assert second.user.pseudonym == "ann-0002"
    assert first.purpose == "setup"
    assert first.expires_at == services.clock() + timedelta(hours=24)
    assert CODE_LIFETIME["setup"] == timedelta(hours=24)
    assert len(first.code) >= 40
    stored = services.accounts.get_by_username("alice")
    assert stored is not None
    assert stored.email == "alice@example.org"
    assert stored.display_name == "Alice Example"
    assert not stored.is_system_admin
    assert stored.active


@pytest.mark.parametrize("username", ["ab", "with space", "UPPER!", "-start", "x" * 65])
def test_usernames_are_short_lowercase_words(services: Services, username: str) -> None:
    with pytest.raises(DomainError) as error:
        services.accounts.create_user(ADMIN, username, "Someone")

    assert _code(error) == "USERNAME_INVALID"


def test_a_username_is_taken_once(services: Services) -> None:
    services.accounts.create_user(ADMIN, "alice", "Alice")

    with pytest.raises(DomainError) as error:
        services.accounts.create_user(ADMIN, "ALICE", "Alice Again")

    assert _code(error) == "USERNAME_TAKEN"
    assert [u.username for u in services.accounts.list_users()] == ["alice"]


def test_a_setup_code_sets_the_password_once(services: Services) -> None:
    issued = services.accounts.create_user(ADMIN, "alice", "Alice")

    user = services.accounts.redeem_code("alice", issued.code, PASSWORD)
    _token, principal = services.sessions.login("alice", PASSWORD, client_ip="10.0.0.1")

    assert user.username == "alice"
    assert principal.user_id == user.id
    with pytest.raises(DomainError) as error:
        services.accounts.redeem_code("alice", issued.code, NEW_PASSWORD)
    assert _code(error) == "CODE_INVALID"


def test_an_expired_or_foreign_code_is_refused(services: Services) -> None:
    alice = services.accounts.create_user(ADMIN, "alice", "Alice")
    bob = services.accounts.create_user(ADMIN, "bob", "Bob")

    with pytest.raises(DomainError) as foreign:
        services.accounts.redeem_code("alice", bob.code, PASSWORD)
    with pytest.raises(DomainError) as unknown:
        services.accounts.redeem_code("alice", "not-a-code", PASSWORD)
    services.clock.advance(hours=24, seconds=1)
    with pytest.raises(DomainError) as expired:
        services.accounts.redeem_code("alice", alice.code, PASSWORD)

    assert {_code(foreign), _code(unknown), _code(expired)} == {"CODE_INVALID"}
    assert str(foreign.value) == str(unknown.value) == str(expired.value)


def test_a_reset_code_lives_fifteen_minutes_and_replaces_older_code(
    services: Services,
) -> None:
    setup = services.accounts.create_user(ADMIN, "alice", "Alice")

    reset = services.accounts.issue_reset_code(ADMIN, "alice")

    assert reset.purpose == "reset"
    assert reset.expires_at == services.clock() + timedelta(minutes=15)
    with pytest.raises(DomainError) as old:
        services.accounts.redeem_code("alice", setup.code, PASSWORD)
    assert _code(old) == "CODE_INVALID"
    services.clock.advance(minutes=15, seconds=1)
    with pytest.raises(DomainError) as expired:
        services.accounts.redeem_code("alice", reset.code, PASSWORD)
    assert _code(expired) == "CODE_INVALID"
    fresh = services.accounts.issue_reset_code(ADMIN, "alice")
    services.clock.advance(minutes=14)
    assert services.accounts.redeem_code("alice", fresh.code, PASSWORD).username == (
        "alice"
    )


def test_the_password_rules_apply_when_a_code_is_redeemed(services: Services) -> None:
    issued = services.accounts.create_user(ADMIN, "alice", "Alice")

    with pytest.raises(DomainError) as error:
        services.accounts.redeem_code("alice", issued.code, "short")

    assert _code(error) == "PASSWORD_RULES"
    assert "at least 12" in str(error.value)
    services.accounts.redeem_code("alice", issued.code, PASSWORD)


def test_changes_revoke_sessions(services: Services) -> None:
    _ready_user(services)
    token, _ = services.sessions.login("alice", PASSWORD, client_ip="10.0.0.1")

    services.accounts.set_system_admin(ADMIN, "alice", True)

    assert services.sessions.resolve(token) is None
    token, principal = services.sessions.login("alice", PASSWORD, client_ip="10.0.0.1")
    assert principal.is_system_admin
    services.accounts.set_active(ADMIN, "alice", False)
    assert services.sessions.resolve(token) is None
    with pytest.raises(LoginFailed):
        services.sessions.login("alice", PASSWORD, client_ip="10.0.0.1")


def test_the_first_admin_is_created_once_from_a_hash(services: Services) -> None:
    assert services.accounts.bootstrap_admin(None) == "not_configured"
    assert services.accounts.bootstrap_admin(hash_password(PASSWORD)) == "created"
    assert (
        services.accounts.bootstrap_admin(hash_password(NEW_PASSWORD)) == "already_done"
    )

    _token, principal = services.sessions.login("admin", PASSWORD, client_ip="10.0.0.1")
    assert principal.is_system_admin
    assert principal.display_name == "Administrator"
    with pytest.raises(LoginFailed):
        services.sessions.login("admin", NEW_PASSWORD, client_ip="10.0.0.1")


def test_a_weak_bootstrap_hash_is_refused(services: Services) -> None:
    from argon2 import PasswordHasher

    weak = PasswordHasher(time_cost=1, memory_cost=8192).hash(PASSWORD)

    with pytest.raises(DomainError) as error:
        services.accounts.bootstrap_admin(weak)

    assert _code(error) == "PASSWORD_RULES"
    assert services.accounts.get_by_username("admin") is None
    assert services.accounts.bootstrap_admin(None) == "not_configured"


def test_recovery_sets_a_new_admin_password_and_records_the_operator(
    services: Services,
) -> None:
    services.accounts.bootstrap_admin(hash_password(PASSWORD))
    token, _ = services.sessions.login("admin", PASSWORD, client_ip="10.0.0.1")

    services.accounts.recover_admin(
        "admin", hash_password(NEW_PASSWORD), "jdoe", "lost the password"
    )

    assert services.sessions.resolve(token) is None
    services.sessions.login("admin", NEW_PASSWORD, client_ip="10.0.0.1")
    with services.accounts.db.transaction() as conn:
        row = conn.execute(
            select(AuditEventRow).where(AuditEventRow.action == "user.recovered")
        ).one()
    assert row.actor_label == "recovery:jdoe"
    assert row.details == {"reason": "lost the password"}
    with pytest.raises(DomainError) as incomplete:
        services.accounts.recover_admin("admin", hash_password(PASSWORD), " ", "x")
    assert _code(incomplete) == "RECOVERY_INCOMPLETE"
    _ready_user(services, "bob")
    with pytest.raises(DomainError) as not_admin:
        services.accounts.recover_admin("bob", hash_password(PASSWORD), "jdoe", "x")
    assert _code(not_admin) == "NOT_AN_ACTIVE_ADMIN"


def test_every_change_is_audited(services: Services) -> None:
    services.accounts.create_user(ADMIN, "alice", "Alice")
    services.accounts.issue_reset_code(ADMIN, "alice")
    services.accounts.set_system_admin(ADMIN, "alice", True)
    services.accounts.set_active(ADMIN, "alice", False)

    actions = column_values(services.accounts, "audit_events", "action")
    labels = set(column_values(services.accounts, "audit_events", "actor_label"))

    assert sorted(actions) == [
        "user.active",
        "user.create",
        "user.reset_code",
        "user.system_admin",
    ]
    assert labels == {"test:admin"}


def _race(*calls: Callable[[], object]) -> list[object]:
    """Run ``calls`` at the same moment in threads; their results or exceptions."""
    barrier = threading.Barrier(len(calls))
    results: list[object] = [None] * len(calls)

    def run(index: int) -> None:
        barrier.wait()
        try:
            results[index] = calls[index]()
        except Exception as exc:
            results[index] = exc

    threads = [threading.Thread(target=run, args=(i,)) for i in range(len(calls))]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    return results


def test_a_code_redeemed_twice_at_once_sets_the_password_once(
    services: Services,
) -> None:
    issued = services.accounts.create_user(ADMIN, "alice", "Alice")

    results = _race(
        lambda: services.accounts.redeem_code("alice", issued.code, PASSWORD),
        lambda: services.accounts.redeem_code("alice", issued.code, NEW_PASSWORD),
    )

    failures = [r for r in results if isinstance(r, DomainError)]
    assert [f.code for f in failures] == ["CODE_INVALID"]
    actions = column_values(services.accounts, "audit_events", "action")
    assert actions.count("user.password_set") == 1


def test_one_username_created_twice_at_once_is_taken_once(
    services: Services,
) -> None:
    results = _race(
        lambda: services.accounts.create_user(ADMIN, "alice", "Alice"),
        lambda: services.accounts.create_user(ADMIN, "Alice", "Alice Too"),
    )

    failures = [r for r in results if isinstance(r, DomainError)]
    assert [f.code for f in failures] == ["USERNAME_TAKEN"]
    assert [u.username for u in services.accounts.list_users()] == ["alice"]
