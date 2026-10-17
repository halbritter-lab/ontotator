import re
from typing import Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    model_validator,
)

from ontocurator.domain.axes import Axes
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.documents import (
    Document,
    EvidenceRef,
    EvidenceSnapshot,
)
from ontocurator.domain.errors import InvalidAnnotation
from ontocurator.domain.profiles import (
    TaskProfile,
    layer_config_hash,
    resolve_layer,
    resolve_ontology,
    resolve_type,
)

CURIE_PATTERN = re.compile(r"^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$")

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
    """Annotation entity referencing ontology term, layer, type, context axes and evidence."""

    model_config = ConfigDict(extra="forbid")

    annotation_id: str
    document_id: str
    layer_id: str = "hpo-layer"
    type_id: str = "phenotype"
    term_id: str
    axes_values: dict[str, str | None] = Field(default_factory=dict)
    # The axes whose value was set by a default, not chosen by anyone (T1
    # ``basis: defaulted``); every other set value is chosen. Part of the
    # content, but left out of it while empty, so older versions stay valid.
    axes_defaulted: list[str] = Field(
        default_factory=list, exclude_if=lambda value: not value
    )
    note: str | None = Field(default=None, exclude_if=lambda value: not value)
    evidence_refs: list[EvidenceRef] = Field(default_factory=list)
    provenance: Provenance

    @model_validator(mode="before")
    @classmethod
    def handle_axes_and_aliases(cls, data: Any) -> Any:
        if isinstance(data, dict):
            d = dict(data)
            if "hpo_id" in d and "term_id" not in d:
                # Do not accept hpo_id as alias anymore
                raise ValueError(
                    "Deprecated field 'hpo_id' is no longer supported; use 'term_id'"
                )
            if "hpo_id" in d:
                raise ValueError("Deprecated field 'hpo_id' is no longer supported")

            if "axes" in d and "axes_values" not in d:
                raw_axes = d.pop("axes")
                if isinstance(raw_axes, dict):
                    d["axes_values"] = raw_axes.get("values", raw_axes)
                elif hasattr(raw_axes, "values"):
                    d["axes_values"] = raw_axes.values
            return d
        return data

    @property
    def axes(self) -> Axes:
        return Axes(values=self.axes_values)

    @model_validator(mode="after")
    def validate_and_sort(self) -> "Annotation":
        if not CURIE_PATTERN.match(self.term_id):
            raise InvalidAnnotation(
                f"Invalid ontology CURIE format for term_id: '{self.term_id}'"
            )
        if self.evidence_refs:
            self.evidence_refs = sorted(
                self.evidence_refs, key=lambda r: (r.evidence_id, r.version)
            )
        unset = [a for a in self.axes_defaulted if self.axes_values.get(a) is None]
        if unset:
            raise InvalidAnnotation(f"Defaulted axes without a value: {unset}")
        self.axes_defaulted = sorted(set(self.axes_defaulted))
        return self

    def with_axes(self, axes_values: dict[str, str | None]) -> "Annotation":
        """New axis values; a value that is set again unchanged keeps its basis.

        Only a changed value becomes chosen, so a default is never turned into a
        choice without anyone choosing it.
        """
        kept = [
            axis
            for axis in self.axes_defaulted
            if axes_values.get(axis) is not None
            and axes_values.get(axis) == self.axes_values.get(axis)
        ]
        return self.model_copy(
            update={"axes_values": axes_values, "axes_defaulted": kept}
        )


def annotation_content(annotation: Annotation) -> dict[str, Any]:
    """The annotation as it enters a snapshot's canonical hash and payload."""
    content: dict[str, Any] = {
        "annotation_id": annotation.annotation_id,
        "document_id": annotation.document_id,
        "layer_id": annotation.layer_id,
        "type_id": annotation.type_id,
        "term_id": annotation.term_id,
        "axes_values": annotation.axes_values,
        "evidence_refs": [r.model_dump() for r in annotation.evidence_refs],
        "provenance": annotation.provenance.model_dump(),
    }
    if annotation.note:
        content["note"] = annotation.note
    if annotation.axes_defaulted:
        content["axes_defaulted"] = list(annotation.axes_defaulted)
    return content


class AnnotationSnapshot(BaseModel):
    """Immutable snapshot binding annotation, evidence, text, layer config and ontology digests (V3)."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["ontocurator-annotation/v3"] = "ontocurator-annotation/v3"
    annotation: Annotation
    evidence: list[EvidenceSnapshot]
    document_id: str
    text_sha256: str
    ontology_sha256: str
    layer_config_sha256: str
    version: str

    def __eq__(self, other: Any) -> bool:
        if not isinstance(other, AnnotationSnapshot):
            return False
        return (
            self.version == other.version
            and self.schema_version == other.schema_version
            and self.layer_config_sha256 == other.layer_config_sha256
            and self.document_id == other.document_id
            and self.text_sha256 == other.text_sha256
            and self.ontology_sha256 == other.ontology_sha256
            and self.annotation == other.annotation
            and self.evidence == other.evidence
        )


def snapshot(
    annotation: Annotation,
    evidence: list[EvidenceSnapshot],
    document: Document,
    profile: TaskProfile,
) -> AnnotationSnapshot:
    """Create an immutable AnnotationSnapshot V3 with RFC-8785 canonical hash version."""
    if annotation.document_id != document.document_id:
        raise InvalidAnnotation(
            f"Annotation document_id '{annotation.document_id}' does not "
            f"match Document '{document.document_id}'"
        )

    layer_def = resolve_layer(profile, annotation.layer_id)
    resolve_type(profile, annotation.layer_id, annotation.type_id)
    ont_def = resolve_ontology(profile, layer_def.ontology_id)
    layer_hash = layer_config_hash(profile, annotation.layer_id)

    # Order evidence snapshots stably by evidence_id
    sorted_ev = sorted(evidence, key=lambda e: (e.mention.evidence_id, e.version))

    # Check evidence reference integrity
    ev_map = {(e.mention.evidence_id, e.version): e for e in sorted_ev}
    for ref in annotation.evidence_refs:
        if (ref.evidence_id, ref.version) not in ev_map:
            raise InvalidAnnotation(
                f"Annotation references missing evidence ({ref.evidence_id}, {ref.version})"
            )

    schema_version: Literal["ontocurator-annotation/v3"] = "ontocurator-annotation/v3"

    canonical_content = {
        "schema_version": schema_version,
        "annotation": annotation_content(annotation),
        "document_id": document.document_id,
        "evidence": [e.model_dump() for e in sorted_ev],
        "layer_config_sha256": layer_hash,
        "ontology_sha256": ont_def.sha256,
        "text_sha256": document.text_sha256,
    }
    v = canonical_hash(canonical_content)

    return AnnotationSnapshot(
        schema_version=schema_version,
        annotation=annotation,
        evidence=sorted_ev,
        document_id=document.document_id,
        text_sha256=document.text_sha256,
        ontology_sha256=ont_def.sha256,
        layer_config_sha256=layer_hash,
        version=v,
    )
