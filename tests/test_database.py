"""Ambient transactions: one transaction per call chain, rolled back as a whole."""

import threading
from pathlib import Path

import pytest
from pg_harness import database_for
from sqlalchemy import func, insert, select

from ontocurator.storage.database import Database
from ontocurator.storage.tables import StoredFileRow


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


def test_the_same_path_reopens_the_same_database(tmp_path: Path) -> None:
    first = database_for(tmp_path / "a.db")
    with first.transaction() as conn:
        conn.execute(insert(StoredFileRow).values(sha256="c" * 64, size=1))

    assert _count(database_for(tmp_path / "a.db")) == 1
    assert _count(database_for(tmp_path / "b.db")) == 0
