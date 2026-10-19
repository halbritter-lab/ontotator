"""Editor preferences per user, stored in ``user_preferences``."""

from __future__ import annotations

import contextlib
from typing import Any

from pydantic import ValidationError
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ontocurator.application.preferences import (
    MultilingualSearchPreferences,
    Preferences,
    PreferencesUpdate,
    clean_languages,
)
from ontocurator.storage.database import Database
from ontocurator.storage.tables import UserPreferencesRow

_MODES = ("independent", "review", "assisted")


def _from_stored(data: object) -> Preferences:
    """The stored preferences; an entry that does not fit today's rules is left out.

    Keys an earlier version stored are ignored, and dropped by the next update.
    """
    prefs = Preferences()
    if not isinstance(data, dict):
        return prefs
    with contextlib.suppress(ValidationError):
        prefs.last_annotator_id = Preferences.model_validate(
            {"last_annotator_id": data.get("last_annotator_id")}
        ).last_annotator_id
    if data.get("multilingual_search") is not None:
        with contextlib.suppress(ValidationError):
            prefs.multilingual_search = MultilingualSearchPreferences.model_validate(
                data["multilingual_search"]
            )
    modes = data.get("mode_by_package")
    if isinstance(modes, dict):
        for project_key, mode in modes.items():
            if isinstance(project_key, str) and mode in _MODES:
                prefs.mode_by_package[project_key] = mode
    selections = data.get("search_languages_by_annotator")
    if isinstance(selections, dict):
        for annotator_id, languages in selections.items():
            codes = clean_languages(languages)
            if isinstance(annotator_id, str) and codes is not None:
                prefs.search_languages_by_annotator[annotator_id] = codes
    return prefs


class UserPreferencesStore:
    """Load and update the preferences of one user."""

    def __init__(self, db: Database) -> None:
        self.db = db

    def load(self, user_id: int) -> Preferences:
        """The user's preferences; empty ones if nothing was stored yet."""
        with self.db.transaction() as conn:
            stored = conn.execute(
                select(UserPreferencesRow.preferences).where(
                    UserPreferencesRow.user_id == user_id
                )
            ).scalar_one_or_none()
        return _from_stored(stored)

    def update(self, user_id: int, change: PreferencesUpdate) -> Preferences:
        """Merge ``change`` into the stored preferences.

        Omitted fields are kept; modes merge per package and search languages
        per annotator. The row is created empty if missing and then locked
        (``FOR UPDATE``), so concurrent updates of one user merge one after
        another instead of overwriting each other.
        """
        with self.db.transaction() as conn:
            conn.execute(
                pg_insert(UserPreferencesRow)
                .values(user_id=user_id, preferences={})
                .on_conflict_do_nothing()
            )
            stored: Any = conn.execute(
                select(UserPreferencesRow.preferences)
                .where(UserPreferencesRow.user_id == user_id)
                .with_for_update()
            ).scalar_one()
            prefs = _from_stored(stored)
            if "multilingual_search" in change.model_fields_set:
                prefs.multilingual_search = change.multilingual_search
            if "last_annotator_id" in change.model_fields_set:
                prefs.last_annotator_id = change.last_annotator_id
            if change.mode_by_package:
                prefs.mode_by_package.update(change.mode_by_package)
            if change.search_languages_by_annotator:
                prefs.search_languages_by_annotator.update(
                    change.search_languages_by_annotator
                )
            conn.execute(
                update(UserPreferencesRow)
                .where(UserPreferencesRow.user_id == user_id)
                .values(preferences=prefs.model_dump(mode="json"))
            )
        return prefs
