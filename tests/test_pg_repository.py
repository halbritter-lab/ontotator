"""The PostgreSQL repository: projects stay apart, history stays immutable."""

import hashlib
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from pg_harness import database_for
from sqlalchemy import func, select
from test_storage import _sample_package
from test_storage_regressions import key_for

from ontocurator.domain.documents import Document
from ontocurator.domain.errors import DomainError, InvalidPackage
from ontocurator.packages.models import SearchEventRecord, ValidatedPackage
from ontocurator.storage.repository import Repository, _lock_id
from ontocurator.storage.tables import SearchEventRow, StoredFileRow


def _repo(tmp_path: Path) -> Repository:
    return Repository(database_for(tmp_path / "editor.db"))


def _document(document_id: str) -> Document:
    text = f"Text of {document_id}."
    return Document(
        document_id=document_id,
        text=text,
        language="en",
        text_sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(),
    )


def test_a_seed_package_becomes_a_project(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    package = _sample_package("pkg-a")

    assert repo.import_package(package) == "pkg-a"

    assert repo.get_manifest("pkg-a") == package.manifest
    assert repo.manifest_hash("pkg-a") == Repository.package_manifest_hash(package)
    assert repo.get_task_profile("pkg-a") == package.manifest.task_profile
    assert repo.list_documents("pkg-a") == list(package.documents.values())
    assert repo.list_annotations_for_document("pkg-a", "doc-1") == list(
        package.annotations.values()
    )


def test_importing_the_same_package_again_changes_nothing(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    package = _sample_package("pkg-a")

    repo.import_package(package)
    repo.import_package(package)

    assert [m.package_id for m in repo.list_manifests()] == ["pkg-a"]


def test_a_changed_package_under_a_known_key_is_refused(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    repo.import_package(_sample_package("pkg-a"))
    changed = _sample_package("pkg-a")
    changed.manifest.created_at = "2026-10-02T00:00:00Z"

    with pytest.raises(InvalidPackage, match="different manifest hash"):
        repo.import_package(changed)


def test_projects_do_not_see_each_others_content(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    repo.import_package(_sample_package("pkg-a"))
    repo.import_package(
        _sample_package("pkg-b").model_copy(update={"annotations": {}, "evidence": {}})
    )

    assert repo.list_annotations_for_document("pkg-b", "doc-1") == []
    assert repo.get_document("pkg-c", "doc-1") is None
    with pytest.raises(DomainError, match="PACKAGE_NOT_FOUND"):
        repo.get_task_profile("pkg-c")


def test_documents_follow_the_declared_order_then_their_ids(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    package = _sample_package("pkg-a").model_copy(
        update={
            "annotations": {},
            "evidence": {},
            "documents": {d: _document(d) for d in ("doc-b", "doc-a", "doc-c")},
        }
    )
    package.manifest.document_order = ["doc-c"]

    repo.import_package(package)

    assert [d.document_id for d in repo.list_documents("pkg-a")] == [
        "doc-c",
        "doc-a",
        "doc-b",
    ]


def test_embedded_files_are_stored_once_on_the_data_volume(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    package = _sample_package("pkg-a")
    package.embedded_files = {"ontologies/a.json": b"{}", "ontologies/b.json": b"{}"}

    repo.import_package(package)

    assert repo.get_embedded_files("pkg-a") == {
        "ontologies/a.json": b"{}",
        "ontologies/b.json": b"{}",
    }
    with repo.db.transaction() as conn:
        assert conn.execute(select(StoredFileRow.sha256)).scalars().all() == [
            hashlib.sha256(b"{}").hexdigest()
        ]


def test_a_failed_import_leaves_nothing_behind(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _repo(tmp_path)

    def fail(*_args: object) -> None:
        raise RuntimeError("simulated failure")

    monkeypatch.setattr(Repository, "_store_resources", fail)

    with pytest.raises(RuntimeError, match="simulated failure"):
        repo.import_package(_sample_package("pkg-a"))

    assert repo.list_manifests() == []
    assert repo.get_document("pkg-a", "doc-1") is None


def _walk(candidates: list[str]) -> SearchEventRecord:
    return SearchEventRecord.model_validate(
        {
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
    )


def _with_event(package_id: str, event: SearchEventRecord) -> ValidatedPackage:
    package = _sample_package(package_id)
    package.search_events = [event]
    return package


@pytest.mark.parametrize("first_length", [3, 2], ids=["longer-first", "shorter-first"])
def test_every_copy_of_a_tree_walk_keeps_the_longest_state(
    tmp_path: Path, first_length: int
) -> None:
    repo = _repo(tmp_path)
    terms = ["HP:1", "HP:2", "HP:3"]

    repo.import_package(_with_event("export-1", _walk(terms[:first_length])))
    repo.import_package(_with_event("export-2", _walk(terms[: 5 - first_length])))

    with repo.db.transaction() as conn:
        stored = conn.execute(
            select(SearchEventRow.payload).where(SearchEventRow.event_id == "walk-1")
        ).scalars()
        copies = [SearchEventRecord.model_validate(p) for p in stored]
    assert [c.candidates for c in copies] == [terms, terms]
    assert [c.ranked_ids for c in copies] == [terms, terms]


def test_imports_of_different_projects_wait_for_each_other(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    held = threading.Event()
    release = threading.Event()

    def hold_the_import_lock() -> None:
        with repo.db.engine.begin() as conn:
            conn.execute(select(func.pg_advisory_xact_lock(_lock_id("import"))))
            held.set()
            release.wait(10)

    with ThreadPoolExecutor(2) as pool:
        holder = pool.submit(hold_the_import_lock)
        assert held.wait(10)
        importing = pool.submit(repo.import_package, _sample_package("pkg-a"))
        try:
            with pytest.raises(TimeoutError):
                importing.result(timeout=1)
        finally:
            release.set()
        holder.result(timeout=10)
        assert importing.result(timeout=10) == "pkg-a"
