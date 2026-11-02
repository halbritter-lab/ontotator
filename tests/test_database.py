"""Ambient transactions: one transaction per call chain, rolled back as a whole."""

import threading
from pathlib import Path

import pg_harness
import pytest
from pg_harness import database_for, database_url_for
from sqlalchemy import func, insert, select, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import DBAPIError

from ontotator import settings
from ontotator.storage.database import (
    Database,
    SnapshotUnavailable,
    TransactionRollbackOnly,
)
from ontotator.storage.tables import StoredFileRow


def _count(db: Database) -> int:
    with db.transaction() as conn:
        return conn.execute(
            select(func.count()).select_from(StoredFileRow)
        ).scalar_one()


def test_a_nested_transaction_joins_the_open_one(tmp_path: Path) -> None:
    db = database_for(tmp_path / "a.db")

    with db.transaction() as outer, db.transaction() as inner:
        assert inner is outer


def test_a_failure_rolls_back_everything_written_in_the_chain(tmp_path: Path) -> None:
    db = database_for(tmp_path / "a.db")

    with pytest.raises(RuntimeError, match="boom"), db.transaction() as conn:
        conn.execute(insert(StoredFileRow).values(sha256="a" * 64, size=1))
        with db.transaction() as inner:
            inner.execute(insert(StoredFileRow).values(sha256="b" * 64, size=1))
        raise RuntimeError("boom")

    assert _count(db) == 0


def test_a_caught_failure_of_a_joined_scope_still_rolls_back_the_chain(
    tmp_path: Path,
) -> None:
    db = database_for(tmp_path / "a.db")

    with pytest.raises(TransactionRollbackOnly) as doomed, db.transaction() as conn:
        conn.execute(insert(StoredFileRow).values(sha256="a" * 64, size=1))
        with pytest.raises(RuntimeError, match="rejected"), db.transaction() as inner:
            inner.execute(insert(StoredFileRow).values(sha256="b" * 64, size=1))
            raise RuntimeError("rejected")
        with pytest.raises(ValueError, match="later"), db.transaction():
            raise ValueError("later")

    assert _count(db) == 0
    # The first swallowed failure is the cause, not a later one.
    cause = doomed.value.__cause__
    assert isinstance(cause, RuntimeError) and str(cause) == "rejected"


def test_after_commit_waits_for_the_outermost_commit(tmp_path: Path) -> None:
    db = database_for(tmp_path / "a.db")
    seen: list[tuple[str, bool]] = []

    with db.transaction() as conn:
        conn.execute(insert(StoredFileRow).values(sha256="a" * 64, size=1))
        with db.transaction():
            db.after_commit(lambda: seen.append(("joined", db.in_transaction())))
        assert seen == []
    # Outside any transaction, with the row committed.
    assert seen == [("joined", False)] and _count(db) == 1

    db.after_commit(lambda: seen.append(("now", db.in_transaction())))
    assert seen[-1] == ("now", False)


def test_after_commit_is_dropped_on_rollback_and_never_raises(
    tmp_path: Path,
) -> None:
    db = database_for(tmp_path / "a.db")
    seen: list[str] = []

    with pytest.raises(RuntimeError, match="boom"), db.transaction():
        db.after_commit(lambda: seen.append("rolled back"))
        raise RuntimeError("boom")
    assert seen == []

    def failing() -> None:
        raise OSError("disk")

    with db.transaction():
        db.after_commit(failing)
        db.after_commit(lambda: seen.append("still runs"))
    assert seen == ["still runs"]


def test_a_caught_failure_inside_a_snapshot_does_not_doom_it(tmp_path: Path) -> None:
    db = database_for(tmp_path / "a.db")

    with db.snapshot() as conn:
        # Nothing can have been written, so the snapshot may go on reading
        # (a database error, unlike this Python error, would abort it).
        with pytest.raises(RuntimeError, match="refused"), db.transaction():
            raise RuntimeError("refused")
        with pytest.raises(RuntimeError, match="refused"), db.snapshot():
            raise RuntimeError("refused")
        assert (
            conn.execute(select(func.count()).select_from(StoredFileRow)).scalar_one()
            == 0
        )


def test_another_thread_gets_its_own_transaction(tmp_path: Path) -> None:
    db = database_for(tmp_path / "a.db")
    seen: dict[str, bool] = {}

    with db.transaction() as conn:

        def other() -> None:
            with db.transaction() as mine:
                seen["same"] = mine is conn

        thread = threading.Thread(target=other)
        thread.start()
        thread.join()

    assert seen == {"same": False}


def _insert_elsewhere(db: Database, sha: str) -> None:
    """Commit a row from another thread, so it is not in this context's transaction."""

    def insert_row() -> None:
        with db.transaction() as conn:
            conn.execute(insert(StoredFileRow).values(sha256=sha, size=1))

    thread = threading.Thread(target=insert_row)
    thread.start()
    thread.join()


def test_a_snapshot_does_not_see_a_commit_made_after_its_first_read(
    tmp_path: Path,
) -> None:
    db = database_for(tmp_path / "a.db")

    with db.snapshot() as conn:
        before = conn.execute(select(func.count()).select_from(StoredFileRow))
        _insert_elsewhere(db, "d" * 64)
        after = conn.execute(select(func.count()).select_from(StoredFileRow))
        assert (before.scalar_one(), after.scalar_one()) == (0, 0)

    assert _count(db) == 1


def test_a_snapshot_refuses_writes(tmp_path: Path) -> None:
    db = database_for(tmp_path / "a.db")

    with pytest.raises(DBAPIError, match="read-only"), db.snapshot() as conn:
        conn.execute(insert(StoredFileRow).values(sha256="e" * 64, size=1))


def test_calls_inside_a_snapshot_join_it(tmp_path: Path) -> None:
    db = database_for(tmp_path / "a.db")

    with db.snapshot() as outer, db.transaction() as inner, db.snapshot() as again:
        assert inner is outer
        assert again is outer


def test_a_snapshot_cannot_join_a_read_committed_transaction(tmp_path: Path) -> None:
    db = database_for(tmp_path / "a.db")

    with (
        pytest.raises(SnapshotUnavailable, match="REPEATABLE READ"),
        db.transaction(),
        db.snapshot(),
    ):
        pass


def test_a_pooled_connection_forgets_the_snapshot_settings(tmp_path: Path) -> None:
    db = database_for(tmp_path / "a.db")
    setting = text("SELECT current_setting(:name)")

    with db.snapshot() as conn:
        assert conn.execute(
            setting, {"name": "transaction_isolation"}
        ).scalar_one() == ("repeatable read")
    with db.transaction() as conn:
        assert conn.execute(
            setting, {"name": "transaction_isolation"}
        ).scalar_one() == ("read committed")
        assert conn.execute(
            setting, {"name": "transaction_read_only"}
        ).scalar_one() == ("off")
    assert db.engine.pool.checkedin() == 1  # the same pooled connection both times


def test_the_same_path_reopens_the_same_database(tmp_path: Path) -> None:
    first = database_for(tmp_path / "a.db")
    with first.transaction() as conn:
        conn.execute(insert(StoredFileRow).values(sha256="c" * 64, size=1))

    assert _count(database_for(tmp_path / "a.db")) == 1
    assert _count(database_for(tmp_path / "b.db")) == 0


PASSWORD = "p@ss#w%rd/x:y"


@pytest.mark.parametrize("source", ["environment", "explicit"])
def test_a_password_with_url_characters_survives_the_round_trip(
    tmp_path: Path, source: str
) -> None:
    # Roles are cluster-wide: parallel workers share the server (pg_harness).
    role = f"ontotator_password_probe_{pg_harness.process_suffix()}"
    _, admin = pg_harness.server()
    with admin.connect() as conn:
        conn.execute(text(f"DROP ROLE IF EXISTS {role}"))
        conn.execute(text(f"CREATE ROLE {role} LOGIN PASSWORD '{PASSWORD}'"))
    target = make_url(database_url_for(tmp_path / "a.db"))
    bare = URL.create(
        target.drivername,
        username=role,
        host=target.host,
        port=target.port,
        database=target.database,
    ).render_as_string()
    env = {"ONTOTATOR_DATABASE_PASSWORD": PASSWORD}
    if source == "environment":
        resolved = settings.database_url(
            {**env, "ONTOTATOR_DATABASE_URL": bare}
        ).render_as_string(hide_password=False)
    else:
        resolved = settings.resolve_database_url(bare, None, env)
    db = Database(resolved, data_dir=tmp_path / "data")
    try:
        with db.transaction() as conn:
            assert conn.execute(text("SELECT current_user")).scalar_one() == role
    finally:
        db.close()
        with admin.connect() as conn:
            conn.execute(text(f"DROP ROLE {role}"))


def test_a_failed_statement_does_not_show_its_parameters(tmp_path: Path) -> None:
    db = database_for(tmp_path / "params.db")

    with pytest.raises(DBAPIError) as caught, db.transaction() as conn:
        conn.execute(text("SELECT 1 / 0 WHERE :h <> ''"), {"h": "$argon2id$secret"})

    assert "secret" not in str(caught.value)
    db.close()
