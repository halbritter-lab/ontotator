from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator

from ontocurator.domain.annotations import AnnotationRef, AnnotationSnapshot
from ontocurator.domain.documents import EvidenceSnapshot
from ontocurator.domain.reanchor_resolution import (
    PendingReanchorRef,
    ReanchorResolution,
)
from ontocurator.domain.review import ReviewDecision, ReviewTargetSet
from ontocurator.domain.scopes import TaskScope

WorkspaceMode = Literal["independent", "review", "proposal_check"]


class WorkspaceKey(BaseModel):
    """Identifier for an isolated local workspace."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    project_key: str = Field(validation_alias=AliasChoices("project_key", "package_id"))
    document_id: str
    annotator_id: str
    mode: WorkspaceMode
    scope_id: str = ""
    target_set_id: str
    # A paired discriminator, omitted entirely from historical key serialization.
    format_version: Literal["ontocurator-workspace-key/v3"] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    round_id: str | None = Field(
        default=None, min_length=1, exclude_if=lambda value: value is None
    )

    @model_validator(mode="after")
    def require_complete_round_identity(self) -> "WorkspaceKey":
        if (self.format_version is None) != (self.round_id is None):
            raise ValueError(
                "Versioned workspace identity requires both format_version and round_id"
            )
        return self


class RoundInputResolution(BaseModel):
    model_config = ConfigDict(extra="forbid")
    input_id: str
    outcome: Literal["completed", "dismissed"]
    annotation_ref: AnnotationRef | None = None
    reason: str | None = None

    @model_validator(mode="after")
    def validate_resolution(self) -> "RoundInputResolution":
        if self.outcome == "completed" and self.annotation_ref is None:
            raise ValueError("Completed input requires an exact output finding")
        if self.outcome == "dismissed" and (
            self.annotation_ref is not None or not (self.reason or "").strip()
        ):
            raise ValueError("Dismissal requires a reason and no output finding")
        return self


class Draft(BaseModel):
    """Mutable, revisioned working state of a workspace."""

    model_config = ConfigDict(extra="forbid")

    key: WorkspaceKey
    targets: ReviewTargetSet
    revision: int
    # Server-owned draft policy metadata; historical receipts omit it.
    spanless_policy_version: Literal[1] | None = None
    reanchor_inputs_initialized_at: str | None = None
    annotations: list[AnnotationSnapshot] = Field(default_factory=list)
    evidence: list[EvidenceSnapshot] = Field(default_factory=list)
    decisions: list[ReviewDecision] = Field(default_factory=list)
    reanchor_inputs: list[PendingReanchorRef] = Field(default_factory=list)
    reanchor_resolutions: list[ReanchorResolution] = Field(default_factory=list)
    round_input_resolutions: list[RoundInputResolution] = Field(
        default_factory=list, exclude_if=lambda v: not v
    )
    checked_layer_ids: list[str] = Field(default_factory=list)

    @property
    def document_checked(self) -> bool:
        return len(self.checked_layer_ids) > 0

    @document_checked.setter
    def document_checked(self, value: bool) -> None:
        if value:
            if not self.checked_layer_ids:
                self.checked_layer_ids = ["hpo"]
        else:
            self.checked_layer_ids = []

    @model_validator(mode="before")
    @classmethod
    def decode_snapshots_if_raw(cls, data: Any) -> Any:
        if isinstance(data, dict):
            raw_snaps = data.get("annotations")
            if isinstance(raw_snaps, list):
                from ontocurator.domain.serialization import decode_snapshot

                snaps = []
                for s in raw_snaps:
                    if isinstance(s, dict):
                        snaps.append(decode_snapshot(s))
                    else:
                        snaps.append(s)
                d = dict(data)
                d["annotations"] = snaps
                data = d
            if data.get("document_checked") and not data.get("checked_layer_ids"):
                d = dict(data)
                d["checked_layer_ids"] = ["hpo"]
                data = d
        return data


class Submission(BaseModel):
    """Immutable local submission record."""

    model_config = ConfigDict(extra="forbid")

    format_version: str = "ontocurator-submission/v2"
    input_manifest_sha256: str | None = Field(
        default=None, exclude_if=lambda v: v is None
    )
    submission_id: str
    origin_key: WorkspaceKey
    scope: TaskScope | None = None
    targets: ReviewTargetSet
    draft_revision: int
    snapshots: list[AnnotationSnapshot]
    decisions: list[ReviewDecision]
    reanchor_inputs: list[PendingReanchorRef] = Field(default_factory=list)
    reanchor_resolutions: list[ReanchorResolution] = Field(default_factory=list)
    round_input_resolutions: list[RoundInputResolution] = Field(
        default_factory=list, exclude_if=lambda v: not v
    )
    checked_layer_ids: list[str] = Field(default_factory=list)
    document_checked: bool = True
    created_at: str

    @model_validator(mode="after")
    def validate_round_envelope(self) -> "Submission":
        if self.origin_key.round_id is not None:
            if (
                self.format_version != "ontocurator-submission/v3"
                or not self.input_manifest_sha256
            ):
                raise ValueError(
                    "Round submissions require the v3 envelope and frozen input digest"
                )
        elif self.input_manifest_sha256 is not None or self.round_input_resolutions:
            raise ValueError("Legacy submissions cannot carry round metadata")
        return self

    @model_validator(mode="before")
    @classmethod
    def decode_snapshots_if_raw(cls, data: Any) -> Any:
        if isinstance(data, dict):
            raw_snaps = data.get("snapshots")
            if isinstance(raw_snaps, list):
                from ontocurator.domain.serialization import decode_snapshot

                snaps = []
                for s in raw_snaps:
                    if isinstance(s, dict):
                        snaps.append(decode_snapshot(s))
                    else:
                        snaps.append(s)
                d = dict(data)
                d["snapshots"] = snaps
                return d
        return data


class ImportedSubmissionBinding(BaseModel):
    """Binding mapping an imported historical submission to a local package context."""

    model_config = ConfigDict(extra="forbid")

    local_key: WorkspaceKey
    submission_id: str


class MutationEnvelope(BaseModel):
    """Request envelope identifying a write attempt across retries."""

    model_config = ConfigDict(extra="forbid")

    mutation_id: str
    expected_revision: int
    payload: dict[str, Any]


class MutationReceipt(BaseModel):
    """Transactionally committed receipt for an idempotent mutation."""

    model_config = ConfigDict(extra="forbid")

    workspace_key: WorkspaceKey
    mutation_id: str
    request_hash: str
    response: dict[str, Any]
