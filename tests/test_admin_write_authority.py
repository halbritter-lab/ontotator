"""Admin writes retain current actor authority after queued requests wait."""

import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from typing import Any

import pytest
from auth_harness import logged_in
from fastapi import FastAPI
from sqlalchemy import select, text
from test_auth_api import _app

from ontocurator.api import admin_routes
from ontocurator.auth import accounts as accounts_module
from ontocurator.storage.tables import AuditEventRow, OneTimeCodeRow


@pytest.fixture
def app(tmp_path: Path) -> FastAPI:
    return _app(tmp_path)


def _wait_for_database_lock(app: FastAPI, pending: Future[Any]) -> None:
    """Release only after PostgreSQL reports a real lock wait; no timing sleep."""
    deadline = time.monotonic() + 10
    with app.state.accounts.db.engine.connect().execution_options(
        isolation_level="AUTOCOMMIT"
    ) as observer:
        while not pending.done():
            waiting = observer.execute(
                text(
                    "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'"
                )
            ).scalar_one()
            if waiting:
                return
            assert time.monotonic() < deadline, (
                "request did not reach a database lock wait"
            )
    pytest.fail("request completed before the expected database lock wait")


def _request(client, operation):
    if operation == "create":
        return client.post(
            "/api/v1/admin/users/", json={"username": "carol", "display_name": "Carol"}
        )
    if operation == "reset":
        return client.post("/api/v1/admin/users/bobby/reset-code")
    return client.patch(
        "/api/v1/admin/users/bobby", json={"display_name": "Forbidden change"}
    )


def _assert_no_queued_write(app: FastAPI, operation: str) -> None:
    assert app.state.accounts.get_by_username("carol") is None
    assert app.state.accounts.get_by_username("bobby").display_name == "bobby"
    with app.state.accounts.db.transaction() as conn:
        assert not conn.execute(
            select(AuditEventRow.id).where(
                AuditEventRow.actor_label == "user:alice",
                AuditEventRow.action.in_(
                    ["user.create", "user.reset_code", "user.profile"]
                ),
            )
        ).all()
        if operation == "reset":
            bobby_id = app.state.accounts.get_by_username("bobby").id
            assert not conn.execute(
                select(OneTimeCodeRow.id).where(
                    OneTimeCodeRow.user_id == bobby_id,
                    OneTimeCodeRow.purpose == "reset",
                )
            ).all()


def test_a_queued_self_grant_cannot_restore_revoked_admin_authority(app, monkeypatch):
    root = logged_in(app, "root", system_admin=True)
    alice = logged_in(app, "alice", system_admin=True)
    demotion_written, commit_demotion = threading.Event(), threading.Event()
    real_audit = accounts_module.record_audit

    def hold_demotion(conn, actor, action, **kwargs):
        if (
            actor.label == "user:root"
            and action == "user.system_admin"
            and kwargs.get("target_id") == "alice"
        ):
            demotion_written.set()
            assert commit_demotion.wait(10)
        return real_audit(conn, actor, action, **kwargs)

    monkeypatch.setattr(accounts_module, "record_audit", hold_demotion)
    with ThreadPoolExecutor(2) as pool:
        demoting = pool.submit(
            root.patch, "/api/v1/admin/users/alice", json={"is_system_admin": False}
        )
        assert demotion_written.wait(10)
        granting = pool.submit(
            alice.patch, "/api/v1/admin/users/alice", json={"is_system_admin": True}
        )
        try:
            _wait_for_database_lock(app, granting)
        finally:
            commit_demotion.set()
        assert demoting.result(timeout=10).status_code == 200
        refused = granting.result(timeout=10)
    assert refused.status_code == 403, refused.text
    assert refused.json()["code"] == "ADMIN_REQUIRED"
    assert app.state.accounts.get_by_username("alice").is_system_admin is False
    assert alice.get("/api/v1/auth/me").status_code == 401
    with app.state.accounts.db.transaction() as conn:
        assert not conn.execute(
            select(AuditEventRow.id).where(
                AuditEventRow.actor_label == "user:alice",
                AuditEventRow.action == "user.system_admin",
            )
        ).all()


@pytest.mark.parametrize("operation", ["create", "reset", "patch"])
@pytest.mark.parametrize("revocation", ["demote", "deactivate", "session"])
def test_admin_writes_recheck_the_actor_after_initial_authorization(
    app, monkeypatch, operation, revocation
):
    root = logged_in(app, "root", system_admin=True)
    alice = logged_in(app, "alice", system_admin=True)
    logged_in(app, "bobby")
    principal = app.state.sessions.resolve(alice.cookies.get("ontocurator_session"))
    initially_authorized, proceed = threading.Event(), threading.Event()
    real_require = admin_routes.require_system_admin

    def pause_after_snapshot_check(actor):
        real_require(actor)
        if actor.username == "alice":
            initially_authorized.set()
            assert proceed.wait(10)

    monkeypatch.setattr(
        admin_routes, "require_system_admin", pause_after_snapshot_check
    )
    with ThreadPoolExecutor(1) as pool:
        pending = pool.submit(_request, alice, operation)
        assert initially_authorized.wait(10)
        try:
            if revocation == "session":
                app.state.sessions.logout(principal.session_id)
            else:
                flag = "is_system_admin" if revocation == "demote" else "active"
                changed = root.patch("/api/v1/admin/users/alice", json={flag: False})
                assert changed.status_code == 200, changed.text
        finally:
            proceed.set()
        refused = pending.result(timeout=10)
    expected = 401 if revocation == "session" else 403
    assert refused.status_code == expected, refused.text
    assert refused.json()["code"] == (
        "NOT_AUTHENTICATED" if revocation == "session" else "ADMIN_REQUIRED"
    )
    _assert_no_queued_write(app, operation)


@pytest.mark.parametrize("operation", ["create", "reset", "patch"])
def test_an_admin_write_holds_actor_authority_until_its_transaction_commits(
    app, monkeypatch, operation
):
    root = logged_in(app, "root", system_admin=True)
    alice = logged_in(app, "alice", system_admin=True)
    logged_in(app, "bobby")
    writing, commit_write = threading.Event(), threading.Event()
    real_audit = accounts_module.record_audit
    action = {
        "create": "user.create",
        "reset": "user.reset_code",
        "patch": "user.profile",
    }[operation]

    def hold_write(conn, actor, event_action, **kwargs):
        if actor.label == "user:alice" and event_action == action:
            writing.set()
            assert commit_write.wait(10)
        return real_audit(conn, actor, event_action, **kwargs)

    monkeypatch.setattr(accounts_module, "record_audit", hold_write)
    with ThreadPoolExecutor(2) as pool:
        authorized = pool.submit(_request, alice, operation)
        assert writing.wait(10)
        demoting = pool.submit(
            root.patch, "/api/v1/admin/users/alice", json={"is_system_admin": False}
        )
        try:
            _wait_for_database_lock(app, demoting)
        finally:
            commit_write.set()
        accepted = authorized.result(timeout=10)
        demoted = demoting.result(timeout=10)
    assert accepted.status_code == demoted.status_code == 200
    assert app.state.accounts.get_by_username("alice").is_system_admin is False
    assert alice.get("/api/v1/auth/me").status_code == 401
    with app.state.accounts.db.transaction() as conn:
        assert conn.execute(
            select(AuditEventRow.id).where(
                AuditEventRow.actor_label == "user:alice",
                AuditEventRow.action == action,
            )
        ).scalar_one()


@pytest.mark.parametrize(
    "boundary", ["valid-past-clock", "idle-expiry", "absolute-expiry"]
)
def test_admin_write_uses_the_session_service_clock_after_authorization(
    app, monkeypatch, boundary
):
    from datetime import UTC, datetime, timedelta

    clock = [
        datetime(2000 if boundary == "valid-past-clock" else 2099, 1, 1, tzinfo=UTC)
    ]
    monkeypatch.setattr(app.state.sessions, "_now", lambda: clock[0])
    root = logged_in(app, "root", system_admin=True)
    assert root.get("/api/v1/auth/me").status_code == 200
    real_require = admin_routes.require_system_admin

    def advance_after_snapshot_check(principal):
        real_require(principal)
        if boundary == "idle-expiry":
            clock[0] += timedelta(hours=13)
        elif boundary == "absolute-expiry":
            clock[0] += timedelta(days=15)

    monkeypatch.setattr(
        admin_routes, "require_system_admin", advance_after_snapshot_check
    )
    response = _request(root, "create")
    if boundary == "valid-past-clock":
        assert response.status_code == 200, response.text
        assert app.state.accounts.get_by_username("carol") is not None
    else:
        assert response.status_code == 401, response.text
        assert response.json()["code"] == "NOT_AUTHENTICATED"
        assert app.state.accounts.get_by_username("carol") is None
