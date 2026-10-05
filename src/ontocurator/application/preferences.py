"""Small per-workspace user preferences (last identity, mode per package).

Stored as ``<workspace>/preferences.json`` next to the database rather than in
the browser, so a freshly unpacked copy on a shared computer never inherits
the previous person's identity. Kept out of the SQLite schema on purpose: it
is convenience state, not curation data, and needs no schema migration.
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
import secrets
import threading
import unicodedata
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

logger = logging.getLogger(__name__)

PREFERENCES_FILENAME = "preferences.json"
MAX_ANNOTATOR_ID_LENGTH = 64

PreferenceMode = Literal["independent", "review", "assisted"]


def normalize_annotator_id(value: str) -> str:
    """Trim and validate an annotator identity (initials or short ID)."""
    trimmed = value.strip()
    if not trimmed:
        raise ValueError("must not be empty")
    if len(trimmed) > MAX_ANNOTATOR_ID_LENGTH:
        raise ValueError(f"must be at most {MAX_ANNOTATOR_ID_LENGTH} characters")
    if any(unicodedata.category(ch)[0] == "C" for ch in trimmed):
        raise ValueError("must not contain control or invisible characters")
    return trimmed


def _check_annotator(value: str | None) -> str | None:
    return None if value is None else normalize_annotator_id(value)


class Preferences(BaseModel):
    """Workspace preferences returned by ``GET /api/v1/preferences``."""

    model_config = ConfigDict(extra="ignore")

    last_annotator_id: str | None = None
    mode_by_package: dict[str, PreferenceMode] = Field(default_factory=dict)

    validate_annotator = field_validator("last_annotator_id")(_check_annotator)


class PreferencesUpdate(BaseModel):
    """Partial update: omitted fields are kept, modes are merged per package."""

    model_config = ConfigDict(extra="forbid")

    last_annotator_id: str | None = None
    mode_by_package: dict[str, PreferenceMode] | None = None

    validate_annotator = field_validator("last_annotator_id")(_check_annotator)


class PreferencesStore:
    """Read/write ``preferences.json`` atomically (thread-safe in-process)."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()

    def _read(self) -> Preferences:
        try:
            raw = self.path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return Preferences()
        except OSError as exc:
            logger.warning("Cannot read %s: %s", self.path, exc)
            return Preferences()
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("Ignoring unreadable preferences file %s", self.path)
            return Preferences()
        if not isinstance(data, dict):
            return Preferences()
        prefs = Preferences()
        with contextlib.suppress(ValidationError):
            prefs.last_annotator_id = Preferences.model_validate(
                {"last_annotator_id": data.get("last_annotator_id")}
            ).last_annotator_id
        modes = data.get("mode_by_package")
        if isinstance(modes, dict):
            for package_id, mode in modes.items():
                if isinstance(package_id, str) and mode in (
                    "independent",
                    "review",
                    "assisted",
                ):
                    prefs.mode_by_package[package_id] = mode
        return prefs

    def load(self) -> Preferences:
        with self._lock:
            return self._read()

    def update(self, change: PreferencesUpdate) -> Preferences:
        with self._lock:
            prefs = self._read()
            if "last_annotator_id" in change.model_fields_set:
                prefs.last_annotator_id = change.last_annotator_id
            if change.mode_by_package:
                prefs.mode_by_package.update(change.mode_by_package)
            self._write(prefs)
            return prefs

    def _write(self, prefs: Preferences) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(f".preferences.{secrets.token_hex(4)}.tmp")
        try:
            tmp.write_text(
                json.dumps(prefs.model_dump(), indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            os.replace(tmp, self.path)
        finally:
            if tmp.exists():
                tmp.unlink()
