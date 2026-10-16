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
    Unassignable,
    propose_distribution,
)
from ontocurator.assignments.eligibility import (
    VARIANT_COLUMNS,
    check_variant_assignable,
    conflicting_tasks,
)
from ontocurator.auth.audit import Actor
from ontocurator.authz.policy import (
    ADMINISTRATION_TASKS,
    Access,
    Action,
    Role,
    Task,
    may_take,
)
from ontocurator.authz.project_authority import require_project_management
from ontocurator.domain.errors import DomainError
from ontocurator.domain.variants import VariantInfo
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
    variant: VariantInfo | None = None
    required_languages: tuple[str, ...] = ()
    refusal_reason: str | None = None


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
    annotate_accepted_translations_only: bool = True
    variants: tuple[VariantInfo, ...] = ()

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
        # Nested dataclass tuples must match their persisted JSON array form;
        # json.dumps already used that same representation for the state hash.
        return cast(dict[str, Any], json.loads(json.dumps(result, ensure_ascii=False)))

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
    if task not in ADMINISTRATION_TASKS:
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
    language_requirements = {
        d.document_id: frozenset(d.required_languages or (d.language,))
        for d in documents
    }
    proposal = propose_distribution(
        [
            DocumentItem(d.document_id, d.language, frozenset(d.excluded_user_ids))
            for d in documents
            if d.refusal_reason is None
        ],
        candidates,
        per_document=per_document,
        seed=seed,
        required_languages=lambda item: language_requirements[item.document_id],
    )
    unassignable = {item.document_id: item for item in proposal.unassignable}
    for d in documents:
        if d.refusal_reason is not None:
            unassignable[d.document_id] = Unassignable(
                d.document_id, d.refusal_reason, 0
            )
    proposal = DistributionProposal(
        proposal.rows,
        tuple(
            unassignable[d.document_id]
            for d in documents
            if d.document_id in unassignable
        ),
        seed,
        per_document,
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
        inventory = (
            conn.execute(
                select(*VARIANT_COLUMNS, DocumentRow.position)
                .where(DocumentRow.project_id == project_id)
                .order_by(
                    DocumentRow.position.asc().nulls_last(), DocumentRow.document_id
                )
            )
            .mappings()
            .all()
        )
        variants = {
            row["document_id"]: VariantInfo(
                **{name: row[name] for name in VariantInfo.__dataclass_fields__}
            )
            for row in inventory
        }
        selected = set(document_ids)
        documents = [
            {
                name: row[name]
                for name in ("document_id", "position", "language", "text_sha256")
            }
            for row in inventory
            if row["document_id"] in selected
        ]
        if len(documents) != len(document_ids):
            # Never look up a missing ID in another project, or echo metadata.
            raise DomainError("DOCUMENT_NOT_FOUND")
        eligibility: dict[str, tuple[tuple[str, ...], str | None]] = {}
        for d in documents:
            try:
                needed = check_variant_assignable(
                    project, variants[d["document_id"]], task, variants.get
                )
                eligibility[d["document_id"]] = (tuple(sorted(needed)), None)
            except DomainError as error:
                reasons = {
                    "TRANSLATION_NOT_ACCEPTED": "translation_not_accepted",
                    "NOT_A_TRANSLATION": "not_a_translation",
                    "VARIANT_SOURCE_UNKNOWN": "variant_source_unknown",
                }
                if error.code not in reasons:
                    raise
                reason = reasons[error.code]
                if error.code == "NOT_A_TRANSLATION" and isinstance(
                    error.details, dict
                ):
                    reason = error.details.get("reason", reason)
                eligibility[d["document_id"]] = ((), reason)
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
        excluded_tasks = {task} | (
            set(conflicting_tasks(task))
            if project["adjudicator_not_annotator"]
            else set()
        )
        exclusion_query = exclusion_query.where(AssignmentRow.task.in_(excluded_tasks))
        for document_id, user_id in conn.execute(exclusion_query):
            exclusions.setdefault(document_id, set()).add(user_id)
        return DistributionSnapshot(
            key,
            project["adjudicator_not_annotator"],
            tuple(
                SnapshotDocument(
                    **d,
                    variant=variants[d["document_id"]],
                    required_languages=eligibility[d["document_id"]][0],
                    refusal_reason=eligibility[d["document_id"]][1],
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
            project["annotate_accepted_translations_only"],
            tuple(variants[key] for key in sorted(variants)),
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
