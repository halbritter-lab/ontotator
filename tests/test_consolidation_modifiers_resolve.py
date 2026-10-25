"""Resolve consolidation groups with modifiers (modifiers plan M2, spec
"Consolidation > Backend", scenarios S3, S4, S8, S10 to S13, S18, S21, S22).

``choice.modifiers`` is the explicit final list, validated like
``add_modifier``; omitted, the span member's modifiers stay. A standalone
modifier group resolves by ``leave_out``, optionally ``attach_to`` a resolved
``cons-…`` finding that then gains the modifier.
"""

from __future__ import annotations

from typing import Any

import pytest
from test_consolidation_modifiers_read import (
    FOCAL,
    HYPOTONIA,
    MILD,
    RECURRENT,
    SEIZURE,
    SEVERE,
    found,
    group_of,
    mod_env,
    mod_round,
    modifier,
    span,
)
from test_consolidation_resolve_api import (
    annotation,
    cons_id,
    decide,
    inputs,
    mutate,
    ok,
    revision,
    target_refs,
    view,
)

from ontocurator.application.consolidation import open_group_count


def mod(term_id: str, words: str | None = None) -> dict[str, Any]:
    """A ``ModifierIn`` payload."""
    item = modifier(term_id, words)
    return {
        "term_id": item.term_id,
        "segments": [s.model_dump() for s in item.segments],
    }


def choose(
    item: dict[str, Any],
    modifiers: list[dict[str, Any]] | None = None,
    *,
    span_from: int = 0,
    term_id: str | None = None,
    axes: dict[str, str] | None = None,
) -> dict[str, Any]:
    member = item["members"][span_from]
    choice: dict[str, Any] = {
        "term_id": term_id or member["term_id"],
        "span_from_input_id": member["input_id"],
        "axes": axes or {axis: member["axes"][axis] for axis in item["differing_axes"]},
    }
    if modifiers is not None:
        choice["modifiers"] = modifiers
    return {"input_ids": inputs(item), "action": "choose", "choice": choice}


def result(ns: Any, item: dict[str, Any], draft: Any) -> Any:
    return annotation(draft, cons_id(ns, inputs(item), 0)).annotation


def dumped(annotation: Any) -> list[dict[str, Any]]:
    return [m.model_dump() for m in annotation.modifiers]


def refused(response: Any, code: str) -> None:
    assert response.status_code in {400, 404, 409, 422}, response.text
    assert response.json()["code"] == code, response.text


def command(ns: Any, payload: dict[str, Any]) -> None:
    """An editor command in the consolidator's workspace ("Edit in editor…")."""
    ns.count += 1
    response = ns.adj.post(
        f"/api/v1/workspaces/{view(ns)['workspace_id']}/commands",
        json={
            "mutation_id": f"edit-{ns.count}",
            "expected_revision": revision(ns),
            "payload": payload,
        },
    )
    assert response.status_code == 200, response.text


SEVERE_TEXT = [
    {
        "term_id": SEVERE,
        "segments": [dict(zip(("start", "end"), span("schwere"), strict=True))],
    }
]


@pytest.fixture
def subset(tmp_path):
    """S3: A {Severe “schwere”}, B {Severe “schwere”, Recurrent}."""
    env = mod_env(tmp_path)
    return mod_round(
        env,
        "c1",
        {
            "ana": [found("s", SEIZURE, "Krampfanfälle", modifier(SEVERE, "schwere"))],
            "ben": [
                found(
                    "s",
                    SEIZURE,
                    "Krampfanfälle",
                    modifier(SEVERE, "schwere"),
                    modifier(RECURRENT),
                )
            ],
        },
    )


def test_choose_takes_the_explicit_modifiers(subset):
    item = group_of(subset, SEIZURE)
    chosen = [mod(RECURRENT), mod(SEVERE, "schwere")]
    draft = ok(mutate(subset, "resolve", choose(item, chosen)))
    assert dumped(result(subset, item, draft)) == [
        {"term_id": SEVERE, "segments": SEVERE_TEXT[0]["segments"]},
        {"term_id": RECURRENT},
    ]
    after = group_of(subset, SEIZURE)
    assert after["state"] == "choose" and after["edited"] is False


def test_edit_values_may_add_a_modifier_nobody_had(subset):
    item = group_of(subset, SEIZURE)
    draft = ok(mutate(subset, "resolve", choose(item, [mod(MILD)])))
    assert dumped(result(subset, item, draft)) == [{"term_id": MILD}]
    # "No modifiers" is an empty list.
    draft = ok(mutate(subset, "resolve", choose(item, [])))
    assert result(subset, item, draft).modifiers == []


@pytest.mark.parametrize(
    ("modifiers", "term_id", "code"),
    [
        ([mod(SEIZURE)], None, "MODIFIER_NOT_ALLOWED"),
        ([mod(SEVERE), mod(SEVERE, "schwere")], None, "DUPLICATE_MODIFIER"),
        ([mod("HP:9999999")], None, "UNKNOWN_TERM"),
        (None, SEVERE, "MODIFIER_AS_FINDING"),
    ],
)
def test_invalid_choices_are_refused(subset, modifiers, term_id, code):
    item = group_of(subset, SEIZURE)
    refused(mutate(subset, "resolve", choose(item, modifiers, term_id=term_id)), code)
    assert group_of(subset, SEIZURE)["state"] == "open"


def test_modifiers_default_to_the_span_member(tmp_path):
    """S10: B's span with A's modifiers is allowed; omitted, B's (none)."""
    env = mod_env(tmp_path)
    ns = mod_round(
        env,
        "c1",
        {
            "ana": [found("s", SEIZURE, "Krampfanfälle", modifier(SEVERE, "schwere"))],
            "ben": [
                found("s", SEIZURE, "schwere Krampfanfälle", assertion="uncertain")
            ],
        },
    )
    item = group_of(ns, SEIZURE)
    assert {"values_differ", "modifiers_differ"} <= set(item["kinds"])
    present = {"assertion": "present"}
    draft = ok(mutate(ns, "resolve", choose(item, span_from=1, axes=present)))
    assert result(ns, item, draft).modifiers == []
    draft = ok(
        mutate(ns, "resolve", choose(item, SEVERE_TEXT, span_from=1, axes=present))
    )
    chosen = result(ns, item, draft)
    assert dumped(chosen) == SEVERE_TEXT
    assert chosen.axes_values["assertion"] == "present"


def test_union_with_conflicting_spans_keeps_one_variant(tmp_path):
    """S8: A {Severe “schwere”}, B {Severe, Recurrent “wiederholt”}: the
    pressed ✓ (A's Severe, B's Recurrent) are stored sorted."""
    env = mod_env(tmp_path)
    ns = mod_round(
        env,
        "c1",
        {
            "ana": [found("s", SEIZURE, "Krampfanfälle", modifier(SEVERE, "schwere"))],
            "ben": [
                found(
                    "s",
                    SEIZURE,
                    "Krampfanfälle",
                    modifier(SEVERE),
                    modifier(RECURRENT, "wiederholt"),
                )
            ],
        },
    )
    item = group_of(ns, SEIZURE)
    draft = ok(
        mutate(
            ns, "resolve", choose(item, [mod(RECURRENT, "wiederholt"), *SEVERE_TEXT])
        )
    )
    assert [m.term_id for m in result(ns, item, draft).modifiers] == [
        SEVERE,
        RECURRENT,
    ]


def test_keep_and_take_over_keep_the_members_modifiers(tmp_path):
    """S1 is taken over with its modifiers; S13 "Keep" keeps A's."""
    env = mod_env(tmp_path)
    ns = mod_round(
        env,
        "c1",
        {
            "ana": [
                found("s", SEIZURE, "Krampfanfälle", modifier(SEVERE, "schwere")),
                found("h", HYPOTONIA, "Muskelhypotonie", modifier(MILD)),
            ],
            "ben": [found("s", SEIZURE, "Krampfanfälle", modifier(SEVERE, "schwere"))],
        },
    )
    auto = group_of(ns, SEIZURE)
    assert auto["state"] == "auto"
    partial = group_of(ns, HYPOTONIA)
    draft = ok(mutate(ns, "resolve", {"input_ids": inputs(partial), "action": "keep"}))
    assert dumped(result(ns, auto, draft)) == SEVERE_TEXT
    assert dumped(result(ns, partial, draft)) == [{"term_id": MILD}]
    draft = ok(
        mutate(ns, "resolve", {"input_ids": inputs(partial), "action": "leave_out"})
    )
    assert not any(
        s.annotation.annotation_id == cons_id(ns, inputs(partial), 0)
        for s in draft.annotations
    )


def test_term_choice_and_modifier_choice_are_independent(tmp_path):
    """S11 (two people) and S12 (three): the modifiers come from the list,
    not from the chosen term's member."""
    env = mod_env(tmp_path)
    two = mod_round(
        env,
        "c1",
        {
            "ana": [found("s", SEIZURE, "Krampfanfälle", modifier(SEVERE, "schwere"))],
            "ben": [found("f", FOCAL, "schwere Krampfanfälle", modifier(RECURRENT))],
        },
    )
    item = group_of(two, SEIZURE)
    assert {"term_differs", "modifiers_differ"} <= set(item["kinds"])
    draft = ok(mutate(two, "resolve", choose(item, SEVERE_TEXT, term_id=FOCAL)))
    chosen = result(two, item, draft)
    assert (chosen.term_id, dumped(chosen)) == (FOCAL, SEVERE_TEXT)

    three = mod_round(
        env,
        "c2",
        {
            "ana": [found("s", SEIZURE, "Krampfanfälle", modifier(SEVERE))],
            "ben": [found("s", SEIZURE, "Krampfanfälle")],
            "cem": [found("f", FOCAL, "schwere Krampfanfälle", modifier(MILD))],
        },
    )
    item = group_of(three, SEIZURE)
    assert len(item["members"]) == 3
    draft = ok(mutate(three, "resolve", choose(item, [mod(MILD)], term_id=SEIZURE)))
    chosen = result(three, item, draft)
    assert (chosen.term_id, dumped(chosen)) == (SEIZURE, [{"term_id": MILD}])


# --- S18 attach, S21 reopen, S22 editor edit ----------------------------------- #


@pytest.fixture
def standalone(tmp_path):
    """S18: A marks Severe on "schwere" as a finding; B Seizure {} and
    Hypotonia {Severe on "wiederholt"}; both of B's groups are kept."""
    env = mod_env(tmp_path)
    ns = mod_round(
        env,
        "c1",
        {
            "ana": [found("x", SEVERE, "schwere")],
            "ben": [
                found("s", SEIZURE, "Krampfanfälle"),
                found(
                    "h", HYPOTONIA, "Muskelhypotonie", modifier(SEVERE, "wiederholt")
                ),
            ],
        },
    )
    for term_id in (SEIZURE, HYPOTONIA):
        item = group_of(ns, term_id)
        ok(mutate(ns, "resolve", {"input_ids": inputs(item), "action": "keep"}))
    return ns


def attach(ns: Any, target_term: str) -> Any:
    target = cons_id(ns, inputs(group_of(ns, target_term)), 0)
    return mutate(
        ns,
        "resolve",
        {
            "input_ids": inputs(group_of(ns, SEVERE)),
            "action": "leave_out",
            "attach_to": target,
        },
    )


def test_attach_adds_the_modifier_without_reading_edited(standalone):
    draft = ok(attach(standalone, SEIZURE))
    seizure = group_of(standalone, SEIZURE)
    assert dumped(annotation(draft, seizure["annotation_ids"][0]).annotation) == (
        SEVERE_TEXT
    )
    assert seizure["state"] == "keep" and seizure["edited"] is False
    left = group_of(standalone, SEVERE)
    assert left["state"] == "leave_out"
    assert left["attached_to"] == seizure["annotation_ids"][0]
    # The decisions point to the new version of the target.
    replaced = {
        d.replacement.version
        for d in draft.decisions
        if d.replacement is not None
        and d.replacement.annotation_id == seizure["annotation_ids"][0]
    }
    assert replaced == {annotation(draft, seizure["annotation_ids"][0]).version}


def test_attach_is_refused_on_other_spans_and_other_groups(standalone):
    refused(attach(standalone, HYPOTONIA), "DUPLICATE_MODIFIER")
    seizure = group_of(standalone, SEIZURE)
    target = cons_id(standalone, inputs(seizure), 0)
    refused(
        mutate(
            standalone,
            "resolve",
            {"input_ids": inputs(seizure), "action": "leave_out", "attach_to": target},
        ),
        "INVALID_RESOLUTION",
    )
    refused(
        mutate(
            standalone,
            "resolve",
            {
                "input_ids": inputs(group_of(standalone, SEVERE)),
                "action": "leave_out",
                "attach_to": "cons-0000000000000000",
            },
        ),
        "INVALID_RESOLUTION",
    )
    refused(
        mutate(
            standalone,
            "resolve",
            {"input_ids": inputs(group_of(standalone, SEVERE)), "action": "keep"},
        ),
        "MODIFIER_AS_FINDING",
    )


def test_reopen_of_the_attached_group_detaches_the_modifier(standalone):
    ok(attach(standalone, SEIZURE))
    draft = ok(
        mutate(
            standalone,
            "reopen",
            {"input_ids": inputs(group_of(standalone, SEVERE))},
        )
    )
    seizure = group_of(standalone, SEIZURE)
    assert annotation(draft, seizure["annotation_ids"][0]).annotation.modifiers == []
    assert seizure["edited"] is False
    assert group_of(standalone, SEVERE)["state"] == "open"


def test_reopen_after_linking_restores_the_spanless_modifier(tmp_path):
    """Attaching onto the target's spanless Severe only links segments; a
    reopen gives the target its own Severe back."""
    ns = mod_round(
        mod_env(tmp_path),
        "c1",
        {
            "ana": [found("x", SEVERE, "schwere")],
            "ben": [found("s", SEIZURE, "Krampfanfälle", modifier(SEVERE))],
        },
    )
    ok(
        mutate(
            ns,
            "resolve",
            {"input_ids": inputs(group_of(ns, SEIZURE)), "action": "keep"},
        )
    )
    draft = ok(attach(ns, SEIZURE))
    target = group_of(ns, SEIZURE)["annotation_ids"][0]
    assert dumped(annotation(draft, target).annotation) == SEVERE_TEXT
    draft = ok(mutate(ns, "reopen", {"input_ids": inputs(group_of(ns, SEVERE))}))
    assert dumped(annotation(draft, target).annotation) == [{"term_id": SEVERE}]
    assert group_of(ns, SEIZURE)["edited"] is False


def test_an_editor_decision_on_the_attached_group_detaches(standalone):
    ok(attach(standalone, SEIZURE))
    [member] = sorted(target_refs(standalone, inputs(group_of(standalone, SEVERE))))
    draft = decide(standalone, member, None)
    target = group_of(standalone, SEIZURE)["annotation_ids"][0]
    assert annotation(draft, target).annotation.modifiers == []
    assert group_of(standalone, SEIZURE)["edited"] is False


def test_reopen_of_the_target_reopens_the_attached_group(standalone):
    """S21 B: the attached group reads open, counts and gates submit."""
    ok(attach(standalone, SEIZURE))
    draft = ok(
        mutate(
            standalone,
            "reopen",
            {"input_ids": inputs(group_of(standalone, SEIZURE))},
        )
    )
    assert group_of(standalone, SEVERE)["state"] == "open"
    assert group_of(standalone, SEIZURE)["state"] == "open"
    with standalone.env.db.transaction() as conn:
        count = open_group_count(
            conn, standalone.env.pid, standalone.round.round_id, draft.decisions
        )
    assert count == 2


def test_editor_removal_of_the_attached_modifier_keeps_the_group(standalone):
    """Accepted edge case: the attached group stays resolved."""
    ok(attach(standalone, SEIZURE))
    target = group_of(standalone, SEIZURE)["annotation_ids"][0]
    command(
        standalone,
        {"command": "remove_modifier", "annotation_id": target, "term_id": SEVERE},
    )
    assert group_of(standalone, SEVERE)["state"] == "leave_out"
    assert group_of(standalone, SEIZURE)["edited"] is True


def test_editor_edit_of_a_consolidated_modifier_reads_edited(subset):
    """S22: add Recurrent in the editor; still resolved, decisions repointed."""
    item = group_of(subset, SEIZURE)
    ok(mutate(subset, "resolve", choose(item, SEVERE_TEXT)))
    target = cons_id(subset, inputs(item), 0)
    command(
        subset,
        {"command": "add_modifier", "annotation_id": target, "term_id": RECURRENT},
    )
    after = group_of(subset, SEIZURE)
    assert after["state"] == "choose" and after["edited"] is True
