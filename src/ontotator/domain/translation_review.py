"""Pure translation-review decision table and resulting variant statuses."""

from typing import Literal

from ontospan import canonical_text
from pydantic import BaseModel, ConfigDict, Field

ReviewDecisionCode = Literal[
    "accepted_unchanged", "accepted_corrected", "query", "rejected"
]
ClinicalCategory = Literal[
    "omission", "addition", "assertion", "value", "anatomy", "terminology", "source"
]
REVIEW_POLICY = "ontotator-translation-review/v1"
# FD4: a lead correction is submitted only as "accepted_corrected".
LEAD_CORRECTION_DECISION = "LEAD_CORRECTION_DECISION"


class ReviewForm(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: ReviewDecisionCode
    clinical_change: bool
    categories: list[ClinicalCategory] = Field(default_factory=list)
    rationale: str | None = None


def check_review(
    form: ReviewForm,
    *,
    machine_text: str,
    proposed_text: str,
    failed_checks: bool = False,
) -> list[str]:
    """Return all issues in policy order, comparing canonical texts without mutation."""
    proposed = canonical_text(proposed_text)
    changed = proposed != canonical_text(machine_text)
    issues: list[str] = []
    if not proposed.strip():
        issues.append("TEXT_EMPTY")
    match form.decision:
        case "accepted_unchanged":
            if changed:
                issues.append("TEXT_CHANGED")
            if form.clinical_change:
                issues.append("CLINICAL_CHANGE_NOT_ALLOWED")
        case "accepted_corrected":
            if not changed:
                issues.append("TEXT_UNCHANGED")
        case "query" | "rejected":
            if not form.clinical_change:
                issues.append("CLINICAL_CHANGE_REQUIRED")
    if form.clinical_change and not form.categories:
        issues.append("CATEGORY_REQUIRED")
    if form.clinical_change and not (form.rationale or "").strip():
        issues.append("RATIONALE_REQUIRED")
    # R-12: accepting unchanged despite a failed automatic check needs a reason.
    elif (
        failed_checks
        and form.decision == "accepted_unchanged"
        and not (form.rationale or "").strip()
    ):
        issues.append("CHECK_RATIONALE_REQUIRED")
    if not form.clinical_change and form.categories:
        issues.append("CATEGORIES_WITHOUT_CHANGE")
    return issues


def next_status(
    decision: ReviewDecisionCode,
) -> tuple[Literal["accepted", "reviewed"], Literal["accepted"] | None]:
    """Statuses of the reviewed variant and optional newly corrected variant."""
    match decision:
        case "accepted_unchanged":
            return "accepted", None
        case "accepted_corrected":
            return "reviewed", "accepted"
        case "query" | "rejected":
            return "reviewed", None
        case _:
            raise ValueError(f"Unknown review decision: {decision}")
