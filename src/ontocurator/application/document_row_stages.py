"""Stage cells and version marker of a Documents row (documents overview).

Builds ``StageFacts`` from the same facts ``document_row_page._row_steps``
derives the next step from, so the table, the tabs and the facets read one
derivation; the cells themselves are pure (``domain/stage_cells.py``).
"""

from __future__ import annotations

import dataclasses
from collections.abc import Callable, Mapping, Sequence
from typing import TYPE_CHECKING, Any, Literal

from ontocurator.domain import document_rows as rules
from ontocurator.domain.next_steps import StepFacts
from ontocurator.domain.stage_cells import StageCell, StageFacts

if TYPE_CHECKING:
    from ontocurator.application.document_row_page import _Context

RowKey = tuple[str, str]
_ACCEPTANCE_HOW: Mapping[str, Literal["package", "external"]] = {
    "package": "package",
    "lead": "external",
    "override": "external",
}


def _unique(values: Sequence[int]) -> tuple[int, ...]:
    return tuple(dict.fromkeys(values))


def _open(item: rules.AssignmentFact) -> bool:
    """Not revoked and not (cleanly) submitted: held work still counts."""
    return not item.revoked and (item.status != "submitted" or item.held)


def _review_reason(
    ctx: _Context,
    reviews: Sequence[rules.AssignmentFact],
    version_of: Mapping[str, rules.Version],
) -> tuple[Literal["correction", "new_review"] | None, str | None]:
    """Why an open translation review reviews the text again (D25, D26).

    A correction request carries the lead's free-text reason; a review of a
    correction version is a correction review; a review of an accepted
    version is a new review (D25). O2a adds ``source_changed``.
    """
    reasons = ctx.facts.correction_reasons
    for item in reviews:
        if item.assignment_id in reasons:
            return "correction", reasons[item.assignment_id] or None
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
) -> StageFacts:
    """``StageFacts`` of one row; ``current`` = non-revoked assignments on
    live versions, ``targets`` = newest counted version per live root,
    ``final`` = the row's live final result."""
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
        item for item in annotations if item.status != "submitted" and not item.held
    ]
    submitted_by_target = [
        [
            item
            for item in annotations
            if item.document_id == target.document_id
            and item.status == "submitted"
            and not item.held
        ]
        for target in targets
    ]
    submitted = [item for items in submitted_by_target for item in items]
    submissions = min((len(items) for items in submitted_by_target), default=0)
    rounds = {
        ctx.ordinals.get(item.active_round_id)
        for item in running
        if item.active_round_id is not None
    }
    open_reviews = [item for item in current if item.task == "review" and _open(item)]

    def consolidating(item: rules.AssignmentFact) -> bool:
        round_fact = ctx.rounds.get(item.active_round_id or "")
        return round_fact is not None and round_fact.kind == "consolidation"

    # Final "choose": annotate and consolidation submissions per target.
    final_submissions = min(
        (
            len(items)
            + sum(
                1
                for item in current
                if item.task == "review"
                and item.document_id == target.document_id
                and item.status == "submitted"
                and not item.held
                and consolidating(item)
            )
            for target, items in zip(targets, submitted_by_target, strict=True)
        ),
        default=0,
    )

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
        review_reason=reason,
        review_reason_text=reason_text,
        review_decided_by=decision.reviewer_id if decision is not None else None,
        review_decided_at=decision.decided_at if decision is not None else None,
        accepted_how=how,
        accepted_from_version=from_version,
        newest_version=max((v.version for v in targets), default=1),
        newest_origin=targets[0].origin if targets else None,
        annotators_open=_unique([item.user_id for item in running]),
        annotators_submitted=_unique([item.user_id for item in submitted]),
        round_ordinal=next(iter(rounds)) if len(rounds) == 1 else None,
        findings=(
            facts.findings.get(submitted[0].assignment_id)
            if submissions == 1 and len(submitted) == 1
            else None
        ),
        annotation_reviewers=_unique(
            [item.user_id for item in open_reviews if not consolidating(item)]
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
