from typing import Any, Literal

from ontocurator.domain.annotations import Annotation, AnnotationSnapshot
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.documents import EvidenceSnapshot
from ontocurator.domain.errors import InvalidAnnotation

V3_SCHEMA_VERSION: Literal["ontocurator-annotation/v3"] = "ontocurator-annotation/v3"


def decode_snapshot(raw: dict[str, Any]) -> AnnotationSnapshot:
    """Decode a raw dictionary representation into an immutable AnnotationSnapshot V3.

    Explicitly rejects legacy schema-free, v1, or v2 snapshots.
    """
    if not isinstance(raw, dict):
        raise InvalidAnnotation("Snapshot raw payload must be a dictionary")

    version = raw.get("version")
    if not version:
        raise InvalidAnnotation("Snapshot payload missing 'version' field")

    schema_version = raw.get("schema_version")
    if schema_version != V3_SCHEMA_VERSION:
        raise InvalidAnnotation(
            f"Unsupported or legacy snapshot schema '{schema_version}': only '{V3_SCHEMA_VERSION}' is supported"
        )

    raw_ann = raw.get("annotation")
    if not isinstance(raw_ann, dict):
        raise InvalidAnnotation("Snapshot missing or invalid 'annotation' dictionary")

    annotation = Annotation.model_validate(raw_ann)

    raw_evidence = raw.get("evidence", [])
    evidence = [EvidenceSnapshot.model_validate(e) for e in raw_evidence]

    sorted_ev = sorted(evidence, key=lambda e: (e.mention.evidence_id, e.version))

    layer_config_sha = raw.get("layer_config_sha256")
    if not layer_config_sha:
        raise InvalidAnnotation("Snapshot payload missing 'layer_config_sha256'")

    snap = AnnotationSnapshot(
        schema_version=V3_SCHEMA_VERSION,
        annotation=annotation,
        evidence=sorted_ev,
        document_id=raw["document_id"],
        text_sha256=raw["text_sha256"],
        ontology_sha256=raw["ontology_sha256"],
        layer_config_sha256=layer_config_sha,
        version=version,
    )

    return snap


def encode_snapshot(snapshot: AnnotationSnapshot) -> dict[str, Any]:
    """Encode an AnnotationSnapshot into its version-aware wire dictionary."""
    sorted_ev = sorted(
        snapshot.evidence, key=lambda e: (e.mention.evidence_id, e.version)
    )
    return {
        "schema_version": snapshot.schema_version,
        "annotation": {
            "annotation_id": snapshot.annotation.annotation_id,
            "document_id": snapshot.annotation.document_id,
            "layer_id": snapshot.annotation.layer_id,
            "type_id": snapshot.annotation.type_id,
            "term_id": snapshot.annotation.term_id,
            "axes_values": snapshot.annotation.axes_values,
            "evidence_refs": [
                r.model_dump() for r in snapshot.annotation.evidence_refs
            ],
            "provenance": snapshot.annotation.provenance.model_dump(),
        },
        "evidence": [e.model_dump() for e in sorted_ev],
        "document_id": snapshot.document_id,
        "text_sha256": snapshot.text_sha256,
        "ontology_sha256": snapshot.ontology_sha256,
        "layer_config_sha256": snapshot.layer_config_sha256,
        "version": snapshot.version,
    }


def verify_snapshot(snapshot: AnnotationSnapshot) -> None:
    """Verify cryptographic integrity of an AnnotationSnapshot."""
    if snapshot.schema_version != V3_SCHEMA_VERSION:
        raise InvalidAnnotation(
            f"Unsupported snapshot schema '{snapshot.schema_version}': only '{V3_SCHEMA_VERSION}' is supported"
        )

    if not snapshot.layer_config_sha256:
        raise InvalidAnnotation("v3 snapshot must bind layer_config_sha256")

    sorted_ev = sorted(
        snapshot.evidence, key=lambda e: (e.mention.evidence_id, e.version)
    )
    content = {
        "schema_version": snapshot.schema_version,
        "annotation": {
            "annotation_id": snapshot.annotation.annotation_id,
            "document_id": snapshot.annotation.document_id,
            "layer_id": snapshot.annotation.layer_id,
            "type_id": snapshot.annotation.type_id,
            "term_id": snapshot.annotation.term_id,
            "axes_values": snapshot.annotation.axes_values,
            "evidence_refs": [
                r.model_dump() for r in snapshot.annotation.evidence_refs
            ],
            "provenance": snapshot.annotation.provenance.model_dump(),
        },
        "document_id": snapshot.document_id,
        "evidence": [e.model_dump() for e in sorted_ev],
        "layer_config_sha256": snapshot.layer_config_sha256,
        "ontology_sha256": snapshot.ontology_sha256,
        "text_sha256": snapshot.text_sha256,
    }
    computed = canonical_hash(content)
    if computed != snapshot.version:
        raise InvalidAnnotation(
            f"HASH_MISMATCH: Computed hash {computed} does not match "
            f"version {snapshot.version}"
        )
