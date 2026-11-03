"""Ontotator API errors as tool errors the model can read and act on.

The API answers a refusal with ``{"code": ..., "details": ...}`` (request
validation with ``{"detail": [...]}``). Each error becomes one
``OntotatorError``: the HTTP status, the code, the server's own text and,
for the codes a script meets most, what to do about it. The token is never
part of a message.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
from mcp.server.mcpserver.exceptions import ToolError

MAX_DETAILS = 4000

# What the caller can do about a code; the server's own text comes first.
HINTS: dict[str, str] = {
    "NOT_AUTHENTICATED": (
        "Set ONTOTATOR_TOKEN to an API token of this server (Profile > API tokens,"
        " or ontotator admin tokens create)."
    ),
    "TOKEN_INVALID": (
        "The token in ONTOTATOR_TOKEN is unknown, expired or revoked. Create a new"
        " token and restart the MCP server with it."
    ),
    "TOKEN_SCOPE_MISSING": (
        "Create a token that also holds this scope (the tool description names it)"
        " and restart the MCP server with it."
    ),
    "TOKEN_NOT_ALLOWED": (
        "Either the route needs a browser session (annotation, review and"
        " translation review work, token management), or a project token was used"
        " outside its project. Use the web interface, or a personal token."
    ),
    "CREDENTIALS_AMBIGUOUS": "Send only the API token, without a session cookie.",
    "CROSS_SITE_REQUEST": (
        "The server refused the request's origin. Check ONTOTATOR_URL; it must be"
        " the server's public address."
    ),
    "NOT_ALLOWED": (
        "The token's owner lacks the project role for this (the scope only opens"
        " the route; the owner's roles decide)."
    ),
    "ADMIN_REQUIRED": "This needs a system token of a system administrator.",
    "PROJECT_NOT_FOUND": (
        "No such project, or the token's owner is not a member. list_projects"
        " shows the projects the token can see."
    ),
    "PROJECT_BUSY": "The project is busy and nothing was changed. Try again shortly.",
    "VALIDATION_ERROR": "Check the arguments against the tool's input schema.",
    "REVISION_CONFLICT": (
        "Someone changed the same thing in the meantime. Read the current state"
        " again and repeat the call."
    ),
    "EXPORT_EMPTY": (
        "Accept at least one final result first (accept_agreeing_texts, or the"
        " Documents page)."
    ),
    "PAYLOAD_TOO_LARGE": "The file exceeds the server's configured upload limit.",
}


class OntotatorError(ToolError):
    """A failed Ontotator call, with the API's status and code when it gave one."""

    def __init__(
        self, message: str, *, status: int | None = None, code: str | None = None
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code


def _text(value: Any) -> str:
    if isinstance(value, str):
        text = value
    else:
        text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if len(text) > MAX_DETAILS:
        text = text[:MAX_DETAILS] + " ...(cut)"
    return text


def api_error(response: httpx.Response) -> OntotatorError:
    """The error for a non-success ``response``."""
    request = response.request
    where = f"{request.method} {request.url.path}"
    code: str | None = None
    details: Any = None
    try:
        body = response.json()
    except ValueError:
        body = None
    if isinstance(body, dict):
        if isinstance(body.get("code"), str):
            code = body["code"]
            details = body.get("details")
        elif "detail" in body:
            detail = body["detail"]
            code = "VALIDATION_ERROR" if response.status_code == 422 else None
            details = detail
        # A conflict names its reason inside the details (EXPORT_PREFLIGHT_STALE).
        if isinstance(details, dict) and isinstance(details.get("reason"), str):
            code = f"{code}/{details['reason']}" if code else details["reason"]
    elif response.text:
        details = response.text
    head = f"Ontotator refused {where}: HTTP {response.status_code}"
    if code:
        head += f" {code}"
    parts = [head]
    if details not in (None, ""):
        parts.append(_text(details))
    hint = HINTS.get((code or "").split("/")[0])
    if hint is None and response.status_code == 404:
        hint = "Not found, or not visible to the token's owner."
    if hint:
        parts.append(hint)
    return OntotatorError(". ".join(parts), status=response.status_code, code=code)


def transport_error(url: str, exc: httpx.HTTPError) -> OntotatorError:
    """The error for a request that got no answer."""
    kind = type(exc).__name__
    return OntotatorError(
        f"Cannot reach Ontotator at {url} ({kind}: {exc}). Check ONTOTATOR_URL and"
        " that the server is running."
    )
