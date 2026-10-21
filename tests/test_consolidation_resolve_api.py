"""Resolve, annotate and reopen consolidation groups (acceptance fixes spec
"WP-E Backend > Resolve / Annotate / Reopen").

``POST /workspaces/{id}/consolidation-groups/{resolve,annotate,reopen}`` are
draft mutations of the consolidator's workspace: resolve writes the
consolidated annotation(s) ``cons-…`` and the group's decisions with their
``ConsolidationMark``; annotate changes note and flag only; reopen deletes
the group's annotations and decisions.
"""

from __future__ import annotations

import hashlib
from types import SimpleNamespace
from typing import Any

import pytest
from auth_harness import logged_in
from sqlalchemy import func, select
from test_final_panel_api import (
    HYPOTONIA,
    SEIZURE,
    _text,
    finding,
    span_of,
    submit_findings,
)
from work_plan_support import assign, doc, plan_env

from ontocurator.application.consolidation import consolidated_content_sha256
from ontocurator.application.work_rounds import WorkRoundService
from ontocurator.auth.audit import Actor
from ontocurator.authz.policy import Access
from ontocurator.domain.annotations import AnnotationSnapshot
from ontocurator.domain.workspace import Draft
from ontocurator.storage.repository import Repository, _key_str
from ontocurator.storage.tables import DraftRow

FIRST = "sub-first-res"
SECOND = "sub-second-res"
OTHER_TERM = "HP:0001284"  # known to the test ontology
STATUS = "HP:0002133"  # known to the test ontology
FEBRILE = "HP:0011146"  # known to the test ontology


def access_of(env: Any, username: str, *roles: str) -> tuple[Access, Actor]:
    user = env.app.state.accounts.get_by_username(username)
    access = Access(user.id, user.pseudonym, False, {"proj": frozenset(roles)})
    return access, Actor.user(user.id, username)


def build_round(tmp_path: Any) -> SimpleNamespace:
    """Two submissions on c1-en and a consolidation round assigned to ``adj``.

    Groups in reading order: match (Neonatalzeit), term_differs (STATUS on
    "Seit 2" / FEBRILE on "2 Wochen"), values_differ (Hypotonia on "schwere":
    assertion and temporality differ), partial (the second person's late
    "Krampfanf").
    """
    env = plan_env(tmp_path)
    target = doc("c1", "en")
    neonatal = span_of(env, target, "Neonatalzeit")
    seit = span_of(env, target, "Seit 2")
    weeks = span_of(env, target, "2 Wochen")
    heavy = span_of(env, target, "schwere")
    last = _text(env, target).rindex("Krampfanf")
    late = (last, last + len("Krampfanf"))
    submit_findings(
        env,
        assign(env, target, "anno", "annotate"),
        FIRST,
        [
            finding("a1", SEIZURE, neonatal, temporality="current"),
            finding("a2", STATUS, seit, temporality="current"),
            finding(
                "a3", HYPOTONIA, heavy, assertion="present", temporality="historical"
            ),
        ],
    )
    submit_findings(
        env,
        assign(env, target, "anno2", "annotate"),
        SECOND,
        [
            finding("b1", SEIZURE, neonatal, temporality="current"),
            finding("b2", FEBRILE, weeks, temporality="current"),
            finding("b3", HYPOTONIA, heavy, assertion="absent", temporality="current"),
            finding("b4", OTHER_TERM, late, temporality="current"),
        ],
    )
    review = assign(env, target, "adj", "review")
    lead_access, lead_actor = access_of(env, "leader", "lead")
    created = WorkRoundService(env.db).create(
        lead_access,
        lead_actor,
        review,
        request_id="consolidate",
        expected_workflow_revision=0,
        kind="consolidation",
        source_submission_ids=[FIRST, SECOND],
    )
    adj = logged_in(env.app, "adj", assignments=[])
    ns = SimpleNamespace(env=env, round=created, adj=adj, review=review, count=0)
    return ns


@pytest.fixture
def cons(tmp_path):
    return build_round(tmp_path)


def view(ns: Any) -> dict[str, Any]:
    response = ns.adj.get(f"/api/v1/rounds/{ns.round.round_id}/consolidation")
    assert response.status_code == 200, response.text
    return response.json()  # type: ignore[no-any-return]


def group(ns: Any, kind: str) -> dict[str, Any]:
    return next(g for g in view(ns)["groups"] if kind in g["kinds"])


def inputs(item: dict[str, Any]) -> list[str]:
    return [m["input_id"] for m in item["members"]]


def revision(ns: Any) -> int:
    with ns.env.db.transaction() as conn:
        return int(
            conn.execute(
                select(DraftRow.revision).where(
                    DraftRow.project_id == ns.env.pid,
                    DraftRow.draft_key == _key_str(ns.round.workspace_key),
                )
            ).scalar_one()
        )


def mutate(
    ns: Any,
    action: str,
    payload: dict[str, Any],
    *,
    client: Any = None,
    mutation_id: str | None = None,
) -> Any:
    ns.count += 1
    workspace = view(ns)["workspace_id"]
    return (client or ns.adj).post(
        f"/api/v1/workspaces/{workspace}/consolidation-groups/{action}",
        json={
            "mutation_id": mutation_id or f"m-{ns.count}",
            "expected_revision": revision(ns),
            "payload": payload,
        },
    )


def ok(response: Any) -> Draft:
    assert response.status_code == 200, response.text
    return Draft.model_validate(response.json())


def cons_id(ns: Any, input_ids: list[str], n: int) -> str:
    joined = "|".join(sorted(input_ids))
    digest = hashlib.sha256(f"{ns.round.round_id}|{joined}|{n}".encode()).hexdigest()
    return f"cons-{digest[:16]}"


def target_refs(ns: Any, input_ids: list[str]) -> set[tuple[str, str]]:
    inventory = {
        i["input_id"]: i
        for i in ns.env.app.state.repo.get_round_input_inventory(
            "proj", ns.round.round_id
        )
    }
    return {
        (
            inventory[i]["target_snapshot"]["annotation"]["annotation_id"],
            inventory[i]["target_snapshot"]["version"],
        )
        for i in input_ids
    }


def decisions_on(draft: Draft, refs: set[tuple[str, str]]) -> list[Any]:
    return [
        d for d in draft.decisions if (d.target.annotation_id, d.target.version) in refs
    ]


def annotation(draft: Draft, annotation_id: str) -> AnnotationSnapshot:
    return next(
        s for s in draft.annotations if s.annotation.annotation_id == annotation_id
    )


def test_keep_on_a_partial_group_writes_one_merged_annotation(cons):
    partial = group(cons, "partial")
    ids = inputs(partial)
    draft = ok(mutate(cons, "resolve", {"input_ids": ids, "action": "keep"}))
    cid = cons_id(cons, ids, 0)
    kept = annotation(draft, cid)
    assert kept.annotation.term_id == OTHER_TERM
    assert kept.annotation.provenance.method == "merged"
    assert kept.annotation.provenance.source_refs == [f"round-input:{ids[0]}"]
    assert kept.annotation.provenance.actor.actor_id == cons.round.annotator_id
    [decision] = decisions_on(draft, target_refs(cons, ids))
    assert decision.outcome == "changed"
    assert decision.replacement.annotation_id == cid
    assert decision.reviewer_id == cons.round.annotator_id
    assert decision.consolidation.action == "keep"
    assert decision.consolidation.content_sha256 == consolidated_content_sha256(
        kept.annotation
    )
    after = group(cons, "partial")
    assert (after["state"], after["edited"]) == ("keep", False)
    assert after["annotation_ids"] == [cid]


def test_choose_takes_axes_from_two_people(cons):
    values = group(cons, "values_differ")
    ids = inputs(values)
    assert values["differing_axes"] == ["assertion", "temporality"]
    first, second = values["members"]
    axes = dict(first["axes"]) | {
        "assertion": second["axes"]["assertion"],
        "temporality": first["axes"]["temporality"],
    }
    draft = ok(
        mutate(
            cons,
            "resolve",
            {
                "input_ids": ids,
                "action": "choose",
                "choice": {
                    "term_id": HYPOTONIA,
                    "span_from_input_id": second["input_id"],
                    "axes": axes,
                },
                "note": "Second reading",
                "guidelines_unclear": True,
            },
        )
    )
    chosen = annotation(draft, cons_id(cons, ids, 0))
    assert chosen.annotation.axes_values["assertion"] == "absent"
    assert chosen.annotation.axes_values["temporality"] == "historical"
    assert sorted(chosen.annotation.provenance.source_refs) == sorted(
        f"round-input:{i}" for i in ids
    )
    marked = decisions_on(draft, target_refs(cons, ids))
    assert len(marked) == 2
    assert {d.consolidation.action for d in marked} == {"choose"}
    assert all(d.consolidation.guidelines_unclear for d in marked)
    assert {d.note for d in marked} == {"Second reading"}
    after = group(cons, "values_differ")
    assert (after["state"], after["note"], after["guidelines_unclear"]) == (
        "choose",
        "Second reading",
        True,
    )
    assert after["edited"] is False


def test_keep_both_on_term_differs_writes_two_annotations(cons):
    terms = group(cons, "term_differs")
    ids = inputs(terms)
    draft = ok(mutate(cons, "resolve", {"input_ids": ids, "action": "keep_both"}))
    first, second = cons_id(cons, ids, 0), cons_id(cons, ids, 1)
    assert annotation(draft, first).annotation.term_id == STATUS
    assert annotation(draft, second).annotation.term_id == FEBRILE
    marked = decisions_on(draft, target_refs(cons, ids))
    assert {d.replacement.annotation_id for d in marked} == {first, second}
    assert {d.consolidation.action for d in marked} == {"keep_both"}
    after = group(cons, "term_differs")
    assert after["state"] == "keep_both"
    assert after["annotation_ids"] == sorted([first, second])


def test_leave_out_records_reject_decisions_only(cons):
    values = group(cons, "values_differ")
    ids = inputs(values)
    before = len(
        ok(
            mutate(cons, "reopen", {"input_ids": inputs(group(cons, "match"))})
        ).annotations
    )
    draft = ok(mutate(cons, "resolve", {"input_ids": ids, "action": "leave_out"}))
    assert len(draft.annotations) == before
    marked = decisions_on(draft, target_refs(cons, ids))
    assert {d.outcome for d in marked} == {"rejected"}
    assert {d.consolidation.action for d in marked} == {"leave_out"}
    assert all(d.consolidation.content_sha256 is None for d in marked)
    assert group(cons, "values_differ")["state"] == "leave_out"


def test_repeated_identical_resolve_writes_no_duplicate(cons):
    ids = inputs(group(cons, "partial"))
    once = ok(mutate(cons, "resolve", {"input_ids": ids, "action": "keep"}))
    twice = ok(mutate(cons, "resolve", {"input_ids": ids, "action": "keep"}))
    assert [(s.annotation.annotation_id, s.version) for s in twice.annotations] == [
        (s.annotation.annotation_id, s.version) for s in once.annotations
    ]
    assert [d.model_dump() for d in twice.decisions] == [
        d.model_dump() for d in once.decisions
    ]


def test_a_retried_mutation_replays(cons):
    ids = inputs(group(cons, "partial"))
    first = mutate(
        cons, "resolve", {"input_ids": ids, "action": "keep"}, mutation_id="x"
    )
    assert first.status_code == 200, first.text
    workspace = view(cons)["workspace_id"]
    again = cons.adj.post(
        f"/api/v1/workspaces/{workspace}/consolidation-groups/resolve",
        json={
            "mutation_id": "x",
            "expected_revision": first.json()["revision"] - 1,
            "payload": {"input_ids": ids, "action": "keep"},
        },
    )
    assert again.status_code == 200, again.text
    assert again.json() == first.json()


def test_input_ids_of_another_round_are_invalid(cons, tmp_path):
    other = build_round(tmp_path / "other")
    foreign = inputs(group(other, "partial"))
    response = mutate(cons, "resolve", {"input_ids": foreign, "action": "keep"})
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "ROUND_INPUT_INVALID"


def test_another_users_workspace_is_refused(cons):
    other = logged_in(
        cons.env.app, "rev2", projects={"proj": ["adjudicator"]}, assignments=[]
    )
    before = revision(cons)
    response = mutate(
        cons,
        "resolve",
        {"input_ids": inputs(group(cons, "partial")), "action": "keep"},
        client=other,
    )
    assert response.status_code in {403, 404}, response.text
    assert response.json()["code"] == "IDENTITY_MISMATCH"
    assert revision(cons) == before


def test_resolve_clears_the_checked_layer(cons):
    with cons.env.db.transaction() as conn:
        conn.execute(
            DraftRow.__table__.update()
            .where(DraftRow.draft_key == _key_str(cons.round.workspace_key))
            .values(checked_layer_ids=["hpo"])
        )
    draft = ok(
        mutate(
            cons,
            "resolve",
            {"input_ids": inputs(group(cons, "partial")), "action": "keep"},
        )
    )
    assert draft.checked_layer_ids == []


def test_annotate_sets_note_and_flag_on_an_auto_group(cons):
    match = group(cons, "match")
    assert match["state"] == "auto"
    before = ok(
        mutate(
            cons, "annotate", {"input_ids": inputs(match), "guidelines_unclear": False}
        )
    )
    draft = ok(
        mutate(
            cons,
            "annotate",
            {
                "input_ids": inputs(match),
                "note": "Check the age",
                "guidelines_unclear": True,
            },
        )
    )
    assert [(s.annotation.annotation_id, s.version) for s in draft.annotations] == [
        (s.annotation.annotation_id, s.version) for s in before.annotations
    ]
    after = group(cons, "match")
    assert (after["state"], after["note"], after["guidelines_unclear"]) == (
        "auto",
        "Check the age",
        True,
    )
    assert after["edited"] is False
    cleared = ok(
        mutate(
            cons,
            "annotate",
            {"input_ids": inputs(match), "note": None, "guidelines_unclear": False},
        )
    )
    assert all(
        d.note is None for d in decisions_on(cleared, target_refs(cons, inputs(match)))
    )
    assert group(cons, "match")["guidelines_unclear"] is False


def test_annotate_keeps_the_content_hash_of_a_resolved_group(cons):
    ids = inputs(group(cons, "partial"))
    ok(mutate(cons, "resolve", {"input_ids": ids, "action": "keep"}))
    draft = ok(
        mutate(
            cons,
            "annotate",
            {"input_ids": ids, "note": "Group note", "guidelines_unclear": False},
        )
    )
    kept = annotation(draft, cons_id(cons, ids, 0))
    [decision] = decisions_on(draft, target_refs(cons, ids))
    assert decision.consolidation.content_sha256 == consolidated_content_sha256(
        kept.annotation
    )
    after = group(cons, "partial")
    assert (after["note"], after["edited"]) == ("Group note", False)


def test_annotate_an_open_group_is_refused(cons):
    response = mutate(
        cons,
        "annotate",
        {"input_ids": inputs(group(cons, "partial")), "guidelines_unclear": True},
    )
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "ROUND_INPUT_INVALID"


def test_reopen_deletes_annotations_and_decisions(cons):
    ids = inputs(group(cons, "term_differs"))
    ok(mutate(cons, "resolve", {"input_ids": ids, "action": "keep_both"}))
    draft = ok(mutate(cons, "reopen", {"input_ids": ids}))
    assert not decisions_on(draft, target_refs(cons, ids))
    assert all(
        not s.annotation.annotation_id.startswith("cons-") for s in draft.annotations
    )
    assert group(cons, "term_differs")["state"] == "open"


def test_reopen_after_an_edit_in_the_editor(cons):
    """Editing the consolidated annotation in the editor drops its decisions
    (``_update_decision_replacements``); reopen still removes the edited
    annotation."""
    ids = inputs(group(cons, "partial"))
    ok(mutate(cons, "resolve", {"input_ids": ids, "action": "keep"}))
    cid = cons_id(cons, ids, 0)
    workspace = view(cons)["workspace_id"]
    edited = cons.adj.post(
        f"/api/v1/workspaces/{workspace}/commands",
        json={
            "mutation_id": "edit",
            "expected_revision": revision(cons),
            "payload": {
                "command": "set_annotation_note",
                "annotation_id": cid,
                "note": "Edited in the editor",
            },
        },
    )
    assert edited.status_code == 200, edited.text
    draft = ok(mutate(cons, "reopen", {"input_ids": ids}))
    assert cid not in {s.annotation.annotation_id for s in draft.annotations}
    after = group(cons, "partial")
    assert (after["state"], after["annotation_ids"]) == ("open", [])


def test_reopen_of_an_auto_group_reads_open(cons):
    ids = inputs(group(cons, "match"))
    draft = ok(mutate(cons, "reopen", {"input_ids": ids}))
    assert not decisions_on(draft, target_refs(cons, ids))
    assert group(cons, "match")["state"] == "open"


def test_resolve_writes_one_edit_event_per_command(cons):
    from ontocurator.storage.tables import EditEventRow

    def events() -> int:
        with cons.env.db.transaction() as conn:
            return int(
                conn.execute(
                    select(func.count())
                    .select_from(EditEventRow)
                    .join(DraftRow, DraftRow.id == EditEventRow.draft_id)
                    .where(DraftRow.draft_key == _key_str(cons.round.workspace_key))
                ).scalar_one()
            )

    before = events()
    ok(
        mutate(
            cons,
            "resolve",
            {"input_ids": inputs(group(cons, "partial")), "action": "keep"},
        )
    )
    assert events() == before + 1


def test_unscoped_repository_sees_the_resolution(cons):
    ids = inputs(group(cons, "partial"))
    ok(mutate(cons, "resolve", {"input_ids": ids, "action": "keep"}))
    repo = Repository(cons.env.db)
    with cons.env.db.transaction() as conn:
        draft = repo._open_draft(conn, cons.round.workspace_key, None)
    assert cons_id(cons, ids, 0) in {
        s.annotation.annotation_id for s in draft.annotations
    }
