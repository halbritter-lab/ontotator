import pytest
from pydantic import ValidationError

from ontotator.domain.workspace import Submission, WorkspaceKey


def test_old_payloads_with_package_id_still_load():
    payload = {
        "submission_id": "historical-submission",
        "origin_key": {
            "package_id": "historical-project",
            "document_id": "document",
            "annotator_id": "annotator",
            "mode": "independent",
            "target_set_id": "targets",
        },
        "targets": {"target_set_id": "targets", "targets": []},
        "draft_revision": 3,
        "snapshots": [],
        "decisions": [],
        "checked_layer_ids": ["hpo"],
        "created_at": "2026-10-01T12:00:00Z",
    }
    submission = Submission.model_validate(payload)
    dumped = submission.model_dump()
    assert dumped["origin_key"]["project_key"] == "historical-project"
    assert "package_id" not in dumped["origin_key"]


def test_project_key_input_is_accepted():
    key = WorkspaceKey.model_validate(
        {
            "project_key": "project",
            "document_id": "document",
            "annotator_id": "annotator",
            "mode": "independent",
            "target_set_id": "targets",
        }
    )
    assert key.project_key == "project"


def test_workspace_key_rejects_unknown_fields():
    with pytest.raises(ValidationError, match="extra_forbidden"):
        WorkspaceKey.model_validate(
            {
                "project_key": "project",
                "document_id": "document",
                "annotator_id": "annotator",
                "mode": "independent",
                "target_set_id": "targets",
                "unknown": "rejected",
            }
        )
