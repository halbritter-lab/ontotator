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


def facet_values(
    row: Mapping[str, Any],
    *,
    origins: Iterable[str],
    plan: Iterable[str],
    waiting_on: Iterable[str],
) -> dict[FacetGroup, tuple[str, ...]]:
    """The facet values of one row.

    ``origins``: origins of the row's versions that match the version-level
    filters (search, translation status); ``plan``: the row's plan options
    (``not_decided`` beside ``not_in_plan`` for undecided rows); ``waiting_on``:
    "me" and the pseudonyms of the row's Waiting-on people.
    """
    stages = row["stages"]
    return {
        "language": (row["language"],),
        "review_state": (stages["review"]["state"],),
        "annotation_state": (stages["annotation"]["state"],),
        "final_state": (stages["final"]["state"],),
        "origin": tuple(dict.fromkeys(origins)),
        "plan": tuple(dict.fromkeys(plan)),
        "waiting_on": tuple(dict.fromkeys(waiting_on)),
    }


def facet_counts(
    keys: Iterable[Key],
    values: Callable[[Key], Mapping[FacetGroup, tuple[str, ...]]],
    matches_without: Callable[[FacetGroup], Callable[[Key], bool]],
) -> dict[FacetGroup, dict[str, int]]:
    """Rows per facet value; ``matches_without(group)`` is the listing
    predicate (tab, search, every filter) without ``group``'s own selection.

    Every value present on some row is listed, with 0 when no listed row has
    it (the popover shows it muted).
    """
    keys = list(keys)
    row_values = {key: values(key) for key in keys}
    counts: dict[FacetGroup, dict[str, int]] = {}
    for group in FACET_GROUPS:
        present = sorted(
            {value for item in row_values.values() for value in item[group]}
        )
        group_counts = dict.fromkeys(present, 0)
        matches = matches_without(group)
        for key in keys:
            if matches(key):
                for value in row_values[key][group]:
                    group_counts[value] += 1
        counts[group] = group_counts
    return counts
