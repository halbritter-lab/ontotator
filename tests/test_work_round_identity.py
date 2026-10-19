"""Round-aware workspace identity never aliases an older independent attempt."""

import pytest
from pydantic import ValidationError

from ontocurator.domain.workspace import WorkspaceKey
from ontocurator.storage.repository import _key_str, _workspace_aliases


def legacy_key():
    return dict(
        project_key="p",
        document_id="d",
        annotator_id="anna",
        mode="independent",
        scope_id="scope",
        target_set_id="targets-0",
    )


def test_legacy_key_serialization_stays_exactly_unchanged():
    key = WorkspaceKey.model_validate(legacy_key())
    assert key.model_dump() == legacy_key()
    assert _key_str(key) == "p:d:anna:independent:scope:targets-0"


def test_v3_round_key_never_aliases_other_round_or_legacy_targets():
    first = WorkspaceKey.model_validate(
        legacy_key()
        | {
            "format_version": "ontocurator-workspace-key/v3",
            "round_id": "r1",
        }
    )
    second = WorkspaceKey.model_validate(first.model_dump() | {"round_id": "r2"})
    assert _key_str(first).startswith("wk3|")
    assert _key_str(first) != _key_str(second)
    assert _workspace_aliases(first) == (_key_str(first),)
    assert not set(_workspace_aliases(first)) & set(
        _workspace_aliases(WorkspaceKey(**legacy_key()))
    )


@pytest.mark.parametrize(
    "extra",
    [
        {"round_id": "r1"},
        {"format_version": "ontocurator-workspace-key/v3"},
        {"format_version": "ontocurator-workspace-key/v3", "round_id": ""},
    ],
)
def test_partial_or_empty_round_identity_is_rejected(extra):
    with pytest.raises(ValidationError):
        WorkspaceKey.model_validate(legacy_key() | extra)
