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

``groups`` (acceptance fixes spec "WP-E Grouping") drives the consolidation
view and the final panel's full agreement: clusters bucketed by
``(layer_id, type_id, term_id)``, then incomplete clusters of other terms on
overlapping text of the same layer and type merge into one group, then each
group gets a set of kinds.

Modifiers (finding-modifiers spec "Agreement and grouping"): ``compare``
compares them as term-id sets (``modifiers``, R4); ``groups`` compares
``modifier_spans`` exactly (term and segments), so a different modifier text
is ``modifiers_differ`` too. A standalone modifier (a modifier term used as a
finding) never joins the term merge; its group is ``modifier_as_finding``
unless everyone agrees (then ``match``, A103).

A finding an annotator marked Unresolved (#246, ``Finding.unresolved``) never
agrees: ``compare`` does not count its cluster as matching, and its group has
the kind ``unresolved`` and never ``match``, so it is neither taken over nor
accepted as full agreement.

Which differences are a consolidation *decision* (acceptance 2026-10-22):
the term and every differing axis always are; the text only when the
members' spans genuinely conflict (``spans_conflict``); notes never (they
come with the finding they belong to and are shown as information).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Literal

__all__ = [
    "Agreement",
    "Finding",
    "Group",
    "GroupKind",
    "ModifierSpans",
    "Pair",
    "compare",
    "groups",
    "match",
    "spans_conflict",
    "with_defaults",
]

Span = tuple[int, int]
ModifierSpans = tuple[
    tuple[str, tuple[Span, ...]], ...
]  # sorted (term, sorted segments)
GroupKind = Literal[
    "match",
    "values_differ",
    "span_differs",
    "notes_differ",
    "term_differs",
    "partial",
    "modifiers_differ",
    "modifier_as_finding",
    "unresolved",
]


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
    type_id: str = ""  # groups() bucket (layer, type, term); compare() ignores it
    note: str | None = None  # compared by groups() only
    cues: tuple[Span, ...] = ()  # cue segments, compared with spans by groups()
    modifier_spans: ModifierSpans = ()  # compared exactly by groups() only
    standalone_modifier: bool = False  # a modifier term used as a finding
    unresolved: bool = False  # its author's review decision is Unresolved
    unresolved_note: str | None = None  # the note of that decision


@dataclass(frozen=True)
class Agreement:
    total: int
    matching: int
    context_differences: int
    only_here: Mapping[str, int]  # submission id -> count


@dataclass(frozen=True)
class Group:
    """One consolidation group: the findings of several submissions that
    describe the same thing (``groups``)."""

    members: Mapping[str, str]  # submission id -> finding key, in ``order``
    kinds: frozenset[GroupKind]  # {"match"} alone, or a set of the others
    differing_axes: tuple[str, ...]  # sorted axes differing among the members
    terms: tuple[str, ...]  # distinct term ids, in order of first member
    keep: str  # submission id of the default member (earliest in order)
    start: int | None  # first span start; None = spanless
    majority: Mapping[str, str]  # axis -> value of > half of >= 3 same-term members
    # ``spans_conflict`` among all members: the text is a decision ("Text" row).
    span_conflict: bool = False


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
    A cluster holding an unresolved finding is not ``matching``, whatever else
    agrees; it stays a difference within ``total``.
    """
    _check_order(findings, order)
    clusters = _clusters(findings, order, _bucket)
    complete = [c for c in clusters if len(order) >= 2 and len(c.members) == len(order)]
    exact = [c for c in complete if all(c.members.values())]
    unresolved = {
        (submission, finding.key)
        for submission, own in findings.items()
        for finding in own
        if finding.unresolved
    }
    matching = sum(1 for c in exact if not unresolved & set(c.keys.items()))
    only_here = {submission: 0 for submission in order}
    for cluster in clusters:
        if len(cluster.members) == 1:
            only_here[next(iter(cluster.members))] += 1
    return Agreement(
        total=len(clusters),
        matching=matching,
        context_differences=len(complete) - len(exact),
        only_here=only_here,
    )


def groups(
    findings: Mapping[str, Sequence[Finding]], order: Sequence[str]
) -> tuple[Group, ...]:
    """Consolidation groups of the submissions in ``order``, in reading order.

    Clusters follow the ``compare`` rule per ``(layer_id, type_id,
    term_id)``. Term merge (U3): only clusters that are not complete, of the
    same layer and type, with another term and disjoint submission sets, whose
    member span unions overlap by at least one character. Candidate pairs
    merge greedily by largest overlap, then lowest cluster rank; a merged
    group keeps merging while the submission sets stay disjoint, so in a chain
    X(s1)-Y(s2)-Z(s1) only one of X, Z joins Y. Groups are ordered by first
    span start (spanless last), then cluster rank.
    """
    _check_order(findings, order)
    clusters = _clusters(findings, order, _group_bucket)
    position = {submission: index for index, submission in enumerate(order)}
    by_id = {
        (submission, finding.key): finding
        for submission, own in findings.items()
        for finding in own
    }

    def spans_of(cluster: _Cluster) -> list[Span]:
        return [
            span
            for submission, key in cluster.keys.items()
            for span in by_id[(submission, key)].spans
        ]

    candidates = [
        i
        for i, cluster in enumerate(clusters)
        if len(cluster.members) < len(order) and not cluster.first.standalone_modifier
    ]
    edges: list[tuple[int, tuple[int, int, str], tuple[int, int, str], int, int]] = []
    for offset, i in enumerate(candidates):
        for j in candidates[offset + 1 :]:
            a, b = clusters[i], clusters[j]
            if (
                (a.first.layer_id, a.first.type_id)
                != (b.first.layer_id, b.first.type_id)
                or a.first.term_id == b.first.term_id
                or set(a.members) & set(b.members)
            ):
                continue
            overlap = _overlap(spans_of(a), spans_of(b))
            if overlap >= 1:
                low, high = sorted((i, j), key=lambda k: clusters[k].rank)
                edges.append(
                    (-overlap, clusters[low].rank, clusters[high].rank, low, high)
                )

    # Union-find over cluster indexes; a root covers its group's submissions.
    parent = list(range(len(clusters)))
    covered = {i: set(cluster.members) for i, cluster in enumerate(clusters)}

    def root(i: int) -> int:
        while parent[i] != i:
            i = parent[i]
        return i

    for _, _, _, i, j in sorted(edges):
        ri, rj = root(i), root(j)
        if ri == rj or covered[ri] & covered[rj]:
            continue
        kept, gone = sorted((ri, rj), key=lambda k: clusters[k].rank)
        parent[gone] = kept
        covered[kept] |= covered.pop(gone)

    merged: dict[int, list[_Cluster]] = {}
    for i, cluster in enumerate(clusters):
        merged.setdefault(root(i), []).append(cluster)

    ordered: list[tuple[tuple[bool, int, tuple[int, int, str]], Group]] = []
    for parts in merged.values():
        members = sorted(
            (
                (submission, by_id[(submission, key)])
                for part in parts
                for submission, key in part.keys.items()
            ),
            key=lambda item: position[item[0]],
        )
        group = _group(members, len(order))
        rank = min(part.rank for part in parts)
        ordered.append(((group.start is None, group.start or 0, rank), group))
    return tuple(group for _, group in sorted(ordered, key=lambda item: item[0]))


def spans_conflict(findings: Sequence[Finding]) -> bool:
    """Whether the findings' text spans genuinely conflict, so the text is a
    decision of its own.

    Two findings agree on their text when both are spanless, or when the
    characters their evidence shares (each evidence set merged, cue segments
    ignored) are at least half of the shorter evidence. The spans conflict
    when any two findings do not agree (also one spanless and one not):
    they mark mostly different text. Overlapping spans with small shifts
    ("ataxia" / "severe ataxia") agree; the text then comes with the chosen
    finding (its term, "Take … finding" or the default member).
    """
    for index, a in enumerate(findings):
        for b in findings[index + 1 :]:
            if not a.spans and not b.spans:
                continue
            if not a.spans or not b.spans:
                return True
            shorter = min(_length(a.spans), _length(b.spans))
            if 2 * _overlap(a.spans, b.spans) < shorter:
                return True
    return False


def _differing(findings: Sequence[Finding]) -> set[str]:
    """Axes whose values differ among ``findings``."""
    axes = {axis for finding in findings for axis in finding.axes}
    return {axis for axis in axes if len({x.axes.get(axis) for x in findings}) > 1}


def _group(members: Sequence[tuple[str, Finding]], submissions: int) -> Group:
    """Kinds and labels of one group; ``members`` in submission order."""
    terms: list[str] = []
    by_term: dict[str, list[Finding]] = {}
    for _, finding in members:
        if finding.term_id not in by_term:
            terms.append(finding.term_id)
        by_term.setdefault(finding.term_id, []).append(finding)
    # Differences are measured across every member of the group, also across
    # terms: a "term differs" group whose members also differ in an axis
    # shows that row too, so taking one person's term never settles another
    # value silently. ``span_differs`` / ``notes_differ`` describe any
    # difference (they keep a group from ``match``); only ``span_conflict``
    # makes the text a decision.
    findings = [finding for _, finding in members]
    differing = _differing(findings)
    span_differs = (
        len({tuple(sorted(x.spans)) for x in findings}) > 1
        or len({tuple(sorted(x.cues)) for x in findings}) > 1
    )
    notes_differ = len({x.note or None for x in findings}) > 1
    # Majority (> half of >= 3 members) counts only members of the same term;
    # an axis with different majorities in two terms gets no label.
    winners: dict[str, set[str]] = {}
    for same in by_term.values():
        if len(same) < 3:
            continue
        for axis in differing:
            counts: dict[str, int] = {}
            for finding in same:
                value = finding.axes.get(axis)
                if value is not None:
                    counts[value] = counts.get(value, 0) + 1
            for value, count in counts.items():
                if count * 2 > len(same):
                    winners.setdefault(axis, set()).add(value)

    kinds: set[GroupKind] = set()
    if len(members) < submissions:
        kinds.add("partial")
    if len(terms) > 1:
        kinds.add("term_differs")
    if differing:
        kinds.add("values_differ")
    if span_differs:
        kinds.add("span_differs")
    if notes_differ:
        kinds.add("notes_differ")
    if len({finding.modifier_spans for finding in findings}) > 1:
        kinds.add("modifiers_differ")
    if any(finding.unresolved for finding in findings):
        kinds.add("unresolved")
    # A unanimous modifier term is a match (A103): only a difference or an
    # Unresolved flag flags it.
    if kinds and any(finding.standalone_modifier for finding in findings):
        kinds.add("modifier_as_finding")
    if not kinds:
        kinds.add("match")

    majority = {
        axis: next(iter(values))
        for axis, values in sorted(winners.items())
        if len(values) == 1
    }
    starts = [start for _, finding in members for start, _ in finding.spans]
    return Group(
        members={submission: finding.key for submission, finding in members},
        kinds=frozenset(kinds),
        differing_axes=tuple(sorted(differing)),
        terms=tuple(terms),
        keep=members[0][0],
        start=min(starts) if starts else None,
        majority=majority,
        span_conflict=spans_conflict(findings),
    )


def _check_order(
    findings: Mapping[str, Sequence[Finding]], order: Sequence[str]
) -> None:
    if len(set(order)) != len(order):
        raise ValueError("order lists a submission twice")
    unknown = set(findings) - set(order)
    if unknown:
        raise ValueError(f"findings of submissions not in order: {sorted(unknown)}")


def _clusters(
    findings: Mapping[str, Sequence[Finding]],
    order: Sequence[str],
    bucket: Callable[[Finding], tuple[str, ...]],
) -> list[_Cluster]:
    """Clusters in submission order: each finding joins at most one open
    cluster of its bucket (``_assign`` against the cluster's first finding)
    and a cluster holds at most one finding per submission."""
    clusters: list[_Cluster] = []
    for index, submission in enumerate(order):
        own = sorted(findings.get(submission, ()), key=_finding_rank)
        by_bucket: dict[tuple[str, ...], list[Finding]] = {}
        for finding in own:
            by_bucket.setdefault(bucket(finding), []).append(finding)
        for key in sorted(by_bucket):
            open_clusters = sorted(
                (c for c in clusters if bucket(c.first) == key),
                key=lambda c: c.rank,
            )
            new = by_bucket[key]
            joined: set[int] = set()
            for i, j, exact in _assign([c.first for c in open_clusters], new):
                open_clusters[i].members[submission] = exact
                open_clusters[i].keys[submission] = new[j].key
                joined.add(j)
            for j, finding in enumerate(new):
                if j not in joined:
                    clusters.append(
                        _Cluster(
                            first=finding,
                            rank=(index, *_finding_rank(finding)),
                            members={submission: True},
                            keys={submission: finding.key},
                        )
                    )
    return clusters


@dataclass
class _Cluster:
    first: Finding
    rank: tuple[int, int, str]
    # submission id -> exact (True for the first finding, else whether the
    # member matched the first finding exactly or only in position)
    members: dict[str, bool] = field(default_factory=dict)
    # submission id -> finding key of the member
    keys: dict[str, str] = field(default_factory=dict)


def _finding_rank(finding: Finding) -> tuple[int, str]:
    return (finding.order, finding.key)


def _bucket(finding: Finding) -> tuple[str, str]:
    return (finding.layer_id, finding.term_id)


def _group_bucket(finding: Finding) -> tuple[str, str, str]:
    return (finding.layer_id, finding.type_id, finding.term_id)


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


def _length(spans: Sequence[Span]) -> int:
    """Characters covered by an evidence set (merged first)."""
    return sum(end - start for start, end in _merged(spans))


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
