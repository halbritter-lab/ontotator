"""FastAPI application factory and middleware wiring."""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from ontocurator.api.routes import router
from ontocurator.api.security import verify_security
from ontocurator.application.preferences import PREFERENCES_FILENAME, PreferencesStore
from ontocurator.config import AppConfig
from ontocurator.domain.errors import (
    DomainError,
    IncompleteReview,
    InvalidPackage,
    PayloadTooLarge,
    RevisionConflict,
)
from ontocurator.storage.database import Database
from ontocurator.storage.repository import Repository

logger = logging.getLogger(__name__)


def create_app(config: AppConfig | None = None) -> FastAPI:
    """Instantiate configured FastAPI application for local editor."""
    app = FastAPI(
        title="Local HPO Annotation Editor API",
        version="0.1.0",
        docs_url="/docs",
        openapi_url="/openapi.json",
    )

    if config is not None:
        # Initialize storage and ontology
        db_path = config.database_path or (config.workspace_dir / "editor.db")
        db = Database(db_path)
        repo = Repository(db)

        from ontocurator.ontology.registry import OntologyRegistry

        registry = OntologyRegistry(base_dir=config.workspace_dir)
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
                        config.ontology_path, config.expected_ontology_ref
                    )
                )
            else:
                registry.register_path(config.ontology_path)
        # Eagerly parse registered files; failures are logged and reported by
        # GET /api/v1/ontologies instead of being silently dropped.
        registry.load_registered()

        for definition, data in repo.ontology_resources():
            if registry.get_service(definition.sha256) is None:
                registry.register_service(registry.load_resource(data, definition))

        app.state.config = config
        app.state.repo = repo
        app.state.ontology_registry = registry
        app.state.preferences = PreferencesStore(
            config.workspace_dir / PREFERENCES_FILENAME
        )

        # Security middleware for API requests
        @app.middleware("http")
        async def security_middleware(request: Request, call_next):  # type: ignore[no-untyped-def]
            if request.url.path.startswith("/api/"):
                try:
                    verify_security(request, config.session_token, config.port)
                except HTTPException as exc:
                    content: dict[str, object] = {"detail": exc.detail}
                    code = getattr(exc, "code", None)
                    if code:
                        content["code"] = code
                    return JSONResponse(status_code=exc.status_code, content=content)
            return await call_next(request)

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

    @app.exception_handler(DomainError)
    async def domain_error_handler(_req: Request, exc: DomainError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={"code": exc.code, "details": exc.details or str(exc)},
        )

    app.include_router(router)

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
