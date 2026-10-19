"""Lead-only Documents read API: grouped rows and per-row submissions."""

from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query, Request
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, Field

from ontocurator.api.document_projection import AssignmentFilter, AssignmentStatus
from ontocurator.api.encoded_routes import EncodedParameterRoute
from ontocurator.api.identity import PrincipalDep
from ontocurator.api.routes import get_access
from ontocurator.application.document_rows import (
    MAX_RETAIN,
    DocumentRowsService,
    RowQuery,
)
from ontocurator.auth.audit import Actor
from ontocurator.authz.policy import Task
from ontocurator.domain.document_rows import BarCategory
from ontocurator.domain.submission_labels import SubmissionKind
from ontocurator.domain.variants import TranslationStatus, VariantOrigin

router = APIRouter(
    prefix="/api/v1/projects/{key}",
    tags=["documents"],
    route_class=EncodedParameterRoute,
)

Decision = Literal[
    "all", "report-or-pause", "confirm-final", "translation", "missing-final"
]


class _View(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DocumentVersionView(_View):
    document_id: str
    external_id: str
    version: int
    origin: VariantOrigin
    derived_from: str | None
    chain_id: str
    chain_name: str
    translation_status: TranslationStatus | None
    accepted_without_review: bool
    latest_review_decision: str | None
    is_newest_in_chain: bool
    matches_filter: bool
    last_activity_at: datetime | None


class WorkItemView(_View):
    assignment_id: int
    document_id: str
    version: int
    author_label: str
    is_me: bool
    task: Task
    status: AssignmentStatus
    held: bool
    round_ordinal: int | None
    round_state: str | None


class ReportIssueView(_View):
    report_id: str
    excerpt: str
    reporter_label: str
    created_at: datetime
    task_state: Literal["paused", "resumed"]


class RowItemView(_View):
    code: str
    cause_id: str
    cause_revision: int
    document_id: str | None
    category: BarCategory | None
    version: int | None
    review_decision: str | None
    report: ReportIssueView | None
    report_id: str | None
    assignment_id: int | None
    author_label: str | None


class FinalSelectionSummary(_View):
    case_id: str
    language: str
    document_id: str
    submission_id: str
    revision: int
    selected_at: datetime | None
    updated_at: datetime | None
    selected_by: str | None
    kind: SubmissionKind | None
    round_ordinal: int | None
    author_label: str | None
    is_mine: bool
    version: int | None
    chain_name: str | None
    recorded_at: datetime | None
    is_newest_of_chain: bool
    # Snapshot at selection time; the current rule is on the page.
    adjudicator_not_annotator: bool | None


class MissingFinalView(_View):
    counts: bool
    reason: Literal["no_submission", "work_open"] | None


class BulkTargetView(_View):
    document_id: str | None
    mode: Literal["checkbox", "choose_in_versions"]


class OpenTargetView(_View):
    document_id: str
    reason: Literal["final", "newest", "most_recent_root"]
    label: str | None


class DocumentRowView(_View):
    case_id: str
    language: str
    is_source: bool
    position: int | None
    versions: list[DocumentVersionView]
    parallel_roots: bool
    work: list[WorkItemView]
    final: FinalSelectionSummary | None
    issues: list[RowItemView]
    notes: list[RowItemView]
    missing_final: MissingFinalView
    categories: list[BarCategory]
    bulk: BulkTargetView
    open: OpenTargetView
    own_open_assignment_id: int | None
    last_activity_at: datetime | None
    pinned: bool
    retained: bool
    matches_decision: bool


class DocumentGroupView(_View):
    case_id: str
    rows: list[DocumentRowView]
    language_count: int
    final_count: int
    issue_count: int
    note_count: int
    last_activity_at: datetime | None
    has_issue: bool


class DecisionBarView(BaseModel):
    """Rows per category; hyphenated categories map to underscore fields."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    total: int
    report_or_pause: int = Field(validation_alias="report-or-pause")
    confirm_final: int = Field(validation_alias="confirm-final")
    translation: int
    missing_final: int = Field(validation_alias="missing-final")
    no_final: int
    shown: int


class DocumentRowsPage(_View):
    groups: list[DocumentGroupView]
    page: int
    page_count: int
    group_count: int
    bar: DecisionBarView
    case_found: bool
    # The project's current rule.
    adjudicator_not_annotator: bool


class RowSubmissionView(_View):
    submission_id: str
    document_id: str
    version: int
    chain_name: str | None
    author_label: str
    is_me: bool
    recorded_at: datetime
    mode: str
    kind: SubmissionKind
    round_id: str | None
    round_ordinal: int | None
    round_state: str | None
    is_latest_in_round: bool | None
    finding_count: int


class RowRoundView(_View):
    round_id: str
    assignment_id: int
    predecessor_round_id: str | None
    document_id: str
    version: int
    chain_name: str | None
    kind: str
    mode: str
    state: str
    author_label: str
    is_me: bool
    round_ordinal: int | None
    submitted: bool


class OpenTranslationReviewView(_View):
    assignment_id: int
    document_id: str
    version: int
    chain_name: str | None
    reviewer_label: str
    is_me: bool


class RowSubmissions(_View):
    case_id: str
    language: str
    # The project's current rule.
    adjudicator_not_annotator: bool
    submissions: list[RowSubmissionView]
    rounds: list[RowRoundView]
    open_translation_reviews: list[OpenTranslationReviewView]


def _service(request: Request, principal: Any) -> DocumentRowsService:
    return DocumentRowsService(
        request.app.state.repo.db,
        Actor.user(principal.user_id, principal.username),
        get_access(request),
    )


@router.get("/document-rows", response_model=DocumentRowsPage)
def document_rows(
    key: str,
    principal: PrincipalDep,
    request: Request,
    language: str | None = None,
    status: AssignmentFilter | None = None,
    q: str | None = None,
    origin: VariantOrigin | None = None,
    translation_status: TranslationStatus
    | Literal["accepted_without_review"]
    | None = None,
    decision: Decision | None = None,
    final: Literal["missing"] | None = None,
    case: str | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    retain: Annotated[list[str] | None, Query(max_length=MAX_RETAIN)] = None,
) -> dict[str, Any]:
    """Documents rows grouped by text, with the decision bar (leads only)."""
    if decision is not None and final is not None:
        raise RequestValidationError(
            [
                {
                    "loc": ("query", "final"),
                    "msg": "decision and final are mutually exclusive",
                    "type": "value_error",
                }
            ]
        )
    return _service(request, principal).page(
        key,
        RowQuery(
            language=language,
            status=status,
            q=q,
            origin=origin,
            translation_status=translation_status,
            decision=decision,
            final=final,
            case=case,
            page=page,
            retain=tuple(retain or ()),
        ),
    )


@router.get(
    "/document-rows/{case_id:path}/{language}/submissions",
    response_model=RowSubmissions,
)
def row_submissions(
    key: str, case_id: str, language: str, principal: PrincipalDep, request: Request
) -> dict[str, Any]:
    """All submissions, rounds and open translation reviews of one row."""
    return _service(request, principal).submissions(key, case_id, language)
