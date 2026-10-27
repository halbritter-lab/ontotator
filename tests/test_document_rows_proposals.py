"""Rows carry proposals, modes and assignment dates (spec 2026-10-23 §2, §2b)."""

from __future__ import annotations

from typing import Any

from proposal_check_support import BASE, assign, proposal_env
from test_consolidation_resolve_api import build_round, group, inputs, mutate, ok

from ontotator.application.annotation_modes import load_text_mode
from ontotator.application.text_targets import (
    TextRow,
    text_documents,
    text_target_document,
)
from ontotator.storage.proposal_queries import newest_proposal_refs


def rows(env: Any, **params: Any) -> dict[tuple[str, str], dict[str, Any]]:
    response = env.lead.get(f"{BASE}/document-rows", params=params)
    assert response.status_code == 200, response.text
    return {
        (r["case_id"], r["language"]): r
        for g in response.json()["groups"]
        for r in g["rows"]
    }


def test_proposal_count_and_mode_before_assignment(tmp_path):
    env = proposal_env(tmp_path)
    found = rows(env)
    c1, c2 = found[("c1", "en")], found[("c2", "en")]
    assert c1["proposal_count"] == 3
    assert c1["annotation_mode"] == {
        "mode": "proposals",
        "source": "project",
        "locked": False,
        "override": None,
        "proposal_count": 3,
    }
    assert c2["proposal_count"] == 0
    assert c2["annotation_mode"]["source"] == "no_proposals"


def test_work_items_carry_assignment_date_assigner_and_mode(tmp_path):
    env = proposal_env(tmp_path)
    assign(env, env.c1, "anno")
    item = next(w for w in rows(env)[("c1", "en")]["work"] if w["task"] == "annotate")
    assert item["assigned_at"] is not None
    assert item["assigned_by"]["display_name"]  # the lead's name
    assert item["annotation_mode"] == "proposals"
    assert rows(env)[("c1", "en")]["annotation_mode"]["locked"] is True


def test_filter_with_and_without_tool_proposals(tmp_path):
    env = proposal_env(tmp_path)
    assert set(rows(env, proposals="with")) == {("c1", "en")}
    assert set(rows(env, proposals="without")) == {("c2", "en")}
    facets = env.lead.get(f"{BASE}/document-rows").json()["bar"]["facets"]["proposals"]
    assert facets == {"with": 1, "without": 1}


def _assert_rows_agree(env: Any) -> None:
    """R11: the read model's target, proposal count and mode equal the
    helpers every other WP uses (``text_targets``, ``load_text_mode``)."""
    found = rows(env)
    assert found
    with env.db.transaction() as conn:
        for (case_id, language), row in found.items():
            text = TextRow(case_id, language)
            target = text_target_document(conn, env.pid, text)
            assert target in text_documents(conn, env.pid, text)
            count = len(newest_proposal_refs(conn, env.pid, target))
            assert row["proposal_count"] == count, (case_id, language)
            if row["annotation_mode"] is None:
                continue
            mode = load_text_mode(conn, env.pid, target)
            assert (
                row["annotation_mode"]["mode"],
                row["annotation_mode"]["source"],
                row["annotation_mode"]["locked"],
                row["annotation_mode"]["proposal_count"],
            ) == (mode.mode, mode.source, mode.locked, count), (case_id, language)


def test_rows_agree_with_text_targets_and_load_text_mode(tmp_path):
    env = proposal_env(tmp_path)
    _assert_rows_agree(env)
    assign(env, env.c1, "anno")
    assign(env, env.c2, "anno")
    _assert_rows_agree(env)


def test_rows_with_translations_agree_with_text_targets(tmp_path):
    cons = build_round(tmp_path)
    _assert_rows_agree(cons.env)


def test_consolidation_progress_only_while_consolidating(tmp_path):
    env = proposal_env(tmp_path)
    assert rows(env)[("c1", "en")]["consolidation_progress"] is None


def test_consolidation_progress_counts_open_groups(tmp_path):
    cons = build_round(tmp_path)
    progress = rows(cons.env)[("c1", "en")]["consolidation_progress"]
    assert progress is not None
    assert progress["round_id"] == cons.round.round_id
    assert progress["total"] >= 1
    assert 1 <= progress["open"] <= progress["total"]
    partial = group(cons, "partial")
    ok(mutate(cons, "resolve", {"input_ids": inputs(partial), "action": "keep"}))
    after = rows(cons.env)[("c1", "en")]["consolidation_progress"]
    assert after == {**progress, "open": progress["open"] - 1}
    # Rows without an active consolidation round carry none.
    assert all(
        row["consolidation_progress"] is None
        for key, row in rows(cons.env).items()
        if key != ("c1", "en")
    )
