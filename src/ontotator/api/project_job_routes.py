"""The jobs of a project: imports and exports, newest first (issue 355).

A lost job ID can be found again and a failed export is visible. Leads and
system admins (and their tokens with ``read``) list the jobs; the download
itself stays on ``GET /api/v1/jobs/{job_id}/download`` with ``export``.
Who requested a job is a person reference (D1), never a login, as in the
project audit. Project archive jobs belong to the administration and are
not listed.
"""

from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel
from sqlalchemy import (
    ColumnElement,
    Row,
    Text,
    and_,
    case,
    false,
    func,
    or_,
    select,
)

from ontotator.api.identity import PrincipalDep
from ontotator.api.job_routes import ARCHIVE_JOB_KINDS, EXPORT_KINDS, authorized_project
from ontotator.api.person_views import PersonRefView
from ontotator.application.people import person_refs
from ontotator.auth.audit import Actor
from ontotator.authz.policy import Action
from ontotator.storage.tables import JobRow, UserRow

router = APIRouter(prefix="/api/v1/projects", tags=["jobs"])

JobState = Literal["queued", "running", "succeeded", "failed"]
MAX_LIMIT = 500
# Codes of failures that carry no domain code of their own.
INTERRUPTED = "JOB_INTERRUPTED"
INTERNAL = "INTERNAL_ERROR"


class ProjectJobView(BaseModel):
    """One job of the project.

    ``requested_by``: the person who started it; ``requested_by_command_line``
    when the admin command line did. ``error_code``: the failure's code, from
    the job's structured error or its error text (``JOB_INTERRUPTED`` when the
    server stopped while it ran, ``INTERNAL_ERROR`` for an unexpected error).
    ``download_path``: where to download the file of a finished export, when
    the file is there and the caller may download it (the ``export`` scope
    for a token).
    """

    id: int
    kind: str
    status: JobState
    requested_by: PersonRefView | None = None
    requested_by_command_line: bool = False
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    error: str | None
    error_code: str | None
    download_path: str | None = None


class ProjectJobPage(BaseModel):
    jobs: list[ProjectJobView]
    # Matching jobs in all; ``jobs`` is one page of them.
    total: int
    limit: int
    offset: int


def error_code() -> ColumnElement[str]:
    """The code of a failed job, as SQL: structured code, else from the text.

    The worker stores a domain error as ``<Class>: [CODE] details`` or
    ``<Class>: CODE`` (``ontotator.jobs.queue``).
    """
    text = JobRow.error
    return case(
        (JobRow.status != "failed", None),
        else_=func.coalesce(
            JobRow.result["error"]["code"].astext,
            func.substring(text, r"^\w+: \[([A-Z][A-Z0-9_]*)\]"),
            func.substring(text, r"^\w+: ([A-Z][A-Z0-9_]*)$"),
            case(
                (text.like("Interrupted:%"), INTERRUPTED),
                (text.like("%(details in the server log)"), INTERNAL),
                else_=None,
            ),
        ),
    ).cast(Text)


def _may_download(principal: PrincipalDep) -> bool:
    token = principal.token
    return token is None or "export" in token.scopes


@router.get("/{key}/jobs")
def project_jobs(
    key: str,
    request: Request,
    principal: PrincipalDep,
    kind: Annotated[
        list[str] | None, Query(description="Job kinds, e.g. 'final_t1_export'.")
    ] = None,
    status: Annotated[list[JobState] | None, Query()] = None,
    requester: Annotated[
        str | None, Query(description="The requester's pseudonym or login.")
    ] = None,
    error_code_filter: Annotated[
        str | None,
        Query(alias="error_code", description="Only failed jobs with this code."),
    ] = None,
    since: Annotated[datetime | None, Query(description="Created from.")] = None,
    until: Annotated[
        datetime | None, Query(description="Created before (exclusive).")
    ] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ProjectJobPage:
    """The project's import and export jobs, newest first (leads and system admins)."""
    actor = Actor.user(principal.user_id, principal.username)
    db = request.app.state.repo.db
    code = error_code().label("error_code")
    with db.transaction() as conn:
        project_id = authorized_project(
            conn, key, actor, Action.VIEW_PROGRESS, structure=False
        )
        where: list[ColumnElement[bool]] = [
            JobRow.project_id == project_id,
            JobRow.kind.not_in(ARCHIVE_JOB_KINDS),
        ]
        if kind:
            where.append(JobRow.kind.in_(kind))
        if status:
            where.append(JobRow.status.in_(status))
        if requester is not None:
            wanted = requester.strip()
            ids = (
                conn.execute(
                    select(UserRow.id).where(
                        or_(
                            UserRow.pseudonym == wanted,
                            UserRow.username == wanted.lower(),
                        )
                    )
                )
                .scalars()
                .all()
            )
            where.append(JobRow.requested_by.in_(ids) if ids else false())
        if error_code_filter is not None:
            where.append(error_code() == error_code_filter)
        if since is not None:
            where.append(JobRow.created_at >= since)
        if until is not None:
            where.append(JobRow.created_at < until)
        condition = and_(*where)
        total = conn.execute(
            select(func.count()).select_from(JobRow).where(condition)
        ).scalar_one()
        rows = conn.execute(
            select(
                JobRow.id,
                JobRow.kind,
                JobRow.status,
                JobRow.requested_by,
                JobRow.requested_label,
                JobRow.created_at,
                JobRow.started_at,
                JobRow.finished_at,
                JobRow.error,
                JobRow.result,
                JobRow.payload["project"].astext.label("payload_project"),
                code,
            )
            .where(condition)
            .order_by(JobRow.created_at.desc(), JobRow.id.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        people = person_refs(
            conn,
            [row.requested_by for row in rows if row.requested_by is not None],
            viewer_id=principal.user_id,
            viewer_is_lead=True,
        )
    downloads = _may_download(principal)

    def download_path(row: Row[Any]) -> str | None:
        # The same conditions as the download route, but for the right: a
        # lead and a system admin hold every export right of the project.
        if not downloads or row.kind not in EXPORT_KINDS:
            return None
        result = row.result
        if (
            row.status != "succeeded"
            or row.finished_at is None
            or row.payload_project != key
            or not isinstance(result, dict)
            or not isinstance(result.get("sha256"), str)
        ):
            return None
        try:
            if not db.blobs.path(result["sha256"]).is_file():
                return None
        except (ValueError, OSError):
            return None
        return f"/api/v1/jobs/{row.id}/download"

    return ProjectJobPage(
        jobs=[
            ProjectJobView(
                id=row.id,
                kind=row.kind,
                status=row.status,
                requested_by=people.get(row.requested_by)
                if row.requested_by is not None
                else None,
                requested_by_command_line=row.requested_by is None
                and row.requested_label.startswith("cli:"),
                created_at=row.created_at,
                started_at=row.started_at,
                finished_at=row.finished_at,
                error=row.error,
                error_code=row.error_code,
                download_path=download_path(row),
            )
            for row in rows
        ],
        total=total,
        limit=limit,
        offset=offset,
    )
