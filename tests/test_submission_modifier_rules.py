"""Submit rules and warnings for modifiers (C5)."""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import update

from ontocurator.application.submissions import SubmissionService
from ontocurator.domain.errors import DomainError
from ontocurator.domain.workspace import MutationEnvelope, WorkspaceKey
from ontocurator.storage.tables import ProjectRow

SUBMIT = {"document_checked": True, "checked_layer_ids": ["hpo-layer"]}


def test_warnings_and_digest_without_modifiers_are_unchanged(tmp_path: Path) -> None:
    """Recorded on the unchanged code: a draft with one defaulted value."""
    from test_editing import _setup_test_env

    repo, ontology, workspaces, editor, _ = _setup_test_env(tmp_path)
    with repo.db.transaction() as conn:
        conn.execute(
            update(ProjectRow).values(
                creation_defaults={"hpo-layer": {"phenotype": {"assertion": "present"}}}
            )
        )
    view = workspaces.open(
        WorkspaceKey(
            project_key="pkg-1",
            document_id="doc-1",
            annotator_id="a",
            mode="independent",
            target_set_id="targets-0",
        )
    )
    editor.apply(
        view.key,
        MutationEnvelope(
            mutation_id="create",
            expected_revision=0,
            payload={
                "command": "create_annotation",
                "annotation_id": "own",
                "term_id": "HP:0001252",
                "note": "Document-level finding",
                "chosen_axis_ids": [],
            },
        ),
    )
    with pytest.raises(DomainError) as refused:
        SubmissionService(repo, ontology).submit(
            view.key,
            MutationEnvelope(mutation_id="s", expected_revision=1, payload=SUBMIT),
        )
    assert refused.value.code == "AXIS_CONFIRMATION_WARNING"
    assert refused.value.details == {
        "warnings": [
            {
                "annotation_id": "own",
                "rule": "axis_not_chosen",
                "detail": {"axis": "assertion"},
            }
        ],
        "acknowledgement": {
            "draft_revision": 1,
            "policy_revision": 1,
            "warning_digest": "0f202bdca6c82421f83b0bbc7fbdb14cac4a2df1b84917588457e4f03e96767b",
        },
    }
