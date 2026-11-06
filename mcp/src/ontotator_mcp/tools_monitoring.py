"""Monitoring and QA tools: problem reports, guidelines, mode changes, one
text's history and translation reviews. All of them only read."""

from __future__ import annotations

from typing import Annotated, Any

from mcp.server.mcpserver import MCPServer
from pydantic import Field

from ontotator_mcp.client import OntotatorClient, project_path, seg
from ontotator_mcp.tooling import register

Project = Annotated[str, Field(description="Project key, e.g. 'ward-7'.")]
DocumentId = Annotated[
    str,
    Field(description="ID of one text version (document_id from list_texts)."),
]
# Tasks that work in rounds: their rounds name the inputs and submissions.
ROUND_TASKS = ("annotate", "review")


def register_monitoring(server: MCPServer, api: OntotatorClient) -> None:
    @register(server, scopes="read", effect="read")
    async def get_problem_report(
        report_id: Annotated[
            str, Field(min_length=1, description="report_id from list_problem_reports.")
        ],
    ) -> dict[str, Any]:
        """One problem report with its events, holds and resolution.

        The route is not part of a project's path: until project tokens
        reach it, it needs a personal token.
        """
        report: dict[str, Any] = await api.get(
            f"/api/v1/problem-reports/{seg(report_id)}"
        )
        return report

    @register(server, scopes="read", effect="read")
    async def list_guidelines(project: Project) -> dict[str, Any]:
        """The project's guideline versions and who has read them.

        For leads each version names how many members were notified of it
        and opened it ('reach') and who has not seen it yet ('not_seen');
        the text of a version is the resource ontotator://projects/{project}/guideline.
        """
        listing: dict[str, Any] = await api.get(project_path(project, "guidelines"))
        return listing

    @register(server, scopes="read", effect="read")
    async def list_mode_changes(
        project: Project,
        case_id: Annotated[str | None, Field(description="Only this case.")] = None,
        language: Annotated[
            str | None, Field(description="Only this language.")
        ] = None,
    ) -> dict[str, Any]:
        """Changes of a text's annotation mode, newest first.

        Each names the old and new mode, the reason, who changed it, the
        work it discarded and whether it can be restored. Without filters
        the whole project's changes.
        """
        changes: dict[str, Any] = await api.get(
            project_path(project, "annotation-mode-changes"),
            case_id=case_id,
            language=language,
        )
        return changes

    @register(server, scopes="read", effect="read")
    async def get_text_detail(
        project: Project, document_id: DocumentId
    ) -> dict[str, Any]:
        """One text version's history: tasks, rounds, submissions and translation reviews.

        Names who worked on the text in which task and state, every round
        of annotation and consolidation with its inputs and submissions,
        every submitted result and every translation review. Findings are
        not part of it. The rounds come from a route outside the project's
        path: until project tokens reach it, it needs a personal token.
        """
        doc = seg(document_id)
        assignments: list[dict[str, Any]] = await api.get(
            project_path(project, "assignments"),
            document_id=document_id,
            include_revoked=True,
        )
        rounds: list[dict[str, Any]] = []
        for item in assignments:
            if item.get("task") in ROUND_TASKS:
                rounds.extend(
                    await api.get(f"/api/v1/assignments/{seg(item['id'])}/rounds")
                )
        submissions = await api.get(
            project_path(project, "documents", doc, "submissions")
        )
        reviews = await api.get(
            project_path(project, "documents", doc, "translation-reviews")
        )
        return {
            "document_id": document_id,
            "assignments": [
                {
                    name: item.get(name)
                    for name in (
                        "id",
                        "username",
                        "pseudonym",
                        "task",
                        "status",
                        "annotation_mode",
                        "created_at",
                        "updated_at",
                        "revoked_at",
                        "last_submission_id",
                        "held",
                        "hold_reason",
                    )
                }
                for item in assignments
            ],
            "rounds": rounds,
            "submissions": submissions,
            "translation_reviews": reviews,
        }

    @register(server, scopes="read", effect="read")
    async def list_translation_reviews(
        project: Project,
        document_id: Annotated[
            str | None, Field(description="Only reviews of this text version.")
        ] = None,
    ) -> list[dict[str, Any]]:
        """Submitted translation reviews: decision, clinical change, categories, reviewer.

        Oldest first. A lead sees every review; anyone else their own.
        """
        path = (
            project_path(project, "translation-reviews")
            if document_id is None
            else project_path(
                project, "documents", seg(document_id), "translation-reviews"
            )
        )
        reviews: list[dict[str, Any]] = await api.get(path)
        return reviews
