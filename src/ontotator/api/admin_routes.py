"""System administrator user management; clear codes appear only on issue."""

from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select

from ontotator.api.identity import PrincipalDep, require_system_admin
from ontotator.auth.accounts import (
    SYSTEM_ADMINS_LOCK,
    AccountService,
    User,
    normalize_languages,
)
from ontotator.auth.audit import Actor, read_audit
from ontotator.auth.authority import lock_user_authority
from ontotator.auth.sessions import Principal, SessionService
from ontotator.authz.memberships import MembershipService, check_roles
from ontotator.domain.errors import AccessDenied, DomainError, NotAuthenticated
from ontotator.storage.tables import (
    PasswordCredentialRow,
    ProjectMembershipRow,
    ProjectRow,
    SessionRow,
)

router = APIRouter(prefix="/api/v1/admin/users", tags=["admin-users"])


class UserProject(BaseModel):
    project_key: str
    roles: list[str]
    project_name: str = ""


class NewMembership(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project_key: str
    roles: list[str]


class AdminUser(BaseModel):
    id: int
    username: str
    display_name: str
    email: str | None
    pseudonym: str
    is_system_admin: bool
    active: bool
    languages: list[str]
    projects: list[UserProject]
    qualification: str | None
    # No password yet: the setup code was never redeemed.
    setup_pending: bool = False
    last_login_at: datetime | None = None
    anonymised: bool = False


class CreateUserRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(max_length=256)
    display_name: str
    email: str | None = None
    system_admin: bool = False
    languages: list[str] = Field(default_factory=list)
    # Reviewers need one; setting it here saves an Edit after the hand-over.
    qualification: str | None = Field(default=None, max_length=200)
    # Optional first memberships, granted in the same transaction.
    projects: list[NewMembership] = Field(default_factory=list)


class AnonymiseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # The typed username: an irreversible erasure is never one click.
    confirm_username: str


class AuditEventView(BaseModel):
    at: datetime
    actor: str
    action: str
    target_type: str
    target_id: str
    project_key: str | None
    details: dict[str, Any]


class PatchUserRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # Defaults are ignored by exclude_unset: explicit null is invalid here.
    display_name: str = ""
    email: str | None = None
    active: bool = False
    is_system_admin: bool = False
    languages: list[str] = Field(default_factory=list)
    qualification: str | None = Field(default=None, max_length=200)


class CodeResponse(BaseModel):
    code: str
    expires_at: datetime


class CreatedUser(CodeResponse):
    user: AdminUser


def admin_users(accounts: AccountService, users: list[User]) -> list[AdminUser]:
    languages = accounts.languages_of(user.id for user in users)
    projects: dict[int, dict[str, list[str]]] = {user.id: {} for user in users}
    names: dict[str, str] = {}
    with_password: set[int] = set()
    last_login: dict[int, datetime] = {}
    if projects:
        with accounts.db.transaction() as conn:
            rows = conn.execute(
                select(
                    ProjectMembershipRow.user_id,
                    ProjectRow.project_key,
                    ProjectRow.name,
                    ProjectMembershipRow.role,
                )
                .join(ProjectRow, ProjectRow.id == ProjectMembershipRow.project_id)
                .where(
                    ProjectMembershipRow.user_id.in_(projects),
                    # Practice projects (issue 266) are not real projects.
                    ProjectRow.practice.is_(False),
                )
                .order_by(ProjectRow.project_key, ProjectMembershipRow.role)
            )
            for row in rows:
                projects[row.user_id].setdefault(row.project_key, []).append(row.role)
                names[row.project_key] = row.name
            with_password = set(
                conn.execute(
                    select(PasswordCredentialRow.user_id).where(
                        PasswordCredentialRow.user_id.in_(projects)
                    )
                ).scalars()
            )
            # A session is created only by a successful login or code redemption.
            last_login = {
                user_id: at
                for user_id, at in conn.execute(
                    select(SessionRow.user_id, func.max(SessionRow.created_at))
                    .where(SessionRow.user_id.in_(projects))
                    .group_by(SessionRow.user_id)
                )
            }
    return [
        AdminUser(
            id=user.id,
            username=user.username,
            display_name=user.display_name,
            email=user.email,
            pseudonym=user.pseudonym,
            is_system_admin=user.is_system_admin,
            active=user.active,
            qualification=user.qualification,
            languages=sorted(languages[user.id]),
            projects=[
                UserProject(project_key=key, roles=roles, project_name=names[key])
                for key, roles in projects[user.id].items()
            ],
            setup_pending=user.id not in with_password and not user.anonymised,
            last_login_at=last_login.get(user.id),
            anonymised=user.anonymised,
        )
        for user in users
    ]


@contextmanager
def _admin_write(
    principal: Principal,
    request: Request,
    *,
    target_username: str | None = None,
    removes_admin: bool = False,
    project_keys: Iterable[str] = (),
) -> Iterator[User | None]:
    """Keep fresh actor authority through this HTTP write's commit.

    AccountService remains a trusted CLI/application interface. The HTTP boundary
    checks current authority after waiting for sorted actor/target row locks.
    """
    accounts: AccountService = request.app.state.accounts
    with accounts.db.transaction() as conn:
        if removes_admin:
            # Existing flag-removal lock must precede *all* user row locks.
            conn.execute(select(func.pg_advisory_xact_lock(SYSTEM_ADMINS_LOCK)))
        for key in sorted(set(project_keys)):
            # Membership locks precede every user row lock (MembershipService).
            MembershipService._lock_project(conn, key)
        target = (
            accounts.get_by_username(target_username)
            if target_username is not None
            else None
        )
        actor = lock_user_authority(
            conn, principal.user_id, target_user_id=target.id if target else None
        )
        if not actor["active"] or not actor["is_system_admin"]:
            raise AccessDenied(
                "ADMIN_REQUIRED", "Only a system administrator may do this."
            )
        session = conn.execute(
            select(SessionRow).where(
                SessionRow.id == principal.session_id,
                SessionRow.user_id == principal.user_id,
                SessionRow.revoked_at.is_(None),
            )
        ).one_or_none()
        sessions: SessionService = request.app.state.sessions
        # Match resolution's injected clock, including time spent waiting above.
        now = sessions._now()
        if (
            session is None
            or session.expires_at <= now
            or now - session.last_seen_at > sessions.policy.idle
        ):
            raise NotAuthenticated()
        if target_username is not None and target is None:
            raise DomainError("USER_NOT_FOUND", "The user does not exist.")
        yield target


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
    for membership in body.projects:
        check_roles(membership.roles)
    actor = Actor.user(principal.user_id, principal.username)
    memberships: MembershipService = request.app.state.memberships
    with _admin_write(
        principal, request, project_keys=[m.project_key for m in body.projects]
    ):
        issued = accounts.create_user(
            actor,
            body.username,
            body.display_name,
            email=body.email,
            system_admin=body.system_admin,
        )
        accounts.set_languages(actor, issued.user.username, languages)
        created = issued.user
        if body.qualification is not None and body.qualification.strip():
            created = accounts.update_profile(
                actor, created.username, qualification=body.qualification
            )
        for membership in body.projects:
            memberships.add(
                actor, membership.project_key, issued.user.username, membership.roles
            )
        user = admin_users(accounts, [created])[0]
        return CreatedUser(user=user, code=issued.code, expires_at=issued.expires_at)


@router.post("/{username}/reset-code")
def reset_code(
    username: str, principal: PrincipalDep, request: Request
) -> CodeResponse:
    require_system_admin(principal)
    accounts: AccountService = request.app.state.accounts
    with _admin_write(principal, request, target_username=username):
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
    with _admin_write(
        principal,
        request,
        target_username=username,
        removes_admin=fields.get("active") is False
        or fields.get("is_system_admin") is False,
    ) as user:
        assert user is not None
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
            if key in {"display_name", "email", "qualification"}
        }
        updated = accounts.update_profile(actor, username, **profile)
        if "languages" in fields:
            accounts.set_languages(actor, username, body.languages)
        return admin_users(accounts, [updated])[0]


@router.post("/{username}/anonymise")
def anonymise_user(
    username: str, body: AnonymiseRequest, principal: PrincipalDep, request: Request
) -> AdminUser:
    """Erase a deactivated account's personal data; the pseudonym and work stay."""
    require_system_admin(principal)
    accounts: AccountService = request.app.state.accounts
    with _admin_write(principal, request, target_username=username) as user:
        assert user is not None
        if body.confirm_username.strip().lower() != user.username:
            raise DomainError(
                "CONFIRMATION_MISMATCH", "Type the username exactly to confirm."
            )
        updated = accounts.anonymise(
            Actor.user(principal.user_id, principal.username), user.username
        )
        return admin_users(accounts, [updated])[0]


@router.get("/{username}/audit")
def user_audit(
    username: str, principal: PrincipalDep, request: Request
) -> list[AuditEventView]:
    """The newest 200 changes to and by this user."""
    require_system_admin(principal)
    accounts: AccountService = request.app.state.accounts
    with accounts.db.transaction() as conn:
        user = accounts.get_by_username(username)
        if user is None:
            raise DomainError("USER_NOT_FOUND", "The user does not exist.")
        return [
            AuditEventView(**vars(event)) for event in read_audit(conn, user_id=user.id)
        ]
