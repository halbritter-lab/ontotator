"""The values browser scenarios build what the Values block browser tests
expect: fresh projects whose profile carries exactly the scenario's axes."""

from collections.abc import Iterator
from pathlib import Path
from time import monotonic
from typing import Any

import pytest
from browser_server import ONTOLOGY
from browser_values_scenarios import BUILDERS, register_values_scenario_route
from fastapi.testclient import TestClient
from pg_harness import database_url_for
from test_browser_review_flow_fixture import Session

from ontocurator.api.app import create_app
from ontocurator.config import AppConfig
from ontocurator.domain.axes import STANDARD_CLINICAL_AXES

# Every scenario builds well inside the browser helper's timeout.
BUILD_SECONDS = 30


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    app = create_app(
        AppConfig(
            workspace_dir=tmp_path,
            database_url=database_url_for(tmp_path / "editor.db"),
            ontology_paths=[ONTOLOGY],
        )
    )
    register_values_scenario_route(app)
    # The context starts the server's job worker; scenario imports need it.
    with TestClient(app) as client:
        yield client


def scenario(client: TestClient, name: str) -> dict[str, Any]:
    started = monotonic()
    response = client.post("/__test_values__", params={"scenario": name})
    elapsed = monotonic() - started
    assert response.status_code == 200, response.text
    assert elapsed < BUILD_SECONDS, f"{name} took {elapsed:.1f} s"
    body: dict[str, Any] = response.json()
    assert body["project"].startswith(f"values-{name.lower().replace('_', '-')}-")
    assert set(body["users"]) == {"lead", "ana", "ben", "annotator"}
    return body


def annotator_view(client: TestClient, built: dict[str, Any]) -> dict[str, Any]:
    """The annotator's only task: its assignment id is the scenario's, and the
    opened workspace view."""
    session = Session(client, built["users"]["annotator"])
    tasks = session.tasks(built["project"])
    assert [t["task"] for t in tasks] == ["annotate"]
    assert [t["assignment_id"] for t in tasks] == list(built["assignments"].values())
    metadata = session.get(f"/api/v1/assignments/{tasks[0]['assignment_id']}")
    assert metadata["username"] == built["users"]["annotator"]
    return session.open_task(tasks[0])


def test_registry_has_two_scenarios_and_unknown_is_404(client):
    assert set(BUILDERS) == {"VALUES_STANDARD", "VALUES_LONG"}
    response = client.post("/__test_values__", params={"scenario": "S99"})
    assert response.status_code == 404


def test_values_standard_builds(client):
    built = scenario(client, "VALUES_STANDARD")
    assert built["texts"] == {"values": "The patient has a seizure and hypotonia."}
    view = annotator_view(client, built)
    axes = view["axes_config"]
    assert [axis["id"] for axis in axes] == ["assertion", "experiencer", "temporality"]
    assert axes == [axis.model_dump() for axis in STANDARD_CLINICAL_AXES]
    assert view["creation_defaults"]["hpo"]["phenotype"] == {
        "assertion": "present",
        "experiencer": "patient",
        "temporality": "current",
    }


def test_values_long_builds(client):
    built = scenario(client, "VALUES_LONG")
    view = annotator_view(client, built)
    axes = {axis["id"]: axis for axis in view["axes_config"]}
    assert list(axes) == ["assertion", "certainty"]
    assert axes["certainty"]["label"] == "Diagnostic certainty"
    assert axes["certainty"]["options"] == [
        "confirmed_by_genetic_testing",
        "clinically_suspected_only",
        "excluded_after_workup",
    ]
    assert view["creation_defaults"]["hpo"]["phenotype"] == {
        "assertion": "present",
        "certainty": "clinically_suspected_only",
    }


def test_projects_are_fresh(client):
    first = scenario(client, "VALUES_STANDARD")
    second = scenario(client, "VALUES_STANDARD")
    assert first["project"] != second["project"]


def test_values_pin_is_generic(client):
    repo = client.app.state.repo  # type: ignore[attr-defined]
    for name in BUILDERS:
        built = scenario(client, name)
        assert repo.project_pins(built["project"])["hp"].t1_profile == "generic"
