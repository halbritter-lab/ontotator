# T0: Tree Term ID and External Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every row of the ontology tree, and the detail pane, show the term ID and a link to the term's official page (hpo.jax.org for HPO).

**Architecture:** A pure backend function maps a CURIE prefix to an external URL. `TreeNode` and `TreeTermDetail` carry it as an optional `external_url`. The frontend renders the ID and a ↗ link that does not select the row. Spec: `docs/superpowers/specs/2026-10-14-t0-tree-term-id-link-design.md`.

**Tech Stack:** Python 3.11, FastAPI, Pydantic v2, pytest · React 18, TypeScript, Vitest, Testing Library, Playwright · openapi-typescript.

**Branch:** work on `feat/tree-term-links`, created from `main`, preferably in a worktree (`.worktrees/tree-term-links`). Do not work on `docs/roadmap-web-service`.

---

## File map

| File | Change |
|---|---|
| `src/ontocurator/ontology/links.py` | **new**: `external_term_url(term_id)` |
| `tests/test_ontology_links.py` | **new**: prefix mapping and encoding |
| `src/ontocurator/ontology/tree.py` | `external_url` on `TreeNode` and `TreeTermDetail` |
| `tests/test_ontology_tree.py` | node/detail carry the URL |
| `contracts/openapi.json`, `frontend/src/api/generated.ts` | regenerated, never hand-edited |
| `frontend/src/editor/treeState.ts` | `TreeRow.externalUrl` |
| `frontend/src/editor/TermTree.tsx` | ID + link in each row |
| `frontend/src/editor/TreeBrowser.tsx` | link next to the ID in the detail pane |
| `frontend/src/styles.css` | `.tree-id`, `.tree-external` |
| `frontend/tests/termTree.test.tsx`, `frontend/tests/caseTree.test.tsx` | component tests |
| `frontend/browser/tree.spec.ts` | browser test |
| `src/ontocurator/web/**` | rebuilt embedded assets |

---

### Task 1: External URL function

**Files:**
- Create: `src/ontocurator/ontology/links.py`
- Test: `tests/test_ontology_links.py`

- [ ] **Step 1: Write the failing test**

```python
"""Where a term can be looked up outside Ontocurator."""

import pytest

from ontocurator.ontology.links import external_term_url


@pytest.mark.parametrize(
    ("term_id", "expected"),
    [
        ("HP:0001250", "https://hpo.jax.org/browse/term/HP:0001250"),
        ("MONDO:0007739", "https://monarchinitiative.org/MONDO:0007739"),
        ("GO:0008150", "https://www.ebi.ac.uk/ols4/search?q=GO%3A0008150"),
        ("TEST:0000001", "https://www.ebi.ac.uk/ols4/search?q=TEST%3A0000001"),
    ],
)
def test_each_prefix_links_to_its_term_page(term_id: str, expected: str) -> None:
    assert external_term_url(term_id) == expected


def test_the_id_is_encoded_where_it_could_break_the_url() -> None:
    assert external_term_url("HP:12 3/4") == "https://hpo.jax.org/browse/term/HP%3A12%203%2F4"


@pytest.mark.parametrize("term_id", ["", "no-prefix", ":0001", "HP:"])
def test_something_that_is_no_curie_has_no_link(term_id: str) -> None:
    assert external_term_url(term_id) is None
```

- [ ] **Step 2: Run it and see it fail**

Run: `uv run pytest tests/test_ontology_links.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'ontocurator.ontology.links'`

- [ ] **Step 3: Implement**

```python
"""Where a term can be looked up outside Ontocurator.

HPO and MONDO have term pages addressed by the CURIE. Every other ontology is
looked up through the EBI Ontology Lookup Service search, which finds a term
by its CURIE. Per-ontology link templates are a project setting from T3 on.
"""

from __future__ import annotations

from urllib.parse import quote

_TERM_PAGES = {
    "HP": "https://hpo.jax.org/browse/term/{id}",
    "MONDO": "https://monarchinitiative.org/{id}",
}
_FALLBACK = "https://www.ebi.ac.uk/ols4/search?q={id}"


def external_term_url(term_id: str) -> str | None:
    """The official page of a term, or None for something that is no CURIE."""
    prefix, _, local = term_id.partition(":")
    if not prefix or not local:
        return None
    template = _TERM_PAGES.get(prefix)
    if template is None:
        return _FALLBACK.format(id=quote(term_id, safe=""))
    # A plain CURIE stays readable; anything unusual is encoded.
    safe = ":" if local.isalnum() else ""
    return template.format(id=quote(term_id, safe=safe))
```

- [ ] **Step 4: Run it and see it pass**

Run: `uv run pytest tests/test_ontology_links.py -v`
Expected: 9 passed

- [ ] **Step 5: Commit**

```bash
git add src/ontocurator/ontology/links.py tests/test_ontology_links.py
git commit -m "feat(ontology): map term ids to their external pages"
```

### Task 2: The tree carries the link

**Files:**
- Modify: `src/ontocurator/ontology/tree.py` (`TreeNode` ≈ line 30, `TreeTermDetail` ≈ line 49, `node()` ≈ line 183, `detail()` ≈ line 287)
- Test: `tests/test_ontology_tree.py` (append)

- [ ] **Step 1: Write the failing tests** (append to `tests/test_ontology_tree.py`)

```python
def test_a_node_links_to_the_page_of_its_term() -> None:
    tree = tree_for(load(FIXTURE_PATH))

    node = tree.node("HP:0001250")

    assert node.external_url == "https://hpo.jax.org/browse/term/HP:0001250"


def test_the_detail_links_to_the_page_of_its_term() -> None:
    tree = tree_for(load(FIXTURE_PATH))

    detail = tree.detail("HP:0001250")

    assert detail is not None
    assert detail.external_url == "https://hpo.jax.org/browse/term/HP:0001250"
    assert all(parent.external_url for parent in detail.parents)


def test_terms_of_other_ontologies_link_to_the_lookup_service(tmp_path: Path) -> None:
    tree = OntologyTree(load(write_graph_ontology(tmp_path)))

    assert tree.node(tid("0000003")).external_url == (
        "https://www.ebi.ac.uk/ols4/search?q=TEST%3A0000003"
    )
```

- [ ] **Step 2: Run them and see them fail**

Run: `uv run pytest tests/test_ontology_tree.py -k "links_to or lookup_service" -v`
Expected: FAIL with `AttributeError: 'TreeNode' object has no attribute 'external_url'`

- [ ] **Step 3: Implement**

In `src/ontocurator/ontology/tree.py`, add the import after the existing `from ontocurator.domain.errors import DomainError`:

```python
from ontocurator.ontology.links import external_term_url
```

Add the field as the last field of `TreeNode` and of `TreeTermDetail`. It is optional with a default, so older clients and the generated types treat it as optional:

```python
    # The term's official page, if one is known (hpo.jax.org for HPO).
    external_url: str | None = None
```

Change `node()`:

```python
    def node(self, term_id: str) -> TreeNode:
        return TreeNode(
            term_id=term_id,
            label=self.ontology.label_of(term_id),
            child_count=self.child_count(term_id),
            external_url=external_term_url(term_id),
        )
```

In `detail()`, add `external_url=external_term_url(term.hpo_id),` after `parents=...`.

- [ ] **Step 4: Run the tree tests and the tree API tests**

Run: `uv run pytest tests/test_ontology_tree.py tests/test_tree_api.py tests/test_tree_events.py -v`
Expected: all pass. The tree events log term IDs only, so the logged walks are unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/ontocurator/ontology/tree.py tests/test_ontology_tree.py
git commit -m "feat(tree): return each term's external page with nodes and details"
```

### Task 3: Regenerate the API contract

**Files:**
- Modify: `contracts/openapi.json`, `frontend/src/api/generated.ts` (both generated)

- [ ] **Step 1: Export and generate**

```bash
uv run python scripts/export_openapi.py
npm --prefix frontend run api:generate
```

- [ ] **Step 2: Check the result**

Run: `git diff --stat contracts/openapi.json frontend/src/api/generated.ts`
Expected: both changed. `generated.ts` now has `external_url?: string | null;` in `TreeNode` and `TreeTermDetail`.

Run: `uv run python scripts/export_openapi.py --check && npm --prefix frontend run api:check`
Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add contracts/openapi.json frontend/src/api/generated.ts
git commit -m "build(api): regenerate contract for external term links"
```

### Task 4: Tree rows show the ID and the link

**Files:**
- Modify: `frontend/src/editor/treeState.ts` (`TreeRow` ≈ line 15, `visibleRows` ≈ line 84)
- Modify: `frontend/src/editor/TermTree.tsx` (row markup after `.tree-label`)
- Modify: `frontend/src/styles.css` (after `.tree-count` ≈ line 1317)
- Test: `frontend/tests/termTree.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `frontend/tests/termTree.test.tsx`, replace the `node` helper and the `data` constant at the top:

```tsx
const node = (term_id: string, label: string, child_count = 0) => ({
  term_id,
  label,
  child_count,
  external_url: `https://terms.example/${term_id}`,
});

// Root > (Alpha > Shared, Beta > Yonder), everything loaded. Yonder has no known page.
const data = withLevels(withRoots(emptyTree(), [node("R", "Root", 2)]), [
  { term_id: "R", children: [node("A", "Alpha", 1), node("B", "Beta", 1)] },
  { term_id: "A", children: [node("X", "Shared")] },
  { term_id: "B", children: [{ ...node("Y", "Yonder"), external_url: null }] },
]);
```

Append inside `describe("TermTree", …)`:

```tsx
  it("shows each row's term id and links to the term's page in a new tab", () => {
    render(<Harness />);

    const alpha = item("Alpha");
    expect(alpha.querySelector(".tree-id")?.textContent).toBe("A");
    const link = alpha.querySelector<HTMLAnchorElement>("a.tree-external")!;
    expect(link.getAttribute("href")).toBe("https://terms.example/A");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("aria-label")).toBe("View A on terms.example");
    // Not a stop of its own in the Tab order: the tree keeps one roving tab stop.
    expect(link.getAttribute("tabindex")).toBe("-1");
  });

  it("following the link neither selects nor opens the row", () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);

    fireEvent.click(item("Beta").querySelector("a.tree-external")!);

    expect(onSelect).not.toHaveBeenCalled();
    expect(item("Beta").getAttribute("aria-selected")).toBe("false");
    expect(item("Beta").getAttribute("aria-expanded")).toBe("false");
  });

  it("shows the id without a link where no page is known", () => {
    render(<Harness />);
    fireEvent.click(item("Beta").querySelector(".tree-toggle")!);

    expect(item("Yonder").querySelector(".tree-id")?.textContent).toBe("Y");
    expect(item("Yonder").querySelector("a.tree-external")).toBeNull();
  });
```

- [ ] **Step 2: Run them and see them fail**

Run: `npm --prefix frontend test -- --run tests/termTree.test.tsx`
Expected: the three new tests FAIL (no `.tree-id`). The existing tests pass.

- [ ] **Step 3: Implement**

In `frontend/src/editor/treeState.ts`, add the field to `TreeRow` after `childCount`:

```ts
  /** The term's official page; null if none is known. */
  externalUrl: string | null;
```

In `visibleRows`, set it next to `childCount: node.child_count,`:

```ts
        externalUrl: node.external_url ?? null,
```

In `frontend/src/editor/TermTree.tsx`, add this helper above `export const TermTree`:

```tsx
/** The host a link leads to, for its accessible name. */
const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
```

Replace `<span className="tree-label">{row.label}</span>` with:

```tsx
            <span className="tree-label">{row.label}</span>
            <span className="tree-id">{row.termId}</span>
            {row.externalUrl && (
              <a
                className="tree-external"
                href={row.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                tabIndex={-1}
                title={`View ${row.termId} on ${hostOf(row.externalUrl)}`}
                aria-label={`View ${row.termId} on ${hostOf(row.externalUrl)}`}
                onClick={(event) => event.stopPropagation()} // looking a term up is not selecting it
              >
                ↗
              </a>
            )}
```

In `frontend/src/styles.css`, add after the `.tree-count` rule:

```css
.tree-id {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--text-muted);
}

.tree-external {
  flex-shrink: 0;
  font-size: 0.8rem;
  line-height: 1;
  color: var(--text-muted);
  text-decoration: none;
  padding: 0 2px;
}

.tree-external:hover,
.tree-external:focus-visible {
  color: var(--primary);
}
```

- [ ] **Step 4: Run them and see them pass**

Run: `npm --prefix frontend test -- --run tests/termTree.test.tsx`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/editor/treeState.ts frontend/src/editor/TermTree.tsx frontend/src/styles.css frontend/tests/termTree.test.tsx
git commit -m "feat(tree): show term ids and an external link in each tree row"
```

### Task 5: The detail pane links the term

**Files:**
- Modify: `frontend/src/editor/TreeBrowser.tsx` (detail markup ≈ line 252)
- Test: `frontend/tests/caseTree.test.tsx`

- [ ] **Step 1: Write the failing test**

In `frontend/tests/caseTree.test.tsx`, `mockTree()`, add a field to `detailOf`:

```tsx
    external_url: `https://hpo.jax.org/browse/term/${termId}`,
```

Append inside `describe("the tree in the case screen", …)`:

```tsx
  it("links the selected term to its official page next to its id", async () => {
    const view = baseView([snapshot("a1", "HP:A")]);
    mockTree();
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);

    const panel = await openPanel(container, "a1");
    const detail = panel.querySelector<HTMLElement>(".tree-detail")!;

    const link = await within(detail).findByRole("link", { name: "View HP:A on hpo.jax.org" });
    expect(link.closest(".tree-detail__id")?.textContent).toBe("HP:A↗");
    expect(link.getAttribute("href")).toBe("https://hpo.jax.org/browse/term/HP:A");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm --prefix frontend test -- --run tests/caseTree.test.tsx -t "official page"`
Expected: FAIL, unable to find role "link".

- [ ] **Step 3: Implement**

In `frontend/src/editor/TreeBrowser.tsx`, replace

```tsx
                  <div className="tree-detail__id">{detail.term_id}</div>
```

with

```tsx
                  <div className="tree-detail__id">
                    {detail.term_id}
                    {detail.external_url && (
                      <a
                        className="tree-external"
                        href={detail.external_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`View ${detail.term_id} on ${new URL(detail.external_url).host}`}
                        title={`View ${detail.term_id} on ${new URL(detail.external_url).host}`}
                      >
                        ↗
                      </a>
                    )}
                  </div>
```

The server only returns absolute URLs, so `new URL` cannot throw here.

- [ ] **Step 4: Run the frontend checks**

Run: `npm --prefix frontend test -- --run tests/caseTree.test.tsx tests/termTree.test.tsx && npm --prefix frontend run typecheck`
Expected: all pass, and the typecheck reports no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/editor/TreeBrowser.tsx frontend/tests/caseTree.test.tsx
git commit -m "feat(tree): link the selected term to its official page"
```

### Task 6: Browser test

**Files:**
- Modify: `frontend/browser/tree.spec.ts` (inside `test.describe("ontology tree", …)`)

- [ ] **Step 1: Add the test**

```ts
  test("every row shows its term id and links to hpo.jax.org without selecting", async ({ page }) => {
    await openWithSeizure(page, "tree-links");
    await showInTree(page).click();
    const row = treeItem(page, DIALEPTIC);
    await expect(row.locator(".tree-id")).toHaveText(DIALEPTIC);
    const link = row.locator("a.tree-external");
    await expect(link).toHaveAttribute("href", `https://hpo.jax.org/browse/term/${DIALEPTIC}`);
    await expect(link).toHaveAttribute("target", "_blank");

    // Follow the link without leaving the case: the new tab is closed again.
    const [popup] = await Promise.all([page.waitForEvent("popup"), link.click()]);
    await popup.close();
    await expect(row).toHaveAttribute("aria-selected", "false");
    await expect(treeItem(page, SEIZURE)).toHaveAttribute("aria-selected", "true");
  });
```

The popup tries to load hpo.jax.org. If the test environment has no network, the popup still opens and is closed, and the test does not depend on the page loading.

- [ ] **Step 2: Run it**

Run: `npm --prefix frontend run test:e2e -- tree.spec.ts`
Expected: all tree specs pass, including the new one.

- [ ] **Step 3: Commit**

```bash
git add frontend/browser/tree.spec.ts
git commit -m "test(tree): browser check for term ids and external links"
```

### Task 7: Rebuild the embedded web assets and verify everything

**Files:**
- Modify: `src/ontocurator/web/**`

- [ ] **Step 1: Rebuild**

Run: `uv run --locked python scripts/build_release.py --skip-npm-ci --out-dir dist`
Expected: it ends after verifying the wheel. `git status` shows changed files under `src/ontocurator/web/`.

- [ ] **Step 2: Full verification**

```bash
uv run pytest -q
uv run ruff check .
uv run ruff format --check .
uv run mypy src
npm --prefix frontend run typecheck
npm --prefix frontend test
```

Expected: everything passes with no errors. If a command fails, fix the cause before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/ontocurator/web
git commit -m "build: rebuild embedded web assets"
```
