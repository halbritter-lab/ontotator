"""Stored token digests and session revocation, shared by accounts and sessions."""

from __future__ import annotations

import hashlib
from datetime import datetime

from sqlalchemy import Connection, update

from ontocurator.storage.tables import SessionRow


def token_digest(token: str) -> str:
    """The stored form of a session token or a single-use code.

    ``surrogatepass``: a mistyped code with a lone surrogate gets a digest that
    matches nothing, instead of an encoding error.
    """
    return hashlib.sha256(token.encode("utf-8", "surrogatepass")).hexdigest()


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
