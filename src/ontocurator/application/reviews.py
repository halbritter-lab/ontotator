"""Review application service and decision commands."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict

from ontocurator.domain.annotations import AnnotationRef
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.errors import DomainError
from ontocurator.domain.profiles import resolve_type
from ontocurator.domain.review import ReviewDecision, ReviewOutcome
from ontocurator.domain.workspace import Draft, MutationEnvelope, WorkspaceKey
from ontocurator.ontology.registry import OntologyRegistry
from ontocurator.ontology.service import OntologyService
from ontocurator.storage.repository import Repository


class DecisionCommand(BaseModel):
    """Command recording a reviewer decision on a targeted annotation."""

    model_config = ConfigDict(extra="forbid")

    target: AnnotationRef
    outcome: ReviewOutcome
    replacement: AnnotationRef | None = None
    note: str | None = None


class ReviewService:
    """Coordinates review decisions against targeted proposals."""

    def __init__(
        self,
        repo: Repository,
        ontology: OntologyService | None = None,
        registry: OntologyRegistry | None = None,
    ) -> None:
        self.repo = repo
        self.ontology = ontology
        self.registry = registry

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

        available = {
            (a.annotation.annotation_id, a.version): a
            for a in self.repo.list_annotations_for_document(
                key.package_id, key.document_id
            )
        }
        target_snap = available.get((cmd.target.annotation_id, cmd.target.version))
        task_profile = self.repo.get_task_profile(key.package_id)

        if target_snap is None:
            raise DomainError(
                "TARGET_NOT_FOUND", "Target is unavailable in this document"
            )

        if cmd.outcome == "confirmed":
            ont_svc = None
            if self.registry is not None:
                ont_svc = self.registry.for_layer(
                    task_profile, target_snap.annotation.layer_id
                )
            elif self.ontology is not None:
                ont_svc = self.ontology

            if ont_svc is not None:
                status = ont_svc.validate_term(target_snap.annotation.term_id)
                if status.status in {"obsolete", "unknown"}:
                    raise DomainError(
                        f"CANNOT_CONFIRM_{status.status.upper()}_TERM",
                        f"Cannot confirm {status.status} term "
                        f"'{target_snap.annotation.term_id}'",
                    )

            target_type = resolve_type(
                task_profile,
                target_snap.annotation.layer_id,
                target_snap.annotation.type_id,
            )
            for axis in target_type.axes:
                if not axis.allow_empty:
                    val = target_snap.annotation.axes_values.get(axis.id)
                    if val is None or val == "":
                        raise DomainError(
                            "INCOMPLETE_AXES",
                            "Cannot confirm annotation with incomplete required axes",
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

        if cmd.replacement is not None:
            replacement = next(
                (
                    a
                    for a in draft.annotations
                    if a.annotation.annotation_id == cmd.replacement.annotation_id
                    and a.version == cmd.replacement.version
                ),
                None,
            )
            if replacement is None or replacement.document_id != key.document_id:
                raise DomainError(
                    "REPLACEMENT_NOT_FOUND",
                    "Replacement must be an exact current draft version",
                )
            if (
                replacement.annotation.layer_id != target_snap.annotation.layer_id
                or replacement.annotation.type_id != target_snap.annotation.type_id
            ):
                raise DomainError(
                    "REPLACEMENT_LAYER_TYPE_MISMATCH",
                    f"Replacement must belong to the same layer '{target_snap.annotation.layer_id}' "
                    f"and type '{target_snap.annotation.type_id}' as the target",
                )

            rep_type = resolve_type(
                task_profile,
                replacement.annotation.layer_id,
                replacement.annotation.type_id,
            )
            for axis in rep_type.axes:
                if not axis.allow_empty:
                    val = replacement.annotation.axes_values.get(axis.id)
                    if val is None or val == "":
                        raise DomainError(
                            "INCOMPLETE_AXES",
                            f"Cannot approve replacement with incomplete required axes: {axis.id}",
                        )

        decision = ReviewDecision(
            decision_id="dec-"
            + canonical_hash(
                {"workspace": key.model_dump(), "target": cmd.target.model_dump()}
            ),
            target=cmd.target,
            outcome=cmd.outcome,
            replacement=cmd.replacement,
            note=cmd.note,
            reviewer_id=key.annotator_id,
        )

        draft.decisions = [d for d in draft.decisions if d.target != cmd.target] + [
            decision
        ]

        # Invalidate target layer checkmark
        target_layer = target_snap.annotation.layer_id
        draft.checked_layer_ids = [
            lid for lid in draft.checked_layer_ids if lid != target_layer
        ]

        return draft
