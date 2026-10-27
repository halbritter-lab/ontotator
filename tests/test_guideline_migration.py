"""0018 creates the guideline tables and stamps, and drops the old fields (spec G18)."""

from typing import Any

import pytest
from alembic import command
from pg_harness import PASSWORD, unmigrated_database_url
from sqlalchemy import Engine, create_engine, make_url, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from ontotator.storage.schema import alembic_config, upgrade
from ontotator.storage.tables import APP_ROLE

S = "ontotator"
TABLES = (
    "guideline_versions",
    "guideline_contents",
    "guideline_withdrawals",
    "guideline_reads",
)


def _exec(conn, sql: str, **params: Any) -> Any:
    return conn.execute(text(sql), params)


def _seed(conn) -> None:
    _exec(
        conn,
        f"INSERT INTO {S}.projects (project_key, name, manifest, manifest_sha256,"
        " task_profile, task_profile_sha256, guideline_url, guideline_version)"
        " VALUES ('p', 'p', '{}', 'm', '{}', 't', 'https://example.org/g', 'v1')",
    )
    for name, pseudonym in (("ann", "ann-0001"), ("lead", "lead-0002")):
        _exec(
            conn,
            f"INSERT INTO {S}.users (username, display_name, pseudonym)"
            " VALUES (:u, :u, :p)",
            u=name,
            p=pseudonym,
        )
    _exec(
        conn,
        f"INSERT INTO {S}.documents (project_id, document_id, language, text,"
        " case_id, external_id, version, origin, translation_status, text_sha256)"
        " SELECT id, 'd1', 'de', 'x', 'c1', 'd1', 1, 'machine_translation',"
        f" 'ready_for_review', 'h' FROM {S}.projects",
    )
    _exec(
        conn,
        f"INSERT INTO {S}.assignments (project_id, document_id, user_id, task)"
        f" SELECT p.id, 'd1', u.id, 'translation_review' FROM {S}.projects p,"
        f" {S}.users u WHERE u.username = 'ann'",
    )


@pytest.fixture
def migrated(tmp_path) -> Any:
    url = unmigrated_database_url(tmp_path / "guidelines-0018.db")
    upgrade(url, "0017")
    engine = create_engine(url)
    with engine.begin() as conn:
        _seed(conn)
    upgrade(url, "0018")
    yield url, engine
    engine.dispose()


@pytest.fixture
def app_engine(migrated) -> Any:
    engine = create_engine(
        make_url(migrated[0]).set(username=APP_ROLE, password=PASSWORD)
    )
    yield engine
    engine.dispose()


def _version(conn, version: int, **overrides: Any) -> None:
    values = {
        "version": version,
        "kind": "markdown",
        "size_bytes": 10,
        **overrides,
    }
    _exec(
        conn,
        f"INSERT INTO {S}.guideline_versions (project_id, version, kind, body_sha256,"
        " size_bytes, created_by, created_by_label) SELECT p.id, :version, :kind,"
        f" 'h', :size_bytes, u.id, 'lead-0002' FROM {S}.projects p, {S}.users u"
        " WHERE u.username = 'lead'",
        **values,
    )


def _content(conn, version: int, note: str | None = None) -> None:
    _exec(
        conn,
        f"INSERT INTO {S}.guideline_contents (project_id, version, filename, body,"
        f" change_note) SELECT id, :v, 'g.md', '# G', :note FROM {S}.projects",
        v=version,
        note=note,
    )


def _withdrawal(conn, version: int) -> None:
    _exec(
        conn,
        f"INSERT INTO {S}.guideline_withdrawals (project_id, version, reason,"
        " withdrawn_by, withdrawn_by_label) SELECT p.id, :v, 'wrong file', u.id,"
        f" 'lead-0002' FROM {S}.projects p, {S}.users u WHERE u.username = 'lead'",
        v=version,
    )


def _columns(engine: Engine, table: str) -> set[str]:
    with engine.connect() as conn:
        return set(
            _exec(
                conn,
                "SELECT column_name FROM information_schema.columns"
                " WHERE table_schema = :s AND table_name = :t",
                s=S,
                t=table,
            ).scalars()
        )


def _tables(engine: Engine) -> set[str]:
    with engine.connect() as conn:
        return set(
            _exec(
                conn,
                "SELECT table_name FROM information_schema.tables"
                " WHERE table_schema = :s AND table_name LIKE 'guideline%'",
                s=S,
            ).scalars()
        )


def test_upgrade_creates_tables_and_stamp_columns_and_drops_old_fields(
    migrated,
) -> None:
    _url, engine = migrated
    assert _tables(engine) == set(TABLES)
    assert _columns(engine, "guideline_reads") == {
        "project_id",
        "version",
        "user_id",
        "notified_at",
        "opened_at",
    }
    assert "guideline_version" in _columns(engine, "submissions")
    assert "guideline_version" in _columns(engine, "translation_reviews")
    project = _columns(engine, "projects")
    assert "guideline_url" not in project
    assert "guideline_version" not in project


def test_downgrade_readds_old_columns_empty_and_drops_tables(migrated) -> None:
    _url, engine = migrated
    with engine.begin() as conn:
        _version(conn, 1)
        _content(conn, 1)
        command.downgrade(alembic_config(conn), "0017")
    assert _tables(engine) == set()
    assert "guideline_version" not in _columns(engine, "submissions")
    assert "guideline_version" not in _columns(engine, "translation_reviews")
    with engine.connect() as conn:
        row = _exec(
            conn, f"SELECT guideline_url, guideline_version FROM {S}.projects"
        ).one()
    assert tuple(row) == (None, None)


def test_append_only_guideline_tables_refuse_update_and_delete(migrated) -> None:
    _url, engine = migrated
    with engine.begin() as conn:
        _version(conn, 1)
        _withdrawal(conn, 1)
    for table in ("guideline_versions", "guideline_withdrawals"):
        for statement in (
            f"UPDATE {S}.{table} SET project_id = project_id",
            f"DELETE FROM {S}.{table}",
        ):
            with pytest.raises(DBAPIError, match="append-only"), engine.begin() as conn:
                _exec(conn, statement)


def test_app_role_may_delete_contents_but_not_versions(migrated, app_engine) -> None:
    with app_engine.begin() as conn:
        _version(conn, 1)
        _content(conn, 1, "first")
        _withdrawal(conn, 1)
    with app_engine.begin() as conn:
        assert _exec(conn, f"DELETE FROM {S}.guideline_contents").rowcount == 1
    for statement in (
        f"DELETE FROM {S}.guideline_versions",
        f"DELETE FROM {S}.guideline_withdrawals",
        f"UPDATE {S}.guideline_versions SET kind = 'text'",
    ):
        with (
            pytest.raises(DBAPIError, match="permission denied"),
            app_engine.begin() as conn,
        ):
            _exec(conn, statement)


def test_reads_are_updatable_by_the_app_role(migrated, app_engine) -> None:
    with app_engine.begin() as conn:
        _version(conn, 1)
        _exec(
            conn,
            f"INSERT INTO {S}.guideline_reads (project_id, version, user_id,"
            f" notified_at) SELECT p.id, 1, u.id, now() FROM {S}.projects p,"
            f" {S}.users u WHERE u.username = 'ann'",
        )
        _exec(conn, f"UPDATE {S}.guideline_reads SET opened_at = now()")
        row = _exec(
            conn, f"SELECT notified_at, opened_at FROM {S}.guideline_reads"
        ).one()
    assert row.notified_at is not None
    assert row.opened_at is not None


def _submission(conn, submission_id: str, version: int | None) -> None:
    _exec(
        conn,
        f"INSERT INTO {S}.submissions (project_id, submission_id, local_key,"
        " origin_key, document_id, annotator_id, mode, draft_revision, payload,"
        " created_at, guideline_version) SELECT id, :sid, 'k', 'k', 'd1',"
        f" 'ann-0001', 'independent', 1, '{{}}', '2026-10-21', :v FROM {S}.projects",
        sid=submission_id,
        v=version,
    )


def _review(conn, version: int | None) -> None:
    _exec(
        conn,
        f"INSERT INTO {S}.translation_reviews (project_id, document_id, assignment_id,"
        " reviewer_user_id, reviewer_pseudonym, reviewer_qualification,"
        " reviewer_languages, decision, clinical_change, machine_text_sha256,"
        " proposed_text, proposed_text_sha256, status_before, status_after,"
        " review_policy, guideline_version) SELECT a.project_id, a.document_id,"
        " a.id, a.user_id, 'ann-0001', 'q', '[]', 'query', false, 'h', 'x', 'h',"
        f" 'ready_for_review', 'reviewed', 'p', :v FROM {S}.assignments a",
        v=version,
    )


def test_stamp_columns_accept_inserts_on_append_only_tables(
    migrated, app_engine
) -> None:
    with app_engine.begin() as conn:
        _version(conn, 1)
        _submission(conn, "s1", 1)
        _submission(conn, "s2", None)
        _review(conn, 1)
        _review(conn, None)
        stamps = _exec(
            conn,
            f"SELECT guideline_version FROM {S}.submissions ORDER BY submission_id",
        ).scalars()
        assert list(stamps) == [1, None]
    with pytest.raises(IntegrityError), app_engine.begin() as conn:
        _submission(conn, "s3", 2)
    with pytest.raises(IntegrityError), app_engine.begin() as conn:
        _review(conn, 2)


@pytest.mark.parametrize(
    "statement",
    [
        "version 0",
        "kind html",
        "size 262145",
        "note 281",
        "reason 281",
    ],
)
def test_checks(migrated, statement: str) -> None:
    _url, engine = migrated
    with engine.begin() as conn:
        _version(conn, 1)
    with pytest.raises(IntegrityError), engine.begin() as conn:
        if statement == "version 0":
            _version(conn, 0)
        elif statement == "kind html":
            _version(conn, 2, kind="html")
        elif statement == "size 262145":
            _version(conn, 2, size_bytes=262_145)
        elif statement == "note 281":
            _content(conn, 1, "x" * 281)
        else:
            _exec(
                conn,
                f"INSERT INTO {S}.guideline_withdrawals (project_id, version, reason,"
                " withdrawn_by, withdrawn_by_label) SELECT p.id, 1, :r, u.id,"
                f" 'lead' FROM {S}.projects p, {S}.users u WHERE u.username = 'lead'",
                r="x" * 281,
            )
    with engine.begin() as conn:
        _version(conn, 2, size_bytes=262_144)
        _content(conn, 2, "x" * 280)
