"""Grouping with modifiers (finding-modifiers spec "Agreement and grouping").

Pure: no database. ``groups()`` compares modifiers with their segments
(``modifiers_differ``) and keeps standalone modifiers apart
(``modifier_as_finding``); ``compare()`` keeps comparing term-id sets (R4).
Scenarios S1-S20.
"""

from __future__ import annotations

import dataclasses
from collections.abc import Iterable, Mapping, Sequence

from test_agreement_groups import f as groups_f

from ontotator.domain.agreement import Finding, Group, compare, groups

TEXT = "Seit 2 Wochen wiederholt schwere Krampfanfälle und eine Muskelhypotonie."
SEIZURE, HYPOTONIA, FOCAL = "HP:0001250", "HP:0001252", "HP:0007359"
SEVERE, MILD, RECURRENT = "HP:0012828", "HP:0012825", "HP:0031796"
FREQUENT = "HP:0040282"
AXES = {"assertion": "present", "experiencer": "patient", "temporality": "current"}

Span = tuple[int, int]
Mods = Iterable[tuple[str, Sequence[Span]]]


def at(word: str, nth: int = 0) -> tuple[int, int]:
    start = -1
    for _ in range(nth + 1):
        start = TEXT.index(word, start + 1)
    return (start, start + len(word))


def f(
    key: str,
    term: str,
    spans: Sequence[Span] = (),
    mods: Mods = (),
    *,
    standalone: bool = False,
    order: int = 0,
    axes: Mapping[str, str] = AXES,
) -> Finding:
    mods = tuple(mods)
    return Finding(
        key=key,
        layer_id="hpo",
        term_id=term,
        axes=dict(axes),
        modifiers=frozenset(t for t, _ in mods),
        spans=tuple(spans),
        order=order,
        type_id="phenotype",
        modifier_spans=tuple(sorted((t, tuple(sorted(s))) for t, s in mods)),
        standalone_modifier=standalone,
    )


def m(*terms: str) -> tuple[tuple[str, tuple[Span, ...]], ...]:
    """Spanless modifiers."""
    return tuple((t, ()) for t in terms)


KRAMPF = at("Krampfanfälle")
SCHWERE = at("schwere")
SEVERE_ON_TEXT = ((SEVERE, (SCHWERE,)),)
AB = ["a", "b"]
ABC = ["a", "b", "c"]


def seizure(key: str, mods: Mods = (), **kw: object) -> Finding:
    return f(key, SEIZURE, (KRAMPF,), mods, **kw)  # type: ignore[arg-type]


def one(result: tuple[Group, ...]) -> Group:
    assert len(result) == 1, result
    return result[0]


def kinds(findings: Mapping[str, Sequence[Finding]], order: list[str]) -> set[str]:
    return set(one(groups(findings, order)).kinds)


def test_s1_same_modifier_and_text_match() -> None:
    data = {"a": [seizure("a1", SEVERE_ON_TEXT)], "b": [seizure("b1", SEVERE_ON_TEXT)]}
    assert kinds(data, AB) == {"match"}
    assert compare(data, AB).matching == 1


def test_s2_spanless_modifier_sets_match() -> None:
    data = {
        "a": [seizure("a1", m(SEVERE, RECURRENT))],
        "b": [seizure("b1", m(RECURRENT, SEVERE))],
    }
    assert kinds(data, AB) == {"match"}


def test_s3_subset_differs() -> None:
    data = {"a": [seizure("a1", m(SEVERE))], "b": [seizure("b1", m(SEVERE, RECURRENT))]}
    assert kinds(data, AB) == {"modifiers_differ"}
    assert compare(data, AB).context_differences == 1


def test_s4_disjoint_sets() -> None:
    data = {
        "a": [seizure("a1", SEVERE_ON_TEXT)],
        "b": [seizure("b1", ((RECURRENT, (at("wiederholt"),)),))],
    }
    assert kinds(data, AB) == {"modifiers_differ"}
    assert compare(data, AB).context_differences == 1


def test_s5_none_versus_one() -> None:
    data = {"a": [seizure("a1")], "b": [seizure("b1", SEVERE_ON_TEXT)]}
    assert kinds(data, AB) == {"modifiers_differ"}


def test_s6_text_versus_no_text() -> None:
    data = {"a": [seizure("a1", SEVERE_ON_TEXT)], "b": [seizure("b1", m(SEVERE))]}
    assert kinds(data, AB) == {"modifiers_differ"}
    assert compare(data, AB).matching == 1  # R4: term-id sets are equal


def test_s7_different_texts() -> None:
    data = {
        "a": [seizure("a1", SEVERE_ON_TEXT)],
        "b": [seizure("b1", ((SEVERE, (at("wiederholt schwere"),)),))],
    }
    assert kinds(data, AB) == {"modifiers_differ"}
    assert compare(data, AB).matching == 1


def test_s8_union_with_conflicting_spans() -> None:
    data = {
        "a": [seizure("a1", SEVERE_ON_TEXT)],
        "b": [seizure("b1", ((SEVERE, (at("wiederholt schwere"),)), (RECURRENT, ())))],
    }
    assert kinds(data, AB) == {"modifiers_differ"}
    assert compare(data, AB).context_differences == 1


def test_s9_same_text_on_different_findings() -> None:
    muskel = (at("Muskelhypotonie"),)
    data = {
        "a": [
            seizure("a1", SEVERE_ON_TEXT),
            f("a2", HYPOTONIA, muskel, order=1),
        ],
        "b": [
            seizure("b1"),
            f("b2", HYPOTONIA, muskel, SEVERE_ON_TEXT, order=1),
        ],
    }
    result = groups(data, AB)
    assert len(result) == 2
    assert [set(g.kinds) for g in result] == [{"modifiers_differ"}] * 2
    assert [g.terms for g in result] == [(SEIZURE,), (HYPOTONIA,)]


def test_s10_combined_rows() -> None:
    data = {
        "a": [seizure("a1", m(SEVERE))],
        "b": [
            f(
                "b1",
                SEIZURE,
                (at("schwere Krampfanfälle"),),
                axes={**AXES, "assertion": "uncertain"},
            )
        ],
    }
    assert kinds(data, AB) == {"values_differ", "span_differs", "modifiers_differ"}


def test_s11_term_differs_compares_all_members() -> None:
    data = {
        "a": [seizure("a1", SEVERE_ON_TEXT)],
        "b": [f("b1", FOCAL, (KRAMPF,), m(RECURRENT))],
    }
    assert kinds(data, AB) == {"term_differs", "modifiers_differ"}
    assert dict(compare(data, AB).only_here) == {"a": 1, "b": 1}


def test_s12_three_people_term_differs() -> None:
    data = {
        "a": [seizure("a1", m(SEVERE))],
        "b": [seizure("b1")],
        "c": [f("c1", FOCAL, (KRAMPF,), m(MILD))],
    }
    assert kinds(data, ABC) >= {"term_differs", "modifiers_differ"}


def test_s13_partial() -> None:
    data = {"a": [seizure("a1", SEVERE_ON_TEXT)]}
    assert kinds(data, AB) == {"partial"}


def test_s14_partial_with_three() -> None:
    data = {"a": [seizure("a1", m(SEVERE))], "b": [seizure("b1")]}
    assert kinds(data, ABC) == {"partial", "modifiers_differ"}


def test_s15_two_of_three_same_set() -> None:
    data = {
        "a": [seizure("a1", m(SEVERE))],
        "b": [seizure("b1", m(SEVERE))],
        "c": [seizure("c1")],
    }
    assert kinds(data, ABC) == {"modifiers_differ"}


def test_s16_no_majority() -> None:
    data = {
        "a": [seizure("a1", m(SEVERE))],
        "b": [seizure("b1", m(SEVERE, RECURRENT))],
        "c": [seizure("c1", m(MILD))],
    }
    assert kinds(data, ABC) == {"modifiers_differ"}


def test_s17_cohort_sets() -> None:
    data = {"a": [seizure("a1", m(FREQUENT))], "b": [seizure("b1", m(RECURRENT))]}
    assert kinds(data, AB) == {"modifiers_differ"}
    assert compare(data, AB).context_differences == 1
    same = {"a": [seizure("a1", m(FREQUENT))], "b": [seizure("b1", m(FREQUENT))]}
    assert kinds(same, AB) == {"match"}
    assert compare(same, AB).matching == 1


def test_s18_standalone_never_merges() -> None:
    text = (at("schwere Krampfanfälle"),)
    data = {
        "a": [f("a1", SEVERE, text, standalone=True)],
        "b": [f("b1", SEIZURE, text, SEVERE_ON_TEXT)],
    }
    result = groups(data, AB)
    assert [dict(g.members) for g in result] == [{"a": "a1"}, {"b": "b1"}]
    assert [set(g.kinds) for g in result] == [
        {"modifier_as_finding", "partial"},
        {"partial"},
    ]


def test_s19_both_standalone() -> None:
    data = {
        "a": [f("a1", SEVERE, (SCHWERE,), standalone=True)],
        "b": [f("b1", SEVERE, (SCHWERE,), standalone=True)],
    }
    assert kinds(data, AB) == {"modifier_as_finding"}
    assert compare(data, AB).matching == 1


def test_s20_one_more_character_differs() -> None:
    data = {
        "a": [seizure("a1", SEVERE_ON_TEXT)],
        "b": [seizure("b1", ((SEVERE, (at("schwere "),)),))],
    }
    assert kinds(data, AB) == {"modifiers_differ"}
    assert compare(data, AB).matching == 1


def test_without_modifiers_nothing_changes() -> None:
    cases: list[tuple[dict[str, list[Finding]], list[str]]] = [
        (
            {
                "s1": [groups_f("a", 0, "HP:1", ((0, 5),))],
                "s2": [groups_f("b", 0, "HP:1", ((2, 5),))],
            },
            ["s1", "s2"],
        ),
        (
            {
                "s1": [groups_f("a", 0, "HP:1", ((0, 10),))],
                "s2": [groups_f("b", 0, "HP:2", ((5, 15),))],
                "s3": [groups_f("c", 0, "HP:1", ((0, 10),), {"assertion": "absent"})],
            },
            ["s1", "s2", "s3"],
        ),
        ({"s1": [groups_f("a", 0, "HP:1", ())]}, ["s1", "s2"]),
    ]
    expected = [
        [{"span_differs"}],
        [{"term_differs", "values_differ", "span_differs"}],
        [{"partial"}],
    ]
    for (data, order), kinds_expected in zip(cases, expected, strict=True):
        explicit = {
            s: [
                dataclasses.replace(x, modifier_spans=(), standalone_modifier=False)
                for x in own
            ]
            for s, own in data.items()
        }
        assert groups(explicit, order) == groups(data, order)
        assert compare(explicit, order) == compare(data, order)
        assert [set(g.kinds) for g in groups(data, order)] == kinds_expected
