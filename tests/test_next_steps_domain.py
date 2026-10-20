"""Next-step rules 1-11 and precedence (spec "Next step")."""

import pytest

from ontocurator.domain.next_steps import StepFacts, derive_steps, in_plan, segment_of


def facts(**kw):
    base = dict(
        review=False,
        annotate=False,
        is_source=False,
        rule_on=True,
        per_text=1,
        open_report_id=None,
        orphan_pause_assignment_id=None,
        unacknowledged_final_cause=False,
        newest_decisions=(None,),
        translation_statuses=("ready_for_review",),
        open_translation_reviews=0,
        annotation_assignments=0,
        open_annotations=0,
        open_annotation_reviews=0,
        missing_final=False,
        has_final=False,
        check_failed=False,
    )
    base.update(kw)
    return StepFacts(**base)


def codes(**kw):
    return [s.code for s in derive_steps(facts(**kw))]


def test_not_in_plan_has_no_step_and_in_plan_is_its_own_fact():
    assert not in_plan(facts()) and derive_steps(facts()) == []
    for kw in (
        dict(review=True),
        dict(annotate=True),
        dict(review=True, annotate=True),
    ):
        assert in_plan(facts(**kw)) and derive_steps(
            facts(**kw)
        )  # never [] while in plan


@pytest.mark.parametrize(
    "kw, first",
    [
        (dict(annotate=True, open_report_id="r1"), "decide_report"),
        (dict(annotate=True, orphan_pause_assignment_id=4), "resume_task"),
        (
            dict(annotate=True, has_final=True, unacknowledged_final_cause=True),
            "confirm_final",
        ),
        (
            dict(
                review=True,
                translation_statuses=("reviewed",),
                newest_decisions=("rejected",),
            ),
            "resolve_rejected",
        ),
        (
            dict(
                review=True,
                translation_statuses=("reviewed",),
                newest_decisions=("query",),
            ),
            "resolve_queried",
        ),
        (
            dict(annotate=True),
            "translation_not_accepted",
        ),  # rule 4a: rule on, review off, ready_for_review
        (
            dict(
                annotate=True,
                translation_statuses=("accepted",),
                annotation_assignments=1,
                missing_final=True,
            ),
            "choose_final",
        ),
        (dict(review=True), "assign_translation_review"),
        (
            dict(review=True, open_translation_reviews=1),
            "translation_review_in_progress",
        ),
        (dict(annotate=True, translation_statuses=("accepted",)), "assign_annotation"),
        (
            dict(
                annotate=True,
                translation_statuses=("accepted",),
                annotation_assignments=1,
                open_annotations=1,
            ),
            "annotation_in_progress",
        ),
        (
            dict(
                annotate=True,
                translation_statuses=("accepted",),
                annotation_assignments=1,
                open_annotation_reviews=1,
            ),
            "annotation_review_in_progress",
        ),
        (
            dict(review=True, annotate=True, open_translation_reviews=1),
            "translation_review_in_progress",
        ),
        (dict(review=True, translation_statuses=("accepted",)), "translation_accepted"),
        (
            dict(
                annotate=True,
                translation_statuses=("accepted",),
                annotation_assignments=1,
                has_final=True,
            ),
            "done",
        ),
    ],
)
def test_first_matching_rule_wins(kw, first):
    assert codes(**kw)[0] == first


def test_waiting_for_review_is_in_progress_and_counted_with_open_review_steps():
    steps = derive_steps(facts(review=True, annotate=True, open_translation_reviews=1))
    assert [s.code for s in steps] == [
        "translation_review_in_progress",
        "waiting_for_translation_review",
    ]
    assert {segment_of(s) for s in steps} == {"progress"}


def test_failed_check_without_reviewer_is_to_assign_with_badge():
    [step, *_] = derive_steps(
        facts(
            review=True,
            translation_statuses=("automatic_check_failed",),
            check_failed=True,
        )
    )
    assert step.code == "assign_translation_review" and "check_failed" in step.badges
    assert segment_of(step) == "assign"


def test_failed_check_with_open_review_is_never_a_decision():
    [step, *_] = derive_steps(
        facts(review=True, check_failed=True, open_translation_reviews=1)
    )
    assert segment_of(step) == "progress"


def test_rule_off_lets_annotation_start_before_acceptance():
    assert codes(review=True, annotate=True, rule_on=False)[:2] == [
        "assign_translation_review",
        "assign_annotation",
    ]


def test_annotate_without_review_on_unaccepted_translation_is_a_decision():
    f = facts(annotate=True)  # D24: rule on, review off, not accepted
    [step, *_] = derive_steps(f)
    assert in_plan(f) and (step.code, step.action) == (
        "translation_not_accepted",
        "accept_or_review",
    )
    assert segment_of(step) == "decision"
    assert codes(annotate=True, rule_on=False)[0] == "assign_annotation"
    assert (
        codes(annotate=True, open_translation_reviews=1)[0]
        == "translation_review_in_progress"
    )


def test_choose_final_waits_for_annotations_per_text():
    kw = dict(
        annotate=True,
        is_source=True,
        translation_statuses=(None,),
        per_text=2,
        annotation_assignments=1,
    )
    assert (
        codes(**kw, missing_final=True)[0] == "assign_annotation"
    )  # 1 of 2 submitted is not final-ready
    assert (
        codes(**{**kw, "annotation_assignments": 2}, missing_final=True)[0]
        == "choose_final"
    )


def test_two_annotations_per_text_counts_assigned():
    [step, *_] = derive_steps(
        facts(
            annotate=True,
            is_source=True,
            translation_statuses=(None,),
            per_text=2,
            annotation_assignments=1,
            open_annotations=1,
        )
    )
    assert (step.code, step.assigned, step.target) == ("assign_annotation", 1, 2)


def test_parallel_roots_use_each_newest_version():
    assert (
        codes(
            review=True,
            translation_statuses=("accepted", "ready_for_review"),
            newest_decisions=(None, None),
        )[0]
        == "assign_translation_review"
    )


def test_review_only_row_done_on_acceptance():
    [step] = derive_steps(facts(review=True, translation_statuses=("accepted",)))
    assert (step.code, step.kind, step.stage) == (
        "translation_accepted",
        "done",
        "done",
    )


def test_decision_badges_and_done_has_no_segment():
    [report] = [
        s
        for s in derive_steps(facts(annotate=True, open_report_id="r1"))
        if s.code == "decide_report"
    ]
    assert report.badges == ("your_decision",) and segment_of(report) == "decision"
    [paused, *_] = derive_steps(facts(annotate=True, orphan_pause_assignment_id=4))
    assert paused.badges == ("your_decision", "paused")
    [done] = derive_steps(facts(review=True, translation_statuses=("accepted",)))
    assert segment_of(done) is None


def test_source_row_ignores_translation_rules():
    steps = derive_steps(
        facts(annotate=True, is_source=True, translation_statuses=(None,))
    )
    assert [s.code for s in steps] == ["assign_annotation"]
    assert steps[0].stage == "annotation"
