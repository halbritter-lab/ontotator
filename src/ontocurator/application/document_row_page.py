"""Rows and pages of the lead's Documents table, built from facts (no SQL).

Every rule lives in ``domain/document_rows.py``; this module only assembles
the row and page dictionaries of the Documents read API.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from datetime import datetime
from typing import TYPE_CHECKING, Any

from ontocurator.domain import document_rows as rules
from ontocurator.domain.document_rows import PAGE_SIZE

if TYPE_CHECKING:
    from ontocurator.application.document_rows import RowFacts, RowQuery

# The preflight's unconditional omission; Documents uses its own MISSING_FINAL.
_PREFLIGHT_ONLY = frozenset({"MISSING_FINAL_SELECTION"})
# Shown as the row's waiting line, never counted as a note.
_WAITING = frozenset({"ROUND_REVIEW_PENDING"})

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
    translation_failed = False
    for chain in chains:
        issue = rules.translation_issue(chain)
        newest = chain.newest
        if issue is not None:
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
    submission_count = sum(
        facts.submission_counts.get(v.document_id, 0) for v in versions
    )
    counts = rules.missing_final_counts(
        has_selection=selection is not None,
        submission_count=submission_count,
        assignments=row_assignments,
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
    return {
        "case_id": case_id,
        "language": language,
        "is_source": any(chain.root.origin == "native" for chain in chains),
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
    }


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


def _row_level_matches(row: Mapping[str, Any], query: RowQuery) -> bool:
    if query.language is not None and row["language"] != query.language:
        return False
    if query.case is not None and row["case_id"] != query.case:
        return False
    if query.status is not None:
        work = row["work"]
        if query.status == "unassigned":
            return not work
        if query.status == "held":
            return any(item["held"] for item in work)
        return any(item["status"] == query.status for item in work)
    return True


def _apply_filters(facts: RowFacts, row: dict[str, Any], query: RowQuery) -> bool:
    """Mark matching versions; True when the row matches the non-decision filters."""
    row_level = _row_level_matches(row, query)
    for version in row["versions"]:
        version["matches_filter"] = row_level and _version_matches(
            facts, query, row["case_id"], version
        )
    return any(version["matches_filter"] for version in row["versions"])


def _matches_decision(row: Mapping[str, Any], query: RowQuery) -> bool:
    if query.final == "missing":
        return row["final"] is None
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


def build_page(facts: RowFacts, query: RowQuery) -> dict[str, Any]:
    ctx = _Context(facts)
    rows = {key: _build_row(ctx, *key) for key in sorted(ctx.by_row)}

    bar = rules.bar_counts(set(row["categories"]) for row in rows.values())
    bar["no_final"] = sum(1 for row in rows.values() if row["final"] is None)

    retain = _retain_keys(query)
    pinned_key = (
        (query.case, query.language)
        if query.case is not None and query.language is not None
        else None
    )
    shown_rows: dict[RowKey, dict[str, Any]] = {}
    shown_bar = 0
    for key, row in rows.items():
        filtered = _apply_filters(facts, row, query)
        decision = _matches_decision(row, query)
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

    def group_order(case_id: str) -> tuple[bool, int, str]:
        positions = [
            rows[key]["position"]
            for key in by_case[case_id]
            if rows[key]["position"] is not None
        ]
        lowest = min(positions) if positions else None
        return (lowest is None, lowest or 0, case_id)

    shown_cases = sorted({key[0] for key in shown_rows}, key=group_order)
    groups = []
    for case_id in shown_cases:
        all_rows = [rows[key] for key in by_case[case_id]]
        members = sorted(
            (rows[key] for key in by_case[case_id] if key in shown_rows),
            key=lambda row: (not row["is_source"], row["language"]),
        )
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
