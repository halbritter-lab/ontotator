"""Hidden annotator names in history and across rounds (issue 302).

A re-anchor review recorded in an input submission names its reviewer by
letter, and a person keeps their letter across the consolidation rounds of
one task (a second round only adds letters).
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

import pytest
from test_consolidation_resolve_api import FIRST, SECOND, access_of, build_round
from test_final_panel_api import SEIZURE, finding, span_of, submit_findings
from work_plan_support import assign, doc

from ontotator.application.work_rounds import WorkRoundService

SETTINGS = "/api/v1/projects/proj/settings"
HISTORY = f"/api/v1/projects/proj/documents/{quote(doc('c1', 'en'), safe='')}"


def _hide(env: Any, on: bool = True) -> None:
    response = env.lead.patch(SETTINGS, json={"blind_consolidation": on})
    assert response.status_code == 200, response.text


def _ok(response: Any) -> Any:
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def ns(tmp_path: Any) -> Any:
    return build_round(tmp_path)


def test_a_reanchor_reviewer_is_hidden(monkeypatch, tmp_path):
    from ontotator.domain.annotations import AnnotationRef
    from ontotator.domain.reanchor_resolution import (
        PendingReanchorRef,
        ReanchorResolution,
    )
    from ontotator.storage.repository import Repository

    original = Repository._insert_submission

    def with_reanchor(conn: Any, pid: int, record: Any, **kw: Any) -> Any:
        # The first input recorded a re-anchor review (as "annotate from
        # proposals" does after a text correction).
        if record.submission_id == FIRST:
            item = PendingReanchorRef(
                proposal_set_id=1,
                source_ref=AnnotationRef(annotation_id="tool-1", version="v"),
            )
            record = record.model_copy(
                update={
                    "reanchor_inputs": [item],
                    "reanchor_resolutions": [
                        ReanchorResolution(
                            item=item,
                            outcome="dismissed",
                            reason="gone",
                            reviewer_id=record.origin_key.annotator_id,
                        )
                    ],
                }
            )
        return original(conn, pid, record, **kw)

    monkeypatch.setattr(Repository, "_insert_submission", staticmethod(with_reanchor))
    ns = build_round(tmp_path)
    _hide(ns.env)
    anno = str(ns.env.app.state.accounts.get_by_username("anno").pseudonym)
    response = ns.adj.get(f"{HISTORY}/submissions/{FIRST}")
    body = _ok(response)
    assert anno not in response.text
    assert body["reanchor_resolutions"][0]["reviewer_id"] == "annotator-a"
    # The lead reads the pseudonym.
    lead = _ok(ns.env.lead.get(f"{HISTORY}/submissions/{FIRST}"))
    assert lead["reanchor_resolutions"][0]["reviewer_id"] == anno


def _second_round(ns: Any, sources: list[str]) -> str:
    """Submit the first consolidation and start a second one on ``sources``."""
    from test_consolidation_read_api import _access
    from test_document_rows_submissions import _submit_consolidation

    from ontotator.authz.scoped import ScopedRepository

    env = ns.env
    adj_access, adj_actor = _access(env, "adj", "adjudicator")
    _submit_consolidation(
        env.app.state.ontology_registry,
        ScopedRepository(env.db, adj_access, adj_actor),
        ns.round,
    )
    lead_access, lead_actor = access_of(env, "leader", "lead")
    revision_ = _ok(ns.adj.get(f"/api/v1/assignments/{ns.review}"))["workflow_revision"]
    created = WorkRoundService(env.db).create(
        lead_access,
        lead_actor,
        ns.review,
        request_id="consolidate-again",
        expected_workflow_revision=revision_,
        kind="consolidation",
        source_submission_ids=sources,
    )
    return created.round_id


def test_a_person_keeps_their_letter_across_the_rounds_of_a_task(ns):
    env = ns.env
    _hide(env)
    target = doc("c1", "en")
    first = _ok(ns.adj.get(f"/api/v1/rounds/{ns.round.round_id}/consolidation"))
    assert [p["label"] for p in first["people"]] == ["Annotator A", "Annotator B"]
    submit_findings(
        env,
        assign(env, target, "ana", "annotate"),
        "sub-third-zz",
        [finding("c1", SEIZURE, span_of(env, target, "Neonatalzeit"))],
    )
    # Round 2 on the same task: the second person (B) and a new one.
    second = _second_round(ns, [SECOND, "sub-third-zz"])
    people = _ok(ns.adj.get(f"/api/v1/rounds/{second}/consolidation"))["people"]
    assert [(p["person_id"], p["label"]) for p in people] == [
        ("annotator-b", "Annotator B"),
        ("annotator-c", "Annotator C"),
    ]
    labels = {
        row["submission_id"]: row["author_label"]
        for row in _ok(ns.adj.get(f"{HISTORY}/submissions"))
    }
    assert labels[FIRST] == "Annotator A"
    assert labels[SECOND] == "Annotator B"
    assert labels["sub-third-zz"] == "Annotator C"
    again = _ok(ns.adj.get(f"/api/v1/rounds/{ns.round.round_id}/consolidation"))
    assert again["people"] == first["people"]
