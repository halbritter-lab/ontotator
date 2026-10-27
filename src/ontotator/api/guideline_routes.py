"""Versioned project guidelines: list, read, publish, withdraw, record reads."""

import hashlib
from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, Request, Response, UploadFile
from pydantic import BaseModel, ConfigDict
from starlette.concurrency import run_in_threadpool

from ontotator.api.identity import PrincipalDep
from ontotator.api.routes import get_access
from ontotator.application.guidelines import (
    GuidelineDocument,
    GuidelineListing,
    GuidelineService,
    GuidelineSummary,
)
from ontotator.auth.audit import Actor
from ontotator.authz.policy import Action, can
from ontotator.domain.errors import AccessDenied, DomainError
from ontotator.domain.guidelines import MAX_GUIDELINE_BYTES

router = APIRouter(prefix="/api/v1/projects", tags=["guidelines"])

CACHE_CONTROL = "private, no-cache"
# The body depends on the viewer (display names, ``is_me``), and so does the ETag.
VARY = "Cookie"
# A leading UTF-8 BOM is dropped before the size check (G13).
_READ_LIMIT = MAX_GUIDELINE_BYTES + 3
_CHUNK = 65536


class GuidelineWithdrawRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str | None = None
    expected_latest_version: int


class GuidelineReadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event: Literal["notified", "opened"]


def _service(request: Request) -> GuidelineService:
    return GuidelineService(request.app.state.repo.db)


def _require_management(request: Request, key: str) -> None:
    """Refuse before reading an upload; the service checks again under lock."""
    access = get_access(request)
    if not can(access, Action.VIEW_PROJECT, key):
        raise DomainError("PROJECT_NOT_FOUND", f"There is no project '{key}'.")
    if not can(access, Action.MANAGE_PROJECT_SETTINGS, key):
        raise AccessDenied("NOT_ALLOWED", "You may not manage this project.")


@router.get("/{key}/guidelines")
def list_guidelines(
    key: str, request: Request, principal: PrincipalDep
) -> GuidelineListing:
    return _service(request).listing(get_access(request), key)


def _etag(document: GuidelineDocument) -> str:
    """A weak tag over the viewer's serialized body: it changes with every
    viewer-dependent field (display names for leads, ``is_me``, withdrawal)."""
    digest = hashlib.sha256(document.model_dump_json().encode("utf-8")).hexdigest()
    return f'W/"{digest}"'


@router.get(
    "/{key}/guidelines/{version}",
    responses={304: {"description": "The cached version is still valid."}},
)
def get_guideline(
    key: str,
    version: int,
    request: Request,
    response: Response,
    principal: PrincipalDep,
) -> GuidelineDocument:
    document = _service(request).document(get_access(request), key, version)
    etag = _etag(document)
    headers = {"ETag": etag, "Cache-Control": CACHE_CONTROL, "Vary": VARY}
    wanted = request.headers.get("if-none-match")
    if wanted is not None:
        # Weak comparison (RFC 9110): the W/ prefix does not count.
        tags = {tag.strip().removeprefix("W/") for tag in wanted.split(",")}
        if etag.removeprefix("W/") in tags or "*" in tags:
            return Response(status_code=304, headers=headers)  # type: ignore[return-value]
    response.headers.update(headers)
    return document


@router.post("/{key}/guidelines", status_code=201)
async def publish_guideline(
    key: str,
    request: Request,
    principal: PrincipalDep,
    file: Annotated[UploadFile, File()],
    change_note: Annotated[str, Form()] = "",
    expected_latest_version: Annotated[str, Form(pattern=r"^[0-9]{0,9}$")] = "",
) -> GuidelineSummary:
    _require_management(request, key)
    try:
        data = bytearray()
        # ``BodyLimitMiddleware`` bounds the request before FastAPI parses
        # the multipart body; these bounded reads refuse the file itself after
        # at most MAX_GUIDELINE_BYTES + 4 bytes of the parsed part.
        while chunk := await file.read(min(_CHUNK, _READ_LIMIT - len(data) + 1)):
            data += chunk
            if len(data) > _READ_LIMIT:
                raise DomainError(
                    "GUIDELINE_TOO_LARGE", {"max_bytes": MAX_GUIDELINE_BYTES}
                )
    finally:
        await file.close()
    return await run_in_threadpool(
        _service(request).upload,
        Actor.user(principal.user_id, principal.username),
        key,
        filename=file.filename or "",
        data=bytes(data),
        change_note=change_note,
        expected_latest_version=(
            int(expected_latest_version) if expected_latest_version else None
        ),
    )


@router.post("/{key}/guidelines/{version}/withdraw")
def withdraw_guideline(
    key: str,
    version: int,
    body: GuidelineWithdrawRequest,
    request: Request,
    principal: PrincipalDep,
) -> GuidelineSummary:
    return _service(request).withdraw(
        Actor.user(principal.user_id, principal.username),
        key,
        version,
        reason=body.reason,
        expected_latest_version=body.expected_latest_version,
    )


@router.post(
    "/{key}/guidelines/{version}/reads", status_code=204, response_class=Response
)
def record_guideline_read(
    key: str,
    version: int,
    body: GuidelineReadRequest,
    request: Request,
    principal: PrincipalDep,
) -> None:
    _service(request).record_read(get_access(request), key, version, body.event)
