"""Search restricted to modifier subtrees (``within``) and term roles (C4)."""

from __future__ import annotations

import pytest
from modifier_fixtures import MOD_DE, MOD_PATH, MOD_PIN
from t1_fixtures import FIXTURES, HP_PATH, HP_SHA

from ontocurator.domain.documents import OntologyRef
from ontocurator.domain.workspace import WorkspaceKey
from ontocurator.ontology.provenance import SearchRequest
from ontocurator.ontology.service import OntologyService

KEY = WorkspaceKey(
    project_key="pkg-1",
    document_id="doc-1",
    annotator_id="dr-meier",
    mode="independent",
    target_set_id="targets-1",
)


def _request(query: str, **kwargs: object) -> SearchRequest:
    return SearchRequest(
        workspace_key=KEY, annotation_id="ann-1", query=query, **kwargs
    )


@pytest.fixture(scope="module")
def hp() -> OntologyService:
    return OntologyService.load(
        HP_PATH,
        OntologyRef(release="2026-06-23", sha256=HP_SHA),
        translation_paths=[FIXTURES / "hp-de.babelon.tsv"],
    )


@pytest.fixture(scope="module")
def mods() -> OntologyService:
    return OntologyService.load(
        MOD_PATH,
        OntologyRef(release="2026-06-23", sha256=MOD_PIN.sha256),
        translation_paths=[MOD_DE],
    )


# Recorded on the unchanged code (characterization): searches without
# ``within`` keep their seeds.
@pytest.mark.parametrize(
    ("query", "route", "languages", "seed"),
    [
        ("seiz", "auto", None, "9f1e3a0070532352"),
        ("seiz", "lexical", None, "9f1e3a0070532352"),
        ("seiz", "auto", [], "9befef749f02fd83"),
        ("seiz", "lexical", [], "9befef749f02fd83"),
    ],
)
def test_seeds_without_within_are_unchanged(
    hp: OntologyService,
    query: str,
    route: str,
    languages: list[str] | None,
    seed: str,
) -> None:
    result = hp.search(_request(query, route=route, languages=languages))
    assert result.seed == seed
