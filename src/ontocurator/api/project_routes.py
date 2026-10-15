"""Project settings, membership administration, progress and export requests."""

from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from ontocurator.api.document_projection import Assignee
from ontocurator.api.identity import PrincipalDep
from ontocurator.api.job_routes import EXPORT_ACTIONS, authorized_project
from ontocurator.api.routes import get_access
from ontocurator.auth.audit import Actor
from ontocurator.authz.policy import Action, can
from ontocurator.authz.scoped import project_not_found
from ontocurator.domain.errors import AccessDenied, DomainError
from ontocurator.domain.profile_templates import PROFILE_TEMPLATES
from ontocurator.domain.profiles import TaskProfile
from ontocurator.exchange.t1 import Pin
from ontocurator.projects.service import (
    ProjectPin,
    ProjectService,
    ProjectSettings,
    ProjectSettingsChange,
)
from ontocurator.storage.tables import (
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


class Member(BaseModel):
    username: str
    display_name: str
    pseudonym: str
    roles: list[str]
    languages: list[str]


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


class ProjectProgress(BaseModel):
    documents: list[ProgressDocument]
    people: list[ProgressPerson]
    totals: ProgressTotals


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
        return ProjectProgress(
            documents=list(documents.values()),
            people=sorted(people.values(), key=lambda p: p.username),
            totals=totals,
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
    _guard(request, Action.VIEW_PROJECT, key)
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
        for user_id, language in conn.execute(
            select(UserLanguageRow.user_id, UserLanguageRow.language)
            .where(UserLanguageRow.user_id.in_(by_id))
            .order_by(UserLanguageRow.language)
        ).tuples():
            by_id[user_id].languages.append(language)
        return list(by_id.values())


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
