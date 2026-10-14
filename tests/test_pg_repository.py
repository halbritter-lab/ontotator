"""The PostgreSQL repository: projects stay apart, history stays immutable."""

import hashlib
from pathlib import Path

import pytest
from pg_harness import database_for
from sqlalchemy import select
from test_storage import _sample_package

from ontocurator.domain.documents import Document
from ontocurator.domain.errors import DomainError, InvalidPackage
from ontocurator.storage.repository import Repository
from ontocurator.storage.tables import StoredFileRow


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
