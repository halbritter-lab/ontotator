"""Agreement rule V9 (documents overview spec "Final-result panel > Agreement").

Pure: no database. A finding matches another when layer, term and context
(axes and the modifier set) are equal and the evidence overlaps by at least
one character, or both are spanless. Same position with another context is a
context difference. Two submissions pair one-to-one; three or more cluster.
"""

from __future__ import annotations

import ast
import itertools
import random
from collections.abc import Mapping
from pathlib import Path

import pytest

from ontocurator.domain import agreement as agreement_module
from ontocurator.domain.agreement import (
    Agreement,
    Finding,
    Pair,
    compare,
    match,
    with_defaults,
)


def f(
    key: str,
    spans: tuple[tuple[int, int], ...] = ((0, 5),),
    *,
    term: str = "HP:1",
    layer: str = "hpo-layer",
    axes: Mapping[str, str] | None = None,
    modifiers: frozenset[str] = frozenset(),
    order: int = 0,
) -> Finding:
    return Finding(
        key=key,
        layer_id=layer,
        term_id=term,
        axes=dict(axes) if axes is not None else {"presence": "present"},
        modifiers=modifiers,
        spans=spans,
        order=order,
    )


def two(a: list[Finding], b: list[Finding]) -> Agreement:
    return compare({"A": a, "B": b}, ["A", "B"])


def keys(pairs: tuple[Pair, ...]) -> set[tuple[str, str, bool]]:
    return {(p.first, p.second, p.exact) for p in pairs}


def test_overlap_of_one_character_matches() -> None:
    result = two([f("a", ((0, 5),))], [f("b", ((4, 9),))])
    assert result == Agreement(
        total=1, matching=1, context_differences=0, only_here={"A": 0, "B": 0}
    )


def test_touching_spans_do_not_match() -> None:
    result = two([f("a", ((0, 5),))], [f("b", ((5, 9),))])
    assert result == Agreement(
        total=2, matching=0, context_differences=0, only_here={"A": 1, "B": 1}
    )


def test_any_segment_overlap_counts() -> None:
    result = two([f("a", ((0, 2), (10, 12)))], [f("b", ((11, 20),))])
    assert result.matching == 1 and result.total == 1


def test_spanless_pairs_match_only_spanless() -> None:
    both_spanless = two([f("a", ())], [f("b", ())])
    assert (both_spanless.total, both_spanless.matching) == (1, 1)
    mixed = two([f("a", ())], [f("b", ((0, 5),))])
    assert mixed == Agreement(
        total=2, matching=0, context_differences=0, only_here={"A": 1, "B": 1}
    )


def test_axis_difference_is_context_difference() -> None:
    result = two(
        [f("a", axes={"presence": "present"})],
        [f("b", axes={"presence": "absent"})],
    )
    assert result == Agreement(
        total=1, matching=0, context_differences=1, only_here={"A": 0, "B": 0}
    )
    spanless = two(
        [f("a", (), axes={"presence": "present"})],
        [f("b", (), axes={"presence": "absent"})],
    )
    assert (spanless.total, spanless.context_differences) == (1, 1)


def test_missing_axis_equals_default() -> None:
    defaults = {"presence": "present", "certainty": "certain"}
    explicit = with_defaults({"presence": "present", "certainty": "certain"}, defaults)
    missing = with_defaults({"presence": None}, defaults)
    assert explicit == missing == {"presence": "present", "certainty": "certain"}
    # An axis without a default and without a value stays absent.
    assert with_defaults({"onset": None}, {}) == {}
    result = two([f("a", axes=explicit)], [f("b", axes=missing)])
    assert (result.matching, result.context_differences) == (1, 0)


def test_modifier_sets_compare_as_sets() -> None:
    same = two(
        [f("a", modifiers=frozenset({"x", "y"}))],
        [f("b", modifiers=frozenset({"y", "x"}))],
    )
    assert (same.matching, same.context_differences) == (1, 0)
    different = two(
        [f("a", modifiers=frozenset({"x"}))],
        [f("b", modifiers=frozenset({"x", "y"}))],
    )
    assert (different.matching, different.context_differences) == (0, 1)


def test_one_to_one_exact_first_then_context_then_largest_overlap_then_order() -> None:
    # Exact before context: a pairs with the exact b2 although b1 overlaps more.
    a = f("a", ((0, 10),), axes={"presence": "present"})
    b1 = f("b1", ((0, 10),), axes={"presence": "absent"}, order=0)
    b2 = f("b2", ((9, 12),), axes={"presence": "present"}, order=1)
    assert keys(match([a], [b1, b2])) == {("a", "b2", True)}
    assert two([a], [b1, b2]) == Agreement(
        total=2, matching=1, context_differences=0, only_here={"A": 0, "B": 1}
    )

    # Context before unmatched.
    c = f("c", ((0, 5),), axes={"presence": "absent"})
    assert keys(match([a], [c])) == {("a", "c", False)}

    # Largest overlap among exact candidates.
    small = f("small", ((0, 2),), order=0)
    large = f("large", ((0, 8),), order=1)
    assert keys(match([f("a", ((0, 10),))], [small, large])) == {("a", "large", True)}

    # Equal overlap: lower annotation order wins.
    late = f("late", ((0, 4),), order=5)
    early = f("early", ((5, 9),), order=1)
    assert keys(match([f("a", ((0, 10),))], [late, early])) == {("a", "early", True)}

    # Greedy (largest overlap first) would pair a1-b1 and leave two unmatched;
    # the maximum matching pairs both.
    a1 = f("a1", ((0, 10),), order=0)
    a2 = f("a2", ((0, 3),), order=1)
    g1 = f("b1", ((2, 8),), order=0)
    g2 = f("b2", ((9, 12),), order=1)
    assert keys(match([a1, a2], [g1, g2])) == {
        ("a1", "b2", True),
        ("a2", "b1", True),
    }
    assert two([a1, a2], [g1, g2]) == Agreement(
        total=2, matching=2, context_differences=0, only_here={"A": 0, "B": 0}
    )

    # Equal optima: in order of A, the lowest order of B; input order is irrelevant.
    x1 = f("x1", ((0, 4),), order=0)
    x2 = f("x2", ((0, 4),), order=1)
    y1 = f("y1", ((0, 4),), order=0)
    y2 = f("y2", ((0, 4),), order=1)
    expected = {("x1", "y1", True), ("x2", "y2", True)}
    for first in itertools.permutations([x1, x2]):
        for second in itertools.permutations([y1, y2]):
            assert keys(match(list(first), list(second))) == expected


def test_n_counts_exact_context_and_unmatched() -> None:
    a = [
        f("a1", ((0, 5),), term="HP:1"),
        f("a2", ((10, 15),), term="HP:2", axes={"presence": "absent"}),
        f("a3", ((20, 25),), term="HP:3"),
        f("a4", (), term="HP:4"),
    ]
    b = [
        f("b1", ((3, 7),), term="HP:1"),
        f("b2", ((12, 13),), term="HP:2"),
        f("b3", ((40, 45),), term="HP:3"),
        f("b4", (), term="HP:4"),
        f("b5", ((50, 55),), term="HP:5"),
    ]
    # exact: a1-b1, a4-b4; context: a2-b2; unmatched A: a3; unmatched B: b3, b5.
    assert two(a, b) == Agreement(
        total=6, matching=2, context_differences=1, only_here={"A": 1, "B": 2}
    )


def test_three_submissions_cluster_in_submission_order() -> None:
    s1 = [
        f("f1", ((0, 5),)),
        f("f2", ((60, 65),)),
    ]
    s2 = [
        f("g1", ((0, 5),)),
        f("g2", ((20, 25),)),
        f("g3", ((60, 65),), axes={"presence": "absent"}),
    ]
    s3 = [
        f("h1", ((1, 4),)),
        f("h2", ((20, 22),)),
        f("h3", ((40, 45),)),
        f("h4", ((60, 61),)),
    ]
    # Clusters: {f1,g1,h1} exact; {f2,g3,h4} complete with a context
    # difference; {g2,h2} misses S1; {h3} only S3.
    result = compare({"S1": s1, "S2": s2, "S3": s3}, ["S1", "S2", "S3"])
    assert result == Agreement(
        total=4,
        matching=1,
        context_differences=1,
        only_here={"S1": 0, "S2": 0, "S3": 1},
    )

    # A finding is compared with the cluster's first finding only.
    chain = {
        "S1": [f("p", ((0, 5),))],
        "S2": [f("q", ((4, 10),))],
        "S3": [f("r", ((8, 12),))],
    }
    assert compare(chain, ["S1", "S2", "S3"]) == Agreement(
        total=2,
        matching=0,
        context_differences=0,
        only_here={"S1": 0, "S2": 0, "S3": 1},
    )
    # The submission order decides which finding comes first.
    assert compare(chain, ["S2", "S1", "S3"]) == Agreement(
        total=1,
        matching=1,
        context_differences=0,
        only_here={"S2": 0, "S1": 0, "S3": 0},
    )


def test_three_submissions_one_finding_per_submission_per_cluster() -> None:
    result = compare(
        {
            "S1": [f("f1", ((0, 5),))],
            "S2": [f("g1", ((0, 5),)), f("g2", ((1, 4),), order=1)],
            "S3": [f("h1", ((0, 5),))],
        },
        ["S1", "S2", "S3"],
    )
    # g2 cannot join f1's cluster (g1 has the larger overlap and is there); it
    # starts its own, and h1 joins f1's cluster for the larger overlap.
    assert result == Agreement(
        total=2,
        matching=1,
        context_differences=0,
        only_here={"S1": 0, "S2": 1, "S3": 0},
    )


def test_only_here_per_submission() -> None:
    result = compare(
        {
            "A": [f("a1", ((0, 5),)), f("a2", ((30, 35),))],
            "B": [f("b1", ((0, 5),))],
            "C": [],
        },
        ["A", "B", "C"],
    )
    assert result.only_here == {"A": 1, "B": 0, "C": 0}
    # A submission without findings may be absent from the mapping.
    assert compare({"A": [f("a")]}, ["A", "B"]).only_here == {"A": 1, "B": 0}


def test_layers_and_terms_never_cross() -> None:
    other_term = two([f("a", term="HP:1")], [f("b", term="HP:2")])
    assert other_term == Agreement(
        total=2, matching=0, context_differences=0, only_here={"A": 1, "B": 1}
    )
    other_layer = two([f("a", layer="hpo-layer")], [f("b", layer="other-layer")])
    assert (other_layer.total, other_layer.matching) == (2, 0)
    assert match([f("a", term="HP:1")], [f("b", term="HP:2")]) == ()


def test_result_does_not_depend_on_input_order() -> None:
    a = [f(f"a{i}", ((i * 3, i * 3 + 5),), order=i) for i in range(5)]
    b = [f(f"b{i}", ((i * 3 + 1, i * 3 + 4),), order=i) for i in range(5)]
    reference = match(a, b)
    assert match(list(reversed(a)), list(reversed(b))) == reference
    assert two(list(reversed(a)), b) == two(a, b)


def _score(
    pairs: list[tuple[Finding, Finding]],
) -> tuple[int, int, int, int]:
    exact = context = overlap = order = 0
    for x, y in pairs:
        same = dict(x.axes) == dict(y.axes) and x.modifiers == y.modifiers
        exact += same
        context += not same
        overlap += sum(
            max(0, min(e1, e2) - max(s1, s2))
            for s1, e1 in x.spans
            for s2, e2 in y.spans
        )
        order += x.order + y.order
    return (exact, context, overlap, -order)


def _brute_force(a: list[Finding], b: list[Finding]) -> tuple[int, int, int, int]:
    def allowed(x: Finding, y: Finding) -> bool:
        if not x.spans or not y.spans:
            return not x.spans and not y.spans
        return any(
            min(e1, e2) > max(s1, s2) for s1, e1 in x.spans for s2, e2 in y.spans
        )

    best = (0, 0, 0, 0)
    for chosen in itertools.product([None, *range(len(b))], repeat=len(a)):
        used = [j for j in chosen if j is not None]
        if len(used) != len(set(used)):
            continue
        pairs = [(a[i], b[j]) for i, j in enumerate(chosen) if j is not None]
        if all(allowed(x, y) for x, y in pairs):
            best = max(best, _score(pairs))
    return best


def test_matching_is_the_lexicographic_optimum() -> None:
    rng = random.Random(7)
    for _ in range(300):
        a = [
            f(
                f"a{i}",
                ()
                if rng.random() < 0.15
                else ((s := rng.randrange(20), s + rng.randrange(1, 8)),),
                axes={"presence": rng.choice(["present", "absent"])},
                order=rng.randrange(6),
            )
            for i in range(rng.randrange(1, 5))
        ]
        b = [
            f(
                f"b{i}",
                ()
                if rng.random() < 0.15
                else ((s := rng.randrange(20), s + rng.randrange(1, 8)),),
                axes={"presence": rng.choice(["present", "absent"])},
                order=rng.randrange(6),
            )
            for i in range(rng.randrange(1, 5))
        ]
        by_key = {x.key: x for x in a} | {y.key: y for y in b}
        got = _score([(by_key[p.first], by_key[p.second]) for p in match(a, b)])
        assert got == _brute_force(a, b)


def test_invalid_order_is_rejected() -> None:
    with pytest.raises(ValueError):
        compare({"A": [], "B": []}, ["A", "A"])
    with pytest.raises(ValueError):
        compare({"A": [], "B": []}, ["A"])


def test_single_submission_has_no_matches() -> None:
    assert compare({"A": [f("a1"), f("a2", ((9, 12),))]}, ["A"]) == Agreement(
        total=2, matching=0, context_differences=0, only_here={"A": 2}
    )


def test_module_imports_nothing_from_application_or_storage() -> None:
    source = Path(agreement_module.__file__).read_text(encoding="utf-8")
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.ImportFrom):
            module = node.module or ""
            assert "application" not in module and "storage" not in module
        elif isinstance(node, ast.Import):
            for alias in node.names:
                assert "application" not in alias.name and "storage" not in alias.name
