"""The ontology search routes, and the shuffle of scored results.

| Route     | What it does                           |
|-----------|----------------------------------------|
| `lexical` | char n-gram TF-IDF over ontology names |
| `exact`   | normalised label / synonym match       |
| `id`      | a term id typed straight in            |
| `browse`  | parents, children, siblings            |

None of them uses an embedding model. ``lexical`` is scored, so it answers a
phrase the annotator has not matched exactly; see
:mod:`hpo_span_annotator.lexical`. Which route found each accepted term is
recorded, so annotations can later be analysed by how they were found.

## Why the scored hits come back shuffled

The annotator sees ranked candidates in a random order, and the true rank is
carried along invisibly:

- **A ranked list anchors.** A first position reads as a recommendation even
  when the score is wrong. Shuffling makes the annotator read the candidates.
- **The ranking stays analysable.** Annotations whose choices correlate with
  display position could not later be used to judge a ranking.

The permutation is derived from a seed, not drawn fresh, so it is stable across
a re-render and a page reload and differs between two annotators looking at the
same mention. That difference is itself measurable: if two annotators disagree,
the orders they each saw are on record.

## The line between a shuffled route and an ordered one

**A route is shuffled when its order comes from a similarity score.**
``lexical`` is: a score is one system's opinion about relevance, and a list
sorted by it anchors the reader on position 1 whatever produced it.

``exact``, ``id`` and ``browse`` are **not** shuffled. Their order encodes a fact
about the match -- an exact label beats an exact synonym beats a looser
predicate, a child is a child -- and destroying it would cost the annotator
information without removing a bias.
"""

from __future__ import annotations

import hashlib
import random
import re
from typing import Any

from ontotator.vendor.hpo_span_annotator.hpo import (
    Ontology,
    Term,
    curie,
    normalise,
)
from ontotator.vendor.hpo_span_annotator.lexical import LexicalIndex

PATHS = ("lexical", "exact", "id", "browse")

# Routes that use no embedding model (all current routes).
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


# PREFIX, then ':', '_' or one space, then digits: `hp:0001250`, `HP 1250`.
_TYPED_ID = re.compile(r"^([A-Za-z][A-Za-z0-9]*)[:_ ](\d+)$")


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
    slot the annotator saw. Keeping both is the whole point: annotations stay free
    of a position anchor while rank-1 and hit@k remain computable from them later.
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
        raw = (query or "").strip()
        if not raw:
            return []

        # 1. Digits alone mean the unique dominant prefix
        if raw.isdigit():
            dominant = self.ontology.dominant_prefix
            if not dominant:
                return []
            return self._numeric_id(dominant, int(raw))

        # 2. Explicit query: full CURIE or OBO identifier
        candidate = raw
        if ":" not in candidate and "_" in candidate:
            parsed = curie(candidate)
            if parsed:
                candidate = parsed

        term = self.ontology.get(candidate)
        if term:
            return [self._id_hit(term)]
        # 3. Typed forms: any prefix case, ':', '_' or a space, unpadded digits
        typed = _TYPED_ID.match(raw)
        if typed is None:
            return []
        return self._numeric_id(typed.group(1), int(typed.group(2)))

    def _numeric_id(self, prefix: str, number: int) -> list[dict[str, Any]]:
        """The one term whose id is `prefix` plus a number equal to `number`."""
        wanted = prefix.casefold()
        matched_terms: list[Term] = []
        for candidate_term in self.ontology.terms.values():
            if ":" not in candidate_term.hpo_id:
                continue
            term_prefix, local_id = candidate_term.hpo_id.split(":", 1)
            if (
                term_prefix.casefold() == wanted
                and local_id.isdigit()
                and int(local_id) == number
            ):
                matched_terms.append(candidate_term)
        # Prefix ties or multiple matching IDs return no ID candidate
        if len(matched_terms) != 1:
            return []
        return [self._id_hit(matched_terms[0])]

    @staticmethod
    def _id_hit(term: Term) -> dict[str, Any]:
        return {**term.as_dict(), "matched_term": term.hpo_id, "match_kind": "id"}

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
