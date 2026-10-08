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

MAX_SEARCH_LANGUAGES = 32

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


def _clean_languages(value: object) -> list[str] | None:
    """A stored language selection: short lower-case codes, each once."""
    if not isinstance(value, list) or len(value) > MAX_SEARCH_LANGUAGES:
        return None
    codes: list[str] = []
    for item in value:
        if not isinstance(item, str):
            return None
        code = item.strip().lower()
        if not (2 <= len(code) <= 8 and code.isascii() and code.isalpha()):
            return None
        if code not in codes:
            codes.append(code)
    return codes


def _check_search_languages(
    value: dict[str, list[str]] | None,
) -> dict[str, list[str]] | None:
    if value is None:
        return None
    checked: dict[str, list[str]] = {}
    for annotator_id, languages in value.items():
        codes = _clean_languages(languages)
        if codes is None:
            raise ValueError("languages must be a short list of language codes")
        checked[normalize_annotator_id(annotator_id)] = codes
    return checked


class LegacyConfigDecision(BaseModel):
    """What was decided about the settings file of an earlier installation.

    Bound to the file's SHA-256: if that file changes later, the notice is
    shown again.
    """

    model_config = ConfigDict(extra="ignore")

    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    action: Literal["dismissed", "imported"]


class Preferences(BaseModel):
    """Workspace preferences returned by ``GET /api/v1/preferences``."""

    model_config = ConfigDict(extra="ignore")

    last_annotator_id: str | None = None
    mode_by_package: dict[str, PreferenceMode] = Field(default_factory=dict)
    # Annotator id -> translation languages that annotator searches in. No
    # entry means the annotator never chose: all loaded languages are searched.
    search_languages_by_annotator: dict[str, list[str]] = Field(default_factory=dict)

    validate_annotator = field_validator("last_annotator_id")(_check_annotator)


class _StoredPreferences(Preferences):
    """File content: the public preferences plus internal bookkeeping."""

    legacy_config: LegacyConfigDecision | None = None

    def public(self) -> Preferences:
        return Preferences.model_validate(self.model_dump(exclude={"legacy_config"}))


class PreferencesUpdate(BaseModel):
    """Partial update: omitted fields are kept, modes are merged per package."""

    model_config = ConfigDict(extra="forbid")

    last_annotator_id: str | None = None
    mode_by_package: dict[str, PreferenceMode] | None = None
    # Merged per annotator: the given annotators' selections are replaced, the
    # others are kept.
    search_languages_by_annotator: dict[str, list[str]] | None = None

    validate_annotator = field_validator("last_annotator_id")(_check_annotator)
    validate_search_languages = field_validator("search_languages_by_annotator")(
        _check_search_languages
    )


class PreferencesStore:
    """Read/write ``preferences.json`` atomically (thread-safe in-process)."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()

    def _read(self) -> _StoredPreferences:
        try:
            raw = self.path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return _StoredPreferences()
        except OSError as exc:
            logger.warning("Cannot read %s: %s", self.path, exc)
            return _StoredPreferences()
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("Ignoring unreadable preferences file %s", self.path)
            return _StoredPreferences()
        if not isinstance(data, dict):
            return _StoredPreferences()
        prefs = _StoredPreferences()
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
        selections = data.get("search_languages_by_annotator")
        if isinstance(selections, dict):
            for annotator_id, languages in selections.items():
                codes = _clean_languages(languages)
                if isinstance(annotator_id, str) and codes is not None:
                    prefs.search_languages_by_annotator[annotator_id] = codes
        with contextlib.suppress(ValidationError):
            if isinstance(data.get("legacy_config"), dict):
                prefs.legacy_config = LegacyConfigDecision.model_validate(
                    data["legacy_config"]
                )
        return prefs

    def load(self) -> Preferences:
        with self._lock:
            return self._read().public()

    def legacy_decision(self) -> LegacyConfigDecision | None:
        """Decision about an earlier installation's settings file, if any."""
        with self._lock:
            return self._read().legacy_config

    def update(self, change: PreferencesUpdate) -> Preferences:
        with self._lock:
            prefs = self._read()
            if "last_annotator_id" in change.model_fields_set:
                prefs.last_annotator_id = change.last_annotator_id
            if change.mode_by_package:
                prefs.mode_by_package.update(change.mode_by_package)
            if change.search_languages_by_annotator:
                prefs.search_languages_by_annotator.update(
                    change.search_languages_by_annotator
                )
            self._write(prefs)
            return prefs.public()

    def record_legacy_config(
        self, sha256: str, action: Literal["dismissed", "imported"]
    ) -> None:
        """Remember the decision about an earlier installation's settings file."""
        with self._lock:
            prefs = self._read()
            prefs.legacy_config = LegacyConfigDecision(sha256=sha256, action=action)
            self._write(prefs)

    def _write(self, prefs: _StoredPreferences) -> None:
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
