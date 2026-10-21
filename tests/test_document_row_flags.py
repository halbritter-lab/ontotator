"""Consolidation flags and "kept automatically" in the lead's row reads
(acceptance fixes spec "WP-B > After consolidation", "Flags", X4, X5).

Counts are findings, i.e. consolidation groups: every member of a group
carries its own decision with the group's mark, so a two-member group is one
finding, not two.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from test_consolidation_read_api import _access, _insert_decisions, _targets
from test_consolidation_read_api import cons as cons  # fixture
from work_plan_support import BASE

from ontocurator.application.consolidation import consolidation_group_id
from ontocurator.application.submissions import SubmissionService
from ontocurator.application.workspaces import WorkspaceService
from ontocurator.authz.scoped import ScopedRepository
from ontocurator.domain.review import ConsolidationMark, ReviewDecision
from ontocurator.domain.workspace import MutationEnvelope
from ontocurator.storage.tables import UserRow


def rows(env: Any, params: list[tuple[str, str]] | None = None) -> dict[str, Any]:
    response = env.lead.get(f"{BASE}/document-rows", params=params or [])
    assert response.status_code == 200, response.text
    return dict(response.json())


def row_of(page: dict[str, Any], case_id: str, language: str) -> dict[str, Any]:
    return next(
        row
        for group in page["groups"]
        for row in group["rows"]
        if (row["case_id"], row["language"]) == (case_id, language)
    )


def submissions(env: Any) -> list[dict[str, Any]]:
    response = env.lead.get(f"{BASE}/document-rows/c1/en/submissions")
    assert response.status_code == 200, response.text
    return list(response.json()["submissions"])


def decide_and_submit(cons: Any, marks: list[tuple[str, ConsolidationMark]]) -> str:
    """Decide every member target (``marks`` per group in reading order:
    the outcome of the group's first member, the others rejected) and submit."""
    env = cons.env
    groups = cons.adj.get(f"/api/v1/rounds/{cons.round.round_id}/consolidation")
    assert groups.status_code == 200, groups.text
    targets = _targets(env, cons.round.round_id)
    adj = env.app.state.accounts.get_by_username("adj").pseudonym
    decisions = []
    for group, (outcome, mark) in zip(groups.json()["groups"], marks, strict=True):
        for index, member in enumerate(group["members"]):
            decisions.append(
                ReviewDecision(
                    decision_id=f"dec-{member['input_id'][:12]}",
                    target=targets[member["input_id"]],
                    outcome=outcome if index == 0 else "rejected",
                    reviewer_id=adj,
                    consolidation=mark,
                )
            )
    opened = cons.adj.post(f"/api/v1/rounds/{cons.round.round_id}/open")
    assert opened.status_code == 200, opened.text
    _insert_decisions(env, cons.round.workspace_key, decisions)
    access, actor = _access(env, "adj", "adjudicator")
    reviewer = ScopedRepository(env.db, access, actor)
    ontology = env.app.state.ontology_registry
    draft = WorkspaceService(reviewer, ontology).open(cons.round.workspace_key).draft
    output = SubmissionService(reviewer, ontology).submit(
        cons.round.workspace_key,
        MutationEnvelope(
            mutation_id="submit",
            expected_revision=draft.revision,
            payload={"document_checked": True},
        ),
    )
    return str(output.submission_id)


def flagged_group(cons: Any, index: int) -> str:
    body = cons.env.lead.get(f"/api/v1/rounds/{cons.round.round_id}/consolidation")
    assert body.status_code == 200, body.text
    group = body.json()["groups"][index]
    return consolidation_group_id([m["input_id"] for m in group["members"]])


def test_flagged_findings_group_id_facet_and_kept_automatically(cons):
    env = cons.env
    # Groups in reading order: match (2 members), values differ (2), partial (1).
    submission_id = decide_and_submit(
        cons,
        [
            ("confirmed", ConsolidationMark(action="auto")),
            ("confirmed", ConsolidationMark(action="choose", guidelines_unclear=True)),
            ("confirmed", ConsolidationMark(action="keep", guidelines_unclear=True)),
        ],
    )
    row = row_of(rows(env), "c1", "en")
    assert row["flagged_unclear"] == 2
    assert row["flagged_group_id"] == flagged_group(cons, 1)
    facets = rows(env)["bar"]["facets"]
    assert facets["flags"] == {"guidelines_unclear": 1}
    filtered = rows(env, [("flags", "guidelines_unclear")])
    assert [
        (r["case_id"], r["language"]) for g in filtered["groups"] for r in g["rows"]
    ] == [("c1", "en")]
    listed = {item["submission_id"]: item for item in submissions(env)}
    consolidation = listed[submission_id]
    assert consolidation["kind"] == "consolidation"
    # One automatic group with two member decisions is one finding.
    assert consolidation["kept_automatically"] == 1
    assert all(
        item["kept_automatically"] == 0
        for sid, item in listed.items()
        if sid != submission_id
    )
    # The consolidator is the submission's author, with the display name.
    with env.db.transaction() as conn:
        adj = conn.execute(select(UserRow).where(UserRow.username == "adj")).one()
    assert consolidation["author"] == {
        "pseudonym": adj.pseudonym,
        "display_name": "Ada Judicator",
        "is_me": False,
    }
    panel = env.lead.get(f"{BASE}/document-rows/c1/en/final-panel")
    assert panel.status_code == 200, panel.text
    [panel_item] = [
        s for s in panel.json()["submissions"] if s["submission_id"] == submission_id
    ]
    assert panel_item["kept_automatically"] == 1


def test_three_automatic_groups_count_three(cons):
    env = cons.env
    submission_id = decide_and_submit(
        cons,
        [("confirmed", ConsolidationMark(action="auto"))] * 3,
    )
    listed = {item["submission_id"]: item for item in submissions(env)}
    assert listed[submission_id]["kept_automatically"] == 3
    row = row_of(rows(env), "c1", "en")
    assert (row["flagged_unclear"], row["flagged_group_id"]) == (0, None)


def test_no_flags_before_and_without_marks(cons):
    env = cons.env
    row = row_of(rows(env), "c1", "en")
    assert (row["flagged_unclear"], row["flagged_group_id"]) == (0, None)
    assert rows(env)["bar"]["facets"]["flags"] == {}
    decide_and_submit(cons, [("confirmed", None)] * 3)
    row = row_of(rows(env), "c1", "en")
    assert (row["flagged_unclear"], row["flagged_group_id"]) == (0, None)
    facets = rows(env, [("flags", "guidelines_unclear")])["bar"]["facets"]
    assert facets["flags"] == {"guidelines_unclear": 0}
    assert rows(env, [("flags", "guidelines_unclear")])["groups"] == []
    assert all(item["kept_automatically"] == 0 for item in submissions(env))
