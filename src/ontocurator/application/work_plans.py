"""Every write path of the work plan, under the project lock (spec "Work plan").

Writes take members SHARED -> project EXCLUSIVE (as assignment confirmations)
and then check project management. The order of one save is fixed: load rows,
check revisions, compute target flags, validate, lock open tasks, compute
consequences, require ``confirm``, record acceptances, revoke withdrawn tasks,
write the flags, audit each case. Previews read under the shared project lock
and never write.
"""

from __future__ import annotations

import unicodedata
from collections import defaultdict
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, cast

from sqlalchemy import Connection, RowMapping, func, insert, select, update

from ontocurator.application.final_causes import latest_review_decisions
from ontocurator.application.people import person_refs
from ontocurator.auth.audit import Actor, record_audit
from ontocurator.authz.policy import Access, Action
from ontocurator.authz.project_authority import require_project_management
from ontocurator.domain import document_rows as rules
from ontocurator.domain.annotation_modes import AnnotationMode
from ontocurator.domain.errors import AccessDenied, DomainError
from ontocurator.domain.work_plans import (
    OFF,
    SOURCE_KEY,
    Consequences,
    Invalid,
    LanguageChange,
    LanguageVersion,
    OpenTask,
    PlanFlags,
    RowKey,
    consequences,
    merge,
    preset_changes,
    validate,
)
from ontocurator.projects.assignments import revoke_assignments
from ontocurator.storage import work_plan_store as store
from ontocurator.storage.database import Database
from ontocurator.storage.final_tables import FinalSelectionRow
from ontocurator.storage.plan_tables import DiscardedVariantRow
from ontocurator.storage.repository import _lock_id
from ontocurator.storage.tables import AssignmentRow, DocumentRow, ProjectRow

if TYPE_CHECKING:
    from ontocurator.api.work_plan_routes import (
        BulkPlanRequest,
        PlanRowPatch,
        PlanRowsSet,
    )

__all__ = [
    "MAX_CASE_IDS",
    "WorkPlanService",
    "enable_review_for_accepted",
    "turn_review_on",
]

MAX_CASE_IDS = 5000
_INVALID_ORDER = ("source_review", "not_acceptable", "annotate_not_accepted")
_REVIEWABLE_ACCEPTANCES = frozenset({"lead", "override"})


def _row_order(key: RowKey) -> tuple[str, str]:
    return key.case_id, key.language


def _flags(flags: PlanFlags) -> dict[str, bool]:
    return {"review": flags.review, "annotate": flags.annotate}


def _ref(key: RowKey) -> dict[str, str]:
    return {"case_id": key.case_id, "language": key.language}


def _needs_acceptance(row: LanguageVersion, flags: PlanFlags) -> bool:
    """Annotate without Review on a translation that is not accepted (D20)."""
    return (
        not row.is_source and flags.annotate and not flags.review and not row.accepted
    )


def _target(chain: rules.Chain) -> rules.Version:
    """The newest version of a root that counts (``Version.not_newer``)."""
    return [v for v in chain.versions if not v.not_newer][-1]


def _chains(
    conn: Connection, pid: int, case_ids: Sequence[str] | None = None
) -> dict[RowKey, list[rules.Chain]]:
    query = select(
        DocumentRow.document_id,
        DocumentRow.case_id,
        DocumentRow.language,
        DocumentRow.external_id,
        DocumentRow.version,
        DocumentRow.origin,
        DocumentRow.derived_from,
        DocumentRow.translation,
        DocumentRow.translation_status,
        DocumentRow.position,
    ).where(DocumentRow.project_id == pid)
    if case_ids is not None:
        query = query.where(DocumentRow.case_id.in_(list(case_ids)))
    decisions = latest_review_decisions(conn, pid)
    groups: dict[RowKey, list[rules.Version]] = defaultdict(list)
    for row in conn.execute(query):
        groups[RowKey(row.case_id, row.language)].append(
            rules.Version(
                document_id=row.document_id,
                case_id=row.case_id,
                language=row.language,
                external_id=row.external_id,
                version=row.version,
                origin=row.origin,
                derived_from=row.derived_from,
                translation=row.translation,
                translation_status=row.translation_status,
                position=row.position,
                latest_decision=decisions.get(row.document_id),
            )
        )
    return {key: rules.build_chains(versions) for key, versions in groups.items()}


def _live(
    chains: Iterable[rules.Chain], discarded: Collection[str]
) -> list[rules.Chain]:
    return [
        chain
        for chain in chains
        if not any(v.document_id in discarded for v in chain.versions)
    ]


def _audit_cases(
    conn: Connection,
    actor: Actor,
    pid: int,
    old: Mapping[RowKey, PlanFlags],
    new: Mapping[RowKey, PlanFlags],
    revisions: Mapping[str, int],
    *,
    withdrawn: Sequence[OpenTask] = (),
    accepted: Mapping[str, str] | None = None,
    now: datetime | None = None,
    old_modes: Mapping[RowKey, str | None] | None = None,
    new_modes: Mapping[RowKey, str | None] | None = None,
) -> None:
    """One ``work_plan.update`` per case: old/new flags (and the annotation-mode
    override of rows whose override changed), withdrawn, acceptances."""
    old_modes, new_modes = old_modes or {}, new_modes or {}
    by_case: dict[str, list[RowKey]] = defaultdict(list)
    for key in sorted(new, key=_row_order):
        by_case[key.case_id].append(key)
    for case_id, keys in by_case.items():
        record_audit(
            conn,
            actor,
            "work_plan.update",
            target_type="work_plan",
            target_id=case_id,
            project_id=pid,
            details={
                "case_id": case_id,
                "revision": revisions[case_id],
                "rows": [
                    {
                        "language": key.language,
                        "old": _flags(old.get(key, OFF)),
                        "new": _flags(new[key]),
                    }
                    | (
                        {
                            "annotation_mode": {
                                "old": old_modes.get(key),
                                "new": new_modes[key],
                            }
                        }
                        if key in new_modes
                        else {}
                    )
                    for key in keys
                ],
                "withdrawn": [
                    t.assignment_id for t in withdrawn if t.case_id == case_id
                ],
                "acceptances": sorted(
                    document_id
                    for document_id, case in (accepted or {}).items()
                    if case == case_id
                ),
            },
            at=now,
        )


def _write(
    conn: Connection,
    actor: Actor,
    pid: int,
    current: Mapping[RowKey, PlanFlags],
    new: Mapping[RowKey, PlanFlags],
    *,
    restored: Mapping[RowKey, int | None],
    decided: Mapping[RowKey, bool] = {},
) -> dict[str, int]:
    """Materialise the touched cases' effective rows, then write ``new``."""
    _materialise(conn, pid, current, new)
    return store.write_rows(
        conn, pid, new, actor_id=actor.user_id, restored=restored, decided=decided
    )


def _materialise(
    conn: Connection,
    pid: int,
    current: Mapping[RowKey, PlanFlags],
    new: Mapping[RowKey, PlanFlags],
) -> None:
    cases = {key.case_id for key in new}
    store.ensure_rows(
        conn,
        pid,
        {key: flags for key, flags in current.items() if key.case_id in cases},
    )


def enable_review_for_accepted(
    conn: Connection, actor: Actor, project_id: int, document_id: str
) -> bool:
    """D25: a new review of a lead/override-accepted newest version.

    Returns True when ``document_id`` qualifies; turns Review on for its row
    (audited ``work_plan.update``, no consequences) if it was off.
    """
    document = conn.execute(
        select(
            DocumentRow.case_id, DocumentRow.language, DocumentRow.translation_status
        ).where(
            DocumentRow.project_id == project_id,
            DocumentRow.document_id == document_id,
        )
    ).one_or_none()
    if document is None or document.translation_status != "accepted":
        return False
    newer = conn.execute(
        select(DocumentRow.document_id)
        .where(
            DocumentRow.project_id == project_id,
            DocumentRow.derived_from == document_id,
            DocumentRow.origin == "correction",
        )
        .limit(1)
    ).first()
    acceptance = store.acceptances(conn, project_id).get(document_id)
    if (
        newer is not None
        or acceptance is None
        or acceptance["source"] not in _REVIEWABLE_ACCEPTANCES
    ):
        return False
    turn_review_on(conn, actor, project_id, RowKey(document.case_id, document.language))
    return True


def turn_review_on(
    conn: Connection, actor: Actor, project_id: int, key: RowKey
) -> None:
    """Review on for one row if it is off (D25, D26).

    Audited as ``work_plan.update``; no consequences and no confirmation (turning
    a flag on withdraws nothing). The caller holds the project lock.
    """
    current = store.effective_plan(conn, project_id, [key.case_id])
    old = current.get(key, OFF)
    if not old.review:
        new = {key: PlanFlags(True, old.annotate)}
        revisions = _write(conn, actor, project_id, current, new, restored={})
        _audit_cases(conn, actor, project_id, current, new, revisions)


_MODE_REFUSALS = {
    "ANNOTATION_MODE_LOCKED": "mode_locked",
    "NO_TOOL_PROPOSALS": "mode_no_proposals",
}


def _override(requested: str) -> AnnotationMode | None:
    """A requested mode as stored: ``"project"`` clears the override."""
    return None if requested == "project" else cast(AnnotationMode, requested)


def _mode_refusal(
    conn: Connection, pid: int, key: RowKey, mode: AnnotationMode | None
) -> str | None:
    """The refusal of a row's new override (plan P4), or None to store it.

    ``ANNOTATION_MODE_LOCKED`` when the text's annotation has started in
    another mode; ``NO_TOOL_PROPOSALS`` for "proposals" on a text without
    proposals. Following the project (None) or the locked mode is always
    stored: it only matters after an unlock.
    """
    if mode is None:
        return None
    # Imported here: text_targets builds on this module.
    from ontocurator.application.annotation_modes import load_text_mode
    from ontocurator.application.text_targets import TextRow, text_target_document

    try:
        target = text_target_document(conn, pid, TextRow(key.case_id, key.language))
    except DomainError as error:
        if error.code != "NOT_IN_WORK_PLAN":
            raise
        return None  # every version discarded: there is no text to annotate
    text = load_text_mode(conn, pid, target)
    if text.locked:
        return None if text.mode == mode else "ANNOTATION_MODE_LOCKED"
    if mode == "proposals" and text.source == "no_proposals":
        return "NO_TOOL_PROPOSALS"
    return None


@dataclass
class _Modes:
    """The override changes of one save: allowed (``new``) and refused rows."""

    new: dict[RowKey, AnnotationMode | None] = field(default_factory=dict)
    refused: dict[str, list[RowKey]] = field(default_factory=dict)

    def refs(self) -> dict[str, list[dict[str, str]]]:
        return {
            name: [_ref(k) for k in self.refused.get(code, [])]
            for code, name in _MODE_REFUSALS.items()
        }


def _mode_changes(
    conn: Connection, pid: int, requested: Mapping[RowKey, AnnotationMode | None]
) -> _Modes:
    """Rows whose stored override differs from the request, judged by the
    rule (one function for the row PATCH, bulk preview, bulk save and Undo)."""
    stored = store.plan_modes(conn, pid, requested)
    modes = _Modes()
    for key in sorted(requested, key=_row_order):
        mode = requested[key]
        if mode == stored.get(key):
            continue
        # shortcut: a few queries per changed row; batch them if bulk mode
        # saves over thousands of texts get slow.
        code = _mode_refusal(conn, pid, key, mode)
        if code is None:
            modes.new[key] = mode
        else:
            modes.refused.setdefault(code, []).append(key)
    return modes


@dataclass
class _Plan:
    """One evaluated change set of a project."""

    pid: int
    rule_on: bool
    versions: dict[RowKey, LanguageVersion]
    current: dict[RowKey, PlanFlags]
    new: dict[RowKey, PlanFlags]
    revisions: dict[str, int]
    accepting: frozenset[RowKey] = frozenset()
    invalid: list[Invalid] = field(default_factory=list)
    # Row-level selection (VD21): selected texts the change does not reach.
    skipped: list[RowKey] = field(default_factory=list)
    # Annotation-mode overrides; their rows are in ``new`` (flags kept).
    modes: _Modes = field(default_factory=_Modes)


class WorkPlanService:
    def __init__(self, db: Database, actor: Actor, access: Access) -> None:
        self.db, self.actor, self.access = db, actor, access

    # --- locks and shared steps ------------------------------------------- #

    def _lock(self, conn: Connection, key: str, *, exclusive: bool) -> RowMapping:
        conn.execute(
            select(func.pg_advisory_xact_lock_shared(_lock_id("members", key)))
        )
        lock = (
            func.pg_advisory_xact_lock
            if exclusive
            else func.pg_advisory_xact_lock_shared
        )
        conn.execute(select(lock(_lock_id("project", key))))
        project = (
            conn.execute(select(ProjectRow).where(ProjectRow.project_key == key))
            .mappings()
            .one_or_none()
        )
        if project is None:
            raise DomainError("PROJECT_NOT_FOUND", f"There is no project '{key}'.")
        require_project_management(
            conn, self.actor, key, project["id"], Action.MANAGE_ASSIGNMENTS
        )
        return project

    def _viewer_is_lead(self, key: str) -> bool:
        return self.access.is_system_admin or "lead" in self.access.roles_in(key)

    def _withdrawn_views(
        self, conn: Connection, key: str, tasks: Sequence[OpenTask]
    ) -> list[dict[str, Any]]:
        people = person_refs(
            conn,
            (t.user_id for t in tasks),
            viewer_id=self.actor.user_id if self.actor.user_id is not None else -1,
            viewer_is_lead=self._viewer_is_lead(key),
        )
        return [
            {
                "assignment_id": t.assignment_id,
                "case_id": t.case_id,
                "language": t.language,
                "task": t.task,
                "person": people[t.user_id].model_dump(),
            }
            for t in tasks
        ]

    def _consequences_view(
        self, conn: Connection, key: str, result: Consequences
    ) -> dict[str, Any]:
        return {
            "withdrawn": self._withdrawn_views(conn, key, result.withdrawn),
            "finals_leaving": [_ref(k) for k in result.finals_leaving],
            "restored": [_ref(k) for k in result.restored],
            "open_reports": [
                {
                    "report_id": r.report_id,
                    "case_id": r.case_id,
                    "language": r.language,
                    "assignment_id": r.assignment_id,
                    "held": r.held,
                }
                for r in result.open_reports
            ],
        }

    @staticmethod
    def _require_revisions(
        current: Mapping[str, int], expected: Mapping[str, int | None]
    ) -> None:
        stale = [
            {"case_id": case_id, "revision": current[case_id]}
            for case_id in sorted(expected)
            if case_id in current and expected[case_id] != current[case_id]
        ]
        if stale:
            raise DomainError("WORK_PLAN_CHANGED", {"cases": stale})

    @staticmethod
    def _invalid_row(plan: _Plan, row_key: RowKey) -> dict[str, Any]:
        row = plan.versions[row_key]
        return {
            **_ref(row_key),
            "not_accepted": int(not row.is_source and not row.accepted),
            "not_acceptable": int(row.review_blocked),
            "marked_in_package": int(row.marked_in_package),
        }

    @classmethod
    def _require_valid(cls, plan: _Plan, *, discarded_rule: bool = True) -> None:
        """``discarded`` first: no flag may turn on for a fully discarded row
        (a service rule: pure ``validate`` does not see the previous flags).
        An Undo (``discarded_rule=False``) restores an earlier state exactly."""
        discarded = [
            row_key
            for row_key, flags in sorted(
                plan.new.items(), key=lambda item: _row_order(item[0])
            )
            if discarded_rule
            and plan.versions[row_key].discarded
            and (
                (flags.review and not plan.current.get(row_key, OFF).review)
                or (flags.annotate and not plan.current.get(row_key, OFF).annotate)
            )
        ]
        if discarded:
            raise DomainError(
                "WORK_PLAN_INVALID",
                {
                    "reason": "discarded",
                    "rows": [cls._invalid_row(plan, k) for k in discarded],
                },
            )
        if not plan.invalid:
            return
        reasons = {item.reason for item in plan.invalid}
        reason = next(r for r in _INVALID_ORDER if r in reasons)
        raise DomainError(
            "WORK_PLAN_INVALID",
            {
                "reason": reason,
                "rows": [
                    cls._invalid_row(plan, item.key)
                    for item in plan.invalid
                    if item.reason == reason
                ],
            },
        )

    def _require_confirmed(
        self, conn: Connection, key: str, result: Consequences, needed: bool
    ) -> None:
        if needed:
            raise DomainError(
                "WORK_PLAN_CONFIRMATION_REQUIRED",
                self._consequences_view(conn, key, result),
            )

    def _accept(
        self,
        conn: Connection,
        key: str,
        plan: _Plan,
        reason: str | None,
        now: datetime,
    ) -> dict[str, str]:
        """Accept each live root's newest version as reviewed outside (D20)."""
        if not plan.accepting:
            return {}
        reason = (reason or "").strip()
        if not reason:
            raise DomainError("OVERRIDE_REASON_REQUIRED")
        require_project_management(
            conn, self.actor, key, plan.pid, Action.OVERRIDE_TRANSLATION_STATUS
        )
        cases = sorted({k.case_id for k in plan.accepting})
        chains = _chains(conn, plan.pid, cases)
        discarded = set(store.discarded(conn, plan.pid))
        accepted: dict[str, str] = {}
        for row_key in sorted(plan.accepting, key=_row_order):
            for chain in _live(chains.get(row_key, []), discarded):
                target = _target(chain)
                if target.translation_status == "accepted":
                    continue
                conn.execute(
                    update(DocumentRow)
                    .where(
                        DocumentRow.project_id == plan.pid,
                        DocumentRow.document_id == target.document_id,
                    )
                    .values(translation_status="accepted", status_reason=reason)
                )
                store.add_acceptance(
                    conn,
                    plan.pid,
                    target.document_id,
                    source="lead",
                    reason=reason,
                    accepted_by=self.actor.user_id,
                )
                record_audit(
                    conn,
                    self.actor,
                    "translation.accept_external_review",
                    target_type="document",
                    target_id=target.document_id,
                    project_id=plan.pid,
                    details={
                        "document_id": target.document_id,
                        "case_id": row_key.case_id,
                        "language": row_key.language,
                        "from": target.translation_status,
                        "to": "accepted",
                        "reason": reason,
                    },
                    at=now,
                )
                accepted[target.document_id] = row_key.case_id
        return accepted

    def _revoke(
        self, conn: Connection, pid: int, tasks: Sequence[OpenTask], now: datetime
    ) -> None:
        if not tasks:
            return
        rows = [
            dict(row)
            for row in conn.execute(
                select(AssignmentRow.id, AssignmentRow.document_id, AssignmentRow.task)
                .where(AssignmentRow.id.in_([t.assignment_id for t in tasks]))
                .order_by(AssignmentRow.id)
            ).mappings()
        ]
        revoke_assignments(conn, self.actor, pid, rows, now, reason="work_plan")

    def _apply(
        self,
        conn: Connection,
        key: str,
        plan: _Plan,
        result: Consequences,
        *,
        reason: str | None = None,
        restored: Mapping[RowKey, int | None] | None = None,
        decided: Mapping[RowKey, bool] | None = None,
    ) -> dict[str, Any]:
        """Acceptances, revocations, flags and audit of an evaluated plan.

        ``decided`` (Undo only) restores the rows' earlier undecided state.
        """
        now = datetime.now(UTC)
        accepted = self._accept(conn, key, plan, reason, now)
        self._revoke(conn, plan.pid, result.withdrawn, now)
        previous = store.restored(conn, plan.pid)
        if restored is None:
            restored = {k: plan.revisions[k.case_id] + 1 for k in result.restored}
        _materialise(conn, plan.pid, plan.current, plan.new)
        was_undecided = store.undecided(conn, plan.pid, plan.new)
        old_modes = store.plan_modes(conn, plan.pid, plan.new)
        revisions = _write(
            conn,
            self.actor,
            plan.pid,
            plan.current,
            plan.new,
            restored=restored,
            decided=decided or {},
        )
        store.write_modes(conn, plan.pid, plan.modes.new)
        _audit_cases(
            conn,
            self.actor,
            plan.pid,
            plan.current,
            plan.new,
            revisions,
            withdrawn=result.withdrawn,
            accepted=accepted,
            now=now,
            old_modes=old_modes,
            new_modes=plan.modes.new,
        )
        return {
            "revisions": revisions,
            "undo": {
                "rows": [
                    {
                        **_ref(k),
                        **_flags(plan.current.get(k, OFF)),
                        "restored_revision": previous.get(k),
                        "decided": k not in was_undecided,
                        "annotation_mode": old_modes.get(k),
                    }
                    for k in sorted(plan.new, key=_row_order)
                ],
                "revisions": revisions,
            },
            "withdrawn": self._withdrawn_views(conn, key, result.withdrawn),
            "accepted_document_ids": sorted(accepted),
        }

    def _consequences(
        self, conn: Connection, plan: _Plan, *, lock: bool
    ) -> Consequences:
        keys = list(plan.new)
        return consequences(
            plan.current,
            plan.new,
            store.open_tasks(conn, plan.pid, keys, lock=lock),
            store.final_keys(conn, plan.pid),
            store.open_reports(conn, plan.pid, keys),
        )

    # --- one row (inline chips) -------------------------------------------- #

    def patch_row(
        self, key: str, case_id: str, language: str, change: PlanRowPatch
    ) -> dict[str, Any]:
        row_key = RowKey(case_id, language)
        with self.db.transaction() as conn:
            project = self._lock(conn, key, exclusive=True)
            pid = project["id"]
            versions = store.language_versions(conn, pid, [case_id])
            row = versions.get(row_key)
            if row is None:
                raise DomainError("DOCUMENT_NOT_FOUND")
            revisions = store.revisions(conn, pid, [case_id])
            self._require_revisions(revisions, {case_id: change.expected_revision})
            current = store.effective_plan(conn, pid, [case_id])
            old = current.get(row_key, OFF)
            new = PlanFlags(
                old.review if change.review is None else change.review,
                old.annotate if change.annotate is None else change.annotate,
            )
            accepting = (
                frozenset({row_key})
                if change.accept_external_review is not None
                and _needs_acceptance(row, new)
                else frozenset()
            )
            stored = store.plan_modes(conn, pid, [row_key]).get(row_key)
            modes = _mode_changes(
                conn,
                pid,
                {}
                if change.annotation_mode is None
                else {row_key: _override(change.annotation_mode)},
            )
            for code in modes.refused:
                # The whole PATCH, flags included, saves nothing.
                raise DomainError(code, _ref(row_key))
            flags_change = (
                new != old
                or bool(accepting)
                or bool(store.undecided(conn, pid, [row_key]))
            )
            if not flags_change and not modes.new:
                # Nothing to write: no revision bump, no audit, empty Undo.
                return {
                    "case_id": case_id,
                    "language": language,
                    "flags": {
                        **_flags(new),
                        "review_applicable": not row.is_source,
                        "discarded": row.discarded,
                        "annotation_mode": stored,
                    },
                    "revision": revisions[case_id],
                    "undo": {"rows": [], "revisions": {case_id: revisions[case_id]}},
                    "withdrawn": [],
                    "accepted_document_ids": [],
                }
            plan = _Plan(
                pid,
                project["annotate_accepted_translations_only"],
                versions,
                current,
                {row_key: new},
                revisions,
                accepting,
                modes=modes,
            )
            # A mode-only change keeps the flags: they are not judged again.
            plan.invalid = validate(
                plan.new if flags_change else {},
                versions,
                rule_on=plan.rule_on,
                accepting=accepting,
            )
            self._require_valid(plan)
            result = self._consequences(conn, plan, lock=True)
            self._require_confirmed(
                conn, key, result, result.any and not change.confirm
            )
            applied = self._apply(
                conn,
                key,
                plan,
                result,
                reason=change.accept_external_review.reason
                if change.accept_external_review is not None
                else None,
            )
            after = store.language_versions(conn, pid, [case_id])[row_key]
            return {
                "case_id": case_id,
                "language": language,
                "flags": {
                    **_flags(new),
                    "review_applicable": not after.is_source,
                    "discarded": after.discarded,
                    "annotation_mode": modes.new.get(row_key, stored),
                },
                "revision": applied["revisions"][case_id],
                "undo": applied["undo"],
                "withdrawn": applied["withdrawn"],
                "accepted_document_ids": applied["accepted_document_ids"],
            }

    # --- many cases (selection bar, plan dialog) --------------------------- #

    def _bulk_plan(
        self, conn: Connection, project: RowMapping, request: BulkPlanRequest
    ) -> _Plan:
        pid = project["id"]
        # With ``rows`` (VD21) only the selected texts count: the preset's
        # languages, the preview groups and the changed rows.
        picked = list(
            dict.fromkeys(RowKey(r.case_id, r.language) for r in request.rows)
        )
        selected = (
            list(dict.fromkeys(k.case_id for k in picked))
            if picked
            else list(dict.fromkeys(request.case_ids))
        )
        versions = store.language_versions(conn, pid, selected)
        if picked:
            wanted = set(picked)
            versions = {k: v for k, v in versions.items() if k in wanted}
        present = {k.case_id for k in versions}
        cases = [case_id for case_id in selected if case_id in present]
        current = store.effective_plan(conn, pid, cases)
        changes: dict[str, LanguageChange] = {}
        if request.preset is not None:
            changes |= preset_changes(request.preset, versions.values())
        changes |= {
            language: LanguageChange(item.review, item.annotate)
            for language, item in request.languages.items()
        }
        merged = merge(current, versions, cases, changes)
        # An undecided row the change reaches becomes decided (VD3), even when
        # its flags stay as they are.
        undecided = store.undecided(conn, pid, merged)
        new = {
            k: f
            for k, f in merged.items()
            if f != current.get(k, OFF) or k in undecided
        }
        skipped = sorted((k for k in picked if k not in merged), key=_row_order)
        languages = (
            set(request.accept_external_review.languages)
            if request.accept_external_review is not None
            else set()
        )
        accepting = frozenset(
            k
            for k, flags in new.items()
            if k.language in languages and _needs_acceptance(versions[k], flags)
        )
        rule_on = bool(project["annotate_accepted_translations_only"])
        plan = _Plan(
            pid,
            rule_on,
            versions,
            current,
            new,
            store.revisions(conn, pid, cases),
            accepting,
            skipped=skipped,
        )
        plan.invalid = validate(new, versions, rule_on=rule_on, accepting=accepting)
        requested: dict[RowKey, AnnotationMode | None] = {}
        for row_key, row in versions.items():
            item = request.languages.get(SOURCE_KEY if row.is_source else row.language)
            # As ``merge``: rows of the selected cases, never fully discarded.
            if (
                item is not None
                and item.annotation_mode != "keep"
                and row_key.case_id in plan.revisions
                and not row.discarded
            ):
                requested[row_key] = _override(item.annotation_mode)
        plan.modes = _mode_changes(conn, pid, requested)
        for row_key in plan.modes.new:
            # A mode-only change still writes the row (revision, Undo, audit).
            new.setdefault(row_key, current.get(row_key, OFF))
        return plan

    def bulk_preview(self, key: str, request: BulkPlanRequest) -> dict[str, Any]:
        with self.db.transaction() as conn:
            project = self._lock(conn, key, exclusive=False)
            plan = self._bulk_plan(conn, project, request)
            tasks = store.open_tasks(conn, plan.pid, plan.versions)
            in_review = {
                RowKey(t.case_id, t.language)
                for t in tasks
                if t.task == "translation_review"
            }
            result = consequences(
                plan.current,
                plan.new,
                tasks,
                store.final_keys(conn, plan.pid),
                store.open_reports(conn, plan.pid, list(plan.new)),
            )
            after = {**plan.current, **plan.new}
            groups: dict[str, list[RowKey]] = defaultdict(list)
            for row_key, row in sorted(
                plan.versions.items(), key=lambda item: _row_order(item[0])
            ):
                groups[SOURCE_KEY if row.is_source else row.language].append(row_key)
            refused = {
                name: set(plan.modes.refused.get(code, []))
                for code, name in _MODE_REFUSALS.items()
            }
            languages = []
            for group in sorted(groups, key=lambda g: (g != SOURCE_KEY, g)):
                keys = groups[group]
                rows = [plan.versions[k] for k in keys]
                before = [plan.current.get(k, OFF) for k in keys]
                not_accepted = [
                    k
                    for k in keys
                    if plan.rule_on and _needs_acceptance(plan.versions[k], after[k])
                ]
                blocked = [k for k in not_accepted if plan.versions[k].review_blocked]
                languages.append(
                    {
                        "key": group,
                        "source_languages": sorted({k.language for k in keys})
                        if group == SOURCE_KEY
                        else [],
                        "cases_in_selection": len({k.case_id for k in keys}),
                        "review": None
                        if group == SOURCE_KEY
                        else {
                            "on": sum(f.review for f in before),
                            "off": sum(not f.review for f in before),
                        },
                        "annotate": {
                            "on": sum(f.annotate for f in before),
                            "off": sum(not f.annotate for f in before),
                        },
                        "will_change": sum(k in plan.new for k in keys),
                        "not_accepted": len(not_accepted),
                        "not_acceptable": len(blocked),
                        "in_review": sum(k in in_review for k in blocked),
                        "marked_in_package": sum(r.marked_in_package for r in rows),
                        **{
                            name: sum(k in rows_refused for k in keys)
                            for name, rows_refused in refused.items()
                        },
                    }
                )
            to_assign = {
                "translation_review": sum(
                    f.review and not plan.current.get(k, OFF).review
                    for k, f in plan.new.items()
                ),
                "annotate": sum(
                    f.annotate and not plan.current.get(k, OFF).annotate
                    for k, f in plan.new.items()
                ),
            }
            return {
                "cases": len(plan.revisions),
                "languages": languages,
                "changes": len(plan.new),
                "to_assign": {task: n for task, n in to_assign.items() if n},
                "consequences": self._consequences_view(conn, key, result),
                "invalid": [
                    _ref(item.key)
                    for item in sorted(plan.invalid, key=lambda i: _row_order(i.key))
                ],
                "revisions": plan.revisions,
                "rule_on": plan.rule_on,
                "skipped_rows": [_ref(k) for k in plan.skipped],
            }

    def bulk_save(self, key: str, request: BulkPlanRequest) -> dict[str, Any]:
        with self.db.transaction() as conn:
            project = self._lock(conn, key, exclusive=True)
            plan = self._bulk_plan(conn, project, request)
            if request.expected_revisions is not None:
                # A selected case missing from ``expected_revisions`` is stale
                # (None never matches); without them the preset path applies.
                expected = request.expected_revisions
                self._require_revisions(
                    plan.revisions, {c: expected.get(c) for c in plan.revisions}
                )
            self._require_valid(plan)
            skipped_rows = [_ref(k) for k in plan.skipped]
            if not plan.new:
                return {
                    "changed_rows": 0,
                    "revisions": {},
                    "undo": {"rows": [], "revisions": {}},
                    "withdrawn": [],
                    "skipped_rows": skipped_rows,
                    **plan.modes.refs(),
                }
            result = self._consequences(conn, plan, lock=True)
            self._require_confirmed(
                conn, key, result, result.any and not request.confirm
            )
            applied = self._apply(
                conn,
                key,
                plan,
                result,
                reason=request.accept_external_review.reason
                if request.accept_external_review is not None
                else None,
            )
            return {
                "changed_rows": len(plan.new),
                "revisions": applied["revisions"],
                "undo": applied["undo"],
                "withdrawn": applied["withdrawn"],
                "skipped_rows": skipped_rows,
                **plan.modes.refs(),
            }

    def set_rows(self, key: str, request: PlanRowsSet) -> dict[str, Any]:
        """Exact flags per row; ``undo`` restores ``restored_revision`` too (D22)."""
        rows = {RowKey(r.case_id, r.language): r for r in request.rows}
        cases = sorted({k.case_id for k in rows})
        with self.db.transaction() as conn:
            project = self._lock(conn, key, exclusive=True)
            pid = project["id"]
            versions = store.language_versions(conn, pid, cases)
            if any(k not in versions for k in rows):
                raise DomainError("DOCUMENT_NOT_FOUND")
            revisions = store.revisions(conn, pid, cases)
            self._require_revisions(
                revisions,
                {case_id: request.expected_revisions.get(case_id) for case_id in cases},
            )
            rule_on = bool(project["annotate_accepted_translations_only"])
            plan = _Plan(
                pid,
                rule_on,
                versions,
                store.effective_plan(conn, pid, cases),
                {k: PlanFlags(r.review, r.annotate) for k, r in rows.items()},
                revisions,
                # Only rows that name their override set it (Undo views
                # always do; a plain "decide" call keeps the stored one).
                modes=_mode_changes(
                    conn,
                    pid,
                    {
                        k: r.annotation_mode
                        for k, r in rows.items()
                        if "annotation_mode" in r.model_fields_set
                    },
                ),
            )
            # An Undo restores an earlier state exactly; only the source rule holds.
            plan.invalid = validate(
                plan.new, versions, rule_on=rule_on and not request.undo
            )
            self._require_valid(plan, discarded_rule=not request.undo)
            result = self._consequences(conn, plan, lock=True)
            if request.undo:
                # Finals and PLAN_RESTORED are restored exactly; only tasks
                # assigned after the change need a confirmation.
                result = Consequences(result.withdrawn, (), (), ())
            self._require_confirmed(
                conn, key, result, result.any and not request.confirm
            )
            applied = self._apply(
                conn,
                key,
                plan,
                result,
                restored={k: r.restored_revision for k, r in rows.items()}
                if request.undo
                else None,
                decided={k: r.decided for k, r in rows.items()}
                if request.undo
                else None,
            )
            return {
                "changed_rows": len(plan.new),
                "revisions": applied["revisions"],
                "undo": applied["undo"],
                "withdrawn": applied["withdrawn"],
                **plan.modes.refs(),
            }

    # --- reads ------------------------------------------------------------- #

    def annotation_target_preview(
        self, key: str, annotations_per_text: int
    ) -> dict[str, int]:
        """Rows with more non-revoked annotators on a target version than ``n``."""
        with self.db.transaction() as conn:
            pid = self._lock(conn, key, exclusive=False)["id"]
            counts = dict(
                conn.execute(
                    select(
                        AssignmentRow.document_id,
                        func.count(AssignmentRow.user_id.distinct()),
                    )
                    .where(
                        AssignmentRow.project_id == pid,
                        AssignmentRow.task == "annotate",
                        AssignmentRow.revoked_at.is_(None),
                    )
                    .group_by(AssignmentRow.document_id)
                )
                .tuples()
                .all()
            )
            discarded = set(store.discarded(conn, pid))
            over = sum(
                any(
                    counts.get(_target(chain).document_id, 0) > annotations_per_text
                    for chain in _live(chains, discarded)
                )
                for chains in _chains(conn, pid).values()
            )
            return {"rows_over_target": over}

    def lookup_case_ids(self, key: str, ids: Sequence[str]) -> dict[str, list[str]]:
        """Exact match after NFKC and trimming; duplicates and blanks dropped."""
        if len(ids) > MAX_CASE_IDS:
            raise DomainError("CASE_IDS_TOO_MANY", {"max": MAX_CASE_IDS})
        wanted = list(
            dict.fromkeys(
                normalized
                for normalized in (
                    unicodedata.normalize("NFKC", raw).strip() for raw in ids
                )
                if normalized
            )
        )
        with self.db.transaction() as conn:
            pid = self._lock(conn, key, exclusive=False)["id"]
            known = (
                set(
                    conn.execute(
                        select(DocumentRow.case_id)
                        .where(
                            DocumentRow.project_id == pid,
                            DocumentRow.case_id.in_(wanted),
                        )
                        .distinct()
                    ).scalars()
                )
                if wanted
                else set()
            )
        return {
            "found": [case_id for case_id in wanted if case_id in known],
            "unknown": [case_id for case_id in wanted if case_id not in known],
        }

    # --- discarding a language version (D5 c) ------------------------------ #

    def discard(
        self, key: str, document_id: str, reason: str, confirm: bool
    ) -> dict[str, Any]:
        reason = reason.strip()
        if not reason:
            raise DomainError("DISCARD_REASON_REQUIRED")
        if self.actor.user_id is None:
            # discarded_variants.discarded_by names the lead (as final
            # selections): process actors cannot discard.
            raise AccessDenied("NOT_ALLOWED", "Only a signed-in lead can discard.")
        with self.db.transaction() as conn:
            project = self._lock(conn, key, exclusive=True)
            pid = project["id"]
            document = conn.execute(
                select(DocumentRow.case_id, DocumentRow.language).where(
                    DocumentRow.project_id == pid,
                    DocumentRow.document_id == document_id,
                )
            ).one_or_none()
            if document is None:
                raise DomainError("DOCUMENT_NOT_FOUND")
            row_key = RowKey(document.case_id, document.language)
            chains = _chains(conn, pid, [document.case_id])[row_key]
            chain = next(
                c
                for c in chains
                if any(v.document_id == document_id for v in c.versions)
            )
            if chain.root.origin == "native":
                raise DomainError("NOT_A_TRANSLATION", {"reason": "not_a_translation"})
            discarded = set(store.discarded(conn, pid))
            ids = [v.document_id for v in chain.versions]
            if any(d in discarded for d in ids):
                raise DomainError("VARIANT_ALREADY_DISCARDED")
            remaining = [c for c in _live(chains, discarded) if c is not chain]
            current = store.effective_plan(conn, pid, [document.case_id])
            revisions = store.revisions(conn, pid, [document.case_id])
            root_tasks = [
                OpenTask(
                    row.id, row_key.case_id, row_key.language, row.task, row.user_id
                )
                for row in conn.execute(
                    select(AssignmentRow.id, AssignmentRow.task, AssignmentRow.user_id)
                    .where(
                        AssignmentRow.project_id == pid,
                        AssignmentRow.document_id.in_(ids),
                        AssignmentRow.revoked_at.is_(None),
                        AssignmentRow.status != "submitted",
                    )
                    .order_by(AssignmentRow.id)
                    .with_for_update(key_share=True)
                )
            ]
            new: dict[RowKey, PlanFlags] = {} if remaining else {row_key: OFF}
            plan = _Plan(
                pid,
                bool(project["annotate_accepted_translations_only"]),
                store.language_versions(conn, pid, [document.case_id]),
                current,
                new,
                revisions,
            )
            if remaining:
                # The row stays planned; only the discarded root's work goes.
                # A final chosen on one of its versions leaves the export and
                # its open reports are listed (they stay open).
                final_document = conn.execute(
                    select(FinalSelectionRow.document_id).where(
                        FinalSelectionRow.project_id == pid,
                        FinalSelectionRow.case_id == row_key.case_id,
                        FinalSelectionRow.language == row_key.language,
                    )
                ).scalar_one_or_none()
                root_assignments = set(
                    conn.execute(
                        select(AssignmentRow.id).where(
                            AssignmentRow.project_id == pid,
                            AssignmentRow.document_id.in_(ids),
                        )
                    ).scalars()
                )
                result = Consequences(
                    tuple(root_tasks),
                    (row_key,) if final_document in ids else (),
                    (),
                    tuple(
                        report
                        for report in store.open_reports(conn, pid, [row_key])
                        if report.assignment_id in root_assignments
                    ),
                )
            else:
                row_result = self._consequences(conn, plan, lock=True)
                withdrawn = {t.assignment_id: t for t in row_result.withdrawn} | {
                    t.assignment_id: t for t in root_tasks
                }
                result = Consequences(
                    tuple(withdrawn[i] for i in sorted(withdrawn)),
                    row_result.finals_leaving,
                    (),
                    row_result.open_reports,
                )
            self._require_confirmed(conn, key, result, result.any and not confirm)
            now = datetime.now(UTC)
            conn.execute(
                insert(DiscardedVariantRow),
                [
                    {
                        "project_id": pid,
                        "document_id": d,
                        "reason": reason,
                        "discarded_by": self.actor.user_id,
                        "discarded_at": now,
                    }
                    for d in ids
                ],
            )
            self._revoke(conn, pid, result.withdrawn, now)
            revision = revisions[document.case_id]
            if new:
                written = _write(conn, self.actor, pid, current, new, restored={})
                revision = written[document.case_id]
                _audit_cases(
                    conn,
                    self.actor,
                    pid,
                    current,
                    new,
                    written,
                    withdrawn=result.withdrawn,
                    now=now,
                )
            record_audit(
                conn,
                self.actor,
                "variant.discard",
                target_type="document",
                target_id=chain.root_id,
                project_id=pid,
                details={
                    "case_id": row_key.case_id,
                    "language": row_key.language,
                    "document_ids": ids,
                    "reason": reason,
                    "withdrawn": [t.assignment_id for t in result.withdrawn],
                    "flags_off": bool(new),
                },
                at=now,
            )
            flags = new.get(row_key, current.get(row_key, OFF))
            return {
                "case_id": row_key.case_id,
                "language": row_key.language,
                "discarded_document_ids": ids,
                "flags": {
                    **_flags(flags),
                    "review_applicable": True,
                    "discarded": not remaining,
                },
                "revision": revision,
                "withdrawn": self._withdrawn_views(conn, key, result.withdrawn),
            }
