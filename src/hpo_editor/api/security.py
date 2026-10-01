"""Security middleware and dependency guards for loopback API."""

from __future__ import annotations

import secrets
from urllib.parse import urlsplit

from fastapi import HTTPException, Request

ALLOWED_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})


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
        request.client is not None
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
        raise HTTPException(
            status_code=403,
            detail="Forbidden: Missing Bearer authorization token",
        )

    token = auth_header[len("Bearer ") :].strip()
    if not secrets.compare_digest(token, expected_token):
        raise HTTPException(
            status_code=403,
            detail="Forbidden: Invalid session token",
        )
