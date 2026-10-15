"""Login, code redemption, logout and the current user (``/api/v1/auth``)."""

from __future__ import annotations

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from ontocurator.api.identity import PrincipalDep
from ontocurator.api.security import SESSION_COOKIE
from ontocurator.auth.accounts import AccountService
from ontocurator.auth.sessions import Principal, SessionService

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

# Generous bounds: they only stop absurd bodies, the rules are checked later.
MAX_USERNAME_INPUT = 256
MAX_SECRET_INPUT = 1024


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(max_length=MAX_USERNAME_INPUT)
    password: str = Field(max_length=MAX_SECRET_INPUT)


class RedeemCodeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(max_length=MAX_USERNAME_INPUT)
    code: str = Field(max_length=MAX_SECRET_INPUT)
    new_password: str = Field(max_length=MAX_SECRET_INPUT)


class CurrentUser(BaseModel):
    """The logged-in user, as the editor shows it (index Q10)."""

    username: str
    display_name: str
    pseudonym: str
    is_system_admin: bool
    # Send it back in the X-CSRF-Token header with every write.
    csrf_token: str

    @classmethod
    def of(cls, principal: Principal) -> CurrentUser:
        return cls(
            username=principal.username,
            display_name=principal.display_name,
            pseudonym=principal.pseudonym,
            is_system_admin=principal.is_system_admin,
            csrf_token=principal.csrf_token,
        )


def _sessions(request: Request) -> SessionService:
    return request.app.state.sessions  # type: ignore[no-any-return]


def _start_session(
    request: Request, response: Response, username: str, password: str
) -> CurrentUser:
    """Log in and set the session cookie; raises ``LoginFailed``."""
    sessions = _sessions(request)
    token, principal = sessions.login(
        username,
        password,
        # Behind the proxy this is the address it resolved (T2e).
        client_ip=request.client.host if request.client else "unknown",
        user_agent=request.headers.get("user-agent"),
    )
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        secure=bool(request.app.state.secure_cookies),
        samesite="lax",
        path="/",
        max_age=int(sessions.policy.absolute.total_seconds()),
    )
    return CurrentUser.of(principal)


@router.post("/login")
def login(req: LoginRequest, request: Request, response: Response) -> CurrentUser:
    """Log in with username and password; sets the session cookie.

    Every failure gives the same 401 ``LOGIN_FAILED``.
    """
    return _start_session(request, response, req.username, req.password)


@router.post("/redeem-code")
def redeem_code(
    req: RedeemCodeRequest, request: Request, response: Response
) -> CurrentUser:
    """Set the password with a setup or reset code, then log in.

    If the login fails afterwards (a locked account or address), the password
    is set nevertheless and the answer is the 401 of ``/login``.
    """
    accounts: AccountService = request.app.state.accounts
    accounts.redeem_code(req.username, req.code, req.new_password)
    return _start_session(request, response, req.username, req.new_password)


@router.post("/logout", status_code=204)
def logout(principal: PrincipalDep, request: Request) -> Response:
    """End this session and delete the cookie."""
    _sessions(request).logout(principal.session_id)
    response = Response(status_code=204)
    response.delete_cookie(
        SESSION_COOKIE,
        path="/",
        httponly=True,
        secure=bool(request.app.state.secure_cookies),
        samesite="lax",
    )
    return response


@router.get("/me")
def me(principal: PrincipalDep) -> CurrentUser:
    """The logged-in user."""
    return CurrentUser.of(principal)
