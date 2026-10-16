"""Project-local variant metadata and translation ancestry."""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal

from ontocurator.domain.errors import DomainError

VariantOrigin = Literal[
    "native", "machine_translation", "human_translation", "correction"
]
TranslationStatus = Literal[
    "translated", "automatic_check_failed", "ready_for_review", "reviewed", "accepted"
]
TRANSLATION_ORIGINS = frozenset({"machine_translation", "human_translation"})


@dataclass(frozen=True)
class VariantInfo:
    document_id: str
    case_id: str
    external_id: str
    language: str
    version: int
    origin: VariantOrigin
    derived_from: str | None
    translation: dict[str, Any] | None
    translation_status: TranslationStatus | None
    status_reason: str | None
    text_sha256: str


def is_translation_chain(
    variant: VariantInfo, lookup: Callable[[str], VariantInfo | None]
) -> bool:
    seen: set[str] = set()
    current = variant
    while current.origin == "correction":
        if current.document_id in seen or current.derived_from is None:
            raise ValueError("Invalid variant ancestry")
        seen.add(current.document_id)
        predecessor = lookup(current.derived_from)
        if predecessor is None:
            raise ValueError("Missing variant ancestry")
        current = predecessor
    return current.origin in TRANSLATION_ORIGINS


def resolve_translation_lineage(
    variant: VariantInfo, lookup: Callable[[str], VariantInfo | None]
) -> tuple[VariantInfo, VariantInfo]:
    """Exact translation ancestor and its original source, never a newer sibling."""
    current = variant
    seen: set[str] = set()
    while current.origin == "correction":
        if current.document_id in seen:
            raise DomainError("VARIANT_SOURCE_UNKNOWN", "Cyclic correction ancestry")
        seen.add(current.document_id)
        previous = lookup(current.derived_from) if current.derived_from else None
        if previous is None or (
            previous.case_id,
            previous.external_id,
            previous.language,
            previous.version,
        ) != (
            current.case_id,
            current.external_id,
            current.language,
            current.version - 1,
        ):
            raise DomainError(
                "VARIANT_SOURCE_UNKNOWN", "Invalid correction predecessor"
            )
        current = previous
    if current.origin not in TRANSLATION_ORIGINS:
        raise DomainError("NOT_A_TRANSLATION")
    source = lookup(current.derived_from) if current.derived_from else None
    if (
        source is None
        or source.case_id != current.case_id
        or source.document_id in seen
        or source.document_id == current.document_id
    ):
        raise DomainError(
            "VARIANT_SOURCE_UNKNOWN", "Invalid original translation source"
        )
    return current, source


def variant_document_id(
    external_id: str, language: str, version: int, occupied: set[str]
) -> str:
    """D-o allocation shared by import and assigned-review correction producers."""
    result = (
        external_id
        if external_id not in occupied
        else f"{external_id}~{language}~v{version}"
    )
    if result in occupied:
        raise DomainError("VARIANT_ID_COLLISION", f"Internal ID {result} is occupied")
    return result
