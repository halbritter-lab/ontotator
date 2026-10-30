"""Database limits of web requests: lock waits, slow statements, a full pool (#217)."""

from __future__ import annotations

import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import pytest
from auth_harness import logged_in
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.engine import Connection
from t1_fixtures import create_project
from test_auth_api import _app

from ontotator.auth.audit import Actor
from ontotator.jobs.queue import Job, JobContext
from ontotator.storage import database as database_module
from ontotator.storage.database import TransactionRollbackOnly, busy_cause
from ontotator.storage.repository import _lock_id

ROWS = "/api/v1/projects/proj/document-rows"
MEMBER = "/api/v1/projects/proj/members/other"


def _project_app(tmp_path: Path, **limits: int) -> FastAPI:
    app = _app(tmp_path, **limits)
    create_project(app.state.repo.db)
    return app


@contextmanager
def _held(app: FastAPI, *name: str):
    """An exclusive advisory lock, held by another session until the block ends."""
    with app.state.repo.db.engine.begin() as holder:
        holder.execute(select(func.pg_advisory_xact_lock(_lock_id(*name))))
        yield


def _assert_busy(response: Any) -> None:
    assert response.status_code == 503, response.text
    assert response.json()["code"] == "PROJECT_BUSY"
    assert "nothing was changed" in response.json()["details"]
    assert response.headers["retry-after"] == "5"


def test_a_held_lock_fails_a_read_within_the_limit(tmp_path: Path) -> None:
    app = _project_app(tmp_path, lock_timeout_ms=200)
    admin = logged_in(app, "root", system_admin=True)
    with _held(app, "project", "proj"):
        started = time.monotonic()
        response = admin.get(ROWS)
    assert time.monotonic() - started < 5
    _assert_busy(response)
    assert admin.get(ROWS).status_code == 200


def test_a_held_lock_fails_a_write_and_leaves_no_change(tmp_path: Path) -> None:
    app = _project_app(tmp_path, lock_timeout_ms=200)
    admin = logged_in(app, "root", system_admin=True)
    logged_in(app, "other")
    members = "/api/v1/projects/proj/members"

    def has_other() -> bool:
        return any(m["username"] == "other" for m in admin.get(members).json())

    with _held(app, "members", "proj"):
        _assert_busy(admin.put(MEMBER, json={"roles": ["annotator"]}))
    assert not has_other()
    assert admin.put(MEMBER, json={"roles": ["annotator"]}).status_code == 200
    assert has_other()


def test_a_long_statement_is_cancelled_the_same_way(tmp_path: Path) -> None:
    # No lock limit: the statement limit alone ends the wait.
    app = _project_app(tmp_path, lock_timeout_ms=0, statement_timeout_ms=200)
    admin = logged_in(app, "root", system_admin=True)
    with _held(app, "project", "proj"):
        response = admin.get(ROWS)
    _assert_busy(response)


def test_a_full_pool_fails_the_same_way(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(database_module, "POOL_TIMEOUT_SECONDS", 0.2)
    app = _project_app(tmp_path)
    admin = logged_in(app, "root", system_admin=True)
    engine = app.state.repo.db.engine
    taken: list[Connection] = []
    try:
        taken.extend(
            engine.connect()
            for _ in range(engine.pool.size() + engine.pool._max_overflow)
        )
        # The session lookup is the first thing to need a connection.
        _assert_busy(admin.get(ROWS))
    finally:
        for conn in taken:
            conn.close()
    assert admin.get(ROWS).status_code == 200


def test_a_rollback_only_transaction_keeps_the_cause(tmp_path: Path) -> None:
    app = _project_app(tmp_path, lock_timeout_ms=100)
    db = app.state.repo.db
    with (
        _held(app, "project", "proj"),
        pytest.raises(TransactionRollbackOnly) as raised,
        db.transaction() as conn,
    ):
        try:
            with db.transaction():
                conn.execute(
                    select(func.pg_advisory_xact_lock(_lock_id("project", "proj")))
                )
        except Exception:
            pass  # a caller that swallows the failure of a joined scope
    assert busy_cause(raised.value) == "55P03"
    assert busy_cause(ValueError("other")) is None


def test_the_worker_and_the_lease_have_no_limits(tmp_path: Path) -> None:
    app = _project_app(tmp_path, lock_timeout_ms=100, statement_timeout_ms=100)

    def slow(_job: Job, ctx: JobContext) -> dict[str, Any]:
        with ctx.db.transaction() as conn:
            conn.execute(
                select(func.pg_advisory_xact_lock(_lock_id("project", "proj")))
            )
            conn.execute(text("SELECT pg_sleep(0.3)"))
            return {
                name: conn.scalar(text(f"SHOW {name}"))
                for name in ("lock_timeout", "statement_timeout")
            }

    app.state.jobs.handlers["slow"] = slow
    with TestClient(app):
        with app.state.runtime_lease.engine.connect() as lease:
            assert lease.scalar(text("SHOW lock_timeout")) == "0"
        with _held(app, "project", "proj"):
            actor = Actor.user(None, "t")
            job_id = app.state.jobs.enqueue("slow", {}, actor=actor)
            # Far beyond the limit; the worker claims within its 2 s interval.
            time.sleep(2.5)
        deadline = time.monotonic() + 10
        while (job := app.state.jobs.get(job_id)).status in ("queued", "running"):
            assert time.monotonic() < deadline
            time.sleep(0.05)
    assert job.status == "succeeded", job.error
    assert job.result == {"lock_timeout": "0", "statement_timeout": "0"}
