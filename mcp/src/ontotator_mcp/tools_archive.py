"""Project archive tools (Ontotator #306): move one project between servers.

System administration: every tool needs a system token with the ``admin``
scope. The archive jobs are read on their own admin route, not ``get_job``.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Annotated, Any

import anyio
from mcp.server.mcpserver import MCPServer
from pydantic import Field

from ontotator_mcp.client import JOB_DONE, OntotatorClient, seg
from ontotator_mcp.errors import OntotatorError
from ontotator_mcp.tooling import register

BASE = "/api/v1/admin/project-archives"
Project = Annotated[str, Field(description="Project key, e.g. 'ward-7'.")]
Wait = Annotated[
    bool, Field(description="Wait until the job finished (polls the job).")
]


async def _archive_job(api: OntotatorClient, job_id: int, what: str) -> dict[str, Any]:
    """The archive job once it succeeded; an error if it failed or still runs."""
    deadline = time.monotonic() + api.settings.job_timeout
    interval = api.settings.poll_interval
    while True:
        job: dict[str, Any] = await api.get(f"{BASE}/jobs/{seg(job_id)}")
        if job.get("status") in JOB_DONE or time.monotonic() >= deadline:
            break
        await anyio.sleep(interval)
        interval = min(interval * 1.5, 10.0)
    if job.get("status") == "failed":
        raise OntotatorError(f"{what} (job {job_id}) failed: {job.get('error')}")
    if job.get("status") != "succeeded":
        raise OntotatorError(
            f"{what} (job {job_id}) is still '{job.get('status')}'."
            " Call the tool again with wait later."
        )
    return job


def register_archive(server: MCPServer, api: OntotatorClient) -> None:
    @register(server, scopes="admin", effect="additive", idempotent=True)
    async def export_project_archive(
        project: Project,
        include_ontology_files: Annotated[
            bool,
            Field(
                description=(
                    "Add the ontology and translation files of the pins; without"
                    " them the target server must have the same files."
                )
            ),
        ] = True,
        wait: Wait = True,
    ) -> dict[str, Any]:
        """Write one complete project as a project archive for another server.

        The archive (ZIP) holds every record of the project, the people it
        names with their e-mail addresses and its stored files: keep it
        private. Download it with download_project_archive.
        """
        created = await api.post(
            f"{BASE}/export",
            {"project_key": project, "include_ontology_files": include_ontology_files},
        )
        job_id = int(created["job_id"])
        if not wait:
            return {"job_id": job_id, "status": "queued"}
        return await _archive_job(api, job_id, "The project archive export")

    @register(server, scopes="admin", effect="local", idempotent=True)
    async def download_project_archive(
        job_id: int,
        path: Annotated[
            str,
            Field(description="Local file to write, e.g. ~/archives/ward-7.zip."),
        ],
        overwrite: bool = False,
    ) -> dict[str, Any]:
        """Download the archive of a finished project archive export to a local path.

        The file is streamed to disk and checked against the SHA-256 the
        server recorded. An existing file is replaced only with overwrite.
        """
        job: dict[str, Any] = await api.get(f"{BASE}/jobs/{seg(job_id)}")
        if (
            job.get("kind") != "project_archive_export"
            or job.get("status") != "succeeded"
        ):
            raise OntotatorError(
                f"Job {job_id} is not a finished project archive export."
            )
        target = Path(path).expanduser()
        written, digest = await api.download(
            f"{BASE}/jobs/{seg(job_id)}/download", target, overwrite=overwrite
        )
        expected = (job.get("result") or {}).get("sha256")
        if isinstance(expected, str) and expected != digest:
            target.unlink(missing_ok=True)
            raise OntotatorError(
                f"The download of job {job_id} does not match the recorded"
                " SHA-256 and was removed. Try again."
            )
        return {"path": str(target.resolve()), "bytes": written, "sha256": digest}

    @register(server, scopes="admin", effect="additive")
    async def import_project_archive(
        path: Annotated[str, Field(description="Local project archive (ZIP).")],
        rename_pseudonyms: Annotated[
            bool,
            Field(
                description=(
                    "Give people whose pseudonym is taken on this server a new"
                    " one; otherwise such an archive is refused."
                )
            ),
        ] = False,
        wait: Wait = True,
    ) -> dict[str, Any]:
        """Import a project archive as a new project and verify it.

        A taken project key gets a suffix such as '-2'. People are matched
        by e-mail address; the others become pseudonym-only people without
        login. A changed, incomplete or newer archive is refused, and
        nothing is imported then.
        """
        created = await api.upload(
            f"{BASE}/import",
            "file",
            [path],
            data={"rename_pseudonyms": "true" if rename_pseudonyms else "false"},
        )
        job_id = int(created["job_id"])
        if not wait:
            return {"job_id": job_id, "status": "queued"}
        return await _archive_job(api, job_id, "The project archive import")
