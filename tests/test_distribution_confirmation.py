"""Queued contextual confirmation and row refusal contracts; PG token required."""

import pytest
from test_distribution_context import stored as stored

from ontocurator.assignments.confirmations import (
    ConfirmationRow,
    DistributionConfirmationService,
)
from ontocurator.auth.audit import Actor
from ontocurator.domain.errors import DomainError


@pytest.mark.parametrize(
    "refusal,code",
    [
        ("language", "LANGUAGE_CONFIRMATION_REQUIRED"),
        ("adjudicator", "ADJUDICATOR_IS_ANNOTATOR"),
        ("inactive", "ASSIGNEE_INACTIVE"),
        ("invalid_username", "USERNAME_INVALID"),
    ],
)
def test_per_row_refusals_preserve_other_creates(stored, refusal, code):
    from sqlalchemy import insert, update

    from ontocurator.storage.tables import (
        AssignmentRow,
        ProjectRow,
        UserLanguageRow,
        UserRow,
    )

    db, proposals, project, users = stored
    with db.transaction() as conn:
        if refusal == "language":
            conn.execute(
                update(UserLanguageRow)
                .where(UserLanguageRow.user_id == users["alice"])
                .values(language="de")
            )
        elif refusal == "adjudicator":
            conn.execute(
                update(ProjectRow)
                .where(ProjectRow.id == project)
                .values(adjudicator_not_annotator=True)
            )
            conn.execute(
                insert(AssignmentRow).values(
                    project_id=project,
                    document_id="first",
                    user_id=users["alice"],
                    task="review",
                    status="submitted",
                )
            )
        elif refusal == "inactive":
            conn.execute(
                update(UserRow).where(UserRow.id == users["alice"]).values(active=False)
            )
    original = proposals.propose(
        Actor.cli(), "p", ["first"], "annotate", per_document=2, seed=7
    )
    rows = [
        ConfirmationRow(
            "first", "!invalid" if refusal == "invalid_username" else "alice"
        ),
        ConfirmationRow("first", "bob"),
    ]
    result = DistributionConfirmationService(db).confirm(
        Actor.cli(), "p", rows, original.context, task="annotate"
    )
    assert [row.username for row in result.created] == ["bob"]
    assert [row.code for row in result.refused] == [code]


def test_row_savepoint_rolls_back_a_create_before_domain_refusal(stored, monkeypatch):
    from sqlalchemy import select

    from ontocurator.assignments.service import AssignmentService
    from ontocurator.storage.tables import AssignmentRow, AuditEventRow

    db, proposals, _project, users = stored
    original = proposals.propose(
        Actor.cli(), "p", ["first", "second"], "annotate", seed=7
    )
    assign = AssignmentService._assign_locked

    def refuse_after_create(
        self, conn, actor, project, document, target, task, confirm, *, variants=None
    ):
        created = assign(
            self,
            conn,
            actor,
            project,
            document,
            target,
            task,
            confirm,
            variants=variants,
        )
        if target == users["alice"]:
            raise DomainError("ROW_REFUSED_AFTER_WRITE")
        return created

    monkeypatch.setattr(AssignmentService, "_assign_locked", refuse_after_create)
    result = DistributionConfirmationService(db).confirm(
        Actor.cli(),
        "p",
        [ConfirmationRow("first", "alice"), ConfirmationRow("second", "bob")],
        original.context,
        task="annotate",
    )
    assert [row.username for row in result.created] == ["bob"]
    assert [row.code for row in result.refused] == ["ROW_REFUSED_AFTER_WRITE"]
    with db.transaction() as conn:
        assert conn.execute(select(AssignmentRow.user_id)).scalars().all() == [
            users["bob"]
        ]
        assert conn.execute(
            select(AuditEventRow.action).order_by(AuditEventRow.id)
        ).scalars().all() == ["assignment.create", "assignment.distribute"]


def test_human_language_override_is_audited(stored):
    from sqlalchemy import select, update

    from ontocurator.storage.tables import AuditEventRow, UserLanguageRow

    db, proposals, _project, users = stored
    with db.transaction() as conn:
        conn.execute(
            update(UserLanguageRow)
            .where(UserLanguageRow.user_id == users["alice"])
            .values(language="de")
        )
    original = proposals.propose(Actor.cli(), "p", ["first"], "annotate", seed=7)
    result = DistributionConfirmationService(db).confirm(
        Actor.cli(),
        "p",
        [ConfirmationRow("first", "alice")],
        original.context,
        task="annotate",
        confirm_language=True,
    )
    assert [row.username for row in result.created] == ["alice"]
    with db.transaction() as conn:
        events = conn.execute(
            select(AuditEventRow.action, AuditEventRow.details).order_by(
                AuditEventRow.id
            )
        ).all()
    assert [action for action, _ in events] == [
        "assignment.language_override",
        "assignment.create",
        "assignment.distribute",
    ]
    assert events[0].details == {"document_language": "en", "user_languages": ["de"]}
    assert events[-1].details["confirm_language"] is True


def test_contextual_idempotent_row_returns_existing_without_another_create_audit(
    stored,
):
    from sqlalchemy import select

    from ontocurator.assignments.service import AssignmentService
    from ontocurator.storage.tables import AuditEventRow

    db, proposals, _project, _users = stored
    existing = AssignmentService(db).assign(
        Actor.cli(), "p", "first", "alice", "annotate"
    )
    original = proposals.propose(Actor.cli(), "p", ["first"], "annotate", seed=7)
    result = DistributionConfirmationService(db).confirm(
        Actor.cli(),
        "p",
        [ConfirmationRow("first", "alice")],
        original.context,
        task="annotate",
    )
    assert result.created == (existing,)
    with db.transaction() as conn:
        events = conn.execute(
            select(AuditEventRow.action, AuditEventRow.details).order_by(
                AuditEventRow.id
            )
        ).all()
    assert [action for action, _ in events] == [
        "assignment.create",
        "assignment.distribute",
    ]
    assert events[-1].details["outcomes"] == [
        {"document_id": "first", "username": "alice", "assignment_id": existing.id}
    ]


@pytest.mark.parametrize(
    "change", ["document", "member", "language", "load", "setting", "active", "admin"]
)
def test_confirmation_revalidates_inputs_after_wait_and_stale_writes_nothing(
    stored, change
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event, get_ident

    from sqlalchemy import delete, event, func, insert, select, update

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

    db, proposals, project, users = stored
    original = proposals.propose(Actor.cli(), "p", ["first"], "annotate", seed=7)
    waiting = Event()
    owner = get_ident()

    def at_lock(_conn, _cursor, statement, _parameters, _context, _many):
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
                    DistributionConfirmationService(db).confirm,
                    Actor.user(users["lead"], "lead"),
                    "p",
                    [ConfirmationRow("first", "alice")],
                    original.context,
                    task="annotate",
                )
                assert waiting.wait(10)
                if change == "document":
                    conn.execute(
                        update(DocumentRow)
                        .where(DocumentRow.document_id == "first")
                        .values(text_sha256="changed")
                    )
                elif change == "member":
                    conn.execute(
                        delete(ProjectMembershipRow).where(
                            ProjectMembershipRow.user_id == users["alice"]
                        )
                    )
                elif change == "language":
                    conn.execute(
                        update(UserLanguageRow)
                        .where(UserLanguageRow.user_id == users["alice"])
                        .values(language="de")
                    )
                elif change == "load":
                    conn.execute(
                        insert(AssignmentRow).values(
                            project_id=project,
                            document_id="second",
                            user_id=users["alice"],
                            task="review",
                            status="reopened",
                        )
                    )
                elif change == "setting":
                    conn.execute(
                        update(ProjectRow)
                        .where(ProjectRow.id == project)
                        .values(adjudicator_not_annotator=True)
                    )
                elif change == "active":
                    conn.execute(
                        update(UserRow)
                        .where(UserRow.id == users["alice"])
                        .values(active=False)
                    )
                else:
                    conn.execute(
                        update(UserRow)
                        .where(UserRow.id == users["alice"])
                        .values(is_system_admin=True)
                    )
            with pytest.raises(DomainError, match="DISTRIBUTION_STALE"):
                future.result(timeout=15)
    finally:
        event.remove(db.engine, "before_cursor_execute", at_lock)
    with db.transaction() as conn:
        assert (
            conn.execute(
                select(func.count())
                .select_from(AssignmentRow)
                .where(AssignmentRow.document_id == "first")
            ).scalar_one()
            == 0
        )
        assert (
            conn.execute(select(func.count()).select_from(AuditEventRow)).scalar_one()
            == 0
        )


def test_confirmation_first_user_lock_is_one_ordered_final_mode_batch_including_self(
    stored,
):
    from sqlalchemy import event, insert

    from ontocurator.storage.tables import ProjectMembershipRow

    db, proposals, project, users = stored
    with db.transaction() as conn:
        conn.execute(
            insert(ProjectMembershipRow).values(
                project_id=project, user_id=users["lead"], role="annotator"
            )
        )
    original = proposals.propose(
        Actor.cli(), "p", ["first", "second"], "annotate", seed=7
    )
    user_locks = []

    def capture(_conn, _cursor, statement, _parameters, _context, _many):
        if "users" in statement and "FOR " in statement:
            user_locks.append(statement)

    event.listen(db.engine, "before_cursor_execute", capture)
    try:
        result = DistributionConfirmationService(db).confirm(
            Actor.user(users["lead"], "lead"),
            "p",
            [ConfirmationRow("first", "lead"), ConfirmationRow("second", "alice")],
            original.context,
            task="annotate",
        )
    finally:
        event.remove(db.engine, "before_cursor_execute", capture)
    assert len(result.created) == 2
    assert "ORDER BY" in user_locks[0] and "FOR NO KEY UPDATE" in user_locks[0]
    assert sum("FOR NO KEY UPDATE" in statement for statement in user_locks) == 1


@pytest.mark.parametrize(
    "change,code",
    [
        ("membership", "PROJECT_NOT_FOUND"),
        ("inactive", "NOT_AUTHENTICATED"),
        ("admin", "PROJECT_NOT_FOUND"),
    ],
)
def test_waiting_confirmation_rechecks_current_manager(stored, change, code):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event, get_ident

    from sqlalchemy import delete, event, func, select, update

    from ontocurator.storage.repository import _lock_id
    from ontocurator.storage.tables import (
        AssignmentRow,
        AuditEventRow,
        ProjectMembershipRow,
        UserRow,
    )

    db, proposals, _project, users = stored
    if change == "admin":
        with db.transaction() as conn:
            conn.execute(
                delete(ProjectMembershipRow).where(
                    ProjectMembershipRow.user_id == users["lead"]
                )
            )
            conn.execute(
                update(UserRow)
                .where(UserRow.id == users["lead"])
                .values(is_system_admin=True)
            )
    original = proposals.propose(Actor.cli(), "p", ["first"], "annotate", seed=7)
    waiting, owner = Event(), get_ident()

    def at_lock(_conn, _cursor, statement, _parameters, _context, _many):
        if get_ident() != owner and "pg_advisory_xact_lock" in statement:
            waiting.set()

    event.listen(db.engine, "before_cursor_execute", at_lock)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            with db.transaction() as conn:
                conn.execute(
                    select(func.pg_advisory_xact_lock(_lock_id("members", "p")))
                )
                future = pool.submit(
                    DistributionConfirmationService(db).confirm,
                    Actor.user(users["lead"], "lead"),
                    "p",
                    [ConfirmationRow("first", "alice")],
                    original.context,
                    task="annotate",
                )
                assert waiting.wait(10)
                if change == "membership":
                    conn.execute(
                        delete(ProjectMembershipRow).where(
                            ProjectMembershipRow.user_id == users["lead"]
                        )
                    )
                else:
                    conn.execute(
                        update(UserRow)
                        .where(UserRow.id == users["lead"])
                        .values(
                            **{
                                "active"
                                if change == "inactive"
                                else "is_system_admin": False
                            }
                        )
                    )
            with pytest.raises(DomainError, match=code):
                future.result(timeout=15)
    finally:
        event.remove(db.engine, "before_cursor_execute", at_lock)
    with db.transaction() as conn:
        assert (
            conn.execute(select(func.count()).select_from(AssignmentRow)).scalar_one()
            == 0
        )
        assert (
            conn.execute(select(func.count()).select_from(AuditEventRow)).scalar_one()
            == 0
        )


def test_reciprocal_admin_confirmations_in_separate_projects_finish_without_deadlock(
    stored,
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from sqlalchemy import insert, update

    from ontocurator.storage.tables import (
        DocumentRow,
        ProjectMembershipRow,
        ProjectRow,
        UserRow,
    )

    db, proposals, _project, users = stored
    with db.transaction() as conn:
        other = conn.execute(
            insert(ProjectRow)
            .values(
                project_key="q",
                name="Q",
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
                document_id="first",
                case_id="first",
                external_id="first",
                position=0,
                language="en",
                text="text",
                text_sha256="sha",
            )
        )
        conn.execute(
            update(UserRow)
            .where(UserRow.id.in_([users["alice"], users["bob"]]))
            .values(is_system_admin=True)
        )
        for name in ["alice", "bob"]:
            conn.execute(
                insert(ProjectMembershipRow).values(
                    project_id=other, user_id=users[name], role="annotator"
                )
            )
    contexts = {
        key: proposals.propose(Actor.cli(), key, ["first"], "annotate", seed=7).context
        for key in ["p", "q"]
    }
    barrier = Barrier(2)

    def run(key, actor, target):
        barrier.wait(timeout=10)
        return DistributionConfirmationService(db).confirm(
            Actor.user(users[actor], actor),
            key,
            [ConfirmationRow("first", target)],
            contexts[key],
            task="annotate",
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(run, "p", "alice", "bob")
        second = pool.submit(run, "q", "bob", "alice")
        assert [row.username for row in first.result(timeout=15).created] == ["bob"]
        assert [row.username for row in second.result(timeout=15).created] == ["alice"]
