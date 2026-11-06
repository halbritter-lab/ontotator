"""API tokens after setup: reading the own token, handing work on (issue 305).

A token reads its own record with any scope, so a script sees its expiry. A
project token may reassign, withdraw, remove and reopen tasks of its own
project, never of another one: the assignment routes find their project
themselves and answer a task of another project as unknown.
"""

from __future__ import annotations

from typing import Any

from auth_harness import ORIGIN, logged_in
from fastapi import FastAPI
from fastapi.testclient import TestClient
from proposal_check_support import assign, proposal_env
from t1_fixtures import create_project

from ontotator.api.token_scopes import requirement


def _token(
    client: TestClient, scopes: list[str], url: str = "/api/v1/me/tokens"
) -> dict[str, Any]:
    response = client.post(url, json={"name": "pipeline", "scopes": scopes})
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


def _bearer(app: FastAPI, secret: str) -> TestClient:
    return TestClient(app, headers={"Authorization": f"Bearer {secret}", **ORIGIN})


def test_a_token_reads_its_own_record_with_any_scope(tmp_path) -> None:
    env = proposal_env(tmp_path)
    personal = _token(env.lead, ["export"])
    project = _token(env.lead, ["import"], "/api/v1/projects/proj/tokens")
    for created, kind, key in (
        (personal, "personal", None),
        (project, "project", "proj"),
    ):
        response = _bearer(env.app, created["secret"]).get("/api/v1/me/token")
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["id"] == created["token"]["id"]
        assert body["kind"] == kind
        assert body["project_key"] == key
        assert body["scopes"] == created["token"]["scopes"]
        assert body["expires_at"] == created["token"]["expires_at"]
        assert "secret" not in body
        assert created["secret"] not in response.text
    # A browser session has no token to read.
    response = env.lead.get("/api/v1/me/token")
    assert response.status_code == 404
    assert response.json()["code"] == "TOKEN_NOT_FOUND"


def test_a_revoked_token_cannot_read_itself(tmp_path) -> None:
    env = proposal_env(tmp_path)
    created = _token(env.lead, ["read"])
    revoked = env.lead.post(f"/api/v1/me/tokens/{created['token']['id']}/revoke")
    assert revoked.status_code == 200, revoked.text
    response = _bearer(env.app, created["secret"]).get("/api/v1/me/token")
    assert response.status_code == 401
    assert response.json()["code"] == "TOKEN_INVALID"


def test_the_handover_routes_are_open_to_project_tokens() -> None:
    for action in ("reassign", "reopen", "remove", "revoke"):
        needed = requirement("POST", f"/api/v1/assignments/7/{action}")
        assert needed is not None, action
        assert needed.scope == "project-admin"
        assert needed.project_token is True
        assert needed.project_key is None
    # Starting work on a task stays with the browser session.
    opened = requirement("POST", "/api/v1/assignments/7/open")
    assert opened is not None and opened.project_token is False


def test_a_project_token_hands_work_on_in_its_project(tmp_path) -> None:
    env = proposal_env(tmp_path)
    first = assign(env, env.c1, "anno")
    second = assign(env, env.c2, "anno")
    secret = _token(env.lead, ["project-admin"], "/api/v1/projects/proj/tokens")
    client = _bearer(env.app, secret["secret"])
    moved = client.post(
        f"/api/v1/assignments/{first['id']}/reassign",
        json={"username": "anno2", "confirm_language": True},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["username"] == "anno2"
    withdrawn = client.post(
        f"/api/v1/assignments/{second['id']}/revoke", json={"reason": "left"}
    )
    assert withdrawn.status_code == 200, withdrawn.text
    assert withdrawn.json()["revoked_at"] is not None
    # A token without the project-admin scope may not.
    reader = _bearer(
        env.app, _token(env.lead, ["read"], "/api/v1/projects/proj/tokens")["secret"]
    )
    refused = reader.post(f"/api/v1/assignments/{moved.json()['id']}/revoke", json={})
    assert refused.status_code == 403
    assert refused.json()["code"] == "TOKEN_SCOPE_MISSING"


def test_a_project_token_cannot_hand_on_work_of_another_project(tmp_path) -> None:
    env = proposal_env(tmp_path)
    task = assign(env, env.c1, "anno")
    create_project(env.db, key="other")
    lead = logged_in(env.app, "leader", projects={"other": ["lead"]}, assignments=[])
    secret = _token(lead, ["project-admin"], "/api/v1/projects/other/tokens")
    client = _bearer(env.app, secret["secret"])
    for action, body in (
        ("reassign", {"username": "anno2", "confirm_language": True}),
        ("revoke", {}),
        ("reopen", {}),
        ("remove", None),
    ):
        response = client.post(f"/api/v1/assignments/{task['id']}/{action}", json=body)
        assert response.status_code == 404, (action, response.text)
        # The same 404 as for an unknown task: neither the task nor its
        # project shows (issue 351).
        assert response.json()["code"] == "ASSIGNMENT_NOT_FOUND", action
    unchanged = lead.get("/api/v1/projects/proj/assignments").json()
    assert [(row["id"], row["username"], row["revoked_at"]) for row in unchanged] == [
        (task["id"], "anno", None)
    ]
