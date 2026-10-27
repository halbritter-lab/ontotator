"""Task scope model and deterministic builder."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

from ontotator.domain.canonical import canonical_hash
from ontotator.domain.profiles import TaskProfile, profile_hash

WorkspaceMode = Literal["independent", "review", "proposal_check"]
# Modes with targets and decisions: the consolidator's review and
# "Annotate from proposals" (spec 2026-10-23 §1).
REVIEW_LIKE_MODES: frozenset[str] = frozenset({"review", "proposal_check"})


def is_review_like(mode: str) -> bool:
    return mode in REVIEW_LIKE_MODES


class TaskScope(BaseModel):
    """Execution scope defining active editable and reference layers for a workspace."""

    model_config = ConfigDict(extra="forbid")

    scope_id: str
    mode: WorkspaceMode
    editable_layer_ids: list[str]
    reference_layer_ids: list[str]


def build_scope(profile: TaskProfile, mode: WorkspaceMode) -> TaskScope:
    """Build deterministic task scope from profile and workspace mode."""
    editable = [
        layer.layer_id for layer in profile.layers if layer.access == "editable"
    ]
    if mode == "independent":
        reference: list[str] = []
    else:
        reference = [
            layer.layer_id for layer in profile.layers if layer.access == "reference"
        ]

    p_hash = profile_hash(profile)
    content = {
        "editable_layer_ids": editable,
        "mode": mode,
        "profile_hash": p_hash,
        "reference_layer_ids": reference,
    }
    scope_id = canonical_hash(content)
    return TaskScope(
        scope_id=scope_id,
        mode=mode,
        editable_layer_ids=editable,
        reference_layer_ids=reference,
    )
