from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ontocurator.domain.annotations import AnnotationRef
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.errors import InvalidAnnotation

ReviewOutcome = Literal["confirmed", "rejected", "changed", "uncertain"]
ConsolidationAction = Literal["auto", "keep", "choose", "leave_out"]


class ConsolidationMark(BaseModel):
    """How a consolidation group was resolved (acceptance fixes spec,
    Persistence): stored on the resolving decisions of the group."""

    model_config = ConfigDict(extra="forbid")

    action: ConsolidationAction
    guidelines_unclear: bool = False
    # Hash of the consolidated annotation's content when resolved; None for
    # "leave_out". A differing current hash means "edited in the editor".
    content_sha256: str | None = None
    # The cons-… annotation a left-out standalone modifier was attached to
    # (S18); left out of the dump while unset, so decision hashes stay.
    attached_to: str | None = Field(
        default=None, exclude_if=lambda value: value is None
    )


class ReviewDecision(BaseModel):
    """Review decision record for a targeted annotation snapshot."""

    model_config = ConfigDict(extra="forbid")

    decision_id: str
    target: AnnotationRef
    outcome: ReviewOutcome
    replacement: AnnotationRef | None = None
    note: str | None = None
    reviewer_id: str
    # Left out of the dump while unset, so existing decision hashes stay.
    consolidation: ConsolidationMark | None = Field(
        default=None, exclude_if=lambda value: value is None
    )

    @model_validator(mode="after")
    def validate_outcome_and_replacement(self) -> Self:
        if self.outcome == "changed":
            if self.replacement is None:
                raise InvalidAnnotation(
                    "ReviewDecision with outcome 'changed' requires a "
                    "replacement AnnotationRef"
                )
        else:
            if self.replacement is not None:
                raise InvalidAnnotation(
                    f"ReviewDecision with outcome '{self.outcome}' must not "
                    f"have a replacement AnnotationRef"
                )
        return self


class ReviewTargetSet(BaseModel):
    """Immutable, sorted set of targeted annotation references for a review round."""

    model_config = ConfigDict(extra="forbid")

    target_set_id: str
    targets: list[AnnotationRef]

    @classmethod
    def create(cls, targets: list[AnnotationRef]) -> "ReviewTargetSet":
        # Sort stably by (annotation_id, version) and deduplicate
        seen: set[tuple[str, str]] = set()
        deduped: list[AnnotationRef] = []
        for t in sorted(targets, key=lambda x: (x.annotation_id, x.version)):
            key = (t.annotation_id, t.version)
            if key not in seen:
                seen.add(key)
                deduped.append(t)

        canonical_content = [t.model_dump() for t in deduped]
        target_set_id = canonical_hash(canonical_content)
        return cls(target_set_id=target_set_id, targets=deduped)
