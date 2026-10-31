"""An annotator's Unresolved decision reaches whoever decides (#246).

A group with an Unresolved finding is never agreed: it does not match on the
compare card, is not taken over, and cannot be accepted as full agreement. Its
flag and note show on the compare card, in consolidation and on the accept
card. A decided group is a normal finding; a directly accepted submission keeps
the flag and note in the selected export.
"""

from __future__ import annotations

import zipfile
from dataclasses import replace
from pathlib import Path
from typing import Any

import ontospan
import pytest
from sqlalchemy import insert
from t1_fixtures import HP_PATH
from test_consolidation_resolve_api import (
    build_round,
    group,
    inputs,
    mutate,
    ok,
    revision,
    view,
)
from test_consolidation_submit_gating import submit_acknowledged
from test_final_panel_api import (
    SEIZURE,
    accepted_correction,
    by_id,
    final_cell,
    finding,
    panel,
    span_of,
    submit_findings,
)
from test_t1_export import _proposals, _submit
from test_t1_export import db as db
from work_plan_support import BASE, assign, doc, plan_env, select_final

from ontotator.application.consolidation import (
    _Content,
    _state,
    is_open,
    open_group_count,
)
from ontotator.application.final_results import FinalResultService
from ontotator.auth.audit import Actor
from ontotator.authz.policy import Access
from ontotator.domain.agreement import Finding, compare, groups
from ontotator.domain.annotations import AnnotationRef
from ontotator.domain.consolidation_origins import finding_origins
from ontotator.domain.review import ConsolidationMark, ReviewDecision
from ontotator.exchange.jobs import HANDLERS
from ontotator.jobs.queue import JobQueue
from ontotator.storage.database import Database
from ontotator.storage.repository import Repository
from ontotator.storage.tables import (
    ProjectMembershipRow,
    UserRow,
)

NOTE = "Pale or just tired?"


def _finding(key: str, *, unresolved: bool = False, axes: str = "present") -> Finding:
    return Finding(
        key=key,
        layer_id="hpo",
        term_id=SEIZURE,
        axes={"assertion": axes},
        modifiers=frozenset(),
        spans=((0, 5),),
        order=0,
        type_id="phenotype",
        unresolved=unresolved,
    )


def test_an_unresolved_finding_does_not_match() -> None:
    data = {"a": [_finding("x")], "b": [_finding("y", unresolved=True)]}
    agreement = compare(data, ["a", "b"])
    assert (agreement.total, agreement.matching) == (1, 0)
    assert agreement.context_differences == 0
    [group_] = groups(data, ["a", "b"])
    assert group_.kinds == {"unresolved"}


def test_a_context_difference_stays_one_with_an_unresolved_finding() -> None:
    data = {
        "a": [_finding("x", axes="absent")],
        "b": [_finding("y", unresolved=True)],
    }
    assert compare(data, ["a", "b"]).context_differences == 1
    assert groups(data, ["a", "b"])[0].kinds == {"values_differ", "unresolved"}


def test_a_unanimous_modifier_term_with_a_flag_stays_a_modifier_finding() -> None:
    data = {
        "a": [replace(_finding("x"), standalone_modifier=True)],
        "b": [replace(_finding("y", unresolved=True), standalone_modifier=True)],
    }
    assert groups(data, ["a", "b"])[0].kinds == {"unresolved", "modifier_as_finding"}


@pytest.fixture
def env(tmp_path: Path) -> Any:
    return plan_env(tmp_path)


def _pair(env: Any) -> None:
    target = doc("c1", "en")
    span = span_of(env, target, "Neonatalzeit")
    submit_findings(
        env,
        assign(env, target, "anno", "annotate"),
        "s1",
        [finding("a1", SEIZURE, span)],
    )
    submit_findings(
        env,
        assign(env, target, "anno2", "annotate"),
        "s2",
        [finding("b1", SEIZURE, span)],
        unresolved={"b1": NOTE},
    )


def test_identical_pair_with_unresolved_is_no_full_agreement(env):
    _pair(env)
    result = panel(env)
    assert result["label_rule"] == "compare"
    assert result["all_match"] is False and result["all_match_submission_id"] is None
    agreement = result["agreement"]
    assert (agreement["total"], agreement["matching"]) == (1, 0)
    assert result["unresolved"] == [
        {"submission_id": "s2", "layer_id": "hpo", "term_id": SEIZURE, "note": NOTE}
    ]
    detail = final_cell(env)["detail"]
    assert detail["all_match"] is False and detail["matching"] == 0


def test_the_route_names_the_unresolved_term(env):
    _pair(env)
    response = env.lead.get(f"{BASE}/document-rows/c1/en/final-panel")
    assert response.status_code == 200, response.text
    [item] = response.json()["unresolved"]
    assert item["term_label"] and item["note"] == NOTE


def test_one_annotator_accept_card_lists_the_flag(env):
    target = doc("c1", "en")
    submit_findings(
        env,
        assign(env, target, "anno", "annotate"),
        "s1",
        [finding("a1", SEIZURE, span_of(env, target, "Neonatalzeit"))],
        unresolved={"a1": NOTE},
    )
    result = panel(env)
    assert result["label_rule"] == "accept" and result["accept_submission_id"] == "s1"
    assert [item["note"] for item in result["unresolved"]] == [NOTE]


def test_flags_on_listed_submissions_outside_the_comparison_show(env):
    target = doc("c1", "en")
    span = span_of(env, target, "Neonatalzeit")
    submit_findings(
        env,
        assign(env, target, "anno", "annotate"),
        "s1",
        [finding("a1", SEIZURE, span)],
        unresolved={"a1": NOTE},
    )
    accepted_correction(env, target, "c1-en-v2")
    submit_findings(env, assign(env, "c1-en-v2", "anno2", "annotate"), "s2", [])
    result = panel(env)
    assert by_id(result)["s1"]["comparable"] is False
    assert [item["note"] for item in result["unresolved"]] == [NOTE]


@pytest.fixture
def flagged(tmp_path: Path) -> Any:
    """A consolidation of two submissions whose ``a1`` and ``b1`` match, with
    ``b1`` left Unresolved."""
    return build_round(tmp_path, unresolved={"b1": NOTE})


def test_consolidation_keeps_the_group_open_with_flag_and_note(flagged):
    item = group(flagged, "unresolved")
    assert item["state"] == "open" and item["annotation_ids"] == []
    assert [(m["unresolved"], m["unresolved_note"]) for m in item["members"]] == [
        (False, None),
        (True, NOTE),
    ]
    # Reopen all takes over matches only, as at the round's start.
    ok(mutate(flagged, "reopen-all", {"command": "consolidation_reopen_all"}))
    assert group(flagged, "unresolved")["state"] == "open"


def test_keep_settles_the_group_with_the_flag_still_readable(flagged):
    ok(
        mutate(
            flagged,
            "resolve",
            {"input_ids": inputs(group(flagged, "unresolved")), "action": "keep"},
        )
    )
    item = group(flagged, "unresolved")
    assert item["state"] == "keep"
    assert item["members"][1]["unresolved_note"] == NOTE


def test_an_older_automatic_take_over_reads_open_while_live():
    ref = AnnotationRef(annotation_id="t", version="v")
    taken = ReviewDecision(
        decision_id="d",
        target=ref,
        outcome="confirmed",
        reviewer_id="r",
        consolidation=ConsolidationMark(action="auto"),
    )
    targets = {("t", "v"): None}
    assert not is_open(targets, [taken])
    assert is_open(targets, [taken], unresolved=True)
    content = _Content(annotations=[], decisions=[taken], submitted=True)
    assert _state(targets, content)["state"] == "auto"  # a submitted round stays
    assert _state(targets, content, unresolved=True)["state"] == "open"


def test_an_older_take_over_edited_in_the_editor_stays_decided_and_edited(flagged):
    item = group(flagged, "unresolved")
    ok(mutate(flagged, "resolve", {"input_ids": inputs(item), "action": "keep"}))
    draft = flagged.env.app.state.repo.open_draft(flagged.round.workspace_key)
    [result] = draft.annotations
    marked = ConsolidationMark(action="auto", content_sha256="other")
    decisions = [
        d.model_copy(update={"consolidation": marked}) for d in draft.decisions
    ]
    targets = {
        (d.target.annotation_id, d.target.version): result.annotation for d in decisions
    }
    content = _Content(annotations=[result], decisions=decisions)
    state = _state(targets, content, unresolved=True)
    assert (state["state"], state["edited"]) == ("auto", True)


def _lead(db: Database) -> tuple[Access, Actor]:
    with db.transaction() as conn:
        uid = conn.execute(
            UserRow.__table__.insert()
            .values(username="lead", display_name="lead", pseudonym="lead")
            .returning(UserRow.id)
        ).scalar_one()
        conn.execute(
            insert(ProjectMembershipRow).values(
                project_id=Repository(db)._require_project(conn, "proj"),
                user_id=uid,
                role="lead",
            )
        )
    return (
        Access(uid, "lead", False, {"proj": frozenset({"lead"})}),
        Actor.user(uid, "lead"),
    )


def _final_export(
    db: Database, access: Access, actor: Actor, project: str, tmp_path: Path
) -> Path:
    service = FinalResultService(db, actor, access)
    state = service.preflight(project)
    queued = service.freeze(
        project,
        {
            "request_id": "final",
            "state_digest": state["state_digest"],
            "acknowledged_warnings": [
                {"id": w["id"], "cause_revision": w["cause_revision"]}
                for w in state["warnings"]
            ],
            "accepted_omissions": state["omissions"],
        },
    )
    queue = JobQueue(db, HANDLERS)
    job = queue.run(queue.claim(queued["job_id"], "test"), "test")
    assert job.status == "succeeded", job.error
    bundle = tmp_path / "selected.t1.zip"
    with zipfile.ZipFile(db.blobs.path(job.result["sha256"])) as artifact:
        bundle.write_bytes(artifact.read("selected.t1.zip"))
    return bundle


@pytest.mark.parametrize("pair", [True, False], ids=["identical-pair", "one-annotator"])
def test_direct_acceptance_keeps_flag_and_note(db, tmp_path, pair):
    target = _proposals(db)[1]
    ref = AnnotationRef(
        annotation_id=target.annotation.annotation_id, version=target.version
    )

    def decide(who: str, outcome: str, note: str | None) -> ReviewDecision:
        return ReviewDecision(
            decision_id=f"d-{who}",
            target=ref,
            outcome=outcome,
            reviewer_id=who,
            note=note,
        )

    for who, outcome, note in [
        ("ann-0001", "uncertain", NOTE),
        *([("ann-0002", "confirmed", None)] if pair else []),
    ]:
        _submit(
            db,
            who,
            "review",
            [target],
            submission_id=f"s-{who}",
            decisions=[decide(who, outcome, note)],
            targets=[ref],
        )
    access, actor = _lead(db)
    FinalResultService(db, actor, access).select(
        "proj", target.annotation.document_id, "s-ann-0001", 0, []
    )
    bundle = _final_export(db, access, actor, "proj", tmp_path)
    _, [unit] = ontospan.read_bundle(
        bundle, {"hp": ontospan.ObographOntology.load(HP_PATH)}
    )
    [item] = unit.annotation_set.annotations
    assert item.review_resolution.outcome == "uncertain"
    assert item.review_resolution.note == NOTE


def test_a_settled_group_is_a_normal_decided_finding(flagged):
    item = group(flagged, "unresolved")
    ok(mutate(flagged, "resolve", {"input_ids": inputs(item), "action": "keep"}))
    for other in view(flagged)["groups"]:
        if other["state"] == "open":
            ok(
                mutate(
                    flagged,
                    "resolve",
                    {"input_ids": inputs(other), "action": "leave_out"},
                )
            )
    env = flagged.env
    response = submit_acknowledged(
        flagged.adj, view(flagged)["workspace_id"], revision(flagged)
    )
    assert response.status_code == 200, response.text
    sid = response.json()["submission_id"]
    select_final(env, doc("c1", "en"), sid)
    # A consolidation's inputs keep the flag on the lead's accept card.
    assert [entry["note"] for entry in panel(env)["unresolved"]] == [NOTE]
    stored = env.app.state.repo.get_submission(sid, "proj")
    assert not any(d.outcome == "uncertain" for d in stored.decisions)
    [origin] = finding_origins(stored.snapshots, stored.decisions)
    assert origin.origin == "decided"


def test_a_live_automatic_take_over_from_before_blocks_submit(flagged):
    """A round started before #246: the source flag counts as open again."""
    item = group(flagged, "unresolved")
    ok(mutate(flagged, "resolve", {"input_ids": inputs(item), "action": "keep"}))
    env = flagged.env
    draft = env.app.state.repo.open_draft(flagged.round.workspace_key)

    def as_auto(digest: str | None) -> list[ReviewDecision]:
        return [
            d.model_copy(
                update={
                    "consolidation": ConsolidationMark(
                        action="auto",
                        content_sha256=digest or d.consolidation.content_sha256,
                    )
                }
            )
            for d in draft.decisions
        ]

    round_id = flagged.round.round_id
    with env.db.transaction() as conn:
        # The three groups with differences, and the flagged one.
        assert open_group_count(conn, env.pid, round_id, as_auto(None)) == 4
        # A result changed since the mark: the consolidator's edit stands.
        assert open_group_count(conn, env.pid, round_id, as_auto("other")) == 3
