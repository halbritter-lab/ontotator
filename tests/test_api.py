import hashlib
import io
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from hpo_editor.api.app import create_app
from hpo_editor.config import AppConfig
from hpo_editor.domain.annotations import (
    ActorRef,
    Annotation,
    AnnotationRef,
    Provenance,
    snapshot,
)
from hpo_editor.domain.axes import Axes
from hpo_editor.domain.documents import (
    Document,
    EvidenceMention,
    EvidenceRef,
    OntologyRef,
    Segment,
    snapshot_evidence,
)
from hpo_editor.domain.review import ReviewTargetSet
from hpo_editor.packages.models import PackageManifest, ValidatedPackage
from hpo_editor.packages.writer import PackageWriter

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "hp.json"


def _make_ontology_ref() -> OntologyRef:
    raw = FIXTURE_PATH.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    return OntologyRef(release="2026-06-23", sha256=digest)


def _create_sample_package_bytes(ontology_ref: OntologyRef) -> bytes:
    text = "The patient showed severe hypotonia and seizure activity."
    text_digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    doc = Document(
        document_id="doc-1",
        text=text,
        language="en",
        text_sha256=text_digest,
    )

    ev_a = snapshot_evidence(
        EvidenceMention(evidence_id="ev-a", segments=[Segment(start=27, end=36)]),
        doc,
    )
    ann_a = Annotation(
        annotation_id="prop-1",
        document_id="doc-1",
        hpo_id="HP:0001252",
        axes=Axes(assertion="present"),
        evidence_refs=[EvidenceRef(evidence_id="ev-a", version=ev_a.version)],
        provenance=Provenance(
            actor=ActorRef(actor_id="dr-meier", kind="human"),
            method="manual",
        ),
    )
    snap_a = snapshot(ann_a, [ev_a], doc, ontology_ref)

    pkg = ValidatedPackage(
        manifest=PackageManifest(
            package_id="pkg-api-1",
            created_at="2026-10-01T00:00:00Z",
            ontology=ontology_ref,
        ),
        documents={"doc-1": doc},
        annotations={(snap_a.annotation.annotation_id, snap_a.version): snap_a},
        evidence={(ev_a.mention.evidence_id, ev_a.version): ev_a},
    )
    buf = io.BytesIO()
    PackageWriter.write_to_stream(pkg, buf)
    return buf.getvalue()


@pytest.fixture
def app_client(tmp_path: Path):
    db_path = tmp_path / "api_test.db"
    config = AppConfig(
        workspace_dir=tmp_path,
        database_path=db_path,
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
    client, config = app_client
    pkg_bytes = _create_sample_package_bytes(config.expected_ontology_ref)

    # 1. Upload work package
    files = {"file": ("package.zip", pkg_bytes, "application/zip")}
    resp = client.post("/api/v1/packages", files=files)
    assert resp.status_code == 200
    data = resp.json()
    assert data["package_id"] == "pkg-api-1"

    # 2. List documents (metadata only, no proposal counts or provenance indicators)
    resp = client.get("/api/v1/packages/pkg-api-1/documents")
    assert resp.status_code == 200
    docs = resp.json()
    assert len(docs) == 1
    assert docs[0]["document_id"] == "doc-1"
    assert "text_length" in docs[0]
    assert "annotations_count" not in docs[0]
    assert "proposals" not in docs[0]

    # 3. Get review inputs (only allowed in review mode)
    resp = client.post(
        "/api/v1/workspaces/review-inputs",
        json={
            "package_id": "pkg-api-1",
            "document_id": "doc-1",
            "annotator_id": "reviewer-1",
            "mode": "review",
        },
    )
    assert resp.status_code == 200
    inputs = resp.json()
    assert len(inputs) == 1
    target_snap = inputs[0]
    target_ref = {
        "annotation_id": target_snap["annotation"]["annotation_id"],
        "version": target_snap["version"],
    }

    # 4. Open review workspace
    target_set = ReviewTargetSet.create(
        [
            AnnotationRef(
                annotation_id=target_ref["annotation_id"],
                version=target_ref["version"],
            )
        ]
    )
    resp = client.post(
        "/api/v1/workspaces/open",
        json={
            "package_id": "pkg-api-1",
            "document_id": "doc-1",
            "annotator_id": "reviewer-1",
            "mode": "review",
            "targets": target_set.model_dump(),
        },
    )
    assert resp.status_code == 200
    ws_data = resp.json()
    ws_id = ws_data["workspace_id"]
    assert ws_data["view"]["draft"]["revision"] == 0

    # 5. Search route with provenance
    resp = client.post(
        "/api/v1/search",
        json={
            "workspace_key": {
                "package_id": "pkg-api-1",
                "document_id": "doc-1",
                "annotator_id": "reviewer-1",
                "mode": "review",
                "target_set_id": target_set.target_set_id,
            },
            "annotation_id": "ann-search-1",
            "query": "seizure",
            "route": "id",
            "k": 5,
        },
    )
    assert resp.status_code == 200
    search_res = resp.json()
    assert "candidates" in search_res

    # 6. Apply Edit command
    cmd_edit = {
        "command": "create_annotation",
        "annotation_id": "new-ann-1",
        "hpo_id": "HP:0001250",  # Seizure
        "axes": {"assertion": "present"},
        "evidence_id": "ev-seiz",
        "segments": [{"start": 41, "end": 48}],
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

    # 7. Record Review Decision (confirm target proposal)
    cmd_dec = {
        "target": target_ref,
        "outcome": "confirmed",
        "replacement": None,
        "note": "Agreed with proposal",
    }
    resp = client.post(
        f"/api/v1/workspaces/{ws_id}/decisions",
        json={
            "mutation_id": "mut-2",
            "expected_revision": 1,
            "payload": cmd_dec,
        },
    )
    assert resp.status_code == 200
    assert len(resp.json()["decisions"]) == 1

    # 8. Submit workspace
    resp = client.post(
        f"/api/v1/workspaces/{ws_id}/submit",
        json={
            "mutation_id": "mut-3",
            "expected_revision": 2,
            "payload": {"document_checked": True},
        },
    )
    assert resp.status_code == 200
    submission = resp.json()
    assert submission["document_checked"] is True
    sub_id = submission["submission_id"]

    # 9. Read back submission
    resp = client.get(f"/api/v1/workspaces/{ws_id}/submissions/{sub_id}")
    assert resp.status_code == 200
    assert resp.json()["submission_id"] == sub_id

    # 10. Export scoped package
    resp = client.get(f"/api/v1/workspaces/{ws_id}/export")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"
    assert len(resp.content) > 0


def test_revision_conflict_409_and_domain_error_422(app_client):
    client, config = app_client
    pkg_bytes = _create_sample_package_bytes(config.expected_ontology_ref)

    # Upload
    client.post(
        "/api/v1/packages",
        files={"file": ("package.zip", pkg_bytes, "application/zip")},
    )

    # Open independent workspace
    resp = client.post(
        "/api/v1/workspaces/open",
        json={
            "package_id": "pkg-api-1",
            "document_id": "doc-1",
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
                "hpo_id": "HP:0001252",
                "axes": {"assertion": "present"},
            },
        },
    )
    assert resp.status_code == 409
    assert resp.json()["code"] == "REVISION_CONFLICT"

    # 2. 422 DomainError when submitting without document checked
    resp = client.post(
        f"/api/v1/workspaces/{ws_id}/submit",
        json={
            "mutation_id": "mut-not-checked",
            "expected_revision": 0,
            "payload": {"document_checked": False},
        },
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == "DOCUMENT_NOT_CHECKED"
