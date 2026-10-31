"""Lead-only Documents read API: grouped rows and per-row submissions."""

from datetime import datetime
from typing import Annotated, Any, Literal, Self

from fastapi import APIRouter, Depends, Query, Request
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, Field, model_validator

from ontotator.api.document_projection import AssignmentFilter, AssignmentStatus
from ontotator.api.encoded_routes import EncodedParameterRoute
from ontotator.api.identity import PrincipalDep
from ontotator.api.person_views import PersonRefView
from ontotator.api.routes import get_access, get_ontology
from ontotator.api.work_plan_routes import (
    MAX_SELECTED_ROWS,
    PlanFlagsView,
    RowRefView,
    require_one_selection,
)
from ontotator.application.document_row_facets import FlagFilter
from ontotator.application.document_rows import (
    MAX_RETAIN,
    DocumentRowsService,
    FinalFilter,
    Paused,
    PlanFilter,
    ProposalFilter,
    RowQuery,
    Segment,
    Sort,
)
from ontotator.auth.audit import Actor
from ontotator.authz.policy import Task
from ontotator.domain.annotation_modes import AnnotationMode, ModeSource, TextMode
from ontotator.domain.document_rows import BarCategory
from ontotator.domain.next_steps import (
    Badge,
    RowAction,
    Stage,
    StepCode,
    StepKind,
)
from ontotator.domain.stage_cells import (
    AnnotationState,
    CellNote,
    FinalState,
    ReviewState,
    Tone,
)
from ontotator.domain.submission_labels import SubmissionKind
from ontotator.domain.variants import TranslationStatus, VariantOrigin
from ontotator.domain.work_plans import RowKey

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
    # F1 (FD1): the lead's own correction of a rejected or queried version.
    lead_correction: bool = False
    # Text changes (V5): version this (revoked) work was moved to.
    moved_to_version: int | None = None
    # Spec 2026-10-23 §2: assignment date, assigner and the annotation mode
    # fixed at assignment time (annotate only).
    assigned_at: datetime | None = None
    assigned_by: PersonRefView | None = None
    annotation_mode: AnnotationMode | None = None
    # Spec 2026-10-25 §2: annotate work the lead confirmed before the
    # translation review was accepted (the History line).
    unreviewed_translation: bool = False
    # Issue 213: closed until the translation review of its version is accepted.
    waiting_for_translation_review: bool = False
    # Closed on a version the text moved on from: the lead decides.
    waiting_for_lead: bool = False


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
    # Waiting on (VD8): every person of the step; for an in-progress step the
    # people of every in-progress step of the row.
    people: list[PersonRefView] = Field(default_factory=list)


class StageCellDetailView(_View):
    """Muted second line of a stage cell (documents overview "Stage cells")."""

    people: list[PersonRefView] = Field(default_factory=list)
    assigned: int | None = None
    target: int | None = None
    submitted: int | None = None
    total: int | None = None
    version: int | None = None
    from_version: int | None = None
    at: datetime | None = None
    findings: int | None = None
    excerpt: str | None = None
    reason: str | None = None  # free text only ("Dosis prüfen")
    note: CellNote | None = None
    matching: int | None = None
    compared: int | None = None
    causes: list[str] = Field(default_factory=list)  # Final confirm cause codes
    round_ordinal: int | None = None
    # Final ``choose``: the final-result panel's label rule (VD16); None in
    # every other state.
    label_rule: Literal["accept", "compare"] | None = None
    # Final ``choose`` under the rule "compare": the card's full agreement
    # (W1), so also on notes and modifier text spans. A factory default keeps
    # it optional in the generated types.
    all_match: bool = Field(default_factory=bool)


class StageCellView(_View):
    state: str  # ReviewState | AnnotationState | FinalState
    tone: Tone
    detail: StageCellDetailView


class RowStagesView(_View):
    review: StageCellView
    annotation: StageCellView
    final: StageCellView


class VersionMarkerView(_View):
    """Text cell marker: "v2 corrected", "v2" or "{version} translations"
    (parallel roots: ``version`` is the number of roots)."""

    kind: Literal["corrected", "version", "parallel"]
    version: int


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
    badges: list[Badge] = Field(default_factory=list)
    assigned: int | None = None
    target: int | None = None
    owner: StepOwnerView
    detail: StepDetailView | None = None
    report_id: str | None = None
    assignment_id: int | None = None
    # Text changes (V5): the submitted old-version work of "Carry to v2…".
    submission_id: str | None = None
    document_id: str | None = None


class AnnotationModeView(_View):
    """The text's annotation mode as the card, plan dialog and rows show it."""

    mode: AnnotationMode
    source: ModeSource
    locked: bool
    override: AnnotationMode | None = None
    proposal_count: int = 0
    # Submissions of the text discarded by a mode change (restorable, #109).
    # A factory default keeps it optional in the generated types.
    discarded_count: int = Field(default_factory=int)

    @classmethod
    def of(
        cls, mode: TextMode, override: AnnotationMode | None, proposal_count: int
    ) -> "AnnotationModeView":
        return cls(
            mode=mode.mode,
            source=mode.source,
            locked=mode.locked,
            override=override,
            proposal_count=proposal_count,
        )


class ConsolidationProgressView(_View):
    """The row's active consolidation round with its open and total groups."""

    round_id: str
    open: int
    total: int


class DocumentRowView(_View):
    case_id: str
    language: str
    is_source: bool
    position: int | None
    versions: list[DocumentVersionView]
    parallel_roots: bool
    work: list[WorkItemView]
    # Revoked assignments moved to a newer version (V5, Text versions).
    moved_work: list[WorkItemView] = Field(default_factory=list)
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
    # Documents overview: Review, Annotation and Final cells and the Text
    # cell's version marker.
    stages: RowStagesView | None = None
    version_marker: VersionMarkerView | None = None
    # New-item signal (VD6): a lead-owned next step with activity by others
    # since the start of the viewer's previous Documents visit.
    new: bool = False
    others_activity_at: datetime | None = None
    # Findings flagged "guidelines unclear" in the submitted consolidation of
    # the row's current version (round ``flagged_round_id``; with several live
    # chains the first chain's), and its first flagged group: the read-only
    # consolidation view ``#/consolidations/{flagged_round_id}?group=`` (X5).
    flagged_unclear: int = 0
    flagged_group_id: str | None = None
    flagged_round_id: str | None = None
    # Spec 2026-10-23 §2, §2b: proposals of the newest proposal set of the
    # row's target document, the text's annotation mode (None: not planned
    # for annotation and no annotation work) and the progress of an active
    # consolidation round (shown rows only).
    proposal_count: int = 0
    annotation_mode: AnnotationModeView | None = None
    consolidation_progress: ConsolidationProgressView | None = None
    # Spec 2026-10-25 §2: the rule is off and the translation is not accepted,
    # so annotating it needs an explicit acknowledgement.
    unreviewed_translation: bool = False


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
    # What ``shown`` would be under the All tab; only with a search, else 0.
    all_tab_shown: int = 0
    # Rows with a final result in the whole project, independent of filters
    # and paging (FD12: Documents shows "Export final results…" when > 0).
    finals: int = 0
    # Segments (D21): rows in the plan by the kind of their next step.
    in_plan: int = 0
    needs_decision: int = 0
    to_assign: int = 0
    in_progress: int = 0
    # "Needs your decision" rows per category (hyphenated category keys).
    decision_categories: dict[str, int] = Field(default_factory=dict)
    # Tabs (documents overview): in-plan rows whose next step is done, every
    # row, undecided rows (counted in needs_decision too, V10). Tab counts
    # ignore filters and search.
    done: int = 0
    all: int = 0
    not_decided: int = 0
    # Filter popover: group -> value -> rows under the tab, search and every
    # other group (a group's own selection is ignored).
    facets: dict[str, dict[str, int]] = Field(default_factory=dict)


class DocumentCaseIds(_View):
    case_ids: list[str]
    total: int
    truncated: bool


class DocumentRowsPage(_View):
    groups: list[DocumentGroupView]
    page: int
    page_count: int
    group_count: int
    text_count: int
    bar: DecisionBarView
    case_found: bool
    # The project's current rule.
    adjudicator_not_annotator: bool


class SelectedRowsRequest(_View):
    """Show selected: a selection is too long for a query string (VD21)."""

    rows: list[RowRefView] = Field(max_length=MAX_SELECTED_ROWS)
    page: int = Field(default=1, ge=1)
    sort: Sort = "case"

    @model_validator(mode="after")
    def _one_selection(self) -> Self:
        require_one_selection((), self.rows)
        return self


class DocumentsVisitView(_View):
    """Start of the previous visit: NEW compares activity with it (VD6)."""

    baseline_at: datetime


class DocumentsSummaryView(_View):
    """Navigation counter "Documents (n)": rows needing the lead (V10)."""

    needs_decision: int


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
    guideline_version: int | None = None
    guideline_withdrawn: bool = False
    # Consolidation submissions: findings kept automatically (all matched, U14).
    # A factory default keeps it optional in the generated types: the
    # submission history builds own rows without it.
    kept_automatically: int = Field(default_factory=int)


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


class ConsolidationOriginsView(_View):
    """How the findings of a consolidation came about (#133); they add up to
    ``finding_count``."""

    # Matching findings taken over automatically, unchanged.
    matched: int
    # Groups the consolidator decided, or taken-over findings they changed.
    decided: int
    # Findings the consolidator added outside every group.
    added: int


class FinalPanelSubmissionView(RowSubmissionView):
    # The lead may use it as final (false: own result under the
    # adjudicator rule, OWN_RESULT_NOT_SELECTABLE).
    eligible: bool = True
    # Findings found in no other compared submission; None when not compared.
    only_here: int | None = None
    # Eligible on the compared version (spec VD16).
    comparable: bool = False
    # Consolidation submissions only; None for every other kind.
    consolidation_origins: ConsolidationOriginsView | None = None


class AgreementDetailView(_View):
    """A matching finding whose note, text span or modifier text differs
    (issue 230); ``term_label`` is the term's name, else its id."""

    kind: Literal["note", "text", "modifiers"]
    layer_id: str
    term_id: str
    term_label: str


class AgreementView(_View):
    compared_version: int
    total: int
    matching: int
    context_differences: int
    detail_differences: list[AgreementDetailView] = Field(default_factory=list)


class FinalPanelView(_View):
    submissions: list[FinalPanelSubmissionView] = Field(default_factory=list)
    agreement: AgreementView | None = None
    label_rule: Literal["accept", "compare"] = "compare"
    accept_submission_id: str | None = None
    # Full agreement (W1): every consolidation group of the compared eligible
    # submissions matches; "Accept as final" selects this submission (the
    # earliest eligible one). False under the label rule "accept".
    all_match: bool = False
    all_match_submission_id: str | None = None
    causes: list[RowItemView] = Field(default_factory=list)
    # Findings of a final on old text in changed passages of the newer text.
    changed_passages: int | None = None


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
    language: Annotated[list[str] | None, Query()] = None,
    status: AssignmentFilter | None = None,
    q: Annotated[
        str | None,
        Query(description='Part of a case/external/document ID or "case-104 de"'),
    ] = None,
    origin: Annotated[list[VariantOrigin] | None, Query()] = None,
    translation_status: TranslationStatus
    | Literal["accepted_without_review"]
    | None = None,
    decision: Decision | None = None,
    final: FinalFilter | None = None,
    case: str | None = None,
    segment: Segment | None = None,
    step: Annotated[list[StepCode] | None, Query()] = None,
    stage: Annotated[list[Stage] | None, Query()] = None,
    owner: Annotated[str | None, Query(description='"me" or a pseudonym')] = None,
    assignee: Annotated[
        str | None, Query(description="Pseudonym with non-revoked work on the row")
    ] = None,
    plan: Annotated[list[PlanFilter] | None, Query()] = None,
    paused: Paused | None = None,
    sort: Sort = "case",
    review_state: Annotated[list[ReviewState] | None, Query()] = None,
    annotation_state: Annotated[list[AnnotationState] | None, Query()] = None,
    final_state: Annotated[list[FinalState] | None, Query()] = None,
    waiting_on: Annotated[
        list[str] | None, Query(description='"me" or a pseudonym')
    ] = None,
    flags: Annotated[list[FlagFilter] | None, Query()] = None,
    proposals: Annotated[list[ProposalFilter] | None, Query()] = None,
) -> dict[str, Any]:
    """Filters shared by the rows page and the filtered case IDs.

    ``language``, ``origin``, ``step``, ``stage``, ``plan``, the stage states,
    ``waiting_on``, ``flags`` and ``proposals`` repeat: OR within one, AND
    across.
    """
    if decision is not None and final is not None:
        raise _exclusive("final", "decision")
    if decision is not None and segment is not None:
        raise _exclusive("segment", "decision")
    return {
        "language": tuple(language or ()),
        "status": status,
        "q": q,
        "origin": tuple(origin or ()),
        "translation_status": translation_status,
        "decision": decision,
        "final": final,
        "case": case,
        "segment": segment,
        "step": tuple(step or ()),
        "stage": tuple(stage or ()),
        "owner": owner,
        "assignee": assignee,
        "plan": tuple(plan or ()),
        "paused": paused,
        "sort": sort,
        "review_state": tuple(review_state or ()),
        "annotation_state": tuple(annotation_state or ()),
        "final_state": tuple(final_state or ()),
        "waiting_on": tuple(waiting_on or ()),
        "flags": tuple(flags or ()),
        "proposals": tuple(proposals or ()),
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


@router.post("/document-rows/selected", response_model=DocumentRowsPage)
def selected_document_rows(
    key: str, body: SelectedRowsRequest, principal: PrincipalDep, request: Request
) -> dict[str, Any]:
    """The rows page of exactly the selected texts; no other filter applies."""
    selected = frozenset(RowKey(row.case_id, row.language) for row in body.rows)
    return _service(request, principal).page(
        key, RowQuery(selected=selected, page=body.page, sort=body.sort)
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


@router.get(
    "/document-rows/{case_id:path}/{language}/final-panel",
    response_model=FinalPanelView,
)
def row_final_panel(
    key: str, case_id: str, language: str, principal: PrincipalDep, request: Request
) -> dict[str, Any]:
    """Final-result panel of one row: submissions, agreement, label rule,
    causes and changed passages (leads only, nothing stored)."""
    data = _service(request, principal).final_panel(key, case_id, language)
    details = (data.get("agreement") or {}).get("detail_differences") or []
    if details:
        repo, ontology = request.app.state.repo, get_ontology(request)
        labels: dict[tuple[str, str], str] = {}
        for item in details:
            term = (item["layer_id"], item["term_id"])
            if term not in labels:
                status = ontology.for_package_layer(repo, key, term[0]).validate_term(
                    term[1]
                )
                labels[term] = status.label or term[1]
            item["term_label"] = labels[term]
    return data


@router.post("/documents/visit", response_model=DocumentsVisitView)
def documents_visit(
    key: str, principal: PrincipalDep, request: Request
) -> dict[str, Any]:
    """Record an opening of Documents; returns the NEW baseline (leads only).

    Openings with gaps under 30 minutes form one visit; after a longer gap the
    baseline moves to the previous opening.
    """
    return _service(request, principal).visit(key)


@router.get("/documents/summary", response_model=DocumentsSummaryView)
def documents_summary(
    key: str, principal: PrincipalDep, request: Request
) -> dict[str, Any]:
    """Rows whose next step needs the lead's decision (leads only)."""
    return _service(request, principal).summary(key)
