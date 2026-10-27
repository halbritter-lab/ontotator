"""Progress (spec "Screens: Progress (D9)") from the Documents derivation.

Every stage count is the number of rows its Documents link lists (follow-up
spec FD11): ``LINKS`` holds the query per count, and each count applies the
Documents row predicate ``row_matches`` with that query, so a count equals
``bar.shown`` of ``GET document-rows`` with its link. The lede counts the
same rows. The caller has authorized a lead and holds the shared project
lock.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import Connection, select

from ontotator.application.document_row_page import RowContext, row_matches
from ontotator.application.document_rows import RowFacts, RowQuery, load_facts
from ontotator.assignments.batch import WAITING_FOR_REVIEW_STEPS
from ontotator.domain import document_rows as rules
from ontotator.storage.repository import Repository
from ontotator.storage.tables import UserRow

Link = dict[str, Any]  # RowQuery keyword arguments
REVIEW_ON: Link = {"plan": ("review", "review_and_annotate")}
ANNOTATE_ON: Link = {"plan": ("annotate", "review_and_annotate")}
CHECK_FAILED: Link = {"translation_status": "automatic_check_failed"}

# Card -> (scope, the count that is "done", count -> Documents query); the
# link table of the follow-up spec ("F2"), plus ``check_failed`` and
# ``would_be_omitted``.
LINKS: dict[str, tuple[str, str, dict[str, Link]]] = {
    "translation_review": (
        "review",
        "accepted",
        {
            "to_assign": REVIEW_ON | {"step": ("assign_translation_review",)},
            "in_review": REVIEW_ON | {"step": ("translation_review_in_progress",)},
            "check_failed": REVIEW_ON | CHECK_FAILED,
            "check_failed_with_reviewer": REVIEW_ON
            | CHECK_FAILED
            | {"step": ("translation_review_in_progress",)},
            "rejected_or_queried": REVIEW_ON
            | {"step": ("resolve_rejected", "resolve_queried")},
            "accepted": REVIEW_ON | {"translation_status": "accepted"},
        },
    ),
    "annotation": (
        "annotate",
        "submitted",
        {
            "waiting_for_review": ANNOTATE_ON
            | {"step": tuple(sorted(WAITING_FOR_REVIEW_STEPS))},
            "to_assign": ANNOTATE_ON | {"step": ("assign_annotation",)},
            "in_progress": ANNOTATE_ON
            | {
                "step": ("annotation_in_progress", "consolidation_in_progress"),
                "paused": "no",
            },
            "paused": ANNOTATE_ON | {"paused": "yes"},
            "submitted": ANNOTATE_ON | {"stage": ("final", "done"), "paused": "no"},
        },
    ),
    "final": (
        "annotate",
        "final",
        {
            "not_ready": ANNOTATE_ON | {"stage": ("translation_review", "annotation")},
            "to_choose": ANNOTATE_ON | {"step": ("choose_final",)},
            "to_confirm": ANNOTATE_ON | {"step": ("confirm_final",)},
            "final": ANNOTATE_ON | {"final": "any"},
            "would_be_omitted": ANNOTATE_ON | {"final": "none"},
        },
    ),
}


def _link_view(link: Link) -> dict[str, Any]:
    """A link as ``DocumentLinkQuery`` fields (repeatable filters as lists)."""
    return {
        name: list(value) if isinstance(value, tuple) else value
        for name, value in link.items()
    }


def _card(context: RowContext, name: str) -> dict[str, Any]:
    scope, done, links = LINKS[name]
    rows = [
        row
        for key, row in context.rows.items()
        if context.flags[key][0 if scope == "review" else 1]
    ]
    counts = {
        count: sum(1 for row in rows if row_matches(context, row, RowQuery(**link)))
        for count, link in links.items()
    }
    done_count = counts[done]
    if name == "annotation":
        # R-13: the per-text limit is an upper bound, not a target: a text
        # counts as annotated with one submitted annotation.
        done_count = sum(
            1
            for row in rows
            if any(
                item["task"] == "annotate" and item["status"] == "submitted"
                for item in row["work"]
            )
        )
    return {
        "scope": scope,
        "done": done_count,
        "total": len(rows),
        "counts": counts,
        "links": {count: _link_view(link) for count, link in links.items()},
    }


def _workload(conn: Connection, facts: RowFacts) -> list[dict[str, Any]]:
    """Per person with non-revoked work.

    Unlike the members list and the batch people (``open_task_counts``, held
    counts as open), the open columns here exclude paused (held) tasks: those
    count in ``paused``; the sort key adds them back as open work.
    """
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
    context = RowContext(facts)
    states = context.states()
    segments = rules.segment_counts(
        (
            state.row["in_plan"],
            state.segment,
            state.row["next_step"]["code"] if state.row["next_step"] else None,
        )
        for state in states
    )
    stages = {name: _card(context, name) for name in LINKS}
    review = stages["translation_review"]
    return {
        "lede": {
            "cases": len({state.key[0] for state in states}),
            "translations_to_review": review["total"] - review["done"],
            "versions_to_annotate": sum(1 for state in states if state.annotate),
            "not_in_plan": sum(1 for state in states if not state.row["in_plan"]),
            "needs_decision": segments["needs_decision"],
            "to_assign": segments["to_assign"],
        },
        "stages": stages,
        "workload": _workload(conn, facts),
    }
