"""A fake Ontotator API behind ``httpx.MockTransport``.

Every route of the contract answers with a synthesized body of its response
schema; ``on`` overrides a route with a fixed body (checked against the
schema) or a function. Each call is recorded with its contract template.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import httpx
from contract import check, match, named, response_schema, synth

TOKEN = "ott_test-token-never-shown"
Handler = Callable[[httpx.Request], Any]


def token_view(**fields: Any) -> dict[str, Any]:
    """``GET /api/v1/auth/token``: the token's own record (never its secret)."""
    body = {
        "id": 1,
        "name": "mcp",
        "kind": "personal",
        "owner": "lead",
        "owner_display_name": "Lea Lead",
        "project_key": None,
        "scopes": ["read", "import", "export", "project-admin"],
        "created_at": "2026-11-01T10:00:00Z",
        "expires_at": "2099-01-01T00:00:00Z",
        "last_used_at": None,
        "revoked_at": None,
        "revoked_reason": None,
    } | fields
    check(body, named("TokenView"))
    return body


@dataclass
class Call:
    method: str
    template: str
    request: httpx.Request

    def json(self) -> Any:
        return json.loads(self.request.content or b"null")


@dataclass
class FakeApi:
    routes: dict[tuple[str, str], Handler | Any] = field(default_factory=dict)
    calls: list[Call] = field(default_factory=list)

    def __post_init__(self) -> None:
        # Jobs finish at once unless a test says otherwise.
        self.on("GET", "/api/v1/jobs/{job_id}", self._job)
        # A personal token with every scope but admin, far from its expiry.
        self.on("GET", "/api/v1/auth/token", token_view())

    @staticmethod
    def _job(request: httpx.Request) -> dict[str, Any]:
        job_id = int(request.url.path.rsplit("/", 1)[-1])
        return {
            "id": job_id,
            "kind": "final_t1_export",
            "status": "succeeded",
            "result": {},
            "error": None,
            "created_at": "2026-11-01T10:00:00Z",
            "finished_at": "2026-11-01T10:00:05Z",
        }

    def on(self, method: str, template: str, answer: Handler | Any) -> None:
        self.routes[(method, template)] = answer

    def templates(self) -> list[tuple[str, str]]:
        return [(call.method, call.template) for call in self.calls]

    def calls_to(self, method: str, template: str) -> list[Call]:
        return [c for c in self.calls if (c.method, c.template) == (method, template)]

    def __call__(self, request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == f"Bearer {TOKEN}"
        raw = request.url.raw_path.decode().split("?", 1)[0]
        template = match(request.method, raw)
        assert template is not None, f"not in the contract: {request.method} {raw}"
        self.calls.append(Call(request.method, template, request))
        answer = self.routes.get((request.method, template), _SYNTH)
        if answer is _SYNTH:
            schema = response_schema(request.method, template)
            body = None if schema is None else synth(schema)
        elif callable(answer):
            body = answer(request)
        else:
            body = answer
        if isinstance(body, httpx.Response):
            return body
        if isinstance(body, bytes):
            return httpx.Response(200, content=body)
        schema = response_schema(request.method, template)
        if schema is not None and body is not None:
            check(body, schema)
        return httpx.Response(200, json=body)


_SYNTH = object()


def refusal(status: int, code: str, details: Any) -> httpx.Response:
    return httpx.Response(status, json={"code": code, "details": details})
