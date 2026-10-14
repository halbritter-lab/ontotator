import hashlib
import io
import socket
import zipfile
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from pg_harness import database_url_for
from typer.testing import CliRunner

from ontocurator.api.app import create_app
from ontocurator.cli import app as cli_app
from ontocurator.config import AppConfig
from ontocurator.domain.annotations import (
    ActorRef,
    Annotation,
    AnnotationRef,
    Provenance,
    snapshot,
)
from ontocurator.domain.documents import (
    Document,
    EvidenceMention,
    EvidenceRef,
    OntologyRef,
    Segment,
    snapshot_evidence,
)
from ontocurator.domain.profiles import (
    AnnotationTypeDefinition,
    AxisDefinition,
    LayerDefinition,
    OntologyDefinition,
    TaskProfile,
    profile_hash,
)
from ontocurator.domain.review import ReviewTargetSet
from ontocurator.packages.models import PackageManifest, ValidatedPackage
from ontocurator.packages.reader import PackageReader
from ontocurator.packages.writer import PackageWriter

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "hp.json"


def _make_ontology_ref() -> OntologyRef:
    raw = FIXTURE_PATH.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    return OntologyRef(release="2026-06-23", sha256=digest)


def _create_rich_synthetic_package(ontology_ref: OntologyRef) -> bytes:
    # Text with non-BMP emoji (👶🏽 - 4 codepoints: 👶 + 🏽),
    # combining mark (e + ́ = é), and newlines
    text = (
        "Patient shows hypotonia 👶🏽 and café-au-lait spots.\nSevere seizure observed."
    )
    text_digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    doc = Document(
        document_id="doc-rich",
        text=text,
        language="en",
        text_sha256=text_digest,
    )

    hp_ont = OntologyDefinition(
        ontology_id="hp",
        label="Human Phenotype Ontology",
        release=ontology_ref.release,
        sha256=ontology_ref.sha256,
        format="obo-graph-json",
        resource_path="ontologies/hp.json",
    )
    pheno_type = AnnotationTypeDefinition(
        type_id="phenotype",
        label="Phenotype",
        axes=[
            AxisDefinition(
                id="assertion",
                label="Assertion",
                options=["present", "absent", "uncertain"],
                allow_empty=True,
            )
        ],
        evidence_policy="optional",
    )
    layer = LayerDefinition(
        layer_id="hpo-layer",
        label="Phenotypes",
        ontology_id="hp",
        access="editable",
        default_visible=True,
        default_type_id="phenotype",
        annotation_types=[pheno_type],
    )
    profile = TaskProfile(
        profile_id="hpo-context-example/v1",
        version="1.0.0",
        ontologies=[hp_ont],
        layers=[layer],
        default_layer_id="hpo-layer",
    )

    # Human proposal for hypotonia (codepoints 14..23: "hypotonia")
    ev_human = snapshot_evidence(
        EvidenceMention(evidence_id="ev-human", segments=[Segment(start=14, end=23)]),
        doc,
    )
    ann_human = Annotation(
        annotation_id="prop-human",
        document_id="doc-rich",
        layer_id="hpo-layer",
        type_id="phenotype",
        term_id="HP:0001252",  # Hypotonia
        axes_values={"assertion": "present"},
        evidence_refs=[EvidenceRef(evidence_id="ev-human", version=ev_human.version)],
        provenance=Provenance(
            actor=ActorRef(actor_id="dr-carter", kind="human"),
            method="manual",
        ),
    )
    snap_human = snapshot(ann_human, [ev_human], doc, profile)

    # Tool proposal for seizure (codepoints 59..66: "seizure")
    ev_tool = snapshot_evidence(
        EvidenceMention(evidence_id="ev-tool", segments=[Segment(start=59, end=66)]),
        doc,
    )
    ann_tool = Annotation(
        annotation_id="prop-tool",
        document_id="doc-rich",
        layer_id="hpo-layer",
        type_id="phenotype",
        term_id="HP:0001250",  # Seizure
        axes_values={"assertion": "present"},
        evidence_refs=[EvidenceRef(evidence_id="ev-tool", version=ev_tool.version)],
        provenance=Provenance(
            actor=ActorRef(actor_id="nlp-pipeline-v2", kind="tool"),
            method="model_prediction",
        ),
    )
    snap_tool = snapshot(ann_tool, [ev_tool], doc, profile)

    pkg = ValidatedPackage(
        manifest=PackageManifest(
            package_id="pkg-offline-e2e",
            format_version="ontocurator-work-package/v2",
            document_order=["doc-rich"],
            task_profile=profile,
            task_profile_sha256=profile_hash(profile),
            created_at="2026-10-01T12:00:00Z",
        ),
        documents={"doc-rich": doc},
        annotations={
            (snap_human.annotation.annotation_id, snap_human.version): snap_human,
            (snap_tool.annotation.annotation_id, snap_tool.version): snap_tool,
        },
        evidence={
            (ev_human.mention.evidence_id, ev_human.version): ev_human,
            (ev_tool.mention.evidence_id, ev_tool.version): ev_tool,
        },
    )
    buf = io.BytesIO()
    PackageWriter.write_to_stream(pkg, buf)
    return buf.getvalue()


@pytest.fixture
def offline_network_guard(monkeypatch):
    """Enforce offline execution: deny any external network socket connections."""
    orig_connect = socket.socket.connect

    def guarded_connect(self, address):
        host = address[0] if isinstance(address, tuple) else address
        allowed = {"127.0.0.1", "localhost", "::1", "testclient"}
        if str(host) not in allowed:
            raise RuntimeError(
                "OFFLINE VIOLATION: Attempted network connection to external host: "
                f"{host}"
            )
        return orig_connect(self, address)

    monkeypatch.setattr(socket.socket, "connect", guarded_connect)
    return True


def test_static_asset_serving_and_default_path(tmp_path: Path):
    """Test that static web directory is mounted and serves index.html and assets."""
    web_dir = tmp_path / "web"
    web_dir.mkdir()
    index_file = web_dir / "index.html"
    index_file.write_text(
        "<!doctype html><html><body>HPO Editor</body></html>", encoding="utf-8"
    )

    assets_dir = web_dir / "assets"
    assets_dir.mkdir()
    js_file = assets_dir / "main.js"
    js_file.write_text("console.log('hpo');", encoding="utf-8")

    config = AppConfig(
        workspace_dir=tmp_path / "ws",
        database_url=database_url_for(tmp_path / "ws" / "test.db"),
        ontology_path=FIXTURE_PATH,
        expected_ontology_ref=_make_ontology_ref(),
        session_token="test-token",
        web_dir=web_dir,
    )
    app = create_app(config)
    client = TestClient(app)

    # Root serves index.html
    resp = client.get("/")
    assert resp.status_code == 200
    assert "HPO Editor" in resp.text
    assert "text/html" in resp.headers["content-type"]

    # Asset serves js
    resp = client.get("/assets/main.js")
    assert resp.status_code == 200
    assert "console.log('hpo')" in resp.text

    # API routes still work under /api/ with auth
    resp = client.get(
        "/api/v1/packages",
        headers={"Authorization": "Bearer test-token"},
    )
    assert resp.status_code == 200


def test_static_asset_serving_default_embedded_path(tmp_path: Path):
    """Test that when config.web_dir is None, create_app detects src/ontocurator/web."""
    config = AppConfig(
        workspace_dir=tmp_path / "ws",
        database_url=database_url_for(tmp_path / "ws" / "test.db"),
        ontology_path=FIXTURE_PATH,
        expected_ontology_ref=_make_ontology_ref(),
        session_token="test-token",
        web_dir=None,
    )
    app = create_app(config)
    client = TestClient(app)

    resp = client.get("/")
    assert resp.status_code == 200
    assert (
        "Ontocurator" in resp.text
        or "<!DOCTYPE html>" in resp.text
        or "<!doctype html>" in resp.text
    )


def test_offline_end_to_end_lifecycle(tmp_path: Path, offline_network_guard):
    """Comprehensive offline end-to-end lifecycle test:

    Import package -> Fetch Review Inputs (Human & Tool) -> Open Review Workspace ->
    Search Candidates -> Confirm Human proposal -> Create Counter Annotation ->
    Change Tool proposal with replacement -> Submit with Document Checked ->
    Restart Server -> Export Package -> Verify roundtrip integrity.
    """
    ont_ref = _make_ontology_ref()
    pkg_bytes = _create_rich_synthetic_package(ont_ref)

    ws_dir = tmp_path / "workspace"
    ws_dir.mkdir()
    db_path = ws_dir / "editor.db"

    config = AppConfig(
        workspace_dir=ws_dir,
        database_url=database_url_for(db_path),
        ontology_path=FIXTURE_PATH,
        expected_ontology_ref=ont_ref,
        session_token="lifecycle-token",
    )
    app = create_app(config)
    client = TestClient(app, headers={"Authorization": "Bearer lifecycle-token"})

    # 1. Import Package
    resp = client.post(
        "/api/v1/packages",
        files={"file": ("package.zip", pkg_bytes, "application/zip")},
    )
    assert resp.status_code == 200
    import_data = resp.json()
    pkg_id = import_data["package_id"]
    assert pkg_id == "pkg-offline-e2e"

    # 2. Fetch Review Inputs
    resp = client.post(
        "/api/v1/workspaces/review-inputs",
        json={
            "package_id": pkg_id,
            "document_id": "doc-rich",
            "annotator_id": "reviewer-alice",
            "mode": "review",
        },
    )
    assert resp.status_code == 200
    inputs = resp.json()
    assert len(inputs) == 2

    # Verify origin-neutrality: both human and tool inputs are present
    # and treated identically
    actor_kinds = {inp["annotation"]["provenance"]["actor"]["kind"] for inp in inputs}
    assert actor_kinds == {"human", "tool"}

    human_input = next(
        inp
        for inp in inputs
        if inp["annotation"]["provenance"]["actor"]["kind"] == "human"
    )
    tool_input = next(
        inp
        for inp in inputs
        if inp["annotation"]["provenance"]["actor"]["kind"] == "tool"
    )
    human_ref = {
        "annotation_id": human_input["annotation"]["annotation_id"],
        "version": human_input["version"],
    }
    tool_ref = {
        "annotation_id": tool_input["annotation"]["annotation_id"],
        "version": tool_input["version"],
    }

    # 3. Open Review Workspace
    target_set = ReviewTargetSet.create(
        [
            AnnotationRef(
                annotation_id=human_ref["annotation_id"], version=human_ref["version"]
            ),
            AnnotationRef(
                annotation_id=tool_ref["annotation_id"], version=tool_ref["version"]
            ),
        ]
    )
    resp = client.post(
        "/api/v1/workspaces/open",
        json={
            "package_id": pkg_id,
            "document_id": "doc-rich",
            "annotator_id": "reviewer-alice",
            "mode": "review",
            "targets": target_set.model_dump(),
        },
    )
    assert resp.status_code == 200
    ws_data = resp.json()
    ws_id = ws_data["workspace_id"]
    rev = ws_data["view"]["draft"]["revision"]
    assert rev == 0

    # 4. Search Candidates offline
    resp = client.post(
        "/api/v1/search",
        json={
            "workspace_key": {
                "package_id": pkg_id,
                "document_id": "doc-rich",
                "annotator_id": "reviewer-alice",
                "mode": "review",
                "target_set_id": target_set.target_set_id,
            },
            "annotation_id": "search-ann-1",
            "layer_id": "hpo-layer",
            "query": "hypotonia",
            "route": "id",
            "k": 5,
        },
    )
    assert resp.status_code == 200
    search_res = resp.json()
    assert "candidates" in search_res

    # 5. Decision 1: Confirm human proposal
    resp = client.post(
        f"/api/v1/workspaces/{ws_id}/decisions",
        json={
            "mutation_id": "mut-dec-1-confirm",
            "expected_revision": rev,
            "payload": {
                "target": human_ref,
                "outcome": "confirmed",
                "replacement": None,
                "note": "Agreed with human clinician",
            },
        },
    )
    assert resp.status_code == 200
    rev = resp.json()["revision"]

    # 6. Command: Create counter annotation for tool proposal
    resp = client.post(
        f"/api/v1/workspaces/{ws_id}/commands",
        json={
            "mutation_id": "mut-cmd-1-counter",
            "expected_revision": rev,
            "payload": {
                "command": "create_annotation",
                "annotation_id": "counter-seizure-1",
                "layer_id": "hpo-layer",
                "type_id": "phenotype",
                "term_id": "HP:0002133",  # Status epilepticus
                "axes": {"assertion": "present"},
                "evidence_id": "ev-tool",
                "segments": [{"start": 59, "end": 66}],
            },
        },
    )
    assert resp.status_code == 200
    draft_data = resp.json()
    rev = draft_data["revision"]
    created_snap = next(
        a
        for a in draft_data["annotations"]
        if a["annotation"]["annotation_id"] == "counter-seizure-1"
    )
    rep_ref = {
        "annotation_id": created_snap["annotation"]["annotation_id"],
        "version": created_snap["version"],
    }

    # 7. Decision 2: Change tool proposal with replacement
    resp = client.post(
        f"/api/v1/workspaces/{ws_id}/decisions",
        json={
            "mutation_id": "mut-dec-2-change",
            "expected_revision": rev,
            "payload": {
                "target": tool_ref,
                "outcome": "changed",
                "replacement": rep_ref,
                "note": "More specific term chosen",
            },
        },
    )
    assert resp.status_code == 200
    rev = resp.json()["revision"]

    # 8. Submit Workspace with checked_layer_ids
    resp = client.post(
        f"/api/v1/workspaces/{ws_id}/submit",
        json={
            "mutation_id": "mut-submit-1",
            "expected_revision": rev,
            "payload": {
                "checked_layer_ids": ["hpo-layer"],
            },
        },
    )
    assert resp.status_code == 200
    sub_data = resp.json()
    sub_id = sub_data["submission_id"]
    assert sub_id
    assert sub_data["checked_layer_ids"] == ["hpo-layer"]

    # 9. Simulate Server Restart: Reinitialize AppConfig and Database on same workspace
    config_restarted = AppConfig(
        workspace_dir=ws_dir,
        database_url=database_url_for(db_path),
        ontology_path=FIXTURE_PATH,
        expected_ontology_ref=ont_ref,
        session_token="restart-token",
    )
    app_restarted = create_app(config_restarted)
    client_restarted = TestClient(
        app_restarted, headers={"Authorization": "Bearer restart-token"}
    )

    # 10. Export Package
    resp = client_restarted.get(f"/api/v1/workspaces/{ws_id}/export")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"
    exported_bytes = resp.content

    # 11. Unpack and verify exported package
    buf = io.BytesIO(exported_bytes)
    assert zipfile.is_zipfile(buf)
    exported_pkg = PackageReader.read_from_stream(
        buf, registry=client_restarted.app.state.ontology_registry
    )

    # Verify Document and Unicode text preservation (emojis, accented characters)
    assert "doc-rich" in exported_pkg.documents
    doc_unpacked = exported_pkg.documents["doc-rich"]
    assert "👶🏽" in doc_unpacked.text
    assert "café-au-lait" in doc_unpacked.text
    expected_digest = hashlib.sha256(doc_unpacked.text.encode("utf-8")).hexdigest()
    assert doc_unpacked.text_sha256 == expected_digest

    # Verify submission and review decisions preserved
    assert sub_id in exported_pkg.submissions
    sub_entry = exported_pkg.submissions[sub_id]
    assert sub_entry.checked_layer_ids == ["hpo-layer"]
    assert len(sub_entry.decisions) == 2
    outcomes = {d.outcome for d in sub_entry.decisions}
    assert outcomes == {"confirmed", "changed"}


def test_cli_missing_ontology(tmp_path: Path):
    """Test CLI error handling when ontology file is missing."""
    runner = CliRunner()
    fake_ont = tmp_path / "nonexistent_hp.json"
    result = runner.invoke(
        cli_app,
        ["serve", "--workspace", str(tmp_path), "--ontology", str(fake_ont)],
    )
    assert result.exit_code == 1
    assert "Ontology file not found" in result.output


def test_cli_forbidden_host(tmp_path: Path):
    """Test CLI error handling when non-loopback host is provided."""
    runner = CliRunner()
    result = runner.invoke(
        cli_app,
        [
            "serve",
            "--workspace",
            str(tmp_path),
            "--ontology",
            str(FIXTURE_PATH),
            "--host",
            "0.0.0.0",
        ],
    )
    assert result.exit_code == 1
    assert "forbidden" in result.output


def test_cli_port_conflict(tmp_path: Path):
    """Test CLI error handling when specified port is already bound."""
    # Bind a port to simulate conflict
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    sock.listen(1)
    port = sock.getsockname()[1]

    runner = CliRunner()
    try:
        result = runner.invoke(
            cli_app,
            [
                "serve",
                "--workspace",
                str(tmp_path),
                "--ontology",
                str(FIXTURE_PATH),
                "--port",
                str(port),
            ],
        )
        assert result.exit_code == 1
        assert (
            "Port" in result.output
            or "already in use" in result.output
            or "Error" in result.output
        )
    finally:
        sock.close()


def test_cli_workspace_path_with_spaces(tmp_path: Path):
    """Test CLI handling of workspace directory containing spaces."""
    spaced_dir = tmp_path / "Directory With Spaces"
    spaced_dir.mkdir()

    with (
        patch("ontocurator.cli.run_server") as mock_run_server,
        patch("ontocurator.cli._open_browser"),
    ):
        runner = CliRunner()
        result = runner.invoke(
            cli_app,
            [
                "serve",
                "--workspace",
                str(spaced_dir),
                "--ontology",
                str(FIXTURE_PATH),
                "--port",
                "0",
                "--no-browser",
            ],
        )
        assert result.exit_code == 0
        assert mock_run_server.called
        assert mock_run_server.call_args[0][0].state.config.workspace_dir == (
            spaced_dir.resolve()
        )
