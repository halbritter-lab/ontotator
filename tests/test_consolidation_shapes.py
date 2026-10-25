"""The C8 consolidation shapes exist with their defaults; M2 fills them."""

from __future__ import annotations

from typing import Any, cast

import pytest

from ontocurator.api.consolidation_routes import (
    ConsolidationGroupView,
    ConsolidationMemberView,
    ConsolidationModifierView,
    ConsolidationView,
)
from ontocurator.application.consolidation_resolve import (
    ConsolidationGroupService,
    ModifierIn,
    ResolveChoice,
    ResolveCommand,
)
from ontocurator.domain.errors import DomainError
from ontocurator.domain.workspace import MutationEnvelope, WorkspaceKey
from ontocurator.storage.repository import Repository


def test_defaults() -> None:
    assert ConsolidationMemberView.model_fields["modifiers"].default == []
    assert ConsolidationGroupView.model_fields["attached_to"].default is None
    assert ConsolidationView.model_fields["modifier_layer_ids"].default == []
    view = ConsolidationModifierView(
        term_id="HP:0012828", term_label="Severe", kind="modifier"
    )
    assert (view.exclusive_class, view.segments) == (None, [])
    assert ModifierIn(term_id="HP:0012828").segments == []
    choice = ResolveChoice(term_id="HP:0001250", span_from_input_id="i1")
    assert choice.modifiers is None
    command = ResolveCommand(input_ids=["i1"], action="keep")
    assert command.attach_to is None


@pytest.mark.parametrize(
    "extra",
    [
        {"attach_to": "cons-0123456789abcdef", "action": "leave_out"},
        {
            "action": "choose",
            "choice": {
                "term_id": "HP:0001250",
                "span_from_input_id": "i1",
                "modifiers": [],
            },
        },
    ],
)
def test_modifier_fields_are_refused_until_m2(extra: dict[str, Any]) -> None:
    service = ConsolidationGroupService(
        cast(Repository, None), lambda project, layer, term: term
    )
    key = WorkspaceKey(
        project_key="p",
        document_id="d",
        annotator_id="a",
        mode="review",
        target_set_id="t",
    )
    with pytest.raises(DomainError) as refused:
        service.resolve(
            key,
            MutationEnvelope(
                mutation_id="m",
                expected_revision=0,
                payload={"input_ids": ["i1"], **extra},
            ),
        )
    assert refused.value.code == "INVALID_RESOLUTION"
