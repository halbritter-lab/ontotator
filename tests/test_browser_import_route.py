"""``/__test_import__`` succeeds even when another worker claims its job first."""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import auth_harness
import pytest
from browser_server import ONTOLOGY, T1_PROJECT, register_t1_import_route
from fastapi.testclient import TestClient
from pg_harness import database_url_for

from ontotator.api.app import create_app
from ontotator.auth.audit import Actor
from ontotator.config import AppConfig
from ontotator.jobs.queue import JobQueue


@pytest.fixture
def client(tmp_path: Path, monkeypatch) -> Iterator[TestClient]:
    app = create_app(
        AppConfig(
            workspace_dir=tmp_path,
            database_url=database_url_for(tmp_path / "editor.db"),
            ontology_paths=[ONTOLOGY],
        )
    )
    grants: list[tuple[int, str, str]] = []
    app.state.test_grants = grants
    register_t1_import_route(
        app, lambda user_id, username, key: grants.append((user_id, username, key))
    )
    monkeypatch.setattr(auth_harness, "provision_assignments", lambda *args: None)
    # The context starts the server's job worker, as in the browser server.
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client


def test_import_succeeds_when_a_concurrent_worker_claims_the_job(
    client: TestClient, monkeypatch
) -> None:
    """Simulate the server worker winning the claim right after the enqueue."""
    app: Any = client.app
    app.state.accounts.create_user(
        Actor.cli(), "first-run", "First Run", pseudonym="first-run"
    )
    rival_runs: list[int] = []
    enqueue = JobQueue.enqueue

    def enqueue_then_rival_claims(self: JobQueue, *args: Any, **kwargs: Any) -> int:
        job_id = enqueue(self, *args, **kwargs)
        claimed = self.claim(job_id, "rival-worker")
        assert claimed is not None
        self.run(claimed, "rival-worker")
        rival_runs.append(job_id)
        return job_id

    monkeypatch.setattr(JobQueue, "enqueue", enqueue_then_rival_claims)

    response = client.post("/__test_import__", params={"username": "first-run"})

    assert response.status_code == 200, response.text
    assert len(rival_runs) == 1
    job = app.state.jobs.get(rival_runs[0])
    assert job.status == "succeeded"
    assert response.json() == job.result
    user = app.state.accounts.get_by_username("first-run")
    assert app.state.test_grants == [(user.id, "first-run", T1_PROJECT)]


def test_import_runs_on_the_server_worker(client: TestClient) -> None:
    app: Any = client.app
    app.state.accounts.create_user(
        Actor.cli(), "first-run", "First Run", pseudonym="first-run"
    )

    response = client.post("/__test_import__", params={"username": "first-run"})

    assert response.status_code == 200, response.text
    assert response.json()["units"] == 1
