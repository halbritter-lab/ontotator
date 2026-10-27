# Sidebar Scroll & AI Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the case screen's left sidebar one continuous scroll area with sticky section headers, and mark tool-generated annotations with a visible "AI" badge.

**Architecture:** Frontend only. A new `AiBadge` component renders from an annotation's `provenance` (shown when `actor.kind === "tool"`). `CaseScreen.tsx` wraps the three sidebar lists in a single `.sidebar-scroll` container and scrolls the selected entry into view; `styles.css` moves scrolling from the individual lists to that container. No API, package-format or backend changes.

**Tech Stack:** React 18, TypeScript, plain CSS (`frontend/src/styles.css`), Vitest + Testing Library (jsdom), Playwright against the real backend (`tests/browser_server.py`).

**Spec:** `docs/superpowers/specs/2026-10-07-sidebar-scroll-ai-badge-design.md`

**Conventions used below**

- All `npm`/`npx` commands run in `frontend/`. All `uv`/`git` commands run in the repo root.
- Commit messages follow the repo style (`feat(frontend): …`, `test(e2e): …`, `build: …`). Do **not** add any `Co-Authored-By` or "Generated with" lines.
- jsdom does not load `styles.css` and does not implement `scrollIntoView`; unit tests therefore assert DOM structure and mock `scrollIntoView`. Real scrolling is covered by the Playwright test in Task 6.

## File structure

| File | Action | Responsibility |
|---|---|---|
| `frontend/src/editor/AiBadge.tsx` | create | Renders the "✦ AI" badge for tool provenance, nothing otherwise |
| `frontend/src/styles.css` | modify | `.badge-ai`, `.sidebar-scroll`, sticky headers |
| `frontend/src/app/CaseScreen.tsx` | modify | Badge in proposal list / reference list / reference details; single scroll container; scroll selection into view |
| `frontend/src/editor/ReviewActions.tsx` | modify | Badge in the "Source" line of the proposal details |
| `frontend/tests/aiBadge.test.tsx` | create | Unit tests for `AiBadge` |
| `frontend/tests/sidebar.test.tsx` | create | CaseScreen tests: badge placement, scroll container, scroll-into-view |
| `frontend/tests/reviewActions.test.tsx` | modify | Badge in proposal details |
| `tests/browser_server.py` | modify | `many_proposals` fixture scenario |
| `frontend/browser/sidebar.spec.ts` | create | Real-browser test of scrolling and sticky header |
| `src/ontotator/web/` | regenerate | Embedded SPA build (git-tracked) |

---

### Task 0: Branch and commit the spec

**Files:**
- Add: `docs/superpowers/specs/2026-10-07-sidebar-scroll-ai-badge-design.md`
- Add: `docs/superpowers/plans/2026-10-07-sidebar-scroll-ai-badge.md`

- [ ] **Step 1: Create the feature branch**

```bash
git switch -c feat/sidebar-scroll-ai-badge
```

- [ ] **Step 2: Commit spec and plan**

```bash
git add docs/superpowers/specs/2026-10-07-sidebar-scroll-ai-badge-design.md docs/superpowers/plans/2026-10-07-sidebar-scroll-ai-badge.md
git commit -m "docs: spec and plan for continuous sidebar and AI badge"
```

- [ ] **Step 3: Make sure the frontend toolchain is installed and green**

Run (in `frontend/`): `npm ci && npm run typecheck && npm test`
Expected: typecheck without errors, all Vitest suites pass.

---

### Task 1: `AiBadge` component

**Files:**
- Create: `frontend/src/editor/AiBadge.tsx`
- Modify: `frontend/src/styles.css` (after the `.badge-review` rule, around line 93)
- Test: `frontend/tests/aiBadge.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/aiBadge.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AiBadge } from "../src/editor/AiBadge";

describe("AiBadge", () => {
  it("marks tool provenance and names tool and method in the tooltip", () => {
    render(<AiBadge provenance={{ actor: { actor_id: "pheno-nlp", kind: "tool" }, method: "llm-v2" }} />);
    const badge = screen.getByLabelText("AI-generated: pheno-nlp · llm-v2");
    expect(badge.textContent).toBe("✦ AI");
    expect(badge.getAttribute("title")).toBe("AI-generated: pheno-nlp · llm-v2");
    expect(badge.classList.contains("badge-ai")).toBe(true);
  });

  it("renders nothing for human provenance", () => {
    const { container } = render(
      <AiBadge provenance={{ actor: { actor_id: "dr-weber", kind: "human" }, method: "manual" }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/aiBadge.test.tsx`
Expected: FAIL — cannot resolve `../src/editor/AiBadge`.

- [ ] **Step 3: Implement the component**

Create `frontend/src/editor/AiBadge.tsx`:

```tsx
import type { components } from "../api/generated";

type Provenance = components["schemas"]["Provenance"];

/** "AI" marker for annotations produced by a tool; humans get no marker. */
export function AiBadge({ provenance }: { provenance: Provenance }) {
  if (provenance.actor.kind !== "tool") return null;
  const description = `AI-generated: ${provenance.actor.actor_id} · ${provenance.method}`;
  return (
    <span className="badge badge-ai" title={description} aria-label={description}>
      ✦ AI
    </span>
  );
}
```

- [ ] **Step 4: Add the style**

In `frontend/src/styles.css`, directly after the `.badge-review { … }` rule, add:

```css
.badge-ai {
  background: linear-gradient(135deg, #7c3aed, #db2777);
  color: #fff;
  font-size: 0.72rem;
  font-weight: 600;
  padding: 2px 6px;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/aiBadge.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/editor/AiBadge.tsx frontend/src/styles.css frontend/tests/aiBadge.test.tsx
git commit -m "feat(frontend): AI badge component for tool provenance"
```

---

### Task 2: Badge in the sidebar lists and reference details

**Files:**
- Modify: `frontend/src/app/CaseScreen.tsx` (imports; proposal meta line ~1450–1454; reference list ~1466–1470; reference details ~1575)
- Test: `frontend/tests/sidebar.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/sidebar.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaseScreen, type WorkspaceView } from "../src/app/CaseScreen";

const key = {
  package_id: "pkg",
  document_id: "doc",
  annotator_id: "dr-a",
  mode: "review" as const,
  scope_id: "scope-default",
  target_set_id: "targets",
};
const scope = { scope_id: "scope-default", mode: "review" as const, editable_layer_ids: ["phenotype"], reference_layer_ids: [] };
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

const snapshot = (
  annotationId: string,
  termId: string,
  provenance: { actor: { actor_id: string; kind: "tool" | "human" }; method: string; source_refs?: string[] },
) => ({
  schema_version: "ontotator-annotation/v3" as const,
  annotation: {
    annotation_id: annotationId,
    document_id: "doc",
    layer_id: "phenotype",
    type_id: "default",
    term_id: termId,
    axes_values: { assertion: "present" },
    evidence_refs: [{ evidence_id: `ev-${annotationId}`, version: "ev-v" }],
    provenance,
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

const TOOL = { actor: { actor_id: "pheno-nlp", kind: "tool" as const }, method: "llm-v2" };
const HUMAN = { actor: { actor_id: "dr-weber", kind: "human" as const }, method: "manual" };

/**
 * Review view: `tool-prop` and `human-prop` are review targets, `reference` is an
 * extra input (shown under "Reference Annotations"), `annotations` is the draft.
 */
const reviewView = (annotations: any[] = []): WorkspaceView => {
  const inputs = [
    snapshot("tool-prop", "HP:0001", TOOL),
    snapshot("human-prop", "HP:0002", HUMAN),
    snapshot("reference", "HP:0003", TOOL),
  ];
  const targets = {
    target_set_id: "targets",
    targets: [
      { annotation_id: "tool-prop", version: "tool-prop-v1" },
      { annotation_id: "human-prop", version: "human-prop-v1" },
    ],
  };
  return {
    key,
    scope,
    layers,
    ontologies: [{ ontology_id: "hp", release: "r", label: "HPO", sha256: "s", format: "obo-graph-json" as const }],
    checked_layer_ids: [],
    document: { document_id: "doc", text: "alpha beta gamma", language: "en", text_sha256: "text" },
    targets,
    available_inputs: inputs,
    submissions: [],
    term_statuses: {},
    axes_definition: "editor-axes/v1",
    axes_config: [{ id: "assertion", label: "Assertion", options: ["present", "absent", "uncertain"], allow_empty: true }],
    axes_config_sha256: "sha-axes",
    draft: {
      key, targets, revision: 0, annotations,
      evidence: annotations.flatMap((a) => a.evidence), decisions: [], checked_layer_ids: [],
    },
  } as WorkspaceView;
};

const renderCase = (view: WorkspaceView) =>
  render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);

const itemFor = (container: HTMLElement, termId: string): HTMLElement => {
  const item = Array.from(container.querySelectorAll<HTMLElement>(".sidebar [data-list-key]"))
    .find((el) => el.textContent?.includes(termId));
  if (!item) throw new Error(`no sidebar entry for ${termId}`);
  return item;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AI badge in the sidebar", () => {
  it("replaces the '• tool' text of a tool proposal and leaves human proposals unmarked", () => {
    const { container } = renderCase(reviewView());
    const toolItem = itemFor(container, "HP:0001");
    expect(within(toolItem).getByLabelText("AI-generated: pheno-nlp · llm-v2")).toBeDefined();
    expect(toolItem.textContent).not.toContain("• tool");

    const humanItem = itemFor(container, "HP:0002");
    expect(within(humanItem).queryByText("✦ AI")).toBeNull();
    expect(humanItem.textContent).toContain("• human");
  });

  it("marks tool-generated reference annotations in the list and in their details", () => {
    const { container } = renderCase(reviewView());
    const reference = itemFor(container, "HP:0003");
    expect(within(reference).getByText("✦ AI")).toBeDefined();

    fireEvent.click(reference);
    const details = screen.getByLabelText("Reference details");
    expect(within(details).getByText("✦ AI")).toBeDefined();
    expect(details.textContent).toContain("pheno-nlp · llm-v2");
  });

  it("does not mark a curated annotation that was adopted from a tool proposal", () => {
    const adopted = snapshot("copy", "HP:0001", {
      actor: { actor_id: "dr-a", kind: "human" }, method: "manual", source_refs: ["tool-prop:tool-prop-v1"],
    });
    const { container } = renderCase(reviewView([adopted]));
    const curated = Array.from(container.querySelectorAll<HTMLElement>(".sidebar [data-list-key]"))
      .find((el) => el.dataset.listKey === "annotation:copy")!;
    expect(curated).toBeDefined();
    expect(within(curated).queryByText("✦ AI")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/sidebar.test.tsx`
Expected: FAIL — `no sidebar entry for HP:0001` (no `data-list-key` attributes yet).

- [ ] **Step 3: Import the badge in `CaseScreen.tsx`**

Add next to the other `../editor/…` imports (alphabetical, before `AnnotationPanel`):

```tsx
import { AiBadge } from "../editor/AiBadge";
```

- [ ] **Step 4: Give every sidebar entry a stable key attribute**

These attributes are also used by Task 5. In the three list renderings of `CaseScreen.tsx`:

Proposal `<li>` (the one with `key={refKey(t)}`): add

```tsx
                      data-list-key={`target:${refKey(t)}`}
```

Reference `<button>` (the one with `key={sourceKey(s)}`): add

```tsx
              data-list-key={`source:${sourceKey(s)}`}
```

Curated `<li>` (the one with `key={annSnap.annotation.annotation_id}`): add

```tsx
                  data-list-key={`annotation:${annSnap.annotation.annotation_id}`}
```

- [ ] **Step 5: Show the badge in the proposal meta line**

Replace

```tsx
                            {t.evidence_count === 0 ? "Spanless" : `“${t.quote ?? ""}”`}
                            {t.evidence_count > 1 && ` +${t.evidence_count - 1} more`}
                            {` • ${t.provenance.actor.kind}`}
```

with

```tsx
                            {t.evidence_count === 0 ? "Spanless" : `“${t.quote ?? ""}”`}
                            {t.evidence_count > 1 && ` +${t.evidence_count - 1} more`}
                            {t.provenance.actor.kind === "tool"
                              ? <>{" "}<AiBadge provenance={t.provenance} /></>
                              : ` • ${t.provenance.actor.kind}`}
```

- [ ] **Step 6: Show the badge on reference annotations (list and details)**

In the reference list, replace

```tsx
              <span>{view.layers?.find(l => l.layer_id === s.annotation.layer_id)?.label} · Read-only</span>
```

with

```tsx
              <span>
                {view.layers?.find(l => l.layer_id === s.annotation.layer_id)?.label} · Read-only{" "}
                <AiBadge provenance={s.annotation.provenance} />
              </span>
```

In the reference details (`<section className="detail-pane" aria-label="Reference details">`), replace

```tsx
                <p>{selectedSource.annotation.provenance.actor.actor_id} · {selectedSource.annotation.provenance.method}</p>
```

with

```tsx
                <p>
                  <AiBadge provenance={selectedSource.annotation.provenance} />{" "}
                  {selectedSource.annotation.provenance.actor.actor_id} · {selectedSource.annotation.provenance.method}
                </p>
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/sidebar.test.tsx`
Expected: PASS (3 tests).

If the reference test fails because `HP:0003` is not listed: the reference list only shows inputs whose layer is visible and that are not review targets (`visibleSources` in `CaseScreen.tsx`). Check that the fixture's `reference` snapshot is not in `targets` and that its `layer_id` is `"phenotype"`.

- [ ] **Step 8: Run the whole unit suite**

Run: `npm run typecheck && npm test`
Expected: no type errors, all suites pass.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/app/CaseScreen.tsx frontend/tests/sidebar.test.tsx
git commit -m "feat(frontend): mark tool-generated proposals and references with an AI badge"
```

---

### Task 3: Badge in the proposal details

**Files:**
- Modify: `frontend/src/editor/ReviewActions.tsx` (imports; "Origin Info" block ~240–244)
- Test: `frontend/tests/reviewActions.test.tsx`

- [ ] **Step 1: Write the failing test**

In `frontend/tests/reviewActions.test.tsx`, add inside `describe("ReviewActions", …)` (it reuses the existing `sampleTarget`, whose provenance is `model-a` / `tool` / `automated`):

```tsx
  it("marks tool proposals with the AI badge next to the written-out source", () => {
    const { rerender } = render(
      <ReviewActions target={sampleTarget} currentDecision={null} draftAnnotations={[]} onDecide={vi.fn()} />
    );
    expect(screen.getByLabelText("AI-generated: model-a · automated")).toBeDefined();
    expect(screen.getByText(/Method: automated/)).toBeDefined();

    rerender(
      <ReviewActions
        target={{ ...sampleTarget, provenance: { actor: { actor_id: "dr-weber", kind: "human" }, method: "manual" } }}
        currentDecision={null}
        draftAnnotations={[]}
        onDecide={vi.fn()}
      />
    );
    expect(screen.queryByText("✦ AI")).toBeNull();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/reviewActions.test.tsx`
Expected: FAIL — unable to find a label with the text `AI-generated: model-a · automated`.

- [ ] **Step 3: Implement**

In `frontend/src/editor/ReviewActions.tsx` add the import below the `TermName` import:

```tsx
import { AiBadge } from "./AiBadge";
```

Replace the "Origin Info" block

```tsx
      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 12 }}>
        Source: <strong>{target.provenance.actor.kind}</strong> ({target.provenance.actor.actor_id}) •
        Method: {target.provenance.method}
      </div>
```

with

```tsx
      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 12 }}>
        <AiBadge provenance={target.provenance} />{" "}
        Source: <strong>{target.provenance.actor.kind}</strong> ({target.provenance.actor.actor_id}) •
        Method: {target.provenance.method}
      </div>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/reviewActions.test.tsx`
Expected: PASS (all tests in the file, including the existing "origin-neutral action buttons" test — the badge changes the display, not the actions).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/editor/ReviewActions.tsx frontend/tests/reviewActions.test.tsx
git commit -m "feat(frontend): show the AI badge in the proposal details"
```

---

### Task 4: One scroll container for the sidebar

**Files:**
- Modify: `frontend/src/app/CaseScreen.tsx` (sidebar markup ~1315–1553)
- Modify: `frontend/src/styles.css` (after the `.doc-list` rule, ~line 153)
- Test: `frontend/tests/sidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `frontend/tests/sidebar.test.tsx`:

```tsx
describe("continuous sidebar", () => {
  it("puts proposals, references and curated annotations into one scroll container", () => {
    const adopted = snapshot("copy", "HP:0001", {
      actor: { actor_id: "dr-a", kind: "human" }, method: "manual", source_refs: ["tool-prop:tool-prop-v1"],
    });
    const { container } = renderCase(reviewView([adopted]));
    const sidebar = container.querySelector(".sidebar")!;
    const scrollers = sidebar.querySelectorAll(".sidebar-scroll");
    expect(scrollers.length).toBe(1);
    const scroller = scrollers[0];

    for (const title of ["Review Proposals (2)", "Reference Annotations (1)", "Curated Annotations (1)"]) {
      const header = Array.from(scroller.querySelectorAll(".sidebar-header"))
        .find((el) => el.textContent?.includes(title));
      expect(header, title).toBeDefined();
    }
    for (const entry of Array.from(sidebar.querySelectorAll("[data-list-key]"))) {
      expect(scroller.contains(entry)).toBe(true);
    }
    for (const list of Array.from(sidebar.querySelectorAll<HTMLElement>(".doc-list"))) {
      expect(list.style.maxHeight).toBe("");
    }
    // The layer controls and the footer stay outside the scrolling part.
    expect(scroller.contains(screen.getByRole("button", { name: /\+ New Annotation/ }))).toBe(true);
    expect(sidebar.lastElementChild).not.toBe(scroller);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/sidebar.test.tsx -t "one scroll container"`
Expected: FAIL — `expected 0 to be 1` (no `.sidebar-scroll` yet).

- [ ] **Step 3: Wrap the three sections in `CaseScreen.tsx`**

Inside `<aside className="sidebar">`, the `<LayerControls … />` element stays first. Directly after it, open the container:

```tsx
          <div className="sidebar-scroll">
```

Close it (`</div>`) directly after the curated list's closing `</ul>` — i.e. immediately **before** the line

```tsx
          {(view.submissions ?? []).length > 0 && <div className="detail-section">
```

Inside the container, change the proposal list's opening tag from

```tsx
              <ul className="doc-list" style={{ maxHeight: "40%", borderBottom: "2px solid var(--border-color)" }}>
```

to

```tsx
              <ul className="doc-list" style={{ borderBottom: "2px solid var(--border-color)" }}>
```

Re-indent the wrapped block by two spaces so the file stays consistently formatted. Nothing else inside the wrapped block changes.

- [ ] **Step 4: Move scrolling to the container in `styles.css`**

Directly after the `.doc-list { … }` rule add:

```css
/* Case sidebar: proposals, references and curated annotations scroll together. */
.sidebar-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.sidebar-scroll .doc-list {
  flex: none;
  overflow-y: visible;
}

.sidebar-scroll .sidebar-header {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--bg-surface);
}

/* Keep an entry scrolled into view clear of the sticky section header. */
.sidebar-scroll [data-list-key] {
  scroll-margin-top: 48px;
}
```

Do not change the existing `.doc-list` rule: the dashboard uses `.doc-list` outside `.sidebar-scroll` and must keep its own scrolling.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run typecheck && npm test`
Expected: no type errors, all suites pass (including `review-findings.test.tsx`, which selects `.doc-list li…` and is unaffected by the wrapper).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/CaseScreen.tsx frontend/src/styles.css frontend/tests/sidebar.test.tsx
git commit -m "feat(frontend): scroll the case sidebar as one list with sticky section headers"
```

---

### Task 5: Scroll the selected entry into view

**Files:**
- Modify: `frontend/src/app/CaseScreen.tsx` (new ref + effect near the other selection state; `ref` on `.sidebar-scroll`)
- Test: `frontend/tests/sidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

Append inside `describe("continuous sidebar", …)` in `frontend/tests/sidebar.test.tsx`:

```tsx
  it("scrolls the selected entry into view", () => {
    const scrolled: string[] = [];
    const original = (Element.prototype as any).scrollIntoView;
    (Element.prototype as any).scrollIntoView = function (this: HTMLElement, options: unknown) {
      expect(options).toEqual({ block: "nearest" });
      scrolled.push(this.dataset.listKey ?? "");
    };
    try {
      const { container } = renderCase(reviewView());
      expect(scrolled).toEqual([]);
      fireEvent.click(itemFor(container, "HP:0002"));
      expect(scrolled).toEqual([itemFor(container, "HP:0002").dataset.listKey]);
      fireEvent.click(itemFor(container, "HP:0003"));
      expect(scrolled[1]).toBe(itemFor(container, "HP:0003").dataset.listKey);
      expect(scrolled.length).toBe(2);
    } finally {
      (Element.prototype as any).scrollIntoView = original;
    }
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/sidebar.test.tsx -t "scrolls the selected entry"`
Expected: FAIL — `expected [] to deeply equal [ 'target:…' ]`.

- [ ] **Step 3: Implement**

In `CaseScreen.tsx`, directly after the line `const selectedSource = visibleSources.find(s => sourceKey(s) === selectedSourceId);` add:

```tsx
  // Keep the selected sidebar entry visible, wherever the selection came from
  // (text click, "Replaced by", keyboard navigation).
  const sidebarScrollRef = useRef<HTMLDivElement | null>(null);
  // Same precedence as the inspector pane: reference, then proposal, then annotation.
  const selectedListKey = selectedSourceId ? `source:${selectedSourceId}`
    : selectedTargetId ? `target:${selectedTargetId}`
    : selectedAnnotationId ? `annotation:${selectedAnnotationId}`
    : null;
  useEffect(() => {
    if (!selectedListKey) return;
    const entry = Array.from(
      sidebarScrollRef.current?.querySelectorAll<HTMLElement>("[data-list-key]") ?? [],
    ).find((el) => el.dataset.listKey === selectedListKey);
    // jsdom has no scrollIntoView.
    entry?.scrollIntoView?.({ block: "nearest" });
  }, [selectedListKey]);
```

(`selectedTargetId` and `selectedSourceId` already hold `refKey(…)` strings, matching the `data-list-key` values from Task 2. The keys are compared via `dataset`, not a CSS selector, because `refKey` produces JSON with quotes.)

Attach the ref to the container from Task 4:

```tsx
          <div className="sidebar-scroll" ref={sidebarScrollRef}>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run typecheck && npm test`
Expected: no type errors, all suites pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/CaseScreen.tsx frontend/tests/sidebar.test.tsx
git commit -m "feat(frontend): keep the selected sidebar entry in view"
```

---

### Task 6: Real-browser test with many proposals

**Files:**
- Modify: `tests/browser_server.py` (`fixture_package`, `/__synthetic_fixture__` route)
- Create: `frontend/browser/sidebar.spec.ts`

- [ ] **Step 1: Add a `many_proposals` fixture scenario**

In `tests/browser_server.py`, extend the signature of `fixture_package`:

```python
def fixture_package(
    package_id: str = "browser-fixture",
    created_at: str = "2026-10-01T00:00:00Z",
    proposals: list[tuple[str, str, int, int]] | None = None,
) -> bytes:
```

and replace the loop header

```python
    for number, (kind, term, start, end) in enumerate(
        [
            ("human", "HP:0001252", 0, 9),
            ("tool", "HP:0001250", 14, 21),
        ]
    ):
```

with

```python
    for number, (kind, term, start, end) in enumerate(
        proposals
        or [
            ("human", "HP:0001252", 0, 9),
            ("tool", "HP:0001250", 14, 21),
        ]
    ):
```

Above `scenario_package`, add:

```python
# 30 tool proposals: enough to overflow the case sidebar at any window height.
MANY_PROPOSALS = [
    ("tool", "HP:0001252", 0, 9) if number % 2 == 0 else ("tool", "HP:0001250", 14, 21)
    for number in range(30)
]
```

In the `/__synthetic_fixture__` handler, add a branch before the final `else`:

```python
            elif scenario == "many_proposals":
                data = fixture_package(
                    package_id="pkg-many-proposals", proposals=MANY_PROPOSALS
                )
```

- [ ] **Step 2: Write the browser test**

Create `frontend/browser/sidebar.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { importPackage, openCase } from "./helpers";

test("sidebar scrolls proposals and curated annotations as one list", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await importPackage(page, "?scenario=many_proposals", "pkg-many-proposals", "sidebar-reviewer");
  await page.locator("#mode-select").selectOption("review");
  await openCase(page, { identity: "sidebar-reviewer" });

  const scroller = page.locator(".sidebar .sidebar-scroll");
  const proposalsHeader = scroller.locator(".sidebar-header").filter({ hasText: "Review Proposals (30)" });
  const curatedHeader = scroller.locator(".sidebar-header").filter({ hasText: "Curated Annotations (0)" });
  await expect(proposalsHeader).toBeVisible();
  await expect(scroller.locator(".badge-ai")).toHaveCount(30);

  // The list overflows and the curated section starts below the fold ...
  const overflow = await scroller.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(overflow).toBeGreaterThan(0);
  await expect(curatedHeader).not.toBeInViewport();

  // ... and is reached by scrolling the one sidebar list.
  await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(curatedHeader).toBeInViewport();
  await expect(scroller.getByRole("button", { name: "+ New Annotation" })).toBeInViewport();

  // Half-way down, the proposals header sticks to the top of the list.
  await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight / 2));
  const [scrollerTop, headerTop] = await Promise.all([
    scroller.evaluate((el) => el.getBoundingClientRect().top),
    proposalsHeader.evaluate((el) => el.getBoundingClientRect().top),
  ]);
  expect(Math.abs(headerTop - scrollerTop)).toBeLessThan(2);

  // Selecting an entry that is scrolled out of sight brings it into view.
  // (A DOM click selects it without Playwright scrolling to it first.)
  await scroller.evaluate((el) => el.scrollTo(0, 0));
  const lastProposal = scroller.locator("[data-list-key^='target:']").last();
  await expect(lastProposal).not.toBeInViewport();
  await lastProposal.evaluate((el) => (el as HTMLElement).click());
  await expect(lastProposal).toBeInViewport();
});
```

- [ ] **Step 3: Run the browser test**

Run (in `frontend/`): `npm run build && npx playwright test browser/sidebar.spec.ts`
Expected: PASS (1 test).

Troubleshooting:
- Import fails with a validation error: the fixture repeats the two terms known to exist in `tests/fixtures/hp.json` (`HP:0001252`, `HP:0001250`) with unique annotation and evidence ids (`proposal-N`, `ev-N`). Read the error text and adjust the fixture (for example the spans), not the UI code.
- `Review Proposals (30)` not found: check the mode selector was set to `review` and the package id matches.

- [ ] **Step 4: Run the whole browser suite**

Run: `npx playwright test`
Expected: all specs pass (the default fixture is unchanged because `proposals` defaults to `None`).

- [ ] **Step 5: Commit**

```bash
git add tests/browser_server.py frontend/browser/sidebar.spec.ts
git commit -m "test(e2e): browser test for the continuous sidebar and AI badges"
```

---

### Task 7: Full verification and embedded assets

**Files:**
- Regenerate: `src/ontotator/web/` (git-tracked SPA build)

- [ ] **Step 1: Frontend checks**

Run (in `frontend/`): `npm run typecheck && npm test && npm run api:check`
Expected: all pass; `api:check` reports no drift (the API did not change).

- [ ] **Step 2: Backend checks**

Run (repo root): `uv run pytest -q`
Expected: all tests pass (only `tests/browser_server.py` changed on the Python side).

- [ ] **Step 3: Rebuild the embedded web assets**

Run (repo root):

```bash
uv run python -c "import sys; sys.path.insert(0, 'scripts'); from build_common import build_frontend, sync_embedded_web_assets; sync_embedded_web_assets(build_frontend(npm_ci=False))"
```

Expected: prints `--> Updating embedded web assets in …/src/ontotator/web (tracked in git!)`; `git status` shows a replaced `src/ontotator/web/assets/index-*.js` and `index-*.css` plus a changed `index.html`.

- [ ] **Step 4: Look at it once in the real app**

Run (repo root): `uv run python tests/browser_server.py`, open `http://127.0.0.1:18765/#token=browser-test-token`, import the package served at `http://127.0.0.1:18765/__synthetic_fixture__?scenario=many_proposals` (download it, then "Import work package"), choose mode "Review proposals" and open the case.

Check by eye: the sidebar scrolls as one list; section headers stick; every proposal shows the violet-magenta "✦ AI" badge and the badge is readable on selected and greyed-out (decided) entries; the proposal details show the badge before "Source:". Stop the server with Ctrl+C.

- [ ] **Step 5: Commit the assets**

```bash
git add src/ontotator/web
git commit -m "build: rebuild embedded web assets"
```

- [ ] **Step 6: Report**

Summarise: commits on `feat/sidebar-scroll-ai-badge`, test results from Steps 1–2 and Task 6, and anything from Step 4 that looked off. Do not merge or push; integration is decided by the user.
