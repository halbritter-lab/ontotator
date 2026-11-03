"""Resources: project settings, the current guideline, an export's README."""

from __future__ import annotations

import json
import tempfile
import zipfile
from pathlib import Path

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ResourceError

from ontotator_mcp.client import OntotatorClient, project_path, seg
from ontotator_mcp.errors import OntotatorError
from ontotator_mcp.tools_results import export_target

README_NAME = "README.txt"
MAX_README = 1024 * 1024


def register_resources(server: MCPServer, api: OntotatorClient) -> None:
    @server.resource(
        "ontotator://projects/{project}/settings",
        name="project-settings",
        mime_type="application/json",
    )
    async def project_settings(project: str) -> str:
        """A project's settings, task profile and pins (token scope 'read')."""
        try:
            settings = await api.get(project_path(project, "settings"))
        except OntotatorError as exc:
            raise ResourceError(str(exc)) from None
        return json.dumps(settings, ensure_ascii=False, indent=2)

    @server.resource(
        "ontotator://projects/{project}/guideline",
        name="project-guideline",
        mime_type="text/markdown",
    )
    async def project_guideline(project: str) -> str:
        """The text of the project's current annotation guideline (token scope 'read')."""
        try:
            listing = await api.get(project_path(project, "guidelines"))
            current = listing.get("current")
            if not current:
                raise ResourceError(f"Project {project} has no guideline yet.")
            document = await api.get(
                project_path(project, "guidelines", seg(current["version"]))
            )
        except OntotatorError as exc:
            raise ResourceError(str(exc)) from None
        body = document.get("body")
        if body is None:
            raise ResourceError("The guideline's text is not available.")
        return str(body)

    @server.resource(
        "ontotator://jobs/{job_id}/readme",
        name="export-readme",
        mime_type="text/plain",
    )
    async def export_readme(job_id: str) -> str:
        """The README.txt of a finished final export (token scope 'export').

        It explains every file and column of the archive.
        """
        try:
            job = await api.job(int(job_id))
            if export_target(job) != "final":
                raise ResourceError(
                    f"Job {job_id} is not a final export; only those have a README."
                )
            with tempfile.TemporaryDirectory(prefix="ontotator-mcp-") as folder:
                archive = Path(folder) / "export.zip"
                await api.download(
                    f"/api/v1/jobs/{seg(int(job_id))}/download",
                    archive,
                    overwrite=False,
                )
                with zipfile.ZipFile(archive) as bundle:
                    info = bundle.getinfo(README_NAME)
                    if info.file_size > MAX_README:
                        raise ResourceError("The README is unexpectedly large.")
                    return bundle.read(info).decode("utf-8")
        except (OntotatorError, ValueError, KeyError, zipfile.BadZipFile) as exc:
            raise ResourceError(f"No README for job {job_id}: {exc}") from None
