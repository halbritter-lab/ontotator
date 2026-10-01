import hashlib
import json
import os
import tempfile
import zipfile
from pathlib import Path
from typing import BinaryIO

from hpo_editor.domain.errors import InvalidPackage
from hpo_editor.packages.models import ValidatedPackage


def _prepare_package_payloads(
    package: ValidatedPackage,
) -> tuple[bytes, bytes, bytes, bytes, bytes, bytes]:
    # 1. Referential integrity checks
    for (ann_id, ann_ver), snap in package.annotations.items():
        if snap.annotation.document_id not in package.documents:
            raise InvalidPackage(
                f"Annotation ({ann_id}, {ann_ver}) references missing document "
                f"'{snap.annotation.document_id}'"
            )
        for ref in snap.annotation.evidence_refs:
            if (ref.evidence_id, ref.version) not in package.evidence:
                raise InvalidPackage(
                    f"Annotation ({ann_id}, {ann_ver}) references missing evidence "
                    f"({ref.evidence_id}, {ref.version})"
                )

    # 2. Serialize jsonl datasets
    doc_lines = [
        json.dumps(doc.model_dump(), ensure_ascii=False)
        for _, doc in sorted(package.documents.items(), key=lambda kv: kv[0])
    ]
    docs_bytes = ("\n".join(doc_lines) + ("\n" if doc_lines else "")).encode("utf-8")

    ann_lines = [
        json.dumps(snap.model_dump(), ensure_ascii=False)
        for _, snap in sorted(package.annotations.items(), key=lambda kv: kv[0])
    ]
    ann_bytes = ("\n".join(ann_lines) + ("\n" if ann_lines else "")).encode("utf-8")

    ev_lines = [
        json.dumps(ev.model_dump(), ensure_ascii=False)
        for _, ev in sorted(package.evidence.items(), key=lambda kv: kv[0])
    ]
    ev_bytes = ("\n".join(ev_lines) + ("\n" if ev_lines else "")).encode("utf-8")

    sub_lines = [
        json.dumps(sub.model_dump(), ensure_ascii=False)
        for _, sub in sorted(package.submissions.items(), key=lambda kv: kv[0])
    ]
    sub_bytes = ("\n".join(sub_lines) + ("\n" if sub_lines else "")).encode("utf-8")

    search_lines = [
        json.dumps(ev.model_dump(), ensure_ascii=False)
        for ev in sorted(package.search_events, key=lambda e: (e.timestamp, e.event_id))
    ]
    search_bytes = ("\n".join(search_lines) + ("\n" if search_lines else "")).encode(
        "utf-8"
    )

    # 3. Compute digests
    file_hashes = {
        "documents.jsonl": hashlib.sha256(docs_bytes).hexdigest(),
        "annotations.jsonl": hashlib.sha256(ann_bytes).hexdigest(),
        "evidence.jsonl": hashlib.sha256(ev_bytes).hexdigest(),
        "submissions.jsonl": hashlib.sha256(sub_bytes).hexdigest(),
        "search-events.jsonl": hashlib.sha256(search_bytes).hexdigest(),
    }

    manifest_copy = package.manifest.model_copy(update={"file_hashes": file_hashes})
    manifest_bytes = json.dumps(
        manifest_copy.model_dump(), indent=2, ensure_ascii=False
    ).encode("utf-8")

    return (
        manifest_bytes,
        docs_bytes,
        ann_bytes,
        ev_bytes,
        sub_bytes,
        search_bytes,
    )


def write_package_to_stream(package: ValidatedPackage, stream: BinaryIO) -> None:
    """Write package archive to stream."""
    (
        manifest_bytes,
        docs_bytes,
        ann_bytes,
        ev_bytes,
        sub_bytes,
        search_bytes,
    ) = _prepare_package_payloads(package)

    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", manifest_bytes)
        z.writestr("documents.jsonl", docs_bytes)
        z.writestr("annotations.jsonl", ann_bytes)
        z.writestr("evidence.jsonl", ev_bytes)
        z.writestr("submissions.jsonl", sub_bytes)
        z.writestr("search-events.jsonl", search_bytes)


def write_package(package: ValidatedPackage, target: Path) -> None:
    """Validate referential integrity and atomically write a work package archive."""
    target_dir = target.parent
    target_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile(
        dir=target_dir, delete=False, suffix=".zip.tmp"
    ) as tmp_file:
        tmp_path = Path(tmp_file.name)

    try:
        with open(tmp_path, "wb") as f:
            write_package_to_stream(package, f)
        os.replace(tmp_path, target)
    except Exception:
        if tmp_path.exists():
            tmp_path.unlink()
        raise


class PackageWriter:
    """Convenience class for writing packages to paths or streams."""

    @staticmethod
    def write_to_stream(package: ValidatedPackage, stream: BinaryIO) -> None:
        write_package_to_stream(package, stream)

    @staticmethod
    def write(package: ValidatedPackage, target: Path) -> None:
        write_package(package, target)
