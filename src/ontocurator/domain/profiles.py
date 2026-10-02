from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ontocurator.domain.axes import AxisDefinition
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.errors import InvalidAnnotation


class OntologyDefinition(BaseModel):
    """Definition of an ontology artifact bound to a task profile."""

    model_config = ConfigDict(extra="forbid")

    ontology_id: str
    label: str
    release: str
    sha256: str
    format: Literal["obo-graph-json"] = "obo-graph-json"
    resource_path: str | None = None

    @model_validator(mode="after")
    def validate_non_empty_id(self) -> "OntologyDefinition":
        if not self.ontology_id or not self.ontology_id.strip():
            raise ValueError("ontology_id cannot be empty")
        return self


class AnnotationTypeDefinition(BaseModel):
    """Definition of an annotation type available in a layer."""

    model_config = ConfigDict(extra="forbid")

    type_id: str
    label: str
    axes: list[AxisDefinition] = Field(default_factory=list)
    evidence_policy: Literal["optional", "required_on_complete"] = "optional"

    @model_validator(mode="after")
    def validate_type(self) -> "AnnotationTypeDefinition":
        if not self.type_id or not self.type_id.strip():
            raise ValueError("type_id cannot be empty")
        seen_axes: set[str] = set()
        for ax in self.axes:
            if ax.id in seen_axes:
                raise ValueError(f"Duplicate axis id '{ax.id}' in type '{self.type_id}'")
            seen_axes.add(ax.id)
        return self


class LayerDefinition(BaseModel):
    """Definition of an annotation layer binding an ontology and types."""

    model_config = ConfigDict(extra="forbid")

    layer_id: str
    label: str
    ontology_id: str
    access: Literal["editable", "reference"]
    default_visible: bool = True
    default_type_id: str
    annotation_types: list[AnnotationTypeDefinition]

    @model_validator(mode="after")
    def validate_layer(self) -> "LayerDefinition":
        if not self.layer_id or not self.layer_id.strip():
            raise ValueError("layer_id cannot be empty")
        if not self.ontology_id or not self.ontology_id.strip():
            raise ValueError("ontology_id cannot be empty")
        if not self.annotation_types:
            raise ValueError(f"Layer '{self.layer_id}' must have at least one annotation type")

        seen_types: set[str] = set()
        for t in self.annotation_types:
            if t.type_id in seen_types:
                raise ValueError(f"Duplicate type id '{t.type_id}' in layer '{self.layer_id}'")
            seen_types.add(t.type_id)

        if self.default_type_id not in seen_types:
            raise ValueError(
                f"default_type_id '{self.default_type_id}' does not match any type in layer '{self.layer_id}'"
            )
        return self


class TaskProfile(BaseModel):
    """Complete specification of task profile, ontologies, layers, and types."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    schema_version: Literal["ontocurator-task-profile/v1"] = Field(
        default="ontocurator-task-profile/v1", alias="schema"
    )
    profile_id: str
    version: str
    ontologies: list[OntologyDefinition]
    layers: list[LayerDefinition]
    default_layer_id: str
    preset: str | None = None

    @model_validator(mode="after")
    def validate_profile(self) -> "TaskProfile":
        if not self.profile_id or not self.profile_id.strip():
            raise ValueError("profile_id cannot be empty")

        seen_ontologies: set[str] = set()
        for ont in self.ontologies:
            if ont.ontology_id in seen_ontologies:
                raise ValueError(f"Duplicate ontology id '{ont.ontology_id}' in profile")
            seen_ontologies.add(ont.ontology_id)

        seen_layers: set[str] = set()
        editable_layers: set[str] = set()
        for layer in self.layers:
            if layer.layer_id in seen_layers:
                raise ValueError(f"Duplicate layer id '{layer.layer_id}' in profile")
            seen_layers.add(layer.layer_id)

            if layer.ontology_id not in seen_ontologies:
                raise ValueError(
                    f"Layer '{layer.layer_id}' references unknown ontology '{layer.ontology_id}'"
                )

            if layer.access == "editable":
                editable_layers.add(layer.layer_id)

        if not editable_layers:
            raise ValueError("TaskProfile must contain at least one editable layer")

        if self.default_layer_id not in editable_layers:
            raise ValueError(
                f"default_layer_id '{self.default_layer_id}' must resolve to an editable layer in profile"
            )

        return self


def resolve_layer(profile: TaskProfile, layer_id: str) -> LayerDefinition:
    """Resolve a layer by ID from a task profile or raise InvalidAnnotation."""
    for layer in profile.layers:
        if layer.layer_id == layer_id:
            return layer
    raise InvalidAnnotation(
        f"Unknown layer '{layer_id}' in task profile '{profile.profile_id}'"
    )


def resolve_type(
    profile: TaskProfile, layer_id: str, type_id: str
) -> AnnotationTypeDefinition:
    """Resolve an annotation type by layer and type ID from a task profile or raise InvalidAnnotation."""
    layer = resolve_layer(profile, layer_id)
    for t in layer.annotation_types:
        if t.type_id == type_id:
            return t
    raise InvalidAnnotation(
        f"Unknown type '{type_id}' in layer '{layer_id}' of task profile '{profile.profile_id}'"
    )


def resolve_ontology(profile: TaskProfile, ontology_id: str) -> OntologyDefinition:
    """Resolve an ontology definition by ID from a task profile or raise InvalidAnnotation."""
    for ont in profile.ontologies:
        if ont.ontology_id == ontology_id:
            return ont
    raise InvalidAnnotation(
        f"Unknown ontology '{ontology_id}' in task profile '{profile.profile_id}'"
    )


def layer_config_hash(profile: TaskProfile, layer_id: str) -> str:
    """Compute RFC-8785 canonical hash binding layer definition and its resolved ontology."""
    layer = resolve_layer(profile, layer_id)
    ont = resolve_ontology(profile, layer.ontology_id)
    payload = {
        "layer": layer.model_dump(),
        "ontology": ont.model_dump(),
    }
    return canonical_hash(payload)


def profile_hash(profile: TaskProfile) -> str:
    """Compute RFC-8785 canonical hash of the full TaskProfile."""
    return canonical_hash(profile.model_dump())
