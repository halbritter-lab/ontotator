"""Security middleware and dependency guards for loopback API."""

from __future__ import annotations

import secrets
from urllib.parse import urlsplit

from fastapi import HTTPException, Request

ALLOWED_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})

# Starlette's in-process TestClient sends ``Host: testserver`` from client
# ``testclient``. Production never trusts that transport; the test suite opts in
# explicitly by setting this flag (see tests/conftest.py).
ALLOW_TEST_CLIENT_HOST = False

# Error codes that tell the browser its session link is no longer valid (e.g.
# after a restart, which generates a new token) so it can show a friendly
# "please reopen Ontocurator" page instead of raw errors.
SESSION_TOKEN_MISSING = "SESSION_TOKEN_MISSING"
SESSION_TOKEN_INVALID = "SESSION_TOKEN_INVALID"


class SecurityError(HTTPException):
    """403 raised by :func:`verify_security`, optionally with an error code."""

    def __init__(self, detail: str, code: str | None = None) -> None:
        super().__init__(status_code=403, detail=detail)
        self.code = code


def _token_bytes(value: str) -> bytes:
    """Header values arrive latin-1 decoded; recover their raw bytes."""
    try:
        return value.encode("latin-1")
    except UnicodeEncodeError:
        return value.encode("utf-8")


def verify_security(request: Request, expected_token: str, port: int = 8000) -> None:
    """Validate host header against DNS rebinding and verify session token."""
    # 1. Host header validation
    host_header = request.headers.get("host", "")
    try:
        authority = urlsplit(f"http://{host_header}")
        host_name = authority.hostname
        host_port = authority.port or 80
    except ValueError:
        raise HTTPException(status_code=403, detail="Invalid Host header") from None
    is_test_transport = (
        ALLOW_TEST_CLIENT_HOST
        and request.client is not None
        and request.client.host == "testclient"
        and host_name == "testserver"
    )
    if not is_test_transport and (
        host_name not in ALLOWED_HOSTS
        or host_port != port
        or authority.username
        or authority.password
        or authority.path
    ):
        raise HTTPException(
            status_code=403,
            detail="Forbidden: Host header not permitted on loopback service",
        )

    # 2. Origin validation (if present)
    origin_header = request.headers.get("origin")
    if origin_header:
        try:
            origin = urlsplit(origin_header)
            same_origin = (
                origin.scheme == "http"
                and origin.hostname == host_name
                and (origin.port or 80) == host_port
                and not (
                    origin.username
                    or origin.password
                    or origin.path
                    or origin.query
                    or origin.fragment
                )
            )
        except ValueError:
            same_origin = False
        if not same_origin:
            raise HTTPException(
                status_code=403,
                detail="Forbidden: Cross-origin request not permitted",
            )

    # 3. Session token authentication
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise SecurityError(
            "Forbidden: Missing Bearer authorization token", SESSION_TOKEN_MISSING
        )

    token = auth_header[len("Bearer ") :].strip()
    # Compare bytes: compare_digest raises TypeError for non-ASCII str input.
    if not secrets.compare_digest(_token_bytes(token), expected_token.encode("utf-8")):
        raise SecurityError("Forbidden: Invalid session token", SESSION_TOKEN_INVALID)
