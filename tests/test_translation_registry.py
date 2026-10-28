"""The registry hands each ontology the translation files of its prefix."""

import hashlib
import io
import shutil
import threading
from collections.abc import Callable, Iterable
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

from layered_fixtures import make_layered_package
from support.ontology_upload import OntologyUploadService
from support.v2_import import PackageImportService

from ontotator.application.uploads import TranslationUploadService
from ontotator.domain.profiles import OntologyDefinition
from ontotator.ontology.registry import OntologyRegistry
from ontotator.ontology.service import OntologyService

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


# --- concurrent changes ----------------------------------------------------- #


def _pause_first_rebuild(
    registry: OntologyRegistry, other_done: threading.Event
) -> threading.Event:
    """Hold the first rebuild right after it built its services.

    Returns the event that says "the first upload has rebuilt and is about to
    move its file into place". From there it waits for the other change to
    finish. A registry that serialises changes never lets the other one get
    that far, so the wait runs out and the first upload completes alone.
    """
    rebuilt = threading.Event()
    original = registry.rebuild_for_prefix

    def paused(prefix: str, paths: Iterable[Path]) -> dict[str, OntologyService]:
        services = original(prefix, paths)
        if not rebuilt.is_set():
            rebuilt.set()
            other_done.wait(timeout=2.0)
        return services

    registry.rebuild_for_prefix = paused  # type: ignore[method-assign]
    return rebuilt


def _run_interleaved(
    first: Callable[[], object],
    second: Callable[[], object],
    rebuilt: threading.Event,
    second_done: threading.Event,
) -> None:
    errors: list[BaseException] = []

    def guarded(action: Callable[[], object], done: threading.Event | None) -> None:
        try:
            action()
        except BaseException as exc:
            errors.append(exc)
        finally:
            if done is not None:
                done.set()

    one = threading.Thread(target=guarded, args=(first, None))
    one.start()
    assert rebuilt.wait(timeout=10)
    two = threading.Thread(target=guarded, args=(second, second_done))
    two.start()
    one.join(timeout=30)
    two.join(timeout=30)
    assert not one.is_alive() and not two.is_alive()
    assert errors == []


def test_a_translation_upload_parses_no_unloaded_release(tmp_path: Path) -> None:
    """Only loaded releases are rebuilt; the others read the file on first load (#82)."""
    folder = _folder(tmp_path)
    registry = OntologyRegistry(translation_dirs=[folder])
    sha = registry.register_path(HP)

    TranslationUploadService(registry, folder).store(
        io.BytesIO(DE.read_bytes()), DE.name
    )

    assert registry.services() == []
    service = registry.get_service(sha)
    assert service is not None
    assert service.languages == ["de"]


def test_two_translation_uploads_at_once_keep_both_languages(tmp_path: Path) -> None:
    folder = _folder(tmp_path)
    registry = OntologyRegistry(translation_dirs=[folder])
    sha = registry.register_path(HP)
    registry.load_registered()
    uploads = TranslationUploadService(registry, folder)
    second_done = threading.Event()
    rebuilt = _pause_first_rebuild(registry, second_done)

    _run_interleaved(
        lambda: uploads.store(io.BytesIO(DE.read_bytes()), DE.name),
        lambda: uploads.store(io.BytesIO(ES.read_bytes()), ES.name),
        rebuilt,
        second_done,
    )

    assert sorted(p.name for p in folder.iterdir()) == [DE.name, ES.name]
    service = registry.get_service(sha)
    assert service is not None
    # What is searched is what lies in the folder.
    assert service.languages == ["de", "es"]
    assert sorted(item.filename for item in service.translations) == [
        DE.name,
        ES.name,
    ]


def test_an_ontology_uploaded_during_a_translation_upload_gets_the_file(
    tmp_path: Path,
) -> None:
    folder = _folder(tmp_path)
    registry = OntologyRegistry(translation_dirs=[folder])
    registry.register_path(HP)
    registry.load_registered()
    translations = TranslationUploadService(registry, folder)
    ontologies = OntologyUploadService(registry, folder)
    # The same ontology with other bytes: a second release with the prefix HP.
    other_release = HP.read_bytes() + b"\n"
    second_done = threading.Event()
    rebuilt = _pause_first_rebuild(registry, second_done)

    _run_interleaved(
        lambda: translations.store(io.BytesIO(DE.read_bytes()), DE.name),
        lambda: ontologies.store(io.BytesIO(other_release), "hp.json"),
        rebuilt,
        second_done,
    )

    assert (folder / DE.name).is_file()
    loaded = registry.services_for_prefix("hp")
    assert len(loaded) == 2
    assert [service.languages for _, service in loaded] == [["de"], ["de"]]


def test_a_search_is_answered_while_a_translation_upload_rebuilds(
    tmp_path: Path,
) -> None:
    folder = _folder(tmp_path)
    registry = OntologyRegistry(translation_dirs=[folder])
    sha = registry.register_path(HP)
    registry.load_registered()
    uploads = TranslationUploadService(registry, folder)
    seen: list[list[str]] = []
    original = registry.rebuild_for_prefix

    def rebuild(prefix: str, paths: Iterable[Path]) -> dict[str, OntologyService]:
        services = original(prefix, paths)
        # Still inside the upload: another thread asks for the ontology.
        reader = threading.Thread(
            target=lambda: seen.append(registry.get_service(sha).languages)  # type: ignore[union-attr]
        )
        reader.start()
        reader.join(timeout=10)
        assert not reader.is_alive(), "a search waited for the upload"
        return services

    registry.rebuild_for_prefix = rebuild  # type: ignore[method-assign]
    uploads.store(io.BytesIO(DE.read_bytes()), DE.name)

    # The old service answered during the rebuild, the new one afterwards.
    assert seen == [[]]
    assert registry.get_service(sha).languages == ["de"]  # type: ignore[union-attr]


def test_a_package_imported_during_a_translation_upload_gets_the_file(
    tmp_path: Path,
) -> None:
    """The import writes to the database between building and registering its
    ontologies, and does not keep other changes out while it does. A file
    uploaded in that gap must still reach the ontology the package brought."""
    folder = _folder(tmp_path)
    registry = OntologyRegistry(translation_dirs=[folder])
    translations = TranslationUploadService(registry, folder)
    manifest = make_layered_package("single").manifest
    package = SimpleNamespace(
        manifest=manifest, embedded_files={"ontologies/hp.json": HP.read_bytes()}
    )

    class Repo:
        def import_package(self, pkg: object) -> None:
            translations.store(io.BytesIO(DE.read_bytes()), DE.name)

    PackageImportService(cast(Any, Repo()), registry).import_package(cast(Any, package))

    assert (folder / DE.name).is_file()
    assert [service.languages for _, service in registry.services()] == [["de"]]
