"""Submission scope metadata cannot contradict its immutable origin/results."""

import io

import pytest
from layered_fixtures import make_layered_package
from pg_harness import database_for
from support.v2_exports import ExportService
from support.v2_reader import read_package
from support.v2_writer import PackageWriter
from test_review_roundtrip_regressions import registry
from test_reviews import _setup_review_test_env
from test_scientific_review_integrity import changed_review, submit

from ontocurator.application.editing import CreateAnnotationCommand, EditorService
from ontocurator.application.submissions import SubmissionService
from ontocurator.application.workspaces import WorkspaceService
from ontocurator.domain.annotations import AnnotationRef, snapshot
from ontocurator.domain.errors import DomainError, InvalidPackage
from ontocurator.domain.review import ReviewDecision, ReviewTargetSet
from ontocurator.domain.scopes import build_scope
from ontocurator.domain.workspace import MutationEnvelope, Submission, WorkspaceKey
from ontocurator.storage.repository import Repository


def archive_roundtrip(package):
    stream = io.BytesIO()
    PackageWriter.write_to_stream(package, stream)
    stream.seek(0)
    return read_package(stream, registry=registry())


@pytest.mark.parametrize("positive", [False, True])
def test_independent_projected_scope_survives_second_export_import_and_analysis(
    tmp_path, positive
):
    package = make_layered_package("assisted")
    ontologies = registry()
    original = Repository(database_for(tmp_path / "source.db"))
    original.import_package(package)
    opened = WorkspaceService(original, ontologies).open(
        WorkspaceKey(
            project_key=package.manifest.package_id,
            document_id="doc-beta",
            annotator_id="same-reviewer",
            mode="independent",
            target_set_id="targets-0",
        )
    )
    revision = opened.draft.revision
    if positive:
        draft = EditorService(original, ontologies).apply(
            opened.key,
            MutationEnvelope(
                mutation_id="create",
                expected_revision=revision,
                payload=CreateAnnotationCommand(
                    annotation_id="own-finding",
                    note="Document-level finding in the scope fixture.",
                    layer_id="target-layer",
                    type_id="phenotype",
                    term_id="HP:0001252",
                    axes_values={"assertion": "present"},
                ).model_dump(),
            ),
        )
        revision = draft.revision
    first = SubmissionService(original).submit(
        opened.key,
        MutationEnvelope(
            mutation_id="submit",
            expected_revision=revision,
            payload={"document_checked": True, "checked_layer_ids": ["target-layer"]},
        ),
    )
    projected = archive_roundtrip(ExportService(original).for_workspace(opened.key))
    assert [layer.layer_id for layer in projected.manifest.task_profile.layers] == [
        "target-layer"
    ]
    imported = Repository(database_for(tmp_path / "first-import.db"))
    imported_id = imported.import_package(projected)
    resumed = WorkspaceService(imported, ontologies).open(
        opened.key.model_copy(update={"project_key": imported_id, "scope_id": ""})
    )
    assert resumed.key.scope_id != first.origin_key.scope_id
    continued = SubmissionService(imported).submit(
        resumed.key,
        MutationEnvelope(
            mutation_id="continue",
            expected_revision=resumed.draft.revision,
            payload={"document_checked": True, "checked_layer_ids": ["target-layer"]},
        ),
    )
    second_export = archive_roundtrip(
        ExportService(imported).for_workspace(resumed.key)
    )
    assert continued.origin_key == first.origin_key
    assert continued.scope == first.scope
    assert continued.draft_revision == first.draft_revision + 1
    assert continued.snapshots == first.snapshots
    assert second_export.documents == projected.documents
    assert second_export.annotations == projected.annotations
    second_import = Repository(database_for(tmp_path / "second-import.db"))
    second_id = second_import.import_package(second_export)
    restored = WorkspaceService(second_import, ontologies).open(
        opened.key.model_copy(update={"project_key": second_id, "scope_id": ""})
    )
    assert restored.draft.revision == continued.draft_revision
    exported = second_import.export_package(second_id)
    newest = max(
        (
            s
            for s in exported.submissions.values()
            if s.origin_key.document_id == "doc-beta"
        ),
        key=lambda s: s.draft_revision,
    )
    assert newest.origin_key == first.origin_key
    assert newest.draft_revision == continued.draft_revision
    assert bool(newest.snapshots) == positive


@pytest.mark.parametrize("legacy_scope", [False, True])
@pytest.mark.parametrize("outcome", ["confirmed", "changed", "rejected", "uncertain"])
def test_reference_layer_review_targets_are_rejected_before_import(
    tmp_path, outcome, legacy_scope
):
    package = make_layered_package("assisted")
    target = next(iter(package.annotations.values()))
    target_ref = AnnotationRef(
        annotation_id=target.annotation.annotation_id, version=target.version
    )
    targets = ReviewTargetSet.create([target_ref])
    scope = build_scope(package.manifest.task_profile, "review")
    approved = [target] if outcome == "confirmed" else []
    replacement_ref = None
    if outcome == "changed":
        replacement = snapshot(
            target.annotation.model_copy(update={"annotation_id": "replacement"}),
            target.evidence,
            package.documents[target.document_id],
            package.manifest.task_profile,
        )
        package.annotations[
            (replacement.annotation.annotation_id, replacement.version)
        ] = replacement
        replacement_ref = AnnotationRef(
            annotation_id=replacement.annotation.annotation_id,
            version=replacement.version,
        )
        approved = [replacement]
    forged = Submission(
        submission_id="forged",
        origin_key=WorkspaceKey(
            project_key=package.manifest.package_id,
            document_id=target.document_id,
            annotator_id="reviewer",
            mode="review",
            scope_id=scope.scope_id,
            target_set_id=targets.target_set_id,
        ),
        scope=None if legacy_scope else scope,
        targets=targets,
        draft_revision=1,
        snapshots=approved,
        decisions=[
            ReviewDecision(
                decision_id="decision",
                target=target_ref,
                outcome=outcome,
                replacement=replacement_ref,
                reviewer_id="reviewer",
            )
        ],
        checked_layer_ids=["target-layer"],
        created_at="2026-10-09T00:00:00Z",
    )
    package.submissions[forged.submission_id] = forged
    with pytest.raises(InvalidPackage, match=r"target.*editable"):
        archive_roundtrip(package)


@pytest.mark.parametrize("legacy_scope", [False, True])
@pytest.mark.parametrize("mode", ["independent", "review"])
def test_reference_layer_approved_snapshots_are_rejected_before_import(
    tmp_path, mode, legacy_scope
):
    package = make_layered_package("assisted")
    reference = next(iter(package.annotations.values()))
    targets = ReviewTargetSet.create([])
    scope = build_scope(package.manifest.task_profile, mode)
    forged = Submission(
        submission_id="forged",
        origin_key=WorkspaceKey(
            project_key=package.manifest.package_id,
            document_id=reference.document_id,
            annotator_id="annotator",
            mode=mode,
            scope_id=scope.scope_id,
            target_set_id=targets.target_set_id,
        ),
        scope=None if legacy_scope else scope,
        targets=targets,
        draft_revision=1,
        snapshots=[reference],
        decisions=[],
        checked_layer_ids=["target-layer"],
        created_at="2026-10-09T00:00:00Z",
    )
    package.submissions[forged.submission_id] = forged
    with pytest.raises(InvalidPackage, match=r"snapshot.*editable"):
        archive_roundtrip(package)


def test_reference_layer_dependencies_remain_valid_outside_submitted_results():
    package = make_layered_package("assisted")
    loaded = archive_roundtrip(package)
    assert loaded.annotations == package.annotations
    assert loaded.evidence == package.evidence


@pytest.mark.parametrize(
    "damage",
    ["mode", "identity", "editable", "reference", "checked", "duplicate-checked"],
)
def test_submission_scope_tampering_is_rejected(tmp_path, damage):
    ctx = _setup_review_test_env(tmp_path)
    key, _, _ = changed_review(ctx)
    result = submit(ctx, key, 2)
    package = ctx["exp_svc"].for_workspace(key)
    submission = package.submissions[result.submission_id]
    assert submission.scope is not None
    if damage == "mode":
        submission.scope.mode = "independent"
    elif damage == "identity":
        submission.scope.scope_id = "forged"
    elif damage == "editable":
        submission.scope.editable_layer_ids = []
    elif damage == "reference":
        submission.scope.reference_layer_ids = ["hpo-layer"]
    elif damage == "checked":
        submission.checked_layer_ids = ["undeclared-layer"]
    else:
        submission.checked_layer_ids = ["hpo-layer", "hpo-layer"]
    stream = io.BytesIO()
    PackageWriter.write_to_stream(package, stream)
    stream.seek(0)
    with pytest.raises(InvalidPackage, match=r"scope|checked"):
        read_package(stream)


@pytest.mark.parametrize("scenario", ["single", "multi_editable"])
@pytest.mark.parametrize("confirmation", [None, False, True])
def test_submission_needs_explicit_document_confirmation(
    tmp_path, scenario, confirmation
):
    package = make_layered_package(scenario)
    repo = Repository(database_for(tmp_path / "completion.db"))
    repo.import_package(package)
    opened = WorkspaceService(repo, registry()).open(
        WorkspaceKey(
            project_key=package.manifest.package_id,
            document_id="doc-beta",
            annotator_id="curator",
            mode="independent",
            target_set_id="targets-0",
        )
    )
    payload = {} if confirmation is None else {"document_checked": confirmation}
    envelope = MutationEnvelope(
        mutation_id="submit", expected_revision=0, payload=payload
    )
    service = SubmissionService(repo)
    if confirmation is not True:
        with pytest.raises(DomainError) as error:
            service.submit(opened.key, envelope)
        assert error.value.code == "DOCUMENT_NOT_CHECKED"
        assert repo.open_draft(opened.key).revision == 0
        assert repo.get_submissions_for_workspace(opened.key) == []
    else:
        submission = service.submit(opened.key, envelope)
        assert submission.document_checked is True
        assert submission.checked_layer_ids == []
        assert service.read(opened.key, submission.submission_id) == submission
