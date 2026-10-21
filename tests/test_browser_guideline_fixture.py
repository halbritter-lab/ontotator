"""The guideline browser scenarios build what the guideline specs expect."""

from collections.abc import Iterator
from pathlib import Path
from time import monotonic
from typing import Any

import pytest
from browser_documents_scenarios import Scenario, identity
from browser_guideline_scenarios import BUILDERS, register_guideline_scenario_route
from browser_server import ONTOLOGY
from fastapi.testclient import TestClient
from pg_harness import database_url_for

from ontocurator.api.app import create_app
from ontocurator.application.guidelines import GuidelineService
from ontocurator.config import AppConfig
from ontocurator.domain.guidelines import MAX_GUIDELINE_BYTES

# Every scenario builds well inside the browser helper's timeout.
BUILD_SECONDS = 30
PEOPLE = {"lead": "Project Lead", "ana": "Ana Weber", "ben": "Ben Roth"}
FILES = {"v1.md", "v2.md", "big.txt", "bad.pdf"}
ASSIGNMENTS = {"annotate-1", "annotate-2", "review-de"}


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    app = create_app(
        AppConfig(
            workspace_dir=tmp_path,
            database_url=database_url_for(tmp_path / "editor.db"),
            ontology_paths=[ONTOLOGY],
        )
    )
    register_guideline_scenario_route(app)
    # The context starts the server's job worker; scenario imports need it.
    with TestClient(app) as client:
        yield client


def scenario(client: TestClient, name: str) -> dict[str, Any]:
    started = monotonic()
    response = client.post("/__test_guidelines__", params={"scenario": name})
    elapsed = monotonic() - started
    assert response.status_code == 200, response.text
    assert elapsed < BUILD_SECONDS, f"{name} took {elapsed:.1f} s"
    body: dict[str, Any] = response.json()
    assert body["project"].startswith(f"guide-{name.lower()}-")
    assert body["users"].keys() == PEOPLE.keys()
    assert body["display_names"] == PEOPLE
    assert set(body["assignments"]) == ASSIGNMENTS
    assert set(body["files"]) == FILES
    return body


def listing(client: TestClient, built: dict[str, Any], name: str) -> Any:
    found = Scenario(client.app, built["project"], dict(built["users"]))  # type: ignore[arg-type]
    access, _actor = identity(found, name)
    return GuidelineService(found.db).listing(access, built["project"])


def my_tasks(client: TestClient, built: dict[str, Any], name: str) -> list[int]:
    from sqlalchemy import select

    from ontocurator.storage.tables import AssignmentRow

    user = client.app.state.accounts.get_by_username(built["users"][name])  # type: ignore[attr-defined]
    with client.app.state.repo.db.transaction() as conn:  # type: ignore[attr-defined]
        return sorted(
            conn.execute(
                select(AssignmentRow.id).where(AssignmentRow.user_id == user.id)
            ).scalars()
        )


def test_registry_and_unknown_is_404(client):
    assert set(BUILDERS) == {"EMPTY", "PUBLISHED"}
    response = client.post("/__test_guidelines__", params={"scenario": "NOPE"})
    assert response.status_code == 404


def test_empty_builds(client):
    built = scenario(client, "EMPTY")
    assignments = built["assignments"]
    assert my_tasks(client, built, "ana") == sorted(
        [assignments["annotate-1"], assignments["annotate-2"]]
    )
    assert my_tasks(client, built, "ben") == [assignments["review-de"]]
    files = {name: Path(path) for name, path in built["files"].items()}
    assert all(path.is_absolute() and path.is_file() for path in files.values())
    v1 = files["v1.md"].read_text(encoding="utf-8")
    for needle in ("# ", "| --- |", "<script>", "javascript:", "!["):
        assert needle in v1
    assert files["v2.md"].read_text(encoding="utf-8") != v1
    assert files["big.txt"].stat().st_size > MAX_GUIDELINE_BYTES
    current = listing(client, built, "lead")
    assert current.versions == []
    assert current.current is None


def test_published_builds(client):
    built = scenario(client, "PUBLISHED")
    lead_view = listing(client, built, "lead")
    (v1,) = lead_view.versions
    assert v1.version == 1
    assert v1.filename == "v1.md"
    assert v1.change_note == "First version"
    assert lead_view.current is not None
    assert lead_view.current.version == 1
    assert v1.not_seen is not None
    not_seen = {item.person.display_name for item in v1.not_seen}
    assert {"Ana Weber", "Ben Roth"} <= not_seen
    assert listing(client, built, "ana").my_latest_seen is None
