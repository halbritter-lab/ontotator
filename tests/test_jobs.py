"""The jobs table and its SKIP LOCKED worker (T2d Task 3, P6, index D-l)."""

import threading
import time
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pg_harness import database_for, database_url_for

from ontotator.api.app import create_app
from ontotator.auth.audit import Actor
from ontotator.config import AppConfig
from ontotator.domain.errors import DomainError
from ontotator.jobs.queue import Job, JobContext, JobQueue, Worker
from ontotator.storage.database import Database


def _db(tmp_path: Path) -> Database:
    return database_for(tmp_path / "editor.db")


def _echo(job: Job, ctx: JobContext) -> dict[str, Any]:
    assert ctx.db is not None
    return {"echo": job.payload["value"]}


def _boom(job: Job, ctx: JobContext) -> dict[str, Any]:
    raise RuntimeError("boom")


HANDLERS = {"echo": _echo, "boom": _boom}


def test_a_job_runs_once_even_with_two_workers(tmp_path: Path) -> None:
    queue = JobQueue(_db(tmp_path), HANDLERS)
    job_id = queue.enqueue("echo", {"value": 1}, actor=Actor.cli())
    barrier = threading.Barrier(2)
    claimed: list[Job | None] = []
    lock = threading.Lock()

    def claim(name: str) -> None:
        barrier.wait()
        job = queue.claim_next(name)
        with lock:
            claimed.append(job)

    threads = [threading.Thread(target=claim, args=(f"w{i}",)) for i in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(10)

    won = [job for job in claimed if job is not None]
    assert len(claimed) == 2
    assert [job.id for job in won] == [job_id]
    assert won[0].status == "running"
    assert queue.claim_next("w3") is None


def test_a_claimed_but_locked_job_is_skipped(tmp_path: Path) -> None:
    db = _db(tmp_path)
    queue = JobQueue(db, HANDLERS)
    first = queue.enqueue("echo", {"value": 1}, actor=Actor.cli())
    second = queue.enqueue("echo", {"value": 2}, actor=Actor.cli())
    from sqlalchemy import text

    with db.engine.begin() as conn:
        conn.execute(
            text("SELECT id FROM ontotator.jobs WHERE id = :id FOR UPDATE"),
            {"id": first},
        )
        # Another worker holds the first row: this one takes the second.
        job = queue.claim_next("w2")
        assert job is not None and job.id == second


def test_a_job_succeeds_with_its_result(tmp_path: Path) -> None:
    queue = JobQueue(_db(tmp_path), HANDLERS)
    job_id = queue.enqueue("echo", {"value": 7}, actor=Actor.cli())
    job = queue.claim(job_id, "w1")
    assert job is not None

    done = queue.run(job, "w1")

    assert (done.status, done.result, done.error) == ("succeeded", {"echo": 7}, None)
    assert queue.get(job_id) == done


def test_a_failing_handler_marks_the_job_failed(tmp_path: Path) -> None:
    queue = JobQueue(_db(tmp_path), HANDLERS)
    job_id = queue.enqueue("boom", {}, actor=Actor.cli())
    job = queue.claim_next("w1")
    assert job is not None

    done = queue.run(job, "w1")

    assert done.status == "failed"
    assert done.error == "RuntimeError: boom"
    assert done.result is None
    assert queue.get(job_id) == done


def test_an_unknown_kind_is_refused(tmp_path: Path) -> None:
    queue = JobQueue(_db(tmp_path), HANDLERS)
    with pytest.raises(DomainError) as excinfo:
        queue.enqueue("nope", {}, actor=Actor.cli())
    assert excinfo.value.code == "JOB_KIND_UNKNOWN"


def test_claim_takes_only_the_named_job(tmp_path: Path) -> None:
    queue = JobQueue(_db(tmp_path), HANDLERS)
    first = queue.enqueue("echo", {"value": 1}, actor=Actor.cli())
    second = queue.enqueue("echo", {"value": 2}, actor=Actor.cli())

    job = queue.claim(second, "cli")
    assert job is not None and job.id == second
    assert queue.claim(second, "cli") is None
    next_job = queue.claim_next("w1")
    assert next_job is not None and next_job.id == first
    assert queue.claim(12345, "cli") is None


def test_the_worker_thread_runs_queued_jobs(tmp_path: Path) -> None:
    queue = JobQueue(_db(tmp_path), HANDLERS)
    worker = Worker(queue, "w1", interval=0.05)
    worker.start()
    try:
        job_id = queue.enqueue("echo", {"value": 3}, actor=Actor.cli())
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            job = queue.get(job_id)
            assert job is not None
            if job.status == "succeeded":
                break
            time.sleep(0.05)
        assert job.status == "succeeded"
        assert job.result == {"echo": 3}
    finally:
        worker.stop()
    assert not worker.alive


def test_the_server_runs_a_worker_while_it_is_up(tmp_path: Path) -> None:
    app = create_app(
        AppConfig(
            workspace_dir=tmp_path,
            database_url=database_url_for(tmp_path / "editor.db"),
        )
    )
    with TestClient(app):
        worker: Worker = app.state.job_worker
        assert worker.alive
    assert not worker.alive
