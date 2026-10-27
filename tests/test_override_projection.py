"""Authoritative manual-acceptance metadata; PG execution needs root's token."""

from datetime import UTC, datetime, timedelta

import pytest
from auth_harness import logged_in
from pydantic import ValidationError
from sqlalchemy import delete, event, insert, select, update
from t1_builders import bundle
from t1_fixtures import create_project
from test_translation_review_service import review_env as review_env
from test_translation_review_service import save
from test_variant_import import commit, override, preview

from ontotator.api.document_projection import ProjectDocumentSummary
from ontotator.auth.audit import Actor, record_audit
from ontotator.storage.tables import (
    AuditEventRow,
    DocumentRow,
    ProjectMembershipRow,
    ProjectRow,
)

BASE = "/api/v1/projects/proj/documents"


def test_full_summary_requires_explicit_override_provenance():
    fields = dict(
        document_id="target",
        language="de",
        text_length=9,
        position=1,
        case_id="case",
        external_id="target",
        version=1,
        origin="machine_translation",
        translation_status="accepted",
        status_reason="translation review 123",
    )
    with pytest.raises(ValidationError, match="accepted_without_review"):
        ProjectDocumentSummary(**fields)
    assert not ProjectDocumentSummary(
        **fields, accepted_without_review=False
    ).accepted_without_review


def lead(env):
    return logged_in(env.app, "leader", projects={"proj": ["lead"]}, assignments=[])


def rows(client):
    response = client.get(BASE)
    assert response.status_code == 200, response.text
    return {row["document_id"]: row for row in response.json()}


def accept_without_review(env, client):
    override_dir = env.tmp_path / "override"
    override_dir.mkdir()
    path = bundle(override_dir, [env.source, env.target])
    commit(
        env.app,
        client,
        preview(env.app, client, path),
        [override(external_id="target", reason="translation review 123")],
    )
    return path


def test_real_override_and_identical_reimport_preserve_authoritative_flag(review_env):
    env = review_env
    client = lead(env)
    assert all(not row["accepted_without_review"] for row in rows(client).values())
    path = accept_without_review(env, client)
    row = rows(client)["target"]
    assert row["translation_status"] == "accepted"
    assert row["status_reason"] == "translation review 123"
    assert row["accepted_without_review"] is True
    commit(env.app, client, preview(env.app, client, path))
    assert rows(client)["target"] == row


def test_real_review_after_override_wins_even_when_old_reason_remains(review_env):
    env = review_env
    client = lead(env)
    accept_without_review(env, client)
    revision = save(env)
    record = env.service.submit(
        env.accesses["alice"], env.ids["alice"], expected_revision=revision
    )
    assert record.status_after == "accepted"
    row = rows(client)["target"]
    assert row["status_reason"] == "translation review 123"
    assert row["accepted_without_review"] is False


def test_real_review_created_accepted_correction_has_no_override(review_env):
    env = review_env
    client = lead(env)
    accept_without_review(env, client)
    revision = save(env, "accepted_corrected", "Korrigiert")
    record = env.service.submit(
        env.accesses["alice"], env.ids["alice"], expected_revision=revision
    )
    row = rows(client)[record.created_variant_id]
    assert row["origin"] == "correction"
    assert row["translation_status"] == "accepted"
    assert row["accepted_without_review"] is False


def test_latest_audit_id_not_timestamp_reason_or_unrelated_events_controls_flag(
    review_env,
):
    env = review_env
    client = lead(env)
    actor = Actor.user(env.accesses["leader"].user_id, "leader")
    with env.db.transaction() as conn:
        conn.execute(
            update(DocumentRow)
            .where(
                DocumentRow.project_id == env.pid, DocumentRow.document_id == "target"
            )
            .values(translation_status="accepted", status_reason="Unrelated wording")
        )
        now = datetime.now(UTC)
        for action, at in [
            ("translation.review", now),
            ("variant.status_override", now - timedelta(days=1)),
            ("document.view", now + timedelta(days=1)),
        ]:
            record_audit(
                conn,
                actor,
                action,
                project_id=env.pid,
                target_type="document",
                target_id="target",
                at=at,
            )
    assert rows(client)["target"]["accepted_without_review"] is True
    with env.db.transaction() as conn:
        record_audit(
            conn,
            actor,
            "translation.review",
            project_id=env.pid,
            target_type="document",
            target_id="target",
            at=now - timedelta(days=2),
        )
    assert rows(client)["target"]["accepted_without_review"] is False


def test_exact_project_document_and_target_type_isolation_and_current_status(
    review_env,
):
    env = review_env
    client = lead(env)
    create_project(env.db, "other")
    actor = Actor.user(env.accesses["leader"].user_id, "leader")
    with env.db.transaction() as conn:
        other_pid = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == "other")
        ).scalar_one()
        conn.execute(
            update(DocumentRow)
            .where(
                DocumentRow.project_id == env.pid, DocumentRow.document_id == "target"
            )
            .values(translation_status="accepted")
        )
        for pid, target, target_type in [
            (other_pid, "target", "document"),
            (env.pid, "source", "document"),
            (env.pid, "target", "project"),
        ]:
            record_audit(
                conn,
                actor,
                "variant.status_override",
                project_id=pid,
                target_type=target_type,
                target_id=target,
                details={"document_id": "target"},
            )
    result = rows(client)
    assert all(not row["accepted_without_review"] for row in result.values())


@pytest.mark.parametrize(
    "status", ["translated", "automatic_check_failed", "ready_for_review", "reviewed"]
)
def test_nonaccepted_current_status_never_claims_manual_acceptance(review_env, status):
    env = review_env
    client = lead(env)
    accept_without_review(env, client)
    with env.db.transaction() as conn:
        conn.execute(
            update(DocumentRow)
            .where(
                DocumentRow.project_id == env.pid, DocumentRow.document_id == "target"
            )
            .values(translation_status=status)
        )
    row = rows(client)["target"]
    assert row["translation_status"] == status
    assert row["accepted_without_review"] is False


@pytest.mark.parametrize("count", [1, 100])
def test_override_metadata_is_batched_and_not_exposed(review_env, count):
    env = review_env
    client = lead(env)
    with env.db.transaction() as conn:
        conn.execute(
            insert(DocumentRow),
            [
                dict(
                    project_id=env.pid,
                    document_id=f"extra-{i}",
                    case_id=f"case-{i}",
                    external_id=f"extra-{i}",
                    language="de",
                    position=10 + i,
                    text="Private body",
                    text_sha256="0" * 64,
                    origin="machine_translation",
                    translation_status="accepted",
                )
                for i in range(count)
            ],
        )
        conn.execute(
            insert(AuditEventRow),
            [
                dict(
                    actor_label="test:operator",
                    action="variant.status_override",
                    target_type="document",
                    target_id=f"extra-{i}",
                    project_id=env.pid,
                    details={"private": "must not be selected"},
                )
                for i in range(count)
            ],
        )
    statements = []

    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(env.db.engine, "before_cursor_execute", capture)
    try:
        result = rows(client)
    finally:
        event.remove(env.db.engine, "before_cursor_execute", capture)
    assert sum(row["accepted_without_review"] for row in result.values()) == count
    audit_queries = [sql for sql in statements if "FROM ontotator.audit_events" in sql]
    assert len(audit_queries) == 1
    assert "audit_events.details" not in audit_queries[0]
    assert "audit_events.actor" not in audit_queries[0]
    assert len(statements) <= 30
    assert not any("Private body" in str(row) for row in result.values())
    assert all("details" not in row and "action" not in row for row in result.values())


def test_ordinary_current_authority_precedes_override_projection(review_env):
    env = review_env
    client = lead(env)
    accept_without_review(env, client)
    ordinary = logged_in(
        env.app, "alice", projects={"proj": ["annotator"]}, assignments=[]
    )
    assert set(rows(ordinary)) == {"target"}
    assert rows(ordinary)["target"]["accepted_without_review"] is True
    with env.db.transaction() as conn:
        conn.execute(
            delete(ProjectMembershipRow).where(
                ProjectMembershipRow.project_id == env.pid,
                ProjectMembershipRow.user_id == env.accesses["alice"].user_id,
            )
        )
    statements = []

    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(env.db.engine, "before_cursor_execute", capture)
    try:
        response = ordinary.get(BASE)
    finally:
        event.remove(env.db.engine, "before_cursor_execute", capture)
    assert response.status_code in (403, 404)
    assert "accepted_without_review" not in response.text
    assert not any("FROM ontotator.audit_events" in sql for sql in statements)
