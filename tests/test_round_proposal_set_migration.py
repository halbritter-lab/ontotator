"""Migration 0037 (issue 337): ``work_rounds.proposal_set_id``, purely additive."""

from __future__ import annotations

from typing import Any

from alembic import command
from pg_harness import unmigrated_database_url
from sqlalchemy import Connection, create_engine, text

from ontotator.storage.schema import alembic_config, upgrade

REVISION = "0037"
PREVIOUS = "0036"
S = "ontotator"


def _exec(conn: Connection, sql: str) -> Any:
    return conn.execute(text(sql))


def _column(conn: Connection) -> int:
    return _exec(
        conn,
        "SELECT count(*) FROM information_schema.columns WHERE table_schema ="
        f" '{S}' AND table_name = 'work_rounds' AND column_name = 'proposal_set_id'",
    ).scalar_one()


def test_the_column_starts_empty_and_downgrade_drops_it(tmp_path):
    url = unmigrated_database_url(tmp_path / "round-set-migration.db")
    upgrade(url, PREVIOUS)
    engine = create_engine(url)
    try:
        upgrade(url, REVISION)
        with engine.begin() as conn:
            assert _column(conn) == 1
            nullable = _exec(
                conn,
                "SELECT is_nullable FROM information_schema.columns WHERE"
                f" table_schema = '{S}' AND table_name = 'work_rounds'"
                " AND column_name = 'proposal_set_id'",
            ).scalar_one()
            assert nullable == "YES"
            validated = _exec(
                conn,
                "SELECT convalidated FROM pg_constraint WHERE conname ="
                " 'fk_work_rounds_proposal_set_id'",
            ).scalar_one()
            assert validated is True
            command.downgrade(alembic_config(conn), PREVIOUS)
        with engine.begin() as conn:
            assert _column(conn) == 0
    finally:
        engine.dispose()
