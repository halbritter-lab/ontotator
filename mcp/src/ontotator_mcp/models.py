"""Structured tool arguments, mirroring request bodies of the Ontotator API."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Pin(_Model):
    """One pinned ontology release (``ProjectPin``)."""

    ontology_id: str = Field(description="Ontology ID of the task profile, e.g. 'HP'.")
    sha256: str = Field(
        description="SHA-256 of the uploaded release file (list_ontologies)."
    )
    allowed_roots: list[str] = Field(
        default_factory=list,
        description="Terms below which findings are allowed; empty allows every term.",
    )
    t1_profile: Literal["generic", "hpo-phenotype"] = "generic"


class AssignmentRow(_Model):
    """One text version for one person (``AssignmentRowRequest``)."""

    document_id: str = Field(description="Text version ID (list_texts).")
    username: str = Field(description="Login name of a project member (list_people).")


class TextRef(_Model):
    """One text: a case and a language (``RowRefView``)."""

    case_id: str
    language: str


class PlanChoice(_Model):
    """Work plan flags for one language of an import (``PlanChoice``)."""

    review: bool | None = Field(
        default=None, description="Translation review on or off; None for sources."
    )
    annotate: bool


class CasePlanChoice(PlanChoice):
    """Work plan flags for one text of an import (``CasePlanChoice``)."""

    case_id: str
    language: str


class ExternalReview(_Model):
    """Translations reviewed outside Ontotator, accepted as they are."""

    languages: list[str] = Field(min_length=1)
    reason: str = Field(min_length=1, max_length=2000)


class NewUser(_Model):
    """One account to create (``CreateUserRequest``)."""

    username: str = Field(min_length=1, max_length=256, description="Login name.")
    display_name: str = Field(min_length=1)
    email: str | None = None
    languages: list[str] = Field(
        default_factory=list, description="Working languages, e.g. ['en','de']."
    )
    qualification: str | None = Field(
        default=None,
        max_length=200,
        description="Needed for translation reviewers, e.g. 'MD, native speaker'.",
    )
    roles: list[Literal["lead", "annotator", "adjudicator"]] = Field(
        default_factory=list,
        description=(
            "Roles in the tool's project; empty means annotator. 'adjudicator'"
            " is the consolidator."
        ),
    )
