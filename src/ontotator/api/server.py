"""Environment-only Uvicorn factory for container serving."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI
from sqlalchemy.exc import OperationalError

from ontotator.api.app import _runtime_lease, create_app
from ontotator.api.health import ReadinessProbe, router
from ontotator.api.proxy_guard import TrustedPeerGuard
from ontotator.api.security import install_security
from ontotator.config import AppConfig
from ontotator.domain.errors import DomainError
from ontotator.settings import ServerSettings, demo_logins, server_settings

logger = logging.getLogger(__name__)


def _web_dir() -> Path | None:
    embedded = Path(__file__).resolve().parents[1] / "web"
    source = Path(__file__).resolve().parents[3] / "frontend" / "dist"
    return next(
        (path for path in (embedded, source) if (path / "index.html").is_file()), None
    )


def app_from_env() -> FastAPI:
    """Build one worker; a pending migration exposes health alone until a restart."""
    runtime = server_settings()
    production = runtime.environment == "production"
    hosts = ["localhost", "127.0.0.1", "::1"]
    if runtime.public_origin:
        name = urlsplit(runtime.public_origin).hostname
        if name is not None:
            hosts.append(name)
    config = AppConfig(
        workspace_dir=runtime.data_dir,
        # create_app resolves file passwords itself. Passing the completed URL
        # would look like contradictory inline + file credentials to it.
        database_url=os.environ["ONTOTATOR_DATABASE_URL"],
        host="0.0.0.0",
        port=8000,
        web_dir=_web_dir(),
        public_origin=runtime.public_origin,
        admin_password_hash=runtime.admin_password_hash,
        trusted_hosts=tuple(hosts),
        # The container binds 0.0.0.0; only the public origin can be checked.
        demo_logins=demo_logins(public_origin=runtime.public_origin),
        lock_timeout_ms=runtime.lock_timeout_ms,
        statement_timeout_ms=runtime.statement_timeout_ms,
    )
    try:
        return _guarded(create_app(config, expose_docs=not production), runtime)
    except DomainError as exc:
        if not production or exc.code != "DATABASE_NOT_MIGRATED":
            raise
    except OperationalError:
        if not production:
            raise
        # Exit so the supervisor retries until the database is up (host reboot).
        # ``from None`` keeps psycopg's message (host, user) out of the log.
        raise RuntimeError(
            "Database unavailable at startup; exiting so the process is restarted."
        ) from None
    # No accounts, sessions, static assets, or API routes are initialized.
    # Logs and HTTP output deliberately omit exception/connection details.
    logger.warning(
        "Database migration required; serving health checks only. Restart after migrating."
    )
    app = FastAPI(
        docs_url=None, redoc_url=None, openapi_url=None, lifespan=_runtime_lease
    )
    app.state.draining = False
    app.state.readiness_probe = ReadinessProbe()
    app.state.health_database_url = runtime.database_url
    install_security(app, None, runtime.public_origin, tuple(hosts))
    app.include_router(router)
    return _guarded(app, runtime)


def _guarded(app: FastAPI, runtime: ServerSettings) -> FastAPI:
    """Production: accept only the trusted proxy and loopback (see proxy_guard).

    ``serve --production`` runs uvicorn without its own proxy-header handling;
    this outermost middleware applies X-Forwarded-* from the trusted proxies.
    """
    if runtime.environment == "production":
        app.add_middleware(TrustedPeerGuard, trusted_proxies=runtime.trusted_proxies)
    return app
