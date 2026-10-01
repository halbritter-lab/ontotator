"""Security middleware and dependency guards for loopback API."""

from __future__ import annotations

import secrets

from fastapi import HTTPException, Request

ALLOWED_HOSTS = frozenset({"127.0.0.1", "localhost", "[::1]", "testserver"})


def verify_security(request: Request, expected_token: str) -> None:
    """Validate host header against DNS rebinding and verify session token."""
    # 1. Host header validation
    host_header = request.headers.get("host", "")
    host_name = host_header.split(":")[0].strip().lower()
    if host_name not in ALLOWED_HOSTS:
        raise HTTPException(
            status_code=403,
            detail="Forbidden: Host header not permitted on loopback service",
        )

    # 2. Origin validation (if present)
    origin_header = request.headers.get("origin")
    if origin_header:
        origin_clean = origin_header.lower()
        if not any(
            origin_clean.startswith(f"http://{allowed}")
            for allowed in ALLOWED_HOSTS
        ):
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
