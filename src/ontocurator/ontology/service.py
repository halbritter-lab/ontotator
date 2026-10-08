"""High-level service coordinating HPO ontology loading, search, and validation."""

from __future__ import annotations

import dataclasses
import hashlib
import logging
import re
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any, Literal

from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.documents import OntologyRef
from ontocurator.domain.errors import DomainError
from ontocurator.ontology.provenance import (
    HierarchyWarning,
    SearchCandidate,
    SearchRequest,
    SearchResult,
    TermStatus,
)
from ontocurator.ontology.translations import (
    LoadedTranslation,
    SkippedTranslation,
    apply_translations,
    translation_counts,
)
from ontocurator.vendor.hpo_span_annotator.hpo import Ontology
from ontocurator.vendor.hpo_span_annotator.hpo import (
    load as load_ontology,
)
from ontocurator.vendor.hpo_span_annotator.lexical import LexicalIndex
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
        identity: dict[str, Any] = {
            "ontology_sha256": ref.sha256,
            "algorithm": "char_wb_tfidf/1",
            "ngram_range": [3, 5],
            "id_normalization": "dominant_prefix_int_v1",
        }
        # Added only when there are translations, so an ontology without them
        # keeps the identity it always had.
        if self.translations:
            identity["translation_sha256"] = sorted(
                item.sha256 for item in self.translations
            )
        self.index_identity = canonical_hash(identity)

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
        lexical = LexicalIndex(ontology, languages=languages)
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
        terms = {
            term_id: dataclasses.replace(term, translations={})
            for term_id, term in self.ontology.terms.items()
        }
        ontology = Ontology(
            terms,
            self.ontology.release,
            dominant_prefix=self.ontology.dominant_prefix,
        )
        return self._build(ontology, self.ref, translation_paths)

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
        if request.route == "auto":
            hits, was_shuffled, seed = self._auto_hits(request)
        else:
            hits, was_shuffled, seed = self._route_hits(request)

        candidates = [self._candidate(hit) for hit in hits]
        displayed_ids = [c.hpo_id for c in candidates]
        ranked_ids = [c.hpo_id for c in sorted(candidates, key=lambda c: c.rank)]

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
            index_identity=self.index_identity,
        )

    def _route_hits(
        self, request: SearchRequest
    ) -> tuple[list[dict[str, Any]], bool, str | None]:
        """One explicitly named route, exactly as the engine answers it."""
        seed: str | None = None
        if request.route in SCORED_PATHS:
            seed = shuffle_seed(
                annotator_id=request.workspace_key.annotator_id,
                mention_id=request.annotation_id,
                query=request.query,
                k=request.k,
            )
        raw_result = self.engine.search(
            query=request.query,
            path=request.route,
            k=request.k,
            seed=seed,
        )
        hits: list[dict[str, Any]] = raw_result["hits"]
        for hit in hits:
            hit["route"] = request.route
        return hits, bool(raw_result.get("shuffled", False)), seed

    def _auto_hits(
        self, request: SearchRequest
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
        for position, hit in enumerate(exact, start=1):
            hit["route"] = "exact"
            hit["rank"] = position
            hit["display_pos"] = position

        seed = shuffle_seed(
            annotator_id=request.workspace_key.annotator_id,
            mention_id=request.annotation_id,
            query=request.query,
            k=request.k,
        )

        similar: list[dict[str, Any]] = []
        remaining = request.k - len(exact)
        lexical = self.engine.lexical
        if remaining > 0 and lexical is not None and lexical.ready:
            taken = {hit["hpo_id"] for hit in exact}
            ranked = [
                hit
                for hit in lexical.search(query, request.k + len(exact))
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
