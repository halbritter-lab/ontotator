"""The one map from API route to API token scope (issue 305).

Every route of the API is listed here with the scope a token needs for it,
a tuple of scopes any one of which is enough, or ``SESSION`` for a route only a browser session may use (logging in,
annotation work, preferences and the token routes themselves: a token
cannot create, list or revoke tokens). The security middleware enforces the
map for every bearer request; a route missing here is refused to tokens.
The OpenAPI contract carries the scope of each operation as
``x-ontotator-scope``, a list for a route any of several scopes opens (and ``x-ontotator-project-token`` when a project
token may call it), so clients such as an MCP server can read it there or
import ``ROUTE_SCOPES`` directly.

A project token reaches only routes whose ``{key}`` (or ``{project_key}``)
is its project, plus the ``PROJECT_RESOLVED`` routes, which resolve their
project themselves and check it against the token
(``ontotator.authz.project_authority``).

The scope only opens the route; the owner's roles still decide the action
(the effective right is the intersection of both).
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Final, Literal

from starlette.routing import compile_path

from ontotator.auth.api_tokens import SCOPE_DESCRIPTIONS, TokenScope

SESSION: Final = "session"
# A route that any of several scopes opens: following up on work (polling a
# job) must work with the scope that started it (issue 305).
AnyScope = tuple[TokenScope, ...]
RouteScope = TokenScope | Literal["session"] | AnyScope

P = "/api/v1/projects/{key}"
ROUTE_SCOPES: Mapping[tuple[str, str], RouteScope] = {
    # About, identity and the user's own pages
    ("GET", "/api/v1/about"): "read",
    ("POST", "/api/v1/auth/login"): SESSION,
    ("POST", "/api/v1/auth/redeem-code"): SESSION,
    ("POST", "/api/v1/auth/logout"): SESSION,
    ("GET", "/api/v1/auth/me"): "read",
    ("GET", "/api/v1/auth/session"): SESSION,
    ("GET", "/api/v1/auth/demo-logins"): SESSION,
    ("GET", "/api/v1/me/tasks"): "read",
    ("GET", "/api/v1/me/profile"): "read",
    ("PATCH", "/api/v1/me/profile"): SESSION,
    ("POST", "/api/v1/me/password"): SESSION,
    ("GET", "/api/v1/me/practice"): SESSION,
    ("POST", "/api/v1/me/practice"): SESSION,
    ("DELETE", "/api/v1/me/practice"): SESSION,
    ("POST", "/api/v1/me/practice/reset"): SESSION,
    ("PUT", "/api/v1/me/practice/card"): SESSION,
    ("GET", "/api/v1/preferences"): SESSION,
    ("PUT", "/api/v1/preferences"): SESSION,
    ("POST", "/api/v1/technical-reports"): SESSION,
    # A token reads its own record (expiry, scopes) with any non-admin scope.
    ("GET", "/api/v1/me/token"): ("read", "import", "export", "project-admin"),
    # API tokens: never with a token
    ("GET", "/api/v1/me/tokens"): SESSION,
    ("POST", "/api/v1/me/tokens"): SESSION,
    ("POST", "/api/v1/me/tokens/{token_id}/revoke"): SESSION,
    ("GET", f"{P}/tokens"): SESSION,
    ("POST", f"{P}/tokens"): SESSION,
    ("POST", f"{P}/tokens/{{token_id}}/revoke"): SESSION,
    ("GET", "/api/v1/admin/tokens"): SESSION,
    ("POST", "/api/v1/admin/tokens"): SESSION,
    ("POST", "/api/v1/admin/tokens/{token_id}/revoke"): SESSION,
    # Ontologies and terms
    ("GET", "/api/v1/ontologies"): "read",
    ("POST", "/api/v1/search"): "read",
    ("POST", "/api/v1/terms/labels"): "read",
    ("POST", "/api/v1/terms/tree/open"): "read",
    ("POST", "/api/v1/terms/tree/node"): "read",
    # Projects
    ("GET", "/api/v1/projects"): "read",
    ("GET", "/api/v1/projects/templates"): "read",
    ("POST", "/api/v1/projects/"): "admin",
    ("GET", "/api/v1/projects/{project_key}/documents"): "read",
    ("GET", "/api/v1/projects/{project_key}/ontologies"): "read",
    ("GET", f"{P}/settings"): "read",
    ("PATCH", f"{P}/settings"): "project-admin",
    ("PUT", f"{P}/pins"): "project-admin",
    ("POST", f"{P}/pins/preview"): "project-admin",
    ("POST", f"{P}/pins/apply"): "project-admin",
    ("POST", f"{P}/translations/refresh"): "project-admin",
    ("PUT", f"{P}/profile"): "project-admin",
    ("GET", f"{P}/members"): "read",
    ("GET", f"{P}/member-candidates"): "project-admin",
    ("PUT", f"{P}/members/{{username}}"): "project-admin",
    ("GET", f"{P}/progress"): "read",
    ("GET", f"{P}/guidelines"): "read",
    ("POST", f"{P}/guidelines"): "project-admin",
    ("GET", f"{P}/guidelines/{{version}}"): "read",
    ("POST", f"{P}/guidelines/{{version}}/withdraw"): "project-admin",
    ("POST", f"{P}/guidelines/{{version}}/reads"): SESSION,
    # Documents, cases and versions
    ("GET", f"{P}/cases"): "read",
    ("GET", f"{P}/cases/{{case_id:path}}"): "read",
    ("GET", f"{P}/document-rows"): "read",
    ("GET", f"{P}/document-rows/case-ids"): "read",
    ("POST", f"{P}/document-rows/selected"): "read",
    ("POST", f"{P}/document-rows/selection-summary"): "read",
    ("POST", f"{P}/document-rows/keys"): "read",
    ("POST", f"{P}/document-rows/move-to-front"): "project-admin",
    ("GET", f"{P}/document-rows/{{case_id:path}}/{{language}}/submissions"): "read",
    ("GET", f"{P}/document-rows/{{case_id:path}}/{{language}}/final-panel"): "read",
    ("GET", f"{P}/documents/summary"): "read",
    ("POST", f"{P}/documents/visit"): SESSION,
    ("POST", f"{P}/case-ids/lookup"): "read",
    ("GET", f"{P}/documents/{{doc:path}}/annotation-versions"): "read",
    (
        "GET",
        f"{P}/documents/{{doc:path}}/annotation-versions/{{kind}}/{{version_id:path}}",
    ): ("read"),
    ("GET", f"{P}/documents/{{doc:path}}/layers"): "read",
    ("GET", f"{P}/documents/{{doc:path}}/reanchor-items"): "read",
    ("GET", f"{P}/documents/{{doc:path}}/text"): "read",
    ("GET", f"{P}/documents/{{doc:path}}/variant"): "read",
    ("GET", f"{P}/documents/{{doc:path}}/submissions"): "read",
    ("GET", f"{P}/documents/{{doc:path}}/submissions/{{submission_id:path}}"): "read",
    ("GET", f"{P}/documents/{{doc:path}}/translation-reviews"): "read",
    ("POST", f"{P}/documents/{{doc:path}}/translation-correction-assignment"): (
        "project-admin"
    ),
    ("POST", f"{P}/documents/{{doc:path}}/lead-correction"): SESSION,
    ("POST", f"{P}/variants/{{document_id:path}}/discard"): "project-admin",
    ("GET", f"{P}/proposal-sets/{{set_id}}"): "read",
    ("GET", f"{P}/workflow-warnings"): "read",
    # Import
    ("POST", f"{P}/uploads"): "import",
    ("GET", f"{P}/uploads"): "import",
    ("GET", f"{P}/uploads/{{upload_id}}"): "import",
    ("POST", f"{P}/uploads/{{upload_id}}/commit"): "import",
    ("POST", f"{P}/uploads/{{upload_id}}/discard"): "import",
    ("POST", f"{P}/text-changes/preview"): "import",
    # Export
    ("POST", f"{P}/exports"): "export",
    ("POST", f"{P}/exports/translation-reviews"): "export",
    ("POST", f"{P}/exports/final"): "export",
    ("POST", f"{P}/exports/final/preflight"): "export",
    # Working time (issue 298): the timer is annotation work; the lead reads sums.
    ("GET", "/api/v1/assignments/{assignment_id}/work-time"): SESSION,
    ("POST", "/api/v1/assignments/{assignment_id}/work-time"): SESSION,
    ("GET", f"{P}/work-time"): "read",
    # Imports and exports run as jobs: the scope that started one may poll it.
    # Only export jobs have a download.
    ("GET", "/api/v1/jobs/{job_id}"): ("read", "import", "export"),
    ("GET", "/api/v1/jobs/{job_id}/download"): "export",
    # Assignments, work plans and final selection (project administration)
    ("GET", f"{P}/assignments"): "read",
    ("POST", f"{P}/assignments"): "project-admin",
    ("POST", f"{P}/assignments/proposal"): "project-admin",
    ("POST", f"{P}/assignments/batch/preview"): "project-admin",
    ("POST", f"{P}/assignments/batch"): "project-admin",
    ("GET", "/api/v1/assignments/{assignment_id}"): "read",
    ("POST", "/api/v1/assignments/{assignment_id}/reassign"): "project-admin",
    ("POST", "/api/v1/assignments/{assignment_id}/reopen"): "project-admin",
    ("POST", "/api/v1/assignments/{assignment_id}/remove"): "project-admin",
    ("POST", "/api/v1/assignments/{assignment_id}/revoke"): "project-admin",
    ("GET", "/api/v1/assignments/{assignment_id}/submissions"): "read",
    ("GET", "/api/v1/assignments/{assignment_id}/rounds"): "read",
    ("POST", "/api/v1/assignments/{assignment_id}/rounds"): "project-admin",
    ("GET", "/api/v1/assignments/{assignment_id}/round-sources"): "read",
    ("GET", f"{P}/work-plans/annotation-target-preview"): "read",
    ("POST", f"{P}/work-plans/bulk/preview"): "project-admin",
    ("PUT", f"{P}/work-plans/bulk"): "project-admin",
    ("PUT", f"{P}/work-plans/rows"): "project-admin",
    ("PATCH", f"{P}/work-plans/{{case_id:path}}/{{language}}"): "project-admin",
    ("GET", f"{P}/annotation-mode-changes"): "read",
    ("POST", f"{P}/annotation-mode-changes"): "project-admin",
    ("POST", f"{P}/annotation-mode-changes/preview"): "project-admin",
    ("POST", f"{P}/annotation-mode-changes/{{change_id}}/restore"): "project-admin",
    ("POST", f"{P}/consolidations"): "project-admin",
    ("POST", f"{P}/submissions/{{submission_id:path}}/carry"): "project-admin",
    ("PUT", f"{P}/final-selections"): "project-admin",
    # Problem reports
    ("GET", f"{P}/problem-reports"): "read",
    ("GET", "/api/v1/problem-reports/{report_id}"): "read",
    ("GET", "/api/v1/problem-reports/{report_id}/pause-candidates"): "read",
    ("POST", "/api/v1/problem-reports/{report_id}/seen"): SESSION,
    ("POST", "/api/v1/problem-reports/{report_id}/actions"): "project-admin",
    ("POST", "/api/v1/assignments/{assignment_id}/problem-reports"): SESSION,
    # Annotation, review and translation review work: browser only
    ("POST", "/api/v1/assignments/{assignment_id}/open"): SESSION,
    ("POST", "/api/v1/assignments/{assignment_id}/move-to-version"): SESSION,
    ("POST", "/api/v1/assignments/{assignment_id}/text-change-resolution"): SESSION,
    ("POST", "/api/v1/rounds/{round_id}/open"): SESSION,
    ("GET", "/api/v1/rounds/{round_id}/inputs"): "read",
    ("GET", "/api/v1/rounds/{round_id}/consolidation"): "read",
    ("POST", "/api/v1/workspaces/open"): SESSION,
    ("POST", "/api/v1/workspaces/review-inputs"): SESSION,
    ("POST", "/api/v1/workspaces/{workspace_id}/commands"): SESSION,
    ("POST", "/api/v1/workspaces/{workspace_id}/decisions"): SESSION,
    ("POST", "/api/v1/workspaces/{workspace_id}/reanchor-resolutions"): SESSION,
    ("POST", "/api/v1/workspaces/{workspace_id}/submit"): SESSION,
    ("GET", "/api/v1/workspaces/{workspace_id}/submissions/{submission_id}"): SESSION,
    ("POST", "/api/v1/workspaces/{workspace_id}/round-input-resolutions"): SESSION,
    ("POST", "/api/v1/workspaces/{workspace_id}/round-input-resolutions/clear"): (
        SESSION
    ),
    ("POST", "/api/v1/workspaces/{workspace_id}/merge-inputs"): SESSION,
    # Undo, redo and reset of one's own draft (issue 320) are annotation work.
    ("GET", "/api/v1/workspaces/{workspace_id}/history"): SESSION,
    ("POST", "/api/v1/workspaces/{workspace_id}/history"): SESSION,
    ("POST", "/api/v1/workspaces/{workspace_id}/consolidation-groups/resolve"): (
        SESSION
    ),
    ("POST", "/api/v1/workspaces/{workspace_id}/consolidation-groups/annotate"): (
        SESSION
    ),
    ("POST", "/api/v1/workspaces/{workspace_id}/consolidation-groups/reopen"): (
        SESSION
    ),
    ("POST", "/api/v1/workspaces/{workspace_id}/consolidation-groups/reopen-all"): (
        SESSION
    ),
    (
        "POST",
        "/api/v1/workspaces/{workspace_id}/consolidation-groups/undo-reopen-all",
    ): SESSION,
    ("GET", "/api/v1/translation-reviews/{assignment_id}"): "read",
    ("PUT", "/api/v1/translation-reviews/{assignment_id}/draft"): SESSION,
    ("PUT", "/api/v1/translation-reviews/{assignment_id}/checked-sentences"): SESSION,
    ("POST", "/api/v1/translation-reviews/{assignment_id}/submit"): SESSION,
    ("GET", "/api/v1/translation-reviews/{assignment_id}/source-obligations"): "read",
    (
        "POST",
        "/api/v1/translation-reviews/{assignment_id}/source-obligations/{cause_id}"
        "/resolve",
    ): SESSION,
    # System administration (system tokens only)
    ("GET", "/api/v1/admin/users/"): "admin",
    ("POST", "/api/v1/admin/users/"): "admin",
    ("PATCH", "/api/v1/admin/users/{username}"): "admin",
    ("POST", "/api/v1/admin/users/{username}/reset-code"): "admin",
    ("POST", "/api/v1/admin/users/{username}/anonymise"): "admin",
    ("GET", "/api/v1/admin/users/{username}/audit"): "admin",
    ("GET", "/api/v1/admin/ontologies/"): "admin",
    ("POST", "/api/v1/admin/ontologies/"): "admin",
    ("POST", "/api/v1/admin/ontologies/upload-results"): "admin",
    ("GET", "/api/v1/admin/technical-reports"): "admin",
    ("GET", "/api/v1/admin/technical-reports/summary"): "admin",
    ("POST", "/api/v1/admin/technical-reports/{report_id}/status"): "admin",
    ("GET", "/api/v1/admin/practice-projects"): "admin",
    ("DELETE", "/api/v1/admin/practice-projects/{key}"): "admin",
    ("GET", "/api/v1/admin/settings/practice"): "admin",
    ("PUT", "/api/v1/admin/settings/practice"): "admin",
    # Project archives (issue 306): an export carries the whole project with
    # the e-mail addresses of its people, so only a system token reaches it.
    # An import creates a project and accounts: browser sessions only.
    ("POST", "/api/v1/admin/project-archives/export"): "admin",
    ("GET", "/api/v1/admin/project-archives/jobs/{job_id}"): "admin",
    ("GET", "/api/v1/admin/project-archives/jobs/{job_id}/download"): "admin",
    ("POST", "/api/v1/admin/project-archives/import"): SESSION,
}

# Routes without a project in the path that a project token may call: they
# find their project themselves and refuse one that is not the token's.
PROJECT_RESOLVED: frozenset[tuple[str, str]] = frozenset(
    {
        ("GET", "/api/v1/jobs/{job_id}"),
        ("GET", "/api/v1/jobs/{job_id}/download"),
        # The request's own token: a project token reads itself.
        ("GET", "/api/v1/me/token"),
        # Work handed on, withdrawn or reopened: AssignmentService finds the
        # assignment's project and refuses one that is not the token's
        # (require_project_management), so a project token may rebalance
        # the work of its own project.
        ("POST", "/api/v1/assignments/{assignment_id}/reassign"),
        ("POST", "/api/v1/assignments/{assignment_id}/reopen"),
        ("POST", "/api/v1/assignments/{assignment_id}/remove"),
        ("POST", "/api/v1/assignments/{assignment_id}/revoke"),
    }
)
# Path parameters that name the project.
PROJECT_PARAMETERS = ("key", "project_key")


def accepted_scopes(scope: RouteScope) -> tuple[str, ...]:
    """The scopes any one of which opens a route listed with ``scope``."""
    return scope if isinstance(scope, tuple) else (scope,)


def contract_scope(scope: RouteScope) -> str | list[str]:
    """``scope`` as ``x-ontotator-scope`` writes it: a list for any-of."""
    return list(scope) if isinstance(scope, tuple) else scope


@dataclass(frozen=True)
class Requirement:
    """What a bearer request needs for the route it names."""

    method: str
    path: str
    scope: RouteScope
    project_key: str | None
    project_token: bool


def project_token_allowed(method: str, path: str) -> bool:
    """Whether a project token may call this route at all."""
    # The admin scope belongs to system tokens; ``{key}`` there is no project
    # of work (a practice project).
    if ROUTE_SCOPES.get((method, path)) in (None, SESSION, "admin"):
        return False
    return (method, path) in PROJECT_RESOLVED or any(
        f"{{{name}}}" in path for name in PROJECT_PARAMETERS
    )


def openapi_path(path: str) -> str:
    """``path`` as the OpenAPI contract writes it, without convertors."""
    return re.sub(r":[a-z]+}", "}", path)


_COMPILED = [
    (compile_path(path)[0], method, path, scope)
    for (method, path), scope in ROUTE_SCOPES.items()
]


def requirement(method: str, path: str) -> Requirement | None:
    """The scope a request for ``path`` needs, or None.

    None for a route that is not listed, and for a path that two listed
    routes with different scopes match: the middleware then refuses.
    """
    found: list[Requirement] = []
    for pattern, listed_method, template, scope in _COMPILED:
        if listed_method != method:
            continue
        match = pattern.match(path)
        if match is None:
            continue
        params = match.groupdict()
        found.append(
            Requirement(
                method=method,
                path=template,
                scope=scope,
                project_key=next(
                    (params[name] for name in PROJECT_PARAMETERS if name in params),
                    None,
                ),
                project_token=project_token_allowed(method, template),
            )
        )
    if not found or any(
        (item.scope, item.project_key, item.project_token)
        != (found[0].scope, found[0].project_key, found[0].project_token)
        for item in found
    ):
        return None
    return found[0]


def annotate_openapi(schema: dict[str, Any]) -> dict[str, Any]:
    """Add each operation's scope to the OpenAPI ``schema``, in place."""
    listed = {
        (method, openapi_path(path)): (scope, project_token_allowed(method, path))
        for (method, path), scope in ROUTE_SCOPES.items()
    }
    for path, operations in schema.get("paths", {}).items():
        for method, operation in operations.items():
            entry = listed.get((method.upper(), path))
            if entry is None or not isinstance(operation, dict):
                continue
            operation["x-ontotator-scope"] = contract_scope(entry[0])
            if entry[1]:
                operation["x-ontotator-project-token"] = True
    schema["x-ontotator-scopes"] = {
        **SCOPE_DESCRIPTIONS,
        SESSION: "Browser sessions only; no API token reaches it.",
    }
    return schema
