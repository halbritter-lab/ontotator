"""Thin authenticated translation-review task endpoints."""

from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field, StrictInt

from ontocurator.api.encoded_routes import EncodedParameterRoute
from ontocurator.api.identity import PrincipalDep
from ontocurator.api.routes import get_access
from ontocurator.application.translation_reviews import (
    ReviewWorkspace,
    TranslationReviewRecord,
    TranslationReviewService,
)

router = APIRouter(
    prefix="/api/v1", tags=["translation-reviews"], route_class=EncodedParameterRoute
)


class DraftRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: StrictInt = Field(ge=0)
    text: str
    form: dict[str, Any]


class SubmitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: StrictInt = Field(ge=0)


class DraftResponse(BaseModel):
    revision: int


def _service(request: Request) -> TranslationReviewService:
    return TranslationReviewService(request.app.state.repo.db, request.app.state.jobs)


@router.get("/translation-reviews/{assignment_id}")
def open_review(
    assignment_id: int, request: Request, principal: PrincipalDep
) -> ReviewWorkspace:
    return _service(request).open(get_access(request), assignment_id)


@router.put("/translation-reviews/{assignment_id}/draft")
def save_review(
    assignment_id: int, body: DraftRequest, request: Request, principal: PrincipalDep
) -> DraftResponse:
    return DraftResponse(
        revision=_service(request).save_draft(
            get_access(request), assignment_id, **body.model_dump()
        )
    )


@router.post("/translation-reviews/{assignment_id}/submit")
def submit_review(
    assignment_id: int, body: SubmitRequest, request: Request, principal: PrincipalDep
) -> TranslationReviewRecord:
    return _service(request).submit(
        get_access(request), assignment_id, expected_revision=body.expected_revision
    )


@router.get("/projects/{key}/documents/{doc:path}/translation-reviews")
def review_records(
    key: str, doc: str, request: Request, principal: PrincipalDep
) -> list[TranslationReviewRecord]:
    return _service(request).records(get_access(request), key, doc)
