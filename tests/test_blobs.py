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


def test_a_lost_replace_race_keeps_the_existing_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import os

    store = BlobStore(tmp_path)
    digest = hashlib.sha256(b"raced").hexdigest()

    def losing_replace(src: str | Path, dst: str | Path) -> None:
        Path(dst).write_bytes(b"raced")  # the competing writer wins
        raise PermissionError("target is in use")

    monkeypatch.setattr(os, "replace", losing_replace)
    assert store.put(b"raced") == digest
    assert store.get(digest) == b"raced"
    assert [p.name for p in store.path(digest).parent.iterdir()] == [digest]


def test_a_failing_replace_without_a_target_is_raised(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import os

    def failing_replace(src: str | Path, dst: str | Path) -> None:
        raise PermissionError("denied")

    monkeypatch.setattr(os, "replace", failing_replace)
    with pytest.raises(PermissionError):
        BlobStore(tmp_path).put(b"x")
