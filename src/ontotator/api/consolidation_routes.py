"""Consolidation view read and group commands (acceptance fixes spec
"WP-E Backend > Read / Resolve / Annotate / Reopen")."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict

from ontotator.api.identity import PrincipalDep, own_key
from ontotator.api.routes import (
    decode_workspace_id,
    encode_workspace_id,
    get_access,
    get_ontology,
    get_repo,
)
from ontotator.api.work_round_routes import _visible_round
from ontotator.application.consolidation import ConsolidationReader
from ontotator.application.consolidation_resolve import ConsolidationGroupService
from ontotator.domain.workspace import Draft, MutationEnvelope

router = APIRouter(prefix="/api/v1", tags=["consolidation"])


class _View(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ConsolidationPersonView(_View):
    """An input author; display name for the assignee and leads only (U8)."""

    person_id: str  # pseudonym, e.g. "ann-0004"
    label: str  # "Luc Martin (ann-0004)" or the pseudonym
    lane: int  # 1..4 (lane 4 also for every further person)


class ConsolidationModifierView(_View):
    """One modifier of a member; ``kind`` and ``exclusive_class`` from the
    layer's classifier, ``segments`` as code-point ``[start, end]``."""

    term_id: str
    term_label: str
    kind: Literal["modifier", "cohort"]
    exclusive_class: Literal["severity", "onset"] | None = None
    segments: list[tuple[int, int]] = []


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
    # The finding is a confirmed or corrected tool proposal (robot icon).
    from_tool_proposal: bool = False
    modifiers: list[ConsolidationModifierView] = []


class ConsolidationResultView(_View):
    term_id: str
    term_label: str
    layer_id: str
    axes: dict[str, str]
    modifiers: list[ConsolidationModifierView] = []
    # The kept finding's text (codepoint ranges; empty without a span). Two
    # kept findings of one term are a duplicate only on overlapping spans (R-3).
    spans: list[tuple[int, int]] = []


class ConsolidationGroupView(_View):
    group_id: str  # sha256 of the sorted input ids, first 16 hex
    kinds: list[str]
    differing_axes: list[str]
    majority: dict[str, str]
    # The members' spans genuinely conflict (``agreement.spans_conflict``):
    # the text is a decision. ``span_differs`` alone (overlapping spans with
    # small shifts) is not.
    span_conflict: bool = False
    keep_input_id: str
    start: int | None
    members: list[ConsolidationMemberView]
    state: Literal["open", "auto", "keep", "choose", "leave_out"]
    edited: bool = False
    note: str | None = None
    guidelines_unclear: bool = False
    annotation_ids: list[str] = []
    # A left-out standalone modifier attached to this cons-… finding (S18).
    attached_to: str | None = None
    # The finding the decision kept (R-2); None while open or left out.
    result: ConsolidationResultView | None = None


class ConsolidationView(_View):
    round_id: str
    workspace_id: str | None  # None in read-only mode
    read_only: bool
    read_only_reason: Literal["submitted", "input_withdrawn", "not_assigned"] | None = (
        None
    )
    # When the lead accepted a final result for this text (submitted rounds).
    accepted_at: datetime | None = None
    case_id: str
    language: str
    document_version: int
    document_id: str
    # The clinical text of the round's document (read-only text pane).
    text: str = ""
    people: list[ConsolidationPersonView]
    groups: list[ConsolidationGroupView]
    # Findings the consolidator added outside every group ("Add finding"),
    # shaped like members: ``input_id`` is the annotation id, ``person_id``
    # the consolidator.
    added: list[ConsolidationMemberView] = []
    # The consolidator's label ("Ada Judicator (ann-0007)") when ``added`` is
    # not empty.
    added_by: str | None = None
    # The consolidator's label, always (the read-only banner names them).
    consolidator: str | None = None
    # The lead's "Consolidation reason" from the start command (#146); None
    # when the lead gave none.
    consolidation_reason: str | None = None
    workflow_revision: int
    # The live draft's revision, the ``expected_revision`` of the next group
    # command; 0 in read-only mode.
    draft_revision: int = 0
    # As ``WorkspaceView``: layers whose findings have modifiers.
    modifier_layer_ids: list[str] = []


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

    def label(layer_id: str, term_id: str) -> str:
        if (layer_id, term_id) not in labels:
            status = ontology.for_package_layer(
                repo, item.project_key, layer_id
            ).validate_term(term_id)
            labels[(layer_id, term_id)] = status.label or term_id
        return labels[(layer_id, term_id)]

    members = [m for group in data["groups"] for m in group["members"]]
    results = [g["result"] for g in data["groups"] if g.get("result")]
    for member in [*members, *data["added"], *results]:
        member["term_label"] = label(member["layer_id"], member["term_id"])
        for modifier in member["modifiers"]:
            modifier["term_label"] = label(member["layer_id"], modifier["term_id"])
    return ConsolidationView.model_validate(data)


def _groups_service(request: Request) -> ConsolidationGroupService:
    repo = get_repo(request)
    ontology = get_ontology(request)

    def valid_term(project_key: str, layer_id: str, term_id: str) -> str | None:
        """The canonical id (an alternative id resolves to its term)."""
        status = ontology.for_package_layer(repo, project_key, layer_id).validate_term(
            term_id
        )
        if status.status in {"obsolete", "unknown"}:
            return None
        return status.term_id

    return ConsolidationGroupService(repo, valid_term)


@router.post("/workspaces/{workspace_id}/consolidation-groups/resolve")
def resolve_consolidation_group(
    workspace_id: str,
    envelope: MutationEnvelope,
    request: Request,
    principal: PrincipalDep,
) -> Draft:
    """Resolve one group to exactly one finding: ``keep``, ``choose`` or
    ``leave_out`` (payload ``ResolveCommand``)."""
    key = own_key(principal, decode_workspace_id(workspace_id))
    return _groups_service(request).resolve(key, envelope)


@router.post("/workspaces/{workspace_id}/consolidation-groups/annotate")
def annotate_consolidation_group(
    workspace_id: str,
    envelope: MutationEnvelope,
    request: Request,
    principal: PrincipalDep,
) -> Draft:
    """Change note and "Guidelines unclear" of a resolved group (payload
    ``AnnotateCommand``)."""
    key = own_key(principal, decode_workspace_id(workspace_id))
    return _groups_service(request).annotate(key, envelope)


@router.post("/workspaces/{workspace_id}/consolidation-groups/reopen")
def reopen_consolidation_group(
    workspace_id: str,
    envelope: MutationEnvelope,
    request: Request,
    principal: PrincipalDep,
) -> Draft:
    """Delete a group's decisions and resulting annotations (payload
    ``ReopenCommand``)."""
    key = own_key(principal, decode_workspace_id(workspace_id))
    return _groups_service(request).reopen(key, envelope)


@router.post("/workspaces/{workspace_id}/consolidation-groups/reopen-all")
def reopen_all_consolidation_groups(
    workspace_id: str,
    envelope: MutationEnvelope,
    request: Request,
    principal: PrincipalDep,
) -> Draft:
    """Reopen every group of the round in one mutation; matching groups are
    taken over again (payload ``ReopenAllCommand``)."""
    key = own_key(principal, decode_workspace_id(workspace_id))
    return _groups_service(request).reopen_all(key, envelope)


@router.post("/workspaces/{workspace_id}/consolidation-groups/undo-reopen-all")
def undo_reopen_all_consolidation_groups(
    workspace_id: str,
    envelope: MutationEnvelope,
    request: Request,
    principal: PrincipalDep,
) -> Draft:
    """Restore the decisions before "Reopen all", directly after it
    (payload ``UndoReopenAllCommand``)."""
    key = own_key(principal, decode_workspace_id(workspace_id))
    return _groups_service(request).undo_reopen_all(key, envelope)
