"""Shared login lock order and policy, without accounts/session import cycles."""

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import Connection, func, select

from ontocurator.storage.database import advisory_lock_id
from ontocurator.storage.tables import LoginAttemptRow


@dataclass(frozen=True)
class SessionPolicy:
    """Session lifetimes (Q6) and the login lockout (Q8)."""

    idle: timedelta = timedelta(hours=12)
    absolute: timedelta = timedelta(days=14)
    window: timedelta = timedelta(minutes=15)
    failures_per_account: int = 5
    failures_per_address: int = 30


def address_lock(client_ip: str) -> int:
    return advisory_lock_id("login-address", client_ip)


def username_lock(name: str) -> int:
    return advisory_lock_id("login-username", name)


def login_locked(
    conn: Connection,
    username: str,
    client_ip: str,
    now: datetime,
    policy: SessionPolicy,
) -> bool:
    since = now - policy.window
    recent_failures = (
        select(func.count())
        .select_from(LoginAttemptRow)
        .where(
            LoginAttemptRow.succeeded.is_(False),
            LoginAttemptRow.throttled.is_(False),
            LoginAttemptRow.at >= since,
            LoginAttemptRow.at <= now,
        )
    )
    account = conn.execute(
        recent_failures.where(LoginAttemptRow.username == username)
    ).scalar_one()
    if account >= policy.failures_per_account:
        return True
    address = conn.execute(
        recent_failures.where(LoginAttemptRow.client_ip == client_ip)
    ).scalar_one()
    return bool(address >= policy.failures_per_address)
