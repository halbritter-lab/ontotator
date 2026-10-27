"""The ``jobs`` table and the worker thread of each process (P6, index D-l).

A job is claimed with ``FOR UPDATE SKIP LOCKED``, so two workers never take
the same one. CLI commands enqueue a job and run it inline with
:meth:`JobQueue.claim`, which also works while the server is stopped.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

from sqlalchemy import Row, func, insert, select, text, update

from ontotator.auth.audit import Actor
from ontotator.domain.errors import DomainError
from ontotator.storage.database import Database
from ontotator.storage.tables import JobRow

if TYPE_CHECKING:
    from ontotator.ontology.registry import OntologyRegistry
    from ontotator.ontology.store import OntologyStore

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Job:
    id: int
    kind: str
    status: str
    project_id: int | None
    payload: dict[str, Any]
    result: dict[str, Any] | None = None
    error: str | None = None


@dataclass(frozen=True)
class JobContext:
    """What a handler may use instead of globals."""

    db: Database
    registry: OntologyRegistry | None = None
    store: OntologyStore | None = None
    data_dir: Path | None = None


Handler = Callable[[Job, JobContext], dict[str, Any]]


class StructuredJobError(DomainError):
    """Opt in to a public ``result.error`` payload alongside the legacy error text.

    Details must be JSON serializable and safe for the job's authorized readers.
    Other failures retain their historical null result.
    """


# The claim statements are the contract (T2d plan, Task 3).
_CLAIM_NEXT = text(
    """
    UPDATE ontotator.jobs SET status = 'running', started_at = now(), worker = :worker
     WHERE id = (SELECT id FROM ontotator.jobs WHERE status = 'queued'
                 ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id, kind, status, project_id, payload
    """
)
_CLAIM_ONE = text(
    """
    UPDATE ontotator.jobs SET status = 'running', started_at = now(), worker = :worker
     WHERE id = (SELECT id FROM ontotator.jobs WHERE id = :id AND status = 'queued'
                 FOR UPDATE SKIP LOCKED)
    RETURNING id, kind, status, project_id, payload
    """
)

_COLUMNS = (
    JobRow.id,
    JobRow.kind,
    JobRow.status,
    JobRow.project_id,
    JobRow.payload,
    JobRow.result,
    JobRow.error,
)


def _job(row: Row[Any]) -> Job:
    mapping = row._mapping
    return Job(
        id=mapping["id"],
        kind=mapping["kind"],
        status=mapping["status"],
        project_id=mapping["project_id"],
        payload=mapping["payload"],
        result=mapping.get("result"),
        error=mapping.get("error"),
    )


class JobQueue:
    """Records handler failures; outcome-persistence errors propagate to the worker."""

    def __init__(
        self,
        db: Database,
        handlers: Mapping[str, Handler],
        *,
        context: JobContext | None = None,
    ) -> None:
        self.db = db
        self.handlers = handlers
        self.context = context or JobContext(db=db, data_dir=db.data_dir)

    def enqueue(
        self,
        kind: str,
        payload: dict[str, Any],
        *,
        project_id: int | None = None,
        actor: Actor,
    ) -> int:
        if kind not in self.handlers:
            raise DomainError("JOB_KIND_UNKNOWN", f"No job handler for '{kind}'.")
        with self.db.transaction() as conn:
            return int(
                conn.execute(
                    insert(JobRow)
                    .values(
                        kind=kind,
                        status="queued",
                        project_id=project_id,
                        requested_by=actor.user_id,
                        requested_label=actor.label,
                        payload=payload,
                    )
                    .returning(JobRow.id)
                ).scalar_one()
            )

    def claim_next(self, worker: str) -> Job | None:
        """The oldest queued job nobody else is claiming, now running."""
        with self.db.transaction() as conn:
            row = conn.execute(_CLAIM_NEXT, {"worker": worker}).one_or_none()
        return _job(row) if row is not None else None

    def claim(self, job_id: int, worker: str) -> Job | None:
        """Claim only this job, if it is still queued and not being claimed."""
        with self.db.transaction() as conn:
            row = conn.execute(
                _CLAIM_ONE, {"worker": worker, "id": job_id}
            ).one_or_none()
        return _job(row) if row is not None else None

    def get(self, job_id: int) -> Job | None:
        with self.db.transaction() as conn:
            row = conn.execute(
                select(*_COLUMNS).where(JobRow.id == job_id)
            ).one_or_none()
        return _job(row) if row is not None else None

    def run(self, job: Job, worker: str) -> Job:
        """Run a claimed job's handler and record its outcome."""
        try:
            handler = self.handlers.get(job.kind)
            if handler is None:
                raise LookupError(f"no handler for job kind '{job.kind}'")
            result = handler(job, self.context)
        except Exception as exc:
            logger.warning(
                "Job %s (%s) failed: %s", job.id, job.kind, exc, exc_info=True
            )
            self._finish(
                job.id,
                worker,
                status="failed",
                # Unexpected exceptions can carry server paths; only the log keeps them.
                error=f"{type(exc).__name__}: {exc}"
                if isinstance(exc, DomainError)
                else f"{type(exc).__name__} (details in the server log)",
                result={"error": {"code": exc.code, "details": exc.details}}
                if isinstance(exc, StructuredJobError)
                else None,
            )
        else:
            self._finish(job.id, worker, status="succeeded", result=result)
        finished = self.get(job.id)
        assert finished is not None
        return finished

    def _finish(
        self,
        job_id: int,
        worker: str,
        *,
        status: str,
        result: dict[str, Any] | None = None,
        error: str | None = None,
    ) -> None:
        with self.db.transaction() as conn:
            conn.execute(
                update(JobRow)
                .where(
                    JobRow.id == job_id,
                    JobRow.status == "running",
                    JobRow.worker == worker,
                )
                .values(
                    status=status,
                    result=result,
                    error=error,
                    finished_at=func.now(),
                )
            )


class Worker:
    """A daemon thread that runs queued jobs until stopped."""

    def __init__(self, queue: JobQueue, name: str, interval: float = 2.0) -> None:
        self.queue = queue
        self.name = name
        self.interval = interval
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    @property
    def alive(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> None:
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._loop, name=f"job-worker-{self.name}", daemon=True
        )
        self._thread.start()

    def stop(self, timeout: float = 30.0) -> None:
        """Stop after the running job, if any; waits up to ``timeout`` seconds."""
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout)

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                job = self.queue.claim_next(self.name)
            except Exception:
                logger.error("Could not claim a job; retrying.", exc_info=True)
                job = None
            if job is None:
                self._stop.wait(self.interval)
                continue
            try:
                self.queue.run(job, self.name)
            except Exception:
                # Recording the outcome failed (e.g. the database went away);
                # the job stays "running" and the worker carries on.
                logger.error("Could not finish job %s.", job.id, exc_info=True)
                self._stop.wait(self.interval)
