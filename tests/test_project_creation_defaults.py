"""Clinical creation defaults on new projects and pruning on structure changes."""

import copy
from datetime import UTC, datetime

from auth_harness import logged_in
from test_projects_api import create_project

from ontotator.domain.profile_templates import PROFILE_TEMPLATES
from ontotator.domain.profiles import TaskProfile
from ontotator.ontology.store import OntologyFile

pytest_plugins = ("test_projects_api",)

CLINICAL = {"assertion": "present", "experiencer": "patient", "temporality": "current"}


def template() -> TaskProfile:
    return PROFILE_TEMPLATES["hpo-phenotype"](
        OntologyFile(
            "a" * 64, "ontology", "hp", "2026-01", "hp.json", None, datetime.now(UTC)
        )
    )


def without_axis(profile: TaskProfile, axis_id: str) -> TaskProfile:
    data = profile.model_dump(mode="json")
    kind = data["layers"][0]["annotation_types"][0]
    kind["axes"] = [axis for axis in kind["axes"] if axis["id"] != axis_id]
    return TaskProfile.model_validate(data)


def test_standard_profile_gets_the_clinical_defaults_per_editable_type():
    from ontotator.projects.service import clinical_creation_defaults

    assert clinical_creation_defaults(template(), {}) == {
        "hpo-layer": {"phenotype": CLINICAL}
    }


def test_a_type_without_temporality_gets_only_the_other_two():
    from ontotator.projects.service import clinical_creation_defaults

    assert clinical_creation_defaults(without_axis(template(), "temporality"), {}) == {
        "hpo-layer": {"phenotype": {"assertion": "present", "experiencer": "patient"}}
    }


def test_hidden_or_unknown_values_and_reference_layers_are_skipped():
    from ontotator.projects.service import clinical_creation_defaults

    data = template().model_dump(mode="json")
    axes = data["layers"][0]["annotation_types"][0]["axes"]
    axes[1]["options"] = ["other"]  # experiencer without "patient"
    reference = copy.deepcopy(data["layers"][0])
    reference.update(layer_id="reference", label="Reference", access="reference")
    data["layers"].append(reference)
    profile = TaskProfile.model_validate(data)
    hidden = {"hpo-layer": {"temporality": ["current"]}}
    assert clinical_creation_defaults(profile, hidden) == {
        "hpo-layer": {"phenotype": {"assertion": "present"}}
    }


def test_prune_keeps_valid_entries_and_drops_empty_types_and_layers():
    from ontotator.projects.service import prune_creation_defaults

    defaults = {
        "hpo-layer": {
            "phenotype": {**CLINICAL, "invented": "x"},
            "gone": {"assertion": "present"},
        },
        "missing-layer": {"phenotype": {"assertion": "present"}},
    }
    hidden = {"hpo-layer": {"assertion": ["present"]}}
    assert prune_creation_defaults(
        without_axis(template(), "temporality"), defaults, hidden
    ) == {"hpo-layer": {"phenotype": {"experiencer": "patient"}}}


def test_new_project_starts_with_the_clinical_defaults(app):
    admin = logged_in(app, "root", system_admin=True)
    created = create_project(app, admin)
    assert created["creation_defaults"] == {"hpo-layer": {"phenotype": CLINICAL}}
    assert app.state.repo.get_project_rules("phenotypes").creation_defaults == {
        "hpo-layer": {"phenotype": CLINICAL}
    }


def test_existing_projects_keep_their_stored_defaults(app):
    admin = logged_in(app, "root", system_admin=True)
    create_project(app, admin)
    cleared = admin.patch(
        "/api/v1/projects/phenotypes/settings", json={"creation_defaults": {}}
    )
    assert cleared.status_code == 200, cleared.text
    renamed = admin.patch(
        "/api/v1/projects/phenotypes/settings", json={"name": "Renamed"}
    )
    assert renamed.json()["creation_defaults"] == {}
    assert (
        admin.get("/api/v1/projects/phenotypes/settings").json()["creation_defaults"]
        == {}
    )


def test_profile_change_before_work_prunes_defaults_instead_of_refusing(app):
    admin = logged_in(app, "root", system_admin=True)
    created = create_project(app, admin)
    profile = copy.deepcopy(created["profile"])
    kind = profile["layers"][0]["annotation_types"][0]
    kind["axes"] = [axis for axis in kind["axes"] if axis["id"] != "temporality"]
    assertion = next(axis for axis in kind["axes"] if axis["id"] == "assertion")
    assertion["options"] = ["absent", "uncertain"]
    changed = admin.put("/api/v1/projects/phenotypes/profile", json=profile)
    assert changed.status_code == 200, changed.text
    assert changed.json()["creation_defaults"] == {
        "hpo-layer": {"phenotype": {"experiencer": "patient"}}
    }
    assert app.state.repo.get_project_rules("phenotypes").creation_defaults == {
        "hpo-layer": {"phenotype": {"experiencer": "patient"}}
    }


def test_pin_change_before_work_keeps_still_valid_defaults(app):
    admin = logged_in(app, "root", system_admin=True)
    created = create_project(app, admin)
    pins = [
        {
            "ontology_id": pin["ontology_id"],
            "sha256": pin["sha256"],
            "t1_profile": pin["t1_profile"],
        }
        for pin in created["pins"]
    ]
    changed = admin.put("/api/v1/projects/phenotypes/pins", json=pins)
    assert changed.status_code == 200, changed.text
    assert changed.json()["creation_defaults"] == {"hpo-layer": {"phenotype": CLINICAL}}
