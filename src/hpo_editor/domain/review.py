from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, model_validator

from hpo_editor.domain.annotations import AnnotationRef
from hpo_editor.domain.canonical import canonical_hash
from hpo_editor.domain.errors import InvalidAnnotation

ReviewOutcome = Literal["confirmed", "rejected", "changed", "uncertain"]


class ReviewDecision(BaseModel):
    """Review decision record for a targeted annotation snapshot."""

    model_config = ConfigDict(extra="forbid")

    decision_id: str
    target: AnnotationRef
    outcome: ReviewOutcome
    replacement: AnnotationRef | None = None
    note: str | None = None
    reviewer_id: str

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
