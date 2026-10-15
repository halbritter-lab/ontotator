"""The authenticated user's profile and password."""

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from ontocurator.api.identity import PrincipalDep
from ontocurator.auth.accounts import AccountService, User
from ontocurator.auth.audit import Actor

router = APIRouter(prefix="/api/v1/me", tags=["me"])


class Profile(BaseModel):
    username: str
    display_name: str
    email: str | None
    pseudonym: str
    orcid: str | None
    orcid_consent: bool
    languages: list[str]

    @classmethod
    def of(cls, accounts: AccountService, user: User) -> "Profile":
        return cls(
            username=user.username,
            display_name=user.display_name,
            email=user.email,
            pseudonym=user.pseudonym,
            orcid=user.orcid,
            orcid_consent=user.orcid_consent,
            languages=sorted(accounts.languages_of([user.id])[user.id]),
        )


class ProfilePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: str = ""
    email: str | None = None
    orcid: str | None = None
    orcid_consent: bool = False
    languages: list[str] = Field(default_factory=list)


class PasswordChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_password: str = Field(max_length=1024)
    new_password: str = Field(max_length=1024)


@router.get("/profile")
def get_profile(principal: PrincipalDep, request: Request) -> Profile:
    accounts: AccountService = request.app.state.accounts
    with accounts.db.transaction():
        user = accounts.get_by_username(principal.username)
        assert user is not None  # authenticated principal; users are never deleted
        return Profile.of(accounts, user)


@router.patch("/profile")
def patch_profile(
    body: ProfilePatch, principal: PrincipalDep, request: Request
) -> Profile:
    accounts: AccountService = request.app.state.accounts
    actor = Actor.user(principal.user_id, principal.username)
    fields = body.model_dump(exclude_unset=True)
    languages = fields.pop("languages", None)
    with accounts.db.transaction():
        user = accounts.update_profile(actor, principal.username, **fields)
        if languages is not None:
            accounts.set_languages(actor, principal.username, languages)
        return Profile.of(accounts, user)


@router.post("/password", status_code=204)
def change_password(
    body: PasswordChange, principal: PrincipalDep, request: Request
) -> Response:
    accounts: AccountService = request.app.state.accounts
    accounts.change_password(
        principal.user_id,
        body.current_password,
        body.new_password,
        keep_session_id=principal.session_id,
        client_ip=request.client.host if request.client else "unknown",
    )
    return Response(status_code=204)
