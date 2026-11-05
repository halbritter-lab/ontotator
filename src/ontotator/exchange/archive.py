"""Export and import one complete project between servers (#306).

A project archive is a ZIP:

- ``manifest.json``: the format name ``ontotator-project-archive``, its
  schema version, the Ontotator version and database revision that wrote it,
  when, the project, the SHA-256 and size of every other file, the columns
  and row counts of every table;
- ``tables/<table>.jsonl``: the project's rows of each table of
  ``archive_tables.ARCHIVED``, one JSON object per line, sorted;
- ``people.jsonl``: every account the rows name (id, username, pseudonym;
  the e-mail address only of people named in the project's work, not of
  those only in its audit trail or job records), the only personal data of
  the archive;
- ``ontology_files.jsonl`` and ``blobs/<sha256>``: the stored files the rows
  refer to (``archive_tables.BLOB_REFERENCES``: uploaded texts and bundles,
  captured search resources) and the ontology and translation files of the
  pins, unless the ontology files were left out. Export results and earlier
  archives are never included.

The manifest is not signed: it detects a damaged or incomplete archive, not
a deliberate change by someone who rewrites the manifest as well.

The rows keep the source server's ids. The import renumbers every generated
id, rewrites the references and the project, maps people
(``_resolve_people``) and then reads the imported project back, maps it back
to the archive's ids and compares every table with the manifest; a
difference rolls the import back. Immutable records keep their content and
timestamps. Only a taken project key, server-wide ids this server already
has and, on request, taken pseudonyms in the identity fields of
``archive_tables.PSEUDONYM_COLUMNS`` and its siblings are replaced in the
copied content; free text never changes and no content hash is recomputed.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import shutil
import tempfile
import zipfile
import zlib
from collections.abc import Callable, Iterable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from functools import cache, cached_property
from pathlib import Path
from typing import IO, Any
from uuid import uuid4

from alembic.script import ScriptDirectory
from sqlalchemy import (
    JSON,
    ColumnElement,
    Connection,
    DateTime,
    Table,
    bindparam,
    func,
    insert,
    select,
    text,
    union,
    update,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ontotator import __version__
from ontotator.auth.accounts import (
    ANONYMISED_DISPLAY_NAME,
    ANONYMISED_PREFIX,
    AccountService,
    _annotator_ids_in_use,
)
from ontotator.auth.audit import Actor, record_audit
from ontotator.authz.memberships import grant_roles
from ontotator.domain.errors import DomainError
from ontotator.exchange.archive_tables import (
    ARCHIVE_JOB_KINDS,
    ARCHIVED,
    AUDIT_TARGET_ROWS,
    BLOB_REFERENCES,
    EXTRA_REFERENCES,
    PROJECTS,
    PSEUDONYM_COLUMNS,
    PSEUDONYM_JSON_KEYS,
    PSEUDONYM_LABEL_COLUMNS,
    USERS,
    WORKSPACE_KEY_COLUMNS,
    ArchivedTable,
    ExtraReference,
    column_roles,
    extra_self_references,
    global_ids,
    identity_column,
    insert_order,
    self_references,
    table,
)
from ontotator.jobs.queue import Job, JobContext, StructuredJobError
from ontotator.settings import ARCHIVE_MAX_EXPANDED_ENV, archive_max_expanded_bytes
from ontotator.storage.database import Database
from ontotator.storage.repository import _decode_key_str, _key_str, _lock_id
from ontotator.storage.schema import alembic_config, current_revision
from ontotator.storage.tables import (
    AnnotationSnapshotRow,
    AuditEventRow,
    DocumentRow,
    DraftRow,
    ImportedPersonRow,
    InstanceStateRow,
    JobRow,
    OntologyFileRow,
    ProjectMembershipRow,
    ProjectResourceRow,
    ProjectRow,
    ReviewDecisionRow,
    SearchEventRow,
    StoredFileRow,
    SubmissionRow,
    UserRow,
)

FORMAT = "ontotator-project-archive"
SCHEMA_VERSION = 1
MANIFEST = "manifest.json"
PEOPLE = "people.jsonl"
ONTOLOGY_FILES = "ontology_files.jsonl"
EXPORT_KIND = "project_archive_export"
IMPORT_KIND = "project_archive_import"
# The only file names an archive has: no directories, no "..", no absolute
# paths, nothing an extraction could misplace.
_FILE_NAME = re.compile(
    r"manifest\.json|people\.jsonl|ontology_files\.jsonl"
    r"|tables/[a-z][a-z0-9_]*\.jsonl|blobs/[0-9a-f]{64}"
)
# Import limits, from the ZIP's own entries: the total expanded size
# (ONTOTATOR_ARCHIVE_MAX_EXPANDED_BYTES, default 8 GiB) and, for an entry of
# more than 1 MiB, its compression ratio.
MAX_RATIO = 200
RATIO_FROM_BYTES = 1024 * 1024
MAX_MANIFEST_BYTES = 64 * 1024 * 1024
_CHUNK_BYTES = 1024 * 1024
# An exported archive is kept this long after its job finished, then deleted
# (and at once when an account is erased); an uploaded archive goes when its
# import job finished.
ARCHIVE_RETENTION = timedelta(hours=24)
# A JSON column holding the JSON value ``null`` (SQL NULL is ``null``).
JSON_NULL = {"$json_null": True}
_ONTOLOGY_FILE_COLUMNS = (
    "sha256",
    "kind",
    "prefix",
    "release",
    "filename",
    "language",
    "uploaded_at",
)
# Upgrade functions of older archive schema versions: version -> function
# returning the manifest and the (non-blob) files of the next version. None yet.
UPGRADES: dict[
    int,
    Callable[
        [dict[str, Any], dict[str, bytes]], tuple[dict[str, Any], dict[str, bytes]]
    ],
] = {}


def table_file(name: str) -> str:
    return f"tables/{name}.jsonl"


def blob_file(sha256: str) -> str:
    return f"blobs/{sha256}"


# Serialization ---------------------------------------------------------


def _plain(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat()
    return value


def _line(row: Mapping[str, Any]) -> str:
    return json.dumps(row, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def jsonl(rows: Iterable[Mapping[str, Any]]) -> bytes:
    """Rows as sorted JSON lines: the same rows give the same bytes."""
    lines = sorted(_line(row) for row in rows)
    return "".join(f"{line}\n" for line in lines).encode("utf-8")


def _read_jsonl(data: bytes) -> list[dict[str, Any]]:
    rows = []
    for line in data.decode("utf-8").splitlines():
        if line.strip():
            value = json.loads(line)
            if not isinstance(value, dict):
                raise DomainError("ARCHIVE_INVALID", "A table line is not an object.")
            rows.append(value)
    return rows


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# The server --------------------------------------------------------------

INSTANCE_KEY = "instance_id"


def instance_id(conn: Connection) -> str:
    """This server's random id, created on first use (``instance_state``).

    An archive names the server it came from, so an import recognises an
    archive of its own server and people an earlier import created.
    """
    conn.execute(
        pg_insert(InstanceStateRow)
        .values(key=INSTANCE_KEY, value={"id": uuid4().hex})
        .on_conflict_do_nothing()
    )
    value = conn.execute(
        select(InstanceStateRow.value).where(InstanceStateRow.key == INSTANCE_KEY)
    ).scalar_one()
    return str(value["id"])


# Reading the project ---------------------------------------------------


def _rows(
    conn: Connection,
    entry: ArchivedTable,
    project_id: int,
    *,
    where: Any = None,
) -> list[dict[str, Any]]:
    """The project's rows of one table, by column name, sessions left out.

    ``where`` replaces the project condition (the jobs rows refer to).
    """
    t = table(entry.name)
    if where is not None:
        pass
    elif entry.name == PROJECTS:
        where = t.c.id == project_id
    elif entry.parent is not None:
        column, parent_name, parent_column = entry.parent
        parent = table(parent_name)
        where = _col(t, column).in_(
            select(_col(parent, parent_column)).where(parent.c.project_id == project_id)
        )
    else:
        where = t.c.project_id == project_id
    if entry.name == "jobs":
        # Finished jobs only: the archive's own export job is still running.
        # Archive jobs never: an archive would carry the earlier archives.
        where = (
            where
            & t.c.status.in_(("succeeded", "failed"))
            & t.c.kind.not_in(ARCHIVE_JOB_KINDS)
        )
    roles = column_roles(entry.name)
    json_columns = [c for c in t.columns if isinstance(c.type, JSON)]
    flags = [func.jsonb_typeof(c) == "null" for c in json_columns]
    found = []
    for row in conn.execute(select(*t.columns, *flags).where(where)):
        mapping = row._mapping
        values = {
            column.name: None
            if roles[column.name].kind == "session"
            else _plain(mapping[column])
            for column in t.columns
        }
        for json_column, flag in zip(json_columns, row[len(t.columns) :], strict=True):
            if flag:
                values[json_column.name] = dict(JSON_NULL)
        found.append(values)
    return found


def _col(t: Table, name: str) -> Any:
    for column in t.columns:
        if column.name == name:
            return column
    raise KeyError(name)


def _json_ids(value: Any, mapping: Callable[[int], int]) -> Any:
    """An integer, or each integer of a list, mapped; anything else as it is."""
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return mapping(value)
    if isinstance(value, list):
        return [
            mapping(item)
            if isinstance(item, int) and not isinstance(item, bool)
            else item
            for item in value
        ]
    return value


def _at_path(value: Any, path: tuple[str, ...], mapping: Callable[[int], int]) -> Any:
    if not path:
        return _json_ids(value, mapping)
    if isinstance(value, dict) and path[0] in value:
        copy = dict(value)
        copy[path[0]] = _at_path(value[path[0]], path[1:], mapping)
        return copy
    return value


def _people_ids(name: str, rows: list[dict[str, Any]]) -> set[int]:
    """Every user id the rows of one table name."""
    roles = column_roles(name)
    ids: set[int] = set()
    for row in rows:
        for column, role in roles.items():
            if role.kind == "person" and row.get(column) is not None:
                ids.add(int(row[column]))

    def collect(value: int) -> int:
        ids.add(value)
        return value

    for extra in EXTRA_REFERENCES:
        if extra.table == name and extra.target == USERS:
            for row in rows:
                _at_path(row.get(extra.column), extra.path, collect)
    return ids


def _referenced(name: str, rows: list[dict[str, Any]], target: str) -> set[int]:
    """The ids of ``target`` rows the rows of one table must have with them:
    foreign keys and ``EXTRA_REFERENCES`` without ``orphans``."""
    ids: set[int] = set()

    def collect(value: int) -> int:
        ids.add(value)
        return value

    for column, role in column_roles(name).items():
        if role.kind != "row" or role.target != target or _orphans(name, column):
            continue
        for row in rows:
            if row.get(column) is not None:
                _json_ids(row[column], collect)
    for extra in EXTRA_REFERENCES:
        if (
            extra.table == name
            and extra.target == target
            and extra.path
            and not extra.orphans
        ):
            for row in rows:
                _at_path(row.get(extra.column), extra.path, collect)
    return ids


def _strings_at(value: Any, path: tuple[str, ...]) -> Iterator[str]:
    """The strings at ``path`` in a column value (``*``: each list item)."""
    if not path:
        if isinstance(value, str):
            yield value
        return
    head, rest = path[0], path[1:]
    if head == "*" and isinstance(value, list):
        for item in value:
            yield from _strings_at(item, rest)
    elif isinstance(value, dict) and head in value:
        yield from _strings_at(value[head], rest)


def _blob_refs(found: Mapping[str, list[dict[str, Any]]]) -> set[str]:
    """The stored files the rows refer to, from ``BLOB_REFERENCES`` only."""
    digests: set[str] = set()
    for name, column, path in BLOB_REFERENCES:
        for row in found.get(name, []):
            digests.update(_strings_at(row.get(column), path))
    return {d for d in digests if re.fullmatch(r"[0-9a-f]{64}", d)}


# Pseudonyms in the work --------------------------------------------------


@cache
def _json_columns(name: str) -> frozenset[str]:
    return frozenset(c.name for c in table(name).columns if isinstance(c.type, JSON))


def _in_key(value: str, fn: Callable[[str], str]) -> str:
    """A stored workspace key with its annotator id mapped by ``fn``."""
    if "|" not in value and value.count(":") != 5:
        return value
    try:
        key = _decode_key_str(value)
    except (DomainError, ValueError):
        return value
    if _key_str(key) != value:
        return value
    new = fn(key.annotator_id)
    if new == key.annotator_id:
        return value
    return _key_str(key.model_copy(update={"annotator_id": new}))


def _json_people(value: Any, fn: Callable[[str], str]) -> Any:
    if isinstance(value, dict):
        return {
            k: fn(v)
            if k in PSEUDONYM_JSON_KEYS and isinstance(v, str)
            else _json_people(v, fn)
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [_json_people(item, fn) for item in value]
    if isinstance(value, str):
        return _in_key(value, fn)
    return value


def _people_in_row(
    name: str,
    row: Mapping[str, Any],
    fn: Callable[[str], str],
    *,
    labels: bool = True,
) -> dict[str, Any]:
    """``row`` with every pseudonym of its identity fields mapped by ``fn``.

    Identity fields only: ``PSEUDONYM_COLUMNS``, ``WORKSPACE_KEY_COLUMNS``
    and, in JSON columns, ``PSEUDONYM_JSON_KEYS`` and whole workspace keys.
    ``labels``: also ``PSEUDONYM_LABEL_COLUMNS``. Free text (document texts,
    notes, guidelines, comments) never changes. The audit trail records what
    happened and keeps its names.
    """
    out = dict(row)
    if name == "audit_events":
        return out
    json_columns = _json_columns(name)
    for column, value in row.items():
        if value is None:
            continue
        if isinstance(value, str) and (
            (name, column) in PSEUDONYM_COLUMNS
            or (labels and (name, column) in PSEUDONYM_LABEL_COLUMNS)
        ):
            out[column] = fn(value)
        elif (name, column) in WORKSPACE_KEY_COLUMNS and isinstance(value, str):
            out[column] = _in_key(value, fn)
        elif column in json_columns:
            out[column] = _json_people(value, fn)
    return out


def _identities(tables: Mapping[str, list[dict[str, Any]]]) -> set[str]:
    """Every pseudonym (annotator id) the archived work names a person by
    (display labels aside)."""
    found: set[str] = set()

    def collect(value: str) -> str:
        if value:
            found.add(value)
        return value

    for name, rows in tables.items():
        for row in rows:
            _people_in_row(name, row, collect, labels=False)
    return found


@dataclass
class BuiltArchive:
    path: Path
    sha256: str
    size: int
    manifest: dict[str, Any]


def _file_sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(_CHUNK_BYTES):
            digest.update(chunk)
    return digest.hexdigest()


def _with_jobs_referred_to(
    conn: Connection, found: dict[str, list[dict[str, Any]]], project_id: int, key: str
) -> None:
    """Add the jobs rows refer to that name no project (a T1 import from the
    command line, ...) as jobs of the project: an archive without them could
    not be imported.

    Raises:
        DomainError: ``ARCHIVE_JOBS_RUNNING`` while such a job is not finished.
    """
    jobs = found["jobs"]
    have = {int(row["id"]) for row in jobs}
    while True:
        wanted: set[int] = set()
        for name, rows in found.items():
            wanted |= _referenced(name, rows, "jobs")
        wanted -= have
        if not wanted:
            return
        more = _rows(
            conn, ArchivedTable("jobs"), project_id, where=JobRow.id.in_(sorted(wanted))
        )
        missing = wanted - {int(row["id"]) for row in more}
        if missing:
            raise DomainError(
                "ARCHIVE_JOBS_RUNNING",
                f"Rows of '{key}' refer to job(s) {sorted(missing)}, which are"
                " queued or running; archive the project once they finished.",
            )
        for row in more:
            row["project_id"] = project_id
        jobs.extend(more)
        have |= {int(row["id"]) for row in more}


def build_archive(
    db: Database,
    project_key: str,
    target: Path,
    *,
    include_ontology_files: bool = True,
    now: datetime | None = None,
    job_id: int | None = None,
) -> BuiltArchive:
    """Write the archive of one project to ``target`` from one snapshot.

    ``job_id`` is the export job itself, which does not count as running.

    Raises:
        DomainError: ``PROJECT_NOT_FOUND``; ``ARCHIVE_PRACTICE_PROJECT`` for a
            practice project; ``ARCHIVE_JOBS_RUNNING`` while a job of the
            project, or one its rows refer to, is queued or running.
    """
    created = (now or datetime.now(UTC)).astimezone(UTC).replace(microsecond=0)
    files: dict[str, bytes] = {}
    with db.transaction() as conn:
        source = instance_id(conn)
    with db.snapshot() as conn:
        project = conn.execute(
            select(ProjectRow.id, ProjectRow.name, ProjectRow.practice).where(
                ProjectRow.project_key == project_key
            )
        ).one_or_none()
        if project is None:
            raise DomainError(
                "PROJECT_NOT_FOUND", f"There is no project '{project_key}'."
            )
        if project.practice:
            raise DomainError(
                "ARCHIVE_PRACTICE_PROJECT", "Practice projects are not archived."
            )
        busy = conn.execute(
            select(func.count())
            .select_from(JobRow)
            .where(
                JobRow.project_id == project.id,
                JobRow.status.in_(("queued", "running")),
                JobRow.id != (job_id or 0),
            )
        ).scalar_one()
        if busy:
            raise DomainError(
                "ARCHIVE_JOBS_RUNNING",
                f"{busy} job(s) of '{project_key}' are queued or running;"
                " archive the project once they finished.",
            )
        revision = current_revision(conn)
        found = {entry.name: _rows(conn, entry, project.id) for entry in ARCHIVED}
        _with_jobs_referred_to(conn, found, project.id, project_key)
        rows: dict[str, int] = {}
        columns: dict[str, list[str]] = {}
        people: set[int] = set()
        workers: set[int] = set()
        for entry in ARCHIVED:
            data = jsonl(found[entry.name])
            files[table_file(entry.name)] = data
            rows[entry.name] = len(found[entry.name])
            columns[entry.name] = [c.name for c in table(entry.name).columns]
            named = _people_ids(entry.name, found[entry.name])
            people |= named
            if entry.name not in {"audit_events", "jobs"}:
                workers |= named
        # E-mail addresses only of the people who worked in the project
        # (members, assignees, authors, ...): the import matches them to
        # their accounts. People named only in the audit trail or job records
        # (an administrator of the source server) keep their pseudonym and
        # username and become pseudonym-only people on another server.
        person_rows = [
            {
                "id": row.id,
                "username": row.username,
                "pseudonym": row.pseudonym,
                "email": row.email if row.id in workers else None,
                "anonymised": row.anonymised_at is not None,
            }
            for row in conn.execute(
                select(
                    UserRow.id,
                    UserRow.username,
                    UserRow.pseudonym,
                    UserRow.email,
                    UserRow.anonymised_at,
                ).where(UserRow.id.in_(sorted(people)))
            )
        ]
        files[PEOPLE] = jsonl(person_rows)
        mentioned = _blob_refs(found)
        stored = set(
            conn.execute(
                select(StoredFileRow.sha256).where(
                    StoredFileRow.sha256.in_(sorted(mentioned))
                )
            ).scalars()
        )
        ontology_rows = [
            {name: _plain(row._mapping[name]) for name in _ONTOLOGY_FILE_COLUMNS}
            for row in conn.execute(
                select(
                    *(getattr(OntologyFileRow, n) for n in _ONTOLOGY_FILE_COLUMNS)
                ).where(OntologyFileRow.sha256.in_(sorted(stored)))
            )
        ]
        files[ONTOLOGY_FILES] = jsonl(ontology_rows)
        resources = set(
            conn.execute(
                select(ProjectResourceRow.sha256).where(
                    ProjectResourceRow.project_id == project.id
                )
            ).scalars()
        )
    blobs = set(stored)
    if not include_ontology_files:
        # Captured search resources stay: the project's search needs them.
        blobs -= {row["sha256"] for row in ontology_rows} - resources
    manifest_files = {
        name: {"sha256": _sha(data), "size": len(data)} for name, data in files.items()
    }
    for digest in sorted(blobs):
        size = db.blobs.path(digest).stat().st_size
        manifest_files[blob_file(digest)] = {"sha256": digest, "size": size}
    manifest = {
        "format": FORMAT,
        "schema_version": SCHEMA_VERSION,
        "ontotator_version": __version__,
        "alembic_revision": revision,
        "instance_id": source,
        "created_at": created.isoformat(),
        "project": {"key": project_key, "name": project.name},
        "ontology_files_included": include_ontology_files,
        "files": dict(sorted(manifest_files.items())),
        "rows": rows,
        "columns": columns,
        "people": len(person_rows),
        "ontology_files": len(ontology_rows),
    }
    stamp = (
        created.year,
        created.month,
        created.day,
        created.hour,
        created.minute,
        created.second,
    )
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            zipfile.ZipInfo(MANIFEST, stamp),
            json.dumps(manifest, indent=2, sort_keys=True).encode("utf-8"),
            compress_type=zipfile.ZIP_DEFLATED,
        )
        for name, data in sorted(files.items()):
            archive.writestr(zipfile.ZipInfo(name, stamp), data, zipfile.ZIP_DEFLATED)
        for digest in sorted(blobs):
            info = zipfile.ZipInfo(blob_file(digest), stamp)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.file_size = db.blobs.path(digest).stat().st_size
            with (
                db.blobs.path(digest).open("rb") as reader,
                archive.open(info, "w", force_zip64=True) as writer,
            ):
                shutil.copyfileobj(reader, writer, _CHUNK_BYTES)
    return BuiltArchive(target, _file_sha(target), target.stat().st_size, manifest)


# Reading an archive ----------------------------------------------------


@dataclass
class Archive:
    """A checked archive: every file matches the manifest.

    ``blobs`` are files in a temporary folder that lives as long as the
    ``open_archive`` block.
    """

    manifest: dict[str, Any]
    tables: dict[str, list[dict[str, Any]]]
    people: list[dict[str, Any]]
    ontology_files: list[dict[str, Any]]
    blobs: dict[str, Path]
    sha256: str


def _damaged(detail: str) -> DomainError:
    return DomainError(
        "ARCHIVE_TAMPERED",
        f"The archive is damaged or incomplete: {detail}. Nothing was imported."
        " (The manifest is not signed: this check finds damage, not a deliberate"
        " change.)",
    )


def _too_large(detail: str) -> DomainError:
    return DomainError(
        "ARCHIVE_TOO_LARGE", f"The archive is refused: {detail}. Nothing was imported."
    )


def _copy_entry(archive: zipfile.ZipFile, info: zipfile.ZipInfo, out: IO[bytes]) -> str:
    """Stream one entry to ``out``, at most the size its header gives; its
    SHA-256."""
    digest = hashlib.sha256()
    written = 0
    try:
        with archive.open(info) as reader:
            while chunk := reader.read(_CHUNK_BYTES):
                written += len(chunk)
                if written > info.file_size:
                    raise _too_large(f"{info.filename} expands beyond its header")
                digest.update(chunk)
                out.write(chunk)
    except (zipfile.BadZipFile, zlib.error, EOFError, OSError) as error:
        raise _damaged(f"{info.filename} cannot be read ({error})") from None
    if written != info.file_size:
        raise _damaged(f"{info.filename} is shorter than its header says")
    return digest.hexdigest()


def _read_entry(archive: zipfile.ZipFile, info: zipfile.ZipInfo) -> tuple[bytes, str]:
    buffer = io.BytesIO()
    digest = _copy_entry(archive, info, buffer)
    return buffer.getvalue(), digest


def _check_entries(infos: list[zipfile.ZipInfo], limit: int) -> None:
    """Names and sizes from the ZIP's own directory, before anything is read.

    Raises:
        DomainError: ``ARCHIVE_INVALID`` (a name an archive never has, a
            duplicate or encrypted entry), ``ARCHIVE_TOO_LARGE`` (more than
            ``limit`` bytes in total or an entry above ``MAX_RATIO``).
    """
    seen: set[str] = set()
    for info in infos:
        name = info.filename
        if info.is_dir() or not _FILE_NAME.fullmatch(name):
            raise DomainError(
                "ARCHIVE_INVALID",
                f"The archive holds {name!r}, a name a project archive never has."
                " Nothing was imported.",
            )
        if name in seen:
            raise DomainError("ARCHIVE_INVALID", f"The archive holds {name!r} twice.")
        if info.flag_bits & 0x1:
            raise DomainError("ARCHIVE_INVALID", f"{name} is encrypted.")
        seen.add(name)
        if info.file_size > RATIO_FROM_BYTES and info.file_size > MAX_RATIO * max(
            info.compress_size, 1
        ):
            raise _too_large(
                f"{name} expands {info.file_size // max(info.compress_size, 1)}-fold"
                f" (compression ratio above {MAX_RATIO})"
            )
    total = sum(info.file_size for info in infos)
    if total > limit:
        raise _too_large(
            f"it expands to {total} bytes, more than the {limit} allowed"
            f" ({ARCHIVE_MAX_EXPANDED_ENV})"
        )


@contextmanager
def open_archive(source: Path | bytes) -> Iterator[Archive]:
    """Open and check an archive: names, sizes, format, version, every file's
    digest and size. Stored files are streamed to a temporary folder.

    Raises:
        DomainError: ``ARCHIVE_INVALID`` (not an archive, or a file name an
            archive never has), ``ARCHIVE_TOO_LARGE`` (expands beyond the
            limit or too far per byte), ``ARCHIVE_FORMAT_UNSUPPORTED``
            (another format or schema version without an upgrade function) or
            ``ARCHIVE_TAMPERED`` (a file is missing, extra or differs from the
            manifest: a damaged archive).
    """
    limit = archive_max_expanded_bytes()
    with tempfile.TemporaryDirectory(prefix="ontotator-archive-") as tmp:
        folder = Path(tmp)
        if isinstance(source, bytes):
            path = folder / "archive.zip"
            path.write_bytes(source)
        else:
            path = source
        yield _read_archive(path, folder, limit)


def _read_archive(path: Path, folder: Path, limit: int) -> Archive:
    try:
        archive = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError):
        raise DomainError("ARCHIVE_INVALID", "The file is not a ZIP archive.") from None
    with archive:
        infos = archive.infolist()
        _check_entries(infos, limit)
        by_name = {info.filename: info for info in infos}
        if MANIFEST not in by_name:
            raise DomainError("ARCHIVE_INVALID", "The archive has no manifest.json.")
        if by_name[MANIFEST].file_size > MAX_MANIFEST_BYTES:
            raise _too_large("manifest.json is too large")
        try:
            manifest = json.loads(_read_entry(archive, by_name[MANIFEST])[0])
        except ValueError:
            raise DomainError("ARCHIVE_INVALID", "manifest.json is not JSON.") from None
        if not isinstance(manifest, dict) or manifest.get("format") != FORMAT:
            raise DomainError(
                "ARCHIVE_FORMAT_UNSUPPORTED", f"The file is not an {FORMAT}."
            )
        version = manifest.get("schema_version")
        if not isinstance(version, int) or isinstance(version, bool):
            raise DomainError(
                "ARCHIVE_FORMAT_UNSUPPORTED", "The schema version is missing."
            )
        if version > SCHEMA_VERSION or (
            version < SCHEMA_VERSION and version not in UPGRADES
        ):
            raise DomainError(
                "ARCHIVE_FORMAT_UNSUPPORTED",
                f"Archive schema version {version} is not supported; this server"
                f" reads version {SCHEMA_VERSION}.",
            )
        listed = manifest.get("files")
        if not isinstance(listed, dict):
            raise _damaged("the manifest lists no files")
        for name in listed:
            if name == MANIFEST or not _FILE_NAME.fullmatch(str(name)):
                raise DomainError(
                    "ARCHIVE_INVALID",
                    f"The manifest lists {name!r}, a name a project archive never"
                    " has. Nothing was imported.",
                )
        names = set(by_name) - {MANIFEST}
        if names != set(listed):
            extra = sorted(names - set(listed))
            missing = sorted(set(listed) - names)
            raise _damaged(f"extra files {extra}, missing files {missing}")
        contents: dict[str, bytes] = {}
        blobs: dict[str, Path] = {}
        (folder / "blobs").mkdir(exist_ok=True)
        for name, expected in sorted(listed.items()):
            info = by_name[name]
            if not isinstance(expected, dict) or info.file_size != expected.get("size"):
                raise _damaged(f"{name} has another size")
            if name.startswith("blobs/"):
                digest_name = name.removeprefix("blobs/")
                target = folder / "blobs" / digest_name
                with target.open("wb") as out:
                    digest = _copy_entry(archive, info, out)
                if digest != digest_name:
                    raise _damaged(f"{name} is not named by its SHA-256")
                blobs[digest] = target
            else:
                content, digest = _read_entry(archive, info)
                contents[name] = content
            if digest != expected.get("sha256"):
                raise _damaged(f"{name} has another SHA-256")
    while version < SCHEMA_VERSION:
        manifest, contents = UPGRADES[version](manifest, contents)
        version = manifest["schema_version"]
    known = {entry.name for entry in ARCHIVED}
    counts = manifest.get("rows")
    if not isinstance(counts, dict) or not set(counts) <= known:
        raise DomainError(
            "ARCHIVE_FORMAT_UNSUPPORTED",
            f"Unknown tables: {sorted(set(counts or {}) - known)}.",
        )
    tables: dict[str, list[dict[str, Any]]] = {}
    for name, count in counts.items():
        found = contents.get(table_file(name))
        if found is None:
            raise _damaged(f"{table_file(name)} is missing")
        rows = _read_jsonl(found)
        if len(rows) != count:
            raise _damaged(f"{name} has {len(rows)} rows, the manifest {count}")
        tables[name] = rows
    if PEOPLE not in contents or ONTOLOGY_FILES not in contents:
        raise _damaged("people.jsonl or ontology_files.jsonl is missing")
    if len(tables.get(PROJECTS, [])) != 1:
        raise DomainError("ARCHIVE_INVALID", "The archive holds no single project.")
    return Archive(
        manifest=manifest,
        tables=tables,
        people=_read_jsonl(contents[PEOPLE]),
        ontology_files=_read_jsonl(contents[ONTOLOGY_FILES]),
        blobs=blobs,
        sha256=_file_sha(path),
    )


def check_revision(revision: Any) -> None:
    """Refuse an archive written by a database revision this server lacks.

    Raises:
        DomainError: ``ARCHIVE_SCHEMA_NEWER``.
    """
    scripts = ScriptDirectory.from_config(alembic_config())
    known = {item.revision for item in scripts.walk_revisions()}
    if revision not in known:
        raise DomainError(
            "ARCHIVE_SCHEMA_NEWER",
            f"The archive was written at database revision {revision}, which this"
            " server does not have. Upgrade this server first.",
        )


# People ----------------------------------------------------------------


@dataclass
class PeoplePlan:
    """Where each archived person lands on this server."""

    # archive user id -> user id here
    users: dict[int, int] = field(default_factory=dict)
    mapped: list[dict[str, Any]] = field(default_factory=list)
    created: list[dict[str, Any]] = field(default_factory=list)
    # (archive id, account id): pseudonym-only person linked at import.
    links: list[tuple[int, int]] = field(default_factory=list)
    # archive id -> archive username, of the pseudonym-only people.
    erased: dict[int, str] = field(default_factory=dict)
    # archive ids of the pseudonym-only people this import creates.
    new: set[int] = field(default_factory=set)
    # Archived pseudonyms the copied work names differently here: old -> new.
    pseudonyms: dict[str, str] = field(default_factory=dict)
    # Annotator ids of the work without an account in the archive (work
    # imported from T1 bundles, ...).
    without_account: list[str] = field(default_factory=list)


def _imported_from(conn: Connection, source: str) -> set[int]:
    """Projects this server imported from archives of server ``source``."""
    audited = select(AuditEventRow.project_id).where(
        AuditEventRow.action == "project.import_archive",
        AuditEventRow.details["source_instance"].astext == source,
        AuditEventRow.project_id.is_not(None),
    )
    people = select(ImportedPersonRow.project_id).where(
        ImportedPersonRow.source_instance == source
    )
    found: list[Any] = list(conn.execute(union(audited, people)).scalars())
    return {int(project) for project in found if project}


def _annotator_ids_outside(conn: Connection, excluded: set[int]) -> set[str]:
    """``_annotator_ids_in_use`` of the projects not in ``excluded``."""
    actor = AnnotationSnapshotRow.payload[
        ("annotation", "provenance", "actor", "actor_id")
    ].astext
    event = SearchEventRow.payload[("workspace_key", "annotator_id")].astext
    skip = sorted(excluded)
    queries = [
        select(column).where(column.like("ann-%"), project.not_in(skip))
        for column, project in (
            (DraftRow.annotator_id, DraftRow.project_id),
            (SubmissionRow.annotator_id, SubmissionRow.project_id),
            (actor, AnnotationSnapshotRow.project_id),
            (event, SearchEventRow.project_id),
        )
    ]
    queries.append(
        select(ReviewDecisionRow.reviewer_id)
        .join(DraftRow, DraftRow.id == ReviewDecisionRow.draft_id)
        .where(
            ReviewDecisionRow.reviewer_id.like("ann-%"),
            DraftRow.project_id.not_in(skip),
        )
    )
    return {str(value) for value in conn.execute(union(*queries)).scalars()}


def _resolve_people(
    conn: Connection,
    archive: Archive,
    here: str,
    now: datetime,
    *,
    rename_pseudonyms: bool = False,
) -> PeoplePlan:
    """Map the archived people to people here; create the missing ones.

    In order: the same account (an archive of this server), the
    pseudonym-only person an earlier archive of the same server created, the
    one account with the person's e-mail address, a new pseudonym-only person.

    The work names people by pseudonym (``_identities``: identity fields
    only, never free text). By default it keeps the archived pseudonyms: an
    e-mail account with another pseudonym does not take the work over; a
    pseudonym-only person keeps the pseudonym instead, linked to that account
    (which gets the person's roles). With ``rename_pseudonyms`` the copied
    work names the e-mail account's pseudonym, and a person whose pseudonym
    is taken here gets a new one (content hashes are kept).

    Annotator ids of the work without an account in the archive are checked
    the same way against the pseudonyms here and the annotator ids of this
    server's work (but for projects imported from the same server, and for
    an archive of this server): such work must not be attributed to someone
    here. They are refused, or renamed with ``rename_pseudonyms``.

    Raises:
        DomainError: ``ARCHIVE_PSEUDONYM_TAKEN`` when another person here, or
            the work of another project, has a pseudonym the archived work
            carries, without ``rename_pseudonyms``.
    """
    plan = PeoplePlan()
    work = _identities(archive.tables)
    source = str(archive.manifest.get("instance_id") or "")
    earlier = {
        row.source_user_id: row
        for row in conn.execute(
            select(
                ImportedPersonRow.source_user_id,
                ImportedPersonRow.user_id,
                ImportedPersonRow.linked_user_id,
                UserRow.pseudonym,
            )
            .join(UserRow, UserRow.id == ImportedPersonRow.user_id)
            .where(ImportedPersonRow.source_instance == source)
        )
    }
    imported = set(conn.execute(select(ImportedPersonRow.user_id)).scalars())
    by_email: dict[str, list[Any]] = {}
    for row in conn.execute(
        select(UserRow.id, UserRow.pseudonym, UserRow.email, UserRow.username).where(
            UserRow.email.is_not(None), UserRow.anonymised_at.is_(None)
        )
    ):
        if row.id not in imported and row.email.strip():
            by_email.setdefault(row.email.strip().lower(), []).append(row)
    archived_emails: dict[str, int] = {}
    for person in archive.people:
        email = (person.get("email") or "").strip().lower()
        if email:
            archived_emails[email] = archived_emails.get(email, 0) + 1
    same = (
        {
            row.id: row
            for row in conn.execute(
                select(UserRow.id, UserRow.pseudonym, UserRow.username).where(
                    UserRow.id.in_([int(p["id"]) for p in archive.people])
                )
            )
        }
        if source == here
        else {}
    )
    pseudonyms_here = set(conn.execute(select(UserRow.pseudonym)).scalars())
    in_use = pseudonyms_here | _annotator_ids_in_use(conn)
    archived = {str(p["pseudonym"]) for p in archive.people}
    without_account = sorted(work - archived)
    taken_by_work = (
        pseudonyms_here | _annotator_ids_outside(conn, _imported_from(conn, source))
        if source != here
        else set()
    )

    def fresh() -> str:
        while True:
            candidate = AccountService._next_pseudonym(conn)
            if (
                candidate not in in_use
                and candidate not in work
                and candidate not in plan.pseudonyms.values()
            ):
                return candidate

    conflicts: list[str] = []
    for person in sorted(archive.people, key=lambda p: int(p["id"])):
        source_id, pseudonym = int(person["id"]), str(person["pseudonym"])
        named = pseudonym in work
        own = same.get(source_id)
        if own is not None and own.pseudonym == pseudonym:
            plan.users[source_id] = own.id
            plan.mapped.append(
                {"pseudonym": pseudonym, "username": own.username, "by": "account"}
            )
            continue
        known = earlier.get(source_id)
        if known is not None:
            if known.pseudonym != pseudonym and named:
                if not rename_pseudonyms:
                    # An earlier import gave the person another pseudonym.
                    conflicts.append(pseudonym)
                    continue
                plan.pseudonyms[pseudonym] = known.pseudonym
            plan.users[source_id] = known.user_id
            plan.erased[source_id] = str(person["username"])
            plan.mapped.append({"pseudonym": known.pseudonym, "by": "earlier_import"})
            if known.linked_user_id is not None:
                plan.links.append((source_id, known.linked_user_id))
            continue
        email = (person.get("email") or "").strip().lower()
        candidates = by_email.get(email, []) if email else []
        account = (
            candidates[0]
            if len(candidates) == 1 and archived_emails.get(email) == 1
            else None
        )
        if account is not None and (
            account.pseudonym == pseudonym or not named or rename_pseudonyms
        ):
            if named and account.pseudonym != pseudonym:
                plan.pseudonyms[pseudonym] = account.pseudonym
            plan.users[source_id] = account.id
            plan.mapped.append(
                {
                    "pseudonym": account.pseudonym,
                    "username": account.username,
                    "by": "email",
                }
                | (
                    {"archived_pseudonym": pseudonym}
                    if account.pseudonym != pseudonym
                    else {}
                )
            )
            continue
        if named and pseudonym in in_use and not rename_pseudonyms:
            conflicts.append(pseudonym)
            continue
        kept = pseudonym if pseudonym not in in_use else fresh()
        if named and kept != pseudonym:
            plan.pseudonyms[pseudonym] = kept
        user_id, kept = _pseudonym_only(conn, kept, now)
        in_use.add(kept)
        plan.users[source_id] = user_id
        plan.erased[source_id] = str(person["username"])
        plan.new.add(source_id)
        entry = {"archived_pseudonym": pseudonym, "pseudonym": kept}
        if account is not None:
            plan.links.append((source_id, account.id))
            entry["linked_to"] = account.username
        plan.created.append(entry)
    plan.without_account = without_account
    for annotator_id in without_account:
        if annotator_id not in taken_by_work:
            continue
        if not rename_pseudonyms:
            conflicts.append(annotator_id)
            continue
        new = fresh()
        in_use.add(new)
        plan.pseudonyms[annotator_id] = new
    if conflicts:
        raise DomainError(
            "ARCHIVE_PSEUDONYM_TAKEN",
            {
                "pseudonyms": sorted(conflicts),
                "message": (
                    "People or work on this server already use pseudonyms (annotator"
                    " ids) the archived work carries. Import with new pseudonyms for"
                    " them (--rename-pseudonyms), or give each person the same"
                    " e-mail address on both servers."
                ),
            },
        )
    return plan


def _pseudonym_only(conn: Connection, pseudonym: str, now: datetime) -> tuple[int, str]:
    """Insert an anonymised account without login; its id and pseudonym."""
    user_id = conn.execute(
        insert(UserRow)
        .values(
            username=f"{ANONYMISED_PREFIX}pending-{uuid4().hex}",
            display_name=ANONYMISED_DISPLAY_NAME,
            email=None,
            pseudonym=pseudonym,
            active=False,
            anonymised_at=now,
            created_at=now,
            updated_at=now,
        )
        .returning(UserRow.id)
    ).scalar_one()
    conn.execute(
        update(UserRow)
        .where(UserRow.id == user_id)
        .values(username=f"{ANONYMISED_PREFIX}{user_id}")
    )
    return user_id, pseudonym


# Rewriting rows --------------------------------------------------------


def _rekey(value: Any, old: str, new: str) -> Any:
    """``value`` with every workspace key of project ``old`` moved to ``new``."""
    if isinstance(value, str):
        if old not in value:
            return value
        try:
            key = _decode_key_str(value)
        except (DomainError, ValueError):
            return value
        if key.project_key != old or _key_str(key) != value:
            return value
        return _key_str(key.model_copy(update={"project_key": new}))
    if isinstance(value, list):
        return [_rekey(item, old, new) for item in value]
    if isinstance(value, dict):
        copy = {k: _rekey(v, old, new) for k, v in value.items()}
        if copy.get("project_key") == old:
            copy["project_key"] = new
        return copy
    return value


def _replace_ids(value: Any, pattern: re.Pattern[str], ids: dict[str, str]) -> Any:
    """``value`` with every occurrence of an id of ``ids`` replaced, also in
    JSON keys and inside workspace keys and derived ids."""
    if isinstance(value, str):
        return pattern.sub(lambda m: ids[m.group(0)], value)
    if isinstance(value, list):
        return [_replace_ids(item, pattern, ids) for item in value]
    if isinstance(value, dict):
        return {
            _replace_ids(k, pattern, ids): _replace_ids(v, pattern, ids)
            for k, v in value.items()
        }
    return value


def _fresh_id(old: str) -> str:
    """A new random id of the same shape as ``old``."""
    if re.fullmatch(r"[0-9a-f]{64}", old):
        return hashlib.sha256(uuid4().bytes).hexdigest()
    match = re.fullmatch(r"(.*?)([0-9a-f]{32})", old)
    if match:
        return f"{match.group(1)}{uuid4().hex}"
    if re.fullmatch(r"[0-9a-f-]{36}", old):
        return str(uuid4())
    return f"{old}-{uuid4().hex[:12]}"


def _taken_ids(conn: Connection, archive: Archive) -> dict[str, str]:
    """New ids for the archive's server-wide text ids this server has already
    (an archive imported twice): old -> new."""
    renamed: dict[str, str] = {}
    for name, column in global_ids():
        wanted = [row[column] for row in archive.tables.get(name, [])]
        if not wanted:
            continue
        t = table(name)
        for start in range(0, len(wanted), _CHUNK):
            chunk = wanted[start : start + _CHUNK]
            for old in conn.execute(
                select(_col(t, column)).where(_col(t, column).in_(chunk))
            ).scalars():
                renamed[str(old)] = _fresh_id(str(old))
    return renamed


@dataclass
class Mapper:
    """Archive values to this server's values, and back (verification)."""

    project_id: int
    archive_project_id: int
    key: str
    archive_key: str
    users: dict[int, int]
    rows: dict[str, dict[int, int]] = field(default_factory=dict)
    # Server-wide text ids (rounds, reports, ...) taken here: old -> new.
    ids: dict[str, str] = field(default_factory=dict)
    # Pseudonyms the copied work names differently here: old -> new.
    pseudonyms: dict[str, str] = field(default_factory=dict)

    def inverse(self) -> Mapper:
        return Mapper(
            project_id=self.archive_project_id,
            archive_project_id=self.project_id,
            key=self.archive_key,
            archive_key=self.key,
            users={new: old for old, new in self.users.items()},
            rows={
                name: {new: old for old, new in ids.items()}
                for name, ids in self.rows.items()
            },
            ids={new: old for old, new in self.ids.items()},
            pseudonyms={new: old for old, new in self.pseudonyms.items()},
        )

    def row_id(self, target: str, value: int, *, orphans: bool = False) -> int:
        ids = self.rows.get(target, {})
        if value in ids:
            return ids[value]
        if orphans:
            # Kept negative: no row here can ever have this id.
            ids = self.rows.setdefault(target, {})
            ids[value] = -abs(value)
            return ids[value]
        raise DomainError(
            "ARCHIVE_INVALID",
            f"A row refers to {target} {value}, which is not archived.",
        )

    def user(self, value: int) -> int:
        if value not in self.users:
            raise DomainError(
                "ARCHIVE_INVALID", f"A row refers to user {value}, who is not archived."
            )
        return self.users[value]

    def convert(self, name: str, row: Mapping[str, Any]) -> dict[str, Any]:
        """One row with project, people, references and keys mapped.

        The identity column keeps its value (the caller decides).
        """
        roles = column_roles(name)
        out: dict[str, Any] = {}
        for column, value in row.items():
            role = roles[column]
            if value is None or role.kind in {"plain", "identity", "session"}:
                out[column] = value
            elif role.kind == "project":
                out[column] = self.project_id
            elif role.kind == "person":
                out[column] = self.user(int(value))
            elif role.kind == "row":
                assert role.target is not None
                out[column] = _json_ids(
                    value, self._rows_of(role.target, orphans=_orphans(name, column))
                )
        for extra in EXTRA_REFERENCES:
            if extra.table == name and extra.path and out.get(extra.column) is not None:
                out[extra.column] = _at_path(
                    out[extra.column], extra.path, self._extra(extra)
                )
        if name == "audit_events":
            target = AUDIT_TARGET_ROWS.get(str(out.get("target_type")))
            value = out.get("target_id")
            if target and isinstance(value, str) and re.fullmatch(r"-?\d+", value):
                out["target_id"] = str(self.row_id(target, int(value), orphans=True))
        if self.ids:
            for column, value in list(out.items()):
                if roles[column].kind == "plain":
                    out[column] = _replace_ids(value, self._id_pattern, self.ids)
        if self.pseudonyms:
            out = _people_in_row(name, out, self._pseudonym)
        if self.key != self.archive_key and name != "audit_events":
            for column, value in list(out.items()):
                if roles[column].kind == "plain":
                    out[column] = _rekey(value, self.archive_key, self.key)
            if name == "jobs":
                for column in ("payload", "result"):
                    value = out.get(column)
                    if (
                        isinstance(value, dict)
                        and value.get("project") == self.archive_key
                    ):
                        out[column] = {**value, "project": self.key}
        return out

    def _pseudonym(self, value: str) -> str:
        return self.pseudonyms.get(value, value)

    @cached_property
    def _id_pattern(self) -> re.Pattern[str]:
        return re.compile("|".join(re.escape(old) for old in self.ids))

    def _rows_of(self, target: str, *, orphans: bool) -> Callable[[int], int]:
        return lambda value: self.row_id(target, value, orphans=orphans)

    def _extra(self, extra: ExtraReference) -> Callable[[int], int]:
        if extra.target == USERS:
            return self.user
        return lambda v: self.row_id(extra.target, v, orphans=True)


def _orphans(name: str, column: str) -> bool:
    return any(
        e.table == name and e.column == column and e.orphans for e in EXTRA_REFERENCES
    )


def _ordered(name: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Rows in id order, each after the rows of its own table it refers to."""
    ident = identity_column(table(name))
    rows = sorted(
        rows, key=lambda r: (r.get(ident.name) if ident is not None else 0) or 0
    )
    refs = list(self_references(name))
    if not refs:
        return rows
    placed: set[tuple[Any, ...]] = set()
    pending, ordered = list(rows), []
    while pending:
        remaining = []
        for row in pending:
            ready = all(
                any(row.get(c) is None for c in columns)
                or tuple(row.get(c) for c in columns) in placed
                for columns, _ in refs
            )
            if ready:
                ordered.append(row)
                for _, referred in refs:
                    placed.add(tuple(row.get(c) for c in referred))
            else:
                remaining.append(row)
        if len(remaining) == len(pending):
            # A cycle or a reference out of the archive: the database decides.
            ordered.extend(remaining)
            break
        pending = remaining
    return ordered


def _typed(t: Table, row: Mapping[str, Any]) -> dict[str, Any]:
    """Insert parameters by column key, timestamps parsed, JSON null kept."""
    values: dict[str, Any] = {}
    for column in t.columns:
        if column.name not in row:
            continue
        value = row[column.name]
        if isinstance(column.type, DateTime) and isinstance(value, str):
            value = datetime.fromisoformat(value)
        elif isinstance(column.type, JSON) and value == JSON_NULL:
            value = JSON.NULL
        values[column.key] = value
    return values


def _statement(t: Table) -> Any:
    """An insert whose JSON columns store None as SQL NULL."""
    return insert(t).values(
        {
            c.key: bindparam(c.key, type_=JSONB(none_as_null=True))
            for c in t.columns
            if isinstance(c.type, JSON) and c.identity is None
        }
    )


_CHUNK = 1000


def _insert(
    conn: Connection, mapper: Mapper, name: str, rows: list[dict[str, Any]]
) -> None:
    t = table(name)
    ident = identity_column(t)
    ordered = _ordered(name, rows)
    if ident is None:
        params = [_typed(t, mapper.convert(name, row)) for row in ordered]
        for start in range(0, len(params), _CHUNK):
            conn.execute(_statement(t), params[start : start + _CHUNK])
        return
    ids = mapper.rows.setdefault(name, {})
    # Rows naming other rows of their table outside a foreign key (a job and
    # the job it came from) go one by one, each after the rows it names.
    chunk_size = 1 if extra_self_references(name) else _CHUNK
    for start in range(0, len(ordered), chunk_size):
        chunk = ordered[start : start + chunk_size]
        params = []
        for row in chunk:
            values = _typed(t, mapper.convert(name, row))
            values.pop(ident.key, None)
            params.append(values)
        returned = (
            conn.execute(
                _statement(t).returning(ident, sort_by_parameter_order=True), params
            )
            .scalars()
            .all()
        )
        for row, new in zip(chunk, returned, strict=True):
            ids[int(row[ident.name])] = int(new)


# Importing -------------------------------------------------------------


def _free_key_and_name(conn: Connection, key: str, name: str) -> tuple[str, str]:
    """The archived key and name, or the first free ``-N`` / `` (N)`` suffix."""
    keys = set(conn.execute(select(ProjectRow.project_key)).scalars())
    names = set(conn.execute(select(ProjectRow.name)).scalars())
    new_key = key
    number = 2
    while new_key in keys:
        suffix = f"-{number}"
        new_key = f"{key[: 63 - len(suffix)]}{suffix}"
        number += 1
    new_name = name
    number = 2
    while new_name in names:
        new_name = f"{name} ({number})"
        number += 1
    return new_key, new_name


def _check_ontology_files(conn: Connection, archive: Archive) -> None:
    """Refuse an archive without ontology files this server lacks.

    Raises:
        DomainError: ``ARCHIVE_ONTOLOGY_MISSING``.
    """
    have = set(
        conn.execute(
            select(OntologyFileRow.sha256).where(
                OntologyFileRow.sha256.in_(
                    [r["sha256"] for r in archive.ontology_files]
                )
            )
        ).scalars()
    )
    missing = [
        f"{row['filename']} ({row['sha256']})"
        for row in archive.ontology_files
        if row["sha256"] not in have and row["sha256"] not in archive.blobs
    ]
    if missing:
        raise DomainError(
            "ARCHIVE_ONTOLOGY_MISSING",
            {
                "files": missing,
                "message": (
                    "The archive was written without its ontology files and this"
                    " server lacks these. Upload them on the Ontologies page or"
                    " export the archive with its ontology files."
                ),
            },
        )


def _record_files(conn: Connection, archive: Archive) -> None:
    """The ``stored_files`` and ``ontology_files`` rows of the archived files,
    under their blob locks; the files themselves are written last
    (``_write_files``)."""
    for digest, path in sorted(archive.blobs.items()):
        Database.lock_blob(conn, digest)
        conn.execute(
            pg_insert(StoredFileRow)
            .values(sha256=digest, size=path.stat().st_size)
            .on_conflict_do_nothing()
        )
    for row in archive.ontology_files:
        if row["sha256"] in archive.blobs:
            conn.execute(
                pg_insert(OntologyFileRow)
                .values(**_typed(OntologyFileRow.__table__, row), uploaded_by=None)  # type: ignore[arg-type]
                .on_conflict_do_nothing()
            )


def _write_files(db: Database, archive: Archive, written: list[str]) -> None:
    """Store the archived files this server lacks; ``written`` names each one
    written, so a rollback can remove it again."""
    for digest, path in sorted(archive.blobs.items()):
        if db.blobs.put_file(path, digest):
            written.append(digest)


def _check_columns(archive: Archive) -> None:
    """Every archived column exists here (an older archive may lack some)."""
    columns = archive.manifest.get("columns") or {}
    for name, rows in archive.tables.items():
        known = {c.name for c in table(name).columns}
        listed = set(columns.get(name) or [])
        found = {key for row in rows for key in row}
        unknown = (listed | found) - known
        if unknown:
            raise DomainError(
                "ARCHIVE_FORMAT_UNSUPPORTED",
                f"Table {name} has columns this server lacks: {sorted(unknown)}.",
            )


def verify(conn: Connection, archive: Archive, mapper: Mapper) -> dict[str, Any]:
    """Read the imported project back in archive terms and compare it.

    Every table is mapped back to the archive's ids, serialized as the export
    does and compared with the manifest's row count and SHA-256.
    """
    back = mapper.inverse()
    columns = archive.manifest.get("columns") or {}
    mismatches = []
    total = 0
    for entry in ARCHIVED:
        if entry.name not in archive.tables:
            continue
        listed = columns.get(entry.name) or [c.name for c in table(entry.name).columns]
        found = []
        for row in _rows(conn, entry, mapper.project_id):
            original = back.convert(entry.name, row)
            ident = identity_column(table(entry.name))
            if ident is not None:
                original[ident.name] = back.row_id(entry.name, int(row[ident.name]))
            if entry.name == PROJECTS:
                project = archive.tables[PROJECTS][0]
                original["project_key"] = project["project_key"]
                original["name"] = project["name"]
            found.append({name: original.get(name) for name in listed})
        data = jsonl(found)
        expected = archive.manifest["files"][table_file(entry.name)]
        count = archive.manifest["rows"][entry.name]
        total += len(found)
        if len(found) != count or _sha(data) != expected["sha256"]:
            mismatches.append(
                {"table": entry.name, "rows": len(found), "expected_rows": count}
            )
    # The texts once more without any mapping back: no import may change one
    # (spans and text hashes depend on every character).
    archived_texts = sorted(
        (str(r["document_id"]), r.get("text"), r.get("text_sha256"))
        for r in archive.tables.get("documents", [])
    )
    imported_texts = sorted(
        (str(r.document_id), r.text, r.text_sha256)
        for r in conn.execute(
            select(
                DocumentRow.document_id, DocumentRow.text, DocumentRow.text_sha256
            ).where(DocumentRow.project_id == mapper.project_id)
        )
    )
    if archived_texts != imported_texts:
        mismatches.append(
            {
                "table": "documents",
                "check": "texts",
                "rows": len(imported_texts),
                "expected_rows": len(archived_texts),
            }
        )
    return {
        "ok": not mismatches,
        "tables_checked": len(archive.tables),
        "rows_checked": total,
        "files_checked": len(archive.manifest["files"]),
        "mismatches": mismatches,
    }


def _erase_labels(conn: Connection, project_id: int, plan: PeoplePlan) -> None:
    """Replace the archived usernames of pseudonym-only people in the
    project's audit trail and job labels, as the erasure does."""
    if not plan.erased:
        return
    names = dict(
        conn.execute(
            select(UserRow.id, UserRow.username).where(
                UserRow.id.in_([plan.users[i] for i in plan.erased])
            )
        )
        .tuples()
        .all()
    )
    conn.execute(text("SET LOCAL ontotator.erasure = on"))
    for source_id, old in plan.erased.items():
        user_id = plan.users[source_id]
        new = names[user_id]
        in_project = AuditEventRow.project_id == project_id
        conn.execute(
            update(AuditEventRow)
            .where(in_project, AuditEventRow.target_user_id == user_id)
            .values(target_id=new)
        )
        conn.execute(
            update(AuditEventRow)
            .where(
                in_project,
                (AuditEventRow.actor_user_id == user_id)
                | (AuditEventRow.actor_label == f"user:{old}"),
            )
            .values(actor_label=f"user:{new}")
        )
        conn.execute(
            update(AuditEventRow)
            .where(in_project, AuditEventRow.details["username"].astext == old)
            .values(
                details=AuditEventRow.details.op("||")(
                    func.jsonb_build_object("username", new)
                )
            )
        )
    conn.execute(text("SET LOCAL ontotator.erasure = off"))
    for source_id, old in plan.erased.items():
        user_id = plan.users[source_id]
        conn.execute(
            update(JobRow)
            .where(
                JobRow.project_id == project_id,
                (JobRow.requested_by == user_id)
                | (JobRow.requested_label == f"user:{old}"),
            )
            .values(requested_label=f"user:{names[user_id]}")
        )


def import_archive(
    db: Database,
    actor: Actor,
    data: bytes | Path,
    *,
    rename_pseudonyms: bool = False,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Import an archive as a new project, verify it and audit it, in one transaction.

    ``data`` is the archive or the path of its file. ``rename_pseudonyms``:
    see ``_resolve_people``. Everything is checked and resolved before the
    archived files are written; a failure removes the files it wrote.

    Raises:
        DomainError: the ``open_archive`` and ``check_revision`` errors,
            ``ARCHIVE_ONTOLOGY_MISSING``, ``ARCHIVE_PSEUDONYM_TAKEN``;
            ``ARCHIVE_VERIFICATION_FAILED`` (a ``StructuredJobError``) when the
            imported project does not read back as archived.
    """
    with open_archive(data) as archive:
        written: list[str] = []
        try:
            return _import(
                db,
                actor,
                archive,
                written,
                rename_pseudonyms=rename_pseudonyms,
                now=now,
            )
        except BaseException:
            from ontotator.exchange.jobs import unlink_deleted_files

            # Only files whose stored_files row the rollback removed go.
            unlink_deleted_files(db, written)
            raise


def _import(
    db: Database,
    actor: Actor,
    archive: Archive,
    written: list[str],
    *,
    rename_pseudonyms: bool,
    now: datetime | None,
) -> dict[str, Any]:
    check_revision(archive.manifest.get("alembic_revision"))
    _check_columns(archive)
    at = now or datetime.now(UTC)
    source = archive.tables[PROJECTS][0]
    source_instance = str(archive.manifest.get("instance_id") or "")
    with db.transaction() as conn:
        conn.execute(
            select(func.pg_advisory_xact_lock(_lock_id("project-archive-import")))
        )
        key, name = _free_key_and_name(conn, source["project_key"], source["name"])
        conn.execute(select(func.pg_advisory_xact_lock(_lock_id("project", key))))
        _check_ontology_files(conn, archive)
        plan = _resolve_people(
            conn,
            archive,
            instance_id(conn),
            at,
            rename_pseudonyms=rename_pseudonyms,
        )
        _record_files(conn, archive)
        project_row = dict(source)
        project_row.update(project_key=key, name=name, practice=False)
        values = _typed(table(PROJECTS), project_row)
        values.pop("id")
        project_id = conn.execute(
            insert(ProjectRow).values(**values).returning(ProjectRow.id)
        ).scalar_one()
        mapper = Mapper(
            project_id=project_id,
            archive_project_id=int(source["id"]),
            key=key,
            archive_key=source["project_key"],
            users=plan.users,
            rows={PROJECTS: {int(source["id"]): project_id}},
            ids=_taken_ids(conn, archive),
            pseudonyms=plan.pseudonyms,
        )
        for table_name in insert_order():
            if table_name == PROJECTS or not archive.tables.get(table_name):
                continue
            _insert(conn, mapper, table_name, archive.tables[table_name])
        verification = verify(conn, archive, mapper)
        if not verification["ok"]:
            raise StructuredJobError("ARCHIVE_VERIFICATION_FAILED", verification)
        _erase_labels(conn, project_id, plan)
        links = _link_at_import(conn, actor, project_id, plan, at)
        for source_id in sorted(plan.new):
            conn.execute(
                insert(ImportedPersonRow).values(
                    user_id=plan.users[source_id],
                    project_id=project_id,
                    archive_sha256=archive.sha256,
                    source_instance=source_instance,
                    source_user_id=source_id,
                    created_at=at,
                    linked_user_id=links.get(source_id),
                    linked_at=at if source_id in links else None,
                    linked_by=actor.user_id if source_id in links else None,
                )
            )
        # The files last, once everything else is in place.
        _write_files(db, archive, written)
        verification["blobs_checked"] = len(archive.blobs)
        manifest = archive.manifest
        result = {
            "project": key,
            "name": name,
            "renamed": key != source["project_key"],
            "archived_project": source["project_key"],
            "archived_name": source["name"],
            "archive_sha256": archive.sha256,
            "archive_created_at": manifest.get("created_at"),
            "archive_ontotator_version": manifest.get("ontotator_version"),
            "archive_alembic_revision": manifest.get("alembic_revision"),
            "source_instance": source_instance,
            "rows": sum(manifest["rows"].values()),
            "new_ids": len(mapper.ids),
            "renamed_pseudonyms": dict(sorted(plan.pseudonyms.items())),
            "people": {
                "mapped": plan.mapped,
                "pseudonym_only": plan.created,
                "without_account": plan.without_account,
            },
            "verification": verification,
        }
        record_audit(
            conn,
            actor,
            "project.import_archive",
            target_type="project",
            target_id=key,
            project_id=project_id,
            details={k: v for k, v in result.items() if k != "verification"}
            | {
                "verified": verification["ok"],
                "files_checked": verification["files_checked"],
            },
            at=at,
        )
    return result


def _link_at_import(
    conn: Connection, actor: Actor, project_id: int, plan: PeoplePlan, now: datetime
) -> dict[int, int]:
    """Give each e-mail account the roles of its pseudonym-only person."""
    links: dict[int, int] = {}
    for source_id, account_id in plan.links:
        _grant_person_roles(
            conn, actor, plan.users[source_id], account_id, now, project_id
        )
        links[source_id] = account_id
    return links


def _grant_person_roles(
    conn: Connection,
    actor: Actor,
    person_id: int,
    account_id: int,
    now: datetime,
    project_id: int | None = None,
) -> dict[str, list[str]]:
    """Grant ``account_id`` the roles ``person_id`` has; the roles per project."""
    from ontotator.auth.tokens import revoke_user_sessions

    username = conn.execute(
        select(UserRow.username).where(UserRow.id == account_id)
    ).scalar_one()
    query = (
        select(
            ProjectMembershipRow.project_id,
            ProjectRow.project_key,
            ProjectMembershipRow.role,
        )
        .join(ProjectRow, ProjectRow.id == ProjectMembershipRow.project_id)
        .where(ProjectMembershipRow.user_id == person_id)
    )
    if project_id is not None:
        query = query.where(ProjectMembershipRow.project_id == project_id)
    roles: dict[tuple[int, str], list[str]] = {}
    for row in conn.execute(query):
        roles.setdefault((row.project_id, row.project_key), []).append(row.role)
    granted: dict[str, list[str]] = {}
    for (pid, key), names in sorted(roles.items()):
        added = grant_roles(conn, actor, pid, account_id, username, names, now)  # type: ignore[arg-type]
        if added:
            granted[key] = list(added)
    if granted:
        revoke_user_sessions(conn, account_id, "project.member_roles", now)
    return granted


def link_person(
    db: Database,
    actor: Actor,
    pseudonym: str,
    username: str,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Link a pseudonym-only person of an archive import to a real account.

    The account gets the person's roles in every project; the person's work
    stays under its pseudonym. Audited as ``person.link``.

    Raises:
        DomainError: ``PERSON_NOT_FOUND`` (no pseudonym-only person with this
            pseudonym), ``PERSON_ALREADY_LINKED``, ``USER_NOT_FOUND`` or
            ``USER_ANONYMISED`` (the account is anonymised or pseudonym-only).
    """
    from ontotator.auth.accounts import normalize_username

    at = now or datetime.now(UTC)
    with db.transaction() as conn:
        person = conn.execute(
            select(UserRow.id, ImportedPersonRow.linked_user_id)
            .join(ImportedPersonRow, ImportedPersonRow.user_id == UserRow.id)
            .where(UserRow.pseudonym == pseudonym.strip())
            .with_for_update(of=ImportedPersonRow)
        ).one_or_none()
        if person is None:
            raise DomainError(
                "PERSON_NOT_FOUND",
                f"No pseudonym-only person of an archive import has '{pseudonym}'.",
            )
        if person.linked_user_id is not None:
            raise DomainError(
                "PERSON_ALREADY_LINKED",
                f"'{pseudonym}' is linked to an account already.",
            )
        try:
            name = normalize_username(username)
        except DomainError:
            name = username.strip().lower()
        account = conn.execute(
            select(UserRow.id, UserRow.username, UserRow.anonymised_at).where(
                UserRow.username == name
            )
        ).one_or_none()
        if account is None:
            raise DomainError("USER_NOT_FOUND", f"There is no user '{name}'.")
        if account.anonymised_at is not None:
            raise DomainError(
                "USER_ANONYMISED", f"'{name}' is anonymised and cannot be linked."
            )
        granted = _grant_person_roles(conn, actor, person.id, account.id, at)
        conn.execute(
            update(ImportedPersonRow)
            .where(ImportedPersonRow.user_id == person.id)
            .values(linked_user_id=account.id, linked_at=at, linked_by=actor.user_id)
        )
        record_audit(
            conn,
            actor,
            "person.link",
            target_type="user",
            target_id=account.username,
            details={"pseudonym": pseudonym.strip(), "roles": granted},
            at=at,
        )
    return {
        "pseudonym": pseudonym.strip(),
        "username": account.username,
        "roles": granted,
    }


# Jobs ------------------------------------------------------------------


def _require_admin(db: Database, job: Job) -> Actor:
    from ontotator.exchange.jobs import requester

    actor, access = requester(db, job)
    if not access.is_system_admin:
        raise DomainError(
            "ADMIN_REQUIRED", "Only a system administrator may archive projects."
        )
    return actor


def discard_archive_files(
    conn: Connection,
    now: datetime,
    *,
    everything: bool = False,
    job_ids: Iterable[int] | None = None,
) -> list[str]:
    """Delete the stored archives: an export's ZIP ``ARCHIVE_RETENTION``
    after its job finished, an uploaded ZIP once its import job finished.

    ``everything``: every finished job's archive at once (an account
    erasure: any archive may name the person with their e-mail address).
    ``job_ids``: only these jobs' archives, at once (the command line wrote
    the file out). The export job's result records ``file_deleted_at``.
    Returns the files whose rows went; remove them after the commit
    (``unlink_after_commit``). A file something else refers to stays.
    """
    from ontotator.exchange.jobs import delete_unreferenced_file

    cutoff = now - ARCHIVE_RETENTION
    finished = JobRow.status.in_(("succeeded", "failed"))
    due: ColumnElement[bool]
    if job_ids is not None:
        due = JobRow.id.in_(sorted(job_ids))
    elif everything:
        due = JobRow.finished_at.is_not(None)
    else:
        due = JobRow.finished_at < cutoff
    deleted: list[str] = []
    exports = conn.execute(
        select(JobRow.id, JobRow.result)
        .where(
            JobRow.kind == EXPORT_KIND,
            JobRow.status == "succeeded",
            JobRow.result["sha256"].astext.is_not(None),
            JobRow.result["file_deleted_at"].astext.is_(None),
            due,
        )
        .with_for_update()
    ).all()
    for job_id, result in exports:
        digest = str(result["sha256"])
        if delete_unreferenced_file(conn, digest, ignore_job_kinds=ARCHIVE_JOB_KINDS):
            deleted.append(digest)
        conn.execute(
            update(JobRow)
            .where(JobRow.id == job_id)
            .values(
                result=JobRow.result.op("||")(
                    func.jsonb_build_object("file_deleted_at", now.isoformat())
                )
            )
        )
    uploads = conn.execute(
        select(JobRow.payload["blob_sha256"].astext)
        .where(JobRow.kind == IMPORT_KIND, finished, due)
        .where(JobRow.payload["blob_sha256"].astext.in_(select(StoredFileRow.sha256)))
    ).scalars()
    for digest in sorted({str(d) for d in uploads}):
        Database.lock_blob(conn, digest)
        if _import_waits_for(conn, digest):
            continue
        if delete_unreferenced_file(conn, digest, ignore_job_kinds=ARCHIVE_JOB_KINDS):
            deleted.append(digest)
    return deleted


def expire_archive_files(db: Database, now: datetime | None = None) -> None:
    """``discard_archive_files`` of the archives past their retention (server
    start, each archive request and export)."""
    from ontotator.exchange.jobs import unlink_after_commit

    with db.transaction() as conn:
        deleted = discard_archive_files(conn, now or datetime.now(UTC))
        unlink_after_commit(db, deleted)


def release_archive_file(db: Database, job_id: int) -> None:
    """Delete the stored archive of one finished archive job now."""
    from ontotator.exchange.jobs import unlink_after_commit

    with db.transaction() as conn:
        deleted = discard_archive_files(conn, datetime.now(UTC), job_ids=[job_id])
        unlink_after_commit(db, deleted)


def _import_waits_for(conn: Connection, digest: str, job_id: int = 0) -> bool:
    """Whether another import job, queued or running, needs the file."""
    return (
        conn.execute(
            select(JobRow.id).where(
                JobRow.kind == IMPORT_KIND,
                JobRow.status.in_(("queued", "running")),
                JobRow.id != job_id,
                JobRow.payload["blob_sha256"].astext == digest,
            )
        ).first()
        is not None
    )


def _release_upload(db: Database, digest: str, job_id: int) -> None:
    """Delete the uploaded archive of an import that has finished."""
    from ontotator.exchange.jobs import delete_unreferenced_file, unlink_after_commit

    with db.transaction() as conn:
        Database.lock_blob(conn, digest)
        if _import_waits_for(conn, digest, job_id):
            return
        if delete_unreferenced_file(conn, digest, ignore_job_kinds=ARCHIVE_JOB_KINDS):
            unlink_after_commit(db, [digest])


def project_archive_export(job: Job, ctx: JobContext) -> dict[str, Any]:
    """Write the archive of ``payload.project``; audited as ``project.export_archive``.

    ``payload.include_ontology_files`` (default true) adds the ontology and
    translation files of the pins. The ZIP is kept ``ARCHIVE_RETENTION``.
    """
    from ontotator.exchange.jobs import store_file

    db = ctx.db
    actor = _require_admin(db, job)
    expire_archive_files(db)
    project = job.payload["project"]
    include = bool(job.payload.get("include_ontology_files", True))
    with tempfile.TemporaryDirectory(prefix="ontotator-archive-") as tmp:
        built = build_archive(
            db,
            project,
            Path(tmp) / "archive.zip",
            include_ontology_files=include,
            job_id=job.id,
        )
        sha = store_file(db, built.path.read_bytes())
    manifest = built.manifest
    result = {
        "sha256": sha,
        "size": built.size,
        "project": project,
        "rows": sum(manifest["rows"].values()),
        "tables": len(manifest["rows"]),
        "people": manifest["people"],
        "blobs": sum(1 for name in manifest["files"] if name.startswith("blobs/")),
        "ontology_files_included": include,
        "created_at": manifest["created_at"],
        "expires_at": (datetime.now(UTC) + ARCHIVE_RETENTION).isoformat(),
    }
    with db.transaction() as conn:
        record_audit(
            conn,
            actor,
            "project.export_archive",
            target_type="project",
            target_id=project,
            project_id=job.project_id,
            details={**result, "job_id": job.id},
        )
    return result


def project_archive_import(job: Job, ctx: JobContext) -> dict[str, Any]:
    """Import the archive stored as ``payload.blob_sha256`` as a new project.

    The stored ZIP is deleted when the job ends, whether it succeeded or not.
    """
    db = ctx.db
    digest = job.payload["blob_sha256"]
    try:
        actor = _require_admin(db, job)
        result = import_archive(
            db,
            actor,
            db.blobs.path(digest),
            rename_pseudonyms=bool(job.payload.get("rename_pseudonyms", False)),
        )
        with db.transaction() as conn:
            conn.execute(
                update(JobRow)
                .where(JobRow.id == job.id)
                .values(
                    project_id=select(ProjectRow.id)
                    .where(ProjectRow.project_key == result["project"])
                    .scalar_subquery()
                )
            )
        return result
    finally:
        _release_upload(db, digest, job.id)
