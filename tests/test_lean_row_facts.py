"""Lean ``load_facts`` scopes: the navigation counter and the final panel read
only the facts their answers depend on, with the same results as the full
facts the Documents table reads."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from browser_overview_scenarios import BUILDERS, register_overview_scenario_route
from browser_server import ONTOLOGY
from fastapi.testclient import TestClient
from pg_harness import database_url_for
from sqlalchemy import select

from ontotator.api.app import create_app
from ontotator.application import document_row_panel
from ontotator.application.document_row_page import needs_decision
from ontotator.application.document_rows import load_facts
from ontotator.auth.audit import Actor
from ontotator.authz.policy import Access
from ontotator.authz.scoped import ScopedRepository
from ontotator.config import AppConfig
from ontotator.storage.tables import DocumentRow, ProjectRow, UserRow

# Rows with finals, text changes, source changes, reviews and reports.
SCENARIOS = ["S3", "S6", "S9", "S12", "S15", "WALKTHROUGH"]


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    app = create_app(
        AppConfig(
            workspace_dir=tmp_path,
            database_url=database_url_for(tmp_path / "lean.db"),
            ontology_paths=[ONTOLOGY],
        )
    )
    register_overview_scenario_route(app)
    with TestClient(app) as client:
        yield client


@pytest.mark.parametrize("scenario", SCENARIOS)
def test_lean_scopes_answer_like_the_full_facts(client, scenario) -> None:
    assert scenario in BUILDERS
    response = client.post("/__test_overview__", params={"scenario": scenario})
    assert response.status_code == 200, response.text
    built: dict[str, Any] = response.json()
    key = built["project"]
    db = client.app.state.repo.db  # type: ignore[attr-defined]
    with db.transaction() as conn:
        pid = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == key)
        ).scalar_one()
        lead = conn.execute(
            select(UserRow.id, UserRow.pseudonym).where(
                UserRow.username == built["users"]["lead"]
            )
        ).one()
        rows = sorted(
            set(
                conn.execute(
                    select(DocumentRow.case_id, DocumentRow.language).where(
                        DocumentRow.project_id == pid
                    )
                ).all()
            )
        )
        access = Access(lead.id, lead.pseudonym, False, {key: frozenset({"lead"})})
        repo = ScopedRepository(db, access, Actor(lead.id, "user:lead"))
        full = load_facts(conn, repo, key, pid, lead.id)
        summary = load_facts(conn, repo, key, pid, lead.id, scope="summary")
        panel = load_facts(conn, repo, key, pid, lead.id, scope="panel")
        assert needs_decision(summary) == needs_decision(full)
        for case_id, language in rows:
            assert document_row_panel.final_panel(
                conn, panel, key, case_id, language
            ) == document_row_panel.final_panel(conn, full, key, case_id, language)
