"""Dashboard progress preserves workspace semantics with bounded database work."""

from datetime import UTC, datetime
from pathlib import Path

import pytest
from pg_harness import database_for
from sqlalchemy import event, insert, select, update
from test_pg_repository import _document, _key, _submission
from test_project_scope import _access
from test_storage import _sample_package

from ontocurator.application.workspaces import WorkspaceService
from ontocurator.authz.scoped import ScopedRepository
from ontocurator.domain.errors import DomainError
from ontocurator.domain.review import ReviewTargetSet
from ontocurator.domain.scopes import build_scope
from ontocurator.storage.repository import Repository, _key_str
from ontocurator.storage.tables import (
    DraftAnnotationRow,
    DraftRow,
    ProjectRow,
    ReviewDecisionRow,
)


@pytest.mark.parametrize("count", [1, 1000])
@pytest.mark.parametrize("mode", ["independent", "assisted", "review"])
def test_dashboard_sql_is_bounded(tmp_path: Path, count: int, mode: str) -> None:
    repo = Repository(database_for(tmp_path / "db"))
    package = _sample_package("pkg-a")
    package.documents = {f"doc-{i}": _document(f"doc-{i}") for i in range(count)}
    package.annotations = {}
    package.evidence = {}
    repo.import_package(package)
    statements = []

    def record(*args: object) -> None:
        statements.append(args[2])

    event.listen(repo.db.engine, "before_cursor_execute", record)
    try:
        # Listing needs no ontology: only progress and proposal metadata.
        summaries = WorkspaceService(repo, None).list_documents(  # type: ignore[arg-type]
            "pkg-a", "ann-1", mode, reveal_review_inputs=mode == "review"
        )
    finally:
        event.remove(repo.db.engine, "before_cursor_execute", record)
    assert len(summaries) == count
    assert {s.status for s in summaries} == {"not_started"}
    assert all(
        s.has_review_inputs is (False if mode == "review" else None) for s in summaries
    )
    print(f"dashboard {mode} documents={count} SQL={len(statements)}")
    assert len(statements) <= 8


@pytest.mark.parametrize("mode", ["independent", "assisted", "review"])
def test_batch_status_keeps_origins_rounds_and_newer_drafts(
    tmp_path: Path, mode: str
) -> None:
    repo = Repository(database_for(tmp_path / "db"))
    package = _sample_package("pkg-a")
    scope = build_scope(package.manifest.task_profile, mode).scope_id
    key = _key().model_copy(update={"mode": mode, "scope_id": scope})
    targets = ReviewTargetSet.create([])
    key = key.model_copy(update={"target_set_id": targets.target_set_id})
    package.submissions = {
        "old": _submission(
            key.model_copy(update={"project_key": "origin"}), 2
        ).model_copy(update={"submission_id": "old"}),
        "latest": _submission(
            key.model_copy(update={"project_key": "origin"}), 7
        ).model_copy(update={"submission_id": "latest"}),
    }
    repo.import_package(package)
    assert repo.get_document_statuses("pkg-a", "ann-1", mode) == {"doc-1": "completed"}
    assert repo.get_document_statuses("pkg-a", "other", mode) == {}
    local = (
        key.model_copy(update={"target_set_id": "targets-0"})
        if mode == "independent"
        else key
    )
    repo.open_draft(local)
    assert repo.get_document_statuses("pkg-a", "ann-1", mode) == {"doc-1": "completed"}
    with repo.db.transaction() as conn:
        conn.execute(
            update(DraftRow)
            .where(DraftRow.draft_key == _key_str(local))
            .values(revision=8)
        )
    assert repo.get_document_statuses("pkg-a", "ann-1", mode) == {
        "doc-1": "in_progress"
    }


def test_batches_are_project_scoped(tmp_path: Path) -> None:
    repo = Repository(database_for(tmp_path / "db"))
    repo.import_package(_sample_package("pkg-a"))
    repo.import_package(_sample_package("pkg-b"))
    scoped = ScopedRepository(repo.db, _access({"pkg-a": {"annotator"}}))
    assert scoped.get_document_statuses("pkg-a", "ann-1", "independent") == {}
    assert scoped.review_input_document_ids("pkg-a") == {"doc-1"}
    for read in (
        lambda: scoped.get_document_statuses("pkg-b", "ann-1", "independent"),
        lambda: scoped.review_input_document_ids("pkg-b"),
    ):
        with pytest.raises(DomainError, match="PROJECT_NOT_FOUND"):
            read()


@pytest.mark.parametrize("fact", ["empty", "checked", "annotation", "decision"])
def test_revision_zero_content_counts_as_progress(tmp_path: Path, fact: str) -> None:
    repo = Repository(database_for(tmp_path / "db"))
    repo.import_package(_sample_package("pkg-a"))
    key = _key()
    repo.open_draft(key)
    with repo.db.transaction() as conn:
        draft_id = conn.execute(select(DraftRow.id)).scalar_one()
        if fact == "checked":
            conn.execute(update(DraftRow).values(checked_layer_ids=["hpo-layer"]))
        elif fact == "annotation":
            conn.execute(
                insert(DraftAnnotationRow).values(
                    draft_id=draft_id, annotation_id="a", version="v"
                )
            )
        elif fact == "decision":
            conn.execute(
                insert(ReviewDecisionRow).values(
                    draft_id=draft_id,
                    decision_id="decision",
                    position=0,
                    target_id="a",
                    target_version="v",
                    outcome="rejected",
                    reviewer_id="ann-1",
                    payload={},
                )
            )
    expected = "not_started" if fact == "empty" else "in_progress"
    assert repo.get_document_statuses("pkg-a", "ann-1", "independent") == {
        "doc-1": expected
    }
    assert (
        repo.get_document_status("pkg-a", "doc-1", "ann-1", "independent") == expected
    )


def test_multiple_origins_are_completed_until_a_local_draft_exists(
    tmp_path: Path,
) -> None:
    repo = Repository(database_for(tmp_path / "db"))
    package = _sample_package("pkg-a")
    package.submissions = {
        origin: _submission(_key(origin), revision).model_copy(
            update={"submission_id": origin}
        )
        for origin, revision in [("origin-a", 3), ("origin-b", 99)]
    }
    repo.import_package(package)
    with repo.db.transaction() as conn:
        project_id = conn.execute(select(ProjectRow.id)).scalar_one()
        key = _key().model_copy(
            update={
                "scope_id": build_scope(
                    package.manifest.task_profile, "independent"
                ).scope_id,
                "target_set_id": "targets-0",
            }
        )
        conn.execute(
            insert(DraftRow).values(
                project_id=project_id,
                draft_key=_key_str(key),
                document_id=key.document_id,
                annotator_id=key.annotator_id,
                mode=key.mode,
                scope_id=key.scope_id,
                target_set_id=key.target_set_id,
                targets=ReviewTargetSet.create([]).model_dump(),
                revision=0,
                updated_at=datetime.now(UTC),
            )
        )
    # A local revision cannot be compared to two unrelated origins.
    assert repo.get_document_statuses("pkg-a", "ann-1", "independent") == {
        "doc-1": "in_progress"
    }
    clean = Repository(database_for(tmp_path / "clean"))
    clean.import_package(package)
    assert clean.get_document_statuses("pkg-a", "ann-1", "independent") == {
        "doc-1": "completed"
    }


def test_review_round_progress_wins_over_a_completed_round(tmp_path: Path) -> None:
    repo = Repository(database_for(tmp_path / "db"))
    package = _sample_package("pkg-a")
    key = _key().model_copy(
        update={
            "mode": "review",
            "scope_id": build_scope(package.manifest.task_profile, "review").scope_id,
        }
    )
    package.submissions = {
        "done": _submission(key, 7).model_copy(update={"submission_id": "done"})
    }
    repo.import_package(package)
    second = key.model_copy(update={"target_set_id": "second-round"})
    repo.open_draft(second)
    assert repo.get_document_statuses("pkg-a", "ann-1", "review") == {
        "doc-1": "completed"
    }
    with repo.db.transaction() as conn:
        conn.execute(
            update(DraftRow)
            .where(DraftRow.draft_key == _key_str(second))
            .values(revision=1)
        )
    assert repo.get_document_statuses("pkg-a", "ann-1", "review") == {
        "doc-1": "in_progress"
    }
    assert repo.get_document_statuses("pkg-a", "ann-1", "assisted") == {}


def test_a_thousand_started_workspaces_still_use_bounded_sql(tmp_path: Path) -> None:
    repo = Repository(database_for(tmp_path / "db"))
    package = _sample_package("pkg-a")
    package.documents = {f"doc-{i}": _document(f"doc-{i}") for i in range(1000)}
    package.annotations = {}
    package.evidence = {}
    repo.import_package(package)
    with repo.db.transaction() as conn:
        project_id = conn.execute(select(ProjectRow.id)).scalar_one()
        conn.execute(
            insert(DraftRow),
            [
                dict(
                    project_id=project_id,
                    draft_key=_key_str(key),
                    document_id=key.document_id,
                    annotator_id=key.annotator_id,
                    mode=key.mode,
                    scope_id=key.scope_id,
                    target_set_id=key.target_set_id,
                    targets=ReviewTargetSet.create([]).model_dump(),
                    revision=1,
                    updated_at=datetime.now(UTC),
                )
                for key in [
                    _key().model_copy(update={"document_id": f"doc-{i}"})
                    for i in range(1000)
                ]
            ],
        )
    statements = []

    def record(*args: object) -> None:
        statements.append(args[2])

    event.listen(repo.db.engine, "before_cursor_execute", record)
    try:
        summaries = WorkspaceService(repo, None).list_documents(
            "pkg-a", "ann-1", "independent"
        )  # type: ignore[arg-type]
    finally:
        event.remove(repo.db.engine, "before_cursor_execute", record)
    assert len(summaries) == 1000
    assert {s.status for s in summaries} == {"in_progress"}
    print(f"dashboard started documents=1000 SQL={len(statements)}")
    assert len(statements) <= 8
