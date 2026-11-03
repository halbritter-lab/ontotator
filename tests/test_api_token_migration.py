"""Migration 0031: API tokens, a new table on a database that holds data."""

from collections.abc import Iterator

import pytest
from pg_harness import unmigrated_database_url
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import IntegrityError

from ontotator.storage.schema import upgrade

REVISION = "0031"
PREVIOUS = "0030"
S = "ontotator"


@pytest.fixture
def migrated(tmp_path) -> Iterator[Engine]:
    url = unmigrated_database_url(tmp_path / "api-token-migration.db")
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


def _insert(conn, **values: object) -> None:
    row = {
        "digest": "d" * 64,
        "name": "script",
        "kind": "personal",
        "scopes": ["read"],
        "lifetime": "90 days",
        "revoked_reason": None,
        **values,
    }
    conn.execute(
        text(
            f"INSERT INTO {S}.api_tokens (token_sha256, name, kind, owner_id,"
            " scopes, expires_at, revoked_at, revoked_reason)"
            " SELECT :digest, :name, :kind, id, :scopes,"
            " now() + CAST(:lifetime AS interval),"
            " CASE WHEN CAST(:revoked_reason AS text) IS NULL THEN NULL ELSE now() END,"
            f" CAST(:revoked_reason AS text) FROM {S}.users"
        ),
        row,
    )


def test_existing_rows_stay_and_the_table_starts_empty(migrated):
    with migrated.begin() as conn:
        assert conn.execute(text(f"SELECT count(*) FROM {S}.users")).scalar_one() == 1
        assert (
            conn.execute(text(f"SELECT count(*) FROM {S}.audit_events")).scalar_one()
            == 1
        )
        assert (
            conn.execute(text(f"SELECT count(*) FROM {S}.api_tokens")).scalar_one() == 0
        )
        _insert(conn, kind="system", scopes=["read", "admin"], lifetime="365 days")
        row = conn.execute(
            text(f"SELECT created_at, last_used_at FROM {S}.api_tokens")
        ).one()
    assert row.created_at is not None and row.last_used_at is None


@pytest.mark.parametrize(
    "values",
    [
        {"kind": "service"},
        {"kind": "project"},
        {"scopes": []},
        {"scopes": ["write"]},
        {"scopes": ["admin"]},
        {"name": ""},
        {"lifetime": "367 days"},
        {"lifetime": "-1 day"},
    ],
)
def test_checks_refuse_invalid_tokens(migrated, values):
    with pytest.raises(IntegrityError), migrated.begin() as conn:
        _insert(conn, **values)


def test_a_digest_is_stored_once(migrated):
    with migrated.begin() as conn:
        _insert(conn)
    with pytest.raises(IntegrityError), migrated.begin() as conn:
        _insert(conn)
