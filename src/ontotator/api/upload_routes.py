"""Document upload staging and document-scoped producer metadata."""

from typing import Annotated, Any, Literal

from fastapi import APIRouter, File, Form, Request, UploadFile
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from ontotator.api.identity import PrincipalDep
from ontotator.api.project_routes import _guard
from ontotator.api.routes import get_access
from ontotator.auth.audit import Actor
from ontotator.authz.policy import Action
from ontotator.authz.scoped import ScopedRepository
from ontotator.domain.errors import PayloadTooLarge
from ontotator.domain.proposals import ProposalSetView
from ontotator.exchange.jobs import store_file
from ontotator.exchange.uploads import (
    CasePlanChoice,
    ImportAcceptance,
    PlanChoice,
    UploadFileInfo,
    UploadService,
    UploadView,
)
from ontotator.exchange.variant_overrides import StatusOverride

router = APIRouter(prefix="/api/v1/projects/{key}", tags=["uploads"])


class UploadCreated(BaseModel):
    upload_id: int
    job_id: int


class CommitUpload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    plan_sha256: str
    status_overrides: list[StatusOverride] = Field(default_factory=list)
    # Work plan of the new rows: by language row ("source" or a code), then per
    # case; plus translations accepted as reviewed outside Ontotator.
    plan_languages: dict[str, PlanChoice] = Field(default_factory=dict)
    plan_cases: list[CasePlanChoice] = Field(default_factory=list)
    accept_external_review: ImportAcceptance | None = None


def _service(request: Request, principal: Any) -> UploadService:
    return UploadService(
        request.app.state.repo.db,
        request.app.state.jobs,
        Actor.user(principal.user_id, principal.username),
    )


@router.post("/uploads")
async def create_upload(
    key: str,
    request: Request,
    principal: PrincipalDep,
    kind: Annotated[Literal["t1", "text"], Form()],
    files: Annotated[list[UploadFile], File(alias="files[]")],
    language: Annotated[str | None, Form()] = None,
) -> UploadCreated:
    _guard(request, Action.IMPORT_DOCUMENTS, key)
    limit = request.app.state.config.max_upload_bytes
    total = 0
    received = []
    try:
        # Bound the aggregate before recording any stored file or upload row.
        for file in files:
            data = bytearray()
            while chunk := await file.read(min(1024 * 1024, limit - total + 1)):
                total += len(chunk)
                if total > limit:
                    raise PayloadTooLarge(
                        "Document uploads exceed the configured byte limit."
                    )
                data.extend(chunk)
            received.append((file.filename or "upload", bytes(data)))
        db = request.app.state.repo.db
        service = _service(request, principal)

        def create() -> dict[str, int]:
            # One transaction: a discard cannot delete a blob before this upload
            # references it.
            with db.transaction():
                stored = [
                    UploadFileInfo(
                        filename=name, sha256=store_file(db, content), size=len(content)
                    )
                    for name, content in received
                ]
                return service.create(key, kind, language, stored)

        return UploadCreated(**await run_in_threadpool(create))
    finally:
        for file in files:
            await file.close()


@router.get("/uploads")
def list_uploads(
    key: str, request: Request, principal: PrincipalDep
) -> list[UploadView]:
    _guard(request, Action.IMPORT_DOCUMENTS, key)
    return _service(request, principal).list(key)


@router.get("/uploads/{upload_id}")
def get_upload(
    key: str, upload_id: int, request: Request, principal: PrincipalDep
) -> UploadView:
    _guard(request, Action.IMPORT_DOCUMENTS, key)
    return _service(request, principal).get(key, upload_id)


@router.post("/uploads/{upload_id}/commit")
def commit_upload(
    key: str,
    upload_id: int,
    body: CommitUpload,
    request: Request,
    principal: PrincipalDep,
) -> UploadCreated:
    _guard(request, Action.IMPORT_DOCUMENTS, key)
    return UploadCreated(
        **_service(request, principal).commit(
            key,
            upload_id,
            body.plan_sha256,
            body.status_overrides,
            plan_languages=body.plan_languages,
            plan_cases=body.plan_cases,
            accept_external_review=body.accept_external_review,
        )
    )


@router.post("/uploads/{upload_id}/discard")
def discard_upload(
    key: str, upload_id: int, request: Request, principal: PrincipalDep
) -> UploadView:
    _guard(request, Action.IMPORT_DOCUMENTS, key)
    return _service(request, principal).discard(key, upload_id)


@router.get("/proposal-sets/{set_id}")
def get_proposal_set(
    key: str, set_id: int, request: Request, principal: PrincipalDep
) -> ProposalSetView:
    repo = ScopedRepository(
        request.app.state.repo.db,
        get_access(request),
        Actor.user(principal.user_id, principal.username),
    )
    with repo.db.snapshot():
        return ProposalSetView(**repo.get_proposal_set(key, set_id))
