"""Working time of annotation and translation review tasks (issue 298)."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError
from test_progress_export_api import BASE, _assignment, _run, project  # noqa: F401
from test_t1_export import DOC

from ontotator.application.work_time import MAX_SILENCE
from ontotator.storage.tables import AuditEventRow
from ontotator.storage.work_time_tables import WorkIntervalRow, WorkTimeEventRow

START = datetime(2026, 11, 3, 9, 0, tzinfo=UTC)


class Clock:
    def __init__(self) -> None:
        self.now = START

    def __call__(self) -> datetime:
        return self.now

    def tick(self, seconds: float) -> None:
        self.now += timedelta(seconds=seconds)


@pytest.fixture
def timed(project):  # noqa: F811
    app, lead, worker, pid = project
    clock = Clock()
    app.state.work_time_clock = clock
    task = _assignment(app, pid, DOC, "worker")
    return app, lead, worker, pid, task, clock


def _switch(lead, on: bool) -> None:
    response = lead.patch(f"{BASE}/settings", json={"record_working_time": on})
    assert response.status_code == 200, response.text
    assert response.json()["record_working_time"] is on


def _report(client, task, *items):
    response = client.post(
        f"/api/v1/assignments/{task}/work-time", json={"items": list(items)}
    )
    assert response.status_code == 200, response.text
    return response.json()


def _item(interval, kind, reason=None):
    item = {"interval_id": interval, "kind": kind}
    if reason:
        item["end_reason"] = reason
    return item


def _rows(app, table):
    with app.state.repo.db.transaction() as conn:
        return conn.execute(select(table)).mappings().all()


def test_the_setting_is_off_by_default_and_then_nothing_is_stored(timed):
    app, lead, worker, _, task, clock = timed
    settings = lead.get(f"{BASE}/settings").json()
    assert settings["record_working_time"] is False
    state = worker.get(f"/api/v1/assignments/{task}/work-time").json()
    assert state["record"] is False and state["first_in_project"] is False
    _report(worker, task, _item("interval-1", "open"))
    clock.tick(30)
    state = _report(
        worker,
        task,
        _item("interval-1", "heartbeat"),
        _item("interval-1", "close", "closed"),
    )
    assert state["record"] is False and state["active_seconds"] == 0
    assert _rows(app, WorkTimeEventRow) == [] and _rows(app, WorkIntervalRow) == []


def test_the_lead_switches_recording_on_in_the_settings_history(timed):
    app, lead, worker, _, task, _ = timed
    assert (
        worker.patch(f"{BASE}/settings", json={"record_working_time": True}).status_code
        == 403
    )
    # The Workflow form sends every field; only the changed one is recorded.
    settings = lead.get(f"{BASE}/settings").json()
    unchanged = ("blind_consolidation", "adjudicator_not_annotator", "description")
    form = {name: settings[name] for name in unchanged}
    response = lead.patch(f"{BASE}/settings", json=form | {"record_working_time": True})
    assert response.status_code == 200, response.text
    with app.state.repo.db.transaction() as conn:
        details = conn.execute(
            select(AuditEventRow.details)
            .where(AuditEventRow.action == "project.update")
            .order_by(AuditEventRow.id.desc())
        ).first()
    assert details is not None and details[0]["fields"] == ["record_working_time"]
    state = worker.get(f"/api/v1/assignments/{task}/work-time").json()
    assert state == {
        "record": True,
        "first_in_project": True,
        "active_seconds": 0,
        "closed": [],
        "heartbeat_seconds": 60,
        "idle_seconds": 180,
    }


def test_an_interval_runs_from_open_to_close_at_server_time(timed):
    app, lead, worker, _, task, clock = timed
    _switch(lead, True)
    # The browser's clock is far off; only the server's times count.
    skewed = (START - timedelta(days=3)).isoformat()
    _report(worker, task, {**_item("interval-1", "open"), "client_at": skewed})
    clock.tick(60)
    _report(worker, task, _item("interval-1", "heartbeat"))
    clock.tick(45)
    state = _report(worker, task, _item("interval-1", "close", "idle"))
    assert state["closed"] == ["interval-1"] and state["active_seconds"] == 105
    assert state["first_in_project"] is False
    (row,) = _rows(app, WorkIntervalRow)
    assert row["started_at"] == START
    assert row["ended_at"] == START + timedelta(seconds=105)
    assert row["end_reason"] == "idle" and row["mode"] == "scratch"


def test_retried_items_are_stored_once(timed):
    app, lead, worker, _, task, clock = timed
    _switch(lead, True)
    _report(worker, task, _item("interval-1", "open"))
    clock.tick(10)
    _report(worker, task, _item("interval-1", "open"))
    clock.tick(20)
    first = _report(worker, task, _item("interval-1", "close", "manual_pause"))
    clock.tick(500)
    again = _report(
        worker,
        task,
        _item("interval-1", "open"),
        _item("interval-1", "heartbeat"),
        _item("interval-1", "close", "closed"),
    )
    assert first["active_seconds"] == again["active_seconds"] == 30
    assert again["closed"] == ["interval-1"]
    events = _rows(app, WorkTimeEventRow)
    assert [event["kind"] for event in events] == ["open"]
    (row,) = _rows(app, WorkIntervalRow)
    assert row["end_reason"] == "manual_pause"


def test_a_late_close_is_clamped_to_the_last_heartbeat_plus_the_gap(timed):
    app, lead, worker, _, task, clock = timed
    _switch(lead, True)
    _report(worker, task, _item("interval-1", "open"))
    clock.tick(60)
    _report(worker, task, _item("interval-1", "heartbeat"))
    # Within the allowed silence the close counts up to its arrival ...
    clock.tick(MAX_SILENCE.total_seconds())
    state = _report(worker, task, _item("interval-1", "close", "hidden"))
    assert state["active_seconds"] == 60 + MAX_SILENCE.total_seconds()
    # ... after it, the interval is lost at its last event.
    _report(worker, task, _item("interval-2", "open"))
    clock.tick(30)
    _report(worker, task, _item("interval-2", "heartbeat"))
    clock.tick(MAX_SILENCE.total_seconds() + 1)
    state = _report(worker, task, _item("interval-2", "close", "closed"))
    assert state["closed"] == ["interval-2"]
    rows = {row["interval_id"]: row for row in _rows(app, WorkIntervalRow)}
    lost = rows["interval-2"]
    assert lost["end_reason"] == "lost"
    assert (lost["ended_at"] - lost["started_at"]).total_seconds() == 30


def test_a_silent_interval_is_closed_as_lost_when_read(timed):
    app, lead, worker, _, task, clock = timed
    _switch(lead, True)
    _report(worker, task, _item("interval-1", "open"))
    clock.tick(40)
    _report(worker, task, _item("interval-1", "heartbeat"))
    clock.tick(3600)
    totals = lead.get(f"{BASE}/work-time").json()
    assert totals == {
        "record": True,
        "modes": [
            {
                "mode": "scratch",
                "texts": 1,
                "total_seconds": 40,
                "median_seconds_per_text": 40,
            }
        ],
    }
    (row,) = _rows(app, WorkIntervalRow)
    assert row["end_reason"] == "lost"
    # A heartbeat after the loss starts nothing: the browser opens a new one.
    state = _report(worker, task, _item("interval-1", "heartbeat"))
    assert state["closed"] == ["interval-1"] and state["active_seconds"] == 40


def test_only_leads_read_the_sums_and_no_person_is_named(timed):
    _, lead, worker, _, task, clock = timed
    _switch(lead, True)
    _report(worker, task, _item("interval-1", "open"))
    clock.tick(90)
    _report(worker, task, _item("interval-1", "close", "closed"))
    assert worker.get(f"{BASE}/work-time").status_code == 403
    body = lead.get(f"{BASE}/work-time").text
    assert "blind-worker" not in body and "interval-1" not in body


def test_no_new_interval_opens_on_a_submitted_task(timed):
    app, lead, worker, pid, _, _ = timed
    _switch(lead, True)
    submitted = _assignment(app, pid, "second", "worker", status="submitted")
    state = _report(worker, submitted, _item("interval-1", "open"))
    assert state["record"] is False
    assert _rows(app, WorkTimeEventRow) == []


def test_other_peoples_tasks_are_not_found(timed):
    _, lead, _, _, task, _ = timed
    _switch(lead, True)
    response = lead.post(
        f"/api/v1/assignments/{task}/work-time",
        json={"items": [_item("interval-1", "open")]},
    )
    assert response.status_code == 404


def test_the_work_time_export_is_pseudonymised(timed):
    app, lead, worker, _, task, clock = timed
    _switch(lead, True)
    _report(worker, task, _item("interval-1", "open"))
    clock.tick(70)
    _report(worker, task, _item("interval-1", "close", "idle"))
    _report(worker, task, _item("interval-2", "open"))
    clock.tick(20)
    _report(worker, task, _item("interval-2", "close", "closed"))
    assert worker.post(f"{BASE}/exports", json={"kind": "work_time"}).status_code == 403
    queued = lead.post(f"{BASE}/exports", json={"kind": "work_time"})
    assert queued.status_code == 200, queued.text
    job = _run(app, queued.json()["job_id"])
    assert job.result["intervals"] == 2 and job.result["tasks"] == 1
    downloaded = lead.get(f"/api/v1/jobs/{job.id}/download")
    assert downloaded.status_code == 200, downloaded.text
    assert "-work-time-" in downloaded.headers["content-disposition"]
    rows = [json.loads(line) for line in downloaded.text.splitlines()]
    assert [row["record"] for row in rows] == ["interval", "interval", "task_total"]
    assert rows[0]["annotator"] == "blind-worker"
    assert rows[0]["active_seconds"] == 70 and rows[0]["end_reason"] == "idle"
    assert rows[2] == {
        "record": "task_total",
        "annotator": "blind-worker",
        "document_id": DOC,
        "task": "annotate",
        "mode": "scratch",
        "intervals": 2,
        "active_seconds": 90,
    }
    for row in rows:
        assert not {"user_id", "session_id", "assignment_id", "interval_id"} & set(row)


def test_work_time_history_is_append_only(timed):
    app, lead, worker, _, task, clock = timed
    _switch(lead, True)
    _report(worker, task, _item("interval-1", "open"))
    clock.tick(5)
    _report(worker, task, _item("interval-1", "close", "closed"))
    for table in ("work_time_events", "work_intervals"):
        with pytest.raises(DBAPIError), app.state.repo.db.engine.begin() as conn:
            conn.execute(text(f"DELETE FROM ontotator.{table}"))
    with app.state.repo.db.transaction() as conn:
        assert (
            conn.execute(select(func.count()).select_from(WorkIntervalRow)).scalar()
            == 1
        )
