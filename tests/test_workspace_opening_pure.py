"""Workspace-opening compatibility and public boundaries, without PostgreSQL."""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from ontotator.application.workspace_opening import WorkspaceOpeningService
from ontotator.authz.scoped import ScopedRepository
from ontotator.domain.errors import DomainError
from ontotator.domain.review import ReviewTargetSet
from ontotator.domain.workspace import WorkspaceKey


def context(*, mode="independent", explicit=False, held=False, state="editable"):
    key = WorkspaceKey(
        project_key="p",
        document_id="doc",
        annotator_id="alice",
        mode=mode,
        target_set_id="targets-0",
    )
    bound = key.model_copy(
        update={
            "scope_id": "old-scope",
            "round_id": "modern" if explicit else None,
            "format_version": "ontotator-workspace-key/v3" if explicit else None,
        }
    )
    assignment = SimpleNamespace(
        id=7, active_round_id="round", held=held, status="open"
    )
    repo = Mock(spec=ScopedRepository)
    repo.db = Mock()
    repo.workspace_assignment.return_value = assignment
    repo.get_work_round.return_value = SimpleNamespace(
        workspace_key=bound, state=state, active=True
    )
    resolved = key.model_copy(update={"scope_id": "current-scope"})
    workspaces = SimpleNamespace(
        repo=repo, open=Mock(return_value=SimpleNamespace(key=resolved))
    )
    return WorkspaceOpeningService(workspaces), workspaces, key, bound


def test_legacy_review_keeps_ambiguous_target_selection_instead_of_resuming_bound_key():
    service, workspaces, key, _bound = context(mode="review")
    workspaces.open.side_effect = DomainError(
        "AMBIGUOUS_REVIEW_ROUND", {"rounds": ["a", "b"]}
    )
    with pytest.raises(DomainError) as failure:
        service.open(key)
    assert failure.value.code == "AMBIGUOUS_REVIEW_ROUND"
    assert workspaces.open.call_args.args[0].scope_id == ""
    assert workspaces.open.call_args.args[0].target_set_id == "targets-0"
    assert not workspaces.repo.db.called


@pytest.mark.parametrize("mode", ["independent"])
def test_legacy_open_resolves_requested_mode_and_current_profile_without_binding(mode):
    service, workspaces, key, _bound = context(mode="independent")
    requested = key.model_copy(update={"mode": mode})
    workspaces.open.return_value.key = requested.model_copy(
        update={"scope_id": "new-profile-scope"}
    )
    result = service.open(requested)
    assert workspaces.open.call_args.args[0] == requested
    assert result.view.key.mode == mode
    assert result.view.key.scope_id == "new-profile-scope"
    assert result.read_only
    assert not workspaces.repo.db.called


@pytest.mark.parametrize("mode", ["independent"])
def test_unbound_legacy_workspace_keeps_current_mode_scope_and_editability(mode):
    service, workspaces, key, _bound = context(mode=mode)
    workspaces.repo.workspace_assignment.return_value.active_round_id = None
    result = service.open(key)
    assert result.view.key.mode == mode
    assert result.view.key.scope_id == "current-scope"
    assert not result.read_only


def test_read_only_projection_refreshes_assignment_and_active_binding_after_open():
    service, workspaces, key, bound = context()
    opened_key = key.model_copy(update={"scope_id": "current-scope"})
    before = SimpleNamespace(workspace_key=opened_key, state="editable", active=True)
    after = SimpleNamespace(workspace_key=bound, state="editable", active=True)
    workspaces.repo.get_work_round.side_effect = [before, after]
    assert service.open(key).read_only
    assert workspaces.repo.get_work_round.call_count == 2


def test_selected_legacy_review_round_is_forwarded_without_implicit_active_selection():
    service, workspaces, key, _bound = context(mode="review")
    service.open(key, review_round_target_set_id="exact-targets")
    assert workspaces.open.call_args.args[0].target_set_id == "exact-targets"


@pytest.mark.parametrize(
    "held,state,expected",
    [(False, "editable", False), (True, "editable", True), (False, "submitted", True)],
)
def test_default_open_preserves_exact_v3_identity_and_read_only_state(
    held, state, expected
):
    service, workspaces, key, bound = context(explicit=True, held=held, state=state)
    workspaces.open.return_value.key = bound
    result = service.open(key)
    workspaces.open.assert_called_once_with(bound)
    assert result.read_only == expected


def test_submitted_legacy_assignment_stays_read_only_without_accessing_database():
    service, workspaces, key, _bound = context()
    workspaces.repo.workspace_assignment.return_value.status = "submitted"
    assert service.open(key).read_only
    assert not workspaces.repo.db.called


def test_only_explicit_assignment_adapter_calls_the_legacy_binder(monkeypatch):
    service, workspaces, key, _bound = context()
    assignment = workspaces.repo.workspace_assignment.return_value
    assignment.active_round_id = None
    bind = Mock()
    factory = Mock(return_value=SimpleNamespace(bind_legacy=bind))
    monkeypatch.setattr(
        "ontotator.application.workspace_opening.WorkRoundService", factory
    )
    service.open(key)
    factory.assert_not_called()
    workspaces.repo.access = object()
    actor = object()
    assert service.bind_assignment_workspace(key, actor) == assignment
    bind.assert_called_once_with(workspaces.repo.access, actor, 7, key)


def test_existing_assignment_binding_is_not_reactivated_or_replaced(monkeypatch):
    service, _workspaces, key, _bound = context()
    factory = Mock()
    monkeypatch.setattr(
        "ontotator.application.workspace_opening.WorkRoundService", factory
    )
    service.bind_assignment_workspace(key, object())
    factory.assert_not_called()


def test_bound_legacy_independent_empty_target_alias_remains_editable():
    service, workspaces, key, bound = context()
    workspaces.repo.get_work_round.return_value.workspace_key = bound.model_copy(
        update={"target_set_id": ReviewTargetSet.create([]).target_set_id}
    )
    workspaces.open.return_value.key = bound
    assert not service.open(key).read_only
