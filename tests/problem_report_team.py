"""A lead and two annotators with tasks, plus report helpers (problem report tests)."""

from types import SimpleNamespace
from typing import Any

import pytest
from auth_harness import logged_in

from ontocurator.assignments.service import AssignmentService


@pytest.fixture
def team(round_work):
    app, lead, lead_task, _service, _rounds = round_work
    key = lead_task.project_key
    bob = logged_in(
        app,
        "bob",
        pseudonym="ann-0004",
        projects={key: ["annotator"]},
        assignments=[(key, "doc-1", "annotate")],
    )
    carol = logged_in(
        app,
        "carol",
        pseudonym="ann-0005",
        projects={key: ["annotator"]},
        assignments=[(key, "doc-other", "annotate")],
    )
    service = AssignmentService(app.state.repo.db)
    return SimpleNamespace(
        app=app,
        key=key,
        lead=lead,
        lead_task=lead_task,
        bob=bob,
        bob_task=service.list(key, user="bob")[0],
        carol=carol,
        carol_task=service.list(key, user="carol")[0],
    )


def report(
    client,
    task_id: int,
    reason: str = "Text is cut off after paragraph 2",
    request_id: str | None = None,
) -> dict[str, Any]:
    current = client.get(f"/api/v1/assignments/{task_id}").json()
    response = client.post(
        f"/api/v1/assignments/{task_id}/problem-reports",
        json={
            "request_id": request_id
            or f"report-{task_id}-{current['workflow_revision']}",
            "expected_workflow_revision": current["workflow_revision"],
            "round_id": current["active_round_id"],
            "reason": reason,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def act(
    client,
    report_id: str,
    revision: int,
    action: str,
    reason: str | None = None,
    ids: list[int] | None = None,
    *,
    status: int = 200,
    request_id: str | None = None,
):
    response = client.post(
        f"/api/v1/problem-reports/{report_id}/actions",
        json={
            "request_id": request_id or f"{action}-{report_id}-{revision}",
            "expected_revision": revision,
            "action": action,
            "reason": reason or f"{action} reason",
            "assignment_ids": ids or [],
        },
    )
    assert response.status_code == status, response.text
    return response.json()


def held(app, task_id: int) -> tuple[bool, str | None]:
    """Pause flag and banner reason of a task (existing reader, no new service method)."""
    with app.state.repo.db.transaction() as conn:
        current = AssignmentService._get(conn, task_id)
    return current.held, current.hold_reason
