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
    "local": (
        "Changes nothing in Ontotator; WRITES A FILE ON THIS COMPUTER and, with"
        " overwrite, replaces an existing one."
    ),
}


@dataclass(frozen=True)
class ToolInfo:
    name: str
    # Every one of ``scopes`` is needed; of ``any_of``, one is enough.
    scopes: tuple[Scope, ...]
    effect: Effect
    summary: str
    any_of: tuple[Scope, ...] = ()

    @property
    def label(self) -> str:
        """The scopes as the README's table names them."""
        if self.any_of:
            return " or ".join(self.any_of)
        return ", ".join(self.scopes)


TOOL_SCOPES: dict[str, ToolInfo] = {}


def scope_text(scopes: tuple[Scope, ...], any_of: tuple[Scope, ...] = ()) -> str:
    if any_of:
        names = " or ".join(f"'{scope}'" for scope in any_of)
        return f"Token scope: any one of {names}."
    names = " + ".join(f"'{scope}'" for scope in scopes)
    return f"Token scope: {names}."


def register(
    server: MCPServer,
    *,
    scopes: Scope | tuple[Scope, ...] = (),
    any_of: tuple[Scope, ...] = (),
    effect: Effect,
    idempotent: bool = False,
    title: str | None = None,
) -> Callable[[F], F]:
    """``@register(server, scopes=..., effect=...)`` on an async tool function."""
    needed = (scopes,) if isinstance(scopes, str) else scopes
    if bool(needed) == bool(any_of):
        raise ValueError("Give either scopes or any_of.")

    def decorator(fn: F) -> F:
        doc = inspect.cleandoc(fn.__doc__ or "")
        summary = doc.split("\n\n", 1)[0].replace("\n", " ")
        description = f"{doc}\n\n{scope_text(needed, any_of)} {EFFECT_TEXT[effect]}"
        read_only = effect == "read"
        annotations = ToolAnnotations(
            title=title,
            read_only_hint=read_only,
            # A local download may replace an existing file (with overwrite).
            destructive_hint=None
            if read_only
            else effect in ("changes", "destructive", "local"),
            idempotent_hint=True if read_only else idempotent,
            open_world_hint=False,
        )
        TOOL_SCOPES[fn.__name__] = ToolInfo(
            fn.__name__, needed, effect, summary, any_of
        )
        server.add_tool(
            fn, name=fn.__name__, description=description, annotations=annotations
        )
        return fn

    return decorator
