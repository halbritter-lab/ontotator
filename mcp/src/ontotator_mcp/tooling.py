"""Registering tools with their token scope and effect stated the same way.

Every tool names, in its description, the API token scope it needs and
whether it changes data in Ontotator. The same facts set the MCP tool
annotations (``readOnlyHint``, ``destructiveHint``, ``idempotentHint``) and
fill ``TOOL_SCOPES``, which the README's scope table and the tests use.
"""

from __future__ import annotations

import inspect
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal, TypeVar

from mcp.server.mcpserver import MCPServer
from mcp.types import ToolAnnotations

Scope = Literal["read", "import", "export", "project-admin", "admin"]
Effect = Literal["read", "additive", "changes", "destructive", "local"]
F = TypeVar("F", bound=Callable[..., Any])

EFFECT_TEXT: dict[Effect, str] = {
    "read": "Read only: changes nothing.",
    "additive": "CHANGES DATA in Ontotator: adds records; removes nothing.",
    "changes": "CHANGES DATA in Ontotator: overwrites the current values.",
    "destructive": (
        "CHANGES DATA in Ontotator and may remove or withdraw existing work;"
        " read the dry run first."
    ),
    "local": "Changes nothing in Ontotator; writes a file on this computer.",
}


@dataclass(frozen=True)
class ToolInfo:
    name: str
    scopes: tuple[Scope, ...]
    effect: Effect
    summary: str


TOOL_SCOPES: dict[str, ToolInfo] = {}


def scope_text(scopes: tuple[Scope, ...]) -> str:
    names = " + ".join(f"'{scope}'" for scope in scopes)
    return f"Token scope: {names}."


def register(
    server: MCPServer,
    *,
    scopes: Scope | tuple[Scope, ...],
    effect: Effect,
    idempotent: bool = False,
    title: str | None = None,
) -> Callable[[F], F]:
    """``@register(server, scopes=..., effect=...)`` on an async tool function."""
    needed = (scopes,) if isinstance(scopes, str) else scopes

    def decorator(fn: F) -> F:
        doc = inspect.cleandoc(fn.__doc__ or "")
        summary = doc.split("\n\n", 1)[0].replace("\n", " ")
        description = f"{doc}\n\n{scope_text(needed)} {EFFECT_TEXT[effect]}"
        read_only = effect == "read"
        annotations = ToolAnnotations(
            title=title,
            read_only_hint=read_only,
            destructive_hint=None
            if read_only
            else effect in ("changes", "destructive"),
            idempotent_hint=True if read_only else idempotent,
            open_world_hint=False,
        )
        TOOL_SCOPES[fn.__name__] = ToolInfo(fn.__name__, needed, effect, summary)
        server.add_tool(
            fn, name=fn.__name__, description=description, annotations=annotations
        )
        return fn

    return decorator
