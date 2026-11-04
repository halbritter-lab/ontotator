"""Each tool states exactly the token scopes of the routes it calls.

Every tool runs once against the fake API; the scopes of the contract
routes it called (``x-ontotator-scope``) must equal the scopes its
description names. No tool may call a browser-only route.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

import httpx
import pytest
from conftest import call
from contract import scope, spec
from fake_api import FakeApi
from mcp import Client
from shapes import build, page, panel, row, submission, work

from ontotator_mcp.config import Settings
from ontotator_mcp.server import build_server
from ontotator_mcp.tooling import TOOL_SCOPES, scope_text

P = "/api/v1/projects/{key}"
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
        "export_project_archive": {"project": "p"},
        "download_project_archive": {"job_id": 2, "path": str(folder / "a.zip")},
        "import_project_archive": {"path": str(file)},
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
    fake.on(
        "GET",
        "/api/v1/admin/project-archives/jobs/{job_id}",
        build(
            "ArchiveJobView",
            id=2,
            kind="project_archive_export",
            status="succeeded",
            result={"sha256": hashlib.sha256(b"data").hexdigest()},
        ),
    )
    fake.on("GET", "/api/v1/admin/project-archives/jobs/{job_id}/download", b"data")


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
            if used != set(TOOL_SCOPES[name].scopes):
                wrong[name] = sorted(used)
            assert scope_text(TOOL_SCOPES[name].scopes) in (
                listed[name].description or ""
            )
        assert wrong == {}, wrong


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
        assert f"| `{info.name}` | {', '.join(info.scopes)} |" in readme, info.name
