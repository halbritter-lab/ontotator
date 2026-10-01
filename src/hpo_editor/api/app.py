"""FastAPI application factory and middleware wiring."""

from __future__ import annotations

import hashlib
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from hpo_editor.api.routes import router
from hpo_editor.api.security import verify_security
from hpo_editor.config import AppConfig
from hpo_editor.domain.documents import OntologyRef
from hpo_editor.domain.errors import (
    DomainError,
    IncompleteReview,
    InvalidPackage,
    RevisionConflict,
)
from hpo_editor.ontology.service import OntologyService
from hpo_editor.storage.database import Database
from hpo_editor.storage.repository import Repository


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
        db = Database(config.database_path)
        repo = Repository(db)

        expected_ref = config.expected_ontology_ref
        if expected_ref is None:
            raw = config.ontology_path.read_bytes()
            digest = hashlib.sha256(raw).hexdigest()
            expected_ref = OntologyRef(release="pinned", sha256=digest)

        ontology = OntologyService.load(config.ontology_path, expected_ref)

        app.state.config = config
        app.state.repo = repo
        app.state.ontology = ontology

        # Security middleware for API requests
        @app.middleware("http")
        async def security_middleware(request: Request, call_next):  # type: ignore[no-untyped-def]
            if request.url.path.startswith("/api/"):
                try:
                    verify_security(request, config.session_token)
                except HTTPException as exc:
                    return JSONResponse(
                        status_code=exc.status_code,
                        content={"detail": exc.detail},
                    )
            return await call_next(request)

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
