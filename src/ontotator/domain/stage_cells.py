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

from ontotator.domain.next_steps import (
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
    # Review re_review: why the translation is reviewed again.
    "correction",
    "new_review",
    "source_changed",  # also Final may_be_outdated
    # Final: kind of the final result ("Round 1 · Ana Weber" /
    # "Consolidation · Luc Martin").
    "round",
    "consolidation",
]
CellName = Literal["review", "annotation", "final"]

# Spec: the paused cell quotes at most 60 characters of the report; a cut
# excerpt ends in "…" (so it is at most 61 characters long).
PAUSED_EXCERPT_LENGTH = 60

_ACCEPTED_NOTES: Mapping[str, CellNote] = {
    "unchanged": "unchanged",
    "corrected": "with_corrections",
    "package": "in_package",
    "external": "outside",
}


@dataclass(frozen=True)
class StageFacts:
    """Facts of one row the cells read on top of ``step``.

    "Decided" (VD3) is only ``step.decided``. Submissions: the caller fills
    ``submissions`` with the eligible submissions (minimum over the row's
    target versions; on the target version only, without sources whose
    text-change resolution is carried, moved or handed_over, spec VD16) and
    ``annotators_submitted`` with their authors. The Annotation cell counts
    ``submissions``; the Final cell counts ``final_submissions`` (consolidation
    submissions included), falling back to ``submissions``;
    ``annotators_submitted`` only names people.

    Started (issue 258): an assignment has started once it left the status
    ``open``, which its first saved change does (a translation review's first
    draft save, an annotation's first draft mutation; opening the task does
    not). ``review_tasks`` / ``annotate_tasks`` count the open assignments
    behind ``review_people`` / ``annotators_open``, ``review_started`` /
    ``annotate_started`` the started ones among them; ``None`` = not counted
    (the cells then carry no started count).
    """

    step: StepFacts
    review_people: tuple[int, ...] = ()  # open translation review(s)
    review_tasks: int | None = None  # open translation review assignments
    review_started: int = 0  # of ``review_tasks``: no longer status open
    review_reason: Literal["correction", "new_review", "source_changed"] | None = None
    review_reason_text: str | None = None  # free text, e.g. "Dosis prüfen"
    review_decided_by: int | None = None  # latest decision on the newest version
    review_decided_at: datetime | None = None
    accepted_how: Literal["unchanged", "corrected", "package", "external"] | None = None
    accepted_from_version: int | None = None  # "v1 → v2" when corrected
    newest_version: int = 1
    newest_origin: str | None = None  # VariantOrigin of the target
    annotators_open: tuple[int, ...] = ()  # on the target(s), not held
    annotate_tasks: int | None = None  # their assignments
    annotate_started: int = 0  # of ``annotate_tasks``: no longer status open
    annotators_submitted: tuple[int, ...] = ()  # authors of ``submissions``
    # Issue 283: ``submissions`` plus the running annotate tasks on the same
    # target (the one with the fewest submissions): more than ``per_text``
    # when the limit was lowered after people were assigned.
    annotators_holding: int = 0
    round_ordinal: int | None = None  # the one open round, if exactly one
    findings: int | None = None  # finding_count when exactly one submission
    consolidators: tuple[int, ...] = ()
    paused_by: int | None = None  # reporter of the open report
    paused_excerpt: str | None = None  # ≤ 60 characters
    paused_task: Literal["annotate", "translation_review"] | None = None
    # Old-version work items (rules 3a, 3b, finishing) are ``step.old_open``,
    # ``step.old_submitted`` and ``step.finishing``: one source for the steps
    # and the cells.
    # Source version of an unreviewed source change (rule 6a, Final
    # "may be outdated").
    source_changed_from: int | None = None
    # Issue 213: annotation tasks closed until the review is accepted.
    annotators_waiting: tuple[int, ...] = ()
    correction_waiting: bool = False  # correction ready_for_review, rule on (edge case)
    final_causes: tuple[str, ...] = ()  # unacknowledged cause codes
    final_kind: Literal["round", "consolidation"] | None = None
    final_author: int | None = None
    final_round_ordinal: int | None = None
    final_version: int | None = None
    final_on_newest: bool = True
    submissions: int = 0  # eligible submissions, see the class docstring
    # Final "choose": annotate and consolidation submissions on the target
    # version (walkthrough step 11: "3 submissions"); None = ``submissions``.
    final_submissions: int | None = None
    parallel_roots: bool = False


@dataclass(frozen=True)
class CellDetail:
    """Muted second line of a cell.

    ``assigned`` / ``total``: in Review with parallel roots they count
    versions ("1 of 2 versions in review": versions in review, or accepted
    versions, of ``total`` roots); in Annotation and Final the counts are the
    minimum over the row's target versions ("1 of 2 assigned", "1 of 2
    submitted"). The Annotation ``total`` of ``submitted`` is "annotators per
    text", or the people holding that target when more do (issue 283). ``reason`` is free text only (Review re_review: "Dosis
    prüfen"); codes go to ``note``, Final ``confirm`` cause codes to
    ``causes``. ``started`` of ``open_tasks``: how many of the open
    assignments the cell names have started (``StageFacts``, issue 258);
    "Assigned, not started" at 0. Both None where nothing is counted.
    """

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
    causes: tuple[str, ...] = ()  # Final confirm: unacknowledged cause codes
    compared: int | None = None
    # "Round 2" (Annotation in progress) / "Round 1 · Ana Weber" (Final).
    round_ordinal: int | None = None
    started: int | None = None
    open_tasks: int | None = None


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
    "handle_text_change": "annotation",
    "carry_text_change": "annotation",
    "resolve_rejected": "review",
    "resolve_queried": "review",
    "translation_not_accepted": "review",
    "choose_final": "final",
    "assign_translation_review": "review",
    "review_source_change": "review",
    "translation_review_in_progress": "review",
    "assign_annotation": "annotation",
    "annotation_in_progress": "annotation",
    "consolidation_in_progress": "annotation",
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


def _excerpt(text: str | None) -> str | None:
    if text is None or len(text) <= PAUSED_EXCERPT_LENGTH:
        return text
    return text[:PAUSED_EXCERPT_LENGTH] + "…"


def _paused(facts: StageFacts) -> StageCell:
    return _cell(
        "paused",
        "decision",
        people=() if facts.paused_by is None else (facts.paused_by,),
        excerpt=_excerpt(facts.paused_excerpt),
    )


def _undecided(facts: StageFacts) -> bool:
    return not in_plan(facts.step) and not facts.step.decided


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


def _started(tasks: int | None, started: int) -> dict[str, Any]:
    """``started`` / ``open_tasks`` of a cell naming open work (issue 258)."""
    if not tasks:
        return {}
    return {"started": min(started, tasks), "open_tasks": tasks}


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
        started = _started(facts.review_tasks, facts.review_started)
        if facts.review_reason is not None:
            return _cell(
                "re_review",
                "running",
                people=people,
                note=facts.review_reason,
                reason=facts.review_reason_text,
                **roots,
                **started,
            )
        return _cell("in_progress", "running", people=people, **roots, **started)
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
    # Rule 6 assigns a not-yet-reviewed translation's review instead of 6a.
    if step.source_changed and "review_source_change" in codes:
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
    # Review on, not accepted, no open review and no step names this cell
    # (e.g. reviewed and waiting for the decision's effect): nothing for the
    # lead to do here.
    return _cell("in_progress", "waiting", version=facts.newest_version)


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
    started = (
        _started(facts.annotate_tasks, facts.annotate_started)
        if facts.annotators_open
        else {}
    )
    if not _may_annotate(step):
        # Issue 213: the people whose tasks wait, and their count against the
        # limit (the text card's "n of m annotators assigned").
        waiters: dict[str, Any] = {
            "people": facts.annotators_waiting,
            **(
                {"assigned": step.annotation_assignments, "target": step.per_text}
                if step.per_text > 1
                else {}
            ),
        }
        if "resolve_rejected" in codes:
            return _cell("blocked", "waiting", note="translation_rejected", **waiters)
        if "resolve_queried" in codes:
            return _cell("blocked", "waiting", note="translation_queried", **waiters)
        if "translation_not_accepted" in codes:
            return _cell(
                "blocked", "waiting", note="translation_not_accepted", **waiters
            )
        if facts.correction_waiting and (
            facts.annotators_open or step.old_open or step.finishing
        ):
            # Work on the older version keeps running meanwhile.
            return _cell(
                "in_progress",
                "running",
                people=facts.annotators_open
                or _people((*step.old_open, *step.finishing)),
                **waiting_note,
                **started,
            )
        return _cell("after_review", "waiting", **waiting_note, **waiters)
    newest = facts.newest_version
    if not facts.correction_waiting:
        if step.old_open:
            return _cell(
                "old_text_open",
                "decision",
                people=_people(step.old_open),
                from_version=step.old_open[0].from_version,
                version=newest,
            )
        if step.old_submitted and not step.has_final:
            return _cell(
                "old_text_submitted",
                "decision",
                people=_people(step.old_submitted),
                from_version=step.old_submitted[0].from_version,
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
            **started,
        )
    if step.finishing and not facts.correction_waiting:
        return _cell(
            "finishing_on_old",
            "running",
            people=_people(step.finishing),
            from_version=step.finishing[0].from_version,
            version=newest,
            note="carried_on_submit",
        )
    submitted = facts.submissions
    # "n of m submitted": out of the limit, or out of everyone holding the
    # target when more do (issue 283; never "2 of 1 submitted").
    total = max(per_text, submitted, facts.annotators_holding)
    if facts.consolidators:
        # Counts of the newest version, as "submitted"; without them the client
        # would count annotate work of every version (v1 + v2 read "3 of 3").
        return _cell(
            "consolidating",
            "running",
            people=facts.consolidators,
            submitted=submitted if counted else None,
            total=per_text if counted else None,
        )
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
            total=total if many else None,
            round_ordinal=facts.round_ordinal,
            **note,
            **started,
        )
    old = step.old_submitted
    if submitted or old or step.has_final:
        on_old = not submitted and bool(old)
        return _cell(
            "submitted",
            "done",
            people=facts.annotators_submitted or _people(old),
            submitted=submitted if counted else None,
            total=total if counted else None,
            findings=facts.findings,
            version=old[0].from_version if on_old else newest,
            **waiting_note,
        )
    # Enough assignments, nothing open and nothing submitted: no step names
    # this cell (an application invariant broke), so it is no lead task.
    return _cell("submitted", "done", version=newest, **waiting_note)


def _people(items: Sequence[OldItem]) -> tuple[int, ...]:
    return tuple(dict.fromkeys(item.user_id for item in items))


def _final_detail(facts: StageFacts) -> dict[str, Any]:
    return {
        "people": () if facts.final_author is None else (facts.final_author,),
        "round_ordinal": facts.final_round_ordinal,
        "note": facts.final_kind,
        "version": None if facts.final_on_newest else facts.final_version,
    }


def _final(facts: StageFacts, codes: frozenset[str]) -> StageCell:
    step = facts.step
    if not step.annotate:
        if step.has_final:
            # "not exported" outranks the kind note; round_ordinal stays.
            detail = {**_final_detail(facts), "note": "not_exported"}
            return _cell("final", "done", **detail)
        return _cell("none", "none")
    if "confirm_final" in codes:
        if (
            "SELECTED_TEXT_CORRECTED" in facts.final_causes
            and not facts.final_on_newest
        ):
            return _cell("old_text", "decision", **_final_detail(facts))
        return _cell("confirm", "decision", causes=facts.final_causes)
    if "choose_final" in codes:
        submissions = (
            facts.submissions
            if facts.final_submissions is None
            else facts.final_submissions
        )
        return _cell("choose", "decision", submitted=submissions)
    if step.has_final:
        if step.source_changed:
            return _cell(
                "may_be_outdated",
                "waiting",
                note="source_changed",
                from_version=facts.source_changed_from,
            )
        return _cell("final", "done", **_final_detail(facts))
    if facts.consolidators:
        return _cell("after_review", "waiting")
    if facts.submissions or step.old_submitted:
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
