"""``WorkRoundService.create`` after extracting ``create_in`` (plan O2b).

``create`` keeps locks, authorization, the command receipt and the
``round.create`` audit; ``create_in`` holds the round body. Every existing kind
behaves as before: the same view, one receipt replaying that view, one audit.
"""

from typing import Any

import pytest
from sqlalchemy import insert, select
from test_work_rounds import create_consolidation_fixture, rounds  # noqa: F401

from ontocurator.domain.errors import DomainError
from ontocurator.storage.tables import AuditEventRow, ProjectMembershipRow
from ontocurator.storage.workflow_tables import WorkflowCommandReceiptRow


def _receipt(repo: Any, user_id: int, request_id: str) -> Any:
    with repo.db.transaction() as conn:
        return conn.execute(
            select(WorkflowCommandReceiptRow).where(
                WorkflowCommandReceiptRow.actor_key == str(user_id),
                WorkflowCommandReceiptRow.request_id == request_id,
            )
        ).one()


def _round_audits(repo: Any, round_id: str) -> list[Any]:
    with repo.db.transaction() as conn:
        return list(
            conn.execute(
                select(AuditEventRow).where(
                    AuditEventRow.action == "round.create",
                    AuditEventRow.target_id == round_id,
                )
            )
        )


def _assert_recorded(
    repo: Any,
    user_id: int,
    request_id: str,
    view: Any,
    *,
    kind: str,
    assignment_id: int,
    sources: list[str],
    reason: str | None = None,
) -> None:
    receipt = _receipt(repo, user_id, request_id)
    assert receipt.response == view.model_dump(mode="json")
    [audit] = _round_audits(repo, view.round_id)
    assert audit.target_type == "work_round"
    assert audit.details == {
        "kind": kind,
        "assignment_id": assignment_id,
        "sources": sources,
        "reason": reason,
    }
    assert view.kind == kind
    assert view.input_submission_ids == sources
    assert view.state == "editable" and view.active


def _submit(repo: Any, access: Any, actor: Any, ontology: Any, key: Any) -> Any:
    from ontocurator.application.editing import EditingService
    from ontocurator.application.submissions import SubmissionService
    from ontocurator.authz.scoped import ScopedRepository
    from ontocurator.domain.workspace import MutationEnvelope

    scoped = ScopedRepository(repo.db, access, actor)
    created = EditingService(scoped, ontology).apply(
        key,
        MutationEnvelope(
            mutation_id=f"create-{key.round_id}",
            expected_revision=scoped.open_draft(key).revision,
            payload={
                "command": "create_annotation",
                "annotation_id": f"a-{key.round_id}",
                "term_id": "HP:0001252",
                "axes_values": {"assertion": "present"},
                "chosen_axis_ids": ["assertion"],
                "note": "Source",
            },
        ),
    )
    return SubmissionService(scoped, ontology).submit(
        key,
        MutationEnvelope(
            mutation_id=f"submit-{key.round_id}",
            expected_revision=created.revision,
            payload={"document_checked": True},
        ),
    )


def test_create_behaves_as_before_for_every_kind(rounds):  # noqa: F811
    from ontocurator.application.work_rounds import WorkRoundService

    repo, access, actor, assignment, ontology = rounds
    service = WorkRoundService(repo.db)
    ordinary = service.create(
        access,
        actor,
        assignment.id,
        request_id="ordinary",
        expected_workflow_revision=0,
    )
    _assert_recorded(
        repo,
        access.user_id,
        "ordinary",
        ordinary,
        kind="ordinary",
        assignment_id=assignment.id,
        sources=[],
    )
    assert ordinary.predecessor_round_id is None and ordinary.workflow_revision == 1
    # A replay answers the stored view without a second round or audit.
    assert (
        service.create(
            access,
            actor,
            assignment.id,
            request_id="ordinary",
            expected_workflow_revision=0,
        )
        == ordinary
    )
    with pytest.raises(DomainError, match="WORKFLOW_REQUEST_CONFLICT"):
        service.create(
            access,
            actor,
            assignment.id,
            request_id="ordinary",
            expected_workflow_revision=1,
        )
    with pytest.raises(DomainError, match="ROUND_ALREADY_EXISTS"):
        service.create(
            access,
            actor,
            assignment.id,
            request_id="again",
            expected_workflow_revision=1,
        )

    submission = _submit(repo, access, actor, ontology, ordinary.workspace_key)
    revision = repo.get_work_round("pkg-1", ordinary.round_id).workflow_revision
    carried = service.create(
        access,
        actor,
        assignment.id,
        request_id="carry",
        expected_workflow_revision=revision,
        kind="carry_forward",
        source_submission_ids=[submission.submission_id],
    )
    _assert_recorded(
        repo,
        access.user_id,
        "carry",
        carried,
        kind="carry_forward",
        assignment_id=assignment.id,
        sources=[submission.submission_id],
    )
    assert carried.predecessor_round_id == ordinary.round_id
    assert repo.get_work_round("pkg-1", ordinary.round_id).state == "superseded"
    inventory = repo.get_round_input_inventory("pkg-1", carried.round_id)
    assert [i["source_submission_id"] for i in inventory] == [submission.submission_id]
    # Submission inputs keep their payload shape (no draft-snapshot key).
    assert "source_draft_snapshot_id" not in inventory[0]

    with repo.db.transaction() as conn:
        pid = repo._require_project(conn, "pkg-1")
        conn.execute(
            insert(ProjectMembershipRow).values(
                project_id=pid, user_id=access.user_id, role="lead"
            )
        )
    lead = type(access)(
        access.user_id,
        access.pseudonym,
        False,
        {"pkg-1": frozenset({"annotator", "lead"})},
    )
    restarted = service.create(
        lead,
        actor,
        assignment.id,
        request_id="restart",
        expected_workflow_revision=carried.workflow_revision,
        kind="clean_restart",
        reason="Start over",
    )
    _assert_recorded(
        repo,
        access.user_id,
        "restart",
        restarted,
        kind="clean_restart",
        assignment_id=assignment.id,
        sources=[],
        reason="Start over",
    )
    assert repo.get_work_round("pkg-1", carried.round_id).state == "abandoned"


def test_create_consolidation_behaves_as_before(rounds):  # noqa: F811
    repo, _ontology, _reviewer, result, inputs, lead, _actor = (
        create_consolidation_fixture(rounds)
    )
    _assert_recorded(
        repo,
        lead.user_id,
        "consolidate",
        result,
        kind="consolidation",
        assignment_id=result.assignment_id,
        sources=[s.submission_id for s in inputs],
    )
    assert len(repo.get_round_input_inventory("pkg-1", result.round_id)) == 2


@pytest.mark.parametrize("kind", ["text_change", "handover"])
def test_create_refuses_text_change_kinds(rounds, kind):  # noqa: F811
    from ontocurator.application.work_rounds import WorkRoundService

    repo, access, actor, assignment, _ontology = rounds
    with pytest.raises(DomainError, match="ROUND_KIND_INVALID"):
        WorkRoundService(repo.db).create(
            access,
            actor,
            assignment.id,
            request_id=f"kind-{kind}",
            expected_workflow_revision=0,
            kind=kind,
        )
