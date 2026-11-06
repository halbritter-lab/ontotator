"""A clean restart of a proposal check takes the newest proposal set (#337).

A tool set imported after a proposal task started never reached the task: a
lead's clean restart answered 200 with no proposals at all. The restart now
starts over on the newest set, and every proposal-check round records the
set it started from (``work_rounds.proposal_set_id``, migration 0037).
"""

from __future__ import annotations

from pathlib import Path

from auth_harness import logged_in
from sqlalchemy import select
from t1_fixtures import annotation, bundle, run_import, unit
from test_proposal_queries import checker as checker
from test_reanchor_resolutions import from_proposals

from ontotator.domain.work_rounds import WorkRoundView
from ontotator.storage.repository import Repository
from ontotator.storage.tables import AssignmentRow, ProposalSetRow
from ontotator.storage.workflow_tables import WorkRoundRow

NEWER = "urn:ontospan:b-2:set-b:p3"


def _assignment(db) -> int:  # type: ignore[no-untyped-def]
    with db.transaction() as conn:
        return int(
            conn.execute(
                select(AssignmentRow.id).where(AssignmentRow.task == "annotate")
            ).scalar_one()
        )


def _round(client, assignment_id: int, **body) -> WorkRoundView:  # type: ignore[no-untyped-def]
    response = client.post(f"/api/v1/assignments/{assignment_id}/rounds", json=body)
    assert response.status_code == 200, response.text
    return WorkRoundView.model_validate(response.json())


def _set_of(db, round_id: str) -> str | None:  # type: ignore[no-untyped-def]
    with db.transaction() as conn:
        return conn.execute(
            select(ProposalSetRow.annotation_set_id)
            .select_from(WorkRoundRow)
            .outerjoin(
                ProposalSetRow, ProposalSetRow.id == WorkRoundRow.proposal_set_id
            )
            .where(WorkRoundRow.round_id == round_id)
        ).scalar_one()


def _targets(repo: Repository, view: WorkRoundView) -> set[str]:
    assert view.workspace_key is not None
    return {
        s.annotation.annotation_id
        for s in repo.workspace_input_snapshots(view.workspace_key)
    }


def _restart_after_a_newer_set(checker, tmp_path: Path):  # type: ignore[no-untyped-def]
    """First round on set-a, import set-b, the lead restarts cleanly."""
    from_proposals(checker.db)
    assignment_id = _assignment(checker.db)
    first = _round(
        checker.client, assignment_id, request_id="first", expected_workflow_revision=0
    )
    later = unit("EN100017", set_id="set-b", annotations=[annotation("p3", (63, 76))])
    assert (
        run_import(checker.db, bundle(tmp_path / "b.zip", [later], "b-2")).status
        == "succeeded"
    )
    lead = logged_in(checker.app, "lead", projects={"proj": ["lead"]}, assignments=[])
    restarted = _round(
        lead,
        assignment_id,
        request_id="restart",
        expected_workflow_revision=first.workflow_revision,
        kind="clean_restart",
        reason="A newer tool set",
    )
    return first, restarted


def test_clean_restart_moves_a_proposal_task_onto_the_newest_set(
    checker, tmp_path: Path
):
    first, restarted = _restart_after_a_newer_set(checker, tmp_path)
    repo = checker.app.state.repo

    assert restarted.kind == "clean_restart" and restarted.mode == "proposal_check"
    old = _targets(repo, first)
    assert old and NEWER not in old
    assert _targets(repo, restarted) == {NEWER}
    assert restarted.workspace_key is not None and first.workspace_key is not None
    assert restarted.workspace_key.target_set_id != first.workspace_key.target_set_id
    # Each round keeps the set it started from.
    assert _set_of(checker.db, first.round_id) == "set-a"
    assert _set_of(checker.db, restarted.round_id) == "set-b"


def test_the_restarted_workspace_opens_on_the_newest_proposals(checker, tmp_path: Path):
    _first, restarted = _restart_after_a_newer_set(checker, tmp_path)
    response = checker.client.post(
        "/api/v1/workspaces/open",
        json={
            "project_key": "proj",
            "document_id": "EN100017",
            "mode": "proposal_check",
        },
    )
    assert response.status_code == 200, response.text
    view = response.json()["view"]
    assert view["key"]["round_id"] == restarted.round_id
    assert [t["annotation_id"] for t in view["targets"]["targets"]] == [NEWER]


def test_a_scratch_round_records_no_proposal_set(checker):
    first = _round(
        checker.client,
        _assignment(checker.db),
        request_id="first",
        expected_workflow_revision=0,
    )
    assert first.mode == "independent"
    assert _set_of(checker.db, first.round_id) is None
