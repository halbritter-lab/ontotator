"""Automatic take-over of matching findings (acceptance fixes spec "WP-E
Backend > Automatic take-over", T9, U14).

Creating a consolidation round (the start command and the old
``POST /assignments/{id}/rounds`` path) decides every ``match`` group in the
consolidator's draft like "Keep" with the mark ``auto``: one ``cons-…``
annotation with merged provenance and a ``changed`` decision per member;
one edit event. Seeding again changes nothing; a round without decisions
(started before this change) reads every group ``open``.
"""

from __future__ import annotations

from typing import Any

import pytest
from auth_harness import logged_in
from sqlalchemy import delete, func, select
from test_consolidation_resolve_api import (
    FIRST,
    SECOND,
    access_of,
    build_round,
    cons_id,
    group,
    inputs,
    revision,
    target_refs,
    view,
)
from test_final_panel_api import SEIZURE, finding, span_of, submit_findings
from work_plan_support import BASE, assign, doc, plan_env

from ontocurator.application.consolidation import consolidated_content_sha256
from ontocurator.application.consolidation_resolve import take_over_matches
from ontocurator.storage.repository import Repository, _key_str
from ontocurator.storage.tables import DraftRow, EditEventRow, ReviewDecisionRow


@pytest.fixture
def cons(tmp_path):
    return build_round(tmp_path)


def draft_of(ns: Any) -> Any:
    repo = Repository(ns.env.db)
    with ns.env.db.transaction() as conn:
        return repo._open_draft(conn, ns.round.workspace_key, None)


def events(ns: Any) -> list[Any]:
    with ns.env.db.transaction() as conn:
        return list(
            conn.execute(
                select(EditEventRow.command, EditEventRow.revision_after)
                .join(DraftRow, DraftRow.id == EditEventRow.draft_id)
                .where(DraftRow.draft_key == _key_str(ns.round.workspace_key))
            )
        )


def test_match_groups_are_kept_automatically(cons):
    match = group(cons, "match")
    assert match["state"] == "auto"
    assert match["edited"] is False
    assert [g["state"] for g in view(cons)["groups"]] == [
        "auto",
        "open",
        "open",
        "open",
    ]
    ids = inputs(match)
    cid = cons_id(cons, ids, 0)
    draft = draft_of(cons)
    refs = target_refs(cons, ids)
    decided = [
        d for d in draft.decisions if (d.target.annotation_id, d.target.version) in refs
    ]
    assert len(decided) == 2
    assert {d.outcome for d in decided} == {"changed"}
    assert {d.replacement.annotation_id for d in decided} == {cid}
    assert {d.consolidation.action for d in decided} == {"auto"}
    assert {d.reviewer_id for d in decided} == {cons.round.annotator_id}
    # The same result as "Keep": the earliest member, merged provenance.
    [kept] = draft.annotations
    inventory = {
        i["input_id"]: i
        for i in cons.env.app.state.repo.get_round_input_inventory(
            "proj", cons.round.round_id
        )
    }
    keep = inventory[match["keep_input_id"]]["target_snapshot"]["annotation"]
    assert kept.annotation.annotation_id == cid
    assert kept.annotation.term_id == keep["term_id"]
    assert kept.annotation.provenance.method == "merged"
    assert kept.annotation.provenance.source_refs == [
        f"round-input:{i}" for i in sorted(ids)
    ]
    assert kept.annotation.provenance.actor.actor_id == cons.round.annotator_id
    assert {d.consolidation.content_sha256 for d in decided} == {
        consolidated_content_sha256(kept.annotation)
    }
    assert match["annotation_ids"] == [cid]
    # Only the match group is decided; one edit event, revision 1.
    assert len(draft.decisions) == 2
    assert revision(cons) == 1
    [event] = events(cons)
    assert event.command["command"] == "consolidation_auto_take_over"
    assert event.revision_after == 1


def test_seeding_twice_changes_nothing(cons):
    before = (revision(cons), [d.model_dump() for d in draft_of(cons).decisions])
    with cons.env.db.transaction() as conn:
        pid = cons.env.pid
        added = take_over_matches(
            conn, Repository(cons.env.db), pid, cons.round.workspace_key
        )
    assert added == 0
    after = (revision(cons), [d.model_dump() for d in draft_of(cons).decisions])
    assert after == before
    assert len(events(cons)) == 1


def test_a_round_without_decisions_reads_every_group_open(cons):
    with cons.env.db.transaction() as conn:
        draft_id = conn.execute(
            select(DraftRow.id).where(
                DraftRow.draft_key == _key_str(cons.round.workspace_key)
            )
        ).scalar_one()
        conn.execute(
            delete(ReviewDecisionRow).where(ReviewDecisionRow.draft_id == draft_id)
        )
    assert {g["state"] for g in view(cons)["groups"]} == {"open"}


def test_the_start_command_takes_over_matches(tmp_path):
    env = plan_env(tmp_path)
    target = doc("c1", "en")
    seizure = span_of(env, target, "Neonatalzeit")
    submit_findings(
        env,
        assign(env, target, "anno", "annotate"),
        FIRST,
        [finding("a1", SEIZURE, seizure)],
    )
    submit_findings(
        env,
        assign(env, target, "anno2", "annotate"),
        SECOND,
        [finding("b1", SEIZURE, seizure)],
    )
    response = env.lead.post(
        f"{BASE}/consolidations",
        json={
            "document_id": target,
            "reviewer": "adj",
            "source_submission_ids": [FIRST, SECOND],
            "reason": None,
            "confirm_language": True,
            "request_id": "start-auto",
            "expected_workflow_revision": None,
        },
    )
    assert response.status_code == 200, response.text
    round_id = response.json()["round"]["round_id"]
    adj = logged_in(env.app, "adj", assignments=[])
    body = adj.get(f"/api/v1/rounds/{round_id}/consolidation").json()
    assert [g["state"] for g in body["groups"]] == ["auto"]


def test_the_assignment_round_path_takes_over_matches(tmp_path):
    env = plan_env(tmp_path)
    target = doc("c1", "en")
    seizure = span_of(env, target, "Neonatalzeit")
    submit_findings(
        env,
        assign(env, target, "anno", "annotate"),
        FIRST,
        [finding("a1", SEIZURE, seizure)],
    )
    submit_findings(
        env,
        assign(env, target, "anno2", "annotate"),
        SECOND,
        [finding("b1", SEIZURE, seizure)],
    )
    review = assign(env, target, "adj", "review")
    response = env.lead.post(
        f"/api/v1/assignments/{review}/rounds",
        json={
            "request_id": "old-path",
            "expected_workflow_revision": 0,
            "kind": "consolidation",
            "source_submission_ids": [FIRST, SECOND],
        },
    )
    assert response.status_code == 200, response.text
    round_id = response.json()["round_id"]
    adj = logged_in(env.app, "adj", assignments=[])
    body = adj.get(f"/api/v1/rounds/{round_id}/consolidation").json()
    assert [g["state"] for g in body["groups"]] == ["auto"]


def test_ordinary_rounds_are_not_seeded(tmp_path):
    env = plan_env(tmp_path)
    access, actor = access_of(env, "anno", "annotator")
    from ontocurator.application.work_rounds import WorkRoundService

    created = WorkRoundService(env.db).create(
        access,
        actor,
        assign(env, doc("c2", "en"), "anno", "annotate"),
        request_id="ordinary",
        expected_workflow_revision=0,
    )
    with env.db.transaction() as conn:
        count = conn.execute(
            select(func.count())
            .select_from(EditEventRow)
            .join(DraftRow, DraftRow.id == EditEventRow.draft_id)
            .where(DraftRow.draft_key == _key_str(created.workspace_key))
        ).scalar_one()
    assert count == 0


# --- modifiers (modifiers plan M2, R5, R6) ----------------------------------- #


def test_only_identical_modifier_sets_are_taken_over(tmp_path):
    """S1 and S17's variant are kept automatically with their modifiers (the
    cohort warning never blocks a match); S6, S19 and S20 are not."""
    from test_consolidation_modifiers_read import (
        FREQUENT,
        SEVERE,
        TEXT,
        found,
        group_of,
        mod_env,
        mod_round,
        modifier,
    )
    from test_consolidation_resolve_api import annotation

    from ontocurator.domain.annotations import Modifier
    from ontocurator.domain.documents import Segment

    env = mod_env(tmp_path)
    start = TEXT.index("schwere")
    longer = Modifier(
        term_id=SEVERE, segments=[Segment(start=start, end=start + len("schwere "))]
    )
    scenarios = {
        "S1": ([modifier(SEVERE, "schwere")], [modifier(SEVERE, "schwere")]),
        "S17": ([modifier(FREQUENT)], [modifier(FREQUENT)]),
        "S6": ([modifier(SEVERE, "schwere")], [modifier(SEVERE)]),
        "S20": ([modifier(SEVERE, "schwere")], [longer]),
    }
    for n, (name, (ana, ben)) in enumerate(scenarios.items(), start=1):
        ns = mod_round(
            env,
            f"c{n}",
            {
                "ana": [found("s", SEIZURE, "Krampfanfälle", *ana)],
                "ben": [found("s", SEIZURE, "Krampfanfälle", *ben)],
            },
        )
        item = group_of(ns, SEIZURE)
        if name in {"S1", "S17"}:
            assert item["state"] == "auto", name
            draft = ns.env.app.state.repo.open_draft(ns.round.workspace_key)
            kept = annotation(draft, item["annotation_ids"][0]).annotation
            assert kept.modifiers == ana, name
        else:
            assert (item["state"], item["kinds"]) == ("open", ["modifiers_differ"]), (
                name
            )
    ns = mod_round(
        env,
        "c5",
        {
            "ana": [found("x", SEVERE, "schwere")],
            "ben": [found("x", SEVERE, "schwere")],
        },
    )
    both = group_of(ns, SEVERE)
    assert (both["state"], both["kinds"]) == ("open", ["modifier_as_finding"])
