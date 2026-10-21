"""Facet values and counts of the Documents filter popover (documents overview).

Counts follow the usual facet rule: the count of a value is the number of
rows listed under the current tab, search and every other filter when that
value alone is selected in its group, so a count equals ``bar.shown`` with
the value added (the FD11 pattern). A group's own selection is ignored.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from typing import Any, Literal, TypeVar

FacetGroup = Literal[
    "language",
    "review_state",
    "annotation_state",
    "final_state",
    "origin",
    "plan",
    "waiting_on",
]
FACET_GROUPS: tuple[FacetGroup, ...] = (
    "language",
    "review_state",
    "annotation_state",
    "final_state",
    "origin",
    "plan",
    "waiting_on",
)
Key = TypeVar("Key")


_STAGE_GROUPS: Mapping[str, str] = {
    "review_state": "review",
    "annotation_state": "annotation",
    "final_state": "final",
}


def facet_values(
    row: Mapping[str, Any],
    group: FacetGroup,
    *,
    origins: Callable[[], Iterable[str]],
    plan: Callable[[], Iterable[str]],
    waiting_on: Callable[[], Iterable[str]],
) -> tuple[str, ...]:
    """The facet values of one row in ``group``.

    ``origins``: origins of the row's versions that match the version-level
    filters (search, translation status); ``plan``: the row's plan options
    (``not_decided`` beside ``not_in_plan`` for undecided rows); ``waiting_on``:
    "me" and the pseudonyms of the row's Waiting-on people. Each is called
    only for its own group.
    """
    if group == "language":
        return (row["language"],)
    if group in _STAGE_GROUPS:
        return (row["stages"][_STAGE_GROUPS[group]]["state"],)
    source = {"origin": origins, "plan": plan, "waiting_on": waiting_on}[group]
    return tuple(dict.fromkeys(source()))


def facet_counts(
    keys: Iterable[Key],
    values: Callable[[Key, FacetGroup], tuple[str, ...]],
    matches_without: Callable[[FacetGroup], Callable[[Key], bool]],
    selected: Mapping[FacetGroup, Iterable[str]] | None = None,
) -> dict[FacetGroup, dict[str, int]]:
    """Rows per facet value; ``values(key, group)`` are a row's values in one
    group (computed in that group's pass only); ``matches_without(group)`` is
    the listing predicate (tab, search, every filter) without ``group``'s own
    selection.

    Every value present on some row is listed, with 0 when no listed row has
    it (the popover shows it muted); so is every ``selected`` value of the
    query (checked values stay visible, spec "Filter popover").
    """
    keys = list(keys)
    chosen = selected or {}
    counts: dict[FacetGroup, dict[str, int]] = {}
    for group in FACET_GROUPS:
        row_values = {key: values(key, group) for key in keys}
        present = sorted(
            {value for item in row_values.values() for value in item}
            | set(chosen.get(group, ()))
        )
        group_counts = dict.fromkeys(present, 0)
        matches = matches_without(group)
        for key in keys:
            if matches(key):
                for value in row_values[key]:
                    group_counts[value] += 1
        counts[group] = group_counts
    return counts
