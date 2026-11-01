"""Practice projects in the database (issue 266): lookups and the purge.

A practice project is a project with ``projects.practice`` set and one
``practice_projects`` row naming its owner. Real-project queries leave these
projects out with ``REAL_PROJECT``. Deleting one goes through the database
function ``delete_practice_project`` (migration 0028), which refuses any
project that is not flagged practice; this module checks the flag first as
well, so a real project is refused twice before anything is deleted.
"""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import Connection, func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ontotator.auth.audit import Actor, record_audit
from ontotator.domain.errors import DomainError
from ontotator.storage.tables import (
    InstanceStateRow,
    JobRow,
    PracticeProjectRow,
    ProjectResourceRow,
    ProjectRow,
    ProposalSetRow,
    UploadRow,
)

# Real projects only: every listing, count and export of projects uses it.
REAL_PROJECT = ProjectRow.practice.is_(False)
OFFER_KEY = "practice_projects"
COLLEAGUES_KEY = "practice_colleagues"
_DIGEST = re.compile(r"\b[0-9a-f]{64}\b")


def offer_enabled(conn: Connection) -> bool:
    """Whether practice projects are offered (admin setting, default on)."""
    value = conn.execute(
        select(InstanceStateRow.value).where(InstanceStateRow.key == OFFER_KEY)
    ).scalar_one_or_none()
    return not (isinstance(value, dict) and value.get("offer") is False)


def set_offer(conn: Connection, actor: Actor, offer: bool) -> None:
    conn.execute(
        pg_insert(InstanceStateRow)
        .values(key=OFFER_KEY, value={"offer": offer})
        .on_conflict_do_update(
            index_elements=[InstanceStateRow.key],
            set_={"value": {"offer": offer}, "updated_at": func.now()},
        )
    )
    record_audit(
        conn,
        actor,
        "practice.offer",
        target_type="instance",
        target_id=OFFER_KEY,
        details={"offer": offer, "practice": True},
    )


def colleague_ids(conn: Connection) -> set[int]:
    """The accounts of the virtual colleagues (never listed as people)."""
    value = conn.execute(
        select(InstanceStateRow.value).where(InstanceStateRow.key == COLLEAGUES_KEY)
    ).scalar_one_or_none()
    if not isinstance(value, list):
        return set()
    return {int(item) for item in value if isinstance(item, int)}


def save_colleague_ids(conn: Connection, ids: list[int]) -> None:
    conn.execute(
        pg_insert(InstanceStateRow)
        .values(key=COLLEAGUES_KEY, value=ids)
        .on_conflict_do_update(
            index_elements=[InstanceStateRow.key],
            set_={"value": ids, "updated_at": func.now()},
        )
    )


def is_practice(conn: Connection, project_id: int) -> bool:
    return bool(
        conn.execute(
            select(ProjectRow.practice).where(ProjectRow.id == project_id)
        ).scalar_one_or_none()
    )


def practice_keys(conn: Connection) -> frozenset[str]:
    return frozenset(
        conn.execute(
            select(ProjectRow.project_key).where(ProjectRow.practice.is_(True))
        ).scalars()
    )


def _digests(conn: Connection, project_id: int) -> set[str]:
    """Stored files the project's rows refer to (bundle, exports, ...)."""
    found: set[str] = set()
    for payload, result in conn.execute(
        select(JobRow.payload, JobRow.result).where(JobRow.project_id == project_id)
    ):
        found.update(_DIGEST.findall(f"{payload} {result}"))
    for files in conn.execute(
        select(UploadRow.files).where(UploadRow.project_id == project_id)
    ).scalars():
        found.update(_DIGEST.findall(str(files)))
    found.update(
        digest
        for digest in conn.execute(
            select(ProposalSetRow.source_sha256).where(
                ProposalSetRow.project_id == project_id
            )
        ).scalars()
        if digest
    )
    found.update(
        conn.execute(
            select(ProjectResourceRow.sha256).where(
                ProjectResourceRow.project_id == project_id
            )
        ).scalars()
    )
    return found


def purge_practice_project(
    conn: Connection, actor: Actor, project_key: str, *, reason: str
) -> list[str]:
    """Delete one practice project with all its rows, in the caller's
    transaction; the digests of the stored files that lost their last
    reference (``unlink_deleted_files`` removes them after the commit).

    The audit entries stay, detached from the project and marked practice.

    Raises:
        DomainError: ``PROJECT_NOT_FOUND``; ``NOT_A_PRACTICE_PROJECT`` for a
            real project (the database function refuses it as well).
    """
    from ontotator.exchange.jobs import delete_unreferenced_file
    from ontotator.storage.repository import _lock_id

    conn.execute(select(func.pg_advisory_xact_lock(_lock_id("project", project_key))))
    row = conn.execute(
        select(ProjectRow.id, ProjectRow.practice, PracticeProjectRow.user_id)
        .outerjoin(PracticeProjectRow, PracticeProjectRow.project_id == ProjectRow.id)
        .where(ProjectRow.project_key == project_key)
        .with_for_update(of=ProjectRow)
    ).one_or_none()
    if row is None:
        raise DomainError("PROJECT_NOT_FOUND", f"There is no project '{project_key}'.")
    if not row.practice:
        raise DomainError(
            "NOT_A_PRACTICE_PROJECT",
            f"'{project_key}' is not a practice project; only practice projects"
            " can be deleted.",
        )
    digests = _digests(conn, row.id)
    record_audit(
        conn,
        actor,
        "practice.delete",
        target_type="project",
        target_id=project_key,
        project_id=row.id,
        details={"reason": reason, "owner_user_id": row.user_id},
    )
    counts: Any = conn.execute(
        text("SELECT ontotator.delete_practice_project(:pid)"), {"pid": row.id}
    ).scalar_one()
    del counts
    return sorted(
        digest for digest in digests if delete_unreferenced_file(conn, digest)
    )


def practice_project_of(conn: Connection, user_id: int) -> str | None:
    """The key of the user's practice project, if any."""
    return conn.execute(
        select(ProjectRow.project_key)
        .join(PracticeProjectRow, PracticeProjectRow.project_id == ProjectRow.id)
        .where(PracticeProjectRow.user_id == user_id)
    ).scalar_one_or_none()


def purge_practice_of_user(
    conn: Connection, actor: Actor, user_id: int, reason: str
) -> list[str]:
    """Delete the user's practice project, if any (deactivation, erasure)."""
    key = practice_project_of(conn, user_id)
    if key is None:
        return []
    return purge_practice_project(conn, actor, key, reason=reason)
