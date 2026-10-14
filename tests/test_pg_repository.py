"""The PostgreSQL repository: projects stay apart, history stays immutable."""

import hashlib
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from pg_harness import database_for
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from test_storage import _sample_package
from test_storage_regressions import key_for

from ontocurator.domain.documents import Document
from ontocurator.domain.errors import DomainError, InvalidPackage, RevisionConflict
from ontocurator.domain.review import ReviewTargetSet
from ontocurator.domain.workspace import (
    Draft,
    MutationEnvelope,
    Submission,
    WorkspaceKey,
)
from ontocurator.packages.models import SearchEventRecord, ValidatedPackage
from ontocurator.storage.database import TransactionRollbackOnly
from ontocurator.storage.repository import Repository, _key_str, _lock_id
from ontocurator.storage.tables import (
    DraftRow,
    MutationReceiptRow,
    SearchEventRow,
    StoredFileRow,
)


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


def _key(package_id: str = "pkg-a", annotator_id: str = "ann-1") -> WorkspaceKey:
    return WorkspaceKey(
        package_id=package_id,
        document_id="doc-1",
        annotator_id=annotator_id,
        mode="independent",
        target_set_id=ReviewTargetSet.create([]).target_set_id,
    )


def _envelope(mutation_id: str, expected: int) -> MutationEnvelope:
    return MutationEnvelope(
        mutation_id=mutation_id, expected_revision=expected, payload={}
    )


def _check(draft: Draft) -> Draft:
    draft.document_checked = True
    return draft


def _seeded(tmp_path: Path) -> Repository:
    repo = _repo(tmp_path)
    repo.import_package(_sample_package("pkg-a"))
    return repo


def test_a_draft_starts_at_revision_zero_and_each_write_counts(tmp_path: Path) -> None:
    repo = _seeded(tmp_path)

    assert repo.open_draft(_key()).revision == 0
    result = repo.run_mutation(_key(), _envelope("m1", 0), _check)

    assert isinstance(result, Draft) and result.revision == 1
    reopened = repo.open_draft(_key())
    assert reopened.revision == 1
    assert reopened.checked_layer_ids == ["hpo"]


def test_two_writers_on_one_revision_get_exactly_one_conflict(tmp_path: Path) -> None:
    repo = _seeded(tmp_path)
    repo.open_draft(_key())
    lock = threading.Lock()
    outcomes: list[str] = []

    def write(mutation_id: str) -> None:
        try:
            repo.run_mutation(_key(), _envelope(mutation_id, 0), _check)
            result = "ok"
        except RevisionConflict:
            result = "conflict"
        with lock:
            outcomes.append(result)

    with ThreadPoolExecutor(2) as pool:
        list(pool.map(write, ["first", "second"]))

    assert sorted(outcomes) == ["conflict", "ok"]
    assert repo.open_draft(_key()).revision == 1


def test_a_retry_replays_the_stored_answer_without_running_again(
    tmp_path: Path,
) -> None:
    repo = _seeded(tmp_path)
    first = repo.run_mutation(_key(), _envelope("m1", 0), _check)

    def must_not_run(_draft: Draft) -> Draft:
        raise AssertionError("a replay must not run the operation")

    assert repo.run_mutation(_key(), _envelope("m1", 0), must_not_run) == first


def test_a_reused_mutation_id_with_another_payload_is_a_conflict(
    tmp_path: Path,
) -> None:
    repo = _seeded(tmp_path)
    repo.run_mutation(_key(), _envelope("m1", 0), _check)
    other = MutationEnvelope(mutation_id="m1", expected_revision=0, payload={"x": 1})

    with pytest.raises(RevisionConflict, match="reused"):
        repo.run_mutation(_key(), other, _check)


def test_a_failing_operation_writes_nothing(tmp_path: Path) -> None:
    repo = _seeded(tmp_path)

    def broken(draft: Draft) -> Draft:
        draft.document_checked = True
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError, match="boom"):
        repo.run_mutation(_key(), _envelope("m1", 0), broken)

    draft = repo.open_draft(_key())
    assert (draft.revision, draft.checked_layer_ids) == (0, [])


def _submission(key: WorkspaceKey, revision: int) -> Submission:
    return Submission(
        submission_id=f"sub-{revision}",
        origin_key=key,
        targets=ReviewTargetSet.create([]),
        draft_revision=revision,
        snapshots=[],
        decisions=[],
        checked_layer_ids=["hpo"],
        created_at="2026-10-14T12:00:00Z",
    )


def test_a_submission_is_stored_and_cannot_be_changed(tmp_path: Path) -> None:
    repo = _seeded(tmp_path)
    submission = _submission(_key(), 1)

    repo.run_mutation(_key(), _envelope("submit", 0), lambda _d: submission)

    assert repo.get_submissions_for_workspace(_key()) == [submission]
    assert repo.get_submission("sub-1") == submission
    with (
        pytest.raises(DBAPIError, match="permission denied"),
        repo.db.transaction() as conn,
    ):
        conn.execute(text("UPDATE ontocurator.submissions SET mode = 'review'"))


def test_document_status_follows_drafts_and_submissions(tmp_path: Path) -> None:
    repo = _seeded(tmp_path)

    def status() -> str:
        return repo.get_document_status("pkg-a", "doc-1", "ann-1", "independent")

    assert status() == "not_started"
    repo.open_draft(_key())
    assert status() == "not_started"
    repo.run_mutation(_key(), _envelope("m1", 0), _check)
    assert status() == "in_progress"
    repo.run_mutation(_key(), _envelope("m2", 1), lambda _d: _submission(_key(), 2))
    assert status() == "completed"
    assert repo.list_workspace_keys("pkg-a", "ann-1") == [_key()]


def test_a_new_draft_resumes_the_latest_submission(tmp_path: Path) -> None:
    repo = _seeded(tmp_path)
    package = _sample_package("pkg-a")
    resumed = _submission(_key(), 7).model_copy(
        update={"snapshots": list(package.annotations.values())}
    )
    repo.run_mutation(_key(), _envelope("submit", 0), lambda _d: resumed)
    other_key = _key().model_copy(update={"target_set_id": "targets-0"})

    draft = repo.open_draft(other_key)

    assert draft.revision == 7
    assert draft.annotations == resumed.snapshots


def test_a_failure_in_the_callers_transaction_undoes_the_mutation(
    tmp_path: Path,
) -> None:
    repo = _seeded(tmp_path)

    with (
        pytest.raises(RuntimeError, match="later step failed"),
        repo.db.transaction(),
    ):
        repo.run_mutation(_key(), _envelope("m1", 0), _check)
        raise RuntimeError("later step failed")

    draft = repo.open_draft(_key())
    assert (draft.revision, draft.checked_layer_ids) == (0, [])
    with repo.db.transaction() as conn:
        assert (
            conn.execute(
                select(func.count()).select_from(MutationReceiptRow)
            ).scalar_one()
            == 0
        )


def test_a_retried_submission_replays_the_same_submission(tmp_path: Path) -> None:
    repo = _seeded(tmp_path)
    submission = _submission(_key(), 1)
    repo.run_mutation(_key(), _envelope("submit", 0), lambda _d: submission)

    def must_not_run(_draft: Draft) -> Draft:
        raise AssertionError("a replay must not run the operation")

    assert repo.run_mutation(_key(), _envelope("submit", 0), must_not_run) == submission


def test_a_local_submission_with_a_known_id_is_refused(tmp_path: Path) -> None:
    repo = _seeded(tmp_path)
    repo.run_mutation(_key(), _envelope("submit", 0), lambda _d: _submission(_key(), 1))
    other = _key(annotator_id="ann-2")

    with pytest.raises(IntegrityError):
        repo.run_mutation(
            other, _envelope("submit", 0), lambda _d: _submission(other, 1)
        )

    assert repo.get_submissions_for_workspace(other) == []


def test_opening_a_draft_waits_for_a_running_mutation(tmp_path: Path) -> None:
    repo = _seeded(tmp_path)
    held = threading.Event()
    release = threading.Event()

    def hold_the_draft_lock() -> None:
        with repo.db.engine.begin() as conn:
            conn.execute(
                select(
                    func.pg_advisory_xact_lock(
                        _lock_id("draft", "pkg-a", _key_str(_key()))
                    )
                )
            )
            held.set()
            release.wait(10)

    with ThreadPoolExecutor(2) as pool:
        holder = pool.submit(hold_the_draft_lock)
        assert held.wait(10)
        opening = pool.submit(repo.open_draft, _key())
        try:
            with pytest.raises(TimeoutError):
                opening.result(timeout=1)
        finally:
            release.set()
        holder.result(timeout=10)
        assert opening.result(timeout=10).revision == 0


def test_two_first_opens_of_one_draft_create_one_row(tmp_path: Path) -> None:
    repo = _seeded(tmp_path)

    with ThreadPoolExecutor(2) as pool:
        drafts = list(pool.map(lambda _i: repo.open_draft(_key()), range(2)))

    assert [d.revision for d in drafts] == [0, 0]
    with repo.db.transaction() as conn:
        assert (
            conn.execute(select(func.count()).select_from(DraftRow)).scalar_one() == 1
        )


def test_an_import_waits_for_a_writer_of_a_known_search_event(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    walk = _walk(["HP:1", "HP:2"])
    repo.import_package(_with_event("export-1", walk))
    held = threading.Event()
    release = threading.Event()

    def hold_the_event_row() -> None:
        with repo.db.engine.begin() as conn:
            conn.execute(
                select(SearchEventRow.event_id)
                .where(SearchEventRow.event_id == "walk-1")
                .with_for_update()
            )
            held.set()
            release.wait(10)

    with ThreadPoolExecutor(2) as pool:
        holder = pool.submit(hold_the_event_row)
        assert held.wait(10)
        importing = pool.submit(repo.import_package, _with_event("export-2", walk))
        try:
            with pytest.raises(TimeoutError):
                importing.result(timeout=1)
        finally:
            release.set()
        holder.result(timeout=10)
        assert importing.result(timeout=10) == "export-2"


def _project_walk(
    event_id: str, key: WorkspaceKey, candidates: list[str]
) -> SearchEventRecord:
    return SearchEventRecord(
        event_id=event_id,
        workspace_key=key,
        annotation_id="ann-1",
        query="",
        route="browse",
        candidates=candidates,
        ranked_ids=list(candidates),
        layer_id="hpo-layer",
        ontology_release="2026-06-23",
        index_identity="tree",
        timestamp="2026-10-14T12:00:00Z",
    )


def _copies(repo: Repository, event_id: str) -> list[list[str]]:
    with repo.db.transaction() as conn:
        stored = conn.execute(
            select(SearchEventRow.payload)
            .where(SearchEventRow.event_id == event_id)
            .order_by(SearchEventRow.project_id)
        ).scalars()
        return [SearchEventRecord.model_validate(p).candidates for p in stored]


def test_a_search_event_belongs_to_its_project(tmp_path: Path) -> None:
    repo = _seeded(tmp_path)
    repo.import_package(_sample_package("pkg-b"))
    event = _project_walk("walk-1", _key(), ["HP:0001252"])

    repo.save_search_event(event)

    assert repo.get_search_event("walk-1") == event
    assert repo.get_search_event("walk-1", "pkg-a") == event
    assert repo.get_search_event("walk-1", "pkg-b") is None
    assert repo.get_search_events_for_workspace(_key()) == [event]
    assert repo.get_search_events_for_workspace(_key("pkg-b")) == []


def test_a_walk_grows_only_for_its_owner(tmp_path: Path) -> None:
    repo = _seeded(tmp_path)
    repo.save_search_event(_project_walk("walk-1", _key(), ["HP:0001252"]))

    grown = repo.append_search_event_candidates(
        "walk-1", ["HP:0001250", "HP:0001252"], workspace_key=_key()
    )
    foreign = repo.append_search_event_candidates(
        "walk-1", ["HP:0000001"], workspace_key=_key(annotator_id="ann-2")
    )

    assert grown is not None
    assert grown.candidates == ["HP:0001252", "HP:0001250"]
    assert foreign is None
    stored = repo.get_search_event("walk-1", "pkg-a")
    assert stored is not None and stored.candidates == ["HP:0001252", "HP:0001250"]


def test_a_growing_walk_keeps_every_copy_of_its_id_equal(tmp_path: Path) -> None:
    repo = _seeded(tmp_path)
    walk = _project_walk("walk-1", _key(), ["HP:1"])
    repo.save_search_event(walk)
    repo.import_package(_with_event("pkg-b", walk))

    grown = repo.append_search_event_candidates(
        "walk-1", ["HP:2"], workspace_key=_key()
    )

    assert grown is not None and grown.candidates == ["HP:1", "HP:2"]
    assert _copies(repo, "walk-1") == [["HP:1", "HP:2"], ["HP:1", "HP:2"]]
    assert repo.get_search_event("walk-1") == grown
    assert (
        repo.append_search_event_candidates(
            "walk-1", ["HP:3"], workspace_key=_key("pkg-c")
        )
        is None
    )


def test_a_rejected_import_caught_in_a_callers_transaction_keeps_the_walk(
    tmp_path: Path,
) -> None:
    repo = _seeded(tmp_path)
    repo.save_search_event(_project_walk("walk-1", _key(), ["HP:1"]))
    # The longer walk is written to the stored copy before the changed
    # manifest is refused.
    changed = _with_event("pkg-a", _project_walk("walk-1", _key(), ["HP:1", "HP:2"]))
    changed.manifest.created_at = "2026-10-02T00:00:00Z"

    with (
        pytest.raises(TransactionRollbackOnly),
        repo.db.transaction(),
        pytest.raises(InvalidPackage, match="different manifest hash"),
    ):
        repo.import_package(changed)

    assert _copies(repo, "walk-1") == [["HP:1"]]


def test_an_append_waiting_for_an_import_grows_the_new_copy_too(
    tmp_path: Path,
) -> None:
    repo = _seeded(tmp_path)
    walk = _project_walk("walk-1", _key(), ["HP:1"])
    repo.save_search_event(walk)
    held = threading.Event()
    release = threading.Event()

    def import_and_hold() -> None:
        with repo.db.transaction():
            repo.import_package(_with_event("pkg-b", walk))
            held.set()
            release.wait(10)

    with ThreadPoolExecutor(2) as pool:
        importer = pool.submit(import_and_hold)
        assert held.wait(10)
        appending = pool.submit(
            repo.append_search_event_candidates,
            "walk-1",
            ["HP:2"],
            workspace_key=_key(),
        )
        try:
            with pytest.raises(TimeoutError):
                appending.result(timeout=1)
        finally:
            release.set()
        importer.result(timeout=10)
        grown = appending.result(timeout=10)

    assert grown is not None and grown.candidates == ["HP:1", "HP:2"]
    assert _copies(repo, "walk-1") == [["HP:1", "HP:2"], ["HP:1", "HP:2"]]


def test_an_import_waiting_for_an_append_keeps_the_new_terms(tmp_path: Path) -> None:
    repo = _seeded(tmp_path)
    walk = _project_walk("walk-1", _key(), ["HP:1"])
    repo.save_search_event(walk)
    held = threading.Event()
    release = threading.Event()

    def append_and_hold() -> None:
        with repo.db.transaction():
            repo.append_search_event_candidates(
                "walk-1", ["HP:2"], workspace_key=_key()
            )
            held.set()
            release.wait(10)

    with ThreadPoolExecutor(2) as pool:
        appender = pool.submit(append_and_hold)
        assert held.wait(10)
        importing = pool.submit(repo.import_package, _with_event("pkg-b", walk))
        try:
            with pytest.raises(TimeoutError):
                importing.result(timeout=1)
        finally:
            release.set()
        appender.result(timeout=10)
        assert importing.result(timeout=10) == "pkg-b"

    assert _copies(repo, "walk-1") == [["HP:1", "HP:2"], ["HP:1", "HP:2"]]


def test_an_export_contains_proposals_drafts_history_and_events(
    tmp_path: Path,
) -> None:
    repo = _seeded(tmp_path)
    package = _sample_package("pkg-a")
    repo.run_mutation(_key(), _envelope("m1", 0), _check)
    submission = _submission(_key(), 2)
    repo.run_mutation(_key(), _envelope("m2", 1), lambda _d: submission)
    event = _project_walk("walk-1", _key(), ["HP:0001252"])
    repo.save_search_event(event)

    exported = repo.export_package("pkg-a")

    assert exported.manifest == package.manifest
    assert exported.documents == package.documents
    assert exported.annotations == package.annotations
    assert exported.evidence == package.evidence
    assert exported.submissions == {"sub-2": submission}
    assert exported.search_events == [event]


def test_a_local_search_event_with_a_known_id_is_refused(tmp_path: Path) -> None:
    repo = _seeded(tmp_path)
    repo.import_package(_sample_package("pkg-b"))
    repo.save_search_event(_project_walk("walk-1", _key(), ["HP:1"]))

    for key in (_key(), _key("pkg-b")):
        with pytest.raises(DomainError, match="SEARCH_EVENT_EXISTS"):
            repo.save_search_event(_project_walk("walk-1", key, ["HP:2"]))

    assert _copies(repo, "walk-1") == [["HP:1"]]


def test_an_exported_project_imports_and_exports_unchanged(tmp_path: Path) -> None:
    repo = _seeded(tmp_path)
    repo.run_mutation(_key(), _envelope("m1", 0), _check)
    repo.run_mutation(_key(), _envelope("m2", 1), lambda _d: _submission(_key(), 2))
    repo.save_search_event(_project_walk("walk-1", _key(), ["HP:0001252"]))
    first = repo.export_package("pkg-a")
    first.manifest = first.manifest.model_copy(update={"package_id": "pkg-copy"})

    repo.import_package(first)
    second = repo.export_package("pkg-copy")

    assert second.manifest == first.manifest
    assert second.documents == first.documents
    assert second.annotations == first.annotations
    assert second.evidence == first.evidence
    assert second.submissions == first.submissions
    assert list(second.submissions) == ["sub-2"]
    assert second.search_events == first.search_events
    assert [e.event_id for e in second.search_events] == ["walk-1"]
    assert second.embedded_files == first.embedded_files
