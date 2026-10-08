from collections.abc import Mapping
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator

from ontocurator.domain.annotations import AnnotationSnapshot
from ontocurator.domain.axes import AxesConfig
from ontocurator.domain.documents import Document, EvidenceSnapshot, OntologyRef
from ontocurator.domain.profiles import TaskProfile
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
    # Term id -> route that surfaced it. Empty on events written before the
    # single search existed.
    candidate_routes: dict[str, str] = Field(default_factory=dict)
    # The languages whose names the search looked at, English first. Empty
    # when it looked at no names (a term id, the tree) and on events written
    # before translations existed.
    languages: list[str] = Field(default_factory=list)
    selected_term_id: str | None = None
    ranked_position: int | None = None
    displayed_position: int | None = None
    layer_id: str = "hpo-layer"
    ontology_sha256: str = ""
    ontology_release: str
    index_identity: str
    timestamp: str

    @model_validator(mode="before")
    @classmethod
    def handle_aliases(cls, data: Any) -> Any:
        if isinstance(data, dict):
            d = dict(data)
            has_term = "selected_term_id" in d
            has_hpo = "selected_hpo_id" in d
            if has_term and has_hpo:
                if d["selected_term_id"] != d["selected_hpo_id"]:
                    raise ValueError(
                        f"Conflicting 'selected_term_id' "
                        f"('{d['selected_term_id']}') and "
                        f"'selected_hpo_id' ('{d['selected_hpo_id']}') provided"
                    )
                d.pop("selected_hpo_id")
            elif has_hpo:
                d["selected_term_id"] = d.pop("selected_hpo_id")
            return d
        return data

    @computed_field  # type: ignore[prop-decorator]
    @property
    def selected_hpo_id(self) -> str | None:
        return self.selected_term_id

    @selected_hpo_id.setter
    def selected_hpo_id(self, val: str | None) -> None:
        self.selected_term_id = val

    def model_copy(
        self,
        *,
        update: Mapping[str, Any] | None = None,
        deep: bool = False,
    ) -> Self:
        if update:
            up = dict(update)
            if "selected_hpo_id" in up and "selected_term_id" not in up:
                up["selected_term_id"] = up.pop("selected_hpo_id")
            elif "selected_hpo_id" in up and "selected_term_id" in up:
                if up["selected_term_id"] != up["selected_hpo_id"]:
                    raise ValueError(
                        "Conflicting 'selected_term_id' and 'selected_hpo_id' provided"
                    )
                up.pop("selected_hpo_id")
            return super().model_copy(update=up, deep=deep)
        return super().model_copy(update=update, deep=deep)


class PackageManifest(BaseModel):
    """Manifest describing work package metadata and checksums."""

    model_config = ConfigDict(extra="forbid")

    package_id: str
    format_version: Literal[
        "ontocurator-work-package/v2",
        "ontocurator-work-package/v1",
        "hpo-editor-work-package/v1",
    ] = "ontocurator-work-package/v2"
    document_order: list[str] = Field(default_factory=list)
    task_profile: TaskProfile | None = None
    task_profile_sha256: str | None = None
    ontology: OntologyRef | None = None
    axes_definition: str | None = None
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
    embedded_files: dict[str, bytes] = Field(default_factory=dict, exclude=True)
