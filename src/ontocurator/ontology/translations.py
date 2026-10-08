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
        try:
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            counts = load_translations(ontology, [path])
        except (OntologyError, OSError, UnicodeDecodeError, csv.Error) as exc:
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
