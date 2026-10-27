"""Authenticated preset persistence, policy revision and workspace projection."""

from auth_harness import logged_in
from test_projects_api import create_project

pytest_plugins = ("test_projects_api",)


def test_lead_defaults_are_persisted_and_policy_revision_changes_only_with_policy(app):
    admin = logged_in(app, "root", system_admin=True)
    initial = create_project(app, admin)
    kind = initial["profile"]["layers"][0]["annotation_types"][0]["type_id"]
    lead = logged_in(app, "lead", projects={"phenotypes": ["lead"]})
    defaults = {"hpo-layer": {kind: {"assertion": "absent"}}}
    changed = lead.patch(
        "/api/v1/projects/phenotypes/settings", json={"creation_defaults": defaults}
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["creation_defaults"] == defaults
    assert (
        changed.json()["annotation_policy_revision"]
        == initial["annotation_policy_revision"] + 1
    )
    renamed = lead.patch(
        "/api/v1/projects/phenotypes/settings", json={"name": "Renamed"}
    )
    assert (
        renamed.json()["annotation_policy_revision"]
        == changed.json()["annotation_policy_revision"]
    )
    assert app.state.repo.get_project_rules("phenotypes").creation_defaults == defaults
    annotator = logged_in(app, "annotator", projects={"phenotypes": ["annotator"]})
    denied = annotator.patch(
        "/api/v1/projects/phenotypes/settings", json={"creation_defaults": {}}
    )
    assert denied.status_code in (403, 404)
    hidden = lead.patch(
        "/api/v1/projects/phenotypes/settings",
        json={"hidden_axis_values": {"hpo-layer": {"assertion": ["absent"]}}},
    )
    assert hidden.status_code == 422


def test_server_default_warning_submit_receipt_and_t1_keep_defaulted_basis(tmp_path):
    import ontospan
    import pytest
    from sqlalchemy import select, update
    from test_editing import _setup_test_env

    from ontotator.application.submissions import SubmissionService
    from ontotator.domain.errors import DomainError
    from ontotator.domain.workspace import MutationEnvelope, WorkspaceKey
    from ontotator.exchange.t1 import Pin, layers_for, submission_to_unit
    from ontotator.storage.tables import EditEventRow, ProjectRow

    repo, ontology, workspaces, editor, document = _setup_test_env(tmp_path)
    with repo.db.transaction() as conn:
        conn.execute(
            update(ProjectRow).values(
                creation_defaults={"hpo-layer": {"phenotype": {"assertion": "present"}}}
            )
        )
    view = workspaces.open(
        WorkspaceKey(
            project_key="pkg-1",
            document_id="doc-1",
            annotator_id="a",
            mode="independent",
            target_set_id="targets-0",
        )
    )
    assert view.require_chosen_axes is False
    assert view.creation_defaults["hpo-layer"]["phenotype"]["assertion"] == "present"
    draft = editor.apply(
        view.key,
        MutationEnvelope(
            mutation_id="create",
            expected_revision=0,
            payload={
                "command": "create_annotation",
                "annotation_id": "own",
                "term_id": "HP:0001252",
                "note": "Document-level finding",
                "chosen_axis_ids": [],
            },
        ),
    )
    assert draft.annotations[0].annotation.axes_defaulted == ["assertion"]
    submit = SubmissionService(repo, ontology)
    payload = {"document_checked": True, "checked_layer_ids": ["hpo-layer"]}
    with pytest.raises(DomainError) as warning:
        submit.submit(
            view.key,
            MutationEnvelope(
                mutation_id="submit", expected_revision=1, payload=payload
            ),
        )
    assert warning.value.code == "AXIS_CONFIRMATION_WARNING"
    payload["warning_acknowledgement"] = warning.value.details["acknowledgement"]
    envelope = MutationEnvelope(
        mutation_id="accepted", expected_revision=1, payload=payload
    )
    submission = submit.submit(view.key, envelope)
    assert submit.submit(view.key, envelope) == submission
    with repo.db.transaction() as conn:
        command = conn.execute(
            select(EditEventRow.command).where(
                EditEventRow.submission_id == submission.submission_id
            )
        ).scalar_one()
    assert command["warning_acknowledgement"] == payload["warning_acknowledgement"]
    profile = repo.get_task_profile("pkg-1")
    unit, _ = submission_to_unit(
        submission,
        document,
        profile,
        layers_for(profile, {"hp": Pin(ontology.ref.sha256, (), "generic")}),
        {},
        set_id="submitted",
    )
    assert unit.annotation_set.annotations[0].axes["assertion"].basis == "defaulted"
    assert ontospan.validate(unit).ok
