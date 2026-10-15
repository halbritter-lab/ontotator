"""Working modes follow project roles; review shows proposals only (index Q2, Q3)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from auth_harness import HARNESS, logged_in, upload_package
from pg_harness import database_url_for

from ontocurator.api.app import create_app
from ontocurator.application.workspaces import WorkspaceService
from ontocurator.authz.policy import Access
from ontocurator.authz.scoped import ScopedRepository
from ontocurator.config import AppConfig

FIXTURES = Path(__file__).parent / "fixtures"
DEMO_PACKAGE = FIXTURES / "demo_package.zip"
DEMO_ID = "demo-klinik-pakete-01"
DOCUMENT = "fall-001-neuropediatrie"


@pytest.fixture
def app(tmp_path: Path) -> Any:
    config = AppConfig(
        workspace_dir=tmp_path, database_url=database_url_for(tmp_path / "editor.db")
    )
    app = create_app(config)
    root = logged_in(app, "root", system_admin=True)
    uploaded = upload_package(
        root,
        files={"file": ("demo.zip", DEMO_PACKAGE.read_bytes(), "application/zip")},
    )
    assert uploaded.status_code == 200, uploaded.text
    return app


def _member(app: Any, name: str, *roles: str) -> Any:
    return logged_in(app, name, pseudonym=name, projects={DEMO_ID: list(roles)})


def _open(client: Any, mode: str) -> Any:
    return client.post(
        "/api/v1/workspaces/open",
        json={"project_key": DEMO_ID, "document_id": DOCUMENT, "mode": mode},
    )


def _review_inputs(client: Any) -> Any:
    return client.post(
        "/api/v1/workspaces/review-inputs",
        json={"project_key": DEMO_ID, "document_id": DOCUMENT, "mode": "review"},
    )


def _proposals(app: Any) -> set[tuple[str, str]]:
    return {
        (s.annotation.annotation_id, s.version)
        for s in app.state.repo.list_annotations_for_document(DEMO_ID, DOCUMENT)
    }


def test_project_list_shows_roles_and_modes(app: Any) -> None:
    alice = _member(app, "alice", "annotator")

    projects = alice.get("/api/v1/projects")

    assert projects.status_code == 200, projects.text
    [project] = projects.json()
    assert project["project_key"] == DEMO_ID
    assert project["name"] == DEMO_ID
    assert project["description"] is None
    assert project["roles"] == ["annotator"]
    assert project["allowed_modes"] == ["independent", "assisted"]
    assert project["document_count"] == 2


def test_the_project_list_shows_only_visible_projects(app: Any) -> None:
    outsider = logged_in(app, "outsider")
    root = logged_in(app, "root")

    assert outsider.get("/api/v1/projects").json() == []
    [project] = root.get("/api/v1/projects").json()
    # The uploader holds every role of the project it created.
    assert project["roles"] == ["adjudicator", "annotator", "lead"]
    assert project["allowed_modes"] == ["independent", "review", "assisted"]


def test_an_annotator_cannot_open_review_mode(app: Any) -> None:
    alice = _member(app, "alice", "annotator")

    for response in (_open(alice, "review"), _review_inputs(alice)):
        assert response.status_code == 403, response.text
        assert response.json()["code"] == "MODE_NOT_ALLOWED"
    assert _open(alice, "independent").status_code == 200
    assert _open(alice, "assisted").status_code == 200


def test_an_adjudicator_reviews(app: Any) -> None:
    bob = _member(app, "bob", "adjudicator")

    opened = _open(bob, "review")

    assert opened.status_code == 200, opened.text
    assert _open(bob, "independent").json()["code"] == "MODE_NOT_ALLOWED"
    assert _open(bob, "assisted").json()["code"] == "MODE_NOT_ALLOWED"


def test_a_lead_without_annotator_role_cannot_annotate(app: Any) -> None:
    lead = _member(app, "lead", "lead")

    for mode in ("independent", "assisted", "review"):
        response = _open(lead, mode)
        assert response.status_code == 403, (mode, response.text)
        assert response.json()["code"] == "MODE_NOT_ALLOWED"
    # A lead still sees the project.
    assert lead.get(f"/api/v1/projects/{DEMO_ID}/documents").status_code == 200


def test_the_review_document_list_is_refused_to_annotators(app: Any) -> None:
    alice = _member(app, "alice", "annotator")
    bob = _member(app, "bob", "adjudicator")
    path = f"/api/v1/projects/{DEMO_ID}/documents"

    refused = alice.get(path, params={"mode": "review"})
    shown = bob.get(path, params={"mode": "review"})

    assert refused.status_code == 403, refused.text
    assert refused.json()["code"] == "MODE_NOT_ALLOWED"
    assert shown.status_code == 200, shown.text
    assert any(d["has_review_inputs"] for d in shown.json())
    # Without review mode the list stays open to the annotator.
    for params in ({}, {"mode": "independent"}):
        listed = alice.get(path, params=params)
        assert listed.status_code == 200, listed.text
        assert all(d["has_review_inputs"] is None for d in listed.json())


def test_mode_commands_are_refused_without_the_role(app: Any) -> None:
    bob = _member(app, "bob", "adjudicator", "annotator")
    opened = _open(bob, "independent")
    assert opened.status_code == 200, opened.text
    ws_id = opened.json()["workspace_id"]
    app.state.memberships.remove(HARNESS, DEMO_ID, "bob", ["annotator"])
    bob = logged_in(app, "bob")
    envelope = {
        "mutation_id": "m1",
        "expected_revision": 0,
        "payload": {"command": "check_layer", "layer_id": "hpo-layer", "checked": True},
    }

    for path in ("commands", "decisions", "submit"):
        response = bob.post(f"/api/v1/workspaces/{ws_id}/{path}", json=envelope)
        assert response.status_code == 403, (path, response.text)
        assert response.json()["code"] == "MODE_NOT_ALLOWED"


def test_review_never_shows_other_members_work(app: Any) -> None:
    alice = _member(app, "alice", "annotator")
    opened = _open(alice, "independent")
    assert opened.status_code == 200, opened.text
    ws_id = opened.json()["workspace_id"]
    commands = [
        {
            "command": "create_annotation",
            "annotation_id": "alice-1",
            "layer_id": "hpo-layer",
            "type_id": "phenotype",
            "term_id": "HP:0001250",
            "axes": {"assertion": "present"},
            "evidence_id": "ev-alice-1",
            "segments": [{"start": 0, "end": 5}],
        },
        {"command": "check_layer", "layer_id": "hpo-layer", "checked": True},
    ]
    for revision, payload in enumerate(commands):
        sent = alice.post(
            f"/api/v1/workspaces/{ws_id}/commands",
            json={
                "mutation_id": f"m{revision}",
                "expected_revision": revision,
                "payload": payload,
            },
        )
        assert sent.status_code == 200, sent.text
    submitted = alice.post(
        f"/api/v1/workspaces/{ws_id}/submit",
        json={
            "mutation_id": "m2",
            "expected_revision": 2,
            "payload": {"checked_layer_ids": ["hpo-layer"]},
        },
    )
    assert submitted.status_code == 200, submitted.text
    alices = {
        (s["annotation"]["annotation_id"], s["version"])
        for s in submitted.json()["snapshots"]
    }
    assert alices

    bob = _member(app, "bob", "adjudicator")
    inputs = _review_inputs(bob)
    review = _open(bob, "review")

    assert inputs.status_code == 200, inputs.text
    shown = {(s["annotation"]["annotation_id"], s["version"]) for s in inputs.json()}
    assert shown == _proposals(app)
    assert review.status_code == 200, review.text
    view = review.json()["view"]
    targets = {(t["annotation_id"], t["version"]) for t in view["targets"]["targets"]}
    assert targets == _proposals(app)
    available = {
        (s["annotation"]["annotation_id"], s["version"])
        for s in view["available_inputs"]
    }
    assert not available & alices
    assert not targets & alices
    assert view["submissions"] == []

    # The service gives the same answer as the route.
    access = Access(user_id=0, pseudonym="x", is_system_admin=True)
    service = WorkspaceService(
        ScopedRepository(app.state.repo.db, access), app.state.ontology_registry
    )
    assert {
        (s.annotation.annotation_id, s.version)
        for s in service.get_review_inputs(DEMO_ID, DOCUMENT)
    } == _proposals(app)


def test_a_lead_reads_other_members_work_and_an_annotator_does_not(app: Any) -> None:
    alice = _member(app, "alice", "annotator")
    assert _open(alice, "independent").status_code == 200
    lead = _member(app, "lead", "lead")
    bob = _member(app, "bob", "annotator")
    path = f"/api/v1/projects/{DEMO_ID}/documents"
    params = {"annotator_id": "alice", "mode": "independent"}

    by_lead = lead.get(path, params=params)
    by_bob = bob.get(path, params=params)

    assert by_lead.status_code == 200, by_lead.text
    assert by_bob.status_code == 403
    assert by_bob.json()["code"] == "IDENTITY_MISMATCH"
