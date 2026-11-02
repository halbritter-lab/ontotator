"""Two simultaneous opens of the same task (issue 272)."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier

import pytest
from auth_harness import add_ontology, ensure_user, grant, logged_in
from fastapi import FastAPI
from fastapi.testclient import TestClient
from t1_fixtures import HP_PATH, create_project
from test_auth_api import _app

REAL = "real"


@pytest.fixture
def app(tmp_path: Path) -> FastAPI:
    app = _app(tmp_path)
    add_ontology(app, HP_PATH)
    create_project(app.state.repo.db, REAL)
    return app


@pytest.mark.parametrize("kind", ["scratch", "proposals", "consolidation"])
def test_two_simultaneous_opens_open_the_task_once(app: FastAPI, kind: str) -> None:
    ensure_user(app, "ann")
    assert grant(app, "ann", REAL, ["annotator", "adjudicator"])
    first = logged_in(app, "ann")
    project = first.post("/api/v1/me/practice").json()["project"]
    task = next(t for t in project["tasks"] if t["kind"] == kind)
    second = logged_in(app, "ann")
    url = f"/api/v1/assignments/{task['assignment_id']}/open"
    barrier = Barrier(2)

    def opened(client: TestClient):  # type: ignore[no-untyped-def]
        barrier.wait()
        return client.post(url)

    with ThreadPoolExecutor(2) as pool:
        responses = list(pool.map(opened, [first, second]))
    assert [r.status_code for r in responses] == [200, 200], [r.text for r in responses]
    assert responses[0].json()["workspace_id"] == responses[1].json()["workspace_id"]
