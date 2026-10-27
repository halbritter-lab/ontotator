"""Pure carrier contract; storage/authority tests require the later PG grant."""

from ontotator.api.upload_routes import ProposalSetView
from ontotator.application.workspaces import WorkspaceView


def test_workspace_metadata_is_defaulted_and_reuses_the_public_typed_projection():
    field = WorkspaceView.model_fields["proposal_sets"]
    assert field.default_factory() == []
    assert field.annotation == list[ProposalSetView]
    schema = WorkspaceView.model_json_schema()
    assert schema["properties"]["proposal_sets"]["items"] == {
        "$ref": "#/$defs/ProposalSetView"
    }
    assert "payload" not in schema["$defs"]["ProposalSetView"]["properties"]
