"""Shared task target/language rules over bounded, metadata-only lineage."""

from collections.abc import Callable, Collection, Mapping, Sequence
from typing import Any

from sqlalchemy import Connection, literal, select
from sqlalchemy.orm import aliased

from ontotator.authz.policy import Task
from ontotator.domain.errors import DomainError
from ontotator.domain.next_steps import translations_accepted
from ontotator.domain.variants import (
    TRANSLATION_ORIGINS,
    VariantInfo,
    resolve_translation_lineage,
)
from ontotator.domain.work_plans import PlanFlags, RowKey
from ontotator.storage import work_plan_store
from ontotator.storage.plan_tables import DiscardedVariantRow
from ontotator.storage.tables import AssignmentRow, DocumentRow, ProjectRow

# These are immutable metadata inputs, never document text or annotation payload.
VARIANT_COLUMNS = tuple(
    getattr(DocumentRow, name) for name in VariantInfo.__dataclass_fields__
)


def load_variants(
    conn: Connection, project_id: int, document_id: str | None = None
) -> dict[str, VariantInfo]:
    """Inventory for locked snapshots, or only one target's required ancestry.

    The recursive relation carries IDs, not text/JSON. UNION terminates cycles;
    the shared resolver still refuses corrupt/missing/cross-identity ancestry.
    Stop after the translation ancestor's exact original source: that source's
    own ancestors are irrelevant to this review's original-source identity.
    """
    query = select(*VARIANT_COLUMNS).where(DocumentRow.project_id == project_id)
    if document_id is not None:
        lineage = (
            select(
                DocumentRow.document_id,
                DocumentRow.derived_from,
                DocumentRow.origin,
                literal(False).label("original_source"),
            )
            .where(
                DocumentRow.project_id == project_id,
                DocumentRow.document_id == document_id,
            )
            .cte("assignment_lineage", recursive=True)
        )
        previous = aliased(DocumentRow)
        lineage = lineage.union(
            select(
                previous.document_id,
                previous.derived_from,
                previous.origin,
                lineage.c.origin.in_(TRANSLATION_ORIGINS).label("original_source"),
            )
            .join(lineage, previous.document_id == lineage.c.derived_from)
            .where(
                previous.project_id == project_id,
                lineage.c.original_source.is_(False),
                lineage.c.origin.in_((*TRANSLATION_ORIGINS, "correction")),
            )
        )
        query = query.where(DocumentRow.document_id.in_(select(lineage.c.document_id)))
    return {
        row["document_id"]: VariantInfo(**row) for row in conn.execute(query).mappings()
    }


def translation_context(
    variant: VariantInfo, lookup: Callable[[str], VariantInfo | None]
) -> tuple[VariantInfo, VariantInfo] | None:
    try:
        return resolve_translation_lineage(variant, lookup)
    except DomainError as error:
        if error.code == "NOT_A_TRANSLATION":
            return None
        raise


def required_languages(
    variant: VariantInfo, task: Task, lookup: Callable[[str], VariantInfo | None]
) -> frozenset[str]:
    if task != "translation_review":
        return frozenset({variant.language})
    _, source = resolve_translation_lineage(variant, lookup)
    return frozenset({variant.language, source.language})


def reads_all(known: Collection[str], required: Collection[str]) -> bool:
    """Whether a person with ``known`` languages reads every ``required`` one.

    No languages listed means unknown, not "reads nothing": such a person is
    eligible without a language warning (issue 193)."""
    return not known or set(known) >= set(required)


def annotation_waits(
    variant: VariantInfo, lookup: Callable[[str], VariantInfo | None]
) -> bool:
    """With the rule on, an annotation task on ``variant`` stays closed: the
    one derived definition of "waiting for the translation review"."""
    return (
        variant.translation_status != "accepted"
        and translation_context(variant, lookup) is not None
    )


def open_review_documents(
    conn: Connection, project_id: int, case_id: str | None = None
) -> set[str]:
    """Versions with a translation review assigned or underway, of one case or
    the whole project (the next steps' ``open_translation_reviews``)."""
    query = (
        select(DocumentRow.document_id)
        .join(
            AssignmentRow,
            (AssignmentRow.project_id == DocumentRow.project_id)
            & (AssignmentRow.document_id == DocumentRow.document_id),
        )
        .where(
            DocumentRow.project_id == project_id,
            AssignmentRow.task == "translation_review",
            AssignmentRow.revoked_at.is_(None),
            AssignmentRow.status != "submitted",
        )
        .distinct()
    )
    if case_id is not None:
        query = query.where(DocumentRow.case_id == case_id)
    return set(conn.execute(query).scalars())


def review_covers(
    variant: Any, lookup: Callable[[str], Any], reviewed: Collection[str]
) -> bool:
    """A review in ``reviewed`` runs on ``variant`` or its ancestor chain: a
    review of another root never gets this version accepted."""
    seen: set[str] = set()
    current = variant
    while current is not None and current.document_id not in seen:
        if current.document_id in reviewed:
            return True
        seen.add(current.document_id)
        current = lookup(current.derived_from) if current.derived_from else None
    return False


def check_variant_assignable(
    project: Mapping[Any, Any],
    variant: VariantInfo,
    task: Task,
    lookup: Callable[[str], VariantInfo | None],
    *,
    allow_accepted_translation_review: bool = False,
    row_statuses: Sequence[str | None] | None = None,
    review_open: bool = False,
) -> frozenset[str]:
    """New allocations only; existing exact retries/reopen bypass this rule.

    ``row_statuses``: every live root's target status of the text (the
    next steps' test); ``variant`` itself must be accepted as well.
    ``review_open``: a translation review of this version or an ancestor is
    assigned or underway: the task may be assigned and waits for the acceptance
    (issue 213). An accepted version would not wait, so it stays refused until
    every root of the text is accepted."""
    context = translation_context(variant, lookup)
    if task == "translation_review":
        if context is None or (
            variant.translation_status == "accepted"
            and not allow_accepted_translation_review
        ):
            raise DomainError(
                "NOT_A_TRANSLATION",
                {
                    "reason": "not_a_translation"
                    if context is None
                    else "translation_already_accepted"
                },
            )
    elif (
        project["annotate_accepted_translations_only"]
        and context is not None
        and not translations_accepted(
            False, (variant.translation_status, *(row_statuses or ()))
        )
        and not (review_open and variant.translation_status != "accepted")
    ):
        raise DomainError("TRANSLATION_NOT_ACCEPTED")
    return required_languages(variant, task, lookup)


def outside_work_plan(
    plan: Mapping[RowKey, PlanFlags],
    discarded: Collection[str],
    variant: VariantInfo,
    task: Task,
) -> bool:
    """A new task needs its row's flag: Review for translation reviews, Annotate
    for annotation and consolidation; a discarded version takes none."""
    if variant.document_id in discarded:
        return True
    flags = plan.get(RowKey(variant.case_id, variant.language))
    if flags is None:
        return True
    return not (flags.review if task == "translation_review" else flags.annotate)


def plan_for(
    conn: Connection, project_id: int, keys: Collection[RowKey]
) -> dict[RowKey, PlanFlags]:
    """Effective flags of ``keys``: stored rows first (one query); only cases
    with a row missing derive the import default (``effective_plan``)."""
    cases = sorted({key.case_id for key in keys})
    plan = work_plan_store.plan_rows(conn, project_id, cases)
    missing = sorted({key.case_id for key in keys if key not in plan})
    if missing:
        plan |= work_plan_store.effective_plan(conn, project_id, missing)
    return plan


def check_work_plan(
    conn: Connection, project_id: int, variant: VariantInfo, task: Task
) -> None:
    """New allocations only; reopen, reassign and exact retries bypass it."""
    plan = plan_for(conn, project_id, [RowKey(variant.case_id, variant.language)])
    discarded = set(
        conn.execute(
            select(DiscardedVariantRow.document_id).where(
                DiscardedVariantRow.project_id == project_id,
                DiscardedVariantRow.document_id == variant.document_id,
            )
        ).scalars()
    )
    if outside_work_plan(plan, discarded, variant, task):
        raise DomainError("NOT_IN_WORK_PLAN")


def conflicting_tasks(task: Task) -> frozenset[Task]:
    return (
        frozenset({"review"})
        if task == "annotate"
        else frozenset({"annotate"})
        if task == "review"
        else frozenset()
    )


def require_annotation_gate(
    conn: Connection, project_id: int, document_id: str
) -> None:
    project = (
        conn.execute(
            select(ProjectRow.annotate_accepted_translations_only).where(
                ProjectRow.id == project_id
            )
        )
        .mappings()
        .one()
    )
    if not project["annotate_accepted_translations_only"]:
        return
    variants = load_variants(conn, project_id, document_id)
    variant = variants.get(document_id)
    if variant is None:
        raise DomainError("DOCUMENT_NOT_FOUND")
    if annotation_waits(variant, variants.get):
        from ontotator.application.text_targets import superseded_versions

        raise DomainError(
            "TASK_WAITING_FOR_TRANSLATION_REVIEW",
            {
                "document_id": document_id,
                "waiting_for_lead": bool(
                    superseded_versions(conn, project_id, [variant])
                ),
            },
        )
