"""Login, code redemption, logout and the current user (``/api/v1/auth``)."""

from __future__ import annotations

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from ontotator.api.identity import PrincipalDep
from ontotator.api.security import SESSION_COOKIE
from ontotator.auth.accounts import AccountService
from ontotator.auth.sessions import Principal, SessionService

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
# Included only while ONTOTATOR_DEMO_LOGINS_FILE is set; otherwise 404.
demo_router = APIRouter(prefix="/api/v1/auth", include_in_schema=False)
DEMO_LOGINS_PATH = "/api/v1/auth/demo-logins"

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
    """Log in and set the session cookie; raises ``LoginFailed``.

    A session the request still carried (a re-login) is ended, since the new
    cookie replaces it and it would otherwise stay open until it expires.
    """
    sessions = _sessions(request)
    token, principal = sessions.login(
        username,
        password,
        # Behind a proxy named in --forwarded-allow-ips, uvicorn sets this from
        # X-Forwarded-For (deployment contract: T2e).
        client_ip=request.client.host if request.client else "unknown",
        user_agent=request.headers.get("user-agent"),
    )
    previous = request.cookies.get(SESSION_COOKIE)
    replaced = sessions.resolve(previous) if previous else None
    if replaced is not None:
        sessions.logout(replaced.session_id)
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


@demo_router.get("/demo-logins")
def demo_logins(request: Request) -> JSONResponse:
    """DEMO ONLY: the one-click accounts of a loopback demo stack.

    The browser logs in with them through the normal ``/login``.
    """
    users = request.app.state.accounts
    accounts = []
    for d in request.app.state.demo_logins:
        user = users.get_by_username(d.username)
        accounts.append(
            {
                "username": d.username,
                "password": d.password,
                "label": d.label,
                "display_name": user.display_name if user else None,
            }
        )
    return JSONResponse({"accounts": accounts}, headers={"Cache-Control": "no-store"})
