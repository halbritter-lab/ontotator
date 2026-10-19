"""FastAPI application factory and middleware wiring."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import socket
import threading
from collections.abc import AsyncIterator
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from ontocurator import settings
from ontocurator.api.admin_routes import router as admin_router
from ontocurator.api.auth_routes import router as auth_router
from ontocurator.api.document_row_routes import router as document_row_router
from ontocurator.api.final_result_routes import router as final_result_router
from ontocurator.api.health import ReadinessProbe
from ontocurator.api.health import router as health_router
from ontocurator.api.job_routes import router as job_router
from ontocurator.api.me_routes import router as me_router
from ontocurator.api.ontology_routes import router as ontology_router
from ontocurator.api.project_routes import router as project_router
from ontocurator.api.routes import router
from ontocurator.api.security import install_security
from ontocurator.api.submission_history_routes import (
    router as submission_history_router,
)
from ontocurator.api.translation_workflow_routes import (
    router as translation_workflow_router,
)
from ontocurator.api.tree_routes import router as tree_router
from ontocurator.api.upload_routes import router as upload_router
from ontocurator.auth.accounts import AccountService
from ontocurator.auth.preferences import UserPreferencesStore
from ontocurator.auth.sessions import SessionService
from ontocurator.authz.memberships import MembershipService
from ontocurator.config import AppConfig
from ontocurator.domain.errors import (
    AccessDenied,
    DomainError,
    IncompleteReview,
    InvalidPackage,
    LoginFailed,
    NotAuthenticated,
    PayloadTooLarge,
    RevisionConflict,
)
from ontocurator.jobs.queue import Handler, JobContext, JobQueue, Worker
from ontocurator.ontology.translations import parse_translation_name
from ontocurator.storage.database import Database
from ontocurator.storage.lease import RuntimeLease
from ontocurator.storage.repository import Repository
from ontocurator.storage.schema import current_revision, head_revision

logger = logging.getLogger(__name__)

# Answered with 404, so a non-member cannot tell "missing" from "not yours".
NOT_FOUND_CODES = frozenset(
    {
        "CASE_NOT_FOUND",
        "VERSION_NOT_FOUND",
        "DOCUMENT_NOT_FOUND",
        "ASSIGNMENT_NOT_FOUND",
        "PROJECT_NOT_FOUND",
        "PACKAGE_NOT_FOUND",
        "UPLOAD_NOT_FOUND",
        "PROPOSAL_SET_NOT_FOUND",
        "ROUND_NOT_FOUND",
        "REPORT_NOT_FOUND",
        "ANNOTATION_NOT_FOUND",
        "EVIDENCE_NOT_FOUND",
    }
)


async def _keep_lease(lease: RuntimeLease) -> None:
    """Check the lease every ``check_interval`` seconds; take it again if lost."""
    while True:
        await asyncio.sleep(lease.check_interval)
        try:
            await run_in_threadpool(lease.check)
        except Exception:
            logger.error(
                "The runtime lease could not be taken again; retrying.", exc_info=True
            )


@contextlib.asynccontextmanager
async def _runtime_lease(app: FastAPI) -> AsyncIterator[None]:
    """Hold the runtime lease while the server runs (recovery needs it alone).

    The app is fully set up by ``create_app``; only the lease belongs to the
    server's lifetime. Acquiring waits while an offline recovery runs. A
    background task checks the lease connection and takes the lease again if
    its session was lost.
    """
    lease: RuntimeLease | None = getattr(app.state, "runtime_lease", None)
    if lease is None:
        try:
            yield
        finally:
            app.state.draining = True
        return
    await run_in_threadpool(lease.acquire)
    keeper = asyncio.create_task(_keep_lease(lease))
    # Each server process runs queued jobs (P6, index D-l).
    worker = Worker(app.state.jobs, f"{socket.gethostname()}:{os.getpid()}")
    app.state.job_worker = worker
    worker.start()
    try:
        yield
    finally:
        app.state.draining = True
        await run_in_threadpool(worker.stop)
        keeper.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await keeper
        try:
            await run_in_threadpool(lease.release)
        except Exception:
            # The lease connection was invalidated, not pooled, so its
            # session (and the lock) ended anyway.
            logger.warning("Could not release the runtime lease.", exc_info=True)


def create_app(config: AppConfig | None = None, *, expose_docs: bool = True) -> FastAPI:
    """Instantiate configured FastAPI application for local editor."""
    app = FastAPI(
        title="Ontocurator Local API",
        version="0.1.0",
        docs_url="/docs" if expose_docs else None,
        redoc_url="/redoc" if expose_docs else None,
        openapi_url="/openapi.json" if expose_docs else None,
        lifespan=_runtime_lease,
    )
    app.state.draining = False
    app.state.readiness_probe = ReadinessProbe()

    if config is not None:
        # Initialize storage and ontology
        db = Database(
            settings.resolve_database_url(config.database_url, config.workspace_dir),
            data_dir=config.workspace_dir,
        )
        # Close the engine again if anything after it fails, so a failed
        # start does not keep pooled connections open.
        try:
            # Migrations run separately as the schema owner (T2 index D-d); a
            # database that is not at this version's head is refused here, with
            # a clear error instead of a missing table on the first query.
            with db.transaction() as conn:
                current = current_revision(conn)
            head = head_revision()
            if current != head:
                raise DomainError(
                    "DATABASE_NOT_MIGRATED", {"current": current, "head": head}
                )
            repo = Repository(db)
            accounts = AccountService(db)
            sessions = SessionService(db)
            bootstrap = accounts.bootstrap_admin(config.admin_password_hash)
            if bootstrap == "already_done" and config.admin_password_hash is not None:
                logger.warning(
                    "ONTOCURATOR_ADMIN_PASSWORD_HASH is ignored: the first "
                    "administrator was created before. Use 'ontocurator admin' "
                    "to change passwords, and remove the setting."
                )
            elif bootstrap == "not_configured" and not accounts.list_users():
                logger.warning(
                    "There is no user yet, so nobody can log in. Set "
                    "ONTOCURATOR_ADMIN_PASSWORD_HASH (or ..._FILE) to the Argon2id "
                    "hash of the first administrator's password and restart."
                )

            from ontocurator.ontology.registry import OntologyRegistry
            from ontocurator.ontology.store import OntologyStore

            registry = OntologyRegistry(
                base_dir=config.workspace_dir,
                translation_dirs=config.translation_dirs,
            )
            store = OntologyStore(db, registry, config.workspace_dir)
            # Uploaded ontologies are registered (parsed on first use) and
            # uploaded translations placed where the loader finds them. A file
            # that cannot be read is logged; it must not stop the start.
            store.register_all()
            # Files named on the command line are for development: parsed now.
            configured = []
            for p in config.ontology_paths:
                if p.is_file():
                    configured.append(registry.register_path(p))
                else:
                    logger.warning("Configured ontology file not found: %s", p)
            if config.ontology_path and config.ontology_path.is_file():
                if config.expected_ontology_ref is not None:
                    from ontocurator.ontology.service import OntologyService

                    registry.register_service(
                        OntologyService.load(
                            config.ontology_path,
                            config.expected_ontology_ref,
                            translation_paths=registry.translation_files(),
                        )
                    )
                else:
                    configured.append(registry.register_path(config.ontology_path))
            registry.preload(configured)

            for definition, data in repo.ontology_resources():
                if not registry.has_ontology(definition.sha256):
                    registry.register_service(
                        registry.load_resource(
                            data, definition, registry.translation_files()
                        )
                    )
            # A file that cannot be read was already reported while its ontology
            # loaded. What is left to say: files that belong to no ontology at all.
            known_prefixes = {
                item.prefix for item in store.list() if item.kind == "ontology"
            }
            for stray in registry.unassigned_translations():
                parsed = parse_translation_name(stray.name)
                if parsed is not None and parsed[0] in known_prefixes:
                    continue
                logger.warning(
                    "Translation file %s matches no loaded ontology and is skipped.",
                    stray,
                )

            # Each worker preloads the pinned ontologies in the background;
            # any other one loads on first use and stays cached (P7).
            ready = threading.Event()
            pinned = store.pinned_shas()

            def preload() -> None:
                try:
                    registry.preload(pinned)
                finally:
                    ready.set()

            app.state.ontologies_ready = ready
            app.state.ontology_store = store
            from ontocurator.exchange.jobs import HANDLERS

            handlers: dict[str, Handler] = dict(HANDLERS)
            app.state.jobs = JobQueue(
                db,
                handlers,
                context=JobContext(
                    db=db,
                    registry=registry,
                    store=store,
                    data_dir=config.workspace_dir,
                ),
            )
            threading.Thread(
                target=preload, name="preload-ontologies", daemon=True
            ).start()

            app.state.config = config
            app.state.repo = repo
            app.state.ontology_registry = registry
            app.state.accounts = accounts
            app.state.memberships = MembershipService(db)
            app.state.sessions = sessions
            app.state.preferences = UserPreferencesStore(db)
            app.state.runtime_lease = RuntimeLease(db.engine)
            app.state.secure_cookies = bool(
                config.public_origin and config.public_origin.startswith("https://")
            )
        except BaseException:
            # Never let a failing clean-up hide why the start failed.
            with contextlib.suppress(Exception):
                db.close()
            raise

        install_security(app, sessions, config.public_origin, config.trusted_hosts)
    else:
        # Schema export only: no sessions exist, so no API request is answered.
        install_security(app, None, None)

    # FastAPI's own answer without the rejected input, which may be a
    # password, encoded as ASCII JSON, so even a lone surrogate cannot make it
    # a 500.
    @app.exception_handler(RequestValidationError)
    async def request_validation_handler(
        _req: Request, exc: RequestValidationError
    ) -> Response:
        errors = [
            {name: value for name, value in error.items() if name != "input"}
            for error in exc.errors()
        ]
        return Response(
            json.dumps({"detail": jsonable_encoder(errors)}),
            status_code=422,
            media_type="application/json",
        )

    # Service-level command parsing must report client validation failures as 422.
    @app.exception_handler(ValidationError)
    async def validation_error_handler(
        _req: Request, exc: ValidationError
    ) -> JSONResponse:
        errors = exc.errors(
            include_url=False, include_context=False, include_input=False
        )
        details = "; ".join(
            f"{'.'.join(map(str, error['loc']))}: {error['msg']}" for error in errors
        )
        return JSONResponse(
            status_code=422,
            content={
                "code": "VALIDATION_ERROR",
                "details": details,
            },
        )

    # Error handling
    @app.exception_handler(RevisionConflict)
    async def revision_conflict_handler(
        _req: Request, exc: RevisionConflict
    ) -> JSONResponse:
        return JSONResponse(
            status_code=409,
            content={"code": exc.code, "details": exc.details or str(exc)},
        )

    @app.exception_handler(PayloadTooLarge)
    async def payload_too_large_handler(
        _req: Request, exc: PayloadTooLarge
    ) -> JSONResponse:
        return JSONResponse(
            status_code=413,
            content={"code": exc.code, "details": exc.details or str(exc)},
        )

    @app.exception_handler(IncompleteReview)
    async def incomplete_review_handler(
        _req: Request, exc: IncompleteReview
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={"code": exc.code, "details": exc.details or str(exc)},
        )

    @app.exception_handler(InvalidPackage)
    async def invalid_package_handler(
        _req: Request, exc: InvalidPackage
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={"code": exc.code, "details": exc.details or str(exc)},
        )

    @app.exception_handler(AccessDenied)
    async def access_denied_handler(_req: Request, exc: AccessDenied) -> JSONResponse:
        return JSONResponse(
            status_code=403,
            content={"code": exc.code, "details": exc.details or str(exc)},
        )

    @app.exception_handler(NotAuthenticated)
    async def not_authenticated_handler(
        _req: Request, exc: NotAuthenticated
    ) -> JSONResponse:
        return JSONResponse(
            status_code=401,
            content={"code": exc.code, "details": exc.details or str(exc)},
        )

    @app.exception_handler(LoginFailed)
    async def login_failed_handler(_req: Request, exc: LoginFailed) -> JSONResponse:
        return JSONResponse(
            status_code=401,
            content={"code": exc.code, "details": exc.details or str(exc)},
        )

    @app.exception_handler(DomainError)
    async def domain_error_handler(_req: Request, exc: DomainError) -> JSONResponse:
        return JSONResponse(
            # A foreign project looks like a missing one (E3).
            status_code=(
                404
                if exc.code in NOT_FOUND_CODES
                else {
                    "ASSIGNMENT_SUBMITTED": 409,
                    "WORKFLOW_REVISION_CONFLICT": 409,
                    "WORKFLOW_REQUEST_CONFLICT": 409,
                    "ROUND_INPUT_STALE": 409,
                    "ROUND_INPUT_RESOLUTION_STALE": 409,
                    "ROUND_NOT_EDITABLE": 409,
                    "ROUND_ACTIVE": 409,
                    "ROUND_ALREADY_EXISTS": 409,
                    "TASK_HELD": 409,
                    "VARIANT_REVIEW_STALE": 409,
                    "TRANSLATION_NOT_ACCEPTED": 409,
                    "LANGUAGE_CONFIRMATION_REQUIRED": 409,
                    "REASSIGN_CONFIRMATION_REQUIRED": 409,
                    "ADJUDICATOR_IS_ANNOTATOR": 409,
                    "OWN_RESULT_NOT_SELECTABLE": 409,
                    "ASSIGNMENT_REVOKED": 409,
                    "ASSIGNMENT_NOT_SUBMITTED": 409,
                    "ASSIGNMENT_EXISTS": 409,
                    "DISTRIBUTION_STALE": 409,
                    "SELF_LOCKOUT": 409,
                    "UPLOAD_STALE": 409,
                    "PASSWORD_WRONG": 403,
                    "PROJECT_EXISTS": 409,
                    "PROJECT_IN_USE": 409,
                    "LAST_LEAD": 409,
                    "MEMBER_HAS_ASSIGNMENTS": 409,
                }.get(exc.code, 422)
            ),
            content={"code": exc.code, "details": exc.details or str(exc)},
        )

    from ontocurator.api.assignment_routes import router as assignment_router
    from ontocurator.api.variant_routes import router as variant_router

    app.include_router(assignment_router)
    from ontocurator.api.work_round_routes import router as work_round_router

    app.include_router(work_round_router)
    from ontocurator.api.problem_report_routes import router as problem_report_router

    app.include_router(problem_report_router)
    from ontocurator.api.translation_review_routes import (
        router as translation_review_router,
    )

    app.include_router(translation_review_router)
    app.include_router(submission_history_router)
    app.include_router(variant_router)
    app.include_router(admin_router)
    app.include_router(ontology_router)
    app.include_router(final_result_router)
    app.include_router(document_row_router)
    app.include_router(translation_workflow_router)
    app.include_router(project_router)
    app.include_router(job_router)
    app.include_router(upload_router)
    app.include_router(me_router)
    app.include_router(auth_router)
    app.include_router(router)
    app.include_router(tree_router)
    app.include_router(health_router)

    # Mount static assets if provided or embedded
    web_path: Path | None = None
    if config and config.web_dir and Path(config.web_dir).is_dir():
        web_path = Path(config.web_dir)
    else:
        embedded_web = Path(__file__).parent.parent / "web"
        if embedded_web.is_dir() and (embedded_web / "index.html").is_file():
            web_path = embedded_web

    if web_path:
        app.mount(
            "/",
            StaticFiles(directory=str(web_path), html=True),
            name="static",
        )

    return app
