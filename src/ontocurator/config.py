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
    database_path: Path | None = None
    ontology_path: Path | None = None
    ontology_paths: list[Path] = []
    expected_ontology_ref: OntologyRef | None = None
    session_token: str
    host: str = "127.0.0.1"
    port: int = 8000
    web_dir: Path | None = None
    axes_config: AxesConfig | None = None
    # Presets of a preconfigured distribution (ontocurator-settings.json).
    distribution: DistributionSettings = Field(default_factory=DistributionSettings)
    # Active settings file (config.json) and the settings file of an earlier
    # per-user installation; both None disables the "earlier installation" notice.
    config_path: Path | None = None
    legacy_config_path: Path | None = None
    # True when the bundle ships ontocurator-settings.json: then the settings
    # of an earlier installation are ignored entirely.
    preconfigured: bool = False
