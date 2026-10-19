"""Public assignment-aware opening without changing legacy workspace identity."""

from dataclasses import dataclass

from ontocurator.application.work_rounds import WorkRoundService
from ontocurator.application.workspaces import WorkspaceService, WorkspaceView
from ontocurator.assignments.service import Assignment
from ontocurator.auth.audit import Actor
from ontocurator.authz.scoped import ScopedRepository
from ontocurator.domain.errors import DomainError
from ontocurator.domain.review import ReviewTargetSet
from ontocurator.domain.workspace import WorkspaceKey
from ontocurator.storage.repository import _key_str, _workspace_aliases


@dataclass(frozen=True)
class OpenedWorkspace:
    view: WorkspaceView
    read_only: bool


class WorkspaceOpeningService:
    """Preserve v2 selection semantics; resume only explicit v3 round identities."""

    def __init__(self, workspaces: WorkspaceService) -> None:
        if not isinstance(workspaces.repo, ScopedRepository):
            raise TypeError("Assignment opening requires a scoped repository")
        self.workspaces = workspaces
        self.repo = workspaces.repo

    def open(
        self,
        key: WorkspaceKey,
        *,
        targets: ReviewTargetSet | None = None,
        review_round_target_set_id: str | None = None,
        pending_proposal_set_ids: list[int] | None = None,
    ) -> OpenedWorkspace:
        if review_round_target_set_id is not None and (
            key.mode != "review" or targets is not None
        ):
            raise DomainError(
                "INVALID_REVIEW_ROUND",
                "Round selection requires review mode without explicit targets",
            )
        assignment = self.repo.workspace_assignment(key)
        active = (
            self.repo.get_work_round(key.project_key, assignment.active_round_id)
            if assignment.active_round_id is not None
            else None
        )
        # A v2 adapter binding is bookkeeping, not a frozen request identity.
        # Let the legacy service resolve requested mode/current scope/targets.
        if (
            targets is None
            and review_round_target_set_id is None
            and active is not None
            and active.workspace_key is not None
            and active.workspace_key.round_id is not None
        ):
            view = self.workspaces.open(active.workspace_key)
            return OpenedWorkspace(view, self._read_only(view.key))
        if targets is not None and not targets.target_set_id:
            targets = ReviewTargetSet.create(targets.targets)
        requested = key.model_copy(
            update={
                "target_set_id": targets.target_set_id
                if targets
                else (review_round_target_set_id or "targets-0")
            }
        )
        view = self.workspaces.open(requested, targets, pending_proposal_set_ids)
        return OpenedWorkspace(view, self._read_only(view.key))

    def _read_only(self, key: WorkspaceKey) -> bool:
        # Opening can change the current assignment binding. Project the latest
        # state using the same exact-key restriction as the write guard.
        assignment = self.repo.workspace_assignment(key)
        active = (
            self.repo.get_work_round(key.project_key, assignment.active_round_id)
            if assignment.active_round_id is not None
            else None
        )
        inactive = active is not None and (
            active.workspace_key is None
            or _key_str(key) not in _workspace_aliases(active.workspace_key)
            or not active.active
            or active.state != "editable"
        )
        return inactive or assignment.held or assignment.status == "submitted"

    def bind_assignment_workspace(self, key: WorkspaceKey, actor: Actor) -> Assignment:
        """Explicit assignment adapter binding; generic v2 opens never call this."""
        assignment = self.repo.workspace_assignment(key)
        if key.round_id is None and assignment.active_round_id is None:
            WorkRoundService(self.repo.db).bind_legacy(
                self.repo.access, actor, assignment.id, key
            )
            assignment = self.repo.workspace_assignment(key)
        return assignment
