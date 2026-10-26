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
from ontocurator.domain.documents import (
    EvidenceMention,
    EvidenceRef,
    Segment,
    snapshot_evidence,
)
from ontocurator.domain.errors import DomainError, InvalidPackage
from ontocurator.domain.review import ReviewDecision, ReviewTargetSet
from ontocurator.domain.workspace import MutationEnvelope, WorkspaceKey
from ontocurator.ontology.registry import OntologyRegistry
from ontocurator.storage.repository import Repository


def add_proposal(
    package,
    *,
    layer_id="hpo-layer",
    axes_values=None,
    with_evidence=False,
    axes_defaulted=(),
):
    evidence = []
    if with_evidence:
        mention = snapshot_evidence(
            EvidenceMention(
                evidence_id="editable-evidence", segments=[Segment(start=21, end=30)]
            ),
            package.documents["doc-beta"],
        )
        evidence.append(mention)
        package.evidence[(mention.mention.evidence_id, mention.version)] = mention
    annotation = Annotation(
        annotation_id="editable-proposal",
        document_id="doc-beta",
        layer_id=layer_id,
        type_id="phenotype",
        term_id="HP:0001250",
        axes_values=axes_values or {},
        axes_defaulted=list(axes_defaulted),
        evidence_refs=[
            EvidenceRef(evidence_id=e.mention.evidence_id, version=e.version)
            for e in evidence
        ],
        provenance=Provenance(
            actor=ActorRef(actor_id="source", kind="tool"), method="import"
        ),
    )
    proposal = snapshot(
        annotation,
        evidence,
        package.documents["doc-beta"],
        package.manifest.task_profile,
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
    view = service.open(key, targets, pending_proposal_set_ids=[])
    assert {s.annotation.annotation_id for s in view.available_inputs} == {
        "editable-proposal",
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
                    payload={
                        "document_checked": True,
                        "checked_layer_ids": ["hpo-layer"],
                    },
                ),
            )
    assert repo.open_draft(key).revision == revision
    assert repo.get_submissions_for_workspace(key) == []


def note_review_workspace(
    tmp_path, axes_values=None, *, with_evidence=False, axes_defaulted=()
):
    package = make_layered_package("single")
    proposal = add_proposal(
        package,
        axes_values=axes_values,
        with_evidence=with_evidence,
        axes_defaulted=axes_defaulted,
    )
    repo = Repository(database_for(tmp_path / "note-review.db"))
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
    return repo, key, target


@pytest.mark.parametrize("note", [None, "", " \t\n\u2003"])
def test_uncertain_note_required_without_revision_or_receipt(tmp_path, note):
    repo, key, target = note_review_workspace(tmp_path)
    payload = {"target": target.model_dump(), "outcome": "uncertain"}
    if note is not None:
        payload["note"] = note
    envelope = MutationEnvelope(
        mutation_id="decision", expected_revision=0, payload=payload
    )
    with pytest.raises(DomainError) as error:
        ReviewService(repo).decide(key, envelope)
    assert error.value.code == "REVIEW_NOTE_REQUIRED"
    assert error.value.details == {"target": target.model_dump()}
    assert repo.open_draft(key).revision == 0
    assert repo.open_draft(key).decisions == []
    # Reusing the failed mutation identity with corrected input remains possible.
    saved = ReviewService(repo).decide(
        key,
        envelope.model_copy(
            update={"payload": {**payload, "note": "Need further review: µ, \u03b1"}}
        ),
    )
    assert saved.revision == 1
    assert saved.decisions[0].note == "Need further review: µ, \u03b1"


def test_erasing_uncertain_note_keeps_saved_decision_transactionally(tmp_path):
    repo, key, target = note_review_workspace(tmp_path)
    service = ReviewService(repo)
    saved = service.decide(
        key,
        MutationEnvelope(
            mutation_id="save",
            expected_revision=0,
            payload=DecisionCommand(
                target=target, outcome="uncertain", note="Need specialist review"
            ).model_dump(),
        ),
    )
    with pytest.raises(DomainError, match="REVIEW_NOTE_REQUIRED"):
        service.decide(
            key,
            MutationEnvelope(
                mutation_id="erase",
                expected_revision=1,
                payload=DecisionCommand(
                    target=target, outcome="uncertain", note=" "
                ).model_dump(),
            ),
        )
    current = repo.open_draft(key)
    assert current.revision == saved.revision
    assert current.decisions == saved.decisions
    cleared = service.decide(
        key,
        MutationEnvelope(
            mutation_id="reset",
            expected_revision=1,
            payload=DecisionCommand(target=target, outcome=None).model_dump(),
        ),
    )
    assert cleared.revision == 2
    assert cleared.decisions == []


@pytest.mark.parametrize("note", [None, " \t"])
def test_submission_revalidates_legacy_uncertain_notes_but_read_remains_supported(
    tmp_path, note
):
    repo, key, target = note_review_workspace(tmp_path)
    legacy = ReviewDecision(
        decision_id="legacy",
        target=target,
        outcome="uncertain",
        reviewer_id="reviewer",
        note=note,
    )

    def historical_write(draft):
        draft.decisions = [legacy]
        return draft

    repo.run_mutation(
        key,
        MutationEnvelope(mutation_id="legacy", expected_revision=0, payload={}),
        historical_write,
    )
    assert repo.open_draft(key).decisions == [legacy]
    assert ReviewDecision.model_validate_json(legacy.model_dump_json()) == legacy
    with pytest.raises(DomainError) as error:
        SubmissionService(repo).submit(
            key,
            MutationEnvelope(
                mutation_id="submit",
                expected_revision=1,
                payload={"document_checked": True},
            ),
        )
    assert error.value.code == "REVIEW_NOTE_REQUIRED"
    assert error.value.details == {"target": target.model_dump()}
    assert repo.open_draft(key).revision == 1
    assert repo.get_submissions_for_workspace(key) == []


def test_confirmed_clinical_uncertainty_does_not_require_reviewer_note(tmp_path):
    repo, key, target = note_review_workspace(
        tmp_path, {"assertion": "uncertain"}, with_evidence=True
    )
    ReviewService(repo).decide(
        key,
        MutationEnvelope(
            mutation_id="confirm",
            expected_revision=0,
            payload=DecisionCommand(target=target, outcome="confirmed").model_dump(),
        ),
    )
    envelope = MutationEnvelope(
        mutation_id="submit", expected_revision=1, payload={"document_checked": True}
    )
    service = SubmissionService(repo)
    # Clinical uncertainty is already explicit. The other unchosen axes now
    # require a separate warning acknowledgement, never a reviewer note.
    with pytest.raises(DomainError, match="AXIS_CONFIRMATION_WARNING") as warning:
        service.submit(key, envelope)
    assert {item["detail"]["axis"] for item in warning.value.details["warnings"]} == {
        "experiencer",
        "temporality",
    }
    assert repo.open_draft(key).revision == 1
    submission = service.submit(
        key,
        envelope.model_copy(
            update={
                "payload": {
                    **envelope.payload,
                    "warning_acknowledgement": warning.value.details["acknowledgement"],
                }
            }
        ),
    )
    assert submission.decisions[0].note is None
    assert submission.decisions[0].outcome == "confirmed"
    assert submission.snapshots[0].annotation.axes_values["assertion"] == "uncertain"


DEFAULTED_PROPOSAL = {
    "assertion": "present",
    "experiencer": "patient",
    "temporality": "current",
}


def test_confirm_decides_a_proposals_defaulted_values(tmp_path):
    repo, key, target = note_review_workspace(
        tmp_path,
        DEFAULTED_PROPOSAL,
        with_evidence=True,
        axes_defaulted=["experiencer", "temporality"],
    )
    ReviewService(repo).decide(
        key,
        MutationEnvelope(
            mutation_id="confirm",
            expected_revision=0,
            payload=DecisionCommand(target=target, outcome="confirmed").model_dump(),
        ),
    )
    submission = SubmissionService(repo).submit(
        key,
        MutationEnvelope(
            mutation_id="submit",
            expected_revision=1,
            payload={"document_checked": True},
        ),
    )
    # Accepted without an acknowledgement; the export still marks the defaults.
    assert submission.snapshots[0].annotation.axes_defaulted == [
        "experiencer",
        "temporality",
    ]


def test_unresolved_proposal_defaults_still_need_acknowledgement(tmp_path):
    repo, key, target = note_review_workspace(
        tmp_path,
        DEFAULTED_PROPOSAL,
        with_evidence=True,
        axes_defaulted=["experiencer"],
    )
    ReviewService(repo).decide(
        key,
        MutationEnvelope(
            mutation_id="unresolved",
            expected_revision=0,
            payload=DecisionCommand(
                target=target, outcome="uncertain", note="Needs a second look"
            ).model_dump(),
        ),
    )
    with pytest.raises(DomainError, match="AXIS_CONFIRMATION_WARNING") as warning:
        SubmissionService(repo).submit(
            key,
            MutationEnvelope(
                mutation_id="submit",
                expected_revision=1,
                payload={"document_checked": True},
            ),
        )
    assert [item["detail"]["axis"] for item in warning.value.details["warnings"]] == [
        "experiencer"
    ]
