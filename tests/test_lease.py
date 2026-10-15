"""The runtime lease: servers share it, the offline recovery needs it alone."""

from __future__ import annotations

import logging
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pg_harness import database_for
from sqlalchemy import Engine, text

from ontocurator.api.app import create_app
from ontocurator.config import AppConfig
from ontocurator.storage.lease import RUNTIME_LEASE, RuntimeLease, exclusive_lease


def _alone(engine: Engine) -> bool:
    with exclusive_lease(engine) as acquired:
        return acquired


def test_the_exclusive_lease_is_refused_while_a_server_holds_it(
    tmp_path: Path,
) -> None:
    db = database_for(tmp_path / "editor.db")
    first, second = RuntimeLease(db.engine), RuntimeLease(db.engine)

    assert _alone(db.engine)
    first.acquire()
    second.acquire()  # shared: several servers at once
    assert not _alone(db.engine)
    first.release()
    assert not _alone(db.engine)
    second.release()
    second.release()  # safe twice, and safe if never acquired
    RuntimeLease(db.engine).release()

    assert _alone(db.engine)
    with exclusive_lease(db.engine) as acquired:
        assert acquired
        assert not _alone(db.engine)  # one recovery at a time
    assert _alone(db.engine)


def test_the_app_holds_the_lease_while_it_runs(tmp_path: Path) -> None:
    app = create_app(AppConfig(workspace_dir=tmp_path))
    db = database_for(tmp_path / "editor.db")

    assert _alone(db.engine)  # create_app alone does not take it
    with TestClient(app):
        assert app.state.runtime_lease.held
        assert not _alone(db.engine)
    assert not app.state.runtime_lease.held
    assert _alone(db.engine)


def _kill_session(engine: Engine, lease: RuntimeLease) -> int:
    """End the lease's database session, as a server restart or a timeout would."""
    conn = lease._conn
    assert conn is not None
    pid = int(conn.execute(text("SELECT pg_backend_pid()")).scalar_one())
    with engine.connect() as other:
        assert other.execute(
            text("SELECT pg_terminate_backend(:p)"), {"p": pid}
        ).scalar()
    return pid


def test_a_lost_lease_connection_is_noticed_and_replaced(tmp_path: Path) -> None:
    db = database_for(tmp_path / "editor.db")
    lease = RuntimeLease(db.engine)
    lease.acquire()
    try:
        assert lease.check() is True  # alive: nothing to do

        _kill_session(db.engine, lease)
        assert _alone(db.engine)  # the lease is gone with its session

        assert lease.check() is False  # noticed and acquired again
        assert lease.held
        assert not _alone(db.engine)
    finally:
        lease.release()
    assert _alone(db.engine)


def _shared_holders(engine: Engine) -> set[int]:
    """Backends of this database that hold the runtime lease shared."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND granted"
                " AND mode = 'ShareLock' AND objsubid = 1"
                " AND database = (SELECT oid FROM pg_database"
                "                 WHERE datname = current_database())"
                " AND ((classid::bigint << 32) | objid::bigint) = :k"
            ),
            {"k": RUNTIME_LEASE},
        )
        return {int(pid) for pid in rows.scalars()}


def test_the_running_app_takes_a_lost_lease_again(tmp_path: Path) -> None:
    app = create_app(AppConfig(workspace_dir=tmp_path))
    engine = app.state.repo.db.engine
    app.state.runtime_lease = RuntimeLease(engine, check_interval=0.05)

    with TestClient(app):
        lease = app.state.runtime_lease
        (old_pid,) = _shared_holders(engine)
        with engine.connect() as other:
            other.execute(text("SELECT pg_terminate_backend(:p)"), {"p": old_pid})
        deadline = time.monotonic() + 10
        while True:
            holders = _shared_holders(engine)
            if holders and old_pid not in holders:
                break
            assert time.monotonic() < deadline, "the lost lease was not taken again"
            time.sleep(0.05)
        assert not _alone(engine)
    assert not lease.held
    assert _alone(engine)


def test_a_server_start_waits_for_a_running_recovery(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    db = database_for(tmp_path / "editor.db")
    lease = RuntimeLease(db.engine)
    caplog.set_level(logging.WARNING, logger="ontocurator.storage.lease")

    with exclusive_lease(db.engine) as acquired:
        assert acquired
        starting = threading.Thread(target=lease.acquire)
        starting.start()
        deadline = time.monotonic() + 10
        while "offline admin recovery" not in caplog.text:
            assert time.monotonic() < deadline, "no waiting message"
            time.sleep(0.05)
        assert not lease.held  # still waiting
    starting.join(timeout=10)

    assert lease.held
    assert not _alone(db.engine)
    lease.release()
