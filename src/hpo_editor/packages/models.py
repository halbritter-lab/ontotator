from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from hpo_editor.domain.annotations import AnnotationSnapshot
from hpo_editor.domain.documents import Document, EvidenceSnapshot, OntologyRef
from hpo_editor.domain.workspace import Submission, WorkspaceKey


class SearchEventRecord(BaseModel):
    """Recorded audit event for term lookup, ranking and selection."""

    model_config = ConfigDict(extra="forbid")

    event_id: str
    workspace_key: WorkspaceKey
    annotation_id: str
    query: str
    route: str
    candidates: list[str]
    selected_hpo_id: str | None = None
    ranked_position: int | None = None
    displayed_position: int | None = None
    ontology_release: str
    index_identity: str
    timestamp: str


class PackageManifest(BaseModel):
    """Manifest describing work package metadata and checksums."""

    model_config = ConfigDict(extra="forbid")

    package_id: str
    format_version: Literal["hpo-editor-work-package/v1"] = "hpo-editor-work-package/v1"
    ontology: OntologyRef
    axes_definition: str = "editor-axes/v1"
    file_hashes: dict[str, str] = Field(default_factory=dict)
    created_at: str
    origin_package_id: str | None = None
    origin_manifest_hash: str | None = None


class ValidatedPackage(BaseModel):
    """In-memory representation of an authenticated, structurally valid work package."""

    model_config = ConfigDict(extra="forbid")

    manifest: PackageManifest
    documents: dict[str, Document] = Field(default_factory=dict)
    annotations: dict[tuple[str, str], AnnotationSnapshot] = Field(
        default_factory=dict
    )
    evidence: dict[tuple[str, str], EvidenceSnapshot] = Field(
        default_factory=dict
    )
    submissions: dict[str, Submission] = Field(default_factory=dict)
    search_events: list[SearchEventRecord] = Field(default_factory=list)
