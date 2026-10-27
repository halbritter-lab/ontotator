"""Consolidation progress for the read model: ``consolidation_progress``
gives ``(open, total)`` groups of a round under the consolidator's
decisions; ``open_group_count`` (submit gating) is its first part."""

from __future__ import annotations

from typing import Any

import pytest
from test_consolidation_resolve_api import build_round, group, mutate, ok, payload

from ontotator.application.consolidation import (
    consolidation_progress,
    open_group_count,
)
from ontotator.storage.repository import Repository


@pytest.fixture
def cons(tmp_path):
    return build_round(tmp_path)


def counts(ns: Any) -> tuple[tuple[int, int], int]:
    repo = Repository(ns.env.db)
    with ns.env.db.transaction() as conn:
        pid = repo._require_project(conn, "proj")
        decisions = repo._open_draft(conn, ns.round.workspace_key, None).decisions
        round_id = ns.round.round_id
        return (
            consolidation_progress(conn, pid, round_id, decisions),
            open_group_count(conn, pid, round_id, decisions),
        )


def test_progress_counts_open_and_total_groups(cons):
    # build_round: match (taken over automatically), term_differs,
    # values_differ, partial.
    assert counts(cons)[0] == (3, 4)
    ok(mutate(cons, "resolve", payload(group(cons, "partial"), "keep")))
    assert counts(cons)[0] == (2, 4)


def test_open_group_count_equals_progress_open(cons):
    ok(mutate(cons, "resolve", payload(group(cons, "values_differ"), "leave_out")))
    (open_count, _), gating = counts(cons)
    assert gating == open_count == 2
