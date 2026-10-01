"""Application configuration for local HPO editor."""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, ConfigDict

from hpo_editor.domain.documents import OntologyRef


class AppConfig(BaseModel):
    """Configuration container for editor database, ontology, and local server."""

    model_config = ConfigDict(extra="forbid")

    workspace_dir: Path
    database_path: Path
    ontology_path: Path
    expected_ontology_ref: OntologyRef | None = None
    session_token: str
    host: str = "127.0.0.1"
    port: int = 8000
    web_dir: Path | None = None
