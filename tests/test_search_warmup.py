"""Background warm-up of a project's pinned search on workspace open (U15)."""

import hashlib
import threading
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from ontotator.application.workspace_opening import WorkspaceOpeningService
from ontotator.authz.scoped import ScopedRepository
from ontotator.domain.documents import OntologyRef
from ontotator.domain.profiles import OntologyDefinition
from ontotator.domain.workspace import WorkspaceKey
from ontotator.ontology.provenance import SearchRequest
from ontotator.ontology.registry import OntologyRegistry
from ontotator.ontology.service import OntologyService
from ontotator.ontology.translations import LanguageLexicalIndex

FIXTURES = Path(__file__).parent / "fixtures"
HP = FIXTURES / "hp.json"
DE = FIXTURES / "hp-de.babelon.tsv"
ES = FIXTURES / "hp-es.babelon.tsv"
SHA = hashlib.sha256(HP.read_bytes()).hexdigest()
DEFINITION = OntologyDefinition(
    ontology_id="hp", label="HPO", release="2026-06-23", sha256=SHA
)
KEY = WorkspaceKey(
    project_key="p",
    document_id="doc",
    annotator_id="alice",
    mode="independent",
    target_set_id="targets-0",
)


def base_service() -> OntologyService:
    return OntologyService.load(HP, OntologyRef(release="x", sha256=SHA), [DE, ES])


def resources_of(service: OntologyService) -> dict[str, bytes]:
    return {
        f"search-resources/{item.sha256}/{item.filename}": item.content
        for item in service.translations
    }


def fake_repo(conditions, resources):
    repo = Mock()
    repo.get_search_conditions.return_value = conditions
    repo.get_embedded_files.return_value = resources
    repo.capture_search_conditions.side_effect = AssertionError("must not capture")
    return repo


def subsets(service: OntologyService) -> set[tuple[str, ...]]:
    lexical = service.engine.lexical
    assert isinstance(lexical, LanguageLexicalIndex)
    return set(lexical._subset_indexes)


def test_no_conditions_means_no_warm_up_and_nothing_written():
    registry = OntologyRegistry()
    registry.register_service(base_service())
    repo = fake_repo(None, {})
    assert registry.warm(repo, "p", [DEFINITION], ["de"]) is None
    repo.get_embedded_files.assert_not_called()
    repo.capture_search_conditions.assert_not_called()
    assert not registry._package_services and not registry._package_builds


def test_concurrent_warm_ups_share_one_single_flight_build(monkeypatch):
    base = base_service()
    registry = OntologyRegistry()
    registry.register_service(base)
    condition = base.capture_condition()
    repo = fake_repo([condition], resources_of(base))
    release = threading.Event()
    started = threading.Event()
    builds = []
    original = OntologyRegistry._pinned_service

    def counting(service, cond, resources):
        builds.append(cond.condition_id)
        started.set()
        assert release.wait(30)
        return original(service, cond, resources)

    monkeypatch.setattr(OntologyRegistry, "_pinned_service", staticmethod(counting))
    first = registry.warm(repo, "p", [DEFINITION], ["de"])
    assert first is not None and first.daemon
    assert started.wait(30)
    second = registry.warm(repo, "p", [DEFINITION], ["de"])
    assert second is not None
    release.set()
    first.join(30)
    second.join(30)
    assert builds == [condition.condition_id]
    service = registry._package_services[condition.condition_id]
    assert ("de",) in subsets(service)
    repo.capture_search_conditions.assert_not_called()
    # The search afterwards uses the warmed view: nothing is built again.
    assert registry._package_ontology(repo, "p", DEFINITION, [condition]) is service
    assert builds == [condition.condition_id]


@pytest.mark.parametrize("query", ["Krampfanfall", "Muskelhypotonie", "hearing"])
def test_warmed_subset_ranks_like_a_cold_query(query):
    base = base_service()
    condition = base.capture_condition()
    resources = resources_of(base)
    cold = OntologyRegistry._pinned_service(base, condition, resources)
    warmed = OntologyRegistry._pinned_service(base, condition, resources)
    OntologyRegistry.warm_languages(warmed, ["de"])
    assert ("de",) in subsets(warmed) and not subsets(cold)
    request = SearchRequest(
        workspace_key=KEY, annotation_id="a", query=query, languages=["de"]
    )
    expected, actual = cold.search(request), warmed.search(request)
    assert actual.ranked_ids == expected.ranked_ids
    assert actual.displayed_ids == expected.displayed_ids
    assert [c.score for c in actual.candidates] == [
        c.score for c in expected.candidates
    ]
    assert expected.ranked_ids


def opening(*, read_only: bool, registry=True):
    layer = SimpleNamespace(layer_id="hpo-layer", ontology_id="hp")
    view = SimpleNamespace(
        key=KEY,
        document=SimpleNamespace(language="DE"),
        scope=SimpleNamespace(editable_layer_ids=["hpo-layer"]),
        layers=[layer],
        ontologies=[DEFINITION],
    )
    repo = Mock(spec=ScopedRepository)
    repo.workspace_assignment.return_value = SimpleNamespace(
        id=1, active_round_id=None, held=read_only, status="open"
    )
    workspaces = SimpleNamespace(
        repo=repo,
        open=Mock(return_value=view),
        registry=Mock(spec=OntologyRegistry) if registry else None,
    )
    return WorkspaceOpeningService(workspaces), workspaces


def test_open_starts_the_warm_up_for_editable_layers_and_document_language():
    service, workspaces = opening(read_only=False)
    service.open(KEY)
    workspaces.registry.warm.assert_called_once_with(
        workspaces.repo, "p", [DEFINITION], ["de"]
    )


def test_read_only_open_and_single_service_setups_do_not_warm():
    service, workspaces = opening(read_only=True)
    service.open(KEY)
    workspaces.registry.warm.assert_not_called()
    service, workspaces = opening(read_only=False, registry=False)
    assert not service.open(KEY).read_only


def test_a_failing_warm_up_never_breaks_the_open():
    service, workspaces = opening(read_only=False)
    workspaces.registry.warm.side_effect = RuntimeError("database gone")
    assert not service.open(KEY).read_only


def test_workspace_open_warms_only_after_conditions_exist(tmp_path, monkeypatch):
    from test_translation_api import _client, _folder, _open_single, _search

    threads = []
    original_warm = OntologyRegistry.warm

    def spy(self, *args, **kwargs):
        thread = original_warm(self, *args, **kwargs)
        threads.append(thread)
        return thread

    monkeypatch.setattr(OntologyRegistry, "warm", spy)
    _folder(tmp_path, DE, ES)
    client = _client(tmp_path, ontology_paths=[HP])
    key = _open_single(client, embedded=True)
    repo = client.app.state.repo
    assert threads == [None]
    assert repo.get_search_conditions(key["project_key"]) is None

    cold = _search(client, key, "Krampfanfall", languages=["de"])
    registry = client.app.state.ontology_registry
    registry._package_services.clear()  # a fresh worker
    builds = []
    original = OntologyRegistry._pinned_service

    def counting(service, condition, resources):
        builds.append(condition.condition_id)
        return original(service, condition, resources)

    monkeypatch.setattr(OntologyRegistry, "_pinned_service", staticmethod(counting))
    opened = client.post(
        "/api/v1/workspaces/open",
        json={
            "project_key": key["project_key"],
            "document_id": key["document_id"],
            "annotator_id": key["annotator_id"],
            "mode": key["mode"],
        },
    )
    assert opened.status_code == 200, opened.text
    assert threads[-1] is not None
    threads[-1].join(60)
    assert len(builds) == 1
    warm = _search(client, key, "Krampfanfall", languages=["de"])
    assert len(builds) == 1
    assert warm["ranked_ids"] == cold["ranked_ids"]
    assert warm["search_condition_id"] == cold["search_condition_id"]
