"""The proposal-check browser scenarios build fresh projects with tool
proposals and real "Annotate from proposals" work (plan T1)."""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from browser_proposal_check_scenarios import register_proposal_check_scenario_route
from browser_server import ONTOLOGY
from fastapi.testclient import TestClient
from pg_harness import database_url_for
from test_browser_consolidation_fixture import login

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
    register_proposal_check_scenario_route(app)
    with TestClient(app) as client:
        yield client


def build(client: TestClient, scenario: str) -> dict[str, Any]:
    response = client.post("/__test_proposal_check__", params={"scenario": scenario})
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    assert body["project"].startswith("lead-proposal-check-")
    assert {"lead", "tom", "mia", "ali"} <= set(body["users"])
    assert body["display_names"]["tom"] == "Tom Reis"
    login(client, body["users"]["lead"])
    return body


def rows(client: TestClient, project: str) -> dict[str, dict[str, Any]]:
    response = client.get(f"/api/v1/projects/{project}/document-rows")
    assert response.status_code == 200, response.text
    return {
        r["case_id"]: r
        for g in response.json()["groups"]
        for r in g["rows"]
        if r["language"] == "en"
    }


def test_fresh_has_proposals_and_modes(client: TestClient) -> None:
    built = build(client, "FRESH")
    assert set(built["cases"]) == {"EN100024", "EN100017", "EN100031"}
    found = rows(client, built["project"])
    assert found["EN100024"]["proposal_count"] == 3
    assert found["EN100024"]["annotation_mode"]["mode"] == "proposals"
    assert found["EN100024"]["annotation_mode"]["source"] == "project"
    assert found["EN100017"]["proposal_count"] == 0
    assert found["EN100017"]["annotation_mode"]["source"] == "no_proposals"
    assert found["EN100031"]["proposal_count"] == 3
    assert found["EN100031"]["annotation_mode"]["override"] == "scratch"
    assert found["EN100031"]["annotation_mode"]["mode"] == "scratch"
    assert all(not r["work"] for r in found.values())


def test_one_assigned_is_from_proposals_and_not_started(client: TestClient) -> None:
    built = build(client, "ONE_ASSIGNED")
    work = [
        w
        for w in rows(client, built["project"])["EN100024"]["work"]
        if w["task"] == "annotate"
    ]
    assert len(work) == 1
    assert work[0]["annotation_mode"] == "proposals"
    assert work[0]["assignment_id"] == built["assignments"]["tom"]


def test_checked_has_two_proposal_check_submissions(client: TestClient) -> None:
    built = build(client, "CHECKED")
    project = built["project"]
    response = client.get(
        f"/api/v1/projects/{project}/document-rows/EN100024/en/submissions"
    )
    assert response.status_code == 200, response.text
    kinds = [s["kind"] for s in response.json()["submissions"]]
    assert kinds == ["proposal_check", "proposal_check"]
    assert set(built["submissions"]) == {"tom", "mia"}
    row = rows(client, project)["EN100024"]
    assert row["stages"]["final"]["state"] == "choose"


def test_consolidating_has_an_open_round(client: TestClient) -> None:
    built = build(client, "CONSOLIDATING")
    response = client.get(f"/api/v1/rounds/{built['round_id']}/consolidation")
    assert response.status_code == 200, response.text
    view = response.json()
    assert view["read_only"] is False
    # Nothing resolved yet: Tom's reject and correction leave open groups.
    assert any(g["state"] == "open" for g in view["groups"])


def test_unknown_scenario_is_404(client: TestClient) -> None:
    response = client.post("/__test_proposal_check__", params={"scenario": "NOPE"})
    assert response.status_code == 404
