"""System administrator user management; clear codes appear only on issue."""

from datetime import datetime

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select

from ontocurator.api.identity import PrincipalDep, require_system_admin
from ontocurator.auth.accounts import (
    SYSTEM_ADMINS_LOCK,
    AccountService,
    User,
    normalize_languages,
)
from ontocurator.auth.audit import Actor
from ontocurator.domain.errors import DomainError
from ontocurator.storage.tables import ProjectMembershipRow, ProjectRow

router = APIRouter(prefix="/api/v1/admin/users", tags=["admin-users"])


class UserProject(BaseModel):
    project_key: str
    roles: list[str]


class AdminUser(BaseModel):
    username: str
    display_name: str
    email: str | None
    pseudonym: str
    is_system_admin: bool
    active: bool
    languages: list[str]
    projects: list[UserProject]


class CreateUserRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(max_length=256)
    display_name: str
    email: str | None = None
    system_admin: bool = False
    languages: list[str] = Field(default_factory=list)


class PatchUserRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # Defaults are ignored by exclude_unset: explicit null is invalid here.
    display_name: str = ""
    email: str | None = None
    active: bool = False
    is_system_admin: bool = False
    languages: list[str] = Field(default_factory=list)


class CodeResponse(BaseModel):
    code: str
    expires_at: datetime


class CreatedUser(CodeResponse):
    user: AdminUser


def admin_users(accounts: AccountService, users: list[User]) -> list[AdminUser]:
    languages = accounts.languages_of(user.id for user in users)
    projects: dict[int, dict[str, list[str]]] = {user.id: {} for user in users}
    if projects:
        with accounts.db.transaction() as conn:
            rows = conn.execute(
                select(
                    ProjectMembershipRow.user_id,
                    ProjectRow.project_key,
                    ProjectMembershipRow.role,
                )
                .join(ProjectRow, ProjectRow.id == ProjectMembershipRow.project_id)
                .where(ProjectMembershipRow.user_id.in_(projects))
                .order_by(ProjectRow.project_key, ProjectMembershipRow.role)
            )
            for row in rows:
                projects[row.user_id].setdefault(row.project_key, []).append(row.role)
    return [
        AdminUser(
            username=user.username,
            display_name=user.display_name,
            email=user.email,
            pseudonym=user.pseudonym,
            is_system_admin=user.is_system_admin,
            active=user.active,
            languages=sorted(languages[user.id]),
            projects=[
                UserProject(project_key=key, roles=roles)
                for key, roles in projects[user.id].items()
            ],
        )
        for user in users
    ]


@router.get("/")
def list_users(principal: PrincipalDep, request: Request) -> list[AdminUser]:
    require_system_admin(principal)
    accounts: AccountService = request.app.state.accounts
    with accounts.db.transaction():
        return admin_users(accounts, accounts.list_users())


@router.post("/")
def create_user(
    body: CreateUserRequest, principal: PrincipalDep, request: Request
) -> CreatedUser:
    require_system_admin(principal)
    accounts: AccountService = request.app.state.accounts
    languages = normalize_languages(body.languages)
    actor = Actor.user(principal.user_id, principal.username)
    with accounts.db.transaction():
        issued = accounts.create_user(
            actor,
            body.username,
            body.display_name,
            email=body.email,
            system_admin=body.system_admin,
        )
        accounts.set_languages(actor, issued.user.username, languages)
        user = admin_users(accounts, [issued.user])[0]
        return CreatedUser(user=user, code=issued.code, expires_at=issued.expires_at)


@router.post("/{username}/reset-code")
def reset_code(
    username: str, principal: PrincipalDep, request: Request
) -> CodeResponse:
    require_system_admin(principal)
    accounts: AccountService = request.app.state.accounts
    issued = accounts.issue_reset_code(
        Actor.user(principal.user_id, principal.username), username
    )
    return CodeResponse(code=issued.code, expires_at=issued.expires_at)


@router.patch("/{username}")
def patch_user(
    username: str, body: PatchUserRequest, principal: PrincipalDep, request: Request
) -> AdminUser:
    require_system_admin(principal)
    accounts: AccountService = request.app.state.accounts
    actor = Actor.user(principal.user_id, principal.username)
    fields = body.model_dump(exclude_unset=True)
    # Validate the whole replacement before touching flags or profile fields.
    if "languages" in fields:
        normalize_languages(body.languages)
    with accounts.db.transaction() as conn:
        # Any flag removal takes the shared admin lock before *any* user lock.
        if fields.get("active") is False or fields.get("is_system_admin") is False:
            conn.execute(select(func.pg_advisory_xact_lock(SYSTEM_ADMINS_LOCK)))
        user = accounts.get_by_username(username)
        if user is None:
            raise DomainError("USER_NOT_FOUND", "The user does not exist.")
        if user.id == principal.user_id and (
            fields.get("active") is False or fields.get("is_system_admin") is False
        ):
            raise DomainError(
                "SELF_LOCKOUT",
                "You cannot deactivate yourself or remove your own administrator role.",
            )
        if "active" in fields:
            accounts.set_active(actor, username, body.active)
        if "is_system_admin" in fields:
            accounts.set_system_admin(actor, username, body.is_system_admin)
        profile = {
            key: value
            for key, value in fields.items()
            if key in {"display_name", "email"}
        }
        updated = accounts.update_profile(actor, username, **profile)
        if "languages" in fields:
            accounts.set_languages(actor, username, body.languages)
        return admin_users(accounts, [updated])[0]
