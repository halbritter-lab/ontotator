import hashlib
import io
import json
import zipfile
from pathlib import Path
from typing import BinaryIO

from ontocurator.domain.annotations import AnnotationSnapshot
from ontocurator.domain.axes import validate_axes
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.documents import (
    Document,
    EvidenceSnapshot,
    validate_segments,
)
from ontocurator.domain.errors import DomainError, InvalidPackage
from ontocurator.domain.profiles import (
    layer_config_hash,
    profile_hash,
    resolve_layer,
    resolve_ontology,
    resolve_type,
)
from ontocurator.domain.results import latest_submissions
from ontocurator.domain.review import ReviewTargetSet
from ontocurator.domain.serialization import decode_snapshot, verify_snapshot
from ontocurator.domain.workspace import Submission
from ontocurator.ontology.registry import OntologyRegistry
from ontocurator.packages.models import (
    PackageManifest,
    SearchEventRecord,
    ValidatedPackage,
)

BASE_ALLOWED_FILES = {
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


def _jsonl_records(data: bytes) -> list[str]:
    """Split a JSONL dataset into records on LF only.

    ``str.splitlines`` also breaks on U+2028, U+2029, U+0085 and other Unicode
    separators, which the writer emits verbatim inside JSON strings
    (``ensure_ascii=False``). JSONL records are delimited by ``\n`` alone; an
    optional trailing ``\r`` from CRLF files is tolerated.
    """
    records: list[str] = []
    for raw in data.decode("utf-8").split("\n"):
        line = raw[:-1] if raw.endswith("\r") else raw
        if not line.strip(" \t"):
            continue
        records.append(line)
    return records


def _read_package(
    source: Path | BinaryIO,
    registry: OntologyRegistry | None = None,
) -> ValidatedPackage:
    """Read, stream-validate and return ValidatedPackage V2 from ZIP archive or stream."""
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

                # Disallow path traversal, backslashes, absolute paths
                normalized = name.replace("\\", "/")
                if (
                    name.startswith(("/", "\\"))
                    or "\\" in name
                    or ".." in normalized.split("/")
                    or ":" in name
                ):
                    raise InvalidPackage(
                        f"Disallowed file in archive (path traversal/dir): '{name}'"
                    )

                # Check for symlinks (0o120000)
                info = z.getinfo(name)
                if (info.external_attr >> 16) & 0o120000 == 0o120000:
                    raise InvalidPackage(f"Symlink entry disallowed: '{name}'")

                entry_bytes = bytearray()
                with z.open(name, "r") as f:
                    while chunk := f.read(65536):
                        total_uncompressed += len(chunk)
                        if total_uncompressed > MAX_UNCOMPRESSED_BYTES:
                            raise InvalidPackage(
                                f"Package uncompressed size exceeds limit ({MAX_UNCOMPRESSED_BYTES} bytes)"
                            )
                        entry_bytes.extend(chunk)

                file_contents[name] = bytes(entry_bytes)

    except zipfile.BadZipFile as e:
        raise InvalidPackage(f"Invalid ZIP archive: {e}") from e

    # Parse manifest.json first to discover declared task_profile and resource_paths
    if "manifest.json" not in file_contents:
        raise InvalidPackage("Package missing manifest.json")

    try:
        manifest_data = json.loads(file_contents["manifest.json"].decode("utf-8"))
        format_version = manifest_data.get("format_version")
        if format_version != "ontocurator-work-package/v2":
            raise InvalidPackage(
                f"Unsupported package format version: '{format_version}'; only 'ontocurator-work-package/v2' is supported"
            )
        manifest = PackageManifest.model_validate(manifest_data)
        if manifest.task_profile is None:
            raise InvalidPackage("Package manifest missing required 'task_profile'")
        computed_profile_sha = profile_hash(manifest.task_profile)
        if manifest.task_profile_sha256 != computed_profile_sha:
            raise InvalidPackage(
                f"TaskProfile SHA-256 mismatch in manifest: expected {manifest.task_profile_sha256}, got {computed_profile_sha}"
            )
    except Exception as e:
        if isinstance(e, InvalidPackage):
            raise
        raise InvalidPackage(f"Invalid manifest.json: {e}") from e

    # Determine allowed files in archive
    allowed_files = set(BASE_ALLOWED_FILES)
    for ont in manifest.task_profile.ontologies:
        if ont.resource_path:
            allowed_files.add(ont.resource_path)

    for name in file_contents:
        if name not in allowed_files:
            raise InvalidPackage(f"Disallowed file in archive: '{name}'")

    # Check file hashes recorded in manifest for all non-manifest files
    for filename in allowed_files - {"manifest.json"}:
        if filename in BASE_ALLOWED_FILES and filename not in file_contents:
            raise InvalidPackage(f"Package missing required dataset: '{filename}'")

        if filename in file_contents:
            data = file_contents[filename]
            actual_hash = hashlib.sha256(data).hexdigest()
            expected_hash = manifest.file_hashes.get(filename)
            if expected_hash is None:
                raise InvalidPackage(
                    f"Manifest is missing the required SHA-256 entry for '{filename}'"
                )
            if expected_hash.lower() != actual_hash:
                raise InvalidPackage(
                    f"File SHA-256 mismatch for '{filename}': "
                    f"expected {expected_hash}, got {actual_hash}"
                )

    # Verify embedded ontology resources
    for ont in manifest.task_profile.ontologies:
        if ont.resource_path and ont.resource_path in file_contents:
            ont_data = file_contents[ont.resource_path]
            actual_sha = hashlib.sha256(ont_data).hexdigest().lower()
            if actual_sha != ont.sha256.lower():
                raise InvalidPackage(
                    f"Embedded ontology resource SHA-256 mismatch for '{ont.resource_path}': "
                    f"expected {ont.sha256}, got {actual_sha}"
                )

    # Collect missing ontologies
    if registry is not None:
        missing_ontologies: list[str] = []
        for ont in manifest.task_profile.ontologies:
            has_embedded = bool(
                ont.resource_path and ont.resource_path in file_contents
            )
            has_ont = (
                registry.has_ontology(ont.sha256)
                if hasattr(registry, "has_ontology")
                else (registry.get_service(ont.sha256) is not None)
            )
            if not has_embedded and not has_ont:
                missing_ontologies.append(f"'{ont.ontology_id}' ({ont.sha256})")
        if missing_ontologies:
            raise DomainError(
                "ONTOLOGY_NOT_FOUND",
                f"Missing required external ontologies: {', '.join(missing_ontologies)}. "
                f"Please provide them via '--ontology PATH'.",
            )
    else:
        for ont in manifest.task_profile.ontologies:
            if ont.resource_path and ont.resource_path not in file_contents:
                raise InvalidPackage(
                    f"Package missing declared ontology resource: '{ont.resource_path}'"
                )

    # Parse documents.jsonl
    documents: dict[str, Document] = {}
    for line in _jsonl_records(file_contents["documents.jsonl"]):
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

    # Validate document_order
    if not manifest.document_order:
        raise InvalidPackage("Package manifest missing required 'document_order'")
    if len(manifest.document_order) != len(set(manifest.document_order)):
        raise InvalidPackage("Duplicate document IDs in document_order")
    if set(manifest.document_order) != set(documents.keys()):
        raise InvalidPackage(
            f"document_order mismatch: expected {list(documents.keys())}, got {manifest.document_order}"
        )

    # Parse evidence.jsonl
    evidence: dict[tuple[str, str], EvidenceSnapshot] = {}
    for line in _jsonl_records(file_contents["evidence.jsonl"]):
        ev = EvidenceSnapshot.model_validate_json(line)
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
    for line in _jsonl_records(file_contents["annotations.jsonl"]):
        try:
            snap_data = json.loads(line)
            snap = decode_snapshot(snap_data)
            verify_snapshot(snap)
        except Exception as exc:
            raise InvalidPackage(
                f"AnnotationSnapshot verification failed: {exc}"
            ) from exc
        key = (snap.annotation.annotation_id, snap.version)
        if key in annotations and annotations[key] != snap:
            raise InvalidPackage(
                f"Conflicting content under same (id, version) key: {key}"
            )
        annotations[key] = snap

    # Parse submissions.jsonl
    submissions: dict[str, Submission] = {}
    for line in _jsonl_records(file_contents["submissions.jsonl"]):
        sub = Submission.model_validate_json(line)
        if sub.submission_id in submissions and submissions[sub.submission_id] != sub:
            raise InvalidPackage(f"Conflicting submission: {sub.submission_id}")
        submissions[sub.submission_id] = sub

    # Parse search-events.jsonl
    search_events: list[SearchEventRecord] = []
    for line in _jsonl_records(file_contents["search-events.jsonl"]):
        search_events.append(SearchEventRecord.model_validate_json(line))

    # Cross-dataset integrity checks
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
        ):
            raise InvalidPackage("Annotation document or text identity mismatch")
        # Check layer, type, axes and ontology binding against profile.
        try:
            layer = resolve_layer(manifest.task_profile, snap.annotation.layer_id)
            ont = resolve_ontology(manifest.task_profile, layer.ontology_id)
            type_def = resolve_type(
                manifest.task_profile, layer.layer_id, snap.annotation.type_id
            )
            validate_axes(snap.annotation.axes_values, type_def.axes, complete=False)
            expected_layer_hash = layer_config_hash(
                manifest.task_profile, snap.annotation.layer_id
            )
        except Exception as exc:
            raise InvalidPackage(
                f"Annotation does not match task profile: {exc}"
            ) from exc

        if snap.ontology_sha256 != ont.sha256:
            raise InvalidPackage("Annotation ontology SHA-256 identity mismatch")
        if snap.layer_config_sha256 != expected_layer_hash:
            raise InvalidPackage("Annotation layer_config_sha256 mismatch")

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
        if sub.format_version != "ontocurator-submission/v2" or sub.draft_revision < 1:
            raise InvalidPackage("Unsupported submission format or revision")
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
            for decision in sub.decisions:
                target_ref = (decision.target.annotation_id, decision.target.version)
                reviewed_snapshot = annotations[target_ref]
                if decision.reviewer_id != sub.origin_key.annotator_id:
                    raise InvalidPackage(
                        "Review decision reviewer does not match submission origin"
                    )
                if decision.outcome == "confirmed":
                    if target_ref not in submitted:
                        raise InvalidPackage(
                            "Confirmed review target is missing from submitted results"
                        )
                elif target_ref in submitted:
                    raise InvalidPackage(
                        "Unapproved review target occurs in submitted results"
                    )
                if decision.outcome == "changed":
                    replacement = decision.replacement
                    assert replacement is not None
                    replacement_ref = (replacement.annotation_id, replacement.version)
                    replacement_snap = annotations.get(replacement_ref)
                    if replacement_snap is None or replacement_ref not in submitted:
                        raise InvalidPackage(
                            "Review replacement is missing from submitted results"
                        )
                    if (
                        replacement_snap.document_id != reviewed_snapshot.document_id
                        or replacement_snap.annotation.layer_id
                        != reviewed_snapshot.annotation.layer_id
                        or replacement_snap.annotation.type_id
                        != reviewed_snapshot.annotation.type_id
                    ):
                        raise InvalidPackage(
                            "Review replacement document, layer or type mismatch"
                        )
            for snap in sub.snapshots:
                linked_targets = [
                    r
                    for r in sub.targets.targets
                    if f"{r.annotation_id}:{r.version}"
                    in snap.annotation.provenance.source_refs
                ]
                if linked_targets and not any(
                    d.outcome == "changed"
                    and d.target in linked_targets
                    and d.replacement is not None
                    and d.replacement.annotation_id == snap.annotation.annotation_id
                    and d.replacement.version == snap.version
                    for d in sub.decisions
                ):
                    raise InvalidPackage(
                        "Unresolved adopted copy in submitted review results"
                    )
        elif sub.decisions or target_refs:
            raise InvalidPackage(
                "Independent submission cannot contain review decisions or targets"
            )

    try:
        latest_submissions(submissions.values())
    except DomainError as exc:
        raise InvalidPackage(str(exc)) from exc

    return ValidatedPackage(
        manifest=manifest,
        documents=documents,
        annotations=annotations,
        evidence=evidence,
        submissions=submissions,
        search_events=search_events,
        embedded_files={
            ont.resource_path: file_contents[ont.resource_path]
            for ont in manifest.task_profile.ontologies
            if ont.resource_path and ont.resource_path in file_contents
        },
    )


def read_package(
    source: Path | BinaryIO,
    registry: OntologyRegistry | None = None,
) -> ValidatedPackage:
    """Read and validate a V2 work package archive."""
    try:
        return _read_package(source, registry=registry)
    except InvalidPackage:
        raise
    except DomainError:
        raise
    except (ValueError, UnicodeError, KeyError) as exc:
        raise InvalidPackage(f"Invalid package dataset: {exc}") from exc


class PackageReader:
    """Convenience class for reading packages from paths or streams."""

    @staticmethod
    def read_from_stream(
        stream: BinaryIO,
        registry: OntologyRegistry | None = None,
    ) -> ValidatedPackage:
        return read_package(stream, registry=registry)

    @staticmethod
    def read(
        path: Path,
        registry: OntologyRegistry | None = None,
    ) -> ValidatedPackage:
        return read_package(path, registry=registry)
