"""API tokens (issue 305): bearer requests, scopes, expiry, revocation and audit."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from auth_harness import ORIGIN, PASSWORD, logged_in
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from test_auth_api import _app
from test_projects_api import create_project

from ontotator.api.token_scopes import (
    ROUTE_SCOPES,
    SESSION,
    accepted_scopes,
    contract_scope,
    openapi_path,
    requirement,
)
from ontotator.auth.api_tokens import TOKEN_PREFIX
from ontotator.auth.audit import Actor
from ontotator.auth.passwords import hash_password
from ontotator.auth.tokens import token_digest
from ontotator.storage.tables import ApiTokenRow, AuditEventRow

PROJECT = "phenotypes"


@pytest.fixture
def app(tmp_path) -> FastAPI:
    return _app(tmp_path)


@pytest.fixture
def admin(app: FastAPI) -> TestClient:
    client = logged_in(app, "root", system_admin=True)
    create_project(app, client)
    return client


def _bearer(app: FastAPI, secret: str, **headers: str) -> TestClient:
    return TestClient(app, headers={"Authorization": f"Bearer {secret}", **headers})


def _create(
    client: TestClient, scopes: list[str], url: str = "/api/v1/me/tokens", **body: Any
) -> dict[str, Any]:
    response = client.post(url, json={"name": "script", "scopes": scopes, **body})
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


def _audit(app: FastAPI, action: str) -> list[Any]:
    with app.state.repo.db.transaction() as conn:
        return list(
            conn.execute(
                select(AuditEventRow)
                .where(AuditEventRow.action == action)
                .order_by(AuditEventRow.id)
            )
        )


# Creation


def test_a_token_is_shown_once_and_stored_only_as_its_digest(
    app: FastAPI, admin: TestClient
) -> None:
    created = _create(admin, ["read"])
    secret = created["secret"]
    assert secret.startswith(TOKEN_PREFIX) and len(secret) == len(TOKEN_PREFIX) + 43
    token = created["token"]
    assert token["kind"] == "personal" and token["owner"] == "root"
    assert token["scopes"] == ["read"]
    lifetime = datetime.fromisoformat(token["expires_at"]) - datetime.fromisoformat(
        token["created_at"]
    )
    assert lifetime == timedelta(days=90)
    listed = admin.get("/api/v1/me/tokens").json()
    assert [item["id"] for item in listed] == [token["id"]]
    assert "secret" not in listed[0]
    with app.state.repo.db.transaction() as conn:
        stored = conn.execute(select(ApiTokenRow.token_sha256)).scalar_one()
    assert secret not in stored and len(stored) == 64
    [event] = _audit(app, "api_token.create")
    assert event.details["name"] == "script" and event.details["scopes"] == ["read"]


@pytest.mark.parametrize(
    ("body", "status"),
    [
        ({"scopes": []}, 422),
        ({"scopes": ["write"]}, 422),
        ({"scopes": ["admin"]}, 422),
        ({"scopes": ["read"], "expires_in_days": 366}, 422),
        ({"scopes": ["read"], "expires_in_days": 0}, 422),
        ({"scopes": ["read"], "name": "  "}, 422),
    ],
)
def test_invalid_tokens_are_refused(
    admin: TestClient, body: dict[str, Any], status: int
) -> None:
    response = admin.post("/api/v1/me/tokens", json={"name": "script", **body})
    assert response.status_code == status, response.text


def test_only_a_system_token_holds_the_admin_scope(
    app: FastAPI, admin: TestClient
) -> None:
    created = _create(admin, ["read", "admin"], "/api/v1/admin/tokens")
    assert created["token"]["kind"] == "system"
    assert created["token"]["scopes"] == ["read", "admin"]
    users = _bearer(app, created["secret"]).get("/api/v1/admin/users/")
    assert users.status_code == 200, users.text
    member = logged_in(app, "ann", projects={PROJECT: ["annotator"]})
    refused = member.post(
        "/api/v1/admin/tokens", json={"name": "x", "scopes": ["admin"]}
    )
    assert refused.status_code == 403
    assert member.get("/api/v1/admin/tokens").status_code == 403


# The bearer path in the security middleware


def test_csrf_is_skipped_only_for_bearer_requests(
    app: FastAPI, admin: TestClient
) -> None:
    secret = _create(admin, ["export"])["secret"]
    without_csrf = TestClient(app, cookies=dict(admin.cookies))
    refused = without_csrf.post(f"/api/v1/projects/{PROJECT}/exports", json={})
    assert refused.status_code == 403
    assert refused.json()["code"] == "CSRF_FAILED"

    started = _bearer(app, secret).post(
        f"/api/v1/projects/{PROJECT}/exports", json={"kind": "t1"}
    )
    assert started.status_code == 200, started.text


def test_bearer_and_cookie_together_are_refused(
    app: FastAPI, admin: TestClient
) -> None:
    secret = _create(admin, ["read"])["secret"]
    both = TestClient(
        app,
        cookies=dict(admin.cookies),
        headers={"Authorization": f"Bearer {secret}"},
    )
    response = both.get("/api/v1/projects")
    assert response.status_code == 400
    assert response.json()["code"] == "CREDENTIALS_AMBIGUOUS"


def test_a_bearer_write_from_another_site_is_refused(
    app: FastAPI, admin: TestClient
) -> None:
    secret = _create(admin, ["export"])["secret"]
    client = _bearer(app, secret, Origin="https://evil.example")
    response = client.post(f"/api/v1/projects/{PROJECT}/exports", json={"kind": "t1"})
    assert response.status_code == 403
    assert response.json()["code"] == "CROSS_SITE_REQUEST"
    same_site = _bearer(app, secret, **ORIGIN).post(
        f"/api/v1/projects/{PROJECT}/exports", json={"kind": "t1"}
    )
    assert same_site.status_code == 200, same_site.text


@pytest.mark.parametrize(
    "authorization",
    ["Bearer ott_unknown", "Bearer", "bearer  ", "Bearer not-a-token"],
)
def test_unknown_or_malformed_tokens_are_refused(
    app: FastAPI, authorization: str
) -> None:
    client = TestClient(app, headers={"Authorization": authorization})
    response = client.get("/api/v1/projects")
    assert response.status_code == 401
    assert response.json()["code"] == "TOKEN_INVALID"


@pytest.mark.parametrize("authorization", ["Bearer", "Bearer   "])
def test_a_bearer_header_without_token_never_falls_back_to_the_cookie(
    app: FastAPI, admin: TestClient, authorization: str
) -> None:
    client = TestClient(
        app, cookies=dict(admin.cookies), headers={"Authorization": authorization}
    )
    response = client.get("/api/v1/projects")
    assert response.status_code == 401
    assert response.json()["code"] == "TOKEN_INVALID"


def test_the_bearer_scheme_is_case_insensitive(app: FastAPI, admin: TestClient) -> None:
    secret = _create(admin, ["read"])["secret"]
    client = TestClient(app, headers={"Authorization": f"bEaReR {secret}"})
    assert client.get("/api/v1/projects").status_code == 200


def test_another_authorization_scheme_keeps_the_session(
    app: FastAPI, admin: TestClient
) -> None:
    # A proxy using HTTP Basic auth makes the browser send its header on
    # every request; the session cookie still decides.
    basic = {"Authorization": "Basic cm9vdDpwdw=="}
    browser = TestClient(app, cookies=dict(admin.cookies), headers=basic)
    assert browser.get("/api/v1/projects").status_code == 200
    csrf = admin.get("/api/v1/auth/me").json()["csrf_token"]
    started = browser.post(
        f"/api/v1/projects/{PROJECT}/exports",
        json={"kind": "t1"},
        headers={"X-CSRF-Token": csrf, **ORIGIN},
    )
    assert started.status_code == 200, started.text
    # Still a session request: the CSRF check applies.
    unchecked = browser.post(f"/api/v1/projects/{PROJECT}/exports", json={})
    assert unchecked.json()["code"] == "CSRF_FAILED"
    without_cookie = TestClient(app, headers=basic).get("/api/v1/projects")
    assert without_cookie.status_code == 401
    assert without_cookie.json()["code"] == "NOT_AUTHENTICATED"


def test_scopes_limit_the_routes(app: FastAPI, admin: TestClient) -> None:
    reader = _bearer(app, _create(admin, ["read"])["secret"])
    assert reader.get("/api/v1/projects").status_code == 200
    assert reader.get("/api/v1/auth/me").json()["csrf_token"] == ""
    missing = reader.post(f"/api/v1/projects/{PROJECT}/exports", json={"kind": "t1"})
    assert missing.status_code == 403
    assert missing.json()["code"] == "TOKEN_SCOPE_MISSING"
    admin_route = reader.get("/api/v1/admin/users/")
    assert admin_route.json()["code"] == "TOKEN_SCOPE_MISSING"
    # Annotation work and preferences need a browser session.
    for method, path in [
        ("POST", "/api/v1/workspaces/open"),
        ("GET", "/api/v1/preferences"),
        ("POST", "/api/v1/auth/logout"),
    ]:
        response = reader.request(method, path, json={})
        assert response.status_code == 403, (method, path)
        assert response.json()["code"] == "TOKEN_NOT_ALLOWED"


def test_a_token_cannot_create_list_or_revoke_tokens(
    app: FastAPI, admin: TestClient
) -> None:
    created = _create(admin, ["read", "import", "export", "project-admin"])
    system = _create(admin, ["read", "admin"], "/api/v1/admin/tokens")
    for secret in (created["secret"], system["secret"]):
        client = _bearer(app, secret)
        for method, path in [
            ("GET", "/api/v1/me/tokens"),
            ("POST", "/api/v1/me/tokens"),
            ("POST", f"/api/v1/me/tokens/{created['token']['id']}/revoke"),
            ("GET", f"/api/v1/projects/{PROJECT}/tokens"),
            ("POST", f"/api/v1/projects/{PROJECT}/tokens"),
            ("GET", "/api/v1/admin/tokens"),
            ("POST", "/api/v1/admin/tokens"),
        ]:
            response = client.request(
                method, path, json={"name": "x", "scopes": ["read"]}
            )
            assert response.status_code == 403, (method, path)
            assert response.json()["code"] == "TOKEN_NOT_ALLOWED"


def test_the_scope_never_exceeds_the_users_own_rights(
    app: FastAPI, admin: TestClient
) -> None:
    member = logged_in(app, "ann", projects={PROJECT: ["annotator"]})
    secret = _create(member, ["read", "project-admin", "export"])["secret"]
    client = _bearer(app, secret)
    changed = client.patch(f"/api/v1/projects/{PROJECT}/settings", json={"name": "x"})
    assert changed.status_code == 403
    exported = client.post(f"/api/v1/projects/{PROJECT}/exports", json={"kind": "t1"})
    assert exported.status_code == 403


# Expiry and revocation


def test_an_expired_token_stops_working(app: FastAPI, admin: TestClient) -> None:
    created = _create(admin, ["read"], expires_in_days=1)
    client = _bearer(app, created["secret"])
    assert client.get("/api/v1/projects").status_code == 200
    service = app.state.api_tokens
    later = datetime.now(UTC) + timedelta(days=1, seconds=1)
    service._now = lambda: later
    response = client.get("/api/v1/projects")
    assert response.status_code == 401
    assert response.json()["code"] == "TOKEN_INVALID"


def test_a_revoked_token_stops_working_and_last_use_is_recorded(
    app: FastAPI, admin: TestClient
) -> None:
    created = _create(admin, ["read"])
    client = _bearer(app, created["secret"])
    assert client.get("/api/v1/projects").status_code == 200
    [listed] = admin.get("/api/v1/me/tokens").json()
    assert listed["last_used_at"] is not None
    revoked = admin.post(f"/api/v1/me/tokens/{created['token']['id']}/revoke")
    assert revoked.status_code == 200, revoked.text
    assert revoked.json()["revoked_reason"] == "revoked"
    assert client.get("/api/v1/projects").status_code == 401
    assert len(_audit(app, "api_token.revoke")) == 1
    # Someone else's token is not found through the own-token route.
    other = logged_in(app, "ann", projects={PROJECT: ["annotator"]})
    foreign = other.post(f"/api/v1/me/tokens/{created['token']['id']}/revoke")
    assert foreign.status_code == 404


def _state(app: FastAPI, secret_of: dict[str, str]) -> dict[str, str]:
    """``revoked_reason`` of each named token ("" while it is not revoked)."""
    with app.state.repo.db.transaction() as conn:
        rows = {
            row.token_sha256: row.revoked_reason or ""
            for row in conn.execute(select(ApiTokenRow))
        }
    return {name: rows[token_digest(secret)] for name, secret in secret_of.items()}


def _reaches(app: FastAPI, secret: str, project: str) -> int:
    client = _bearer(app, secret)
    return client.get(f"/api/v1/projects/{project}/ontologies").status_code


def test_losing_the_lead_role_revokes_only_that_projects_tokens(
    app: FastAPI, admin: TestClient
) -> None:
    create_project(app, admin, "other")
    lead = logged_in(
        app, "lea", projects={PROJECT: ["lead", "annotator"], "other": ["lead"]}
    )
    tokens = {
        "personal": _create(lead, ["read"])["secret"],
        "here": _create(lead, ["read"], f"/api/v1/projects/{PROJECT}/tokens")["secret"],
        "other": _create(lead, ["read"], "/api/v1/projects/other/tokens")["secret"],
    }
    # A lost role no token depends on revokes nothing.
    app.state.memberships.set_roles(
        Actor.cli(), PROJECT, "lea", ["lead"], revoke_assignments=True
    )
    assert set(_state(app, tokens).values()) == {""}
    assert _reaches(app, tokens["here"], PROJECT) == 200

    app.state.memberships.set_roles(
        Actor.cli(), PROJECT, "lea", ["annotator"], revoke_assignments=True
    )
    assert _state(app, tokens) == {
        "personal": "",
        "here": "project.member_roles",
        "other": "",
    }
    assert _reaches(app, tokens["here"], PROJECT) == 401
    assert _reaches(app, tokens["other"], "other") == 200
    # The personal token keeps what the annotator may still read here.
    assert _reaches(app, tokens["personal"], PROJECT) == 200
    removals = [event.details for event in _audit(app, "project.member_remove")]
    assert removals[-1] == {"username": "lea", "roles": ["lead"], "tokens_revoked": 1}
    assert "tokens_revoked" not in removals[0]


def test_a_personal_token_loses_a_project_at_once_but_keeps_the_others(
    app: FastAPI, admin: TestClient
) -> None:
    create_project(app, admin, "other")
    member = logged_in(
        app, "ann", projects={PROJECT: ["annotator"], "other": ["annotator"]}
    )
    secret = _create(member, ["read"])["secret"]
    assert _reaches(app, secret, PROJECT) == 200
    assert _reaches(app, secret, "other") == 200
    app.state.memberships.set_roles(
        Actor.cli(), PROJECT, "ann", [], revoke_assignments=True
    )
    # Checked on the very next request: no stale right survives.
    assert _reaches(app, secret, PROJECT) == 404
    listed = _bearer(app, secret).get("/api/v1/projects").json()
    assert [project["project_key"] for project in listed] == ["other"]
    assert _reaches(app, secret, "other") == 200
    assert _state(app, {"personal": secret}) == {"personal": ""}


def test_a_project_token_survives_a_lost_lead_role_while_its_owner_is_an_admin(
    app: FastAPI, admin: TestClient
) -> None:
    logged_in(app, "second", system_admin=True)
    app.state.memberships.set_roles(Actor.cli(), PROJECT, "second", ["lead"])
    second = logged_in(app, "second")
    secret = _create(second, ["read"], f"/api/v1/projects/{PROJECT}/tokens")["secret"]
    app.state.memberships.set_roles(Actor.cli(), PROJECT, "second", [])
    # A system admin may still manage the project, so the token still works ...
    assert _reaches(app, secret, PROJECT) == 200
    # ... until the admin role goes too.
    app.state.accounts.set_system_admin(Actor.cli(), "second", False)
    assert _state(app, {"token": secret}) == {"token": "user.system_admin"}
    assert _reaches(app, secret, PROJECT) == 401


def test_losing_the_admin_role_revokes_only_the_tokens_it_backed(
    app: FastAPI, admin: TestClient
) -> None:
    create_project(app, admin, "other")
    logged_in(app, "second", system_admin=True)
    app.state.memberships.set_roles(Actor.cli(), PROJECT, "root", [])
    app.state.memberships.set_roles(Actor.cli(), "other", "root", ["lead"])
    root = logged_in(app, "root")
    tokens = {
        "system": _create(root, ["admin"], "/api/v1/admin/tokens")["secret"],
        "personal": _create(root, ["read"])["secret"],
        "unled": _create(root, ["read"], f"/api/v1/projects/{PROJECT}/tokens")[
            "secret"
        ],
        "led": _create(root, ["read"], "/api/v1/projects/other/tokens")["secret"],
    }
    assert _reaches(app, tokens["personal"], PROJECT) == 200  # as an admin
    app.state.accounts.set_system_admin(Actor.cli(), "root", False)
    assert _state(app, tokens) == {
        "system": "user.system_admin",
        "personal": "",
        "unled": "user.system_admin",
        "led": "",
    }
    users = _bearer(app, tokens["system"]).get("/api/v1/admin/users/")
    assert users.status_code == 401
    assert _reaches(app, tokens["led"], "other") == 200
    # The personal token now reads only what its owner may read.
    assert _reaches(app, tokens["personal"], PROJECT) == 404
    assert _reaches(app, tokens["personal"], "other") == 200
    [event] = _audit(app, "user.system_admin")
    assert event.details == {"is_system_admin": False, "tokens_revoked": 2}


def test_gaining_the_admin_role_revokes_no_token(
    app: FastAPI, admin: TestClient
) -> None:
    lead = logged_in(app, "lea", projects={PROJECT: ["lead"]})
    tokens = {
        "personal": _create(lead, ["read"])["secret"],
        "project": _create(lead, ["read"], f"/api/v1/projects/{PROJECT}/tokens")[
            "secret"
        ],
    }
    app.state.accounts.set_system_admin(Actor.cli(), "lea", True)
    assert set(_state(app, tokens).values()) == {""}
    assert _reaches(app, tokens["project"], PROJECT) == 200
    [event] = _audit(app, "user.system_admin")
    assert event.details == {"is_system_admin": True}


def test_changing_the_own_password_revokes_every_own_token(
    app: FastAPI, admin: TestClient
) -> None:
    lead = logged_in(app, "lea", projects={PROJECT: ["lead"]})
    other = logged_in(app, "ann", projects={PROJECT: ["annotator"]})
    tokens = {
        "personal": _create(lead, ["read"])["secret"],
        "project": _create(lead, ["read"], f"/api/v1/projects/{PROJECT}/tokens")[
            "secret"
        ],
        "system": _create(admin, ["admin"], "/api/v1/admin/tokens")["secret"],
        "someone else's": _create(other, ["read"])["secret"],
    }
    new = {"current_password": PASSWORD, "new_password": "another long passphrase"}
    changed = lead.post("/api/v1/me/password", json=new)
    assert changed.status_code == 204, changed.text
    assert lead.get("/api/v1/me/tokens").status_code == 200  # the session stays
    assert _state(app, tokens) == {
        "personal": "password_set",
        "project": "password_set",
        "system": "",
        "someone else's": "",
    }
    for name in ("personal", "project"):
        assert _reaches(app, tokens[name], PROJECT) == 401
    assert _audit(app, "user.password_set")[-1].details == {"tokens_revoked": 2}

    changed = admin.post("/api/v1/me/password", json=new)
    assert changed.status_code == 204, changed.text
    assert _state(app, {"system": tokens["system"]}) == {"system": "password_set"}


@pytest.mark.parametrize("change", ["reset_code", "deactivate", "recover"])
def test_new_credentials_or_a_lost_account_revoke_every_token(
    app: FastAPI, admin: TestClient, change: str
) -> None:
    logged_in(app, "second", system_admin=True)
    app.state.memberships.set_roles(Actor.cli(), PROJECT, "second", ["lead"])
    owner = logged_in(app, "second")
    tokens = {
        "personal": _create(owner, ["read"])["secret"],
        "project": _create(owner, ["read"], f"/api/v1/projects/{PROJECT}/tokens")[
            "secret"
        ],
        "system": _create(owner, ["admin"], "/api/v1/admin/tokens")["secret"],
    }
    accounts = app.state.accounts
    if change == "reset_code":
        accounts.issue_reset_code(Actor.cli(), "second")
        reason = "reset_code"
        [event] = _audit(app, "user.reset_code")
        assert event.details["tokens_revoked"] == 3
    elif change == "deactivate":
        accounts.set_active(Actor.cli(), "second", False)
        reason = "user.active"
    else:
        hashed = hash_password("a recovered passphrase")
        accounts.recover_admin("second", hashed, "ops", "lost laptop")
        reason = "recovered"
    assert set(_state(app, tokens).values()) == {reason}
    for secret in tokens.values():
        assert _bearer(app, secret).get("/api/v1/about").status_code == 401


def test_anonymising_keeps_every_token_revoked(app: FastAPI, admin: TestClient) -> None:
    owner = logged_in(app, "lea", projects={PROJECT: ["lead"]})
    secret = _create(owner, ["read"])["secret"]
    app.state.accounts.set_active(Actor.cli(), "lea", False)
    app.state.accounts.anonymise(Actor.cli(), "lea")
    assert _state(app, {"personal": secret}) == {"personal": "user.active"}
    assert _bearer(app, secret).get("/api/v1/about").status_code == 401


# Project tokens


def test_a_project_token_reaches_only_its_project(
    app: FastAPI, admin: TestClient
) -> None:
    create_project(app, admin, "other")
    created = _create(admin, ["read", "export"], f"/api/v1/projects/{PROJECT}/tokens")
    assert created["token"]["kind"] == "project"
    assert created["token"]["project_key"] == PROJECT
    client = _bearer(app, created["secret"])
    assert client.get(f"/api/v1/projects/{PROJECT}/members").status_code == 200
    for path in [
        "/api/v1/projects/other/members",
        "/api/v1/projects",
        "/api/v1/me/tasks",
    ]:
        response = client.get(path)
        assert response.status_code == 403, path
        assert response.json()["code"] == "TOKEN_NOT_ALLOWED"
    # Jobs find their project themselves: one of another project stays hidden.
    started = client.post(f"/api/v1/projects/{PROJECT}/exports", json={"kind": "t1"})
    assert started.status_code == 200, started.text
    job = started.json()["job_id"]
    assert client.get(f"/api/v1/jobs/{job}").status_code == 200
    elsewhere = admin.post("/api/v1/projects/other/exports", json={"kind": "t1"})
    assert client.get(f"/api/v1/jobs/{elsewhere.json()['job_id']}").status_code == 404
    listed = admin.get(f"/api/v1/projects/{PROJECT}/tokens").json()
    assert [item["id"] for item in listed] == [created["token"]["id"]]
    assert admin.get("/api/v1/projects/other/tokens").json() == []


def test_only_a_lead_manages_project_tokens(app: FastAPI, admin: TestClient) -> None:
    created = _create(admin, ["read"], f"/api/v1/projects/{PROJECT}/tokens")
    member = logged_in(app, "ann", projects={PROJECT: ["annotator"]})
    url = f"/api/v1/projects/{PROJECT}/tokens"
    assert member.get(url).status_code == 403
    assert member.post(url, json={"name": "x", "scopes": ["read"]}).status_code == 403
    assert member.post(f"{url}/{created['token']['id']}/revoke").status_code == 403
    lead = logged_in(app, "lea", projects={PROJECT: ["lead"]})
    revoked = lead.post(f"{url}/{created['token']['id']}/revoke")
    assert revoked.status_code == 200, revoked.text
    assert _bearer(app, created["secret"]).get("/api/v1/about").status_code == 401


# Audit


def test_writes_with_a_token_are_audited_with_the_token(
    app: FastAPI, admin: TestClient
) -> None:
    created = _create(admin, ["read", "project-admin"])
    client = _bearer(app, created["secret"])
    client.get(f"/api/v1/projects/{PROJECT}/settings")
    changed = client.patch(f"/api/v1/projects/{PROJECT}/settings", json={"name": "N"})
    assert changed.status_code == 200, changed.text
    [use] = _audit(app, "api_token.use")
    assert use.actor_label == "user:root"
    assert use.target_id == str(created["token"]["id"])
    assert use.details["method"] == "PATCH"
    assert use.details["path"] == f"/api/v1/projects/{PROJECT}/settings"
    assert use.details["api_token"] == {"id": created["token"]["id"], "name": "script"}
    # The change's own audit entry names the token as well.
    with app.state.repo.db.transaction() as conn:
        entries = list(
            conn.execute(
                select(AuditEventRow.details).where(
                    AuditEventRow.action.like("project.%"),
                    AuditEventRow.id > use.id,
                )
            ).scalars()
        )
    assert entries and all(
        entry["api_token"]["id"] == created["token"]["id"] for entry in entries
    )
    # The user's History leaves the request entries out, not the changes.
    actions = [e["action"] for e in admin.get("/api/v1/admin/users/root/audit").json()]
    assert "api_token.use" not in actions and "project.update" in actions


def test_the_admin_overview_lists_and_revokes_every_token(
    app: FastAPI, admin: TestClient
) -> None:
    member = logged_in(app, "ann", projects={PROJECT: ["annotator"]})
    created = _create(member, ["read"])
    _create(admin, ["read"], f"/api/v1/projects/{PROJECT}/tokens")
    listed = admin.get("/api/v1/admin/tokens").json()
    assert {item["kind"] for item in listed} == {"personal", "project"}
    assert [
        item["owner"] for item in admin.get("/api/v1/admin/tokens?kind=personal").json()
    ] == ["ann"]
    revoked = admin.post(f"/api/v1/admin/tokens/{created['token']['id']}/revoke")
    assert revoked.status_code == 200, revoked.text
    assert _bearer(app, created["secret"]).get("/api/v1/about").status_code == 401


# The route map


def test_every_route_has_exactly_one_scope(app: FastAPI) -> None:
    from fastapi.routing import _IncludedRouter

    routes = {
        (method, context.path)
        for route in app.router.routes
        if isinstance(route, _IncludedRouter)
        for context in route.effective_route_contexts()
        for method in context.methods
        if context.path.startswith("/api/")
    }
    # Demo logins exist only on a demo stack.
    assert routes == set(ROUTE_SCOPES) - {("GET", "/api/v1/auth/demo-logins")}
    # An any-of entry names token scopes only, never "session" or "admin".
    for scope in ROUTE_SCOPES.values():
        if isinstance(scope, tuple):
            assert len(scope) > 1 and len(set(scope)) == len(scope)
            assert set(scope) <= {"read", "import", "export", "project-admin"}
        assert accepted_scopes(scope)


def test_the_contract_names_each_operations_scope(app: FastAPI) -> None:
    schema = app.openapi()
    listed = {
        (method, openapi_path(path)): contract_scope(scope)
        for (method, path), scope in ROUTE_SCOPES.items()
    }
    for path, operations in schema["paths"].items():
        for method, operation in operations.items():
            assert operation["x-ontotator-scope"] == listed[(method.upper(), path)]
    assert set(schema["x-ontotator-scopes"]) == {
        "read",
        "import",
        "export",
        "project-admin",
        "admin",
        SESSION,
    }
    job = schema["paths"]["/api/v1/jobs/{job_id}"]["get"]
    assert job["x-ontotator-scope"] == ["read", "import", "export"]
    exports = schema["paths"]["/api/v1/projects/{key}/exports"]["post"]
    assert exports["x-ontotator-project-token"] is True
    assert "x-ontotator-project-token" not in schema["paths"]["/api/v1/projects"]["get"]


def test_a_token_follows_up_on_the_work_its_scope_starts(
    app: FastAPI, admin: TestClient
) -> None:
    exporter = _bearer(app, _create(admin, ["export"])["secret"], **ORIGIN)
    started = exporter.post(
        f"/api/v1/projects/{PROJECT}/exports", json={"kind": "edit_log"}
    )
    assert started.status_code == 200, started.text
    job_id = started.json()["job_id"]
    polled = exporter.get(f"/api/v1/jobs/{job_id}")
    assert polled.status_code == 200, polled.text
    job = app.state.jobs.claim(job_id, "token-test")
    assert app.state.jobs.run(job, "token-test").status == "succeeded"
    downloaded = exporter.get(f"/api/v1/jobs/{job_id}/download")
    assert downloaded.status_code == 200, downloaded.text

    importer = _bearer(app, _create(admin, ["import"])["secret"], **ORIGIN)
    uploaded = importer.post(
        f"/api/v1/projects/{PROJECT}/uploads",
        data={"kind": "text", "language": "de"},
        files=[("files[]", ("a.txt", b"Some text.\r\n"))],
    )
    assert uploaded.status_code == 200, uploaded.text
    upload = uploaded.json()
    polled = importer.get(f"/api/v1/jobs/{upload['job_id']}")
    assert polled.status_code == 200, polled.text
    status = importer.get(f"/api/v1/projects/{PROJECT}/uploads/{upload['upload_id']}")
    assert status.status_code == 200, status.text
    # Only export jobs have a download, and it needs the export scope.
    no_download = importer.get(f"/api/v1/jobs/{job_id}/download")
    assert no_download.json()["code"] == "TOKEN_SCOPE_MISSING"

    # A token with neither scope still cannot poll.
    other = _bearer(app, _create(admin, ["project-admin"])["secret"])
    refused = other.get(f"/api/v1/jobs/{job_id}")
    assert refused.status_code == 403
    assert refused.json()["code"] == "TOKEN_SCOPE_MISSING"
    assert "'read' or 'import' or 'export'" in refused.json()["details"]


def test_a_project_token_polls_only_jobs_of_its_project(
    app: FastAPI, admin: TestClient
) -> None:
    create_project(app, admin, "other")
    secret = _create(admin, ["export"], f"/api/v1/projects/{PROJECT}/tokens")["secret"]
    client = _bearer(app, secret, **ORIGIN)
    own = client.post(f"/api/v1/projects/{PROJECT}/exports", json={"kind": "t1"})
    assert client.get(f"/api/v1/jobs/{own.json()['job_id']}").status_code == 200
    elsewhere = admin.post("/api/v1/projects/other/exports", json={"kind": "edit_log"})
    job_id = elsewhere.json()["job_id"]
    job = app.state.jobs.claim(job_id, "token-test")
    assert app.state.jobs.run(job, "token-test").status == "succeeded"
    assert client.get(f"/api/v1/jobs/{job_id}").status_code == 404
    assert client.get(f"/api/v1/jobs/{job_id}/download").status_code == 404
    # A personal import token of a user outside the other project neither.
    member = logged_in(app, "ann", projects={PROJECT: ["lead", "annotator"]})
    importer = _bearer(app, _create(member, ["import"])["secret"])
    assert importer.get(f"/api/v1/jobs/{job_id}").status_code == 404


def test_path_parameters_match_like_the_routers() -> None:
    found = requirement(
        "GET", "/api/v1/projects/p/documents/a/b/annotation-versions/final/v/1"
    )
    assert found is not None
    assert found.project_key == "p" and found.scope == "read"
    assert requirement("GET", "/api/v1/projects/p/unknown") is None
    assert requirement("DELETE", "/api/v1/projects") is None
