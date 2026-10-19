"""Final export content must honor an exact historical selection."""

import pytest
from test_editing import _setup_test_env

from ontocurator.application.submissions import SubmissionService
from ontocurator.domain.errors import DomainError
from ontocurator.domain.workspace import MutationEnvelope, WorkspaceKey


def test_exact_content_keeps_selected_old_submission_and_rejects_missing(tmp_path):
    repo, ontology, workspaces, editor, _ = _setup_test_env(tmp_path)
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
                "annotation_id": "a",
                "term_id": "HP:0001252",
                "axes_values": {"assertion": "present"},
                "chosen_axis_ids": ["assertion"],
                "note": "First",
            },
        ),
    )
    service = SubmissionService(repo, ontology)
    old = service.submit(
        view.key,
        MutationEnvelope(
            mutation_id="submit1",
            expected_revision=1,
            payload={"document_checked": True},
        ),
    )
    editor.apply(
        view.key,
        MutationEnvelope(
            mutation_id="edit",
            expected_revision=2,
            payload={
                "command": "set_annotation_note",
                "annotation_id": "a",
                "note": "Second",
            },
        ),
    )
    newer = service.submit(
        view.key,
        MutationEnvelope(
            mutation_id="submit2",
            expected_revision=3,
            payload={"document_checked": True},
        ),
    )
    assert newer.submission_id != old.submission_id
    exact = repo.t1_export_content_exact("pkg-1", [old.submission_id])
    assert [s.submission_id for s in exact.submissions] == [old.submission_id]
    assert exact.submissions[0].snapshots[0].annotation.note == "First"
    with pytest.raises(DomainError, match="SUBMISSION_NOT_FOUND"):
        repo.t1_export_content_exact("pkg-1", [old.submission_id, "missing"])
