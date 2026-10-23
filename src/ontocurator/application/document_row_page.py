"""Rows and pages of the lead's Documents table, built from facts (no SQL).

Every rule lives in ``domain/document_rows.py``; this module only assembles
the row and page dictionaries of the Documents read API.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from typing import TYPE_CHECKING, Any

from ontocurator.application import document_row_facets as facets
from ontocurator.application import document_row_stages as stages
from ontocurator.domain import document_rows as rules
from ontocurator.domain import next_steps as steps_rules
from ontocurator.domain import stage_cells as cells_rules
from ontocurator.domain.document_rows import PAGE_SIZE
from ontocurator.domain.work_plans import PlanFlags
from ontocurator.domain.work_plans import RowKey as PlanKey

if TYPE_CHECKING:
    from ontocurator.application.document_rows import RowFacts, RowQuery

# The preflight's unconditional omission; Documents uses its own MISSING_FINAL.
_PREFLIGHT_ONLY = frozenset({"MISSING_FINAL_SELECTION"})
# Shown as the row's waiting line, never counted as a note.
_WAITING = frozenset({"ROUND_REVIEW_PENDING"})
# Unreviewed source change: an issue of category translation (V5).
_SOURCE_CHANGED = "SOURCE_UPDATE_UNREVIEWED"
# Header checkbox: at most this many filtered case IDs (spec "Selection").
MAX_CASE_IDS = 2000
# Report excerpt length of a next step's secondary line.
STEP_EXCERPT_LENGTH = 60
_NOT_PLANNED = PlanFlags(False, False)

RowKey = tuple[str, str]


def _latest(values: Iterable[datetime | None]) -> datetime | None:
    present = [value for value in values if value is not None]
    return max(present) if present else None


def _item(
    code: str,
    cause_id: str,
    *,
    cause_revision: int = 1,
    document_id: str | None = None,
    version: int | None = None,
    review_decision: str | None = None,
    report: dict[str, Any] | None = None,
    report_id: str | None = None,
    assignment_id: int | None = None,
    author_label: str | None = None,
) -> dict[str, Any]:
    return {
        "code": code,
        "cause_id": cause_id,
        "cause_revision": cause_revision,
        "document_id": document_id,
        "category": rules.category_of(code),
        "version": version,
        "review_decision": review_decision,
        "report": report,
        "report_id": report_id,
        "assignment_id": assignment_id,
        "author_label": author_label,
    }


class _Context:
    """Project-wide lookups shared by every row of one page build."""

    def __init__(self, facts: RowFacts):
        self.facts = facts
        self.by_row: dict[RowKey, list[rules.Version]] = {}
        for version in facts.versions:
            self.by_row.setdefault((version.case_id, version.language), []).append(
                version
            )
        self.assignments: dict[str, list[rules.AssignmentFact]] = {}
        self.assignment_by_id: dict[int, rules.AssignmentFact] = {}
        for assignment in facts.assignments:
            self.assignments.setdefault(assignment.document_id, []).append(assignment)
            self.assignment_by_id[assignment.assignment_id] = assignment
        self.rounds = {item.round_id: item for item in facts.rounds}
        # Every version of the project (source versions of a source change).
        self.version_by_id = {v.document_id: v for v in facts.versions}
        # Text-change resolutions (V5): per assignment (moved,
        # finish_then_carry, withdrawn) and per submission (carried,
        # handed_over, dismissed).
        self.resolution_of: dict[int, str] = {}
        self.moved_to: dict[int, str] = {}
        self.submission_resolutions: dict[str, set[str]] = {}
        # Submission -> target versions it was dismissed for (rule 3b).
        self.dismissed_to: dict[str, set[str]] = {}
        for resolution in facts.resolutions:
            if (
                resolution.submission_id is not None
                and resolution.resolution == "dismissed"
            ):
                self.dismissed_to.setdefault(resolution.submission_id, set()).add(
                    resolution.to_document_id
                )
            if resolution.assignment_id is not None:
                self.resolution_of[resolution.assignment_id] = resolution.resolution
                if resolution.resolution == "moved":
                    self.moved_to[resolution.assignment_id] = resolution.to_document_id
            if resolution.submission_id is not None:
                self.submission_resolutions.setdefault(
                    resolution.submission_id, set()
                ).add(resolution.resolution)
        self.ordinals = rules.round_ordinals(
            (item.round_id, item.predecessor_round_id) for item in facts.rounds
        )
        self.warnings: dict[RowKey, list[Mapping[str, Any]]] = {}
        for warning in facts.final_state["warnings"]:
            if warning["code"] in _PREFLIGHT_ONLY:
                continue
            self.warnings.setdefault(
                (warning["case_id"], warning["language"]), []
            ).append(warning)
        self.dropped = frozenset(facts.discarded)
        # Per row, filled by _build_row: effective (review, annotate) flags,
        # bar segment of the next step and pseudonyms owning the next step.
        self.flags: dict[RowKey, tuple[bool, bool]] = {}
        # A final on a discarded root is not the row's final (export, steps).
        self.has_final: dict[RowKey, bool] = {}
        self.segments: dict[RowKey, steps_rules.Segment | None] = {}
        self.owners: dict[RowKey, frozenset[str]] = {}
        self.in_plan: dict[RowKey, bool] = {}
        self.step_facts: dict[RowKey, steps_rules.StepFacts] = {}
        # Stage cells per row (documents overview), filled by _row_steps.
        self.cells: dict[RowKey, cells_rules.StageCells] = {}
        # Pseudonym <-> user id of everyone with an assignment.
        self.user_ids: dict[str, int] = {}
        self.pseudonyms: dict[int, str] = {}
        for assignment in facts.assignments:
            self.user_ids.setdefault(assignment.pseudonym, assignment.user_id)
            self.pseudonyms.setdefault(assignment.user_id, assignment.pseudonym)
        self.pseudonyms.setdefault(facts.viewer_user_id, facts.viewer_pseudonym)
        # Authors of final results without an assignment (Final cell).
        for pseudonym, user_id in facts.author_ids.items():
            self.user_ids.setdefault(pseudonym, user_id)
            self.pseudonyms.setdefault(user_id, pseudonym)

    def person(self, user_id: int, pseudonym: str) -> dict[str, Any]:
        """PersonRefView fields of ``user_id`` (pseudonym alone when unknown)."""
        ref = self.facts.people.get(user_id)
        if ref is not None:
            return dict(ref)
        return {
            "pseudonym": pseudonym,
            "display_name": None,
            "is_me": user_id == self.facts.viewer_user_id,
        }

    def viewer(self) -> dict[str, Any]:
        return self.person(self.facts.viewer_user_id, self.facts.viewer_pseudonym)

    def person_of(self, user_id: int) -> dict[str, Any]:
        """PersonRefView fields of ``user_id`` (stage cells)."""
        return self.person(user_id, self.pseudonyms.get(user_id, ""))

    def undecided(self, key: RowKey) -> bool:
        """Not in plan and the plan is not decided yet (VD3)."""
        return not self.in_plan[key] and not self.step_facts[key].decided


def _acceptance(facts: RowFacts, document_id: str) -> dict[str, Any] | None:
    """The newest acceptance record of a version (package metadata as given)."""
    record = facts.acceptances.get(document_id)
    if record is None:
        return None
    metadata = record.get("metadata") or {}
    accepted_by = record["accepted_by"]
    return {
        "source": record["source"],
        "reason": record["reason"],
        "accepted_at": record["accepted_at"],
        "accepted_by": facts.people.get(accepted_by) if accepted_by else None,
        "reviewer": metadata.get("reviewer"),
        "reviewed_at": metadata.get("reviewed_at"),
    }


def _discard(facts: RowFacts, document_id: str) -> dict[str, Any] | None:
    record = facts.discarded.get(document_id)
    if record is None:
        return None
    return {
        "reason": record["reason"],
        "discarded_at": record["discarded_at"],
        "discarded_by": facts.people.get(record["discarded_by"]),
    }


def _report(facts: RowFacts, report_id: str | None) -> dict[str, Any] | None:
    fact = facts.reports.get(report_id) if report_id is not None else None
    if fact is None:
        return None
    return {
        "report_id": fact.report_id,
        "excerpt": fact.excerpt,
        "reporter_label": fact.reporter_label,
        "created_at": fact.created_at,
        "task_state": fact.task_state,
        "reporter": (
            facts.people.get(fact.reporter_id) if fact.reporter_id is not None else None
        )
        or {"pseudonym": fact.reporter_label, "display_name": None, "is_me": False},
    }


def _final(
    ctx: _Context,
    selection: Mapping[str, Any],
    chains: list[rules.Chain],
) -> dict[str, Any]:
    facts = ctx.facts
    submission = facts.selected_submissions.get(selection["submission_id"])
    round_fact = (
        ctx.rounds.get(submission.round_id)
        if submission is not None and submission.round_id is not None
        else None
    )
    chain = next(
        (
            item
            for item in chains
            if any(v.document_id == selection["document_id"] for v in item.versions)
        ),
        None,
    )
    version = (
        next(v for v in chain.versions if v.document_id == selection["document_id"])
        if chain is not None
        else None
    )
    return {
        "case_id": selection["case_id"],
        "language": selection["language"],
        "document_id": selection["document_id"],
        "submission_id": selection["submission_id"],
        "revision": selection["revision"],
        "selected_at": selection["selected_at"],
        "updated_at": selection["updated_at"],
        "selected_by": selection["selected_by"],
        "kind": (
            rules.submission_kind(
                round_fact.kind if round_fact is not None else None, submission.mode
            )
            if submission is not None
            else None
        ),
        "round_ordinal": (
            ctx.ordinals.get(round_fact.round_id) if round_fact is not None else None
        ),
        "author_label": submission.annotator_id if submission is not None else None,
        "is_mine": (
            submission is not None and submission.annotator_id == facts.viewer_pseudonym
        ),
        "version": version.version if version is not None else None,
        "chain_name": chain.name if chain is not None else None,
        "recorded_at": submission.recorded_at if submission is not None else None,
        "is_newest_of_chain": (
            chain is not None and chain.newest.document_id == selection["document_id"]
        ),
        # Snapshot at selection time; the current rule is page-level.
        "adjudicator_not_annotator": selection.get("adjudicator_not_annotator"),
        "author": (
            facts.people_by_pseudonym.get(submission.annotator_id)
            if submission is not None
            else None
        ),
    }


def page_context(facts: RowFacts) -> _Context:
    """The project-wide lookups of ``facts`` (one per request)."""
    return _Context(facts)


def build_row(
    facts: RowFacts, case_id: str, language: str, *, ctx: _Context | None = None
) -> dict[str, Any]:
    """One (case_id, language) row; see ``build_page`` for the page context.
    ``ctx`` reuses a context built from the same ``facts``."""
    return _build_row(ctx or _Context(facts), case_id, language)


def _build_row(ctx: _Context, case_id: str, language: str) -> dict[str, Any]:
    facts = ctx.facts
    key = (case_id, language)
    versions = ctx.by_row[key]
    chains = rules.build_chains(versions)
    parallel = len(chains) > 1
    chain_of = {v.document_id: chain for chain in chains for v in chain.versions}
    version_of = {v.document_id: v for v in versions}
    row_assignments = [
        item for v in versions for item in ctx.assignments.get(v.document_id, [])
    ]
    active = sorted(
        (item for item in row_assignments if not item.revoked),
        key=lambda item: item.assignment_id,
    )
    selection = facts.selections.get(key)
    final = _final(ctx, selection, chains) if selection is not None else None

    issues_and_notes: list[dict[str, Any]] = []
    for warning in ctx.warnings.get(key, []):
        code = warning["code"]
        document_id = warning.get("document_id")
        assignment_id = warning.get("assignment_id")
        held = (
            ctx.assignment_by_id.get(assignment_id)
            if assignment_id is not None
            else None
        )
        issues_and_notes.append(
            _item(
                code,
                warning["cause_id"],
                cause_revision=warning["cause_revision"],
                document_id=document_id,
                version=(
                    version_of[document_id].version
                    if document_id in version_of
                    else None
                ),
                report=(
                    _report(facts, warning.get("report_id"))
                    if code == "OPEN_PROBLEM_REPORT"
                    else None
                ),
                report_id=warning.get("report_id"),
                assignment_id=assignment_id,
                author_label=held.pseudonym if held is not None else None,
            )
        )
    reviewing = {
        item.document_id
        for item in active
        if item.task == "translation_review" and item.status != "submitted"
    }
    translation_failed = False
    for chain in chains:
        issue = rules.translation_issue(chain)
        newest = chain.newest
        # A chain with an open translation review is in progress (D21).
        if issue is not None and not any(
            v.document_id in reviewing for v in chain.versions
        ):
            translation_failed = True
            code = rules.TRANSLATION_CODES[issue]
            issues_and_notes.append(
                _item(
                    code,
                    f"{code}:{newest.document_id}",
                    document_id=newest.document_id,
                    version=newest.version,
                    review_decision=newest.latest_decision,
                )
            )
        if (
            newest.origin == "correction"
            and newest.translation_status == "ready_for_review"
            and not any(
                item.task == "translation_review" and not item.revoked
                for item in ctx.assignments.get(newest.document_id, [])
            )
        ):
            issues_and_notes.append(
                _item(
                    "REVIEWER_NEEDED",
                    f"REVIEWER_NEEDED:{newest.document_id}",
                    document_id=newest.document_id,
                    version=newest.version,
                )
            )
    is_source = any(chain.root.origin == "native" for chain in chains)
    flags = facts.plan.get(PlanKey(case_id, language), _NOT_PLANNED)
    live = [
        chain
        for chain in chains
        if not any(v.document_id in ctx.dropped for v in chain.versions)
    ]
    discarded = not live
    review = flags.review and not is_source and not discarded
    annotate = flags.annotate and not discarded
    # Live scope (as the step facts): discarded roots' work and finals count
    # for neither the missing-final rule nor the next step.
    live_ids = {v.document_id for chain in live for v in chain.versions}
    has_final = final is not None and final["document_id"] in live_ids
    ctx.has_final[key] = has_final
    submission_count = sum(
        facts.submission_counts.get(document_id, 0) for document_id in live_ids
    )
    # The missing-final rule holds only for rows with Annotate on.
    counts = annotate and rules.missing_final_counts(
        has_selection=has_final,
        submission_count=submission_count,
        assignments=[item for item in row_assignments if item.document_id in live_ids],
        per_text=facts.annotations_per_text,
    )
    if not is_source and not discarded:
        # A source change is an issue of category translation on rows with
        # Review applicable (V5), also without a final or work on the chain.
        listed = {item["cause_id"] for item in issues_and_notes}
        for item in issues_and_notes:
            # A discarded root's obligation stays a note.
            if item["code"] == _SOURCE_CHANGED and item["document_id"] in live_ids:
                item["category"] = "translation"
                translation_failed = True
        for chain in live:
            newest = chain.newest
            for obligation in facts.source_obligations.get(newest.document_id, ()):
                if obligation.cause_id in listed:
                    continue
                issues_and_notes.append(
                    {
                        **_item(
                            _SOURCE_CHANGED,
                            obligation.cause_id,
                            cause_revision=obligation.cause_revision,
                            document_id=newest.document_id,
                            version=newest.version,
                        ),
                        "category": "translation",
                    }
                )
                translation_failed = True
    reason: str | None = None
    if not has_final and not counts:
        reason = "no_submission" if submission_count == 0 else "work_open"
    if counts:
        issues_and_notes.append(
            _item("MISSING_FINAL", f"MISSING_FINAL:{case_id}:{language}")
        )
    categories = rules.bar_categories(
        (item["code"] for item in issues_and_notes),
        translation_failed=translation_failed,
        missing_final=counts,
    )

    bulk_document, bulk_mode = rules.bulk_target(chains)
    open_document, open_reason = rules.open_target(
        chains, final_document_id=final["document_id"] if final else None
    )
    open_chain = chain_of.get(open_document)
    newest_ids = {chain.newest.document_id for chain in chains}
    own_open = sorted(
        (
            item
            for item in active
            if item.user_id == facts.viewer_user_id and item.status != "submitted"
        ),
        key=lambda item: (item.document_id not in newest_ids, item.assignment_id),
    )
    version_activity = {
        v.document_id: facts.last_activity.get(v.document_id) for v in versions
    }
    steps = _row_steps(
        ctx,
        key,
        live=live,
        active=active,
        review=review,
        annotate=annotate,
        is_source=is_source,
        missing_final=counts,
        final=final if has_final else None,
        # A discarded row is out of the plan for good, never undecided.
        decided=facts.decided.get(PlanKey(case_id, language), True) or discarded,
    )
    row_cells = ctx.cells[key]
    others_at = facts.others_activity.get(key)
    flagged_round = _consolidation_flags(facts, live)
    return {
        "case_id": case_id,
        "language": language,
        "is_source": is_source,
        "position": min(
            (v.position for v in versions if v.position is not None), default=None
        ),
        "versions": [
            {
                "document_id": v.document_id,
                "external_id": v.external_id,
                "version": v.version,
                "origin": v.origin,
                "derived_from": v.derived_from,
                "chain_id": chain.root_id,
                "chain_name": chain.name,
                "translation_status": v.translation_status,
                "accepted_without_review": v.document_id
                in facts.accepted_without_review,
                "latest_review_decision": v.latest_decision,
                "is_newest_in_chain": v.document_id == chain.newest.document_id,
                "matches_filter": True,
                "last_activity_at": version_activity[v.document_id],
                "acceptance": _acceptance(facts, v.document_id),
                "discarded": _discard(facts, v.document_id),
            }
            for chain in chains
            for v in chain.versions
        ],
        "parallel_roots": parallel,
        "work": [_work_item(ctx, item, version_of) for item in active],
        # Revoked assignments moved to a newer version (Text versions "moved
        # to v2"); never part of ``work``, which holds active work only.
        "moved_work": [
            _work_item(ctx, item, version_of)
            for item in sorted(row_assignments, key=lambda a: a.assignment_id)
            if item.revoked and item.assignment_id in ctx.moved_to
        ],
        "final": final,
        "issues": [item for item in issues_and_notes if item["category"] is not None],
        "notes": [item for item in issues_and_notes if item["category"] is None],
        "missing_final": {"counts": counts, "reason": reason},
        "categories": sorted(categories),
        "bulk": {"document_id": bulk_document, "mode": bulk_mode},
        "open": {
            "document_id": open_document,
            "reason": open_reason,
            "label": (
                rules.version_label(
                    open_chain, version_of[open_document], parallel=parallel
                )
                if open_chain is not None
                else None
            ),
        },
        "own_open_assignment_id": own_open[0].assignment_id if own_open else None,
        "last_activity_at": _latest(
            [*version_activity.values(), facts.selection_activity.get(key)]
        ),
        "pinned": False,
        "retained": False,
        "matches_decision": True,
        "problem_reports": facts.row_reports.get(key, []),
        "next_step": steps[0] if steps else None,
        "steps": steps,
        "plan_row": {
            "review": flags.review,
            "annotate": flags.annotate,
            "review_applicable": not is_source,
            "discarded": discarded,
            "decided": not ctx.undecided(key),
        },
        "in_plan": ctx.in_plan[key],
        "stages": {
            name: stages.cell_view(getattr(row_cells, name), ctx.person_of)
            for name in ("review", "annotation", "final")
        },
        "version_marker": stages.version_marker(live or chains),
        # NEW (spec VD6): a lead-owned next step (undecided rows included, V10)
        # with activity by others since the start of the previous visit.
        "new": (
            ctx.segments[key] in _LEAD_OWNED
            and others_at is not None
            and facts.baseline_at is not None
            and others_at > facts.baseline_at
        ),
        "others_activity_at": others_at,
        # Pre-check only (facet, filter); exact after paging.
        "flagged_unclear": 1 if flagged_round is not None else 0,
        "flagged_group_id": None,
        "flagged_round_id": flagged_round,
    }


def _consolidation_flags(facts: RowFacts, live: Sequence[rules.Chain]) -> str | None:
    """The submitted consolidation round of the row's current version (the
    target of each live chain, as the final panel compares; the first chain
    with one) whose decisions pass the "guidelines unclear" pre-check
    (acceptance fixes X5). The counts and the group of that one round are
    filled for the shown rows after paging (``fill_consolidation_flags``)."""
    for chain in live:
        current = [v for v in chain.versions if not v.not_newer] or [chain.newest]
        flagged = facts.consolidation_flags.get(current[-1].document_id)
        if flagged is not None:
            return flagged.round_id
    return None


def _work_item(
    ctx: _Context,
    item: rules.AssignmentFact,
    version_of: Mapping[str, rules.Version],
) -> dict[str, Any]:
    """``WorkItemView`` fields of one assignment of the row."""
    moved = ctx.moved_to.get(item.assignment_id)
    moved_version = ctx.version_by_id.get(moved) if moved is not None else None
    return {
        "assignment_id": item.assignment_id,
        "document_id": item.document_id,
        "version": version_of[item.document_id].version,
        "author_label": item.pseudonym,
        "is_me": item.user_id == ctx.facts.viewer_user_id,
        "person": ctx.person(item.user_id, item.pseudonym),
        "task": item.task,
        "status": item.status,
        "held": item.held,
        "lead_correction": item.lead_correction,
        "round_ordinal": (
            ctx.ordinals.get(item.active_round_id)
            if item.active_round_id is not None
            else None
        ),
        "round_state": (
            ctx.rounds[item.active_round_id].state
            if item.active_round_id in ctx.rounds
            else None
        ),
        "moved_to_version": (
            moved_version.version if moved_version is not None else None
        ),
    }


# Segments of lead-owned next steps (kinds ``decision`` and ``assign``).
_LEAD_OWNED = frozenset({"decision", "assign"})


def _open(item: rules.AssignmentFact) -> bool:
    """Not revoked and not (cleanly) submitted: held work still counts."""
    return not item.revoked and (item.status != "submitted" or item.held)


def _owner(
    ctx: _Context, kind: steps_rules.StepKind, work: Sequence[rules.AssignmentFact]
) -> dict[str, Any]:
    """Waiting on: the lead for decision and assign steps, else every person
    of ``work`` in assignment order (VD8)."""
    if kind in ("decision", "assign"):
        viewer = ctx.viewer()
        return {"kind": "you", "person": viewer, "count": 1, "people": [viewer]}
    people: dict[int, rules.AssignmentFact] = {}
    for item in work:
        people.setdefault(item.user_id, item)
    refs = [ctx.person(item.user_id, item.pseudonym) for item in people.values()]
    if not refs:
        return {"kind": "none", "person": None, "count": 0, "people": []}
    if len(refs) > 1:
        return {"kind": "people", "person": None, "count": len(refs), "people": refs}
    (person,) = refs
    return {
        "kind": "you" if person["is_me"] else "person",
        "person": person,
        "count": 1,
        "people": refs,
    }


def _detail(kind: str, **values: Any) -> dict[str, Any]:
    return {
        "kind": kind,
        "version": None,
        "origin": None,
        "translation_status": None,
        "submitted": None,
        "total": None,
        "round_ordinal": None,
        "excerpt": None,
        "reporter": None,
        "task_paused": False,
        **values,
    }


def _version_detail(kind: str, version: rules.Version | None) -> dict[str, Any]:
    if version is None:
        return _detail(kind)
    return _detail(
        kind,
        version=version.version,
        origin=version.origin,
        translation_status=version.translation_status,
    )


def _step_work(
    code: str,
    *,
    reviews: Sequence[rules.AssignmentFact],
    open_annotations: Sequence[rules.AssignmentFact],
    consolidations: Sequence[rules.AssignmentFact],
) -> Sequence[rules.AssignmentFact]:
    """The work items whose people own an in-progress step."""
    if code == "translation_review_in_progress":
        return reviews
    if code == "annotation_in_progress":
        return open_annotations
    if code == "consolidation_in_progress":
        return consolidations
    return ()


# Resolutions that settle a submission on an old version for any target
# (rule 3b; the spec names carried, a handover settles it as well). A
# dismissal settles it only for the version it was dismissed on.
_SETTLED = frozenset({"carried", "handed_over"})


def _ancestors(
    target: rules.Version, version_of: Mapping[str, rules.Version]
) -> dict[str, rules.Version]:
    """Exact correction ancestors of ``target`` (I2, as
    ``text_changes.is_exact_ancestor``): each step a correction of the same
    text whose version is one higher than its parent's."""
    result: dict[str, rules.Version] = {}
    current = target
    while current.origin == "correction":
        parent = version_of.get(current.derived_from or "")
        if (
            parent is None
            or parent.document_id in result
            or (
                parent.external_id,
                parent.version + 1,
            )
            != (current.external_id, current.version)
        ):
            break
        result[parent.document_id] = parent
        current = parent
    return result


@dataclass(frozen=True)
class _OldWork:
    """Annotation work on exact ancestors of the row's targets (V5)."""

    old_open: tuple[steps_rules.OldItem, ...]
    old_submitted: tuple[steps_rules.OldItem, ...]
    finishing: tuple[steps_rules.OldItem, ...]
    # Per target: people with waiting old-version work and no annotate
    # assignment on that target (VD22).
    waiting: tuple[int, ...]
    # Old assignment id -> the target its work belongs to.
    target_of: dict[int, rules.Version]


def _old_work(
    ctx: _Context,
    live: Sequence[rules.Chain],
    targets: Sequence[rules.Version],
    annotations: Sequence[rules.AssignmentFact],
) -> _OldWork:
    """Rules 3a / 3b items and finish_then_carry items per target.

    ``annotations`` are the row's non-revoked annotate assignments on live
    versions. A held old task is decided through its report first (I5): it
    is no 3a item but still waits, so it counts for rule 8. Old open work of a
    person who already holds the target is no 3a item either.
    """
    version_of = {v.document_id: v for chain in live for v in chain.versions}
    old_open: list[steps_rules.OldItem] = []
    old_submitted: list[steps_rules.OldItem] = []
    finishing: list[steps_rules.OldItem] = []
    waiting: list[int] = []
    target_of: dict[int, rules.Version] = {}
    for target in targets:
        ancestors = _ancestors(target, version_of)
        holders = {
            item.user_id
            for item in annotations
            if item.document_id == target.document_id
        }
        people: set[int] = set()
        for item in annotations:
            old = ancestors.get(item.document_id)
            if old is None:
                continue
            target_of[item.assignment_id] = target
            entry = steps_rules.OldItem(
                item.user_id, old.version, assignment_id=item.assignment_id
            )
            if _open(item):
                if item.held or item.user_id in holders:
                    # A holder of the target cannot move there (the move
                    # would fail ASSIGNMENT_EXISTS): no 3a item.
                    pass
                elif ctx.resolution_of.get(item.assignment_id) == "finish_then_carry":
                    finishing.append(entry)
                else:
                    old_open.append(entry)
                people.add(item.user_id)
                continue
            submission = ctx.facts.last_submissions.get(item.assignment_id)
            if (
                submission is None
                or item.user_id in holders
                or ctx.submission_resolutions.get(submission, set()) & _SETTLED
                or target.document_id in ctx.dismissed_to.get(submission, set())
            ):
                continue
            old_submitted.append(replace(entry, submission_id=submission))
            people.add(item.user_id)
        waiting.append(len(people - holders))
    return _OldWork(
        tuple(old_open),
        tuple(old_submitted),
        tuple(finishing),
        tuple(waiting),
        target_of,
    )


def _row_steps(
    ctx: _Context,
    key: RowKey,
    *,
    live: Sequence[rules.Chain],
    active: Sequence[rules.AssignmentFact],
    review: bool,
    annotate: bool,
    is_source: bool,
    missing_final: bool,
    final: Mapping[str, Any] | None,
    decided: bool = True,
) -> list[dict[str, Any]]:
    """Next step (first) and further steps of a row; fills the ctx side tables
    (stage cells included)."""
    facts = ctx.facts
    # Newest version of each live root, corrections that are not newer skipped.
    targets = [[v for v in c.versions if not v.not_newer][-1] for c in live]
    live_ids = {v.document_id for c in live for v in c.versions}
    current = [item for item in active if item.document_id in live_ids]
    reviews = [
        item
        for item in current
        if item.task == "translation_review" and item.status != "submitted"
    ]
    annotations = [item for item in current if item.task == "annotate"]
    open_annotations = [item for item in annotations if _open(item)]
    # D1: every review task is a consolidation.
    consolidations = [item for item in current if item.task == "review" and _open(item)]
    warnings = ctx.warnings.get(key, [])
    report_id = next(
        (w.get("report_id") for w in warnings if w["code"] == "OPEN_PROBLEM_REPORT"),
        None,
    )
    paused_id = next(
        (
            w.get("assignment_id")
            for w in warnings
            if w["code"] == "TASK_PAUSED_WITHOUT_REPORT"
        ),
        None,
    )
    per_target = [
        sum(1 for item in annotations if item.document_id == target.document_id)
        for target in targets
    ]
    old_work = _old_work(ctx, live, targets, annotations)
    # Rule 8 compares annotation_assignments + pending_old_people with
    # "Annotations per text": the pair adds up to the minimum over the
    # targets of assignments plus waiting people (VD22).
    assigned_min = min(per_target, default=0)
    pending_old_people = (
        min(
            (n + w for n, w in zip(per_target, old_work.waiting, strict=True)),
            default=0,
        )
        - assigned_min
    )
    # Rule 6a: unresolved source changes on the newest translation versions.
    obligations = (
        []
        if is_source
        else [
            (chain.newest, obligation)
            for chain in live
            for obligation in facts.source_obligations.get(chain.newest.document_id, ())
        ]
    )
    source_versions = [
        ctx.version_by_id[obligation.old_source_document_id].version
        for _, obligation in obligations
        if obligation.old_source_document_id in ctx.version_by_id
    ]
    # Rule 6 points at the first target that still needs a reviewer.
    needs_reviewer = next(
        (
            v
            for v in targets
            if v.translation_status in steps_rules.REVIEWER_NEEDED_STATUSES
            or v.translation_status is None
        ),
        None,
    )
    step_facts = steps_rules.StepFacts(
        review=review,
        annotate=annotate,
        is_source=is_source,
        rule_on=facts.rule_on,
        per_text=facts.annotations_per_text,
        open_report_id=report_id,
        orphan_pause_assignment_id=paused_id,
        unacknowledged_final_cause=any(
            w["code"] in rules.ACKNOWLEDGEABLE for w in warnings
        ),
        # Rule 4 looks at each live root's literal newest version.
        newest_decisions=tuple(
            c.newest.latest_decision
            if c.newest.translation_status == "reviewed"
            else None
            for c in live
        )
        if not is_source
        else (None,),
        translation_statuses=tuple(v.translation_status for v in targets)
        if not is_source
        else (None,),
        open_translation_reviews=len(reviews),
        annotation_assignments=assigned_min,
        open_annotations=len(open_annotations),
        open_consolidations=len(consolidations),
        missing_final=missing_final,
        has_final=final is not None,
        check_failed=needs_reviewer is not None
        and needs_reviewer.translation_status == "automatic_check_failed",
        decided=decided,
        old_open=old_work.old_open,
        old_submitted=old_work.old_submitted,
        finishing=old_work.finishing,
        pending_old_people=pending_old_people,
        source_changed=bool(obligations),
    )
    ctx.flags[key] = (review, annotate)
    ctx.step_facts[key] = step_facts
    ctx.in_plan[key] = steps_rules.in_plan(step_facts)
    derived = steps_rules.derive_steps(step_facts, row=key)
    ctx.segments[key] = steps_rules.segment_of(derived[0]) if derived else None
    ctx.cells[key] = cells_rules.stage_cells(
        stages.stage_facts(
            ctx,
            key,
            live=live,
            targets=targets,
            current=current,
            step_facts=step_facts,
            final=final,
            source_changed_from=min(source_versions, default=None),
        ),
        derived,
    )

    def first(predicate: Callable[[rules.Version], bool]) -> rules.Version | None:
        return next(
            (v for v in targets if predicate(v)), targets[0] if targets else None
        )

    version_of = {v.document_id: v for c in live for v in c.versions}
    target_ids = {v.document_id for v in targets}
    on_targets = [item for item in annotations if item.document_id in target_ids]
    submitted = sum(
        1 for item in on_targets if item.status == "submitted" and not item.held
    )
    total = max(facts.annotations_per_text * len(targets), len(on_targets))
    # Waiting on of an in-progress step: the people of every in-progress
    # step of the row (VD8, scenario 16).
    in_progress_work = [
        item
        for step in derived
        if step.kind == "in_progress"
        for item in _step_work(
            step.code,
            reviews=reviews,
            open_annotations=open_annotations,
            consolidations=consolidations,
        )
    ]
    views: list[dict[str, Any]] = []
    for step in derived:
        work: Sequence[rules.AssignmentFact] = ()
        version: rules.Version | None = first(lambda v: True)
        detail: dict[str, Any]
        step_report: str | None = None
        assignment_id: int | None = None
        code = step.code
        if code in ("handle_text_change", "carry_text_change"):
            # The old work item; ``document_id`` is the target it moves or
            # carries to, the detail names the old version.
            assignment_id = step.assignment_id
            old_item = ctx.assignment_by_id.get(assignment_id or 0)
            version = old_work.target_of.get(assignment_id or 0, version)
            detail = _version_detail(
                "version",
                version_of.get(old_item.document_id) if old_item else None,
            )
        elif code == "review_source_change":
            version = obligations[0][0] if obligations else version
            detail = _version_detail("version", version)
        elif code == "decide_report":
            step_report = report_id
            report = facts.reports.get(report_id) if report_id else None
            assignment_id = report.assignment_id if report else None
            detail = _detail(
                "report",
                excerpt=report.excerpt[:STEP_EXCERPT_LENGTH] if report else None,
                reporter=(
                    ctx.person(report.reporter_id, report.reporter_label)
                    if report and report.reporter_id is not None
                    else None
                ),
                task_paused=bool(report and report.task_state == "paused"),
            )
        elif code == "resume_task":
            assignment_id = paused_id
            detail = _detail("report", task_paused=True)
        elif code in ("confirm_final", "done"):
            detail = _detail(
                "final",
                version=final["version"] if final else None,
                round_ordinal=final["round_ordinal"] if final else None,
            )
        elif code in ("resolve_rejected", "resolve_queried"):
            version = first(lambda v: v.translation_status == "reviewed")
            detail = _version_detail("version", version)
        elif code == "assign_translation_review":
            version = needs_reviewer or version
            detail = _version_detail("version", version)
        elif code == "translation_review_in_progress":
            work = _step_work(
                code,
                reviews=reviews,
                open_annotations=open_annotations,
                consolidations=consolidations,
            )
            version = version_of.get(reviews[0].document_id, version)
            detail = _version_detail("version", version)
        elif code in ("translation_not_accepted", "waiting_for_translation_review"):
            version = first(lambda v: v.translation_status != "accepted")
            detail = _version_detail(
                "version" if code == "translation_not_accepted" else "waiting",
                version,
            )
        elif code == "needs_attention":
            detail = _version_detail("version", version)
        elif code == "translation_accepted":
            detail = _version_detail("review_only", version)
        elif code == "choose_final":
            detail = _detail("annotations_submitted", submitted=submitted, total=total)
        elif code == "assign_annotation":
            detail = (
                _detail("source_ready")
                if is_source
                else _version_detail("version", version)
            )
        else:  # annotation_in_progress, consolidation_in_progress
            work = _step_work(
                code,
                reviews=reviews,
                open_annotations=open_annotations,
                consolidations=consolidations,
            )
            rounds = {
                ctx.ordinals.get(item.active_round_id)
                for item in work
                if item.active_round_id is not None
            }
            ordinal = next(iter(rounds)) if len(rounds) == 1 else None
            detail = (
                _detail("round", round_ordinal=ordinal)
                if ordinal is not None
                else _detail("annotations_submitted", submitted=submitted, total=total)
            )
        owner = _owner(
            ctx, step.kind, in_progress_work if step.kind == "in_progress" else work
        )
        if not views:
            ctx.owners[key] = frozenset(
                person["pseudonym"] for person in owner["people"]
            )
        views.append(
            {
                "code": code,
                "kind": step.kind,
                "stage": step.stage,
                "action": step.action,
                "badges": list(step.badges),
                "assigned": step.assigned,
                "target": step.target,
                "owner": owner,
                "detail": detail,
                "report_id": step_report,
                "assignment_id": assignment_id,
                "submission_id": step.submission_id,
                "document_id": version.document_id if version is not None else None,
            }
        )
    if not views:
        ctx.owners[key] = frozenset()
    return views


def _version_matches(
    facts: RowFacts, query: RowQuery, row: Mapping[str, Any], version: Mapping[str, Any]
) -> bool:
    if query.origin and version["origin"] not in query.origin:
        return False
    if query.translation_status is not None:
        if query.translation_status == "accepted_without_review":
            if not version["accepted_without_review"]:
                return False
        elif version["translation_status"] != query.translation_status:
            return False
    return query.q is None or _search_matches(query.q, row, version)


def _search_matches(q: str, row: Mapping[str, Any], version: Mapping[str, Any]) -> bool:
    """Prefix of case ID, external ID or document ID, or the text label form
    "case-104 de" / "case-104 · de" (case prefix, exact language; VD11)."""
    case_id = row["case_id"]
    if rules.prefix_matches(
        q, [case_id, version["external_id"], version["document_id"]]
    ):
        return True
    label = rules.split_text_label(q)
    return (
        label is not None
        and row["language"] == label[1]
        and rules.prefix_matches(label[0], [case_id])
    )


# Plan filter: an exclusive partition of the rows by their effective flags;
# ``not_decided`` additionally marks undecided rows (VD3), which are
# ``not_in_plan`` too.
_PLAN_OPTIONS: dict[tuple[bool, bool], str] = {
    (True, False): "review",
    (False, True): "annotate",
    (True, True): "review_and_annotate",
    (False, False): "not_in_plan",
}


def _plan_values(ctx: _Context, key: RowKey) -> tuple[str, ...]:
    option = _PLAN_OPTIONS[ctx.flags[key]]
    return (option, "not_decided") if ctx.undecided(key) else (option,)


def _plan_matches(ctx: _Context, key: RowKey, query: RowQuery) -> bool:
    return not query.plan or not set(_plan_values(ctx, key)).isdisjoint(query.plan)


def _waiting_values(ctx: _Context, key: RowKey) -> tuple[str, ...]:
    """Waiting-on facet values: "me" for the lead, else pseudonyms."""
    viewer = ctx.facts.viewer_pseudonym
    return tuple(
        "me" if pseudonym == viewer else pseudonym
        for pseudonym in sorted(ctx.owners[key])
    )


# Tasks whose hold pauses the row (Progress "Paused by a problem report").
_PAUSABLE = frozenset({"annotate", "review"})


def is_paused(row: Mapping[str, Any]) -> bool:
    """The row has a held annotate or review task (filter ``paused``)."""
    return any(item["held"] and item["task"] in _PAUSABLE for item in row["work"])


def _row_level_matches(ctx: _Context, row: Mapping[str, Any], query: RowQuery) -> bool:
    key = (row["case_id"], row["language"])
    if query.language and row["language"] not in query.language:
        return False
    if query.case is not None and row["case_id"] != query.case:
        return False
    if not _plan_matches(ctx, key, query):
        return False
    for name in ("review", "annotation", "final"):
        selected = getattr(query, f"{name}_state")
        if selected and row["stages"][name]["state"] not in selected:
            return False
    if query.flags and not row["flagged_unclear"]:
        return False
    if query.waiting_on:
        viewer = ctx.facts.viewer_pseudonym
        wanted = {viewer if item == "me" else item for item in query.waiting_on}
        if wanted.isdisjoint(ctx.owners[key]):
            return False
    if query.step and not any(step["code"] in query.step for step in row["steps"]):
        return False
    step = row["next_step"]
    if query.stage and (step is None or step["stage"] not in query.stage):
        return False
    if query.paused is not None and is_paused(row) != (query.paused == "yes"):
        return False
    if query.owner is not None:
        owner = ctx.facts.viewer_pseudonym if query.owner == "me" else query.owner
        if owner not in ctx.owners[key]:
            return False
    if query.status is not None:
        work = row["work"]
        if query.status == "unassigned":
            return not work
        if query.status == "held":
            return any(item["held"] for item in work)
        return any(item["status"] == query.status for item in work)
    return True


def _filtered(ctx: _Context, row: Mapping[str, Any], query: RowQuery) -> bool:
    """The row matches the non-decision filters (no ``matches_filter`` marks)."""
    return _row_level_matches(ctx, row, query) and any(
        _version_matches(ctx.facts, query, row, version) for version in row["versions"]
    )


def _apply_filters(ctx: _Context, row: dict[str, Any], query: RowQuery) -> bool:
    """Mark matching versions; True when the row matches the non-decision filters."""
    row_level = _row_level_matches(ctx, row, query)
    for version in row["versions"]:
        version["matches_filter"] = row_level and _version_matches(
            ctx.facts, query, row, version
        )
    return any(version["matches_filter"] for version in row["versions"])


def _no_final(ctx: _Context, key: RowKey) -> bool:
    """Filter "Final result: none": Annotate on and no (live) final result."""
    return ctx.flags[key][1] and not ctx.has_final[key]


def _in_segment(ctx: _Context, key: RowKey, segment: str) -> bool:
    """The row is under the tab ``segment``: the segment of its next step
    (undecided rows: ``decision``, V10); ``done`` = in-plan rows whose next
    step kind is done."""
    if segment == "done":
        return ctx.in_plan[key] and ctx.segments[key] is None
    return ctx.segments[key] == segment


def _in_active_segment(
    ctx: _Context, key: RowKey, row: Mapping[str, Any], query: RowQuery
) -> bool:
    """Row counts toward the "n" of the bar's "k of n shown" for ``query``.

    No segment is the All tab: every row, in plan or not (VD7).
    """
    if query.segment is not None:
        return _in_segment(ctx, key, query.segment)
    if query.decision is not None:
        if not row["in_plan"]:
            return False
        if query.decision == "all":
            return bool(row["categories"])
        return query.decision in row["categories"]
    return True


def _matches_decision(
    ctx: _Context, key: RowKey, row: Mapping[str, Any], query: RowQuery
) -> bool:
    """Decision-like filters (bar segment, category, final result)."""
    if query.final == "missing" and ctx.has_final[key]:
        return False
    if query.final == "none" and not _no_final(ctx, key):
        return False
    if query.final == "any" and not ctx.has_final[key]:
        return False
    if query.segment is not None and not _in_segment(ctx, key, query.segment):
        return False
    if query.decision is None:
        return True
    if query.decision == "all":
        return bool(row["categories"])
    return query.decision in row["categories"]


def _matches(ctx: _Context, row: dict[str, Any], query: RowQuery) -> bool:
    """The row is listed for ``query`` (filters and decision-like filters)."""
    key = (row["case_id"], row["language"])
    filtered = _apply_filters(ctx, row, query)
    return filtered and _matches_decision(ctx, key, row, query)


def _shown(ctx: _Context, key: RowKey, row: Mapping[str, Any], query: RowQuery) -> bool:
    """The row counts in ``bar.shown`` for ``query`` (no marks)."""
    return (
        _filtered(ctx, row, query)
        and _matches_decision(ctx, key, row, query)
        and _in_active_segment(ctx, key, row, query)
    )


def _facets(
    ctx: _Context,
    rows: Mapping[RowKey, dict[str, Any]],
    query: RowQuery,
    shown: Mapping[RowKey, bool],
) -> dict[str, dict[str, int]]:
    """Facet counts of the filter popover (``document_row_facets``).

    ``shown``: the rows counted in ``bar.shown`` for ``query``; a group
    without a selection reuses it, only a group with a selection re-evaluates
    the rows without its own selection.
    """
    no_origin = replace(query, origin=())

    def values(key: RowKey, group: facets.FacetGroup) -> tuple[str, ...]:
        row = rows[key]
        return facets.facet_values(
            row,
            group,
            origins=lambda: [
                version["origin"]
                for version in row["versions"]
                if _version_matches(ctx.facts, no_origin, row, version)
            ],
            plan=lambda: _plan_values(ctx, key),
            waiting_on=lambda: _waiting_values(ctx, key),
        )

    selected: dict[facets.FacetGroup, tuple[str, ...]] = {
        group: tuple(getattr(query, group)) for group in facets.FACET_GROUPS
    }

    def matches_without(group: facets.FacetGroup) -> Callable[[RowKey], bool]:
        if not selected[group]:
            return lambda key: shown[key]
        without = replace(query, **{str(group): ()})  # type: ignore[arg-type]
        return lambda key: _shown(ctx, key, rows[key], without)

    counts = facets.facet_counts(rows, values, matches_without, selected)
    return {str(group): value for group, value in counts.items()}


def _retain_keys(query: RowQuery) -> set[RowKey]:
    keys: set[RowKey] = set()
    for item in query.retain:
        case_id, separator, language = item.rpartition(":")
        if separator and case_id and language:
            keys.add((case_id, language))
    return keys


def _sort_cases(facts: RowFacts, case_ids: Iterable[str], sort: str) -> list[str]:
    """Case IDs in list order: Case ID (``-case`` descending), import (lowest
    position) or last activity (newest first; ``-activity`` oldest first;
    cases without activity last)."""
    ids = list(case_ids)
    if sort == "-case":
        return sorted(ids, reverse=True)
    return sorted(ids, key=_case_order(facts, sort))


def _case_order(facts: RowFacts, sort: str) -> Callable[[str], tuple[Any, ...]]:
    """Sort key of a case: Case ID, import (lowest position) or last activity."""
    if sort == "case":
        return lambda case_id: (case_id,)
    if sort == "import":
        positions: dict[str, int] = {}
        for version in facts.versions:
            if version.position is not None:
                current = positions.get(version.case_id)
                if current is None or version.position < current:
                    positions[version.case_id] = version.position

        def by_import(case_id: str) -> tuple[Any, ...]:
            position = positions.get(case_id)
            return (position is None, position or 0, case_id)

        return by_import
    activity: dict[str, datetime] = {}

    def note(case_id: str, at: datetime | None) -> None:
        if at is not None and (case_id not in activity or at > activity[case_id]):
            activity[case_id] = at

    for version in facts.versions:
        note(version.case_id, facts.last_activity.get(version.document_id))
    for (case_id, _language), at in facts.selection_activity.items():
        note(case_id, at)
    sign = 1.0 if sort == "-activity" else -1.0

    def by_activity(case_id: str) -> tuple[Any, ...]:
        at = activity.get(case_id)
        return (at is None, sign * at.timestamp() if at is not None else 0.0, case_id)

    return by_activity


def _evaluate(
    facts: RowFacts, query: RowQuery
) -> tuple[_Context, dict[RowKey, dict[str, Any]], dict[RowKey, tuple[bool, bool]]]:
    """Every row with its (filters, decision filters) match."""
    ctx = _Context(facts)
    rows = {key: _build_row(ctx, *key) for key in sorted(ctx.by_row)}
    matches = {
        key: (_apply_filters(ctx, row, query), _matches_decision(ctx, key, row, query))
        for key, row in rows.items()
    }
    return ctx, rows, matches


class RowContext:
    """Every row of one project state, built once, for readers outside the page.

    ``rows`` are the Documents row dictionaries; ``versions``, ``assignments``,
    ``flags`` and ``discarded`` are the lookups the rows were built from.
    """

    def __init__(self, facts: RowFacts) -> None:
        self._ctx = _Context(facts)
        self.rows: dict[RowKey, dict[str, Any]] = {
            key: _build_row(self._ctx, *key) for key in sorted(self._ctx.by_row)
        }
        self.versions: Mapping[RowKey, list[rules.Version]] = self._ctx.by_row
        self.assignments: Mapping[str, list[rules.AssignmentFact]] = (
            self._ctx.assignments
        )
        # Effective (review, annotate) flags per row.
        self.flags: Mapping[RowKey, tuple[bool, bool]] = self._ctx.flags
        self.discarded: frozenset[str] = self._ctx.dropped

    def cases_not_shown(self, case_ids: Sequence[str], query: RowQuery) -> int:
        """Selected cases without any row matching the filters of ``query``.

        Reuses the built rows (no second derivation); marks their versions'
        ``matches_filter`` for ``query``.
        """
        shown = {
            key[0] for key, row in self.rows.items() if _matches(self._ctx, row, query)
        }
        return sum(1 for case_id in dict.fromkeys(case_ids) if case_id not in shown)

    def states(self) -> list[RowState]:
        """Every row with its step facts, in (case, language) order."""
        ctx = self._ctx
        return [
            RowState(
                key=key,
                row=row,
                step_facts=ctx.step_facts[key],
                segment=ctx.segments[key],
                review=ctx.flags[key][0],
                annotate=ctx.flags[key][1],
                has_final=ctx.has_final[key],
            )
            for key, row in self.rows.items()
        ]


def row_matches(context: RowContext, row: dict[str, Any], query: RowQuery) -> bool:
    """The Documents row predicate: ``row`` is listed for ``query``.

    One predicate for the table, the filtered case IDs, the selection summary
    and the Progress counts (follow-up spec FD11); ``bar.shown`` counts the
    matching rows that are in the plan and in the active segment. Marks the
    row's versions' ``matches_filter`` for ``query``.
    """
    return _matches(context._ctx, row, query)


def row_context(facts: RowFacts) -> RowContext:
    """Every row of ``facts`` with the lookups they were built from."""
    return RowContext(facts)


@dataclass(frozen=True)
class RowState:
    """One row as the Documents derivation sees it (Progress counts these)."""

    key: RowKey
    row: dict[str, Any]
    step_facts: steps_rules.StepFacts
    segment: steps_rules.Segment | None
    review: bool  # effective flags (sources never review, discarded rows off)
    annotate: bool
    has_final: bool  # a live final result


def _matching_cases(facts: RowFacts, query: RowQuery) -> set[str]:
    _, _, matches = _evaluate(facts, query)
    return {
        key[0] for key, (filtered, decision) in matches.items() if filtered and decision
    }


def case_ids(facts: RowFacts, query: RowQuery) -> tuple[list[str], int, bool]:
    """Filtered case IDs in list order, at most ``MAX_CASE_IDS``."""
    ids = _sort_cases(facts, _matching_cases(facts, query), query.sort)
    return ids[:MAX_CASE_IDS], len(ids), len(ids) > MAX_CASE_IDS


def sorted_case_ids(facts: RowFacts, case_ids: Sequence[str], sort: str) -> list[str]:
    """``case_ids`` (deduplicated) in Documents order; unknown IDs last, as given."""
    known = {version.case_id for version in facts.versions}
    unique = list(dict.fromkeys(case_ids))
    ordered = _sort_cases(
        facts, (case_id for case_id in unique if case_id in known), sort
    )
    return ordered + [case_id for case_id in unique if case_id not in known]


def cases_not_shown(facts: RowFacts, case_ids: Sequence[str], query: RowQuery) -> int:
    """Selected cases without any row matching the filters of ``query``."""
    shown = _matching_cases(facts, query)
    return sum(1 for case_id in dict.fromkeys(case_ids) if case_id not in shown)


def needs_decision(facts: RowFacts) -> int:
    """Rows whose next step needs the lead's decision, undecided rows
    included (V10): ``bar.needs_decision`` without filters, facets or pages."""
    ctx = _Context(facts)
    for key in ctx.by_row:
        _build_row(ctx, *key)
    return sum(1 for segment in ctx.segments.values() if segment == "decision")


def build_page(facts: RowFacts, query: RowQuery) -> dict[str, Any]:
    return build_page_with_context(facts, query)[0]


def build_page_with_context(
    facts: RowFacts, query: RowQuery
) -> tuple[dict[str, Any], _Context]:
    """``build_page`` and the context its rows were built from."""
    ctx, rows, matches = _evaluate(facts, query)

    # Category counts cover rows in the plan only; the tabs (segment_counts)
    # ignore filters and search and count every row (``all``).
    bar: dict[str, Any] = dict(
        rules.bar_counts(
            set(row["categories"]) for row in rows.values() if row["in_plan"]
        )
    )
    bar["no_final"] = sum(1 for key in rows if _no_final(ctx, key))
    # Rows with a final result in the whole project (FD12: the Export link).
    bar["finals"] = sum(1 for key in rows if ctx.has_final[key])
    bar.update(
        rules.segment_counts(
            (
                row["in_plan"],
                ctx.segments[key],
                row["next_step"]["code"] if row["next_step"] else None,
            )
            for key, row in rows.items()
        )
    )

    retain = _retain_keys(query)
    pinned_key = (
        (query.case, query.language[0])
        if query.case is not None and len(query.language) == 1
        else None
    )
    shown_rows: dict[RowKey, dict[str, Any]] = {}
    shown: dict[RowKey, bool] = {}
    for key, row in rows.items():
        filtered, decision = matches[key]
        row["matches_decision"] = decision
        # "k of n shown": every filter applies, the final filter included.
        shown[key] = filtered and decision and _in_active_segment(ctx, key, row, query)
        if key == pinned_key:
            row["pinned"] = True
            shown_rows[key] = row
        elif filtered and decision:
            shown_rows[key] = row
        elif filtered and key in retain:
            row["retained"] = True
            shown_rows[key] = row
    bar["shown"] = sum(shown.values())
    # Filter popover: counts under the tab, search and every other group.
    bar["facets"] = _facets(ctx, rows, query, shown)

    by_case: dict[str, list[RowKey]] = {}
    for key in rows:
        by_case.setdefault(key[0], []).append(key)

    def row_order(row: Mapping[str, Any]) -> tuple[bool, str]:
        return (not row["is_source"], row["language"])

    shown_cases = _sort_cases(facts, {key[0] for key in shown_rows}, query.sort)
    groups = []
    for case_id in shown_cases:
        all_rows = sorted((rows[key] for key in by_case[case_id]), key=row_order)
        members = [
            row for row in all_rows if (row["case_id"], row["language"]) in shown_rows
        ]
        groups.append(
            {
                "case_id": case_id,
                "rows": members,
                "language_count": len(all_rows),
                "final_count": sum(1 for row in all_rows if row["final"] is not None),
                "issue_count": sum(len(row["issues"]) for row in all_rows),
                "note_count": sum(
                    1
                    for row in all_rows
                    for item in row["notes"]
                    if item["code"] not in _WAITING
                ),
                "last_activity_at": _latest(
                    row["last_activity_at"] for row in all_rows
                ),
                "has_issue": any(row["categories"] for row in all_rows),
                "plan_revision": facts.revisions.get(case_id, 1),
                "not_in_plan_languages": [
                    row["language"] for row in all_rows if not row["in_plan"]
                ],
            }
        )
    group_count = len(groups)
    page_count = max(1, -(-group_count // PAGE_SIZE))
    start = (query.page - 1) * PAGE_SIZE
    page = {
        "groups": groups[start : start + PAGE_SIZE],
        "page": query.page,
        "page_count": page_count,
        "group_count": group_count,
        "bar": bar,
        "case_found": query.case is None or query.case in by_case,
        "adjudicator_not_annotator": facts.adjudicator_not_annotator,
    }
    return page, ctx
