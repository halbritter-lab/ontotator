"""The per-ontology modifier classifier and term roles (C2)."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from modifier_fixtures import MOD_PATH, MOD_PIN, modifier_profile

from ontocurator.domain.documents import OntologyRef
from ontocurator.domain.errors import DomainError
from ontocurator.exchange.t1 import Pin
from ontocurator.ontology.modifiers import (
    NO_MODIFIERS,
    classifier_of,
    install_service_source,
    subtree,
    term_roles,
    term_roles_for_services,
)
from ontocurator.ontology.service import OntologyService


@pytest.fixture(scope="module")
def service() -> OntologyService:
    return OntologyService.load(
        MOD_PATH, OntologyRef(release="2026-06-23", sha256=MOD_PIN.sha256)
    )


@pytest.fixture
def source(service: OntologyService) -> Iterator[None]:
    install_service_source(lambda sha: service if sha == MOD_PIN.sha256 else None)
    yield
    install_service_source(None)


def test_kind(service: OntologyService) -> None:
    classifier = classifier_of(service)
    assert classifier.kind("HP:0012828") == "modifier"  # Severe
    assert classifier.kind("HP:0040282") == "cohort"  # Frequent
    assert classifier.kind("HP:0001250") is None  # Seizure
    assert classifier.kind("HP:0012823") == "modifier"
    assert classifier.kind("HP:0040279") == "cohort"
    assert classifier.role("HP:0001250") == "finding"
    assert classifier.role("HP:0040282") == "cohort"


def test_exclusive_class(service: OntologyService) -> None:
    classifier = classifier_of(service)
    assert classifier.exclusive_class("HP:0012825") == "severity"  # Mild
    assert classifier.exclusive_class("HP:0012828") == "severity"
    assert classifier.exclusive_class("HP:0003623") == "onset"  # Neonatal onset
    assert classifier.exclusive_class("HP:0031796") is None  # Recurrent


def test_subtree(service: OntologyService) -> None:
    assert subtree(service, "HP:0011008") == {"HP:0011008", "HP:0031796"}
    assert subtree(service, "HP:9999999") == frozenset()


def test_classifier_is_cached(service: OntologyService) -> None:
    assert classifier_of(service) is classifier_of(service)


def test_term_roles_only_for_hpo_phenotype_layers(service: OntologyService) -> None:
    profile = modifier_profile()
    roles = term_roles_for_services(profile, {"hp": MOD_PIN}, {"hpo": service})
    assert roles.supports("hpo")
    assert roles.role("hpo", "HP:0012828") == "modifier"
    assert roles.exclusive_class("hpo", "HP:0012828") == "severity"
    generic = Pin(sha256=MOD_PIN.sha256, t1_profile="generic")
    plain = term_roles_for_services(profile, {"hp": generic}, {"hpo": service})
    assert not plain.supports("hpo")
    assert plain.role("hpo", "HP:0012828") == "finding"
    assert plain.classifier("hpo") is NO_MODIFIERS


def test_term_roles_through_the_installed_source(source: None) -> None:
    roles = term_roles(modifier_profile(), {"hp": MOD_PIN})
    assert roles.kind("hpo", "HP:0040282") == "cohort"


def test_term_roles_unknown_sha_raises(source: None) -> None:
    with pytest.raises(DomainError) as refused:
        term_roles(
            modifier_profile(), {"hp": Pin(sha256="0" * 64, t1_profile="hpo-phenotype")}
        )
    assert refused.value.code == "ONTOLOGY_NOT_FOUND"
    assert refused.value.details == {"sha256": "0" * 64}


def test_unknown_subtree_roots_are_not_cached(service: OntologyService) -> None:
    from ontocurator.ontology import modifiers

    assert subtree(service, "HP:9999998") == frozenset()
    assert (service.ref.sha256, "HP:9999998") not in modifiers._subtrees
    subtree(service, "HP:0011008")
    assert (service.ref.sha256, "HP:0011008") in modifiers._subtrees
