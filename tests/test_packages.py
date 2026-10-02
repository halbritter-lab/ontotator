import hashlib
import json
import zipfile
from pathlib import Path

import pytest

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
    EvidenceSnapshot,
    Segment,
)
from ontocurator.domain.errors import DomainError, InvalidPackage
from ontocurator.domain.profiles import (
    AnnotationTypeDefinition,
    AxisDefinition,
    LayerDefinition,
    OntologyDefinition,
    TaskProfile,
    profile_hash,
)
from ontocurator.domain.review import ReviewDecision, ReviewTargetSet
from ontocurator.domain.workspace import Submission, WorkspaceKey
from ontocurator.ontology.registry import OntologyRegistry
from ontocurator.packages.models import (
    PackageManifest,
    SearchEventRecord,
    ValidatedPackage,
)
from ontocurator.packages.reader import read_package
from ontocurator.packages.writer import write_package


def _create_sample_profile() -> TaskProfile:
    ont = OntologyDefinition(
        ontology_id="hp",
        label="Human Phenotype Ontology",
        release="2026-06-23",
        sha256="279123a1ae5314e4632a0f85be2d82efd50f44ebf0d98e0100ed6859d7cb83e4",
        format="obo-graph-json",
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
    return TaskProfile(
        profile_id="hpo-context-example/v1",
        version="1.0.0",
        ontologies=[ont],
        layers=[layer],
        default_layer_id="hpo-layer",
    )


def _create_sample_package(profile: TaskProfile | None = None) -> ValidatedPackage:
    text = "Patient displays hypotonia and absence seizures."
    doc = Document(
        document_id="doc-1",
        text=text,
        language="de",
        text_sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(),
    )
    if profile is None:
        profile = _create_sample_profile()

    # Evidence 1
    ev_m1 = EvidenceMention(
        evidence_id="ev-1",
        segments=[Segment(start=17, end=26)],  # hypotonia
    )
    ev_snap1 = EvidenceSnapshot.create(mention=ev_m1, document=doc)

    # Evidence 2
    ev_m2 = EvidenceMention(
        evidence_id="ev-2",
        segments=[Segment(start=31, end=47)],  # absence seizures
    )
    ev_snap2 = EvidenceSnapshot.create(mention=ev_m2, document=doc)

    # Annotation 1
    ann1 = Annotation(
        annotation_id="ann-1",
        document_id="doc-1",
        layer_id="hpo-layer",
        type_id="phenotype",
        term_id="HP:0001252",
        axes_values={"assertion": "present"},
        evidence_refs=[EvidenceRef(evidence_id="ev-1", version=ev_snap1.version)],
        provenance=Provenance(
            actor=ActorRef(actor_id="dr-meier", kind="human"),
            method="manual",
        ),
    )
    snap1 = snapshot(ann1, [ev_snap1], doc, profile)

    # Annotation 2
    ann2 = Annotation(
        annotation_id="ann-2",
        document_id="doc-1",
        layer_id="hpo-layer",
        type_id="phenotype",
        term_id="HP:0011146",
        axes_values={"assertion": "present"},
        evidence_refs=[EvidenceRef(evidence_id="ev-2", version=ev_snap2.version)],
        provenance=Provenance(
            actor=ActorRef(actor_id="model-nlp", kind="tool"),
            method="zero-shot-ner",
            assessment="high-confidence",
        ),
    )
    snap2 = snapshot(ann2, [ev_snap2], doc, profile)

    target_set = ReviewTargetSet.create(
        [
            AnnotationRef(annotation_id="ann-1", version=snap1.version),
            AnnotationRef(annotation_id="ann-2", version=snap2.version),
        ]
    )

    ws_key = WorkspaceKey(
        package_id="pkg-test-1",
        document_id="doc-1",
        annotator_id="dr-meier",
        mode="review",
        target_set_id=target_set.target_set_id,
    )

    submission = Submission(
        submission_id="sub-1",
        origin_key=ws_key,
        targets=target_set,
        draft_revision=3,
        snapshots=[snap1, snap2],
        decisions=[
            ReviewDecision(
                decision_id="dec-1",
                target=AnnotationRef(annotation_id="ann-1", version=snap1.version),
                outcome="confirmed",
                reviewer_id="dr-meier",
            ),
            ReviewDecision(
                decision_id="dec-2",
                target=AnnotationRef(annotation_id="ann-2", version=snap2.version),
                outcome="confirmed",
                reviewer_id="dr-meier",
            ),
        ],
        document_checked=True,
        created_at="2026-10-01T20:00:00Z",
    )

    search_ev = SearchEventRecord(
        event_id="ev-search-1",
        workspace_key=ws_key,
        annotation_id="ann-1",
        layer_id="hpo-layer",
        ontology_sha256=profile.ontologies[0].sha256,
        query="hypoton",
        route="lexical",
        candidates=["HP:0001252", "HP:0001250"],
        selected_term_id="HP:0001252",
        ranked_position=1,
        displayed_position=1,
        ontology_release="2026-06-23",
        index_identity="lex-v1-hash",
        timestamp="2026-10-01T19:50:00Z",
    )

    manifest = PackageManifest(
        package_id="pkg-test-1",
        format_version="ontocurator-work-package/v2",
        document_order=["doc-1"],
        task_profile=profile,
        task_profile_sha256=profile_hash(profile),
        file_hashes={},  # populated on write
        created_at="2026-10-01T20:00:00Z",
    )

    return ValidatedPackage(
        manifest=manifest,
        documents={doc.document_id: doc},
        annotations={
            (snap1.annotation.annotation_id, snap1.version): snap1,
            (snap2.annotation.annotation_id, snap2.version): snap2,
        },
        evidence={
            (ev_snap1.mention.evidence_id, ev_snap1.version): ev_snap1,
            (ev_snap2.mention.evidence_id, ev_snap2.version): ev_snap2,
        },
        submissions={submission.submission_id: submission},
        search_events=[search_ev],
    )


def test_package_roundtrip(tmp_path: Path) -> None:
    pkg = _create_sample_package()
    pkg_file = tmp_path / "work_package.zip"

    write_package(pkg, pkg_file)
    loaded = read_package(pkg_file)

    assert loaded.manifest.package_id == pkg.manifest.package_id
    assert loaded.manifest.format_version == "ontocurator-work-package/v2"
    assert loaded.manifest.document_order == ["doc-1"]
    assert len(loaded.documents) == len(pkg.documents)
    assert set(loaded.annotations.keys()) == set(pkg.annotations.keys())
    assert set(loaded.evidence.keys()) == set(pkg.evidence.keys())
    assert set(loaded.submissions.keys()) == set(pkg.submissions.keys())
    assert len(loaded.search_events) == len(pkg.search_events)


def test_package_rejects_legacy_v1_format(tmp_path: Path) -> None:
    pkg = _create_sample_package()
    pkg_file = tmp_path / "pkg.zip"
    write_package(pkg, pkg_file)

    # Tamper with manifest format_version to simulate legacy v1 package
    with zipfile.ZipFile(pkg_file, "r") as z_in:
        files = {name: z_in.read(name) for name in z_in.namelist()}

    manifest_dict = json.loads(files["manifest.json"].decode("utf-8"))
    manifest_dict["format_version"] = "ontocurator-work-package/v1"
    files["manifest.json"] = json.dumps(manifest_dict).encode("utf-8")

    tampered_file = tmp_path / "tampered_v1.zip"
    with zipfile.ZipFile(tampered_file, "w") as z_out:
        for name, data in files.items():
            z_out.writestr(name, data)

    with pytest.raises(
        InvalidPackage, match="only 'ontocurator-work-package/v2' is supported"
    ):
        read_package(tampered_file)


def test_package_rejects_duplicate_or_mismatched_document_order(tmp_path: Path) -> None:
    pkg = _create_sample_package()
    pkg_file = tmp_path / "pkg.zip"
    write_package(pkg, pkg_file)

    with zipfile.ZipFile(pkg_file, "r") as z_in:
        files = {name: z_in.read(name) for name in z_in.namelist()}

    # 1. Duplicate doc ID in document_order
    manifest_dup = json.loads(files["manifest.json"].decode("utf-8"))
    manifest_dup["document_order"] = ["doc-1", "doc-1"]
    files_dup = dict(files)
    files_dup["manifest.json"] = json.dumps(manifest_dup).encode("utf-8")
    p_dup = tmp_path / "dup.zip"
    with zipfile.ZipFile(p_dup, "w") as z_out:
        for name, data in files_dup.items():
            z_out.writestr(name, data)
    with pytest.raises(InvalidPackage, match="Duplicate document IDs"):
        read_package(p_dup)

    # 2. Missing doc ID in document_order
    manifest_missing = json.loads(files["manifest.json"].decode("utf-8"))
    manifest_missing["document_order"] = ["other-doc"]
    files_missing = dict(files)
    files_missing["manifest.json"] = json.dumps(manifest_missing).encode("utf-8")
    p_mis = tmp_path / "mis.zip"
    with zipfile.ZipFile(p_mis, "w") as z_out:
        for name, data in files_missing.items():
            z_out.writestr(name, data)
    with pytest.raises(InvalidPackage, match="document_order mismatch"):
        read_package(p_mis)


def test_package_rejects_disallowed_and_path_traversal_files(tmp_path: Path) -> None:
    pkg = _create_sample_package()
    pkg_file = tmp_path / "pkg.zip"
    write_package(pkg, pkg_file)

    with zipfile.ZipFile(pkg_file, "r") as z_in:
        files = {name: z_in.read(name) for name in z_in.namelist()}

    # 1. Path traversal entry
    files_traversal = dict(files)
    files_traversal["../evil.json"] = b"{}"
    p_trav = tmp_path / "trav.zip"
    with zipfile.ZipFile(p_trav, "w") as z_out:
        for name, data in files_traversal.items():
            z_out.writestr(name, data)
    with pytest.raises(InvalidPackage, match="path traversal"):
        read_package(p_trav)

    # 2. Unknown disallowed file
    files_disallowed = dict(files)
    files_disallowed["unauthorized.txt"] = b"secret"
    p_dis = tmp_path / "dis.zip"
    with zipfile.ZipFile(p_dis, "w") as z_out:
        for name, data in files_disallowed.items():
            z_out.writestr(name, data)
    with pytest.raises(InvalidPackage, match="Disallowed file"):
        read_package(p_dis)


def test_package_rejects_corrupted_manifest_hash(tmp_path: Path) -> None:
    pkg = _create_sample_package()
    pkg_file = tmp_path / "pkg.zip"
    write_package(pkg, pkg_file)

    with zipfile.ZipFile(pkg_file, "r") as z_in:
        files = {name: z_in.read(name) for name in z_in.namelist()}

    # Tamper with documents.jsonl
    files["documents.jsonl"] = b'{"document_id":"tampered"}\n'
    p_tampered = tmp_path / "tampered.zip"
    with zipfile.ZipFile(p_tampered, "w") as z_out:
        for name, data in files.items():
            z_out.writestr(name, data)

    with pytest.raises(InvalidPackage, match="File SHA-256 mismatch"):
        read_package(p_tampered)


def test_package_embedded_ontology_resource_validation(tmp_path: Path) -> None:
    raw_obo = b'{"graphs": []}'
    obo_digest = hashlib.sha256(raw_obo).hexdigest()
    profile = _create_sample_profile()
    profile.ontologies[0].resource_path = "ontologies/hp.json"
    profile.ontologies[0].sha256 = obo_digest

    pkg = _create_sample_package(profile=profile)

    # 1. Package written with embedded ontology passes validation
    pkg_file = tmp_path / "embedded.zip"
    write_package(pkg, pkg_file, embedded_files={"ontologies/hp.json": raw_obo})
    loaded = read_package(pkg_file)
    assert (
        loaded.manifest.task_profile.ontologies[0].resource_path == "ontologies/hp.json"
    )

    # 2. Package with mismatched embedded ontology SHA-256 is rejected
    with zipfile.ZipFile(pkg_file, "r") as z_in:
        files = {name: z_in.read(name) for name in z_in.namelist()}

    files["ontologies/hp.json"] = b'{"graphs": [{"tampered": true}]}'
    # Also update file_hashes so the outer archive check passes but the ontology check fails
    manifest_dict = json.loads(files["manifest.json"].decode("utf-8"))
    manifest_dict["file_hashes"]["ontologies/hp.json"] = hashlib.sha256(
        files["ontologies/hp.json"]
    ).hexdigest()
    files["manifest.json"] = json.dumps(manifest_dict).encode("utf-8")

    bad_ont_file = tmp_path / "bad_ont.zip"
    with zipfile.ZipFile(bad_ont_file, "w") as z_out:
        for name, data in files.items():
            z_out.writestr(name, data)

    with pytest.raises(
        InvalidPackage, match="Embedded ontology resource SHA-256 mismatch"
    ):
        read_package(bad_ont_file)


def test_package_missing_external_ontology_reported_together(tmp_path: Path) -> None:
    pkg = _create_sample_package()
    pkg_file = tmp_path / "pkg.zip"
    write_package(pkg, pkg_file)

    # Registry has no ontologies registered -> read_package reports missing ontology
    empty_registry = OntologyRegistry()
    with pytest.raises(DomainError, match="Missing required external ontologies"):
        read_package(pkg_file, registry=empty_registry)
