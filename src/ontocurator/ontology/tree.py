"""The ontology as a tree to walk: roots, children and paths from a root.

Search answers "which term has this name". The tree answers the question a
ranked list cannot: what lies next to, above and below a term. Nothing here is
scored and nothing is shuffled; children come in alphabetical order.

Obsolete terms are not part of the tree. A term whose parents are all obsolete
is therefore shown as a root rather than lost.

Classes of other ontologies that a release merely refers to are not roots; see
:meth:`OntologyTree.roots` for the exact rule.

Cost: a request touches the terms it shows and their children, never the whole
ontology. The one exception, finding the roots, is done once per loaded
ontology and kept, as is every path once it was worked out (see
:func:`tree_for`).
"""

from __future__ import annotations

import heapq
import threading

from pydantic import BaseModel, ConfigDict

from ontocurator.domain.errors import DomainError
from ontocurator.ontology.links import external_term_url
from ontocurator.vendor.hpo_span_annotator.hpo import Ontology, Term


class TreeNode(BaseModel):
    """One row of the tree."""

    model_config = ConfigDict(extra="forbid")

    term_id: str
    label: str
    child_count: int
    external_url: str | None = None


class TreeLevel(BaseModel):
    """An expanded node and the children shown under it."""

    model_config = ConfigDict(extra="forbid")

    term_id: str
    children: list[TreeNode]


class TreeTermDetail(BaseModel):
    """What the detail pane shows for the selected node."""

    model_config = ConfigDict(extra="forbid")

    term_id: str
    label: str
    definition: str
    synonyms: list[str]
    # Language code -> translated names. Empty unless translation files are loaded.
    translations: dict[str, list[str]]
    # Every parent, alphabetically. The interface lists the ones the current
    # path does not run through as "Also under".
    parents: list[TreeNode]
    external_url: str | None = None


class OntologyTree:
    """Read-only tree view of a loaded ontology."""

    def __init__(self, ontology: Ontology) -> None:
        self.ontology = ontology
        # The roots need one pass over every term; they are found once.
        self._roots: list[str] | None = None
        # Term id -> its path from a root. Filled as terms are asked for; the
        # hierarchy and the labels of a loaded ontology never change.
        self._paths: dict[str, list[str]] = {}

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
        """The top level of the tree, sorted by label.

        A root is a live term without a live parent. In an ontology with a
        dominant prefix that alone is not enough: a release carries classes of
        other ontologies it refers to, thousands of them without any parent.
        There a root is a live term without a live parent that either has the
        dominant prefix or has a live term with the dominant prefix somewhere
        below it. The second half keeps every term of the ontology reachable
        and lets every path of such a term start at a root.
        """
        roots = self._roots
        if roots is None:
            # Two threads may both get here; they compute the same list.
            tops = [
                term.hpo_id
                for term in self.ontology.terms.values()
                if not term.obsolete
                and not any(self.live(p) is not None for p in term.parents)
            ]
            prefix = self.ontology.dominant_prefix
            if prefix is not None and not all(
                self._has_prefix(t, prefix) for t in tops
            ):
                above = self._above_prefix(prefix)
                tops = [t for t in tops if self._has_prefix(t, prefix) or t in above]
            roots = self._sorted(tops)
            self._roots = roots
        return list(roots)

    def roots_with(self, path: list[str]) -> list[str]:
        """The roots, and the top of this path if it is not one of them.

        Only a path to a term of another ontology can start outside the roots.
        Such a term may still be the term of an annotation; the tree opened
        there shows the top above it as one more row of the top level.
        """
        roots = self.roots()
        if not path or path[0] in roots:
            return roots
        return self._sorted([*roots, path[0]])

    @staticmethod
    def _has_prefix(term_id: str, prefix: str) -> bool:
        return term_id.split(":", 1)[0] == prefix

    def _above_prefix(self, prefix: str) -> set[str]:
        """Every live term that has a live term with this prefix below it."""
        above: set[str] = set()
        stack = [
            term.hpo_id
            for term in self.ontology.terms.values()
            if not term.obsolete and self._has_prefix(term.hpo_id, prefix)
        ]
        while stack:
            term = self.live(stack.pop())
            if term is None:
                continue
            for parent_id in term.parents:
                parent = self.live(parent_id)
                if parent is not None and parent.hpo_id not in above:
                    above.add(parent.hpo_id)
                    stack.append(parent.hpo_id)
        return above

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
            external_url=external_term_url(term_id),
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
            return list(self._path(term.hpo_id))
        parent = self.live(via_parent_id)
        if parent is None or parent.hpo_id not in term.parents:
            raise DomainError(
                "INVALID_TREE_PARENT",
                f"Term '{via_parent_id}' is not a parent of '{term.hpo_id}'",
            )
        return [*self._path(parent.hpo_id), term.hpo_id]

    def _path(self, term_id: str) -> list[str]:
        """The best path of a live term, kept for the next request.

        Works without recursion and by distance from a root, so a file that is
        deeper than Python's stack or (wrongly) cyclic gets the same answer
        whatever was asked first.
        """
        known = self._paths.get(term_id)
        if known is not None:
            return known

        # The ancestors whose paths are not known yet, and their live parents.
        parents: dict[str, list[str]] = {}
        stack = [term_id]
        while stack:
            current = stack.pop()
            if current in parents or current in self._paths:
                continue
            parents[current] = self.parents_of(current)
            stack.extend(parents[current])
        children: dict[str, list[str]] = {}
        for child, above in parents.items():
            for parent in above:
                children.setdefault(parent, []).append(child)

        # Distance from a root, counted outwards from what is already known:
        # the roots among the new terms and the ancestors with a kept path.
        depth = {t: 0 for t, above in parents.items() if not above}
        depth.update({t: len(self._paths[t]) - 1 for t in children if t in self._paths})
        heap = [(d, t) for t, d in depth.items()]
        heapq.heapify(heap)
        order: list[str] = []
        while heap:
            d, current = heapq.heappop(heap)
            if d != depth[current]:
                continue
            if current in parents:
                order.append(current)
            for child in children.get(current, ()):
                if d + 1 < depth.get(child, d + 2):
                    depth[child] = d + 1
                    heapq.heappush(heap, (d + 1, child))

        # Nearest first, so the paths one level up are there when needed.
        found: dict[str, list[str]] = {}
        for current in order:
            candidates = [
                found.get(parent) or self._paths[parent]
                for parent in parents[current]
                if depth.get(parent) == depth[current] - 1
            ]
            best: list[str] = []
            if candidates:
                # All equally short: the labels decide, from the root down.
                best = min(
                    candidates,
                    key=lambda path: (
                        [self.ontology.label_of(i).casefold() for i in path],
                        path,
                    ),
                )
            found[current] = [*best, current]
        # Threads that get here together write the same paths.
        self._paths.update(found)
        # No root above it: only possible in a cyclic file. It stands alone.
        return found.get(term_id, [term_id])

    def levels(self, expanded_ids: list[str]) -> list[TreeLevel]:
        """The children shown under each of these nodes, in the given order."""
        return [
            TreeLevel(term_id=term_id, children=self.nodes(self.children_of(term_id)))
            for term_id in expanded_ids
        ]

    def detail(self, term_id: str) -> TreeTermDetail | None:
        term = self.live(term_id)
        if term is None:
            return None
        return TreeTermDetail(
            term_id=term.hpo_id,
            label=term.label,
            definition=term.definition,
            synonyms=list(dict.fromkeys(value for _, value in term.synonyms)),
            translations={
                language: list(names)
                for language, names in sorted(term.translations.items())
                if names
            },
            parents=self.nodes(self.parents_of(term.hpo_id)),
            external_url=external_term_url(term.hpo_id),
        )


# The attribute of a loaded ontology that carries its tree.
_TREE_ATTRIBUTE = "_ontocurator_tree"
_trees_lock = threading.Lock()


def tree_for(ontology: Ontology) -> OntologyTree:
    """The tree of a loaded ontology, built once and kept as long as it lives.

    Requests share it, so the pass over all terms that finds the roots happens
    once per ontology and not once per request.

    The tree is kept on the ontology itself, not in a table beside it. A tree
    refers to its ontology, so a table -- even one with weak keys -- would hold
    every ontology ever loaded; this way the two form a cycle that is collected
    once nothing else refers to the ontology.
    """
    with _trees_lock:
        tree: OntologyTree | None = getattr(ontology, _TREE_ATTRIBUTE, None)
        if tree is None:
            tree = OntologyTree(ontology)
            setattr(ontology, _TREE_ATTRIBUTE, tree)
        return tree
