"""Next-step rules 1-11 and precedence (spec "Next step")."""

import itertools
import logging

import pytest

from ontocurator.domain.next_steps import (
    REVIEWER_NEEDED_STATUSES,
    StepFacts,
    derive_steps,
    in_plan,
    segment_of,
)


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


def test_rejected_correction_of_accepted_corrected_version_is_resolve_rejected():
    # The target (v1, accepted_corrected, status reviewed) skips its rejected
    # correction; rule 4 reads the literal newest version's decision.
    assert (
        codes(
            review=True,
            translation_statuses=("reviewed",),
            newest_decisions=("rejected",),
        )[0]
        == "resolve_rejected"
    )
    # An accepted target with a queried newest correction is resolved too.
    assert (
        codes(
            review=True,
            translation_statuses=("accepted",),
            newest_decisions=("query",),
        )[0]
        == "resolve_queried"
    )


def test_unmatched_in_plan_row_gets_logged_needs_attention_fallback(caplog):
    # Violates the missing-final invariant: everything submitted, no final.
    broken = facts(
        annotate=True,
        translation_statuses=("accepted",),
        annotation_assignments=1,
    )
    with caplog.at_level(logging.WARNING, logger="ontocurator.domain.next_steps"):
        [step] = derive_steps(broken, row=("c1", "de"))
    assert (step.code, step.kind, step.action) == ("needs_attention", "decision", None)
    assert step.badges == ("your_decision",)
    assert segment_of(step) == "decision"
    assert "('c1', 'de')" in caplog.text and "StepFacts(" in caplog.text


_STATUSES = (
    None,
    "translated",
    "automatic_check_failed",
    "ready_for_review",
    "reviewed",
    "accepted",
)
# (target status, decision of the literal newest version); a target with
# status "reviewed" is itself rejected/queried or skips a rejected/queried
# correction, so its newest decision is never None.
_ROOTS = [
    (status, decision)
    for status in _STATUSES
    for decision in (None, "rejected", "query")
    if status != "reviewed" or decision is not None
]

# Representative roots for two parallel roots (keeps the product small).
_PARALLEL = [
    (None, None),
    ("ready_for_review", None),
    ("automatic_check_failed", None),
    ("reviewed", "rejected"),
    ("reviewed", "query"),
    ("accepted", None),
    ("accepted", "rejected"),
]


def _valid(f: StepFacts) -> bool:
    """Invariants the application guarantees when it builds StepFacts."""
    open_work = (
        f.open_translation_reviews or f.open_annotations or f.open_annotation_reviews
    )
    if f.is_source and (f.review or f.open_translation_reviews):
        return False
    if f.missing_final and (not f.annotate or f.has_final or open_work):
        return False
    if f.unacknowledged_final_cause and not (f.annotate and f.has_final):
        return False
    # All work submitted and enough annotations on every target: the
    # missing-final rule holds (same live scope as the step facts).
    return not (
        f.annotate
        and not f.has_final
        and not open_work
        and f.annotation_assignments >= f.per_text
        and not f.missing_final
    )


def test_needs_attention_never_appears_for_valid_facts():
    checked = 0
    for (
        review,
        annotate,
        is_source,
        rule_on,
        per_text,
        report,
        pause,
        cause,
        roots,
        open_reviews,
        assigned,
        open_annotations,
        open_annotation_reviews,
        missing_final,
        has_final,
    ) in itertools.product(
        (False, True),
        (False, True),
        (False, True),
        (False, True),
        (1, 2),
        (None, "r1"),
        (None, 7),
        (False, True),
        [(root,) for root in _ROOTS] + list(itertools.combinations(_PARALLEL, 2)),
        (0, 1),
        (0, 1, 2),
        (0, 1),
        (0, 1),
        (False, True),
        (False, True),
    ):
        statuses = (None,) if is_source else tuple(s for s, _ in roots)
        decisions = (None,) if is_source else tuple(d for _, d in roots)
        if is_source and roots != (_ROOTS[0],):
            continue  # one representative: sources ignore translation facts
        f = StepFacts(
            review=review,
            annotate=annotate,
            is_source=is_source,
            rule_on=rule_on,
            per_text=per_text,
            open_report_id=report,
            orphan_pause_assignment_id=pause,
            unacknowledged_final_cause=cause,
            newest_decisions=decisions,
            translation_statuses=statuses,
            open_translation_reviews=open_reviews,
            annotation_assignments=assigned,
            open_annotations=open_annotations,
            open_annotation_reviews=open_annotation_reviews,
            missing_final=missing_final,
            has_final=has_final,
            check_failed=any(
                s == "automatic_check_failed"
                for s in statuses
                if s in REVIEWER_NEEDED_STATUSES
            ),
        )
        if not _valid(f):
            continue
        steps = derive_steps(f)
        assert bool(steps) == in_plan(f), f
        assert all(step.code != "needs_attention" for step in steps), f
        checked += 1
    assert checked > 10_000
