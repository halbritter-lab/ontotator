from collections.abc import Mapping
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator

from ontocurator.domain.annotations import AnnotationSnapshot
from ontocurator.domain.axes import AxesConfig
from ontocurator.domain.documents import Document, EvidenceSnapshot, OntologyRef
from ontocurator.domain.profiles import TaskProfile
from ontocurator.domain.workspace import Submission, WorkspaceKey
from ontocurator.ontology.conditions import Digest, SearchCondition, SearchExecution


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
    search_condition_id: Digest | None = None
    execution: SearchExecution | None = None
    runtime_drift: bool | None = None

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


def is_tree_walk(event: SearchEventRecord) -> bool:
    """Whether an event is a walk through the ontology tree.

    The one definition, used wherever a walk is treated differently from a
    search: by ``tree/node``, when a walk gains terms, and on import.

    A walk shares ``route="browse"`` with the search's old route of that name
    and with the copy written for a selection. What sets it apart: nothing was
    selected (the copy for a selection is taken at one moment and never
    grows), and nothing was found by a search route or scored -- a search
    names the route of every candidate in ``candidate_routes``, a tree shows
    terms without ranking them.
    """
    return (
        event.route == "browse"
        and event.selected_term_id is None
        and not event.candidate_routes
        and not event.candidate_scores
    )


class PackageManifest(BaseModel):
    """Manifest describing work package metadata and checksums."""

    model_config = ConfigDict(extra="forbid")

    package_id: str
    format_version: Literal[
        "ontocurator-work-package/v3",
        "ontocurator-work-package/v2",
        "ontocurator-work-package/v1",
        "hpo-editor-work-package/v1",
    ] = "ontocurator-work-package/v2"
    workflow_history: dict[str, dict[str, Any]] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    proposal_annotation_refs: list[tuple[str, str]] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    proposal_evidence_refs: list[tuple[str, str]] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
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
    search_conditions: list[SearchCondition] | None = Field(
        default=None, max_length=128
    )

    @model_validator(mode="after")
    def validate_workflow_version(self) -> "PackageManifest":
        if self.format_version == "ontocurator-work-package/v3":
            if (
                self.workflow_history is None
                or self.proposal_annotation_refs is None
                or self.proposal_evidence_refs is None
            ):
                raise ValueError(
                    "V3 packages require explicit workflow and proposal inventories"
                )
        elif any(
            value is not None
            for value in (
                self.workflow_history,
                self.proposal_annotation_refs,
                self.proposal_evidence_refs,
            )
        ):
            raise ValueError(
                "Legacy package envelopes cannot contain v3 workflow metadata"
            )
        return self

    def model_dump(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        data = super().model_dump(*args, **kwargs)
        if self.search_conditions is None:
            data.pop("search_conditions", None)
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

    @model_validator(mode="after")
    def validate_workflow_inventory(self) -> "ValidatedPackage":
        if self.manifest.format_version != "ontocurator-work-package/v3":
            return self
        from ontocurator.domain.work_rounds import (
            ARCHIVED_REVIEW_REASONS,
            RoundInputView,
            WorkRoundView,
        )

        if not set(self.manifest.proposal_annotation_refs or []) <= set(
            self.annotations
        ) or not set(self.manifest.proposal_evidence_refs or []) <= set(self.evidence):
            raise ValueError("Proposal inventories reference missing exact snapshots")
        for rid, archived in (self.manifest.workflow_history or {}).items():
            view = WorkRoundView.model_validate(archived["round"])
            if view.round_id != rid or not set(archived["submission_ids"]) <= set(
                self.submissions
            ):
                raise ValueError(
                    "Invalid archived round identity or submission closure"
                )
            if not set(view.input_submission_ids) <= set(self.submissions):
                raise ValueError("Missing frozen human source submission")
            seen = set()
            needs_review: set[str] = set()
            for raw in archived["inputs"]:
                item = RoundInputView.model_validate(raw)
                # An input of a frozen draft (kind ``text_change``) has no
                # source submission; the draft is not packaged, so only its
                # exact snapshots are checked below.
                if item.input_id in seen:
                    raise ValueError("Ambiguous frozen round input")
                if item.source_draft_snapshot_id is not None:
                    if view.kind != "text_change":
                        raise ValueError("Ambiguous frozen round input")
                elif item.source_submission_id not in view.input_submission_ids:
                    raise ValueError("Ambiguous frozen round input")
                seen.add(item.input_id)
                if item.mapping_status == "needs_review":
                    needs_review.add(item.input_id)
                source = (
                    None
                    if item.source_submission_id is None
                    else self.submissions[item.source_submission_id]
                )
                if source is not None and not any(
                    s == item.source_snapshot
                    and (s.annotation.annotation_id, s.version)
                    == (item.source_ref.annotation_id, item.source_ref.version)
                    for s in source.snapshots
                ):
                    raise ValueError(
                        "Frozen round source does not match owning submission"
                    )
                for snap in [item.source_snapshot, item.target_snapshot]:
                    if (
                        snap is not None
                        and self.annotations.get(
                            (snap.annotation.annotation_id, snap.version)
                        )
                        != snap
                    ):
                        raise ValueError("Missing exact round snapshot closure")
            reasons = archived.get(ARCHIVED_REVIEW_REASONS, {})
            if (
                not isinstance(reasons, dict)
                or not set(reasons) <= needs_review
                or not all(isinstance(r, str) and r for r in reasons.values())
            ):
                raise ValueError("Review reasons must name needs-review inputs")
        return self
