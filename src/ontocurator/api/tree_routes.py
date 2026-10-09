"""API routes for walking the ontology tree from the term of an annotation.

A walk is logged like a search. ``tree/open`` stores a search event with
``route="browse"`` whose candidates are the terms shown; every ``tree/node``
adds the terms that became visible. A term assigned from the tree names that
event (``set_term`` with ``search_event_id``), so the existing check -- the
term must be among the event's candidates -- and the existing selection event
apply unchanged.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict

from ontocurator.api.routes import RepoDep, WorkspaceSvcDep, layer_ontology
from ontocurator.domain.errors import DomainError
from ontocurator.domain.workspace import WorkspaceKey
from ontocurator.ontology.tree import (
    TreeLevel,
    TreeNode,
    TreeTermDetail,
    tree_for,
)
from ontocurator.packages.models import SearchEventRecord, is_tree_walk

router = APIRouter(prefix="/api/v1")


class TreeOpenRequest(BaseModel):
    """Start a walk at the term of an annotation."""

    model_config = ConfigDict(extra="forbid")

    workspace_key: WorkspaceKey
    annotation_id: str
    layer_id: str
    term_id: str


class TreeOpenResponse(BaseModel):
    """The tree as it opens: roots, the expanded path to the start term."""

    model_config = ConfigDict(extra="forbid")

    browse_id: str
    start_status: Literal["valid", "obsolete", "unknown"]
    roots: list[TreeNode]
    # Ids from a root down to the start term; empty if it is unknown or obsolete.
    path: list[str]
    # One entry per node of the path: the children shown under it.
    levels: list[TreeLevel]
    detail: TreeTermDetail | None


class TreeNodeRequest(BaseModel):
    """Ask about a node the walk has already shown."""

    model_config = ConfigDict(extra="forbid")

    workspace_key: WorkspaceKey
    annotation_id: str
    layer_id: str
    browse_id: str
    term_id: str
    # Return the path that runs through this parent ("Also under").
    via_parent_id: str | None = None
    # The node is being opened: return its children and log them as shown.
    expand: bool = False


class TreeNodeResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    detail: TreeTermDetail
    # Filled only when the request said ``expand``.
    children: list[TreeNode]
    # Filled only with ``via_parent_id``: the path, and the children under each
    # of its nodes above the term itself.
    path: list[str]
    levels: list[TreeLevel]


def _shown(*groups: list[TreeNode]) -> list[str]:
    """Term ids in order of first appearance."""
    return list(dict.fromkeys(node.term_id for group in groups for node in group))


@router.post("/terms/tree/open")
def open_tree(
    req: TreeOpenRequest,
    request: Request,
    repo: RepoDep,
    ws_svc: WorkspaceSvcDep,
) -> TreeOpenResponse:
    """Open the tree at a term and start the walk's event."""
    ontology = layer_ontology(
        request, repo, ws_svc, req.workspace_key, req.layer_id, req.annotation_id
    )
    tree = tree_for(ontology.ontology)
    # A start term that resolves carries its id (an alternative id, another
    # case or stray blanks lead to the same term); one that does not resolve
    # is kept as it was sent.
    start = ontology.validate_term(req.term_id)
    path = tree.path_to(req.term_id)
    roots = tree.nodes(tree.roots_with(path))
    levels = tree.levels(path)
    shown = _shown(roots, *(level.children for level in levels))

    browse_id = str(uuid4())
    repo.save_search_event(
        SearchEventRecord(
            event_id=browse_id,
            workspace_key=req.workspace_key,
            annotation_id=req.annotation_id,
            layer_id=req.layer_id,
            ontology_sha256=ontology.ref.sha256,
            query=start.term_id,
            route="browse",
            candidates=shown,
            # Nothing is scored in a tree: the ranked order is the shown order.
            ranked_ids=list(shown),
            ontology_release=ontology.ref.release,
            index_identity=ontology.identity_for_languages([]),
            search_condition_id=ontology.search_condition.condition_id
            if ontology.search_condition
            else None,
            execution=ontology.execution([]),
            runtime_drift=ontology.runtime_drift(),
            timestamp=datetime.now(UTC).isoformat(),
        )
    )
    return TreeOpenResponse(
        browse_id=browse_id,
        start_status=start.status,
        roots=roots,
        path=path,
        levels=levels,
        detail=tree.detail(req.term_id),
    )


@router.post("/terms/tree/node")
def tree_node(
    req: TreeNodeRequest,
    request: Request,
    repo: RepoDep,
    ws_svc: WorkspaceSvcDep,
) -> TreeNodeResponse:
    """Details of a shown node; its children and other paths on request."""
    ontology = layer_ontology(
        request, repo, ws_svc, req.workspace_key, req.layer_id, req.annotation_id
    )
    not_this_walk = DomainError(
        "INVALID_TREE_WALK",
        "This tree walk does not belong to this workspace, annotation and layer",
    )
    event = repo.get_search_event(req.browse_id)
    if (
        event is None
        # A search with the old "browse" route and the copy written for a
        # selection carry the same route; neither is a walk.
        or not is_tree_walk(event)
        or event.workspace_key != req.workspace_key
        or event.annotation_id != req.annotation_id
        or event.layer_id != req.layer_id
    ):
        raise not_this_walk

    tree = tree_for(ontology.ontology)
    detail = tree.detail(req.term_id)
    if detail is None or detail.term_id not in event.candidates:
        # Only what the walk has shown can be opened or selected: the event
        # then never lists a term the annotator could not have reached.
        raise DomainError(
            "TREE_TERM_NOT_SHOWN",
            f"Term '{req.term_id}' was not shown in this tree walk",
        )

    path: list[str] = []
    levels: list[TreeLevel] = []
    if req.via_parent_id is not None:
        path = tree.path_to(detail.term_id, req.via_parent_id)
        levels = tree.levels(path[:-1])
    children = tree.nodes(tree.children_of(detail.term_id)) if req.expand else []

    # The repository checks the owner again, in the transaction that writes.
    grown = repo.append_search_event_candidates(
        req.browse_id,
        _shown(*(level.children for level in levels), children),
        workspace_key=req.workspace_key,
        annotation_id=req.annotation_id,
        layer_id=req.layer_id,
    )
    if grown is None:
        raise not_this_walk
    return TreeNodeResponse(detail=detail, children=children, path=path, levels=levels)
