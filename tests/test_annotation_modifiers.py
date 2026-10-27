"""Finding modifiers in the data model (finding-modifiers spec "Data model and
content hash", R1, R11).

Pure: no database. Empty modifiers stay out of the content hash, so every
existing version and submission id is unchanged (pasted literals below).
"""

from __future__ import annotations

import hashlib

import pytest

from ontotator.domain.annotations import (
    ActorRef,
    Annotation,
    AnnotationSnapshot,
    Modifier,
    Provenance,
    annotation_content,
    snapshot,
)
from ontotator.domain.axes import AxisDefinition
from ontotator.domain.canonical import canonical_hash
from ontotator.domain.documents import (
    Document,
    EvidenceMention,
    EvidenceRef,
    EvidenceSnapshot,
    Segment,
)
from ontotator.domain.errors import InvalidAnnotation
from ontotator.domain.profiles import (
    AnnotationTypeDefinition,
    LayerDefinition,
    OntologyDefinition,
    TaskProfile,
)
from ontotator.domain.review import ReviewTargetSet
from ontotator.domain.scopes import build_scope
from ontotator.domain.serialization import (
    decode_snapshot,
    encode_snapshot,
    verify_snapshot,
)
from ontotator.domain.workspace import WorkspaceKey

TEXT = "Seit 2 Wochen wiederholt schwere Krampfanfälle und eine Muskelhypotonie."
DOCUMENT = Document(
    document_id="doc-1",
    text=TEXT,
    language="de",
    text_sha256=hashlib.sha256(TEXT.encode("utf-8")).hexdigest(),
)
# Own axis definitions (never STANDARD_CLINICAL_AXES, whose config hash moves).
PROFILE = TaskProfile(
    profile_id="modifier-golden/v1",
    version="1.0.0",
    ontologies=[
        OntologyDefinition(
            ontology_id="hp",
            label="Human Phenotype Ontology",
            release="2026-06-23",
            sha256="a" * 64,
        )
    ],
    layers=[
        LayerDefinition(
            layer_id="hpo-layer",
            label="Phenotypes",
            ontology_id="hp",
            access="editable",
            default_type_id="phenotype",
            annotation_types=[
                AnnotationTypeDefinition(
                    type_id="phenotype",
                    label="Phenotype",
                    axes=[
                        AxisDefinition(
                            id="assertion",
                            label="Assertion",
                            options=["present", "absent", "uncertain"],
                        ),
                        AxisDefinition(
                            id="experiencer",
                            label="Experiencer",
                            options=["patient", "other"],
                        ),
                    ],
                )
            ],
        )
    ],
    default_layer_id="hpo-layer",
)
PROVENANCE = Provenance(actor=ActorRef(actor_id="ana", kind="human"), method="manual")


def at(word: str) -> Segment:
    start = TEXT.index(word)
    return Segment(start=start, end=start + len(word))


def mention(evidence_id: str, *words: str) -> EvidenceSnapshot:
    return EvidenceSnapshot.create(
        EvidenceMention(evidence_id=evidence_id, segments=[at(w) for w in words]),
        DOCUMENT,
    )


def golden_snapshots() -> list[AnnotationSnapshot]:
    spanless = Annotation(
        annotation_id="a-1",
        document_id="doc-1",
        term_id="HP:0001250",
        axes_values={"assertion": "present", "experiencer": None},
        provenance=PROVENANCE,
    )
    one = mention("ev-1", "Krampfanfälle")
    defaulted = Annotation(
        annotation_id="a-2",
        document_id="doc-1",
        term_id="HP:0001250",
        axes_values={"assertion": "present", "experiencer": "patient"},
        axes_defaulted=["experiencer"],
        evidence_refs=[EvidenceRef(evidence_id="ev-1", version=one.version)],
        provenance=PROVENANCE,
    )
    two = [mention("ev-2", "Muskelhypotonie"), mention("ev-3", "schwere")]
    noted = Annotation(
        annotation_id="a-3",
        document_id="doc-1",
        term_id="HP:0001252",
        axes_values={"assertion": "uncertain"},
        note="Nur leicht ausgeprägt",
        evidence_refs=[
            EvidenceRef(evidence_id=e.mention.evidence_id, version=e.version)
            for e in two
        ],
        provenance=PROVENANCE,
    )
    return [
        snapshot(spanless, [], DOCUMENT, PROFILE),
        snapshot(defaulted, [one], DOCUMENT, PROFILE),
        snapshot(noted, two, DOCUMENT, PROFILE),
    ]


def submission_hash(snaps: list[AnnotationSnapshot]) -> str:
    """The submission content hash, built like ``_create_submission``."""
    key = WorkspaceKey(
        project_key="proj-1",
        document_id="doc-1",
        annotator_id="ana",
        mode="independent",
        target_set_id="ts-empty",
    )
    content = {
        "key": key.model_dump(),
        "scope": build_scope(PROFILE, "independent").model_dump(),
        "targets": ReviewTargetSet.create([]).model_dump(),
        "draft_revision": 3,
        "snapshots": [s.version for s in snaps],
        "decisions": [],
    }
    return canonical_hash(content)


def test_existing_versions_and_submission_id_are_unchanged() -> None:
    snaps = golden_snapshots()
    assert [s.version for s in snaps] == [
        "a1607853816ca25a497bb85707e8e4ed623508d9e6aae4eace94121cf4ba15cd",
        "1517833cdcded1418b4687aaab19f137cf1a8b8eb55926ec497d4a5252fb5378",
        "46ce291836dc511a077f4ffe0cdc496207bd149d46fe0506d20e53d6dd5a04b0",
    ]
    assert submission_hash(snaps) == (
        "a04f3af5773368d1527d042d88dce187ca2e36e327852762ace89448eadfc771"
    )


SEVERE, RECURRENT = "HP:0012828", "HP:0031796"


def finding(modifiers: list[Modifier], **kw: object) -> Annotation:
    return Annotation(
        annotation_id="a-9",
        document_id="doc-1",
        term_id="HP:0001250",
        provenance=PROVENANCE,
        modifiers=modifiers,
        **kw,  # type: ignore[arg-type]
    )


def seg(start: int, end: int) -> Segment:
    return Segment(start=start, end=end)


def test_modifiers_and_segments_are_sorted() -> None:
    annotation = finding(
        [
            Modifier(term_id=SEVERE, segments=[seg(30, 32), seg(25, 28)]),
            Modifier(term_id=RECURRENT),
            Modifier(term_id="HP:0012825"),
        ]
    )
    assert [m.term_id for m in annotation.modifiers] == [
        "HP:0012825",
        SEVERE,
        RECURRENT,
    ]
    assert annotation.modifiers[1].segments == [seg(25, 28), seg(30, 32)]


def test_duplicate_modifier_term_is_refused() -> None:
    with pytest.raises(InvalidAnnotation, match="Duplicate modifier term 'HP:0012828'"):
        finding([Modifier(term_id=SEVERE), Modifier(term_id=SEVERE)])


def test_invalid_modifier_curie_is_refused() -> None:
    with pytest.raises(InvalidAnnotation, match="modifier"):
        finding([Modifier(term_id="not a curie")])


def test_overlapping_segments_of_one_modifier_are_refused() -> None:
    with pytest.raises(InvalidAnnotation, match="Modifier segments overlap"):
        finding([Modifier(term_id=SEVERE, segments=[seg(25, 30), seg(29, 32)])])


def test_overlap_between_modifiers_and_with_the_mention_is_allowed() -> None:
    ev = mention("ev-1", "schwere Krampfanfälle")
    annotation = finding(
        [
            Modifier(term_id=SEVERE, segments=[at("schwere")]),
            Modifier(term_id=RECURRENT, segments=[at("wiederholt schwere")]),
        ],
        evidence_refs=[EvidenceRef(evidence_id="ev-1", version=ev.version)],
    )
    assert snapshot(annotation, [ev], DOCUMENT, PROFILE).version


def test_annotation_content_leaves_out_empty_modifiers() -> None:
    assert "modifiers" not in annotation_content(finding([]))
    content = annotation_content(
        finding(
            [
                Modifier(term_id=RECURRENT),
                Modifier(term_id=SEVERE, segments=[seg(25, 32)]),
            ]
        )
    )
    assert content["modifiers"] == [
        {"term_id": SEVERE, "segments": [{"start": 25, "end": 32}]},
        {"term_id": RECURRENT},
    ]


def test_modifiers_change_the_version() -> None:
    plain = snapshot(finding([]), [], DOCUMENT, PROFILE)
    with_modifier = snapshot(finding([Modifier(term_id=SEVERE)]), [], DOCUMENT, PROFILE)
    assert plain.version != with_modifier.version


def test_snapshot_refuses_a_modifier_segment_beyond_the_text() -> None:
    end = len(TEXT)
    annotation = finding([Modifier(term_id=SEVERE, segments=[seg(end - 1, end + 1)])])
    with pytest.raises(InvalidAnnotation, match="out of bounds"):
        snapshot(annotation, [], DOCUMENT, PROFILE)


def test_old_payload_round_trips_to_the_same_version() -> None:
    for snap in golden_snapshots():
        raw = encode_snapshot(snap)
        assert "modifiers" not in raw["annotation"]
        decoded = decode_snapshot(raw)
        verify_snapshot(decoded)
        assert decoded.version == snap.version


def test_payload_with_modifiers_round_trips() -> None:
    annotation = finding([Modifier(term_id=SEVERE, segments=[at("schwere")])])
    snap = snapshot(annotation, [], DOCUMENT, PROFILE)
    decoded = decode_snapshot(encode_snapshot(snap))
    verify_snapshot(decoded)
    assert decoded.version == snap.version
    assert decoded.annotation.modifiers == annotation.modifiers
