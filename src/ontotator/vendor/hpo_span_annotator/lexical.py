"""Char n-gram TF-IDF over ontology names: the scored, model-free search route.

`exact`, `id` and `browse` are narrow: they need the annotator to type a string
that matches, or to already know roughly where in the ontology to look.
Character n-grams add a *scored* route that answers a phrase the annotator has
not matched exactly, without any embedding model or external service.

Adapted from hpo-span-annotator (MIT); see THIRD_PARTY_NOTICES.md.

## What it is and is not good at

It matches surface form. Morphological variants, word order, partial phrases and
typos land; `low muscle tone` returns Hypotonia at 1.00. Paraphrase with no
shared characters does not: `cannot hear well` returns nothing useful. It is an
addition to the exact, id and browse routes, not a semantic search.

## Translations, and why coverage is the whole story

HPO ships official translations, so a query can match a name in its own language
instead of an English one. Whether that pays is decided almost entirely by how
much of the ontology the language covers. Measured over every term that has a
name in the language, querying with that name perturbed the way clinical phrasing
differs from a catalogue entry:

| | coverage | hit@3 when covered | hit@3 with no transl. | weighted over HPO |
|---|---|---|---|---|
| Spanish | 96% | 97.2% | 62.0% | **95.7%** |
| French | 68% | 96.8% | 55.5% | **83.8%** |
| German | 18% | 97.2% | 49.3% | **58.0%** |

Once a term has a name in the language the route finds it about equally well in
all three, so the differences in the last column are coverage and nothing else.
German is additionally worse than 18% suggests, because its coverage sits away
from the general terms: 0% of the seven terms at depth 1 and 8-9% at depths 2
and 3, against 21% deep in the tree.

Two earlier versions of this table were wrong, in ways worth keeping written down.
The first had French *losing* points from its own translations; that was this
module's loader indexing untranslated English strings as French. The second
reported German highest at 65.6%, measured only on terms carrying two or more
German names so that one could be held out -- 311 terms, 1.6% of HPO, and zero
terms for Spanish, so the best-covered language was never measured at all. A
measurement that can only see the well-covered corner of a language will always
say coverage does not matter.

These numbers come from HPO's own names, not clinical text. They set a direction
and not a conclusion.

## Why languages are pooled rather than scoped per document

A document's language is known, so the index could be restricted to it. Measured,
that buys nothing: pooled against scoped differs by under 1.5 points at every
cutoff in both directions, and only 3% (French) to 10% (German) of top-10 slots
are filled by a name from another language at all. One index is simpler, and a
document written in one language quoting a term in another still works.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from ontotator.vendor.hpo_span_annotator.hpo import Ontology, normalise

# Character n-grams, not words. `char_wb` keeps n-grams inside word boundaries,
# which stops a match spanning two unrelated words. 3-5 measured best of the
# three ranges tried; 3-4 is smaller and slightly faster if size ever matters.
NGRAM_RANGE = (3, 5)


# Query words shorter than this are not checked against a hit's words ("of").
MIN_WORD = 3


def _typo_distance(query_word: str, word: str, anywhere: bool = False) -> int:
    """Edits (a swap of two letters counts one) from ``query_word`` to the
    closest start of ``word``, so a word typed so far still matches its word;
    with ``anywhere`` to its closest part."""
    rows = [[0] * (len(word) + 1) if anywhere else list(range(len(word) + 1))]
    for i, qc in enumerate(query_word, 1):
        row = [i] + [0] * len(word)
        for j, wc in enumerate(word, 1):
            row[j] = min(rows[-1][j] + 1, row[j - 1] + 1, rows[-1][j - 1] + (qc != wc))
            if i > 1 and j > 1 and qc == word[j - 2] and query_word[i - 2] == wc:
                row[j] = min(row[j], rows[-2][j - 2] + 1)
        rows.append(row)
    return min(rows[-1])


def word_tier(
    query: str, name: str, memo: dict[str, int | None] | None = None
) -> int | None:
    """How a name matches the query word by word: 0 a word starts with a query
    word, 1 contains one or is (a typo away from) a part of one, as in compounds,
    2 starts a typo away from one (an edit per four letters); None when no query
    word is near any of its words.

    Char n-grams alone also score a shared ending: "patient" found "Transient"
    and "Deficient" (acceptance 21.4). A hit has to be near the query as a word.
    """
    query_words = [
        w for w in re.findall(r"\w+", normalise(query)) if len(w) >= MIN_WORD
    ]
    if not query_words:
        return 0
    memo = {} if memo is None else memo
    best: int | None = None
    for word in re.findall(r"\w+", normalise(name)):
        if word not in memo:
            tiers = [
                0 if word.startswith(q) else 1 if q in word or near_part else 2
                for q in query_words
                # "Hypotonia" for "Muskelhypotonie": the name word inside the query word.
                if (
                    near_part := len(word) >= 5
                    and _typo_distance(word, q, anywhere=True) <= len(word) // 4
                )
                or q in word
                or _typo_distance(q, word) <= len(q) // 4
            ]
            memo[word] = min(tiers, default=None)
        tier = memo[word]
        if tier is not None and (best is None or tier < best):
            best = tier
    return best


class LexicalIndexError(RuntimeError):
    """The lexical route cannot be built or queried."""


class LexicalIndex:
    """TF-IDF over every HPO name, one row per string.

    One row per *string* rather than per term, scored by the max over a term's
    strings, because concatenating a term's ten names into one document makes every one of them a
    worse match for itself.
    """

    def __init__(
        self,
        ontology: Ontology,
        languages: Iterable[str] = (),
        cache_dir: Path | None = None,
    ) -> None:
        self.ontology = ontology
        self.languages = list(languages)
        self.cache_dir = Path(cache_dir) if cache_dir else None
        self._vectorizer: Any = None
        self._matrix: Any = None
        self._ids: list[str] = []
        self._terms: list[str] = []
        self._term_language: list[str] = []

    @property
    def cache_path(self) -> Path | None:
        if not self.cache_dir:
            return None
        key = hashlib.sha256(
            f"{self.ontology.release}|{','.join(sorted(self.languages))}|{NGRAM_RANGE}".encode()
        ).hexdigest()[:16]
        return self.cache_dir / f"lexical-{self.ontology.release}-{key}.joblib"

    def _feed(self) -> None:
        english_by_term: dict[str, set[str]] = {}
        for term in self.ontology.live_terms():
            english = set(term.search_terms())
            english_by_term[term.hpo_id] = english
            for text in term.search_terms(languages=self.languages):
                self._ids.append(term.hpo_id)
                self._terms.append(text)
                if text in english:
                    self._term_language.append("en")
                else:
                    self._term_language.append(
                        next(
                            (
                                code
                                for code in self.languages
                                if text in term.translations.get(code, ())
                            ),
                            "?",
                        )
                    )

    def build(self) -> None:
        """Fit the vectorizer. Seconds, not minutes, and no model download."""
        try:
            import scipy.sparse as sp
            from sklearn.feature_extraction.text import TfidfVectorizer
        except ImportError as exc:  # pragma: no cover - environment dependent
            raise LexicalIndexError(
                "the lexical route needs the optional extra: uv sync --extra lexical"
            ) from exc

        self._ids, self._terms, self._term_language = [], [], []
        self._feed()
        if not self._terms:
            raise LexicalIndexError("no HPO names to index")
        # `sublinear_tf` because a name is a handful of characters long and a
        # repeated n-gram inside one says little; without it, a name that happens
        # to repeat a common trigram outranks a shorter exact one.
        self._vectorizer = TfidfVectorizer(
            analyzer="char_wb", ngram_range=NGRAM_RANGE, sublinear_tf=True
        )
        # CSC transposes to CSR, avoiding a full ontology conversion on each
        # CSR query-vector multiplication. Keep only this fitted sparse layout.
        self._matrix = sp.csc_matrix(self._vectorizer.fit_transform(self._terms))

    @property
    def ready(self) -> bool:
        return self._matrix is not None

    def stats(self) -> dict[str, Any]:
        if not self.ready:
            return {"ready": False}
        by_language: dict[str, int] = {}
        for code in self._term_language:
            by_language[code] = by_language.get(code, 0) + 1
        return {
            "ready": True,
            "strings": len(self._terms),
            "vocabulary": len(self._vectorizer.vocabulary_),
            "languages": dict(sorted(by_language.items())),
        }

    def search(self, query: str, k: int) -> list[dict[str, Any]]:
        if not self.ready:
            raise LexicalIndexError("the lexical index is not built")
        import numpy as np

        scores = (self._vectorizer.transform([query]) @ self._matrix.T).toarray()[0]
        # Max over a term's strings, then top-k terms. Taking top-k *strings*
        # would let one term with nine names fill the whole list.
        # Word matches before typo matches, each by score; no word near the query, no hit.
        best: dict[str, tuple[int, float, str, str]] = {}
        memo: dict[str, int | None] = {}
        for index in np.argsort(-scores)[: max(400, k * 40)]:
            score = float(scores[index])
            if score <= 0:
                break
            tier = word_tier(query, self._terms[index], memo)
            if tier is None:
                continue
            hpo_id = self._ids[index]
            if hpo_id not in best or (tier, -score) < (
                best[hpo_id][0],
                -best[hpo_id][1],
            ):
                best[hpo_id] = (
                    tier,
                    score,
                    self._terms[index],
                    self._term_language[index],
                )
            if len(best) >= k * 4:
                break

        ranked = sorted(best.items(), key=lambda kv: (kv[1][0], -kv[1][1]))[:k]
        out = []
        for hpo_id, (_tier, score, matched, language) in ranked:
            term = self.ontology.terms[hpo_id]
            out.append(
                {
                    **term.as_dict(),
                    "matched_term": matched,
                    "score": round(score, 4),
                    # Shown in the interface: a hit whose matching name is French
                    # while the document is Spanish is one the annotator should
                    # look at twice, and hiding that would make it look native.
                    "matched_language": language,
                    "match_kind": "ngram" if language == "en" else f"ngram:{language}",
                }
            )
        return out
