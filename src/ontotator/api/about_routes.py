"""The running app's version (``/api/v1/about``), shown to every logged-in user."""

from __future__ import annotations

import os
import re

from fastapi import APIRouter
from pydantic import BaseModel

from ontotator import __version__
from ontotator.api.identity import PrincipalDep

router = APIRouter(prefix="/api/v1", tags=["about"])

# The image build sets it from the Git commit (Dockerfile ARG); unset from source.
REVISION_ENV = "ONTOTATOR_REVISION"
_REVISION = re.compile(r"[0-9a-f]{7,64}")


class About(BaseModel):
    """What a user quotes when reporting a problem."""

    version: str
    # Full Git commit of the image, or null when not built from a known commit.
    revision: str | None


def current_revision() -> str | None:
    value = os.environ.get(REVISION_ENV, "").strip().lower()
    return value if _REVISION.fullmatch(value) else None


@router.get("/about")
def about(principal: PrincipalDep) -> About:
    """Version and Git commit of the running app."""
    return About(version=__version__, revision=current_revision())
