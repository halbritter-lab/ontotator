"""Resolve validation (acceptance fixes spec "WP-E Backend > Resolve"): the
input ids name exactly one group, ``keep_both`` needs a term difference and
a choice stays inside the group. Every refusal writes nothing."""

from __future__ import annotations

from typing import Any

import pytest
from test_consolidation_resolve_api import (
    build_round,
    group,
    inputs,
    mutate,
    revision,
    view,
)
from test_final_panel_api import SEIZURE


@pytest.fixture
def cons(tmp_path):
    return build_round(tmp_path)


def refused(ns: Any, payload: dict[str, Any], action: str = "resolve") -> None:
    before = (revision(ns), view(ns)["groups"])
    response = mutate(ns, action, payload)
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "ROUND_INPUT_INVALID"
    assert (revision(ns), view(ns)["groups"]) == before


def choice(item: dict[str, Any], **extra: Any) -> dict[str, Any]:
    first = item["members"][0]
    return {
        "term_id": first["term_id"],
        "span_from_input_id": first["input_id"],
        "axes": dict(first["axes"]),
    } | extra


def test_a_subset_of_a_group_is_refused(cons):
    refused(
        cons, {"input_ids": inputs(group(cons, "values_differ"))[:1], "action": "keep"}
    )


def test_a_superset_of_a_group_is_refused(cons):
    ids = inputs(group(cons, "values_differ")) + inputs(group(cons, "partial"))
    refused(cons, {"input_ids": ids, "action": "keep"})


def test_ids_spanning_two_groups_are_refused(cons):
    ids = (
        inputs(group(cons, "values_differ"))[:1]
        + inputs(group(cons, "term_differs"))[:1]
    )
    refused(cons, {"input_ids": ids, "action": "keep"})


def test_repeated_ids_are_refused(cons):
    [only] = inputs(group(cons, "partial"))
    refused(cons, {"input_ids": [only, only], "action": "keep"})


def test_keep_both_needs_term_differs(cons):
    refused(
        cons, {"input_ids": inputs(group(cons, "values_differ")), "action": "keep_both"}
    )


def test_choose_needs_a_choice(cons):
    refused(
        cons, {"input_ids": inputs(group(cons, "values_differ")), "action": "choose"}
    )


def test_choice_term_outside_the_layer_is_refused(cons):
    values = group(cons, "values_differ")
    refused(
        cons,
        {
            "input_ids": inputs(values),
            "action": "choose",
            "choice": choice(values, term_id="MONDO:0000001"),
        },
    )


def test_choice_span_from_a_non_member_is_refused(cons):
    values = group(cons, "values_differ")
    outsider = inputs(group(cons, "partial"))[0]
    refused(
        cons,
        {
            "input_ids": inputs(values),
            "action": "choose",
            "choice": choice(values, span_from_input_id=outsider),
        },
    )


def test_choice_note_from_a_non_member_is_refused(cons):
    values = group(cons, "values_differ")
    outsider = inputs(group(cons, "partial"))[0]
    refused(
        cons,
        {
            "input_ids": inputs(values),
            "action": "choose",
            "choice": choice(values, note_from_input_id=outsider),
        },
    )


def test_choice_with_an_unknown_axis_value_is_refused(cons):
    values = group(cons, "values_differ")
    refused(
        cons,
        {
            "input_ids": inputs(values),
            "action": "choose",
            "choice": choice(values, axes={"assertion": "maybe"}),
        },
    )


def test_a_choice_on_keep_is_refused(cons):
    values = group(cons, "values_differ")
    refused(
        cons,
        {"input_ids": inputs(values), "action": "keep", "choice": choice(values)},
    )


def test_keep_on_differing_terms_or_values_is_refused(cons):
    """ "Keep" would take the default member's term and values as they are;
    a group whose members differ there needs a choice per field."""
    for kind in ("values_differ", "term_differs"):
        refused(cons, {"input_ids": inputs(group(cons, kind)), "action": "keep"})


def test_a_choice_missing_a_differing_axis_is_refused(cons):
    values = group(cons, "values_differ")
    assert values["differing_axes"] == ["assertion", "temporality"]
    first = values["members"][0]
    refused(
        cons,
        {
            "input_ids": inputs(values),
            "action": "choose",
            "choice": choice(values, axes={"assertion": first["axes"]["assertion"]}),
        },
    )


def test_annotate_and_reopen_need_one_exact_group(cons):
    ids = inputs(group(cons, "match")) + inputs(group(cons, "partial"))
    refused(cons, {"input_ids": ids, "guidelines_unclear": True}, "annotate")
    refused(cons, {"input_ids": ids}, "reopen")


def test_a_term_of_the_group_or_another_valid_term_is_accepted(cons):
    terms = group(cons, "term_differs")
    picked = choice(terms, term_id=terms["members"][1]["term_id"])
    response = mutate(
        cons,
        "resolve",
        {"input_ids": inputs(terms), "action": "choose", "choice": picked},
    )
    assert response.status_code == 200, response.text
    values = group(cons, "values_differ")
    other = mutate(
        cons,
        "resolve",
        {
            "input_ids": inputs(values),
            "action": "choose",
            "choice": choice(values, term_id=SEIZURE),
        },
    )
    assert other.status_code == 200, other.text


def test_another_term_is_stored_by_its_canonical_id(cons):
    """An alternative id of another term ("Other term…") is stored as the
    term's canonical id (``TermStatus.term_id``)."""
    from ontocurator.application.consolidation_resolve import (
        ConsolidationGroupService,
    )
    from ontocurator.domain.workspace import MutationEnvelope
    from ontocurator.storage.repository import Repository

    asked: list[tuple[str, str]] = []

    def valid_term(project_key: str, layer_id: str, term_id: str) -> str | None:
        asked.append((layer_id, term_id))
        return SEIZURE if term_id == "HP:ALT" else None

    values = group(cons, "values_differ")
    draft = ConsolidationGroupService(Repository(cons.env.db), valid_term).resolve(
        cons.round.workspace_key,
        MutationEnvelope(
            mutation_id="alt",
            expected_revision=revision(cons),
            payload={
                "input_ids": inputs(values),
                "action": "choose",
                "choice": choice(values, term_id="HP:ALT"),
            },
        ),
    )
    assert asked == [(values["members"][0]["layer_id"], "HP:ALT")]
    chosen = [
        s.annotation
        for s in draft.annotations
        if s.annotation.annotation_id.startswith("cons-")
        and s.annotation.provenance.source_refs
        == sorted(f"round-input:{i}" for i in inputs(values))
    ]
    assert [a.term_id for a in chosen] == [SEIZURE]
