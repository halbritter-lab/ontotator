"""Deterministic, language-aware assignment proposals without side effects."""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from random import Random

from ontotator.assignments.eligibility import reads_all


@dataclass(frozen=True)
class Candidate:
    user_id: int
    username: str
    languages: frozenset[str]
    load: int


@dataclass(frozen=True)
class DocumentItem:
    document_id: str
    language: str
    excluded_user_ids: frozenset[int]


@dataclass(frozen=True)
class Unassignable:
    document_id: str
    reason: str
    eligible_count: int


@dataclass(frozen=True)
class DistributionProposal:
    rows: tuple[tuple[str, int], ...]
    unassignable: tuple[Unassignable, ...]
    seed: int
    per_document: int


def propose_distribution(
    documents: Sequence[DocumentItem],
    candidates: Sequence[Candidate],
    *,
    per_document: int,
    seed: int,
    required_languages: Callable[[DocumentItem], frozenset[str]] = lambda d: frozenset(
        {d.language}
    ),
) -> DistributionProposal:
    """Plan complete document allocations using caller-provided active loads.

    Candidate order is normalized by ID; document order intentionally controls
    the random stream and the order of the returned rows. Inputs stay unchanged.
    """
    if per_document < 1:
        raise ValueError("per_document must be at least 1")
    if len({c.user_id for c in candidates}) != len(candidates):
        raise ValueError("candidate user_id values must be unique")
    if len({d.document_id for d in documents}) != len(documents):
        raise ValueError("document document_id values must be unique")
    if any(c.load < 0 for c in candidates):
        raise ValueError("candidate load must be nonnegative")

    ordered_candidates = sorted(candidates, key=lambda c: c.user_id)
    loads = {c.user_id: c.load for c in candidates}
    rng = Random(seed)
    rows: list[tuple[str, int]] = []
    unassignable: list[Unassignable] = []
    for document in documents:
        languages = required_languages(document)
        tie_breaks = {c.user_id: rng.random() for c in ordered_candidates}
        eligible = [
            c
            for c in ordered_candidates
            if reads_all(c.languages, languages)
            and c.user_id not in document.excluded_user_ids
        ]
        if len(eligible) < per_document:
            unassignable.append(
                Unassignable(
                    document.document_id,
                    "NO_READER" if not eligible else "TOO_FEW_READERS",
                    len(eligible),
                )
            )
            continue
        picked = sorted(
            eligible,
            key=lambda c: (loads[c.user_id], tie_breaks[c.user_id], c.user_id),
        )[:per_document]
        for selected in picked:
            rows.append((document.document_id, selected.user_id))
            loads[selected.user_id] += 1

    return DistributionProposal(tuple(rows), tuple(unassignable), seed, per_document)
