"""Translated term names: the files they come from and how they are searched.

The files are the official babelon TSVs (``hp-de.babelon.tsv``,
``hp-de.synonyms.tsv``). The vendored loader reads them unchanged. What decides
which file belongs to which ontology, and how the translated names are searched,
lives here, outside the vendored code.
"""

from __future__ import annotations

import codecs
import copy
import csv
import hashlib
import re
import threading
from collections import OrderedDict
from collections.abc import Callable, Collection, Iterable
from concurrent.futures import Future
from dataclasses import dataclass, field
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from ontotator.vendor.hpo_span_annotator.hpo import (
    Ontology,
    OntologyError,
    load_translations,
    normalise,
)
from ontotator.vendor.hpo_span_annotator.lexical import (
    LexicalIndex,
    LexicalIndexError,
)

# <prefix>-<language>.<anything>.tsv, e.g. hp-de.babelon.tsv. The prefix is the
# ontology's dominant id prefix in lower case, the language has two or three
# letters (hp-dtp, hp-nna).
_TRANSLATION_NAME = re.compile(
    r"^(?P<prefix>[a-z][a-z0-9]*)-(?P<language>[a-z]{2,3})\.(?:[a-z0-9_-]+\.)*tsv$"
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
        # utf-8-sig: a byte-order mark (Excel's "UTF-8 with BOM") is not part
        # of the first column name.
        with path.open(encoding="utf-8-sig", newline="") as handle:
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
    content: bytes = field(repr=False, compare=False)


@dataclass(frozen=True)
class SkippedTranslation:
    """A translation file for this ontology that contributed nothing."""

    filename: str
    reason: str


def _load_file(ontology: Ontology, path: Path) -> tuple[str, dict[str, int], bytes]:
    """Merge one file; its SHA-256 and the terms it reached per language.

    The digest is that of the file as it lies on disk. A file that starts with
    a byte-order mark is handed to the vendored loader as a copy without it,
    under the same name (the loader reads the language from the name when the
    column is missing): the loader opens files as plain UTF-8 and would take
    the mark for the start of the first column name.
    """
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    with TemporaryDirectory(prefix="ontotator-translation-") as scratch:
        view = Path(scratch) / path.name
        view.write_bytes(
            raw[len(codecs.BOM_UTF8) :] if raw.startswith(codecs.BOM_UTF8) else raw
        )
        try:
            return digest, load_translations(ontology, [view]), raw
        except OntologyError as exc:
            # Name the file the user knows, not the copy.
            raise OntologyError(str(exc).replace(str(view), str(path))) from exc


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
            digest, counts, raw = _load_file(ontology, path)
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
        loaded.append(LoadedTranslation(path.name, digest, tuple(sorted(counts)), raw))
    return loaded, skipped


# Term id -> language -> the names, as one build left them. Immutable, so any
# number of pinned views can restore their names from it.
FrozenTranslations = dict[str, dict[str, tuple[str, ...]]]


def freeze_translations(ontology: Ontology) -> FrozenTranslations:
    """The translated names of every term, in containers nobody can change."""
    return {
        term_id: {code: tuple(names) for code, names in term.translations.items()}
        for term_id, term in ontology.terms.items()
        if term.translations
    }


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

    def with_ontology(self, ontology: Ontology) -> TranslatedNames:
        """The same names, answering with the terms of ``ontology``.

        Only for an ontology whose translated names are those this index was
        built from (a pinned view of the same build). The name map is never
        changed after construction, so it is shared, not copied.
        """
        view = copy.copy(self)
        view.ontology = ontology
        return view

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


class _SubsetFits:
    """Language subsets fitted once and shared by the pinned views of one build.

    Every pinned view of a build restores the same captured names, so a subset
    one of them fitted is the subset each of them would fit. A fit is shared
    as fitted data only; each view binds it to its own terms. The first
    request for a subset fits it outside the lock; concurrent requests for the
    same subset wait for that fit, other subsets are not held up.
    """

    def __init__(self, limit: int) -> None:
        self._limit = limit
        self._fits: OrderedDict[tuple[str, ...], LexicalIndex] = OrderedDict()
        self._flights: dict[tuple[str, ...], Future[LexicalIndex]] = {}
        self._lock = threading.Lock()

    def get(
        self, key: tuple[str, ...], fit: Callable[[], LexicalIndex]
    ) -> LexicalIndex:
        with self._lock:
            index = self._fits.get(key)
            if index is not None:
                self._fits.move_to_end(key)
                return index
            flight = self._flights.get(key)
            owner = flight is None
            if flight is None:
                flight = Future()
                self._flights[key] = flight
        if not owner:
            return flight.result()
        try:
            index = fit()
        except BaseException as exc:
            with self._lock:
                self._flights.pop(key, None)
            flight.set_exception(exc)
            raise
        with self._lock:
            self._fits[key] = index
            if len(self._fits) > self._limit:
                self._fits.popitem(last=False)
            self._flights.pop(key, None)
        flight.set_result(index)
        return index


class LanguageLexicalIndex(LexicalIndex):
    """Fit TF-IDF only on English and the selected translation languages.

    A post-scoring row filter leaves disabled names in the document-frequency
    calculation. Separate fitting corpora make an English baseline invariant
    to ambient translations. The complete corpus is built at load; a bounded
    LRU retains the most recently requested subsets. Building a subset never
    mutates the complete corpus or a concurrently used subset.
    """

    _MAX_CACHED_INDEXES = 4

    def __init__(
        self,
        ontology: Ontology,
        languages: Iterable[str] = (),
        cache_dir: Path | None = None,
    ) -> None:
        super().__init__(
            ontology, languages=sorted(set(languages)), cache_dir=cache_dir
        )
        self._subset_indexes: OrderedDict[tuple[str, ...], LexicalIndex] = OrderedDict()
        self._subset_lock = threading.RLock()
        # Fits shared by the pinned views of this build (see ``pinned_view``),
        # and, on such a view, the shared fits it draws from.
        self._view_fits = _SubsetFits(self._MAX_CACHED_INDEXES)
        self._shared_fits: _SubsetFits | None = None

    def with_ontology(self, ontology: Ontology) -> LanguageLexicalIndex:
        """Bind fitted data to isolated terms, with a separate subset LRU.

        Matrices, vectorizers and string rows are read-only during queries.
        Ambient subsets may have been fitted after term mutation, so they
        cannot establish the captured fitting corpus. Start with an empty LRU;
        subset misses fit against the supplied ontology and cannot populate or
        evict another view's cache.
        """
        with self._subset_lock:
            view = copy.copy(self)
            view.ontology = ontology
            view.languages = list(self.languages)
            view._subset_lock = threading.RLock()
            view._subset_indexes = OrderedDict()
            view._view_fits = _SubsetFits(self._MAX_CACHED_INDEXES)
            view._shared_fits = None
        return view

    def pinned_view(self, ontology: Ontology) -> LanguageLexicalIndex:
        """Like :meth:`with_ontology`, sharing subset fits with sibling views.

        For pinned views whose terms carry exactly the names of this build.
        A subset is fitted against the terms of the first view that needs it,
        never against this index's own terms, whose subsets stay in their own
        cache; the other views reuse that fit bound to their own terms.
        """
        view = self.with_ontology(ontology)
        view._shared_fits = self._view_fits
        return view

    def build(self) -> None:
        with self._subset_lock:
            super().build()
            self._subset_indexes.clear()
            self._view_fits = _SubsetFits(self._MAX_CACHED_INDEXES)

    def search(
        self,
        query: str,
        k: int,
        languages: Collection[str] | None = None,
    ) -> list[dict[str, Any]]:
        if not self.ready:
            raise LexicalIndexError("the lexical index is not built")
        allowed = tuple(
            self.languages
            if languages is None
            else sorted(set(languages) & set(self.languages))
        )
        if allowed == tuple(self.languages):
            return super().search(query, k)
        with self._subset_lock:
            index = self._subset_indexes.get(allowed)
            if index is None:
                index = self._fit_subset(allowed)
                self._subset_indexes[allowed] = index
                if len(self._subset_indexes) > self._MAX_CACHED_INDEXES:
                    self._subset_indexes.popitem(last=False)
            else:
                self._subset_indexes.move_to_end(allowed)
        # The local reference stays alive if another request evicts its cache
        # entry. Querying does not change the fitted matrix/vectorizer.
        return index.search(query, k)

    def _fit_subset(self, languages: tuple[str, ...]) -> LexicalIndex:
        """A subset fitted on these terms, or a sibling view's fit bound to them."""

        def fit() -> LexicalIndex:
            index = LexicalIndex(self.ontology, languages=languages)
            index.build()
            return index

        if self._shared_fits is None:
            return fit()
        bound = copy.copy(self._shared_fits.get(languages, fit))
        bound.ontology = self.ontology
        return bound
