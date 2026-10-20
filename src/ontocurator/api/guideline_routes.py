"""Versioned project guidelines: list, read, publish, withdraw, record reads."""

from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, Request, Response, UploadFile
from pydantic import BaseModel, ConfigDict
from starlette.concurrency import run_in_threadpool

from ontocurator.api.identity import PrincipalDep
from ontocurator.api.routes import get_access
from ontocurator.application.guidelines import (
    GuidelineDocument,
    GuidelineListing,
    GuidelineService,
    GuidelineSummary,
)
from ontocurator.auth.audit import Actor
from ontocurator.authz.policy import Action, can
from ontocurator.domain.errors import AccessDenied, DomainError
from ontocurator.domain.guidelines import MAX_GUIDELINE_BYTES

router = APIRouter(prefix="/api/v1/projects", tags=["guidelines"])

CACHE_CONTROL = "private, no-cache"
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
    return '"withdrawn"' if document.withdrawn is not None else f'"{document.sha256}"'


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
    headers = {"ETag": etag, "Cache-Control": CACHE_CONTROL}
    wanted = request.headers.get("if-none-match")
    if wanted is not None:
        tags = {tag.strip().removeprefix("W/") for tag in wanted.split(",")}
        if etag in tags or "*" in tags:
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
        # Bounded reads: an oversized file is refused after at most
        # MAX_GUIDELINE_BYTES + 4 bytes, never read whole.
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
