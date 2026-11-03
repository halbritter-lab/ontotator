"""The MCP server: curated tools over the Ontotator API, plus three resources."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from mcp.server.mcpserver import MCPServer

from ontotator_mcp import __version__
from ontotator_mcp.client import OntotatorClient
from ontotator_mcp.config import Settings
from ontotator_mcp.resources import register_resources
from ontotator_mcp.tools_results import register_results
from ontotator_mcp.tools_setup import register_setup
from ontotator_mcp.tools_status import register_status

INSTRUCTIONS = """\
Tools for one Ontotator instance (collaborative annotation of ontology terms
in clinical texts), acting as the owner of the configured API token.

Covers project setup (ontologies, projects, settings, guidelines, text and
machine-proposal imports, people, assignments, work plan), status (progress,
agreement) and results (consolidation start, accepting agreeing texts,
exports and downloads). Annotation, review and translation review work stay
in the web interface; no tool reads or writes them.

Every tool description names the token scope it needs and whether it
changes data. Tools with a 'confirm' argument do a dry run without it: show
the dry run to the user before calling again with confirm=true. Start with
whoami to check the connection. Long imports and exports are jobs: tools
wait for them by default; get_job polls one.
"""


def build_server(
    settings: Settings, *, transport: httpx.AsyncBaseTransport | None = None
) -> MCPServer:
    """The server for ``settings``; ``transport`` replaces the network in tests."""
    api = OntotatorClient(settings, transport=transport)

    @asynccontextmanager
    async def lifespan(_server: MCPServer) -> AsyncIterator[None]:
        try:
            yield None
        finally:
            await api.aclose()

    server = MCPServer(
        "ontotator",
        title="Ontotator",
        instructions=INSTRUCTIONS,
        version=__version__,
        lifespan=lifespan,
    )
    register_setup(server, api)
    register_status(server, api)
    register_results(server, api)
    register_resources(server, api)
    return server
