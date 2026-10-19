"""Who may read the carried inputs of a round (behaviour pinned, not changed)."""

import pytest
from auth_harness import logged_in
from test_editing import _setup_test_env
from test_review_findings import HP_PATH, _app

from ontocurator.assignments.service import AssignmentService

PROJECT = "pkg-1"


def _ok(response):  # type: ignore[no-untyped-def]
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def carried_round(tmp_path):
    repo, _ontology, _workspaces, _editor, _document = _setup_test_env(
        tmp_path / "source"
    )
    auto, _config = _app(tmp_path / "api", ontology_paths=[HP_PATH])
    app = auto.app
    app.state.repo.import_package(repo.export_package(PROJECT))
    owner = logged_in(
        app,
        "anna",
        projects={PROJECT: ["annotator"]},
        assignments=[(PROJECT, "doc-1", "annotate")],
    )
    [assignment] = AssignmentService(app.state.repo.db).list(PROJECT, user="anna")
    first = _ok(
        owner.post(
            f"/api/v1/assignments/{assignment.id}/rounds",
            json={"request_id": "r1", "expected_workflow_revision": 0},
        )
    )
    workspace = _ok(owner.post(f"/api/v1/rounds/{first['round_id']}/open"))[
        "workspace_id"
    ]
    draft = _ok(
        owner.post(
            f"/api/v1/workspaces/{workspace}/commands",
            json={
                "mutation_id": "c",
                "expected_revision": 0,
                "payload": {
                    "command": "create_annotation",
                    "annotation_id": "a",
                    "term_id": "HP:0001252",
                    "axes_values": {"assertion": "present"},
                    "chosen_axis_ids": ["assertion"],
                    "note": "N",
                },
            },
        )
    )
    submission = _ok(
        owner.post(
            f"/api/v1/workspaces/{workspace}/submit",
            json={
                "mutation_id": "s",
                "expected_revision": draft["revision"],
                "payload": {"document_checked": True},
            },
        )
    )
    [source] = _ok(owner.get(f"/api/v1/assignments/{assignment.id}/round-sources"))
    assert source["round_ordinal"] == 1 and source["finding_count"] == 1
    assert source["recorded_at"] is not None
    carried = _ok(
        owner.post(
            f"/api/v1/assignments/{assignment.id}/rounds",
            json={
                "request_id": "r2",
                "expected_workflow_revision": 1,
                "kind": "carry_forward",
                "source_submission_ids": [submission["submission_id"]],
            },
        )
    )
    return app, owner, carried


def test_owner_reads_enriched_inputs(carried_round):
    _app, owner, carried = carried_round
    round_id = carried["round_id"]
    assert carried["round_ordinal"] == 2 and carried["source_round_ordinal"] == 1
    listed = _ok(owner.get(f"/api/v1/assignments/{carried['assignment_id']}/rounds"))
    assert [r["round_ordinal"] for r in listed] == [1, 2]
    assert [r["input_count"] for r in listed] == [0, 1]
    [item] = _ok(owner.get(f"/api/v1/rounds/{round_id}/inputs"))
    assert item["source_round_ordinal"] == 1
    assert item["source_recorded_at"] is not None
    assert (item["source_language"], item["source_version"]) == ("en", 1)
    assert item["review_reason"] is None


def test_lead_reads_inputs(carried_round):
    app, owner, carried = carried_round
    round_id = carried["round_id"]
    lead = logged_in(app, "lena", projects={PROJECT: ["lead"]}, assignments=[])
    assert _ok(lead.get(f"/api/v1/rounds/{round_id}/inputs")) == _ok(
        owner.get(f"/api/v1/rounds/{round_id}/inputs")
    )


def _refusal(response):  # type: ignore[no-untyped-def]
    body = response.json()
    assert "source_snapshot" not in response.text
    return response.status_code, body.get("code")


def test_other_annotator_on_same_document_is_refused(carried_round):
    app, _owner, carried = carried_round
    round_id = carried["round_id"]
    other = logged_in(
        app,
        "bert",
        projects={PROJECT: ["annotator"]},
        assignments=[(PROJECT, "doc-1", "annotate")],
    )
    assert _refusal(other.get(f"/api/v1/rounds/{round_id}/inputs")) == (
        404,
        "ROUND_NOT_FOUND",
    )


def test_outsider_is_refused(carried_round):
    app, _owner, carried = carried_round
    round_id = carried["round_id"]
    outsider = logged_in(app, "otto", assignments=[])
    refused = _refusal(outsider.get(f"/api/v1/rounds/{round_id}/inputs"))
    unknown = _refusal(outsider.get("/api/v1/rounds/no-such-round/inputs"))
    # Pinned as found: both are 404 without item data, but the codes differ
    # (the project lookup answers first). This is a pre-existing existence
    # oracle (a real round id is distinguishable from an unknown one), tracked
    # as a separate hardening item; equalizing the codes is an access change
    # left to the user (editor plan B1, user decision 3).
    assert refused == (404, "PROJECT_NOT_FOUND")
    assert unknown == (404, "ROUND_NOT_FOUND")
