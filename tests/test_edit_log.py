"""The edit log: every committed editing command, append-only (T2 D6)."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

import pytest
from auth_harness import logged_in
from layered_fixtures import make_layered_package
from pg_harness import database_url_for
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from ontotator.api.app import create_app
from ontotator.api.routes import decode_workspace_id
from ontotator.config import AppConfig
from ontotator.domain.documents import OntologyRef
from ontotator.storage.repository import DraftState
from ontotator.storage.tables import SCHEMA, SessionRow, SubmissionRow

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "hp.json"
PROJECT = "pkg-scenario-a"


@pytest.fixture
def app(tmp_path: Path) -> Any:
    raw = FIXTURE_PATH.read_bytes()
    config = AppConfig(
        workspace_dir=tmp_path,
        database_url=database_url_for(tmp_path / "api.db"),
        ontology_paths=[FIXTURE_PATH],
        ontology_path=FIXTURE_PATH,
        expected_ontology_ref=OntologyRef(
            release="2026-06-23", sha256=hashlib.sha256(raw).hexdigest()
        ),
    )
    app = create_app(config)
    app.state.repo.import_package(make_layered_package("single"))
    return app


@pytest.fixture
def alice(app: Any) -> Any:
    return logged_in(app, "alice", projects={PROJECT: ["annotator"]})


def _open(client: Any) -> str:
    response = client.post(
        "/api/v1/workspaces/open",
        json={"project_key": PROJECT, "document_id": "doc-beta"},
    )
    assert response.status_code == 200, response.text
    return str(response.json()["workspace_id"])


def _create(annotation_id: str, start: int, end: int) -> dict[str, Any]:
    return {
        "command": "create_annotation",
        "annotation_id": annotation_id,
        "layer_id": "hpo-layer",
        "type_id": "phenotype",
        "term_id": "HP:0001252",
        "axes": {"assertion": "present"},
        "evidence_id": f"ev-{annotation_id}",
        "segments": [{"start": start, "end": end}],
    }


def _send(
    client: Any, ws_id: str, mutation_id: str, revision: int, payload: dict[str, Any]
) -> Any:
    return client.post(
        f"/api/v1/workspaces/{ws_id}/commands",
        json={
            "mutation_id": mutation_id,
            "expected_revision": revision,
            "payload": payload,
        },
    )


def test_every_committed_command_is_logged_once(app: Any, alice: Any) -> None:
    ws_id = _open(alice)
    commands = [
        _create("a1", 30, 44),
        _create("a2", 0, 3),
        {"command": "check_layer", "layer_id": "hpo-layer", "checked": True},
    ]
    for revision, payload in enumerate(commands):
        response = _send(alice, ws_id, f"m{revision}", revision, payload)
        assert response.status_code == 200, response.text
    replay = _send(alice, ws_id, "m0", 0, commands[0])
    assert replay.status_code == 200

    events = app.state.repo.edit_events(decode_workspace_id(ws_id))

    assert [(e.revision_before, e.revision_after) for e in events] == [
        (0, 1),
        (1, 2),
        (2, 3),
    ]
    assert [e.mutation_id for e in events] == ["m0", "m1", "m2"]
    assert [e.kind for e in events] == ["edit", "edit", "edit"]
    assert [e.command for e in events] == commands


def test_a_failed_command_logs_nothing(app: Any, alice: Any) -> None:
    ws_id = _open(alice)

    stale = _send(alice, ws_id, "m0", 5, _create("a1", 30, 44))
    invalid = _send(alice, ws_id, "m1", 0, _create("a1", 30, 999))

    assert stale.status_code == 409
    assert invalid.status_code == 422
    assert app.state.repo.edit_events(decode_workspace_id(ws_id)) == []


def test_the_event_names_the_user_and_the_session(app: Any, alice: Any) -> None:
    ws_id = _open(alice)
    assert _send(alice, ws_id, "m0", 0, _create("a1", 30, 44)).status_code == 200

    [event] = app.state.repo.edit_events(decode_workspace_id(ws_id))
    user = app.state.accounts.get_by_username("alice")
    with app.state.repo.db.transaction() as conn:
        session_id = conn.execute(
            select(SessionRow.id).where(
                SessionRow.user_id == user.id, SessionRow.revoked_at.is_(None)
            )
        ).scalar_one()

    assert event.user_id == user.id
    assert event.session_id == session_id
    assert event.project_id is not None and event.draft_id is not None


def test_any_revision_can_be_reconstructed(app: Any, alice: Any) -> None:
    ws_id = _open(alice)
    key = decode_workspace_id(ws_id)
    commands = [
        _create("a1", 30, 44),
        _create("a2", 0, 3),
        {
            "command": "set_axes",
            "annotation_id": "a1",
            "axes_values": {"assertion": "absent"},
        },
        {"command": "delete_draft_annotation", "annotation_id": "a2"},
        {"command": "check_layer", "layer_id": "hpo-layer", "checked": True},
    ]
    observed = [DraftState()]
    for revision, payload in enumerate(commands):
        response = _send(alice, ws_id, f"m{revision}", revision, payload)
        assert response.status_code == 200, response.text
        observed.append(DraftState.of(app.state.repo.open_draft(key)))

    reconstructed = [
        app.state.repo.draft_state_at(key, revision)
        for revision in range(len(commands) + 1)
    ]

    assert reconstructed == observed
    assert len({state.annotations for state in observed}) == len(observed) - 1


def test_a_submission_references_its_last_event(app: Any, alice: Any) -> None:
    ws_id = _open(alice)
    creation = {
        **_create("a1", 30, 44),
        "axes": {
            "assertion": "present",
            "experiencer": "patient",
            "temporality": "current",
        },
        "chosen_axis_ids": ["assertion", "experiencer", "temporality"],
    }
    assert _send(alice, ws_id, "m0", 0, creation).status_code == 200
    check = {"command": "check_layer", "layer_id": "hpo-layer", "checked": True}
    assert _send(alice, ws_id, "m1", 1, check).status_code == 200
    submitted = alice.post(
        f"/api/v1/workspaces/{ws_id}/submit",
        json={
            "mutation_id": "m2",
            "expected_revision": 2,
            "payload": {"document_checked": True, "checked_layer_ids": ["hpo-layer"]},
        },
    )
    assert submitted.status_code == 200, submitted.text
    submission_id = submitted.json()["submission_id"]

    key = decode_workspace_id(ws_id)
    events = app.state.repo.edit_events(key)
    with app.state.repo.db.transaction() as conn:
        last = conn.execute(
            select(SubmissionRow.last_edit_event_id).where(
                SubmissionRow.submission_id == submission_id
            )
        ).scalar_one()

    assert events[-1].kind == "submit"
    assert events[-1].submission_id == submission_id
    assert events[-1].id == last
    assert (events[-1].revision_before, events[-1].revision_after) == (2, 3)
    # The state at submit is the submitted draft's content.
    assert events[-1].state == events[-2].state
    assert app.state.repo.draft_state_at(key, 3) == app.state.repo.draft_state_at(
        key, 2
    )


def test_the_application_cannot_rewrite_the_log(app: Any, alice: Any) -> None:
    ws_id = _open(alice)
    assert _send(alice, ws_id, "m0", 0, _create("a1", 30, 44)).status_code == 200

    for statement in (
        f"UPDATE {SCHEMA}.edit_events SET kind = 'edit'",
        f"DELETE FROM {SCHEMA}.edit_events",
    ):
        with (
            pytest.raises(DBAPIError, match="permission denied"),
            app.state.repo.db.engine.begin() as conn,
        ):
            conn.execute(text(statement))
