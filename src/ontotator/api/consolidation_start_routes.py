"""``POST /projects/{key}/consolidations``: the consolidation start command
(acceptance fixes spec "WP-B > Start command"; ``ConsolidationStartService``)."""

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict

from ontotator.api.identity import PrincipalDep
from ontotator.api.routes import get_access, get_repo
from ontotator.application.consolidation_start import (
    ConsolidationStartService,
    StartConsolidation,
)
from ontotator.application.round_reads import enrich_rounds
from ontotator.auth.audit import Actor
from ontotator.authz.policy import Action, can
from ontotator.domain.errors import AccessDenied, DomainError
from ontotator.domain.work_rounds import WorkRoundView
from ontotator.storage.repository import Repository

router = APIRouter(prefix="/api/v1", tags=["work-rounds"])


class StartConsolidationRequest(StartConsolidation):
    """Body of the start command (``ConsolidationStartService.start``)."""


class StartConsolidationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    round: WorkRoundView
    # The acting lead got the Adjudicator role with this command (U4).
    role_granted: bool


@router.post("/projects/{key}/consolidations")
def start_consolidation(
    key: str,
    body: StartConsolidationRequest,
    request: Request,
    principal: PrincipalDep,
) -> StartConsolidationResponse:
    """Assign the consolidator and start the consolidation round in one
    transaction (leads only). Choosing yourself gives you the Adjudicator
    role; your session stays valid."""
    access = get_access(request)
    # Refused like ``createAssignments`` before any lock is taken.
    if not can(access, Action.VIEW_PROJECT, key):
        raise DomainError("PROJECT_NOT_FOUND")
    if not can(access, Action.MANAGE_ASSIGNMENTS, key):
        raise AccessDenied("NOT_ALLOWED")
    started = ConsolidationStartService(request.app.state.repo.db).start(
        Actor.user(principal.user_id, principal.username),
        access,
        key,
        body,
    )
    # The service authorized the caller; re-read the round unscoped and enrich
    # it in one snapshot (as ``create_round``).
    repo = get_repo(request)
    with repo.db.snapshot():
        stored = Repository(repo.db).get_work_round(
            started.round.project_key, started.round.round_id
        )
        [view] = enrich_rounds(repo, started.round.project_key, [stored])
    return StartConsolidationResponse(round=view, role_granted=started.role_granted)
