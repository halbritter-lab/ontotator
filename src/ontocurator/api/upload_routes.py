"""Document upload staging and document-scoped producer metadata."""

from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, File, Form, Request, UploadFile
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from ontocurator.api.identity import PrincipalDep
from ontocurator.api.project_routes import _guard
from ontocurator.api.routes import get_access
from ontocurator.auth.audit import Actor
from ontocurator.authz.policy import Action
from ontocurator.authz.scoped import ScopedRepository
from ontocurator.domain.errors import PayloadTooLarge
from ontocurator.exchange.jobs import store_file
from ontocurator.exchange.uploads import UploadFileInfo, UploadService, UploadView
from ontocurator.exchange.variant_overrides import StatusOverride

router = APIRouter(prefix="/api/v1/projects/{key}", tags=["uploads"])


class UploadCreated(BaseModel):
    upload_id: int
    job_id: int


class CommitUpload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    plan_sha256: str
    status_overrides: list[StatusOverride] = Field(default_factory=list)


class ProposalSetView(BaseModel):
    id: int
    document_id: str
    annotation_set_id: str
    bundle_id: str | None
    set_kind: str
    actors: list[dict[str, Any]]
    imported_at: datetime
    imported_by_pseudonym: str | None
    origin: Literal["import", "reanchor"]
    source_document_id: str | None
    source_version: int | None


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
        stored = []
        for name, content in received:
            sha = await run_in_threadpool(store_file, db, content)
            stored.append(UploadFileInfo(filename=name, sha256=sha, size=len(content)))
        result = await run_in_threadpool(
            _service(request, principal).create, key, kind, language, stored
        )
        return UploadCreated(**result)
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
            key, upload_id, body.plan_sha256, body.status_overrides
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
