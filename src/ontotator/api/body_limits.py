"""Request body limits, enforced before any parsing.

FastAPI parses a whole multipart body (spooling files to disk) before the
endpoint runs, so the endpoints' bounded reads cannot bound the request.
``BodyLimitMiddleware`` refuses a body over its route's limit by
``Content-Length`` before the app runs, and counts streamed bytes for bodies
without one (chunked): past the limit it ends the body for the app and answers
413 in place of whatever the app would have answered.

A limit is the route's content limit plus ``MULTIPART_ALLOWANCE`` for the
multipart framing and form fields; the endpoints keep their exact checks.
Every other request (JSON, the unauthenticated login and code redemption
included) is bounded by ``max_request_bytes``.
"""

import json
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from ontotator.api.work_plan_routes import (
    MAX_CASE_ID_LENGTH,
    MAX_LANGUAGE_LENGTH,
    MAX_SELECTED_ROWS,
)
from ontotator.domain.guidelines import MAX_GUIDELINE_BYTES

# Multipart boundaries, part headers and the small form fields.
MULTIPART_ALLOWANCE = 64 * 1024
# A Documents selection at its longest: every row a longest case id and
# language with its JSON framing ({"case_id":"","language":""},).
SELECTION_BYTES = MAX_SELECTED_ROWS * (MAX_CASE_ID_LENGTH + MAX_LANGUAGE_LENGTH + 32)
# The JSON routes that carry a Documents selection or other bulk row lists.
SELECTION_PATH = re.compile(
    r"^/api/v1/projects/[^/]+/(work-plans/(bulk(/preview)?|rows)"
    r"|assignments(/batch(/preview)?)?|document-rows/(selection-summary|keys|selected)"
    r"|case-ids/lookup)/?$"
)


@dataclass(frozen=True)
class BodyLimit:
    method: str
    path: re.Pattern[str]
    # Content limit in bytes, read per request (the configuration may change).
    content_bytes: Callable[[Any], int]
    code: str
    details: Callable[[Any], str | dict[str, Any]]
    allowance: int = MULTIPART_ALLOWANCE


def _config(app: Any, name: str) -> int:
    return int(getattr(app.state.config, name))


LIMITS: tuple[BodyLimit, ...] = (
    BodyLimit(
        "POST",
        re.compile(r"^/api/v1/projects/[^/]+/guidelines/?$"),
        lambda _app: MAX_GUIDELINE_BYTES,
        "GUIDELINE_TOO_LARGE",
        lambda _app: {"max_bytes": MAX_GUIDELINE_BYTES},
    ),
    BodyLimit(
        "POST",
        re.compile(r"^/api/v1/projects/[^/]+/uploads/?$"),
        lambda app: _config(app, "max_upload_bytes"),
        "PAYLOAD_TOO_LARGE",
        lambda _app: "Document uploads exceed the configured byte limit.",
    ),
    BodyLimit(
        "POST",
        re.compile(r"^/api/v1/admin/ontologies(/|/upload-results/?)?$"),
        lambda app: _config(app, "max_ontology_bytes"),
        "PAYLOAD_TOO_LARGE",
        lambda _app: "Ontology uploads exceed the configured byte limit.",
    ),
    *(
        BodyLimit(
            method,
            SELECTION_PATH,
            lambda _app: SELECTION_BYTES,
            "PAYLOAD_TOO_LARGE",
            lambda _app: "The selection exceeds the request byte limit.",
        )
        for method in ("POST", "PUT")
    ),
)


# Any request no upload rule names.
DEFAULT_LIMIT = BodyLimit(
    "*",
    re.compile(""),
    lambda app: _config(app, "max_request_bytes"),
    "PAYLOAD_TOO_LARGE",
    lambda _app: "The request body exceeds the configured byte limit.",
    allowance=0,
)


class BodyLimitMiddleware:
    def __init__(self, app: ASGIApp, limits: Sequence[BodyLimit] = LIMITS) -> None:
        self.app = app
        self.limits = tuple(limits)

    def _limit(self, scope: Scope) -> BodyLimit:
        method, path = scope["method"], scope["path"]
        return next(
            (
                item
                for item in self.limits
                if item.method == method and item.path.match(path)
            ),
            DEFAULT_LIMIT,
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        app = scope.get("app")
        if scope["type"] != "http" or app is None or not hasattr(app.state, "config"):
            await self.app(scope, receive, send)
            return
        rule = self._limit(scope)
        limit = rule.content_bytes(app) + rule.allowance

        async def refuse() -> None:
            body = json.dumps(
                {"code": rule.code, "details": rule.details(app)}
            ).encode()
            await send(
                {
                    "type": "http.response.start",
                    "status": 413,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode()),
                        (b"connection", b"close"),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": body})

        declared = dict(scope.get("headers") or []).get(b"content-length")
        if declared is not None:
            try:
                too_large = int(declared) > limit
            except ValueError:
                too_large = False  # the server refuses a malformed header
            if too_large:
                await refuse()
                return

        received = 0
        exceeded = False
        started = False

        async def counted() -> Message:
            nonlocal received, exceeded
            if exceeded:
                return {"type": "http.disconnect"}
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    # End the body for the app; its answer is replaced below.
                    exceeded = True
                    return {"type": "http.disconnect"}
            return message

        async def guarded(message: Message) -> None:
            nonlocal started
            if exceeded and not started:
                return
            started = True
            await send(message)

        try:
            await self.app(scope, counted, guarded)
        except Exception:
            if not exceeded:
                raise
        if exceeded and not started:
            await refuse()
