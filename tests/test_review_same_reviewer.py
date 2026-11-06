"""Issue 340: the same reviewer reviews a rejected translation again."""

from typing import Any

import pytest
from auth_harness import HARNESS, logged_in
from browser_server import TEST_PASSWORD
from fastapi.testclient import TestClient
from sqlalchemy import select
from test_browser_lead_workflow_fixture import client as client
from test_browser_lead_workflow_fixture import lead_rows, scenario
from test_lead_correction import decide, lead
from test_translation_review_service import review_env as review_env
from test_translation_review_service import save

from ontotator.assignments.service import AssignmentService
from ontotator.domain.errors import DomainError
from ontotator.storage.tables import AssignmentRow, DocumentRow

CORRECTED = "Übersetzt, korrigiert"


@pytest.fixture(params=["rejected", "query"])
def decided(review_env: Any, request: pytest.FixtureRequest) -> Any:
    """Alice rejected (or queried) ``target``; Bob's review was removed."""
    AssignmentService(review_env.db).revoke(HARNESS, review_env.ids["bob"])
    decide(review_env, request.param)
    return review_env


def versions(env: Any) -> list[tuple[str, int, str | None]]:
    with env.db.transaction() as conn:
        return [
            (row.document_id, row.version, row.translation_status)
            for row in conn.execute(
                select(
                    DocumentRow.document_id,
                    DocumentRow.version,
                    DocumentRow.translation_status,
                )
                .where(
                    DocumentRow.language == "de", DocumentRow.external_id == "target"
                )
                .order_by(DocumentRow.version)
            )
        ]


def test_assigning_the_same_reviewer_again_is_refused_with_a_reopen_hint(decided):
    env = decided
    with pytest.raises(DomainError) as refused:
        AssignmentService(env.db).assign(
            lead(env),
            "proj",
            "target",
            "alice",
            "translation_review",
            confirm_language=True,
        )
    assert refused.value.code == "ASSIGNMENT_ALREADY_SUBMITTED"
    assert refused.value.details == {
        "assignment_id": env.ids["alice"],
        "hint": "reopen",
    }
    # Nothing changed: still Alice's one submitted review.
    with env.db.transaction() as conn:
        rows = conn.execute(
            select(AssignmentRow.id, AssignmentRow.status).where(
                AssignmentRow.user_id == env.accesses["alice"].user_id,
                AssignmentRow.revoked_at.is_(None),
            )
        ).all()
    assert [tuple(row) for row in rows] == [(env.ids["alice"], "submitted")]


def test_the_assign_api_reports_the_refusal_per_row(decided):
    client = logged_in(decided.app, "leader")
    response = client.post(
        "/api/v1/projects/proj/assignments",
        json={
            "task": "translation_review",
            "rows": [{"document_id": "target", "username": "alice"}],
            "confirm_language": True,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["created"] == []
    assert [row["code"] for row in response.json()["refused"]] == [
        "ASSIGNMENT_ALREADY_SUBMITTED"
    ]


def test_an_open_assignment_stays_idempotent(review_env):
    env = review_env
    again = AssignmentService(env.db).assign(
        lead(env),
        "proj",
        "target",
        "alice",
        "translation_review",
        confirm_language=True,
    )
    assert again.id == env.ids["alice"] and again.status == "open"


def test_reopen_same_reviewer_then_accept_with_corrections_creates_v2(decided):
    env = decided
    # The rejected review's draft carried a decision and possibly edited text.
    reopened = AssignmentService(env.db).reopen(
        lead(env), env.ids["alice"], reason="Please look again"
    )
    assert reopened.status == "reopened"
    workspace = env.service.open(env.accesses["alice"], env.ids["alice"])
    assert not workspace.read_only
    # The draft starts from the version's current text, with an empty form.
    assert workspace.draft.text == workspace.text == "Übersetzt"
    assert workspace.draft.form == {}
    revision = save(
        env,
        "accepted_corrected",
        text=CORRECTED,
        clinical_change=True,
        categories=["omission"],
        rationale="Fixed",
    )
    record = env.service.submit(
        env.accesses["alice"], env.ids["alice"], expected_revision=revision
    )
    assert record.decision == "accepted_corrected"
    assert record.created_variant_id is not None
    assert [(v, s) for _, v, s in versions(env)] == [(1, "reviewed"), (2, "accepted")]


def test_a_draft_token_from_before_the_reopen_conflicts(decided):
    env = decided
    stale = env.service.open(env.accesses["alice"], env.ids["alice"]).draft.revision
    AssignmentService(env.db).reopen(lead(env), env.ids["alice"])
    with pytest.raises(DomainError, match="REVISION_CONFLICT"):
        env.service.save_draft(
            env.accesses["alice"],
            env.ids["alice"],
            expected_revision=stale,
            text="Übersetzt",
            form={},
        )


# -- Resolve… > Assign a new review… (the row dialog's batch API) -------------


def lead_session(client: TestClient, built: dict[str, Any]) -> dict[str, str]:
    origin = str(client.base_url).rstrip("/")
    login = client.post(
        "/api/v1/auth/login",
        json={"username": built["users"]["lead"], "password": TEST_PASSWORD},
        headers={"Origin": origin},
    )
    assert login.status_code == 200, login.text
    return {"Origin": origin, "X-CSRF-Token": login.json()["csrf_token"]}


def batch(client: TestClient, built: dict[str, Any], who: str) -> tuple[Any, Any]:
    """Preview and commit "Assign a new review…" of the rejected case to ``who``."""
    headers = lead_session(client, built)
    base = f"/api/v1/projects/{built['project']}/assignments/batch"
    body = {
        "task": "translation_review",
        "language": "de",
        "case_ids": [built["cases"]["rejected"]],
        "mode": "one",
        "usernames": [built["users"][who]],
    }
    preview = client.post(f"{base}/preview", json=body, headers=headers)
    assert preview.status_code == 200, preview.text
    commit = client.post(
        base,
        json={**body, "expected_preview_digest": preview.json()["digest"]},
        headers=headers,
    )
    return preview.json(), commit


def rejected_row(client: TestClient, built: dict[str, Any]) -> dict[str, Any]:
    return lead_rows(client, built)[1][(built["cases"]["rejected"], "de")]


def test_a_new_review_of_a_rejected_translation_goes_to_another_reviewer(client):
    built = scenario(client, "REJECTED_TRANSLATION_FOR_LEAD")
    preview, commit = batch(client, built, "ben")
    (target,) = preview["targets"]
    assert target["version"] == 1 and preview["skipped"] == []
    assert commit.status_code == 200, commit.text
    (created,) = commit.json()["created"]
    assert created["username"] == built["users"]["ben"]
    row = rejected_row(client, built)
    assert row["next_step"]["code"] == "translation_review_in_progress"


def test_the_batch_skips_the_reviewer_who_already_submitted(client):
    built = scenario(client, "REJECTED_TRANSLATION_FOR_LEAD")
    preview, commit = batch(client, built, "ana")
    assert preview["targets"] == []
    assert [item["reason"] for item in preview["skipped"]] == ["already_assigned"]
    people = {item["username"]: item for item in preview["people"]}
    assert people[built["users"]["ana"]]["already_assigned"] == 1
    # Skipped, not refused: the batch succeeds without assigning.
    assert commit.status_code == 200, commit.text
    assert commit.json()["created"] == []
    # Reopening her review is the way: the row shows the review in progress.
    (work,) = rejected_row(client, built)["work"]
    headers = lead_session(client, built)
    reopened = client.post(
        f"/api/v1/assignments/{work['assignment_id']}/reopen",
        json={"reason": "Please check the dosage again"},
        headers=headers,
    )
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["status"] == "reopened"
    row = rejected_row(client, built)
    assert row["next_step"]["code"] == "translation_review_in_progress"
    assert [(item["status"], item["assignment_id"]) for item in row["work"]] == [
        ("reopened", work["assignment_id"])
    ]
