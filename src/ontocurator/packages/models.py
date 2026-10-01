from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from ontocurator.domain.annotations import AnnotationSnapshot
from ontocurator.domain.axes import AxesConfig
from ontocurator.domain.documents import Document, EvidenceSnapshot, OntologyRef
from ontocurator.domain.workspace import Submission, WorkspaceKey


class SearchEventRecord(BaseModel):
    """Recorded audit event for term lookup, ranking and selection."""

    model_config = ConfigDict(extra="forbid")

    event_id: str
    source_search_event_id: str | None = None
    workspace_key: WorkspaceKey
    annotation_id: str
    query: str
    route: str
    candidates: list[str]
    ranked_ids: list[str] = Field(default_factory=list)
    candidate_scores: dict[str, float] = Field(default_factory=dict)
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
    format_version: Literal[
        "ontocurator-work-package/v1", "hpo-editor-work-package/v1"
    ] = "ontocurator-work-package/v1"
    ontology: OntologyRef
    axes_definition: str = "editor-axes/v1"
    axes_config: AxesConfig | None = None
    axes_config_sha256: str | None = None
    file_hashes: dict[str, str] = Field(default_factory=dict)
    created_at: str
    origin_package_id: str | None = None
    origin_manifest_hash: str | None = None

    def model_dump(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        data = super().model_dump(*args, **kwargs)
        if self.format_version == "hpo-editor-work-package/v1":
            data.pop("axes_config", None)
            data.pop("axes_config_sha256", None)
        return data


class ValidatedPackage(BaseModel):
    """In-memory representation of an authenticated, structurally valid work package."""

    model_config = ConfigDict(extra="forbid")

    manifest: PackageManifest
    documents: dict[str, Document] = Field(default_factory=dict)
    annotations: dict[tuple[str, str], AnnotationSnapshot] = Field(default_factory=dict)
    evidence: dict[tuple[str, str], EvidenceSnapshot] = Field(default_factory=dict)
    submissions: dict[str, Submission] = Field(default_factory=dict)
    search_events: list[SearchEventRecord] = Field(default_factory=list)
