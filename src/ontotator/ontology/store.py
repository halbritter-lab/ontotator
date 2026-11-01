"""Uploaded ontology and translation files on the data volume (T2 P7, D3).

The bytes live in the blob store, the metadata in ``ontology_files``. Every
worker process registers the stored ontologies at start-up and parses one
only when it is first used, except the ones a project pins, which are
preloaded in the background. Translation files are copied to
``<data dir>/translations`` under their own names, because the translation
loader reads the prefix and language from the file name.
"""

from __future__ import annotations

import hashlib
import io
import logging
import os
import tempfile
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import Row, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ontotator.application.uploads import (
    StoredTranslation,
    TranslationUploadService,
)
from ontotator.auth.audit import Actor, record_audit
from ontotator.domain.documents import OntologyRef
from ontotator.domain.errors import DomainError
from ontotator.ontology.registry import OntologyRegistry
from ontotator.ontology.service import OntologyService
from ontotator.ontology.translation_freeze import (
    ProjectsBySha,
    ontology_prefixes,
    projects_without,
)
from ontotator.ontology.translations import parse_translation_name
from ontotator.storage.database import Database
from ontotator.storage.tables import (
    OntologyFileRow,
    ProjectOntologyRow,
    ProjectRow,
    StoredFileRow,
)
from ontotator.vendor.hpo_span_annotator.hpo import OntologyError

logger = logging.getLogger(__name__)

HPO_ROOT = "HP:0000001"
PHENOTYPIC_ABNORMALITY = "HP:0000118"
# Share of the current (not obsolete) terms that must reach HP:0000001.
_MIN_REACHING_ROOT = 0.98
# How many terms that miss the root an error names.
_UNREACHED_SHOWN = 10


def required_roots() -> tuple[str, ...]:
    """The terms every HPO release must hold (#97).

    The root, Phenotypic abnormality and the four roots the modifier
    classifier is built from: without one of those, ``subtree`` is empty and
    every modifier, onset, severity or frequency term classifies as a finding.
    """
    from ontotator.ontology.modifiers import (
        CLINICAL_MODIFIER,
        FREQUENCY,
        ONSET,
        SEVERITY,
    )

    return (
        HPO_ROOT,
        PHENOTYPIC_ABNORMALITY,
        CLINICAL_MODIFIER,
        FREQUENCY,
        SEVERITY,
        ONSET,
    )


def release_problem(service: OntologyService) -> str | None:
    """Why an HPO release is unusable: missing roots or a broken is_a graph.

    A release is refused when it lacks one of :func:`required_roots`, or when
    fewer than 98% of its current terms reach HP:0000001 through ``is_a``.
    Allowed roots a project pins are checked where the pin is set
    (``check_allowed_roots``). Other ontologies are not checked.
    """
    from ontotator.ontology.modifiers import subtree

    ontology = service.ontology
    if ontology.dominant_prefix != "HP":
        return None
    missing = [
        root
        for root in required_roots()
        if root not in ontology.terms or ontology.terms[root].obsolete
    ]
    if missing:
        return f"lacks the required HPO terms {', '.join(missing)}"
    current = sorted(t.hpo_id for t in ontology.terms.values() if not t.obsolete)
    reached = subtree(service, HPO_ROOT)
    unreached = [term_id for term_id in current if term_id not in reached]
    share = (len(current) - len(unreached)) / len(current)
    if share < _MIN_REACHING_ROOT:
        shown = ", ".join(unreached[:_UNREACHED_SHOWN])
        more = len(unreached) - _UNREACHED_SHOWN
        return (
            f"has a broken is_a graph: only {share:.0%} of its current terms "
            f"reach {HPO_ROOT}; {len(unreached)} do not ({shown}"
            + (f" and {more} more" if more > 0 else "")
            + ")"
        )
    return None


@dataclass(frozen=True)
class OntologyFile:
    """One stored ontology or translation file."""

    sha256: str
    kind: str
    prefix: str
    release: str | None
    filename: str
    language: str | None
    uploaded_at: datetime


@dataclass(frozen=True)
class OntologyAddResult:
    """A stored file and whether this call inserted its metadata row."""

    ontology: OntologyFile
    created: bool


def _base_name(filename: str) -> str:
    return filename.replace("\\", "/").rsplit("/", 1)[-1]


_FILE_COLUMNS = (
    OntologyFileRow.sha256,
    OntologyFileRow.kind,
    OntologyFileRow.prefix,
    OntologyFileRow.release,
    OntologyFileRow.filename,
    OntologyFileRow.language,
    OntologyFileRow.uploaded_at,
)


def _file(row: Row[Any]) -> OntologyFile:
    return OntologyFile(
        sha256=row.sha256,
        kind=row.kind,
        prefix=row.prefix,
        release=row.release,
        filename=row.filename,
        language=row.language,
        uploaded_at=row.uploaded_at,
    )


class OntologyStore:
    """Adds, lists and registers the ontology files of the instance."""

    def __init__(
        self, db: Database, registry: OntologyRegistry, data_dir: Path
    ) -> None:
        self.db = db
        self.registry = registry
        self.translations_dir = Path(data_dir) / "translations"
        self._use_translations_dir()
        # Filename -> sha256 of the translation files this worker has taken up.
        self._translation_version: dict[str, str] = {}
        registry.translation_sync = self.sync_translations

    # --- adding ---------------------------------------------------------

    def add(self, actor: Actor, filename: str, data: bytes) -> OntologyFile:
        """Store an ontology (``.json``) or a translation (``.tsv``).

        The file is checked first; storing a known file again is idempotent
        (no second row, no second audit event).
        """
        if _base_name(filename).lower().endswith(".tsv"):
            return self.add_translation(actor, filename, data)[0]
        return self.add_ontology(actor, filename, data)[0]

    def add_with_result(
        self, actor: Actor, filename: str, data: bytes
    ) -> OntologyAddResult:
        """Add a file with its actual INSERT outcome, including conflict losers."""
        if _base_name(filename).lower().endswith(".tsv"):
            item, _translation, created = self._add_translation(actor, filename, data)
        else:
            item, _service, created = self._add_ontology(actor, filename, data)
        return OntologyAddResult(item, created)

    def add_ontology(
        self, actor: Actor, filename: str, data: bytes
    ) -> tuple[OntologyFile, OntologyService]:
        """Parse, store and register an OBO Graph JSON ontology."""
        item, service, _created = self._add_ontology(actor, filename, data)
        return item, service

    def _add_ontology(
        self, actor: Actor, filename: str, data: bytes
    ) -> tuple[OntologyFile, OntologyService, bool]:
        name = _base_name(filename)
        digest = hashlib.sha256(data).hexdigest()
        known = self._get(digest)
        if known is not None and known.kind != "ontology":
            raise DomainError(
                "INVALID_ONTOLOGY", f"'{name}' is already stored as a translation."
            )
        # One registry change: translation files are read and the ontology is
        # built with them before another change starts.
        with self.registry.changing():
            service = self._parse(name, data, digest)
            problem = release_problem(service)
            if problem is not None:
                raise DomainError("INVALID_ONTOLOGY", f"'{name}' {problem}.")
            created = False
            if known is None:
                known, created = self._insert_with_result(
                    actor,
                    data,
                    kind="ontology",
                    prefix=(service.ontology.dominant_prefix or "unknown").lower(),
                    release=service.ontology.release,
                    filename=name,
                    language=None,
                )
            self.registry.register_path(self.db.blobs.path(digest))
            # The release the file states, as every other worker records it.
            service.ref = OntologyRef(release=service.ontology.release, sha256=digest)
            self.registry.register_service(service)
        return known, service, created

    def _parse(self, name: str, data: bytes, digest: str) -> OntologyService:
        loaded = self._loaded(digest)
        if loaded is not None:
            return loaded
        with tempfile.TemporaryDirectory(prefix="ontotator-ontology-") as tmp:
            path = Path(tmp) / "ontology.json"
            path.write_bytes(data)
            try:
                return OntologyService.load(
                    path,
                    OntologyRef(release="uploaded", sha256=digest),
                    translation_paths=self.registry.translation_files(),
                )
            except DomainError:
                raise
            except (OntologyError, ValueError, KeyError, TypeError) as exc:
                raise DomainError(
                    "INVALID_ONTOLOGY", f"'{name}' is not an ontology: {exc}"
                ) from exc

    def _loaded(self, digest: str) -> OntologyService | None:
        try:
            return self.registry.get_service(digest)
        except (DomainError, OntologyError, OSError, ValueError, KeyError):
            return None

    def add_translation(
        self, actor: Actor, filename: str, data: bytes
    ) -> tuple[OntologyFile, StoredTranslation]:
        """Check, store and publish a babelon TSV translation file.

        The ontologies of its prefix are rebuilt with the file before anything
        is stored, so a file that cannot be used changes nothing.
        """
        item, translation, _created = self._add_translation(actor, filename, data)
        return item, translation

    def _add_translation(
        self, actor: Actor, filename: str, data: bytes
    ) -> tuple[OntologyFile, StoredTranslation, bool]:
        name = _base_name(filename).lower()
        parsed = parse_translation_name(name)
        if parsed is None:
            raise DomainError(
                "INVALID_TRANSLATION",
                f"'{name}' is not a translation file name. Expected "
                "<prefix>-<language>.<kind>.tsv, e.g. hp-de.babelon.tsv.",
            )
        prefix, language = parsed
        digest = hashlib.sha256(data).hexdigest()
        known = self._get(digest)
        if known is not None and known.kind != "translation":
            raise DomainError(
                "INVALID_TRANSLATION", f"'{name}' is already stored as an ontology."
            )
        stored = TranslationUploadService(self.registry, self.translations_dir).store(
            io.BytesIO(data), name
        )
        created = False
        if known is None:
            known, created = self._insert_with_result(
                actor,
                data,
                kind="translation",
                prefix=prefix,
                release=None,
                filename=name,
                language=language,
            )
        else:
            # Uploading earlier content again makes it the latest of its name,
            # under the name it was uploaded as now.
            with self.db.transaction() as conn:
                row = conn.execute(
                    update(OntologyFileRow)
                    .where(OntologyFileRow.sha256 == digest)
                    .values(
                        uploaded_at=func.now(),
                        filename=name,
                        prefix=prefix,
                        language=language,
                    )
                    .returning(*_FILE_COLUMNS)
                ).one()
            known = _file(row)
        with self.registry.changing():
            self._translation_version[name] = digest
        return known, stored, created

    def _insert(
        self,
        actor: Actor,
        data: bytes,
        *,
        kind: str,
        prefix: str,
        release: str | None,
        filename: str,
        language: str | None,
    ) -> OntologyFile:
        return self._insert_with_result(
            actor,
            data,
            kind=kind,
            prefix=prefix,
            release=release,
            filename=filename,
            language=language,
        )[0]

    def _insert_with_result(
        self,
        actor: Actor,
        data: bytes,
        *,
        kind: str,
        prefix: str,
        release: str | None,
        filename: str,
        language: str | None,
    ) -> tuple[OntologyFile, bool]:
        with self.db.transaction() as conn:
            digest = self.db.put_blob(conn, data)
            conn.execute(
                pg_insert(StoredFileRow)
                .values(sha256=digest, size=len(data))
                .on_conflict_do_nothing()
            )
            inserted = conn.execute(
                pg_insert(OntologyFileRow)
                .values(
                    sha256=digest,
                    kind=kind,
                    prefix=prefix,
                    release=release,
                    filename=filename,
                    language=language,
                    uploaded_by=actor.user_id,
                )
                .on_conflict_do_nothing()
                .returning(OntologyFileRow.sha256)
            ).scalar_one_or_none()
            if inserted is not None:
                record_audit(
                    conn,
                    actor,
                    "ontology.add",
                    target_type="ontology_file",
                    target_id=digest,
                    details={
                        "kind": kind,
                        "prefix": prefix,
                        "release": release,
                        "filename": filename,
                        "language": language,
                    },
                )
            row = conn.execute(
                select(*_FILE_COLUMNS).where(OntologyFileRow.sha256 == digest)
            ).one()
            return _file(row), inserted is not None

    def missing_roots(self, sha256: str, roots: Iterable[str]) -> list[str]:
        """The ``roots`` the stored ontology ``sha256`` lacks.

        Empty when there are none to check or the file is not a stored,
        readable ontology; the pin checks report that case.
        """
        wanted = list(roots)
        if not wanted:
            return []
        service = self.service(sha256)
        if service is None:
            return []
        return [root for root in wanted if service.ontology.get(root) is None]

    def service(self, sha256: str) -> OntologyService | None:
        """The loaded service of the stored ontology ``sha256``.

        Loads it in this worker when another one stored it. ``None`` when the
        file is not a stored, readable ontology.
        """
        try:
            service = self.registry.get_service(sha256)
            known = self._get(sha256) if service is None else None
            if known is not None and known.kind == "ontology":
                self.registry.register_path(self.db.blobs.path(sha256))
                service = self.registry.get_service(sha256)
        except (DomainError, OntologyError, OSError, ValueError, KeyError):
            return None
        return service

    def pins_missing_roots(self) -> list[tuple[str, str, str, list[str]]]:
        """(project, ontology id, sha256, missing roots) of every pin whose
        allowed roots its release lacks; such pins are not enforced."""
        with self.db.transaction() as conn:
            pins = conn.execute(
                select(
                    ProjectRow.project_key,
                    ProjectOntologyRow.ontology_id,
                    ProjectOntologyRow.sha256,
                    ProjectOntologyRow.allowed_roots,
                )
                .join(ProjectRow, ProjectRow.id == ProjectOntologyRow.project_id)
                .order_by(ProjectRow.project_key, ProjectOntologyRow.ontology_id)
            ).all()
        found = []
        for project_key, ontology_id, sha256, roots in pins:
            missing = self.missing_roots(sha256, roots or [])
            if missing:
                found.append((project_key, ontology_id, sha256, missing))
        return found

    # --- reading ----------------------------------------------------------

    def _get(self, sha256: str) -> OntologyFile | None:
        with self.db.transaction() as conn:
            row = conn.execute(
                select(*_FILE_COLUMNS).where(OntologyFileRow.sha256 == sha256)
            ).one_or_none()
        return _file(row) if row is not None else None

    def list(self) -> list[OntologyFile]:
        """Every stored file, oldest first."""
        with self.db.transaction() as conn:
            rows = conn.execute(
                select(*_FILE_COLUMNS).order_by(
                    OntologyFileRow.uploaded_at, OntologyFileRow.sha256
                )
            )
            return [_file(row) for row in rows]

    def loaded_prefixes(self) -> dict[str, str]:
        """Dominant prefix by SHA-256 of the ontologies this worker has loaded."""
        return {
            sha: (service.ontology.dominant_prefix or "").lower()
            for sha, service in self.registry.services()
        }

    def frozen_without(self) -> ProjectsBySha:
        """Translation SHA-256 -> projects whose frozen translations lack it (#254)."""
        loaded = self.loaded_prefixes()
        with self.db.transaction() as conn:
            return projects_without(conn, ontology_prefixes(conn, loaded))

    def pinned_shas(self) -> set[str]:
        """The files any project pins."""
        with self.db.transaction() as conn:
            return set(
                conn.execute(select(ProjectOntologyRow.sha256).distinct()).scalars()
            )

    # --- start-up -----------------------------------------------------------

    def _use_translations_dir(self) -> None:
        self.translations_dir.mkdir(parents=True, exist_ok=True)
        resolved = self.translations_dir.resolve()
        if all(Path(d).resolve() != resolved for d in self.registry.translation_dirs):
            # First: an uploaded file replaces one of the same name elsewhere.
            self.registry.translation_dirs.insert(0, self.translations_dir)

    def register_all(self) -> None:
        """Register every stored ontology (parsed lazily) and place translations.

        A file that is missing or unreadable is logged and skipped; it must not
        stop the start.
        """
        files = self.list()
        with self.registry.changing():
            for item in self._place_translations(self._latest_translations(files)):
                self._translation_version[item.filename] = item.sha256
        for item in files:
            if item.kind != "ontology":
                continue
            try:
                self.registry.register_path(self.db.blobs.path(item.sha256))
            except (OSError, ValueError, DomainError) as exc:
                logger.warning(
                    "Skipping stored ontology %s (sha256 %s): %s",
                    item.filename,
                    item.sha256,
                    exc,
                )

    @staticmethod
    def _latest_translations(files: Iterable[OntologyFile]) -> Sequence[OntologyFile]:
        latest: dict[str, OntologyFile] = {}
        for item in files:
            if item.kind == "translation":
                # A later upload of the same name replaces an earlier one.
                latest[item.filename] = item
        return list(latest.values())

    def _place_translations(
        self, items: Iterable[OntologyFile]
    ) -> Sequence[OntologyFile]:
        """Place files; return those that were placed."""
        placed = []
        for item in items:
            try:
                self._place_translation(item)
            except (OSError, ValueError) as exc:
                logger.warning(
                    "Could not place translation %s (sha256 %s): %s",
                    item.filename,
                    item.sha256,
                    exc,
                )
                continue
            placed.append(item)
        return placed

    def sync_translations(self) -> None:
        """Take up translation files another worker stored since this one looked.

        Places the newer files and rebuilds the loaded ontologies of their
        prefixes, so a new project never captures the old file (#84).
        """
        latest = self._latest_translations(self.list())
        with self.registry.changing():
            changed = [
                item
                for item in latest
                if self._translation_version.get(item.filename) != item.sha256
            ]
            placed = self._place_translations(changed)
            if not placed:
                return
            paths = self.registry.translation_files()
            rebuilt: dict[str, OntologyService] = {}
            for prefix in sorted({item.prefix for item in placed}):
                rebuilt.update(self.registry.rebuild_for_prefix(prefix, paths))
            if rebuilt:
                self.registry.publish(rebuilt)
            for item in placed:
                self._translation_version[item.filename] = item.sha256

    def _place_translation(self, item: OntologyFile) -> None:
        target = self.translations_dir / item.filename
        if (
            target.is_file()
            and hashlib.sha256(target.read_bytes()).hexdigest() == item.sha256
        ):
            return
        data = self.db.blobs.get(item.sha256)
        fd, tmp = tempfile.mkstemp(dir=self.translations_dir, prefix=".placing-")
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
            os.replace(tmp, target)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
