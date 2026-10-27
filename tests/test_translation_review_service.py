"""Real PostgreSQL review transactions; authored for later exclusive execution."""

import hashlib
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event, get_ident
from types import SimpleNamespace

import pytest
from auth_harness import HARNESS, logged_in
from sqlalchemy import delete, event, func, insert, select, update
from t1_builders import bundle, correction_unit, native_unit, translation_unit
from t1_fixtures import create_project, run_import
from test_auth_api import _app

from ontotator.application.translation_reviews import TranslationReviewService
from ontotator.assignments.service import AssignmentService
from ontotator.authz.policy import Access
from ontotator.domain.errors import DomainError
from ontotator.projects.service import ProjectService
from ontotator.storage.repository import _lock_id
from ontotator.storage.tables import (
    AssignmentRow,
    AuditEventRow,
    DocumentRow,
    ProjectMembershipRow,
    ProjectRow,
    TranslationReviewDraftRow,
    TranslationReviewRow,
    UserLanguageRow,
    UserRow,
)


@pytest.fixture
def review_env(tmp_path):
    app = _app(tmp_path)
    db = app.state.repo.db
    create_project(db)
    source = native_unit("source", "en", "Source text", case_id="case")
    target = translation_unit(
        "target", "de", "Übersetzt", source=source, checks=(("units_added", False),)
    )
    comparison = translation_unit(
        "comparison", "de", "Alternative", source=source, provider="other"
    )
    imported = run_import(db, bundle(tmp_path, [source, target, comparison]))
    assert imported.status == "succeeded", imported.error
    accesses = {}
    with db.transaction() as conn:
        pid = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == "proj")
        ).scalar_one()
    for name, roles, admin in [
        ("alice", ["annotator"], False),
        ("bob", ["annotator"], False),
        ("leader", ["lead"], False),
        ("root", [], True),
    ]:
        logged_in(
            app,
            name,
            system_admin=admin,
            projects={"proj": roles} if roles else {},
            assignments=[],
        )
        user = app.state.accounts.get_by_username(name)
        accesses[name] = Access(
            user.id, user.pseudonym, admin, {"proj": frozenset(roles)}
        )
        with db.transaction() as conn:
            conn.execute(
                update(UserRow)
                .where(UserRow.id == user.id)
                .values(qualification="Original qualification")
            )
            conn.execute(insert(UserLanguageRow).values(user_id=user.id, language="de"))
    ids = {}
    with db.transaction() as conn:
        for name in ["alice", "bob"]:
            ids[name] = conn.execute(
                insert(AssignmentRow)
                .values(
                    project_id=pid,
                    document_id="target",
                    user_id=accesses[name].user_id,
                    task="translation_review",
                    status="open",
                )
                .returning(AssignmentRow.id)
            ).scalar_one()
    return SimpleNamespace(
        app=app,
        db=db,
        service=TranslationReviewService(db, app.state.jobs),
        accesses=accesses,
        ids=ids,
        pid=pid,
        source=source,
        target=target,
        tmp_path=tmp_path,
    )


def save(env, decision="accepted_unchanged", text="Übersetzt", **form):
    workspace = env.service.open(env.accesses["alice"], env.ids["alice"])
    return env.service.save_draft(
        env.accesses["alice"],
        env.ids["alice"],
        expected_revision=workspace.draft.revision,
        text=text,
        form={"decision": decision, "clinical_change": False, **form},
    )


def count(env, table):
    with env.db.transaction() as conn:
        return conn.execute(select(func.count()).select_from(table)).scalar_one()


def test_open_exact_text_source_checks_comparisons_and_raw_revision_draft(review_env):
    env = review_env
    opened = env.service.open(env.accesses["alice"], env.ids["alice"])
    assert not opened.read_only and opened.submitted_record is None
    assert opened.text == opened.draft.text == "Übersetzt"
    assert (
        opened.source.variant.document_id == "source"
        and opened.source.text == "Source text"
    )
    assert [c.variant.document_id for c in opened.comparisons] == ["comparison"]
    assert [c.code for c in opened.failed_checks] == ["units_added"]
    revision = env.service.save_draft(
        env.accesses["alice"],
        env.ids["alice"],
        expected_revision=0,
        text="unfinished",
        form={"incomplete": True},
    )
    assert revision == 1
    assert env.service.open(env.accesses["alice"], env.ids["alice"]).draft.form == {
        "incomplete": True
    }
    with pytest.raises(DomainError, match="REVISION_CONFLICT"):
        env.service.save_draft(
            env.accesses["alice"],
            env.ids["alice"],
            expected_revision=0,
            text="lost",
            form={},
        )
    with env.db.transaction() as conn:
        assert (
            conn.execute(
                select(AssignmentRow.status).where(AssignmentRow.id == env.ids["alice"])
            ).scalar_one()
            == "in_progress"
        )


@pytest.mark.parametrize(
    "decision,clinical,text,categories,rationale,status,created",
    [
        ("accepted_unchanged", False, "Übersetzt", [], None, "accepted", False),
        ("accepted_corrected", False, "Korrigiert", [], None, "reviewed", True),
        ("query", True, "Übersetzt", ["source"], "Question", "reviewed", False),
        ("rejected", True, "Übersetzt", ["value"], "Wrong", "reviewed", False),
    ],
)
def test_all_decisions_are_atomic_and_submitted_open_uses_record(
    review_env, decision, clinical, text, categories, rationale, status, created
):
    env = review_env
    rev = save(
        env,
        decision,
        text,
        clinical_change=clinical,
        categories=categories,
        rationale=rationale,
    )
    record = env.service.submit(
        env.accesses["alice"], env.ids["alice"], expected_revision=rev
    )
    assert (
        record.status_before == "automatic_check_failed"
        and record.status_after == status
    )
    assert bool(record.created_variant_id) is created
    assert (
        record.proposed_text == text
        and record.proposed_text_sha256 == hashlib.sha256(text.encode()).hexdigest()
    )
    opened = env.service.open(env.accesses["alice"], env.ids["alice"])
    assert opened.read_only and opened.submitted_record.id == record.id
    assert opened.draft.text == text and opened.draft.form["decision"] == decision
    with env.db.transaction() as conn:
        target = (
            conn.execute(
                select(DocumentRow).where(
                    DocumentRow.project_id == env.pid,
                    DocumentRow.document_id == "target",
                )
            )
            .mappings()
            .one()
        )
        assert target["text"] == "Übersetzt" and target["translation_status"] == status
        assignment = (
            conn.execute(
                select(AssignmentRow).where(AssignmentRow.id == env.ids["alice"])
            )
            .mappings()
            .one()
        )
        assert (
            assignment["status"] == "submitted"
            and assignment["last_submission_id"] == f"tr-{record.id}"
        )
        audit = conn.execute(
            select(AuditEventRow.details).where(
                AuditEventRow.action == "translation.review"
            )
        ).scalar_one()
        assert audit["created_variant_id"] == record.created_variant_id
        if created:
            child = (
                conn.execute(
                    select(DocumentRow).where(
                        DocumentRow.project_id == env.pid,
                        DocumentRow.document_id == record.created_variant_id,
                    )
                )
                .mappings()
                .one()
            )
            assert child["version"] == 2 and child["origin"] == "correction"
            assert child["derived_from"] == "target" and child["translation"] is None
            assert (
                child["translation_status"] == "accepted"
                and child["status_reason"] == f"translation review {record.id}"
            )


def test_submitted_open_does_not_create_or_reset_draft_and_consumed_revision_survives_reopen(
    review_env,
):
    env = review_env
    rev = save(env)
    first = env.service.submit(
        env.accesses["alice"], env.ids["alice"], expected_revision=rev
    )
    with env.db.transaction() as conn:
        conn.execute(
            delete(TranslationReviewDraftRow).where(
                TranslationReviewDraftRow.assignment_id == env.ids["alice"]
            )
        )
    before = count(env, AuditEventRow)
    assert (
        env.service.open(env.accesses["alice"], env.ids["alice"]).submitted_record.id
        == first.id
    )
    assert (
        count(env, TranslationReviewDraftRow) == 0
        and count(env, AuditEventRow) == before
    )
    # Separate consumed-token check keeps its actual persisted draft row.
    with env.db.transaction() as conn:
        conn.execute(
            insert(TranslationReviewDraftRow).values(
                assignment_id=env.ids["alice"],
                text="Übersetzt",
                form={"decision": "accepted_unchanged", "clinical_change": False},
                revision=rev + 1,
            )
        )
    AssignmentService(env.db).reopen(HARNESS, env.ids["alice"])
    with pytest.raises(DomainError, match="REVISION_CONFLICT"):
        env.service.submit(
            env.accesses["alice"], env.ids["alice"], expected_revision=rev
        )
    second = env.service.submit(
        env.accesses["alice"], env.ids["alice"], expected_revision=rev + 1
    )
    assert second.id > first.id and count(env, TranslationReviewRow) == 2


def test_qualification_is_submit_only_and_record_snapshots_are_immutable(review_env):
    env = review_env
    with env.db.transaction() as conn:
        conn.execute(
            update(UserRow)
            .where(UserRow.id == env.accesses["alice"].user_id)
            .values(qualification=" \t")
        )
    rev = save(env)
    with pytest.raises(DomainError, match="QUALIFICATION_REQUIRED"):
        env.service.submit(
            env.accesses["alice"], env.ids["alice"], expected_revision=rev
        )
    with env.db.transaction() as conn:
        conn.execute(
            update(UserRow)
            .where(UserRow.id == env.accesses["alice"].user_id)
            .values(qualification="Before")
        )
    record = env.service.submit(
        env.accesses["alice"], env.ids["alice"], expected_revision=rev
    )
    with env.db.transaction() as conn:
        conn.execute(
            update(UserRow)
            .where(UserRow.id == env.accesses["alice"].user_id)
            .values(qualification="After")
        )
    assert (
        env.service.records(env.accesses["alice"], "proj", "target")[
            0
        ].reviewer_qualification
        == record.reviewer_qualification
        == "Before"
    )
    assert record.reviewer_languages == ["de"]


@pytest.mark.parametrize("change", ["revoke", "inactive", "role"])
def test_cached_access_cannot_survive_authority_loss(review_env, change):
    env = review_env
    rev = save(env)
    with env.db.transaction() as conn:
        if change == "revoke":
            conn.execute(
                update(AssignmentRow)
                .where(AssignmentRow.id == env.ids["alice"])
                .values(revoked_at=func.now())
            )
        elif change == "inactive":
            conn.execute(
                update(UserRow)
                .where(UserRow.id == env.accesses["alice"].user_id)
                .values(active=False)
            )
        else:
            conn.execute(
                delete(ProjectMembershipRow).where(
                    ProjectMembershipRow.user_id == env.accesses["alice"].user_id
                )
            )
    for action in [
        lambda: env.service.open(env.accesses["alice"], env.ids["alice"]),
        lambda: env.service.submit(
            env.accesses["alice"], env.ids["alice"], expected_revision=rev
        ),
    ]:
        with pytest.raises(DomainError, match="ASSIGNMENT_NOT_FOUND"):
            action()
    assert count(env, TranslationReviewRow) == 0


def test_foreign_and_unassigned_admin_cannot_work_and_records_are_own_only(review_env):
    env = review_env
    for name in ["bob", "leader", "root"]:
        with pytest.raises(DomainError, match="ASSIGNMENT_NOT_FOUND"):
            env.service.open(env.accesses[name], env.ids["alice"])
    rev = save(env)
    record = env.service.submit(
        env.accesses["alice"], env.ids["alice"], expected_revision=rev
    )
    assert env.service.records(env.accesses["bob"], "proj", "target") == []
    for name in ["alice", "leader", "root"]:
        assert [
            r.id for r in env.service.records(env.accesses[name], "proj", "target")
        ] == [record.id]


def test_categories_canonical_text_and_review_only_structural_lock(review_env):
    env = review_env
    rev = save(
        env,
        "accepted_corrected",
        "\ufeffCafe\u0301\r\n",
        clinical_change=True,
        categories=["value", "source", "value"],
        rationale="Reason",
    )
    record = env.service.submit(
        env.accesses["alice"], env.ids["alice"], expected_revision=rev
    )
    assert record.categories == ["source", "value"] and record.proposed_text == "Café\n"
    assert ProjectService(env.db, env.app.state.ontology_store).settings("proj").locked


@pytest.mark.parametrize("fault", ["audit", "correction"])
def test_final_failure_rolls_back_entire_submission(review_env, fault):
    env = review_env
    rev = save(env, "accepted_corrected", "Corrected")
    before = count(env, AuditEventRow)

    def fail(conn, cursor, statement, parameters, context, executemany):
        if (fault == "audit" and "INSERT INTO ontotator.audit_events" in statement) or (
            fault == "correction" and "INSERT INTO ontotator.documents" in statement
        ):
            raise RuntimeError("injected final failure")

    event.listen(env.db.engine, "before_cursor_execute", fail)
    try:
        with pytest.raises(RuntimeError, match="injected"):
            env.service.submit(
                env.accesses["alice"], env.ids["alice"], expected_revision=rev
            )
    finally:
        event.remove(env.db.engine, "before_cursor_execute", fail)
    assert count(env, TranslationReviewRow) == 0 and count(env, DocumentRow) == 3
    assert count(env, AuditEventRow) == before
    opened = env.service.open(env.accesses["alice"], env.ids["alice"])
    assert (
        not opened.read_only
        and opened.draft.revision == rev
        and opened.variant.translation_status == "automatic_check_failed"
    )


def test_two_corrected_submits_serialize_to_one_child_and_one_stale_refusal(review_env):
    env = review_env
    rev = save(env, "accepted_corrected", "Alice correction")
    bob = env.service.open(env.accesses["bob"], env.ids["bob"])
    brev = env.service.save_draft(
        env.accesses["bob"],
        env.ids["bob"],
        expected_revision=bob.draft.revision,
        text="Bob correction",
        form={"decision": "accepted_corrected", "clinical_change": False},
    )
    barrier = Barrier(2)

    def submit(name, revision):
        barrier.wait()
        try:
            return env.service.submit(
                env.accesses[name], env.ids[name], expected_revision=revision
            )
        except DomainError as error:
            return error.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(submit, "alice", rev), pool.submit(submit, "bob", brev)]
        results = [f.result(timeout=20) for f in futures]
    assert results.count("VARIANT_REVIEW_STALE") == 1
    assert count(env, TranslationReviewRow) == 1 and count(env, DocumentRow) == 4


def test_invalid_form_changes_nothing(review_env):
    env = review_env
    rev = save(env, "accepted_unchanged", "changed", clinical_change=True)
    with pytest.raises(DomainError) as raised:
        env.service.submit(
            env.accesses["alice"], env.ids["alice"], expected_revision=rev
        )
    assert raised.value.code == "REVIEW_INVALID"
    assert raised.value.details["issues"] == [
        "TEXT_CHANGED",
        "CLINICAL_CHANGE_NOT_ALLOWED",
        "CATEGORY_REQUIRED",
        "RATIONALE_REQUIRED",
    ]
    assert count(env, TranslationReviewRow) == 0


def test_correction_chain_workspace_retains_original_source_run_and_exact_baseline(
    review_env,
):
    env = review_env
    rev = save(env, "accepted_corrected", "Corrected once")
    first = env.service.submit(
        env.accesses["alice"], env.ids["alice"], expected_revision=rev
    )
    with env.db.transaction() as conn:
        aid = conn.execute(
            insert(AssignmentRow)
            .values(
                project_id=env.pid,
                document_id=first.created_variant_id,
                user_id=env.accesses["alice"].user_id,
                task="translation_review",
                status="open",
            )
            .returning(AssignmentRow.id)
        ).scalar_one()
    opened = env.service.open(env.accesses["alice"], aid)
    assert opened.variant.version == 2 and opened.variant.translation is None
    assert opened.translation_ancestor.document_id == "target"
    assert opened.translation_ancestor.translation["provider"] == "test-mt"
    assert opened.text == opened.draft.text == "Corrected once"
    assert (
        opened.source.variant.document_id == "source"
        and opened.source.text == "Source text"
    )
    assert [c.code for c in opened.failed_checks] == ["units_added"]
    rev2 = env.service.save_draft(
        env.accesses["alice"],
        aid,
        expected_revision=0,
        text="Corrected twice",
        form={"decision": "accepted_corrected", "clinical_change": False},
    )
    second = env.service.submit(env.accesses["alice"], aid, expected_revision=rev2)
    assert second.machine_text_sha256 == hashlib.sha256(b"Corrected once").hexdigest()
    assert second.created_variant_id == "target~de~v3"


def test_imported_newer_correction_refuses_old_corrected_review_but_retains_draft(
    review_env,
):
    env = review_env
    rev = save(env, "accepted_corrected", "Reviewer correction")
    (env.tmp_path / "next").mkdir()
    imported = run_import(
        env.db,
        bundle(
            env.tmp_path / "next", [correction_unit(env.target, "Imported correction")]
        ),
    )
    assert imported.status == "succeeded", imported.error
    with pytest.raises(DomainError, match="VARIANT_REVIEW_STALE"):
        env.service.submit(
            env.accesses["alice"], env.ids["alice"], expected_revision=rev
        )
    assert count(env, TranslationReviewRow) == 0
    assert (
        env.service.open(env.accesses["alice"], env.ids["alice"]).draft.text
        == "Reviewer correction"
    )


def test_submitted_writes_refused_and_manager_missing_document_concealed(review_env):
    env = review_env
    rev = save(env)
    env.service.submit(env.accesses["alice"], env.ids["alice"], expected_revision=rev)
    with pytest.raises(DomainError, match="ASSIGNMENT_SUBMITTED"):
        env.service.save_draft(
            env.accesses["alice"],
            env.ids["alice"],
            expected_revision=rev + 1,
            text="Changed",
            form={},
        )
    with pytest.raises(DomainError, match="ASSIGNMENT_SUBMITTED"):
        env.service.submit(
            env.accesses["alice"], env.ids["alice"], expected_revision=rev + 1
        )
    with pytest.raises(DomainError, match="DOCUMENT_NOT_FOUND"):
        env.service.records(env.accesses["root"], "proj", "missing")


@pytest.mark.parametrize(
    "change,code",
    [
        ("role", "ASSIGNMENT_NOT_FOUND"),
        ("active", "ASSIGNMENT_NOT_FOUND"),
        ("qualification", "QUALIFICATION_REQUIRED"),
        ("languages", None),
    ],
)
def test_queued_submit_uses_current_authority_qualification_and_languages(
    review_env, change, code
):
    env = review_env
    rev = save(env)
    waiting = Event()
    owner = get_ident()

    def at_lock(conn, cursor, statement, parameters, context, executemany):
        if get_ident() != owner and "pg_advisory_xact_lock_shared" in statement:
            waiting.set()

    event.listen(env.db.engine, "before_cursor_execute", at_lock)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            with env.db.transaction() as conn:
                conn.execute(
                    select(func.pg_advisory_xact_lock(_lock_id("members", "proj")))
                )
                future = pool.submit(
                    env.service.submit,
                    env.accesses["alice"],
                    env.ids["alice"],
                    expected_revision=rev,
                )
                assert waiting.wait(10)
                if change == "role":
                    conn.execute(
                        delete(ProjectMembershipRow).where(
                            ProjectMembershipRow.user_id
                            == env.accesses["alice"].user_id
                        )
                    )
                elif change == "active":
                    conn.execute(
                        update(UserRow)
                        .where(UserRow.id == env.accesses["alice"].user_id)
                        .values(active=False)
                    )
                elif change == "qualification":
                    conn.execute(
                        update(UserRow)
                        .where(UserRow.id == env.accesses["alice"].user_id)
                        .values(qualification="")
                    )
                else:
                    conn.execute(
                        update(UserLanguageRow)
                        .where(UserLanguageRow.user_id == env.accesses["alice"].user_id)
                        .values(language="fr")
                    )
            if code:
                with pytest.raises(DomainError, match=code):
                    future.result(timeout=15)
                assert count(env, TranslationReviewRow) == 0
            else:
                assert future.result(timeout=15).reviewer_languages == ["fr"]
    finally:
        event.remove(env.db.engine, "before_cursor_execute", at_lock)


def test_concurrent_draft_saves_share_one_revision_winner(review_env):
    env = review_env
    env.service.open(env.accesses["alice"], env.ids["alice"])
    barrier = Barrier(2)

    def write(text):
        barrier.wait()
        try:
            return env.service.save_draft(
                env.accesses["alice"],
                env.ids["alice"],
                expected_revision=0,
                text=text,
                form={},
            )
        except DomainError as exc:
            return exc.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(write, "first"), pool.submit(write, "second")]
        results = [f.result(timeout=15) for f in futures]
    assert sorted(map(str, results)) == ["1", "REVISION_CONFLICT"]


def test_review_only_started_work_rejects_profile_edit(review_env):
    env = review_env
    rev = save(env)
    env.service.submit(env.accesses["alice"], env.ids["alice"], expected_revision=rev)
    projects = ProjectService(env.db, env.app.state.ontology_store)
    with pytest.raises(DomainError, match="PROJECT_IN_USE"):
        projects.update_profile(HARNESS, "proj", projects.settings("proj").profile)


def test_native_assignment_cannot_open_translation_draft(review_env):
    env = review_env
    with env.db.transaction() as conn:
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == env.ids["alice"])
            .values(document_id="source")
        )
    with pytest.raises(DomainError, match="NOT_A_TRANSLATION"):
        env.service.open(env.accesses["alice"], env.ids["alice"])
    assert count(env, TranslationReviewDraftRow) == 0


def test_assigned_system_admin_without_current_task_role_has_no_work_bypass(review_env):
    env = review_env
    with env.db.transaction() as conn:
        aid = conn.execute(
            insert(AssignmentRow)
            .values(
                project_id=env.pid,
                document_id="target",
                user_id=env.accesses["root"].user_id,
                task="translation_review",
                status="open",
            )
            .returning(AssignmentRow.id)
        ).scalar_one()
    with pytest.raises(DomainError, match="ASSIGNMENT_NOT_FOUND"):
        env.service.open(env.accesses["root"], aid)
    assert count(env, TranslationReviewDraftRow) == 0


def test_translation_review_admin_activation_keeps_annotation_open_separate(review_env):
    env = review_env
    lead = logged_in(env.app, "leader", assignments=[])
    body = {"document_ids": ["target"], "task": "translation_review"}
    proposed = lead.post("/api/v1/projects/proj/assignments/proposal", json=body)
    assert (
        proposed.status_code == 200
        and proposed.json()["context"]["task"] == "translation_review"
    )
    assigned = lead.post(
        "/api/v1/projects/proj/assignments",
        json={
            "rows": [{"document_id": "comparison", "username": "alice"}],
            "task": "translation_review",
        },
    )
    assert assigned.status_code == 200
    assert (
        assigned.json()["created"] == []
        and assigned.json()["refused"][0]["code"] == "LANGUAGE_CONFIRMATION_REQUIRED"
    )
    alice = logged_in(env.app, "alice", assignments=[])
    opened = alice.post(f"/api/v1/assignments/{env.ids['alice']}/open")
    assert opened.status_code == 422 and opened.json()["code"] == "TASK_INVALID"
    assert count(env, TranslationReviewDraftRow) == 0


def test_submit_rechecks_revision_after_project_lock_wait(review_env):
    env = review_env
    rev = save(env)
    waiting = Event()
    owner = get_ident()

    def at_lock(conn, cursor, statement, parameters, context, executemany):
        if (
            get_ident() != owner
            and "pg_advisory_xact_lock(" in statement
            and "pg_advisory_xact_lock_shared" not in statement
        ):
            waiting.set()

    event.listen(env.db.engine, "before_cursor_execute", at_lock)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            with env.db.transaction() as conn:
                conn.execute(
                    select(
                        func.pg_advisory_xact_lock_shared(_lock_id("members", "proj"))
                    )
                )
                conn.execute(
                    select(
                        func.pg_advisory_xact_lock_shared(_lock_id("project", "proj"))
                    )
                )
                future = pool.submit(
                    env.service.submit,
                    env.accesses["alice"],
                    env.ids["alice"],
                    expected_revision=rev,
                )
                assert waiting.wait(10)
                conn.execute(
                    update(TranslationReviewDraftRow)
                    .where(TranslationReviewDraftRow.assignment_id == env.ids["alice"])
                    .values(revision=rev + 1)
                )
            with pytest.raises(DomainError, match="REVISION_CONFLICT"):
                future.result(timeout=15)
    finally:
        event.remove(env.db.engine, "before_cursor_execute", at_lock)
    assert count(env, TranslationReviewRow) == 0


@pytest.mark.parametrize("operation", ["open", "save", "submit"])
def test_authority_lock_graph_precedes_assignment_and_draft_rows(review_env, operation):
    env = review_env
    rev = save(env)
    statements = []

    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append((statement, parameters))

    event.listen(env.db.engine, "before_cursor_execute", capture)
    try:
        if operation == "open":
            env.service.open(env.accesses["alice"], env.ids["alice"])
        elif operation == "save":
            env.service.save_draft(
                env.accesses["alice"],
                env.ids["alice"],
                expected_revision=rev,
                text="draft",
                form={},
            )
        else:
            env.service.submit(
                env.accesses["alice"], env.ids["alice"], expected_revision=rev
            )
    finally:
        event.remove(env.db.engine, "before_cursor_execute", capture)
    advisory = [params for sql, params in statements if "pg_advisory_xact_lock" in sql]
    expected = ([_lock_id("import")] if operation == "submit" else []) + [
        _lock_id("members", "proj"),
        _lock_id("project", "proj"),
    ]
    assert [
        next(iter(params.values())) for params in advisory[: len(expected)]
    ] == expected
    actor = next(
        i
        for i, (sql, _) in enumerate(statements)
        if "FROM ontotator.users" in sql and "FOR SHARE" in sql
    )
    assignment = next(
        i
        for i, (sql, _) in enumerate(statements)
        if "FROM ontotator.assignments" in sql and "FOR NO KEY UPDATE" in sql
    )
    draft = next(
        i
        for i, (sql, _) in enumerate(statements)
        if "FROM ontotator.translation_review_drafts" in sql and "FOR UPDATE" in sql
    )
    assert actor < assignment < draft


@pytest.mark.parametrize(
    "form",
    [
        {},
        {"decision": "unknown", "clinical_change": False},
        {
            "decision": "accepted_unchanged",
            "clinical_change": False,
            "extra": "invalid",
        },
    ],
)
def test_incomplete_or_malformed_draft_forms_refuse_submission_without_writes(
    review_env, form
):
    env = review_env
    opened = env.service.open(env.accesses["alice"], env.ids["alice"])
    rev = env.service.save_draft(
        env.accesses["alice"],
        env.ids["alice"],
        expected_revision=opened.draft.revision,
        text=opened.text,
        form=form,
    )
    with pytest.raises(DomainError) as error:
        env.service.submit(
            env.accesses["alice"], env.ids["alice"], expected_revision=rev
        )
    assert error.value.code == "REVIEW_INVALID"
    assert error.value.details["issues"] == ["FORM_INVALID"]
    assert count(env, TranslationReviewRow) == 0
    assert env.service.open(env.accesses["alice"], env.ids["alice"]).draft.form == form
