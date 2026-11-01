"""Migration 0028: technical reports, a new table on a database that holds data."""

from collections.abc import Iterator

import pytest
from alembic import command
from pg_harness import unmigrated_database_url
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import IntegrityError

from ontotator.storage.schema import alembic_config, upgrade

REVISION = "0028"
PREVIOUS = "0027"
S = "ontotator"


@pytest.fixture
def migrated(tmp_path) -> Iterator[Engine]:
    url = unmigrated_database_url(tmp_path / "technical-report-migration.db")
    upgrade(url, PREVIOUS)
    engine = create_engine(url)
    with engine.begin() as conn:
        conn.execute(
            text(
                f"INSERT INTO {S}.users (username, display_name, pseudonym)"
                " VALUES ('ann', 'Ann', 'ann-0001')"
            )
        )
        conn.execute(
            text(
                f"INSERT INTO {S}.audit_events (actor_label, action, target_type,"
                " target_id) VALUES ('cli:x', 'user.create', 'user', 'ann')"
            )
        )
    upgrade(url, REVISION)
    yield engine
    engine.dispose()


def _insert(conn, status: str = "open", closed_at: str | None = None) -> None:
    conn.execute(
        text(
            f"INSERT INTO {S}.technical_reports (reporter_id, request_id,"
            " description, app_version, status, closed_at)"
            f" SELECT id, 'r', 'd', '1', :status, :closed_at FROM {S}.users"
        ),
        {"status": status, "closed_at": closed_at},
    )


def test_existing_rows_stay_and_the_table_starts_empty(migrated):
    with migrated.begin() as conn:
        assert conn.execute(text(f"SELECT count(*) FROM {S}.users")).scalar_one() == 1
        assert (
            conn.execute(text(f"SELECT count(*) FROM {S}.audit_events")).scalar_one()
            == 1
        )
        assert (
            conn.execute(
                text(f"SELECT count(*) FROM {S}.technical_reports")
            ).scalar_one()
            == 0
        )
        _insert(conn)
        row = conn.execute(
            text(f"SELECT status, created_at FROM {S}.technical_reports")
        ).one()
    assert row.status == "open" and row.created_at is not None


@pytest.mark.parametrize(
    "values",
    [
        {"status": "closed"},
        {"status": "done"},
        {"status": "open", "closed_at": "2026-11-01T10:00:00Z"},
    ],
)
def test_checks_refuse_invalid_states(migrated, values):
    with pytest.raises(IntegrityError), migrated.begin() as conn:
        _insert(conn, **values)


def test_a_request_id_is_unique_per_reporter(migrated):
    with migrated.begin() as conn:
        _insert(conn)
    with pytest.raises(IntegrityError), migrated.begin() as conn:
        _insert(conn)


def test_downgrade_removes_only_the_new_table(migrated):
    with migrated.begin() as conn:
        command.downgrade(alembic_config(conn), PREVIOUS)
    with migrated.begin() as conn:
        assert (
            conn.execute(text("SELECT to_regclass('ontotator.technical_reports')"))
        ).scalar_one() is None
        assert conn.execute(text(f"SELECT count(*) FROM {S}.users")).scalar_one() == 1
