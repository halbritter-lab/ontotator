"""Small-fixture regressions for bounded package service construction."""

from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from threading import Barrier, Event, Lock
from types import SimpleNamespace
from typing import Any

import pytest
from layered_fixtures import make_layered_package

from ontocurator.domain.documents import OntologyRef
from ontocurator.ontology import registry as registry_module
from ontocurator.ontology.registry import OntologyRegistry
from ontocurator.ontology.service import OntologyService

FIXTURES = Path(__file__).parent / "fixtures"


def _environment(
    translated: bool = False,
) -> tuple[Any, OntologyRegistry, OntologyService]:
    profile = make_layered_package("single").manifest.task_profile
    assert profile is not None
    base = OntologyService.load(
        FIXTURES / "hp.json",
        OntologyRef(release="fixture", sha256=profile.ontologies[0].sha256),
        translation_paths=[FIXTURES / "hp-de.babelon.tsv"] if translated else [],
    )
    condition = base.capture_condition()
    resources = {
        f"search-resources/{item.sha256}/{item.filename}": item.content
        for item in base.translations
    }
    repo = SimpleNamespace(
        get_task_profile=lambda _: profile,
        get_search_conditions=lambda _: [condition],
        get_embedded_files=lambda _: resources,
    )
    registry = OntologyRegistry()
    registry.register_service(base)
    return repo, registry, base


@pytest.mark.parametrize("fail", [False, True])
def test_same_condition_build_is_single_flight_and_failure_can_retry(
    monkeypatch: pytest.MonkeyPatch,
    fail: bool,
) -> None:
    repo, registry, _ = _environment()
    entered, release, second_joined = Event(), Event(), Event()
    second_started = Barrier(2)
    original = registry._pinned_service
    count = 0
    lock = Lock()

    class ObservedFlight(Future[OntologyService]):
        def result(self, timeout: float | None = None) -> OntologyService:
            second_joined.set()
            return super().result(timeout)

    monkeypatch.setattr(registry_module, "Future", ObservedFlight, raising=False)

    def build(*args: Any) -> OntologyService:
        nonlocal count
        with lock:
            count += 1
            first = count == 1
        if first:
            entered.set()
            assert release.wait(5)
        else:
            second_joined.set()
        if fail:
            raise ValueError("cold failure")
        return original(*args)

    monkeypatch.setattr(registry, "_pinned_service", build)

    def resolve(second: bool = False) -> OntologyService:
        if second:
            second_started.wait(timeout=5)
        return registry.for_package_layer(repo, "package", "hpo-layer")

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(resolve)
        assert entered.wait(5)
        second = pool.submit(resolve, True)
        second_started.wait(timeout=5)
        try:
            assert second_joined.wait(5)
        finally:
            release.set()
        if fail:
            for result in (first, second):
                with pytest.raises(ValueError, match="cold failure"):
                    result.result(timeout=5)
        else:
            assert first.result(timeout=5) is second.result(timeout=5)
    assert count == 1
    assert not registry._package_builds
    monkeypatch.setattr(registry, "_pinned_service", original)
    assert (
        registry.for_package_layer(repo, "package", "hpo-layer")
        .validate_term("HP:0001252")
        .status
        == "valid"
    )


@pytest.mark.parametrize("translated", [False, True])
def test_exact_resources_share_fitted_data_without_mutating_base(
    translated: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo, registry, base = _environment(translated)
    from ontocurator.vendor.hpo_span_annotator.lexical import LexicalIndex

    def unexpected_fit(self: LexicalIndex) -> None:
        pytest.fail("equal resources must reuse the fitted index")

    monkeypatch.setattr(LexicalIndex, "build", unexpected_fit)
    view = registry.for_package_layer(repo, "package", "hpo-layer")
    assert view is not base
    assert view.ontology is not base.ontology
    assert view.engine.lexical._matrix is base.engine.lexical._matrix
    assert view.engine.lexical._vectorizer is base.engine.lexical._vectorizer
    assert view.search_condition is not None
    assert base.search_condition is None
    assert view.languages == (["de"] if translated else [])
    monkeypatch.undo()
    replacement = base.with_translations([])
    registry.publish({base.ref.sha256: replacement})
    assert view.languages == (["de"] if translated else [])
    assert view.engine.lexical._matrix is base.engine.lexical._matrix
    assert replacement.search_condition is None


def test_different_captured_resources_do_not_share_ambient_index() -> None:
    repo, registry, base = _environment(True)
    empty = base.with_translations([]).capture_condition()
    repo.get_search_conditions = lambda _: [empty]
    view = registry.for_package_layer(repo, "package", "hpo-layer")
    assert view.ontology is not base.ontology
    assert view.engine is not base.engine
    assert view.languages == []
    assert base.languages == ["de"]


@pytest.mark.parametrize("command", ["create_annotation", "set_term"])
def test_cold_edit_service_build_runs_before_mutation_transaction(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    command: str,
) -> None:
    from test_editing import _setup_test_env

    from ontocurator.application.editing import EditingService
    from ontocurator.domain.workspace import MutationEnvelope, WorkspaceKey

    repo, base, workspaces, initial_editor, _ = _setup_test_env(tmp_path)
    key = workspaces.open(
        WorkspaceKey(
            project_key="pkg-1",
            document_id="doc-1",
            annotator_id="annotator-1",
            mode="independent",
            target_set_id="targets-0",
        )
    ).key
    revision = 0
    if command == "set_term":
        draft = initial_editor.apply(
            key,
            MutationEnvelope(
                mutation_id="seed",
                expected_revision=0,
                payload={
                    "command": "create_annotation",
                    "annotation_id": "annotation",
                    "term_id": "HP:0001252",
                    "layer_id": "hpo-layer",
                },
            ),
        )
        revision = draft.revision
    registry = OntologyRegistry()
    registry.register_service(base)
    original = registry._pinned_service
    observed = []

    def build(*args: Any) -> OntologyService:
        observed.append(repo.db.in_transaction())
        assert not repo.db.in_transaction()
        return original(*args)

    monkeypatch.setattr(registry, "_pinned_service", build)
    payload = {
        "command": command,
        "annotation_id": "annotation",
        "term_id": "HP:0001250",
    }
    if command == "create_annotation":
        payload["layer_id"] = "hpo-layer"
    envelope = MutationEnvelope(
        mutation_id="cold-edit", expected_revision=revision, payload=payload
    )
    editor = EditingService(repo, registry)
    draft = editor.apply(key, envelope)
    assert observed == [False]
    assert draft.annotations[0].annotation.term_id == "HP:0001250"
    assert editor.apply(key, envelope) == draft
    # A failed reconstruction after eviction must not defeat a stored receipt
    # or change revision-conflict precedence; neither executes term validation.
    registry._package_services.clear()

    def unavailable(*args: Any) -> OntologyService:
        raise ValueError("temporary build failure")

    monkeypatch.setattr(registry, "_pinned_service", unavailable)
    assert editor.apply(key, envelope) == draft
    from ontocurator.domain.errors import RevisionConflict

    with pytest.raises(RevisionConflict):
        editor.apply(
            key,
            envelope.model_copy(
                update={"mutation_id": "conflict", "expected_revision": 99}
            ),
        )
    with pytest.raises(ValueError, match="temporary build failure"):
        editor.apply(
            key,
            envelope.model_copy(
                update={
                    "mutation_id": "failed-new-edit",
                    "expected_revision": draft.revision,
                }
            ),
        )
    assert repo.open_draft(key).revision == draft.revision


def _historical_condition(base: OntologyService, label: str) -> Any:
    from ontocurator.domain.canonical import canonical_hash
    from ontocurator.ontology.conditions import SearchCondition

    payload = base.capture_condition().model_dump(exclude={"condition_id"})
    payload["runtime"]["python"] = label
    return SearchCondition.model_validate(
        {"condition_id": canonical_hash(payload), **payload}
    )


def test_independent_conditions_build_concurrently(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo, registry, base = _environment()
    conditions = {name: _historical_condition(base, name) for name in ("a", "b")}
    repo.get_search_conditions = lambda name: [conditions[name]]
    rendezvous = Barrier(2)
    original = registry._pinned_service

    def build(*args: Any) -> OntologyService:
        rendezvous.wait(timeout=5)
        return original(*args)

    monkeypatch.setattr(registry, "_pinned_service", build)
    with ThreadPoolExecutor(max_workers=2) as pool:
        services = list(
            pool.map(
                lambda name: registry.for_package_layer(repo, name, "hpo-layer"),
                ["a", "b"],
            )
        )
    assert services[0].search_condition != services[1].search_condition
    assert all(
        service.engine.lexical._matrix is base.engine.lexical._matrix
        for service in services
    )
    assert all(service.runtime_drift() for service in services)
    assert not registry._package_builds


def test_eviction_keeps_active_views_valid_and_rebuild_coordination_bounded() -> None:
    repo, registry, base = _environment(True)
    conditions = {str(i): _historical_condition(base, str(i)) for i in range(10)}
    repo.get_search_conditions = lambda name: [conditions[name]]
    active = registry.for_package_layer(repo, "0", "hpo-layer")
    for i in range(1, 10):
        registry.for_package_layer(repo, str(i), "hpo-layer")
    assert len(registry._package_services) == 8
    assert not registry._package_builds
    assert conditions["0"].condition_id not in registry._package_services
    assert active.validate_term("HP:0001252").label == "Hypotonia"
    assert active.languages == ["de"]
    assert active.search_condition == conditions["0"]
    rebuilt = registry.for_package_layer(repo, "0", "hpo-layer")
    assert rebuilt is not active
    assert rebuilt.engine.lexical._matrix is active.engine.lexical._matrix


def test_changed_resource_bytes_are_checked_even_when_metadata_matches() -> None:
    repo, registry, base = _environment(True)
    condition = base.capture_condition()
    repo.get_embedded_files = lambda _: {
        condition.translations[
            0
        ].resource_path: b"subject_id\ttranslation_value\nHP:0001252\tChanged\n"
    }
    from ontocurator.domain.errors import DomainError

    with pytest.raises(DomainError, match="INVALID_SEARCH_CONDITION"):
        registry.for_package_layer(repo, "package", "hpo-layer")
    assert not registry._package_builds


def test_blocked_cold_edit_releases_connection_for_unrelated_draft(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from test_editing import _setup_test_env

    from ontocurator.application.editing import EditingService
    from ontocurator.domain.workspace import MutationEnvelope, WorkspaceKey

    repo, base, workspaces, initial_editor, _ = _setup_test_env(tmp_path)
    key = workspaces.open(
        WorkspaceKey(
            project_key="pkg-1",
            document_id="doc-1",
            annotator_id="annotator-1",
            mode="independent",
            target_set_id="targets-0",
        )
    ).key
    other_key = workspaces.open(
        key.model_copy(update={"annotator_id": "annotator-2"})
    ).key
    registry = OntologyRegistry()
    registry.register_service(base)
    entered, release = Event(), Event()
    original = registry._pinned_service

    def build(*args: Any) -> OntologyService:
        assert not repo.db.in_transaction()
        entered.set()
        assert release.wait(10)
        return original(*args)

    monkeypatch.setattr(registry, "_pinned_service", build)
    envelope = MutationEnvelope(
        mutation_id="create",
        expected_revision=0,
        payload={
            "command": "create_annotation",
            "annotation_id": "annotation",
            "term_id": "HP:0001252",
            "layer_id": "hpo-layer",
        },
    )
    with ThreadPoolExecutor(max_workers=2) as pool:
        blocked = pool.submit(EditingService(repo, registry).apply, key, envelope)
        try:
            assert entered.wait(5)
            # This pool observation verifies the blocked builder has returned
            # its DB connection, as well as checking unrelated work can finish.
            assert repo.db.engine.pool.checkedout() == 0
            unrelated = pool.submit(initial_editor.apply, other_key, envelope)
            assert unrelated.result(timeout=5).revision == 1
        finally:
            release.set()
        assert blocked.result(timeout=5).revision == 1


@pytest.mark.parametrize("warm_subset", [False, True])
def test_pinned_reads_keep_captured_terms_after_ambient_mutation(
    warm_subset: bool,
) -> None:
    repo, registry, base = _environment(True)
    if warm_subset:
        base.engine.lexical.search("Seizure", 10, languages=[])
    view = registry.for_package_layer(repo, "package", "hpo-layer")
    term = base.ontology.terms["HP:0001250"]
    term.label = "Ambient label"
    term.definition = "Ambient definition"
    term.synonyms.append(("hasExactSynonym", "Ambient synonym"))
    term.parents.clear()
    term.translations["de"].append("Ambient translation")
    term.translations["es"] = ["Ambient Spanish"]

    assert view.validate_term("hp:0001250").label == "Seizure"
    assert view.ontology.get("HP:0001250").parents == ["HP:0000707"]
    assert view.ontology.get("HP:0001250").translations == {"de": ["Krampfanfall"]}
    hits = [
        view.engine.search("Seizure", path="exact")["hits"][0],
        view._translated.exact("Krampfanfall", ["de"])[0],
        view.engine.lexical.search("Seizure", 10)[0],
        view.engine.lexical.search("Seizure", 10, languages=[])[0],
    ]
    for hit in hits:
        assert hit["hpo_id"] == "HP:0001250"
        assert hit["label"] == "Seizure"
        assert hit["definition"] != "Ambient definition"
        assert "Ambient synonym" not in hit["synonyms"]
    assert not view._translated.exact("Ambient translation", ["de"])
    if warm_subset:
        assert (
            view.engine.lexical._subset_indexes[()]._matrix
            is not base.engine.lexical._subset_indexes[()]._matrix
        )


@pytest.mark.parametrize("evicted", [False, True])
def test_captured_translation_bytes_restore_names_before_pinned_build(
    evicted: bool,
) -> None:
    repo, registry, base = _environment(True)
    if evicted:
        registry.for_package_layer(repo, "package", "hpo-layer")
        registry._package_services.clear()
    base.ontology.terms["HP:0001250"].translations = {
        "de": ["Changed German"],
        "es": ["Ambient Spanish"],
    }
    view = registry.for_package_layer(repo, "package", "hpo-layer")
    assert view.ontology.get("HP:0001250").translations == {"de": ["Krampfanfall"]}
    assert view._translated.exact("Krampfanfall", ["de"])[0]["label"] == "Seizure"
    assert not view._translated.exact("Changed German", ["de"])
    assert (
        view.engine.lexical.search("Krampfanfall", 10)[0]["matched_term"]
        == "Krampfanfall"
    )
    assert view.engine.lexical._matrix is base.engine.lexical._matrix


@pytest.mark.parametrize("evicted", [False, True])
def test_pinned_subset_rejects_ambient_names_fitted_after_capture(
    evicted: bool,
) -> None:
    repo, registry, initial = _environment(True)
    base = initial.with_translations(
        [FIXTURES / "hp-de.babelon.tsv", FIXTURES / "hp-es.babelon.tsv"]
    )
    registry.register_service(base)
    condition = base.capture_condition()
    repo.get_search_conditions = lambda _: [condition]
    repo.get_embedded_files = lambda _: {
        f"search-resources/{item.sha256}/{item.filename}": item.content
        for item in base.translations
    }
    if evicted:
        registry.for_package_layer(repo, "package", "hpo-layer")
        registry._package_services.clear()
    base.ontology.terms["HP:0001250"].translations["de"] = ["AmbientUncapturedName"]
    ambient = base.engine.lexical.search("AmbientUncapturedName", 10, languages=["de"])
    assert ambient[0]["matched_term"] == "AmbientUncapturedName"

    view = registry.for_package_layer(repo, "package", "hpo-layer")
    assert view._translated.exact("Krampfanfall", ["de"])[0]["label"] == "Seizure"
    assert not view._translated.exact("AmbientUncapturedName", ["de"])
    hits = view.engine.lexical.search("AmbientUncapturedName", 10, languages=["de"])
    assert all(hit["matched_term"] != "AmbientUncapturedName" for hit in hits)
    captured = view.engine.lexical.search("Krampfanfall", 10, languages=["de"])
    assert captured[0]["matched_term"] == "Krampfanfall"
    assert view.engine.lexical._matrix is base.engine.lexical._matrix
