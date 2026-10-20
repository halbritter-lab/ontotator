"""Rows and pages of the lead's Documents table, built from facts (no SQL).

Every rule lives in ``domain/document_rows.py``; this module only assembles
the row and page dictionaries of the Documents read API.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping, Sequence
from datetime import datetime
from typing import TYPE_CHECKING, Any

from ontocurator.domain import document_rows as rules
from ontocurator.domain import next_steps as steps_rules
from ontocurator.domain.document_rows import PAGE_SIZE
from ontocurator.domain.work_plans import PlanFlags
from ontocurator.domain.work_plans import RowKey as PlanKey

if TYPE_CHECKING:
    from ontocurator.application.document_rows import RowFacts, RowQuery

# The preflight's unconditional omission; Documents uses its own MISSING_FINAL.
_PREFLIGHT_ONLY = frozenset({"MISSING_FINAL_SELECTION"})
# Shown as the row's waiting line, never counted as a note.
_WAITING = frozenset({"ROUND_REVIEW_PENDING"})
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
        self.segments: dict[RowKey, steps_rules.Segment | None] = {}
        self.owners: dict[RowKey, frozenset[str]] = {}
        self.in_plan: dict[RowKey, bool] = {}

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
    }


def build_row(facts: RowFacts, case_id: str, language: str) -> dict[str, Any]:
    """One (case_id, language) row; see ``build_page`` for the page context."""
    return _build_row(_Context(facts), case_id, language)


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
    submission_count = sum(
        facts.submission_counts.get(v.document_id, 0) for v in versions
    )
    # The missing-final rule holds only for rows with Annotate on.
    counts = annotate and rules.missing_final_counts(
        has_selection=selection is not None,
        submission_count=submission_count,
        assignments=row_assignments,
        per_text=facts.annotations_per_text,
    )
    reason: str | None = None
    if selection is None and not counts:
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
        final=final,
    )
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
            }
            for chain in chains
            for v in chain.versions
        ],
        "parallel_roots": parallel,
        "work": [
            {
                "assignment_id": item.assignment_id,
                "document_id": item.document_id,
                "version": version_of[item.document_id].version,
                "author_label": item.pseudonym,
                "is_me": item.user_id == facts.viewer_user_id,
                "task": item.task,
                "status": item.status,
                "held": item.held,
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
            }
            for item in active
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
        },
        "in_plan": ctx.in_plan[key],
    }


def _open(item: rules.AssignmentFact) -> bool:
    """Not revoked and not (cleanly) submitted: held work still counts."""
    return not item.revoked and (item.status != "submitted" or item.held)


def _owner(
    ctx: _Context, kind: steps_rules.StepKind, work: Sequence[rules.AssignmentFact]
) -> dict[str, Any]:
    if kind in ("decision", "assign"):
        return {"kind": "you", "person": ctx.viewer(), "count": 1}
    people: dict[int, rules.AssignmentFact] = {}
    for item in work:
        people.setdefault(item.user_id, item)
    if not people:
        return {"kind": "none", "person": None, "count": 0}
    if len(people) > 1:
        return {"kind": "people", "person": None, "count": len(people)}
    (item,) = people.values()
    person = ctx.person(item.user_id, item.pseudonym)
    return {
        "kind": "you" if person["is_me"] else "person",
        "person": person,
        "count": 1,
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
) -> list[dict[str, Any]]:
    """Next step (first) and further steps of a row; fills the ctx side tables."""
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
    open_reviews = [item for item in current if item.task == "review" and _open(item)]
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
        newest_decisions=tuple(v.latest_decision for v in targets)
        if not is_source
        else (None,),
        translation_statuses=tuple(v.translation_status for v in targets)
        if not is_source
        else (None,),
        open_translation_reviews=len(reviews),
        annotation_assignments=min(per_target, default=0),
        open_annotations=len(open_annotations),
        open_annotation_reviews=len(open_reviews),
        missing_final=missing_final,
        has_final=final is not None,
        check_failed=any(
            v.translation_status == "automatic_check_failed" for v in targets
        ),
    )
    ctx.flags[key] = (review, annotate)
    ctx.in_plan[key] = steps_rules.in_plan(step_facts)
    derived = steps_rules.derive_steps(step_facts)
    ctx.segments[key] = steps_rules.segment_of(derived[0]) if derived else None

    def first(predicate: Callable[[rules.Version], bool]) -> rules.Version | None:
        return next(
            (v for v in targets if predicate(v)), targets[0] if targets else None
        )

    version_of = {v.document_id: v for c in live for v in c.versions}
    submitted = sum(
        1 for item in annotations if item.status == "submitted" and not item.held
    )
    total = max(facts.annotations_per_text, len(annotations))
    views: list[dict[str, Any]] = []
    for step in derived:
        work: Sequence[rules.AssignmentFact] = ()
        version: rules.Version | None = first(lambda v: True)
        detail: dict[str, Any]
        step_report: str | None = None
        assignment_id: int | None = None
        code = step.code
        if code == "decide_report":
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
            version = first(
                lambda v: v.translation_status not in ("reviewed", "accepted")
            )
            detail = _version_detail("version", version)
        elif code == "translation_review_in_progress":
            work = reviews
            version = version_of.get(reviews[0].document_id, version)
            detail = _version_detail("version", version)
        elif code in ("translation_not_accepted", "waiting_for_translation_review"):
            version = first(lambda v: v.translation_status != "accepted")
            detail = _version_detail(
                "version" if code == "translation_not_accepted" else "waiting",
                version,
            )
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
        else:  # annotation_in_progress, annotation_review_in_progress
            work = (
                open_annotations if code == "annotation_in_progress" else open_reviews
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
        owner = _owner(ctx, step.kind, work)
        if not views:
            ctx.owners[key] = frozenset(
                [owner["person"]["pseudonym"]]
                if owner["person"] is not None
                else [item.pseudonym for item in work]
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
                "document_id": version.document_id if version is not None else None,
            }
        )
    if not views:
        ctx.owners[key] = frozenset()
    return views


def _version_matches(
    facts: RowFacts, query: RowQuery, case_id: str, version: Mapping[str, Any]
) -> bool:
    if query.origin is not None and version["origin"] != query.origin:
        return False
    if query.translation_status is not None:
        if query.translation_status == "accepted_without_review":
            if not version["accepted_without_review"]:
                return False
        elif version["translation_status"] != query.translation_status:
            return False
    return query.q is None or rules.prefix_matches(
        query.q, [case_id, version["external_id"], version["document_id"]]
    )


def _plan_matches(ctx: _Context, key: RowKey, query: RowQuery) -> bool:
    if query.plan is None:
        return True
    review, annotate = ctx.flags[key]
    if query.plan == "not_in_plan":
        return not ctx.in_plan[key]
    if query.plan == "review_and_annotate":
        return review and annotate
    return review if query.plan == "review" else annotate


def _row_level_matches(ctx: _Context, row: Mapping[str, Any], query: RowQuery) -> bool:
    key = (row["case_id"], row["language"])
    if query.language is not None and row["language"] != query.language:
        return False
    if query.case is not None and row["case_id"] != query.case:
        return False
    if not _plan_matches(ctx, key, query):
        return False
    if query.step is not None and not any(
        step["code"] == query.step for step in row["steps"]
    ):
        return False
    step = row["next_step"]
    if query.stage is not None and (step is None or step["stage"] != query.stage):
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


def _apply_filters(ctx: _Context, row: dict[str, Any], query: RowQuery) -> bool:
    """Mark matching versions; True when the row matches the non-decision filters."""
    row_level = _row_level_matches(ctx, row, query)
    for version in row["versions"]:
        version["matches_filter"] = row_level and _version_matches(
            ctx.facts, query, row["case_id"], version
        )
    return any(version["matches_filter"] for version in row["versions"])


def _matches_decision(
    ctx: _Context, key: RowKey, row: Mapping[str, Any], query: RowQuery
) -> bool:
    """Decision-like filters (bar segment, category, final result)."""
    if query.final == "missing" and row["final"] is not None:
        return False
    if query.final == "none" and not (ctx.flags[key][1] and row["final"] is None):
        return False
    if query.segment is not None and ctx.segments[key] != query.segment:
        return False
    if query.decision is None:
        return True
    if query.decision == "all":
        return bool(row["categories"])
    return query.decision in row["categories"]


def _retain_keys(query: RowQuery) -> set[RowKey]:
    keys: set[RowKey] = set()
    for item in query.retain:
        case_id, separator, language = item.rpartition(":")
        if separator and case_id and language:
            keys.add((case_id, language))
    return keys


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

    def by_activity(case_id: str) -> tuple[Any, ...]:
        at = activity.get(case_id)
        return (at is None, -at.timestamp() if at is not None else 0.0, case_id)

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


def _matching_cases(facts: RowFacts, query: RowQuery) -> set[str]:
    _, _, matches = _evaluate(facts, query)
    return {
        key[0] for key, (filtered, decision) in matches.items() if filtered and decision
    }


def case_ids(facts: RowFacts, query: RowQuery) -> tuple[list[str], int, bool]:
    """Filtered case IDs in list order, at most ``MAX_CASE_IDS``."""
    ids = sorted(_matching_cases(facts, query), key=_case_order(facts, query.sort))
    return ids[:MAX_CASE_IDS], len(ids), len(ids) > MAX_CASE_IDS


def sorted_case_ids(facts: RowFacts, case_ids: Sequence[str], sort: str) -> list[str]:
    """``case_ids`` (deduplicated) in Documents order; unknown IDs last, as given."""
    known = {version.case_id for version in facts.versions}
    unique = list(dict.fromkeys(case_ids))
    ordered = sorted(
        (case_id for case_id in unique if case_id in known),
        key=_case_order(facts, sort),
    )
    return ordered + [case_id for case_id in unique if case_id not in known]


def cases_not_shown(facts: RowFacts, case_ids: Sequence[str], query: RowQuery) -> int:
    """Selected cases without any row matching the filters of ``query``."""
    shown = _matching_cases(facts, query)
    return sum(1 for case_id in dict.fromkeys(case_ids) if case_id not in shown)


def build_page(facts: RowFacts, query: RowQuery) -> dict[str, Any]:
    ctx, rows, matches = _evaluate(facts, query)

    bar: dict[str, Any] = dict(
        rules.bar_counts(set(row["categories"]) for row in rows.values())
    )
    bar["no_final"] = sum(1 for row in rows.values() if row["final"] is None)
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
        (query.case, query.language)
        if query.case is not None and query.language is not None
        else None
    )
    shown_rows: dict[RowKey, dict[str, Any]] = {}
    shown_bar = 0
    for key, row in rows.items():
        filtered, decision = matches[key]
        row["matches_decision"] = decision
        if filtered and row["categories"]:
            shown_bar += 1
        if key == pinned_key:
            row["pinned"] = True
            shown_rows[key] = row
        elif filtered and decision:
            shown_rows[key] = row
        elif filtered and key in retain:
            row["retained"] = True
            shown_rows[key] = row
    bar["shown"] = shown_bar

    by_case: dict[str, list[RowKey]] = {}
    for key in rows:
        by_case.setdefault(key[0], []).append(key)

    def row_order(row: Mapping[str, Any]) -> tuple[bool, str]:
        return (not row["is_source"], row["language"])

    shown_cases = sorted(
        {key[0] for key in shown_rows}, key=_case_order(facts, query.sort)
    )
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
    return {
        "groups": groups[start : start + PAGE_SIZE],
        "page": query.page,
        "page_count": page_count,
        "group_count": group_count,
        "bar": bar,
        "case_found": query.case is None or query.case in by_case,
        "adjudicator_not_annotator": facts.adjudicator_not_annotator,
    }
