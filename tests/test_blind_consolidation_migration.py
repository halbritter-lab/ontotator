"""Migration 0033 (issue 302): ``projects.blind_consolidation``, purely additive."""

from __future__ import annotations

from typing import Any

from alembic import command
from pg_harness import unmigrated_database_url
from sqlalchemy import Connection, create_engine, text

from ontotator.storage.schema import alembic_config, upgrade

REVISION = "0033"
PREVIOUS = "0030"
S = "ontotator"


def _exec(conn: Connection, sql: str) -> Any:
    return conn.execute(text(sql))


def _column(conn: Connection) -> int:
    return _exec(
        conn,
        "SELECT count(*) FROM information_schema.columns WHERE table_schema ="
        f" '{S}' AND table_name = 'projects' AND column_name = 'blind_consolidation'",
    ).scalar_one()


def test_existing_projects_keep_names_and_downgrade_drops_the_column(tmp_path):
    url = unmigrated_database_url(tmp_path / "blind-migration.db")
    upgrade(url, PREVIOUS)
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            _exec(
                conn,
                f"INSERT INTO {S}.projects (project_key, name, manifest,"
                " manifest_sha256, task_profile, task_profile_sha256) VALUES"
                " ('ward-7', 'Ward 7', '{}', 'm', '{}', 't')",
            )
            before = _exec(conn, f"SELECT to_jsonb(p) FROM {S}.projects p").scalar()
        upgrade(url, REVISION)
        with engine.begin() as conn:
            after = _exec(conn, f"SELECT to_jsonb(p) FROM {S}.projects p").scalar()
            assert after == {**before, "blind_consolidation": False}
            command.downgrade(alembic_config(conn), PREVIOUS)
        with engine.begin() as conn:
            assert _column(conn) == 0
            assert _exec(conn, f"SELECT to_jsonb(p) FROM {S}.projects p").scalar() == (
                before
            )
    finally:
        engine.dispose()
