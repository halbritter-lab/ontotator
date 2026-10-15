"""Application configuration for local HPO editor."""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from ontocurator.distribution_settings import DistributionSettings
from ontocurator.domain.axes import AxesConfig
from ontocurator.domain.documents import OntologyRef


class AppConfig(BaseModel):
    """Configuration container for editor database, ontology, and local server."""

    model_config = ConfigDict(extra="forbid")

    workspace_dir: Path
    # PostgreSQL URL of the application role. None: ONTOCURATOR_DATABASE_URL.
    database_url: str | None = None
    ontology_path: Path | None = None
    ontology_paths: list[Path] = []
    # Folders besides <workspace>/ontologies in which translation files
    # (hp-de.babelon.tsv) are looked for (serve --translations-dir).
    translation_dirs: list[Path] = []
    expected_ontology_ref: OntologyRef | None = None
    session_token: str
    host: str = "127.0.0.1"
    port: int = 8000
    web_dir: Path | None = None
    axes_config: AxesConfig | None = None
    # Mode and identity presets. `serve` no longer reads ontocurator-settings.json,
    # so these are always the defaults until T2c replaces them with project roles.
    distribution: DistributionSettings = Field(default_factory=DistributionSettings)
