"""Editor preferences of a user (working mode per package, search languages).

The models and their rules live here; ``auth.preferences`` stores them per
user in the database.
"""

from __future__ import annotations

import unicodedata
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

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


def clean_languages(value: object) -> list[str] | None:
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
        codes = clean_languages(languages)
        if codes is None:
            raise ValueError("languages must be a short list of language codes")
        checked[normalize_annotator_id(annotator_id)] = codes
    return checked


class MultilingualSearchPreferences(BaseModel):
    """Personal defaults; temporary editor switches never change these."""

    model_config = ConfigDict(extra="forbid")
    enabled: bool = True
    preferred_languages: list[str] = Field(default_factory=list)
    automatic_document_language: bool = True

    @field_validator("preferred_languages")
    @classmethod
    def validate_languages(cls, value: list[str]) -> list[str]:
        cleaned = clean_languages(value)
        if cleaned is None:
            raise ValueError("languages must be a short list of language codes")
        return cleaned


class Preferences(BaseModel):
    """A user's preferences returned by ``GET /api/v1/preferences``."""

    model_config = ConfigDict(extra="ignore")

    multilingual_search: MultilingualSearchPreferences | None = None
    last_annotator_id: str | None = None
    mode_by_package: dict[str, PreferenceMode] = Field(default_factory=dict)
    # Annotator id -> translation languages that annotator searches in. No
    # entry means the annotator never chose: all loaded languages are searched.
    search_languages_by_annotator: dict[str, list[str]] = Field(default_factory=dict)

    validate_annotator = field_validator("last_annotator_id")(_check_annotator)


class PreferencesUpdate(BaseModel):
    """Partial update: omitted fields are kept, modes are merged per package."""

    model_config = ConfigDict(extra="forbid")

    multilingual_search: MultilingualSearchPreferences | None = None
    last_annotator_id: str | None = None
    mode_by_package: dict[str, PreferenceMode] | None = None
    # Merged per annotator: the given annotators' selections are replaced, the
    # others are kept.
    search_languages_by_annotator: dict[str, list[str]] | None = None

    validate_annotator = field_validator("last_annotator_id")(_check_annotator)
    validate_search_languages = field_validator("search_languages_by_annotator")(
        _check_search_languages
    )
