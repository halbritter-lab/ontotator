"""Documents visits: the per-lead baseline of NEW and the navigation summary
(documents overview spec VD6, V10, "New-item signal")."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from auth_harness import logged_in
from document_rows_support import rows_of
from document_rows_support import service as rows_service
from sqlalchemy import func, select
from test_document_rows_stages import ANNOTATE, REVIEW, plan, set_status, undecide
from work_plan_support import BASE, doc, plan_env

from ontotator.application.document_rows import RowQuery
from ontotator.application.documents_visits import GAP, baseline
from ontotator.storage.overview_tables import DocumentsVisitRow

T0 = datetime(2026, 10, 21, 9, 0, tzinfo=UTC)


@pytest.fixture
def env(tmp_path):
    env = plan_env(tmp_path)
    for case in ("c1", "c2"):
        for language in ("de", "fr"):
            set_status(env, doc(case, language), "ready_for_review")
    return env


def visit(env: Any, now: datetime | None = None, username: str = "leader") -> datetime:
    result = rows_service(env, username).visit("proj", now=now)
    return result["baseline_at"]  # type: ignore[no-any-return]


def stored(env: Any) -> tuple[datetime, datetime]:
    lead = env.app.state.accounts.get_by_username("leader")
    with env.db.transaction() as conn:
        row = conn.execute(
            select(DocumentsVisitRow.baseline_at, DocumentsVisitRow.last_seen_at).where(
                DocumentsVisitRow.user_id == lead.id,
                DocumentsVisitRow.project_id == env.pid,
            )
        ).one()
        assert baseline(conn, lead.id, env.pid) == row.baseline_at
    return row.baseline_at, row.last_seen_at


def test_gap_is_thirty_minutes():
    assert timedelta(minutes=30) == GAP


def test_first_visit_sets_both_and_nothing_is_new(env):
    plan(env, c1_de=REVIEW, c1_fr=ANNOTATE)
    # The server's clock: the first visit's baseline is after every event.
    at = visit(env)
    assert stored(env) == (at, at)
    rows = rows_of(rows_service(env).page("proj", RowQuery()))
    assert any(
        row["next_step"] and row["next_step"]["kind"] in ("decision", "assign")
        for row in rows.values()
    )
    assert rows and not any(row["new"] for row in rows.values())


def test_page_without_any_visit_marks_nothing_new(env):
    plan(env, c1_de=REVIEW)
    rows = rows_of(rows_service(env).page("proj", RowQuery()))
    assert not any(row["new"] for row in rows.values())
    with env.db.transaction() as conn:
        lead = env.app.state.accounts.get_by_username("leader")
        assert baseline(conn, lead.id, env.pid) is None


def test_return_within_30_minutes_keeps_baseline(env):
    visit(env, T0)
    assert visit(env, T0 + timedelta(minutes=20)) == T0
    # The gap is measured from the last opening, not from the baseline.
    assert visit(env, T0 + timedelta(minutes=45)) == T0
    assert stored(env) == (T0, T0 + timedelta(minutes=45))


def test_return_after_30_minutes_moves_baseline_to_last_seen(env):
    visit(env, T0)
    visit(env, T0 + timedelta(minutes=10))
    later = T0 + timedelta(minutes=40)  # exactly 30 minutes after last_seen
    assert visit(env, later) == T0 + timedelta(minutes=10)
    assert stored(env) == (T0 + timedelta(minutes=10), later)
    assert visit(env, later + timedelta(hours=5)) == later


def test_visits_are_per_user(env):
    lead2 = logged_in(env.app, "lead2", projects={"proj": ["lead"]}, assignments=[])
    visit(env, T0)
    response = lead2.post(f"{BASE}/documents/visit")
    assert response.status_code == 200, response.text
    assert datetime.fromisoformat(response.json()["baseline_at"]) != T0
    assert stored(env) == (T0, T0)


def test_explicit_first_visit_time_sets_both(env):
    assert visit(env, T0) == T0
    assert stored(env) == (T0, T0)


def test_visit_is_lead_only(env):
    annotator = logged_in(env.app, "anno", assignments=[])
    for method, path in (("post", "documents/visit"), ("get", "documents/summary")):
        response = getattr(annotator, method)(f"{BASE}/{path}")
        assert response.status_code == 403, response.text
        assert response.json()["code"] == "NOT_ALLOWED"
    with env.db.transaction() as conn:
        assert (
            conn.execute(
                select(func.count()).select_from(DocumentsVisitRow)
            ).scalar_one()
            == 0
        )
    ok = env.lead.post(f"{BASE}/documents/visit")
    assert ok.status_code == 200, ok.text
    assert set(ok.json()) == {"baseline_at"}


def test_summary_counts_needs_decision_incl_undecided(env):
    plan(env, c1_de=REVIEW, c1_fr=ANNOTATE)
    before = env.lead.get(f"{BASE}/documents/summary")
    assert before.status_code == 200, before.text
    bar = rows_service(env).page("proj", RowQuery())["bar"]
    assert before.json() == {"needs_decision": bar["needs_decision"]}
    undecide(env, ("c2", "fr"))
    after = env.lead.get(f"{BASE}/documents/summary").json()
    bar = rows_service(env).page("proj", RowQuery())["bar"]
    assert after == {"needs_decision": bar["needs_decision"]}
    assert after["needs_decision"] == before.json()["needs_decision"] + 1
    assert rows_service(env).summary("proj") == after


def test_record_visit_is_one_upsert(env):
    """Concurrent first visits of one lead: one row, no IntegrityError."""
    for attempt in range(3):
        username = f"racer{attempt}"
        logged_in(env.app, username, projects={"proj": ["lead"]}, assignments=[])
        user = env.app.state.accounts.get_by_username(username)
        now = T0 + timedelta(days=attempt)
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(visit, [env] * 4, [now] * 4, [username] * 4))
        assert results == [now] * 4
        with env.db.transaction() as conn:
            count = conn.execute(
                select(func.count())
                .select_from(DocumentsVisitRow)
                .where(DocumentsVisitRow.user_id == user.id)
            ).scalar_one()
        assert count == 1
