"""Project-associated job polling and authorized export artifact delivery."""

from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import Connection, func, select
from starlette.responses import FileResponse

from ontocurator.api.identity import PrincipalDep
from ontocurator.auth.audit import Actor, record_audit
from ontocurator.authz.policy import Action
from ontocurator.authz.project_authority import require_project_management
from ontocurator.authz.scoped import project_not_found
from ontocurator.domain.errors import DomainError
from ontocurator.storage.repository import Repository, _lock_id
from ontocurator.storage.tables import JobRow, ProjectRow

router = APIRouter(prefix="/api/v1/jobs", tags=["jobs"])

EXPORT_ACTIONS = {
    "t1": Action.EXPORT_ALL_WORK,
    "final": Action.EXPORT_ALL_WORK,
    "edit_log": Action.EXPORT_EDIT_LOG,
    "translation-reviews": Action.EXPORT_ALL_WORK,
}
EXPORT_KINDS = {
    "t1_export": ("t1", "zip", "application/zip"),
    "final_t1_export": ("final", "zip", "application/zip"),
    "edit_log_export": ("edit_log", "jsonl", "application/x-ndjson"),
    "translation_review_export": (
        "translation-reviews",
        "jsonl",
        "application/x-ndjson",
    ),
}


class JobView(BaseModel):
    id: int
    kind: str
    status: Literal["queued", "running", "succeeded", "failed"]
    result: dict[str, Any] | None
    error: str | None
    created_at: datetime
    finished_at: datetime | None


def authorized_project(conn: Connection, key: str, actor: Actor, action: Action) -> int:
    """Keep membership, structure and fresh actor rights stable through commit."""
    conn.execute(select(func.pg_advisory_xact_lock_shared(_lock_id("members", key))))
    conn.execute(select(func.pg_advisory_xact_lock_shared(_lock_id("project", key))))
    project_id = Repository._project_id(conn, key)
    if project_id is None:
        raise project_not_found(key)
    require_project_management(conn, actor, key, project_id, action)
    return project_id


def _not_found() -> HTTPException:
    return HTTPException(status_code=404, detail="Job not found.")


def _association(conn: Connection, job_id: int) -> tuple[int, str, int | None]:
    # Resolve only association/ownership before authorization; never return a
    # legacy payload's project string as evidence of project membership.
    row = conn.execute(
        select(JobRow.project_id, ProjectRow.project_key, JobRow.requested_by)
        .join(ProjectRow, ProjectRow.id == JobRow.project_id)
        .where(JobRow.id == job_id)
    ).one_or_none()
    if row is None:
        raise _not_found()
    return row.project_id, row.project_key, row.requested_by


@router.get("/{job_id}")
def get_job(job_id: int, request: Request, principal: PrincipalDep) -> JobView:
    actor = Actor.user(principal.user_id, principal.username)
    with request.app.state.repo.db.transaction() as conn:
        project_id, key, requested_by = _association(conn, job_id)
        action = (
            Action.VIEW_PROJECT
            if requested_by == principal.user_id
            else Action.VIEW_PROGRESS
        )
        try:
            authorized_project(conn, key, actor, action)
        except DomainError as exc:
            if exc.code in {"PROJECT_NOT_FOUND", "NOT_ALLOWED"}:
                raise _not_found() from None
            raise
        row = (
            conn.execute(
                select(
                    JobRow.id,
                    JobRow.kind,
                    JobRow.status,
                    JobRow.result,
                    JobRow.error,
                    JobRow.created_at,
                    JobRow.finished_at,
                ).where(JobRow.id == job_id, JobRow.project_id == project_id)
            )
            .mappings()
            .one_or_none()
        )
        if row is None:
            raise _not_found()
        return JobView.model_validate(dict(row))


@router.get("/{job_id}/download", response_class=FileResponse)
def download_job(
    job_id: int, request: Request, principal: PrincipalDep
) -> FileResponse:
    actor = Actor.user(principal.user_id, principal.username)
    db = request.app.state.repo.db
    with db.transaction() as conn:
        project_id, key, _ = _association(conn, job_id)
        # First conceal foreign projects, before inspecting job kind/result.
        try:
            authorized_project(conn, key, actor, Action.VIEW_PROJECT)
        except DomainError as exc:
            if exc.code == "PROJECT_NOT_FOUND":
                raise _not_found() from None
            raise
        row = conn.execute(
            select(
                JobRow.kind,
                JobRow.status,
                JobRow.result,
                JobRow.finished_at,
                JobRow.payload["project"].astext.label("payload_project"),
            ).where(JobRow.id == job_id, JobRow.project_id == project_id)
        ).one_or_none()
        if row is None or row.kind not in EXPORT_KINDS:
            raise _not_found()
        if row.payload_project != key:
            raise _not_found()
        kind, suffix, media_type = EXPORT_KINDS[row.kind]
        # Export privilege is required even for the original requester.
        require_project_management(conn, actor, key, project_id, EXPORT_ACTIONS[kind])
        if (
            row.status != "succeeded"
            or row.finished_at is None
            or not isinstance(row.result, dict)
        ):
            raise _not_found()
        sha = row.result.get("sha256")
        if not isinstance(sha, str):
            raise _not_found()
        try:
            path = db.blobs.path(sha)
            stat = path.stat()
            if not path.is_file():
                raise _not_found()
            if row.kind == "translation_review_export":
                count = row.result.get("reviews")
                if type(count) is not int or count < 0:
                    raise _not_found()
                # New review artifacts are verified; preserve legacy two-kind behavior.
                db.blobs.get(sha)
        except (ValueError, OSError):
            raise _not_found() from None
        # The key is stored server-side, but still restrict attachment names to
        # ASCII filename characters rather than trusting header/path syntax.
        safe_key = "".join(
            c if c.isascii() and (c.isalnum() or c in "-_") else "_" for c in key
        )
        stamp = row.finished_at.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")
        response = FileResponse(
            path,
            media_type=media_type,
            filename=f"{safe_key}-{kind}-{stamp}.{suffix}",
            stat_result=stat,
        )
        # Records successful authorized preparation, not transfer completion.
        record_audit(
            conn,
            actor,
            "project.export_download",
            target_type="project",
            target_id=key,
            project_id=project_id,
            details={"job_id": job_id, "kind": kind, "sha256": sha},
        )
        return response
