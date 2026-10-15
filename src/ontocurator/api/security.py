"""Session cookie, CSRF and origin checks for the API (T2 P3, index D-h, D-k).

Every ``/api/`` request needs an open session, named by the HttpOnly cookie
``ontocurator_session``. A write (POST, PUT, PATCH, DELETE) must also come
from this site and carry the session's CSRF token in ``X-CSRF-Token``. The
two routes that have no session yet, login and code redemption, accept a
write only when the browser says it comes from this site (``Origin`` or
``Sec-Fetch-Site``); a request that says nothing is refused.
"""

from __future__ import annotations

import secrets
from collections.abc import Collection
from urllib.parse import urlsplit

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from starlette.middleware.base import RequestResponseEndpoint

from ontocurator.auth.context import current_principal as current_principal
from ontocurator.auth.sessions import SessionService

SESSION_COOKIE = "ontocurator_session"
CSRF_HEADER = "x-csrf-token"
UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
PUBLIC_PATHS = frozenset({"/api/v1/auth/login", "/api/v1/auth/redeem-code"})
CROSS_SITE_MESSAGE = "The request does not come from this site."


def expected_origin(request: Request, public_origin: str | None) -> str:
    """The configured public origin, else the origin of the request's own host."""
    return public_origin or f"{request.url.scheme}://{request.headers.get('host', '')}"


def cross_site(
    request: Request, public_origin: str | None, *, fail_closed: bool
) -> bool:
    """Whether the browser says the request comes from another site.

    With ``fail_closed``, a request that has neither ``Origin`` nor
    ``Sec-Fetch-Site`` counts as cross-site as well.
    """
    origin = request.headers.get("origin")
    fetch_site = request.headers.get("sec-fetch-site")
    if origin is not None and origin != expected_origin(request, public_origin):
        return True
    if fetch_site is not None and fetch_site not in ("same-origin", "none"):
        return True
    return fail_closed and origin is None and fetch_site is None


def host_name(request: Request) -> str | None:
    """The host of the ``Host`` header, lower-case and without port, or None."""
    try:
        return urlsplit(f"//{request.headers.get('host', '')}").hostname
    except ValueError:
        return None


def _error(status: int, code: str, details: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "details": details})


def install_security(
    app: FastAPI,
    sessions: SessionService | None,
    public_origin: str | None,
    trusted_hosts: Collection[str] | None = None,
) -> None:
    """Add the middleware that resolves the session and checks writes.

    With ``trusted_hosts``, a request for any other host is refused first,
    whatever its path (DNS rebinding). Without ``sessions`` (the schema-only
    app) every API request is refused, the public ones included.
    """

    @app.middleware("http")
    async def authenticate(
        request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        if trusted_hosts is not None:
            name = host_name(request)
            if name not in trusted_hosts:
                shown = name or request.headers.get("host", "")
                return _error(
                    400,
                    "HOST_NOT_ALLOWED",
                    f"This server does not answer to the host '{shown[:100]}'.",
                )
        path = request.url.path
        if not path.startswith("/api/"):
            return await call_next(request)
        if sessions is None:
            return _error(401, "NOT_AUTHENTICATED", "Log in to continue.")
        unsafe = request.method in UNSAFE_METHODS
        if path in PUBLIC_PATHS:  # no session yet
            if unsafe and cross_site(request, public_origin, fail_closed=True):
                return _error(403, "CROSS_SITE_REQUEST", CROSS_SITE_MESSAGE)
            return await call_next(request)
        token = request.cookies.get(SESSION_COOKIE)
        principal = await run_in_threadpool(sessions.resolve, token) if token else None
        if principal is None:
            return _error(401, "NOT_AUTHENTICATED", "Log in to continue.")
        if unsafe:
            if cross_site(request, public_origin, fail_closed=False):
                return _error(403, "CROSS_SITE_REQUEST", CROSS_SITE_MESSAGE)
            sent = request.headers.get(CSRF_HEADER, "")
            # Header values arrive latin-1 decoded, so they always encode.
            if not secrets.compare_digest(sent.encode(), principal.csrf_token.encode()):
                return _error(403, "CSRF_FAILED", "The page is out of date; reload it.")
        request.state.principal = principal
        reset = current_principal.set(principal)
        try:
            return await call_next(request)
        finally:
            current_principal.reset(reset)
