"""API tokens: the user's own, a project's and the administrators' overview (#305).

Every route here needs a browser session (``ontotator.api.token_scopes``):
a token cannot create, list or revoke tokens. A new token's secret is in
the creation response only.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

from ontotator.api.identity import PrincipalDep, require_system_admin
from ontotator.api.job_routes import authorized_project
from ontotator.auth.api_tokens import (
    DEFAULT_LIFETIME_DAYS,
    MAX_LIFETIME_DAYS,
    MAX_NAME_LENGTH,
    ApiToken,
    ApiTokenService,
    IssuedToken,
    TokenKind,
    TokenScope,
)
from ontotator.auth.audit import Actor
from ontotator.authz.policy import Action

me_router = APIRouter(prefix="/api/v1/me/tokens", tags=["api-tokens"])
project_router = APIRouter(prefix="/api/v1/projects/{key}/tokens", tags=["api-tokens"])
admin_router = APIRouter(prefix="/api/v1/admin/tokens", tags=["api-tokens"])


class TokenView(BaseModel):
    """A token without its secret."""

    id: int
    name: str
    kind: TokenKind
    owner: str
    owner_display_name: str
    project_key: str | None
    scopes: list[TokenScope]
    created_at: datetime
    expires_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None
    revoked_reason: str | None

    @classmethod
    def of(cls, token: ApiToken) -> TokenView:
        return cls(
            id=token.id,
            name=token.name,
            kind=token.kind,
            owner=token.owner,
            owner_display_name=token.owner_display_name,
            project_key=token.project_key,
            scopes=list(token.scopes),
            created_at=token.created_at,
            expires_at=token.expires_at,
            last_used_at=token.last_used_at,
            revoked_at=token.revoked_at,
            revoked_reason=token.revoked_reason,
        )


class CreateTokenRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(max_length=MAX_NAME_LENGTH * 2)
    scopes: list[TokenScope] = Field(min_length=1)
    expires_in_days: int = Field(
        default=DEFAULT_LIFETIME_DAYS, ge=1, le=MAX_LIFETIME_DAYS
    )


class CreatedToken(BaseModel):
    """The new token; ``secret`` is shown this once and never again."""

    secret: str
    token: TokenView


def _service(request: Request) -> ApiTokenService:
    return request.app.state.api_tokens  # type: ignore[no-any-return]


def _created(issued: IssuedToken) -> CreatedToken:
    return CreatedToken(secret=issued.secret, token=TokenView.of(issued.token))


def _create(
    request: Request,
    principal: PrincipalDep,
    body: CreateTokenRequest,
    kind: TokenKind,
    project_key: str | None = None,
) -> CreatedToken:
    return _created(
        _service(request).create(
            Actor.user(principal.user_id, principal.username),
            principal.username,
            name=body.name,
            scopes=body.scopes,
            kind=kind,
            project_key=project_key,
            lifetime_days=body.expires_in_days,
        )
    )


# The user's own tokens


@me_router.get("")
def list_my_tokens(principal: PrincipalDep, request: Request) -> list[TokenView]:
    """The user's personal and system tokens, newest first."""
    tokens = _service(request).list(owner_id=principal.user_id, personal_only=True)
    return [TokenView.of(token) for token in tokens]


@me_router.post("", status_code=201)
def create_my_token(
    body: CreateTokenRequest, principal: PrincipalDep, request: Request
) -> CreatedToken:
    """A personal token: acts as the user, within the chosen scopes."""
    return _create(request, principal, body, "personal")


@me_router.post("/{token_id}/revoke")
def revoke_my_token(
    token_id: int, principal: PrincipalDep, request: Request
) -> TokenView:
    """Revoke one of the user's own tokens."""
    return TokenView.of(
        _service(request).revoke(
            Actor.user(principal.user_id, principal.username),
            token_id,
            owner_id=principal.user_id,
        )
    )


# A project's service tokens (leads)


def _require_lead(request: Request, principal: PrincipalDep, key: str) -> None:
    actor = Actor.user(principal.user_id, principal.username)
    with request.app.state.repo.db.transaction() as conn:
        authorized_project(
            conn, key, actor, Action.MANAGE_PROJECT_SETTINGS, structure=False
        )


@project_router.get("")
def list_project_tokens(
    key: str, principal: PrincipalDep, request: Request
) -> list[TokenView]:
    """The project's service tokens, newest first."""
    _require_lead(request, principal, key)
    return [TokenView.of(token) for token in _service(request).list(project_key=key)]


@project_router.post("", status_code=201)
def create_project_token(
    key: str, body: CreateTokenRequest, principal: PrincipalDep, request: Request
) -> CreatedToken:
    """A service token for this project only; it acts as the lead creating it."""
    return _create(request, principal, body, "project", key)


@project_router.post("/{token_id}/revoke")
def revoke_project_token(
    key: str, token_id: int, principal: PrincipalDep, request: Request
) -> TokenView:
    """Revoke a service token of this project; any lead may."""
    _require_lead(request, principal, key)
    return TokenView.of(
        _service(request).revoke(
            Actor.user(principal.user_id, principal.username),
            token_id,
            project_key=key,
        )
    )


# The administrators' overview


@admin_router.get("")
def list_all_tokens(
    principal: PrincipalDep,
    request: Request,
    kind: Literal["personal", "project", "system"] | None = None,
) -> list[TokenView]:
    """Every token of the installation, newest first."""
    require_system_admin(principal)
    tokens = _service(request).list()
    return [TokenView.of(token) for token in tokens if kind in (None, token.kind)]


@admin_router.post("", status_code=201)
def create_system_token(
    body: CreateTokenRequest, principal: PrincipalDep, request: Request
) -> CreatedToken:
    """A system token of the administrator; the only kind with the admin scope."""
    require_system_admin(principal)
    return _create(request, principal, body, "system")


@admin_router.post("/{token_id}/revoke")
def revoke_any_token(
    token_id: int, principal: PrincipalDep, request: Request
) -> TokenView:
    """Revoke any token."""
    require_system_admin(principal)
    return TokenView.of(
        _service(request).revoke(
            Actor.user(principal.user_id, principal.username), token_id
        )
    )
