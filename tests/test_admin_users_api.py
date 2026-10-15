"""Users administration acceptance through real sessions and transactions."""

import json
from pathlib import Path

import pytest
from auth_harness import ORIGIN, PASSWORD, logged_in, upload_package
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from test_api import _create_sample_package_bytes
from test_auth_api import _app

from ontocurator.storage.tables import AuditEventRow


@pytest.fixture
def app(tmp_path: Path) -> FastAPI:
    return _app(tmp_path)


def test_an_admin_creates_a_user_and_sees_the_code_once(app):
    admin = logged_in(app, "root", system_admin=True)
    response = admin.post(
        "/api/v1/admin/users/",
        json={"username": "carol", "display_name": "Carol", "languages": ["DE", "en"]},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["code"]
    assert body["user"]["languages"] == ["de", "en"]
    listed = admin.get("/api/v1/admin/users/")
    assert listed.status_code == 200
    assert body["code"] not in listed.text
    assert all("code" not in user for user in listed.json())
    with app.state.accounts.db.transaction() as conn:
        audits = (
            conn.execute(
                select(AuditEventRow).where(AuditEventRow.target_id == "carol")
            )
            .mappings()
            .all()
        )
    assert any(row["action"] == "user.create" for row in audits)
    assert body["code"] not in json.dumps([dict(row) for row in audits], default=str)


def test_the_new_user_redeems_the_code_and_logs_in(app):
    admin = logged_in(app, "root", system_admin=True)
    issued = admin.post(
        "/api/v1/admin/users/", json={"username": "carol", "display_name": "Carol"}
    ).json()
    client = TestClient(app)
    response = client.post(
        "/api/v1/auth/redeem-code",
        json={"username": "carol", "code": issued["code"], "new_password": PASSWORD},
        headers=ORIGIN,
    )
    assert response.status_code == 200, response.text
    assert client.get("/api/v1/me/profile").json()["username"] == "carol"


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("get", "/", None),
        ("post", "/", {"username": "carol", "display_name": "Carol"}),
        ("post", "/alice/reset-code", None),
        ("patch", "/alice", {"display_name": "Changed"}),
    ],
)
def test_non_admins_get_403(app, method, path, body):
    admin = logged_in(app, "root", system_admin=True)
    imported = upload_package(
        admin,
        files={
            "file": ("p.zip", _create_sample_package_bytes("single"), "application/zip")
        },
    )
    assert imported.status_code == 200, imported.text
    client = logged_in(app, "alice", projects={"pkg-scenario-a": ["lead"]})
    response = client.request(method, "/api/v1/admin/users" + path, json=body)
    assert response.status_code == 403, response.text
    assert response.json()["code"] == "ADMIN_REQUIRED"


def test_deactivation_ends_the_users_sessions(app):
    admin = logged_in(app, "root", system_admin=True)
    alice = logged_in(app, "alice")
    assert (
        admin.patch("/api/v1/admin/users/alice", json={"active": False}).status_code
        == 200
    )
    assert alice.get("/api/v1/auth/me").status_code == 401


@pytest.mark.parametrize("body", [{"active": False}, {"is_system_admin": False}])
def test_an_admin_cannot_lock_themselves_out(app, body):
    admin = logged_in(app, "root", system_admin=True)
    response = admin.patch("/api/v1/admin/users/root", json=body)
    assert response.status_code == 409
    assert response.json()["code"] == "SELF_LOCKOUT"
    assert admin.get("/api/v1/auth/me").status_code == 200


def test_languages_are_validated_and_replaced(app):
    admin = logged_in(app, "root", system_admin=True)
    logged_in(app, "alice")
    path = "/api/v1/admin/users/alice"
    assert admin.patch(path, json={"languages": ["DE", "en"]}).json()["languages"] == [
        "de",
        "en",
    ]
    bad = admin.patch(path, json={"languages": ["deu"]})
    assert bad.status_code == 422
    assert bad.json()["code"] == "LANGUAGE_INVALID"
    assert admin.patch(path, json={"languages": []}).json()["languages"] == []


def test_invalid_compound_create_and_patch_roll_back(app):
    admin = logged_in(app, "root", system_admin=True)
    bad = admin.post(
        "/api/v1/admin/users/",
        json={"username": "carol", "display_name": "Carol", "languages": ["deu"]},
    )
    assert bad.status_code == 422
    assert app.state.accounts.get_by_username("carol") is None
    alice = logged_in(app, "alice")
    bad = admin.patch(
        "/api/v1/admin/users/alice",
        json={
            "display_name": "Changed",
            "email": "new@example.org",
            "is_system_admin": True,
            "active": False,
            "languages": ["deu"],
        },
    )
    assert bad.status_code == 422
    user = app.state.accounts.get_by_username("alice")
    assert (
        user.display_name == "alice"
        and user.email is None
        and user.active
        and not user.is_system_admin
    )
    assert alice.get("/api/v1/auth/me").status_code == 200
    with app.state.accounts.db.transaction() as conn:
        assert not conn.execute(
            select(AuditEventRow.id).where(
                AuditEventRow.target_id == "alice",
                AuditEventRow.action.in_(
                    [
                        "user.profile",
                        "user.active",
                        "user.system_admin",
                        "user.languages",
                    ]
                ),
            )
        ).all()


@pytest.mark.parametrize(
    "body",
    [
        {"display_name": None},
        {"active": None},
        {"is_system_admin": None},
        {"languages": None},
    ],
)
def test_required_admin_patch_fields_cannot_be_null(app, body):
    admin = logged_in(app, "root", system_admin=True)
    assert admin.patch("/api/v1/admin/users/root", json=body).status_code == 422


def test_admin_email_clear_differs_from_omission_and_reset_code_is_single_use(app):
    admin = logged_in(app, "root", system_admin=True)
    created = admin.post(
        "/api/v1/admin/users/",
        json={
            "username": "carol",
            "display_name": "Carol",
            "email": "carol@example.org",
        },
    ).json()
    path = "/api/v1/admin/users/carol"
    assert (
        admin.patch(path, json={"display_name": "Carol Example"}).json()["email"]
        == "carol@example.org"
    )
    assert admin.patch(path, json={"email": None}).json()["email"] is None
    reset = admin.post(path + "/reset-code")
    assert reset.status_code == 200, reset.text
    assert reset.json()["code"] != created["code"]
    stale = TestClient(app).post(
        "/api/v1/auth/redeem-code",
        json={"username": "carol", "code": created["code"], "new_password": PASSWORD},
        headers=ORIGIN,
    )
    assert stale.status_code == 422 and stale.json()["code"] == "CODE_INVALID"
    accepted = TestClient(app).post(
        "/api/v1/auth/redeem-code",
        json={
            "username": "carol",
            "code": reset.json()["code"],
            "new_password": PASSWORD,
        },
        headers=ORIGIN,
    )
    assert accepted.status_code == 200, accepted.text


@pytest.mark.parametrize("operation", ["create", "patch"])
def test_display_name_rules_apply_to_creates_and_updates(app, operation):
    admin = logged_in(app, "root", system_admin=True)
    if operation == "create":
        response = admin.post(
            "/api/v1/admin/users/",
            json={"username": "carol", "display_name": "x" * 121},
        )
        assert app.state.accounts.get_by_username("carol") is None
    else:
        response = admin.patch(
            "/api/v1/admin/users/root", json={"display_name": "x" * 121}
        )
        assert app.state.accounts.get_by_username("root").display_name == "root"
    assert (
        response.status_code == 422
        and response.json()["code"] == "DISPLAY_NAME_INVALID"
    )


def test_admin_listing_batches_project_keys_and_roles(app):
    admin = logged_in(app, "root", system_admin=True)
    imported = upload_package(
        admin,
        files={
            "file": ("p.zip", _create_sample_package_bytes("single"), "application/zip")
        },
    )
    assert imported.status_code == 200, imported.text
    logged_in(app, "alice", projects={"pkg-scenario-a": ["lead", "annotator"]})
    users = admin.get("/api/v1/admin/users/").json()
    alice = next(user for user in users if user["username"] == "alice")
    assert alice["projects"] == [
        {"project_key": "pkg-scenario-a", "roles": ["annotator", "lead"]}
    ]


@pytest.mark.parametrize("change", ["profile", "languages"])
def test_admins_can_edit_each_other_concurrently_without_audit_deadlock(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch, change: str
) -> None:
    """Both targets are locked before either audit checks its actor foreign key."""
    import threading
    from concurrent.futures import ThreadPoolExecutor

    from ontocurator.auth import accounts as accounts_module

    alice = logged_in(app, "alice", system_admin=True)
    bob = logged_in(app, "bobby", system_admin=True)
    action = "user.profile" if change == "profile" else "user.languages"
    at_audit = threading.Barrier(2)
    real_audit = accounts_module.record_audit

    def synchronized_audit(conn, actor, event_action, **kwargs):
        if event_action == action and kwargs.get("target_id") in {"alice", "bobby"}:
            at_audit.wait(timeout=10)
        return real_audit(conn, actor, event_action, **kwargs)

    monkeypatch.setattr(accounts_module, "record_audit", synchronized_audit)
    bodies = (
        [{"display_name": "Edited by Bobby"}, {"display_name": "Edited by Alice"}]
        if change == "profile"
        else [{"languages": ["de"]}, {"languages": ["en"]}]
    )

    def edit(client, target, body):
        try:
            return client.patch(f"/api/v1/admin/users/{target}", json=body)
        except Exception as exc:
            # Preserve the real PostgreSQL deadlock in the assertion evidence.
            return exc

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(edit, bob, "alice", bodies[0]),
            executor.submit(edit, alice, "bobby", bodies[1]),
        ]
        results = [future.result(timeout=20) for future in futures]
    errors = [str(result) for result in results if isinstance(result, Exception)]
    assert errors == []
    assert [result.status_code for result in results] == [200, 200]
    if change == "profile":
        assert (
            app.state.accounts.get_by_username("alice").display_name
            == "Edited by Bobby"
        )
        assert (
            app.state.accounts.get_by_username("bobby").display_name
            == "Edited by Alice"
        )
    else:
        users = [
            app.state.accounts.get_by_username(name) for name in ["alice", "bobby"]
        ]
        assert app.state.accounts.languages_of(user.id for user in users) == {
            users[0].id: frozenset({"de"}),
            users[1].id: frozenset({"en"}),
        }
    with app.state.accounts.db.transaction() as conn:
        audits = conn.execute(
            select(AuditEventRow.actor_user_id, AuditEventRow.target_id).where(
                AuditEventRow.action == action
            )
        ).all()
    alice_id = app.state.accounts.get_by_username("alice").id
    bob_id = app.state.accounts.get_by_username("bobby").id
    assert sorted(audits) == sorted([(bob_id, "alice"), (alice_id, "bobby")])


def test_invalid_profile_rolls_back_completed_compound_flag_changes(
    app: FastAPI,
) -> None:
    from ontocurator.storage.tables import UserRow

    admin = logged_in(app, "root", system_admin=True)
    alice = logged_in(app, "alice")
    user = app.state.accounts.get_by_username("alice")
    with app.state.accounts.db.transaction() as conn:
        generation = conn.execute(
            select(UserRow.credential_generation).where(UserRow.id == user.id)
        ).scalar_one()
    # Both flag setters write/revoke/audit before profile validation rejects this.
    response = admin.patch(
        "/api/v1/admin/users/alice",
        json={"active": False, "is_system_admin": True, "display_name": "   "},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "DISPLAY_NAME_INVALID"
    restored = app.state.accounts.get_by_username("alice")
    assert restored.active is True and restored.is_system_admin is False
    assert restored.display_name == "alice"
    assert alice.get("/api/v1/auth/me").status_code == 200
    with app.state.accounts.db.transaction() as conn:
        assert (
            conn.execute(
                select(UserRow.credential_generation).where(UserRow.id == user.id)
            ).scalar_one()
            == generation
        )
        assert not conn.execute(
            select(AuditEventRow.id).where(
                AuditEventRow.target_id == "alice",
                AuditEventRow.action.in_(
                    ["user.active", "user.system_admin", "user.profile"]
                ),
            )
        ).all()
