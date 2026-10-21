"""Consolidation start command ``POST /projects/{key}/consolidations``
(acceptance fixes spec "WP-B > Start command", T3, T17, U4).

One lead-only transaction: members lock EXCLUSIVE, then the project lock;
an acting lead without the Adjudicator role gets it (audited, no session
ends); the review assignment is created or reused with the checks of
``createAssignments``; then the consolidation round; one receipt per
``request_id`` and the audit ``round.create``.
"""

from __future__ import annotations

from threading import get_ident
from typing import Any

import pytest
from auth_harness import logged_in
from sqlalchemy import event, func, select, update
from test_final_panel_api import SEIZURE, finding, span_of, submit_findings
from work_plan_support import BASE, assign, doc, plan_env

from ontocurator.application.consolidation_start import (
    ConsolidationStartService,
    StartConsolidation,
)
from ontocurator.auth.audit import Actor
from ontocurator.authz.policy import Access
from ontocurator.domain.errors import DomainError
from ontocurator.storage.repository import _lock_id
from ontocurator.storage.tables import (
    AssignmentRow,
    AuditEventRow,
    ProjectMembershipRow,
    ProjectRow,
    UserRow,
)
from ontocurator.storage.workflow_tables import (
    WorkflowCommandReceiptRow,
    WorkRoundRow,
)

FIRST = "sub-first-start"
SECOND = "sub-second-start"
URL = f"{BASE}/consolidations"


@pytest.fixture
def env(tmp_path):
    """Two annotation submissions on c1-en (Anne, Arne); the lead ``leader``
    has no Adjudicator role; ``adj`` has it."""
    env = plan_env(tmp_path)
    target = doc("c1", "en")
    seizure = span_of(env, target, "Neonatalzeit")
    submit_findings(
        env,
        assign(env, target, "anno", "annotate"),
        FIRST,
        [finding("a1", SEIZURE, seizure)],
    )
    submit_findings(
        env,
        assign(env, target, "anno2", "annotate"),
        SECOND,
        [finding("b1", SEIZURE, seizure)],
    )
    env.target = target
    return env


def body(env: Any, reviewer: str = "leader", **extra: Any) -> dict[str, Any]:
    return {
        "document_id": env.target,
        "reviewer": reviewer,
        "source_submission_ids": [FIRST, SECOND],
        "reason": None,
        "confirm_language": True,
        "request_id": "start-1",
        "expected_workflow_revision": None,
    } | extra


def user_id(env: Any, username: str) -> int:
    return int(env.app.state.accounts.get_by_username(username).id)


def roles(env: Any, username: str) -> set[str]:
    with env.db.transaction() as conn:
        return set(
            conn.execute(
                select(ProjectMembershipRow.role).where(
                    ProjectMembershipRow.project_id == env.pid,
                    ProjectMembershipRow.user_id == user_id(env, username),
                )
            ).scalars()
        )


def audits(env: Any, action: str) -> list[dict[str, Any]]:
    with env.db.transaction() as conn:
        return [
            dict(row)
            for row in conn.execute(
                select(AuditEventRow.details, AuditEventRow.target_id)
                .where(
                    AuditEventRow.action == action,
                    AuditEventRow.project_id == env.pid,
                )
                .order_by(AuditEventRow.id)
            ).mappings()
        ]


def adjudicator_grants(env: Any, username: str) -> list[dict[str, Any]]:
    return [
        a
        for a in audits(env, "project.member_add")
        if a["target_id"] == username and "adjudicator" in a["details"]["roles"]
    ]


def review_assignments(env: Any, username: str) -> list[Any]:
    with env.db.transaction() as conn:
        return list(
            conn.execute(
                select(AssignmentRow.id, AssignmentRow.workflow_revision).where(
                    AssignmentRow.project_id == env.pid,
                    AssignmentRow.user_id == user_id(env, username),
                    AssignmentRow.task == "review",
                    AssignmentRow.revoked_at.is_(None),
                )
            )
        )


def consolidation_rounds(env: Any) -> list[Any]:
    with env.db.transaction() as conn:
        return list(
            conn.execute(
                select(WorkRoundRow.round_id, WorkRoundRow.annotator_id).where(
                    WorkRoundRow.project_id == env.pid,
                    WorkRoundRow.kind == "consolidation",
                )
            )
        )


def receipts(env: Any) -> int:
    with env.db.transaction() as conn:
        return int(
            conn.execute(
                select(func.count())
                .select_from(WorkflowCommandReceiptRow)
                .where(WorkflowCommandReceiptRow.project_id == env.pid)
            ).scalar_one()
        )


def assert_nothing_written(env: Any, username: str = "leader") -> None:
    assert "adjudicator" not in roles(env, username)
    assert review_assignments(env, username) == []
    assert consolidation_rounds(env) == []
    assert receipts(env) == 0
    assert audits(env, "round.create") == []
    assert adjudicator_grants(env, username) == []


def test_lead_self_grant_creates_assignment_and_round_and_keeps_session(env):
    response = env.lead.post(URL, json=body(env))
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["role_granted"] is True
    started = result["round"]
    assert started["kind"] == "consolidation"
    assert started["state"] == "editable"
    leader = env.app.state.accounts.get_by_username("leader")
    assert started["annotator_id"] == leader.pseudonym
    assert started["input_submission_ids"] == [FIRST, SECOND]
    assert roles(env, "leader") == {"lead", "adjudicator"}
    [granted] = adjudicator_grants(env, "leader")
    assert granted["details"] == {"username": "leader", "roles": ["adjudicator"]}
    [assignment] = review_assignments(env, "leader")
    assert assignment.workflow_revision == 1
    [created] = audits(env, "round.create")
    assert created["target_id"] == started["round_id"]
    assert created["details"]["kind"] == "consolidation"
    assert created["details"]["assignment_id"] == assignment.id
    assert created["details"]["sources"] == [FIRST, SECOND]
    assert receipts(env) == 1
    # The additive self-grant ends no session: the same cookie still works
    # and already sees the new task.
    tasks = env.lead.get("/api/v1/me/tasks")
    assert tasks.status_code == 200, tasks.text
    assert [t["assignment_id"] for t in tasks.json() if t["task"] == "review"] == [
        assignment.id
    ]
    read = env.lead.get(f"/api/v1/rounds/{started['round_id']}/consolidation")
    assert read.status_code == 200, read.text
    assert read.json()["read_only"] is False


def test_same_request_id_answers_the_stored_response(env):
    first = env.lead.post(URL, json=body(env))
    assert first.status_code == 200, first.text
    again = env.lead.post(URL, json=body(env))
    assert again.status_code == 200, again.text
    assert again.json() == first.json()
    assert len(consolidation_rounds(env)) == 1
    assert len(review_assignments(env, "leader")) == 1
    assert len(audits(env, "round.create")) == 1
    assert len(adjudicator_grants(env, "leader")) == 1
    other = env.lead.post(URL, json=body(env, reason="different"))
    assert other.status_code == 409, other.text
    assert other.json()["code"] == "WORKFLOW_REQUEST_CONFLICT"


def test_another_member_with_the_role_gets_no_grant(env):
    before = audits(env, "project.member_add")
    response = env.lead.post(URL, json=body(env, reviewer="adj"))
    assert response.status_code == 200, response.text
    assert response.json()["role_granted"] is False
    adj = env.app.state.accounts.get_by_username("adj")
    assert response.json()["round"]["annotator_id"] == adj.pseudonym
    assert audits(env, "project.member_add") == before
    assert "adjudicator" not in roles(env, "leader")


def test_another_member_without_the_role_is_refused_without_grant(env):
    response = env.lead.post(URL, json=body(env, reviewer="ana"))
    assert response.status_code in {403, 409, 422}, response.text
    assert response.json()["code"] == "ASSIGNEE_ROLE_MISSING"
    assert "adjudicator" not in roles(env, "ana")
    assert review_assignments(env, "ana") == []
    assert consolidation_rounds(env) == []


def test_lead_who_annotated_an_input_is_refused_and_not_granted(env):
    with env.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.id == env.pid)
            .values(adjudicator_not_annotator=True)
        )
    lead = logged_in(
        env.app, "leader", projects={"proj": ["lead", "annotator"]}, assignments=[]
    )
    seizure = span_of(env, env.target, "Neonatalzeit")
    submit_findings(
        env,
        assign(env, env.target, "leader", "annotate"),
        "sub-lead-start",
        [finding("l1", SEIZURE, seizure)],
    )
    member_adds = audits(env, "project.member_add")
    response = lead.post(
        URL,
        json=body(env, source_submission_ids=[FIRST, "sub-lead-start"]),
    )
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "ADJUDICATOR_IS_ANNOTATOR"
    assert roles(env, "leader") == {"lead", "annotator"}
    assert review_assignments(env, "leader") == []
    assert consolidation_rounds(env) == []
    assert receipts(env) == 0
    assert audits(env, "project.member_add") == member_adds


def test_missing_language_needs_the_confirmation(env):
    refused = env.lead.post(URL, json=body(env, confirm_language=False))
    assert refused.status_code == 409, refused.text
    assert refused.json()["code"] == "LANGUAGE_CONFIRMATION_REQUIRED"
    assert_nothing_written(env)
    confirmed = env.lead.post(URL, json=body(env, confirm_language=True))
    assert confirmed.status_code == 200, confirmed.text


@pytest.mark.parametrize(
    ("username", "roles_", "status", "code"),
    [
        ("anno", ["annotator"], 403, "NOT_ALLOWED"),
        ("adj", ["adjudicator"], 403, "NOT_ALLOWED"),
        ("outsider", [], 404, "PROJECT_NOT_FOUND"),
    ],
)
def test_non_lead_is_refused_like_create_assignments(
    env, username, roles_, status, code
):
    client = logged_in(
        env.app,
        username,
        projects={"proj": roles_} if roles_ else None,
        assignments=[],
    )
    response = client.post(URL, json=body(env, reviewer=username))
    assert response.status_code == status, response.text
    assert response.json()["code"] == code
    assert consolidation_rounds(env) == []
    compare = client.post(
        f"{BASE}/assignments",
        json={
            "rows": [{"document_id": env.target, "username": username}],
            "task": "review",
        },
    )
    assert (compare.status_code, compare.json()["code"]) == (status, code)


def test_stale_revision_is_a_conflict(env):
    first = env.lead.post(URL, json=body(env, reviewer="adj"))
    assert first.status_code == 200, first.text
    [assignment] = review_assignments(env, "adj")
    # A new request must name the current revision of the existing assignment.
    for expected in (None, assignment.workflow_revision - 1):
        stale = env.lead.post(
            URL,
            json=body(
                env,
                reviewer="adj",
                request_id=f"stale-{expected}",
                expected_workflow_revision=expected,
            ),
        )
        assert stale.status_code == 409, stale.text
        assert stale.json()["code"] == "WORKFLOW_REVISION_CONFLICT"
    assert len(consolidation_rounds(env)) == 1
    # An int without an assignment of the reviewer is stale too.
    missing = env.lead.post(
        URL, json=body(env, request_id="no-assignment", expected_workflow_revision=0)
    )
    assert missing.status_code == 409, missing.text
    assert missing.json()["code"] == "WORKFLOW_REVISION_CONFLICT"
    assert_nothing_written_for_leader(env)


def assert_nothing_written_for_leader(env: Any) -> None:
    assert "adjudicator" not in roles(env, "leader")
    assert review_assignments(env, "leader") == []


def test_current_revision_of_an_existing_assignment_is_used(env):
    review = assign(env, env.target, "adj", "review")
    response = env.lead.post(
        URL, json=body(env, reviewer="adj", expected_workflow_revision=0)
    )
    assert response.status_code == 200, response.text
    assert response.json()["round"]["assignment_id"] == review
    assert review_assignments(env, "adj")[0].workflow_revision == 1


def test_short_source_list_is_a_validation_error(env):
    response = env.lead.post(URL, json=body(env, source_submission_ids=[FIRST]))
    assert response.status_code == 422, response.text
    assert consolidation_rounds(env) == []


def test_lock_order_members_exclusive_then_project(env):
    """Members EXCLUSIVE (as membership writes), then the project lock (as
    ``AssignmentService._prepare``): a self-grant serializes with role edits."""
    leader = env.app.state.accounts.get_by_username("leader")
    access = Access(leader.id, leader.pseudonym, False, {"proj": frozenset({"lead"})})
    owner = get_ident()
    locks: list[tuple[str, Any]] = []

    def record(conn, cursor, statement, parameters, context, executemany):
        if get_ident() == owner and "pg_advisory_xact_lock" in statement:
            shared = "pg_advisory_xact_lock_shared" in statement
            values = (
                list(parameters.values())
                if isinstance(parameters, dict)
                else list(parameters)
            )
            locks.append(("shared" if shared else "exclusive", values[0]))

    event.listen(env.db.engine, "before_cursor_execute", record)
    try:
        ConsolidationStartService(env.db).start(
            Actor.user(leader.id, "leader"),
            access,
            "proj",
            StartConsolidation.model_validate(body(env)),
        )
    finally:
        event.remove(env.db.engine, "before_cursor_execute", record)
    assert locks[:2] == [
        ("exclusive", _lock_id("members", "proj")),
        ("exclusive", _lock_id("project", "proj")),
    ]


def test_service_refuses_a_lead_demoted_meanwhile(env):
    """Authority is re-checked under the locks, not taken from the request."""
    leader = env.app.state.accounts.get_by_username("leader")
    access = Access(leader.id, leader.pseudonym, False, {"proj": frozenset({"lead"})})
    with env.db.transaction() as conn:
        conn.execute(
            ProjectMembershipRow.__table__.delete().where(
                ProjectMembershipRow.project_id == env.pid,
                ProjectMembershipRow.user_id == leader.id,
            )
        )
    with pytest.raises(DomainError) as caught:
        ConsolidationStartService(env.db).start(
            Actor.user(leader.id, "leader"),
            access,
            "proj",
            StartConsolidation.model_validate(body(env)),
        )
    assert caught.value.code in {"PROJECT_NOT_FOUND", "NOT_ALLOWED"}
    with env.db.transaction() as conn:
        assert (
            conn.execute(
                select(func.count())
                .select_from(UserRow)
                .join(ProjectMembershipRow, ProjectMembershipRow.user_id == UserRow.id)
                .where(UserRow.id == leader.id)
            ).scalar_one()
            == 0
        )
