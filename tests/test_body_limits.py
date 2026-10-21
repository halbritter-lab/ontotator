"""Upload request bodies are bounded before FastAPI parses the multipart body."""

from starlette.formparsers import MultiPartParser
from test_guidelines_api import BASE, publish, versions
from test_guidelines_api import team as team

from ontocurator.api.body_limits import MULTIPART_ALLOWANCE
from ontocurator.domain.guidelines import MAX_GUIDELINE_BYTES


def _parses(monkeypatch) -> list[int]:
    calls: list[int] = []
    original = MultiPartParser.parse

    async def counting(self):  # type: ignore[no-untyped-def]
        calls.append(1)
        return await original(self)

    monkeypatch.setattr(MultiPartParser, "parse", counting)
    return calls


def test_declared_oversized_guideline_is_refused_before_parsing(
    team,
    monkeypatch,
) -> None:
    parses = _parses(monkeypatch)
    response = publish(team.lead, b"x" * (MAX_GUIDELINE_BYTES + MULTIPART_ALLOWANCE))
    assert response.status_code == 413
    assert response.json() == {
        "code": "GUIDELINE_TOO_LARGE",
        "details": {"max_bytes": MAX_GUIDELINE_BYTES},
    }
    assert parses == []
    assert versions(team.app) == []


def test_streamed_body_without_length_is_cut_off_at_the_limit() -> None:
    import asyncio
    import re
    from types import SimpleNamespace

    from ontocurator.api.body_limits import BodyLimit, BodyLimitMiddleware

    seen: list[int] = []

    async def inner(scope, receive, send) -> None:  # type: ignore[no-untyped-def]
        while True:
            message = await receive()
            if message["type"] != "http.request":
                break  # the parser gives up: the app answers an error
            seen.append(len(message["body"]))
            if not message.get("more_body"):
                break
        await send({"type": "http.response.start", "status": 400, "headers": []})
        await send({"type": "http.response.body", "body": b"parse error"})

    chunks = [b"x" * 1000 for _ in range(100)]

    async def receive():  # type: ignore[no-untyped-def]
        body = chunks.pop(0) if chunks else b""
        return {"type": "http.request", "body": body, "more_body": bool(chunks)}

    sent: list[dict] = []

    async def send(message) -> None:  # type: ignore[no-untyped-def]
        sent.append(message)

    rule = BodyLimit(
        "POST", re.compile("^/up$"), lambda _app: 0, "TOO_BIG", lambda _app: "big"
    )
    app = SimpleNamespace(state=SimpleNamespace(config=object()))
    scope = {"type": "http", "method": "POST", "path": "/up", "headers": [], "app": app}
    asyncio.run(BodyLimitMiddleware(inner, [rule])(scope, receive, send))
    assert sent[0]["status"] == 413
    assert b"TOO_BIG" in sent[1]["body"]
    # The app read only up to the limit (the allowance), never the whole body.
    assert sum(seen) <= MULTIPART_ALLOWANCE
    assert len(chunks) > 0


def test_guideline_within_the_limit_is_parsed(team) -> None:
    assert publish(team.lead, b"# Rules").status_code == 201
    too_large = publish(team.lead, b"x" * (MAX_GUIDELINE_BYTES + 1), expected="1")
    # Under the request limit: the endpoint's exact check answers.
    assert too_large.status_code == 413
    assert too_large.json()["code"] == "GUIDELINE_TOO_LARGE"


def test_document_upload_request_is_bounded_by_the_configured_limit(
    team,
    monkeypatch,
) -> None:
    parses = _parses(monkeypatch)
    team.app.state.config.max_upload_bytes = 1024
    response = team.lead.post(
        f"/api/v1/projects/{BASE.split('/')[4]}/uploads",
        data={"kind": "text", "language": "en"},
        files=[("files[]", ("a.txt", b"x" * (1024 + MULTIPART_ALLOWANCE)))],
    )
    assert response.status_code == 413
    assert response.json()["code"] == "PAYLOAD_TOO_LARGE"
    assert parses == []
