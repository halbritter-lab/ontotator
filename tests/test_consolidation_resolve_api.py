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

from ontotator.application.consolidation import consolidated_content_sha256
from ontotator.application.work_rounds import WorkRoundService
from ontotator.auth.audit import Actor
from ontotator.authz.policy import Access
from ontotator.domain.annotations import AnnotationSnapshot
from ontotator.domain.workspace import Draft
from ontotator.storage.repository import Repository, _key_str
from ontotator.storage.tables import DraftRow, EditEventRow

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


def payload(item: dict[str, Any], action: str) -> dict[str, Any]:
    """A resolve payload; ``choose`` takes the first member's term, span and
    values for every differing axis."""
    body: dict[str, Any] = {"input_ids": inputs(item), "action": action}
    if action == "choose":
        first = item["members"][0]
        body["choice"] = {
            "term_id": first["term_id"],
            "span_from_input_id": first["input_id"],
            "axes": {
                axis: first["axes"].get(axis, "present")
                for axis in item["differing_axes"]
            },
        }
    return body


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
    # R-2: the read names what was kept, without the session that decided it.
    assert after["result"]["term_id"] == HYPOTONIA
    assert after["result"]["term_label"] != HYPOTONIA
    assert after["result"]["axes"]["assertion"] == "absent"
    assert after["result"]["axes"]["temporality"] == "historical"


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
    ok(mutate(cons, "resolve", payload(group(cons, "term_differs"), "choose")))
    draft = ok(mutate(cons, "reopen", {"input_ids": ids}))
    assert not decisions_on(draft, target_refs(cons, ids))
    assert cons_id(cons, ids, 0) not in {
        s.annotation.annotation_id for s in draft.annotations
    }
    assert group(cons, "term_differs")["state"] == "open"


def edit_note(ns: Any, annotation_id: str, note: str) -> None:
    """Change a note in the editor (``POST /workspaces/{id}/commands``)."""
    workspace = view(ns)["workspace_id"]
    edited = ns.adj.post(
        f"/api/v1/workspaces/{workspace}/commands",
        json={
            "mutation_id": f"edit-{revision(ns)}",
            "expected_revision": revision(ns),
            "payload": {
                "command": "set_annotation_note",
                "annotation_id": annotation_id,
                "note": note,
            },
        },
    )
    assert edited.status_code == 200, edited.text


def test_an_edit_in_the_editor_reads_edited(cons):
    """The marked decisions follow the edited ``cons-…`` annotation
    (``_update_decision_replacements``): the group stays resolved."""
    ids = inputs(group(cons, "partial"))
    ok(mutate(cons, "resolve", {"input_ids": ids, "action": "keep"}))
    cid = cons_id(cons, ids, 0)
    edit_note(cons, cid, "Edited in the editor")
    after = group(cons, "partial")
    assert (after["state"], after["edited"], after["annotation_ids"]) == (
        "keep",
        True,
        [cid],
    )
    draft = ok(mutate(cons, "reopen", {"input_ids": ids}))
    assert cid not in {s.annotation.annotation_id for s in draft.annotations}
    assert not decisions_on(draft, target_refs(cons, ids))
    after = group(cons, "partial")
    assert (after["state"], after["annotation_ids"]) == ("open", [])


def test_an_edited_choice_submits_without_reopening(cons):
    from test_consolidation_submit_gating import submit_acknowledged

    values = group(cons, "values_differ")
    ids = inputs(values)
    first = values["members"][0]
    ok(
        mutate(
            cons,
            "resolve",
            {
                "input_ids": ids,
                "action": "choose",
                "choice": {
                    "term_id": first["term_id"],
                    "span_from_input_id": first["input_id"],
                    "axes": dict(first["axes"]),
                },
            },
        )
    )
    edit_note(cons, cons_id(cons, ids, 0), "Edited in the editor")
    assert (
        group(cons, "values_differ")["state"],
        group(cons, "values_differ")["edited"],
    ) == (
        "choose",
        True,
    )
    for kind, action in (("term_differs", "choose"), ("partial", "leave_out")):
        ok(mutate(cons, "resolve", payload(group(cons, kind), action)))
    response = submit_acknowledged(cons.adj, view(cons)["workspace_id"], revision(cons))
    assert response.status_code == 200, response.text
    notes = {
        s["annotation"]["annotation_id"]: s["annotation"].get("note")
        for s in response.json()["snapshots"]
    }
    assert notes[cons_id(cons, ids, 0)] == "Edited in the editor"


def test_deleting_the_result_in_the_editor_reads_open(cons):
    ids = inputs(group(cons, "partial"))
    ok(mutate(cons, "resolve", {"input_ids": ids, "action": "keep"}))
    workspace = view(cons)["workspace_id"]
    deleted = cons.adj.post(
        f"/api/v1/workspaces/{workspace}/commands",
        json={
            "mutation_id": "delete",
            "expected_revision": revision(cons),
            "payload": {
                "command": "delete_draft_annotation",
                "annotation_id": cons_id(cons, ids, 0),
            },
        },
    )
    assert deleted.status_code == 200, deleted.text
    after = group(cons, "partial")
    assert (after["state"], after["annotation_ids"]) == ("open", [])


def test_editing_an_automatic_result_reads_edited(cons):
    match = group(cons, "match")
    [cid] = match["annotation_ids"]
    assert cid == cons_id(cons, inputs(match), 0)
    edit_note(cons, cid, "Checked the age")
    after = group(cons, "match")
    assert (after["state"], after["edited"]) == ("auto", True)


def test_reopen_of_an_auto_group_reads_open(cons):
    ids = inputs(group(cons, "match"))
    draft = ok(mutate(cons, "reopen", {"input_ids": ids}))
    assert not decisions_on(draft, target_refs(cons, ids))
    assert group(cons, "match")["state"] == "open"


def test_resolve_writes_one_edit_event_per_command(cons):
    from ontotator.storage.tables import EditEventRow

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


def resolve_all(ns: Any) -> None:
    for kind, action in (
        ("term_differs", "choose"),
        ("values_differ", "leave_out"),
        ("partial", "keep"),
    ):
        ok(mutate(ns, "resolve", payload(group(ns, kind), action)))


def test_group_commands_after_submit_are_refused(cons):
    from test_consolidation_submit_gating import submit_acknowledged

    resolve_all(cons)
    workspace = view(cons)["workspace_id"]
    submitted = submit_acknowledged(cons.adj, workspace, revision(cons))
    assert submitted.status_code == 200, submitted.text
    ids = inputs(group(cons, "partial"))
    before = revision(cons)
    for action, payload in (
        ("resolve", {"input_ids": ids, "action": "leave_out"}),
        ("annotate", {"input_ids": ids, "guidelines_unclear": True}),
        ("reopen", {"input_ids": ids}),
    ):
        response = cons.adj.post(
            f"/api/v1/workspaces/{workspace}/consolidation-groups/{action}",
            json={
                "mutation_id": f"late-{action}",
                "expected_revision": before,
                "payload": payload,
            },
        )
        assert response.status_code == 409, response.text
        # The submitted assignment refuses before the round's own check.
        assert response.json()["code"] == "ASSIGNMENT_SUBMITTED"
    assert revision(cons) == before


def test_a_lead_who_is_not_the_assignee_is_refused(cons):
    before = revision(cons)
    response = mutate(
        cons,
        "resolve",
        {"input_ids": inputs(group(cons, "partial")), "action": "keep"},
        client=cons.env.lead,
    )
    assert response.status_code in {403, 404}, response.text
    assert response.json()["code"] == "IDENTITY_MISMATCH"
    assert revision(cons) == before


def decide(ns: Any, target: tuple[str, str], outcome: str | None) -> Draft:
    """Decide a member target in the editor (``POST /workspaces/{id}/decisions``)."""
    workspace = view(ns)["workspace_id"]
    ns.count += 1
    return ok(
        ns.adj.post(
            f"/api/v1/workspaces/{workspace}/decisions",
            json={
                "mutation_id": f"decide-{ns.count}",
                "expected_revision": revision(ns),
                "payload": {
                    "target": {"annotation_id": target[0], "version": target[1]},
                    "outcome": outcome,
                },
            },
        )
    )


def test_an_editor_decision_on_an_auto_group_replaces_its_result(cons):
    """No duplicate: the editor decision drops the ``cons-…`` annotation and
    the group's other marked decisions, as reopen does."""
    ids = inputs(group(cons, "match"))
    cid = cons_id(cons, ids, 0)
    first, second = sorted(target_refs(cons, ids))
    draft = decide(cons, first, "confirmed")
    assert cid not in {s.annotation.annotation_id for s in draft.annotations}
    assert [d.consolidation for d in decisions_on(draft, {first, second})] == [None]
    assert group(cons, "match")["state"] == "open"
    draft = decide(cons, second, "confirmed")
    assert cid not in {s.annotation.annotation_id for s in draft.annotations}
    after = group(cons, "match")
    assert (after["state"], after["annotation_ids"]) == (
        "keep",
        sorted({first[0], second[0]}),
    )


def test_clearing_a_decision_of_a_resolved_group_reopens_it(cons):
    ids = inputs(group(cons, "term_differs"))
    ok(mutate(cons, "resolve", payload(group(cons, "term_differs"), "choose")))
    refs = target_refs(cons, ids)
    draft = decide(cons, sorted(refs)[0], None)
    assert not decisions_on(draft, refs)
    assert cons_id(cons, ids, 0) not in {
        s.annotation.annotation_id for s in draft.annotations
    }
    assert group(cons, "term_differs")["state"] == "open"


def add_finding(ns: Any, term: str, words: str) -> str:
    """Add a finding nobody marked (the view's "Add finding",
    ``POST /workspaces/{id}/commands``); returns its annotation id."""
    workspace = view(ns)["workspace_id"]
    annotation_id = f"ann-added-{revision(ns)}"
    span = span_of(ns.env, doc("c1", "en"), words)
    created = ns.adj.post(
        f"/api/v1/workspaces/{workspace}/commands",
        json={
            "mutation_id": f"add-{revision(ns)}",
            "expected_revision": revision(ns),
            "payload": {
                "command": "create_annotation",
                "annotation_id": annotation_id,
                "evidence_id": f"ev-added-{revision(ns)}",
                "term_id": term,
                "layer_id": "hpo",
                "type_id": "phenotype",
                "segments": [dict(zip(("start", "end"), span, strict=True))],
                "axes_values": {},
                "chosen_axis_ids": [],
            },
        },
    )
    assert created.status_code == 200, created.text
    return annotation_id


def test_added_findings_are_listed_for_the_assignee_and_the_lead(cons):
    """Findings the consolidator added outside every group are in ``added``
    (live and after submission), with the consolidator as ``added_by``; the
    groups' ``cons-…`` results and kept targets are not."""
    first = view(cons)
    assert first["added"] == [] and first["added_by"] is None
    added_id = add_finding(cons, OTHER_TERM, "Seit 2")
    resolve_all(cons)
    adj = cons.env.app.state.accounts.get_by_username("adj").pseudonym
    live = view(cons)
    assert [a["annotation_id"] for a in live["added"]] == [added_id]
    item = live["added"][0]
    assert item["person_id"] == adj
    assert item["term_id"] == OTHER_TERM
    assert item["term_label"] and item["term_label"] != OTHER_TERM
    assert item["spans"] == [list(span_of(cons.env, doc("c1", "en"), "Seit 2"))]
    assert live["added_by"] == f"Ada Judicator ({adj})"

    from test_consolidation_submit_gating import submit_acknowledged

    submitted = submit_acknowledged(cons.adj, live["workspace_id"], revision(cons))
    assert submitted.status_code == 200, submitted.text
    read = cons.env.lead.get(f"/api/v1/rounds/{cons.round.round_id}/consolidation")
    assert read.status_code == 200, read.text
    body = read.json()
    assert body["read_only"] is True
    assert [a["annotation_id"] for a in body["added"]] == [added_id]
    assert body["added_by"] == f"Ada Judicator ({adj})"
    # The read-only banner names the consolidator ("Submitted by …").
    assert body["consolidator"] == f"Ada Judicator ({adj})"


def test_choose_with_a_null_axis_writes_it_as_not_set(cons):
    """A person who left a differing axis empty can be taken: null = not set."""
    values = group(cons, "values_differ")
    ids = inputs(values)
    first = values["members"][0]
    draft = ok(
        mutate(
            cons,
            "resolve",
            {
                "input_ids": ids,
                "action": "choose",
                "choice": {
                    "term_id": HYPOTONIA,
                    "span_from_input_id": first["input_id"],
                    "axes": {
                        "assertion": first["axes"]["assertion"],
                        "temporality": None,
                    },
                },
            },
        )
    )
    chosen = annotation(draft, cons_id(cons, ids, 0))
    assert chosen.annotation.axes_values.get("temporality") is None
    assert "temporality" not in chosen.annotation.axes_defaulted
    assert group(cons, "values_differ")["state"] == "choose"


def test_reopen_all_restarts_the_groups_and_undo_restores_them(cons):
    """R-10: one mutation reopens every group, matches are taken over again;
    the undo directly after it restores the exact previous decisions."""
    resolve_all(cons)
    ok(
        mutate(
            cons,
            "resolve",
            {"input_ids": inputs(group(cons, "match")), "action": "leave_out"},
        )
    )
    before = view(cons)
    decided = ok(
        mutate(
            cons,
            "annotate",
            {
                "input_ids": inputs(group(cons, "partial")),
                "note": "n",
                "guidelines_unclear": True,
            },
        )
    )
    assert {g["state"] for g in view(cons)["groups"]} != {"open", "auto"}
    reopened = ok(mutate(cons, "reopen-all", {"command": "consolidation_reopen_all"}))
    assert reopened.revision == decided.revision + 1
    assert [g["state"] for g in view(cons)["groups"]] == [
        "auto",
        "open",
        "open",
        "open",
    ]
    restored = ok(
        mutate(cons, "undo-reopen-all", {"command": "consolidation_undo_reopen_all"})
    )
    assert [d.model_dump() for d in restored.decisions] == [
        d.model_dump() for d in decided.decisions
    ]
    assert restored.annotations == decided.annotations
    assert restored.checked_layer_ids == decided.checked_layer_ids
    after = view(cons)
    assert [(g["state"], g["note"]) for g in after["groups"]] == [
        (g["state"], "n" if "partial" in g["kinds"] else g["note"])
        for g in before["groups"]
    ]
    # Only directly after Reopen all: a second undo has nothing to restore.
    again = mutate(
        cons, "undo-reopen-all", {"command": "consolidation_undo_reopen_all"}
    )
    assert again.status_code == 409, again.text
    with cons.env.db.transaction() as conn:
        commands = [
            row.command.get("command")
            for row in conn.execute(
                select(EditEventRow.command)
                .join(DraftRow, DraftRow.id == EditEventRow.draft_id)
                .where(DraftRow.draft_key == _key_str(cons.round.workspace_key))
                .order_by(EditEventRow.id)
            )
        ][-2:]
    assert commands == ["consolidation_reopen_all", "consolidation_undo_reopen_all"]


def test_reopen_all_refuses_another_payload(cons):
    response = mutate(cons, "reopen-all", {"input_ids": inputs(group(cons, "match"))})
    assert response.status_code == 422, response.text
