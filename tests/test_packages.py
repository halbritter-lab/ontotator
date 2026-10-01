import hashlib
import zipfile
from pathlib import Path

import pytest

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
    EvidenceSnapshot,
    OntologyRef,
    Segment,
)
from hpo_editor.domain.errors import InvalidPackage
from hpo_editor.domain.review import ReviewDecision, ReviewTargetSet
from hpo_editor.domain.workspace import Submission, WorkspaceKey
from hpo_editor.packages.models import (
    PackageManifest,
    SearchEventRecord,
    ValidatedPackage,
)
from hpo_editor.packages.reader import read_package
from hpo_editor.packages.writer import write_package


def _create_sample_package() -> ValidatedPackage:
    text = "Patient displays hypotonia and absence seizures."
    doc = Document(
        document_id="doc-1",
        text=text,
        language="de",
        text_sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(),
    )
    ont = OntologyRef(release="2026-06-23", sha256="ont-sha-123")

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

    # Human annotation 1
    ann1 = Annotation(
        annotation_id="ann-1",
        document_id="doc-1",
        hpo_id="HP:0001252",
        axes=Axes(assertion="present", experiencer="patient", temporality="current"),
        evidence_refs=[EvidenceRef(evidence_id="ev-1", version=ev_snap1.version)],
        provenance=Provenance(
            actor=ActorRef(actor_id="dr-meier", kind="human"),
            method="manual",
        ),
    )
    snap1 = snapshot(ann1, [ev_snap1], doc, ont)

    # Tool annotation 2
    ann2 = Annotation(
        annotation_id="ann-2",
        document_id="doc-1",
        hpo_id="HP:0011146",
        axes=Axes(assertion="present", experiencer="patient", temporality="current"),
        evidence_refs=[EvidenceRef(evidence_id="ev-2", version=ev_snap2.version)],
        provenance=Provenance(
            actor=ActorRef(actor_id="model-nlp", kind="tool"),
            method="zero-shot-ner",
            assessment="high-confidence",
        ),
    )
    snap2 = snapshot(ann2, [ev_snap2], doc, ont)

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
        query="hypoton",
        route="lexical",
        candidates=["HP:0001252", "HP:0001250"],
        selected_hpo_id="HP:0001252",
        ranked_position=1,
        displayed_position=1,
        ontology_release="2026-06-23",
        index_identity="lex-v1-hash",
        timestamp="2026-10-01T19:50:00Z",
    )

    manifest = PackageManifest(
        package_id="pkg-test-1",
        format_version="hpo-editor-work-package/v1",
        ontology=ont,
        axes_definition="editor-axes/v1",
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
    assert loaded.manifest.ontology == pkg.manifest.ontology
    assert len(loaded.documents) == len(pkg.documents)
    assert set(loaded.annotations.keys()) == set(pkg.annotations.keys())
    assert set(loaded.evidence.keys()) == set(pkg.evidence.keys())
    assert set(loaded.submissions.keys()) == set(pkg.submissions.keys())
    assert len(loaded.search_events) == len(pkg.search_events)

    # Check mixed origin preservation
    human_ann = loaded.annotations[
        ("ann-1", next(k[1] for k in loaded.annotations if k[0] == "ann-1"))
    ]
    tool_ann = loaded.annotations[
        ("ann-2", next(k[1] for k in loaded.annotations if k[0] == "ann-2"))
    ]
    assert human_ann.annotation.provenance.actor.kind == "human"
    assert tool_ann.annotation.provenance.actor.kind == "tool"
    assert tool_ann.annotation.provenance.assessment == "high-confidence"


def test_package_preserves_multiple_versions_across_evidence_edit(
    tmp_path: Path,
) -> None:
    pkg = _create_sample_package()
    doc = next(iter(pkg.documents.values()))
    ont = pkg.manifest.ontology

    # Add a modified version of ann-1 with updated evidence
    ev_m1_v2 = EvidenceMention(
        evidence_id="ev-1",
        segments=[Segment(start=17, end=26), Segment(start=31, end=38)],
    )
    ev_snap1_v2 = EvidenceSnapshot.create(mention=ev_m1_v2, document=doc)

    ann1_v2 = Annotation(
        annotation_id="ann-1",
        document_id=doc.document_id,
        hpo_id="HP:0001252",
        axes=Axes(assertion="present", experiencer="patient", temporality="current"),
        evidence_refs=[EvidenceRef(evidence_id="ev-1", version=ev_snap1_v2.version)],
        provenance=Provenance(
            actor=ActorRef(actor_id="dr-meier", kind="human"),
            method="manual-correction",
        ),
    )
    snap1_v2 = snapshot(ann1_v2, [ev_snap1_v2], doc, ont)

    # Both versions of ann-1 and ev-1 exist in package
    pkg.annotations[(snap1_v2.annotation.annotation_id, snap1_v2.version)] = snap1_v2
    pkg.evidence[(ev_snap1_v2.mention.evidence_id, ev_snap1_v2.version)] = ev_snap1_v2

    pkg_file = tmp_path / "multi_version.zip"
    write_package(pkg, pkg_file)
    loaded = read_package(pkg_file)

    # Verify both versions of ev-1 and ann-1 survive
    ann1_versions = [k[1] for k in loaded.annotations if k[0] == "ann-1"]
    ev1_versions = [k[1] for k in loaded.evidence if k[0] == "ev-1"]
    assert len(ann1_versions) == 2
    assert len(ev1_versions) == 2


def test_package_rejects_corrupted_manifest_hash(tmp_path: Path) -> None:
    pkg = _create_sample_package()
    pkg_file = tmp_path / "corrupted_hash.zip"
    write_package(pkg, pkg_file)

    # Tamper with documents.jsonl inside zip
    with zipfile.ZipFile(pkg_file, "r") as z_in:
        files = {name: z_in.read(name) for name in z_in.namelist()}

    files["documents.jsonl"] = b'{"document_id":"tampered"}\n'

    corrupted_file = tmp_path / "tampered.zip"
    with zipfile.ZipFile(corrupted_file, "w") as z_out:
        for name, data in files.items():
            z_out.writestr(name, data)

    with pytest.raises(InvalidPackage, match="SHA-256 mismatch"):
        read_package(corrupted_file)


def test_package_rejects_path_traversal(tmp_path: Path) -> None:
    bad_zip = tmp_path / "traversal.zip"
    with zipfile.ZipFile(bad_zip, "w") as z_out:
        z_out.writestr("../etc/passwd", b"root:x:0:0")
        z_out.writestr("manifest.json", b"{}")

    with pytest.raises(InvalidPackage, match="Disallowed file in archive"):
        read_package(bad_zip)


def test_package_rejects_unknown_reference(tmp_path: Path) -> None:
    pkg = _create_sample_package()
    # Deliberately remove evidence required by ann-1
    pkg.evidence.clear()
    pkg_file = tmp_path / "missing_ref.zip"
    with pytest.raises(InvalidPackage, match="references missing evidence"):
        write_package(pkg, pkg_file)
