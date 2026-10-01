from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ontocurator.domain.annotations import AnnotationSnapshot
from ontocurator.domain.documents import EvidenceSnapshot
from ontocurator.domain.review import ReviewDecision, ReviewTargetSet

WorkspaceMode = Literal["independent", "review"]


class WorkspaceKey(BaseModel):
    """Identifier for an isolated local workspace."""

    model_config = ConfigDict(extra="forbid")

    package_id: str
    document_id: str
    annotator_id: str
    mode: WorkspaceMode
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
    document_checked: bool = False


class Submission(BaseModel):
    """Immutable local submission record."""

    model_config = ConfigDict(extra="forbid")

    submission_id: str
    origin_key: WorkspaceKey
    targets: ReviewTargetSet
    draft_revision: int
    snapshots: list[AnnotationSnapshot]
    decisions: list[ReviewDecision]
    document_checked: bool
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
