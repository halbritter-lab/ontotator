"""Logged-in test clients: real users, real cookies, real CSRF and identity checks.

``AutoLoginClient`` lets the API tests written before accounts existed keep
naming annotators freely: before each request it logs in as the user whose
pseudonym is the annotator the request names, through the real login route.
"""

from __future__ import annotations

import hashlib
import io
import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast
from urllib.parse import parse_qs, unquote

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from ontocurator.api.routes import decode_workspace_id
from ontocurator.api.security import SESSION_COOKIE
from ontocurator.application.preferences import normalize_annotator_id
from ontocurator.auth.audit import Actor
from ontocurator.authz.policy import ROLES
from ontocurator.domain.errors import AccessDenied, DomainError, PayloadTooLarge

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


def grant(
    app: FastAPI, username: str, project: str, roles: Iterable[str] = ROLES
) -> bool:
    """Make ``username`` a member of ``project``; False if there is no such project.

    A new role ends the user's sessions (D2), so log in again afterwards.
    """
    try:
        app.state.memberships.add(HARNESS, project, username, roles)
    except DomainError as exc:
        if exc.code != "PROJECT_NOT_FOUND":
            raise
        return False
    return True


def ensure_assignment(
    app: FastAPI, username: str, project: str, document_id: str, task: str
) -> None:
    """Use real administration; retained revoked work is never recreated."""
    from ontocurator.assignments.service import AssignmentService

    service = AssignmentService(app.state.repo.db)
    rows = service.list(
        project, document_ids=[document_id], user=username, include_revoked=True
    )
    if any(row.task == task for row in rows):
        return
    # Synthetic users have no language preferences; this explicit override is
    # audited exactly as it is for an administrator confirming the language.
    service.assign(HARNESS, project, document_id, username, task, confirm_language=True)


def provision_assignments(
    app: FastAPI, username: str, project: str, roles: Iterable[str]
) -> None:
    tasks = []
    if "annotator" in roles:
        tasks.append("annotate")
    if "adjudicator" in roles:
        tasks.append("review")
    for document in app.state.repo.list_documents(project):
        for task in tasks:
            ensure_assignment(app, username, project, document.document_id, task)


def log_in(client: TestClient, username: str) -> dict[str, Any]:
    """Log ``client`` in as ``username``; it sends the CSRF token from now on."""
    # The page's own origin: http://testserver unless the client has another.
    origin = str(client.base_url).rstrip("/")
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": PASSWORD},
        headers={"Origin": origin},
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
    projects: Mapping[str, Iterable[str]] | None = None,
    assignments: str | list[tuple[str, str, str]] = "all",
) -> TestClient:
    """A new client, logged in as ``username`` (created if needed).

    ``projects`` gives the user these roles per project key first.
    """
    ensure_user(app, username, system_admin=system_admin, pseudonym=pseudonym)
    for project, roles in (projects or {}).items():
        assert grant(app, username, project, roles), f"no project '{project}'"
        if assignments == "all":
            provision_assignments(app, username, project, roles)
    if isinstance(assignments, list):
        for project, document, task in assignments:
            ensure_assignment(app, username, project, document, task)
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
    user is a system admin, so uploads keep working, and a member with every
    role of the project a request names (see ``_project_of``).
    """

    def __init__(self, app: Any, **kwargs: Any) -> None:
        super().__init__(app, **kwargs)
        self.annotator: str | None = None
        self.memberships: set[tuple[str, str]] = set()

    def request(
        self, method: str, url: httpx._types.URLTypes, **kwargs: Any
    ) -> httpx.Response:
        target = httpx.URL(str(url))
        if target.path.startswith("/api/") and not target.path.startswith(
            "/api/v1/auth/"
        ):
            annotator = self._annotator_of(target, kwargs)
            project = self._project_of(target, kwargs)
            joined = project is not None and self._join(annotator, project)
            if project is not None and (annotator, project) in self.memberships:
                provision_assignments(self.app, username_for(annotator), project, ROLES)
            if joined or annotator != self.annotator:
                self.login_as(annotator)
        return super().request(method, url, **kwargs)

    def login_as(self, annotator: str) -> None:
        """Log in as the harness user of ``annotator`` (created once)."""
        username = username_for(annotator)
        ensure_user(self.app, username, system_admin=True, pseudonym=annotator)
        self.cookies.delete(SESSION_COOKIE)
        log_in(self, username)
        self.annotator = annotator

    def _join(self, annotator: str, project: str) -> bool:
        """Give the annotator's user every role in ``project`` once; True if new."""
        if (annotator, project) in self.memberships:
            return False
        username = username_for(annotator)
        ensure_user(self.app, username, system_admin=True, pseudonym=annotator)
        if not grant(self.app, username, project):
            return False  # not imported yet; the next request tries again
        self.memberships.add((annotator, project))
        return True

    @staticmethod
    def _project_of(target: httpx.URL, kwargs: dict[str, Any]) -> str | None:
        """The project key a request names, if any."""
        body = kwargs.get("json")
        if isinstance(body, dict):
            if isinstance(body.get("project_key"), str):
                return str(body["project_key"])
            key = body.get("workspace_key", body.get("key"))
            if isinstance(key, dict) and isinstance(key.get("project_key"), str):
                return str(key["project_key"])
        parts = target.path.split("/")
        if len(parts) > 4 and parts[1:4] == ["api", "v1", "projects"]:
            return unquote(parts[4])
        if len(parts) > 4 and parts[1:4] == ["api", "v1", "workspaces"]:
            try:
                return decode_workspace_id(parts[4]).project_key
            except Exception:  # not a workspace ID (open, review-inputs, ...)
                return None
        return None

    def _annotator_of(self, target: httpx.URL, kwargs: dict[str, Any]) -> str:
        body = kwargs.get("json")
        if isinstance(body, dict):
            found = _valid_annotator(body.get("annotator_id"))
            if found is not None:
                return found
            key = body.get("workspace_key", body.get("key"))
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


# --- The retired upload routes (T2d Task 6) -------------------------------- #


@dataclass(frozen=True)
class UploadResult:
    """What the removed ``POST /api/v1/packages`` answered, without HTTP."""

    status_code: int
    body: dict[str, Any]

    def json(self) -> dict[str, Any]:
        return self.body

    @property
    def text(self) -> str:
        return json.dumps(self.body, default=str)


def _status_of(exc: DomainError) -> int:
    if isinstance(exc, PayloadTooLarge):
        return 413
    if isinstance(exc, AccessDenied):
        return 403
    return 404 if exc.code in {"PROJECT_NOT_FOUND", "PACKAGE_NOT_FOUND"} else 422


def upload_package(client: TestClient, *, files: Mapping[str, Any]) -> UploadResult:
    """Import a v2 work package as the client's user, as the old upload did.

    The package is read with the test-only v2 reader and imported through the
    user's scoped repository: a system admin only, and a new project gets the
    uploader as a member with every role. Errors answer like the old route:
    403 for a non-admin, 413 for an oversized body, 422 for an invalid
    package (``{code, details}``).
    """
    from support.v2_import import PackageImportService

    from ontocurator.authz.scoped import ScopedRepository

    if isinstance(client, AutoLoginClient) and client.annotator is None:
        client.login_as(DEFAULT_ANNOTATOR)
    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200, me.text
    app = cast(FastAPI, client.app)
    user = app.state.accounts.get_by_username(me.json()["username"])
    if not user.is_system_admin:
        return UploadResult(
            403,
            {
                "code": "ADMIN_REQUIRED",
                "details": "Only a system administrator may do this.",
            },
        )
    repo = ScopedRepository(
        app.state.repo.db,
        app.state.memberships.access_for(
            SimpleNamespace(
                user_id=user.id,
                pseudonym=user.pseudonym,
                is_system_admin=user.is_system_admin,
            )
        ),
        Actor.user(user.id, user.username),
    )
    upload = files["file"]
    data = upload[1] if isinstance(upload, tuple) else upload
    if not isinstance(data, bytes):
        data = data.read()
    try:
        manifest = PackageImportService(
            repo, app.state.ontology_registry
        ).import_upload(io.BytesIO(data))
    except DomainError as exc:
        return UploadResult(
            _status_of(exc), {"code": exc.code, "details": exc.details or str(exc)}
        )
    except ValidationError as exc:
        return UploadResult(422, {"code": "VALIDATION_ERROR", "details": str(exc)})
    return UploadResult(
        200, {"project_key": manifest.package_id, "manifest": manifest.model_dump()}
    )


def add_ontology(app: FastAPI, path: Path, *, name: str | None = None) -> Any:
    """Store an ontology or translation file as the admin CLI does (D5)."""
    store = app.state.ontology_store
    return store.add(HARNESS, name or path.name, path.read_bytes())
