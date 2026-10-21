"""Consolidation view reads (acceptance fixes spec "WP-E Backend > Read")."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict

from ontocurator.api.identity import PrincipalDep
from ontocurator.api.routes import (
    encode_workspace_id,
    get_access,
    get_ontology,
    get_repo,
)
from ontocurator.api.work_round_routes import _visible_round
from ontocurator.application.consolidation import ConsolidationReader

router = APIRouter(prefix="/api/v1", tags=["consolidation"])


class _View(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ConsolidationPersonView(_View):
    """An input author; display name for the assignee and leads only (U8)."""

    person_id: str  # pseudonym, e.g. "ann-0004"
    label: str  # "Luc Martin (ann-0004)" or the pseudonym
    lane: int  # 1..4 (lane 4 also for every further person)


class ConsolidationMemberView(_View):
    input_id: str
    person_id: str
    annotation_id: str
    term_id: str
    term_label: str
    layer_id: str
    type_id: str
    axes: dict[str, str]
    spans: list[tuple[int, int]]
    cues: list[tuple[int, int]]
    note: str | None = None


class ConsolidationGroupView(_View):
    group_id: str  # sha256 of the sorted input ids, first 16 hex
    kinds: list[str]
    differing_axes: list[str]
    majority: dict[str, str]
    keep_input_id: str
    start: int | None
    members: list[ConsolidationMemberView]
    state: Literal["open", "auto", "keep", "choose", "keep_both", "leave_out"]
    edited: bool = False
    note: str | None = None
    guidelines_unclear: bool = False
    annotation_ids: list[str] = []


class ConsolidationView(_View):
    round_id: str
    workspace_id: str | None  # None in read-only mode
    read_only: bool
    read_only_reason: Literal["submitted", "input_withdrawn", "not_assigned"] | None = (
        None
    )
    case_id: str
    language: str
    document_version: int
    document_id: str
    # The clinical text of the round's document (read-only text pane).
    text: str = ""
    people: list[ConsolidationPersonView]
    groups: list[ConsolidationGroupView]
    workflow_revision: int


@router.get("/rounds/{round_id}/consolidation")
def read_consolidation(
    round_id: str, request: Request, principal: PrincipalDep
) -> ConsolidationView:
    """The consolidation of a round: live for its assignee, read-only for a
    lead after submission; every other refusal is ``ROUND_NOT_FOUND`` (U9)."""
    del principal  # the access carries the caller's pseudonym
    repo = get_repo(request)
    access = get_access(request)
    # One snapshot: visibility, inputs and state show one committed state.
    with repo.db.snapshot():
        item = _visible_round(repo, round_id)
        data = ConsolidationReader(repo).read(item, access)
    if not data["read_only"] and item.workspace_key is not None:
        data["workspace_id"] = encode_workspace_id(item.workspace_key)
    ontology = get_ontology(request)
    labels: dict[tuple[str, str], str] = {}
    for group in data["groups"]:
        for member in group["members"]:
            term = (member["layer_id"], member["term_id"])
            if term not in labels:
                status = ontology.for_package_layer(
                    repo, item.project_key, term[0]
                ).validate_term(term[1])
                labels[term] = status.label or term[1]
            member["term_label"] = labels[term]
    return ConsolidationView.model_validate(data)
