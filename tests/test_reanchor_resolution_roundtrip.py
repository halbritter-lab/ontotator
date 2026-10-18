"""Immutable submission read-back and exact reanchor resolution references."""

from sqlalchemy import select, update
from test_reanchor_resolution_api import command, create, envelope, item, resolve
from test_reanchor_resolutions import opened
from test_reanchor_resolutions import pending as pending
from test_reanchor_resolutions import runtime as runtime

from ontocurator.domain.workspace import Submission
from ontocurator.storage.tables import DraftRow, EditEventRow, SubmissionRow


def submitted(env, view, revision):
    return env.reviewer.post(
        f"/api/v1/workspaces/{view['workspace_id']}/submit",
        json=envelope(
            {"document_checked": True, "checked_layer_ids": ["hpo"]}, revision, "submit"
        ),
    )


def test_recreated_and_dismissed_resolutions_survive_submission_readback(pending):
    view = opened(pending).json()
    created = create(pending, view, command(item(view))).json()["annotations"][0]
    replacement = {"annotation_id": "new", "version": created["version"]}
    assert (
        resolve(
            pending,
            view,
            {"item": item(view), "outcome": "recreated", "replacement": replacement},
            1,
        ).status_code
        == 200
    )
    assert (
        resolve(
            pending,
            view,
            {
                "item": item(view, 1),
                "outcome": "dismissed",
                "reason": "No current counterpart",
            },
            2,
            "dismiss",
        ).status_code
        == 200
    )
    result = submitted(pending, view, 3)
    assert result.status_code == 200, result.text
    submission = result.json()
    assert submission["reanchor_inputs"] == view["view"]["draft"]["reanchor_inputs"]
    assert len(submission["reanchor_resolutions"]) == 2
    assert len(submission["snapshots"]) == 1
    assert submission["reanchor_resolutions"][0]["replacement"] == replacement
    assert submission["snapshots"][0]["annotation"]["provenance"]["source_refs"]
    readback = pending.reviewer.get(
        f"/api/v1/workspaces/{view['workspace_id']}/submissions/{submission['submission_id']}"
    )
    assert readback.status_code == 200, readback.text
    assert readback.json() == submission
    from ontocurator.exchange.t1 import layers_for, submission_to_unit

    repo = pending.app.state.repo
    profile = repo.get_task_profile("proj")
    unit, _ = submission_to_unit(
        Submission.model_validate(submission),
        repo.get_document("proj", pending.output["document_id"]),
        profile,
        layers_for(profile, repo.project_pins("proj")),
        {},
        set_id="reviewed-correction",
        variant=repo.get_variant("proj", pending.output["document_id"]),
        source_variant_hashes={
            v.document_id: v.text_sha256 for v in repo._variants("proj")
        },
        single_native_case=False,
    )
    assert len(unit.annotation_set.annotations) == 1
    assert unit.annotation_set.annotations[0].provenance.method == "edited"
    assert unit.annotation_set.annotations[0].provenance.source_refs == tuple(
        created["annotation"]["provenance"]["source_refs"]
    )
    with pending.db.transaction() as conn:
        stored = conn.execute(select(SubmissionRow.payload)).scalar_one()
        assert stored["reanchor_resolutions"] == submission["reanchor_resolutions"]
        events = conn.execute(select(EditEventRow.command, EditEventRow.user_id)).all()
        assert all(actor is not None for _, actor in events)
        assert any(payload.get("outcome") == "dismissed" for payload, _ in events)
    legacy = {
        key: value
        for key, value in submission.items()
        if key not in {"reanchor_inputs", "reanchor_resolutions"}
    }
    decoded = Submission.model_validate(legacy)
    assert decoded.reanchor_inputs == decoded.reanchor_resolutions == []


def test_submission_rejects_unresolved_frozen_inputs(pending):
    view = opened(pending).json()
    baseline = submitted(pending, view, 0)
    assert baseline.status_code == 422, baseline.text
    assert baseline.json()["code"] == "REANCHOR_ITEMS_UNRESOLVED"
    assert baseline.json()["details"] == {"count": 2}


def test_injected_dangling_replacement_is_rejected(pending):
    view = opened(pending).json()
    resolution = {
        "item": item(view),
        "outcome": "recreated",
        "reason": None,
        "reviewer_id": view["view"]["key"]["annotator_id"],
        "replacement": {"annotation_id": "missing", "version": "missing"},
    }
    with pending.db.transaction() as conn:
        conn.execute(update(DraftRow).values(reanchor_resolutions=[resolution]))
    result = submitted(pending, view, 0)
    assert result.status_code == 422, result.text
    with pending.db.transaction() as conn:
        assert conn.execute(select(SubmissionRow.submission_id)).first() is None


def test_old_submission_without_metadata_is_read_without_rewriting_payload(pending):
    from pg_harness import tamper
    from sqlalchemy import text

    from ontocurator.domain.review import ReviewTargetSet

    view = opened(
        pending,
        targets=ReviewTargetSet.create([]).model_dump(),
        pending_proposal_set_ids=[],
    ).json()
    original = submitted(pending, view, 0).json()
    submission_id = original["submission_id"]
    tamper(
        pending.db,
        "submissions",
        "UPDATE ontocurator.submissions SET payload = payload - 'reanchor_inputs' - 'reanchor_resolutions' WHERE submission_id = :sid",
        sid=submission_id,
    )
    with pending.db.transaction() as conn:
        before = conn.execute(
            text(
                "SELECT payload::text FROM ontocurator.submissions WHERE submission_id = :sid"
            ),
            {"sid": submission_id},
        ).scalar_one()
    readback = pending.reviewer.get(
        f"/api/v1/workspaces/{view['workspace_id']}/submissions/{submission_id}"
    )
    assert readback.status_code == 200, readback.text
    assert readback.json()["submission_id"] == submission_id
    assert readback.json()["reanchor_inputs"] == []
    assert readback.json()["reanchor_resolutions"] == []
    with pending.db.transaction() as conn:
        assert (
            conn.execute(
                text(
                    "SELECT payload::text FROM ontocurator.submissions WHERE submission_id = :sid"
                ),
                {"sid": submission_id},
            ).scalar_one()
            == before
        )
