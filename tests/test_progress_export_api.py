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
from test_pg_repository import _key, _submission
from test_storage import _sample_package
from test_t1_export import DOC, _own, _submit

from ontocurator.domain.annotations import AnnotationRef
from ontocurator.domain.errors import DomainError
from ontocurator.domain.review import ReviewTargetSet
from ontocurator.domain.scopes import build_scope
from ontocurator.exchange.jobs import store_file
from ontocurator.storage.repository import _key_str
from ontocurator.storage.tables import (
    AssignmentRow,
    AuditEventRow,
    DocumentRow,
    DraftRow,
    JobRow,
    ProjectMembershipRow,
    ProjectRow,
    SubmissionRow,
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
    lead = logged_in(
        app, "lead", pseudonym="blind-lead", projects={"proj": ["lead"]}, assignments=[]
    )
    worker = logged_in(
        app,
        "worker",
        pseudonym="blind-worker",
        projects={"proj": ["annotator"]},
        assignments=[],
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
                annotation_mode="scratch" if task == "annotate" else None,
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
            "pseudonym": "blind-lead",
            "task": "review",
            "status": "submitted",
            "active_round_id": None,
            "workflow_revision": 0,
            "held": False,
            "hold_reason": None,
        },
        {
            "assignment_id": opened,
            "username": "worker",
            "pseudonym": "blind-worker",
            "task": "annotate",
            "status": "open",
            "active_round_id": None,
            "workflow_revision": 0,
            "held": False,
            "hold_reason": None,
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
    # The per-document projection stays one statement without text; the
    # stage counts read the Documents facts (spec D9) separately.
    projections = [
        statement
        for statement in statements
        if "FROM ontocurator.documents LEFT OUTER JOIN ontocurator.assignments"
        in statement
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
        "lede": {
            "cases": 0,
            "translations_to_review": 0,
            "versions_to_annotate": 0,
            "not_in_plan": 0,
            "needs_decision": 0,
            "to_assign": 0,
        },
        "stages": {
            name: {
                "scope": scope,
                "done": 0,
                "total": 0,
                "counts": counts,
                "links": response.json()["stages"][name]["links"],
            }
            for name, scope, counts in (
                (
                    "translation_review",
                    "review",
                    dict.fromkeys(
                        (
                            "to_assign",
                            "in_review",
                            "check_failed",
                            "check_failed_with_reviewer",
                            "rejected_or_queried",
                            "accepted",
                        ),
                        0,
                    ),
                ),
                (
                    "annotation",
                    "annotate",
                    dict.fromkeys(
                        (
                            "waiting_for_review",
                            "to_assign",
                            "in_progress",
                            "paused",
                            "submitted",
                        ),
                        0,
                    ),
                ),
                (
                    "final",
                    "annotate",
                    dict.fromkeys(
                        (
                            "not_ready",
                            "to_choose",
                            "to_confirm",
                            "final",
                            "would_be_omitted",
                        ),
                        0,
                    ),
                ),
            )
        },
        "workload": [],
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


def test_export_download_rechecks_lost_export_privilege(project):
    app, lead, _, pid = project
    sha = store_file(app.state.repo.db, b"{}\n")
    job = _job(
        app, pid, requester="lead", kind="edit_log_export", result={"sha256": sha}
    )
    user = app.state.accounts.get_by_username("lead")
    with app.state.repo.db.transaction() as conn:
        conn.execute(
            delete(ProjectMembershipRow).where(
                ProjectMembershipRow.project_id == pid,
                ProjectMembershipRow.user_id == user.id,
            )
        )
        conn.execute(
            insert(ProjectMembershipRow).values(
                project_id=pid, user_id=user.id, role="annotator"
            )
        )
    assert lead.get(f"/api/v1/jobs/{job}").status_code == 200
    assert lead.get(f"/api/v1/jobs/{job}/download").status_code == 403
    assert _download_audits(app) == []


def test_export_result_payload_must_match_job_project(project):
    app, lead, _, pid = project
    sha = store_file(app.state.repo.db, b"{}\n")
    job = _job(
        app,
        pid,
        kind="edit_log_export",
        result={"sha256": sha},
        payload={"project": "other"},
    )
    assert lead.get(f"/api/v1/jobs/{job}/download").status_code == 404
    assert _download_audits(app) == []


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


def test_documents_filter_by_language_status_and_prefix(project):
    app, lead, _, pid = project
    assignment = _assignment(app, pid, DOC, "worker", "in_progress")
    _assignment(app, pid, "second", "worker", "submitted", revoked=True)
    assert lead.get(f"{BASE}/documents", params={"language": "en"}).json() == []
    response = lead.get(
        f"{BASE}/documents",
        params={"language": "de", "status": "in_progress", "q": "EN"},
    )
    assert response.status_code == 200, response.text
    rows = response.json()
    assert [(row["document_id"], row["position"]) for row in rows] == [(DOC, 9)]
    assert rows[0]["assignees"][0]["assignment_id"] == assignment
    assert rows[0]["text_length"] == len(app.state.repo.get_document("proj", DOC).text)
    assert (
        lead.get(f"{BASE}/documents", params={"status": "unassigned"}).json()[0][
            "document_id"
        ]
        == "second"
    )
    assert lead.get(f"{BASE}/documents", params={"q": "EN%"}).json() == []
    assert (
        lead.get(f"{BASE}/documents", params={"status": "completed"}).status_code == 422
    )


def test_document_and_progress_keep_nullable_stored_position(project):
    app, lead, _, pid = project
    with app.state.repo.db.transaction() as conn:
        conn.execute(
            update(DocumentRow)
            .where(DocumentRow.project_id == pid, DocumentRow.document_id == "second")
            .values(position=None)
        )
    documents = lead.get(f"{BASE}/documents")
    progress = lead.get(f"{BASE}/progress")
    assert documents.status_code == progress.status_code == 200
    assert [(d["document_id"], d["position"]) for d in documents.json()] == [
        (DOC, 9),
        ("second", None),
    ]
    assert [
        (d["document_id"], d["position"]) for d in progress.json()["documents"]
    ] == [(DOC, 9), ("second", None)]
    filtered = lead.get(f"{BASE}/documents", params={"q": "second"})
    assert filtered.status_code == 200
    assert filtered.json()[0]["position"] is None


def test_document_filters_preserve_current_assignment_visibility(project):
    app, _, worker, pid = project
    _assignment(app, pid, DOC, "worker", "open")
    _assignment(app, pid, "second", "lead", "submitted", task="review")
    response = worker.get(f"{BASE}/documents")
    assert response.status_code == 200, response.text
    assert [(d["document_id"], d["position"]) for d in response.json()] == [(DOC, 9)]
    assert "assignees" not in response.json()[0]
    assert worker.get(f"{BASE}/documents", params={"status": "submitted"}).json() == []
    assert worker.get(f"{BASE}/documents", params={"status": "unassigned"}).json() == []
    assert worker.get(f"{BASE}/documents", params={"q": "second"}).json() == []
    assert worker.get(f"{BASE}/documents", params={"mode": "review"}).status_code == 403
    assert (
        worker.get(f"{BASE}/documents", params={"annotator_id": "lead"}).status_code
        == 403
    )


@pytest.mark.parametrize("mode", ["independent", "review"])
@pytest.mark.parametrize(
    "scenario",
    ["empty", "imported", "newer", "origins", "round", "checked", "conflict"],
)
def test_document_list_preserves_legacy_status_semantics(tmp_path, mode, scenario):
    app = _app(tmp_path)
    repo = app.state.repo
    package = _sample_package("pkg-a")
    key = _key().model_copy(
        update={
            "mode": mode,
            "scope_id": build_scope(package.manifest.task_profile, mode).scope_id,
        }
    )
    if scenario in {"imported", "newer", "origins", "round"}:
        package.submissions = {
            "old": _submission(
                key.model_copy(update={"project_key": "origin-a"}), 2
            ).model_copy(update={"submission_id": "old"}),
            "new": _submission(
                key.model_copy(update={"project_key": "origin-a"}), 7
            ).model_copy(update={"submission_id": "new"}),
        }
        if scenario == "origins":
            package.submissions["other"] = _submission(
                key.model_copy(update={"project_key": "origin-b"}), 99
            ).model_copy(update={"submission_id": "other"})
    repo.import_package(package)
    local = (
        key.model_copy(update={"target_set_id": "targets-0"})
        if mode == "independent"
        else key
    )
    if scenario in {"newer", "origins", "checked", "round"}:
        if scenario == "round":
            local = local.model_copy(update={"target_set_id": "another-round"})
        if scenario == "origins":
            # Restoration correctly refuses multiple origins. Project the
            # existing local-draft state directly, as the legacy batch-status
            # regression does, without weakening that restoration guard.
            with repo.db.transaction() as conn:
                pid = conn.execute(select(ProjectRow.id)).scalar_one()
                conn.execute(
                    insert(DraftRow).values(
                        project_id=pid,
                        draft_key=_key_str(local),
                        document_id=local.document_id,
                        annotator_id=local.annotator_id,
                        mode=mode,
                        scope_id=local.scope_id,
                        target_set_id=local.target_set_id,
                        targets=ReviewTargetSet.create([]).model_dump(),
                        revision=0,
                        updated_at=datetime.now(UTC),
                    )
                )
        else:
            repo.open_draft(local)
        with repo.db.transaction() as conn:
            if scenario in {"newer", "round"}:
                conn.execute(update(DraftRow).values(revision=8))
            elif scenario == "checked":
                conn.execute(update(DraftRow).values(checked_layer_ids=["hpo-layer"]))
    if scenario == "conflict":
        first = _submission(key, 3)
        with repo.db.transaction() as conn:
            pid = conn.execute(select(ProjectRow.id)).scalar_one()
            for identifier in ["first", "second"]:
                payload = first.model_copy(
                    update={"submission_id": identifier}
                ).model_dump(mode="json")
                conn.execute(
                    insert(SubmissionRow).values(
                        project_id=pid,
                        submission_id=identifier,
                        local_key=_key_str(key),
                        origin_key=_key_str(key),
                        document_id="doc-1",
                        annotator_id="ann-1",
                        mode=mode,
                        draft_revision=3,
                        payload=payload,
                        created_at=first.created_at,
                    )
                )
        with pytest.raises(DomainError, match="CONFLICTING_SUBMISSION_REVISION"):
            repo.get_document_statuses("pkg-a", "ann-1", mode)
    else:
        expected = repo.get_document_statuses("pkg-a", "ann-1", mode).get(
            "doc-1", "not_started"
        )
    lead = logged_in(
        app, "status-lead", projects={"pkg-a": ["lead", "adjudicator"]}, assignments=[]
    )
    response = lead.get(
        "/api/v1/projects/pkg-a/documents",
        params={"annotator_id": "ann-1", "mode": mode},
    )
    if scenario == "conflict":
        assert response.status_code == 422, response.text
        assert response.json()["code"] == "CONFLICTING_SUBMISSION_REVISION"
    else:
        assert response.status_code == 200, response.text
        assert response.json()[0]["status"] == expected


@pytest.mark.parametrize("conflict_first", [False, True])
def test_review_round_conflict_order_matches_existing_reader(tmp_path, conflict_first):
    app = _app(tmp_path)
    repo = app.state.repo
    package = _sample_package("pkg-a")
    repo.import_package(package)
    annotation = next(iter(package.annotations.values()))
    rounds = sorted(
        [
            ReviewTargetSet.create([]),
            ReviewTargetSet.create(
                [
                    AnnotationRef(
                        annotation_id=annotation.annotation.annotation_id,
                        version=annotation.version,
                    )
                ]
            ),
        ],
        key=lambda targets: targets.target_set_id,
    )
    active_targets, conflict_targets = (
        (rounds[1], rounds[0]) if conflict_first else rounds
    )
    active = _key().model_copy(
        update={
            "mode": "review",
            "scope_id": build_scope(package.manifest.task_profile, "review").scope_id,
            "target_set_id": active_targets.target_set_id,
        }
    )
    conflicting = active.model_copy(
        update={"target_set_id": conflict_targets.target_set_id}
    )
    repo.open_draft(active, active_targets)
    with repo.db.transaction() as conn:
        pid = conn.execute(select(ProjectRow.id)).scalar_one()
        conn.execute(
            update(DraftRow)
            .where(DraftRow.project_id == pid, DraftRow.draft_key == _key_str(active))
            .values(revision=1)
        )
        for identifier in ["first", "second"]:
            submission = _submission(conflicting, 3).model_copy(
                update={"submission_id": identifier, "targets": conflict_targets}
            )
            conn.execute(
                insert(SubmissionRow).values(
                    project_id=pid,
                    submission_id=identifier,
                    local_key=_key_str(conflicting),
                    origin_key=_key_str(conflicting),
                    document_id=conflicting.document_id,
                    annotator_id=conflicting.annotator_id,
                    mode="review",
                    draft_revision=3,
                    payload=submission.model_dump(mode="json"),
                    created_at=submission.created_at,
                )
            )
    if conflict_first:
        with pytest.raises(DomainError, match="CONFLICTING_SUBMISSION_REVISION"):
            repo.get_document_statuses("pkg-a", "ann-1", "review")
    else:
        assert repo.get_document_statuses("pkg-a", "ann-1", "review") == {
            "doc-1": "in_progress"
        }
    lead = logged_in(
        app, "status-lead", projects={"pkg-a": ["lead", "adjudicator"]}, assignments=[]
    )
    response = lead.get(
        "/api/v1/projects/pkg-a/documents",
        params={"annotator_id": "ann-1", "mode": "review"},
    )
    if conflict_first:
        assert response.status_code == 422, response.text
        assert response.json()["code"] == "CONFLICTING_SUBMISSION_REVISION"
    else:
        assert response.status_code == 200, response.text
        assert response.json()[0]["status"] == "in_progress"


@pytest.mark.parametrize("count", [1, 100])
def test_document_list_queries_are_bounded_and_metadata_only(project, count):
    app, lead, _, pid = project
    with app.state.repo.db.transaction() as conn:
        conn.execute(
            insert(DocumentRow),
            [
                {
                    "project_id": pid,
                    "document_id": f"extra-{i}",
                    "case_id": f"extra-{i}",
                    "external_id": f"extra-{i}",
                    "language": "de",
                    "position": 30 + i,
                    "text": "Text.",
                    "text_sha256": "0" * 64,
                }
                for i in range(count)
            ],
        )
    statements = []

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(app.state.repo.db.engine, "before_cursor_execute", record)
    try:
        response = lead.get(f"{BASE}/documents", params={"mode": "independent"})
    finally:
        event.remove(app.state.repo.db.engine, "before_cursor_execute", record)
    assert response.status_code == 200, response.text
    assert len(response.json()) == count + 2
    assert len(statements) <= 30
    assert not any(
        "submissions.payload," in sql or "submissions.payload \n" in sql
        for sql in statements
    )
    assert not any(
        "annotation_snapshots" in sql or "evidence_snapshots" in sql
        for sql in statements
    )
    document_queries = [
        sql for sql in statements if "FROM ontocurator.documents" in sql
    ]
    assert len(document_queries) == 1
    assert "length(ontocurator.documents.text)" in document_queries[0]


def test_work_of_an_anonymised_account_still_exports_under_its_pseudonym(
    project, tmp_path
):
    from ontocurator.auth.audit import Actor

    app, lead, _, _ = project
    db = app.state.repo.db
    _submit(
        db,
        "blind-worker",
        "independent",
        [_own(db, "blind-worker", "human-a", (6, 19), {"assertion": "present"})],
        submission_id="anon-export",
    )
    accounts = app.state.accounts
    accounts.set_active(Actor.cli(), "worker", False)
    erased = accounts.anonymise(Actor.cli(), "worker")
    assert erased.pseudonym == "blind-worker" and erased.display_name != "worker"

    queued = lead.post(f"{BASE}/exports", json={"kind": "edit_log"})
    assert queued.status_code == 200, queued.text
    job = _run(app, queued.json()["job_id"])
    downloaded = lead.get(f"/api/v1/jobs/{job.id}/download")
    assert downloaded.status_code == 200, downloaded.text
    assert "blind-worker" in downloaded.text
    bundle_job = _run(
        app, lead.post(f"{BASE}/exports", json={"kind": "t1"}).json()["job_id"]
    )
    target = tmp_path / "after-erasure.zip"
    target.write_bytes(lead.get(f"/api/v1/jobs/{bundle_job.id}/download").content)
    _, units = ontospan.read_bundle(
        target, {"hp": ontospan.ObographOntology.load(HP_PATH)}
    )
    assert len(units) == 1
    assert "blind-worker" in json.dumps(units[0].model_dump(mode="json"))
