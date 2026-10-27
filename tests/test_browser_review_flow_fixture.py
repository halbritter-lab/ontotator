"""The review flow browser scenarios build what ``review-flow.spec.ts`` and
``annotation-loop.spec.ts`` expect."""

from collections.abc import Iterator
from pathlib import Path
from time import monotonic
from typing import Any
from uuid import uuid4

import pytest
from browser_review_flow_scenarios import (
    BUILDERS,
    register_review_flow_scenario_route,
)
from browser_server import ONTOLOGY, TEST_PASSWORD
from fastapi.testclient import TestClient
from pg_harness import database_url_for

from ontotator.api.app import create_app
from ontotator.config import AppConfig

# Every scenario builds well inside the browser helper's timeout.
BUILD_SECONDS = 30


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    app = create_app(
        AppConfig(
            workspace_dir=tmp_path,
            database_url=database_url_for(tmp_path / "editor.db"),
            ontology_paths=[ONTOLOGY],
        )
    )
    register_review_flow_scenario_route(app)
    # The context starts the server's job worker; scenario imports need it.
    with TestClient(app) as client:
        yield client


def scenario(client: TestClient, name: str) -> dict[str, Any]:
    started = monotonic()
    response = client.post("/__test_review_flow__", params={"scenario": name})
    elapsed = monotonic() - started
    assert response.status_code == 200, response.text
    assert elapsed < BUILD_SECONDS, f"{name} took {elapsed:.1f} s"
    body: dict[str, Any] = response.json()
    assert body["project"].startswith(f"lead-{name.lower().replace('_', '-')}-")
    assert set(body["users"]) == {"lead", "ana", "ben", "annotator"}
    return body


class Session:
    """``client`` logged in as one scenario user (CSRF header on writes)."""

    def __init__(self, client: TestClient, username: str) -> None:
        self.client = client
        self.origin = str(client.base_url).rstrip("/")
        client.cookies.clear()
        login = client.post(
            "/api/v1/auth/login",
            json={"username": username, "password": TEST_PASSWORD},
            headers={"Origin": self.origin},
        )
        assert login.status_code == 200, login.text
        self.csrf = login.json()["csrf_token"]

    def get(self, path: str) -> Any:
        response = self.client.get(path)
        assert response.status_code == 200, response.text
        return response.json()

    def post(self, path: str, body: dict[str, Any]) -> Any:
        response = self.client.post(
            path,
            json=body,
            headers={"Origin": self.origin, "X-CSRF-Token": self.csrf},
        )
        assert response.status_code == 200, response.text
        return response.json()

    def tasks(self, project: str) -> list[dict[str, Any]]:
        return [
            task
            for task in self.get("/api/v1/me/tasks")
            if task["project_key"] == project
        ]

    def open_task(self, task: dict[str, Any]) -> dict[str, Any]:
        """Start round 1 of an annotate task and open its workspace view."""
        started = self.post(
            f"/api/v1/assignments/{task['assignment_id']}/rounds",
            {
                "request_id": f"round-{uuid4().hex}",
                "expected_workflow_revision": task["workflow_revision"],
            },
        )
        opened = self.post(f"/api/v1/rounds/{started['round_id']}/open", {})
        view: dict[str, Any] = opened["view"]
        return view


def test_registry_has_two_scenarios_and_unknown_is_404(client):
    assert set(BUILDERS) == {"REVIEW_FLOW", "ANNOTATION_LOOP"}
    response = client.post("/__test_review_flow__", params={"scenario": "S99"})
    assert response.status_code == 404


def test_review_flow_two_reviews_for_ana_failed_first(client):
    built = scenario(client, "REVIEW_FLOW")
    assert set(built["assignments"]) == {"failed-translation", "second-translation"}
    assert set(built["texts"]) >= {"source", "failed-translation", "second-translation"}
    assert built["texts"]["source"].count("\n\n") == 13
    tasks = Session(client, built["users"]["ana"]).tasks(built["project"])
    assert [t["task"] for t in tasks] == ["translation_review"] * 2
    assert [(t["external_id"], t["language"]) for t in tasks] == [
        ("failed-translation", "de"),
        ("second-translation", "de"),
    ]
    assert [t["failed_check_count"] for t in tasks] == [1, 0]
    assert [t["assignment_id"] for t in tasks] == [
        built["assignments"]["failed-translation"],
        built["assignments"]["second-translation"],
    ]


def test_annotation_loop_three_annotate_tasks_defaults_and_german_names(client):
    built = scenario(client, "ANNOTATION_LOOP")
    assert set(built["assignments"]) == {"loop-en", "loop-de", "loop-fr"}
    assert built["texts"]["loop-en"] == "The patient has a seizure and hypotonia."
    session = Session(client, built["users"]["annotator"])
    tasks = {t["external_id"]: t for t in session.tasks(built["project"])}
    assert set(tasks) == {"loop-en", "loop-de", "loop-fr"}
    assert {t["task"] for t in tasks.values()} == {"annotate"}
    assert {t["language"] for t in tasks.values()} == {"en", "de", "fr"}
    assert {name: t["assignment_id"] for name, t in tasks.items()} == built[
        "assignments"
    ]

    view = session.open_task(tasks["loop-en"])
    assert view["creation_defaults"]["hpo"]["phenotype"] == {
        "assertion": "present",
        "experiencer": "patient",
        "temporality": "current",
    }

    german = session.open_task(tasks["loop-de"])
    found = session.post(
        "/api/v1/search",
        {
            "workspace_key": german["key"],
            "annotation_id": "new-ann-1",
            "layer_id": "hpo",
            "query": "Krampfanfall",
        },
    )
    assert found["candidates"][0]["term_id"] == "HP:0001250"
