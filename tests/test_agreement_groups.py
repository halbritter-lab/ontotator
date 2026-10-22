"""Consolidation grouping ``groups()`` (acceptance fixes spec "WP-E Grouping").

Pure: no database. Clusters per ``(layer_id, type_id, term_id)``; incomplete
clusters of other terms on overlapping text merge into one "term differs"
group; kinds are a set; the default member is the earliest submission.
"""

from __future__ import annotations

from collections.abc import Mapping

from ontocurator.domain.agreement import Finding, Group, compare, groups

Span = tuple[int, int]


def f(
    key: str,
    sub_order: int,
    term: str,
    spans: tuple[Span, ...],
    axes: Mapping[str, str] | None = None,
    type_id: str = "phenotype",
    note: str | None = None,
    cues: tuple[Span, ...] = (),
    layer: str = "hpo-layer",
) -> Finding:
    return Finding(
        key=key,
        layer_id=layer,
        term_id=term,
        axes=dict(axes) if axes is not None else {"assertion": "present"},
        modifiers=frozenset(),
        spans=spans,
        order=sub_order,
        type_id=type_id,
        note=note,
        cues=cues,
    )


def one(result: tuple[Group, ...]) -> Group:
    assert len(result) == 1, result
    return result[0]


AB = ["s1", "s2"]
ABC = ["s1", "s2", "s3"]


def test_identical_two_is_match() -> None:
    g = one(
        groups(
            {
                "s1": [f("a", 0, "HP:1", ((0, 5),))],
                "s2": [f("b", 0, "HP:1", ((0, 5),))],
            },
            AB,
        )
    )
    assert g.kinds == frozenset({"match"})
    assert dict(g.members) == {"s1": "a", "s2": "b"}
    assert g.keep == "s1"
    assert g.terms == ("HP:1",)
    assert g.differing_axes == ()
    assert g.start == 0


def test_overlapping_not_identical_spans_is_span_differs() -> None:
    g = one(
        groups(
            {
                "s1": [f("a", 0, "HP:1", ((0, 5),))],
                "s2": [f("b", 0, "HP:1", ((2, 5),))],
            },
            AB,
        )
    )
    assert g.kinds == frozenset({"span_differs"})
    assert dict(g.members) == {"s1": "a", "s2": "b"}


def test_cue_difference_is_span_differs() -> None:
    g = one(
        groups(
            {
                "s1": [f("a", 0, "HP:1", ((5, 9),), cues=((0, 3),))],
                "s2": [f("b", 0, "HP:1", ((5, 9),))],
            },
            AB,
        )
    )
    assert g.kinds == frozenset({"span_differs"})


def test_axis_difference_lists_axes() -> None:
    g = one(
        groups(
            {
                "s1": [f("a", 0, "HP:1", ((0, 5),), {"assertion": "present"})],
                "s2": [f("b", 0, "HP:1", ((0, 5),), {"assertion": "absent"})],
            },
            AB,
        )
    )
    assert g.kinds == frozenset({"values_differ"})
    assert g.differing_axes == ("assertion",)
    assert g.keep == "s1"


def test_note_difference_is_notes_differ() -> None:
    g = one(
        groups(
            {
                "s1": [f("a", 0, "HP:1", ((0, 5),), note="mild")],
                "s2": [f("b", 0, "HP:1", ((0, 5),))],
            },
            AB,
        )
    )
    assert g.kinds == frozenset({"notes_differ"})


def test_span_and_value_combine() -> None:
    g = one(
        groups(
            {
                "s1": [f("a", 0, "HP:1", ((0, 5),), {"assertion": "present"})],
                "s2": [f("b", 0, "HP:1", ((1, 5),), {"assertion": "absent"})],
            },
            AB,
        )
    )
    assert g.kinds == frozenset({"span_differs", "values_differ"})
    assert g.differing_axes == ("assertion",)


def test_partial_two_people() -> None:
    g = one(groups({"s1": [], "s2": [f("b", 0, "HP:1", ((0, 5),))]}, AB))
    assert g.kinds == frozenset({"partial"})
    assert dict(g.members) == {"s2": "b"}
    assert g.keep == "s2"


def test_partial_two_of_three_with_value_difference() -> None:
    g = one(
        groups(
            {
                "s1": [f("a", 0, "HP:1", ((0, 5),), {"assertion": "present"})],
                "s3": [f("c", 0, "HP:1", ((0, 5),), {"assertion": "absent"})],
            },
            ABC,
        )
    )
    assert g.kinds == frozenset({"partial", "values_differ"})
    assert dict(g.members) == {"s1": "a", "s3": "c"}
    assert g.majority == {}


def test_term_merge_overlapping_incomplete_clusters() -> None:
    g = one(
        groups(
            {
                "s1": [f("a", 0, "HP:A", ((0, 8),))],
                "s2": [f("b", 0, "HP:B", ((3, 8),))],
            },
            AB,
        )
    )
    assert g.kinds == frozenset({"term_differs", "span_differs"})
    assert g.terms == ("HP:A", "HP:B")
    assert dict(g.members) == {"s1": "a", "s2": "b"}
    assert g.start == 0


def test_term_merge_only_within_layer_and_type() -> None:
    result = groups(
        {
            "s1": [f("a", 0, "HP:A", ((0, 8),))],
            "s2": [f("b", 0, "HP:B", ((0, 8),), type_id="other")],
        },
        AB,
    )
    assert len(result) == 2
    assert all(g.kinds == frozenset({"partial"}) for g in result)
    other_layer = groups(
        {
            "s1": [f("a", 0, "HP:A", ((0, 8),))],
            "s2": [f("b", 0, "HP:B", ((0, 8),), layer="other-layer")],
        },
        AB,
    )
    assert len(other_layer) == 2


def test_same_term_other_type_is_not_one_cluster() -> None:
    result = groups(
        {
            "s1": [f("a", 0, "HP:A", ((0, 8),))],
            "s2": [f("b", 0, "HP:A", ((0, 8),), type_id="other")],
        },
        AB,
    )
    assert len(result) == 2


def test_term_merge_never_merges_complete_clusters() -> None:
    result = groups(
        {
            "s1": [f("a", 0, "HP:A", ((0, 8),)), f("x", 1, "HP:B", ((2, 6),))],
            "s2": [f("b", 0, "HP:A", ((0, 8),))],
        },
        AB,
    )
    assert len(result) == 2
    first, second = result
    assert first.kinds == frozenset({"match"})
    assert dict(first.members) == {"s1": "a", "s2": "b"}
    assert second.kinds == frozenset({"partial"})
    assert dict(second.members) == {"s1": "x"}


def test_term_merge_chain_picks_largest_overlap() -> None:
    result = groups(
        {
            "s1": [f("x", 0, "HP:X", ((0, 4),)), f("z", 1, "HP:Z", ((5, 10),))],
            "s2": [f("y", 0, "HP:Y", ((2, 10),))],
        },
        AB,
    )
    assert len(result) == 2
    by_members = {frozenset(g.members.values()): g for g in result}
    assert set(by_members) == {frozenset({"x"}), frozenset({"z", "y"})}
    assert by_members[frozenset({"x"})].kinds == frozenset({"partial"})
    merged = by_members[frozenset({"z", "y"})]
    assert merged.kinds == frozenset({"term_differs", "span_differs"})
    assert merged.terms == ("HP:Z", "HP:Y")


def test_term_merge_tie_takes_lowest_rank() -> None:
    # x overlaps y and z by 5 characters each; y ranks before z (order 0 < 1).
    result = groups(
        {
            "s1": [f("x", 0, "HP:X", ((0, 10),))],
            "s2": [f("y", 0, "HP:Y", ((0, 5),)), f("z", 1, "HP:Z", ((5, 10),))],
        },
        AB,
    )
    by_members = {frozenset(g.members.values()): g for g in result}
    assert set(by_members) == {frozenset({"x", "y"}), frozenset({"z"})}


def test_term_merge_two_of_three_with_one_of_three() -> None:
    g = one(
        groups(
            {
                "s1": [f("a", 0, "HP:A", ((0, 8),), {"assertion": "present"})],
                "s2": [f("b", 0, "HP:A", ((0, 8),), {"assertion": "absent"})],
                "s3": [f("c", 0, "HP:B", ((4, 8),))],
            },
            ABC,
        )
    )
    assert g.kinds == frozenset({"term_differs", "values_differ", "span_differs"})
    assert g.terms == ("HP:A", "HP:B")
    assert dict(g.members) == {"s1": "a", "s2": "b", "s3": "c"}
    assert g.differing_axes == ("assertion",)


def test_term_differs_also_names_values_differing_across_terms() -> None:
    # One person each: Hypotonia present vs. Ataxia absent on the same text.
    # The assertion differs although no term has two members (the row must
    # not be settled by choosing a term).
    g = one(
        groups(
            {
                "s1": [f("a", 0, "HP:A", ((0, 8),), {"assertion": "present"})],
                "s2": [f("b", 0, "HP:B", ((0, 8),), {"assertion": "absent"}, note="n")],
            },
            AB,
        )
    )
    assert g.kinds == frozenset({"term_differs", "values_differ", "notes_differ"})
    assert g.differing_axes == ("assertion",)
    assert g.majority == {}


def test_term_merge_three_terms_join_one_group() -> None:
    g = one(
        groups(
            {
                "s1": [f("a", 0, "HP:A", ((0, 8),))],
                "s2": [f("b", 0, "HP:B", ((2, 8),))],
                "s3": [f("c", 0, "HP:C", ((4, 8),))],
            },
            ABC,
        )
    )
    assert g.kinds == frozenset({"term_differs", "span_differs"})
    assert g.terms == ("HP:A", "HP:B", "HP:C")


def test_union_of_member_spans_measures_overlap() -> None:
    # Cluster HP:A of s1 and s2 covers (0, 10); HP:B of s3 at (6, 9) misses
    # the cluster's first finding (0, 4) but overlaps the union. Spanless
    # findings of other terms never merge.
    g = one(
        groups(
            {
                "s1": [f("a", 0, "HP:A", ((0, 4),))],
                "s2": [f("b", 0, "HP:A", ((3, 10),))],
                "s3": [f("c", 0, "HP:B", ((6, 9),))],
            },
            ABC,
        )
    )
    assert g.kinds == frozenset({"term_differs", "span_differs"})
    spanless = groups(
        {
            "s1": [f("a", 0, "HP:A", ())],
            "s2": [f("b", 0, "HP:B", ())],
        },
        AB,
    )
    assert len(spanless) == 2


def test_spanless_groups_last_and_spanless_pair_matches() -> None:
    result = groups(
        {
            "s1": [f("n", 0, "HP:N", ()), f("a", 1, "HP:1", ((20, 25),))],
            "s2": [f("m", 0, "HP:N", ()), f("b", 1, "HP:1", ((20, 25),))],
        },
        AB,
    )
    assert [dict(g.members) for g in result] == [
        {"s1": "a", "s2": "b"},
        {"s1": "n", "s2": "m"},
    ]
    assert result[1].kinds == frozenset({"match"})
    assert result[1].start is None


def test_reading_order_by_first_span_start() -> None:
    result = groups(
        {
            "s1": [f("late", 0, "HP:1", ((30, 35),)), f("early", 1, "HP:2", ((2, 5),))],
            "s2": [f("mid", 0, "HP:3", ((10, 12),))],
        },
        AB,
    )
    assert [g.start for g in result] == [2, 10, 30]
    assert [tuple(g.members.values()) for g in result] == [
        ("early",),
        ("mid",),
        ("late",),
    ]


def test_majority_label_three_people() -> None:
    g = one(
        groups(
            {
                "s1": [f("a", 0, "HP:1", ((0, 5),), {"assertion": "absent"})],
                "s2": [f("b", 0, "HP:1", ((0, 5),), {"assertion": "present"})],
                "s3": [f("c", 0, "HP:1", ((0, 5),), {"assertion": "absent"})],
            },
            ABC,
        )
    )
    assert g.kinds == frozenset({"values_differ"})
    assert g.majority == {"assertion": "absent"}
    two = one(
        groups(
            {
                "s1": [f("a", 0, "HP:1", ((0, 5),), {"assertion": "absent"})],
                "s2": [f("b", 0, "HP:1", ((0, 5),), {"assertion": "present"})],
            },
            AB,
        )
    )
    assert two.majority == {}


def test_majority_counts_only_members_of_the_same_term() -> None:
    # HP:A has two members (no majority); HP:B's "absent" does not count.
    mixed = one(
        groups(
            {
                "s1": [f("a", 0, "HP:A", ((0, 5),), {"assertion": "absent"})],
                "s2": [f("b", 0, "HP:A", ((0, 5),), {"assertion": "present"})],
                "s3": [f("c", 0, "HP:B", ((0, 5),), {"assertion": "absent"})],
            },
            ABC,
        )
    )
    assert mixed.kinds == frozenset({"term_differs", "values_differ"})
    assert mixed.majority == {}
    # Two of HP:A's three members agree; HP:B's member is not counted.
    four = one(
        groups(
            {
                "s1": [f("a", 0, "HP:A", ((0, 5),), {"assertion": "absent"})],
                "s2": [f("b", 0, "HP:A", ((0, 5),), {"assertion": "present"})],
                "s3": [f("c", 0, "HP:A", ((0, 5),), {"assertion": "absent"})],
                "s4": [f("d", 0, "HP:B", ((0, 5),), {"assertion": "present"})],
            },
            ["s1", "s2", "s3", "s4"],
        )
    )
    assert four.kinds == frozenset({"term_differs", "values_differ"})
    assert four.majority == {"assertion": "absent"}


def test_keep_is_earliest_in_order() -> None:
    g = one(
        groups(
            {
                "s1": [f("a", 0, "HP:1", ((0, 5),), {"assertion": "present"})],
                "s2": [f("b", 0, "HP:1", ((0, 5),), {"assertion": "absent"})],
            },
            ["s2", "s1"],
        )
    )
    assert g.keep == "s2"
    assert list(g.members) == ["s2", "s1"]


def test_zero_findings_gives_no_groups() -> None:
    assert groups({}, AB) == ()
    assert groups({"s1": [], "s2": []}, AB) == ()


def test_compare_unchanged_with_type_and_note() -> None:
    plain = {
        "s1": [
            Finding("a", "hpo-layer", "HP:1", {"x": "1"}, frozenset(), ((0, 5),), 0),
            Finding("c", "hpo-layer", "HP:2", {"x": "1"}, frozenset(), ((9, 12),), 1),
        ],
        "s2": [
            Finding("b", "hpo-layer", "HP:1", {"x": "1"}, frozenset(), ((2, 5),), 0),
        ],
    }
    extended = {
        "s1": [
            f("a", 0, "HP:1", ((0, 5),), {"x": "1"}, note="n", cues=((7, 8),)),
            f("c", 1, "HP:2", ((9, 12),), {"x": "1"}, type_id="other"),
        ],
        "s2": [f("b", 0, "HP:1", ((2, 5),), {"x": "1"}, type_id="other")],
    }
    assert compare(plain, AB) == compare(extended, AB)
