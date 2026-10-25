"""A lead corrects a rejected or queried translation themselves (spec F1)."""

from datetime import UTC, datetime
from typing import Any

import pytest
from auth_harness import HARNESS, logged_in
from sqlalchemy import delete, insert, select, update
from test_translation_review_service import review_env as review_env
from test_translation_review_service import save
from work_plan_support import flags_of, revision_of, write

from ontocurator.application.translation_workflow import TranslationWorkflowService
from ontocurator.assignments.service import AssignmentService
from ontocurator.auth.audit import Actor
from ontocurator.authz.memberships import MembershipService
from ontocurator.authz.policy import TASK_ROLES
from ontocurator.domain.errors import DomainError
from ontocurator.domain.work_plans import PlanFlags, RowKey
from ontocurator.storage.plan_tables import DiscardedVariantRow
from ontocurator.storage.tables import (
    AssignmentRow,
    AuditEventRow,
    DocumentRow,
    ProjectMembershipRow,
    ProjectRow,
    UserLanguageRow,
    UserRow,
)

BASE = "/api/v1/projects/proj"


def lead(env: Any) -> Actor:
    return Actor.user(env.accesses["leader"].user_id, "leader")


def workflow(env: Any) -> TranslationWorkflowService:
    return TranslationWorkflowService(env.db, env.app.state.jobs)


def decide(env: Any, decision: str) -> None:
    """Alice submits ``decision`` on ``target`` (a clinical change for not-accepted)."""
    form = (
        {"clinical_change": True, "categories": ["omission"], "rationale": "Missing"}
        if decision in ("rejected", "query")
        else {}
    )
    revision = save(env, decision, **form)
    env.service.submit(
        env.accesses["alice"], env.ids["alice"], expected_revision=revision
    )


def target_hash(env: Any, document_id: str = "target") -> str:
    return env.app.state.repo.get_variant("proj", document_id).text_sha256


def start(env: Any, document_id: str = "target", **kwargs: Any):
    kwargs.setdefault("expected_text_sha256", target_hash(env, document_id))
    kwargs.setdefault("confirm_language", True)
    return workflow(env).start_lead_correction(lead(env), "proj", document_id, **kwargs)


def submit_as_lead(env: Any, assignment_id: int, decision: str, text: str, **form):
    access = env.accesses["leader"]
    opened = env.service.open(access, assignment_id)
    revision = env.service.save_draft(
        access,
        assignment_id,
        expected_revision=opened.draft.revision,
        text=text,
        form={"decision": decision, "clinical_change": False, **form},
    )
    return env.service.submit(access, assignment_id, expected_revision=revision)


def audits(env: Any, action: str) -> list[dict[str, Any]]:
    with env.db.transaction() as conn:
        return [
            dict(details)
            for details in conn.execute(
                select(AuditEventRow.details)
                .where(AuditEventRow.action == action)
                .order_by(AuditEventRow.id)
            ).scalars()
        ]


@pytest.fixture
def rejected(review_env):
    """``target`` rejected by Alice; Bob's open review withdrawn."""
    AssignmentService(review_env.db).revoke(HARNESS, review_env.ids["bob"])
    decide(review_env, "rejected")
    return review_env


def test_lead_starts_correction_of_rejected_version(rejected):
    env = rejected
    assignment = start(env)
    assert assignment.lead_correction is True
    assert assignment.task == "translation_review"
    assert assignment.user_id == env.accesses["leader"].user_id
    assert assignment.status == "open"
    (audit,) = audits(env, "translation.lead_correction_started")
    assert audit == {
        "document_id": "target",
        "text_sha256": target_hash(env),
        "assignment_id": assignment.id,
    }
    tasks = AssignmentService(env.db).my_tasks(env.accesses["leader"].user_id)
    assert [(t.assignment_id, t.task) for t in tasks] == [
        (assignment.id, "translation_review")
    ]
    opened = env.service.open(env.accesses["leader"], assignment.id)
    assert opened.lead_correction is True
    assert opened.text == "Übersetzt"
    response = logged_in(env.app, "leader").get(
        f"/api/v1/translation-reviews/{assignment.id}"
    )
    assert response.status_code == 200, response.text
    assert response.json()["lead_correction"] is True


def test_start_is_idempotent_for_the_same_lead(rejected):
    env = rejected
    first = start(env)
    again = start(env)
    assert again == first
    assert len(audits(env, "translation.lead_correction_started")) == 1


def test_lead_submits_accepted_corrected_creates_accepted_child(rejected):
    env = rejected
    assignment = start(env)
    record = submit_as_lead(env, assignment.id, "accepted_corrected", "Korrigiert")
    assert record.reviewer_user_id == env.accesses["leader"].user_id
    assert record.decision == "accepted_corrected"
    child = env.app.state.repo.get_variant("proj", record.created_variant_id)
    assert child.origin == "correction"
    assert child.derived_from == "target"
    assert child.translation_status == "accepted"
    parent = env.app.state.repo.get_variant("proj", "target")
    assert parent.translation_status == "reviewed"


@pytest.mark.parametrize("decision", ["accepted_unchanged", "query", "rejected"])
def test_other_decisions_are_refused(rejected, decision):
    env = rejected
    assignment = start(env)
    form = (
        {"clinical_change": True, "categories": ["omission"], "rationale": "Why"}
        if decision != "accepted_unchanged"
        else {}
    )
    text = "Übersetzt" if decision == "accepted_unchanged" else "Anders"
    with pytest.raises(DomainError) as caught:
        submit_as_lead(env, assignment.id, decision, text, **form)
    assert caught.value.code == "REVIEW_INVALID"
    assert caught.value.details == {"issues": ["LEAD_CORRECTION_DECISION"]}


def test_child_is_assignable_for_annotation(rejected):
    env = rejected
    with env.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == "proj")
            .values(annotate_accepted_translations_only=True)
        )
        # The parallel root must be accepted too (all roots, as next steps).
        conn.execute(
            update(DocumentRow)
            .where(DocumentRow.document_id == "comparison")
            .values(translation_status="accepted")
        )
    assignment = start(env)
    record = submit_as_lead(env, assignment.id, "accepted_corrected", "Korrigiert")
    created = AssignmentService(env.db).assign(
        HARNESS,
        "proj",
        record.created_variant_id,
        "bob",
        "annotate",
        confirm_language=True,
    )
    assert created.document_id == record.created_variant_id


def _accepted(env: Any) -> None:
    AssignmentService(env.db).revoke(HARNESS, env.ids["bob"])
    decide(env, "accepted_unchanged")


def _pending(env: Any) -> None:
    pass


def _older(env: Any) -> None:
    AssignmentService(env.db).revoke(HARNESS, env.ids["bob"])
    decide(env, "rejected")
    first = start(env)
    submit_as_lead(env, first.id, "accepted_corrected", "Korrigiert")


def _open_review(env: Any) -> None:
    decide(env, "rejected")  # Bob's review stays open


@pytest.mark.parametrize(
    ("setup", "reason"),
    [
        (_accepted, "not_rejected_or_queried"),
        (_pending, "not_rejected_or_queried"),
        (_older, "not_newest"),
        (_open_review, "review_open"),
    ],
)
def test_refusals(review_env, setup, reason):
    env = review_env
    setup(env)
    with pytest.raises(DomainError) as caught:
        start(env)
    assert caught.value.code == "LEAD_CORRECTION_NOT_AVAILABLE"
    assert caught.value.details == {"reason": reason}


def test_refusals_stale_hash_and_discarded(rejected):
    env = rejected
    with pytest.raises(DomainError, match="VARIANT_REVIEW_STALE"):
        start(env, expected_text_sha256="0" * 64)
    with env.db.transaction() as conn:
        conn.execute(
            insert(DiscardedVariantRow).values(
                project_id=env.pid,
                document_id="target",
                reason="Wrong text",
                discarded_by=env.accesses["leader"].user_id,
                discarded_at=datetime(2026, 10, 20, tzinfo=UTC),
            )
        )
    # Refused before the language prompt (no confirmation offered for it).
    with pytest.raises(DomainError, match="NOT_IN_WORK_PLAN"):
        start(env, confirm_language=False)


def test_refusals_annotator_caller_is_refused(rejected):
    env = rejected
    client = logged_in(env.app, "alice")
    response = client.post(
        f"{BASE}/documents/target/lead-correction",
        json={"expected_text_sha256": target_hash(env), "confirm_language": True},
    )
    assert response.status_code == 403, response.text
    assert response.json()["code"] == "NOT_ALLOWED"


def test_route_starts_the_lead_correction(rejected):
    env = rejected
    client = logged_in(env.app, "leader")
    body = {"expected_text_sha256": target_hash(env)}
    refused = client.post(f"{BASE}/documents/target/lead-correction", json=body)
    assert refused.status_code == 409, refused.text
    assert refused.json()["code"] == "LANGUAGE_CONFIRMATION_REQUIRED"
    response = client.post(
        f"{BASE}/documents/target/lead-correction",
        json={**body, "confirm_language": True},
    )
    assert response.status_code == 200, response.text
    view = response.json()
    assert view["lead_correction"] is True
    assert view["task"] == "translation_review"
    assert view["username"] == "leader"
    decide_again = client.post(
        f"{BASE}/documents/target/lead-correction",
        json={**body, "confirm_language": True},
    )
    assert decide_again.json()["id"] == view["id"]


def test_route_maps_not_available_to_409(review_env):
    env = review_env
    client = logged_in(env.app, "leader")
    response = client.post(
        f"{BASE}/documents/target/lead-correction",
        json={"expected_text_sha256": target_hash(env), "confirm_language": True},
    )
    assert response.status_code == 409, response.text
    assert response.json() == {
        "code": "LEAD_CORRECTION_NOT_AVAILABLE",
        "details": {"reason": "not_rejected_or_queried"},
    }


def test_review_off_is_turned_on(rejected):
    env = rejected
    write(env, {RowKey("case", "de"): PlanFlags(False, True)})
    revision = revision_of(env, "case")
    before = len(audits(env, "work_plan.update"))
    start(env)
    assert flags_of(env, "case", "de") == PlanFlags(True, True)
    assert revision_of(env, "case") == revision + 1
    (audit,) = audits(env, "work_plan.update")[before:]
    assert audit["withdrawn"] == []


def test_review_on_changes_no_plan(rejected):
    env = rejected
    revision = revision_of(env, "case")
    before = len(audits(env, "work_plan.update"))
    start(env)
    assert revision_of(env, "case") == revision
    assert len(audits(env, "work_plan.update")) == before


def test_language_and_qualification_checked_at_start(rejected):
    env = rejected
    with pytest.raises(DomainError) as caught:
        start(env, confirm_language=False)
    assert caught.value.code == "LANGUAGE_CONFIRMATION_REQUIRED"
    assert caught.value.details["required_languages"] == ["de", "en"]
    with env.db.transaction() as conn:
        conn.execute(
            insert(UserLanguageRow).values(
                user_id=env.accesses["leader"].user_id, language="en"
            )
        )
        conn.execute(
            update(UserRow)
            .where(UserRow.id == env.accesses["leader"].user_id)
            .values(qualification="  ")
        )
    with pytest.raises(DomainError, match="QUALIFICATION_REQUIRED"):
        start(env, confirm_language=False)
    with env.db.transaction() as conn:
        conn.execute(
            update(UserRow)
            .where(UserRow.id == env.accesses["leader"].user_id)
            .values(qualification="Physician")
        )
    assert start(env, confirm_language=False).lead_correction


def test_authority_ends_with_lead_role(rejected):
    env = rejected
    assignment = start(env)
    leader = env.accesses["leader"].user_id
    with env.db.transaction() as conn:
        conn.execute(
            delete(ProjectMembershipRow).where(ProjectMembershipRow.user_id == leader)
        )
        conn.execute(
            insert(ProjectMembershipRow).values(
                project_id=env.pid, user_id=leader, role="adjudicator"
            )
        )
    with pytest.raises(DomainError, match="ASSIGNMENT_NOT_FOUND"):
        env.service.open(env.accesses["leader"], assignment.id)
    assert AssignmentService(env.db).my_tasks(leader) == []


def test_lead_is_not_offered_as_translation_reviewer(rejected):
    env = rejected
    assert TASK_ROLES["translation_review"] == frozenset({"annotator"})
    with pytest.raises(DomainError, match="ASSIGNEE_ROLE_MISSING"):
        AssignmentService(env.db).assign(
            HARNESS,
            "proj",
            "target",
            "leader",
            "translation_review",
            confirm_language=True,
        )
    # An ordinary review row of a lead (no flag) grants no authority.
    with env.db.transaction() as conn:
        plain = conn.execute(
            insert(AssignmentRow)
            .values(
                project_id=env.pid,
                document_id="comparison",
                user_id=env.accesses["leader"].user_id,
                task="translation_review",
                status="open",
            )
            .returning(AssignmentRow.id)
        ).scalar_one()
    with pytest.raises(DomainError, match="ASSIGNMENT_NOT_FOUND"):
        env.service.open(env.accesses["leader"], plain)


def test_open_lead_correction_shows_in_progress_owned_by_lead(rejected):
    env = rejected
    client = logged_in(env.app, "leader")

    def step() -> dict[str, Any]:
        response = client.get(f"{BASE}/document-rows", params={"case": "case"})
        assert response.status_code == 200, response.text
        (row,) = [
            row
            for group in response.json()["groups"]
            for row in group["rows"]
            if row["language"] == "de"
        ]
        return row["next_step"]

    assert step()["code"] == "resolve_rejected"
    start(env)
    shown = step()
    assert shown["code"] == "translation_review_in_progress"
    assert shown["owner"]["count"] == 1
    assert shown["owner"]["person"]["pseudonym"] == env.accesses["leader"].pseudonym


def test_lead_who_rejected_as_annotator_gets_a_new_task(review_env):
    env = review_env
    service = AssignmentService(env.db)
    for name in ("alice", "bob"):
        service.revoke(HARNESS, env.ids[name])
    leader = env.accesses["leader"]
    with env.db.transaction() as conn:
        conn.execute(
            insert(ProjectMembershipRow).values(
                project_id=env.pid, user_id=leader.user_id, role="annotator"
            )
        )
    review = service.assign(
        HARNESS, "proj", "target", "leader", "translation_review", confirm_language=True
    )
    submit_as_lead(
        env,
        review.id,
        "rejected",
        "Übersetzt",
        clinical_change=True,
        categories=["omission"],
        rationale="Missing",
    )
    correction = start(env)
    assert correction.id != review.id and correction.lead_correction
    with env.db.transaction() as conn:
        revoked = conn.execute(
            select(AssignmentRow.revoked_at).where(AssignmentRow.id == review.id)
        ).scalar_one()
    assert revoked is not None
    record = submit_as_lead(env, correction.id, "accepted_corrected", "Korrigiert")
    assert record.assignment_id == correction.id


def _make_annotator(env: Any) -> None:
    with env.db.transaction() as conn:
        conn.execute(
            insert(ProjectMembershipRow).values(
                project_id=env.pid,
                user_id=env.accesses["leader"].user_id,
                role="annotator",
            )
        )


@pytest.mark.parametrize("annotator", [False, True])
def test_submitted_correction_cannot_be_reopened(rejected, annotator):
    env = rejected
    if annotator:
        _make_annotator(env)
    assignment = start(env)
    submit_as_lead(env, assignment.id, "accepted_corrected", "Korrigiert")
    with pytest.raises(DomainError) as caught:
        AssignmentService(env.db).reopen(HARNESS, assignment.id)
    assert caught.value.code == "LEAD_CORRECTION_NOT_AVAILABLE"
    assert caught.value.details == {"reason": "not_newest"}


def test_losing_the_lead_role_revokes_the_open_correction(rejected):
    env = rejected
    correction = start(env)
    bob = env.accesses["bob"].user_id
    with env.db.transaction() as conn:
        conn.execute(
            insert(ProjectMembershipRow).values(
                project_id=env.pid, user_id=bob, role="lead"
            )
        )
    members = MembershipService(env.db)
    with pytest.raises(DomainError) as caught:
        members.remove(HARNESS, "proj", "leader", ["lead"])
    assert caught.value.code == "MEMBER_HAS_ASSIGNMENTS"
    (affected,) = caught.value.details["assignments"]
    assert affected["id"] == correction.id
    members.remove(HARNESS, "proj", "leader", ["lead"], revoke_assignments=True)
    with env.db.transaction() as conn:
        revoked = conn.execute(
            select(AssignmentRow.revoked_at).where(AssignmentRow.id == correction.id)
        ).scalar_one()
    assert revoked is not None
    second = workflow(env).start_lead_correction(
        Actor.user(bob, "bob"),
        "proj",
        "target",
        expected_text_sha256=target_hash(env),
        confirm_language=True,
    )
    assert second.lead_correction and second.user_id == bob


def test_losing_another_role_keeps_the_correction(rejected):
    env = rejected
    _make_annotator(env)
    correction = start(env)
    MembershipService(env.db).remove(HARNESS, "proj", "leader", ["annotator"])
    with env.db.transaction() as conn:
        revoked = conn.execute(
            select(AssignmentRow.revoked_at).where(AssignmentRow.id == correction.id)
        ).scalar_one()
    assert revoked is None


def _rejected_by_lead_as_annotator(env: Any) -> int:
    service = AssignmentService(env.db)
    for name in ("alice", "bob"):
        service.revoke(HARNESS, env.ids[name])
    _make_annotator(env)
    review = service.assign(
        HARNESS, "proj", "target", "leader", "translation_review", confirm_language=True
    )
    submit_as_lead(
        env,
        review.id,
        "rejected",
        "Übersetzt",
        clinical_change=True,
        categories=["omission"],
        rationale="Missing",
    )
    return review.id


def test_paused_earlier_review_is_not_revoked(review_env):
    env = review_env
    review = _rejected_by_lead_as_annotator(env)
    with env.db.transaction() as conn:
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == review)
            .values(held=True, hold_reason="Wait")
        )
    with pytest.raises(DomainError) as caught:
        start(env)
    assert caught.value.code == "TASK_HELD"
    with env.db.transaction() as conn:
        revoked = conn.execute(
            select(AssignmentRow.revoked_at).where(AssignmentRow.id == review)
        ).scalar_one()
    assert revoked is None
    assert audits(env, "translation.lead_correction_started") == []


@pytest.mark.parametrize("annotator", [False, True])
def test_correction_is_not_reassigned_to_the_lead(rejected, annotator):
    env = rejected
    if annotator:
        _make_annotator(env)
    correction = start(env)
    with pytest.raises(DomainError, match="ASSIGNMENT_EXISTS"):
        AssignmentService(env.db).reassign(HARNESS, correction.id, "leader")


def test_ordinary_assignment_does_not_return_the_correction(rejected):
    env = rejected
    _make_annotator(env)
    start(env)
    with pytest.raises(DomainError, match="ASSIGNMENT_EXISTS"):
        AssignmentService(env.db).assign(
            HARNESS,
            "proj",
            "target",
            "leader",
            "translation_review",
            confirm_language=True,
        )


@pytest.mark.parametrize("annotator", [False, True])
def test_problem_report_is_refused_on_a_correction(rejected, annotator):
    env = rejected
    if annotator:
        _make_annotator(env)
    correction = start(env)
    client = logged_in(env.app, "leader")
    response = client.post(
        f"/api/v1/assignments/{correction.id}/problem-reports",
        json={
            "request_id": "report-correction",
            "expected_workflow_revision": correction.workflow_revision,
            "round_id": None,
            "reason": "Source is wrong",
        },
    )
    assert response.status_code == 403, response.text
    assert response.json()["code"] == "NOT_ALLOWED"


def test_ordinary_review_is_refused_while_a_correction_is_open(rejected):
    env = rejected
    start(env)
    with pytest.raises(DomainError) as caught:
        AssignmentService(env.db).assign(
            HARNESS,
            "proj",
            "target",
            "bob",
            "translation_review",
            confirm_language=True,
        )
    assert caught.value.code == "ASSIGNMENT_EXISTS"
    assert caught.value.details == {"reason": "lead_correction_open"}


def test_submitted_correction_no_longer_blocks_ordinary_reviews(rejected):
    env = rejected
    correction = start(env)
    submit_as_lead(env, correction.id, "accepted_corrected", "Korrigiert")
    created = AssignmentService(env.db).assign(
        HARNESS,
        "proj",
        "target",
        "bob",
        "translation_review",
        confirm_language=True,
    )
    assert created.lead_correction is False


def test_idempotent_start_returns_a_paused_correction(rejected):
    env = rejected
    first = start(env)
    with env.db.transaction() as conn:
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == first.id)
            .values(held=True, hold_reason="Wait")
        )
    again = start(env)
    assert again.id == first.id
    assert len(audits(env, "translation.lead_correction_started")) == 1


def test_lead_starts_correction_of_queried_version(review_env):
    env = review_env
    AssignmentService(env.db).revoke(HARNESS, env.ids["bob"])
    decide(env, "query")
    client = logged_in(env.app, "leader")
    response = client.get(f"{BASE}/document-rows", params={"case": "case"})
    (row,) = [
        row
        for group in response.json()["groups"]
        for row in group["rows"]
        if row["language"] == "de"
    ]
    assert row["next_step"]["code"] == "resolve_queried"
    assignment = start(env)
    assert assignment.lead_correction is True
    record = submit_as_lead(env, assignment.id, "accepted_corrected", "Korrigiert")
    assert record.decision == "accepted_corrected"


def test_reassigned_correction_becomes_an_ordinary_review(rejected):
    env = rejected
    correction = start(env)
    moved = AssignmentService(env.db).reassign(
        HARNESS, correction.id, "bob", confirm_language=True
    )
    assert moved.user_id == env.accesses["bob"].user_id
    assert moved.task == "translation_review"
    assert moved.lead_correction is False
    with env.db.transaction() as conn:
        revoked = conn.execute(
            select(AssignmentRow.revoked_at).where(AssignmentRow.id == correction.id)
        ).scalar_one()
    assert revoked is not None


def test_withdrawn_correction_can_be_started_again(rejected):
    env = rejected
    correction = start(env)
    AssignmentService(env.db).revoke(HARNESS, correction.id)
    assert AssignmentService(env.db).my_tasks(env.accesses["leader"].user_id) == []
    again = start(env)
    assert again.id != correction.id and again.lead_correction


def test_row_work_item_flags_the_lead_correction(rejected):
    env = rejected
    _make_annotator(env)
    plain = AssignmentService(env.db).assign(
        HARNESS,
        "proj",
        "comparison",
        "leader",
        "translation_review",
        confirm_language=True,
    )
    correction = start(env)
    response = logged_in(env.app, "leader").get(
        f"{BASE}/document-rows", params={"case": "case"}
    )
    assert response.status_code == 200, response.text
    flags = {
        item["assignment_id"]: item["lead_correction"]
        for group in response.json()["groups"]
        for row in group["rows"]
        for item in row["work"]
    }
    assert flags[correction.id] is True
    assert flags[plain.id] is False


def test_ordinary_review_is_not_reopened_while_a_correction_is_open(rejected):
    env = rejected
    start(env)
    with pytest.raises(DomainError) as caught:
        AssignmentService(env.db).reopen(HARNESS, env.ids["alice"])
    assert caught.value.code == "ASSIGNMENT_EXISTS"
    assert caught.value.details == {"reason": "lead_correction_open"}
