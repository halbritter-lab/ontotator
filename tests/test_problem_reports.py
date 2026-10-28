"""Personal task holds preserve draft bytes and require explicit resumption."""

import pytest

from ontotator.authz.scoped import ScopedRepository
from ontotator.domain.errors import DomainError
from ontotator.domain.workspace import MutationEnvelope

pytest_plugins = ("test_work_rounds",)


def test_first_report_binds_round_and_advances_one_assignment_revision(rounds):
    from ontotator.application.problem_reports import ProblemReportService
    from ontotator.assignments.service import AssignmentService

    repo, access, actor, assignment, _ = rounds
    service = ProblemReportService(repo.db)
    request = {
        "request_id": "initial-report",
        "expected_workflow_revision": assignment.workflow_revision,
        "reason": "Pause before starting",
    }
    report = service.report(access, actor, assignment.id, **request)
    current = AssignmentService(repo.db).list("pkg-1", user="anna")[0]
    assert current.active_round_id == report.round_id
    assert (
        current.held and current.workflow_revision == assignment.workflow_revision + 1
    )
    assert service.report(access, actor, assignment.id, **request) == report
    assert AssignmentService(repo.db).list("pkg-1", user="anna")[0] == current


def test_personal_hold_blocks_new_commands_but_preserves_reads_and_resume(rounds):
    from ontotator.application.editing import EditingService
    from ontotator.application.problem_reports import ProblemReportService
    from ontotator.application.work_rounds import WorkRoundService

    repo, access, actor, assignment, ontology = rounds
    current = WorkRoundService(repo.db).create(
        access, actor, assignment.id, request_id="start", expected_workflow_revision=0
    )
    service = ProblemReportService(repo.db)
    report = service.report(
        access,
        actor,
        assignment.id,
        request_id="report",
        expected_workflow_revision=1,
        reason="The extraction needs investigation",
        round_id=current.round_id,
    )
    assert report.state == "open" and report.revision == 1
    scoped = ScopedRepository(repo.db, access, actor)
    assert scoped.open_draft(current.workspace_key).revision == 0
    with pytest.raises(DomainError, match="TASK_HELD"):
        EditingService(scoped, ontology).apply(
            current.workspace_key,
            MutationEnvelope(
                mutation_id="blocked",
                expected_revision=0,
                payload={
                    "command": "create_annotation",
                    "annotation_id": "a",
                    "term_id": "HP:0001252",
                    "note": "Preserved",
                },
            ),
        )
    resumed = service.act(
        access,
        actor,
        report.report_id,
        request_id="resume",
        expected_revision=1,
        action="resume",
        reason="Continue preserved work",
    )
    assert resumed.state == "open" and resumed.revision == 2
    assert (
        service.report(
            access,
            actor,
            assignment.id,
            request_id="report",
            expected_workflow_revision=1,
            reason="The extraction needs investigation",
            round_id=current.round_id,
        )
        == report
    )
    draft = EditingService(scoped, ontology).apply(
        current.workspace_key,
        MutationEnvelope(
            mutation_id="allowed",
            expected_revision=0,
            payload={
                "command": "create_annotation",
                "annotation_id": "a",
                "term_id": "HP:0001252",
                "note": "Preserved",
            },
        ),
    )
    assert draft.revision == 1


@pytest.mark.parametrize("operation", ["save", "submit"])
def test_committed_hold_prevents_a_waiting_new_write_and_preserves_receipt(
    rounds, operation
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event, get_ident

    from sqlalchemy import event, func, select

    from ontotator.application.editing import EditingService
    from ontotator.application.problem_reports import ProblemReportService
    from ontotator.application.submissions import SubmissionService
    from ontotator.application.work_rounds import WorkRoundService
    from ontotator.storage.repository import _lock_id

    repo, access, actor, assignment, ontology = rounds
    scoped = ScopedRepository(repo.db, access, actor)
    current = WorkRoundService(repo.db).create(
        access, actor, assignment.id, request_id="start", expected_workflow_revision=0
    )
    envelope = MutationEnvelope(
        mutation_id="original",
        expected_revision=0,
        payload={
            "command": "create_annotation",
            "annotation_id": "a",
            "term_id": "HP:0001252",
            "axes_values": {"assertion": "present"},
            "chosen_axis_ids": ["assertion"],
            "note": "Saved",
        },
    )
    editor = EditingService(scoped, ontology)
    saved = editor.apply(current.workspace_key, envelope)
    waiting = Event()
    owner = get_ident()

    def lock_attempt(conn, cursor, statement, parameters, context, executemany):
        if get_ident() != owner and "pg_advisory_xact_lock" in statement:
            waiting.set()

    def write():
        if operation == "submit":
            return SubmissionService(scoped, ontology).submit(
                current.workspace_key,
                MutationEnvelope(
                    mutation_id="queued",
                    expected_revision=1,
                    payload={"document_checked": True},
                ),
            )
        return editor.apply(
            current.workspace_key,
            MutationEnvelope(
                mutation_id="queued",
                expected_revision=1,
                payload={
                    "command": "set_annotation_note",
                    "annotation_id": "a",
                    "note": "Too late",
                },
            ),
        )

    event.listen(repo.db.engine, "before_cursor_execute", lock_attempt)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            with repo.db.transaction() as conn:
                conn.execute(
                    select(func.pg_advisory_xact_lock(_lock_id("project", "pkg-1")))
                )
                future = pool.submit(write)
                assert waiting.wait(10)
                ProblemReportService(repo.db).report(
                    access,
                    actor,
                    assignment.id,
                    request_id="hold",
                    expected_workflow_revision=1,
                    round_id=current.round_id,
                    reason="Stop for investigation",
                )
            with pytest.raises(DomainError, match="TASK_HELD"):
                future.result(timeout=15)
    finally:
        event.remove(repo.db.engine, "before_cursor_execute", lock_attempt)
    assert (
        scoped.open_draft(current.workspace_key).annotations[0].annotation.note
        == "Saved"
    )
    assert editor.apply(current.workspace_key, envelope) == saved


def test_lead_restart_abandons_submitted_round_and_opens_empty_preserved_history(
    rounds,
):
    from test_work_rounds import create_consolidation_fixture

    from ontotator.application.problem_reports import ProblemReportService
    from ontotator.assignments.service import AssignmentService

    repo, _ontology, _reviewer, _consolidation, inputs, lead, actor = (
        create_consolidation_fixture(rounds)
    )
    old = repo.get_round_for_submission("pkg-1", inputs[0].submission_id)
    assignment = AssignmentService(repo.db).list("pkg-1", user="anna")[0]
    service = ProblemReportService(repo.db)
    report = service.report(
        lead,
        actor,
        assignment.id,
        request_id="suspect",
        expected_workflow_revision=assignment.workflow_revision,
        round_id=old.round_id,
        submission_id=inputs[0].submission_id,
        reason="Suspect data",
    )
    restarted = service.act(
        lead,
        actor,
        report.report_id,
        request_id="agreed",
        expected_revision=1,
        action="restart",
        reason="Lead agrees to an empty attempt",
    )
    assert restarted.new_round.kind == "clean_restart" and restarted.state == "resolved"
    assert (
        service.act(
            lead,
            actor,
            report.report_id,
            request_id="agreed",
            expected_revision=1,
            action="restart",
            reason="Lead agrees to an empty attempt",
        )
        == restarted
    )
    for action in ("restart", "extend_hold", "resolve"):
        with pytest.raises(DomainError, match="WORKFLOW_REVISION_CONFLICT"):
            service.act(
                lead,
                actor,
                report.report_id,
                request_id=f"resolved-{action}",
                expected_revision=restarted.revision,
                action=action,
                reason="Already resolved",
                assignment_ids=[assignment.id],
            )
    assert (
        AssignmentService(repo.db).list("pkg-1", user="anna")[0].active_round_id
        == restarted.new_round.round_id
    )
    assert repo.get_work_round("pkg-1", old.round_id).state == "abandoned"
    draft = repo.open_draft(restarted.new_round.workspace_key)
    assert (
        draft.annotations == []
        and draft.decisions == []
        and draft.checked_layer_ids == []
    )
    assert repo.workspace_input_snapshots(draft.key) == []
    assert (
        repo.get_document_status("pkg-1", "doc-1", "anna", "independent")
        == "not_started"
    )
    assert repo.get_submission(inputs[0].submission_id, "pkg-1") == inputs[0]
    assert not AssignmentService(repo.db).list("pkg-1", user="anna")[0].held


def test_report_list_pages_newest_first(rounds):
    from ontotator.application.problem_reports import ProblemReportService
    from ontotator.assignments.service import AssignmentService

    repo, access, actor, assignment, _ = rounds
    service = ProblemReportService(repo.db)
    for index in range(3):
        current = AssignmentService(repo.db).list("pkg-1", user="anna")[0]
        report = service.report(
            access,
            actor,
            assignment.id,
            request_id=f"report-{index}",
            expected_workflow_revision=current.workflow_revision,
            reason=f"Problem {index}",
            round_id=current.active_round_id,
        )
        service.act(
            access,
            actor,
            report.report_id,
            request_id=f"resume-{index}",
            expected_revision=report.revision,
            action="resume",
            reason="Continue",
        )
    every = service.list(access, "pkg-1")
    assert [r.reason for r in every] == ["Problem 2", "Problem 1", "Problem 0"]
    pages = [service.list(access, "pkg-1", limit=2, offset=o) for o in (0, 2, 4)]
    assert pages == [every[:2], every[2:], []]
