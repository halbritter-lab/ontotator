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


def test_three_people_hypotonia_group(client: TestClient) -> None:
    response = client.post(
        "/__test_consolidation__", params={"started": "true", "people": 3}
    )
    assert response.status_code == 200, response.text
    built = response.json()
    assert len(built["submissions"]) == 3
    login(client, built["users"]["lead"])
    view = client.get(f"/api/v1/rounds/{built['round_id']}/consolidation").json()
    assert [person["lane"] for person in view["people"]] == [1, 2, 3]
    hypotonia = next(
        g
        for g in view["groups"]
        for m in g["members"]
        if m["term_id"] == "HP:0001252" and m["axes"]["assertion"] == "absent"
    )
    assert hypotonia["state"] == "open"
    assert "term_differs" in hypotonia["kinds"]
    assert "assertion" in hypotonia["differing_axes"]
    assert len(hypotonia["members"]) == 3
    assert len({m["person_id"] for m in hypotonia["members"]}) == 3


def test_modifiers_scenario_has_the_designed_kinds(client: TestClient) -> None:
    response = client.post(
        "/__test_consolidation__", params={"started": "true", "scenario": "modifiers"}
    )
    assert response.status_code == 200, response.text
    built = response.json()
    assert len(built["submissions"]) == 2
    login(client, built["users"]["lead"])
    view = client.get(f"/api/v1/rounds/{built['round_id']}/consolidation").json()
    assert view["modifier_layer_ids"] == ["hpo"]
    kinds = {
        g["members"][0]["term_id"]: (g["kinds"], g["state"]) for g in view["groups"]
    }
    assert kinds == {
        "HP:0007359": (["modifiers_differ"], "open"),  # S4
        "HP:0001250": (["modifiers_differ"], "open"),  # S9
        "HP:0001252": (["modifiers_differ"], "open"),  # S9
        "HP:0000407": (["match"], "auto"),  # S1
        "HP:0001284": (["partial"], "open"),  # S13
    }
    focal = next(
        g for g in view["groups"] if g["members"][0]["term_id"] == "HP:0007359"
    )
    assert [m["term_label"] for g in [focal] for m in g["members"][0]["modifiers"]] == [
        "Recurrent"
    ]
    # Modifiers is the only conflicting row of S4.
    assert focal["differing_axes"] == [] and focal["span_conflict"] is False
