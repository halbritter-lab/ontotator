"""Transactional resolution commands, exact provenance and authority regressions."""

from datetime import UTC, datetime

import pytest
from auth_harness import logged_in
from sqlalchemy import select, update
from t1_fixtures import annotation, unit
from test_reanchor_job import children, corrected, execute, generated
from test_reanchor_resolutions import opened
from test_reanchor_resolutions import pending as pending
from test_reanchor_resolutions import runtime as runtime

from ontocurator.storage.tables import AssignmentRow, EditEventRow


def envelope(payload, revision=0, mutation="resolve"):
    return {"mutation_id": mutation, "expected_revision": revision, "payload": payload}


def item(view, index=0):
    return view["view"]["draft"]["reanchor_inputs"][index]


def command(ref, **extra):
    return {
        "command": "recreate_reanchor",
        "item": ref,
        "annotation_id": "new",
        "evidence_id": "new-evidence",
        "term_id": "HP:0001250",
        "layer_id": "hpo",
        "type_id": "phenotype",
        "axes_values": {
            "assertion": "present",
            "experiencer": "patient",
            "temporality": "current",
        },
        "segments": [{"start": 2, "end": 6}],
        **extra,
    }


def resolve(env, opened_view, payload, revision=0, mutation="resolve"):
    return env.reviewer.post(
        f"/api/v1/workspaces/{opened_view['workspace_id']}/reanchor-resolutions",
        json=envelope(payload, revision, mutation),
    )


def create(env, opened_view, payload=None, revision=0, mutation="create"):
    return env.reviewer.post(
        f"/api/v1/workspaces/{opened_view['workspace_id']}/commands",
        json=envelope(payload or command(item(opened_view)), revision, mutation),
    )


def test_dismiss_requires_reason_and_is_private_with_receipt(pending):
    first = opened(pending).json()
    ref = item(first)
    blank = resolve(
        pending, first, {"item": ref, "outcome": "dismissed", "reason": " "}
    )
    assert blank.status_code == 422, blank.text
    payload = {
        "item": ref,
        "outcome": "dismissed",
        "reason": "No corresponding finding.",
    }
    result = resolve(pending, first, payload)
    assert result.status_code == 200, result.text
    assert result.json()["revision"] == 1
    assert (
        result.json()["reanchor_resolutions"][0]["reviewer_id"]
        == first["view"]["key"]["annotator_id"]
    )
    assert resolve(pending, first, payload).json() == result.json()
    other = logged_in(
        pending.app,
        "other",
        projects={"proj": ["adjudicator"]},
        assignments=[("proj", pending.output["document_id"], "review")],
    )
    assert opened(pending, other).json()["view"]["draft"]["reanchor_resolutions"] == []
    with pending.db.transaction() as conn:
        events = conn.execute(
            select(EditEventRow).where(
                EditEventRow.command["outcome"].astext == "dismissed"
            )
        ).all()
        assert len(events) == 1


def test_recreate_exact_unicode_current_evidence_then_resolve_and_invalidate(pending):
    view = opened(pending).json()
    result = create(pending, view)
    assert result.status_code == 200, result.text
    draft = result.json()
    assert create(pending, view).json() == draft
    snap = draft["annotations"][0]
    assert snap["document_id"] == pending.output["document_id"]
    assert snap["evidence"][0]["mention"]["segments"] == [{"start": 2, "end": 6}]
    assert snap["annotation"]["provenance"]["source_refs"] == [
        f"{item(view)['source_ref']['annotation_id']}:{item(view)['source_ref']['version']}"
    ]
    replacement = {"annotation_id": "new", "version": snap["version"]}
    payload = {"item": item(view), "outcome": "recreated", "replacement": replacement}
    result = resolve(pending, view, payload, 1)
    assert result.status_code == 200, result.text
    edit = create(
        pending,
        view,
        {"command": "set_term", "annotation_id": "new", "term_id": "HP:0001252"},
        2,
        "edit",
    )
    assert edit.status_code == 200, edit.text
    assert edit.json()["reanchor_resolutions"] == []
    stale = resolve(pending, view, payload, 3, "stale-link")
    assert stale.status_code == 422, stale.text
    replacement["version"] = edit.json()["annotations"][0]["version"]
    assert resolve(pending, view, payload, 3, "relink").status_code == 200
    deleted = create(
        pending,
        view,
        {"command": "delete_draft_annotation", "annotation_id": "new"},
        4,
        "delete",
    )
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["reanchor_resolutions"] == []


@pytest.mark.parametrize("submitted_axes", [{}, {"assertion": "present"}])
@pytest.mark.parametrize("finish", ["edit", "submit_and_export"])
def test_recreate_preserves_verified_absent_historical_axes_and_defaults(
    runtime, submitted_axes, finish
):
    original = annotation("absent-past", (6, 19), assertion="absent")
    original["axes"]["temporality"] = {"value": "historical", "basis": "chosen"}
    runtime.source = unit("case", annotations=[original])
    corrected(runtime, "😀 Neue Befunde Ω")
    assert execute(runtime, children(runtime)[0]).status == "succeeded"
    runtime.output = generated(runtime)[0]
    runtime.reviewer = logged_in(
        runtime.app,
        "reviewer",
        projects={"proj": ["adjudicator"]},
        assignments=[("proj", runtime.output["document_id"], "review")],
    )
    view = opened(runtime).json()
    result = create(runtime, view, command(item(view), axes_values=submitted_axes))
    assert result.status_code == 200, result.text
    expected = {
        "assertion": "absent",
        "experiencer": "patient",
        "temporality": "historical",
    }
    recreated = result.json()["annotations"][0]["annotation"]
    assert recreated["axes_values"] == expected
    assert recreated["axes_defaulted"] == ["experiencer"]
    enriched = view["view"]["pending_reanchor_items"][0]
    assert enriched["axes_values"] == expected
    assert enriched["axes_defaulted"] == ["experiencer"]
    # Enrichment must not alter the immutable producer payload.
    assert "axes_values" not in runtime.output["pending_items"][0]
    if finish == "submit_and_export":
        from test_reanchor_resolution_roundtrip import submitted

        from ontocurator.domain.workspace import Submission
        from ontocurator.exchange.t1 import layers_for, submission_to_unit

        linked = resolve(
            runtime,
            view,
            {
                "item": item(view),
                "outcome": "recreated",
                "replacement": {
                    "annotation_id": "new",
                    "version": result.json()["annotations"][0]["version"],
                },
            },
            1,
        )
        assert linked.status_code == 200, linked.text
        submitted_result = submitted(runtime, view, 2)
        assert submitted_result.status_code == 200, submitted_result.text
        submission = Submission.model_validate(submitted_result.json())
        assert len(submission.snapshots) == 1
        assert submission.snapshots[0].annotation.axes_values == expected
        assert submission.snapshots[0].annotation.axes_defaulted == ["experiencer"]
        repo = runtime.app.state.repo
        profile = repo.get_task_profile("proj")
        exported, _ = submission_to_unit(
            submission,
            repo.get_document("proj", runtime.output["document_id"]),
            profile,
            layers_for(profile, repo.project_pins("proj")),
            repo.t1_export_content("proj").proposals,
            set_id="reviewed-absent-historical",
            variant=repo.get_variant("proj", runtime.output["document_id"]),
            source_variant_hashes={
                v.document_id: v.text_sha256 for v in repo._variants("proj")
            },
            single_native_case=False,
        )
        assert len(exported.annotation_set.annotations) == 1
        axes = exported.annotation_set.annotations[0].axes
        assert {key: value.model_dump() for key, value in axes.items()} == {
            "assertion": {"value": "absent", "basis": "chosen"},
            "temporality": {"value": "historical", "basis": "chosen"},
            "experiencer": {"value": "patient", "basis": "defaulted"},
        }
        return
    edited = create(
        runtime,
        view,
        {
            "command": "set_axes",
            "annotation_id": "new",
            "axes_values": {**expected, "assertion": "present"},
            "chosen_axis_ids": ["experiencer"],
        },
        1,
        "explicit-axis-edit",
    )
    assert edited.status_code == 200, edited.text
    updated = edited.json()["annotations"][0]["annotation"]
    assert updated["axes_values"]["assertion"] == "present"
    assert updated.get("axes_defaulted", []) == []


@pytest.mark.parametrize("forgery", ["set", "source", "layer", "ordinary"])
def test_forged_recreate_denied_without_changes(pending, forgery):
    view = opened(pending).json()
    payload = command(item(view))
    if forgery == "set":
        payload["item"]["proposal_set_id"] += 1000
    if forgery == "source":
        payload["item"]["source_ref"]["version"] = "forged"
    if forgery == "layer":
        payload["layer_id"] = "foreign"
    if forgery == "ordinary":
        payload = {k: v for k, v in payload.items() if k != "item"}
        payload.update(
            command="create_annotation",
            source_annotation_id=item(view)["source_ref"]["annotation_id"],
            source_version=item(view)["source_ref"]["version"],
        )
    response = create(pending, view, payload)
    assert response.status_code == 422, response.text
    assert opened(pending).json()["view"]["draft"]["revision"] == 0


def test_revoked_assignment_cannot_replay_or_resolve(pending):
    view = opened(pending).json()
    payload = {"item": item(view), "outcome": "dismissed", "reason": "No match"}
    assert resolve(pending, view, payload).status_code == 200
    with pending.db.transaction() as conn:
        conn.execute(update(AssignmentRow).values(revoked_at=datetime.now(UTC)))
    assert resolve(pending, view, payload).status_code == 404


def test_stale_revision_and_mutation_reuse_do_not_change_resolution(pending):
    view = opened(pending).json()
    payload = {"item": item(view), "outcome": "dismissed", "reason": "No match"}
    assert resolve(pending, view, payload, 99).status_code == 409
    saved = resolve(pending, view, payload)
    assert saved.status_code == 200
    conflict = resolve(pending, view, {**payload, "reason": "Different reason"})
    assert conflict.status_code == 409
    assert opened(pending).json()["view"]["draft"] == saved.json()


def test_foreign_workspace_and_replacement_denied(pending):
    view = opened(pending).json()
    other = logged_in(
        pending.app,
        "foreign",
        projects={"proj": ["lead", "adjudicator"]},
        assignments=[("proj", pending.output["document_id"], "review")],
    )
    payload = {"item": item(view), "outcome": "dismissed", "reason": "No match"}
    foreign = other.post(
        f"/api/v1/workspaces/{view['workspace_id']}/reanchor-resolutions",
        json=envelope(payload),
    )
    assert foreign.status_code == 403, foreign.text
    missing = resolve(
        pending,
        view,
        {
            "item": item(view),
            "outcome": "recreated",
            "replacement": {"annotation_id": "foreign", "version": "v"},
        },
    )
    assert missing.status_code == 422
    assert opened(pending).json()["view"]["draft"]["revision"] == 0


def test_independent_workspace_cannot_recreate_or_resolve(pending):
    review = opened(pending).json()
    person = logged_in(
        pending.app,
        "independent",
        projects={"proj": ["annotator"]},
        assignments=[("proj", pending.output["document_id"], "annotate")],
    )
    own = opened(pending, person, mode="independent").json()
    for suffix, payload in (
        ("commands", command(item(review))),
        (
            "reanchor-resolutions",
            {"item": item(review), "outcome": "dismissed", "reason": "No match"},
        ),
    ):
        denied = person.post(
            f"/api/v1/workspaces/{own['workspace_id']}/{suffix}", json=envelope(payload)
        )
        assert denied.status_code == 422, denied.text
    assert (
        opened(pending, person, mode="independent").json()["view"]["draft"]["revision"]
        == 0
    )


def test_forged_correction_lineage_cannot_recreate(pending):
    from pg_harness import owner_engine

    from ontocurator.storage.tables import DocumentRow

    view = opened(pending).json()
    with owner_engine(pending.db).begin() as conn:
        conn.execute(
            update(DocumentRow)
            .where(DocumentRow.document_id == pending.output["document_id"])
            .values(origin="native", derived_from=None)
        )
    result = create(pending, view)
    assert result.status_code == 422, result.text
    assert result.json()["code"] == "INVALID_REANCHOR_ITEM"


@pytest.mark.parametrize("path", ["{text_sha256}", "{annotation,layer_id}"])
def test_diagnostic_source_mismatch_can_be_dismissed_but_not_recreated(pending, path):
    from pg_harness import tamper
    from test_reanchor_resolution_roundtrip import submitted

    source = pending.output["pending_items"][0]["source_ref"]
    # Simulate historical content with a diagnostic hash mismatch. Immutable
    # row identity and the producer's exact predecessor membership stay intact.
    tamper(
        pending.db,
        "annotation_snapshots",
        "UPDATE ontocurator.annotation_snapshots SET payload = jsonb_set(payload, CAST(:path AS text[]), '\"diagnostic-mismatch\"') WHERE annotation_id = :aid AND version = :version",
        path=path,
        aid=source["annotation_id"],
        version=source["version"],
    )
    view = opened(pending)
    assert view.status_code == 200, view.text
    view = view.json()
    assert view["view"]["pending_reanchor_items"][0]["type_id"] is None
    assert view["view"]["pending_reanchor_items"][0]["axes_values"] is None
    assert view["view"]["pending_reanchor_items"][0]["axes_defaulted"] is None
    denied = create(pending, view)
    assert denied.status_code == 422, denied.text
    assert denied.json()["code"] == "INVALID_REANCHOR_ITEM"
    dismissed = resolve(
        pending,
        view,
        {
            "item": item(view),
            "outcome": "dismissed",
            "reason": "Historical source cannot be validated",
        },
    )
    assert dismissed.status_code == 200, dismissed.text
    second = resolve(
        pending,
        view,
        {
            "item": item(view, 1),
            "outcome": "dismissed",
            "reason": "No current counterpart",
        },
        1,
        "dismiss-second",
    )
    assert second.status_code == 200, second.text
    submission = submitted(pending, view, 2)
    assert submission.status_code == 200, submission.text
    assert submission.json()["snapshots"] == []
    assert submission.json()["reanchor_resolutions"][0]["outcome"] == "dismissed"


def test_submit_blocks_each_unresolved_frozen_input_with_count(pending):
    view = opened(pending).json()

    def submit(revision, mutation):
        return pending.reviewer.post(
            f"/api/v1/workspaces/{view['workspace_id']}/submit",
            json=envelope(
                {"document_checked": True, "checked_layer_ids": ["hpo"]},
                revision,
                mutation,
            ),
        )

    blocked = submit(0, "blocked-two")
    assert blocked.status_code == 422, blocked.text
    assert blocked.json()["code"] == "REANCHOR_ITEMS_UNRESOLVED"
    assert blocked.json()["details"] == {"count": 2}
    unchanged = opened(pending).json()["view"]
    assert unchanged["draft"]["revision"] == 0
    assert unchanged["submissions"] == []
    dismissed = resolve(
        pending,
        view,
        {"item": item(view), "outcome": "dismissed", "reason": "No current finding"},
    )
    assert dismissed.status_code == 200, dismissed.text
    blocked = submit(1, "blocked-one")
    assert blocked.status_code == 422, blocked.text
    assert blocked.json()["details"] == {"count": 1}
    final = resolve(
        pending,
        view,
        {
            "item": item(view, 1),
            "outcome": "dismissed",
            "reason": "No corresponding evidence",
        },
        1,
        "dismiss-second",
    )
    assert final.status_code == 200, final.text
    result = submit(2, "complete")
    assert result.status_code == 200, result.text
    assert len(result.json()["reanchor_resolutions"]) == 2
