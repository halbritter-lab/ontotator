import io
from pathlib import Path

import pytest
from layered_fixtures import make_layered_package
from pg_harness import database_for
from support.v2_exports import ExportService
from support.v2_reader import read_package
from support.v2_writer import PackageWriter

from ontocurator.application.editing import CreateAnnotationCommand, EditorService
from ontocurator.application.reviews import DecisionCommand, ReviewService
from ontocurator.application.submissions import SubmissionService
from ontocurator.application.workspaces import WorkspaceService
from ontocurator.domain.annotations import (
    ActorRef,
    Annotation,
    AnnotationRef,
    Provenance,
    snapshot,
)
from ontocurator.domain.errors import DomainError
from ontocurator.domain.review import ReviewDecision, ReviewTargetSet
from ontocurator.domain.workspace import MutationEnvelope, WorkspaceKey
from ontocurator.ontology.registry import OntologyRegistry
from ontocurator.storage.repository import Repository


def registry():
    result = OntologyRegistry()
    for name in ("hp", "mondo"):
        result.register_path(Path(__file__).parent / "fixtures" / f"{name}.json")
    return result


def envelope(mutation_id, revision, payload):
    return MutationEnvelope(
        mutation_id=mutation_id, expected_revision=revision, payload=payload
    )


def test_independent_trimmed_profile_roundtrip_restores_own_submission(tmp_path):
    ontologies = registry()
    repo = Repository(database_for(tmp_path / "original.db"))
    package = make_layered_package("assisted")
    repo.import_package(package)
    key = (
        WorkspaceService(repo, ontologies)
        .open(
            WorkspaceKey(
                project_key=package.manifest.package_id,
                document_id="doc-beta",
                annotator_id="same-person",
                mode="independent",
                target_set_id="targets-0",
            )
        )
        .key
    )
    EditorService(repo, ontologies).apply(
        key,
        envelope(
            "create",
            0,
            CreateAnnotationCommand(
                annotation_id="own-annotation",
                note="Document-level finding in the roundtrip fixture.",
                layer_id="target-layer",
                type_id="phenotype",
                term_id="HP:0001252",
                axes_values={},
            ).model_dump(),
        ),
    )
    submission = SubmissionService(repo).submit(
        key,
        envelope(
            "submit",
            1,
            {
                "document_checked": True,
                "checked_layer_ids": ["target-layer"],
            },
        ),
    )
    exported = ExportService(repo).for_workspace(key)
    stream = io.BytesIO()
    PackageWriter.write_to_stream(exported, stream)
    stream.seek(0)
    reloaded = read_package(stream, registry=ontologies)
    clean = Repository(database_for(tmp_path / "reimport.db"))
    local_id = clean.import_package(reloaded)
    view = WorkspaceService(clean, ontologies).open(
        key.model_copy(
            update={
                "project_key": local_id,
                "scope_id": "",
            }
        )
    )
    assert view.key.scope_id != key.scope_id
    assert view.submissions == [submission]
    assert view.draft.annotations == submission.snapshots
    assert clean.get_submission(submission.submission_id) == submission
    assert view.available_inputs == []


def strict_review(tmp_path):
    package = make_layered_package("multi_editable")
    annotation = Annotation(
        annotation_id="incomplete-proposal",
        document_id="doc-beta",
        layer_id="layer-2",
        type_id="type-req",
        term_id="MONDO:0005071",
        axes_values={"severity": "mild"},
        evidence_refs=[],
        provenance=Provenance(
            actor=ActorRef(actor_id="source", kind="tool"), method="import"
        ),
    )
    proposal = snapshot(
        annotation, [], package.documents["doc-beta"], package.manifest.task_profile
    )
    package.annotations[(annotation.annotation_id, proposal.version)] = proposal
    repo = Repository(database_for(tmp_path / "review.db"))
    repo.import_package(package)
    target = AnnotationRef(
        annotation_id=annotation.annotation_id, version=proposal.version
    )
    targets = ReviewTargetSet.create([target])
    ontologies = registry()
    key = (
        WorkspaceService(repo, ontologies)
        .open(
            WorkspaceKey(
                project_key=package.manifest.package_id,
                document_id="doc-beta",
                annotator_id="reviewer",
                mode="review",
                target_set_id=targets.target_set_id,
            ),
            targets,
            pending_proposal_set_ids=[],
        )
        .key
    )
    return repo, ontologies, key, target


def test_confirm_requires_evidence_and_keeps_revision_on_failure(tmp_path):
    repo, ontologies, key, target = strict_review(tmp_path)
    with pytest.raises(DomainError, match="MISSING_EVIDENCE"):
        ReviewService(repo, registry=ontologies).decide(
            key,
            envelope(
                "confirm",
                0,
                DecisionCommand(target=target, outcome="confirmed").model_dump(),
            ),
        )
    assert repo.open_draft(key).revision == 0


def test_replacement_approval_requires_evidence(tmp_path):
    repo, ontologies, key, target = strict_review(tmp_path)
    draft = EditorService(repo, ontologies).apply(
        key,
        envelope(
            "create",
            0,
            CreateAnnotationCommand(
                annotation_id="replacement",
                note="This explanation does not replace required evidence.",
                layer_id="layer-2",
                type_id="type-req",
                term_id="MONDO:0005071",
                axes_values={"severity": "mild"},
            ).model_dump(),
        ),
    )
    replacement = draft.annotations[0]
    with pytest.raises(DomainError, match="MISSING_EVIDENCE"):
        ReviewService(repo, registry=ontologies).decide(
            key,
            envelope(
                "replace",
                1,
                DecisionCommand(
                    target=target,
                    outcome="changed",
                    replacement=AnnotationRef(
                        annotation_id="replacement",
                        version=replacement.version,
                    ),
                ).model_dump(),
            ),
        )
    assert repo.open_draft(key).revision == 1


def test_submission_revalidates_confirmed_imported_content(tmp_path):
    repo, _, key, target = strict_review(tmp_path)

    # A previously stored decision must not bypass final assembled-content validation.
    def recorded_decision(draft):
        draft.decisions = [
            ReviewDecision(
                decision_id="old-decision",
                target=target,
                outcome="confirmed",
                reviewer_id=key.annotator_id,
            )
        ]
        return draft

    repo.run_mutation(key, envelope("record", 0, {}), recorded_decision)
    with pytest.raises(DomainError, match="MISSING_EVIDENCE"):
        SubmissionService(repo).submit(
            key,
            envelope(
                "submit",
                1,
                {
                    "document_checked": True,
                    "checked_layer_ids": ["layer-1", "layer-2"],
                },
            ),
        )
    assert repo.open_draft(key).revision == 1
    assert repo.get_submissions_for_workspace(key) == []


@pytest.mark.parametrize("outcome", ["rejected", "uncertain"])
def test_nonapproved_target_may_remain_incomplete(tmp_path, outcome):
    repo, ontologies, key, target = strict_review(tmp_path)
    ReviewService(repo, registry=ontologies).decide(
        key,
        envelope(
            "decide",
            0,
            DecisionCommand(
                target=target,
                outcome=outcome,
                note="Further review required" if outcome == "uncertain" else None,
            ).model_dump(),
        ),
    )
    submission = SubmissionService(repo).submit(
        key,
        envelope(
            "submit",
            1,
            {
                "document_checked": True,
                "checked_layer_ids": ["layer-1", "layer-2"],
            },
        ),
    )
    assert submission.snapshots == []
    assert submission.decisions[0].outcome == outcome
