"""Review continuation must use results, never dependency or wall-clock history."""

import io

import pytest
from auth_harness import upload_package
from pg_harness import count_rows, database_for, tamper
from support.v2_reader import read_package
from support.v2_writer import PackageWriter
from test_reviews import _setup_review_test_env

from ontocurator.application.editing import CreateAnnotationCommand
from ontocurator.application.workspaces import WorkspaceService
from ontocurator.domain.annotations import AnnotationRef
from ontocurator.domain.errors import DomainError, InvalidPackage
from ontocurator.domain.review import ReviewTargetSet
from ontocurator.domain.workspace import MutationEnvelope, WorkspaceKey
from ontocurator.storage.repository import Repository


def mutation(revision, payload):
    return MutationEnvelope(
        mutation_id=f"m-{revision}", expected_revision=revision, payload=payload
    )


def key(ctx, annotator="reviewer", target_set_id="targets-0"):
    return WorkspaceKey(
        project_key="pkg-rev-1",
        document_id="doc-1",
        annotator_id=annotator,
        mode="review",
        target_set_id=target_set_id,
    )


def changed_review(ctx):
    source = ctx["snap_a"]
    ref = AnnotationRef(
        annotation_id=source.annotation.annotation_id, version=source.version
    )
    targets = ReviewTargetSet.create([ref])
    opened = ctx["ws_svc"].open(key(ctx, target_set_id=targets.target_set_id), targets)
    draft = ctx["edit_svc"].apply(
        opened.key,
        mutation(
            0,
            CreateAnnotationCommand(
                annotation_id="adopted",
                layer_id="hpo-layer",
                type_id="phenotype",
                term_id="HP:0001250",
                axes_values={"assertion": "present"},
                source_annotation_id=ref.annotation_id,
                source_version=ref.version,
            ).model_dump(),
        ),
    )
    replacement = AnnotationRef(
        annotation_id="adopted", version=draft.annotations[0].version
    )
    ctx["rev_svc"].decide(
        opened.key,
        mutation(
            1,
            {
                "target": ref.model_dump(),
                "outcome": "changed",
                "replacement": replacement.model_dump(),
            },
        ),
    )
    return opened.key, ref, replacement


def submit(ctx, ws_key, revision):
    return ctx["sub_svc"].submit(
        ws_key, mutation(revision, {"checked_layer_ids": ["hpo-layer"]})
    )


def roundtrip(package):
    stream = io.BytesIO()
    PackageWriter.write_to_stream(package, stream)
    stream.seek(0)
    return read_package(stream)


def test_default_review_opens_all_raw_proposals(tmp_path):
    ctx = _setup_review_test_env(tmp_path)
    view = ctx["ws_svc"].open(key(ctx))
    assert len(view.targets.targets) == 3


def test_selecting_review_inputs_does_not_export_entire_package(tmp_path, monkeypatch):
    ctx = _setup_review_test_env(tmp_path)
    ws_key, _, replacement = changed_review(ctx)
    submit(ctx, ws_key, 2)

    def prohibit_export(*args):
        pytest.fail("Review input selection must query only this document")

    monkeypatch.setattr(ctx["repo"], "export_package", prohibit_export)
    inputs = ctx["ws_svc"].get_review_inputs(ws_key.project_key, ws_key.document_id)
    # The document's proposals only, never a submitted result (index Q3).
    proposals = ctx["repo"].list_annotations_for_document(
        ws_key.project_key, ws_key.document_id
    )
    assert inputs == proposals
    assert replacement not in [
        AnnotationRef(annotation_id=a.annotation.annotation_id, version=a.version)
        for a in inputs
    ]


def test_review_round_continues_after_export_reimport(tmp_path):
    ctx = _setup_review_test_env(tmp_path)
    ws_key, _, replacement = changed_review(ctx)
    submitted = submit(ctx, ws_key, 2)
    exported = roundtrip(ctx["exp_svc"].for_workspace(ws_key))
    clean = Repository(database_for(tmp_path / "import.db"))
    project_key = clean.import_package(exported)
    svc = WorkspaceService(clean, ctx["ontology"])
    resumed = svc.open(key(ctx).model_copy(update={"project_key": project_key}))
    assert resumed.targets == submitted.targets
    assert resumed.draft.decisions[0].replacement == replacement
    assert resumed.draft.annotations == submitted.snapshots
    assert resumed.draft.revision == submitted.draft_revision
    fresh = svc.open(
        key(ctx, "new-reviewer").model_copy(update={"project_key": project_key})
    )
    # Another reviewer starts from the proposals of the importing project (an
    # export carries its annotations as proposals), never from submissions.
    assert fresh.targets.targets == [
        AnnotationRef(annotation_id=a.annotation.annotation_id, version=a.version)
        for a in clean.list_annotations_for_document(project_key, ws_key.document_id)
    ]
    from ontocurator.application.submissions import SubmissionService

    continued = SubmissionService(clean).submit(
        resumed.key,
        mutation(resumed.draft.revision, {"checked_layer_ids": ["hpo-layer"]}),
    )
    assert continued.origin_key == submitted.origin_key
    assert continued.draft_revision > submitted.draft_revision


def test_decision_switch_discards_adopted_copy_but_keeps_authored_finding(tmp_path):
    ctx = _setup_review_test_env(tmp_path)
    ws_key, ref, _ = changed_review(ctx)
    ctx["edit_svc"].apply(
        ws_key,
        mutation(
            2,
            CreateAnnotationCommand(
                annotation_id="additional",
                layer_id="hpo-layer",
                type_id="phenotype",
                term_id="HP:0001250",
                axes_values={},
            ).model_dump(),
        ),
    )
    draft = ctx["rev_svc"].decide(
        ws_key, mutation(3, {"target": ref.model_dump(), "outcome": "rejected"})
    )
    assert [a.annotation.annotation_id for a in draft.annotations] == ["additional"]
    result = submit(ctx, ws_key, 4)
    assert [a.annotation.annotation_id for a in result.snapshots] == ["additional"]


def test_decision_switch_preserves_independent_unattached_evidence(tmp_path):
    from ontocurator.domain.documents import EvidenceMention, EvidenceSnapshot, Segment

    ctx = _setup_review_test_env(tmp_path)
    ws_key, ref, _ = changed_review(ctx)

    def add_unattached_mention(draft):
        draft.evidence.append(
            EvidenceSnapshot.create(
                EvidenceMention(
                    evidence_id="independent-mention",
                    segments=[Segment(start=0, end=3)],
                ),
                ctx["doc"],
            )
        )
        return draft

    ctx["repo"].run_mutation(ws_key, mutation(2, {}), add_unattached_mention)
    draft = ctx["rev_svc"].decide(
        ws_key, mutation(3, {"target": ref.model_dump(), "outcome": "rejected"})
    )
    assert [e.mention.evidence_id for e in draft.evidence] == ["independent-mention"]


def test_unresolved_adopted_copy_cannot_be_submitted_as_additional(tmp_path):
    ctx = _setup_review_test_env(tmp_path)
    ws_key, _, _ = changed_review(ctx)

    def stale_decision(draft):
        draft.decisions = [
            draft.decisions[0].model_copy(
                update={"outcome": "confirmed", "replacement": None}
            )
        ]
        return draft

    ctx["repo"].run_mutation(ws_key, mutation(2, {}), stale_decision)
    with pytest.raises(DomainError, match="UNRESOLVED_ADOPTED_COPY"):
        submit(ctx, ws_key, 3)


def test_ambiguous_rounds_need_explicit_selection(tmp_path):
    ctx = _setup_review_test_env(tmp_path)
    for name in ("snap_a", "snap_b"):
        snap = ctx[name]
        targets = ReviewTargetSet.create(
            [
                AnnotationRef(
                    annotation_id=snap.annotation.annotation_id, version=snap.version
                )
            ]
        )
        ctx["ws_svc"].open(key(ctx, target_set_id=targets.target_set_id), targets)
    with pytest.raises(DomainError, match="AMBIGUOUS_REVIEW_ROUND"):
        ctx["ws_svc"].open(key(ctx))
    selected = ctx["ws_svc"].open(key(ctx, target_set_id=targets.target_set_id))
    assert selected.targets == targets


def test_round_selection_api_resumes_selected_round_and_rejects_incompatible_requests(
    tmp_path,
):
    from test_review_findings import HP_PATH, _app

    ctx = _setup_review_test_env(tmp_path / "source")
    client, _ = _app(tmp_path / "api", ontology_paths=[HP_PATH])
    stream = io.BytesIO()
    PackageWriter.write_to_stream(ctx["repo"].export_package("pkg-rev-1"), stream)
    imported = upload_package(
        client,
        files={"file": ("proposals.zip", stream.getvalue(), "application/zip")},
    )
    assert imported.status_code == 200, imported.text
    request = {
        "project_key": "pkg-rev-1",
        "document_id": "doc-1",
        "annotator_id": "reviewer",
        "mode": "review",
    }
    rounds = []
    for name in ("snap_a", "snap_b"):
        snap = ctx[name]
        explicit = client.post(
            "/api/v1/workspaces/open",
            json={
                **request,
                "targets": {
                    "target_set_id": "",
                    "targets": [
                        {
                            "annotation_id": snap.annotation.annotation_id,
                            "version": snap.version,
                        }
                    ],
                },
            },
        )
        assert explicit.status_code == 200, explicit.text
        rounds.append(explicit.json()["view"]["targets"]["target_set_id"])
    ambiguous = client.post("/api/v1/workspaces/open", json=request)
    assert (
        ambiguous.status_code == 422
        and ambiguous.json()["code"] == "AMBIGUOUS_REVIEW_ROUND"
    )
    assert set(ambiguous.json()["details"]["rounds"]) == set(rounds)
    selected = client.post(
        "/api/v1/workspaces/open",
        json={**request, "review_round_target_set_id": rounds[1]},
    )
    assert (
        selected.status_code == 200
        and selected.json()["view"]["targets"]["target_set_id"] == rounds[1]
    )
    invalid = client.post(
        "/api/v1/workspaces/open",
        json={
            **request,
            "mode": "independent",
            "review_round_target_set_id": rounds[1],
        },
    )
    assert (
        invalid.status_code == 422 and invalid.json()["code"] == "INVALID_REVIEW_ROUND"
    )


def test_restoration_chooses_revision_under_clock_skew(tmp_path):
    ctx = _setup_review_test_env(tmp_path)
    ws_key, _, _ = changed_review(ctx)
    first = submit(ctx, ws_key, 2)
    second = submit(ctx, ws_key, 3)
    package = ctx["exp_svc"].for_workspace(ws_key)
    package.submissions[first.submission_id] = first.model_copy(
        update={"created_at": "2099-01-01T00:00:00Z"}
    )
    clean = Repository(database_for(tmp_path / "skew.db"))
    project_key = clean.import_package(roundtrip(package))
    restored = WorkspaceService(clean, ctx["ontology"]).open(
        ws_key.model_copy(update={"project_key": project_key, "scope_id": ""})
    )
    assert restored.draft.revision == second.draft_revision


def test_status_uses_revision_even_when_last_clock_is_older(tmp_path):
    ctx = _setup_review_test_env(tmp_path)
    ws_key, _, _ = changed_review(ctx)
    first = submit(ctx, ws_key, 2)
    submit(ctx, ws_key, 3)
    # Clock ordering is deliberately inconsistent with immutable revisions.
    tamper(
        ctx["repo"].db,
        "submissions",
        "UPDATE ontocurator.submissions SET created_at = :at WHERE submission_id = :id",
        at="2099-01-01",
        id=first.submission_id,
    )
    assert (
        ctx["repo"].get_document_status(
            ws_key.project_key, ws_key.document_id, ws_key.annotator_id, ws_key.mode
        )
        == "completed"
    )


def test_review_with_no_proposals_can_submit_checked_negative(tmp_path):
    ctx = _setup_review_test_env(tmp_path)
    package = ctx["repo"].export_package("pkg-rev-1")
    package.manifest.package_id = "empty-proposals"
    package.annotations = {}
    package.evidence = {}
    ctx["repo"].import_package(package)
    view = ctx["ws_svc"].open(
        key(ctx).model_copy(update={"project_key": "empty-proposals"})
    )
    assert view.targets.targets == []
    result = submit(ctx, view.key, 0)
    assert result.snapshots == [] and result.checked_layer_ids == ["hpo-layer"]


@pytest.mark.parametrize("outcome", ["changed", "rejected", "uncertain", "confirmed"])
def test_import_rejects_inconsistent_review_results(tmp_path, outcome):
    ctx = _setup_review_test_env(tmp_path)
    ws_key, _, _ = changed_review(ctx)
    result = submit(ctx, ws_key, 2)
    package = ctx["exp_svc"].for_workspace(ws_key)
    decision = result.decisions[0]
    if outcome == "changed":
        altered = result.model_copy(update={"snapshots": []})
    else:
        altered = result.model_copy(
            update={
                "decisions": [
                    decision.model_copy(
                        update={"outcome": outcome, "replacement": None}
                    )
                ]
            }
        )
    package.submissions[result.submission_id] = altered
    with pytest.raises(
        InvalidPackage, match=r"[Rr]eview|[Rr]eplacement|[Ss]ubmitted|[Aa]dopted"
    ):
        roundtrip(package)


def test_latest_selection_preserves_full_origins_and_rejects_equal_revision_conflicts(
    tmp_path,
):
    from ontocurator.domain.results import latest_submissions

    ctx = _setup_review_test_env(tmp_path)
    ws_key, _, _ = changed_review(ctx)
    low = submit(ctx, ws_key, 2)
    high = submit(ctx, ws_key, 3)
    future_low = low.model_copy(update={"created_at": "2099-01-01T00:00:00Z"})
    branch = high.model_copy(
        update={
            "submission_id": "other-branch",
            "origin_key": high.origin_key.model_copy(
                update={"project_key": "other-origin"}
            ),
        }
    )
    assert set(
        s.submission_id for s in latest_submissions([future_low, high, branch])
    ) == {high.submission_id, branch.submission_id}
    with pytest.raises(DomainError, match="CONFLICTING_SUBMISSION_REVISION"):
        latest_submissions(
            [high, high.model_copy(update={"submission_id": "conflict"})]
        )


def test_reader_rejects_conflicting_equal_revisions_before_import(tmp_path):
    ctx = _setup_review_test_env(tmp_path)
    ws_key, _, _ = changed_review(ctx)
    result = submit(ctx, ws_key, 2)
    package = ctx["exp_svc"].for_workspace(ws_key)
    package.submissions["conflict"] = result.model_copy(
        update={"submission_id": "conflict"}
    )
    with pytest.raises(InvalidPackage, match="CONFLICTING_SUBMISSION_REVISION"):
        roundtrip(package)


def test_a_reviewer_does_not_guess_between_origin_branches(tmp_path):
    ctx = _setup_review_test_env(tmp_path)
    ws_key, _, _ = changed_review(ctx)
    result = submit(ctx, ws_key, 2)
    package = ctx["exp_svc"].for_workspace(ws_key)
    branch = result.model_copy(
        update={
            "submission_id": "branch",
            "origin_key": result.origin_key.model_copy(
                update={"project_key": "other-origin"}
            ),
        }
    )
    package.submissions[branch.submission_id] = branch
    clean = Repository(database_for(tmp_path / "branch.db"))
    project_key = clean.import_package(roundtrip(package))
    service = WorkspaceService(clean, ctx["ontology"])
    with pytest.raises(DomainError, match="AMBIGUOUS_SUBMISSION_ORIGIN"):
        service.open(key(ctx).model_copy(update={"project_key": project_key}))
    assert count_rows(clean, "drafts") == 0
