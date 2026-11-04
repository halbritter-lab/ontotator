"""Migration 0032 (issue 320): ``edit_events.step_id`` and ``drafts.initial_state``."""

from __future__ import annotations

from typing import Any

from alembic import command
from pg_harness import unmigrated_database_url
from sqlalchemy import Connection, create_engine, text

from ontotator.storage.schema import alembic_config, upgrade

REVISION = "0032"
PREVIOUS = "0031"
S = "ontotator"


def _columns(conn: Connection) -> set[tuple[str, str, str]]:
    rows = conn.execute(
        text(
            "SELECT table_name, column_name, is_nullable FROM"
            " information_schema.columns WHERE table_schema = :s AND"
            " ((table_name = 'edit_events' AND column_name = 'step_id') OR"
            " (table_name = 'drafts' AND column_name = 'initial_state'))"
        ),
        {"s": S},
    ).all()
    return {(r.table_name, r.column_name, r.is_nullable) for r in rows}


def test_both_columns_are_nullable_and_the_downgrade_drops_them(tmp_path: Any) -> None:
    url = unmigrated_database_url(tmp_path / "history-migration.db")
    upgrade(url, PREVIOUS)
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            assert _columns(conn) == set()
        upgrade(url, REVISION)
        with engine.begin() as conn:
            assert _columns(conn) == {
                ("edit_events", "step_id", "YES"),
                ("drafts", "initial_state", "YES"),
            }
            command.downgrade(alembic_config(conn), PREVIOUS)
        with engine.begin() as conn:
            assert _columns(conn) == set()
    finally:
        engine.dispose()
