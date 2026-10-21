"""``work_plan_rows.decided``: system rows under "Nothing planned" are undecided."""

from __future__ import annotations

from pathlib import Path

import pytest
from pg_harness import database_for
from sqlalchemy import insert, select, update
from t1_builders import bundle, native_unit, translation_unit
from t1_fixtures import create_project, run_import

from ontocurator.domain.work_plans import PlanFlags, RowKey
from ontocurator.storage import work_plan_store as store
from ontocurator.storage.database import Database
from ontocurator.storage.tables import ProjectRow, UserRow

ROWS = (RowKey("c1", "en"), RowKey("c1", "de"))


def _project_id(db: Database, key: str = "proj") -> int:
    with db.transaction() as conn:
        return int(
            conn.execute(
                select(ProjectRow.id).where(ProjectRow.project_key == key)
            ).scalar_one()
        )


def _set_import_plan(db: Database, value: str) -> None:
    with db.transaction() as conn:
        conn.execute(update(ProjectRow).values(import_plan=value))


def _import(db: Database, tmp_path: Path) -> None:
    source = native_unit("c1", "en", "Source text of c1.")
    de = translation_unit("c1", "de", "de text of c1.", source=source)
    job = run_import(db, bundle(tmp_path, [source, de]))
    assert job.status == "succeeded", job.error


def _decided(db: Database, key: str = "proj") -> dict[RowKey, bool]:
    pid = _project_id(db, key)
    with db.transaction() as conn:
        return store.decided_rows(conn, pid)


@pytest.fixture
def db(tmp_path: Path) -> Database:
    database = database_for(tmp_path / "decided.db")
    create_project(database)
    return database


def test_import_under_nothing_writes_undecided(db, tmp_path) -> None:
    _set_import_plan(db, "nothing")
    _import(db, tmp_path)
    assert _decided(db) == dict.fromkeys(ROWS, False)


def test_import_with_default_plan_writes_decided(db, tmp_path) -> None:
    _import(db, tmp_path)
    assert _decided(db) == dict.fromkeys(ROWS, True)


def test_lead_write_marks_decided(db, tmp_path) -> None:
    _set_import_plan(db, "nothing")
    _import(db, tmp_path)
    with db.transaction() as conn:
        lead = conn.execute(
            insert(UserRow)
            .values(username="lead", display_name="Lead", pseudonym="lead-0001")
            .returning(UserRow.id)
        ).scalar_one()
    pid = _project_id(db)
    with db.transaction() as conn:
        # Off/off stays off/off: the lead decided "not in plan" explicitly.
        store.write_rows(
            conn, pid, {RowKey("c1", "de"): PlanFlags(False, False)}, actor_id=lead
        )
    assert _decided(db) == {RowKey("c1", "en"): False, RowKey("c1", "de"): True}


def test_decided_rows_reader(db, tmp_path) -> None:
    assert _decided(db) == {}
    create_project(db, "other")
    _set_import_plan(db, "nothing")
    pid, other = _project_id(db), _project_id(db, "other")
    with db.transaction() as conn:
        store.ensure_rows(conn, pid, {RowKey("c1", "en"): PlanFlags(False, False)})
        store.ensure_rows(conn, other, {RowKey("c9", "fr"): PlanFlags(True, True)})
        store.write_rows(
            conn, pid, {RowKey("c2", "en"): PlanFlags(False, True)}, actor_id=None
        )
    # Rows of other projects are not read; ensure_rows never overwrites.
    assert _decided(db) == {RowKey("c1", "en"): False, RowKey("c2", "en"): True}
    with db.transaction() as conn:
        store.ensure_rows(conn, pid, {RowKey("c2", "en"): PlanFlags(False, False)})
    assert _decided(db)[RowKey("c2", "en")] is True
    assert _decided(db, "other") == {RowKey("c9", "fr"): False}
