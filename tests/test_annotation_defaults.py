"""Creation intent and acknowledgement must survive the submission boundary."""

from types import SimpleNamespace

import pytest
from test_project_rules import annotation_snapshot
from test_project_rules_integration import draft_for

from ontotator.application.editing import CreateAnnotationCommand, EditingService
from ontotator.application.submissions import SubmissionService, SubmitCommand
from ontotator.domain.errors import DomainError
from ontotator.domain.project_rules import ProjectRules
from ontotator.domain.scopes import build_scope

pytest_plugins = ("test_project_rules",)


@pytest.mark.parametrize("chosen", [[], ["presence"]])
def test_creation_defaults_are_server_owned_and_only_explicit_values_are_chosen(
    profile, document, chosen
):
    rules = ProjectRules(
        creation_defaults={"second": {"target": {"presence": "yes", "context": "past"}}}
    )
    repo = SimpleNamespace(get_project_rules=lambda _: rules, project_pins=lambda _: {})
    ontology = SimpleNamespace(
        validate_term=lambda term: SimpleNamespace(status="valid", term_id=term)
    )
    cmd = CreateAnnotationCommand(
        annotation_id="new",
        term_id="TERM:2",
        layer_id="second",
        type_id="target",
        actor_id="a",
        axes_values={"presence": "yes"},
        chosen_axis_ids=chosen,
    )
    result = EditingService(repo, ontology)._create_annotation(
        draft_for(profile),
        cmd,
        document,
        profile,
        build_scope(profile, "independent"),
        {"second": ontology},
    )
    annotation = result.annotations[0].annotation
    assert annotation.axes_values == {"presence": "yes", "context": "past"}
    assert annotation.axes_defaulted == (
        ["context"] if chosen else ["context", "presence"]
    )


def test_warning_acknowledgement_binds_draft_and_policy_without_confirming(
    profile, document
):
    item = annotation_snapshot(profile, document, defaulted=["presence"])
    draft = draft_for(profile, annotations=[item])
    rules = ProjectRules(require_spanless_note=False, annotation_policy_revision=4)
    repo = SimpleNamespace(
        project_pins=lambda _: {},
        get_task_profile=lambda _: profile,
        get_submissions_for_workspace=lambda _: [],
        get_project_rules=lambda _: rules,
    )
    service = SubmissionService(repo)
    with pytest.raises(DomainError) as error:
        service._create_submission(draft, SubmitCommand(), draft.key)
    assert error.value.code == "AXIS_CONFIRMATION_WARNING"
    acknowledgement = error.value.details["acknowledgement"]
    assert acknowledgement["draft_revision"] == 7
    assert acknowledgement["policy_revision"] == 4
    command = SubmitCommand(warning_acknowledgement=acknowledgement)
    submission = service._create_submission(draft, command, draft.key)
    assert submission.snapshots[0].annotation.axes_defaulted == ["presence"]
    assert "warning_acknowledgement" not in submission.model_dump()
    draft.revision += 1
    with pytest.raises(DomainError) as stale:
        service._create_submission(draft, command, draft.key)
    assert stale.value.code == "AXIS_CONFIRMATION_WARNING"
    draft.revision -= 1
    rules = ProjectRules(require_spanless_note=False, annotation_policy_revision=5)
    with pytest.raises(DomainError) as stale_policy:
        service._create_submission(draft, command, draft.key)
    assert stale_policy.value.code == "AXIS_CONFIRMATION_WARNING"


@pytest.mark.parametrize(
    "defaults",
    [
        {"second": {"target": {"presence": "invented"}}},
        {"second": {"missing": {"presence": "yes"}}},
        {"missing": {"target": {"presence": "yes"}}},
        {"second": {"target": {"presence": "yes"}}},
    ],
)
def test_creation_defaults_reject_invalid_or_hidden_values(profile, defaults):
    from ontotator.projects import service

    with pytest.raises(DomainError) as error:
        service.validate_creation_defaults(
            profile, defaults, {"second": {"presence": ["yes"]}}
        )
    assert error.value.code == "SETTINGS_INVALID"


def test_legacy_supplied_nonpreset_values_preserve_explicit_creation_semantics(
    profile, document
):
    rules = ProjectRules(creation_defaults={"second": {"target": {"presence": "yes"}}})
    repo = SimpleNamespace(get_project_rules=lambda _: rules, project_pins=lambda _: {})
    ontology = SimpleNamespace(
        validate_term=lambda term: SimpleNamespace(status="valid", term_id=term)
    )
    command = CreateAnnotationCommand(
        annotation_id="new",
        term_id="TERM:2",
        layer_id="second",
        type_id="target",
        actor_id="a",
        axes_values={"presence": "yes", "context": "past"},
    )
    result = EditingService(repo, ontology)._create_annotation(
        draft_for(profile),
        command,
        document,
        profile,
        build_scope(profile, "independent"),
        {"second": ontology},
    )
    assert result.annotations[0].annotation.axes_defaulted == ["presence"]


def test_reanchor_never_fills_missing_source_axis_from_creation_presets(
    profile, document
):
    from ontotator.application.editing import RecreateReanchorCommand
    from ontotator.domain.annotations import AnnotationRef, snapshot
    from ontotator.domain.reanchor_resolution import PendingReanchorRef

    original = annotation_snapshot(profile, document)
    source = snapshot(
        original.annotation.model_copy(update={"axes_values": {"presence": "yes"}}),
        original.evidence,
        document,
        profile,
    )
    item = PendingReanchorRef(
        proposal_set_id=1,
        source_ref=AnnotationRef(annotation_id="ann", version=source.version),
    )
    draft = draft_for(profile, mode="review")
    draft.reanchor_inputs = [item]
    rules = ProjectRules(creation_defaults={"second": {"target": {"context": "past"}}})
    repo = SimpleNamespace(
        project_pins=lambda _: {},
        get_project_rules=lambda _: rules,
        verified_reanchor_source=lambda *_: source,
    )
    ontology = SimpleNamespace(
        validate_term=lambda term: SimpleNamespace(status="valid", term_id=term)
    )
    command = RecreateReanchorCommand(
        item=item,
        annotation_id="carried",
        evidence_id="new-ev",
        term_id="TERM:2",
        layer_id="second",
        type_id="target",
        segments=[{"start": 0, "end": 1}],
    )
    result = EditingService(repo, ontology)._execute_edit(
        draft,
        command,
        document,
        profile,
        build_scope(profile, "review"),
        {"second": ontology},
    )
    assert result.annotations[0].annotation.axes_values == {"presence": "yes"}
