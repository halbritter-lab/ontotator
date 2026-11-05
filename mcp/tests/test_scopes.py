"""Each tool states exactly the token scopes of the routes it calls.

Every tool runs once against the fake API; the scopes of the contract
routes it called (``x-ontotator-scope``) must equal the scopes its
description names. No tool may call a browser-only route.
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path
from typing import Any

import httpx
import pytest
from conftest import call
from contract import scope, spec
from fake_api import FakeApi, token_view
from mcp import Client
from shapes import build, page, panel, row, submission, work

from ontotator_mcp.config import Settings
from ontotator_mcp.resources import (
    GUIDELINE_URI,
    README_URI,
    RESOURCE_SCOPES,
    SETTINGS_URI,
)
from ontotator_mcp.server import build_server
from ontotator_mcp.tooling import TOOL_SCOPES, scope_text

P = "/api/v1/projects/{key}"


def declared_exactly(
    used: set[str | frozenset[str]],
    scopes: tuple[str, ...],
    any_of: tuple[str, ...] = (),
) -> bool:
    """Whether the declaration is what the routes called need, no more, no less.

    A route with one scope needs it; a route open to any of several
    (``frozenset``) is covered by a declared scope among them, or else must
    be the tool's own ``any_of``.
    """
    single = {item for item in used if isinstance(item, str)}
    either = [item for item in used if isinstance(item, frozenset)]
    if single != set(scopes):
        return False
    uncovered = [item for item in either if not item & set(scopes)]
    if any_of:
        return not scopes and uncovered == [frozenset(any_of)]
    return not uncovered


PIN = {"ontology_id": "HP", "sha256": "a" * 64}


def _arguments(folder: Path) -> dict[str, dict[str, Any]]:
    file = folder / "input.zip"
    file.write_bytes(b"data")
    profile = folder / "profile.json"
    profile.write_text('{"schema": "ontotator-task-profile/v1"}')
    return {
        "whoami": {},
        "list_projects": {},
        "list_ontologies": {},
        "list_ontology_files": {},
        "upload_ontology_files": {"paths": [str(file)]},
        "list_project_templates": {},
        "create_project": {"key": "p", "name": "P", "pins": [PIN], "template": "t"},
        "get_project_settings": {"project": "p"},
        "update_project_settings": {"project": "p", "changes": {"name": "Q"}},
        "set_task_profile": {"project": "p", "profile_path": str(profile)},
        "set_ontology_pins": {"project": "p", "pins": [PIN], "confirm": True},
        "refresh_translations": {"project": "p"},
        "publish_guideline": {"project": "p", "path": str(file)},
        "upload_texts": {"project": "p", "paths": [str(file)], "format": "ontospan"},
        "get_upload": {"project": "p", "upload_id": 1},
        "list_uploads": {"project": "p"},
        "commit_upload": {"project": "p", "upload_id": 1},
        "discard_upload": {"project": "p", "upload_id": 1},
        "list_people": {"project": "p"},
        "list_users": {},
        "set_member_roles": {"project": "p", "username": "u", "roles": ["annotator"]},
        "assign_texts": {
            "project": "p",
            "assignments": [{"document_id": "d", "username": "u"}],
        },
        "distribute_texts": {
            "project": "p",
            "language": "en",
            "usernames": ["u"],
            "mode": "each",
            "confirm": True,
        },
        "update_work_plan": {
            "project": "p",
            "language": "en",
            "annotate": "on",
            "confirm": True,
        },
        "project_overview": {"project": "p"},
        "get_progress": {"project": "p"},
        "list_texts": {"project": "p"},
        "working_time_summary": {"project": "p"},
        "agreement_summary": {"project": "p"},
        "start_consolidation": {
            "project": "p",
            "case_id": "c",
            "language": "en",
            "reviewer": "r",
        },
        "accept_agreeing_texts": {"project": "p", "confirm": True},
        "final_export_check": {"project": "p"},
        "start_export": {"project": "p", "kind": "final"},
        "get_job": {"job_id": 1, "wait": True},
        "download_export": {"job_id": 1, "path": str(folder / "out.zip")},
        "create_users": {
            "users": [{"username": "new", "display_name": "New"}],
            "project": "p",
            "codes_path": str(folder / "codes.csv"),
        },
        "issue_setup_codes": {"usernames": ["old"], "include_active_accounts": True},
        "update_user": {"username": "old", "active": False},
        "find_people": {"project": "p", "query": "ann"},
        "list_assignments": {"project": "p"},
        "reassign_task": {"assignment_id": 3, "username": "u"},
        "withdraw_task": {"assignment_id": 3},
        "remove_task": {"assignment_id": 3},
        "reopen_task": {"assignment_id": 3},
        "hand_over_open_tasks": {
            "project": "p",
            "from_username": "leaving",
            "to_usernames": ["u"],
            "confirm": True,
        },
        "list_problem_reports": {"project": "p"},
        "withdraw_guideline": {"project": "p", "version": 2},
    }


def _flows(fake: FakeApi) -> None:
    """Answers that let every tool reach every route it can call."""
    fake.on(
        "GET",
        f"{P}/uploads/{{upload_id}}",
        build("UploadView", id=1, status="ready", plan_sha256="b" * 64),
    )
    fake.on(
        "GET",
        f"{P}/document-rows/case-ids",
        {"case_ids": ["c"], "total": 1, "truncated": False},
    )
    both = [work("submitted", "a"), work("submitted", "b")]
    fake.on("GET", f"{P}/document-rows", page([row("c", work=both)]))
    fake.on(
        "GET",
        "/api/v1/projects/{key}/document-rows/{case_id}/{language}/final-panel",
        panel(
            [submission("s1", "c-en-v1"), submission("s2", "c-en-v1")], all_match=True
        ),
    )
    fake.on("POST", f"{P}/exports/final", {"job_id": 1})
    fake.on("GET", "/api/v1/jobs/{job_id}/download", b"data")
    # whoami reads the user only with the read scope; any scope reads the token.
    fake.on("GET", "/api/v1/me/token", token_view(scopes=["export"]))
    fake.on("GET", "/api/v1/admin/users/", [build("AdminUser", username="old")])
    fake.on(
        "GET",
        f"{P}/assignments",
        [
            build(
                "AssignmentView",
                id=3,
                username="leaving",
                task="annotate",
                status="open",
                revoked_at=None,
                lead_correction=False,
            )
        ],
    )


@pytest.mark.anyio
async def test_every_tool_names_the_scopes_of_its_routes(
    fake: FakeApi, settings: Settings, tmp_path: Path
) -> None:
    _flows(fake)
    server = build_server(settings, transport=httpx.MockTransport(fake))
    arguments = _arguments(tmp_path)
    async with Client(server) as client:
        listed = {tool.name: tool for tool in (await client.list_tools()).tools}
        assert set(listed) == set(arguments) == set(TOOL_SCOPES)
        wrong = {}
        for name, args in arguments.items():
            fake.calls.clear()
            await call(client, name, args)
            used = {scope(method, template) for method, template in fake.templates()}
            info = TOOL_SCOPES[name]
            if not declared_exactly(used, info.scopes, info.any_of):
                wrong[name] = sorted(map(str, used))
            assert scope_text(info.scopes, info.any_of) in (
                listed[name].description or ""
            )
        assert wrong == {}, wrong


RESOURCE_URIS = {
    SETTINGS_URI: "ontotator://projects/p/settings",
    GUIDELINE_URI: "ontotator://projects/p/guideline",
    README_URI: "ontotator://jobs/1/readme",
}


@pytest.mark.anyio
async def test_every_resource_names_the_scopes_of_its_routes(
    fake: FakeApi, settings: Settings
) -> None:
    current = build("GuidelineSummary", version=1)
    fake.on(
        "GET",
        f"{P}/guidelines",
        build(
            "GuidelineListing", current=current, latest_version=1, versions=[current]
        ),
    )
    fake.on("GET", f"{P}/guidelines/{{version}}", build("GuidelineDocument", body="x"))
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr("README.txt", "readme")
    fake.on("GET", "/api/v1/jobs/{job_id}/download", archive.getvalue())
    server = build_server(settings, transport=httpx.MockTransport(fake))
    async with Client(server) as client:
        templates = {
            t.uri_template: t
            for t in (await client.list_resource_templates()).resource_templates
        }
        assert set(templates) == set(RESOURCE_SCOPES) == set(RESOURCE_URIS)
        wrong = {}
        for template, uri in RESOURCE_URIS.items():
            fake.calls.clear()
            await client.read_resource(uri)
            used = {scope(method, path) for method, path in fake.templates()}
            if not declared_exactly(used, RESOURCE_SCOPES[template]):
                wrong[template] = sorted(map(str, used))
            description = templates[template].description or ""
            assert scope_text(RESOURCE_SCOPES[template]) in description, template
        assert wrong == {}, wrong


def test_the_readme_lists_every_resource_with_its_scopes() -> None:
    readme = (Path(__file__).resolve().parents[1] / "README.md").read_text()
    rows = {
        line.split(" | ")[0].removeprefix("| `").rstrip("`"): line
        for line in readme.splitlines()
        if line.startswith("| `ontotator://")
    }
    for uri, scopes in RESOURCE_SCOPES.items():
        assert rows[uri].endswith(f"| {', '.join(scopes)} |"), uri


@pytest.mark.anyio
async def test_annotations_match_what_a_tool_does(mcp_client: Client) -> None:
    for tool in (await mcp_client.list_tools()).tools:
        info = TOOL_SCOPES[tool.name]
        hints = tool.annotations
        assert hints is not None
        assert hints.read_only_hint is (info.effect == "read"), tool.name
        if info.effect in ("changes", "destructive"):
            assert hints.destructive_hint is True, tool.name
            assert "CHANGES DATA" in (tool.description or ""), tool.name
        if info.effect == "additive":
            assert hints.destructive_hint is False, tool.name
            assert "CHANGES DATA" in (tool.description or ""), tool.name
        if info.effect == "read":
            assert "Read only" in (tool.description or ""), tool.name
        if info.effect == "local":
            assert hints.destructive_hint is True, tool.name
            assert "WRITES A FILE ON THIS COMPUTER" in (tool.description or "")


@pytest.mark.anyio
async def test_tools_that_create_something_new_each_call_are_not_idempotent(
    mcp_client: Client,
) -> None:
    hints = {
        tool.name: tool.annotations
        for tool in (await mcp_client.list_tools()).tools
        if tool.annotations is not None
    }
    for name in ("upload_texts", "start_export", "download_export", "commit_upload"):
        assert hints[name].idempotent_hint is False, name


def test_tools_never_reach_annotation_work_routes() -> None:
    """Drafts, submissions and review content are browser-only in the contract."""
    for template, operations in spec()["paths"].items():
        if template.startswith(
            ("/api/v1/workspaces", "/api/v1/rounds/{round_id}/open")
        ):
            for operation in operations.values():
                assert operation["x-ontotator-scope"] == "session", template


def test_the_readme_lists_every_tool_with_its_scopes() -> None:
    readme = (Path(__file__).resolve().parents[1] / "README.md").read_text()
    build_server(Settings(url="https://o.test", token="t"))
    for info in TOOL_SCOPES.values():
        assert f"| `{info.name}` | {info.label} |" in readme, info.name
