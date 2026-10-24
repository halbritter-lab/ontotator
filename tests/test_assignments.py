"""Assignment core contracts; PostgreSQL cases require the coordinator token."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from threading import Event, get_ident
from typing import Any

import pytest
from pg_harness import database_for
from sqlalchemy import delete, event, func, insert, select, update

from ontocurator.assignments.service import (
    TASK_FOR_MODE,
    AssignmentService,
)
from ontocurator.auth.audit import Actor
from ontocurator.domain.errors import DomainError
from ontocurator.storage.database import Database
from ontocurator.storage.repository import _lock_id
from ontocurator.storage.tables import (
    AssignmentRow,
    AuditEventRow,
    DocumentRow,
    ProjectMembershipRow,
    ProjectRow,
    UserLanguageRow,
    UserRow,
)


def test_task_modes() -> None:
    assert TASK_FOR_MODE == {
        "independent": "annotate",
        "review": "review",
        "proposal_check": "annotate",
    }


def _assign(
    db: Database,
    service: AssignmentService,
    key: str,
    document_id: str,
    user: str,
    task: str,
) -> Any:
    """Task ``review`` as a consolidation start creates it (D1); others as usual."""
    if task != "review":
        return service.assign(Actor.cli(), key, document_id, user, task)  # type: ignore[arg-type]
    with db.transaction() as conn:
        project = (
            conn.execute(select(ProjectRow).where(ProjectRow.project_key == key))
            .mappings()
            .one()
        )
        target = service._target(conn, user)
        return service._assign_locked(
            conn, Actor.cli(), project, document_id, target, "review", True
        )


@pytest.fixture
def core(tmp_path: Path) -> tuple[Database, AssignmentService, int, dict[str, int]]:
    db = database_for(tmp_path / "assignments.db")
    with db.transaction() as conn:
        project = conn.execute(
            insert(ProjectRow)
            .values(
                project_key="p",
                name="Project",
                manifest={},
                manifest_sha256="m",
                task_profile={},
                task_profile_sha256="t",
            )
            .returning(ProjectRow.id)
        ).scalar_one()
        users = {}
        for i, name in enumerate(["lead", "alice", "bob", "outsider"], 1):
            users[name] = conn.execute(
                insert(UserRow)
                .values(username=name, display_name=name, pseudonym=f"ann-{i:04}")
                .returning(UserRow.id)
            ).scalar_one()
            conn.execute(
                insert(UserLanguageRow).values(user_id=users[name], language="en")
            )
        for name, role in [
            ("lead", "lead"),
            ("alice", "annotator"),
            ("bob", "annotator"),
        ]:
            conn.execute(
                insert(ProjectMembershipRow).values(
                    project_id=project, user_id=users[name], role=role
                )
            )
        for position, document in enumerate(["second", "first"]):
            conn.execute(
                insert(DocumentRow).values(
                    project_id=project,
                    document_id=document,
                    case_id=document,
                    external_id=document,
                    position=position,
                    language="en",
                    text="text",
                    text_sha256="s",
                )
            )
    return (
        db,
        AssignmentService(db, now=lambda: datetime(2026, 10, 15, tzinfo=UTC)),
        project,
        users,
    )


def test_only_members_with_task_role_can_be_assigned(core) -> None:
    _db, service, _project, _users = core
    for name, code in [("outsider", "NOT_A_MEMBER"), ("lead", "ASSIGNEE_ROLE_MISSING")]:
        with pytest.raises(DomainError, match=code):
            service.assign(Actor.cli(), "p", "first", name, "annotate")


def test_language_confirmation_and_idempotence(core) -> None:
    db, service, _project, _users = core
    with db.transaction() as conn:
        conn.execute(update(DocumentRow).values(language="de"))
    with pytest.raises(DomainError, match="LANGUAGE_CONFIRMATION_REQUIRED") as error:
        service.assign(Actor.cli(), "p", "first", "alice", "annotate")
    assert error.value.details == {
        "document_language": "de",
        "user_languages": ["en"],
        "required_languages": ["de"],
    }
    assignment = service.assign(
        Actor.cli(), "p", "first", "alice", "annotate", confirm_language=True
    )
    assert service.assign(Actor.cli(), "p", "first", "alice", "annotate") == assignment
    with db.transaction() as conn:
        assert list(
            conn.execute(
                select(AuditEventRow.action).order_by(AuditEventRow.id)
            ).scalars()
        ) == ["assignment.language_override", "assignment.create"]


@pytest.mark.parametrize(
    "first,second", [("annotate", "review"), ("review", "annotate")]
)
def test_adjudicator_exclusion_both_directions(core, first, second) -> None:
    db, service, _project, users = core
    with db.transaction() as conn:
        conn.execute(update(ProjectRow).values(adjudicator_not_annotator=True))
        conn.execute(
            insert(ProjectMembershipRow).values(
                project_id=_project, user_id=users["alice"], role="adjudicator"
            )
        )
    _assign(db, service, "p", "first", "alice", first)
    with pytest.raises(DomainError, match="ADJUDICATOR_IS_ANNOTATOR"):
        _assign(db, service, "p", "first", "alice", second)


def test_reassign_reopen_revoke_preserve_history_and_audit(core) -> None:
    db, service, _project, _users = core
    old = service.assign(Actor.cli(), "p", "first", "alice", "annotate")
    with db.transaction() as conn:
        # The replacement joins alice's submitted work, which keeps its slot.
        conn.execute(update(ProjectRow).values(annotations_per_text=2))
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == old.id)
            .values(status="submitted", last_submission_id="immutable-submission")
        )
    with pytest.raises(DomainError, match="REASSIGN_CONFIRMATION_REQUIRED"):
        service.reassign(Actor.cli(), old.id, "bob")
    reopened = service.reopen(Actor.cli(), old.id, "fix")
    assert (
        reopened.status == "reopened"
        and reopened.last_submission_id == "immutable-submission"
    )
    replacement = service.reassign(Actor.cli(), old.id, "bob", confirm_started=True)
    assert replacement.status == "open" and replacement.pseudonym == "ann-0003"
    assert replacement.last_submission_id is None
    assert (
        service.list("p", include_revoked=True)[0].last_submission_id
        == "immutable-submission"
    )
    service.revoke(Actor.cli(), replacement.id, "cancel")
    assert service.list("p") == []
    with db.transaction() as conn:
        actions = list(conn.execute(select(AuditEventRow.action)).scalars())
    assert {
        "assignment.create",
        "assignment.reopen",
        "assignment.reassign",
        "assignment.revoke",
    } <= set(actions)


def test_my_tasks_order_and_current_authority(core) -> None:
    db, service, _project, users = core
    first = service.assign(Actor.cli(), "p", "first", "alice", "annotate")
    second = service.assign(Actor.cli(), "p", "second", "alice", "annotate")
    assert [row.document_id for row in service.my_tasks(users["alice"])] == [
        "second",
        "first",
    ]
    with db.transaction() as conn:
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == first.id)
            .values(status="reopened")
        )
    assert [row.assignment_id for row in service.my_tasks(users["alice"])] == [
        first.id,
        second.id,
    ]
    with db.transaction() as conn:
        conn.execute(update(AssignmentRow).values(status="submitted"))
    with db.transaction() as conn:
        conn.execute(
            delete(ProjectMembershipRow).where(
                ProjectMembershipRow.user_id == users["alice"]
            )
        )
    assert service.my_tasks(users["alice"]) == []


def test_mutations_recheck_actor_and_target_activity(core) -> None:
    db, service, _project, users = core
    with pytest.raises(DomainError, match="NOT_ALLOWED"):
        service.assign(
            Actor.user(users["alice"], "alice"), "p", "first", "bob", "annotate"
        )
    with db.transaction() as conn:
        conn.execute(
            update(UserRow).where(UserRow.id == users["bob"]).values(active=False)
        )
    with pytest.raises(DomainError, match="ASSIGNEE_INACTIVE"):
        service.assign(
            Actor.user(users["lead"], "lead"), "p", "first", "bob", "annotate"
        )


def test_list_filters_and_active_for(core) -> None:
    db, service, project, users = core
    first = service.assign(Actor.cli(), "p", "first", "alice", "annotate")
    second = service.assign(Actor.cli(), "p", "second", "bob", "annotate")
    assert service.list("p", document_ids=[]) == []
    assert service.list("p", document_ids=["first"], user="alice") == [first]
    assert service.list("p", user=users["bob"]) == [second]
    with db.transaction() as conn:
        assert (
            service.active_for(conn, project, "first", users["alice"], "annotate")
            == first
        )
        assert (
            service.active_for(conn, project, "first", users["bob"], "annotate") is None
        )
    service.revoke(Actor.cli(), first.id, "explicit reason")
    with db.transaction() as conn:
        assert (
            service.active_for(conn, project, "first", users["alice"], "annotate")
            is None
        )
        details = conn.execute(
            select(AuditEventRow.details).where(
                AuditEventRow.action == "assignment.revoke"
            )
        ).scalar_one()
    assert details["reason"] == "explicit reason"
    assert len(service.list("p", include_revoked=True)) == 2


@pytest.mark.parametrize(
    "change,code",
    [
        ("inactive", "ASSIGNEE_INACTIVE"),
        ("role", "ASSIGNEE_ROLE_MISSING"),
        ("membership", "NOT_A_MEMBER"),
    ],
)
def test_duplicate_assignment_and_reopen_recheck_current_target(
    core, change, code
) -> None:
    db, service, project, users = core
    assignment = service.assign(Actor.cli(), "p", "first", "alice", "annotate")
    with db.transaction() as conn:
        conn.execute(update(AssignmentRow).values(status="submitted"))
        if change == "inactive":
            conn.execute(
                update(UserRow).where(UserRow.id == users["alice"]).values(active=False)
            )
        else:
            conn.execute(
                delete(ProjectMembershipRow).where(
                    ProjectMembershipRow.user_id == users["alice"]
                )
            )
            if change == "role":
                conn.execute(
                    insert(ProjectMembershipRow).values(
                        project_id=project, user_id=users["alice"], role="lead"
                    )
                )
    for mutation in [
        lambda: service.assign(Actor.cli(), "p", "first", "alice", "annotate"),
        lambda: service.reopen(Actor.cli(), assignment.id),
    ]:
        with pytest.raises(DomainError, match=code):
            mutation()
    assert service.my_tasks(users["alice"]) == []
    assert service.list("p")[0].status == "submitted"


def test_reassign_failure_is_atomic_and_submitted_history_is_preserved(core) -> None:
    db, service, _project, _users = core
    assignment = service.assign(Actor.cli(), "p", "first", "alice", "annotate")
    with db.transaction() as conn:
        conn.execute(
            update(AssignmentRow).values(
                status="submitted", last_submission_id="historical"
            )
        )
    with pytest.raises(DomainError, match="NOT_A_MEMBER"):
        service.reassign(Actor.cli(), assignment.id, "outsider", confirm_started=True)
    assert service.list("p")[0].revoked_at is None
    revoked = service.revoke(Actor.cli(), assignment.id, "retire")
    assert revoked.status == "submitted" and revoked.last_submission_id == "historical"
    with pytest.raises(DomainError, match="ASSIGNMENT_REVOKED"):
        service.reopen(Actor.cli(), assignment.id)


def test_my_tasks_status_priority_before_actual_position(core) -> None:
    db, service, project, users = core
    ids = []
    for position, status in enumerate(["submitted", "open", "in_progress", "reopened"]):
        document = f"status-{position}"
        with db.transaction() as conn:
            conn.execute(
                insert(DocumentRow).values(
                    project_id=project,
                    document_id=document,
                    case_id=document,
                    external_id=document,
                    position=position,
                    language="en",
                    text="text",
                    text_sha256="s",
                )
            )
        assignment = service.assign(Actor.cli(), "p", document, "alice", "annotate")
        ids.append(assignment.id)
        with db.transaction() as conn:
            conn.execute(
                update(AssignmentRow)
                .where(AssignmentRow.id == assignment.id)
                .values(status=status)
            )
    assert [row.assignment_id for row in service.my_tasks(users["alice"])] == ids[::-1]


@pytest.mark.parametrize("operation", ["assign", "reassign", "reopen", "revoke"])
def test_queued_mutation_rechecks_actor_after_membership_removal(
    core, operation
) -> None:
    db, service, _project, users = core
    assignment = service.assign(Actor.cli(), "p", "first", "alice", "annotate")
    if operation == "reopen":
        with db.transaction() as conn:
            conn.execute(update(AssignmentRow).values(status="submitted"))
    waiting = Event()
    owner = get_ident()

    def at_lock(conn, cursor, statement, parameters, context, executemany):
        if get_ident() != owner and "pg_advisory_xact_lock" in statement:
            waiting.set()

    def mutate():
        actor = Actor.user(users["lead"], "lead")
        if operation == "assign":
            return service.assign(actor, "p", "second", "alice", "annotate")
        if operation == "reassign":
            return service.reassign(actor, assignment.id, "bob")
        return getattr(service, operation)(actor, assignment.id)

    event.listen(db.engine, "before_cursor_execute", at_lock)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            with db.transaction() as conn:
                conn.execute(
                    select(func.pg_advisory_xact_lock(_lock_id("members", "p")))
                )
                future = pool.submit(mutate)
                assert waiting.wait(10)
                conn.execute(
                    delete(ProjectMembershipRow).where(
                        ProjectMembershipRow.user_id == users["lead"]
                    )
                )
            with pytest.raises(DomainError, match="PROJECT_NOT_FOUND"):
                future.result(timeout=15)
    finally:
        event.remove(db.engine, "before_cursor_execute", at_lock)
    assert len(service.list("p", include_revoked=True)) == 1
    assert service.list("p")[0].revoked_at is None


def test_concurrent_assignments_return_one_row_and_one_audit(core) -> None:
    db, service, _project, _users = core
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(service.assign, Actor.cli(), "p", "first", "alice", "annotate")
            for _ in range(2)
        ]
        assignments = [future.result(timeout=15) for future in futures]
    assert assignments[0] == assignments[1]
    with db.transaction() as conn:
        assert (
            conn.execute(select(func.count()).select_from(AuditEventRow)).scalar_one()
            == 1
        )


def test_reassign_to_actor_locks_self_once(core) -> None:
    db, service, project, users = core
    with db.transaction() as conn:
        conn.execute(
            insert(ProjectMembershipRow).values(
                project_id=project, user_id=users["lead"], role="annotator"
            )
        )
    old = service.assign(Actor.cli(), "p", "first", "alice", "annotate")
    with ThreadPoolExecutor(max_workers=1) as pool:
        replacement = pool.submit(
            service.reassign, Actor.user(users["lead"], "lead"), old.id, "lead"
        ).result(timeout=15)
    assert replacement.user_id == users["lead"] and replacement.pseudonym == "ann-0001"


@pytest.mark.parametrize(
    "change,code",
    [
        ("inactive", "ASSIGNEE_INACTIVE"),
        ("language", "LANGUAGE_CONFIRMATION_REQUIRED"),
        ("exclusion", "ADJUDICATOR_IS_ANNOTATOR"),
    ],
)
def test_queued_assign_uses_current_target_and_settings(core, change, code) -> None:
    db, service, project, users = core
    waiting = Event()
    owner = get_ident()

    def at_lock(conn, cursor, statement, parameters, context, executemany):
        if get_ident() != owner and "pg_advisory_xact_lock" in statement:
            waiting.set()

    event.listen(db.engine, "before_cursor_execute", at_lock)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            with db.transaction() as conn:
                conn.execute(
                    select(func.pg_advisory_xact_lock(_lock_id("members", "p")))
                )
                conn.execute(
                    select(func.pg_advisory_xact_lock(_lock_id("project", "p")))
                )
                future = pool.submit(
                    service.assign, Actor.cli(), "p", "first", "alice", "annotate"
                )
                assert waiting.wait(10)
                if change == "inactive":
                    conn.execute(
                        update(UserRow)
                        .where(UserRow.id == users["alice"])
                        .values(active=False)
                    )
                elif change == "language":
                    conn.execute(
                        delete(UserLanguageRow).where(
                            UserLanguageRow.user_id == users["alice"]
                        )
                    )
                else:
                    conn.execute(
                        update(ProjectRow).values(adjudicator_not_annotator=True)
                    )
                    conn.execute(
                        insert(AssignmentRow).values(
                            project_id=project,
                            document_id="first",
                            user_id=users["alice"],
                            task="review",
                        )
                    )
            with pytest.raises(DomainError, match=code):
                future.result(timeout=15)
    finally:
        event.remove(db.engine, "before_cursor_execute", at_lock)


def test_my_tasks_across_projects_respects_each_task_role(core) -> None:
    db, service, _project, users = core
    original = service.assign(Actor.cli(), "p", "first", "alice", "annotate")
    with db.transaction() as conn:
        other = conn.execute(
            insert(ProjectRow)
            .values(
                project_key="q",
                name="Other",
                manifest={},
                manifest_sha256="m",
                task_profile={},
                task_profile_sha256="t",
            )
            .returning(ProjectRow.id)
        ).scalar_one()
        conn.execute(
            insert(DocumentRow).values(
                project_id=other,
                document_id="review",
                case_id="review",
                external_id="review",
                position=0,
                language="en",
                text="text",
                text_sha256="s",
            )
        )
        conn.execute(
            insert(ProjectMembershipRow).values(
                project_id=other, user_id=users["alice"], role="adjudicator"
            )
        )
    review = _assign(db, service, "q", "review", "alice", "review")
    assert {row.assignment_id for row in service.my_tasks(users["alice"])} == {
        original.id,
        review.id,
    }
    with db.transaction() as conn:
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == review.id)
            .values(status="submitted")
        )
        conn.execute(
            delete(ProjectMembershipRow).where(
                ProjectMembershipRow.project_id == other,
                ProjectMembershipRow.user_id == users["alice"],
            )
        )
        conn.execute(
            insert(ProjectMembershipRow).values(
                project_id=other, user_id=users["alice"], role="annotator"
            )
        )
    assert [row.assignment_id for row in service.my_tasks(users["alice"])] == [
        original.id
    ]
