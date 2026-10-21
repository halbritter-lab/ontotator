"""Stage cells Review, Annotation and Final of a Documents row, pure.

Documents overview spec "Stage cells": each cell is a state, a tone (the
colour family; the frontend never derives colour from the step kind) and a
detail for the muted second line. ``stage_cells`` reads the row's facts and
the steps ``derive_steps`` returned for them, so a lead-owned step always
lands on a cell in an actionable tone (``STEP_CELL`` / ``step_cell`` name it).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from ontocurator.domain.next_steps import (
    OldItem,
    Step,
    StepCode,
    StepFacts,
    in_plan,
)

__all__ = [
    "PAUSED_EXCERPT_LENGTH",
    "STEP_CELL",
    "AnnotationState",
    "CellDetail",
    "CellName",
    "CellNote",
    "FinalState",
    "OldItem",
    "ReviewState",
    "StageCell",
    "StageCells",
    "StageFacts",
    "Tone",
    "stage_cells",
    "step_cell",
]

Tone = Literal[
    "none", "undecided", "waiting", "todo", "running", "decision", "rejected", "done"
]
ReviewState = Literal[
    "source",
    "not_planned",
    "undecided",
    "unassigned",
    "check_failed",
    "in_progress",
    "re_review",
    "paused",
    "rejected",
    "query",
    "not_accepted",
    "source_changed",
    "accepted",
]
AnnotationState = Literal[
    "not_planned",
    "undecided",
    "after_review",
    "blocked",
    "unassigned",
    "partly_assigned",
    "in_progress",
    "paused",
    "in_review",
    "consolidating",
    "old_text_open",
    "old_text_submitted",
    "finishing_on_old",
    "submitted",
]
FinalState = Literal[
    "none",
    "after_annotation",
    "after_review",
    "choose",
    "confirm",
    "old_text",
    "may_be_outdated",
    "final",
]
CellNote = Literal[
    "machine_translation",
    "review_only",
    "translation_rejected",
    "translation_queried",
    "translation_not_accepted",
    "unchanged",
    "with_corrections",
    "in_package",
    "outside",
    "review_off",
    "text_change_waiting",
    "may_change",
    "not_exported",
    "carried_on_submit",
    "v2_not_annotated",
]
CellName = Literal["review", "annotation", "final"]

# Spec: the paused cell quotes at most 60 characters of the report.
PAUSED_EXCERPT_LENGTH = 60

_ACCEPTED_NOTES: Mapping[str, CellNote] = {
    "unchanged": "unchanged",
    "corrected": "with_corrections",
    "package": "in_package",
    "external": "outside",
}


@dataclass(frozen=True)
class StageFacts:
    step: StepFacts
    decided: bool = True
    review_people: tuple[int, ...] = ()  # open translation review(s)
    review_reason: Literal["correction", "new_review", "source_changed"] | None = None
    review_decided_by: int | None = None  # latest decision on the newest version
    review_decided_at: datetime | None = None
    accepted_how: Literal["unchanged", "corrected", "package", "external"] | None = None
    accepted_from_version: int | None = None  # "v1 → v2" when corrected
    newest_version: int = 1
    newest_origin: str | None = None  # VariantOrigin of the target
    annotators_open: tuple[int, ...] = ()  # on the target(s), not held
    annotators_submitted: tuple[int, ...] = ()  # on the target(s)
    round_ordinal: int | None = None  # the one open round, if exactly one
    findings: int | None = None  # finding_count when exactly one submission
    annotation_reviewers: tuple[int, ...] = ()
    consolidators: tuple[int, ...] = ()
    paused_by: int | None = None  # reporter of the open report
    paused_excerpt: str | None = None  # ≤ 60 characters
    paused_task: Literal["annotate", "translation_review"] | None = None
    old_open: tuple[OldItem, ...] = ()  # rule 3a items (O2a fills)
    old_submitted: tuple[OldItem, ...] = ()  # rule 3b items (O2a fills)
    finishing: tuple[OldItem, ...] = ()  # finish_then_carry items (O2a fills)
    source_changed_from: int | None = (
        None  # source version of an unreviewed source change (O2a fills)
    )
    correction_waiting: bool = False  # correction ready_for_review, rule on (edge case)
    final_causes: tuple[str, ...] = ()  # unacknowledged cause codes
    final_kind: Literal["round", "consolidation"] | None = None
    final_author: int | None = None
    final_round_ordinal: int | None = None
    final_version: int | None = None
    final_on_newest: bool = True
    submissions: int = 0  # eligible submissions (Final "n submissions"): on the target version only, without
    # sources whose text-change resolution is carried, moved or handed_over (spec VD16)
    parallel_roots: bool = False


@dataclass(frozen=True)
class CellDetail:
    people: tuple[int, ...] = ()
    assigned: int | None = None
    target: int | None = None
    submitted: int | None = None
    total: int | None = None
    version: int | None = None
    from_version: int | None = None
    at: datetime | None = None
    findings: int | None = None
    excerpt: str | None = None
    reason: str | None = None
    note: CellNote | None = None
    matching: int | None = None  # Final "4 of 6 match" (O3b fills for shown rows)
    compared: int | None = None
    # "Round 2" (Annotation in progress) / "Round 1 · Ana Weber" (Final).
    round_ordinal: int | None = None


@dataclass(frozen=True)
class StageCell:
    state: str  # ReviewState | AnnotationState | FinalState
    tone: Tone
    detail: CellDetail


@dataclass(frozen=True)
class StageCells:
    review: StageCell
    annotation: StageCell
    final: StageCell


# The cell a step's action belongs to. decide_report / resume_task name the
# annotation cell by default; ``step_cell`` moves them to Review when the held
# task is a translation review.
STEP_CELL: Mapping[StepCode, CellName | None] = {
    "decide_plan": "annotation",
    "decide_report": "annotation",
    "resume_task": "annotation",
    "confirm_final": "final",
    "resolve_rejected": "review",
    "resolve_queried": "review",
    "translation_not_accepted": "review",
    "choose_final": "final",
    "assign_translation_review": "review",
    "translation_review_in_progress": "review",
    "assign_annotation": "annotation",
    "annotation_in_progress": "annotation",
    "annotation_review_in_progress": "annotation",
    "waiting_for_translation_review": "annotation",
    "done": None,
    "translation_accepted": None,
    "needs_attention": None,
}

_HELD_CODES = frozenset({"decide_report", "resume_task"})


def _held_cell(facts: StageFacts) -> CellName:
    """Cell of the task held by an open report or a pause."""
    if facts.paused_task == "translation_review":
        return "review"
    if facts.paused_task == "annotate" or facts.step.annotate:
        return "annotation"
    return "review"


def step_cell(code: StepCode, facts: StageFacts) -> CellName | None:
    """The one cell that carries the action of a step with this code."""
    if code in _HELD_CODES:
        return _held_cell(facts)
    return STEP_CELL[code]


def _cell(state: str, tone: Tone, **detail: Any) -> StageCell:
    return StageCell(state, tone, CellDetail(**detail))


def _held(facts: StageFacts) -> bool:
    step = facts.step
    return (
        step.open_report_id is not None or step.orphan_pause_assignment_id is not None
    )


def _paused(facts: StageFacts) -> StageCell:
    excerpt = facts.paused_excerpt
    return _cell(
        "paused",
        "decision",
        people=() if facts.paused_by is None else (facts.paused_by,),
        excerpt=None if excerpt is None else excerpt[:PAUSED_EXCERPT_LENGTH],
    )


def _undecided(facts: StageFacts) -> bool:
    return not in_plan(facts.step) and not (facts.decided and facts.step.decided)


def _accepted(step: StepFacts) -> bool:
    return step.is_source or all(s == "accepted" for s in step.translation_statuses)


def _may_annotate(step: StepFacts) -> bool:
    return step.is_source or not step.rule_on or _accepted(step)


def _roots(facts: StageFacts, count: int) -> dict[str, Any]:
    """Parallel roots: "{assigned} of {total} versions …" (spec edge case)."""
    if not facts.parallel_roots:
        return {}
    total = len(facts.step.translation_statuses)
    return {"assigned": min(count, total), "total": total}


def _review(facts: StageFacts, codes: frozenset[str]) -> StageCell:
    step = facts.step
    if step.is_source:
        return _cell("source", "none")
    if _undecided(facts):
        return _cell("undecided", "undecided")
    if not in_plan(step):
        return _cell("not_planned", "none")
    if _held(facts) and _held_cell(facts) == "review":
        return _paused(facts)
    if step.open_translation_reviews or facts.review_people:
        roots = _roots(facts, step.open_translation_reviews)
        people = facts.review_people
        if facts.review_reason is not None:
            return _cell(
                "re_review",
                "running",
                people=people,
                reason=facts.review_reason,
                **roots,
            )
        return _cell("in_progress", "running", people=people, **roots)
    decided_by = () if facts.review_decided_by is None else (facts.review_decided_by,)
    if "resolve_rejected" in codes or "resolve_queried" in codes:
        rejected = "resolve_rejected" in codes
        return _cell(
            "rejected" if rejected else "query",
            "rejected" if rejected else "decision",
            people=decided_by,
            at=facts.review_decided_at,
        )
    if "translation_not_accepted" in codes:
        return _cell("not_accepted", "decision", note="review_off")
    if facts.source_changed_from is not None:
        return _cell(
            "source_changed", "decision", from_version=facts.source_changed_from
        )
    if "assign_translation_review" in codes:
        if step.check_failed:
            return _cell("check_failed", "decision", version=facts.newest_version)
        return _cell(
            "unassigned",
            "todo",
            version=facts.newest_version,
            note=(
                "machine_translation"
                if facts.newest_origin == "machine_translation"
                else None
            ),
        )
    if _accepted(step):
        accepted = sum(1 for s in step.translation_statuses if s == "accepted")
        how = facts.accepted_how
        corrected = how == "corrected"
        return _cell(
            "accepted",
            "done",
            note=_ACCEPTED_NOTES.get(how) if how is not None else None,
            people=decided_by if corrected else (),
            from_version=facts.accepted_from_version if corrected else None,
            version=facts.newest_version if corrected else None,
            **_roots(facts, accepted),
        )
    if not step.review:
        return _cell("not_planned", "none")
    # Review on, not accepted and no rule matched (e.g. reviewed and waiting
    # for its effect): the lead still has to assign a reviewer.
    return _cell("unassigned", "todo", version=facts.newest_version)


def _annotation(facts: StageFacts, codes: frozenset[str]) -> StageCell:
    step = facts.step
    if _undecided(facts):
        return _cell("undecided", "undecided")
    if not step.annotate:
        return _cell("not_planned", "none", note="review_only" if step.review else None)
    if _held(facts) and _held_cell(facts) == "annotation":
        return _paused(facts)
    waiting_note: dict[str, Any] = (
        {"note": "text_change_waiting"} if facts.correction_waiting else {}
    )
    if not _may_annotate(step):
        if "resolve_rejected" in codes:
            return _cell("blocked", "waiting", note="translation_rejected")
        if "resolve_queried" in codes:
            return _cell("blocked", "waiting", note="translation_queried")
        if "translation_not_accepted" in codes:
            return _cell("blocked", "waiting", note="translation_not_accepted")
        return _cell("after_review", "waiting", **waiting_note)
    newest = facts.newest_version
    if not facts.correction_waiting:
        if facts.old_open:
            return _cell(
                "old_text_open",
                "decision",
                people=_people(facts.old_open),
                from_version=facts.old_open[0].from_version,
                version=newest,
            )
        if facts.old_submitted and not step.has_final:
            return _cell(
                "old_text_submitted",
                "decision",
                people=_people(facts.old_submitted),
                from_version=facts.old_submitted[0].from_version,
                version=newest,
                note="v2_not_annotated",
            )
    per_text = step.per_text
    counted = per_text > 1
    if "assign_annotation" in codes:
        assigned = step.annotation_assignments
        return _cell(
            "partly_assigned" if assigned else "unassigned",
            "todo",
            people=facts.annotators_open,
            assigned=assigned if counted else None,
            target=per_text if counted else None,
            **waiting_note,
        )
    if facts.finishing and not facts.correction_waiting:
        return _cell(
            "finishing_on_old",
            "running",
            people=_people(facts.finishing),
            from_version=facts.finishing[0].from_version,
            version=newest,
            note="carried_on_submit",
        )
    submitted = len(facts.annotators_submitted)
    if step.open_annotation_reviews or facts.annotation_reviewers:
        return _cell(
            "in_review",
            "running",
            people=facts.annotation_reviewers,
            submitted=submitted,
            **waiting_note,
        )
    if facts.consolidators:
        return _cell("consolidating", "running", people=facts.consolidators)
    if step.open_annotations or facts.annotators_open:
        note: dict[str, Any] = (
            {"note": "may_change", "version": newest}
            if step.open_translation_reviews or facts.review_people
            else waiting_note
        )
        many = counted or submitted > 0
        return _cell(
            "in_progress",
            "running",
            people=facts.annotators_open,
            submitted=submitted if many else None,
            total=per_text if many else None,
            round_ordinal=facts.round_ordinal,
            **note,
        )
    old = facts.old_submitted
    if submitted or old or step.has_final:
        on_old = not submitted and bool(old)
        return _cell(
            "submitted",
            "done",
            people=facts.annotators_submitted or _people(old),
            submitted=submitted if counted else None,
            total=per_text if counted else None,
            findings=facts.findings,
            version=old[0].from_version if on_old else newest,
            **waiting_note,
        )
    return _cell("unassigned", "todo", **waiting_note)


def _people(items: Sequence[OldItem]) -> tuple[int, ...]:
    return tuple(dict.fromkeys(item.user_id for item in items))


def _final_detail(facts: StageFacts) -> dict[str, Any]:
    return {
        "people": () if facts.final_author is None else (facts.final_author,),
        "round_ordinal": facts.final_round_ordinal,
        "reason": facts.final_kind,
        "version": None if facts.final_on_newest else facts.final_version,
    }


def _final(facts: StageFacts, codes: frozenset[str]) -> StageCell:
    step = facts.step
    if not step.annotate:
        if step.has_final:
            return _cell("final", "done", note="not_exported", **_final_detail(facts))
        return _cell("none", "none")
    if "confirm_final" in codes:
        if not facts.final_on_newest:
            return _cell("old_text", "decision", **_final_detail(facts))
        return _cell("confirm", "decision", reason=",".join(facts.final_causes) or None)
    if "choose_final" in codes:
        return _cell("choose", "decision", submitted=facts.submissions)
    if step.has_final:
        if facts.source_changed_from is not None:
            return _cell(
                "may_be_outdated",
                "waiting",
                reason="source_changed",
                from_version=facts.source_changed_from,
            )
        return _cell("final", "done", **_final_detail(facts))
    if (
        step.open_annotation_reviews
        or facts.annotation_reviewers
        or facts.consolidators
    ):
        return _cell("after_review", "waiting")
    if facts.submissions or facts.annotators_submitted or facts.old_submitted:
        return _cell("after_annotation", "waiting")
    return _cell("none", "none")


def stage_cells(facts: StageFacts, steps: Sequence[Step]) -> StageCells:
    """Review, Annotation and Final cell of one row (spec "Stage cells")."""
    codes = frozenset(step.code for step in steps)
    return StageCells(
        review=_review(facts, codes),
        annotation=_annotation(facts, codes),
        final=_final(facts, codes),
    )
