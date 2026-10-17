"""Actual PostgreSQL assignment-only continuation of existing review rounds."""

import pytest
from auth_harness import HARNESS, ensure_assignment, logged_in
from sqlalchemy import delete
from test_review_findings import HP_PATH, _app
from test_reviews import _setup_review_test_env

from ontocurator.application.workspaces import WorkspaceService
from ontocurator.assignments.service import AssignmentService
from ontocurator.domain.annotations import AnnotationRef
from ontocurator.domain.review import ReviewTargetSet
from ontocurator.domain.workspace import WorkspaceKey
from ontocurator.storage.tables import ProjectMembershipRow

PROJECT = "pkg-rev-1"


@pytest.fixture
def round_work(tmp_path):
    source = _setup_review_test_env(tmp_path / "source")
    auto, _ = _app(tmp_path / "api", ontology_paths=[HP_PATH])
    app = auto.app
    package = source["repo"].export_package(PROJECT)
    package.documents["doc-other"] = package.documents["doc-1"].model_copy(
        update={"document_id": "doc-other"}
    )
    package.manifest.document_order.append("doc-other")
    app.state.repo.import_package(package)
    client = logged_in(
        app,
        "alice",
        pseudonym="own-reviewer",
        projects={PROJECT: ["lead", "adjudicator"]},
        assignments=[],
    )
    ensure_assignment(app, "alice", PROJECT, "doc-1", "review")
    row = AssignmentService(app.state.repo.db).list(PROJECT, user="alice")[0]
    service = WorkspaceService(app.state.repo, source["ontology"])
    rounds = []
    for name in ("snap_a", "snap_b"):
        snap = source[name]
        targets = ReviewTargetSet.create(
            [
                AnnotationRef(
                    annotation_id=snap.annotation.annotation_id, version=snap.version
                )
            ]
        )
        key = WorkspaceKey(
            project_key=PROJECT,
            document_id="doc-1",
            annotator_id="own-reviewer",
            mode="review",
            target_set_id=targets.target_set_id,
        )
        rounds.append(service.open(key, targets))
    return app, client, row, service, rounds


def open_round(client, row, target):
    return client.post(
        f"/api/v1/assignments/{row.id}/open",
        json={"review_round_target_set_id": target},
    )


def test_ambiguous_assignment_retry_selects_and_resumes_exact_round(round_work):
    _app, client, row, _service, rounds = round_work
    ambiguous = client.post(f"/api/v1/assignments/{row.id}/open")
    assert ambiguous.status_code == 422, ambiguous.text
    assert ambiguous.json()["code"] == "AMBIGUOUS_REVIEW_ROUND"
    assert set(ambiguous.json()["details"]["rounds"]) == {
        r.key.target_set_id for r in rounds
    }
    chosen = rounds[1]
    selected = open_round(client, row, chosen.key.target_set_id)
    assert selected.status_code == 200, selected.text
    result = selected.json()
    assert result["assignment"]["id"] == row.id
    assert result["read_only"] is False
    assert result["view"]["key"] == chosen.key.model_dump(mode="json")
    assert result["view"]["targets"] == chosen.targets.model_dump(mode="json")
    resumed = open_round(client, row, chosen.key.target_set_id)
    assert resumed.status_code == 200, resumed.text
    assert resumed.json()["workspace_id"] == result["workspace_id"]
    assert resumed.json()["view"]["draft"] == result["view"]["draft"]


@pytest.mark.parametrize("body", [None, {}, {"review_round_target_set_id": None}])
def test_optional_body_keeps_existing_ambiguity_behavior(round_work, body):
    _app, client, row, _service, _rounds = round_work
    response = client.post(
        f"/api/v1/assignments/{row.id}/open", **({} if body is None else {"json": body})
    )
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "AMBIGUOUS_REVIEW_ROUND"


def test_selected_submitted_round_remains_read_only(round_work):
    _app, client, row, service, _rounds = round_work
    empty = ReviewTargetSet.create([])
    key = WorkspaceKey(
        project_key=PROJECT,
        document_id="doc-1",
        annotator_id="own-reviewer",
        mode="review",
        target_set_id=empty.target_set_id,
    )
    service.open(key, empty)
    opened = open_round(client, row, empty.target_set_id)
    assert opened.status_code == 200, opened.text
    token = opened.json()["workspace_id"]
    submitted = client.post(
        f"/api/v1/workspaces/{token}/submit",
        json={
            "mutation_id": "submit-selected",
            "expected_revision": 0,
            "payload": {
                "document_checked": True,
                "command": "submit_workspace",
                "checked_layer_ids": ["hpo-layer"],
            },
        },
    )
    assert submitted.status_code == 200, submitted.text
    resumed = open_round(client, row, empty.target_set_id)
    assert resumed.status_code == 200, resumed.text
    assert resumed.json()["read_only"] is True
    assert resumed.json()["assignment"]["status"] == "submitted"
    assert (
        resumed.json()["assignment"]["last_submission_id"]
        == submitted.json()["submission_id"]
    )
    assert resumed.json()["view"]["key"]["target_set_id"] == empty.target_set_id


@pytest.mark.parametrize(
    "denial", ["revoked", "foreign", "role_removed", "membership_removed"]
)
def test_selector_cannot_restore_assignment_authority(round_work, denial):
    app, client, row, _service, rounds = round_work
    if denial == "revoked":
        AssignmentService(app.state.repo.db).revoke(HARNESS, row.id)
    elif denial == "foreign":
        client = logged_in(
            app, "bob", projects={PROJECT: ["adjudicator"]}, assignments=[]
        )
    else:
        with app.state.repo.db.transaction() as conn:
            predicate = ProjectMembershipRow.user_id == row.user_id
            if denial == "role_removed":
                predicate &= ProjectMembershipRow.role == "adjudicator"
            conn.execute(delete(ProjectMembershipRow).where(predicate))
    response = open_round(client, row, rounds[1].key.target_set_id)
    expected = {
        "revoked": (404, "ASSIGNMENT_NOT_FOUND"),
        "foreign": (404, "ASSIGNMENT_NOT_FOUND"),
        "role_removed": (404, "ASSIGNMENT_NOT_FOUND"),
        "membership_removed": (404, "ASSIGNMENT_NOT_FOUND"),
    }[denial]
    assert (response.status_code, response.json()["code"]) == expected, response.text


def test_cross_document_round_is_refused_without_fallback(round_work):
    _app, client, row, service, _rounds = round_work
    empty = ReviewTargetSet.create([])
    key = WorkspaceKey(
        project_key=PROJECT,
        document_id="doc-other",
        annotator_id="own-reviewer",
        mode="review",
        target_set_id=empty.target_set_id,
    )
    service.open(key, empty)
    response = open_round(client, row, empty.target_set_id)
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "REVIEW_ROUND_NOT_FOUND"


def test_unknown_round_and_spoofed_authority_are_rejected(round_work):
    _app, client, row, _service, _rounds = round_work
    unknown = open_round(client, row, "unknown-round")
    assert unknown.status_code == 422, unknown.text
    assert unknown.json()["code"] == "REVIEW_ROUND_NOT_FOUND"
    spoofed = client.post(
        f"/api/v1/assignments/{row.id}/open",
        json={
            "review_round_target_set_id": "unknown-round",
            "document_id": "doc-other",
        },
    )
    assert spoofed.status_code == 422, spoofed.text
    assert spoofed.json()["detail"][0]["type"] == "extra_forbidden"


@pytest.mark.parametrize("body", [None, {}, {"review_round_target_set_id": None}])
def test_no_body_or_empty_body_opens_unambiguous_assignment(round_work, body):
    app, client, _row, _service, _rounds = round_work
    ensure_assignment(app, "alice", PROJECT, "doc-other", "review")
    row = next(
        row
        for row in AssignmentService(app.state.repo.db).list(PROJECT, user="alice")
        if row.document_id == "doc-other"
    )
    response = client.post(
        f"/api/v1/assignments/{row.id}/open", **({} if body is None else {"json": body})
    )
    assert response.status_code == 200, response.text
    assert response.json()["assignment"]["id"] == row.id
    assert response.json()["view"]["key"]["document_id"] == "doc-other"
    assert response.json()["view"]["key"]["annotator_id"] == "own-reviewer"
    assert response.json()["read_only"] is False
