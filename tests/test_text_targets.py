"""The text of a document and the text's target document (plan P3, R11)."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from browser_documents_scenarios import (
    SYNTHETIC,
    SYNTHETIC_DE,
    Scenario,
    add_user,
    identity,
    import_texts,
    new_project,
)
from browser_server import ONTOLOGY
from fastapi.testclient import TestClient
from pg_harness import database_url_for
from sqlalchemy import insert, select
from test_text_change_service import _env

from ontotator.api.app import create_app
from ontotator.application.text_changes import TextChangeService
from ontotator.application.text_targets import (
    TextRow,
    text_documents,
    text_row,
    text_target_document,
)
from ontotator.config import AppConfig
from ontotator.storage.plan_tables import DiscardedVariantRow
from ontotator.storage.repository import Repository
from ontotator.storage.tables import ProjectRow

CASE = "case-0007"


@pytest.fixture
def app(tmp_path: Path) -> Iterator[Any]:
    # One database per test; the job worker runs the corrections' children.
    application = create_app(
        AppConfig(
            workspace_dir=tmp_path,
            database_url=database_url_for(tmp_path / "text-targets.db"),
            ontology_paths=[ONTOLOGY],
        )
    )
    with TestClient(application):
        yield application


def _pid(scenario: Scenario) -> int:
    with scenario.db.transaction() as conn:
        return int(
            conn.execute(
                select(ProjectRow.id).where(ProjectRow.project_key == scenario.key)
            ).scalar_one()
        )


def _facts(scenario: Scenario, document_id: str) -> tuple[TextRow, list[str], str]:
    pid = _pid(scenario)
    with scenario.db.transaction() as conn:
        row = text_row(conn, pid, document_id)
        return (
            row,
            text_documents(conn, pid, row),
            text_target_document(conn, pid, row),
        )


def _translation(app: Any, *, roots: int = 1) -> tuple[Scenario, dict[Any, str]]:
    """English source, German translation v1 and its correction v2; with
    ``roots=2`` a second German root (b) with its own correction."""
    from t1_builders import correction_unit, native_unit, translation_unit

    scenario = new_project(app, "targets")
    source = native_unit(CASE, "en", SYNTHETIC, case_id=CASE)
    first = translation_unit(
        f"{CASE}-a", "de", SYNTHETIC_DE, source=source, provider="A", run_id="a"
    )
    units = [source, first, correction_unit(first, f"{SYNTHETIC_DE} Korrektur.")]
    if roots == 2:
        other = translation_unit(
            f"{CASE}-b",
            "de",
            f"{SYNTHETIC_DE} (b)",
            source=source,
            provider="B",
            run_id="b",
        )
        units += [other, correction_unit(other, f"{SYNTHETIC_DE} (b) Korrektur.")]
    docs = import_texts(scenario, units)
    add_user(scenario, "lead", ["lead"])
    return scenario, docs


def test_native_text_with_one_version(app):
    from t1_builders import native_unit

    scenario = new_project(app, "native")
    docs = import_texts(scenario, [native_unit(CASE, "en", SYNTHETIC, case_id=CASE)])
    document_id = docs[(CASE, "en", 1)]
    assert _facts(scenario, document_id) == (
        TextRow(CASE, "en"),
        [document_id],
        document_id,
    )


def test_translation_targets_its_newest_version(app):
    scenario, docs = _translation(app)
    v1, v2 = docs[(f"{CASE}-a", "de", 1)], docs[(f"{CASE}-a", "de", 2)]
    for document_id in (v1, v2):
        assert _facts(scenario, document_id) == (TextRow(CASE, "de"), [v1, v2], v2)


def test_a_discarded_version_is_never_the_target(app):
    scenario, docs = _translation(app, roots=2)
    kept = docs[(f"{CASE}-a", "de", 2)]
    dropped = [docs[(f"{CASE}-b", "de", v)] for v in (1, 2)]
    lead, _actor = identity(scenario, "lead")
    with scenario.db.transaction() as conn:
        conn.execute(
            insert(DiscardedVariantRow).values(
                project_id=_pid(scenario),
                document_id=dropped[0],
                reason="test",
                discarded_by=lead.user_id,
            )
        )
    _row, documents, target = _facts(scenario, dropped[1])
    assert set(dropped) <= set(documents)
    assert target == kept


def test_equals_the_text_change_target(app):
    env = _env(app)
    service = TextChangeService(env.db, Repository(env.db))
    pid = _pid(env.scenario)
    with env.db.transaction() as conn:
        for document_id in env.docs:
            row = text_row(conn, pid, document_id)
            assert text_target_document(conn, pid, row) == service.current_target(
                conn, env.key, pid, document_id
            )
