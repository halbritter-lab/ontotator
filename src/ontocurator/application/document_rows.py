"""Lead-only Documents read model. Shared project lock; causes from final_causes.

``load_facts`` reads everything the Documents table needs on the caller's
connection, one statement per fact, after ``authorize_final_results`` took the
shared project lock. ``document_row_page`` and ``document_row_submissions``
build the responses from these facts.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from sqlalchemy import Connection, and_, exists, func, select, union_all

from ontocurator.application.document_row_page import build_page
from ontocurator.application.document_row_submissions import build_submissions
from ontocurator.application.final_causes import (
    authorize_final_results,
    derive_final_state,
    latest_review_decisions,
)
from ontocurator.auth.audit import Actor
from ontocurator.authz.policy import Access
from ontocurator.authz.scoped import ScopedRepository
from ontocurator.domain import document_rows as rules
from ontocurator.storage.database import Database
from ontocurator.storage.final_tables import FinalSelectionRow
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
MAX_RETAIN = 200
EXCERPT_LENGTH = 120


@dataclass(frozen=True)
class RowQuery:
    language: str | None = None
    status: str | None = None  # unassigned|open|in_progress|submitted|reopened|held
    q: str | None = None
    origin: str | None = None
    translation_status: str | None = None  # adds accepted_without_review
    decision: Decision | None = None
    final: Literal["missing"] | None = None
    case: str | None = None
    page: int = 1
    # "{case_id}:{language}" keys kept visible this visit (Task 5.9). A key
    # splits at the last ":" (case ids may contain ":"; language codes do not).
    retain: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.decision is not None and self.final is not None:
            raise ValueError("decision and final are mutually exclusive")
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
        )
        for row in conn.execute(
            select(
                ProblemReportRow.report_id,
                ProblemReportRow.assignment_id,
                ProblemReportRow.reason,
                ProblemReportRow.created_at,
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


def load_facts(
    conn: Connection, repo: Repository, key: str, pid: int, viewer_user_id: int
) -> RowFacts:
    """All facts of project ``key`` on ``conn``; the caller has authorized it."""
    rule = conn.execute(
        select(ProjectRow.adjudicator_not_annotator).where(ProjectRow.id == pid)
    ).scalar_one()
    viewer = conn.execute(
        select(UserRow.pseudonym).where(UserRow.id == viewer_user_id)
    ).scalar_one()
    last_activity, selection_activity = load_last_activity(conn, pid)
    return RowFacts(
        project_key=key,
        viewer_user_id=viewer_user_id,
        viewer_pseudonym=viewer,
        adjudicator_not_annotator=rule,
        versions=_versions(conn, pid),
        accepted_without_review=_accepted_without_review(conn, pid),
        assignments=_assignments(conn, pid),
        rounds=_rounds(conn, pid),
        submission_counts=_submission_counts(conn, pid),
        selected_submissions=_selected_submissions(conn, pid),
        open_translation_reviews=_open_translation_reviews(conn, pid),
        reports=_reports(conn, pid),
        final_state=derive_final_state(conn, repo, key, pid),
        selections=_selections(conn, pid),
        last_activity=last_activity,
        selection_activity=selection_activity,
    )


class DocumentRowsService:
    def __init__(self, db: Database, actor: Actor, access: Access):
        self.db, self.actor, self.access = db, actor, access
        self.repo = ScopedRepository(db, access, actor)

    def page(self, key: str, query: RowQuery) -> dict[str, Any]:
        with self.db.transaction() as conn:
            pid = authorize_final_results(conn, self.actor, key, exclusive=False)
            facts = load_facts(conn, self.repo, key, pid, self.access.user_id)
            return build_page(facts, query)

    def submissions(self, key: str, case_id: str, language: str) -> dict[str, Any]:
        with self.db.transaction() as conn:
            pid = authorize_final_results(conn, self.actor, key, exclusive=False)
            return build_submissions(
                conn, key, pid, case_id, language, self.access.user_id
            )
