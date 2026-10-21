"""Text keys of the Documents list (documents overview VD4).

The header checkbox and "Select by case IDs..." select texts
``(case_id, language)``. ``row_keys`` returns every text matching the
Documents filters (the one row predicate ``row_matches``, as the filtered
case IDs) in list order: cases in the order of ``query.sort``, within a case
the source first, then the translations by language.
"""

from __future__ import annotations

from collections.abc import Sequence

from ontocurator.application.document_row_page import (
    RowContext,
    row_matches,
    sorted_case_ids,
)
from ontocurator.application.document_rows import RowFacts, RowQuery
from ontocurator.domain.work_plans import RowKey

__all__ = ["MAX_CASES", "row_keys"]

# A selection holds at most this many cases (lead spec D17).
MAX_CASES = 2000


def row_keys(
    context: RowContext,
    query: RowQuery,
    case_ids: Sequence[str] = (),
    *,
    facts: RowFacts,
) -> tuple[list[RowKey], int, int, bool]:
    """``(keys, cases, total, truncated)`` of the texts matching ``query``.

    With ``case_ids`` only texts of these cases count (unknown IDs are
    ignored). ``keys`` hold the texts of the first ``MAX_CASES`` matching
    cases; ``cases`` and ``total`` count every matching case and text;
    ``truncated`` is True when cases were cut off.
    """
    wanted = set(case_ids) if case_ids else None
    by_case: dict[str, list[tuple[bool, str]]] = {}
    for (case_id, language), row in context.rows.items():
        if wanted is not None and case_id not in wanted:
            continue
        if row_matches(context, row, query):
            by_case.setdefault(case_id, []).append((not row["is_source"], language))
    order = sorted_case_ids(facts, list(by_case), query.sort)
    total = sum(len(texts) for texts in by_case.values())
    keys = [
        RowKey(case_id, language)
        for case_id in order[:MAX_CASES]
        for _, language in sorted(by_case[case_id])
    ]
    return keys, len(order), total, len(order) > MAX_CASES
