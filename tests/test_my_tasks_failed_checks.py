"""Spec A.7: TaskSummary.failed_check_count for translation review tasks."""

from types import SimpleNamespace

import pytest
from auth_harness import logged_in
from t1_builders import bundle, correction_unit, native_unit, translation_unit
from t1_fixtures import create_project, run_import
from test_auth_api import _app
from test_case_api import BASE
from work_plan_support import plan_all

FAILING = (("units_added", False), ("numbers_changed", False), ("glossary", True))


@pytest.fixture
def env(tmp_path):
    app = _app(tmp_path)
    db = app.state.repo.db
    create_project(db)
    source = native_unit("src", "en", "Source text", case_id="case")
    failing = translation_unit(
        "failing", "de", "Failing text", source=source, checks=FAILING
    )
    passing = translation_unit("passing", "de", "Passing text", source=source)
    flawed = translation_unit(
        "flawed", "de", "Flawed text", source=source, checks=FAILING
    )
    corrected = correction_unit(flawed, "Corrected text")
    units = [source, failing, passing, flawed, corrected]
    result = run_import(db, bundle(tmp_path, units))
    assert result.status == "succeeded", result.error
    plan_all(db, "proj")
    alice = logged_in(
        app,
        "alice",
        projects={"proj": ["annotator"]},
        assignments=[("proj", "src", "annotate")],
    )
    lead = logged_in(app, "leader", projects={"proj": ["lead"]}, assignments=[])
    return SimpleNamespace(app=app, db=db, alice=alice, lead=lead)


def document_id(env, external_id, version=1):
    return next(
        row.document_id
        for row in env.app.state.repo.list_variants("proj")
        if row.external_id == external_id and row.version == version
    )


def review(env, external_id, version=1):
    """Assign the variant to alice as a translation review (as `assigned` does)."""
    response = env.lead.post(
        f"{BASE}/assignments",
        json={
            "rows": [
                {
                    "document_id": document_id(env, external_id, version),
                    "username": "alice",
                }
            ],
            "task": "translation_review",
            "confirm_language": True,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["refused"] == [], response.text
    return response.json()["created"][0]


def counts(env, task):
    tasks = env.alice.get("/api/v1/me/tasks")
    assert tasks.status_code == 200, tasks.text
    return [t["failed_check_count"] for t in tasks.json() if t["task"] == task]


def test_translation_review_counts_failed_checks_of_the_reviewed_run(env):
    review(env, "failing")
    assert counts(env, "translation_review") == [2]


def test_correction_counts_its_translation_ancestor(env):
    review(env, "flawed", version=2)
    assert counts(env, "translation_review") == [2]


def test_passing_run_gives_zero_and_other_tasks_give_null(env):
    review(env, "passing")
    assert counts(env, "translation_review") == [0]
    assert counts(env, "annotate") == [None]


def test_workspace_and_task_list_agree(env):
    row = review(env, "failing")
    workspace = env.alice.get(f"/api/v1/translation-reviews/{row['id']}")
    assert workspace.status_code == 200, workspace.text
    assert (
        len(workspace.json()["failed_checks"]) == counts(env, "translation_review")[0]
    )
