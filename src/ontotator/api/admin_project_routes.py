"""Projects in the administration (issue 191): delete a project without work."""

from fastapi import APIRouter, Request, Response

from ontotator.api.admin_routes import _admin_write
from ontotator.api.identity import PrincipalDep
from ontotator.auth.audit import Actor
from ontotator.exchange.jobs import unlink_deleted_files
from ontotator.storage.project_deletion import delete_empty_project

router = APIRouter(prefix="/api/v1/admin", tags=["admin-projects"])


@router.delete("/projects/{key}", status_code=204)
def delete_project(key: str, principal: PrincipalDep, request: Request) -> Response:
    """Delete a project nobody has worked in; its key is free again.

    Work is anything beyond the project's setup: texts, proposals, tasks,
    drafts, submissions, a guideline, results, problem reports, working time
    or an upload that committed. A project with work is refused with
    ``PROJECT_HAS_WORK`` (``details.work`` names the tables), a practice
    project with ``IS_A_PRACTICE_PROJECT``. The audit entries stay and name
    the project by key; the deletion is audited as ``project.delete``.
    """
    db = request.app.state.repo.db
    with _admin_write(principal, request), db.transaction() as conn:
        deleted = delete_empty_project(
            conn, Actor.user(principal.user_id, principal.username), key
        )
    unlink_deleted_files(db, deleted)
    return Response(status_code=204)
