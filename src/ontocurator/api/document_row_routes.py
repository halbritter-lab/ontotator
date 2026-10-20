"""Lead-only Documents read API: grouped rows and per-row submissions."""

from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, Request
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, Field

from ontocurator.api.document_projection import AssignmentFilter, AssignmentStatus
from ontocurator.api.encoded_routes import EncodedParameterRoute
from ontocurator.api.identity import PrincipalDep
from ontocurator.api.person_views import PersonRefView
from ontocurator.api.routes import get_access
from ontocurator.api.work_plan_routes import PlanFlagsView
from ontocurator.application.document_rows import (
    MAX_RETAIN,
    DocumentRowsService,
    PlanFilter,
    RowQuery,
    Segment,
    Sort,
)
from ontocurator.auth.audit import Actor
from ontocurator.authz.policy import Task
from ontocurator.domain.document_rows import BarCategory
from ontocurator.domain.next_steps import RowAction, Stage, StepCode, StepKind
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


class VersionAcceptanceView(_View):
    """Newest acceptance record of a translation version (lead workflow)."""

    source: Literal["package", "lead", "override"]
    reason: str | None = None
    accepted_at: datetime | None = None
    accepted_by: PersonRefView | None = None
    # Package metadata (``translation.review``), kept only as given.
    reviewer: str | None = None
    reviewed_at: str | None = None


class VersionDiscardView(_View):
    """Discard record of a text version (lead workflow)."""

    reason: str | None = None
    discarded_at: datetime | None = None
    discarded_by: PersonRefView | None = None


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
    acceptance: VersionAcceptanceView | None = None
    discarded: VersionDiscardView | None = None


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
    # Lead workflow (D1): the assignee as a person reference.
    person: PersonRefView | None = None


class ReportIssueView(_View):
    report_id: str
    excerpt: str
    reporter_label: str
    created_at: datetime
    task_state: Literal["paused", "resumed"]
    reporter: PersonRefView | None = None


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
    author: PersonRefView | None = None


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


class RowProblemReport(_View):
    report_id: str
    title: str
    reporter_label: str
    created_at: datetime
    state: Literal["open", "resolved", "withdrawn"]
    active_hold_count: int
    reporter: PersonRefView | None = None


class StepOwnerView(_View):
    kind: Literal["you", "person", "people", "none"]
    person: PersonRefView | None = None
    count: int = 0


class StepDetailView(_View):
    """Secondary line of a next step (spec "Next step")."""

    kind: Literal[
        "version",
        "source_ready",
        "annotations_submitted",
        "round",
        "report",
        "final",
        "review_only",
        "waiting",
    ]
    version: int | None = None
    origin: VariantOrigin | None = None
    translation_status: TranslationStatus | None = None
    submitted: int | None = None
    total: int | None = None
    round_ordinal: int | None = None
    excerpt: str | None = None
    reporter: PersonRefView | None = None
    task_paused: bool = False


class NextStepView(_View):
    code: StepCode
    kind: StepKind
    stage: Stage
    action: RowAction | None = None
    badges: list[Literal["your_decision", "check_failed", "paused"]] = Field(
        default_factory=list
    )
    assigned: int | None = None
    target: int | None = None
    owner: StepOwnerView
    detail: StepDetailView | None = None
    report_id: str | None = None
    assignment_id: int | None = None
    document_id: str | None = None


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
    # Every report of the row, newest first. A factory default keeps the field
    # optional in the generated types (older fixtures and clients omit it).
    problem_reports: list[RowProblemReport] = Field(default_factory=list)
    # Lead workflow: the row's next step (first of ``steps``), every matching
    # step, its work-plan flags and whether it is in the plan (own fact).
    next_step: NextStepView | None = None
    steps: list[NextStepView] = Field(default_factory=list)
    plan_row: PlanFlagsView | None = None
    in_plan: bool = True


class DocumentGroupView(_View):
    case_id: str
    rows: list[DocumentRowView]
    language_count: int
    final_count: int
    issue_count: int
    note_count: int
    last_activity_at: datetime | None
    has_issue: bool
    plan_revision: int = 1
    # Languages of the case's rows that are not in the plan (source first).
    not_in_plan_languages: list[str] = Field(default_factory=list)


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
    # Segments (D21): rows in the plan by the kind of their next step.
    in_plan: int = 0
    needs_decision: int = 0
    to_assign: int = 0
    in_progress: int = 0
    # "Needs your decision" rows per category (hyphenated category keys).
    decision_categories: dict[str, int] = Field(default_factory=dict)


class DocumentCaseIds(_View):
    case_ids: list[str]
    total: int
    truncated: bool


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
    author: PersonRefView | None = None


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
    author: PersonRefView | None = None


class OpenTranslationReviewView(_View):
    assignment_id: int
    document_id: str
    version: int
    chain_name: str | None
    reviewer_label: str
    is_me: bool
    reviewer: PersonRefView | None = None


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


def _exclusive(name: str, other: str) -> RequestValidationError:
    return RequestValidationError(
        [
            {
                "loc": ("query", name),
                "msg": f"{other} and {name} are mutually exclusive",
                "type": "value_error",
            }
        ]
    )


def _filters(
    language: str | None = None,
    status: AssignmentFilter | None = None,
    q: str | None = None,
    origin: VariantOrigin | None = None,
    translation_status: TranslationStatus
    | Literal["accepted_without_review"]
    | None = None,
    decision: Decision | None = None,
    final: Literal["missing", "none"] | None = None,
    case: str | None = None,
    segment: Segment | None = None,
    step: StepCode | None = None,
    stage: Stage | None = None,
    owner: Annotated[str | None, Query(description='"me" or a pseudonym')] = None,
    plan: PlanFilter | None = None,
    sort: Sort = "case",
) -> dict[str, Any]:
    """Filters shared by the rows page and the filtered case IDs."""
    if decision is not None and final is not None:
        raise _exclusive("final", "decision")
    if decision is not None and segment is not None:
        raise _exclusive("segment", "decision")
    return {
        "language": language,
        "status": status,
        "q": q,
        "origin": origin,
        "translation_status": translation_status,
        "decision": decision,
        "final": final,
        "case": case,
        "segment": segment,
        "step": step,
        "stage": stage,
        "owner": owner,
        "plan": plan,
        "sort": sort,
    }


FiltersDep = Annotated[dict[str, Any], Depends(_filters)]


@router.get("/document-rows/case-ids", response_model=DocumentCaseIds)
def document_case_ids(
    key: str, principal: PrincipalDep, request: Request, filters: FiltersDep
) -> dict[str, Any]:
    """Case IDs matching the filters in list order, at most 2000 (leads only)."""
    return _service(request, principal).case_ids(key, RowQuery(**filters))


@router.get("/document-rows", response_model=DocumentRowsPage)
def document_rows(
    key: str,
    principal: PrincipalDep,
    request: Request,
    filters: FiltersDep,
    page: Annotated[int, Query(ge=1)] = 1,
    retain: Annotated[list[str] | None, Query(max_length=MAX_RETAIN)] = None,
) -> dict[str, Any]:
    """Documents rows grouped by text, with the decision bar (leads only)."""
    return _service(request, principal).page(
        key, RowQuery(**filters, page=page, retain=tuple(retain or ()))
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
