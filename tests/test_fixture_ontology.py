"""The separate modifier fixture ontology (modifiers plan F0, D-h)."""

import hashlib
import json
from pathlib import Path

from modifier_fixtures import MOD_DE, MOD_PATH, MOD_PIN, create_modifier_project
from pg_harness import database_for
from t1_fixtures import FIXTURES, HP_PATH, HP_SHA

from ontotator.domain.documents import OntologyRef
from ontotator.domain.workspace import WorkspaceKey
from ontotator.ontology.provenance import SearchRequest
from ontotator.ontology.service import OntologyService
from ontotator.ontology.translations import discover_translation_files
from ontotator.storage.repository import Repository

# (id, label, parent) as in HPO release 2026-06-23.
TERMS = [
    ("HP:0012823", "Clinical modifier", "HP:0000001"),
    ("HP:0012824", "Severity", "HP:0012823"),
    ("HP:0012825", "Mild", "HP:0012824"),
    ("HP:0012828", "Severe", "HP:0012824"),
    ("HP:0031797", "Clinical course", "HP:0012823"),
    ("HP:0003674", "Onset", "HP:0031797"),
    ("HP:0410280", "Pediatric onset", "HP:0003674"),
    ("HP:0003623", "Neonatal onset", "HP:0003674"),
    ("HP:0011008", "Temporal pattern", "HP:0031797"),
    ("HP:0031796", "Recurrent", "HP:0011008"),
    ("HP:0012830", "Position", "HP:0012823"),
    ("HP:0012831", "Laterality", "HP:0012830"),
    ("HP:0012832", "Bilateral", "HP:0012831"),
    ("HP:0040279", "Frequency", "HP:0000001"),
    ("HP:0040282", "Frequent", "HP:0040279"),
    ("HP:0007359", "Focal-onset seizure", "HP:0001250"),
]
# Pasted from the unchanged shared fixtures: they must stay byte-identical.
HP_JSON_SHA = "279123a1ae5314e4632a0f85be2d82efd50f44ebf0d98e0100ed6859d7cb83e4"
HP_DE_SHA = "aa8f4e933a4fa12078b83e039d2d3aff273706b550e416f584228a034d7aeb12"


def _curie(iri: str) -> str:
    return iri.rsplit("/", 1)[-1].replace("_", ":")


def _graph(path: Path) -> dict:
    return json.loads(path.read_bytes())["graphs"][0]


def _service(*translations: Path) -> OntologyService:
    return OntologyService.load(
        MOD_PATH,
        OntologyRef(release="2026-06-23", sha256=MOD_PIN.sha256),
        translation_paths=translations,
    )


def test_every_modifier_term_has_its_label_and_parent() -> None:
    graph = _graph(MOD_PATH)
    labels = {_curie(n["id"]): n["lbl"] for n in graph["nodes"]}
    edges = {(_curie(e["sub"]), _curie(e["obj"])) for e in graph["edges"]}
    service = _service()
    for term_id, label, parent in TERMS:
        assert labels[term_id] == label
        assert (term_id, parent) in edges
        assert service.validate_term(term_id).label == label


def test_ancestors_reach_the_modifier_roots() -> None:
    service = _service()
    assert {"HP:0003674", "HP:0012823"} <= service.all_ancestors_of("HP:0003623")
    frequent = service.all_ancestors_of("HP:0040282")
    assert "HP:0040279" in frequent
    assert "HP:0012823" not in frequent


def test_german_search_finds_severe() -> None:
    result = _service(MOD_DE).search(
        SearchRequest(
            workspace_key=WorkspaceKey(
                project_key="pkg-1",
                document_id="doc-1",
                annotator_id="dr-meier",
                mode="independent",
                target_set_id="targets-1",
            ),
            annotation_id="ann-1",
            query="schwere",
            languages=["de"],
        )
    )
    assert "HP:0012828" in [c.term_id for c in result.candidates]


def test_modifier_fixture_is_a_superset_of_hp_json() -> None:
    base, mods = _graph(HP_PATH), _graph(MOD_PATH)
    assert base["meta"] == mods["meta"]
    assert all(node in mods["nodes"] for node in base["nodes"])
    assert all(edge in mods["edges"] for edge in base["edges"])


def test_shared_fixtures_stay_unchanged() -> None:
    assert HP_SHA == HP_JSON_SHA
    de = FIXTURES / "hp-de.babelon.tsv"
    assert hashlib.sha256(de.read_bytes()).hexdigest() == HP_DE_SHA


def test_fixture_discovery_does_not_list_the_modifier_translation() -> None:
    assert MOD_DE not in discover_translation_files([FIXTURES])
    assert all(p.parent == FIXTURES for p in discover_translation_files([FIXTURES]))


def test_create_modifier_project_pins_the_modifier_fixture(tmp_path: Path) -> None:
    db = database_for(tmp_path / "mods.db")
    create_modifier_project(db)
    assert Repository(db).project_pins("mods") == {"hp": MOD_PIN}
