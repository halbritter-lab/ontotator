"""Unauthenticated probes with one shared, briefly cached readiness evaluation."""

from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.pool import NullPool
from starlette.concurrency import run_in_threadpool

from ontotator.storage.schema import current_revision, head_revision
from ontotator.storage.tables import ProjectOntologyRow

router = APIRouter()


def _unavailable() -> dict[str, bool]:
    return {"database": False, "schema": False, "ontologies": False}


def check_readiness(app: FastAPI) -> dict[str, bool]:
    """Check as the application role without waiting for its connection pool.

    Connection and statement timeouts bound work even after an HTTP caller
    leaves. Failures expose booleans only, never SQL or connection details.
    """
    checks = _unavailable()
    pinned: set[str] | None = None
    repo = getattr(app.state, "repo", None)
    url = (
        repo.db.engine.url
        if repo is not None
        else getattr(app.state, "health_database_url", None)
    )
    if url is None:
        return checks
    engine = create_engine(
        url,
        poolclass=NullPool,
        connect_args={"connect_timeout": 2, "options": "-c statement_timeout=2000"},
        hide_parameters=True,
    )
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            checks["database"] = True
            checks["schema"] = current_revision(conn) == head_revision()
            if (
                checks["schema"]
                and repo is not None
                and app.state.ontologies_ready.is_set()
            ):
                pinned = set(
                    conn.execute(select(ProjectOntologyRow.sha256).distinct()).scalars()
                )
    except SQLAlchemyError:
        pass
    finally:
        engine.dispose()
    if pinned is not None:
        # Cold pins added by another worker/CLI may need heavy parsing. Release
        # the health connection before loading or waiting on registry locks.
        registry = app.state.ontology_registry
        registry.preload(pinned, retry_unavailable=True)
        checks["ontologies"] = pinned <= {sha for sha, _ in registry.services()}
    return checks


class ReadinessProbe:
    """Coalesce evaluations, including slow work that outlives a probe deadline."""

    def __init__(self) -> None:
        self._task: asyncio.Task[dict[str, bool]] | None = None
        self._cached: dict[str, bool] | None = None
        self._expires = 0.0

    async def _evaluate(self, app: FastAPI) -> dict[str, bool]:
        checks = await run_in_threadpool(check_readiness, app)
        self._cached = checks
        self._expires = time.monotonic() + 1.0
        return checks

    async def checks(self, app: FastAPI) -> dict[str, bool]:
        if self._cached is not None and time.monotonic() < self._expires:
            return self._cached
        # There is no await between reading and publishing the task. All
        # requests in this server's event loop therefore share the same task.
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._evaluate(app))
        try:
            return await asyncio.wait_for(asyncio.shield(self._task), timeout=2.0)
        except TimeoutError:
            # Keep the task alive: the next caller must share the outstanding
            # check, rather than starting another database connection.
            self._cached = _unavailable()
            self._expires = time.monotonic() + 1.0
            return self._cached


@router.get("/livez", include_in_schema=False)
async def livez(request: Request) -> JSONResponse:
    ok = not request.app.state.draining
    return JSONResponse({"ok": ok}, status_code=200 if ok else 503)


@router.get("/readyz", include_in_schema=False)
async def readyz(request: Request) -> JSONResponse:
    probe: ReadinessProbe = request.app.state.readiness_probe
    checks = await probe.checks(request.app)
    ok = all(checks.values())
    return JSONResponse({"ok": ok, "checks": checks}, status_code=200 if ok else 503)
