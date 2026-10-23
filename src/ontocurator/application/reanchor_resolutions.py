"""Per-reviewer resolutions of immutable, frozen reanchor inputs."""

from typing import Literal

from pydantic import BaseModel, ConfigDict

from ontocurator.domain.annotations import AnnotationRef
from ontocurator.domain.errors import DomainError
from ontocurator.domain.reanchor_resolution import (
    PendingReanchorRef,
    ReanchorResolution,
)
from ontocurator.domain.scopes import build_scope, is_review_like
from ontocurator.domain.workspace import Draft, MutationEnvelope, WorkspaceKey
from ontocurator.storage.repository import Repository


class ResolveReanchorCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    item: PendingReanchorRef
    outcome: Literal["recreated", "dismissed"]
    replacement: AnnotationRef | None = None
    reason: str | None = None


def validate_resolution(
    repo: Repository, draft: Draft, resolution: ReanchorResolution
) -> None:
    if (
        not is_review_like(draft.key.mode)
        or resolution.item not in draft.reanchor_inputs
        or resolution.reviewer_id != draft.key.annotator_id
    ):
        raise DomainError("INVALID_REANCHOR_ITEM")
    scope = build_scope(repo.get_task_profile(draft.key.project_key), draft.key.mode)
    if draft.key.scope_id and draft.key.scope_id != scope.scope_id:
        raise DomainError("INVALID_SCOPE")
    source, _ = repo.reanchor_source_identity(draft.key, resolution.item)
    if resolution.outcome == "dismissed":
        return
    source = repo.verified_reanchor_source(draft.key, resolution.item)
    if source.annotation.layer_id not in scope.editable_layer_ids:
        raise DomainError("INVALID_REANCHOR_ITEM")
    replacement = next(
        (
            snap
            for snap in draft.annotations
            if resolution.replacement is not None
            and snap.annotation.annotation_id == resolution.replacement.annotation_id
            and snap.version == resolution.replacement.version
        ),
        None,
    )
    document = repo.get_document(draft.key.project_key, draft.key.document_id)
    ref = resolution.item.source_ref
    if (
        replacement is None
        or document is None
        or replacement.text_sha256 != document.text_sha256
        or replacement.document_id != draft.key.document_id
        or replacement.annotation.layer_id != source.annotation.layer_id
        or replacement.annotation.type_id != source.annotation.type_id
        or replacement.annotation.provenance.actor.actor_id != draft.key.annotator_id
        or replacement.annotation.provenance.actor.kind != "human"
        or f"{ref.annotation_id}:{ref.version}"
        not in replacement.annotation.provenance.source_refs
    ):
        raise DomainError("INVALID_REANCHOR_REPLACEMENT")


class ReanchorResolutionService:
    def __init__(self, repo: Repository) -> None:
        self.repo = repo

    def resolve(self, key: WorkspaceKey, envelope: MutationEnvelope) -> Draft:
        if not is_review_like(key.mode):
            raise DomainError("INVALID_WORKSPACE_MODE")
        cmd = ResolveReanchorCommand.model_validate(envelope.payload)

        def operation(draft: Draft) -> Draft:
            if cmd.outcome == "dismissed" and not (cmd.reason and cmd.reason.strip()):
                raise DomainError("REANCHOR_REASON_REQUIRED")
            resolution = ReanchorResolution(
                **cmd.model_dump(), reviewer_id=key.annotator_id
            )
            validate_resolution(self.repo, draft, resolution)
            draft.reanchor_resolutions = [
                existing
                for existing in draft.reanchor_resolutions
                if existing.item != cmd.item
            ] + [resolution]
            return draft

        result = self.repo.run_mutation(key, envelope, operation)
        assert isinstance(result, Draft)
        return result
