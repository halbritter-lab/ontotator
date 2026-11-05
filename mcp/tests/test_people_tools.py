"""Accounts for a cohort, handing work on, and repeatable final exports."""

from __future__ import annotations

import csv
import stat
from pathlib import Path
from typing import Any

import httpx
import pytest
from conftest import ToolFailed, call
from fake_api import FakeApi, refusal
from mcp import Client
from shapes import build

pytestmark = pytest.mark.anyio

P = "/api/v1/projects/{key}"
USERS = "/api/v1/admin/users/"
RESET = "/api/v1/admin/users/{username}/reset-code"
REASSIGN = "/api/v1/assignments/{assignment_id}/reassign"


def _account(username: str, **fields: Any) -> dict[str, Any]:
    return (
        build(
            "AdminUser", username=username, display_name=username.title(), active=True
        )
        | fields
    )


def _created(request: httpx.Request) -> Any:
    import json

    body = json.loads(request.content)
    if body["username"] == "broken":
        return refusal(422, "USERNAME_INVALID", "bad name")
    user = _account(
        body["username"],
        email=body.get("email"),
        projects=[
            build("UserProject", project_key=item["project_key"], roles=item["roles"])
            for item in body.get("projects", [])
        ],
    )
    return {
        "user": user,
        "code": f"CODE-{body['username']}",
        "expires_at": "2026-11-06T10:00:00Z",
    }


async def test_create_users_skips_existing_and_writes_codes_to_a_private_file(
    fake: FakeApi, mcp_client: Client, tmp_path: Path
) -> None:
    fake.on("GET", USERS, [_account("Ann")])
    fake.on("POST", USERS, _created)
    codes = tmp_path / "codes.csv"
    result = await call(
        mcp_client,
        "create_users",
        {
            "users": [
                {"username": "ann", "display_name": "Ann"},
                {"username": "bob", "display_name": "Bob", "email": "b@x.org"},
                {"username": "cy", "display_name": "Cy", "roles": ["adjudicator"]},
                {"username": "broken", "display_name": "B"},
            ],
            "project": "ward-7",
            "codes_path": str(codes),
        },
    )
    assert result["existing"] == ["ann"]
    assert [item["username"] for item in result["created"]] == ["bob", "cy"]
    assert [item["username"] for item in result["refused"]] == ["broken"]
    assert result["refused"][0]["code"] == "USERNAME_INVALID"
    # The codes are in the file only, readable by the user alone.
    assert result["codes_file"] == str(codes.resolve())
    assert "CODE-" not in str(result)
    assert stat.S_IMODE(codes.stat().st_mode) == 0o600
    with codes.open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    assert [(r["username"], r["code"], r["email"]) for r in rows] == [
        ("bob", "CODE-bob", "b@x.org"),
        ("cy", "CODE-cy", ""),
    ]
    sent = [call.json() for call in fake.calls_to("POST", USERS)]
    assert [body["projects"] for body in sent] == [
        [{"project_key": "ward-7", "roles": ["annotator"]}],
        [{"project_key": "ward-7", "roles": ["adjudicator"]}],
        [{"project_key": "ward-7", "roles": ["annotator"]}],
    ]
    # Repeating the call adds nobody twice, and keeps the file.
    fake.on("GET", USERS, [_account(name) for name in ("ann", "bob", "cy")])
    fake.calls.clear()
    again = await call(
        mcp_client,
        "create_users",
        {"users": [{"username": "bob", "display_name": "Bob"}]},
    )
    assert again["existing"] == ["bob"]
    assert again["codes"] == []
    assert not fake.calls_to("POST", USERS)


async def test_create_users_without_a_file_returns_the_codes_with_a_note(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", USERS, [])
    fake.on("POST", USERS, _created)
    result = await call(
        mcp_client,
        "create_users",
        {"users": [{"username": "dee", "display_name": "Dee"}]},
    )
    assert result["codes"][0]["code"] == "CODE-dee"
    assert "credentials" in result["note"]
    [post] = fake.calls_to("POST", USERS)
    assert "projects" not in post.json()


async def test_create_users_refuses_a_codes_file_outside_the_folders(
    fake: FakeApi, mcp_client: Client, tmp_path: Path
) -> None:
    fake.on("GET", USERS, [])
    with pytest.raises(ToolFailed) as refused:
        await call(
            mcp_client,
            "create_users",
            {
                "users": [{"username": "eve", "display_name": "Eve"}],
                "codes_path": str(tmp_path.parent / "elsewhere.csv"),
            },
        )
    assert "outside the folders" in str(refused.value)
    assert not fake.calls_to("POST", USERS)


async def test_issue_setup_codes_renews_only_pending_invitations(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on(
        "GET",
        USERS,
        [
            _account("pending", setup_pending=True),
            _account("working", setup_pending=False),
            _account("gone", active=False, setup_pending=True),
        ],
    )
    fake.on("POST", RESET, {"code": "NEW", "expires_at": "2026-11-06T10:00:00Z"})
    result = await call(
        mcp_client,
        "issue_setup_codes",
        {"usernames": ["pending", "working", "gone", "nobody"]},
    )
    assert [item["username"] for item in result["codes"]] == ["pending"]
    assert {item["username"]: item["reason"] for item in result["skipped"]} == {
        "working": "already set a password; pass include_active_accounts to reset it",
        "gone": "deactivated",
        "nobody": "no such user",
    }
    [post] = fake.calls_to("POST", RESET)
    assert post.request.url.path == "/api/v1/admin/users/pending/reset-code"
    fake.calls.clear()
    forced = await call(
        mcp_client,
        "issue_setup_codes",
        {"usernames": ["working"], "include_active_accounts": True},
    )
    assert [item["username"] for item in forced["codes"]] == ["working"]


async def test_update_user_sends_only_the_named_fields(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("PATCH", "/api/v1/admin/users/{username}", _account("ann", active=False))
    result = await call(mcp_client, "update_user", {"username": "ann", "active": False})
    assert result["active"] is False
    [patch] = fake.calls_to("PATCH", "/api/v1/admin/users/{username}")
    assert patch.json() == {"active": False}
    with pytest.raises(ToolFailed, match="at least one field"):
        await call(mcp_client, "update_user", {"username": "ann"})


def _task(id: int, status: str = "open", **extra: Any) -> dict[str, Any]:
    return (
        build(
            "AssignmentView",
            id=id,
            username="leaving",
            document_id=f"d{id}",
            task="annotate",
            status=status,
            revoked_at=None,
            lead_correction=False,
        )
        | extra
    )


def _moved(request: httpx.Request) -> Any:
    import json

    old = int(request.url.path.split("/")[-2])
    body = json.loads(request.content)
    if old == 4:
        return refusal(409, "ASSIGNMENT_EXISTS", None)
    return _task(100 + old, username=body["username"])


async def test_hand_over_open_tasks_plans_then_reassigns_in_turn(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on(
        "GET",
        f"{P}/assignments",
        [
            _task(1),
            _task(2, "in_progress"),
            _task(3),
            _task(4),
            _task(5, "submitted"),
            _task(6, revoked_at="2026-11-01T10:00:00Z"),
            _task(7, task="review"),
            _task(8, task="translation_review", lead_correction=True),
        ],
    )
    fake.on("POST", REASSIGN, _moved)
    args: dict[str, Any] = {
        "project": "ward-7",
        "from_username": "leaving",
        "to_usernames": ["ann", "bob"],
    }
    dry = await call(mcp_client, "hand_over_open_tasks", args)
    assert dry["applied"] is False
    plan = dry["plan"]
    assert [(m["id"], m["to"]) for m in plan["moves"]] == [
        (1, "ann"),
        (3, "bob"),
        (4, "ann"),
    ]
    assert {k["id"] for k in plan["kept"]} == {2, 7, 8}
    assert not fake.calls_to("POST", REASSIGN)
    [listed] = fake.calls_to("GET", f"{P}/assignments")
    assert listed.request.url.params["username"] == "leaving"

    done = await call(mcp_client, "hand_over_open_tasks", args | {"confirm": True})
    assert done["applied"] is True
    assert [(r["assignment_id"], r["to"]) for r in done["reassigned"]] == [
        (1, "ann"),
        (3, "bob"),
    ]
    assert [(r["assignment_id"], r["code"]) for r in done["refused"]] == [
        (4, "ASSIGNMENT_EXISTS")
    ]
    bodies = [c.json() for c in fake.calls_to("POST", REASSIGN)]
    assert all(body["confirm_started"] is False for body in bodies)

    fake.calls.clear()
    started = await call(
        mcp_client,
        "hand_over_open_tasks",
        args | {"include_started": True},
    )
    assert 2 in [m["id"] for m in started["plan"]["moves"]]


async def test_hand_over_refuses_the_leaving_person_as_successor(
    mcp_client: Client,
) -> None:
    with pytest.raises(ToolFailed, match="cannot take their own tasks"):
        await call(
            mcp_client,
            "hand_over_open_tasks",
            {"project": "p", "from_username": "a", "to_usernames": ["a"]},
        )


async def test_single_task_tools_call_their_routes(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("POST", REASSIGN, _task(9, username="bob"))
    moved = await call(
        mcp_client,
        "reassign_task",
        {"assignment_id": 1, "username": "bob", "confirm_started": True},
    )
    assert moved["username"] == "bob"
    [post] = fake.calls_to("POST", REASSIGN)
    assert post.json() == {
        "username": "bob",
        "confirm_started": True,
        "confirm_language": False,
        "confirm_unreviewed_translation": False,
    }
    await call(mcp_client, "withdraw_task", {"assignment_id": 1, "reason": "left"})
    [revoke] = fake.calls_to("POST", "/api/v1/assignments/{assignment_id}/revoke")
    assert revoke.json() == {"reason": "left"}
    await call(mcp_client, "remove_task", {"assignment_id": 1})
    assert fake.calls_to("POST", "/api/v1/assignments/{assignment_id}/remove")
    await call(mcp_client, "reopen_task", {"assignment_id": 1})
    assert fake.calls_to("POST", "/api/v1/assignments/{assignment_id}/reopen")


async def test_list_assignments_filters_by_state(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", f"{P}/assignments", [_task(1), _task(2, "submitted"), _task(3)])
    result = await call(
        mcp_client,
        "list_assignments",
        {"project": "p", "status": ["open"], "limit": 1},
    )
    assert [item["id"] for item in result["assignments"]] == [1]
    assert result["count"] == 2
    assert result["truncated"] is True


async def test_a_final_export_with_a_request_id_can_be_repeated(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on(
        "POST",
        f"{P}/exports/final/preflight",
        build("FinalPreflight", warnings=[], omissions=[], state_digest="c" * 64),
    )
    fake.on("POST", f"{P}/exports/final", {"job_id": 5})
    args = {"project": "p", "kind": "final", "request_id": "nightly-2026-11-05"}
    await call(mcp_client, "start_export", args)
    await call(mcp_client, "start_export", args)
    sent = [c.json()["request_id"] for c in fake.calls_to("POST", f"{P}/exports/final")]
    assert sent == ["nightly-2026-11-05", "nightly-2026-11-05"]
    with pytest.raises(ToolFailed, match="final export only"):
        await call(
            mcp_client,
            "start_export",
            {"project": "p", "kind": "edit_log", "request_id": "x"},
        )
