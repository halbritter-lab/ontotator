import re
from collections.abc import Mapping
from typing import Any, Literal, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    PrivateAttr,
    computed_field,
    model_validator,
)

from ontocurator.domain.axes import (
    CLINICAL_PHENOTYPE_CONFIG,
    EDITOR_AXES_CONFIG,
    Axes,
    AxesConfig,
)
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.documents import (
    Document,
    EvidenceRef,
    EvidenceSnapshot,
    OntologyRef,
)
from ontocurator.domain.errors import InvalidAnnotation

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
    """Annotation entity referencing ontology term, context axes and evidence."""

    model_config = ConfigDict(extra="forbid")

    annotation_id: str
    document_id: str
    term_id: str
    axes: Axes = Field(default_factory=Axes)
    evidence_refs: list[EvidenceRef] = Field(default_factory=list)
    provenance: Provenance

    @model_validator(mode="before")
    @classmethod
    def handle_aliases(cls, data: Any) -> Any:
        if isinstance(data, dict):
            d = dict(data)
            has_term = "term_id" in d
            has_hpo = "hpo_id" in d
            if has_term and has_hpo:
                if d["term_id"] != d["hpo_id"]:
                    raise ValueError(
                        f"Conflicting 'term_id' ('{d['term_id']}') and "
                        f"'hpo_id' ('{d['hpo_id']}') provided"
                    )
                d.pop("hpo_id")
            elif has_hpo:
                d["term_id"] = d.pop("hpo_id")
            return d
        return data

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
        return self

    @computed_field  # type: ignore[prop-decorator]
    @property
    def hpo_id(self) -> str:
        return self.term_id

    @hpo_id.setter
    def hpo_id(self, val: str) -> None:
        self.term_id = val

    def model_copy(
        self,
        *,
        update: Mapping[str, Any] | None = None,
        deep: bool = False,
    ) -> Self:
        if update:
            up = dict(update)
            if "hpo_id" in up and "term_id" not in up:
                up["term_id"] = up.pop("hpo_id")
            elif "hpo_id" in up and "term_id" in up:
                if up["term_id"] != up["hpo_id"]:
                    raise ValueError(
                        f"Conflicting 'term_id' ('{up['term_id']}') and "
                        f"'hpo_id' ('{up['hpo_id']}') provided"
                    )
                up.pop("hpo_id")
            update = up
        return super().model_copy(update=update, deep=deep)


class AnnotationSnapshot(BaseModel):
    """Immutable snapshot binding annotation, evidence, text and ontology digests."""

    model_config = ConfigDict(extra="forbid")

    annotation: Annotation
    evidence: list[EvidenceSnapshot]
    document_id: str
    text_sha256: str
    ontology_sha256: str
    version: str
    schema_version: str | None = None
    axes_config_sha256: str | None = None

    _legacy_wire: dict[str, Any] | None = PrivateAttr(default=None)

    def __eq__(self, other: Any) -> bool:
        if not isinstance(other, AnnotationSnapshot):
            return False
        return (
            self.version == other.version
            and self.schema_version == other.schema_version
            and self.axes_config_sha256 == other.axes_config_sha256
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
    ontology: OntologyRef,
    axes_config: AxesConfig | None = None,
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

    if axes_config is None:
        if annotation.axes.definition_name == "editor-axes/v1":
            axes_config = EDITOR_AXES_CONFIG
        else:
            axes_config = CLINICAL_PHENOTYPE_CONFIG

    schema_version = "ontocurator-annotation/v2"
    axes_config_sha256 = axes_config.config_sha256

    canonical_content = {
        "schema_version": schema_version,
        "annotation": {
            "annotation_id": annotation.annotation_id,
            "document_id": annotation.document_id,
            "term_id": annotation.term_id,
            "axes": {
                "definition_name": annotation.axes.definition_name,
                "values": annotation.axes.values,
            },
            "evidence_refs": [r.model_dump() for r in annotation.evidence_refs],
            "provenance": annotation.provenance.model_dump(),
        },
        "document_id": document.document_id,
        "evidence": [e.model_dump() for e in sorted_ev],
        "ontology_sha256": ontology.sha256,
        "text_sha256": document.text_sha256,
        "axes_config_sha256": axes_config_sha256,
    }
    v = canonical_hash(canonical_content)

    return AnnotationSnapshot(
        schema_version=schema_version,
        annotation=annotation,
        evidence=sorted_ev,
        document_id=document.document_id,
        text_sha256=document.text_sha256,
        ontology_sha256=ontology.sha256,
        axes_config_sha256=axes_config_sha256,
        version=v,
    )
