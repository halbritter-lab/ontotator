"""The audit hook: who changed what, written in the same transaction as the change."""

from __future__ import annotations

import getpass
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import Connection, insert

from ontocurator.storage.tables import AuditEventRow


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
    the trail and the change carry the same time.
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
    if at is not None:
        values["at"] = at
    conn.execute(insert(AuditEventRow).values(**values))
