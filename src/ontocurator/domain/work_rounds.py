"""Explicit attempts and private immutable human inputs, independent of proposal sets."""

from collections.abc import Iterable
from typing import Any, Literal
from urllib.parse import quote

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ontocurator.domain.annotations import AnnotationRef, AnnotationSnapshot
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.errors import DomainError
from ontocurator.domain.serialization import decode_snapshot
from ontocurator.domain.variants import (
    VariantInfo,
    is_translation_chain,
    resolve_translation_lineage,
)
from ontocurator.domain.workspace import WorkspaceKey, WorkspaceMode

RoundKind = Literal["ordinary", "carry_forward", "clean_restart", "consolidation"]
RoundState = Literal["editable", "submitted", "superseded", "abandoned"]


class RoundInputView(BaseModel):
    model_config = ConfigDict(extra="forbid")
    input_id: str
    source_submission_id: str
    source_ref: AnnotationRef
    source_snapshot: AnnotationSnapshot
    target_snapshot: AnnotationSnapshot | None
    mapping_status: Literal["carried", "needs_review"]

    @model_validator(mode="before")
    @classmethod
    def decode(cls, value: Any) -> Any:
        if isinstance(value, dict):
            value = dict(value)
            for field in ("source_snapshot", "target_snapshot"):
                if isinstance(value.get(field), dict):
                    value[field] = decode_snapshot(value[field])
        return value


class WorkRoundView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    round_id: str
    project_key: str
    assignment_id: int
    document_id: str
    annotator_id: str
    kind: RoundKind
    mode: WorkspaceMode | None
    state: RoundState
    workflow_revision: int
    latest_submission_id: str | None = None
    predecessor_round_id: str | None = None
    input_manifest_sha256: str
    input_submission_ids: list[str] = Field(default_factory=list)
    workspace_key: WorkspaceKey | None = None
    active: bool


class SourceReviewObligation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cause_id: str
    cause_revision: int = 1
    code: Literal["SOURCE_UPDATE_UNREVIEWED"] = "SOURCE_UPDATE_UNREVIEWED"
    case_id: str
    language: str
    document_id: str
    old_source_document_id: str
    new_source_document_id: str
    translation_text_sha256: str
    old_source_text_sha256: str
    new_source_text_sha256: str
    reason: str
    destination: str


def derive_source_obligations(
    project: str, variants: Iterable[VariantInfo], resolved_causes: set[str]
) -> list[SourceReviewObligation]:
    """Derive obligations from immutable edges, including upload and CLI changes."""
    inventory = {v.document_id: v for v in variants}
    children: dict[str, list[VariantInfo]] = {}
    for variant in inventory.values():
        if variant.origin == "correction" and variant.derived_from:
            children.setdefault(variant.derived_from, []).append(variant)
    result = []
    for translation in sorted(inventory.values(), key=lambda v: v.document_id):
        if children.get(translation.document_id) or not is_translation_chain(
            translation, inventory.get
        ):
            continue
        _, source = resolve_translation_lineage(translation, inventory.get)
        seen = set()
        while children.get(source.document_id):
            candidates = children[source.document_id]
            if len(candidates) != 1 or source.document_id in seen:
                raise DomainError(
                    "VARIANT_SOURCE_UNKNOWN", "Correction ancestry is not linear"
                )
            seen.add(source.document_id)
            updated = candidates[0]
            if (
                updated.case_id,
                updated.external_id,
                updated.language,
                updated.version,
            ) != (
                source.case_id,
                source.external_id,
                source.language,
                source.version + 1,
            ):
                raise DomainError(
                    "VARIANT_SOURCE_UNKNOWN", "Invalid source correction edge"
                )
            identity = {
                "project": project,
                "translation": translation.document_id,
                "translation_hash": translation.text_sha256,
                "old_source": source.document_id,
                "old_hash": source.text_sha256,
                "new_source": updated.document_id,
                "new_hash": updated.text_sha256,
            }
            cause = "source-" + canonical_hash(identity)
            if cause not in resolved_causes:
                result.append(
                    SourceReviewObligation(
                        cause_id=cause,
                        case_id=translation.case_id,
                        language=translation.language,
                        document_id=translation.document_id,
                        old_source_document_id=source.document_id,
                        new_source_document_id=updated.document_id,
                        translation_text_sha256=translation.text_sha256,
                        old_source_text_sha256=source.text_sha256,
                        new_source_text_sha256=updated.text_sha256,
                        reason=f"Review translation against source version {updated.version}.",
                        destination=f"#/projects/{quote(project, safe='')}/cases/{quote(translation.case_id, safe='')}?variant={quote(translation.document_id, safe='')}",
                    )
                )
            source = updated
    return result
