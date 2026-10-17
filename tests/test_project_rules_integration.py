"""Service regressions that exercise materialized results without a database."""

from types import SimpleNamespace

import pytest
from test_project_rules import annotation_snapshot

from ontocurator.application.editing import (
    CreateAnnotationCommand,
    EditingService,
    SetAxesCommand,
)
from ontocurator.application.submissions import SubmissionService, SubmitCommand
from ontocurator.domain.errors import DomainError
from ontocurator.domain.project_rules import ProjectRules
from ontocurator.domain.review import ReviewDecision, ReviewTargetSet
from ontocurator.domain.scopes import build_scope
from ontocurator.domain.workspace import Draft, WorkspaceKey

pytest_plugins = ("test_project_rules",)


def draft_for(profile, *, mode="independent", annotations=(), targets=(), decisions=()):
    target_set = ReviewTargetSet.create(list(targets))
    return Draft(
        key=WorkspaceKey(
            project_key="project",
            document_id="doc",
            annotator_id="a",
            mode=mode,
            scope_id=build_scope(profile, mode).scope_id,
            target_set_id=target_set.target_set_id,
        ),
        targets=target_set,
        revision=7,
        annotations=list(annotations),
        decisions=list(decisions),
        checked_layer_ids=["first", "second"],
    )


@pytest.mark.parametrize("explicit, expected", [(False, ["presence"]), (True, [])])
def test_same_value_only_becomes_chosen_with_explicit_intent(
    profile, document, explicit, expected
):
    item = annotation_snapshot(profile, document, defaulted=["presence"])
    draft = draft_for(profile, annotations=[item])
    cmd = SetAxesCommand(
        annotation_id="ann",
        axes_values=item.annotation.axes_values,
        **({"chosen_axis_ids": ["presence"]} if explicit else {}),
    )
    service = EditingService(SimpleNamespace(), SimpleNamespace())
    result = service._set_axes(
        draft, cmd, document, profile, build_scope(profile, "independent")
    )
    assert result.annotations[0].annotation.axes_defaulted == expected


@pytest.mark.parametrize(
    "axis, value", [("invented", "yes"), ("presence", None), ("presence", "")]
)
def test_confirmation_requires_known_nonempty_axis(profile, document, axis, value):
    item = annotation_snapshot(profile, document)
    draft = draft_for(profile, annotations=[item])
    cmd = SetAxesCommand(
        annotation_id="ann", axes_values={"presence": value}, chosen_axis_ids=[axis]
    )
    service = EditingService(SimpleNamespace(), SimpleNamespace())
    with pytest.raises(DomainError) as exc:
        service._set_axes(
            draft, cmd, document, profile, build_scope(profile, "independent")
        )
    assert exc.value.code == "INVALID_AXES"


@pytest.mark.parametrize(
    "branch", ["own", "confirmed", "changed", "rejected", "uncertain"]
)
def test_submission_checks_materialized_result(profile, document, branch):
    item = annotation_snapshot(profile, document, defaulted=["presence"])
    from ontocurator.domain.annotations import AnnotationRef

    ref = AnnotationRef(annotation_id="ann", version=item.version)
    decisions = (
        []
        if branch == "own"
        else [
            ReviewDecision(
                decision_id="decision",
                reviewer_id="a",
                target=ref,
                outcome=branch,
                note="Further review required" if branch == "uncertain" else None,
                replacement=ref if branch == "changed" else None,
            )
        ]
    )
    draft = draft_for(
        profile,
        mode="independent" if branch == "own" else "review",
        annotations=[item] if branch in {"own", "changed"} else [],
        targets=[] if branch == "own" else [ref],
        decisions=decisions,
    )
    repo = SimpleNamespace(
        get_task_profile=lambda _: profile,
        get_submissions_for_workspace=lambda _: [],
        get_project_rules=lambda _: ProjectRules(require_chosen_axes=True),
        list_annotations_for_document=lambda *_: [item],
    )
    service = SubmissionService(repo)
    if branch in {"rejected", "uncertain"}:
        assert (
            service._create_submission(draft, SubmitCommand(), draft.key).snapshots
            == []
        )
    else:
        with pytest.raises(DomainError) as exc:
            service._create_submission(draft, SubmitCommand(), draft.key)
        assert exc.value.code == "PROJECT_RULE_VIOLATION"
        assert exc.value.details == {
            "violations": [
                {
                    "annotation_id": "ann",
                    "rule": "axis_not_chosen",
                    "detail": {"axis": "presence"},
                }
            ]
        }
    assert draft.revision == 7


@pytest.mark.parametrize("changed", [False, True])
def test_adopt_and_edit_inherits_only_unchanged_nonempty_defaults(
    profile, document, changed
):
    source = annotation_snapshot(profile, document, defaulted=["presence", "context"])
    repo = SimpleNamespace(list_annotations_for_document=lambda *_: [source])
    ontology = SimpleNamespace(
        validate_term=lambda term: SimpleNamespace(status="valid", term_id=term)
    )
    service = EditingService(repo, ontology)
    draft = draft_for(profile)
    values = {"presence": "unknown" if changed else "yes", "context": "current"}
    cmd = CreateAnnotationCommand(
        annotation_id="copy",
        term_id="TERM:2",
        layer_id="second",
        type_id="target",
        axes_values=values,
        source_annotation_id="ann",
        source_version=source.version,
        actor_id="a",
    )
    result = service._create_annotation(
        draft,
        cmd,
        document,
        profile,
        build_scope(profile, "independent"),
        {"second": ontology},
    )
    assert result.annotations[0].annotation.axes_defaulted == (
        ["context"] if changed else ["context", "presence"]
    )


@pytest.mark.parametrize(
    "change",
    [
        {"source_version": "fabricated"},
        {"source_version": None},
        {"source_annotation_id": "fabricated"},
        {"type_id": "first-type"},
    ],
)
def test_copy_requires_verified_exact_source(profile, document, change):
    source = annotation_snapshot(profile, document, defaulted=["presence"])
    repo = SimpleNamespace(list_annotations_for_document=lambda *_: [source])
    ontology = SimpleNamespace(
        validate_term=lambda term: SimpleNamespace(status="valid", term_id=term)
    )
    cmd = CreateAnnotationCommand(
        **(
            {
                "annotation_id": "copy",
                "term_id": "TERM:1",
                "layer_id": "second",
                "type_id": "target",
                "source_annotation_id": "ann",
                "source_version": source.version,
                "actor_id": "a",
            }
            | change
        )
    )
    with pytest.raises(DomainError) as exc:
        EditingService(repo, ontology)._create_annotation(
            draft_for(profile),
            cmd,
            document,
            profile,
            build_scope(profile, "independent"),
            {"second": ontology},
        )
    assert exc.value.code == "INVALID_ADOPTION_SOURCE"


def test_editor_projection_filters_every_type_and_legacy_axes_without_mutation(profile):
    from ontocurator.domain.axis_visibility import editor_profile, legacy_axes_config

    original = profile.model_dump()
    rules = ProjectRules(
        hidden_axis_values={
            "second": {"presence": frozenset({"unknown"})},
            "first": {"first-axis": frozenset({"other"})},
        }
    )
    projected = editor_profile(profile, rules)
    assert projected.layers[1].annotation_types[1].axes[0].options == ["yes"]
    assert projected.layers[0].annotation_types[1].axes[0].options == []
    assert legacy_axes_config(projected).axes[0].options == []
    assert profile.model_dump() == original


def test_confirmation_only_removes_requested_markers(profile, document):
    item = annotation_snapshot(profile, document, defaulted=["presence", "context"])
    result = EditingService(SimpleNamespace(), SimpleNamespace())._set_axes(
        draft_for(profile, annotations=[item]),
        SetAxesCommand(
            annotation_id="ann",
            axes_values=item.annotation.axes_values,
            chosen_axis_ids=["presence"],
        ),
        document,
        profile,
        build_scope(profile, "independent"),
    )
    assert result.annotations[0].annotation.axes_defaulted == ["context"]


@pytest.mark.parametrize("restricted", [False, True])
def test_materialized_result_resolves_distinct_versions_of_same_evidence_id(
    profile, document, restricted
):
    from test_project_rules import evidence

    continuous = evidence(document, discontinuous=False)
    discontinuous = evidence(document, discontinuous=True)
    own = annotation_snapshot(profile, document, annotation_id="own", refs=[continuous])
    target = annotation_snapshot(
        profile, document, annotation_id="target", refs=[discontinuous]
    )
    from ontocurator.domain.annotations import AnnotationRef

    ref = AnnotationRef(annotation_id="target", version=target.version)
    draft = draft_for(
        profile,
        mode="review",
        annotations=[own],
        targets=[ref],
        decisions=[
            ReviewDecision(
                decision_id="d", reviewer_id="a", target=ref, outcome="confirmed"
            )
        ],
    )
    repo = SimpleNamespace(
        get_task_profile=lambda _: profile,
        get_submissions_for_workspace=lambda _: [],
        get_project_rules=lambda _: ProjectRules(contiguous_mentions_only=restricted),
        list_annotations_for_document=lambda *_: [target],
    )
    if restricted:
        with pytest.raises(DomainError) as exc:
            SubmissionService(repo)._create_submission(
                draft, SubmitCommand(), draft.key
            )
        assert exc.value.details["violations"][0]["annotation_id"] == "target"
        assert (
            exc.value.details["violations"][0]["detail"]["version"]
            == discontinuous.version
        )
    else:
        result = SubmissionService(repo)._create_submission(
            draft, SubmitCommand(), draft.key
        )
        assert {s.annotation.annotation_id for s in result.snapshots} == {
            "own",
            "target",
        }


@pytest.mark.parametrize("branch", ["own", "confirmed", "changed"])
def test_new_draft_submission_validates_spanless_materialized_results(
    profile, document, branch
):
    from ontocurator.domain.annotations import AnnotationRef

    item = annotation_snapshot(profile, document)
    ref = AnnotationRef(annotation_id="ann", version=item.version)
    decisions = (
        []
        if branch == "own"
        else [
            ReviewDecision(
                decision_id="d",
                reviewer_id="a",
                target=ref,
                outcome=branch,
                replacement=ref if branch == "changed" else None,
            )
        ]
    )
    draft = draft_for(
        profile,
        mode="independent" if branch == "own" else "review",
        annotations=[item] if branch in {"own", "changed"} else [],
        targets=[] if branch == "own" else [ref],
        decisions=decisions,
    ).model_copy(update={"spanless_policy_version": 1})
    repo = SimpleNamespace(
        get_task_profile=lambda _: profile,
        get_submissions_for_workspace=lambda _: [],
        get_project_rules=lambda _: ProjectRules(),
        list_annotations_for_document=lambda *_: [item],
    )
    with pytest.raises(DomainError) as exc:
        SubmissionService(repo)._create_submission(draft, SubmitCommand(), draft.key)
    assert exc.value.code == "PROJECT_RULE_VIOLATION"
    assert exc.value.details["violations"][0]["rule"] == "spanless_note_required"


def test_spanless_note_cannot_override_required_profile_evidence(profile, document):
    from ontocurator.application.submissions import validate_annotation_completion
    from ontocurator.domain.annotations import snapshot

    profile.layers[1].annotation_types[1].evidence_policy = "required_on_complete"
    item = annotation_snapshot(profile, document)
    item = snapshot(
        item.annotation.model_copy(update={"note": "Reason"}), [], document, profile
    )
    with pytest.raises(DomainError) as exc:
        validate_annotation_completion(item, profile)
    assert exc.value.code == "MISSING_EVIDENCE"


def test_note_edit_invalidates_approved_exact_replacement_version(profile, document):
    from ontocurator.application.editing import SetAnnotationNoteCommand
    from ontocurator.domain.annotations import AnnotationRef

    item = annotation_snapshot(profile, document)
    ref = AnnotationRef(annotation_id="ann", version=item.version)
    decision = ReviewDecision(
        decision_id="d", reviewer_id="a", target=ref, outcome="changed", replacement=ref
    )
    draft = draft_for(
        profile, mode="review", annotations=[item], targets=[ref], decisions=[decision]
    )
    result = EditingService(SimpleNamespace(), SimpleNamespace())._set_annotation_note(
        draft,
        SetAnnotationNoteCommand(annotation_id="ann", note=" Reason "),
        document,
        profile,
        build_scope(profile, "review"),
    )
    assert result.annotations[0].annotation.note == "Reason"
    assert result.annotations[0].version != item.version
    assert result.decisions == []
    repo = SimpleNamespace(
        get_task_profile=lambda _: profile, get_submissions_for_workspace=lambda _: []
    )
    with pytest.raises(DomainError) as exc:
        SubmissionService(repo)._create_submission(result, SubmitCommand(), draft.key)
    assert exc.value.code == "INCOMPLETE_REVIEW"
