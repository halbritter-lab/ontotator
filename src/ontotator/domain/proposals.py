"""Metadata-only producer projection shared by workspace and public reads."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel


class ProposalSetView(BaseModel):
    id: int
    document_id: str
    annotation_set_id: str
    bundle_id: str | None
    set_kind: str
    actors: list[dict[str, Any]]
    imported_at: datetime
    imported_by_pseudonym: str | None
    origin: Literal["import", "reanchor"]
    source_document_id: str | None
    source_version: int | None
