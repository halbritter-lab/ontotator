"""Explicit attempts and private immutable human inputs, independent of proposal sets."""

from collections.abc import Iterable, Mapping
from datetime import datetime
from typing import Any, ClassVar, Literal
from urllib.parse import quote

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ontocurator.domain.annotations import AnnotationRef, AnnotationSnapshot
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.errors import DomainError
from ontocurator.domain.scopes import TaskScope
from ontocurator.domain.serialization import decode_snapshot, encode_snapshot
from ontocurator.domain.variants import (
    VariantInfo,
    is_translation_chain,
    resolve_translation_lineage,
)
from ontocurator.domain.workspace import WorkspaceKey, WorkspaceMode

RoundKind = Literal[
    "ordinary",
    "carry_forward",
    "clean_restart",
    "consolidation",
    "text_change",
    "handover",
]
# Rounds whose inputs are carried findings of earlier work, each needing a
# resolution before submit: the author's own carry-forward, a lead's move of a
# draft to a corrected text (``text_change``) and a lead's handover of another
# author's submission (``handover``). Their submissions keep the kind
# ``carry_forward`` (``submission_labels.submission_kind``).
CARRY_ROUND_KINDS: frozenset[str] = frozenset(
    {"carry_forward", "text_change", "handover"}
)
# Round kinds only the text-change operations create (``TextChangeService``).
TEXT_CHANGE_ROUND_KINDS: frozenset[str] = frozenset({"text_change", "handover"})
# Round kinds a person or lead may create directly (``POST .../rounds``).
CreatableRoundKind = Literal[
    "ordinary", "carry_forward", "clean_restart", "consolidation"
]
RoundState = Literal["editable", "submitted", "superseded", "abandoned"]


def is_exact_ancestor(
    variants: Mapping[str, VariantInfo], target_id: str, source_id: str
) -> bool:
    """Whether ``source_id`` is ``target_id`` or an exact correction ancestor.

    Every step is a correction of the same case, external ID and language
    whose version is one higher than its parent's.
    """
    current = variants[target_id]
    seen: set[str] = set()
    while current.document_id != source_id:
        parent = current.derived_from
        if (
            current.document_id in seen
            or current.origin != "correction"
            or parent is None
            or parent not in variants
        ):
            return False
        seen.add(current.document_id)
        previous = variants[parent]
        if (
            previous.case_id,
            previous.external_id,
            previous.language,
            previous.version + 1,
        ) != (current.case_id, current.external_id, current.language, current.version):
            return False
        current = previous
    return True


class RoundInputView(BaseModel):
    model_config = ConfigDict(extra="forbid")
    input_id: str
    # Exactly one source: a submission, or the frozen draft of a text change
    # (kind ``text_change``; ``draft_snapshots.id``).
    source_submission_id: str | None = None
    source_draft_snapshot_id: int | None = None
    source_ref: AnnotationRef
    source_snapshot: AnnotationSnapshot
    target_snapshot: AnnotationSnapshot | None
    mapping_status: Literal["carried", "needs_review"]
    # Read-only facts; stored payloads of older rounds carry none of these.
    # ``review_reason`` is stored for new rounds; the others are API-only.
    review_reason: str | None = None
    source_round_ordinal: int | None = None
    source_recorded_at: datetime | None = None
    source_language: str | None = None
    source_version: int | None = None

    # Keys package archives leave out, so older readers (extra="forbid") still
    # accept archived workflow history.
    NOT_ARCHIVED: ClassVar[frozenset[str]] = frozenset(
        {
            "review_reason",
            "source_round_ordinal",
            "source_recorded_at",
            "source_language",
            "source_version",
        }
    )

    @model_validator(mode="before")
    @classmethod
    def decode(cls, value: Any) -> Any:
        if isinstance(value, dict):
            value = dict(value)
            for field in ("source_snapshot", "target_snapshot"):
                if isinstance(value.get(field), dict):
                    value[field] = decode_snapshot(value[field])
        return value

    @model_validator(mode="after")
    def one_source(self) -> "RoundInputView":
        if (self.source_submission_id is None) == (
            self.source_draft_snapshot_id is None
        ):
            raise ValueError("A round input has exactly one source")
        return self


class DraftSnapshotPayload(BaseModel):
    """The frozen draft of an assignment moved to a corrected text.

    Stored in ``draft_snapshots.payload``; the snapshots keep their wire
    encoding (``encode_snapshot``) so the stored JSON is version-aware.
    """

    model_config = ConfigDict(extra="forbid")

    format_version: Literal["ontocurator-draft-snapshot/v1"] = (
        "ontocurator-draft-snapshot/v1"
    )
    # The old assignment's workspace key (document_id = the old version).
    origin_key: WorkspaceKey
    # ``build_scope(profile, origin_key.mode)`` at snapshot time.
    scope: TaskScope
    # Version number and text hash of ``origin_key.document_id``.
    document_version: int
    text_sha256: str
    snapshots: list[AnnotationSnapshot]

    @model_validator(mode="before")
    @classmethod
    def decode(cls, value: Any) -> Any:
        if isinstance(value, dict) and isinstance(value.get("snapshots"), list):
            value = dict(value)
            value["snapshots"] = [
                decode_snapshot(item) if isinstance(item, dict) else item
                for item in value["snapshots"]
            ]
        return value

    def stored(self) -> dict[str, Any]:
        """The JSON payload of the ``draft_snapshots`` row."""
        return {
            "format_version": self.format_version,
            "origin_key": self.origin_key.model_dump(mode="json"),
            "scope": self.scope.model_dump(mode="json"),
            "document_version": self.document_version,
            "text_sha256": self.text_sha256,
            "snapshots": [encode_snapshot(item) for item in self.snapshots],
        }


# Archived rounds (package ``workflow_history``) keep the inputs in the shape
# older readers validate with extra="forbid"; the ``review_reason`` of a
# needs-review input travels beside them as ``{input_id: reason}``, a key those
# readers never look at. Packages without the map import with no reasons.
ARCHIVED_REVIEW_REASONS = "review_reasons"


def archive_round(
    round_view: dict[str, Any],
    inputs: Iterable[dict[str, Any]],
    submission_ids: list[str],
) -> dict[str, Any]:
    """The ``workflow_history`` entry of one round, read facts left out."""
    archived_inputs = []
    reasons: dict[str, str] = {}
    for item in inputs:
        if item.get("review_reason") is not None:
            reasons[item["input_id"]] = item["review_reason"]
        archived_inputs.append(
            {k: v for k, v in item.items() if k not in RoundInputView.NOT_ARCHIVED}
        )
    entry: dict[str, Any] = {
        "round": round_view,
        "inputs": archived_inputs,
        "submission_ids": submission_ids,
    }
    if reasons:
        entry[ARCHIVED_REVIEW_REASONS] = reasons
    return entry


def archived_inputs(archived: dict[str, Any]) -> list[dict[str, Any]]:
    """The inputs of an archived round with their stored review reasons."""
    reasons = archived.get(ARCHIVED_REVIEW_REASONS) or {}
    return [
        dict(item) | {"review_reason": reasons[item["input_id"]]}
        if item["input_id"] in reasons
        else dict(item)
        for item in archived["inputs"]
    ]


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
    # Read-only facts filled by ``application.round_reads`` for API answers.
    round_ordinal: int | None = None
    created_at: datetime | None = None
    submission_count: int = 0
    latest_submission_recorded_at: datetime | None = None
    input_count: int = 0
    source_round_ordinal: int | None = None
    source_submission_recorded_at: datetime | None = None
    document_language: str | None = None
    document_version: int | None = None

    # The API-only facts above; package archives leave them out, so older
    # readers (extra="forbid") still accept archived workflow history.
    NOT_ARCHIVED: ClassVar[frozenset[str]] = frozenset(
        {
            "round_ordinal",
            "created_at",
            "submission_count",
            "latest_submission_recorded_at",
            "input_count",
            "source_round_ordinal",
            "source_submission_recorded_at",
            "document_language",
            "document_version",
        }
    )


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
