"""Public, bounded health probes and shutdown draining."""

import socket
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import pytest
from alembic import command
from fastapi import FastAPI
from fastapi.testclient import TestClient
from layered_fixtures import make_layered_package
from pg_harness import database_for, database_url_for, unmigrated_database_url
from sqlalchemy import create_engine, event, insert, select
from t1_fixtures import HP_PATH, HP_SHA, create_project

from ontotator.api.app import create_app
from ontotator.config import AppConfig
from ontotator.jobs.queue import Worker
from ontotator.storage.database import Database
from ontotator.storage.schema import alembic_config
from ontotator.storage.tables import (
    OntologyFileRow,
    ProjectOntologyRow,
    ProjectRow,
    StoredFileRow,
)


@pytest.fixture
def app(tmp_path: Path) -> FastAPI:
    result = create_app(AppConfig(workspace_dir=tmp_path))
    assert result.state.ontologies_ready.wait(10)
    return result


def test_livez_answers_without_a_session(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.get("/livez")
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert "set-cookie" not in response.headers
    assert client.get("/api/v1/ontologies").status_code == 401


def test_readyz_is_ready_with_database_schema_and_ontologies(app: FastAPI) -> None:
    response = TestClient(app).get("/readyz")
    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "checks": {"database": True, "schema": True, "ontologies": True},
    }


def test_readyz_fails_while_ontologies_load(app: FastAPI) -> None:
    app.state.ontologies_ready.clear()
    response = TestClient(app).get("/readyz")
    assert response.status_code == 503
    assert response.json() == {
        "ok": False,
        "checks": {"database": True, "schema": True, "ontologies": False},
    }


@pytest.mark.parametrize("blob", ["valid", "missing", "corrupt"])
def test_startup_readiness_requires_usable_persisted_pin(
    tmp_path: Path, blob: str
) -> None:
    db = database_for(tmp_path / "editor.db", data_dir=tmp_path)
    create_project(db)
    path = db.blobs.path(HP_SHA)
    if blob == "missing":
        path.unlink()
    elif blob == "corrupt":
        path.write_bytes(b"changed bytes")
    application = create_app(AppConfig(workspace_dir=tmp_path))
    assert application.state.ontologies_ready.wait(10)
    with TestClient(application) as client:
        assert client.get("/livez").status_code == 200
        response = client.get("/readyz")
        assert response.status_code == (200 if blob == "valid" else 503)
        assert response.json() == {
            "ok": blob == "valid",
            "checks": {
                "database": True,
                "schema": True,
                "ontologies": blob == "valid",
            },
        }
        if blob != "valid":
            path.write_bytes(HP_PATH.read_bytes())
            time.sleep(1.05)
            assert client.get("/readyz").status_code == 200


@pytest.mark.parametrize("initially_missing", [False, True])
def test_readiness_loads_cli_hot_added_pin_and_recovers(
    app: FastAPI, initially_missing: bool
) -> None:
    from ontotator.ontology.service import OntologyService

    # A CLI process has a separate registry; it does not warm this worker.
    create_project(app.state.repo.db)
    path = app.state.repo.db.blobs.path(HP_SHA)
    if initially_missing:
        path.unlink()
    registry = app.state.ontology_registry
    assert registry.services() == []
    with TestClient(app) as client:
        assert client.get("/readyz").status_code == (503 if initially_missing else 200)
        if initially_missing:
            path.write_bytes(HP_PATH.read_bytes())
            time.sleep(1.05)
            assert client.get("/readyz").status_code == 200
        assert [sha for sha, _ in registry.services()] == [HP_SHA]
        # Readiness uses the loaded object, never rehashes or rebuilds it.
        with patch.object(
            OntologyService, "load", side_effect=AssertionError("reload")
        ):
            time.sleep(1.05)
            assert client.get("/readyz").status_code == 200


def test_cold_pin_load_releases_health_connection_and_shares_deadline(
    app: FastAPI,
) -> None:
    from ontotator.api import health
    from ontotator.ontology.service import OntologyService

    create_project(app.state.repo.db)
    started = threading.Event()
    release = threading.Event()
    active_connections: list[object] = []
    original_load = OntologyService.load

    def health_engine(*args, **kwargs):  # type: ignore[no-untyped-def]
        engine = create_engine(*args, **kwargs)
        event.listen(
            engine, "checkout", lambda *args: active_connections.append(object())
        )
        event.listen(engine, "checkin", lambda *args: active_connections.pop())
        return engine

    def slow_load(*args, **kwargs):  # type: ignore[no-untyped-def]
        assert not active_connections
        started.set()
        assert release.wait(10)
        return original_load(*args, **kwargs)

    with (
        patch.object(health, "create_engine", side_effect=health_engine),
        patch.object(OntologyService, "load", side_effect=slow_load) as load,
        TestClient(app) as client,
        ThreadPoolExecutor(max_workers=1) as requests,
    ):
        first = requests.submit(client.get, "/readyz")
        try:
            assert started.wait(5)
            assert client.get("/livez").status_code == 200
            assert first.result(timeout=3).status_code == 503
            assert client.get("/readyz").status_code == 503
            assert load.call_count == 1
        finally:
            release.set()
        deadline = time.monotonic() + 5
        while client.get("/readyz").status_code != 200:
            assert time.monotonic() < deadline
            time.sleep(0.05)
        assert load.call_count == 1


@pytest.mark.parametrize("pinned", [True, False])
def test_only_pinned_ontology_failures_block_readiness(
    app: FastAPI, tmp_path: Path, pinned: bool
) -> None:
    app.state.repo.import_package(make_layered_package("single"))
    broken = b'{"graphs": [{"id": "x", "nodes": "not a list"}]}'
    path = tmp_path / "x.json"
    path.write_bytes(broken)
    registry = app.state.ontology_registry
    sha = registry.register_path(path)
    registry.preload([sha])
    assert [failure.sha256 for failure in registry.failures()] == [sha]
    if pinned:
        with app.state.repo.db.transaction() as conn:
            conn.execute(insert(StoredFileRow).values(sha256=sha, size=len(broken)))
            conn.execute(
                insert(OntologyFileRow).values(
                    sha256=sha, kind="ontology", prefix="x", filename="x.json"
                )
            )
            project_id = conn.execute(select(ProjectRow.id)).scalar_one()
            conn.execute(
                insert(ProjectOntologyRow).values(
                    project_id=project_id, ontology_id="x", sha256=sha
                )
            )
    response = TestClient(app).get("/readyz")
    assert response.status_code == (503 if pinned else 200)
    assert response.json()["checks"]["ontologies"] is (not pinned)


def _upgrade_to_0001(url: str) -> None:
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            command.upgrade(alembic_config(conn), "0001")
    finally:
        engine.dispose()


def test_readyz_fails_with_pending_migrations(app: FastAPI, tmp_path: Path) -> None:
    url = unmigrated_database_url(tmp_path / "pending")
    _upgrade_to_0001(url)
    app.state.repo.db = Database(url, data_dir=tmp_path)
    response = TestClient(app).get("/readyz")
    assert response.status_code == 503
    assert response.json()["checks"]["database"] is True
    assert response.json()["checks"]["schema"] is False


def test_readyz_fails_without_a_database(app: FastAPI, tmp_path: Path) -> None:
    with socket.socket() as closed_port:
        closed_port.bind(("127.0.0.1", 0))
        port = closed_port.getsockname()[1]
    url = app.state.repo.db.url.set(host="127.0.0.1", port=port)
    app.state.repo.db = Database(url, data_dir=tmp_path)
    started = time.monotonic()
    response = TestClient(app).get("/readyz")
    assert time.monotonic() - started < 3
    assert response.status_code == 503
    assert response.json()["checks"]["database"] is False
    assert "password" not in response.text


def test_readyz_is_cached(app: FastAPI) -> None:
    from ontotator.api import health

    with (
        patch.object(health, "check_readiness", wraps=health.check_readiness) as spy,
        TestClient(app) as client,
    ):
        assert client.get("/readyz").status_code == 200
        app.state.ontologies_ready.clear()
        assert client.get("/readyz").status_code == 200
        assert spy.call_count == 1
        time.sleep(1.05)
        assert client.get("/readyz").status_code == 503
        assert spy.call_count == 2


def test_concurrent_probes_share_one_evaluation(app: FastAPI) -> None:
    from ontotator.api import health

    original = health.check_readiness
    started = threading.Event()
    release = threading.Event()

    def blocked_check(application: FastAPI) -> dict[str, bool]:
        started.set()
        assert release.wait(5)
        return original(application)

    with (
        patch.object(health, "check_readiness", side_effect=blocked_check) as spy,
        TestClient(app) as client,
        ThreadPoolExecutor(max_workers=8) as requests,
    ):
        first = requests.submit(client.get, "/readyz")
        assert started.wait(5)
        others = [requests.submit(client.get, "/readyz") for _ in range(7)]
        time.sleep(0.1)
        release.set()
        assert all(result.result().status_code == 200 for result in [first, *others])
        assert spy.call_count == 1


def test_slow_readiness_is_bounded_cached_and_does_not_block_liveness(
    app: FastAPI,
) -> None:
    from ontotator.api import health

    original = health.check_readiness
    started = threading.Event()
    release = threading.Event()

    def blocked_check(application: FastAPI) -> dict[str, bool]:
        started.set()
        assert release.wait(10)
        return original(application)

    with (
        patch.object(health, "check_readiness", side_effect=blocked_check) as spy,
        TestClient(app) as client,
        ThreadPoolExecutor(max_workers=1) as requests,
    ):
        first = requests.submit(client.get, "/readyz")
        assert started.wait(5)
        try:
            before = time.monotonic()
            assert client.get("/livez").status_code == 200
            assert time.monotonic() - before < 0.5
            assert first.result(timeout=3).status_code == 503
            before = time.monotonic()
            assert client.get("/readyz").status_code == 503
            assert time.monotonic() - before < 0.5
            assert spy.call_count == 1
        finally:
            release.set()


def test_shutdown_marks_draining_before_stopping_worker(app: FastAPI) -> None:
    observed = []
    original = Worker.stop

    def stop(worker: Worker, timeout: float = 30.0) -> None:
        observed.append(getattr(app.state, "draining", False))
        original(worker, timeout)

    with patch.object(Worker, "stop", stop), TestClient(app) as client:
        assert client.get("/livez").status_code == 200
    assert observed == [True]
    response = TestClient(app).get("/livez")
    assert response.status_code == 503
    assert response.json() == {"ok": False}


def test_probes_precede_static_mount(tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("Static UI", encoding="utf-8")
    app = create_app(AppConfig(workspace_dir=tmp_path, web_dir=tmp_path))
    assert TestClient(app).get("/livez").status_code == 200


def test_probes_preserve_trusted_host_checks(tmp_path: Path) -> None:
    app = create_app(
        AppConfig(
            workspace_dir=tmp_path,
            database_url=database_url_for(tmp_path / "host"),
            trusted_hosts=("allowed.example",),
        )
    )
    assert TestClient(app).get("/livez").status_code == 400
