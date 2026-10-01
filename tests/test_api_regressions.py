import io
import json

import pytest
from fastapi.testclient import TestClient
from test_api import _create_sample_package_bytes
from test_api import app_client as _shared_app_client

from ontocurator.packages.reader import read_package

app_client = _shared_app_client


@pytest.mark.parametrize(
    "origin",
    ["http://localhost.attacker.example", "http://127.0.0.1:9999", "null"],
)
def test_origin_must_match_bound_host_and_port(app_client, origin):
    client, _ = app_client
    response = client.get("/api/v1/packages", headers={"Origin": origin})
    assert response.status_code == 403


def test_same_origin_is_allowed(app_client):
    client, _ = app_client
    response = client.get(
        "/api/v1/packages",
        headers={"Host": "127.0.0.1:8000", "Origin": "http://127.0.0.1:8000"},
    )
    assert response.status_code == 200


def _open(client, config, mode="independent", targets=None):
    response = client.post(
        "/api/v1/packages",
        files={
            "file": (
                "fixture.zip",
                _create_sample_package_bytes(config.expected_ontology_ref),
                "application/zip",
            )
        },
    )
    assert response.status_code == 200
    response = client.post(
        "/api/v1/workspaces/open",
        json={
            "package_id": "pkg-api-1",
            "document_id": "doc-1",
            "annotator_id": "reviewer",
            "mode": mode,
            "targets": targets,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_invalid_command_body_returns_validation_error_not_server_error(app_client):
    client, config = app_client
    opened = _open(client, config)
    client = TestClient(
        client.app,
        headers={"Authorization": "Bearer secret-session-token"},
        raise_server_exceptions=False,
    )
    response = client.post(
        f"/api/v1/workspaces/{opened['workspace_id']}/submit",
        json={
            "mutation_id": "invalid-body",
            "expected_revision": 0,
            "payload": {"command": "submit_workspace", "document_checked": True},
        },
    )
    assert response.status_code == 422


def test_review_open_computes_stable_target_identity(app_client):
    client, config = app_client
    _open(client, config)
    inputs = client.post(
        "/api/v1/workspaces/review-inputs",
        json={
            "package_id": "pkg-api-1",
            "document_id": "doc-1",
            "annotator_id": "reviewer",
            "mode": "review",
        },
    ).json()
    target = {
        "annotation_id": inputs[0]["annotation"]["annotation_id"],
        "version": inputs[0]["version"],
    }
    first = _open(client, config, "review", {"target_set_id": "", "targets": [target]})
    second = _open(client, config, "review", {"target_set_id": "", "targets": [target]})
    assert first["workspace_id"] == second["workspace_id"]
    assert len(first["view"]["key"]["target_set_id"]) == 64


def test_search_is_recorded_and_exported(app_client):
    client, config = app_client
    opened = _open(client, config)
    response = client.post(
        "/api/v1/search",
        json={
            "workspace_key": opened["view"]["key"],
            "annotation_id": "new-annotation",
            "query": "HP:0001252",
            "route": "id",
            "k": 5,
        },
    )
    assert response.status_code == 200
    result = response.json()
    assert result.get("search_id")
    exported = client.get(f"/api/v1/workspaces/{opened['workspace_id']}/export")
    assert exported.status_code == 200
    package = read_package(io.BytesIO(exported.content))
    assert len(package.search_events) == 1
    event = package.search_events[0]
    assert event.event_id == result["search_id"]
    assert event.query == "HP:0001252"
    assert event.candidates == ["HP:0001252"]
    assert event.index_identity
    # Inspect persisted server record, not a caller-supplied event.
    row = (
        client.app.state.repo.db.get_connection()
        .execute(
            "SELECT payload_json FROM search_events WHERE event_id = ?",
            (event.event_id,),
        )
        .fetchone()
    )
    assert json.loads(row[0])["ontology_release"] == "2026-06-23"
