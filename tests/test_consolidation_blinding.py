"""Hide annotator names during consolidation (issue 302).

With the project setting on, no payload a consolidator reads about the
round's inputs carries an input author's name or pseudonym: they read
"Annotator A", "Annotator B" (by submission time) with opaque ids. Leads
keep the names; the setting is off by default and in the settings history.
"""

from __future__ import annotations

import json
from typing import Any
from urllib.parse import quote

from sqlalchemy import select
from test_consolidation_read_api import _access, pseudonym, url
from test_consolidation_read_api import cons as cons
from test_document_rows_submissions import _submit_consolidation
from work_plan_support import doc

from ontotator.application.consolidation_blinding import letters
from ontotator.authz.scoped import ScopedRepository
from ontotator.storage.tables import AuditEventRow

SETTINGS = "/api/v1/projects/proj/settings"
HISTORY = f"/api/v1/projects/proj/documents/{quote(doc('c1', 'en'), safe='')}"
NAMES = ("Anne Notator", "Arne Notator")


def _hide(env: Any, on: bool = True) -> None:
    response = env.lead.patch(SETTINGS, json={"blind_consolidation": on})
    assert response.status_code == 200, response.text
    assert response.json()["blind_consolidation"] is on


def _payloads(cons: Any) -> dict[str, Any]:
    """Everything the consolidator reads about the round and its inputs."""
    client, round_id = cons.adj, cons.round.round_id
    out = {
        "consolidation": client.get(url(round_id)),
        "open": client.post(f"/api/v1/rounds/{round_id}/open"),
        "inputs": client.get(f"/api/v1/rounds/{round_id}/inputs"),
        "rounds": client.get(f"/api/v1/assignments/{cons.review}/rounds"),
        "history": client.get(f"{HISTORY}/submissions"),
    }
    for sid in ("sub-first-7c1", "sub-second-9d2"):
        out[sid] = client.get(f"{HISTORY}/submissions/{quote(sid, safe='')}")
    for name, response in out.items():
        assert response.status_code == 200, (name, response.text)
    return {name: response.json() for name, response in out.items()}


def _leaks(env: Any, payload: Any) -> list[str]:
    text = json.dumps(payload, ensure_ascii=False)
    secrets = [pseudonym(env, "anno"), pseudonym(env, "anno2"), *NAMES]
    return [secret for secret in secrets if secret in text]


def test_letters():
    assert [letters(i) for i in (0, 1, 25, 26, 27)] == ["A", "B", "Z", "AA", "AB"]


def test_setting_is_off_by_default_lead_only_and_in_history(cons):
    env = cons.env
    assert env.lead.get(SETTINGS).json()["blind_consolidation"] is False
    refused = cons.adj.patch(SETTINGS, json={"blind_consolidation": True})
    assert refused.status_code in {403, 404}, refused.text
    _hide(env)
    with env.db.transaction() as conn:
        fields = conn.execute(
            select(AuditEventRow.details["fields"])
            .where(AuditEventRow.action == "project.update")
            .order_by(AuditEventRow.id.desc())
            .limit(1)
        ).scalar_one()
    assert fields == ["blind_consolidation"]


def test_names_show_while_off(cons):
    payloads = _payloads(cons)
    assert payloads["consolidation"]["annotators_hidden"] is False
    assert _leaks(cons.env, payloads["consolidation"])


def test_consolidator_reads_no_name_or_pseudonym_when_on(cons):
    env = cons.env
    _hide(env)
    payloads = _payloads(cons)
    for name, payload in payloads.items():
        assert _leaks(env, payload) == [], name
    body = payloads["consolidation"]
    assert body["annotators_hidden"] is True
    # Stable letters by submission time: the first submission is A.
    assert body["people"] == [
        {"person_id": "annotator-a", "label": "Annotator A", "lane": 1},
        {"person_id": "annotator-b", "label": "Annotator B", "lane": 2},
    ]
    values = body["groups"][1]
    assert [m["person_id"] for m in values["members"]] == [
        "annotator-a",
        "annotator-b",
    ]
    assert payloads["consolidation"] == _payloads(cons)["consolidation"]
    labels = {row["submission_id"]: row["author_label"] for row in payloads["history"]}
    assert labels == {"sub-first-7c1": "Annotator A", "sub-second-9d2": "Annotator B"}
    actors = {
        item["source_snapshot"]["annotation"]["provenance"]["actor"]["actor_id"]
        for item in payloads["inputs"]
    }
    assert actors == {"annotator-a", "annotator-b"}
    # The editor's view of the same inputs.
    inputs = payloads["open"]["view"]["available_inputs"]
    assert {i["annotation"]["provenance"]["actor"]["actor_id"] for i in inputs} == (
        actors
    )


def test_leads_keep_the_names(cons):
    env = cons.env
    _hide(env)
    adj_access, adj_actor = _access(env, "adj", "adjudicator")
    reviewer = ScopedRepository(env.db, adj_access, adj_actor)
    _submit_consolidation(env.app.state.ontology_registry, reviewer, cons.round)
    body = env.lead.get(url(cons.round.round_id)).json()
    assert body["annotators_hidden"] is False
    anno = pseudonym(env, "anno")
    assert body["people"][0] == {
        "person_id": anno,
        "label": f"Anne Notator ({anno})",
        "lane": 1,
    }
    history = env.lead.get(f"{HISTORY}/submissions").json()
    assert anno in {row["author_label"] for row in history}
    # The consolidator's own submitted round stays blinded for them.
    own = cons.adj.get(url(cons.round.round_id)).json()
    assert own["annotators_hidden"] is True
    assert _leaks(env, own) == []
