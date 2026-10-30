"""Distribution snapshot contracts; database cases await the coordinator token."""

from dataclasses import replace

import pytest

from ontotator.assignments.proposals import (
    DistributionContext,
    DistributionSnapshot,
    SnapshotDocument,
    SnapshotMember,
    build_proposal,
    require_fresh_context,
    validate_selection,
)
from ontotator.domain.errors import DomainError


@pytest.fixture
def snapshot():
    return DistributionSnapshot(
        project_key="p",
        adjudicator_not_annotator=False,
        documents=(SnapshotDocument("second", 0, "en", "s", ()),),
        members=(
            SnapshotMember(
                1, "alice", "Alice", "ann-1", True, False, ("annotator",), ("en",), 0
            ),
        ),
    )


def test_snapshot_hash_is_canonical_and_has_no_volatile_fields(snapshot):
    member = snapshot.members[0]
    other = replace(
        member,
        user_id=2,
        username="bob",
        roles=("lead", "annotator"),
        languages=("de", "en"),
    )
    first = replace(snapshot, members=(member, other))
    second = replace(
        snapshot,
        members=(
            replace(other, roles=tuple(reversed(other.roles)), languages=("en", "de")),
            member,
        ),
    )
    assert first.state_sha256 == second.state_sha256
    assert "updated_at" not in str(first.as_dict())
    assert "now" not in first.as_dict()


@pytest.mark.parametrize(
    "field,value",
    [
        ("active", False),
        ("roles", ("lead",)),
        ("languages", ("de",)),
        ("load", 1),
        ("display_name", "Changed"),
    ],
)
def test_actual_member_inputs_change_context(snapshot, field, value):
    changed = replace(
        snapshot, members=(replace(snapshot.members[0], **{field: value}),)
    )
    assert snapshot.state_sha256 != changed.state_sha256


@pytest.mark.parametrize(
    "field,value",
    [
        ("language", "de"),
        ("position", 8),
        ("text_sha256", "changed"),
        ("excluded_user_ids", (1,)),
    ],
)
def test_actual_document_inputs_change_context(snapshot, field, value):
    changed = replace(
        snapshot, documents=(replace(snapshot.documents[0], **{field: value}),)
    )
    assert snapshot.state_sha256 != changed.state_sha256


def test_setting_changes_context(snapshot):
    assert (
        snapshot.state_sha256
        != replace(snapshot, adjudicator_not_annotator=True).state_sha256
    )


def test_context_reproduces_original_proposal_and_snapshot(snapshot):
    prepared = build_proposal(snapshot, task="annotate", per_document=1, seed=7)
    assert prepared.context == DistributionContext(
        ("second",), "annotate", 1, 7, snapshot.state_sha256
    )
    assert prepared.proposal.rows == (("second", 1),)
    assert build_proposal(snapshot, task="annotate", per_document=1, seed=7) == prepared
    assert prepared.snapshot is snapshot
    require_fresh_context(prepared.context, prepared)
    with pytest.raises(DomainError, match="DISTRIBUTION_STALE"):
        require_fresh_context(
            replace(prepared.context, state_sha256="forged"), prepared
        )


def test_admin_flag_does_not_supply_task_role_and_inactive_members_are_excluded(
    snapshot,
):
    admin = replace(snapshot.members[0], is_system_admin=True, roles=("lead",))
    inactive = replace(snapshot.members[0], user_id=2, active=False)
    result = build_proposal(
        replace(snapshot, members=(admin, inactive)),
        task="annotate",
        per_document=1,
        seed=7,
    )
    assert result.proposal.rows == ()
    assert result.proposal.unassignable[0].reason == "NO_READER"


@pytest.mark.parametrize(
    "documents,task,count,seed,code",
    [
        ([], "annotate", 1, 0, "DOCUMENT_SELECTION_INVALID"),
        (["a", "a"], "annotate", 1, 0, "DOCUMENT_SELECTION_INVALID"),
        ([""], "annotate", 1, 0, "DOCUMENT_SELECTION_INVALID"),
        (["a"], "invalid", 1, 0, "TASK_INVALID"),
        (["a"], "annotate", 0, 0, "PER_DOCUMENT_INVALID"),
        (["a"], "annotate", True, 0, "PER_DOCUMENT_INVALID"),
        (["a"], "annotate", 1, True, "SEED_INVALID"),
    ],
)
def test_invalid_selection_has_domain_codes(documents, task, count, seed, code):
    with pytest.raises(DomainError, match=code):
        validate_selection(documents, task, count, seed)


@pytest.fixture
def stored(tmp_path):
    from pg_harness import database_for
    from sqlalchemy import insert

    from ontotator.assignments.proposals import DistributionService
    from ontotator.storage.tables import (
        DocumentRow,
        ProjectMembershipRow,
        ProjectRow,
        UserLanguageRow,
        UserRow,
    )

    db = database_for(tmp_path / "distribution.db")
    with db.transaction() as conn:
        project = conn.execute(
            insert(ProjectRow)
            .values(
                project_key="p",
                name="P",
                manifest={},
                manifest_sha256="m",
                task_profile={},
                task_profile_sha256="t",
            )
            .returning(ProjectRow.id)
        ).scalar_one()
        users = {}
        for name, role in [
            ("lead", "lead"),
            ("alice", "annotator"),
            ("bob", "annotator"),
        ]:
            users[name] = conn.execute(
                insert(UserRow)
                .values(username=name, display_name=name, pseudonym="ann-" + name)
                .returning(UserRow.id)
            ).scalar_one()
            conn.execute(
                insert(ProjectMembershipRow).values(
                    project_id=project, user_id=users[name], role=role
                )
            )
            conn.execute(
                insert(UserLanguageRow).values(user_id=users[name], language="en")
            )
        for document, position in [("second", 0), ("first", 1)]:
            conn.execute(
                insert(DocumentRow).values(
                    project_id=project,
                    document_id=document,
                    case_id=document,
                    external_id=document,
                    position=position,
                    language="en",
                    text="text",
                    text_sha256="sha",
                )
            )
    from work_plan_support import plan_all

    plan_all(db, "p")
    return db, DistributionService(db), project, users


def test_stored_proposal_is_ordered_bounded_and_writes_nothing(stored):
    from sqlalchemy import event

    from ontotator.auth.audit import Actor

    db, service, _project, users = stored
    statements = []

    def capture(_conn, _cursor, statement, _params, _context, _many):
        statements.append(statement)

    event.listen(db.engine, "before_cursor_execute", capture)
    try:
        prepared = service.propose(
            Actor.user(users["lead"], "lead"),
            "p",
            ["first", "second"],
            "annotate",
            seed=7,
        )
    finally:
        event.remove(db.engine, "before_cursor_execute", capture)
    assert prepared.context.document_ids == ("second", "first")
    assert len(prepared.proposal.rows) == 2
    assert len(statements) <= 12
    assert all(s.lstrip().upper().startswith("SELECT") for s in statements)


def test_seed_generated_once_and_echoed(stored, monkeypatch):
    from ontotator.auth.audit import Actor

    calls = []

    def seed(limit):
        calls.append(limit)
        return 123

    monkeypatch.setattr("ontotator.assignments.proposals.secrets.randbelow", seed)
    _db, service, _project, _users = stored
    result = service.propose(Actor.cli(), "p", ["first"], "annotate")
    assert calls == [2**31]
    assert result.context.seed == result.proposal.seed == 123
    assert service.propose(Actor.cli(), "p", ["first"], "annotate", seed=123) == result
    assert len(calls) == 1


def test_project_load_counts_all_tasks_and_reopened_but_not_submitted_revoked_or_foreign(
    stored,
):
    from datetime import UTC, datetime

    from sqlalchemy import insert

    from ontotator.auth.audit import Actor
    from ontotator.storage.tables import AssignmentRow, DocumentRow, ProjectRow

    db, service, project, users = stored
    with db.transaction() as conn:
        other = conn.execute(
            insert(ProjectRow)
            .values(
                project_key="other",
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
                document_id="foreign",
                case_id="foreign",
                external_id="foreign",
                position=0,
                language="en",
                text="text",
                text_sha256="sha",
            )
        )
        for p, document, task, status, revoked in [
            (project, "first", "annotate", "submitted", None),
            (project, "first", "review", "reopened", None),
            (project, "second", "annotate", "open", datetime.now(UTC)),
            (project, "second", "review", "in_progress", None),
            (other, "foreign", "annotate", "open", None),
        ]:
            conn.execute(
                insert(AssignmentRow).values(
                    project_id=p,
                    document_id=document,
                    user_id=users["alice"],
                    task=task,
                    status=status,
                    annotation_mode="scratch" if task == "annotate" else None,
                    revoked_at=revoked,
                )
            )
    result = service.propose(Actor.cli(), "p", ["first", "second"], "annotate", seed=0)
    alice = next(m for m in result.snapshot.members if m.username == "alice")
    assert alice.load == 2
    assert result.snapshot.documents[0].excluded_user_ids == ()
    assert result.snapshot.documents[1].excluded_user_ids == (users["alice"],)
    assert all(user == users["bob"] for _doc, user in result.proposal.rows)


@pytest.mark.parametrize(
    "change", ["document", "member", "language", "load", "setting"]
)
def test_current_database_inputs_make_context_stale(stored, change):
    from sqlalchemy import delete, insert, update

    from ontotator.auth.audit import Actor
    from ontotator.storage.tables import (
        AssignmentRow,
        DocumentRow,
        ProjectMembershipRow,
        ProjectRow,
        UserLanguageRow,
    )

    db, service, project, users = stored
    original = service.propose(Actor.cli(), "p", ["first"], "annotate", seed=0)
    with db.transaction() as conn:
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
        else:
            conn.execute(
                update(ProjectRow)
                .where(ProjectRow.id == project)
                .values(adjudicator_not_annotator=True)
            )
    with (
        pytest.raises(DomainError, match="DISTRIBUTION_STALE"),
        db.transaction() as conn,
    ):
        service.revalidate_on(conn, Actor.cli(), "p", original.context)


def test_proposal_rechecks_management_and_does_not_disclose_missing_document(stored):
    from ontotator.auth.audit import Actor

    _db, service, _project, users = stored
    with pytest.raises(DomainError, match="NOT_ALLOWED"):
        service.propose(
            Actor.user(users["alice"], "alice"), "p", ["first"], "annotate", seed=0
        )
    with pytest.raises(DomainError, match="DOCUMENT_NOT_FOUND") as error:
        service.propose(Actor.cli(), "p", ["foreign-secret-id"], "annotate", seed=0)
    assert error.value.details is None


@pytest.mark.parametrize(
    "change", ["inactive", "role", "language", "admin_without_role"]
)
def test_database_candidates_use_current_roles_activity_and_languages(stored, change):
    from sqlalchemy import delete, update

    from ontotator.auth.audit import Actor
    from ontotator.storage.tables import (
        ProjectMembershipRow,
        UserLanguageRow,
        UserRow,
    )

    db, service, _project, users = stored
    with db.transaction() as conn:
        if change == "inactive":
            conn.execute(
                update(UserRow).where(UserRow.id == users["alice"]).values(active=False)
            )
        elif change == "language":
            conn.execute(
                update(UserLanguageRow)
                .where(UserLanguageRow.user_id == users["alice"])
                .values(language="de")
            )
        else:
            conn.execute(
                delete(ProjectMembershipRow).where(
                    ProjectMembershipRow.user_id == users["alice"]
                )
            )
            if change == "admin_without_role":
                conn.execute(
                    update(UserRow)
                    .where(UserRow.id == users["alice"])
                    .values(is_system_admin=True)
                )
    result = service.propose(Actor.cli(), "p", ["first", "second"], "annotate", seed=0)
    assert all(user == users["bob"] for _doc, user in result.proposal.rows)


@pytest.mark.parametrize(
    "task,opposite", [("annotate", "review"), ("review", "annotate")]
)
@pytest.mark.parametrize("enabled", [True, False])
def test_database_opposite_assignment_excludes_only_when_enabled(
    stored, task, opposite, enabled
):
    from sqlalchemy import insert, update

    from ontotator.auth.audit import Actor
    from ontotator.storage.tables import (
        AssignmentRow,
        ProjectMembershipRow,
        ProjectRow,
    )

    db, service, project, users = stored
    with db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.id == project)
            .values(adjudicator_not_annotator=enabled)
        )
        conn.execute(
            insert(ProjectMembershipRow).values(
                project_id=project, user_id=users["alice"], role="adjudicator"
            )
        )
        conn.execute(
            insert(AssignmentRow).values(
                project_id=project,
                document_id="first",
                user_id=users["alice"],
                task=opposite,
                status="submitted",
                annotation_mode="scratch" if opposite == "annotate" else None,
            )
        )
    result = service.propose(Actor.cli(), "p", ["first"], task, seed=0)
    assert (users["alice"] in result.snapshot.documents[0].excluded_user_ids) is enabled


def test_actual_foreign_document_is_missing_without_metadata(stored):
    from sqlalchemy import insert

    from ontotator.auth.audit import Actor
    from ontotator.storage.tables import DocumentRow, ProjectRow

    db, service, _project, _users = stored
    with db.transaction() as conn:
        other = conn.execute(
            insert(ProjectRow)
            .values(
                project_key="other",
                name="Secret project",
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
                document_id="secret",
                case_id="secret",
                external_id="secret",
                position=0,
                language="de",
                text="secret text",
                text_sha256="sha",
            )
        )
    with pytest.raises(DomainError, match="DOCUMENT_NOT_FOUND") as error:
        service.propose(Actor.cli(), "p", ["first", "secret"], "annotate", seed=0)
    assert error.value.details is None
