"""Practice projects (issue 266): the user's own and the administration's view."""

from fastapi import APIRouter, FastAPI, Request, Response
from pydantic import BaseModel, ConfigDict

from ontotator.api.admin_routes import _admin_write
from ontotator.api.identity import PrincipalDep, require_system_admin
from ontotator.application.practice import (
    AdminPracticeProject,
    PracticeService,
    PracticeState,
)
from ontotator.auth.audit import Actor
from ontotator.exchange.jobs import unlink_deleted_files
from ontotator.storage import practice_store

router = APIRouter(prefix="/api/v1", tags=["practice"])


class PracticeCard(BaseModel):
    model_config = ConfigDict(extra="forbid")
    show: bool


class PracticeSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # Offer practice projects to annotators and translation reviewers.
    offer: bool


def sweep(app: FastAPI) -> None:
    """Delete expired practice projects (server start and, hourly, on use)."""
    service(app).sweep_if_due()


def service(app: FastAPI) -> PracticeService:
    state = app.state
    return PracticeService(
        state.repo.db,
        accounts=state.accounts,
        store_=state.ontology_store,
        registry=state.ontology_registry,
        jobs=state.jobs,
        preferences=state.preferences,
    )


def _service(request: Request) -> PracticeService:
    return service(request.app)


@router.get("/me/practice")
def get_practice(principal: PrincipalDep, request: Request) -> PracticeState:
    """The user's practice project with its tasks, and whether practice is
    offered (the "New here?" card on My tasks)."""
    return _service(request).state(principal.user_id)


@router.post("/me/practice")
def start_practice(principal: PrincipalDep, request: Request) -> PracticeState:
    """Create the user's practice project (or keep the one they have).

    Refused with ``PRACTICE_UNAVAILABLE`` (and the reason) when practice is
    switched off, the user has no Annotator role, or no suitable HPO release
    is installed.
    """
    return _service(request).start(principal.user_id)


@router.post("/me/practice/reset")
def reset_practice(principal: PrincipalDep, request: Request) -> PracticeState:
    """Delete the practice project and create a fresh one."""
    return _service(request).reset(
        principal.user_id, Actor.user(principal.user_id, principal.username)
    )


@router.delete("/me/practice")
def delete_practice(principal: PrincipalDep, request: Request) -> PracticeState:
    """Delete the user's practice project; only its own rows go."""
    return _service(request).delete(
        principal.user_id, Actor.user(principal.user_id, principal.username)
    )


@router.put("/me/practice/card")
def set_practice_card(
    body: PracticeCard, principal: PrincipalDep, request: Request
) -> PracticeState:
    """Show or hide the "New here?" card on My tasks (stored per user)."""
    return _service(request).set_card(principal.user_id, body.show)


@router.get("/admin/practice-projects")
def list_practice_projects(
    principal: PrincipalDep, request: Request
) -> list[AdminPracticeProject]:
    """Every practice project, newest first (the Projects page filter)."""
    require_system_admin(principal)
    return _service(request).admin_list()


@router.delete("/admin/practice-projects/{key}", status_code=204)
def delete_practice_project(
    key: str, principal: PrincipalDep, request: Request
) -> Response:
    """Delete one practice project; any other project is refused with
    ``NOT_A_PRACTICE_PROJECT``."""
    with _admin_write(principal, request):
        deleted = _service(request).admin_delete(
            Actor.user(principal.user_id, principal.username), key
        )
    unlink_deleted_files(request.app.state.repo.db, deleted)
    return Response(status_code=204)


@router.get("/admin/settings/practice")
def get_practice_settings(
    principal: PrincipalDep, request: Request
) -> PracticeSettings:
    require_system_admin(principal)
    with request.app.state.repo.db.transaction() as conn:
        return PracticeSettings(offer=practice_store.offer_enabled(conn))


@router.put("/admin/settings/practice")
def set_practice_settings(
    body: PracticeSettings, principal: PrincipalDep, request: Request
) -> PracticeSettings:
    """Switch the offer on or off; existing practice projects stay until
    they are deleted or expire."""
    with (
        _admin_write(principal, request),
        request.app.state.repo.db.transaction() as conn,
    ):
        practice_store.set_offer(
            conn, Actor.user(principal.user_id, principal.username), body.offer
        )
        return PracticeSettings(offer=practice_store.offer_enabled(conn))
