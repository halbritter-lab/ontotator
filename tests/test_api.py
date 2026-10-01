import hashlib
import io
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from ontocurator.api.app import create_app
from ontocurator.config import AppConfig
from ontocurator.domain.annotations import (
    ActorRef,
    Annotation,
    AnnotationRef,
    Provenance,
    snapshot,
)
from ontocurator.domain.axes import Axes
from ontocurator.domain.documents import (
    Document,
    EvidenceMention,
    EvidenceRef,
    OntologyRef,
    Segment,
    snapshot_evidence,
)
from ontocurator.domain.review import ReviewTargetSet
from ontocurator.packages.models import PackageManifest, ValidatedPackage
from ontocurator.packages.writer import PackageWriter

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


def test_api_create_term_with_term_id_and_alias_conflict(app_client):
    client, config = app_client
    pkg_bytes = _create_sample_package_bytes(config.expected_ontology_ref)

    client.post(
        "/api/v1/packages",
        files={"file": ("package.zip", pkg_bytes, "application/zip")},
    )

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

    # 1. Create annotation using term_id
    resp = client.post(
        f"/api/v1/workspaces/{ws_id}/commands",
        json={
            "mutation_id": "mut-term-1",
            "expected_revision": 0,
            "payload": {
                "command": "create_annotation",
                "annotation_id": "ann-term-1",
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
                "term_id": "HP:0001252",
                "hpo_id": "HP:0001250",
            },
        },
    )
    assert resp.status_code == 422


def test_api_normalized_views_and_axes_metadata(app_client):
    client, config = app_client
    pkg_bytes = _create_sample_package_bytes(config.expected_ontology_ref)

    client.post(
        "/api/v1/packages",
        files={"file": ("package.zip", pkg_bytes, "application/zip")},
    )

    resp = client.post(
        "/api/v1/workspaces/open",
        json={
            "package_id": "pkg-api-1",
            "document_id": "doc-1",
            "annotator_id": "indep-1",
            "mode": "independent",
        },
    )
    assert resp.status_code == 200
    view = resp.json()["view"]
    assert "axes_definition" in view
    assert "axes_config" in view
    assert "axes_config_sha256" in view
    assert view["axes_definition"] == "editor-axes/v1"
    assert len(view["axes_config"]) == 3


@pytest.mark.parametrize(
    "profile_type,axes_list",
    [
        (
            "custom",
            [
                {
                    "id": "severity",
                    "label": "Severity",
                    "options": ["mild", "severe"],
                    "allow_empty": True,
                }
            ],
        ),
        ("empty", []),
        ("legacy", None),
    ],
)
def test_custom_axes_workspace_export_roundtrip(
    tmp_path: Path, profile_type: str, axes_list: list | None
):
    from ontocurator.api.app import create_app
    from ontocurator.config import AppConfig
    from ontocurator.domain.axes import AxesConfig, AxisDefinition
    from ontocurator.packages.reader import read_package

    db_path = tmp_path / f"test_{profile_type}.db"
    ontology_path = FIXTURE_PATH
    raw = ontology_path.read_bytes()
    ontology_ref = OntologyRef(
        release="2026-06-23", sha256=hashlib.sha256(raw).hexdigest()
    )

    config = AppConfig(
        workspace_dir=tmp_path,
        database_path=db_path,
        ontology_path=ontology_path,
        expected_ontology_ref=ontology_ref,
        session_token="test-token",
    )
    app = create_app(config)
    client = TestClient(app, headers={"Authorization": "Bearer test-token"})

    # Prepare package with profile
    text = "The patient showed severe hypotonia and seizure activity."
    text_digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    doc = Document(
        document_id="doc-1", text=text, language="en", text_sha256=text_digest
    )

    if profile_type == "custom":
        axes_cfg = AxesConfig(
            definition_name="custom-profile/v1",
            axes=[AxisDefinition(**a) for a in axes_list],
        )
        manifest = PackageManifest(
            format_version="ontocurator-work-package/v1",
            package_id=f"pkg-{profile_type}",
            created_at="2026-10-01T00:00:00Z",
            ontology=ontology_ref,
            axes_definition="custom-profile/v1",
            axes_config=axes_cfg,
            axes_config_sha256=axes_cfg.config_sha256,
        )
    elif profile_type == "empty":
        axes_cfg = AxesConfig(definition_name="empty-profile/v1", axes=[])
        manifest = PackageManifest(
            format_version="ontocurator-work-package/v1",
            package_id=f"pkg-{profile_type}",
            created_at="2026-10-01T00:00:00Z",
            ontology=ontology_ref,
            axes_definition="empty-profile/v1",
            axes_config=axes_cfg,
            axes_config_sha256=axes_cfg.config_sha256,
        )
    else:
        manifest = PackageManifest(
            format_version="hpo-editor-work-package/v1",
            package_id=f"pkg-{profile_type}",
            created_at="2026-10-01T00:00:00Z",
            ontology=ontology_ref,
            axes_definition="editor-axes/v1",
        )

    pkg = ValidatedPackage(
        manifest=manifest,
        documents={"doc-1": doc},
    )
    buf = io.BytesIO()
    PackageWriter.write_to_stream(pkg, buf)
    pkg_bytes = buf.getvalue()

    # Upload
    res = client.post(
        "/api/v1/packages", files={"file": ("pkg.zip", pkg_bytes, "application/zip")}
    )
    assert res.status_code == 200

    # Open workspace
    res = client.post(
        "/api/v1/workspaces/open",
        json={
            "package_id": f"pkg-{profile_type}",
            "document_id": "doc-1",
            "annotator_id": "user-1",
            "mode": "independent",
        },
    )
    assert res.status_code == 200
    ws_id = res.json()["workspace_id"]

    # Edit: add annotation
    axes_payload = {}
    if profile_type == "custom":
        axes_payload = {
            "definition_name": "custom-profile/v1",
            "values": {"severity": "mild"},
        }
    elif profile_type == "empty":
        axes_payload = {"definition_name": "empty-profile/v1", "values": {}}
    else:
        axes_payload = {"assertion": "present"}

    res = client.post(
        f"/api/v1/workspaces/{ws_id}/commands",
        json={
            "mutation_id": "m1",
            "expected_revision": 0,
            "payload": {
                "command": "create_annotation",
                "annotation_id": "ann-roundtrip",
                "term_id": "HP:0001252",
                "axes": axes_payload,
            },
        },
    )
    assert res.status_code == 200

    # Submit
    res = client.post(
        f"/api/v1/workspaces/{ws_id}/submit",
        json={
            "mutation_id": "m2",
            "expected_revision": 1,
            "payload": {"document_checked": True},
        },
    )
    assert res.status_code == 200

    # Export
    res = client.get(f"/api/v1/workspaces/{ws_id}/export")
    assert res.status_code == 200
    exported_bytes = res.content

    # Re-read package from exported ZIP
    exported_pkg = read_package(io.BytesIO(exported_bytes), ontology_ref)
    assert exported_pkg.manifest.format_version == "ontocurator-work-package/v1"
    if profile_type == "custom":
        assert exported_pkg.manifest.axes_definition == "custom-profile/v1"
        assert exported_pkg.manifest.axes_config.axes[0].id == "severity"
    elif profile_type == "empty":
        assert exported_pkg.manifest.axes_definition == "empty-profile/v1"
        assert exported_pkg.manifest.axes_config.axes == []
    else:
        assert exported_pkg.manifest.axes_definition == "editor-axes/v1"


def test_api_retry_lost_response_before_and_after_restart(tmp_path: Path):
    from ontocurator.api.app import create_app
    from ontocurator.config import AppConfig

    db_path = tmp_path / "restart.db"
    ontology_path = FIXTURE_PATH
    raw = ontology_path.read_bytes()
    ontology_ref = OntologyRef(
        release="2026-06-23", sha256=hashlib.sha256(raw).hexdigest()
    )

    config = AppConfig(
        workspace_dir=tmp_path,
        database_path=db_path,
        ontology_path=ontology_path,
        expected_ontology_ref=ontology_ref,
        session_token="test-token",
    )
    app = create_app(config)
    client = TestClient(app, headers={"Authorization": "Bearer test-token"})

    # Upload & open
    pkg_bytes = _create_sample_package_bytes(ontology_ref)
    client.post(
        "/api/v1/packages",
        files={"file": ("package.zip", pkg_bytes, "application/zip")},
    )
    res = client.post(
        "/api/v1/workspaces/open",
        json={
            "package_id": "pkg-api-1",
            "document_id": "doc-1",
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


def test_profile_resolution_precedence_and_cli_fallback(tmp_path: Path):
    from ontocurator.api.app import create_app
    from ontocurator.config import AppConfig
    from ontocurator.domain.axes import AxesConfig, AxisDefinition

    ontology_path = FIXTURE_PATH
    raw = ontology_path.read_bytes()
    ontology_ref = OntologyRef(
        release="2026-06-23", sha256=hashlib.sha256(raw).hexdigest()
    )

    cli_profile = AxesConfig(
        definition_name="cli-profile/v1",
        axes=[AxisDefinition(id="urgency", label="Urgency", options=["low", "high"])],
    )

    db_path = tmp_path / "res.db"
    config = AppConfig(
        workspace_dir=tmp_path,
        database_path=db_path,
        ontology_path=ontology_path,
        expected_ontology_ref=ontology_ref,
        session_token="token",
        axes_config=cli_profile,
    )
    app = create_app(config)
    client = TestClient(app, headers={"Authorization": "Bearer token"})

    text = "Some text."
    doc = Document(
        document_id="doc-1",
        text=text,
        language="en",
        text_sha256=hashlib.sha256(text.encode()).hexdigest(),
    )

    # 1. Package with unknown profile and no CLI match -> 422 rejected
    pkg_missing = ValidatedPackage(
        manifest=PackageManifest(
            format_version="ontocurator-work-package/v1",
            package_id="pkg-missing",
            created_at="2026-10-01T00:00:00Z",
            ontology=ontology_ref,
            axes_definition="unknown-profile/v1",
        ),
        documents={"doc-1": doc},
    )
    buf = io.BytesIO()
    PackageWriter.write_to_stream(pkg_missing, buf)
    res = client.post(
        "/api/v1/packages",
        files={"file": ("pkg.zip", buf.getvalue(), "application/zip")},
    )
    assert res.status_code == 422

    # 2. Package matching CLI profile -> successfully resolved and imported
    pkg_cli = ValidatedPackage(
        manifest=PackageManifest(
            format_version="ontocurator-work-package/v1",
            package_id="pkg-cli",
            created_at="2026-10-01T00:00:00Z",
            ontology=ontology_ref,
            axes_definition="cli-profile/v1",
        ),
        documents={"doc-1": doc},
    )
    buf = io.BytesIO()
    PackageWriter.write_to_stream(pkg_cli, buf)
    res = client.post(
        "/api/v1/packages",
        files={"file": ("pkg.zip", buf.getvalue(), "application/zip")},
    )
    assert res.status_code == 200

    # 3. Reserved name redefinition -> 422 rejected
    pkg_redefined = ValidatedPackage(
        manifest=PackageManifest(
            format_version="ontocurator-work-package/v1",
            package_id="pkg-redef",
            created_at="2026-10-01T00:00:00Z",
            ontology=ontology_ref,
            axes_definition="editor-axes/v1",
            axes_config=AxesConfig(
                definition_name="editor-axes/v1",
                axes=[
                    AxisDefinition(id="custom_axis", label="Custom", options=["a", "b"])
                ],
            ),
        ),
        documents={"doc-1": doc},
    )
    buf = io.BytesIO()
    PackageWriter.write_to_stream(pkg_redefined, buf)
    res = client.post(
        "/api/v1/packages",
        files={"file": ("pkg.zip", buf.getvalue(), "application/zip")},
    )
    assert res.status_code == 422

    # 4. Reopening workspace on restarted server WITHOUT CLI fallback
    # retains saved configuration
    config_no_cli = AppConfig(
        workspace_dir=tmp_path,
        database_path=db_path,
        ontology_path=ontology_path,
        expected_ontology_ref=ontology_ref,
        session_token="token",
        axes_config=None,
    )
    app_no_cli = create_app(config_no_cli)
    client_no_cli = TestClient(app_no_cli, headers={"Authorization": "Bearer token"})

    res = client_no_cli.post(
        "/api/v1/workspaces/open",
        json={
            "package_id": "pkg-cli",
            "document_id": "doc-1",
            "annotator_id": "user-cli",
            "mode": "independent",
        },
    )
    assert res.status_code == 200
    view = res.json()["view"]
    assert view["axes_definition"] == "cli-profile/v1"
    assert view["axes_config"][0]["id"] == "urgency"
