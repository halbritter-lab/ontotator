"""Copy public smoke fixtures through the writable container filesystem."""

import hashlib
import importlib.util
import subprocess
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "seed_stack", Path(__file__).resolve().parents[1] / "scripts/seed_stack.py"
)
assert spec is not None and spec.loader is not None
seed_stack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed_stack)


def test_fixture_copy_preserves_binary_bytes_and_paths_with_spaces(tmp_path):
    source = tmp_path / "source fixture.zip"
    target = tmp_path / "copied fixture.zip"
    # Larger than process argv limits; includes every byte and CR/LF values.
    payload = bytes(range(256)) * 12288
    source.write_bytes(payload)

    class LocalPython:
        def compose(self, *args, stdin):
            return subprocess.run(
                [sys.executable, *args[4:]],
                capture_output=True,
                text=True,
                check=True,
                stdin=stdin,
            )

    seed_stack.copy_fixture(LocalPython(), source, str(target))

    assert (
        hashlib.sha256(target.read_bytes()).digest() == hashlib.sha256(payload).digest()
    )
