"""Authenticated report/hold handling through actual assignment routes."""

from auth_harness import logged_in

from ontotator.assignments.service import AssignmentService

pytest_plugins = ("test_assignment_round_open_api", "test_translation_review_task")


def test_report_extension_uses_lead_reason_and_resolution_does_not_release_hold(
    check_work,
):
    app, client, row, _service, legacy_rounds = check_work
    selected = client.post(
        f"/api/v1/assignments/{row.id}/open",
        json={"review_round_target_set_id": legacy_rounds[0].key.target_set_id},
    )
    assert selected.status_code == 200, selected.text
    assignment = selected.json()["assignment"]
    created = client.post(
        f"/api/v1/assignments/{row.id}/problem-reports",
        json={
            "request_id": "report-api",
            "expected_workflow_revision": assignment["workflow_revision"],
            "round_id": assignment["active_round_id"],
            "reason": "Private reporter details",
        },
    )
    assert created.status_code == 200, created.text
    report = created.json()
    missing = client.post(
        f"/api/v1/problem-reports/{report['report_id']}/actions",
        json={
            "request_id": "missing-target",
            "expected_revision": 1,
            "action": "extend_hold",
            "reason": "Pause",
            "assignment_ids": [987654321],
        },
    )
    assert missing.status_code == 404, missing.text
    assert missing.json()["code"] == "ASSIGNMENT_NOT_FOUND"
    other = logged_in(
        app,
        "other",
        pseudonym="other-annotator",
        projects={row.project_key: ["annotator"]},
        assignments=[(row.project_key, "doc-1", "annotate")],
    )
    other_assignment = AssignmentService(app.state.repo.db).list(
        row.project_key, user="other"
    )[0]
    extended = client.post(
        f"/api/v1/problem-reports/{report['report_id']}/actions",
        json={
            "request_id": "extend",
            "expected_revision": 1,
            "action": "extend_hold",
            "reason": "Lead asks you to pause",
            "assignment_ids": [other_assignment.id],
        },
    )
    assert extended.status_code == 200, extended.text
    tasks = other.get("/api/v1/me/tasks").json()
    assert tasks[0]["held"] and tasks[0]["hold_reason"] == "Lead asks you to pause"
    assert (
        "Private reporter details"
        not in other.get(f"/api/v1/projects/{row.project_key}/problem-reports").text
    )
    forbidden = other.post(
        f"/api/v1/problem-reports/{report['report_id']}/actions",
        json={
            "request_id": "bypass",
            "expected_revision": 2,
            "action": "resume",
            "reason": "Bypass",
        },
    )
    assert forbidden.status_code in (403, 404)
    resolved = client.post(
        f"/api/v1/problem-reports/{report['report_id']}/actions",
        json={
            "request_id": "resolve",
            "expected_revision": 2,
            "action": "resolve",
            "reason": "Investigation recorded",
        },
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["state"] == "resolved"
    assert set(resolved.json()["held_assignment_ids"]) == {row.id, other_assignment.id}
    assert client.post(f"/api/v1/assignments/{row.id}/open").json()["read_only"] is True
    resumed = client.post(
        f"/api/v1/problem-reports/{report['report_id']}/actions",
        json={
            "request_id": "resume",
            "expected_revision": 3,
            "action": "resume",
            "reason": "Continue preserved work",
            "assignment_ids": [row.id, other_assignment.id],
        },
    )
    assert resumed.status_code == 200, resumed.text
    assert resumed.json()["held_assignment_ids"] == []
    assert (
        client.post(f"/api/v1/assignments/{row.id}/open").json()["read_only"] is False
    )


def test_translation_hold_and_agreed_restart_preserve_abandoned_draft(case_env):
    from test_translation_review_task import assigned

    env = case_env
    row = assigned(env)
    url = f"/api/v1/translation-reviews/{row['id']}"
    original = env.alice.get(url).json()
    saved = env.alice.put(
        url + "/draft",
        json={
            "expected_revision": 0,
            "text": "Private unfinished correction",
            "form": {"rationale": "Keep this history"},
        },
    )
    assert saved.status_code == 200, saved.text
    report = env.alice.post(
        f"/api/v1/assignments/{row['id']}/problem-reports",
        json={
            "request_id": "translation-report",
            "expected_workflow_revision": row["workflow_revision"],
            "reason": "Incorrect approach",
        },
    )
    assert report.status_code == 200, report.text
    assert env.alice.get(url).json()["read_only"] is True
    for method, path, body in [
        (
            env.alice.put,
            "/draft",
            {"expected_revision": 1, "text": "Overwrite", "form": {}},
        ),
        (env.alice.post, "/submit", {"expected_revision": 1}),
    ]:
        blocked = method(url + path, json=body)
        assert blocked.status_code == 409, blocked.text
        assert blocked.json()["code"] == "TASK_HELD"
    restarted = env.lead.post(
        f"/api/v1/problem-reports/{report.json()['report_id']}/actions",
        json={
            "request_id": "translation-restart",
            "expected_revision": 1,
            "action": "restart",
            "reason": "Lead agreed fresh review",
        },
    )
    assert restarted.status_code == 200, restarted.text
    assert restarted.json()["new_round"]["kind"] == "clean_restart"
    event = restarted.json()["events"][-1]
    assert (
        event["abandoned_translation_draft"]["text"] == "Private unfinished correction"
    )
    opened = env.alice.get(url).json()
    assert opened["draft"]["text"] == original["text"]
    assert opened["draft"]["form"] == {}
    assert opened["draft"]["revision"] == 2
    assert opened["read_only"] is False
    stale = env.alice.put(
        url + "/draft",
        json={"expected_revision": 1, "text": "Stale overwrite", "form": {}},
    )
    assert stale.status_code == 409, stale.text
