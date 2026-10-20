"""One cause derivation on the caller's connection (spec: Backend and API changes)."""

import pytest
from auth_harness import HARNESS
from sqlalchemy import insert, select, update
from test_annotation_versions import seed_submission
from test_case_api import BASE, CORRECTED, TARGET
from test_case_api import case_env as case_env

from ontocurator.application.final_causes import (
    ACKNOWLEDGEABLE_CODES,
    corrects_selected_text,
)
from ontocurator.application.final_results import FinalResultService
from ontocurator.application.final_results import _pseudonym as _user_pseudonym
from ontocurator.application.problem_reports import ProblemReportService
from ontocurator.application.submissions import SubmissionService
from ontocurator.application.work_rounds import WorkRoundService
from ontocurator.assignments.service import AssignmentService
from ontocurator.auth.audit import Actor
from ontocurator.authz.policy import Access
from ontocurator.authz.scoped import ScopedRepository
from ontocurator.domain.errors import AccessDenied, RevisionConflict
from ontocurator.domain.workspace import MutationEnvelope
from ontocurator.storage.tables import AssignmentRow, DocumentRow, ProjectMembershipRow

pytest_plugins = (
    "test_assignment_round_open_api",
    "test_translation_review_task",
    "test_work_rounds",
)


def _report(client, row, legacy_rounds, request_id="report-1"):
    # The fixture's review task has two target sets; open selects one explicitly.
    response = client.post(
        f"/api/v1/assignments/{row.id}/open",
        json={"review_round_target_set_id": legacy_rounds[0].key.target_set_id},
    )
    assert response.status_code == 200, response.text
    opened = response.json()["assignment"]
    created = client.post(
        f"/api/v1/assignments/{row.id}/problem-reports",
        json={
            "request_id": request_id,
            "expected_workflow_revision": opened["workflow_revision"],
            "round_id": opened["active_round_id"],
            "reason": "Text is cut off after the second paragraph",
        },
    )
    assert created.status_code == 200, created.text
    return created.json()


def _act(client, report, revision, action, ids=None, request_id=None):
    response = client.post(
        f"/api/v1/problem-reports/{report['report_id']}/actions",
        json={
            "request_id": request_id or f"{action}-{revision}",
            "expected_revision": revision,
            "action": action,
            "reason": f"{action} reason",
            "assignment_ids": ids or [],
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def _causes(app, key):
    repo = app.state.repo
    with repo.db.transaction() as conn:
        pid = repo._require_project(conn, key)
        return repo.workflow_causes_in(conn, key, pid)


def test_open_report_and_its_hold_carry_the_report_id(round_work):
    app, client, row, _service, legacy = round_work
    report = _report(client, row, legacy)
    causes = _causes(app, row.project_key)
    opened = next(c for c in causes if c["code"] == "OPEN_PROBLEM_REPORT")
    held = next(c for c in causes if c["code"] == "TASK_ON_HOLD")
    assert opened["report_id"] == report["report_id"]
    assert held["report_id"] == report["report_id"]
    assert not any(c["code"] == "TASK_PAUSED_WITHOUT_REPORT" for c in causes)


def test_resolved_report_with_kept_hold_becomes_task_paused_without_report(
    round_work,
):
    app, client, row, _service, legacy = round_work
    report = _report(client, row, legacy)
    _act(client, report, 1, "resolve")
    causes = _causes(app, row.project_key)
    assert not any(c["code"] in {"OPEN_PROBLEM_REPORT", "TASK_ON_HOLD"} for c in causes)
    orphan = next(c for c in causes if c["code"] == "TASK_PAUSED_WITHOUT_REPORT")
    hold_id = orphan["cause_id"].removeprefix("TASK_PAUSED_WITHOUT_REPORT:")
    assert hold_id and hold_id != orphan["cause_id"]
    assert orphan["report_id"] == report["report_id"]
    assert orphan["assignment_id"] == row.id
    _act(client, report, 2, "resume", [row.id])
    assert not any(
        c["code"] == "TASK_PAUSED_WITHOUT_REPORT" for c in _causes(app, row.project_key)
    )


def test_conn_scoped_reads_do_not_open_a_second_transaction(round_work, monkeypatch):
    app, _client, row, _service, _legacy = round_work
    repo = app.state.repo
    opened: list[int] = []
    original = repo.db.engine.begin

    def counting_begin(*args, **kwargs):
        opened.append(1)
        return original(*args, **kwargs)

    with repo.db.transaction() as conn:
        monkeypatch.setattr(repo.db.engine, "begin", counting_begin)
        pid = repo._require_project(conn, row.project_key)
        repo.workflow_causes_in(conn, row.project_key, pid)
        assert conn.execute(select(AssignmentRow.id).limit(1)).first() is not None
    assert opened == []


# --- Task 1.3: one cause derivation with the new cause rules ---------------- #


def _select(env, document, sid, revision=0, acks=()):
    response = env.lead.put(
        f"{BASE}/final-selections",
        json={
            "document_id": document,
            "submission_id": sid,
            "expected_revision": revision,
            "acknowledged_cause_ids": list(acks),
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def _warnings(env, code):
    state = env.lead.get(f"{BASE}/workflow-warnings").json()
    return [w for w in state["warnings"] if w["code"] == code]


def test_acknowledgeable_codes_are_the_five_selection_codes_and_plan_restored():
    assert {
        "SELECTED_ROUND_ABANDONED",
        "SELECTED_ROUND_SUPERSEDED",
        "SELECTED_RESULT_REVISED",
        "SELECTED_TEXT_CORRECTED",
        "SELECTED_NEWER_RESULT",
        "PLAN_RESTORED",
    } == ACKNOWLEDGEABLE_CODES


def test_submission_recorded_after_selection_raises_newer_result(case_env):
    env = case_env
    seed_submission(env, "alice", "first", document=TARGET)
    _select(env, TARGET, "first")
    assert _warnings(env, "SELECTED_NEWER_RESULT") == []
    seed_submission(env, "alice", "later", document=CORRECTED)
    newer = _warnings(env, "SELECTED_NEWER_RESULT")
    assert [w["cause_id"] for w in newer] == ["SELECTED_NEWER_RESULT:later"]
    assert newer[0]["document_id"] == CORRECTED


def test_newer_result_is_acknowledgeable(case_env):
    env = case_env
    seed_submission(env, "alice", "first", document=TARGET)
    _select(env, TARGET, "first")
    seed_submission(env, "alice", "later", document=TARGET)
    # Reaffirmation names the row's complete acknowledgeable set (Task 1.4).
    acks = _ack_warnings(env)
    assert "SELECTED_NEWER_RESULT:later" in acks
    _select(env, TARGET, "first", revision=1, acks=acks)
    assert _warnings(env, "SELECTED_NEWER_RESULT") == []


def test_text_correction_cause_id_carries_status_and_reraises_on_acceptance(case_env):
    env = case_env
    seed_submission(env, "alice", "german", document=TARGET)
    _select(env, TARGET, "german")
    first = _warnings(env, "SELECTED_TEXT_CORRECTED")
    status = _status(env, CORRECTED)
    assert [w["cause_id"] for w in first] == [
        f"SELECTED_TEXT_CORRECTED:{TARGET}:{CORRECTED}:{status}"
    ]
    _select(env, TARGET, "german", revision=1, acks=[first[0]["cause_id"]])
    assert _warnings(env, "SELECTED_TEXT_CORRECTED") == []
    _set_status(env, CORRECTED, "accepted")
    again = _warnings(env, "SELECTED_TEXT_CORRECTED")
    assert [w["cause_id"] for w in again] == [
        f"SELECTED_TEXT_CORRECTED:{TARGET}:{CORRECTED}:accepted"
    ]


def test_rejected_or_queried_correction_raises_no_text_cause(case_env):
    env = case_env
    seed_submission(env, "alice", "german", document=TARGET)
    _select(env, TARGET, "german")
    for decision in ("rejected", "query"):
        _set_status(env, CORRECTED, "reviewed")
        _add_review(env, CORRECTED, decision)
        assert _warnings(env, "SELECTED_TEXT_CORRECTED") == []


def test_accepted_corrected_parent_raises_no_text_cause():
    # Open question 1: the accepted child raises its own cause.
    assert not corrects_selected_text("reviewed", "accepted_corrected")
    assert corrects_selected_text("accepted", "accepted_unchanged")
    assert corrects_selected_text(None, None)
    assert not corrects_selected_text("reviewed", "rejected")
    assert not corrects_selected_text("accepted", "query")


def _status(env, document):
    with env.db.transaction() as conn:
        return (
            conn.execute(
                select(DocumentRow.translation_status).where(
                    DocumentRow.document_id == document
                )
            ).scalar_one()
            or "native"
        )


def _set_status(env, document, status):
    with env.db.transaction() as conn:
        conn.execute(
            update(DocumentRow)
            .where(DocumentRow.document_id == document)
            .values(translation_status=status)
        )


def _add_review(env, document, decision):
    from tests_support_reviews import insert_review

    insert_review(env.db, "proj", document, decision)


def _codes(state, code):
    return [w for w in state["warnings"] if w["code"] == code]


def test_round_cause_id_is_stable_across_hold_resume_and_reopen(rounds):
    repo, access, actor, assignment, ontology = rounds
    with repo.db.transaction() as conn:
        conn.execute(
            insert(ProjectMembershipRow).values(
                project_id=repo._require_project(conn, "pkg-1"),
                user_id=access.user_id,
                role="lead",
            )
        )
    lead = Access(
        access.user_id,
        access.pseudonym,
        False,
        {"pkg-1": frozenset({"lead", "annotator"})},
    )
    scoped = ScopedRepository(repo.db, lead, actor)
    rounds_service = WorkRoundService(repo.db)
    round_a = rounds_service.create(
        lead, actor, assignment.id, request_id="initial", expected_workflow_revision=0
    )
    original = SubmissionService(scoped, ontology).submit(
        round_a.workspace_key,
        MutationEnvelope(
            mutation_id="original",
            expected_revision=0,
            payload={"document_checked": True},
        ),
    )
    document, submission = "doc-1", original.submission_id
    service = FinalResultService(repo.db, actor, lead)
    service.select("pkg-1", document, submission, 0, [])
    current = AssignmentService(repo.db)._get
    with repo.db.transaction() as conn:
        revision = current(conn, assignment.id).workflow_revision
    carried = rounds_service.create(
        lead,
        actor,
        assignment.id,
        request_id="carry",
        expected_workflow_revision=revision,
        kind="carry_forward",
        source_submission_ids=[submission],
    )
    state = service.preflight("pkg-1")
    ids = [
        w["cause_id"]
        for w in state["warnings"]
        if w["code"] == "SELECTED_ROUND_SUPERSEDED"
    ]
    assert ids == [f"SELECTED_ROUND_SUPERSEDED:{round_a.round_id}"]
    service.select("pkg-1", document, submission, 1, ids)
    # ROUND_REVIEW_PENDING is not acknowledgeable: reaffirmation refuses it.
    (pending,) = _codes(service.preflight("pkg-1"), "ROUND_REVIEW_PENDING")
    with pytest.raises(RevisionConflict):
        service.select("pkg-1", document, submission, 2, [pending["cause_id"]])

    def no_superseded():
        assert not [
            w
            for w in service.preflight("pkg-1")["warnings"]
            if w["code"] == "SELECTED_ROUND_SUPERSEDED"
        ]

    no_superseded()
    reports = ProblemReportService(repo.db)
    with repo.db.transaction() as conn:
        revision = current(conn, assignment.id).workflow_revision
    report = reports.report(
        lead,
        actor,
        assignment.id,
        request_id="report",
        expected_workflow_revision=revision,
        reason="The text needs investigation",
        round_id=carried.round_id,
    )
    no_superseded()
    resolved = reports.act(
        lead,
        actor,
        report.report_id,
        request_id="resolve",
        expected_revision=report.revision,
        action="resolve",
        reason="Resolved, keep the pause",
    )
    # TASK_PAUSED_WITHOUT_REPORT is not acknowledgeable either.
    (orphan,) = _codes(service.preflight("pkg-1"), "TASK_PAUSED_WITHOUT_REPORT")
    with pytest.raises(RevisionConflict):
        service.select("pkg-1", document, submission, 2, [orphan["cause_id"]])
    no_superseded()
    reports.act(
        lead,
        actor,
        report.report_id,
        request_id="resume",
        expected_revision=resolved.revision,
        action="resume",
        reason="Continue",
        assignment_ids=[assignment.id],
    )
    assert _codes(service.preflight("pkg-1"), "TASK_PAUSED_WITHOUT_REPORT") == []
    no_superseded()
    SubmissionService(scoped, ontology).submit(
        carried.workspace_key,
        MutationEnvelope(
            mutation_id="carried",
            expected_revision=0,
            payload={"document_checked": True},
        ),
    )
    AssignmentService(repo.db).reopen(HARNESS, assignment.id, "again")
    no_superseded()


# --- Task 1.4: selection time, rule state, exact warning set ---------------- #


def _pseudonym(env, username):
    return env.app.state.accounts.get_by_username(username).pseudonym


def _ack_warnings(env):
    return {
        w["cause_id"]
        for w in env.lead.get(f"{BASE}/workflow-warnings").json()["warnings"]
        if w["code"] in ACKNOWLEDGEABLE_CODES and w["language"] == "de"
    }


def _keep(env, acks, revision):
    return env.lead.put(
        f"{BASE}/final-selections",
        json={
            "document_id": TARGET,
            "submission_id": "one",
            "expected_revision": revision,
            "acknowledged_cause_ids": sorted(acks),
        },
    )


def test_selected_at_survives_reaffirmation_and_changes_on_replacement(case_env):
    env = case_env
    seed_submission(env, "alice", "one", document=TARGET)
    seed_submission(
        env, "alice", "two", document=TARGET, timestamp="2026-10-16T11:00:00Z"
    )
    first = _select(env, TARGET, "one")
    assert first["selected_at"] and first["updated_at"]
    assert first["selected_by"] == _pseudonym(env, "leader")
    assert _warnings(env, "SELECTED_TEXT_CORRECTED")
    kept = _select(env, TARGET, "one", revision=1, acks=_ack_warnings(env))
    assert kept["selected_at"] == first["selected_at"]
    assert kept["updated_at"] >= first["updated_at"]
    replaced = _select(env, TARGET, "two", revision=2)
    assert replaced["selected_at"] > first["selected_at"]
    assert replaced["adjudicator_not_annotator"] is False


def test_revision_conflict_names_who_changed_the_selection(case_env):
    env = case_env
    seed_submission(env, "alice", "one", document=TARGET)
    _select(env, TARGET, "one")
    stale = env.lead.put(
        f"{BASE}/final-selections",
        json={"document_id": TARGET, "submission_id": "one", "expected_revision": 0},
    )
    assert stale.status_code == 409
    details = stale.json()["details"]
    assert details["current_revision"] == 1
    assert details["selected_by"] == _pseudonym(env, "leader")
    assert details["updated_at"]


def test_keep_requires_the_exact_current_warning_set(case_env):
    """Spec 'Inline confirmation' > Conflict: the set captured at open must still be the set."""
    env = case_env
    seed_submission(env, "alice", "one", document=TARGET)
    _select(env, TARGET, "one")
    opened = _ack_warnings(env)
    assert opened
    # Addition: a newer submission appears after the confirm opened.
    seed_submission(
        env, "alice", "later", document=TARGET, timestamp="2026-10-17T10:00:00Z"
    )
    added = _keep(env, opened, 1)
    assert added.status_code == 409, added.text
    assert added.json()["details"]["reason"] == "warnings_changed"
    # Status change: the correction moves on, so its id (which carries the status) changes.
    current = _ack_warnings(env)
    _set_status(env, CORRECTED, "accepted")
    assert _keep(env, current, 1).status_code == 409
    # Removal: the correction is rejected in review, so its cause disappears.
    current = _ack_warnings(env)
    _set_status(env, CORRECTED, "reviewed")
    _add_review(env, CORRECTED, "rejected")
    assert _keep(env, current, 1).status_code == 409
    # Exact set: succeeds and clears every acknowledgeable cause of the row.
    assert _keep(env, _ack_warnings(env), 1).status_code == 200
    assert not _ack_warnings(env)


# --- Task 1.5: OWN_RESULT_NOT_SELECTABLE ------------------------------------ #


def _set_rule(env, value):
    from ontocurator.storage.tables import ProjectRow

    with env.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == "proj")
            .values(adjudicator_not_annotator=value)
        )


def test_lead_cannot_choose_or_keep_own_result_when_rule_is_on(case_env):
    env = case_env
    seed_submission(env, "leader", "own", document=TARGET)
    seed_submission(env, "alice", "other", document=TARGET)
    _set_rule(env, True)
    refused = env.lead.put(
        f"{BASE}/final-selections",
        json={"document_id": TARGET, "submission_id": "own", "expected_revision": 0},
    )
    assert refused.status_code == 409
    assert refused.json()["code"] == "OWN_RESULT_NOT_SELECTABLE"
    assert _select(env, TARGET, "other")["adjudicator_not_annotator"] is True
    _set_rule(env, False)
    own = _select(env, TARGET, "own", revision=1)
    assert own["adjudicator_not_annotator"] is False
    _set_rule(env, True)
    # Toggling the rule later neither invalidates nor hides the earlier decision.
    state = env.lead.get(f"{BASE}/workflow-warnings").json()
    assert any(s["submission_id"] == "own" for s in state["selections"])
    keep = env.lead.put(
        f"{BASE}/final-selections",
        json={
            "document_id": TARGET,
            "submission_id": "own",
            "expected_revision": 2,
            "acknowledged_cause_ids": sorted(_ack_warnings(env)),
        },
    )
    assert keep.status_code == 409
    assert keep.json()["code"] == "OWN_RESULT_NOT_SELECTABLE"


def test_stale_own_result_request_gets_the_revision_conflict_first(case_env):
    env = case_env
    seed_submission(env, "leader", "own", document=TARGET)
    seed_submission(env, "alice", "other", document=TARGET)
    _set_rule(env, True)
    _select(env, TARGET, "other")
    stale = env.lead.put(
        f"{BASE}/final-selections",
        json={"document_id": TARGET, "submission_id": "own", "expected_revision": 0},
    )
    assert stale.status_code == 409
    body = stale.json()
    assert body["code"] == "REVISION_CONFLICT"
    assert body["details"]["current_revision"] == 1
    assert body["details"]["selected_by"] == _pseudonym(env, "leader")
    assert body["details"]["updated_at"]


def test_process_actor_cannot_choose_a_final_result(case_env):
    env = case_env
    seed_submission(env, "alice", "one", document=TARGET)
    service = FinalResultService(
        env.db, Actor(None, "cli:test"), Access(0, "process", True)
    )
    with pytest.raises(AccessDenied) as refused:
        service.select("proj", TARGET, "one", 0, [])
    assert refused.value.code == "NOT_ALLOWED"
    assert not env.lead.get(f"{BASE}/workflow-warnings").json()["selections"]


def test_pseudonym_of_a_missing_user_is_none(case_env):
    with case_env.db.transaction() as conn:
        assert _user_pseudonym(conn, 987654321) is None


# --- Task 1.6: phase 1 contract checks -------------------------------------- #


def _seed_round_submission(app, key, document, sid):
    from ontocurator.domain.review import ReviewTargetSet
    from ontocurator.domain.workspace import Submission, WorkspaceKey
    from ontocurator.storage.repository import _key_str

    origin = WorkspaceKey(
        project_key=key,
        document_id=document,
        annotator_id="someone-else",
        mode="independent",
        target_set_id="targets-0",
    )
    record = Submission(
        submission_id=sid,
        origin_key=origin,
        targets=ReviewTargetSet.create([]),
        draft_revision=1,
        snapshots=[],
        decisions=[],
        created_at="2026-10-16T10:00:00Z",
    )
    repo = app.state.repo
    with repo.db.transaction() as conn:
        pid = repo._require_project(conn, key)
        repo._insert_submission(
            conn, pid, record, local_key=_key_str(origin), imported=False
        )


def test_reaffirmation_refuses_non_acknowledgeable_cause_ids(round_work):
    app, client, row, _service, legacy = round_work
    report = _report(client, row, legacy)
    _act(client, report, 1, "resolve")
    orphan = next(
        c
        for c in _causes(app, row.project_key)
        if c["code"] == "TASK_PAUSED_WITHOUT_REPORT"
    )
    _seed_round_submission(app, row.project_key, row.document_id, "chosen")
    url = f"/api/v1/projects/{row.project_key}/final-selections"
    first = client.put(
        url,
        json={
            "document_id": row.document_id,
            "submission_id": "chosen",
            "expected_revision": 0,
        },
    )
    assert first.status_code == 200, first.text
    refused = client.put(
        url,
        json={
            "document_id": row.document_id,
            "submission_id": "chosen",
            "expected_revision": 1,
            "acknowledged_cause_ids": [orphan["cause_id"]],
        },
    )
    assert refused.status_code == 409, refused.text


def test_no_selection_changes_without_an_explicit_put(case_env):
    env = case_env
    seed_submission(env, "alice", "one", document=TARGET)
    _select(env, TARGET, "one")
    before = env.lead.get(f"{BASE}/workflow-warnings").json()["selections"]
    seed_submission(
        env, "alice", "newer", document=TARGET, timestamp="2026-10-17T10:00:00Z"
    )
    env.lead.post(f"{BASE}/exports/final/preflight")
    assert env.lead.get(f"{BASE}/workflow-warnings").json()["selections"] == before
