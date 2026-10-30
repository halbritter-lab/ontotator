"""High-level service coordinating HPO ontology loading, search, and validation."""

from __future__ import annotations

import copy
import dataclasses
import gc
import hashlib
import logging
import re
from collections.abc import Callable, Iterable, Sequence
from pathlib import Path
from typing import Any, Literal

from ontotator.domain.canonical import canonical_hash
from ontotator.domain.documents import OntologyRef
from ontotator.domain.errors import DomainError
from ontotator.ontology.conditions import (
    IndexConfiguration,
    SearchCondition,
    SearchExecution,
    TranslationResource,
    current_runtime,
)
from ontotator.ontology.modifiers import subtree
from ontotator.ontology.provenance import (
    HierarchyWarning,
    SearchCandidate,
    SearchRequest,
    SearchResult,
    TermStatus,
)
from ontotator.ontology.translations import (
    FrozenTranslations,
    LanguageLexicalIndex,
    LoadedTranslation,
    SkippedTranslation,
    TranslatedNames,
    apply_translations,
    freeze_translations,
    translation_counts,
)
from ontotator.vendor.hpo_span_annotator.hpo import Ontology, Term
from ontotator.vendor.hpo_span_annotator.hpo import (
    load as load_ontology,
)
from ontotator.vendor.hpo_span_annotator.search import (
    SCORED_PATHS,
    SearchEngine,
    ordered_then_shuffled,
    shuffle_seed,
)

logger = logging.getLogger(__name__)

# Digits alone, PREFIX:digits or PREFIX_digits. Anything else is a keyword.
_CODE_QUERY = re.compile(r"^(?:\d+|[A-Za-z][A-Za-z0-9]*[:_]\d+)$")
_SPACED_CODE = re.compile(r"^([A-Za-z][A-Za-z0-9]*) \d+$")


def looks_like_code(query: str, prefix: str | None = None) -> bool:
    """Whether the single search treats this query as a term id.

    `PREFIX digits` with a space counts only for the ontology's own `prefix`:
    "HP 1250" is an id, "trisomy 21" stays a keyword.
    """
    raw = (query or "").strip()
    if _CODE_QUERY.match(raw):
        return True
    spaced = _SPACED_CODE.match(raw)
    return bool(spaced and prefix and spaced.group(1).casefold() == prefix.casefold())


class OntologyService:
    """Provides validated term lookups, model-free / lexical searches."""

    def __init__(
        self,
        ontology: Ontology,
        engine: SearchEngine,
        ref: OntologyRef,
        translations: Sequence[LoadedTranslation] = (),
        skipped_translations: Sequence[SkippedTranslation] = (),
        *,
        translated: TranslatedNames | None = None,
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
        self._translated = (
            translated if translated is not None else TranslatedNames(ontology)
        )
        # The translated names as :meth:`_build` left them, for pinned views.
        # None for a service assembled any other way.
        self._built_translations: FrozenTranslations | None = None
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
            "schema_version": "ontotator-search-condition/v1",
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
        service = cls(
            ontology=ontology,
            engine=engine,
            ref=ref,
            translations=loaded,
            skipped_translations=skipped,
        )
        service._built_translations = freeze_translations(ontology)
        return service

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
        return self._isolated_copy({})

    def _isolated_copy(self, translations: FrozenTranslations) -> Ontology:
        """The terms in containers of their own, carrying ``translations``.

        What a deep copy gives, without its cost: every term and every list or
        dict of the ontology is new; strings and tuples are immutable and
        shared. The name index ``_exact`` holds only such values. A lookup map
        from keys to terms points at the copied terms.

        The copy creates a few hundred thousand containers and nothing cyclic,
        so the cyclic collector is paused meanwhile: its passes over the
        whole heap would cost more than the copy itself.
        """
        enabled = gc.isenabled()
        gc.disable()
        try:
            return self._copy_terms(translations)
        finally:
            if enabled:
                gc.enable()

    def _copy_terms(self, translations: FrozenTranslations) -> Ontology:
        source = self.ontology
        fields = [field.name for field in dataclasses.fields(Term)]
        terms: dict[str, Term] = {}
        copied: dict[int, Term] = {}
        for term_id, term in source.terms.items():
            values = {name: getattr(term, name) for name in fields}
            for name, value in values.items():
                if isinstance(value, list):
                    values[name] = list(value)
            names = translations.get(term_id, {})
            values["translations"] = {code: list(v) for code, v in names.items()}
            clone = Term(**values)
            terms[term_id] = clone
            copied[id(term)] = clone
        ontology = copy.copy(source)
        for name, value in vars(source).items():
            if name == "terms":
                ontology.terms = terms
            elif isinstance(value, dict):
                setattr(
                    ontology,
                    name,
                    {
                        key: copied[id(item)]
                        if isinstance(item, Term)
                        else list(item)
                        if isinstance(item, list)
                        else item
                        for key, item in value.items()
                    },
                )
            elif isinstance(value, (list, set)):
                setattr(ontology, name, type(value)(value))
        return ontology

    def pinned_view(self, translation_paths: Iterable[Path]) -> OntologyService:
        """Restore captured names and reuse the identical corpus's fitted data.

        Resource equality is checked by the registry before calling this: the
        captured files are the files this service was built with. Terms and
        their lookup references are isolated; expensive lexical fits are
        shared through views bound to this snapshot. Selected-language subsets
        fit against captured terms, once for all views of this build.

        A service built by :meth:`_build` kept its names as the files left
        them, so the files are not parsed again; any other service re-applies
        them to a copy.
        """
        lexical = self.engine.lexical
        if not isinstance(lexical, LanguageLexicalIndex):
            raise TypeError("Pinned views require a language lexical index")
        if self._built_translations is not None:
            ontology = self._isolated_copy(self._built_translations)
            return OntologyService(
                ontology,
                SearchEngine(ontology, lexical.pinned_view(ontology)),
                self.ref,
                translations=self.translations,
                translated=self._translated.with_ontology(ontology),
            )
        ontology = self._untranslated_snapshot()
        loaded, skipped = apply_translations(ontology, translation_paths)
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

    def _searched_languages(
        self, request: SearchRequest, languages: Sequence[str]
    ) -> list[str]:
        """The languages whose names this search actually looked at.

        A term id and the tree are not searches over names, so they report
        none. The explicit exact route knows English names only.
        """
        if request.route in ("id", "browse"):
            return []
        if request.route == "auto" and looks_like_code(
            request.query, self.ontology.dominant_prefix
        ):
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
        if languages:
            raw = f"{seed}|{','.join(sorted(languages))}"
            seed = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]
        if request.within is not None:
            # A restricted search is another question; unrestricted seeds stay.
            raw = f"{seed}|within:{','.join(sorted(request.within))}"
            seed = hashlib.sha256(raw.encode()).hexdigest()[:16]
        return seed

    def _allowed(self, request: SearchRequest) -> frozenset[str] | None:
        """The terms a ``within`` search may return; None when unrestricted."""
        if request.within is None:
            return None
        return frozenset().union(*(subtree(self, root) for root in request.within))

    def _widened(
        self,
        fetch: Callable[[int], list[dict[str, Any]]],
        depth: int,
        need: int,
        keep: Callable[[dict[str, Any]], bool],
        widen: bool,
    ) -> list[dict[str, Any]]:
        """The first ``need`` kept hits; with ``widen`` the fetch depth grows
        (k x 10, then all) until enough survive or the ranking is exhausted."""
        total = len(self.ontology)
        while True:
            fetched = fetch(depth)
            kept = [hit for hit in fetched if keep(hit)]
            if not widen or len(kept) >= need or len(fetched) < depth or depth >= total:
                return kept[:need]
            depth = depth * 10 if depth < need * 10 else total

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
        allowed = self._allowed(request)
        hits: list[dict[str, Any]]
        if allowed is not None and request.route == "browse":
            # A restricted walk starts at its roots.
            hits = [
                {**term.as_dict(), "matched_term": term.label, "match_kind": "browse"}
                for root in request.within or []
                if (term := self.ontology.get(root)) is not None
            ][: request.k]
            for position, hit in enumerate(hits, start=1):
                hit["rank"] = hit["display_pos"] = position
            was_shuffled = False
        elif (
            seed is not None
            and query
            and isinstance(lexical, LanguageLexicalIndex)
            and lexical.ready
        ):
            hits = ordered_then_shuffled(
                self._widened(
                    lambda depth: lexical.search(query, depth, languages=languages),
                    request.k,
                    request.k,
                    lambda hit: allowed is None or hit["hpo_id"] in allowed,
                    allowed is not None,
                ),
                seed,
            )
            was_shuffled = True
        else:
            raw_result = self.engine.search(
                query=request.query,
                path=request.route,
                # Restricted: filter the whole answer before the cut.
                k=request.k if allowed is None else len(self.ontology),
                seed=seed,
            )
            hits = raw_result["hits"]
            if allowed is not None:
                hits = [h for h in hits if h["hpo_id"] in allowed][: request.k]
                # Renumber so the kept hits read 1..n, not their unfiltered slots.
                for rank, hit in enumerate(
                    sorted(hits, key=lambda h: h.get("rank", 0)), 1
                ):
                    hit["rank"] = rank
                for position, hit in enumerate(hits, start=1):
                    hit["display_pos"] = position
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

        allowed = self._allowed(request)
        if looks_like_code(query, self.ontology.dominant_prefix):
            # A typed id is a statement, not a question: that term or nothing.
            hits: list[dict[str, Any]] = [
                hit
                for hit in self.engine.search(query=query, path="id", k=request.k)[
                    "hits"
                ]
                if allowed is None or hit["hpo_id"] in allowed
            ]
            for hit in hits:
                hit["route"] = "id"
            return hits, False, None

        # Exact name matches first, in their fixed order: that a name equals the
        # query is a fact about the query, not a score. No prefix fallback here;
        # a partial word is what the similar block is for.
        if allowed is None:
            exact = self.ontology.exact(query, limit=request.k)
        else:
            exact = [
                hit
                for hit in self.ontology.exact(query, limit=len(self.ontology))
                if hit["hpo_id"] in allowed
            ][: request.k]
        taken = {hit["hpo_id"] for hit in exact}
        # Then the translated names of the active languages. A term that an
        # English name already matched is not listed twice.
        for hit in self._translated.exact(query, languages):
            if len(exact) >= request.k:
                break
            if hit["hpo_id"] not in taken and (
                allowed is None or hit["hpo_id"] in allowed
            ):
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
            ranked = self._widened(
                lambda depth: self._similar(query, depth, languages),
                request.k + len(exact),
                remaining,
                lambda hit: (
                    hit["hpo_id"] not in taken
                    and (allowed is None or hit["hpo_id"] in allowed)
                ),
                allowed is not None,
            )
            # Shuffled because this order is a score; names holding all the
            # query words first, in fixed order (#190). Ranks continue after
            # the exact block so one event describes the whole list.
            similar = ordered_then_shuffled(ranked, seed)
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
