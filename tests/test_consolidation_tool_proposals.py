"""Consolidation members say whether their finding comes from a tool
proposal (spec 2026-10-23 §3, robot icon): a confirmed or corrected proposal
is marked, a finding the annotator added and work from scratch are not."""

from __future__ import annotations

from typing import Any

import pytest
from proposal_check_support import BASE, assign, client, open_task, proposal_env
from t1_fixtures import TEXT
from test_consolidation_resolve_api import build_round, view

SEIZURE = "HP:0001250"
FIRST_SEIZURE = TEXT.index("Krampfanfälle")
HEAVY = TEXT.index("schwere")


class Workspace:
    """One annotator's "from proposals" workspace, driven through the API."""

    def __init__(self, env: Any, username: str) -> None:
        assignment = assign(env, env.c1, username)
        opened = open_task(env, username, assignment["id"])
        self.client = client(env, username)
        self.id = opened["workspace_id"]
        self.revision = opened["view"]["draft"]["revision"]
        self.targets = sorted(
            opened["view"]["targets"]["targets"], key=lambda t: t["annotation_id"]
        )
        self.username = username

    def post(self, path: str, payload: dict[str, Any], **extra: Any) -> Any:
        response = self.client.post(
            f"/api/v1/workspaces/{self.id}/{path}",
            json={
                "mutation_id": f"{path}-{self.revision}",
                "expected_revision": self.revision,
                "payload": payload,
            }
            | extra,
        )
        assert response.status_code == 200, response.text
        body = response.json()
        self.revision = body.get("revision", self.revision)
        return body

    def create(self, annotation_id: str, start: int, end: int, **axes: str) -> str:
        draft = self.post(
            "commands",
            {
                "command": "create_annotation",
                "annotation_id": annotation_id,
                "evidence_id": f"ev-{annotation_id}",
                "term_id": SEIZURE,
                "layer_id": "hpo",
                "type_id": "phenotype",
                "segments": [{"start": start, "end": end}],
                "axes_values": axes,
                "chosen_axis_ids": list(axes),
            },
        )
        return next(
            s["version"]
            for s in draft["annotations"]
            if s["annotation"]["annotation_id"] == annotation_id
        )

    def decide(self, target: dict[str, Any], outcome: str, **extra: Any) -> None:
        self.post("decisions", {"target": target, "outcome": outcome} | extra)

    def submit(self) -> str:
        self.post(
            "commands", {"command": "check_layer", "layer_id": "hpo", "checked": True}
        )
        payload = {"document_checked": True}
        response = self.client.post(
            f"/api/v1/workspaces/{self.id}/submit",
            json={
                "mutation_id": "submit",
                "expected_revision": self.revision,
                "payload": payload,
            },
        )
        if response.status_code != 200 and (
            response.json().get("code") == "AXIS_CONFIRMATION_WARNING"
        ):
            payload["warning_acknowledgement"] = response.json()["details"][
                "acknowledgement"
            ]
            response = self.client.post(
                f"/api/v1/workspaces/{self.id}/submit",
                json={
                    "mutation_id": "submit-ack",
                    "expected_revision": self.revision,
                    "payload": payload,
                },
            )
        assert response.status_code == 200, response.text
        return str(response.json()["submission_id"])


@pytest.fixture
def members(tmp_path: Any) -> dict[tuple[str, int, str], bool]:
    """Anne confirms every proposal and adds a finding; Arne corrects the
    first proposal (another assertion) and confirms the rest. The lead
    consolidates; ``{(username, span start, assertion): from_tool_proposal}``
    (member annotation ids are ``input-…`` ids)."""
    env = proposal_env(tmp_path)
    anne = Workspace(env, "anno")
    for target in anne.targets:
        anne.decide(target, "confirmed")
    anne.create("added-anno", HEAVY, HEAVY + len("schwere"))
    arne = Workspace(env, "anno2")
    first, *rest = arne.targets
    version = arne.create(
        "corrected-anno2",
        FIRST_SEIZURE,
        FIRST_SEIZURE + len("Krampfanfälle"),
        assertion="absent",
    )
    arne.decide(
        first,
        "changed",
        replacement={"annotation_id": "corrected-anno2", "version": version},
    )
    for target in rest:
        arne.decide(target, "confirmed")
    sources = [anne.submit(), arne.submit()]
    started = env.lead.post(
        f"{BASE}/consolidations",
        json={
            "document_id": env.c1,
            "reviewer": "leader",
            "source_submission_ids": sources,
            "reason": None,
            "confirm_language": True,
            "request_id": "start-tool-proposals",
            "expected_workflow_revision": None,
        },
    )
    assert started.status_code == 200, started.text
    round_id = started.json()["round"]["round_id"]
    read = env.lead.get(f"/api/v1/rounds/{round_id}/consolidation")
    assert read.status_code == 200, read.text
    names = {
        env.app.state.accounts.get_by_username(name).pseudonym: name
        for name in ("anno", "anno2")
    }
    found = {
        (names[m["person_id"]], m["spans"][0][0], m["axes"]["assertion"]): m[
            "from_tool_proposal"
        ]
        for g in read.json()["groups"]
        for m in g["members"]
    }
    assert len(found) == 7  # Anne 3 + 1 added, Arne 1 corrected + 2
    return found


CORRECTED = ("anno2", FIRST_SEIZURE, "absent")
ADDED = ("anno", HEAVY, "present")


def test_confirmed_proposals_are_marked(members):
    confirmed = {k: v for k, v in members.items() if k not in {CORRECTED, ADDED}}
    assert len(confirmed) == 5
    assert all(confirmed.values())


def test_corrected_proposals_are_marked(members):
    assert members[CORRECTED] is True


def test_added_findings_are_not_marked(members):
    assert members[ADDED] is False


def test_work_from_scratch_is_not_marked(tmp_path):
    groups = view(build_round(tmp_path))["groups"]
    flags = [m["from_tool_proposal"] for g in groups for m in g["members"]]
    assert flags and not any(flags)
