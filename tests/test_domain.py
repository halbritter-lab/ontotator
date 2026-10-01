import hashlib

import pytest

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
    EvidenceSnapshot,
    OntologyRef,
    Segment,
    validate_segments,
)
from ontocurator.domain.errors import (
    InvalidAnnotation,
)
from ontocurator.domain.review import ReviewDecision, ReviewTargetSet


def test_codepoint_offsets() -> None:
    text = "A😀e\u0301\r\nB"
    # Codepoints:
    # 0: 'A'
    # 1: '😀' (U+1F600, SMP character)
    # 2: 'e'
    # 3: '\u0301' (combining acute)
    # 4: '\r'
    # 5: '\n'
    # 6: 'B'
    assert text[1:2] == "😀"
    assert len(text) == 7

    # Valid segment on codepoints [1, 2)
    seg = Segment(start=1, end=2)
    assert text[seg.start : seg.end] == "😀"

    mention = EvidenceMention(evidence_id="ev-1", segments=[seg])
    validate_segments(text, [mention])

    # Rejection of empty/negative/out-of-bounds segments
    with pytest.raises(InvalidAnnotation, match="empty or inverted"):
        Segment(start=2, end=2)
    with pytest.raises(InvalidAnnotation, match="negative"):
        Segment(start=-1, end=2)

    with pytest.raises(InvalidAnnotation, match="out of bounds"):
        validate_segments(
            text,
            [EvidenceMention(evidence_id="ev-2", segments=[Segment(start=0, end=10)])],
        )


def test_unknown_axes_remain_null() -> None:
    axes = Axes(assertion=None, experiencer=None, temporality=None)
    assert axes.assertion is None
    assert axes.experiencer is None
    assert axes.temporality is None
    assert axes.definition_name == "editor-axes/v1"

    # Strictness: invalid axis values rejected
    with pytest.raises(ValueError):
        Axes(assertion="definitely_true")  # type: ignore[arg-type]


def test_origin_does_not_change_validation() -> None:
    doc_text = "Patient has severe hypotonia."
    doc = Document(
        document_id="doc-1",
        text=doc_text,
        language="de",
        text_sha256=hashlib.sha256(doc_text.encode("utf-8")).hexdigest(),
    )
    ont = OntologyRef(release="2026-06-23", sha256="dummy-sha")

    human_prov = Provenance(
        actor=ActorRef(actor_id="dr-smith", kind="human"),
        method="manual-annotation",
        source_refs=[],
    )
    tool_prov = Provenance(
        actor=ActorRef(actor_id="llm-extractor-v1", kind="tool"),
        method="zero-shot-ner",
        source_refs=[],
        assessment="uncertain",
    )

    ev_seg = Segment(start=19, end=28)
    mention = EvidenceMention(evidence_id="ev-1", segments=[ev_seg])
    ev_snap = EvidenceSnapshot.create(mention=mention, document=doc)

    human_ann = Annotation(
        annotation_id="ann-1",
        document_id="doc-1",
        hpo_id="HP:0001252",
        axes=Axes(assertion="present", experiencer="patient", temporality="current"),
        evidence_refs=[EvidenceRef(evidence_id="ev-1", version=ev_snap.version)],
        provenance=human_prov,
    )

    tool_ann = Annotation(
        annotation_id="ann-2",
        document_id="doc-1",
        hpo_id="HP:0001252",
        axes=Axes(assertion="present", experiencer="patient", temporality="current"),
        evidence_refs=[EvidenceRef(evidence_id="ev-1", version=ev_snap.version)],
        provenance=tool_prov,
    )

    # Both snapshot successfully with same structure and rules
    snap_human = snapshot(human_ann, [ev_snap], doc, ont)
    snap_tool = snapshot(tool_ann, [ev_snap], doc, ont)

    assert snap_human.annotation.hpo_id == snap_tool.annotation.hpo_id
    assert snap_human.annotation.axes == snap_tool.annotation.axes
    assert (
        snap_human.evidence[0].mention.segments
        == snap_tool.evidence[0].mention.segments
    )


def test_evidence_edit_changes_version_not_id() -> None:
    doc_text = "Child exhibits hypotonia and lethargy."
    doc = Document(
        document_id="doc-1",
        text=doc_text,
        language="de",
        text_sha256=hashlib.sha256(doc_text.encode("utf-8")).hexdigest(),
    )
    ont = OntologyRef(release="2026-06-23", sha256="dummy-sha")

    mention_v1 = EvidenceMention(
        evidence_id="ev-stable-1",
        segments=[Segment(start=15, end=24)],  # "hypotonia"
    )
    ev_snap_v1 = EvidenceSnapshot.create(mention=mention_v1, document=doc)

    ann = Annotation(
        annotation_id="ann-stable-1",
        document_id="doc-1",
        hpo_id="HP:0001252",
        axes=Axes(assertion="present", experiencer="patient", temporality="current"),
        evidence_refs=[
            EvidenceRef(evidence_id="ev-stable-1", version=ev_snap_v1.version)
        ],
        provenance=Provenance(
            actor=ActorRef(actor_id="curator", kind="human"),
            method="manual",
            source_refs=[],
        ),
    )

    snap_before = snapshot(ann, [ev_snap_v1], doc, ont)

    # Now edit evidence: extend mention with second segment
    mention_v2 = EvidenceMention(
        evidence_id="ev-stable-1",
        segments=[Segment(start=15, end=24), Segment(start=29, end=37)],  # + "lethargy"
    )
    ev_snap_v2 = EvidenceSnapshot.create(mention=mention_v2, document=doc)
    assert ev_snap_v2.mention.evidence_id == ev_snap_v1.mention.evidence_id
    assert ev_snap_v2.version != ev_snap_v1.version

    ann_after = ann.model_copy(
        update={
            "evidence_refs": [
                EvidenceRef(evidence_id="ev-stable-1", version=ev_snap_v2.version)
            ]
        }
    )
    snap_after = snapshot(ann_after, [ev_snap_v2], doc, ont)

    # Core assertions:
    assert snap_before.annotation.annotation_id == snap_after.annotation.annotation_id
    assert snap_before.version != snap_after.version
    assert (
        snap_before.evidence[0].mention.evidence_id
        == snap_after.evidence[0].mention.evidence_id
    )
    assert snap_before.evidence[0].version != snap_after.evidence[0].version


def test_review_decision_and_target_set() -> None:
    t1 = AnnotationRef(annotation_id="ann-1", version="hash1")
    t2 = AnnotationRef(annotation_id="ann-2", version="hash2")
    target_set = ReviewTargetSet.create([t2, t1])  # should sort stably
    assert target_set.targets == [t1, t2]
    assert len(target_set.target_set_id) == 64

    # Outcome requirements
    dec_confirm = ReviewDecision(
        decision_id="dec-1",
        target=t1,
        outcome="confirmed",
        reviewer_id="rev-1",
    )
    assert dec_confirm.replacement is None

    # Changed requires replacement
    with pytest.raises(InvalidAnnotation, match="replacement"):
        ReviewDecision(
            decision_id="dec-2",
            target=t1,
            outcome="changed",
            replacement=None,
            reviewer_id="rev-1",
        )

    # Confirmed does not allow replacement
    with pytest.raises(InvalidAnnotation, match="replacement"):
        ReviewDecision(
            decision_id="dec-3",
            target=t1,
            outcome="confirmed",
            replacement=AnnotationRef(annotation_id="ann-3", version="hash3"),
            reviewer_id="rev-1",
        )


def test_legacy_snapshot_wire_and_hash_unchanged() -> None:
    from ontocurator.domain.serialization import (
        decode_snapshot,
        encode_snapshot,
        verify_snapshot,
    )

    legacy_raw = {
        "annotation": {
            "annotation_id": "ann-leg-1",
            "document_id": "doc-1",
            "hpo_id": "HP:0001252",
            "axes": {
                "definition_name": "editor-axes/v1",
                "assertion": None,
                "experiencer": None,
                "temporality": None,
            },
            "evidence_refs": [],
            "provenance": {
                "actor": {"actor_id": "curator", "kind": "human"},
                "method": "manual",
                "source_refs": [],
                "assessment": None,
            },
        },
        "evidence": [],
        "document_id": "doc-1",
        "ontology_sha256": "ont-sha-1",
        "text_sha256": "text-sha-1",
    }
    # Compute legacy hash
    from ontocurator.domain.canonical import canonical_hash

    expected_hash = canonical_hash(legacy_raw)
    legacy_raw["version"] = expected_hash

    snap = decode_snapshot(legacy_raw)
    assert snap.version == expected_hash
    # Normalized views exposed
    assert snap.annotation.term_id == "HP:0001252"
    assert snap.annotation.hpo_id == "HP:0001252"
    assert snap.annotation.axes.values.get("assertion") is None

    # Wire encoding preserves original representation
    encoded = encode_snapshot(snap)
    assert "schema_version" not in encoded
    assert encoded["annotation"]["hpo_id"] == "HP:0001252"
    assert encoded["version"] == expected_hash
    verify_snapshot(snap)


def test_new_snapshot_binds_profile_digest() -> None:
    from ontocurator.domain.axes import AxesConfig, AxisDefinition
    from ontocurator.domain.serialization import (
        verify_snapshot,
    )

    doc_text = "Sample text"
    doc = Document(
        document_id="doc-1",
        text=doc_text,
        language="de",
        text_sha256=hashlib.sha256(doc_text.encode("utf-8")).hexdigest(),
    )
    ont = OntologyRef(release="2026-06-23", sha256="ont-hash")
    ann = Annotation(
        annotation_id="ann-new-1",
        document_id="doc-1",
        term_id="MONDO:0000001",
        axes=Axes(definition_name="custom/v1", values={"severity": "mild"}),
        provenance=Provenance(
            actor=ActorRef(actor_id="curator", kind="human"), method="manual"
        ),
    )
    custom_profile = AxesConfig(
        definition_name="custom/v1",
        axes=[
            AxisDefinition(id="severity", label="Severity", options=["mild", "severe"])
        ],
    )
    snap = snapshot(ann, [], doc, ont, axes_config=custom_profile)
    assert snap.schema_version == "ontocurator-annotation/v2"
    assert snap.axes_config_sha256 == custom_profile.config_sha256
    verify_snapshot(snap)

    # Tampering with term fails verification
    tampered_ann = snap.model_copy(deep=True)
    tampered_ann.annotation.term_id = "MONDO:0000002"
    with pytest.raises(InvalidAnnotation, match="HASH_MISMATCH"):
        verify_snapshot(tampered_ann)

    # Tampering with axes_config_sha256 fails verification
    tampered_prof = snap.model_copy(deep=True)
    tampered_prof.axes_config_sha256 = "wrong-digest"
    with pytest.raises(InvalidAnnotation, match="HASH_MISMATCH"):
        verify_snapshot(tampered_prof)


def test_conflicting_term_aliases_rejected() -> None:
    with pytest.raises(ValueError, match="Conflicting"):
        Annotation.model_validate(
            {
                "annotation_id": "ann-c-1",
                "document_id": "doc-1",
                "term_id": "MONDO:0000001",
                "hpo_id": "HP:0001252",
                "provenance": {
                    "actor": {"actor_id": "c", "kind": "human"},
                    "method": "m",
                },
            }
        )


def test_unknown_snapshot_schema_rejected() -> None:
    from ontocurator.domain.serialization import decode_snapshot

    bad_raw = {
        "schema_version": "future-schema/v999",
        "version": "dummy-hash",
        "annotation": {
            "annotation_id": "ann-bad-1",
            "document_id": "doc-1",
            "term_id": "HP:0001252",
            "axes": {"definition_name": "clinical-phenotype/v1", "values": {}},
            "provenance": {
                "actor": {"actor_id": "c", "kind": "human"},
                "method": "m",
            },
        },
        "evidence": [],
        "document_id": "doc-1",
        "ontology_sha256": "ont-sha-1",
        "text_sha256": "text-sha-1",
        "axes_config_sha256": "prof-sha-1",
    }
    with pytest.raises(InvalidAnnotation, match="Unknown snapshot schema"):
        decode_snapshot(bad_raw)
