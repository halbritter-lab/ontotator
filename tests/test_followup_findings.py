"""Regression tests for the follow-up review findings."""

from __future__ import annotations

import threading
from pathlib import Path

import pytest
from test_storage import _sample_package

from ontocurator.application.exports import ExportService
from ontocurator.domain.review import ReviewTargetSet
from ontocurator.domain.scopes import build_scope
from ontocurator.domain.workspace import (
    Draft,
    MutationEnvelope,
    Submission,
    WorkspaceKey,
)
from ontocurator.packages.models import SearchEventRecord
from ontocurator.storage import sqlite_repository as repository_module
from ontocurator.storage.sqlite_database import Database
from ontocurator.storage.sqlite_repository import Repository

# --- Finding 1: legacy ':'-joined workspace keys stay reachable ------------ #


def _colon_key() -> WorkspaceKey:
    return WorkspaceKey(
        package_id="pkg-1",
        document_id="doc-1",
        annotator_id="orcid:0000-0001",
        mode="independent",
        scope_id=build_scope(
            _sample_package().manifest.task_profile, "independent"
        ).scope_id,
        target_set_id=ReviewTargetSet.create([]).target_set_id,
    )


def _legacy_key_str(key: WorkspaceKey) -> str:
    """Exactly how v4 builds before the escaped encoding persisted keys."""
    return ":".join(
        [
            key.package_id,
            key.document_id,
            key.annotator_id,
            key.mode,
            key.scope_id,
            key.target_set_id,
        ]
    )


def _search_event(key: WorkspaceKey) -> SearchEventRecord:
    return SearchEventRecord(
        event_id="evt-legacy",
        workspace_key=key,
        annotation_id="ann-1",
        query="hypotonia",
        route="exact",
        candidates=["HP:0001252"],
        ontology_release="2026-01-01",
        index_identity="idx",
        timestamp="2026-01-01T00:00:00+00:00",
    )


def _write_legacy_workspace(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> tuple[Path, WorkspaceKey, Submission]:
    db_path = tmp_path / "editor.db"
    package = _sample_package()
    key = _colon_key()
    with monkeypatch.context() as patch:
        patch.setattr(repository_module, "_key_str", _legacy_key_str)
        db = Database(db_path)
        repo = Repository(db)
        repo.import_package(package)
        repo.open_draft(key)

        def add_annotation(draft: Draft) -> Draft:
            draft.annotations = list(package.annotations.values())
            draft.evidence = list(package.evidence.values())
            return draft

        repo.run_mutation(
            key,
            MutationEnvelope(mutation_id="m-1", expected_revision=0, payload={}),
            add_annotation,
        )
        submission = Submission(
            submission_id="sub-legacy",
            origin_key=key,
            targets=ReviewTargetSet.create([]),
            draft_revision=2,
            snapshots=list(package.annotations.values()),
            decisions=[],
            created_at="2026-01-01T00:00:01+00:00",
        )
        repo.run_mutation(
            key,
            MutationEnvelope(mutation_id="m-2", expected_revision=1, payload={}),
            lambda _draft: submission,
        )
        repo.save_search_event(_search_event(key))
        db.close()
    stored = Database(db_path).get_connection()
    assert [r[0] for r in stored.execute("SELECT workspace_key FROM workspaces")] == [
        _legacy_key_str(key)
    ]
    stored.close()
    return db_path, key, submission


def test_legacy_colon_workspace_key_is_found_and_migrated(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path, key, submission = _write_legacy_workspace(tmp_path, monkeypatch)
    repo = Repository(Database(db_path))

    assert repo.get_submissions_for_workspace(key) == [submission]
    assert [e.event_id for e in repo.get_search_events_for_workspace(key)] == [
        "evt-legacy"
    ]

    draft = repo.open_draft(key)
    assert draft.revision == 2
    assert [a.annotation.annotation_id for a in draft.annotations] == ["ann-1"]
    assert len(draft.evidence) == 1

    conn = repo.db.get_connection()
    rows = conn.execute("SELECT workspace_key FROM workspaces").fetchall()
    assert [r[0] for r in rows] == [repository_module._key_str(key)]
    for table in ("workspace_annotations", "workspace_evidence", "mutation_receipts"):
        legacy_rows = conn.execute(
            f"SELECT COUNT(*) FROM {table} WHERE workspace_key = ?",
            (_legacy_key_str(key),),
        ).fetchone()[0]
        assert legacy_rows == 0, table

    # Idempotency receipts moved with the workspace: replay, not a conflict.
    replay = repo.run_mutation(
        key,
        MutationEnvelope(mutation_id="m-1", expected_revision=0, payload={}),
        lambda d: d,
    )
    assert isinstance(replay, Draft) and replay.revision == 1

    status = repo.get_document_status("pkg-1", "doc-1", key.annotator_id, key.mode)
    assert status == "completed"

    service = ExportService(repo)
    exported = service.for_workspace(key)
    assert set(exported.submissions) == {"sub-legacy"}
    assert [e.event_id for e in exported.search_events] == ["evt-legacy"]
    package_export = service.for_package("pkg-1", key.annotator_id)
    assert set(package_export.submissions) == {"sub-legacy"}
    assert [e.event_id for e in package_export.search_events] == ["evt-legacy"]
    assert repo.list_workspace_keys("pkg-1", key.annotator_id) == [key]


def test_mutation_on_legacy_key_does_not_create_second_workspace(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path, key, _ = _write_legacy_workspace(tmp_path, monkeypatch)
    repo = Repository(Database(db_path))
    # First access after the upgrade is a mutation, not an open.
    result = repo.run_mutation(
        key,
        MutationEnvelope(mutation_id="m-3", expected_revision=2, payload={}),
        lambda d: d,
    )
    assert isinstance(result, Draft)
    assert result.revision == 3
    assert [a.annotation.annotation_id for a in result.annotations] == ["ann-1"]
    count = repo.db.get_connection().execute("SELECT COUNT(*) FROM workspaces")
    assert count.fetchone()[0] == 1


def test_empty_duplicate_from_unfixed_build_is_replaced_by_legacy_row(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path, key, _ = _write_legacy_workspace(tmp_path, monkeypatch)
    db = Database(db_path)
    conn = db.get_connection()
    # A build without the fallback inserted an empty row under the new key.
    conn.execute(
        "INSERT INTO workspaces SELECT ?, package_id, document_id, annotator_id, "
        "mode, scope_id, target_set_id, targets_json, 0, '[]', updated_at "
        "FROM workspaces WHERE workspace_key = ?",
        (repository_module._key_str(key), _legacy_key_str(key)),
    )
    repo = Repository(db)
    draft = repo.open_draft(key)
    assert draft.revision == 2
    assert [a.annotation.annotation_id for a in draft.annotations] == ["ann-1"]
    assert conn.execute("SELECT COUNT(*) FROM workspaces").fetchone()[0] == 1


def test_legacy_row_of_other_colliding_key_is_not_adopted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path, key, _ = _write_legacy_workspace(tmp_path, monkeypatch)
    # Same ':'-joined string, different components.
    other = key.model_copy(
        update={"document_id": "doc-1:orcid", "annotator_id": "0000-0001"}
    )
    assert _legacy_key_str(other) == _legacy_key_str(key)
    repo = Repository(Database(db_path))
    draft = repo.open_draft(other)
    assert draft.revision == 0
    assert draft.annotations == []
    assert repo.open_draft(key).revision == 2


# --- Finding 2/3: package export loads once and keeps resubmissions --------- #


def _submit(repo: Repository, key: WorkspaceKey, revision: int, sub_id: str) -> None:
    package = _sample_package()
    repo.run_mutation(
        key,
        MutationEnvelope(
            mutation_id=f"{sub_id}-submit", expected_revision=revision, payload={}
        ),
        lambda draft: Submission(
            submission_id=sub_id,
            origin_key=key,
            targets=draft.targets,
            draft_revision=draft.revision + 1,
            snapshots=list(package.annotations.values()),
            decisions=[],
            created_at=f"2026-01-01T00:00:0{revision}+00:00",
        ),
    )


def test_package_export_loads_package_once_and_keeps_resubmissions(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = Repository(Database(tmp_path / "db"))
    repo.import_package(_sample_package())
    independent = _colon_key().model_copy(update={"annotator_id": "a"})
    review = WorkspaceKey(
        package_id="pkg-1",
        document_id="doc-1",
        annotator_id="a",
        mode="review",
        scope_id=build_scope(
            _sample_package().manifest.task_profile, "review"
        ).scope_id,
        target_set_id=ReviewTargetSet.create([]).target_set_id,
    )
    for key in (independent, review):
        repo.open_draft(key)
    _submit(repo, independent, 0, "sub-first")
    _submit(repo, independent, 1, "sub-resubmit")

    calls: list[str] = []
    original = repo.export_package

    def counting(package_id: str, *, include_captured_conditions: bool = True):  # type: ignore[no-untyped-def]
        calls.append(package_id)
        return original(
            package_id, include_captured_conditions=include_captured_conditions
        )

    monkeypatch.setattr(repo, "export_package", counting)
    exported = ExportService(repo).for_package("pkg-1", "a")
    assert calls == ["pkg-1"]
    assert len(repo.list_workspace_keys("pkg-1", "a")) == 2

    # Resubmissions stay in the export (audit trail); the latest one per
    # workspace is the one with the highest draft_revision.
    subs = sorted(exported.submissions.values(), key=lambda s: s.draft_revision)
    assert [s.submission_id for s in subs] == ["sub-first", "sub-resubmit"]
    assert subs[0].origin_key == subs[1].origin_key
    assert subs[0].draft_revision < subs[1].draft_revision
    assert subs[0].created_at < subs[1].created_at


# --- Finding 8: ontology parsing does not hold the shared registry lock ---- #


def test_registry_parses_outside_shared_lock_and_only_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from ontocurator.ontology import registry as registry_module
    from ontocurator.ontology.registry import OntologyRegistry

    hp = Path(__file__).parent / "fixtures" / "hp.json"
    reg = OntologyRegistry()
    sha = reg.register_path(hp)
    original_load = registry_module.OntologyService.load
    started = threading.Event()
    release = threading.Event()
    loads: list[Path] = []

    def slow_load(path, ref, **kwargs):  # type: ignore[no-untyped-def]
        loads.append(path)
        started.set()
        assert release.wait(10)
        return original_load(path, ref, **kwargs)

    monkeypatch.setattr(registry_module.OntologyService, "load", slow_load)
    results: list[object] = []
    workers = [
        threading.Thread(target=lambda: results.append(reg.get_service(sha)))
        for _ in range(2)
    ]
    for w in workers:
        w.start()
    assert started.wait(10)

    # While one ontology is being parsed other requests are not blocked.
    probe = threading.Thread(target=lambda: results.append(reg.has_ontology(sha)))
    probe.start()
    probe.join(2)
    blocked = probe.is_alive()
    release.set()
    for w in workers:
        w.join(10)
    probe.join(10)
    assert not blocked, "shared registry lock held during parsing"
    services = [r for r in results if r is not True]
    assert len(services) == 2 and services[0] is services[1]
    assert len(loads) == 1


# --- Finding 10: verified adoption stores the primary term id ------------- #


def test_verified_adoption_normalizes_term_id_and_keeps_source(
    tmp_path: Path,
) -> None:
    from test_review_findings import _Session

    session = _Session(tmp_path, with_source_term="hp:0001252")
    draft = session.apply(
        command="create_annotation",
        annotation_id="a-1",
        term_id="hp:0001252",
        source_annotation_id="src-1",
        source_version=session.source.version,
    )
    ann = draft.annotations[0].annotation
    assert ann.term_id == "HP:0001252"
    assert ann.provenance.source_refs == [f"src-1:{session.source.version}"]
