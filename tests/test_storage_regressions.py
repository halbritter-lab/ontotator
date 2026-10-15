import time
from concurrent.futures import ThreadPoolExecutor

from pg_harness import column_values, database_for, tamper
from support.v2_exports import ExportService
from test_storage import _sample_package

from ontocurator.domain.review import ReviewTargetSet
from ontocurator.domain.scopes import build_scope
from ontocurator.domain.workspace import MutationEnvelope, Submission, WorkspaceKey
from ontocurator.storage.repository import Repository


def key_for(project_key="pkg-1"):
    return WorkspaceKey(
        project_key=project_key,
        document_id="doc-1",
        annotator_id="a",
        mode="independent",
        scope_id=build_scope(
            _sample_package().manifest.task_profile, "independent"
        ).scope_id,
        target_set_id=ReviewTargetSet.create([]).target_set_id,
    )


def test_package_membership_does_not_follow_document_id(tmp_path):
    repo = Repository(database_for(tmp_path / "db"))
    first = _sample_package()
    empty = _sample_package("empty").model_copy(
        update={"annotations": {}, "evidence": {}}
    )
    repo.import_package(first)
    repo.import_package(empty)
    assert repo.list_annotations_for_document("empty", "doc-1") == []
    assert repo.export_package("empty").annotations == {}
    assert repo.export_package("empty").evidence == {}


def test_parallel_retry_runs_once(tmp_path):
    repo = Repository(database_for(tmp_path / "db"))
    repo.import_package(_sample_package())
    key = key_for()
    repo.open_draft(key)
    envelope = MutationEnvelope(mutation_id="same", expected_revision=0, payload={})
    calls = []

    def operation(draft):
        calls.append(1)
        time.sleep(0.1)
        return draft

    with ThreadPoolExecutor(2) as pool:
        results = list(
            pool.map(lambda _: repo.run_mutation(key, envelope, operation), range(2))
        )
    assert [r.revision for r in results] == [1, 1]
    assert len(calls) == 1


def test_imported_submission_has_local_binding_and_unique_export(tmp_path):
    repo = Repository(database_for(tmp_path / "db"))
    package = _sample_package()
    origin = key_for("original")
    submission = Submission(
        submission_id="s",
        origin_key=origin,
        targets=ReviewTargetSet.create([]),
        draft_revision=0,
        snapshots=list(package.annotations.values()),
        decisions=[],
        document_checked=True,
        created_at="now",
    )
    package.submissions["s"] = submission
    repo.import_package(package)
    assert repo.get_submissions_for_workspace(key_for()) == [submission]
    service = ExportService(repo)
    a, b = service.for_workspace(key_for()), service.for_workspace(key_for())
    assert a.manifest.package_id != b.manifest.package_id
    assert a.manifest.origin_manifest_hash
    assert a.submissions["s"].origin_key == origin
    assert a.annotations == package.annotations


def test_imported_submission_seeds_draft(tmp_path):
    repo = Repository(database_for(tmp_path / "db"))
    package = _sample_package()
    sub = Submission(
        submission_id="seed",
        origin_key=key_for("origin"),
        targets=ReviewTargetSet.create([]),
        draft_revision=8,
        snapshots=list(package.annotations.values()),
        decisions=[],
        document_checked=True,
        created_at="now",
    )
    package.submissions["seed"] = sub
    repo.import_package(package)
    draft = repo.open_draft(key_for())
    assert draft.annotations == sub.snapshots
    assert draft.revision == sub.draft_revision
    assert repo.open_draft(key_for()) == draft


def test_export_fails_on_missing_decision_dependency(tmp_path):
    import pytest

    from ontocurator.domain.annotations import AnnotationRef
    from ontocurator.domain.errors import DomainError
    from ontocurator.domain.review import ReviewDecision

    repo = Repository(database_for(tmp_path / "db"))
    package = _sample_package()
    decision = ReviewDecision(
        decision_id="decision",
        target=AnnotationRef(annotation_id="missing", version="missing"),
        outcome="rejected",
        reviewer_id="a",
    )
    sub = Submission(
        submission_id="broken",
        origin_key=key_for(),
        targets=ReviewTargetSet.create([]),
        draft_revision=0,
        snapshots=[],
        decisions=[decision],
        document_checked=True,
        created_at="now",
    )
    package.submissions["broken"] = sub
    repo.import_package(package)
    with pytest.raises(DomainError, match="missing"):
        ExportService(repo).for_workspace(key_for())


def test_imported_search_audit_survives_scoped_export(tmp_path):
    from ontocurator.packages.models import SearchEventRecord

    repo = Repository(database_for(tmp_path / "db"))
    package = _sample_package()
    event = SearchEventRecord(
        event_id="lookup",
        workspace_key=key_for("origin"),
        annotation_id="ann-1",
        query="hypotonia",
        route="lexical",
        candidates=["HP:0001252"],
        ontology_release="2026",
        index_identity="index",
        timestamp="now",
    )
    package.search_events = [event]
    repo.import_package(package)
    assert ExportService(repo).for_workspace(key_for()).search_events == [event]


def test_import_rejects_conflicting_existing_snapshot_atomically(tmp_path):
    import pytest

    from ontocurator.domain.errors import InvalidPackage

    repo = Repository(database_for(tmp_path / "db"))
    original = _sample_package()
    repo.import_package(original)
    conflicting = _sample_package("conflicting")
    snap = next(iter(conflicting.annotations.values()))
    snap.annotation.term_id = "HP:9999999"
    with pytest.raises(InvalidPackage):
        repo.import_package(conflicting)
    assert repo.get_document("conflicting", "doc-1") is None
    assert repo.export_package("pkg-1").annotations == original.annotations


def test_independent_import_resumes_at_default_api_key(tmp_path):
    for historical_target in (ReviewTargetSet.create([]).target_set_id, "targets-0"):
        repo = Repository(database_for(tmp_path / historical_target))
        package = _sample_package()
        origin = key_for("origin").model_copy(
            update={"target_set_id": historical_target}
        )
        sub = Submission(
            submission_id="resume",
            origin_key=origin,
            targets=ReviewTargetSet.create([]),
            draft_revision=8,
            snapshots=list(package.annotations.values()),
            decisions=[],
            document_checked=True,
            created_at="now",
        )
        package.submissions[sub.submission_id] = sub
        repo.import_package(package)
        api_key = key_for().model_copy(update={"target_set_id": "targets-0"})
        assert repo.get_submissions_for_workspace(api_key) == [sub]
        assert repo.open_draft(api_key).annotations == sub.snapshots
        assert repo.get_submissions_for_workspace(key_for()) == [sub]
        assert repo.get_submission("resume").origin_key == origin
        (local_key,) = column_values(repo, "submissions", "local_key")
        assert local_key.endswith(":targets-0")
        # Earlier databases can still contain the pre-fix canonical binding.
        from ontocurator.storage.repository import _key_str

        tamper(
            repo.db,
            "submissions",
            "UPDATE ontocurator.submissions SET local_key = :k",
            k=_key_str(key_for()),
        )
        assert repo.get_submissions_for_workspace(api_key) == [sub]


def _evidence_edit(package, end):
    """An edit that sets the draft's only annotation to evidence ending at ``end``."""
    from ontocurator.domain.annotations import snapshot
    from ontocurator.domain.documents import (
        EvidenceMention,
        EvidenceRef,
        EvidenceSnapshot,
        Segment,
    )

    doc = package.documents["doc-1"]
    ev = EvidenceSnapshot.create(
        mention=EvidenceMention(
            evidence_id="ev-1", segments=[Segment(start=17, end=end)]
        ),
        document=doc,
    )
    base = next(iter(package.annotations.values())).annotation
    ann = base.model_copy(
        update={"evidence_refs": [EvidenceRef(evidence_id="ev-1", version=ev.version)]}
    )
    snap = snapshot(ann, [ev], doc, package.manifest.task_profile)

    def operation(draft):
        draft.annotations = [snap]
        draft.evidence = [ev]
        return draft

    return operation, snap, ev


def test_export_reads_one_snapshot_while_an_evidence_edit_commits(tmp_path):
    import io
    import threading

    from sqlalchemy import event
    from support.v2_writer import write_package_to_stream

    db = database_for(tmp_path / "db")
    repo = Repository(db)
    package = _sample_package()
    repo.import_package(package.model_copy(update={"annotations": {}, "evidence": {}}))
    key = key_for()
    repo.open_draft(key, ReviewTargetSet.create([]))
    first, first_snap, first_ev = _evidence_edit(package, 26)
    second, _, second_ev = _evidence_edit(package, 25)
    assert first_ev.version != second_ev.version
    repo.run_mutation(
        key, MutationEnvelope(mutation_id="m1", expected_revision=0, payload={}), first
    )

    reader = threading.get_ident()
    edits = []

    def commit_edit_before_the_evidence_read(
        conn, cursor, statement, parameters, context, executemany
    ):
        if (
            threading.get_ident() != reader
            or edits
            or "FROM ontocurator.evidence_snapshots" not in statement
        ):
            return
        envelope = MutationEnvelope(mutation_id="m2", expected_revision=1, payload={})
        worker = threading.Thread(
            target=lambda: edits.append(repo.run_mutation(key, envelope, second))
        )
        worker.start()
        worker.join()

    event.listen(
        db.engine, "before_cursor_execute", commit_edit_before_the_evidence_read
    )
    try:
        exported = repo.export_package("pkg-1")
    finally:
        event.remove(
            db.engine, "before_cursor_execute", commit_edit_before_the_evidence_read
        )

    assert len(edits) == 1  # the edit committed between the two reads
    write_package_to_stream(exported, io.BytesIO())
    assert set(exported.annotations) == {("ann-1", first_snap.version)}
    assert set(exported.evidence) == {("ev-1", first_ev.version)}


def test_export_inside_a_read_committed_transaction_is_refused(tmp_path):
    import pytest

    from ontocurator.storage.database import SnapshotUnavailable

    db = database_for(tmp_path / "db")
    repo = Repository(db)
    repo.import_package(_sample_package())

    with pytest.raises(SnapshotUnavailable), db.transaction():
        repo.export_package("pkg-1")
    with db.snapshot():
        assert set(repo.export_package("pkg-1").annotations) == set(
            _sample_package().annotations
        )
