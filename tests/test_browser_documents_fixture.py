"""The Documents browser scenarios S0 to S5 and S8 build what the specs expect."""

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
    # S8 reuses the S0 builder.
    prefix = "s0" if name == "S8" else name.lower()
    assert body["project"].startswith(f"documents-{prefix}-")
    assert body["users"]["lead"] and body["rows"]
    return body


def lead_page(client: TestClient, built: dict[str, Any]) -> dict[str, Any]:
    """The Documents page of the scenario as its lead (logged out afterwards)."""
    origin = str(client.base_url).rstrip("/")
    login = client.post(
        "/api/v1/auth/login",
        json={"username": built["users"]["lead"], "password": TEST_PASSWORD},
        headers={"Origin": origin},
    )
    assert login.status_code == 200, login.text
    # No decision filter: every row of the project.
    page = client.get(f"/api/v1/projects/{built['project']}/document-rows")
    assert page.status_code == 200, page.text
    client.post(
        "/api/v1/auth/logout",
        headers={"Origin": origin, "X-CSRF-Token": login.json()["csrf_token"]},
    )
    client.cookies.clear()
    body: dict[str, Any] = page.json()
    return body


def rows_of(page: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    return {
        (row["case_id"], row["language"]): row
        for group in page["groups"]
        for row in group["rows"]
    }


def codes(items: list[dict[str, Any]]) -> list[str]:
    return [item["code"] for item in items]


def test_registry_has_this_wp_scenarios_and_unknown_is_404(client):
    assert {"S0", "S1", "S2", "S3", "S4", "S5", "S8"} <= registry().keys()
    response = client.post("/__test_documents__", params={"scenario": "S99"})
    assert response.status_code == 404


@pytest.mark.parametrize("name", ["S0", "S8"])
def test_s0_selected_text_corrected_with_waiting_line(client, name):
    built = scenario(client, name)
    rows = rows_of(lead_page(client, built))
    assert set(rows) == {(row["case_id"], row["language"]) for row in built["rows"]}
    de = rows[("synthetic-accepted", "de")]
    assert de["final"]["submission_id"] == built["submissions"]["selected"]
    assert "SELECTED_TEXT_CORRECTED" in codes(de["issues"])
    assert "confirm-final" in de["categories"]
    assert "ROUND_REVIEW_PENDING" in codes(de["notes"])
    en = rows[("synthetic-accepted", "en")]
    assert en["final"] is None and en["work"] == []
    assert en["categories"] == [] and en["issues"] == []


def test_s1_two_submissions_and_a_final_without_issues(client):
    built = scenario(client, "S1")
    page = lead_page(client, built)
    (row,) = rows_of(page).values()
    assert row["final"]["submission_id"] == built["submissions"]["selected"]
    assert row["issues"] == [] and row["categories"] == []
    assert len(row["work"]) == 2
    assert all(work["status"] == "submitted" for work in row["work"])


def test_s2_seven_languages_four_finals_and_a_failed_check(client):
    built = scenario(client, "S2")
    page = lead_page(client, built)
    (group,) = page["groups"]
    assert group["language_count"] == 7 and group["final_count"] == 4
    rows = rows_of(page)
    de = rows[("case-0108", "de")]
    assert "TRANSLATION_CHECK_FAILED" in codes(de["issues"])
    assert "translation" in de["categories"]
    finals = {lang for (_case, lang), row in rows.items() if row["final"]}
    assert finals == {"en", "fr", "es", "it"}


def test_s3_final_on_v1_round_2_and_corrections_v2_v3(client):
    built = scenario(client, "S3")
    de = rows_of(lead_page(client, built))[("case-0211", "de")]
    final = de["final"]
    assert final["submission_id"] == built["submissions"]["selected"]
    assert final["version"] == 1 and final["round_ordinal"] == 2
    corrected = [i for i in de["issues"] if i["code"] == "SELECTED_TEXT_CORRECTED"]
    assert {item["document_id"] for item in corrected} == {
        built["documents"]["v2"],
        built["documents"]["v3"],
    }
    assert "ROUND_REVIEW_PENDING" in codes(de["notes"])
    statuses = {v["version"]: v["translation_status"] for v in de["versions"]}
    assert statuses == {1: "accepted", 2: "accepted", 3: "ready_for_review"}


def test_s4_two_independent_translations_in_progress(client):
    built = scenario(client, "S4")
    fr = rows_of(lead_page(client, built))[("case-0305", "fr")]
    assert fr["parallel_roots"] is True
    assert {v["chain_id"] for v in fr["versions"]} == {
        built["documents"]["a"],
        built["documents"]["b"],
    }
    assert len(fr["work"]) == 2 and fr["final"] is None
    assert all(work["status"] != "submitted" for work in fr["work"])


def test_s5_lead_consolidation_is_the_final(client):
    built = scenario(client, "S5")
    (row,) = rows_of(lead_page(client, built)).values()
    final = row["final"]
    assert final["submission_id"] == built["submissions"]["consolidation"]
    assert final["kind"] == "consolidation"
    assert row["issues"] == []
