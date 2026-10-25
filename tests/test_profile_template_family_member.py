"""The experiencer value ``family_member`` in the standard profiles (spec M7)."""

import json
from datetime import UTC, datetime
from pathlib import Path

from ontocurator.domain.profile_templates import PROFILE_TEMPLATES
from ontocurator.domain.profiles import TaskProfile
from ontocurator.exchange.t1 import Pin, check_t1_profile
from ontocurator.ontology.store import OntologyFile
from ontocurator.projects.service import clinical_creation_defaults

EXPERIENCER = ["patient", "family_member", "other"]
T5_PROFILE = Path(__file__).parents[1] / "examples" / "t5-acceptance" / "profile.json"


def template() -> TaskProfile:
    return PROFILE_TEMPLATES["hpo-phenotype"](
        OntologyFile(
            "a" * 64, "ontology", "hp", "2026-01", "hp.json", None, datetime.now(UTC)
        )
    )


def experiencer_options(profile: TaskProfile) -> list[str]:
    axes = profile.layers[0].annotation_types[0].axes
    return next(axis.options for axis in axes if axis.id == "experiencer")


def test_template_lists_family_member_between_patient_and_other() -> None:
    assert experiencer_options(template()) == EXPERIENCER


def test_creation_default_stays_patient() -> None:
    defaults = clinical_creation_defaults(template(), {})
    assert defaults["hpo-layer"]["phenotype"]["experiencer"] == "patient"


def test_template_is_a_t1_hpo_profile() -> None:
    profile = template()
    pins = {
        o.ontology_id: Pin(sha256="x", t1_profile="hpo-phenotype")
        for o in profile.ontologies
    }
    check_t1_profile(profile, pins)


def test_t5_seed_profile_lists_family_member() -> None:
    profile = TaskProfile.model_validate(
        json.loads(T5_PROFILE.read_text(encoding="utf-8"))
    )
    assert experiencer_options(profile) == EXPERIENCER
