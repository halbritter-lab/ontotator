"""Application configuration for local HPO editor."""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, ConfigDict, field_validator

from ontotator import settings
from ontotator.domain.axes import AxesConfig
from ontotator.domain.documents import OntologyRef


class AppConfig(BaseModel):
    """Configuration container for editor database, ontology, and local server."""

    model_config = ConfigDict(extra="forbid")

    workspace_dir: Path
    # PostgreSQL URL of the application role. None: ONTOTATOR_DATABASE_URL.
    database_url: str | None = None
    ontology_path: Path | None = None
    ontology_paths: list[Path] = []
    # Folders besides <workspace>/ontologies in which translation files
    # (hp-de.babelon.tsv) are looked for (serve --translations-dir).
    translation_dirs: list[Path] = []
    expected_ontology_ref: OntologyRef | None = None
    host: str = "127.0.0.1"
    port: int = 8000
    web_dir: Path | None = None
    axes_config: AxesConfig | None = None
    # The address people open, e.g. https://editor.example.org. It is the only
    # origin accepted for writes; an https origin makes the cookie Secure.
    # None: the origin of each request's own Host header (local use).
    public_origin: str | None = None
    # Argon2id hash of the first administrator's password (created once).
    admin_password_hash: str | None = None
    # Host names (without port) the server answers to; any other Host header
    # gets 400 HOST_NOT_ALLOWED, so a rebound DNS name reaches nothing.
    # Matched lower-case, IDN names in punycode (as browsers send them).
    # None: every host (tests); `serve` always sets them.
    trusted_hosts: tuple[str, ...] | None = None
    # DEMO ONLY (ONTOTATOR_DEMO_LOGINS_FILE): one-click logins on the login
    # page of a loopback demo stack; their passwords reach every browser.
    demo_logins: tuple[settings.DemoLogin, ...] = ()
    max_upload_bytes: int = 50 * 1024 * 1024
    max_ontology_bytes: int = 300 * 1024 * 1024
    # Any other request body (JSON etc.), login and code redemption included.
    max_request_bytes: int = 1024 * 1024

    @field_validator("max_ontology_bytes", "max_upload_bytes", "max_request_bytes")
    @classmethod
    def _positive_ontology_limit(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("Upload byte limit must be positive")
        return value

    @field_validator("public_origin")
    @classmethod
    def _canonical_origin(cls, value: str | None) -> str | None:
        return None if value is None else settings.canonical_origin(value)

    @field_validator("trusted_hosts")
    @classmethod
    def _lower_case_hosts(cls, value: tuple[str, ...] | None) -> tuple[str, ...] | None:
        return None if value is None else tuple(map(settings.ascii_host, value))
