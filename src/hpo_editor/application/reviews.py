"""Review application service and decision commands."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict

from hpo_editor.domain.annotations import AnnotationRef
from hpo_editor.domain.errors import DomainError
from hpo_editor.domain.review import ReviewDecision, ReviewOutcome
from hpo_editor.domain.workspace import Draft, MutationEnvelope, WorkspaceKey
from hpo_editor.ontology.service import OntologyService
from hpo_editor.storage.repository import Repository


class DecisionCommand(BaseModel):
    """Command recording a reviewer decision on a targeted annotation."""

    model_config = ConfigDict(extra="forbid")

    target: AnnotationRef
    outcome: ReviewOutcome
    replacement: AnnotationRef | None = None
    note: str | None = None


class ReviewService:
    """Coordinates review decisions against targeted proposals."""

    def __init__(self, repo: Repository, ontology: OntologyService) -> None:
        self.repo = repo
        self.ontology = ontology

    def parse_command(self, payload: dict[str, Any]) -> DecisionCommand:
        return DecisionCommand.model_validate(payload)

    def decide(self, key: WorkspaceKey, envelope: MutationEnvelope) -> Draft:
        """Transactionally record a review decision on a workspace draft."""
        if key.mode != "review":
            raise DomainError(
                "INVALID_WORKSPACE_MODE",
                f"Review decisions are only permitted in review mode, got '{key.mode}'",
            )
        cmd = self.parse_command(envelope.payload)

        def operation(draft: Draft) -> Draft:
            return self._execute_decision(draft, cmd, key)

        result = self.repo.run_mutation(key, envelope, operation)
        if not isinstance(result, Draft):
            raise ValueError(f"Expected Draft from run_mutation, got {type(result)}")
        return result

    def _execute_decision(
        self, draft: Draft, cmd: DecisionCommand, key: WorkspaceKey
    ) -> Draft:
        # 1. Target must be in target set
        target_in_set = any(
            t.annotation_id == cmd.target.annotation_id
            and t.version == cmd.target.version
            for t in draft.targets.targets
        )
        if not target_in_set:
            raise DomainError(
                "TARGET_NOT_IN_TARGET_SET",
                f"Target ({cmd.target.annotation_id}, {cmd.target.version}) "
                f"is not part of the active review target set",
            )

        # 2. Check obsolete/unknown term cannot be confirmed
        if cmd.outcome == "confirmed":
            target_snap = self.repo.get_annotation_snapshot(
                cmd.target.annotation_id, cmd.target.version
            )
            if target_snap is None:
                target_snap = next(
                    (
                        a
                        for a in draft.annotations
                        if a.annotation.annotation_id == cmd.target.annotation_id
                        and a.version == cmd.target.version
                    ),
                    None,
                )
            if target_snap is not None:
                status = self.ontology.validate_term(target_snap.annotation.hpo_id)
                if status.status == "obsolete":
                    raise DomainError(
                        "CANNOT_CONFIRM_OBSOLETE_TERM",
                        "Cannot confirm obsolete HPO term "
                        f"'{target_snap.annotation.hpo_id}'",
                    )
                if status.status == "unknown":
                    raise DomainError(
                        "CANNOT_CONFIRM_UNKNOWN_TERM",
                        "Cannot confirm unknown HPO term "
                        f"'{target_snap.annotation.hpo_id}'",
                    )

        # 3. Changed outcome requires replacement
        if cmd.outcome == "changed":
            if cmd.replacement is None:
                raise DomainError(
                    "REPLACEMENT_REQUIRED",
                    "A replacement AnnotationRef is required when outcome is 'changed'",
                )
        else:
            if cmd.replacement is not None:
                raise DomainError(
                    "UNEXPECTED_REPLACEMENT",
                    f"Replacement must be None when outcome is '{cmd.outcome}'",
                )

        decision = ReviewDecision(
            decision_id=f"dec-{cmd.target.annotation_id}",
            target=cmd.target,
            outcome=cmd.outcome,
            replacement=cmd.replacement,
            note=cmd.note,
            reviewer_id=key.annotator_id,
        )

        draft.decisions = [
            d
            for d in draft.decisions
            if d.target.annotation_id != cmd.target.annotation_id
        ] + [decision]

        return draft
