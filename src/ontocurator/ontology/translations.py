"""Translated term names: the files they come from and how they are searched.

The files are the official babelon TSVs (``hp-de.babelon.tsv``,
``hp-de.synonyms.tsv``). The vendored loader reads them unchanged. What decides
which file belongs to which ontology, and how the translated names are searched,
lives here, outside the vendored code.
"""

from __future__ import annotations

import csv
import hashlib
import re
from collections.abc import Collection, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ontocurator.vendor.hpo_span_annotator.hpo import (
    Ontology,
    OntologyError,
    load_translations,
    normalise,
)
from ontocurator.vendor.hpo_span_annotator.lexical import (
    LexicalIndex,
    LexicalIndexError,
)

# <prefix>-<language>.<anything>.tsv, e.g. hp-de.babelon.tsv. The prefix is the
# ontology's dominant id prefix in lower case, the language has two letters.
_TRANSLATION_NAME = re.compile(
    r"^(?P<prefix>[a-z][a-z0-9]*)-(?P<language>[a-z]{2})\.(?:[a-z0-9_-]+\.)*tsv$"
)


def parse_translation_name(name: str) -> tuple[str, str] | None:
    """``(prefix, language)`` of a translation file name, or None if it is none."""
    match = _TRANSLATION_NAME.match(name.lower())
    if match is None:
        return None
    return match.group("prefix"), match.group("language")


def discover_translation_files(search_dirs: Iterable[Path]) -> list[Path]:
    """Translation files in the ontology folders, sorted by name.

    A name found in two folders is taken from the first one, so a file in the
    workspace replaces the one shipped next to the executable.
    """
    found: dict[str, Path] = {}
    for directory in search_dirs:
        if not directory.is_dir():
            continue
        # Not a glob: "*.tsv" would miss "HP-DE.BABELON.TSV" on Linux.
        for candidate in directory.iterdir():
            key = candidate.name.lower()
            if key not in found and parse_translation_name(key) and candidate.is_file():
                found[key] = candidate
    return [found[key] for key in sorted(found)]


def babelon_problem(path: Path) -> str | None:
    """Why a file cannot be a babelon TSV, or None if its header is fine."""
    try:
        with path.open(encoding="utf-8", newline="") as handle:
            header = next(csv.reader(handle, delimiter="\t"), None)
    except (OSError, UnicodeDecodeError, csv.Error) as exc:
        return f"{path.name} cannot be read as a tab-separated text file: {exc}"
    if not header or "subject_id" not in header:
        return f"{path.name} has no subject_id column. This is not a babelon TSV."
    return None


@dataclass(frozen=True)
class LoadedTranslation:
    """One translation file whose names are part of an ontology's index."""

    filename: str
    sha256: str
    languages: tuple[str, ...]


@dataclass(frozen=True)
class SkippedTranslation:
    """A translation file for this ontology that contributed nothing."""

    filename: str
    reason: str


def apply_translations(
    ontology: Ontology, paths: Iterable[Path]
) -> tuple[list[LoadedTranslation], list[SkippedTranslation]]:
    """Merge the files that belong to this ontology onto its terms.

    A file belongs to the ontology when the prefix in its name is the
    ontology's dominant id prefix. Other files are not this ontology's business
    and are ignored without a word. A file that belongs here but cannot be used
    is reported, never raised: a broken translation must not cost the ontology.
    """
    prefix = (ontology.dominant_prefix or "").lower()
    loaded: list[LoadedTranslation] = []
    skipped: list[SkippedTranslation] = []
    for path in sorted(paths, key=lambda p: p.name.lower()):
        parsed = parse_translation_name(path.name)
        if parsed is None or not prefix or parsed[0] != prefix:
            continue
        # The loader merges row by row. A file that breaks in the middle must
        # leave nothing behind, so the names as they are now are remembered.
        before = {
            term_id: {code: list(names) for code, names in term.translations.items()}
            for term_id, term in ontology.terms.items()
            if term.translations
        }
        try:
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            counts = load_translations(ontology, [path])
        except (OntologyError, OSError, UnicodeDecodeError, csv.Error) as exc:
            for term_id, term in ontology.terms.items():
                if term.translations or term_id in before:
                    term.translations = before.get(term_id, {})
            skipped.append(SkippedTranslation(path.name, str(exc)))
            continue
        if not counts:
            skipped.append(
                SkippedTranslation(
                    path.name,
                    f"{path.name} holds no name for a term of this ontology.",
                )
            )
            continue
        loaded.append(LoadedTranslation(path.name, digest, tuple(sorted(counts))))
    return loaded, skipped


def translation_counts(ontology: Ontology) -> dict[str, int]:
    """Language -> number of live terms with at least one name in it."""
    counts: dict[str, int] = {}
    for term in ontology.live_terms():
        for language, names in term.translations.items():
            if names:
                counts[language] = counts.get(language, 0) + 1
    return dict(sorted(counts.items()))


class TranslatedNames:
    """Exact-match index of the translated names.

    The ontology's own index holds labels and synonyms only. This is the same
    lookup (same normalisation) for the names the babelon files added.
    """

    def __init__(self, ontology: Ontology) -> None:
        self.ontology = ontology
        # Normalised name -> [(language, term id, the name as written)].
        self._names: dict[str, list[tuple[str, str, str]]] = {}
        for term in ontology.live_terms():
            for language, names in term.translations.items():
                for name in names:
                    self._names.setdefault(normalise(name), []).append(
                        (language, term.hpo_id, name)
                    )

    def exact(self, query: str, languages: Collection[str]) -> list[dict[str, Any]]:
        """Terms with a name in one of ``languages`` that equals the query.

        Ordered by language code, then term id: a fixed order that says nothing
        about relevance. Each term appears once.
        """
        hits = sorted(
            hit for hit in self._names.get(normalise(query), []) if hit[0] in languages
        )
        out: list[dict[str, Any]] = []
        seen: set[str] = set()
        for language, hpo_id, name in hits:
            if hpo_id in seen:
                continue
            seen.add(hpo_id)
            out.append(
                {
                    **self.ontology.terms[hpo_id].as_dict(),
                    "matched_term": name,
                    "match_kind": "translation",
                    "matched_language": language,
                }
            )
        return out


class LanguageLexicalIndex(LexicalIndex):
    """The lexical index, searchable in a chosen subset of its languages.

    One index holds every language. A search that names languages ignores the
    rows of all others *before* the best name per term is picked. Filtering the
    finished list instead would lose every term whose best-scoring name is in a
    language the annotator switched off, although an English name of the same
    term matches too.

    The index holds a string once per term, also when two languages share it
    (``Hypotonie`` is a French and a Dutch name of one term), and the vendored
    index tags that row with the first of the languages only. Which rows carry
    a name of which language is therefore kept here, once per build, so a
    shared name counts for each of its languages and a search does no pass
    over the rows in Python.
    """

    # More selections than this are not kept; a mask is one byte per row.
    _MAX_CACHED_MASKS = 64

    def __init__(
        self,
        ontology: Ontology,
        languages: Iterable[str] = (),
        cache_dir: Path | None = None,
    ) -> None:
        super().__init__(ontology, languages=languages, cache_dir=cache_dir)
        # Language -> boolean array over the rows: "a name of this language".
        self._language_rows: dict[str, Any] = {}
        # Row -> its languages, sorted, for the rows that have more than one.
        self._shared_rows: dict[int, tuple[str, ...]] = {}
        # Selection -> boolean array over the rows that are switched off.
        self._off_rows: dict[frozenset[str], Any] = {}

    def build(self) -> None:
        super().build()
        import numpy as np

        size = len(self._terms)
        rows = {code: np.zeros(size, dtype=bool) for code in sorted(self.languages)}
        shared: dict[int, tuple[str, ...]] = {}
        for index, tag in enumerate(self._term_language):
            if tag == "en":
                continue
            translations = self.ontology.terms[self._ids[index]].translations
            text = self._terms[index]
            codes = tuple(c for c in rows if text in translations.get(c, ()))
            for code in codes:
                rows[code][index] = True
            if len(codes) > 1:
                shared[index] = codes
        # A language without a single row has nothing to switch off.
        self._language_rows = {c: mask for c, mask in rows.items() if mask.any()}
        self._shared_rows = shared
        self._off_rows = {}

    def _rows_off(self, allowed: frozenset[str]) -> Any:
        """The rows no allowed language has a name in; None if there is none."""
        if allowed.issuperset(self._language_rows):
            return None
        off = self._off_rows.get(allowed)
        if off is None:
            import numpy as np

            off = np.zeros(len(self._terms), dtype=bool)
            for code, mask in self._language_rows.items():
                if code not in allowed:
                    off |= mask
            # A shared name stays on while one of its languages is allowed.
            for code, mask in self._language_rows.items():
                if code in allowed:
                    off &= ~mask
            if len(self._off_rows) >= self._MAX_CACHED_MASKS:
                self._off_rows.clear()
            self._off_rows[allowed] = off
        return off

    def _language_of(self, index: int, allowed: frozenset[str] | None) -> str:
        """The language a row is reported with: one that was searched."""
        codes = self._shared_rows.get(index)
        if codes is None:
            return self._term_language[index]
        return next(c for c in codes if allowed is None or c in allowed)

    def search(
        self,
        query: str,
        k: int,
        languages: Collection[str] | None = None,
    ) -> list[dict[str, Any]]:
        if not self.ready:
            raise LexicalIndexError("the lexical index is not built")
        import numpy as np

        allowed = None if languages is None else frozenset(languages)
        scores = (self._vectorizer.transform([query]) @ self._matrix.T).toarray()[0]
        # Nothing to switch off when every language is searched, and in
        # particular when no translation is loaded at all.
        off = None if allowed is None else self._rows_off(allowed)
        if off is not None:
            scores[off] = 0.0

        # From here on this is the parent's ranking: best name per term, top k.
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
                    self._language_of(int(index), allowed),
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
                    "matched_language": language,
                    "match_kind": "ngram" if language == "en" else f"ngram:{language}",
                }
            )
        return out
