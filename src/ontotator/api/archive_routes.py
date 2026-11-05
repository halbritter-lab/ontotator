"""System-admin project archives: export a project, import an archive (#306).

Both run as jobs. An import job belongs to no project until it has created
one, so archive jobs are read here and not through ``/api/v1/jobs``. An
exported archive can be downloaded for ``ARCHIVE_RETENTION`` (24 hours), an
uploaded one is deleted when its import job ends.
"""

from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Annotated, Any, Literal

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from starlette.concurrency import run_in_threadpool
from starlette.responses import FileResponse

from ontotator.api.identity import PrincipalDep, require_system_admin
from ontotator.auth.audit import Actor, record_audit
from ontotator.domain.errors import PayloadTooLarge
from ontotator.exchange.archive import (
    EXPORT_KIND,
    IMPORT_KIND,
    expire_archive_files,
)
from ontotator.exchange.archive_tables import ARCHIVE_JOB_KINDS
from ontotator.exchange.jobs import store_path
from ontotator.storage.repository import Repository
from ontotator.storage.tables import JobRow, ProjectRow

router = APIRouter(
    prefix="/api/v1/admin/project-archives", tags=["admin-project-archives"]
)

ARCHIVE_KINDS = ARCHIVE_JOB_KINDS


class ArchiveExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project_key: str
    include_ontology_files: bool = True


class ArchiveJobQueued(BaseModel):
    job_id: int


class ArchiveJobView(BaseModel):
    id: int
    kind: Literal["project_archive_export", "project_archive_import"]
    status: Literal["queued", "running", "succeeded", "failed"]
    result: dict[str, Any] | None
    error: str | None
    created_at: datetime
    finished_at: datetime | None


def _actor(principal: Any) -> Actor:
    return Actor.user(principal.user_id, principal.username)


@router.post("/export")
def export_archive(
    body: ArchiveExportRequest, principal: PrincipalDep, request: Request
) -> ArchiveJobQueued:
    """Queue the archive of one project (``project_archive_export``)."""
    require_system_admin(principal)
    db = request.app.state.repo.db
    expire_archive_files(db)
    with db.transaction() as conn:
        project_id = Repository._project_id(conn, body.project_key)
        practice = conn.execute(
            select(ProjectRow.practice).where(
                ProjectRow.project_key == body.project_key
            )
        ).scalar_one_or_none()
    if project_id is None or practice:
        raise HTTPException(status_code=404, detail="Project not found.")
    job_id = request.app.state.jobs.enqueue(
        EXPORT_KIND,
        {
            "project": body.project_key,
            "include_ontology_files": body.include_ontology_files,
            "upload_limit": request.app.state.config.max_ontology_bytes,
        },
        project_id=project_id,
        actor=_actor(principal),
    )
    return ArchiveJobQueued(job_id=job_id)


@router.post("/import")
async def import_archive(
    principal: PrincipalDep,
    request: Request,
    file: Annotated[UploadFile, File()],
    rename_pseudonyms: Annotated[bool, Form()] = False,
) -> ArchiveJobQueued:
    """Store an uploaded archive and queue its import (``project_archive_import``).

    ``rename_pseudonyms``: a person whose pseudonym is taken here gets a new
    one, and a person matched by e-mail keeps the account's pseudonym.
    """
    require_system_admin(principal)
    limit: int = request.app.state.config.max_ontology_bytes
    total = 0
    db = request.app.state.repo.db
    # Spooled to disk and stored from there, never held in memory.
    try:
        with TemporaryDirectory(prefix="ontotator-upload-") as tmp:
            path = Path(tmp) / "archive.zip"
            with path.open("wb") as handle:
                while chunk := await file.read(min(1024 * 1024, limit - total + 1)):
                    total += len(chunk)
                    if total > limit:
                        raise PayloadTooLarge(
                            "The archive exceeds the configured byte limit."
                        )
                    handle.write(chunk)
            sha = await run_in_threadpool(store_path, db, path)
    finally:
        await file.close()
    job_id = request.app.state.jobs.enqueue(
        IMPORT_KIND,
        {
            "blob_sha256": sha,
            "filename": file.filename or "archive.zip",
            "rename_pseudonyms": rename_pseudonyms,
        },
        actor=_actor(principal),
    )
    return ArchiveJobQueued(job_id=job_id)


def _job(request: Request, job_id: int) -> Any:
    with request.app.state.repo.db.transaction() as conn:
        row = conn.execute(
            select(
                JobRow.id,
                JobRow.kind,
                JobRow.status,
                JobRow.result,
                JobRow.error,
                JobRow.created_at,
                JobRow.finished_at,
                JobRow.project_id,
            ).where(JobRow.id == job_id, JobRow.kind.in_(ARCHIVE_KINDS))
        ).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return row


@router.get("/jobs/{job_id}")
def get_archive_job(
    job_id: int, principal: PrincipalDep, request: Request
) -> ArchiveJobView:
    require_system_admin(principal)
    row = _job(request, job_id)
    return ArchiveJobView.model_validate(
        {k: v for k, v in row._mapping.items() if k != "project_id"}
    )


@router.get("/jobs/{job_id}/download", response_class=FileResponse)
def download_archive(
    job_id: int, principal: PrincipalDep, request: Request
) -> FileResponse:
    """The ZIP of a finished export job; audited as ``project.export_download``.

    410 once the archive was deleted (``ARCHIVE_RETENTION`` after the export,
    or at an account erasure).
    """
    require_system_admin(principal)
    expire_archive_files(request.app.state.repo.db)
    row = _job(request, job_id)
    result = row.result if isinstance(row.result, dict) else {}
    sha = result.get("sha256")
    key = result.get("project")
    if (
        row.kind != EXPORT_KIND
        or row.status != "succeeded"
        or row.finished_at is None
        or not isinstance(sha, str)
        or not isinstance(key, str)
    ):
        raise HTTPException(status_code=404, detail="Job not found.")
    gone = HTTPException(
        status_code=410,
        detail="The archive was deleted (24 hours after the export, or when an"
        " account was erased). Export the project again.",
    )
    if result.get("file_deleted_at"):
        raise gone
    db = request.app.state.repo.db
    try:
        path = db.blobs.path(sha)
        stat = path.stat()
    except (ValueError, OSError):
        raise gone from None
    safe_key = "".join(
        c if c.isascii() and (c.isalnum() or c in "-_") else "_" for c in key
    )
    stamp = row.finished_at.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")
    with db.transaction() as conn:
        record_audit(
            conn,
            _actor(principal),
            "project.export_download",
            target_type="project",
            target_id=key,
            project_id=row.project_id,
            details={"job_id": job_id, "kind": "archive", "sha256": sha},
        )
    return FileResponse(
        path,
        media_type="application/zip",
        filename=f"{safe_key}-archive-{stamp}.zip",
        stat_result=stat,
    )
