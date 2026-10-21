"""Lead-only Documents read model. Shared project lock; causes from final_causes.

``load_facts`` reads everything the Documents table needs on the caller's
connection, one statement per fact, after ``authorize_final_results`` took the
shared project lock. ``document_row_page`` and ``document_row_submissions``
build the responses from these facts.
"""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

from sqlalchemy import Connection, and_, exists, func, select, union_all
from sqlalchemy.dialects.postgresql import JSONB

from ontocurator.application import document_row_panel, documents_visits
from ontocurator.application.document_row_page import (
    build_page,
    case_ids,
    needs_decision,
)
from ontocurator.application.document_row_reports import load_row_reports
from ontocurator.application.document_row_submissions import (
    build_submissions,
    lead_pseudonym_refs,
)
from ontocurator.application.final_causes import (
    authorize_final_results,
    derive_final_state,
    latest_review_decisions,
)
from ontocurator.application.people import person_refs
from ontocurator.auth.audit import Actor
from ontocurator.authz.policy import Access
from ontocurator.authz.scoped import ScopedRepository
from ontocurator.domain import document_rows as rules
from ontocurator.domain.next_steps import Stage, StepCode
from ontocurator.domain.work_plans import PlanFlags, RowKey
from ontocurator.storage import work_plan_store
from ontocurator.storage.database import Database
from ontocurator.storage.final_tables import FinalSelectionRow
from ontocurator.storage.overview_tables import TextChangeResolutionRow
from ontocurator.storage.repository import Repository
from ontocurator.storage.tables import (
    AssignmentRow,
    AuditEventRow,
    DocumentRow,
    DraftRow,
    ProjectRow,
    SubmissionRow,
    TranslationReviewDraftRow,
    TranslationReviewRow,
    UserRow,
)
from ontocurator.storage.workflow_tables import (
    ProblemReportEventRow,
    ProblemReportRow,
    ProblemReportStateRow,
    ReviewObligationResolutionRow,
    RoundSubmissionBindingRow,
    TaskHoldRow,
    TaskHoldStateRow,
    WorkRoundRow,
    WorkRoundStateRow,
)

PAGE_SIZE = rules.PAGE_SIZE  # re-export for existing callers
Decision = Literal[
    "all", "report-or-pause", "confirm-final", "translation", "missing-final"
]
# No segment: the All tab (every row, in plan or not; spec VD7).
Segment = Literal["decision", "assign", "progress", "done"]
# ``not_in_plan`` = flags off (undecided rows included); ``not_decided`` =
# undecided rows only (VD3).
PlanFilter = Literal[
    "review", "annotate", "review_and_annotate", "not_in_plan", "not_decided"
]
Sort = Literal["case", "-case", "import", "activity", "-activity"]
MAX_RETAIN = 200
EXCERPT_LENGTH = 120


FinalFilter = Literal["missing", "none", "any"]
Paused = Literal["yes", "no"]
REPEATABLE = (
    "language",
    "origin",
    "step",
    "stage",
    "plan",
    "review_state",
    "annotation_state",
    "final_state",
    "waiting_on",
)


def _values(value: Any) -> tuple[Any, ...]:
    """A repeatable filter as a tuple: ``None`` -> (), one value -> (value,)."""
    if value is None:
        return ()
    if isinstance(value, str):
        return (value,)
    return tuple(dict.fromkeys(value))


@dataclass(frozen=True)
class RowQuery:
    """Documents filters (follow-up spec FD10, documents overview facets).

    ``language``, ``origin``, ``step``, ``stage``, ``plan``, the stage states
    and ``waiting_on`` are repeatable: OR within one filter, AND across
    filters; empty means no filter. A single string is accepted as one value.
    """

    language: tuple[str, ...] = ()
    status: str | None = None  # unassigned|open|in_progress|submitted|reopened|held
    # Prefix of case ID, external ID or document ID, or the text label form
    # "case-104 de" / "case-104 · de" (spec VD11).
    q: str | None = None
    origin: tuple[str, ...] = ()  # VariantOrigin values of the row's versions
    translation_status: str | None = None  # adds accepted_without_review
    decision: Decision | None = None
    # "missing": no final result (any row); "none": Annotate on, no final
    # result; "any": the row has a final result.
    final: FinalFilter | None = None
    case: str | None = None
    page: int = 1
    segment: Segment | None = None  # bar segment of the row's next step
    step: tuple[StepCode, ...] = ()  # any of the row's steps
    stage: tuple[Stage, ...] = ()  # stage of the row's next step
    owner: str | None = None  # "me" or a pseudonym (owner of the next step)
    # Exclusive per row: review / annotate = only that flag on,
    # review_and_annotate = both, not_in_plan = neither (effective flags).
    plan: tuple[PlanFilter, ...] = ()
    # "yes": the row has a held annotate or review task; "no": it has none.
    paused: Paused | None = None
    # Facets of the documents overview: stage cell states and Waiting on
    # ("me" or a pseudonym).
    review_state: tuple[str, ...] = ()
    annotation_state: tuple[str, ...] = ()
    final_state: tuple[str, ...] = ()
    waiting_on: tuple[str, ...] = ()
    sort: Sort = "case"
    # "{case_id}:{language}" keys kept visible this visit (Task 5.9). A key
    # splits at the last ":" (case ids may contain ":"; language codes do not).
    retain: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        for name in REPEATABLE:
            object.__setattr__(self, name, _values(getattr(self, name)))
        if self.decision is not None and self.final is not None:
            raise ValueError("decision and final are mutually exclusive")
        if self.decision is not None and self.segment is not None:
            raise ValueError("decision and segment are mutually exclusive")
        if self.page < 1:
            raise ValueError("page starts at 1")
        if len(self.retain) > MAX_RETAIN:
            raise ValueError("too many retained rows")


@dataclass(frozen=True)
class RoundFact:
    round_id: str
    assignment_id: int
    predecessor_round_id: str | None
    document_id: str
    kind: str | None
    mode: str | None
    state: str
    latest_submission_id: str | None
    author_pseudonym: str


@dataclass(frozen=True)
class SubmissionFact:
    submission_id: str
    document_id: str
    annotator_id: str
    recorded_at: datetime
    mode: str
    round_id: str | None


@dataclass(frozen=True)
class ReportFact:
    report_id: str
    assignment_id: int | None
    excerpt: str
    reporter_label: str
    created_at: datetime
    task_state: Literal["paused", "resumed"]
    reporter_id: int | None = None


@dataclass(frozen=True)
class ReviewRecord:
    """The latest translation review decision of a version."""

    reviewer_id: int
    decided_at: datetime
    decision: str


@dataclass(frozen=True)
class ResolutionFact:
    """A ``text_change_resolutions`` row (documents overview V5)."""

    assignment_id: int | None
    submission_id: str | None
    resolution: str
    from_document_id: str
    to_document_id: str


@dataclass(frozen=True)
class SourceObligationFact:
    """An unresolved ``SOURCE_UPDATE_UNREVIEWED`` obligation (unfiltered)."""

    cause_id: str
    cause_revision: int
    old_source_document_id: str


@dataclass(frozen=True)
class RowFacts:
    project_key: str
    viewer_user_id: int
    viewer_pseudonym: str
    adjudicator_not_annotator: bool  # current project rule
    versions: list[rules.Version]
    accepted_without_review: frozenset[str]  # document ids
    assignments: list[rules.AssignmentFact]  # revoked included
    rounds: list[RoundFact]
    submission_counts: dict[str, int]  # document_id -> count
    selected_submissions: dict[str, SubmissionFact]  # submission_id -> fact
    # (assignment_id, document_id, reviewer pseudonym)
    open_translation_reviews: list[tuple[int, str, str]]
    reports: dict[str, ReportFact]  # report_id -> fact
    final_state: dict[str, Any]  # derive_final_state output
    # (case, language) -> final selection row + selected_by (pseudonym)
    selections: dict[tuple[str, str], dict[str, Any]]
    last_activity: dict[str, datetime]  # document_id -> latest
    selection_activity: dict[
        tuple[str, str], datetime
    ]  # (case, language) -> updated_at
    # (case, language) -> every problem report of the row, newest first
    row_reports: dict[tuple[str, str], list[dict[str, Any]]] = field(
        default_factory=dict
    )
    # Work plan: effective flags per row, stored plan revision per case (a
    # case missing here has revision 1) and discard record per document.
    plan: dict[RowKey, PlanFlags] = field(default_factory=dict)
    revisions: dict[str, int] = field(default_factory=dict)
    discarded: dict[str, dict[str, Any]] = field(default_factory=dict)
    # document id -> newest acceptance record (``work_plan_store.acceptances``)
    acceptances: dict[str, dict[str, Any]] = field(default_factory=dict)
    annotations_per_text: int = 1
    rule_on: bool = True  # annotate_accepted_translations_only
    # user id -> PersonRefView fields (lead viewer: display names included)
    people: dict[int, dict[str, Any]] = field(default_factory=dict)
    # pseudonym -> PersonRefView fields (authors of the selected submissions)
    people_by_pseudonym: dict[str, dict[str, Any]] = field(default_factory=dict)
    # pseudonym -> user id of the selected submissions' authors (Final cell)
    author_ids: dict[str, int] = field(default_factory=dict)
    # False only for undecided rows (VD3): the stored plan row is not decided
    # and the project currently imports with "Nothing planned". Rows missing
    # here are decided.
    decided: dict[RowKey, bool] = field(default_factory=dict)
    # document id -> latest translation review (Review cell people and time)
    latest_reviews: dict[str, ReviewRecord] = field(default_factory=dict)
    # assignment id -> reason of the correction request of its active round
    # (Review "re_review" line 2, D26)
    correction_reasons: dict[int, str] = field(default_factory=dict)
    # assignment id -> finding count of its last submission
    findings: dict[int, int] = field(default_factory=dict)
    # (case, language) -> newest event on the row not caused by the viewer
    # (NEW, spec "New-item signal"); the viewer's stored visit baseline
    # (None before the first visit: nothing is NEW).
    others_activity: dict[tuple[str, str], datetime] = field(default_factory=dict)
    baseline_at: datetime | None = None
    # Text changes (V5): every text-change resolution of the project, in
    # decision order; last submission per submitted annotate assignment
    # (rule 3b); unresolved source-change obligations per translation
    # document, oldest source step first (rule 6a), unfiltered, because
    # ``derive_final_state`` keeps them only for chains with a final or work.
    resolutions: list[ResolutionFact] = field(default_factory=list)
    last_submissions: dict[int, str] = field(default_factory=dict)
    source_obligations: dict[str, tuple[SourceObligationFact, ...]] = field(
        default_factory=dict
    )


def load_last_activity(
    conn: Connection, pid: int
) -> tuple[dict[str, datetime], dict[tuple[str, str], datetime]]:
    """Latest activity per document and final-selection change per row.

    Sources are those of the spec section "Last activity". Imports are not
    activity, and ``documents`` has no creation time.
    """
    sources = union_all(
        select(
            AssignmentRow.document_id.label("document_id"),
            func.greatest(
                AssignmentRow.created_at,
                AssignmentRow.updated_at,
                AssignmentRow.revoked_at,
            ).label("at"),
        ).where(AssignmentRow.project_id == pid),
        select(DraftRow.document_id, DraftRow.updated_at).where(
            DraftRow.project_id == pid
        ),
        select(AssignmentRow.document_id, TranslationReviewDraftRow.updated_at)
        .join(
            AssignmentRow, AssignmentRow.id == TranslationReviewDraftRow.assignment_id
        )
        .where(AssignmentRow.project_id == pid),
        select(WorkRoundRow.document_id, WorkRoundRow.created_at).where(
            WorkRoundRow.project_id == pid
        ),
        select(SubmissionRow.document_id, SubmissionRow.recorded_at).where(
            SubmissionRow.project_id == pid
        ),
        select(TranslationReviewRow.document_id, TranslationReviewRow.created_at).where(
            TranslationReviewRow.project_id == pid
        ),
        select(
            ReviewObligationResolutionRow.payload["cause"]["document_id"].astext,
            ReviewObligationResolutionRow.created_at,
        ).where(ReviewObligationResolutionRow.project_id == pid),
        select(AssignmentRow.document_id, ProblemReportRow.created_at)
        .join(AssignmentRow, AssignmentRow.id == ProblemReportRow.assignment_id)
        .where(ProblemReportRow.project_id == pid),
        select(AssignmentRow.document_id, TaskHoldRow.created_at)
        .join(AssignmentRow, AssignmentRow.id == TaskHoldRow.assignment_id)
        .where(TaskHoldRow.project_id == pid),
        select(AssignmentRow.document_id, ProblemReportEventRow.created_at)
        .join(
            ProblemReportRow,
            ProblemReportRow.report_id == ProblemReportEventRow.report_id,
        )
        .join(AssignmentRow, AssignmentRow.id == ProblemReportRow.assignment_id)
        .where(ProblemReportEventRow.project_id == pid),
    ).subquery()
    documents = {
        row.document_id: row.at
        for row in conn.execute(
            select(sources.c.document_id, func.max(sources.c.at).label("at"))
            .where(sources.c.document_id.is_not(None), sources.c.at.is_not(None))
            .group_by(sources.c.document_id)
        )
    }
    selections = {
        (row.case_id, row.language): row.updated_at
        for row in conn.execute(
            select(
                FinalSelectionRow.case_id,
                FinalSelectionRow.language,
                FinalSelectionRow.updated_at,
            ).where(FinalSelectionRow.project_id == pid)
        )
    }
    return documents, selections


# Audit actions that change a version's review state (lead overrides).
_STATUS_ACTIONS = ("variant.status_override", "translation.accept_external_review")


def load_others_activity(
    conn: Connection, pid: int, viewer_user_id: int
) -> dict[tuple[str, str], datetime]:
    """Newest event per row not caused by ``viewer_user_id`` (spec VD6).

    Events: import (``work_plan.import`` rows), correction and review decision
    (``translation_reviews``, lead status overrides), submission, problem
    report, hold, assignment or revocation by someone else, and text-change
    resolutions (``decided_by`` NULL = system carry, V8). An event without an
    actor (system, imported submission) is never the viewer's.
    """
    submitter = (
        select(UserRow.id)
        .where(UserRow.pseudonym == SubmissionRow.annotator_id)
        .scalar_subquery()
    )
    by_document = union_all(
        select(
            AssignmentRow.document_id.label("document_id"),
            AssignmentRow.created_at.label("at"),
            AssignmentRow.created_by.label("actor"),
        ).where(AssignmentRow.project_id == pid),
        select(
            AssignmentRow.document_id,
            AssignmentRow.revoked_at,
            AssignmentRow.revoked_by,
        ).where(AssignmentRow.project_id == pid, AssignmentRow.revoked_at.is_not(None)),
        select(SubmissionRow.document_id, SubmissionRow.recorded_at, submitter).where(
            SubmissionRow.project_id == pid
        ),
        select(
            TranslationReviewRow.document_id,
            TranslationReviewRow.created_at,
            TranslationReviewRow.reviewer_user_id,
        ).where(TranslationReviewRow.project_id == pid),
        select(
            AuditEventRow.target_id, AuditEventRow.at, AuditEventRow.actor_user_id
        ).where(
            AuditEventRow.project_id == pid,
            AuditEventRow.target_type == "document",
            AuditEventRow.action.in_(_STATUS_ACTIONS),
        ),
        select(
            AssignmentRow.document_id,
            ProblemReportRow.created_at,
            ProblemReportRow.reporter_id,
        )
        .join(AssignmentRow, AssignmentRow.id == ProblemReportRow.assignment_id)
        .where(ProblemReportRow.project_id == pid),
        select(
            AssignmentRow.document_id, TaskHoldRow.created_at, TaskHoldRow.created_by
        )
        .join(AssignmentRow, AssignmentRow.id == TaskHoldRow.assignment_id)
        .where(TaskHoldRow.project_id == pid),
        select(
            TextChangeResolutionRow.to_document_id,
            TextChangeResolutionRow.decided_at,
            TextChangeResolutionRow.decided_by,
        ).where(TextChangeResolutionRow.project_id == pid),
    ).subquery()
    imports = (
        select(
            AuditEventRow.at.label("at"),
            AuditEventRow.actor_user_id.label("actor"),
            func.jsonb_array_elements(AuditEventRow.details["rows"], type_=JSONB).label(
                "item"
            ),
        )
        .where(
            AuditEventRow.project_id == pid,
            AuditEventRow.action == "work_plan.import",
        )
        .subquery()
    )
    events = union_all(
        select(
            DocumentRow.case_id.label("case_id"),
            DocumentRow.language.label("language"),
            by_document.c.at.label("at"),
            by_document.c.actor.label("actor"),
        ).join(
            by_document,
            and_(
                DocumentRow.project_id == pid,
                DocumentRow.document_id == by_document.c.document_id,
            ),
        ),
        select(
            imports.c.item["case_id"].astext,
            imports.c.item["language"].astext,
            imports.c.at,
            imports.c.actor,
        ),
    ).subquery()
    return {
        (row.case_id, row.language): row.at
        for row in conn.execute(
            select(
                events.c.case_id, events.c.language, func.max(events.c.at).label("at")
            )
            .where(
                events.c.at.is_not(None),
                events.c.actor.is_distinct_from(viewer_user_id),
            )
            .group_by(events.c.case_id, events.c.language)
        )
    }


def _versions(conn: Connection, pid: int) -> list[rules.Version]:
    decisions = latest_review_decisions(conn, pid)
    return [
        rules.Version(
            document_id=row.document_id,
            case_id=row.case_id,
            language=row.language,
            external_id=row.external_id,
            version=row.version,
            origin=row.origin,
            derived_from=row.derived_from,
            translation=row.translation,
            translation_status=row.translation_status,
            position=row.position,
            latest_decision=decisions.get(row.document_id),
        )
        for row in conn.execute(
            select(
                DocumentRow.document_id,
                DocumentRow.case_id,
                DocumentRow.language,
                DocumentRow.external_id,
                DocumentRow.version,
                DocumentRow.origin,
                DocumentRow.derived_from,
                DocumentRow.translation,
                DocumentRow.translation_status,
                DocumentRow.position,
            )
            .where(DocumentRow.project_id == pid)
            .order_by(DocumentRow.position.nulls_last(), DocumentRow.document_id)
        )
    ]


def _accepted_without_review(conn: Connection, pid: int) -> frozenset[str]:
    """Accepted documents whose latest status writer is a manual override.

    Same rule as the document projection: free-text reasons and the absence
    of a review cannot establish manual acceptance.
    """
    latest = (
        select(AuditEventRow.target_id, AuditEventRow.action)
        .join(
            DocumentRow,
            and_(
                DocumentRow.project_id == AuditEventRow.project_id,
                DocumentRow.document_id == AuditEventRow.target_id,
            ),
        )
        .where(
            AuditEventRow.project_id == pid,
            AuditEventRow.target_type == "document",
            AuditEventRow.action.in_(["variant.status_override", "translation.review"]),
            DocumentRow.translation_status == "accepted",
        )
        .distinct(AuditEventRow.target_id)
        .order_by(AuditEventRow.target_id, AuditEventRow.id.desc())
    )
    return frozenset(
        row.target_id
        for row in conn.execute(latest)
        if row.action == "variant.status_override"
    )


def _assignments(conn: Connection, pid: int) -> list[rules.AssignmentFact]:
    return [
        rules.AssignmentFact(
            assignment_id=row.id,
            document_id=row.document_id,
            task=row.task,
            status=row.status,
            held=row.held,
            revoked=row.revoked_at is not None,
            pseudonym=row.pseudonym,
            user_id=row.user_id,
            active_round_id=row.active_round_id,
            lead_correction=row.lead_correction,
        )
        for row in conn.execute(
            select(
                AssignmentRow.id,
                AssignmentRow.document_id,
                AssignmentRow.task,
                AssignmentRow.status,
                AssignmentRow.held,
                AssignmentRow.revoked_at,
                AssignmentRow.user_id,
                AssignmentRow.active_round_id,
                AssignmentRow.lead_correction,
                UserRow.pseudonym,
            )
            .join(UserRow, UserRow.id == AssignmentRow.user_id)
            .where(AssignmentRow.project_id == pid)
            .order_by(AssignmentRow.id)
        )
    ]


def _rounds(conn: Connection, pid: int) -> list[RoundFact]:
    return [
        RoundFact(
            round_id=row.round_id,
            assignment_id=row.assignment_id,
            predecessor_round_id=row.predecessor_round_id,
            document_id=row.document_id,
            kind=row.kind,
            mode=row.mode,
            state=row.state,
            latest_submission_id=row.latest_submission_id,
            author_pseudonym=row.annotator_id,
        )
        for row in conn.execute(
            select(
                WorkRoundRow.round_id,
                WorkRoundRow.assignment_id,
                WorkRoundRow.predecessor_round_id,
                WorkRoundRow.document_id,
                WorkRoundRow.kind,
                WorkRoundRow.mode,
                WorkRoundRow.annotator_id,
                WorkRoundStateRow.state,
                WorkRoundStateRow.latest_submission_id,
            )
            .join(
                WorkRoundStateRow, WorkRoundStateRow.round_id == WorkRoundRow.round_id
            )
            .where(WorkRoundRow.project_id == pid)
            .order_by(WorkRoundRow.created_at, WorkRoundRow.round_id)
        )
    ]


def _submission_counts(conn: Connection, pid: int) -> dict[str, int]:
    return {
        row.document_id: row.total
        for row in conn.execute(
            select(SubmissionRow.document_id, func.count().label("total"))
            .where(SubmissionRow.project_id == pid)
            .group_by(SubmissionRow.document_id)
        )
    }


def _selected_submissions(conn: Connection, pid: int) -> dict[str, SubmissionFact]:
    named = select(FinalSelectionRow.submission_id).where(
        FinalSelectionRow.project_id == pid
    )
    return {
        row.submission_id: SubmissionFact(
            submission_id=row.submission_id,
            document_id=row.document_id,
            annotator_id=row.annotator_id,
            recorded_at=row.recorded_at,
            mode=row.mode,
            round_id=row.round_id,
        )
        for row in conn.execute(
            select(
                SubmissionRow.submission_id,
                SubmissionRow.document_id,
                SubmissionRow.annotator_id,
                SubmissionRow.recorded_at,
                SubmissionRow.mode,
                RoundSubmissionBindingRow.round_id,
            )
            .outerjoin(
                RoundSubmissionBindingRow,
                and_(
                    RoundSubmissionBindingRow.project_id == SubmissionRow.project_id,
                    RoundSubmissionBindingRow.submission_id
                    == SubmissionRow.submission_id,
                ),
            )
            .where(
                SubmissionRow.project_id == pid,
                SubmissionRow.submission_id.in_(named),
            )
        )
    }


def _open_translation_reviews(conn: Connection, pid: int) -> list[tuple[int, str, str]]:
    return [
        (row.id, row.document_id, row.pseudonym)
        for row in conn.execute(
            select(AssignmentRow.id, AssignmentRow.document_id, UserRow.pseudonym)
            .join(UserRow, UserRow.id == AssignmentRow.user_id)
            .where(
                AssignmentRow.project_id == pid,
                AssignmentRow.task == "translation_review",
                AssignmentRow.revoked_at.is_(None),
                AssignmentRow.status != "submitted",
            )
            .order_by(AssignmentRow.id)
        )
    ]


def _reports(conn: Connection, pid: int) -> dict[str, ReportFact]:
    """Every report of the project; text is visible because the viewer leads."""
    paused = (
        exists()
        .where(
            TaskHoldRow.assignment_id == ProblemReportRow.assignment_id,
            TaskHoldStateRow.hold_id == TaskHoldRow.hold_id,
            TaskHoldStateRow.active.is_(True),
        )
        .label("paused")
    )
    return {
        row.report_id: ReportFact(
            report_id=row.report_id,
            assignment_id=row.assignment_id,
            excerpt=row.reason[:EXCERPT_LENGTH],
            reporter_label=row.pseudonym,
            created_at=row.created_at,
            task_state="paused" if row.paused else "resumed",
            reporter_id=row.reporter_id,
        )
        for row in conn.execute(
            select(
                ProblemReportRow.report_id,
                ProblemReportRow.assignment_id,
                ProblemReportRow.reason,
                ProblemReportRow.created_at,
                ProblemReportRow.reporter_id,
                UserRow.pseudonym,
                paused,
            )
            .join(
                ProblemReportStateRow,
                ProblemReportStateRow.report_id == ProblemReportRow.report_id,
            )
            .join(UserRow, UserRow.id == ProblemReportRow.reporter_id)
            .where(ProblemReportRow.project_id == pid)
        )
    }


def _selections(conn: Connection, pid: int) -> dict[tuple[str, str], dict[str, Any]]:
    return {
        (row["case_id"], row["language"]): dict(row)
        for row in conn.execute(
            select(FinalSelectionRow, UserRow.pseudonym.label("selected_by"))
            .join(UserRow, UserRow.id == FinalSelectionRow.actor_id)
            .where(FinalSelectionRow.project_id == pid)
        ).mappings()
    }


def _decided(conn: Connection, pid: int) -> dict[RowKey, bool]:
    """Undecided rows (VD3): stored ``decided`` false under "Nothing planned"."""
    import_plan = conn.execute(
        select(ProjectRow.import_plan).where(ProjectRow.id == pid)
    ).scalar_one()
    if import_plan != "nothing":
        return {}
    return {
        key: False
        for key, decided in work_plan_store.decided_rows(conn, pid).items()
        if not decided
    }


def _latest_reviews(conn: Connection, pid: int) -> dict[str, ReviewRecord]:
    return {
        row.document_id: ReviewRecord(
            reviewer_id=row.reviewer_user_id,
            decided_at=row.created_at,
            decision=row.decision,
        )
        for row in conn.execute(
            select(
                TranslationReviewRow.document_id,
                TranslationReviewRow.reviewer_user_id,
                TranslationReviewRow.created_at,
                TranslationReviewRow.decision,
            )
            .where(TranslationReviewRow.project_id == pid)
            .distinct(TranslationReviewRow.document_id)
            .order_by(
                TranslationReviewRow.document_id,
                TranslationReviewRow.created_at.desc(),
                TranslationReviewRow.id.desc(),
            )
        )
    }


def _correction_reasons(
    conn: Connection, pid: int, assignments: list[rules.AssignmentFact]
) -> dict[int, str]:
    """Reason of each correction request (``translation.correction_requested``)
    whose round is still the assignment's active round."""
    active = {
        str(item.assignment_id): item.active_round_id
        for item in assignments
        if item.task == "translation_review" and item.active_round_id is not None
    }
    reasons: dict[int, str] = {}
    for row in conn.execute(
        select(AuditEventRow.target_id, AuditEventRow.details)
        .where(
            AuditEventRow.project_id == pid,
            AuditEventRow.action == "translation.correction_requested",
            AuditEventRow.target_type == "assignment",
        )
        .order_by(AuditEventRow.id)
    ):
        details = row.details or {}
        round_id = active.get(row.target_id)
        if round_id is not None and details.get("round_id") == round_id:
            reasons[int(row.target_id)] = str(details.get("reason") or "")
    return reasons


def _findings(conn: Connection, pid: int) -> dict[int, int]:
    """Finding count of the last submission of each submitted annotate
    assignment (the only ones the Annotation cell reads; restricting the
    join keeps the payloads of other tasks undetoasted)."""
    return {
        row.id: int(row.findings)
        for row in conn.execute(
            select(
                AssignmentRow.id,
                func.coalesce(
                    func.jsonb_array_length(SubmissionRow.payload["snapshots"]), 0
                ).label("findings"),
            )
            .join(
                SubmissionRow,
                and_(
                    SubmissionRow.project_id == AssignmentRow.project_id,
                    SubmissionRow.submission_id == AssignmentRow.last_submission_id,
                ),
            )
            .where(
                AssignmentRow.project_id == pid,
                AssignmentRow.task == "annotate",
                AssignmentRow.status == "submitted",
                AssignmentRow.held.is_(False),
                AssignmentRow.revoked_at.is_(None),
            )
        )
    }


def _resolutions(conn: Connection, pid: int) -> list[ResolutionFact]:
    return [
        ResolutionFact(
            assignment_id=row.assignment_id,
            submission_id=row.submission_id,
            resolution=row.resolution,
            from_document_id=row.from_document_id,
            to_document_id=row.to_document_id,
        )
        for row in conn.execute(
            select(
                TextChangeResolutionRow.assignment_id,
                TextChangeResolutionRow.submission_id,
                TextChangeResolutionRow.resolution,
                TextChangeResolutionRow.from_document_id,
                TextChangeResolutionRow.to_document_id,
            )
            .where(TextChangeResolutionRow.project_id == pid)
            .order_by(TextChangeResolutionRow.id)
        )
    ]


def _last_submissions(conn: Connection, pid: int) -> dict[int, str]:
    """Last submission of each submitted annotate assignment (rule 3b)."""
    return {
        row.id: row.last_submission_id
        for row in conn.execute(
            select(AssignmentRow.id, AssignmentRow.last_submission_id).where(
                AssignmentRow.project_id == pid,
                AssignmentRow.task == "annotate",
                AssignmentRow.status == "submitted",
                AssignmentRow.last_submission_id.is_not(None),
            )
        )
    }


def _source_obligations(
    causes: Iterable[Mapping[str, Any]],
) -> dict[str, tuple[SourceObligationFact, ...]]:
    result: dict[str, list[SourceObligationFact]] = {}
    for cause in causes:
        if cause["code"] != "SOURCE_UPDATE_UNREVIEWED":
            continue
        result.setdefault(cause["document_id"], []).append(
            SourceObligationFact(
                cause_id=cause["cause_id"],
                cause_revision=cause.get("cause_revision", 1),
                old_source_document_id=cause["old_source_document_id"],
            )
        )
    return {document_id: tuple(items) for document_id, items in result.items()}


def _user_ids(conn: Connection, pseudonyms: Iterable[str]) -> dict[str, int]:
    """User id per pseudonym (pseudonyms without an account are left out)."""
    wanted = sorted(set(pseudonyms))
    if not wanted:
        return {}
    return {
        row.pseudonym: row.id
        for row in conn.execute(
            select(UserRow.pseudonym, UserRow.id).where(UserRow.pseudonym.in_(wanted))
        )
    }


def load_facts(
    conn: Connection, repo: Repository, key: str, pid: int, viewer_user_id: int
) -> RowFacts:
    """All facts of project ``key`` on ``conn``; the caller has authorized it."""
    project = conn.execute(
        select(
            ProjectRow.adjudicator_not_annotator,
            ProjectRow.annotate_accepted_translations_only,
            ProjectRow.annotations_per_text,
        ).where(ProjectRow.id == pid)
    ).one()
    viewer = conn.execute(
        select(UserRow.pseudonym).where(UserRow.id == viewer_user_id)
    ).scalar_one()
    last_activity, selection_activity = load_last_activity(conn, pid)
    plan = work_plan_store.effective_plan(conn, pid)
    discarded = work_plan_store.discarded(conn, pid)
    acceptances = work_plan_store.acceptances(conn, pid)
    versions = _versions(conn, pid)
    assignments = _assignments(conn, pid)
    reports = _reports(conn, pid)
    selected = _selected_submissions(conn, pid)
    latest_reviews = _latest_reviews(conn, pid)
    author_ids = _user_ids(conn, (item.annotator_id for item in selected.values()))
    people = person_refs(
        conn,
        [
            viewer_user_id,
            *(item.user_id for item in assignments),
            *(item.reporter_id for item in reports.values() if item.reporter_id),
            *(
                item["accepted_by"]
                for item in acceptances.values()
                if item["accepted_by"]
            ),
            *(item["discarded_by"] for item in discarded.values()),
            *(item.reviewer_id for item in latest_reviews.values()),
            *author_ids.values(),
        ],
        viewer_id=viewer_user_id,
        viewer_is_lead=True,  # Documents is lead-only
    )
    people_fields = {uid: ref.model_dump() for uid, ref in people.items()}
    # Read once: the final state and the source obligations share them.
    causes = repo.workflow_causes_in(conn, key, pid)
    return RowFacts(
        project_key=key,
        viewer_user_id=viewer_user_id,
        viewer_pseudonym=viewer,
        adjudicator_not_annotator=project.adjudicator_not_annotator,
        versions=versions,
        accepted_without_review=_accepted_without_review(conn, pid),
        assignments=assignments,
        rounds=_rounds(conn, pid),
        submission_counts=_submission_counts(conn, pid),
        selected_submissions=selected,
        open_translation_reviews=_open_translation_reviews(conn, pid),
        reports=reports,
        final_state=derive_final_state(
            conn,
            repo,
            key,
            pid,
            plan=plan,
            discarded=frozenset(discarded),
            causes=causes,
        ),
        selections=_selections(conn, pid),
        last_activity=last_activity,
        selection_activity=selection_activity,
        row_reports=load_row_reports(
            conn, pid, {(v.case_id, v.language) for v in versions}, people_fields
        ),
        plan=plan,
        revisions=work_plan_store.project_revisions(conn, pid),
        discarded=discarded,
        acceptances=acceptances,
        annotations_per_text=project.annotations_per_text,
        rule_on=project.annotate_accepted_translations_only,
        people=people_fields,
        people_by_pseudonym=lead_pseudonym_refs(
            conn,
            (item.annotator_id for item in selected.values()),
            viewer_id=viewer_user_id,
        ),
        author_ids=author_ids,
        decided=_decided(conn, pid),
        latest_reviews=latest_reviews,
        correction_reasons=_correction_reasons(conn, pid, assignments),
        findings=_findings(conn, pid),
        others_activity=load_others_activity(conn, pid, viewer_user_id),
        baseline_at=documents_visits.baseline(conn, viewer_user_id, pid),
        resolutions=_resolutions(conn, pid),
        last_submissions=_last_submissions(conn, pid),
        source_obligations=_source_obligations(causes),
    )


class DocumentRowsService:
    def __init__(self, db: Database, actor: Actor, access: Access):
        self.db, self.actor, self.access = db, actor, access
        self.repo = ScopedRepository(db, access, actor)

    def page(self, key: str, query: RowQuery) -> dict[str, Any]:
        with self.db.transaction() as conn:
            pid = authorize_final_results(conn, self.actor, key, exclusive=False)
            facts = load_facts(conn, self.repo, key, pid, self.access.user_id)
            page = build_page(facts, query)
            # Final "k of n match" for the shown rows only (after paging).
            document_row_panel.fill_agreement(conn, self.repo, pid, facts, page)
            return page

    def case_ids(self, key: str, query: RowQuery) -> dict[str, Any]:
        """Case IDs matching ``query`` in list order (header checkbox)."""
        with self.db.transaction() as conn:
            pid = authorize_final_results(conn, self.actor, key, exclusive=False)
            facts = load_facts(conn, self.repo, key, pid, self.access.user_id)
            ids, total, truncated = case_ids(facts, query)
            return {"case_ids": ids, "total": total, "truncated": truncated}

    def visit(self, key: str, now: datetime | None = None) -> dict[str, Any]:
        """Record an opening of Documents (lead only); returns the baseline.

        ``now`` defaults to the database's transaction time, the clock of
        every event NEW compares with.
        """
        with self.db.transaction() as conn:
            pid = authorize_final_results(conn, self.actor, key, exclusive=False)
            if now is None:
                now = conn.execute(select(func.now())).scalar_one()
            assert now is not None
            baseline_at = documents_visits.record_visit(
                conn, self.access.user_id, pid, now
            )
            return {"baseline_at": baseline_at}

    def summary(self, key: str) -> dict[str, Any]:
        """Navigation counter: rows that need the lead's decision (V10)."""
        with self.db.transaction() as conn:
            pid = authorize_final_results(conn, self.actor, key, exclusive=False)
            facts = load_facts(conn, self.repo, key, pid, self.access.user_id)
            return {"needs_decision": needs_decision(facts)}

    def submissions(self, key: str, case_id: str, language: str) -> dict[str, Any]:
        with self.db.transaction() as conn:
            pid = authorize_final_results(conn, self.actor, key, exclusive=False)
            return build_submissions(
                conn, key, pid, case_id, language, self.access.user_id
            )

    def final_panel(self, key: str, case_id: str, language: str) -> dict[str, Any]:
        """Final-result panel of one row (lead only, shared project lock)."""
        with self.db.transaction() as conn:
            pid = authorize_final_results(conn, self.actor, key, exclusive=False)
            facts = load_facts(conn, self.repo, key, pid, self.access.user_id)
            return document_row_panel.final_panel(
                conn, self.repo, facts, key, case_id, language
            )
