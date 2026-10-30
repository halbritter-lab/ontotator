"""``hp`` and ``HP`` name the same ontology (#189).

The built-in HPO template spells the id ``HP``; ontospan bundles and the
uploaded HPO release spell it ``hp``. Projects made from the template take
such bundles, and their profile can be replaced by one that spells it ``hp``.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import ontospan
import pytest
from auth_harness import logged_in
from pg_harness import database_for
from sqlalchemy import select
from t1_fixtures import (
    ADMIN_ACCESS,
    HP_PATH,
    OPERATOR,
    PIN,
    annotation,
    bundle,
    run_import,
    unit,
)
from test_projects_api import create_project as create_api_project

from ontotator.authz.scoped import ScopedRepository
from ontotator.domain.profile_templates import PROFILE_TEMPLATES
from ontotator.domain.profiles import TaskProfile
from ontotator.exchange.plan import read_t1_upload
from ontotator.exchange.t1 import explain_pin_differences, layers_for
from ontotator.ontology.registry import OntologyRegistry
from ontotator.ontology.store import OntologyStore
from ontotator.storage.database import Database
from ontotator.storage.repository import Repository
from ontotator.storage.tables import DocumentRow, ProjectOntologyRow


def _template_project(db: Database) -> TaskProfile:
    stored = OntologyStore(db, OntologyRegistry(), db.data_dir).add(
        OPERATOR, HP_PATH.name, HP_PATH.read_bytes()
    )
    profile = PROFILE_TEMPLATES["hpo-phenotype"](stored)
    ScopedRepository(db, ADMIN_ACCESS, OPERATOR).create_project(
        "proj", "Project", None, profile, {"HP": PIN}
    )
    return profile


def _lower_case_unit(profile: TaskProfile) -> ontospan.AnnotatedDocument:
    """A bundle unit for the template's layer that spells the ontology ``hp``."""
    layer: dict[str, Any] = layers_for(profile, {"HP": PIN})[0].model_dump(mode="json")
    layer["ontology"]["id"] = "hp"
    found = [annotation("p1", (6, 19)), annotation("p2", (63, 76))]
    for item in found:
        item["layer_id"] = "hpo-layer"
    return unit(layer_data=[layer], annotations=found)


@pytest.fixture
def db(tmp_path: Path) -> Database:
    return database_for(tmp_path / "editor.db")


def test_a_template_project_imports_a_bundle_that_spells_hp(
    db: Database, tmp_path: Path
) -> None:
    profile = _template_project(db)

    job = run_import(db, bundle(tmp_path / "b.zip", [_lower_case_unit(profile)]))

    assert job.status == "succeeded", job.error
    with db.transaction() as conn:
        assert conn.execute(select(DocumentRow.document_id)).scalars().all() == [
            "EN100017"
        ]


def test_the_terms_of_such_a_bundle_are_checked_against_the_pinned_file(
    db: Database, tmp_path: Path
) -> None:
    profile = _template_project(db)
    pins = Repository(db).project_pins("proj")
    path = bundle(tmp_path / "b.zip", [_lower_case_unit(profile)])

    _, issues = read_t1_upload(
        path,
        pins,
        profile,
        ontologies={"HP": ontospan.ObographOntology.load(HP_PATH)},
    )

    assert [i.code for i in issues if i.severity == "error"] == []
    assert "hierarchy_not_checked" not in {i.code for i in issues}


def test_another_ontology_is_named_in_plain_words() -> None:
    message = explain_pin_differences(
        [
            {
                "layer_id": "hpo-layer",
                "field": "ontology",
                "expected": "HP",
                "found": "mondo",
            }
        ]
    )

    assert "{" not in message
    assert "the bundle uses the ontology mondo, this project uses HP" in message
    assert "ask an administrator" in message


def test_the_profile_of_a_template_project_can_be_replaced_by_one_spelling_hp(
    tmp_path: Path,
) -> None:
    from test_auth_api import _app

    app = _app(tmp_path)
    admin = logged_in(app, "root", system_admin=True)
    project = create_api_project(app, admin)
    profile = project["profile"]
    profile["ontologies"][0]["ontology_id"] = "hp"
    profile["layers"][0]["ontology_id"] = "hp"
    lead = logged_in(app, "lead", projects={"phenotypes": ["lead"]})

    result = lead.put("/api/v1/projects/phenotypes/profile", json=profile)

    assert result.status_code == 200, result.text
    assert [pin["ontology_id"] for pin in result.json()["pins"]] == ["hp"]
    with app.state.repo.db.transaction() as conn:
        assert conn.execute(select(ProjectOntologyRow.ontology_id)).scalars().all() == [
            "hp"
        ]
