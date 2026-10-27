"""NEW rows: a lead-owned next step with activity by others since the start
of the lead's previous visit (documents overview spec V3, VD6, "New-item
signal")."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from typing import Any

import pytest
from auth_harness import logged_in
from document_rows_support import rows_of
from document_rows_support import service as rows_service
from sqlalchemy import update
from t1_builders import bundle, native_unit, translation_unit
from t1_fixtures import TEXT, run_import
from test_document_rows_next_step import add_correction, open_report
from test_document_rows_stages import (
    ANNOTATE,
    REVIEW,
    finish,
    plan,
    reviewed,
    set_status,
)
from work_plan_support import (
    assign,
    doc,
    plan_env,
    revision_of,
    select_final,
    submit,
)
from work_plan_support import service as plan_service

from ontotator.api.work_plan_routes import PlanRowPatch
from ontotator.application.document_rows import RowQuery
from ontotator.assignments.service import AssignmentService
from ontotator.auth.audit import Actor
from ontotator.storage.tables import ProjectRow

Key = tuple[str, str]


@pytest.fixture
def env(tmp_path):
    env = plan_env(tmp_path)
    for case in ("c1", "c2"):
        for language in ("de", "fr"):
            set_status(env, doc(case, language), "ready_for_review")
    env.tmp_path = tmp_path
    return env


def rows(env: Any, username: str = "leader") -> dict[Key, dict[str, Any]]:
    return rows_of(rows_service(env, username).page("proj", RowQuery()))


def start_visit(env: Any, username: str = "leader") -> datetime:
    """A first visit on the server's clock: its baseline is "now"."""
    return rows_service(env, username).visit("proj")["baseline_at"]  # type: ignore[no-any-return]


def activity(row: dict[str, Any]) -> datetime | None:
    value = row["others_activity_at"]
    return None if value is None else value


def lead_owned(row: dict[str, Any]) -> bool:
    step = row["next_step"]
    return step is not None and step["kind"] in ("decision", "assign")


def second_lead(env: Any) -> Any:
    client = logged_in(env.app, "lead2", projects={"proj": ["lead"]}, assignments=[])
    user = env.app.state.accounts.get_by_username("lead2")
    return client, Actor(user.id, "user:lead2")


def assign_as(env: Any, actor: Actor, document_id: str, username: str) -> int:
    return (
        AssignmentService(env.db)
        .assign(
            actor,
            "proj",
            document_id,
            username,
            "annotate",
            confirm_language=True,
        )
        .id
    )


def two_annotations_per_text(env: Any) -> None:
    with env.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.id == env.pid)
            .values(annotations_per_text=2)
        )


def test_new_needs_lead_owned_step_and_newer_activity(env):
    old = assign(env, doc("c2", "en"), "anno", "annotate")
    submit(env, old, "s-old")
    current = assign(env, doc("c1", "en"), "anno", "annotate")
    baseline = start_visit(env)
    before = rows(env)
    assert lead_owned(before[("c2", "en")])
    older = activity(before[("c2", "en")])
    assert older is not None and older <= baseline
    assert before[("c2", "en")]["new"] is False

    submit(env, current, "s-new")
    after = rows(env)
    row = after[("c1", "en")]
    assert lead_owned(row)
    newer = activity(row)
    assert newer is not None and newer > baseline
    assert row["new"] is True
    assert after[("c2", "en")]["new"] is False
    assert {key for key, value in after.items() if value["new"]} == {("c1", "en")}


def test_own_events_never_make_new(env):
    two_annotations_per_text(env)
    plan(env, c1_de=REVIEW)
    other = assign(env, doc("c2", "en"), "anno", "annotate")
    submit(env, other, "s-c2")
    start_visit(env)
    before = rows(env)

    # The lead's own assignment, plan write and final selection.
    assign(env, doc("c1", "en"), "anno", "annotate")
    plan_service(env).patch_row(
        "proj",
        "c1",
        "de",
        PlanRowPatch(review=False, expected_revision=revision_of(env, "c1")),
    )
    select_final(env, doc("c2", "en"), "s-c2")

    after = rows(env)
    assert lead_owned(after[("c1", "en")])  # 1 of 2 annotations assigned
    for key, row in after.items():
        assert row["new"] is False, key
        assert activity(row) == activity(before[key]), key


def test_other_leads_assignment_makes_new(env):
    two_annotations_per_text(env)
    _, actor = second_lead(env)
    baseline = start_visit(env)
    assign_as(env, actor, doc("c1", "en"), "anno")
    row = rows(env)[("c1", "en")]
    assert row["next_step"]["kind"] == "assign"
    assert activity(row) is not None and activity(row) > baseline  # type: ignore[operator]
    assert row["new"] is True
    # For the second lead the same assignment is an own event.
    start_visit(env, "lead2")
    assert rows(env, "lead2")[("c1", "en")]["new"] is False


def _submission(env: Any) -> Callable[[], Key]:
    aid = assign(env, doc("c1", "en"), "anno", "annotate")

    def act() -> Key:
        submit(env, aid, "s-1")
        return ("c1", "en")

    return act


def _review(env: Any, decision: str) -> Callable[[], Key]:
    plan(env, c1_de=REVIEW)
    aid = assign(env, doc("c1", "de"), "ana", "translation_review")

    def act() -> Key:
        reviewed(env, doc("c1", "de"), decision)
        if decision == "accepted_corrected":
            add_correction(env, doc("c1", "de"), "c1-de-v2", "ready_for_review")
        finish(env, aid)
        return ("c1", "de")

    return act


def _report(env: Any) -> Callable[[], Key]:
    aid = assign(env, doc("c1", "en"), "anno", "annotate")

    def act() -> Key:
        open_report(env, "anno", aid)
        return ("c1", "en")

    return act


def _hold(env: Any) -> Callable[[], Key]:
    # Two annotations per text: the held row still waits for an assignment.
    two_annotations_per_text(env)
    reported = assign(env, doc("c1", "en"), "anno", "annotate")
    held = assign(env, doc("c2", "en"), "anno2", "annotate")
    report_id = open_report(env, "anno", reported)
    client, _ = second_lead(env)

    def act() -> Key:
        response = client.post(
            f"/api/v1/problem-reports/{report_id}/actions",
            json={
                "request_id": "extend-1",
                "expected_revision": 1,
                "action": "extend_hold",
                "reason": "Pause this one too",
                "assignment_ids": [held],
            },
        )
        assert response.status_code == 200, response.text
        return ("c2", "en")

    return act


def _import(env: Any) -> Callable[[], Key]:
    def act() -> Key:
        source = native_unit("c3-en", "en", f"{TEXT} c3", case_id="c3")
        units = [
            source,
            translation_unit("c3-de", "de", f"{TEXT} c3 de", source=source),
        ]
        folder = env.tmp_path / "c3"
        folder.mkdir()
        result = run_import(env.db, bundle(folder, units))
        assert result.status == "succeeded", result.error
        return ("c3", "de")

    return act


SETUPS: dict[str, Callable[[Any], Callable[[], Key]]] = {
    "submission": _submission,
    "review": lambda env: _review(env, "rejected"),
    "report": _report,
    "hold": _hold,
    "import": _import,
    "correction": lambda env: _review(env, "accepted_corrected"),
}


@pytest.mark.parametrize("event", list(SETUPS))
def test_submission_review_report_hold_import_correction_make_new(env, event):
    act = SETUPS[event](env)
    baseline = start_visit(env)
    key = act()
    row = rows(env)[key]
    assert activity(row) is not None and activity(row) > baseline  # type: ignore[operator]
    assert lead_owned(row), row["next_step"]
    assert row["new"] is True


def test_new_stays_until_state_changes(env):
    aid = assign(env, doc("c1", "en"), "anno", "annotate")
    baseline = start_visit(env)
    submit(env, aid, "s-1")
    assert rows(env)[("c1", "en")]["new"] is True
    # Reopening Documents within the visit and acting without changing the
    # row's step keep NEW.
    assert start_visit(env) == baseline
    plan(env, c1_en=ANNOTATE)
    assert rows(env)[("c1", "en")]["new"] is True
    # Choosing the final result changes the state: NEW goes.
    select_final(env, doc("c1", "en"), "s-1")
    row = rows(env)[("c1", "en")]
    assert not lead_owned(row) and row["new"] is False


def test_in_progress_rows_are_never_new(env):
    _, actor = second_lead(env)
    baseline = start_visit(env)
    assign_as(env, actor, doc("c1", "en"), "anno")
    row = rows(env)[("c1", "en")]
    assert row["next_step"]["kind"] == "in_progress"
    assert activity(row) > baseline  # type: ignore[operator]
    assert row["new"] is False
