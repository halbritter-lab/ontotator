"""The problem report browser scenarios build what WP9b to WP9d expect."""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from browser_problem_report_scenarios import (
    SCENARIOS,
    register_problem_report_scenario_route,
)
from browser_server import ONTOLOGY, TEST_PASSWORD
from fastapi.testclient import TestClient
from pg_harness import database_url_for
from sqlalchemy import select

from ontotator.api.app import create_app
from ontotator.config import AppConfig
from ontotator.storage.tables import TranslationReviewDraftRow


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    app = create_app(
        AppConfig(
            workspace_dir=tmp_path,
            database_url=database_url_for(tmp_path / "editor.db"),
            ontology_paths=[ONTOLOGY],
        )
    )
    register_problem_report_scenario_route(app)
    # The context starts the server's job worker; scenario imports need it.
    with TestClient(app) as client:
        yield client


def scenario(client: TestClient, name: str) -> dict[str, Any]:
    response = client.post("/__test_problem_reports__", params={"scenario": name})
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    assert body["project"].startswith(f"problems-{name}-")
    assert set(body["users"]) >= {"lead", "reporter", "same_text", "other_text"}
    assert set(body["tasks"]) == {"reporter", "same_text", "other_text"}
    return body


def as_user(client: TestClient, username: str) -> str:
    """Log in; returns the CSRF token."""
    client.cookies.clear()
    origin = str(client.base_url).rstrip("/")
    login = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": TEST_PASSWORD},
        headers={"Origin": origin},
    )
    assert login.status_code == 200, login.text
    token: str = login.json()["csrf_token"]
    return token


def task(client: TestClient, built: dict[str, Any], name: str) -> dict[str, Any]:
    as_user(client, built["users"][name])
    response = client.get(f"/api/v1/assignments/{built['tasks'][name]}")
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def file_report(
    client: TestClient, built: dict[str, Any], current: dict[str, Any]
) -> dict[str, Any]:
    """The reporter files a report on ``current`` (their task, as just read)."""
    token = as_user(client, built["users"]["reporter"])
    response = client.post(
        f"/api/v1/assignments/{current['id']}/problem-reports",
        json={
            "request_id": f"fixture-report-{current['id']}",
            "expected_workflow_revision": current["workflow_revision"],
            "round_id": current["active_round_id"],
            "reason": "Text is cut off after paragraph 2",
        },
        headers={
            "Origin": str(client.base_url).rstrip("/"),
            "X-CSRF-Token": token,
        },
    )
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def test_unknown_scenario_is_404(client):
    assert set(SCENARIOS) == {"base", "final", "translation"}
    response = client.post("/__test_problem_reports__", params={"scenario": "nope"})
    assert response.status_code == 404


def test_base_tasks_belong_to_their_owners_and_texts(client):
    built = scenario(client, "base")
    labels = built["labels"]
    assert len(set(labels.values())) == len(labels)
    reporter = task(client, built, "reporter")
    same = task(client, built, "same_text")
    other = task(client, built, "other_text")
    assert reporter["task"] == same["task"] == other["task"] == "annotate"
    assert reporter["document_id"] == built["documents"]["a_de"]
    assert same["document_id"] == built["documents"]["a_en"]
    assert other["document_id"] == built["documents"]["b_de"]
    # Every task is in progress with an active round; none is paused.
    for current in (reporter, same, other):
        assert current["active_round_id"]
        assert not current.get("held")
    # The reporter can file a report on the active round right away.
    assert file_report(client, built, reporter)["reporter_label"] == labels["reporter"]


def test_base_projects_are_fresh(client):
    first = scenario(client, "base")
    second = scenario(client, "base")
    assert first["project"] != second["project"]
    assert set(first["labels"].values()).isdisjoint(second["labels"].values())


def test_final_selects_another_annotators_submission_on_the_reporter_row(client):
    built = scenario(client, "final")
    final = built["final"]
    assert final["label_parts"] == ["Annotation", "Round 1", built["labels"]["earlier"]]
    as_user(client, built["users"]["lead"])
    page = client.get(f"/api/v1/projects/{built['project']}/document-rows")
    assert page.status_code == 200, page.text
    rows = {
        (row["case_id"], row["language"]): row
        for group in page.json()["groups"]
        for row in group["rows"]
    }
    row = rows[(built["case_ids"]["a"], "de")]
    assert row["final"]["submission_id"] == final["submission_id"]
    assert row["final"]["round_ordinal"] == 1
    # The reporter's own task stays in progress on that row.
    assert task(client, built, "reporter")["active_round_id"]


def test_translation_review_task_has_a_saved_draft(client):
    built = scenario(client, "translation")
    translation = built["translation"]
    assert translation["assignment_id"] == built["tasks"]["reporter"]
    reporter = task(client, built, "reporter")
    assert reporter["task"] == "translation_review"
    assert reporter["document_id"] == built["documents"]["a_de"]
    db = client.app.state.repo.db  # type: ignore[attr-defined]
    with db.transaction() as conn:
        draft = (
            conn.execute(
                select(TranslationReviewDraftRow).where(
                    TranslationReviewDraftRow.assignment_id
                    == translation["assignment_id"]
                )
            )
            .mappings()
            .one()
        )
    assert draft["text"] == translation["draft_text"]
    assert draft["form"] == translation["form"]
    assert draft["revision"] >= 1
    # The review task can be reported (restart scenarios start from here).
    assert file_report(client, built, reporter)["reporter_label"]
