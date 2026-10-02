from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ontocurator.domain.annotations import AnnotationSnapshot
from ontocurator.domain.documents import EvidenceSnapshot
from ontocurator.domain.review import ReviewDecision, ReviewTargetSet
from ontocurator.domain.scopes import TaskScope

WorkspaceMode = Literal["independent", "review", "assisted"]


class WorkspaceKey(BaseModel):
    """Identifier for an isolated local workspace."""

    model_config = ConfigDict(extra="forbid")

    package_id: str
    document_id: str
    annotator_id: str
    mode: WorkspaceMode
    scope_id: str = ""
    target_set_id: str


class Draft(BaseModel):
    """Mutable, revisioned working state of a workspace."""

    model_config = ConfigDict(extra="forbid")

    key: WorkspaceKey
    targets: ReviewTargetSet
    revision: int
    annotations: list[AnnotationSnapshot] = Field(default_factory=list)
    evidence: list[EvidenceSnapshot] = Field(default_factory=list)
    decisions: list[ReviewDecision] = Field(default_factory=list)
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
    submission_id: str
    origin_key: WorkspaceKey
    scope: TaskScope | None = None
    targets: ReviewTargetSet
    draft_revision: int
    snapshots: list[AnnotationSnapshot]
    decisions: list[ReviewDecision]
    checked_layer_ids: list[str] = Field(default_factory=list)
    document_checked: bool = True
    created_at: str

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
