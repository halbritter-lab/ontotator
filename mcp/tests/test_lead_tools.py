"""Lead tools for re-planning and corrections (issue 346): dry runs, then writes.

Each tool that removes or replaces work sends no write without confirm, and
with confirm sends exactly the revision and the work its dry run read.
"""

from __future__ import annotations

from typing import Any

import pytest
from conftest import ToolFailed, call
from fake_api import FakeApi, refusal
from mcp import Client
from shapes import build, page, panel, row, submission

pytestmark = pytest.mark.anyio

P = "/api/v1/projects/{key}"
TASK = "/api/v1/assignments/{assignment_id}"
PANEL = f"{P}/document-rows/{{case_id}}/{{language}}/final-panel"
REPORT = "/api/v1/problem-reports/{report_id}"
WRITES = ("POST", "PUT", "PATCH")


def _task(assignment_id: int = 3, **fields: Any) -> dict[str, Any]:
    return build(
        "AssignmentView",
        id=assignment_id,
        username="ann",
        task="annotate",
        status="in_progress",
        revoked_at=None,
        workflow_revision=7,
        **fields,
    )


def _writes(fake: FakeApi) -> list[tuple[str, str]]:
    return [(c.method, c.template) for c in fake.calls if c.method in WRITES]


async def test_a_new_round_is_a_dry_run_until_confirmed(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", f"{P}/assignments", [_task()])
    current = build("WorkRoundView", round_id="r1", kind="ordinary", active=True)
    fake.on("GET", f"{TASK}/rounds", [current])
    sources = [
        build("RoundSourceView", submission_id="s1"),
        build("RoundSourceView", submission_id="s2"),
    ]
    fake.on("GET", f"{TASK}/round-sources", sources)
    args: dict[str, Any] = {"project": "p", "assignment_id": 3, "kind": "carry_forward"}
    with pytest.raises(ToolFailed, match="name source_submission_id"):
        await call(mcp_client, "start_new_round", args)
    args["source_submission_id"] = "s2"
    dry = await call(mcp_client, "start_new_round", args)
    assert dry["applied"] is False
    assert dry["plan"]["current_round"]["round_id"] == "r1"
    assert _writes(fake) == []

    await call(mcp_client, "start_new_round", args | {"confirm": True})
    [created] = fake.calls_to("POST", f"{TASK}/rounds")
    body = created.json()
    assert body["expected_workflow_revision"] == 7
    assert body["kind"] == "carry_forward"
    assert body["source_submission_ids"] == ["s2"]

    restart = {"project": "p", "assignment_id": 3, "kind": "clean_restart"}
    with pytest.raises(ToolFailed, match="needs a reason"):
        await call(mcp_client, "start_new_round", restart | {"confirm": True})


async def test_a_mode_change_discards_exactly_what_its_preview_named(
    fake: FakeApi, mcp_client: Client
) -> None:
    author = build("PersonRefView", pseudonym="ann-0001")
    preview = build(
        "ModeChangePreview",
        case_id="c",
        language="en",
        from_mode="proposals",
        to_mode="scratch",
        revision=5,
        submissions=[
            build("DiscardedSubmissionView", submission_id="s1", author=author)
        ],
        assignments=[],
    )
    fake.on("POST", f"{P}/annotation-mode-changes/preview", preview)
    args = {
        "project": "p",
        "case_id": "c",
        "language": "en",
        "mode": "scratch",
        "reason": "Proposals were wrong",
    }
    dry = await call(mcp_client, "change_annotation_mode", args)
    assert dry["applied"] is False
    assert not fake.calls_to("POST", f"{P}/annotation-mode-changes")
    await call(mcp_client, "change_annotation_mode", args | {"confirm": True})
    [change] = fake.calls_to("POST", f"{P}/annotation-mode-changes")
    assert change.json()["expected_revision"] == 5
    assert change.json()["expected_submission_ids"] == ["s1"]


async def test_a_restore_uses_the_texts_plan_revision(
    fake: FakeApi, mcp_client: Client
) -> None:
    changes = [
        build("ModeChangeView", change_id=1, restorable=False, restore_blocked="X"),
        build("ModeChangeView", change_id=2, restorable=True),
    ]
    fake.on(
        "GET",
        f"{P}/annotation-mode-changes",
        build("ModeChangeList", case_id="c", language="en", changes=changes),
    )
    fake.on(
        "POST", f"{P}/work-plans/bulk/preview", build("BulkPreview", revisions={"c": 9})
    )
    args = {"project": "p", "case_id": "c", "language": "en", "change_id": 1}
    dry = await call(mcp_client, "restore_annotation_mode", args)
    assert dry["applied"] is False and dry["change"]["restore_blocked"] == "X"
    with pytest.raises(ToolFailed, match="cannot be restored"):
        await call(mcp_client, "restore_annotation_mode", args | {"confirm": True})
    assert _writes(fake) == []
    args["change_id"] = 2
    await call(mcp_client, "restore_annotation_mode", args | {"confirm": True})
    restore = f"{P}/annotation-mode-changes/{{change_id}}/restore"
    [restored] = fake.calls_to("POST", restore)
    assert restored.json() == {"expected_revision": 9}


def _final(submission_id: str, revision: int) -> dict[str, Any]:
    return build(
        "FinalSelectionSummary",
        case_id="c",
        language="en",
        document_id="c-en-v1",
        submission_id=submission_id,
        revision=revision,
    )


async def test_set_final_result_replaces_or_confirms_with_the_revision(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", f"{P}/document-rows", page([row("c", final=_final("s1", 3))]))
    cause = build("RowItemView", code="SELECTED_TEXT_CORRECTED", cause_id="k1")
    body = panel(
        [submission("s1", "c-en-v1"), submission("s2", "c-en-v1")], all_match=False
    )
    fake.on("GET", PANEL, body | {"causes": [cause]})
    args = {"project": "p", "case_id": "c", "language": "en", "submission_id": "s2"}
    dry = await call(mcp_client, "set_final_result", args)
    assert dry["applied"] is False
    assert dry["plan"]["replaces_final"] is True
    assert dry["plan"]["acknowledges"] == []
    assert _writes(fake) == []
    await call(mcp_client, "set_final_result", args | {"confirm": True})
    [replaced] = fake.calls_to("PUT", f"{P}/final-selections")
    assert replaced.json() == {
        "document_id": "c-en-v1",
        "submission_id": "s2",
        "expected_revision": 3,
        "acknowledged_cause_ids": [],
    }
    fake.calls.clear()
    args["submission_id"] = "s1"
    await call(mcp_client, "set_final_result", args | {"confirm": True})
    [confirmed] = fake.calls_to("PUT", f"{P}/final-selections")
    assert confirmed.json()["acknowledged_cause_ids"] == ["k1"]
    with pytest.raises(ToolFailed, match="is not a submission"):
        await call(mcp_client, "set_final_result", args | {"submission_id": "zz"})


async def test_undo_and_discard_return_the_work_they_would_withdraw(
    fake: FakeApi, mcp_client: Client
) -> None:
    consequences = {"withdrawn": [{"assignment_id": 8}]}
    fake.on(
        "PUT",
        f"{P}/work-plans/rows",
        refusal(409, "WORK_PLAN_CONFIRMATION_REQUIRED", consequences),
    )
    undo = {
        "rows": [{"case_id": "c", "language": "en", "review": False, "annotate": True}],
        "revisions": {"c": 4},
    }
    args: dict[str, Any] = {"project": "p", "undo": undo}
    dry = await call(mcp_client, "undo_work_plan", args)
    assert dry["applied"] is False and dry["plan"]["row_count"] == 1
    assert _writes(fake) == []
    refused = await call(mcp_client, "undo_work_plan", args | {"confirm": True})
    assert refused["applied"] is False
    assert refused["consequences"] == consequences
    [sent] = fake.calls_to("PUT", f"{P}/work-plans/rows")
    assert sent.json() == {
        "rows": undo["rows"],
        "expected_revisions": {"c": 4},
        "undo": True,
        "confirm": False,
    }
    with pytest.raises(ToolFailed, match="'undo' object"):
        await call(mcp_client, "undo_work_plan", {"project": "p", "undo": {}})

    discard = f"{P}/variants/{{document_id}}/discard"
    args = {"project": "p", "document_id": "d", "reason": "Wrong source"}
    dry = await call(mcp_client, "discard_translation", args)
    assert dry["applied"] is False
    assert not fake.calls_to("POST", discard)
    await call(
        mcp_client,
        "discard_translation",
        args | {"confirm": True, "withdraw_tasks": True},
    )
    [discarded] = fake.calls_to("POST", discard)
    assert discarded.json() == {"reason": "Wrong source", "confirm": True}


async def test_text_changes_send_the_tasks_revision(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", f"{P}/assignments", [_task()])
    preview = build("TextChangePreview", findings=4, placed=3, unplaced=1)
    fake.on("POST", f"{P}/text-changes/preview", preview)
    args = {"project": "p", "assignment_id": 3, "target_document_id": "d2"}
    dry = await call(mcp_client, "move_task_to_version", args)
    assert dry["plan"]["preview"]["placed"] == 3
    assert _writes(fake) == [("POST", f"{P}/text-changes/preview")]
    await call(mcp_client, "move_task_to_version", args | {"confirm": True})
    [moved] = fake.calls_to("POST", f"{TASK}/move-to-version")
    assert moved.json()["expected_workflow_revision"] == 7
    assert moved.json()["target_document_id"] == "d2"

    resolution = args | {"resolution": "finish_then_carry", "confirm": True}
    await call(mcp_client, "handle_text_change", resolution)
    [decided] = fake.calls_to("POST", f"{TASK}/text-change-resolution")
    assert decided.json() == {
        "resolution": "finish_then_carry",
        "target_document_id": "d2",
        "expected_workflow_revision": 7,
    }
    with pytest.raises(ToolFailed, match="no current task 4"):
        await call(mcp_client, "move_task_to_version", args | {"assignment_id": 4})

    carry = f"{P}/submissions/{{submission_id}}/carry"
    args = {"project": "p", "submission_id": "s1", "target_document_id": "d2"}
    await call(mcp_client, "carry_submission", args)
    assert not fake.calls_to("POST", carry)
    await call(
        mcp_client,
        "carry_submission",
        args | {"mode": "other", "username": "bob", "confirm": True},
    )
    [carried] = fake.calls_to("POST", carry)
    assert carried.json()["mode"] == "other"
    assert carried.json()["username"] == "bob"


async def test_a_problem_report_action_sends_the_reports_revision(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", REPORT, build("ProblemReportView", report_id="r1", revision=2))
    args: dict[str, Any] = {"report_id": "r1", "action": "restart", "reason": "Empty"}
    dry = await call(mcp_client, "act_on_problem_report", args)
    assert dry["applied"] is False and dry["plan"]["report"]["revision"] == 2
    assert _writes(fake) == []
    await call(mcp_client, "act_on_problem_report", args | {"confirm": True})
    [acted] = fake.calls_to("POST", f"{REPORT}/actions")
    assert acted.json()["expected_revision"] == 2
    assert acted.json()["action"] == "restart"
    with pytest.raises(ToolFailed, match="extend_hold needs"):
        await call(
            mcp_client,
            "act_on_problem_report",
            {"report_id": "r1", "action": "extend_hold", "reason": "x"},
        )


async def test_translation_tools_send_the_versions_text_hash(
    fake: FakeApi, mcp_client: Client
) -> None:
    variant = build("VariantSummary", document_id="d", text_sha256="a" * 64)
    fake.on("GET", f"{P}/documents/{{doc}}/variant", variant)
    await call(
        mcp_client,
        "request_translation_correction",
        {"project": "p", "document_id": "d", "username": "u", "reason": "Dose"},
    )
    [asked] = fake.calls_to(
        "POST", f"{P}/documents/{{doc}}/translation-correction-assignment"
    )
    assert asked.json()["expected_text_sha256"] == "a" * 64
    await call(
        mcp_client, "start_lead_correction", {"project": "p", "document_id": "d"}
    )
    [lead] = fake.calls_to("POST", f"{P}/documents/{{doc}}/lead-correction")
    assert lead.json() == {"expected_text_sha256": "a" * 64, "confirm_language": False}


async def test_assign_texts_asks_for_a_review_of_an_accepted_translation(
    fake: FakeApi, mcp_client: Client
) -> None:
    await call(
        mcp_client,
        "assign_texts",
        {
            "project": "p",
            "assignments": [{"document_id": "d", "username": "u"}],
            "task": "review_accepted_translation",
        },
    )
    [sent] = fake.calls_to("POST", f"{P}/assignments")
    assert sent.json()["task"] == "translation_review"
    assert sent.json()["review_accepted_translation"] is True


async def test_tool_texts_state_the_selection_limit(mcp_client: Client) -> None:
    tools = {tool.name: tool for tool in (await mcp_client.list_tools()).tools}
    for name in ("update_work_plan", "distribute_texts"):
        assert "at most 2000" in (tools[name].description or ""), name
