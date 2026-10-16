"""Real review export/API/worker/CLI cases; PG execution requires root token."""

import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Event, get_ident

import pytest
from auth_harness import logged_in
from sqlalchemy import delete, event, func, insert, select, update
from test_translation_review_service import review_env as review_env
from test_translation_review_service import save
from typer.testing import CliRunner

from ontocurator.assignments.service import AssignmentService
from ontocurator.auth.audit import Actor
from ontocurator.cli import app as cli
from ontocurator.storage.repository import _lock_id
from ontocurator.storage.tables import (
    AssignmentRow,
    AuditEventRow,
    DocumentRow,
    JobRow,
    ProjectMembershipRow,
    StoredFileRow,
    UserLanguageRow,
    UserRow,
)

BASE = "/api/v1/projects/proj/exports/translation-reviews"


@pytest.fixture
def exported_env(review_env):
    env = review_env
    env.lead = logged_in(env.app, "leader", projects={"proj": ["lead"]}, assignments=[])
    env.root = logged_in(env.app, "root", system_admin=True, assignments=[])
    env.worker = logged_in(
        env.app, "alice", projects={"proj": ["annotator"]}, assignments=[]
    )
    return env


def submit(env, decision="accepted_unchanged", text="Übersetzt"):
    rev = save(
        env,
        decision,
        text,
        clinical_change=decision in {"query", "rejected"},
        categories=["source"] if decision in {"query", "rejected"} else [],
        rationale="Clarify" if decision in {"query", "rejected"} else None,
    )
    return env.service.submit(
        env.accesses["alice"], env.ids["alice"], expected_revision=rev
    )


def queued(env):
    response = env.lead.post(BASE)
    assert response.status_code == 200, response.text
    return response.json()["job_id"]


def run(env, jid, *, success=True):
    job = env.app.state.jobs.claim(jid, "test-review-export")
    assert job is not None
    result = env.app.state.jobs.run(job, "test-review-export")
    assert result.status == ("succeeded" if success else "failed"), result.error
    return result


def audits(env, action):
    with env.db.transaction() as conn:
        return list(
            conn.execute(
                select(AuditEventRow.details).where(AuditEventRow.action == action)
            ).scalars()
        )


@pytest.mark.parametrize(
    "decision", ["accepted_unchanged", "accepted_corrected", "query", "rejected"]
)
def test_real_record_contract_blob_audit_and_download(exported_env, decision):
    env = exported_env
    record = submit(
        env, decision, "Korrigiert" if decision == "accepted_corrected" else "Übersetzt"
    )
    result = run(env, queued(env))
    assert set(result.result) == {"sha256", "reviews"} and result.result["reviews"] == 1
    data = env.db.blobs.get(result.result["sha256"])
    row = json.loads(data)
    assert row["review_id"] == record.id and row["decision"] == decision
    assert row["reviewed_variant"]["document_id"] == "target"
    assert row["reviewed_variant"]["translation"]["provider"] == "test-mt"
    assert row["source_variant"]["document_id"] == "source"
    assert row["machine_text_sha256"] == record.machine_text_sha256
    assert row["proposed_text"] == record.proposed_text
    assert (
        row["proposed_text_sha256"]
        == hashlib.sha256(row["proposed_text"].encode()).hexdigest()
    )
    assert (row["created_variant"] is not None) == (decision == "accepted_corrected")
    assert set(row["reviewer"]) == {"pseudonym", "qualification", "languages"}
    assert row["reviewer"]["qualification"] == "Original qualification"
    with env.db.transaction() as conn:
        assert conn.execute(
            select(StoredFileRow.size).where(
                StoredFileRow.sha256 == result.result["sha256"]
            )
        ).scalar_one() == len(data)
        conn.execute(
            update(JobRow)
            .where(JobRow.id == result.id)
            .values(finished_at=datetime(2026, 10, 16, 12, 34, 56, tzinfo=UTC))
        )
    assert audits(env, "project.translation_review_export") == [
        {**result.result, "job_id": result.id}
    ]
    download = env.lead.get(f"/api/v1/jobs/{result.id}/download")
    assert download.status_code == 200 and download.content == data
    assert download.headers["content-type"] == "application/x-ndjson"
    assert (
        "proj-translation-reviews-20261016T123456Z.jsonl"
        in download.headers["content-disposition"]
    )
    assert audits(env, "project.export_download")[-1]["kind"] == "translation-reviews"


def test_history_uses_immutable_reviewer_and_status_snapshots(exported_env):
    env = exported_env
    first = submit(env, "query")
    AssignmentService(env.db).reopen(
        Actor.user(env.accesses["leader"].user_id, "leader"), env.ids["alice"]
    )
    second = submit(env, "accepted_unchanged")
    with env.db.transaction() as conn:
        conn.execute(
            update(UserRow)
            .where(UserRow.id == env.accesses["alice"].user_id)
            .values(qualification="Changed", display_name="Private display")
        )
        conn.execute(
            delete(UserLanguageRow).where(
                UserLanguageRow.user_id == env.accesses["alice"].user_id
            )
        )
        conn.execute(
            update(DocumentRow)
            .where(
                DocumentRow.project_id == env.pid, DocumentRow.document_id == "target"
            )
            .values(translation_status="reviewed")
        )
        conn.execute(
            delete(ProjectMembershipRow).where(
                ProjectMembershipRow.project_id == env.pid,
                ProjectMembershipRow.user_id == env.accesses["alice"].user_id,
            )
        )
    result = run(env, queued(env))
    rows = [
        json.loads(line)
        for line in env.db.blobs.get(result.result["sha256"]).splitlines()
    ]
    assert [row["review_id"] for row in rows] == [first.id, second.id]
    assert [row["status_after"] for row in rows] == ["reviewed", "accepted"]
    assert all(
        row["reviewer"]["qualification"] == "Original qualification"
        and row["reviewer"]["languages"] == ["de"]
        for row in rows
    )
    assert all(
        "Private display" not in json.dumps(row["reviewer"])
        and "user_id" not in row["reviewer"]
        for row in rows
    )


def test_correction_of_correction_exports_original_source_and_run(exported_env):
    env = exported_env
    first = submit(env, "accepted_corrected", "Corrected once")
    with env.db.transaction() as conn:
        aid = conn.execute(
            insert(AssignmentRow)
            .values(
                project_id=env.pid,
                document_id=first.created_variant_id,
                user_id=env.accesses["alice"].user_id,
                task="translation_review",
                status="open",
            )
            .returning(AssignmentRow.id)
        ).scalar_one()
    rev = env.service.save_draft(
        env.accesses["alice"],
        aid,
        expected_revision=0,
        text="Corrected twice",
        form={"decision": "accepted_corrected", "clinical_change": False},
    )
    record = env.service.submit(env.accesses["alice"], aid, expected_revision=rev)
    result = run(env, queued(env))
    rows = [
        json.loads(line)
        for line in env.db.blobs.get(result.result["sha256"]).splitlines()
    ]
    row = rows[-1]
    assert (
        row["reviewed_variant"]["version"] == 2
        and row["reviewed_variant"]["origin"] == "correction"
    )
    assert row["reviewed_variant"]["translation"]["provider"] == "test-mt"
    assert (
        row["source_variant"]["document_id"] == "source"
        and row["source_variant"]["language"] == "en"
    )
    assert row["machine_text_sha256"] == hashlib.sha256(b"Corrected once").hexdigest()
    assert (
        row["created_variant"]["version"] == 3
        and row["created_variant"]["document_id"] == "target"
    )
    assert row["proposed_text_sha256"] == record.proposed_text_sha256
    with env.db.transaction() as conn:
        assert list(
            conn.execute(
                select(DocumentRow.translation).where(
                    DocumentRow.project_id == env.pid,
                    DocumentRow.origin == "correction",
                )
            ).scalars()
        ) == [None, None]


def test_empty_export_is_real_empty_artifact(exported_env):
    env = exported_env
    job = run(env, queued(env))
    assert job.result == {"sha256": hashlib.sha256(b"").hexdigest(), "reviews": 0}
    assert env.lead.get(f"/api/v1/jobs/{job.id}/download").content == b""


def test_current_export_permission_is_required_even_for_requester(exported_env):
    env = exported_env
    assert env.worker.post(BASE).status_code == 403
    root = env.root.post(BASE)
    assert root.status_code == 200
    result = run(env, queued(env))
    with env.db.transaction() as conn:
        conn.execute(
            update(ProjectMembershipRow)
            .where(
                ProjectMembershipRow.project_id == env.pid,
                ProjectMembershipRow.user_id == env.accesses["leader"].user_id,
            )
            .values(role="annotator")
        )
    assert env.lead.get(f"/api/v1/jobs/{result.id}").status_code == 200
    assert env.lead.get(f"/api/v1/jobs/{result.id}/download").status_code == 403
    assert audits(env, "project.export_download") == []


@pytest.mark.parametrize("loss", ["role", "membership", "inactive"])
def test_worker_reauthorizes_after_enqueue(exported_env, loss):
    env = exported_env
    jid = queued(env)
    with env.db.transaction() as conn:
        if loss == "role":
            conn.execute(
                update(ProjectMembershipRow)
                .where(
                    ProjectMembershipRow.project_id == env.pid,
                    ProjectMembershipRow.user_id == env.accesses["leader"].user_id,
                )
                .values(role="annotator")
            )
        elif loss == "membership":
            conn.execute(
                delete(ProjectMembershipRow).where(
                    ProjectMembershipRow.project_id == env.pid,
                    ProjectMembershipRow.user_id == env.accesses["leader"].user_id,
                )
            )
        else:
            conn.execute(
                update(UserRow)
                .where(UserRow.id == env.accesses["leader"].user_id)
                .values(active=False)
            )
    job = run(env, jid, success=False)
    assert job.result is None and audits(env, "project.translation_review_export") == []


@pytest.mark.parametrize("malformed", ["projectless", "mismatch", "extra"])
def test_job_persisted_project_association_is_required(exported_env, malformed):
    env = exported_env
    jid = queued(env)
    with env.db.transaction() as conn:
        change = (
            {"project_id": None}
            if malformed == "projectless"
            else {
                "payload": {"project": "other"}
                if malformed == "mismatch"
                else {"project": "proj", "extra": True}
            }
        )
        conn.execute(update(JobRow).where(JobRow.id == jid).values(**change))
    run(env, jid, success=False)
    assert audits(env, "project.translation_review_export") == []
    assert env.lead.get(f"/api/v1/jobs/{jid}/download").status_code == 404


@pytest.mark.parametrize(
    "broken", ["digest", "missing", "directory", "corrupt", "count"]
)
def test_download_refuses_invalid_review_artifact_without_audit(exported_env, broken):
    env = exported_env
    result = run(env, queued(env))
    path = env.db.blobs.path(result.result["sha256"])
    if broken == "digest":
        with env.db.transaction() as conn:
            conn.execute(
                update(JobRow)
                .where(JobRow.id == result.id)
                .values(result={"sha256": "A" * 64, "reviews": 0})
            )
    elif broken == "count":
        with env.db.transaction() as conn:
            conn.execute(
                update(JobRow)
                .where(JobRow.id == result.id)
                .values(result={"sha256": result.result["sha256"], "reviews": True})
            )
    elif broken == "missing":
        path.unlink()
    elif broken == "directory":
        path.unlink()
        path.mkdir()
    else:
        path.write_bytes(b"corrupt")
    assert env.lead.get(f"/api/v1/jobs/{result.id}/download").status_code == 404
    assert audits(env, "project.export_download") == []


def test_failed_audit_rolls_back_stored_metadata_and_job_success(
    exported_env, monkeypatch
):
    import ontocurator.exchange.review_export as module

    env = exported_env

    def fail(*args, **kwargs):
        raise RuntimeError("audit failure")

    monkeypatch.setattr(module, "record_audit", fail)
    job = run(env, queued(env), success=False)
    assert job.result is None
    with env.db.transaction() as conn:
        assert (
            conn.execute(
                select(func.count())
                .select_from(StoredFileRow)
                .where(StoredFileRow.sha256 == hashlib.sha256(b"").hexdigest())
            ).scalar_one()
            == 0
        )
    assert audits(env, "project.translation_review_export") == []
    assert env.lead.get(f"/api/v1/jobs/{job.id}/download").status_code == 404


def test_cli_writes_reviews_and_preserves_no_wait_overwrite_contract(
    exported_env, tmp_path, monkeypatch
):
    env = exported_env
    submit(env)
    monkeypatch.setenv("ONTOCURATOR_DATA_DIR", str(env.db.data_dir))
    args = [
        "admin",
        "--database-url",
        env.db.url.render_as_string(hide_password=False),
        "export-translation-reviews",
        "proj",
    ]
    out = tmp_path / "reviews.jsonl"
    runner = CliRunner()
    result = runner.invoke(cli, [*args, str(out)])
    assert result.exit_code == 0, result.output
    assert (
        "1 review." in result.output
        and json.loads(out.read_bytes())["decision"] == "accepted_unchanged"
    )
    before = out.read_bytes()
    result = runner.invoke(cli, [*args, str(out)])
    assert (
        result.exit_code == 1
        and "OUTPUT_EXISTS" in result.output
        and out.read_bytes() == before
    )
    queued_only = tmp_path / "queued.jsonl"
    result = runner.invoke(cli, [*args, str(queued_only), "--no-wait"])
    assert (
        result.exit_code == 0
        and "Queued job" in result.output
        and not queued_only.exists()
    )
    with env.db.transaction() as conn:
        queued_job = (
            conn.execute(
                select(JobRow).where(
                    JobRow.kind == "translation_review_export",
                    JobRow.status == "queued",
                )
            )
            .mappings()
            .one()
        )
        assert queued_job["project_id"] == env.pid and queued_job[
            "requested_label"
        ].startswith("cli:")
    run(env, queued_job["id"])


@pytest.mark.parametrize("loss", ["role", "inactive"])
def test_worker_refreshes_authority_after_members_lock_wait(exported_env, loss):
    env = exported_env
    jid = queued(env)
    waiting = Event()
    owner = get_ident()

    def at_lock(conn, cursor, statement, parameters, context, executemany):
        if get_ident() != owner and "pg_advisory_xact_lock_shared" in statement:
            waiting.set()

    event.listen(env.db.engine, "before_cursor_execute", at_lock)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            with env.db.transaction() as conn:
                conn.execute(
                    select(func.pg_advisory_xact_lock(_lock_id("members", "proj")))
                )
                future = pool.submit(run, env, jid, success=False)
                assert waiting.wait(10)
                if loss == "role":
                    conn.execute(
                        update(ProjectMembershipRow)
                        .where(
                            ProjectMembershipRow.project_id == env.pid,
                            ProjectMembershipRow.user_id
                            == env.accesses["leader"].user_id,
                        )
                        .values(role="annotator")
                    )
                else:
                    conn.execute(
                        update(UserRow)
                        .where(UserRow.id == env.accesses["leader"].user_id)
                        .values(active=False)
                    )
            assert future.result(timeout=15).result is None
    finally:
        event.remove(env.db.engine, "before_cursor_execute", at_lock)
    assert audits(env, "project.translation_review_export") == []


def test_review_read_is_bounded_metadata_with_no_document_text(exported_env):
    env = exported_env
    submit(env, "query")
    statements = []

    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(env.db.engine, "before_cursor_execute", capture)
    try:
        run(env, queued(env))
    finally:
        event.remove(env.db.engine, "before_cursor_execute", capture)
    document_queries = [
        sql
        for sql in statements
        if sql.startswith("SELECT ") and "ontocurator.documents" in sql
    ]
    assert len(document_queries) == 1
    assert "ontocurator.documents.text," not in document_queries[0]
    review_queries = [
        sql
        for sql in statements
        if sql.startswith("SELECT ") and "FROM ontocurator.translation_reviews" in sql
    ]
    assert len(review_queries) == 1


def test_cli_output_creation_race_and_failed_job_are_honest(
    exported_env, tmp_path, monkeypatch
):
    from pathlib import Path

    import ontocurator.exchange.review_export as module

    env = exported_env
    monkeypatch.setenv("ONTOCURATOR_DATA_DIR", str(env.db.data_dir))
    args = [
        "admin",
        "--database-url",
        env.db.url.render_as_string(hide_password=False),
        "export-translation-reviews",
        "proj",
    ]
    out = tmp_path / "race.jsonl"
    original = Path.open

    def race(path, mode="r", *args, **kwargs):
        if path == out and mode == "xb":
            path.write_bytes(b"other process")
        return original(path, mode, *args, **kwargs)

    monkeypatch.setattr(Path, "open", race)
    runner = CliRunner()
    result = runner.invoke(cli, [*args, str(out)])
    assert result.exit_code == 1 and "OUTPUT_EXISTS" in result.output
    assert out.read_bytes() == b"other process"

    def fail(*args, **kwargs):
        raise RuntimeError("export failure")

    monkeypatch.setattr(module, "serialize_review_export", fail)
    failed = tmp_path / "failure.jsonl"
    result = runner.invoke(cli, [*args, str(failed)])
    assert result.exit_code == 1 and "JOB_FAILED" in result.output
    assert not failed.exists()


@pytest.mark.parametrize("status", ["queued", "running", "failed"])
def test_review_download_requires_successful_terminal_job(exported_env, status):
    env = exported_env
    result = run(env, queued(env))
    with env.db.transaction() as conn:
        conn.execute(update(JobRow).where(JobRow.id == result.id).values(status=status))
    assert env.lead.get(f"/api/v1/jobs/{result.id}/download").status_code == 404
    assert audits(env, "project.export_download") == []


def test_removed_exporter_cannot_poll_or_download_and_csrf_cannot_enqueue(exported_env):
    env = exported_env
    refused = env.lead.post(BASE, headers={"X-CSRF-Token": "wrong"})
    assert refused.status_code == 403 and refused.json()["code"] == "CSRF_FAILED"
    result = run(env, queued(env))
    with env.db.transaction() as conn:
        conn.execute(
            delete(ProjectMembershipRow).where(
                ProjectMembershipRow.project_id == env.pid,
                ProjectMembershipRow.user_id == env.accesses["leader"].user_id,
            )
        )
    assert env.lead.get(f"/api/v1/jobs/{result.id}").status_code == 404
    assert env.lead.get(f"/api/v1/jobs/{result.id}/download").status_code == 404
    assert audits(env, "project.export_download") == []
