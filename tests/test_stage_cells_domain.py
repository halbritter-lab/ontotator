"""Stage cells Review / Annotation / Final (documents overview spec "Stage cells").

Pure: no database. Scenarios 1-16 follow the plan's "Shared contracts >
Scenario table"; people are Ana Weber (1), Tom Reis (2), Luc Martin (3).
"""

from __future__ import annotations

import ast
import dataclasses
import itertools
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from ontocurator.domain import stage_cells as stage_cells_module
from ontocurator.domain.next_steps import (
    REVIEWER_NEEDED_STATUSES,
    OldItem,
    StepFacts,
    derive_steps,
    in_plan,
)
from ontocurator.domain.stage_cells import (
    STEP_CELL,
    StageCells,
    StageFacts,
    stage_cells,
    step_cell,
)

ANA, TOM, LUC = 1, 2, 3
AT_1040 = datetime(2026, 10, 21, 10, 40, tzinfo=UTC)
AT_1051 = datetime(2026, 10, 21, 10, 51, tzinfo=UTC)

_STEP_DEFAULTS: dict[str, Any] = dict(
    review=True,
    annotate=True,
    is_source=False,
    rule_on=True,
    per_text=1,
    open_report_id=None,
    orphan_pause_assignment_id=None,
    unacknowledged_final_cause=False,
    newest_decisions=(None,),
    translation_statuses=("accepted",),
    open_translation_reviews=0,
    annotation_assignments=0,
    open_annotations=0,
    open_annotation_reviews=0,
    missing_final=False,
    has_final=False,
    check_failed=False,
)
_STEP_FIELDS = {f.name for f in dataclasses.fields(StepFacts)}


def facts(**overrides: Any) -> StageFacts:
    """A default in-plan translation row (Review and Annotate on, accepted
    unchanged, nothing assigned); keyword overrides go to StepFacts or
    StageFacts by name."""
    step = {
        **_STEP_DEFAULTS,
        **{k: v for k, v in overrides.items() if k in _STEP_FIELDS},
    }
    stage: dict[str, Any] = {"accepted_how": "unchanged"}
    stage.update({k: v for k, v in overrides.items() if k not in _STEP_FIELDS})
    return StageFacts(step=StepFacts(**step), **stage)


def cells(f: StageFacts) -> StageCells:
    return stage_cells(f, derive_steps(f.step))


def summary(c: StageCells) -> tuple[str, str, str, str, str, str]:
    return (
        c.review.state,
        c.review.tone,
        c.annotation.state,
        c.annotation.tone,
        c.final.state,
        c.final.tone,
    )


# Scenario table rows: id, facts, expected states/tones, expected detail fields
# as {"review"|"annotation"|"final": {field: value}}.
SCENARIOS: list[tuple[str, StageFacts, tuple[str, ...], dict[str, dict[str, Any]]]] = [
    (
        "1-de-undecided",
        facts(
            review=False,
            annotate=False,
            decided=False,
            accepted_how=None,
            translation_statuses=("translated",),
            newest_origin="machine_translation",
        ),
        ("undecided", "undecided", "undecided", "undecided", "none", "none"),
        {},
    ),
    (
        "1-en-source-not-planned",
        facts(
            review=False,
            annotate=False,
            is_source=True,
            accepted_how=None,
            translation_statuses=(None,),
        ),
        ("source", "none", "not_planned", "none", "none", "none"),
        {"annotation": {"note": None}},
    ),
    (
        "2-check-failed",
        facts(
            translation_statuses=("automatic_check_failed",),
            check_failed=True,
            accepted_how=None,
            newest_origin="machine_translation",
        ),
        ("check_failed", "decision", "after_review", "waiting", "none", "none"),
        {"review": {"people": ()}},
    ),
    (
        "3-review-in-progress",
        facts(
            translation_statuses=("ready_for_review",),
            open_translation_reviews=1,
            review_people=(ANA,),
            accepted_how=None,
        ),
        ("in_progress", "running", "after_review", "waiting", "none", "none"),
        {"review": {"people": (ANA,)}},
    ),
    (
        "4-de-rejected",
        facts(
            translation_statuses=("reviewed",),
            newest_decisions=("rejected",),
            review_decided_by=ANA,
            review_decided_at=AT_1040,
            accepted_how=None,
        ),
        ("rejected", "rejected", "blocked", "waiting", "none", "none"),
        {
            "review": {"people": (ANA,), "at": AT_1040},
            "annotation": {"note": "translation_rejected"},
        },
    ),
    (
        "4-fr-query",
        facts(
            translation_statuses=("reviewed",),
            newest_decisions=("query",),
            review_decided_by=LUC,
            review_decided_at=AT_1051,
            accepted_how=None,
        ),
        ("query", "decision", "blocked", "waiting", "none", "none"),
        {
            "review": {"people": (LUC,), "at": AT_1051},
            "annotation": {"note": "translation_queried"},
        },
    ),
    (
        "5-corrected-unassigned",
        facts(
            per_text=2,
            accepted_how="corrected",
            accepted_from_version=1,
            newest_version=2,
            newest_origin="correction",
            review_decided_by=ANA,
        ),
        ("accepted", "done", "unassigned", "todo", "none", "none"),
        {
            "review": {
                "note": "with_corrections",
                "from_version": 1,
                "version": 2,
                "people": (ANA,),
            },
            "annotation": {"assigned": 0, "target": 2},
        },
    ),
    (
        "6-one-of-two-submitted",
        facts(
            per_text=2,
            annotation_assignments=2,
            open_annotations=1,
            annotators_open=(TOM,),
            annotators_submitted=(ANA,),
            submissions=1,
        ),
        ("accepted", "done", "in_progress", "running", "after_annotation", "waiting"),
        {
            "review": {"note": "unchanged"},
            "annotation": {"submitted": 1, "total": 2, "people": (TOM,)},
        },
    ),
    (
        "7a-accept-result",
        facts(
            annotation_assignments=1,
            annotators_submitted=(ANA,),
            findings=3,
            missing_final=True,
            submissions=1,
        ),
        ("accepted", "done", "submitted", "done", "choose", "decision"),
        {
            "annotation": {"people": (ANA,), "findings": 3},
            "final": {"submitted": 1},
        },
    ),
    (
        "7b-compare-results-source",
        facts(
            review=False,
            is_source=True,
            accepted_how=None,
            per_text=2,
            translation_statuses=(None,),
            annotation_assignments=2,
            annotators_submitted=(ANA, TOM),
            missing_final=True,
            submissions=2,
        ),
        ("source", "none", "submitted", "done", "choose", "decision"),
        {
            "annotation": {"people": (ANA, TOM), "submitted": 2, "total": 2},
            "final": {"submitted": 2},
        },
    ),
    (
        "8-annotation-review",
        facts(
            per_text=2,
            annotation_assignments=2,
            open_annotation_reviews=1,
            annotators_submitted=(ANA, TOM),
            annotation_reviewers=(LUC,),
            submissions=2,
        ),
        ("accepted", "done", "in_review", "running", "after_review", "waiting"),
        {"annotation": {"submitted": 2, "people": (LUC,)}},
    ),
    (
        "9-paused",
        facts(
            annotation_assignments=1,
            open_annotations=1,
            annotators_open=(TOM,),
            open_report_id="r9",
            paused_by=TOM,
            paused_excerpt="Satz 3 unvollständig…",
            paused_task="annotate",
        ),
        ("accepted", "done", "paused", "decision", "none", "none"),
        {"annotation": {"people": (TOM,), "excerpt": "Satz 3 unvollständig…"}},
    ),
    (
        "10-review-only",
        facts(annotate=False),
        ("accepted", "done", "not_planned", "none", "none", "none"),
        {"review": {"note": "unchanged"}, "annotation": {"note": "review_only"}},
    ),
    (
        "11-de-final-round",
        facts(
            per_text=2,
            annotation_assignments=2,
            annotators_submitted=(ANA, TOM),
            has_final=True,
            final_kind="round",
            final_author=ANA,
            final_round_ordinal=1,
            final_version=1,
            submissions=2,
        ),
        ("accepted", "done", "submitted", "done", "final", "done"),
        {
            "annotation": {"submitted": 2, "total": 2, "people": (ANA, TOM)},
            "final": {
                "people": (ANA,),
                "round_ordinal": 1,
                "note": "round",
                "reason": None,
                "version": None,
            },
        },
    ),
    (
        "11-fr-final-consolidation",
        facts(
            annotation_assignments=1,
            annotators_submitted=(ANA,),
            has_final=True,
            final_kind="consolidation",
            final_author=LUC,
            final_version=1,
            submissions=2,
        ),
        ("accepted", "done", "submitted", "done", "final", "done"),
        {"final": {"people": (LUC,), "note": "consolidation"}},
    ),
    (
        "11-en-source",
        facts(
            review=False,
            annotate=False,
            is_source=True,
            accepted_how=None,
            translation_statuses=(None,),
        ),
        ("source", "none", "not_planned", "none", "none", "none"),
        {},
    ),
    (
        "12-open-on-old-text",
        facts(
            accepted_how="corrected",
            accepted_from_version=1,
            newest_version=2,
            newest_origin="correction",
            review_decided_by=ANA,
            old_open=(OldItem(TOM, 1, assignment_id=12),),
        ),
        ("accepted", "done", "old_text_open", "decision", "none", "none"),
        {
            "review": {"note": "with_corrections", "from_version": 1, "version": 2},
            "annotation": {"people": (TOM,), "from_version": 1, "version": 2},
        },
    ),
    (
        "13-submitted-on-old-text",
        facts(
            accepted_how="corrected",
            accepted_from_version=1,
            newest_version=2,
            newest_origin="correction",
            review_decided_by=ANA,
            old_submitted=(OldItem(ANA, 1, submission_id="s13"),),
        ),
        (
            "accepted",
            "done",
            "old_text_submitted",
            "decision",
            "after_annotation",
            "waiting",
        ),
        {
            "annotation": {
                "people": (ANA,),
                "from_version": 1,
                "version": 2,
                "note": "v2_not_annotated",
            },
        },
    ),
    (
        "14-final-on-old-text",
        facts(
            accepted_how="corrected",
            accepted_from_version=1,
            newest_version=2,
            newest_origin="correction",
            review_decided_by=ANA,
            old_submitted=(OldItem(ANA, 1, submission_id="s14"),),
            has_final=True,
            unacknowledged_final_cause=True,
            final_causes=("SELECTED_TEXT_CORRECTED",),
            final_kind="round",
            final_author=ANA,
            final_round_ordinal=1,
            final_version=1,
            final_on_newest=False,
        ),
        ("accepted", "done", "submitted", "done", "old_text", "decision"),
        {
            "annotation": {"version": 1, "people": (ANA,)},
            "final": {"people": (ANA,), "round_ordinal": 1, "version": 1},
        },
    ),
    (
        "15-en-source-corrected",
        facts(
            review=False,
            annotate=False,
            is_source=True,
            accepted_how=None,
            translation_statuses=(None,),
            newest_version=2,
            newest_origin="correction",
        ),
        ("source", "none", "not_planned", "none", "none", "none"),
        {},
    ),
    (
        "15-de-source-changed",
        facts(
            source_changed_from=1,
            annotation_assignments=1,
            annotators_submitted=(TOM,),
            has_final=True,
            final_kind="round",
            final_author=TOM,
            final_round_ordinal=1,
            final_version=1,
            submissions=1,
        ),
        (
            "source_changed",
            "decision",
            "submitted",
            "done",
            "may_be_outdated",
            "waiting",
        ),
        {
            "review": {"from_version": 1},
            "annotation": {"version": 1},
            "final": {"note": "source_changed", "from_version": 1},
        },
    ),
    (
        "16-re-review-while-annotating",
        facts(
            open_translation_reviews=1,
            review_people=(ANA,),
            review_reason="correction",
            review_reason_text="Dosis prüfen",
            annotation_assignments=1,
            open_annotations=1,
            annotators_open=(TOM,),
        ),
        ("re_review", "running", "in_progress", "running", "none", "none"),
        {
            "review": {
                "people": (ANA,),
                "note": "correction",
                "reason": "Dosis prüfen",
            },
            "annotation": {"people": (TOM,), "version": 1, "note": "may_change"},
        },
    ),
]


@pytest.mark.parametrize(
    "f, expected, details",
    [pytest.param(f, e, d, id=i) for i, f, e, d in SCENARIOS],
)
def test_scenario_cells(
    f: StageFacts,
    expected: tuple[str, ...],
    details: dict[str, dict[str, Any]],
) -> None:
    c = cells(f)
    assert summary(c) == expected
    for cell_name, fields in details.items():
        detail = getattr(c, cell_name).detail
        for field, value in fields.items():
            assert getattr(detail, field) == value, (cell_name, field)


def test_scenario_table_steps() -> None:
    """The scenario facts give the next steps the table's Action column names."""
    first = {i: derive_steps(f.step) for i, f, _, _ in SCENARIOS}
    assert [s.code for s in first["1-de-undecided"]] == ["decide_plan"]
    assert first["1-en-source-not-planned"] == []
    assert first["2-check-failed"][0].code == "assign_translation_review"
    assert first["2-check-failed"][0].badges == ("check_failed",)
    assert first["4-de-rejected"][0].code == "resolve_rejected"
    assert first["4-fr-query"][0].code == "resolve_queried"
    assert first["5-corrected-unassigned"][0].code == "assign_annotation"
    assert first["7a-accept-result"][0].code == "choose_final"
    assert first["9-paused"][0].code == "decide_report"
    assert first["14-final-on-old-text"][0].code == "confirm_final"
    assert [s.code for s in first["16-re-review-while-annotating"]] == [
        "translation_review_in_progress",
        "annotation_in_progress",
    ]


def test_source_rows_show_source_in_review() -> None:
    for review, annotate, decided in itertools.product((False, True), repeat=3):
        f = facts(
            is_source=True,
            review=review,
            annotate=annotate,
            decided=decided,
            translation_statuses=(None,),
            accepted_how=None,
        )
        c = cells(f)
        assert (c.review.state, c.review.tone) == ("source", "none")


def test_not_in_plan_rows_without_final_are_none() -> None:
    for is_source in (False, True):
        c = cells(facts(review=False, annotate=False, is_source=is_source))
        expected_review = "source" if is_source else "not_planned"
        assert summary(c) == (
            expected_review,
            "none",
            "not_planned",
            "none",
            "none",
            "none",
        )


def test_not_in_plan_row_with_final_shows_final_not_exported() -> None:
    c = cells(
        facts(
            review=False,
            annotate=False,
            has_final=True,
            final_kind="round",
            final_author=ANA,
            final_round_ordinal=1,
            final_version=1,
        )
    )
    assert (c.final.state, c.final.tone) == ("final", "done")
    assert c.final.detail.note == "not_exported"
    assert c.final.detail.people == (ANA,)


def test_undecided_rows_show_undecided_in_review_and_annotation() -> None:
    c = cells(facts(review=False, annotate=False, decided=False))
    assert summary(c) == (
        "undecided",
        "undecided",
        "undecided",
        "undecided",
        "none",
        "none",
    )
    source = cells(facts(review=False, annotate=False, decided=False, is_source=True))
    assert summary(source) == (
        "source",
        "none",
        "undecided",
        "undecided",
        "none",
        "none",
    )


def test_check_failed_and_source_changed_use_decision_tone_with_assign_steps() -> None:
    f = facts(
        translation_statuses=("automatic_check_failed",),
        check_failed=True,
        accepted_how=None,
    )
    [assign, *_] = derive_steps(f.step)
    assert (assign.code, assign.kind) == ("assign_translation_review", "assign")
    c = cells(f)
    assert (c.review.state, c.review.tone) == ("check_failed", "decision")
    # Source changed: the cell's colour is decision; its step (rule 6a, kind
    # assign) arrives with O2a, so here only the cell is asserted.
    c = cells(facts(source_changed_from=1))
    assert (c.review.state, c.review.tone) == ("source_changed", "decision")
    assert c.review.detail.from_version == 1
    # An open review of the changed source shows the re-review instead.
    c = cells(
        facts(
            source_changed_from=1,
            open_translation_reviews=1,
            review_people=(ANA,),
            review_reason="source_changed",
        )
    )
    assert (c.review.state, c.review.detail.note) == ("re_review", "source_changed")
    assert c.review.detail.reason is None


def test_final_cell_before_decision() -> None:
    # VD19: no submission yet.
    c = cells(
        facts(annotation_assignments=1, open_annotations=1, annotators_open=(ANA,))
    )
    assert (c.final.state, c.final.tone) == ("none", "none")
    # From the first submission until the row is ready.
    c = cells(
        facts(
            per_text=2,
            annotation_assignments=2,
            open_annotations=1,
            annotators_open=(TOM,),
            annotators_submitted=(ANA,),
            submissions=1,
        )
    )
    assert (c.final.state, c.final.tone) == ("after_annotation", "waiting")
    # While an annotation review or a consolidation is open.
    for extra in (
        dict(open_annotation_reviews=1, annotation_reviewers=(LUC,)),
        dict(open_annotations=1, consolidators=(LUC,)),
    ):
        c = cells(
            facts(
                per_text=2,
                annotation_assignments=2,
                annotators_submitted=(ANA, TOM),
                submissions=2,
                **extra,
            )
        )
        assert (c.final.state, c.final.tone) == ("after_review", "waiting")
    c = cells(
        facts(
            per_text=2,
            annotation_assignments=2,
            open_annotations=1,
            annotators_submitted=(ANA, TOM),
            consolidators=(LUC,),
            submissions=2,
        )
    )
    assert (c.annotation.state, c.annotation.detail.people) == ("consolidating", (LUC,))
    # Confirm: a final with an unacknowledged cause on the newest version.
    c = cells(
        facts(
            annotation_assignments=1,
            annotators_submitted=(ANA,),
            has_final=True,
            unacknowledged_final_cause=True,
            final_causes=("SELECTED_NEWER_RESULT",),
            final_kind="round",
            final_author=ANA,
            final_round_ordinal=1,
            final_version=1,
        )
    )
    assert (c.final.state, c.final.tone) == ("confirm", "decision")
    assert c.final.detail.causes == ("SELECTED_NEWER_RESULT",)
    assert (c.final.detail.reason, c.final.detail.note) == (None, None)
    # A final kept on v1 with another cause than a text correction: confirm.
    c = cells(
        facts(
            newest_version=2,
            accepted_how="corrected",
            accepted_from_version=1,
            annotation_assignments=1,
            annotators_submitted=(ANA,),
            submissions=1,
            has_final=True,
            unacknowledged_final_cause=True,
            final_causes=("SELECTED_NEWER_RESULT",),
            final_kind="round",
            final_author=ANA,
            final_round_ordinal=1,
            final_version=1,
            final_on_newest=False,
        )
    )
    assert (c.final.state, c.final.tone) == ("confirm", "decision")
    assert c.final.detail.causes == ("SELECTED_NEWER_RESULT",)
    # The text correction among several causes makes it old_text.
    c = cells(
        facts(
            newest_version=2,
            has_final=True,
            unacknowledged_final_cause=True,
            final_causes=("SELECTED_NEWER_RESULT", "SELECTED_TEXT_CORRECTED"),
            final_kind="round",
            final_author=ANA,
            final_round_ordinal=1,
            final_version=1,
            final_on_newest=False,
        )
    )
    assert (c.final.state, c.final.detail.version) == ("old_text", 1)
    assert c.final.detail.note == "round"
    # A kept final on an older version names its version.
    c = cells(
        facts(
            has_final=True,
            final_kind="round",
            final_author=ANA,
            final_round_ordinal=1,
            final_version=1,
            final_on_newest=False,
            newest_version=2,
        )
    )
    assert (c.final.state, c.final.detail.version) == ("final", 1)


def test_parallel_roots_summarise() -> None:
    c = cells(
        facts(
            parallel_roots=True,
            translation_statuses=("ready_for_review", "ready_for_review"),
            newest_decisions=(None, None),
            open_translation_reviews=1,
            review_people=(ANA,),
            accepted_how=None,
        )
    )
    # "◐ 1 of 2 versions in review"
    assert (c.review.state, c.review.tone) == ("in_progress", "running")
    assert (c.review.detail.assigned, c.review.detail.total) == (1, 2)
    c = cells(
        facts(
            parallel_roots=True,
            translation_statuses=("accepted", "accepted"),
            newest_decisions=(None, None),
        )
    )
    assert c.review.state == "accepted"
    assert (c.review.detail.assigned, c.review.detail.total) == (2, 2)
    # Without parallel roots no counts.
    c = cells(facts())
    assert (c.review.detail.assigned, c.review.detail.total) == (None, None)


def test_correction_waiting_for_review_is_not_a_text_change() -> None:
    # Rule on, correction v2 ready_for_review: v2 is the target, no text change.
    c = cells(
        facts(
            translation_statuses=("ready_for_review",),
            accepted_how=None,
            newest_version=2,
            newest_origin="correction",
            correction_waiting=True,
            old_open=(OldItem(TOM, 1),),
        )
    )
    assert c.annotation.state not in (
        "old_text_open",
        "old_text_submitted",
        "finishing_on_old",
    )
    assert c.annotation.detail.note == "text_change_waiting"
    assert (c.review.state, c.review.tone) == ("unassigned", "todo")


def test_paused_translation_review_shows_in_review_cell() -> None:
    f = facts(
        annotate=False,
        translation_statuses=("ready_for_review",),
        accepted_how=None,
        open_translation_reviews=1,
        review_people=(ANA,),
        open_report_id="r1",
        paused_by=ANA,
        paused_excerpt="x" * 80,
        paused_task="translation_review",
    )
    steps = derive_steps(f.step)
    assert steps[0].code == "decide_report"
    assert step_cell(steps[0].code, f) == "review"
    c = stage_cells(f, steps)
    assert (c.review.state, c.review.tone) == ("paused", "decision")
    assert c.review.detail.people == (ANA,)
    # Cut at 60 characters, "…" marks the cut.
    assert c.review.detail.excerpt == "x" * 60 + "…"
    exact = stage_cells(dataclasses.replace(f, paused_excerpt="y" * 60), steps)
    assert exact.review.detail.excerpt == "y" * 60
    assert c.annotation.state == "not_planned"
    # The default for decide_report / resume_task is the annotation cell.
    assert STEP_CELL["decide_report"] == STEP_CELL["resume_task"] == "annotation"


@pytest.mark.parametrize(
    "f, expected, details",
    [
        pytest.param(
            # D15 reference scenario: de planned with review, machine translation.
            facts(
                translation_statuses=("translated",),
                accepted_how=None,
                newest_origin="machine_translation",
            ),
            ("unassigned", "todo", "after_review", "waiting", "none", "none"),
            {"review": {"note": "machine_translation", "version": 1}},
            id="D15",
        ),
        pytest.param(
            # D24: Annotate on, Review off, translation not accepted (rule on).
            facts(
                review=False, translation_statuses=("translated",), accepted_how=None
            ),
            ("not_accepted", "decision", "blocked", "waiting", "none", "none"),
            {
                "review": {"note": "review_off"},
                "annotation": {"note": "translation_not_accepted"},
            },
            id="D24",
        ),
        pytest.param(
            # D25: new review of an externally accepted translation.
            facts(
                accepted_how="external",
                open_translation_reviews=1,
                review_people=(LUC,),
                review_reason="new_review",
            ),
            ("re_review", "running", "unassigned", "todo", "none", "none"),
            {"review": {"note": "new_review", "reason": None, "people": (LUC,)}},
            id="D25",
        ),
        pytest.param(
            # D26: correction request on an accepted translation (Review turned on).
            facts(
                open_translation_reviews=1,
                review_people=(ANA,),
                review_reason="correction",
                annotation_assignments=1,
                annotators_submitted=(TOM,),
                missing_final=False,
                has_final=True,
                final_kind="round",
                final_author=TOM,
                final_round_ordinal=1,
                final_version=1,
            ),
            ("re_review", "running", "submitted", "done", "final", "done"),
            {"review": {"note": "correction"}},
            id="D26",
        ),
    ],
)
def test_d15_d24_d25_d26_rows(
    f: StageFacts,
    expected: tuple[str, ...],
    details: dict[str, dict[str, Any]],
) -> None:
    c = cells(f)
    assert summary(c) == expected
    for cell_name, fields in details.items():
        detail = getattr(c, cell_name).detail
        for field, value in fields.items():
            assert getattr(detail, field) == value, (cell_name, field)


def test_accepted_notes() -> None:
    notes = {
        how: cells(facts(accepted_how=how)).review.detail.note
        for how in ("unchanged", "corrected", "package", "external")
    }
    assert notes == {
        "unchanged": "unchanged",
        "corrected": "with_corrections",
        "package": "in_package",
        "external": "outside",
    }


def test_finishing_on_old_text_is_running() -> None:
    c = cells(
        facts(
            newest_version=2,
            accepted_how="corrected",
            accepted_from_version=1,
            annotation_assignments=1,
            finishing=(OldItem(TOM, 1, assignment_id=5),),
        )
    )
    assert (c.annotation.state, c.annotation.tone) == ("finishing_on_old", "running")
    assert c.annotation.detail.note == "carried_on_submit"
    assert c.annotation.detail.people == (TOM,)


def test_partly_assigned_lists_the_working_people() -> None:
    c = cells(
        facts(
            per_text=2,
            annotation_assignments=1,
            open_annotations=1,
            annotators_open=(TOM,),
        )
    )
    assert (c.annotation.state, c.annotation.tone) == ("partly_assigned", "todo")
    assert (c.annotation.detail.assigned, c.annotation.detail.target) == (1, 2)
    assert c.annotation.detail.people == (TOM,)


# One root per target status / newest decision class (keeps the product small).
_ROOTS = [
    (None, None),
    ("translated", None),
    ("automatic_check_failed", None),
    ("ready_for_review", "rejected"),
    ("reviewed", "rejected"),
    ("reviewed", "query"),
    ("accepted", None),
    ("accepted", "rejected"),
]


def _valid(f: StepFacts) -> bool:
    """Invariants the application guarantees (as in test_next_steps_domain)."""
    open_work = (
        f.open_translation_reviews or f.open_annotations or f.open_annotation_reviews
    )
    if f.is_source and (f.review or f.open_translation_reviews):
        return False
    if f.missing_final and (not f.annotate or f.has_final or open_work):
        return False
    if f.unacknowledged_final_cause and not (f.annotate and f.has_final):
        return False
    return not (
        f.annotate
        and not f.has_final
        and not open_work
        and f.annotation_assignments >= f.per_text
        and not f.missing_final
    )


_ACTIONABLE = {"decision", "todo", "undecided"}
# Cell states whose step arrives with O2a (rules 3a / 3b / 6a).
_O2A_STATES = {"source_changed", "old_text_open", "old_text_submitted"}


def test_every_lead_step_has_exactly_one_actionable_cell() -> None:
    """Each lead-owned step lands on an actionable cell, and each todo or
    undecided cell has a step that names it."""
    checked = reverse = 0
    item = (OldItem(TOM, 1),)
    for (
        review,
        annotate,
        is_source,
        rule_on,
        decided,
        per_text,
        held,
        paused_task,
        cause,
        root,
        open_reviews,
        assigned,
        open_work,
        missing_final,
        has_final,
        extra,
    ) in itertools.product(
        (False, True),
        (False, True),
        (False, True),
        (False, True),
        (False, True),
        (1, 2),
        (None, "report", "pause"),
        (None, "annotate", "translation_review"),
        (False, True),
        _ROOTS,
        (0, 1),
        (0, 1, 2),
        (None, "annotation", "annotation_review"),
        (False, True),
        (False, True),
        (None, "open", "submitted", "finishing", "source_changed", "waiting"),
    ):
        if is_source and root != _ROOTS[0]:
            continue  # one representative: sources ignore translation facts
        if not decided and (review or annotate):
            continue  # in-plan rows ignore the flag
        if (held is None) != (paused_task is None):
            continue  # a held task exactly when a report or pause is open
        if paused_task == "annotate" and not annotate:
            continue
        if paused_task == "translation_review" and (is_source or not open_reviews):
            continue  # a held translation review is an open one
        status, decision = (None, None) if is_source else root
        step = StepFacts(
            review=review,
            annotate=annotate,
            is_source=is_source,
            rule_on=rule_on,
            per_text=per_text,
            open_report_id="r1" if held == "report" else None,
            orphan_pause_assignment_id=7 if held == "pause" else None,
            unacknowledged_final_cause=cause,
            newest_decisions=(decision,),
            translation_statuses=(status,),
            open_translation_reviews=open_reviews,
            annotation_assignments=assigned,
            open_annotations=int(open_work == "annotation"),
            open_annotation_reviews=int(open_work == "annotation_review"),
            missing_final=missing_final,
            has_final=has_final,
            check_failed=status == "automatic_check_failed",
            decided=decided,
        )
        if not _valid(step):
            continue
        on_old = cause and extra == "submitted"
        f = StageFacts(
            step=step,
            paused_task=paused_task,
            old_open=item if extra == "open" else (),
            old_submitted=item if extra == "submitted" else (),
            finishing=item if extra == "finishing" else (),
            source_changed_from=(
                1 if extra == "source_changed" and not is_source else None
            ),
            correction_waiting=extra == "waiting",
            final_causes=(
                ("SELECTED_TEXT_CORRECTED",)
                if on_old
                else ("SELECTED_NEWER_RESULT",)
                if cause
                else ()
            ),
            final_on_newest=not on_old,
            submissions=1 if missing_final else 0,
            annotators_submitted=(ANA,) if missing_final else (),
        )
        steps = derive_steps(step)
        assert bool(steps) == (in_plan(step) or not decided), f
        c = stage_cells(f, steps)
        codes = {s.code for s in steps}
        for s in steps:
            if s.kind not in ("decision", "assign"):
                continue
            name = step_cell(s.code, f)
            if name is None:
                assert s.code == "needs_attention", (s, f)
                continue
            tone = getattr(c, name).tone
            # "rejected" carries the edge of a decision row ("rejected + edge"),
            # only for the row's resolve_rejected (an assign step of the same
            # rejected translation lands there too).
            assert tone in _ACTIONABLE or (
                tone == "rejected" and "resolve_rejected" in codes
            ), (s.code, name, c, f)
            checked += 1
        # Reverse: a todo cell is named by a step; an undecided cell (Review
        # and Annotation both show "not decided") by the row's decide_plan.
        named = {step_cell(s.code, f) for s in steps}
        for name in ("review", "annotation", "final"):
            cell = getattr(c, name)
            if cell.state in _O2A_STATES:
                continue
            if cell.tone == "todo":
                assert name in named, (name, cell, steps, f)
                reverse += 1
            elif cell.tone == "undecided":
                assert [s.code for s in steps] == ["decide_plan"], (name, cell, f)
                reverse += 1
    assert checked >= 500
    assert reverse >= 500


def test_step_cell_covers_every_step_code() -> None:
    from typing import get_args

    from ontocurator.domain.next_steps import StepCode

    assert set(STEP_CELL) == set(get_args(StepCode))
    assert STEP_CELL["decide_plan"] == "annotation"
    assert STEP_CELL["confirm_final"] == STEP_CELL["choose_final"] == "final"
    assert STEP_CELL["assign_translation_review"] == "review"
    assert STEP_CELL["assign_annotation"] == "annotation"


def test_module_imports_nothing_from_application_or_storage() -> None:
    source = Path(stage_cells_module.__file__).read_text(encoding="utf-8")
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.ImportFrom):
            module = node.module or ""
            assert "application" not in module and "storage" not in module
        elif isinstance(node, ast.Import):
            for alias in node.names:
                assert "application" not in alias.name and "storage" not in alias.name


def test_reviewer_needed_statuses_unchanged() -> None:
    # Guard: the property product relies on these statuses reaching rule 6.
    assert {"translated", "automatic_check_failed", "ready_for_review"} == set(
        REVIEWER_NEEDED_STATUSES
    )


def test_reviewed_translation_without_step_waits() -> None:
    # Reviewed, decision not yet in effect: no step names the Review cell.
    f = facts(
        translation_statuses=("reviewed",), newest_decisions=(None,), accepted_how=None
    )
    assert "assign_translation_review" not in {s.code for s in derive_steps(f.step)}
    c = cells(f)
    assert (c.review.state, c.review.tone) == ("in_progress", "waiting")


def test_annotation_counts_eligible_submissions() -> None:
    # Annotation and Final both count ``submissions``; the authors only name.
    c = cells(
        facts(
            per_text=2,
            annotation_assignments=2,
            open_annotations=1,
            annotators_open=(TOM,),
            annotators_submitted=(ANA,),
            submissions=0,
        )
    )
    assert (c.annotation.state, c.annotation.detail.submitted) == ("in_progress", 0)
    assert c.final.state == "none"
