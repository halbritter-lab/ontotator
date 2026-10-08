# Term Search, Part 3: Tree — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## TL;DR (Deutsch)

- Am Term einer eigenen Annotation öffnet „Show in tree" den Ontologie-Baum, aufgeklappt am Term. Ein Klick wählt aus, „Use this term" schickt `set_term` mit der ID des Baum-Durchgangs als `search_event_id`.
- Zwei neue Endpunkte (`tree/open`, `tree/node`). Das Ereignis aus `tree/open` (`route = "browse"`) wächst mit jedem aufgeklappten Knoten; dafür bekommt das Repository genau eine Methode zum Anhängen, und der Paket-Import duldet zwei Stände desselben Durchgangs.
- **Layout-Entscheidung für „angeheftet":** Der Baum sitzt in der rechten Spalte unter dem Annotations-Bereich (ab 1100 px), ab 1600 px als eigene vierte Spalte ganz rechts. Eine vierte Spalte bei 1280 px ließe dem Falltext nur 200 px. Preis: bei 1280×720 teilen sich Annotations-Bereich und Baum die Höhe (ca. 260 px und 400 px) und scrollen beide.
- **Abweichung von der Schnittstelle im Design:** `tree/node` bekommt das Feld `expand`. Ohne es könnte der Server nicht unterscheiden, ob Kinder nur geladen oder wirklich gezeigt wurden, und das Protokoll würde ungesehene Terme als „gezeigt" führen.
- Dreizehn Aufgaben: Baum-Hilfen, Details, wachsendes Ereignis, Endpunkte, Einstellung, Vertrag, Zustandslogik, Baum-Element, Baum-Fenster, Einstieg und Übernahme, Anheften, Browser-Test, Abschlussprüfung.
- **Ausgeführt wurde nur der Code aus Aufgabe 1 und 2** (14 Tests grün, ruff und mypy sauber, in einer Wegwerf-Kopie außerhalb des Repos). Alles andere ist gegen den gelesenen Code geschrieben, aber nicht gelaufen. Siehe „What was and was not run" am Ende.

**Goal:** Let an annotator walk the ontology from the term of one of their annotations to a broader or narrower term and assign it, with the walk recorded like a search.

**Architecture:** A new module `ontocurator/ontology/tree.py` answers roots, children and root-to-term paths over the vendored `Ontology`, leaving obsolete terms out. A new router `ontocurator/api/tree_routes.py` exposes `POST /api/v1/terms/tree/open` and `POST /api/v1/terms/tree/node`; both run the same workspace and layer checks as `POST /search` (the checks move into one shared function). `tree/open` stores a `SearchEventRecord` with `route="browse"`, and every `tree/node` appends the terms that became visible to that event, so the existing `set_term` check (term must be among the event's candidates) and the existing selection event work unchanged. In the frontend, `treeState.ts` holds the pure logic (rows, keyboard moves), `TermTree.tsx` is a hand-written ARIA tree with roving focus, and `TreeBrowser.tsx` loads data and shows the details; it renders as a modal dialog or, pinned, as a panel inside the case layout.

**Tech Stack:** Python 3 / FastAPI / Pydantic v2 / SQLite, pytest, ruff, mypy (strict); React 18 + TypeScript (strict, `noUnusedLocals`), Vitest + Testing Library (jsdom), Playwright; OpenAPI contract in `contracts/openapi.json` with generated types in `frontend/src/api/generated.ts`. No new npm or Python dependencies.

**Spec:** `docs/superpowers/specs/2026-10-07-term-search-design.md`, section 4 ("Baum") and the tree lines of section 5.

## Read this first: Part 2 comes before this plan

Part 2 (translations) is implemented **before** this plan is executed. It changes, among others, `src/ontocurator/ontology/service.py`, `src/ontocurator/ontology/provenance.py`, `src/ontocurator/api/routes.py`, `src/ontocurator/application/preferences.py` (new field `search_languages_by_annotator`), `frontend/src/editor/SearchPanel.tsx`, `frontend/src/App.tsx` possibly, the contract files, and it fills `Term.translations`.

This plan was written against the code **before** Part 2. It is built to survive that:

- New backend logic lives in new files (`ontology/tree.py`, `api/tree_routes.py`). `service.py`, `provenance.py` and `SearchPanel.tsx` are not edited at all.
- Every edit of an existing file is anchored on exact text, never on a line number.
- `tree_pinned_by_annotator` is added next to `mode_by_package`, wherever Part 2 put its own field.

Still: **before Task 1, re-read every file in the "modify" rows of the table below as it is now**, run the anchor check in Task 0, and reconcile. If an anchor is gone, find the new place by meaning and note the deviation in your report. If Part 2 already extracted the checks of `search_ontology` into a function, use that function instead of creating `layer_ontology` (Task 4).

**Conventions used below**

- All `npm`/`npx` commands run in `frontend/`. All `uv`/`git` commands run in the repo root. The shell is Git Bash on Windows.
- Work on the existing branch `feat/term-search`. Do not merge or push.
- Commit messages follow the repo style (`feat(tree): …`, `feat(frontend): …`, `test(e2e): …`, `build: …`). Do **not** add any `Co-Authored-By` or "Generated with" lines.
- Before every commit that touches Python files, run `uv run ruff check --fix <those files>` and `uv run ruff format <those files>`; CI runs `ruff check .` and `ruff format --check .` over tests as well. (`docs/work-package-v2.md` already fails the format check; leave it alone.)
- Do not edit files under `src/ontocurator/vendor/`.
- Some Python snippets below are methods shown at column 0 (the Markdown formatter of `ruff` removes the class indentation, as it did in Part 1's plan). Where a step says a method goes into a class, indent it by four spaces.
- When a test in this plan fails after you typed the implementation as given, the implementation in this plan is the first suspect, not the test: from Task 3 on the code was not executed (see the end of this plan). Fix the implementation; change a test only if it contradicts the spec, and say so in your report.
- Test ontology `tests/fixtures/hp.json` is a single-parent tree: `HP:0000001` All > `HP:0000118` Phenotypic abnormality > { `HP:0000707` Abnormality of the nervous system > { `HP:0001284` Areflexia, `HP:0001252` Hypotonia, `HP:0001250` Seizure > { `HP:0011146` Dialeptic seizure, `HP:0002133` Status epilepticus } }, `HP:0000365` Hearing impairment > `HP:0000407` Sensorineural hearing impairment }, plus the obsolete, parentless `HP:0000123`. Multi-parent behaviour is tested with a synthetic ontology written by the test (Task 1).

## File structure

| File | Action | Responsibility |
|---|---|---|
| `src/ontocurator/ontology/tree.py` | create | Roots, children, paths, term details; the models of a tree answer |
| `src/ontocurator/storage/repository.py` | modify | Append shown terms to a stored event; tolerate two states of one walk on import |
| `src/ontocurator/api/routes.py` | modify | Move the checks of `search_ontology` into `layer_ontology` |
| `src/ontocurator/api/tree_routes.py` | create | `tree/open`, `tree/node`, the walk's event |
| `src/ontocurator/api/app.py` | modify | Include the tree router |
| `src/ontocurator/application/preferences.py` | modify | `tree_pinned_by_annotator` |
| `tests/test_ontology_tree.py` | create | Tree helpers, single- and multi-parent |
| `tests/test_tree_events.py` | create | The growing event in the repository and on import |
| `tests/test_tree_api.py` | create | Endpoints, event log, `set_term` from a walk, export |
| `tests/test_preferences_api.py` | modify | The pin preference |
| `contracts/openapi.json` | regenerate | API contract |
| `frontend/src/api/generated.ts` | regenerate | Types from the contract |
| `frontend/src/api/client.ts` | modify | `openTree`, `loadTreeNode`, tree types |
| `frontend/src/editor/treeState.ts` | create | Rows of the visible tree, keyboard moves (pure functions) |
| `frontend/src/editor/TermTree.tsx` | create | ARIA tree with roving focus |
| `frontend/src/editor/TreeBrowser.tsx` | create | Loads a walk, details pane, "Use this term"; dialog and panel |
| `frontend/src/editor/useMinWidth.ts` | create | Media-query hook for the pin threshold |
| `frontend/src/editor/AnnotationPanel.tsx` | modify | "Show in tree" button |
| `frontend/src/app/CaseScreen.tsx` | modify | Opens the tree, assigns from it, docks it when pinned |
| `frontend/src/App.tsx` | modify | Hands the pin preference to the case screen and saves it |
| `frontend/src/styles.css` | modify | Tree, dialog, pinned layout |
| `frontend/tests/treeState.test.ts` | create | Pure logic |
| `frontend/tests/termTree.test.tsx` | create | Tree widget |
| `frontend/tests/treeBrowser.test.tsx` | create | Tree browser |
| `frontend/tests/caseTree.test.tsx` | create | Case screen with the tree |
| `frontend/tests/apiClient.test.ts` | modify | The two client methods |
| `frontend/browser/tree.spec.ts` | create | Real browser: pick, keyboard, pinned |
| `src/ontocurator/web/` | regenerate | Embedded SPA build (git-tracked) |

The API in one place, so later tasks can be read on their own:

```
POST /api/v1/terms/tree/open
  request   workspace_key, annotation_id, layer_id, term_id
  response  browse_id, start_status ("valid" | "obsolete" | "unknown"),
            roots: TreeNode[], path: string[], levels: TreeLevel[],
            detail: TreeTermDetail | null

POST /api/v1/terms/tree/node
  request   workspace_key, annotation_id, layer_id, browse_id, term_id,
            via_parent_id? (string), expand? (boolean, default false)
  response  detail: TreeTermDetail, children: TreeNode[],
            path: string[], levels: TreeLevel[]

TreeNode        term_id, label, child_count
TreeLevel       term_id, children: TreeNode[]        (an expanded node and what is under it)
TreeTermDetail  term_id, label, definition, synonyms: string[],
                translations: {language: string[]}, parents: TreeNode[]
```

`path` is the list of term ids from a root down to the term. `levels` holds one entry per node that the client shall show expanded. On `open`, `levels` covers every node of `path` including the start term. On `node`, `children` is filled only with `expand: true`, and `path`/`levels` only with `via_parent_id` (then `levels` covers the ancestors on that path, not the term itself).

---

### Task 0: Commit the plan, baseline, reconcile with Part 2

**Files:**
- Add: `docs/superpowers/plans/2026-10-08-term-search-3-tree.md`

- [ ] **Step 1: Confirm the branch and that Part 2 is in**

Run: `git branch --show-current`
Expected: `feat/term-search`

Run: `git log --oneline -15`
Expected: the commits of Part 2 (translations) are there. If they are not, stop and ask: this plan is sequenced after Part 2.

- [ ] **Step 2: Commit the plan**

```bash
git add docs/superpowers/plans/2026-10-08-term-search-3-tree.md
git commit -m "docs: plan for the ontology tree"
```

- [ ] **Step 3: Baseline**

Run (repo root): `uv sync && uv run pytest -q`
Run (in `frontend/`): `npm ci && npm run typecheck && npm test`
Expected: everything passes. If something fails before any change, stop and report it.

- [ ] **Step 4: Check the anchors this plan edits at**

Run (repo root):

```bash
chk() { printf '%s  %s  %s\n' "$(grep -c -F -- "$2" "$1")" "$1" "$2"; }
chk src/ontocurator/api/routes.py '@router.post("/search")'
chk src/ontocurator/api/routes.py '    require_mode_allowed(request, req.workspace_key.mode)'
chk src/ontocurator/api/routes.py '    ontology = request.app.state.ontology_registry.for_layer(profile, req.layer_id)'
chk src/ontocurator/api/routes.py '    result = cast(SearchResult, ontology.search(req))'
chk src/ontocurator/api/app.py '    app.include_router(router)'
chk src/ontocurator/api/app.py 'from ontocurator.api.security import verify_security'
chk src/ontocurator/storage/repository.py 'from collections.abc import Callable'
chk src/ontocurator/storage/repository.py '    def get_search_event(self, event_id: str) -> SearchEventRecord | None:'
chk src/ontocurator/storage/repository.py 'def _legacy_key_str(key: WorkspaceKey) -> str:'
chk src/ontocurator/storage/repository.py '                raise InvalidPackage("Conflicting search event content")'
chk src/ontocurator/application/preferences.py '    mode_by_package: dict[str, PreferenceMode] = Field(default_factory=dict)'
chk src/ontocurator/application/preferences.py '    mode_by_package: dict[str, PreferenceMode] | None = None'
chk src/ontocurator/application/preferences.py '                prefs.mode_by_package.update(change.mode_by_package)'
chk src/ontocurator/application/preferences.py '            if isinstance(data.get("legacy_config"), dict):'
chk frontend/src/api/client.ts 'export type SearchCandidate = components["schemas"]["SearchCandidate"];'
chk frontend/src/api/client.ts '  async resolveTermLabels(packageId: string, terms: TermLookup[]): Promise<TermLabel[]> {'
chk frontend/src/editor/AnnotationPanel.tsx '              <TermName termId={currentTerm} label={termLabel} />'
chk frontend/src/editor/AnnotationPanel.tsx '  onDeselect?: () => void;'
chk frontend/src/editor/AnnotationPanel.tsx '  onDeselect,'
chk frontend/src/app/CaseScreen.tsx 'import { TextPane } from "../editor/TextPane";'
chk frontend/src/app/CaseScreen.tsx '  const [mobilePane, setMobilePane] = useState<"list" | "text" | "details">("text");'
chk frontend/src/app/CaseScreen.tsx '  const handleUpdateTerm = async (termId: string, searchId?: string) => {'
chk frontend/src/app/CaseScreen.tsx '  const modalOpen = !!(confirmRequest || completedSubmission || historySubmission || submitDialogOpen || showShortcutHelp);'
chk frontend/src/app/CaseScreen.tsx '      <div className={`app-layout mobile-pane-${mobilePane}`}>'
chk frontend/src/app/CaseScreen.tsx '              onSelectEvidence={(evId) => setSelectedEvidenceId(evId)}'
chk frontend/src/app/CaseScreen.tsx '      {historySubmission && <div className="modal-overlay">'
chk frontend/src/app/CaseScreen.tsx '  onSubmitted?: () => void | Promise<void>;'
chk frontend/src/app/CaseScreen.tsx '  onSubmitted,'
chk frontend/src/App.tsx '      modeByPackageRef.current = modes;'
chk frontend/src/App.tsx '            onClose={() => { void closeWorkspace(); }}'
chk frontend/src/App.tsx '  const [mode, setMode] = useState<WorkspaceMode>("independent");'
chk frontend/tests/apiClient.test.ts '  it("maps 409 Conflict to ConflictError", async () => {'
```

Expected: every line starts with `1` (that was the state before Part 2). For every line that does not, open the file, find where that text went, and write down the new anchor before you start the task that uses it.

---

### Task 1: Backend — roots, children and paths

**Files:**
- Create: `src/ontocurator/ontology/tree.py`
- Test: `tests/test_ontology_tree.py` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests/test_ontology_tree.py`:

```python
"""The ontology tree: roots, children and paths, without the API."""

import json
from pathlib import Path

import pytest

from ontocurator.domain.errors import DomainError
from ontocurator.ontology.tree import OntologyTree
from ontocurator.vendor.hpo_span_annotator.hpo import load

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "hp.json"

# id -> (label, parents, obsolete). Ids are chosen so that sorting by id and
# sorting by label disagree everywhere it matters.
GRAPH: dict[str, tuple[str, tuple[str, ...], bool]] = {
    "0000001": ("Root", (), False),
    "0000003": ("Alpha", ("0000001",), False),
    "0000002": ("Beta", ("0000001",), False),
    "0000004": ("Gamma", ("0000003",), False),
    # Short way under Beta, long way under Alpha > Gamma.
    "0000005": ("Shortcut", ("0000004", "0000002"), False),
    # Two equally short ways; the file names Beta first.
    "0000006": ("Twin", ("0000002", "0000003"), False),
    "0000007": ("Zulu", ("0000003",), False),
    "0000008": ("Able", ("0000002",), False),
    # Root > Alpha > Zulu > Deep and Root > Beta > Able > Deep.
    "0000009": ("Deep", ("0000008", "0000007"), False),
    "0000010": ("Retired child", ("0000003",), True),
    "0000011": ("Retired root", (), True),
    "0000012": ("Orphan of a retired term", ("0000011",), False),
    "0000013": ("Another root", (), False),
}


def _iri(local: str) -> str:
    return f"http://purl.obolibrary.org/obo/TEST_{local}"


def tid(local: str) -> str:
    return f"TEST:{local}"


def write_graph_ontology(directory: Path) -> Path:
    """Write the multi-parent test ontology and return its path."""
    payload = {
        "graphs": [
            {
                "id": "http://example.com/tree.json",
                "meta": {"version": "http://example.com/releases/2026-06-23/tree.json"},
                "nodes": [
                    {
                        "id": _iri(local),
                        "lbl": label,
                        "type": "CLASS",
                        "meta": {"deprecated": True} if obsolete else {},
                    }
                    for local, (label, _, obsolete) in GRAPH.items()
                ],
                "edges": [
                    {"sub": _iri(local), "pred": "is_a", "obj": _iri(parent)}
                    for local, (_, parents, _) in GRAPH.items()
                    for parent in parents
                ],
            }
        ]
    }
    path = directory / "tree.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def _graph_tree(tmp_path: Path) -> OntologyTree:
    return OntologyTree(load(write_graph_ontology(tmp_path)))


def _fixture_tree() -> OntologyTree:
    return OntologyTree(load(FIXTURE_PATH))


def test_roots_are_live_terms_without_live_parents_sorted_by_label(
    tmp_path: Path,
) -> None:
    tree = _graph_tree(tmp_path)

    assert tree.roots() == [tid("0000013"), tid("0000012"), tid("0000001")]
    assert [n.label for n in tree.nodes(tree.roots())] == [
        "Another root",
        "Orphan of a retired term",
        "Root",
    ]
    assert _fixture_tree().roots() == ["HP:0000001"]


def test_children_are_sorted_by_label_and_leave_out_obsolete_terms(
    tmp_path: Path,
) -> None:
    fixture = _fixture_tree()
    # By id this would be 1250, 1252, 1284.
    assert fixture.children_of("HP:0000707") == [
        "HP:0001284",
        "HP:0001252",
        "HP:0001250",
    ]
    assert fixture.children_of("HP:0002133") == []
    assert fixture.children_of("HP:9999999") == []

    tree = _graph_tree(tmp_path)
    assert [n.label for n in tree.nodes(tree.children_of(tid("0000003")))] == [
        "Gamma",
        "Twin",
        "Zulu",
    ]
    alpha = tree.node(tid("0000003"))
    assert (alpha.label, alpha.child_count) == ("Alpha", 3)
    # A retired term has no place in the tree, not even when asked for directly.
    assert tree.children_of(tid("0000011")) == []


def test_single_parent_path_runs_from_the_root_to_the_term() -> None:
    tree = _fixture_tree()

    assert tree.path_to("HP:0002133") == [
        "HP:0000001",
        "HP:0000118",
        "HP:0000707",
        "HP:0001250",
        "HP:0002133",
    ]
    assert tree.path_to("HP:0000001") == ["HP:0000001"]
    # Ids resolve the way they do everywhere else.
    assert tree.path_to("hp:0001250")[-1] == "HP:0001250"


def test_unknown_and_obsolete_terms_have_no_path() -> None:
    tree = _fixture_tree()

    assert tree.path_to("HP:9999999") == []
    assert tree.path_to("HP:0000123") == []


def test_the_shortest_path_wins_over_the_alphabetically_first(tmp_path: Path) -> None:
    tree = _graph_tree(tmp_path)

    assert tree.path_to(tid("0000005")) == [
        tid("0000001"),
        tid("0000002"),
        tid("0000005"),
    ]


def test_equally_short_paths_are_decided_by_label_not_by_id_or_file_order(
    tmp_path: Path,
) -> None:
    tree = _graph_tree(tmp_path)

    # Alpha has the higher id and comes second in the file.
    assert tree.path_to(tid("0000006")) == [
        tid("0000001"),
        tid("0000003"),
        tid("0000006"),
    ]


def test_the_tie_is_decided_from_the_root_down(tmp_path: Path) -> None:
    tree = _graph_tree(tmp_path)

    # The direct parents are Able and Zulu; Alpha before Beta decides, one
    # level further up.
    assert tree.path_to(tid("0000009")) == [
        tid("0000001"),
        tid("0000003"),
        tid("0000007"),
        tid("0000009"),
    ]


def test_via_parent_forces_the_last_step(tmp_path: Path) -> None:
    tree = _graph_tree(tmp_path)

    assert tree.path_to(tid("0000005"), via_parent_id=tid("0000004")) == [
        tid("0000001"),
        tid("0000003"),
        tid("0000004"),
        tid("0000005"),
    ]
    assert tree.path_to(tid("0000009"), via_parent_id=tid("0000008")) == [
        tid("0000001"),
        tid("0000002"),
        tid("0000008"),
        tid("0000009"),
    ]


@pytest.mark.parametrize("not_a_parent", ["0000001", "0000007", "0000099"])
def test_via_parent_must_be_a_parent_of_the_term(
    tmp_path: Path, not_a_parent: str
) -> None:
    tree = _graph_tree(tmp_path)

    with pytest.raises(DomainError) as raised:
        tree.path_to(tid("0000005"), via_parent_id=tid(not_a_parent))
    assert raised.value.code == "INVALID_TREE_PARENT"


def test_a_retired_parent_is_no_way_into_the_tree(tmp_path: Path) -> None:
    tree = _graph_tree(tmp_path)

    assert tree.parents_of(tid("0000012")) == []
    assert tree.path_to(tid("0000012")) == [tid("0000012")]
    with pytest.raises(DomainError):
        tree.path_to(tid("0000012"), via_parent_id=tid("0000011"))
```

What each multi-parent test rules out: "shortest wins" fails for an implementation that sorts parents by label first; "decided by label" fails for one that takes the first parent in the file or the smallest id; "from the root down" fails for one that compares only the direct parents (Able would beat Zulu).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_ontology_tree.py -q`
Expected: collection error — `ModuleNotFoundError: No module named 'ontocurator.ontology.tree'`.

- [ ] **Step 3: Implement the helpers**

Create `src/ontocurator/ontology/tree.py`:

```python
"""The ontology as a tree to walk: roots, children and paths from a root.

Search answers "which term has this name". The tree answers the question a
ranked list cannot: what lies next to, above and below a term. Nothing here is
scored and nothing is shuffled; children come in alphabetical order.

Obsolete terms are not part of the tree. A term whose parents are all obsolete
is therefore shown as a root rather than lost.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from ontocurator.domain.errors import DomainError
from ontocurator.vendor.hpo_span_annotator.hpo import Ontology, Term


class TreeNode(BaseModel):
    """One row of the tree."""

    model_config = ConfigDict(extra="forbid")

    term_id: str
    label: str
    child_count: int


class OntologyTree:
    """Read-only tree view of a loaded ontology."""

    def __init__(self, ontology: Ontology) -> None:
        self.ontology = ontology

    def live(self, term_id: str) -> Term | None:
        """The term behind an id (alternative ids resolve), unless obsolete."""
        term = self.ontology.get(term_id)
        return None if term is None or term.obsolete else term

    def _sorted(self, term_ids: list[str]) -> list[str]:
        return sorted(
            dict.fromkeys(term_ids),
            key=lambda i: (self.ontology.label_of(i).casefold(), i),
        )

    def parents_of(self, term_id: str) -> list[str]:
        term = self.live(term_id)
        if term is None:
            return []
        return self._sorted([p for p in term.parents if self.live(p) is not None])

    def children_of(self, term_id: str) -> list[str]:
        term = self.live(term_id)
        if term is None:
            return []
        return self._sorted(
            [
                child
                for child in self.ontology.children_of(term.hpo_id)
                if self.live(child) is not None
            ]
        )

    def roots(self) -> list[str]:
        return self._sorted(
            [
                term.hpo_id
                for term in self.ontology.terms.values()
                if not term.obsolete and not self.parents_of(term.hpo_id)
            ]
        )

    def node(self, term_id: str) -> TreeNode:
        return TreeNode(
            term_id=term_id,
            label=self.ontology.label_of(term_id),
            child_count=len(self.children_of(term_id)),
        )

    def nodes(self, term_ids: list[str]) -> list[TreeNode]:
        return [self.node(term_id) for term_id in term_ids]

    def path_to(self, term_id: str, via_parent_id: str | None = None) -> list[str]:
        """Ids from a root down to the term; empty for an unknown or obsolete term.

        The shortest path wins; among equally short ones the path whose labels
        sort first, compared from the root down. ``via_parent_id`` forces the
        last step: the path then runs through that parent.
        """
        term = self.live(term_id)
        if term is None:
            return []
        if via_parent_id is None:
            return self._best_path(term.hpo_id, {}, set())
        parent = self.live(via_parent_id)
        if parent is None or parent.hpo_id not in term.parents:
            raise DomainError(
                "INVALID_TREE_PARENT",
                f"Term '{via_parent_id}' is not a parent of '{term.hpo_id}'",
            )
        return [*self._best_path(parent.hpo_id, {}, set()), term.hpo_id]

    def _best_path(
        self, term_id: str, memo: dict[str, list[str]], walking: set[str]
    ) -> list[str]:
        if term_id in memo:
            return memo[term_id]
        # `walking` only guards against a cyclic file; a valid ontology has none.
        walking.add(term_id)
        candidates = [
            self._best_path(parent, memo, walking)
            for parent in self.parents_of(term_id)
            if parent not in walking
        ]
        walking.discard(term_id)
        best: list[str] = []
        if candidates:
            best = min(
                candidates,
                key=lambda path: (
                    len(path),
                    [self.ontology.label_of(i).casefold() for i in path],
                    path,
                ),
            )
        memo[term_id] = [*best, term_id]
        return memo[term_id]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/test_ontology_tree.py -q`
Expected: `12 passed` (ten test functions, one of them with three parameters).

- [ ] **Step 5: Lint and types**

Run: `uv run ruff check src/ontocurator/ontology/tree.py tests/test_ontology_tree.py && uv run ruff format --check src/ontocurator/ontology/tree.py tests/test_ontology_tree.py && uv run mypy src`
Expected: no findings.

- [ ] **Step 6: Commit**

```bash
git add src/ontocurator/ontology/tree.py tests/test_ontology_tree.py
git commit -m "feat(tree): walk the ontology as a tree of roots, children and paths"
```

---

### Task 2: Backend — term details and the children under expanded nodes

**Files:**
- Modify: `src/ontocurator/ontology/tree.py`
- Test: `tests/test_ontology_tree.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_ontology_tree.py`:

```python
def test_unknown_and_obsolete_terms_have_no_detail() -> None:
    tree = _fixture_tree()

    assert tree.detail("HP:9999999") is None
    assert tree.detail("HP:0000123") is None


def test_levels_list_the_children_under_each_expanded_node() -> None:
    tree = _fixture_tree()

    levels = tree.levels(["HP:0000001", "HP:0000118"])

    assert [level.term_id for level in levels] == ["HP:0000001", "HP:0000118"]
    assert [n.term_id for n in levels[0].children] == ["HP:0000118"]
    assert [(n.term_id, n.label, n.child_count) for n in levels[1].children] == [
        ("HP:0000707", "Abnormality of the nervous system", 3),
        ("HP:0000365", "Hearing impairment", 1),
    ]


def test_detail_lists_names_translations_and_all_parents(tmp_path: Path) -> None:
    fixture = _fixture_tree()
    term = fixture.ontology.terms["HP:0001252"]
    # What a loaded translation file leaves on the term.
    term.translations["de"] = ["Muskelhypotonie", "Hypotonie"]
    term.translations["fr"] = ["Hypotonie musculaire"]
    term.translations["es"] = []

    detail = fixture.detail("HP:0001252")

    assert detail is not None
    assert (detail.term_id, detail.label) == ("HP:0001252", "Hypotonia")
    assert detail.definition
    assert detail.synonyms == ["Low muscle tone", "Muscle hypotonia", "Hypotonic"]
    assert detail.translations == {
        "de": ["Muskelhypotonie", "Hypotonie"],
        "fr": ["Hypotonie musculaire"],
    }
    assert list(detail.translations) == ["de", "fr"]
    assert [n.term_id for n in detail.parents] == ["HP:0000707"]

    untranslated = fixture.detail("HP:0001250")
    assert untranslated is not None
    assert untranslated.translations == {}

    graph = _graph_tree(tmp_path)
    twin = graph.detail(tid("0000006"))
    assert twin is not None
    assert [n.label for n in twin.parents] == ["Alpha", "Beta"]
    root = graph.detail(tid("0000001"))
    assert root is not None
    assert root.parents == []
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_ontology_tree.py -q`
Expected: 3 failures — `AttributeError: 'OntologyTree' object has no attribute 'detail'` (twice) and `... no attribute 'levels'`; the 12 tests of Task 1 still pass.

- [ ] **Step 3: Add the models**

In `src/ontocurator/ontology/tree.py`, directly above `class OntologyTree:`, add

```python
class TreeLevel(BaseModel):
    """An expanded node and the children shown under it."""

    model_config = ConfigDict(extra="forbid")

    term_id: str
    children: list[TreeNode]


class TreeTermDetail(BaseModel):
    """What the detail pane shows for the selected node."""

    model_config = ConfigDict(extra="forbid")

    term_id: str
    label: str
    definition: str
    synonyms: list[str]
    # Language code -> translated names. Empty unless translation files are loaded.
    translations: dict[str, list[str]]
    # Every parent, alphabetically. The interface lists the ones the current
    # path does not run through as "Also under".
    parents: list[TreeNode]
```

None of these fields has a default on purpose: a field with a default is optional in the generated TypeScript, and every reader would have to guard against `undefined`.

- [ ] **Step 4: Add the two methods**

At the end of `class OntologyTree` (after `_best_path`), add these two methods (shown without the class indentation):

```python
def levels(self, expanded_ids: list[str]) -> list[TreeLevel]:
    """The children shown under each of these nodes, in the given order."""
    return [
        TreeLevel(term_id=term_id, children=self.nodes(self.children_of(term_id)))
        for term_id in expanded_ids
    ]


def detail(self, term_id: str) -> TreeTermDetail | None:
    term = self.live(term_id)
    if term is None:
        return None
    return TreeTermDetail(
        term_id=term.hpo_id,
        label=term.label,
        definition=term.definition,
        synonyms=list(dict.fromkeys(value for _, value in term.synonyms)),
        translations={
            language: list(names)
            for language, names in sorted(term.translations.items())
            if names
        },
        parents=self.nodes(self.parents_of(term.hpo_id)),
    )
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `uv run pytest tests/test_ontology_tree.py -q && uv run ruff check src/ontocurator/ontology/tree.py tests/test_ontology_tree.py && uv run ruff format --check src/ontocurator/ontology/tree.py tests/test_ontology_tree.py && uv run mypy src`
Expected: `15 passed`, no findings.

- [ ] **Step 6: Commit**

```bash
git add src/ontocurator/ontology/tree.py tests/test_ontology_tree.py
git commit -m "feat(tree): describe a term and list the children under expanded nodes"
```

---

### Task 3: Repository — the event of a walk grows

A search event is written once (`save_search_event` is a plain `INSERT`; a second insert of the same id raises `sqlite3.IntegrityError`). The spec needs one exception: the event of a tree walk gains the terms that become visible. Two things follow.

1. One method that appends inside a transaction. Each request thread has its own SQLite connection, so read-modify-write without `BEGIN IMMEDIATE` could lose terms when two requests of one walk overlap.
2. `import_package` rejects a package whose search event has the id of a stored event but different content (`"Conflicting search event content"`). With a growing event that would break a real workflow: export a case while its pinned tree is open, keep browsing, export again, and the recipient cannot import the second file. So two records that are the same walk at two moments are not a conflict, and the longer one is kept.

Exports need no change: both export paths read `payload_json` at export time and so carry the grown event (tested below).

**Files:**
- Modify: `src/ontocurator/storage/repository.py`
- Test: `tests/test_tree_events.py` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests/test_tree_events.py`:

```python
"""The one search event that grows: a walk through the ontology tree."""

from concurrent.futures import ThreadPoolExecutor

import pytest
from test_storage import _sample_package
from test_storage_regressions import key_for

from ontocurator.application.exports import ExportService
from ontocurator.domain.errors import InvalidPackage
from ontocurator.packages.models import SearchEventRecord
from ontocurator.storage.database import Database
from ontocurator.storage.repository import Repository


def _walk(candidates: list[str], **overrides: object) -> SearchEventRecord:
    fields: dict[str, object] = {
        "event_id": "walk-1",
        "workspace_key": key_for(),
        "annotation_id": "ann-1",
        "query": "HP:0001250",
        "route": "browse",
        "candidates": list(candidates),
        "ranked_ids": list(candidates),
        "ontology_release": "2026-06-23",
        "index_identity": "index",
        "timestamp": "2026-10-08T10:00:00+00:00",
    }
    fields.update(overrides)
    return SearchEventRecord.model_validate(fields)


def _repo(tmp_path) -> Repository:
    repo = Repository(Database(tmp_path / "db"))
    repo.import_package(_sample_package())
    return repo


def _export_with(event: SearchEventRecord, package_id: str):
    package = _sample_package(package_id)
    package.search_events = [event]
    return package


def test_append_adds_only_new_terms_in_order_of_first_appearance(tmp_path):
    repo = _repo(tmp_path)
    repo.save_search_event(_walk(["HP:1", "HP:2"]))

    returned = repo.append_search_event_candidates(
        "walk-1", ["HP:3", "HP:2", "HP:4", "HP:3"]
    )

    assert returned is not None
    assert returned.candidates == ["HP:1", "HP:2", "HP:3", "HP:4"]
    stored = repo.get_search_event("walk-1")
    assert stored == returned
    assert stored.ranked_ids == ["HP:1", "HP:2", "HP:3", "HP:4"]
    assert stored.timestamp == "2026-10-08T10:00:00+00:00"

    # Nothing new: nothing changes.
    again = repo.append_search_event_candidates("walk-1", ["HP:4", "HP:1"])
    assert again == stored
    assert repo.get_search_event("walk-1") == stored


def test_append_to_an_unknown_event_returns_none_and_stores_nothing(tmp_path):
    repo = _repo(tmp_path)

    assert repo.append_search_event_candidates("nope", ["HP:1"]) is None
    assert repo.get_search_event("nope") is None


def test_parallel_appends_lose_no_term(tmp_path):
    repo = _repo(tmp_path)
    repo.save_search_event(_walk(["HP:0"]))
    batches = [[f"HP:{worker}-{step}" for step in range(5)] for worker in range(40)]

    with ThreadPoolExecutor(8) as pool:
        list(
            pool.map(
                lambda batch: repo.append_search_event_candidates("walk-1", batch),
                batches,
            )
        )

    stored = repo.get_search_event("walk-1")
    assert stored is not None
    assert len(stored.candidates) == 1 + 40 * 5
    assert set(stored.candidates) == {"HP:0", *(t for b in batches for t in b)}
    assert stored.ranked_ids == stored.candidates


def test_the_export_carries_the_grown_event(tmp_path):
    repo = _repo(tmp_path)
    repo.save_search_event(_walk(["HP:1"]))
    repo.append_search_event_candidates("walk-1", ["HP:2"])

    exported = ExportService(repo).for_workspace(key_for()).search_events

    assert [e.candidates for e in exported] == [["HP:1", "HP:2"]]


def test_an_earlier_export_of_the_same_walk_imports_and_the_longer_event_stays(
    tmp_path,
):
    repo = _repo(tmp_path)
    repo.save_search_event(_walk(["HP:1", "HP:2", "HP:3"]))

    repo.import_package(_export_with(_walk(["HP:1", "HP:2"]), "export-early"))

    stored = repo.get_search_event("walk-1")
    assert stored is not None
    assert stored.candidates == ["HP:1", "HP:2", "HP:3"]


def test_a_later_export_of_the_same_walk_replaces_the_shorter_event(tmp_path):
    repo = _repo(tmp_path)
    repo.import_package(_export_with(_walk(["HP:1", "HP:2"]), "export-early"))

    repo.import_package(_export_with(_walk(["HP:1", "HP:2", "HP:3"]), "export-late"))

    stored = repo.get_search_event("walk-1")
    assert stored is not None
    assert stored.candidates == ["HP:1", "HP:2", "HP:3"]
    assert stored.ranked_ids == ["HP:1", "HP:2", "HP:3"]
    # Both imported packages now hand out the later state.
    for package_id in ("export-early", "export-late"):
        events = repo.export_package(package_id).search_events
        assert [e.candidates for e in events] == [["HP:1", "HP:2", "HP:3"]]


@pytest.mark.parametrize(
    "incoming",
    [
        # Not the beginning of the stored list.
        _walk(["HP:1", "HP:9", "HP:3", "HP:4"]),
        # Same terms, but something else differs.
        _walk(["HP:1", "HP:2", "HP:3"], query="HP:0001252"),
        _walk(["HP:1", "HP:2", "HP:3"], annotation_id="ann-2"),
        # The two lists of one event disagree.
        _walk(["HP:1", "HP:2", "HP:3"], ranked_ids=["HP:1", "HP:3", "HP:2"]),
    ],
)
def test_a_different_walk_under_the_same_id_is_still_a_conflict(tmp_path, incoming):
    repo = _repo(tmp_path)
    repo.save_search_event(_walk(["HP:1", "HP:2"]))

    with pytest.raises(InvalidPackage):
        repo.import_package(_export_with(incoming, "export-conflict"))

    stored = repo.get_search_event("walk-1")
    assert stored is not None
    assert stored.candidates == ["HP:1", "HP:2"]
    assert repo.get_document("export-conflict", "doc-1") is None


@pytest.mark.parametrize("route", ["auto", "lexical"])
def test_a_search_event_never_grows_on_import(tmp_path, route):
    repo = _repo(tmp_path)
    repo.save_search_event(_walk(["HP:1", "HP:2"], route=route))

    with pytest.raises(InvalidPackage):
        repo.import_package(
            _export_with(_walk(["HP:1", "HP:2", "HP:3"], route=route), "export-x")
        )


def test_a_selection_made_from_a_walk_never_grows_on_import(tmp_path):
    repo = _repo(tmp_path)
    selection = {"selected_term_id": "HP:2", "event_id": "selection-1"}
    repo.save_search_event(_walk(["HP:1", "HP:2"], **selection))

    with pytest.raises(InvalidPackage):
        repo.import_package(
            _export_with(_walk(["HP:1", "HP:2", "HP:3"], **selection), "export-x")
        )
```

About `test_parallel_appends_lose_no_term`: against an implementation that reads and writes without a transaction it fails only with high probability, not with certainty. It is here to catch the mistake when it happens, not to prove its absence; the transaction in Step 3 is the actual guarantee.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_tree_events.py -q`
Expected: the four `append`/export tests fail with `AttributeError: 'Repository' object has no attribute 'append_search_event_candidates'`; the two "same walk" import tests fail with `InvalidPackage: ... Conflicting search event content`; the conflict tests (7 cases) already pass, because today every difference is a conflict.

- [ ] **Step 3: Add the append method**

In `src/ontocurator/storage/repository.py`, replace the import line

```python
from collections.abc import Callable
```

with

```python
from collections.abc import Callable, Iterable
```

Directly above the line `    def get_search_event(self, event_id: str) -> SearchEventRecord | None:`, add this method to `class Repository` (shown without the class indentation):

```python
def append_search_event_candidates(
    self, event_id: str, term_ids: Iterable[str]
) -> SearchEventRecord | None:
    """Add newly shown terms to a stored event, in order of first appearance.

    A search event is written once. The one exception is a walk through the
    tree: what it showed grows with every node that is opened, and the
    selection made from it has to find those terms among its candidates.
    Read and write happen in one transaction, so two requests of the same
    walk cannot lose each other's terms. Returns None for an unknown event.
    """
    conn = self.db.get_connection()
    conn.execute("BEGIN IMMEDIATE")
    try:
        event = self.get_search_event(event_id)
        if event is not None:
            known = set(event.candidates)
            added = [t for t in dict.fromkeys(term_ids) if t not in known]
            if added:
                event.candidates = [*event.candidates, *added]
                event.ranked_ids = [*event.ranked_ids, *added]
                conn.execute(
                    "UPDATE search_events SET payload_json=? WHERE event_id=?",
                    (event.model_dump_json(), event_id),
                )
        conn.execute("COMMIT")
        return event
    except Exception:
        conn.execute("ROLLBACK")
        raise
```

The columns `timestamp`, `workspace_key`, `annotation_id`, `layer_id` and `ontology_sha256` stay as written at creation; only the payload changes.

- [ ] **Step 4: Let two states of one walk pass the import check**

Directly above `def _legacy_key_str(key: WorkspaceKey) -> str:`, add

```python
def _same_tree_walk(stored: SearchEventRecord, incoming: SearchEventRecord) -> bool:
    """Whether two records are one tree walk seen at two moments.

    A walk only ever gains terms at the end, so the shorter list of shown
    terms must be the beginning of the longer one and nothing else may differ.
    """
    if stored.route != "browse" or incoming.route != "browse":
        return False
    if stored.selected_term_id is not None:
        # A selection is a copy made at one moment; it never grows.
        return False
    grown = {"candidates", "ranked_ids"}
    if stored.model_dump(exclude=grown) != incoming.model_dump(exclude=grown):
        return False
    for field in sorted(grown):
        first, second = getattr(stored, field), getattr(incoming, field)
        shorter, longer = sorted((first, second), key=len)
        if longer[: len(shorter)] != shorter:
            return False
    return True
```

In `_verify_existing_snapshots`, replace

```python
        for event in package.search_events:
            existing_event = self.get_search_event(event.event_id)
            if existing_event is not None and existing_event != event:
                raise InvalidPackage("Conflicting search event content")
```

with

```python
        for event in package.search_events:
            existing_event = self.get_search_event(event.event_id)
            if existing_event is None or existing_event == event:
                continue
            if not _same_tree_walk(existing_event, event):
                raise InvalidPackage("Conflicting search event content")
            # Two exports of one walk through the tree, taken at different
            # moments: keep the one that has seen more.
            if len(event.candidates) > len(existing_event.candidates):
                conn.execute(
                    "UPDATE search_events SET payload_json=? WHERE event_id=?",
                    (event.model_dump_json(), event.event_id),
                )
```

(`conn` is the connection `_verify_existing_snapshots` already fetches in its first line; the method runs inside the transaction of `import_package`, so a later failure of the import rolls this update back.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `uv run pytest tests/test_tree_events.py -q`
Expected: `13 passed` (nine test functions; two are parametrised, over four and two values).

- [ ] **Step 6: Whole backend suite, lint, types**

Run: `uv run pytest -q && uv run ruff check . && uv run ruff format --check src tests && uv run mypy src`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/ontocurator/storage/repository.py tests/test_tree_events.py
git commit -m "feat(tree): let the search event of a tree walk grow"
```

---

### Task 4: API — `tree/open`, `tree/node` and the walk's event

**Files:**
- Modify: `src/ontocurator/api/routes.py` (`search_ontology`, new `layer_ontology`)
- Create: `src/ontocurator/api/tree_routes.py`
- Modify: `src/ontocurator/api/app.py`
- Test: `tests/test_tree_api.py` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests/test_tree_api.py`:

```python
"""The tree endpoints: what they return and what the walk's event records."""

import hashlib
import io

import pytest
from fastapi.testclient import TestClient
from layered_fixtures import HP_DIGEST, make_layered_package
from test_api import app_client as _shared_app_client
from test_ontology_tree import tid, write_graph_ontology

from ontocurator.api.app import create_app
from ontocurator.application.exports import ExportService
from ontocurator.config import AppConfig
from ontocurator.domain.profiles import profile_hash
from ontocurator.domain.workspace import WorkspaceKey
from ontocurator.packages.writer import PackageWriter

app_client = _shared_app_client

# Everything a walk that opens at Seizure shows, in order of first appearance:
# the root, then the children under each node of the path.
SEIZURE_WALK = [
    "HP:0000001",
    "HP:0000118",
    "HP:0000707",
    "HP:0000365",
    "HP:0001284",
    "HP:0001252",
    "HP:0001250",
    "HP:0011146",
    "HP:0002133",
]


def _import(client, package) -> None:
    buf = io.BytesIO()
    PackageWriter.write_to_stream(package, buf)
    files = {"file": ("package.zip", buf.getvalue(), "application/zip")}
    resp = client.post("/api/v1/packages", files=files)
    assert resp.status_code == 200, resp.text


def _open(client, package_id, annotator="annotator-1", mode="independent"):
    resp = client.post(
        "/api/v1/workspaces/open",
        json={
            "package_id": package_id,
            "document_id": "doc-beta",
            "annotator_id": annotator,
            "mode": mode,
        },
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["workspace_id"], resp.json()["view"]["key"]


def _command(client, ws_id, revision, payload, mutation_id=None):
    return client.post(
        f"/api/v1/workspaces/{ws_id}/commands",
        json={
            "mutation_id": mutation_id or f"mut-{revision}",
            "expected_revision": revision,
            "payload": payload,
        },
    )


def _tree(client, ws_key, endpoint, **fields):
    body = {
        "workspace_key": ws_key,
        "annotation_id": "ann-1",
        "layer_id": "hpo-layer",
        **fields,
    }
    return client.post(f"/api/v1/terms/tree/{endpoint}", json=body)


def _open_walk(client, ws_key, term_id="HP:0001250") -> str:
    resp = _tree(client, ws_key, "open", term_id=term_id)
    assert resp.status_code == 200, resp.text
    return resp.json()["browse_id"]


def _event(client, event_id):
    event = client.app.state.repo.get_search_event(event_id)
    assert event is not None
    return event


def _events(client, ws_key):
    return client.app.state.repo.get_search_events_for_workspace(
        WorkspaceKey.model_validate(ws_key)
    )


def _set_term(term_id, browse_id):
    return {
        "command": "set_term",
        "annotation_id": "ann-1",
        "term_id": term_id,
        "search_event_id": browse_id,
    }


@pytest.fixture
def walk(app_client):
    """A workspace with one annotation on Seizure, ready for the tree."""
    client, _ = app_client
    _import(client, make_layered_package("single"))
    ws_id, ws_key = _open(client, "pkg-scenario-a")
    resp = _command(
        client,
        ws_id,
        0,
        {
            "command": "create_annotation",
            "annotation_id": "ann-1",
            "layer_id": "hpo-layer",
            "type_id": "phenotype",
            "term_id": "HP:0001250",
        },
    )
    assert resp.status_code == 200, resp.text
    return client, ws_id, ws_key


@pytest.fixture
def graph_walk(tmp_path):
    """A workspace whose layer uses the multi-parent ontology of the tree tests."""
    path = write_graph_ontology(tmp_path)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    package = make_layered_package("single")
    profile = package.manifest.task_profile
    definition = profile.ontologies[0].model_copy(
        update={"sha256": digest, "release": "2026-06-23", "resource_path": None}
    )
    profile = profile.model_copy(update={"ontologies": [definition]})
    manifest = package.manifest.model_copy(
        update={
            "package_id": "pkg-graph",
            "task_profile": profile,
            "task_profile_sha256": profile_hash(profile),
        }
    )
    package = package.model_copy(update={"manifest": manifest})

    config = AppConfig(
        workspace_dir=tmp_path,
        database_path=tmp_path / "graph.db",
        ontology_paths=[path],
        session_token="secret-session-token",
    )
    client = TestClient(
        create_app(config), headers={"Authorization": "Bearer secret-session-token"}
    )
    _import(client, package)
    ws_id, ws_key = _open(client, "pkg-graph")
    resp = _command(
        client,
        ws_id,
        0,
        {
            "command": "create_annotation",
            "annotation_id": "ann-1",
            "layer_id": "hpo-layer",
            "type_id": "phenotype",
            "term_id": tid("0000006"),
        },
    )
    assert resp.status_code == 200, resp.text
    return client, ws_id, ws_key


def test_open_returns_the_path_to_the_term_and_logs_everything_it_shows(walk):
    client, _, ws_key = walk

    resp = _tree(client, ws_key, "open", term_id="HP:0001250")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["start_status"] == "valid"
    assert body["roots"] == [
        {"term_id": "HP:0000001", "label": "All", "child_count": 1}
    ]
    assert body["path"] == ["HP:0000001", "HP:0000118", "HP:0000707", "HP:0001250"]
    assert [level["term_id"] for level in body["levels"]] == body["path"]
    assert [n["term_id"] for n in body["levels"][2]["children"]] == [
        "HP:0001284",
        "HP:0001252",
        "HP:0001250",
    ]
    assert body["levels"][3]["children"] == [
        {"term_id": "HP:0011146", "label": "Dialeptic seizure", "child_count": 0},
        {"term_id": "HP:0002133", "label": "Status epilepticus", "child_count": 0},
    ]
    detail = body["detail"]
    assert (detail["term_id"], detail["label"]) == ("HP:0001250", "Seizure")
    assert detail["definition"]
    assert sorted(detail["synonyms"]) == ["Convulsion", "Epileptic seizure", "Seizures"]
    assert detail["translations"] == {}
    assert detail["parents"] == [
        {
            "term_id": "HP:0000707",
            "label": "Abnormality of the nervous system",
            "child_count": 3,
        }
    ]

    event = _event(client, body["browse_id"])
    assert event.route == "browse"
    assert event.query == "HP:0001250"
    assert event.workspace_key == WorkspaceKey.model_validate(ws_key)
    assert (event.annotation_id, event.layer_id) == ("ann-1", "hpo-layer")
    assert event.candidates == SEIZURE_WALK
    assert event.ranked_ids == SEIZURE_WALK
    assert event.candidate_scores == {}
    assert event.selected_term_id is None
    assert event.ontology_sha256 == HP_DIGEST
    assert event.ontology_release == "2026-06-23"


def test_every_open_starts_a_walk_of_its_own(walk):
    client, _, ws_key = walk

    first = _open_walk(client, ws_key)
    second = _open_walk(client, ws_key)

    assert first != second
    assert sorted(e.event_id for e in _events(client, ws_key)) == sorted(
        [first, second]
    )


@pytest.mark.parametrize(
    ("term_id", "status"), [("HP:9999999", "unknown"), ("HP:0000123", "obsolete")]
)
def test_open_at_an_unknown_or_obsolete_term_shows_the_roots_and_says_so(
    walk, term_id, status
):
    client, _, ws_key = walk

    resp = _tree(client, ws_key, "open", term_id=term_id)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["start_status"] == status
    assert [n["term_id"] for n in body["roots"]] == ["HP:0000001"]
    assert (body["path"], body["levels"], body["detail"]) == ([], [], None)
    event = _event(client, body["browse_id"])
    assert event.query == term_id
    assert event.candidates == ["HP:0000001"]


def test_expanding_a_node_returns_its_children_and_adds_them_to_the_walk(walk):
    client, _, ws_key = walk
    browse_id = _open_walk(client, ws_key, "HP:0001252")
    before = _event(client, browse_id).candidates
    assert before == SEIZURE_WALK[:7]

    resp = _tree(
        client, ws_key, "node", browse_id=browse_id, term_id="HP:0000365", expand=True
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["detail"]["label"] == "Hearing impairment"
    assert body["children"] == [
        {
            "term_id": "HP:0000407",
            "label": "Sensorineural hearing impairment",
            "child_count": 0,
        }
    ]
    assert (body["path"], body["levels"]) == ([], [])
    assert _event(client, browse_id).candidates == [*before, "HP:0000407"]

    # Opening the same node again shows nothing new.
    _tree(
        client, ws_key, "node", browse_id=browse_id, term_id="HP:0000365", expand=True
    )
    assert _event(client, browse_id).candidates == [*before, "HP:0000407"]

    _tree(
        client, ws_key, "node", browse_id=browse_id, term_id="HP:0001250", expand=True
    )
    event = _event(client, browse_id)
    assert event.candidates == [*before, "HP:0000407", "HP:0011146", "HP:0002133"]
    assert event.ranked_ids == event.candidates


def test_selecting_a_node_returns_its_details_and_logs_nothing(walk):
    client, _, ws_key = walk
    browse_id = _open_walk(client, ws_key, "HP:0001252")
    before = _event(client, browse_id).candidates

    resp = _tree(client, ws_key, "node", browse_id=browse_id, term_id="HP:0001250")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["detail"]["label"] == "Seizure"
    assert body["detail"]["parents"][0]["term_id"] == "HP:0000707"
    # Its children were not asked for, so they were not shown.
    assert body["children"] == []
    assert _event(client, browse_id).candidates == before


@pytest.mark.parametrize("term_id", ["HP:0000407", "HP:0000123", "HP:9999999"])
def test_a_node_that_was_never_shown_cannot_be_asked_for(walk, term_id):
    client, _, ws_key = walk
    browse_id = _open_walk(client, ws_key)

    resp = _tree(
        client, ws_key, "node", browse_id=browse_id, term_id=term_id, expand=True
    )

    assert resp.status_code == 422
    assert resp.json()["code"] == "TREE_TERM_NOT_SHOWN"
    assert _event(client, browse_id).candidates == SEIZURE_WALK


def test_a_shown_term_is_assigned_from_the_walk_and_logged_as_browse(walk):
    client, ws_id, ws_key = walk
    browse_id = _open_walk(client, ws_key)

    resp = _command(client, ws_id, 1, _set_term("HP:0002133", browse_id))

    assert resp.status_code == 200, resp.text
    terms = [a["annotation"]["term_id"] for a in resp.json()["annotations"]]
    assert terms == ["HP:0002133"]

    selections = [e for e in _events(client, ws_key) if e.selected_term_id]
    assert len(selections) == 1
    selection = selections[0]
    assert selection.source_search_event_id == browse_id
    assert selection.route == "browse"
    assert selection.query == "HP:0001250"
    assert selection.selected_term_id == "HP:0002133"
    assert selection.candidates == SEIZURE_WALK
    assert selection.displayed_position == 9
    assert selection.ranked_position == 9
    # The walk itself stays a search without a selection.
    assert _event(client, browse_id).selected_term_id is None


def test_a_term_the_walk_never_showed_is_rejected_until_it_was_shown(walk):
    client, ws_id, ws_key = walk
    browse_id = _open_walk(client, ws_key)
    payload = _set_term("HP:0000407", browse_id)

    early = _command(client, ws_id, 1, payload, "mut-early")
    assert early.status_code == 422
    assert early.json()["code"] == "INVALID_SEARCH_SELECTION"

    opened = _tree(
        client, ws_key, "node", browse_id=browse_id, term_id="HP:0000365", expand=True
    )
    assert opened.status_code == 200, opened.text

    late = _command(client, ws_id, 1, payload, "mut-late")
    assert late.status_code == 200, late.text
    terms = [a["annotation"]["term_id"] for a in late.json()["annotations"]]
    assert terms == ["HP:0000407"]


def test_a_walk_belongs_to_its_workspace_and_annotation(walk):
    client, ws_id, ws_key = walk
    browse_id = _open_walk(client, ws_key)
    _, other_key = _open(client, "pkg-scenario-a", annotator="annotator-2")
    search = client.post(
        "/api/v1/search",
        json={
            "workspace_key": ws_key,
            "annotation_id": "ann-1",
            "layer_id": "hpo-layer",
            "query": "Seizure",
        },
    )
    assert search.status_code == 200, search.text
    search_id = search.json()["search_id"]
    searched = _event(client, search_id).candidates
    done = _command(client, ws_id, 1, _set_term("HP:0002133", browse_id))
    assert done.status_code == 200, done.text
    selection_id = next(
        e.event_id for e in _events(client, ws_key) if e.selected_term_id
    )

    attempts = [
        {"browse_id": "no-such-walk"},
        {"browse_id": browse_id, "annotation_id": "ann-2"},
        {"browse_id": browse_id, "workspace_key": other_key},
        # A search is not a walk, and neither is the selection made from one.
        {"browse_id": search_id},
        {"browse_id": selection_id},
    ]
    for fields in attempts:
        resp = _tree(
            client, ws_key, "node", term_id="HP:0000365", expand=True, **fields
        )
        assert resp.status_code == 422, (fields, resp.text)
        assert resp.json()["code"] == "INVALID_TREE_WALK", fields

    assert _event(client, browse_id).candidates == SEIZURE_WALK
    assert _event(client, search_id).candidates == searched
    assert _event(client, selection_id).candidates == SEIZURE_WALK


def test_the_tree_follows_the_layer_and_a_walk_cannot_change_layers(app_client):
    client, _ = app_client
    _import(client, make_layered_package("assisted"))
    _, ws_key = _open(client, "pkg-scenario-b", mode="assisted")

    opened = _tree(
        client,
        ws_key,
        "open",
        annotation_id="note-1",
        layer_id="reference-layer",
        term_id="MONDO:0001250",
    )

    assert opened.status_code == 200, opened.text
    body = opened.json()
    assert [n["term_id"] for n in body["roots"]] == ["MONDO:0000001"]
    assert body["path"] == ["MONDO:0000001", "MONDO:0005070", "MONDO:0001250"]
    assert _event(client, body["browse_id"]).layer_id == "reference-layer"

    resp = _tree(
        client,
        ws_key,
        "node",
        annotation_id="note-1",
        layer_id="target-layer",
        browse_id=body["browse_id"],
        term_id="MONDO:0001250",
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == "INVALID_TREE_WALK"


def test_tree_requests_pass_the_same_checks_as_a_search(app_client):
    client, _ = app_client
    _import(client, make_layered_package("multi_editable"))
    ws_id, ws_key = _open(client, "pkg-scenario-c")
    created = _command(
        client,
        ws_id,
        0,
        {
            "command": "create_annotation",
            "annotation_id": "ann-1",
            "layer_id": "layer-1",
            "type_id": "type-opt",
            "term_id": "HP:0001250",
        },
    )
    assert created.status_code == 200, created.text

    cases = [
        ({"layer_id": "no-such-layer"}, "UNKNOWN_LAYER"),
        # ann-1 lives in layer-1.
        ({"layer_id": "layer-2"}, "LAYER_MISMATCH"),
        (
            {
                "layer_id": "layer-1",
                "workspace_key": {**ws_key, "document_id": "no-such-doc"},
            },
            "DOCUMENT_NOT_FOUND",
        ),
    ]
    for fields, code in cases:
        for endpoint, extra in (("open", {}), ("node", {"browse_id": "any"})):
            resp = _tree(
                client, ws_key, endpoint, term_id="HP:0001250", **extra, **fields
            )
            assert resp.status_code == 422, (endpoint, fields, resp.text)
            assert resp.json()["code"] == code, (endpoint, fields)

    assert _events(client, ws_key) == []


def test_also_under_returns_the_other_path_and_logs_what_it_reveals(graph_walk):
    client, _, ws_key = graph_walk
    root, beta, alpha, twin = (
        tid("0000001"),
        tid("0000002"),
        tid("0000003"),
        tid("0000006"),
    )

    opened = _tree(client, ws_key, "open", term_id=twin).json()
    assert opened["path"] == [root, alpha, twin]
    assert [n["label"] for n in opened["detail"]["parents"]] == ["Alpha", "Beta"]
    shown = _event(client, opened["browse_id"]).candidates
    # The three roots, Root's children, Alpha's children.
    assert shown == [
        tid(local)
        for local in (
            "0000013",
            "0000012",
            "0000001",
            "0000003",
            "0000002",
            "0000004",
            "0000006",
            "0000007",
        )
    ]

    resp = _tree(
        client,
        ws_key,
        "node",
        browse_id=opened["browse_id"],
        term_id=twin,
        via_parent_id=beta,
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["path"] == [root, beta, twin]
    assert [level["term_id"] for level in body["levels"]] == [root, beta]
    assert [n["label"] for n in body["levels"][1]["children"]] == [
        "Able",
        "Shortcut",
        "Twin",
    ]
    assert body["children"] == []
    # Able and Shortcut became visible under Beta.
    assert _event(client, opened["browse_id"]).candidates == [
        *shown,
        tid("0000008"),
        tid("0000005"),
    ]


def test_also_under_refuses_a_term_that_is_not_a_parent(graph_walk):
    client, _, ws_key = graph_walk
    opened = _tree(client, ws_key, "open", term_id=tid("0000006")).json()
    shown = _event(client, opened["browse_id"]).candidates

    # Gamma was shown, but it is a sibling of Twin, not a parent.
    resp = _tree(
        client,
        ws_key,
        "node",
        browse_id=opened["browse_id"],
        term_id=tid("0000006"),
        via_parent_id=tid("0000004"),
    )

    assert resp.status_code == 422
    assert resp.json()["code"] == "INVALID_TREE_PARENT"
    assert _event(client, opened["browse_id"]).candidates == shown


def test_the_export_carries_the_walk_with_everything_it_showed(walk):
    client, ws_id, ws_key = walk
    browse_id = _open_walk(client, ws_key)
    _tree(
        client, ws_key, "node", browse_id=browse_id, term_id="HP:0000365", expand=True
    )
    done = _command(client, ws_id, 1, _set_term("HP:0000407", browse_id))
    assert done.status_code == 200, done.text

    exported = (
        ExportService(client.app.state.repo)
        .for_workspace(WorkspaceKey.model_validate(ws_key))
        .search_events
    )

    assert len(exported) == 2
    by_id = {e.event_id: e for e in exported}
    assert by_id[browse_id].candidates == [*SEIZURE_WALK, "HP:0000407"]
    assert by_id[browse_id].selected_term_id is None
    selection = next(e for e in exported if e.selected_term_id == "HP:0000407")
    assert selection.source_search_event_id == browse_id
    assert selection.displayed_position == 10


def test_details_carry_translated_names_once_they_are_loaded(walk):
    client, _, ws_key = walk
    repo = client.app.state.repo
    service = client.app.state.ontology_registry.for_layer(
        repo.get_task_profile("pkg-scenario-a"), "hpo-layer"
    )
    # What Part 2's translation files leave on a term.
    service.ontology.terms["HP:0001250"].translations["de"] = ["Krampfanfall"]

    opened = _tree(client, ws_key, "open", term_id="HP:0001250").json()
    assert opened["detail"]["translations"] == {"de": ["Krampfanfall"]}

    node = _tree(
        client,
        ws_key,
        "node",
        browse_id=opened["browse_id"],
        term_id="HP:0001252",
    ).json()
    assert node["detail"]["translations"] == {}
```

If Part 2 ships a `hp-de.babelon.tsv` fixture that the `app_client` fixture loads, `detail["translations"] == {}` in the first and last test may no longer hold for the terms that file covers. Then compare against what the file holds for that term instead of `{}`; the direct population in the last test stays as it is (assign the list, do not append).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_tree_api.py -q`
Expected: every test fails. The requests get `404` or `405` (the static catch-all answers unknown paths), so the first assertion on `status_code` or the first `resp.json()["browse_id"]` fails.

- [ ] **Step 3: Move the checks of `search_ontology` into one function**

In `src/ontocurator/api/routes.py`, directly above the line `@router.post("/search")`, add

```python
def layer_ontology(
    request: Request,
    repo: Repository,
    ws_svc: WorkspaceService,
    workspace_key: WorkspaceKey,
    layer_id: str,
    annotation_id: str,
) -> OntologyService:
    """The ontology a search or a tree request may use for this layer.

    Checks the working mode, the document, that the layer exists and is
    accessible in the workspace's scope, and that an annotation already in the
    draft belongs to that layer.
    """
    require_mode_allowed(request, workspace_key.mode)
    ws_svc.get_document(workspace_key.package_id, workspace_key.document_id)
    profile = repo.get_task_profile(workspace_key.package_id)
    scope = build_scope(profile, workspace_key.mode)
    profile_layer_ids = [layer.layer_id for layer in profile.layers]
    if layer_id not in profile_layer_ids:
        raise DomainError(
            "UNKNOWN_LAYER",
            f"Layer '{layer_id}' is not defined in task profile",
        )
    accessible = scope.editable_layer_ids + scope.reference_layer_ids
    if layer_id not in accessible:
        raise DomainError(
            "INVALID_LAYER",
            f"Layer '{layer_id}' is not accessible in workspace scope '{scope.scope_id}'",
        )

    # If annotation exists in draft, verify layer matches
    try:
        draft = repo.open_draft(workspace_key)
        for snap in draft.annotations:
            if snap.annotation.annotation_id == annotation_id:
                if snap.annotation.layer_id != layer_id:
                    raise DomainError(
                        "LAYER_MISMATCH",
                        f"Annotation '{annotation_id}' belongs to layer '{snap.annotation.layer_id}', not '{layer_id}'",
                    )
                break
    except DomainError:
        raise
    except Exception:
        pass

    return get_ontology(request).for_layer(profile, layer_id)
```

In `search_ontology`, replace the whole block that starts with the line

```python
    require_mode_allowed(request, req.workspace_key.mode)
```

and ends with the line

```python
    ontology = request.app.state.ontology_registry.for_layer(profile, req.layer_id)
```

(both lines included; it is the body of the function from its first statement down to the ontology lookup, about 33 lines) with

```python
    ontology = layer_ontology(
        request, repo, ws_svc, req.workspace_key, req.layer_id, req.annotation_id
    )
```

`ontology` is now typed, so the cast below it is redundant and mypy (strict) rejects it. Replace

```python
    result = cast(SearchResult, ontology.search(req))
```

with

```python
    result = ontology.search(req)
```

If Part 2 changed lines inside the moved block (it should have no reason to), carry its changes into `layer_ontology` only if they are checks; anything that concerns the search itself stays in `search_ontology`.

Run: `uv run pytest tests/test_api.py tests/test_api_regressions.py tests/test_search_auto.py -q && uv run mypy src`
Expected: all pass, no mypy findings. This step changes no behaviour; the existing search tests are its test.

- [ ] **Step 4: Add the tree router**

Create `src/ontocurator/api/tree_routes.py`:

```python
"""API routes for walking the ontology tree from the term of an annotation.

A walk is logged like a search. ``tree/open`` stores a search event with
``route="browse"`` whose candidates are the terms shown; every ``tree/node``
adds the terms that became visible. A term assigned from the tree names that
event (``set_term`` with ``search_event_id``), so the existing check -- the
term must be among the event's candidates -- and the existing selection event
apply unchanged.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict

from ontocurator.api.routes import RepoDep, WorkspaceSvcDep, layer_ontology
from ontocurator.domain.errors import DomainError
from ontocurator.domain.workspace import WorkspaceKey
from ontocurator.ontology.tree import (
    OntologyTree,
    TreeLevel,
    TreeNode,
    TreeTermDetail,
)
from ontocurator.packages.models import SearchEventRecord

router = APIRouter(prefix="/api/v1")


class TreeOpenRequest(BaseModel):
    """Start a walk at the term of an annotation."""

    model_config = ConfigDict(extra="forbid")

    workspace_key: WorkspaceKey
    annotation_id: str
    layer_id: str
    term_id: str


class TreeOpenResponse(BaseModel):
    """The tree as it opens: roots, the expanded path to the start term."""

    model_config = ConfigDict(extra="forbid")

    browse_id: str
    start_status: Literal["valid", "obsolete", "unknown"]
    roots: list[TreeNode]
    # Ids from a root down to the start term; empty if it is unknown or obsolete.
    path: list[str]
    # One entry per node of the path: the children shown under it.
    levels: list[TreeLevel]
    detail: TreeTermDetail | None


class TreeNodeRequest(BaseModel):
    """Ask about a node the walk has already shown."""

    model_config = ConfigDict(extra="forbid")

    workspace_key: WorkspaceKey
    annotation_id: str
    layer_id: str
    browse_id: str
    term_id: str
    # Return the path that runs through this parent ("Also under").
    via_parent_id: str | None = None
    # The node is being opened: return its children and log them as shown.
    expand: bool = False


class TreeNodeResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    detail: TreeTermDetail
    # Filled only when the request said ``expand``.
    children: list[TreeNode]
    # Filled only with ``via_parent_id``: the path, and the children under each
    # of its nodes above the term itself.
    path: list[str]
    levels: list[TreeLevel]


def _shown(*groups: list[TreeNode]) -> list[str]:
    """Term ids in order of first appearance."""
    return list(dict.fromkeys(node.term_id for group in groups for node in group))


@router.post("/terms/tree/open")
def open_tree(
    req: TreeOpenRequest,
    request: Request,
    repo: RepoDep,
    ws_svc: WorkspaceSvcDep,
) -> TreeOpenResponse:
    """Open the tree at a term and start the walk's event."""
    ontology = layer_ontology(
        request, repo, ws_svc, req.workspace_key, req.layer_id, req.annotation_id
    )
    tree = OntologyTree(ontology.ontology)
    roots = tree.nodes(tree.roots())
    path = tree.path_to(req.term_id)
    levels = tree.levels(path)
    shown = _shown(roots, *(level.children for level in levels))

    browse_id = str(uuid4())
    repo.save_search_event(
        SearchEventRecord(
            event_id=browse_id,
            workspace_key=req.workspace_key,
            annotation_id=req.annotation_id,
            layer_id=req.layer_id,
            ontology_sha256=ontology.ref.sha256,
            query=req.term_id,
            route="browse",
            candidates=shown,
            # Nothing is scored in a tree: the ranked order is the shown order.
            ranked_ids=list(shown),
            ontology_release=ontology.ref.release,
            index_identity=ontology.index_identity,
            timestamp=datetime.now(UTC).isoformat(),
        )
    )
    return TreeOpenResponse(
        browse_id=browse_id,
        start_status=ontology.validate_term(req.term_id).status,
        roots=roots,
        path=path,
        levels=levels,
        detail=tree.detail(req.term_id),
    )


@router.post("/terms/tree/node")
def tree_node(
    req: TreeNodeRequest,
    request: Request,
    repo: RepoDep,
    ws_svc: WorkspaceSvcDep,
) -> TreeNodeResponse:
    """Details of a shown node; its children and other paths on request."""
    ontology = layer_ontology(
        request, repo, ws_svc, req.workspace_key, req.layer_id, req.annotation_id
    )
    event = repo.get_search_event(req.browse_id)
    if (
        event is None
        or event.route != "browse"
        or event.selected_term_id is not None
        or event.workspace_key != req.workspace_key
        or event.annotation_id != req.annotation_id
        or event.layer_id != req.layer_id
    ):
        raise DomainError(
            "INVALID_TREE_WALK",
            "This tree walk does not belong to this workspace, annotation and layer",
        )

    tree = OntologyTree(ontology.ontology)
    detail = tree.detail(req.term_id)
    if detail is None or detail.term_id not in event.candidates:
        # Only what the walk has shown can be opened or selected: the event
        # then never lists a term the annotator could not have reached.
        raise DomainError(
            "TREE_TERM_NOT_SHOWN",
            f"Term '{req.term_id}' was not shown in this tree walk",
        )

    path: list[str] = []
    levels: list[TreeLevel] = []
    if req.via_parent_id is not None:
        path = tree.path_to(detail.term_id, req.via_parent_id)
        levels = tree.levels(path[:-1])
    children = tree.nodes(tree.children_of(detail.term_id)) if req.expand else []

    repo.append_search_event_candidates(
        req.browse_id, _shown(*(level.children for level in levels), children)
    )
    return TreeNodeResponse(detail=detail, children=children, path=path, levels=levels)
```

- [ ] **Step 5: Include the router**

In `src/ontocurator/api/app.py`, after the line `from ontocurator.api.security import verify_security`, add

```python
from ontocurator.api.tree_routes import router as tree_router
```

After the line `    app.include_router(router)`, add

```python
    app.include_router(tree_router)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `uv run pytest tests/test_tree_api.py -q`
Expected: `18 passed` (15 test functions; two are parametrised, over two and three values).

- [ ] **Step 7: Whole backend suite, lint, types**

Run: `uv run pytest -q && uv run ruff check . && uv run ruff format --check src tests && uv run mypy src`
Expected: all pass. `uv run python scripts/export_openapi.py --check` fails from here until Task 6; that is expected.

- [ ] **Step 8: Commit**

```bash
git add src/ontocurator/api/routes.py src/ontocurator/api/tree_routes.py src/ontocurator/api/app.py tests/test_tree_api.py
git commit -m "feat(tree): add the tree endpoints and log what a walk shows"
```

---

### Task 5: Preferences — `tree_pinned_by_annotator`

**Files:**
- Modify: `src/ontocurator/application/preferences.py`
- Test: `tests/test_preferences_api.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_preferences_api.py`:

```python
def test_tree_pin_is_stored_per_annotator_and_merged(app_client):
    from ontocurator.application.preferences import PreferencesStore

    client, config = app_client
    assert client.get("/api/v1/preferences").json()["tree_pinned_by_annotator"] == {}

    resp = client.put(
        "/api/v1/preferences", json={"tree_pinned_by_annotator": {"JPL": True}}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["tree_pinned_by_annotator"] == {"JPL": True}

    # One annotator's choice does not touch another's.
    resp = client.put(
        "/api/v1/preferences",
        json={"tree_pinned_by_annotator": {"AB": True, "JPL": False}},
    )
    assert resp.json()["tree_pinned_by_annotator"] == {"JPL": False, "AB": True}

    # An update of something else keeps it.
    resp = client.put("/api/v1/preferences", json={"last_annotator_id": "AB"})
    assert resp.json()["tree_pinned_by_annotator"] == {"JPL": False, "AB": True}
    assert resp.json()["last_annotator_id"] == "AB"

    path = config.workspace_dir / "preferences.json"
    stored = json.loads(path.read_text(encoding="utf-8"))
    assert stored["tree_pinned_by_annotator"] == {"JPL": False, "AB": True}
    # A restart reads it back.
    assert PreferencesStore(path).load().tree_pinned_by_annotator == {
        "JPL": False,
        "AB": True,
    }


def test_unreadable_tree_pin_entries_are_ignored(app_client):
    client, config = app_client
    (config.workspace_dir / "preferences.json").write_text(
        json.dumps({"tree_pinned_by_annotator": {"JPL": "yes", "AB": True, "X": 1}}),
        encoding="utf-8",
    )

    resp = client.get("/api/v1/preferences")

    assert resp.status_code == 200
    assert resp.json()["tree_pinned_by_annotator"] == {"AB": True}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_preferences_api.py -q`
Expected: the two new tests fail — `KeyError: 'tree_pinned_by_annotator'`, and the `PUT` answers 422 (`extra_forbidden`).

- [ ] **Step 3: Add the field**

In `src/ontocurator/application/preferences.py`:

In `class Preferences`, after the line `    mode_by_package: dict[str, PreferenceMode] = Field(default_factory=dict)`, add

```python
    # Annotator id -> whether the ontology tree stays open as a side panel.
    tree_pinned_by_annotator: dict[str, bool] = Field(default_factory=dict)
```

In `class PreferencesUpdate`, after the line `    mode_by_package: dict[str, PreferenceMode] | None = None`, add

```python
    tree_pinned_by_annotator: dict[str, bool] | None = None
```

In `PreferencesStore._read`, directly above the two lines

```python
        with contextlib.suppress(ValidationError):
            if isinstance(data.get("legacy_config"), dict):
```

add

```python
        pinned = data.get("tree_pinned_by_annotator")
        if isinstance(pinned, dict):
            for annotator_id, value in pinned.items():
                if isinstance(annotator_id, str) and isinstance(value, bool):
                    prefs.tree_pinned_by_annotator[annotator_id] = value
```

In `PreferencesStore.update`, after the two lines

```python
            if change.mode_by_package:
                prefs.mode_by_package.update(change.mode_by_package)
```

add

```python
            if change.tree_pinned_by_annotator:
                prefs.tree_pinned_by_annotator.update(change.tree_pinned_by_annotator)
```

(Part 2 added `search_languages_by_annotator` in the same four places. Order between the two fields does not matter.)

- [ ] **Step 4: Bring the exact-body assertions up to date**

Run: `uv run pytest tests/test_preferences_api.py -q`
Expected: the two new tests pass; older tests that compare the **whole** response body with `==` now fail, because the body has one more key. Before Part 2 these were the assertions in `test_preferences_default_to_empty`, `test_preferences_round_trip_and_persist_in_workspace` (two) and one near the end of the file, each of the form `assert resp.json() == {"last_annotator_id": …, "mode_by_package": …}`. Add `"tree_pinned_by_annotator": {}` to each expected dict that fails. Change nothing else in them.

Run: `uv run pytest tests/test_preferences_api.py -q`
Expected: all pass.

- [ ] **Step 5: Whole backend suite, lint, types**

Run: `uv run pytest -q && uv run ruff check . && uv run ruff format --check src tests && uv run mypy src`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/ontocurator/application/preferences.py tests/test_preferences_api.py
git commit -m "feat(tree): remember per annotator whether the tree stays open"
```

---

### Task 6: Regenerate the contract

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
Expected, and nothing else:

- two new paths, `/api/v1/terms/tree/open` and `/api/v1/terms/tree/node`;
- new schemas `TreeNode`, `TreeLevel`, `TreeTermDetail`, `TreeOpenRequest`, `TreeOpenResponse`, `TreeNodeRequest`, `TreeNodeResponse`. In the three response-side schemas every field is required. In `TreeNodeRequest`, `via_parent_id` and `expand` are optional;
- `Preferences` and `PreferencesUpdate` gain `tree_pinned_by_annotator`.

- [ ] **Step 4: Typecheck, and fix fixtures in this commit if needed**

Run (in `frontend/`): `npm run typecheck && npm test`
Expected: no errors. If `tree_pinned_by_annotator` came out as a **required** field of `Preferences`, the tests that mock `api.getPreferences` / `api.updatePreferences` with `{ last_annotator_id: …, mode_by_package: {} }` stop typechecking. Then add `tree_pinned_by_annotator: {}` to those object literals (search: `grep -rn "mode_by_package" frontend/tests`) and include the test files in this commit, so that this commit typechecks.

- [ ] **Step 5: Commit**

```bash
git add contracts/openapi.json frontend/src/api/generated.ts
git add -u frontend/tests
git commit -m "build: regenerate the API contract for the ontology tree"
```

---

### Task 7: Frontend — client methods and the tree's pure logic

A term with several parents appears once under each. A row of the tree is therefore identified by its **path** — the term ids from the root, joined with `/` (term ids are CURIEs and contain no `/`) — and expansion is remembered per path, not per term.

**Files:**
- Modify: `frontend/src/api/client.ts`
- Create: `frontend/src/editor/treeState.ts`
- Test: `frontend/tests/treeState.test.ts` (create), `frontend/tests/apiClient.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/treeState.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  emptyTree,
  keyAction,
  keysAlong,
  parentKeyOf,
  pathKey,
  termOfKey,
  visibleRows,
  withLevels,
  withRoots,
} from "../src/editor/treeState";

const node = (term_id: string, label: string, child_count = 0) => ({ term_id, label, child_count });

// Root > (Alpha > Shared, Beta > Shared): "Shared" sits under two parents.
// Beta's children are not loaded yet.
const sample = () =>
  withLevels(withRoots(emptyTree(), [node("R", "Root", 2)]), [
    { term_id: "R", children: [node("A", "Alpha", 1), node("B", "Beta", 1)] },
    { term_id: "A", children: [node("X", "Shared")] },
  ]);

const keys = (data: ReturnType<typeof sample>, expanded: string[]) =>
  visibleRows(data, new Set(expanded)).map((row) => row.key);

describe("tree keys", () => {
  it("a key is the path of term ids from the root", () => {
    expect(pathKey(["R", "A", "X"])).toBe("R/A/X");
    expect(termOfKey("R/A/X")).toBe("X");
    expect(termOfKey("R")).toBe("R");
    expect(parentKeyOf("R/A/X")).toBe("R/A");
    expect(parentKeyOf("R")).toBeNull();
    expect(keysAlong(["R", "A", "X"])).toEqual(["R", "R/A", "R/A/X"]);
    expect(keysAlong([])).toEqual([]);
  });
});

describe("visibleRows", () => {
  it("shows only the roots while nothing is expanded", () => {
    expect(visibleRows(sample(), new Set())).toEqual([
      { key: "R", termId: "R", label: "Root", depth: 1, parentKey: null, childCount: 2, expanded: false, posInSet: 1, setSize: 1 },
    ]);
  });

  it("lists expanded branches depth-first with level and position", () => {
    const rows = visibleRows(sample(), new Set(["R", "R/A"]));

    expect(rows.map((row) => row.key)).toEqual(["R", "R/A", "R/A/X", "R/B"]);
    expect(rows.map((row) => row.depth)).toEqual([1, 2, 3, 2]);
    expect(rows.map((row) => row.parentKey)).toEqual([null, "R", "R/A", "R"]);
    expect(rows.map((row) => [row.posInSet, row.setSize])).toEqual([[1, 1], [1, 2], [1, 1], [2, 2]]);
    expect(rows.map((row) => row.expanded)).toEqual([true, true, false, false]);
  });

  it("gives a term with two parents one row per place, expanded independently", () => {
    const data = withLevels(sample(), [{ term_id: "B", children: [node("X", "Shared")] }]);

    expect(keys(data, ["R", "R/A"])).toEqual(["R", "R/A", "R/A/X", "R/B"]);
    expect(keys(data, ["R", "R/A", "R/B"])).toEqual(["R", "R/A", "R/A/X", "R/B", "R/B/X"]);
    const shared = visibleRows(data, new Set(["R", "R/A", "R/B"])).filter((row) => row.termId === "X");
    expect(shared.map((row) => row.parentKey)).toEqual(["R/A", "R/B"]);
  });

  it("does not show a branch as open before its children are loaded", () => {
    const rows = visibleRows(sample(), new Set(["R", "R/B"]));

    expect(rows.map((row) => row.key)).toEqual(["R", "R/A", "R/B"]);
    expect(rows.find((row) => row.key === "R/B")?.expanded).toBe(false);
  });

  it("never shows a leaf as open", () => {
    const rows = visibleRows(sample(), new Set(["R", "R/A", "R/A/X"]));

    expect(rows.find((row) => row.key === "R/A/X")?.expanded).toBe(false);
  });

  it("replaces the roots and keeps loaded children when levels arrive later", () => {
    const data = withLevels(sample(), [{ term_id: "B", children: [node("Y", "Yonder")] }]);

    expect(data.roots).toEqual(["R"]);
    expect(data.children.A).toEqual(["X"]);
    expect(data.children.B).toEqual(["Y"]);
    expect(data.nodes.Y.label).toBe("Yonder");
  });
});

describe("keyAction", () => {
  const rows = visibleRows(sample(), new Set(["R", "R/A"])); // R, R/A, R/A/X, R/B

  it("moves up and down through the visible rows and stops at the ends", () => {
    expect(keyAction(rows, "R/A", "ArrowDown")).toEqual({ type: "focus", key: "R/A/X" });
    expect(keyAction(rows, "R/A/X", "ArrowUp")).toEqual({ type: "focus", key: "R/A" });
    expect(keyAction(rows, "R/B", "ArrowDown")).toBeNull();
    expect(keyAction(rows, "R", "ArrowUp")).toBeNull();
    expect(keyAction(rows, "R/A/X", "Home")).toEqual({ type: "focus", key: "R" });
    expect(keyAction(rows, "R", "End")).toEqual({ type: "focus", key: "R/B" });
  });

  it("right opens a closed branch, then goes to its first child; nothing on a leaf", () => {
    expect(keyAction(rows, "R/B", "ArrowRight")).toEqual({ type: "expand", key: "R/B" });
    expect(keyAction(rows, "R/A", "ArrowRight")).toEqual({ type: "focus", key: "R/A/X" });
    expect(keyAction(rows, "R/A/X", "ArrowRight")).toBeNull();
  });

  it("left closes an open branch, otherwise goes to the parent", () => {
    expect(keyAction(rows, "R/A", "ArrowLeft")).toEqual({ type: "collapse", key: "R/A" });
    expect(keyAction(rows, "R/A/X", "ArrowLeft")).toEqual({ type: "focus", key: "R/A" });
    expect(keyAction(rows, "R/B", "ArrowLeft")).toEqual({ type: "focus", key: "R" });
    expect(keyAction(visibleRows(sample(), new Set()), "R", "ArrowLeft")).toBeNull();
  });

  it("Enter and Space select, Escape closes, other keys are not the tree's", () => {
    expect(keyAction(rows, "R/A/X", "Enter")).toEqual({ type: "select", key: "R/A/X" });
    expect(keyAction(rows, "R/A/X", " ")).toEqual({ type: "select", key: "R/A/X" });
    expect(keyAction(rows, "R/A", "Escape")).toEqual({ type: "close" });
    expect(keyAction([], null, "Escape")).toEqual({ type: "close" });
    expect(keyAction(rows, "R/A", "j")).toBeNull();
    expect(keyAction(rows, "R/A", "Tab")).toBeNull();
  });

  it("starts at the first row when no row has the focus", () => {
    expect(keyAction(rows, null, "ArrowDown")).toEqual({ type: "focus", key: "R" });
    expect(keyAction(rows, "gone", "ArrowUp")).toEqual({ type: "focus", key: "R" });
    expect(keyAction(rows, null, "Enter")).toBeNull();
    expect(keyAction([], null, "ArrowDown")).toBeNull();
  });
});
```

In `frontend/tests/apiClient.test.ts`, directly above the line `  it("maps 409 Conflict to ConflictError", async () => {`, add

```ts
  it("posts tree requests to the tree endpoints", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    globalThis.fetch = fetchSpy;
    const client = new ApiClient({ token: "tok" });
    const workspace_key = {
      package_id: "pkg",
      document_id: "doc",
      annotator_id: "dr-a",
      mode: "independent" as const,
      scope_id: "scope-default",
      target_set_id: "empty",
    };

    await client.openTree({ workspace_key, annotation_id: "a", layer_id: "l", term_id: "HP:1" });
    await client.loadTreeNode({ workspace_key, annotation_id: "a", layer_id: "l", browse_id: "w", term_id: "HP:2", expand: true });

    expect(fetchSpy.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ["/api/v1/terms/tree/open", "POST"],
      ["/api/v1/terms/tree/node", "POST"],
    ]);
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({ workspace_key, annotation_id: "a", layer_id: "l", term_id: "HP:1" });
    expect(JSON.parse(fetchSpy.mock.calls[1][1].body)).toMatchObject({ browse_id: "w", term_id: "HP:2", expand: true });
  });

```

- [ ] **Step 2: Run the tests to verify they fail**

Run (in `frontend/`): `npx vitest run tests/treeState.test.ts tests/apiClient.test.ts`
Expected: `treeState.test.ts` fails to load (`Failed to resolve import "../src/editor/treeState"`); the new client test fails with `client.openTree is not a function`.

- [ ] **Step 3: Add the client types and methods**

In `frontend/src/api/client.ts`, after the line `export type SearchCandidate = components["schemas"]["SearchCandidate"];`, add

```ts
export type TreeNode = components["schemas"]["TreeNode"];
export type TreeLevel = components["schemas"]["TreeLevel"];
export type TreeTermDetail = components["schemas"]["TreeTermDetail"];
export type TreeOpenRequest = components["schemas"]["TreeOpenRequest"];
export type TreeOpenResponse = components["schemas"]["TreeOpenResponse"];
export type TreeNodeRequest = components["schemas"]["TreeNodeRequest"];
export type TreeNodeResponse = components["schemas"]["TreeNodeResponse"];
```

Directly above the line `  async resolveTermLabels(packageId: string, terms: TermLookup[]): Promise<TermLabel[]> {`, add

```ts
  /** Start a walk through the ontology tree at a term. The server logs what it shows. */
  async openTree(req: TreeOpenRequest): Promise<TreeOpenResponse> {
    return this.request<TreeOpenResponse>("/api/v1/terms/tree/open", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  /** A shown node: its details; with `expand` its children; with `via_parent_id` the path through that parent. */
  async loadTreeNode(req: TreeNodeRequest): Promise<TreeNodeResponse> {
    return this.request<TreeNodeResponse>("/api/v1/terms/tree/node", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

```

- [ ] **Step 4: Implement the pure logic**

Create `frontend/src/editor/treeState.ts`:

```ts
import type { TreeLevel, TreeNode } from "../api/client";

/** What the tree has loaded so far. */
export interface TreeData {
  nodes: Record<string, TreeNode>;
  /** Loaded children per term id. A missing entry means: not loaded yet. */
  children: Record<string, string[]>;
  roots: string[];
}

/**
 * One visible row. `key` is the path of term ids from the root, joined with "/":
 * a term with several parents has one row per place, and each is expanded on its own.
 */
export interface TreeRow {
  key: string;
  termId: string;
  label: string;
  /** 1 for a root. */
  depth: number;
  parentKey: string | null;
  childCount: number;
  expanded: boolean;
  posInSet: number;
  setSize: number;
}

export type TreeKeyAction =
  | { type: "focus"; key: string }
  | { type: "expand"; key: string }
  | { type: "collapse"; key: string }
  | { type: "select"; key: string }
  | { type: "close" };

export const emptyTree = (): TreeData => ({ nodes: {}, children: {}, roots: [] });

export const pathKey = (path: string[]): string => path.join("/");

export const termOfKey = (key: string): string => key.slice(key.lastIndexOf("/") + 1);

export const parentKeyOf = (key: string): string | null => {
  const cut = key.lastIndexOf("/");
  return cut < 0 ? null : key.slice(0, cut);
};

/** Keys of the nodes a path runs through, root first; the last one is the term itself. */
export const keysAlong = (path: string[]): string[] =>
  path.map((_, index) => pathKey(path.slice(0, index + 1)));

const withNodes = (nodes: Record<string, TreeNode>, list: TreeNode[]): Record<string, TreeNode> => {
  const next = { ...nodes };
  for (const node of list) next[node.term_id] = node;
  return next;
};

export function withRoots(data: TreeData, roots: TreeNode[]): TreeData {
  return { ...data, nodes: withNodes(data.nodes, roots), roots: roots.map((node) => node.term_id) };
}

/** Record the children of expanded nodes. Children loaded earlier stay. */
export function withLevels(data: TreeData, levels: TreeLevel[]): TreeData {
  let nodes = data.nodes;
  const children = { ...data.children };
  for (const level of levels) {
    nodes = withNodes(nodes, level.children);
    children[level.term_id] = level.children.map((node) => node.term_id);
  }
  return { ...data, nodes, children };
}

/** The rows on screen, depth-first. A branch is open only if its children are loaded. */
export function visibleRows(data: TreeData, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (ids: string[], parentKey: string | null, depth: number) => {
    const known = ids.filter((id) => data.nodes[id] !== undefined);
    known.forEach((termId, index) => {
      const node = data.nodes[termId];
      const key = parentKey === null ? termId : `${parentKey}/${termId}`;
      const kids = data.children[termId];
      const isExpanded = node.child_count > 0 && kids !== undefined && expanded.has(key);
      rows.push({
        key,
        termId,
        label: node.label,
        depth,
        parentKey,
        childCount: node.child_count,
        expanded: isExpanded,
        posInSet: index + 1,
        setSize: known.length,
      });
      if (isExpanded && kids) walk(kids, key, depth + 1);
    });
  };
  walk(data.roots, null, 1);
  return rows;
}

const MOVES = ["ArrowDown", "ArrowUp", "Home", "End"];

/** What a key press means in the tree (ARIA tree pattern), or null if it is not the tree's. */
export function keyAction(rows: TreeRow[], focusedKey: string | null, key: string): TreeKeyAction | null {
  if (key === "Escape") return { type: "close" };
  if (rows.length === 0) return null;
  const index = rows.findIndex((row) => row.key === focusedKey);
  if (index < 0) return MOVES.includes(key) ? { type: "focus", key: rows[0].key } : null;
  const row = rows[index];
  switch (key) {
    case "ArrowDown":
      return index + 1 < rows.length ? { type: "focus", key: rows[index + 1].key } : null;
    case "ArrowUp":
      return index > 0 ? { type: "focus", key: rows[index - 1].key } : null;
    case "Home":
      return { type: "focus", key: rows[0].key };
    case "End":
      return { type: "focus", key: rows[rows.length - 1].key };
    case "ArrowRight": {
      if (row.childCount === 0) return null;
      if (!row.expanded) return { type: "expand", key: row.key };
      const next = rows[index + 1];
      return next && next.parentKey === row.key ? { type: "focus", key: next.key } : null;
    }
    case "ArrowLeft":
      if (row.expanded) return { type: "collapse", key: row.key };
      return row.parentKey === null ? null : { type: "focus", key: row.parentKey };
    case "Enter":
    case " ":
      return { type: "select", key: row.key };
    default:
      return null;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (in `frontend/`): `npx vitest run tests/treeState.test.ts tests/apiClient.test.ts && npm run typecheck`
Expected: all pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/editor/treeState.ts frontend/tests/treeState.test.ts frontend/tests/apiClient.test.ts
git commit -m "feat(frontend): tree rows and keyboard moves as plain functions"
```

---

### Task 8: Frontend — the tree widget

A flat list of rows with `aria-level`, `aria-posinset` and `aria-setsize` (the ARIA tree pattern allows that and it keeps scrolling simple). Exactly one row is in the Tab order (roving `tabindex`); the arrow keys move the DOM focus. The triangle is not focusable: the keyboard opens branches with the arrow keys. Moving the focus does not select; `Enter`, `Space` or a click does.

**Files:**
- Create: `frontend/src/editor/TermTree.tsx`
- Modify: `frontend/src/styles.css`
- Test: `frontend/tests/termTree.test.tsx` (create)

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/termTree.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TermTree } from "../src/editor/TermTree";
import { emptyTree, visibleRows, withLevels, withRoots } from "../src/editor/treeState";

const node = (term_id: string, label: string, child_count = 0) => ({ term_id, label, child_count });

// Root > (Alpha > Shared, Beta > Yonder), everything loaded.
const data = withLevels(withRoots(emptyTree(), [node("R", "Root", 2)]), [
  { term_id: "R", children: [node("A", "Alpha", 1), node("B", "Beta", 1)] },
  { term_id: "A", children: [node("X", "Shared")] },
  { term_id: "B", children: [node("Y", "Yonder")] },
]);

interface HarnessProps {
  onSelect?: (key: string) => void;
  onClose?: () => void;
  current?: string | null;
  reveal?: { key: string; focus: boolean } | null;
}

/** The tree with the state its parent would keep. Starts with Root and Alpha open, Alpha selected. */
const Harness = ({ onSelect, onClose, current = null, reveal = null }: HarnessProps) => {
  const [expanded, setExpanded] = useState(() => new Set(["R", "R/A"]));
  const [focused, setFocused] = useState<string | null>("R/A");
  const [selected, setSelected] = useState<string | null>("R/A");
  return (
    <TermTree
      rows={visibleRows(data, expanded)}
      focusedKey={focused}
      selectedKey={selected}
      currentTermId={current}
      loadingKeys={new Set()}
      reveal={reveal}
      label="Terms"
      onFocusKey={setFocused}
      onExpand={(key) => setExpanded((now) => new Set(now).add(key))}
      onCollapse={(key) =>
        setExpanded((now) => {
          const next = new Set(now);
          next.delete(key);
          return next;
        })
      }
      onSelect={(key) => {
        setSelected(key);
        onSelect?.(key);
      }}
      onClose={() => onClose?.()}
    />
  );
};

const item = (label: string) =>
  screen.getByText(label, { selector: ".tree-label" }).closest('[role="treeitem"]') as HTMLElement;
const labels = () => screen.getAllByRole("treeitem").map((el) => el.querySelector(".tree-label")?.textContent);

const originalScroll = (Element.prototype as any).scrollIntoView;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  (Element.prototype as any).scrollIntoView = originalScroll;
});

describe("TermTree", () => {
  it("is an ARIA tree whose rows carry level, position, state and child count", () => {
    render(<Harness />);

    expect(screen.getByRole("tree", { name: "Terms" })).toBeDefined();
    expect(labels()).toEqual(["Root", "Alpha", "Shared", "Beta"]);

    const alpha = item("Alpha");
    expect(alpha.getAttribute("aria-level")).toBe("2");
    expect(alpha.getAttribute("aria-posinset")).toBe("1");
    expect(alpha.getAttribute("aria-setsize")).toBe("2");
    expect(alpha.getAttribute("aria-expanded")).toBe("true");
    expect(alpha.getAttribute("aria-selected")).toBe("true");
    expect(alpha.dataset.key).toBe("R/A");
    expect(alpha.querySelector(".tree-count")?.textContent).toBe("1");
    expect(item("Beta").getAttribute("aria-expanded")).toBe("false");
    expect(item("Beta").getAttribute("aria-selected")).toBe("false");

    // A leaf has no triangle, no count and no expanded state.
    const leaf = item("Shared");
    expect(leaf.hasAttribute("aria-expanded")).toBe(false);
    expect(leaf.querySelector(".tree-count")).toBeNull();
    expect(leaf.querySelector(".tree-toggle")?.textContent).toBe("");
    expect(alpha.querySelector(".tree-toggle")?.textContent).toBe("▾");
    expect(item("Beta").querySelector(".tree-toggle")?.textContent).toBe("▸");
  });

  it("keeps exactly one row in the Tab order and moves it with the focus", () => {
    render(<Harness />);
    const tabStops = () => screen.getAllByRole("treeitem").filter((el) => el.getAttribute("tabindex") === "0");

    expect(tabStops()).toEqual([item("Alpha")]);

    item("Alpha").focus();
    fireEvent.keyDown(item("Alpha"), { key: "ArrowDown" });

    expect(document.activeElement).toBe(item("Shared"));
    expect(tabStops()).toEqual([item("Shared")]);
    // Moving the focus selected nothing.
    expect(item("Alpha").getAttribute("aria-selected")).toBe("true");
    expect(item("Shared").getAttribute("aria-selected")).toBe("false");
  });

  it("opens, closes and walks branches with the arrow keys", () => {
    render(<Harness />);
    item("Alpha").focus();

    fireEvent.keyDown(item("Alpha"), { key: "ArrowLeft" });
    expect(labels()).toEqual(["Root", "Alpha", "Beta"]);
    expect(item("Alpha").getAttribute("aria-expanded")).toBe("false");

    fireEvent.keyDown(item("Alpha"), { key: "ArrowRight" });
    expect(labels()).toEqual(["Root", "Alpha", "Shared", "Beta"]);
    expect(document.activeElement).toBe(item("Alpha"));

    fireEvent.keyDown(item("Alpha"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(item("Shared"));

    fireEvent.keyDown(item("Shared"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(item("Alpha"));

    fireEvent.keyDown(item("Alpha"), { key: "End" });
    expect(document.activeElement).toBe(item("Beta"));
    fireEvent.keyDown(item("Beta"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(item("Shared"));
    fireEvent.keyDown(item("Shared"), { key: "Home" });
    expect(document.activeElement).toBe(item("Root"));
  });

  it("selects with Enter or a click, and a click on the triangle only opens", () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);

    item("Alpha").focus();
    fireEvent.keyDown(item("Alpha"), { key: "ArrowDown" });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(item("Shared"), { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith("R/A/X");
    expect(item("Shared").getAttribute("aria-selected")).toBe("true");

    fireEvent.click(item("Beta").querySelector(".tree-toggle") as HTMLElement);
    expect(labels()).toEqual(["Root", "Alpha", "Shared", "Beta", "Yonder"]);
    expect(onSelect).toHaveBeenCalledTimes(1);

    fireEvent.click(item("Yonder"));
    expect(onSelect).toHaveBeenLastCalledWith("R/B/Y");
    expect(item("Yonder").getAttribute("aria-selected")).toBe("true");
    expect(item("Shared").getAttribute("aria-selected")).toBe("false");
  });

  it("handles its keys itself: Escape closes and reaches no handler further up", () => {
    const onClose = vi.fn();
    const outside = vi.fn();
    window.addEventListener("keydown", outside);
    try {
      render(<Harness onClose={onClose} />);

      fireEvent.keyDown(item("Alpha"), { key: "Escape" });
      fireEvent.keyDown(item("Alpha"), { key: "ArrowDown" });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(outside).not.toHaveBeenCalled();

      // A key the tree does not use passes through, and so does a shortcut with a modifier.
      fireEvent.keyDown(item("Alpha"), { key: "j" });
      fireEvent.keyDown(item("Alpha"), { key: "ArrowRight", altKey: true });
      expect(outside).toHaveBeenCalledTimes(2);
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", outside);
    }
  });

  it("marks the term the annotation carries", () => {
    render(<Harness current="X" />);

    expect(item("Shared").getAttribute("aria-current")).toBe("true");
    expect(item("Shared").querySelector(".tree-current")?.textContent).toBe("current");
    expect(item("Alpha").hasAttribute("aria-current")).toBe(false);
    expect(item("Alpha").querySelector(".tree-current")).toBeNull();
  });

  it("scrolls the revealed row into view and focuses it only when asked", () => {
    const scrolled: Array<[string | undefined, unknown]> = [];
    (Element.prototype as any).scrollIntoView = function (this: HTMLElement, options: unknown) {
      scrolled.push([this.dataset.key, options]);
    };

    const first = render(<Harness reveal={{ key: "R/A/X", focus: false }} />);
    expect(scrolled).toEqual([["R/A/X", { block: "center" }]]);
    expect(document.activeElement).not.toBe(item("Shared"));
    first.unmount();

    render(<Harness reveal={{ key: "R/A/X", focus: true }} />);
    expect(scrolled).toHaveLength(2);
    expect(document.activeElement).toBe(item("Shared"));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (in `frontend/`): `npx vitest run tests/termTree.test.tsx`
Expected: the file fails to load — `Failed to resolve import "../src/editor/TermTree"`.

- [ ] **Step 3: Implement the widget**

Create `frontend/src/editor/TermTree.tsx`:

```tsx
import React, { useEffect, useRef } from "react";
import { keyAction, type TreeRow } from "./treeState";

export interface TermTreeProps {
  rows: TreeRow[];
  /** The row in the Tab order; the arrow keys start from it. */
  focusedKey: string | null;
  selectedKey: string | null;
  /** The term the annotation carries right now. */
  currentTermId: string | null;
  /** Rows whose data is being loaded. */
  loadingKeys: ReadonlySet<string>;
  /** Scroll this row into view (and focus it, if asked) whenever this object changes. */
  reveal: { key: string; focus: boolean } | null;
  label: string;
  onFocusKey: (key: string) => void;
  onExpand: (key: string) => void;
  onCollapse: (key: string) => void;
  onSelect: (key: string) => void;
  onClose: () => void;
}

/** An ARIA tree as a flat list of rows with roving focus. */
export const TermTree: React.FC<TermTreeProps> = ({
  rows,
  focusedKey,
  selectedKey,
  currentTermId,
  loadingKeys,
  reveal,
  label,
  onFocusKey,
  onExpand,
  onCollapse,
  onSelect,
  onClose,
}) => {
  const items = useRef(new Map<string, HTMLLIElement>());
  // Exactly one row is in the Tab order: the focused one, or the first while there is none.
  const tabKey = rows.some((row) => row.key === focusedKey) ? focusedKey : rows[0]?.key ?? null;

  useEffect(() => {
    if (!reveal) return;
    const element = items.current.get(reveal.key);
    if (!element) return;
    // jsdom has no scrollIntoView.
    element.scrollIntoView?.({ block: "center" });
    if (reveal.focus) element.focus({ preventScroll: true });
  }, [reveal]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const action = keyAction(rows, tabKey, event.key);
    if (!action) return;
    // The tree handled it: the case screen's own shortcuts (Escape clears the selection) stay out.
    event.preventDefault();
    event.stopPropagation();
    if (action.type === "focus") {
      items.current.get(action.key)?.focus();
      onFocusKey(action.key);
    } else if (action.type === "expand") {
      onExpand(action.key);
    } else if (action.type === "collapse") {
      onCollapse(action.key);
    } else if (action.type === "select") {
      onSelect(action.key);
    } else {
      onClose();
    }
  };

  const toggle = (event: React.MouseEvent, row: TreeRow) => {
    event.stopPropagation(); // opening a branch is not selecting it
    if (row.expanded) onCollapse(row.key);
    else onExpand(row.key);
  };

  return (
    <ul className="term-tree" role="tree" aria-label={label} onKeyDown={handleKeyDown}>
      {rows.map((row) => {
        const isCurrent = row.termId === currentTermId;
        return (
          <li
            key={row.key}
            ref={(element) => {
              if (element) items.current.set(row.key, element);
              else items.current.delete(row.key);
            }}
            role="treeitem"
            className={isCurrent ? "tree-item tree-item--current" : "tree-item"}
            style={{ paddingLeft: 8 + (row.depth - 1) * 14 }}
            data-key={row.key}
            data-term-id={row.termId}
            aria-level={row.depth}
            aria-posinset={row.posInSet}
            aria-setsize={row.setSize}
            aria-expanded={row.childCount > 0 ? row.expanded : undefined}
            aria-selected={row.key === selectedKey}
            aria-current={isCurrent ? "true" : undefined}
            aria-busy={loadingKeys.has(row.key) ? true : undefined}
            tabIndex={row.key === tabKey ? 0 : -1}
            onFocus={() => onFocusKey(row.key)}
            onClick={() => onSelect(row.key)}
          >
            {row.childCount > 0 ? (
              <span className="tree-toggle" aria-hidden="true" onClick={(event) => toggle(event, row)}>
                {row.expanded ? "▾" : "▸"}
              </span>
            ) : (
              <span className="tree-toggle" aria-hidden="true" />
            )}
            <span className="tree-label">{row.label}</span>
            {row.childCount > 0 && (
              <span className="tree-count" aria-label={`${row.childCount} children`}>
                {row.childCount}
              </span>
            )}
            {isCurrent && <span className="tree-current">current</span>}
          </li>
        );
      })}
    </ul>
  );
};
```

- [ ] **Step 4: Add the styles**

Append to the end of `frontend/src/styles.css`:

```css

/* Ontology tree: the tree itself */
.term-tree {
  list-style: none;
  padding: 4px 0;
}

.tree-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding-top: 3px;
  padding-bottom: 3px;
  padding-right: 8px;
  font-size: 0.88rem;
  line-height: 1.35;
  cursor: pointer;
  overflow-wrap: anywhere;
}

.tree-item:hover {
  background: var(--bg-primary);
}

.tree-item[aria-selected="true"] {
  background: var(--primary-light);
}

.tree-item:focus {
  outline: none;
}

.tree-item:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: -2px;
}

.tree-item[aria-busy="true"] {
  cursor: progress;
}

.tree-toggle {
  flex: 0 0 14px;
  text-align: center;
  color: var(--text-muted);
  user-select: none;
}

.tree-label {
  flex: 1 1 auto;
  min-width: 0;
}

.tree-item--current .tree-label {
  font-weight: 600;
}

.tree-count {
  flex-shrink: 0;
  font-size: 0.72rem;
  color: var(--text-muted);
}

.tree-current {
  flex-shrink: 0;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--primary);
  border: 1px solid var(--primary);
  border-radius: 999px;
  padding: 0 6px;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (in `frontend/`): `npx vitest run tests/termTree.test.tsx && npm run typecheck`
Expected: 7 tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/editor/TermTree.tsx frontend/src/styles.css frontend/tests/termTree.test.tsx
git commit -m "feat(frontend): add the ontology tree widget"
```

---

### Task 9: Frontend — the tree browser: loading, details, dialog and panel

`TreeBrowser` is one walk: it calls `tree/open` once when it mounts, and its parent gives it a new `key` to start another walk. It renders in two variants with the **same DOM structure** (only classes and ARIA attributes differ), so that pinning a dialog keeps every DOM node, the scroll position and the focus.

| | `variant="dialog"` | `variant="panel"` |
|---|---|---|
| Role | `dialog`, `aria-modal` | `region` |
| Focus | taken on open, Tab wraps inside, returned to the opener on close | not trapped |
| `Escape` | closes from anywhere | closes only while the focus is in the tree |

**Files:**
- Create: `frontend/src/editor/TreeBrowser.tsx`
- Modify: `frontend/src/styles.css`
- Test: `frontend/tests/treeBrowser.test.tsx` (create)

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/treeBrowser.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type TreeOpenResponse, type TreeTermDetail } from "../src/api/client";
import { TreeBrowser, type TreeBrowserProps } from "../src/editor/TreeBrowser";

const key = {
  package_id: "pkg",
  document_id: "doc",
  annotator_id: "dr-a",
  mode: "independent" as const,
  scope_id: "scope-default",
  target_set_id: "empty",
};

const node = (term_id: string, label: string, child_count = 0) => ({ term_id, label, child_count });
const detail = (term_id: string, label: string, extra: Partial<TreeTermDetail> = {}): TreeTermDetail => ({
  term_id,
  label,
  definition: "",
  synonyms: [],
  translations: {},
  parents: [],
  ...extra,
});

const ALL = node("HP:1", "All", 2);
const HEARING = node("HP:365", "Hearing impairment", 1);
const NERVOUS = node("HP:707", "Nervous system", 2);
const AREFLEXIA = node("HP:1284", "Areflexia");
const SEIZURE = node("HP:1250", "Seizure", 2);
const DIALEPTIC = node("HP:11146", "Dialeptic seizure");
const STATUS = node("HP:2133", "Status epilepticus");
const SENSORINEURAL = node("HP:407", "Sensorineural hearing impairment");

// All > (Hearing impairment [closed], Nervous system > (Areflexia, Seizure > (Dialeptic seizure, Status epilepticus)))
const seizureWalk = (): TreeOpenResponse => ({
  browse_id: "walk-1",
  start_status: "valid",
  roots: [ALL],
  path: ["HP:1", "HP:707", "HP:1250"],
  levels: [
    { term_id: "HP:1", children: [HEARING, NERVOUS] },
    { term_id: "HP:707", children: [AREFLEXIA, SEIZURE] },
    { term_id: "HP:1250", children: [DIALEPTIC, STATUS] },
  ],
  detail: detail("HP:1250", "Seizure", {
    definition: "A sudden surge of electrical activity.",
    synonyms: ["Seizures", "Convulsion"],
    translations: { de: ["Krampfanfall", "Anfall"], fr: ["Crise"] },
    parents: [NERVOUS],
  }),
});

// Root > (Alpha > Shared, Beta [closed]); "Shared" also sits under Beta.
const ROOT = node("R", "Root", 2);
const ALPHA = node("A", "Alpha", 1);
const BETA = node("B", "Beta", 2);
const SHARED = node("X", "Shared");
const sharedDetail = detail("X", "Shared", { parents: [ALPHA, BETA] });
const sharedWalk = (): TreeOpenResponse => ({
  browse_id: "walk-2",
  start_status: "valid",
  roots: [ROOT],
  path: ["R", "A", "X"],
  levels: [
    { term_id: "R", children: [ALPHA, BETA] },
    { term_id: "A", children: [SHARED] },
    { term_id: "X", children: [] },
  ],
  detail: sharedDetail,
});

const baseProps = (): TreeBrowserProps => ({
  variant: "dialog",
  workspaceKey: key,
  annotationId: "ann-1",
  layerId: "phenotype",
  startTermId: "HP:1250",
  currentTermId: "HP:1250",
  canAssign: true,
  focusOnOpen: true,
  pinned: false,
  canPin: true,
  onTogglePin: vi.fn(),
  onClose: vi.fn(),
  onUseTerm: vi.fn().mockResolvedValue(undefined),
});

const renderBrowser = (overrides: Partial<TreeBrowserProps> = {}) => {
  const props = { ...baseProps(), ...overrides };
  return { props, ...render(<TreeBrowser {...props} />) };
};

const item = (label: string) =>
  screen.getByText(label, { selector: ".tree-label" }).closest('[role="treeitem"]') as HTMLElement;
const toggleOf = (label: string) => item(label).querySelector(".tree-toggle") as HTMLElement;
const labels = () => screen.getAllByRole("treeitem").map((el) => el.querySelector(".tree-label")?.textContent);
const loaded = (label = "Seizure") => screen.findByText(label, { selector: ".tree-label" });
const useButton = () => screen.getByRole("button", { name: "Use this term" }) as HTMLButtonElement;
const detailPane = (container: HTMLElement) => within(container.querySelector(".tree-detail") as HTMLElement);

const originalScroll = (Element.prototype as any).scrollIntoView;
let scrolled: Array<string | undefined> = [];

beforeEach(() => {
  scrolled = [];
  (Element.prototype as any).scrollIntoView = function (this: HTMLElement) {
    scrolled.push(this.dataset.key);
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  (Element.prototype as any).scrollIntoView = originalScroll;
});

describe("TreeBrowser: one walk", () => {
  it("opens at the start term: path open, term selected, focused and scrolled into view", async () => {
    const open = vi.spyOn(api, "openTree").mockResolvedValue(seizureWalk());
    renderBrowser();

    const start = (await loaded()).closest('[role="treeitem"]') as HTMLElement;

    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toEqual({
      workspace_key: key,
      annotation_id: "ann-1",
      layer_id: "phenotype",
      term_id: "HP:1250",
    });
    expect(labels()).toEqual([
      "All",
      "Hearing impairment",
      "Nervous system",
      "Areflexia",
      "Seizure",
      "Dialeptic seizure",
      "Status epilepticus",
    ]);
    expect(start.dataset.key).toBe("HP:1/HP:707/HP:1250");
    expect(start.getAttribute("aria-selected")).toBe("true");
    expect(start.getAttribute("aria-expanded")).toBe("true");
    expect(start.getAttribute("aria-current")).toBe("true");
    expect(item("Hearing impairment").getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(start);
    expect(scrolled).toEqual(["HP:1/HP:707/HP:1250"]);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows name, id, definition, synonyms and translated names by language", async () => {
    vi.spyOn(api, "openTree").mockResolvedValue(seizureWalk());
    const { container } = renderBrowser();
    await loaded();
    const pane = detailPane(container);

    expect(pane.getByRole("heading", { name: "Seizure" })).toBeDefined();
    expect(pane.getByText("HP:1250")).toBeDefined();
    expect(pane.getByText("A sudden surge of electrical activity.")).toBeDefined();
    expect(pane.getByText("Seizures")).toBeDefined();
    expect(pane.getByText("Convulsion")).toBeDefined();
    expect(pane.getByText("de").nextElementSibling?.textContent).toBe("Krampfanfall; Anfall");
    expect(pane.getByText("fr").nextElementSibling?.textContent).toBe("Crise");
    // The only parent is the one the path runs through.
    expect(pane.queryByText("Also under")).toBeNull();
  });

  it("shows no translation block for a term without translated names", async () => {
    const walk = seizureWalk();
    walk.detail = detail("HP:1250", "Seizure", { parents: [NERVOUS] });
    vi.spyOn(api, "openTree").mockResolvedValue(walk);
    const { container } = renderBrowser();
    await loaded();

    expect(detailPane(container).queryByText("Translated names")).toBeNull();
    expect(detailPane(container).queryByText("Synonyms")).toBeNull();
  });

  it("loads the children of a branch when it is opened, once", async () => {
    vi.spyOn(api, "openTree").mockResolvedValue(seizureWalk());
    const load = vi.spyOn(api, "loadTreeNode").mockResolvedValue({
      detail: detail("HP:365", "Hearing impairment", { parents: [ALL] }),
      children: [SENSORINEURAL],
      path: [],
      levels: [],
    });
    renderBrowser();
    await loaded();

    fireEvent.click(toggleOf("Hearing impairment"));
    await loaded("Sensorineural hearing impairment");

    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0][0]).toMatchObject({
      workspace_key: key,
      annotation_id: "ann-1",
      layer_id: "phenotype",
      browse_id: "walk-1",
      term_id: "HP:365",
      expand: true,
    });
    expect(item("Hearing impairment").getAttribute("aria-expanded")).toBe("true");
    // Opening a branch selects nothing.
    expect(item("Seizure").getAttribute("aria-selected")).toBe("true");

    fireEvent.click(toggleOf("Hearing impairment"));
    expect(screen.queryByText("Sensorineural hearing impairment")).toBeNull();
    fireEvent.click(toggleOf("Hearing impairment"));
    expect(screen.getByText("Sensorineural hearing impairment")).toBeDefined();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("is operable with the keyboard, loading on the way", async () => {
    vi.spyOn(api, "openTree").mockResolvedValue(seizureWalk());
    const load = vi.spyOn(api, "loadTreeNode").mockImplementation(async (req) =>
      req.term_id === "HP:365"
        ? { detail: detail("HP:365", "Hearing impairment"), children: [SENSORINEURAL], path: [], levels: [] }
        : { detail: detail("HP:407", "Sensorineural hearing impairment", { definition: "Inner ear." }), children: [], path: [], levels: [] },
    );
    renderBrowser();
    await loaded();

    fireEvent.keyDown(item("Seizure"), { key: "ArrowLeft" });
    expect(screen.queryByText("Status epilepticus")).toBeNull();
    fireEvent.keyDown(item("Seizure"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(item("Nervous system"));
    fireEvent.keyDown(item("Nervous system"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(item("Hearing impairment"));

    fireEvent.keyDown(item("Hearing impairment"), { key: "ArrowRight" });
    await loaded("Sensorineural hearing impairment");
    expect(load.mock.calls[0][0]).toMatchObject({ term_id: "HP:365", expand: true });

    fireEvent.keyDown(item("Hearing impairment"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(item("Sensorineural hearing impairment"));
    // Still the start term: moving the focus selects nothing.
    expect(item("Seizure").getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(item("Sensorineural hearing impairment"), { key: "Enter" });
    expect(item("Sensorineural hearing impairment").getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByText("Inner ear.")).toBeDefined();
    expect(load.mock.calls[1][0]).toMatchObject({ term_id: "HP:407", expand: false });
  });

  it("a click selects; only 'Use this term' assigns, with the walk's id", async () => {
    vi.spyOn(api, "openTree").mockResolvedValue(seizureWalk());
    const load = vi.spyOn(api, "loadTreeNode").mockResolvedValue({
      detail: detail("HP:2133", "Status epilepticus", { definition: "Prolonged.", parents: [SEIZURE] }),
      children: [],
      path: [],
      levels: [],
    });
    const { props } = renderBrowser();
    await loaded();

    // The selected node is the annotation's current term.
    expect(useButton().disabled).toBe(true);
    expect(screen.getByText("This is the annotation's current term.")).toBeDefined();

    fireEvent.click(item("Status epilepticus"));
    expect(item("Status epilepticus").getAttribute("aria-selected")).toBe("true");
    expect(item("Seizure").getAttribute("aria-selected")).toBe("false");
    expect(await screen.findByText("Prolonged.")).toBeDefined();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0][0]).toMatchObject({ term_id: "HP:2133", expand: false, browse_id: "walk-1" });
    expect(props.onUseTerm).not.toHaveBeenCalled();

    expect(useButton().disabled).toBe(false);
    fireEvent.click(useButton());
    await waitFor(() => expect(props.onUseTerm).toHaveBeenCalledWith("HP:2133", "walk-1"));
    expect(props.onUseTerm).toHaveBeenCalledTimes(1);
    // Whether the tree closes afterwards is the parent's decision.
    expect(props.onClose).not.toHaveBeenCalled();

    // Back on the current term: disabled again, and its details need no second request.
    fireEvent.click(item("Seizure"));
    expect(useButton().disabled).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not offer to assign while the annotation is not the one being edited", async () => {
    vi.spyOn(api, "openTree").mockResolvedValue(seizureWalk());
    vi.spyOn(api, "loadTreeNode").mockResolvedValue({
      detail: detail("HP:2133", "Status epilepticus"),
      children: [],
      path: [],
      levels: [],
    });
    const { props } = renderBrowser({ canAssign: false });
    await loaded();

    fireEvent.click(item("Status epilepticus"));

    expect(useButton().disabled).toBe(true);
    expect(screen.getByText("Select one of your annotations to assign a term from the tree.")).toBeDefined();
    fireEvent.click(useButton());
    expect(props.onUseTerm).not.toHaveBeenCalled();
  });

  it("shows why assigning failed and stays usable", async () => {
    vi.spyOn(api, "openTree").mockResolvedValue(seizureWalk());
    vi.spyOn(api, "loadTreeNode").mockResolvedValue({
      detail: detail("HP:2133", "Status epilepticus"),
      children: [],
      path: [],
      levels: [],
    });
    const onUseTerm = vi.fn().mockRejectedValue(new Error("Search selection does not match"));
    renderBrowser({ onUseTerm });
    await loaded();

    fireEvent.click(item("Status epilepticus"));
    fireEvent.click(useButton());

    expect((await screen.findByRole("alert")).textContent).toBe("Search selection does not match");
    await waitFor(() => expect(useButton().disabled).toBe(false));
  });

  it("'Also under' opens the path through the other parent and jumps there", async () => {
    vi.spyOn(api, "openTree").mockResolvedValue(sharedWalk());
    const load = vi.spyOn(api, "loadTreeNode").mockResolvedValue({
      detail: sharedDetail,
      children: [],
      path: ["R", "B", "X"],
      levels: [
        { term_id: "R", children: [ALPHA, BETA] },
        { term_id: "B", children: [node("Y", "Yonder"), SHARED] },
      ],
    });
    const { container } = renderBrowser({ startTermId: "X", currentTermId: "X" });
    await loaded("Shared");
    const pane = detailPane(container);

    // Alpha is the parent on the open path; only Beta is "also".
    expect(pane.getByText("Also under")).toBeDefined();
    expect(pane.queryByRole("button", { name: "Alpha" })).toBeNull();

    fireEvent.click(pane.getByRole("button", { name: "Beta" }));
    await loaded("Yonder");

    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0][0]).toMatchObject({ browse_id: "walk-2", term_id: "X", via_parent_id: "B", expand: false });
    expect(labels()).toEqual(["Root", "Alpha", "Shared", "Beta", "Yonder", "Shared"]);
    const places = screen
      .getAllByText("Shared", { selector: ".tree-label" })
      .map((el) => el.closest('[role="treeitem"]') as HTMLElement);
    expect(places.map((el) => el.dataset.key)).toEqual(["R/A/X", "R/B/X"]);
    expect(places.map((el) => el.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    expect(document.activeElement).toBe(places[1]);
    expect(scrolled[scrolled.length - 1]).toBe("R/B/X");
    // Seen from Beta, Alpha is the other parent.
    expect(pane.getByRole("button", { name: "Alpha" })).toBeDefined();
    expect(pane.queryByRole("button", { name: "Beta" })).toBeNull();
  });

  it.each([
    ["unknown", "HP:9999999 is not part of this ontology. The tree starts at the top."],
    ["obsolete", "HP:9999999 is obsolete. The tree starts at the top."],
  ] as const)("opens at the top with a notice when the start term is %s", async (status, notice) => {
    vi.spyOn(api, "openTree").mockResolvedValue({
      browse_id: "walk-3",
      start_status: status,
      roots: [ALL],
      path: [],
      levels: [],
      detail: null,
    });
    renderBrowser({ startTermId: "HP:9999999", currentTermId: "HP:9999999" });

    expect((await screen.findByRole("status")).textContent).toBe(notice);
    expect(labels()).toEqual(["All"]);
    expect(item("All").getAttribute("aria-selected")).toBe("false");
    expect(document.activeElement).toBe(item("All"));
    expect(useButton().disabled).toBe(true);
  });

  it("says so when the tree cannot be loaded", async () => {
    vi.spyOn(api, "openTree").mockRejectedValue(new Error("Layer 'x' is not defined in task profile"));
    renderBrowser();

    expect((await screen.findByRole("alert")).textContent).toBe("Layer 'x' is not defined in task profile");
    expect(screen.queryAllByRole("treeitem")).toEqual([]);
  });
});

describe("TreeBrowser: dialog and panel", () => {
  it("as a dialog it is modal, keeps Tab inside and closes on Escape from anywhere", async () => {
    vi.spyOn(api, "openTree").mockResolvedValue(seizureWalk());
    const { props } = renderBrowser();
    const dialog = await screen.findByRole("dialog", { name: "Ontology tree" });
    await loaded();

    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const pin = screen.getByRole("button", { name: "Keep open" });
    const close = screen.getByRole("button", { name: "Close tree" });

    // "Use this term" is disabled here, so the tree row is the last stop.
    fireEvent.keyDown(item("Seizure"), { key: "Tab" });
    expect(document.activeElement).toBe(pin);
    fireEvent.keyDown(pin, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(item("Seizure"));
    // In between, Tab is left to the browser.
    expect(fireEvent.keyDown(close, { key: "Tab" })).toBe(true);

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("as a dialog it takes the focus at once and gives it back when it goes", async () => {
    vi.spyOn(api, "openTree").mockResolvedValue(seizureWalk());
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    try {
      const { unmount } = renderBrowser();
      // Before the tree has loaded, the focus is already inside the dialog.
      expect(screen.getByRole("dialog", { name: "Ontology tree" }).contains(document.activeElement)).toBe(true);
      await loaded();
      unmount();
      expect(document.activeElement).toBe(opener);
    } finally {
      opener.remove();
    }
  });

  it("as a panel it is a plain region: Escape closes it only from inside the tree", async () => {
    vi.spyOn(api, "openTree").mockResolvedValue(seizureWalk());
    const { props, container } = renderBrowser({ variant: "panel", pinned: true });
    const region = await screen.findByRole("region", { name: "Ontology tree" });
    await loaded();

    expect(region.hasAttribute("aria-modal")).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(container.querySelector(".tree-host--panel")).not.toBeNull();
    expect(container.querySelector(".tree-host--dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Keep open" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Close tree" }), { key: "Escape" });
    expect(props.onClose).not.toHaveBeenCalled();
    // Tab is not trapped.
    expect(fireEvent.keyDown(item("Seizure"), { key: "Tab" })).toBe(true);

    fireEvent.keyDown(item("Seizure"), { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("does not pull the focus into a panel that was not opened by hand", async () => {
    vi.spyOn(api, "openTree").mockResolvedValue(seizureWalk());
    renderBrowser({ variant: "panel", pinned: true, focusOnOpen: false });
    await loaded();

    expect(scrolled).toEqual(["HP:1/HP:707/HP:1250"]);
    expect(screen.getByRole("region", { name: "Ontology tree" }).contains(document.activeElement)).toBe(false);
  });

  it("has a pin switch only where pinning is possible, and a close button always", async () => {
    vi.spyOn(api, "openTree").mockResolvedValue(seizureWalk());
    const { props, unmount } = renderBrowser();
    await loaded();

    const pin = screen.getByRole("button", { name: "Keep open" });
    expect(pin.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(pin);
    expect(props.onTogglePin).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close tree" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    unmount();

    renderBrowser({ canPin: false });
    await loaded();
    expect(screen.queryByRole("button", { name: "Keep open" })).toBeNull();
    expect(screen.getByRole("button", { name: "Close tree" })).toBeDefined();
  });

  it("pinning keeps the walk: same tree, same selection, no second request", async () => {
    const open = vi.spyOn(api, "openTree").mockResolvedValue(seizureWalk());
    vi.spyOn(api, "loadTreeNode").mockResolvedValue({
      detail: detail("HP:2133", "Status epilepticus"),
      children: [],
      path: [],
      levels: [],
    });
    const props = baseProps();
    const { rerender } = render(<TreeBrowser {...props} />);
    await loaded();
    fireEvent.click(item("Status epilepticus"));
    const row = item("Status epilepticus");

    rerender(<TreeBrowser {...props} variant="panel" pinned />);

    expect(screen.getByRole("region", { name: "Ontology tree" })).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(open).toHaveBeenCalledTimes(1);
    // The very same DOM node, still selected.
    expect(item("Status epilepticus")).toBe(row);
    expect(row.getAttribute("aria-selected")).toBe("true");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (in `frontend/`): `npx vitest run tests/treeBrowser.test.tsx`
Expected: the file fails to load — `Failed to resolve import "../src/editor/TreeBrowser"`.

- [ ] **Step 3: Implement the browser**

Create `frontend/src/editor/TreeBrowser.tsx`:

```tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, type TreeTermDetail } from "../api/client";
import type { WorkspaceKey } from "./searchState";
import { TermTree } from "./TermTree";
import {
  emptyTree,
  keysAlong,
  parentKeyOf,
  termOfKey,
  visibleRows,
  withLevels,
  withRoots,
  type TreeData,
} from "./treeState";

export interface TreeBrowserProps {
  /** A modal dialog, or a panel docked into the case layout. Same content, same DOM. */
  variant: "dialog" | "panel";
  workspaceKey: WorkspaceKey;
  /** The annotation this walk belongs to. */
  annotationId: string;
  layerId: string;
  /** The term the walk starts at. */
  startTermId: string;
  /** The term that annotation carries right now. */
  currentTermId: string | null;
  /** False while that annotation is not the one being edited. */
  canAssign: boolean;
  /** Move the keyboard focus into the tree once it has loaded. */
  focusOnOpen: boolean;
  pinned: boolean;
  /** False on screens too narrow for the docked panel: then there is no pin switch. */
  canPin: boolean;
  onTogglePin: () => void;
  onClose: () => void;
  /** Assign the term. The walk's id binds the selection to what was shown. */
  onUseTerm: (termId: string, browseId: string) => Promise<void>;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const START_NOTICE: Record<string, string> = {
  obsolete: "is obsolete",
  unknown: "is not part of this ontology",
};

/**
 * One walk through the ontology tree. It opens once, when the component mounts;
 * the parent starts another walk by giving the component a new key.
 */
export const TreeBrowser: React.FC<TreeBrowserProps> = ({
  variant,
  workspaceKey,
  annotationId,
  layerId,
  startTermId,
  currentTermId,
  canAssign,
  focusOnOpen,
  pinned,
  canPin,
  onTogglePin,
  onClose,
  onUseTerm,
}) => {
  const [data, setData] = useState<TreeData>(emptyTree);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, TreeTermDetail>>({});
  const [browseId, setBrowseId] = useState<string | null>(null);
  const [startStatus, setStartStatus] = useState<string | null>(null);
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(() => new Set());
  const [reveal, setReveal] = useState<{ key: string; focus: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const sectionRef = useRef<HTMLElement | null>(null);
  const opened = useRef(false);
  const isDialog = variant === "dialog";
  const latest = useRef({ isDialog, onClose });
  latest.current = { isDialog, onClose };

  // A dialog hands the focus back to where it was opened from. This effect comes
  // first so that it sees the opener before the dialog takes the focus.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (latest.current.isDialog && opener && document.contains(opener)) opener.focus();
    };
  }, []);

  // Dialog only: take the focus, and close on Escape wherever the focus is.
  useEffect(() => {
    if (!isDialog) return;
    const section = sectionRef.current;
    if (section && !section.contains(document.activeElement)) section.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      // Captured at the window: nothing below (the case screen's Escape) sees it.
      event.stopPropagation();
      latest.current.onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [isDialog]);

  // One walk per mount. The guard keeps React's development double-run of
  // effects from logging a second walk; nothing is cancelled on cleanup for
  // the same reason.
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    api
      .openTree({ workspace_key: workspaceKey, annotation_id: annotationId, layer_id: layerId, term_id: startTermId })
      .then((walk) => {
        const keys = keysAlong(walk.path);
        const startKey = keys.length > 0 ? keys[keys.length - 1] : null;
        const firstKey = startKey ?? walk.roots[0]?.term_id ?? null;
        setData(withLevels(withRoots(emptyTree(), walk.roots), walk.levels));
        setExpanded(new Set(keys));
        setBrowseId(walk.browse_id);
        setStartStatus(walk.start_status);
        if (walk.detail) setDetails({ [walk.detail.term_id]: walk.detail });
        setSelectedKey(startKey);
        setFocusedKey(firstKey);
        if (firstKey) setReveal({ key: firstKey, focus: focusOnOpen });
      })
      .catch((reason) => setError(messageOf(reason)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadNode = async (key: string, options: { expand?: boolean; viaParentId?: string }) => {
    if (!browseId) return null;
    setError(null);
    setLoadingKeys((current) => new Set(current).add(key));
    try {
      const node = await api.loadTreeNode({
        workspace_key: workspaceKey,
        annotation_id: annotationId,
        layer_id: layerId,
        browse_id: browseId,
        term_id: termOfKey(key),
        expand: options.expand ?? false,
        via_parent_id: options.viaParentId ?? null,
      });
      setDetails((current) => ({ ...current, [node.detail.term_id]: node.detail }));
      return node;
    } catch (reason) {
      setError(messageOf(reason));
      return null;
    } finally {
      setLoadingKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const select = (key: string) => {
    setSelectedKey(key);
    setFocusedKey(key);
    if (!details[termOfKey(key)]) void loadNode(key, {});
  };

  const expand = async (key: string) => {
    const termId = termOfKey(key);
    if (data.children[termId] === undefined) {
      const node = await loadNode(key, { expand: true });
      if (!node) return;
      setData((current) => withLevels(current, [{ term_id: termId, children: node.children }]));
    }
    setExpanded((current) => new Set(current).add(key));
  };

  const collapse = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    // The focused row may be inside the branch that just closed.
    if (focusedKey && focusedKey.startsWith(`${key}/`)) setFocusedKey(key);
  };

  /** "Also under": open the path through another parent of the selected term and go there. */
  const showUnder = async (parentId: string) => {
    if (!selectedKey) return;
    const node = await loadNode(selectedKey, { viaParentId: parentId });
    if (!node || node.path.length === 0) return;
    const keys = keysAlong(node.path);
    const target = keys[keys.length - 1];
    setData((current) => withLevels(current, node.levels));
    setExpanded((current) => new Set([...current, ...keys.slice(0, -1)]));
    setSelectedKey(target);
    setFocusedKey(target);
    setReveal({ key: target, focus: true });
  };

  const rows = useMemo(() => visibleRows(data, expanded), [data, expanded]);
  const selectedTermId = selectedKey ? termOfKey(selectedKey) : null;
  const detail = selectedTermId ? details[selectedTermId] ?? null : null;
  const selectedParentKey = selectedKey ? parentKeyOf(selectedKey) : null;
  const pathParentId = selectedParentKey ? termOfKey(selectedParentKey) : null;
  const otherParents = (detail?.parents ?? []).filter((parent) => parent.term_id !== pathParentId);
  const isCurrent = selectedTermId !== null && selectedTermId === currentTermId;
  const canUse = canAssign && browseId !== null && selectedTermId !== null && !isCurrent && !saving;

  const assignTerm = async () => {
    if (!canUse || !selectedTermId || !browseId) return;
    setSaving(true);
    setError(null);
    try {
      await onUseTerm(selectedTermId, browseId);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setSaving(false);
    }
  };

  // Dialog only: Tab wraps around inside.
  const trapTab = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!isDialog || event.key !== "Tab") return;
    const section = sectionRef.current;
    if (!section) return;
    const stops = Array.from(section.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]'));
    if (stops.length === 0) {
      event.preventDefault();
      section.focus();
      return;
    }
    const first = stops[0];
    const last = stops[stops.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === section)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const hint = !canAssign
    ? "Select one of your annotations to assign a term from the tree."
    : isCurrent
      ? "This is the annotation's current term."
      : null;

  return (
    <div className={`tree-host tree-host--${variant}`}>
      <section
        ref={sectionRef}
        className="tree-browser"
        role={isDialog ? "dialog" : "region"}
        aria-modal={isDialog ? true : undefined}
        aria-label="Ontology tree"
        tabIndex={-1}
        onKeyDown={trapTab}
      >
        <header className="tree-browser__header">
          <h2>Ontology tree</h2>
          {canPin && (
            <button
              type="button"
              className="btn btn-secondary btn-sm tree-pin"
              aria-pressed={pinned}
              onClick={onTogglePin}
              title={pinned ? "Close the side panel; the tree opens as a dialog again" : "Keep the tree open next to the text"}
            >
              Keep open
            </button>
          )}
          <button type="button" className="btn btn-secondary btn-sm" aria-label="Close tree" onClick={onClose}>
            ✕
          </button>
        </header>

        {startStatus && START_NOTICE[startStatus] && (
          <div className="tree-notice" role="status">
            {`${startTermId} ${START_NOTICE[startStatus]}. The tree starts at the top.`}
          </div>
        )}
        {error && (
          <div className="tree-error" role="alert">
            {error}
          </div>
        )}

        <div className="tree-browser__body">
          <div className="tree-browser__tree">
            {browseId === null ? (
              !error && <div className="tree-loading">Loading tree…</div>
            ) : (
              <TermTree
                rows={rows}
                focusedKey={focusedKey}
                selectedKey={selectedKey}
                currentTermId={currentTermId}
                loadingKeys={loadingKeys}
                reveal={reveal}
                label="Terms"
                onFocusKey={setFocusedKey}
                onExpand={(key) => {
                  void expand(key);
                }}
                onCollapse={collapse}
                onSelect={select}
                onClose={onClose}
              />
            )}
          </div>

          <div className="tree-detail">
            <div className="tree-detail__body">
              {detail ? (
                <>
                  <h3 className="tree-detail__name">{detail.label}</h3>
                  <div className="tree-detail__id">{detail.term_id}</div>
                  {detail.definition && <p className="tree-detail__definition">{detail.definition}</p>}
                  {detail.synonyms.length > 0 && (
                    <div className="tree-detail__group">
                      <h4>Synonyms</h4>
                      <ul>
                        {detail.synonyms.map((synonym) => (
                          <li key={synonym}>{synonym}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {Object.keys(detail.translations).length > 0 && (
                    <div className="tree-detail__group">
                      <h4>Translated names</h4>
                      <dl>
                        {Object.entries(detail.translations).map(([language, names]) => (
                          <React.Fragment key={language}>
                            <dt>{language}</dt>
                            <dd>{names.join("; ")}</dd>
                          </React.Fragment>
                        ))}
                      </dl>
                    </div>
                  )}
                  {otherParents.length > 0 && (
                    <div className="tree-detail__group">
                      <h4>Also under</h4>
                      <ul>
                        {otherParents.map((parent) => (
                          <li key={parent.term_id}>
                            <button
                              type="button"
                              className="tree-link"
                              onClick={() => {
                                void showUnder(parent.term_id);
                              }}
                            >
                              {parent.label}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <p className="tree-detail__empty">
                  {selectedKey ? "Loading…" : "Select a term in the tree to see its details."}
                </p>
              )}
            </div>
            <div className="tree-detail__actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canUse}
                onClick={() => {
                  void assignTerm();
                }}
              >
                Use this term
              </button>
              {hint && <span className="tree-detail__hint">{hint}</span>}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
```

- [ ] **Step 4: Add the styles**

Append to the end of `frontend/src/styles.css`:

```css

/* Ontology tree: the browser as a dialog (the docked panel follows further down) */
.tree-host--dialog {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
}

.tree-browser {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--bg-surface);
}

.tree-browser:focus {
  outline: none;
}

.tree-host--dialog .tree-browser {
  width: min(900px, 100vw);
  height: min(600px, 100vh);
  border-radius: var(--radius);
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.tree-browser__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-primary);
  flex-shrink: 0;
}

.tree-browser__header h2 {
  flex: 1;
  min-width: 0;
  font-size: 0.95rem;
  font-weight: 600;
}

.tree-pin[aria-pressed="true"] {
  background: var(--primary-light);
  border-color: var(--primary);
  color: var(--primary-hover);
}

.tree-notice,
.tree-error {
  flex-shrink: 0;
  padding: 6px 12px;
  font-size: 0.82rem;
  border-bottom: 1px solid var(--border-color);
}

.tree-notice {
  background: var(--warning-light);
}

.tree-error {
  background: var(--danger-light);
  color: var(--danger);
}

.tree-loading {
  padding: 12px;
  font-size: 0.85rem;
  color: var(--text-muted);
}

.tree-browser__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
}

.tree-browser__tree {
  flex: 1 1 55%;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  border-right: 1px solid var(--border-color);
}

.tree-detail {
  flex: 1 1 45%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.tree-detail__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}

.tree-detail__name {
  font-size: 1rem;
  font-weight: 700;
}

.tree-detail__id {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.tree-detail__definition,
.tree-detail__group {
  margin-bottom: 8px;
}

.tree-detail__group h4 {
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 2px;
}

.tree-detail__group ul {
  list-style: none;
}

.tree-detail__group dl {
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: 8px;
}

.tree-detail__group dt {
  font-family: var(--font-mono);
  color: var(--text-muted);
}

.tree-detail__empty {
  color: var(--text-muted);
}

.tree-link {
  border: 0;
  background: none;
  padding: 0;
  font: inherit;
  color: var(--primary);
  text-decoration: underline;
  cursor: pointer;
  text-align: left;
}

.tree-link:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

/* The button stays visible while the details above it scroll. */
.tree-detail__actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-top: 1px solid var(--border-color);
}

.tree-detail__hint {
  font-size: 0.78rem;
  color: var(--text-muted);
}

/* Small screens: the dialog fills the screen, tree above details. */
@media (max-width: 700px) {
  .tree-host--dialog .tree-browser {
    width: 100vw;
    height: 100vh;
    border-radius: 0;
  }
  .tree-host--dialog .tree-browser__body {
    flex-direction: column;
  }
  .tree-host--dialog .tree-browser__tree {
    border-right: 0;
    border-bottom: 1px solid var(--border-color);
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (in `frontend/`): `npx vitest run tests/treeBrowser.test.tsx && npm run typecheck && npm test`
Expected: 18 tests pass in the new file (17 `it`, one of them run for two cases), no type errors, the whole suite passes.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/editor/TreeBrowser.tsx frontend/src/styles.css frontend/tests/treeBrowser.test.tsx
git commit -m "feat(frontend): add the tree browser with details, as dialog and as panel"
```

---

### Task 10: Frontend — "Show in tree" and "Use this term"

How a search selection becomes a `set_term` today: `SearchPanel` calls `onSelectCandidate(candidate, searchId)`; `AnnotationPanel.handleSelectCandidate` passes it on as `onUpdateTerm(termId, searchId)`; `CaseScreen.handleUpdateTerm` runs `mutateAnnotationAndSyncDecision(annotationId, () => enqueueMutation({ command: "set_term", …, search_event_id }))`. `enqueueMutation` is the mutation queue (`autosave.ts`); `mutateAnnotationAndSyncDecision` then calls `syncReplacementDecision`, which is the review post-processing the spec refers to (an adopted copy that now differs from its proposal is recorded as "changed"; an explicit decision is left alone).

The tree takes exactly that path. The body of `handleUpdateTerm` becomes `setTermOf(annotationId, termId, searchId)`, and both the search and the tree call it.

`AnnotationPanel` is rendered only for an annotation of the draft: reference annotations and proposals have their own panes in `CaseScreen`. A button inside `AnnotationPanel` is therefore at own annotations only, which is what the spec asks for. The test below pins that.

This task shows the tree as a dialog only. Task 11 adds the pinned panel.

**Files:**
- Modify: `frontend/src/editor/AnnotationPanel.tsx`
- Modify: `frontend/src/app/CaseScreen.tsx`
- Modify: `frontend/src/styles.css`
- Test: `frontend/tests/caseTree.test.tsx` (create)

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/caseTree.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ValidationError } from "../src/api/client";
import { CaseScreen, type WorkspaceView } from "../src/app/CaseScreen";

const key = {
  package_id: "pkg",
  document_id: "doc",
  annotator_id: "dr-a",
  mode: "independent" as const,
  scope_id: "scope-default",
  target_set_id: "empty",
};
const scope = {
  scope_id: "scope-default",
  mode: "independent" as const,
  editable_layer_ids: ["phenotype"],
  reference_layer_ids: [],
};
const layers = [{
  layer_id: "phenotype",
  label: "Phenotype",
  ontology_id: "hp",
  access: "editable" as const,
  default_visible: true,
  default_type_id: "default",
  annotation_types: [{
    type_id: "default",
    label: "Phenotype",
    evidence_policy: "optional" as const,
    axes: [{ id: "assertion", label: "Assertion", options: ["present", "absent", "uncertain"], allow_empty: true }],
  }],
}];

/** A snapshot, usable as a draft annotation, a proposal or a reference. */
const snapshot = (annotationId: string, termId: string, sourceRefs?: string[]) => ({
  schema_version: "ontocurator-annotation/v3" as const,
  annotation: {
    annotation_id: annotationId,
    document_id: "doc",
    layer_id: "phenotype",
    type_id: "default",
    term_id: termId,
    axes_values: { assertion: "present" },
    evidence_refs: [{ evidence_id: `ev-${annotationId}`, version: "ev-v" }],
    provenance: { actor: { actor_id: "dr-a", kind: "human" as const }, method: "manual", source_refs: sourceRefs },
  },
  evidence: [{
    mention: { evidence_id: `ev-${annotationId}`, segments: [{ start: 0, end: 5 }], cue_segments: [] },
    version: "ev-v", document_id: "doc", text_sha256: "text",
  }],
  version: `${annotationId}-v1`,
  document_id: "doc",
  text_sha256: "text",
  ontology_sha256: "ontology",
  layer_config_sha256: "layer-sha",
});

const baseView = (annotations: any[] = []): WorkspaceView => ({
  key,
  scope,
  layers,
  ontologies: [{ ontology_id: "hp", release: "r", label: "HPO", sha256: "s", format: "obo-graph-json" as const }],
  checked_layer_ids: [],
  document: { document_id: "doc", text: "alpha beta gamma", language: "en", text_sha256: "text" },
  targets: { target_set_id: "empty", targets: [] },
  available_inputs: [],
  submissions: [],
  term_statuses: {},
  axes_definition: "editor-axes/v1",
  axes_config: [{ id: "assertion", label: "Assertion", options: ["present", "absent", "uncertain"], allow_empty: true }],
  axes_config_sha256: "sha-axes",
  draft: {
    key,
    targets: { target_set_id: "empty", targets: [] },
    revision: 0,
    annotations,
    evidence: annotations.flatMap((a) => a.evidence),
    decisions: [],
    checked_layer_ids: [],
  },
} as WorkspaceView);

/** Review view: `prop` (HP:P) is a proposal to decide, `ref` (HP:F) a reference, `annotations` the draft. */
const reviewView = (annotations: any[], decisions: any[] = []): WorkspaceView => {
  const view = baseView(annotations);
  const reviewKey = { ...key, mode: "review" as const, target_set_id: "targets" };
  const targets = { target_set_id: "targets", targets: [{ annotation_id: "prop", version: "prop-v1" }] };
  return {
    ...view,
    key: reviewKey,
    scope: { ...scope, mode: "review" as const },
    targets,
    available_inputs: [snapshot("prop", "HP:P"), snapshot("ref", "HP:F")],
    draft: { ...view.draft, key: reviewKey, targets, decisions },
  } as WorkspaceView;
};

/**
 * A tree for any start term: Root > (the start term, "Beta term" HP:B). Every walk gets its own id.
 */
const mockTree = () => {
  let walks = 0;
  const labelOf = (termId: string) => (termId === "HP:B" ? "Beta term" : `Term ${termId}`);
  const root = { term_id: "HP:R", label: "Root", child_count: 2 };
  const detailOf = (termId: string) => ({
    term_id: termId,
    label: labelOf(termId),
    definition: "",
    synonyms: [],
    translations: {},
    parents: [root],
  });
  const open = vi.spyOn(api, "openTree").mockImplementation(async (req) => {
    walks += 1;
    return {
      browse_id: `walk-${walks}`,
      start_status: "valid" as const,
      roots: [root],
      path: ["HP:R", req.term_id],
      levels: [
        {
          term_id: "HP:R",
          children: [
            { term_id: req.term_id, label: labelOf(req.term_id), child_count: 0 },
            { term_id: "HP:B", label: "Beta term", child_count: 0 },
          ],
        },
        { term_id: req.term_id, children: [] },
      ],
      detail: detailOf(req.term_id),
    };
  });
  const node = vi.spyOn(api, "loadTreeNode").mockImplementation(async (req) => ({
    detail: detailOf(req.term_id),
    children: [],
    path: [],
    levels: [],
  }));
  return { open, node };
};

/** A server that applies set_term (new version "<id>-v2") and counts decisions. */
const mockServer = (view: WorkspaceView) => {
  let current = view.draft;
  const apply = vi.spyOn(api, "applyCommand").mockImplementation(async (_workspaceId, envelope) => {
    const command: any = envelope.payload;
    current = {
      ...current,
      revision: current.revision + 1,
      annotations: (current.annotations ?? []).map((a) =>
        command.command === "set_term" && a.annotation.annotation_id === command.annotation_id
          ? { ...a, version: `${command.annotation_id}-v2`, annotation: { ...a.annotation, term_id: command.term_id } }
          : a,
      ),
    };
    return current;
  });
  const decide = vi.spyOn(api, "recordDecision").mockImplementation(async () => {
    current = { ...current, revision: current.revision + 1 };
    return current;
  });
  return { apply, decide };
};

const entry = (container: HTMLElement, annotationId: string) =>
  container.querySelector<HTMLElement>(`[data-list-key="annotation:${annotationId}"]`)!;
const showInTree = () => screen.queryByRole("button", { name: "Show in tree" });
const rowOf = (scopeEl: HTMLElement, label: string) =>
  within(scopeEl).getByText(label, { selector: ".tree-label" }).closest('[role="treeitem"]') as HTMLElement;
const useButton = (scopeEl: HTMLElement) =>
  within(scopeEl).getByRole("button", { name: "Use this term" }) as HTMLButtonElement;

/** Select the draft annotation and open its tree as a dialog. */
const openDialog = async (container: HTMLElement, annotationId: string) => {
  fireEvent.click(entry(container, annotationId));
  fireEvent.click(screen.getByRole("button", { name: "Show in tree" }));
  const dialog = await screen.findByRole("dialog", { name: "Ontology tree" });
  await within(dialog).findByText("Beta term", { selector: ".tree-label" });
  return dialog;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as any).matchMedia;
});

describe("the tree in the case screen", () => {
  it("is offered at an own annotation with a term and nowhere else", () => {
    const { container } = render(
      <CaseScreen view={reviewView([snapshot("a1", "HP:A")])} workspaceId="ws" onClose={vi.fn()} />,
    );

    expect(showInTree()).toBeNull();

    fireEvent.click(container.querySelector<HTMLElement>('[data-list-key^="target:"]')!);
    expect(screen.getByText(/Review decision for this proposal/i)).toBeDefined();
    expect(showInTree()).toBeNull();

    fireEvent.click(container.querySelector<HTMLElement>('[data-list-key^="source:"]')!);
    expect(screen.getByLabelText("Reference details")).toBeDefined();
    expect(showInTree()).toBeNull();

    fireEvent.click(entry(container, "a1"));
    expect(showInTree()).not.toBeNull();

    // While the term of a new annotation is still being chosen there is nothing to show.
    fireEvent.click(screen.getByRole("button", { name: /\+ New Annotation/ }));
    expect(showInTree()).toBeNull();
  });

  it("opens the tree at the annotation's term, as a dialog", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    const { open } = mockTree();
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);

    const dialog = await openDialog(container, "a1");

    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toEqual({
      workspace_key: view.key,
      annotation_id: "a1",
      layer_id: "phenotype",
      term_id: "HP:A",
    });
    expect(rowOf(dialog, "Term HP:A").getAttribute("aria-selected")).toBe("true");
    expect(rowOf(dialog, "Term HP:A").getAttribute("aria-current")).toBe("true");
    expect(useButton(dialog).disabled).toBe(true);
    expect(container.querySelector(".app-layout")!.classList.contains("tree-pinned")).toBe(false);
  });

  it("'Use this term' sends set_term bound to the walk, closes the dialog and keeps the annotation selected", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    mockTree();
    const { apply, decide } = mockServer(view);
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    const dialog = await openDialog(container, "a1");

    fireEvent.click(rowOf(dialog, "Beta term"));
    // Selecting a node assigns nothing.
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(useButton(dialog));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Ontology tree" })).toBeNull());
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][1].payload).toEqual({
      command: "set_term",
      annotation_id: "a1",
      term_id: "HP:B",
      search_event_id: "walk-1",
    });
    expect(decide).not.toHaveBeenCalled();
    expect(entry(container, "a1").classList.contains("selected")).toBe(true);
    expect(entry(container, "a1").textContent).toContain("HP:B");
    expect(showInTree()).not.toBeNull();
  });

  it("keeps the dialog open and says why when the server refuses the term", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    mockTree();
    // A 422 as the server sends it. (Any other error would count as "server unreachable":
    // the mutation queue then keeps the edit pending instead of rejecting it.)
    vi.spyOn(api, "applyCommand").mockRejectedValue(
      new ValidationError("Search selection does not match", "INVALID_SEARCH_SELECTION"),
    );
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    const dialog = await openDialog(container, "a1");

    fireEvent.click(rowOf(dialog, "Beta term"));
    fireEvent.click(useButton(dialog));

    expect((await within(dialog).findByRole("alert")).textContent).toBe("Search selection does not match");
    expect(screen.getByRole("dialog", { name: "Ontology tree" })).toBe(dialog);
    expect(entry(container, "a1").textContent).toContain("HP:A");
  });

  it("Escape closes the dialog and leaves the selection; a second Escape clears it as before", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    mockTree();
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    await openDialog(container, "a1");

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Ontology tree" })).toBeNull();
    expect(entry(container, "a1").classList.contains("selected")).toBe(true);

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(entry(container, "a1").classList.contains("selected")).toBe(false);
  });

  it("in review, a term from the tree makes the adopted proposal count as changed", async () => {
    const view = reviewView([snapshot("copy", "HP:P", ["prop:prop-v1"])]);
    mockTree();
    const { apply, decide } = mockServer(view);
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    const dialog = await openDialog(container, "copy");

    fireEvent.click(rowOf(dialog, "Beta term"));
    fireEvent.click(useButton(dialog));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Ontology tree" })).toBeNull());
    expect(apply.mock.calls[0][1].payload).toEqual({
      command: "set_term",
      annotation_id: "copy",
      term_id: "HP:B",
      search_event_id: "walk-1",
    });
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide.mock.calls[0][1].payload).toMatchObject({
      target: { annotation_id: "prop", version: "prop-v1" },
      outcome: "changed",
      replacement: { annotation_id: "copy", version: "copy-v2" },
    });
  });

  it("in review, an explicit rejection of the proposal stays", async () => {
    const rejected = {
      decision_id: "d1",
      target: { annotation_id: "prop", version: "prop-v1" },
      outcome: "rejected",
      reviewer_id: "dr-a",
    };
    const view = reviewView([snapshot("copy", "HP:P", ["prop:prop-v1"])], [rejected]);
    mockTree();
    const { apply, decide } = mockServer(view);
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    const dialog = await openDialog(container, "copy");

    fireEvent.click(rowOf(dialog, "Beta term"));
    fireEvent.click(useButton(dialog));

    // The dialog closes only after set_term and its post-processing are through.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Ontology tree" })).toBeNull());
    expect(apply).toHaveBeenCalledTimes(1);
    expect(decide).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (in `frontend/`): `npx vitest run tests/caseTree.test.tsx`
Expected: the first test fails at `expect(showInTree()).not.toBeNull()`; the others fail with `Unable to find an accessible element with the role "button" and name "Show in tree"`.

- [ ] **Step 3: Add the button to `AnnotationPanel`**

In `frontend/src/editor/AnnotationPanel.tsx`:

In `interface AnnotationPanelProps`, after the line `  onDeselect?: () => void;`, add

```tsx
  /** Open the ontology tree at this annotation's term. */
  onShowInTree?: () => void;
```

In the parameter list of the component, after the line `  onDeselect,`, add

```tsx
  onShowInTree,
```

Replace

```tsx
            <h2 style={{ fontSize: "1.1rem", fontWeight: 700, margin: "2px 0 4px" }}>
              <TermName termId={currentTerm} label={termLabel} />
            </h2>
```

with

```tsx
            <h2 style={{ fontSize: "1.1rem", fontWeight: 700, margin: "2px 0 4px" }}>
              <TermName termId={currentTerm} label={termLabel} />
            </h2>
            {onShowInTree && currentTerm && (
              <button
                type="button"
                className="btn btn-secondary btn-sm annotation-tree-button"
                onClick={onShowInTree}
                title="Show this term in the ontology tree: broader and narrower terms"
              >
                Show in tree
              </button>
            )}
```

- [ ] **Step 4: Wire the tree into `CaseScreen`**

In `frontend/src/app/CaseScreen.tsx`:

After the line `import { TextPane } from "../editor/TextPane";`, add

```tsx
import { TreeBrowser } from "../editor/TreeBrowser";
```

After the line `  const [mobilePane, setMobilePane] = useState<"list" | "text" | "details">("text");`, add

```tsx
  // The ontology tree. One entry is one walk; a new nonce starts a new one.
  const [treeWalk, setTreeWalk] = useState<{
    nonce: number;
    annotationId: string;
    layerId: string;
    termId: string;
    /** Whether to move the keyboard focus into the tree when it has loaded. */
    focus: boolean;
  } | null>(null);
  const treeNonce = useRef(0);
```

Replace the whole function

```tsx
  const handleUpdateTerm = async (termId: string, searchId?: string) => {
    if (!selectedAnnotationId) return;
    const annId = selectedAnnotationId;
    await mutateAnnotationAndSyncDecision(annId, () =>
      enqueueMutation({
        command: "set_term",
        annotation_id: annId,
        term_id: termId,
        search_event_id: searchId,
      })
    );
  };
```

with

```tsx
  // One path for every term change, from the search and from the tree: through the
  // mutation queue, then the review post-processing.
  const setTermOf = (annotationId: string, termId: string, searchId?: string) =>
    mutateAnnotationAndSyncDecision(annotationId, () =>
      enqueueMutation({
        command: "set_term",
        annotation_id: annotationId,
        term_id: termId,
        search_event_id: searchId,
      })
    );

  const handleUpdateTerm = async (termId: string, searchId?: string) => {
    if (!selectedAnnotationId) return;
    await setTermOf(selectedAnnotationId, termId, searchId);
  };

  // --- Ontology tree -----------------------------------------------------------
  // The annotation the inspector shows as editable right now (same precedence as the pane itself).
  const treeAnnotation =
    !selectedSource && !pendingAnnotation && !(view.key.mode === "review" && selectedTarget)
      ? selectedAnnotation
      : null;
  // Docked as a side panel instead of shown as a dialog.
  const treeDocked: boolean = false;
  // The annotation the open walk belongs to, as it is in the draft now.
  const treeWalkAnnotation = treeWalk
    ? (draft.annotations ?? []).find((a) => a.annotation.annotation_id === treeWalk.annotationId) ?? null
    : null;

  const startTreeWalk = (annotation: AnnotationSnapshot, focus: boolean) => {
    treeNonce.current += 1;
    setTreeWalk({
      nonce: treeNonce.current,
      annotationId: annotation.annotation.annotation_id,
      layerId: annotation.annotation.layer_id,
      termId: annotation.annotation.term_id,
      focus,
    });
  };

  const handleShowInTree = () => {
    if (!treeAnnotation || !treeAnnotation.annotation.term_id) return;
    startTreeWalk(treeAnnotation, true);
  };

  // "Use this term": the same set_term as a search selection, bound to the walk's event.
  // A failure is thrown to the tree, which shows it (the page's own error line is behind the dialog).
  const handleUseTreeTerm = async (termId: string, browseId: string) => {
    if (!treeWalk) return;
    await setTermOf(treeWalk.annotationId, termId, browseId);
    if (!treeDocked) setTreeWalk(null);
  };
```

Replace

```tsx
  const modalOpen = !!(confirmRequest || completedSubmission || historySubmission || submitDialogOpen || showShortcutHelp);
```

with

```tsx
  const modalOpen = !!(confirmRequest || completedSubmission || historySubmission || submitDialogOpen || showShortcutHelp)
    || (!!treeWalk && !treeDocked);
```

In the JSX of `<AnnotationPanel …>`, directly above the line `              onSelectEvidence={(evId) => setSelectedEvidenceId(evId)}`, add

```tsx
              onShowInTree={handleShowInTree}
```

Replace

```tsx
        </div>
      </div>

      {historySubmission && <div className="modal-overlay">
```

with

```tsx
        </div>

        {/* Ontology tree: always at this place in the layout, so that pinning does not restart the walk. */}
        {treeWalk && (
          <TreeBrowser
            key={treeWalk.nonce}
            variant={treeDocked ? "panel" : "dialog"}
            workspaceKey={view.key}
            annotationId={treeWalk.annotationId}
            layerId={treeWalk.layerId}
            startTermId={treeWalk.termId}
            currentTermId={treeWalkAnnotation?.annotation.term_id ?? null}
            canAssign={!!treeAnnotation && treeAnnotation.annotation.annotation_id === treeWalk.annotationId}
            focusOnOpen={treeWalk.focus}
            pinned={false}
            canPin={false}
            onTogglePin={() => undefined}
            onClose={() => setTreeWalk(null)}
            onUseTerm={handleUseTreeTerm}
          />
        )}
      </div>

      {historySubmission && <div className="modal-overlay">
```

(The first `</div>` closes `.inspector-pane`, the second `.app-layout`. As a dialog the tree is `position: fixed`, so it does not take part in the layout it sits in.)

- [ ] **Step 5: Add the style of the button**

Append to the end of `frontend/src/styles.css`:

```css

/* "Show in tree", under the term name of an annotation */
.annotation-tree-button {
  margin-top: 2px;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run (in `frontend/`): `npx vitest run tests/caseTree.test.tsx && npm run typecheck && npm test`
Expected: 7 tests pass in the new file, no type errors, the whole suite passes — in particular `"uses the search event when assigning a candidate and trusts obsolete metadata"` in `tests/workflow-regressions.test.tsx`, which pins the payload of the search path that was just refactored.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/editor/AnnotationPanel.tsx frontend/src/app/CaseScreen.tsx frontend/src/styles.css frontend/tests/caseTree.test.tsx
git commit -m "feat(frontend): open the tree at an annotation and assign a term from it"
```

---

### Task 11: Frontend — keep the tree open as a side panel

**Layout (the decision this plan had to take).** The case screen is three columns: sidebar 320 px, text (flexible), inspector 380 px. At 1280 px the text has 580 px. The spec puts the pinned tree "at the right edge of the work area" and requires the text to stay usable, from 1100 px up. A fourth column of 380 px would leave the text 200 px at 1280 and 20 px at 1100, so that reading of the spec cannot be met.

What this plan does instead:

- **1100–1599 px:** the tree takes the lower three fifths of the right column, under the annotation panel. Text and sidebar keep their full size. At 1280×720 the annotation panel has about 260 px and the tree about 400 px of height; both scroll.
- **From 1600 px:** the tree is a fourth column of 380 px at the far right, full height, as the spec words it. The text then has at least 520 px.
- **Below 1100 px:** no pin switch; a pinned preference is kept but the tree shows as a dialog.

It is done in CSS alone: when docked, `.app-layout` becomes a grid and the tree is one more child of it. The DOM is the same in every case, so nothing restarts when the window is resized across a threshold.

**Behaviour.**

- The pin switch in a dialog turns that dialog into the panel (same walk). In the panel it closes the panel ("Der Bereich schließt … durch Lösen des Pins"); the next "Show in tree" then opens a dialog.
- A pinned tree follows the selection: another own annotation with a term starts a new walk at that term, without moving the keyboard focus. A proposal, a reference, an annotation being created, or nothing selected leaves the tree as it is with "Use this term" disabled.
- The preference is per annotator. `App` already loads the preferences, so it hands the value to `CaseScreen` and saves a change; `CaseScreen` makes no request of its own.

**Files:**
- Create: `frontend/src/editor/useMinWidth.ts`
- Modify: `frontend/src/app/CaseScreen.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/styles.css`
- Test: `frontend/tests/caseTree.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `frontend/tests/caseTree.test.tsx`, add `import { App } from "../src/App";` below the line `import { api, ValidationError } from "../src/api/client";`.

Append to the file:

```tsx
/** Select the draft annotation and open its tree as the docked panel. */
const openPanel = async (container: HTMLElement, annotationId: string) => {
  fireEvent.click(entry(container, annotationId));
  fireEvent.click(screen.getByRole("button", { name: "Show in tree" }));
  const panel = await screen.findByRole("region", { name: "Ontology tree" });
  await within(panel).findByText("Beta term", { selector: ".tree-label" });
  return panel;
};
const panelNow = () => screen.getByRole("region", { name: "Ontology tree" });
const pinSwitch = () => screen.getByRole("button", { name: "Keep open" });

describe("the pinned tree", () => {
  it("pinning turns the dialog into a side panel without starting over, and reports the choice", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    const { open } = mockTree();
    const onTreePinnedChange = vi.fn();
    const { container } = render(
      <CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} onTreePinnedChange={onTreePinnedChange} />,
    );
    const dialog = await openDialog(container, "a1");
    fireEvent.click(rowOf(dialog, "Beta term"));
    expect(pinSwitch().getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(pinSwitch());

    const panel = panelNow();
    expect(screen.queryByRole("dialog", { name: "Ontology tree" })).toBeNull();
    expect(onTreePinnedChange).toHaveBeenCalledTimes(1);
    expect(onTreePinnedChange).toHaveBeenCalledWith(true);
    expect(pinSwitch().getAttribute("aria-pressed")).toBe("true");
    // The same walk: no second request, the selection made in the dialog is still there.
    expect(open).toHaveBeenCalledTimes(1);
    expect(rowOf(panel, "Beta term").getAttribute("aria-selected")).toBe("true");
    // Docked into the layout, after the inspector.
    const layout = container.querySelector(".app-layout")!;
    expect(layout.classList.contains("tree-pinned")).toBe(true);
    expect(panel.parentElement!.parentElement).toBe(layout);
    expect(layout.lastElementChild).toBe(panel.parentElement);
  });

  it("opens as the side panel right away when the annotator has pinned it", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    mockTree();
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} treePinned />);

    // Never by itself: selecting an annotation is not asking for the tree.
    fireEvent.click(entry(container, "a1"));
    expect(screen.queryByRole("region", { name: "Ontology tree" })).toBeNull();
    fireEvent.click(entry(container, "a1")); // deselect again

    const panel = await openPanel(container, "a1");
    expect(screen.queryByRole("dialog", { name: "Ontology tree" })).toBeNull();
    expect(pinSwitch().getAttribute("aria-pressed")).toBe("true");
    expect(panel.contains(document.activeElement)).toBe(true);
  });

  it("stays open after 'Use this term' and marks the new term as the current one", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    const { open } = mockTree();
    const { apply } = mockServer(view);
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} treePinned />);
    const panel = await openPanel(container, "a1");

    fireEvent.click(rowOf(panel, "Beta term"));
    fireEvent.click(useButton(panel));

    await waitFor(() => expect(rowOf(panel, "Beta term").getAttribute("aria-current")).toBe("true"));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][1].payload).toEqual({
      command: "set_term",
      annotation_id: "a1",
      term_id: "HP:B",
      search_event_id: "walk-1",
    });
    expect(panelNow()).toBe(panel);
    expect(rowOf(panel, "Term HP:A").hasAttribute("aria-current")).toBe(false);
    await waitFor(() => expect(within(panel).getByText("This is the annotation's current term.")).toBeDefined());
    expect(useButton(panel).disabled).toBe(true);
    // Still the same walk.
    expect(open).toHaveBeenCalledTimes(1);

    // A second change from the same walk carries the same id.
    fireEvent.click(rowOf(panel, "Term HP:A"));
    await waitFor(() => expect(useButton(panel).disabled).toBe(false));
    fireEvent.click(useButton(panel));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
    expect(apply.mock.calls[1][1].payload).toMatchObject({ term_id: "HP:A", search_event_id: "walk-1" });
  });

  it("jumps to another own annotation with a term, and stays put for anything else", async () => {
    const view = reviewView([snapshot("a1", "HP:A"), snapshot("a2", "HP:C")]);
    const { open } = mockTree();
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} treePinned />);
    await openPanel(container, "a1");
    expect(open.mock.calls[0][0]).toMatchObject({ annotation_id: "a1", term_id: "HP:A" });

    // Another own annotation: a new walk at its term.
    fireEvent.click(entry(container, "a2"));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    expect(open.mock.calls[1][0]).toEqual({
      workspace_key: view.key,
      annotation_id: "a2",
      layer_id: "phenotype",
      term_id: "HP:C",
    });
    await within(panelNow()).findByText("Term HP:C", { selector: ".tree-label" });
    expect(rowOf(panelNow(), "Term HP:C").getAttribute("aria-selected")).toBe("true");
    // The jump does not take the keyboard focus away from where the annotator is working.
    expect(panelNow().contains(document.activeElement)).toBe(false);

    // A proposal: the tree stays where it is and assigns nothing.
    fireEvent.click(rowOf(panelNow(), "Beta term"));
    expect(useButton(panelNow()).disabled).toBe(false);
    fireEvent.click(container.querySelector<HTMLElement>('[data-list-key^="target:"]')!);
    expect(screen.getByText(/Review decision for this proposal/i)).toBeDefined();
    expect(rowOf(panelNow(), "Term HP:C")).toBeDefined();
    expect(useButton(panelNow()).disabled).toBe(true);
    expect(within(panelNow()).getByText("Select one of your annotations to assign a term from the tree.")).toBeDefined();

    // A reference, then nothing at all: the same.
    fireEvent.click(container.querySelector<HTMLElement>('[data-list-key^="source:"]')!);
    expect(useButton(panelNow()).disabled).toBe(true);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(container.querySelector(".doc-item.selected")).toBeNull();
    expect(rowOf(panelNow(), "Term HP:C")).toBeDefined();
    expect(useButton(panelNow()).disabled).toBe(true);
    expect(open).toHaveBeenCalledTimes(2);

    // Back on the annotation the tree is showing: no new walk, and it can assign again.
    fireEvent.click(entry(container, "a2"));
    expect(useButton(panelNow()).disabled).toBe(false);
    expect(open).toHaveBeenCalledTimes(2);

    // The first annotation again: that is another annotation, so a third walk.
    fireEvent.click(entry(container, "a1"));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(3));
    expect(open.mock.calls[2][0]).toMatchObject({ annotation_id: "a1", term_id: "HP:A" });
  });

  it("closes by releasing the pin, and the next time opens as a dialog", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    const { open } = mockTree();
    const onTreePinnedChange = vi.fn();
    const { container } = render(
      <CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} treePinned onTreePinnedChange={onTreePinnedChange} />,
    );
    await openPanel(container, "a1");

    fireEvent.click(pinSwitch());

    expect(onTreePinnedChange).toHaveBeenCalledTimes(1);
    expect(onTreePinnedChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("region", { name: "Ontology tree" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Ontology tree" })).toBeNull();
    expect(container.querySelector(".app-layout")!.classList.contains("tree-pinned")).toBe(false);
    expect(entry(container, "a1").classList.contains("selected")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Show in tree" }));
    expect(await screen.findByRole("dialog", { name: "Ontology tree" })).toBeDefined();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("closes with its close button or with Escape inside the tree, and does not come back by itself", async () => {
    const view = baseView([snapshot("a1", "HP:A"), snapshot("a2", "HP:C")]);
    const { open } = mockTree();
    const onTreePinnedChange = vi.fn();
    const { container } = render(
      <CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} treePinned onTreePinnedChange={onTreePinnedChange} />,
    );
    const panel = await openPanel(container, "a1");
    const row = rowOf(panel, "Term HP:A");
    expect(document.activeElement).toBe(row);

    fireEvent.keyDown(row, { key: "Escape" });

    expect(screen.queryByRole("region", { name: "Ontology tree" })).toBeNull();
    // Escape closed the tree only: the annotation is still selected, the pin is still set.
    expect(entry(container, "a1").classList.contains("selected")).toBe(true);
    expect(onTreePinnedChange).not.toHaveBeenCalled();

    // Selecting another annotation does not bring the tree back.
    fireEvent.click(entry(container, "a2"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("region", { name: "Ontology tree" })).toBeNull();
    expect(open).toHaveBeenCalledTimes(1);

    // Asked for again, it is the panel again; its close button closes it.
    fireEvent.click(screen.getByRole("button", { name: "Show in tree" }));
    await screen.findByRole("region", { name: "Ontology tree" });
    fireEvent.click(screen.getByRole("button", { name: "Close tree" }));
    expect(screen.queryByRole("region", { name: "Ontology tree" })).toBeNull();
    expect(onTreePinnedChange).not.toHaveBeenCalled();
  });

  it("below 1100 px a pinned tree is a dialog without a pin switch", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    const view = baseView([snapshot("a1", "HP:A")]);
    mockTree();
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} treePinned />);

    const dialog = await openDialog(container, "a1");

    expect(screen.queryByRole("region", { name: "Ontology tree" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Keep open" })).toBeNull();
    expect(container.querySelector(".app-layout")!.classList.contains("tree-pinned")).toBe(false);
  });

  it("the App hands the stored choice of this annotator to the case and saves a change", async () => {
    window.localStorage.clear();
    vi.spyOn(api, "getPreferences").mockResolvedValue({
      last_annotator_id: "dr-a",
      mode_by_package: {},
      tree_pinned_by_annotator: { "dr-a": true, "dr-b": false },
    });
    const save = vi.spyOn(api, "updatePreferences").mockResolvedValue({
      last_annotator_id: "dr-a",
      mode_by_package: {},
      tree_pinned_by_annotator: {},
    });
    vi.spyOn(api, "listPackages").mockResolvedValue([{ package_id: "pkg", ontology: { release: "test" } }] as any);
    vi.spyOn(api, "listDocuments").mockResolvedValue([
      { document_id: "doc", text_length: 10, language: "en", position: 1, status: "not_started" },
    ]);
    vi.spyOn(api, "openWorkspace").mockResolvedValue({
      workspace_id: "ws",
      view: baseView([snapshot("a1", "HP:A")]),
    });
    mockTree();
    const { container } = render(<App />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Open case/i }).hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: /Open case/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Yes, continue/i }));
    await waitFor(() => expect(entry(container, "a1")).not.toBeNull());

    // As after a reload: the stored choice makes "Show in tree" open the side panel.
    await openPanel(container, "a1");

    fireEvent.click(pinSwitch());
    expect(save).toHaveBeenCalledWith({ tree_pinned_by_annotator: { "dr-a": false } });
    expect(screen.queryByRole("region", { name: "Ontology tree" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (in `frontend/`): `npx vitest run tests/caseTree.test.tsx`
Expected: the seven tests of Task 10 pass; the eight new ones fail — there is no "Keep open" button (`canPin` is `false`), and with `treePinned` the tree still opens as a dialog. `npm run typecheck` reports that `CaseScreen` has no props `treePinned` and `onTreePinnedChange`.

- [ ] **Step 3: Add the media-query hook**

Create `frontend/src/editor/useMinWidth.ts`:

```ts
import { useEffect, useState } from "react";

const matches = (query: string): boolean =>
  // No matchMedia (jsdom): treat the screen as wide.
  typeof window === "undefined" || typeof window.matchMedia !== "function" ? true : window.matchMedia(query).matches;

/** Whether the viewport is at least `pixels` wide; follows window resizes. */
export function useMinWidth(pixels: number): boolean {
  const query = `(min-width: ${pixels}px)`;
  const [wide, setWide] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const update = () => setWide(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return wide;
}
```

- [ ] **Step 4: Dock the tree in `CaseScreen`**

In `frontend/src/app/CaseScreen.tsx`:

After the line `import { TreeBrowser } from "../editor/TreeBrowser";`, add

```tsx
import { useMinWidth } from "../editor/useMinWidth";
```

In `interface CaseScreenProps`, after the line `  onSubmitted?: () => void | Promise<void>;`, add

```tsx
  /** This annotator's stored choice: the ontology tree stays open as a side panel. */
  treePinned?: boolean;
  /** Called when the annotator pins or releases the tree, to store the choice. */
  onTreePinnedChange?: (pinned: boolean) => void;
```

In the parameter list of the component, after the line `  onSubmitted,`, add

```tsx
  treePinned = false,
  onTreePinnedChange,
```

After the line `  const treeNonce = useRef(0);` (added in Task 10), add

```tsx
  const [treePinnedNow, setTreePinnedNow] = useState(treePinned);
  // Below this width there is no room for a docked tree next to text and annotation panel.
  const wideEnoughToPin = useMinWidth(1100);
```

Replace

```tsx
  const treeDocked: boolean = false;
```

with

```tsx
  const treeDocked = !!treeWalk && treePinnedNow && wideEnoughToPin;
```

After the function `handleUseTreeTerm` (added in Task 10), add

```tsx

  // Pinning a dialog docks the same walk. Releasing the pin closes the panel.
  const handleToggleTreePin = () => {
    const next = !treePinnedNow;
    setTreePinnedNow(next);
    onTreePinnedChange?.(next);
    if (!next) setTreeWalk(null);
  };

  // A docked tree follows the selection: another own annotation with a term starts a new
  // walk there. Anything else (a proposal, a reference, nothing) leaves the tree as it is.
  const followAnnotationId = treeAnnotation?.annotation.term_id ? treeAnnotation.annotation.annotation_id : null;
  useEffect(() => {
    if (!treeDocked || !treeWalk || !treeAnnotation || !followAnnotationId) return;
    if (followAnnotationId === treeWalk.annotationId) return;
    startTreeWalk(treeAnnotation, false);
    // Only a change of the selected annotation moves the tree, not an edit of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followAnnotationId, treeDocked]);
```

Replace

```tsx
      <div className={`app-layout mobile-pane-${mobilePane}`}>
```

with

```tsx
      <div className={`app-layout mobile-pane-${mobilePane}${treeDocked ? " tree-pinned" : ""}`}>
```

In the JSX of `<TreeBrowser …>` (added in Task 10), replace

```tsx
            pinned={false}
            canPin={false}
            onTogglePin={() => undefined}
```

with

```tsx
            pinned={treePinnedNow}
            canPin={wideEnoughToPin}
            onTogglePin={handleToggleTreePin}
```

- [ ] **Step 5: Hand the preference through `App`**

In `frontend/src/App.tsx`:

After the line `  const [mode, setMode] = useState<WorkspaceMode>("independent");`, add

```tsx
  // Per annotator: whether the ontology tree stays open as a side panel.
  const [treePinnedByAnnotator, setTreePinnedByAnnotator] = useState<Record<string, boolean>>({});
```

In `loadPreferences`, after the line `      modeByPackageRef.current = modes;`, add

```tsx
      setTreePinnedByAnnotator(prefs?.tree_pinned_by_annotator ?? {});
```

In the JSX of `<CaseScreen …>`, after the line `            onClose={() => { void closeWorkspace(); }}`, add

```tsx
            treePinned={treePinnedByAnnotator[activeWorkspace.view.key.annotator_id] ?? false}
            onTreePinnedChange={(pinned) => {
              const annotator = activeWorkspace.view.key.annotator_id;
              setTreePinnedByAnnotator((current) => ({ ...current, [annotator]: pinned }));
              void api.updatePreferences({ tree_pinned_by_annotator: { [annotator]: pinned } }).catch(() => undefined);
            }}
```

(`CaseScreen` is remounted for every case, so it reads `treePinned` when a case opens. The choice therefore holds across cases, packages and restarts, and a failed save costs nothing but the persistence.)

- [ ] **Step 6: Add the docked layout**

Append to the end of `frontend/src/styles.css`:

```css

/* Ontology tree, pinned: docked into the case layout.
   1100-1599 px: under the annotation panel in the right column (the text keeps its width).
   From 1600 px: a fourth column at the far right. Below 1100 px the tree is never docked. */
.tree-host--panel {
  display: flex;
  min-width: 0;
  min-height: 0;
  background: var(--bg-surface);
  border-left: 1px solid var(--border-color);
  border-top: 1px solid var(--border-color);
}

.tree-host--panel .tree-browser {
  flex: 1;
}

.tree-host--panel .tree-browser__body {
  flex-direction: column;
}

.tree-host--panel .tree-browser__tree {
  border-right: 0;
  border-bottom: 1px solid var(--border-color);
}

@media (min-width: 1100px) {
  .app-layout.tree-pinned {
    display: grid;
    grid-template-columns: 320px minmax(0, 1fr) 380px;
    grid-template-rows: minmax(0, 2fr) minmax(0, 3fr);
  }
  .app-layout.tree-pinned > .sidebar {
    grid-column: 1;
    grid-row: 1 / 3;
    min-height: 0;
  }
  .app-layout.tree-pinned > .center-pane {
    grid-column: 2;
    grid-row: 1 / 3;
    min-width: 0;
    min-height: 0;
  }
  .app-layout.tree-pinned > .inspector-pane {
    grid-column: 3;
    grid-row: 1;
    min-height: 0;
  }
  .app-layout.tree-pinned > .tree-host--panel {
    grid-column: 3;
    grid-row: 2;
  }
}

@media (min-width: 1600px) {
  .app-layout.tree-pinned {
    grid-template-columns: 320px minmax(0, 1fr) 380px 380px;
    grid-template-rows: minmax(0, 1fr);
  }
  .app-layout.tree-pinned > .sidebar,
  .app-layout.tree-pinned > .center-pane,
  .app-layout.tree-pinned > .inspector-pane {
    grid-row: 1;
  }
  .app-layout.tree-pinned > .tree-host--panel {
    grid-column: 4;
    grid-row: 1;
    border-top: 0;
  }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run (in `frontend/`): `npx vitest run tests/caseTree.test.tsx && npm run typecheck && npm test`
Expected: 15 tests pass in `caseTree.test.tsx`, no type errors, the whole suite passes.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/editor/useMinWidth.ts frontend/src/app/CaseScreen.tsx frontend/src/App.tsx frontend/src/styles.css frontend/tests/caseTree.test.tsx
git commit -m "feat(frontend): keep the tree open as a side panel that follows the selection"
```

---

### Task 12: Browser test

jsdom has no layout, no scrolling and no Tab order. What depends on those is tested here, against the real backend (`tests/browser_server.py`, which loads `tests/fixtures/hp.json` and `mondo.json`). That fixture has no term with two parents, so "Also under" is **not** covered in a real browser; it is covered by the backend tests with the synthetic ontology and by the jsdom test of `TreeBrowser`.

The document of the browser fixture is `"Hypotonia and seizure. …"`: "Hypotonia" is at 0–9, "seizure" at 14–21.

**Files:**
- Create: `frontend/browser/tree.spec.ts`

- [ ] **Step 1: Write the spec**

Create `frontend/browser/tree.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";
import { importPackage, openCase, selectText } from "./helpers";

const revision = (page: Page) => page.locator(".status-badge");

/** The tree row whose label is exactly `label`. */
const treeItem = (page: Page, label: string) =>
  page.locator('[role="treeitem"]').filter({ has: page.locator(".tree-label", { hasText: new RegExp(`^${label}$`) }) });

/** Mark text, search a term and pick it; the new annotation stays selected. */
async function annotate(page: Page, start: number, end: number, query: string, termId: string, expectedRevision: number) {
  await selectText(page, start, end);
  await page.getByLabel(/Search ontology term/i).fill(query);
  await page.locator(".candidate-card").filter({ hasText: termId }).click();
  await expect(revision(page)).toHaveAttribute("title", `Revision ${expectedRevision}`);
}

/** An independent case with one annotation "Seizure" on 14..21, selected. */
async function openWithSeizure(page: Page, annotator: string) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await importPackage(page, "", "browser-fixture", annotator);
  await page.locator("#mode-select").selectOption("independent");
  await openCase(page, { identity: annotator });
  await annotate(page, 14, 21, "Seizure", "HP:0001250", 1);
}

test.describe("ontology tree", () => {
  test("search a term, open the tree, pick a child and use it", async ({ page }) => {
    await openWithSeizure(page, "tree-pick");
    await page.getByRole("button", { name: "Show in tree" }).click();
    const dialog = page.getByRole("dialog", { name: "Ontology tree" });
    await expect(dialog).toBeVisible();

    // Opened at the term: the path is open, the term selected, focused and on screen.
    const seizure = treeItem(page, "Seizure");
    await expect(seizure).toHaveAttribute("aria-selected", "true");
    await expect(seizure).toHaveAttribute("aria-expanded", "true");
    await expect(seizure).toHaveAttribute("aria-current", "true");
    await expect(seizure).toBeFocused();
    await expect(seizure).toBeInViewport();
    await expect(dialog.locator(".tree-label")).toHaveText([
      "All",
      "Phenotypic abnormality",
      "Abnormality of the nervous system",
      "Areflexia",
      "Hypotonia",
      "Seizure",
      "Dialeptic seizure",
      "Status epilepticus",
      "Hearing impairment",
    ]);

    const use = dialog.getByRole("button", { name: "Use this term" });
    await expect(use).toBeDisabled();

    // A click selects and shows the details; it assigns nothing.
    await treeItem(page, "Status epilepticus").click();
    await expect(dialog.getByRole("heading", { name: "Status epilepticus" })).toBeVisible();
    await expect(dialog.locator(".tree-detail")).toContainText("HP:0002133");
    await expect(revision(page)).toHaveAttribute("title", "Revision 1");

    await use.click();
    await expect(dialog).toHaveCount(0);
    await expect(revision(page)).toHaveAttribute("title", "Revision 2");
    // The annotation carries the child now and is still selected.
    await expect(page.locator(".inspector-pane h2")).toContainText("Status epilepticus");
    await expect(page.locator(".inspector-pane h2")).toContainText("HP:0002133");
    await expect(page.locator(".sidebar [data-list-key^='annotation:']")).toContainText("Status epilepticus");
    await expect(page.locator(".sidebar .doc-item.selected")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Show in tree" })).toBeFocused();
  });

  test("the tree is operable by keyboard and keeps the focus inside the dialog", async ({ page }) => {
    await openWithSeizure(page, "tree-keys");
    await page.getByRole("button", { name: "Show in tree" }).click();
    const dialog = page.getByRole("dialog", { name: "Ontology tree" });
    await expect(treeItem(page, "Seizure")).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(treeItem(page, "Dialeptic seizure")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(treeItem(page, "Seizure")).toBeFocused();

    // Left closes the open branch, left again goes to the parent.
    await page.keyboard.press("ArrowLeft");
    await expect(treeItem(page, "Seizure")).toHaveAttribute("aria-expanded", "false");
    await expect(treeItem(page, "Status epilepticus")).toHaveCount(0);
    await page.keyboard.press("ArrowLeft");
    await expect(treeItem(page, "Abnormality of the nervous system")).toBeFocused();
    // Moving the focus selected nothing.
    await expect(treeItem(page, "Seizure")).toHaveAttribute("aria-selected", "true");

    // "Hearing impairment" is closed: opening it fetches its children.
    await page.keyboard.press("End");
    await expect(treeItem(page, "Hearing impairment")).toBeFocused();
    const fetched = page.waitForResponse((response) => response.url().endsWith("/api/v1/terms/tree/node"));
    await page.keyboard.press("ArrowRight");
    expect((await fetched).ok()).toBeTruthy();
    await expect(treeItem(page, "Sensorineural hearing impairment")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(treeItem(page, "Sensorineural hearing impairment")).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(treeItem(page, "Sensorineural hearing impairment")).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByRole("heading", { name: "Sensorineural hearing impairment" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Use this term" })).toBeEnabled();

    // Tab and Shift+Tab go round inside the dialog and never leave it.
    for (let step = 0; step < 6; step += 1) {
      await page.keyboard.press("Tab");
      await expect(dialog.locator(":focus")).toHaveCount(1);
    }
    for (let step = 0; step < 6; step += 1) {
      await page.keyboard.press("Shift+Tab");
      await expect(dialog.locator(":focus")).toHaveCount(1);
    }

    // Escape closes the dialog only: nothing was assigned, the annotation is still selected.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Show in tree" })).toBeFocused();
    await expect(page.locator(".sidebar .doc-item.selected")).toHaveCount(1);
    await expect(revision(page)).toHaveAttribute("title", "Revision 1");
  });

  test("pinned, the tree sits beside the text, follows the selection and comes back pinned", async ({ page }) => {
    await openWithSeizure(page, "tree-pin");
    await page.getByRole("button", { name: "Show in tree" }).click();
    await page.getByRole("dialog", { name: "Ontology tree" }).getByRole("button", { name: "Keep open" }).click();

    const panel = page.getByRole("region", { name: "Ontology tree" });
    await expect(panel).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Ontology tree" })).toHaveCount(0);
    // The same walk, now docked.
    await expect(treeItem(page, "Seizure")).toHaveAttribute("aria-selected", "true");

    // 1280x720: text, annotation panel and tree are all on screen and none covers another.
    const box = async (selector: string) => (await page.locator(selector).boundingBox())!;
    const text = await box(".center-pane");
    const inspector = await box(".inspector-pane");
    const tree = await box(".tree-host--panel");
    expect(text.width).toBeGreaterThanOrEqual(500);
    expect(inspector.height).toBeGreaterThanOrEqual(200);
    expect(tree.height).toBeGreaterThanOrEqual(300);
    expect(text.x + text.width).toBeLessThanOrEqual(tree.x + 1);
    expect(inspector.y + inspector.height).toBeLessThanOrEqual(tree.y + 1);
    expect(tree.x + tree.width).toBeLessThanOrEqual(1281);
    expect(tree.y + tree.height).toBeLessThanOrEqual(721);
    await expect(panel.getByRole("button", { name: "Use this term" })).toBeInViewport();
    await expect(page.getByRole("button", { name: "Show in tree" })).toBeInViewport();

    // "Use this term" keeps the panel open and moves the "current" mark.
    await treeItem(page, "Status epilepticus").click();
    await panel.getByRole("button", { name: "Use this term" }).click();
    await expect(revision(page)).toHaveAttribute("title", "Revision 2");
    await expect(panel).toBeVisible();
    await expect(treeItem(page, "Status epilepticus")).toHaveAttribute("aria-current", "true");
    await expect(treeItem(page, "Seizure")).not.toHaveAttribute("aria-current", "true");
    await expect(panel.getByRole("button", { name: "Use this term" })).toBeDisabled();

    // The text is still usable: a second annotation, and the tree jumps to its term.
    await annotate(page, 0, 9, "Hypotonia", "HP:0001252", 3);
    await expect(treeItem(page, "Hypotonia")).toHaveAttribute("aria-selected", "true");
    await expect(treeItem(page, "Hypotonia")).toHaveAttribute("aria-current", "true");
    await expect(treeItem(page, "Hypotonia")).toBeInViewport();

    // After a reload the choice is still there: "Show in tree" opens the panel directly.
    await page.reload();
    await expect(page.locator("#package-select")).toHaveValue("browser-fixture");
    await page.locator("#mode-select").selectOption("independent");
    await openCase(page, { identity: "tree-pin" });
    await expect(page.getByRole("region", { name: "Ontology tree" })).toHaveCount(0);
    await page.locator(".sidebar [data-list-key^='annotation:']").first().click();
    await page.getByRole("button", { name: "Show in tree" }).click();
    await expect(page.getByRole("region", { name: "Ontology tree" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Ontology tree" })).toHaveCount(0);

    // Below 1100 px the same tree is a dialog, and there is no pin switch.
    await page.setViewportSize({ width: 1000, height: 700 });
    const dialog = page.getByRole("dialog", { name: "Ontology tree" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Keep open" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close tree" }).click();
    await expect(dialog).toHaveCount(0);

    // Wide again: releasing the pin closes the panel, and the next opening is a dialog.
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole("button", { name: "Show in tree" }).click();
    await page.getByRole("region", { name: "Ontology tree" }).getByRole("button", { name: "Keep open" }).click();
    await expect(page.getByRole("region", { name: "Ontology tree" })).toHaveCount(0);
    await page.getByRole("button", { name: "Show in tree" }).click();
    await expect(page.getByRole("dialog", { name: "Ontology tree" })).toBeVisible();
  });
});
```

- [ ] **Step 2: Run it**

Run (in `frontend/`): `npm run build && npx playwright test browser/tree.spec.ts`
Expected: 3 passed.

This spec was written without being run. Where it fails, decide first which side is wrong:

- If the **application** behaves against the spec (focus not in the tree, panel covering the text, tree not following the selection), fix the application.
- If the **spec** assumes something about the surrounding app that is not so — most likely in the reload part (which package and mode the dashboard shows after a reload, whether the identity dialog appears) — adjust those lines to what the dashboard does, and keep what the test is about: after a reload, "Show in tree" opens the side panel without a dialog.
- If a size assertion fails by a few pixels, measure with a screenshot before changing a number, and change the CSS rather than the threshold when text or annotation panel really is too small.

- [ ] **Step 3: Run the whole browser suite**

Run (in `frontend/`): `npx playwright test`
Expected: every spec passes. The other specs do not open the tree; the only shared change is the new button under the term name.

- [ ] **Step 4: Commit**

```bash
git add frontend/browser/tree.spec.ts
git commit -m "test(e2e): browse the ontology tree in a real browser"
```

---

### Task 13: Verification, a look at the result, embedded assets

- [ ] **Step 1: All checks**

Run (in `frontend/`): `npm run typecheck && npm test && npm run api:check && npm run build && npx playwright test`
Run (repo root): `uv run pytest -q && uv run ruff check . && uv run ruff format --check src tests scripts && uv run mypy src && uv run python scripts/export_openapi.py --check`
Expected: everything passes. (`uv run ruff format --check .` additionally reports `docs/work-package-v2.md`, which failed before this work; nothing else may be reported.)

- [ ] **Step 2: Look at it**

With a temporary Playwright spec (delete it afterwards, do not commit it), modelled on `openWithSeizure` in `frontend/browser/tree.spec.ts`, take screenshots into a directory outside the repo and look at each one:

1. **1280×720, dialog** opened at "Seizure": about 900×600, centred; tree left, details right; "Seizure" highlighted and in view with its two children under it; counts at the branches, no triangle at the leaves; "Use this term" disabled with the hint next to it.
2. **1280×720, dialog**, "Status epilepticus" selected: details show name, id, definition, synonyms; "Use this term" enabled.
3. **1280×720, pinned**: the tree under the annotation panel in the right column. Check that the text column is as wide as without the tree; that the annotation panel shows the term name, "Show in tree", "Change term" and the start of the axes without overlap; that in the tree the row list and the details each have room for at least four lines; that "Use this term" is visible without scrolling.
4. **1440×900, pinned**: the same arrangement with more height.
5. **1920×1080, pinned**: four columns; the tree is the rightmost, full height; no empty band, no double border between inspector and tree.
6. **1100×700, pinned**: the narrowest docked case. The text column has 400 px here; confirm it is still readable and the mention highlights are intact.
7. **1000×700**: "Show in tree" gives the dialog, without a "Keep open" switch.
8. **600×800**: the dialog fills the screen, tree above details.
9. **1280×720, pinned, while creating a new annotation** (text marked, search panel open in the inspector): the search box and at least two candidates are reachable above the tree.

For the multi-parent case there is no browser fixture. If a real `hp.json` is at hand, start the app with it (`uv run ontocurator --ontology <path>` or the equivalent your setup uses), open the tree at a term with two parents (for example `HP:0001250` Seizure in current releases), and check by eye that "Also under" lists the other parent and that a click opens that path and scrolls to the term. Also note how many root rows a real ontology shows (see "Decisions", point 5). Report what you saw; if no real file is at hand, say so.

If a screenshot shows something clipped or overlapping, change CSS values in `frontend/src/styles.css` (not the structure), rerun `npm test` and `npx playwright test browser/tree.spec.ts`, and commit as `fix(frontend): …` with one sentence saying what was off.

- [ ] **Step 3: Rebuild the embedded web assets and commit**

```bash
uv run python -c "import sys; sys.path.insert(0, 'scripts'); from build_common import build_frontend, sync_embedded_web_assets; sync_embedded_web_assets(build_frontend(npm_ci=False))"
git add src/ontocurator/web
git commit -m "build: rebuild embedded web assets"
```

- [ ] **Step 4: Report**

Branch and commits; the actual numbers from Step 1; every deviation from this plan (what, where, why), including every anchor that Part 2 had moved and every place where code of this plan had to be corrected to make its tests pass; what the screenshots show, including anything that looks off, and their paths; what you saw with a real ontology, or that none was at hand. Do not merge or push.

---

## Notes for the implementer

- **Why the walk's event may grow when no other search event does.** The selection check in `EditingService.apply` (`cmd.term_id not in event.candidates`) is the reason. A tree shows more with every branch that is opened, and a term chosen deep in the tree has to be found among the candidates of the event the selection names. The alternative — a new event per opened branch — would break that check or would make the log of one walk a chain of events without a selection.
- **What is logged, exactly.** `tree/open`: the roots, then the children under every node of the path (which contains the path's nodes themselves). `tree/node` with `expand`: the children of that node. `tree/node` with `via_parent_id`: the children under every node of the new path above the term. `tree/node` without either (a mere selection): nothing. Parents named under "Also under" are not logged until their path is opened.
- **The selection event** is the existing one: a copy of the walk's event at the moment of "Use this term", with `event_id = "selection-…"`, `source_search_event_id = browse_id`, `selected_term_id`, and `displayed_position` / `ranked_position` = the position in order of first appearance. In a pinned tree several selections can come from one walk; each gets its own selection event (the id includes the mutation id).
- **One walk per mount.** `TreeBrowser` calls `tree/open` once and never again. `CaseScreen` starts a new walk only by changing the `key` (`treeWalk.nonce`): on "Show in tree" and when a docked tree follows the selection to another annotation. Pinning, resizing the window and "Use this term" keep the walk.
- **Row identity is the path.** Do not key rows, expansion or selection by term id: a term with two parents is on screen twice, and "Also under" depends on telling the two places apart.
- **Escape.** Dialog: a capturing listener on `window` closes it and stops the event, and `modalOpen` in `CaseScreen` covers the tree dialog as well, so the case screen's "Escape clears the selection" cannot fire. Panel: only the tree widget handles Escape and stops it; anywhere else Escape does what it did before.
- **Focus.** The dialog takes the focus when it mounts (the dialog element itself while loading, then the start row), wraps Tab, and returns the focus to the element that had it before — the "Show in tree" button. A docked tree takes the focus only when it was opened by hand, never when it follows the selection. After a docked tree is closed, the focus is not moved anywhere.
- **When "Use this term" cannot be saved.** A refusal by the server (4xx) rejects the promise and the tree shows the reason. A network failure does not reject: the mutation queue keeps the edit pending until it can be retried, the page's status badge says so, and "Use this term" stays disabled meanwhile. That is the queue's existing behaviour for every edit.
- **`React.StrictMode`** (`frontend/src/main.tsx`) runs effects twice in development. The `opened` ref in `TreeBrowser` keeps that from creating a second walk. Do not add a "cancelled" flag to the cleanup of that effect: in development the first run's cleanup would then discard the only response.
- **Old application versions.** Nothing in the stored format changes: a walk is a `SearchEventRecord` with `route = "browse"`, a value the model always accepted.

## Decisions the spec left open

1. **Where the pinned tree goes.** Under the annotation panel in the right column from 1100 px, a fourth column from 1600 px (Task 11). The spec's "side area at the right edge" as a column of its own leaves the text 200 px at 1280 px. Trade-off: at 1280×720 annotation panel (about 260 px) and tree (about 400 px) share the height and both scroll.
2. **`expand` on `tree/node`.** The spec's request has no such field and says the endpoint is called "on expanding and on selecting", returning the children each time, while the event shall record "the children that became visible". A selection makes no children visible. Without the flag the log would list the children of every node that was merely clicked. `children` is therefore returned and logged only with `expand: true`.
3. **Shape of the answers.** `path` (ids, root first) plus `levels` (one entry per node to show expanded) for "the expanded paths … per level the children of the path node"; `start_status` for the notice at an unknown or obsolete start term; the parents inside `detail` (the spec lists them next to it), so that `open` and `node` describe a term the same way.
4. **Only shown terms can be asked for.** `tree/node` refuses a term that is not among the walk's candidates (`TREE_TERM_NOT_SHOWN`). The interface never asks for one; the check keeps the event free of terms the annotator could not have reached.
5. **Roots.** Non-obsolete terms without a non-obsolete parent, sorted by label. A live term whose only parents are obsolete is a root (otherwise it would be unreachable). All roots are returned and logged; there is no limit. For an ontology file with many parentless classes this makes a long top level — not checked against a real MONDO or a full HPO release, see below.
6. **Tie-break of equally short paths.** By the labels along the path, compared from the root down, case-insensitively; then by the ids. ("Alphabetically first" in the spec does not say which label.)
7. **Child counts.** A branch shows its number of children; a leaf shows neither a count nor a triangle ("every node shows the number of its children" would put a 0 on every leaf).
8. **Event fields.** `query` is the term id as sent; `candidate_scores` and `candidate_routes` stay empty (the event's `route` already says `browse`); `ranked_ids` equals `candidates`.
9. **Two states of one walk on import.** Not a conflict if one list of shown terms is the beginning of the other and nothing else differs; the longer one is kept (Task 3). The spec does not mention imports.
10. **`route = "browse"` is shared** with the legacy `browse` route of the search, which the spec keeps valid. Events of that route are indistinguishable from walks; `tree/node` would accept one as a walk if workspace, annotation and layer match. The interface no longer creates such events.
11. **Releasing the pin** closes the panel (the spec's wording) and stores "not pinned"; it does not turn the panel back into a dialog. Pinning a dialog docks the same walk.
12. **A pinned tree and the same annotation.** Reselecting the annotation the tree already shows starts no new walk; going to another annotation and back starts one each time. "Use this term" in the panel continues the same walk.
13. **A pinned preference on a narrow screen** is kept but shown as a dialog; there is no switch to change it there.
14. **The preference travels through `App`**, which already loads the preferences, as props of `CaseScreen`; `CaseScreen` reads it when a case opens.
15. **The button's place.** "Show in tree" sits under the term name in the annotation panel, not in the row of "Change term" and "✕": three buttons beside the name do not fit the 380 px column.
16. **Keys beyond the spec's list.** `Home`, `End` and `Space` (select) from the ARIA tree pattern. No type-ahead.
17. **Details.** Synonyms of all kinds in file order, without duplicates; translated names as one line per language code ("de  Krampfanfall; Anfall"), languages in alphabetical order.
18. **`tree/open` for an annotation that is not in the draft** is allowed, as it is for a search ("the same checks as `POST /search`").
19. **Errors.** A failed `tree/open`, `tree/node` or "Use this term" is shown inside the tree, because the page's error line is behind the dialog.
20. **No browser test for "Also under".** The browser server's ontologies are single-parent trees.

## What was and was not run

Stated plainly, because the plan demands real code and the reader should know how far to trust it.

- **Run:** the code of Tasks 1 and 2 (`ontology/tree.py` and its tests), in a throwaway copy of the repository outside the working tree: 14 tests passed (the plan's version has one test more, a split of an existing one, and renames two helpers), `ruff check`, `ruff format` and `mypy` were clean. The repository change of Task 3 (Steps 3 and 4) passed `ruff` and `mypy` there; its tests were **not** run.
- **Checked against the existing code by running it:** that a package bound to a synthetic ontology can be imported and searched through the API (the `graph_walk` fixture of Task 4 is built that way); that an `assisted` workspace can search its reference layer; the error codes of the layer and document checks; the tree shape of `tests/fixtures/hp.json` and `mondo.json`; that every anchor listed in Task 0 occurred exactly once before Part 2.
- **Not run:** the tests of Task 3; everything in Tasks 4 to 12 — the tree router, the preferences change, all TypeScript (never compiled), all Vitest tests, the Playwright spec — and no CSS was ever rendered. The sizes quoted for the pinned layout are computed from the existing column widths, not measured.
- **Not known:** what Part 2 changed; whether the generated type makes `tree_pinned_by_annotator` optional (Task 6, Step 4 covers both cases); how a real HPO or MONDO file looks at the top level of the tree.
