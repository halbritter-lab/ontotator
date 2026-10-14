"""Files on the data volume, addressed by their SHA-256."""

import hashlib
from pathlib import Path

import pytest

from ontocurator.storage.blobs import BlobStore


def test_a_file_is_stored_under_its_hash_and_read_back(tmp_path: Path) -> None:
    store = BlobStore(tmp_path)
    digest = store.put(b"hello")

    assert digest == hashlib.sha256(b"hello").hexdigest()
    assert store.path(digest) == tmp_path / digest[:2] / digest
    assert store.get(digest) == b"hello"


def test_storing_the_same_content_twice_is_harmless(tmp_path: Path) -> None:
    store = BlobStore(tmp_path)

    assert store.put(b"x") == store.put(b"x")
    assert [p.name for p in tmp_path.rglob("*") if p.is_file()] == [
        hashlib.sha256(b"x").hexdigest()
    ]


def test_a_changed_file_is_reported_as_corrupt(tmp_path: Path) -> None:
    store = BlobStore(tmp_path)
    digest = store.put(b"original")
    store.path(digest).write_bytes(b"tampered")

    with pytest.raises(ValueError, match="corrupt"):
        store.get(digest)


@pytest.mark.parametrize("bad", ["", "../etc/passwd", "A" * 64, "0" * 63])
def test_only_hex_digests_address_files(tmp_path: Path, bad: str) -> None:
    with pytest.raises(ValueError, match="not a SHA-256"):
        BlobStore(tmp_path).path(bad)
