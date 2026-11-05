"""Setup tools: ontologies, projects, settings, guidelines, imports, people, work."""

from __future__ import annotations

import json
from typing import Annotated, Any, Literal

from mcp.server.mcpserver import MCPServer
from pydantic import Field

from ontotator_mcp.client import OntotatorClient, project_path, seg
from ontotator_mcp.errors import OntotatorError
from ontotator_mcp.models import (
    AssignmentRow,
    CasePlanChoice,
    ExternalReview,
    Pin,
    PlanChoice,
    TextRef,
)
from ontotator_mcp.tooling import register

Project = Annotated[str, Field(description="Project key, e.g. 'ward-7'.")]
Paths = Annotated[
    list[str],
    Field(
        min_length=1,
        description=(
            "Absolute paths (or starting with ~) of local files to upload,"
            " inside the folders of ONTOTATOR_MCP_FILES_DIR."
        ),
    ),
]
PROFILE_PATH = (
    "Absolute local path (or starting with ~) of a task profile JSON file,"
    " inside the folders of ONTOTATOR_MCP_FILES_DIR."
)
UPLOAD_KINDS = {"text": "text", "ontospan": "t1"}
MAX_LISTED = 50


def _cut(items: Any, limit: int = MAX_LISTED) -> Any:
    if isinstance(items, list) and len(items) > limit:
        return [*items[:limit], f"... {len(items) - limit} more"]
    return items


def upload_summary(view: dict[str, Any]) -> dict[str, Any]:
    """The parts of an upload's preview a lead decides on."""
    plan = view.get("preview") or {}
    return {
        "upload_id": view.get("id"),
        "status": view.get("status"),
        "kind": "ontospan" if view.get("kind") == "t1" else view.get("kind"),
        "language": view.get("language"),
        "files": [item.get("filename") for item in view.get("files", [])],
        "committable": plan.get("committable", False) and view.get("status") == "ready",
        "plan_sha256": view.get("plan_sha256"),
        "counts": plan.get("counts", {}),
        "errors": _cut(plan.get("errors", [])),
        "warnings": _cut(plan.get("warnings", [])),
        "duplicates": len(plan.get("duplicates", [])),
        "collisions": _cut(plan.get("collisions", [])),
        "proposal_sets": _cut(plan.get("proposal_sets", [])),
        "work_plan": plan.get("work_plan"),
    }


OPEN_STATES = ("open", "in_progress", "reopened")


def tasks_of_roles(
    assignments: list[dict[str, Any]], removed: set[str]
) -> list[dict[str, Any]]:
    """The open tasks that rest on one of the ``removed`` roles.

    As the server decides it: annotation on the annotator role, review on
    the consolidator (adjudicator) role, a translation review on the
    annotator role, and a lead correction on the lead role.
    """
    found = []
    for item in assignments:
        if item.get("revoked_at") or item.get("status") not in OPEN_STATES:
            continue
        task = item.get("task")
        if task == "translation_review":
            needs = "lead" if item.get("lead_correction") else "annotator"
        else:
            needs = {"annotate": "annotator", "review": "adjudicator"}.get(
                str(task), ""
            )
        if needs in removed:
            found.append(
                {key: item.get(key) for key in ("id", "document_id", "task", "status")}
            )
    return found


async def all_case_ids(api: OntotatorClient, project: str) -> list[str]:
    """Every case of the project (at most 2000, the API's selection limit)."""
    found = await api.get(project_path(project, "document-rows/case-ids"))
    if found.get("truncated"):
        raise OntotatorError(
            f"The project has {found.get('total')} cases, more than one call can"
            " select. Name the cases."
        )
    if not found.get("case_ids"):
        raise OntotatorError("The project has no texts yet.")
    ids: list[str] = found["case_ids"]
    return ids


def _profile(
    api: OntotatorClient, profile: dict[str, Any] | None, profile_path: str | None
) -> tuple[dict[str, Any] | None, list[str]]:
    """The task profile, and the local file it was read from (if any)."""
    if profile is not None and profile_path is not None:
        raise OntotatorError("Give either profile or profile_path, not both.")
    if profile_path is None:
        return profile, []
    [file] = api.local_files([profile_path])
    try:
        loaded = json.loads(file.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise OntotatorError(f"Cannot read the task profile {file}: {exc}") from None
    if not isinstance(loaded, dict):
        raise OntotatorError(f"The task profile file {file} must hold a JSON object.")
    return loaded, [str(file)]


def register_setup(server: MCPServer, api: OntotatorClient) -> None:
    @register(server, scopes="read", effect="read")
    async def whoami() -> dict[str, Any]:
        """Who the API token acts as, and the server's version and address.

        Call this first to check that ONTOTATOR_URL and ONTOTATOR_TOKEN work.
        A project token reaches only routes of its project, so for one this
        reports the project the server names instead of the user.
        """
        try:
            me = await api.get("/api/v1/auth/me")
        except OntotatorError as exc:
            if exc.code != "TOKEN_NOT_ALLOWED":
                raise
            return {
                "user": None,
                "project_token": True,
                "note": str(exc).split(": HTTP 403 TOKEN_NOT_ALLOWED. ")[-1],
                "url": api.settings.url,
            }
        about = await api.get("/api/v1/about")
        me.pop("csrf_token", None)
        return {"user": me, "server": about, "url": api.settings.url}

    @register(server, scopes="read", effect="read")
    async def list_projects() -> list[dict[str, Any]]:
        """The projects the token's owner is a member of, with roles and text counts."""
        projects: list[dict[str, Any]] = await api.get("/api/v1/projects")
        return projects

    @register(server, scopes="read", effect="read")
    async def list_ontologies() -> list[dict[str, Any]]:
        """Ontology releases on the server with their SHA-256 and translations.

        Use the ``sha256`` of a release as a pin in create_project or
        set_ontology_pins.
        """
        listed: list[dict[str, Any]] = await api.get("/api/v1/ontologies")
        return listed

    @register(server, scopes="admin", effect="read")
    async def list_ontology_files() -> list[dict[str, Any]]:
        """Every uploaded ontology and translation file, with the projects using it.

        ``frozen_without`` names projects that froze their translations before
        a translation file arrived, so it does not reach them (see
        refresh_translations). Needs a system token.
        """
        listed: list[dict[str, Any]] = await api.get("/api/v1/admin/ontologies/")
        return listed

    @register(server, scopes="admin", effect="additive", idempotent=True)
    async def upload_ontology_files(paths: Paths) -> dict[str, Any]:
        """Upload ontology releases (obographs JSON) or Babelon translation files (.tsv).

        UPLOADS FILES FROM THE USER'S COMPUTER: it reads the named local
        files and sends them to Ontotator; ``local_files`` in the result
        names the absolute paths read. Only files inside the folders of
        ONTOTATOR_MCP_FILES_DIR; without that variable it refuses. Each file
        is added once; a file the
        server already has is reported as ``already_present``. Add
        translations before anyone works in a project: its first term
        search freezes the translations it uses. Needs a system token.
        """
        files = api.local_files(paths)
        result: list[dict[str, Any]] = await api.upload(
            "/api/v1/admin/ontologies/upload-results", "files[]", files
        )
        return {"local_files": [str(file) for file in files], "files": result}

    @register(server, scopes="read", effect="read")
    async def list_project_templates() -> list[dict[str, Any]]:
        """Project templates (ready task profiles) and the ontologies each needs."""
        listed: list[dict[str, Any]] = await api.get("/api/v1/projects/templates")
        return listed

    @register(server, scopes="admin", effect="additive")
    async def create_project(
        key: Annotated[str, Field(description="New project key (URL-safe).")],
        name: str,
        pins: Annotated[list[Pin], Field(description="One pin per ontology.")],
        languages: Annotated[
            list[str], Field(description="Languages of the texts, e.g. ['en','de'].")
        ] = [],  # noqa: B006 (pydantic copies defaults)
        description: str | None = None,
        template: Annotated[
            str | None, Field(description="Template ID (list_project_templates).")
        ] = None,
        profile: Annotated[
            dict[str, Any] | None,
            Field(description="Task profile JSON (ontotator-task-profile/v1)."),
        ] = None,
        profile_path: Annotated[str | None, Field(description=PROFILE_PATH)] = None,
    ) -> dict[str, Any]:
        """Create a project from a template or a task profile.

        Give exactly one of template, profile and profile_path. The token's
        owner becomes the project's lead. Needs a system token. With
        profile_path it READS A FILE FROM THE USER'S COMPUTER and sends its
        content to Ontotator; ``local_files`` in the result names the
        absolute path read. profile_path must lie inside the folders of
        ONTOTATOR_MCP_FILES_DIR; without that variable it is refused.
        """
        chosen, read = _profile(api, profile, profile_path)
        if (template is None) == (chosen is None):
            raise OntotatorError("Give exactly one of template, profile, profile_path.")
        body: dict[str, Any] = {
            "key": key,
            "name": name,
            "description": description,
            "languages": languages,
            "pins": [pin.model_dump() for pin in pins],
        }
        if template is not None:
            body["template"] = template
        else:
            body["profile"] = chosen
        created: dict[str, Any] = await api.post("/api/v1/projects/", body)
        return created | ({"local_files": read} if read else {})

    @register(server, scopes="read", effect="read")
    async def get_project_settings(project: Project) -> dict[str, Any]:
        """A project's settings: name, languages, rules, task profile and pins."""
        settings: dict[str, Any] = await api.get(project_path(project, "settings"))
        return settings

    @register(server, scopes="project-admin", effect="changes", idempotent=True)
    async def update_project_settings(
        project: Project,
        changes: Annotated[
            dict[str, Any],
            Field(
                description=(
                    "Only the fields to change, as in PATCH .../settings, e.g."
                    " {'annotations_per_text': 2, 'languages': ['en','de'],"
                    " 'adjudicator_not_annotator': true, 'import_plan':"
                    " 'review_and_annotate_translations'}."
                )
            ),
        ],
    ) -> dict[str, Any]:
        """Change project settings; fields not named keep their value."""
        if not changes:
            raise OntotatorError("Name at least one setting to change.")
        settings: dict[str, Any] = await api.patch(
            project_path(project, "settings"), changes
        )
        return settings

    @register(server, scopes="project-admin", effect="changes", idempotent=True)
    async def set_task_profile(
        project: Project,
        profile: Annotated[
            dict[str, Any] | None, Field(description="Task profile JSON.")
        ] = None,
        profile_path: Annotated[str | None, Field(description=PROFILE_PATH)] = None,
    ) -> dict[str, Any]:
        """Replace the project's task profile (layers, annotation types, value axes).

        The server refuses a change that would not fit work already done.
        With profile_path it READS A FILE FROM THE USER'S COMPUTER and sends
        its content to Ontotator; ``local_files`` in the result names the
        absolute path read. profile_path must lie inside the folders of
        ONTOTATOR_MCP_FILES_DIR; without that variable it is refused.
        """
        chosen, read = _profile(api, profile, profile_path)
        if chosen is None:
            raise OntotatorError("Give profile or profile_path.")
        settings: dict[str, Any] = await api.put(
            project_path(project, "profile"), chosen
        )
        return settings | ({"local_files": read} if read else {})

    @register(server, scopes="project-admin", effect="destructive")
    async def set_ontology_pins(
        project: Project,
        pins: list[Pin],
        confirm: Annotated[
            bool,
            Field(description="False: dry run only. True: apply exactly that check."),
        ] = False,
    ) -> dict[str, Any]:
        """Pin the project to ontology releases, after a dry run.

        Without confirm it returns what the move does (pin changes, draft
        terms it rewrites or flags, submitted work it counts) and changes
        nothing. With confirm it checks again and applies that check;
        draft terms are rewritten as new draft revisions, submitted work is
        never rewritten.
        """
        body = [pin.model_dump() for pin in pins]
        report: dict[str, Any] = await api.post(
            project_path(project, "pins/preview"), body
        )
        if not confirm:
            return {"applied": False, "report": report}
        settings = await api.post(
            project_path(project, "pins/apply"),
            {"pins": body, "report_sha256": report["report_sha256"]},
        )
        return {"applied": True, "report": report, "settings": settings}

    @register(server, scopes="project-admin", effect="changes")
    async def refresh_translations(project: Project) -> dict[str, Any]:
        """Move the project to the newest translation files on the server.

        Earlier searches keep the condition they ran with. Refused with
        TRANSLATIONS_CURRENT when nothing would change.
        """
        settings: dict[str, Any] = await api.post(
            project_path(project, "translations/refresh")
        )
        return settings

    @register(server, scopes="project-admin", effect="additive")
    async def publish_guideline(
        project: Project,
        path: Annotated[
            str,
            Field(
                description=(
                    "Absolute path (or starting with ~) of a local Markdown or"
                    " text file, inside the folders of ONTOTATOR_MCP_FILES_DIR."
                )
            ),
        ],
        change_note: str = "",
    ) -> dict[str, Any]:
        """Publish a new version of the project's annotation guideline.

        UPLOADS A FILE FROM THE USER'S COMPUTER: it reads the named local
        file and sends it to Ontotator; ``local_files`` in the result names
        the absolute path read. Only files inside the folders of
        ONTOTATOR_MCP_FILES_DIR; without that variable it refuses. Earlier
        versions stay; annotators are asked
        to read the new one.
        """
        files = api.local_files([path])
        summary: dict[str, Any] = await api.upload(
            project_path(project, "guidelines"),
            "file",
            files,
            data={"change_note": change_note},
        )
        return summary | {"local_files": [str(file) for file in files]}

    @register(server, scopes="import", effect="additive")
    async def upload_texts(
        project: Project,
        paths: Paths,
        format: Annotated[
            Literal["text", "ontospan"],
            Field(
                description=(
                    "'text': .txt files or a .zip of .txt files in one language."
                    " 'ontospan': an Ontospan bundle (.zip with manifest.json, or"
                    " one exchange .json) with texts, translations and machine"
                    " proposals from annotation tools."
                )
            ),
        ],
        language: Annotated[
            str | None, Field(description="Language of plain texts, e.g. 'en'.")
        ] = None,
        wait: bool = True,
    ) -> dict[str, Any]:
        """Stage texts or a proposal bundle and check them; imports nothing yet.

        Each call stages a new upload; discard the ones not imported.
        Returns the check: counts of cases, texts and proposals, problems,
        the planned work per language and the upload_id. Then call
        commit_upload to import, or discard_upload. UPLOADS FILES FROM THE
        USER'S COMPUTER: it reads the named local files (streamed from disk)
        and sends them to Ontotator; ``local_files`` in the result names the
        absolute paths read. Only files inside the folders of
        ONTOTATOR_MCP_FILES_DIR; without that variable it refuses.
        """
        if format == "text" and not language:
            raise OntotatorError("Plain text needs the language of the texts.")
        files = api.local_files(paths)
        data: dict[str, Any] = {"kind": UPLOAD_KINDS[format]}
        if language:
            data["language"] = language
        created = await api.upload(
            project_path(project, "uploads"), "files[]", files, data=data
        )
        upload_id = created["upload_id"]
        if wait:
            await api.finished_job(
                created["job_id"], f"The check of upload {upload_id}"
            )
        view = await api.get(project_path(project, "uploads", seg(upload_id)))
        return upload_summary(view) | {"local_files": [str(file) for file in files]}

    @register(server, scopes="import", effect="read")
    async def get_upload(project: Project, upload_id: int) -> dict[str, Any]:
        """The state and check of one staged upload."""
        view = await api.get(project_path(project, "uploads", seg(upload_id)))
        return upload_summary(view)

    @register(server, scopes="import", effect="read")
    async def list_uploads(
        project: Project,
        status: Annotated[
            list[str] | None,
            Field(description="e.g. ['ready','invalid','committed']; all if empty."),
        ] = None,
    ) -> list[dict[str, Any]]:
        """The project's staged and committed uploads."""
        listed = await api.get(project_path(project, "uploads"), status=status)
        return [
            {
                key: item.get(key)
                for key in ("id", "kind", "language", "status", "created_at")
            }
            | {"files": [f.get("filename") for f in item.get("files", [])]}
            for item in listed
        ]

    @register(server, scopes="import", effect="additive")
    async def commit_upload(
        project: Project,
        upload_id: int,
        plan_languages: Annotated[
            dict[str, PlanChoice] | None,
            Field(
                description=(
                    "Work plan per language key ('source' or a language code);"
                    " None keeps the plan the check proposed."
                )
            ),
        ] = None,
        plan_cases: Annotated[
            list[CasePlanChoice] | None, Field(description="Exceptions per text.")
        ] = None,
        accept_external_review: Annotated[
            ExternalReview | None,
            Field(description="Accept unreviewed translations of these languages."),
        ] = None,
        wait: bool = True,
    ) -> dict[str, Any]:
        """Import a checked upload: texts, translations and proposals enter the project.

        Uses exactly the check upload_texts showed (its plan_sha256); a
        project that changed since is refused, so check again.
        """
        path = project_path(project, "uploads", seg(upload_id))
        view = await api.get(path)
        if view.get("status") != "ready" or not view.get("plan_sha256"):
            raise OntotatorError(
                f"Upload {upload_id} is '{view.get('status')}', not ready to"
                " import. get_upload shows its problems."
            )
        body: dict[str, Any] = {"plan_sha256": view["plan_sha256"]}
        if plan_languages:
            body["plan_languages"] = {
                key: choice.model_dump() for key, choice in plan_languages.items()
            }
        if plan_cases:
            body["plan_cases"] = [choice.model_dump() for choice in plan_cases]
        if accept_external_review:
            body["accept_external_review"] = accept_external_review.model_dump()
        created = await api.post(f"{path}/commit", body)
        if not wait:
            return {"upload_id": upload_id, "job_id": created["job_id"]}
        job = await api.finished_job(
            created["job_id"], f"The import of upload {upload_id}"
        )
        return {"upload_id": upload_id, "job": job}

    @register(server, scopes="import", effect="destructive", idempotent=True)
    async def discard_upload(project: Project, upload_id: int) -> dict[str, Any]:
        """Drop a staged upload that was not imported; imported texts stay."""
        view = await api.post(
            project_path(project, "uploads", seg(upload_id), "discard")
        )
        return upload_summary(view)

    @register(server, scopes="read", effect="read")
    async def list_people(project: Project) -> list[dict[str, Any]]:
        """Project members with roles, languages and open tasks.

        Leads see names and login names; others see pseudonyms only.
        """
        members: list[dict[str, Any]] = await api.get(project_path(project, "members"))
        return members

    @register(server, scopes="admin", effect="read")
    async def list_users() -> list[dict[str, Any]]:
        """Every user account of the server with projects and languages.

        Needs a system token.
        """
        users: list[dict[str, Any]] = await api.get("/api/v1/admin/users/")
        return users

    @register(
        server, scopes=("read", "project-admin"), effect="destructive", idempotent=True
    )
    async def set_member_roles(
        project: Project,
        username: str,
        roles: Annotated[
            list[Literal["lead", "annotator", "adjudicator"]],
            Field(
                description=(
                    "The complete new set of roles; 'adjudicator' is the"
                    " consolidator. An empty list removes the person."
                )
            ),
        ],
        revoke_assignments: Annotated[
            bool, Field(description="Also withdraw open tasks of removed roles.")
        ] = False,
        confirm: Annotated[
            bool,
            Field(
                description=(
                    "Needed only to take roles away. False: dry run. True: apply."
                )
            ),
        ] = False,
    ) -> dict[str, Any]:
        """Set a person's roles in the project (adds the person if new).

        Adding roles only is applied at once. Taking a role away, or
        removing the person with an empty list, needs confirm: without it
        the tool returns the current roles, the roles it would remove and
        the person's open tasks that rest on them, and changes nothing.
        Taking a role away logs the person out everywhere and revokes their
        API tokens; their open tasks of removed roles block the change
        unless revoke_assignments withdraws them.
        """
        members = await api.get(project_path(project, "members"))
        current: list[str] = next(
            (m.get("roles", []) for m in members if m.get("username") == username),
            [],
        )
        plan: dict[str, Any] = {
            "username": username,
            "member": bool(current),
            "current_roles": sorted(current),
            "new_roles": sorted(set(roles)),
            "added_roles": sorted(set(roles) - set(current)),
            "removed_roles": sorted(set(current) - set(roles)),
        }
        if plan["removed_roles"]:
            assigned = await api.get(
                project_path(project, "assignments"), username=username
            )
            tasks = tasks_of_roles(assigned, set(plan["removed_roles"]))
            plan |= {
                "open_tasks": _cut(tasks),
                "open_task_count": len(tasks),
                "consequences": [
                    "The person is logged out everywhere and their API tokens"
                    " are revoked.",
                    (
                        f"{len(tasks)} open task(s) are withdrawn."
                        if revoke_assignments
                        else f"{len(tasks)} open task(s) block the change; pass"
                        " revoke_assignments to withdraw them."
                    )
                    if tasks
                    else "No open task rests on the removed roles.",
                ],
            }
            if not confirm:
                return {"applied": False, "plan": plan}
        elif not plan["added_roles"]:
            return {"applied": False, "plan": plan, "note": "Nothing to change."}
        member: dict[str, Any] = await api.put(
            project_path(project, "members", seg(username)),
            {"roles": roles, "revoke_assignments": revoke_assignments},
        )
        return {"applied": True, "plan": plan, "member": member}

    @register(server, scopes="project-admin", effect="additive")
    async def assign_texts(
        project: Project,
        assignments: Annotated[list[AssignmentRow], Field(min_length=1)],
        task: Literal["annotate", "translation_review"] = "annotate",
        confirm_language: Annotated[
            bool, Field(description="Assign even if the profile lacks the language.")
        ] = False,
        confirm_unreviewed_translation: bool = False,
    ) -> dict[str, Any]:
        """Assign text versions to people, one task per row."""
        result: dict[str, Any] = await api.post(
            project_path(project, "assignments"),
            {
                "rows": [row.model_dump() for row in assignments],
                "task": task,
                "confirm_language": confirm_language,
                "confirm_unreviewed_translation": confirm_unreviewed_translation,
            },
        )
        return result

    @register(server, scopes=("read", "project-admin"), effect="additive")
    async def distribute_texts(
        project: Project,
        language: Annotated[str, Field(description="Language code, or 'source'.")],
        usernames: Annotated[list[str], Field(min_length=1, max_length=50)],
        mode: Annotated[
            Literal["one", "split", "each"],
            Field(
                description=(
                    "'each': every person gets every text; 'split': the texts"
                    " are shared out; 'one': all go to one person."
                )
            ),
        ],
        case_ids: Annotated[
            list[str], Field(description="Cases; empty means every case.")
        ] = [],  # noqa: B006
        task: Literal["annotate", "translation_review"] = "annotate",
        confirm: Annotated[
            bool, Field(description="False: dry run. True: assign as previewed.")
        ] = False,
    ) -> dict[str, Any]:
        """Assign many texts of one language at once, after a dry run.

        The dry run lists the targets per person and the texts skipped with
        the reason; with confirm the same selection is assigned, or refused
        if the project changed in between.
        """
        body: dict[str, Any] = {
            "task": task,
            "language": language,
            "mode": mode,
            "usernames": usernames,
            "case_ids": case_ids or await all_case_ids(api, project),
        }
        preview: dict[str, Any] = await api.post(
            project_path(project, "assignments/batch/preview"), body
        )
        summary = {
            "targets": _cut(preview.get("targets", [])),
            "skipped": _cut(preview.get("skipped", [])),
            "people": preview.get("people"),
            "per_text": preview.get("per_text"),
            "needs_people": preview.get("needs_people"),
        }
        if not confirm:
            return {"assigned": False, "preview": summary}
        result = await api.post(
            project_path(project, "assignments/batch"),
            body | {"expected_preview_digest": preview["digest"]},
        )
        return {"assigned": True, "preview": summary, "result": result}

    @register(server, scopes=("read", "project-admin"), effect="destructive")
    async def update_work_plan(
        project: Project,
        language: Annotated[
            str, Field(description="Language code, or 'source' for the sources.")
        ],
        case_ids: Annotated[
            list[str],
            Field(description="Whole cases; with neither this nor texts, every case."),
        ] = [],  # noqa: B006
        texts: Annotated[list[TextRef], Field(description="Single texts.")] = [],  # noqa: B006
        review: Literal["keep", "on", "off", "off_unstarted"] = "keep",
        annotate: Literal["keep", "on", "off"] = "keep",
        annotation_mode: Annotated[
            Literal["keep", "proposals", "scratch", "project"],
            Field(
                description=(
                    "'proposals': annotate from the imported machine proposals;"
                    " 'scratch': from an empty text; 'project': the project's"
                    " default."
                )
            ),
        ] = "keep",
        confirm: Annotated[
            bool, Field(description="False: dry run. True: apply as previewed.")
        ] = False,
    ) -> dict[str, Any]:
        """Turn translation review and annotation on or off and set the annotation mode.

        The dry run counts the changes and their consequences (tasks
        withdrawn, final results leaving); with confirm the change is saved,
        withdrawing those tasks. Texts that already have work keep their
        mode (``mode_locked``); change those in the web interface.
        """
        if case_ids and texts:
            raise OntotatorError("Select either case_ids or texts, not both.")
        if not texts and not case_ids:
            case_ids = await all_case_ids(api, project)
        body: dict[str, Any] = {
            "case_ids": case_ids,
            "rows": [ref.model_dump() for ref in texts],
            "languages": {
                language: {
                    "review": review,
                    "annotate": annotate,
                    "annotation_mode": annotation_mode,
                }
            },
        }
        preview: dict[str, Any] = await api.post(
            project_path(project, "work-plans/bulk/preview"), body
        )
        if not confirm:
            return {"applied": False, "preview": preview}
        result = await api.put(
            project_path(project, "work-plans/bulk"),
            body | {"expected_revisions": preview["revisions"], "confirm": True},
        )
        return {"applied": True, "preview": preview, "result": result}
