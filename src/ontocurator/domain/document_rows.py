"""Pure rules of the lead's Documents table. A row is (case_id, language)."""

from __future__ import annotations

import unicodedata
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from ontocurator.domain.submission_labels import (
    SubmissionKind,
    round_ordinals,
    submission_kind,
)

__all__ = [
    "ACKNOWLEDGEABLE",
    "CATEGORIES",
    "NOT_NEWER",
    "PAGE_SIZE",
    "SEGMENT_FIELDS",
    "STEP_CATEGORIES",
    "TRANSLATION_CODES",
    "AssignmentFact",
    "BarCategory",
    "Chain",
    "SubmissionKind",
    "TranslationIssue",
    "Version",
    "bar_categories",
    "bar_counts",
    "base_chain_name",
    "build_chains",
    "bulk_target",
    "category_of",
    "missing_final_counts",
    "open_target",
    "prefix_matches",
    "round_ordinals",
    "segment_counts",
    "submission_kind",
    "translation_issue",
    "version_label",
]

BarCategory = Literal[
    "report-or-pause", "confirm-final", "translation", "missing-final"
]
CATEGORIES: tuple[BarCategory, ...] = (
    "report-or-pause",
    "confirm-final",
    "translation",
    "missing-final",
)
# Deliberate copy of final_causes.ACKNOWLEDGEABLE_CODES so domain/ stays free of
# application imports; equality is asserted in tests/test_document_rows_facts.py.
ACKNOWLEDGEABLE = frozenset(
    {
        "SELECTED_ROUND_ABANDONED",
        "SELECTED_ROUND_SUPERSEDED",
        "SELECTED_RESULT_REVISED",
        "SELECTED_TEXT_CORRECTED",
        "SELECTED_NEWER_RESULT",
        "PLAN_RESTORED",
    }
)
NOT_NEWER = frozenset({"rejected", "query"})
# Text groups per Documents page.
PAGE_SIZE = 50

TranslationIssue = Literal["automatic_check_failed", "rejected", "query"]
# Documents-only issue code per translation issue of a chain's newest version.
TRANSLATION_CODES: dict[TranslationIssue, str] = {
    "automatic_check_failed": "TRANSLATION_CHECK_FAILED",
    "rejected": "TRANSLATION_NOT_ACCEPTED",
    "query": "TRANSLATION_NOT_ACCEPTED",
}
_REPORT_OR_PAUSE = frozenset({"OPEN_PROBLEM_REPORT", "TASK_PAUSED_WITHOUT_REPORT"})


@dataclass(frozen=True)
class Version:
    document_id: str
    case_id: str
    language: str
    external_id: str
    version: int
    origin: str
    derived_from: str | None
    translation: Mapping[str, Any] | None
    translation_status: str | None
    position: int | None
    latest_decision: str | None = None

    @property
    def not_newer(self) -> bool:
        """A correction whose latest review is rejected or queried is not newer."""
        return (
            self.origin == "correction"
            and self.translation_status == "reviewed"
            and self.latest_decision in NOT_NEWER
        )


@dataclass(frozen=True)
class Chain:
    root_id: str
    name: str
    versions: tuple[Version, ...]  # ascending version

    @property
    def root(self) -> Version:
        return self.versions[0]

    @property
    def newest(self) -> Version:
        return self.versions[-1]


@dataclass(frozen=True)
class AssignmentFact:
    assignment_id: int
    document_id: str
    task: str
    status: str
    held: bool
    revoked: bool
    pseudonym: str
    user_id: int
    active_round_id: str | None
    # F1 (FD1): the lead's own correction of a rejected or queried version.
    lead_correction: bool = False


def base_chain_name(root: Version) -> str:
    if root.origin == "native":
        return "Source"
    if root.origin == "human_translation":
        return "Human translation"
    run = root.translation or {}
    provider = str(run.get("provider") or "").strip()
    model = str(run.get("model") or "").strip()
    return f"{provider} {model}".strip() if provider else "Machine translation"


def build_chains(versions: Sequence[Version]) -> list[Chain]:
    by_id = {item.document_id: item for item in versions}

    def root(item: Version) -> Version:
        seen: set[str] = set()
        while item.origin == "correction":
            parent = item.derived_from
            if item.document_id in seen or parent is None or parent not in by_id:
                raise ValueError(f"Invalid correction ancestry for {item.document_id}")
            seen.add(item.document_id)
            item = by_id[parent]
        return item

    groups: dict[str, list[Version]] = {}
    for item in versions:
        groups.setdefault(root(item).document_id, []).append(item)
    names = {rid: base_chain_name(by_id[rid]) for rid in groups}
    counts = Counter(names.values())
    chains = [
        Chain(
            rid,
            names[rid]
            if counts[names[rid]] == 1
            else f"{names[rid]} · {by_id[rid].external_id}",
            tuple(sorted(items, key=lambda x: x.version)),
        )
        for rid, items in groups.items()
    ]
    return sorted(
        chains,
        key=lambda c: (c.root.position is None, c.root.position or 0, c.root_id),
    )


def version_label(chain: Chain, version: Version, *, parallel: bool) -> str:
    return f"{chain.name} v{version.version}" if parallel else f"v{version.version}"


def missing_final_counts(
    *,
    has_selection: bool,
    submission_count: int,
    assignments: Iterable[AssignmentFact],
    per_text: int = 1,
) -> bool:
    """Missing final result rule: no selection, at least ``per_text``
    submissions ("Annotations per text"), all work submitted."""
    if has_selection or submission_count == 0 or submission_count < per_text:
        return False
    return all(
        item.status == "submitted" and not item.held
        for item in assignments
        if not item.revoked
    )


def translation_issue(chain: Chain) -> TranslationIssue | None:
    newest = chain.newest
    if newest.translation_status == "automatic_check_failed":
        return "automatic_check_failed"
    if newest.translation_status == "reviewed":
        if newest.latest_decision == "rejected":
            return "rejected"
        if newest.latest_decision == "query":
            return "query"
    return None


def bulk_target(
    chains: Sequence[Chain],
) -> tuple[str | None, Literal["checkbox", "choose_in_versions"]]:
    if len(chains) != 1:
        return None, "choose_in_versions"
    target = [item for item in chains[0].versions if not item.not_newer][-1]
    if (
        target.origin == "correction"
        and target.translation_status == "ready_for_review"
    ):
        return None, "choose_in_versions"
    return target.document_id, "checkbox"


def open_target(
    chains: Sequence[Chain], *, final_document_id: str | None
) -> tuple[str, Literal["final", "newest", "most_recent_root"]]:
    if final_document_id is not None:
        return final_document_id, "final"
    if len(chains) == 1:
        return chains[0].newest.document_id, "newest"
    # Open question 3: without a creation time the root with the highest position wins.
    latest = max(
        chains,
        key=lambda c: (-1 if c.root.position is None else c.root.position, c.root_id),
    )
    return latest.newest.document_id, "most_recent_root"


def category_of(code: str) -> BarCategory | None:
    """Bar category of an issue code; None marks a note."""
    if code in _REPORT_OR_PAUSE:
        return "report-or-pause"
    if code in ACKNOWLEDGEABLE:
        return "confirm-final"
    if code in TRANSLATION_CODES.values():
        return "translation"
    if code == "MISSING_FINAL":
        return "missing-final"
    return None


def bar_categories(
    codes: Iterable[str], *, translation_failed: bool, missing_final: bool
) -> set[BarCategory]:
    result = {category for category in map(category_of, codes) if category}
    if translation_failed:
        result.add("translation")
    if missing_final:
        result.add("missing-final")
    return result


def bar_counts(rows: Iterable[set[BarCategory]]) -> dict[str, int]:
    counts: dict[str, int] = {"total": 0, **{c: 0 for c in CATEGORIES}}
    for categories in rows:
        if categories:
            counts["total"] += 1
        for category in categories:
            counts[category] += 1
    return counts


def prefix_matches(q: str, identifiers: Iterable[str]) -> bool:
    prefix = unicodedata.normalize("NFKC", q)
    return any(
        unicodedata.normalize("NFKC", item).startswith(prefix) for item in identifiers
    )


# Bar (D21): "Needs your decision" category of a decision step (rules 1-5, 4a).
STEP_CATEGORIES: dict[str, BarCategory] = {
    "decide_report": "report-or-pause",
    "resume_task": "report-or-pause",
    "confirm_final": "confirm-final",
    "resolve_rejected": "translation",
    "resolve_queried": "translation",
    "translation_not_accepted": "translation",
    "choose_final": "missing-final",
}
SEGMENT_FIELDS: dict[str, str] = {
    "decision": "needs_decision",
    "assign": "to_assign",
    "progress": "in_progress",
}


def segment_counts(
    rows: Iterable[tuple[bool, str | None, str | None]],
) -> dict[str, Any]:
    """Bar segments from ``(in_plan, segment, next step code)`` per row.

    Every in-plan row counts in ``in_plan`` and in at most one segment (the
    segment of its next step); decision rows also count in their category.
    """
    counts: dict[str, Any] = {
        "in_plan": 0,
        **dict.fromkeys(SEGMENT_FIELDS.values(), 0),
        "decision_categories": dict.fromkeys(CATEGORIES, 0),
    }
    for in_plan, segment, code in rows:
        if not in_plan:
            continue
        counts["in_plan"] += 1
        if segment is not None:
            counts[SEGMENT_FIELDS[segment]] += 1
        if segment == "decision" and code in STEP_CATEGORIES:
            counts["decision_categories"][STEP_CATEGORIES[code]] += 1
    return counts
