"""Documents filter vocabulary (follow-up spec FD10, FD12): ``final=any``,
repeatable ``step``/``stage``/``plan`` (OR within, AND across), ``paused`` and
the project-wide ``bar.finals``."""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy import update
from work_plan_support import (
    BASE,
    assign,
    doc,
    plan_env,
    select_final,
    submit,
    write,
)

from ontotator.domain.work_plans import PlanFlags, RowKey
from ontotator.storage.tables import AssignmentRow, DocumentRow

BOTH = PlanFlags(True, True)
REVIEW = PlanFlags(True, False)
ANNOTATE = PlanFlags(False, True)

Params = list[tuple[str, str]]


def set_status(env: Any, document_id: str, status: str) -> None:
    with env.db.transaction() as conn:
        conn.execute(
            update(DocumentRow)
            .where(DocumentRow.document_id == document_id)
            .values(translation_status=status)
        )


def hold(env: Any, assignment_id: int) -> None:
    with env.db.transaction() as conn:
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == assignment_id)
            .values(held=True)
        )


@pytest.fixture
def env(tmp_path):
    """c1/c2 en annotate; c1 de, c2 de both; c1 fr review; c2 fr annotate.

    c1 de has a translation review by ana, c2 de none; c1 en is annotated and
    final; c2 en has a held annotation.
    """
    env = plan_env(tmp_path)
    for case in ("c1", "c2"):
        for language in ("de", "fr"):
            set_status(env, doc(case, language), "ready_for_review")
    write(
        env,
        {
            RowKey("c1", "de"): BOTH,
            RowKey("c2", "de"): BOTH,
            RowKey("c1", "fr"): REVIEW,
            RowKey("c2", "fr"): ANNOTATE,
        },
    )
    set_status(env, doc("c2", "fr"), "accepted")
    assign(env, doc("c1", "de"), "ana", "translation_review")
    annotate = assign(env, doc("c1", "en"), "anno", "annotate")
    submit(env, annotate, "s-anno")
    select_final(env, doc("c1", "en"), "s-anno")
    env.held = assign(env, doc("c2", "en"), "anno2", "annotate")
    hold(env, env.held)
    return env


def page(env: Any, params: Params) -> dict[str, Any]:
    response = env.lead.get(f"{BASE}/document-rows", params=params)
    assert response.status_code == 200, response.text
    return dict(response.json())


def keys(env: Any, params: Params) -> set[tuple[str, str]]:
    return {
        (row["case_id"], row["language"])
        for group in page(env, params)["groups"]
        for row in group["rows"]
    }


def case_ids(env: Any, params: Params) -> list[str]:
    response = env.lead.get(f"{BASE}/document-rows/case-ids", params=params)
    assert response.status_code == 200, response.text
    return list(response.json()["case_ids"])


def test_final_any_lists_rows_with_a_final(env):
    assert keys(env, [("final", "any")]) == {("c1", "en")}
    assert page(env, [("final", "any")])["bar"]["shown"] == 1
    assert ("c1", "en") not in keys(env, [("final", "missing")])
    response = env.lead.get(
        f"{BASE}/document-rows", params=[("final", "any"), ("decision", "all")]
    )
    assert response.status_code == 422


def test_repeated_step_is_or(env):
    review = keys(env, [("step", "assign_translation_review")])
    running = keys(env, [("step", "translation_review_in_progress")])
    assert review and running
    assert review.isdisjoint(running)
    both = keys(
        env,
        [
            ("step", "assign_translation_review"),
            ("step", "translation_review_in_progress"),
        ],
    )
    assert both == review | running
    # One value behaves as before: only rows with that step.
    assert running == {("c1", "de")}


def test_repeated_stage_and_plan_are_or(env):
    review_stage = keys(env, [("stage", "translation_review")])
    final_stage = keys(env, [("stage", "final"), ("stage", "done")])
    assert final_stage == keys(env, [("stage", "final")]) | keys(
        env, [("stage", "done")]
    )
    assert keys(
        env, [("stage", "translation_review"), ("stage", "final")]
    ) == review_stage | keys(env, [("stage", "final")])
    review_only = keys(env, [("plan", "review")])
    both = keys(env, [("plan", "review_and_annotate")])
    assert review_only == {("c1", "fr")}
    assert both == {("c1", "de"), ("c2", "de")}
    assert keys(env, [("plan", "review"), ("plan", "review_and_annotate")]) == (
        review_only | both
    )
    # AND across parameters.
    assert keys(
        env,
        [
            ("plan", "review"),
            ("plan", "review_and_annotate"),
            ("step", "translation_review_in_progress"),
        ],
    ) == {("c1", "de")}


def test_paused_yes_no_only_counts_annotate_and_review_holds(env):
    # A held translation review is not "paused" (annotate/review tasks only).
    with env.db.transaction() as conn:
        conn.execute(
            update(AssignmentRow)
            .where(
                AssignmentRow.document_id == doc("c1", "de"),
                AssignmentRow.task == "translation_review",
            )
            .values(held=True)
        )
    everything = keys(env, [])
    assert keys(env, [("paused", "yes")]) == {("c2", "en")}
    assert keys(env, [("paused", "no")]) == everything - {("c2", "en")}
    assert (
        env.lead.get(f"{BASE}/document-rows", params={"paused": "maybe"}).status_code
        == 422
    )


def test_case_ids_endpoint_accepts_the_same_filters(env):
    assert case_ids(env, [("final", "any")]) == ["c1"]
    assert case_ids(env, [("paused", "yes")]) == ["c2"]
    assert case_ids(
        env,
        [
            ("step", "assign_translation_review"),
            ("step", "translation_review_in_progress"),
        ],
    ) == sorted(
        {
            key[0]
            for key in keys(
                env,
                [
                    ("step", "assign_translation_review"),
                    ("step", "translation_review_in_progress"),
                ],
            )
        }
    )
    assert case_ids(env, [("plan", "review"), ("stage", "translation_review")]) == [
        "c1"
    ]


def test_bar_finals_is_project_wide(env):
    assert page(env, [])["bar"]["finals"] == 1
    assert page(env, [("language", "fr"), ("final", "none")])["bar"]["finals"] == 1
    assert page(env, [("q", "c2"), ("page", "1")])["bar"]["finals"] == 1
