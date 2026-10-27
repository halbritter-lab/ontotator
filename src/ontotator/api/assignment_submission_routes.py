"""The submissions of one assignment across all its rounds (owner and leads)."""

from datetime import datetime

from fastapi import APIRouter, Request
from pydantic import BaseModel

from ontotator.api.identity import PrincipalDep
from ontotator.api.routes import get_access, get_repo
from ontotator.application.round_reads import assignment_submissions
from ontotator.assignments.service import AssignmentService


class AssignmentSubmissionView(BaseModel):
    submission_id: str
    round_id: str | None
    round_ordinal: int | None
    recorded_at: datetime
    finding_count: int
    document_id: str
    language: str
    version: int


router = APIRouter(prefix="/api/v1", tags=["work-rounds"])


@router.get("/assignments/{assignment_id}/submissions")
def list_assignment_submissions(
    assignment_id: int, request: Request, principal: PrincipalDep
) -> list[AssignmentSubmissionView]:
    repo = get_repo(request)
    # One snapshot: the authorization and the listed facts show one state.
    with repo.db.snapshot() as conn:
        assignment = AssignmentService.readable(
            conn, assignment_id, get_access(request)
        )
        return [
            AssignmentSubmissionView(**item)
            for item in assignment_submissions(
                repo, assignment.project_key, assignment_id
            )
        ]
