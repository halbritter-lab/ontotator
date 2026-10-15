import io
import json
import zipfile

import pytest
from auth_harness import AutoLoginClient
from pg_harness import insert_proposal
from test_api import _create_sample_package_bytes
from test_api import app_client as _shared_app_client

from ontocurator.packages.reader import read_package

app_client = _shared_app_client


@pytest.mark.parametrize(
    "origin",
    ["http://localhost.attacker.example", "http://127.0.0.1:9999", "null"],
)
def test_origin_must_match_bound_host_and_port(app_client, origin):
    # Reads are not checked (the cookie is SameSite=Lax); a write from another
    # origin is refused even with the session cookie and the CSRF token.
    client, _ = app_client
    response = client.put("/api/v1/preferences", json={}, headers={"Origin": origin})
    assert response.status_code == 403
    assert response.json()["code"] == "CROSS_SITE_REQUEST"
    assert client.put("/api/v1/preferences", json={}).status_code == 200


def test_same_origin_is_allowed(app_client):
    client, _ = app_client
    response = client.get(
        "/api/v1/packages",
        headers={"Host": "127.0.0.1:8000", "Origin": "http://127.0.0.1:8000"},
    )
    assert response.status_code == 200


def _open(client, config, mode="independent", targets=None, scenario=None):
    pkg_scenario = scenario or ("assisted" if mode == "review" else "single")
    archive = _create_sample_package_bytes(pkg_scenario)
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        pkg_id = json.loads(z.read("manifest.json"))["package_id"]
    installed = {p["package_id"] for p in client.get("/api/v1/packages").json()}
    if pkg_id not in installed:
        # Re-importing is only idempotent for identical content; some tests
        # extend the installed package directly in the database.
        response = client.post(
            "/api/v1/packages",
            files={"file": ("fixture.zip", archive, "application/zip")},
        )
        assert response.status_code == 200
        assert response.json()["package_id"] == pkg_id
    doc_id = "doc-beta"
    response = client.post(
        "/api/v1/workspaces/open",
        json={
            "package_id": pkg_id,
            "document_id": doc_id,
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
    client = AutoLoginClient(client.app, raise_server_exceptions=False)
    response = client.post(
        f"/api/v1/workspaces/{opened['workspace_id']}/submit",
        json={
            "mutation_id": "invalid-body",
            "expected_revision": 0,
            "payload": {
                "command": "submit_workspace",
                "checked_layer_ids": ["invalid"],
            },
        },
    )
    assert response.status_code == 422


def test_review_open_computes_stable_target_identity(app_client):
    client, config = app_client
    opened = _open(client, config, mode="independent", scenario="single")
    pkg_id = opened["view"]["key"]["package_id"]
    doc_id = opened["view"]["key"]["document_id"]

    from ontocurator.domain.annotations import (
        ActorRef,
        Annotation,
        Provenance,
        snapshot,
    )

    doc = client.app.state.repo.get_document(pkg_id, doc_id)
    profile = client.app.state.repo.get_task_profile(pkg_id)
    ann = Annotation(
        annotation_id="ann-target-1",
        document_id=doc_id,
        layer_id="hpo-layer",
        type_id="phenotype",
        term_id="HP:0001252",
        axes_values={"assertion": "present"},
        provenance=Provenance(
            actor=ActorRef(actor_id="test", kind="human"), method="manual"
        ),
    )
    snap = snapshot(ann, [], doc, profile)
    insert_proposal(client.app.state.repo, pkg_id, snap)

    inputs = client.post(
        "/api/v1/workspaces/review-inputs",
        json={
            "package_id": pkg_id,
            "document_id": doc_id,
            "annotator_id": "reviewer",
            "mode": "review",
        },
    ).json()
    assert len(inputs) > 0
    target = {
        "annotation_id": inputs[0]["annotation"]["annotation_id"],
        "version": inputs[0]["version"],
    }
    first = _open(
        client,
        config,
        "review",
        {"target_set_id": "", "targets": [target]},
        scenario="single",
    )
    second = _open(
        client,
        config,
        "review",
        {"target_set_id": "", "targets": [target]},
        scenario="single",
    )
    assert first["workspace_id"] == second["workspace_id"]
    assert len(first["view"]["key"]["target_set_id"]) == 64


def test_search_is_recorded_and_exported(app_client):
    client, config = app_client
    opened = _open(client, config)
    layer_id = opened["view"]["layers"][0]["layer_id"]
    response = client.post(
        "/api/v1/search",
        json={
            "workspace_key": opened["view"]["key"],
            "annotation_id": "new-annotation",
            "layer_id": layer_id,
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
    package = read_package(
        io.BytesIO(exported.content), registry=client.app.state.ontology_registry
    )
    assert len(package.search_events) == 1
    event = package.search_events[0]
    assert event.event_id == result["search_id"]
    assert event.query == "HP:0001252"
    assert event.candidates == ["HP:0001252"]
    assert event.index_identity
    # Inspect persisted server record, not a caller-supplied event.
    stored = client.app.state.repo.get_search_event(event.event_id)
    assert stored is not None
    assert stored.ontology_release == "2026-06-23"
