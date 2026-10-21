"""Agreement between submissions of one document, pure (spec V9).

Documents overview spec "Final-result panel > Agreement". A *finding* is an
annotation of a submission snapshot in an editable layer; the caller builds
``Finding`` values (axes with their defaults filled, see ``with_defaults``)
and only compares submissions on the same document version.

Two findings *match* when they share ``layer_id`` and ``term_id``, their
context is equal (axis values equal, modifiers equal as sets) and either
both have evidence and some segment of one overlaps some segment of the
other by at least one character, or both are spanless. The same position
with another context is a *context difference*.

Two submissions pair one-to-one with a maximum matching: most exact pairs,
then most context pairs, then largest total overlap, then smallest total
annotation order; equal optima take, in order of the first submission, the
lowest-ordered partner. Three or more submissions build clusters in
submission order: each finding joins at most one cluster (the same
assignment against each open cluster's first finding) and a cluster holds at
most one finding per submission. Two submissions are the special case of the
cluster rule, so both use one implementation.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

__all__ = [
    "Agreement",
    "Finding",
    "Pair",
    "compare",
    "match",
    "with_defaults",
]

Span = tuple[int, int]


@dataclass(frozen=True)
class Finding:
    key: str  # annotation id
    layer_id: str
    term_id: str
    axes: Mapping[str, str]  # missing axis = default, filled by the caller
    modifiers: frozenset[str]
    spans: tuple[
        Span, ...
    ]  # evidence segments; () = spanless (document_level or no mentions)
    order: int


@dataclass(frozen=True)
class Agreement:
    total: int
    matching: int
    context_differences: int
    only_here: Mapping[str, int]  # submission id -> count


@dataclass(frozen=True)
class Pair:
    """A one-to-one pair of two submissions' findings (``match``)."""

    first: str
    second: str
    exact: bool


def with_defaults(
    values: Mapping[str, str | None], defaults: Mapping[str, str]
) -> dict[str, str]:
    """Axis values for comparison: a missing or unset axis takes its default.

    An axis with neither a value nor a default stays absent, so two findings
    that both leave it open still compare equal.
    """
    merged: dict[str, str] = dict(defaults)
    for axis, value in values.items():
        if value is not None:
            merged[axis] = value
    return merged


def match(first: Sequence[Finding], second: Sequence[Finding]) -> tuple[Pair, ...]:
    """The one-to-one pairs of two submissions, in order of ``first``."""
    a = sorted(first, key=_finding_rank)
    b = sorted(second, key=_finding_rank)
    pairs: list[Pair] = []
    for bucket_a, bucket_b in _buckets(a, b):
        for i, j, exact in _assign(bucket_a, bucket_b):
            pairs.append(Pair(bucket_a[i].key, bucket_b[j].key, exact))
    rank = {finding.key: index for index, finding in enumerate(a)}
    return tuple(sorted(pairs, key=lambda pair: rank[pair.first]))


def compare(
    findings: Mapping[str, Sequence[Finding]], order: Sequence[str]
) -> Agreement:
    """Agreement of the submissions in ``order`` (the panel's submission order).

    ``findings`` maps submission id to its findings; a submission without
    findings may be absent. With fewer than two submissions nothing matches.
    """
    if len(set(order)) != len(order):
        raise ValueError("order lists a submission twice")
    unknown = set(findings) - set(order)
    if unknown:
        raise ValueError(f"findings of submissions not in order: {sorted(unknown)}")

    clusters: list[_Cluster] = []
    for index, submission in enumerate(order):
        own = sorted(findings.get(submission, ()), key=_finding_rank)
        by_bucket: dict[tuple[str, str], list[Finding]] = {}
        for finding in own:
            by_bucket.setdefault(_bucket(finding), []).append(finding)
        for bucket in sorted(by_bucket):
            open_clusters = sorted(
                (c for c in clusters if _bucket(c.first) == bucket),
                key=lambda c: c.rank,
            )
            new = by_bucket[bucket]
            joined: set[int] = set()
            for i, j, exact in _assign([c.first for c in open_clusters], new):
                open_clusters[i].members[submission] = exact
                joined.add(j)
            for j, finding in enumerate(new):
                if j not in joined:
                    clusters.append(
                        _Cluster(
                            first=finding,
                            rank=(index, *_finding_rank(finding)),
                            members={submission: True},
                        )
                    )

    complete = [c for c in clusters if len(order) >= 2 and len(c.members) == len(order)]
    matching = sum(1 for c in complete if all(c.members.values()))
    only_here = {submission: 0 for submission in order}
    for cluster in clusters:
        if len(cluster.members) == 1:
            only_here[next(iter(cluster.members))] += 1
    return Agreement(
        total=len(clusters),
        matching=matching,
        context_differences=len(complete) - matching,
        only_here=only_here,
    )


@dataclass
class _Cluster:
    first: Finding
    rank: tuple[int, int, str]
    # submission id -> exact (True for the first finding, else whether the
    # member matched the first finding exactly or only in position)
    members: dict[str, bool] = field(default_factory=dict)


def _finding_rank(finding: Finding) -> tuple[int, str]:
    return (finding.order, finding.key)


def _bucket(finding: Finding) -> tuple[str, str]:
    return (finding.layer_id, finding.term_id)


def _buckets(
    a: Sequence[Finding], b: Sequence[Finding]
) -> list[tuple[list[Finding], list[Finding]]]:
    keys = sorted({_bucket(x) for x in a} & {_bucket(y) for y in b})
    return [
        (
            [x for x in a if _bucket(x) == key],
            [y for y in b if _bucket(y) == key],
        )
        for key in keys
    ]


def _merged(spans: Sequence[Span]) -> list[Span]:
    result: list[Span] = []
    for start, end in sorted(s for s in spans if s[1] > s[0]):
        if result and start <= result[-1][1]:
            result[-1] = (result[-1][0], max(result[-1][1], end))
        else:
            result.append((start, end))
    return result


def _overlap(a: Sequence[Span], b: Sequence[Span]) -> int:
    """Characters shared by two evidence sets (each set merged first)."""
    shared = 0
    for start_a, end_a in _merged(a):
        for start_b, end_b in _merged(b):
            shared += max(0, min(end_a, end_b) - max(start_a, start_b))
    return shared


def _relation(a: Finding, b: Finding) -> tuple[bool, int] | None:
    """``(exact, overlap)`` when a and b may pair, else None (same bucket)."""
    if not a.spans and not b.spans:
        overlap = 0
    elif a.spans and b.spans:
        overlap = _overlap(a.spans, b.spans)
        if overlap == 0:
            return None
    else:
        return None
    exact = dict(a.axes) == dict(b.axes) and a.modifiers == b.modifiers
    return exact, overlap


def _assign(a: Sequence[Finding], b: Sequence[Finding]) -> list[tuple[int, int, bool]]:
    """Lexicographic best one-to-one pairs of one bucket, as ``(i, j, exact)``.

    ``a`` and ``b`` are in rank order. The tuple (exact pairs, context pairs,
    overlap, -order) is encoded into one integer weight with base ``m`` and
    maximised with the Hungarian algorithm; equal optima are resolved by
    fixing, row by row, the lowest-ranked partner that keeps the optimum.
    """
    if not a or not b:
        return []
    relations = [[_relation(x, y) for y in b] for x in a]
    total_overlap = sum(r[1] for row in relations for r in row if r is not None)
    total_order = sum(abs(x.order) for x in a) + sum(abs(y.order) for y in b)
    m = len(a) + len(b) + total_overlap + total_order + 2
    weight: list[list[int | None]] = [
        [
            None
            if r is None
            else (m**3 if r[0] else m**2) + r[1] * m - (x.order + y.order)
            for r, y in zip(row, b, strict=True)
        ]
        for row, x in zip(relations, a, strict=True)
    ]

    columns = list(range(len(b)))
    target = _best(weight, list(range(len(a))), columns)
    result: list[tuple[int, int, bool]] = []
    for i in range(len(a)):
        rest = list(range(i + 1, len(a)))
        chosen = None
        for j in columns:
            w = weight[i][j]
            if w is None:
                continue
            remaining = [c for c in columns if c != j]
            if w + _best(weight, rest, remaining) == target:
                chosen = j
                break
        if chosen is None:
            continue  # unmatched in every optimum that keeps the earlier choices
        w_chosen = weight[i][chosen]
        assert w_chosen is not None
        relation = relations[i][chosen]
        assert relation is not None
        result.append((i, chosen, relation[0]))
        target -= w_chosen
        columns = [c for c in columns if c != chosen]
    return result


def _best(
    weight: Sequence[Sequence[int | None]], rows: list[int], cols: list[int]
) -> int:
    """Maximum total weight of a (partial) one-to-one matching of rows to cols."""
    if not rows or not cols:
        return 0
    positive = sum(w for i in rows for j in cols if (w := weight[i][j]) is not None)
    forbidden = positive + 1
    # Rows x (cols + one free "unmatched" column per row), minimising cost.
    width = len(cols) + len(rows)
    cost = [
        [(forbidden if (w := weight[i][j]) is None else -w) for j in cols]
        + [0] * len(rows)
        for i in rows
    ]
    return -_hungarian(cost, width)


def _hungarian(cost: Sequence[Sequence[int]], width: int) -> int:
    """Minimum cost of assigning every row to a distinct column (rows <= width)."""
    n = len(cost)
    u = [0] * (n + 1)
    v = [0] * (width + 1)
    p = [0] * (width + 1)
    way = [0] * (width + 1)
    for i in range(1, n + 1):
        p[0] = i
        j0 = 0
        minv: list[int | None] = [None] * (width + 1)
        used = [False] * (width + 1)
        while True:
            used[j0] = True
            i0 = p[j0]
            delta: int | None = None
            j1 = 0
            for j in range(1, width + 1):
                if used[j]:
                    continue
                current = cost[i0 - 1][j - 1] - u[i0] - v[j]
                mj = minv[j]
                if mj is None or current < mj:
                    minv[j] = mj = current
                    way[j] = j0
                if delta is None or mj < delta:
                    delta = mj
                    j1 = j
            assert delta is not None
            for j in range(width + 1):
                if used[j]:
                    u[p[j]] += delta
                    v[j] -= delta
                else:
                    mj = minv[j]
                    assert mj is not None
                    minv[j] = mj - delta
            j0 = j1
            if p[j0] == 0:
                break
        while True:
            j1 = way[j0]
            p[j0] = p[j1]
            j0 = j1
            if j0 == 0:
                break
    return sum(cost[p[j] - 1][j - 1] for j in range(1, width + 1) if p[j] != 0)
