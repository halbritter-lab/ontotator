"""The principal of the running request, visible below the routes (index D-k).

The security middleware sets it for every authenticated request; the
repository reads it to name the user and the session in the edit log. Outside
a request (the CLI, start-up work, repository tests) it is None.
"""

from __future__ import annotations

from contextvars import ContextVar
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # the storage layer imports this module; keep it light
    from ontotator.auth.sessions import Principal

current_principal: ContextVar[Principal | None] = ContextVar(
    "ontotator_principal", default=None
)
# The API token a running job was started with (issue 305); the queue sets it.
current_job_api_token: ContextVar[dict[str, Any] | None] = ContextVar(
    "ontotator_job_api_token", default=None
)


def api_token_ref() -> dict[str, Any] | None:
    """The API token behind the running request or job, as ``{"id", "name"}``."""
    principal = current_principal.get()
    if principal is not None and principal.token is not None:
        return {"id": principal.token.token_id, "name": principal.token.name}
    return current_job_api_token.get()
