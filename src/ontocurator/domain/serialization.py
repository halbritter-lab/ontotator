import copy
import re
from typing import Any

from ontocurator.domain.annotations import Annotation, AnnotationSnapshot
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.documents import EvidenceSnapshot
from ontocurator.domain.errors import InvalidAnnotation

CURIE_PATTERN = re.compile(r"^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$")
V2_SCHEMA_VERSION = "ontocurator-annotation/v2"


def decode_snapshot(raw: dict[str, Any]) -> AnnotationSnapshot:
    """Decode a raw dictionary representation into an immutable AnnotationSnapshot.

    Preserves original wire representation for legacy v1 records.
    """
    if not isinstance(raw, dict):
        raise InvalidAnnotation("Snapshot raw payload must be a dictionary")

    version = raw.get("version")
    if not version:
        raise InvalidAnnotation("Snapshot payload missing 'version' field")

    schema_version = raw.get("schema_version")
    if schema_version is not None and schema_version != V2_SCHEMA_VERSION:
        raise InvalidAnnotation(f"Unknown snapshot schema: {schema_version}")

    raw_ann = raw.get("annotation")
    if not isinstance(raw_ann, dict):
        raise InvalidAnnotation("Snapshot missing or invalid 'annotation' dictionary")

    annotation = Annotation.model_validate(raw_ann)

    raw_evidence = raw.get("evidence", [])
    evidence = [EvidenceSnapshot.model_validate(e) for e in raw_evidence]

    sorted_ev = sorted(evidence, key=lambda e: (e.mention.evidence_id, e.version))

    snap = AnnotationSnapshot(
        schema_version=schema_version,
        annotation=annotation,
        evidence=sorted_ev,
        document_id=raw["document_id"],
        text_sha256=raw["text_sha256"],
        ontology_sha256=raw["ontology_sha256"],
        axes_config_sha256=raw.get("axes_config_sha256"),
        version=version,
    )

    if schema_version is None:
        snap._legacy_wire = copy.deepcopy(raw)

    return snap


def encode_snapshot(snapshot: AnnotationSnapshot) -> dict[str, Any]:
    """Encode an AnnotationSnapshot into its version-aware wire dictionary."""
    if snapshot.schema_version is None and snapshot._legacy_wire is not None:
        return copy.deepcopy(snapshot._legacy_wire)

    sorted_ev = sorted(
        snapshot.evidence, key=lambda e: (e.mention.evidence_id, e.version)
    )
    return {
        "schema_version": snapshot.schema_version or V2_SCHEMA_VERSION,
        "annotation": {
            "annotation_id": snapshot.annotation.annotation_id,
            "document_id": snapshot.annotation.document_id,
            "term_id": snapshot.annotation.term_id,
            "axes": {
                "definition_name": snapshot.annotation.axes.definition_name,
                "values": snapshot.annotation.axes.values,
            },
            "evidence_refs": [
                r.model_dump() for r in snapshot.annotation.evidence_refs
            ],
            "provenance": snapshot.annotation.provenance.model_dump(),
        },
        "evidence": [e.model_dump() for e in sorted_ev],
        "document_id": snapshot.document_id,
        "text_sha256": snapshot.text_sha256,
        "ontology_sha256": snapshot.ontology_sha256,
        "axes_config_sha256": snapshot.axes_config_sha256,
        "version": snapshot.version,
    }


def verify_snapshot(snapshot: AnnotationSnapshot) -> None:
    """Verify cryptographic integrity of an AnnotationSnapshot."""
    if snapshot.schema_version is None:
        if snapshot._legacy_wire is None:
            raise InvalidAnnotation(
                "Legacy snapshot missing cached wire representation"
            )
        wire = copy.deepcopy(snapshot._legacy_wire)
        wire.pop("version", None)
        computed = canonical_hash(wire)
        if computed != snapshot.version:
            raise InvalidAnnotation(
                f"HASH_MISMATCH: Computed hash {computed} does not match "
                f"version {snapshot.version}"
            )
        return

    if snapshot.schema_version != V2_SCHEMA_VERSION:
        raise InvalidAnnotation(f"Unknown snapshot schema: {snapshot.schema_version}")

    if not snapshot.axes_config_sha256:
        raise InvalidAnnotation("v2 snapshot must bind axes_config_sha256")

    sorted_ev = sorted(
        snapshot.evidence, key=lambda e: (e.mention.evidence_id, e.version)
    )
    content = {
        "schema_version": snapshot.schema_version,
        "annotation": {
            "annotation_id": snapshot.annotation.annotation_id,
            "document_id": snapshot.annotation.document_id,
            "term_id": snapshot.annotation.term_id,
            "axes": {
                "definition_name": snapshot.annotation.axes.definition_name,
                "values": snapshot.annotation.axes.values,
            },
            "evidence_refs": [
                r.model_dump() for r in snapshot.annotation.evidence_refs
            ],
            "provenance": snapshot.annotation.provenance.model_dump(),
        },
        "evidence": [e.model_dump() for e in sorted_ev],
        "document_id": snapshot.document_id,
        "text_sha256": snapshot.text_sha256,
        "ontology_sha256": snapshot.ontology_sha256,
        "axes_config_sha256": snapshot.axes_config_sha256,
    }
    computed = canonical_hash(content)
    if computed != snapshot.version:
        raise InvalidAnnotation(
            f"HASH_MISMATCH: Computed hash {computed} does not match "
            f"version {snapshot.version}"
        )
