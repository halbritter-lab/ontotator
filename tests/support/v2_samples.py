"""Sample v2 packages, formerly in test_packages.py (kept for the round-trip tests)."""

import hashlib

from ontotator.domain.annotations import (
    ActorRef,
    Annotation,
    AnnotationRef,
    Provenance,
    snapshot,
)
from ontotator.domain.documents import (
    Document,
    EvidenceMention,
    EvidenceRef,
    EvidenceSnapshot,
    Segment,
)
from ontotator.domain.profiles import (
    AnnotationTypeDefinition,
    AxisDefinition,
    LayerDefinition,
    OntologyDefinition,
    TaskProfile,
    profile_hash,
)
from ontotator.domain.review import ReviewDecision, ReviewTargetSet
from ontotator.domain.workspace import Submission, WorkspaceKey
from ontotator.packages.models import (
    PackageManifest,
    SearchEventRecord,
    ValidatedPackage,
)


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
        format_version="ontotator-work-package/v2",
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
