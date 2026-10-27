"""Authenticated administration stays authorized across serialization waits."""

from concurrent.futures import ThreadPoolExecutor
from threading import Event, get_ident

import pytest
from auth_harness import logged_in
from sqlalchemy import event, func, select
from test_auth_api import _app
from test_projects_api import create_project

from ontotator.auth.audit import Actor
from ontotator.storage.repository import _lock_id
from ontotator.storage.tables import AuditEventRow, ProjectMembershipRow


@pytest.mark.parametrize("route", ["members", "settings", "pins", "profile"])
@pytest.mark.parametrize("revocation", ["removed", "demoted", "deactivated"])
def test_queued_http_manager_must_still_be_authorized(tmp_path, route, revocation):
    app = _app(tmp_path)
    root = logged_in(app, "root", system_admin=True)
    project = create_project(app, root)
    manager = logged_in(
        app,
        "manager",
        system_admin=revocation == "demoted",
        projects={} if revocation == "demoted" else {"phenotypes": ["lead"]},
    )
    actor = app.state.accounts.get_by_username("manager")
    db = app.state.repo.db
    waiting = Event()
    owner_thread = get_ident()

    def waiting_for_lock(conn, cursor, statement, parameters, context, executemany):
        if get_ident() != owner_thread and "pg_advisory_xact_lock" in statement:
            waiting.set()

    def request():
        prefix = "/api/v1/projects/phenotypes/"
        if route == "members":
            return manager.put(
                prefix + "members/manager", json={"roles": ["lead", "annotator"]}
            )
        if route == "settings":
            return manager.patch(
                prefix + "settings", json={"name": "Unauthorized change"}
            )
        if route == "profile":
            return manager.put(
                prefix + "profile",
                json=project["profile"] | {"version": "unauthorized"},
            )
        return manager.put(
            prefix + "pins",
            json=[
                {key: value for key, value in pin.items() if key != "release"}
                | {"allowed_roots": ["HP:0000118"]}
                for pin in project["pins"]
            ],
        )

    with db.transaction() as conn:
        before = conn.execute(
            select(func.count()).select_from(AuditEventRow)
        ).scalar_one()
    event.listen(db.engine, "before_cursor_execute", waiting_for_lock)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            with db.transaction() as conn:
                conn.execute(
                    select(
                        func.pg_advisory_xact_lock(_lock_id("members", "phenotypes"))
                    )
                )
                conn.execute(
                    select(
                        func.pg_advisory_xact_lock(_lock_id("project", "phenotypes"))
                    )
                )
                future = pool.submit(request)
                assert waiting.wait(10), (
                    "The authenticated request did not reach its serialization lock"
                )
                if revocation == "removed":
                    app.state.memberships.set_roles(
                        Actor.cli(), "phenotypes", "manager", []
                    )
                elif revocation == "demoted":
                    app.state.accounts.set_system_admin(Actor.cli(), "manager", False)
                else:
                    app.state.accounts.set_active(Actor.cli(), "manager", False)
                after_revocation = conn.execute(
                    select(func.count()).select_from(AuditEventRow)
                ).scalar_one()
                assert after_revocation == before + 1
            response = future.result(timeout=15)
    finally:
        event.remove(db.engine, "before_cursor_execute", waiting_for_lock)
    assert response.status_code in {401, 403, 404}, response.text
    with db.transaction() as conn:
        assert (
            conn.execute(select(func.count()).select_from(AuditEventRow)).scalar_one()
            == after_revocation
        )
        roles = set(
            conn.execute(
                select(ProjectMembershipRow.role).where(
                    ProjectMembershipRow.user_id == actor.id
                )
            ).scalars()
        )
    assert roles == (set() if revocation in {"removed", "demoted"} else {"lead"})
    assert (
        app.state.repo.get_task_profile("phenotypes").version
        == project["profile"]["version"]
    )
    assert (
        root.get("/api/v1/projects/phenotypes/settings").json()["name"]
        == project["name"]
    )
    assert (
        root.get("/api/v1/projects/phenotypes/settings").json()["pins"]
        == project["pins"]
    )


def test_member_list_remains_coherent_when_removal_commits_between_reads(
    tmp_path, monkeypatch
):
    from ontotator.api import project_routes

    app = _app(tmp_path)
    root = logged_in(app, "root", system_admin=True)
    create_project(app, root)
    logged_in(app, "alice", projects={"phenotypes": ["annotator"]})
    db = app.state.repo.db
    guarded, selected, resume = Event(), Event(), Event()
    owner_thread = get_ident()
    real_guard = project_routes._guard

    def guard(*args, **kwargs):
        real_guard(*args, **kwargs)
        guarded.set()

    def pause_after_member_selection(
        conn, cursor, statement, parameters, context, executemany
    ):
        if (
            get_ident() != owner_thread
            and guarded.is_set()
            and "project_memberships" in statement
            and statement.lstrip().startswith("SELECT")
            and not selected.is_set()
        ):
            selected.set()
            assert resume.wait(10)

    monkeypatch.setattr(project_routes, "_guard", guard)
    event.listen(db.engine, "after_cursor_execute", pause_after_member_selection)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(root.get, "/api/v1/projects/phenotypes/members")
            try:
                assert selected.wait(10)
                app.state.memberships.set_roles(Actor.cli(), "phenotypes", "alice", [])
            finally:
                resume.set()
            response = future.result(timeout=15)
    finally:
        event.remove(db.engine, "after_cursor_execute", pause_after_member_selection)
    assert response.status_code == 200, response.text
    alice = next(member for member in response.json() if member["username"] == "alice")
    assert alice["roles"] == ["annotator"]
    assert all(member["roles"] for member in response.json())
