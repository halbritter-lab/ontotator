"""Provenance and request/response models for HPO search and term validation."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator

from ontocurator.domain.workspace import WorkspaceKey


class TermStatus(BaseModel):
    """Ontology status of a queried term ID."""

    model_config = ConfigDict(extra="forbid")

    term_id: str
    status: Literal["valid", "obsolete", "unknown"]
    label: str | None = None
    definition: str | None = None
    synonyms: list[str] = Field(default_factory=list)

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
            return super().model_copy(update=up, deep=deep)
        return super().model_copy(update=update, deep=deep)


class SearchRequest(BaseModel):
    """Search request scoped to a workspace mention/annotation."""

    model_config = ConfigDict(extra="forbid")

    workspace_key: WorkspaceKey
    annotation_id: str
    layer_id: str = "hpo-layer"
    query: str
    route: Literal["lexical", "exact", "id", "browse"] = "lexical"
    k: int = Field(default=10, ge=1, le=100)


class SearchCandidate(BaseModel):
    """Single candidate term returned by an ontology search route."""

    model_config = ConfigDict(extra="forbid")

    term_id: str
    label: str
    definition: str = ""
    matched_term: str = ""
    match_kind: str = ""
    rank: int = 0
    display_pos: int = 0
    score: float | None = None
    obsolete: bool = False

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
            return super().model_copy(update=up, deep=deep)
        return super().model_copy(update=update, deep=deep)


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
    layer_id: str | None = None
    ontology_sha256: str | None = None
    index_identity: str | None = None


class HierarchyWarning(BaseModel):
    """Warning when two annotations in the same set form an ancestor-descendant pair."""

    model_config = ConfigDict(extra="forbid")

    parent_id: str
    child_id: str
    parent_label: str = ""
    child_label: str = ""
    message: str = ""
