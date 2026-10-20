"""Progress (spec "Screens: Progress (D9)") from the Documents derivation.

The lede, the stage cards and the workload count the rows that
``document_row_page.row_states`` derives for the Documents table, so the
Progress counts equal the Documents bar ("Testing": Documents and Progress
counts equal). The caller has authorized a lead and holds the shared project
lock.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import Connection, select

from ontocurator.application.document_row_page import RowState, row_states
from ontocurator.application.document_rows import RowFacts, load_facts
from ontocurator.domain import document_rows as rules
from ontocurator.domain.next_steps import row_stage
from ontocurator.storage.repository import Repository
from ontocurator.storage.tables import UserRow

_IN_PROGRESS = frozenset({"annotation_in_progress", "annotation_review_in_progress"})
_PAUSABLE = frozenset({"annotate", "review"})


def _codes(state: RowState) -> set[str]:
    return {step["code"] for step in state.row["steps"]}


def _card(scope: str, done: int, total: int, counts: dict[str, int]) -> dict[str, Any]:
    return {"scope": scope, "done": done, "total": total, "counts": counts}


def _translation_review(states: list[RowState]) -> dict[str, Any]:
    """Rows with Review on (effective: translations, not discarded)."""
    counts = dict.fromkeys(
        (
            "to_assign",
            "in_review",
            "check_failed",
            "check_failed_with_reviewer",
            "rejected_or_queried",
            "accepted",
        ),
        0,
    )
    scope = [state for state in states if state.review]
    for state in scope:
        facts, codes = state.step_facts, _codes(state)
        failed = "automatic_check_failed" in facts.translation_statuses
        counts["to_assign"] += "assign_translation_review" in codes
        counts["in_review"] += "translation_review_in_progress" in codes
        counts["check_failed"] += failed
        counts["check_failed_with_reviewer"] += (
            failed and facts.open_translation_reviews > 0
        )
        counts["rejected_or_queried"] += bool(
            codes & {"resolve_rejected", "resolve_queried"}
        )
        counts["accepted"] += all(
            status == "accepted" for status in facts.translation_statuses
        )
    return _card("review", counts["accepted"], len(scope), counts)


def _annotation(states: list[RowState]) -> dict[str, Any]:
    """Rows with Annotate on: where their annotation work stands."""
    counts = dict.fromkeys(
        ("waiting_for_review", "to_assign", "in_progress", "paused", "submitted"), 0
    )
    scope = [state for state in states if state.annotate]
    for state in scope:
        stage, codes = row_stage(state.step_facts), _codes(state)
        counts["waiting_for_review"] += stage == "translation_review"
        counts["to_assign"] += "assign_annotation" in codes
        counts["in_progress"] += bool(codes & _IN_PROGRESS)
        counts["paused"] += any(
            item["held"] and item["task"] in _PAUSABLE for item in state.row["work"]
        )
        counts["submitted"] += stage in ("final", "done")
    return _card("annotate", counts["submitted"], len(scope), counts)


def _final(states: list[RowState]) -> dict[str, Any]:
    """Rows with Annotate on: final result state; rows without one leave export."""
    counts = dict.fromkeys(
        ("not_ready", "to_choose", "to_confirm", "final", "would_be_omitted"), 0
    )
    scope = [state for state in states if state.annotate]
    for state in scope:
        stage, codes = row_stage(state.step_facts), _codes(state)
        counts["not_ready"] += stage in ("translation_review", "annotation")
        counts["to_choose"] += "choose_final" in codes
        counts["to_confirm"] += "confirm_final" in codes
        counts["final"] += state.has_final
        counts["would_be_omitted"] += not state.has_final
    return _card("annotate", counts["final"], len(scope), counts)


def _workload(conn: Connection, facts: RowFacts) -> list[dict[str, Any]]:
    """Per person with non-revoked work; open columns exclude paused tasks."""
    columns = {
        "translation_review": "translation_reviews_open",
        "annotate": "annotations_open",
        "review": "reviews_open",
    }
    people: dict[int, dict[str, Any]] = {}
    for item in facts.assignments:
        if item.revoked:
            continue
        person = people.setdefault(
            item.user_id,
            {
                "user_id": item.user_id,
                "pseudonym": item.pseudonym,
                **dict.fromkeys(columns.values(), 0),
                "paused": 0,
                "submitted": 0,
            },
        )
        if item.held:
            person["paused"] += 1
        elif item.status == "submitted":
            person["submitted"] += 1
        elif item.task in columns:
            person[columns[item.task]] += 1
    usernames = {
        row.id: row.username
        for row in conn.execute(
            select(UserRow.id, UserRow.username).where(UserRow.id.in_(people))
        )
    }
    result = []
    for user_id, person in people.items():
        pseudonym = person.pop("pseudonym")
        person.pop("user_id")
        result.append(
            {
                "person": facts.people.get(
                    user_id,
                    {"pseudonym": pseudonym, "display_name": None, "is_me": False},
                ),
                "username": usernames.get(user_id, ""),
                **person,
            }
        )

    def open_work(entry: dict[str, Any]) -> int:
        return int(sum(entry[name] for name in columns.values()) + entry["paused"])

    return sorted(
        result, key=lambda entry: (-open_work(entry), entry["person"]["pseudonym"])
    )


def progress_view(
    conn: Connection, repo: Repository, key: str, pid: int, viewer_user_id: int
) -> dict[str, Any]:
    """Lede, stage cards and workload of project ``key`` (lead view)."""
    facts = load_facts(conn, repo, key, pid, viewer_user_id)
    states = row_states(facts)
    segments = rules.segment_counts(
        (
            state.row["in_plan"],
            state.segment,
            state.row["next_step"]["code"] if state.row["next_step"] else None,
        )
        for state in states
    )
    review = _translation_review(states)
    return {
        "lede": {
            "cases": len({state.key[0] for state in states}),
            "translations_to_review": review["total"] - review["done"],
            "versions_to_annotate": sum(1 for state in states if state.annotate),
            "not_in_plan": sum(1 for state in states if not state.row["in_plan"]),
            "needs_decision": segments["needs_decision"],
            "to_assign": segments["to_assign"],
        },
        "stages": {
            "translation_review": review,
            "annotation": _annotation(states),
            "final": _final(states),
        },
        "workload": _workload(conn, facts),
    }
