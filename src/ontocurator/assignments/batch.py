"""Batch assignment of a planned step to one person or split evenly (D21).

The preview and the selection summary read the Documents facts (one loader,
one next-step derivation) and match a row to a task when ANY of its steps is
that task's assign step. The commit takes the same locks as a distribution
confirmation, recomputes the preview, compares its digest and assigns every
row with ``AssignmentService._assign_locked``; one refusal rolls back all.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, cast

from sqlalchemy import Connection, func, or_, select

from ontocurator.application import document_row_keys
from ontocurator.application import document_row_page as page
from ontocurator.application.document_rows import RowFacts, RowQuery, load_facts
from ontocurator.application.people import person_refs
from ontocurator.assignments.eligibility import load_variants, required_languages
from ontocurator.assignments.service import (
    Assignment,
    AssignmentService,
    enable_source_change_review,
    source_obligation_documents,
)
from ontocurator.auth.accounts import normalize_username
from ontocurator.auth.audit import Actor
from ontocurator.authz.policy import (
    TASK_ROLES,
    Access,
    Action,
    AssignableTask,
    Role,
    Task,
)
from ontocurator.authz.project_authority import require_project_management
from ontocurator.authz.scoped import ScopedRepository
from ontocurator.domain import document_rows as rules
from ontocurator.domain.batch_layout import TooFewPeople, layout
from ontocurator.domain.errors import DomainError
from ontocurator.domain.next_steps import REVIEWER_NEEDED_STATUSES
from ontocurator.domain.work_plans import RowKey
from ontocurator.storage import work_plan_store
from ontocurator.storage.database import Database
from ontocurator.storage.repository import _lock_id
from ontocurator.storage.tables import (
    AssignmentRow,
    ProjectMembershipRow,
    ProjectRow,
    UserLanguageRow,
    UserRow,
)

Mode = Literal["one", "split"]
SkipReason = Literal[
    "waiting_for_review",
    "not_in_plan",
    "already_assigned",
    "step_differs",
    "discarded",
]
Unavailable = Literal["does_not_read", "role_missing", "inactive"]

# The assign step of a task in the next-step derivation (rules 6 and 8).
ASSIGN_STEPS: dict[Task, str] = {
    "translation_review": "assign_translation_review",
    "annotate": "assign_annotation",
}
# Steps of a row whose translation review still runs or is still to come
# (also Progress "Waiting for review").
WAITING_FOR_REVIEW_STEPS = frozenset(
    {"translation_review_in_progress", "waiting_for_translation_review"}
)
# D25: acceptances whose translation may get a new review.
_REVIEWABLE_ACCEPTANCES = frozenset({"lead", "override"})


@dataclass(frozen=True)
class BatchSpec:
    task: AssignableTask
    language: str
    case_ids: tuple[str, ...]
    mode: Mode
    usernames: tuple[str, ...] = ()
    sort: str = "case"
    review_accepted_translation: bool = False
    # VD14: translation reviews of versions whose source text changed.
    review_reason: Literal["source_changed"] | None = None
    # Row-level selection (VD21): only these texts; replaces ``case_ids``.
    # Texts of another language than ``language`` are not targeted.
    rows: tuple[RowKey, ...] = ()

    def selected_cases(self) -> tuple[str, ...]:
        """The cases the batch looks at: with ``rows`` the cases of the
        selected texts in ``language``, else ``case_ids``."""
        if not self.rows:
            return self.case_ids
        return tuple(
            dict.fromkeys(
                row.case_id for row in self.rows if row.language == self.language
            )
        )


@dataclass
class _Target:
    case_id: str
    language: str
    document_id: str
    version: int
    remaining: int
    holders: frozenset[str]  # usernames holding the task on this version
    accepted_review: bool  # D25: Review is turned on at commit
    # VD14: a source-change review; the obligation is rechecked at commit.
    source_review: bool = False
    usernames: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class _Match:
    targets: tuple[_Target, ...]
    reason: SkipReason | None
    holders: frozenset[str]  # usernames holding the task on the row


@dataclass(frozen=True)
class _Batch:
    view: dict[str, Any]
    targets: tuple[_Target, ...]
    digest: str
    needs_people: int | None  # layout refused: too few people chosen


def _open(item: rules.AssignmentFact) -> bool:
    """An open task: not revoked, and not submitted or paused (held)."""
    return not item.revoked and (item.status != "submitted" or item.held)


def open_task_counts(
    conn: Connection, project_id: int, user_ids: Iterable[int]
) -> dict[int, Counter[str]]:
    """Open tasks (as ``_open``) per user and task in project ``project_id``.

    The one count of "open tasks" for the members list and the batch people.
    """
    wanted = list(user_ids)
    counts: dict[int, Counter[str]] = {user_id: Counter() for user_id in wanted}
    if not wanted:
        return counts
    for user_id, task, count in conn.execute(
        select(AssignmentRow.user_id, AssignmentRow.task, func.count())
        .where(
            AssignmentRow.project_id == project_id,
            AssignmentRow.user_id.in_(wanted),
            AssignmentRow.revoked_at.is_(None),
            or_(AssignmentRow.status != "submitted", AssignmentRow.held),
        )
        .group_by(AssignmentRow.user_id, AssignmentRow.task)
    ).tuples():
        counts[user_id][task] = count
    return counts


class _Rows:
    """Rows of one project state, matched against assign tasks."""

    def __init__(self, conn: Connection, pid: int, facts: RowFacts) -> None:
        self.facts = facts
        self.acceptances = work_plan_store.acceptances(conn, pid)
        self.ctx = page.row_context(facts)
        self.rows = self.ctx.rows
        # D25 (``enable_review_for_accepted``): a version with a correction
        # derived from it never gets a new review.
        self.corrected = frozenset(
            v.derived_from
            for v in facts.versions
            if v.origin == "correction" and v.derived_from is not None
        )
        users = {item.user_id for item in facts.assignments}
        self.username_of: dict[int, str] = (
            {
                row.id: row.username
                for row in conn.execute(
                    select(UserRow.id, UserRow.username).where(UserRow.id.in_(users))
                )
            }
            if users
            else {}
        )

    def languages_of(self, case_id: str) -> list[str]:
        return sorted(lang for case, lang in self.rows if case == case_id)

    def _newest(self, key: tuple[str, str]) -> list[rules.Version]:
        """Newest version of every root that is not discarded."""
        dropped = self.ctx.discarded
        chains = rules.build_chains(self.ctx.versions[key])
        return [
            [v for v in chain.versions if not v.not_newer][-1]
            for chain in chains
            if not any(v.document_id in dropped for v in chain.versions)
        ]

    def _work(self, document_id: str, task: Task) -> list[rules.AssignmentFact]:
        return [
            item
            for item in self.ctx.assignments.get(document_id, [])
            if item.task == task and not item.revoked
        ]

    def _target(
        self,
        version: rules.Version,
        task: Task,
        *,
        accepted_review: bool = False,
        source_review: bool = False,
    ) -> _Target:
        work = self._work(version.document_id, task)
        if task == "annotate":
            remaining = self.facts.annotations_per_text - len(work)
        else:
            remaining = 0 if any(_open(item) for item in work) else 1
        return _Target(
            case_id=version.case_id,
            language=version.language,
            document_id=version.document_id,
            version=version.version,
            remaining=max(remaining, 0),
            holders=frozenset(self.username_of.get(i.user_id, "") for i in work),
            accepted_review=accepted_review,
            source_review=source_review,
        )

    def match(
        self,
        case_id: str,
        language: str,
        task: Task,
        *,
        accepted_review: bool,
        source_review: bool = False,
    ) -> _Match:
        key = (case_id, language)
        row = self.rows.get(key)
        if row is None:  # unknown case IDs and languages, too
            return _Match((), "not_in_plan", frozenset())
        newest = self._newest(key)
        holders = frozenset(
            self.username_of.get(item.user_id, "")
            for version in newest
            for item in self._work(version.document_id, task)
        )
        if row["plan_row"]["discarded"]:
            return _Match((), "discarded", holders)
        review, annotate = self.ctx.flags[key]
        codes = {step["code"] for step in row["steps"]}
        candidates: list[_Target] = []
        if task == "translation_review":
            # The predicate of ``enable_review_for_accepted`` (D25).
            external = (
                [
                    self._target(v, task, accepted_review=True)
                    for v in newest
                    if v.translation_status == "accepted"
                    and self.acceptances.get(v.document_id, {}).get("source")
                    in _REVIEWABLE_ACCEPTANCES
                    and v.document_id not in self.corrected
                ]
                if accepted_review and row["in_plan"]
                else []
            )
            # VD14: versions with an unresolved source-change obligation
            # (only a newest translation version has one).
            changed = (
                [
                    self._target(v, task, source_review=True)
                    for v in newest
                    if v.document_id in self.facts.source_obligations
                    and all(t.document_id != v.document_id for t in external)
                ]
                if source_review and (review or row["in_plan"])
                else []
            )
            # A source-change review of a version without an unresolved
            # obligation is skipped as ``step_differs`` here, while the
            # single assignment refuses it (``SOURCE_REVIEW_NOT_NEEDED``);
            # a skip reason of its own would change the API contract.
            if not review and not external and not changed:
                # In the plan (Annotate on), e.g. package-accepted: its step
                # is not a translation review.
                reason: SkipReason = "step_differs" if row["in_plan"] else "not_in_plan"
                return _Match((), reason, holders)
            if review and ASSIGN_STEPS[task] in codes:
                candidates = [
                    self._target(v, task)
                    for v in newest
                    if v.translation_status is None
                    or v.translation_status in REVIEWER_NEEDED_STATUSES
                ]
            candidates += external
            known = {t.document_id for t in candidates}
            candidates += [t for t in changed if t.document_id not in known]
        else:
            if not annotate:
                return _Match((), "not_in_plan", holders)
            if ASSIGN_STEPS[task] in codes:
                candidates = [self._target(v, task) for v in newest]
        targets = tuple(t for t in candidates if t.remaining > 0)
        if targets:
            return _Match(targets, None, holders)
        if task != "translation_review" and codes & WAITING_FOR_REVIEW_STEPS:
            return _Match((), "waiting_for_review", holders)
        if candidates or any(
            _open(item)
            for version in newest
            for item in self._work(version.document_id, task)
        ):
            return _Match((), "already_assigned", holders)
        return _Match((), "step_differs", holders)


def _digest(payload: Mapping[str, Any]) -> str:
    text = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode()).hexdigest()


class BatchAssignmentService:
    def __init__(self, db: Database, actor: Actor, access: Access) -> None:
        self.db, self.actor, self.access = db, actor, access
        self.repo = ScopedRepository(db, access, actor)

    # -- reads -------------------------------------------------------------

    def _authorize(self, conn: Connection, key: str) -> int:
        conn.execute(
            select(func.pg_advisory_xact_lock_shared(_lock_id("members", key)))
        )
        conn.execute(
            select(func.pg_advisory_xact_lock_shared(_lock_id("project", key)))
        )
        pid = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == key)
        ).scalar_one_or_none()
        if pid is None:
            raise DomainError("PROJECT_NOT_FOUND", f"There is no project '{key}'.")
        require_project_management(
            conn, self.actor, key, pid, Action.MANAGE_ASSIGNMENTS
        )
        return int(pid)

    def _rows(self, conn: Connection, key: str, pid: int) -> _Rows:
        facts = load_facts(conn, self.repo, key, pid, self.access.user_id)
        return _Rows(conn, pid, facts)

    def preview(self, key: str, spec: BatchSpec) -> dict[str, Any]:
        with self.db.transaction() as conn:
            pid = self._authorize(conn, key)
            return self._batch(conn, key, pid, spec).view

    def selection_summary(
        self,
        key: str,
        case_ids: Sequence[str],
        query: RowQuery,
        rows: Sequence[RowKey] = (),
    ) -> dict[str, Any]:
        """Assignable steps of the selection: whole cases (``case_ids``) or
        single texts (``rows``, VD21: only these texts count, ``skipped``,
        ``skipped_rows`` and ``not_shown`` count texts)."""
        with self.db.transaction() as conn:
            pid = self._authorize(conn, key)
            facts = load_facts(conn, self.repo, key, pid, self.access.user_id)
            matcher = _Rows(conn, pid, facts)
        texts = list(dict.fromkeys((row.case_id, row.language) for row in rows))
        selected = (
            list(dict.fromkeys(case_id for case_id, _ in texts))
            if texts
            else list(dict.fromkeys(case_ids))
        )
        candidates = texts or [
            (case_id, language)
            for case_id in selected
            for language in matcher.languages_of(case_id)
        ]
        counts: dict[tuple[Task, str], list[int]] = {}
        for case_id, language in candidates:
            for task in ASSIGN_STEPS:
                match = matcher.match(case_id, language, task, accepted_review=False)
                if match.targets:
                    entry = counts.setdefault((task, language), [0, 0])
                    entry[0] += len(match.targets)
                    entry[1] += 1
        steps: list[dict[str, Any]] = [
            {"task": task, "language": language, "versions": v, "cases": c}
            for (task, language), (v, c) in sorted(
                counts.items(), key=lambda item: (-item[1][0], -item[1][1], item[0])
            )
        ]
        common = steps[0] if steps else None
        skipped: Counter[str] = Counter()
        skipped_rows: list[dict[str, str]] = []
        if common is not None:
            reach = (
                [text for text in texts if text[1] == common["language"]]
                if texts
                else [(case_id, common["language"]) for case_id in selected]
            )
            for case_id, language in reach:
                match = matcher.match(
                    case_id, language, cast(Task, common["task"]), accepted_review=False
                )
                if match.reason is not None:
                    skipped[match.reason] += 1
                    if texts:
                        skipped_rows.append({"case_id": case_id, "language": language})
        ctx = matcher.ctx
        not_shown = (
            sum(
                1
                for text in texts
                if text not in ctx.rows
                or not page.row_matches(ctx, ctx.rows[text], query)
            )
            if texts
            else ctx.cases_not_shown(selected, query)
        )
        cases = (
            len({text[0] for text in texts if text in ctx.rows})
            if texts
            else len(selected)
        )
        return {
            "cases": cases,
            "steps": steps,
            "skipped": dict(skipped),
            "skipped_rows": skipped_rows,
            "common": common,
            "not_shown": not_shown,
        }

    def row_keys(
        self, key: str, query: RowQuery, case_ids: Sequence[str] = ()
    ) -> dict[str, Any]:
        """Text keys matching ``query`` in list order (``document_row_keys``)."""
        with self.db.transaction() as conn:
            pid = self._authorize(conn, key)
            facts = load_facts(conn, self.repo, key, pid, self.access.user_id)
        found, cases, total, truncated = document_row_keys.row_keys(
            page.row_context(facts), query, case_ids, facts=facts
        )
        return {
            "keys": [{"case_id": k.case_id, "language": k.language} for k in found],
            "cases": cases,
            "total": total,
            "truncated": truncated,
        }

    # -- the batch ----------------------------------------------------------

    def _members(self, conn: Connection, pid: int) -> list[dict[str, Any]]:
        members: dict[int, dict[str, Any]] = {}
        for row in conn.execute(
            select(
                UserRow.id,
                UserRow.username,
                UserRow.active,
                ProjectMembershipRow.role,
            )
            .join(ProjectMembershipRow, ProjectMembershipRow.user_id == UserRow.id)
            .where(ProjectMembershipRow.project_id == pid)
        ):
            member = members.setdefault(
                row.id,
                {
                    "user_id": row.id,
                    "username": row.username,
                    "active": row.active,
                    "roles": set(),
                    "reads": [],
                },
            )
            member["roles"].add(row.role)
        if members:
            for user_id, language in conn.execute(
                select(UserLanguageRow.user_id, UserLanguageRow.language)
                .where(UserLanguageRow.user_id.in_(members))
                .order_by(UserLanguageRow.language)
            ):
                members[user_id]["reads"].append(language)
        return list(members.values())

    @staticmethod
    def _names(conn: Connection, usernames: Iterable[str]) -> list[str]:
        names = list(dict.fromkeys(normalize_username(name) for name in usernames))
        if names:
            known = set(
                conn.execute(
                    select(UserRow.username).where(UserRow.username.in_(names))
                ).scalars()
            )
            for name in names:
                if name not in known:
                    raise DomainError("USER_NOT_FOUND", f"There is no user '{name}'.")
        return names

    def _batch(self, conn: Connection, key: str, pid: int, spec: BatchSpec) -> _Batch:
        rows = self._rows(conn, key, pid)
        facts = rows.facts
        task = spec.task
        names = self._names(conn, spec.usernames)
        order = page.sorted_case_ids(facts, spec.selected_cases(), spec.sort)
        targets: dict[str, tuple[_Target, ...]] = {}
        skipped: dict[str, SkipReason] = {}
        holders: dict[str, frozenset[str]] = {}
        for case_id in order:
            match = rows.match(
                case_id,
                spec.language,
                task,
                accepted_review=spec.review_accepted_translation
                and task == "translation_review",
                source_review=spec.review_reason == "source_changed"
                and task == "translation_review",
            )
            holders[case_id] = match.holders
            if match.reason is not None:
                skipped[case_id] = match.reason
            else:
                targets[case_id] = match.targets
        needs_people: int | None = None
        try:
            got, layout_skipped = layout(
                list(targets),
                names,
                mode=spec.mode,
                remaining={
                    c: max(t.remaining for t in ts) for c, ts in targets.items()
                },
                already={
                    c: frozenset().union(*(t.holders for t in ts))
                    for c, ts in targets.items()
                },
                task=task,
            )
        except TooFewPeople as error:
            got, layout_skipped, needs_people = {}, [], error.needed
        for case_id in layout_skipped:
            skipped[case_id] = "already_assigned"
            del targets[case_id]
        flat: list[_Target] = []
        for case_id, case_targets in targets.items():
            for target in case_targets:
                target.usernames = [
                    name for name in got.get(case_id, []) if name not in target.holders
                ][: target.remaining]
                flat.append(target)
        per_text = facts.annotations_per_text if task == "annotate" else 1
        target_views = [
            {
                "case_id": t.case_id,
                "language": t.language,
                "document_id": t.document_id,
                "version": t.version,
                "remaining": t.remaining,
                "usernames": list(t.usernames),
            }
            for t in flat
        ]
        skip_views = [
            {"case_id": case_id, "language": spec.language, "reason": skipped[case_id]}
            for case_id in order
            if case_id in skipped
        ]
        digest = _digest(
            {
                "task": task,
                "language": spec.language,
                "mode": spec.mode,
                "targets": target_views,
                "skipped": skip_views,
            }
        )
        view = {
            "task": task,
            "language": spec.language,
            "versions": len(flat),
            "targets": target_views,
            "skipped": skip_views,
            "people": self._people(conn, pid, task, spec, flat, holders),
            "per_text": per_text,
            "digest": digest,
            "needs_people": needs_people,
        }
        return _Batch(view, tuple(flat), digest, needs_people)

    def _people(
        self,
        conn: Connection,
        pid: int,
        task: Task,
        spec: BatchSpec,
        targets: Sequence[_Target],
        holders: Mapping[str, frozenset[str]],
    ) -> list[dict[str, Any]]:
        required: set[str] = set()
        if targets:
            variants = load_variants(conn, pid)
            for target in targets:
                try:
                    required |= required_languages(
                        variants[target.document_id], task, variants.get
                    )
                except DomainError:
                    required.add(target.language)
        else:
            required.add(spec.language)
        members = self._members(conn, pid)
        refs = person_refs(
            conn,
            [m["user_id"] for m in members],
            viewer_id=self.access.user_id,
            viewer_is_lead=True,
        )
        open_tasks = open_task_counts(conn, pid, [m["user_id"] for m in members])
        task_roles: frozenset[Role] = TASK_ROLES[task]
        views = []
        for member in members:
            username = member["username"]
            # One entry per target (version) the person gets.
            cases = [t.case_id for t in targets if username in t.usernames]
            mismatch = not required <= set(member["reads"])
            unavailable: Unavailable | None = (
                "inactive"
                if not member["active"]
                else "role_missing"
                if not member["roles"] & task_roles
                else "does_not_read"
                if mismatch
                else None
            )
            ref = refs[member["user_id"]]
            before = sum(open_tasks[member["user_id"]].values())
            views.append(
                {
                    "username": username,
                    "person": ref.model_dump(),
                    "reads": list(member["reads"]),
                    "open_before": before,
                    "open_after": before + len(cases),
                    "gets": len(cases),
                    "first_case": cases[0] if cases else None,
                    "last_case": cases[-1] if cases else None,
                    "language_mismatch": mismatch,
                    "unavailable": unavailable,
                    "already_assigned": sum(
                        1 for names in holders.values() if username in names
                    ),
                    "_name": (ref.display_name or ref.pseudonym).casefold(),
                }
            )
        # Eligible first; people without the role or inactive last.
        views.sort(
            key=lambda v: (
                v["unavailable"] in ("role_missing", "inactive"),
                v["language_mismatch"],
                v["open_before"],
                v["_name"],
                v["username"],
            )
        )
        for view in views:
            del view["_name"]
        return views

    def commit(
        self,
        key: str,
        spec: BatchSpec,
        *,
        expected_digest: str,
        confirm_language: bool = False,
    ) -> list[Assignment]:
        """All assignments of the preview, or none (``ASSIGNMENT_BATCH_REFUSED``)."""
        names = [normalize_username(name) for name in spec.usernames]
        with self.db.transaction() as conn:
            # Lock order of DistributionConfirmationService.confirm.
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
                raise DomainError("PROJECT_NOT_FOUND", f"There is no project '{key}'.")
            member_ids = select(ProjectMembershipRow.user_id).where(
                ProjectMembershipRow.project_id == project["id"]
            )
            users = conn.execute(
                select(UserRow.id, UserRow.username)
                .where(
                    or_(
                        UserRow.id.in_(member_ids),
                        UserRow.id == self.actor.user_id,
                        UserRow.username.in_(set(names)),
                    )
                )
                .order_by(UserRow.id)
                .with_for_update(key_share=True)
            ).all()
            user_ids = {username: user_id for user_id, username in users}
            require_project_management(
                conn, self.actor, key, project["id"], Action.MANAGE_ASSIGNMENTS
            )
            batch = self._batch(conn, key, project["id"], spec)
            if batch.digest != expected_digest:
                raise DomainError("ASSIGNMENT_BATCH_STALE")
            if batch.needs_people is not None:
                raise DomainError(
                    "ASSIGNMENT_BATCH_REFUSED",
                    {"refused": [], "needs_people": batch.needs_people},
                )
            variants = load_variants(conn, project["id"])
            # Once per batch, not per target: the commit holds the exclusive lock.
            obligated = (
                source_obligation_documents(conn, project["id"], key, variants)
                if any(target.source_review for target in batch.targets)
                else frozenset()
            )
            service = AssignmentService(self.db)
            created: list[Assignment] = []
            refused: list[dict[str, Any]] = []
            for target in batch.targets:
                for username in target.usernames:
                    try:
                        # A refusal exits only this savepoint; any refusal
                        # rolls back the whole batch below.
                        with conn.begin_nested():
                            allow = False
                            if target.accepted_review:
                                from ontocurator.application.work_plans import (
                                    enable_review_for_accepted,
                                )

                                allow = enable_review_for_accepted(
                                    conn, self.actor, project["id"], target.document_id
                                )
                            if target.source_review:
                                allow = enable_source_change_review(
                                    conn,
                                    self.actor,
                                    project["id"],
                                    key,
                                    target.document_id,
                                    variants=variants,
                                    obligated=obligated,
                                )
                            created.append(
                                service._assign_locked(
                                    conn,
                                    self.actor,
                                    project,
                                    target.document_id,
                                    user_ids[username],
                                    spec.task,
                                    confirm_language,
                                    variants=variants,
                                    allow_accepted_translation_review=allow,
                                )
                            )
                    except DomainError as error:
                        refused.append(
                            {
                                "case_id": target.case_id,
                                "language": target.language,
                                "document_id": target.document_id,
                                "username": username,
                                "code": error.code,
                            }
                        )
            if refused:
                raise DomainError("ASSIGNMENT_BATCH_REFUSED", {"refused": refused})
            return created
