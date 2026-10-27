from copy import deepcopy
from hashlib import sha256
from types import SimpleNamespace

import pytest

from ontotator.domain.annotations import (
    ActorRef,
    Annotation,
    AnnotationSnapshot,
    Provenance,
    snapshot,
)
from ontotator.domain.documents import (
    Document,
    EvidenceMention,
    EvidenceRef,
    EvidenceSnapshot,
    Segment,
)
from ontotator.domain.errors import InvalidAnnotation
from ontotator.domain.profiles import TaskProfile
from ontotator.domain.project_rules import (
    ProjectRules,
    RuleViolation,
    rule_violations,
)


@pytest.fixture
def profile() -> TaskProfile:
    return TaskProfile.model_validate(
        {
            "profile_id": "pure-rules",
            "version": "1",
            "ontologies": [
                {
                    "ontology_id": "terms",
                    "label": "Terms",
                    "release": "1",
                    "sha256": "abc",
                }
            ],
            "default_layer_id": "first",
            "layers": [
                {
                    "layer_id": layer,
                    "label": layer,
                    "ontology_id": "terms",
                    "access": "editable",
                    "default_type_id": "first-type",
                    "annotation_types": [
                        {"type_id": "first-type", "label": "First", "axes": []},
                        {
                            "type_id": "target",
                            "label": "Target",
                            "axes": [
                                {
                                    "id": "presence",
                                    "label": "Presence",
                                    "options": ["yes", "unknown"],
                                },
                                {
                                    "id": "context",
                                    "label": "Context",
                                    "options": ["current", "past"],
                                },
                            ]
                            if layer == "second"
                            else [
                                {
                                    "id": "first-axis",
                                    "label": "First axis",
                                    "options": ["other"],
                                }
                            ],
                        },
                    ],
                }
                for layer in ("first", "second")
            ],
        }
    )


@pytest.fixture
def document() -> Document:
    text = "abcdefghij"
    return Document(
        document_id="doc",
        text=text,
        language="en",
        text_sha256=sha256(text.encode()).hexdigest(),
    )


def evidence(
    document: Document, *, discontinuous: bool = True, cues: bool = False
) -> EvidenceSnapshot:
    return EvidenceSnapshot.create(
        EvidenceMention(
            evidence_id="ev",
            segments=[Segment(start=0, end=1), Segment(start=2, end=3)]
            if discontinuous
            else [Segment(start=0, end=3)],
            cue_segments=[Segment(start=4, end=5), Segment(start=6, end=7)]
            if cues
            else [],
        ),
        document,
    )


def annotation_snapshot(
    profile: TaskProfile,
    document: Document,
    *,
    annotation_id: str = "ann",
    axes: dict[str, str | None] | None = None,
    defaulted: list[str] | None = None,
    refs: list[EvidenceSnapshot] | None = None,
    layer: str = "second",
    type_id: str = "target",
) -> AnnotationSnapshot:
    refs = refs or []
    return snapshot(
        Annotation(
            annotation_id=annotation_id,
            document_id=document.document_id,
            layer_id=layer,
            type_id=type_id,
            term_id="TERM:1",
            axes_values=axes
            if axes is not None
            else {"presence": "yes", "context": "current"},
            axes_defaulted=defaulted or [],
            evidence_refs=[
                EvidenceRef(evidence_id=e.mention.evidence_id, version=e.version)
                for e in refs
            ],
            provenance=Provenance(
                actor=ActorRef(actor_id="tool", kind="tool"), method="import"
            ),
        ),
        refs,
        document,
        profile,
    )


def test_row_settings_are_copied_into_frozen_value_sets() -> None:
    hidden = {"second": {"presence": ["unknown"]}}
    row = SimpleNamespace(
        contiguous_mentions_only=True,
        allow_spanless_findings=False,
        require_spanless_note=False,
        require_chosen_axes=True,
        hidden_axis_values=hidden,
    )
    rules = ProjectRules.of(row)
    hidden["second"]["presence"].append("yes")
    hidden["second"]["context"] = ["past"]
    assert rules.allow_spanless_findings is False
    assert rules.require_spanless_note is False
    assert rules.contiguous_mentions_only is True
    assert rules.require_chosen_axes is True
    assert rules.hidden_axis_values == {"second": {"presence": frozenset({"unknown"})}}
    assert isinstance(rules.hidden_axis_values["second"]["presence"], frozenset)


def test_default_settings_preserve_optional_behavior(
    profile: TaskProfile, document: Document
) -> None:
    item = annotation_snapshot(profile, document, axes={})
    rules = ProjectRules.of(
        SimpleNamespace(
            contiguous_mentions_only=False,
            allow_spanless_findings=True,
            require_spanless_note=True,
            require_chosen_axes=False,
            hidden_axis_values={},
        )
    )
    assert rule_violations([item], {}, profile, rules, at_submission=True) == []


def test_a_two_segment_mention_violates_contiguous_only(
    profile: TaskProfile, document: Document
) -> None:
    ev = evidence(document)
    item = annotation_snapshot(profile, document, refs=[ev])
    assert rule_violations(
        [item],
        {("ev", ev.version): ev},
        profile,
        ProjectRules(contiguous_mentions_only=True),
        at_submission=False,
    ) == [
        RuleViolation(
            "ann", "discontinuous_mention", {"evidence_id": "ev", "version": ev.version}
        )
    ]


def test_it_passes_when_the_option_is_off(
    profile: TaskProfile, document: Document
) -> None:
    ev = evidence(document)
    item = annotation_snapshot(profile, document, refs=[ev])
    assert (
        rule_violations(
            [item],
            {("ev", ev.version): ev},
            profile,
            ProjectRules(),
            at_submission=True,
        )
        == []
    )


def test_cue_discontinuity_is_not_mention_discontinuity(
    profile: TaskProfile, document: Document
) -> None:
    ev = evidence(document, discontinuous=False, cues=True)
    item = annotation_snapshot(profile, document, refs=[ev])
    assert (
        rule_violations(
            [item],
            {("ev", ev.version): ev},
            profile,
            ProjectRules(contiguous_mentions_only=True),
            at_submission=True,
        )
        == []
    )


def test_document_level_annotations_need_no_evidence(
    profile: TaskProfile, document: Document
) -> None:
    item = annotation_snapshot(profile, document)
    assert (
        rule_violations(
            [item],
            {},
            profile,
            ProjectRules(contiguous_mentions_only=True),
            at_submission=True,
        )
        == []
    )


def test_unreferenced_evidence_is_not_checked(
    profile: TaskProfile, document: Document
) -> None:
    ev = evidence(document)
    item = annotation_snapshot(profile, document)
    assert (
        rule_violations(
            [item],
            {("ev", ev.version): ev},
            profile,
            ProjectRules(contiguous_mentions_only=True),
            at_submission=False,
        )
        == []
    )


def test_hidden_axis_values_are_violations_in_the_correct_layer(
    profile: TaskProfile, document: Document
) -> None:
    hidden = {
        "first": {"presence": frozenset({"yes"})},
        "second": {"presence": frozenset({"unknown"}), "context": frozenset({"yes"})},
    }
    allowed = annotation_snapshot(profile, document)
    refused = annotation_snapshot(
        profile,
        document,
        annotation_id="hidden",
        axes={"presence": "unknown", "context": "current"},
    )
    assert rule_violations(
        [allowed, refused],
        {},
        profile,
        ProjectRules(hidden_axis_values=hidden),
        at_submission=False,
    ) == [
        RuleViolation(
            "hidden", "hidden_axis_value", {"axis": "presence", "value": "unknown"}
        )
    ]


@pytest.mark.parametrize(
    "axes,defaulted",
    [
        ({}, []),
        ({"presence": None}, []),
        ({"presence": ""}, []),
        ({"presence": "yes"}, ["presence"]),
    ],
)
@pytest.mark.parametrize(
    "at_submission,enabled",
    [(False, False), (False, True), (True, False), (True, True)],
)
def test_unchosen_axes_only_matter_at_submission(
    profile: TaskProfile,
    document: Document,
    axes: dict[str, str | None],
    defaulted: list[str],
    at_submission: bool,
    enabled: bool,
) -> None:
    item = annotation_snapshot(
        profile, document, axes={**axes, "context": "current"}, defaulted=defaulted
    )
    violations = rule_violations(
        [item],
        {},
        profile,
        ProjectRules(require_chosen_axes=enabled),
        at_submission=at_submission,
    )
    assert violations == (
        [RuleViolation("ann", "axis_not_chosen", {"axis": "presence"})]
        if at_submission and enabled
        else []
    )


def test_same_default_value_is_allowed_when_actually_chosen(
    profile: TaskProfile, document: Document
) -> None:
    item = annotation_snapshot(profile, document)
    assert (
        rule_violations(
            [item],
            {},
            profile,
            ProjectRules(require_chosen_axes=True),
            at_submission=True,
        )
        == []
    )


def test_confirmed_proposal_defaults_count_as_chosen(
    profile: TaskProfile, document: Document
) -> None:
    item = annotation_snapshot(
        profile,
        document,
        axes={"presence": "yes", "context": "current"},
        defaulted=["presence"],
    )
    check = lambda decided: rule_violations(  # noqa: E731
        [item],
        {},
        profile,
        ProjectRules(require_chosen_axes=True),
        at_submission=True,
        decided_defaults=decided,
    )
    assert check(frozenset({("ann", item.version)})) == []
    assert check(frozenset({("ann", "other-version")})) == [
        RuleViolation("ann", "axis_not_chosen", {"axis": "presence"})
    ]


def test_required_axes_come_from_actual_nonfirst_type(
    profile: TaskProfile, document: Document
) -> None:
    no_axes_type = annotation_snapshot(profile, document, axes={}, type_id="first-type")
    target = annotation_snapshot(profile, document, axes={})
    assert rule_violations(
        [no_axes_type, target],
        {},
        profile,
        ProjectRules(require_chosen_axes=True),
        at_submission=True,
    ) == [
        RuleViolation("ann", "axis_not_chosen", {"axis": "presence"}),
        RuleViolation("ann", "axis_not_chosen", {"axis": "context"}),
    ]


def test_evidence_lookup_uses_both_id_and_version(
    profile: TaskProfile, document: Document
) -> None:
    continuous = evidence(document, discontinuous=False)
    discontinuous = evidence(document)
    first = annotation_snapshot(
        profile, document, annotation_id="continuous", refs=[continuous]
    )
    second = annotation_snapshot(
        profile, document, annotation_id="discontinuous", refs=[discontinuous]
    )
    lookup = {("ev", ev.version): ev for ev in (continuous, discontinuous)}
    assert rule_violations(
        [first, second],
        lookup,
        profile,
        ProjectRules(contiguous_mentions_only=True),
        at_submission=True,
    ) == [
        RuleViolation(
            "discontinuous",
            "discontinuous_mention",
            {"evidence_id": "ev", "version": discontinuous.version},
        )
    ]


@pytest.mark.parametrize("mismatch", ["missing", "version", "id"])
@pytest.mark.parametrize("enabled", [False, True])
def test_missing_or_mismatched_referenced_evidence_refuses(
    profile: TaskProfile, document: Document, mismatch: str, enabled: bool
) -> None:
    ev = evidence(document)
    item = annotation_snapshot(profile, document, refs=[ev])
    lookup = (
        {}
        if mismatch == "missing"
        else {
            ("ev", ev.version): ev.model_copy(update={"version": "other"})
            if mismatch == "version"
            else ev.model_copy(
                update={
                    "mention": ev.mention.model_copy(update={"evidence_id": "other"})
                }
            )
        }
    )
    with pytest.raises(InvalidAnnotation):
        rule_violations(
            [item],
            lookup,
            profile,
            ProjectRules(contiguous_mentions_only=enabled),
            at_submission=False,
        )


def test_multiple_rules_are_stable_and_do_not_mutate_inputs(
    profile: TaskProfile, document: Document
) -> None:
    ev = evidence(document)
    first = annotation_snapshot(
        profile,
        document,
        annotation_id="z",
        axes={"presence": "unknown"},
        defaulted=["presence"],
        refs=[ev],
    )
    second = annotation_snapshot(profile, document, annotation_id="a", axes={})
    items = [first, second]
    lookup = {("ev", ev.version): ev}
    rules = ProjectRules(True, True, {"second": {"presence": frozenset({"unknown"})}})
    before = deepcopy((items, lookup, profile, rules))
    expected = [
        RuleViolation(
            "z", "discontinuous_mention", {"evidence_id": "ev", "version": ev.version}
        ),
        RuleViolation(
            "z", "hidden_axis_value", {"axis": "presence", "value": "unknown"}
        ),
        RuleViolation("z", "axis_not_chosen", {"axis": "presence"}),
        RuleViolation("z", "axis_not_chosen", {"axis": "context"}),
        RuleViolation("a", "axis_not_chosen", {"axis": "presence"}),
        RuleViolation("a", "axis_not_chosen", {"axis": "context"}),
    ]
    assert (
        rule_violations(items, lookup, profile, rules, at_submission=True) == expected
    )
    assert (
        rule_violations(items, lookup, profile, rules, at_submission=True) == expected
    )
    assert (items, lookup, profile, rules) == before
    assert first.annotation.axes_defaulted == ["presence"]


def test_violation_order_follows_refs_and_profile_axes(
    profile: TaskProfile, document: Document
) -> None:
    first = EvidenceSnapshot.create(
        evidence(document).mention.model_copy(update={"evidence_id": "a"}), document
    )
    last = EvidenceSnapshot.create(
        evidence(document).mention.model_copy(update={"evidence_id": "z"}), document
    )
    item = annotation_snapshot(
        profile,
        document,
        refs=[last, first],
        axes={"context": "past", "presence": "unknown"},
    )
    lookup = {("z", last.version): last, ("a", first.version): first}
    rules = ProjectRules(
        contiguous_mentions_only=True,
        hidden_axis_values={
            "second": {
                "context": frozenset({"past"}),
                "presence": frozenset({"unknown"}),
            }
        },
    )
    assert rule_violations([item], lookup, profile, rules, at_submission=False) == [
        RuleViolation(
            "ann",
            "discontinuous_mention",
            {"evidence_id": "a", "version": first.version},
        ),
        RuleViolation(
            "ann",
            "discontinuous_mention",
            {"evidence_id": "z", "version": last.version},
        ),
        RuleViolation(
            "ann", "hidden_axis_value", {"axis": "presence", "value": "unknown"}
        ),
        RuleViolation("ann", "hidden_axis_value", {"axis": "context", "value": "past"}),
    ]


@pytest.mark.parametrize(
    "allowed, required, note, expected",
    [
        (False, True, "reason", "spanless_disallowed"),
        (False, False, "reason", "spanless_disallowed"),
        (True, True, None, "spanless_note_required"),
        (True, True, "   ", "spanless_note_required"),
        (True, True, "reason", None),
        (True, False, None, None),
        (True, False, "   ", None),
        (True, False, "reason", None),
    ],
)
def test_spanless_validation_is_explicitly_opted_in(
    profile, document, allowed, required, note, expected
):
    item = annotation_snapshot(profile, document)
    item = item.model_copy(
        update={"annotation": item.annotation.model_copy(update={"note": note})}
    )
    rules = ProjectRules(
        allow_spanless_findings=allowed, require_spanless_note=required
    )
    assert rule_violations([item], {}, profile, rules, at_submission=False) == []
    actual = rule_violations(
        [item], {}, profile, rules, at_submission=False, enforce_spanless=True
    )
    assert [v.rule for v in actual] == ([expected] if expected else [])
    assert all(v.annotation_id == "ann" for v in actual)
