"""Own submissions of an assignment across rounds, and round inputs in the detail."""

from auth_harness import logged_in
from test_round_inputs_access_api import (
    PROJECT,
    _ok,
    carried_round,  # noqa: F401
)


def _detail_path(submission_id: str) -> str:
    return f"/api/v1/projects/{PROJECT}/documents/doc-1/submissions/{submission_id}"


def _submit_carried_round(owner, carried):  # type: ignore[no-untyped-def]
    """Dismiss the one carried input (removing its finding) and submit Round 2."""
    workspace = _ok(owner.post(f"/api/v1/rounds/{carried['round_id']}/open"))[
        "workspace_id"
    ]
    [item] = _ok(owner.get(f"/api/v1/rounds/{carried['round_id']}/inputs"))
    draft = _ok(
        owner.post(
            f"/api/v1/workspaces/{workspace}/round-input-resolutions",
            json={
                "mutation_id": "d",
                "expected_revision": 0,
                "payload": {
                    "input_id": item["input_id"],
                    "outcome": "dismissed",
                    "reason": "Not in this text",
                    "remove_carried_finding": True,
                },
            },
        )
    )
    return _ok(
        owner.post(
            f"/api/v1/workspaces/{workspace}/submit",
            json={
                "mutation_id": "s2",
                "expected_revision": draft["revision"],
                "payload": {"document_checked": True},
            },
        )
    )


def test_owner_lists_submissions_of_all_rounds_oldest_first(carried_round):  # noqa: F811
    _app, owner, carried = carried_round
    second = _submit_carried_round(owner, carried)
    items = _ok(
        owner.get(f"/api/v1/assignments/{carried['assignment_id']}/submissions")
    )
    assert [i["round_ordinal"] for i in items] == [1, 2]
    assert items[0]["recorded_at"] <= items[1]["recorded_at"]
    assert [i["finding_count"] for i in items] == [1, 0]
    assert items[1]["submission_id"] == second["submission_id"]
    assert items[1]["round_id"] == carried["round_id"]
    assert items[0]["round_id"] not in (None, carried["round_id"])
    for item in items:
        assert item["document_id"] == "doc-1"
        assert (item["language"], item["version"]) == ("en", 1)


def test_lead_can_list_and_other_annotator_gets_not_found(carried_round):  # noqa: F811
    app, owner, carried = carried_round
    url = f"/api/v1/assignments/{carried['assignment_id']}/submissions"
    lead = logged_in(app, "lena", projects={PROJECT: ["lead"]}, assignments=[])
    assert _ok(lead.get(url)) == _ok(owner.get(url))
    other = logged_in(
        app,
        "bert",
        projects={PROJECT: ["annotator"]},
        assignments=[(PROJECT, "doc-1", "annotate")],
    )
    refused = other.get(url)
    rounds = other.get(f"/api/v1/assignments/{carried['assignment_id']}/rounds")
    assert refused.status_code == rounds.status_code == 404
    assert refused.json()["code"] == rounds.json()["code"] == "ASSIGNMENT_NOT_FOUND"
    assert "submission_id" not in refused.text


def test_new_round_without_submission_still_lists_earlier_rounds(carried_round):  # noqa: F811
    _app, owner, carried = carried_round
    [item] = _ok(
        owner.get(f"/api/v1/assignments/{carried['assignment_id']}/submissions")
    )
    assert item["round_ordinal"] == 1
    assert item["finding_count"] == 1


def test_detail_of_carry_forward_submission_contains_inputs_and_resolutions(
    carried_round,  # noqa: F811
):
    app, owner, carried = carried_round
    second = _submit_carried_round(owner, carried)
    first_id = carried["input_submission_ids"][0]
    lead = logged_in(app, "lena", projects={PROJECT: ["lead"]}, assignments=[])
    for client in (owner, lead):
        detail = _ok(client.get(_detail_path(second["submission_id"])))
        [item] = detail["round_inputs"]
        assert item["source_round_ordinal"] == 1
        assert item["source_submission_id"] == first_id
        [resolution] = detail["round_input_resolutions"]
        assert resolution["input_id"] == item["input_id"]
        assert resolution["outcome"] == "dismissed"
        assert resolution["reason"] == "Not in this text"
        assert isinstance(detail["checked_layer_ids"], list)
        assert detail["document_checked"] is True
        assert detail["reanchor_inputs"] == []
        assert detail["reanchor_resolutions"] == []
        assert detail["annotations"] == []

    first = _ok(owner.get(_detail_path(first_id)))
    assert first["round_inputs"] == []
    assert first["round_input_resolutions"] == []
    assert len(first["annotations"]) == 1
    assert first["document_checked"] is True


def test_unknown_and_foreign_assignments_answer_alike(carried_round):  # noqa: F811
    app, owner, carried = carried_round
    other = logged_in(app, "olga", projects={}, assignments=[])
    for ident, client in ((999_999, owner), (carried["assignment_id"], other)):
        for tail in ("submissions", "rounds", "round-sources"):
            response = client.get(f"/api/v1/assignments/{ident}/{tail}")
            assert response.status_code == 404, (ident, tail, response.text)
            assert response.json()["code"] == "ASSIGNMENT_NOT_FOUND"
