"""Text-change routes: lead-only, HTTP statuses, language confirmation (O2b)."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from browser_carry_fixture import CORRECTED_DE, TEXT_DE
from browser_documents_scenarios import add_user, assign
from browser_server import ONTOLOGY, TEST_PASSWORD
from fastapi.testclient import TestClient
from pg_harness import database_url_for
from sqlalchemy import update
from test_text_change_service import (
    THIRD_DE,
    Env,
    _env,
    _revision,
    _started,
    _submitted,
)

from ontocurator.api.app import create_app
from ontocurator.config import AppConfig
from ontocurator.storage.tables import AssignmentRow


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    app = create_app(
        AppConfig(
            workspace_dir=tmp_path,
            database_url=database_url_for(tmp_path / "text-change-api.db"),
            ontology_paths=[ONTOLOGY],
        )
    )
    with TestClient(app) as client:
        yield client


def _app(client: TestClient) -> Any:
    return client.app


def _login(client: TestClient, env: Env, name: str) -> None:
    client.cookies.clear()
    client.headers.pop("X-CSRF-Token", None)
    response = client.post(
        "/api/v1/auth/login",
        json={"username": env.user(name), "password": TEST_PASSWORD},
        headers={"Origin": str(client.base_url).rstrip("/")},
    )
    assert response.status_code == 200, response.text
    client.headers["X-CSRF-Token"] = response.json()["csrf_token"]


def _move(client: TestClient, env: Env, assignment_id: int, **body: Any) -> Any:
    payload = {
        "target_document_id": env.docs[-1],
        "expected_workflow_revision": _revision(env, assignment_id),
        "request_id": "move-1",
    } | body
    return client.post(
        f"/api/v1/assignments/{assignment_id}/move-to-version", json=payload
    )


def _carry(client: TestClient, env: Env, submission_id: str, **body: Any) -> Any:
    payload = {
        "target_document_id": env.docs[-1],
        "mode": "author",
        "request_id": "carry-1",
    } | body
    return client.post(
        f"/api/v1/projects/{env.key}/submissions/{submission_id}/carry", json=payload
    )


def _code(response: Any) -> tuple[int, str]:
    return response.status_code, response.json()["code"]


def test_routes_are_lead_only(client):
    env = _env(_app(client))
    work = _started(env)
    done = _submitted(env, "ana")
    _login(client, env, "tom")
    preview = client.post(
        f"/api/v1/projects/{env.key}/text-changes/preview",
        json={
            "assignment_id": work["assignment_id"],
            "target_document_id": env.docs[1],
        },
    )
    assert preview.status_code == 403
    assert _move(client, env, work["assignment_id"]).status_code == 403
    resolution = client.post(
        f"/api/v1/assignments/{work['assignment_id']}/text-change-resolution",
        json={"resolution": "withdrawn", "target_document_id": env.docs[1]},
    )
    assert resolution.status_code == 403
    assert _carry(client, env, done["submission_id"]).status_code == 403

    _login(client, env, "lead")
    preview = client.post(
        f"/api/v1/projects/{env.key}/text-changes/preview",
        json={
            "assignment_id": work["assignment_id"],
            "target_document_id": env.docs[1],
        },
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["findings"] == 2
    moved = _move(client, env, work["assignment_id"])
    assert moved.status_code == 200, moved.text
    body = moved.json()
    assert body["assignment"]["document_id"] == env.docs[1]
    assert body["round"]["kind"] == "text_change"
    assert body["round"]["round_ordinal"] is not None
    carried = _carry(client, env, done["submission_id"])
    assert carried.status_code == 200, carried.text
    assert carried.json()["resolution"] == "carried"
    assert carried.json()["round"]["kind"] == "carry_forward"


def test_error_statuses(client):
    env = _env(_app(client), [TEXT_DE, CORRECTED_DE, THIRD_DE])
    _login(client, env, "lead")
    work = _started(env)
    # A stale target: v3 arrived after the dialog opened on v2.
    assert _code(
        _move(client, env, work["assignment_id"], target_document_id=env.docs[1])
    ) == (
        409,
        "TEXT_CHANGE_CHANGED",
    )
    on_target = assign(env.scenario, env.docs[2], "ana", "annotate")
    refused = _move(client, env, on_target, request_id="on-target")
    assert _code(refused) == (422, "TEXT_CHANGE_NOT_APPLICABLE")
    assert refused.json()["details"] == {"reason": "already_on_target"}
    both = client.post(
        f"/api/v1/projects/{env.key}/text-changes/preview",
        json={
            "assignment_id": work["assignment_id"],
            "submission_id": "x",
            "target_document_id": env.docs[2],
        },
    )
    assert both.status_code == 422
    assert (
        _move(client, env, work["assignment_id"], request_id="once").status_code == 200
    )
    assert _code(
        _move(
            client,
            env,
            work["assignment_id"],
            request_id="once",
            target_document_id=env.docs[1],
        )
    ) == (409, "WORKFLOW_REQUEST_CONFLICT")

    held = _started(env, "eva")
    with env.db.transaction() as conn:
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == held["assignment_id"])
            .values(held=True, hold_reason="problem_report")
        )
    assert _code(_move(client, env, held["assignment_id"], request_id="held")) == (
        409,
        "TASK_HELD",
    )

    done = _submitted(env, "tom")
    assert _code(
        _carry(
            client, env, done["submission_id"], mode="other", username=env.user("eva")
        )
    ) == (422, "HANDOVER_NOT_INDEPENDENT")
    with env.db.transaction() as conn:
        from test_text_change_service import CASE, _pid

        from ontocurator.domain.work_plans import OFF, RowKey
        from ontocurator.storage import work_plan_store

        work_plan_store.write_rows(
            conn, _pid(env), {RowKey(CASE, "de"): OFF}, actor_id=None
        )
    assert _code(_carry(client, env, done["submission_id"], request_id="off")) == (
        409,
        "NOT_IN_WORK_PLAN",
    )


def test_language_confirmation_for_carry_other(client):
    env = _env(_app(client))
    add_user(env.scenario, "max", ["annotator"], languages=("en",))
    done = _submitted(env)
    _login(client, env, "lead")
    refused = _carry(
        client, env, done["submission_id"], mode="other", username=env.user("max")
    )
    assert _code(refused) == (409, "LANGUAGE_CONFIRMATION_REQUIRED")
    confirmed = _carry(
        client,
        env,
        done["submission_id"],
        mode="other",
        username=env.user("max"),
        confirm_language=True,
        request_id="carry-2",
    )
    assert confirmed.status_code == 200, confirmed.text
    body = confirmed.json()
    assert body["resolution"] == "handed_over"
    assert body["round"]["kind"] == "handover"
    assert body["assignment"]["username"] == env.user("max")


@pytest.mark.parametrize("kind", ["text_change", "handover"])
def test_generic_round_creation_does_not_offer_text_change_kinds(client, kind):
    env = _env(_app(client))
    waiting = assign(env.scenario, env.docs[1], "tom", "annotate")
    _login(client, env, "lead")
    refused = client.post(
        f"/api/v1/assignments/{waiting}/rounds",
        json={
            "request_id": f"round-{kind}",
            "expected_workflow_revision": _revision(env, waiting),
            "kind": kind,
        },
    )
    assert refused.status_code == 422, refused.text
