"""Project settings, membership administration, progress and export requests."""

from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select

from ontotator.api.document_projection import Assignee
from ontotator.api.identity import PrincipalDep
from ontotator.api.job_routes import EXPORT_ACTIONS, authorized_project
from ontotator.api.person_views import PersonRefView
from ontotator.api.routes import get_access
from ontotator.application.document_rows import FinalFilter, Paused, PlanFilter
from ontotator.application.progress import progress_view
from ontotator.assignments.batch import open_task_counts
from ontotator.auth.audit import Actor
from ontotator.authz.policy import Action, can
from ontotator.authz.scoped import project_not_found
from ontotator.domain.errors import AccessDenied, DomainError
from ontotator.domain.next_steps import Stage, StepCode
from ontotator.domain.profile_templates import PROFILE_TEMPLATES
from ontotator.domain.profiles import TaskProfile
from ontotator.domain.variants import TranslationStatus
from ontotator.exchange.t1 import Pin
from ontotator.projects.service import (
    ProjectPin,
    ProjectService,
    ProjectSettings,
    ProjectSettingsChange,
)
from ontotator.storage.tables import (
    AssignmentRow,
    DocumentRow,
    ProjectMembershipRow,
    ProjectRow,
    UserLanguageRow,
    UserRow,
)

router = APIRouter(prefix="/api/v1/projects", tags=["projects"])


class CreateProjectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str
    name: str
    description: str | None = None
    languages: list[str] = Field(default_factory=list)
    template: str | None = None
    profile: TaskProfile | None = None
    pins: list[ProjectPin]


class TemplateInfo(BaseModel):
    id: str
    label: str
    required_ontology_ids: list[str]


class MemberChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    roles: list[str]
    revoke_assignments: bool = False


class OpenTasksView(BaseModel):
    """Open tasks of a member per task: non-revoked and unsubmitted or paused
    (``open_task_counts``, the count of the batch dialog's people)."""

    translation_review: int = 0
    annotate: int = 0
    review: int = 0


class Member(BaseModel):
    """For non-lead callers ``username`` and ``display_name`` of other people
    are empty (pseudonym only, D1); the caller's own record is complete."""

    username: str
    display_name: str
    pseudonym: str
    roles: list[str]
    languages: list[str]
    open_tasks: OpenTasksView = Field(default_factory=OpenTasksView)


class MemberCandidate(BaseModel):
    """A person a lead may add: only what the members table shows a lead."""

    username: str
    display_name: str


class ProgressDocument(BaseModel):
    document_id: str
    language: str
    position: int | None
    assignees: list[Assignee] = Field(default_factory=list)


class AssignmentCounts(BaseModel):
    open: int = 0
    in_progress: int = 0
    submitted: int = 0
    reopened: int = 0


class ProgressPerson(AssignmentCounts):
    username: str
    display_name: str
    pseudonym: str


class ProgressTotals(AssignmentCounts):
    documents: int = 0
    unassigned: int = 0


class ProgressLedeView(BaseModel):
    cases: int
    translations_to_review: int
    versions_to_annotate: int
    not_in_plan: int
    needs_decision: int
    to_assign: int


class DocumentLinkQuery(BaseModel):
    """Documents filters of one Progress count (follow-up spec FD11).

    ``GET document-rows`` with these filters (lists as repeated parameters)
    lists exactly the counted rows: the count equals its ``bar.shown``.
    """

    plan: list[PlanFilter] = Field(default_factory=list)
    step: list[StepCode] = Field(default_factory=list)
    stage: list[Stage] = Field(default_factory=list)
    translation_status: TranslationStatus | None = None
    paused: Paused | None = None
    final: FinalFilter | None = None


class ProgressStageView(BaseModel):
    """One stage card: rows in ``scope`` (Review or Annotate on), ``done`` of
    ``total`` and row counts per state (keys per card, see the spec), each
    with the Documents query that lists its rows (``links``, same keys)."""

    scope: Literal["review", "annotate"]
    done: int
    total: int
    counts: dict[str, int]
    links: dict[str, DocumentLinkQuery] = Field(default_factory=dict)


class ProgressStagesView(BaseModel):
    translation_review: ProgressStageView
    annotation: ProgressStageView
    final: ProgressStageView


class ProgressWorkloadView(BaseModel):
    person: PersonRefView
    username: str
    translation_reviews_open: int = 0
    annotations_open: int = 0
    reviews_open: int = 0
    paused: int = 0
    submitted: int = 0


class ProjectProgress(BaseModel):
    documents: list[ProgressDocument]
    people: list[ProgressPerson]
    totals: ProgressTotals
    # Lead workflow (D9): counts from the Documents derivation.
    lede: ProgressLedeView | None = None
    stages: ProgressStagesView | None = None
    workload: list[ProgressWorkloadView] = Field(default_factory=list)


class ExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["t1", "edit_log"]


class ExportCreated(BaseModel):
    job_id: int


@router.get("/{key}/progress")
def progress(key: str, principal: PrincipalDep, request: Request) -> ProjectProgress:
    actor = Actor.user(principal.user_id, principal.username)
    with request.app.state.repo.db.transaction() as conn:
        project_id = authorized_project(conn, key, actor, Action.VIEW_PROGRESS)
        # One bounded metadata projection, without document text or workspace
        # snapshots. Unrevoked history stays visible to project leads even if
        # an assignee later loses a task role or becomes inactive.
        rows = conn.execute(
            select(
                DocumentRow.document_id,
                DocumentRow.language,
                DocumentRow.position,
                AssignmentRow.id.label("assignment_id"),
                AssignmentRow.task,
                AssignmentRow.status,
                UserRow.username,
                UserRow.display_name,
                UserRow.pseudonym,
            )
            .select_from(DocumentRow)
            .outerjoin(
                AssignmentRow,
                (AssignmentRow.project_id == DocumentRow.project_id)
                & (AssignmentRow.document_id == DocumentRow.document_id)
                & AssignmentRow.revoked_at.is_(None),
            )
            .outerjoin(UserRow, UserRow.id == AssignmentRow.user_id)
            .where(DocumentRow.project_id == project_id)
            .order_by(
                DocumentRow.position.nulls_last(),
                DocumentRow.document_id,
                UserRow.username,
                AssignmentRow.task,
                AssignmentRow.id,
            )
        ).all()
        documents: dict[str, ProgressDocument] = {}
        people: dict[str, ProgressPerson] = {}
        totals = ProgressTotals()
        for row in rows:
            document = documents.setdefault(
                row.document_id,
                ProgressDocument(
                    document_id=row.document_id,
                    language=row.language,
                    position=row.position,
                ),
            )
            if row.assignment_id is None:
                continue
            assignee = Assignee(
                assignment_id=row.assignment_id,
                username=row.username,
                pseudonym=row.pseudonym,
                task=row.task,
                status=row.status,
            )
            document.assignees.append(assignee)
            person = people.setdefault(
                row.username,
                ProgressPerson(
                    username=row.username,
                    display_name=row.display_name,
                    pseudonym=row.pseudonym,
                ),
            )
            setattr(person, assignee.status, getattr(person, assignee.status) + 1)
            setattr(totals, assignee.status, getattr(totals, assignee.status) + 1)
        totals.documents = len(documents)
        totals.unassigned = sum(
            not document.assignees for document in documents.values()
        )
        pipeline = progress_view(
            conn, request.app.state.repo, key, project_id, principal.user_id
        )
        return ProjectProgress(
            documents=list(documents.values()),
            people=sorted(people.values(), key=lambda p: p.username),
            totals=totals,
            lede=ProgressLedeView(**pipeline["lede"]),
            stages=ProgressStagesView.model_validate(pipeline["stages"]),
            workload=[
                ProgressWorkloadView.model_validate(item)
                for item in pipeline["workload"]
            ],
        )


@router.post("/{key}/exports")
def request_export(
    key: str, body: ExportRequest, principal: PrincipalDep, request: Request
) -> ExportCreated:
    actor = Actor.user(principal.user_id, principal.username)
    with request.app.state.repo.db.transaction() as conn:
        project_id = authorized_project(conn, key, actor, EXPORT_ACTIONS[body.kind])
        job_id = request.app.state.jobs.enqueue(
            f"{body.kind}_export", {"project": key}, project_id=project_id, actor=actor
        )
        return ExportCreated(job_id=job_id)


@router.post("/{key}/exports/translation-reviews")
def request_translation_review_export(
    key: str, principal: PrincipalDep, request: Request
) -> ExportCreated:
    actor = Actor.user(principal.user_id, principal.username)
    with request.app.state.repo.db.transaction() as conn:
        project_id = authorized_project(conn, key, actor, Action.EXPORT_ALL_WORK)
        job_id = request.app.state.jobs.enqueue(
            "translation_review_export",
            {"project": key},
            project_id=project_id,
            actor=actor,
        )
        return ExportCreated(job_id=job_id)


def _service(request: Request) -> ProjectService:
    return ProjectService(request.app.state.repo.db, request.app.state.ontology_store)


def _guard(request: Request, action: Action, key: str | None = None) -> None:
    access = get_access(request)
    if key is not None and not can(access, Action.VIEW_PROJECT, key):
        raise project_not_found(key)
    if not can(access, action, key):
        raise AccessDenied("NOT_ALLOWED", "You may not manage this project.")


def _pins(pins: list[ProjectPin]) -> dict[str, Pin]:
    if len({pin.ontology_id for pin in pins}) != len(pins):
        raise DomainError("PIN_MISMATCH", "Ontology ids must be unique.")
    return {
        pin.ontology_id: Pin(pin.sha256, tuple(pin.allowed_roots), pin.t1_profile)
        for pin in pins
    }


@router.get("/templates")
def templates(principal: PrincipalDep) -> list[TemplateInfo]:
    return [
        TemplateInfo(
            id="hpo-phenotype", label="HPO phenotype", required_ontology_ids=["HP"]
        )
    ]


@router.post("/")
def create_project(
    body: CreateProjectRequest, principal: PrincipalDep, request: Request
) -> ProjectSettings:
    _guard(request, Action.CREATE_PROJECT)
    if (body.template is None) == (body.profile is None):
        raise DomainError("PROFILE_REQUIRED", "Supply exactly one template or profile.")
    pins = _pins(body.pins)
    profile = body.profile
    if body.template is not None:
        template = PROFILE_TEMPLATES.get(body.template)
        files = {item.sha256: item for item in request.app.state.ontology_store.list()}
        pin = pins.get("HP")
        stored = None if pin is None else files.get(pin.sha256)
        if template is None:
            raise DomainError("PROFILE_REQUIRED", "The template is unknown.")
        if stored is None or stored.kind != "ontology" or stored.prefix.lower() != "hp":
            raise DomainError(
                "PIN_MISMATCH", "The HPO template needs an uploaded HP ontology."
            )
        profile = template(stored)
    assert profile is not None
    return _service(request).create(
        Actor.user(principal.user_id, principal.username),
        key=body.key,
        name=body.name,
        description=body.description,
        profile=profile,
        pins=pins,
        languages=body.languages,
    )


@router.get("/{key}/settings")
def settings(key: str, principal: PrincipalDep, request: Request) -> ProjectSettings:
    _guard(request, Action.VIEW_PROJECT, key)
    return _service(request).settings(key)


@router.patch("/{key}/settings")
def update_settings(
    key: str, body: ProjectSettingsChange, principal: PrincipalDep, request: Request
) -> ProjectSettings:
    _guard(request, Action.MANAGE_PROJECT_SETTINGS, key)
    return _service(request).update_settings(
        Actor.user(principal.user_id, principal.username), key, body
    )


@router.put("/{key}/pins")
def update_pins(
    key: str, body: list[ProjectPin], principal: PrincipalDep, request: Request
) -> ProjectSettings:
    _guard(request, Action.MANAGE_PROJECT_SETTINGS, key)
    return _service(request).update_pins(
        Actor.user(principal.user_id, principal.username), key, _pins(body)
    )


@router.put("/{key}/profile")
def update_profile(
    key: str, body: TaskProfile, principal: PrincipalDep, request: Request
) -> ProjectSettings:
    _guard(request, Action.MANAGE_PROJECT_SETTINGS, key)
    return _service(request).update_profile(
        Actor.user(principal.user_id, principal.username), key, body
    )


@router.get("/{key}/members")
def members(key: str, principal: PrincipalDep, request: Request) -> list[Member]:
    """Members with roles, languages and open tasks.

    Leads (``MANAGE_ASSIGNMENTS``) see everything; other callers see other
    people by pseudonym only (D1) and only their own open tasks.
    """
    _guard(request, Action.VIEW_PROJECT, key)
    is_lead = can(get_access(request), Action.MANAGE_ASSIGNMENTS, key)
    accounts = request.app.state.accounts
    with accounts.db.snapshot() as conn:
        project_id = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == key)
        ).scalar_one_or_none()
        if project_id is None:
            raise project_not_found(key)
        rows = conn.execute(
            select(
                UserRow.id,
                UserRow.username,
                UserRow.display_name,
                UserRow.pseudonym,
                ProjectMembershipRow.role,
            )
            .join(ProjectMembershipRow, UserRow.id == ProjectMembershipRow.user_id)
            .where(ProjectMembershipRow.project_id == project_id)
            .order_by(UserRow.username, ProjectMembershipRow.role)
        ).all()
        by_id: dict[int, Member] = {}
        for row in rows:
            member = by_id.setdefault(
                row.id,
                Member(
                    username=row.username,
                    display_name=row.display_name,
                    pseudonym=row.pseudonym,
                    roles=[],
                    languages=[],
                ),
            )
            member.roles.append(row.role)
        if not is_lead:
            for user_id, member in by_id.items():
                if user_id != principal.user_id:
                    member.username = member.display_name = ""
        visible = list(by_id) if is_lead else [principal.user_id]
        for user_id, tasks in open_task_counts(conn, project_id, visible).items():
            for task, count in tasks.items():
                if user_id in by_id and task in OpenTasksView.model_fields:
                    setattr(by_id[user_id].open_tasks, task, count)
        for user_id, language in conn.execute(
            select(UserLanguageRow.user_id, UserLanguageRow.language)
            .where(UserLanguageRow.user_id.in_(by_id))
            .order_by(UserLanguageRow.language)
        ).tuples():
            by_id[user_id].languages.append(language)
        if not is_lead:
            # Username order would hint at hidden usernames.
            return sorted(by_id.values(), key=lambda member: member.pseudonym)
        return list(by_id.values())


MEMBER_CANDIDATE_LIMIT = 10


@router.get("/{key}/member-candidates")
def member_candidates(
    key: str, principal: PrincipalDep, request: Request, q: str = ""
) -> list[MemberCandidate]:
    """Active users outside the project matching ``q`` (three characters at least).

    A lead finds people who share a project with them by part of the name or
    username, and anybody else only by the exact username or e-mail, so the
    search does not browse the installation's user list. System
    administrators are never offered (they manage without membership); an
    administrator caller searches everyone. Ten results at most.
    """
    _guard(request, Action.MANAGE_MEMBERS, key)
    query = q.strip().lower()
    if len(query) < 3:
        return []
    accounts = request.app.state.accounts
    with accounts.db.snapshot() as conn:
        project_id = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == key)
        ).scalar_one_or_none()
        if project_id is None:
            raise project_not_found(key)
        members = select(ProjectMembershipRow.user_id).where(
            ProjectMembershipRow.project_id == project_id
        )
        partial = or_(
            func.strpos(UserRow.username, query) > 0,
            func.strpos(func.lower(UserRow.display_name), query) > 0,
        )
        exact = or_(UserRow.username == query, func.lower(UserRow.email) == query)
        if not principal.is_system_admin:
            mine = select(ProjectMembershipRow.project_id).where(
                ProjectMembershipRow.user_id == principal.user_id
            )
            colleagues = select(ProjectMembershipRow.user_id).where(
                ProjectMembershipRow.project_id.in_(mine)
            )
            partial = partial & UserRow.id.in_(colleagues)
        rows = conn.execute(
            select(UserRow.username, UserRow.display_name)
            .where(
                UserRow.active.is_(True),
                UserRow.anonymised_at.is_(None),
                UserRow.is_system_admin.is_(False),
                UserRow.id.not_in(members),
                or_(partial, exact),
            )
            .order_by(UserRow.username)
            .limit(MEMBER_CANDIDATE_LIMIT)
        ).all()
    return [
        MemberCandidate(username=r.username, display_name=r.display_name) for r in rows
    ]


@router.put("/{key}/members/{username}")
def set_member(
    key: str,
    username: str,
    body: MemberChange,
    principal: PrincipalDep,
    request: Request,
) -> Member:
    _guard(request, Action.MANAGE_MEMBERS, key)
    accounts = request.app.state.accounts
    with accounts.db.transaction():
        roles = request.app.state.memberships.set_roles(
            Actor.user(principal.user_id, principal.username),
            key,
            username,
            body.roles,
            revoke_assignments=body.revoke_assignments,
        )
        user = accounts.get_by_username(username)
        assert user is not None
        languages = accounts.languages_of([user.id])
        return Member(
            username=user.username,
            display_name=user.display_name,
            pseudonym=user.pseudonym,
            roles=sorted(roles),
            languages=sorted(languages[user.id]),
        )
