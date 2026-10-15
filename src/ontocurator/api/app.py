"""FastAPI application factory and middleware wiring."""

from __future__ import annotations

import contextlib
import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from ontocurator import settings
from ontocurator.api.auth_routes import router as auth_router
from ontocurator.api.routes import router
from ontocurator.api.security import install_security
from ontocurator.api.tree_routes import router as tree_router
from ontocurator.auth.accounts import AccountService
from ontocurator.auth.preferences import UserPreferencesStore
from ontocurator.auth.sessions import SessionService
from ontocurator.config import AppConfig
from ontocurator.domain.errors import (
    AccessDenied,
    DomainError,
    IncompleteReview,
    InvalidPackage,
    LoginFailed,
    ModeNotAllowed,
    PayloadTooLarge,
    RevisionConflict,
)
from ontocurator.storage.database import Database
from ontocurator.storage.repository import Repository
from ontocurator.storage.schema import current_revision, head_revision

logger = logging.getLogger(__name__)


def create_app(config: AppConfig | None = None) -> FastAPI:
    """Instantiate configured FastAPI application for local editor."""
    app = FastAPI(
        title="Ontocurator Local API",
        version="0.1.0",
        docs_url="/docs",
        openapi_url="/openapi.json",
    )

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
            if (
                accounts.bootstrap_admin(config.admin_password_hash) == "already_done"
                and config.admin_password_hash is not None
            ):
                logger.warning(
                    "ONTOCURATOR_ADMIN_PASSWORD_HASH is ignored: the first "
                    "administrator was created before. Use 'ontocurator admin' "
                    "to change passwords, and remove the setting."
                )

            from ontocurator.ontology.registry import OntologyRegistry

            registry = OntologyRegistry(
                base_dir=config.workspace_dir,
                translation_dirs=[
                    config.workspace_dir / "ontologies",
                    *config.translation_dirs,
                ],
            )
            for p in config.ontology_paths:
                if p.is_file():
                    registry.register_path(p)
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
                    registry.register_path(config.ontology_path)
            # Uploaded ontologies are stored here; register them again after a
            # restart. An entry that cannot be read must not stop the start.
            for stored in sorted((config.workspace_dir / "ontologies").glob("*.json")):
                if not stored.is_file():
                    continue
                try:
                    registry.register_path(stored)
                except (OSError, DomainError) as exc:
                    logger.warning("Skipping stored ontology %s: %s", stored, exc)
            # Eagerly parse registered files; failures are logged and reported by
            # GET /api/v1/ontologies instead of being silently dropped.
            registry.load_registered()

            for definition, data in repo.ontology_resources():
                if registry.get_service(definition.sha256) is None:
                    registry.register_service(
                        registry.load_resource(
                            data, definition, registry.translation_files()
                        )
                    )
            # A file that cannot be read was already reported while its ontology
            # loaded. What is left to say: files that belong to no ontology at all.
            for stray in registry.unassigned_translations():
                logger.warning(
                    "Translation file %s matches no loaded ontology and is skipped.",
                    stray,
                )

            app.state.config = config
            app.state.repo = repo
            app.state.ontology_registry = registry
            app.state.accounts = accounts
            app.state.sessions = sessions
            app.state.preferences = UserPreferencesStore(db)
            app.state.secure_cookies = bool(
                config.public_origin and config.public_origin.startswith("https://")
            )
        except BaseException:
            # Never let a failing clean-up hide why the start failed.
            with contextlib.suppress(Exception):
                db.close()
            raise

        install_security(app, sessions, config.public_origin)

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

    @app.exception_handler(ModeNotAllowed)
    async def mode_not_allowed_handler(
        _req: Request, exc: ModeNotAllowed
    ) -> JSONResponse:
        return JSONResponse(
            status_code=403,
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

    @app.exception_handler(LoginFailed)
    async def login_failed_handler(_req: Request, exc: LoginFailed) -> JSONResponse:
        return JSONResponse(
            status_code=401,
            content={"code": exc.code, "details": exc.details or str(exc)},
        )

    @app.exception_handler(DomainError)
    async def domain_error_handler(_req: Request, exc: DomainError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={"code": exc.code, "details": exc.details or str(exc)},
        )

    app.include_router(auth_router)
    app.include_router(router)
    app.include_router(tree_router)

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
