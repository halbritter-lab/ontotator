import hashlib
import io
import json
from pathlib import Path

import pytest
from auth_harness import AutoLoginClient, upload_package
from pg_harness import database_url_for
from support.v2_writer import PackageWriter

from ontocurator.api.app import create_app
from ontocurator.config import AppConfig
from ontocurator.domain.documents import (
    OntologyRef,
)

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
        database_url=database_url_for(db_path),
        ontology_paths=[FIXTURE_PATH, FIXTURE_PATH.parent / "mondo.json"],
        ontology_path=FIXTURE_PATH,
        expected_ontology_ref=_make_ontology_ref(),
    )
    app = create_app(config)
    client = AutoLoginClient(app)
    return client, config


def test_term_labels_resolve_from_package_layer_without_search_event(app_client):
    client, _ = app_client
    imported = upload_package(
        client,
        files={
            "file": (
                "package.zip",
                _create_sample_package_bytes("single"),
                "application/zip",
            )
        },
    )
    assert imported.status_code == 200

    response = client.post(
        "/api/v1/terms/labels",
        json={
            "project_key": "pkg-scenario-a",
            "terms": [
                {"layer_id": "hpo-layer", "term_id": "HP:0001250"},
                {"layer_id": "hpo-layer", "term_id": "HP:9999999"},
            ],
        },
    )
    assert response.status_code == 200, response.text
    assert response.json() == [
        {
            "layer_id": "hpo-layer",
            "term_id": "HP:0001250",
            "label": "Seizure",
            "status": "valid",
            "primary_term_id": "HP:0001250",
            "replaced_by": None,
            "consider": [],
            "alt_ids": [],
        },
        {
            "layer_id": "hpo-layer",
            "term_id": "HP:9999999",
            "label": None,
            "status": "unknown",
            "primary_term_id": None,
            "replaced_by": None,
            "consider": [],
            "alt_ids": [],
        },
    ]


def test_full_package_review_and_export_lifecycle(app_client):
    client, _ = app_client
    pkg_bytes = _create_sample_package_bytes("single")

    # 1. Upload work package
    files = {"file": ("package.zip", pkg_bytes, "application/zip")}
    resp = upload_package(client, files=files)
    assert resp.status_code == 200
    data = resp.json()
    assert data["project_key"] == "pkg-scenario-a"

    # 2. List documents (metadata only, no proposal counts, stored position)
    resp = client.get("/api/v1/projects/pkg-scenario-a/documents")
    assert resp.status_code == 200
    docs = resp.json()
    assert len(docs) == 2
    assert docs[0]["document_id"] == "doc-beta"
    assert docs[0]["position"] == 0
    assert docs[0]["status"] == "not_started"
    assert docs[1]["document_id"] == "doc-alpha"
    assert docs[1]["position"] == 1
    assert docs[1]["status"] == "not_started"
    assert "annotations_count" not in docs[0]
    assert "proposals" not in docs[0]

    # 3. Open independent workspace
    resp = client.post(
        "/api/v1/workspaces/open",
        json={
            "project_key": "pkg-scenario-a",
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
        "axes": {
            "assertion": "present",
            "experiencer": "patient",
            "temporality": "current",
        },
        "chosen_axis_ids": ["assertion", "experiencer", "temporality"],
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
            "payload": {"document_checked": True, "checked_layer_ids": ["hpo-layer"]},
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


def test_document_list_with_position_and_status(app_client):
    client, _ = app_client
    pkg_bytes = _create_sample_package_bytes("single")
    upload_package(
        client,
        files={"file": ("package.zip", pkg_bytes, "application/zip")},
    )

    # Initially both not_started
    res = client.get(
        "/api/v1/projects/pkg-scenario-a/documents?annotator_id=alice&mode=independent"
    )
    assert res.status_code == 200
    docs = res.json()
    assert len(docs) == 2
    assert docs[0]["document_id"] == "doc-beta"
    assert docs[0]["position"] == 0
    assert docs[0]["status"] == "not_started"
    assert docs[1]["document_id"] == "doc-alpha"
    assert docs[1]["position"] == 1
    assert docs[1]["status"] == "not_started"

    # Alice opens doc-beta and adds an annotation
    open_res = client.post(
        "/api/v1/workspaces/open",
        json={
            "project_key": "pkg-scenario-a",
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
                "note": "Finding inferred from the complete document",
                "annotation_id": "ann-1",
                "layer_id": "hpo-layer",
                "type_id": "phenotype",
                "term_id": "HP:0001250",
                "axes": {
                    "assertion": "present",
                    "experiencer": "patient",
                    "temporality": "current",
                },
                "chosen_axis_ids": ["assertion", "experiencer", "temporality"],
            },
        },
    )

    # Now doc-beta is in_progress for Alice
    res = client.get(
        "/api/v1/projects/pkg-scenario-a/documents?annotator_id=alice&mode=independent"
    )
    docs = res.json()
    assert docs[0]["status"] == "in_progress"
    assert docs[1]["status"] == "not_started"

    # But for Bob it is still not_started (isolation)
    res_bob = client.get(
        "/api/v1/projects/pkg-scenario-a/documents?annotator_id=bob&mode=independent"
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
    submitted = client.post(
        f"/api/v1/workspaces/{ws_id}/submit",
        json={
            "mutation_id": "m3",
            "expected_revision": 2,
            "payload": {"document_checked": True, "checked_layer_ids": ["hpo-layer"]},
        },
    )
    assert submitted.status_code == 200, submitted.text

    # Now doc-beta is completed for Alice
    res = client.get(
        "/api/v1/projects/pkg-scenario-a/documents?annotator_id=alice&mode=independent"
    )
    assert res.json()[0]["status"] == "completed"
    assert res.json()[1]["status"] == "not_started"


def test_rejected_foreign_layer_commands_and_search(app_client):
    client, _ = app_client
    pkg_bytes = _create_sample_package_bytes("single")
    upload_package(
        client,
        files={"file": ("package.zip", pkg_bytes, "application/zip")},
    )

    open_res = client.post(
        "/api/v1/workspaces/open",
        json={
            "project_key": "pkg-scenario-a",
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
    upload_package(
        client,
        files={"file": ("package.zip", pkg_bytes, "application/zip")},
    )

    open_res = client.post(
        "/api/v1/workspaces/open",
        json={
            "project_key": "pkg-scenario-c",
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
                "note": "Finding inferred from the complete document",
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
    imported = upload_package(
        client,
        files={"file": ("package.zip", buffer.getvalue(), "application/zip")},
    )
    assert imported.status_code == 200, imported.text

    labels = client.post(
        "/api/v1/terms/labels",
        json={
            "project_key": "pkg-scenario-c",
            "terms": [
                {"layer_id": "layer-1", "term_id": "HP:0001250"},
                {"layer_id": "layer-2", "term_id": "HP:0001250"},
            ],
        },
    )
    assert labels.status_code == 200, labels.text
    assert [item["label"] for item in labels.json()] == [
        "Seizure",
        "Secondary seizure label",
    ]

    open_res = client.post(
        "/api/v1/workspaces/open",
        json={
            "project_key": "pkg-scenario-c",
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
                "note": "Finding inferred from the complete document",
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
                "note": "Finding inferred from the complete document",
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
            "project_key": "pkg-scenario-c",
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
    upload_package(
        client,
        files={"file": ("package.zip", pkg_bytes, "application/zip")},
    )

    # Open independent workspace
    resp = client.post(
        "/api/v1/workspaces/open",
        json={
            "project_key": "pkg-scenario-a",
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

    # 2. 422 DomainError without explicit document confirmation
    resp = client.post(
        f"/api/v1/workspaces/{ws_id}/submit",
        json={
            "mutation_id": "mut-not-checked",
            "expected_revision": 0,
            "payload": {"checked_layer_ids": []},
        },
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == "DOCUMENT_NOT_CHECKED"


def test_api_create_term_with_term_id_and_alias_conflict(app_client):
    client, _ = app_client

    pkg_bytes = _create_sample_package_bytes("single")

    upload_package(
        client,
        files={"file": ("package.zip", pkg_bytes, "application/zip")},
    )

    resp = client.post(
        "/api/v1/workspaces/open",
        json={
            "project_key": "pkg-scenario-a",
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
                "note": "Finding inferred from the complete document",
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
        database_url=database_url_for(db_path),
        ontology_paths=[FIXTURE_PATH, FIXTURE_PATH.parent / "mondo.json"],
        ontology_path=FIXTURE_PATH,
        expected_ontology_ref=_make_ontology_ref(),
    )
    app = create_app(config)
    client = AutoLoginClient(app)

    # Upload & open
    pkg_bytes = _create_sample_package_bytes("single")
    upload_package(
        client,
        files={"file": ("package.zip", pkg_bytes, "application/zip")},
    )
    res = client.post(
        "/api/v1/workspaces/open",
        json={
            "project_key": "pkg-scenario-a",
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
            "note": "Finding inferred from the complete document",
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
    client2 = AutoLoginClient(app2)

    # 5. Retry after restart (idempotent replay preserves same normalized response)
    res3 = client2.post(f"/api/v1/workspaces/{ws_id}/commands", json=mutation_payload)
    assert res3.status_code == 200
    assert res3.json() == res1_data


def test_document_list_flags_review_inputs_only_in_review_mode(app_client):
    """Review navigation can skip documents without proposals; other modes stay blind."""
    client, _ = app_client
    demo = (Path(__file__).parent / "fixtures" / "demo_package.zip").read_bytes()
    for name, data in (
        ("demo.zip", demo),
        ("single.zip", _create_sample_package_bytes("single")),
    ):
        resp = upload_package(client, files={"file": (name, data, "application/zip")})
        assert resp.status_code == 200, resp.text

    def flags(project_key: str, mode: str | None) -> list[bool | None]:
        params = {"annotator_id": "AB", "mode": mode} if mode else {}
        resp = client.get(f"/api/v1/projects/{project_key}/documents", params=params)
        assert resp.status_code == 200, resp.text
        return [d["has_review_inputs"] for d in resp.json()]

    assert flags("demo-klinik-pakete-01", "review") == [True, True]
    # Proposals on read-only reference layers are no review targets.
    assert flags("pkg-scenario-a", "review") == [False, False]
    assert flags("demo-klinik-pakete-01", "independent") == [None, None]
    assert flags("demo-klinik-pakete-01", None) == [None, None]


def test_auto_search_records_the_route_of_each_candidate(app_client):
    from ontocurator.domain.workspace import WorkspaceKey

    client, _ = app_client
    files = {
        "file": (
            "package.zip",
            _create_sample_package_bytes("single"),
            "application/zip",
        )
    }
    assert upload_package(client, files=files).status_code == 200
    opened = client.post(
        "/api/v1/workspaces/open",
        json={
            "project_key": "pkg-scenario-a",
            "document_id": "doc-beta",
            "annotator_id": "annotator-1",
            "mode": "independent",
        },
    )
    assert opened.status_code == 200, opened.text
    ws_id = opened.json()["workspace_id"]
    ws_key = opened.json()["view"]["key"]

    # No "route" in the body: the default is the single search.
    resp = client.post(
        "/api/v1/search",
        json={
            "workspace_key": ws_key,
            "annotation_id": "new-ann-1",
            "layer_id": "hpo-layer",
            "query": "hypotonia",
            "k": 5,
        },
    )
    assert resp.status_code == 200, resp.text
    result = resp.json()
    assert result["route"] == "auto"
    assert result["candidates"][0]["term_id"] == "HP:0001252"
    assert result["candidates"][0]["route"] == "exact"

    repo = client.app.state.repo
    event = repo.get_search_event(result["search_id"])
    assert event is not None
    assert event.route == "auto"
    assert event.candidates == result["displayed_ids"]
    assert event.candidate_routes == {
        c["term_id"]: c["route"] for c in result["candidates"]
    }
    assert event.candidate_routes["HP:0001252"] == "exact"

    # Selecting from that search keeps the routes on the selection event.
    resp = client.post(
        f"/api/v1/workspaces/{ws_id}/commands",
        json={
            "mutation_id": "mut-select-1",
            "expected_revision": 0,
            "payload": {
                "command": "create_annotation",
                "annotation_id": "new-ann-1",
                "layer_id": "hpo-layer",
                "type_id": "phenotype",
                "term_id": "HP:0001252",
                "axes": {"assertion": "present"},
                "evidence_id": "ev-hypo",
                "segments": [{"start": 30, "end": 44}],
                "search_event_id": result["search_id"],
            },
        },
    )
    assert resp.status_code == 200, resp.text

    events = repo.get_search_events_for_workspace(WorkspaceKey.model_validate(ws_key))
    selections = [e for e in events if e.selected_term_id == "HP:0001252"]
    assert len(selections) == 1
    assert selections[0].source_search_event_id == result["search_id"]
    assert selections[0].route == "auto"
    assert selections[0].candidate_routes["HP:0001252"] == "exact"
    assert selections[0].displayed_position == 1
    assert selections[0].ranked_position == 1


def test_selection_from_the_similar_block_records_its_positions(app_client):
    from ontocurator.domain.workspace import WorkspaceKey

    client, _ = app_client
    files = {
        "file": (
            "package.zip",
            _create_sample_package_bytes("single"),
            "application/zip",
        )
    }
    assert upload_package(client, files=files).status_code == 200
    opened = client.post(
        "/api/v1/workspaces/open",
        json={
            "project_key": "pkg-scenario-a",
            "document_id": "doc-beta",
            "annotator_id": "annotator-1",
            "mode": "independent",
        },
    )
    assert opened.status_code == 200, opened.text
    ws_id = opened.json()["workspace_id"]
    ws_key = opened.json()["view"]["key"]

    resp = client.post(
        "/api/v1/search",
        json={
            "workspace_key": ws_key,
            "annotation_id": "new-ann-1",
            "layer_id": "hpo-layer",
            "query": "Seizure",
        },
    )
    assert resp.status_code == 200, resp.text
    result = resp.json()
    assert result["candidates"][0]["route"] == "exact"
    # A term behind the exact block: its positions count the exact match too.
    chosen = next(c for c in result["candidates"] if c["term_id"] == "HP:0011146")
    assert chosen["route"] == "lexical"
    assert chosen["display_pos"] > 1
    assert chosen["rank"] > 1

    resp = client.post(
        f"/api/v1/workspaces/{ws_id}/commands",
        json={
            "mutation_id": "mut-select-similar",
            "expected_revision": 0,
            "payload": {
                "command": "create_annotation",
                "annotation_id": "new-ann-1",
                "layer_id": "hpo-layer",
                "type_id": "phenotype",
                "term_id": "HP:0011146",
                "axes": {"assertion": "present"},
                "evidence_id": "ev-hypo",
                "segments": [{"start": 30, "end": 44}],
                "search_event_id": result["search_id"],
            },
        },
    )
    assert resp.status_code == 200, resp.text

    events = client.app.state.repo.get_search_events_for_workspace(
        WorkspaceKey.model_validate(ws_key)
    )
    selections = [e for e in events if e.selected_term_id == "HP:0011146"]
    assert len(selections) == 1
    assert selections[0].candidate_routes["HP:0011146"] == "lexical"
    assert selections[0].displayed_position == chosen["display_pos"]
    assert selections[0].ranked_position == chosen["rank"]


def test_a_failing_start_closes_the_database(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from ontocurator.ontology.store import OntologyStore
    from ontocurator.storage.database import Database

    closed: list[Database] = []
    original_close = Database.close

    def tracking_close(self: Database) -> None:
        closed.append(self)
        original_close(self)

    def broken(_self: OntologyStore) -> None:
        raise RuntimeError("ontology start failed")

    monkeypatch.setattr(Database, "close", tracking_close)
    monkeypatch.setattr(OntologyStore, "register_all", broken)
    config = AppConfig(
        workspace_dir=tmp_path,
        database_url=database_url_for(tmp_path / "start.db"),
    )

    with pytest.raises(RuntimeError, match="ontology start failed"):
        create_app(config)

    assert len(closed) == 1


def test_a_failing_close_does_not_hide_why_the_start_failed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from ontocurator.ontology.store import OntologyStore
    from ontocurator.storage.database import Database

    original_close = Database.close
    failures: list[Database] = []

    def failing_close(self: Database) -> None:
        original_close(self)
        if not failures:  # the clean-up after the test closes it again
            failures.append(self)
            raise RuntimeError("close failed")

    def broken(_self: OntologyStore) -> None:
        raise RuntimeError("ontology start failed")

    monkeypatch.setattr(Database, "close", failing_close)
    monkeypatch.setattr(OntologyStore, "register_all", broken)
    config = AppConfig(
        workspace_dir=tmp_path,
        database_url=database_url_for(tmp_path / "start.db"),
    )

    with pytest.raises(RuntimeError, match="ontology start failed"):
        create_app(config)
    assert len(failures) == 1


def test_an_unmigrated_database_is_refused_at_start(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from pg_harness import unmigrated_database_url

    from ontocurator.domain.errors import DomainError
    from ontocurator.storage.database import Database
    from ontocurator.storage.schema import head_revision

    closed: list[Database] = []
    original_close = Database.close

    def tracking_close(self: Database) -> None:
        closed.append(self)
        original_close(self)

    monkeypatch.setattr(Database, "close", tracking_close)
    config = AppConfig(
        workspace_dir=tmp_path,
        database_url=unmigrated_database_url(tmp_path / "empty.db"),
    )

    with pytest.raises(DomainError) as exc_info:
        create_app(config)

    assert exc_info.value.code == "DATABASE_NOT_MIGRATED"
    assert exc_info.value.details == {"current": None, "head": head_revision()}
    assert len(closed) == 1


@pytest.mark.parametrize("confirmation", [None, False])
def test_layer_checks_do_not_replace_document_confirmation(app_client, confirmation):
    client, _ = app_client
    uploaded = upload_package(
        client,
        files={
            "file": ("package.zip", _create_sample_package_bytes(), "application/zip")
        },
    )
    assert uploaded.status_code == 200
    opened = client.post(
        "/api/v1/workspaces/open",
        json={
            "project_key": "pkg-scenario-a",
            "document_id": "doc-beta",
            "annotator_id": "curator",
            "mode": "independent",
        },
    )
    ws_id = opened.json()["workspace_id"]
    checked = client.post(
        f"/api/v1/workspaces/{ws_id}/commands",
        json={
            "mutation_id": "check",
            "expected_revision": 0,
            "payload": {
                "command": "check_layer",
                "layer_id": "hpo-layer",
                "checked": True,
            },
        },
    )
    assert checked.status_code == 200
    payload = {"checked_layer_ids": ["hpo-layer"]}
    if confirmation is not None:
        payload["document_checked"] = confirmation
    response = client.post(
        f"/api/v1/workspaces/{ws_id}/submit",
        json={
            "mutation_id": "submit",
            "expected_revision": 1,
            "payload": payload,
        },
    )
    assert response.status_code == 422
    assert response.json()["code"] == "DOCUMENT_NOT_CHECKED"


@pytest.mark.parametrize("scenario", ["single", "multi_editable"])
def test_api_document_confirmation_needs_no_layer_checks(app_client, scenario):
    client, _ = app_client
    uploaded = upload_package(
        client,
        files={
            "file": (
                "package.zip",
                _create_sample_package_bytes(scenario),
                "application/zip",
            )
        },
    )
    assert uploaded.status_code == 200
    opened = client.post(
        "/api/v1/workspaces/open",
        json={
            "project_key": uploaded.json()["project_key"],
            "document_id": "doc-beta",
            "annotator_id": "curator",
            "mode": "independent",
        },
    )
    ws_id = opened.json()["workspace_id"]
    response = client.post(
        f"/api/v1/workspaces/{ws_id}/submit",
        json={
            "mutation_id": "submit",
            "expected_revision": 0,
            "payload": {"document_checked": True},
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["checked_layer_ids"] == []
    assert response.json()["document_checked"] is True
