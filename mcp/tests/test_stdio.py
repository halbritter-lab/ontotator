"""The console script speaks MCP over stdio and refuses an incomplete setup."""

from __future__ import annotations

import os
import subprocess
import sys

import pytest
from fake_api import TOKEN
from mcp import Client, StdioServerParameters


@pytest.mark.anyio
async def test_the_server_lists_its_tools_over_stdio() -> None:
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "ontotator_mcp"],
        env={
            **os.environ,
            "ONTOTATOR_URL": "http://127.0.0.1:9",
            "ONTOTATOR_TOKEN": TOKEN,
        },
    )
    async with Client(params) as client:
        tools = (await client.list_tools()).tools
    assert {"whoami", "upload_texts", "start_export"} <= {t.name for t in tools}


def test_a_missing_token_stops_the_server_with_a_message() -> None:
    env = {k: v for k, v in os.environ.items() if not k.startswith("ONTOTATOR_")}
    env["ONTOTATOR_URL"] = "https://ontotator.example.org"
    done = subprocess.run(
        [sys.executable, "-m", "ontotator_mcp"],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert done.returncode == 2
    assert "ONTOTATOR_TOKEN" in done.stderr
    assert done.stdout == ""


@pytest.mark.parametrize(
    ("flag", "expected"), [("--help", "ONTOTATOR_TOKEN"), ("--version", "0.")]
)
def test_help_and_version_answer_without_starting(flag: str, expected: str) -> None:
    env = {k: v for k, v in os.environ.items() if not k.startswith("ONTOTATOR_")}
    done = subprocess.run(
        [sys.executable, "-m", "ontotator_mcp", flag],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
        stdin=subprocess.DEVNULL,
    )
    assert done.returncode == 0
    assert expected in done.stdout
