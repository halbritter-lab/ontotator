"""Applying and checking the database schema (Alembic, forward only)."""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Connection, create_engine, text
from sqlalchemy.engine import URL

from ontocurator.storage.tables import SCHEMA

MIGRATIONS = Path(__file__).parent / "migrations"
# Every upgrading process takes this transaction lock, so two migrate runs
# never interleave.
UPGRADE_LOCK = 7_011_337_421


def alembic_config(connection: Connection | None = None) -> Config:
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))
    if connection is not None:
        config.attributes["connection"] = connection
    return config


def head_revision() -> str:
    head = ScriptDirectory.from_config(alembic_config()).get_current_head()
    if head is None:
        raise RuntimeError("No migrations found")
    return head


def current_revision(connection: Connection) -> str | None:
    """The revision the database is at, or None if it was never migrated."""
    context = MigrationContext.configure(
        connection, opts={"version_table_schema": SCHEMA}
    )
    return context.get_current_revision()


def upgrade(url: str | URL) -> str:
    """Upgrade to head as the schema owner and return the head revision."""
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            conn.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": UPGRADE_LOCK})
            command.upgrade(alembic_config(conn), "head")
    finally:
        engine.dispose()
    return head_revision()
