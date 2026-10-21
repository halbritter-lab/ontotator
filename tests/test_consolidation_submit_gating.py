"""Submit gating of consolidation rounds (acceptance fixes spec "WP-E
Backend > Submit", T10): the submit refuses ``CONSOLIDATION_GROUPS_OPEN``
(409, ``details.count``) while a group is open, by the rule the read uses
(a member without a decision or with only an uncertain one)."""

from __future__ import annotations

from typing import Any

import pytest
from test_consolidation_resolve_api import (
    access_of,
    build_round,
    group,
    inputs,
    mutate,
    ok,
    revision,
    view,
)
from work_plan_support import assign, doc

from ontocurator.application.work_rounds import WorkRoundService


@pytest.fixture
def cons(tmp_path):
    return build_round(tmp_path)


def submit(client: Any, workspace: str, expected: int, **extra: Any) -> Any:
    return client.post(
        f"/api/v1/workspaces/{workspace}/submit",
        json={
            "mutation_id": f"submit-{expected}-{len(extra)}",
            "expected_revision": expected,
            "payload": {"document_checked": True} | extra,
        },
    )


def submit_acknowledged(client: Any, workspace: str, expected: int) -> Any:
    response = submit(client, workspace, expected)
    if response.status_code != 200 and (
        response.json().get("code") == "AXIS_CONFIRMATION_WARNING"
    ):
        acknowledgement = response.json()["details"]["acknowledgement"]
        response = submit(
            client, workspace, expected, warning_acknowledgement=acknowledgement
        )
    return response


def test_open_groups_refuse_the_submit_with_their_count(cons):
    response = submit(cons.adj, view(cons)["workspace_id"], revision(cons))
    assert response.status_code == 409, response.text
    body = response.json()
    assert body["code"] == "CONSOLIDATION_GROUPS_OPEN"
    assert body["details"]["count"] == 3


def test_an_uncertain_decision_keeps_the_group_open(cons):
    ok(
        mutate(
            cons,
            "resolve",
            {"input_ids": inputs(group(cons, "term_differs")), "action": "keep_both"},
        )
    )
    ok(
        mutate(
            cons,
            "resolve",
            {"input_ids": inputs(group(cons, "values_differ")), "action": "leave_out"},
        )
    )
    partial = group(cons, "partial")
    inventory = {
        i["input_id"]: i
        for i in cons.env.app.state.repo.get_round_input_inventory(
            "proj", cons.round.round_id
        )
    }
    target = inventory[partial["members"][0]["input_id"]]["target_snapshot"]
    workspace = view(cons)["workspace_id"]
    decided = cons.adj.post(
        f"/api/v1/workspaces/{workspace}/decisions",
        json={
            "mutation_id": "uncertain",
            "expected_revision": revision(cons),
            "payload": {
                "target": {
                    "annotation_id": target["annotation"]["annotation_id"],
                    "version": target["version"],
                },
                "outcome": "uncertain",
                "note": "Not sure",
            },
        },
    )
    assert decided.status_code == 200, decided.text
    response = submit(cons.adj, workspace, revision(cons))
    assert response.status_code == 409, response.text
    assert response.json()["details"]["count"] == 1


def test_all_resolved_submits(cons):
    ok(
        mutate(
            cons,
            "resolve",
            {"input_ids": inputs(group(cons, "term_differs")), "action": "keep_both"},
        )
    )
    ok(
        mutate(
            cons,
            "resolve",
            {"input_ids": inputs(group(cons, "values_differ")), "action": "leave_out"},
        )
    )
    ok(
        mutate(
            cons,
            "resolve",
            {"input_ids": inputs(group(cons, "partial")), "action": "keep"},
        )
    )
    workspace = view(cons)["workspace_id"]
    response = submit_acknowledged(cons.adj, workspace, revision(cons))
    assert response.status_code == 200, response.text
    submitted = response.json()
    # The automatic match + two term annotations + the kept partial finding,
    # all with the provenance of a consolidation (uniform export).
    assert len(submitted["snapshots"]) == 4
    assert {
        s["annotation"]["provenance"]["method"] for s in submitted["snapshots"]
    } == {"merged"}
    assert all(
        s["annotation"]["annotation_id"].startswith("cons-")
        for s in submitted["snapshots"]
    )
    after = view(cons)
    assert after["read_only_reason"] == "submitted"
    assert [g["state"] for g in after["groups"]] == [
        "auto",
        "keep_both",
        "leave_out",
        "keep",
    ]


def test_document_checked_is_still_required(cons):
    workspace = view(cons)["workspace_id"]
    response = cons.adj.post(
        f"/api/v1/workspaces/{workspace}/submit",
        json={
            "mutation_id": "unchecked",
            "expected_revision": revision(cons),
            "payload": {"document_checked": False},
        },
    )
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "DOCUMENT_NOT_CHECKED"


def test_ordinary_rounds_are_not_gated(cons):
    from auth_harness import logged_in

    env = cons.env
    access, actor = access_of(env, "anno", "annotator")
    created = WorkRoundService(env.db).create(
        access,
        actor,
        assign(env, doc("c2", "en"), "anno", "annotate"),
        request_id="ordinary",
        expected_workflow_revision=0,
    )
    anno = logged_in(env.app, "anno", assignments=[])
    opened = anno.post(f"/api/v1/rounds/{created.round_id}/open")
    assert opened.status_code == 200, opened.text
    from ontocurator.api.routes import encode_workspace_id

    response = submit_acknowledged(anno, encode_workspace_id(created.workspace_key), 0)
    assert response.status_code == 200, response.text


def test_axis_warning_once_every_group_is_resolved(cons):
    from test_consolidation_resolve_api import resolve_all

    resolve_all(cons)
    workspace = view(cons)["workspace_id"]
    # Clear an axis of the kept partial finding in the editor: the result
    # now has an axis nobody chose.
    [kept] = group(cons, "partial")["annotation_ids"]
    cleared = cons.adj.post(
        f"/api/v1/workspaces/{workspace}/commands",
        json={
            "mutation_id": "clear-axis",
            "expected_revision": revision(cons),
            "payload": {
                "command": "set_axes",
                "annotation_id": kept,
                "axes_values": {"temporality": None},
            },
        },
    )
    assert cleared.status_code == 200, cleared.text
    assert group(cons, "partial")["state"] == "keep"
    expected = revision(cons)
    warned = submit(cons.adj, workspace, expected)
    assert warned.status_code == 422, warned.text
    assert warned.json()["code"] == "AXIS_CONFIRMATION_WARNING"
    acknowledgement = warned.json()["details"]["acknowledgement"]
    response = submit(
        cons.adj, workspace, expected, warning_acknowledgement=acknowledgement
    )
    assert response.status_code == 200, response.text
