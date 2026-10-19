"""Test helper: insert an immutable translation review row directly."""

from sqlalchemy import insert, select

from ontocurator.storage.database import Database
from ontocurator.storage.tables import (
    AssignmentRow,
    ProjectRow,
    TranslationReviewRow,
)


def insert_review(
    db: Database, project_key: str, document_id: str, decision: str
) -> int:
    """Record a review of ``document_id`` with ``decision``; returns its id."""
    with db.transaction() as conn:
        pid = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == project_key)
        ).scalar_one()
        assignment = conn.execute(
            select(AssignmentRow.id, AssignmentRow.user_id)
            .where(AssignmentRow.project_id == pid)
            .order_by(AssignmentRow.id)
            .limit(1)
        ).one()
        return conn.execute(
            insert(TranslationReviewRow)
            .values(
                project_id=pid,
                document_id=document_id,
                assignment_id=assignment.id,
                reviewer_user_id=assignment.user_id,
                reviewer_pseudonym="reader",
                reviewer_qualification="physician",
                reviewer_languages=["en", "de"],
                decision=decision,
                clinical_change=False,
                machine_text_sha256="a" * 64,
                proposed_text="text",
                proposed_text_sha256="a" * 64,
                status_before="ready_for_review",
                status_after="reviewed",
                review_policy="ontocurator-translation-review/v1",
            )
            .returning(TranslationReviewRow.id)
        ).scalar_one()
