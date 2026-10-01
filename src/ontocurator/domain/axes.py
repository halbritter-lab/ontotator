from typing import Literal

from pydantic import BaseModel, ConfigDict

AssertionType = Literal["present", "absent", "uncertain"]
ExperiencerType = Literal["patient", "other"]
TemporalityType = Literal["current", "historical", "future"]


class Axes(BaseModel):
    """Clinical axes associated with an annotation."""

    model_config = ConfigDict(extra="forbid")

    definition_name: Literal["editor-axes/v1"] = "editor-axes/v1"
    assertion: AssertionType | None = None
    experiencer: ExperiencerType | None = None
    temporality: TemporalityType | None = None
