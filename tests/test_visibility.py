"""Actual API visibility, assignment status and transactional replay contracts."""

from pathlib import Path

import pytest
from auth_harness import HARNESS, ensure_assignment, logged_in
from layered_fixtures import make_layered_package
from pg_harness import database_url_for
from sqlalchemy import func, select

from ontocurator.api.app import create_app
from ontocurator.assignments.service import AssignmentService
from ontocurator.config import AppConfig
from ontocurator.domain.errors import DomainError
from ontocurator.storage.tables import (
    EditEventRow,
    MutationReceiptRow,
    ProjectRow,
)

PROJECT = "pkg-scenario-a"


@pytest.fixture
def assigned(tmp_path: Path):
    app = create_app(
        AppConfig(
            workspace_dir=tmp_path,
            database_url=database_url_for(tmp_path / "visibility.db"),
            ontology_paths=[Path(__file__).parent / "fixtures/hp.json"],
        )
    )
    app.state.repo.import_package(make_layered_package("single"))
    alice = logged_in(
        app,
        "alice",
        pseudonym="alice",
        projects={PROJECT: ["annotator", "adjudicator"]},
        assignments=[],
    )
    ensure_assignment(app, "alice", PROJECT, "doc-beta", "annotate")
    row = AssignmentService(app.state.repo.db).list(PROJECT, user="alice")[0]
    return app, alice, row


def _open(client, assignment):
    response = client.post(f"/api/v1/assignments/{assignment.id}/open")
    assert response.status_code == 200, response.text
    return response.json()


def _envelope(revision=0, mutation="edit"):
    return {
        "mutation_id": mutation,
        "expected_revision": revision,
        "payload": {
            "command": "check_layer",
            "layer_id": "hpo-layer",
            "checked": True,
        },
    }


def test_annotator_lists_only_assigned_documents_and_distinct_count(assigned):
    _app, client, row = assigned
    assert [
        doc["document_id"]
        for doc in client.get(f"/api/v1/projects/{PROJECT}/documents").json()
    ] == ["doc-beta"]
    response = client.get("/api/v1/projects")
    assert response.status_code == 200, response.text
    assert response.json()[0]["document_count"] == 1
    tasks = client.get("/api/v1/me/tasks").json()
    assert [task["assignment_id"] for task in tasks] == [row.id]


@pytest.mark.parametrize("route", ["open", "review-inputs", "commands", "tree"])
def test_unassigned_document_is_404_on_routes(assigned, route):
    _app, client, _row = assigned
    key = {
        "project_key": PROJECT,
        "document_id": "doc-alpha",
        "annotator_id": "alice",
        "mode": "independent",
    }
    if route == "open":
        response = client.post("/api/v1/workspaces/open", json=key)
    elif route == "review-inputs":
        # Same central repository helper is used by the review-input service;
        # the mode gate correctly denies a non-reviewer before inputs.
        response = client.post(
            "/api/v1/workspaces/review-inputs",
            json={"project_key": PROJECT, "document_id": "doc-alpha", "mode": "review"},
        )
    elif route == "commands":
        from ontocurator.api.routes import encode_workspace_id
        from ontocurator.domain.workspace import WorkspaceKey

        response = client.post(
            f"/api/v1/workspaces/{encode_workspace_id(WorkspaceKey(**key, target_set_id='targets-0'))}/commands",
            json=_envelope(),
        )
    else:
        response = client.post(
            "/api/v1/terms/tree/open",
            json={
                "workspace_key": {**key, "target_set_id": "targets-0"},
                "annotation_id": "new",
                "layer_id": "hpo-layer",
                "term_id": "HP:0001250",
            },
        )
    assert response.status_code == 404, response.text
    assert response.json()["code"] == "DOCUMENT_NOT_FOUND"


def test_status_submission_retry_and_reopen_preserve_history(assigned):
    app, client, row = assigned
    opened = _open(client, row)
    assert opened["view"]["key"]["annotator_id"] == "alice"
    assert opened["view"]["key"]["mode"] == "independent"
    assert opened["read_only"] is False
    token = opened["workspace_id"]
    response = client.post(f"/api/v1/workspaces/{token}/commands", json=_envelope())
    assert response.status_code == 200, response.text
    service = AssignmentService(app.state.repo.db)
    assert service.list(PROJECT, user="alice")[0].status == "in_progress"
    envelope = {
        "mutation_id": "submit",
        "expected_revision": 1,
        "payload": {"document_checked": True, "command": "submit_workspace"},
    }
    submitted = client.post(f"/api/v1/workspaces/{token}/submit", json=envelope)
    assert submitted.status_code == 200, submitted.text
    assert (
        service.list(PROJECT, user="alice")[0].last_submission_id
        == submitted.json()["submission_id"]
    )
    assert _open(client, row)["read_only"] is True
    replay = client.post(f"/api/v1/workspaces/{token}/submit", json=envelope)
    assert replay.status_code == 200, replay.text
    assert replay.json() == submitted.json()
    denied = client.post(
        f"/api/v1/workspaces/{token}/commands", json=_envelope(2, "locked")
    )
    assert denied.status_code == 409, denied.text
    assert denied.json()["code"] == "ASSIGNMENT_SUBMITTED"
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
    service.reopen(HARNESS, row.id)
    again = client.post(
        f"/api/v1/workspaces/{token}/submit",
        json={**envelope, "mutation_id": "submit-again", "expected_revision": 2},
    )
    assert again.status_code == 200, again.text
    assert again.json()["submission_id"] != submitted.json()["submission_id"]
    assert (
        app.state.repo.get_submission(
            submitted.json()["submission_id"], PROJECT
        ).model_dump(mode="json")
        == submitted.json()
    )


def test_revoke_hides_document_and_denies_receipt_replay(assigned):
    app, client, row = assigned
    opened = _open(client, row)
    token = opened["workspace_id"]
    assert (
        client.post(
            f"/api/v1/workspaces/{token}/commands", json=_envelope()
        ).status_code
        == 200
    )
    AssignmentService(app.state.repo.db).revoke(HARNESS, row.id)
    assert client.get(f"/api/v1/projects/{PROJECT}/documents").json() == []
    assert client.get("/api/v1/me/tasks").json() == []
    assert (
        client.post(
            f"/api/v1/workspaces/{token}/commands", json=_envelope()
        ).status_code
        == 404
    )
    assert client.post(f"/api/v1/assignments/{row.id}/open").status_code == 404


def test_lead_task_role_still_needs_assignment(assigned):
    app, _client, _row = assigned
    lead = logged_in(
        app, "lead", projects={PROJECT: ["lead", "annotator"]}, assignments=[]
    )
    response = lead.post(
        "/api/v1/workspaces/open",
        json={
            "project_key": PROJECT,
            "document_id": "doc-alpha",
            "mode": "independent",
        },
    )
    assert response.status_code == 403, response.text
    assert response.json()["code"] == "ASSIGNMENT_REQUIRED"
    assert len(lead.get(f"/api/v1/projects/{PROJECT}/documents").json()) == 2


def test_failed_command_has_no_status_event_or_receipt(assigned):
    app, client, row = assigned
    token = _open(client, row)["workspace_id"]
    invalid = _envelope()
    invalid["payload"]["layer_id"] = "missing"
    assert (
        client.post(f"/api/v1/workspaces/{token}/commands", json=invalid).status_code
        == 422
    )
    assert (
        AssignmentService(app.state.repo.db).list(PROJECT, user="alice")[0].status
        == "open"
    )
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


def test_revocation_commits_before_waiting_command_is_revalidated(
    assigned, monkeypatch
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    app, client, row = assigned
    token = _open(client, row)["workspace_id"]
    entered, release = Event(), Event()
    original = AssignmentService._locked

    def paused(conn, assignment_id):
        result = original(conn, assignment_id)
        entered.set()
        assert release.wait(10)
        return result

    monkeypatch.setattr(AssignmentService, "_locked", staticmethod(paused))
    with ThreadPoolExecutor(max_workers=2) as pool:
        revoke = pool.submit(
            AssignmentService(app.state.repo.db).revoke, HARNESS, row.id
        )
        assert entered.wait(10)
        command = pool.submit(
            client.post, f"/api/v1/workspaces/{token}/commands", json=_envelope()
        )
        assert not command.done()
        release.set()
        revoke.result(timeout=10)
        response = command.result(timeout=10)
    assert response.status_code == 404, response.text
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


def test_membership_removal_before_waiting_command_is_revalidated(
    assigned, monkeypatch
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from sqlalchemy import event

    from ontocurator.authz.memberships import MembershipService
    from ontocurator.storage.repository import _lock_id

    app, client, row = assigned
    token = _open(client, row)["workspace_id"]
    held, release, waiting = Event(), Event(), Event()
    original = MembershipService._roles

    def paused(conn, project_id, user_id):
        roles = original(conn, project_id, user_id)
        held.set()
        assert release.wait(10)
        return roles

    def at_lock(conn, cursor, statement, parameters, context, executemany):
        values = parameters.values() if isinstance(parameters, dict) else parameters
        if (
            "pg_advisory_xact_lock_shared" in statement
            and _lock_id("members", PROJECT) in values
        ):
            waiting.set()

    monkeypatch.setattr(MembershipService, "_roles", staticmethod(paused))
    event.listen(app.state.repo.db.engine, "before_cursor_execute", at_lock)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            removal = pool.submit(
                app.state.memberships.set_roles,
                HARNESS,
                PROJECT,
                "alice",
                [],
                revoke_assignments=True,
            )
            assert held.wait(10)
            command = pool.submit(
                client.post, f"/api/v1/workspaces/{token}/commands", json=_envelope()
            )
            try:
                assert waiting.wait(10)
                assert not command.done()
            finally:
                release.set()
            removal.result(timeout=10)
            response = command.result(timeout=10)
    finally:
        release.set()
        event.remove(app.state.repo.db.engine, "before_cursor_execute", at_lock)
    assert response.status_code == 404, response.text
    assert AssignmentService(app.state.repo.db).my_tasks(row.user_id) == []
    with app.state.repo.db.transaction() as conn:
        assert (
            conn.execute(select(func.count()).select_from(EditEventRow)).scalar_one()
            == 0
        )


def test_independent_drafts_mutate_concurrently(assigned):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    from types import SimpleNamespace

    from ontocurator.api.routes import decode_workspace_id
    from ontocurator.authz.scoped import ScopedRepository
    from ontocurator.domain.workspace import MutationEnvelope

    app, client, _row = assigned
    ensure_assignment(app, "alice", PROJECT, "doc-alpha", "annotate")
    rows = AssignmentService(app.state.repo.db).list(PROJECT, user="alice")
    keys = [
        decode_workspace_id(_open(client, assignment)["workspace_id"])
        for assignment in rows
    ]
    user = app.state.accounts.get_by_username("alice")
    access = app.state.memberships.access_for(
        SimpleNamespace(
            user_id=user.id,
            pseudonym=user.pseudonym,
            is_system_admin=user.is_system_admin,
        )
    )
    repo = ScopedRepository(app.state.repo.db, access)
    entered, release = Event(), Event()

    def slow(draft):
        entered.set()
        assert release.wait(10)
        return draft

    envelope = MutationEnvelope(mutation_id="parallel", expected_revision=0, payload={})
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(repo.run_mutation, keys[0], envelope, slow)
        assert entered.wait(10)
        second = pool.submit(repo.run_mutation, keys[1], envelope, lambda draft: draft)
        try:
            assert second.result(timeout=5).revision == 1
        finally:
            release.set()
        assert first.result(timeout=10).revision == 1


def test_current_task_roles_control_visibility_counts_and_retained_submitted_metadata(
    assigned,
):
    from sqlalchemy import delete, update

    from ontocurator.storage.tables import AssignmentRow, ProjectMembershipRow

    app, client, row = assigned
    # Two tasks for one document still count as one document.
    ensure_assignment(app, "alice", PROJECT, "doc-beta", "review")
    assert client.get("/api/v1/projects").json()[0]["document_count"] == 1
    with app.state.repo.db.transaction() as conn:
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.user_id == row.user_id)
            .values(status="submitted")
        )
        conn.execute(
            delete(ProjectMembershipRow).where(
                ProjectMembershipRow.user_id == row.user_id
            )
        )
    assert client.get("/api/v1/me/tasks").json() == []
    assert client.get("/api/v1/projects").json() == []
    assert client.post(f"/api/v1/assignments/{row.id}/open").status_code == 404


def test_document_method_enumeration_uses_central_guard(assigned, monkeypatch):
    import inspect
    from types import SimpleNamespace

    from sqlalchemy import insert

    import ontocurator.authz.scoped as scoped_module
    import ontocurator.authz.versions as versions_module
    from ontocurator.api.routes import decode_workspace_id
    from ontocurator.domain.annotations import AnnotationRef
    from ontocurator.domain.reanchor_resolution import PendingReanchorRef
    from ontocurator.domain.review import ReviewTargetSet
    from ontocurator.domain.workspace import Draft, MutationEnvelope
    from ontocurator.packages.models import SearchEventRecord
    from ontocurator.storage.repository import Repository
    from ontocurator.storage.tables import ProposalSetRow, StoredFileRow

    app, client, previous = assigned
    service = AssignmentService(app.state.repo.db)
    row = service.assign(
        HARNESS, PROJECT, "doc-alpha", "alice", "annotate", confirm_language=True
    )
    service.revoke(HARNESS, previous.id)
    opened = _open(client, row)
    key = decode_workspace_id(opened["workspace_id"])
    from ontocurator.domain.annotations import AnnotationSnapshot

    created = client.post(
        f"/api/v1/workspaces/{opened['workspace_id']}/commands",
        json={
            "mutation_id": "fixture-annotation",
            "expected_revision": 0,
            "payload": {
                "command": "create_annotation",
                "annotation_id": "owned",
                "term_id": "HP:0001250",
                "axes_values": {
                    "assertion": "present",
                    "experiencer": "patient",
                    "temporality": "current",
                },
                "chosen_axis_ids": ["assertion", "experiencer", "temporality"],
                "layer_id": "hpo-layer",
                "evidence_id": "owned-evidence",
                "segments": [{"start": 0, "end": 5}],
            },
        },
    )
    assert created.status_code == 200, created.text
    snap = AnnotationSnapshot.model_validate(created.json()["annotations"][0])
    evidence = snap.annotation.evidence_refs[0]
    event = SearchEventRecord(
        event_id="visibility-event",
        workspace_key=key,
        annotation_id="a",
        query="q",
        route="lexical",
        candidates=[],
        ontology_release="2026-06-23",
        index_identity="i",
        timestamp="2026-10-15T00:00:00Z",
    )
    app.state.repo.save_search_event(event)
    assert (
        client.post(
            f"/api/v1/workspaces/{opened['workspace_id']}/commands", json=_envelope(1)
        ).status_code
        == 200
    )
    submitted_response = client.post(
        f"/api/v1/workspaces/{opened['workspace_id']}/submit",
        json={
            "mutation_id": "submit-for-visibility",
            "expected_revision": 2,
            "payload": {"document_checked": True, "command": "submit_workspace"},
        },
    )
    assert submitted_response.status_code == 200, submitted_response.text
    submission = submitted_response.json()
    with app.state.repo.db.transaction() as conn:
        project_id = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == PROJECT)
        ).scalar_one()
        source_sha = app.state.repo.db.blobs.put(b"{}")
        conn.execute(insert(StoredFileRow).values(sha256=source_sha, size=2))
        set_id = conn.execute(
            insert(ProposalSetRow)
            .values(
                project_id=project_id,
                document_id="doc-alpha",
                bundle_id="visibility",
                annotation_set_id="set",
                set_kind="predictions",
                actors=[],
                payload={},
                source_sha256=source_sha,
            )
            .returning(ProposalSetRow.id)
        ).scalar_one()
    AssignmentService(app.state.repo.db).revoke(HARNESS, row.id)
    user = app.state.accounts.get_by_username("alice")
    repo = scoped_module.ScopedRepository(
        app.state.repo.db,
        app.state.memberships.access_for(
            SimpleNamespace(
                user_id=user.id, pseudonym=user.pseudonym, is_system_admin=False
            )
        ),
    )
    calls = {
        "get_document": lambda: repo.get_document(PROJECT, "doc-alpha"),
        "get_variant": lambda: repo.get_variant(PROJECT, "doc-alpha"),
        "get_variant_text": lambda: repo.get_variant_text(PROJECT, "doc-alpha"),
        "get_annotation_version": lambda: repo.get_annotation_version(
            PROJECT, "doc-alpha", "own", submission["submission_id"]
        ),
        "get_reanchor_items": lambda: repo.get_reanchor_items(PROJECT, "doc-alpha"),
        "list_annotations_for_document": lambda: repo.list_annotations_for_document(
            PROJECT, "doc-alpha"
        ),
        "proposal_metadata": lambda: repo.proposal_metadata(PROJECT, "doc-alpha"),
        "workspace_proposal_sets": lambda: repo.workspace_proposal_sets(key, []),
        "workspace_input_snapshots": lambda: repo.workspace_input_snapshots(key),
        "workspace_reanchor_items": lambda: repo.workspace_reanchor_items(
            Draft(key=key, targets=ReviewTargetSet.create([]), revision=0)
        ),
        "verified_reanchor_source": lambda: repo.verified_reanchor_source(
            key,
            PendingReanchorRef(
                proposal_set_id=set_id,
                source_ref=AnnotationRef(
                    annotation_id=snap.annotation.annotation_id, version=snap.version
                ),
            ),
        ),
        "reanchor_source_identity": lambda: repo.reanchor_source_identity(
            key,
            PendingReanchorRef(
                proposal_set_id=set_id,
                source_ref=AnnotationRef(
                    annotation_id=snap.annotation.annotation_id, version=snap.version
                ),
            ),
        ),
        "get_proposal_set": lambda: repo.get_proposal_set(PROJECT, set_id),
        "get_annotation_snapshot": lambda: repo.get_annotation_snapshot(
            snap.annotation.annotation_id, snap.version, PROJECT
        ),
        "get_evidence_snapshot": lambda: repo.get_evidence_snapshot(
            evidence.evidence_id, evidence.version, PROJECT
        ),
        "open_draft": lambda: repo.open_draft(key),
        "draft_annotation_layer": lambda: repo.draft_annotation_layer(key, "owned"),
        "run_mutation": lambda: repo.run_mutation(
            key,
            MutationEnvelope(mutation_id="forbidden", expected_revision=2, payload={}),
            lambda draft: draft,
        ),
        "get_document_status": lambda: repo.get_document_status(
            PROJECT, "doc-alpha", "alice", "independent"
        ),
        "get_submissions_for_workspace": lambda: repo.get_submissions_for_workspace(
            key
        ),
        "get_submissions_for_document": lambda: repo.get_submissions_for_document(
            PROJECT, "doc-alpha"
        ),
        "get_submission": lambda: repo.get_submission(
            submission["submission_id"], PROJECT
        ),
        "save_search_event": lambda: repo.save_search_event(
            event.model_copy(update={"event_id": "hidden"})
        ),
        "get_search_event": lambda: repo.get_search_event("visibility-event", PROJECT),
        "append_search_event_candidates": lambda: repo.append_search_event_candidates(
            "visibility-event", [], workspace_key=key
        ),
        "get_search_events_for_workspace": lambda: repo.get_search_events_for_workspace(
            key
        ),
        "edit_events": lambda: repo.edit_events(key),
        "draft_state_at": lambda: repo.draft_state_at(key, 1),
    }
    expected = {
        name
        for name, method in inspect.getmembers(Repository, inspect.isfunction)
        if not name.startswith("_")
        and (
            {"document_id", "key", "workspace_key"}
            & set(inspect.signature(method).parameters)
        )
    } - {"create_project", "list_workspace_keys"}
    assert expected <= set(calls), expected - set(calls)
    seen = []

    def watch(module, name):
        original = getattr(module, name)

        def spy(*args, **kwargs):
            seen.append((name, args[-1]))
            return original(*args, **kwargs)

        monkeypatch.setattr(module, name, spy)

    watch(scoped_module, "require_document")
    watch(scoped_module, "require_case_text")
    watch(scoped_module, "visible_annotation_versions")
    watch(versions_module, "require_case_text")
    watch(versions_module, "may_read_proposals")
    case_methods = {
        "get_variant",
        "get_variant_text",
        "get_reanchor_items",
        "get_annotation_snapshot",
        "get_evidence_snapshot",
        "get_submission",
        "get_submissions_for_document",
    }
    for name, invoke in calls.items():
        seen.clear()
        code = (
            "PROPOSAL_SET_NOT_FOUND"
            if name == "get_proposal_set"
            else "VERSION_NOT_FOUND"
            if name == "get_annotation_version"
            else "DOCUMENT_NOT_FOUND"
        )
        with pytest.raises(DomainError, match=code):
            invoke()
        if name in case_methods:
            guards = ["require_case_text"]
        elif name == "get_annotation_version":
            guards = ["visible_annotation_versions", "require_case_text"]
        elif name == "get_proposal_set":
            guards = ["may_read_proposals"]
        else:
            guards = ["require_document"]
        assert seen == [(guard, "doc-alpha") for guard in guards], name
    assert repo.list_documents(PROJECT) == []
    assert repo.list_variants(PROJECT) == []
    assert repo.find_variants_by_text_sha256(PROJECT, "0" * 64) == []
    assert repo.list_workspace_keys(PROJECT, "alice") == []
    assert repo.get_document_statuses(PROJECT, "alice", "independent") == {}
    assert repo.review_input_document_ids(PROJECT) == set()


def test_assignment_admin_routes_partial_refusals_display_name_and_confirmations(
    assigned,
):
    from auth_harness import ensure_user, grant

    app, alice, row = assigned
    admin = logged_in(app, "admin", system_admin=True, assignments=[])
    ensure_user(app, "bob")
    grant(app, "bob", PROJECT, ["annotator"])
    created = admin.post(
        f"/api/v1/projects/{PROJECT}/assignments",
        json={
            "rows": [
                {"document_id": "doc-alpha", "username": "alice"},
                {"document_id": "doc-alpha", "username": "missing"},
            ],
            "task": "annotate",
            "confirm_language": True,
            "seed": 5,
        },
    )
    assert created.status_code == 200, created.text
    assert len(created.json()["created"]) == 1
    assert created.json()["created"][0]["display_name"] == "alice"
    assert created.json()["refused"] == [
        {"document_id": "doc-alpha", "username": "missing", "code": "USER_NOT_FOUND"}
    ]
    listed = admin.get(
        f"/api/v1/projects/{PROJECT}/assignments",
        params={"username": "alice", "document_id": "doc-alpha"},
    )
    assert listed.status_code == 200
    assert [entry["document_id"] for entry in listed.json()] == ["doc-alpha"]
    assert alice.get(f"/api/v1/projects/{PROJECT}/assignments").status_code == 403
    assert admin.post(f"/api/v1/assignments/{row.id}/open").status_code == 404
    opened = _open(alice, row)
    assert (
        alice.post(
            f"/api/v1/workspaces/{opened['workspace_id']}/commands", json=_envelope()
        ).status_code
        == 200
    )
    refused = admin.post(
        f"/api/v1/assignments/{row.id}/reassign", json={"username": "bob"}
    )
    assert refused.status_code == 409, refused.text
    assert refused.json()["code"] == "REASSIGN_CONFIRMATION_REQUIRED"
    moved = admin.post(
        f"/api/v1/assignments/{row.id}/reassign",
        json={"username": "bob", "confirm_started": True, "confirm_language": True},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["status"] == "open"
    assert moved.json()["pseudonym"] != row.pseudonym
    new_id = moved.json()["id"]
    bob = logged_in(app, "bob", assignments=[])
    new_open = bob.post(f"/api/v1/assignments/{new_id}/open")
    assert new_open.status_code == 200, new_open.text
    assert new_open.json()["view"]["draft"]["revision"] == 0
    assert new_open.json()["view"]["draft"]["annotations"] == []
    revoked = admin.post(
        f"/api/v1/assignments/{new_id}/revoke", json={"reason": "test"}
    )
    assert revoked.status_code == 200, revoked.text
    # Re-running default provisioning preserves the explicitly revoked row.
    bob = logged_in(app, "bob", projects={PROJECT: ["annotator"]})
    assert bob.post(f"/api/v1/assignments/{new_id}/open").status_code == 404
    assert not any(
        task["document_id"] == "doc-beta" for task in bob.get("/api/v1/me/tasks").json()
    )


def test_cli_assignment_requires_explicit_audited_language_confirmation(assigned):
    from typer.testing import CliRunner

    from ontocurator.cli import app as cli
    from ontocurator.storage.tables import AuditEventRow

    app, _client, _row = assigned
    runner = CliRunner()
    arguments = [
        "admin",
        "--database-url",
        str(app.state.repo.db.engine.url.render_as_string(hide_password=False)),
        "assign",
        PROJECT,
        "alice",
        "--document",
        "doc-alpha",
    ]
    refused = runner.invoke(cli, arguments)
    assert refused.exit_code == 1, refused.output
    assert "LANGUAGE_CONFIRMATION_REQUIRED" in refused.output
    created = runner.invoke(cli, [*arguments, "--confirm-language"])
    assert created.exit_code == 0, created.output
    assert "doc-alpha" in created.output
    # The seed path omits --document: every document is assigned, and existing
    # rows are idempotent rather than recreated or audited twice.
    all_documents = runner.invoke(cli, [*arguments[:-2], "--confirm-language"])
    assert all_documents.exit_code == 0, all_documents.output
    assert {
        row.document_id
        for row in AssignmentService(app.state.repo.db).list(PROJECT, user="alice")
    } == {"doc-alpha", "doc-beta"}
    assert "doc-alpha" in all_documents.output and "doc-beta" in all_documents.output
    with app.state.repo.db.transaction() as conn:
        actions = list(
            conn.execute(
                select(AuditEventRow.action).where(
                    AuditEventRow.target_type == "assignment"
                )
            ).scalars()
        )
    assert actions.count("assignment.language_override") == 2


@pytest.mark.parametrize("revocation", ["assignment", "membership"])
def test_revocation_waits_for_successful_command_transaction(
    assigned, monkeypatch, revocation
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from sqlalchemy import event

    from ontocurator.authz.scoped import ScopedRepository
    from ontocurator.storage.repository import _lock_id

    app, client, row = assigned
    token = _open(client, row)["workspace_id"]
    stored, release, waiting = Event(), Event(), Event()
    original = ScopedRepository._after_new_mutation

    def paused(self, conn, key, result, at):
        original(self, conn, key, result, at)
        stored.set()
        assert release.wait(10)

    def at_lock(conn, cursor, statement, parameters, context, executemany):
        values = parameters.values() if isinstance(parameters, dict) else parameters
        namespace = "project" if revocation == "assignment" else "members"
        if (
            "pg_advisory_xact_lock(" in statement
            and _lock_id(namespace, PROJECT) in values
        ):
            waiting.set()

    monkeypatch.setattr(ScopedRepository, "_after_new_mutation", paused)
    event.listen(app.state.repo.db.engine, "before_cursor_execute", at_lock)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            command = pool.submit(
                client.post, f"/api/v1/workspaces/{token}/commands", json=_envelope()
            )
            assert stored.wait(10)
            if revocation == "assignment":
                revoked = pool.submit(
                    AssignmentService(app.state.repo.db).revoke, HARNESS, row.id
                )
            else:
                revoked = pool.submit(
                    app.state.memberships.set_roles,
                    HARNESS,
                    PROJECT,
                    "alice",
                    [],
                    revoke_assignments=True,
                )
            try:
                assert waiting.wait(10)
                assert not revoked.done()
            finally:
                release.set()
            response = command.result(timeout=10)
            revoked.result(timeout=10)
    finally:
        release.set()
        event.remove(app.state.repo.db.engine, "before_cursor_execute", at_lock)
    assert response.status_code == 200, response.text
    with app.state.repo.db.transaction() as conn:
        assert (
            conn.execute(select(func.count()).select_from(EditEventRow)).scalar_one()
            == 1
        )
        assert (
            conn.execute(
                select(func.count()).select_from(MutationReceiptRow)
            ).scalar_one()
            == 1
        )
    assert AssignmentService(app.state.repo.db).list(PROJECT, user="alice") == []
