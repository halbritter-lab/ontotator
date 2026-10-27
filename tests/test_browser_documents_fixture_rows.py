"""The Documents browser scenarios S6, S7, S9, S10 and S12 build what the specs
expect."""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from browser_documents_scenarios import register_documents_scenario_route, registry
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


def lead_pages(
    client: TestClient, built: dict[str, Any], *queries: dict[str, Any]
) -> list[dict[str, Any]]:
    """Documents pages of the scenario as its lead, one per query."""
    origin = str(client.base_url).rstrip("/")
    login = client.post(
        "/api/v1/auth/login",
        json={"username": built["users"]["lead"], "password": TEST_PASSWORD},
        headers={"Origin": origin},
    )
    assert login.status_code == 200, login.text
    pages = []
    for query in queries or ({},):
        page = client.get(
            f"/api/v1/projects/{built['project']}/document-rows", params=query
        )
        assert page.status_code == 200, page.text
        pages.append(page.json())
    client.post(
        "/api/v1/auth/logout",
        headers={"Origin": origin, "X-CSRF-Token": login.json()["csrf_token"]},
    )
    client.cookies.clear()
    return pages


def rows_of(page: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    return {
        (row["case_id"], row["language"]): row
        for group in page["groups"]
        for row in group["rows"]
    }


def codes(items: list[dict[str, Any]]) -> list[str]:
    return [item["code"] for item in items]


def test_registry_has_this_wp_scenarios():
    assert {"S6", "S7", "S9", "S10", "S12"} <= registry().keys()


def test_s6_open_report_with_paused_task(client):
    built = scenario(client, "S6")
    (page,) = lead_pages(client, built)
    rows = rows_of(page)
    assert set(rows) == {(row["case_id"], row["language"]) for row in built["rows"]}
    de = rows[("case-0390", "de")]
    assert de["categories"] == ["report-or-pause"]
    (item,) = [i for i in de["issues"] if i["code"] == "OPEN_PROBLEM_REPORT"]
    assert item["category"] == "report-or-pause"
    assert item["report_id"] == built["report_id"]
    report = item["report"]
    assert report["report_id"] == built["report_id"]
    assert report["task_state"] == "paused"
    assert report["excerpt"] and built["reason"].startswith(report["excerpt"])
    assert report["reporter_label"]
    (work,) = de["work"]
    assert work["assignment_id"] == built["assignment_id"] and work["held"] is True
    assert page["bar"]["report_or_pause"] == 1
    assert rows[("case-0390", "en")]["categories"] == []


def test_s7_three_hundred_texts_on_six_pages_three_with_issues(client):
    built = scenario(client, "S7")
    first, last, translation = lead_pages(
        client, built, {}, {"page": 6}, {"decision": "translation"}
    )
    assert first["group_count"] == built["text_count"] == 300
    assert first["page_count"] == 6 and first["page"] == 1
    assert len(first["groups"]) == 50
    assert last["page"] == 6 and len(last["groups"]) == 50
    assert first["bar"]["translation"] == 3 and first["bar"]["total"] == 3
    issue_groups = {group["case_id"] for group in translation["groups"]}
    assert issue_groups == set(built["issue_cases"])
    assert all(group["has_issue"] for group in translation["groups"])
    for page in (first, last):
        for group in page["groups"]:
            assert group["has_issue"] is (group["case_id"] in built["issue_cases"])
    for case in built["issue_cases"]:
        de = rows_of(translation)[(case, "de")]
        assert "TRANSLATION_CHECK_FAILED" in codes(de["issues"])


def test_s9_equal_provider_names_get_the_external_id(client):
    built = scenario(client, "S9")
    (page,) = lead_pages(client, built)
    fr = rows_of(page)[("case-0420", "fr")]
    assert fr["parallel_roots"] is True
    names = {v["chain_id"]: v["chain_name"] for v in fr["versions"]}
    assert names == {
        built["documents"]["a"]: built["chain_names"]["a"],
        built["documents"]["b"]: built["chain_names"]["b"],
    }


def test_s10_rejected_and_queried_reviews_and_accepted_corrected(client):
    built = scenario(client, "S10")
    (page,) = lead_pages(client, built)
    de = rows_of(page)[("case-0444", "de")]
    docs = built["documents"]
    assert de["final"]["submission_id"] == built["submissions"]["selected"]
    assert de["final"]["document_id"] == docs["a1"]
    # Translation issues only for the rejected and queried newest versions.
    translation = {
        item["document_id"]: item["review_decision"]
        for item in de["issues"]
        if item["code"] == "TRANSLATION_NOT_ACCEPTED"
    }
    assert translation == {docs["b2"]: "rejected", docs["c2"]: "query"}
    assert all(
        item["category"] == "translation"
        for item in de["issues"]
        if item["code"] == "TRANSLATION_NOT_ACCEPTED"
    )
    # Only the accepted child raises the text-corrected cause: not the
    # rejected v2, the queried v3 or the accepted_corrected parent v4.
    corrected = {
        item["document_id"]
        for item in de["issues"]
        if item["code"] == "SELECTED_TEXT_CORRECTED"
    }
    assert corrected == {docs["a5"]}
    assert {"translation", "confirm-final"} <= set(de["categories"])
    versions = {v["document_id"]: v for v in de["versions"]}
    expected = {
        "a1": ("accepted", "accepted_unchanged"),
        "a2": ("reviewed", "rejected"),
        "a3": ("reviewed", "query"),
        "a4": ("reviewed", "accepted_corrected"),
        "a5": ("accepted", None),
        "b2": ("reviewed", "rejected"),
        "c2": ("reviewed", "query"),
    }
    for name, (status, decision) in expected.items():
        version = versions[docs[name]]
        assert version["translation_status"] == status, name
        assert version["latest_review_decision"] == decision, name
    assert versions[docs["a5"]]["version"] == 5
    assert versions[docs["a5"]]["is_newest_in_chain"] is True


def test_s12_orphan_pause_and_extended_hold_note(client):
    built = scenario(client, "S12")
    (page,) = lead_pages(client, built)
    rows = rows_of(page)
    reports = built["reports"]
    de = rows[("case-0512", "de")]
    (orphan,) = [i for i in de["issues"] if i["code"] == "TASK_PAUSED_WITHOUT_REPORT"]
    assert orphan["category"] == "report-or-pause"
    assert orphan["report_id"] == reports["resolved"]
    assert orphan["assignment_id"] == built["assignments"]["de"]
    assert "OPEN_PROBLEM_REPORT" not in codes(de["issues"])
    assert de["categories"] == ["report-or-pause"]
    fr = rows[("case-0512", "fr")]
    (paused,) = [n for n in fr["notes"] if n["code"] == "TASK_ON_HOLD"]
    assert paused["category"] is None
    assert paused["report_id"] == reports["open"]
    assert paused["assignment_id"] == built["assignments"]["fr"]
    assert fr["issues"] == [] and fr["categories"] == []
    en = rows[("case-0512", "en")]
    assert "OPEN_PROBLEM_REPORT" in codes(en["issues"])
    assert page["bar"]["report_or_pause"] == 2
