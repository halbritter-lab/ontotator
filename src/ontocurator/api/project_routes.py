"""Project settings and membership administration."""

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from ontocurator.api.admin_routes import admin_users
from ontocurator.api.identity import PrincipalDep
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
from ontocurator.storage.tables import ProjectMembershipRow, ProjectRow, UserRow

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
    # Check actual existence even for administrators with installation-wide rights.
    _service(request).settings(key)
    with accounts.db.transaction() as conn:
        ids = conn.execute(
            select(UserRow.id)
            .join(ProjectMembershipRow, UserRow.id == ProjectMembershipRow.user_id)
            .join(ProjectRow, ProjectRow.id == ProjectMembershipRow.project_id)
            .where(ProjectRow.project_key == key)
            .distinct()
        ).scalars()
        wanted = set(ids)
        users = admin_users(
            accounts, [user for user in accounts.list_users() if user.id in wanted]
        )
    return [
        Member(
            username=user.username,
            display_name=user.display_name,
            pseudonym=user.pseudonym,
            roles=next(
                project.roles for project in user.projects if project.project_key == key
            ),
            languages=user.languages,
        )
        for user in users
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
