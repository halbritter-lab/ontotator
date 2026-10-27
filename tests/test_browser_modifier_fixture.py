"""The modifier browser scenario builds what the modifier editor tests expect."""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from browser_modifier_scenarios import TEXT, register_modifier_scenario_route
from browser_server import ONTOLOGY
from fastapi.testclient import TestClient
from modifier_fixtures import MOD_PIN
from pg_harness import database_url_for
from test_browser_review_flow_fixture import Session

from ontotator.api.app import create_app
from ontotator.config import AppConfig


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    app = create_app(
        AppConfig(
            workspace_dir=tmp_path,
            database_url=database_url_for(tmp_path / "editor.db"),
            ontology_paths=[ONTOLOGY],
        )
    )
    register_modifier_scenario_route(app)
    with TestClient(app) as client:
        yield client


def build(client: TestClient, **params: int) -> tuple[dict[str, Any], dict[str, Any]]:
    """The scenario and the annotator's opened workspace view."""
    response = client.post("/__test_modifiers__", params=params)
    assert response.status_code == 200, response.text
    built: dict[str, Any] = response.json()
    assert set(built["users"]) == {"lead", "ana", "ben", "annotator"}
    session = Session(client, built["users"]["annotator"])
    tasks = session.tasks(built["project"])
    assert [t["task"] for t in tasks] == ["annotate"]
    opened = session.post(f"/api/v1/rounds/{built['round_id']}/open", {})
    return built, opened["view"]


def findings(view: dict[str, Any]) -> dict[str, tuple[str, str]]:
    """Annotation id -> (term, mention text by code points)."""
    out = {}
    for snap in view["draft"]["annotations"]:
        segment = snap["evidence"][0]["mention"]["segments"][0]
        text = "".join(list(TEXT)[segment["start"] : segment["end"]])
        out[snap["annotation"]["annotation_id"]] = (snap["annotation"]["term_id"], text)
    return out


def test_plain_scenario(client: TestClient) -> None:
    built, view = build(client)
    repo = client.app.state.repo  # type: ignore[attr-defined]
    assert repo.project_pins(built["project"]) == {"hp": MOD_PIN}
    assert built["texts"] == {"modifiers": TEXT}
    assert view["document"]["text"] == TEXT
    assert view["draft"]["annotations"] == []
    prefs = client.get("/api/v1/preferences").json()
    assert prefs["search_languages_by_annotator"] == {
        view["key"]["annotator_id"]: ["de"]
    }


def test_with_finding(client: TestClient) -> None:
    _, view = build(client, with_finding=1)
    assert findings(view) == {"seizure": ("HP:0001250", "Krampfanfälle")}


def test_standalone(client: TestClient) -> None:
    _, view = build(client, standalone=1)
    assert findings(view) == {"standalone-severe": ("HP:0012828", "schwere")}
