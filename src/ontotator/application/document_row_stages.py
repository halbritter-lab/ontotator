"""Stage cells and version marker of a Documents row (documents overview).

Builds ``StageFacts`` from the same facts ``document_row_page._row_steps``
derives the next step from, so the table, the tabs and the facets read one
derivation; the cells themselves are pure (``domain/stage_cells.py``).
"""

from __future__ import annotations

import dataclasses
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal

from ontotator.domain import document_rows as rules
from ontotator.domain.next_steps import StepFacts
from ontotator.domain.stage_cells import StageCell, StageFacts

if TYPE_CHECKING:
    from ontotator.application.document_row_page import _Context

RowKey = tuple[str, str]
# Resolutions that take a submission out of the eligible ones (VD16).
NOT_ELIGIBLE = frozenset({"carried", "moved", "handed_over"})
_ACCEPTANCE_HOW: Mapping[str, Literal["package", "external"]] = {
    "package": "package",
    "lead": "external",
    "override": "external",
}


@dataclass(frozen=True)
class Candidate:
    """An eligible submission (VD16) of a row."""

    submission_id: str
    document_id: str
    # The submitted annotate assignment (None: consolidation).
    assignment_id: int | None = None
    # The consolidation round the submission belongs to (None: annotation).
    consolidation_round: str | None = None


def eligible_by_target(
    ctx: _Context, targets: Sequence[rules.Version]
) -> list[tuple[Candidate, ...]]:
    """Eligible submissions (VD16) per target version, in ``targets`` order.

    Eligible: the last submission of each cleanly submitted annotate
    assignment on the target whose assignment and last submission were not
    carried, moved or handed over (``NOT_ELIGIBLE``), and the latest
    submission of each cleanly submitted consolidation round on the target.
    A submitted assignment without a (latest) submission counts nothing.
    """
    facts = ctx.facts
    result: list[tuple[Candidate, ...]] = []
    for target in targets:
        found: dict[str, Candidate] = {}
        for item in ctx.assignments.get(target.document_id, []):
            if item.revoked or item.status != "submitted" or item.held:
                continue
            candidate: Candidate | None = None
            if item.task == "annotate":
                submission = facts.last_submissions.get(item.assignment_id)
                if (
                    submission is not None
                    and ctx.resolution_of.get(item.assignment_id) not in NOT_ELIGIBLE
                    and not (
                        ctx.submission_resolutions.get(submission, set()) & NOT_ELIGIBLE
                    )
                ):
                    candidate = Candidate(
                        submission, item.document_id, assignment_id=item.assignment_id
                    )
            elif item.task == "review":
                round_fact = ctx.rounds.get(item.active_round_id or "")
                if (
                    round_fact is not None
                    and round_fact.kind == "consolidation"
                    and round_fact.latest_submission_id is not None
                ):
                    candidate = Candidate(
                        round_fact.latest_submission_id,
                        item.document_id,
                        consolidation_round=round_fact.round_id,
                    )
            if candidate is not None:
                found.setdefault(candidate.submission_id, candidate)
        result.append(tuple(found.values()))
    return result


def compared_target(per_target: Sequence[Sequence[Candidate]]) -> int | None:
    """Index of the compared target: the one with the most eligible
    submissions, the first root on a tie (parallel roots, VD16)."""
    best: int | None = None
    for index, found in enumerate(per_target):
        if best is None or len(found) > len(per_target[best]):
            best = index
    return best


def _unique(values: Sequence[int]) -> tuple[int, ...]:
    return tuple(dict.fromkeys(values))


def _open(item: rules.AssignmentFact) -> bool:
    """Not revoked and not (cleanly) submitted: held work still counts."""
    return not item.revoked and (item.status != "submitted" or item.held)


def _started(items: Sequence[rules.AssignmentFact]) -> int:
    """Started (issue 258): the assignment left ``open``, which only its
    first saved change does; opening the task leaves it open."""
    return sum(1 for item in items if item.status != "open")


def _review_reason(
    ctx: _Context,
    reviews: Sequence[rules.AssignmentFact],
    version_of: Mapping[str, rules.Version],
) -> tuple[Literal["correction", "new_review", "source_changed"] | None, str | None]:
    """Why an open translation review reviews the text again (D25, D26).

    A correction request carries the lead's free-text reason; a review of a
    version with an unresolved source change reviews that change (V5); a
    review of a correction version is a correction review; a review of an
    accepted version is a new review (D25).
    """
    reasons = ctx.facts.correction_reasons
    for item in reviews:
        if item.assignment_id in reasons:
            return "correction", reasons[item.assignment_id] or None
    for item in reviews:
        if item.document_id in ctx.facts.source_obligations:
            return "source_changed", None
    for item in reviews:
        version = version_of.get(item.document_id)
        if version is None:
            continue
        if version.origin == "correction":
            return "correction", None
        if (
            version.translation_status == "accepted"
            or version.document_id in ctx.facts.acceptances
        ):
            return "new_review", None
    return None, None


def _accepted_how(
    ctx: _Context,
    targets: Sequence[rules.Version],
    version_of: Mapping[str, rules.Version],
) -> tuple[Literal["unchanged", "corrected", "package", "external"] | None, int | None]:
    """How the (first) target version came to be accepted, and from which
    version a correction started ("v1 → v2")."""
    if not targets:
        return None, None
    target = targets[0]
    if target.origin == "correction":
        parent = version_of.get(target.derived_from or "")
        return "corrected", parent.version if parent is not None else None
    review = ctx.facts.latest_reviews.get(target.document_id)
    # Stored decisions are accepted_unchanged / accepted_corrected.
    if review is not None and review.decision.startswith("accepted"):
        return "unchanged", None
    acceptance = ctx.facts.acceptances.get(target.document_id)
    if acceptance is not None and acceptance["source"] in _ACCEPTANCE_HOW:
        return _ACCEPTANCE_HOW[acceptance["source"]], None
    return "unchanged", None


def _latest_decision(
    ctx: _Context,
    live: Sequence[rules.Chain],
    targets: Sequence[rules.Version],
    version_of: Mapping[str, rules.Version],
) -> rules.Version | None:
    """The version whose latest review the Review cell names: each root's
    literal newest version, else the parent a correction target came from."""
    reviews = ctx.facts.latest_reviews
    parents = [
        version_of.get(target.derived_from or "")
        for target in targets
        if target.origin == "correction"
    ]
    candidates = [chain.newest for chain in live] + [
        parent for parent in parents if parent is not None
    ]
    decided = [v for v in candidates if v.document_id in reviews]
    # Parallel roots: the root the Review cell's rejected / query state comes
    # from wins (rejected before query, as in ``derive_steps``).
    for wanted in ("rejected", "query"):
        for version in decided:
            if reviews[version.document_id].decision == wanted:
                return version
    return next(iter(decided), None)


def _final_author(ctx: _Context, final: Mapping[str, Any] | None) -> int | None:
    """User id of the final result's author (``ctx.user_ids`` also holds the
    selected submissions' authors without an assignment)."""
    if final is None or final["author_label"] is None:
        return None
    return ctx.user_ids.get(final["author_label"])


def stage_facts(
    ctx: _Context,
    key: RowKey,
    *,
    live: Sequence[rules.Chain],
    targets: Sequence[rules.Version],
    current: Sequence[rules.AssignmentFact],
    step_facts: StepFacts,
    final: Mapping[str, Any] | None,
    source_changed_from: int | None = None,
) -> StageFacts:
    """``StageFacts`` of one row; ``current`` = non-revoked assignments on
    live versions, ``targets`` = newest counted version per live root,
    ``final`` = the row's live final result, ``source_changed_from`` = the
    source version of an unreviewed source change (rule 6a)."""
    facts = ctx.facts
    version_of = {v.document_id: v for chain in live for v in chain.versions}
    target_ids = {v.document_id for v in targets}
    reviews = [
        item
        for item in current
        if item.task == "translation_review" and item.status != "submitted"
    ]
    annotations = [
        item
        for item in current
        if item.task == "annotate" and item.document_id in target_ids
    ]
    running = [
        item
        for item in annotations
        if item.status != "submitted"
        and not item.held
        and item.assignment_id not in ctx.waiting
    ]

    per_target = eligible_by_target(ctx, targets)
    eligible_ids = {
        item.assignment_id
        for found in per_target
        for item in found
        if item.assignment_id is not None
    }
    submitted_by_target = [
        [
            item
            for item in annotations
            if item.document_id == target.document_id
            and item.assignment_id in eligible_ids
        ]
        for target in targets
    ]
    submitted = [item for items in submitted_by_target for item in items]
    submissions = min((len(items) for items in submitted_by_target), default=0)
    # Issue 283: the "n of m submitted" total of the target(s) with the fewest
    # submissions, not the open tasks summed over parallel versions.
    holding = max(
        (
            len(items)
            + sum(1 for item in running if item.document_id == target.document_id)
            for target, items in zip(targets, submitted_by_target, strict=True)
            if len(items) == submissions
        ),
        default=0,
    )
    rounds = {
        ctx.ordinals.get(item.active_round_id)
        for item in running
        if item.active_round_id is not None
    }
    open_reviews = [item for item in current if item.task == "review" and _open(item)]

    def consolidating(item: rules.AssignmentFact) -> bool:
        round_fact = ctx.rounds.get(item.active_round_id or "")
        return round_fact is not None and round_fact.kind == "consolidation"

    # Final "choose": the eligible submissions (annotate and consolidation)
    # of the compared target, as the final-result panel compares them.
    compared = compared_target(per_target)
    final_submissions = len(per_target[compared]) if compared is not None else 0

    paused_by: int | None = None
    paused_excerpt: str | None = None
    held: rules.AssignmentFact | None = None
    report = (
        facts.reports.get(step_facts.open_report_id)
        if step_facts.open_report_id is not None
        else None
    )
    if report is not None:
        paused_by = report.reporter_id
        paused_excerpt = report.excerpt
        if report.assignment_id is not None:
            held = ctx.assignment_by_id.get(report.assignment_id)
    elif step_facts.orphan_pause_assignment_id is not None:
        held = ctx.assignment_by_id.get(step_facts.orphan_pause_assignment_id)
        paused_by = held.user_id if held is not None else None
    paused_task: Literal["annotate", "translation_review"] | None = None
    if held is not None:
        paused_task = (
            "translation_review" if held.task == "translation_review" else "annotate"
        )
    reason, reason_text = _review_reason(ctx, reviews, version_of)
    how, from_version = _accepted_how(ctx, targets, version_of)
    decided = _latest_decision(ctx, live, targets, version_of)
    decision = (
        facts.latest_reviews[decided.document_id] if decided is not None else None
    )
    warnings = ctx.warnings.get(key, [])
    return StageFacts(
        step=step_facts,
        review_people=_unique([item.user_id for item in reviews]),
        review_tasks=len(reviews),
        review_started=_started(reviews),
        review_reason=reason,
        review_reason_text=reason_text,
        review_decided_by=decision.reviewer_id if decision is not None else None,
        review_decided_at=decision.decided_at if decision is not None else None,
        accepted_how=how,
        accepted_from_version=from_version,
        newest_version=max((v.version for v in targets), default=1),
        newest_origin=targets[0].origin if targets else None,
        annotators_open=_unique([item.user_id for item in running]),
        annotate_tasks=len(running),
        annotate_started=_started(running),
        annotators_waiting=_unique(
            [item.user_id for item in annotations if item.assignment_id in ctx.waiting]
        ),
        annotators_submitted=_unique([item.user_id for item in submitted]),
        annotators_holding=holding,
        round_ordinal=next(iter(rounds)) if len(rounds) == 1 else None,
        findings=(
            facts.findings.get(submitted[0].assignment_id)
            if submissions == 1 and len(submitted) == 1
            else None
        ),
        consolidators=_unique(
            [item.user_id for item in open_reviews if consolidating(item)]
        ),
        paused_by=paused_by,
        paused_excerpt=paused_excerpt,
        paused_task=paused_task,
        correction_waiting=facts.rule_on
        and any(
            v.origin == "correction" and v.translation_status == "ready_for_review"
            for v in targets
        ),
        final_causes=tuple(
            w["code"] for w in warnings if w["code"] in rules.ACKNOWLEDGEABLE
        ),
        final_kind=(
            None
            if final is None
            else "consolidation"
            if final["kind"] == "consolidation"
            else "round"
        ),
        final_author=_final_author(ctx, final),
        final_round_ordinal=final["round_ordinal"] if final is not None else None,
        final_version=final["version"] if final is not None else None,
        final_on_newest=final is None or final["document_id"] in target_ids,
        source_changed_from=source_changed_from,
        submissions=submissions,
        final_submissions=final_submissions,
        parallel_roots=len(live) > 1,
    )


def version_marker(chains: Sequence[rules.Chain]) -> dict[str, Any] | None:
    """Text cell marker: "2 translations" (parallel roots), "v2 corrected"
    (the newest counted version is a correction), "v2" (another newer
    version); None for a single v1. ``chains`` are the live roots (all roots
    of a fully discarded row)."""
    if len(chains) > 1:
        return {"kind": "parallel", "version": len(chains)}
    if not chains:
        return None
    target = [v for v in chains[0].versions if not v.not_newer][-1]
    if target.origin == "correction":
        return {"kind": "corrected", "version": target.version}
    if target.version > 1:
        return {"kind": "version", "version": target.version}
    return None


def cell_view(
    cell: StageCell, people: Callable[[int], dict[str, Any]]
) -> dict[str, Any]:
    """``StageCellView`` fields; person ids become ``PersonRefView`` dicts."""
    detail = dataclasses.asdict(cell.detail)
    detail["people"] = [people(user_id) for user_id in cell.detail.people]
    detail["causes"] = list(cell.detail.causes)
    return {"state": cell.state, "tone": cell.tone, "detail": detail}
