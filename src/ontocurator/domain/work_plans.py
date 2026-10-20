"""Pure work-plan rules: two flags per language version (spec "Work plan").

A language version is one Documents row, ``(case_id, language)``. Review
applies to translations only; Annotate to sources and translations. A row with
both flags off is "Not in plan".
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

__all__ = [
    "OFF",
    "SOURCE_KEY",
    "Consequences",
    "ImportPlanSetting",
    "Invalid",
    "LanguageChange",
    "LanguageVersion",
    "OpenReport",
    "OpenTask",
    "PlanFlags",
    "Preset",
    "RowKey",
    "TriState",
    "consequences",
    "import_defaults",
    "merge",
    "mixed_counts",
    "preset_changes",
    "validate",
]

ImportPlanSetting = Literal["nothing", "review_and_annotate_translations"]
TriState = Literal["keep", "on", "off"]
Preset = Literal["review_and_annotate_translations", "annotate_only"]
InvalidReason = Literal["source_review", "annotate_not_accepted", "not_acceptable"]

# The change-set key that targets each case's source row(s).
SOURCE_KEY = "source"
_ANNOTATION_TASKS = frozenset({"annotate", "review"})


@dataclass(frozen=True)
class RowKey:
    case_id: str
    language: str


@dataclass(frozen=True)
class PlanFlags:
    review: bool
    annotate: bool


OFF = PlanFlags(False, False)


@dataclass(frozen=True)
class LanguageVersion:
    """One Documents row as the plan sees it."""

    case_id: str
    language: str
    is_source: bool  # the row holds the case's native root(s)
    accepted: bool  # every root's newest version is `accepted` (False for sources)
    marked_in_package: bool  # newest version carries a `package` acceptance
    discarded: bool = False  # every root of the row is discarded
    # A root's newest version is rejected/queried or has an open translation
    # review (not acceptable externally).
    review_blocked: bool = False

    @property
    def key(self) -> RowKey:
        return RowKey(self.case_id, self.language)


@dataclass(frozen=True)
class LanguageChange:
    review: TriState = "keep"
    annotate: TriState = "keep"


@dataclass(frozen=True)
class OpenTask:
    assignment_id: int
    case_id: str
    language: str
    task: str  # "translation_review" | "annotate" | "review"
    user_id: int


@dataclass(frozen=True)
class OpenReport:
    report_id: str
    case_id: str
    language: str
    assignment_id: int | None
    held: bool  # an active task hold belongs to the report


@dataclass(frozen=True)
class Consequences:
    withdrawn: tuple[OpenTask, ...]
    finals_leaving: tuple[RowKey, ...]
    restored: tuple[RowKey, ...]
    # Open reports on rows whose flag turns off; they stay open.
    open_reports: tuple[OpenReport, ...] = ()

    @property
    def any(self) -> bool:
        return bool(
            self.withdrawn or self.finals_leaving or self.restored or self.open_reports
        )


@dataclass(frozen=True)
class Invalid:
    key: RowKey
    reason: InvalidReason


def import_defaults(
    setting: ImportPlanSetting, rows: Sequence[LanguageVersion]
) -> dict[RowKey, PlanFlags]:
    """Flags a newly imported language version gets under the project setting."""
    if setting == "nothing":
        return {row.key: OFF for row in rows}
    translated = {row.case_id for row in rows if not row.is_source}
    result: dict[RowKey, PlanFlags] = {}
    for row in rows:
        if row.is_source:
            result[row.key] = PlanFlags(False, row.case_id not in translated)
        else:
            result[row.key] = PlanFlags(not row.marked_in_package, True)
    return result


def validate(
    changes: Mapping[RowKey, PlanFlags],
    rows: Mapping[RowKey, LanguageVersion],
    *,
    rule_on: bool,
    accepting: frozenset[RowKey] = frozenset(),
) -> list[Invalid]:
    """Invalid rows of a change set, in input order (at most one per row)."""
    invalid: list[Invalid] = []
    for key, flags in changes.items():
        row = rows.get(key)
        if row is None:
            continue
        if row.is_source:
            if flags.review:
                invalid.append(Invalid(key, "source_review"))
            continue
        if key in accepting and row.review_blocked:
            invalid.append(Invalid(key, "not_acceptable"))
        elif (
            rule_on
            and flags.annotate
            and not flags.review
            and not row.accepted
            and key not in accepting
        ):
            invalid.append(Invalid(key, "annotate_not_accepted"))
    return invalid


def _apply(state: TriState, current: bool) -> bool:
    return current if state == "keep" else state == "on"


def merge(
    current: Mapping[RowKey, PlanFlags],
    rows: Mapping[RowKey, LanguageVersion],
    case_ids: Sequence[str],
    languages: Mapping[str, LanguageChange],
) -> dict[RowKey, PlanFlags]:
    """Tri-state merge over the selected cases; only existing rows are returned.

    Key ``"source"`` targets each case's source row(s); a source row ignores
    ``review``. A row without current flags counts as off/off.
    """
    selected = set(case_ids)
    result: dict[RowKey, PlanFlags] = {}
    for key, row in rows.items():
        if row.case_id not in selected:
            continue
        change = languages.get(SOURCE_KEY if row.is_source else row.language)
        if change is None:
            continue
        cur = current.get(key, OFF)
        review = cur.review if row.is_source else _apply(change.review, cur.review)
        result[key] = PlanFlags(review, _apply(change.annotate, cur.annotate))
    return result


def preset_changes(
    preset: Preset, rows: Iterable[LanguageVersion]
) -> dict[str, LanguageChange]:
    """Expand a one-click preset over every translation language of the rows."""
    change = (
        LanguageChange("on", "on")
        if preset == "review_and_annotate_translations"
        else LanguageChange("keep", "on")
    )
    languages = sorted({row.language for row in rows if not row.is_source})
    return dict.fromkeys(languages, change)


def consequences(
    old: Mapping[RowKey, PlanFlags],
    new: Mapping[RowKey, PlanFlags],
    open_tasks: Sequence[OpenTask],
    finals: frozenset[RowKey],
    reports: Sequence[OpenReport] = (),
) -> Consequences:
    """What a change from ``old`` to ``new`` flags does to existing work."""
    review_off: set[RowKey] = set()
    annotate_off: set[RowKey] = set()
    annotate_on: set[RowKey] = set()
    for key, after in new.items():
        before = old.get(key, OFF)
        if before.review and not after.review:
            review_off.add(key)
        if before.annotate and not after.annotate:
            annotate_off.add(key)
        if not before.annotate and after.annotate:
            annotate_on.add(key)

    def withdrawn(task: OpenTask) -> bool:
        key = RowKey(task.case_id, task.language)
        if task.task == "translation_review":
            return key in review_off
        return task.task in _ANNOTATION_TASKS and key in annotate_off

    def row_order(key: RowKey) -> tuple[str, str]:
        return key.case_id, key.language

    turned_off = review_off | annotate_off
    return Consequences(
        withdrawn=tuple(
            sorted(
                (t for t in open_tasks if withdrawn(t)),
                key=lambda t: (t.case_id, t.language, t.assignment_id),
            )
        ),
        finals_leaving=tuple(sorted(annotate_off & finals, key=row_order)),
        restored=tuple(sorted(annotate_on & finals, key=row_order)),
        open_reports=tuple(
            sorted(
                (r for r in reports if RowKey(r.case_id, r.language) in turned_off),
                key=lambda r: (r.case_id, r.language, r.report_id),
            )
        ),
    )


def mixed_counts(
    current: Mapping[RowKey, PlanFlags], keys: Iterable[RowKey]
) -> dict[str, int]:
    """How many of ``keys`` have each flag on/off (a missing row counts as off)."""
    counts = {"review_on": 0, "review_off": 0, "annotate_on": 0, "annotate_off": 0}
    for key in keys:
        flags = current.get(key, OFF)
        counts["review_on" if flags.review else "review_off"] += 1
        counts["annotate_on" if flags.annotate else "annotate_off"] += 1
    return counts
