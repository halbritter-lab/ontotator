"""Single-instance guard for a workspace.

One server per workspace: the first process takes an OS-level exclusive lock on
``<workspace>/.ontocurator.lock`` (released automatically by the OS if the
process dies) and records how to reach it in ``<workspace>/.ontocurator-instance.json``
(pid, host, port and the per-launch session token; owner-only permissions,
rewritten on every start, removed on clean shutdown).

A second launch that cannot take the lock reads the instance file, verifies the
running server answers an authenticated request, and then just hands over
(opens the browser / forwards a dropped file) instead of starting a second
server on the same SQLite database.
"""

from __future__ import annotations

import contextlib
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import IO, Any

LOCK_FILENAME = ".ontocurator.lock"
INFO_FILENAME = ".ontocurator-instance.json"
LEGACY_TOKEN_FILENAME = ".session_token"


@dataclass(frozen=True)
class InstanceInfo:
    pid: int
    host: str
    port: int
    token: str

    @property
    def base_url(self) -> str:
        host = f"[{self.host}]" if ":" in self.host else self.host
        return f"http://{host}:{self.port}"


class WorkspaceLock:
    """Non-blocking exclusive OS lock held for the lifetime of the server."""

    def __init__(self, workspace: Path) -> None:
        self.path = workspace / LOCK_FILENAME
        self._fh: IO[bytes] | None = None

    def acquire(self) -> bool:
        fh = open(self.path, "a+b")  # noqa: SIM115 - held open while locked
        try:
            if sys.platform == "win32":
                import msvcrt

                fh.seek(0)
                msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            fh.close()
            return False
        self._fh = fh
        return True

    def release(self) -> None:
        fh, self._fh = self._fh, None
        if fh is None:
            return
        with contextlib.suppress(OSError):
            if sys.platform == "win32":
                import msvcrt

                fh.seek(0)
                msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
        fh.close()

    @property
    def held(self) -> bool:
        return self._fh is not None


def _write_private(path: Path, text: str) -> None:
    """Write a file readable only by the current user (best effort on Windows)."""
    tmp = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0)
    fd = os.open(tmp, flags, 0o600)
    try:
        os.write(fd, text.encode("utf-8"))
    finally:
        os.close(fd)
    with contextlib.suppress(OSError):
        os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def write_instance_info(workspace: Path, info: InstanceInfo) -> None:
    _write_private(workspace / INFO_FILENAME, json.dumps(asdict(info)))
    # Tokens used to be persisted forever in plain text; drop that file.
    with contextlib.suppress(OSError):
        (workspace / LEGACY_TOKEN_FILENAME).unlink()


def read_instance_info(workspace: Path) -> InstanceInfo | None:
    try:
        data = json.loads((workspace / INFO_FILENAME).read_text(encoding="utf-8"))
        return InstanceInfo(
            pid=int(data["pid"]),
            host=str(data["host"]),
            port=int(data["port"]),
            token=str(data["token"]),
        )
    except (OSError, ValueError, KeyError, TypeError):
        return None


def remove_instance_info(workspace: Path) -> None:
    with contextlib.suppress(OSError):
        (workspace / INFO_FILENAME).unlink()


def _request(
    info: InstanceInfo,
    method: str,
    path: str,
    *,
    body: bytes | None = None,
    content_type: str | None = None,
    timeout: float = 2.0,
) -> tuple[int, bytes]:
    headers = {"Authorization": f"Bearer {info.token}"}
    if content_type:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(
        info.base_url + path, data=body, headers=headers, method=method
    )
    # Never route loopback traffic through a configured HTTP proxy.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(req, timeout=timeout) as resp:
            return int(resp.status), resp.read()
    except urllib.error.HTTPError as exc:
        return int(exc.code), exc.read()


def is_instance_alive(info: InstanceInfo, timeout: float = 2.0) -> bool:
    """True if a server answers an authenticated API request with our token."""
    try:
        status, _ = _request(info, "GET", "/api/v1/ontologies", timeout=timeout)
    except OSError:
        return False
    return status == 200


def wait_for_running_instance(
    workspace: Path, timeout: float = 20.0, interval: float = 0.25
) -> InstanceInfo | None:
    """Wait for the lock owner to publish a reachable instance (it may be starting)."""
    deadline = time.monotonic() + timeout
    while True:
        info = read_instance_info(workspace)
        if info is not None and is_instance_alive(info):
            return info
        if time.monotonic() >= deadline:
            return None
        time.sleep(interval)


def upload_file(info: InstanceInfo, api_path: str, file_path: Path) -> dict[str, Any]:
    """POST ``file_path`` as multipart ``file`` to a running instance."""
    boundary = uuid.uuid4().hex
    header = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{file_path.name}"\r\n'
        "Content-Type: application/octet-stream\r\n\r\n"
    ).encode()
    body = header + file_path.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    status, payload = _request(
        info,
        "POST",
        api_path,
        body=body,
        content_type=f"multipart/form-data; boundary={boundary}",
        timeout=120.0,
    )
    if status != 200:
        raise RuntimeError(f"HTTP {status}: {payload.decode('utf-8', 'replace')[:300]}")
    result = json.loads(payload or b"{}")
    return result if isinstance(result, dict) else {}
