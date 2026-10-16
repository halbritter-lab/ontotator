"""Shared task target/language rules over bounded, metadata-only lineage."""

from collections.abc import Callable, Mapping
from typing import Any

from sqlalchemy import Connection, literal, select
from sqlalchemy.orm import aliased

from ontocurator.authz.policy import Task
from ontocurator.domain.errors import DomainError
from ontocurator.domain.variants import (
    TRANSLATION_ORIGINS,
    VariantInfo,
    resolve_translation_lineage,
)
from ontocurator.storage.tables import DocumentRow, ProjectRow

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


def check_variant_assignable(
    project: Mapping[Any, Any],
    variant: VariantInfo,
    task: Task,
    lookup: Callable[[str], VariantInfo | None],
) -> frozenset[str]:
    """New allocations only; existing exact retries/reopen bypass this rule."""
    context = translation_context(variant, lookup)
    if task == "translation_review":
        if context is None or variant.translation_status == "accepted":
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
        and variant.translation_status != "accepted"
    ):
        raise DomainError("TRANSLATION_NOT_ACCEPTED")
    return required_languages(variant, task, lookup)


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
    check_variant_assignable(project, variant, "annotate", variants.get)
