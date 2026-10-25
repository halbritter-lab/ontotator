"""Finding modifiers in the data model (finding-modifiers spec "Data model and
content hash", R1, R11).

Pure: no database. Empty modifiers stay out of the content hash, so every
existing version and submission id is unchanged (pasted literals below).
"""

from __future__ import annotations

import hashlib

from ontocurator.domain.annotations import (
    ActorRef,
    Annotation,
    AnnotationSnapshot,
    Provenance,
    snapshot,
)
from ontocurator.domain.axes import AxisDefinition
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.documents import (
    Document,
    EvidenceMention,
    EvidenceRef,
    EvidenceSnapshot,
    Segment,
)
from ontocurator.domain.profiles import (
    AnnotationTypeDefinition,
    LayerDefinition,
    OntologyDefinition,
    TaskProfile,
)
from ontocurator.domain.review import ReviewTargetSet
from ontocurator.domain.scopes import build_scope
from ontocurator.domain.workspace import WorkspaceKey

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
