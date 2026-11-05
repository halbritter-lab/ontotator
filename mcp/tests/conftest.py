from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from fake_api import TOKEN, FakeApi
from mcp import Client

from ontotator_mcp.config import Settings
from ontotator_mcp.server import build_server

URL = "https://ontotator.test"


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
def fake() -> FakeApi:
    return FakeApi()


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    # The test's own folder is the one ONTOTATOR_MCP_FILES_DIR allows.
    return Settings(
        url=URL,
        token=TOKEN,
        poll_interval=0.001,
        job_timeout=5,
        files_dirs=(tmp_path.resolve(),),
    )


@pytest.fixture
async def mcp_client(fake: FakeApi, settings: Settings) -> AsyncIterator[Client]:
    server = build_server(settings, transport=httpx.MockTransport(fake))
    async with Client(server) as client:
        yield client


class ToolFailed(Exception):
    pass


async def call(client: Client, name: str, arguments: dict[str, Any]) -> Any:
    """The structured result of a tool, or ``ToolFailed`` with its message."""
    result = await client.call_tool(name, arguments)
    text = "".join(getattr(part, "text", "") for part in result.content)
    if result.is_error:
        raise ToolFailed(text)
    content = result.structured_content
    if isinstance(content, dict) and set(content) == {"result"}:
        return content["result"]
    return content
