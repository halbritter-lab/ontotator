"""Pure logical-variant resolution before physical IDs or snapshot mapping."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from typing import TYPE_CHECKING, Any

from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.errors import DomainError
from ontocurator.domain.variants import (
    TRANSLATION_ORIGINS,
    TranslationStatus,
    VariantInfo,
    VariantOrigin,
    is_translation_chain,
    variant_document_id,
)

if TYPE_CHECKING:
    from ontocurator.exchange.plan import IncomingUnit

Identity = tuple[str, str, int]


@dataclass(frozen=True)
class PlannedVariant:
    document_id: str
    external_id: str
    language: str
    case_id: str
    version: int
    origin: VariantOrigin
    derived_from: str | None
    derived_in_upload: bool
    translation: dict[str, Any] | None
    status: TranslationStatus | None
    failed_checks: tuple[str, ...]
    status_reason: str | None = None
    # A newly imported translation the package marks as reviewed (D20).
    marked_in_package: bool = False


PACKAGE_REVIEWED = "Marked as reviewed in the package"


def marked_reviewed(translation: Mapping[str, Any] | None) -> bool:
    """``translation.review.status == "reviewed"``; anything else is not marked."""
    review = (translation or {}).get("review")
    return isinstance(review, Mapping) and review.get("status") == "reviewed"


PACKAGE_REVIEW_MAX = 500


def package_review(translation: Mapping[str, Any] | None) -> dict[str, str]:
    """Reviewer, time and note of a package review, sanitized for storage.

    Values become strings capped at ``PACKAGE_REVIEW_MAX`` characters;
    ``reviewed_at`` is kept only if it parses as an ISO date-time.
    """
    review = (translation or {}).get("review")
    if not isinstance(review, Mapping):
        return {}
    result: dict[str, str] = {}
    for name in ("reviewer", "reviewed_at", "note"):
        value = review.get(name)
        if value is None:
            continue
        text = str(value)[:PACKAGE_REVIEW_MAX]
        if name == "reviewed_at":
            try:
                datetime.fromisoformat(text)
            except ValueError:
                continue
        result[name] = text
    return result


def identity(unit: IncomingUnit) -> Identity:
    return (
        unit.document.document_id,
        unit.document.language,
        unit.variant.version if unit.variant else 1,
    )


def resolve_variants(
    units: Sequence[IncomingUnit],
    stored: Mapping[str, VariantInfo],
    documents: Mapping[str, str],
) -> tuple[list[PlannedVariant], dict[Identity, str], list[tuple[str, str, str]]]:
    """Stable DFS: logical source first, ties by external ID/language/version.

    Hash candidates represent logical variants, so repeated units and a supplied
    copy of a stored source never introduce artificial ambiguity.
    """
    inventory = dict(stored)
    grouped: dict[Identity, list[IncomingUnit]] = defaultdict(list)
    for unit in units:
        grouped[identity(unit)].append(unit)
        # Compatibility for legacy callers supplying only native ID/hash state.
        if unit.document.document_id in documents and not stored:
            doc = unit.document
            inventory.setdefault(
                doc.document_id,
                VariantInfo(
                    doc.document_id,
                    doc.document_id,
                    doc.document_id,
                    doc.language,
                    1,
                    "native",
                    None,
                    None,
                    None,
                    None,
                    documents[doc.document_id],
                ),
            )
    existing = {(v.external_id, v.language, v.version): v for v in inventory.values()}
    representatives = {
        key: sorted(values, key=lambda u: (u.label, canonical_hash(metadata(u))))[0]
        for key, values in grouped.items()
    }
    hashes: dict[str, set[Identity]] = defaultdict(set)
    for key, unit in representatives.items():
        hashes[unit.document.text_sha256].add(key)
    known_hashes: dict[str, set[Identity]] = defaultdict(set)
    for key, variant in existing.items():
        known_hashes[variant.text_sha256].add(key)
    resolved: dict[Identity, VariantInfo] = {}
    visiting: set[Identity] = set()
    failed: dict[Identity, DomainError] = {}
    output: list[PlannedVariant] = []
    occupied = set(documents) | set(inventory)

    def visit(key: Identity) -> VariantInfo:
        if key in resolved:
            return resolved[key]
        if key in failed:
            raise failed[key]
        if key not in representatives:
            return existing[key]
        if key in visiting:
            raise DomainError("VARIANT_VERSION_INVALID", "Source dependency cycle")
        visiting.add(key)
        unit = representatives[key]
        doc = unit.document
        old = existing.get(key)
        try:
            if len({u.document.text_sha256 for u in grouped[key]}) != 1 or (
                old and old.text_sha256 != doc.text_sha256
            ):
                raise DomainError(
                    "DOCUMENT_CONFLICT", "Logical variant already has different text"
                )
            cases = {u.case_id for u in grouped[key] if u.case_id is not None}
            runs = {
                canonical_hash(u.translation): u.translation
                for u in grouped[key]
                if u.translation is not None
            }
            declared = {
                canonical_hash(
                    u.variant.model_dump(mode="json")
                    if u.variant
                    else {"version": 1, "origin": "native", "derived_from": None}
                )
                for u in grouped[key]
            }
            if len(cases) > 1:
                raise DomainError(
                    "VARIANT_CASE_MISMATCH", "Conflicting explicit case identities"
                )
            if len(runs) > 1 or len(declared) > 1:
                raise DomainError(
                    "VARIANT_VERSION_INVALID",
                    "Conflicting explicit variant/run metadata",
                )
            unit = replace(
                unit,
                case_id=next(iter(cases), None),
                variant=next(
                    (u.variant for u in grouped[key] if u.variant is not None), None
                ),
                translation=next(iter(runs.values()), None),
            )
            marked = False
            if old:
                if unit.case_id is not None and unit.case_id != old.case_id:
                    raise DomainError(
                        "VARIANT_CASE_MISMATCH", "Stored case is immutable"
                    )
                if unit.variant:
                    source_hash = (
                        inventory[old.derived_from].text_sha256
                        if old.derived_from in inventory
                        else None
                    )
                    if (
                        unit.variant.origin != old.origin
                        or unit.variant.derived_from != source_hash
                        or (
                            unit.translation is not None
                            and unit.translation != old.translation
                        )
                    ):
                        raise DomainError(
                            "VARIANT_VERSION_INVALID",
                            "Stored variant ancestry and origin are immutable",
                        )
                result = old
                source_in_upload = old.derived_from is not None and any(
                    existing.get(k) and existing[k].document_id == old.derived_from
                    for k in representatives
                )
            else:
                case = unit.case_id
                source_key: Identity | None = None
                source: VariantInfo | None = None
                source_hash = unit.variant.derived_from if unit.variant else None
                if source_hash:
                    # Filter actual case identities before considering upload priority.
                    any_candidates = False
                    case_mismatch = False
                    for candidates in (
                        hashes.get(source_hash, set()),
                        known_hashes.get(source_hash, set()),
                    ):
                        compatible: list[tuple[Identity, VariantInfo]] = []
                        for candidate in sorted(candidates):
                            any_candidates = True
                            candidate_variant = visit(candidate)
                            if case is None or candidate_variant.case_id == case:
                                compatible.append((candidate, candidate_variant))
                            else:
                                case_mismatch = True
                        if len(compatible) > 1:
                            raise DomainError(
                                "VARIANT_SOURCE_AMBIGUOUS",
                                "Several logical sources match this hash and case",
                            )
                        if compatible:
                            source_key, source = compatible[0]
                            break
                    if source is None:
                        if any_candidates and case_mismatch:
                            raise DomainError(
                                "VARIANT_CASE_MISMATCH", "No case-compatible source"
                            )
                        raise DomainError(
                            "VARIANT_SOURCE_UNKNOWN",
                            "No source variant matches this hash",
                        )
                    case = source.case_id
                origin = unit.variant.origin if unit.variant else "native"
                previous_pair = any(
                    k[:2] == key[:2] and k != key
                    for k in set(existing) | set(representatives)
                )
                if (origin == "correction" or (key[2] > 1 and previous_pair)) and (
                    origin != "correction"
                    or source is None
                    or (source.external_id, source.language, source.version)
                    != (key[0], key[1], key[2] - 1)
                ):
                    raise DomainError(
                        "VARIANT_VERSION_INVALID",
                        "A correction must derive from the exact preceding version",
                    )
                doc_id = variant_document_id(key[0], key[1], key[2], occupied)
                status: TranslationStatus | None = None
                status_reason: str | None = None
                if origin in TRANSLATION_ORIGINS:
                    marked = marked_reviewed(unit.translation)
                    if marked:
                        status, status_reason = "accepted", PACKAGE_REVIEWED
                    else:
                        status = (
                            "automatic_check_failed"
                            if failed_checks(unit.translation)
                            else "ready_for_review"
                        )
                elif origin == "correction" and source:
                    try:
                        if is_translation_chain(source, inventory.get):
                            status = "ready_for_review"
                    except ValueError as error:
                        raise DomainError(
                            "VARIANT_VERSION_INVALID", str(error)
                        ) from error
                result = VariantInfo(
                    doc_id,
                    case or key[0],
                    key[0],
                    key[1],
                    key[2],
                    origin,
                    source.document_id if source else None,
                    unit.translation,
                    status,
                    status_reason,
                    doc.text_sha256,
                )
                source_in_upload = (
                    source_key in representatives if source_key else False
                )
                occupied.add(doc_id)
            resolved[key] = result
            inventory[result.document_id] = result
            output.append(
                PlannedVariant(
                    result.document_id,
                    result.external_id,
                    result.language,
                    result.case_id,
                    result.version,
                    result.origin,
                    result.derived_from,
                    source_in_upload,
                    result.translation,
                    result.translation_status,
                    failed_checks(result.translation),
                    result.status_reason,
                    marked,
                )
            )
            return result
        except DomainError as error:
            failed[key] = error
            raise
        finally:
            visiting.discard(key)

    issues = []
    for key in sorted(representatives):
        try:
            visit(key)
        except DomainError as error:
            for unit in grouped[key]:
                issues.append(
                    (
                        error.code,
                        unit.label,
                        f"{key[0]} ({key[1]}, v{key[2]}): {error.details}",
                    )
                )
    return output, {key: value.document_id for key, value in resolved.items()}, issues


def failed_checks(translation: dict[str, Any] | None) -> tuple[str, ...]:
    return tuple(
        sorted(
            {
                check["code"]
                for check in (translation or {}).get("checks", [])
                if not check["passed"]
            }
        )
    )


def metadata(unit: IncomingUnit) -> dict[str, Any]:
    return {
        "case_id": unit.case_id,
        "variant": unit.variant.model_dump(mode="json") if unit.variant else None,
        "translation": unit.translation,
    }
