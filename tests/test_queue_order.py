"""``POST document-rows/move-to-front``: selected texts first in the project's
order, so first in My tasks (issue 339); renumbered positions, one audit."""

from __future__ import annotations

from typing import Any

import pytest
from auth_harness import logged_in
from sqlalchemy import select
from work_plan_support import BASE, assign, plan_env

from ontotator.storage.tables import AuditEventRow, DocumentRow


@pytest.fixture
def env(tmp_path):
    """Cases c1, c2 with en source and de/fr translations."""
    return plan_env(tmp_path, rule_on=False)


def row(case_id: str, language: str) -> dict[str, str]:
    return {"case_id": case_id, "language": language}


def move(env: Any, *rows: dict[str, str], client: Any = None) -> Any:
    return (client or env.lead).post(
        f"{BASE}/document-rows/move-to-front", json={"rows": list(rows)}
    )


def order(env: Any) -> list[tuple[str, int | None]]:
    with env.db.transaction() as conn:
        return [
            (document_id, position)
            for document_id, position in conn.execute(
                select(DocumentRow.document_id, DocumentRow.position)
                .where(DocumentRow.project_id == env.pid)
                .order_by(DocumentRow.position.nulls_last(), DocumentRow.document_id)
            ).tuples()
        ]


def test_selected_texts_move_first_and_positions_are_renumbered(env):
    before = [document_id for document_id, _ in order(env)]
    assert before == ["c1-en", "c1-de", "c1-fr", "c2-en", "c2-de", "c2-fr"]
    response = move(env, row("c2-x", "de"), row("c2", "fr"), row("c2", "en"))
    assert response.status_code == 200, response.text
    # Unknown texts are ignored.
    assert response.json() == {"moved": 2}
    # The moved texts keep their order among themselves, the others theirs.
    assert order(env) == [
        ("c2-en", 0),
        ("c2-fr", 1),
        ("c1-en", 2),
        ("c1-de", 3),
        ("c1-fr", 4),
        ("c2-de", 5),
    ]
    with env.db.transaction() as conn:
        events = conn.execute(
            select(
                AuditEventRow.action, AuditEventRow.target_id, AuditEventRow.details
            ).where(AuditEventRow.action == "project.queue_order")
        ).all()
    assert [(action, target) for action, target, _ in events] == [
        ("project.queue_order", "proj")
    ]
    assert events[0][2]["moved_to_front"] == [row("c2", "fr"), row("c2", "en")]


def test_my_tasks_lists_the_moved_text_first(env):
    first = assign(env, "c1-en", "anno", "annotate")
    second = assign(env, "c2-en", "anno", "annotate")
    anno = logged_in(env.app, "anno", assignments=[])

    def tasks() -> list[int]:
        response = anno.get("/api/v1/me/tasks")
        assert response.status_code == 200, response.text
        return [task["assignment_id"] for task in response.json()]

    assert tasks() == [first, second]
    assert move(env, row("c2", "en")).status_code == 200
    assert tasks() == [second, first]


def test_move_to_front_is_for_leads_and_bounded(env):
    ana = logged_in(env.app, "ana", assignments=[])
    assert move(env, row("c1", "en"), client=ana).status_code == 403
    assert (
        env.lead.post(
            f"{BASE}/document-rows/move-to-front", json={"rows": []}
        ).status_code
        == 422
    )
    too_many = [row(f"c{n}", "de") for n in range(2001)]
    assert move(env, *too_many).json()["code"] == "CASE_IDS_TOO_MANY"
    assert move(env, row("zz", "en")).json() == {"moved": 0}
    with env.db.transaction() as conn:
        assert (
            conn.execute(
                select(AuditEventRow.id).where(
                    AuditEventRow.action == "project.queue_order"
                )
            ).first()
            is None
        )
