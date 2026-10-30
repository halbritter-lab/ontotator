"""A resumed staged upload can recover its persisted preview job."""

from auth_harness import logged_in
from t1_fixtures import create_project
from test_auth_api import _app
from test_uploads_api import BASE, _create, _run


def test_resuming_an_upload_recovers_the_real_preview_job(tmp_path):
    app = _app(tmp_path)
    create_project(app.state.repo.db)
    admin = logged_in(app, "root", system_admin=True)
    other = logged_in(app, "other")
    created = _create(admin)
    assert created.status_code == 200, created.text
    ids = created.json()
    url = f"{BASE}/{ids['upload_id']}"

    # Neither a reload nor a new component has the original create response.
    # Both persisted read paths must expose the actual queued job identifier.
    previewing = admin.get(url)
    assert previewing.status_code == 200, previewing.text
    assert previewing.json()["status"] == "previewing"
    assert previewing.json()["preview_job_id"] == ids["job_id"]
    assert admin.get(BASE).json()[0]["preview_job_id"] == ids["job_id"]
    job_url = f"/api/v1/jobs/{ids['job_id']}"
    assert admin.get(job_url).json()["id"] == ids["job_id"]
    assert other.get(url).status_code == 404
    assert other.get(BASE).status_code == 404
    assert other.get(job_url).status_code == 404

    assert _run(app, ids["job_id"]).status == "succeeded"
    ready = admin.get(url).json()
    assert ready["status"] == "ready"
    assert ready["preview_job_id"] == ids["job_id"]
    assert ready["commit_job_id"] is None
    committed = admin.post(f"{url}/commit", json={"plan_sha256": ready["plan_sha256"]})
    assert committed.status_code == 200, committed.text
    commit_id = committed.json()["job_id"]
    assert commit_id != ids["job_id"]
    assert _run(app, commit_id).status == "succeeded"
    finished = admin.get(url).json()
    assert finished["status"] == "committed"
    assert finished["preview_job_id"] == ids["job_id"]
    assert finished["commit_job_id"] == commit_id


def test_job_status_does_not_wait_for_an_import_holding_the_project(tmp_path):
    """Polling a job must not queue behind the import's exclusive project lock (#198)."""
    from concurrent.futures import ThreadPoolExecutor

    from sqlalchemy import func, select

    from ontotator.storage.repository import _lock_id

    app = _app(tmp_path)
    db = app.state.repo.db
    create_project(db)
    admin = logged_in(app, "root", system_admin=True)
    ids = _create(admin).json()
    job_url = f"/api/v1/jobs/{ids['job_id']}"
    with ThreadPoolExecutor(1) as pool, db.transaction() as conn:
        conn.execute(select(func.pg_advisory_xact_lock(_lock_id("project", "proj"))))
        polled = pool.submit(admin.get, job_url)
        assert polled.result(timeout=10).json()["id"] == ids["job_id"]
