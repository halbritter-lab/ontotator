"""Status tools: overview, progress per text and person, agreement per text."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from mcp.server.mcpserver import MCPServer
from pydantic import Field

from ontotator_mcp.client import OntotatorClient, project_path, seg
from ontotator_mcp.tooling import register

Project = Annotated[str, Field(description="Project key, e.g. 'ward-7'.")]
Stage = Literal["translation_review", "annotation", "final", "done"]
MAX_AGREEMENT_TEXTS = 200


def _newest(row: dict[str, Any]) -> dict[str, Any] | None:
    versions = [v for v in row.get("versions", []) if not v.get("discarded")]
    newest = [v for v in versions if v.get("is_newest_in_chain")]
    chosen = newest or versions
    return chosen[-1] if chosen else None


def text_summary(row: dict[str, Any]) -> dict[str, Any]:
    """One row of the Documents table, without the display-only parts."""
    version = _newest(row) or {}
    stages = row.get("stages") or {}
    final = row.get("final")
    step = row.get("next_step") or {}
    return {
        "case_id": row.get("case_id"),
        "language": row.get("language"),
        "is_source": row.get("is_source"),
        "document_id": version.get("document_id"),
        "version": version.get("version"),
        "origin": version.get("origin"),
        "translation_status": version.get("translation_status"),
        "in_plan": row.get("in_plan", True),
        "plan": row.get("plan_row"),
        "stages": {name: (cell or {}).get("state") for name, cell in stages.items()},
        "next_step": step.get("code"),
        "work": [
            {
                "assignment_id": item.get("assignment_id"),
                "task": item.get("task"),
                "status": item.get("status"),
                "document_id": item.get("document_id"),
                "person": (item.get("person") or {}).get("pseudonym")
                or item.get("author_label"),
            }
            for item in row.get("work", [])
        ],
        "final": None
        if final is None
        else {
            "submission_id": final.get("submission_id"),
            "kind": final.get("kind"),
            "author": final.get("author_label"),
        },
        "problem_reports": len(row.get("problem_reports", [])),
    }


async def rows(
    api: OntotatorClient, project: str, **filters: Any
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Every row of every page matching ``filters``, and the first page's header."""
    first: dict[str, Any] = await api.get(
        project_path(project, "document-rows"), page=1, **filters
    )
    pages = [first]
    for page in range(2, int(first.get("page_count", 1)) + 1):
        pages.append(
            await api.get(project_path(project, "document-rows"), page=page, **filters)
        )
    found = [row for page in pages for group in page["groups"] for row in group["rows"]]
    return found, first


def register_status(server: MCPServer, api: OntotatorClient) -> None:
    @register(server, scopes="read", effect="read")
    async def project_overview(project: Project) -> dict[str, Any]:
        """Where a project stands: settings, totals per stage, people and open decisions.

        Combines the project's settings, progress, the number of texts that
        need the lead and the warnings the final export would show.
        """
        settings = await api.get(project_path(project, "settings"))
        progress = await api.get(project_path(project, "progress"))
        summary = await api.get(project_path(project, "documents/summary"))
        warnings = await api.get(project_path(project, "workflow-warnings"))
        return {
            "project": project,
            "name": settings.get("name"),
            "languages": settings.get("languages"),
            "annotations_per_text": settings.get("annotations_per_text"),
            "totals": progress.get("totals"),
            "lede": progress.get("lede"),
            "stages": progress.get("stages"),
            "workload": progress.get("workload", []),
            "needs_decision": summary.get("needs_decision"),
            "final_results": len(warnings.get("selections", [])),
            "export_warnings": len(warnings.get("warnings", [])),
            "texts_without_final": len(warnings.get("omissions", [])),
        }

    @register(server, scopes="read", effect="read")
    async def get_progress(
        project: Project,
        view: Literal["texts", "people", "both"] = "both",
    ) -> dict[str, Any]:
        """Assignment progress per text version and per person (open, in progress, submitted)."""
        progress: dict[str, Any] = await api.get(project_path(project, "progress"))
        result: dict[str, Any] = {"totals": progress.get("totals")}
        if view in ("texts", "both"):
            result["texts"] = progress.get("documents", [])
        if view in ("people", "both"):
            result["people"] = progress.get("people", [])
            result["workload"] = progress.get("workload", [])
        return result

    @register(server, scopes="read", effect="read")
    async def list_texts(
        project: Project,
        language: list[str] | None = None,
        stage: Annotated[
            list[Stage] | None, Field(description="Current stage of the text.")
        ] = None,
        query: Annotated[
            str | None, Field(description="Part of a case or text ID, or 'case-1 de'.")
        ] = None,
        proposals: Literal["with", "without"] | None = None,
        page: Annotated[
            int | None,
            Field(ge=1, description="One page of cases; None returns every page."),
        ] = None,
    ) -> dict[str, Any]:
        """The project's texts with IDs, stage, assigned people and final result.

        Gives the document_id of each text's newest version, which
        assign_texts and start_consolidation need.
        """
        filters: dict[str, Any] = {
            "language": language,
            "stage": stage,
            "q": query,
            "proposals": [proposals] if proposals else None,
        }
        if page is None:
            found, header = await rows(api, project, **filters)
        else:
            header = await api.get(
                project_path(project, "document-rows"), page=page, **filters
            )
            found = [row for group in header["groups"] for row in group["rows"]]
        return {
            "texts": [text_summary(row) for row in found],
            "text_count": header.get("text_count"),
            "case_count": header.get("group_count"),
            "page": page,
            "page_count": header.get("page_count"),
        }

    @register(server, scopes="read", effect="read")
    async def agreement_summary(
        project: Project,
        case_ids: Annotated[
            list[str] | None,
            Field(description="Only these cases; None: every text with results."),
        ] = None,
        limit: Annotated[int, Field(ge=1, le=MAX_AGREEMENT_TEXTS)] = 50,
    ) -> dict[str, Any]:
        """Agreement of the submitted annotations per text, as the lead's panel shows it.

        For each text with at least two submissions: findings compared,
        matching, differing in context or in details, and whether all match
        (then accept_agreeing_texts can accept it). Project-wide F1 values
        are in the final export (agreement.csv, agreement-summary.csv).
        """
        found, _ = await rows(api, project, stage=["final", "done"])
        if case_ids is not None:
            wanted = set(case_ids)
            found = [row for row in found if row.get("case_id") in wanted]
        texts: list[dict[str, Any]] = []
        for row in found:
            if len(texts) >= limit:
                break
            panel = await api.get(
                project_path(
                    project,
                    "document-rows",
                    seg(row["case_id"]),
                    seg(row["language"]),
                    "final-panel",
                )
            )
            submissions = [
                item
                for item in panel.get("submissions", [])
                if item.get("is_latest_in_round") is not False
            ]
            if len(submissions) < 2:
                continue
            agreement = panel.get("agreement") or {}
            texts.append(
                {
                    "case_id": row["case_id"],
                    "language": row["language"],
                    "submissions": len(submissions),
                    "all_match": panel.get("all_match", False),
                    "findings": agreement.get("total"),
                    "matching": agreement.get("matching"),
                    "context_differences": agreement.get("context_differences"),
                    "detail_differences": len(
                        agreement.get("detail_differences") or []
                    ),
                    "unresolved": len(panel.get("unresolved", [])),
                    "final": (row.get("final") or {}).get("submission_id"),
                }
            )
        matching = sum(t["matching"] or 0 for t in texts)
        total = sum(t["findings"] or 0 for t in texts)
        return {
            "texts": texts,
            "texts_compared": len(texts),
            "texts_all_match": sum(1 for t in texts if t["all_match"]),
            "findings_matching": matching,
            "findings_total": total,
            "truncated": len(texts) >= limit,
        }
