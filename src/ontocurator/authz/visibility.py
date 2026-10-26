"""Authoritative document visibility and current task authority."""

from __future__ import annotations

from dataclasses import dataclass, fields
from typing import cast

from sqlalchemy import Connection, and_, exists, or_, select
from sqlalchemy.sql.elements import ColumnElement

from ontocurator.authz.policy import TASK_ROLES, Access, Action, Role, can
from ontocurator.domain.errors import DomainError
from ontocurator.domain.variants import (
    VariantInfo,
    resolve_translation_lineage,
    translation_review_comparisons,
)
from ontocurator.storage.tables import (
    AssignmentRow,
    DocumentRow,
    ProjectMembershipRow,
    ProjectRow,
    TranslationReviewRow,
    UserRow,
)


@dataclass(frozen=True)
class DocumentFilter:
    all: bool
    document_ids: frozenset[str] = frozenset()


def current_access(
    conn: Connection, access: Access, project_id: int, project_key: str
) -> Access:
    user = conn.execute(
        select(UserRow.active, UserRow.is_system_admin, UserRow.pseudonym).where(
            UserRow.id == access.user_id
        )
    ).one_or_none()
    roles = frozenset(
        cast(Role, role)
        for role in conn.execute(
            select(ProjectMembershipRow.role).where(
                ProjectMembershipRow.project_id == project_id,
                ProjectMembershipRow.user_id == access.user_id,
            )
        ).scalars()
    )
    if user is None or not user.active:
        return Access(access.user_id, access.pseudonym, False)
    return Access(
        access.user_id, user.pseudonym, user.is_system_admin, {project_key: roles}
    )


def visible_documents(
    conn: Connection, access: Access, project_id: int, project_key: str
) -> DocumentFilter:
    fresh = current_access(conn, access, project_id, project_key)
    if can(fresh, Action.VIEW_ALL_DOCUMENTS, project_key):
        return DocumentFilter(True)
    tasks = [
        task
        for task, roles in TASK_ROLES.items()
        if fresh.roles_in(project_key) & roles
    ]
    if not tasks:
        return DocumentFilter(False)
    ids = conn.execute(
        select(AssignmentRow.document_id)
        .where(
            AssignmentRow.project_id == project_id,
            qualifying_assignment(fresh.user_id),
        )
        .distinct()
    ).scalars()
    return DocumentFilter(False, frozenset(ids))


def require_document(
    conn: Connection,
    access: Access,
    project_id: int,
    project_key: str,
    document_id: str,
    *,
    fresh: bool = False,
) -> None:
    """``fresh``: ``access`` was just read by ``current_access``; skip re-reading."""
    if not fresh:
        access = current_access(conn, access, project_id, project_key)
    # Same rule as ``visible_documents``, but probes the one document instead of
    # fetching every assigned id (hot path: several calls per editor request).
    if can(access, Action.VIEW_ALL_DOCUMENTS, project_key):
        return
    if not any(access.roles_in(project_key) & roles for roles in TASK_ROLES.values()):
        raise DomainError("DOCUMENT_NOT_FOUND")
    visible = conn.execute(
        select(AssignmentRow.id)
        .where(
            AssignmentRow.project_id == project_id,
            AssignmentRow.document_id == document_id,
            qualifying_assignment(access.user_id),
        )
        .limit(1)
    ).first()
    if visible is None:
        raise DomainError("DOCUMENT_NOT_FOUND")


def qualifying_assignment(user_id: int) -> ColumnElement[bool]:
    """Central SQL predicate shared by document and cross-project projections."""
    return and_(
        AssignmentRow.user_id == user_id,
        AssignmentRow.revoked_at.is_(None),
        exists().where(UserRow.id == user_id, UserRow.active.is_(True)),
        or_(
            *(
                and_(
                    AssignmentRow.task == task,
                    AssignmentRow.lead_correction.is_(False),
                    exists().where(
                        ProjectMembershipRow.project_id == AssignmentRow.project_id,
                        ProjectMembershipRow.user_id == user_id,
                        ProjectMembershipRow.role.in_(roles),
                    ),
                )
                for task, roles in TASK_ROLES.items()
            ),
            # FD2: a lead's own correction holds through the lead role only;
            # it ends with that role even if the lead is also an annotator.
            and_(
                AssignmentRow.task == "translation_review",
                AssignmentRow.lead_correction.is_(True),
                exists().where(
                    ProjectMembershipRow.project_id == AssignmentRow.project_id,
                    ProjectMembershipRow.user_id == user_id,
                    ProjectMembershipRow.role == "lead",
                ),
            ),
        ),
    )


def readable_case_documents(
    conn: Connection, access: Access, project_id: int, project_key: str
) -> DocumentFilter:
    """Current exact task texts, with scoped review inputs for authorized tasks."""
    fresh = current_access(conn, access, project_id, project_key)
    if can(fresh, Action.VIEW_ALL_DOCUMENTS, project_key):
        return DocumentFilter(True)
    assignments = conn.execute(
        select(AssignmentRow.document_id, AssignmentRow.task, DocumentRow.case_id)
        .join(
            DocumentRow,
            and_(
                DocumentRow.project_id == AssignmentRow.project_id,
                DocumentRow.document_id == AssignmentRow.document_id,
            ),
        )
        .where(
            AssignmentRow.project_id == project_id, qualifying_assignment(fresh.user_id)
        )
    ).all()
    ids = {row.document_id for row in assignments}
    # Frozen human source texts are visible only through an exact offered input.
    from ontocurator.storage.tables import SubmissionRow
    from ontocurator.storage.workflow_tables import RoundInputRow, WorkRoundRow

    ids.update(
        conn.execute(
            select(SubmissionRow.document_id)
            .join(
                RoundInputRow,
                and_(
                    RoundInputRow.project_id == SubmissionRow.project_id,
                    RoundInputRow.source_submission_id == SubmissionRow.submission_id,
                ),
            )
            .join(WorkRoundRow, WorkRoundRow.round_id == RoundInputRow.round_id)
            .join(AssignmentRow, AssignmentRow.id == WorkRoundRow.assignment_id)
            .where(
                RoundInputRow.project_id == project_id,
                qualifying_assignment(fresh.user_id),
            )
        ).scalars()
    )
    # The text of a frozen draft (a ``text_change`` round's source) is visible
    # the same way: only to the owner of a task offering one of its inputs.
    from ontocurator.storage.overview_tables import DraftSnapshotRow

    ids.update(
        conn.execute(
            select(DraftSnapshotRow.document_id)
            .join(
                RoundInputRow,
                and_(
                    RoundInputRow.project_id == DraftSnapshotRow.project_id,
                    RoundInputRow.source_draft_snapshot_id == DraftSnapshotRow.id,
                ),
            )
            .join(WorkRoundRow, WorkRoundRow.round_id == RoundInputRow.round_id)
            .join(AssignmentRow, AssignmentRow.id == WorkRoundRow.assignment_id)
            .where(
                RoundInputRow.project_id == project_id,
                qualifying_assignment(fresh.user_id),
            )
        ).scalars()
    )
    if not ids:
        return DocumentFilter(False)
    if can(fresh, Action.BROWSE_VERSIONS, project_key):
        siblings = conn.execute(
            select(DocumentRow.document_id).where(
                DocumentRow.project_id == project_id,
                DocumentRow.case_id.in_({row.case_id for row in assignments}),
            )
        ).scalars()
        return DocumentFilter(False, frozenset(siblings))
    review_cases = {
        row.case_id for row in assignments if row.task == "translation_review"
    }
    if review_cases:
        # Only metadata: opening a review here would create a draft and fetch text.
        variants = {
            row["document_id"]: VariantInfo(**row)
            for row in conn.execute(
                select(
                    *(getattr(DocumentRow, field.name) for field in fields(VariantInfo))
                ).where(
                    DocumentRow.project_id == project_id,
                    DocumentRow.case_id.in_(review_cases),
                )
            ).mappings()
        }
        for row in assignments:
            if row.task != "translation_review":
                continue
            target = variants[row.document_id]
            ancestor, source = resolve_translation_lineage(target, variants.get)
            ids.add(source.document_id)
            ids.update(
                v.document_id
                for v in translation_review_comparisons(
                    target, ancestor, variants.values()
                )
            )
    return DocumentFilter(False, frozenset(ids))


def require_case_text(
    conn: Connection,
    access: Access,
    project_id: int,
    project_key: str,
    document_id: str,
) -> None:
    fresh = current_access(conn, access, project_id, project_key)
    if not can(fresh, Action.VIEW_PROJECT, project_key):
        raise DomainError("PROJECT_NOT_FOUND")
    if can(fresh, Action.VIEW_ALL_DOCUMENTS, project_key):
        if (
            conn.execute(
                select(DocumentRow.document_id).where(
                    DocumentRow.project_id == project_id,
                    DocumentRow.document_id == document_id,
                )
            ).first()
            is None
        ):
            raise DomainError("DOCUMENT_NOT_FOUND")
        return
    visibility = readable_case_documents(conn, fresh, project_id, project_key)
    if document_id not in visibility.document_ids:
        raise DomainError("DOCUMENT_NOT_FOUND")


def may_read_translation_review_output_metadata(
    conn: Connection, access: Access, project_id: int, document_id: str
) -> bool:
    """Exact own review output metadata; no text or general browsing authority."""
    return (
        conn.execute(
            select(TranslationReviewRow.id)
            .join(
                AssignmentRow,
                and_(
                    AssignmentRow.id == TranslationReviewRow.assignment_id,
                    AssignmentRow.project_id == TranslationReviewRow.project_id,
                    AssignmentRow.document_id == TranslationReviewRow.document_id,
                    AssignmentRow.user_id == TranslationReviewRow.reviewer_user_id,
                ),
            )
            .where(
                TranslationReviewRow.project_id == project_id,
                TranslationReviewRow.created_variant_id == document_id,
                TranslationReviewRow.reviewer_user_id == access.user_id,
                AssignmentRow.task == "translation_review",
                qualifying_assignment(access.user_id),
            )
            .limit(1)
        ).first()
        is not None
    )


def project_document_filters(
    conn: Connection, access: Access
) -> dict[str, DocumentFilter]:
    """All currently visible projects in three bounded queries."""
    user = (
        conn.execute(select(UserRow).where(UserRow.id == access.user_id))
        .mappings()
        .one_or_none()
    )
    if user is None or not user["active"]:
        return {}
    rows = conn.execute(
        select(
            ProjectRow.id, ProjectRow.project_key, ProjectMembershipRow.role
        ).outerjoin(
            ProjectMembershipRow,
            and_(
                ProjectMembershipRow.project_id == ProjectRow.id,
                ProjectMembershipRow.user_id == access.user_id,
            ),
        )
    ).all()
    roles: dict[str, set[Role]] = {}
    projects = {}
    for project_id, key, role in rows:
        projects[key] = project_id
        if role is not None:
            roles.setdefault(key, set()).add(cast(Role, role))
    fresh = Access(
        access.user_id,
        user["pseudonym"],
        user["is_system_admin"],
        {key: frozenset(value) for key, value in roles.items()},
    )
    assigned: dict[int, set[str]] = {}
    for project_id, document_id in conn.execute(
        select(AssignmentRow.project_id, AssignmentRow.document_id)
        .where(qualifying_assignment(access.user_id))
        .distinct()
    ):
        assigned.setdefault(project_id, set()).add(document_id)
    return {
        key: DocumentFilter(
            can(fresh, Action.VIEW_ALL_DOCUMENTS, key),
            frozenset(assigned.get(project_id, ())),
        )
        for key, project_id in projects.items()
        if can(fresh, Action.VIEW_PROJECT, key)
    }
