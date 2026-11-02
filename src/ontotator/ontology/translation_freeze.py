"""Which translations a project froze, and which uploads do not reach it (#254).

A project's search conditions (``project_search_conditions``) are captured at
the first use of its ontology and record the translation files the search ran
with. A later upload does not change them. This module only reads them; it
never captures or changes conditions.

A lead can move the project to the newest translations
(``ProjectService.refresh_translations``). The row then holds the new
conditions; the ones they replace are kept, whole, in the append-only audit
entry of that change (``superseded_search_conditions``), as are the ones a
change of pins or profile ends. Search events name the condition they ran
under by ``search_condition_id``, so :func:`condition_history` keeps every
earlier condition resolvable.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from sqlalchemy import Connection, select

from ontotator.ontology.translations import parse_translation_name
from ontotator.storage.tables import (
    AuditEventRow,
    OntologyFileRow,
    ProjectRow,
    ProjectSearchConditionsRow,
)

# The audit action of a move to the newest translations.
REFRESH_ACTION = "project.translations_refresh"
# The audit detail that keeps the conditions a change replaced or ended.
SUPERSEDED = "superseded_search_conditions"
# Actions whose audit entry can carry SUPERSEDED: a refresh, and a change of
# pins or profile (``project.update``), which ends the freeze.
_HISTORY_ACTIONS = (REFRESH_ACTION, "project.update")

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


@dataclass(frozen=True)
class SupersededConditions:
    """Search conditions a project used until ``at``, kept in the audit trail."""

    at: datetime
    actor_label: str
    # The account behind the change; ``None`` for a process such as the CLI.
    actor_user_id: int | None
    action: str
    conditions: list[dict[str, Any]]


def condition_history(conn: Connection, project_id: int) -> list[SupersededConditions]:
    """The project's earlier search conditions, oldest first.

    Read from the append-only audit entries that replaced or ended them; the
    current conditions are not among them.
    """
    rows = conn.execute(
        select(
            AuditEventRow.at,
            AuditEventRow.actor_label,
            AuditEventRow.actor_user_id,
            AuditEventRow.action,
            AuditEventRow.details[SUPERSEDED],
        )
        .where(
            AuditEventRow.project_id == project_id,
            AuditEventRow.action.in_(_HISTORY_ACTIONS),
            AuditEventRow.details.has_key(SUPERSEDED),
        )
        .order_by(AuditEventRow.at, AuditEventRow.id)
    ).tuples()
    return [
        SupersededConditions(at, label, user_id, action, list(conditions))
        for at, label, user_id, action, conditions in rows
        if conditions
    ]


def _files(condition: Mapping[str, Any]) -> list[tuple[str, str, tuple[str, ...]]]:
    return sorted(
        (
            str(item.get("filename")),
            str(item.get("sha256")),
            tuple(item.get("languages") or ()),
        )
        for item in condition.get("translations") or []
    )


def same_translations(a: Mapping[str, Any], b: Mapping[str, Any]) -> bool:
    """Whether two conditions hold the same translation files."""
    return _files(a) == _files(b)


@dataclass(frozen=True)
class TranslationChanges:
    """Translation files a move to other conditions adds, replaces or drops."""

    added: list[str] = field(default_factory=list)
    replaced: list[str] = field(default_factory=list)
    removed: list[str] = field(default_factory=list)

    @property
    def empty(self) -> bool:
        return not (self.added or self.replaced or self.removed)


def translation_changes(
    before: Sequence[Mapping[str, Any]], after: Sequence[Mapping[str, Any]]
) -> TranslationChanges:
    """File names whose content differs between two lists of conditions."""
    old = {(f.ontology_sha256, f.filename): f.sha256 for f in frozen_files(before)}
    new = {(f.ontology_sha256, f.filename): f.sha256 for f in frozen_files(after)}
    return TranslationChanges(
        added=sorted({name for (_oid, name) in new.keys() - old.keys()}),
        replaced=sorted(
            {
                name
                for (oid, name), sha in new.items()
                if (oid, name) in old and old[oid, name] != sha
            }
        ),
        removed=sorted({name for (_oid, name) in old.keys() - new.keys()}),
    )
