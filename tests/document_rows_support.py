"""Shared helpers for the Documents read-model tests."""

from typing import Any

from sqlalchemy import select

from ontocurator.application.document_rows import DocumentRowsService
from ontocurator.auth.audit import Actor
from ontocurator.authz.policy import Access
from ontocurator.storage.tables import ProjectMembershipRow, ProjectRow


def service(env: Any, username: str = "leader") -> DocumentRowsService:
    """A DocumentRowsService acting as ``username`` with its current roles."""
    user = env.app.state.accounts.get_by_username(username)
    roles: dict[str, set[str]] = {}
    with env.db.transaction() as conn:
        for key, role in conn.execute(
            select(ProjectRow.project_key, ProjectMembershipRow.role)
            .join(ProjectRow, ProjectRow.id == ProjectMembershipRow.project_id)
            .where(ProjectMembershipRow.user_id == user.id)
        ):
            roles.setdefault(key, set()).add(role)
    access = Access(
        user.id,
        user.pseudonym,
        user.is_system_admin,
        {key: frozenset(values) for key, values in roles.items()},  # type: ignore[misc]
    )
    return DocumentRowsService(env.db, Actor(user.id, f"user:{username}"), access)


def rows_of(page: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    """Rows of a page keyed by (case_id, language)."""
    return {
        (row["case_id"], row["language"]): row
        for group in page["groups"]
        for row in group["rows"]
    }
