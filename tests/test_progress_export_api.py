"""Real project progress, queued exports, and current job access regressions."""

from __future__ import annotations

import json
from datetime import UTC, datetime

import ontospan
import pytest
from auth_harness import HARNESS, logged_in
from sqlalchemy import delete, event, insert, select, update
from t1_fixtures import HP_PATH, bundle, create_project, run_import, unit
from test_auth_api import _app
from test_t1_export import DOC, _own, _submit

from ontocurator.exchange.jobs import store_file
from ontocurator.storage.tables import (
    AssignmentRow,
    AuditEventRow,
    DocumentRow,
    JobRow,
    ProjectMembershipRow,
    ProjectRow,
    UserRow,
)

BASE = "/api/v1/projects/proj"


@pytest.fixture
def project(tmp_path):
    app = _app(tmp_path)
    db = app.state.repo.db
    create_project(db)
    imported = run_import(db, bundle(tmp_path / "in.zip", [unit(DOC), unit("second")]))
    assert imported.status == "succeeded", imported.error
    lead = logged_in(app, "lead", projects={"proj": ["lead"]})
    worker = logged_in(
        app, "worker", pseudonym="blind-worker", projects={"proj": ["annotator"]}
    )
    with db.transaction() as conn:
        project_id = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == "proj")
        ).scalar_one()
        # Deliberately non-contiguous positions catch list re-enumeration.
        conn.execute(
            update(DocumentRow)
            .where(DocumentRow.project_id == project_id, DocumentRow.document_id == DOC)
            .values(position=9)
        )
        conn.execute(
            update(DocumentRow)
            .where(
                DocumentRow.project_id == project_id,
                DocumentRow.document_id == "second",
            )
            .values(position=23)
        )
    return app, lead, worker, project_id


def _assignment(
    app,
    project_id,
    document,
    username,
    status="open",
    *,
    task="annotate",
    revoked=False,
):
    user = app.state.accounts.get_by_username(username)
    with app.state.repo.db.transaction() as conn:
        return conn.execute(
            insert(AssignmentRow)
            .values(
                project_id=project_id,
                document_id=document,
                user_id=user.id,
                task=task,
                status=status,
                revoked_at=datetime.now(UTC) if revoked else None,
            )
            .returning(AssignmentRow.id)
        ).scalar_one()


def _run(app, job_id):
    job = app.state.jobs.claim(job_id, "test-progress")
    assert job is not None
    finished = app.state.jobs.run(job, "test-progress")
    assert finished.status == "succeeded", finished.error
    return finished


def _job(
    app,
    project_id,
    *,
    requester="worker",
    kind="upload_preview",
    status="succeeded",
    result=None,
    payload=None,
):
    user = app.state.accounts.get_by_username(requester)
    with app.state.repo.db.transaction() as conn:
        return conn.execute(
            insert(JobRow)
            .values(
                kind=kind,
                status=status,
                project_id=project_id,
                requested_by=user.id,
                requested_label=f"user:{requester}",
                payload=payload or {"project": "proj"},
                result=result,
                finished_at=datetime(2026, 10, 15, 12, 34, 56, tzinfo=UTC)
                if status in {"succeeded", "failed"}
                else None,
            )
            .returning(JobRow.id)
        ).scalar_one()


def _download_audits(app):
    with app.state.repo.db.transaction() as conn:
        return (
            conn.execute(
                select(AuditEventRow.details).where(
                    AuditEventRow.action == "project.export_download"
                )
            )
            .scalars()
            .all()
        )


def test_progress_counts_per_document_and_person(project):
    app, lead, _, pid = project
    opened = _assignment(app, pid, DOC, "worker")
    submitted = _assignment(app, pid, DOC, "lead", "submitted", task="review")
    _assignment(app, pid, "second", "worker", "reopened", revoked=True)
    response = lead.get(f"{BASE}/progress")
    assert response.status_code == 200, response.text
    data = response.json()
    assert [(d["document_id"], d["position"]) for d in data["documents"]] == [
        (DOC, 9),
        ("second", 23),
    ]
    assert data["documents"][0]["assignees"] == [
        {
            "assignment_id": submitted,
            "username": "lead",
            "pseudonym": "lead",
            "task": "review",
            "status": "submitted",
        },
        {
            "assignment_id": opened,
            "username": "worker",
            "pseudonym": "blind-worker",
            "task": "annotate",
            "status": "open",
        },
    ]
    assert data["documents"][1]["assignees"] == []
    assert data["totals"] == {
        "documents": 2,
        "unassigned": 1,
        "open": 1,
        "in_progress": 0,
        "submitted": 1,
        "reopened": 0,
    }
    people = {p["username"]: p for p in data["people"]}
    assert people["worker"] == {
        "username": "worker",
        "display_name": "blind-worker",
        "pseudonym": "blind-worker",
        "open": 1,
        "in_progress": 0,
        "submitted": 0,
        "reopened": 0,
    }
    assert people["lead"]["submitted"] == 1
    assert "text" not in json.dumps(data)


def test_progress_is_for_leads_only(project):
    _, _, worker, _ = project
    assert worker.get(f"{BASE}/progress").status_code == 403


def test_progress_groups_all_statuses_in_one_metadata_query(project):
    app, lead, _, pid = project
    _assignment(app, pid, DOC, "worker", "in_progress")
    _assignment(app, pid, "second", "worker", "reopened")
    _assignment(app, pid, "second", "lead", "submitted", task="review")
    statements = []

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(app.state.repo.db.engine, "before_cursor_execute", record)
    try:
        response = lead.get(f"{BASE}/progress")
    finally:
        event.remove(app.state.repo.db.engine, "before_cursor_execute", record)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["totals"] == {
        "documents": 2,
        "unassigned": 0,
        "open": 0,
        "in_progress": 1,
        "submitted": 1,
        "reopened": 1,
    }
    worker = next(p for p in data["people"] if p["username"] == "worker")
    assert worker["in_progress"] == worker["reopened"] == 1
    projections = [
        statement
        for statement in statements
        if "FROM ontocurator.documents" in statement
    ]
    assert len(projections) == 1
    assert "documents.text" not in projections[0]
    assert "snapshot" not in projections[0]


def test_progress_retains_unrevoked_history_after_role_loss_and_deactivation(project):
    app, lead, _, pid = project
    assignment = _assignment(app, pid, DOC, "worker", "submitted")
    worker = app.state.accounts.get_by_username("worker")
    with app.state.repo.db.transaction() as conn:
        conn.execute(
            delete(ProjectMembershipRow).where(
                ProjectMembershipRow.project_id == pid,
                ProjectMembershipRow.user_id == worker.id,
            )
        )
        conn.execute(
            update(UserRow).where(UserRow.id == worker.id).values(active=False)
        )
    response = lead.get(f"{BASE}/progress")
    assert response.status_code == 200, response.text
    assert (
        response.json()["documents"][0]["assignees"][0]["assignment_id"] == assignment
    )
    assert response.json()["people"][0]["submitted"] == 1


def test_empty_project_progress_has_explicit_zero_totals(project):
    app, _, _, _ = project
    create_project(app.state.repo.db, "empty")
    admin = logged_in(app, "root", system_admin=True)
    response = admin.get("/api/v1/projects/empty/progress")
    assert response.status_code == 200, response.text
    assert response.json() == {
        "documents": [],
        "people": [],
        "totals": {
            "documents": 0,
            "unassigned": 0,
            "open": 0,
            "in_progress": 0,
            "submitted": 0,
            "reopened": 0,
        },
    }


def test_export_queue_records_real_actor_and_project(project):
    app, lead, _, pid = project
    response = lead.post(f"{BASE}/exports", json={"kind": "t1"})
    assert response.status_code == 200, response.text
    with app.state.repo.db.transaction() as conn:
        row = conn.execute(
            select(JobRow).where(JobRow.id == response.json()["job_id"])
        ).one()
    assert row.project_id == pid
    assert row.requested_by == app.state.accounts.get_by_username("lead").id
    assert row.payload == {"project": "proj"}
    assert row.kind == "t1_export"


def test_a_lead_exports_and_downloads_a_bundle(project, tmp_path):
    app, lead, _, _ = project
    _submit(
        app.state.repo.db,
        "blind-worker",
        "independent",
        [
            _own(
                app.state.repo.db,
                "blind-worker",
                "human-a",
                (6, 19),
                {
                    "assertion": "present",
                    "experiencer": "patient",
                    "temporality": "current",
                },
            )
        ],
        submission_id="api-export",
    )
    queued = lead.post(f"{BASE}/exports", json={"kind": "t1"})
    assert queued.status_code == 200, queued.text
    job = _run(app, queued.json()["job_id"])
    downloaded = lead.get(f"/api/v1/jobs/{job.id}/download")
    assert downloaded.status_code == 200, downloaded.text
    assert downloaded.headers["content-type"] == "application/zip"
    assert downloaded.headers["content-disposition"].startswith(
        'attachment; filename="proj-t1-'
    )
    target = tmp_path / "download.zip"
    target.write_bytes(downloaded.content)
    _, units = ontospan.read_bundle(
        target, {"hp": ontospan.ObographOntology.load(HP_PATH)}
    )
    assert len(units) == 1
    assert _download_audits(app)[0]["job_id"] == job.id


def test_the_edit_log_download_is_pseudonymised(project):
    app, lead, _, _ = project
    _submit(
        app.state.repo.db, "blind-worker", "independent", [], submission_id="api-log"
    )
    queued = lead.post(f"{BASE}/exports", json={"kind": "edit_log"})
    assert queued.status_code == 200, queued.text
    job = _run(app, queued.json()["job_id"])
    downloaded = lead.get(f"/api/v1/jobs/{job.id}/download")
    assert downloaded.status_code == 200, downloaded.text
    rows = [json.loads(line) for line in downloaded.text.splitlines()]
    assert rows and "blind-worker" in downloaded.text
    assert all("user_id" not in row and "session_id" not in row for row in rows)
    assert downloaded.headers["content-type"].startswith("application/x-ndjson")


def test_an_annotator_cannot_export_or_download_others_work(project):
    app, _, worker, pid = project
    assert worker.post(f"{BASE}/exports", json={"kind": "t1"}).status_code == 403
    assert worker.post(f"{BASE}/exports", json={"kind": "edit_log"}).status_code == 403
    sha = store_file(app.state.repo.db, b"sensitive")
    own_job = _job(app, pid, kind="t1_export", result={"sha256": sha})
    assert worker.get(f"/api/v1/jobs/{own_job}").status_code == 200
    assert worker.get(f"/api/v1/jobs/{own_job}/download").status_code == 403
    assert _download_audits(app) == []


def test_current_other_exporter_can_download(project):
    app, lead, _, pid = project
    sha = store_file(app.state.repo.db, b"{}\n")
    job = _job(app, pid, kind="edit_log_export", result={"sha256": sha})
    response = lead.get(f"/api/v1/jobs/{job}/download")
    assert response.status_code == 200
    assert response.content == b"{}\n"
    assert (
        response.headers["content-disposition"]
        == 'attachment; filename="proj-edit_log-20261015T123456Z.jsonl"'
    )


def test_jobs_of_other_projects_are_invisible(project):
    app, _, worker, _ = project
    create_project(app.state.repo.db, "foreign")
    with app.state.repo.db.transaction() as conn:
        foreign = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == "foreign")
        ).scalar_one()
    # The requester alone must not reveal an inaccessible project's metadata.
    job = _job(app, foreign, result={"secret": "foreign"})
    assert worker.get(f"/api/v1/jobs/{job}").status_code == 404
    assert worker.get(f"/api/v1/jobs/{job}/download").status_code == 404


def test_removed_member_requester_cannot_poll_old_job(project):
    app, _, worker, pid = project
    job = _job(app, pid)
    user = app.state.accounts.get_by_username("worker")
    # Keep the session to test fresh project rights rather than session revocation.
    with app.state.repo.db.transaction() as conn:
        conn.execute(
            delete(ProjectMembershipRow).where(
                ProjectMembershipRow.project_id == pid,
                ProjectMembershipRow.user_id == user.id,
            )
        )
    assert worker.get(f"/api/v1/jobs/{job}").status_code == 404


def test_projectless_cli_job_is_concealed_even_with_legacy_payload(project):
    app, lead, worker, _ = project
    job = app.state.jobs.enqueue("t1_export", {"project": "proj"}, actor=HARNESS)
    for client in [lead, worker]:
        assert client.get(f"/api/v1/jobs/{job}").status_code == 404
        assert client.get(f"/api/v1/jobs/{job}/download").status_code == 404


@pytest.mark.parametrize(
    "kind,status,result",
    [
        ("upload_preview", "succeeded", {}),
        ("t1_export", "failed", {}),
        ("t1_export", "running", {}),
        ("t1_export", "succeeded", {}),
        ("t1_export", "succeeded", {"sha256": "../../outside"}),
        ("edit_log_export", "succeeded", {"sha256": "0" * 64}),
    ],
)
def test_download_requires_succeeded_export_and_existing_blob(
    project, kind, status, result
):
    app, lead, _, pid = project
    job = _job(app, pid, kind=kind, status=status, result=result)
    assert lead.get(f"/api/v1/jobs/{job}/download").status_code == 404
    assert _download_audits(app) == []


def test_poll_projects_only_typed_public_fields(project):
    app, lead, worker, pid = project
    job = _job(app, pid, result={"preview": {"actions": []}})
    for client in [lead, worker]:
        response = client.get(f"/api/v1/jobs/{job}")
        assert response.status_code == 200, response.text
        assert set(response.json()) == {
            "id",
            "kind",
            "status",
            "result",
            "error",
            "created_at",
            "finished_at",
        }
    stranger = logged_in(app, "other-worker", projects={"proj": ["annotator"]})
    assert stranger.get(f"/api/v1/jobs/{job}").status_code == 404
