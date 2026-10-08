"""The ontology as a tree to walk: roots, children and paths from a root.

Search answers "which term has this name". The tree answers the question a
ranked list cannot: what lies next to, above and below a term. Nothing here is
scored and nothing is shuffled; children come in alphabetical order.

Obsolete terms are not part of the tree. A term whose parents are all obsolete
is therefore shown as a root rather than lost.

Cost: a request touches the terms it shows and their children, never the whole
ontology. The one exception, finding the roots, is done once per loaded
ontology and kept (see :func:`tree_for`).
"""

from __future__ import annotations

import threading
from weakref import WeakKeyDictionary

from pydantic import BaseModel, ConfigDict

from ontocurator.domain.errors import DomainError
from ontocurator.vendor.hpo_span_annotator.hpo import Ontology, Term


class TreeNode(BaseModel):
    """One row of the tree."""

    model_config = ConfigDict(extra="forbid")

    term_id: str
    label: str
    child_count: int


class OntologyTree:
    """Read-only tree view of a loaded ontology."""

    def __init__(self, ontology: Ontology) -> None:
        self.ontology = ontology
        # The roots need one pass over every term; they are found once.
        self._roots: list[str] | None = None

    def live(self, term_id: str) -> Term | None:
        """The term behind an id (alternative ids resolve), unless obsolete."""
        term = self.ontology.get(term_id)
        return None if term is None or term.obsolete else term

    def _sorted(self, term_ids: list[str]) -> list[str]:
        return sorted(
            dict.fromkeys(term_ids),
            key=lambda i: (self.ontology.label_of(i).casefold(), i),
        )

    def parents_of(self, term_id: str) -> list[str]:
        term = self.live(term_id)
        if term is None:
            return []
        return self._sorted([p for p in term.parents if self.live(p) is not None])

    def children_of(self, term_id: str) -> list[str]:
        term = self.live(term_id)
        if term is None:
            return []
        return self._sorted(
            [
                child
                for child in self.ontology.children_of(term.hpo_id)
                if self.live(child) is not None
            ]
        )

    def roots(self) -> list[str]:
        roots = self._roots
        if roots is None:
            # Two threads may both get here; they compute the same list.
            roots = self._sorted(
                [
                    term.hpo_id
                    for term in self.ontology.terms.values()
                    if not term.obsolete
                    and not any(self.live(p) is not None for p in term.parents)
                ]
            )
            self._roots = roots
        return list(roots)

    def child_count(self, term_id: str) -> int:
        """How many children :meth:`children_of` lists, without sorting them."""
        term = self.live(term_id)
        if term is None:
            return 0
        return len(
            {
                child
                for child in self.ontology.children_of(term.hpo_id)
                if self.live(child) is not None
            }
        )

    def node(self, term_id: str) -> TreeNode:
        return TreeNode(
            term_id=term_id,
            label=self.ontology.label_of(term_id),
            child_count=self.child_count(term_id),
        )

    def nodes(self, term_ids: list[str]) -> list[TreeNode]:
        return [self.node(term_id) for term_id in term_ids]

    def path_to(self, term_id: str, via_parent_id: str | None = None) -> list[str]:
        """Ids from a root down to the term; empty for an unknown or obsolete term.

        The shortest path wins; among equally short ones the path whose labels
        sort first, compared from the root down. ``via_parent_id`` forces the
        last step: the path then runs through that parent.
        """
        term = self.live(term_id)
        if term is None:
            return []
        if via_parent_id is None:
            return self._best_path(term.hpo_id, {}, set())
        parent = self.live(via_parent_id)
        if parent is None or parent.hpo_id not in term.parents:
            raise DomainError(
                "INVALID_TREE_PARENT",
                f"Term '{via_parent_id}' is not a parent of '{term.hpo_id}'",
            )
        return [*self._best_path(parent.hpo_id, {}, set()), term.hpo_id]

    def _best_path(
        self, term_id: str, memo: dict[str, list[str]], walking: set[str]
    ) -> list[str]:
        if term_id in memo:
            return memo[term_id]
        # `walking` only guards against a cyclic file; a valid ontology has none.
        walking.add(term_id)
        candidates = [
            self._best_path(parent, memo, walking)
            for parent in self.parents_of(term_id)
            if parent not in walking
        ]
        walking.discard(term_id)
        best: list[str] = []
        if candidates:
            best = min(
                candidates,
                key=lambda path: (
                    len(path),
                    [self.ontology.label_of(i).casefold() for i in path],
                    path,
                ),
            )
        memo[term_id] = [*best, term_id]
        return memo[term_id]


_trees: WeakKeyDictionary[Ontology, OntologyTree] = WeakKeyDictionary()
_trees_lock = threading.Lock()


def tree_for(ontology: Ontology) -> OntologyTree:
    """The tree of a loaded ontology, built once and kept as long as it lives.

    Requests share it, so the pass over all terms that finds the roots happens
    once per ontology and not once per request.
    """
    with _trees_lock:
        tree = _trees.get(ontology)
        if tree is None:
            tree = _trees[ontology] = OntologyTree(ontology)
        return tree
