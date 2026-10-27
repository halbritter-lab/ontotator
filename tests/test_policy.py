"""The one policy: system and project roles against every action (T2 P5)."""

from __future__ import annotations

import pytest

from ontotator.authz.policy import Access, Action, Role, allowed_modes, can, may_take

PROJECT = "A"

# The policy table of the T2c plan, one column per role set. Reviewable as is:
# "Y" may, "-" may not. Order: admin, lead, annotator, adjudicator, non-member.
TABLE: dict[Action, str] = {
    Action.VIEW_PROJECT: "YYYY-",
    Action.OPEN_INDEPENDENT: "--Y--",
    Action.OPEN_REVIEW: "---Y-",
    Action.OPEN_PROPOSAL_CHECK: "--Y--",
    Action.EXPORT_OWN_WORK: "YYYY-",
    Action.EXPORT_ALL_WORK: "YY---",
    Action.EXPORT_EDIT_LOG: "YY---",
    Action.IMPORT_DOCUMENTS: "YY---",
    Action.MANAGE_MEMBERS: "YY---",
    Action.MANAGE_PROJECT_SETTINGS: "YY---",
    Action.MANAGE_ASSIGNMENTS: "YY---",
    Action.VIEW_ALL_DOCUMENTS: "YY---",
    Action.BROWSE_VERSIONS: "YY-Y-",
    Action.VIEW_PROGRESS: "YY---",
    Action.OVERRIDE_TRANSLATION_STATUS: "YY---",
    Action.CREATE_PROJECT: "Y----",
    Action.MANAGE_USERS: "Y----",
    Action.MANAGE_ONTOLOGIES: "Y----",
}
ROLE_SETS: list[tuple[str, bool, frozenset[Role]]] = [
    ("admin", True, frozenset()),
    ("lead", False, frozenset({"lead"})),
    ("annotator", False, frozenset({"annotator"})),
    ("adjudicator", False, frozenset({"adjudicator"})),
    ("non-member", False, frozenset()),
]


def access(
    roles: dict[str, frozenset[Role]] | None = None, *, admin: bool = False
) -> Access:
    return Access(
        user_id=1, pseudonym="ann-0001", is_system_admin=admin, roles=roles or {}
    )


def test_the_table_names_every_action() -> None:
    assert set(TABLE) == set(Action)


def test_translation_override_is_a_project_action_for_leads_and_admins() -> None:
    action = Action("override_translation_status")
    assert can(access(admin=True), action, PROJECT)
    assert can(access({PROJECT: frozenset({"lead"})}), action, PROJECT)
    assert not can(
        access({PROJECT: frozenset({"annotator", "adjudicator"})}), action, PROJECT
    )
    assert not can(access({PROJECT: frozenset({"lead"})}), action, "B")


@pytest.mark.parametrize("action", list(Action))
@pytest.mark.parametrize("column", range(len(ROLE_SETS)), ids=[r[0] for r in ROLE_SETS])
def test_every_role_and_action(action: Action, column: int) -> None:
    _name, admin, roles = ROLE_SETS[column]
    who = access({PROJECT: roles} if roles else None, admin=admin)

    assert can(who, action, PROJECT) is (TABLE[action][column] == "Y")


def test_roles_combine() -> None:
    who = access({PROJECT: frozenset({"lead", "annotator"})})

    assert can(who, Action.OPEN_INDEPENDENT, PROJECT)
    assert can(who, Action.EXPORT_ALL_WORK, PROJECT)


def test_rights_do_not_leak_between_projects() -> None:
    who = access({"A": frozenset({"annotator", "lead", "adjudicator"})})

    for action in Action:
        assert not can(who, action, "B"), action


def test_allowed_modes_follow_roles() -> None:
    def modes(*roles: Role) -> list[str]:
        return allowed_modes(access({PROJECT: frozenset(roles)}), PROJECT)

    # D1: "review" opens only through a consolidation round.
    assert modes("annotator") == ["independent"]
    assert modes("adjudicator") == []
    assert modes("annotator", "adjudicator") == ["independent"]
    assert modes() == []
    assert modes("lead") == []
    assert allowed_modes(access(admin=True), PROJECT) == []


def test_project_actions_need_a_project() -> None:
    member = access({PROJECT: frozenset({"lead", "annotator", "adjudicator"})})

    assert not can(member, Action.VIEW_PROJECT, None)
    assert not can(access(), Action.VIEW_PROJECT, None)
    assert can(access(admin=True), Action.VIEW_PROJECT, None)


def test_system_actions_ignore_the_project() -> None:
    lead = access({PROJECT: frozenset({"lead"})})

    assert not can(lead, Action.CREATE_PROJECT, PROJECT)
    assert not can(lead, Action.CREATE_PROJECT)
    assert can(access(admin=True), Action.CREATE_PROJECT)


@pytest.mark.parametrize("admin", [False, True])
def test_tasks_need_their_role(admin: bool) -> None:
    annotator = access({PROJECT: frozenset({"annotator"})}, admin=admin)
    reviewer = access({PROJECT: frozenset({"adjudicator"})}, admin=admin)
    lead = access({PROJECT: frozenset({"lead"})}, admin=admin)
    combined = access(
        {PROJECT: frozenset({"lead", "annotator", "adjudicator"})}, admin=admin
    )

    assert may_take(annotator, PROJECT, "annotate")
    assert not may_take(annotator, PROJECT, "review")
    assert may_take(reviewer, PROJECT, "review")
    assert not may_take(reviewer, PROJECT, "annotate")
    for task in ("annotate", "review"):
        assert not may_take(lead, PROJECT, task)
        assert not may_take(access(admin=admin), PROJECT, task)
        assert may_take(combined, PROJECT, task)
        assert not may_take(combined, "B", task)
