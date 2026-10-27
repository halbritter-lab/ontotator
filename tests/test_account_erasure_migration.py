"""Migration 0022: the reserved erasure prefix and the audit target backfill."""

import pytest
from pg_harness import unmigrated_database_url
from sqlalchemy import create_engine, text

from ontotator.storage.schema import upgrade

S = "ontotator"


def _user(conn, username: str) -> None:
    conn.execute(
        text(
            f"INSERT INTO {S}.users (username, display_name, pseudonym)"
            " VALUES (:u, :u, :u)"
        ),
        {"u": username},
    )


def test_a_user_with_the_reserved_prefix_stops_the_upgrade(tmp_path) -> None:
    url = unmigrated_database_url(tmp_path / "erasure-refused.db")
    upgrade(url, "0021")
    engine = create_engine(url)
    with engine.begin() as conn:
        _user(conn, "anonymised-boss")
    with pytest.raises(RuntimeError, match="anonymised-boss"):
        upgrade(url, "0022")
    engine.dispose()


def test_user_targets_are_backfilled_with_the_account_id(tmp_path) -> None:
    url = unmigrated_database_url(tmp_path / "erasure-backfill.db")
    upgrade(url, "0021")
    engine = create_engine(url)
    with engine.begin() as conn:
        _user(conn, "alice")
        conn.execute(
            text(
                f"INSERT INTO {S}.audit_events (actor_label, action, target_type,"
                " target_id) VALUES ('cli:x', 'user.create', 'user', 'alice'),"
                " ('cli:x', 'project.create', 'project', 'alice')"
            )
        )
    upgrade(url, "0022")
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                f"SELECT a.target_type, a.target_user_id = u.id AS matched"
                f" FROM {S}.audit_events a, {S}.users u ORDER BY a.target_type"
            )
        ).all()
    engine.dispose()
    assert [(row.target_type, row.matched) for row in rows] == [
        ("project", None),
        ("user", True),
    ]
