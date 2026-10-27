"""The documents overview browser scenarios build the plan's "Scenario table"
and the acceptance walkthrough (plan O10a); the act route performs the other
people's steps of the walkthrough through the real services."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from time import monotonic
from typing import Any

import pytest
from browser_documents_scenarios import Scenario, _wait_for_children
from browser_documents_scenarios import select as select_final
from browser_overview_scenarios import (
    BUILDERS,
    CORRECTION_REASON,
    PEOPLE,
    WALKTHROUGH_CASE,
    batch_assign,
    carry_to_author,
    move_to_newest,
    newest,
    open_assignment,
    register_overview_scenario_route,
    request_correction,
    start_consolidation,
)
from browser_server import ONTOLOGY, TEST_PASSWORD, run_fixture_import
from fastapi.testclient import TestClient
from pg_harness import database_url_for

from ontotator.api.app import create_app
from ontotator.config import AppConfig

# Every scenario builds well inside the browser helper's 120 s timeout.
BUILD_SECONDS = 60
ROW_SCENARIOS = [name for name in BUILDERS if name != "WALKTHROUGH"]


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    app = create_app(
        AppConfig(
            workspace_dir=tmp_path,
            database_url=database_url_for(tmp_path / "overview.db"),
            ontology_paths=[ONTOLOGY],
        )
    )
    register_overview_scenario_route(app)
    # The context starts the server's job worker; scenario imports need it.
    with TestClient(app) as client:
        yield client


def build(client: TestClient, name: str) -> dict[str, Any]:
    started = monotonic()
    response = client.post("/__test_overview__", params={"scenario": name})
    elapsed = monotonic() - started
    assert response.status_code == 200, response.text
    assert elapsed < BUILD_SECONDS, f"{name} took {elapsed:.1f} s"
    body: dict[str, Any] = response.json()
    assert body["project"].startswith(f"ovw-{name.lower()}-")
    assert body["display_names"] == PEOPLE
    assert set(body["users"]) == set(PEOPLE)
    assert isinstance(body["assignments"], dict)
    return body


class Lead:
    """The lead's session on the test client."""

    def __init__(self, client: TestClient, built: dict[str, Any]) -> None:
        self.client = client
        self.project = built["project"]
        self.origin = str(client.base_url).rstrip("/")
        client.cookies.clear()
        login = client.post(
            "/api/v1/auth/login",
            json={"username": built["users"]["lead"], "password": TEST_PASSWORD},
            headers={"Origin": self.origin},
        )
        assert login.status_code == 200, login.text
        self.csrf = login.json()["csrf_token"]

    def rows(self) -> dict[tuple[str, str], dict[str, Any]]:
        rows: dict[tuple[str, str], dict[str, Any]] = {}
        page_number = 1
        while True:
            response = self.client.get(
                f"/api/v1/projects/{self.project}/document-rows",
                params={"page": page_number},
            )
            assert response.status_code == 200, response.text
            page = response.json()
            self.bar = page["bar"]
            for group in page["groups"]:
                for row in group["rows"]:
                    rows[(row["case_id"], row["language"])] = row
            if page_number >= page["page_count"]:
                return rows
            page_number += 1

    def row(self, case: str, language: str) -> dict[str, Any]:
        return self.rows()[(case, language)]

    def panel(self, case: str, language: str) -> dict[str, Any]:
        response = self.client.get(
            f"/api/v1/projects/{self.project}/document-rows/{case}/{language}/final-panel"
        )
        assert response.status_code == 200, response.text
        body: dict[str, Any] = response.json()
        return body

    def close(self) -> None:
        self.client.post(
            "/api/v1/auth/logout",
            headers={"Origin": self.origin, "X-CSRF-Token": self.csrf},
        )
        self.client.cookies.clear()


def names(people: list[dict[str, Any]]) -> list[str]:
    return [person["display_name"] for person in people]


def waiting(row: dict[str, Any]) -> str:
    """The Waiting-on column: "You", "—" or the people's names."""
    step = row["next_step"]
    if step is None or step["owner"]["kind"] == "none":
        return "—"
    if step["owner"]["kind"] == "you":
        return "You"
    return ", ".join(names(step["owner"]["people"]))


def action(row: dict[str, Any]) -> str | None:
    step = row["next_step"]
    return None if step is None else step["action"]


@dataclass(frozen=True)
class Expect:
    """One row of the Scenario table: (state, tone) per cell, Waiting on,
    the row action, and detail fields per cell (people as names)."""

    review: tuple[str, str]
    annotation: tuple[str, str]
    final: tuple[str, str]
    waiting: str
    action: str | None
    details: dict[str, dict[str, Any]] = field(default_factory=dict)


ACCEPTED = ("accepted", "done")
NONE = ("none", "none")
SOURCE = ("source", "none")
NOT_PLANNED = ("not_planned", "none")
UNCHANGED = {"note": "unchanged"}
CORRECTED = {"note": "with_corrections", "from_version": 1, "version": 2}
ANA, TOM, LUC = PEOPLE["ana"], PEOPLE["tom"], PEOPLE["luc"]

SCENARIO_TABLE: dict[str, dict[tuple[str, str], Expect]] = {
    "S1": {
        ("case-101", "de"): Expect(
            ("undecided", "undecided"), ("undecided", "undecided"), NONE, "You", "plan"
        ),
        ("case-101", "en"): Expect(SOURCE, NOT_PLANNED, NONE, "—", None),
    },
    "S2": {
        ("case-102", "de"): Expect(
            ("check_failed", "decision"),
            ("after_review", "waiting"),
            NONE,
            "You",
            "assign_translation_review",
        ),
    },
    "S3": {
        ("case-103", "de"): Expect(
            ("in_progress", "running"),
            ("after_review", "waiting"),
            NONE,
            ANA,
            None,
            {"review": {"people": [ANA]}},
        ),
    },
    "S4": {
        ("case-104", "de"): Expect(
            ("rejected", "rejected"),
            ("blocked", "waiting"),
            NONE,
            "You",
            "resolve",
            {
                "review": {"people": [ANA]},
                "annotation": {"note": "translation_rejected"},
            },
        ),
        ("case-104", "fr"): Expect(
            ("query", "decision"),
            ("blocked", "waiting"),
            NONE,
            "You",
            "resolve",
            {
                "review": {"people": [LUC]},
                "annotation": {"note": "translation_queried"},
            },
        ),
    },
    "S5": {
        ("case-105", "de"): Expect(
            ACCEPTED,
            ("unassigned", "todo"),
            NONE,
            "You",
            "assign_annotation",
            {
                "review": {**CORRECTED, "people": [ANA]},
                "annotation": {"assigned": 0, "target": 2},
            },
        ),
    },
    "S6": {
        ("case-106", "de"): Expect(
            ACCEPTED,
            ("in_progress", "running"),
            ("after_annotation", "waiting"),
            TOM,
            None,
            {
                "review": UNCHANGED,
                "annotation": {"people": [TOM], "submitted": 1, "total": 2},
            },
        ),
    },
    "S7a": {
        ("case-107", "de"): Expect(
            ACCEPTED,
            ("submitted", "done"),
            ("choose", "decision"),
            "You",
            "choose_final",
            {
                "review": UNCHANGED,
                "annotation": {"people": [ANA], "findings": 3},
                "final": {"submitted": 1},
            },
        ),
    },
    "S7b": {
        ("case-107", "en"): Expect(
            SOURCE,
            ("submitted", "done"),
            ("choose", "decision"),
            "You",
            "choose_final",
            {
                "annotation": {"people": [ANA, TOM], "submitted": 2, "total": 2},
                "final": {"submitted": 2},
            },
        ),
    },
    "S8": {
        ("case-108", "de"): Expect(
            ACCEPTED,
            ("consolidating", "running"),
            ("after_review", "waiting"),
            LUC,
            None,
            {"annotation": {"people": [LUC]}},
        ),
    },
    "S9": {
        ("case-109", "de"): Expect(
            ACCEPTED,
            ("paused", "decision"),
            NONE,
            "You",
            "decide_report",
            {"annotation": {"people": [TOM]}},
        ),
    },
    "S10": {
        ("case-110", "de"): Expect(
            ACCEPTED,
            NOT_PLANNED,
            NONE,
            "—",
            None,
            {"review": UNCHANGED, "annotation": {"note": "review_only"}},
        ),
    },
    "S11": {
        ("case-111", "de"): Expect(
            ACCEPTED,
            ("submitted", "done"),
            ("final", "done"),
            "—",
            None,
            {
                "annotation": {"people": [ANA, TOM], "submitted": 2, "total": 2},
                "final": {"note": "round", "round_ordinal": 1, "people": [ANA]},
            },
        ),
        # Table: "✓ submitted" (per text 1); "Annotations per text" is a
        # project setting and de needs 2, so fr shows "2 of 2 submitted".
        ("case-111", "fr"): Expect(
            ACCEPTED,
            ("submitted", "done"),
            ("final", "done"),
            "—",
            None,
            {
                "annotation": {"submitted": 2, "total": 2},
                "final": {"note": "consolidation", "people": [LUC]},
            },
        ),
        ("case-111", "en"): Expect(SOURCE, NOT_PLANNED, NONE, "—", None),
    },
    "S12": {
        ("case-112", "de"): Expect(
            ACCEPTED,
            ("old_text_open", "decision"),
            NONE,
            "You",
            "handle_text_change",
            {
                "review": {**CORRECTED, "people": [ANA]},
                "annotation": {"people": [TOM], "from_version": 1, "version": 2},
            },
        ),
    },
    "S13": {
        ("case-113", "de"): Expect(
            ACCEPTED,
            ("old_text_submitted", "decision"),
            ("after_annotation", "waiting"),
            "You",
            "carry_text_change",
            {
                "review": {**CORRECTED, "people": [ANA]},
                "annotation": {
                    "people": [ANA],
                    "from_version": 1,
                    "note": "v2_not_annotated",
                },
            },
        ),
    },
    "S14": {
        ("case-114", "de"): Expect(
            ACCEPTED,
            ("submitted", "done"),
            ("old_text", "decision"),
            "You",
            "review_changes",
            {
                "review": {**CORRECTED, "people": [ANA]},
                "annotation": {"version": 1},
                "final": {"round_ordinal": 1, "people": [ANA], "version": 1},
            },
        ),
    },
    "S15": {
        ("case-115", "en"): Expect(SOURCE, NOT_PLANNED, NONE, "—", None),
        ("case-115", "de"): Expect(
            ("source_changed", "decision"),
            ("submitted", "done"),
            ("may_be_outdated", "waiting"),
            "You",
            "assign_source_review",
            {
                "review": {"from_version": 1},
                "annotation": {"version": 1},
                "final": {"note": "source_changed"},
            },
        ),
    },
    "S16": {
        ("case-116", "de"): Expect(
            ("re_review", "running"),
            ("in_progress", "running"),
            NONE,
            f"{ANA}, {TOM}",
            None,
            {
                "review": {
                    "people": [ANA],
                    "note": "correction",
                    "reason": CORRECTION_REASON,
                },
                "annotation": {"people": [TOM], "note": "may_change", "version": 1},
            },
        ),
    },
}
# The Text cell's marker "v2 corrected" (scenarios 12 to 15).
MARKERS = {
    ("S12", "case-112", "de"): {"kind": "corrected", "version": 2},
    ("S13", "case-113", "de"): {"kind": "corrected", "version": 2},
    ("S14", "case-114", "de"): {"kind": "corrected", "version": 2},
    ("S15", "case-115", "en"): {"kind": "corrected", "version": 2},
}


def cell_detail(cell: dict[str, Any], expected: dict[str, Any]) -> dict[str, Any]:
    """The cell detail's ``expected`` keys, people as display names."""
    detail = cell["detail"]
    return {
        key: names(detail[key]) if key == "people" else detail[key] for key in expected
    }


def test_registry_and_unknown_names(client):
    assert set(BUILDERS) == {
        *(f"S{n}" for n in range(1, 17) if n != 7),
        "S7a",
        "S7b",
        "WALKTHROUGH",
    }
    assert set(SCENARIO_TABLE) == set(ROW_SCENARIOS)
    assert (
        client.post("/__test_overview__", params={"scenario": "S99"}).status_code == 404
    )
    response = client.post(
        "/__test_overview_act__",
        json={"project": "p", "actor": "ana", "action": "dance", "case_id": "c"},
    )
    assert response.status_code == 404


@pytest.mark.parametrize("name", ROW_SCENARIOS)
def test_each_scenario_builds_and_shows_its_cells(client, name):
    built = build(client, name)
    table = SCENARIO_TABLE[name]
    assert {(row["case_id"], row["language"]) for row in built["rows"]} == set(table)
    lead = Lead(client, built)
    rows = lead.rows()
    for key, expected in table.items():
        row = rows[key]
        stages = row["stages"]
        actual = Expect(
            (stages["review"]["state"], stages["review"]["tone"]),
            (stages["annotation"]["state"], stages["annotation"]["tone"]),
            (stages["final"]["state"], stages["final"]["tone"]),
            waiting(row),
            action(row),
            {
                cell: cell_detail(stages[cell], fields)
                for cell, fields in expected.details.items()
            },
        )
        assert actual == expected, key
        marker = MARKERS.get((name, *key))
        if marker is not None:
            assert row["version_marker"] == marker, key
    if name == "S1":
        de, en = rows[("case-101", "de")], rows[("case-101", "en")]
        assert de["plan_row"]["decided"] is False
        assert en["plan_row"]["decided"] is True and en["in_plan"] is False
    if name == "S2":
        assert rows[("case-102", "de")]["next_step"]["badges"] == ["check_failed"]
    if name == "S9":
        excerpt = rows[("case-109", "de")]["stages"]["annotation"]["detail"]["excerpt"]
        assert excerpt.startswith("Satz 3 unvollständig") and excerpt.endswith("…")
    if name == "S15":
        step = rows[("case-115", "de")]["next_step"]
        assert (step["kind"], step["badges"]) == ("assign", ["source_changed"])
    lead.close()


def test_walkthrough_builds_unimported(client):
    built = build(client, "WALKTHROUGH")
    path = Path(built["bundle_path"])
    assert path.is_absolute() and path.is_file() and path.suffix == ".zip"
    assert built["case_id"] == WALKTHROUGH_CASE
    assert built["rows"] == [
        {"case_id": WALKTHROUGH_CASE, "language": "en"},
        {"case_id": WALKTHROUGH_CASE, "language": "de"},
    ]
    lead = Lead(client, built)
    assert lead.rows() == {}
    lead.close()


def act(
    client: TestClient, built: dict[str, Any], actor: str, action: str, **extra: Any
) -> dict[str, Any]:
    response = client.post(
        "/__test_overview_act__",
        json={
            "project": built["project"],
            "actor": actor,
            "action": action,
            "case_id": WALKTHROUGH_CASE,
            "language": "de",
            **extra,
        },
    )
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def cells(row: dict[str, Any]) -> dict[str, tuple[str, str]]:
    return {name: (cell["state"], cell["tone"]) for name, cell in row["stages"].items()}


def test_act_route_steps_reach_walkthrough_states(client):
    """Steps 1-12 of the acceptance walkthrough: the lead's steps through the
    lead services, everybody else's through the act route."""
    built = build(client, "WALKTHROUGH")
    app: Any = client.app
    scenario = Scenario(app, built["project"], dict(built["users"]))
    case = WALKTHROUGH_CASE
    lead = Lead(client, built)

    # 1. The lead imports the package.
    job = run_fixture_import(app, Path(built["bundle_path"]), built["project"])
    assert job.status == "succeeded", job.error
    _wait_for_children(scenario, job.id)
    rows = lead.rows()
    de, en = rows[(case, "de")], rows[(case, "en")]
    assert cells(de) == {
        "review": ("unassigned", "todo"),
        "annotation": ("after_review", "waiting"),
        "final": NONE,
    }
    assert de["stages"]["review"]["detail"]["note"] == "machine_translation"
    assert (waiting(de), action(de)) == ("You", "assign_translation_review")
    assert en["stages"]["annotation"]["state"] == "not_planned"
    v1 = newest(scenario, case, "de")

    # 2. The lead assigns the review to Ana.
    batch_assign(scenario, case, "de", "translation_review", ["ana"])
    de = lead.row(case, "de")
    assert cells(de)["review"] == ("in_progress", "running")
    assert waiting(de) == ANA and lead.bar["to_assign"] == 0

    # 3. Ana accepts unchanged.
    act(client, built, "ana", "accept_review")
    de = lead.row(case, "de")
    assert cells(de)["review"] == ACCEPTED
    assert cells(de)["annotation"] == ("unassigned", "todo")
    assert cell_detail(de["stages"]["annotation"], {"assigned": 0, "target": 2}) == {
        "assigned": 0,
        "target": 2,
    }
    assert lead.bar["to_assign"] == 1

    # 4. The lead splits the annotation to Tom and Luc.
    batch_assign(scenario, case, "de", "annotate", ["tom", "luc"])
    de = lead.row(case, "de")
    assert cells(de)["annotation"] == ("in_progress", "running")
    # The spec reads "Tom Reis, Luc Martin"; the order is the server's.
    assert sorted(waiting(de).split(", ")) == [LUC, TOM]

    # 5. Tom submits; Luc keeps a draft (moved to v2 in step 7).
    tom_v1 = act(client, built, "tom", "submit_annotation", preset="tom_v1")
    act(client, built, "luc", "draft_annotation", preset="luc_v1")
    de = lead.row(case, "de")
    annotation = de["stages"]["annotation"]
    assert (
        annotation["state"],
        cell_detail(annotation, {"submitted": 1, "people": []}),
    ) == (
        "in_progress",
        {"submitted": 1, "people": [LUC]},
    )
    assert cells(de)["final"] == ("after_annotation", "waiting")

    # 6. The lead requests a correction and Ana corrects (v2).
    request_correction(scenario, v1, "ana")
    v2 = act(client, built, "ana", "correct_translation")["document_id"]
    assert v2 != v1
    de = lead.row(case, "de")
    assert de["version_marker"] == {"kind": "corrected", "version": 2}
    assert cell_detail(de["stages"]["review"], {**CORRECTED, "people": []}) == {
        **CORRECTED,
        "people": [ANA],
    }
    assert cells(de)["annotation"] == ("old_text_open", "decision")
    assert names(de["stages"]["annotation"]["detail"]["people"]) == [LUC]
    assert [s["action"] for s in de["steps"]][:2] == [
        "handle_text_change",
        "carry_text_change",
    ]
    assert lead.bar["needs_decision"] == 1

    # 7. Handle text change… → Move to v2.
    luc_v1 = open_assignment(scenario, "luc", case, "de", "annotate")
    move_to_newest(scenario, luc_v1, v2)
    de = lead.row(case, "de")
    assert cells(de)["annotation"] == ("old_text_submitted", "decision")
    assert names(de["stages"]["annotation"]["detail"]["people"]) == [TOM]
    assert action(de) == "carry_text_change"

    # 8. Carry to v2… → Tom (author).
    carry_to_author(scenario, tom_v1["submission_id"], v2)
    de = lead.row(case, "de")
    annotation = de["stages"]["annotation"]
    assert (
        annotation["state"],
        cell_detail(annotation, {"submitted": 0, "total": 2}),
    ) == (
        "in_progress",
        {"submitted": 0, "total": 2},
    )
    assert sorted(waiting(de).split(", ")) == [LUC, TOM]
    # Spec step 8 reads Final "○ after annotation"; the server shows "—":
    # Tom's v1 submission is carried (not eligible) and nothing is submitted
    # on v2 yet (reported in the O10a hand-back).
    assert cells(de)["final"] == NONE
    assert lead.bar["needs_decision"] == 0

    # 9. Tom and Luc resolve the carried findings and submit on v2.
    tom_v2 = act(client, built, "tom", "resolve_carried_and_submit", preset="tom_v2")
    luc_v2 = act(client, built, "luc", "resolve_carried_and_submit", preset="luc_v2")
    assert tom_v2["resolved_inputs"] == 3 and luc_v2["resolved_inputs"] == 2
    de = lead.row(case, "de")
    annotation = de["stages"]["annotation"]
    assert (annotation["state"], annotation["detail"]["submitted"]) == ("submitted", 2)
    assert sorted(names(annotation["detail"]["people"])) == [LUC, TOM]
    final = de["stages"]["final"]
    assert (final["state"], final["detail"]["submitted"]) == ("choose", 2)
    assert (final["detail"]["matching"], final["detail"]["compared"]) == (5, 7)
    assert action(de) == "choose_final"

    # 10. Compare results… → panel → Consolidate… → Ana.
    panel = lead.panel(case, "de")
    assert panel["agreement"]["compared_version"] == 2
    assert (panel["agreement"]["matching"], panel["agreement"]["total"]) == (5, 7)
    compared = [s for s in panel["submissions"] if s["comparable"]]
    assert sorted(s["only_here"] for s in compared) == [1, 1]
    start_consolidation(
        scenario, v2, "ana", [tom_v2["submission_id"], luc_v2["submission_id"]]
    )
    de = lead.row(case, "de")
    assert cells(de)["annotation"] == ("consolidating", "running")
    assert names(de["stages"]["annotation"]["detail"]["people"]) == [ANA]
    assert cells(de)["final"] == ("after_review", "waiting")

    # 11. Ana submits the consolidation.
    consolidation = act(client, built, "ana", "submit_consolidation")["submission_id"]
    de = lead.row(case, "de")
    final = de["stages"]["final"]
    assert (final["state"], final["detail"]["submitted"]) == ("choose", 3)
    assert action(de) == "choose_final"

    # 12. Accept result… → Accept as final.
    select_final(scenario, v2, consolidation)
    de = lead.row(case, "de")
    final = de["stages"]["final"]
    assert (final["state"], final["tone"]) == ("final", "done")
    assert cell_detail(final, {"note": "consolidation", "people": []}) == {
        "note": "consolidation",
        "people": [ANA],
    }
    assert lead.bar["done"] == 1 and lead.bar["needs_decision"] == 0

    # The lead's visit moves back by the act route.
    visit = client.post(
        f"/api/v1/projects/{built['project']}/documents/visit",
        headers={"Origin": lead.origin, "X-CSRF-Token": lead.csrf},
    )
    assert visit.status_code == 200, visit.text
    assert act(client, built, "lead", "age_visit")["visits"] == 1
    lead.close()
