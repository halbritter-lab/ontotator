"""Migration 0021: tool proposal mode, plan override, assignment mode."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from alembic import command
from pg_harness import unmigrated_database_url
from sqlalchemy import Connection, Engine, create_engine, text
from sqlalchemy.exc import IntegrityError

from ontotator.storage.schema import alembic_config, upgrade

REVISION = "0021"
PREVIOUS = "0020"
S = "ontotator"


def _exec(conn: Connection, sql: str, **params: Any) -> Any:
    return conn.execute(text(sql), params)


def _seed(conn: Connection) -> None:
    _exec(
        conn,
        f"INSERT INTO {S}.projects (project_key, name, manifest, manifest_sha256,"
        " task_profile, task_profile_sha256) VALUES ('old', 'old', '{}', 'm', '{}', 't')",
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
    for task in ("annotate", "review", "translation_review"):
        _exec(
            conn,
            f"INSERT INTO {S}.assignments (project_id, document_id, user_id, task, status)"
            f" SELECT p.id, 'd1', u.id, :task, 'open' FROM {S}.projects p, {S}.users u",
            task=task,
        )
    _exec(
        conn,
        f"INSERT INTO {S}.work_plan_rows (project_id, case_id, language, review,"
        f" annotate, decided) SELECT id, 'c1', 'en', false, true, true FROM {S}.projects",
    )


@pytest.fixture
def migrated(tmp_path) -> Iterator[tuple[str, Engine]]:
    url = unmigrated_database_url(tmp_path / "proposal-check-migration.db")
    upgrade(url, PREVIOUS)
    engine = create_engine(url)
    with engine.begin() as conn:
        _seed(conn)
    upgrade(url, REVISION)
    yield url, engine
    engine.dispose()


def test_existing_projects_keep_scratch_and_new_projects_get_proposals(migrated):
    _url, engine = migrated
    with engine.begin() as conn:
        assert (
            _exec(conn, f"SELECT tool_proposal_mode FROM {S}.projects").scalar_one()
            == "scratch"
        )
        _exec(
            conn,
            f"INSERT INTO {S}.projects (project_key, name, manifest, manifest_sha256,"
            " task_profile, task_profile_sha256) VALUES ('new', 'new', '{}', 'm', '{}', 't')",
        )
        assert (
            _exec(
                conn,
                f"SELECT tool_proposal_mode FROM {S}.projects"
                " WHERE project_key = 'new'",
            ).scalar_one()
            == "proposals"
        )


def test_existing_annotate_assignments_are_scratch_others_null(migrated):
    _url, engine = migrated
    with engine.begin() as conn:
        rows = dict(
            _exec(conn, f"SELECT task, annotation_mode FROM {S}.assignments").all()
        )
    assert rows == {"annotate": "scratch", "review": None, "translation_review": None}


def test_plan_override_is_null_by_default(migrated):
    _url, engine = migrated
    with engine.begin() as conn:
        assert (
            _exec(conn, f"SELECT annotation_mode FROM {S}.work_plan_rows").scalar_one()
            is None
        )


@pytest.mark.parametrize(
    "sql",
    [
        f"UPDATE {S}.projects SET tool_proposal_mode = 'maybe'",
        f"UPDATE {S}.work_plan_rows SET annotation_mode = 'assisted'",
        f"UPDATE {S}.assignments SET annotation_mode = NULL WHERE task = 'annotate'",
        f"UPDATE {S}.assignments SET annotation_mode = 'proposals' WHERE task = 'review'",
    ],
)
def test_checks_refuse_invalid_values(migrated, sql):
    _url, engine = migrated
    with pytest.raises(IntegrityError), engine.begin() as conn:
        _exec(conn, sql)


def test_downgrade_removes_the_columns(migrated):
    _url, engine = migrated
    with engine.begin() as conn:
        command.downgrade(alembic_config(conn), PREVIOUS)
    with engine.begin() as conn:
        names = _exec(
            conn,
            "SELECT column_name FROM information_schema.columns"
            " WHERE table_schema = :s AND column_name IN"
            " ('tool_proposal_mode', 'annotation_mode')",
            s=S,
        ).all()
    assert names == []
