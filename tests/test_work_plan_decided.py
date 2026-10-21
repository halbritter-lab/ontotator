"""``work_plan_rows.decided``: system rows under "Nothing planned" are undecided."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from auth_harness import logged_in
from pg_harness import database_for
from sqlalchemy import insert, select, update
from t1_builders import bundle, native_unit, translation_unit
from t1_fixtures import create_project, run_import
from test_auth_api import _app
from test_import_work_plan import commit_plan, set_import_plan, two_cases
from test_variant_import import preview
from work_plan_support import plan_env, revision_of, service

from ontocurator.api.work_plan_routes import (
    BulkPlanRequest,
    LanguageChangeView,
    PlanRowPatch,
    PlanRowsSet,
    UndoRowView,
)
from ontocurator.domain.work_plans import PlanFlags, RowKey
from ontocurator.storage import work_plan_store as store
from ontocurator.storage.database import Database
from ontocurator.storage.plan_tables import WorkPlanFlagsRow
from ontocurator.storage.tables import ProjectRow, UserRow

ROWS = (RowKey("c1", "en"), RowKey("c1", "de"))


def _project_id(db: Database, key: str = "proj") -> int:
    with db.transaction() as conn:
        return int(
            conn.execute(
                select(ProjectRow.id).where(ProjectRow.project_key == key)
            ).scalar_one()
        )


def _set_import_plan(db: Database, value: str, key: str = "proj") -> None:
    with db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == key)
            .values(import_plan=value)
        )


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
    # The source row is never undecided: it shows "not planned" (mockup 1).
    assert _decided(db) == {RowKey("c1", "en"): True, RowKey("c1", "de"): False}


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
    assert _decided(db) == dict.fromkeys(ROWS, True)


def test_import_choices_under_nothing_put_rows_in_plan_decided(tmp_path) -> None:
    application = _app(tmp_path)
    db = application.state.repo.db
    create_project(db)
    admin = logged_in(application, "root", system_admin=True, assignments=[])
    set_import_plan(application, "nothing")
    upload = preview(application, admin, bundle(tmp_path, two_cases()))
    commit_plan(
        application,
        admin,
        upload,
        plan_languages={"de": {"review": True, "annotate": False}},
        plan_cases=[
            {"case_id": "c2", "language": "fr", "review": True, "annotate": True},
            {"case_id": "c1", "language": "fr", "review": False, "annotate": False},
        ],
    )
    decided = _decided(db)
    # Rows the import puts in plan are decided; an explicit "off" choice is
    # still a system write and stays undecided (spec VD3).
    for case in ("c1", "c2"):
        assert decided[RowKey(case, "de")] is True
        assert decided[RowKey(case, "en")] is True  # sources are decided
    assert decided[RowKey("c2", "fr")] is True
    assert decided[RowKey("c1", "fr")] is False


def test_decided_rows_reader(db, tmp_path) -> None:
    assert _decided(db) == {}
    create_project(db, "other")
    _set_import_plan(db, "nothing")
    _set_import_plan(db, "nothing", "other")
    pid, other = _project_id(db), _project_id(db, "other")
    with db.transaction() as conn:
        store.ensure_rows(conn, pid, {RowKey("c1", "en"): PlanFlags(False, False)})
        store.ensure_rows(conn, other, {RowKey("c9", "fr"): PlanFlags(True, True)})
        store.ensure_rows(conn, other, {RowKey("c9", "it"): PlanFlags(False, False)})
        store.write_rows(
            conn, pid, {RowKey("c2", "en"): PlanFlags(False, True)}, actor_id=None
        )
    # Rows of other projects are not read; ensure_rows never overwrites.
    assert _decided(db) == {RowKey("c1", "en"): False, RowKey("c2", "en"): True}
    with db.transaction() as conn:
        store.ensure_rows(conn, pid, {RowKey("c2", "en"): PlanFlags(False, False)})
    assert _decided(db)[RowKey("c2", "en")] is True
    # Under "Nothing planned" only rows left out of plan are undecided.
    assert _decided(db, "other") == {
        RowKey("c9", "fr"): True,
        RowKey("c9", "it"): False,
    }


def _undecide(env: Any, keys: list[RowKey]) -> None:
    with env.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.id == env.pid)
            .values(import_plan="nothing")
        )
        for key in keys:
            conn.execute(
                update(WorkPlanFlagsRow)
                .where(
                    WorkPlanFlagsRow.project_id == env.pid,
                    WorkPlanFlagsRow.case_id == key.case_id,
                    WorkPlanFlagsRow.language == key.language,
                )
                .values(decided=False)
            )


def _env_decided(env: Any) -> dict[RowKey, bool]:
    with env.db.transaction() as conn:
        return store.decided_rows(conn, env.pid)


def test_bulk_save_decides_undecided_rows_with_unchanged_flags(tmp_path) -> None:
    env = plan_env(tmp_path, rule_on=False)
    de = [RowKey(case, "de") for case in ("c1", "c2")]
    _undecide(env, de)
    request = BulkPlanRequest(
        case_ids=["c1", "c2"],
        languages={"de": LanguageChangeView(review="off", annotate="off")},
    )
    assert service(env).bulk_preview("proj", request)["changes"] == 2
    result = service(env).bulk_save("proj", request)
    assert result["changed_rows"] == 2
    assert all(_env_decided(env)[key] for key in de)
    # Undo restores the undecided state exactly.
    undo = result["undo"]
    assert {row["decided"] for row in undo["rows"]} == {False}
    service(env).set_rows(
        "proj",
        PlanRowsSet(
            rows=[UndoRowView(**row) for row in undo["rows"]],
            expected_revisions=undo["revisions"],
            undo=True,
        ),
    )
    decided = _env_decided(env)
    assert [decided[key] for key in de] == [False, False]
    assert decided[RowKey("c1", "fr")] is True


def test_patch_row_decides_an_undecided_row(tmp_path) -> None:
    env = plan_env(tmp_path, rule_on=False)
    key = RowKey("c1", "de")
    _undecide(env, [key])
    result = service(env).patch_row(
        "proj",
        "c1",
        "de",
        PlanRowPatch(annotate=False, expected_revision=revision_of(env, "c1")),
    )
    assert _env_decided(env)[key] is True
    assert result["undo"]["rows"][0]["decided"] is False
