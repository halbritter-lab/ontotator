"""Environment-only Uvicorn factory for container serving."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI
from sqlalchemy.exc import OperationalError

from ontocurator.api.app import _runtime_lease, create_app
from ontocurator.api.health import ReadinessProbe, router
from ontocurator.api.security import install_security
from ontocurator.config import AppConfig
from ontocurator.domain.errors import DomainError
from ontocurator.settings import demo_logins, server_settings

logger = logging.getLogger(__name__)


def _web_dir() -> Path | None:
    embedded = Path(__file__).resolve().parents[1] / "web"
    source = Path(__file__).resolve().parents[3] / "frontend" / "dist"
    return next(
        (path for path in (embedded, source) if (path / "index.html").is_file()), None
    )


def app_from_env() -> FastAPI:
    """Build one worker; DB outages expose health alone until a restart."""
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
        database_url=os.environ["ONTOCURATOR_DATABASE_URL"],
        host="0.0.0.0",
        port=8000,
        web_dir=_web_dir(),
        public_origin=runtime.public_origin,
        admin_password_hash=runtime.admin_password_hash,
        trusted_hosts=tuple(hosts),
        # The container binds 0.0.0.0; only the public origin can be checked.
        demo_logins=demo_logins(public_origin=runtime.public_origin),
    )
    try:
        return create_app(config, expose_docs=not production)
    except DomainError as exc:
        if not production or exc.code != "DATABASE_NOT_MIGRATED":
            raise
    except OperationalError:
        if not production:
            raise
    # No accounts, sessions, static assets, or API routes are initialized.
    # Logs and HTTP output deliberately omit exception/connection details.
    logger.warning(
        "Database unavailable or migration required; serving health checks only. Restart after recovery."
    )
    app = FastAPI(
        docs_url=None, redoc_url=None, openapi_url=None, lifespan=_runtime_lease
    )
    app.state.draining = False
    app.state.readiness_probe = ReadinessProbe()
    app.state.health_database_url = runtime.database_url
    install_security(app, None, runtime.public_origin, tuple(hosts))
    app.include_router(router)
    return app
