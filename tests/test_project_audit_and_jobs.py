"""The project's audit trail (issue 356) and job list (issue 355).

Leads and their tokens read both; other members get 403 and a token of
another project is refused. People appear as person references: no login
leaves for a lead, only for a system administrator.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from auth_harness import ORIGIN, logged_in
from fastapi import FastAPI
from fastapi.testclient import TestClient
from proposal_check_support import assign, client, proposal_env
from sqlalchemy import update
from t1_fixtures import create_project

from ontotator.api.token_scopes import requirement
from ontotator.auth.audit import Actor
from ontotator.storage.tables import JobRow

AUDIT = "/api/v1/projects/proj/audit"
JOBS = "/api/v1/projects/proj/jobs"


def _token(client: TestClient, scopes: list[str], project: str = "proj") -> str:
    response = client.post(
        f"/api/v1/projects/{project}/tokens",
        json={"name": "pipeline", "scopes": scopes},
    )
    assert response.status_code == 201, response.text
    return str(response.json()["secret"])


def _bearer(app: FastAPI, secret: str) -> TestClient:
    return TestClient(app, headers={"Authorization": f"Bearer {secret}", **ORIGIN})


def _pseudonym(env: Any, username: str) -> str:
    members = env.lead.get("/api/v1/projects/proj/members").json()
    return str(next(m["pseudonym"] for m in members if m["username"] == username))


def _logins(value: Any) -> set[str]:
    """Every string anywhere in ``value``."""
    if isinstance(value, dict):
        return {s for item in value.values() for s in _logins(item)}
    if isinstance(value, list):
        return {s for item in value for s in _logins(item)}
    return {value} if isinstance(value, str) else set()


def _set_roles(env: Any, username: str, roles: list[str], by: Any = None) -> None:
    response = (by or env.lead).put(
        f"/api/v1/projects/proj/members/{username}",
        json={"roles": roles, "revoke_assignments": False},
    )
    assert response.status_code == 200, response.text


def test_the_routes_need_read_and_are_open_to_project_tokens() -> None:
    for path in (AUDIT, JOBS):
        needed = requirement("GET", path)
        assert needed is not None
        assert needed.scope == "read"
        assert needed.project_token is True
        assert needed.project_key == "proj"


def test_a_lead_and_the_leads_token_read_the_audit(tmp_path) -> None:
    env = proposal_env(tmp_path)
    _set_roles(env, "tom", ["annotator", "adjudicator"])
    secret = _token(env.lead, ["read", "project-admin"])
    token = _bearer(env.app, secret)
    # A change made with the token names it.
    task = assign(env, env.c1, "anno")
    revoked = token.post(
        f"/api/v1/assignments/{task['id']}/revoke", json={"reason": "left"}
    )
    assert revoked.status_code == 200, revoked.text
    for reader in (env.lead, token):
        response = reader.get(AUDIT)
        assert response.status_code == 200, response.text
        page = response.json()
        assert page["total"] == len(page["events"]) > 0
        actions = [event["action"] for event in page["events"]]
        assert "assignment.revoke" in actions
        assert "project.member_add" in actions
        # Token requests are not part of the trail.
        assert "api_token.use" not in actions
        newest = page["events"][0]
        assert newest["action"] == "assignment.revoke"
        assert newest["actor_kind"] == "person"
        assert newest["actor"]["display_name"] is not None
        assert newest["api_token"]["name"] == "pipeline"
        # No login of anybody, and no raw audit label.
        for event in page["events"]:
            assert event["actor_label"] is None
            assert not {"tom", "anno", "user:leader"} & _logins(event)
        added = next(e for e in page["events"] if e["action"] == "project.member_add")
        assert added["target_type"] == "user"
        assert added["target_id"] is None
        assert added["target_person"]["pseudonym"] == _pseudonym(env, "tom")
        assert added["details"]["roles"] == ["adjudicator"]
        assert "username" not in added["details"]


def test_a_system_admin_sees_the_raw_labels(tmp_path) -> None:
    env = proposal_env(tmp_path)
    _set_roles(env, "tom", ["annotator", "adjudicator"])
    admin = logged_in(env.app, "root", system_admin=True, assignments=[])
    page = admin.get(AUDIT).json()
    added = next(e for e in page["events"] if e["action"] == "project.member_add")
    assert added["actor_label"] == "user:leader"
    assert added["target_id"] == "tom"
    assert added["details"]["username"] == "tom"
    # The test import ran as a process, not as a person.
    imported = next(e for e in page["events"] if e["action"] == "project.import")
    assert imported["actor_kind"] == "system"
    assert imported["actor"] is None
    assert imported["actor_label"] == "test:operator"


def test_other_members_and_other_projects_are_refused(tmp_path) -> None:
    env = proposal_env(tmp_path)
    member = client(env, "anno")
    for path in (AUDIT, JOBS):
        refused = member.get(path)
        assert refused.status_code == 403, refused.text
        assert refused.json()["code"] == "NOT_ALLOWED"
    stranger = logged_in(env.app, "stranger", assignments=[])
    for path in (AUDIT, JOBS):
        hidden = stranger.get(path)
        assert hidden.status_code == 404, hidden.text
        assert hidden.json()["code"] == "PROJECT_NOT_FOUND"
    # A lead of another project, with a token of that project.
    create_project(env.db, key="other")
    other = logged_in(env.app, "leader2", projects={"other": ["lead"]}, assignments=[])
    foreign = _bearer(env.app, _token(other, ["read"], "other"))
    for path in (AUDIT, JOBS):
        response = foreign.get(path)
        assert response.status_code == 403, response.text
        assert response.json()["code"] == "TOKEN_NOT_ALLOWED"
        # Nor does the other lead's session see it.
        assert other.get(path).status_code == 404
    # A token without the read scope is refused.
    export_only = _bearer(env.app, _token(env.lead, ["export"]))
    for path in (AUDIT, JOBS):
        response = export_only.get(path)
        assert response.status_code == 403
        assert response.json()["code"] == "TOKEN_SCOPE_MISSING"


def test_audit_filters_and_pages(tmp_path) -> None:
    env = proposal_env(tmp_path)
    _set_roles(env, "tom", ["annotator", "adjudicator"])
    _set_roles(env, "anno2", ["annotator", "adjudicator"])
    task = assign(env, env.c1, "anno")
    secret = _token(env.lead, ["read", "project-admin"])
    token_id = env.lead.get("/api/v1/projects/proj/tokens").json()[0]["id"]
    revoked = _bearer(env.app, secret).post(
        f"/api/v1/assignments/{task['id']}/revoke", json={}
    )
    assert revoked.status_code == 200, revoked.text

    def actions(**params: Any) -> list[str]:
        response = env.lead.get(AUDIT, params=params)
        assert response.status_code == 200, response.text
        return [event["action"] for event in response.json()["events"]]

    added = actions(action="project.member_add")
    assert added and set(added) == {"project.member_add"}
    assert set(actions(action="assignment.*")) == {
        "assignment.create",
        "assignment.revoke",
    }
    assert set(actions(action=["project.member_add", "assignment.revoke"])) == {
        "project.member_add",
        "assignment.revoke",
    }
    # By person: what was done to tom, by pseudonym or login.
    tom = _pseudonym(env, "tom")
    assert actions(person=tom) == ["project.member_add"] * 2
    assert actions(person="tom") == ["project.member_add"] * 2
    # The task made for anno counts as concerning anno.
    assert "assignment.create" in actions(person="anno")
    assert "assignment.create" not in actions(person="tom")
    assert actions(person="nobody-at-all") == []
    # By the token the change was made with.
    assert actions(api_token_id=token_id) == ["assignment.revoke"]
    # By time.
    future = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    past = (datetime.now(UTC) - timedelta(days=1)).isoformat()
    assert actions(since=future) == []
    assert actions(until=past) == []
    assert len(actions(since=past, until=future)) == len(actions())
    # Pages, newest first.
    everything = env.lead.get(AUDIT).json()
    first = env.lead.get(AUDIT, params={"limit": 2}).json()
    second = env.lead.get(AUDIT, params={"limit": 2, "offset": 2}).json()
    assert first["total"] == second["total"] == everything["total"] >= 4
    ids = [e["id"] for e in everything["events"]]
    assert [e["id"] for e in first["events"] + second["events"]] == ids[:4]
    assert env.lead.get(AUDIT, params={"limit": 0}).status_code == 422


def _run(env: Any, job_id: int) -> Any:
    queue = env.app.state.jobs
    return queue.run(queue.claim(job_id, "test"), "test")


def test_a_lead_and_a_token_list_the_projects_jobs(tmp_path) -> None:
    env = proposal_env(tmp_path)
    started = env.lead.post("/api/v1/projects/proj/exports", json={"kind": "edit_log"})
    assert started.status_code == 200, started.text
    done = _run(env, started.json()["job_id"])
    assert done.status == "succeeded", done.error
    queued = env.lead.post("/api/v1/projects/proj/exports", json={"kind": "t1"})
    queued_id = queued.json()["job_id"]
    failed_id = env.app.state.jobs.enqueue(
        "edit_log_export",
        {"project": "proj"},
        project_id=env.pid,
        actor=Actor(None, "cli:operator"),
    )
    with env.db.transaction() as conn:
        conn.execute(
            update(JobRow)
            .where(JobRow.id == failed_id)
            .values(
                status="failed",
                error="DomainError: [EXPORT_FAILED] source missing",
                finished_at=datetime.now(UTC),
            )
        )
    # An archive job of the project is not listed.
    archive_id = env.app.state.jobs.enqueue(
        "project_archive_export",
        {"project": "proj"},
        project_id=env.pid,
        actor=Actor(None, "cli:x"),
    )
    reader = _bearer(env.app, _token(env.lead, ["read"]))
    exporter = _bearer(env.app, _token(env.lead, ["read", "export"]))
    lead_page = env.lead.get(JOBS).json()
    jobs = {job["id"]: job for job in lead_page["jobs"]}
    assert archive_id not in jobs
    assert [job["id"] for job in lead_page["jobs"]][:3] == [
        failed_id,
        queued_id,
        done.id,
    ]
    finished = jobs[done.id]
    assert finished["kind"] == "edit_log_export"
    assert finished["status"] == "succeeded"
    assert finished["requested_by"]["display_name"] is not None
    assert finished["requested_by"]["is_me"] is True
    assert finished["download_path"] == f"/api/v1/jobs/{done.id}/download"
    assert finished["started_at"] is not None
    assert jobs[queued_id]["status"] == "queued"
    assert jobs[queued_id]["download_path"] is None
    broken = jobs[failed_id]
    assert broken["error_code"] == "EXPORT_FAILED"
    assert broken["requested_by"] is None
    assert broken["requested_by_command_line"] is True
    assert not {"cli:operator", "user:leader"} & _logins(lead_page)
    # A read token lists them too, but downloads need the export scope.
    listed = reader.get(JOBS)
    assert listed.status_code == 200, listed.text
    assert {job["id"]: job for job in listed.json()["jobs"]}[done.id][
        "download_path"
    ] is None
    with_export = {job["id"]: job for job in exporter.get(JOBS).json()["jobs"]}
    path = with_export[done.id]["download_path"]
    assert exporter.get(path).status_code == 200
    assert reader.get(path).status_code == 403

    def ids(**params: Any) -> list[int]:
        response = env.lead.get(JOBS, params=params)
        assert response.status_code == 200, response.text
        return [job["id"] for job in response.json()["jobs"]]

    assert ids(kind="t1_export") == [queued_id]
    assert ids(status="failed") == [failed_id]
    assert set(ids(status=["queued", "failed"])) == {queued_id, failed_id}
    assert ids(error_code="EXPORT_FAILED") == [failed_id]
    assert ids(error_code="OTHER") == []
    assert ids(requester="leader") == [queued_id, done.id]
    future = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    assert ids(since=future) == []
    assert ids(until=future)[:3] == [failed_id, queued_id, done.id]
    page = env.lead.get(JOBS, params={"limit": 1, "offset": 1}).json()
    assert [job["id"] for job in page["jobs"]] == [queued_id]
    assert page["total"] == len(ids())


def test_jobs_of_another_project_are_not_listed(tmp_path) -> None:
    env = proposal_env(tmp_path)
    create_project(env.db, key="other")
    admin = logged_in(env.app, "root", system_admin=True, assignments=[])
    elsewhere = admin.post("/api/v1/projects/other/exports", json={"kind": "edit_log"})
    assert elsewhere.status_code == 200, elsewhere.text
    own = env.lead.post("/api/v1/projects/proj/exports", json={"kind": "edit_log"})
    listed = [job["id"] for job in env.lead.get(JOBS).json()["jobs"]]
    assert own.json()["job_id"] in listed
    assert elsewhere.json()["job_id"] not in listed
    other = [
        job["id"] for job in admin.get("/api/v1/projects/other/jobs").json()["jobs"]
    ]
    assert other == [elsewhere.json()["job_id"]]


def test_error_codes_of_other_failures(tmp_path) -> None:
    env = proposal_env(tmp_path)
    queue = env.app.state.jobs
    texts = {
        "Interrupted: the process running it stopped.": "JOB_INTERRUPTED",
        "KeyError (details in the server log)": "INTERNAL_ERROR",
        "AccessDenied: NOT_ALLOWED": "NOT_ALLOWED",
        "something else": None,
    }
    made = {}
    for text in texts:
        job_id = queue.enqueue(
            "edit_log_export",
            {"project": "proj"},
            project_id=env.pid,
            actor=Actor(None, "cli:x"),
        )
        with env.db.transaction() as conn:
            conn.execute(
                update(JobRow)
                .where(JobRow.id == job_id)
                .values(status="failed", error=text)
            )
        made[job_id] = texts[text]
    structured = queue.enqueue(
        "final_t1_export",
        {"project": "proj"},
        project_id=env.pid,
        actor=Actor(None, "cli:x"),
    )
    with env.db.transaction() as conn:
        conn.execute(
            update(JobRow)
            .where(JobRow.id == structured)
            .values(
                status="failed",
                error="StructuredJobError: [EXPORT_UNRESOLVED_INVALID] x",
                result={"error": {"code": "EXPORT_UNRESOLVED_INVALID", "details": {}}},
            )
        )
    made[structured] = "EXPORT_UNRESOLVED_INVALID"
    jobs = {job["id"]: job for job in env.lead.get(JOBS).json()["jobs"]}
    assert {job_id: jobs[job_id]["error_code"] for job_id in made} == made
