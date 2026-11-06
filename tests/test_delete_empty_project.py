"""Deleting a project without work (issue 191).

Work is every row of a project table other than the setup tables, and an
upload that committed. A project with work is refused and stays as it was;
one without work goes with its setup rows, its key is free again and the
audit trail keeps its entries, naming the project by key.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from auth_harness import add_ontology, ensure_user, grant, logged_in
from fastapi import FastAPI
from sqlalchemy import insert, select, text
from sqlalchemy.exc import DBAPIError
from t1_fixtures import HP_PATH, bundle, create_project, run_import, unit
from test_auth_api import _app
from test_practice import _project_rows

from ontotator.storage.plan_tables import WorkPlanRow
from ontotator.storage.repository import Repository
from ontotator.storage.tables import (
    AuditEventRow,
    JobRow,
    ProjectMembershipRow,
    ProjectRow,
    UploadRow,
)

KEY = "mistake"
S = "ontotator"


@pytest.fixture
def app(tmp_path: Path) -> FastAPI:
    app = _app(tmp_path)
    add_ontology(app, HP_PATH)
    create_project(app.state.repo.db, KEY)
    ensure_user(app, "lea")
    assert grant(app, "lea", KEY, ["lead"])
    return app


def _pid(app: FastAPI) -> int:
    with app.state.repo.db.transaction() as conn:
        pid = Repository._project_id(conn, KEY)
    assert pid is not None
    return pid


def _upload(app: FastAPI, status: str) -> None:
    """A text upload of the project with its preview job, in ``status``."""
    pid = _pid(app)
    with app.state.repo.db.transaction() as conn:
        job = conn.execute(
            insert(JobRow)
            .values(
                kind="upload_preview",
                status="succeeded",
                project_id=pid,
                requested_label="test",
                payload={},
            )
            .returning(JobRow.id)
        ).scalar_one()
        conn.execute(
            insert(UploadRow).values(
                project_id=pid,
                kind="text",
                files=[],
                status=status,
                preview_job_id=job,
            )
        )


def test_an_admin_deletes_a_project_without_work_and_the_key_is_free(
    app: FastAPI,
) -> None:
    pid = _pid(app)
    _upload(app, "discarded")
    _upload(app, "ready")
    before = _project_rows(app, pid)
    assert before["project_memberships"] == 1 and before["uploads"] == 2
    admin = logged_in(app, "root", system_admin=True)

    response = admin.delete(f"/api/v1/admin/projects/{KEY}")

    assert response.status_code == 204, response.text
    assert _project_rows(app, pid) == {}
    with app.state.repo.db.transaction() as conn:
        assert (
            conn.execute(select(ProjectRow.id).where(ProjectRow.project_key == KEY))
        ).first() is None
        kept = conn.execute(
            select(AuditEventRow.action, AuditEventRow.details).where(
                AuditEventRow.target_id == KEY,
                AuditEventRow.target_type == "project",
            )
        ).all()
        memberships = conn.execute(
            select(ProjectMembershipRow).where(ProjectMembershipRow.project_id == pid)
        ).all()
    assert memberships == []
    actions = {action: details for action, details in kept}
    # The entries made while the project lived stay, naming it by key.
    assert actions["project.create"]["deleted_project_key"] == KEY
    assert actions["project.delete"]["deleted_project_key"] == KEY
    assert actions["project.delete"]["deleted_rows"]["uploads"] == 2
    assert admin.get(f"/api/v1/projects/{KEY}/settings").status_code in (403, 404)
    # The key can be used again.
    create_project(app.state.repo.db, KEY)
    assert _pid(app) != pid


def test_texts_are_work_and_nothing_changes(app: FastAPI, tmp_path: Path) -> None:
    run_import(app.state.repo.db, bundle(tmp_path / "b.zip", [unit()]), KEY)
    pid = _pid(app)
    before = _project_rows(app, pid)
    admin = logged_in(app, "root", system_admin=True)

    refused = admin.delete(f"/api/v1/admin/projects/{KEY}")

    assert refused.status_code == 409
    body = refused.json()
    assert body["code"] == "PROJECT_HAS_WORK"
    assert {"documents", "proposal_sets"} <= set(body["details"]["work"])
    assert _project_rows(app, pid) == before


def test_a_committed_upload_is_work(app: FastAPI) -> None:
    _upload(app, "committed")
    admin = logged_in(app, "root", system_admin=True)

    refused = admin.delete(f"/api/v1/admin/projects/{KEY}")

    assert refused.status_code == 409
    assert refused.json()["details"]["work"] == ["uploads"]


def test_any_table_beyond_the_setup_is_work(app: FastAPI) -> None:
    # A work plan of a case: neither a text nor a task, still work.
    with app.state.repo.db.transaction() as conn:
        conn.execute(
            insert(WorkPlanRow).values(project_id=_pid(app), case_id="C1", revision=2)
        )
    admin = logged_in(app, "root", system_admin=True)

    refused = admin.delete(f"/api/v1/admin/projects/{KEY}")

    assert refused.status_code == 409
    assert refused.json()["details"]["work"] == ["work_plans"]


def test_assignments_are_work(app: FastAPI, tmp_path: Path) -> None:
    run_import(app.state.repo.db, bundle(tmp_path / "b.zip", [unit()]), KEY)
    logged_in(
        app,
        "ann",
        projects={KEY: ["annotator"]},
        assignments=[(KEY, "EN100017", "annotate")],
    )
    admin = logged_in(app, "root", system_admin=True)

    refused = admin.delete(f"/api/v1/admin/projects/{KEY}")

    assert refused.status_code == 409
    assert "assignments" in refused.json()["details"]["work"]


def test_only_an_administrator_may_delete(app: FastAPI) -> None:
    lead = logged_in(app, "lea")
    refused = lead.delete(f"/api/v1/admin/projects/{KEY}")
    assert refused.status_code == 403
    assert _project_rows(app, _pid(app))["project_memberships"] == 1


def test_unknown_and_practice_projects_are_refused(app: FastAPI) -> None:
    admin = logged_in(app, "root", system_admin=True)
    missing = admin.delete("/api/v1/admin/projects/nothing-here")
    assert missing.status_code == 404
    assert missing.json()["code"] == "PROJECT_NOT_FOUND"

    ensure_user(app, "ann")
    assert grant(app, "ann", KEY, ["annotator"])
    practice = logged_in(app, "ann").post("/api/v1/me/practice").json()
    key = practice["project"]["project_key"]
    refused = admin.delete(f"/api/v1/admin/projects/{key}")
    assert refused.status_code == 409
    assert refused.json()["code"] == "IS_A_PRACTICE_PROJECT"


def test_the_database_function_refuses_a_practice_project(app: FastAPI) -> None:
    ensure_user(app, "ann")
    assert grant(app, "ann", KEY, ["annotator"])
    key = (
        logged_in(app, "ann")
        .post("/api/v1/me/practice")
        .json()["project"]["project_key"]
    )
    with app.state.repo.db.transaction() as conn:
        pid = Repository._project_id(conn, key)
    with (
        pytest.raises(DBAPIError, match="no real project"),
        app.state.repo.db.transaction() as conn,
    ):
        conn.execute(text(f"SELECT {S}.delete_empty_project(:p)"), {"p": pid})
