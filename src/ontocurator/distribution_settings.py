"""Mode and identity presets in the format of ``ontocurator-settings.json``.

``serve`` no longer reads such a file: ``AppConfig.distribution`` is always the
default until T2c replaces the presets with project roles. Every key is
optional::

    {
      "default_mode": "independent",
      "allowed_modes": ["independent"],
      "annotator_id": null,
      "open_package": "study-xy-round1",
      "auto_open_browser": true
    }

Precedence: command line flags > this file > saved settings (config.json) >
built-in defaults. An unreadable or invalid file never blocks a start: it is
reported and the defaults are used. Unknown keys are reported and ignored.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, get_args

from pydantic import (
    BaseModel,
    ConfigDict,
    ValidationError,
    field_validator,
    model_validator,
)

from ontocurator.application.preferences import normalize_annotator_id
from ontocurator.domain.workspace import WorkspaceMode

SETTINGS_FILENAME = "ontocurator-settings.json"
ALL_MODES: tuple[WorkspaceMode, ...] = get_args(WorkspaceMode)


class DistributionSettings(BaseModel):
    """Validated content of ``ontocurator-settings.json`` (all keys optional)."""

    model_config = ConfigDict(extra="forbid")

    default_mode: WorkspaceMode | None = None
    allowed_modes: list[WorkspaceMode] | None = None
    annotator_id: str | None = None
    open_package: str | None = None
    auto_open_browser: bool | None = None

    @field_validator("allowed_modes")
    @classmethod
    def _unique_non_empty(
        cls, value: list[WorkspaceMode] | None
    ) -> list[WorkspaceMode] | None:
        if value is None:
            return None
        if not value:
            raise ValueError("must name at least one mode")
        return list(dict.fromkeys(value))

    @field_validator("annotator_id")
    @classmethod
    def _valid_identity(cls, value: str | None) -> str | None:
        return None if value is None else normalize_annotator_id(value)

    @field_validator("open_package")
    @classmethod
    def _non_empty_package(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not value.strip():
            raise ValueError("must not be empty")
        return value.strip()

    @model_validator(mode="after")
    def _default_is_allowed(self) -> DistributionSettings:
        if (
            self.default_mode is not None
            and self.allowed_modes is not None
            and self.default_mode not in self.allowed_modes
        ):
            raise ValueError(
                f"default_mode '{self.default_mode}' is not one of allowed_modes"
            )
        return self

    def effective_allowed_modes(self) -> list[WorkspaceMode]:
        return list(self.allowed_modes) if self.allowed_modes else list(ALL_MODES)

    def effective_default_mode(self) -> WorkspaceMode:
        if self.default_mode is not None:
            return self.default_mode
        allowed = self.effective_allowed_modes()
        return "independent" if "independent" in allowed else allowed[0]


class EffectiveSettings(BaseModel):
    """Settings the web UI applies (``GET /api/v1/settings``)."""

    model_config = ConfigDict(extra="forbid")

    allowed_modes: list[WorkspaceMode]
    default_mode: WorkspaceMode
    annotator_id: str | None = None
    open_package: str | None = None

    @classmethod
    def from_settings(cls, settings: DistributionSettings) -> EffectiveSettings:
        return cls(
            allowed_modes=settings.effective_allowed_modes(),
            default_mode=settings.effective_default_mode(),
            annotator_id=settings.annotator_id,
            open_package=settings.open_package,
        )


def _describe(exc: ValidationError) -> str:
    return "; ".join(
        f"{'.'.join(map(str, e['loc'])) or 'file'}: {e['msg']}"
        for e in exc.errors(include_url=False, include_context=False)
    )


def parse_settings(data: Any) -> tuple[DistributionSettings, list[str]]:
    """Validate parsed JSON. Unknown keys are dropped and returned as warnings.

    Raises ValueError (with a readable message) for invalid values.
    """
    if not isinstance(data, dict):
        raise ValueError("the file must contain a JSON object")
    known = set(DistributionSettings.model_fields)
    unknown = sorted(str(k) for k in data if k not in known)
    warnings = [
        f"Unknown setting '{key}' in {SETTINGS_FILENAME} is ignored." for key in unknown
    ]
    try:
        settings = DistributionSettings.model_validate(
            {k: v for k, v in data.items() if k in known}
        )
    except ValidationError as exc:
        raise ValueError(_describe(exc)) from exc
    return settings, warnings


def read_settings_file(path: Path) -> tuple[DistributionSettings, list[str]]:
    """Strict variant for build tools: raises ValueError for unusable files."""
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except OSError as exc:
        raise ValueError(f"cannot read {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"{path.name} is not valid JSON: {exc}") from exc
    return parse_settings(data)


def load_settings_file(path: Path) -> tuple[DistributionSettings, list[str]]:
    """Lenient variant for start-up: a missing file means defaults, an invalid
    file is reported and the defaults are used."""
    if not path.is_file():
        return DistributionSettings(), []
    try:
        return read_settings_file(path)
    except ValueError as exc:
        return DistributionSettings(), [
            f"{SETTINGS_FILENAME} is invalid and was ignored ({exc}); "
            "using the defaults."
        ]
