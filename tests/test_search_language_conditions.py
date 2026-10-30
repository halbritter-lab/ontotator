"""Installed but disabled languages cannot influence a study condition."""

import hashlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from ontotator.domain.documents import OntologyRef
from ontotator.domain.workspace import WorkspaceKey
from ontotator.ontology.provenance import SearchRequest
from ontotator.ontology.service import OntologyService

FIXTURES = Path(__file__).parent / "fixtures"


def service(*languages: str) -> OntologyService:
    path = FIXTURES / "hp.json"
    return OntologyService.load(
        path,
        OntologyRef(
            release="fixture", sha256=hashlib.sha256(path.read_bytes()).hexdigest()
        ),
        [FIXTURES / f"hp-{language}.babelon.tsv" for language in languages],
    )


def ranked(
    svc: OntologyService, languages: list[str]
) -> list[tuple[str, float | None]]:
    result = svc.search(
        SearchRequest(
            workspace_key=WorkspaceKey(
                project_key="study",
                document_id="case",
                annotator_id="rater",
                mode="independent",
                target_set_id="targets-0",
            ),
            annotation_id="finding",
            query="Abnormality Epileptic",
            route="lexical",
            languages=languages,
        )
    )
    return [
        (c.term_id, c.score) for c in sorted(result.candidates, key=lambda c: c.rank)
    ]


def test_disabled_translations_do_not_change_english_ranks_or_scores() -> None:
    expected = ranked(service(), [])
    assert "HP:0001250" in [term_id for term_id, _score in expected]
    assert ranked(service("de", "es"), []) == expected


def test_an_unselected_language_does_not_change_a_bilingual_corpus() -> None:
    assert ranked(service("de", "es"), ["de"]) == ranked(service("de"), ["de"])


def test_concurrent_language_conditions_do_not_contaminate_each_other() -> None:
    svc = service("de", "es")
    selections = [[], ["de"], ["es"], ["es", "de"]] * 4
    expected = {tuple(codes): ranked(service(*codes), codes) for codes in selections}
    with ThreadPoolExecutor(max_workers=4) as pool:
        actual = list(pool.map(lambda codes: ranked(svc, codes), selections))
    assert actual == [expected[tuple(codes)] for codes in selections]
