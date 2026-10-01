import hashlib
import io
import json
import zipfile
from pathlib import Path
from typing import BinaryIO

from hpo_editor.domain.annotations import AnnotationSnapshot
from hpo_editor.domain.canonical import canonical_hash
from hpo_editor.domain.documents import Document, EvidenceSnapshot, OntologyRef
from hpo_editor.domain.errors import InvalidPackage
from hpo_editor.domain.workspace import Submission
from hpo_editor.packages.models import (
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


def read_package(source: Path | BinaryIO) -> ValidatedPackage:
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
        snap = AnnotationSnapshot.model_validate_json(line)
        # Verify hash
        sorted_ev = sorted(
            snap.evidence, key=lambda e: (e.mention.evidence_id, e.version)
        )
        expected_v = canonical_hash(
            {
                "annotation": snap.annotation.model_dump(),
                "document_id": snap.document_id,
                "evidence": [e.model_dump() for e in sorted_ev],
                "ontology_sha256": snap.ontology_sha256,
                "text_sha256": snap.text_sha256,
            }
        )
        if snap.version != expected_v:
            raise InvalidPackage(
                f"AnnotationSnapshot hash mismatch: {snap.version} != {expected_v}"
            )
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
        submissions[sub.submission_id] = sub

    # Parse search-events.jsonl
    search_events: list[SearchEventRecord] = []
    for line in file_contents["search-events.jsonl"].decode("utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        search_events.append(SearchEventRecord.model_validate_json(line))

    # Cross-reference validation
    for (ann_id, ann_ver), snap in annotations.items():
        if snap.annotation.document_id not in documents:
            raise InvalidPackage(
                f"Annotation ({ann_id}, {ann_ver}) references missing document "
                f"'{snap.annotation.document_id}'"
            )
        for ref in snap.annotation.evidence_refs:
            if (ref.evidence_id, ref.version) not in evidence:
                raise InvalidPackage(
                    f"Annotation ({ann_id}, {ann_ver}) references missing evidence "
                    f"({ref.evidence_id}, {ref.version})"
                )

    return ValidatedPackage(
        manifest=manifest,
        documents=documents,
        annotations=annotations,
        evidence=evidence,
        submissions=submissions,
        search_events=search_events,
    )


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

