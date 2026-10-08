"""The registry hands each ontology the translation files of its prefix."""

import hashlib
import shutil
from pathlib import Path

from layered_fixtures import make_layered_package

from ontocurator.domain.profiles import OntologyDefinition
from ontocurator.ontology.registry import OntologyRegistry

FIXTURES = Path(__file__).parent / "fixtures"
HP = FIXTURES / "hp.json"
MONDO = FIXTURES / "mondo.json"
DE = FIXTURES / "hp-de.babelon.tsv"
ES = FIXTURES / "hp-es.babelon.tsv"


def _folder(tmp_path: Path, *files: Path) -> Path:
    folder = tmp_path / "ontologies"
    folder.mkdir()
    for source in files:
        shutil.copyfile(source, folder / source.name)
    return folder


def test_registry_assigns_files_by_prefix(tmp_path: Path) -> None:
    folder = _folder(tmp_path, DE, ES)
    (folder / "mondo-es.babelon.tsv").write_text(
        "subject_id\tpredicate_id\ttranslation_value\n"
        "MONDO:0001250\trdfs:label\tatrofia muscular espinal\n",
        encoding="utf-8",
    )
    (folder / "xx-de.babelon.tsv").write_text(
        "subject_id\tpredicate_id\ttranslation_value\nXX:1\trdfs:label\tEtwas\n",
        encoding="utf-8",
    )
    registry = OntologyRegistry(translation_dirs=[folder])
    hp_sha = registry.register_path(HP)
    mondo_sha = registry.register_path(MONDO)
    assert registry.load_registered() == []

    hp = registry.get_service(hp_sha)
    mondo = registry.get_service(mondo_sha)
    assert hp is not None and mondo is not None
    assert hp.translation_counts == {"de": 4, "es": 3}
    assert [item.filename for item in hp.translations] == [
        "hp-de.babelon.tsv",
        "hp-es.babelon.tsv",
    ]
    assert mondo.translation_counts == {"es": 1}
    assert [item.filename for item in mondo.translations] == ["mondo-es.babelon.tsv"]

    assert [sha for sha, _ in registry.services_for_prefix("hp")] == [hp_sha]
    assert [sha for sha, _ in registry.services_for_prefix("mondo")] == [mondo_sha]
    assert registry.services_for_prefix("xx") == []
    assert registry.unassigned_translations() == [folder / "xx-de.babelon.tsv"]


def test_a_file_is_unassigned_until_its_ontology_is_loaded(tmp_path: Path) -> None:
    folder = _folder(tmp_path, DE)
    registry = OntologyRegistry(translation_dirs=[folder])
    registry.register_path(MONDO)
    registry.load_registered()
    assert registry.unassigned_translations() == [folder / "hp-de.babelon.tsv"]

    sha = registry.register_path(HP)
    service = registry.get_service(sha)
    assert service is not None and service.languages == ["de"]
    assert registry.unassigned_translations() == []


def test_registry_without_translation_folders_loads_as_before() -> None:
    registry = OntologyRegistry()
    sha = registry.register_path(HP)
    service = registry.get_service(sha)

    assert service is not None
    assert service.languages == []
    assert registry.translation_files() == []
    assert registry.unassigned_translations() == []


def test_package_resources_get_the_translations_too(tmp_path: Path) -> None:
    folder = _folder(tmp_path, DE)
    registry = OntologyRegistry(translation_dirs=[folder])
    profile = make_layered_package("single").manifest.task_profile
    assert profile is not None

    prepared = registry.prepare_package(
        profile, {"ontologies/hp.json": HP.read_bytes()}
    )
    assert [service.languages for service in prepared] == [["de"]]

    # The static helper takes the files as an argument and works without them.
    definition = OntologyDefinition(
        ontology_id="hp",
        label="HPO",
        release="2026-06-23",
        sha256=hashlib.sha256(HP.read_bytes()).hexdigest(),
    )
    data = HP.read_bytes()
    assert OntologyRegistry.load_resource(data, definition).languages == []
    assert OntologyRegistry.load_resource(data, definition, [DE, ES]).languages == [
        "de",
        "es",
    ]
