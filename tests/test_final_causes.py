"""One cause derivation on the caller's connection (spec: Backend and API changes)."""

from sqlalchemy import select

from ontocurator.storage.tables import AssignmentRow

pytest_plugins = ("test_assignment_round_open_api", "test_translation_review_task")


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
