from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Literal, Protocol, Self

from ontocurator.domain.annotations import AnnotationSnapshot
from ontocurator.domain.documents import EvidenceSnapshot
from ontocurator.domain.errors import InvalidAnnotation
from ontocurator.domain.profiles import TaskProfile, resolve_type


class _ProjectSettings(Protocol):
    @property
    def contiguous_mentions_only(self) -> bool: ...

    @property
    def allow_spanless_findings(self) -> bool: ...

    @property
    def require_spanless_note(self) -> bool: ...

    @property
    def require_chosen_axes(self) -> bool: ...

    @property
    def hidden_axis_values(self) -> Mapping[str, Mapping[str, Iterable[str]]]: ...


@dataclass(frozen=True)
class ProjectRules:
    """Opt-in annotation restrictions copied from a project's named settings."""

    contiguous_mentions_only: bool = False
    require_chosen_axes: bool = False
    hidden_axis_values: Mapping[str, Mapping[str, frozenset[str]]] = field(
        default_factory=dict
    )
    allow_spanless_findings: bool = True
    require_spanless_note: bool = True
    creation_defaults: Mapping[str, Mapping[str, Mapping[str, str]]] = field(
        default_factory=dict
    )
    annotation_policy_revision: int = 1

    @classmethod
    def of(cls, row: _ProjectSettings) -> Self:
        return cls(
            contiguous_mentions_only=row.contiguous_mentions_only,
            allow_spanless_findings=row.allow_spanless_findings,
            require_spanless_note=row.require_spanless_note,
            require_chosen_axes=row.require_chosen_axes,
            creation_defaults=getattr(row, "creation_defaults", {}),
            annotation_policy_revision=getattr(row, "annotation_policy_revision", 1),
            hidden_axis_values={
                layer: {axis: frozenset(values) for axis, values in axes.items()}
                for layer, axes in row.hidden_axis_values.items()
            },
        )


@dataclass(frozen=True)
class RuleViolation:
    """A project restriction violated by one annotation's immutable content."""

    annotation_id: str
    rule: Literal[
        "discontinuous_mention",
        "hidden_axis_value",
        "axis_not_chosen",
        "spanless_disallowed",
        "spanless_note_required",
    ]
    detail: dict[str, str]


def rule_violations(
    snapshots: Iterable[AnnotationSnapshot],
    evidence_by_id: Mapping[tuple[str, str], EvidenceSnapshot],
    profile: TaskProfile,
    rules: ProjectRules,
    *,
    at_submission: bool,
    enforce_spanless: bool = False,
) -> list[RuleViolation]:
    """Inspect snapshots without changing content or defaulted-axis provenance.

    Referenced evidence must resolve by both ID and immutable version, even
    when the contiguous rule is disabled. Results follow snapshot order, then
    evidence-reference order and the actual annotation type's profile axis order.
    """
    violations: list[RuleViolation] = []
    for item in snapshots:
        annotation = item.annotation
        annotation_type = resolve_type(profile, annotation.layer_id, annotation.type_id)
        for ref in annotation.evidence_refs:
            evidence = evidence_by_id.get((ref.evidence_id, ref.version))
            if (
                evidence is None
                or evidence.mention.evidence_id != ref.evidence_id
                or evidence.version != ref.version
            ):
                raise InvalidAnnotation(
                    f"Annotation '{annotation.annotation_id}' references missing or "
                    f"mismatched evidence ({ref.evidence_id}, {ref.version})"
                )
            if rules.contiguous_mentions_only and len(evidence.mention.segments) > 1:
                violations.append(
                    RuleViolation(
                        annotation.annotation_id,
                        "discontinuous_mention",
                        {"evidence_id": ref.evidence_id, "version": ref.version},
                    )
                )

        if enforce_spanless and not annotation.evidence_refs:
            if not rules.allow_spanless_findings:
                violations.append(
                    RuleViolation(annotation.annotation_id, "spanless_disallowed", {})
                )
            elif rules.require_spanless_note and not (
                annotation.note and annotation.note.strip()
            ):
                violations.append(
                    RuleViolation(
                        annotation.annotation_id, "spanless_note_required", {}
                    )
                )

        hidden_axes = rules.hidden_axis_values.get(annotation.layer_id, {})
        for axis in annotation_type.axes:
            value = annotation.axes_values.get(axis.id)
            if value is not None and value in hidden_axes.get(axis.id, frozenset()):
                violations.append(
                    RuleViolation(
                        annotation.annotation_id,
                        "hidden_axis_value",
                        {"axis": axis.id, "value": value},
                    )
                )
            if (
                at_submission
                and rules.require_chosen_axes
                and (
                    value is None or value == "" or axis.id in annotation.axes_defaulted
                )
            ):
                violations.append(
                    RuleViolation(
                        annotation.annotation_id, "axis_not_chosen", {"axis": axis.id}
                    )
                )
    return violations
