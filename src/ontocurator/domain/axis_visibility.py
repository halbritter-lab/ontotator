"""Read-only editor projections; pinned profiles remain unchanged."""

from ontocurator.domain.axes import AxesConfig
from ontocurator.domain.profiles import TaskProfile
from ontocurator.domain.project_rules import ProjectRules


def editor_profile(profile: TaskProfile, rules: ProjectRules) -> TaskProfile:
    layers = []
    for layer in profile.layers:
        hidden = rules.hidden_axis_values.get(layer.layer_id, {})
        types = [
            kind.model_copy(
                update={
                    "axes": [
                        axis.model_copy(
                            update={
                                "options": [
                                    value
                                    for value in axis.options
                                    if value not in hidden.get(axis.id, frozenset())
                                ]
                            }
                        )
                        for axis in kind.axes
                    ]
                }
            )
            for kind in layer.annotation_types
        ]
        layers.append(layer.model_copy(update={"annotation_types": types}))
    return profile.model_copy(update={"layers": layers})


def legacy_axes_config(profile: TaskProfile) -> AxesConfig:
    for layer in profile.layers:
        for kind in layer.annotation_types:
            if kind.axes:
                return AxesConfig(
                    definition_name=profile.preset or "custom", axes=kind.axes
                )
    return AxesConfig(definition_name=profile.preset or "custom", axes=[])
