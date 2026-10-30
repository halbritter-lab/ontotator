"""The carried-review browser scenarios (editor plan F10) build what the specs expect."""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from browser_carry_fixture import SCENARIOS, register_carry_forward_scenario_route
from browser_server import ONTOLOGY, TEST_PASSWORD
from fastapi.testclient import TestClient
from pg_harness import database_url_for

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
    register_carry_forward_scenario_route(app)
    # The context starts the server's job worker; scenario imports need it.
    with TestClient(app) as client:
        yield client


def scenario(client: TestClient, name: str) -> dict[str, Any]:
    response = client.post("/__test_carry_forward__", params={"scenario": name})
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    assert body["project"].startswith(f"carry-{name}-")
    assert body["password"] == TEST_PASSWORD
    return body


def login(client: TestClient, built: dict[str, Any]) -> None:
    client.cookies.clear()
    response = client.post(
        "/api/v1/auth/login",
        json={"username": built["username"], "password": built["password"]},
        headers={"Origin": str(client.base_url).rstrip("/")},
    )
    assert response.status_code == 200, response.text


def get(client: TestClient, path: str) -> Any:
    response = client.get(path)
    assert response.status_code == 200, response.text
    return response.json()


def test_unknown_scenario_is_404(client):
    assert set(SCENARIOS) == {"t5", "t5span", "corrected", "rounds3"}
    response = client.post("/__test_carry_forward__", params={"scenario": "nope"})
    assert response.status_code == 404


def test_t5_carries_one_spanless_seizure_and_adds_one_finding(client):
    built = scenario(client, "t5")
    login(client, built)
    rounds = get(client, f"/api/v1/assignments/{built['assignment_id']}/rounds")
    by_id = {r["round_id"]: r for r in rounds}
    second = by_id[built["rounds"]["round2"]]
    assert second["kind"] == "carry_forward" and second["state"] == "editable"
    assert by_id[built["rounds"]["round1"]]["state"] == "superseded"
    inputs = get(client, f"/api/v1/rounds/{second['round_id']}/inputs")
    assert len(inputs) == 1
    carried = inputs[0]
    assert carried["mapping_status"] == "carried"
    source = carried["source_snapshot"]["annotation"]
    assert source["term_id"] == "HP:0001250"
    assert source["evidence_refs"] == []
    assert source["note"] == built["note"]
    assert not source.get("axes_defaulted")
    assert carried["source_round_ordinal"] == 1
    opened = client.post(
        f"/api/v1/rounds/{second['round_id']}/open",
        headers={
            "Origin": str(client.base_url).rstrip("/"),
            "X-CSRF-Token": client.get("/api/v1/auth/me").json()["csrf_token"],
        },
    )
    assert opened.status_code == 200, opened.text
    draft = opened.json()["view"]["draft"]
    ids = {s["annotation"]["annotation_id"]: s for s in draft["annotations"]}
    assert set(ids) == {built["carried_annotation_id"], built["added_annotation_id"]}
    assert not draft.get("round_input_resolutions")
    added = ids[built["added_annotation_id"]]["annotation"]
    assert added["term_id"] == "HP:0001252" and len(added["evidence_refs"]) == 1
    # #157: the carried spanless finding keeps its reason in its own note.
    assert ids[built["carried_annotation_id"]]["annotation"]["note"] == built["note"]


def test_corrected_input_needs_review_with_a_stored_reason(client):
    built = scenario(client, "corrected")
    login(client, built)
    rounds = get(client, f"/api/v1/assignments/{built['assignment_id']}/rounds")
    assert [r["kind"] for r in rounds] == ["carry_forward"]
    inputs = get(client, f"/api/v1/rounds/{rounds[0]['round_id']}/inputs")
    assert len(inputs) == 1
    assert inputs[0]["mapping_status"] == "needs_review"
    assert inputs[0]["target_snapshot"] is None
    assert inputs[0]["review_reason"] == built["review_reason"]
    assert inputs[0]["source_version"] == 1
    old_span = built["old_text"].index("Krampfanfälle")
    assert old_span > 0 and "Krampfanfälle" not in built["text"]
    start, end = built["recreate_span"]["start"], built["recreate_span"]["end"]
    assert built["text"][start:end] == "epileptische Anfälle"


def test_rounds3_has_two_submitted_rounds_and_an_open_third(client):
    built = scenario(client, "rounds3")
    login(client, built)
    rounds = get(client, f"/api/v1/assignments/{built['assignment_id']}/rounds")
    by_id = {r["round_id"]: r for r in rounds}
    first, second, third = (
        by_id[built["rounds"][n]] for n in ("round1", "round2", "round3")
    )
    assert [
        first["round_ordinal"],
        second["round_ordinal"],
        third["round_ordinal"],
    ] == [1, 2, 3]
    assert first["state"] == "superseded" and first["submission_count"] == 1
    assert second["state"] == "superseded" and second["submission_count"] == 1
    assert third["state"] == "editable" and third["kind"] == "carry_forward"
    assert third["source_round_ordinal"] == 2
    mine = get(client, f"/api/v1/assignments/{built['assignment_id']}/submissions")
    assert sorted(row["round_ordinal"] for row in mine) == [1, 2]
    assert {row["submission_id"] for row in mine} == set(built["submissions"].values())
