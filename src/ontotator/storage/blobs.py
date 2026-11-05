"""Content-addressed files on the data volume (T2 D3)."""

from __future__ import annotations

import hashlib
import os
import re
import tempfile
from pathlib import Path

_SHA256 = re.compile(r"[0-9a-f]{64}")


class BlobStore:
    """``<root>/<first two hex digits>/<sha256>``; written atomically, never changed.

    A file is only deleted when nothing references it any more (``delete``).
    """

    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    def path(self, sha256: str) -> Path:
        if not _SHA256.fullmatch(sha256):
            raise ValueError(f"not a SHA-256 hex digest: {sha256!r}")
        return self.root / sha256[:2] / sha256

    def put(self, data: bytes) -> str:
        """Store ``data`` and return its SHA-256; storing it again changes nothing."""
        digest = hashlib.sha256(data).hexdigest()
        target = self.path(digest)
        if target.is_file():
            return digest
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=target.parent, prefix=".incoming-")
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            try:
                os.replace(tmp, target)
            except OSError:
                if not target.is_file():
                    raise
                Path(tmp).unlink(missing_ok=True)
                return digest
            if os.name != "nt":
                dir_fd = os.open(target.parent, os.O_RDONLY)
                try:
                    os.fsync(dir_fd)
                finally:
                    os.close(dir_fd)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
        return digest

    def put_file(self, source: Path, sha256: str) -> bool:
        """Store the file ``source`` under ``sha256`` without reading it into
        memory; whether it was written (False: stored already).

        Raises:
            ValueError: the file's SHA-256 is not ``sha256``.
        """
        target = self.path(sha256)
        if target.is_file():
            return False
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=target.parent, prefix=".incoming-")
        try:
            digest = hashlib.sha256()
            with os.fdopen(fd, "wb") as handle, source.open("rb") as reader:
                while chunk := reader.read(1024 * 1024):
                    digest.update(chunk)
                    handle.write(chunk)
                handle.flush()
                os.fsync(handle.fileno())
            if digest.hexdigest() != sha256:
                raise ValueError(f"{source} is not {sha256}")
            os.replace(tmp, target)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
        return True

    def delete(self, sha256: str) -> None:
        """Remove the stored file; the caller checked that nothing references it."""
        self.path(sha256).unlink(missing_ok=True)

    def get(self, sha256: str) -> bytes:
        """The stored bytes; ``ValueError`` if they no longer match their hash."""
        data = self.path(sha256).read_bytes()
        if hashlib.sha256(data).hexdigest() != sha256:
            raise ValueError(f"stored file {sha256} is corrupt")
        return data
