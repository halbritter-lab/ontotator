"""Shared task target/language rules over bounded, metadata-only lineage."""

from collections.abc import Callable, Mapping
from typing import Any

from sqlalchemy import Connection, select

from ontocurator.authz.policy import Task
from ontocurator.domain.errors import DomainError
from ontocurator.domain.variants import VariantInfo, resolve_translation_lineage
from ontocurator.storage.tables import DocumentRow, ProjectRow

# These are immutable metadata inputs, never document text or annotation payload.
VARIANT_COLUMNS = tuple(
    getattr(DocumentRow, name) for name in VariantInfo.__dataclass_fields__
)


def load_variants(conn: Connection, project_id: int) -> dict[str, VariantInfo]:
    return {
        row["document_id"]: VariantInfo(**row)
        for row in conn.execute(
            select(*VARIANT_COLUMNS).where(DocumentRow.project_id == project_id)
        ).mappings()
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
    variants = load_variants(conn, project_id)
    variant = variants.get(document_id)
    if variant is None:
        raise DomainError("DOCUMENT_NOT_FOUND")
    check_variant_assignable(project, variant, "annotate", variants.get)
