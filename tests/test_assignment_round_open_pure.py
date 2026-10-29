"""Assignment-open HTTP body forwarding without a database."""

from contextlib import nullcontext
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from ontotator.api import assignment_routes as routes
from ontotator.api.identity import principal_of
from ontotator.api.routes import get_workspace_service
from ontotator.auth.sessions import Principal
from ontotator.domain.errors import DomainError


@pytest.fixture
def client(monkeypatch):
    app = FastAPI()
    owner = SimpleNamespace(user_id=7)
    conn = SimpleNamespace(
        execute=lambda _stmt: SimpleNamespace(
            first=lambda: owner if owner.user_id == 7 else None
        )
    )
    app.state.repo = SimpleNamespace(
        db=SimpleNamespace(transaction=lambda: nullcontext(conn))
    )
    app.dependency_overrides[principal_of] = lambda: Principal(
        7, "alice", "Alice", "own-pseudo", False, 1, "csrf"
    )
    app.dependency_overrides[get_workspace_service] = lambda: object()
    monkeypatch.setattr(
        routes.AssignmentService,
        "_get",
        lambda *_: SimpleNamespace(
            project_key="server-project",
            document_id="server-doc",
            task="annotate",
            annotation_mode="scratch",
            active_round_id=None,
        ),
    )
    calls = []

    def opened(body, *_args):
        calls.append(body)
        raise DomainError("FORWARDED")

    monkeypatch.setattr(routes, "open_workspace", opened)
    # No database here: no earlier work of the person was discarded.
    monkeypatch.setattr(routes, "_fresh_after_discard", lambda *_: False)
    app.include_router(routes.router)

    @app.exception_handler(DomainError)
    async def failed(_request: Request, exc: DomainError):
        return JSONResponse({"code": exc.code}, status_code=422)

    return TestClient(app), calls, owner


@pytest.mark.parametrize(
    "body,expected",
    [
        (None, None),
        ({}, None),
        ({"review_round_target_set_id": None}, None),
        ({"review_round_target_set_id": "chosen-round"}, "chosen-round"),
    ],
)
def test_optional_body_forwards_only_selected_round(client, body, expected):
    http, calls, _owner = client
    response = http.post(
        "/api/v1/assignments/12/open", **({} if body is None else {"json": body})
    )
    assert response.json() == {"code": "FORWARDED"}
    assert len(calls) == 1
    forwarded = calls[0]
    assert forwarded.review_round_target_set_id == expected
    assert (
        forwarded.project_key,
        forwarded.document_id,
        forwarded.mode,
        forwarded.annotator_id,
    ) == ("server-project", "server-doc", "independent", None)


def test_review_task_without_consolidation_round_is_invalid(client, monkeypatch):
    http, calls, _owner = client
    monkeypatch.setattr(
        routes.AssignmentService,
        "_get",
        lambda *_: SimpleNamespace(
            project_key="server-project",
            document_id="server-doc",
            task="review",
            active_round_id=None,
        ),
    )
    response = http.post("/api/v1/assignments/12/open")
    assert response.json() == {"code": "TASK_INVALID"}
    assert calls == []


@pytest.mark.parametrize(
    "field,value",
    [
        ("project_key", "other"),
        ("document_id", "other"),
        ("user_id", 99),
        ("annotator_id", "foreign"),
        ("mode", "independent"),
        ("targets", {}),
    ],
)
def test_assignment_authority_fields_cannot_be_overridden(client, field, value):
    http, calls, _owner = client
    response = http.post(
        "/api/v1/assignments/12/open",
        json={"review_round_target_set_id": "chosen", field: value},
    )
    assert response.status_code == 422
    assert response.json()["detail"][0]["type"] == "extra_forbidden"
    assert calls == []


def test_foreign_assignment_is_denied_before_forwarding(client):
    http, calls, owner = client
    owner.user_id = 99
    response = http.post(
        "/api/v1/assignments/12/open", json={"review_round_target_set_id": "chosen"}
    )
    assert response.json() == {"code": "ASSIGNMENT_NOT_FOUND"}
    assert calls == []
