"""The lead workflow browser scenarios build what ``lead-workflow.spec.ts`` expects."""

from collections.abc import Iterator
from pathlib import Path
from time import monotonic
from typing import Any

import pytest
from browser_documents_scenarios import Scenario, _wait_for_children
from browser_lead_workflow_scenarios import (
    BUILDERS,
    D15_DE,
    D15_FR,
    register_lead_workflow_scenario_route,
)
from browser_server import ONTOLOGY, TEST_PASSWORD, run_fixture_import
from fastapi.testclient import TestClient
from pg_harness import database_url_for

from ontotator.api.app import create_app
from ontotator.config import AppConfig

# Every scenario builds well inside the browser helper's timeout.
BUILD_SECONDS = 30
PEOPLE = {
    "lead": "Project Lead",
    "ana": "Ana Weber",
    "ben": "Ben Roth",
    "annotator": "Cy Annotator",
}


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    app = create_app(
        AppConfig(
            workspace_dir=tmp_path,
            database_url=database_url_for(tmp_path / "editor.db"),
            ontology_paths=[ONTOLOGY],
        )
    )
    register_lead_workflow_scenario_route(app)
    # The context starts the server's job worker; scenario imports need it.
    with TestClient(app) as client:
        yield client


def scenario(client: TestClient, name: str) -> dict[str, Any]:
    started = monotonic()
    response = client.post("/__test_lead_workflow__", params={"scenario": name})
    elapsed = monotonic() - started
    assert response.status_code == 200, response.text
    assert elapsed < BUILD_SECONDS, f"{name} took {elapsed:.1f} s"
    body: dict[str, Any] = response.json()
    assert body["project"].startswith(f"lead-{name.lower().replace('_', '-')}-")
    assert set(body["users"]) == set(PEOPLE)
    assert body["display_names"] == PEOPLE
    assert all(
        username.startswith(body["project"]) for username in body["users"].values()
    )
    assert set(body["pseudonyms"]) == set(PEOPLE)
    return body


def lead_rows(
    client: TestClient, built: dict[str, Any]
) -> tuple[dict[str, Any], dict[tuple[str, str], dict[str, Any]]]:
    """The decision bar and every Documents row (all pages) as the lead."""
    origin = str(client.base_url).rstrip("/")
    login = client.post(
        "/api/v1/auth/login",
        json={"username": built["users"]["lead"], "password": TEST_PASSWORD},
        headers={"Origin": origin},
    )
    assert login.status_code == 200, login.text
    rows: dict[tuple[str, str], dict[str, Any]] = {}
    page_number, bar = 1, None
    while True:
        response = client.get(
            f"/api/v1/projects/{built['project']}/document-rows",
            params={"page": page_number},
        )
        assert response.status_code == 200, response.text
        page = response.json()
        bar = page["bar"]
        for group in page["groups"]:
            for row in group["rows"]:
                rows[(row["case_id"], row["language"])] = row
        if page_number >= page["page_count"]:
            break
        page_number += 1
    client.post(
        "/api/v1/auth/logout",
        headers={"Origin": origin, "X-CSRF-Token": login.json()["csrf_token"]},
    )
    client.cookies.clear()
    return bar, rows


def import_bundle(client: TestClient, built: dict[str, Any]) -> None:
    """Import the scenario's bundle as the browser upload would (same setting)."""
    app: Any = client.app
    job = run_fixture_import(app, Path(built["bundle_path"]), built["project"])
    assert job.status == "succeeded", job.error
    _wait_for_children(Scenario(app, built["project"], {}), job.id)


def flags(row: dict[str, Any]) -> tuple[bool, bool]:
    return row["plan_row"]["review"], row["plan_row"]["annotate"]


def codes(row: dict[str, Any]) -> list[str]:
    return [step["code"] for step in row["steps"]]


def test_registry_has_eight_scenarios_and_unknown_is_404(client):
    assert set(BUILDERS) == {
        "D15",
        "DEFAULT_IMPORT",
        "ANNOTATION_BATCH",
        "FR_OFF",
        "ACCEPTANCE",
        "ROWS",
        "REJECTED_TRANSLATION_FOR_LEAD",
        "UPLOAD_DIALOG",
    }
    response = client.post("/__test_lead_workflow__", params={"scenario": "S99"})
    assert response.status_code == 404


def test_d15_empty_project_bundle_of_50_cases_imports_nothing_planned(client):
    built = scenario(client, "D15")
    path = Path(built["bundle_path"])
    assert path.is_absolute() and path.is_file() and path.suffix == ".zip"
    de, fr = built["case_ids"]["de"], built["case_ids"]["fr"]
    assert de == list(D15_DE) and fr == list(D15_FR)
    assert len(de) == 20 and len(fr) == 30 and not set(de) & set(fr)
    assert sorted(de + fr) == [f"case-{n:04d}" for n in range(101, 151)]
    assert len(built["rows"]) == 200
    bar, rows = lead_rows(client, built)
    assert rows == {} and bar["total"] == 0
    import_bundle(client, built)
    bar, rows = lead_rows(client, built)
    assert set(rows) == {(r["case_id"], r["language"]) for r in built["rows"]}
    assert bar["in_plan"] == 0
    assert not any(row["in_plan"] for row in rows.values())


def test_upload_dialog_bundle_of_185_texts_imports_a_language_the_project_lacks(
    client,
):
    built = scenario(client, "UPLOAD_DIALOG")
    assert len(built["rows"]) == 185
    assert len({row["case_id"] for row in built["rows"]}) == 62
    import_bundle(client, built)
    _, rows = lead_rows(client, built)
    # fr is not a project language (en, de): the preview warns, the import goes on.
    assert set(rows) == {(r["case_id"], r["language"]) for r in built["rows"]}
    assert sum(1 for _case, language in rows if language == "fr") == 61


def test_default_import_plans_review_and_annotate_on_translations(client):
    built = scenario(client, "DEFAULT_IMPORT")
    assert Path(built["bundle_path"]).is_file()
    assert lead_rows(client, built)[1] == {}
    import_bundle(client, built)
    bar, rows = lead_rows(client, built)
    assert len(rows) == 9 and bar["in_plan"] == 6
    for (_case, language), row in rows.items():
        assert flags(row) == ((False, False) if language == "en" else (True, True))
    assert bar["to_assign"] == 6


def test_annotation_batch_14_accepted_to_assign_6_waiting(client):
    built = scenario(client, "ANNOTATION_BATCH")
    assert len(built["case_ids"]["de"]) == 20 and len(built["accepted"]) == 14
    bar, rows = lead_rows(client, built)
    de = {case: row for (case, lang), row in rows.items() if lang == "de"}
    assert len(de) == 20
    assert bar["to_assign"] == 14
    waiting = [
        c for c, row in de.items() if "waiting_for_translation_review" in codes(row)
    ]
    assert len(waiting) == 6 and not set(waiting) & set(built["accepted"])
    for case in built["accepted"]:
        assert de[case]["next_step"]["code"] == "assign_annotation"
    for case in waiting:
        step = de[case]["next_step"]
        assert step["code"] == "translation_review_in_progress"
        assert step["owner"]["person"]["pseudonym"] == built["pseudonyms"]["ana"]


def test_fr_off_open_reviews_by_two_people_and_a_final(client):
    built = scenario(client, "FR_OFF")
    _bar, rows = lead_rows(client, built)
    fr = {case: row for (case, lang), row in rows.items() if lang == "fr"}
    assert len(fr) == 10
    assert all(flags(row) == (True, True) for row in fr.values())
    owners = {}
    for name, case in built["open_reviews"].items():
        step = fr[case]["next_step"]
        assert step["code"] == "translation_review_in_progress"
        owners[name] = step["owner"]["person"]["pseudonym"]
    assert owners == {
        "ana": built["pseudonyms"]["ana"],
        "ben": built["pseudonyms"]["ben"],
    }
    final = fr[built["final_case"]]
    assert built["final_case"] == "case-0108" and final["final"] is not None
    assert [r for r in fr.values() if r["final"]] == [final]


def test_acceptance_18_marked_in_package_12_not(client):
    built = scenario(client, "ACCEPTANCE")
    assert len(built["case_ids"]["fr"]) == 30 and len(built["marked"]) == 18
    bar, rows = lead_rows(client, built)
    fr = {case: row for (case, lang), row in rows.items() if lang == "fr"}
    statuses = {
        case: row["versions"][0]["translation_status"] for case, row in fr.items()
    }
    accepted = {case for case, status in statuses.items() if status == "accepted"}
    assert accepted == set(built["marked"])
    assert sorted(set(statuses.values())) == ["accepted", "ready_for_review"]
    assert bar["in_plan"] == 0


def test_rows_mixed_plans_report_rejected_and_row_actions(client):
    built = scenario(client, "ROWS")
    bar, rows = lead_rows(client, built)
    assert len({case for case, _lang in rows}) == 30
    cases = built["cases"]
    assert flags(rows[(cases["chip"], "fr")]) == (True, False)
    assert flags(rows[(cases["acceptance"], "fr")]) == (True, True)
    expected = {
        "rejected": ("resolve_rejected", "resolve"),
        "report": ("decide_report", "decide_report"),
        "choose_final": ("choose_final", "choose_final"),
        "review_changes": ("confirm_final", "review_changes"),
    }
    for name, (code, action) in expected.items():
        step = rows[(cases[name], "de")]["next_step"]
        assert (step["code"], step["action"]) == (code, action), name
    report = rows[(cases["report"], "de")]
    assert [r["report_id"] for r in report["problem_reports"]] == [built["report_id"]]
    plans = {flags(row) for row in rows.values() if row["plan_row"]}
    assert {(True, True), (True, False), (False, True), (False, False)} <= plans
    assert not rows[(cases["not_in_plan"], "en")]["in_plan"]
    assert bar["needs_decision"] >= 4 and bar["to_assign"] > 0


def test_rejected_translation_for_lead_builds(client):
    built = scenario(client, "REJECTED_TRANSLATION_FOR_LEAD")
    cases = built["cases"]
    assert set(cases) == {"rejected", "queried", "to_assign"}
    assert built["case_ids"] == {"de": sorted(cases.values())}
    bar, rows = lead_rows(client, built)
    de = {case: row for (case, lang), row in rows.items() if lang == "de"}
    assert len(de) == 3
    assert all(flags(row) == (True, True) for row in de.values())
    expected = {
        "rejected": ("resolve_rejected", "rejected"),
        "queried": ("resolve_queried", "query"),
    }
    for name, (code, decision) in expected.items():
        row = de[cases[name]]
        assert (row["next_step"]["code"], row["next_step"]["action"]) == (
            code,
            "resolve",
        ), name
        (version,) = row["versions"]
        assert version["translation_status"] == "reviewed"
        assert version["latest_review_decision"] == decision
        # Nobody holds an open translation review: the lead may correct it.
        assert not [w for w in row["work"] if w["status"] != "submitted"]
    assert de[cases["to_assign"]]["next_step"]["code"] == "assign_translation_review"
    # The fixture imports with "Nothing planned": the three en source rows
    # stay unplanned but are never undecided ("not planned"); only the two
    # resolve steps need a decision (V10).
    undecided = {
        key
        for key, row in rows.items()
        if row["next_step"] and row["next_step"]["code"] == "decide_plan"
    }
    assert undecided == set()
    assert bar["not_decided"] == 0
    assert bar["needs_decision"] == 2
    # The lead reviews de (FD6: languages and a qualification at start).
    app: Any = client.app
    accounts = app.state.accounts
    lead = accounts.get_by_username(built["users"]["lead"])
    assert lead.qualification
    assert "de" in accounts.languages_of([lead.id])[lead.id]
