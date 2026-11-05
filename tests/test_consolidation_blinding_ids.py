"""Hidden annotator names cannot be recomputed from hashes (issue 302).

A snapshot's ``version`` hashes its content, author included, and nearly
every other id a consolidator reads hashes such a version. With names hidden
every such id is opaque for the consolidator (``z`` + a keyed permutation)
and is mapped back on every request, so the whole consolidation works on the
opaque ids.
"""

from __future__ import annotations

import base64
import json
import re
from typing import Any
from urllib.parse import quote

import pytest
from test_consolidation_resolve_api import (
    FIRST,
    SECOND,
    build_round,
    group,
    mutate,
    payload,
    revision,
)
from work_plan_support import doc

from ontotator.api.blind_ids import PUBLIC_KEYS, IdCipher
from ontotator.domain.annotations import Annotation, annotation_content
from ontotator.domain.canonical import canonical_hash

SETTINGS = "/api/v1/projects/proj/settings"
HISTORY = f"/api/v1/projects/proj/documents/{quote(doc('c1', 'en'), safe='')}"
HEX = re.compile(r"(?<![0-9A-Za-z])([0-9a-f]{64}|[0-9a-f]{16})(?![0-9A-Za-z])")


def _hide(env: Any, on: bool = True) -> None:
    response = env.lead.patch(SETTINGS, json={"blind_consolidation": on})
    assert response.status_code == 200, response.text


def _ok(response: Any) -> Any:
    assert response.status_code == 200, response.text
    return response.json()


def _candidates(ns: Any) -> list[str]:
    """Every pseudonym a consolidator can list."""
    members = _ok(ns.adj.get("/api/v1/projects/proj/members"))
    return [m["pseudonym"] for m in members]


def _with_actor(snap: dict[str, Any], actor: str) -> dict[str, Any]:
    annotation = json.loads(json.dumps(snap["annotation"]))
    annotation["provenance"]["actor"]["actor_id"] = actor
    return annotation


def _version(snap: dict[str, Any], actor: str) -> str:
    """The snapshot's version had ``actor`` written it (domain.snapshot)."""
    annotation = Annotation.model_validate(_with_actor(snap, actor))
    return canonical_hash(
        {
            "schema_version": snap["schema_version"],
            "annotation": annotation_content(annotation),
            "document_id": snap["document_id"],
            "evidence": snap["evidence"],
            "layer_config_sha256": snap["layer_config_sha256"],
            "ontology_sha256": snap["ontology_sha256"],
            "text_sha256": snap["text_sha256"],
        }
    )


def _recovered(ns: Any) -> dict[str, str]:
    """The reviewer's attack: rehash every hidden snapshot (and the round
    input ids over them) with each candidate pseudonym."""
    rid = ns.round.round_id
    inputs = _ok(ns.adj.get(f"/api/v1/rounds/{rid}/inputs"))
    opened = _ok(ns.adj.post(f"/api/v1/rounds/{rid}/open"))["view"]
    history = [
        _ok(ns.adj.get(f"{HISTORY}/submissions/{quote(sid, safe='')}"))
        for sid in (FIRST, SECOND)
    ]
    snaps = [i["source_snapshot"] for i in inputs]
    snaps += [i["target_snapshot"] for i in inputs if i["target_snapshot"]]
    snaps += opened["available_inputs"]
    snaps += [s for h in history for s in h["annotations"]]
    snaps += [i["source_snapshot"] for h in history for i in h["round_inputs"]]
    found: dict[str, str] = {}
    for snap in snaps:
        for candidate in _candidates(ns):
            if _version(snap, candidate) == snap["version"]:
                found[snap["annotation"]["annotation_id"]] = candidate
    for item in inputs:
        source = item["source_snapshot"]
        for candidate in _candidates(ns):
            iid = canonical_hash(
                {
                    "round": rid,
                    "submission": item["source_submission_id"],
                    "ref": _version(source, candidate),
                    "id": source["annotation"]["annotation_id"],
                }
            )
            if iid == item["input_id"]:
                found[item["input_id"]] = candidate
    return found


def _bare_hashes(payload: Any, key: str | None = None) -> list[str]:
    """Hex hashes outside the public, author-independent fields."""
    if isinstance(payload, dict):
        out = [k for k in payload if HEX.search(k)]
        for k, v in payload.items():
            out += _bare_hashes(v, k)
        return out
    if isinstance(payload, list):
        return [h for item in payload for h in _bare_hashes(item, key)]
    if not isinstance(payload, str) or key in PUBLIC_KEYS or key == "text":
        return []
    if key == "workspace_id":
        raw = base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))
        return _bare_hashes(json.loads(raw))
    return [m.group(1) for m in HEX.finditer(payload)]


def _reads(ns: Any) -> dict[str, Any]:
    client, rid = ns.adj, ns.round.round_id
    out = {
        "consolidation": client.get(f"/api/v1/rounds/{rid}/consolidation"),
        "open": client.post(f"/api/v1/rounds/{rid}/open"),
        "inputs": client.get(f"/api/v1/rounds/{rid}/inputs"),
        "assignment_open": client.post(f"/api/v1/assignments/{ns.review}/open"),
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


def test_the_hashes_name_the_authors_while_names_show(ns):
    # The attack works on real hashes: what the setting must prevent.
    found = _recovered(ns)
    anno = str(ns.env.app.state.accounts.get_by_username("anno").pseudonym)
    assert found["a1"] == anno


def test_no_hash_lets_a_consolidator_recompute_an_author(ns):
    _hide(ns.env)
    assert _recovered(ns) == {}
    for name, body in _reads(ns).items():
        assert _bare_hashes(body) == [], name


def test_a_blinded_consolidation_resolves_and_submits_on_opaque_ids(ns):
    env = ns.env
    _hide(env)
    for kind in ("match", "term_differs", "values_differ", "partial"):
        item = group(ns, kind)
        assert all(m["input_id"].startswith("z") for m in item["members"])
        action = "keep" if kind in ("match", "partial") else "choose"
        draft = _ok(mutate(ns, "resolve", payload(item, action)))
        assert _bare_hashes(draft) == []
    rid = ns.round.round_id
    view = _ok(ns.adj.get(f"/api/v1/rounds/{rid}/consolidation"))
    assert [g["state"] for g in view["groups"]] == ["keep", "choose", "choose", "keep"]
    workspace = view["workspace_id"]
    # A decision of the full editor names an opaque target.
    opened = _ok(ns.adj.post(f"/api/v1/rounds/{rid}/open"))["view"]
    target = opened["targets"]["targets"][0]
    assert target["version"].startswith("z")
    submitted = _ok(
        ns.adj.post(
            f"/api/v1/workspaces/{workspace}/submit",
            json={
                "mutation_id": "submit",
                "expected_revision": revision(ns),
                "payload": {"document_checked": True},
            },
        )
    )
    assert _bare_hashes(submitted) == []
    sid = submitted["submission_id"]
    assert re.fullmatch(r"sub-z[0-9a-f]{16}", sid)
    own = _ok(ns.adj.get(f"/api/v1/workspaces/{workspace}/submissions/{sid}"))
    assert own["submission_id"] == sid
    detail = _ok(ns.adj.get(f"{HISTORY}/submissions/{quote(sid, safe='')}"))
    assert detail["summary"]["submission_id"] == sid
    # The lead reads the real ids of the same submission.
    lead = _ok(env.lead.get(f"{HISTORY}/submissions"))
    real = {row["submission_id"] for row in lead} - {FIRST, SECOND}
    assert len(real) == 1 and re.fullmatch(r"sub-[0-9a-f]{16}", real.pop())


def test_a_page_loaded_while_hidden_keeps_working_once_names_show(ns):
    _hide(ns.env)
    item = group(ns, "match")
    _hide(ns.env, False)
    # The ids it holds are opaque; the server maps them back still.
    workspace = _ok(ns.adj.get(f"/api/v1/rounds/{ns.round.round_id}/consolidation"))[
        "workspace_id"
    ]
    response = ns.adj.post(
        f"/api/v1/workspaces/{workspace}/consolidation-groups/resolve",
        json={
            "mutation_id": "late",
            "expected_revision": revision(ns),
            "payload": payload(item, "keep"),
        },
    )
    assert response.status_code == 200, response.text


def test_leads_read_the_real_hashes(ns):
    _hide(ns.env)
    inputs = _ok(ns.env.lead.get(f"/api/v1/rounds/{ns.round.round_id}/inputs"))
    stored = ns.env.app.state.repo.get_round_input_inventory("proj", ns.round.round_id)
    assert {i["input_id"] for i in inputs} == {i["input_id"] for i in stored}


def test_the_permutation_is_keyed_reversible_and_keeps_the_shape():
    real64, real16 = "ab" * 32, "0123456789abcdef"
    one, other = IdCipher(b"k" * 32, 1), IdCipher(b"k" * 32, 2)
    sealed = one.seal(real64)
    assert re.fullmatch(r"z[0-9a-f]{64}", sealed) and sealed != "z" + real64
    assert one.open(sealed) == real64
    assert re.fullmatch(r"z[0-9a-f]{16}", one.seal(real16))
    assert one.open(one.seal(real16)) == real16
    assert other.seal(real64) != sealed
    text = f"input-{real64}-e0 round-input:{real64} sub-{real16}"
    assert one.open_text(one.seal_text(text)) == text
    assert real64 not in one.seal_text(text)
