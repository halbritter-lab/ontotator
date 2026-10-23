"""The one policy: what a user may do, system-wide and per project (T2 P5, E9).

``can`` decides action rights; ``may_take`` decides task roles. An admin holds
rights and sees every project and its exports without a membership; working
in a mode needs the matching project role, for a system admin as well
(index Q2, Q4). A user's rights in a project are the union of their roles
there (E9); rights never carry over to another project.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Literal, get_args

from ontocurator.domain.workspace import WorkspaceMode

Role = Literal["lead", "annotator", "adjudicator"]
ROLES: tuple[Role, ...] = get_args(Role)
Task = Literal["annotate", "review", "translation_review"]
# D1: task "review" is the consolidator's task; only a consolidation start
# creates it, never an assignment request.
AssignableTask = Literal["annotate", "translation_review"]
# Administration uses the central task vocabulary; annotation modes remain separate.
ADMINISTRATION_TASKS = frozenset(get_args(Task))
TASK_ROLES: Mapping[Task, frozenset[Role]] = {
    "annotate": frozenset({"annotator"}),
    "review": frozenset({"adjudicator"}),
    "translation_review": frozenset({"annotator"}),
}


class Action(StrEnum):
    """Everything the policy decides about."""

    VIEW_PROJECT = "view_project"
    OPEN_INDEPENDENT = "open_independent"
    OPEN_REVIEW = "open_review"
    EXPORT_OWN_WORK = "export_own_work"
    EXPORT_ALL_WORK = "export_all_work"
    EXPORT_EDIT_LOG = "export_edit_log"
    IMPORT_DOCUMENTS = "import_documents"
    MANAGE_MEMBERS = "manage_members"
    MANAGE_PROJECT_SETTINGS = "manage_project_settings"
    MANAGE_ASSIGNMENTS = "manage_assignments"
    VIEW_ALL_DOCUMENTS = "view_all_documents"
    BROWSE_VERSIONS = "browse_versions"
    VIEW_PROGRESS = "view_progress"
    OVERRIDE_TRANSLATION_STATUS = "override_translation_status"
    CREATE_PROJECT = "create_project"
    MANAGE_USERS = "manage_users"
    MANAGE_ONTOLOGIES = "manage_ontologies"


@dataclass(frozen=True)
class Access:
    """Who asks: the user, the system admin flag and the roles per project key."""

    user_id: int
    pseudonym: str
    is_system_admin: bool
    roles: Mapping[str, frozenset[Role]] = field(default_factory=dict)

    def roles_in(self, project_key: str) -> frozenset[Role]:
        return self.roles.get(project_key, frozenset())


# Actions that concern the whole installation, not a project.
SYSTEM_ACTIONS = frozenset(
    {Action.CREATE_PROJECT, Action.MANAGE_USERS, Action.MANAGE_ONTOLOGIES}
)
# Project actions a system admin may take without a membership (Q4, Q5).
ADMIN_PROJECT_ACTIONS = frozenset(
    {
        Action.VIEW_PROJECT,
        Action.EXPORT_OWN_WORK,
        Action.EXPORT_ALL_WORK,
        Action.EXPORT_EDIT_LOG,
        Action.IMPORT_DOCUMENTS,
        Action.MANAGE_MEMBERS,
        Action.MANAGE_PROJECT_SETTINGS,
        Action.MANAGE_ASSIGNMENTS,
        Action.VIEW_ALL_DOCUMENTS,
        Action.BROWSE_VERSIONS,
        Action.VIEW_PROGRESS,
        Action.OVERRIDE_TRANSLATION_STATUS,
    }
)
# Project actions per role (Q2: working modes need the matching role).
ROLE_ACTIONS: dict[Role, frozenset[Action]] = {
    "lead": frozenset(
        {
            Action.VIEW_PROJECT,
            Action.EXPORT_OWN_WORK,
            Action.EXPORT_ALL_WORK,
            Action.EXPORT_EDIT_LOG,
            Action.IMPORT_DOCUMENTS,
            Action.MANAGE_MEMBERS,
            Action.MANAGE_PROJECT_SETTINGS,
            Action.MANAGE_ASSIGNMENTS,
            Action.VIEW_ALL_DOCUMENTS,
            Action.BROWSE_VERSIONS,
            Action.VIEW_PROGRESS,
            Action.OVERRIDE_TRANSLATION_STATUS,
        }
    ),
    "annotator": frozenset(
        {
            Action.VIEW_PROJECT,
            Action.OPEN_INDEPENDENT,
            Action.EXPORT_OWN_WORK,
        }
    ),
    "adjudicator": frozenset(
        {
            Action.VIEW_PROJECT,
            Action.OPEN_REVIEW,
            Action.EXPORT_OWN_WORK,
            Action.BROWSE_VERSIONS,
        }
    ),
}
MODE_ACTIONS: dict[WorkspaceMode, Action] = {
    "independent": Action.OPEN_INDEPENDENT,
    "review": Action.OPEN_REVIEW,
}
# The modes offered for a direct open; "review" is reached only through a
# consolidation round (D1).
MODE_ORDER: tuple[WorkspaceMode, ...] = ("independent",)


def can(access: Access, action: Action, project_key: str | None = None) -> bool:
    """Whether ``access`` may take ``action`` (in ``project_key``)."""
    if action in SYSTEM_ACTIONS:
        return access.is_system_admin
    if access.is_system_admin and action in ADMIN_PROJECT_ACTIONS:
        return True
    if project_key is None:
        return False
    return any(action in ROLE_ACTIONS[role] for role in access.roles_in(project_key))


def allowed_modes(access: Access, project_key: str) -> list[WorkspaceMode]:
    """The working modes ``access`` may open in ``project_key``, in offer order."""
    return [mode for mode in MODE_ORDER if can(access, MODE_ACTIONS[mode], project_key)]


def may_take(access: Access, project_key: str, task: Task) -> bool:
    """Whether the user holds a task role in this project, including admins."""
    return bool(access.roles_in(project_key) & TASK_ROLES[task])
