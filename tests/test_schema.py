"""The migrated schema: mapped tables, roles, grants and append-only history."""

from pathlib import Path

import pytest
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from pg_harness import database_for, owner_engine, unmigrated_database_url
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from ontocurator.storage.schema import current_revision, head_revision, upgrade
from ontocurator.storage.tables import APPEND_ONLY_TABLES, SCHEMA, Base


def _only_our_schema(name: str | None, type_: str, _parents: object) -> bool:
    return type_ != "schema" or name == SCHEMA


def test_a_test_database_is_migrated_to_head(tmp_path: Path) -> None:
    db = database_for(tmp_path / "a.db")

    with db.engine.connect() as conn:
        assert current_revision(conn) == head_revision()


def test_the_migration_creates_exactly_the_mapped_tables(tmp_path: Path) -> None:
    db = database_for(tmp_path / "a.db")

    with owner_engine(db).connect() as conn:
        context = MigrationContext.configure(
            conn,
            opts={
                "include_schemas": True,
                "include_name": _only_our_schema,
                "version_table_schema": SCHEMA,
                "compare_type": True,
                "compare_server_default": True,
            },
        )
        assert compare_metadata(context, Base.metadata) == []


@pytest.mark.parametrize("table", APPEND_ONLY_TABLES)
@pytest.mark.parametrize(
    "statement",
    ["UPDATE {t} SET project_id = project_id", "DELETE FROM {t}", "TRUNCATE {t}"],
)
def test_the_application_role_cannot_change_history(
    tmp_path: Path, table: str, statement: str
) -> None:
    db = database_for(tmp_path / "a.db")

    with (
        pytest.raises(DBAPIError, match="permission denied"),
        db.engine.begin() as conn,
    ):
        conn.execute(text(statement.format(t=f"{SCHEMA}.{table}")))


def test_even_the_schema_owner_cannot_change_history(tmp_path: Path) -> None:
    db = database_for(tmp_path / "a.db")
    owner = owner_engine(db)
    with owner.begin() as conn:
        conn.execute(
            text(
                f"INSERT INTO {SCHEMA}.projects (project_key, name, manifest,"
                " manifest_sha256, task_profile, task_profile_sha256)"
                " VALUES ('p', 'p', '{}', 'm', '{}', 't')"
            )
        )
        conn.execute(
            text(
                f"INSERT INTO {SCHEMA}.annotation_snapshots"
                " (project_id, annotation_id, version, document_id, payload)"
                f" SELECT id, 'a', 'v', 'd', '{{}}' FROM {SCHEMA}.projects"
            )
        )

    for statement in (
        f"UPDATE {SCHEMA}.annotation_snapshots SET document_id = 'x'",
        f"DELETE FROM {SCHEMA}.annotation_snapshots",
        # Without CASCADE, PostgreSQL already refuses the truncate because
        # proposal_annotations references the table; CASCADE reaches the trigger.
        f"TRUNCATE {SCHEMA}.annotation_snapshots CASCADE",
    ):
        with pytest.raises(DBAPIError, match="append-only"), owner.begin() as conn:
            conn.execute(text(statement))


def test_the_application_role_draws_pseudonym_numbers(tmp_path: Path) -> None:
    db = database_for(tmp_path / "a.db")

    with db.engine.begin() as conn:
        drawn = [
            conn.execute(text(f"SELECT nextval('{SCHEMA}.pseudonym_seq')")).scalar_one()
            for _ in range(2)
        ]
    assert drawn == [1, 2]


def test_a_one_time_code_is_for_setup_or_reset_only(tmp_path: Path) -> None:
    db = database_for(tmp_path / "a.db")
    with db.engine.begin() as conn:
        conn.execute(
            text(
                f"INSERT INTO {SCHEMA}.users (username, display_name, pseudonym)"
                " VALUES ('alice', 'Alice', 'ann-0001')"
            )
        )

    def insert_code(purpose: str, code: str) -> None:
        with db.engine.begin() as conn:
            conn.execute(
                text(
                    f"INSERT INTO {SCHEMA}.one_time_codes (user_id, purpose,"
                    " code_sha256, credential_generation, expires_at)"
                    f" SELECT id, :purpose, :code, 1, now() FROM {SCHEMA}.users"
                ),
                {"purpose": purpose, "code": code},
            )

    insert_code("setup", "a")
    insert_code("reset", "b")
    with pytest.raises(IntegrityError, match="ck_one_time_codes_purpose"):
        insert_code("login", "c")


def test_the_application_role_cannot_create_tables(tmp_path: Path) -> None:
    db = database_for(tmp_path / "a.db")

    with (
        pytest.raises(DBAPIError, match="permission denied"),
        db.engine.begin() as conn,
    ):
        conn.execute(text(f"CREATE TABLE {SCHEMA}.intruder (id int)"))


def test_a_failing_migration_leaves_neither_a_version_nor_a_partial_schema(
    tmp_path: Path,
) -> None:
    url = unmigrated_database_url(tmp_path / "fresh.db")
    engine = create_engine(url)
    # A late step of the migration (the history trigger function) collides,
    # after every table was created in the same transaction.
    with engine.begin() as conn:
        conn.execute(
            text(
                f"CREATE FUNCTION {SCHEMA}.forbid_history_change() RETURNS trigger"
                " LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$"
            )
        )

    with pytest.raises(DBAPIError, match="already exists"):
        upgrade(url)

    with engine.connect() as conn:
        tables = conn.execute(
            text("SELECT count(*) FROM pg_tables WHERE schemaname = :s"),
            {"s": SCHEMA},
        ).scalar_one()
        assert tables == 0
        assert current_revision(conn) is None
    engine.dispose()
