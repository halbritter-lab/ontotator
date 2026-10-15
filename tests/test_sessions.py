"""Sessions: login, throttling, expiry and logout."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from pg_harness import count_rows, database_for

from ontocurator.auth.accounts import AccountService
from ontocurator.auth.audit import Actor
from ontocurator.auth.sessions import SessionService
from ontocurator.domain.errors import LoginFailed

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
        "Username or password is wrong, or the account is locked for 15 minutes."
    )


def test_five_failures_lock_the_account_for_the_window(services: Services) -> None:
    for _ in range(5):
        with pytest.raises(LoginFailed):
            services.sessions.login("alice", "wrong password!", client_ip="10.0.0.1")

    with pytest.raises(LoginFailed):
        services.sessions.login("alice", PASSWORD, client_ip="10.0.0.2")

    services.clock.advance(minutes=15, seconds=1)
    services.sessions.login("alice", PASSWORD, client_ip="10.0.0.2")


def test_many_failures_from_one_address_lock_that_address(services: Services) -> None:
    for number in range(30):
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
