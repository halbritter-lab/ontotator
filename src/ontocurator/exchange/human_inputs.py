"""Exact, transitive human input closure shared by both export paths."""

from typing import Any

from ontocurator.authz.scoped import ScopedRepository
from ontocurator.domain.errors import DomainError


def human_input_closure(
    repo: ScopedRepository, project: str, submission_ids: list[str]
) -> tuple[list[str], dict[str, list[dict[str, Any]]], dict[str, str]]:
    inputs: dict[str, list[dict[str, Any]]] = {}
    kinds: dict[str, str] = {}
    visited: set[str] = set()
    visiting: set[str] = set()

    def visit(sid: str) -> None:
        if sid in visiting:
            raise DomainError(
                "INVALID_EXPORT_SNAPSHOT", "Cyclic human input provenance."
            )
        if sid in visited:
            return
        visiting.add(sid)
        work_round = repo.get_round_for_submission(project, sid)
        if work_round is not None:
            kinds[sid] = work_round.kind
            entries = repo.get_round_input_inventory(project, work_round.round_id)
            inputs[sid] = entries
            # Inputs of a frozen draft (kind ``text_change``) have no source
            # submission; the draft is not exported, only its snapshot id.
            for source in dict.fromkeys(
                entry["source_submission_id"]
                for entry in entries
                if entry["source_submission_id"] is not None
            ):
                visit(source)
        visiting.remove(sid)
        visited.add(sid)

    for sid in submission_ids:
        visit(sid)
    return sorted(visited), inputs, kinds
