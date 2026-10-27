"""Differential status traversal over identical in-memory query results."""

from contextlib import contextmanager
from types import SimpleNamespace

import pytest

from ontotator.api.document_projection import _legacy_statuses
from ontotator.domain.errors import DomainError
from ontotator.domain.review import ReviewTargetSet
from ontotator.domain.workspace import Submission, WorkspaceKey
from ontotator.storage.repository import Repository, _key_str


class QueryResults:
    def __init__(self, rows):
        self.rows = iter(rows)

    def execute(self, statement):
        rows = next(self.rows)
        return QueryResult(rows)


class QueryResult:
    def __init__(self, rows):
        self.rows = rows

    def all(self):
        return self.rows

    def __iter__(self):
        return iter(self.rows)


class MemoryTransaction:
    def __init__(self, conn):
        self.conn = conn

    @contextmanager
    def transaction(self):
        yield self.conn


@pytest.mark.parametrize("conflict_first", [False, True])
def test_metadata_status_matches_canonical_round_traversal(monkeypatch, conflict_first):
    active = WorkspaceKey(
        project_key="p",
        document_id="d",
        annotator_id="a",
        mode="review",
        scope_id="s",
        target_set_id="z-round" if conflict_first else "a-round",
    )
    conflicting = active.model_copy(
        update={"target_set_id": "a-round" if conflict_first else "z-round"}
    )
    draft = SimpleNamespace(
        id=1,
        draft_key=_key_str(active),
        document_id="d",
        mode="review",
        scope_id="s",
        target_set_id=active.target_set_id,
        revision=1,
        checked_layer_ids=[],
        has_content=False,
    )
    submissions = [
        Submission(
            submission_id=identifier,
            origin_key=conflicting,
            targets=ReviewTargetSet.create([]),
            draft_revision=1,
            snapshots=[],
            decisions=[],
            created_at="2026-10-15T00:00:00Z",
        )
        for identifier in ["first", "second"]
    ]
    old_conn = QueryResults(
        [
            [draft],
            [
                SimpleNamespace(
                    local_key=_key_str(conflicting),
                    payload=submission.model_dump(mode="json"),
                )
                for submission in submissions
            ],
            [],  # This regression exercises legacy work without an active-round binding.
        ]
    )
    old = Repository(MemoryTransaction(old_conn))
    monkeypatch.setattr(old, "get_task_profile", lambda key: None)
    monkeypatch.setattr(old, "_require_project", lambda conn, key: 1)
    new_conn = QueryResults(
        [
            [draft],
            [
                SimpleNamespace(
                    local_key=_key_str(conflicting),
                    draft_revision=submission.draft_revision,
                    origin=submission.origin_key.model_dump(mode="json"),
                )
                for submission in submissions
            ],
            [],
        ]
    )

    def existing():
        return old._document_statuses("p", "a", "review")

    def projected():
        return _legacy_statuses(
            MemoryTransaction(new_conn), new_conn, "p", 1, ["d"], "a", "review"
        )

    if conflict_first:
        for reader in [existing, projected]:
            with pytest.raises(DomainError, match="CONFLICTING_SUBMISSION_REVISION"):
                reader()
    else:
        assert existing() == projected() == {"d": "in_progress"}
