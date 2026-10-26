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
        {
            "project_key": "pkg-scenario-a",
            "project_name": "pkg-scenario-a",
            "roles": ["annotator", "lead"],
        }
    ]


@pytest.mark.parametrize("change", ["profile", "languages"])
def test_admins_can_edit_each_other_concurrently_without_audit_deadlock(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch, change: str
) -> None:
    """Reciprocal edits starting together both commit without audit-lock cycles."""
    import threading
    from concurrent.futures import ThreadPoolExecutor

    from ontocurator.api import admin_routes

    alice = logged_in(app, "alice", system_admin=True)
    bob = logged_in(app, "bobby", system_admin=True)
    action = "user.profile" if change == "profile" else "user.languages"
    before_authority_locks = threading.Barrier(2)
    real_require = admin_routes.require_system_admin

    def synchronized_authorization(principal):
        real_require(principal)
        before_authority_locks.wait(timeout=10)

    monkeypatch.setattr(
        admin_routes, "require_system_admin", synchronized_authorization
    )
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


def test_the_list_shows_setup_pending_last_login_and_project_names(app):
    from t1_fixtures import create_project

    create_project(app.state.repo.db)
    admin = logged_in(app, "root", system_admin=True)
    logged_in(app, "alice", projects={"proj": ["adjudicator"]}, assignments=[])
    admin.post("/api/v1/admin/users/", json={"username": "carol", "display_name": "C"})

    users = {
        user["username"]: user for user in admin.get("/api/v1/admin/users/").json()
    }
    assert users["carol"]["setup_pending"] is True
    assert users["carol"]["last_login_at"] is None
    assert users["alice"]["setup_pending"] is False
    assert users["alice"]["last_login_at"] is not None
    assert users["alice"]["projects"] == [
        {"project_key": "proj", "project_name": "Project", "roles": ["adjudicator"]}
    ]


def test_a_new_user_joins_projects_at_creation_or_not_at_all(app):
    from t1_fixtures import create_project

    create_project(app.state.repo.db)
    admin = logged_in(app, "root", system_admin=True)
    created = admin.post(
        "/api/v1/admin/users/",
        json={
            "username": "carol",
            "display_name": "Carol",
            "projects": [{"project_key": "proj", "roles": ["annotator"]}],
        },
    )
    assert created.status_code == 200, created.text
    assert [
        (p["project_key"], p["roles"]) for p in created.json()["user"]["projects"]
    ] == [("proj", ["annotator"])]
    # An unknown project rolls the whole creation back.
    failed = admin.post(
        "/api/v1/admin/users/",
        json={
            "username": "dave",
            "display_name": "Dave",
            "projects": [{"project_key": "nope", "roles": ["annotator"]}],
        },
    )
    assert failed.json()["code"] == "PROJECT_NOT_FOUND"
    assert app.state.accounts.get_by_username("dave") is None
    bad_role = admin.post(
        "/api/v1/admin/users/",
        json={
            "username": "dave",
            "display_name": "Dave",
            "projects": [{"project_key": "proj", "roles": ["boss"]}],
        },
    )
    assert bad_role.json()["code"] == "ROLE_INVALID"


def test_anonymising_needs_deactivation_and_the_typed_username(app):
    from ontocurator.storage.tables import (
        LoginAttemptRow,
        PasswordCredentialRow,
        SessionRow,
        UserLanguageRow,
        UserRow,
    )

    admin = logged_in(app, "root", system_admin=True)
    logged_in(app, "alice", pseudonym="ann-alice")
    admin.patch(
        "/api/v1/admin/users/alice",
        json={"email": "alice@example.org", "languages": ["de"], "qualification": "MD"},
    )
    path = "/api/v1/admin/users/alice/anonymise"
    active = admin.post(path, json={"confirm_username": "alice"})
    assert active.json()["code"] == "USER_ACTIVE"
    admin.patch("/api/v1/admin/users/alice", json={"active": False})
    wrong = admin.post(path, json={"confirm_username": "alicia"})
    assert wrong.json()["code"] == "CONFIRMATION_MISMATCH"

    done = admin.post(path, json={"confirm_username": "alice"})

    assert done.status_code == 200, done.text
    body = done.json()
    assert body["anonymised"] is True and body["pseudonym"] == "ann-alice"
    assert body["username"].startswith("anonymised-")
    with app.state.accounts.db.transaction() as conn:
        row = conn.execute(
            select(UserRow).where(UserRow.pseudonym == "ann-alice")
        ).one()
        assert (row.display_name, row.email, row.orcid, row.qualification) == (
            "Anonymised user",
            None,
            None,
            None,
        )
        assert "alice" not in json.dumps(dict(row._mapping), default=str).replace(
            "ann-alice", ""
        )
        for table in (PasswordCredentialRow, UserLanguageRow):
            assert not conn.execute(
                select(table).where(table.user_id == row.id)
            ).first()
        assert not conn.execute(
            select(LoginAttemptRow).where(LoginAttemptRow.username == "alice")
        ).first()
        traces = conn.execute(
            select(SessionRow.client_ip, SessionRow.user_agent).where(
                SessionRow.user_id == row.id
            )
        ).all()
        assert traces and all(trace == (None, None) for trace in traces)
        actions = (
            conn.execute(
                select(AuditEventRow.action).where(
                    AuditEventRow.target_id == body["username"]
                )
            )
            .scalars()
            .all()
        )
    assert actions == ["user.anonymise"]
    # Neither the old nor the new name logs in, and the account stays closed.
    for username in ("alice", body["username"]):
        login = TestClient(app).post(
            "/api/v1/auth/login",
            json={"username": username, "password": PASSWORD},
            headers=ORIGIN,
        )
        assert login.status_code == 401
    again = admin.patch(
        f"/api/v1/admin/users/{body['username']}", json={"active": True}
    )
    assert again.json()["code"] == "USER_ANONYMISED"
    reset = admin.post(f"/api/v1/admin/users/{body['username']}/reset-code")
    assert reset.json()["code"] == "USER_INACTIVE"
    assert app.state.accounts.get_by_username("alice") is None


def test_new_usernames_cannot_take_the_anonymised_prefix(app):
    admin = logged_in(app, "root", system_admin=True)
    response = admin.post(
        "/api/v1/admin/users/",
        json={"username": "anonymised-7", "display_name": "Sneaky"},
    )
    assert response.json()["code"] == "USERNAME_INVALID"


def test_an_admin_reads_the_audit_trail_of_a_user(app):
    admin = logged_in(app, "root", system_admin=True)
    admin.post("/api/v1/admin/users/", json={"username": "carol", "display_name": "C"})
    admin.post("/api/v1/admin/users/carol/reset-code")

    events = admin.get("/api/v1/admin/users/carol/audit")

    assert events.status_code == 200, events.text
    assert events.json()[0]["action"] == "user.reset_code"  # newest first
    assert {event["actor"] for event in events.json()} == {"user:root"}
    assert "user.create" in {event["action"] for event in events.json()}
    assert admin.get("/api/v1/admin/users/nobody/audit").json()["code"] == (
        "USER_NOT_FOUND"
    )
    alice = logged_in(app, "alice")
    assert alice.get("/api/v1/admin/users/carol/audit").status_code == 403
