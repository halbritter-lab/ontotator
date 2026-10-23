"""The annotation mode of a text (spec 2026-10-23 §1, decisions Q1-Q3, D2).

A text with tool proposals is annotated from proposals ("proposals") or from
scratch ("scratch"); a text without proposals is always annotated from
scratch. The project setting applies unless the text's plan overrides it; the
oldest annotation work on the text fixes the mode (stored on the assignment),
so existing work never mixes modes.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

AnnotationMode = Literal["proposals", "scratch"]
ANNOTATION_MODES: tuple[AnnotationMode, ...] = ("proposals", "scratch")
ModeSource = Literal["no_proposals", "locked", "plan", "project"]
# Mirrors domain.workspace.WorkspaceMode once P2 adds proposal_check; kept
# local so this module stays import-free of the workspace models.
WorkspaceModeName = Literal["independent", "review", "proposal_check"]


@dataclass(frozen=True)
class TextMode:
    mode: AnnotationMode
    source: ModeSource
    locked: bool


def text_mode(
    *,
    project_mode: AnnotationMode,
    plan_override: AnnotationMode | None,
    proposal_count: int,
    work_modes: Iterable[AnnotationMode],
) -> TextMode:
    """``work_modes``: modes of the text's annotation work, oldest first
    (non-revoked annotate assignments, revoked ones with submitted work, and
    annotation submissions; plan "Pure rule" 1). ``proposal_count`` counts
    the newest proposal set of the text's target document."""
    work = list(work_modes)
    if work:
        return TextMode(work[0], "locked", True)
    if proposal_count == 0:
        return TextMode("scratch", "no_proposals", False)
    if plan_override is not None:
        return TextMode(plan_override, "plan", False)
    return TextMode(project_mode, "project", False)


def workspace_mode(
    task: str, annotation_mode: AnnotationMode | None
) -> WorkspaceModeName:
    """The workspace an assignment opens (replaces ``MODE_FOR_TASK[task]``)."""
    if task == "review":
        return "review"  # the consolidator's workspace (L1: consolidation only)
    if task == "annotate":
        if annotation_mode is None:
            raise ValueError(
                "An annotate assignment always has a mode (migration 0021)"
            )
        return "proposal_check" if annotation_mode == "proposals" else "independent"
    raise ValueError(f"Task {task!r} has no annotation workspace")
