"""Connection-scoped reads and writes of work plans (no transactions of its own).

``effective_plan`` is the only way to read a row's flags: a language version
without a stored row behaves as the project's import default computes it.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from typing import Any, cast

from sqlalchemy import Connection, and_, case, exists, func, select, tuple_, update
from sqlalchemy.dialects.postgresql import insert

from ontotator.domain import document_rows as rules
from ontotator.domain.work_plans import (
    ImportPlanSetting,
    LanguageVersion,
    OpenReport,
    OpenTask,
    PlanFlags,
    RowKey,
    import_defaults,
)
from ontotator.storage.final_tables import FinalSelectionRow
from ontotator.storage.plan_tables import (
    DiscardedVariantRow,
    TranslationAcceptanceRow,
    WorkPlanFlagsRow,
    WorkPlanRow,
)
from ontotator.storage.tables import (
    AssignmentRow,
    DocumentRow,
    ProjectRow,
    TranslationReviewRow,
)
from ontotator.storage.workflow_tables import (
    ProblemReportRow,
    ProblemReportStateRow,
    TaskHoldRow,
    TaskHoldStateRow,
)

__all__ = [
    "acceptances",
    "add_acceptance",
    "bump_revisions",
    "clear_restored",
    "decided_rows",
    "discarded",
    "effective_plan",
    "ensure_rows",
    "final_keys",
    "language_versions",
    "open_reports",
    "open_tasks",
    "plan_modes",
    "plan_rows",
    "project_revisions",
    "restored",
    "revisions",
    "write_modes",
    "write_rows",
]

_OPEN_STATUSES = ("open", "in_progress", "reopened")


def _key(row: Any) -> RowKey:
    return RowKey(row.case_id, row.language)


def _in_keys(case_col: Any, language_col: Any, keys: Iterable[RowKey]) -> Any:
    return tuple_(case_col, language_col).in_([(k.case_id, k.language) for k in keys])


def _latest_decisions(
    conn: Connection, pid: int, document_ids: Sequence[str] | None = None
) -> dict[str, str]:
    query = select(
        TranslationReviewRow.document_id, TranslationReviewRow.decision
    ).where(TranslationReviewRow.project_id == pid)
    if document_ids is not None:
        query = query.where(TranslationReviewRow.document_id.in_(list(document_ids)))
    rows = conn.execute(
        query.distinct(TranslationReviewRow.document_id).order_by(
            TranslationReviewRow.document_id,
            TranslationReviewRow.created_at.desc(),
            TranslationReviewRow.id.desc(),
        )
    )
    return {row.document_id: row.decision for row in rows}


def language_versions(
    conn: Connection, project_id: int, case_ids: Sequence[str] | None = None
) -> dict[RowKey, LanguageVersion]:
    """Every Documents row of the project (or of ``case_ids``) as the plan sees it.

    Discarded roots do not count for ``accepted``, ``marked_in_package`` and
    ``review_blocked``. For ``accepted`` and ``marked_in_package`` the newest
    version of a root skips corrections whose latest review is rejected or
    queried (``Version.not_newer``). ``review_blocked`` intentionally looks at
    the literal newest version (``chain.newest``): a rejected or queried
    correction blocks external acceptance although the older accepted version
    still counts, so a row may be ``accepted`` and ``review_blocked`` at once.

    With ``case_ids`` every query is restricted to the documents of those
    cases; no project-wide data is loaded.
    """
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
    ).where(DocumentRow.project_id == project_id)
    if case_ids is not None:
        query = query.where(DocumentRow.case_id.in_(list(case_ids)))
    documents = conn.execute(query).all()
    if not documents:
        return {}
    doc_ids = None if case_ids is None else [row.document_id for row in documents]

    def scoped(query: Any, column: Any) -> Any:
        return query if doc_ids is None else query.where(column.in_(doc_ids))

    decisions = _latest_decisions(conn, project_id, doc_ids)
    packaged = set(
        conn.execute(
            scoped(
                select(TranslationAcceptanceRow.document_id).where(
                    TranslationAcceptanceRow.project_id == project_id,
                    TranslationAcceptanceRow.source == "package",
                ),
                TranslationAcceptanceRow.document_id,
            )
        ).scalars()
    )
    dropped = set(
        conn.execute(
            scoped(
                select(DiscardedVariantRow.document_id).where(
                    DiscardedVariantRow.project_id == project_id
                ),
                DiscardedVariantRow.document_id,
            )
        ).scalars()
    )
    # Live translation review assignments, open or submitted (one query).
    assignments = conn.execute(
        scoped(
            select(AssignmentRow.document_id, AssignmentRow.status).where(
                AssignmentRow.project_id == project_id,
                AssignmentRow.task == "translation_review",
                AssignmentRow.revoked_at.is_(None),
            ),
            AssignmentRow.document_id,
        )
    ).all()
    reviewed = {row.document_id for row in assignments}
    in_review = {row.document_id for row in assignments if row.status in _OPEN_STATUSES}
    groups: dict[RowKey, list[rules.Version]] = defaultdict(list)
    for row in documents:
        groups[_key(row)].append(
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
    result: dict[RowKey, LanguageVersion] = {}
    for key, versions in groups.items():
        chains = rules.build_chains(versions)
        is_source = any(chain.root.origin == "native" for chain in chains)
        live = [
            chain
            for chain in chains
            if not any(v.document_id in dropped for v in chain.versions)
        ]
        targets = [[v for v in c.versions if not v.not_newer][-1] for c in live]
        newest = [chain.newest for chain in live]
        result[key] = LanguageVersion(
            case_id=key.case_id,
            language=key.language,
            is_source=is_source,
            accepted=bool(targets)
            and not is_source
            and all(v.translation_status == "accepted" for v in targets),
            marked_in_package=bool(targets)
            and not is_source
            and all(v.document_id in packaged for v in targets),
            discarded=not live,
            # Literal newest version on purpose (see docstring), unlike the
            # not_newer-skipping targets of accepted/marked_in_package.
            review_blocked=not is_source
            and any(
                (
                    chain.newest.translation_status == "reviewed"
                    and chain.newest.latest_decision in rules.NOT_NEWER
                )
                or any(v.document_id in in_review for v in chain.versions)
                for chain in live
            ),
            review_started=not is_source
            and any(
                v.document_id in reviewed
                or v.translation_status in ("reviewed", "accepted")
                for v in newest
            ),
        )
    return result


def plan_rows(
    conn: Connection, project_id: int, case_ids: Sequence[str] | None = None
) -> dict[RowKey, PlanFlags]:
    """Stored rows only."""
    query = select(
        WorkPlanFlagsRow.case_id,
        WorkPlanFlagsRow.language,
        WorkPlanFlagsRow.review,
        WorkPlanFlagsRow.annotate,
    ).where(WorkPlanFlagsRow.project_id == project_id)
    if case_ids is not None:
        query = query.where(WorkPlanFlagsRow.case_id.in_(list(case_ids)))
    return {
        _key(row): PlanFlags(row.review, row.annotate) for row in conn.execute(query)
    }


def plan_modes(
    conn: Connection, project_id: int, keys: Iterable[RowKey]
) -> dict[RowKey, str | None]:
    """Stored annotation-mode overrides of ``keys`` (rows without one: absent)."""
    keys = list(keys)
    if not keys:
        return {}
    return {
        _key(row): row.annotation_mode
        for row in conn.execute(
            select(
                WorkPlanFlagsRow.case_id,
                WorkPlanFlagsRow.language,
                WorkPlanFlagsRow.annotation_mode,
            ).where(
                WorkPlanFlagsRow.project_id == project_id,
                _in_keys(WorkPlanFlagsRow.case_id, WorkPlanFlagsRow.language, keys),
            )
        )
    }


def write_modes(
    conn: Connection, project_id: int, modes: Mapping[RowKey, str | None]
) -> None:
    """Set the override of existing rows (None = follow the project setting).

    Callers write the rows' flags first (``write_rows`` bumps the revision).
    """
    # shortcut: one UPDATE per row; batch it if bulk mode saves get slow.
    for key, mode in modes.items():
        conn.execute(
            update(WorkPlanFlagsRow)
            .where(
                WorkPlanFlagsRow.project_id == project_id,
                WorkPlanFlagsRow.case_id == key.case_id,
                WorkPlanFlagsRow.language == key.language,
            )
            .values(annotation_mode=mode)
        )


def effective_plan(
    conn: Connection, project_id: int, case_ids: Sequence[str] | None = None
) -> dict[RowKey, PlanFlags]:
    """Stored rows plus the import default for language versions without one."""
    stored = plan_rows(conn, project_id, case_ids)
    versions = language_versions(conn, project_id, case_ids)
    missing_cases = {key.case_id for key in versions if key not in stored}
    if not missing_cases:
        return stored
    setting = cast(
        ImportPlanSetting,
        conn.execute(
            select(ProjectRow.import_plan).where(ProjectRow.id == project_id)
        ).scalar_one(),
    )
    defaults = import_defaults(
        setting, [v for v in versions.values() if v.case_id in missing_cases]
    )
    result = dict(stored)
    for key, flags in defaults.items():
        result.setdefault(key, flags)
    return result


def revisions(
    conn: Connection, project_id: int, case_ids: Sequence[str]
) -> dict[str, int]:
    """The plan revision per case; a case without a ``work_plans`` row has 1."""
    result = dict.fromkeys(case_ids, 1)
    if not result:
        return result
    for row in conn.execute(
        select(WorkPlanRow.case_id, WorkPlanRow.revision).where(
            WorkPlanRow.project_id == project_id,
            WorkPlanRow.case_id.in_(list(result)),
        )
    ):
        result[row.case_id] = row.revision
    return result


def project_revisions(conn: Connection, project_id: int) -> dict[str, int]:
    """Stored plan revisions of the whole project; a case missing here has 1."""
    return {
        row.case_id: row.revision
        for row in conn.execute(
            select(WorkPlanRow.case_id, WorkPlanRow.revision).where(
                WorkPlanRow.project_id == project_id
            )
        )
    }


def restored(conn: Connection, project_id: int) -> dict[RowKey, int]:
    """Rows whose Annotate returned on a final result, with that revision."""
    return {
        _key(row): row.restored_revision
        for row in conn.execute(
            select(
                WorkPlanFlagsRow.case_id,
                WorkPlanFlagsRow.language,
                WorkPlanFlagsRow.restored_revision,
            ).where(
                WorkPlanFlagsRow.project_id == project_id,
                WorkPlanFlagsRow.restored_revision.is_not(None),
            )
        )
    }


def clear_restored(conn: Connection, project_id: int, key: RowKey) -> None:
    """Drop the row's PLAN_RESTORED marker; the plan revision stays as it is.

    For a final selection that changes the chosen result: the restored final
    is no longer the one the warning was about.
    """
    conn.execute(
        update(WorkPlanFlagsRow)
        .where(
            WorkPlanFlagsRow.project_id == project_id,
            WorkPlanFlagsRow.case_id == key.case_id,
            WorkPlanFlagsRow.language == key.language,
            WorkPlanFlagsRow.restored_revision.is_not(None),
        )
        .values(restored_revision=None)
    )


def _bump(conn: Connection, project_id: int, case_ids: Iterable[str]) -> dict[str, int]:
    upsert = insert(WorkPlanRow).values(
        [
            {"project_id": project_id, "case_id": case_id, "revision": 2}
            for case_id in sorted(set(case_ids))
        ]
    )
    stmt = upsert.on_conflict_do_update(
        index_elements=[WorkPlanRow.project_id, WorkPlanRow.case_id],
        set_={"revision": WorkPlanRow.revision + 1, "updated_at": func.now()},
    ).returning(WorkPlanRow.case_id, WorkPlanRow.revision)
    return {row.case_id: row.revision for row in conn.execute(stmt)}


def bump_revisions(
    conn: Connection, project_id: int, case_ids: Iterable[str]
) -> dict[str, int]:
    """Store current revision + 1 for each case (missing row = 1, so 2).

    For changes to a case's rows other than ``write_rows`` (e.g. an import
    adding rows), so open plan dialogs see ``WORK_PLAN_CHANGED``.
    """
    case_ids = list(case_ids)
    if not case_ids:
        return {}
    return _bump(conn, project_id, case_ids)


def write_rows(
    conn: Connection,
    project_id: int,
    rows: Mapping[RowKey, PlanFlags],
    *,
    actor_id: int | None,
    restored: Mapping[RowKey, int | None] = {},
    decided: Mapping[RowKey, bool] = {},
) -> dict[str, int]:
    """Upsert flags; each touched case stores its current revision + 1 once.

    A key in ``restored`` sets ``restored_revision`` exactly (None clears it);
    any other row clears it when its Annotate is off. Returns new revisions.

    The revision is bumped even when no flag actually changes, so callers
    should skip no-op change sets. ``updated_by`` is ``actor_id`` (rows created
    by ``ensure_rows`` or the 0016 migration have NULL ``updated_by``).
    Every written row counts as decided (spec VD3), even with
    ``actor_id=None``: ``decided``, not ``updated_by``, is the source of truth.
    Only an Undo passes ``decided`` to restore a row's earlier state exactly.
    """
    if not rows:
        return {}
    for exact in (True, False):
        values = [
            {
                "project_id": project_id,
                "case_id": key.case_id,
                "language": key.language,
                "review": flags.review,
                "annotate": flags.annotate,
                "restored_revision": restored.get(key),
                "updated_by": actor_id,
                "decided": decided.get(key, True),
            }
            for key, flags in rows.items()
            if (key in restored) is exact
        ]
        if not values:
            continue
        stmt = insert(WorkPlanFlagsRow).values(values)
        excluded = stmt.excluded
        stmt = stmt.on_conflict_do_update(
            index_elements=[
                WorkPlanFlagsRow.project_id,
                WorkPlanFlagsRow.case_id,
                WorkPlanFlagsRow.language,
            ],
            set_={
                "review": excluded.review,
                "annotate": excluded.annotate,
                "updated_by": excluded.updated_by,
                "decided": excluded.decided,
                "updated_at": func.now(),
                "restored_revision": excluded.restored_revision
                if exact
                else case(
                    (excluded.annotate.is_(False), None),
                    else_=WorkPlanFlagsRow.restored_revision,
                ),
            },
        )
        conn.execute(stmt)
    return _bump(conn, project_id, (key.case_id for key in rows))


def ensure_rows(
    conn: Connection, project_id: int, defaults: Mapping[RowKey, PlanFlags]
) -> int:
    """Insert only missing rows (and missing ``work_plans`` rows at revision 1).

    Inserted rows have NULL ``updated_by`` (system defaults, like the 0016
    migration rows); existing rows and revisions are left untouched. Under
    "Nothing planned" a translation row the import leaves out of plan is
    undecided (spec VD3); source rows (they show "not planned"), rows it puts
    in plan, and all rows under other plans, are decided.
    """
    if not defaults:
        return 0
    import_plan = conn.execute(
        select(ProjectRow.import_plan).where(ProjectRow.id == project_id)
    ).scalar_one()
    nothing_planned = import_plan == "nothing"
    sources = source_keys(conn, project_id, defaults) if nothing_planned else set()
    conn.execute(
        insert(WorkPlanRow)
        .values(
            [
                {"project_id": project_id, "case_id": case_id, "revision": 1}
                for case_id in sorted({key.case_id for key in defaults})
            ]
        )
        .on_conflict_do_nothing(
            index_elements=[WorkPlanRow.project_id, WorkPlanRow.case_id]
        )
    )
    inserted = conn.execute(
        insert(WorkPlanFlagsRow)
        .values(
            [
                {
                    "project_id": project_id,
                    "case_id": key.case_id,
                    "language": key.language,
                    "review": flags.review,
                    "annotate": flags.annotate,
                    "decided": not nothing_planned
                    or flags.review
                    or flags.annotate
                    or key in sources,
                }
                for key, flags in defaults.items()
            ]
        )
        .on_conflict_do_nothing(
            index_elements=[
                WorkPlanFlagsRow.project_id,
                WorkPlanFlagsRow.case_id,
                WorkPlanFlagsRow.language,
            ]
        )
        .returning(WorkPlanFlagsRow.id)
    ).all()
    return len(inserted)


def source_keys(
    conn: Connection, project_id: int, keys: Iterable[RowKey]
) -> set[RowKey]:
    """The rows among ``keys`` that hold a source (native) text."""
    keys = list(keys)
    if not keys:
        return set()
    rows = conn.execute(
        select(DocumentRow.case_id, DocumentRow.language)
        .where(
            DocumentRow.project_id == project_id,
            DocumentRow.origin == "native",
            _in_keys(DocumentRow.case_id, DocumentRow.language, keys),
        )
        .distinct()
    )
    return {_key(row) for row in rows}


def decided_rows(
    conn: Connection, project_id: int, case_ids: Iterable[str] | None = None
) -> dict[RowKey, bool]:
    """``decided`` of every stored row of the project (or of ``case_ids``)."""
    query = select(
        WorkPlanFlagsRow.case_id,
        WorkPlanFlagsRow.language,
        WorkPlanFlagsRow.decided,
    ).where(WorkPlanFlagsRow.project_id == project_id)
    if case_ids is not None:
        query = query.where(WorkPlanFlagsRow.case_id.in_(list(case_ids)))
    return {_key(row): row.decided for row in conn.execute(query)}


def undecided(conn: Connection, project_id: int, keys: Iterable[RowKey]) -> set[RowKey]:
    """The stored rows among ``keys`` whose ``decided`` is false (VD3)."""
    keys = set(keys)
    if not keys:
        return set()
    stored = decided_rows(conn, project_id, {key.case_id for key in keys})
    return {key for key in keys if stored.get(key) is False}


def open_tasks(
    conn: Connection, project_id: int, keys: Iterable[RowKey], *, lock: bool = False
) -> list[OpenTask]:
    """Non-revoked, not submitted assignments on documents of the rows."""
    keys = list(keys)
    if not keys:
        return []
    query = (
        select(
            AssignmentRow.id,
            DocumentRow.case_id,
            DocumentRow.language,
            AssignmentRow.task,
            AssignmentRow.user_id,
        )
        .join(
            DocumentRow,
            and_(
                DocumentRow.project_id == AssignmentRow.project_id,
                DocumentRow.document_id == AssignmentRow.document_id,
            ),
        )
        .where(
            AssignmentRow.project_id == project_id,
            AssignmentRow.revoked_at.is_(None),
            AssignmentRow.status != "submitted",
            _in_keys(DocumentRow.case_id, DocumentRow.language, keys),
        )
        .order_by(DocumentRow.case_id, DocumentRow.language, AssignmentRow.id)
    )
    if lock:
        query = query.with_for_update(key_share=True, of=AssignmentRow)
    return [
        OpenTask(row.id, row.case_id, row.language, row.task, row.user_id)
        for row in conn.execute(query)
    ]


def open_reports(
    conn: Connection, project_id: int, keys: Iterable[RowKey]
) -> list[OpenReport]:
    """Open problem reports on documents of the rows; held = an active hold."""
    keys = list(keys)
    if not keys:
        return []
    held = exists().where(
        TaskHoldRow.report_id == ProblemReportRow.report_id,
        TaskHoldStateRow.hold_id == TaskHoldRow.hold_id,
        TaskHoldStateRow.active.is_(True),
    )
    query = (
        select(
            ProblemReportRow.report_id,
            DocumentRow.case_id,
            DocumentRow.language,
            ProblemReportRow.assignment_id,
            held.label("held"),
        )
        .join(
            ProblemReportStateRow,
            ProblemReportStateRow.report_id == ProblemReportRow.report_id,
        )
        .join(AssignmentRow, AssignmentRow.id == ProblemReportRow.assignment_id)
        .join(
            DocumentRow,
            and_(
                DocumentRow.project_id == AssignmentRow.project_id,
                DocumentRow.document_id == AssignmentRow.document_id,
            ),
        )
        .where(
            ProblemReportRow.project_id == project_id,
            ProblemReportStateRow.state == "open",
            _in_keys(DocumentRow.case_id, DocumentRow.language, keys),
        )
        .order_by(DocumentRow.case_id, DocumentRow.language, ProblemReportRow.report_id)
    )
    return [
        OpenReport(
            row.report_id, row.case_id, row.language, row.assignment_id, bool(row.held)
        )
        for row in conn.execute(query)
    ]


def final_keys(conn: Connection, project_id: int) -> frozenset[RowKey]:
    return frozenset(
        _key(row)
        for row in conn.execute(
            select(FinalSelectionRow.case_id, FinalSelectionRow.language).where(
                FinalSelectionRow.project_id == project_id
            )
        )
    )


def add_acceptance(
    conn: Connection,
    project_id: int,
    document_id: str,
    *,
    source: str,
    reason: str | None,
    accepted_by: int | None,
    upload_id: int | None = None,
    metadata: Mapping[str, Any] = {},
) -> None:
    conn.execute(
        insert(TranslationAcceptanceRow).values(
            project_id=project_id,
            document_id=document_id,
            source=source,
            reason=reason,
            accepted_by=accepted_by,
            upload_id=upload_id,
            metadata_=dict(metadata),
        )
    )


def acceptances(conn: Connection, project_id: int) -> dict[str, dict[str, Any]]:
    """The newest acceptance record per document."""
    rows = conn.execute(
        select(
            TranslationAcceptanceRow.document_id,
            TranslationAcceptanceRow.source,
            TranslationAcceptanceRow.reason,
            TranslationAcceptanceRow.accepted_by,
            TranslationAcceptanceRow.accepted_at,
            TranslationAcceptanceRow.upload_id,
            TranslationAcceptanceRow.metadata_.label("metadata"),
        )
        .where(TranslationAcceptanceRow.project_id == project_id)
        .distinct(TranslationAcceptanceRow.document_id)
        .order_by(
            TranslationAcceptanceRow.document_id, TranslationAcceptanceRow.id.desc()
        )
    ).mappings()
    return {row["document_id"]: dict(row) for row in rows}


def discarded(conn: Connection, project_id: int) -> dict[str, dict[str, Any]]:
    rows = conn.execute(
        select(
            DiscardedVariantRow.document_id,
            DiscardedVariantRow.reason,
            DiscardedVariantRow.discarded_by,
            DiscardedVariantRow.discarded_at,
        ).where(DiscardedVariantRow.project_id == project_id)
    ).mappings()
    return {row["document_id"]: dict(row) for row in rows}
