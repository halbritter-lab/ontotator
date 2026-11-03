from __future__ import annotations

import re

import httpx
import pytest
from conftest import ToolFailed, call
from fake_api import TOKEN, FakeApi, refusal
from mcp import Client

from ontotator_mcp.config import ConfigError, Settings
from ontotator_mcp.errors import api_error


def test_settings_come_from_the_environment() -> None:
    settings = Settings.from_env(
        {"ONTOTATOR_URL": "https://ontotator.example.org/", "ONTOTATOR_TOKEN": TOKEN}
    )
    assert settings.url == "https://ontotator.example.org"
    assert settings.token == TOKEN
    assert TOKEN not in repr(settings)


@pytest.mark.parametrize(
    ("env", "message"),
    [
        ({"ONTOTATOR_TOKEN": TOKEN}, "ONTOTATOR_URL"),
        ({"ONTOTATOR_URL": "https://a.example"}, "ONTOTATOR_TOKEN"),
        ({"ONTOTATOR_URL": "ftp://a.example", "ONTOTATOR_TOKEN": TOKEN}, "http(s)"),
        ({"ONTOTATOR_URL": "http://a.example", "ONTOTATOR_TOKEN": TOKEN}, "plain http"),
        (
            {
                "ONTOTATOR_URL": "https://a.example",
                "ONTOTATOR_TOKEN": TOKEN,
                "ONTOTATOR_TIMEOUT": "soon",
            },
            "ONTOTATOR_TIMEOUT",
        ),
    ],
)
def test_unusable_settings_are_refused(env: dict[str, str], message: str) -> None:
    with pytest.raises(ConfigError, match=re.escape(message)) as raised:
        Settings.from_env(env)
    assert TOKEN not in str(raised.value)


@pytest.mark.parametrize(
    "url", ["http://localhost:8000", "http://127.0.0.1:8000", "http://[::1]:8000"]
)
def test_plain_http_is_allowed_to_this_computer(url: str) -> None:
    assert (
        Settings.from_env({"ONTOTATOR_URL": url, "ONTOTATOR_TOKEN": TOKEN}).url == url
    )


def test_plain_http_elsewhere_needs_the_opt_in() -> None:
    env = {
        "ONTOTATOR_URL": "http://ontotator.lan",
        "ONTOTATOR_TOKEN": TOKEN,
        "ONTOTATOR_ALLOW_HTTP": "1",
    }
    assert Settings.from_env(env).url == "http://ontotator.lan"


def _response(status: int, body: object) -> httpx.Response:
    request = httpx.Request("POST", "https://o.test/api/v1/projects/p/exports")
    return httpx.Response(status, json=body, request=request)


def test_a_missing_scope_names_the_scope_and_the_remedy() -> None:
    error = api_error(
        _response(
            403,
            {
                "code": "TOKEN_SCOPE_MISSING",
                "details": "The API token needs the 'export' scope for this route.",
            },
        )
    )
    text = str(error)
    assert error.code == "TOKEN_SCOPE_MISSING"
    assert error.status == 403
    assert "POST /api/v1/projects/p/exports" in text
    assert "'export' scope" in text
    assert "Create a token that also holds this scope" in text


def test_validation_errors_and_conflict_reasons_are_named() -> None:
    validation = api_error(_response(422, {"detail": [{"loc": ["body", "kind"]}]}))
    assert validation.code == "VALIDATION_ERROR"
    assert '"kind"' in str(validation)
    stale = api_error(
        _response(
            409,
            {
                "code": "REVISION_CONFLICT",
                "details": {"reason": "EXPORT_PREFLIGHT_STALE", "preflight": {}},
            },
        )
    )
    assert stale.code == "REVISION_CONFLICT/EXPORT_PREFLIGHT_STALE"


def test_a_404_without_a_code_says_what_it_may_mean() -> None:
    error = api_error(_response(404, {"detail": "Job not found."}))
    assert "Job not found." in str(error)
    assert "not visible to the token's owner" in str(error)


@pytest.mark.anyio
async def test_tool_errors_carry_the_api_code(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on(
        "GET",
        "/api/v1/auth/me",
        refusal(401, "TOKEN_INVALID", "The API token is unknown, expired or revoked."),
    )
    with pytest.raises(ToolFailed) as raised:
        await call(mcp_client, "whoami", {})
    assert "HTTP 401 TOKEN_INVALID" in str(raised.value)
    assert "restart the MCP server" in str(raised.value)
    assert TOKEN not in str(raised.value)


@pytest.mark.anyio
async def test_a_redirect_is_not_followed(fake: FakeApi, mcp_client: Client) -> None:
    fake.on(
        "GET",
        "/api/v1/projects",
        httpx.Response(307, headers={"location": "https://elsewhere.test/"}),
    )
    with pytest.raises(
        ToolFailed, match=re.escape("redirect to https://elsewhere.test/")
    ):
        await call(mcp_client, "list_projects", {})
    assert len(fake.calls) == 1
