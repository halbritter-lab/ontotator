import hashlib
from pathlib import Path
from typing import Literal

from ontocurator.domain.annotations import (
    ActorRef,
    Annotation,
    AnnotationSnapshot,
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
from ontocurator.domain.profiles import (
    AnnotationTypeDefinition,
    AxisDefinition,
    LayerDefinition,
    OntologyDefinition,
    TaskProfile,
    profile_hash,
)
from ontocurator.packages.models import PackageManifest, ValidatedPackage

FIXTURES = Path(__file__).parent / "fixtures"
HP_DIGEST = hashlib.sha256((FIXTURES / "hp.json").read_bytes()).hexdigest()
MONDO_DIGEST = hashlib.sha256((FIXTURES / "mondo.json").read_bytes()).hexdigest()
EXT_DIGEST = "2222222222222222222222222222222222222222222222222222222222222222"


def _make_doc(doc_id: str, text: str) -> Document:
    return Document(
        document_id=doc_id,
        text=text,
        language="de",
        text_sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(),
    )


def make_layered_package(
    scenario: Literal["single", "assisted", "multi_editable"],
) -> ValidatedPackage:
    """Create synthetic test packages for scenarios A, B, and C."""
    # Non-alphabetical document ordering for testing document_order preservation
    doc_beta = _make_doc(
        "doc-beta", "Der Patient leidet an Epilepsie und Muskelhypotonie."
    )
    doc_alpha = _make_doc(
        "doc-alpha", "Unauffälliger Befund bei der Kontrolluntersuchung."
    )
    document_order = ["doc-beta", "doc-alpha"]
    documents = {doc.document_id: doc for doc in [doc_beta, doc_alpha]}

    if scenario == "single":
        # Scenario A: Single-layer HPO
        hp_ont = OntologyDefinition(
            ontology_id="hp",
            label="Human Phenotype Ontology",
            release="2026-06-23",
            sha256=HP_DIGEST,
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
                ),
                AxisDefinition(
                    id="experiencer",
                    label="Experiencer",
                    options=["patient", "other"],
                    allow_empty=True,
                ),
                AxisDefinition(
                    id="temporality",
                    label="Temporality",
                    options=["current", "historical", "future"],
                    allow_empty=True,
                ),
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
            preset="hpo-context-example",
            ontologies=[hp_ont],
            layers=[layer],
            default_layer_id="hpo-layer",
        )

        manifest = PackageManifest(
            package_id="pkg-scenario-a",
            format_version="ontocurator-work-package/v2",
            document_order=document_order,
            task_profile=profile,
            task_profile_sha256=profile_hash(profile),
            created_at="2026-10-02T10:00:00Z",
        )
        return ValidatedPackage(manifest=manifest, documents=documents)

    elif scenario == "assisted":
        # Scenario B: Reference layer (Mondo) + Target editable layer (HP)
        mondo_ont = OntologyDefinition(
            ontology_id="mondo",
            label="Mondo Disease Ontology",
            release="2026-06-01",
            sha256=MONDO_DIGEST,
            format="obo-graph-json",
            resource_path="ontologies/mondo.json",
        )
        hp_ont = OntologyDefinition(
            ontology_id="hp",
            label="Human Phenotype Ontology",
            release="2026-06-23",
            sha256=HP_DIGEST,
            format="obo-graph-json",
            resource_path="ontologies/hp.json",
        )
        ref_type = AnnotationTypeDefinition(
            type_id="disease",
            label="Disease",
            axes=[],
            evidence_policy="optional",
        )
        target_type = AnnotationTypeDefinition(
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
        ref_layer = LayerDefinition(
            layer_id="reference-layer",
            label="Reference Diseases",
            ontology_id="mondo",
            access="reference",
            default_visible=True,
            default_type_id="disease",
            annotation_types=[ref_type],
        )
        target_layer = LayerDefinition(
            layer_id="target-layer",
            label="Target Phenotypes",
            ontology_id="hp",
            access="editable",
            default_visible=True,
            default_type_id="phenotype",
            annotation_types=[target_type],
        )
        profile = TaskProfile(
            profile_id="assisted-mondo-hpo/v1",
            version="1.0.0",
            ontologies=[mondo_ont, hp_ont],
            layers=[ref_layer, target_layer],
            default_layer_id="target-layer",
        )

        # Synthetic reference annotations: 2 reference annotations in reference-layer, no mapping required
        annotations: dict[tuple[str, str], AnnotationSnapshot] = {}
        evidence: dict[tuple[str, str], EvidenceSnapshot] = {}

        # Ref 1: Epilepsie
        ev_1 = EvidenceSnapshot.create(
            mention=EvidenceMention(
                evidence_id="ev-ref-1",
                segments=[Segment(start=22, end=31)],  # "Epilepsie"
            ),
            document=doc_beta,
        )
        ann_ref_1 = Annotation(
            annotation_id="ann-ref-1",
            document_id="doc-beta",
            layer_id="reference-layer",
            type_id="disease",
            term_id="MONDO:0005027",
            axes_values={},
            evidence_refs=[EvidenceRef(evidence_id="ev-ref-1", version=ev_1.version)],
            provenance=Provenance(
                actor=ActorRef(actor_id="source-system", kind="tool"),
                method="automated-import",
            ),
        )
        snap_ref_1 = snapshot(ann_ref_1, [ev_1], doc_beta, profile)

        # Ref 2: Overlapping / separate mention
        ev_2 = EvidenceSnapshot.create(
            mention=EvidenceMention(
                evidence_id="ev-ref-2",
                segments=[Segment(start=36, end=52)],  # "Muskelhypotonie"
            ),
            document=doc_beta,
        )
        ann_ref_2 = Annotation(
            annotation_id="ann-ref-2",
            document_id="doc-beta",
            layer_id="reference-layer",
            type_id="disease",
            term_id="MONDO:0000001",
            axes_values={},
            evidence_refs=[EvidenceRef(evidence_id="ev-ref-2", version=ev_2.version)],
            provenance=Provenance(
                actor=ActorRef(actor_id="source-system", kind="tool"),
                method="automated-import",
            ),
        )
        snap_ref_2 = snapshot(ann_ref_2, [ev_2], doc_beta, profile)

        evidence[(ev_1.mention.evidence_id, ev_1.version)] = ev_1
        evidence[(ev_2.mention.evidence_id, ev_2.version)] = ev_2
        annotations[(ann_ref_1.annotation_id, snap_ref_1.version)] = snap_ref_1
        annotations[(ann_ref_2.annotation_id, snap_ref_2.version)] = snap_ref_2

        manifest = PackageManifest(
            package_id="pkg-scenario-b",
            format_version="ontocurator-work-package/v2",
            document_order=document_order,
            task_profile=profile,
            task_profile_sha256=profile_hash(profile),
            created_at="2026-10-02T10:00:00Z",
        )
        return ValidatedPackage(
            manifest=manifest,
            documents=documents,
            annotations=annotations,
            evidence=evidence,
        )

    elif scenario == "multi_editable":
        # Scenario C: Multi-editable layers with different rules
        hp_ont = OntologyDefinition(
            ontology_id="hp",
            label="Human Phenotype Ontology",
            release="2026-06-23",
            sha256=HP_DIGEST,
            format="obo-graph-json",
            resource_path="ontologies/hp.json",
        )
        ext_ont = OntologyDefinition(
            ontology_id="ext",
            label="Extended Secondary Ontology",
            release="2026-01-01",
            sha256=MONDO_DIGEST,
            format="obo-graph-json",
            resource_path="ontologies/mondo.json",
        )

        type_optional = AnnotationTypeDefinition(
            type_id="type-opt",
            label="Optional Evidence Type",
            axes=[
                AxisDefinition(
                    id="certainty",
                    label="Certainty",
                    options=["low", "high"],
                    allow_empty=True,
                )
            ],
            evidence_policy="optional",
        )
        type_required = AnnotationTypeDefinition(
            type_id="type-req",
            label="Required Evidence Type",
            axes=[
                AxisDefinition(
                    id="severity",
                    label="Severity",
                    options=["mild", "moderate", "severe"],
                    allow_empty=False,
                )
            ],
            evidence_policy="required_on_complete",
        )

        layer_1 = LayerDefinition(
            layer_id="layer-1",
            label="Editable Layer 1",
            ontology_id="hp",
            access="editable",
            default_visible=True,
            default_type_id="type-opt",
            annotation_types=[type_optional],
        )
        layer_2 = LayerDefinition(
            layer_id="layer-2",
            label="Editable Layer 2",
            ontology_id="ext",
            access="editable",
            default_visible=True,
            default_type_id="type-req",
            annotation_types=[type_required],
        )
        profile = TaskProfile(
            profile_id="multi-editable/v1",
            version="1.0.0",
            ontologies=[hp_ont, ext_ont],
            layers=[layer_1, layer_2],
            default_layer_id="layer-1",
        )

        manifest = PackageManifest(
            package_id="pkg-scenario-c",
            format_version="ontocurator-work-package/v2",
            document_order=document_order,
            task_profile=profile,
            task_profile_sha256=profile_hash(profile),
            created_at="2026-10-02T10:00:00Z",
        )
        return ValidatedPackage(manifest=manifest, documents=documents)

    else:
        raise ValueError(f"Unknown scenario: {scenario}")
