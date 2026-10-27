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
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import Row, select
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
from ontotator.ontology.translations import parse_translation_name
from ontotator.storage.database import Database
from ontotator.storage.tables import (
    OntologyFileRow,
    ProjectOntologyRow,
    StoredFileRow,
)
from ontotator.vendor.hpo_span_annotator.hpo import OntologyError

logger = logging.getLogger(__name__)


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
        digest = self.db.blobs.put(data)
        with self.db.transaction() as conn:
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
        latest: dict[str, OntologyFile] = {}
        for item in files:
            if item.kind == "translation":
                # A later upload of the same name replaces an earlier one.
                latest[item.filename] = item
        for item in latest.values():
            try:
                self._place_translation(item)
            except (OSError, ValueError) as exc:
                logger.warning(
                    "Could not place translation %s (sha256 %s): %s",
                    item.filename,
                    item.sha256,
                    exc,
                )
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
