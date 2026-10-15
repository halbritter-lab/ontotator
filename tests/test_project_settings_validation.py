"""Project policy validation without database access."""

from datetime import UTC, datetime

import pytest

from ontocurator.domain.errors import DomainError
from ontocurator.exchange.t1 import Pin
from ontocurator.ontology.store import OntologyFile


def profile():
    from ontocurator.domain.profile_templates import PROFILE_TEMPLATES

    return PROFILE_TEMPLATES["hpo-phenotype"](
        OntologyFile(
            "a" * 64, "ontology", "hp", "2026-01", "hp.json", None, datetime.now(UTC)
        )
    )


def test_template_binds_the_actual_uploaded_ontology():
    result = profile()
    assert result.layers[0].ontology_id == "HP"
    assert result.ontologies[0].sha256 == "a" * 64
    assert result.ontologies[0].release == "2026-01"
    assert {axis.id for axis in result.layers[0].annotation_types[0].axes} == {
        "assertion",
        "experiencer",
        "temporality",
    }


def test_defaults_come_from_t1_and_generic_has_no_inferred_default():
    from ontocurator.projects.service import axis_defaults

    result = profile()
    assert axis_defaults(result, {"HP": Pin("a" * 64, (), "hpo-phenotype")}) == {
        "hpo-layer": {
            "assertion": "present",
            "experiencer": "patient",
            "temporality": "current",
        }
    }
    assert axis_defaults(result, {"HP": Pin("a" * 64, (), "generic")}) == {}


@pytest.mark.parametrize(
    "hidden",
    [
        {"missing": {"assertion": ["absent"]}},
        {"hpo-layer": {"assertion": ["invented"]}},
        {"hpo-layer": {"assertion": ["present"]}},
    ],
)
def test_hidden_values_must_exist_and_not_be_the_default(hidden):
    from ontocurator.projects.service import validate_hidden_values

    with pytest.raises(DomainError) as error:
        validate_hidden_values(
            profile(), {"HP": Pin("a" * 64, (), "hpo-phenotype")}, hidden
        )
    assert error.value.code == "SETTINGS_INVALID"
    assert error.value.details["path"]


def test_hidden_validation_does_not_mutate_the_profile():
    from ontocurator.projects.service import validate_hidden_values

    result = profile()
    before = result.model_dump()
    validate_hidden_values(
        result,
        {"HP": Pin("a" * 64, (), "hpo-phenotype")},
        {"hpo-layer": {"assertion": ["absent"]}},
    )
    assert result.model_dump() == before


@pytest.mark.parametrize(
    "url,version",
    [
        ("file:///g", "v1"),
        ("http://[", "v1"),
        ("https://example.org", None),
        (None, "v1"),
        ("https://example.org", "v" * 65),
    ],
)
def test_guidelines_require_a_complete_http_reference(url, version):
    from ontocurator.projects.service import validate_guideline

    with pytest.raises(DomainError) as error:
        validate_guideline(url, version)
    assert error.value.code == "GUIDELINE_INCOMPLETE"
