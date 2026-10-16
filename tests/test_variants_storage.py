"""Real PostgreSQL variant storage contracts; execution needs the parent token."""

from pathlib import Path

import pytest
from layered_fixtures import make_layered_package
from pg_harness import database_for, owner_engine, unmigrated_database_url
from sqlalchemy import create_engine, delete, event, insert, select, text, update
from sqlalchemy.exc import DBAPIError, IntegrityError

from ontocurator.authz.policy import Access
from ontocurator.authz.scoped import ScopedRepository
from ontocurator.domain.documents import Document
from ontocurator.domain.errors import DomainError
from ontocurator.exchange.t1 import ImportedDocument
from ontocurator.storage.repository import Repository
from ontocurator.storage.schema import upgrade
from ontocurator.storage.tables import (
    AssignmentRow,
    DocumentRow,
    ProjectMembershipRow,
    ProjectRow,
    ProposalSetRow,
    TranslationReviewDraftRow,
    TranslationReviewRow,
    UserRow,
)


@pytest.fixture
def stored(tmp_path):
    db = database_for(tmp_path / "variants.db")
    with db.transaction() as conn:
        pid = conn.execute(
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
        uid = conn.execute(
            insert(UserRow)
            .values(username="reader", display_name="Reader", pseudonym="reader")
            .returning(UserRow.id)
        ).scalar_one()
        conn.execute(
            insert(ProjectMembershipRow).values(
                project_id=pid, user_id=uid, role="annotator"
            )
        )
        conn.execute(
            insert(DocumentRow).values(
                project_id=pid,
                document_id="native",
                case_id="case",
                external_id="native",
                position=9,
                language="en",
                text="source",
                text_sha256="a" * 64,
            )
        )
        aid = conn.execute(
            insert(AssignmentRow)
            .values(
                project_id=pid,
                document_id="native",
                user_id=uid,
                task="annotate",
                status="submitted",
            )
            .returning(AssignmentRow.id)
        ).scalar_one()
    return db, pid, uid, aid


def _document(pid, **changes):
    return {
        "project_id": pid,
        "document_id": "translation",
        "case_id": "case",
        "external_id": "native",
        "version": 1,
        "origin": "machine_translation",
        "derived_from": "native",
        "language": "de",
        "text": "Ziel",
        "text_sha256": "b" * 64,
        "translation_status": "ready_for_review",
        **changes,
    }


def _review(pid, uid, aid):
    return dict(
        project_id=pid,
        document_id="native",
        assignment_id=aid,
        reviewer_user_id=uid,
        reviewer_pseudonym="reader",
        reviewer_qualification="physician",
        reviewer_languages=["en", "de"],
        decision="accepted_unchanged",
        clinical_change=False,
        machine_text_sha256="a" * 64,
        proposed_text="source",
        proposed_text_sha256="a" * 64,
        status_before="ready_for_review",
        status_after="accepted",
        review_policy="ontocurator-translation-review/v1",
    )


def test_existing_documents_become_native_variants(tmp_path: Path):
    url = unmigrated_database_url(tmp_path / "old.db")
    upgrade(url, "0005")
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            pid = conn.execute(
                text(
                    "INSERT INTO ontocurator.projects (project_key,name,manifest,manifest_sha256,task_profile,task_profile_sha256) VALUES ('p','P','{}','m','{}','t') RETURNING id"
                )
            ).scalar_one()
            conn.execute(
                text(
                    "INSERT INTO ontocurator.documents (project_id,document_id,language,text,text_sha256,source_text_sha256,position) VALUES (:p,'old','en','Text','sha','raw',23)"
                ),
                {"p": pid},
            )
            uid = conn.execute(
                text(
                    "INSERT INTO ontocurator.users (username,display_name,pseudonym) VALUES ('reader','Reader','reader') RETURNING id"
                )
            ).scalar_one()
            conn.execute(
                text(
                    "INSERT INTO ontocurator.stored_files (sha256,size) VALUES ('blob',1)"
                )
            )
            conn.execute(
                text(
                    "INSERT INTO ontocurator.proposal_sets (project_id,document_id,annotation_set_id,set_kind,actors,payload,source_sha256) VALUES (:p,'old','set','tool_output','[]','{}','blob')"
                ),
                {"p": pid},
            )
        upgrade(url, "0006")
        with engine.connect() as conn:
            row = conn.execute(select(DocumentRow)).mappings().one()
            assert (
                row["case_id"],
                row["external_id"],
                row["version"],
                row["origin"],
            ) == ("old", "old", 1, "native")
            assert (
                row["text"],
                row["text_sha256"],
                row["source_text_sha256"],
                row["position"],
            ) == ("Text", "sha", "raw", 23)
            assert all(
                row[name] is None
                for name in (
                    "derived_from",
                    "translation",
                    "translation_status",
                    "status_reason",
                )
            )
            assert (
                conn.execute(
                    select(ProjectRow.annotate_accepted_translations_only)
                ).scalar_one()
                is True
            )
            assert (
                conn.execute(
                    select(UserRow.qualification).where(UserRow.id == uid)
                ).scalar_one()
                is None
            )
            proposal = conn.execute(select(ProposalSetRow)).mappings().one()
            assert (
                proposal["origin"],
                proposal["pending_items"],
                proposal["source_sha256"],
                proposal["payload"],
            ) == ("import", [], "blob", {})
    finally:
        engine.dispose()


@pytest.mark.parametrize(
    "changes",
    [
        {"translation_status": None},
        {"translation_status": "invented"},
        {"origin": "invented"},
        {"version": 0},
    ],
)
def test_invalid_variant_constraints_are_enforced(stored, changes):
    db, pid, _, _ = stored
    with pytest.raises(IntegrityError), db.transaction() as conn:
        conn.execute(insert(DocumentRow).values(**_document(pid, **changes)))


@pytest.mark.parametrize("field", ["case_id", "external_id"])
def test_variant_identity_is_not_nullable(stored, field):
    db, pid, _, _ = stored
    with pytest.raises(IntegrityError), db.transaction() as conn:
        conn.execute(insert(DocumentRow).values(**_document(pid, **{field: None})))


def test_review_decision_constraint_is_enforced(stored):
    db, pid, uid, aid = stored
    record = {**_review(pid, uid, aid), "decision": "invented"}
    with pytest.raises(IntegrityError), db.transaction() as conn:
        conn.execute(insert(TranslationReviewRow).values(**record))


def test_identity_is_unique_per_project_external_language_version(stored):
    db, pid, _, _ = stored
    with db.transaction() as conn:
        conn.execute(insert(DocumentRow).values(**_document(pid)))
    with pytest.raises(IntegrityError), db.transaction() as conn:
        conn.execute(
            insert(DocumentRow).values(**_document(pid, document_id="duplicate"))
        )
    with db.transaction() as conn:
        conn.execute(
            insert(DocumentRow).values(
                **_document(
                    pid,
                    document_id="v2",
                    version=2,
                    origin="correction",
                    derived_from="translation",
                )
            )
        )
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
                **_document(other, document_id="translation", derived_from=None)
            )
        )


def test_derived_from_cannot_reference_another_project(stored):
    db, _pid, _, _ = stored
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
    with pytest.raises(IntegrityError), db.transaction() as conn:
        conn.execute(insert(DocumentRow).values(**_document(other)))


@pytest.mark.parametrize("owner", [False, True])
@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE ontocurator.translation_reviews SET proposed_text='changed'",
        "DELETE FROM ontocurator.translation_reviews",
        "TRUNCATE ontocurator.translation_reviews",
    ],
)
def test_review_history_is_immutable_to_application_and_owner(stored, owner, statement):
    db, pid, uid, aid = stored
    with db.transaction() as conn:
        review = conn.execute(
            insert(TranslationReviewRow)
            .values(**_review(pid, uid, aid))
            .returning(TranslationReviewRow.id)
        ).scalar_one()
        assert review > 0  # app has the identity sequence grant
        assert conn.execute(select(TranslationReviewRow.categories)).scalar_one() == []
    engine = owner_engine(db) if owner else db.engine
    with (
        pytest.raises(
            DBAPIError, match="append-only" if owner else "permission denied"
        ),
        engine.begin() as conn,
    ):
        conn.execute(text(statement))


def test_review_draft_is_mutable_with_defaults(stored):
    db, _, uid, aid = stored
    with db.transaction() as conn:
        conn.execute(
            insert(TranslationReviewDraftRow).values(
                assignment_id=aid, text="draft", updated_by=uid
            )
        )
        row = conn.execute(select(TranslationReviewDraftRow)).mappings().one()
        assert row["form"] == {} and row["revision"] == 0
        conn.execute(
            update(TranslationReviewDraftRow).values(text="edited", revision=1)
        )
        assert (
            conn.execute(select(TranslationReviewDraftRow.text)).scalar_one()
            == "edited"
        )
        conn.execute(delete(TranslationReviewDraftRow))


def test_reanchored_set_allows_no_source_blob_and_retains_history(stored):
    db, pid, _, _ = stored
    with db.transaction() as conn:
        conn.execute(
            insert(ProposalSetRow).values(
                project_id=pid,
                document_id="native",
                annotation_set_id="reanchor",
                set_kind="tool_output",
                actors=[],
                payload={},
                origin="reanchor",
                source_sha256=None,
            )
        )
        row = conn.execute(select(ProposalSetRow)).mappings().one()
        assert row["source_sha256"] is None and row["pending_items"] == []
    with pytest.raises(DBAPIError, match="permission denied"), db.transaction() as conn:
        conn.execute(update(ProposalSetRow).values(origin="import"))


def test_both_native_repository_writers_populate_identity(tmp_path):
    db = database_for(tmp_path / "writers.db")
    repo = Repository(db)
    package = make_layered_package("single")
    key = repo.import_package(package)
    for document in package.documents.values():
        info = repo.get_variant(key, document.document_id)
        assert (info.case_id, info.external_id, info.version, info.origin) == (
            document.document_id,
            document.document_id,
            1,
            "native",
        )
    document = Document(
        document_id="new",
        language="en",
        text="",
        text_sha256="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    )
    first = repo.add_documents_and_proposals(
        key, [ImportedDocument(document)], [], source_sha256="unused"
    )
    again = repo.add_documents_and_proposals(
        key, [ImportedDocument(document)], [], source_sha256="unused"
    )
    assert first["documents_added"] == 1 and again["documents_added"] == 0
    info = repo.get_variant(key, "new")
    assert (info.case_id, info.external_id, info.version, info.origin) == (
        "new",
        "new",
        1,
        "native",
    )


def test_metadata_reads_are_ordered_case_filtered_and_text_free(stored):
    db, pid, _, _ = stored
    with db.transaction() as conn:
        conn.execute(insert(DocumentRow).values(**_document(pid, position=23)))
        conn.execute(
            insert(DocumentRow).values(
                **_document(
                    pid,
                    document_id="last",
                    external_id="last",
                    case_id="other",
                    position=None,
                )
            )
        )
    statements = []

    def record(_conn, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    event.listen(db.engine, "before_cursor_execute", record)
    try:
        repo = Repository(db)
        assert [v.document_id for v in repo.list_variants("p")] == [
            "native",
            "translation",
            "last",
        ]
        assert [v.document_id for v in repo.list_variants("p", case_id="case")] == [
            "native",
            "translation",
        ]
        assert [
            v.document_id for v in repo.find_variants_by_text_sha256("p", "b" * 64)
        ] == ["translation", "last"]
        assert repo.get_variant("p", "native").text_sha256 == "a" * 64
    finally:
        event.remove(db.engine, "before_cursor_execute", record)
    assert len(statements) == 8  # one project ID and one metadata query per call
    assert not any(
        "documents.text," in sql or "documents.text \n" in sql or "payload" in sql
        for sql in statements
    )


@pytest.mark.parametrize("loss", ["revocation", "role", "inactive"])
def test_scoped_metadata_never_reveals_hidden_documents_after_authority_loss(
    stored, loss
):
    db, pid, uid, aid = stored
    with db.transaction() as conn:
        conn.execute(insert(DocumentRow).values(**_document(pid)))
    scoped = ScopedRepository(
        db, Access(uid, "reader", False, {"p": frozenset({"annotator"})})
    )
    assert [v.document_id for v in scoped.list_variants("p")] == ["native"]
    assert scoped.find_variants_by_text_sha256("p", "b" * 64) == []
    with pytest.raises(DomainError, match="DOCUMENT_NOT_FOUND"):
        scoped.get_variant("p", "translation")
    with db.transaction() as conn:
        if loss == "revocation":
            conn.execute(
                update(AssignmentRow)
                .where(AssignmentRow.id == aid)
                .values(revoked_at=text("now()"))
            )
        elif loss == "role":
            conn.execute(
                delete(ProjectMembershipRow).where(
                    ProjectMembershipRow.project_id == pid,
                    ProjectMembershipRow.user_id == uid,
                )
            )
        else:
            conn.execute(update(UserRow).where(UserRow.id == uid).values(active=False))
    assert scoped.list_variants("p") == []
    assert scoped.find_variants_by_text_sha256("p", "a" * 64) == []
    with pytest.raises(DomainError, match="DOCUMENT_NOT_FOUND"):
        scoped.get_variant("p", "native")


@pytest.mark.parametrize("privilege", ["lead", "system_admin"])
def test_current_lead_or_system_admin_can_read_all_variant_metadata(stored, privilege):
    db, pid, uid, _ = stored
    with db.transaction() as conn:
        conn.execute(insert(DocumentRow).values(**_document(pid)))
        if privilege == "lead":
            conn.execute(
                insert(ProjectMembershipRow).values(
                    project_id=pid, user_id=uid, role="lead"
                )
            )
        else:
            conn.execute(
                delete(ProjectMembershipRow).where(ProjectMembershipRow.user_id == uid)
            )
            conn.execute(
                update(UserRow).where(UserRow.id == uid).values(is_system_admin=True)
            )
    access = Access(
        uid,
        "reader",
        privilege == "system_admin",
        {"p": frozenset({"lead"})} if privilege == "lead" else {},
    )
    scoped = ScopedRepository(db, access)
    assert [v.document_id for v in scoped.list_variants("p")] == [
        "native",
        "translation",
    ]
    assert scoped.get_variant("p", "translation").origin == "machine_translation"
