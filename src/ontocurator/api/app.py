"""FastAPI application factory and middleware wiring."""

from __future__ import annotations

import hashlib
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from ontocurator.api.routes import router
from ontocurator.api.security import verify_security
from ontocurator.config import AppConfig
from ontocurator.domain.documents import OntologyRef
from ontocurator.domain.errors import (
    DomainError,
    IncompleteReview,
    InvalidPackage,
    RevisionConflict,
)
from ontocurator.ontology.service import OntologyService
from ontocurator.storage.database import Database
from ontocurator.storage.repository import Repository


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

        registry = OntologyRegistry()
        for p in config.ontology_paths:
            if p.is_file():
                registry.register_path(p)
        if config.ontology_path and config.ontology_path.is_file():
            registry.register_path(config.ontology_path)

        app.state.config = config
        app.state.repo = repo
        app.state.ontology_registry = registry

        # Maintain app.state.ontology if a primary ontology was configured
        primary_path = config.ontology_path or (
            config.ontology_paths[0] if config.ontology_paths else None
        )
        if primary_path and primary_path.is_file():
            expected_ref = config.expected_ontology_ref
            if expected_ref is None:
                raw = primary_path.read_bytes()
                digest = hashlib.sha256(raw).hexdigest()
                expected_ref = OntologyRef(release="pinned", sha256=digest)
            app.state.ontology = OntologyService.load(primary_path, expected_ref)

        # Security middleware for API requests
        @app.middleware("http")
        async def security_middleware(request: Request, call_next):  # type: ignore[no-untyped-def]
            if request.url.path.startswith("/api/"):
                try:
                    verify_security(request, config.session_token, config.port)
                except HTTPException as exc:
                    return JSONResponse(
                        status_code=exc.status_code,
                        content={"detail": exc.detail},
                    )
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
