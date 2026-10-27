# Term Search, Part 1: One Search — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## TL;DR (Deutsch)

- Die Auswahl „Search Strategy" verschwindet; die Oberfläche schickt jede Eingabe mit `route: "auto"`.
- Das Backend entscheidet: Code liefert genau einen Term, Stichwort liefert exakte Treffer oben und danach ähnliche Treffer in gemischter Reihenfolge.
- Jeder Kandidat trägt seinen Fundweg (`route`) und ggf. die Sprache (`match_language`); das Suchereignis speichert `candidate_routes`.
- Acht Aufgaben: Modelle, Code-Eingabe, Stichwort-Eingabe, API-Ereignis, Vertrag, `SearchManager`, `SearchPanel`, Abschlussprüfung mit eingebetteten Web-Assets.

**Goal:** Replace the four-way "Search Strategy" selector with a single search box whose requests use the new backend route `auto`.

**Architecture:** `OntologyService.search` gains an `auto` branch: an identifier-like query is answered by the existing `id` route alone; any other query returns exact label/synonym matches (fixed order, no prefix fallback) followed by lexical hits without those terms, shuffled with today's seed. Each candidate records the route that produced it, and the search event stores that per term. The frontend drops the selector and always sends `auto`. The legacy routes stay valid in the API.

**Tech Stack:** Python 3 / FastAPI / Pydantic v2, pytest, ruff, mypy; React 18 + TypeScript, Vitest + Testing Library, Playwright; OpenAPI contract in `contracts/openapi.json` with generated types in `frontend/src/api/generated.ts`.

**Spec:** `docs/superpowers/specs/2026-10-07-term-search-design.md`, section 2 ("Eine Suche"). Parts 2 (translations) and 3 (tree) get their own plans.

**Conventions used below**

- All `npm`/`npx` commands run in `frontend/`. All `uv`/`git` commands run in the repo root.
- The branch `feat/term-search` already exists and holds the spec. Work on it.
- Commit messages follow the repo style (`feat(search): …`, `feat(frontend): …`, `test: …`, `build: …`). Do **not** add any `Co-Authored-By` or "Generated with" lines.
- Before every commit that touches Python files, run `uv run ruff format <those files>`; CI runs `ruff format --check .` over tests as well, and the test code below is not guaranteed to be wrapped the way ruff wants it.
- Do not edit files under `src/ontotator/vendor/`. All new logic goes into `src/ontotator/ontology/service.py`.
- Test ontology `tests/fixtures/hp.json` holds: `HP:0001250` Seizure (synonyms Seizures, Epileptic seizure, Convulsion), `HP:0002133` Status epilepticus (Prolonged seizures), `HP:0011146` Dialeptic seizure (Absence seizure), `HP:0001252` Hypotonia (Low muscle tone, Muscle hypotonia, Hypotonic), `HP:0001284` Areflexia, `HP:0000365` Hearing impairment (Hearing loss, Hipoacusia, Deafness), `HP:0000407` Sensorineural hearing impairment, and the obsolete `HP:0000123`.

## File structure

| File | Action | Responsibility |
|---|---|---|
| `src/ontotator/ontology/provenance.py` | modify | `route: "auto"` on the request (new default); `route` and `match_language` on the candidate |
| `src/ontotator/packages/models.py` | modify | `candidate_routes` on `SearchEventRecord` |
| `src/ontotator/ontology/service.py` | modify | `looks_like_code`, the `auto` branch, one helper that builds a candidate |
| `src/ontotator/api/routes.py` | modify | Store `candidate_routes` in the search event |
| `tests/test_search_auto.py` | create | Service and model tests for the `auto` route |
| `tests/test_api.py` | modify | API test: event of an `auto` search and of the selection made from it |
| `contracts/openapi.json` | regenerate | API contract |
| `frontend/src/api/generated.ts` | regenerate | Types from the contract |
| `frontend/src/editor/searchState.ts` | modify | `SearchRoute` type, default `auto` |
| `frontend/src/editor/SearchPanel.tsx` | modify | No selector, always `auto`, match line with kind and language |
| `frontend/tests/searchState.test.ts` | modify | Default route |
| `frontend/tests/searchPanel.test.tsx` | create | Panel tests |
| `src/ontotator/web/` | regenerate | Embedded SPA build (git-tracked) |

---

### Task 0: Commit the plan, baseline

**Files:**
- Add: `docs/superpowers/plans/2026-10-07-term-search-1-one-search.md`

- [ ] **Step 1: Confirm the branch**

Run: `git branch --show-current`
Expected: `feat/term-search`

- [ ] **Step 2: Commit the plan**

```bash
git add docs/superpowers/plans/2026-10-07-term-search-1-one-search.md
git commit -m "docs: plan for the single term search"
```

- [ ] **Step 3: Baseline**

Run (repo root): `uv sync && uv run pytest -q`
Run (in `frontend/`): `npm ci && npm run typecheck && npm test`
Expected: everything passes. If something fails before any change, stop and report it.

---

### Task 1: Models — `auto` route, candidate route and language, `candidate_routes`

**Files:**
- Modify: `src/ontotator/ontology/provenance.py` (`SearchRequest`, `SearchCandidate`)
- Modify: `src/ontotator/packages/models.py` (`SearchEventRecord`)
- Test: `tests/test_search_auto.py` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests/test_search_auto.py`:

```python
"""The single search: route ``auto`` decides between code and keyword."""

import hashlib
import json
from pathlib import Path

from ontotator.domain.documents import OntologyRef
from ontotator.domain.workspace import WorkspaceKey
from ontotator.ontology.provenance import SearchCandidate, SearchRequest
from ontotator.ontology.service import OntologyService
from ontotator.packages.models import SearchEventRecord

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "hp.json"


def _key(annotator_id: str = "dr-meier") -> WorkspaceKey:
    return WorkspaceKey(
        package_id="pkg-1",
        document_id="doc-1",
        annotator_id=annotator_id,
        mode="independent",
        target_set_id="targets-1",
    )


def _service(path: Path = FIXTURE_PATH) -> OntologyService:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return OntologyService.load(path, OntologyRef(release="2026-06-23", sha256=digest))


def _request(query: str, **overrides: object) -> SearchRequest:
    fields: dict[str, object] = {
        "workspace_key": _key(),
        "annotation_id": "ann-1",
        "query": query,
    }
    fields.update(overrides)
    return SearchRequest.model_validate(fields)


def test_route_defaults_to_auto_and_old_routes_stay_valid() -> None:
    assert _request("seizure").route == "auto"
    for route in ("lexical", "exact", "id", "browse"):
        assert _request("seizure", route=route).route == route


def test_candidate_carries_route_and_match_language() -> None:
    plain = SearchCandidate(term_id="HP:0001252", label="Hypotonia")
    assert plain.route == ""
    assert plain.match_language is None

    tagged = SearchCandidate(
        term_id="HP:0001252", label="Hypotonia", route="exact", match_language="de"
    )
    assert tagged.route == "exact"
    assert tagged.match_language == "de"


def test_search_event_keeps_candidate_routes_and_reads_old_events() -> None:
    old_payload = {
        "event_id": "evt-old",
        "workspace_key": _key().model_dump(),
        "annotation_id": "ann-1",
        "query": "hypotonia",
        "route": "exact",
        "candidates": ["HP:0001252"],
        "ontology_release": "2026-01-01",
        "index_identity": "idx",
        "timestamp": "2026-01-01T00:00:00+00:00",
    }
    old = SearchEventRecord.model_validate_json(json.dumps(old_payload))
    assert old.candidate_routes == {}

    new = SearchEventRecord.model_validate(
        {**old_payload, "route": "auto", "candidate_routes": {"HP:0001252": "exact"}}
    )
    again = SearchEventRecord.model_validate_json(new.model_dump_json())
    assert again.candidate_routes == {"HP:0001252": "exact"}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_search_auto.py -v`
Expected: 3 failures — `route` is `"lexical"` instead of `"auto"`; `SearchCandidate` rejects `route` (extra forbidden) / has no attribute `route`; `SearchEventRecord` has no `candidate_routes`.

- [ ] **Step 3: Extend the request and the candidate**

In `src/ontotator/ontology/provenance.py`, in `SearchRequest`, replace

```python
    route: Literal["lexical", "exact", "id", "browse"] = "lexical"
```

with

```python
    # "auto" is the single search the interface uses: the service decides
    # between a code lookup and a keyword search. The explicit routes remain for
    # stored events and for other callers.
    route: Literal["auto", "lexical", "exact", "id", "browse"] = "auto"
```

In `SearchCandidate`, after the line `obsolete: bool = False`, add

```python
    # The route that put this candidate on the list: "id", "exact", "lexical"
    # or "browse".
    route: str = ""
    # Language of the name that matched, when the route knows it.
    match_language: str | None = None
```

- [ ] **Step 4: Extend the search event**

In `src/ontotator/packages/models.py`, in `SearchEventRecord`, after the line `candidate_scores: dict[str, float] = Field(default_factory=dict)`, add

```python
    # Term id -> route that surfaced it. Empty on events written before the
    # single search existed.
    candidate_routes: dict[str, str] = Field(default_factory=dict)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `uv run pytest tests/test_search_auto.py -v`
Expected: 3 passed.

- [ ] **Step 6: Run the whole backend suite**

Run: `uv run pytest -q`
Expected: all pass except `scripts/export_openapi.py`-based drift tests, if any exist — the contract is regenerated in Task 5. A request with `route="auto"` reaches `SearchEngine.search`, which raises `SearchError("unknown path 'auto' …")`; a test that searches **without** naming a route therefore fails now and passes after Task 3. Note such tests; do not change them.

- [ ] **Step 7: Commit**

```bash
git add src/ontotator/ontology/provenance.py src/ontotator/packages/models.py tests/test_search_auto.py
git commit -m "feat(search): add the auto route and per-candidate route fields to the models"
```

---

### Task 2: Service — code queries

**Files:**
- Modify: `src/ontotator/ontology/service.py`
- Test: `tests/test_search_auto.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_search_auto.py`:

```python
import pytest

from ontotator.ontology.service import looks_like_code


@pytest.mark.parametrize(
    "query", ["1250", "HP:0001250", "hp:0001250", "HP_0001250", " MONDO:1 "]
)
def test_looks_like_code_accepts_identifiers(query: str) -> None:
    assert looks_like_code(query) is True


@pytest.mark.parametrize(
    "query", ["", "Seizure", "HP:", "trisomy 21", "HP:00012A", "low muscle tone"]
)
def test_looks_like_code_rejects_keywords(query: str) -> None:
    assert looks_like_code(query) is False


@pytest.mark.parametrize("query", ["HP:0001250", "hp:0001250", "1250", "HP_0001250"])
def test_code_query_returns_exactly_that_term(query: str) -> None:
    result = _service().search(_request(query))

    assert result.route == "auto"
    assert [c.term_id for c in result.candidates] == ["HP:0001250"]
    candidate = result.candidates[0]
    assert candidate.route == "id"
    assert candidate.match_kind == "id"
    assert (candidate.rank, candidate.display_pos) == (1, 1)
    assert result.displayed_ids == ["HP:0001250"]
    assert result.ranked_ids == ["HP:0001250"]
    assert result.shuffled is False
    assert result.seed is None


def test_unknown_code_returns_nothing_and_no_similar_terms() -> None:
    result = _service().search(_request("HP:9999999"))

    assert result.candidates == []
    assert result.displayed_ids == []
    assert result.shuffled is False


def test_explicit_routes_tag_their_candidates() -> None:
    service = _service()

    by_id = service.search(_request("HP:0001250", route="id"))
    assert [c.route for c in by_id.candidates] == ["id"]

    # The explicit exact route keeps its prefix fallback.
    prefix = service.search(_request("hypoton", route="exact"))
    assert prefix.route == "exact"
    assert prefix.candidates[0].term_id == "HP:0001252"
    assert prefix.candidates[0].route == "exact"
    assert prefix.candidates[0].match_kind.startswith("prefix:")

    lexical = service.search(_request("hypoton", route="lexical"))
    assert lexical.shuffled is True
    assert lexical.candidates
    assert {c.route for c in lexical.candidates} == {"lexical"}
    assert {c.match_language for c in lexical.candidates} == {"en"}
```

Move the two new `import` lines to the import block at the top of the file (ruff `E402`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_search_auto.py -v`
Expected: collection error — `cannot import name 'looks_like_code' from 'ontotator.ontology.service'`.

- [ ] **Step 3: Implement the code branch**

In `src/ontotator/ontology/service.py`:

Change the imports at the top. Replace

```python
import hashlib
from collections.abc import Iterable
from pathlib import Path
from typing import Literal
```

with

```python
import hashlib
import re
from collections.abc import Iterable
from pathlib import Path
from typing import Any, Literal
```

Directly above `class OntologyService:`, add

```python
# Digits alone, PREFIX:digits or PREFIX_digits. Anything else is a keyword.
_CODE_QUERY = re.compile(r"^(?:\d+|[A-Za-z][A-Za-z0-9]*[:_]\d+)$")


def looks_like_code(query: str) -> bool:
    """Whether the single search treats this query as a term id."""
    return bool(_CODE_QUERY.match((query or "").strip()))
```

Replace the whole `search` method (from `def search(self, request: SearchRequest) -> SearchResult:` up to, but not including, `def all_ancestors_of`) with

```python
def search(self, request: SearchRequest) -> SearchResult:
    if request.route == "auto":
        hits, was_shuffled, seed = self._auto_hits(request)
    else:
        hits, was_shuffled, seed = self._route_hits(request)

    candidates = [self._candidate(hit) for hit in hits]
    displayed_ids = [c.hpo_id for c in candidates]
    ranked_ids = [c.hpo_id for c in sorted(candidates, key=lambda c: c.rank)]

    return SearchResult(
        route=request.route,
        query=request.query,
        candidates=candidates,
        displayed_ids=displayed_ids,
        ranked_ids=ranked_ids,
        shuffled=was_shuffled,
        seed=seed,
        layer_id=request.layer_id,
        ontology_sha256=self.ref.sha256,
        index_identity=self.index_identity,
    )


def _route_hits(
    self, request: SearchRequest
) -> tuple[list[dict[str, Any]], bool, str | None]:
    """One explicitly named route, exactly as the engine answers it."""
    seed: str | None = None
    if request.route in SCORED_PATHS:
        seed = shuffle_seed(
            annotator_id=request.workspace_key.annotator_id,
            mention_id=request.annotation_id,
            query=request.query,
            k=request.k,
        )
    raw_result = self.engine.search(
        query=request.query,
        path=request.route,
        k=request.k,
        seed=seed,
    )
    hits: list[dict[str, Any]] = raw_result["hits"]
    for hit in hits:
        hit["route"] = request.route
    return hits, bool(raw_result.get("shuffled", False)), seed


def _auto_hits(
    self, request: SearchRequest
) -> tuple[list[dict[str, Any]], bool, str | None]:
    """The single search: a code finds its term, a keyword finds candidates."""
    query = request.query.strip()
    if not query:
        return [], False, None

    if looks_like_code(query):
        # A typed id is a statement, not a question: that term or nothing.
        hits: list[dict[str, Any]] = self.engine.search(
            query=query, path="id", k=request.k
        )["hits"]
        for hit in hits:
            hit["route"] = "id"
        return hits, False, None

    return [], False, None


def _candidate(self, hit: dict[str, Any]) -> SearchCandidate:
    language = hit.get("matched_language")
    return SearchCandidate(
        term_id=hit["hpo_id"],
        label=hit["label"],
        definition=hit.get("definition", ""),
        matched_term=hit.get("matched_term", ""),
        match_kind=hit.get("match_kind", ""),
        rank=hit.get("rank", 0),
        display_pos=hit.get("display_pos", 0),
        score=hit.get("score"),
        obsolete=self.validate_term(hit["hpo_id"]).status == "obsolete",
        route=hit.get("route", ""),
        # "?" is the lexical index's marker for a name it could not place.
        match_language=language if language and language != "?" else None,
    )
```

(The keyword branch — the final `return [], False, None` of `_auto_hits` — is filled in by Task 3.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/test_search_auto.py -v`
Expected: all pass.

- [ ] **Step 5: Lint and types**

Run: `uv run ruff check . && uv run ruff format --check . && uv run mypy src`
Expected: no findings. If `ruff format --check` reports the new files, run `uv run ruff format src/ontotator/ontology/service.py tests/test_search_auto.py` and re-check.

- [ ] **Step 6: Commit**

```bash
git add src/ontotator/ontology/service.py tests/test_search_auto.py
git commit -m "feat(search): answer identifier-like queries on the auto route with that term alone"
```

---

### Task 3: Service — keyword queries

**Files:**
- Modify: `src/ontotator/ontology/service.py` (`_auto_hits`, imports)
- Test: `tests/test_search_auto.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_search_auto.py`:

```python
def _tiny_ontology(tmp_path: Path) -> Path:
    """`Deafness` is the label of one term and a synonym of another."""

    def node(
        local: str, label: str, synonyms: tuple[str, ...] = ()
    ) -> dict[str, object]:
        return {
            "id": f"http://purl.obolibrary.org/obo/TEST_{local}",
            "lbl": label,
            "type": "CLASS",
            "meta": {
                "synonyms": [
                    {"pred": "hasExactSynonym", "val": value} for value in synonyms
                ]
            },
        }

    payload = {
        "graphs": [
            {
                "id": "http://example.com/tiny.json",
                "meta": {"version": "http://example.com/releases/2026-06-23/tiny.json"},
                "nodes": [
                    node("0000001", "Root"),
                    node("0000002", "Deafness"),
                    node("0000003", "Hearing impairment", ("Deafness",)),
                    node("0000004", "Partial deafness"),
                ],
                "edges": [
                    {
                        "sub": f"http://purl.obolibrary.org/obo/TEST_{local}",
                        "pred": "is_a",
                        "obj": "http://purl.obolibrary.org/obo/TEST_0000001",
                    }
                    for local in ("0000002", "0000003", "0000004")
                ],
            }
        ]
    }
    path = tmp_path / "tiny.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_keyword_lists_exact_matches_first_then_similar(tmp_path: Path) -> None:
    result = _service(_tiny_ontology(tmp_path)).search(_request("deafness"))

    assert [(c.term_id, c.route, c.match_kind) for c in result.candidates] == [
        ("TEST:0000002", "exact", "label"),
        ("TEST:0000003", "exact", "hasExactSynonym"),
        ("TEST:0000004", "lexical", "ngram"),
    ]
    assert result.displayed_ids == ["TEST:0000002", "TEST:0000003", "TEST:0000004"]
    assert result.ranked_ids == ["TEST:0000002", "TEST:0000003", "TEST:0000004"]
    assert [c.rank for c in result.candidates] == [1, 2, 3]
    assert [c.display_pos for c in result.candidates] == [1, 2, 3]
    assert result.shuffled is True
    assert result.candidates[0].match_language is None
    assert result.candidates[2].match_language == "en"
    assert result.candidates[0].score is None
    assert result.candidates[2].score is not None


def test_exact_matches_take_precedence_within_k(tmp_path: Path) -> None:
    service = _service(_tiny_ontology(tmp_path))

    two = service.search(_request("deafness", k=2))
    assert two.displayed_ids == ["TEST:0000002", "TEST:0000003"]
    assert two.shuffled is False

    one = service.search(_request("deafness", k=1))
    assert one.displayed_ids == ["TEST:0000002"]


def test_keyword_on_the_fixture_has_no_duplicates_and_consistent_ranks() -> None:
    result = _service().search(_request("Seizure"))
    ids = [c.term_id for c in result.candidates]

    assert ids[0] == "HP:0001250"
    assert result.candidates[0].route == "exact"
    assert {c.route for c in result.candidates[1:]} == {"lexical"}
    assert {"HP:0011146", "HP:0002133"} <= set(ids)
    assert len(ids) == len(set(ids))
    assert len(ids) <= 10

    assert result.displayed_ids == ids
    assert [c.display_pos for c in result.candidates] == list(range(1, len(ids) + 1))
    assert sorted(c.rank for c in result.candidates) == list(range(1, len(ids) + 1))
    assert result.ranked_ids[0] == "HP:0001250"
    assert result.ranked_ids == [
        c.term_id for c in sorted(result.candidates, key=lambda c: c.rank)
    ]


def test_auto_has_no_prefix_fallback() -> None:
    result = _service().search(_request("hypoton"))

    assert result.candidates
    assert {c.route for c in result.candidates} == {"lexical"}
    assert "HP:0001252" in result.displayed_ids


def test_similar_block_is_stable_per_annotator_and_keyed_by_annotator() -> None:
    service = _service()

    first = service.search(_request("Seizure"))
    again = service.search(_request("Seizure"))
    other = service.search(_request("Seizure", workspace_key=_key("dr-other")))

    assert first.seed is not None
    assert again.seed == first.seed
    assert again.displayed_ids == first.displayed_ids
    assert other.seed != first.seed
    assert set(other.displayed_ids) == set(first.displayed_ids)
    assert other.ranked_ids == first.ranked_ids
```

Why the last test compares seeds and not orders: the fixture yields only two or three similar hits, and two different seeds can produce the same permutation of so few items. The seed is what must differ; the ranked order must not.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_search_auto.py -v`
Expected: the five new tests fail (empty candidate lists); the earlier tests still pass.

- [ ] **Step 3: Implement the keyword branch**

In `src/ontotator/ontology/service.py`, extend the import from the vendored search module. Replace

```python
from ontotator.vendor.hpo_span_annotator.search import (
    SCORED_PATHS,
    SearchEngine,
    shuffle_seed,
)
```

with

```python
from ontotator.vendor.hpo_span_annotator.search import (
    SCORED_PATHS,
    SearchEngine,
    shuffle_seed,
    shuffled,
)
```

In `_auto_hits`, replace the final line `return [], False, None` with

```python
        # Exact name matches first, in their fixed order: that a name equals the
        # query is a fact about the query, not a score. No prefix fallback here;
        # a partial word is what the similar block is for.
        exact = self.ontology.exact(query, limit=request.k)
        for position, hit in enumerate(exact, start=1):
            hit["route"] = "exact"
            hit["rank"] = position
            hit["display_pos"] = position

        seed = shuffle_seed(
            annotator_id=request.workspace_key.annotator_id,
            mention_id=request.annotation_id,
            query=request.query,
            k=request.k,
        )

        similar: list[dict[str, Any]] = []
        remaining = request.k - len(exact)
        lexical = self.engine.lexical
        if remaining > 0 and lexical is not None and lexical.ready:
            taken = {hit["hpo_id"] for hit in exact}
            ranked = [
                hit
                for hit in lexical.search(query, request.k + len(exact))
                if hit["hpo_id"] not in taken
            ][:remaining]
            # Shuffled because this order is a score. Ranks continue after the
            # exact block so one event describes the whole list.
            similar = shuffled(ranked, seed)
            for hit in similar:
                hit["route"] = "lexical"
                hit["match_kind"] = "ngram"
                hit["rank"] += len(exact)
                hit["display_pos"] += len(exact)

        return exact + similar, bool(similar), seed
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/test_search_auto.py -v`
Expected: all pass.

- [ ] **Step 5: Whole backend suite, lint, types**

Run: `uv run pytest -q && uv run ruff check . && uv run ruff format --check . && uv run mypy src`
Expected: all pass (a contract-drift test, if one exists, may still fail until Task 5). Tests noted in Task 1 Step 6 pass again. If a test asserted the old default — a shuffled, purely lexical list from a request that names no route — add `route="lexical"` (Python) or `"route": "lexical"` (JSON body) to that request and leave its assertions alone.

- [ ] **Step 6: Commit**

```bash
git add src/ontotator/ontology/service.py tests/test_search_auto.py
git commit -m "feat(search): list exact matches first and shuffled similar terms after them"
```

---

### Task 4: API — record the route of each candidate

**Files:**
- Modify: `src/ontotator/api/routes.py` (`search_ontology`, around line 526)
- Test: `tests/test_api.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_api.py`:

```python
def test_auto_search_records_the_route_of_each_candidate(app_client):
    from ontotator.domain.workspace import WorkspaceKey

    client, _ = app_client
    files = {
        "file": (
            "package.zip",
            _create_sample_package_bytes("single"),
            "application/zip",
        )
    }
    assert client.post("/api/v1/packages", files=files).status_code == 200
    opened = client.post(
        "/api/v1/workspaces/open",
        json={
            "package_id": "pkg-scenario-a",
            "document_id": "doc-beta",
            "annotator_id": "annotator-1",
            "mode": "independent",
        },
    )
    assert opened.status_code == 200, opened.text
    ws_id = opened.json()["workspace_id"]
    ws_key = opened.json()["view"]["key"]

    # No "route" in the body: the default is the single search.
    resp = client.post(
        "/api/v1/search",
        json={
            "workspace_key": ws_key,
            "annotation_id": "new-ann-1",
            "layer_id": "hpo-layer",
            "query": "hypotonia",
            "k": 5,
        },
    )
    assert resp.status_code == 200, resp.text
    result = resp.json()
    assert result["route"] == "auto"
    assert result["candidates"][0]["term_id"] == "HP:0001252"
    assert result["candidates"][0]["route"] == "exact"

    repo = client.app.state.repo
    event = repo.get_search_event(result["search_id"])
    assert event is not None
    assert event.route == "auto"
    assert event.candidates == result["displayed_ids"]
    assert event.candidate_routes == {
        c["term_id"]: c["route"] for c in result["candidates"]
    }
    assert event.candidate_routes["HP:0001252"] == "exact"

    # Selecting from that search keeps the routes on the selection event.
    resp = client.post(
        f"/api/v1/workspaces/{ws_id}/commands",
        json={
            "mutation_id": "mut-select-1",
            "expected_revision": 0,
            "payload": {
                "command": "create_annotation",
                "annotation_id": "new-ann-1",
                "layer_id": "hpo-layer",
                "type_id": "phenotype",
                "term_id": "HP:0001252",
                "axes": {"assertion": "present"},
                "evidence_id": "ev-hypo",
                "segments": [{"start": 30, "end": 44}],
                "search_event_id": result["search_id"],
            },
        },
    )
    assert resp.status_code == 200, resp.text

    events = repo.get_search_events_for_workspace(WorkspaceKey.model_validate(ws_key))
    selections = [e for e in events if e.selected_term_id == "HP:0001252"]
    assert len(selections) == 1
    assert selections[0].source_search_event_id == result["search_id"]
    assert selections[0].route == "auto"
    assert selections[0].candidate_routes["HP:0001252"] == "exact"
    assert selections[0].displayed_position == 1
    assert selections[0].ranked_position == 1
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest tests/test_api.py::test_auto_search_records_the_route_of_each_candidate -v`
Expected: FAIL at `assert event.candidate_routes == {...}` — the stored event has `{}`.

- [ ] **Step 3: Store the routes**

In `src/ontotator/api/routes.py`, in `search_ontology`, in the `SearchEventRecord(...)` call, after

```python
candidate_scores = (
    {c.term_id: c.score for c in result.candidates if c.score is not None},
)
```

add

```python
candidate_routes = ({c.term_id: c.route for c in result.candidates if c.route},)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run pytest tests/test_api.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/ontotator/api/routes.py tests/test_api.py
git commit -m "feat(search): store the route of every candidate in the search event"
```

---

### Task 5: Regenerate the contract

**Files:**
- Regenerate: `contracts/openapi.json`
- Regenerate: `frontend/src/api/generated.ts`

- [ ] **Step 1: Export the OpenAPI schema**

Run (repo root): `uv run python scripts/export_openapi.py`
Then: `uv run python scripts/export_openapi.py --check`
Expected: the check exits 0.

- [ ] **Step 2: Regenerate the TypeScript types**

Run (in `frontend/`): `npm run api:generate && npm run api:check`
Expected: `api:check` reports no drift.

- [ ] **Step 3: Verify the diff**

Run: `git diff --stat contracts/openapi.json frontend/src/api/generated.ts`
Then: `git diff frontend/src/api/generated.ts`
Expected, and nothing else: in `SearchRequest`, `route` is `"auto" | "lexical" | "exact" | "id" | "browse"` with default `auto`; in `SearchCandidate`, new optional `route: string` and `match_language?: string | null`. (`SearchEventRecord` appears only if it was already part of the contract; then it gains `candidate_routes`.)

- [ ] **Step 4: Typecheck**

Run (in `frontend/`): `npm run typecheck`
Expected: no errors (`"auto"` is not yet used by the frontend; existing code still compiles).

- [ ] **Step 5: Commit**

```bash
git add contracts/openapi.json frontend/src/api/generated.ts
git commit -m "build: regenerate the API contract for the auto search route"
```

---

### Task 6: Frontend — `SearchManager` defaults to `auto`

**Files:**
- Modify: `frontend/src/editor/searchState.ts`
- Test: `frontend/tests/searchState.test.ts`

- [ ] **Step 1: Write the failing test**

In `frontend/tests/searchState.test.ts`, inside `describe("SearchManager", () => { … })`, directly after the test `"returns empty candidates immediately for empty or whitespace query without calling API"`, add

```ts
  it("sends the auto route unless a route is named", async () => {
    searchOntologySpy.mockResolvedValue({ route: "auto", query: "seizure", candidates: [] });
    const manager = new SearchManager(mockClient);

    expect(manager.getState().route).toBe("auto");
    await manager.search("seizure", "ann-1", sampleKey);
    expect(searchOntologySpy.mock.calls[0][0].route).toBe("auto");
    expect(manager.getState().route).toBe("auto");

    await manager.search("seizure", "ann-1", sampleKey, "exact");
    expect(searchOntologySpy.mock.calls[1][0].route).toBe("exact");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run (in `frontend/`): `npx vitest run tests/searchState.test.ts`
Expected: FAIL — `expected 'lexical' to be 'auto'`.

- [ ] **Step 3: Change the default**

In `frontend/src/editor/searchState.ts`:

After the line `export type WorkspaceKey = components["schemas"]["WorkspaceKey"];`, add

```ts
export type SearchRoute = NonNullable<SearchRequest["route"]>;
```

In `interface SearchState`, replace

```ts
  route: "lexical" | "exact" | "id" | "browse";
```

with

```ts
  route: SearchRoute;
```

In the initial state of `SearchManager`, replace `route: "lexical",` with `route: "auto",`.

In the signature of `search`, replace

```ts
    route: "lexical" | "exact" | "id" | "browse" = "lexical",
```

with

```ts
    route: SearchRoute = "auto",
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (in `frontend/`): `npx vitest run tests/searchState.test.ts && npm run typecheck`
Expected: all pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/editor/searchState.ts frontend/tests/searchState.test.ts
git commit -m "feat(frontend): make auto the default search route"
```

---

### Task 7: Frontend — `SearchPanel` without a strategy selector

**Files:**
- Modify: `frontend/src/editor/SearchPanel.tsx`
- Test: `frontend/tests/searchPanel.test.tsx` (create)

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/searchPanel.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchPanel } from "../src/editor/SearchPanel";
import { SearchManager } from "../src/editor/searchState";

const key = {
  package_id: "pkg",
  document_id: "doc",
  annotator_id: "dr-a",
  mode: "independent" as const,
  scope_id: "scope-default",
  target_set_id: "empty",
};

const renderPanel = (searchOntology: ReturnType<typeof vi.fn>) => {
  const manager = new SearchManager({ searchOntology } as any);
  render(
    <SearchPanel
      searchManager={manager}
      annotationId="a"
      workspaceKey={key}
      layerId="phenotype"
      onSelectCandidate={vi.fn()}
      debounceMs={0}
    />
  );
  return screen.getByLabelText(/Search ontology term/i);
};

describe("SearchPanel", () => {
  afterEach(cleanup);

  it("has no strategy selector, only the search box and one hint", () => {
    renderPanel(vi.fn().mockResolvedValue({ search_id: "s", candidates: [] }));

    expect(screen.queryByLabelText(/Search Strategy/i)).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("Search by name or code (e.g. HP:0001250)")).toBeDefined();
  });

  it("sends one auto request per input, for a code and for a keyword", async () => {
    const searchOntology = vi.fn().mockResolvedValue({ search_id: "s", candidates: [] });
    const input = renderPanel(searchOntology);

    fireEvent.change(input, { target: { value: "HP:0001250" } });
    await waitFor(() => expect(searchOntology).toHaveBeenCalledTimes(1));
    expect(searchOntology.mock.calls[0][0].route).toBe("auto");
    expect(searchOntology.mock.calls[0][0].query).toBe("HP:0001250");

    fireEvent.change(input, { target: { value: "seizure" } });
    await waitFor(() => expect(searchOntology).toHaveBeenCalledTimes(2));
    expect(searchOntology.mock.calls[1][0].route).toBe("auto");
    expect(searchOntology.mock.calls[1][0].query).toBe("seizure");
  });

  it("shows what matched with its kind, and the language when it is not English", async () => {
    const searchOntology = vi.fn().mockResolvedValue({
      search_id: "s",
      candidates: [
        {
          term_id: "HP:0001252",
          label: "Hypotonia",
          matched_term: "Muskelhypotonie",
          match_kind: "translation",
          match_language: "de",
          route: "exact",
          rank: 1,
          display_pos: 1,
        },
        {
          term_id: "HP:0001250",
          label: "Seizure",
          matched_term: "Seizures",
          match_kind: "hasExactSynonym",
          match_language: "en",
          route: "lexical",
          rank: 2,
          display_pos: 2,
        },
        {
          term_id: "HP:0001284",
          label: "Areflexia",
          matched_term: "Areflexia",
          match_kind: "label",
          route: "lexical",
          rank: 3,
          display_pos: 3,
        },
      ],
    });
    const input = renderPanel(searchOntology);
    fireEvent.change(input, { target: { value: "muskel" } });

    expect(await screen.findByText("Match: »Muskelhypotonie« (translation, de)")).toBeDefined();
    expect(screen.getByText("Match: »Seizures« (hasExactSynonym)")).toBeDefined();
    expect(screen.getAllByText(/^Match:/)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (in `frontend/`): `npx vitest run tests/searchPanel.test.tsx`
Expected: 3 failures — the selector exists; the code query is sent with `route: "id"` and the keyword with `"lexical"`; the first match line reads `(translation)` without the language.

- [ ] **Step 3: Remove the route handling**

In `frontend/src/editor/SearchPanel.tsx`, replace everything from the line `const runSearch = (val: string, effectiveRoute: …` up to and including the line `const isObsolete = (c: SearchCandidate): boolean => c.obsolete === true;` with

```tsx
  const runSearch = (val: string, immediate = false) => {
    cancelDebounce();
    if (immediate || debounceMs <= 0 || !val.trim()) {
      void searchManager.search(val, annotationId, workspaceKey, "auto", 10, layerId);
      return;
    }
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null;
      void searchManager.search(val, annotationId, workspaceKey, "auto", 10, layerId);
    }, debounceMs);
  };
  const [state, setState] = useState<SearchState>(searchManager.getState());
  const [queryInput, setQueryInput] = useState<string>("");

  useEffect(() => {
    return searchManager.subscribe((nextState) => {
      setState(nextState);
    });
  }, [searchManager]);

  useEffect(() => {
    cancelDebounce();
    searchManager.clear();
    setQueryInput("");
  }, [annotationId, workspaceKey, layerId, searchManager]);

  const handleQueryChange = (val: string) => {
    setQueryInput(val);
    runSearch(val);
  };

  const handleClear = () => {
    cancelDebounce();
    setQueryInput("");
    searchManager.clear();
  };

  const isObsolete = (c: SearchCandidate): boolean => c.obsolete === true;

  // What matched, and in which language when it was not an English name.
  const matchDetail = (c: SearchCandidate): string =>
    c.match_language && c.match_language !== "en"
      ? `${c.match_kind}, ${c.match_language}`
      : `${c.match_kind}`;
```

- [ ] **Step 4: Update the input, the hint, and remove the selector**

In the same file:

Replace

```tsx
            placeholder="Search term or identifier (e.g. 1250, HP:0001250, MONDO:0001250)"
```

with

```tsx
            placeholder="Name or code"
```

Replace

```tsx
                runSearch(queryInput, route, true);
```

with

```tsx
                runSearch(queryInput, true);
```

Replace

```tsx
          Pure digits search the main ontology. For other prefixes, provide the full identifier (e.g. MONDO:0001250).
```

with

```tsx
          Search by name or code (e.g. HP:0001250)
```

Delete the whole second form group, i.e. this block:

```tsx
      <div className="form-group">
        <label htmlFor="search-route-select" className="form-label">
          Search Strategy
        </label>
        <select
          id="search-route-select"
          className="form-select"
          value={route}
          onChange={(e) =>
            handleRouteChange(e.target.value as "lexical" | "exact" | "id" | "browse")
          }
        >
          <option value="lexical">Lexical similarity</option>
          <option value="exact">Exact term</option>
          <option value="id">Identifier (e.g. HP:..., MONDO:...)</option>
          <option value="browse">Hierarchy (Parents/Children)</option>
        </select>
      </div>

```

- [ ] **Step 5: Show kind and language in the match line**

Replace

```tsx
                    Match: »{cand.matched_term}« ({cand.match_kind})
```

with

```tsx
                    {`Match: »${cand.matched_term}« (${matchDetail(cand)})`}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run (in `frontend/`): `npx vitest run tests/searchPanel.test.tsx && npm run typecheck && npm test`
Expected: the three new tests pass, no type errors (in particular no leftover reference to `route`, `setRoute`, `userSelectedRoute`, `isIdLike` or `handleRouteChange`), and the whole Vitest suite passes.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/editor/SearchPanel.tsx frontend/tests/searchPanel.test.tsx
git commit -m "feat(frontend): replace the search strategy selector with one search box"
```

---

### Task 8: Verification, a look at the result, embedded assets

- [ ] **Step 1: All checks**

Run (in `frontend/`): `npm run typecheck && npm test && npm run api:check && npm run build && npx playwright test`
Run (repo root): `uv run pytest -q && uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run python scripts/export_openapi.py --check`
Expected: everything passes. The browser specs type either a code (`HP:0001250`, `HP:0001252` in `browser/layers.spec.ts`) or the keyword `Hypotonia` and then pick that term; both work on the `auto` route without changes. If a browser spec fails because it picked a candidate **by position**, change it to pick by term name; do not change the search.

- [ ] **Step 2: Look at it**

With a temporary Playwright spec (delete it afterwards, do not commit it), modelled on the setup in `frontend/browser/workflow.spec.ts`, take screenshots at 1280x720 into a directory outside the repo and look at each one:

1. The empty search panel of a new annotation: one input, one hint line, no selector.
2. Query `Hypotonia`: Hypotonia is the first card.
3. Query `hypoton`: candidates are listed and each shows a "Match" line where the matched name differs from the label.
4. Query `HP:0001250`: exactly one card, Seizure.
5. Query `HP:9999999`: no cards and no error box.

Check that the panel is not left with an odd gap where the selector was.

- [ ] **Step 3: Rebuild the embedded web assets and commit**

```bash
uv run python -c "import sys; sys.path.insert(0, 'scripts'); from build_common import build_frontend, sync_embedded_web_assets; sync_embedded_web_assets(build_frontend(npm_ci=False))"
git add src/ontotator/web
git commit -m "build: rebuild embedded web assets"
```

- [ ] **Step 4: Report**

Branch and commits, the actual numbers from Step 1, every deviation from this plan (what, where, why), what the screenshots show including anything that looks off, and the screenshot paths. Do not merge or push.

---

## Notes for the implementer

- **Why exact matches are not shuffled but similar ones are:** see the module docstring of `src/ontotator/vendor/hpo_span_annotator/search.py`. An order that comes from a similarity score anchors the reader; an exact name match is a fact.
- **Seed:** unchanged from the lexical route — annotator, annotation, normalised query, `k`. Part 2 adds the language selection to it.
- **`match_language`:** in this part only lexical hits carry a language, and without translation files it is always `"en"`. Part 2 makes exact matches on translated names report theirs.
- **Old application versions:** `SearchEventRecord` forbids unknown fields, so a version of the app from before this change cannot read a package that contains events with `candidate_routes`. Reading old packages with the new version works (covered by Task 1 and the existing fixture tests).
