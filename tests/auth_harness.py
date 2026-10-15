"""Logged-in test clients: real users, real cookies, real CSRF and identity checks.

``AutoLoginClient`` lets the API tests written before accounts existed keep
naming annotators freely: before each request it logs in as the user whose
pseudonym is the annotator the request names, through the real login route.
"""

from __future__ import annotations

import hashlib
from typing import Any
from urllib.parse import parse_qs

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from ontocurator.api.routes import decode_workspace_id
from ontocurator.api.security import SESSION_COOKIE
from ontocurator.application.preferences import normalize_annotator_id
from ontocurator.auth.audit import Actor

PASSWORD = "test-only passphrase"
ORIGIN = {"Origin": "http://testserver"}
DEFAULT_ANNOTATOR = "tester"
HARNESS = Actor(None, "test:harness")


def ensure_user(
    app: FastAPI,
    username: str,
    *,
    system_admin: bool = False,
    pseudonym: str | None = None,
) -> None:
    """Create ``username`` with ``PASSWORD``, unless it exists already."""
    accounts = app.state.accounts
    if accounts.get_by_username(username) is not None:
        return
    issued = accounts.create_user(
        HARNESS,
        username,
        pseudonym or username,
        system_admin=system_admin,
        pseudonym=pseudonym,
    )
    accounts.redeem_code(username, issued.code, PASSWORD)


def log_in(client: TestClient, username: str) -> dict[str, Any]:
    """Log ``client`` in as ``username``; it sends the CSRF token from now on."""
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": PASSWORD},
        headers=ORIGIN,
    )
    assert response.status_code == 200, response.text
    user: dict[str, Any] = response.json()
    client.headers["X-CSRF-Token"] = user["csrf_token"]
    return user


def logged_in(
    app: FastAPI,
    username: str,
    *,
    system_admin: bool = False,
    pseudonym: str | None = None,
) -> TestClient:
    """A new client, logged in as ``username`` (created if needed)."""
    ensure_user(app, username, system_admin=system_admin, pseudonym=pseudonym)
    client = TestClient(app)
    log_in(client, username)
    return client


def username_for(annotator: str) -> str:
    """The harness user whose pseudonym is ``annotator``."""
    return "u-" + hashlib.sha256(annotator.encode("utf-8")).hexdigest()[:16]


def _valid_annotator(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        normalize_annotator_id(value)
    except ValueError:
        return None
    return value


class AutoLoginClient(TestClient):
    """A client that is always logged in as the annotator a request names.

    The annotator is, in this order: ``json["annotator_id"]``,
    ``json["workspace_key"]["annotator_id"]``, the ``annotator_id`` query
    parameter, the annotator of a ``/api/v1/workspaces/<id>/...`` path, and
    otherwise the user logged in last (``"tester"`` at first). Every harness
    user is a system admin, so uploads keep working.
    """

    def __init__(self, app: Any, **kwargs: Any) -> None:
        super().__init__(app, **kwargs)
        self.annotator: str | None = None

    def request(
        self, method: str, url: httpx._types.URLTypes, **kwargs: Any
    ) -> httpx.Response:
        target = httpx.URL(str(url))
        if target.path.startswith("/api/") and not target.path.startswith(
            "/api/v1/auth/"
        ):
            annotator = self._annotator_of(target, kwargs)
            if annotator != self.annotator:
                self.login_as(annotator)
        return super().request(method, url, **kwargs)

    def login_as(self, annotator: str) -> None:
        """Log in as the harness user of ``annotator`` (created once)."""
        username = username_for(annotator)
        ensure_user(self.app, username, system_admin=True, pseudonym=annotator)
        self.cookies.delete(SESSION_COOKIE)
        log_in(self, username)
        self.annotator = annotator

    def _annotator_of(self, target: httpx.URL, kwargs: dict[str, Any]) -> str:
        body = kwargs.get("json")
        if isinstance(body, dict):
            found = _valid_annotator(body.get("annotator_id"))
            if found is not None:
                return found
            key = body.get("workspace_key")
            if isinstance(key, dict):
                found = _valid_annotator(key.get("annotator_id"))
                if found is not None:
                    return found
        params = kwargs.get("params")
        if isinstance(params, dict):
            found = _valid_annotator(params.get("annotator_id"))
            if found is not None:
                return found
        query = parse_qs(target.query.decode("ascii")).get("annotator_id")
        if query:
            found = _valid_annotator(query[0])
            if found is not None:
                return found
        parts = target.path.split("/")
        if len(parts) > 4 and parts[1:4] == ["api", "v1", "workspaces"]:
            try:
                return decode_workspace_id(parts[4]).annotator_id
            except Exception:  # not a workspace ID (open, review-inputs, ...)
                pass
        return self.annotator or DEFAULT_ANNOTATOR
