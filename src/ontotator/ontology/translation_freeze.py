"""Which translations a project froze, and which uploads do not reach it (#254).

A project's search conditions (``project_search_conditions``) are captured at
the first use of its ontology and record the translation files the search ran
with. A later upload does not change them. This module only reads them; it
never captures or changes conditions.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from sqlalchemy import Connection, select

from ontotator.ontology.translations import parse_translation_name
from ontotator.storage.tables import (
    OntologyFileRow,
    ProjectRow,
    ProjectSearchConditionsRow,
)

# Translation SHA-256 -> project keys.
ProjectsBySha = dict[str, list[str]]


@dataclass(frozen=True)
class FrozenFile:
    """One translation file of a frozen search condition."""

    ontology_sha256: str
    filename: str
    sha256: str
    languages: tuple[str, ...]


def ontology_prefixes(
    conn: Connection, loaded: Mapping[str, str] | None = None
) -> dict[str, str]:
    """Lower-case dominant prefix by ontology SHA-256.

    Uploaded ontologies come from ``ontology_files``; ``loaded`` adds the
    ontologies a registry holds that were not uploaded (configured paths,
    bundle ontologies).
    """
    prefixes = {sha: prefix.lower() for sha, prefix in (loaded or {}).items()}
    prefixes.update(
        conn.execute(
            select(OntologyFileRow.sha256, OntologyFileRow.prefix).where(
                OntologyFileRow.kind == "ontology"
            )
        )
        .tuples()
        .all()
    )
    return prefixes


def _condition_prefix(
    condition: Mapping[str, Any], prefixes: Mapping[str, str]
) -> str | None:
    prefix = prefixes.get(str(condition.get("ontology_sha256", "")))
    if prefix is not None:
        return prefix
    # An ontology no longer known here: its captured files still name it.
    for item in condition.get("translations") or []:
        parsed = parse_translation_name(str(item.get("filename", "")))
        if parsed is not None:
            return parsed[0]
    return None


def _shas(condition: Mapping[str, Any]) -> set[str]:
    return {str(item.get("sha256")) for item in condition.get("translations") or []}


def frozen_files(conditions: Iterable[Mapping[str, Any]]) -> list[FrozenFile]:
    """The translation files of stored conditions, in their stored order."""
    return [
        FrozenFile(
            ontology_sha256=str(condition.get("ontology_sha256", "")),
            filename=str(item.get("filename", "")),
            sha256=str(item.get("sha256", "")),
            languages=tuple(item.get("languages") or ()),
        )
        for condition in conditions
        for item in condition.get("translations") or []
    ]


def latest_translations(conn: Connection) -> dict[str, tuple[str, str]]:
    """``filename -> (sha256, prefix)`` of the file a new project would take.

    A later upload of the same name replaces an earlier one, as in
    :meth:`OntologyStore._latest_translations`.
    """
    latest: dict[str, tuple[str, str]] = {}
    for sha, filename, prefix in conn.execute(
        select(OntologyFileRow.sha256, OntologyFileRow.filename, OntologyFileRow.prefix)
        .where(OntologyFileRow.kind == "translation")
        .order_by(OntologyFileRow.uploaded_at, OntologyFileRow.sha256)
    ).tuples():
        latest[filename] = (sha, prefix.lower())
    return latest


def not_included(
    conn: Connection,
    conditions: Iterable[Mapping[str, Any]],
    prefixes: Mapping[str, str],
) -> list[str]:
    """Current translation files of the conditions' ontologies they lack."""
    conditions = list(conditions)
    missing: set[str] = set()
    for filename, (sha, prefix) in latest_translations(conn).items():
        for condition in conditions:
            if _condition_prefix(condition, prefixes) == prefix and sha not in _shas(
                condition
            ):
                missing.add(filename)
    return sorted(missing)


def projects_without(conn: Connection, prefixes: Mapping[str, str]) -> ProjectsBySha:
    """Translation SHA-256 -> keys of projects frozen without that file.

    Only projects whose conditions are already captured and cover an
    ontology of the file's prefix are named: any other project takes the
    file at its first use, or never uses it.
    """
    translations = (
        conn.execute(
            select(OntologyFileRow.sha256, OntologyFileRow.prefix).where(
                OntologyFileRow.kind == "translation"
            )
        )
        .tuples()
        .all()
    )
    if not translations:
        return {}
    frozen = (
        conn.execute(
            select(ProjectRow.project_key, ProjectSearchConditionsRow.conditions)
            .join(ProjectRow, ProjectRow.id == ProjectSearchConditionsRow.project_id)
            .where(ProjectRow.practice.is_(False))
            .order_by(ProjectRow.project_key)
        )
        .tuples()
        .all()
    )
    result: dict[str, list[str]] = {}
    for key, conditions in frozen:
        by_prefix: dict[str, list[set[str]]] = {}
        for condition in conditions or []:
            prefix = _condition_prefix(condition, prefixes)
            if prefix is not None:
                by_prefix.setdefault(prefix, []).append(_shas(condition))
        for sha, prefix in translations:
            if any(sha not in used for used in by_prefix.get(prefix.lower(), [])):
                result.setdefault(sha, []).append(key)
    return result
