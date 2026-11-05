"""A small async client for the Ontotator HTTP API, authenticated by an API token."""

from __future__ import annotations

import contextlib
import hashlib
import os
import tempfile
import time
from collections.abc import Iterator, Mapping, Sequence
from contextlib import ExitStack
from pathlib import Path
from typing import IO, Any
from urllib.parse import quote

import anyio
import httpx

from ontotator_mcp import __version__
from ontotator_mcp.config import Settings
from ontotator_mcp.errors import OntotatorError, api_error, redact, transport_error

JOB_DONE = ("succeeded", "failed")
CHUNK = 1024 * 1024


def seg(value: str | int) -> str:
    """One path segment, percent-encoded (case IDs may hold slashes)."""
    return quote(str(value), safe="")


def project_path(project: str, *rest: str) -> str:
    """``/api/v1/projects/{project}/...``; ``rest`` is appended as given."""
    tail = "/".join(part.strip("/") for part in rest if part)
    base = f"/api/v1/projects/{seg(project)}"
    return f"{base}/{tail}" if tail else base


def local_path(path: str, folders: Sequence[Path] = ()) -> Path:
    """The absolute path the caller named, symlinks resolved, inside ``folders``.

    ``~`` is expanded; a relative path is refused, because the MCP server's
    working folder is not one the user chose. With ``folders`` (from
    ``ONTOTATOR_MCP_FILES_DIR``) the resolved path must lie in one of them.
    """
    given = Path(path).expanduser()
    if not given.is_absolute():
        raise OntotatorError(
            f"Give an absolute path, or one starting with ~, not {path!r}."
        )
    resolved = given.resolve()
    if folders and not any(resolved.is_relative_to(folder) for folder in folders):
        allowed = ", ".join(str(folder) for folder in folders)
        raise OntotatorError(
            f"{resolved} is outside the folders this MCP server may use"
            f" (ONTOTATOR_MCP_FILES_DIR: {allowed})."
        )
    return resolved


def local_file(path: str, folders: Sequence[Path] = ()) -> Path:
    """An existing regular file the caller named; see ``local_path``."""
    resolved = local_path(path, folders)
    if not resolved.is_file():
        raise OntotatorError(f"No such file: {resolved}")
    return resolved


@contextlib.contextmanager
def open_files(
    field: str, files: Sequence[Path]
) -> Iterator[list[tuple[str, tuple[str, IO[bytes], str]]]]:
    """Multipart parts for ``files``; they stream, they are not read whole."""
    if not files:
        raise OntotatorError("Name at least one file.")
    with ExitStack() as stack:
        parts: list[tuple[str, tuple[str, IO[bytes], str]]] = []
        for file in files:
            handle = stack.enter_context(file.open("rb"))
            parts.append((field, (file.name, handle, "application/octet-stream")))
        yield parts


class OntotatorClient:
    """Calls one Ontotator instance with ``Authorization: Bearer <token>``."""

    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.settings = settings
        self._http = httpx.AsyncClient(
            base_url=settings.url,
            headers={
                "Authorization": f"Bearer {settings.token}",
                "User-Agent": f"ontotator-mcp/{__version__}",
                "Accept": "application/json",
            },
            timeout=httpx.Timeout(settings.timeout, connect=min(settings.timeout, 15)),
            transport=transport,
            follow_redirects=False,
            # Never pick up a token or cookies from the environment or netrc.
            trust_env=False,
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    def _unreachable(self, exc: httpx.HTTPError) -> OntotatorError:
        return transport_error(self.settings.url, exc, self.settings.token)

    async def _send(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        params: Mapping[str, Any] | None = None,
        files: Any = None,
        data: Mapping[str, Any] | None = None,
    ) -> httpx.Response:
        try:
            response = await self._http.request(
                method,
                path,
                json=json,
                params=_params(params),
                files=files,
                data=data,
            )
        except httpx.HTTPError as exc:
            raise self._unreachable(exc) from None
        if response.is_redirect:
            location = redact(
                response.headers.get("location", "?"), self.settings.token
            )
            raise OntotatorError(
                f"Ontotator answered {method} {path} with a redirect to"
                f" {location}. Set ONTOTATOR_URL to the final address; the token"
                " is not sent on redirects."
            )
        if response.is_error:
            raise api_error(response)
        return response

    async def request(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        params: Mapping[str, Any] | None = None,
        files: Any = None,
        data: Mapping[str, Any] | None = None,
    ) -> Any:
        """The JSON body of a successful call (None for an empty body)."""
        response = await self._send(
            method, path, json=json, params=params, files=files, data=data
        )
        if not response.content:
            return None
        try:
            return response.json()
        except ValueError:
            raise OntotatorError(
                f"Ontotator answered {method} {path} with something other than"
                " JSON. Check that ONTOTATOR_URL points at the Ontotator server."
            ) from None

    async def get(self, path: str, **params: Any) -> Any:
        return await self.request("GET", path, params=params)

    async def post(self, path: str, body: Any = None) -> Any:
        return await self.request("POST", path, json=body)

    async def put(self, path: str, body: Any) -> Any:
        return await self.request("PUT", path, json=body)

    async def patch(self, path: str, body: Any) -> Any:
        return await self.request("PATCH", path, json=body)

    def local_path(self, path: str) -> Path:
        """``path`` resolved and checked against ONTOTATOR_MCP_FILES_DIR."""
        return local_path(path, self.settings.files_dirs)

    def local_files(self, paths: Sequence[str]) -> list[Path]:
        """The existing files ``paths`` names, resolved and checked."""
        return [local_file(path, self.settings.files_dirs) for path in paths]

    async def upload(
        self,
        path: str,
        field: str,
        files: Sequence[Path],
        data: Mapping[str, Any] | None = None,
    ) -> Any:
        """POST ``files`` (from ``local_files``) as multipart ``field``, streamed."""
        with open_files(field, files) as parts:
            return await self.request("POST", path, files=parts, data=data)

    async def job(self, job_id: int) -> dict[str, Any]:
        job: dict[str, Any] = await self.get(f"/api/v1/jobs/{seg(job_id)}")
        return job

    async def wait_job(
        self, job_id: int, timeout: float | None = None
    ) -> dict[str, Any]:
        """The job once it succeeded or failed, polling; or as it is at the timeout."""
        deadline = time.monotonic() + (timeout or self.settings.job_timeout)
        interval = self.settings.poll_interval
        while True:
            job = await self.job(job_id)
            if job.get("status") in JOB_DONE or time.monotonic() >= deadline:
                return job
            await anyio.sleep(interval)
            interval = min(interval * 1.5, 10.0)

    async def finished_job(self, job_id: int, what: str) -> dict[str, Any]:
        """The job once it succeeded; an error if it failed or is still running."""
        job = await self.wait_job(job_id)
        if job.get("status") == "failed":
            raise OntotatorError(f"{what} (job {job_id}) failed: {job.get('error')}")
        if job.get("status") != "succeeded":
            raise OntotatorError(
                f"{what} (job {job_id}) is still '{job.get('status')}'. Poll it"
                " with get_job."
            )
        return job

    async def download(
        self, path: str, target: Path, *, overwrite: bool
    ) -> tuple[int, str]:
        """Stream ``path`` into ``target``; the bytes written and their SHA-256.

        The file appears only when complete (written next to it, then
        renamed), and an existing file is replaced only with ``overwrite``.
        """
        if target.exists() and not overwrite:
            raise OntotatorError(
                f"{target} exists already. Choose another path or pass overwrite."
            )
        if target.is_dir():
            raise OntotatorError(f"{target} is a directory; name a file.")
        if not target.parent.is_dir():
            raise OntotatorError(f"The folder {target.parent} does not exist.")
        handle, partial = tempfile.mkstemp(
            prefix=f".{target.name}.", suffix=".part", dir=target.parent
        )
        written = 0
        digest = hashlib.sha256()
        try:
            with os.fdopen(handle, "wb") as out:
                try:
                    async with self._http.stream("GET", path) as response:
                        if response.is_error:
                            await response.aread()
                            raise api_error(response)
                        async for chunk in response.aiter_bytes(CHUNK):
                            out.write(chunk)
                            digest.update(chunk)
                            written += len(chunk)
                except httpx.HTTPError as exc:
                    raise self._unreachable(exc) from None
            os.replace(partial, target)
        except BaseException:
            with contextlib.suppress(OSError):
                os.unlink(partial)
            raise
        return written, digest.hexdigest()


def _params(params: Mapping[str, Any] | None) -> list[tuple[str, Any]] | None:
    """Query parameters without the unset ones; lists repeat the name."""
    if not params:
        return None
    pairs: list[tuple[str, Any]] = []
    for name, value in params.items():
        if value is None:
            continue
        if isinstance(value, list | tuple):
            pairs.extend((name, item) for item in value)
        elif isinstance(value, bool):
            pairs.append((name, "true" if value else "false"))
        else:
            pairs.append((name, value))
    return pairs
