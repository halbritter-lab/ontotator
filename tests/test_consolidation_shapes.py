"""The C8 consolidation shapes exist with their defaults (behaviour:
``test_consolidation_modifiers_*``)."""

from __future__ import annotations

from ontocurator.api.consolidation_routes import (
    ConsolidationGroupView,
    ConsolidationMemberView,
    ConsolidationModifierView,
    ConsolidationView,
)
from ontocurator.application.consolidation_resolve import (
    ModifierIn,
    ResolveChoice,
    ResolveCommand,
)


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
