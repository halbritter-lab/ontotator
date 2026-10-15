"""The principal of the running request, visible below the routes (index D-k).

The security middleware sets it for every authenticated request; the
repository reads it to name the user and the session in the edit log. Outside
a request (the CLI, start-up work, repository tests) it is None.
"""

from __future__ import annotations

from contextvars import ContextVar
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # the storage layer imports this module; keep it light
    from ontocurator.auth.sessions import Principal

current_principal: ContextVar[Principal | None] = ContextVar(
    "ontocurator_principal", default=None
)
