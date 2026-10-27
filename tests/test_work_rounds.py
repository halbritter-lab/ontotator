"""Real assignment and frozen-round lifecycle through application-role storage."""

import pytest
from sqlalchemy import insert
from test_editing import _setup_test_env

from ontotator.assignments.service import AssignmentService
from ontotator.auth.audit import Actor
from ontotator.authz.policy import Access
from ontotator.storage.tables import ProjectMembershipRow, UserLanguageRow, UserRow
from ontotator.storage.workflow_tables import WorkRoundStateRow


@pytest.fixture
def rounds(tmp_path):
    repo, ontology, _workspaces, _editor, _document = _setup_test_env(tmp_path)
    with repo.db.transaction() as conn:
        pid = repo._require_project(conn, "pkg-1")
        uid = conn.execute(
            insert(UserRow)
            .values(username="anna", display_name="Anna", pseudonym="anna")
            .returning(UserRow.id)
        ).scalar_one()
        conn.execute(
            insert(ProjectMembershipRow).values(
                project_id=pid, user_id=uid, role="annotator"
            )
        )
        conn.execute(insert(UserLanguageRow).values(user_id=uid, language="en"))
    assignment = AssignmentService(repo.db).assign(
        Actor.cli(), "pkg-1", "doc-1", "anna", "annotate"
    )
    access = Access(uid, "anna", False, roles={"pkg-1": frozenset({"annotator"})})
    return repo, access, Actor.user(uid, "anna"), assignment, ontology


def test_round_creation_is_idempotent_and_keeps_exact_assignment(rounds):
    from ontotator.application import work_rounds

    repo, access, actor, assignment, _ontology = rounds
    service = work_rounds.WorkRoundService(repo.db)
    created = service.create(
        access, actor, assignment.id, request_id="start", expected_workflow_revision=0
    )
    again = service.create(
        access, actor, assignment.id, request_id="start", expected_workflow_revision=0
    )
    assert created == again
    assert created.active and created.state == "editable"
    assert created.assignment_id == assignment.id
    assert created.workspace_key.round_id == created.round_id
    assert repo.get_work_round("pkg-1", created.round_id) == created
    assert repo.get_round_input_inventory("pkg-1", created.round_id) == []


def test_round_submit_carry_completion_and_clean_restart_preserve_old_work(rounds):
    from ontotator.application.editing import EditingService
    from ontotator.application.submissions import SubmissionService
    from ontotator.application.work_rounds import (
        RoundInputResolutionService,
        WorkRoundService,
    )
    from ontotator.authz.scoped import ScopedRepository
    from ontotator.domain.errors import DomainError
    from ontotator.domain.workspace import MutationEnvelope

    repo, access, actor, assignment, ontology = rounds
    scoped = ScopedRepository(repo.db, access, actor)
    rounds_service = WorkRoundService(repo.db)
    first = rounds_service.create(
        access,
        actor,
        assignment.id,
        request_id="ordinary",
        expected_workflow_revision=0,
    )
    key = first.workspace_key
    editor = EditingService(scoped, ontology)
    created = editor.apply(
        key,
        MutationEnvelope(
            mutation_id="create",
            expected_revision=0,
            payload={
                "command": "create_annotation",
                "annotation_id": "a",
                "term_id": "HP:0001252",
                "axes_values": {"assertion": "present"},
                "chosen_axis_ids": ["assertion"],
                "note": "Source",
            },
        ),
    )
    submission = SubmissionService(scoped, ontology).submit(
        key,
        MutationEnvelope(
            mutation_id="submit",
            expected_revision=created.revision,
            payload={"document_checked": True},
        ),
    )
    assert submission.format_version == "ontotator-submission/v3"
    assert (
        repo.get_round_for_submission("pkg-1", submission.submission_id).state
        == "submitted"
    )
    carried = rounds_service.create(
        access,
        actor,
        assignment.id,
        request_id="carry",
        expected_workflow_revision=1,
        kind="carry_forward",
        source_submission_ids=[submission.submission_id],
    )
    draft = scoped.open_draft(carried.workspace_key)
    assert len(draft.annotations) == 1 and draft.checked_layer_ids == []
    with pytest.raises(DomainError, match="ROUND_INPUTS_INCOMPLETE"):
        SubmissionService(scoped, ontology).submit(
            carried.workspace_key,
            MutationEnvelope(
                mutation_id="incomplete",
                expected_revision=0,
                payload={"document_checked": True},
            ),
        )
    item = repo.get_round_input_inventory("pkg-1", carried.round_id)[0]
    ref = {
        "annotation_id": draft.annotations[0].annotation.annotation_id,
        "version": draft.annotations[0].version,
    }
    done = RoundInputResolutionService(scoped).resolve(
        carried.workspace_key,
        MutationEnvelope(
            mutation_id="complete",
            expected_revision=0,
            payload={
                "input_id": item["input_id"],
                "outcome": "completed",
                "annotation_ref": ref,
            },
        ),
    )
    final = SubmissionService(scoped, ontology).submit(
        carried.workspace_key,
        MutationEnvelope(
            mutation_id="finish",
            expected_revision=done.revision,
            payload={"document_checked": True},
        ),
    )
    assert final.round_input_resolutions[0].input_id == item["input_id"]
    assert repo.get_submission(submission.submission_id, "pkg-1") == submission
    assert repo.list_workspace_keys("pkg-1", "anna")[0].round_id is not None
    # Receipts replay across a transition, but a new mutation on old keys is refused.
    assert (
        SubmissionService(scoped, ontology).submit(
            key,
            MutationEnvelope(
                mutation_id="submit",
                expected_revision=created.revision,
                payload={"document_checked": True},
            ),
        )
        == submission
    )
    with pytest.raises(DomainError):
        editor.apply(
            key,
            MutationEnvelope(
                mutation_id="stale",
                expected_revision=submission.draft_revision,
                payload={
                    "command": "set_annotation_note",
                    "annotation_id": "a",
                    "note": "Wrong round",
                },
            ),
        )


@pytest.mark.parametrize("changed", ["separation_policy", "profile"])
def test_consolidation_rechecks_actual_contributor_and_profile(rounds, changed):
    from sqlalchemy import update

    from ontotator.application.work_rounds import WorkRoundService
    from ontotator.domain.errors import DomainError
    from ontotator.storage.tables import ProjectRow

    repo, _, _, first, sources, lead, actor = create_consolidation_fixture(rounds)
    with repo.db.transaction() as conn:
        pid = repo._require_project(conn, "pkg-1")
        # Only one consolidation per text may be editable (R-1).
        conn.execute(
            update(WorkRoundStateRow)
            .where(WorkRoundStateRow.round_id == first.round_id)
            .values(state="submitted")
        )
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.id == pid)
            .values(adjudicator_not_annotator=False)
        )
        conn.execute(
            insert(ProjectMembershipRow).values(
                project_id=pid, user_id=lead.user_id, role="adjudicator"
            )
        )
    from work_plan_support import review_task

    assignment = review_task(repo.db, "pkg-1", "doc-1", "anna")
    with repo.db.transaction() as conn:
        if changed == "separation_policy":
            conn.execute(
                update(ProjectRow)
                .where(ProjectRow.id == pid)
                .values(adjudicator_not_annotator=True)
            )
        else:
            profile = repo.get_task_profile("pkg-1").model_dump(mode="json")
            profile["layers"][0]["layer_id"] = "different-layer"
            profile["default_layer_id"] = "different-layer"
            conn.execute(
                update(ProjectRow)
                .where(ProjectRow.id == pid)
                .values(task_profile=profile)
            )
    with pytest.raises(DomainError, match="ROUND_INPUT_INVALID"):
        WorkRoundService(repo.db).create(
            lead,
            actor,
            assignment.id,
            request_id="invalid-consolidation",
            expected_workflow_revision=0,
            kind="consolidation",
            source_submission_ids=[s.submission_id for s in sources],
        )


def create_consolidation_fixture(rounds):
    """Real private submissions with colliding local IDs and one assigned reviewer."""
    from ontotator.application.editing import EditingService
    from ontotator.application.submissions import SubmissionService
    from ontotator.application.work_rounds import WorkRoundService
    from ontotator.authz.scoped import ScopedRepository
    from ontotator.domain.workspace import MutationEnvelope

    repo, access, actor, assignment, ontology = rounds
    with repo.db.transaction() as conn:
        pid = repo._require_project(conn, "pkg-1")
        conn.execute(
            insert(ProjectMembershipRow).values(
                project_id=pid, user_id=access.user_id, role="lead"
            )
        )
    actors = [(access, actor, assignment)]
    for name, role, task in [
        ("ben", "annotator", "annotate"),
        ("reviewer", "adjudicator", "review"),
    ]:
        with repo.db.transaction() as conn:
            uid = conn.execute(
                insert(UserRow)
                .values(username=name, display_name=name, pseudonym=name)
                .returning(UserRow.id)
            ).scalar_one()
            conn.execute(
                insert(ProjectMembershipRow).values(
                    project_id=pid, user_id=uid, role=role
                )
            )
            conn.execute(insert(UserLanguageRow).values(user_id=uid, language="en"))
        if task == "review":
            # D1: the consolidator's task, as a consolidation start creates it.
            from work_plan_support import review_task

            assigned = review_task(repo.db, "pkg-1", "doc-1", name)
        else:
            from auth_harness import harness_annotation

            with harness_annotation(repo.db, "pkg-1", "doc-1", task):
                assigned = AssignmentService(repo.db).assign(
                    Actor.cli(), "pkg-1", "doc-1", name, task
                )
        identity = Access(uid, name, False, {"pkg-1": frozenset({role})})
        actors.append((identity, Actor.user(uid, name), assigned))
    inputs = []
    for identity, who, assigned in actors[:2]:
        scoped = ScopedRepository(repo.db, identity, who)
        item = WorkRoundService(repo.db).create(
            identity,
            who,
            assigned.id,
            request_id=f"start-{who.label}",
            expected_workflow_revision=0,
        )
        EditingService(scoped, ontology).apply(
            item.workspace_key,
            MutationEnvelope(
                mutation_id="create",
                expected_revision=0,
                payload={
                    "command": "create_annotation",
                    "annotation_id": "same-local-id",
                    "term_id": "HP:0001252",
                    "axes_values": {"assertion": "present"},
                    "chosen_axis_ids": ["assertion"],
                    "note": "Personal source",
                },
            ),
        )
        inputs.append(
            SubmissionService(scoped, ontology).submit(
                item.workspace_key,
                MutationEnvelope(
                    mutation_id="submit",
                    expected_revision=1,
                    payload={"document_checked": True},
                ),
            )
        )
    reviewer, reviewer_actor, review_assignment = actors[2]
    result = WorkRoundService(repo.db).create(
        access,
        actor,
        review_assignment.id,
        request_id="consolidate",
        expected_workflow_revision=0,
        kind="consolidation",
        source_submission_ids=[s.submission_id for s in inputs],
    )
    return (
        repo,
        ontology,
        ScopedRepository(repo.db, reviewer, reviewer_actor),
        result,
        inputs,
        access,
        actor,
    )


def reopen_automatic(repo, reviewer, result, revision):
    """Reopen the group kept automatically at the start (the fixture's two
    inputs match), so a test can decide in the editor alone."""
    from ontotator.application.consolidation_resolve import (
        ConsolidationGroupService,
    )
    from ontotator.domain.workspace import MutationEnvelope

    inventory = repo.get_round_input_inventory("pkg-1", result.round_id)
    return ConsolidationGroupService(reviewer).reopen(
        result.workspace_key,
        MutationEnvelope(
            mutation_id="reopen-automatic",
            expected_revision=revision,
            payload={"input_ids": [i["input_id"] for i in inventory]},
        ),
    )


def test_consolidation_frozen_collision_inputs_open_decide_submit_and_export(rounds):
    from ontotator.application.reviews import ReviewService
    from ontotator.application.submissions import SubmissionService
    from ontotator.application.workspaces import WorkspaceService
    from ontotator.domain.workspace import MutationEnvelope

    repo, ontology, reviewer, result, inputs, _lead, _actor = (
        create_consolidation_fixture(rounds)
    )
    view = WorkspaceService(reviewer, ontology).open(result.workspace_key)
    assert len(view.available_inputs) == 2
    assert len({s.annotation.annotation_id for s in view.available_inputs}) == 2
    inventory = repo.get_round_input_inventory("pkg-1", result.round_id)
    assert {i["source_submission_id"] for i in inventory} == {
        s.submission_id for s in inputs
    }
    draft = reopen_automatic(repo, reviewer, result, view.draft.revision)
    for index, target in enumerate(view.targets.targets):
        draft = ReviewService(reviewer).decide(
            result.workspace_key,
            MutationEnvelope(
                mutation_id=f"decision-{index}",
                expected_revision=draft.revision,
                payload={"target": target.model_dump(), "outcome": "confirmed"},
            ),
        )
    output = SubmissionService(reviewer, ontology).submit(
        result.workspace_key,
        MutationEnvelope(
            mutation_id="submit",
            expected_revision=draft.revision,
            payload={"document_checked": True},
        ),
    )
    assert len(output.snapshots) == 2
    assert all(
        s.origin_key.annotator_id != output.origin_key.annotator_id for s in inputs
    )
    content = repo.t1_export_content_exact("pkg-1", [output.submission_id])
    assert len(content.proposals) >= 2
    assert (
        repo.get_round_for_submission("pkg-1", output.submission_id).kind
        == "consolidation"
    )


def test_v3_package_roundtrip_retains_private_input_closure_without_promotion(rounds):
    from ontotator.domain.canonical import canonical_hash

    repo, _ontology, _reviewer, result, inputs, _lead, _actor = (
        create_consolidation_fixture(rounds)
    )
    package = repo.export_package("pkg-1")
    assert package.manifest.format_version == "ontotator-work-package/v3"
    original = {
        s.submission_id: canonical_hash(s.model_dump(mode="json")) for s in inputs
    }
    cloned = package.model_copy(
        update={
            "manifest": package.manifest.model_copy(update={"package_id": "roundtrip"})
        }
    )
    repo.import_package(cloned)
    assert repo.list_annotations_for_document("roundtrip", "doc-1") == []
    history = repo.get_work_round("roundtrip", result.round_id)
    assert not history.active
    assert len(repo.get_round_input_inventory("roundtrip", result.round_id)) == 2
    for sid, digest in original.items():
        assert (
            canonical_hash(
                repo.get_submission(sid, "roundtrip").model_dump(mode="json")
            )
            == digest
        )
    again = repo.export_package("roundtrip")
    assert again.manifest.workflow_history == cloned.manifest.workflow_history


def test_deliberate_merge_binds_every_input_to_one_exact_output(rounds):
    from ontotator.application.editing import EditingService
    from ontotator.application.submissions import SubmissionService
    from ontotator.application.work_rounds import MergeRoundInputsService
    from ontotator.application.workspaces import WorkspaceService
    from ontotator.domain.workspace import MutationEnvelope

    repo, ontology, reviewer, result, _inputs, _lead, _actor = (
        create_consolidation_fixture(rounds)
    )
    # The matching inputs were kept automatically (revision 1); reopen them
    # before merging in the editor.
    opened = WorkspaceService(reviewer, ontology).open(result.workspace_key).draft
    assert opened.revision == 1
    opened = reopen_automatic(repo, reviewer, result, opened.revision)
    draft = EditingService(reviewer, ontology).apply(
        result.workspace_key,
        MutationEnvelope(
            mutation_id="replacement",
            expected_revision=opened.revision,
            payload={
                "command": "create_annotation",
                "annotation_id": "merged",
                "term_id": "HP:0001252",
                "axes_values": {"assertion": "present"},
                "chosen_axis_ids": ["assertion"],
                "note": "Merged finding",
            },
        ),
    )
    old = draft.annotations[0]
    inventory = repo.get_round_input_inventory("pkg-1", result.round_id)
    merged = MergeRoundInputsService(reviewer).merge(
        result.workspace_key,
        MutationEnvelope(
            mutation_id="merge",
            expected_revision=draft.revision,
            payload={
                "input_ids": [i["input_id"] for i in inventory],
                "replacement": {
                    "annotation_id": old.annotation.annotation_id,
                    "version": old.version,
                },
                "note": "Same clinical finding",
            },
        ),
    )
    assert len(merged.decisions) == 2
    assert len(merged.annotations) == 1
    assert merged.annotations[0].annotation.provenance.method == "merged"
    assert set(merged.annotations[0].annotation.provenance.source_refs) == {
        f"round-input:{i['input_id']}" for i in inventory
    }
    final = SubmissionService(reviewer, ontology).submit(
        result.workspace_key,
        MutationEnvelope(
            mutation_id="submit",
            expected_revision=merged.revision,
            payload={"document_checked": True},
        ),
    )
    assert len(final.snapshots) == 1
