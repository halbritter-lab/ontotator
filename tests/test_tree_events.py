"""The one search event that grows: a walk through the ontology tree."""

import io
from concurrent.futures import ThreadPoolExecutor

import pytest
from test_storage import _sample_package
from test_storage_regressions import key_for

from ontocurator.application.exports import ExportService
from ontocurator.domain.errors import InvalidPackage
from ontocurator.packages.models import SearchEventRecord
from ontocurator.packages.reader import PackageReader
from ontocurator.packages.writer import PackageWriter
from ontocurator.storage.sqlite_database import Database
from ontocurator.storage.sqlite_repository import Repository


def _walk(candidates: list[str], **overrides: object) -> SearchEventRecord:
    fields: dict[str, object] = {
        "event_id": "walk-1",
        "workspace_key": key_for(),
        "annotation_id": "ann-1",
        "query": "HP:0001250",
        "route": "browse",
        "candidates": list(candidates),
        "ranked_ids": list(candidates),
        "ontology_release": "2026-06-23",
        "index_identity": "index",
        "timestamp": "2026-10-08T10:00:00+00:00",
    }
    fields.update(overrides)
    return SearchEventRecord.model_validate(fields)


def _repo(tmp_path) -> Repository:
    repo = Repository(Database(tmp_path / "db"))
    repo.import_package(_sample_package())
    return repo


def _export_with(event: SearchEventRecord, package_id: str):
    package = _sample_package(package_id)
    package.search_events = [event]
    return package


def test_append_adds_only_new_terms_in_order_of_first_appearance(tmp_path):
    repo = _repo(tmp_path)
    repo.save_search_event(_walk(["HP:1", "HP:2"]))

    returned = repo.append_search_event_candidates(
        "walk-1", ["HP:3", "HP:2", "HP:4", "HP:3"]
    )

    assert returned is not None
    assert returned.candidates == ["HP:1", "HP:2", "HP:3", "HP:4"]
    stored = repo.get_search_event("walk-1")
    assert stored == returned
    assert stored.ranked_ids == ["HP:1", "HP:2", "HP:3", "HP:4"]
    assert stored.timestamp == "2026-10-08T10:00:00+00:00"

    # Nothing new: nothing changes.
    again = repo.append_search_event_candidates("walk-1", ["HP:4", "HP:1"])
    assert again == stored
    assert repo.get_search_event("walk-1") == stored


def test_append_to_an_unknown_event_returns_none_and_stores_nothing(tmp_path):
    repo = _repo(tmp_path)

    assert repo.append_search_event_candidates("nope", ["HP:1"]) is None
    assert repo.get_search_event("nope") is None


def test_parallel_appends_lose_no_term(tmp_path):
    repo = _repo(tmp_path)
    repo.save_search_event(_walk(["HP:0"]))
    batches = [[f"HP:{worker}-{step}" for step in range(5)] for worker in range(40)]

    with ThreadPoolExecutor(8) as pool:
        list(
            pool.map(
                lambda batch: repo.append_search_event_candidates("walk-1", batch),
                batches,
            )
        )

    stored = repo.get_search_event("walk-1")
    assert stored is not None
    assert len(stored.candidates) == 1 + 40 * 5
    assert set(stored.candidates) == {"HP:0", *(t for b in batches for t in b)}
    assert stored.ranked_ids == stored.candidates


def test_the_export_carries_the_grown_event(tmp_path):
    repo = _repo(tmp_path)
    repo.save_search_event(_walk(["HP:1"]))
    repo.append_search_event_candidates("walk-1", ["HP:2"])

    exported = ExportService(repo).for_workspace(key_for()).search_events

    assert [e.candidates for e in exported] == [["HP:1", "HP:2"]]


def test_an_earlier_export_of_the_same_walk_imports_and_the_longer_event_stays(
    tmp_path,
):
    repo = _repo(tmp_path)
    repo.save_search_event(_walk(["HP:1", "HP:2", "HP:3"]))

    repo.import_package(_export_with(_walk(["HP:1", "HP:2"]), "export-early"))

    stored = repo.get_search_event("walk-1")
    assert stored is not None
    assert stored.candidates == ["HP:1", "HP:2", "HP:3"]


def test_a_later_export_of_the_same_walk_replaces_the_shorter_event(tmp_path):
    repo = _repo(tmp_path)
    repo.import_package(_export_with(_walk(["HP:1", "HP:2"]), "export-early"))

    repo.import_package(_export_with(_walk(["HP:1", "HP:2", "HP:3"]), "export-late"))

    stored = repo.get_search_event("walk-1")
    assert stored is not None
    assert stored.candidates == ["HP:1", "HP:2", "HP:3"]
    assert stored.ranked_ids == ["HP:1", "HP:2", "HP:3"]
    # Both imported packages now hand out the later state.
    for package_id in ("export-early", "export-late"):
        events = repo.export_package(package_id).search_events
        assert [e.candidates for e in events] == [["HP:1", "HP:2", "HP:3"]]


@pytest.mark.parametrize(
    "incoming",
    [
        # Not the beginning of the stored list.
        _walk(["HP:1", "HP:9", "HP:3", "HP:4"]),
        # Same terms, but something else differs.
        _walk(["HP:1", "HP:2", "HP:3"], query="HP:0001252"),
        _walk(["HP:1", "HP:2", "HP:3"], annotation_id="ann-2"),
        # The two lists of one event disagree.
        _walk(["HP:1", "HP:2", "HP:3"], ranked_ids=["HP:1", "HP:3", "HP:2"]),
    ],
)
def test_a_different_walk_under_the_same_id_is_still_a_conflict(tmp_path, incoming):
    repo = _repo(tmp_path)
    repo.save_search_event(_walk(["HP:1", "HP:2"]))

    with pytest.raises(InvalidPackage):
        repo.import_package(_export_with(incoming, "export-conflict"))

    stored = repo.get_search_event("walk-1")
    assert stored is not None
    assert stored.candidates == ["HP:1", "HP:2"]
    assert repo.get_document("export-conflict", "doc-1") is None


@pytest.mark.parametrize("route", ["auto", "lexical"])
def test_a_search_event_never_grows_on_import(tmp_path, route):
    repo = _repo(tmp_path)
    repo.save_search_event(_walk(["HP:1", "HP:2"], route=route))

    with pytest.raises(InvalidPackage):
        repo.import_package(
            _export_with(_walk(["HP:1", "HP:2", "HP:3"], route=route), "export-x")
        )


def test_a_selection_made_from_a_walk_never_grows_on_import(tmp_path):
    repo = _repo(tmp_path)
    selection = {"selected_term_id": "HP:2", "event_id": "selection-1"}
    repo.save_search_event(_walk(["HP:1", "HP:2"], **selection))

    with pytest.raises(InvalidPackage):
        repo.import_package(
            _export_with(_walk(["HP:1", "HP:2", "HP:3"], **selection), "export-x")
        )


# --- beyond the plan: who may append, and the way through a package file ----


@pytest.mark.parametrize(
    "overrides",
    [
        {"route": "auto"},
        {"route": "lexical"},
        # The copy written for a selection made from a walk.
        {"selected_term_id": "HP:2"},
        # A search with the old "browse" route: it names the route that found
        # each candidate, and may score them. A walk does neither.
        {"candidate_routes": {"HP:1": "browse", "HP:2": "browse"}},
        {"candidate_scores": {"HP:1": 1.0}},
    ],
)
def test_only_a_walk_grows(tmp_path, overrides):
    repo = _repo(tmp_path)
    repo.save_search_event(_walk(["HP:1", "HP:2"], **overrides))

    assert repo.append_search_event_candidates("walk-1", ["HP:3"]) is None

    stored = repo.get_search_event("walk-1")
    assert stored is not None
    assert stored.candidates == ["HP:1", "HP:2"]
    assert stored.ranked_ids == ["HP:1", "HP:2"]


@pytest.mark.parametrize(
    "owner",
    [
        {"workspace_key": key_for("pkg-2")},
        {"annotation_id": "ann-2"},
        {"layer_id": "another-layer"},
    ],
)
def test_a_walk_grows_only_for_its_owner(tmp_path, owner):
    repo = _repo(tmp_path)
    walk = _walk(["HP:1"])
    repo.save_search_event(walk)
    own = {
        "workspace_key": walk.workspace_key,
        "annotation_id": walk.annotation_id,
        "layer_id": walk.layer_id,
    }

    refused = repo.append_search_event_candidates(
        "walk-1", ["HP:2"], **{**own, **owner}
    )

    assert refused is None
    stored = repo.get_search_event("walk-1")
    assert stored is not None
    assert stored.candidates == ["HP:1"]

    grown = repo.append_search_event_candidates("walk-1", ["HP:2"], **own)
    assert grown is not None
    assert grown.candidates == ["HP:1", "HP:2"]


@pytest.mark.parametrize(
    "incoming",
    [
        # Shown but not ranked, ranked but not shown, and two different tails.
        _walk(["HP:1", "HP:2", "HP:3"], ranked_ids=["HP:1", "HP:2"]),
        _walk(["HP:1", "HP:2"], ranked_ids=["HP:1", "HP:2", "HP:3"]),
        _walk(["HP:1", "HP:2", "HP:3"], ranked_ids=["HP:1", "HP:2", "HP:4"]),
    ],
)
def test_lists_that_did_not_grow_together_are_a_conflict(tmp_path, incoming):
    repo = _repo(tmp_path)
    repo.save_search_event(_walk(["HP:1", "HP:2"]))

    with pytest.raises(InvalidPackage):
        repo.import_package(_export_with(incoming, "export-conflict"))

    stored = repo.get_search_event("walk-1")
    assert stored is not None
    assert (stored.candidates, stored.ranked_ids) == (["HP:1", "HP:2"],) * 2


@pytest.mark.parametrize(
    ("stored", "incoming"),
    [
        # The added terms repeat one the walk had already shown ...
        (["HP:1", "HP:2"], ["HP:1", "HP:2", "HP:1"]),
        (["HP:1", "HP:2"], ["HP:1", "HP:2", "HP:3", "HP:2"]),
        # ... or one another. A walk lists every term once.
        (["HP:1", "HP:2"], ["HP:1", "HP:2", "HP:3", "HP:3"]),
        # The same, with the longer record being the stored one.
        (["HP:1", "HP:2", "HP:1"], ["HP:1", "HP:2"]),
        (["HP:1", "HP:2", "HP:3", "HP:3"], ["HP:1", "HP:2"]),
    ],
)
def test_a_walk_that_lists_a_term_twice_is_a_conflict(tmp_path, stored, incoming):
    repo = _repo(tmp_path)
    repo.save_search_event(_walk(stored))

    with pytest.raises(InvalidPackage):
        repo.import_package(_export_with(_walk(incoming), "export-conflict"))

    kept = repo.get_search_event("walk-1")
    assert kept is not None
    assert (kept.candidates, kept.ranked_ids) == (stored, stored)
    assert repo.get_document("export-conflict", "doc-1") is None


@pytest.mark.parametrize(
    "search",
    [
        # What POST /search with the old "browse" route stored: the route of
        # every candidate, with or without scores.
        {"candidate_routes": {"HP:1": "browse", "HP:2": "browse"}},
        {"candidate_scores": {"HP:1": 1.0, "HP:2": 0.5}},
        {
            "candidate_routes": {"HP:1": "browse", "HP:2": "browse"},
            "candidate_scores": {"HP:1": 1.0, "HP:2": 0.5},
        },
    ],
)
@pytest.mark.parametrize("longer", ["incoming", "stored"])
def test_a_search_with_the_old_browse_route_never_grows_on_import(
    tmp_path, search, longer
):
    short, long = ["HP:1", "HP:2"], ["HP:1", "HP:2", "HP:3"]
    stored, incoming = (short, long) if longer == "incoming" else (long, short)
    repo = _repo(tmp_path)
    repo.save_search_event(_walk(stored, **search))

    with pytest.raises(InvalidPackage):
        repo.import_package(_export_with(_walk(incoming, **search), "export-x"))

    kept = repo.get_search_event("walk-1")
    assert kept is not None
    assert kept.candidates == stored


def _through_a_file(package):
    """What a recipient reads from the package file."""
    buffer = io.BytesIO()
    PackageWriter.write_to_stream(package, buffer)
    buffer.seek(0)
    return PackageReader.read_from_stream(buffer)


@pytest.mark.parametrize("order", [("early", "late"), ("late", "early")])
def test_two_exports_of_a_growing_walk_import_in_either_order(tmp_path, order):
    source = _repo(tmp_path / "source")
    source.save_search_event(_walk(["HP:1", "HP:2"]))
    exports = {"early": _through_a_file(ExportService(source).for_workspace(key_for()))}
    source.append_search_event_candidates("walk-1", ["HP:3", "HP:4"])
    exports["late"] = _through_a_file(ExportService(source).for_workspace(key_for()))
    assert [e.candidates for e in exports["early"].search_events] == [["HP:1", "HP:2"]]

    recipient = Repository(Database(tmp_path / "recipient" / "db"))
    for name in order:
        recipient.import_package(exports[name])

    stored = recipient.get_search_event("walk-1")
    assert stored is not None
    assert stored.candidates == ["HP:1", "HP:2", "HP:3", "HP:4"]
    assert stored.ranked_ids == stored.candidates
    assert stored == source.get_search_event("walk-1")
    # Importing either file again changes nothing and is not a conflict.
    for name in order:
        recipient.import_package(exports[name])
    assert recipient.get_search_event("walk-1") == stored
    # And the source takes its own earlier export back without losing terms.
    source.import_package(exports["early"])
    kept = source.get_search_event("walk-1")
    assert kept is not None
    assert kept.candidates == ["HP:1", "HP:2", "HP:3", "HP:4"]
