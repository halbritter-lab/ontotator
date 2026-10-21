"""The Documents browser scenarios S11, S13, S14, S15 and S16 build what the
specs expect."""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from browser_documents_scenarios import register_documents_scenario_route, registry
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
    register_documents_scenario_route(app)
    # The context starts the server's job worker; scenario imports need it.
    with TestClient(app) as client:
        yield client


def scenario(client: TestClient, name: str) -> dict[str, Any]:
    response = client.post("/__test_documents__", params={"scenario": name})
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    assert body["project"].startswith(f"documents-{name.lower()}-")
    assert body["users"]["lead"] and body["rows"]
    return body


class Lead:
    """A signed-in lead session of the scenario (signed out on exit)."""

    def __init__(self, client: TestClient, built: dict[str, Any]) -> None:
        self.client = client
        self.base = f"/api/v1/projects/{built['project']}"
        self.username = built["users"]["lead"]
        self.origin = str(client.base_url).rstrip("/")

    def __enter__(self) -> "Lead":
        login = self.client.post(
            "/api/v1/auth/login",
            json={"username": self.username, "password": TEST_PASSWORD},
            headers={"Origin": self.origin},
        )
        assert login.status_code == 200, login.text
        self.headers = {
            "Origin": self.origin,
            "X-CSRF-Token": login.json()["csrf_token"],
        }
        return self

    def __exit__(self, *_exc: object) -> None:
        self.client.post("/api/v1/auth/logout", headers=self.headers)
        self.client.cookies.clear()

    def page(self, **query: Any) -> dict[str, Any]:
        response = self.client.get(f"{self.base}/document-rows", params=query)
        assert response.status_code == 200, response.text
        body: dict[str, Any] = response.json()
        return body

    def submissions(self, case_id: str, language: str) -> dict[str, Any]:
        response = self.client.get(
            f"{self.base}/document-rows/{case_id}/{language}/submissions"
        )
        assert response.status_code == 200, response.text
        body: dict[str, Any] = response.json()
        return body


def rows_of(page: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    return {
        (row["case_id"], row["language"]): row
        for group in page["groups"]
        for row in group["rows"]
    }


def codes(items: list[dict[str, Any]]) -> list[str]:
    return [item["code"] for item in items]


def test_registry_has_this_wp_scenarios():
    assert {"S11", "S13", "S14", "S15", "S16"} <= registry().keys()


def test_s11_revised_round_and_newer_result(client):
    built = scenario(client, "S11")
    subs = built["submissions"]
    with Lead(client, built) as lead:
        en = rows_of(lead.page())[("case-0611", "en")]
        history = lead.submissions("case-0611", "en")
    assert en["final"]["submission_id"] == subs["selected"]
    issues = {item["cause_id"]: item for item in en["issues"]}
    assert set(issues) == {
        f"SELECTED_RESULT_REVISED:{subs['revised']}",
        f"SELECTED_NEWER_RESULT:{subs['newer']}",
    }
    assert all(item["category"] == "confirm-final" for item in issues.values())
    assert en["categories"] == ["confirm-final"]
    by_id = {item["submission_id"]: item for item in history["submissions"]}
    assert set(by_id) == set(subs.values())
    selected, revised = by_id[subs["selected"]], by_id[subs["revised"]]
    assert selected["round_id"] == revised["round_id"] == built["rounds"]["round1"]
    assert selected["round_ordinal"] == revised["round_ordinal"] == 1
    # "· earlier submission" and "· latest" in the Submissions table.
    assert selected["is_latest_in_round"] is False
    assert revised["is_latest_in_round"] is True
    assert by_id[subs["newer"]]["round_id"] != built["rounds"]["round1"]


def test_s13_carry_forward_and_consolidation_kinds(client):
    built = scenario(client, "S13")
    subs = built["submissions"]
    with Lead(client, built) as lead:
        history = lead.submissions("case-0713", "en")
    kinds = {item["submission_id"]: item["kind"] for item in history["submissions"]}
    assert kinds == {
        subs["inputs"][0]: "annotation",
        subs["inputs"][1]: "annotation",
        subs["consolidation"]: "consolidation",
        subs["carry_forward"]: "carry_forward",
    }
    rounds = {item["round_id"]: item for item in history["rounds"]}
    assert rounds[built["rounds"]["consolidation"]]["kind"] == "consolidation"
    assert rounds[built["rounds"]["carry_forward"]]["kind"] == "carry_forward"
    versions = {
        item["submission_id"]: item["version"] for item in history["submissions"]
    }
    assert versions[subs["carry_forward"]] == 2
    assert versions[subs["consolidation"]] == 1


def test_s14_waiting_line_and_early_selection_with_open_work(client):
    built = scenario(client, "S14")
    with Lead(client, built) as lead:
        rows = rows_of(lead.page())
        de_history = lead.submissions("case-0814", "de")
    de = rows[("case-0814", "de")]
    assert de["final"]["submission_id"] == built["submissions"]["de"]
    (waiting,) = [n for n in de["notes"] if n["code"] == "ROUND_REVIEW_PENDING"]
    assert waiting["document_id"] == built["documents"]["de"]
    assert de["issues"] == [] and de["categories"] == []
    (review,) = de_history["open_translation_reviews"]
    assert review["assignment_id"] == built["open_review_assignment_id"]
    en = rows[("case-0814", "en")]
    assert en["final"]["submission_id"] == built["submissions"]["en"]
    assert en["issues"] == [] and en["categories"] == []
    # "Still open: …" in the confirmation comes from the open work.
    open_work = [w for w in en["work"] if w["status"] != "submitted"]
    assert [w["assignment_id"] for w in open_work] == [built["open_assignment_id"]]


def test_s15_own_result_not_selectable_and_paging(client):
    built = scenario(client, "S15")
    subs = built["submissions"]
    with Lead(client, built) as lead:
        first = lead.page()
        second = lead.page(page=2)
        history = lead.submissions(built["case_id"], "en")
        own = client.put(
            f"{lead.base}/final-selections",
            json={
                "document_id": built["documents"]["en"],
                "submission_id": subs["own"],
                "expected_revision": 0,
            },
            headers=lead.headers,
        )
    assert first["adjudicator_not_annotator"] is True
    assert first["group_count"] == built["text_count"] == 55
    assert first["page_count"] == 2 and len(first["groups"]) == 50
    assert second["page"] == 2 and len(second["groups"]) == 5
    row = rows_of(first)[(built["case_id"], "en")]
    assert row["final"] is None and "missing-final" in row["categories"]
    assert history["adjudicator_not_annotator"] is True
    mine = {item["submission_id"]: item["is_me"] for item in history["submissions"]}
    assert mine == {subs["own"]: True, subs["other"]: False}
    assert own.status_code == 409, own.text
    assert own.json()["code"] == "OWN_RESULT_NOT_SELECTABLE"


def test_s16_full_agreement_and_consolidation_without_adjudicator(client):
    built = scenario(client, "S16")
    with Lead(client, built) as lead:
        page = rows_of(lead.page())
        members = client.get(f"{lead.base}/members").json()
        match = client.get(
            f"{lead.base}/document-rows/{built['case_id']}/en/final-panel"
        )
        still_open = client.get(
            f"{lead.base}/document-rows/{built['open_case_id']}/en/final-panel"
        )
    assert not any("adjudicator" in member["roles"] for member in members)
    matched = page[(built["case_id"], "en")]
    assert matched["next_step"]["action"] == "choose_final"
    assert match.status_code == 200, match.text
    panel = match.json()
    assert panel["all_match"] is True
    assert panel["all_match_submission_id"] == built["submissions"]["match"][0]
    assert all(item["eligible"] for item in panel["submissions"])
    open_row = page[(built["open_case_id"], "en")]
    actions = [step["action"] for step in open_row["steps"]]
    assert "choose_final" not in actions
    assert still_open.status_code == 200, still_open.text
    eligible = [item for item in still_open.json()["submissions"] if item["eligible"]]
    assert len(eligible) == 2
