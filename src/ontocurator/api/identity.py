"""Binding requests to the logged-in user's identity.

Everyone works under their own pseudonym: an annotator ID or a workspace key
that names someone else is refused. A system admin may read other annotators'
document status and exports (index Q4), but annotates as themselves.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request

from ontocurator.auth.sessions import Principal
from ontocurator.domain.errors import AccessDenied
from ontocurator.domain.workspace import WorkspaceKey


def principal_of(request: Request) -> Principal:
    """The principal the security middleware resolved for this request."""
    principal = getattr(request.state, "principal", None)
    if not isinstance(principal, Principal):
        # Unreachable behind the middleware; refuse rather than guess.
        raise AccessDenied("NOT_AUTHENTICATED", "Log in to continue.")
    return principal


PrincipalDep = Annotated[Principal, Depends(principal_of)]


def _mismatch() -> AccessDenied:
    return AccessDenied(
        "IDENTITY_MISMATCH", "You can only work under your own pseudonym."
    )


def own_annotator(
    principal: Principal, requested: str | None, *, may_read_others: bool = False
) -> str:
    """The annotator ID a request acts as: the principal's pseudonym.

    ``None`` means the principal's own pseudonym. Another ID is refused,
    unless ``may_read_others`` and the principal is a system admin.

    Raises:
        AccessDenied: ``IDENTITY_MISMATCH``.
    """
    if requested is None or requested == principal.pseudonym:
        return principal.pseudonym
    if may_read_others and principal.is_system_admin:
        return requested
    raise _mismatch()


def own_key(principal: Principal, key: WorkspaceKey) -> WorkspaceKey:
    """``key`` if it is a workspace of the principal's own pseudonym.

    Raises:
        AccessDenied: ``IDENTITY_MISMATCH``.
    """
    if key.annotator_id != principal.pseudonym:
        raise _mismatch()
    return key


def require_system_admin(principal: Principal) -> None:
    """Raises ``AccessDenied("ADMIN_REQUIRED")`` unless a system admin."""
    if not principal.is_system_admin:
        raise AccessDenied("ADMIN_REQUIRED", "Only a system administrator may do this.")
