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
from ontotator_mcp.config import FILES_DIR_VARIABLE, Settings
from ontotator_mcp.errors import OntotatorError, api_error, redact, transport_error

JOB_DONE = ("succeeded", "failed")
JOBS = "/api/v1/jobs"
CHUNK = 1024 * 1024
# A server that refuses an upload as too large (413) may close the connection
# while the body is still being sent; the client then sees one of these.
UPLOAD_CUT = (httpx.ReadError, httpx.WriteError, httpx.RemoteProtocolError)


def _megabytes(size: int) -> str:
    return f"{size / 1_000_000:.1f} MB"


def seg(value: str | int) -> str:
    """One path segment, percent-encoded (case IDs may hold slashes).

    ``.`` and ``..`` are encoded too: httpx removes dot segments, so a
    project key or user name of ``..`` would otherwise send the request to
    another route than the tool names.
    """
    encoded = quote(str(value), safe="")
    if encoded in (".", ".."):
        return encoded.replace(".", "%2E")
    return encoded


def project_path(project: str, *rest: str) -> str:
    """``/api/v1/projects/{project}/...``; ``rest`` is appended as given."""
    tail = "/".join(part.strip("/") for part in rest if part)
    base = f"/api/v1/projects/{seg(project)}"
    return f"{base}/{tail}" if tail else base


def local_path(path: str, folders: Sequence[Path]) -> Path:
    """The absolute path the caller named, symlinks resolved, inside ``folders``.

    ``folders`` come from ``ONTOTATOR_MCP_FILES_DIR``; without any, no local
    file may be read or written. ``~`` is expanded; a relative path is
    refused, because the MCP server's working folder is not one the user
    chose. The resolved path must lie in one of ``folders``.
    """
    if not folders:
        raise OntotatorError(
            f"This tool reads or writes local files, which is off: set"
            f" {FILES_DIR_VARIABLE} to the folders it may use (absolute paths or"
            f" starting with ~, separated by {os.pathsep!r}), for example"
            f" {FILES_DIR_VARIABLE}=~/ontotator, in the MCP client's settings"
            " for this server, and restart the server."
        )
    given = Path(path).expanduser()
    if not given.is_absolute():
        raise OntotatorError(
            f"Give an absolute path, or one starting with ~, not {path!r}."
        )
    resolved = given.resolve()
    if not any(resolved.is_relative_to(folder) for folder in folders):
        allowed = ", ".join(str(folder) for folder in folders)
        raise OntotatorError(
            f"{resolved} is outside the folders this MCP server may use"
            f" ({FILES_DIR_VARIABLE}: {allowed})."
        )
    return resolved


def local_file(path: str, folders: Sequence[Path]) -> Path:
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
        upload_bytes: int | None = None,
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
        except UPLOAD_CUT as exc:
            if upload_bytes is None:
                raise self._unreachable(exc) from None
            raise OntotatorError(
                f"Ontotator closed the connection during the upload to {path}"
                f" ({type(exc).__name__}). The file(s), {_megabytes(upload_bytes)}"
                " in all, may exceed the server's upload limit; ask its"
                " administrator, or upload fewer or smaller files."
            ) from None
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
        upload_bytes: int | None = None,
    ) -> Any:
        """The JSON body of a successful call (None for an empty body)."""
        response = await self._send(
            method,
            path,
            json=json,
            params=params,
            files=files,
            data=data,
            upload_bytes=upload_bytes,
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
        size = sum(file.stat().st_size for file in files)
        with open_files(field, files) as parts:
            return await self.request(
                "POST", path, files=parts, data=data, upload_bytes=size
            )

    async def job(self, job_id: int, base: str = JOBS) -> dict[str, Any]:
        """A job's state from ``base``/{id} (project archives have their own)."""
        job: dict[str, Any] = await self.get(f"{base}/{seg(job_id)}")
        return job

    async def wait_job(
        self, job_id: int, timeout: float | None = None, base: str = JOBS
    ) -> dict[str, Any]:
        """The job once it succeeded or failed, polling; or as it is at the timeout."""
        deadline = time.monotonic() + (timeout or self.settings.job_timeout)
        interval = self.settings.poll_interval
        while True:
            job = await self.job(job_id, base)
            if job.get("status") in JOB_DONE or time.monotonic() >= deadline:
                return job
            await anyio.sleep(interval)
            interval = min(interval * 1.5, 10.0)

    async def finished_job(
        self, job_id: int, what: str, base: str = JOBS
    ) -> dict[str, Any]:
        """The job once it succeeded; an error if it failed or is still running."""
        job = await self.wait_job(job_id, base=base)
        if job.get("status") == "failed":
            raise OntotatorError(f"{what} (job {job_id}) failed: {job.get('error')}")
        if job.get("status") != "succeeded":
            raise OntotatorError(
                f"{what} (job {job_id}) is still '{job.get('status')}'. Poll it"
                " with get_job."
            )
        return job

    async def download(
        self,
        path: str,
        target: Path,
        *,
        overwrite: bool,
        expected_sha256: str | None = None,
    ) -> tuple[int, str]:
        """Stream ``path`` into ``target``; the bytes written and their SHA-256.

        The file appears only when complete and, given ``expected_sha256``,
        only when it matches: it is written next to the target and renamed.
        An existing file is replaced only with ``overwrite``, and never by a
        download that failed or does not match.
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
                        if response.is_redirect:
                            raise OntotatorError(
                                f"Ontotator answered GET {path} with a redirect."
                                " Set ONTOTATOR_URL to the final address."
                            )
                        async for chunk in response.aiter_bytes(CHUNK):
                            out.write(chunk)
                            digest.update(chunk)
                            written += len(chunk)
                except httpx.HTTPError as exc:
                    raise self._unreachable(exc) from None
            if expected_sha256 is not None and digest.hexdigest() != expected_sha256:
                raise OntotatorError(
                    f"The download of {path} does not match the SHA-256 the server"
                    f" recorded and was discarded; {target} was not written."
                    " Try again."
                )
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
