"""The consolidation browser scenario builds the spec's 8-group example
(acceptance fixes WP-E2a)."""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from browser_consolidation_scenarios import register_consolidation_scenario_route
from browser_server import ONTOLOGY, TEST_PASSWORD
from fastapi.testclient import TestClient
from pg_harness import database_url_for

from ontocurator.api.app import create_app
from ontocurator.config import AppConfig


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    app = create_app(
        AppConfig(
            workspace_dir=tmp_path,
            database_url=database_url_for(tmp_path / "editor.db"),
            ontology_paths=[ONTOLOGY],
        )
    )
    register_consolidation_scenario_route(app)
    with TestClient(app) as client:
        yield client


def build(client: TestClient, started: bool) -> dict[str, Any]:
    response = client.post(
        "/__test_consolidation__", params={"started": str(started).lower()}
    )
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    assert body["project"].startswith("documents-c1-")
    assert len(body["submissions"]) == 2
    return body


def login(client: TestClient, username: str) -> dict[str, str]:
    origin = str(client.base_url).rstrip("/")
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": TEST_PASSWORD},
        headers={"Origin": origin},
    )
    assert response.status_code == 200, response.text
    return {"Origin": origin, "X-CSRF-Token": response.json()["csrf_token"]}


def test_started_scenario_has_the_eight_designed_groups(client: TestClient) -> None:
    built = build(client, started=True)
    login(client, built["users"]["lead"])
    response = client.get(f"/api/v1/rounds/{built['round_id']}/consolidation")
    assert response.status_code == 200, response.text
    view = response.json()
    assert view["read_only"] is False and view["workspace_id"]
    groups = view["groups"]
    assert len(groups) == 8
    assert sorted(g["state"] for g in groups).count("auto") == 4
    open_kinds = sorted(g["kinds"][0] for g in groups if g["state"] == "open")
    assert open_kinds == ["partial", "span_differs", "term_differs", "values_differ"]
    open_groups = [g for g in groups if g["state"] == "open"]
    assert [g["kinds"] for g in open_groups if len(g["kinds"]) > 1] == [
        ["term_differs", "values_differ"]
    ]
    # Overlapping reflex spans and one shared span in the term group: no text decision.
    assert [g["span_conflict"] for g in open_groups] == [False] * 4
    assert all(g["term_parts"] == {} for g in open_groups)
    labels = [person["label"] for person in view["people"]]
    assert [person["lane"] for person in view["people"]] == [1, 2]
    assert all("(" in label for label in labels)


def test_unstarted_scenario_leaves_the_lead_without_the_role(
    client: TestClient,
) -> None:
    built = build(client, started=False)
    assert "round_id" not in built
    login(client, built["users"]["lead"])
    response = client.get(f"/api/v1/projects/{built['project']}/members")
    assert response.status_code == 200, response.text
    lead = next(m for m in response.json() if m["username"] == built["users"]["lead"])
    assert "adjudicator" not in lead["roles"]
