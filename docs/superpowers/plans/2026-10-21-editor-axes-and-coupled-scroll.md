# Editor Axis Values and Coupled Scrolling While Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement both parts of [2026-10-21-editor-axes-and-coupled-scroll-design.md](../specs/2026-10-21-editor-axes-and-coupled-scroll-design.md): the inspector's axis values become one connected segmented control per axis with a warning-coloured unconfirmed default and a measured fit rule (row → stacked → boxes), and the translation review offers coupled scrolling while the reviewer edits (translation pane as fixed leader, debounced pairing recompute that never scrolls) plus a one-off "Show matching paragraph" action (`Alt+M`).

**Architecture:** Part 1 is frontend only: `editor/AnnotationPanel.tsx` renders the new segment markup and the "Default" tag in the label cell; a new pure module `editor/valuesLayout.ts` holds the fit rule with hysteresis and a `useValuesLayout` hook (`ResizeObserver`, `document.fonts.ready`) that writes `data-values-layout` on the section; the three competing CSS rule sets collapse into one block in `styles/screens/editor.css`. Part 2 extends `variants/useCoupledScroll.ts` with four options (`minWidth`, `fixedLeader`, lazy `starts` with a `startsRevision`, `frozenPaneId`) and an `align()` function that shares the hook's programmatic-position map; `translation/TranslationReviewScreen.tsx` then couples while editing, recomputes the translation's paragraph starts 300 ms after the last edit (never during IME composition), and adds the action. No backend change, no migration, no contract change.

**Tech Stack:** React 18, TypeScript, Vitest + Testing Library (jsdom), Playwright + axe-core against `tests/browser_server.py`; Python 3.12 + pytest only for one browser scenario builder.

**Binding inputs:** the spec above (Part 1 sections 1.0–1.7, Part 2 sections 2.0–2.9, "Deviations from earlier specs"); mockup `.superpowers/mockups/overview-editor-guidelines/editor-axes.html` (variant B; where it differs, the spec wins; the mockup's abbreviated values are not adopted); [review-flow spec](../specs/2026-10-20-review-and-annotation-flow-design.md) B.2, B.7, A.1 item 10, A.2, A.6; `DESIGN.md` (tokens only, no new tokens); `PRODUCT.md`.

**Open questions of the spec (proceed with its proposals, confirm first):** (1) keep the stacked step of the fit rule, (2) `Alt+M` as the shortcut, (3) "Show matching paragraph" stays available below 700 px. The orchestrator confirms (1) with the user before X1 starts and (2), (3) before S3 starts; a veto changes only the affected WP block.

---

## Global rules (every WP; a subagent reads only this section and its WP block)

Worktree: `C:/Users/jan-p/Development/ontocurator/.worktrees/editor-axes-scroll` (Git Bash: `/c/Users/jan-p/Development/ontocurator/.worktrees/editor-axes-scroll`), branch `feat/editor-axes-scroll`, created from `main` **after `feat/lead-followups` is merged** (orchestrator check before wave 1: `git merge-base --is-ancestor feat/lead-followups main && echo merged`). Create it with `git worktree add .worktrees/editor-axes-scroll -b feat/editor-axes-scroll main` from the main checkout, then `npm --prefix frontend ci` and `uv sync` in the worktree. Every command runs from the worktree root: `cd /c/Users/jan-p/Development/ontocurator/.worktrees/editor-axes-scroll && …`. All line references below were verified on `feat/lead-followups` (`56ddc77`, contains `main`); after the merge a WP re-checks them with the given `grep -n` and reports drift instead of guessing.

1. **Subagents never commit, push, `git reset`, `git checkout -- <file>`, `git stash` or `git clean`.** They edit on top of the working tree. The orchestrator commits each WP after its done check with the WP's commit message, staging only the WP's owned files (`git add <files>`, never `git add -A`). No AI attribution lines anywhere (no `Co-Authored-By`, no "Generated with").
2. **Exclusive file ownership.** A WP writes only the files in its **Owns** list (tests included). If it needs another file, it stops and reports. Two WPs never own the same file at the same time; shared files follow "Shared-file chains".
3. **Prerequisite checks first.** Run the WP's prerequisite commands; if one fails, stop and report. Never re-implement a missing prerequisite.
4. **Shell.** Git Bash. `rg` is not installed; use `grep -rnE`.
5. **Machine limits (16 GB).** At most **two test-heavy agents at once** on the machine (across all worktrees). Heavy = Playwright, backend pytest touching PostgreSQL, a full Vitest run, any `scripts/check.sh` stage. Light = single Vitest files, `npm --prefix frontend run typecheck`, ruff. Lane **L+** = light, but its one wider Vitest run waits until the orchestrator confirms a free heavy slot. **One Playwright run per worktree at a time.**
6. **Verification rule (user-approved).** WP agents run **only affected checks**: the affected-tests fast path from `docs/operations/local-checks.md` (being added on `chore/test-speed`; if it is not on `main` yet, use the concrete commands of the WP block). Fallback commands: Vitest single files `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/<file>`; `npm --prefix frontend run typecheck`; Playwright single spec files `HPO_E2E_PORT=18766 npm --prefix frontend run test:e2e -- <spec>` (rebuilds `frontend/dist`); single backend files `uv run pytest tests/<file>.py -q`. **The full gate runs once per finished plan** ("Final gate"), never inside a WP.
7. **Playwright port.** This worktree always uses `HPO_E2E_PORT=18766` (`phase0-implementation` uses 18765, `project-guidelines` 18767), so two worktrees never share a server.
8. **Isolated browser scenarios.** Every new or changed Playwright test builds its own fresh project through a test-only scenario route (`/__test_review_flow__`, `/__test_translation_review__`, or the new `/__test_values__` of WP X0). No test of this plan reads or writes the shared `browser-fixture` project or changes the settings of a project another test uses, so the suite can later run with three Playwright workers.
9. **Evidence.** Screenshots only under `build/editor-axes-scroll/evidence/` inside the worktree (resolved as `resolve(test.info().config.rootDir, "../../build/editor-axes-scroll/evidence")`, as in `frontend/browser/annotation-loop.spec.ts:25`). No Playwright scratch files in the main checkout.
10. **Copy and design.** English for all files and UI copy, exactly as the spec's copy tables. `DESIGN.md` tokens only; no new tokens; no new class names except `values-grid` if needed and `axis-default-suffix` (X1). Icons only from `frontend/src/ui/icons.tsx`. Status never by colour alone. Unavailable actions use `aria-disabled` + reason, not native `disabled`, except the native radios whose behaviour is unchanged.
11. **TDD.** Write the listed failing tests first, run them red, implement, run green.
12. **Reviews.** Only L or backend-critical WPs get a WP review; this plan has none. One review per finished plan by the Claude `superpowers:code-reviewer` agent (read-only), then one fix agent at effort medium. No Codex, no `agy`.
13. **Hand-back** (final message): changed/created files (subset of Owns), commands with exit status and one-line result, done checklist item by item, skipped parts and deviations, line-reference drift found, open risks, the commit message.

## Work packages

| WP  | Content                                                                                                                                                                                                                                | Size | Lane   | Branch                  | Depends on                                            | Review              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ | ----------------------- | ----------------------------------------------------- | ------------------- |
| X0  | Browser scenario builder `/__test_values__` (`VALUES_STANDARD`: the spec's standard clinical axes; `VALUES_LONG`: long option values), fixture test, helper                                                                            | S    | H      | feat/editor-axes-scroll | —                                                     | —                   |
| X1  | Values block: measurement first, layout B with segments, warning default, "Default" tag and hint copy, fit rule (row/stacked/boxes) with hysteresis, merged CSS, forced colours, reduced motion, DESIGN.md row, unit and browser tests | M    | PW (H) | feat/editor-axes-scroll | X0; open question 1 confirmed                         | plan review         |
| S1  | `useCoupledScroll`: `minWidth`, `fixedLeader`, lazy starts + `startsRevision` (no rebind), `frozenPaneId`, `align()` with shared programmatic positions                                                                                | M    | L      | feat/editor-axes-scroll | —                                                     | plan review (focus) |
| S2  | Translation review: coupling while editing, request identity without `text`, debounced recompute (300 ms, blur, composition), notes and count copy, 150 ms pair line, 700 px rule, unit tests                                          | M    | L+     | feat/editor-axes-scroll | S1                                                    | plan review         |
| S3  | "Show matching paragraph": anchor rules, alignment, status copy, button, `Alt+M` with `event.code` fallback in `matches()`, help row, DESIGN.md rows                                                                                   | S    | L+     | feat/editor-axes-scroll | S1, S2, X1 (DESIGN.md); open questions 2, 3 confirmed | plan review         |
| SB  | Browser verification of Part 2 in `translation-review.spec.ts` (1440×900, 800×900, 390×844), evidence                                                                                                                                  | M    | PW (H) | feat/editor-axes-scroll | S3; X1's Playwright runs finished                     | plan review         |

Count: 6 WPs (S: X0, S3; M: X1, S1, S2, SB). The spec's "one review for S1+S2 together" is replaced by the single plan review with an explicit focus on `useCoupledScroll` (see "Final gate"); deviation recorded here. The spec puts the browser tests of Part 2 into S2; they move to SB so that S2 and S3 share one Playwright pass after both are done.

## Shared-file chains (one writer at a time, in this order)

| File(s)                                                                                                                                                                                                           | Writers in order                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `tests/browser_server.py` (one import and one registration line only)                                                                                                                                             | X0 only                                                                             |
| `frontend/src/editor/AnnotationPanel.tsx`, `frontend/src/editor/valuesLayout.ts`, `frontend/src/styles/components.css`, `frontend/src/styles/base.css`, `frontend/src/styles/screens/editor.css`                  | X1 only                                                                             |
| `frontend/tests/valuesBlock.test.tsx`, `frontend/tests/valuesLayout.test.ts`, `frontend/tests/annotationPanelStyles.test.ts`, `frontend/browser/annotation-loop.spec.ts`, `frontend/browser/values-block.spec.ts` | X1 only                                                                             |
| `frontend/src/variants/useCoupledScroll.ts`, `frontend/tests/useCoupledScroll.test.tsx`                                                                                                                           | S1 only (S2, S3 import it)                                                          |
| `frontend/src/translation/TranslationReviewScreen.tsx`, `frontend/tests/translationReview.test.tsx`, `frontend/src/translation/labels.ts`                                                                         | S2 → S3                                                                             |
| `frontend/src/translation/TranslationEditor.tsx`, `frontend/tests/paragraphs.test.ts`                                                                                                                             | S2 only                                                                             |
| `frontend/src/ui/shortcuts.ts`, `frontend/tests/ui/shortcuts.test.tsx`                                                                                                                                            | S3 only                                                                             |
| `DESIGN.md`                                                                                                                                                                                                       | X1 ("Values block" row) → S3 ("Translation review layout" row, "Shortcuts" section) |
| `frontend/browser/translation-review.spec.ts`                                                                                                                                                                     | SB only                                                                             |

`frontend/src/variants/ComparePane.tsx` is not owned by any WP: it keeps calling `useCoupledScroll(panes, { enabled })` and gets the defaults (`minWidth` 1100, no fixed leader), which S1 must keep behaviour-identical.

## Dependency graph

```mermaid
flowchart LR
  X0 --> X1
  S1 --> S2 --> S3 --> SB
  X1 -. DESIGN.md .-> S3
  X1 -. one Playwright per worktree .-> SB
  X1 & SB --> Gate
```

## Wave schedule

A wave's WPs may run at the same time (disjoint owned files, ≤ 2 heavy on the machine, ≤ 1 Playwright in this worktree). A WP starts as soon as its prerequisites are done and its files are free.

| Wave | Heavy lane (≤ 2)      | Light lane | Notes                                                                                                   |
| ---- | --------------------- | ---------- | ------------------------------------------------------------------------------------------------------- |
| 1    | X0                    | S1         | Before wave 1: worktree created after the lead-followups merge; open question 1 confirmed.              |
| 2    | X1 (PW)               | S2 (L+)    | X1 holds the worktree's Playwright slot for its Step 1 measurement and its final browser run.           |
| 3    | X1 (if still running) | S3 (L+)    | S3 starts after S2 is committed, X1's DESIGN.md row is committed and open questions 2, 3 are confirmed. |
| 4    | SB (PW)               | —          | After S3 and after X1's last Playwright run.                                                            |
| 5    | Final gate (alone)    | —          | Then the plan review and one fix agent.                                                                 |

## Shared contracts

Fixed names. The producing WP implements them exactly; consumers rely on them.

### `frontend/src/editor/valuesLayout.ts` (X1)

```ts
export type ValuesLayout = "row" | "stacked" | "boxes";
/** Return to a better layout only when the free space exceeds the required width by this much (spec 1.4). */
export const VALUES_HYSTERESIS_PX = 8;

/**
 * required: max-content width of every segmented control (axes with a Select are left out);
 * widths.row: control-cell width in layout B (section content width − 96 px label column − 8 px gap);
 * widths.stacked: full section content width; current: the layout shown now (null on mount).
 */
export function chooseValuesLayout(
  required: readonly number[],
  widths: { row: number; stacked: number },
  current: ValuesLayout | null,
): ValuesLayout {
  const order: ValuesLayout[] = ["row", "stacked", "boxes"];
  for (const layout of order) {
    if (layout === "boxes") return layout;
    const better =
      current !== null && order.indexOf(layout) < order.indexOf(current);
    const margin = better ? VALUES_HYSTERESIS_PX : 0;
    if (required.every((width) => width + margin <= widths[layout]))
      return layout;
  }
  return "boxes";
}

/** Observes the section, re-evaluates on resize, on `deps` change and after document.fonts.ready; returns the layout. */
export function useValuesLayout(
  section: RefObject<HTMLElement>,
  deps: readonly unknown[],
): ValuesLayout;
```

Required width of a control = sum of its segments' `scrollWidth` (each segment is `white-space: nowrap` and keeps its padding in every layout) + `(n + 1)` px for the outline and separators. This does not depend on the layout shown, so no hidden measuring copy is needed.

### `useCoupledScroll` options and `align()` (S1)

```ts
export interface CoupledScrollPane {
  id: string;
  element: HTMLElement | null;
  /** An array (ComparePane, unchanged) or a getter read at every sync, so new starts need no rebind. */
  starts: readonly number[] | (() => readonly number[]);
}
export interface CoupledScrollOptions {
  enabled: boolean;
  /** Viewport width from which coupling is available; default 1100 (ComparePane), 700 in the translation review. */
  minWidth?: number;
  /** When set, only this pane leads; input on other panes never makes them leader (spec 2.2 editing row). */
  fixedLeader?: string;
  /** Bump to make the hook re-read lazy starts and refresh numbers, highlight and geometry without moving any pane. */
  startsRevision?: number;
  /** Marker mutations inside this pane are ignored until the next startsRevision (spec 2.3). */
  frozenPaneId?: string;
}
export interface AlignRequest {
  anchor: { paneId: string; paragraph: number };
  targets: readonly string[];
  /** Pixels between the top of the anchor pane and its paragraph start; negative means above the visible area. */
  anchorOffset: number;
  /** Used when anchorOffset < 0 (spec 2.4: `space-3` = 12 px). */
  topInset: number;
}
export interface AlignResult {
  pairs: ReadonlyArray<{ paneId: string; paragraph: number }>;
  estimate: boolean;
}

export function useCoupledScroll(
  panes: readonly CoupledScrollPane[],
  options: CoupledScrollOptions,
): CoupledScrollState & {
  available: boolean;
  align: (request: AlignRequest) => AlignResult;
};

/** Same index mapping as coupling: linear when counts differ, 0 when either side has ≤ 1 paragraph. */
export function mapParagraph(
  index: number,
  fromCount: number,
  toCount: number,
): number;
```

`align()` works whether or not coupling is enabled; it writes `scrollTop` instantly, records each written position in the hook-level programmatic-position map (a `useRef`, shared with the scroll listeners of the current binding), sets `data-coupled-active` on the paired markers and never changes the leader.

---

## WP blocks

### X0: Values browser scenarios

- **Goal:** fresh projects for the Values block browser tests: one with the spec's standard clinical axes, one with long option values that cannot fit as segments.
- **Spec:** 1.0 (axes), 1.7 (browser).
- **Owns:** `tests/browser_values_scenarios.py` (create), `tests/test_browser_values_fixture.py` (create), `tests/browser_server.py` (one import and one registration line after `register_review_flow_scenario_route(app)` at `tests/browser_server.py:1302`), `frontend/browser/valuesHelpers.ts` (create).
- **Size / lane / review:** S / heavy (pytest with PostgreSQL) / —.
- **Code to read:** `tests/browser_review_flow_scenarios.py:1-160` (`build_annotation_loop`, route registration and `app.router.routes.insert(0, …)`), `tests/browser_lead_workflow_scenarios.py:63-110` (`lead_project`, `person`), `:163-180` (`import_units`), `:244-260` (`result`), `tests/t1_fixtures.py:45-112` (`hpo_profile`, `PIN`, `create_project`), `src/ontocurator/domain/axes.py:63-81` (`STANDARD_CLINICAL_AXES`), `frontend/browser/reviewFlowHelpers.ts`.
- **Prerequisites:** `grep -n "def register_review_flow_scenario_route" tests/browser_review_flow_scenarios.py`; `grep -n "STANDARD_CLINICAL_AXES = \[" src/ontocurator/domain/axes.py`.

Why a new builder: the existing browser projects use `hpo_profile()` from `tests/t1_fixtures.py:45`, whose Experiencer axis has four options plus "Not specified" (a `Select`) and whose Temporality has "unknown" instead of "future". The spec's measurement (1.0, 1.4) is about `STANDARD_CLINICAL_AXES` (three segmented axes with long German labels), so the test needs a project whose profile carries exactly those axes.

Route `POST /__test_values__?scenario=<name>` returns the review-flow shape `{project, users, display_names, pseudonyms, rows, assignments: {name: id}, texts: {name: text}}`. Project keys `values-{scenario}-{uuid8}`.

| Scenario          | Profile axes (layer `hpo`, type `phenotype`)                                                                                                                                                                       | Data                                                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VALUES_STANDARD` | `STANDARD_CLINICAL_AXES` (Assertion present/absent/uncertain, Experiencer patient/other, Temporality current/historical/future; all `allow_empty`)                                                                 | creation defaults `assertion=present, experiencer=patient, temporality=current`; one native `en` text "The patient has a seizure and hypotonia." planned annotate, assigned to `annotator` |
| `VALUES_LONG`     | Assertion as standard; one axis `certainty` "Diagnostic certainty" with options `confirmed_by_genetic_testing`, `clinically_suspected_only`, `excluded_after_workup` (values render raw through `axisOptionLabel`) | same text and assignment, defaults `assertion=present, certainty=clinically_suspected_only`                                                                                                |

- [ ] **Step 1: Failing test** (`tests/test_browser_values_fixture.py`, heavy): `test_values_standard_builds` (returned assignment is the annotator's; `GET /api/v1/assignments/{id}` workspace `axes_config` ids are `["assertion", "experiencer", "temporality"]` with the labels of `axes.py:63-81`), `test_values_long_builds` (axis `certainty` with the three long options), `test_projects_are_fresh` (two calls give two different project keys).
- [ ] **Step 2:** `uv run pytest tests/test_browser_values_fixture.py -q` → FAIL.
- [ ] **Step 3: Implement** `tests/browser_values_scenarios.py`: a `values_project(app, name, axes)` that stores HP and calls `ScopedRepository(db, ADMIN_ACCESS, OPERATOR).create_project(key, "Project", None, profile, {"hp": PIN})` with `hpo_profile()` copied with the scenario's axes (`model_copy` down to the `phenotype` type), then adds the four persons with `person()` from `browser_lead_workflow_scenarios`; sets `creation_defaults`; `import_units`, `plan(..., {"source": {"review": OFF, "annotate": ON}})`, `batch_assign(..., "annotate", ["annotator"])`; `register_values_scenario_route(app)` modelled on `register_review_flow_scenario_route`. If the import refuses the custom profile, stop and report (do not change import code).
- [ ] **Step 4:** Step 2 → PASS. `frontend/browser/valuesHelpers.ts`: `valuesScenario(page, name: "VALUES_STANDARD" | "VALUES_LONG")` (POST, 120 s timeout, returns `ReviewFlowScenario` from `reviewFlowHelpers.ts`).
- [ ] **Step 5: Verify:** Step 2; `uv run ruff check tests && uv run ruff format --check tests`; `npm --prefix frontend run typecheck`.
- **Done:** both scenarios build in under 30 s; fresh project per call; one registration line in `browser_server.py`.
- **Commit:** `test(browser): values block scenarios with standard and long axis options`

### X1: Values block as a segmented control with fit rule

- **Goal:** each axis reads as one row with one connected control; an unconfirmed default is unmistakable; values never truncate.
- **Spec:** 1.1–1.7; Deviations item 4.
- **Owns:** `frontend/src/editor/AnnotationPanel.tsx` (Values section only, current `:265-335`), `frontend/src/editor/valuesLayout.ts` (create), `frontend/src/styles/screens/editor.css` (Values block `:1959-2015`), `frontend/src/styles/components.css` (`.axis-*` rules `:69-115` and `:429-445` only: remove), `frontend/src/styles/base.css` (`.axis-option` focus selectors `:22-25` and `:49` only: remove), `DESIGN.md` ("Values block" row, `DESIGN.md:296`), tests `frontend/tests/valuesBlock.test.tsx`, `frontend/tests/valuesLayout.test.ts` (create), `frontend/tests/annotationPanelStyles.test.ts`, `frontend/browser/values-block.spec.ts` (create), `frontend/browser/annotation-loop.spec.ts` (only the test "forced colours keep the active hit and the dashed default border", `:505-527`).
- **Size / lane / review:** M / PW (heavy for Steps 1 and 7) / plan review.
- **Code to read:** `frontend/src/editor/AnnotationPanel.tsx:155-170` (`isUnconfirmedDefault`, `confirmableDefaults`), `:265-335` (Values section), `frontend/src/editor/axisLabels.ts`, `frontend/src/app/CaseScreen.tsx:2164`, `:2419`, `:2554` (V focus uses `[data-axis-field]`; must keep working), `frontend/src/styles/screens/editor.css:352-395` (380 px inspector, `detail-section`), `frontend/tests/valuesBlock.test.tsx`, `frontend/browser/annotation-loop.spec.ts:20-60` (helpers, `evidence`), `frontend/browser/valuesHelpers.ts` (X0).
- **Prerequisites:** `grep -n "__test_values__" tests/browser_values_scenarios.py tests/browser_server.py`; `grep -n 'className="axis-options"' frontend/src/editor/AnnotationPanel.tsx`; open question 1 confirmed by the orchestrator.

- [ ] **Step 1: Measure first (browser, today's markup).** Create `frontend/browser/values-block.spec.ts` with `test("measure: standard profile at 1440x900", …)`: `valuesScenario(page, "VALUES_STANDARD")`, log in as `annotator`, open the task at 1440×900, `document.fonts.ready`, mark "seizure", Enter (create with defaults), then evaluate for every `.values-section .axis-field`: legend text, `.axis-options` `clientWidth`, the sum of `.axis-option` `scrollWidth`, and the section content width; `test.info().attach("values-widths.json", …)` and `evidence(page, "01-values-today")`. Run `HPO_E2E_PORT=18766 npm --prefix frontend run test:e2e -- values-block.spec.ts`. Report the numbers to the orchestrator in one line ("standard profile: max required {r} px, row cell {w} px → expected layout {row|stacked}"). This decides the expectation of Step 7's assertion; it does not change the rule.
- [ ] **Step 2: Failing unit tests.**
  - `frontend/tests/valuesLayout.test.ts`: `it("chooses row when every control fits the control cell")`, `it("chooses stacked when a control fits only the full width")`, `it("chooses boxes when a control does not fit the full width")`, `it("returns from stacked to row only with 8 px to spare")`, `it("returns from boxes to stacked only with 8 px to spare")`, `it("drops to a worse layout at once without hysteresis")`, `it("ignores axes rendered as a Select")` (empty `required` → row).
  - `frontend/tests/valuesBlock.test.tsx` (replace `it("marks unconfirmed defaults with a dashed option and the word default")`): `it("renders each axis as one segmented group with the label cell first")` (`.axis-options` children are `label.axis-option` with a visually hidden radio still in the accessible tree), `it("shows the Default tag in the label cell and keeps ' · default' in the radio's accessible name")` (`getByRole("radio", { name: "Present · default" })`; `.axis-legend .axis-default-tag` text "Default"; " · default" inside the segment only as `.visually-hidden` text), `it("shows the editable hint with Kbd D")` (exact text "Highlighted values are defaults. Press D to confirm them, or choose another value."), `it("shows the read-only hint without a key or button")` ("Highlighted values are defaults that were not confirmed."), `it("keeps an unavailable stored value as the last disabled chosen segment")`, `it("renders a one-option axis as a one-segment radio group")`, `it("keeps the Select with ' · default' for more than four options and shows the Default tag")`, `it("writes data-values-layout on the section and keeps selection and focus when it changes")` (mock `ResizeObserver`, `scrollWidth`/`clientWidth` via `Object.defineProperty`; switch row → boxes; checked radio and `document.activeElement` unchanged).
  - `frontend/tests/annotationPanelStyles.test.ts`: `it("has one Values rule set without pills or transitions")` (read `components.css`, `base.css`, `screens/editor.css`: no `.axis-option` selector outside `editor.css`; the Values block contains no `9999px` and no `transition: all`; contains `[data-values-layout="boxes"]`, `[data-values-layout="stacked"]`, `@media (forced-colors: active)` with `Highlight` and `CanvasText`).
- [ ] **Step 3:** `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/valuesLayout.test.ts tests/valuesBlock.test.tsx tests/annotationPanelStyles.test.ts` → FAIL.
- [ ] **Step 4: Implement markup and layout.** `valuesLayout.ts` as in "Shared contracts" (`useValuesLayout` re-evaluates on mount, on `deps` change = axis config and option sets incl. the unavailable value, on `ResizeObserver` callbacks of the section, and once after `document.fonts.ready`). In `AnnotationPanel.tsx`: `const valuesSection = useRef<HTMLElement>(null)`; `const layout = useValuesLayout(valuesSection, [axesConfig, unavailableKey])`; section gets `ref` and `data-values-layout={layout}`; each segment:

  ```tsx
  <label key={option.value} className={`axis-option${isDefault ? " is-default" : ""}`}
    onPointerDown={() => { arrowChange.current = false; }}>
    <input type="radio" … />
    <span>{option.label}</span>{isDefault && <span className="visually-hidden"> · default</span>}
  </label>
  ```

  (`.visually-hidden` exists at `frontend/src/styles/components.css:588`; X1 keeps that rule, it removes only the `.axis-*` rules). The legend becomes `{axis.label}{required}{unconfirmed && <span className="axis-default-tag">Default</span>}` with the tag on its own line (CSS `display: block`). In the boxes layout the legend additionally renders `<span className="axis-default-suffix"> · default, not confirmed</span>` (only when `layout === "boxes"` and the axis is an unconfirmed default) and the separate "Default" tag is hidden by CSS. Hint: editable and `onConfirmDefaults` → "Highlighted values are defaults. Press D to confirm them, or choose another value." with `<Kbd>D</Kbd>` after "Press"; read-only → "Highlighted values are defaults that were not confirmed."; "Confirm defaults (n)" unchanged above it.

- [ ] **Step 5: Implement CSS.** Delete `.axis-field`, `.axis-options`, `.axis-option*` from `components.css:69-115` and `:429-445` and the `.axis-option:has(input:focus-visible)` selectors from `base.css:22-25` and `:49` (keep the other selectors of those rules). Replace `editor.css:1959-2015` by one block: grid rows (`calc(2 * var(--space-7)) minmax(0, 1fr)`, `column-gap: var(--space-2)`, row gap `var(--space-2)`, `align-items: center`); legend `size-sm`, weight 500, max two lines, `overflow-wrap: anywhere`; `.axis-options { display: flex; flex-wrap: nowrap; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); }` (no `overflow: hidden`); `.axis-option { flex: 1 1 auto; justify-content: center; white-space: nowrap; padding: var(--space-1) var(--space-2); min-height: 28px; background: var(--surface-raised); font-weight: 500; }`; `.axis-option + .axis-option { border-left: 1px solid var(--border-strong); }`; radio `position: absolute; opacity: 0; width: 1px; height: 1px;`; hover `surface-sunken` (not when disabled); chosen `accent`/`on-accent`, weight `var(--weight-strong)`; chosen default `warning-light`/`warning`, weight strong, `outline: 1px dashed var(--warning); outline-offset: -3px;`; focused segment `position: relative; z-index: 1; outline: var(--focus-width) solid var(--focus-ring); outline-offset: var(--focus-offset);`; read-only not-chosen `text-muted`, `cursor: default`; `[data-values-layout="stacked"] .axis-field { grid-template-columns: minmax(0, 1fr); } … .axis-legend { margin-bottom: var(--space-1); }`; `[data-values-layout="boxes"]` per spec 1.4 (box `surface-sunken`, 1 px `border`, `radius`, padding and gap `space-2`, chips wrap with gap `space-1`, `radius-sm`, separate borders; a box whose axis has an unconfirmed default: `border: 1px dashed var(--warning)`); `.axis-default-tag { display: block; font-size: var(--size-xs); color: var(--warning); font-weight: var(--weight-strong); }`; forced colours per spec 1.5 (outline and separators `CanvasText`; chosen `Highlight`/`HighlightText`; default dashed `CanvasText` outline; boxes dashed `CanvasText`; focus `Highlight`); no transitions on segments.
- [ ] **Step 6:** Step 3 → PASS; also `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/coalescedAxisChange.test.tsx tests/hiddenAxisValuesField.test.tsx` and `npm --prefix frontend run typecheck`. Update `DESIGN.md:296` ("Values block") to the new rules (segmented control, warning default, "Default" tag, new hint, fit rule row → stacked → boxes with 8 px hysteresis, forced colours).
- [ ] **Step 7: Browser.** In `values-block.spec.ts` (each test builds its own scenario): `test("standard profile at 1440x900 gets row or stacked and no segment overflows")` (assert `data-values-layout` equals the value reported in Step 1 for the new markup and every `.axis-option` has `scrollWidth <= clientWidth`), `test("long option values fall back to boxes and are never truncated")` (`VALUES_LONG` → `boxes`; each option's full text visible), `test("V, arrows, Tab and D keep their flow")` (V focuses the first defaulted axis; ArrowRight changes it; Tab goes to the next axis; D confirms all and focus returns to the text), `test("focus ring is fully visible on the first, middle and last segment")` (for each: focus, `boundingBox` of the segment plus 4 px lies inside the section's box; `evidence(page, "02-focus-{n}")`), `test("forced colours keep the chosen segment and the dashed default outline")` (`emulateMedia({ forcedColors: "active" })`, `outlineStyle` of `.axis-option.is-default` is `dashed`, `evidence`), `test("axe has no violations in the Values block")` (row and boxes). In `annotation-loop.spec.ts:505-527` change only the default assertion from `borderTopStyle` `dashed` to `outlineStyle` `dashed` and keep `toContainText("· default")`. Run `HPO_E2E_PORT=18766 npm --prefix frontend run test:e2e -- values-block.spec.ts annotation-loop.spec.ts` → PASS.
- **Done:** spec 1.2–1.6 hold; one CSS rule set; accessible names unchanged; layout attribute present; evidence under `build/editor-axes-scroll/evidence/`; measurement numbers in the hand-back.
- **Commit:** `feat(editor): axis values as one segmented control with a measured fallback`

### S1: Coupled scroll hook options

- **Goal:** the hook supports a fixed leader, a lower width limit, new starts without rebinding and a one-off alignment that never feeds back; `ComparePane` behaviour is unchanged.
- **Spec:** 2.2, 2.3, 2.4 (effect), 2.5 (`minWidth`), 2.9 (hook tests).
- **Owns:** `frontend/src/variants/useCoupledScroll.ts`, `frontend/tests/useCoupledScroll.test.tsx`.
- **Size / lane / review:** M / L / plan review (focus).
- **Code to read:** `frontend/src/variants/useCoupledScroll.ts:1-110` (whole file: `wide` media query `:11-19`, programmatic map `:30-32`, `markers` `:33-41`, `sync` `:43-69` with the mapping at `:53`, leader input `:71-79`, listeners `:80-85`, `refreshMarkers` and `MutationObserver` `:86-103`, effect dependencies `:108`), `frontend/src/variants/ComparePane.tsx:60-110` (the other caller), `frontend/tests/useCoupledScroll.test.tsx:1-35` (pane and `matchMedia` helpers; the mock ignores the query string, so the `minWidth` tests need a mock that parses `min-width: Npx`).
- **Prerequisites:** `grep -n "matchMedia?.('(min-width: 1100px)')" frontend/src/variants/useCoupledScroll.ts`; `grep -n "},\[panes,enabled,available\]);" frontend/src/variants/useCoupledScroll.ts`.

- [ ] **Step 1: Failing tests** (`frontend/tests/useCoupledScroll.test.tsx`, keep every existing test green):
  - `it("minWidth 700 makes coupling available at 800 px; the default stays 1100")`
  - `it("with fixedLeader, wheel and scroll on a follower never make it leader and never move the leader")` (target fixed; wheel + scroll on source: source moves alone, target `scrollTop` unchanged; next target scroll moves the source again)
  - `it("a startsRevision change re-reads lazy starts without unbinding, without resetting the leader and without writing scrollTop")` (spy on `removeEventListener`: not called; `scrollTop` setters of all panes not called; `data-paragraph-number` updated)
  - `it("marker mutations inside the frozen pane do not refresh pairs until the next revision")` (append a marker into the frozen pane: `pairs` unchanged; bump revision: updated)
  - `it("align scrolls each target once so its paired paragraph sits at the anchor offset, clamped")`
  - `it("align uses topInset when the anchor paragraph starts above the visible area")`
  - `it("align marks the paired markers and reports estimate when counts differ")`
  - `it("positions written by align never make the target leader and never feed back")` (coupling on: after `align`, the queued scroll event of the target does not move the source)
  - `it("align works while coupling is off")`
  - `it("mapParagraph maps linearly and returns 0 for single-paragraph sides")`
  - `it("ComparePane defaults are unchanged")` (array starts, no options: existing ownership transfer)
- [ ] **Step 2:** `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/useCoupledScroll.test.tsx` → FAIL.
- [ ] **Step 3: Implement** to the contract in "Shared contracts":
  - `const [query] = useState(() => window.matchMedia?.(\`(min-width: ${minWidth}px)\`))`(one query per`minWidth`; re-create when `minWidth` changes).
  - `const startsOf = (pane) => typeof pane.starts === "function" ? pane.starts() : pane.starts;` used in `markers` and `sync` (replaces `pane.starts` at `:37` and `:53`).
  - Leader: in `input` and in `scroll` (`:72-78`), `if (fixedLeader !== undefined && pane.id !== fixedLeader) return;` before taking ownership; with `fixedLeader`, `leaderId` starts as `fixedLeader`.
  - Hoist `programmaticPositions` to `const programmatic = useRef(new Map<HTMLElement, number>())` so `align` and the listeners share it; clear it in `detach`.
  - Keep a `refresh = useRef<() => void>()` set inside `bind` to `refreshMarkers`; a separate `useEffect(() => refresh.current?.(), [startsRevision])` refreshes without rebinding. `refreshMarkers` and `sync(source, false)` never write `scrollTop` (already true; assert in tests).
  - `MutationObserver` callback receives records; skip the refresh when every record's target is inside the `frozenPaneId` pane.
  - `align(request)`: compute geometry with the same `markers` routine (callable without a binding), `mapParagraph` from the anchor pane's count to each target's count, target `scrollTop = clamp(partner.top - (request.anchorOffset >= 0 ? request.anchorOffset : request.topInset))`, record in `programmatic`, set `data-coupled-active` (and clear it on the other markers of that pane), `setState` with the new pairs while keeping `leaderId`; `estimate = some count differs`.
  - Effect dependencies become `[panes, enabled, available, fixedLeader, frozenPaneId]`; callers keep `panes` stable (S2 memoises on elements only).
- [ ] **Step 4:** Step 2 → PASS; `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/useCoupledScroll.test.tsx tests/translationReview.test.tsx` (unchanged screen still green) and `npm --prefix frontend run typecheck`. If `ComparePane` tests exist (`grep -rln "ComparePane" frontend/tests`), run them too.
- **Done:** contract implemented exactly; old tests green; no `scrollTop` write outside `sync(…, true)` and `align`.
- **Commit:** `feat(variants): coupled scroll with fixed leader, width option and one-off alignment`

### S2: Coupled scrolling while editing the translation

- **Goal:** the reviewer can couple while editing; edits never move the edited pane, its caret or its selection.
- **Spec:** 2.1–2.3, 2.5, 2.6 (notes and counts), 2.7 (live regions), 2.8; Deviations items 1–3.
- **Owns:** `frontend/src/translation/TranslationReviewScreen.tsx`, `frontend/src/translation/TranslationEditor.tsx` (composition and blur props), `frontend/src/translation/labels.ts` (coupling copy), `frontend/tests/translationReview.test.tsx`, `frontend/tests/paragraphs.test.ts`.
- **Size / lane / review:** M / L+ / plan review.
- **Code to read:** `frontend/src/translation/TranslationReviewScreen.tsx:100-130` (state, `sourceStarts`/`targetStarts`/`comparisonStarts` `:114-116`, `canCouple` `:117`, `couplingIdentity` `:118`, `panes` `:121-125`, hook call `:126`), `:268-282` (`editText`, shortcuts), `:359-360` (`paragraphNote`, `paneNames`), `:404-445` (columns, column head `:411-420`, editor/diff switch `:422-427`), `frontend/src/translation/TranslationEditor.tsx:1-35`, `frontend/src/translation/DiffView.tsx:11-37` (`paragraphNodes`, markers), `frontend/src/variants/paragraphs.ts:1-44`, `frontend/src/translation/translation.css:72` (`.translation-column-hint`), `:172`, `:186` (1099/699 px media queries), `frontend/tests/translationReview.test.tsx:1-47` (`matchMedia` stub with `evaluate(query)`), `:256-268`, `:359-385`, `:526-533` (existing coupling tests).
- **Prerequisites:** `grep -n "minWidth" frontend/src/variants/useCoupledScroll.ts`; `grep -n "export function mapParagraph" frontend/src/variants/useCoupledScroll.ts`.

- [ ] **Step 1: Failing tests.**
  - `frontend/tests/translationReview.test.tsx` — replace the three tests that assert the checkbox is absent while editing (`:256` "couples only opted-in reading views and clears the request on return to editing", `:526` "hides Couple scrolling while it is unavailable and offers it on a read-only target at 1440 px", and the 1100 px expectation of `:367` "pauses read-only coupling while stacked and retains opt-in through a resize", whose boundary becomes 700 px) by: `it("offers Couple scrolling beside the editable translation, unchecked by default")`, `it("keeps the request across edits and Show changes")`, `it("resets the request on comparison change, reload and submit")`, `it("offers coupling at 800 px and hides it below 700 px, keeping the request")`, `it("passes fixedLeader target only while the editable translation is shown")` (mock the hook module, assert options), `it("recomputes translation starts 300 ms after the last edit, at once on blur, and not during composition")` (fake timers; `compositionstart` → type → advance 500 ms → old count; `compositionend` → advance 300 ms → new count), `it("a recompute never changes selectionStart or the translation scrollTop")`, `it("shows the always note and the editing note while coupled and editing")` (exact copy of 2.6), `it("names both counts when they differ")` ("Paragraphs differ (source 12, translation 13); the other text may show a neighbouring paragraph."), `it("announces a count change from edits once")` ("Your edits changed the number of paragraphs (12 → 13). Pairing after that point may be off."; baseline = count of the text loaded with the workspace), `it("updates the pair line only after scrolling rests for 150 ms")`.
  - `frontend/tests/paragraphs.test.ts`: `it("switches from line mode to paragraph mode when the first blank line is typed")` (`"a\nb\nc"` → 3 starts; `"a\n\nb\nc"` → 2 starts).
- [ ] **Step 2:** `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/translationReview.test.tsx tests/paragraphs.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
  - `TranslationEditor`: new optional props `onBlur`, `onCompositionStart`, `onCompositionEnd` passed to the `textarea`; the mirror keeps updating on every keystroke (change underline).
  - Screen: `const editing = !readOnly && !showChanges;` `targetStarts` becomes state updated by a debounced effect: on `text` change, if `composing.current` skip; else `setTimeout(300)` → `startsRef.current.target = paragraphStarts(text); setStartsRevision(r => r + 1)`; `flushStarts()` on textarea blur, on `compositionend` (schedule), and when not editing (immediate). Source and comparison starts stay `useMemo` and are stored into `startsRef` immediately.
  - `panes` memo depends on elements and `comparison` only; `starts: () => startsRef.current[id]`.
  - `couplingIdentity = useMemo(() => ({}), [workspace, comparisonId, readOnly])` (no `text`, no `showChanges`); `couplingRequested = requestedCoupling === couplingIdentity`.
  - `useCoupledScroll(panes, { enabled: couplingRequested, minWidth: 700, fixedLeader: editing ? "target" : undefined, startsRevision, frozenPaneId: editing ? "target" : undefined })`.
  - Checkbox rendered when `pairing.available` (no `canCouple`); remove `canCouple`.
  - Copy in `labels.ts`: `couplingNote`, `couplingEditingNote`, `paragraphCountsDiffer(source, translation)`, `paragraphCountChanged(before, after)` with the spec 2.6 strings; replace `paragraphNote` at `:359` (for the comparison: "Paragraphs differ (translation {n}, comparison {m}); the other text may show a neighbouring paragraph.").
  - Pair line: keep `role="status" aria-label="Paragraph pairing"`; render a `restingPairs` state set 150 ms after the last `pairing.pairs` change.
- [ ] **Step 4:** Step 2 → PASS; `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/useCoupledScroll.test.tsx tests/reviewForm.test.tsx`; typecheck. Then, in a heavy slot granted by the orchestrator, the affected-tests fast path (or `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/translationReview.test.tsx tests/translation`).
- **Done:** spec 2.2, 2.3, 2.5, 2.6 (except the action copy), 2.7 (pair line) and 2.8 hold; review-flow A.1 item 10 "hidden while unavailable" still holds.
- **Commit:** `feat(translation-review): coupled scrolling while editing the translation`

### S3: Show matching paragraph

- **Goal:** one action aligns the other text(s) to the paragraph at the caret or the clicked paragraph, without touching focus, caret or selection.
- **Spec:** 2.4, 2.5 (action column), 2.6 (button and status copy), 2.7 (Tab order, status); Deviations items 1 and 4 (DESIGN.md).
- **Owns:** `frontend/src/translation/TranslationReviewScreen.tsx`, `frontend/src/translation/labels.ts`, `frontend/tests/translationReview.test.tsx`, `frontend/src/ui/shortcuts.ts` (`matches()` only), `frontend/tests/ui/shortcuts.test.tsx`, `DESIGN.md` ("Translation review layout" row `DESIGN.md:294`, "Shortcuts" section `:309-327`).
- **Size / lane / review:** S / L+ / plan review.
- **Code to read:** `frontend/src/ui/shortcuts.ts:1-70` (`ShortcutOptions`, `dispatch`), `:112-124` (`matches`), `frontend/tests/ui/shortcuts.test.tsx:27-50`, `frontend/src/translation/TranslationReviewScreen.tsx` after S2 (column head, hook call, `align`), `frontend/src/variants/paragraphs.ts:34-44` (`paragraphAt`).
- **Prerequisites:** S2 committed (`grep -n "fixedLeader" frontend/src/translation/TranslationReviewScreen.tsx`); X1's DESIGN.md row committed (`git log --oneline -1 -- DESIGN.md`); open questions 2 and 3 confirmed.

- [ ] **Step 1: Failing tests.**
  - `frontend/tests/ui/shortcuts.test.tsx`: `it("alt_letter_bindings_fall_back_to_event_code")` (`Alt+M` matches `{ altKey: true, key: "µ", code: "KeyM" }`; does not match `{ altKey: true, key: "µ", code: "KeyN" }`; plain `"m"` bindings never use `code`).
  - `frontend/tests/translationReview.test.tsx`: `it("Show matching paragraph sits after Show changes and Couple scrolling with Kbd Alt M")`, `it("anchor 1: from the textarea uses the caret paragraph with fresh starts")` (caret in paragraph 4 typed < 300 ms ago → flushes the recompute; `align` called with `{ anchor: { paneId: "target", paragraph: 3 }, targets: ["source", "comparison"] }`), `it("anchor 2: the last click in the source uses the last marker above the click point")` (targets `["target", "comparison"]`), `it("anchor 3: otherwise the paragraph at the top of the last focused or scrolled pane")`, `it("keeps focus, caret and selection")` (`selectionStart`/`selectionEnd` and `document.activeElement` unchanged; button `onMouseDown` prevents focus change), `it("announces the result in the polite status")` ("Source paragraph 4 is shown next to translation paragraph 4."; with differing counts plus " Paragraph counts differ, so this is an estimate."), `it("Alt+M works from the textarea, also via event.code, and types nothing")`, `it("Alt+M does nothing while a dialog is open")`, `it("help lists Alt+M in group Translation review")` ("Show the paragraph paired with the one at your cursor"), `it("below 700 px the action scrolls the target into view with block nearest")`, `it("works with coupling off and while busy")`.
- [ ] **Step 2:** `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/ui/shortcuts.test.tsx tests/translationReview.test.tsx` → FAIL.
- [ ] **Step 3: Implement.**
  - `matches()`: after the modifier check, for a one-character letter binding with `Alt` in `modifiers`, return `key.toLowerCase() === event.key.toLowerCase() || event.code === \`Key${key.toUpperCase()}\``.
  - Screen: track `lastPointer = useRef<{ paneId: string; clientY: number } | null>(null)` (pointerdown on source, comparison and target elements) and `lastPane = useRef<string>("target")` (focus and scroll on the panes). `showMatching()`: anchor per spec 2.4 (rule 1 when the textarea is `document.activeElement`: `Array.from(value.slice(0, selectionStart)).length` → `paragraphAt(paragraphStarts(value), offset)` after `flushStarts()`; rule 2: last marker whose `getBoundingClientRect().top <= clientY`; rule 3: last marker at or above the pane's top); `anchorOffset` = anchor marker top − pane top; `topInset = 12` (`space-3`); call `pairing.align`; below 700 px call `targetElement.scrollIntoView({ block: "nearest" })` on the first target; set the polite status text (reuse the existing `role="status"` pair line or one `role="status"` span; never a second live region with the same text).
  - Button `<Button variant="quiet" size="sm" title="Scroll the other text to the paragraph paired with the one at your cursor or the one you clicked." onMouseDown={e => e.preventDefault()} onClick={showMatching}>Show matching paragraph<span aria-hidden="true"> <Kbd>Alt M</Kbd></span></Button>` in the translation column head after "Couple scrolling"; one instance per screen.
  - `useShortcut("Alt+M", showMatching, { scope: "screen", group: "Translation review", description: "Show the paragraph paired with the one at your cursor", allowInInputs: true })`.
  - `DESIGN.md:294`: coupling while editing (fixed leader, 700 px, notes) and the action; "Shortcuts" (`:327` group "Translation review"): add `Alt+M` with the `event.code` fallback rule.
- [ ] **Step 4:** Step 2 → PASS; typecheck; in a heavy slot the affected-tests fast path (fallback: `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/ui tests/translationReview.test.tsx`), because `matches()` is shared by every screen.
- **Done:** spec 2.4–2.7 hold; no other binding changes behaviour (`tests/ui/shortcuts.test.tsx` green).
- **Commit:** `feat(translation-review): Show matching paragraph with Alt+M`

### SB: Browser verification of Part 2

- **Goal:** coupling while editing and the action work in a real browser at three widths.
- **Spec:** 2.9 (browser), 2.8.
- **Owns:** `frontend/browser/translation-review.spec.ts`.
- **Size / lane / review:** M / PW / plan review.
- **Code to read:** `frontend/browser/translation-review.spec.ts:1-92` (helpers, `__test_translation_review__` call at `:30`, `alignAt`, `markerDistance`), `:311-374` (width loop; the "not beside the editable translation" assertion at `:336-337`), `:375-…` (merge/split test), `tests/browser_server.py:751-800` (route parameters `assignment`, `unequal`, `merge_split`; fresh project `review-{uuid12}` per call).
- **Prerequisites:** `grep -n "Show matching paragraph" frontend/src/translation/TranslationReviewScreen.tsx`; X1 reports its last Playwright run finished.

- [ ] **Step 1: Write tests** (each builds its own `/__test_translation_review__?assignment=target` scenario; never the shared `browser-fixture`):
  - Replace `:336-337` by: at ≥ 700 px the checkbox "Couple scrolling" is present and unchecked beside the editable translation.
  - `for (const [w, h] of [[1440, 900], [800, 900]]) test(\`coupling while editing at ${w}px\`, …)`: check "Couple scrolling"; place the caret in paragraph 3, type a word and "\n\n" plus a sentence; wait 400 ms; assert `selectionStart`and the translation scrollport's`scrollTop` are unchanged by the recompute; wheel on the translation moves the source (`markerDistance`≤ 20 px); wheel on the source does not move the translation; delete one blank line (merge two paragraphs) and expect the count note text of 2.6;`evidence(page, \`20-coupled-editing-${w}\`)`.
  - `test("Show matching paragraph from the caret and from a source click")` at 1440×900: from the caret in paragraph 6 the source's paragraph 6 starts within 4 px of the translation's paragraph 6 offset; after a click into source paragraph 9 the translation aligns within 4 px; `selectionStart` unchanged; `Alt+M` from the textarea does the same and types no character.
  - `test("390x844: checkbox hidden, action works")`: no "Couple scrolling"; `Alt+M` brings the source paragraph into view (`toBeInViewport`); caret unchanged; `evidence(page, "21-narrow-action")`.
  - `test("axe has no violations in the column head with coupling on")`.
- [ ] **Step 2: Run** `HPO_E2E_PORT=18766 npm --prefix frontend run test:e2e -- translation-review.spec.ts` → PASS. Fix only this spec file; report product bugs with the failing step and the screenshot path.
- **Done:** every browser item of spec 2.9 asserted; evidence under `build/editor-axes-scroll/evidence/`.
- **Commit:** `test(browser): coupled scrolling while editing and Show matching paragraph`

## Final gate (once per finished plan, alone on the machine)

```bash
cd /c/Users/jan-p/Development/ontocurator/.worktrees/editor-axes-scroll
CHECK_VITEST_WORKERS=4 HPO_E2E_PORT=18766 bash scripts/check.sh
```

- [ ] Ends with "All local checks passed." On the first failure: one fix agent (effort medium), then rerun that stage with `bash scripts/check.sh --only <stage>` and finally the full gate once more.
- [ ] `git status --short` is clean (every WP committed by the orchestrator).
- [ ] Plan review: one `superpowers:code-reviewer` agent over `git diff main...feat/editor-axes-scroll` against the spec, with explicit focus on `useCoupledScroll`: the fixed leader never moves, follower input never takes leadership in editing mode, `align()` and recompute never feed back or move the edited pane, `ComparePane` behaviour unchanged, no listener rebinding per keystroke. Then one fix agent (effort medium) for verified findings; rerun the affected checks and the affected stage.
- [ ] Manual smoke (optional, user): Values block in the 380 px inspector with the standard profile; edit a translation with coupling on.

## Self-review against the spec

| Spec section                                                                                     | WP(s)                                                                        |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 1.1 decisions, 1.2 layout B and segment states                                                   | X1                                                                           |
| 1.3 default tag and hint                                                                         | X1                                                                           |
| 1.4 fit rule, stacked step, fallback A                                                           | X1 (`valuesLayout.ts`), X0 (long-option scenario)                            |
| 1.5 keyboard, forced colours, reduced motion                                                     | X1                                                                           |
| 1.6 edge cases                                                                                   | X1 (unit tests: one option, unavailable value, Select; browser: long values) |
| 1.7 testing                                                                                      | X1, X0                                                                       |
| 2.1 decisions, 2.2 coupling rules                                                                | S1 (hook), S2 (screen)                                                       |
| 2.3 pairing recompute                                                                            | S1 (revision, frozen pane), S2 (debounce, composition, blur)                 |
| 2.4 Show matching paragraph                                                                      | S1 (`align`), S3                                                             |
| 2.5 width rule                                                                                   | S1 (`minWidth`), S2 (checkbox), S3 (action below 700 px)                     |
| 2.6 copy                                                                                         | S2 (notes, counts), S3 (button, status)                                      |
| 2.7 keyboard and screen reader                                                                   | S2 (pair line 150 ms), S3 (`Alt+M`, Tab order, status)                       |
| 2.8 edge cases                                                                                   | S2, S3 (unit), SB (browser)                                                  |
| 2.9 testing                                                                                      | S1, S2, S3 (unit), SB (browser)                                              |
| Deviations 1–3                                                                                   | S2                                                                           |
| Deviation 4 (DESIGN.md)                                                                          | X1 (Values block), S3 (Translation review layout, Shortcuts)                 |
| Out of scope (ComparePane coupling while annotating, sentence alignment, per-option letter keys) | none; `ComparePane.tsx` not owned                                            |
