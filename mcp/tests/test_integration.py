"""End to end against the real Ontotator app (``tests/live_server.py``).

Needs ``ONTOTATOR_TEST_PG_URL`` (a throwaway PostgreSQL superuser URL) and
``uv``; the app runs in the main project's environment as a subprocess, so
the MCP package never imports Ontotator. Skipped otherwise.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from conftest import ToolFailed, call
from mcp import Client

from ontotator_mcp.config import Settings
from ontotator_mcp.server import build_server

REPO = Path(__file__).resolve().parents[2]
FIXTURES = REPO / "tests" / "fixtures"
PROJECT = "mcp-smoke"
START_TIMEOUT = 600.0

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not os.environ.get("ONTOTATOR_TEST_PG_URL") or shutil.which("uv") is None,
        reason="needs ONTOTATOR_TEST_PG_URL and uv",
    ),
]


def _first_line(process: subprocess.Popen[str], timeout: float) -> str:
    found: list[str] = []
    reader = threading.Thread(
        target=lambda: found.append(
            process.stdout.readline() if process.stdout else ""
        ),
        daemon=True,
    )
    reader.start()
    reader.join(timeout)
    if not found or not found[0]:
        raise RuntimeError("The Ontotator test server did not start.")
    return found[0]


@pytest.fixture(scope="module")
def live() -> Iterator[dict[str, str]]:
    env = {
        **os.environ,
        # A worker name of our own: the harness creates and drops only
        # databases named after it, never another run's.
        "PYTEST_XDIST_WORKER": f"mcp{os.getpid()}",
    }
    env.pop("VIRTUAL_ENV", None)
    process = subprocess.Popen(
        [
            "uv",
            "run",
            "--project",
            str(REPO),
            "--locked",
            "python",
            str(Path(__file__).with_name("live_server.py")),
        ],
        cwd=REPO,
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        info: dict[str, str] = json.loads(_first_line(process, START_TIMEOUT))
        deadline = time.monotonic() + 60
        while True:
            try:
                httpx.get(f"{info['url']}/api/v1/about", timeout=2)
                break
            except httpx.TransportError:
                if time.monotonic() > deadline:
                    raise
                time.sleep(0.2)
        yield info
    finally:
        # Closing stdin stops the server, which then drops its databases.
        if process.stdin:
            process.stdin.close()
        try:
            process.wait(timeout=60)
        except subprocess.TimeoutExpired:
            process.terminate()
            process.wait(timeout=30)


def _server(info: dict[str, str], token: str) -> Any:
    settings = Settings(url=info["url"], token=token, poll_interval=0.2)
    return build_server(settings)


@pytest.mark.anyio
async def test_setup_import_status_and_export(
    live: dict[str, str], tmp_path: Path
) -> None:
    async with Client(_server(live, live["admin_token"])) as client:
        me = await call(client, "whoami", {})
        assert me["user"]["username"] == "root"

        [uploaded] = await call(
            client, "upload_ontology_files", {"paths": [str(FIXTURES / "hp.json")]}
        )
        sha = uploaded["ontology"]["sha256"]
        assert uploaded["status"] == "added"

        created = await call(
            client,
            "create_project",
            {
                "key": PROJECT,
                "name": "MCP smoke",
                "languages": ["en"],
                "pins": [{"ontology_id": "hp", "sha256": sha}],
                "profile_path": str(FIXTURES / "smoke-profile.json"),
            },
        )
        assert created["name"] == "MCP smoke"
        assert PROJECT in {
            p["project_key"] for p in await call(client, "list_projects", {})
        }

        check = await call(
            client,
            "upload_texts",
            {
                "project": PROJECT,
                "paths": [str(FIXTURES / "smoke-bundle.zip")],
                "format": "ontospan",
            },
        )
        assert check["committable"], check
        committed = await call(
            client,
            "commit_upload",
            {"project": PROJECT, "upload_id": check["upload_id"]},
        )
        assert committed["job"]["status"] == "succeeded", committed

        texts = await call(client, "list_texts", {"project": PROJECT})
        assert sorted(t["case_id"] for t in texts["texts"]) == [
            "smoke-001",
            "smoke-002",
        ]

        await call(
            client,
            "set_member_roles",
            {"project": PROJECT, "username": "ann1", "roles": ["annotator"]},
        )
        people = await call(client, "list_people", {"project": PROJECT})
        assert "ann1" in {p["username"] for p in people}

        overview = await call(client, "project_overview", {"project": PROJECT})
        assert overview["name"] == "MCP smoke"

        # Submissions come only from annotators in the browser.
        with pytest.raises(ToolFailed, match="EXPORT_EMPTY"):
            await call(
                client, "start_export", {"project": PROJECT, "kind": "annotations"}
            )

        for kind in ("edit_log", "translation_reviews"):
            job = await call(client, "start_export", {"project": PROJECT, "kind": kind})
            assert job["status"] == "succeeded", job
            target = tmp_path / f"{kind}.jsonl"
            downloaded = await call(
                client, "download_export", {"job_id": job["id"], "path": str(target)}
            )
            assert downloaded["bytes"] == target.stat().st_size
            assert downloaded["kind"] == kind

        check = await call(client, "final_export_check", {"project": PROJECT})
        assert check["final_results"] == 0
        with pytest.raises(ToolFailed, match="EXPORT_EMPTY"):
            await call(
                client,
                "start_export",
                {
                    "project": PROJECT,
                    "kind": "final",
                    "acknowledge_warnings": True,
                    "accept_omissions": True,
                },
            )

        settings = await client.read_resource(
            f"ontotator://projects/{PROJECT}/settings"
        )
        assert '"MCP smoke"' in settings.contents[0].text

    async with Client(_server(live, live["read_token"])) as reader:
        assert await call(reader, "get_project_settings", {"project": PROJECT})
        with pytest.raises(ToolFailed, match="TOKEN_SCOPE_MISSING") as refused:
            await call(reader, "start_export", {"project": PROJECT, "kind": "edit_log"})
        assert "'export' scope" in str(refused.value)
        assert live["read_token"] not in str(refused.value)
