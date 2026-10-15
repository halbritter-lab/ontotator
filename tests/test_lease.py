"""The runtime lease: servers share it, the offline recovery needs it alone."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient
from pg_harness import database_for
from sqlalchemy import Engine

from ontocurator.api.app import create_app
from ontocurator.config import AppConfig
from ontocurator.storage.lease import RuntimeLease, exclusive_lease


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
