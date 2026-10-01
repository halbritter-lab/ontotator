"""Submission application service and submission commands."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict

from hpo_editor.domain.annotations import AnnotationSnapshot
from hpo_editor.domain.canonical import canonical_hash
from hpo_editor.domain.errors import DomainError, IncompleteReview
from hpo_editor.domain.workspace import (
    Draft,
    MutationEnvelope,
    Submission,
    WorkspaceKey,
)
from hpo_editor.storage.repository import Repository


class SubmitCommand(BaseModel):
    """Command requesting completion and submission of a workspace."""

    model_config = ConfigDict(extra="forbid")

    document_checked: bool = True


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
        sub = self.repo.get_submission(submission_id)
        if sub is None:
            raise DomainError(
                "SUBMISSION_NOT_FOUND",
                f"Submission '{submission_id}' not found",
            )
        if (
            sub.origin_key.package_id != key.package_id
            or sub.origin_key.document_id != key.document_id
        ):
            raise DomainError(
                "SUBMISSION_MISMATCH",
                f"Submission '{submission_id}' does not belong to workspace {key}",
            )
        return sub

    def _create_submission(
        self, draft: Draft, cmd: SubmitCommand, key: WorkspaceKey
    ) -> Submission:
        snapshots: list[AnnotationSnapshot] = []
        decisions = list(draft.decisions)

        if key.mode == "review":
            decided_targets = {
                (d.target.annotation_id, d.target.version) for d in draft.decisions
            }
            missing = [
                t
                for t in draft.targets.targets
                if (t.annotation_id, t.version) not in decided_targets
            ]
            if missing:
                raise IncompleteReview(
                    f"Review is incomplete: {len(missing)} targets lack a decision"
                )

            # Collect confirmed target snapshots
            for dec in draft.decisions:
                if dec.outcome == "confirmed":
                    snap = self.repo.get_annotation_snapshot(
                        dec.target.annotation_id, dec.target.version
                    )
                    if snap is not None:
                        snapshots.append(snap)
                elif dec.outcome == "changed" and dec.replacement:
                    rep_snap = next(
                        (
                            a
                            for a in draft.annotations
                            if a.annotation.annotation_id
                            == dec.replacement.annotation_id
                            and a.version == dec.replacement.version
                        ),
                        None,
                    )
                    if rep_snap is None:
                        rep_snap = self.repo.get_annotation_snapshot(
                            dec.replacement.annotation_id,
                            dec.replacement.version,
                        )
                    if rep_snap is not None:
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
            "targets": draft.targets.model_dump(),
            "draft_revision": draft.revision,
            "snapshots": [s.version for s in deduped_snaps],
            "decisions": [d.model_dump() for d in decisions],
        }
        sub_id = f"sub-{canonical_hash(canonical_content)[:16]}"

        return Submission(
            submission_id=sub_id,
            origin_key=key,
            targets=draft.targets,
            draft_revision=draft.revision + 1,
            snapshots=deduped_snaps,
            decisions=decisions,
            document_checked=True,
            created_at=datetime.now(UTC).isoformat(),
        )
