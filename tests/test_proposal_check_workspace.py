"""Workspace mode proposal_check (spec 2026-10-23 §1): the review screen over
the newest tool proposal set of the text, owned by the annotate task."""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import select
from test_proposal_queries import checker as checker
from test_reanchor_resolutions import from_proposals
from test_reviews import _setup_review_test_env

from ontocurator.application.editing import CheckLayerCommand
from ontocurator.application.reviews import DecisionCommand
from ontocurator.application.submissions import SubmitCommand
from ontocurator.application.work_rounds import require_independent
from ontocurator.assignments.service import TASK_FOR_MODE
from ontocurator.authz.policy import MODE_ACTIONS, MODE_ORDER, ROLE_ACTIONS, Action
from ontocurator.domain.errors import DomainError, IncompleteReview
from ontocurator.domain.scopes import build_scope, is_review_like
from ontocurator.domain.submission_labels import submission_kind
from ontocurator.domain.workspace import MutationEnvelope, WorkspaceKey
from ontocurator.storage.proposal_queries import newest_proposal_refs
from ontocurator.storage.repository import Repository
from ontocurator.storage.tables import DocumentRow


def _key(annotator: str = "checker-1") -> WorkspaceKey:
    return WorkspaceKey(
        project_key="pkg-rev-1",
        document_id="doc-1",
        annotator_id=annotator,
        mode="proposal_check",
        target_set_id="targets-0",
    )


def _env(payload, mutation, revision) -> MutationEnvelope:  # type: ignore[no-untyped-def]
    return MutationEnvelope(
        mutation_id=mutation, expected_revision=revision, payload=payload
    )


def _pid(conn) -> int:  # type: ignore[no-untyped-def]
    pid = Repository._project_id(conn, "pkg-rev-1")
    assert pid is not None
    return pid


def _submit_proposal_check(ctx):  # type: ignore[no-untyped-def]
    """Decide every target (one rejected) and submit; returns (targets, submission)."""
    view = ctx["ws_svc"].open(_key())
    key, targets = view.key, list(view.targets.targets)
    assert len(targets) >= 2
    revision = 0
    ctx["edit_svc"].apply(
        key,
        _env(
            CheckLayerCommand(
                kind="check_layer", layer_id="hpo-layer", checked=True
            ).model_dump(),
            "chk",
            revision,
        ),
    )
    revision += 1
    with pytest.raises((IncompleteReview, DomainError)):
        ctx["sub_svc"].submit(
            key,
            _env(SubmitCommand(document_checked=True).model_dump(), "early", revision),
        )
    # Targets are ordered by annotation id: prop-human, prop-obs (obsolete), prop-tool.
    outcomes = ["confirmed", "rejected"] + ["confirmed"] * (len(targets) - 2)
    for index, (target, outcome) in enumerate(zip(targets, outcomes, strict=True)):
        ctx["rev_svc"].decide(
            key,
            _env(
                DecisionCommand(target=target, outcome=outcome).model_dump(),
                f"d{index}",
                revision,
            ),
        )
        revision += 1
    submission = ctx["sub_svc"].submit(
        key, _env(SubmitCommand(document_checked=True).model_dump(), "submit", revision)
    )
    return targets, submission


def test_mode_is_review_like_and_belongs_to_annotate():
    assert is_review_like("proposal_check") and is_review_like("review")
    assert not is_review_like("independent")
    assert TASK_FOR_MODE["proposal_check"] == "annotate"
    assert MODE_ACTIONS["proposal_check"] == Action.OPEN_PROPOSAL_CHECK
    assert Action.OPEN_PROPOSAL_CHECK in ROLE_ACTIONS["annotator"]
    assert Action.OPEN_PROPOSAL_CHECK not in ROLE_ACTIONS["adjudicator"]
    assert "proposal_check" not in MODE_ORDER  # driven by the assignment (R19)


def test_scope_differs_from_review(tmp_path: Path):
    ctx = _setup_review_test_env(tmp_path)
    profile = ctx["repo"].get_task_profile("pkg-rev-1")  # plan review R17
    check = build_scope(profile, "proposal_check")
    review = build_scope(profile, "review")
    assert check.scope_id != review.scope_id
    assert check.reference_layer_ids == review.reference_layer_ids


def test_targets_are_the_newest_proposal_set(tmp_path: Path):
    ctx = _setup_review_test_env(tmp_path)
    view = ctx["ws_svc"].open(_key())
    with ctx["repo"].db.transaction() as conn:
        refs = newest_proposal_refs(conn, _pid(conn), "doc-1")
    editable = {
        (s.annotation.annotation_id, s.version)
        for s in ctx["repo"].list_annotations_for_document("pkg-rev-1", "doc-1")
        if s.annotation.layer_id in view.scope.editable_layer_ids
    }
    expected = {(r.annotation_id, r.version) for r in refs} & editable
    assert expected
    assert {(t.annotation_id, t.version) for t in view.targets.targets} == expected
    assert view.key.mode == "proposal_check"


def test_every_proposal_needs_a_decision_and_submission_keeps_confirmed(
    tmp_path: Path,
):
    ctx = _setup_review_test_env(tmp_path)
    targets, submission = _submit_proposal_check(ctx)
    kept = {(s.annotation.annotation_id, s.version) for s in submission.snapshots}
    assert (targets[1].annotation_id, targets[1].version) not in kept
    assert (targets[0].annotation_id, targets[0].version) in kept
    assert submission.origin_key.mode == "proposal_check"
    assert len(submission.decisions) == len(targets)


def test_submission_kind_is_proposal_check():
    assert submission_kind(None, "proposal_check") == "proposal_check"
    assert submission_kind(None, "independent") == "annotation"
    assert submission_kind("consolidation", "review") == "consolidation"


def test_handover_refuses_a_person_with_a_submitted_proposal_check(tmp_path: Path):
    """``work_rounds.require_independent`` counts a submitted proposal check (R9)."""
    ctx = _setup_review_test_env(tmp_path)
    _submit_proposal_check(ctx)
    with ctx["repo"].db.transaction() as conn:
        pid = _pid(conn)
        case_id, language = conn.execute(
            select(DocumentRow.case_id, DocumentRow.language).where(
                DocumentRow.project_id == pid, DocumentRow.document_id == "doc-1"
            )
        ).one()
        with pytest.raises(DomainError) as refused:
            # user_id -1 holds no assignment: only the submission can refuse.
            require_independent(
                conn,
                pid,
                case_id=case_id,
                language=language,
                user_id=-1,
                pseudonym="checker-1",
                excluding=None,
            )
    assert refused.value.code == "HANDOVER_NOT_INDEPENDENT"


def _review_inputs(env):  # type: ignore[no-untyped-def]
    return env.client.post(
        "/api/v1/workspaces/review-inputs",
        json={
            "project_key": "proj",
            "document_id": "EN100017",
            "mode": "proposal_check",
        },
    )


def _newest(env) -> list[tuple[str, str]]:  # type: ignore[no-untyped-def]
    with env.db.transaction() as conn:
        pid = Repository._project_id(conn, "proj")
        assert pid is not None
        return [
            (r.annotation_id, r.version)
            for r in newest_proposal_refs(conn, pid, "EN100017")
        ]


def test_review_inputs_hide_proposals_from_an_annotator_from_scratch(checker):
    response = _review_inputs(checker)
    assert response.status_code == 404, response.text


def test_review_inputs_in_review_mode_stay_hidden_from_scratch(tmp_path: Path):
    from auth_harness import logged_in
    from t1_fixtures import bundle, run_import, unit
    from test_proposal_queries import _app, create_project

    app = _app(tmp_path)
    create_project(app.state.repo.db)
    assert (
        run_import(app.state.repo.db, bundle(tmp_path / "a.zip", [unit("EN100017")]))
        .status
        == "succeeded"
    )
    client = logged_in(
        app,
        "both",
        projects={"proj": ["annotator", "adjudicator"]},
        assignments=[("proj", "EN100017", "annotate")],
    )
    response = client.post(
        "/api/v1/workspaces/review-inputs",
        json={"project_key": "proj", "document_id": "EN100017", "mode": "review"},
    )
    assert response.status_code == 404, response.text


def test_review_inputs_offer_the_newest_set_to_an_annotator_from_proposals(checker):
    from_proposals(checker.db)
    response = _review_inputs(checker)
    assert response.status_code == 200, response.text
    newest = _newest(checker)
    assert newest
    assert [
        (p["annotation"]["annotation_id"], p["version"]) for p in response.json()
    ] == newest


def test_open_refuses_targets_outside_the_newest_set(checker, tmp_path: Path):
    from t1_fixtures import annotation, bundle, run_import, unit

    from ontocurator.domain.annotations import AnnotationRef
    from ontocurator.domain.review import ReviewTargetSet

    old = _newest(checker)
    later = unit("EN100017", set_id="set-b", annotations=[annotation("p3", (63, 76))])
    assert (
        run_import(checker.db, bundle(tmp_path / "b.zip", [later], "b-2")).status
        == "succeeded"
    )
    from_proposals(checker.db)
    stale = ReviewTargetSet.create(
        [AnnotationRef(annotation_id=old[0][0], version=old[0][1])]
    )
    response = checker.client.post(
        "/api/v1/workspaces/open",
        json={
            "project_key": "proj",
            "document_id": "EN100017",
            "mode": "proposal_check",
            "targets": stale.model_dump(mode="json"),
            "pending_proposal_set_ids": [],
        },
    )
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "INVALID_TARGET_SET"


def test_first_open_offers_only_the_newest_set(checker, tmp_path: Path):
    from t1_fixtures import annotation, bundle, run_import, unit

    later = unit("EN100017", set_id="set-b", annotations=[annotation("p3", (63, 76))])
    assert (
        run_import(checker.db, bundle(tmp_path / "b.zip", [later], "b-2")).status
        == "succeeded"
    )
    from_proposals(checker.db)
    response = checker.client.post(
        "/api/v1/workspaces/open",
        json={
            "project_key": "proj",
            "document_id": "EN100017",
            "mode": "proposal_check",
        },
    )
    assert response.status_code == 200, response.text
    offered = {
        (p["annotation"]["annotation_id"], p["version"])
        for p in response.json()["view"]["available_inputs"]
    }
    assert offered == set(_newest(checker))
