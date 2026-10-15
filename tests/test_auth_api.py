"""Sessions on the HTTP API: cookie, CSRF, origin checks and identity binding."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import pytest
from auth_harness import ORIGIN, PASSWORD, ensure_user, logged_in
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pg_harness import database_url_for
from test_api import FIXTURE_PATH, _create_sample_package_bytes

from ontocurator.api.app import create_app
from ontocurator.auth.audit import Actor
from ontocurator.auth.passwords import hash_password
from ontocurator.config import AppConfig

ADMIN = Actor(None, "test:admin")
PACKAGE = "pkg-scenario-a"
DOCUMENT = "doc-beta"


def _app(tmp_path: Path, **config: Any) -> FastAPI:
    return create_app(
        AppConfig(
            workspace_dir=tmp_path,
            database_url=database_url_for(tmp_path / "auth.db"),
            ontology_paths=[FIXTURE_PATH],
            **config,
        )
    )


@pytest.fixture
def app(tmp_path: Path) -> FastAPI:
    return _app(tmp_path)


def _login(client: TestClient, username: str, password: str = PASSWORD, **kw: Any):  # type: ignore[no-untyped-def]
    return client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": password},
        **kw,
    )


def _set_cookie(response: Any) -> str:
    return "; ".join(response.headers.get_list("set-cookie"))


def test_the_api_needs_a_session(app: FastAPI) -> None:
    response = TestClient(app).get("/api/v1/packages")

    assert response.status_code == 401
    assert response.json()["code"] == "NOT_AUTHENTICATED"


def test_login_sets_a_strict_cookie_and_me_names_the_user(app: FastAPI) -> None:
    ensure_user(app, "alice")
    client = TestClient(app)

    response = _login(client, "alice", headers=ORIGIN)

    assert response.status_code == 200, response.text
    user = response.json()
    cookie = _set_cookie(response)
    assert cookie.startswith("ontocurator_session=")
    lowered = cookie.lower()
    assert "httponly" in lowered
    assert "samesite=lax" in lowered
    assert "path=/" in lowered
    assert "secure" not in lowered
    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json() == user
    assert user["username"] == "alice"
    assert user["pseudonym"].startswith("ann-")
    assert user["is_system_admin"] is False
    assert user["csrf_token"]


def test_the_cookie_is_secure_behind_an_https_origin(tmp_path: Path) -> None:
    app = _app(tmp_path, public_origin="https://editor.example")
    ensure_user(app, "alice")

    response = _login(
        TestClient(app), "alice", headers={"Origin": "https://editor.example"}
    )

    assert response.status_code == 200, response.text
    assert "secure" in _set_cookie(response).lower()


@pytest.mark.parametrize(
    "headers",
    [{}, {"Origin": "http://evil.example"}, {"Sec-Fetch-Site": "cross-site"}],
    ids=["no-headers", "foreign-origin", "cross-site-fetch"],
)
def test_a_login_must_come_from_the_page(app: FastAPI, headers: dict[str, str]) -> None:
    ensure_user(app, "alice")

    response = _login(TestClient(app), "alice", headers=headers)

    assert response.status_code == 403
    assert response.json()["code"] == "CROSS_SITE_REQUEST"


def test_every_failed_login_gives_the_same_answer(app: FastAPI) -> None:
    ensure_user(app, "alice")
    client = TestClient(app)

    wrong_password = _login(client, "alice", "not the passphrase", headers=ORIGIN)
    unknown_user = _login(client, "nobody", headers=ORIGIN)

    assert wrong_password.status_code == unknown_user.status_code == 401
    assert wrong_password.json() == unknown_user.json()
    assert wrong_password.json()["code"] == "LOGIN_FAILED"
    assert "set-cookie" not in wrong_password.headers


def test_a_write_needs_the_csrf_token(app: FastAPI) -> None:
    client = logged_in(app, "alice")
    token = client.headers.pop("X-CSRF-Token")

    refused = client.put("/api/v1/preferences", json={})
    accepted = client.put(
        "/api/v1/preferences", json={}, headers={"X-CSRF-Token": token}
    )

    assert refused.status_code == 403
    assert refused.json()["code"] == "CSRF_FAILED"
    assert accepted.status_code == 200, accepted.text


def test_logout_ends_the_session(app: FastAPI) -> None:
    client = logged_in(app, "alice")
    token = client.cookies.get("ontocurator_session")

    response = client.post("/api/v1/auth/logout")

    assert response.status_code == 204
    assert 'ontocurator_session=""' in _set_cookie(response)
    assert "path=/" in _set_cookie(response).lower()
    assert client.get("/api/v1/auth/me").status_code == 401
    # The old cookie is useless, also when a client keeps sending it.
    stale = TestClient(app, cookies={"ontocurator_session": token})
    assert stale.get("/api/v1/auth/me").status_code == 401


def test_a_setup_code_logs_the_new_user_in(app: FastAPI) -> None:
    issued = app.state.accounts.create_user(ADMIN, "carol", "Carol Example")
    client = TestClient(app)

    response = client.post(
        "/api/v1/auth/redeem-code",
        json={"username": "Carol", "code": issued.code, "new_password": PASSWORD},
        headers=ORIGIN,
    )

    assert response.status_code == 200, response.text
    assert response.json()["username"] == "carol"
    assert response.json()["display_name"] == "Carol Example"
    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["pseudonym"] == issued.user.pseudonym
    # The code is used up.
    again = client.post(
        "/api/v1/auth/redeem-code",
        json={"username": "carol", "code": issued.code, "new_password": PASSWORD},
        headers=ORIGIN,
    )
    assert again.status_code == 422
    assert again.json()["code"] == "CODE_INVALID"


def test_a_deactivated_user_is_logged_out_at_once(app: FastAPI) -> None:
    client = logged_in(app, "alice")
    assert client.get("/api/v1/auth/me").status_code == 200

    app.state.accounts.set_active(ADMIN, "alice", False)

    response = client.get("/api/v1/auth/me")
    assert response.status_code == 401
    assert response.json()["code"] == "NOT_AUTHENTICATED"


def test_the_first_admin_comes_from_the_configured_hash(tmp_path: Path) -> None:
    app = _app(tmp_path, admin_password_hash=hash_password("first admin passphrase"))
    client = TestClient(app)

    response = _login(client, "admin", "first admin passphrase", headers=ORIGIN)

    assert response.status_code == 200, response.text
    assert response.json()["is_system_admin"] is True
    assert response.json()["display_name"] == "Administrator"


def test_nobody_works_under_another_identity(app: FastAPI) -> None:
    admin = logged_in(app, "root", system_admin=True)
    uploaded = admin.post(
        "/api/v1/packages",
        files={
            "file": ("p.zip", _create_sample_package_bytes("single"), "application/zip")
        },
    )
    assert uploaded.status_code == 200, uploaded.text
    alice = logged_in(app, "alice", pseudonym="alice")
    bob = logged_in(app, "bob", pseudonym="bob")
    request = {"package_id": PACKAGE, "document_id": DOCUMENT, "mode": "independent"}

    opened = alice.post("/api/v1/workspaces/open", json=request)
    assert opened.status_code == 200, opened.text
    assert opened.json()["view"]["key"]["annotator_id"] == "alice"
    workspace_id = opened.json()["workspace_id"]

    as_alice = bob.post(
        "/api/v1/workspaces/open", json={**request, "annotator_id": "alice"}
    )
    assert as_alice.status_code == 403
    assert as_alice.json()["code"] == "IDENTITY_MISMATCH"

    command = bob.post(
        f"/api/v1/workspaces/{workspace_id}/commands",
        json={
            "mutation_id": "bob-1",
            "expected_revision": 0,
            "payload": {
                "command": "create_annotation",
                "annotation_id": "ann-bob",
                "layer_id": "hpo-layer",
                "type_id": "phenotype",
                "term_id": "HP:0001250",
                "axes": {"assertion": "present"},
            },
        },
    )
    assert command.status_code == 403
    assert command.json()["code"] == "IDENTITY_MISMATCH"


def test_only_a_system_admin_uploads_packages(app: FastAPI) -> None:
    client = logged_in(app, "alice")

    response = client.post(
        "/api/v1/packages",
        files={
            "file": ("p.zip", _create_sample_package_bytes("single"), "application/zip")
        },
    )

    assert response.status_code == 403
    assert response.json()["code"] == "ADMIN_REQUIRED"


# --- Follow-up review: malformed input, hosts, identity binding ------------- #


def _post_raw(client: TestClient, url: str, body: dict[str, str]) -> Any:
    """POST ``body`` as ASCII JSON, so lone surrogates survive the encoding."""
    return client.post(
        url,
        content=json.dumps(body),
        headers={**ORIGIN, "Content-Type": "application/json"},
    )


def test_a_malformed_login_is_an_ordinary_failure(app: FastAPI) -> None:
    ensure_user(app, "alice")

    response = _post_raw(
        TestClient(app),
        "/api/v1/auth/login",
        {"username": "ali\x00ce", "password": PASSWORD},
    )

    assert response.status_code == 401, response.text
    assert response.json()["code"] == "LOGIN_FAILED"


@pytest.mark.parametrize("field", ["username", "code"])
def test_a_malformed_redemption_gets_the_code_answer(app: FastAPI, field: str) -> None:
    issued = app.state.accounts.create_user(ADMIN, "carol", "Carol Example")
    body = {"username": "carol", "code": issued.code, "new_password": PASSWORD}
    body[field] = body[field][:2] + "\x00" + body[field][2:]

    response = _post_raw(TestClient(app), "/api/v1/auth/redeem-code", body)

    assert response.status_code == 422, response.text
    assert response.json()["code"] == "CODE_INVALID"


@pytest.mark.parametrize("url", ["/api/v1/auth/login", "/api/v1/auth/redeem-code"])
def test_a_lone_surrogate_is_invalid_input_not_a_server_error(
    app: FastAPI, url: str
) -> None:
    body = {"username": "ali\ud800ce", "password": PASSWORD}
    if url.endswith("redeem-code"):
        body = {"username": "carol", "code": "x\ud800", "new_password": PASSWORD}

    response = _post_raw(TestClient(app), url, body)

    assert response.status_code == 422, response.text
    error = response.json()["detail"][0]
    assert error["type"] == "string_unicode"
    # The answer never repeats what was sent (it may be a password).
    assert "input" not in error
    assert "ud800" not in response.text


def test_a_write_with_the_token_from_a_foreign_origin_is_refused(
    app: FastAPI,
) -> None:
    client = logged_in(app, "alice")

    response = client.put(
        "/api/v1/preferences", json={}, headers={"Origin": "http://evil.example"}
    )

    assert response.status_code == 403
    assert response.json()["code"] == "CROSS_SITE_REQUEST"


def test_a_new_login_ends_the_session_the_request_came_with(app: FastAPI) -> None:
    client = logged_in(app, "alice")
    old = client.cookies.get("ontocurator_session")
    ensure_user(app, "bob")

    response = _login(client, "bob", headers=ORIGIN)

    assert response.status_code == 200, response.text
    assert client.get("/api/v1/auth/me").json()["username"] == "bob"
    stale = TestClient(app, cookies={"ontocurator_session": old})
    assert stale.get("/api/v1/auth/me").status_code == 401


def test_only_trusted_hosts_are_served(tmp_path: Path) -> None:
    app = _app(tmp_path, trusted_hosts=("editor.example",))

    rebound = TestClient(app).get("/api/v1/auth/me")
    page = TestClient(app).get("/docs")
    trusted = TestClient(app, base_url="http://editor.example:8443")

    assert rebound.status_code == page.status_code == 400
    assert rebound.json() == {
        "code": "HOST_NOT_ALLOWED",
        "details": "This server does not answer to the host 'testserver'.",
    }
    assert trusted.get("/api/v1/auth/me").json()["code"] == "NOT_AUTHENTICATED"


def test_a_start_without_any_user_warns_about_the_missing_admin(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.WARNING, logger="ontocurator.api.app"):
        _app(tmp_path)

    assert "ONTOCURATOR_ADMIN_PASSWORD_HASH" in caplog.text


def test_only_a_system_admin_uploads_ontologies(app: FastAPI) -> None:
    client = logged_in(app, "alice")

    response = client.post(
        "/api/v1/ontologies",
        files={"file": ("hp.json", FIXTURE_PATH.read_bytes(), "application/json")},
    )

    assert response.status_code == 403
    assert response.json()["code"] == "ADMIN_REQUIRED"


@pytest.fixture
def alices_workspace(app: FastAPI) -> dict[str, Any]:
    """A package, alice's open workspace and logged-in clients."""
    admin = logged_in(app, "root", system_admin=True)
    uploaded = admin.post(
        "/api/v1/packages",
        files={
            "file": ("p.zip", _create_sample_package_bytes("single"), "application/zip")
        },
    )
    assert uploaded.status_code == 200, uploaded.text
    alice = logged_in(app, "alice", pseudonym="alice")
    opened = alice.post(
        "/api/v1/workspaces/open",
        json={"package_id": PACKAGE, "document_id": DOCUMENT, "mode": "independent"},
    )
    assert opened.status_code == 200, opened.text
    return {
        "admin": admin,
        "alice": alice,
        "bob": logged_in(app, "bob", pseudonym="bob"),
        "id": opened.json()["workspace_id"],
        "key": opened.json()["view"]["key"],
    }


@pytest.mark.parametrize(
    "url", ["/packages/{package}/documents", "/packages/{package}/export"]
)
def test_only_a_system_admin_reads_another_annotators_work(
    alices_workspace: dict[str, Any], url: str
) -> None:
    path = "/api/v1" + url.format(package=PACKAGE)
    params = {"annotator_id": "alice"}

    by_bob = alices_workspace["bob"].get(path, params=params)
    by_admin = alices_workspace["admin"].get(path, params=params)
    by_alice = alices_workspace["alice"].get(path, params=params)

    assert by_bob.status_code == 403
    assert by_bob.json()["code"] == "IDENTITY_MISMATCH"
    assert by_admin.status_code == 200, by_admin.text
    assert by_alice.status_code == 200, by_alice.text


ENVELOPE = {
    "mutation_id": "bob-1",
    "expected_revision": 0,
    "payload": {"command": "submit_workspace", "checked_layer_ids": []},
}
KEY = "<alice's workspace key>"


@pytest.mark.parametrize(
    ("method", "url", "body"),
    [
        ("get", "/workspaces/{id}/export", None),
        ("get", "/workspaces/{id}/submissions/sub-1", None),
        ("post", "/workspaces/{id}/decisions", ENVELOPE),
        ("post", "/workspaces/{id}/submit", ENVELOPE),
        (
            "post",
            "/search",
            {"workspace_key": KEY, "annotation_id": "a-1", "query": "seizure"},
        ),
        (
            "post",
            "/terms/tree/open",
            {
                "workspace_key": KEY,
                "annotation_id": "a-1",
                "layer_id": "hpo-layer",
                "term_id": "HP:0001250",
            },
        ),
    ],
    ids=["export", "submission", "decision", "submit", "search", "tree"],
)
def test_nobody_reaches_another_annotators_workspace(
    alices_workspace: dict[str, Any],
    method: str,
    url: str,
    body: dict[str, Any] | None,
) -> None:
    path = "/api/v1" + url.format(id=alices_workspace["id"])
    kwargs: dict[str, Any] = {}
    if body is not None:
        kwargs["json"] = {
            name: alices_workspace["key"] if value == KEY else value
            for name, value in body.items()
        }

    response = getattr(alices_workspace["bob"], method)(path, **kwargs)

    assert response.status_code == 403, response.text
    assert response.json()["code"] == "IDENTITY_MISMATCH"


def test_a_validation_error_does_not_repeat_the_password(app: FastAPI) -> None:
    response = TestClient(app).post(
        "/api/v1/auth/login",
        # Too long, so the password itself fails validation.
        json={"username": "alice", "password": "secret passphrase " * 100},
        headers=ORIGIN,
    )

    assert response.status_code == 422
    assert "secret passphrase" not in response.text


@pytest.mark.parametrize(
    ("trusted", "host"),
    [
        (("editor.example",), "EDITOR.Example:8443"),
        (("localhost", "127.0.0.1", "::1"), "[::1]:8000"),
        (("xn--bcher-kva.example",), "xn--bcher-kva.example"),
        (("Bücher.Example",), "xn--bcher-kva.example"),
    ],
    ids=["upper-case", "ipv6-with-port", "punycode", "configured-as-unicode"],
)
def test_a_trusted_host_is_matched_by_its_canonical_name(
    tmp_path: Path, trusted: tuple[str, ...], host: str
) -> None:
    app = _app(tmp_path, trusted_hosts=trusted)

    response = TestClient(app).get("/api/v1/auth/me", headers={"Host": host})

    assert response.json()["code"] == "NOT_AUTHENTICATED"
