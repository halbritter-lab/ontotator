import hashlib
import io
import json
import zipfile
from pathlib import Path
from typing import BinaryIO

from ontocurator.domain.annotations import AnnotationSnapshot
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.documents import (
    Document,
    EvidenceSnapshot,
    OntologyRef,
    validate_segments,
)
from ontocurator.domain.errors import DomainError, InvalidPackage
from ontocurator.domain.review import ReviewTargetSet
from ontocurator.domain.serialization import decode_snapshot, verify_snapshot
from ontocurator.domain.workspace import Submission
from ontocurator.packages.models import (
    PackageManifest,
    SearchEventRecord,
    ValidatedPackage,
)

ALLOWED_FILES = {
    "manifest.json",
    "documents.jsonl",
    "annotations.jsonl",
    "evidence.jsonl",
    "submissions.jsonl",
    "search-events.jsonl",
}

MAX_COMPRESSED_BYTES = 64 * 1024 * 1024  # 64 MiB
MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024  # 256 MiB
MAX_DOCUMENTS = 10_000
MAX_DOCUMENT_TEXT_BYTES = 2 * 1024 * 1024  # 2 MiB


def _read_package(source: Path | BinaryIO) -> ValidatedPackage:
    """Read, stream-validate and return ValidatedPackage from ZIP archive or stream."""
    if isinstance(source, (str, Path)):
        path = Path(source)
        if not path.is_file():
            raise InvalidPackage(f"Package file does not exist: {path}")
        compressed_size = path.stat().st_size
        target: str | Path | BinaryIO = path
    else:
        source.seek(0, io.SEEK_END)
        compressed_size = source.tell()
        source.seek(0)
        target = source

    if compressed_size > MAX_COMPRESSED_BYTES:
        raise InvalidPackage(
            f"Package compressed size exceeds limit "
            f"({compressed_size} > {MAX_COMPRESSED_BYTES} bytes)"
        )

    file_contents: dict[str, bytes] = {}
    total_uncompressed = 0

    try:
        with zipfile.ZipFile(target, "r") as z:
            names = z.namelist()
            seen_names: set[str] = set()

            for name in names:
                if name in seen_names:
                    raise InvalidPackage(f"Duplicate entry in ZIP archive: '{name}'")
                seen_names.add(name)

                # Disallow path traversal, directory entries, absolute paths
                if "/" in name or "\\" in name or name.startswith(".."):
                    raise InvalidPackage(
                        f"Disallowed file in archive (path traversal/dir): '{name}'"
                    )

                if name not in ALLOWED_FILES:
                    raise InvalidPackage(f"Disallowed file in archive: '{name}'")

                # Stream-read and count bytes
                info = z.getinfo(name)
                # Check for symlinks (0o120000)
                if (info.external_attr >> 16) & 0o120000 == 0o120000:
                    raise InvalidPackage(f"Symlink entry disallowed: '{name}'")

                entry_bytes = bytearray()
                with z.open(name, "r") as f:
                    while chunk := f.read(65536):
                        total_uncompressed += len(chunk)
                        if total_uncompressed > MAX_UNCOMPRESSED_BYTES:
                            raise InvalidPackage(
                                f"Package uncompressed size exceeds limit "
                                f"({MAX_UNCOMPRESSED_BYTES} bytes)"
                            )
                        entry_bytes.extend(chunk)

                file_contents[name] = bytes(entry_bytes)

    except zipfile.BadZipFile as e:
        raise InvalidPackage(f"Corrupted or invalid ZIP file: {e}") from e

    # Check that required files exist
    if "manifest.json" not in file_contents:
        raise InvalidPackage("Package archive missing required 'manifest.json'")

    # Parse and validate manifest
    try:
        manifest_data = json.loads(file_contents["manifest.json"].decode("utf-8"))
        manifest = PackageManifest.model_validate(manifest_data)
    except Exception as e:
        raise InvalidPackage(f"Invalid manifest.json: {e}") from e

    # Check file hashes recorded in manifest
    for filename in ALLOWED_FILES - {"manifest.json"}:
        if filename not in file_contents:
            raise InvalidPackage(f"Package missing required dataset: '{filename}'")

        data = file_contents[filename]
        actual_hash = hashlib.sha256(data).hexdigest()
        expected_hash = manifest.file_hashes.get(filename)
        if expected_hash != actual_hash:
            raise InvalidPackage(
                f"File SHA-256 mismatch for '{filename}': "
                f"expected {expected_hash}, got {actual_hash}"
            )

    # Parse documents.jsonl
    documents: dict[str, Document] = {}
    for line in file_contents["documents.jsonl"].decode("utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        if len(documents) >= MAX_DOCUMENTS:
            raise InvalidPackage(f"Document count exceeds limit ({MAX_DOCUMENTS})")
        doc = Document.model_validate_json(line)
        if len(doc.text.encode("utf-8")) > MAX_DOCUMENT_TEXT_BYTES:
            raise InvalidPackage(
                f"Document '{doc.document_id}' text exceeds 2 MiB limit"
            )
        if doc.document_id in documents and documents[doc.document_id] != doc:
            raise InvalidPackage(f"Conflicting document: {doc.document_id}")
        documents[doc.document_id] = doc

    # Parse evidence.jsonl
    evidence: dict[tuple[str, str], EvidenceSnapshot] = {}
    for line in file_contents["evidence.jsonl"].decode("utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        ev = EvidenceSnapshot.model_validate_json(line)
        # Verify hash
        expected_v = canonical_hash(
            {
                "document_id": ev.document_id,
                "mention": ev.mention.model_dump(),
                "text_sha256": ev.text_sha256,
            }
        )
        if ev.version != expected_v:
            raise InvalidPackage(
                f"EvidenceSnapshot hash mismatch: {ev.version} != {expected_v}"
            )
        key = (ev.mention.evidence_id, ev.version)
        if key in evidence and evidence[key] != ev:
            raise InvalidPackage(
                f"Conflicting content under same (id, version) key: {key}"
            )
        evidence[key] = ev

    # Parse annotations.jsonl
    annotations: dict[tuple[str, str], AnnotationSnapshot] = {}
    for line in file_contents["annotations.jsonl"].decode("utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            snap_data = json.loads(line)
            snap = decode_snapshot(snap_data)
            verify_snapshot(snap)
        except Exception as exc:
            raise InvalidPackage(f"AnnotationSnapshot hash mismatch: {exc}") from exc
        key = (snap.annotation.annotation_id, snap.version)
        if key in annotations and annotations[key] != snap:
            raise InvalidPackage(
                f"Conflicting content under same (id, version) key: {key}"
            )
        annotations[key] = snap

    # Parse submissions.jsonl
    submissions: dict[str, Submission] = {}
    for line in file_contents["submissions.jsonl"].decode("utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        sub = Submission.model_validate_json(line)
        if sub.submission_id in submissions and submissions[sub.submission_id] != sub:
            raise InvalidPackage(f"Conflicting submission: {sub.submission_id}")
        submissions[sub.submission_id] = sub

    # Parse search-events.jsonl
    search_events: list[SearchEventRecord] = []
    for line in file_contents["search-events.jsonl"].decode("utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        search_events.append(SearchEventRecord.model_validate_json(line))

    # Hashes alone do not establish that a snapshot belongs to this document.
    for ev in evidence.values():
        bound_doc = documents.get(ev.document_id)
        if bound_doc is None or ev.text_sha256 != bound_doc.text_sha256:
            raise InvalidPackage("Evidence document or text digest mismatch")
        try:
            validate_segments(bound_doc.text, [ev.mention])
        except Exception as exc:
            raise InvalidPackage(f"Evidence bounds invalid: {exc}") from exc

    for snap in annotations.values():
        bound_doc = documents.get(snap.document_id)
        if (
            bound_doc is None
            or snap.annotation.document_id != snap.document_id
            or snap.text_sha256 != bound_doc.text_sha256
            or snap.ontology_sha256 != manifest.ontology.sha256
        ):
            raise InvalidPackage(
                "Annotation document, text or ontology identity mismatch"
            )
        refs = {(r.evidence_id, r.version) for r in snap.annotation.evidence_refs}
        embedded = {(e.mention.evidence_id, e.version): e for e in snap.evidence}
        if refs != set(embedded) or len(embedded) != len(snap.evidence):
            raise InvalidPackage(
                "Annotation evidence references do not match embedded evidence"
            )
        for ref, ev in embedded.items():
            if (
                evidence.get(ref) != ev
                or ev.document_id != bound_doc.document_id
                or ev.text_sha256 != bound_doc.text_sha256
            ):
                raise InvalidPackage(
                    "Annotation evidence is missing or bound to another document"
                )

    for sub in submissions.values():
        if sub.origin_key.document_id not in documents:
            raise InvalidPackage("Submission references missing document")
        canonical_targets = ReviewTargetSet.create(sub.targets.targets)
        if sub.targets != canonical_targets:
            raise InvalidPackage("Submission target set identity mismatch")
        if (
            sub.origin_key.mode == "review"
            and sub.origin_key.target_set_id != sub.targets.target_set_id
        ):
            raise InvalidPackage("Submission workspace target identity mismatch")
        target_refs = {(r.annotation_id, r.version) for r in sub.targets.targets}
        for ref in target_refs:
            target_snapshot = annotations.get(ref)
            if (
                target_snapshot is None
                or target_snapshot.document_id != sub.origin_key.document_id
            ):
                raise InvalidPackage(
                    "Submission target is missing or belongs to another document"
                )
        submitted = {(a.annotation.annotation_id, a.version): a for a in sub.snapshots}
        if len(submitted) != len(sub.snapshots):
            raise InvalidPackage("Duplicate submitted annotation reference")
        for ref, snap in submitted.items():
            if (
                annotations.get(ref) != snap
                or snap.document_id != sub.origin_key.document_id
            ):
                raise InvalidPackage(
                    "Submitted snapshot is missing, changed or from another document"
                )
        decided = {(d.target.annotation_id, d.target.version) for d in sub.decisions}
        if sub.origin_key.mode == "review":
            if decided != target_refs or len(decided) != len(sub.decisions):
                raise InvalidPackage(
                    "Submission decisions do not cover exactly its review targets"
                )
        elif sub.decisions or target_refs:
            raise InvalidPackage(
                "Independent submission cannot contain review decisions or targets"
            )
        for decision in sub.decisions:
            approved = (
                decision.target
                if decision.outcome == "confirmed"
                else decision.replacement
            )
            if (
                approved is not None
                and (approved.annotation_id, approved.version) not in submitted
            ):
                raise InvalidPackage(
                    "Approved annotation version missing from submission"
                )
        if not sub.document_checked:
            raise InvalidPackage("Submitted document must be checked")

    return ValidatedPackage(
        manifest=manifest,
        documents=documents,
        annotations=annotations,
        evidence=evidence,
        submissions=submissions,
        search_events=search_events,
    )


def read_package(source: Path | BinaryIO) -> ValidatedPackage:
    try:
        return _read_package(source)
    except InvalidPackage:
        raise
    except (ValueError, UnicodeError, KeyError, DomainError) as exc:
        raise InvalidPackage(f"Invalid package dataset: {exc}") from exc


class PackageReader:
    """Convenience class for reading packages from paths or streams."""

    @staticmethod
    def read_from_stream(
        stream: BinaryIO, ontology_ref: OntologyRef | None = None
    ) -> ValidatedPackage:
        pkg = read_package(stream)
        if ontology_ref and pkg.manifest.ontology.sha256 != ontology_ref.sha256:
            raise InvalidPackage(
                f"Ontology SHA mismatch: expected {ontology_ref.sha256}, "
                f"got {pkg.manifest.ontology.sha256}"
            )
        return pkg

    @staticmethod
    def read(path: Path) -> ValidatedPackage:
        return read_package(path)
