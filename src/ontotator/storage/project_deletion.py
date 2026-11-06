"""Delete a project without work (issue 191).

An administrator may delete a project that was created by mistake, as long
as nobody worked in it: no texts, proposals, tasks, guideline, results or
any other work (the definition lives in the database function
``delete_empty_project``, migration 0037, so there is one). The key is free
again afterwards. The audit entries stay, detached from the project and
naming it by key; the deletion itself is recorded as ``project.delete``.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import Connection, func, select, text

from ontotator.auth.audit import Actor, record_audit
from ontotator.domain.errors import DomainError
from ontotator.storage.practice_store import _digests
from ontotator.storage.tables import ProjectRow


def delete_empty_project(conn: Connection, actor: Actor, project_key: str) -> list[str]:
    """Delete the project in the caller's transaction; the digests of the
    stored files that lost their last reference (``unlink_deleted_files``
    removes them after the commit).

    Raises:
        DomainError: ``PROJECT_NOT_FOUND``; ``IS_A_PRACTICE_PROJECT`` for a
            practice project (deleted with its own route);
            ``PROJECT_HAS_WORK`` with the tables that hold work.
    """
    from ontotator.exchange.jobs import delete_unreferenced_file
    from ontotator.storage.repository import _lock_id

    # The project lock first, as every write to the project takes it.
    conn.execute(select(func.pg_advisory_xact_lock(_lock_id("project", project_key))))
    row = conn.execute(
        select(ProjectRow.id, ProjectRow.name, ProjectRow.practice)
        .where(ProjectRow.project_key == project_key)
        .with_for_update()
    ).one_or_none()
    if row is None:
        raise DomainError("PROJECT_NOT_FOUND", f"There is no project '{project_key}'.")
    if row.practice:
        raise DomainError(
            "IS_A_PRACTICE_PROJECT",
            f"'{project_key}' is a practice project; delete it under practice"
            " projects.",
        )
    digests = _digests(conn, row.id)
    result: dict[str, Any] = conn.execute(
        text("SELECT ontotator.delete_empty_project(:pid)"), {"pid": row.id}
    ).scalar_one()
    if not result["deleted"]:
        raise DomainError("PROJECT_HAS_WORK", {"work": result["work"]})
    record_audit(
        conn,
        actor,
        "project.delete",
        target_type="project",
        target_id=project_key,
        details={
            "deleted_project_key": project_key,
            "name": row.name,
            "deleted_rows": result["rows"],
        },
    )
    return sorted(
        digest for digest in digests if delete_unreferenced_file(conn, digest)
    )
