"""High-level service coordinating HPO ontology loading, search, and validation."""

from __future__ import annotations

import copy
import hashlib
import logging
import re
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any, Literal

from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.documents import OntologyRef
from ontocurator.domain.errors import DomainError
from ontocurator.ontology.conditions import (
    IndexConfiguration,
    SearchCondition,
    SearchExecution,
    TranslationResource,
    current_runtime,
)
from ontocurator.ontology.provenance import (
    HierarchyWarning,
    SearchCandidate,
    SearchRequest,
    SearchResult,
    TermStatus,
)
from ontocurator.ontology.translations import (
    LanguageLexicalIndex,
    LoadedTranslation,
    SkippedTranslation,
    TranslatedNames,
    apply_translations,
    translation_counts,
)
from ontocurator.vendor.hpo_span_annotator.hpo import Ontology
from ontocurator.vendor.hpo_span_annotator.hpo import (
    load as load_ontology,
)
from ontocurator.vendor.hpo_span_annotator.search import (
    SCORED_PATHS,
    SearchEngine,
    shuffle_seed,
    shuffled,
)

logger = logging.getLogger(__name__)

# Digits alone, PREFIX:digits or PREFIX_digits. Anything else is a keyword.
_CODE_QUERY = re.compile(r"^(?:\d+|[A-Za-z][A-Za-z0-9]*[:_]\d+)$")


def looks_like_code(query: str) -> bool:
    """Whether the single search treats this query as a term id."""
    return bool(_CODE_QUERY.match((query or "").strip()))


class OntologyService:
    """Provides validated term lookups, model-free / lexical searches."""

    def __init__(
        self,
        ontology: Ontology,
        engine: SearchEngine,
        ref: OntologyRef,
        translations: Sequence[LoadedTranslation] = (),
        skipped_translations: Sequence[SkippedTranslation] = (),
    ) -> None:
        self.ontology = ontology
        self.engine = engine
        self.ref = ref
        # The translation files whose names are in the index, and the files
        # that belong to this ontology but could not be used.
        self.translations = list(translations)
        self.skipped_translations = list(skipped_translations)
        # Language -> number of terms with a name in it. English is not listed:
        # it is the ontology itself and always searched.
        self.translation_counts = translation_counts(ontology)
        self.languages = list(self.translation_counts)
        self._translated = TranslatedNames(ontology)
        self.search_condition: SearchCondition | None = None
        self.index_identity = self.identity_for_languages(["en", *self.languages])

    def identity_for_languages(self, languages: Sequence[str]) -> str:
        """Identity of the actual selected fitting corpus and execution code."""
        selected = set(languages) - {"en"}
        return canonical_hash(
            {
                "ontology_sha256": self.ref.sha256,
                "index": IndexConfiguration().model_dump(),
                "runtime": current_runtime().model_dump(),
                "fitting_languages": list(languages),
                "translations": [
                    {"filename": item.filename, "sha256": item.sha256}
                    for item in self.translations
                    if selected.intersection(item.languages)
                ],
            }
        )

    def capture_condition(self) -> SearchCondition:
        payload = {
            "schema_version": "ontocurator-search-condition/v1",
            "ontology_sha256": self.ref.sha256.lower(),
            "translations": [
                TranslationResource(
                    filename=item.filename,
                    sha256=item.sha256,
                    resource_path=f"search-resources/{item.sha256}/{item.filename}",
                    languages=list(item.languages),
                ).model_dump()
                for item in self.translations
            ],
            "index": IndexConfiguration().model_dump(),
            "runtime": current_runtime().model_dump(),
        }
        return SearchCondition.model_validate(
            {"condition_id": canonical_hash(payload), **payload}
        )

    def execution(
        self, languages: Sequence[str], k: int | None = None
    ) -> SearchExecution:
        return SearchExecution(
            runtime=current_runtime(), fitting_languages=list(languages), k=k
        )

    def runtime_drift(self) -> bool | None:
        if self.search_condition is None:
            return None
        return (
            self.search_condition.runtime != current_runtime()
            or self.search_condition.index != IndexConfiguration()
        )

    @classmethod
    def load(
        cls,
        path: Path | str,
        expected: OntologyRef,
        translation_paths: Iterable[Path | str] = (),
    ) -> OntologyService:
        path = Path(path)
        if not path.is_file():
            raise DomainError(
                "ONTOLOGY_NOT_FOUND",
                f"Ontology file not found at {path}",
            )

        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if digest.lower() != expected.sha256.lower():
            raise DomainError(
                "ONTOLOGY_HASH_MISMATCH",
                f"Ontology hash mismatch for {path}: "
                f"expected {expected.sha256}, got {digest}",
            )

        return cls._build(load_ontology(path), expected, translation_paths)

    @classmethod
    def _build(
        cls,
        ontology: Ontology,
        ref: OntologyRef,
        translation_paths: Iterable[Path | str],
    ) -> OntologyService:
        """Index a parsed ontology together with its translation files.

        ``translation_paths`` may hold files of other ontologies; only those
        whose name carries this ontology's prefix are used.
        """
        loaded, skipped = apply_translations(
            ontology, [Path(p) for p in translation_paths]
        )
        for problem in skipped:
            logger.warning(
                "Skipping translation file %s: %s", problem.filename, problem.reason
            )
        languages = sorted({code for item in loaded for code in item.languages})
        lexical = LanguageLexicalIndex(ontology, languages=languages)
        lexical.build()
        engine = SearchEngine(ontology=ontology, lexical=lexical)
        return cls(
            ontology=ontology,
            engine=engine,
            ref=ref,
            translations=loaded,
            skipped_translations=skipped,
        )

    def with_translations(
        self, translation_paths: Iterable[Path | str]
    ) -> OntologyService:
        """A new service over the same terms with exactly these translation files.

        The terms are copied without their translated names, so a file that was
        replaced or removed leaves nothing behind. This service is not touched
        and keeps answering until the caller swaps the new one in.
        """
        ontology = self._untranslated_snapshot()
        return self._build(ontology, self.ref, translation_paths)

    def _untranslated_snapshot(self) -> Ontology:
        ontology = copy.deepcopy(self.ontology)
        for term in ontology.terms.values():
            term.translations = {}
        return ontology

    def pinned_view(self, translation_paths: Iterable[Path]) -> OntologyService:
        """Restore captured names and reuse the identical corpus's fitted data.

        Resource equality is checked by the registry before calling this. Terms
        and their lookup references are isolated; expensive lexical fits are
        shared through views bound to this snapshot, including cached subsets.
        """
        ontology = self._untranslated_snapshot()
        loaded, skipped = apply_translations(ontology, translation_paths)
        lexical = self.engine.lexical
        if not isinstance(lexical, LanguageLexicalIndex):
            raise TypeError("Pinned views require a language lexical index")
        return OntologyService(
            ontology,
            SearchEngine(ontology, lexical.with_ontology(ontology)),
            self.ref,
            translations=loaded,
            skipped_translations=skipped,
        )

    def active_languages(self, requested: Sequence[str] | None) -> list[str]:
        """The loaded translation languages a search looks at.

        ``None`` means all of them. Codes that are not loaded are ignored.
        """
        if requested is None:
            return list(self.languages)
        wanted = {code.strip().lower() for code in requested}
        return [code for code in self.languages if code in wanted]

    def validate_term(self, hpo_id: str) -> TermStatus:
        term = self.ontology.get(hpo_id)
        if term is None:
            return TermStatus(
                term_id=hpo_id,
                status="unknown",
                label=None,
                definition=None,
                synonyms=[],
            )

        status_type: Literal["valid", "obsolete", "unknown"] = (
            "obsolete" if term.obsolete else "valid"
        )
        return TermStatus(
            term_id=term.hpo_id,
            status=status_type,
            label=term.label,
            definition=term.definition or None,
            synonyms=[s for _, s in term.synonyms],
            alt_ids=list(term.alt_ids),
            replaced_by=term.replaced_by,
            consider=list(term.consider),
        )

    def search(self, request: SearchRequest) -> SearchResult:
        languages = self.active_languages(request.languages)
        if request.route == "auto":
            hits, was_shuffled, seed = self._auto_hits(request, languages)
        else:
            hits, was_shuffled, seed = self._route_hits(request, languages)

        candidates = [self._candidate(hit) for hit in hits]
        displayed_ids = [c.hpo_id for c in candidates]
        ranked_ids = [c.hpo_id for c in sorted(candidates, key=lambda c: c.rank)]
        searched_languages = self._searched_languages(request, languages)

        return SearchResult(
            route=request.route,
            query=request.query,
            candidates=candidates,
            displayed_ids=displayed_ids,
            ranked_ids=ranked_ids,
            shuffled=was_shuffled,
            seed=seed,
            layer_id=request.layer_id,
            ontology_sha256=self.ref.sha256,
            index_identity=self.identity_for_languages(searched_languages),
            languages=searched_languages,
            search_condition_id=self.search_condition.condition_id
            if self.search_condition
            else None,
            execution=self.execution(searched_languages, request.k)
            if self.search_condition
            else None,
            runtime_drift=self.runtime_drift(),
        )

    @staticmethod
    def _searched_languages(
        request: SearchRequest, languages: Sequence[str]
    ) -> list[str]:
        """The languages whose names this search actually looked at.

        A term id and the tree are not searches over names, so they report
        none. The explicit exact route knows English names only.
        """
        if request.route in ("id", "browse"):
            return []
        if request.route == "auto" and looks_like_code(request.query):
            return []
        if request.route == "exact":
            return ["en"]
        return ["en", *languages]

    def _seed(self, request: SearchRequest, languages: Sequence[str]) -> str:
        """The permutation key: annotator, annotation, query, depth, languages.

        The same query with another language selection is a new question and
        may be shuffled anew. Without an active translation language the key is
        the one the search had before translations existed.
        """
        seed = shuffle_seed(
            annotator_id=request.workspace_key.annotator_id,
            mention_id=request.annotation_id,
            query=request.query,
            k=request.k,
        )
        if not languages:
            return seed
        raw = f"{seed}|{','.join(sorted(languages))}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]

    def _similar(
        self, query: str, k: int, languages: Sequence[str]
    ) -> list[dict[str, Any]]:
        """Lexical hits by score, over English and the given languages only."""
        lexical = self.engine.lexical
        if lexical is None or not lexical.ready:
            return []
        if isinstance(lexical, LanguageLexicalIndex):
            return lexical.search(query, k, languages=languages)
        return lexical.search(query, k)

    def _route_hits(
        self, request: SearchRequest, languages: Sequence[str]
    ) -> tuple[list[dict[str, Any]], bool, str | None]:
        """One explicitly named route, as the engine answers it.

        The lexical route is answered here when the index can filter by
        language, so a language the annotator switched off stays off on this
        route too. The explicit exact route knows English names only.
        """
        seed: str | None = None
        if request.route in SCORED_PATHS:
            seed = self._seed(request, languages)
        query = request.query.strip()
        lexical = self.engine.lexical
        hits: list[dict[str, Any]]
        if (
            seed is not None
            and query
            and isinstance(lexical, LanguageLexicalIndex)
            and lexical.ready
        ):
            hits = shuffled(lexical.search(query, request.k, languages=languages), seed)
            was_shuffled = True
        else:
            raw_result = self.engine.search(
                query=request.query,
                path=request.route,
                k=request.k,
                seed=seed,
            )
            hits = raw_result["hits"]
            was_shuffled = bool(raw_result.get("shuffled", False))
        for hit in hits:
            hit["route"] = request.route
        return hits, was_shuffled, seed

    def _auto_hits(
        self, request: SearchRequest, languages: Sequence[str]
    ) -> tuple[list[dict[str, Any]], bool, str | None]:
        """The single search: a code finds its term, a keyword finds candidates."""
        query = request.query.strip()
        if not query:
            return [], False, None

        if looks_like_code(query):
            # A typed id is a statement, not a question: that term or nothing.
            hits: list[dict[str, Any]] = self.engine.search(
                query=query, path="id", k=request.k
            )["hits"]
            for hit in hits:
                hit["route"] = "id"
            return hits, False, None

        # Exact name matches first, in their fixed order: that a name equals the
        # query is a fact about the query, not a score. No prefix fallback here;
        # a partial word is what the similar block is for.
        exact = self.ontology.exact(query, limit=request.k)
        taken = {hit["hpo_id"] for hit in exact}
        # Then the translated names of the active languages. A term that an
        # English name already matched is not listed twice.
        for hit in self._translated.exact(query, languages):
            if len(exact) >= request.k:
                break
            if hit["hpo_id"] not in taken:
                taken.add(hit["hpo_id"])
                exact.append(hit)
        for position, hit in enumerate(exact, start=1):
            hit["route"] = "exact"
            hit["rank"] = position
            hit["display_pos"] = position

        seed = self._seed(request, languages)

        similar: list[dict[str, Any]] = []
        remaining = request.k - len(exact)
        if remaining > 0:
            ranked = [
                hit
                for hit in self._similar(query, request.k + len(exact), languages)
                if hit["hpo_id"] not in taken
            ][:remaining]
            # Shuffled because this order is a score. Ranks continue after the
            # exact block so one event describes the whole list.
            similar = shuffled(ranked, seed)
            for hit in similar:
                hit["route"] = "lexical"
                hit["match_kind"] = "ngram"
                hit["rank"] += len(exact)
                hit["display_pos"] += len(exact)

        # A seed is reported only when it was used.
        return exact + similar, bool(similar), seed if similar else None

    def _candidate(self, hit: dict[str, Any]) -> SearchCandidate:
        language = hit.get("matched_language")
        return SearchCandidate(
            term_id=hit["hpo_id"],
            label=hit["label"],
            definition=hit.get("definition", ""),
            matched_term=hit.get("matched_term", ""),
            match_kind=hit.get("match_kind", ""),
            rank=hit.get("rank", 0),
            display_pos=hit.get("display_pos", 0),
            score=hit.get("score"),
            obsolete=self.validate_term(hit["hpo_id"]).status == "obsolete",
            route=hit.get("route", ""),
            # "?" is the lexical index's marker for a name it could not place.
            match_language=language if language and language != "?" else None,
        )

    def all_ancestors_of(self, hpo_id: str) -> set[str]:
        """Exhaustive ancestor search traversing parents until the root."""
        term = self.ontology.get(hpo_id)
        if not term:
            return set()

        ancestors: set[str] = set()
        queue = list(term.parents)
        while queue:
            current = queue.pop(0)
            if current in ancestors:
                continue
            ancestors.add(current)
            parent = self.ontology.get(current)
            if parent:
                queue.extend(parent.parents)
        return ancestors

    def hierarchy_warnings(self, ids: list[str]) -> list[HierarchyWarning]:
        """Check all given term IDs against each other for ancestry."""
        unique_ids = list(dict.fromkeys((i or "").strip().upper() for i in ids if i))
        ancestor_map = {hpo_id: self.all_ancestors_of(hpo_id) for hpo_id in unique_ids}

        warnings: list[HierarchyWarning] = []
        for child_id in unique_ids:
            for parent_id in unique_ids:
                if child_id != parent_id and parent_id in ancestor_map[child_id]:
                    parent_label = self.ontology.label_of(parent_id)
                    child_label = self.ontology.label_of(child_id)
                    warnings.append(
                        HierarchyWarning(
                            parent_id=parent_id,
                            child_id=child_id,
                            parent_label=parent_label,
                            child_label=child_label,
                            message=(
                                f"Term {child_id} ({child_label}) is a descendant of "
                                f"{parent_id} ({parent_label})"
                            ),
                        )
                    )
        return warnings
