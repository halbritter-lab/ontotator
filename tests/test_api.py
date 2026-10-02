import hashlib
import io
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from ontocurator.api.app import create_app
from ontocurator.config import AppConfig
from ontocurator.domain.documents import (
    OntologyRef,
)
from ontocurator.packages.writer import PackageWriter

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "hp.json"


def _make_ontology_ref() -> OntologyRef:
    raw = FIXTURE_PATH.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    return OntologyRef(release="2026-06-23", sha256=digest)


def _create_sample_package_bytes(scenario: str = "single") -> bytes:
    from layered_fixtures import make_layered_package

    pkg = make_layered_package(scenario)
    buf = io.BytesIO()
    PackageWriter.write_to_stream(pkg, buf)
    return buf.getvalue()


@pytest.fixture
def app_client(tmp_path: Path):
    db_path = tmp_path / "api_test.db"
    config = AppConfig(
        workspace_dir=tmp_path,
        database_path=db_path,
        ontology_paths=[FIXTURE_PATH, FIXTURE_PATH.parent / "mondo.json"],
        ontology_path=FIXTURE_PATH,
        expected_ontology_ref=_make_ontology_ref(),
        session_token="secret-session-token",
    )
    app = create_app(config)
    client = TestClient(app, headers={"Authorization": "Bearer secret-session-token"})
    return client, config


def test_auth_and_host_validation(app_client):
    client, _ = app_client

    # 1. Missing Authorization header
    unauth_client = TestClient(client.app)
    resp = unauth_client.get("/api/v1/packages")
    assert resp.status_code == 403

    # 2. Invalid session token
    bad_token_client = TestClient(
        client.app, headers={"Authorization": "Bearer wrong-token"}
    )
    resp = bad_token_client.get("/api/v1/packages")
    assert resp.status_code == 403

    # 3. DNS rebinding / invalid Host header
    rebinding_client = TestClient(
        client.app,
        headers={
            "Authorization": "Bearer secret-session-token",
            "Host": "attacker.com",
        },
    )
    resp = rebinding_client.get("/api/v1/packages")
    assert resp.status_code == 403


def test_full_package_review_and_export_lifecycle(app_client):
    client, _ = app_client
    pkg_bytes = _create_sample_package_bytes("single")

    # 1. Upload work package
    files = {"file": ("package.zip", pkg_bytes, "application/zip")}
    resp = client.post("/api/v1/packages", files=files)
    assert resp.status_code == 200
    data = resp.json()
    assert data["package_id"] == "pkg-scenario-a"

    # 2. List documents (metadata only, no proposal counts, 1-indexed position)
    resp = client.get("/api/v1/packages/pkg-scenario-a/documents")
    assert resp.status_code == 200
    docs = resp.json()
    assert len(docs) == 2
    assert docs[0]["document_id"] == "doc-beta"
    assert docs[0]["position"] == 1
    assert docs[0]["status"] == "not_started"
    assert docs[1]["document_id"] == "doc-alpha"
    assert docs[1]["position"] == 2
    assert docs[1]["status"] == "not_started"
    assert "annotations_count" not in docs[0]
    assert "proposals" not in docs[0]

    # 3. Open independent workspace
    resp = client.post(
        "/api/v1/workspaces/open",
        json={
            "package_id": "pkg-scenario-a",
            "document_id": "doc-beta",
            "annotator_id": "annotator-1",
            "mode": "independent",
        },
    )
    assert resp.status_code == 200
    ws_data = resp.json()
    ws_id = ws_data["workspace_id"]
    view = ws_data["view"]
    assert view["draft"]["revision"] == 0
    assert view["scope"]["mode"] == "independent"
    assert len(view["layers"]) == 1
    assert view["layers"][0]["layer_id"] == "hpo-layer"
    ws_key = view["key"]

    # 4. Search route with layer_id
    resp = client.post(
        "/api/v1/search",
        json={
            "workspace_key": ws_key,
            "annotation_id": "ann-search-1",
            "layer_id": "hpo-layer",
            "query": "hypotonia",
            "route": "lexical",
            "k": 5,
        },
    )
    assert resp.status_code == 200
    search_res = resp.json()
    assert search_res["layer_id"] == "hpo-layer"
    assert "candidates" in search_res

    # 5. Apply Edit command
    cmd_edit = {
        "command": "create_annotation",
        "annotation_id": "new-ann-1",
        "layer_id": "hpo-layer",
        "type_id": "phenotype",
        "term_id": "HP:0001252",
        "axes": {"assertion": "present"},
        "evidence_id": "ev-hypo",
        "segments": [{"start": 30, "end": 44}],
    }
    resp = client.post(
        f"/api/v1/workspaces/{ws_id}/commands",
        json={
            "mutation_id": "mut-1",
            "expected_revision": 0,
            "payload": cmd_edit,
        },
    )
    assert resp.status_code == 200
    assert resp.json()["revision"] == 1

    # 6. Check layer
    cmd_check = {
        "command": "check_layer",
        "layer_id": "hpo-layer",
        "checked": True,
    }
    resp = client.post(
        f"/api/v1/workspaces/{ws_id}/commands",
        json={
            "mutation_id": "mut-2",
            "expected_revision": 1,
            "payload": cmd_check,
        },
    )
    assert resp.status_code == 200
    assert resp.json()["checked_layer_ids"] == ["hpo-layer"]

    # 7. Submit workspace
    resp = client.post(
        f"/api/v1/workspaces/{ws_id}/submit",
        json={
            "mutation_id": "mut-3",
            "expected_revision": 2,
            "payload": {"checked_layer_ids": ["hpo-layer"]},
        },
    )
    assert resp.status_code == 200
    submission = resp.json()
    assert submission["checked_layer_ids"] == ["hpo-layer"]
    sub_id = submission["submission_id"]

    # 8. Read back submission
    resp = client.get(f"/api/v1/workspaces/{ws_id}/submissions/{sub_id}")
    assert resp.status_code == 200
    assert resp.json()["submission_id"] == sub_id

    # 9. Export scoped package
    resp = client.get(f"/api/v1/workspaces/{ws_id}/export")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"
    assert len(resp.content) > 0


def test_document_list_with_position_and_status(app_client):
    client, _ = app_client
    pkg_bytes = _create_sample_package_bytes("single")
    client.post(
        "/api/v1/packages",
        files={"file": ("package.zip", pkg_bytes, "application/zip")},
    )

    # Initially both not_started
    res = client.get(
        "/api/v1/packages/pkg-scenario-a/documents?annotator_id=alice&mode=independent"
    )
    assert res.status_code == 200
    docs = res.json()
    assert len(docs) == 2
    assert docs[0]["document_id"] == "doc-beta"
    assert docs[0]["position"] == 1
    assert docs[0]["status"] == "not_started"
    assert docs[1]["document_id"] == "doc-alpha"
    assert docs[1]["position"] == 2
    assert docs[1]["status"] == "not_started"

    # Alice opens doc-beta and adds an annotation
    open_res = client.post(
        "/api/v1/workspaces/open",
        json={
            "package_id": "pkg-scenario-a",
            "document_id": "doc-beta",
            "annotator_id": "alice",
            "mode": "independent",
        },
    )
    ws_id = open_res.json()["workspace_id"]
    client.post(
        f"/api/v1/workspaces/{ws_id}/commands",
        json={
            "mutation_id": "m1",
            "expected_revision": 0,
            "payload": {
                "command": "create_annotation",
                "annotation_id": "ann-1",
                "layer_id": "hpo-layer",
                "type_id": "phenotype",
                "term_id": "HP:0001250",
            },
        },
    )

    # Now doc-beta is in_progress for Alice
    res = client.get(
        "/api/v1/packages/pkg-scenario-a/documents?annotator_id=alice&mode=independent"
    )
    docs = res.json()
    assert docs[0]["status"] == "in_progress"
    assert docs[1]["status"] == "not_started"

    # But for Bob it is still not_started (isolation)
    res_bob = client.get(
        "/api/v1/packages/pkg-scenario-a/documents?annotator_id=bob&mode=independent"
    )
    assert res_bob.json()[0]["status"] == "not_started"

    # Alice checks layer and submits
    client.post(
        f"/api/v1/workspaces/{ws_id}/commands",
        json={
            "mutation_id": "m2",
            "expected_revision": 1,
            "payload": {
                "command": "check_layer",
                "layer_id": "hpo-layer",
                "checked": True,
            },
        },
    )
    client.post(
        f"/api/v1/workspaces/{ws_id}/submit",
        json={
            "mutation_id": "m3",
            "expected_revision": 2,
            "payload": {"checked_layer_ids": ["hpo-layer"]},
        },
    )

    # Now doc-beta is completed for Alice
    res = client.get(
        "/api/v1/packages/pkg-scenario-a/documents?annotator_id=alice&mode=independent"
    )
    assert res.json()[0]["status"] == "completed"
    assert res.json()[1]["status"] == "not_started"


def test_rejected_foreign_layer_commands_and_search(app_client):
    client, _ = app_client
    pkg_bytes = _create_sample_package_bytes("single")
    client.post(
        "/api/v1/packages",
        files={"file": ("package.zip", pkg_bytes, "application/zip")},
    )

    open_res = client.post(
        "/api/v1/workspaces/open",
        json={
            "package_id": "pkg-scenario-a",
            "document_id": "doc-beta",
            "annotator_id": "alice",
            "mode": "independent",
        },
    )
    ws_id = open_res.json()["workspace_id"]
    ws_key = open_res.json()["view"]["key"]

    # 1. Search with foreign layer rejected
    res = client.post(
        "/api/v1/search",
        json={
            "workspace_key": ws_key,
            "annotation_id": "ann-1",
            "layer_id": "mondo-layer",
            "query": "seizure",
        },
    )
    assert res.status_code == 422
    assert res.json()["code"] == "UNKNOWN_LAYER"

    # 2. Command with foreign layer rejected
    res = client.post(
        f"/api/v1/workspaces/{ws_id}/commands",
        json={
            "mutation_id": "m1",
            "expected_revision": 0,
            "payload": {
                "command": "create_annotation",
                "annotation_id": "ann-1",
                "layer_id": "mondo-layer",
                "type_id": "disease",
                "term_id": "MONDO:0001",
            },
        },
    )
    assert res.status_code == 422
    assert res.json()["code"] == "UNKNOWN_LAYER"


def test_search_discards_mismatched_annotation_layer(app_client):
    client, _ = app_client
    pkg_bytes = _create_sample_package_bytes("multi_editable")
    client.post(
        "/api/v1/packages",
        files={"file": ("package.zip", pkg_bytes, "application/zip")},
    )

    open_res = client.post(
        "/api/v1/workspaces/open",
        json={
            "package_id": "pkg-scenario-c",
            "document_id": "doc-beta",
            "annotator_id": "alice",
            "mode": "independent",
        },
    )
    ws_id = open_res.json()["workspace_id"]
    ws_key = open_res.json()["view"]["key"]

    # Create annotation in layer-1
    client.post(
        f"/api/v1/workspaces/{ws_id}/commands",
        json={
            "mutation_id": "m1",
            "expected_revision": 0,
            "payload": {
                "command": "create_annotation",
                "annotation_id": "ann-hpo-1",
                "layer_id": "layer-1",
                "type_id": "type-opt",
                "term_id": "HP:0001250",
            },
        },
    )

    # Search for this annotation specifying layer-2 -> LAYER_MISMATCH rejected
    res = client.post(
        "/api/v1/search",
        json={
            "workspace_key": ws_key,
            "annotation_id": "ann-hpo-1",
            "layer_id": "layer-2",
            "query": "seizure",
        },
    )
    assert res.status_code == 422
    assert res.json()["code"] == "LAYER_MISMATCH"


def test_same_term_id_in_different_layers_isolated_status(app_client):
    from layered_fixtures import make_layered_package

    client, _ = app_client
    # An ontology may import a CURIE also present in another artifact. Both
    # definitions must actually contain that CURIE; HP IDs are not MONDO IDs.
    pkg = make_layered_package("multi_editable")
    secondary = json.loads((FIXTURE_PATH.parent / "mondo.json").read_bytes())
    secondary["graphs"][0]["nodes"].append(
        {
            "id": "HP:0001250",
            "lbl": "Secondary seizure label",
            "type": "CLASS",
        }
    )
    secondary_bytes = json.dumps(secondary).encode()
    pkg.manifest.task_profile.ontologies[1].sha256 = hashlib.sha256(
        secondary_bytes
    ).hexdigest()
    buffer = io.BytesIO()
    PackageWriter.write_to_stream(
        pkg, buffer, embedded_files={"ontologies/mondo.json": secondary_bytes}
    )
    imported = client.post(
        "/api/v1/packages",
        files={"file": ("package.zip", buffer.getvalue(), "application/zip")},
    )
    assert imported.status_code == 200, imported.text

    open_res = client.post(
        "/api/v1/workspaces/open",
        json={
            "package_id": "pkg-scenario-c",
            "document_id": "doc-beta",
            "annotator_id": "alice",
            "mode": "independent",
        },
    )
    assert open_res.status_code == 200
    view = open_res.json()["view"]
    assert len(view["layers"]) == 2
    ws_id = open_res.json()["workspace_id"]

    # Add HP:0001250 in layer-1
    first = client.post(
        f"/api/v1/workspaces/{ws_id}/commands",
        json={
            "mutation_id": "m1",
            "expected_revision": 0,
            "payload": {
                "command": "create_annotation",
                "annotation_id": "ann-hp",
                "layer_id": "layer-1",
                "type_id": "type-opt",
                "term_id": "HP:0001250",
            },
        },
    )
    assert first.status_code == 200, first.text
    # Add HP:0001250 in layer-2
    second = client.post(
        f"/api/v1/workspaces/{ws_id}/commands",
        json={
            "mutation_id": "m2",
            "expected_revision": 1,
            "payload": {
                "command": "create_annotation",
                "annotation_id": "ann-mondo",
                "layer_id": "layer-2",
                "type_id": "type-req",
                "term_id": "HP:0001250",
                "axes": {"severity": "mild"},
            },
        },
    )

    assert second.status_code == 200, second.text
    # Re-open workspace view and verify term_statuses
    reopen_res = client.post(
        "/api/v1/workspaces/open",
        json={
            "package_id": "pkg-scenario-c",
            "document_id": "doc-beta",
            "annotator_id": "alice",
            "mode": "independent",
        },
    )
    statuses = reopen_res.json()["view"]["term_statuses"]
    assert "layer-1:HP:0001250" in statuses
    assert "layer-2:HP:0001250" in statuses
    labels = []
    for layer_id in ("layer-1", "layer-2"):
        found = client.post(
            "/api/v1/search",
            json={
                "workspace_key": view["key"],
                "annotation_id": "new-search",
                "layer_id": layer_id,
                "query": "HP:0001250",
                "route": "id",
                "k": 5,
            },
        )
        assert found.status_code == 200, found.text
        labels.append(found.json()["candidates"][0]["label"])
    assert labels == ["Seizure", "Secondary seizure label"]


def test_revision_conflict_409_and_domain_error_422(app_client):
    client, _ = app_client
    pkg_bytes = _create_sample_package_bytes("single")

    # Upload
    client.post(
        "/api/v1/packages",
        files={"file": ("package.zip", pkg_bytes, "application/zip")},
    )

    # Open independent workspace
    resp = client.post(
        "/api/v1/workspaces/open",
        json={
            "package_id": "pkg-scenario-a",
            "document_id": "doc-beta",
            "annotator_id": "indep-1",
            "mode": "independent",
        },
    )
    ws_id = resp.json()["workspace_id"]

    # 1. 409 Conflict when expected_revision does not match
    resp = client.post(
        f"/api/v1/workspaces/{ws_id}/commands",
        json={
            "mutation_id": "mut-bad-rev",
            "expected_revision": 99,  # actual is 0
            "payload": {
                "command": "create_annotation",
                "annotation_id": "ann-1",
                "layer_id": "hpo-layer",
                "type_id": "phenotype",
                "term_id": "HP:0001252",
                "axes": {"assertion": "present"},
            },
        },
    )
    assert resp.status_code == 409
    assert resp.json()["code"] == "REVISION_CONFLICT"

    # 2. 422 DomainError when submitting without checking required layers
    resp = client.post(
        f"/api/v1/workspaces/{ws_id}/submit",
        json={
            "mutation_id": "mut-not-checked",
            "expected_revision": 0,
            "payload": {"checked_layer_ids": []},
        },
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == "LAYER_NOT_CHECKED"


def test_api_create_term_with_term_id_and_alias_conflict(app_client):
    client, _ = app_client

    pkg_bytes = _create_sample_package_bytes("single")

    client.post(
        "/api/v1/packages",
        files={"file": ("package.zip", pkg_bytes, "application/zip")},
    )

    resp = client.post(
        "/api/v1/workspaces/open",
        json={
            "package_id": "pkg-scenario-a",
            "document_id": "doc-beta",
            "annotator_id": "indep-1",
            "mode": "independent",
        },
    )
    ws_id = resp.json()["workspace_id"]

    # 1. Create annotation using term_id
    resp = client.post(
        f"/api/v1/workspaces/{ws_id}/commands",
        json={
            "mutation_id": "mut-term-1",
            "expected_revision": 0,
            "payload": {
                "command": "create_annotation",
                "annotation_id": "ann-term-1",
                "layer_id": "hpo-layer",
                "type_id": "phenotype",
                "term_id": "HP:0001252",
                "axes": {"assertion": "present"},
            },
        },
    )
    assert resp.status_code == 200
    draft = resp.json()
    assert draft["revision"] == 1
    assert draft["annotations"][0]["annotation"]["term_id"] == "HP:0001252"

    # 2. Conflicting term_id and hpo_id is rejected with 422
    resp = client.post(
        f"/api/v1/workspaces/{ws_id}/commands",
        json={
            "mutation_id": "mut-conflict-1",
            "expected_revision": 1,
            "payload": {
                "command": "create_annotation",
                "annotation_id": "ann-conflict",
                "layer_id": "hpo-layer",
                "type_id": "phenotype",
                "term_id": "HP:0001252",
                "hpo_id": "HP:0001250",
            },
        },
    )
    assert resp.status_code == 422


def test_api_retry_lost_response_before_and_after_restart(tmp_path: Path):
    db_path = tmp_path / "restart.db"
    config = AppConfig(
        workspace_dir=tmp_path,
        database_path=db_path,
        ontology_paths=[FIXTURE_PATH, FIXTURE_PATH.parent / "mondo.json"],
        ontology_path=FIXTURE_PATH,
        expected_ontology_ref=_make_ontology_ref(),
        session_token="test-token",
    )
    app = create_app(config)
    client = TestClient(app, headers={"Authorization": "Bearer test-token"})

    # Upload & open
    pkg_bytes = _create_sample_package_bytes("single")
    client.post(
        "/api/v1/packages",
        files={"file": ("package.zip", pkg_bytes, "application/zip")},
    )
    res = client.post(
        "/api/v1/workspaces/open",
        json={
            "package_id": "pkg-scenario-a",
            "document_id": "doc-beta",
            "annotator_id": "user-restart",
            "mode": "independent",
        },
    )
    ws_id = res.json()["workspace_id"]

    mutation_payload = {
        "mutation_id": "mut-lost-1",
        "expected_revision": 0,
        "payload": {
            "command": "create_annotation",
            "annotation_id": "ann-lost-1",
            "layer_id": "hpo-layer",
            "type_id": "phenotype",
            "term_id": "HP:0001252",
            "axes": {"assertion": "present"},
        },
    }

    # 1. Execute mutation
    res1 = client.post(f"/api/v1/workspaces/{ws_id}/commands", json=mutation_payload)
    assert res1.status_code == 200
    res1_data = res1.json()

    # 2. Retry before restart (idempotent replay)
    res2 = client.post(f"/api/v1/workspaces/{ws_id}/commands", json=mutation_payload)
    assert res2.status_code == 200
    assert res2.json() == res1_data

    # 3. Conflict on reused mutation_id with different payload
    conflict_payload = dict(mutation_payload)
    conflict_payload["payload"] = {
        "command": "create_annotation",
        "annotation_id": "ann-lost-DIFFERENT",
        "layer_id": "hpo-layer",
        "type_id": "phenotype",
        "term_id": "HP:0001250",
        "axes": {"assertion": "present"},
    }
    res_conflict = client.post(
        f"/api/v1/workspaces/{ws_id}/commands", json=conflict_payload
    )
    assert res_conflict.status_code == 409

    # 4. Restart server (create fresh app on same db)
    app2 = create_app(config)
    client2 = TestClient(app2, headers={"Authorization": "Bearer test-token"})

    # 5. Retry after restart (idempotent replay preserves same normalized response)
    res3 = client2.post(f"/api/v1/workspaces/{ws_id}/commands", json=mutation_payload)
    assert res3.status_code == 200
    assert res3.json() == res1_data
