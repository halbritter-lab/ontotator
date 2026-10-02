"""Script to generate a rich demo work package for Ontocurator using hp.json fixtures."""

import hashlib
from pathlib import Path

from ontocurator.domain.annotations import ActorRef, Annotation, Provenance, snapshot
from ontocurator.domain.documents import (
    Document,
    EvidenceMention,
    EvidenceRef,
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
from ontocurator.packages.models import PackageManifest, ValidatedPackage
from ontocurator.packages.writer import PackageWriter


def generate_demo_package(
    hp_path: Path = Path("tests/fixtures/hp.json"),
    output_path: Path = Path("demo_package.zip"),
) -> None:
    raw = hp_path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()

    hp_ont = OntologyDefinition(
        ontology_id="hp",
        label="Human Phenotype Ontology",
        release="2026-06-23",
        sha256=digest,
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
        profile_id="hpo-clinical-phenotypes/v1",
        version="1.0.0",
        preset="hpo-clinical-phenotypes",
        ontologies=[hp_ont],
        layers=[layer],
        default_layer_id="hpo-layer",
    )

    # Document 1: Pädiatrischer Fall 1 (Hypotonie & Anfälle)
    text1 = (
        "Der 4-jährige Patient zeigt eine ausgeprägte Hypotonie der Muskulatur "
        "sowie wiederholte generalisierte Krampfanfälle (Seizure)."
    )
    doc1 = Document(
        document_id="fall-001-neuropediatrie",
        text=text1,
        language="de",
        text_sha256=hashlib.sha256(text1.encode("utf-8")).hexdigest(),
    )

    # Evidences for Doc 1
    start_hyp = text1.index("Hypotonie")
    end_hyp = start_hyp + len("Hypotonie")
    ev1 = snapshot_evidence(
        EvidenceMention(
            evidence_id="ev-001-hyp", segments=[Segment(start=start_hyp, end=end_hyp)]
        ),
        doc1,
    )

    start_seiz = text1.index("Krampfanfälle")
    end_seiz = start_seiz + len("Krampfanfälle")
    ev2 = snapshot_evidence(
        EvidenceMention(
            evidence_id="ev-002-seiz",
            segments=[Segment(start=start_seiz, end=end_seiz)],
        ),
        doc1,
    )

    # Annotations for Doc 1 (e.g. from an existing automated pipeline or clinician proposal)
    ann1 = Annotation(
        annotation_id="prop-hyp-01",
        document_id=doc1.document_id,
        layer_id="hpo-layer",
        type_id="phenotype",
        term_id="HP:0001252",  # Hypotonia
        axes_values={"assertion": "present"},
        evidence_refs=[
            EvidenceRef(evidence_id=ev1.mention.evidence_id, version=ev1.version)
        ],
        provenance=Provenance(
            actor=ActorRef(actor_id="dr-weber", kind="human"), method="manual"
        ),
    )
    snap1 = snapshot(ann1, [ev1], doc1, profile)

    ann2 = Annotation(
        annotation_id="prop-seiz-02",
        document_id=doc1.document_id,
        layer_id="hpo-layer",
        type_id="phenotype",
        term_id="HP:0001250",  # Seizure
        axes_values={"assertion": "present"},
        evidence_refs=[
            EvidenceRef(evidence_id=ev2.mention.evidence_id, version=ev2.version)
        ],
        provenance=Provenance(
            actor=ActorRef(actor_id="pheno-nlp-pipeline", kind="tool"),
            method="automated",
        ),
    )
    snap2 = snapshot(ann2, [ev2], doc1, profile)

    # Document 2: Pädiatrischer Fall 2 (Areflexie & Hörstörung)
    text2 = (
        "Neugeborenes zur Abklärung: auffällige Areflexia der Sehnenreflexe, "
        "im Hörscreening Hinweis auf Sensorineural hearing impairment beidseits."
    )
    doc2 = Document(
        document_id="fall-002-neonatologie",
        text=text2,
        language="de",
        text_sha256=hashlib.sha256(text2.encode("utf-8")).hexdigest(),
    )

    start_aref = text2.index("Areflexia")
    end_aref = start_aref + len("Areflexia")
    ev3 = snapshot_evidence(
        EvidenceMention(
            evidence_id="ev-003-aref",
            segments=[Segment(start=start_aref, end=end_aref)],
        ),
        doc2,
    )

    start_hear = text2.index("Sensorineural hearing impairment")
    end_hear = start_hear + len("Sensorineural hearing impairment")
    ev4 = snapshot_evidence(
        EvidenceMention(
            evidence_id="ev-004-hear",
            segments=[Segment(start=start_hear, end=end_hear)],
        ),
        doc2,
    )

    ann3 = Annotation(
        annotation_id="prop-aref-03",
        document_id=doc2.document_id,
        layer_id="hpo-layer",
        type_id="phenotype",
        term_id="HP:0001284",  # Areflexia
        axes_values={"assertion": "present"},
        evidence_refs=[
            EvidenceRef(evidence_id=ev3.mention.evidence_id, version=ev3.version)
        ],
        provenance=Provenance(
            actor=ActorRef(actor_id="dr-schmidt", kind="human"), method="manual"
        ),
    )
    snap3 = snapshot(ann3, [ev3], doc2, profile)

    ann4 = Annotation(
        annotation_id="prop-hear-04",
        document_id=doc2.document_id,
        layer_id="hpo-layer",
        type_id="phenotype",
        term_id="HP:0000407",  # Sensorineural hearing impairment
        axes_values={"assertion": "present"},
        evidence_refs=[
            EvidenceRef(evidence_id=ev4.mention.evidence_id, version=ev4.version)
        ],
        provenance=Provenance(
            actor=ActorRef(actor_id="dr-schmidt", kind="human"), method="manual"
        ),
    )
    snap4 = snapshot(ann4, [ev4], doc2, profile)

    package = ValidatedPackage(
        manifest=PackageManifest(
            package_id="demo-klinik-pakete-01",
            format_version="ontocurator-work-package/v2",
            document_order=[doc1.document_id, doc2.document_id],
            task_profile=profile,
            task_profile_sha256=profile_hash(profile),
            created_at="2026-10-02T10:00:00Z",
        ),
        documents={
            doc1.document_id: doc1,
            doc2.document_id: doc2,
        },
        annotations={
            (snap1.annotation.annotation_id, snap1.version): snap1,
            (snap2.annotation.annotation_id, snap2.version): snap2,
            (snap3.annotation.annotation_id, snap3.version): snap3,
            (snap4.annotation.annotation_id, snap4.version): snap4,
        },
        evidence={
            (ev1.mention.evidence_id, ev1.version): ev1,
            (ev2.mention.evidence_id, ev2.version): ev2,
            (ev3.mention.evidence_id, ev3.version): ev3,
            (ev4.mention.evidence_id, ev4.version): ev4,
        },
    )

    with open(output_path, "wb") as f:
        PackageWriter.write_to_stream(package, f)

    print(
        f"Successfully generated demo package at '{output_path}' ({output_path.stat().st_size} bytes)"
    )


if __name__ == "__main__":
    generate_demo_package()
