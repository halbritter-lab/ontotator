"""Next-step rules 1-11 and precedence (spec "Next step")."""

import itertools
import logging
from dataclasses import replace

import pytest

from ontotator.domain.next_steps import (
    REVIEWER_NEEDED_STATUSES,
    OldItem,
    StepFacts,
    _final_ready,
    derive_steps,
    in_plan,
    row_stage,
    segment_of,
    translations_accepted,
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


def test_choose_final_does_not_wait_for_annotations_per_text():
    # Issue #123: "Annotations per text" is an upper limit. One of two
    # planned annotations submitted, nothing open: the lead may decide now
    # (choose_final first) or still assign the second annotator.
    kw = dict(
        annotate=True,
        is_source=True,
        translation_statuses=(None,),
        per_text=2,
        annotation_assignments=1,
    )
    assert codes(**kw, missing_final=True)[:2] == ["choose_final", "assign_annotation"]
    assert row_stage(facts(**kw, missing_final=True)) == "final"
    assert codes(**{**kw, "annotation_assignments": 2}, missing_final=True) == [
        "choose_final"
    ]


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


def test_translations_accepted_needs_every_root():
    assert translations_accepted(True, ("ready_for_review",))
    assert not translations_accepted(False, ("accepted", "ready_for_review"))
    assert translations_accepted(False, ("accepted", "accepted"))


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
    with caplog.at_level(logging.WARNING, logger="ontotator.domain.next_steps"):
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
    open_work = f.open_translation_reviews or f.open_annotations
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


def test_undecided_row_gets_decide_plan_only():
    translation = derive_steps(facts(decided=False))
    assert [(s.code, s.kind, s.stage, s.action, s.badges) for s in translation] == [
        ("decide_plan", "decision", "translation_review", "plan", ("your_decision",))
    ]
    [source] = derive_steps(facts(decided=False, is_source=True))
    assert (source.code, source.stage) == ("decide_plan", "annotation")
    # Precedes every other rule: facts that would match rules 1-3 change nothing.
    busy = facts(
        decided=False,
        open_report_id="r1",
        orphan_pause_assignment_id=4,
        has_final=True,
        unacknowledged_final_cause=True,
    )
    assert [s.code for s in derive_steps(busy)] == ["decide_plan"]
    # An in-plan row is decided by definition: the flag is ignored there.
    assert "decide_plan" not in codes(annotate=True, decided=False, is_source=True)


def test_decided_not_in_plan_row_has_no_step():
    assert derive_steps(facts(decided=True)) == []
    assert derive_steps(facts()) == []  # decided defaults to True


def test_decide_plan_segment_is_decision():
    [step] = derive_steps(facts(decided=False))
    assert segment_of(step) == "decision"


# --- Text changes after annotation (documents overview V5, VD22) ----------- #

TOM, ANA, LUC = 11, 12, 13


def _annotating(**kw):
    """An accepted translation in the annotation stage, Annotate on."""
    base = dict(review=True, annotate=True, translation_statuses=("accepted",))
    base.update(kw)
    return facts(**base)


def test_rule_3a_open_old_version_work():
    item = OldItem(TOM, 1, assignment_id=41)
    steps = derive_steps(
        _annotating(open_annotations=1, old_open=(item,), pending_old_people=1)
    )
    first = steps[0]
    assert (first.code, first.kind, first.stage, first.action) == (
        "handle_text_change",
        "decision",
        "annotation",
        "handle_text_change",
    )
    assert first.badges == ("your_decision",)
    assert first.assignment_id == 41 and first.submission_id is None
    assert "assign_annotation" not in {s.code for s in steps}
    assert segment_of(first) == "decision"
    # The target must be annotatable (rule on, translation not accepted).
    not_accepted = _annotating(
        translation_statuses=("ready_for_review",), old_open=(item,)
    )
    assert "handle_text_change" not in {s.code for s in derive_steps(not_accepted)}


def test_rule_3a_skipped_when_held_or_finish_then_carry():
    # The caller leaves held and finish_then_carry items out of old_open: a
    # held one is decided through its report (rule 1), a finishing one is in
    # progress (rule 9).
    item = OldItem(TOM, 1, assignment_id=41)
    held = derive_steps(
        _annotating(open_annotations=1, open_report_id="r1", pending_old_people=1)
    )
    assert [s.code for s in held][:1] == ["decide_report"]
    assert "handle_text_change" not in {s.code for s in held}
    assert "assign_annotation" not in {s.code for s in held}
    finishing = derive_steps(
        _annotating(open_annotations=1, finishing=(item,), pending_old_people=1)
    )
    assert [s.code for s in finishing] == ["annotation_in_progress"]


def test_rule_3b_submitted_on_old_version_without_target_assignment():
    item = OldItem(ANA, 1, submission_id="sub-1")
    steps = derive_steps(_annotating(old_submitted=(item,), pending_old_people=1))
    assert [s.code for s in steps] == ["carry_text_change"]
    (step,) = steps
    assert (step.kind, step.stage, step.action) == (
        "decision",
        "annotation",
        "carry_text_change",
    )
    assert step.submission_id == "sub-1" and step.assignment_id is None


def test_rule_3b_needs_no_final_and_no_resolution():
    item = OldItem(ANA, 1, submission_id="sub-1")
    # A final on the row: the final's own cause (rule 3) decides instead.
    with_final = derive_steps(
        _annotating(old_submitted=(item,), has_final=True, pending_old_people=1)
    )
    assert "carry_text_change" not in {s.code for s in with_final}
    # A carried or dismissed submission is no item (the caller filters):
    # nothing waits, so rule 8 asks for an annotation of v2 again.
    assert codes(review=True, annotate=True, translation_statuses=("accepted",)) == [
        "assign_annotation"
    ]


def test_rule_6a_source_change_is_assign_with_badge():
    steps = derive_steps(
        facts(review=True, source_changed=True, translation_statuses=("accepted",))
    )
    assert [s.code for s in steps] == ["review_source_change"]
    (step,) = steps
    assert (step.kind, step.stage, step.action, step.badges) == (
        "assign",
        "translation_review",
        "assign_source_review",
        ("source_changed",),
    )
    assert segment_of(step) == "assign"
    # Review off, Annotate on: the source change still asks for a review.
    assert "review_source_change" in codes(
        annotate=True, source_changed=True, translation_statuses=("accepted",)
    )
    # An open translation review resolves it: no step, the review runs.
    assert codes(
        review=True,
        source_changed=True,
        translation_statuses=("accepted",),
        open_translation_reviews=1,
    ) == ["translation_review_in_progress"]
    # Sources have no translation review.
    assert "review_source_change" not in codes(
        annotate=True, is_source=True, source_changed=True, translation_statuses=(None,)
    )
    # Rule 6 already assigns the review of a not-yet-reviewed translation.
    both = codes(review=True, source_changed=True, translation_statuses=("translated",))
    assert both == ["assign_translation_review"]
    # Review off: rule 6 does not apply, 6a does.
    assert "review_source_change" in codes(
        annotate=True,
        rule_on=False,
        source_changed=True,
        translation_statuses=("translated",),
    )


def test_precedence_3_3a_3b_4():
    steps = derive_steps(
        facts(
            review=True,
            annotate=True,
            rule_on=False,
            translation_statuses=("reviewed",),
            newest_decisions=("rejected",),
            has_final=True,
            unacknowledged_final_cause=True,
            open_annotations=1,
            old_open=(OldItem(TOM, 1, assignment_id=41),),
            pending_old_people=1,
        )
    )
    assert [s.code for s in steps][:3] == [
        "confirm_final",
        "handle_text_change",
        "resolve_rejected",
    ]
    steps = derive_steps(
        facts(
            review=True,
            annotate=True,
            rule_on=False,
            translation_statuses=("reviewed",),
            newest_decisions=("rejected",),
            open_annotations=1,
            old_open=(OldItem(TOM, 1, assignment_id=41),),
            old_submitted=(OldItem(ANA, 1, submission_id="s1"),),
            pending_old_people=2,
        )
    )
    assert [s.code for s in steps][:3] == [
        "handle_text_change",
        "carry_text_change",
        "resolve_rejected",
    ]


def test_rule_8_counts_pending_old_people():
    # Per text 2: Luc's v1 work was moved (he holds a v2 assignment now), Tom
    # submitted on v1 and waits for the carry: 1 + 1 pending = 2, nothing to
    # assign.
    f = _annotating(
        per_text=2,
        annotation_assignments=1,
        open_annotations=1,
        old_submitted=(OldItem(TOM, 1, submission_id="s-tom"),),
        pending_old_people=1,
    )
    assert "assign_annotation" not in {s.code for s in derive_steps(f)}
    # Without the pending person one slot is free again.
    f = _annotating(per_text=2, annotation_assignments=1, open_annotations=1)
    (assign,) = [s for s in derive_steps(f) if s.code == "assign_annotation"]
    assert (assign.assigned, assign.target) == (1, 2)


def test_pending_old_people_only_affects_rule_8():
    for kw in (
        dict(missing_final=True, annotation_assignments=1),
        dict(missing_final=True, annotation_assignments=2, per_text=2),
        dict(has_final=True, annotation_assignments=1),
        dict(annotation_assignments=0, open_annotations=1),
    ):
        base = _annotating(**kw)
        pending = replace(base, pending_old_people=1)
        assert _final_ready(base) == _final_ready(pending)
        assert row_stage(base) == row_stage(pending)
        drop = {"assign_annotation"}
        assert [s.code for s in derive_steps(base) if s.code not in drop] == [
            s.code for s in derive_steps(pending) if s.code not in drop
        ]
    # choose_final (rule 5) needs no quorum (issue #123): per text 2 with one
    # assignment is ready next to Tom's pending carry.
    f = _annotating(
        missing_final=True,
        annotation_assignments=1,
        per_text=2,
        old_submitted=(OldItem(TOM, 1, submission_id="s-tom"),),
        pending_old_people=1,
    )
    assert [s.code for s in derive_steps(f)] == ["carry_text_change", "choose_final"]


def test_rule_9_finishing_is_in_progress():
    item = OldItem(TOM, 1, assignment_id=41)
    # Even without open_annotations the finishing item is in progress.
    steps = derive_steps(_annotating(finishing=(item,), pending_old_people=1))
    assert [s.code for s in steps] == ["annotation_in_progress"]
    assert segment_of(steps[0]) == "progress"


def test_one_step_per_old_work_item():
    items = (OldItem(TOM, 1, assignment_id=41), OldItem(LUC, 1, assignment_id=44))
    steps = derive_steps(
        _annotating(open_annotations=2, old_open=items, pending_old_people=2)
    )
    handle = [s for s in steps if s.code == "handle_text_change"]
    assert [s.assignment_id for s in handle] == [41, 44]
    assert steps[:2] == handle
    submitted = (
        OldItem(ANA, 1, submission_id="s-ana"),
        OldItem(TOM, 1, submission_id="s-tom"),
    )
    carry = [
        s
        for s in derive_steps(
            _annotating(old_submitted=submitted, pending_old_people=2)
        )
        if s.code == "carry_text_change"
    ]
    assert [s.submission_id for s in carry] == ["s-ana", "s-tom"]


def test_open_consolidation_is_its_own_in_progress_step():
    # D1: the consolidator's task replaces the annotation review step; the
    # row never falls back to "needs attention" while a consolidation runs.
    f = facts(
        annotate=True,
        translation_statuses=("accepted",),
        per_text=2,
        annotation_assignments=2,
        open_consolidations=1,
    )
    steps = derive_steps(f)
    assert [(s.code, s.kind, s.stage) for s in steps] == [
        ("consolidation_in_progress", "in_progress", "final")
    ]
    assert row_stage(f) == "final"
    assert row_stage(replace(f, has_final=True)) == "final"
