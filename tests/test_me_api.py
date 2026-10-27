"""Own profile and password acceptance."""

from pathlib import Path

import pytest
from auth_harness import ORIGIN, PASSWORD, logged_in
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from test_auth_api import _app

from ontotator.auth.audit import Actor
from ontotator.domain.errors import DomainError
from ontotator.storage.tables import LoginAttemptRow, UserRow

NEW_PASSWORD = "a fresh secure passphrase"


@pytest.fixture
def app(tmp_path: Path) -> FastAPI:
    return _app(tmp_path)


def test_users_edit_their_own_profile_and_languages(app):
    client = logged_in(app, "alice")
    before = client.get("/api/v1/auth/me").json()
    body = {
        "display_name": "Alice Example",
        "email": "alice@example.org",
        "orcid": "0000-0002-1825-0097",
        "orcid_consent": True,
        "languages": ["DE", "en"],
    }
    response = client.patch("/api/v1/me/profile", json=body)
    assert response.status_code == 200, response.text
    assert response.json() == {
        **body,
        "username": "alice",
        "pseudonym": before["pseudonym"],
        "languages": ["de", "en"],
        "qualification": None,
    }
    assert set(client.get("/api/v1/auth/me").json()) == set(before)
    kept = client.patch(
        "/api/v1/me/profile", json={"display_name": "Alice Again"}
    ).json()
    assert kept["orcid"] == body["orcid"] and kept["email"] == body["email"]
    cleared = client.patch(
        "/api/v1/me/profile", json={"email": None, "orcid": None}
    ).json()
    assert (
        cleared["email"] is None
        and cleared["orcid"] is None
        and cleared["orcid_consent"] is True
    )


def test_an_invalid_orcid_is_refused(app):
    client = logged_in(app, "alice")
    response = client.patch(
        "/api/v1/me/profile",
        json={"display_name": "Changed", "orcid": "0000-0002-1825-0099"},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "ORCID_INVALID"
    assert client.get("/api/v1/me/profile").json()["display_name"] == "alice"


def test_changing_the_password_keeps_this_session_and_ends_others(app):
    client = logged_in(app, "alice")
    other = logged_in(app, "alice")
    code = app.state.accounts.issue_reset_code(Actor(None, "test"), "alice")
    response = client.post(
        "/api/v1/me/password",
        json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
    )
    assert response.status_code == 204, response.text
    assert other.get("/api/v1/auth/me").status_code == 401
    assert client.get("/api/v1/auth/me").status_code == 200
    with pytest.raises(DomainError) as exc:
        app.state.accounts.redeem_code("alice", code.code, "another secure passphrase")
    assert exc.value.code == "CODE_INVALID"
    assert (
        TestClient(app)
        .post(
            "/api/v1/auth/login",
            json={"username": "alice", "password": NEW_PASSWORD},
            headers=ORIGIN,
        )
        .status_code
        == 200
    )


def test_a_wrong_current_password_counts_as_a_failed_login(app):
    client = logged_in(app, "alice")
    for _ in range(5):
        response = client.post(
            "/api/v1/me/password",
            json={"current_password": "wrong passphrase", "new_password": NEW_PASSWORD},
        )
        assert response.status_code == 403
        assert response.json()["code"] == "PASSWORD_WRONG"
    with app.state.accounts.db.transaction() as conn:
        attempts = conn.execute(
            select(LoginAttemptRow).where(
                LoginAttemptRow.username == "alice",
                LoginAttemptRow.succeeded.is_(False),
            )
        ).all()
    assert len(attempts) == 5 and all(not row.throttled for row in attempts)
    assert (
        TestClient(app)
        .post(
            "/api/v1/auth/login",
            json={"username": "alice", "password": PASSWORD},
            headers=ORIGIN,
        )
        .status_code
        == 401
    )


@pytest.mark.parametrize("kind", ["foreign", "revoked", "expired"])
def test_password_change_refuses_an_unusable_keep_session(app, kind):
    alice = logged_in(app, "alice")
    other = logged_in(app, "bob" if kind == "foreign" else "alice")
    account = app.state.accounts.get_by_username("alice")
    principal = app.state.sessions.resolve(other.cookies.get("ontotator_session"))
    if kind == "revoked":
        app.state.sessions.logout(principal.session_id)
    if kind == "expired":
        from datetime import UTC, datetime, timedelta

        from sqlalchemy import update

        from ontotator.storage.tables import SessionRow

        with app.state.accounts.db.transaction() as conn:
            conn.execute(
                update(SessionRow)
                .where(SessionRow.id == principal.session_id)
                .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
            )
    with app.state.accounts.db.transaction() as conn:
        before = conn.execute(
            select(UserRow.credential_generation).where(UserRow.id == account.id)
        ).scalar_one()
    with pytest.raises(DomainError) as exc:
        app.state.accounts.change_password(
            account.id, PASSWORD, NEW_PASSWORD, keep_session_id=principal.session_id
        )
    assert exc.value.code == "SESSION_INVALID"
    with app.state.accounts.db.transaction() as conn:
        assert (
            conn.execute(
                select(UserRow.credential_generation).where(UserRow.id == account.id)
            ).scalar_one()
            == before
        )
    assert alice.get("/api/v1/auth/me").status_code == 200


@pytest.mark.parametrize(
    "body", [{"display_name": None}, {"orcid_consent": None}, {"languages": None}]
)
def test_required_profile_patch_fields_cannot_be_null(app, body):
    client = logged_in(app, "alice")
    assert client.patch("/api/v1/me/profile", json=body).status_code == 422


def test_profile_languages_failure_rolls_back_profile_and_audit(app):
    from ontotator.storage.tables import AuditEventRow

    client = logged_in(app, "alice")
    response = client.patch(
        "/api/v1/me/profile", json={"display_name": "Changed", "languages": ["deu"]}
    )
    assert response.status_code == 422 and response.json()["code"] == "LANGUAGE_INVALID"
    assert client.get("/api/v1/me/profile").json()["display_name"] == "alice"
    with app.state.accounts.db.transaction() as conn:
        assert not conn.execute(
            select(AuditEventRow.id).where(
                AuditEventRow.target_id == "alice",
                AuditEventRow.action == "user.profile",
            )
        ).all()


def test_consent_without_orcid_and_profile_audits_only_field_names(app):
    from ontotator.storage.tables import AuditEventRow

    client = logged_in(app, "alice")
    response = client.patch(
        "/api/v1/me/profile",
        json={
            "display_name": "Private Example",
            "email": "private@example.org",
            "orcid_consent": True,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["orcid"] is None and response.json()["orcid_consent"] is True
    with app.state.accounts.db.transaction() as conn:
        details = conn.execute(
            select(AuditEventRow.details).where(
                AuditEventRow.target_id == "alice",
                AuditEventRow.action == "user.profile",
            )
        ).scalar_one()
    assert details == {"fields": ["display_name", "email", "orcid_consent"]}


def test_invalid_new_password_leaves_credentials_codes_and_sessions_untouched(app):
    client = logged_in(app, "alice")
    other = logged_in(app, "alice")
    code = app.state.accounts.issue_reset_code(Actor(None, "test"), "alice")
    response = client.post(
        "/api/v1/me/password",
        json={"current_password": PASSWORD, "new_password": "short"},
    )
    assert response.status_code == 422 and response.json()["code"] == "PASSWORD_RULES"
    assert other.get("/api/v1/auth/me").status_code == 200
    assert client.get("/api/v1/auth/me").status_code == 200
    assert (
        app.state.accounts.redeem_code("alice", code.code, NEW_PASSWORD).username
        == "alice"
    )
