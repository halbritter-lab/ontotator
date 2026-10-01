"""Provenance and request/response models for HPO search and term validation."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from hpo_editor.domain.workspace import WorkspaceKey


class TermStatus(BaseModel):
    """Ontology status of a queried HPO ID."""

    model_config = ConfigDict(extra="forbid")

    hpo_id: str
    status: Literal["valid", "obsolete", "unknown"]
    label: str | None = None
    definition: str | None = None
    synonyms: list[str] = Field(default_factory=list)


class SearchRequest(BaseModel):
    """Search request scoped to a workspace mention/annotation."""

    model_config = ConfigDict(extra="forbid")

    workspace_key: WorkspaceKey
    annotation_id: str
    query: str
    route: Literal["lexical", "exact", "id", "browse"] = "lexical"
    k: int = Field(default=10, ge=1, le=100)


class SearchCandidate(BaseModel):
    """Single candidate term returned by an HPO search route."""

    model_config = ConfigDict(extra="forbid")

    hpo_id: str
    label: str
    definition: str = ""
    matched_term: str = ""
    match_kind: str = ""
    rank: int = 0
    display_pos: int = 0
    score: float | None = None
    obsolete: bool = False


class SearchResult(BaseModel):
    """Result of an HPO search query including deterministic provenance."""

    model_config = ConfigDict(extra="forbid")

    route: str
    query: str
    candidates: list[SearchCandidate] = Field(default_factory=list)
    displayed_ids: list[str] = Field(default_factory=list)
    ranked_ids: list[str] = Field(default_factory=list)
    shuffled: bool = False
    seed: str | None = None
    search_id: str | None = None
    index_identity: str | None = None


class HierarchyWarning(BaseModel):
    """Warning when two annotations in the same set form an ancestor-descendant pair."""

    model_config = ConfigDict(extra="forbid")

    parent_id: str
    child_id: str
    parent_label: str = ""
    child_label: str = ""
    message: str = ""
