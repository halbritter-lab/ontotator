"""Persistent configuration and runtime location resolution.

Location rules (see README "Where your data lives"):

* **Portable mode** - a frozen (PyInstaller) executable whose folder is writable
  and contains a ``portable.txt`` marker or a bundled ``workspace/`` folder. The
  config file lives next to the executable and paths inside the app folder are
  stored *relative* to it, so the whole folder can be moved or re-extracted.
* **Per-user mode** - any other frozen build (e.g. a macOS ``.app`` or a read-only
  install location). Config goes to the OS user config dir, the default
  workspace to the local (non-roaming) user data dir, e.g.
  ``%LOCALAPPDATA%\\Ontocurator\\workspace``. ``Documents`` is avoided because it
  is frequently synced by OneDrive & co., which can corrupt a live SQLite file.
* **Development mode** - running from source. Config goes to the OS user config
  dir, the default workspace is ``./workspace`` relative to the current
  directory. Pass ``--workspace`` explicitly for anything but local hacking.

``ONTOCURATOR_CONFIG_PATH`` overrides the config file location in every mode.
"""

from __future__ import annotations

import contextlib
import json
import os
import sys
import tempfile
from pathlib import Path, PurePath
from typing import Any

import platformdirs
from pydantic import BaseModel, Field

APP_NAME = "ontocurator"
PORTABLE_MARKER = "portable.txt"
CONFIG_FILENAME = "config.json"


class PersistentConfig(BaseModel):
    """Configuration state persisted across restarts."""

    workspace_dir: Path = Path("./workspace")
    ontology_paths: list[Path] = Field(default_factory=list)
    port: int = 8000
    host: str = "127.0.0.1"
    auto_open_browser: bool = True


def is_frozen() -> bool:
    """Return True when running from a PyInstaller (or similar) bundle."""
    return bool(getattr(sys, "frozen", False))


def app_dir() -> Path:
    """Folder containing the running executable (frozen) or the CWD (source)."""
    if is_frozen():
        return Path(sys.executable).resolve().parent
    return Path.cwd()


def _is_writable_dir(path: Path) -> bool:
    if not path.is_dir():
        return False
    try:
        with tempfile.TemporaryFile(dir=path):
            pass
    except OSError:
        return False
    return True


def detect_portable_root(
    executable_dir: Path | None = None, *, frozen: bool | None = None
) -> Path | None:
    """Return the portable app folder, or None when not running portably."""
    frozen = is_frozen() if frozen is None else frozen
    if not frozen:
        return None
    root = executable_dir if executable_dir is not None else app_dir()
    has_marker = (root / PORTABLE_MARKER).is_file() or (root / "workspace").is_dir()
    if has_marker and _is_writable_dir(root):
        return root
    return None


def user_config_dir() -> Path:
    return Path(platformdirs.user_config_dir(APP_NAME, appauthor=False, roaming=True))


def get_default_config_path() -> Path:
    """Resolve the configuration file path for the current runtime mode."""
    config_env = os.environ.get("ONTOCURATOR_CONFIG_PATH")
    if config_env:
        return Path(config_env)
    portable = detect_portable_root()
    if portable is not None:
        return portable / CONFIG_FILENAME
    return user_config_dir() / CONFIG_FILENAME


def default_workspace_dir() -> Path:
    """Default workspace when neither a flag nor saved configuration names one."""
    portable = detect_portable_root()
    if portable is not None:
        return portable / "workspace"
    if is_frozen():
        # Local, non-roaming app data: not synced by OneDrive/iCloud & co.
        data_dir = platformdirs.user_data_dir("Ontocurator", appauthor=False)
        return Path(data_dir) / "workspace"
    return (Path.cwd() / "workspace").resolve()


# Folder names that mark a cloud-synchronised tree (compared case-insensitively).
_CLOUD_SYNC_MARKERS: tuple[tuple[str, str], ...] = (
    ("onedrive", "OneDrive"),
    ("dropbox", "Dropbox"),
    ("icloud drive", "iCloud Drive"),
    ("iclouddrive", "iCloud Drive"),
    ("mobile documents", "iCloud Drive"),
    ("google drive", "Google Drive"),
    ("googledrive", "Google Drive"),
)


def cloud_sync_provider(path: PurePath) -> str | None:
    """Name of the sync service if ``path`` lies inside a known cloud-sync folder.

    Detection is by folder name (``OneDrive``/``OneDrive - <org>``, ``Dropbox``,
    ``iCloud Drive``/``Mobile Documents``, ``Google Drive``) and is best effort.
    """
    for part in path.parts:
        name = part.lower()
        for marker, provider in _CLOUD_SYNC_MARKERS:
            if name == marker or name.startswith(marker + " -"):
                return provider
    return None


def seed_from_legacy_config(
    legacy_path: Path,
) -> tuple[PersistentConfig, list[str]]:
    """Initial portable settings taken over from a legacy per-user config file.

    Imports the ontology list (only files that still exist), the port and the
    auto-open-browser flag. The workspace is deliberately *not* imported: a
    portable installation keeps its data in its own folder. Returns the new
    configuration and human-readable notes on what was imported.
    """
    if not legacy_path.is_file():
        return PersistentConfig(), []
    legacy = load_persistent_config(legacy_path)
    fields: dict[str, Any] = {}
    notes: list[str] = []
    ontologies = [p for p in legacy.ontology_paths if p.is_file()]
    if ontologies:
        fields["ontology_paths"] = ontologies
        notes.extend(f"ontology {p}" for p in ontologies)
    if "port" in legacy.model_fields_set:
        fields["port"] = legacy.port
        notes.append(f"port {legacy.port}")
    if "auto_open_browser" in legacy.model_fields_set:
        fields["auto_open_browser"] = legacy.auto_open_browser
        notes.append(f"open browser on start: {legacy.auto_open_browser}")
    return PersistentConfig(**fields), notes


def _to_stored(path: Path, base: Path) -> str:
    """Store paths inside ``base`` relatively so the folder stays relocatable."""
    resolved = path.resolve()
    with contextlib.suppress(ValueError):
        return resolved.relative_to(base.resolve()).as_posix()
    return str(resolved)


def _from_stored(value: Any, base: Path) -> Any:
    if not isinstance(value, str):
        return value
    p = Path(value)
    return str(p if p.is_absolute() else (base / p).resolve())


def load_persistent_config(custom_path: Path | None = None) -> PersistentConfig:
    """Load persistent configuration, falling back cleanly to defaults if missing or corrupted.

    Relative paths in the file are resolved against the config file's folder.
    """
    target = custom_path or get_default_config_path()
    if not target.is_file():
        return PersistentConfig()

    try:
        data = json.loads(target.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return PersistentConfig()
        base = target.parent
        if "workspace_dir" in data:
            data["workspace_dir"] = _from_stored(data["workspace_dir"], base)
        if isinstance(data.get("ontology_paths"), list):
            data["ontology_paths"] = [
                _from_stored(v, base) for v in data["ontology_paths"]
            ]
        return PersistentConfig.model_validate(data)
    except Exception:
        return PersistentConfig()


def save_persistent_config(
    config: PersistentConfig, custom_path: Path | None = None
) -> None:
    """Save persistent configuration atomically.

    Paths below the config file's folder are written relative to it.
    """
    target = custom_path or get_default_config_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    base = target.parent

    data = config.model_dump(mode="json")
    data["workspace_dir"] = _to_stored(config.workspace_dir, base)
    data["ontology_paths"] = [_to_stored(p, base) for p in config.ontology_paths]

    tmp_file = target.with_suffix(".tmp")
    tmp_file.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp_file.replace(target)
