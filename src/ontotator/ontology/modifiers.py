"""Which terms of an HPO ontology are clinical modifiers (modifiers spec M2, R10, R12).

A per-ontology classifier built from the Clinical modifier, Frequency,
Severity and Onset subtrees, cached per ontology sha256. It serves editing
validation, search (``within``, ``role``), submit rules and grouping.
"""

from __future__ import annotations

import threading
from collections import deque
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal, Protocol

from ontotator.domain.errors import DomainError
from ontotator.domain.profiles import TaskProfile

if TYPE_CHECKING:
    from ontotator.ontology.service import OntologyService

CLINICAL_MODIFIER = "HP:0012823"
FREQUENCY = "HP:0040279"
SEVERITY = "HP:0012824"
ONSET = "HP:0003674"
# The roots "+ Add modifier…" searches ``within``.
MODIFIER_ROOTS: tuple[str, ...] = (CLINICAL_MODIFIER, FREQUENCY)
ModifierKind = Literal["modifier", "cohort"]
ExclusiveClass = Literal["severity", "onset"]
TermRole = Literal["finding", "modifier", "cohort"]


@dataclass(frozen=True)
class ModifierClassifier:
    clinical: frozenset[str]  # HP:0012823 subtree, root included
    cohort: frozenset[str]  # HP:0040279 subtree, root included
    severity: frozenset[str]
    onset: frozenset[str]

    def kind(self, term_id: str) -> ModifierKind | None:
        if term_id in self.cohort:
            return "cohort"
        if term_id in self.clinical:
            return "modifier"
        return None

    def exclusive_class(self, term_id: str) -> ExclusiveClass | None:
        if term_id in self.severity:
            return "severity"
        if term_id in self.onset:
            return "onset"
        return None

    def role(self, term_id: str) -> TermRole:
        return self.kind(term_id) or "finding"


NO_MODIFIERS = ModifierClassifier(frozenset(), frozenset(), frozenset(), frozenset())

_lock = threading.Lock()
_subtrees: dict[tuple[str, str], frozenset[str]] = {}
_classifiers: dict[str, ModifierClassifier] = {}


def subtree(service: OntologyService, root: str) -> frozenset[str]:
    """``root`` and its descendants; empty for a root the ontology lacks."""
    key = (service.ref.sha256, root)
    with _lock:
        cached = _subtrees.get(key)
    if cached is not None:
        return cached
    ontology = service.ontology
    term = ontology.get(root)
    found: set[str] = set()
    if term is not None:
        queue = deque([term.hpo_id])
        while queue:
            current = queue.popleft()
            if current in found:
                continue
            found.add(current)
            queue.extend(ontology.children_of(current))
    result = frozenset(found)
    if (
        term is not None
    ):  # unknown roots stay uncached so arbitrary ids cannot grow the cache
        with _lock:
            _subtrees[key] = result
    return result


def classifier_of(service: OntologyService) -> ModifierClassifier:
    sha = service.ref.sha256
    with _lock:
        cached = _classifiers.get(sha)
    if cached is not None:
        return cached
    built = ModifierClassifier(
        clinical=subtree(service, CLINICAL_MODIFIER),
        cohort=subtree(service, FREQUENCY),
        severity=subtree(service, SEVERITY),
        onset=subtree(service, ONSET),
    )
    with _lock:
        return _classifiers.setdefault(sha, built)


class TermRoles:
    """Classifiers of a project's layers whose pin has the T1 profile hpo-phenotype."""

    def __init__(self, by_layer: Mapping[str, ModifierClassifier]) -> None:
        self._by_layer = dict(by_layer)

    def supports(self, layer_id: str) -> bool:
        return layer_id in self._by_layer

    def classifier(self, layer_id: str) -> ModifierClassifier:
        return self._by_layer.get(layer_id, NO_MODIFIERS)

    def kind(self, layer_id: str, term_id: str) -> ModifierKind | None:
        return self.classifier(layer_id).kind(term_id)

    def exclusive_class(self, layer_id: str, term_id: str) -> ExclusiveClass | None:
        return self.classifier(layer_id).exclusive_class(term_id)

    def role(self, layer_id: str, term_id: str) -> TermRole:
        return self.classifier(layer_id).role(term_id)


NO_TERM_ROLES = TermRoles({})


class _PinLike(Protocol):
    @property
    def sha256(self) -> str: ...

    @property
    def t1_profile(self) -> str: ...


ServiceSource = Callable[[str], "OntologyService | None"]
_source: ServiceSource | None = None


def install_service_source(source: ServiceSource | None) -> None:
    """The process-wide lookup of a service by sha256 (D-a); ``None`` resets it."""
    global _source
    _source = source


def modifier_layers(profile: TaskProfile, pins: Mapping[str, _PinLike]) -> list[str]:
    """The layers whose ontology pin has the T1 profile ``hpo-phenotype``."""
    return [
        layer.layer_id
        for layer in profile.layers
        if (pin := pins.get(layer.ontology_id)) is not None
        and pin.t1_profile == "hpo-phenotype"
    ]


def term_roles(profile: TaskProfile, pins: Mapping[str, _PinLike]) -> TermRoles:
    """Roles of every ``hpo-phenotype`` layer, loaded through the installed source."""
    by_layer: dict[str, ModifierClassifier] = {}
    ontology_of = {layer.layer_id: layer.ontology_id for layer in profile.layers}
    for layer_id in modifier_layers(profile, pins):
        sha = pins[ontology_of[layer_id]].sha256
        service = _source(sha) if _source is not None else None
        if service is None:
            raise DomainError("ONTOLOGY_NOT_FOUND", {"sha256": sha})
        by_layer[layer_id] = classifier_of(service)
    return TermRoles(by_layer)


def term_roles_for_services(
    profile: TaskProfile,
    pins: Mapping[str, _PinLike],
    services: Mapping[str, OntologyService],
) -> TermRoles:
    """Roles from already resolved per-layer services (editing)."""
    return TermRoles(
        {
            layer_id: classifier_of(services[layer_id])
            for layer_id in modifier_layers(profile, pins)
            if layer_id in services
        }
    )
