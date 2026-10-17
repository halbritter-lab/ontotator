"""Standalone search/tree provenance uses the same current authority as edits."""

from concurrent.futures import ThreadPoolExecutor
from threading import Event
from types import SimpleNamespace

import pytest
from auth_harness import HARNESS
from sqlalchemy import event as sql_event
from sqlalchemy import func, select
from test_admin_write_authority import _wait_for_database_lock
from test_visibility import PROJECT, _envelope, _open
from test_visibility import assigned as assigned

from ontocurator.api.routes import decode_workspace_id
from ontocurator.assignments.service import AssignmentService
from ontocurator.authz.scoped import ScopedRepository
from ontocurator.domain.errors import DomainError
from ontocurator.packages.models import SearchEventRecord
from ontocurator.storage.repository import Repository
from ontocurator.storage.tables import EditEventRow, MutationReceiptRow


def _context(assigned, operation):
    app, client, assignment = assigned
    key = decode_workspace_id(_open(client, assignment)["workspace_id"])
    user = app.state.accounts.get_by_username("alice")
    access = app.state.memberships.access_for(
        SimpleNamespace(
            user_id=user.id,
            pseudonym=user.pseudonym,
            is_system_admin=user.is_system_admin,
        )
    )
    repo = ScopedRepository(app.state.repo.db, access)
    walk = SearchEventRecord(
        event_id="standalone-walk",
        workspace_key=key,
        annotation_id="a",
        layer_id="hpo-layer",
        query="HP:0001250",
        route="browse",
        candidates=["HP:0001250"],
        ranked_ids=["HP:0001250"],
        ontology_release="2026-06-23",
        index_identity="i",
        timestamp="2026-10-15T00:00:00Z",
    )
    if operation == "append":
        app.state.repo.save_search_event(walk)

    def write():
        if operation == "save":
            return repo.save_search_event(walk)
        return repo.append_search_event_candidates(
            walk.event_id,
            ["HP:0004322"],
            workspace_key=key,
            annotation_id=walk.annotation_id,
            layer_id=walk.layer_id,
        )

    return app, repo, assignment, walk, write


def _revoke(app, assignment, kind):
    if kind == "assignment":
        return AssignmentService(app.state.repo.db).revoke(HARNESS, assignment.id)
    return app.state.memberships.set_roles(
        HARNESS, PROJECT, "alice", [], revoke_assignments=True
    )


@pytest.mark.parametrize("operation", ["save", "append"])
@pytest.mark.parametrize("revocation", ["assignment", "membership"])
def test_standalone_provenance_rechecks_revocation_after_early_visibility(
    assigned, monkeypatch, operation, revocation
):
    app, _repo, assignment, walk, write = _context(assigned, operation)
    checked, release = Event(), Event()
    original = ScopedRepository._document

    def pause_after_early_check(self, project_key, document_id):
        original(self, project_key, document_id)
        checked.set()
        assert release.wait(10)

    monkeypatch.setattr(ScopedRepository, "_document", pause_after_early_check)
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(write)
        try:
            assert checked.wait(10)
            _revoke(app, assignment, revocation)
        finally:
            release.set()
        with pytest.raises(DomainError, match="DOCUMENT_NOT_FOUND"):
            pending.result(timeout=10)
    stored = app.state.repo.get_search_event(walk.event_id, PROJECT)
    assert stored is None if operation == "save" else stored == walk
    with app.state.repo.db.transaction() as conn:
        assert (
            conn.execute(select(func.count()).select_from(EditEventRow)).scalar_one()
            == 0
        )
        assert (
            conn.execute(
                select(func.count()).select_from(MutationReceiptRow)
            ).scalar_one()
            == 0
        )


@pytest.mark.parametrize("operation", ["save", "append"])
@pytest.mark.parametrize("revocation", ["assignment", "membership"])
def test_standalone_provenance_holds_authority_until_storage_commits(
    assigned, monkeypatch, operation, revocation
):
    app, _repo, assignment, walk, write = _context(assigned, operation)
    stored, release = Event(), Event()
    method = (
        "save_search_event" if operation == "save" else "append_search_event_candidates"
    )
    original = getattr(Repository, method)

    def pause_after_storage(self, *args, **kwargs):
        result = original(self, *args, **kwargs)
        stored.set()
        assert release.wait(15)
        return result

    monkeypatch.setattr(Repository, method, pause_after_storage)
    with ThreadPoolExecutor(max_workers=2) as pool:
        pending = pool.submit(write)
        try:
            assert stored.wait(10)
            revoked = pool.submit(_revoke, app, assignment, revocation)
            _wait_for_database_lock(app, revoked)
            assert not revoked.done()
        finally:
            release.set()
        pending.result(timeout=10)
        revoked.result(timeout=10)
    persisted = app.state.repo.get_search_event(walk.event_id, PROJECT)
    assert persisted is not None
    assert persisted.candidates == (
        ["HP:0001250"] if operation == "save" else ["HP:0001250", "HP:0004322"]
    )
    assert AssignmentService(app.state.repo.db).list(PROJECT, user="alice") == []


def test_provenance_on_submitted_work_stays_read_only_without_status_events(assigned):
    app, client, assignment = assigned
    opened = _open(client, assignment)
    token = opened["workspace_id"]
    assert (
        client.post(
            f"/api/v1/workspaces/{token}/commands", json=_envelope()
        ).status_code
        == 200
    )
    submitted = client.post(
        f"/api/v1/workspaces/{token}/submit",
        json={
            "mutation_id": "submit",
            "expected_revision": 1,
            "payload": {"document_checked": True, "command": "submit_workspace"},
        },
    )
    assert submitted.status_code == 200, submitted.text
    before = AssignmentService(app.state.repo.db).list(PROJECT, user="alice")[0]
    _app, repo, _assignment, walk, write = _context(assigned, "save")
    write()
    grown = repo.append_search_event_candidates(
        walk.event_id,
        ["HP:0004322"],
        workspace_key=walk.workspace_key,
        annotation_id=walk.annotation_id,
        layer_id=walk.layer_id,
    )
    assert grown is not None
    assert grown.candidates == ["HP:0001250", "HP:0004322"]
    assert AssignmentService(app.state.repo.db).list(PROJECT, user="alice")[0] == before
    with app.state.repo.db.transaction() as conn:
        assert (
            conn.execute(select(func.count()).select_from(EditEventRow)).scalar_one()
            == 2
        )
        assert (
            conn.execute(
                select(func.count()).select_from(MutationReceiptRow)
            ).scalar_one()
            == 2
        )


def test_visible_workspace_key_cannot_authorize_unrelated_event(assigned):
    app, repo, _assignment, walk, _write = _context(assigned, "append")
    hidden = walk.model_copy(
        update={
            "event_id": "hidden-walk",
            "workspace_key": walk.workspace_key.model_copy(
                update={"document_id": "doc-alpha"}
            ),
        }
    )
    app.state.repo.save_search_event(hidden)
    statements = []

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    sql_event.listen(app.state.repo.db.engine, "before_cursor_execute", record)
    try:
        assert (
            repo.append_search_event_candidates(
                hidden.event_id, ["HP:0004322"], workspace_key=walk.workspace_key
            )
            is None
        )
    finally:
        sql_event.remove(app.state.repo.db.engine, "before_cursor_execute", record)
    assert not any(
        "search_events" in statement and "FOR UPDATE" in statement
        for statement in statements
    )
    assert app.state.repo.get_search_event(hidden.event_id, PROJECT) == hidden
    foreign = walk.model_copy(
        update={
            "event_id": "foreign-walk",
            "workspace_key": walk.workspace_key.model_copy(
                update={"annotator_id": "someone-else"}
            ),
        }
    )
    with pytest.raises(DomainError, match="IDENTITY_MISMATCH"):
        repo.save_search_event(foreign)
    assert app.state.repo.get_search_event(foreign.event_id, PROJECT) is None
