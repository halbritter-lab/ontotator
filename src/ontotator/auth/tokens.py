"""Stored token digests, and ending sessions and API tokens.

Which change ends what (issue 305):

- Sessions end on every change of a user's rights or credentials (the
  callers of ``revoke_user_sessions``); a change of one's own password keeps
  the session it was made in.
- All API tokens of a user are revoked when the credentials change or the
  account goes (``revoke_user_tokens``): a password set or changed, a reset
  code, deactivation, anonymisation.
- A lost role revokes only the tokens that depended on it
  (``revoke_unbacked_tokens``): a system token when the owner is no longer a
  system admin, a project token when its owner may no longer manage its
  project (neither its lead nor a system admin). A personal token is kept:
  each request checks the owner's current roles, so its reach shrinks with
  them at once.
"""

from __future__ import annotations

import hashlib
from datetime import datetime

from sqlalchemy import Connection, and_, exists, not_, or_, select, update

from ontotator.storage.tables import (
    ApiTokenRow,
    ProjectMembershipRow,
    SessionRow,
    UserRow,
)


def token_digest(token: str) -> str:
    """The stored form of a session token or a single-use code.

    ``surrogatepass``: a mistyped code with a lone surrogate gets a digest that
    matches nothing, instead of an encoding error.
    """
    return hashlib.sha256(token.encode("utf-8", "surrogatepass")).hexdigest()


def revoke_user_sessions(
    conn: Connection,
    user_id: int,
    reason: str,
    at: datetime,
    *,
    keep_session_id: int | None = None,
) -> int:
    """End every open session of ``user_id`` but ``keep_session_id``; the count.

    API tokens are not touched: see ``revoke_user_tokens`` and
    ``revoke_unbacked_tokens``.
    """
    conditions = [SessionRow.user_id == user_id, SessionRow.revoked_at.is_(None)]
    if keep_session_id is not None:
        conditions.append(SessionRow.id != keep_session_id)
    result = conn.execute(
        update(SessionRow)
        .where(*conditions)
        .values(revoked_at=at, revoked_reason=reason)
    )
    return result.rowcount


def revoke_user_tokens(
    conn: Connection, user_id: int, reason: str, at: datetime
) -> int:
    """Revoke every usable API token ``user_id`` owns, of every kind; the count."""
    result = conn.execute(
        update(ApiTokenRow)
        .where(ApiTokenRow.owner_id == user_id, ApiTokenRow.revoked_at.is_(None))
        .values(revoked_at=at, revoked_reason=reason)
    )
    return result.rowcount


def revoke_unbacked_tokens(
    conn: Connection, user_id: int, reason: str, at: datetime
) -> int:
    """Revoke the tokens of ``user_id`` its current roles no longer back; the count.

    Run after a role was taken away, in the same transaction, with the
    user's row and the project's members locked by the caller. The rule is
    the one ``ApiTokenService.resolve`` checks on every request:

    - a ``system`` token needs its owner to be a system admin;
    - a ``project`` token needs its owner to lead its project or to be a
      system admin;
    - a ``personal`` token is never revoked here: it acts with the owner's
      current roles, read afresh on every request.
    """
    is_admin = conn.execute(
        select(UserRow.is_system_admin).where(UserRow.id == user_id)
    ).scalar_one()
    if is_admin:
        return 0
    leads = exists().where(
        ProjectMembershipRow.project_id == ApiTokenRow.project_id,
        ProjectMembershipRow.user_id == user_id,
        ProjectMembershipRow.role == "lead",
    )
    result = conn.execute(
        update(ApiTokenRow)
        .where(
            ApiTokenRow.owner_id == user_id,
            ApiTokenRow.revoked_at.is_(None),
            or_(
                ApiTokenRow.kind == "system",
                and_(ApiTokenRow.kind == "project", not_(leads)),
            ),
        )
        .values(revoked_at=at, revoked_reason=reason)
    )
    return result.rowcount
