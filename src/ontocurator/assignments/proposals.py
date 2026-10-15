"""Read-only distribution inputs and reproducible context; no assignment writers.

Members SHARED -> project EXCLUSIVE -> sorted member/actor SHARE locks keep
the batched READ COMMITTED reads coherent with administrative and work writers.
No audit, clock, generated identifier or timestamp participates in the snapshot.
"""

from __future__ import annotations

import hashlib
import json
import secrets
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from typing import Any, cast

from sqlalchemy import Connection, func, or_, select

from ontocurator.assignments.distribution import (
    Candidate,
    DistributionProposal,
    DocumentItem,
    propose_distribution,
)
from ontocurator.auth.audit import Actor
from ontocurator.authz.policy import TASK_ROLES, Access, Action, Role, Task, may_take
from ontocurator.authz.project_authority import require_project_management
from ontocurator.domain.errors import DomainError
from ontocurator.storage.database import Database
from ontocurator.storage.repository import _lock_id
from ontocurator.storage.tables import (
    AssignmentRow,
    DocumentRow,
    ProjectMembershipRow,
    ProjectRow,
    UserLanguageRow,
    UserRow,
)


@dataclass(frozen=True)
class SnapshotDocument:
    document_id: str
    position: int | None
    language: str
    text_sha256: str
    excluded_user_ids: tuple[int, ...]


@dataclass(frozen=True)
class SnapshotMember:
    user_id: int
    username: str
    display_name: str
    pseudonym: str
    active: bool
    is_system_admin: bool
    roles: tuple[Role, ...]
    languages: tuple[str, ...]
    load: int


@dataclass(frozen=True)
class DistributionSnapshot:
    project_key: str
    adjudicator_not_annotator: bool
    documents: tuple[SnapshotDocument, ...]
    members: tuple[SnapshotMember, ...]

    def as_dict(self) -> dict[str, Any]:
        """JSON-compatible full inputs, stable under unordered query results."""
        result = asdict(self)
        result["documents"] = [
            {**asdict(d), "excluded_user_ids": sorted(set(d.excluded_user_ids))}
            for d in sorted(
                self.documents,
                key=lambda d: (d.position is None, d.position or 0, d.document_id),
            )
        ]
        result["members"] = [
            {
                **asdict(m),
                "roles": sorted(set(m.roles)),
                "languages": sorted(set(m.languages)),
            }
            for m in sorted(self.members, key=lambda m: m.user_id)
        ]
        return result

    @property
    def state_sha256(self) -> str:
        payload = json.dumps(
            self.as_dict(), sort_keys=True, separators=(",", ":"), ensure_ascii=False
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class DistributionContext:
    document_ids: tuple[str, ...]
    task: Task
    per_document: int
    seed: int
    state_sha256: str


@dataclass(frozen=True)
class PreparedDistribution:
    context: DistributionContext
    snapshot: DistributionSnapshot
    proposal: DistributionProposal


def validate_selection(
    document_ids: Sequence[str], task: str, per_document: int, seed: int | None
) -> None:
    if (
        not document_ids
        or any(not isinstance(d, str) or not d.strip() for d in document_ids)
        or len(set(document_ids)) != len(document_ids)
    ):
        raise DomainError("DOCUMENT_SELECTION_INVALID")
    if task not in TASK_ROLES:
        raise DomainError("TASK_INVALID")
    if type(per_document) is not int or per_document < 1:
        raise DomainError("PER_DOCUMENT_INVALID")
    if seed is not None and type(seed) is not int:
        raise DomainError("SEED_INVALID")


def build_proposal(
    snapshot: DistributionSnapshot, *, task: Task, per_document: int, seed: int
) -> PreparedDistribution:
    documents = sorted(
        snapshot.documents,
        key=lambda d: (d.position is None, d.position or 0, d.document_id),
    )
    document_ids = tuple(d.document_id for d in documents)
    validate_selection(document_ids, task, per_document, seed)
    candidates = [
        Candidate(m.user_id, m.username, frozenset(m.languages), m.load)
        for m in snapshot.members
        if m.active
        and may_take(
            Access(
                m.user_id,
                m.pseudonym,
                m.is_system_admin,
                {snapshot.project_key: frozenset(m.roles)},
            ),
            snapshot.project_key,
            task,
        )
    ]
    proposal = propose_distribution(
        [
            DocumentItem(d.document_id, d.language, frozenset(d.excluded_user_ids))
            for d in documents
        ],
        candidates,
        per_document=per_document,
        seed=seed,
    )
    return PreparedDistribution(
        DistributionContext(
            document_ids, task, per_document, seed, snapshot.state_sha256
        ),
        snapshot,
        proposal,
    )


def require_fresh_context(
    context: DistributionContext, current: PreparedDistribution
) -> None:
    """Only server-derived current inputs establish freshness, never client input."""
    if context != current.context:
        raise DomainError("DISTRIBUTION_STALE")


class DistributionService:
    def __init__(self, db: Database) -> None:
        self.db = db

    @staticmethod
    def snapshot_on(
        conn: Connection,
        actor: Actor,
        key: str,
        document_ids: Sequence[str],
        task: Task,
    ) -> DistributionSnapshot:
        """Read current inputs under locks, without persisting any row.

        A confirmation caller must acquire its complete sorted actor/target set
        before entering here; this helper only reacquires compatible SHARE locks.
        Call outside a read-only Database.snapshot: PostgreSQL row locks require
        an ordinary transaction even though no data is written.
        """
        conn.execute(
            select(func.pg_advisory_xact_lock_shared(_lock_id("members", key)))
        )
        conn.execute(select(func.pg_advisory_xact_lock(_lock_id("project", key))))
        project = (
            conn.execute(select(ProjectRow).where(ProjectRow.project_key == key))
            .mappings()
            .one_or_none()
        )
        if project is None:
            raise DomainError("PROJECT_NOT_FOUND")
        project_id = project["id"]
        member_ids = select(ProjectMembershipRow.user_id).where(
            ProjectMembershipRow.project_id == project_id
        )
        # One ordered batch, not a user loop. Reacquiring actor SHARE through
        # the central helper below cannot acquire a previously unlocked actor.
        users = (
            conn.execute(
                select(UserRow)
                .where(or_(UserRow.id.in_(member_ids), UserRow.id == actor.user_id))
                .order_by(UserRow.id)
                .with_for_update(read=True)
            )
            .mappings()
            .all()
        )
        require_project_management(
            conn, actor, key, project_id, Action.MANAGE_ASSIGNMENTS
        )
        documents = (
            conn.execute(
                select(
                    DocumentRow.document_id,
                    DocumentRow.position,
                    DocumentRow.language,
                    DocumentRow.text_sha256,
                )
                .where(
                    DocumentRow.project_id == project_id,
                    DocumentRow.document_id.in_(document_ids),
                )
                .order_by(
                    DocumentRow.position.asc().nulls_last(), DocumentRow.document_id
                )
            )
            .mappings()
            .all()
        )
        if len(documents) != len(document_ids):
            # Never look up a missing ID in another project, or echo metadata.
            raise DomainError("DOCUMENT_NOT_FOUND")
        memberships: dict[int, list[Role]] = {}
        for user_id, role in conn.execute(
            select(ProjectMembershipRow.user_id, ProjectMembershipRow.role).where(
                ProjectMembershipRow.project_id == project_id
            )
        ):
            memberships.setdefault(user_id, []).append(cast(Role, role))
        languages: dict[int, list[str]] = {}
        for user_id, language in conn.execute(
            select(UserLanguageRow.user_id, UserLanguageRow.language).where(
                UserLanguageRow.user_id.in_(member_ids)
            )
        ):
            languages.setdefault(user_id, []).append(language)
        # Project-scoped and all task kinds; submitted/revoked rows add no load.
        loads: dict[int, int] = {
            user_id: load
            for user_id, load in conn.execute(
                select(AssignmentRow.user_id, func.count())
                .where(
                    AssignmentRow.project_id == project_id,
                    AssignmentRow.revoked_at.is_(None),
                    AssignmentRow.status.in_(("open", "in_progress", "reopened")),
                )
                .group_by(AssignmentRow.user_id)
            ).all()
        }
        exclusions: dict[str, set[int]] = {}
        exclusion_query = select(
            AssignmentRow.document_id, AssignmentRow.user_id
        ).where(
            AssignmentRow.project_id == project_id,
            AssignmentRow.document_id.in_(document_ids),
            AssignmentRow.revoked_at.is_(None),
        )
        if not project["adjudicator_not_annotator"]:
            exclusion_query = exclusion_query.where(AssignmentRow.task == task)
        for document_id, user_id in conn.execute(exclusion_query):
            exclusions.setdefault(document_id, set()).add(user_id)
        return DistributionSnapshot(
            key,
            project["adjudicator_not_annotator"],
            tuple(
                SnapshotDocument(
                    **d,
                    excluded_user_ids=tuple(
                        sorted(exclusions.get(d["document_id"], ()))
                    ),
                )
                for d in documents
            ),
            tuple(
                SnapshotMember(
                    u["id"],
                    u["username"],
                    u["display_name"],
                    u["pseudonym"],
                    u["active"],
                    u["is_system_admin"],
                    tuple(sorted(memberships[u["id"]])),
                    tuple(sorted(languages.get(u["id"], ()))),
                    loads.get(u["id"], 0),
                )
                for u in users
                if u["id"] in memberships
            ),
        )

    def propose(
        self,
        actor: Actor,
        key: str,
        document_ids: Sequence[str],
        task: Task,
        *,
        per_document: int = 1,
        seed: int | None = None,
    ) -> PreparedDistribution:
        validate_selection(document_ids, task, per_document, seed)
        chosen_seed = secrets.randbelow(2**31) if seed is None else seed
        with self.db.transaction() as conn:
            snapshot = self.snapshot_on(conn, actor, key, document_ids, task)
            return build_proposal(
                snapshot, task=task, per_document=per_document, seed=chosen_seed
            )

    def revalidate_on(
        self, conn: Connection, actor: Actor, key: str, context: DistributionContext
    ) -> PreparedDistribution:
        """Rebuild the original proposal before confirmation under caller locks."""
        validate_selection(
            context.document_ids, context.task, context.per_document, context.seed
        )
        try:
            snapshot = self.snapshot_on(
                conn, actor, key, context.document_ids, context.task
            )
        except DomainError as error:
            if error.code == "DOCUMENT_NOT_FOUND":
                raise DomainError("DISTRIBUTION_STALE") from error
            raise
        current = build_proposal(
            snapshot,
            task=context.task,
            per_document=context.per_document,
            seed=context.seed,
        )
        require_fresh_context(context, current)
        return current
