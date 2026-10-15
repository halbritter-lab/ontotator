import io
from pathlib import Path

import pytest
from layered_fixtures import make_layered_package
from pg_harness import database_for
from support.v2_reader import read_package
from support.v2_writer import PackageWriter

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
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.errors import DomainError, InvalidPackage
from ontocurator.domain.review import ReviewDecision, ReviewTargetSet
from ontocurator.domain.workspace import MutationEnvelope, WorkspaceKey
from ontocurator.ontology.registry import OntologyRegistry
from ontocurator.storage.repository import Repository


def add_proposal(package, *, layer_id="hpo-layer", axes_values=None):
    annotation = Annotation(
        annotation_id="editable-proposal",
        document_id="doc-beta",
        layer_id=layer_id,
        type_id="phenotype",
        term_id="HP:0001250",
        axes_values=axes_values or {},
        evidence_refs=[],
        provenance=Provenance(
            actor=ActorRef(actor_id="source", kind="tool"), method="import"
        ),
    )
    proposal = snapshot(
        annotation, [], package.documents["doc-beta"], package.manifest.task_profile
    )
    package.annotations[(annotation.annotation_id, proposal.version)] = proposal
    return proposal


def test_review_targets_exclude_references_but_workspace_keeps_them(tmp_path):
    package = make_layered_package("assisted")
    add_proposal(package, layer_id="target-layer")
    repo = Repository(database_for(tmp_path / "review.db"))
    repo.import_package(package)
    registry = OntologyRegistry()
    for name in ("hp", "mondo"):
        registry.register_path(Path(__file__).parent / "fixtures" / f"{name}.json")
    service = WorkspaceService(repo, registry)
    inputs = service.get_review_inputs(package.manifest.package_id, "doc-beta")
    assert [s.annotation.annotation_id for s in inputs] == ["editable-proposal"]
    targets = ReviewTargetSet.create(
        [
            AnnotationRef(annotation_id=s.annotation.annotation_id, version=s.version)
            for s in inputs
        ]
    )
    key = WorkspaceKey(
        project_key=package.manifest.package_id,
        document_id="doc-beta",
        annotator_id="reviewer",
        mode="review",
        target_set_id=targets.target_set_id,
    )
    view = service.open(key, targets)
    assert {s.annotation.annotation_id for s in view.available_inputs} == {
        "editable-proposal",
        "ann-ref-1",
        "ann-ref-2",
    }
    assisted = service.open(key.model_copy(update={"mode": "assisted"}))
    assert {s.annotation.annotation_id for s in assisted.available_inputs} == {
        "ann-ref-1",
        "ann-ref-2",
    }


@pytest.mark.parametrize(
    ("axes_values", "type_id", "message"),
    [
        ({"assertion": "garbage"}, "phenotype", "Invalid value"),
        ({"unknown-axis": "present"}, "phenotype", "Unknown axis"),
        ({}, "unknown-type", "Unknown type"),
    ],
)
def test_package_rejects_invalid_annotation_type_and_axes(
    axes_values, type_id, message
):
    package = make_layered_package("single")
    proposal = add_proposal(package, axes_values=axes_values)
    # Simulate an external producer: correct checksums, invalid profile content.
    proposal.annotation.type_id = type_id
    proposal.version = canonical_hash(proposal.model_dump(exclude={"version"}))
    package.annotations = {
        (proposal.annotation.annotation_id, proposal.version): proposal
    }
    stream = io.BytesIO()
    PackageWriter.write_to_stream(
        package,
        stream,
        embedded_files={
            "ontologies/hp.json": (
                Path(__file__).parent / "fixtures" / "hp.json"
            ).read_bytes()
        },
    )
    with pytest.raises(InvalidPackage, match=message):
        read_package(stream)


@pytest.mark.parametrize(
    "axes_values", [{"assertion": "garbage"}, {"unknown-axis": "present"}]
)
@pytest.mark.parametrize("operation", ["confirm", "submit"])
def test_invalid_stored_axes_cannot_be_approved(tmp_path, axes_values, operation):
    package = make_layered_package("single")
    proposal = add_proposal(package, axes_values=axes_values)
    # Existing stored data must be revalidated even after import is hardened.
    repo = Repository(database_for(tmp_path / "review.db"))
    repo.import_package(package)
    target = AnnotationRef(
        annotation_id=proposal.annotation.annotation_id, version=proposal.version
    )
    targets = ReviewTargetSet.create([target])
    key = WorkspaceKey(
        project_key=package.manifest.package_id,
        document_id="doc-beta",
        annotator_id="reviewer",
        mode="review",
        target_set_id=targets.target_set_id,
    )
    repo.open_draft(key, targets)
    revision = 0
    if operation == "submit":

        def old_decision(draft):
            draft.decisions = [
                ReviewDecision(
                    decision_id="old-decision",
                    target=target,
                    outcome="confirmed",
                    reviewer_id="reviewer",
                )
            ]
            return draft

        repo.run_mutation(
            key,
            MutationEnvelope(mutation_id="record", expected_revision=0, payload={}),
            old_decision,
        )
        revision = 1
    with pytest.raises(DomainError, match="INVALID_AXES"):
        if operation == "confirm":
            ReviewService(repo).decide(
                key,
                MutationEnvelope(
                    mutation_id="confirm",
                    expected_revision=0,
                    payload=DecisionCommand(
                        target=target, outcome="confirmed"
                    ).model_dump(),
                ),
            )
        else:
            SubmissionService(repo).submit(
                key,
                MutationEnvelope(
                    mutation_id="submit",
                    expected_revision=revision,
                    payload={"checked_layer_ids": ["hpo-layer"]},
                ),
            )
    assert repo.open_draft(key).revision == revision
    assert repo.get_submissions_for_workspace(key) == []
