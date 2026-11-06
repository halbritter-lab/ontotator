"""A blinded consolidator's API token sees only opaque ids (issue 348).

``BlindIdsMiddleware`` reads the principal the security middleware resolves.
A bearer request resolves it from the token instead of the session cookie, so
it must be blinded exactly like the same user's session: every id the token
reads is opaque, and the same opaque value the session reads.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient
from test_consolidation_blinding_ids import HISTORY, _bare_hashes, _hide, _ok
from test_consolidation_resolve_api import FIRST, SECOND, build_round


def _reads(client: TestClient, ns: Any) -> dict[str, Any]:
    """Every route of the session test a ``read`` token may call."""
    rid = ns.round.round_id
    out = {
        "consolidation": client.get(f"/api/v1/rounds/{rid}/consolidation"),
        "inputs": client.get(f"/api/v1/rounds/{rid}/inputs"),
        "rounds": client.get(f"/api/v1/assignments/{ns.review}/rounds"),
        "history": client.get(f"{HISTORY}/submissions"),
        "versions": client.get(f"{HISTORY}/annotation-versions"),
    }
    for sid in (FIRST, SECOND):
        out[sid] = client.get(f"{HISTORY}/submissions/{quote(sid, safe='')}")
    return {name: _ok(response) for name, response in out.items()}


@pytest.fixture
def ns(tmp_path: Any) -> Any:
    return build_round(tmp_path)


def _token(ns: Any) -> TestClient:
    created = ns.adj.post(
        "/api/v1/me/tokens", json={"name": "script", "scopes": ["read"]}
    )
    assert created.status_code == 201, created.text
    secret = created.json()["secret"]
    # A fresh client: only the token, no session cookie.
    return TestClient(ns.env.app, headers={"Authorization": f"Bearer {secret}"})


def test_a_blinded_consolidators_token_reads_only_opaque_ids(ns):
    _hide(ns.env)
    bearer = _token(ns)
    assert not bearer.cookies
    by_token = _reads(bearer, ns)
    for name, body in by_token.items():
        assert _bare_hashes(body) == [], name
    inputs = by_token["inputs"]
    assert inputs and all(i["input_id"].startswith("z") for i in inputs)
    # Exactly what the same user's session reads.
    assert by_token == _reads(ns.adj, ns)


def test_a_token_reads_the_real_ids_once_names_show(ns):
    bearer = _token(ns)
    inputs = _ok(bearer.get(f"/api/v1/rounds/{ns.round.round_id}/inputs"))
    stored = ns.env.app.state.repo.get_round_input_inventory("proj", ns.round.round_id)
    assert {i["input_id"] for i in inputs} == {i["input_id"] for i in stored}
