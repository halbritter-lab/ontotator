"""Next step of a Documents row (spec "Concepts: Next step"), pure.

Rules 1-11 (with 4a) are checked in precedence order; ``derive_steps``
returns every matching rule, the first is the row's next step. "In plan"
(Review or Annotate on) is its own fact: a row in the plan always has at
least one step, a row outside it has none, except an undecided row (plan
written by the system under "Nothing planned", documents overview VD3),
whose only step is ``decide_plan`` (V10). Should no rule match an in-plan
row (an application invariant broke), the row gets the logged safety
fallback "needs_attention" instead of an error.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal

__all__ = [
    "NOT_ACCEPTED_DECISIONS",
    "REVIEWER_NEEDED_STATUSES",
    "OldItem",
    "RowAction",
    "Segment",
    "Stage",
    "Step",
    "StepCode",
    "StepFacts",
    "StepKind",
    "derive_steps",
    "in_plan",
    "row_stage",
    "segment_of",
]

StepCode = Literal[
    "decide_plan",
    "decide_report",
    "resume_task",
    "confirm_final",
    "resolve_rejected",
    "resolve_queried",
    "translation_not_accepted",
    "choose_final",
    "assign_translation_review",
    "translation_review_in_progress",
    "assign_annotation",
    "annotation_in_progress",
    "annotation_review_in_progress",
    "waiting_for_translation_review",
    "done",
    "translation_accepted",
    "needs_attention",
]
StepKind = Literal["decision", "assign", "in_progress", "done"]
Stage = Literal["translation_review", "annotation", "final", "done"]
Segment = Literal["decision", "assign", "progress"]
RowAction = Literal[
    "plan",
    "decide_report",
    "resume_task",
    "review_changes",
    "resolve",
    "accept_or_review",
    "choose_final",
    "assign_translation_review",
    "assign_annotation",
]
Badge = Literal["your_decision", "check_failed", "paused"]

# Rule 6: statuses of a translation that still needs a reviewer.
REVIEWER_NEEDED_STATUSES = frozenset(
    {"translated", "automatic_check_failed", "ready_for_review"}
)
logger = logging.getLogger(__name__)

# Rule 4: latest review decisions that leave a translation not accepted.
NOT_ACCEPTED_DECISIONS = frozenset({"rejected", "query"})

_SEGMENTS: dict[StepKind, Segment | None] = {
    "decision": "decision",
    "assign": "assign",
    "in_progress": "progress",
    "done": None,
}


@dataclass(frozen=True)
class OldItem:
    """Annotation work on an older text version (documents overview V5)."""

    user_id: int
    from_version: int
    assignment_id: int | None = None
    submission_id: str | None = None


@dataclass(frozen=True)
class StepFacts:
    review: bool
    annotate: bool
    is_source: bool
    rule_on: bool
    per_text: int
    open_report_id: str | None
    orphan_pause_assignment_id: int | None
    unacknowledged_final_cause: bool  # incl. PLAN_RESTORED
    # Rule 4: latest review decision of each live root's literal newest
    # version (``chain.newest``, corrections that are not newer included),
    # None unless that version's status is "reviewed".
    newest_decisions: tuple[str | None, ...]
    # Newest version status per root (Version.not_newer corrections skipped).
    translation_statuses: tuple[str | None, ...]
    open_translation_reviews: int
    # Non-revoked annotate assignments, minimum over the row's target versions.
    annotation_assignments: int
    open_annotations: int
    open_annotation_reviews: int
    # missing_final_counts(..., per_text=per_text), restricted to Annotate on.
    missing_final: bool
    has_final: bool
    check_failed: bool  # a newest version is automatic_check_failed
    # False: plan row system-written under "Nothing planned" (VD3).
    decided: bool = True


@dataclass(frozen=True)
class Step:
    code: StepCode
    kind: StepKind
    stage: Stage
    action: RowAction | None
    badges: tuple[Badge, ...]
    assigned: int | None = None
    target: int | None = None


def in_plan(facts: StepFacts) -> bool:
    """Review or Annotate on; the only source of "in plan"."""
    return facts.review or facts.annotate


def _accepted(facts: StepFacts) -> bool:
    """Every root's newest version is accepted; sources need no acceptance."""
    return facts.is_source or all(
        status == "accepted" for status in facts.translation_statuses
    )


def _may_annotate(facts: StepFacts) -> bool:
    return facts.is_source or not facts.rule_on or _accepted(facts)


def _final_ready(facts: StepFacts) -> bool:
    """Rule 5: missing-final rule and at least "Annotations per text" assigned."""
    return facts.missing_final and facts.annotation_assignments >= facts.per_text


def row_stage(facts: StepFacts) -> Stage:
    """Stage of the row (spec "Concepts: Stage")."""
    if facts.review and not _accepted(facts):
        return "translation_review"
    if facts.annotate:
        if not _may_annotate(facts):
            return "translation_review"
        if facts.has_final and not (
            facts.unacknowledged_final_cause
            or facts.open_annotations
            or facts.open_annotation_reviews
        ):
            return "done"
        if facts.has_final or _final_ready(facts):
            return "final"
        return "annotation"
    return "done"


def _decision(
    code: StepCode, stage: Stage, action: RowAction | None, *badges: Badge
) -> Step:
    return Step(code, "decision", stage, action, ("your_decision", *badges))


def derive_steps(facts: StepFacts, *, row: object = None) -> list[Step]:
    """Every matching rule in precedence order; [] only outside the plan.

    ``row`` (the row key) only names the row in the fallback's log line.
    """
    if not in_plan(facts):
        if facts.decided:
            return []
        stage: Stage = "annotation" if facts.is_source else "translation_review"
        return [_decision("decide_plan", stage, "plan")]
    translation = not facts.is_source
    accepted = _accepted(facts)
    open_review = facts.open_translation_reviews > 0
    stage = row_stage(facts)
    steps: list[Step] = []
    # 1-2: problem report, pause without report.
    if facts.open_report_id is not None:
        steps.append(_decision("decide_report", stage, "decide_report"))
    if facts.orphan_pause_assignment_id is not None:
        steps.append(_decision("resume_task", stage, "resume_task", "paused"))
    # 3: unacknowledged cause on the final result (incl. PLAN_RESTORED).
    if facts.annotate and facts.has_final and facts.unacknowledged_final_cause:
        steps.append(_decision("confirm_final", "final", "review_changes"))
    # 4: rejected or queried translation without an open review.
    if facts.review and translation and not open_review:
        reviewed = [
            decision
            for decision in facts.newest_decisions
            if decision in NOT_ACCEPTED_DECISIONS
        ]
        if reviewed:
            code: StepCode = (
                "resolve_rejected" if "rejected" in reviewed else "resolve_queried"
            )
            steps.append(_decision(code, "translation_review", "resolve"))
    # 4a (D24): Annotate without Review on a translation that is not accepted.
    if (
        facts.annotate
        and not facts.review
        and facts.rule_on
        and translation
        and not accepted
        and not open_review
    ):
        steps.append(
            _decision(
                "translation_not_accepted", "translation_review", "accept_or_review"
            )
        )
    # 5: all annotation work submitted, enough annotations, no final yet.
    if facts.annotate and _final_ready(facts):
        steps.append(_decision("choose_final", "final", "choose_final"))
    # 6: translation needs a reviewer (D4: a failed check carries a badge).
    if (
        facts.review
        and translation
        and not open_review
        and any(
            status in REVIEWER_NEEDED_STATUSES or status is None
            for status in facts.translation_statuses
        )
    ):
        steps.append(
            Step(
                "assign_translation_review",
                "assign",
                "translation_review",
                "assign_translation_review",
                ("check_failed",) if facts.check_failed else (),
            )
        )
    # 7: translation review open.
    if open_review:
        steps.append(
            Step(
                "translation_review_in_progress",
                "in_progress",
                "translation_review",
                None,
                (),
            )
        )
    # 8: annotation stage with fewer assignments than "Annotations per text".
    if (
        facts.annotate
        and _may_annotate(facts)
        and not facts.has_final
        and facts.annotation_assignments < facts.per_text
    ):
        counted = facts.per_text > 1
        steps.append(
            Step(
                "assign_annotation",
                "assign",
                "annotation",
                "assign_annotation",
                (),
                assigned=facts.annotation_assignments if counted else None,
                target=facts.per_text if counted else None,
            )
        )
    # 9: annotation or optional annotation review open.
    if facts.open_annotations:
        steps.append(
            Step("annotation_in_progress", "in_progress", "annotation", None, ())
        )
    if facts.open_annotation_reviews:
        steps.append(
            Step("annotation_review_in_progress", "in_progress", "annotation", None, ())
        )
    # 10: waiting for the translation review before annotation may start.
    if (
        facts.annotate
        and facts.review
        and facts.rule_on
        and translation
        and not accepted
    ):
        steps.append(
            Step(
                "waiting_for_translation_review",
                "in_progress",
                "translation_review",
                None,
                (),
            )
        )
    if steps:
        return steps
    # 11: done ("Translation accepted" for review-only rows).
    if facts.annotate and facts.has_final:
        return [Step("done", "done", "done", None, ())]
    if not facts.annotate and accepted:
        return [Step("translation_accepted", "done", "done", None, ())]
    # Safety fallback: should never appear (spec "Next step").
    logger.warning("no next step for in-plan row %r: %r", row, facts)
    return [_decision("needs_attention", stage, None)]


def segment_of(step: Step) -> Segment | None:
    """Bar segment: decision (decide_plan, rules 1-5, 4a, fallback), assign
    (6, 8), progress (7, 9, 10)."""
    return _SEGMENTS[step.kind]
