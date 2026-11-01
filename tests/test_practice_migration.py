"""Migration 0028 (issue 266): practice projects, purely additive."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from alembic import command
from pg_harness import unmigrated_database_url
from sqlalchemy import Connection, Engine, create_engine, text

from ontotator.storage.schema import alembic_config, upgrade

REVISION = "0028"
PREVIOUS = "0027"
S = "ontotator"
TABLES = ("projects", "users", "documents", "assignments", "audit_events")


def _exec(conn: Connection, sql: str, **params: Any) -> Any:
    return conn.execute(text(sql), params)


def _seed(conn: Connection) -> None:
    _exec(
        conn,
        f"INSERT INTO {S}.projects (project_key, name, manifest, manifest_sha256,"
        " task_profile, task_profile_sha256) VALUES"
        " ('ward-7', 'Ward 7', '{}', 'm', '{}', 't'),"
        " ('practice-like', 'A real project with a practice-like key', '{}', 'm', '{}', 't')",
    )
    _exec(
        conn,
        f"INSERT INTO {S}.users (username, display_name, pseudonym)"
        " VALUES ('ann', 'Ann', 'ann-0001')",
    )
    _exec(
        conn,
        f"INSERT INTO {S}.documents (project_id, document_id, language, text,"
        " case_id, external_id, version, origin, text_sha256)"
        f" SELECT id, 'd1', 'en', 'x', 'c1', 'c1', 1, 'native', 'h' FROM {S}.projects",
    )
    _exec(
        conn,
        f"INSERT INTO {S}.assignments (project_id, document_id, user_id, task, status,"
        f" annotation_mode) SELECT p.id, 'd1', u.id, 'annotate', 'open', 'scratch'"
        f" FROM {S}.projects p, {S}.users u",
    )
    _exec(
        conn,
        f"INSERT INTO {S}.audit_events (actor_label, action, target_type, target_id,"
        f" project_id, details) SELECT 'cli:op', 'project.create', 'project',"
        f' project_key, id, \'{{"name": "x"}}\' FROM {S}.projects',
    )


def _rows(conn: Connection) -> dict[str, list[Any]]:
    """Every seeded row, without the columns 0028 adds."""
    result = {}
    for table in TABLES:
        rows = _exec(
            conn, f"SELECT to_jsonb(t) - 'practice' FROM {S}.{table} t"
        ).scalars()
        result[table] = sorted(rows, key=repr)
    return result


@pytest.fixture
def migrated(tmp_path: Any) -> Iterator[tuple[Engine, dict[str, list[Any]]]]:
    url = unmigrated_database_url(tmp_path / "practice-migration.db")
    upgrade(url, PREVIOUS)
    engine = create_engine(url)
    with engine.begin() as conn:
        _seed(conn)
        before = _rows(conn)
    upgrade(url, REVISION)
    yield engine, before
    engine.dispose()


def test_existing_rows_stay_unchanged_and_are_no_practice_projects(migrated):
    engine, before = migrated
    with engine.begin() as conn:
        assert _rows(conn) == before
        flags = _exec(
            conn, f"SELECT project_key, practice FROM {S}.projects ORDER BY 1"
        ).all()
        assert [tuple(row) for row in flags] == [
            ("practice-like", False),
            ("ward-7", False),
        ]
        assert (
            _exec(conn, f"SELECT count(*) FROM {S}.practice_projects").scalar_one() == 0
        )


def test_a_new_project_is_no_practice_project_by_default(migrated):
    engine, _ = migrated
    with engine.begin() as conn:
        _exec(
            conn,
            f"INSERT INTO {S}.projects (project_key, name, manifest, manifest_sha256,"
            " task_profile, task_profile_sha256) VALUES ('new', 'n', '{}', 'm', '{}', 't')",
        )
        assert (
            _exec(
                conn, f"SELECT practice FROM {S}.projects WHERE project_key = 'new'"
            ).scalar_one()
            is False
        )


def test_the_delete_function_refuses_every_existing_project(migrated):
    engine, before = migrated
    for key in ("ward-7", "practice-like"):
        with (
            pytest.raises(Exception, match="not a practice project"),
            engine.begin() as conn,
        ):
            _exec(
                conn,
                f"SELECT {S}.delete_practice_project(id) FROM {S}.projects"
                " WHERE project_key = :k",
                k=key,
            )
    with engine.begin() as conn:
        assert _rows(conn) == before


def test_downgrade_removes_only_the_new_things(migrated):
    engine, before = migrated
    with engine.begin() as conn:
        command.downgrade(alembic_config(conn), PREVIOUS)
    with engine.begin() as conn:
        assert _rows(conn) == before
        assert (
            _exec(
                conn,
                "SELECT count(*) FROM information_schema.columns WHERE table_schema = :s"
                " AND table_name = 'projects' AND column_name = 'practice'",
                s=S,
            ).scalar_one()
            == 0
        )
        assert (
            _exec(conn, f"SELECT to_regclass('{S}.practice_projects')").scalar_one()
            is None
        )
        assert (
            _exec(
                conn,
                "SELECT count(*) FROM pg_proc WHERE proname = 'delete_practice_project'",
            ).scalar_one()
            == 0
        )
        source = _exec(
            conn, "SELECT prosrc FROM pg_proc WHERE proname = 'forbid_history_change'"
        ).scalar_one()
        assert "practice" not in source


def test_downgrade_refuses_while_practice_projects_exist(migrated):
    engine, _ = migrated
    with engine.begin() as conn:
        _exec(
            conn,
            f"INSERT INTO {S}.projects (project_key, name, manifest, manifest_sha256,"
            " task_profile, task_profile_sha256, practice)"
            " VALUES ('practice-1-aa', 'P', '{}', 'm', '{}', 't', true)",
        )
        _exec(
            conn,
            f"INSERT INTO {S}.practice_projects (project_id, user_id)"
            f" SELECT p.id, u.id FROM {S}.projects p, {S}.users u"
            " WHERE p.project_key = 'practice-1-aa'",
        )
    with (
        pytest.raises(RuntimeError, match="practice projects exist"),
        engine.begin() as conn,
    ):
        command.downgrade(alembic_config(conn), PREVIOUS)


def test_the_practice_flag_cannot_change_after_insert(migrated):
    engine, _ = migrated
    # As the schema owner: no bypass for anybody.
    with pytest.raises(Exception, match="cannot change"), engine.begin() as conn:
        _exec(
            conn,
            f"UPDATE {S}.projects SET practice = true WHERE project_key = 'ward-7'",
        )
    with engine.begin() as conn:
        _exec(
            conn,
            f"INSERT INTO {S}.projects (project_key, name, manifest, manifest_sha256,"
            " task_profile, task_profile_sha256, practice)"
            " VALUES ('practice-1-bb', 'P', '{}', 'm', '{}', 't', true)",
        )
        # Other columns of either kind of project still change.
        _exec(conn, f"UPDATE {S}.projects SET name = name || '!'")
    with pytest.raises(Exception, match="cannot change"), engine.begin() as conn:
        _exec(
            conn,
            f"UPDATE {S}.projects SET practice = false WHERE project_key = 'practice-1-bb'",
        )


def test_a_practice_row_must_name_a_practice_project(migrated):
    engine, before = migrated
    with (
        pytest.raises(Exception, match="not a practice project"),
        engine.begin() as conn,
    ):
        _exec(
            conn,
            f"INSERT INTO {S}.practice_projects (project_id, user_id)"
            f" SELECT p.id, u.id FROM {S}.projects p, {S}.users u"
            " WHERE p.project_key = 'ward-7'",
        )
    with engine.begin() as conn:
        assert _rows(conn) == before
