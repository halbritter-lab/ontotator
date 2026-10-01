"""High-level service coordinating HPO ontology loading, search, and validation."""

from __future__ import annotations

import hashlib
from collections.abc import Iterable
from pathlib import Path
from typing import Literal

from hpo_editor.domain.documents import OntologyRef
from hpo_editor.domain.errors import DomainError
from hpo_editor.ontology.provenance import (
    HierarchyWarning,
    SearchCandidate,
    SearchRequest,
    SearchResult,
    TermStatus,
)
from hpo_editor.vendor.hpo_span_annotator.hpo import (
    Ontology,
    load_translations,
)
from hpo_editor.vendor.hpo_span_annotator.hpo import (
    load as load_ontology,
)
from hpo_editor.vendor.hpo_span_annotator.lexical import LexicalIndex
from hpo_editor.vendor.hpo_span_annotator.search import (
    SCORED_PATHS,
    SearchEngine,
    shuffle_seed,
)


class OntologyService:
    """Provides validated term lookups, model-free / lexical searches."""

    def __init__(
        self,
        ontology: Ontology,
        engine: SearchEngine,
        ref: OntologyRef,
    ) -> None:
        self.ontology = ontology
        self.engine = engine
        self.ref = ref

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

        ontology = load_ontology(path)
        if translation_paths:
            load_translations(ontology, [Path(p) for p in translation_paths])

        lexical = LexicalIndex(ontology)
        lexical.build()
        engine = SearchEngine(ontology=ontology, lexical=lexical)
        return cls(ontology=ontology, engine=engine, ref=expected)

    def validate_term(self, hpo_id: str) -> TermStatus:
        term = self.ontology.get(hpo_id)
        if term is None:
            return TermStatus(
                hpo_id=hpo_id,
                status="unknown",
                label=None,
                definition=None,
                synonyms=[],
            )

        status_type: Literal["valid", "obsolete", "unknown"] = (
            "obsolete" if term.obsolete else "valid"
        )
        return TermStatus(
            hpo_id=term.hpo_id,
            status=status_type,
            label=term.label,
            definition=term.definition or None,
            synonyms=[s for _, s in term.synonyms],
        )

    def search(self, request: SearchRequest) -> SearchResult:
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

        candidates = [
            SearchCandidate(
                hpo_id=hit["hpo_id"],
                label=hit["label"],
                definition=hit.get("definition", ""),
                matched_term=hit.get("matched_term", ""),
                match_kind=hit.get("match_kind", ""),
                rank=hit.get("rank", 0),
                display_pos=hit.get("display_pos", 0),
                score=hit.get("score"),
            )
            for hit in raw_result["hits"]
        ]

        displayed_ids = [c.hpo_id for c in candidates]
        ranked_ids = [c.hpo_id for c in sorted(candidates, key=lambda c: c.rank)]

        return SearchResult(
            route=request.route,
            query=request.query,
            candidates=candidates,
            displayed_ids=displayed_ids,
            ranked_ids=ranked_ids,
            shuffled=raw_result.get("shuffled", False),
            seed=seed,
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
        unique_ids = list(
            dict.fromkeys((i or "").strip().upper() for i in ids if i)
        )
        ancestor_map = {
            hpo_id: self.all_ancestors_of(hpo_id) for hpo_id in unique_ids
        }

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
