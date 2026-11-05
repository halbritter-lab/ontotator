"""People tools: accounts for a cohort, and handing work on when someone leaves.

Accounts are server-wide and need a system token (scope ``admin``). Setup
codes are credentials: they are written to a private local file when the
caller names one, and returned in the result only otherwise. Task handover
works with a project token too, since the assignment routes refuse tasks of
other projects themselves.
"""

from __future__ import annotations

import contextlib
import csv
import io
import os
import tempfile
from pathlib import Path
from typing import Annotated, Any, Literal

from mcp.server.mcpserver import MCPServer
from pydantic import Field

from ontotator_mcp.client import OntotatorClient, project_path, seg
from ontotator_mcp.errors import OntotatorError
from ontotator_mcp.models import NewUser
from ontotator_mcp.tooling import register
from ontotator_mcp.tools_setup import OPEN_STATES, _cut

Project = Annotated[str, Field(description="Project key, e.g. 'ward-7'.")]
CodesPath = Annotated[
    str | None,
    Field(
        description=(
            "Absolute local CSV file (or starting with ~) for the setup codes,"
            " inside the folders of ONTOTATOR_MCP_FILES_DIR. Without it the"
            " codes are in the result."
        )
    ),
]
CODE_COLUMNS = ("username", "display_name", "email", "code", "expires_at")
# Tasks a lead can hand to someone else (a consolidation opens through its round).
HANDOVER_TASKS = ("annotate", "translation_review")


def codes_target(api: OntotatorClient, path: str, overwrite: bool) -> Path:
    """The checked codes file; called before any code is issued, so none is lost."""
    target = api.local_path(path)
    if target.is_dir():
        raise OntotatorError(f"{target} is a directory; name a file.")
    if target.exists() and not overwrite:
        raise OntotatorError(
            f"{target} exists already. Choose another path or pass overwrite."
        )
    if not target.parent.is_dir():
        raise OntotatorError(f"The folder {target.parent} does not exist.")
    return target


def write_codes(
    api: OntotatorClient, path: str, rows: list[dict[str, Any]], overwrite: bool
) -> str:
    """Write ``rows`` as CSV readable by the user only; the absolute path."""
    target = codes_target(api, path, overwrite)
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=CODE_COLUMNS, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    handle, partial = tempfile.mkstemp(
        prefix=f".{target.name}.", suffix=".part", dir=target.parent
    )
    try:
        os.chmod(partial, 0o600)
        with os.fdopen(handle, "w", encoding="utf-8", newline="") as out:
            out.write(buffer.getvalue())
        os.replace(partial, target)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(partial)
        raise
    return str(Path(target).resolve())


def _codes(
    api: OntotatorClient,
    issued: list[dict[str, Any]],
    codes_path: str | None,
    overwrite: bool,
) -> dict[str, Any]:
    """Where the codes went: a local file, or the result itself."""
    if not issued:
        return {"codes": []}
    if codes_path is None:
        return {
            "codes": issued,
            "note": (
                "The setup codes are credentials: hand each one to its person"
                " only. Pass codes_path to write them to a local file instead."
            ),
        }
    written = write_codes(api, codes_path, issued, overwrite)
    return {
        "codes_file": written,
        "codes": [
            {"username": row["username"], "expires_at": row["expires_at"]}
            for row in issued
        ],
    }


def assignment_summary(item: dict[str, Any]) -> dict[str, Any]:
    return {
        key: item.get(key)
        for key in (
            "id",
            "document_id",
            "username",
            "task",
            "status",
            "annotation_mode",
            "lead_correction",
            "revoked_at",
            "last_submission_id",
        )
    }


def handover_plan(
    assignments: list[dict[str, Any]],
    successors: list[str],
    *,
    include_started: bool,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Open tasks to hand on, round robin over ``successors``, and those kept.

    Unstarted tasks move; started ones (in progress or reopened) only with
    ``include_started``, since the successor then starts again. Lead
    corrections and consolidations stay: the web interface handles those.
    """
    moves: list[dict[str, Any]] = []
    kept: list[dict[str, Any]] = []
    for item in sorted(assignments, key=lambda row: int(row.get("id") or 0)):
        if item.get("revoked_at") or item.get("status") not in OPEN_STATES:
            continue
        reason = None
        if item.get("task") not in HANDOVER_TASKS:
            reason = "a consolidation; start a new one with start_consolidation"
        elif item.get("lead_correction"):
            reason = "a lead correction; it stays the lead's own"
        elif item.get("status") != "open" and not include_started:
            reason = "already started; pass include_started to move it anyway"
        if reason is not None:
            kept.append(assignment_summary(item) | {"reason": reason})
            continue
        target = successors[len(moves) % len(successors)]
        moves.append(assignment_summary(item) | {"to": target})
    return moves, kept


def register_people(server: MCPServer, api: OntotatorClient) -> None:
    @register(server, scopes="admin", effect="additive", idempotent=True)
    async def create_users(
        users: Annotated[list[NewUser], Field(min_length=1, max_length=200)],
        project: Annotated[
            str | None,
            Field(
                description=(
                    "Also make each new person a member of this project with"
                    " the person's roles (default: annotator)."
                )
            ),
        ] = None,
        codes_path: CodesPath = None,
        overwrite: bool = False,
    ) -> dict[str, Any]:
        """Create accounts for a cohort, each with a one-time setup code.

        Usernames the server already has are skipped and reported in
        ``existing``, so the call can be repeated safely; a failure of one
        person is reported in ``refused`` and the others go on. Each person
        sets a password with the setup code (valid 24 hours) on the login
        page; issue_setup_codes renews lapsed ones. With codes_path the
        codes are WRITTEN TO A LOCAL CSV FILE (readable by the user only)
        inside the folders of ONTOTATOR_MCP_FILES_DIR instead of being
        returned. Needs a system token.
        """
        known = {
            str(item.get("username", "")).lower()
            for item in await api.get("/api/v1/admin/users/")
        }
        if codes_path is not None:
            # Refuse a bad path before creating anyone.
            codes_target(api, codes_path, overwrite)
        existing: list[str] = []
        created: list[dict[str, Any]] = []
        refused: list[dict[str, Any]] = []
        issued: list[dict[str, Any]] = []
        for person in users:
            if person.username.lower() in known:
                existing.append(person.username)
                continue
            body: dict[str, Any] = {
                "username": person.username,
                "display_name": person.display_name,
                "email": person.email,
                "languages": person.languages,
                "qualification": person.qualification,
            }
            if project is not None:
                body["projects"] = [
                    {"project_key": project, "roles": person.roles or ["annotator"]}
                ]
            try:
                answer = await api.post("/api/v1/admin/users/", body)
            except OntotatorError as exc:
                refused.append(
                    {"username": person.username, "code": exc.code, "error": str(exc)}
                )
                continue
            known.add(person.username.lower())
            user = answer.get("user") or {}
            created.append(
                {
                    "username": user.get("username"),
                    "pseudonym": user.get("pseudonym"),
                    "projects": user.get("projects", []),
                }
            )
            issued.append(
                {
                    "username": user.get("username"),
                    "display_name": user.get("display_name"),
                    "email": user.get("email"),
                    "code": answer.get("code"),
                    "expires_at": answer.get("expires_at"),
                }
            )
        return {
            "created": created,
            "existing": existing,
            "refused": refused,
        } | _codes(api, issued, codes_path, overwrite)

    @register(server, scopes="admin", effect="changes")
    async def issue_setup_codes(
        usernames: Annotated[list[str], Field(min_length=1, max_length=200)],
        include_active_accounts: Annotated[
            bool,
            Field(
                description=(
                    "Also reset people who already set a password: their"
                    " sessions end, their API tokens are revoked, and the old"
                    " password stops working once they use the code."
                )
            ),
        ] = False,
        codes_path: CodesPath = None,
        overwrite: bool = False,
    ) -> dict[str, Any]:
        """New one-time codes for people whose setup code lapsed.

        By default only accounts that never set a password get one (a
        renewed invitation); others are reported in ``skipped``. A new code
        replaces unused earlier ones. With codes_path the codes are WRITTEN
        TO A LOCAL CSV FILE (readable by the user only) inside the folders
        of ONTOTATOR_MCP_FILES_DIR instead of being returned. Needs a system
        token.
        """
        accounts = {
            str(item.get("username", "")).lower(): item
            for item in await api.get("/api/v1/admin/users/")
        }
        if codes_path is not None:
            codes_target(api, codes_path, overwrite)
        skipped: list[dict[str, Any]] = []
        refused: list[dict[str, Any]] = []
        issued: list[dict[str, Any]] = []
        for username in usernames:
            account = accounts.get(username.lower())
            if account is None:
                skipped.append({"username": username, "reason": "no such user"})
                continue
            if not account.get("active", True):
                skipped.append({"username": username, "reason": "deactivated"})
                continue
            if not account.get("setup_pending") and not include_active_accounts:
                skipped.append(
                    {
                        "username": username,
                        "reason": "already set a password; pass"
                        " include_active_accounts to reset it",
                    }
                )
                continue
            try:
                answer = await api.post(
                    f"/api/v1/admin/users/{seg(account['username'])}/reset-code"
                )
            except OntotatorError as exc:
                refused.append(
                    {"username": username, "code": exc.code, "error": str(exc)}
                )
                continue
            issued.append(
                {
                    "username": account.get("username"),
                    "display_name": account.get("display_name"),
                    "email": account.get("email"),
                    "code": answer.get("code"),
                    "expires_at": answer.get("expires_at"),
                }
            )
        return {"skipped": skipped, "refused": refused} | _codes(
            api, issued, codes_path, overwrite
        )

    @register(server, scopes="admin", effect="changes", idempotent=True)
    async def update_user(
        username: str,
        active: Annotated[
            bool | None,
            Field(
                description=(
                    "False deactivates the account: the person is logged out,"
                    " every API token of theirs is revoked, and their work"
                    " stays. True activates it again."
                )
            ),
        ] = None,
        display_name: str | None = None,
        email: str | None = None,
        languages: Annotated[
            list[str] | None,
            Field(description="The complete new list of working languages."),
        ] = None,
        qualification: str | None = None,
    ) -> dict[str, Any]:
        """Change an account: deactivate or activate it, or its name, e-mail, languages.

        Fields not given keep their value. Deactivate someone who leaves
        after handing on their open tasks (hand_over_open_tasks); open tasks
        of a deactivated person stay assigned until then. Needs a system
        token.
        """
        changes: dict[str, Any] = {
            key: value
            for key, value in {
                "active": active,
                "display_name": display_name,
                "email": email,
                "languages": languages,
                "qualification": qualification,
            }.items()
            if value is not None
        }
        if not changes:
            raise OntotatorError("Name at least one field to change.")
        user: dict[str, Any] = await api.patch(
            f"/api/v1/admin/users/{seg(username)}", changes
        )
        return user

    @register(server, scopes="project-admin", effect="read")
    async def find_people(
        project: Project,
        query: Annotated[
            str,
            Field(
                min_length=3,
                description=(
                    "Part of a name or username of someone sharing a project"
                    " with the token's owner, or an exact username or e-mail."
                ),
            ),
        ],
    ) -> list[dict[str, Any]]:
        """Active accounts outside the project that set_member_roles can add.

        As the People page's search: at most ten results; a lead finds
        people who share a project with them by part of the name, anybody
        else only by exact username or e-mail.
        """
        found: list[dict[str, Any]] = await api.get(
            project_path(project, "member-candidates"), q=query
        )
        return found

    @register(server, scopes="read", effect="read")
    async def list_assignments(
        project: Project,
        username: Annotated[
            str | None, Field(description="Only this person's tasks.")
        ] = None,
        document_id: Annotated[
            str | None, Field(description="Only tasks on this text version.")
        ] = None,
        status: Annotated[
            list[Literal["open", "in_progress", "submitted", "reopened"]] | None,
            Field(description="Only tasks in these states; all if empty."),
        ] = None,
        include_revoked: bool = False,
        limit: Annotated[int, Field(ge=1, le=1000)] = 200,
    ) -> dict[str, Any]:
        """The project's tasks with their IDs, person, text version and state.

        Gives the assignment_id that reassign_task, withdraw_task,
        remove_task and reopen_task need.
        """
        listed: list[dict[str, Any]] = await api.get(
            project_path(project, "assignments"),
            username=username,
            document_id=document_id,
            include_revoked=include_revoked or None,
        )
        if status:
            listed = [item for item in listed if item.get("status") in status]
        return {
            "assignments": [assignment_summary(item) for item in listed[:limit]],
            "count": len(listed),
            "truncated": len(listed) > limit,
        }

    @register(server, scopes="project-admin", effect="changes")
    async def reassign_task(
        assignment_id: int,
        username: Annotated[
            str, Field(description="Login name of the project member taking it.")
        ],
        confirm_started: Annotated[
            bool,
            Field(
                description=(
                    "Needed for a task already started or submitted: the new"
                    " person starts from the beginning."
                )
            ),
        ] = False,
        confirm_language: bool = False,
        confirm_unreviewed_translation: bool = False,
    ) -> dict[str, Any]:
        """Hand one task to another project member; the old task is withdrawn.

        Refused with REASSIGN_CONFIRMATION_REQUIRED for a started task
        unless confirm_started. A consolidation cannot be reassigned.
        """
        moved: dict[str, Any] = await api.post(
            f"/api/v1/assignments/{seg(assignment_id)}/reassign",
            {
                "username": username,
                "confirm_started": confirm_started,
                "confirm_language": confirm_language,
                "confirm_unreviewed_translation": confirm_unreviewed_translation,
            },
        )
        return assignment_summary(moved)

    @register(server, scopes="project-admin", effect="destructive")
    async def withdraw_task(
        assignment_id: int, reason: str | None = None
    ) -> dict[str, Any]:
        """Withdraw a task: it leaves the person's list; submitted work stays.

        Unlike remove_task, the draft is not discarded.
        """
        revoked: dict[str, Any] = await api.post(
            f"/api/v1/assignments/{seg(assignment_id)}/revoke", {"reason": reason}
        )
        return assignment_summary(revoked)

    @register(server, scopes="project-admin", effect="destructive")
    async def remove_task(assignment_id: int) -> dict[str, Any]:
        """Remove an unsubmitted annotation task AND DISCARD ITS DRAFT.

        Frees the text's slot, so assigning the person again starts empty.
        Refused for submitted work (withdraw_task instead).
        """
        removed: dict[str, Any] = await api.post(
            f"/api/v1/assignments/{seg(assignment_id)}/remove"
        )
        return assignment_summary(removed)

    @register(server, scopes="project-admin", effect="changes")
    async def reopen_task(
        assignment_id: int, reason: str | None = None
    ) -> dict[str, Any]:
        """Reopen a submitted task so its person can change the submission."""
        reopened: dict[str, Any] = await api.post(
            f"/api/v1/assignments/{seg(assignment_id)}/reopen", {"reason": reason}
        )
        return assignment_summary(reopened)

    @register(server, scopes=("read", "project-admin"), effect="destructive")
    async def hand_over_open_tasks(
        project: Project,
        from_username: Annotated[
            str, Field(description="The person leaving, or pausing their work.")
        ],
        to_usernames: Annotated[
            list[str],
            Field(
                min_length=1,
                max_length=50,
                description="Project members taking the tasks, in turn.",
            ),
        ],
        include_started: Annotated[
            bool,
            Field(
                description=(
                    "Also move tasks already started; the successor starts"
                    " them from the beginning."
                )
            ),
        ] = False,
        confirm_language: bool = False,
        confirm: Annotated[
            bool, Field(description="False: dry run. True: reassign as planned.")
        ] = False,
    ) -> dict[str, Any]:
        """Hand a person's open tasks to others in turn, after a dry run.

        The dry run lists each task with its successor, and the tasks that
        stay (consolidations, lead corrections, started tasks without
        include_started) with the reason. With confirm each planned task is
        reassigned; a refusal of one task (for example the successor
        already has that text) is reported and the others go on. Submitted
        work stays with its author.
        """
        # The server keeps usernames trimmed and in lower case.
        leaving = from_username.strip().lower()
        if leaving in {name.strip().lower() for name in to_usernames}:
            raise OntotatorError("The person leaving cannot take their own tasks.")
        assigned: list[dict[str, Any]] = await api.get(
            project_path(project, "assignments"), username=leaving
        )
        assigned = [a for a in assigned if a.get("username") == leaving]
        moves, kept = handover_plan(
            assigned, to_usernames, include_started=include_started
        )
        plan = {
            "from": from_username,
            "moves": _cut(moves),
            "move_count": len(moves),
            "kept": _cut(kept),
            "kept_count": len(kept),
        }
        if not confirm or not moves:
            return {"applied": False, "plan": plan}
        done: list[dict[str, Any]] = []
        refused: list[dict[str, Any]] = []
        for move in moves:
            try:
                new = await api.post(
                    f"/api/v1/assignments/{seg(move['id'])}/reassign",
                    {
                        "username": move["to"],
                        "confirm_started": include_started,
                        "confirm_language": confirm_language,
                        "confirm_unreviewed_translation": False,
                    },
                )
            except OntotatorError as exc:
                refused.append(
                    {
                        "assignment_id": move["id"],
                        "to": move["to"],
                        "code": exc.code,
                        "error": str(exc),
                    }
                )
                continue
            done.append(
                {
                    "assignment_id": move["id"],
                    "new_assignment_id": new.get("id"),
                    "document_id": new.get("document_id"),
                    "to": new.get("username"),
                }
            )
        return {
            "applied": True,
            "plan": plan,
            "reassigned": _cut(done),
            "reassigned_count": len(done),
            "refused": _cut(refused),
        }

    @register(server, scopes="read", effect="read")
    async def list_problem_reports(
        project: Project,
        document_id: Annotated[
            str | None, Field(description="Only reports on this text version.")
        ] = None,
        limit: Annotated[int, Field(ge=1, le=500)] = 100,
        offset: Annotated[int, Field(ge=0)] = 0,
    ) -> list[dict[str, Any]]:
        """Problem reports annotators filed in the project.

        An open report pauses work and is a warning of the final export;
        the lead decides on it in the web interface.
        """
        listed: list[dict[str, Any]] = await api.get(
            project_path(project, "problem-reports"),
            document_id=document_id,
            limit=limit,
            offset=offset,
        )
        return listed
