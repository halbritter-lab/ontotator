"""Project-local variant metadata and translation ancestry."""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal

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
