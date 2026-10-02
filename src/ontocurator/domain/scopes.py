"""Task scope model and deterministic builder."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.profiles import TaskProfile, profile_hash

WorkspaceMode = Literal["independent", "review", "assisted"]


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
