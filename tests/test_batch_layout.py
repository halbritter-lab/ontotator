"""Batch assignment layout (spec "Assign dialog: many cases", D21), pure."""

import pytest

from ontocurator.domain.batch_layout import TooFewPeople, layout

CASES = [f"case-{n:04d}" for n in range(101, 121)]


def ones(cases, n=1):
    return dict.fromkeys(cases, n)


def test_one_person_gets_every_case():
    got, skipped = layout(CASES, ["ana"], mode="one", remaining=ones(CASES), already={})
    assert set(map(tuple, got.values())) == {("ana",)} and skipped == []


def test_split_evenly_is_contiguous_in_list_order():
    got, _ = layout(
        CASES, ["ana", "ben"], mode="split", remaining=ones(CASES), already={}
    )
    assert [got[c] for c in CASES[:10]] == [["ana"]] * 10
    assert [got[c] for c in CASES[10:]] == [["ben"]] * 10


def test_remainder_goes_to_the_first_people():
    got, _ = layout(
        CASES[:7],
        ["ana", "ben", "cy"],
        mode="split",
        remaining=ones(CASES[:7]),
        already={},
    )
    assert [got[c][0] for c in CASES[:7]] == ["ana"] * 3 + ["ben"] * 2 + ["cy"] * 2


def test_rotation_gives_n_distinct_people_per_text():
    got, _ = layout(
        CASES[:6],
        ["ana", "ben", "cy"],
        mode="split",
        remaining=ones(CASES[:6], 2),
        already={},
    )
    assert all(len(set(p)) == 2 for p in got.values())
    assert got[CASES[0]] == ["ana", "ben"] and got[CASES[5]] == ["cy", "ana"]


def test_remaining_per_case_fills_only_open_slots():
    # CASES[0] already has 1 of 2 annotators (ana); CASES[1] has none
    got, _ = layout(
        CASES[:2],
        ["ana", "ben", "cy"],
        mode="split",
        remaining={CASES[0]: 1, CASES[1]: 2},
        already={CASES[0]: frozenset({"ana"})},
    )
    assert len(got[CASES[0]]) == 1 and "ana" not in got[CASES[0]]
    assert len(set(got[CASES[1]])) == 2


def test_already_assigned_person_is_skipped_in_split_and_case_skipped_in_one():
    already = {CASES[0]: frozenset({"ana"})}
    split, _ = layout(
        CASES[:2],
        ["ana", "ben"],
        mode="split",
        remaining=ones(CASES[:2]),
        already=already,
    )
    assert split[CASES[0]] == ["ben"]
    one, skipped = layout(
        CASES[:2], ["ana"], mode="one", remaining=ones(CASES[:2]), already=already
    )
    assert CASES[0] not in one and skipped == [CASES[0]]


def test_too_few_people_for_per_text_raises():
    with pytest.raises(
        TooFewPeople,
        match=r"^Choose at least 2 annotators for 2 annotations per text$",
    ) as error:
        layout(
            CASES[:2], ["ana"], mode="split", remaining=ones(CASES[:2], 2), already={}
        )
    assert error.value.needed == 2


def test_too_few_reviewers_copy_names_reviewers():
    with pytest.raises(TooFewPeople, match=r"^Choose at least 2 reviewers for 2 "):
        layout(
            CASES[:1],
            ["ana"],
            mode="split",
            remaining=ones(CASES[:1], 2),
            already={},
            task="translation_review",
        )


def test_cases_without_remaining_slots_are_skipped():
    got, skipped = layout(
        CASES[:3],
        ["ana", "ben"],
        mode="split",
        remaining={CASES[0]: 0, CASES[1]: 1, CASES[2]: 1},
        already={},
    )
    assert skipped == [CASES[0]]
    assert got == {CASES[1]: ["ana"], CASES[2]: ["ben"]}


def test_no_people_assigns_nothing():
    assert layout(
        CASES[:2], [], mode="split", remaining=ones(CASES[:2]), already={}
    ) == (
        {},
        [],
    )


def test_each_person_gets_every_case_up_to_the_open_slots():
    cases = CASES[:3]
    got, skipped = layout(
        cases,
        ["ana", "ben", "cy"],
        mode="each",
        remaining={cases[0]: 2, cases[1]: 3, cases[2]: 0},
        already={cases[1]: frozenset({"ben"})},
    )
    assert got == {cases[0]: ["ana", "ben"], cases[1]: ["ana", "cy"]}
    assert skipped == [cases[2]]


def test_each_person_skips_a_case_every_chosen_person_holds():
    got, skipped = layout(
        CASES[:1],
        ["ana"],
        mode="each",
        remaining=ones(CASES[:1], 2),
        already={CASES[0]: frozenset({"ana"})},
    )
    assert got == {} and skipped == CASES[:1]
