"""The four routes into HPO, and the shuffle that keeps the gold unanchored.

| Route     | What it does                          | Touches an encoder |
|-----------|---------------------------------------|--------------------|
| `dense`   | BioLORD nearest neighbours            | yes                |
| `lexical` | char n-gram TF-IDF over HPO names     | no                 |
| `exact`   | normalised label / synonym match      | no                 |
| `id`      | a term id typed straight in           | no                 |
| `browse`  | parents, children, siblings           | no                 |

``dense`` is the comfortable one and the other four are the reason the tool is
trustworthy. ``lexical`` is the one that makes them usable rather than merely
present: it is scored, so it answers a phrase the annotator has not matched
exactly, while sharing nothing with the evaluated stack. See
:mod:`hpo_span_annotator.lexical`.

BioLORD-2023-M is phentrieve's own encoder, so a term the ``dense`` route cannot
surface is a term the evaluated system also cannot surface; if it were the only
way in, the gold's reachable space would be bounded by the system the gold is
later used to score. Which route found each accepted term is recorded on the
record, so that share is a number rather than an assumption.

## Why the scored hits come back shuffled

The annotator sees ranked candidates in a random order, and the true rank is
carried along invisibly. Two reasons, and only the first is about this tool:

- **A ranked list anchors.** On the sibling ICD gold the retriever put the right
  answer first 42.3% of the time, so a first position that reads as a
  recommendation is wrong more often than right. Shuffling makes the annotator
  read the candidates.
- **The ranking is the thing being measured.** A gold whose choices correlate
  with display position cannot then be used to score display position.

The permutation is derived from a seed, not drawn fresh, so it is stable across
a re-render and a page reload and differs between two annotators looking at the
same mention. That difference is itself measurable: if two annotators disagree,
the orders they each saw are on record.

## The line between a shuffled route and an ordered one

**A route is shuffled when its order comes from a similarity score.** ``dense``
and ``lexical`` both are: a score is one system's opinion about relevance, and a
list sorted by it anchors the reader on position 1 whatever produced it. That the
lexical route is not the system under evaluation does not make its ranking a
fact, so it gets the same treatment.

``exact``, ``id`` and ``browse`` are **not** shuffled. Their order encodes a fact
about the match -- an exact label beats an exact synonym beats a looser
predicate, a child is a child -- and destroying it would cost the annotator
information without removing a bias.
"""

from __future__ import annotations

import hashlib
import random
from typing import Any

from ontocurator.vendor.hpo_span_annotator.hpo import Ontology, normalise
from ontocurator.vendor.hpo_span_annotator.lexical import LexicalIndex

PATHS = ("lexical", "exact", "id", "browse")

# Routes whose accepted terms are independent of the evaluated retriever.
CLEAN_PATHS = frozenset({"lexical", "exact", "id", "browse"})

# Routes whose order is a similarity score rather than a fact about the match.
# These are the ones that get shuffled.
SCORED_PATHS = frozenset({"lexical"})

FOUND_VIA_BY_PATH = {
    "lexical": "lexical_ngram",
    "exact": "lexical_exact",
    "id": "typed_id",
    "browse": "browse",
}


class SearchError(RuntimeError):
    """A route was asked for something it cannot answer."""


def shuffle_seed(annotator_id: str, mention_id: str, query: str, k: int) -> str:
    """The permutation key. Stable per annotator, mention, query and depth.

    Depth is in the key on purpose: expanding from 16 to 32 candidates is a new
    question and reshuffling is honest there. Re-running the same query at the
    same depth is not, and must give the same order back, or the list would
    reshuffle under the annotator every time a card re-renders.
    """
    raw = f"{annotator_id}\x1f{mention_id}\x1f{normalise(query)}\x1f{k}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def shuffled(hits: list[dict[str, Any]], seed: str) -> list[dict[str, Any]]:
    """Permute a ranked list, stamping both numbers onto every hit.

    ``rank`` is what the retriever said and never changes. ``display_pos`` is the
    slot the annotator saw. Keeping both is the whole point: the gold stays free
    of a position anchor while rank-1 and hit@k remain computable from it later.
    """
    ordered = [dict(hit) for hit in hits]
    for index, hit in enumerate(ordered, start=1):
        hit["rank"] = index
    random.Random(seed).shuffle(ordered)
    for position, hit in enumerate(ordered, start=1):
        hit["display_pos"] = position
    return ordered


class SearchEngine:
    """Entry point for model-free and lexical HPO search routes."""

    def __init__(
        self,
        ontology: Ontology,
        lexical: LexicalIndex | None = None,
    ) -> None:
        self.ontology = ontology
        self.lexical = lexical

    def available_paths(self) -> list[str]:
        """Return available search routes."""
        ready = {
            "lexical": bool(self.lexical and self.lexical.ready),
        }
        return [p for p in PATHS if ready.get(p, True)]

    def search(
        self,
        query: str,
        path: str = "lexical",
        k: int = 16,
        seed: str | None = None,
    ) -> dict[str, Any]:
        query = (query or "").strip()
        if not query:
            return {"path": path, "hits": [], "shuffled": False, "seed": seed}
        if path not in PATHS:
            raise SearchError(f"unknown path {path!r}; try one of {', '.join(PATHS)}")

        if path in SCORED_PATHS:
            index = self.lexical
            if not (index and index.ready):
                still = ", ".join(sorted(set(self.available_paths()) - SCORED_PATHS))
                raise SearchError(
                    f"the {path} route is unavailable; {still} still answer"
                )
            hits = index.search(query, k)
            # Shuffled because the order is a score.
            return {
                "path": path,
                "hits": shuffled(hits, seed or shuffle_seed("-", "-", query, k)),
                "shuffled": True,
                "seed": seed,
            }

        if path == "exact":
            hits = self.ontology.exact(query, limit=k)
            if not hits:
                hits = self.ontology.starts_with(query, limit=k)
        elif path == "id":
            hits = self._by_id(query)
        else:
            hits = self._browse(query, k)

        for idx, hit in enumerate(hits, start=1):
            hit["rank"] = idx
            hit["display_pos"] = idx
        return {"path": path, "hits": hits, "shuffled": False, "seed": None}

    def _by_id(self, query: str) -> list[dict[str, Any]]:
        candidate = query.strip().upper().replace("HP_", "HP:")
        if candidate.isdigit():
            candidate = f"HP:{candidate.zfill(7)}"
        term = self.ontology.get(candidate)
        if not term:
            return []
        return [{**term.as_dict(), "matched_term": term.hpo_id, "match_kind": "id"}]

    def _browse(self, query: str, k: int) -> list[dict[str, Any]]:
        """Children first, then siblings, of the id the annotator is standing on.

        Children before siblings because the usual browse question is "is there a
        more specific term for this", and the sibling question -- "does a
        neighbour fit better" -- is what the annotator asks second.
        """
        seed_term = self._by_id(query)
        if not seed_term:
            return []
        anchor = seed_term[0]["hpo_id"]
        out: list[dict[str, Any]] = []
        for kind, ids in (
            ("child", self.ontology.children_of(anchor)),
            ("sibling", self.ontology.siblings_of(anchor)),
        ):
            for hpo_id in ids:
                term = self.ontology.terms[hpo_id]
                out.append(
                    {
                        **term.as_dict(),
                        "matched_term": term.label,
                        "match_kind": kind,
                    }
                )
                if len(out) >= k:
                    return out
        return out
