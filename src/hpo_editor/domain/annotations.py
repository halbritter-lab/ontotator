from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from hpo_editor.domain.axes import Axes
from hpo_editor.domain.canonical import canonical_hash
from hpo_editor.domain.documents import (
    Document,
    EvidenceRef,
    EvidenceSnapshot,
    OntologyRef,
)
from hpo_editor.domain.errors import InvalidAnnotation

ActorKind = Literal["human", "tool"]


class ActorRef(BaseModel):
    """Reference to human or tool actor."""

    model_config = ConfigDict(extra="forbid")

    actor_id: str
    kind: ActorKind


class Provenance(BaseModel):
    """Origin and extraction details for an annotation or statement."""

    model_config = ConfigDict(extra="forbid")

    actor: ActorRef
    method: str
    source_refs: list[str] = Field(default_factory=list)
    assessment: str | None = None


class AnnotationRef(BaseModel):
    """Reference binding annotation ID and immutable version hash."""

    model_config = ConfigDict(extra="forbid")

    annotation_id: str
    version: str


class Annotation(BaseModel):
    """Annotation entity referencing HPO term, context axes and evidence."""

    model_config = ConfigDict(extra="forbid")

    annotation_id: str
    document_id: str
    hpo_id: str
    axes: Axes = Field(default_factory=Axes)
    evidence_refs: list[EvidenceRef] = Field(default_factory=list)
    provenance: Provenance

    @model_validator(mode="after")
    def sort_evidence_refs(self) -> "Annotation":
        if self.evidence_refs:
            self.evidence_refs = sorted(
                self.evidence_refs, key=lambda r: (r.evidence_id, r.version)
            )
        return self


class AnnotationSnapshot(BaseModel):
    """Immutable snapshot binding annotation, evidence, text and ontology digests."""

    model_config = ConfigDict(extra="forbid")

    annotation: Annotation
    evidence: list[EvidenceSnapshot]
    document_id: str
    text_sha256: str
    ontology_sha256: str
    version: str


def snapshot(
    annotation: Annotation,
    evidence: list[EvidenceSnapshot],
    document: Document,
    ontology: OntologyRef,
) -> AnnotationSnapshot:
    """Create an immutable AnnotationSnapshot with RFC-8785 canonical hash version."""
    if annotation.document_id != document.document_id:
        raise InvalidAnnotation(
            f"Annotation document_id '{annotation.document_id}' does not "
            f"match Document '{document.document_id}'"
        )

    # Order evidence snapshots stably by evidence_id
    sorted_ev = sorted(evidence, key=lambda e: (e.mention.evidence_id, e.version))

    # Check evidence reference integrity
    ev_map = {(e.mention.evidence_id, e.version): e for e in sorted_ev}
    for ref in annotation.evidence_refs:
        if (ref.evidence_id, ref.version) not in ev_map:
            raise InvalidAnnotation(
                f"Annotation references missing evidence "
                f"({ref.evidence_id}, {ref.version})"
            )

    canonical_content = {
        "annotation": annotation.model_dump(),
        "document_id": document.document_id,
        "evidence": [e.model_dump() for e in sorted_ev],
        "ontology_sha256": ontology.sha256,
        "text_sha256": document.text_sha256,
    }
    v = canonical_hash(canonical_content)

    return AnnotationSnapshot(
        annotation=annotation,
        evidence=sorted_ev,
        document_id=document.document_id,
        text_sha256=document.text_sha256,
        ontology_sha256=ontology.sha256,
        version=v,
    )
