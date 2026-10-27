"""Sessions: login, throttling, expiry and logout."""

from __future__ import annotations

import contextlib
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import argon2._password_hasher
import pytest
from argon2 import Parameters, PasswordHasher, extract_parameters
from pg_harness import column_values, count_rows, database_for
from sqlalchemy import insert, text, update

import ontotator.auth.sessions as sessions_module
from ontotator.auth.accounts import AccountService
from ontotator.auth.audit import Actor
from ontotator.auth.sessions import SessionService
from ontotator.domain.errors import LoginFailed
from ontotator.storage.tables import LoginAttemptRow, PasswordCredentialRow

PASSWORD = "correct horse battery"
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
    db = database_for(tmp_path / "sessions.db")
    clock = Clock()
    s = Services(AccountService(db, now=clock), SessionService(db, now=clock), clock)
    issued = s.accounts.create_user(ADMIN, "alice", "Alice Example")
    s.accounts.redeem_code("alice", issued.code, PASSWORD)
    return s


def test_a_login_creates_a_session_that_resolves_to_the_user(
    services: Services,
) -> None:
    token, principal = services.sessions.login(
        " Alice ", PASSWORD, client_ip="10.0.0.1", user_agent="pytest"
    )

    assert principal.username == "alice"
    assert principal.display_name == "Alice Example"
    assert principal.pseudonym == "ann-0001"
    assert not principal.is_system_admin
    assert len(principal.csrf_token) >= 40
    assert services.sessions.resolve(token) == principal


@pytest.mark.parametrize(
    ("username", "password"),
    [("alice", "wrong password!"), ("nobody", PASSWORD), ("alice", "")],
    ids=["wrong-password", "unknown-user", "empty-password"],
)
def test_every_failure_looks_the_same(
    services: Services, username: str, password: str
) -> None:
    with pytest.raises(LoginFailed) as error:
        services.sessions.login(username, password, client_ip="10.0.0.1")

    assert error.value.code == "LOGIN_FAILED"
    assert error.value.details == (
        "Username or password is wrong, or the account is deactivated or locked"
        " for 15 minutes."
    )


def test_five_failures_lock_the_name_from_that_address_for_the_window(
    services: Services,
) -> None:
    for _ in range(5):
        with pytest.raises(LoginFailed):
            services.sessions.login("alice", "wrong password!", client_ip="10.0.0.1")

    with pytest.raises(LoginFailed):
        services.sessions.login("alice", PASSWORD, client_ip="10.0.0.1")

    services.clock.advance(minutes=15, seconds=1)
    services.sessions.login("alice", PASSWORD, client_ip="10.0.0.1")


def test_many_failures_from_one_address_lock_that_address(services: Services) -> None:
    for number in range(services.sessions.policy.failures_per_address):
        with pytest.raises(LoginFailed):
            services.sessions.login(
                f"nobody{number}", "wrong password!", client_ip="10.0.0.9"
            )

    with pytest.raises(LoginFailed):
        services.sessions.login("alice", PASSWORD, client_ip="10.0.0.9")
    services.sessions.login("alice", PASSWORD, client_ip="10.0.0.10")


def test_a_failed_attempt_is_recorded_even_though_the_login_fails(
    services: Services,
) -> None:
    with pytest.raises(LoginFailed):
        services.sessions.login("alice", "wrong password!", client_ip="10.0.0.1")

    assert count_rows(services.sessions, "login_attempts") == 1


def test_sessions_expire_when_idle_and_after_their_lifetime(
    services: Services,
) -> None:
    idle, _ = services.sessions.login("alice", PASSWORD, client_ip="10.0.0.1")
    services.clock.advance(hours=12, seconds=1)
    assert services.sessions.resolve(idle) is None

    token, _ = services.sessions.login("alice", PASSWORD, client_ip="10.0.0.1")
    for _ in range(30):
        services.clock.advance(hours=11)
        assert services.sessions.resolve(token) is not None
    services.clock.advance(hours=7)
    assert services.sessions.resolve(token) is None


def test_logout_ends_only_this_session(services: Services) -> None:
    first, principal = services.sessions.login("alice", PASSWORD, client_ip="10.0.0.1")
    second, _ = services.sessions.login("alice", PASSWORD, client_ip="10.0.0.2")

    services.sessions.logout(principal.session_id)

    assert services.sessions.resolve(first) is None
    assert services.sessions.resolve(second) is not None


def test_an_unknown_token_resolves_to_nobody(services: Services) -> None:
    services.sessions.login("alice", PASSWORD, client_ip="10.0.0.1")

    assert services.sessions.resolve("not-a-token") is None
    assert services.sessions.resolve("") is None


def test_the_correct_password_fails_while_the_account_is_locked(
    services: Services,
) -> None:
    for _ in range(5):
        with pytest.raises(LoginFailed):
            services.sessions.login("alice", "wrong password!", client_ip="10.0.0.1")

    with pytest.raises(LoginFailed):
        services.sessions.login("alice", PASSWORD, client_ip="10.0.0.1")

    assert count_rows(services.sessions, "sessions") == 0


def test_attempts_while_locked_do_not_extend_the_lock(services: Services) -> None:
    for _ in range(5):
        with pytest.raises(LoginFailed):
            services.sessions.login("alice", "wrong password!", client_ip="10.0.0.1")
    services.clock.advance(minutes=10)
    for password in ["wrong password!"] * 5 + [PASSWORD]:
        with pytest.raises(LoginFailed):
            services.sessions.login("alice", password, client_ip="10.0.0.1")

    services.clock.advance(minutes=5, seconds=1)
    services.sessions.login("alice", PASSWORD, client_ip="10.0.0.1")
    assert count_rows(services.sessions, "login_attempts") == 12


def test_last_seen_is_written_at_most_once_a_minute(services: Services) -> None:
    token, _ = services.sessions.login("alice", PASSWORD, client_ip="10.0.0.1")
    start = services.clock()

    services.clock.advance(seconds=30)
    services.sessions.resolve(token)
    assert column_values(services.sessions, "sessions", "last_seen_at") == [start]

    services.clock.advance(seconds=31)
    services.sessions.resolve(token)
    assert column_values(services.sessions, "sessions", "last_seen_at") == [
        start + timedelta(seconds=61)
    ]


def _stored_hash(services: Services) -> str:
    [stored] = column_values(services.sessions, "password_credentials", "password_hash")
    return str(stored)


def _store_hash(services: Services, password_hash: str) -> None:
    with services.sessions.db.transaction() as conn:
        conn.execute(update(PasswordCredentialRow).values(password_hash=password_hash))


def test_a_weaker_stored_hash_is_rehashed_at_login(services: Services) -> None:
    _store_hash(services, PasswordHasher(time_cost=1, memory_cost=8192).hash(PASSWORD))

    services.sessions.login("alice", PASSWORD, client_ip="10.0.0.1")

    assert _stored_hash(services).startswith("$argon2id$v=19$m=19456,t=2,p=1$")
    services.sessions.login("alice", PASSWORD, client_ip="10.0.0.1")


def test_a_stronger_stored_hash_is_replaced_with_ours_at_login(
    services: Services,
) -> None:
    _store_hash(services, PasswordHasher(time_cost=3).hash(PASSWORD))

    services.sessions.login("alice", PASSWORD, client_ip="10.0.0.1")

    assert _stored_hash(services).startswith("$argon2id$v=19$m=19456,t=2,p=1$")
    services.sessions.login("alice", PASSWORD, client_ip="10.0.0.1")


def test_concurrent_failures_from_one_address_stop_at_the_threshold(
    services: Services, monkeypatch: pytest.MonkeyPatch
) -> None:
    limit = services.sessions.policy.failures_per_address
    with services.sessions.db.transaction() as conn:
        conn.execute(
            insert(LoginAttemptRow),
            [
                {
                    "username": f"nobody{number}",
                    "client_ip": "10.0.0.9",
                    "succeeded": False,
                    "throttled": False,
                    "at": services.clock(),
                }
                for number in range(limit - 1)
            ],
        )
    together = threading.Barrier(4)
    real_verify = sessions_module.verify_password

    def meeting_verify(stored_hash: str | None, password: str) -> bool:
        # Unserialised, all four have passed the address check by now.
        with contextlib.suppress(threading.BrokenBarrierError):
            together.wait(timeout=1)
        return real_verify(stored_hash, password)

    monkeypatch.setattr(sessions_module, "verify_password", meeting_verify)

    def attempt(number: int) -> None:
        with contextlib.suppress(LoginFailed):
            services.sessions.login(
                f"other{number}", "wrong password!", client_ip="10.0.0.9"
            )

    threads = [threading.Thread(target=attempt, args=(n,)) for n in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    throttled = column_values(services.sessions, "login_attempts", "throttled")
    assert throttled.count(False) == limit
    assert throttled.count(True) == 3


def test_a_lock_holds_only_for_the_address_that_caused_it(
    services: Services,
) -> None:
    for _ in range(5):
        with pytest.raises(LoginFailed):
            services.sessions.login("alice", "wrong password!", client_ip="10.6.6.6")
    with pytest.raises(LoginFailed):
        services.sessions.login("alice", PASSWORD, client_ip="10.6.6.6")

    services.sessions.login("alice", PASSWORD, client_ip="10.0.0.1")


def test_a_locked_attempt_skips_argon2(
    services: Services, monkeypatch: pytest.MonkeyPatch
) -> None:
    for name in ("alice", "nobody"):
        for _ in range(5):
            with pytest.raises(LoginFailed):
                services.sessions.login(name, "wrong password!", client_ip="10.0.0.1")
    calls: list[str] = []
    monkeypatch.setattr(
        sessions_module, "verify_password", lambda *_args: calls.append("x") or True
    )

    for name in ("alice", "nobody"):
        with pytest.raises(LoginFailed):
            services.sessions.login(name, PASSWORD, client_ip="10.0.0.1")

    assert calls == []


def test_a_login_prunes_attempts_past_the_retention(services: Services) -> None:
    with pytest.raises(LoginFailed):
        services.sessions.login("alice", "wrong password!", client_ip="10.0.0.1")
    services.clock.advance(days=1, seconds=1)

    services.sessions.login("alice", PASSWORD, client_ip="10.0.0.1")

    assert column_values(services.sessions, "login_attempts", "succeeded") == [True]


def test_a_failed_login_locks_and_verifies_alike_for_any_username(
    services: Services, monkeypatch: pytest.MonkeyPatch
) -> None:
    # A stronger hash (bootstrap, recovery) costs more to verify than ours.
    _store_hash(services, PasswordHasher(time_cost=3).hash(PASSWORD))
    services.sessions.login("alice", PASSWORD, client_ip="10.0.0.1")
    engine = services.sessions.db.engine
    real_verify = sessions_module.verify_password
    real_argon2: Callable[..., Any] = argon2._password_hasher.verify_secret
    locks: list[tuple[bool, bool]] = []
    costs: list[Parameters] = []

    def held(key: int) -> bool:
        with engine.connect() as other:
            free = other.execute(
                text("SELECT pg_try_advisory_lock(:k)"), {"k": key}
            ).scalar()
            if free:
                other.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": key})
        return not free

    def observing_verify(stored_hash: str | None, password: str) -> bool:
        locks.append(
            (
                held(sessions_module._address_lock("10.0.0.2")),
                held(sessions_module._username_lock(current)),
            )
        )
        return real_verify(stored_hash, password)

    def observing_argon2(hash_: bytes, *args: Any) -> Any:
        costs.append(extract_parameters(hash_.decode("ascii")))
        return real_argon2(hash_, *args)

    monkeypatch.setattr(sessions_module, "verify_password", observing_verify)
    monkeypatch.setattr(argon2._password_hasher, "verify_secret", observing_argon2)
    for current in ("alice", "nobody"):
        with pytest.raises(LoginFailed):
            services.sessions.login(current, "wrong password!", client_ip="10.0.0.2")

    assert locks == [(True, True), (True, True)]
    assert len(costs) == 2
    assert costs[0] == costs[1]


def test_a_login_during_a_password_change_leaves_no_old_session(
    services: Services, monkeypatch: pytest.MonkeyPatch
) -> None:
    reset = services.accounts.issue_reset_code(ADMIN, "alice")
    verifying, release = threading.Event(), threading.Event()
    real_verify = sessions_module.verify_password

    def slow_verify(stored_hash: str | None, password: str) -> bool:
        verifying.set()
        release.wait(timeout=10)
        return real_verify(stored_hash, password)

    monkeypatch.setattr(sessions_module, "verify_password", slow_verify)
    logins: list[str] = []
    login = threading.Thread(
        target=lambda: logins.append(
            services.sessions.login("alice", PASSWORD, client_ip="10.0.0.1")[0]
        )
    )
    redeem = threading.Thread(
        target=lambda: services.accounts.redeem_code(
            "alice", reset.code, "another long passphrase"
        )
    )

    login.start()
    assert verifying.wait(timeout=10)
    redeem.start()
    redeem.join(timeout=1)  # without the lock it commits while Argon2 runs
    release.set()
    login.join()
    redeem.join()

    assert len(logins) == 1
    assert services.sessions.resolve(logins[0]) is None


def test_a_login_refuses_to_join_an_open_transaction(services: Services) -> None:
    with (
        pytest.raises(RuntimeError, match="transaction"),
        services.sessions.db.transaction(),
    ):
        services.sessions.login("alice", PASSWORD, client_ip="10.0.0.1")


@pytest.mark.parametrize("username", ["ali\x00ce", "ali\ud800ce", "ali\x07ce"])
def test_a_username_with_control_characters_is_an_ordinary_failure(
    services: Services, username: str
) -> None:
    with pytest.raises(LoginFailed):
        services.sessions.login(username, PASSWORD, client_ip="10.0.0.1")

    # Recorded with a replacement character, which no username can contain.
    assert column_values(services.sessions, "login_attempts", "username") == [
        "ali\ufffdce"
    ]


def test_control_characters_in_the_user_agent_are_not_stored(
    services: Services,
) -> None:
    services.sessions.login(
        "alice", PASSWORD, client_ip="10.0.0.1", user_agent="py\x00test\x1b/1"
    )

    assert column_values(services.sessions, "sessions", "user_agent") == [
        "py\ufffdtest\ufffd/1"
    ]
