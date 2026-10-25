"""Modifier segments on the text-change carry path (modifiers plan M1b, R9).

Moving a draft to a corrected text freezes it and creates a ``text_change``
round (``work_rounds.py`` round creation, the carry path ``text_changes.py``
uses). The modifiers are written into the draft directly: the modifier
editing commands are M1's, and carrying never consults the ontology.
"""

from __future__ import annotations

from typing import Any

from browser_carry_fixture import (
    CORRECTED_DE,
    HYPOTONIA,
    HYPOTONIA_SPAN,
    TEXT_DE,
    _create,
    _span,
)
from browser_documents_scenarios import assign, start_round
from sqlalchemy import delete
from test_text_change_service import Env, _env, _move, _pid, _scoped
from test_text_change_service import app as app

from ontocurator.domain.annotations import Modifier, snapshot
from ontocurator.domain.documents import Segment
from ontocurator.storage.repository import Repository, _key_str
from ontocurator.storage.tables import DraftAnnotationRow, DraftEvidenceRow

SEVERE = "HP:0012828"
RECURRENT = "HP:0031796"


def _hypotonia_with(env: Env, modifier_text: str) -> dict[str, Any]:
    """tom marks Hypotonia on v1 with Severe on ``modifier_text`` and a
    spanless Recurrent."""
    assignment_id = assign(env.scenario, env.docs[0], "tom", "annotate")
    started = start_round(env.scenario, assignment_id, "tom")
    key = started.workspace_key
    _create(env.scenario, "tom", key, HYPOTONIA, span=_span(TEXT_DE, HYPOTONIA_SPAN))
    start = TEXT_DE.index(modifier_text)
    modifiers = [
        Modifier(
            term_id=SEVERE,
            segments=[Segment(start=start, end=start + len(modifier_text))],
        ),
        Modifier(term_id=RECURRENT),
    ]
    repo = env.repo
    document = repo.get_document(env.key, env.docs[0])
    profile = repo.get_task_profile(env.key)
    pid = _pid(env)
    with env.db.transaction() as conn:
        draft = repo._open_draft(conn, key, None)
        [own] = draft.annotations
        changed = snapshot(
            own.annotation.model_copy(update={"modifiers": modifiers}),
            own.evidence,
            document,
            profile,
        )
        row = repo._draft_row(conn, pid, _key_str(key))
        for table in (DraftAnnotationRow, DraftEvidenceRow):
            conn.execute(delete(table).where(table.draft_id == row.id))
        Repository._insert_snapshots(conn, pid, [changed], draft.evidence)
        Repository._write_draft_content(
            conn, row.id, [changed], draft.evidence, draft.decisions
        )
    return {"assignment_id": assignment_id, "key": key}


def _preview(env: Env, assignment_id: int) -> Any:
    access, actor = env.lead()
    return env.service().preview(
        access,
        actor,
        env.key,
        assignment_id=assignment_id,
        submission_id=None,
        target_document_id=env.docs[1],
    )


def test_text_change_carries_mapped_modifier_segments(app):
    env = _env(app)
    # "Untersuchung" follows the corrected sentence: its offsets shift.
    work = _hypotonia_with(env, "Untersuchung")
    preview = _preview(env, work["assignment_id"])
    assert (preview.placed, preview.unplaced) == (1, 0)
    result = _move(env, work["assignment_id"])
    [item] = env.repo.get_round_input_inventory(env.key, result.round.round_id)
    assert item["mapping_status"] == "carried"
    draft = _scoped(env, "tom").open_draft(result.round.workspace_key)
    [carried] = draft.annotations
    start = CORRECTED_DE.index("Untersuchung")
    assert start != TEXT_DE.index("Untersuchung")
    assert [m.model_dump() for m in carried.annotation.modifiers] == [
        {"term_id": SEVERE, "segments": [{"start": start, "end": start + 12}]},
        {"term_id": RECURRENT},
    ]
    assert item["target_snapshot"]["annotation"]["modifiers"] == [
        {"term_id": SEVERE, "segments": [{"start": start, "end": start + 12}]},
        {"term_id": RECURRENT},
    ]


def test_text_change_sends_a_changed_modifier_text_to_review(app):
    env = _env(app)
    # The correction rewrites the sentence with "Krampfanfälle"; Hypotonie maps.
    work = _hypotonia_with(env, "Krampfanfälle")
    preview = _preview(env, work["assignment_id"])
    assert (preview.placed, preview.unplaced) == (0, 1)
    assert preview.in_changed_passages == 1
    result = _move(env, work["assignment_id"])
    [item] = env.repo.get_round_input_inventory(env.key, result.round.round_id)
    assert item["mapping_status"] == "needs_review"
    assert item["target_snapshot"] is None
    assert item["review_reason"] == "changed_modifier_segment"
    assert _scoped(env, "tom").open_draft(result.round.workspace_key).annotations == []
