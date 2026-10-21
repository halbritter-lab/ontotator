# Annotator Acceptance UI 2026-10-21 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Execution starts after fix/acceptance-20261021 is merged into main; first step: rebase spec/annotator-acceptance-ui onto the new main (or create the implementation worktree from new main and cherry-pick the spec commit).** The spec's rule that "Markierung anpassen" (F1, WP **AP**, Nr. 1) and "Termsuche" (F4, WP **AR**, Nr. 4) start only after that merge is honoured by this as a whole: no WP of this plan is dispatched before the merge.

**Goal:** Implement [2026-10-21-annotator-acceptance-ui-design.md](../specs/2026-10-21-annotator-acceptance-ui-design.md): click-to-confirm defaults (F3), an "Unconfirmed values" section in the Submit dialog with one-click acknowledgement (F2), adjustable and discardable pending marks (F1), a stable term hit list (F4), My tasks status tabs (F7), and a sidebar project switcher with a Projects page and last-used landing (F8).

**Architecture:** Frontend only. No backend, contract or migration change: every write goes through `set_axes` and the submit command with `warning_acknowledgement`, every read through `listMyTasks`, `listProjects`, `documentsSummary`. F2's rows are a pure function (`editor/unconfirmedValues.ts`) over the draft, mirrored from the server rule `domain/project_rules.py` (`axis_not_chosen`: empty or defaulted). F1 extends the vendor span editor with handle labels and a public flush, and adds a positioned `PendingMarkBar`. F8 turns `app/ProjectPicker.tsx` into a combobox switcher at the top of the sidebar and adds `app/ProjectsPage.tsx`.

**Tech Stack:** React 18, TypeScript, Vitest + Testing Library (jsdom), Playwright + axe-core against `tests/browser_server.py` (Python, PostgreSQL via `pg_harness`), vendor `frontend/src/vendor/spans.js`.

**Binding inputs:** the spec (decisions D1–D6, copy tables, edge cases), `DESIGN.md`, `PRODUCT.md`, the axes spec ([2026-10-21-editor-axes-and-coupled-scroll-design.md](../specs/2026-10-21-editor-axes-and-coupled-scroll-design.md)), mockups in the main checkout `C:/Users/jan-p/Development/ontocurator/.superpowers/brainstorm/161693-1792600358/content/` (gitignored, read-only; where a mockup and the spec differ, the spec wins).

**Code base of this plan:** written against `fix/acceptance-20261021` at `f3286ec` plus its wave-4 work in progress (2026-10-21), not against the old `main` `f6d04bd` the spec quotes. Differences that matter: `editor/termSearch.ts` (`prefillQuery`, `prefillHint`, `NO_PREFILL_HINT`), `editor/SearchPanel.tsx` (always prefilled, `languageHint`, late prefill guarded by `prefillSettled`/`userTyped`), `app/CaseScreen.tsx` (C2 prefill in `pendingSearchProps` at ~1533–1551, E2b consolidation names, merge panel removed), `styles/screens/editor.css` (container-query layout `@container case-screen`), project creation defaults (C1: new projects preset Present / Patient / Current), pinned search view (C3), `frontend/src/consolidation/*` (E2a; may reuse `SearchPanel`, `TextPane` or `spans/adapter`). Spec line numbers are off by ~+3 in `CaseScreen.tsx`. **Line references below were checked on that state; after the merge re-check every one with `grep -n` and report drift instead of guessing.**

---

## Step 0 (main session, once, after the merge)

- [ ] Confirm `fix/acceptance-20261021` is merged: `git -C C:/Users/jan-p/Development/ontocurator log --oneline -1 main` shows the acceptance-fixes tip (or its bundle commit) and the acceptance-fixes final phase (stack rebuild) is finished (RAM).
- [ ] Create the implementation worktree from the new `main` and bring the spec and this plan over:

  ```bash
  git -C C:/Users/jan-p/Development/ontocurator worktree add C:/Users/jan-p/Development/ontocurator/.worktrees/annotator-ui -b feat/annotator-acceptance-ui main
  git -C C:/Users/jan-p/Development/ontocurator/.worktrees/annotator-ui cherry-pick main..spec/annotator-acceptance-ui
  ```

  (Alternative: `git -C C:/Users/jan-p/Development/ontocurator/.worktrees/spec-annotator-ui rebase main` and use that worktree; then replace the worktree path in every rule below.)

- [ ] Install dependencies in the new worktree: `uv sync` and `npm --prefix C:/Users/jan-p/Development/ontocurator/.worktrees/annotator-ui/frontend ci`.
- [ ] Create `build/with-lock.sh` (rule 7) in the new worktree.
- [ ] Re-check the line references of the wave-1 blocks (`grep -n` for the anchors named there) and note drift in the dispatch prompts.
- [ ] Baseline: `CHECK_VITEST_WORKERS=3 bash scripts/check.sh --quick frontend/src/app/CaseScreen.tsx` must be green before dispatch; a red baseline is fixed or reported first.

## Global rules (every WP; an agent reads this section, "Shared contracts", "Shared-file chains" and its WP block)

Worktree `C:/Users/jan-p/Development/ontocurator/.worktrees/annotator-ui` (Git Bash `/c/Users/jan-p/Development/ontocurator/.worktrees/annotator-ui`), branch `feat/annotator-acceptance-ui`. All agents of a wave share this worktree.

1. **Ownership.** A WP writes only the files in its **Owns** list (tests included). Within a wave the Owns lists are disjoint. "Conditional" Owns may be edited only if the WP's change breaks them. Need another file → stop and report. Never `git add -A`, `git add .`, `git stash`, `git reset`, `git checkout -- <file>`, `git clean`, never push.
2. **Commits.** The agent commits its own files only: `git add <owned paths>` then `git commit -m "<message>" -- <owned paths>` (the path list keeps a sibling's staged files out). If `.git/index.lock` exists, retry after 10 s. Conventional message (`feat(editor): …`), English, **no AI co-author trailer or "Generated with" line**. One or more commits per WP; report every SHA.
3. **TDD.** Write the listed failing tests, run them red, implement, run green, then the WP gate.
4. **WP gate (explicit paths).** `CHECK_PYTEST_WORKERS=4 CHECK_VITEST_WORKERS=3 bash scripts/check.sh --quick <owned paths>` (`--quick` forwards to `scripts/check-affected.sh`; with paths it runs the static checks plus only the tests affected by those paths). Do **not** use `--base main`. List the Owns paths that exist. The static part (lint, format, typecheck, contract drift) still sees siblings' uncommitted files: fix only failures in your Owns; report others with file names and rerun after the sibling's commit. Also run, by hand, every Vitest file that renders a component you changed but lives outside your Owns (e.g. `grep -rln "SearchPanel" frontend/tests`) and report failures instead of editing them.
5. **Backend lock (16 GB RAM).** No WP changes Python. Hold `build/backend.lock` for any PostgreSQL pytest run (none expected) and never run one while your own Playwright run is going. Frontend-only gates need no lock.
6. **Playwright lock.** Only one Playwright run at a time across all agents: hold `build/playwright.lock`. `test:e2e` rebuilds the shared `frontend/dist`, so the build happens inside the lock. Command: `HPO_E2E_PORT=<your port> npm --prefix frontend run test:e2e -- <spec files>`. Ports: wave slot 1 → 18774, slot 2 → 18775, slot 3 → 18776, final phase → 18777. Run at most ~6 spec files per locked run; release between batches so siblings can run.
7. **Lock protocol** (both locks). Use the **Bash tool** (Git Bash), never PowerShell, and absolute paths only (cwd resets between calls). Acquire, run and release in one wrapper with `trap … EXIT`. The main session creates `/c/Users/jan-p/Development/ontocurator/.worktrees/annotator-ui/build/with-lock.sh` in Step 0; agents only call it:

   ```bash
   #!/usr/bin/env bash
   # Usage: WP=<ID> bash /c/Users/jan-p/Development/ontocurator/.worktrees/annotator-ui/build/with-lock.sh <backend|playwright> <command...>
   set -u
   : "${WP:?set WP=<ID>}"
   root=/c/Users/jan-p/Development/ontocurator/.worktrees/annotator-ui
   lock="$root/build/$1.lock"
   shift
   mkdir -p "$root/build"
   until ( set -o noclobber; echo "$WP $(date -Iseconds)" > "$lock" ) 2>/dev/null; do
       echo "waiting for $lock (held by: $(cat "$lock" 2>/dev/null))"
       sleep 15
   done
   trap 'grep -q "^$WP " "$lock" 2>/dev/null && rm -f "$lock"' EXIT
   cd "$root" || exit 1
   "$@"
   exit $?
   ```

   Example: `WP=AR HPO_E2E_PORT=18775 bash /c/Users/jan-p/Development/ontocurator/.worktrees/annotator-ui/build/with-lock.sh playwright npm --prefix frontend run test:e2e -- browser/annotation-loop.spec.ts`. Run every Playwright call and every call that may wait or exceed 10 min with `run_in_background: true` (you are notified on exit); never foreground `sleep`; never delete another agent's lock. A lock older than 45 min whose owner has reported is removed by the main session only.

8. **Contracts.** No WP changes `contracts/openapi.json`, `frontend/src/api/generated.ts`, `frontend/src/api/client.ts`, `frontend/tests/documents/fixtures.ts`, the error catalog or any `src/**.py`. There is no contract owner in any wave. If a WP finds it needs one of these, it stops and reports (the spec says no backend or contract change is needed).
9. **Frontend rules.** English copy verbatim from the spec; status never by colour alone; unavailable actions use `aria-disabled` + reason (existing `Button`), not `disabled`; icons from `frontend/src/ui/icons.tsx`; no colour literals outside `tokens.css`, DESIGN.md tokens only (no new tokens); shortcuts only through `useShortcut` (`frontend/src/ui/shortcuts.ts`); no `style={…}` and no glyphs `↳ ✓` in `AnnotationPanel.tsx` / `SearchPanel.tsx` (`tests/annotationPanelStyles.test.ts`); no `line-clamp`/`text-overflow: ellipsis` inside the editor.css Values block markers (`/* Values block` … `/* End of Values block */`).
10. **Evidence** (screenshots) only under `build/annotator-ui/evidence/` in the worktree; delete Playwright scratch output (`frontend/test-results`, traces) before committing.
11. **Reviews.** WPs marked "Review: yes" (AS: the spec's WP table requires one Claude code review because the acknowledgement is behaviour-critical; AH: size L) get one read-only `superpowers:code-reviewer` pass after their commit, then one fix agent (effort medium). **Timing:** AS's review and fix land (committed) before wave 2 is dispatched, because the fix touches `CaseScreen.tsx`, which AP owns in wave 2. If it cannot land in time, its open findings go verbatim into AP's dispatch prompt and AP fixes them (with tests). AH's review and fix land before the final phase. Others: no per-WP review.
12. **Hand-back** (report format): changed/created/deleted files; tests added/updated with counts (e.g. "vitest tests/submitDialog.test.tsx: 24 passed"); gate command + result; Playwright specs + result; commit SHA(s); deviations, line drift, open risks. Max 250 words.

## Shared contracts

### F3 write path (AV) — `editor/AnnotationPanel.tsx`, `app/CaseScreen.tsx`

```ts
// AnnotationPanelProps (replaces the existing two-argument signature; the third argument is optional)
onConfirmDefaults?: (axisIds: string[], values?: AxesValues, options?: { moveFocus?: boolean }) => void;

// CaseScreen (existing function, new optional argument; `moveFocus: false` keeps focus where it is)
const handleConfirmDefaults = async (axisIds: string[], values?: AxesValues, options?: { moveFocus?: boolean }) => { … };
```

### F2 rows (AS) — new `frontend/src/editor/unconfirmedValues.ts`

```ts
import type { AnnotationSnapshot } from "../api/client";

export interface UnconfirmedAxisDef {
  id: string;
  label: string;
  options: readonly string[];
}
export interface UnconfirmedValue {
  axisId: string;
  axisLabel: string;
  value: string | null;
  defaulted: boolean;
}
export interface UnconfirmedRow {
  annotationId: string;
  /** Review proposal (immutable snapshot): refKey of its target. */
  targetKey?: string;
  term: string;
  termId: string;
  /** First mark, 40 code points (`quoteSegments`); "" for spanless findings. */
  quote: string;
  /** Open values (empty or defaulted) in the axis order of the type; server-only pairs last. */
  values: UnconfirmedValue[];
  /** Defaulted, non-empty values still among the axis options; [] when the row cannot be confirmed in one click. */
  confirmableAxisIds: string[];
  /** Last line of a row without "Confirm"; null for confirmable rows. */
  reason: string | null;
  /** Findings-list key and first mark, for "Go to". */
  listKey: string;
  evidenceId?: string;
}
export const UNCONFIRMED_REASONS = {
  emptyOnly: "Choose a value in the finding.",
  proposal: "Proposal values change only with Edit & Replace.",
  readOnlyLayer: "Read-only layer.",
} as const;
export const pairKey = (annotationId: string, axisId: string): string =>
  `${annotationId}\u001f${axisId}`;
export interface UnconfirmedInput {
  snapshots: readonly AnnotationSnapshot[];
  axes: (snapshot: AnnotationSnapshot) => readonly UnconfirmedAxisDef[];
  targetKeyOf: (snapshot: AnnotationSnapshot) => string | undefined;
  editableLayerIds: readonly string[];
  term: (snapshot: AnnotationSnapshot) => string;
  quote: (snapshot: AnnotationSnapshot) => string;
  evidenceId: (snapshot: AnnotationSnapshot) => string | undefined;
  /** Server warning pairs, only while the warning's draft revision equals the draft's. */
  serverPairs?: readonly { annotationId: string; axis: string }[];
}
export function unconfirmedRows(input: UnconfirmedInput): UnconfirmedRow[];
export function rowPairs(rows: readonly UnconfirmedRow[]): Set<string>;
export function sameSet(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): boolean;
/** "Assertion: Present · Experiencer: Patient"; an empty value reads "{Axis}: Not specified". */
export function valuesLine(
  row: UnconfirmedRow,
  optionLabel: (value: string | null) => string,
): string;
/** Number of (finding, axis) pairs: the n of "Submit with {n} unconfirmed values". */
export function valueCount(rows: readonly UnconfirmedRow[]): number;
```

Rule (mirrors `axis_not_chosen` in `src/ontocurator/domain/project_rules.py:139-150`): for every axis of the snapshot's type, open when the value is `null`, `undefined`, `""`, or the axis is in `axes_defaulted`. `confirmableAxisIds` = open axes that are defaulted, non-empty and in `axis.options`, and only when the row is neither a proposal nor on a layer outside `editableLayerIds`. `reason`: proposal → `proposal`; layer not editable → `readOnlyLayer`; no confirmable axis → `emptyOnly`; else `null`. Rows keep `snapshots` order (`completionResults`).

### F2 dialog props (AS) — `editor/SubmitCaseDialog.tsx`

Removed props: `axisWarning`, `axisWarningAcknowledged`, `setAxisWarningAcknowledged`. Added:

```ts
unconfirmed: readonly UnconfirmedRow[];
/** Project rule `require_chosen_axes` (`view.require_chosen_axes`): rows block, no checkbox. */
requireChosenAxes: boolean;
/** Why "Confirm" is unavailable (queue conflict, error, offline), else null. */
confirmUnavailableReason: string | null;
/** One set_axes for the row; resolves false (never rejects) when nothing was confirmed. */
onConfirmValues: (row: UnconfirmedRow) => Promise<boolean>;
acknowledged: boolean;
setAcknowledged: (checked: boolean) => void;
/** Polite status from the submit flow, e.g. "The unconfirmed values changed. Check the list again." */
submitStatus: string | null;
```

`openItems.ts` gains `export const DIALOG_HIDDEN_KINDS: readonly OpenItemKind[] = ["defaulted", "unconfirmed-values"]` and `export function dialogItems(items)` (the dialog lists only these); `submitBlockedReason(items, blockingValues = 0)` returns `"Confirm or choose {n} values before submitting."` after the existing blocking kinds when `blockingValues > 0`.

### F1 span editor (AP) — vendor, adapter, TextPane

```js
// vendor/spans.js (SpanEditor)
setResizable(mentionIds, labels); // labels: { [mentionId]: { start: string, end: string } }, optional
flushResize(); // public wrapper of _flushKeyResize()
```

```ts
// spans/adapter.ts (SpanEditorHandle)
setResizable: (evidenceIds: string[], labels?: Record<string, { start: string; end: string }>) => void;
flushResize: () => void;

// editor/TextPane.tsx (TextPaneProps, additive)
resizableLabels?: Record<string, { start: string; end: string }>;
/** Receives a function that reports a keyboard resize still waiting for its pause. */
flushResizeRef?: React.MutableRefObject<(() => void) | null>;
```

All additive: `consolidation/*` (E2a) may call `mountSpanEditor`/`TextPane` without the new arguments.

New `frontend/src/editor/PendingMarkBar.tsx`: `PendingMarkBar({ textElement, evidenceId, segmentsKey, onDiscard })` (code in AP).

### F4 search (AR) — `editor/SearchPanel.tsx`

- Re-prefill: while `userTyped` is false (typing **or** "Clear search" sets it), a changed `initialQuery` replaces the field and searches after the normal debounce; the first prefill (mount or late) still runs at once and is selected.
- Every row: `.candidate-header` with label, code and `<span className="candidate-enter" aria-hidden="true"><Kbd>Enter</Kbd></span>` (when `canAssign`); definition always `<div className="candidate-def">` (no `is-clamped`).
- Detail area `<div className="search-detail" data-search-detail aria-hidden="true">` between the hint and the list, only while hits are shown.

### F7 / F8 routes and landing (AT, AH) — `app/router.ts`, `app/lastProject.ts`

```ts
export type TaskStatusTab = "todo" | "paused" | "submitted" | "all";
export const TASK_STATUS_TABS: readonly TaskStatusTab[] = ["todo", "paused", "submitted", "all"];
// Route union
| { name: "tasks"; project?: string; status?: TaskStatusTab } // AT: #/?project=…&status=…; unknown status → absent
| { name: "projects" }                                       // AH: #/projects
```

`status` absent means "All" (D3); an explicit `status=all` is kept in the route and the URL (so a reload of the All tab never triggers the landing redirect). Landing (App) only for `{ name: "tasks" }` without `project` **and** without `status`.

`landingProject(username, projects)` (AH): the remembered project when it is in `projects` (any role), else `undefined` (no "first led project" fallback). `rememberProject` runs for every route with `key` and for `tasks` with a non-empty `project`.

`app/ProjectPicker.tsx` (AH) exports `ProjectSwitcher` (replaces `ProjectPicker`), `projectDestination` and `PROJECT_SEARCH_THRESHOLD` (unchanged). `ui/Popover.tsx` (AH) gains `closeOnTabOut?: boolean` (default `false`).

## Shared-file chains (one writer per wave)

| File(s)                                                                                                                                                                                        | Writers (wave)                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend/src/app/CaseScreen.tsx`, `frontend/tests/caseScreen.test.tsx`                                                                                                                        | AV → AS (1, slot 1, one agent) → AS review fix (between 1 and 2) → AP (2)                                                                                                             |
| `frontend/src/styles/screens/editor.css`                                                                                                                                                       | AR (1; also the Values heading-row rules on behalf of AV) → AP (2)                                                                                                                    |
| `frontend/src/editor/SearchPanel.tsx`, `frontend/tests/searchPanel.test.tsx`                                                                                                                   | AR (1; also the re-prefill AP relies on)                                                                                                                                              |
| `DESIGN.md`                                                                                                                                                                                    | AV → AS (1: Values block, Submit dialog, and the term-search row on behalf of AR) → AH (2: shell, switcher, Projects, My tasks on behalf of AT, pending mark and Esc on behalf of AP) |
| `frontend/src/app/router.ts`, `frontend/tests/router.test.ts`, `frontend/src/App.tsx`, `frontend/tests/landing.test.tsx`                                                                       | AT (1) → AH (2)                                                                                                                                                                       |
| `frontend/browser/helpers.ts`                                                                                                                                                                  | AS (1, `submitCase`) → AH (2, `LAUNCH_URL`)                                                                                                                                           |
| `frontend/browser/annotation-loop.spec.ts`                                                                                                                                                     | AR (1) → AP (2)                                                                                                                                                                       |
| `frontend/browser/quick-fixes.spec.ts`                                                                                                                                                         | AT (1, F7 test) → AH (2, Q3 rewritten for the switcher)                                                                                                                               |
| `frontend/browser/decision-semantics.spec.ts`, `review-flow.spec.ts`, `workflow.spec.ts`                                                                                                       | AS (1, conditional: submit dialog) → AH (2, conditional: landing)                                                                                                                     |
| `frontend/src/styles/components.css`, `frontend/tests/ui/styles.test.ts`, `frontend/src/ui/Popover.tsx`, `frontend/tests/ui/popover.test.tsx`, `frontend/src/app/Shell.tsx`, `ui/AppShell.tsx` | AH (2)                                                                                                                                                                                |

## Waves

| Wave | Slot 1 (port 18774)                                               | Slot 2 (18775) | Slot 3 (18776) | Contract owner |
| ---- | ----------------------------------------------------------------- | -------------- | -------------- | -------------- |
| 1    | AV (S) → AS (M, review) — one agent, sequential, separate commits | AR (S)         | AT (S)         | none           |
| —    | AS review → one fix agent (must be committed before wave 2)       |                |                |                |
| 2    | AP (M)                                                            | AH (L, review) | —              | none           |
| —    | AH review → one fix agent (before the final phase)                |                |                |                |
| 3    | Final phase (main session + one reviewer + one fix agent)         |                |                |                |

Dependencies: AS ← AV (write path, same agent); AP ← AS (`CaseScreen.tsx`, `caseScreen.test.tsx`), AR (`SearchPanel` re-prefill, `editor.css`, `annotation-loop.spec.ts`); AH ← AT (`router.ts`, `App.tsx`, `landing.test.tsx`, `quick-fixes.spec.ts`), AS (`helpers.ts`). The critical path is AV → AS → AP; AR and AT are short and leave slots 2–3 idle in the second half of wave 1 (that is accepted: AP cannot start before AS, and AH needs AT's router and AS's helpers). Wave 2 is dispatched when every wave-1 commit and the AS review fix are in.

## Dispatch prompt template

```text
You implement WP <ID> of docs/superpowers/plans/2026-10-21-annotator-acceptance-ui.md
in the worktree C:/Users/jan-p/Development/ontocurator/.worktrees/annotator-ui
(branch feat/annotator-acceptance-ui; Git Bash path /c/Users/jan-p/Development/ontocurator/.worktrees/annotator-ui).
Read: "Global rules", "Shared contracts", "Shared-file chains" and the block "### <ID>" of the plan,
and the spec docs/superpowers/specs/2026-10-21-annotator-acceptance-ui-design.md sections named in the block.
Mockups (read-only): C:/Users/jan-p/Development/ontocurator/.superpowers/brainstorm/161693-1792600358/content/<file>.
Use the Bash tool (Git Bash) with absolute paths for every shell command, never PowerShell.
Set WP=<ID> in every shell. Your Playwright port: HPO_E2E_PORT=<port>.
Rules: write only your Owns files; TDD; commit only your files with
`git commit -m "<msg>" -- <paths>` (no AI co-author trailer, no push); run Playwright only through
build/with-lock.sh (rules 6–7); gate
`CHECK_PYTEST_WORKERS=4 CHECK_VITEST_WORKERS=3 bash scripts/check.sh --quick <your owned paths>` (rule 4).
No contract, fixture or Python change (rule 8).
Line drift found in Step 0: <notes or "none">.
Siblings working in parallel: <IDs + their Owns summary>. Do not touch their files.
Open review findings handed to you (rule 11): <findings or "none">.
Report (max 250 words): changed files; tests added/updated and run with pass counts; gate result;
Playwright specs and result; commit SHA(s); deviations and risks.
```

For the slot-1 agent of wave 1 the prompt names both blocks: "You implement WP AV, then WP AS (separate commits; AS builds on AV's write path)".

---

## WP blocks

### AV — Click-to-confirm the default, button on the heading row, hint copy

**Goal:** spec "F3. Confirming defaults with one click" (D5), deviation 1. **Size S. Review: no.**

**Owns:** `frontend/src/editor/AnnotationPanel.tsx`, `frontend/src/app/CaseScreen.tsx`, `frontend/tests/valuesBlock.test.tsx`, `frontend/tests/caseScreen.test.tsx`, `frontend/browser/values-block.spec.ts`, `DESIGN.md` (Values block row). **Not** `editor.css`: AR writes the heading-row rules in wave 1 (see AR); until AR commits, the button sits on its own line, which no test checks.

**Tests that break:** `valuesBlock.test.tsx` "shows the editable hint with Kbd D" (copy and the "button above the hint" order assertion) — rewrite; `values-block.spec.ts` "V, arrows, Tab and D keep their flow" if it tabs from the rows to the button (the button now precedes the rows) — update.

**Tests to add:**

- `valuesBlock.test.tsx`:
  1. `click on the checked default confirms that axis` — `fireEvent.click` on the checked "Present" radio of a defaulted `assertion` → `onConfirmDefaults` called once with `(["assertion"], { assertion: "present", experiencer: "patient", temporality: "current" }, { moveFocus: false })`.
  2. `click on a checked non-default value does nothing` — chosen (not defaulted) axis → no call.
  3. `no click handler when read-only or the default is unavailable` — read-only: no call; value not in `axis.options`: no call.
  4. `Confirm defaults sits on the Values heading row before the first axis` — button and `h3` share the parent `.values-heading-row`; `button.compareDocumentPosition(firstFieldset) & DOCUMENT_POSITION_FOLLOWING`.
  5. `hint names the click` — text `Highlighted values are defaults. Click a highlighted value or “Confirm defaults” to confirm, or choose another value.`, no `kbd` inside; read-only hint unchanged.
- `caseScreen.test.tsx`: `clicking the highlighted default sends one set_axes for that axis and keeps focus` — finding with `axes_defaulted: ["assertion", "experiencer"]`; click the checked default of `assertion` → `applyCommand` payload `{ command: "set_axes", chosen_axis_ids: ["assertion"] }`; announcer text `Confirmed: Assertion Present.`; `document.activeElement` is still that radio; "Confirm defaults (1)" remains.
- `values-block.spec.ts`: `clicking the default confirms only that axis` — `valuesScenario` from `browser/valuesHelpers.ts`, add a finding, click "Present" → the "Default" tag disappears for Assertion only, button reads "Confirm defaults (2)".

**Steps:**

- [ ] Write the tests above; run `npm --prefix frontend run test -- valuesBlock caseScreen` → the new ones FAIL.
- [ ] `AnnotationPanel.tsx` (Values section at ~`:276-343`): extend the prop type (Shared contracts); add

  ```tsx
  /** A click (or Space) on the highlighted default confirms that axis only (D5). */
  const confirmAxis = (axisId: string) => {
    if (readOnly || !onConfirmDefaults) return;
    axes.flush();
    onConfirmDefaults([axisId], { ...axes.values }, { moveFocus: false });
  };
  ```

  On the radio input: `onClick={isDefault && !readOnly && onConfirmDefaults ? () => confirmAxis(axis.id) : undefined}` (`isDefault` = `unconfirmed && val === option.value`, as today; `click` fires for a checked radio, `change` does not; arrow keys keep today's semantics). Move the button into a heading row before the axes:

  ```tsx
  <div className="values-heading-row">
    <h3 id={valuesHeadingId}>
      Values
      {!readOnly && (
        <span aria-hidden="true">
          {" "}
          <Kbd>V</Kbd>
        </span>
      )}
    </h3>
    {!readOnly && onConfirmDefaults && confirmableDefaults.length > 0 && (
      <Button
        type="button"
        variant="primary"
        size="sm"
        className="values-confirm"
        data-confirm-defaults
        aria-keyshortcuts="d"
        onClick={confirmDefaults}
      >
        Confirm defaults ({confirmableDefaults.length})
        <span aria-hidden="true">
          {" "}
          <Kbd>D</Kbd>
        </span>
      </Button>
    )}
  </div>
  ```

  Remove the old button below the rows; replace the editable hint with the new copy (no `Kbd`). `Select` axes (> 4 options) get no click handler.

- [ ] `CaseScreen.tsx` `handleConfirmDefaults` (~`:2447`): add `options?: { moveFocus?: boolean }`; right after `announceCarried(...)` add `if (options?.moveFocus === false) return;`. Pass the argument through at the `AnnotationPanel` call (~`:3202`): `onConfirmDefaults={(axisIds, values, options) => { void handleConfirmDefaults(axisIds, values, options); }}`. The announcement text is already "Confirmed: {Axis} {Value}.".
- [ ] Green; browser test under the Playwright lock (port 18774).
- [ ] DESIGN.md Values block row (`| Values block (…`): replace "Primary small "Confirm defaults (n)" … Press D to confirm them, or choose another value." (`Kbd` D)" by: the button sits on the Values heading row right of the `h3` (`values-heading-row`), before the axes in DOM and Tab order; a click or Space on the highlighted default segment confirms that axis only (one `set_axes`, focus stays, "Confirmed: {Axis} {Value}."); hint "Highlighted values are defaults. Click a highlighted value or “Confirm defaults” to confirm, or choose another value." In the "Focus loop" sentence keep "confirming defaults (button or D) returns focus to the text".
- [ ] Commit `feat(editor): confirm a default with one click`. Gate: `CHECK_PYTEST_WORKERS=4 CHECK_VITEST_WORKERS=3 bash scripts/check.sh --quick frontend/src/editor/AnnotationPanel.tsx frontend/src/app/CaseScreen.tsx frontend/tests/valuesBlock.test.tsx frontend/tests/caseScreen.test.tsx frontend/browser/values-block.spec.ts DESIGN.md`. Continue with AS (same agent).

**Acceptance:** spec F3 tests green; D still confirms all; arrows unchanged.

### AS — Submit dialog: Unconfirmed values section, confirm in place, one-click acknowledgement

**Goal:** spec "F2. Submit dialog" (D1, D2), deviations 2 and 3. **Size M. Review: yes (spec WP table: acknowledgement is behaviour-critical).**

**Owns:** `frontend/src/editor/unconfirmedValues.ts` (new), `frontend/src/editor/UnconfirmedValuesSection.tsx` (new), `frontend/src/editor/submitDialog.css` (new, imported by `SubmitCaseDialog.tsx`, as `carried-inspector.css` is), `frontend/src/editor/SubmitCaseDialog.tsx`, `frontend/src/editor/openItems.ts`, `frontend/src/app/CaseScreen.tsx`, `frontend/tests/unconfirmedValues.test.ts` (new), `frontend/tests/submitDialog.test.tsx`, `frontend/tests/openItems.test.ts`, `frontend/tests/caseScreen.test.tsx`, `frontend/browser/helpers.ts` (`submitCase` only), `frontend/browser/submit-unconfirmed.spec.ts` (new), `frontend/browser/decision-semantics.spec.ts`, `DESIGN.md` (Submit dialog wording, the "Do" line about the submit dialog, and the term-search row on behalf of AR). Conditional: `frontend/browser/carried-review.spec.ts`, `reanchor.spec.ts`, `variants.spec.ts`, `editor-layout.spec.ts`, `review-flow.spec.ts`, `workflow.spec.ts`.

**Tests that break (rewrite):** `caseScreen.test.tsx` "requires explicit server-bound warning acknowledgement without confirming clinical values" (~`:312`, uses "Continue and submit" and the old checkbox), "allows leaving after cancelling a submission warning without treating it as a rejected edit" (~`:340`), the `/1 annotation has defaulted axis values/` assertion (~`:1615`, if it is the dialog); `submitDialog.test.tsx` ~`:76` (summary line with defaulted), ~`:135-137` ("Continue and submit", old blocked reason); `browser/helpers.ts` `submitCase` (~`:88-108`); `browser/decision-semantics.spec.ts` ~`:23`, `:36` ("defaulted axis values" in the dialog). `openItems.test.ts` stays valid (`summaryLine` is unchanged; the dialog filters).

**Tests to add:**

- `unconfirmedValues.test.ts` (pure): rows from empty and defaulted axes in type order; `valuesLine` = "Assertion: Present · Experiencer: Patient · Temporality: Current" and "Temporality: Not specified" for an empty value; empty-only row → `confirmableAxisIds: []`, reason "Choose a value in the finding."; mixed row → confirmable = only the defaulted non-empty axes, reason `null`; proposal (`targetKeyOf` returns a key) → reason "Proposal values change only with Edit & Replace.", no confirmable; layer outside `editableLayerIds` → "Read-only layer."; defaulted value not in `options` → not confirmable; server pair the client did not compute adds that value (row created if needed); `rowPairs`/`sameSet`/`valueCount`.
- `openItems.test.ts`: `dialogItems` drops `defaulted` and `unconfirmed-values`; `submitBlockedReason(items, 3)` = "Confirm or choose 3 values before submitting." and a blocking carried item still wins.
- `submitDialog.test.tsx` (render the dialog with rows built by `unconfirmedRows`):
  1. heading `h3` "Unconfirmed values · 3 findings" (1 → "1 finding"), intro "These values were filled in from defaults or are empty. Confirm them here, or go to the finding to change them.", line "“Confirm all” confirms the default values shown below for all listed findings.", "Confirm all (3)" in the header; rows are `li` in a `ul`; each row: term (`TermName`), quote, values line, "Confirm" (name "Confirm values of {term}") and quiet "Go to" (name "Go to {term}").
  2. the generic open-item list no longer shows defaulted items (no "defaulted axis values" text).
  3. "Confirm" → `onConfirmValues(row)` once; while pending the row shows "Confirming…" and both buttons `aria-disabled="true"`; after rerender without the row focus is on the next row's "Confirm", for the last row on the previous row's "Confirm", with no rows left on "Entire text checked for further findings" if unchecked, else on "Submit case"; polite status "Confirmed Hypotonia. 2 left."; with no rows left `role="status"` "All values are confirmed." replaces the section.
  4. "Confirm all (3)" calls `onConfirmValues` for every confirmable row in list order, one after the other; a `false` on the second stops the run, that row shows "Could not confirm. Try again." with "Retry"; status "Confirmed 1 findings." (count from the run) plus " {m} need a value." when non-confirmable rows remain; "Confirm all" is hidden when no row is confirmable.
  5. non-confirmable rows show only "Go to" and the reason as their last line.
  6. checkbox "Submit with 4 unconfirmed values" with hint "Acknowledging does not confirm the values; they stay marked as defaults." only while rows remain and `requireChosenAxes` is false; unticked with rows → "Submit case" `aria-disabled` with reason "Confirm the values or tick “Submit with 4 unconfirmed values” before submitting.".
  7. `requireChosenAxes` → no checkbox, reason "Confirm or choose 4 values before submitting.".
  8. `confirmUnavailableReason` → "Confirm"/"Confirm all" `aria-disabled` with that reason; "Go to" still calls `onGoTo`.
  9. primary button is always "Submit case"; `submitStatus` is rendered in a polite live region.
- `caseScreen.test.tsx`:
  1. `auto-resends once when the warning lists exactly the ticked values` — one defaulted axis; tick "Submit with 1 unconfirmed values" (the spec has no singular form; keep its text) and "Entire text checked", click "Submit case"; `submitWorkspace` rejects once with `AXIS_CONFIRMATION_WARNING` listing that pair, then resolves → two calls, the second with `warning_acknowledgement` = the server's, distinct `mutation_id`s; "Case submitted" shown; no `applyCommand`.
  2. `does not resend when the warning set differs` — warning lists another axis too → one call; checkbox unticked; status "The unconfirmed values changed. Check the list again."; the extra pair appears as a row.
  3. `sends no acknowledgement when no rows remain` — all axes chosen → one call without `warning_acknowledgement`.
  4. `row Confirm sends one set_axes with the row's defaulted axes` — payload `chosen_axis_ids` = the defaulted non-empty axes, `axes_values` = the current values; the row disappears after the draft update.
  5. rewrite the two broken tests: the first now covers "a second warning after the resend clears the checkbox" (server renews the policy: the resend answers a warning again → no third call, checkbox cleared, status shown); the second keeps "Cancel leaves without a rejected edit" with the new checkbox name.
- `submit-unconfirmed.spec.ts` (new; `reviewFlowScenario(page, "ANNOTATION_LOOP")` + `loginScenarioUser` from `browser/reviewFlowHelpers.ts`, creation defaults Present / Patient / Current; mark three words with `selectText` and add a term each): open Submit → section lists 3 findings → "Confirm" one → 2 rows, focus on the next "Confirm" → "Confirm all (2)" → "All values are confirmed." → tick "Entire text checked", "Submit case" → "Case submitted" without a warning round (assert one `POST …/submit` request); second test: two findings, confirm none, tick "Submit with 6 unconfirmed values" and "Entire text checked", one click on "Submit case" → submitted (two submit requests, one user action). Evidence screenshot `submit-unconfirmed.png`.

**Steps:**

- [ ] Red: `unconfirmedValues.test.ts`, `openItems.test.ts` additions, `submitDialog.test.tsx`, `caseScreen.test.tsx` additions.
- [ ] `unconfirmedValues.ts` per "Shared contracts" (labels via the axis definitions; `values` of server-only pairs use `axisLabel = axisId`). Green for the pure tests.
- [ ] `openItems.ts`: `DIALOG_HIDDEN_KINDS`, `dialogItems`, `submitBlockedReason(items, blockingValues = 0)`; `collectOpenItems` unchanged (the toolbar's "Next open item" keeps both kinds).
- [ ] `UnconfirmedValuesSection.tsx`: props `rows`, `optionLabel`, `confirmUnavailableReason`, `onConfirmValues`, `onGoTo(row)`, `onEmpty(): void` (focus fallback, provided by the dialog). State: `busy: Set<string>`, `failed: Set<string>`, `running: boolean`, `status: { text: string; count: number } | null` (re-mounted span as in the dialog's announcer). Keep `latestRows` in a ref so "Confirm all" and the focus effect read the rows after each await. Focus after a confirm: remember the confirmed row's index; in `useLayoutEffect` on `rows` find the first confirmable row at index ≥ that index, else the last confirmable row before it, else call `onEmpty()`.

  ```tsx
  const confirmAll = async () => {
    setRunning(true);
    let done = 0;
    for (const row of latestRows.current.filter(isConfirmable)) {
      setBusy(new Set([row.annotationId]));
      const ok = await onConfirmValues(row).catch(() => false);
      if (!ok) {
        setFailed((previous) => new Set(previous).add(row.annotationId));
        break;
      }
      done += 1;
    }
    setBusy(new Set());
    setRunning(false);
    const needValue = latestRows.current.filter(
      (row) => !isConfirmable(row),
    ).length;
    announce(
      `Confirmed ${done} findings.${needValue ? ` ${needValue} need a value.` : ""}`,
    );
  };
  ```

  Markup: `section.unconfirmed-values` with header (`h3` + "Confirm all (n)"), intro, the "Confirm all" line, `ul.unconfirmed-values__list` (max-height `50dvh`, `overflow-y: auto`), rows `li.unconfirmed-values__row`. CSS in `submitDialog.css`, tokens only (`surface-sunken`, `border`, `radius-sm`, `space-*`, `size-sm`, `text-muted`; forced colours `CanvasText` borders).

- [ ] `SubmitCaseDialog.tsx`: new props (Shared contracts); list `dialogItems(items)` in the generic message and `summaryLine`; render the section above the "Entire text checked" checkbox; the acknowledgement checkbox `Submit with {n} unconfirmed values` + hint only while `rows.length && !requireChosenAxes`; blocked reason order: read-only → `submitBlockedReason(dialogItems(items), requireChosenAxes ? valueCount(rows) : 0)` → text not checked → rows remain and not acknowledged ("Confirm the values or tick “Submit with {n} unconfirmed values” before submitting."); primary label always "Submit case"; remove the old "Review unconfirmed clinical values" message. `onEmpty` focuses the "Entire text checked" input (ref) when unchecked, else the "Submit case" button (ref). `submitStatus` in a polite live region. Import `./submitDialog.css`.
- [ ] `CaseScreen.tsx`:
  - after `completionResults` (~`:2094`): build `unconfirmed = unconfirmedRows({ snapshots: completionResults, axes: axisDefinitions, targetKeyOf: s => { const t = reviewTargetOf(s); return t ? refKey(t) : undefined; }, editableLayerIds, term: snapshotTerm, quote: s => quoteSegments(view.document.text, firstSegments(s), 40), evidenceId: firstEvidenceId, serverPairs: axisWarning && axisWarning.acknowledgement.draft_revision === draft.revision ? axisWarning.warnings : undefined })` (`firstSegments` = the first evidence's segments, `allEvidenceMap` for own findings, `snapshot.evidence[0]` for proposals); `unconfirmedPairs = rowPairs(unconfirmed)`, `pairsKey = [...unconfirmedPairs].sort().join(",")`.
  - state `ackSeen: ReadonlySet<string> | null`, `submitStatus: string | null`; `setAcknowledged(checked)` sets `axisWarningAcknowledged`, `ackSeen = checked ? unconfirmedPairs : null`, clears `submitStatus`. Effect on `pairsKey`: when acknowledged and a pair not in `ackSeen` appears → untick, `ackSeen = null`, `submitStatus = "The unconfirmed values changed. Check the list again."`.
  - `confirmUnconfirmedRow(row)`: find the snapshot in `latestDraft.current`; `return await handleUpdateAxes({ ...snapshot.annotation.axes_values }, row.confirmableAxisIds, row.annotationId)`; catch → `false` (report non-`DiscardedChangesError` errors through `reportError`).
  - `confirmUnavailableReason = queueState === "conflict" || queueState === "error" || isOffline ? statusText : null`.
  - `confirmSubmit` (~`:2252`): replace the `axisWarning && !axisWarningAcknowledged` guard by `rowsRemain && (view.require_chosen_axes || !axisWarningAcknowledged)` where `rowsRemain = unconfirmed.length > 0`; capture `expected = unconfirmedPairs`; replace the single request by:

  ```ts
  const submitEnvelope = (
    expectedRevision: number,
    acknowledgement?: AxisWarning["acknowledgement"],
  ) => ({
    mutation_id: crypto.randomUUID(),
    expected_revision: expectedRevision,
    payload: {
      command: "submit_workspace" as const,
      document_checked: true, // confirmed in the dialog
      ...(acknowledgement ? { warning_acknowledgement: acknowledgement } : {}),
    },
  });
  let first: ReturnType<typeof submitEnvelope> | undefined;
  let resend: ReturnType<typeof submitEnvelope> | undefined;
  const submission = await queueRef.current.enqueue(
    async (expectedRevision) => {
      assertWritable();
      const held =
        rowsRemain && axisWarningAcknowledged
          ? axisWarning?.acknowledgement
          : undefined;
      first ??= submitEnvelope(expectedRevision, held);
      try {
        return await api
          .submitWorkspace(workspaceId, first)
          .catch(assignmentFailure);
      } catch (error) {
        const warning = submissionAxisWarning(error);
        // An advisory response applies no mutation and must not count as a rejected edit.
        if (!warning) throw error;
        const answered = new Set(
          warning.warnings.map((item) => pairKey(item.annotationId, item.axis)),
        );
        // D1: the user ticked exactly these values; resend once with the fresh acknowledgement.
        if (
          rowsRemain &&
          axisWarningAcknowledged &&
          sameSet(answered, expected)
        ) {
          resend ??= submitEnvelope(expectedRevision, warning.acknowledgement);
          try {
            return await api
              .submitWorkspace(workspaceId, resend)
              .catch(assignmentFailure);
          } catch (again) {
            const next = submissionAxisWarning(again);
            if (next) return { revision: expectedRevision, axisWarning: next };
            throw again;
          }
        }
        return { revision: expectedRevision, axisWarning: warning };
      }
    },
  );
  if ("axisWarning" in submission) {
    setAxisWarning(submission.axisWarning);
    setAxisWarningAcknowledged(false);
    setAckSeen(null);
    setSubmitStatus("The unconfirmed values changed. Check the list again.");
    setSubmitDialogOpen(true);
    return;
  }
  ```

  - `handleSubmitWorkspace` keeps resetting `axisWarning`/acknowledgement on open and also clears `ackSeen`/`submitStatus`.
  - Pass the new props to `SubmitCaseDialog` (~`:3292`); "Go to" of a row reuses `goToOpenItem`:

    ```ts
    const goToRow = (row: UnconfirmedRow) =>
      goToOpenItem({
        key: `unconfirmed:${row.targetKey ?? row.annotationId}`,
        kind: "unconfirmed-values",
        blocking: false,
        term: row.term,
        line: "",
        listKey: row.listKey,
        focus: "[data-axis-field]",
        axisId: row.values[0]?.axisId,
        evidenceId: row.evidenceId,
      });
    ```

- [ ] Green (unit). `browser/helpers.ts` `submitCase`: open the dialog; if a checkbox matching `/^Submit with \d+ unconfirmed values$/` is visible, check it; check "Entire text checked"; click "Submit case"; expect "Case submitted". Drop the "Continue and submit" branch. Update `decision-semantics.spec.ts` (the dialog now shows the section "Unconfirmed values · 1 finding" instead of "1 annotation has defaulted axis values").
- [ ] Browser under the Playwright lock (port 18774), batches: (1) `submit-unconfirmed.spec.ts decision-semantics.spec.ts values-block.spec.ts`; (2) `workflow.spec.ts review-flow.spec.ts carried-review.spec.ts reanchor.spec.ts variants.spec.ts editor-layout.spec.ts` (only fix those broken by the dialog; report others).
- [ ] DESIGN.md: Submit dialog wording (search "submit dialog" in Components/Do's): the "Unconfirmed values · {n} finding(s)" section with per-row "Confirm" / "Go to", "Confirm all (n)", the checkbox "Submit with {n} unconfirmed values" and its hint, the rule-on blocking, "Submit case" as the only primary label, focus after confirm. **On behalf of AR**, replace in the term-search row the sentence "… and its definition clamped to one line (`candidate-def is-clamped`) except on the active hit." by: "… and its definition clamped to two lines (`-webkit-line-clamp: 2`) in every state; every row reserves the `Kbd` Enter slot (`candidate-enter`, `visibility: hidden` unless active), so rows never change height and only fill and the inset accent bar mark the active hit. Between the hint and the list a fixed-height detail area (`search-detail`, five `size-sm` lines, `surface-sunken`, `radius-sm`, scrolls inside, `aria-hidden`) shows the active hit: label, code, full definition ("No definition." without one), "Matched: {term}" and the obsolete line; it is absent without hits. While the user has not typed, an adjusted pending mark re-prefills the query (normal debounce)."
- [ ] Commits `feat(editor): confirm unconfirmed values in the submit dialog` and `feat(editor): acknowledge unconfirmed values in one click`. Gate with all AV + AS owned paths. Hand back (both WPs in one report, separate SHAs).

**Acceptance:** spec F2 tests green; one user click submits with ticked values (D1); the server set wins; rule on blocks; focus never falls to `body`.

### AR — Term search: constant rows, two-line clamp, detail area; re-prefill for F1

**Goal:** spec "F4" (D6) and the search half of "F1" target 2 ("Search follows the span"), plus the Values heading-row CSS for AV. **Size S. Review: no.**

**Owns:** `frontend/src/editor/SearchPanel.tsx`, `frontend/src/styles/screens/editor.css`, `frontend/tests/searchPanel.test.tsx`, `frontend/browser/annotation-loop.spec.ts`.

**Tests that break:** `searchPanel.test.tsx` assertions on `is-clamped` and on `Kbd` Enter only in the active row (find with `grep -n "is-clamped\|Enter" frontend/tests/searchPanel.test.tsx`) — update. Run by hand and report (not owned): `grep -rln "SearchPanel\|candidate-card" frontend/tests` (at least `caseScreen.test.tsx`, `searchLanguages.test.tsx`, `annotationPanelStyles.test.ts`, `quickFixStyles.test.ts`, and any `frontend/tests/consolidation/*` that renders it); a `getByText("Enter")` that now finds several rows is reported to slot 1.

**Tests to add (`searchPanel.test.tsx`):**

1. `every row reserves the Enter slot` — 3 hits → 3 `.candidate-enter` elements, each `aria-hidden="true"`.
2. `definitions keep one class in every state` — after ↓ the class lists of all `.candidate-def` are identical and none has `is-clamped`.
3. `detail area shows the active hit and follows ↓` — `[data-search-detail]` has `aria-hidden="true"`, shows label, code and full definition of hit 1; after ↓ of hit 2; "Matched: Muscle weakness" for a synonym match; "Obsolete term (assignment not allowed)" for an obsolete active hit is impossible (obsolete hits are skipped), so test it with `canAssign={false}` (the detail shows the first hit); "No definition." without a definition.
4. `no detail area without hits, while searching or on error`.
5. `a changed prefill re-prefills while the user has not typed` — `vi.useFakeTimers()`, render with `initialQuery="sever"`, rerender with `initialQuery="severe hypotonia"` → field value updated; `searchManager.search` called with the new query only after 250 ms.
6. `a changed prefill is ignored after typing or clearing` — type "x" (or click "Clear search"), rerender with a new `initialQuery` → field unchanged, no new search.

**Browser (`annotation-loop.spec.ts`, port 18775):** `hit rows keep their positions while ↓ moves the active hit` — `startLoop`, open `loop-en`, mark a word, type a generic query that gives ≥ 6 hits in the fixture ontology (try "abnormal"; report the query used), record every option's `getBoundingClientRect().top` and the field's, press ↓ five times, assert each top unchanged (± 0.5 px). Also axe stays clean in the existing "axe has no violations with the combobox open" test.

**Steps:**

- [ ] Red tests.
- [ ] `SearchPanel.tsx` re-prefill: replace the late-prefill effect (~`:107-124`) by

  ```ts
  // The prefill follows the marked text (late search languages, an adjusted mark) until the user types or clears:
  // the first one runs at once and is shown selected; later ones wait for the normal debounce.
  const prefillSettled = useRef(!!initialQuery?.trim());
  const lastPrefill = useRef(initialQuery ?? "");
  const userTyped = useRef(false);
  const selectPrefill = useRef(false);
  useEffect(() => {
    if (userTyped.current || !initialQuery?.trim()) return;
    if (prefillSettled.current && initialQuery === lastPrefill.current) return;
    const identity = [
      annotationId,
      workspaceKey,
      layerId,
      searchManager,
    ] as const;
    if (
      !identity.every((value, index) =>
        Object.is(value, mountIdentity.current[index]),
      )
    )
      return;
    const first = !prefillSettled.current;
    prefillSettled.current = true;
    lastPrefill.current = initialQuery;
    selectPrefill.current = true;
    setQueryInput(initialQuery);
    runSearch(initialQuery, first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);
  ```

  and set `userTyped.current = true` in `handleClear`.

- [ ] Rows (~`:300-339`): always render `{canAssign && <span className="candidate-enter" aria-hidden="true"><Kbd>Enter</Kbd></span>}` in the header; definition `<div className="candidate-def">`. Detail area after the hint `form-group` and the failed message, before the list:

  ```tsx
  {
    expanded &&
      (() => {
        const hit = candidates[shownActive >= 0 ? shownActive : 0];
        return (
          <div className="search-detail" data-search-detail aria-hidden="true">
            <p className="search-detail__head">
              <strong>{hit.label}</strong>{" "}
              <span className="candidate-id">{hit.term_id}</span>
            </p>
            <p>{hit.definition || "No definition."}</p>
            {matchLine(hit) && hit.matched_term && (
              <p className="search-detail__match">
                Matched: {hit.matched_term}
              </p>
            )}
            {hit.obsolete && (
              <p className="warning-badge">
                Obsolete term (assignment not allowed)
              </p>
            )}
          </div>
        );
      })();
  }
  ```

  Options keep the full definition in their DOM (the clamp is visual), so screen readers read it as today.

- [ ] `editor.css`: remove `transition` from `.candidate-card` (~`:415`), the `.candidate-def.is-clamped` rule (~`:1168`) and `.candidate-card[aria-selected="true"] .candidate-def` (~`:1164`); add outside the Values block

  ```css
  .candidate-def {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }
  .candidate-enter {
    visibility: hidden;
  }
  .candidate-card[aria-selected="true"] .candidate-enter {
    visibility: visible;
  }
  .search-detail {
    box-sizing: border-box;
    height: calc(5 * var(--leading-sm) + 2 * var(--space-2));
    margin-top: var(--space-2);
    padding: var(--space-2);
    overflow-y: auto;
    background: var(--surface-sunken);
    border-radius: var(--radius-sm);
    font-size: var(--size-sm);
    line-height: var(--leading-sm);
  }
  .search-detail p {
    margin: 0;
  }
  @media (forced-colors: active) {
    .search-detail {
      border: 1px solid CanvasText;
    }
  }
  ```

  **On behalf of AV**, inside the Values block markers: replace `.values-section .values-confirm { margin-top: var(--space-1); }` by `.values-section .values-confirm { flex-shrink: 0; }` and add `.values-section .values-heading-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }` and `.values-section .values-heading-row h3 { margin: 0; }`.

- [ ] Commit the re-prefill change and its two tests first as `feat(editor): re-prefill the term search while untyped`; then green the rest, run the browser test under the lock and commit `feat(editor): stable term hit list with a detail area`. Gate. Hand back (name the DESIGN.md row text AS writes on your behalf if you deviated from it).

**Acceptance:** rows never change height on ↓/↑/hover; detail area fixed; re-prefill only until typed or cleared.

### AT — My tasks status tabs

**Goal:** spec "F7" (D3). **Size S. Review: no.**

**Owns:** `frontend/src/tasks/MyTasks.tsx`, `frontend/src/app/router.ts`, `frontend/src/App.tsx` (pass `status`, landing guard), `frontend/tests/myTasks.test.tsx`, `frontend/tests/router.test.ts`, `frontend/tests/landing.test.tsx` (one added test), `frontend/browser/quick-fixes.spec.ts` (new F7 test only).

**Tests that break:** `myTasks.test.tsx` "counts reopened as Open without altering its visible status" (~`:76`), "shows pauses alongside underlying status…" (~`:83`, if it reads the counts list), "hides filter and counts for a lead without tasks" (~`:328`), "renders four count items without glyph separators that add up" (~`:355`), "names the filtered scope in the counts label" (~`:366`) — rewrite for tabs.

**Tests to add:**

- `router.test.ts`: `#/?status=submitted` ↔ `{ name: "tasks", status: "submitted" }`; with project `#/?project=p1&status=todo` round-trip; `status=all` kept; `status=bogus` → `{ name: "tasks" }`.
- `myTasks.test.tsx` `describe("My tasks status tabs")`: tablist "Task status" with "To do", "Submitted", "All" and counts (To do = status ≠ submitted, held included, the same set as the nav count; Submitted; All); "Paused" only when n > 0 or active; counts respect the project filter; default (no `status`) selects "All"; the table is `role="tabpanel"` labelled by the active tab; a plain click on "Submitted" calls `onNavigate({ name: "tasks", project, status: "submitted" })`, and each tab's `href` carries `status` (All: `status=all`); empty tabs: "Nothing to do here." / "No submitted tasks yet." / "No paused tasks." with the link "Show all tasks" (`status: "all"`, project kept); zero tasks overall keeps "No documents are assigned to you yet.".
- `landing.test.tsx`: `does not redirect #/?status=all` (a lead with a remembered project stays on My tasks).
- `quick-fixes.spec.ts`: `F7: status tabs switch and survive a reload` (annotator with an open and a submitted task: "Submitted" shows one row; reload keeps `status=submitted` and the tab).

**Steps:**

- [ ] Red tests.
- [ ] `router.ts`: `TaskStatusTab`, `TASK_STATUS_TABS`, `isTaskStatusTab`; route union; `parseRoute` for `#/` reads `project` and `status` (unknown status omitted); `routeHref` `#/${querySuffix([["project", route.project], ["status", route.status]])}`.
- [ ] `MyTasks.tsx`: prop `status?: TaskStatusTab`; `const active = status ?? "all"`; predicates `todo: t => t.status !== "submitted"`, `paused: t => t.held`, `submitted: t => t.status === "submitted"`, `all: () => true` over `filtered`; replace the `task-counts` counts list (~`:151-156`, keep the guideline-links list) by `<Tabs label="Task status" panelId="my-tasks-panel" …>` from `ui/Tabs.tsx` (labels "To do", "Paused", "Submitted", "All"; `href` = `routeHref({ name: "tasks", project, status: id })`; `onSelect` navigates); wrap the table/empty state in `<div role="tabpanel" id="my-tasks-panel" aria-labelledby={tabId("my-tasks-panel", active)}>`; tabs only when `tasks.length > 0`.
- [ ] `App.tsx`: `<MyTasks project={route.project} status={route.status} …/>`; landing state initial value and effect require `route.status === undefined` as well as `route.project === undefined`.
- [ ] Green; browser under the lock (port 18776): `quick-fixes.spec.ts` (whole file, to see Q3 still green).
- [ ] Commit `feat(tasks): status tabs on My tasks`. Gate. Hand back.

**Acceptance:** spec F7 tests green; filtering client-side only; nav count unchanged.

### AP — Pending mark: handles, bar at the mark, Discard, Esc

**Goal:** spec "F1" (all targets except the search re-prefill, which AR built). Spec WP "Markierung anpassen" (Nr. 1): starts only after the acceptance-fixes merge (satisfied: wave 2). **Size M. Review: no.**

**Owns:** `frontend/src/app/CaseScreen.tsx`, `frontend/src/editor/TextPane.tsx`, `frontend/src/editor/PendingMarkBar.tsx` (new), `frontend/src/spans/adapter.ts`, `frontend/src/vendor/spans.js`, `frontend/src/styles/screens/editor.css`, `frontend/tests/caseScreen.test.tsx`, `frontend/tests/spanResize.test.ts`, `frontend/tests/textPaneMarkers.test.tsx`, `frontend/tests/pendingMarkBar.test.tsx` (new), `frontend/browser/spans-resize.spec.ts`, `frontend/browser/annotation-loop.spec.ts`. Conditional: `frontend/tests/assignmentEditor.test.tsx`, `frontend/browser/tree.spec.ts` (only the ≤ 700 px bar's "Cancel").

**Tests that break:** `caseScreen.test.tsx` tests that click the inspector "Cancel" of a **marked span** (check `grep -n '"Cancel"' frontend/tests/caseScreen.test.tsx`, candidates ~`:147`, `:225`, `:1787`, `:1801`, `:1947`; spanless, re-anchor and carried keep "Cancel") and the ≤ 700 px bar test (~`:1162-1180`, `within(bar).getByRole("button", { name: "Cancel" })`) → "Discard"; `annotation-loop.spec.ts` "/ and Esc" (~`:319`) if it asserts the old status; `spans-resize.spec.ts` unchanged except new tests. Check `grep -rn "Clear selection / cancel adding" frontend` for the old help text.

**Tests to add:**

- `spanResize.test.ts`: `setResizable labels name the handles` ("Start of marked text"/"End of marked text" for the labelled id, defaults for others); `flushResize reports a waiting keyboard step at once` (focus a handle, ArrowRight, `flushResize()` → `onResize` called before the timer).
- `textPaneMarkers.test.tsx`: `resizableLabels reach the handles`; `flushResizeRef flushes the editor`.
- `pendingMarkBar.test.tsx`: `role="group"` named "Marked text" with "Drag the edges to adjust" and "Discard" (`aria-keyshortcuts="Escape"`, `Kbd` Esc aria-hidden); positioned below the last rect of the mark (mock `getClientRects`/`getBoundingClientRect`); flipped above near the pane bottom; class `is-hidden` when the mark is outside the pane; Discard calls `onDiscard`.
- `caseScreen.test.tsx`:
  1. `the pending mark is resizable` — mark text → `.resize-handle` named "Start of marked text" and "End of marked text" exist for the pending mark; no other mention has handles.
  2. `moving a pending edge updates the mark locally without a mutation` — focus "End of marked text", ArrowRight, advance the vendor pause (fake timers) → the inspector quote shows the longer text, polite status "Marked text: “…”", `applyCommand` not called.
  3. `the search follows the adjusted span until typed` — the combobox value equals `prefillQuery` of the new segments after the debounce; after typing, a further adjustment leaves it.
  4. `choosing a term during a keyboard pause saves the adjusted segments` — ArrowRight on the end handle, then click a hit (focus stays on the handle) → `create_annotation` payload `segments` = adjusted.
  5. `Esc in the text pane discards the marked text` — keyDown Escape on `.text-container` → region "New finding" gone, status "Marked text discarded.", text focus request at the old end.
  6. `Esc on an inspector button discards`; `Esc inside a dialog or drawer does not discard` (open the `?` help dialog, press Escape → the pending mark stays).
  7. `the inspector heading row has Discard and the adjust hint; no bottom Cancel for a marked span` — hint "Adjust the marked text with its edge handles, or mark new text to replace it."
  8. `spanless, re-anchor and carried findings keep Cancel and get no handles`.
  9. `at 700 px the New finding bar offers Discard` (rewritten from ~`:1162`).
  10. `above 700 px the Marked text bar is shown and Discard discards`.
  11. `? help lists Esc as "Discard the marked text / clear selection / cancel adding a mention"`.
- Browser (port 18774): `spans-resize.spec.ts` `pending mark: drag the end handle, choose a term, saved segments equal the adjusted span` (read the segments from the `create_annotation` request); `pending mark: keyboard Tab to the handle, → twice, Enter in the search`; `annotation-loop.spec.ts` `Esc from the text discards the marked text` and `the Marked text bar never moves the text` (bounding box of the first paragraph equal before marking, with the bar, after Discard). Evidence `pending-mark-bar.png`.

**Steps:**

- [ ] Red tests (unit first).
- [ ] `vendor/spans.js`: `setResizable(mentionIds, labels)` stores `this.resizableLabels = labels || {}` (rest unchanged); `_handleNode` uses `this.resizableLabels?.[handle.mentionId]?.[handle.edge]` before the default "Start of mention"/"End of mention" (title text unchanged); add

  ```js
  /** Reports a keyboard resize that still waits for its pause (before a term is chosen). */
  flushResize() {
    this._flushKeyResize();
  }
  ```

- [ ] `spans/adapter.ts`: `setResizable: (ids, labels) => editor.setResizable(ids, labels)`, `flushResize: () => editor.flushResize()` (types per Shared contracts). `TextPane.tsx`: props `resizableLabels`, `flushResizeRef`; `resizableKey` includes `JSON.stringify(resizableLabels ?? {})`; `handle.setResizable(latestResizable.current, latestLabels.current)` in both places; `useEffect(() => { if (!flushResizeRef) return; flushResizeRef.current = () => handleRef.current?.flushResize(); return () => { flushResizeRef.current = null; }; }, [flushResizeRef])`.
- [ ] `PendingMarkBar.tsx`:

  ```tsx
  import { useCallback, useLayoutEffect, useRef, useState } from "react";
  import { Button } from "../ui/Button";
  import { Kbd } from "../ui/Kbd";

  export interface PendingMarkBarProps {
    /** The text scrollport (`.text-container`); the bar hides while the mark is outside it. */
    textElement: HTMLElement | null;
    evidenceId: string;
    /** Changes when the mark moved; re-places the bar. */
    segmentsKey: string;
    onDiscard: () => void;
  }
  const GAP = 4;
  const EDGE = 8;

  /** Bar under the pending mark (≥ 700 px): absolute over the text, never reflows it, not modal. */
  export function PendingMarkBar({
    textElement,
    evidenceId,
    segmentsKey,
    onDiscard,
  }: PendingMarkBarProps): JSX.Element {
    const bar = useRef<HTMLDivElement>(null);
    const [place, setPlace] = useState<{ top: number; left: number } | null>(
      null,
    );
    const update = useCallback(() => {
      const node = bar.current;
      const parent = node?.offsetParent as HTMLElement | null;
      if (!node || !parent || !textElement) return;
      const rects = Array.from(
        textElement.querySelectorAll<HTMLElement>(".run[data-mentions]"),
      )
        .filter((run) =>
          (run.dataset.mentions ?? "").split(",").includes(evidenceId),
        )
        .flatMap((run) => Array.from(run.getClientRects()));
      const pane = textElement.getBoundingClientRect();
      if (
        !rects.length ||
        rects[rects.length - 1].bottom < pane.top ||
        rects[0].top > pane.bottom
      ) {
        setPlace(null);
        return;
      }
      const first = rects[0],
        last = rects[rects.length - 1],
        origin = parent.getBoundingClientRect();
      const below = last.bottom + GAP;
      const top =
        below + node.offsetHeight > pane.bottom - EDGE
          ? first.top - GAP - node.offsetHeight
          : below;
      const left = Math.min(
        Math.max(last.left, pane.left + EDGE),
        pane.right - node.offsetWidth - EDGE,
      );
      setPlace({
        top: top - origin.top + parent.scrollTop,
        left: left - origin.left + parent.scrollLeft,
      });
    }, [textElement, evidenceId]);
    useLayoutEffect(() => {
      update();
      window.addEventListener("resize", update);
      window.addEventListener("scroll", update, true);
      return () => {
        window.removeEventListener("resize", update);
        window.removeEventListener("scroll", update, true);
      };
    }, [update, segmentsKey]);
    return (
      <div
        ref={bar}
        role="group"
        aria-label="Marked text"
        className={`pending-mark-bar${place ? "" : " is-hidden"}`}
        style={
          place ? { top: `${place.top}px`, left: `${place.left}px` } : undefined
        }
      >
        <span className="pending-mark-bar__hint">Drag the edges to adjust</span>
        <Button
          type="button"
          variant="quiet"
          size="sm"
          aria-keyshortcuts="Escape"
          onClick={onDiscard}
        >
          Discard
          <span aria-hidden="true">
            {" "}
            <Kbd>Esc</Kbd>
          </span>
        </Button>
      </div>
    );
  }
  ```

  CSS (`editor.css`, next to `.pending-bar`): `.pending-mark-bar { position: absolute; z-index: 5; display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-2); background: var(--surface-raised); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); box-shadow: var(--shadow-1); }`, `.pending-mark-bar.is-hidden { visibility: hidden; }` (measurable, out of the a11y tree and Tab order), `.pending-mark-bar__hint { font-size: var(--size-xs); color: var(--text-muted); }`, forced colours `border-color: CanvasText`. Verify every token exists in `tokens.css`.

- [ ] `CaseScreen.tsx`:
  - constants `PENDING_HANDLE_LABELS = { start: "Start of marked text", end: "End of marked text" }`; `pendingSegments = useRef<{ evidenceId: string; segments: SelectionPayload["segments"] } | null>(null)`; `flushTextResize = useRef<(() => void) | null>(null)`.
  - `resizableEvidenceIds` (~`:2072`):

    ```ts
    const pendingEvidenceId = pendingIsMarkedSpan
      ? pendingAnnotation?.evidenceId
      : undefined;
    const resizableEvidenceIds =
      readOnly || isAttachingMention
        ? []
        : pendingEvidenceId
          ? [pendingEvidenceId]
          : selectedAnnotation &&
              !pendingAnnotation &&
              editableLayerIds.includes(selectedAnnotation.annotation.layer_id)
            ? (selectedAnnotation.annotation.evidence_refs ?? []).map(
                (r) => r.evidence_id,
              )
            : [];
    const resizableLabels = pendingEvidenceId
      ? { [pendingEvidenceId]: PENDING_HANDLE_LABELS }
      : undefined;
    ```

  - `handleResizeMention` (~`:1803`) first branch: for the pending id store `pendingSegments.current`, `setPendingAnnotation(current => current?.evidenceId === evidenceId ? { ...current, segments } : current)`, `announceCarried(`Marked text: “${quoteSegments(view.document.text, segments, 40)}”`)`, return (no mutation). The prefill follows automatically: `pendingSearchProps` derives `initialQuery` from `pending.segments`, and AR's `SearchPanel` re-prefills while untyped.
  - `createPendingAnnotation` (~`:1560`): first `flushTextResize.current?.()`; then `const pending = pendingSegments.current?.evidenceId === pendingAnnotation.evidenceId ? { ...pendingAnnotation, segments: pendingSegments.current.segments } : pendingAnnotation;`. Clear `pendingSegments.current` in `cancelPending` and after a successful create.
  - `discardPending()`: end = max segment end; `cancelPending()`; `setTextFocusRequest({ offset: end })`; `announceCarried("Marked text discarded.")`. Use it for the marked-span `onEscape` in `pendingSearchProps`, the inspector "Discard", both bars.
  - Escape shortcut (~`:2497`): new first branch

    ```ts
    if (pendingIsMarkedSpan && !readOnly) {
      // A drawer or dialog owns its Escape (same rule as TextPane's attach mode).
      if (
        event.target instanceof Element &&
        event.target.closest(".ui-drawer, [role='dialog']")
      )
        return false;
      discardPending();
      return;
    }
    ```

    with the handler signature `(event) => …` and description "Discard the marked text / clear selection / cancel adding a mention". A focused handle with an unsaved keyboard step keeps the vendor's own Escape first (it takes the step back and stops the key); a second Escape discards.

  - `TextPane` props: `resizableLabels={resizableLabels}`, `flushResizeRef={flushTextResize}`. After `<TextPane …/>` (~`:3005`): `{!panesLayout && pendingIsMarkedSpan && !readOnly && pendingAnnotation?.evidenceId && <PendingMarkBar textElement={leftTextElement} evidenceId={pendingAnnotation.evidenceId} segmentsKey={JSON.stringify(pendingAnnotation.segments)} onDiscard={discardPending} />}` (check the state name of the text element set by `onTextElement`).
  - ≤ 700 px bar (~`:3006-3017`): "Cancel" → "Discard" (`discardPending`).
  - Inspector "New finding" (~`:3046-3088`): heading row `div.term-heading-row` with the `h2` and, for `pendingIsMarkedSpan`, `Button variant="quiet" size="sm" aria-keyshortcuts="Escape"` "Discard" + `Kbd` Esc (aria-hidden); under the quote `<p className="form-hint">Adjust the marked text with its edge handles, or mark new text to replace it.</p>`; render the bottom "Cancel" only when `!pendingIsMarkedSpan`.
  - Hint row (~`:2539`): "Move the focused mention edge (Tab to an edge handle of the selected annotation or the marked text)".
- [ ] Green (unit), then browser batches under the lock (port 18774): `spans-resize.spec.ts annotation-loop.spec.ts tree.spec.ts compare.spec.ts reanchor.spec.ts`.
- [ ] Commits `feat(editor): adjust a pending mark with its edge handles` and `feat(editor): discard a pending mark with Esc or Discard`. Gate. Hand back with the DESIGN.md wording AH writes for you if you deviated (see AH).

**Acceptance:** spec F1 tests green; no mutation before a term is chosen; the text never moves; Esc never fires through a dialog or drawer.

### AH — Sidebar project switcher, Projects page, last-used landing

**Goal:** spec "F8" (D4), deviations 4 and 5; DESIGN.md rows for F7, F8 and (on behalf of AP) F1. **Size L. Review: yes.**

**Owns:** `frontend/src/app/ProjectPicker.tsx` (becomes `ProjectSwitcher`), `frontend/src/app/ProjectsPage.tsx` (new), `frontend/src/app/Shell.tsx`, `frontend/src/ui/AppShell.tsx` (only if the header needs a change), `frontend/src/ui/Popover.tsx`, `frontend/src/app/router.ts`, `frontend/src/app/lastProject.ts`, `frontend/src/App.tsx`, `frontend/src/styles/components.css`, `frontend/tests/projectPicker.test.tsx`, `frontend/tests/projectsPage.test.tsx` (new), `frontend/tests/lastProject.test.ts` (new), `frontend/tests/landing.test.tsx`, `frontend/tests/shell.test.tsx`, `frontend/tests/router.test.ts`, `frontend/tests/ui/popover.test.tsx`, `frontend/tests/ui/styles.test.ts`, `frontend/browser/helpers.ts` (`LAUNCH_URL`), `frontend/browser/lead-workflow.spec.ts`, `frontend/browser/admin.spec.ts`, `frontend/browser/quick-fixes.spec.ts`, `DESIGN.md`. Conditional (landing fallout): `frontend/browser/lead-workflow-a11y.spec.ts`, `design.spec.ts`, `translations.spec.ts`, `translation-review.spec.ts`, `review-flow.spec.ts`, `guidelines.spec.ts`, `workflow.spec.ts`, `layers.spec.ts`, `documents-walkthrough.spec.ts`, `decision-semantics.spec.ts`, `reviewFlowHelpers.ts`, `overviewHelpers.ts`, `frontend/tests/accountNavigation.test.tsx`, `frontend/tests/sidebar*.test.tsx`.

**Tests that break:** all of `projectPicker.test.tsx` (disclosure → combobox; rewrite); `shell.test.tsx` ~`:80` (`/^Current project: /`, `#shell-project-panel`) and the "Current project sections" assertions if the remembered-project fallback shows the group; `landing.test.tsx` "landing (D7)" block (lead-only rules, "falls back to the first led project", "keeps users who lead nothing on My tasks") and "last project storage" ("skips projects the user no longer leads"); `ui/styles.test.ts` ~`:20` (`.shell-project-link:focus-visible` in the forced-colours focus rule; rename to the new link class); browser `admin.spec.ts` ~`:117-124` (`.shell-project-trigger`, `#shell-project-panel`, landing wait), `quick-fixes.spec.ts` Q3 (~`:168-214`), `lead-workflow.spec.ts` landing tests (~`:500-560`). After `LAUNCH_URL` changes, specs that expect the landing after `loginAs` must go to `/#/` explicitly. Find the rest with `grep -rln "shell-project\|Current project\|ProjectPicker\|landingProject\|Loading your projects\|LAUNCH_URL\|goto(\"/#/\")" frontend/tests frontend/browser`.

**Tests to add:**

- `router.test.ts`: `#/projects` ↔ `{ name: "projects" }`; `#/projects/new` still `projectNew`.
- `lastProject.test.ts`: remembered and in `projects` → that key for any role; not in `projects` → `undefined`; nothing remembered → `undefined`; per-user keys; storage unavailable → `undefined`.
- `landing.test.tsx` (D4): lead with remembered p2 → `#/projects/p2/documents` (`segment=decision` when `needs_decision > 0`) with replace; annotator with remembered p1 → `#/?project=p1`; nothing remembered → `#/projects`; remembered but inaccessible → `#/projects`; no project at all → `#/projects` with "You are not a member of any project yet."; deep links and `#/?status=all` are not redirected; visiting `#/?project=p3` remembers p3.
- `projectPicker.test.tsx` (switcher): button in the nav, two lines "Project" / "First study", name "Project: First study, switch project", `aria-haspopup="dialog"`, `aria-expanded`, `aria-keyshortcuts="Alt+P"`; "Choose project" without a current project; opening focuses the combobox "Find project" (`aria-controls` the listbox "Projects", `aria-activedescendant`); options show name and "{key} · {roles} · opens Documents" / "… · opens My tasks", the current one "✓ Current" (icon + text); typing filters by name and key, case-insensitive, at every list length; "No matching projects." as `role="status"`; ↓/↑ move the active option and never navigate; Enter opens the active project (`onChoose` + `onNavigate(projectDestination(…))`) and closes; Ctrl+Enter / Cmd+Enter calls `window.open(href, "_blank", "noopener")`; each option holds a real link with `tabindex="-1"`, modified clicks keep the browser default; "All projects" link to `#/projects` after a separator; Esc closes and focuses the button; outside pointer-down closes; Tab out closes; route change closes; `Alt+P` opens from anywhere, also with `event.key === "π"` and `event.code === "KeyP"`, also from a text field, not while a modal dialog is open; in the reading shell `Alt+P` opens the closed "Sections" disclosure first.
- `ui/popover.test.tsx`: `closeOnTabOut` closes on Tab from the last focusable and on Shift+Tab from the first, without `preventDefault`; default keeps cycling.
- `shell.test.tsx`: the switcher is the first element of the nav; no project control in the header actions; nav "Projects" after "My tasks" when the user has ≥ 1 project, absent with none; reading density: the switcher is the first item inside "Sections".
- `projectsPage.test.tsx`: `h1` "Projects"; "Find project" only above 6 projects; `DataTable` columns Project (name, "✓ Current" with `aria-current="true"` on the remembered/current project, key below in `text-muted` when it differs), Your roles (`roleLabels`), Needs your decision (leads only: lazy `documentsSummary` per led project; "–" while loading, on failure and for non-leads; cell name "{n} documents need your decision"), Your open tasks (one `listMyTasks`, non-submitted per project), Action "Open" (`projectDestination`) and, for `can_manage`, "Settings"; empty: "You are not a member of any project yet.".
- Browser (port 18775), `lead-workflow.spec.ts`: `demo-lead switches project via the sidebar in two clicks`; `… by keyboard: Alt+P, type, Enter`; `a login with an inaccessible remembered project lands on Projects` (set `localStorage["ontocurator.lastProject.v1:<user>"]` to an unknown key before login); `quick-fixes.spec.ts` Q3 rewritten for the switcher (closes on select, Escape, outside click and Tab-out; arrows and Ctrl+click do not navigate).

**Steps:**

- [ ] Red tests (unit).
- [ ] `router.ts`: `{ name: "projects" }`, `case "#/projects": return { name: "projects" };` before the `projects/…` regexes, `routeHref` `#/projects`.
- [ ] `lastProject.ts`: `landingProject` per Shared contracts; update the doc comments (D4).
- [ ] `App.tsx`: remembered key = `"key" in route ? route.key : route.name === "tasks" && route.project ? route.project : undefined`; landing: `key === undefined` → `requestRef.current({ name: "projects" }, undefined, { replace: true })`; project led (`can_manage && roles.includes("lead")`) → today's Documents path with the summary; otherwise `projectDestination(project)` with replace; `case "projects"` renders `<ProjectsPage projects={projects} currentKey={landingProject(user.username, projects)} onNavigate={go} />` (the last-used project is the current one there; wait for `projectContext` like Documents).
- [ ] `ui/Popover.tsx`: `closeOnTabOut` prop; in `onKeyDown`, when set and Tab leaves at either end, call `onClose()` and do not `preventDefault`.
- [ ] `ProjectPicker.tsx` → `ProjectSwitcher` (same props as `ProjectPicker`): trigger `button.project-switcher` (two lines `project-switcher__label` "Project" `size-xs` muted / `project-switcher__name` strong, chevron icon right, full nav width, bordered); `Popover` (`label="Switch project"`, `anchorRef` = trigger, `closeOnTabOut`, `width` ≈ 320; below 700 px its sheet mode); inside: `input` `role="combobox"` "Find project" with `aria-autocomplete="list"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`; `ul role="listbox" aria-label="Projects"` of `li role="option"` (`aria-selected` = active) each containing `<a tabIndex={-1} href={routeHref(projectDestination(item))}>`; key handling on the field: ArrowDown/ArrowUp clamp the active index, Enter navigates the active option (`event.ctrlKey || event.metaKey` → `window.open(href, "_blank", "noopener")`), Escape is the Popover's; plain option click → `onChoose`, `onNavigate`, close; "All projects" link after `<hr>`; `useShortcut("Alt+P", openFromKey, { scope: "global", allowInInputs: true, group: "Navigation", description: "Switch project" })` where `openFromKey` opens a closed ancestor `details` (`trigger.closest("details")`) before opening; close on route change. Keep `projectDestination` and `PROJECT_SEARCH_THRESHOLD` exports (the page uses the threshold).
- [ ] `Shell.tsx`: render `<ProjectSwitcher …/>` as the first child of `nav` when `projects.length > 0`; drop `actions={selector}`; `currentKey = explicitKey ?? choice ?? (remembered project if it is in projects)`; add `link({ name: "projects" }, "Projects")` after "My tasks" when `projects.length > 0`.
- [ ] `ProjectsPage.tsx` per the tests (DataTable, `EmptyState`, `TextInput` "Find project", lazy summaries with `Promise.allSettled`, links with plain-click `onNavigate`).
- [ ] `components.css`: replace the `.shell-project-*` header styles by `.project-switcher*` (nav width, `border-strong`, `radius-sm`, `surface-raised`, focus ring, forced colours `CanvasText` border, active option `Highlight`) and the switcher list styles; keep the 900/700 px rules working (the switcher is part of the nav band below 900 px); update the forced-colours focus selector list and `tests/ui/styles.test.ts`.
- [ ] Green (unit). `browser/helpers.ts`: `export const LAUNCH_URL = "/#/?status=all";` (My tasks explicitly, so ordinary specs never hit the landing redirect); in specs that test the landing use `page.goto("/#/")` after login.
- [ ] Browser under the lock (port 18775) in batches: (1) `lead-workflow.spec.ts admin.spec.ts quick-fixes.spec.ts lead-workflow-a11y.spec.ts`; (2) `design.spec.ts translations.spec.ts translation-review.spec.ts review-flow.spec.ts guidelines.spec.ts`; (3) `workflow.spec.ts layers.spec.ts documents-walkthrough.spec.ts decision-semantics.spec.ts tree.spec.ts`. Fix landing/picker fallout in the conditional Owns; report anything else.
- [ ] DESIGN.md (the wave-2 owner): `AppShell` row and the Layout paragraph (project switcher at the top of the sidebar, first item of "Sections" in the reading shell; header keeps product, breadcrumb, user, Log out); new rows "Project switcher (`app/ProjectPicker.tsx`)" and "Projects page (`app/ProjectsPage.tsx`)" with the copy of spec F8; landing rule (last-used project for every role, Projects page otherwise, D4); Shortcuts "Navigation" group: "Alt + P: Switch project". **On behalf of AT:** My tasks status tabs (`Tabs` "Task status": "To do (n)" = open, reopened, in progress incl. paused; "Paused (n)" only when n > 0; "Submitted (n)"; "All (n)" default; route `status`; empty states). **On behalf of AP:** in "Marking-mode line" or the editor section: the pending mark gets edge handles ("Start/End of marked text"), adjusting it re-prefills the search until typed; ≥ 700 px a "Marked text" bar below the mark ("Drag the edges to adjust" · "Discard" `Kbd` Esc; absolute over the text, flips above near the pane bottom, hides with the mark, `surface-raised`, `border-strong`, `shadow-1`); the inspector "New finding" heading row "Discard" and the hint "Adjust the marked text with its edge handles, or mark new text to replace it."; ≤ 700 px the "New finding" bar reads "Discard"; Esc anywhere in the editor discards (not inside a dialog or drawer), status "Marked text discarded."; in Shortcuts "General": "Esc: Discard the marked text / clear selection / cancel adding a mention".
- [ ] Commits `feat(shell): project switcher in the sidebar`, `feat(projects): Projects page and last-used landing`, `docs(design): annotator acceptance UI rows`. Gate. Hand back.

**Acceptance:** spec F8 tests green; arrows never navigate; modified clicks keep browser behaviour; landing rules per the spec table; the full browser batch list is green or every remaining failure is reported with its cause.

## Final phase (wave 3, main session)

- [ ] Wait until every WP and both review fixes are committed; `git status` clean; remove stale locks.
- [ ] One `superpowers:code-reviewer` pass over `git diff main...feat/annotator-acceptance-ui` against the spec (focus: the acknowledgement flow and its single resend, focus management in the dialog, Esc ownership, no mutation before a term is chosen, switcher keyboard model and a11y, landing rules, copy verbatim). Findings to `C:/Users/jan-p/Development/ontocurator-reviews/2026-10-21-annotator-acceptance-ui-branch-claude.md`.
- [ ] One fix agent (effort medium) applies the findings, TDD, commits.
- [ ] Full gate alone on the machine: `CHECK_PYTEST_WORKERS=4 CHECK_VITEST_WORKERS=3 HPO_E2E_PORT=18777 bash scripts/check.sh` (no `CHECK_CONTAINERS`). Failures go to the same fix agent.
- [ ] Rebuild the embedded bundle (the frontend changed): `npm --prefix frontend run build`; replace `src/ontocurator/web/index.html` and the `index-*.js`/`index-*.css` in `src/ontocurator/web/assets/` with `frontend/dist/` (remove superseded `index-*` files; keep fonts unless dist changed them); `bash scripts/check.sh --only static`; commit `build: update embedded frontend bundle`.
- [ ] Fast-forward main from the main checkout (on `main`, clean): `git -C C:/Users/jan-p/Development/ontocurator merge --ff-only feat/annotator-acceptance-ui`. No push.
- [ ] Report to the user (German, short): commits, gate result, open points.

## Self-review against the spec

| Spec item                                                                        | WP                                        |
| -------------------------------------------------------------------------------- | ----------------------------------------- |
| F1.1 handles on the pending mark, local segments, vendor labels                  | AP                                        |
| F1.2 search follows the span until typed                                         | AR (SearchPanel), AP (segments → prefill) |
| F1.3 bar at the mark (≥ 700 px)                                                  | AP                                        |
| F1.4 inspector Discard, hint, Cancel only for spanless/re-anchor/carried         | AP                                        |
| F1.5 Esc anywhere, not in dialogs/drawers, focus back to the text                | AP                                        |
| F1.6 ≤ 700 px "Discard"                                                          | AP                                        |
| F1 edge: flush before create (`flushResize`)                                     | AP                                        |
| F3.1–F3.4 click-to-confirm, button on the heading row, hint, announce            | AV (+ AR CSS)                             |
| F2.1–F2.6 section, rows, Confirm / Confirm all (D2), D1 resend, rule on, reasons | AS                                        |
| F2 edges (conflict, paused queue, deleted finding, > 10 rows, server set wins)   | AS                                        |
| F4.1–F4.3 constant rows, detail area (D6), reduced motion                        | AR                                        |
| F7 tabs, route `status`, empty states, D3                                        | AT                                        |
| F8.1–F8.3 switcher, `Alt+P`, combobox/listbox                                    | AH                                        |
| F8.4 Projects page                                                               | AH                                        |
| F8.5 landing (D4)                                                                | AH (AT guards `status`)                   |
| Deviations 1–5, DESIGN.md rows                                                   | AV/AS (wave 1), AH (wave 2)               |
| Start after the acceptance-fixes merge (AP, AR)                                  | Step 0                                    |
| Embedded bundle, ff main                                                         | final phase                               |
