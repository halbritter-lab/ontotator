"""Practice projects (issue 266): creation, separation, deletion and expiry."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from auth_harness import add_ontology, ensure_user, grant, logged_in
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pg_harness import owner_engine
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from t1_fixtures import HP_PATH, bundle, create_project, run_import, unit
from test_auth_api import _app

from ontotator.application import practice_content as content
from ontotator.application.practice import LIFETIME, PracticeService
from ontotator.auth.audit import Actor
from ontotator.domain.errors import DomainError
from ontotator.storage import practice_store
from ontotator.storage.tables import AuditEventRow, ProjectRow

REAL = "real"
S = "ontotator"


@pytest.fixture
def app(tmp_path: Path) -> FastAPI:
    app = _app(tmp_path)
    add_ontology(app, HP_PATH)
    create_project(app.state.repo.db, REAL)
    return app


def _member(app: FastAPI, username: str, roles: list[str]) -> TestClient:
    ensure_user(app, username)
    assert grant(app, username, REAL, roles)
    return logged_in(app, username)


def _service(app: FastAPI, **kw: Any) -> PracticeService:
    state = app.state
    return PracticeService(
        state.repo.db,
        accounts=state.accounts,
        store_=state.ontology_store,
        registry=state.ontology_registry,
        jobs=state.jobs,
        preferences=state.preferences,
        **kw,
    )


def _project_rows(app: FastAPI, project_id: int) -> dict[str, int]:
    """Rows per table that carry this project id (audit events included)."""
    counts: dict[str, int] = {}
    with app.state.repo.db.transaction() as conn:
        tables = conn.execute(
            text(
                "SELECT c.relname FROM pg_attribute a JOIN pg_class c"
                " ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace"
                " WHERE n.nspname = :s AND c.relkind = 'r' AND a.attname = 'project_id'"
                " AND NOT a.attisdropped"
            ),
            {"s": S},
        ).scalars()
        for table in tables:
            count = conn.execute(
                text(f"SELECT count(*) FROM {S}.{table} WHERE project_id = :p"),
                {"p": project_id},
            ).scalar_one()
            if count:
                counts[table] = count
    return counts


def _pid(app: FastAPI, key: str) -> int:
    with app.state.repo.db.transaction() as conn:
        return int(
            conn.execute(
                select(ProjectRow.id).where(ProjectRow.project_key == key)
            ).scalar_one()
        )


def test_an_annotator_starts_a_practice_project_with_three_tasks(app: FastAPI) -> None:
    client = _member(app, "ann", ["annotator"])

    state = client.get("/api/v1/me/practice").json()
    assert state["show_card"] is True and state["available"] is True
    assert state["project"] is None

    started = client.post("/api/v1/me/practice")
    assert started.status_code == 200, started.text
    project = started.json()["project"]
    assert project["project_key"].startswith("practice-")
    assert project["name"] == "Practice · ann"
    assert [task["kind"] for task in project["tasks"]] == [
        "scratch",
        "proposals",
        "translation_review",
    ]
    assert (project["done"], project["total"]) == (0, 3)
    expires = datetime.fromisoformat(project["expires_at"])
    assert expires - datetime.fromisoformat(project["last_activity_at"]) == LIFETIME
    assert started.json()["show_card"] is False

    tasks = client.get("/api/v1/me/tasks").json()
    practice = [task for task in tasks if task["practice"]]
    assert len(practice) == 3
    assert {task["project_key"] for task in practice} == {project["project_key"]}
    # The from-proposals task has the three tool proposals.
    modes = {task["document_id"]: task["annotation_mode"] for task in practice}
    assert sorted(mode for mode in modes.values() if mode) == ["proposals", "scratch"]

    # Starting again keeps the one project.
    again = client.post("/api/v1/me/practice").json()["project"]
    assert again["project_key"] == project["project_key"]


def test_a_consolidator_also_gets_the_consolidation_task(app: FastAPI) -> None:
    client = _member(app, "cons", ["annotator", "adjudicator"])

    project = client.post("/api/v1/me/practice").json()["project"]

    kinds = [task["kind"] for task in project["tasks"]]
    assert kinds == ["scratch", "proposals", "translation_review", "consolidation"]
    tasks = client.get("/api/v1/me/tasks").json()
    review = [task for task in tasks if task["practice"] and task["task"] == "review"]
    assert len(review) == 1 and review[0]["active_round_id"]
    # The virtual colleagues are no people: not on the Users page.
    admin = logged_in(app, "root", system_admin=True)
    users = {user["username"] for user in admin.get("/api/v1/admin/users/").json()}
    assert not any(name.startswith("practice-colleague") for name in users)


def test_consolidation_decisions_name_their_terms(app: FastAPI) -> None:
    client = _member(app, "cons", ["annotator", "adjudicator"])
    project = client.post("/api/v1/me/practice").json()["project"]
    task = next(t for t in project["tasks"] if t["kind"] == "consolidation")
    opened = client.post(f"/api/v1/assignments/{task['assignment_id']}/open").json()
    workspace, revision = opened["workspace_id"], opened["view"]["draft"]["revision"]
    tasks = client.get("/api/v1/me/tasks").json()
    round_id = next(
        t["active_round_id"]
        for t in tasks
        if t["assignment_id"] == task["assignment_id"]
    )
    view = client.get(f"/api/v1/rounds/{round_id}/consolidation").json()
    groups = [group for group in view["groups"] if group["state"] == "open"]
    assert len(groups) == 2

    for group in groups:
        response = client.post(
            f"/api/v1/workspaces/{workspace}/consolidation-groups/resolve",
            json={
                "mutation_id": f"resolve-{group['group_id']}",
                "expected_revision": revision,
                "payload": {
                    "input_ids": [m["input_id"] for m in group["members"]],
                    "action": "leave_out",
                },
            },
        )
        assert response.status_code == 200, response.text
        revision = response.json()["revision"]

    facts = next(
        t
        for t in client.get("/api/v1/me/practice").json()["project"]["tasks"]
        if t["kind"] == "consolidation"
    )
    decided = {
        (d["term_id"], d["outcome"])
        for d in facts["decisions"]
        if d["action"] == "leave_out"
    }
    assert decided == {
        (content.HYPOTONIA, "rejected"),
        (content.AREFLEXIA, "rejected"),
    }


def test_an_unchanged_copy_is_not_an_own_finding(app: FastAPI) -> None:
    client = _member(app, "ann", ["annotator"])
    project = client.post("/api/v1/me/practice").json()["project"]
    task = next(t for t in project["tasks"] if t["kind"] == "proposals")
    opened = client.post(f"/api/v1/assignments/{task['assignment_id']}/open").json()
    target = opened["view"]["targets"]["targets"][0]
    start = content.PROPOSALS_TEXT.index("Muskeleigenreflexe fehlen")
    response = client.post(
        f"/api/v1/workspaces/{opened['workspace_id']}/commands",
        json={
            "mutation_id": "copy-1",
            "expected_revision": opened["view"]["draft"]["revision"],
            "payload": {
                "command": "create_annotation",
                "annotation_id": "copy-1",
                "evidence_id": "ev-copy-1",
                "term_id": content.AREFLEXIA,
                "layer_id": "hpo-layer",
                "type_id": "phenotype",
                "segments": [{"start": start, "end": start + 25}],
                "source_annotation_id": target["annotation_id"],
                "source_version": target["version"],
            },
        },
    )
    assert response.status_code == 200, response.text

    facts = next(
        t
        for t in client.get("/api/v1/me/practice").json()["project"]["tasks"]
        if t["kind"] == "proposals"
    )
    assert [f["replacement"] for f in facts["findings"]] == [True]


def test_practice_says_whether_the_profile_has_german(app: FastAPI) -> None:
    client = _member(app, "ann", ["annotator"])
    # No languages listed counts as not reading German.
    assert client.get("/api/v1/me/practice").json()["reads_german"] is False
    app.state.accounts.set_languages(Actor(None, "system:test"), "ann", ["en"])
    assert client.get("/api/v1/me/practice").json()["reads_german"] is False
    app.state.accounts.set_languages(Actor(None, "system:test"), "ann", ["en", "de"])
    assert client.get("/api/v1/me/practice").json()["reads_german"] is True
    # Languages are free codes: the three-letter forms of German count too.
    app.state.accounts.set_languages(Actor(None, "system:test"), "ann", ["deu"])
    assert client.get("/api/v1/me/practice").json()["reads_german"] is True


def test_practice_is_only_for_annotators(app: FastAPI) -> None:
    lead = _member(app, "lead", ["lead"])

    state = lead.get("/api/v1/me/practice").json()

    assert state["show_card"] is False and state["available"] is False
    assert state["unavailable_reason"] == "not_eligible"
    refused = lead.post("/api/v1/me/practice")
    assert refused.status_code == 409
    assert refused.json()["code"] == "PRACTICE_UNAVAILABLE"


def test_without_a_suitable_ontology_practice_explains_why(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = _member(app, "ann", ["annotator"])
    # A term the installed release lacks: no suitable ontology.
    monkeypatch.setattr(content, "TERMS", (*content.TERMS, "HP:9999999"))

    state = client.get("/api/v1/me/practice").json()

    assert state["show_card"] is True and state["available"] is False
    assert state["unavailable_reason"] == "no_ontology"
    assert "HPO release" in state["unavailable_message"]
    refused = client.post("/api/v1/me/practice")
    assert refused.status_code == 409
    assert refused.json()["details"]["reason"] == "no_ontology"


def test_the_admin_switch_hides_the_offer(app: FastAPI) -> None:
    client = _member(app, "ann", ["annotator"])
    admin = logged_in(app, "root", system_admin=True)

    assert admin.get("/api/v1/admin/settings/practice").json() == {"offer": True}
    changed = admin.put("/api/v1/admin/settings/practice", json={"offer": False})
    assert changed.json() == {"offer": False}

    state = client.get("/api/v1/me/practice").json()
    assert state["show_card"] is False and state["unavailable_reason"] == "offer_off"
    assert (
        client.put("/api/v1/admin/settings/practice", json={"offer": True}).status_code
        == 403
    )


def test_not_now_hides_the_card_for_good_and_profile_brings_it_back(
    app: FastAPI,
) -> None:
    client = _member(app, "ann", ["annotator"])

    hidden = client.put("/api/v1/me/practice/card", json={"show": False}).json()
    assert hidden["show_card"] is False and hidden["card_hidden"] is True
    assert client.get("/api/v1/me/practice").json()["show_card"] is False
    shown = client.put("/api/v1/me/practice/card", json={"show": True}).json()
    assert shown["show_card"] is True


def test_practice_projects_never_appear_in_real_listings(app: FastAPI) -> None:
    client = _member(app, "ann", ["annotator"])
    key = client.post("/api/v1/me/practice").json()["project"]["project_key"]
    admin = logged_in(app, "root", system_admin=True)

    for who in (client, admin):
        keys = {item["project_key"] for item in who.get("/api/v1/projects").json()}
        assert key not in keys
    assert REAL in {
        item["project_key"] for item in admin.get("/api/v1/projects").json()
    }
    # Admin rights do not reach a practice project.
    assert admin.get(f"/api/v1/projects/{key}/settings").status_code == 404
    assert admin.get(f"/api/v1/projects/{key}/progress").status_code == 404
    exported = admin.post(f"/api/v1/projects/{key}/exports", json={"kind": "t1"})
    assert exported.status_code == 404
    # The Users page names no practice project; the ontology inventory neither.
    users = admin.get("/api/v1/admin/users/").json()
    ann = next(user for user in users if user["username"] == "ann")
    assert [p["project_key"] for p in ann["projects"]] == [REAL]
    ontologies = admin.get("/api/v1/admin/ontologies/").json()
    assert all(key not in item["projects"] for item in ontologies)
    # The admin list shows it, with its owner.
    listed = admin.get("/api/v1/admin/practice-projects").json()
    assert [(item["project_key"], item["owner_username"]) for item in listed] == [
        (key, "ann")
    ]
    assert client.get("/api/v1/admin/practice-projects").status_code == 403


def test_practice_actions_are_audited_as_practice(app: FastAPI) -> None:
    client = _member(app, "ann", ["annotator"])
    key = client.post("/api/v1/me/practice").json()["project"]["project_key"]
    pid = _pid(app, key)

    with app.state.repo.db.transaction() as conn:
        events = conn.execute(
            select(AuditEventRow.action, AuditEventRow.details).where(
                AuditEventRow.project_id == pid
            )
        ).all()
    assert {"practice.start", "project.create", "assignment.create"} <= {
        action for action, _ in events
    }
    assert all(details.get("practice") is True for _, details in events)


def test_delete_removes_only_the_practice_project_and_keeps_its_audit(
    app: FastAPI,
) -> None:
    client = _member(app, "cons", ["annotator", "adjudicator"])
    key = client.post("/api/v1/me/practice").json()["project"]["project_key"]
    pid, real = _pid(app, key), _pid(app, REAL)
    real_before = _project_rows(app, real)
    assert _project_rows(app, pid)
    with app.state.repo.db.transaction() as conn:
        audit_before = (
            conn.execute(
                select(AuditEventRow.id).where(AuditEventRow.project_id == pid)
            )
            .scalars()
            .all()
        )

    state = client.delete("/api/v1/me/practice").json()

    assert state["project"] is None and state["available"] is True
    assert _project_rows(app, pid) == {}
    assert _project_rows(app, real) == real_before
    with app.state.repo.db.transaction() as conn:
        assert (
            conn.execute(select(ProjectRow.id).where(ProjectRow.id == pid)).first()
            is None
        )
        kept = (
            conn.execute(
                select(AuditEventRow.details).where(AuditEventRow.id.in_(audit_before))
            )
            .scalars()
            .all()
        )
        actions = (
            conn.execute(
                select(AuditEventRow.action).where(
                    AuditEventRow.details["practice_project_key"].as_string() == key
                )
            )
            .scalars()
            .all()
        )
    assert len(kept) == len(audit_before)
    assert all(item["practice"] is True for item in kept)
    assert "practice.delete" in actions


def test_reset_recreates_a_fresh_project(app: FastAPI) -> None:
    client = _member(app, "ann", ["annotator"])
    first = client.post("/api/v1/me/practice").json()["project"]["project_key"]

    second = client.post("/api/v1/me/practice/reset").json()["project"]

    assert second["project_key"] != first and second["done"] == 0
    with app.state.repo.db.transaction() as conn:
        assert (
            conn.execute(
                select(ProjectRow.id).where(ProjectRow.project_key == first)
            ).first()
            is None
        )


def test_delete_refuses_a_real_project(app: FastAPI) -> None:
    admin = logged_in(app, "root", system_admin=True)
    before = _project_rows(app, _pid(app, REAL))

    refused = admin.delete(f"/api/v1/admin/practice-projects/{REAL}")

    assert refused.status_code == 409
    assert refused.json()["code"] == "NOT_A_PRACTICE_PROJECT"
    with pytest.raises(DomainError) as caught, app.state.repo.db.transaction() as conn:
        practice_store.purge_practice_project(conn, Actor.cli(), REAL, reason="test")
    assert caught.value.code == "NOT_A_PRACTICE_PROJECT"
    assert _project_rows(app, _pid(app, REAL)) == before


def test_the_database_function_refuses_a_real_project_even_as_owner(
    app: FastAPI, tmp_path: Path
) -> None:
    # History rows of the real project: an import's proposal set.
    run_import(app.state.repo.db, bundle(tmp_path / "b.zip", [unit()]), REAL)
    real = _pid(app, REAL)
    before = _project_rows(app, real)
    assert before["proposal_sets"] == 1

    refused = pytest.raises(DBAPIError, match="not a practice project")
    with refused, app.state.repo.db.transaction() as conn:
        conn.execute(text(f"SELECT {S}.delete_practice_project(:p)"), {"p": real})
    owner = owner_engine(app.state.repo.db)
    with refused, owner.begin() as conn:
        conn.execute(text(f"SELECT {S}.delete_practice_project(:p)"), {"p": real})
    # The purge setting alone lets no history row of a real project go.
    with pytest.raises(DBAPIError, match="append-only"), owner.begin() as conn:
        conn.execute(
            text("SELECT set_config('ontotator.practice_purge', :p, true)"),
            {"p": str(real)},
        )
        conn.execute(
            text(f"DELETE FROM {S}.proposal_sets WHERE project_id = :p"),
            {"p": real},
        )
    assert _project_rows(app, real) == before


def test_practice_projects_expire_after_thirty_days_without_activity(
    app: FastAPI,
) -> None:
    client = _member(app, "ann", ["annotator"])
    key = client.post("/api/v1/me/practice").json()["project"]["project_key"]

    assert _service(app).expire() == []
    later = datetime.now(UTC) + LIFETIME + timedelta(days=1)
    assert _service(app, now=lambda: later).expire() == [key]
    assert client.get("/api/v1/me/practice").json()["project"] is None


def test_deactivating_an_account_deletes_its_practice_project(app: FastAPI) -> None:
    client = _member(app, "ann", ["annotator"])
    key = client.post("/api/v1/me/practice").json()["project"]["project_key"]

    app.state.accounts.set_active(Actor.cli(), "ann", False)

    with app.state.repo.db.transaction() as conn:
        assert (
            conn.execute(
                select(ProjectRow.id).where(ProjectRow.project_key == key)
            ).first()
            is None
        )


def test_the_steps_facts_follow_the_real_draft(app: FastAPI) -> None:
    client = _member(app, "ann", ["annotator"])
    project = client.post("/api/v1/me/practice").json()["project"]
    task = next(item for item in project["tasks"] if item["kind"] == "proposals")
    opened = client.post(f"/api/v1/assignments/{task['assignment_id']}/open").json()
    workspace, revision = opened["workspace_id"], opened["view"]["draft"]["revision"]
    targets = opened["view"]["targets"]["targets"]
    assert len(targets) == 3

    def post(path: str, payload: dict[str, Any]) -> None:
        nonlocal revision
        response = client.post(
            f"/api/v1/workspaces/{workspace}/{path}",
            json={
                "mutation_id": f"{path}-{revision}",
                "expected_revision": revision,
                "payload": payload,
            },
        )
        assert response.status_code == 200, response.text
        revision = response.json()["revision"]

    for target in targets:
        post(
            "decisions",
            {
                "target": {
                    "annotation_id": target["annotation_id"],
                    "version": target["version"],
                },
                "outcome": "confirmed",
            },
        )
    start = content.PROPOSALS_TEXT.index("Muskeleigenreflexe fehlen")
    post(
        "commands",
        {
            "command": "create_annotation",
            "annotation_id": "own-1",
            "evidence_id": "ev-own-1",
            "term_id": content.AREFLEXIA,
            "layer_id": "hpo-layer",
            "type_id": "phenotype",
            "segments": [{"start": start, "end": start + 25}],
            "axes_values": {"assertion": "present"},
            "chosen_axis_ids": ["assertion"],
        },
    )

    facts = next(
        item
        for item in client.get("/api/v1/me/practice").json()["project"]["tasks"]
        if item["kind"] == "proposals"
    )
    assert {(d["term_id"], d["outcome"]) for d in facts["decisions"]} == {
        (content.SEIZURE, "confirmed"),
        (content.HYPOTONIA, "confirmed"),
        (content.HEARING_IMPAIRMENT, "confirmed"),
    }
    assert [(f["term_id"], f["replacement"]) for f in facts["findings"]] == [
        (content.AREFLEXIA, False)
    ]


def test_the_app_role_cannot_turn_a_real_project_into_practice(
    app: FastAPI, tmp_path: Path
) -> None:
    run_import(app.state.repo.db, bundle(tmp_path / "b.zip", [unit()]), REAL)
    real = _pid(app, REAL)
    before = _project_rows(app, real)

    db = app.state.repo.db
    with pytest.raises(DBAPIError, match="cannot change"), db.transaction() as conn:
        conn.execute(
            text(f"UPDATE {S}.projects SET practice = true WHERE id = :p"),
            {"p": real},
        )
    with (
        pytest.raises(DBAPIError, match="not a practice project"),
        db.transaction() as conn,
    ):
        conn.execute(text(f"SELECT {S}.delete_practice_project(:p)"), {"p": real})
    assert _project_rows(app, real) == before
