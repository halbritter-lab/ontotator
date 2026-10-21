"""Versioned project guidelines: upload, withdraw, read, notice (spec "Backend").

Leads and system admins publish and withdraw versions; every member reads
them and records their own reads. The task metadata carries the version in
force (``guideline_briefs``) and, for the owner of an editable task, the
update notice (``guideline_notice``).
"""

from __future__ import annotations

import unicodedata
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import Connection, Exists, delete, func, insert, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ontocurator.api.person_views import PersonRefView
from ontocurator.application.people import person_refs
from ontocurator.auth.audit import Actor, record_audit
from ontocurator.authz.policy import Access, Action, can
from ontocurator.authz.project_authority import require_project_management
from ontocurator.domain.errors import AccessDenied, DomainError
from ontocurator.domain.guidelines import (
    Notice,
    VersionFact,
    body_sha256,
    compute_notice,
    decode_body,
    kind_for_filename,
    validate_note,
)
from ontocurator.storage.database import Database, advisory_lock_id
from ontocurator.storage.guideline_tables import (
    GuidelineContentRow,
    GuidelineReadRow,
    GuidelineVersionRow,
    GuidelineWithdrawalRow,
)
from ontocurator.storage.tables import ProjectMembershipRow, ProjectRow, UserRow

TASK_ROLES = ("annotator", "adjudicator")


class GuidelineWithdrawalView(BaseModel):
    at: datetime
    by: PersonRefView
    reason: str | None


class GuidelineReachView(BaseModel):
    """Task members (annotator or adjudicator role) notified of / opening a version."""

    notified: int
    opened: int
    members: int


class GuidelineNotSeenView(BaseModel):
    person: PersonRefView
    notified: bool


class GuidelineSummary(BaseModel):
    """One version; ``reach`` and ``not_seen`` only for leads and admins."""

    version: int
    kind: Literal["markdown", "text"]
    filename: str | None
    size_bytes: int
    sha256: str
    change_note: str | None
    created_at: datetime
    created_by: PersonRefView
    withdrawn: GuidelineWithdrawalView | None = None
    reach: GuidelineReachView | None = None
    not_seen: list[GuidelineNotSeenView] | None = None


class GuidelineListing(BaseModel):
    current: GuidelineSummary | None
    latest_version: int | None
    versions: list[GuidelineSummary]
    my_latest_seen: int | None


class GuidelineDocument(GuidelineSummary):
    body: str | None


@dataclass(frozen=True)
class GuidelineBrief:
    version: int
    kind: str
    created_at: datetime


def _withdrawn_exists() -> Exists:
    return (
        select(GuidelineWithdrawalRow.version)
        .where(
            GuidelineWithdrawalRow.project_id == GuidelineVersionRow.project_id,
            GuidelineWithdrawalRow.version == GuidelineVersionRow.version,
        )
        .exists()
    )


def guideline_briefs(
    conn: Connection, project_ids: Iterable[int]
) -> dict[int, GuidelineBrief]:
    """The version in force per project, one query for all ids (G25)."""
    ids = set(project_ids)
    if not ids:
        return {}
    latest = (
        select(
            GuidelineVersionRow.project_id,
            func.max(GuidelineVersionRow.version).label("version"),
        )
        .where(GuidelineVersionRow.project_id.in_(ids))
        .group_by(GuidelineVersionRow.project_id)
        .subquery()
    )
    rows = conn.execute(
        select(
            GuidelineVersionRow.project_id,
            GuidelineVersionRow.version,
            GuidelineVersionRow.kind,
            GuidelineVersionRow.created_at,
        )
        .join(
            latest,
            (GuidelineVersionRow.project_id == latest.c.project_id)
            & (GuidelineVersionRow.version == latest.c.version),
        )
        .where(~_withdrawn_exists())
    )
    return {
        row.project_id: GuidelineBrief(row.version, row.kind, row.created_at)
        for row in rows
    }


def _version_facts(conn: Connection, project_id: int) -> list[VersionFact]:
    rows = conn.execute(
        select(
            GuidelineVersionRow.version,
            GuidelineVersionRow.created_at,
            GuidelineContentRow.change_note,
            _withdrawn_exists().label("withdrawn"),
        )
        .outerjoin(
            GuidelineContentRow,
            (GuidelineContentRow.project_id == GuidelineVersionRow.project_id)
            & (GuidelineContentRow.version == GuidelineVersionRow.version),
        )
        .where(GuidelineVersionRow.project_id == project_id)
    )
    return [
        VersionFact(
            version=row.version,
            created_at=row.created_at,
            change_note=row.change_note,
            withdrawn=bool(row.withdrawn),
        )
        for row in rows
    ]


def guideline_notice(
    conn: Connection, *, project_id: int, user_id: int
) -> Notice | None:
    """The update notice for the owner of an editable task (G17); callers filter.

    ``seen`` is the user's highest version they were notified of or opened.
    """
    seen = conn.execute(
        select(func.max(GuidelineReadRow.version)).where(
            GuidelineReadRow.project_id == project_id,
            GuidelineReadRow.user_id == user_id,
            (GuidelineReadRow.notified_at.is_not(None))
            | (GuidelineReadRow.opened_at.is_not(None)),
        )
    ).scalar_one()
    return compute_notice(_version_facts(conn, project_id), seen)


@dataclass(frozen=True)
class _Version:
    version: int
    kind: Literal["markdown", "text"]
    sha256: str
    size_bytes: int
    created_by: int
    created_at: datetime
    filename: str | None
    body: str | None
    change_note: str | None
    withdrawn_by: int | None
    withdrawn_at: datetime | None
    reason: str | None


def _versions(conn: Connection, project_id: int) -> list[_Version]:
    """Every version of the project, newest first, with contents or withdrawal."""
    rows = conn.execute(
        select(
            GuidelineVersionRow.version,
            GuidelineVersionRow.kind,
            GuidelineVersionRow.body_sha256,
            GuidelineVersionRow.size_bytes,
            GuidelineVersionRow.created_by,
            GuidelineVersionRow.created_at,
            GuidelineContentRow.filename,
            GuidelineContentRow.body,
            GuidelineContentRow.change_note,
            GuidelineWithdrawalRow.withdrawn_by,
            GuidelineWithdrawalRow.withdrawn_at,
            GuidelineWithdrawalRow.reason,
        )
        .outerjoin(
            GuidelineContentRow,
            (GuidelineContentRow.project_id == GuidelineVersionRow.project_id)
            & (GuidelineContentRow.version == GuidelineVersionRow.version),
        )
        .outerjoin(
            GuidelineWithdrawalRow,
            (GuidelineWithdrawalRow.project_id == GuidelineVersionRow.project_id)
            & (GuidelineWithdrawalRow.version == GuidelineVersionRow.version),
        )
        .where(GuidelineVersionRow.project_id == project_id)
        .order_by(GuidelineVersionRow.version.desc())
    )
    return [
        _Version(
            version=row.version,
            kind=row.kind,
            sha256=row.body_sha256,
            size_bytes=row.size_bytes,
            created_by=row.created_by,
            created_at=row.created_at,
            filename=row.filename,
            body=row.body,
            change_note=row.change_note,
            withdrawn_by=row.withdrawn_by,
            withdrawn_at=row.withdrawn_at,
            reason=row.reason,
        )
        for row in rows
    ]


def _current(versions: list[_Version]) -> int | None:
    """The version in force: the highest one unless it is withdrawn (G25)."""
    if not versions or versions[0].withdrawn_at is not None:
        return None
    return versions[0].version


class GuidelineService:
    def __init__(
        self, db: Database, now: Callable[[], datetime] = lambda: datetime.now(UTC)
    ) -> None:
        self.db = db
        self._now = now

    # Reading -----------------------------------------------------------------

    def listing(self, access: Access, key: str) -> GuidelineListing:
        with self.db.transaction() as conn:
            pid = self._visible_project(conn, access, key)
            versions = _versions(conn, pid)
            summaries = _summaries(
                conn,
                pid,
                versions,
                viewer_id=access.user_id,
                is_lead=can(access, Action.MANAGE_PROJECT_SETTINGS, key),
            )
            current = _current(versions)
            my_latest_seen = conn.execute(
                select(func.max(GuidelineReadRow.version)).where(
                    GuidelineReadRow.project_id == pid,
                    GuidelineReadRow.user_id == access.user_id,
                    GuidelineReadRow.opened_at.is_not(None),
                )
            ).scalar_one()
        return GuidelineListing(
            current=next((s for s in summaries if s.version == current), None),
            latest_version=versions[0].version if versions else None,
            versions=summaries,
            my_latest_seen=my_latest_seen,
        )

    def document(self, access: Access, key: str, version: int) -> GuidelineDocument:
        with self.db.transaction() as conn:
            pid = self._visible_project(conn, access, key)
            versions = [
                item for item in _versions(conn, pid) if item.version == version
            ]
            if not versions:
                raise DomainError("GUIDELINE_NOT_FOUND", {"version": version})
            (summary,) = _summaries(
                conn,
                pid,
                versions,
                viewer_id=access.user_id,
                is_lead=can(access, Action.MANAGE_PROJECT_SETTINGS, key),
                overview=False,
            )
        return GuidelineDocument(**dict(summary), body=versions[0].body)

    def record_read(
        self,
        access: Access,
        key: str,
        version: int,
        event: Literal["notified", "opened"],
    ) -> None:
        """Record the caller's own read; first time wins, withdrawn ones ignored."""
        with self.db.transaction() as conn:
            # Shared against withdraw's exclusive lock: no read on a version
            # being withdrawn.
            conn.execute(
                select(
                    func.pg_advisory_xact_lock_shared(advisory_lock_id("project", key))
                )
            )
            pid = self._visible_project(conn, access, key)
            exists = conn.execute(
                select(GuidelineVersionRow.version).where(
                    GuidelineVersionRow.project_id == pid,
                    GuidelineVersionRow.version == version,
                )
            ).first()
            if exists is None:
                raise DomainError("GUIDELINE_NOT_FOUND", {"version": version})
            withdrawn = conn.execute(
                select(GuidelineWithdrawalRow.version).where(
                    GuidelineWithdrawalRow.project_id == pid,
                    GuidelineWithdrawalRow.version == version,
                )
            ).first()
            if withdrawn is not None:
                return
            column = "notified_at" if event == "notified" else "opened_at"
            _mark_read(conn, pid, version, access.user_id, self._now(), (column,))

    # Changing ----------------------------------------------------------------

    def upload(
        self,
        actor: Actor,
        key: str,
        *,
        filename: str,
        data: bytes,
        change_note: str | None,
        expected_latest_version: int | None,
    ) -> GuidelineSummary:
        filename = _clean_filename(filename)
        kind = kind_for_filename(filename)
        body = decode_body(data)
        note = validate_note(change_note, field="change_note")
        sha256 = body_sha256(body)
        user_id = _user_id(actor)
        with self.db.transaction() as conn:
            pid = self._manage(conn, actor, key)
            versions = _versions(conn, pid)
            latest = versions[0].version if versions else None
            if expected_latest_version != latest:
                raise DomainError(
                    "GUIDELINE_VERSION_CONFLICT", {"latest_version": latest}
                )
            current = _current(versions)
            if current is not None and versions[0].sha256 == sha256:
                raise DomainError("GUIDELINE_UNCHANGED", {"version": current})
            version = (latest or 0) + 1
            size = len(body.encode("utf-8"))
            now = self._now()
            label = conn.execute(
                select(UserRow.pseudonym).where(UserRow.id == user_id)
            ).scalar_one()
            conn.execute(
                insert(GuidelineVersionRow).values(
                    project_id=pid,
                    version=version,
                    kind=kind,
                    body_sha256=sha256,
                    size_bytes=size,
                    created_by=user_id,
                    created_by_label=label,
                    created_at=now,
                )
            )
            conn.execute(
                insert(GuidelineContentRow).values(
                    project_id=pid,
                    version=version,
                    filename=filename,
                    body=body,
                    change_note=note,
                )
            )
            _mark_read(conn, pid, version, user_id, now, ("notified_at", "opened_at"))
            record_audit(
                conn,
                actor,
                "guideline.upload",
                target_type="guideline",
                target_id=f"{key}:v{version}",
                project_id=pid,
                details={
                    "version": version,
                    "kind": kind,
                    "size_bytes": size,
                    "sha256": sha256,
                    "previous_version": current,
                },
                at=now,
            )
            return _managed_summary(conn, pid, version, user_id)

    def withdraw(
        self,
        actor: Actor,
        key: str,
        version: int,
        *,
        reason: str | None,
        expected_latest_version: int,
    ) -> GuidelineSummary:
        user_id = _user_id(actor)
        with self.db.transaction() as conn:
            pid = self._manage(conn, actor, key)
            cleaned = validate_note(reason, field="reason")
            versions = _versions(conn, pid)
            latest = versions[0].version if versions else None
            if expected_latest_version != latest:
                raise DomainError(
                    "GUIDELINE_VERSION_CONFLICT", {"latest_version": latest}
                )
            target = next((item for item in versions if item.version == version), None)
            if target is None:
                raise DomainError("GUIDELINE_NOT_FOUND", {"version": version})
            if target.withdrawn_at is not None:
                raise DomainError("GUIDELINE_ALREADY_WITHDRAWN", {"version": version})
            now = self._now()
            label = conn.execute(
                select(UserRow.pseudonym).where(UserRow.id == user_id)
            ).scalar_one()
            conn.execute(
                delete(GuidelineContentRow).where(
                    GuidelineContentRow.project_id == pid,
                    GuidelineContentRow.version == version,
                )
            )
            conn.execute(
                insert(GuidelineWithdrawalRow).values(
                    project_id=pid,
                    version=version,
                    reason=cleaned,
                    withdrawn_by=user_id,
                    withdrawn_by_label=label,
                    withdrawn_at=now,
                )
            )
            record_audit(
                conn,
                actor,
                "guideline.withdraw",
                target_type="guideline",
                target_id=f"{key}:v{version}",
                project_id=pid,
                details={
                    "version": version,
                    "reason": cleaned,
                    "was_current": version == _current(versions),
                },
                at=now,
            )
            return _managed_summary(conn, pid, version, user_id)

    # Helpers -----------------------------------------------------------------

    @staticmethod
    def _project_id(conn: Connection, key: str) -> int:
        pid = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == key)
        ).scalar_one_or_none()
        if pid is None:
            raise DomainError("PROJECT_NOT_FOUND", f"There is no project '{key}'.")
        return int(pid)

    def _visible_project(self, conn: Connection, access: Access, key: str) -> int:
        if not can(access, Action.VIEW_PROJECT, key):
            raise DomainError("PROJECT_NOT_FOUND", f"There is no project '{key}'.")
        return self._project_id(conn, key)

    def _manage(self, conn: Connection, actor: Actor, key: str) -> int:
        """Locks as ``ProjectService.update_settings``, then fresh authority."""
        conn.execute(
            select(func.pg_advisory_xact_lock_shared(advisory_lock_id("members", key)))
        )
        conn.execute(
            select(func.pg_advisory_xact_lock(advisory_lock_id("project", key)))
        )
        pid = self._project_id(conn, key)
        require_project_management(
            conn, actor, key, pid, Action.MANAGE_PROJECT_SETTINGS
        )
        return pid


def _managed_summary(
    conn: Connection, pid: int, version: int, viewer_id: int
) -> GuidelineSummary:
    """The changed version as the managing lead sees it (with reach, not_seen)."""
    summaries = _summaries(
        conn, pid, _versions(conn, pid), viewer_id=viewer_id, is_lead=True
    )
    return next(item for item in summaries if item.version == version)


def _summaries(
    conn: Connection,
    pid: int,
    versions: list[_Version],
    *,
    viewer_id: int,
    is_lead: bool,
    overview: bool = True,
) -> list[GuidelineSummary]:
    """Summaries of ``versions`` (newest first); leads also get reach, not_seen.

    ``versions`` is the whole project's list unless ``overview`` is off.
    """
    overview = overview and is_lead
    current = _current(versions) if overview else None
    members: set[int] = set()
    reads: dict[int, dict[int, tuple[bool, bool]]] = {}
    if overview:
        members = set(
            conn.execute(
                select(ProjectMembershipRow.user_id)
                .join(UserRow, UserRow.id == ProjectMembershipRow.user_id)
                .where(
                    ProjectMembershipRow.project_id == pid,
                    ProjectMembershipRow.role.in_(TASK_ROLES),
                    UserRow.active.is_(True),
                )
            ).scalars()
        )
        for row in conn.execute(
            select(GuidelineReadRow).where(GuidelineReadRow.project_id == pid)
        ):
            if row.user_id in members:
                reads.setdefault(row.version, {})[row.user_id] = (
                    row.notified_at is not None,
                    row.opened_at is not None,
                )
    people = person_refs(
        conn,
        {
            *members,
            *(item.created_by for item in versions),
            *(item.withdrawn_by for item in versions if item.withdrawn_by),
        },
        viewer_id=viewer_id,
        viewer_is_lead=is_lead,
    )
    result = []
    for item in versions:
        withdrawn = (
            GuidelineWithdrawalView(
                at=item.withdrawn_at, by=people[item.withdrawn_by], reason=item.reason
            )
            if item.withdrawn_at is not None and item.withdrawn_by is not None
            else None
        )
        reach = not_seen = None
        if overview and withdrawn is None:
            marks = reads.get(item.version, {})
            reach = GuidelineReachView(
                notified=sum(1 for notified, _ in marks.values() if notified),
                opened=sum(1 for _, opened in marks.values() if opened),
                members=len(members),
            )
            if item.version == current:
                not_seen = sorted(
                    (
                        GuidelineNotSeenView(
                            person=people[uid],
                            notified=marks.get(uid, (False, False))[0],
                        )
                        for uid in members
                        if not marks.get(uid, (False, False))[1]
                    ),
                    key=lambda entry: (
                        (
                            entry.person.display_name or entry.person.pseudonym
                        ).casefold(),
                        entry.person.pseudonym,
                    ),
                )
        result.append(
            GuidelineSummary(
                version=item.version,
                kind=item.kind,
                filename=item.filename,
                size_bytes=item.size_bytes,
                sha256=item.sha256,
                change_note=item.change_note,
                created_at=item.created_at,
                created_by=people[item.created_by],
                withdrawn=withdrawn,
                reach=reach,
                not_seen=not_seen,
            )
        )
    return result


MAX_FILENAME_LENGTH = 255


def _clean_filename(filename: str) -> str:
    """The base name of an upload; control characters or overlong names refused."""
    name = filename.replace("\\", "/").rsplit("/", 1)[-1]
    if len(name) > MAX_FILENAME_LENGTH or any(
        unicodedata.category(char) == "Cc" for char in name
    ):
        raise DomainError(
            "GUIDELINE_FILE_TYPE", {"filename": name[:MAX_FILENAME_LENGTH]}
        )
    return name


def _user_id(actor: Actor) -> int:
    if actor.user_id is None:
        raise AccessDenied("NOT_ALLOWED", "Guidelines are published by a user.")
    return actor.user_id


def _mark_read(
    conn: Connection,
    project_id: int,
    version: int,
    user_id: int,
    at: datetime,
    columns: tuple[str, ...],
) -> None:
    """Upsert a read row; only a null timestamp is filled (first time wins)."""
    values = dict.fromkeys(columns, at)
    statement = pg_insert(GuidelineReadRow).values(
        project_id=project_id, version=version, user_id=user_id, **values
    )
    table = GuidelineReadRow.__table__
    conn.execute(
        statement.on_conflict_do_update(
            index_elements=["project_id", "version", "user_id"],
            set_={
                column: func.coalesce(table.c[column], statement.excluded[column])
                for column in columns
            },
        )
    )
