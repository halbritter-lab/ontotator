from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from pydantic import BaseModel, Field


class PersistentConfig(BaseModel):
    """Configuration state persisted across restarts."""

    workspace_dir: Path = Path("./workspace")
    ontology_paths: list[Path] = Field(default_factory=list)
    port: int = 8000
    host: str = "127.0.0.1"
    auto_open_browser: bool = True


def get_default_config_path() -> Path:
    """Resolve standard OS configuration path for ontocurator."""
    config_env = os.environ.get("ONTOCURATOR_CONFIG_PATH")
    if config_env:
        return Path(config_env)

    if sys.platform == "win32":
        app_data = os.environ.get("APPDATA")
        base = Path(app_data) if app_data else Path.home() / "AppData" / "Roaming"
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        xdg_config = os.environ.get("XDG_CONFIG_HOME")
        base = Path(xdg_config) if xdg_config else Path.home() / ".config"

    return base / "ontocurator" / "config.json"


def load_persistent_config(custom_path: Path | None = None) -> PersistentConfig:
    """Load persistent configuration, falling back cleanly to defaults if missing or corrupted."""
    target = custom_path or get_default_config_path()
    if not target.is_file():
        return PersistentConfig()

    try:
        content = target.read_text(encoding="utf-8")
        data = json.loads(content)
        return PersistentConfig.model_validate(data)
    except Exception:
        return PersistentConfig()


def save_persistent_config(
    config: PersistentConfig, custom_path: Path | None = None
) -> None:
    """Save persistent configuration atomically."""
    target = custom_path or get_default_config_path()
    target.parent.mkdir(parents=True, exist_ok=True)

    tmp_file = target.with_suffix(".tmp")
    data = config.model_dump(mode="json")
    data["workspace_dir"] = str(config.workspace_dir.resolve())
    data["ontology_paths"] = [str(p.resolve()) for p in config.ontology_paths]

    tmp_file.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp_file.replace(target)
