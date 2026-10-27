"""Carried inputs: atomic dismissal, clearing with restore, submission guard."""

import pytest
from auth_harness import logged_in
from test_round_inputs_access_api import carried_round  # noqa: F401
from test_round_read_fields import _submit_first_round
from test_work_rounds import rounds  # noqa: F401

from ontotator.application.editing import EditingService
from ontotator.application.submissions import SubmissionService
from ontotator.application.work_rounds import RoundInputResolutionService
from ontotator.authz.scoped import ScopedRepository
from ontotator.domain.errors import DomainError
from ontotator.domain.workspace import Draft, MutationEnvelope


def _ctx(rounds):  # noqa: F811
    repo, access, actor, _assignment, ontology = rounds
    repo, _a, _first, _submission, carried = _submit_first_round(rounds)
    scoped = ScopedRepository(repo.db, access, actor)
    item = repo.get_round_input_inventory("pkg-1", carried.round_id)[0]
    return repo, scoped, ontology, carried.workspace_key, item


def _apply(scoped, ontology, key, revision, payload) -> Draft:  # type: ignore[no-untyped-def]
    return EditingService(scoped, ontology).apply(
        key,
        MutationEnvelope(
            mutation_id=f"edit-{revision}", expected_revision=revision, payload=payload
        ),
    )


def _edit_carried_finding(scoped, ontology, key, carried_id) -> Draft:  # type: ignore[no-untyped-def]
    """Change note and one axis value and add a mention, as the editor does."""
    draft = _apply(
        scoped,
        ontology,
        key,
        0,
        {
            "command": "set_annotation_note",
            "annotation_id": carried_id,
            "note": "Edited",
        },
    )
    draft = _apply(
        scoped,
        ontology,
        key,
        draft.revision,
        {
            "command": "set_axes",
            "annotation_id": carried_id,
            "axes_values": {"assertion": "absent"},
            "chosen_axis_ids": ["assertion"],
        },
    )
    return _apply(
        scoped,
        ontology,
        key,
        draft.revision,
        {
            "command": "attach_mention",
            "annotation_id": carried_id,
            "evidence_id": "carried-ev",
            "segments": [{"start": 26, "end": 35}],
        },
    )


def _delete_finding(scoped, ontology, key, carried_id, *, expected_revision) -> Draft:  # type: ignore[no-untyped-def]
    return _apply(
        scoped,
        ontology,
        key,
        expected_revision,
        {"command": "delete_draft_annotation", "annotation_id": carried_id},
    )


def _dismiss(input_id, *, remove=True, revision=0, mutation_id="d"):  # type: ignore[no-untyped-def]
    payload = {"input_id": input_id, "outcome": "dismissed", "reason": "R"}
    if remove:
        payload["remove_carried_finding"] = True
    return MutationEnvelope(
        mutation_id=mutation_id, expected_revision=revision, payload=payload
    )


def _clear(input_id, *, revision, mutation_id="u"):  # type: ignore[no-untyped-def]
    return MutationEnvelope(
        mutation_id=mutation_id,
        expected_revision=revision,
        payload={"command": "clear_round_input_resolution", "input_id": input_id},
    )


def test_dismiss_is_rejected_while_the_carried_finding_exists(rounds):  # noqa: F811
    _repo, scoped, _o, key, item = _ctx(rounds)
    with pytest.raises(DomainError, match="ROUND_INPUT_CARRIED_FINDING_PRESENT"):
        RoundInputResolutionService(scoped).resolve(
            key,
            MutationEnvelope(
                mutation_id="d",
                expected_revision=0,
                payload={
                    "input_id": item["input_id"],
                    "outcome": "dismissed",
                    "reason": "Not in this text",
                },
            ),
        )


def test_dismiss_with_removal_removes_finding_and_records_one_event(rounds):  # noqa: F811
    repo, scoped, ontology, key, item = _ctx(rounds)
    carried_id = item["target_snapshot"]["annotation"]["annotation_id"]
    draft = RoundInputResolutionService(scoped).resolve(
        key,
        MutationEnvelope(
            mutation_id="d",
            expected_revision=0,
            payload={
                "input_id": item["input_id"],
                "outcome": "dismissed",
                "reason": "Not in this text",
                "remove_carried_finding": True,
            },
        ),
    )
    assert draft.revision == 1
    assert all(s.annotation.annotation_id != carried_id for s in draft.annotations)
    assert not any(e.mention.evidence_id.startswith(carried_id) for e in draft.evidence)
    [resolution] = draft.round_input_resolutions
    assert resolution.outcome == "dismissed" and resolution.reason == "Not in this text"
    events = [
        e
        for e in repo.edit_log("pkg-1")
        if e["command"].get("input_id") == item["input_id"]
    ]
    assert len(events) == 1 and events[0]["command"]["remove_carried_finding"] is True
    # submission accepts the dismissed input
    SubmissionService(scoped, ontology).submit(
        key,
        MutationEnvelope(
            mutation_id="s", expected_revision=1, payload={"document_checked": True}
        ),
    )


def test_atomic_dismissal_removes_orphaned_evidence(rounds):  # noqa: F811
    _repo, scoped, ontology, key, item = _ctx(rounds)
    carried_id = item["target_snapshot"]["annotation"]["annotation_id"]
    edited = _edit_carried_finding(scoped, ontology, key, carried_id)
    assert any(e.mention.evidence_id == "carried-ev" for e in edited.evidence)
    draft = RoundInputResolutionService(scoped).resolve(
        key, _dismiss(item["input_id"], revision=edited.revision)
    )
    assert draft.revision == edited.revision + 1
    assert draft.annotations == [] and draft.evidence == []


def test_removal_flag_is_invalid_for_completion(rounds):  # noqa: F811
    _repo, scoped, _o, key, item = _ctx(rounds)
    with pytest.raises(DomainError, match="ROUND_INPUT_INVALID"):
        RoundInputResolutionService(scoped).resolve(
            key,
            MutationEnvelope(
                mutation_id="x",
                expected_revision=0,
                payload={
                    "input_id": item["input_id"],
                    "outcome": "completed",
                    "remove_carried_finding": True,
                    "annotation_ref": {
                        "annotation_id": item["target_snapshot"]["annotation"][
                            "annotation_id"
                        ],
                        "version": item["target_snapshot"]["version"],
                    },
                },
            ),
        )


def test_clear_resets_a_dismissal_restores_the_finding_and_is_logged(rounds):  # noqa: F811
    repo, scoped, _o, key, item = _ctx(rounds)
    carried_id = item["target_snapshot"]["annotation"]["annotation_id"]
    service = RoundInputResolutionService(scoped)
    before = service.resolve(key, _dismiss(item["input_id"]))
    assert all(s.annotation.annotation_id != carried_id for s in before.annotations)
    cleared = service.clear(key, _clear(item["input_id"], revision=1))
    assert cleared.round_input_resolutions == [] and cleared.revision == 2
    [restored] = [
        s for s in cleared.annotations if s.annotation.annotation_id == carried_id
    ]
    # untouched since round start
    assert restored.version == item["target_snapshot"]["version"]
    assert repo.edit_log("pkg-1")[-1]["command"] == {
        "command": "clear_round_input_resolution",
        "input_id": item["input_id"],
    }
    # The restored state is what is stored, not only what was answered.
    reopened = scoped.open_draft(key)
    assert [s.version for s in reopened.annotations] == [restored.version]


def test_undo_restores_the_edited_version_with_values_note_and_evidence(rounds):  # noqa: F811
    _repo, scoped, ontology, key, item = _ctx(rounds)
    carried_id = item["target_snapshot"]["annotation"]["annotation_id"]
    edited = _edit_carried_finding(scoped, ontology, key, carried_id)
    snapshot = next(
        s for s in edited.annotations if s.annotation.annotation_id == carried_id
    )
    assert snapshot.version != item["target_snapshot"]["version"]
    assert snapshot.annotation.evidence_refs
    evidence = sorted(
        (e.mention.evidence_id, e.version)
        for e in edited.evidence
        if any(
            r.evidence_id == e.mention.evidence_id
            for r in snapshot.annotation.evidence_refs
        )
    )
    service = RoundInputResolutionService(scoped)
    service.resolve(key, _dismiss(item["input_id"], revision=edited.revision))
    cleared = service.clear(key, _clear(item["input_id"], revision=edited.revision + 1))
    [restored] = [
        s for s in cleared.annotations if s.annotation.annotation_id == carried_id
    ]
    assert restored == snapshot  # same version, values, note, evidence refs
    assert (
        sorted(
            (e.mention.evidence_id, e.version)
            for e in cleared.evidence
            if any(
                r.evidence_id == e.mention.evidence_id
                for r in restored.annotation.evidence_refs
            )
        )
        == evidence
    )


def test_second_undo_after_redismissal_restores_again(rounds):  # noqa: F811
    _repo, scoped, _o, key, item = _ctx(rounds)
    carried_id = item["target_snapshot"]["annotation"]["annotation_id"]
    service = RoundInputResolutionService(scoped)
    service.resolve(key, _dismiss(item["input_id"]))
    service.clear(key, _clear(item["input_id"], revision=1))
    service.resolve(key, _dismiss(item["input_id"], revision=2, mutation_id="d2"))
    cleared = service.clear(key, _clear(item["input_id"], revision=3, mutation_id="u2"))
    assert [s.annotation.annotation_id for s in cleared.annotations] == [carried_id]


def test_undo_of_a_plain_dismissal_restores_nothing(rounds):  # noqa: F811
    _repo, scoped, ontology, key, item = _ctx(rounds)
    carried_id = item["target_snapshot"]["annotation"]["annotation_id"]
    deleted = _delete_finding(
        scoped, ontology, key, carried_id, expected_revision=0
    )  # user deletes it first
    service = RoundInputResolutionService(scoped)
    service.resolve(
        key, _dismiss(item["input_id"], remove=False, revision=deleted.revision)
    )
    cleared = service.clear(
        key, _clear(item["input_id"], revision=deleted.revision + 1)
    )
    assert cleared.round_input_resolutions == []
    assert all(s.annotation.annotation_id != carried_id for s in cleared.annotations)


def test_submission_rejects_a_legacy_dismissal_while_the_carried_finding_exists(rounds):  # noqa: F811
    repo, scoped, ontology, key, item = _ctx(rounds)
    from ontotator.domain.workspace import RoundInputResolution

    def legacy(draft):  # type: ignore[no-untyped-def]  # what the pre-B2 resolve() allowed
        draft.round_input_resolutions = [
            RoundInputResolution(
                input_id=item["input_id"], outcome="dismissed", reason="R"
            )
        ]
        return draft

    repo.run_mutation(
        key,
        MutationEnvelope(
            mutation_id="legacy", expected_revision=0, payload={"legacy": True}
        ),
        legacy,
    )
    with pytest.raises(DomainError, match="ROUND_INPUT_CARRIED_FINDING_PRESENT"):
        SubmissionService(scoped, ontology).submit(
            key,
            MutationEnvelope(
                mutation_id="s", expected_revision=1, payload={"document_checked": True}
            ),
        )


def test_submission_rejects_a_finding_recreated_with_the_carried_id(rounds):  # noqa: F811
    _repo, scoped, ontology, key, item = _ctx(rounds)
    carried = item["target_snapshot"]["annotation"]
    RoundInputResolutionService(scoped).resolve(key, _dismiss(item["input_id"]))
    _apply(
        scoped,
        ontology,
        key,
        1,
        {
            "command": "create_annotation",
            "annotation_id": carried["annotation_id"],
            "term_id": carried["term_id"],
            "axes_values": {"assertion": "present"},
            "chosen_axis_ids": ["assertion"],
            "note": "Re-created",
        },
    )
    with pytest.raises(DomainError, match="ROUND_INPUT_CARRIED_FINDING_PRESENT"):
        SubmissionService(scoped, ontology).submit(
            key,
            MutationEnvelope(
                mutation_id="s", expected_revision=2, payload={"document_checked": True}
            ),
        )


def test_clear_does_not_duplicate_a_recreated_finding(rounds):  # noqa: F811
    _repo, scoped, ontology, key, item = _ctx(rounds)
    carried = item["target_snapshot"]["annotation"]
    service = RoundInputResolutionService(scoped)
    service.resolve(key, _dismiss(item["input_id"]))
    recreated = _apply(
        scoped,
        ontology,
        key,
        1,
        {
            "command": "create_annotation",
            "annotation_id": carried["annotation_id"],
            "term_id": carried["term_id"],
            "axes_values": {"assertion": "present"},
            "chosen_axis_ids": ["assertion"],
            "note": "Re-created",
        },
    )
    cleared = service.clear(key, _clear(item["input_id"], revision=2))
    assert cleared.annotations == recreated.annotations


def test_clear_without_resolution_or_unknown_input_is_invalid(rounds):  # noqa: F811
    _repo, scoped, _o, key, item = _ctx(rounds)
    for input_id in (item["input_id"], "nope"):
        with pytest.raises(DomainError, match="ROUND_INPUT_INVALID"):
            RoundInputResolutionService(scoped).clear(
                key, _clear(input_id, revision=0, mutation_id=input_id)
            )


def test_clear_after_submission_is_refused(rounds):  # noqa: F811
    _repo, scoped, ontology, key, item = _ctx(rounds)
    service = RoundInputResolutionService(scoped)
    service.resolve(key, _dismiss(item["input_id"]))
    SubmissionService(scoped, ontology).submit(
        key,
        MutationEnvelope(
            mutation_id="s", expected_revision=1, payload={"document_checked": True}
        ),
    )
    with pytest.raises(DomainError):
        service.clear(key, _clear(item["input_id"], revision=2))


def _status(response):  # type: ignore[no-untyped-def]
    return response.status_code, response.json().get("code")


def test_http_dismiss_conflict_clear_and_foreign_workspace(carried_round):  # noqa: F811
    app, owner, carried = carried_round
    opened = owner.post(f"/api/v1/rounds/{carried['round_id']}/open")
    assert opened.status_code == 200, opened.text
    workspace = opened.json()["workspace_id"]
    [item] = owner.get(f"/api/v1/rounds/{carried['round_id']}/inputs").json()
    base = f"/api/v1/workspaces/{workspace}/round-input-resolutions"
    plain = _dismiss(item["input_id"], remove=False).model_dump()
    assert _status(owner.post(base, json=plain)) == (
        409,
        "ROUND_INPUT_CARRIED_FINDING_PRESENT",
    )
    dismissed = owner.post(base, json=_dismiss(item["input_id"]).model_dump())
    assert dismissed.status_code == 200, dismissed.text
    assert dismissed.json()["annotations"] == []
    cleared = owner.post(
        f"{base}/clear", json=_clear(item["input_id"], revision=1).model_dump()
    )
    assert cleared.status_code == 200, cleared.text
    body = cleared.json()
    assert body["revision"] == 2 and not body.get("round_input_resolutions")
    assert len(body["annotations"]) == 1
    other = logged_in(
        app,
        "bert",
        projects={"pkg-1": ["annotator"]},
        assignments=[("pkg-1", "doc-1", "annotate")],
    )
    foreign_clear = other.post(
        f"{base}/clear",
        json=_clear(item["input_id"], revision=2, mutation_id="x").model_dump(),
    )
    foreign_resolve = other.post(
        base, json=_dismiss(item["input_id"], revision=2, mutation_id="y").model_dump()
    )
    assert foreign_clear.status_code >= 400
    assert _status(foreign_clear) == _status(foreign_resolve)
