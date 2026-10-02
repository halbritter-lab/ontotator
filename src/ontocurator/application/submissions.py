"""Submission application service and submission commands."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict

from ontocurator.domain.annotations import AnnotationSnapshot
from ontocurator.domain.axes import EDITOR_AXES_CONFIG, validate_axes
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.errors import DomainError, IncompleteReview
from ontocurator.domain.profiles import TaskProfile, resolve_type
from ontocurator.domain.scopes import TaskScope, build_scope
from ontocurator.domain.workspace import (
    Draft,
    MutationEnvelope,
    Submission,
    WorkspaceKey,
)
from ontocurator.storage.repository import Repository


class SubmitCommand(BaseModel):
    """Command requesting completion and submission of a workspace."""

    model_config = ConfigDict(extra="forbid")

    command: str = "submit_workspace"
    document_checked: bool = True


def validate_completion(
    draft: Draft,
    profile: TaskProfile,
    scope: TaskScope,
    repo: Repository | None = None,
) -> None:
    """Validate that draft is completely ready for submission under task scope and profile."""
    # 1. All editable layers in scope must be marked as checked
    for layer_id in scope.editable_layer_ids:
        if layer_id not in draft.checked_layer_ids:
            raise DomainError(
                "LAYER_NOT_CHECKED",
                f"Editable layer '{layer_id}' has not been marked as checked",
            )

    # 2. Check draft annotations for required axes and evidence policies
    for snap in draft.annotations:
        type_def = resolve_type(profile, snap.annotation.layer_id, snap.annotation.type_id)
        if type_def.evidence_policy == "required_on_complete" and not snap.annotation.evidence_refs:
            raise DomainError(
                "MISSING_EVIDENCE",
                f"Annotation '{snap.annotation.annotation_id}' in layer '{snap.annotation.layer_id}' "
                f"requires evidence before submission",
            )
        for axis in type_def.axes:
            if not axis.allow_empty:
                val = snap.annotation.axes_values.get(axis.id)
                if val is None or val == "":
                    raise DomainError(
                        "INCOMPLETE_AXES",
                        f"Required axis '{axis.id}' is empty on annotation '{snap.annotation.annotation_id}'",
                    )

    # 3. If in review mode, validate review completeness
    if scope.mode == "review":
        target_refs = {(t.annotation_id, t.version) for t in draft.targets.targets}
        decided_targets = {(d.target.annotation_id, d.target.version) for d in draft.decisions}
        missing = [t for t in draft.targets.targets if (t.annotation_id, t.version) not in decided_targets]
        if missing:
            raise IncompleteReview(f"Review is incomplete: {len(missing)} targets lack a decision")
        if len(decided_targets) != len(draft.decisions) or decided_targets != target_refs:
            raise IncompleteReview("Decisions must match exactly the active review targets")


class SubmissionService:
    """Coordinates workspace completion, validation, and submission persistence."""

    def __init__(self, repo: Repository) -> None:
        self.repo = repo

    def parse_command(self, payload: dict[str, Any]) -> SubmitCommand:
        return SubmitCommand.model_validate(payload)

    def submit(self, key: WorkspaceKey, envelope: MutationEnvelope) -> Submission:
        """Transactionally validate and commit a workspace submission."""
        cmd = self.parse_command(envelope.payload)
        if not cmd.document_checked:
            raise DomainError(
                "DOCUMENT_NOT_CHECKED",
                "The document must be marked as checked before submitting",
            )

        def operation(draft: Draft) -> Submission:
            return self._create_submission(draft, cmd, key)

        result = self.repo.run_mutation(key, envelope, operation)
        if not isinstance(result, Submission):
            raise ValueError(
                f"Expected Submission from run_mutation, got {type(result)}"
            )
        return result

    def read(self, key: WorkspaceKey, submission_id: str) -> Submission:
        """Read a historical submission scoped to its local workspace."""
        sub = next(
            (
                s
                for s in self.repo.get_submissions_for_workspace(key)
                if s.submission_id == submission_id
            ),
            None,
        )
        if sub is None:
            raise DomainError(
                "SUBMISSION_NOT_FOUND", "Submission not found in this workspace"
            )
        return sub

    def _create_submission(
        self, draft: Draft, cmd: SubmitCommand, key: WorkspaceKey
    ) -> Submission:
        task_profile = self.repo.get_task_profile(key.package_id)
        scope = build_scope(task_profile, key.mode)

        # Validate completion against profile and scope
        validate_completion(draft, task_profile, scope, self.repo)

        snapshots: list[AnnotationSnapshot] = []
        decisions = list(draft.decisions)

        if key.mode == "review":
            members = {
                (a.annotation.annotation_id, a.version): a
                for a in self.repo.list_annotations_for_document(
                    key.package_id, key.document_id
                )
            }
            current = {
                (a.annotation.annotation_id, a.version): a for a in draft.annotations
            }
            for dec in draft.decisions:
                target = members.get((dec.target.annotation_id, dec.target.version))
                if target is None:
                    raise DomainError(
                        "TARGET_NOT_FOUND", "Reviewed target is unavailable"
                    )
                if dec.outcome == "confirmed":
                    snapshots.append(target)
                elif dec.outcome == "changed":
                    rep = dec.replacement
                    rep_snap = (
                        current.get((rep.annotation_id, rep.version)) if rep else None
                    )
                    if rep_snap is None:
                        raise DomainError(
                            "REPLACEMENT_NOT_FOUND",
                            "Approved replacement version is no longer in the draft",
                        )
                    snapshots.append(rep_snap)

            # Include any other new draft annotations not linked as replacements
            rep_ids = {
                d.replacement.annotation_id for d in draft.decisions if d.replacement
            }
            for a in draft.annotations:
                if a.annotation.annotation_id not in rep_ids:
                    snapshots.append(a)
        else:
            snapshots = list(draft.annotations)
            decisions = []

        # Deduplicate snapshots stably
        seen_snaps: set[tuple[str, str]] = set()
        deduped_snaps: list[AnnotationSnapshot] = []
        for s in snapshots:
            k = (s.annotation.annotation_id, s.version)
            if k not in seen_snaps:
                seen_snaps.add(k)
                deduped_snaps.append(s)

        canonical_content = {
            "key": key.model_dump(),
            "scope": scope.model_dump(),
            "targets": draft.targets.model_dump(),
            "draft_revision": draft.revision,
            "snapshots": [s.version for s in deduped_snaps],
            "decisions": [d.model_dump() for d in decisions],
        }
        sub_id = f"sub-{canonical_hash(canonical_content)[:16]}"

        return Submission(
            format_version="ontocurator-submission/v2",
            submission_id=sub_id,
            origin_key=key,
            scope=scope,
            targets=draft.targets,
            draft_revision=draft.revision + 1,
            snapshots=deduped_snaps,
            decisions=decisions,
            checked_layer_ids=list(draft.checked_layer_ids),
            document_checked=True,
            created_at=datetime.now(UTC).isoformat(),
        )
