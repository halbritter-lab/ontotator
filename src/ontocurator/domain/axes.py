from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ontocurator.domain.canonical import canonical_hash

AssertionType = Literal["present", "absent", "uncertain"]
ExperiencerType = Literal["patient", "other"]
TemporalityType = Literal["current", "historical", "future"]


class AxisDefinition(BaseModel):
    """Definition of an individual annotation contextual axis."""

    model_config = ConfigDict(extra="forbid")

    id: str
    label: str
    options: list[str]
    allow_empty: bool = True

    @model_validator(mode="after")
    def validate_id_and_options(self) -> "AxisDefinition":
        clean_id = self.id.strip()
        if not clean_id:
            raise ValueError("Axis ID cannot be empty")
        seen: set[str] = set()
        for opt in self.options:
            if not opt or not opt.strip():
                raise ValueError(f"Empty option in axis '{self.id}'")
            if opt in seen:
                raise ValueError(f"Duplicate option '{opt}' in axis '{self.id}'")
            seen.add(opt)
        return self


class AxesConfig(BaseModel):
    """Named profile definition containing configured axes."""

    model_config = ConfigDict(extra="forbid")

    definition_name: str
    axes: list[AxisDefinition] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_unique_axes(self) -> "AxesConfig":
        seen: set[str] = set()
        for a in self.axes:
            if a.id in seen:
                raise ValueError(f"Duplicate axis ID '{a.id}' in config")
            seen.add(a.id)
        return self

    @property
    def config_sha256(self) -> str:
        payload = {
            "definition_name": self.definition_name,
            "axes": [a.model_dump() for a in self.axes],
        }
        return canonical_hash(payload)


STANDARD_CLINICAL_AXES = [
    AxisDefinition(
        id="assertion",
        label="Vorhandensein (Assertion)",
        options=["present", "absent", "uncertain"],
        allow_empty=True,
    ),
    AxisDefinition(
        id="experiencer",
        label="Betroffene Person (Experiencer)",
        options=["patient", "other"],
        allow_empty=True,
    ),
    AxisDefinition(
        id="temporality",
        label="Zeitlicher Bezug (Temporality)",
        options=["current", "historical", "future"],
        allow_empty=True,
    ),
]

EDITOR_AXES_CONFIG = AxesConfig(
    definition_name="editor-axes/v1",
    axes=STANDARD_CLINICAL_AXES,
)

CLINICAL_PHENOTYPE_CONFIG = AxesConfig(
    definition_name="clinical-phenotype/v1",
    axes=STANDARD_CLINICAL_AXES,
)


class Axes(BaseModel):
    """Context axes associated with an annotation."""

    model_config = ConfigDict(extra="forbid")

    definition_name: str | None = None
    values: dict[str, str | None] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def normalize_legacy_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            # Check for legacy single fields
            legacy_keys = {"assertion", "experiencer", "temporality"}
            has_legacy = any(k in data for k in legacy_keys)
            if has_legacy and "values" not in data:
                vals: dict[str, str | None] = {}
                d = dict(data)
                for k in legacy_keys:
                    if k in d:
                        vals[k] = d.pop(k)
                d["values"] = vals
                return d
        return data

    @property
    def assertion(self) -> str | None:
        return self.values.get("assertion")

    @assertion.setter
    def assertion(self, val: str | None) -> None:
        self.values["assertion"] = val

    @property
    def experiencer(self) -> str | None:
        return self.values.get("experiencer")

    @experiencer.setter
    def experiencer(self, val: str | None) -> None:
        self.values["experiencer"] = val

    @property
    def temporality(self) -> str | None:
        return self.values.get("temporality")

    @temporality.setter
    def temporality(self, val: str | None) -> None:
        self.values["temporality"] = val


def validate_axes(
    axes: Axes | dict[str, str | None],
    config: AxesConfig | list[AxisDefinition],
    *,
    complete: bool,
) -> None:
    """Validate annotation axes against a resolved axis configuration without domain preset branching."""
    if isinstance(config, AxesConfig):
        if isinstance(axes, Axes) and axes.definition_name and axes.definition_name != config.definition_name:
            raise ValueError(
                f"Profile mismatch: axes has definition '{axes.definition_name}', "
                f"expected '{config.definition_name}'"
            )
        axis_defs = config.axes
    else:
        axis_defs = config

    vals = axes.values if isinstance(axes, Axes) else axes
    config_map = {a.id: a for a in axis_defs}

    for k, v in vals.items():
        if k not in config_map:
            raise ValueError(
                f"Unknown axis '{k}'"
            )
        axis_def = config_map[k]
        if v is not None and v not in axis_def.options:
            raise ValueError(
                f"Invalid value '{v}' for axis '{k}'. Allowed: {axis_def.options}"
            )

    if complete:
        for axis_def in axis_defs:
            if not axis_def.allow_empty:
                val = vals.get(axis_def.id)
                if val is None or val == "":
                    raise ValueError(
                        f"Required axis '{axis_def.id}' cannot be empty for completion"
                    )

