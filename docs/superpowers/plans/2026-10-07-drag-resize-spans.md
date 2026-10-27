# Drag-Resize Spans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the annotator move the start or end of an existing mention segment directly in the text (mouse drag or keyboard) for the selected curated annotation.

**Architecture:** Frontend only. Pure edge logic lives in a new `frontend/src/spans/resize.ts`. The in-repo span editor (`frontend/src/vendor/spans.js`) renders resize handles for a set of "resizable" mentions, previews the drag locally and reports the result through a new `onResize` handler. `adapter.ts` converts UTF-16 spans to codepoint segments, `TextPane` passes props through, and `CaseScreen` sends the existing `edit_mention` command through the mutation queue. No backend, API or package-format change.

**Tech Stack:** React 18, TypeScript (+ one vendored plain-JS module), plain CSS, Vitest + Testing Library (jsdom), Playwright against the real backend.

**Spec:** `docs/superpowers/specs/2026-10-07-drag-resize-spans-design.md`

**Conventions**

- `npm`/`npx` commands run in `frontend/`; `uv`/`git` commands in the repo root.
- Commit style as in the repo (`feat(frontend): …`, `test(e2e): …`, `build: …`). Never add `Co-Authored-By` or "Generated with" lines.
- Offsets: the span editor and `resize.ts` work in **UTF-16** offsets into the document string. The domain model (`segments`) uses **codepoint** offsets. Conversion happens only in `adapter.ts` (`toCodepoint` / `toUtf16` from `spans/offsets.ts`).
- jsdom has no layout, no `caretPositionFromPoint` and no pointer capture. Mouse dragging is therefore covered by Playwright (Task 7); unit tests cover the pure logic, handle rendering and the keyboard path.
- Files have CRLF line endings in the working copy (`core.autocrlf`). Preserve them when editing with scripts.

## File structure

| File | Action | Responsibility |
|---|---|---|
| `frontend/src/spans/resize.ts` | create | Pure edge logic: `resizeSegment`, `stepOffset`, `wordBoundary` |
| `frontend/src/vendor/spans.js` | modify | Handles, drag/keyboard interaction, `setResizable`, `onResize` |
| `frontend/src/spans/adapter.ts` | modify | `onResize` callback in codepoints, `setResizable` on the handle |
| `frontend/src/editor/TextPane.tsx` | modify | Props `resizableEvidenceIds`, `onResizeMention`, `resyncToken` |
| `frontend/src/app/CaseScreen.tsx` | modify | Which mentions are resizable; send `edit_mention`; review sync |
| `frontend/src/styles.css` | modify | `.resize-handle` |
| `frontend/tests/resize.test.ts` | create | Unit tests for `resize.ts` |
| `frontend/tests/spanResize.test.ts` | create | Editor/adapter tests: handles, keyboard, selection offsets |
| `frontend/tests/caseResize.test.tsx` | create | CaseScreen tests: which mentions get handles, command sent |
| `frontend/browser/resize.spec.ts` | create | Real mouse drag, Escape, review copy |
| `src/ontotator/web/` | regenerate | Embedded SPA build |

---

### Task 0: Branch, commit spec and plan, baseline

- [ ] **Step 1: Branch and commit**

```bash
git switch -c feat/drag-resize-spans
git add docs/superpowers/specs/2026-10-07-drag-resize-spans-design.md docs/superpowers/plans/2026-10-07-drag-resize-spans.md
git commit -m "docs: spec and plan for resizing spans by dragging"
```

- [ ] **Step 2: Baseline**

Run (in `frontend/`): `npm ci && npm run typecheck && npm test`
Expected: no type errors, all suites pass (183 tests at the time of writing).

---

### Task 1: Pure edge logic (`resize.ts`)

**Files:**
- Create: `frontend/src/spans/resize.ts`
- Test: `frontend/tests/resize.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/resize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resizeSegment, stepOffset, wordBoundary } from "../src/spans/resize";

//            0         1         2
//            0123456789012345678901234
const TEXT = "severe muscular hypotonia";

describe("resizeSegment", () => {
  it("moves the start edge outwards and inwards", () => {
    expect(resizeSegment(TEXT, [{ start: 7, end: 15 }], 0, "start", 0)).toEqual([{ start: 0, end: 15 }]);
    expect(resizeSegment(TEXT, [{ start: 0, end: 15 }], 0, "start", 7)).toEqual([{ start: 7, end: 15 }]);
  });

  it("moves the end edge outwards and inwards", () => {
    expect(resizeSegment(TEXT, [{ start: 7, end: 15 }], 0, "end", 25)).toEqual([{ start: 7, end: 25 }]);
    expect(resizeSegment(TEXT, [{ start: 7, end: 25 }], 0, "end", 15)).toEqual([{ start: 7, end: 15 }]);
  });

  it("returns null when nothing changes", () => {
    expect(resizeSegment(TEXT, [{ start: 7, end: 15 }], 0, "end", 15)).toBeNull();
    expect(resizeSegment(TEXT, [{ start: 7, end: 15 }], 0, "start", 7)).toBeNull();
  });

  it("keeps at least one character: an edge cannot cross the other edge", () => {
    expect(resizeSegment(TEXT, [{ start: 7, end: 15 }], 0, "start", 22)).toEqual([{ start: 14, end: 15 }]);
    expect(resizeSegment(TEXT, [{ start: 7, end: 15 }], 0, "end", 2)).toEqual([{ start: 7, end: 8 }]);
  });

  it("trims whitespace at the moved edge", () => {
    // Dropping the end on the space after "muscular" keeps the end at "muscular".
    expect(resizeSegment(TEXT, [{ start: 7, end: 25 }], 0, "end", 16)).toEqual([{ start: 7, end: 15 }]);
    // Dropping the start on the space before "muscular" snaps to "muscular".
    expect(resizeSegment(TEXT, [{ start: 0, end: 15 }], 0, "start", 6)).toEqual([{ start: 7, end: 15 }]);
  });

  it("clamps to the text", () => {
    expect(resizeSegment(TEXT, [{ start: 7, end: 15 }], 0, "start", -5)).toEqual([{ start: 0, end: 15 }]);
    expect(resizeSegment(TEXT, [{ start: 7, end: 15 }], 0, "end", 999)).toEqual([{ start: 7, end: 25 }]);
  });

  it("merges with a neighbouring segment of the same mention when they touch or overlap", () => {
    const segments = [{ start: 0, end: 6 }, { start: 16, end: 25 }];
    expect(resizeSegment(TEXT, segments, 0, "end", 18)).toEqual([{ start: 0, end: 25 }]);
    expect(resizeSegment(TEXT, segments, 1, "start", 3)).toEqual([{ start: 0, end: 25 }]);
    // Separated by whitespace only: the space is trimmed, so they do not touch and both stay.
    expect(resizeSegment(TEXT, segments, 1, "start", 6)).toEqual([{ start: 0, end: 6 }, { start: 7, end: 25 }]);
    // Not touching: both segments stay.
    expect(resizeSegment(TEXT, segments, 0, "end", 15)).toEqual([{ start: 0, end: 15 }, { start: 16, end: 25 }]);
  });

  it("never places an edge inside a surrogate pair", () => {
    const text = "A😀B"; // UTF-16: A=0, 😀=1..3, B=3
    expect(resizeSegment(text, [{ start: 0, end: 1 }], 0, "end", 2)).toBeNull();
    expect(resizeSegment(text, [{ start: 0, end: 1 }], 0, "end", 3)).toEqual([{ start: 0, end: 3 }]);
    // Minimum length is one codepoint, not one UTF-16 unit.
    expect(resizeSegment(text, [{ start: 1, end: 4 }], 0, "end", 0)).toEqual([{ start: 1, end: 3 }]);
  });
});

describe("stepOffset", () => {
  it("steps by one codepoint and stops at the text bounds", () => {
    const text = "A😀B";
    expect(stepOffset(text, 1, 1)).toBe(3);
    expect(stepOffset(text, 3, -1)).toBe(1);
    expect(stepOffset(text, 0, -1)).toBe(0);
    expect(stepOffset(text, 4, 1)).toBe(4);
  });
});

describe("wordBoundary", () => {
  it("finds the next change between word and non-word characters", () => {
    expect(wordBoundary(TEXT, 7, 1)).toBe(15); // end of "muscular"
    expect(wordBoundary(TEXT, 15, 1)).toBe(16); // across the space
    expect(wordBoundary(TEXT, 15, -1)).toBe(7); // start of "muscular"
    expect(wordBoundary(TEXT, 7, -1)).toBe(6);
    expect(wordBoundary(TEXT, 0, -1)).toBe(0);
    expect(wordBoundary(TEXT, 25, 1)).toBe(25);
  });

  it("treats letters with diacritics and digits as word characters", () => {
    expect(wordBoundary("Muskelschwäche2 links", 0, 1)).toBe(15);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/resize.test.ts`
Expected: FAIL — cannot resolve `../src/spans/resize`.

- [ ] **Step 3: Implement**

Create `frontend/src/spans/resize.ts`:

```ts
/**
 * Edge logic for resizing a mention segment. All offsets are UTF-16 offsets
 * into the document text (the span editor's unit), not codepoints.
 */

export interface Span {
  start: number;
  end: number;
}

export type Edge = "start" | "end";

const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;
const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

/** Clamp to the text and move off the middle of a surrogate pair (backwards). */
function snap(text: string, offset: number): number {
  const clamped = Math.max(0, Math.min(text.length, Math.trunc(offset)));
  if (
    clamped > 0 && clamped < text.length
    && isLowSurrogate(text.charCodeAt(clamped)) && isHighSurrogate(text.charCodeAt(clamped - 1))
  ) {
    return clamped - 1;
  }
  return clamped;
}

/** The offset one codepoint before (-1) or after (1) `offset`, within the text. */
export function stepOffset(text: string, offset: number, direction: -1 | 1): number {
  const from = snap(text, offset);
  if (direction === 1) {
    if (from >= text.length) return text.length;
    return from + (isHighSurrogate(text.charCodeAt(from)) && from + 1 < text.length ? 2 : 1);
  }
  if (from <= 0) return 0;
  return from - (from >= 2 && isLowSurrogate(text.charCodeAt(from - 1)) ? 2 : 1);
}

const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;

function isWordAt(text: string, offset: number): boolean {
  const codepoint = text.codePointAt(offset);
  return codepoint !== undefined && WORD_CHAR.test(String.fromCodePoint(codepoint));
}

/**
 * The next position in `direction` where word characters (letters, digits)
 * meet other characters; the text bounds count as boundaries.
 */
export function wordBoundary(text: string, offset: number, direction: -1 | 1): number {
  let position = stepOffset(text, offset, direction);
  while (position > 0 && position < text.length) {
    const before = isWordAt(text, stepOffset(text, position, -1));
    const after = isWordAt(text, position);
    if (before !== after) break;
    position = stepOffset(text, position, direction);
  }
  return position;
}

function trimToVisible(text: string, span: Span): Span | null {
  let { start, end } = span;
  while (start < end && !text[start].trim()) start += 1;
  while (end > start && !text[end - 1].trim()) end -= 1;
  return end > start ? { start, end } : null;
}

function mergeTouching(spans: Span[]): Span[] {
  const sorted = spans.map((s) => ({ ...s })).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Span[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push(span);
  }
  return merged;
}

const sameSpans = (a: Span[], b: Span[]) =>
  a.length === b.length && a.every((span, i) => span.start === b[i].start && span.end === b[i].end);

/**
 * Move one edge of `segments[index]` to `offset`.
 *
 * The moved edge cannot cross the other edge (the segment keeps at least one
 * codepoint), whitespace at the edges is trimmed, and a segment that touches or
 * overlaps another segment of the same mention merges with it. Returns the new
 * segments (sorted), or null when the result equals the input.
 */
export function resizeSegment(
  text: string,
  segments: Span[],
  index: number,
  edge: Edge,
  offset: number,
): Span[] | null {
  const segment = segments[index];
  if (!segment) return null;
  const target = snap(text, offset);
  const moved: Span = edge === "start"
    ? { start: Math.min(target, stepOffset(text, segment.end, -1)), end: segment.end }
    : { start: segment.start, end: Math.max(target, stepOffset(text, segment.start, 1)) };
  const trimmed = trimToVisible(text, moved);
  if (!trimmed) return null;
  const result = mergeTouching(segments.map((s, i) => (i === index ? trimmed : s)));
  return sameSpans(result, mergeTouching(segments)) ? null : result;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/resize.test.ts`
Expected: PASS (all tests). If a single expectation is off by one, re-derive the expected value by hand from the `TEXT` ruler in the test before touching the implementation; fix whichever is actually wrong and note it in your report.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/spans/resize.ts frontend/tests/resize.test.ts
git commit -m "feat(frontend): edge logic for resizing mention segments"
```

---

### Task 2: Resize handles in the span editor

**Files:**
- Modify: `frontend/src/vendor/spans.js`
- Modify: `frontend/src/spans/adapter.ts`
- Modify: `frontend/src/styles.css` (after the `.run--hot` rule)
- Test: `frontend/tests/spanResize.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/spanResize.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountSpanEditor, type MentionDisplay } from "../src/spans/adapter";

const TEXT = "severe muscular hypotonia";
const MENTIONS: MentionDisplay[] = [
  { evidence_id: "ev-a", segments: [{ start: 7, end: 15 }], kind: "own" },
  { evidence_id: "ev-b", segments: [{ start: 0, end: 6 }, { start: 16, end: 25 }], kind: "own" },
];

describe("span editor resize handles", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  afterEach(() => {
    container.remove();
    vi.useRealTimers();
  });

  const mount = (onResize = vi.fn(), onSelection = vi.fn()) =>
    ({ handle: mountSpanEditor(container, TEXT, MENTIONS, onSelection, vi.fn(), undefined, onResize), onResize, onSelection });

  const handles = () => Array.from(container.querySelectorAll<HTMLElement>(".resize-handle"));
  const describeHandle = (el: HTMLElement) =>
    `${el.dataset.mention}:${el.dataset.segment}:${el.dataset.edge}@${el.dataset.offset}`;

  it("renders no handles until mentions are made resizable", () => {
    const { handle } = mount();
    expect(handles()).toEqual([]);
    handle.setResizable(["ev-a"]);
    expect(handles().map(describeHandle)).toEqual(["ev-a:0:start@7", "ev-a:0:end@15"]);
    handle.setResizable([]);
    expect(handles()).toEqual([]);
  });

  it("renders a pair of handles per segment of a discontinuous mention", () => {
    const { handle } = mount();
    handle.setResizable(["ev-b"]);
    expect(handles().map(describeHandle)).toEqual([
      "ev-b:0:start@0", "ev-b:0:end@6", "ev-b:1:start@16", "ev-b:1:end@25",
    ]);
  });

  it("keeps the text content and the handles' accessibility attributes intact", () => {
    const { handle } = mount();
    handle.setResizable(["ev-a"]);
    expect(container.textContent).toBe(TEXT);
    const [start, end] = handles();
    expect(start.getAttribute("role")).toBe("separator");
    expect(start.getAttribute("aria-label")).toBe("Start of mention");
    expect(end.getAttribute("aria-label")).toBe("End of mention");
    expect(start.tabIndex).toBe(0);
  });

  it("keeps handles after the mentions are updated", () => {
    const { handle } = mount();
    handle.setResizable(["ev-a"]);
    handle.setMentions([{ evidence_id: "ev-a", segments: [{ start: 0, end: 15 }], kind: "own" }]);
    expect(handles().map(describeHandle)).toEqual(["ev-a:0:start@0", "ev-a:0:end@15"]);
  });

  it("reports the same selection offsets with handles present", () => {
    const { handle, onSelection } = mount();
    handle.setResizable(["ev-a"]);
    // Select "muscular" (7..15): it starts and ends right next to the handles.
    const run = Array.from(container.querySelectorAll<HTMLElement>(".run")).find((r) => r.textContent === "muscular")!;
    const range = document.createRange();
    range.setStart(run.firstChild!, 0);
    range.setEnd(run.firstChild!, 8);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    container.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(onSelection).toHaveBeenCalledWith(expect.objectContaining({ segments: [{ start: 7, end: 15 }] }));
  });

  it("resolves a selection boundary that lands on a handle to the handle's offset", () => {
    const { handle, onSelection } = mount();
    handle.setResizable(["ev-a"]);
    const [start, end] = handles();
    const range = document.createRange();
    range.setStart(start, 0);
    range.setEnd(end, 0);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    container.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(onSelection).toHaveBeenCalledWith(expect.objectContaining({ segments: [{ start: 7, end: 15 }] }));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/spanResize.test.ts`
Expected: FAIL — `handle.setResizable is not a function`.

- [ ] **Step 3: Render handles in `spans.js`**

In the `SpanEditor` constructor, after `this.readOnly = false;` add:

```js
    this.resizableIds = new Set();
```

After `setMarkers(markers) { … }` add:

```js
  /** Mentions whose segments get draggable start/end handles. */
  setResizable(mentionIds) {
    this.resizableIds = new Set(mentionIds || []);
    this.render();
  }

  _handlesByOffset() {
    const starts = new Map();
    const ends = new Map();
    for (const mention of this.mentions) {
      if (!this.resizableIds.has(mention.mention_id)) continue;
      normaliseSpans(mention.spans || []).forEach((span, index) => {
        const base = { mentionId: mention.mention_id, index };
        starts.set(span.start, [...(starts.get(span.start) || []), { ...base, edge: "start", offset: span.start }]);
        ends.set(span.end, [...(ends.get(span.end) || []), { ...base, edge: "end", offset: span.end }]);
      });
    }
    return { starts, ends };
  }

  _handleNode(handle) {
    const node = document.createElement("span");
    node.className = `resize-handle resize-handle--${handle.edge}`;
    node.dataset.mention = handle.mentionId;
    node.dataset.segment = String(handle.index);
    node.dataset.edge = handle.edge;
    node.dataset.offset = String(handle.offset);
    node.tabIndex = 0;
    node.setAttribute("role", "separator");
    node.setAttribute("aria-label", handle.edge === "start" ? "Start of mention" : "End of mention");
    return node;
  }
```

In `render()`, directly before `for (const run of runs) {` add:

```js
    const { starts, ends } = this._handlesByOffset();
```

In the same loop, replace the last two statements of the loop body

```js
      node.appendChild(document.createTextNode(this.text.slice(run.start, run.end)));
      fragment.appendChild(node);
```

with

```js
      node.appendChild(document.createTextNode(this.text.slice(run.start, run.end)));
      for (const handle of starts.get(run.start) || []) fragment.appendChild(this._handleNode(handle));
      fragment.appendChild(node);
      for (const handle of ends.get(run.end) || []) fragment.appendChild(this._handleNode(handle));
```

(Every segment boundary is a run boundary, because `decomposeRuns` cuts at every span start and end, so each handle finds its run.)

In `_offsetOf(node, offset)`, make a handle resolve to its own offset. Replace the method with:

```js
  _offsetOf(node, offset) {
    let element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (element?.classList?.contains("resize-handle")) return Number(element.dataset.offset);
    while (element && element !== this.container && !element.classList?.contains("run")) {
      element = element.parentElement;
    }
    if (!element || element === this.container) return null;
    return Number(element.dataset.start) + offset;
  }
```

- [ ] **Step 4: Expose it through the adapter**

In `frontend/src/spans/adapter.ts`:

Add below `export type PickCallback …`:

```ts
export type ResizeCallback = (evidenceId: string, segments: CodepointSegment[]) => void;
```

Add to `SpanEditorHandle` (before `destroy`):

```ts
  /** Evidence ids whose segments get drag handles. */
  setResizable: (evidenceIds: string[]) => void;
```

Add a seventh parameter to `mountSpanEditor`:

```ts
  onInvalidMentions?: (evidenceIds: string[]) => void,
  onResize?: ResizeCallback,
): SpanEditorHandle {
```

In the `new SpanEditor(container, { … })` handlers object, after `onPick`, add:

```ts
    onResize: (mentionId: string, spans: Array<{ start: number; end: number }>) => {
      if (!onResize) return;
      try {
        onResize(mentionId, spans.map((span) => ({
          start: toCodepoint(text, span.start),
          end: toCodepoint(text, span.end),
        })));
      } catch {
        // an edge inside a surrogate pair cannot be expressed in codepoints: ignore
      }
    },
```

In the returned handle object, before `destroy`, add:

```ts
    setResizable: (evidenceIds: string[]) => {
      editor.setResizable(evidenceIds);
    },
```

- [ ] **Step 5: Style the handles**

In `frontend/src/styles.css`, after the `.mention-span.selected, .run--hot { … }` rule add:

```css
/* Drag handles at the edges of the selected annotation's mention segments. */
.resize-handle {
  position: relative;
  display: inline-block;
  width: 0;
  height: 1em;
  vertical-align: baseline;
  user-select: none;
  cursor: ew-resize;
  z-index: 2;
  touch-action: none;
}

/* Visible bar. */
.resize-handle::before {
  content: "";
  position: absolute;
  left: -2px;
  top: -0.35em;
  width: 3px;
  height: 1.6em;
  border-radius: 2px;
  background: #0284c7;
}

/* Wider invisible grab area. */
.resize-handle::after {
  content: "";
  position: absolute;
  left: -5px;
  top: -0.35em;
  width: 10px;
  height: 1.6em;
}

.resize-handle:focus-visible {
  outline: none;
}

.resize-handle:focus-visible::before {
  box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.45);
}

.text-container.resizing {
  user-select: none;
  cursor: ew-resize;
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm run typecheck && npx vitest run tests/spanResize.test.ts tests/spans.test.ts`
Expected: no type errors; both files pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/vendor/spans.js frontend/src/spans/adapter.ts frontend/src/styles.css frontend/tests/spanResize.test.ts
git commit -m "feat(frontend): resize handles on resizable mentions in the span editor"
```

---

### Task 3: Keyboard resizing

**Files:**
- Modify: `frontend/src/vendor/spans.js`
- Test: `frontend/tests/spanResize.test.ts`

Behaviour: with a handle focused, `ArrowLeft`/`ArrowRight` move that edge by one codepoint, with `Ctrl` to the next word boundary. The editor applies the change to its own copy of the mention immediately, keeps focus on the moved edge, and calls `onResize` once, 400 ms after the last key press or when focus leaves the handles.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe` block of `frontend/tests/spanResize.test.ts`:

```ts
  const press = (el: HTMLElement, key: string, init: KeyboardEventInit = {}) =>
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  const focused = () => document.activeElement as HTMLElement;

  it("moves the focused edge with the arrow keys and reports once after a pause", () => {
    vi.useFakeTimers();
    const { handle, onResize } = mount();
    handle.setResizable(["ev-a"]);
    handles()[1].focus(); // end of "muscular" at 15

    press(focused(), "ArrowLeft");
    press(focused(), "ArrowLeft");
    expect(describeHandle(focused())).toBe("ev-a:0:end@13");
    expect(onResize).not.toHaveBeenCalled();

    vi.advanceTimersByTime(399);
    expect(onResize).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledWith("ev-a", [{ start: 7, end: 13 }]);
  });

  it("jumps to the next word boundary with Ctrl", () => {
    vi.useFakeTimers();
    const { handle, onResize } = mount();
    handle.setResizable(["ev-a"]);
    handles()[0].focus(); // start of "muscular" at 7
    press(focused(), "ArrowLeft", { ctrlKey: true }); // 6: the space, trimmed away again -> no change
    expect(describeHandle(focused())).toBe("ev-a:0:start@7");
    press(focused(), "ArrowLeft", { ctrlKey: true });
    expect(describeHandle(focused())).toBe("ev-a:0:start@7");
    vi.advanceTimersByTime(400);
    expect(onResize).not.toHaveBeenCalled();

    handles()[1].focus();
    press(focused(), "ArrowRight", { ctrlKey: true }); // 16: space, trimmed -> unchanged
    press(focused(), "ArrowLeft", { ctrlKey: true }); // 7 would cross the start: clamped to one character
    expect(describeHandle(focused())).toBe("ev-a:0:end@8");
    vi.advanceTimersByTime(400);
    expect(onResize).toHaveBeenCalledWith("ev-a", [{ start: 7, end: 8 }]);
  });

  it("reports immediately when focus leaves the handle", () => {
    vi.useFakeTimers();
    const { handle, onResize } = mount();
    handle.setResizable(["ev-a"]);
    handles()[1].focus();
    press(focused(), "ArrowLeft");
    focused().dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }));
    expect(onResize).toHaveBeenCalledWith("ev-a", [{ start: 7, end: 14 }]);
    vi.advanceTimersByTime(400);
    expect(onResize).toHaveBeenCalledTimes(1);
  });

  it("does not let arrow keys on a handle reach global shortcuts", () => {
    const { handle } = mount();
    handle.setResizable(["ev-a"]);
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    try {
      handles()[1].focus();
      press(focused(), "ArrowLeft");
      expect(seen).not.toHaveBeenCalled();
      press(focused(), "a");
      expect(seen).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", seen);
    }
  });
```

(Walk-through of the Ctrl test, so a failure can be judged: the mention is "muscular" = 7..15. Ctrl+Left from the start edge at 7 gives word boundary 6; the candidate 6..15 starts with a space, is trimmed back to 7..15, and `resizeSegment` returns null — no change. From the end edge at 15, Ctrl+Right gives 16, trimmed back, no change; Ctrl+Left gives 7, which is clamped so that one character remains: 7..8.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/spanResize.test.ts`
Expected: the four new tests FAIL (focus stays on the original handle / `onResize` not called).

- [ ] **Step 3: Implement**

At the top of `frontend/src/vendor/spans.js`, after the header comment, add:

```js
import { resizeSegment, stepOffset, wordBoundary } from "../spans/resize";

/** Delay before a keyboard resize is reported, so several steps become one edit. */
const KEY_RESIZE_COMMIT_MS = 400;
```

In the constructor, after `this.resizableIds = new Set();` add:

```js
    this._pendingKeyResize = null;
    this._keyResizeTimer = null;
    this._onFocusOutBound = (e) => this._onFocusOut(e);
    container.addEventListener("focusout", this._onFocusOutBound);
```

In `destroy()` add:

```js
    this.container.removeEventListener("focusout", this._onFocusOutBound);
    clearTimeout(this._keyResizeTimer);
```

Add these methods after `_handleNode`:

```js
  _spansOf(mentionId) {
    const mention = this.mentions.find((m) => m.mention_id === mentionId);
    return mention ? normaliseSpans(mention.spans || []) : null;
  }

  /** Replace a mention's spans in the editor's own copy and redraw. */
  _applySpans(mentionId, spans) {
    this.mentions = this.mentions.map((m) => (m.mention_id === mentionId
      ? { ...m, spans: spans.map((s) => ({ char_start: s.start, char_end: s.end })) }
      : m));
    this.render();
  }

  _findHandle(mentionId, edge, offset) {
    return Array.from(this.container.querySelectorAll(".resize-handle")).find((node) =>
      node.dataset.mention === mentionId && node.dataset.edge === edge && Number(node.dataset.offset) === offset);
  }

  _flushKeyResize() {
    clearTimeout(this._keyResizeTimer);
    this._keyResizeTimer = null;
    const pending = this._pendingKeyResize;
    this._pendingKeyResize = null;
    if (pending) this.handlers.onResize?.(pending.mentionId, pending.spans);
  }

  _onHandleKey(event, handle) {
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    const mentionId = handle.dataset.mention;
    const edge = handle.dataset.edge;
    const index = Number(handle.dataset.segment);
    const from = Number(handle.dataset.offset);
    const spans = this._spansOf(mentionId);
    if (!spans) return;
    const to = (event.ctrlKey || event.metaKey)
      ? wordBoundary(this.text, from, direction)
      : stepOffset(this.text, from, direction);
    const next = resizeSegment(this.text, spans, index, edge, to);
    if (!next) return;
    // The moved edge of the (possibly merged) segment that now contains the old one.
    const anchor = edge === "start" ? spans[index].end - 1 : spans[index].start;
    const segment = next.find((s) => s.start <= anchor && anchor < s.end) || next[0];
    this._refocusing = true;
    this._applySpans(mentionId, next);
    this._findHandle(mentionId, edge, edge === "start" ? segment.start : segment.end)?.focus();
    this._refocusing = false;
    this._pendingKeyResize = { mentionId, spans: next };
    clearTimeout(this._keyResizeTimer);
    this._keyResizeTimer = setTimeout(() => this._flushKeyResize(), KEY_RESIZE_COMMIT_MS);
  }

  _onFocusOut(event) {
    if (this._refocusing || !this._pendingKeyResize) return;
    if (event.relatedTarget?.classList?.contains("resize-handle")
      && event.relatedTarget.dataset.mention === this._pendingKeyResize.mentionId) return;
    this._flushKeyResize();
  }
```

Replace the existing `_onKeyDown(event)` with:

```js
  _onKeyDown(event) {
    const handle = event.target?.closest?.(".resize-handle");
    if (handle && (event.key === "ArrowLeft" || event.key === "ArrowRight")
      && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      this._onHandleKey(event, handle);
      return;
    }
    if (event.shiftKey && /^(Arrow|Home$|End$|PageUp$|PageDown$)/.test(event.key)) {
      this._keySelecting = true;
    }
  }
```

Finally, an update from outside must win over an unreported keyboard change. Replace `setMentions(mentions)` with:

```js
  setMentions(mentions) {
    clearTimeout(this._keyResizeTimer);
    this._keyResizeTimer = null;
    this._pendingKeyResize = null;
    this.mentions = mentions || [];
    this.render();
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run typecheck && npx vitest run tests/spanResize.test.ts tests/spans.test.ts`
Expected: no type errors; all tests pass.

If `tsc` cannot type the import of `../spans/resize` from the `.js` file, check `allowJs` in `frontend/tsconfig.json` (it is `true`); do not add `// @ts-nocheck`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/vendor/spans.js frontend/tests/spanResize.test.ts
git commit -m "feat(frontend): resize mention edges with the arrow keys"
```

---

### Task 4: Mouse dragging

**Files:**
- Modify: `frontend/src/vendor/spans.js`
- Test: `frontend/tests/spanResize.test.ts` (logic that jsdom can exercise); real dragging in Task 7

Design: `pointerdown` on a handle starts a drag and captures the pointer on the **container** (handles are re-created on every redraw, so they cannot hold the capture). Each `pointermove` maps the pointer position to a text offset with `caretPositionFromPoint` (fallback `caretRangeFromPoint`), computes `resizeSegment(original, …)` — always from the original spans, never incrementally — and redraws a preview. `pointerup` applies the result to the editor's own copy and calls `onResize`. `Escape` or `pointercancel` restores the original. `preventDefault()` on `pointerdown` suppresses the compatibility mouse events, so no text selection starts and `_onMouseUp` does not fire.

- [ ] **Step 1: Write the failing tests**

jsdom has no `PointerEvent` constructor in all versions and no caret-from-point API, so the tests stub the offset lookup. Append inside the `describe` block:

```ts
  const pointer = (type: string, target: EventTarget, init: MouseEventInit = {}) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 0, clientY: 0, ...init });
    Object.defineProperty(event, "pointerId", { value: 1 });
    target.dispatchEvent(event);
    return event;
  };
  /** Make the editor resolve every pointer position to `offset`. */
  const pointAt = (offset: number | null) => {
    (document as any).caretPositionFromPoint = () => {
      if (offset === null) return null;
      const runs = Array.from(container.querySelectorAll<HTMLElement>(".run"));
      const run = runs.find((r) => Number(r.dataset.start) <= offset
        && offset <= Number(r.dataset.start) + r.textContent!.length)!;
      return { offsetNode: run.firstChild, offset: offset - Number(run.dataset.start) };
    };
  };
  const markedText = () => Array.from(container.querySelectorAll(".run--marked")).map((r) => r.textContent).join("|");

  it("previews a drag, reports it on release and suppresses the text selection handler", () => {
    const { handle, onResize, onSelection } = mount();
    handle.setMentions([MENTIONS[0]]);
    handle.setResizable(["ev-a"]);
    container.setPointerCapture = vi.fn();
    container.releasePointerCapture = vi.fn();

    const down = pointer("pointerdown", handles()[1]);
    expect(down.defaultPrevented).toBe(true);
    expect(container.classList.contains("resizing")).toBe(true);

    pointAt(25);
    pointer("pointermove", container);
    expect(markedText()).toBe("muscular hypotonia");
    expect(onResize).not.toHaveBeenCalled();

    pointAt(null); // pointer outside the text: keep the last valid edge
    pointer("pointermove", container);
    expect(markedText()).toBe("muscular hypotonia");

    pointer("pointerup", container);
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledWith("ev-a", [{ start: 7, end: 25 }]);
    expect(container.classList.contains("resizing")).toBe(false);
    expect(markedText()).toBe("muscular hypotonia");
    expect(onSelection).not.toHaveBeenCalled();
  });

  it("restores the original span on Escape and reports nothing", () => {
    const { handle, onResize } = mount();
    handle.setMentions([MENTIONS[0]]);
    handle.setResizable(["ev-a"]);
    container.setPointerCapture = vi.fn();
    container.releasePointerCapture = vi.fn();
    const outer = vi.fn();
    window.addEventListener("keydown", outer);
    try {
      pointer("pointerdown", handles()[0]);
      pointAt(0);
      pointer("pointermove", container);
      expect(markedText()).toBe("severe muscular");
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      expect(markedText()).toBe("muscular");
      expect(outer).not.toHaveBeenCalled();
      pointer("pointerup", container);
      expect(onResize).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", outer);
    }
  });

  it("reports nothing when the edge ends where it started", () => {
    const { handle, onResize } = mount();
    handle.setMentions([MENTIONS[0]]);
    handle.setResizable(["ev-a"]);
    container.setPointerCapture = vi.fn();
    container.releasePointerCapture = vi.fn();
    pointer("pointerdown", handles()[1]);
    pointAt(25);
    pointer("pointermove", container);
    pointAt(15);
    pointer("pointermove", container);
    pointer("pointerup", container);
    expect(onResize).not.toHaveBeenCalled();
    expect(markedText()).toBe("muscular");
  });

  it("cancels a drag when the mentions are replaced from outside", () => {
    const { handle, onResize } = mount();
    handle.setMentions([MENTIONS[0]]);
    handle.setResizable(["ev-a"]);
    container.setPointerCapture = vi.fn();
    container.releasePointerCapture = vi.fn();
    pointer("pointerdown", handles()[1]);
    pointAt(25);
    pointer("pointermove", container);
    handle.setMentions([{ evidence_id: "ev-a", segments: [{ start: 0, end: 6 }], kind: "own" }]);
    expect(markedText()).toBe("severe");
    pointer("pointerup", container);
    expect(onResize).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/spanResize.test.ts`
Expected: the four new tests FAIL (first assertion: `down.defaultPrevented` is false).

- [ ] **Step 3: Implement**

In the constructor, after the `focusout` registration from Task 3, add:

```js
    this._drag = null;
    this._onPointerDownBound = (e) => this._onPointerDown(e);
    this._onPointerMoveBound = (e) => this._onPointerMove(e);
    this._onPointerUpBound = (e) => this._endDrag(e, true);
    this._onPointerCancelBound = (e) => this._endDrag(e, false);
    this._onDragKeyBound = (e) => this._onDragKey(e);
    container.addEventListener("pointerdown", this._onPointerDownBound);
    container.addEventListener("pointermove", this._onPointerMoveBound);
    container.addEventListener("pointerup", this._onPointerUpBound);
    container.addEventListener("pointercancel", this._onPointerCancelBound);
```

In `destroy()` add:

```js
    this.container.removeEventListener("pointerdown", this._onPointerDownBound);
    this.container.removeEventListener("pointermove", this._onPointerMoveBound);
    this.container.removeEventListener("pointerup", this._onPointerUpBound);
    this.container.removeEventListener("pointercancel", this._onPointerCancelBound);
    window.removeEventListener("keydown", this._onDragKeyBound, true);
```

Add these methods after `_onFocusOut`:

```js
  /** Text offset under a viewport point, or null outside the text. */
  _offsetAtPoint(x, y) {
    let node = null;
    let offset = 0;
    if (document.caretPositionFromPoint) {
      const position = document.caretPositionFromPoint(x, y);
      if (position) { node = position.offsetNode; offset = position.offset; }
    } else if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(x, y);
      if (range) { node = range.startContainer; offset = range.startOffset; }
    }
    if (!node || !this.container.contains(node)) return null;
    return this._offsetOf(node, offset);
  }

  _onPointerDown(event) {
    const handle = event.target?.closest?.(".resize-handle");
    if (!handle || this.readOnly || event.button > 0) return;
    const mentionId = handle.dataset.mention;
    const original = this._spansOf(mentionId);
    if (!original) return;
    // No text selection, no compatibility mouse events (and so no paint) for this gesture.
    event.preventDefault();
    this._flushKeyResize();
    this._drag = {
      mentionId,
      index: Number(handle.dataset.segment),
      edge: handle.dataset.edge,
      original,
      current: null,
      pointerId: event.pointerId,
    };
    this.container.classList.add("resizing");
    this.container.setPointerCapture?.(event.pointerId);
    window.addEventListener("keydown", this._onDragKeyBound, true);
  }

  _onPointerMove(event) {
    const drag = this._drag;
    if (!drag) return;
    const offset = this._offsetAtPoint(event.clientX, event.clientY);
    if (offset === null) return; // outside the text: keep the last valid edge
    const next = resizeSegment(this.text, drag.original, drag.index, drag.edge, offset);
    const shown = drag.current || drag.original;
    const target = next || drag.original;
    if (JSON.stringify(shown) === JSON.stringify(target)) return;
    drag.current = next;
    this._applySpans(drag.mentionId, target);
  }

  _stopDrag() {
    const drag = this._drag;
    this._drag = null;
    this.container.classList.remove("resizing");
    window.removeEventListener("keydown", this._onDragKeyBound, true);
    if (drag) {
      try { this.container.releasePointerCapture?.(drag.pointerId); } catch { /* already released */ }
    }
    return drag;
  }

  _endDrag(event, commit) {
    const drag = this._stopDrag();
    if (!drag) return;
    if (commit && drag.current) {
      this.handlers.onResize?.(drag.mentionId, drag.current);
    } else if (drag.current) {
      this._applySpans(drag.mentionId, drag.original);
    }
  }

  _onDragKey(event) {
    if (event.key !== "Escape" || !this._drag) return;
    // Captured on window, so the case screen's own Escape (deselect) never sees it.
    event.preventDefault();
    event.stopImmediatePropagation();
    this._endDrag(event, false);
  }
```

A drag must not survive a mention update from outside. In `setMentions`, add as the first statement:

```js
    this._stopDrag();
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run typecheck && npx vitest run tests/spanResize.test.ts tests/spans.test.ts`
Expected: no type errors; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/vendor/spans.js frontend/tests/spanResize.test.ts
git commit -m "feat(frontend): drag mention edges with the mouse"
```

---

### Task 5: Pass resizing through `TextPane`

**Files:**
- Modify: `frontend/src/editor/TextPane.tsx`
- Test: `frontend/tests/spanResize.test.ts` is unaffected; `TextPane` is covered through `CaseScreen` in Task 6

- [ ] **Step 1: Add the props**

In `TextPaneProps` add:

```ts
  /** Mentions whose segment edges can be dragged. */
  resizableEvidenceIds?: string[];
  onResizeMention?: (evidenceId: string, segments: Array<{ start: number; end: number }>) => void;
  /** Change this to force the text back to the given mentions (after a failed save). */
  resyncToken?: number;
```

Destructure them in the component parameters:

```ts
  resizableEvidenceIds,
  onResizeMention,
  resyncToken = 0,
```

- [ ] **Step 2: Wire them to the editor**

Replace

```ts
  const callbacks = useRef({ onSelection, onPick });
  callbacks.current = { onSelection, onPick };
```

with

```ts
  const callbacks = useRef({ onSelection, onPick, onResizeMention });
  callbacks.current = { onSelection, onPick, onResizeMention };
  const resizableKey = (resizableEvidenceIds ?? []).join("\u001f");
  const latestResizable = useRef<string[]>([]);
  latestResizable.current = resizableEvidenceIds ?? [];
```

In the mount effect, replace the `mountSpanEditor(…)` call with:

```ts
    const handle = mountSpanEditor(
      containerRef.current,
      text,
      mentions,
      (payload) => callbacks.current.onSelection(payload),
      (evidenceId) => callbacks.current.onPick(evidenceId),
      (ids) => reportInvalid.current(ids),
      (evidenceId, segments) => callbacks.current.onResizeMention?.(evidenceId, segments),
    );
    handle.setResizable(latestResizable.current);
```

Change the dependency list of the "Sync mentions" effect from `[signature]` to `[signature, resyncToken]`.

After the "Sync mentions" effect add:

```ts
  // Sync which mentions show drag handles
  useEffect(() => {
    handleRef.current?.setResizable(latestResizable.current);
  }, [resizableKey]);
```

(Order matters only in that the mount effect has already created the handle; both effects run after it on the first render.)

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm test`
Expected: no type errors, all suites pass (nothing uses the new props yet).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/editor/TextPane.tsx
git commit -m "feat(frontend): pass resizable mentions and resize events through the text pane"
```

---

### Task 6: `CaseScreen` — which mentions, and saving

**Files:**
- Modify: `frontend/src/app/CaseScreen.tsx`
- Test: `frontend/tests/caseResize.test.tsx`

Rules (from the spec): handles on all mentions of the **selected curated annotation** whose layer is editable; none while "+ Add Mention" waits for a selection or a new annotation is pending; none for proposals and references (they are never the selected curated annotation). Saving sends `edit_mention` with `annotation_id` through `mutateAnnotationAndSyncDecision`, the same path `handleDetachMention` uses, so an adopted copy is recorded as "changed" and an explicit rejection is left alone.

Backend detail to respect: when the evidence is shared by several annotations, `edit_mention` with `annotation_id` creates a copy with a new id `<old id>-cow-<hex>` for that annotation (`src/ontotator/application/editing.py`, `_edit_mention`). The selection must follow that id.

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/caseResize.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { CaseScreen, type WorkspaceView } from "../src/app/CaseScreen";

const TEXT = "severe muscular hypotonia";
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
    axes: [{ id: "assertion", label: "Assertion", options: ["present", "absent"], allow_empty: true }],
  }],
}];

const snapshot = (annotationId: string, termId: string, segments: Array<{ start: number; end: number }>,
  provenance: any = { actor: { actor_id: "dr-a", kind: "human" }, method: "manual" }) => ({
  schema_version: "ontotator-annotation/v3" as const,
  annotation: {
    annotation_id: annotationId, document_id: "doc", layer_id: "phenotype", type_id: "default", term_id: termId,
    axes_values: { assertion: "present" },
    evidence_refs: [{ evidence_id: `ev-${annotationId}`, version: "ev-v" }],
    provenance,
  },
  evidence: [{
    mention: { evidence_id: `ev-${annotationId}`, segments, cue_segments: [] },
    version: "ev-v", document_id: "doc", text_sha256: "text",
  }],
  version: `${annotationId}-v1`, document_id: "doc", text_sha256: "text",
  ontology_sha256: "ontology", layer_config_sha256: "layer-sha",
});

const makeView = (mode: "independent" | "review", annotations: any[], inputs: any[] = []): WorkspaceView => {
  const key = { package_id: "pkg", document_id: "doc", annotator_id: "dr-a", mode, scope_id: "scope-default", target_set_id: "t" };
  const targets = { target_set_id: "t", targets: inputs.map((s) => ({ annotation_id: s.annotation.annotation_id, version: s.version })) };
  return {
    key,
    scope: { scope_id: "scope-default", mode, editable_layer_ids: ["phenotype"], reference_layer_ids: [] },
    layers,
    ontologies: [{ ontology_id: "hp", release: "r", label: "HPO", sha256: "s", format: "obo-graph-json" as const }],
    checked_layer_ids: [],
    document: { document_id: "doc", text: TEXT, language: "en", text_sha256: "text" },
    targets,
    available_inputs: inputs,
    submissions: [],
    term_statuses: {},
    axes_definition: "editor-axes/v1",
    axes_config: [{ id: "assertion", label: "Assertion", options: ["present", "absent"], allow_empty: true }],
    axes_config_sha256: "sha-axes",
    draft: {
      key, targets, revision: 0, annotations,
      evidence: annotations.flatMap((a) => a.evidence), decisions: [], checked_layer_ids: [],
    },
  } as WorkspaceView;
};

const handleKeys = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>(".resize-handle"))
    .map((el) => `${el.dataset.mention}:${el.dataset.edge}`);
const entry = (container: HTMLElement, key: string) =>
  Array.from(container.querySelectorAll<HTMLElement>("[data-list-key]")).find((el) => el.dataset.listKey === key)!;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("resizing mentions in the case screen", () => {
  const own = snapshot("a1", "HP:0001", [{ start: 7, end: 15 }]);
  const other = snapshot("a2", "HP:0002", [{ start: 16, end: 25 }]);

  it("shows handles only for the selected curated annotation", () => {
    const { container } = render(<CaseScreen view={makeView("independent", [own, other])} workspaceId="ws" onClose={vi.fn()} />);
    expect(handleKeys(container)).toEqual([]);
    fireEvent.click(entry(container, "annotation:a1"));
    expect(handleKeys(container)).toEqual(["ev-a1:start", "ev-a1:end"]);
    fireEvent.click(entry(container, "annotation:a2"));
    expect(handleKeys(container)).toEqual(["ev-a2:start", "ev-a2:end"]);
    fireEvent.click(entry(container, "annotation:a2")); // deselect
    expect(handleKeys(container)).toEqual([]);
  });

  it("shows no handles for a selected review proposal", () => {
    const proposal = snapshot("prop", "HP:0003", [{ start: 0, end: 6 }],
      { actor: { actor_id: "pheno-nlp", kind: "tool" }, method: "llm" });
    const { container } = render(<CaseScreen view={makeView("review", [], [proposal])} workspaceId="ws" onClose={vi.fn()} />);
    fireEvent.click(Array.from(container.querySelectorAll<HTMLElement>("[data-list-key^='target:']"))[0]);
    expect(container.querySelector(".run--hot")).not.toBeNull();
    expect(handleKeys(container)).toEqual([]);
  });

  it("hides the handles while a mention is being attached", () => {
    const { container } = render(<CaseScreen view={makeView("independent", [own])} workspaceId="ws" onClose={vi.fn()} />);
    fireEvent.click(entry(container, "annotation:a1"));
    expect(handleKeys(container).length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: /Add Mention/i }));
    expect(handleKeys(container)).toEqual([]);
  });

  it("saves a keyboard resize as edit_mention with codepoint segments", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const view = makeView("independent", [own]);
    const resized = {
      ...view.draft, revision: 1,
      evidence: [{ ...own.evidence[0], mention: { ...own.evidence[0].mention, segments: [{ start: 7, end: 14 }] } }],
    };
    const apply = vi.spyOn(api, "applyCommand").mockResolvedValue(resized as any);
    const { container } = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    fireEvent.click(entry(container, "annotation:a1"));
    const end = container.querySelector<HTMLElement>(".resize-handle--end")!;
    end.focus();
    fireEvent.keyDown(end, { key: "ArrowLeft" });
    vi.advanceTimersByTime(400);
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(apply).toHaveBeenCalledWith("ws", expect.objectContaining({
      expected_revision: 0,
      payload: { command: "edit_mention", annotation_id: "a1", evidence_id: "ev-a1", segments: [{ start: 7, end: 14 }] },
    }));
  });

  it("puts the text back when saving the resize fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(api, "applyCommand").mockRejectedValue(new Error("boom"));
    const { container } = render(<CaseScreen view={makeView("independent", [own])} workspaceId="ws" onClose={vi.fn()} />);
    fireEvent.click(entry(container, "annotation:a1"));
    const marked = () => Array.from(container.querySelectorAll(".run--marked")).map((r) => r.textContent).join("|");
    expect(marked()).toBe("muscular");
    const end = container.querySelector<HTMLElement>(".resize-handle--end")!;
    end.focus();
    fireEvent.keyDown(end, { key: "ArrowLeft" });
    expect(marked()).toBe("muscula");
    vi.advanceTimersByTime(400);
    await waitFor(() => expect(marked()).toBe("muscular"));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/caseResize.test.tsx`
Expected: FAIL — the first test finds no handles after selecting `a1` (`expected [] to deeply equal [ 'ev-a1:start', 'ev-a1:end' ]`).

If instead a test fails earlier because an entry or button is not found, compare the fixture with `frontend/tests/sidebar.test.tsx` (same view shape) and fix the fixture or selector, not the product code. The "Add Mention" button lives in `frontend/src/editor/AnnotationPanel.tsx`; use its actual accessible name.

- [ ] **Step 3: Implement in `CaseScreen.tsx`**

Add state next to the other `useState` calls (e.g. after `isAttachingMention`):

```tsx
  const [textResyncToken, setTextResyncToken] = useState(0);
```

Add the handler directly after `handleDetachMention`:

```tsx
  // A mention edge was dragged (or moved by keyboard) in the text.
  const handleResizeMention = async (evidenceId: string, segments: Array<{ start: number; end: number }>) => {
    const annId = selectedAnnotationId;
    if (!annId) return;
    try {
      const updated = await mutateAnnotationAndSyncDecision(annId, () =>
        enqueueMutation({
          command: "edit_mention",
          annotation_id: annId,
          evidence_id: evidenceId,
          segments,
        })
      );
      // Shared evidence is copied on write and gets a new id: keep the selection on it.
      const refs = (updated.annotations ?? []).find((a) => a.annotation.annotation_id === annId)
        ?.annotation.evidence_refs ?? [];
      if (selectedEvidenceId === evidenceId && !refs.some((r) => r.evidence_id === evidenceId)) {
        setSelectedEvidenceId(refs.find((r) => r.evidence_id.startsWith(`${evidenceId}-cow-`))?.evidence_id ?? null);
      }
    } catch (error) {
      // The text already shows the new edge: put it back to the saved state.
      setTextResyncToken((token) => token + 1);
      reportError(error);
    }
  };
```

Directly after the line `const editableLayerIds = view.scope?.editable_layer_ids ?? …;` add:

```tsx
  // Only the selected curated annotation's mentions can be resized, and not while
  // another text interaction (attaching a mention, choosing a term) is in progress.
  const resizableEvidenceIds = selectedAnnotation && !isAttachingMention && !pendingAnnotation
    && editableLayerIds.includes(selectedAnnotation.annotation.layer_id)
    ? (selectedAnnotation.annotation.evidence_refs ?? []).map((r) => r.evidence_id)
    : [];
```

Pass the new props to `<TextPane … />`:

```tsx
          resizableEvidenceIds={resizableEvidenceIds}
          onResizeMention={(evidenceId, segments) => { void handleResizeMention(evidenceId, segments); }}
          resyncToken={textResyncToken}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run typecheck && npm test`
Expected: no type errors; all suites pass, including the five new tests.

Note on the failure test: `mutateAnnotationAndSyncDecision` rejects, `handleResizeMention` bumps `textResyncToken`, and `TextPane`'s sync effect pushes the unchanged saved mentions back into the editor.

- [ ] **Step 5: Add the shortcut to the help dialog**

In `CaseScreen.tsx`, find the `SHORTCUTS` array and add one entry in the same shape as its neighbours (keys / description; not `reviewOnly`):

```tsx
  { keys: "← / →  (Ctrl: by word)", description: "Move the focused mention edge (Tab to an edge handle of the selected annotation)" },
```

Run: `npm run typecheck && npm test`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/CaseScreen.tsx frontend/tests/caseResize.test.tsx
git commit -m "feat(frontend): resize the selected annotation's mentions and save them as edit_mention"
```

---

### Task 7: Real-browser tests

**Files:**
- Create: `frontend/browser/resize.spec.ts`

The default fixture text is `"Hypotonia and seizure. A😀é\r\nB"`; "Hypotonia" is 0..9 and "seizure" is 14..21 (see `tests/browser_server.py`). `selectText` and `mentionWithOffsets` are in `frontend/browser/helpers.ts`; the mention's offsets are shown as the tooltip of `.mention-snippet`.

- [ ] **Step 1: Write the tests**

Create `frontend/browser/resize.spec.ts`:

```ts
import { expect, test, type Locator, type Page } from "@playwright/test";
import { importPackage, mentionWithOffsets, openCase, selectText } from "./helpers";

const importFixture = (page: Page, annotator: string) => importPackage(page, "", "browser-fixture", annotator);
const revision = (page: Page) => page.locator(".status-badge");

/** Viewport point just inside the left edge of the character at `offset` (UTF-16) of the document text. */
async function pointAtOffset(page: Page, offset: number): Promise<{ x: number; y: number }> {
  return page.locator(".text-container").evaluate((container, target) => {
    for (const run of Array.from(container.querySelectorAll<HTMLElement>(".run"))) {
      const start = Number(run.dataset.start);
      const node = run.firstChild;
      const length = node?.textContent?.length ?? 0;
      if (node && start <= target && target < start + length) {
        const range = document.createRange();
        range.setStart(node, target - start);
        range.setEnd(node, target - start + 1);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + 1, y: rect.top + rect.height / 2 };
      }
    }
    throw new Error(`no character at offset ${target}`);
  }, offset);
}

async function dragHandle(page: Page, handle: Locator, toOffset: number, release = true) {
  const box = (await handle.boundingBox())!;
  const target = await pointAtOffset(page, toOffset);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  if (release) await page.mouse.up();
}

/** Create an annotation "Hypotonia" on 0..9 in an independent case; it stays selected. */
async function createHypotonia(page: Page, annotator: string) {
  await importFixture(page, annotator);
  await page.locator("#mode-select").selectOption("independent");
  await openCase(page, { identity: annotator });
  await selectText(page, 0, 9);
  await page.getByLabel(/Search ontology term/i).fill("Hypotonia");
  await page.locator(".candidate-card").filter({ hasText: "HP:0001252" }).click();
  await expect(revision(page)).toHaveAttribute("title", "Revision 1");
  await expect(mentionWithOffsets(page, "[0:9]")).toBeVisible();
}

test.describe("resizing mention spans", () => {
  test("dragging the end handle extends the mention and saves once", async ({ page }) => {
    await createHypotonia(page, "resize-drag");
    const handles = page.locator(".text-container .resize-handle");
    await expect(handles).toHaveCount(2);

    // Drop inside "seizure" after "sei": offset 17.
    await dragHandle(page, page.locator(".resize-handle--end"), 17);
    await expect(revision(page)).toHaveAttribute("title", "Revision 2");
    await expect(mentionWithOffsets(page, "[0:17]")).toHaveText("“Hypotonia and sei”");
    await expect(page.locator(".text-container .run--marked")).toHaveText("Hypotonia and sei");

    // Dragging the start handle inwards shortens it: start at "t" of "Hypotonia" (offset 4).
    await dragHandle(page, page.locator(".resize-handle--start"), 4);
    await expect(revision(page)).toHaveAttribute("title", "Revision 3");
    await expect(mentionWithOffsets(page, "[4:17]")).toBeVisible();

    // Dragging did not start a new annotation.
    await expect(page.getByLabel("New Annotation")).toHaveCount(0);
    await expect(page.locator(".sidebar [data-list-key^='annotation:']")).toHaveCount(1);
  });

  test("Escape during a drag restores the span and saves nothing", async ({ page }) => {
    await createHypotonia(page, "resize-escape");
    await dragHandle(page, page.locator(".resize-handle--end"), 17, false);
    await expect(page.locator(".text-container .run--marked")).toHaveText("Hypotonia and sei");
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(page.locator(".text-container .run--marked")).toHaveText("Hypotonia");
    await expect(revision(page)).toHaveAttribute("title", "Revision 1");
    await expect(mentionWithOffsets(page, "[0:9]")).toBeVisible();
    // Escape cancelled the drag only; the annotation is still selected.
    await expect(page.locator(".text-container .resize-handle")).toHaveCount(2);
  });

  test("keyboard: arrow keys move the focused edge and save after a pause", async ({ page }) => {
    await createHypotonia(page, "resize-keys");
    await page.locator(".resize-handle--end").focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(mentionWithOffsets(page, "[0:7]")).toBeVisible();
    await expect(revision(page)).toHaveAttribute("title", "Revision 2");
  });

  test("selecting text still works next to a mention with handles", async ({ page }) => {
    await createHypotonia(page, "resize-select");
    await selectText(page, 14, 21);
    await expect(page.getByLabel("New Annotation")).toBeVisible();
    await expect(revision(page)).toHaveAttribute("title", "Revision 1");
  });

  test("review: resizing an adopted copy marks the proposal as replaced", async ({ page }) => {
    await importFixture(page, "resize-review");
    await page.locator("#mode-select").selectOption("review");
    await openCase(page, { identity: "resize-review" });
    await page.locator(".doc-item").filter({ hasText: "HP:0001250" }).click();
    // A proposal has no handles ...
    await expect(page.locator(".text-container .resize-handle")).toHaveCount(0);
    // ... its adopted copy has.
    await page.getByRole("button", { name: /Edit & Replace/i }).click();
    await expect(page.locator(".text-container .resize-handle")).toHaveCount(2);
    await dragHandle(page, page.locator(".resize-handle--start"), 10); // include "and "
    await expect(mentionWithOffsets(page, "[10:21]")).toBeVisible();
    await expect(page.locator("[data-list-key^='target:']").filter({ hasText: "HP:0001250" })).toContainText("Replaced");
  });
});
```

- [ ] **Step 2: Run**

Run (in `frontend/`): `npm run build && npx playwright test browser/resize.spec.ts`
Expected: PASS (5 tests).

How to judge failures:
- **Handle cannot be grabbed / `boundingBox()` has zero width:** the handle element itself is zero-width by design; its grab area is the `::after` pseudo-element. Use the centre of the element's box (x = box.x, since width is 0) — the 10 px grab area is centred on it. If the pointer still misses, the CSS from Task 2 Step 5 is not applied; inspect with `page.pause()` or a screenshot.
- **Drag does nothing:** check that `pointerdown` reaches `.resize-handle` (not a `.run` on top of it): the handle has `z-index: 2`.
- **Offsets differ by one:** the drop point is just inside the *left* edge of the character at the target offset, so the caret resolves to that offset. If Chromium resolves to the neighbouring offset, move the point by one more pixel in `pointAtOffset`; do not change the product code for a test-geometry issue.
- **Review test:** the button's accessible name is whatever `ReviewActions.tsx` renders for the "edit" decision ("Edit & Replace" at the time of writing). If adopting asks for confirmation or needs a further click, follow the existing review flow in `frontend/browser/workflow.spec.ts`.
- A genuine product failure (handles missing, wrong offsets saved, a new annotation started by a drag) must be fixed in the product code, test-first, in the task it belongs to.

- [ ] **Step 3: Whole browser suite**

Run: `npx playwright test`
Expected: all specs pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/browser/resize.spec.ts
git commit -m "test(e2e): browser tests for resizing mention spans"
```

---

### Task 8: Verification, screenshots, embedded assets

- [ ] **Step 1: All checks**

Run (in `frontend/`): `npm run typecheck && npm test && npm run api:check && npx playwright test`
Run (repo root): `uv run pytest -q`
Expected: everything passes; `api:check` reports no drift.

- [ ] **Step 2: Look at it**

With a temporary Playwright spec (delete it afterwards, do not commit it), take screenshots at 1280x720 into a directory outside the repo and look at each one:

1. An annotation selected: both handles visible at the edges of its mention.
2. Mid-drag (mouse down, moved, not released): preview extends, cursor area sensible.
3. A discontinuous mention (create one with the "+ Segment" flow from `frontend/browser/spans.spec.ts`): four handles.
4. Two overlapping annotations with one selected: handles belong to the selected one only and are distinguishable from the other annotation's underline.
5. A handle focused by keyboard: focus ring visible.

Check: handles do not shift the text (compare the line layout with and without selection), are not clipped at line starts or ends, and remain visible on the highlighted (`run--hot`) background.

- [ ] **Step 3: Rebuild the embedded web assets and commit**

```bash
uv run python -c "import sys; sys.path.insert(0, 'scripts'); from build_common import build_frontend, sync_embedded_web_assets; sync_embedded_web_assets(build_frontend(npm_ci=False))"
git add src/ontotator/web
git commit -m "build: rebuild embedded web assets"
```

- [ ] **Step 4: Report**

Branch and commits, the actual numbers from Step 1, every deviation from this plan (what, where, why), what the screenshots show including anything that looks off, and the screenshot paths. Do not merge or push.
