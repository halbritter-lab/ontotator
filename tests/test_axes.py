import pytest


def test_axis_definition_validation() -> None:
    from ontocurator.domain.axes import (
        AxesConfig,
        AxisDefinition,
    )

    # Empty axis ID rejected
    with pytest.raises(ValueError, match="Axis ID cannot be empty"):
        AxisDefinition(id="", label="Severity", options=["mild"])

    # Duplicate axis IDs in config rejected
    with pytest.raises(ValueError, match="Duplicate axis ID"):
        AxesConfig(
            definition_name="custom/v1",
            axes=[
                AxisDefinition(id="severity", label="Severity", options=["mild"]),
                AxisDefinition(id="severity", label="Severity 2", options=["severe"]),
            ],
        )

    # Valid custom config
    cfg = AxesConfig(
        definition_name="custom/v1",
        axes=[
            AxisDefinition(
                id="severity",
                label="Severity",
                options=["mild", "severe"],
                allow_empty=False,
            ),
            AxisDefinition(
                id="status",
                label="Status",
                options=["active", "resolved"],
                allow_empty=True,
            ),
        ],
    )
    assert cfg.definition_name == "custom/v1"
    assert len(cfg.axes) == 2


def test_axes_validation_with_config() -> None:
    from ontocurator.domain.axes import (
        Axes,
        AxesConfig,
        AxisDefinition,
        validate_axes,
    )

    cfg = AxesConfig(
        definition_name="custom/v1",
        axes=[
            AxisDefinition(
                id="severity",
                label="Severity",
                options=["mild", "severe"],
                allow_empty=False,
            ),
        ],
    )

    # Valid complete axes
    valid_axes = Axes(definition_name="custom/v1", values={"severity": "severe"})
    validate_axes(valid_axes, cfg, complete=True)

    # Definition mismatch rejected
    mismatch_axes = Axes(definition_name="other/v1", values={"severity": "severe"})
    with pytest.raises(ValueError, match="Profile mismatch"):
        validate_axes(mismatch_axes, cfg, complete=False)

    # Unknown key rejected
    unknown_key_axes = Axes(
        definition_name="custom/v1", values={"severity": "mild", "extra": "val"}
    )
    with pytest.raises(ValueError, match="Unknown axis"):
        validate_axes(unknown_key_axes, cfg, complete=False)

    # Invalid option rejected
    invalid_opt_axes = Axes(
        definition_name="custom/v1", values={"severity": "catastrophic"}
    )
    with pytest.raises(ValueError, match="Invalid value"):
        validate_axes(invalid_opt_axes, cfg, complete=False)

    # Incomplete allowed for draft (complete=False),
    # but rejected for completion (complete=True)
    incomplete_axes = Axes(definition_name="custom/v1", values={"severity": None})
    validate_axes(incomplete_axes, cfg, complete=False)  # draft ok
    with pytest.raises(ValueError, match="Required axis"):
        validate_axes(incomplete_axes, cfg, complete=True)  # completion fails


def test_empty_axes_config() -> None:
    from ontocurator.domain.axes import Axes, AxesConfig, validate_axes

    empty_cfg = AxesConfig(definition_name="empty/v1", axes=[])
    axes = Axes(definition_name="empty/v1", values={})
    validate_axes(axes, empty_cfg, complete=True)

    non_empty_axes = Axes(definition_name="empty/v1", values={"foo": "bar"})
    with pytest.raises(ValueError, match="Unknown axis"):
        validate_axes(non_empty_axes, empty_cfg, complete=False)


def test_builtin_clinical_profile() -> None:
    from ontocurator.domain.axes import (
        CLINICAL_PHENOTYPE_CONFIG,
        EDITOR_AXES_CONFIG,
        Axes,
        validate_axes,
    )

    assert EDITOR_AXES_CONFIG.definition_name == "editor-axes/v1"
    assert CLINICAL_PHENOTYPE_CONFIG.definition_name == "clinical-phenotype/v1"

    # Both allow None / missing values by default
    axes_legacy = Axes(
        definition_name="editor-axes/v1",
        values={"assertion": "present", "experiencer": None, "temporality": None},
    )
    validate_axes(axes_legacy, EDITOR_AXES_CONFIG, complete=True)


def test_standard_axes_have_english_labels_and_stable_ids() -> None:
    from ontocurator.domain.axes import STANDARD_CLINICAL_AXES

    assert [(axis.id, axis.label, axis.options) for axis in STANDARD_CLINICAL_AXES] == [
        ("assertion", "Assertion", ["present", "absent", "uncertain"]),
        ("experiencer", "Experiencer", ["patient", "family_member", "other"]),
        ("temporality", "Temporality", ["current", "historical", "future"]),
    ]


def test_family_member_is_a_valid_experiencer() -> None:
    from ontocurator.domain.axes import EDITOR_AXES_CONFIG, validate_axes

    validate_axes({"experiencer": "family_member"}, EDITOR_AXES_CONFIG, complete=False)
