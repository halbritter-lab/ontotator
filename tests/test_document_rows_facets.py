"""Documents facets: filter popover counts and the new filters (documents
overview spec "Filter popover", "Search", VD9, VD10, VD11)."""

from __future__ import annotations

from typing import Any

import pytest
from test_document_rows_next_step import import_case
from test_document_rows_stages import (
    ANNOTATE,
    BOTH,
    REVIEW,
    plan,
    pseudonym,
    set_status,
    undecide,
)
from work_plan_support import BASE, assign, doc, plan_env

Params = list[tuple[str, str]]
GROUPS = (
    "language",
    "review_state",
    "annotation_state",
    "final_state",
    "origin",
    "plan",
    "waiting_on",
    "flags",
)


@pytest.fixture
def env(tmp_path):
    """The tabs scenario: c1 de review-only accepted; c1 fr Annotate only;
    c2 de both with Ana reviewing; c2 en annotated by Anne; c2 fr undecided."""
    env = plan_env(tmp_path)
    for case in ("c1", "c2"):
        for language in ("de", "fr"):
            set_status(env, doc(case, language), "ready_for_review")
    plan(env, c1_de=REVIEW, c1_fr=ANNOTATE, c2_de=BOTH)
    set_status(env, doc("c1", "de"), "accepted")
    assign(env, doc("c2", "de"), "ana", "translation_review")
    assign(env, doc("c2", "en"), "anno", "annotate")
    undecide(env, ("c2", "fr"))
    return env


def get(env: Any, params: Params) -> dict[str, Any]:
    response = env.lead.get(f"{BASE}/document-rows", params=params)
    assert response.status_code == 200, response.text
    return dict(response.json())


def keys(env: Any, params: Params) -> set[tuple[str, str]]:
    return {
        (row["case_id"], row["language"])
        for group in get(env, params)["groups"]
        for row in group["rows"]
    }


def test_facet_counts_exclude_own_group(env):
    facets = get(env, [("language", "de")])["bar"]["facets"]
    assert set(facets) == set(GROUPS)
    # Language counts ignore the language selection ...
    assert facets["language"] == {"de": 2, "en": 2, "fr": 2}
    # ... every other group respects it.
    review = {value: n for value, n in facets["review_state"].items() if n}
    assert review == {"accepted": 1, "in_progress": 1}
    assert sum(facets["annotation_state"].values()) == 2
    # Values present in the project stay listed with 0 (shown muted).
    assert facets["review_state"]["undecided"] == 0


def test_checked_value_without_rows_stays_listed(env):
    facets = get(env, [("review_state", "source_changed")])["bar"]["facets"]
    assert facets["review_state"]["source_changed"] == 0
    assert "source_changed" not in get(env, [])["bar"]["facets"]["review_state"]


def test_each_facet_filter_equals_shown(env):
    for base in ([], [("segment", "decision")], [("q", "c2")]):
        facets = get(env, base)["bar"]["facets"]
        checked = 0
        for group, counts in facets.items():
            for value, count in counts.items():
                shown = get(env, [*base, (group, value)])["bar"]["shown"]
                assert shown == count, (base, group, value)
                checked += 1
        assert checked > 0, base
    # A second value of the same group adds its rows (OR within a group).
    both = get(env, [("language", "de"), ("language", "fr")])["bar"]["shown"]
    assert both == 4


def test_repeatable_language_and_origin_or_within_and_across(env):
    assert keys(env, [("language", "de"), ("language", "fr")]) == {
        (case, language) for case in ("c1", "c2") for language in ("de", "fr")
    }
    native = keys(env, [("origin", "native")])
    assert native == {("c1", "en"), ("c2", "en")}
    assert keys(env, [("origin", "native"), ("origin", "machine_translation")]) == (
        keys(env, [])
    )
    assert keys(env, [("language", "de"), ("origin", "native")]) == set()
    assert keys(
        env, [("language", "de"), ("language", "en"), ("origin", "native")]
    ) == (native)


def test_plan_not_decided_subset_of_not_in_plan(env):
    not_decided = keys(env, [("plan", "not_decided")])
    assert not_decided == {("c2", "fr")}
    assert not_decided <= keys(env, [("plan", "not_in_plan")])
    assert get(env, [("plan", "not_decided")])["bar"]["shown"] == 1


def test_waiting_on_me_and_pseudonym(env):
    me = keys(env, [("waiting_on", "me")])
    assert me == {("c1", "en"), ("c1", "fr"), ("c2", "fr")}
    ana = keys(env, [("waiting_on", pseudonym(env, "ana"))])
    assert ana == {("c2", "de")}
    assert keys(env, [("waiting_on", "me"), ("waiting_on", pseudonym(env, "ana"))]) == (
        me | ana
    )
    facets = get(env, [])["bar"]["facets"]["waiting_on"]
    assert facets == {"me": 3, pseudonym(env, "ana"): 1, pseudonym(env, "anno"): 1}


def test_sort_descending_case_and_activity(env, tmp_path):
    import_case(env, tmp_path, "a0")
    assign(env, doc("c1", "en"), "anno2", "annotate")  # c1 is newest now

    def order(sort: str) -> list[str]:
        return [g["case_id"] for g in get(env, [("sort", sort)])["groups"]]

    assert order("case") == ["a0", "c1", "c2"]
    assert order("-case") == ["c2", "c1", "a0"]
    # Newest first; "-activity" oldest first; never active cases stay last.
    assert order("activity") == ["c1", "c2", "a0"]
    assert order("-activity") == ["c2", "c1", "a0"]


def test_search_text_label_forms(env):
    assert keys(env, [("q", "c2 de")]) == {("c2", "de")}
    assert keys(env, [("q", "c2 · de")]) == {("c2", "de")}
    assert keys(env, [("q", "c2·de")]) == {("c2", "de")}
    assert keys(env, [("q", "c2 xx")]) == set()
    assert keys(env, [("q", "c2")]) == {("c2", "en"), ("c2", "de"), ("c2", "fr")}
    assert keys(env, [("q", "c1-f")]) == {("c1", "fr")}


@pytest.mark.parametrize(
    "name", ["review_state", "annotation_state", "final_state", "origin", "plan"]
)
def test_unknown_facet_value_is_422(env, name):
    response = env.lead.get(f"{BASE}/document-rows", params=[(name, "bogus")])
    assert response.status_code == 422, response.text
