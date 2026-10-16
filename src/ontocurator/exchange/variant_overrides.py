"""One strict carrier and validation path for HTTP, persisted jobs and CLI."""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, ConfigDict, Field

from ontocurator.domain.errors import DomainError

if TYPE_CHECKING:
    from ontocurator.exchange.plan import ImportPlan


class StatusOverride(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    external_id: str
    language: str
    version: int = Field(ge=1)
    # Service owns the required OVERRIDE_REASON_REQUIRED domain response.
    reason: str


def normalize_overrides(
    values: Sequence[StatusOverride | dict[str, Any]],
) -> list[StatusOverride]:
    result = []
    seen: set[tuple[str, str, int]] = set()
    for value in values:
        item = (
            value
            if isinstance(value, StatusOverride)
            else StatusOverride.model_validate(value)
        )
        reason = item.reason.strip()
        if not reason:
            raise DomainError(
                "OVERRIDE_REASON_REQUIRED", "Accepting a translation requires a reason."
            )
        key = (item.external_id, item.language, item.version)
        if key in seen:
            raise DomainError("OVERRIDE_NOT_APPLICABLE", "Duplicate override target")
        seen.add(key)
        result.append(item.model_copy(update={"reason": reason}))
    return sorted(
        result, key=lambda item: (item.external_id, item.language, item.version)
    )


def validate_targets(
    plan: ImportPlan, values: Sequence[StatusOverride]
) -> dict[str, str]:
    variants = {(v.external_id, v.language, v.version): v for v in plan.variants}
    accepted = {}
    for item in normalize_overrides(values):
        variant = variants.get((item.external_id, item.language, item.version))
        if variant is None or variant.status is None:
            raise DomainError(
                "OVERRIDE_NOT_APPLICABLE",
                "Override must name a planned translation-chain variant",
            )
        accepted[variant.document_id] = item.reason
    return accepted


def parse_overrides(values: Sequence[str]) -> list[StatusOverride]:
    """Split from the right at :LANG:VERSION=; retain equals in ID/reason.

    The last matching language/version delimiter is authoritative, so ordinary
    colons in an external ID and equals signs in a reason are preserved.
    """
    result = []
    for value in values:
        match = re.fullmatch(r"(.+):([a-z]{2}):([1-9][0-9]*)=(.*)", value, re.DOTALL)
        if match is None:
            raise DomainError(
                "OVERRIDE_NOT_APPLICABLE", "Use EXTERNAL_ID:LANG:VERSION=REASON"
            )
        external_id, language, version, reason = match.groups()
        result.append(
            StatusOverride(
                external_id=external_id,
                language=language,
                version=int(version),
                reason=reason,
            )
        )
    return normalize_overrides(result)
