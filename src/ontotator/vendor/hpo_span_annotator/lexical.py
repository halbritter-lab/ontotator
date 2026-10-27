"""Char n-gram TF-IDF over HPO names. The scored route that runs no encoder.

This exists because of a circularity problem, not because a second search box is
nice to have. Phentrieve is the search aid inside this tool *and* the system the
resulting benchmark scores, so a gold whose terms were only ever reachable
through its encoder would score that encoder near 1.0 by construction. `exact`,
`id` and `browse` avoid that but are narrow: they need the annotator to type a
string that matches, or to already know roughly where in the ontology to look.

Character n-grams give a *scored* route that shares nothing with the evaluated
stack. It is checked, not assumed: phentrieve ships only `DenseRetriever` over
ChromaDB, with no BM25, TF-IDF or fusion anywhere in its retrieval package, so
there is no shared component. (The sibling ICD tool could not make this claim —
there char-TFIDF was a component of the RRF retriever of record, so a "lexical"
hit was not clean however lexical it looked.)

## What it is and is not good at

It matches surface form. Morphological variants, word order, partial phrases and
typos land; `low muscle tone` returns Hypotonia at 1.00. Paraphrase with no
shared characters does not: `cannot hear well` returns nothing useful. It is an
addition to the clean routes, never a replacement for the dense one.

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
benchmark that can only see the well-covered corner of a language will always say
coverage does not matter.

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
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from ontotator.vendor.hpo_span_annotator.hpo import Ontology

# Character n-grams, not words. `char_wb` keeps n-grams inside word boundaries,
# which stops a match spanning two unrelated words. 3-5 measured best of the
# three ranges tried; 3-4 is smaller and slightly faster if size ever matters.
NGRAM_RANGE = (3, 5)


class LexicalIndexError(RuntimeError):
    """The lexical route cannot be built or queried."""


class LexicalIndex:
    """TF-IDF over every HPO name, one row per string.

    One row per *string* rather than per term, scored by the max over a term's
    strings — the same arrangement the dense index uses, and for the same reason:
    concatenating a term's ten names into one document makes every one of them a
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
        best: dict[str, tuple[float, str, str]] = {}
        for index in np.argsort(-scores)[: max(400, k * 40)]:
            score = float(scores[index])
            if score <= 0:
                break
            hpo_id = self._ids[index]
            if hpo_id not in best or score > best[hpo_id][0]:
                best[hpo_id] = (
                    score,
                    self._terms[index],
                    self._term_language[index],
                )
            if len(best) >= k * 4:
                break

        ranked = sorted(best.items(), key=lambda kv: -kv[1][0])[:k]
        out = []
        for hpo_id, (score, matched, language) in ranked:
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
