"""The audit hook: who changed what, written in the same transaction as the change."""

from __future__ import annotations

import getpass
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import Connection, insert, or_, select

from ontotator.storage.tables import AuditEventRow, ProjectRow, UserRow


@dataclass(frozen=True)
class Actor:
    """Who acts: a user (``user_id``) or a process, named by ``label``.

    Labels: ``user:<username>`` for a logged-in user, ``cli:<os user>`` for the
    admin CLI, ``system:bootstrap`` for the first start and
    ``recovery:<operator>`` for the offline recovery.
    """

    user_id: int | None
    label: str

    @classmethod
    def cli(cls) -> Actor:
        """The operating-system user running the admin CLI."""
        try:
            name = getpass.getuser()
        except Exception:  # no login name in this environment
            name = "unknown"
        return cls(None, f"cli:{name}")

    @classmethod
    def user(cls, user_id: int, username: str) -> Actor:
        """A logged-in user acting for themselves."""
        return cls(user_id, f"user:{username}")


def record_audit(
    conn: Connection,
    actor: Actor,
    action: str,
    *,
    target_type: str,
    target_id: str | int,
    project_id: int | None = None,
    details: dict[str, Any] | None = None,
    at: datetime | None = None,
) -> None:
    """Insert one ``audit_events`` row in the caller's transaction.

    ``at`` defaults to the database clock; services pass their own clock, so
    the trail and the change carry the same time. A ``user`` target also
    records the account's id, resolved from the username at this moment.
    """
    values: dict[str, Any] = {
        "actor_user_id": actor.user_id,
        "actor_label": actor.label,
        "action": action,
        "target_type": target_type,
        "target_id": str(target_id),
        "project_id": project_id,
        "details": details or {},
    }
    if target_type == "user":
        values["target_user_id"] = (
            select(UserRow.id).where(UserRow.username == str(target_id))
        ).scalar_subquery()
    if at is not None:
        values["at"] = at
    conn.execute(insert(AuditEventRow).values(**values))


@dataclass(frozen=True)
class AuditEvent:
    """One row of the trail as people read it."""

    at: datetime
    actor: str
    action: str
    target_type: str
    target_id: str
    project_key: str | None
    details: dict[str, Any]


def read_audit(
    conn: Connection,
    *,
    user_id: int | None = None,
    project_key: str | None = None,
    since: datetime | None = None,
    limit: int = 200,
) -> list[AuditEvent]:
    """The newest events first, at most ``limit``.

    ``user_id`` selects what was done to the account and what it did, by
    id: a username used again later never inherits an earlier history.
    """
    statement = (
        select(
            AuditEventRow.at,
            AuditEventRow.actor_label,
            AuditEventRow.action,
            AuditEventRow.target_type,
            AuditEventRow.target_id,
            AuditEventRow.details,
            ProjectRow.project_key,
        )
        .outerjoin(ProjectRow, ProjectRow.id == AuditEventRow.project_id)
        .order_by(AuditEventRow.at.desc(), AuditEventRow.id.desc())
        .limit(limit)
    )
    if user_id is not None:
        statement = statement.where(
            or_(
                AuditEventRow.target_user_id == user_id,
                AuditEventRow.actor_user_id == user_id,
            )
        )
    if project_key is not None:
        statement = statement.where(ProjectRow.project_key == project_key)
    if since is not None:
        statement = statement.where(AuditEventRow.at >= since)
    return [
        AuditEvent(
            at=row.at,
            actor=row.actor_label,
            action=row.action,
            target_type=row.target_type,
            target_id=row.target_id,
            project_key=row.project_key,
            details=row.details,
        )
        for row in conn.execute(statement)
    ]
