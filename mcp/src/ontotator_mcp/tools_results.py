"""Result tools: consolidation, accepting agreeing texts, exports and downloads."""

from __future__ import annotations

import uuid
from typing import Annotated, Any, Literal

from mcp.server.mcpserver import MCPServer
from pydantic import Field

from ontotator_mcp.client import OntotatorClient, project_path, seg
from ontotator_mcp.errors import OntotatorError
from ontotator_mcp.tooling import register
from ontotator_mcp.tools_status import rows

Project = Annotated[str, Field(description="Project key, e.g. 'ward-7'.")]
ExportKind = Literal[
    "final",
    "phenopackets",
    "annotations",
    "edit_log",
    "work_time",
    "translation_reviews",
]
# Job kinds whose file /api/v1/jobs/{id}/download delivers.
DOWNLOADABLE = {
    "final_t1_export": "final",
    "final_phenopacket_export": "phenopackets",
    "t1_export": "annotations",
    "edit_log_export": "edit_log",
    "work_time_export": "work_time",
    "translation_review_export": "translation_reviews",
}
MAX_LISTED = 50
# Project archives (system tokens only); their import needs a browser session.
ARCHIVES = "/api/v1/admin/project-archives"


def _listed(submissions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [s for s in submissions if s.get("is_latest_in_round") is not False]


def _panel_path(project: str, case_id: str, language: str) -> str:
    return project_path(
        project, "document-rows", seg(case_id), seg(language), "final-panel"
    )


def _annotations_open(row: dict[str, Any]) -> bool:
    """Other annotations of the text are still open (no one-click acceptance then)."""
    work = [item for item in row.get("work", []) if item.get("task") == "annotate"]
    return any(item.get("status") != "submitted" for item in work)


def agreeing_submission(
    row: dict[str, Any], panel: dict[str, Any]
) -> tuple[dict[str, Any] | None, str]:
    """The submission to accept for a fully agreeing text, or None and why not."""
    if row.get("final") is not None:
        return None, "has a final result"
    listed = _listed(panel.get("submissions", []))
    if len(listed) < 2:
        return None, "fewer than two submissions"
    if any(item.get("kind") == "consolidation" for item in listed):
        return None, "has a consolidation; accept it in the web interface"
    if _annotations_open(row):
        return None, "other annotations are still open"
    if not panel.get("all_match"):
        return None, "submissions differ; consolidate or choose in the web interface"
    chosen = next(
        (
            item
            for item in listed
            if item.get("submission_id") == panel.get("all_match_submission_id")
        ),
        None,
    )
    if chosen is None:
        return None, "no submission to accept"
    if not chosen.get("eligible", True):
        return None, "the token's owner may not accept this result (own work)"
    return chosen, "all findings match"


def export_target(job: dict[str, Any]) -> str:
    kind = DOWNLOADABLE.get(str(job.get("kind")))
    if kind is None:
        raise OntotatorError(
            f"Job {job.get('id')} is a '{job.get('kind')}' job, not an export."
        )
    if job.get("status") != "succeeded":
        error = f": {job['error']}" if job.get("error") else ""
        raise OntotatorError(
            f"Export job {job.get('id')} is '{job.get('status')}'{error}."
            " Wait for it with get_job."
        )
    return kind


def register_results(server: MCPServer, api: OntotatorClient) -> None:
    @register(server, scopes=("read", "project-admin"), effect="additive")
    async def start_consolidation(
        project: Project,
        case_id: str,
        language: str,
        reviewer: Annotated[
            str, Field(description="Login name of the consolidator (list_people).")
        ],
        source_submission_ids: Annotated[
            list[str] | None,
            Field(description="Submissions to merge; None: every eligible one."),
        ] = None,
        reason: str | None = None,
        confirm_language: bool = False,
    ) -> dict[str, Any]:
        """Start a consolidation of a text's submissions by a consolidator.

        Creates the consolidator's task; the consolidation itself is done in
        the web interface. A consolidator lacking the role gets it
        (``role_granted``).
        """
        panel = await api.get(_panel_path(project, case_id, language))
        eligible = [s for s in _listed(panel.get("submissions", [])) if s["eligible"]]
        if source_submission_ids is None:
            documents = {s["document_id"] for s in eligible}
            if len(documents) != 1 or len(eligible) < 2:
                raise OntotatorError(
                    f"{case_id} {language} has {len(eligible)} eligible"
                    f" submission(s) on {len(documents)} text version(s); name"
                    " source_submission_ids."
                )
            source_submission_ids = [s["submission_id"] for s in eligible]
        chosen = [s for s in eligible if s["submission_id"] in source_submission_ids]
        if len(chosen) != len(set(source_submission_ids)):
            raise OntotatorError(
                "Not every source submission is an eligible submission of this"
                " text: " + ", ".join(s["submission_id"] for s in eligible)
            )
        started: dict[str, Any] = await api.post(
            project_path(project, "consolidations"),
            {
                "document_id": chosen[0]["document_id"],
                "reviewer": reviewer,
                "source_submission_ids": source_submission_ids,
                "reason": reason,
                "confirm_language": confirm_language,
                "request_id": str(uuid.uuid4()),
            },
        )
        return started

    @register(server, scopes=("read", "project-admin"), effect="additive")
    async def accept_agreeing_texts(
        project: Project,
        case_ids: Annotated[
            list[str] | None, Field(description="Only these cases; None: all.")
        ] = None,
        confirm: Annotated[
            bool, Field(description="False: dry run. True: accept the listed texts.")
        ] = False,
    ) -> dict[str, Any]:
        """Accept the result of every text whose annotations agree in full.

        A text qualifies when it has no final result, all its annotations
        are submitted, there is no consolidation, and all findings match
        (also notes and modifier text spans; unresolved findings never
        count as agreed). The dry run lists what would be accepted and why
        the others are not; with confirm the agreeing submission becomes
        the final result of each.
        """
        found, _ = await rows(api, project, stage=["final"])
        if case_ids is not None:
            wanted = set(case_ids)
            found = [row for row in found if row.get("case_id") in wanted]
        accepted: list[dict[str, Any]] = []
        skipped: list[dict[str, Any]] = []
        for row in found:
            ref = {"case_id": row["case_id"], "language": row["language"]}
            panel = await api.get(_panel_path(project, row["case_id"], row["language"]))
            chosen, why = agreeing_submission(row, panel)
            if chosen is None:
                skipped.append(ref | {"reason": why})
                continue
            entry = ref | {
                "document_id": chosen["document_id"],
                "submission_id": chosen["submission_id"],
                "findings": chosen.get("finding_count"),
            }
            if confirm:
                try:
                    await api.put(
                        project_path(project, "final-selections"),
                        {
                            "document_id": chosen["document_id"],
                            "submission_id": chosen["submission_id"],
                            "expected_revision": 0,
                        },
                    )
                except OntotatorError as exc:
                    skipped.append(ref | {"reason": str(exc)})
                    continue
            accepted.append(entry)
        return {
            "applied": confirm,
            "accepted" if confirm else "would_accept": accepted,
            "skipped": skipped[:MAX_LISTED],
            "skipped_count": len(skipped),
        }

    @register(server, scopes="read", effect="read")
    async def final_export_check(project: Project) -> dict[str, Any]:
        """What a final export would contain now: accepted results, warnings, omissions.

        Warnings (for example an open problem report) and texts without a
        final result must be acknowledged by start_export.
        """
        state: dict[str, Any] = await api.get(
            project_path(project, "workflow-warnings")
        )
        return {
            "final_results": len(state.get("selections", [])),
            "warnings": state.get("warnings", [])[:MAX_LISTED],
            "warning_count": len(state.get("warnings", [])),
            "omissions": state.get("omissions", [])[:MAX_LISTED],
            "omission_count": len(state.get("omissions", [])),
            "not_in_plan": len(state.get("not_in_plan") or []),
        }

    @register(server, scopes="export", effect="additive")
    async def start_export(
        project: Project,
        kind: Annotated[
            ExportKind,
            Field(
                description=(
                    "'final': accepted final results with index.csv,"
                    " findings.csv, agreement.csv, agreement-summary.csv,"
                    " proposals.csv and a README (ZIP). 'phenopackets': the same accepted results"
                    " as one GA4GH Phenopacket per text, derived and lossy,"
                    " with a report of what was left out (ZIP)."
                    " 'annotations': every submission as an"
                    " Ontospan bundle (ZIP). 'edit_log': every edit (JSONL)."
                    " 'work_time': the recorded work intervals under"
                    " pseudonyms (JSONL)."
                    " 'translation_reviews': translation review records (JSONL)."
                )
            ),
        ],
        acknowledge_warnings: Annotated[
            bool, Field(description="Final export: accept the current warnings.")
        ] = False,
        accept_omissions: Annotated[
            bool,
            Field(description="Final export: leave out texts without a final result."),
        ] = False,
        request_id: Annotated[
            str | None,
            Field(
                min_length=1,
                max_length=128,
                description=(
                    "Final or Phenopackets export: a name for this request, e.g."
                    " 'nightly-2026-11-05'. Repeating the call with the same"
                    " request_id and an unchanged project returns the same job"
                    " instead of a second export. None: a new export each call."
                ),
            ),
        ] = None,
        wait: Annotated[
            bool, Field(description="Wait until the file is ready (polls the job).")
        ] = True,
    ) -> dict[str, Any]:
        """Start an export job of the project; download it with download_export.

        Stores a new export file on the server; changes no project data.
        Each call starts a new job, except a final or Phenopackets export
        repeated with the same request_id.
        A final export freezes the accepted results as they are now; the
        warnings and omissions final_export_check lists must be
        acknowledged.
        """
        final = kind in ("final", "phenopackets")
        if request_id is not None and not final:
            raise OntotatorError(
                "request_id applies to the final and Phenopackets exports only."
            )
        if final:
            state = await api.post(project_path(project, "exports/final/preflight"))
            warnings = state.get("warnings", [])
            omissions = state.get("omissions", [])
            if warnings and not acknowledge_warnings:
                raise OntotatorError(
                    f"The final export has {len(warnings)} warning(s); read them"
                    " with final_export_check and pass acknowledge_warnings."
                )
            if omissions and not accept_omissions:
                raise OntotatorError(
                    f"{len(omissions)} text(s) have no final result and would be"
                    " left out; pass accept_omissions, or accept results first."
                )
            created = await api.post(
                project_path(project, "exports/final"),
                {
                    "request_id": request_id or str(uuid.uuid4()),
                    "state_digest": state["state_digest"],
                    "acknowledged_warnings": [
                        {"id": w["id"], "cause_revision": w["cause_revision"]}
                        for w in warnings
                    ],
                    "accepted_omissions": [
                        {"case_id": o["case_id"], "language": o["language"]}
                        for o in omissions
                    ],
                    "format": "phenopacket" if kind == "phenopackets" else "t1",
                },
            )
        elif kind == "translation_reviews":
            created = await api.post(
                project_path(project, "exports/translation-reviews")
            )
        else:
            created = await api.post(
                project_path(project, "exports"),
                {
                    "kind": {"annotations": "t1", "work_time": "work_time"}.get(
                        kind, "edit_log"
                    )
                },
            )
        job_id = int(created["job_id"])
        if not wait:
            return {"job_id": job_id, "kind": kind, "status": "queued"}
        return await api.finished_job(job_id, f"The {kind} export")

    @register(server, any_of=("read", "import", "export"), effect="read")
    async def get_job(
        job_id: int,
        wait: Annotated[
            bool, Field(description="Poll until the job succeeded or failed.")
        ] = False,
        timeout_seconds: Annotated[float | None, Field(gt=0, le=3600)] = None,
    ) -> dict[str, Any]:
        """The state of an import or export job: queued, running, succeeded or failed."""
        if wait:
            return await api.wait_job(job_id, timeout_seconds)
        return await api.job(job_id)

    @register(server, scopes="export", effect="local")
    async def download_export(
        job_id: int,
        path: Annotated[
            str,
            Field(
                description=(
                    "Absolute local file to write (or starting with ~),"
                    " inside the folders of ONTOTATOR_MCP_FILES_DIR,"
                    " e.g. ~/ontotator/ward-7.zip."
                )
            ),
        ],
        overwrite: bool = False,
    ) -> dict[str, Any]:
        """Download the file of a finished export job to a local path.

        WRITES A FILE ON THE USER'S COMPUTER; ``path`` in the result is the
        absolute path written. Only inside the folders of
        ONTOTATOR_MCP_FILES_DIR; without that variable it refuses. The file is streamed to disk and checked
        against the SHA-256 the server recorded. An existing file is
        replaced only with overwrite, and only by a complete download that
        matches. Calling it again downloads the file again.
        """
        target = api.local_path(path)
        job = await api.job(job_id)
        kind = export_target(job)
        expected = (job.get("result") or {}).get("sha256")
        written, digest = await api.download(
            f"/api/v1/jobs/{seg(job_id)}/download",
            target,
            overwrite=overwrite,
            expected_sha256=expected if isinstance(expected, str) else None,
        )
        return {
            "path": str(target.resolve()),
            "bytes": written,
            "sha256": digest,
            "kind": kind,
        }

    @register(server, scopes="admin", effect="additive")
    async def export_project_archive(
        project: Project,
        include_ontology_files: Annotated[
            bool,
            Field(description="Add the ontology and translation files of the pins."),
        ] = True,
        wait: Annotated[
            bool, Field(description="Wait until the archive is ready (polls the job).")
        ] = True,
    ) -> dict[str, Any]:
        """Start the archive of one complete project; fetch it with download_project_archive.

        Needs a system token. The archive holds every table of the project,
        the people it names (with the e-mail addresses of those who worked
        in it) and its stored files, for an import on another server, which
        is done in the web interface. Stores a new file on the server, which
        deletes it after 24 hours; changes no project data. Each call starts
        a new job.
        """
        created = await api.post(
            f"{ARCHIVES}/export",
            {"project_key": project, "include_ontology_files": include_ontology_files},
        )
        job_id = int(created["job_id"])
        if not wait:
            return {"job_id": job_id, "status": "queued"}
        return await api.finished_job(
            job_id, "The project archive", base=f"{ARCHIVES}/jobs"
        )

    @register(server, scopes="admin", effect="local")
    async def download_project_archive(
        job_id: int,
        path: Annotated[
            str,
            Field(
                description=(
                    "Absolute local file to write (or starting with ~),"
                    " inside the folders of ONTOTATOR_MCP_FILES_DIR,"
                    " e.g. ~/ontotator/ward-7-archive.zip."
                )
            ),
        ],
        overwrite: bool = False,
    ) -> dict[str, Any]:
        """Download the ZIP of a finished project archive job to a local path.

        WRITES A FILE ON THE USER'S COMPUTER; ``path`` in the result is the
        absolute path written. Only inside the folders of
        ONTOTATOR_MCP_FILES_DIR; without that variable it refuses. The file
        is streamed to disk and checked against the SHA-256 the server
        recorded; an existing file is replaced only with overwrite. The
        archive contains personal data (e-mail addresses): keep it safe.
        """
        target = api.local_path(path)
        job = await api.job(job_id, f"{ARCHIVES}/jobs")
        if job.get("kind") != "project_archive_export":
            raise OntotatorError(f"Job {job_id} is not a project archive export.")
        if job.get("status") != "succeeded":
            error = f": {job['error']}" if job.get("error") else ""
            raise OntotatorError(
                f"Project archive job {job_id} is '{job.get('status')}'{error}."
            )
        result = job.get("result") or {}
        expected = result.get("sha256")
        written, digest = await api.download(
            f"{ARCHIVES}/jobs/{seg(job_id)}/download",
            target,
            overwrite=overwrite,
            expected_sha256=expected if isinstance(expected, str) else None,
        )
        return {
            "path": str(target.resolve()),
            "bytes": written,
            "sha256": digest,
            "project": result.get("project"),
        }
