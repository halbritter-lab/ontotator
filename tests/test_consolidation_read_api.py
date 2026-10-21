"""Consolidation read ``GET /rounds/{round_id}/consolidation`` (acceptance
fixes spec "WP-E Backend > Read", U8, U9).

The assignee reads the live state with the input authors' display names; a
lead who is not the assignee is refused with ``ROUND_NOT_FOUND`` until the
round is submitted and then reads it read-only; everyone else gets
``ROUND_NOT_FOUND``.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from auth_harness import logged_in
from sqlalchemy import insert, select
from test_document_rows_submissions import _submit_consolidation
from test_final_panel_api import (
    HYPOTONIA,
    SEIZURE,
    _text,
    finding,
    span_of,
    submit_findings,
)
from work_plan_support import assign, doc, plan_env

from ontocurator.application.consolidation import (
    _Content,
    _state,
    consolidated_content_sha256,
    consolidation_group_id,
    consolidation_groups,
)
from ontocurator.application.document_row_panel import project_profile
from ontocurator.application.work_rounds import WorkRoundService
from ontocurator.auth.audit import Actor
from ontocurator.authz.policy import Access
from ontocurator.authz.scoped import ScopedRepository
from ontocurator.domain.annotations import AnnotationRef
from ontocurator.domain.review import ConsolidationMark, ReviewDecision
from ontocurator.storage.repository import _key_str
from ontocurator.storage.tables import DraftRow, ReviewDecisionRow

FIRST = "sub-first-7c1"
SECOND = "sub-second-9d2"
OTHER_TERM = "HP:0001284"  # known to the test ontology (submit validates)


def _access(env: Any, username: str, *roles: str) -> tuple[Access, Actor]:
    user = env.app.state.accounts.get_by_username(username)
    access = Access(user.id, user.pseudonym, False, {"proj": frozenset(roles)})
    return access, Actor.user(user.id, username)


@pytest.fixture
def cons(tmp_path):
    """Two submissions (match, values differ, partial) and a consolidation
    round assigned to the adjudicator ``adj``."""
    env = plan_env(tmp_path)
    target = doc("c1", "en")
    seizure = span_of(env, target, "Neonatalzeit")
    heavy = span_of(env, target, "schwere")
    last = _text(env, target).rindex("Krampfanf")
    late = (last, last + len("Krampfanf"))
    submit_findings(
        env,
        assign(env, target, "anno", "annotate"),
        FIRST,
        [
            finding("a1", SEIZURE, seizure, temporality="current"),
            finding("a2", HYPOTONIA, heavy, assertion="present", temporality="current"),
        ],
    )
    submit_findings(
        env,
        assign(env, target, "anno2", "annotate"),
        SECOND,
        [
            finding("b1", SEIZURE, seizure, temporality="current"),
            finding("b2", HYPOTONIA, heavy, assertion="absent", temporality="current"),
            finding("b3", OTHER_TERM, late, temporality="current"),
        ],
    )
    review = assign(env, target, "adj", "review")
    lead_access, lead_actor = _access(env, "leader", "lead")
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
    return SimpleNamespace(env=env, round=created, adj=adj, review=review)


def url(round_id: str) -> str:
    return f"/api/v1/rounds/{round_id}/consolidation"


def pseudonym(env: Any, username: str) -> str:
    return str(env.app.state.accounts.get_by_username(username).pseudonym)


def assert_hidden(response: Any) -> None:
    assert response.status_code == 404, response.text
    assert response.json()["code"] == "ROUND_NOT_FOUND"


def test_assignee_reads_open_groups_with_names(cons):
    env = cons.env
    response = cons.adj.get(url(cons.round.round_id))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["read_only"] is False
    assert body["read_only_reason"] is None
    assert body["workspace_id"]
    assert (body["case_id"], body["language"], body["document_version"]) == (
        "c1",
        "en",
        1,
    )
    assert "Neonatalzeit" in body["text"]
    anno, anno2 = pseudonym(env, "anno"), pseudonym(env, "anno2")
    assert body["people"] == [
        {"person_id": anno, "label": f"Anne Notator ({anno})", "lane": 1},
        {"person_id": anno2, "label": f"Arne Notator ({anno2})", "lane": 2},
    ]
    groups = body["groups"]
    assert [g["kinds"] for g in groups] == [
        ["match"],
        ["values_differ"],
        ["partial"],
    ]
    assert all(g["state"] == "open" for g in groups)
    values = groups[1]
    assert values["differing_axes"] == ["assertion"]
    assert [m["person_id"] for m in values["members"]] == [anno, anno2]
    assert [m["axes"]["assertion"] for m in values["members"]] == [
        "present",
        "absent",
    ]
    assert values["keep_input_id"] == values["members"][0]["input_id"]
    assert values["group_id"] == consolidation_group_id(
        [m["input_id"] for m in values["members"]]
    )
    assert groups[2]["start"] == _text(env, doc("c1", "en")).rindex("Krampfanf")
    assert groups[2]["members"][0]["person_id"] == anno2
    member = groups[0]["members"][0]
    assert member["term_id"] == SEIZURE
    assert member["term_label"]
    assert member["spans"] == [list(span_of(env, doc("c1", "en"), "Neonatalzeit"))]


def test_lead_is_refused_before_submit_and_reads_after(cons):
    env = cons.env
    assert_hidden(env.lead.get(url(cons.round.round_id)))
    adj_access, adj_actor = _access(env, "adj", "adjudicator")
    reviewer = ScopedRepository(env.db, adj_access, adj_actor)
    _submit_consolidation(env.app.state.ontology_registry, reviewer, cons.round)
    response = env.lead.get(url(cons.round.round_id))
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["read_only"], body["read_only_reason"]) == (True, "submitted")
    assert body["workspace_id"] is None
    # Decided in the editor (confirmed, no mark): kept.
    assert {g["state"] for g in body["groups"]} == {"keep"}
    assert all(g["annotation_ids"] for g in body["groups"])
    anno = pseudonym(env, "anno")
    assert body["people"][0]["label"] == f"Anne Notator ({anno})"
    own = cons.adj.get(url(cons.round.round_id))
    assert own.status_code == 200, own.text
    assert own.json()["read_only_reason"] == "submitted"


def test_other_members_and_unknown_rounds_get_round_not_found(cons):
    env = cons.env
    annotator = logged_in(env.app, "anno", assignments=[])
    assert_hidden(annotator.get(url(cons.round.round_id)))
    other = logged_in(
        env.app, "rev2", projects={"proj": ["adjudicator"]}, assignments=[]
    )
    assert_hidden(other.get(url(cons.round.round_id)))
    assert_hidden(cons.adj.get(url("round-unknown")))


def test_non_consolidation_round_is_round_not_found(cons):
    env = cons.env
    access, actor = _access(env, "anno", "annotator")
    ordinary = WorkRoundService(env.db).create(
        access,
        actor,
        assign(env, doc("c2", "en"), "anno", "annotate"),
        request_id="ordinary",
        expected_workflow_revision=0,
    )
    annotator = logged_in(env.app, "anno", assignments=[])
    assert_hidden(annotator.get(url(ordinary.round_id)))
    assert_hidden(env.lead.get(url(ordinary.round_id)))


def _targets(env: Any, round_id: str) -> dict[str, AnnotationRef]:
    inventory = env.app.state.repo.get_round_input_inventory("proj", round_id)
    return {
        item["input_id"]: AnnotationRef(
            annotation_id=item["target_snapshot"]["annotation"]["annotation_id"],
            version=item["target_snapshot"]["version"],
        )
        for item in inventory
    }


def _insert_decisions(env: Any, key: Any, decisions: list[ReviewDecision]) -> None:
    with env.db.transaction() as conn:
        draft_id = conn.execute(
            select(DraftRow.id).where(
                DraftRow.project_id == env.pid, DraftRow.draft_key == _key_str(key)
            )
        ).scalar_one()
        for position, decision in enumerate(decisions):
            conn.execute(
                insert(ReviewDecisionRow).values(
                    draft_id=draft_id,
                    decision_id=decision.decision_id,
                    position=position,
                    target_id=decision.target.annotation_id,
                    target_version=decision.target.version,
                    outcome=decision.outcome,
                    replacement_id=None,
                    replacement_version=None,
                    note=decision.note,
                    reviewer_id=decision.reviewer_id,
                    payload=decision.model_dump(mode="json"),
                )
            )


def test_group_state_from_marked_decisions(cons):
    env = cons.env
    body = cons.adj.get(url(cons.round.round_id)).json()
    match, values, _partial = body["groups"]
    targets = _targets(env, cons.round.round_id)
    adj = pseudonym(env, "adj")
    decisions = [
        ReviewDecision(
            decision_id=f"dec-auto-{index}",
            target=targets[member["input_id"]],
            outcome="confirmed",
            reviewer_id=adj,
            consolidation=ConsolidationMark(action="auto"),
        )
        for index, member in enumerate(match["members"])
    ] + [
        # Only one of the two members decided: the group stays open.
        ReviewDecision(
            decision_id="dec-values-0",
            target=targets[values["members"][0]["input_id"]],
            outcome="rejected",
            note="Ask the lead",
            reviewer_id=adj,
            consolidation=ConsolidationMark(action="choose", guidelines_unclear=True),
        )
    ]
    opened = cons.adj.post(f"/api/v1/rounds/{cons.round.round_id}/open")
    assert opened.status_code == 200, opened.text
    _insert_decisions(env, cons.round.workspace_key, decisions)
    groups = cons.adj.get(url(cons.round.round_id)).json()["groups"]
    assert [g["state"] for g in groups] == ["auto", "open", "open"]
    assert groups[0]["annotation_ids"] == sorted(
        targets[m["input_id"]].annotation_id for m in match["members"]
    )
    assert groups[0]["edited"] is False
    assert groups[1]["guidelines_unclear"] is False  # open groups carry no flag


def test_view_names_no_internal_ids(cons):
    env = cons.env
    response = cons.adj.get(url(cons.round.round_id))
    text = response.text
    assert FIRST not in text and SECOND not in text
    assert cons.round.input_manifest_sha256 not in text
    allowed = {
        "round_id",
        "workspace_id",
        "input_id",
        "annotation_id",
        "keep_input_id",
        "group_id",
        "person_id",
        "term_id",
        "layer_id",
        "type_id",
        "document_id",
        "case_id",
    }

    def keys(value: Any) -> set[str]:
        if isinstance(value, dict):
            return set(value) | {k for v in value.values() for k in keys(v)}
        if isinstance(value, list):
            return {k for v in value for k in keys(v)}
        return set()

    assert {k for k in keys(response.json()) if k.endswith("_id")} <= allowed
    for person in response.json()["people"]:
        assert person["person_id"] != str(
            env.app.state.accounts.get_by_username("anno").id
        )


def test_consolidation_groups_on_the_callers_connection(cons):
    env = cons.env
    with env.db.transaction() as conn:
        profile, defaults = project_profile(conn, env.pid)
        result = consolidation_groups(
            conn, env.pid, cons.round.round_id, profile, defaults
        )
    assert [sorted(group.kinds) for group, _ in result] == [
        ["match"],
        ["values_differ"],
        ["partial"],
    ]
    for group, inputs in result:
        assert inputs == dict(group.members)
        assert set(inputs) <= {FIRST, SECOND}


def test_edited_when_the_consolidated_annotation_changed(cons):
    env = cons.env
    repo = env.app.state.repo
    [snap, *_] = [
        s
        for s in (
            repo.get_submission(FIRST, "proj").snapshots
            + repo.get_submission(SECOND, "proj").snapshots
        )
    ]
    ref = AnnotationRef(annotation_id="t", version="v")
    replacement = AnnotationRef(
        annotation_id=snap.annotation.annotation_id, version=snap.version
    )

    def decision(sha: str) -> ReviewDecision:
        return ReviewDecision(
            decision_id="d",
            target=ref,
            outcome="changed",
            replacement=replacement,
            reviewer_id="r",
            consolidation=ConsolidationMark(action="keep", content_sha256=sha),
        )

    same = consolidated_content_sha256(snap.annotation)
    targets = {("t", "v"): snap.annotation}
    kept = _state(targets, _Content([snap], [decision(same)]))
    assert (kept["state"], kept["edited"]) == ("keep", False)
    assert kept["annotation_ids"] == [snap.annotation.annotation_id]
    changed = _state(targets, _Content([snap], [decision("other")]))
    assert changed["edited"] is True
    # The consolidated annotation was deleted in the editor.
    deleted = _state(targets, _Content([], [decision(same)]))
    assert deleted["edited"] is True


def _snapshot(cons: Any) -> Any:
    return cons.env.app.state.repo.get_submission(FIRST, "proj").snapshots[0]


def test_confirmed_target_with_hash_is_not_edited(cons):
    """A target kept as is carries the hash of the target itself; rejected
    siblings carry no resulting annotation and never mark the group edited."""
    snap = _snapshot(cons)
    sibling = _snapshot(cons).annotation.model_copy(update={"annotation_id": "u"})
    targets = {("t", "v"): snap.annotation, ("u", "w"): sibling}
    same = consolidated_content_sha256(snap.annotation)

    def decisions(sha: str) -> list[ReviewDecision]:
        return [
            ReviewDecision(
                decision_id="keep",
                target=AnnotationRef(annotation_id="t", version="v"),
                outcome="confirmed",
                reviewer_id="r",
                consolidation=ConsolidationMark(action="choose", content_sha256=sha),
            ),
            ReviewDecision(
                decision_id="drop",
                target=AnnotationRef(annotation_id="u", version="w"),
                outcome="rejected",
                reviewer_id="r",
                consolidation=ConsolidationMark(action="choose", content_sha256="x"),
            ),
        ]

    kept = _state(targets, _Content([], decisions(same)))
    assert (kept["state"], kept["edited"]) == ("choose", False)
    assert kept["annotation_ids"] == ["t"]
    assert _state(targets, _Content([], decisions("other")))["edited"] is True


def test_uncertain_decision_leaves_the_group_open(cons):
    snap = _snapshot(cons)
    targets = {("t", "v"): snap.annotation}
    uncertain = ReviewDecision(
        decision_id="d",
        target=AnnotationRef(annotation_id="t", version="v"),
        outcome="uncertain",
        reviewer_id="r",
    )
    assert _state(targets, _Content([], [uncertain])) == {"state": "open"}


def test_empty_source_makes_every_group_partial(tmp_path):
    """A source submission without findings still counts: every group is
    partial and its author is listed."""
    env = plan_env(tmp_path)
    target = doc("c1", "en")
    submit_findings(
        env,
        assign(env, target, "anno", "annotate"),
        FIRST,
        [
            finding("a1", SEIZURE, span_of(env, target, "Neonatalzeit")),
            finding("a2", HYPOTONIA, span_of(env, target, "schwere")),
        ],
    )
    submit_findings(env, assign(env, target, "anno2", "annotate"), SECOND, [])
    lead_access, lead_actor = _access(env, "leader", "lead")
    created = WorkRoundService(env.db).create(
        lead_access,
        lead_actor,
        assign(env, target, "adj", "review"),
        request_id="consolidate-empty",
        expected_workflow_revision=0,
        kind="consolidation",
        source_submission_ids=[FIRST, SECOND],
    )
    adj = logged_in(env.app, "adj", assignments=[])
    response = adj.get(url(created.round_id))
    assert response.status_code == 200, response.text
    body = response.json()
    assert [g["kinds"] for g in body["groups"]] == [["partial"], ["partial"]]
    anno, anno2 = pseudonym(env, "anno"), pseudonym(env, "anno2")
    assert [p["person_id"] for p in body["people"]] == [anno, anno2]
    assert body["people"][1]["label"] == f"Arne Notator ({anno2})"


def test_superseded_round_stays_readable_for_the_lead(cons):
    env = cons.env
    adj_access, adj_actor = _access(env, "adj", "adjudicator")
    reviewer = ScopedRepository(env.db, adj_access, adj_actor)
    _submit_consolidation(env.app.state.ontology_registry, reviewer, cons.round)
    lead_access, lead_actor = _access(env, "leader", "lead")
    current = env.app.state.repo.get_work_round("proj", cons.round.round_id)
    WorkRoundService(env.db).create(
        lead_access,
        lead_actor,
        cons.review,
        request_id="consolidate-again",
        expected_workflow_revision=current.workflow_revision,
        kind="consolidation",
        source_submission_ids=[FIRST, SECOND],
    )
    old = env.app.state.repo.get_work_round("proj", cons.round.round_id)
    assert old.state == "superseded"
    response = env.lead.get(url(cons.round.round_id))
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["read_only"], body["read_only_reason"]) == (True, "submitted")
    assert {g["state"] for g in body["groups"]} == {"keep"}


def test_lead_cannot_read_a_reopened_round(cons):
    """Reopened after submit: state editable with a latest submission; the
    lead sees the draft only after the next submit."""
    env = cons.env
    adj_access, adj_actor = _access(env, "adj", "adjudicator")
    reviewer = ScopedRepository(env.db, adj_access, adj_actor)
    _submit_consolidation(env.app.state.ontology_registry, reviewer, cons.round)
    reopened = env.lead.post(
        f"/api/v1/assignments/{cons.review}/reopen", json={"reason": "again"}
    )
    assert reopened.status_code == 200, reopened.text
    item = env.app.state.repo.get_work_round("proj", cons.round.round_id)
    assert item.state == "editable"
    assert item.latest_submission_id is not None
    assert_hidden(env.lead.get(url(cons.round.round_id)))
    own = cons.adj.get(url(cons.round.round_id))
    assert own.status_code == 200, own.text
    assert own.json()["read_only"] is False
