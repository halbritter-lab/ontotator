# UI & UX Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform ontotator's interface into a modern, highly ergonomic clinical curation workbench with an intuitive Curation Dashboard start screen, an uncluttered 2-tier workspace header with prominent submission actions, compact segmented context axes, and 1-key review shortcuts.

**Architecture:** 
1. `App.tsx`: Modernize the start screen into a Curation Dashboard displaying a case data table with status filters (All/Open/In Progress/Completed), search, a one-click "Resume last case" hero card, and simplified review initialization.
2. `CaseScreen.tsx` & `CaseNavigation.tsx`: Restructure the top app header into a clean breadcrumb + compact case switcher + prominent top-right completion/submission CTA, while relocating `+ Neue Annotation` to the sidebar's own-annotations header. Add `Alt+Arrow` case navigation.
3. `AnnotationPanel.tsx`, `ReviewActions.tsx`, `styles.css`: Modernize clinical context axes into compact horizontal segmented button chips and introduce single-key review shortcuts (`1` = Confirm, `2` = Reject, `3` = Edit/Replace, `4` = Uncertain, `Esc` = Deselect) with visible shortcut badges.

**Tech Stack:** React 18, TypeScript, CSS custom properties, Vitest, Testing Library, FastAPI backend.

**Spec:** In-conversation UX review and modernization specification based on clinical workflow benchmarks (Label Studio, Prodigy, INCEpTION).

## Global Constraints

- Preserve all existing REST API contracts and serialization formats (`WorkspaceView`, `Draft`, `CommandEnvelope`, `DecisionPayload`).
- Zero regression in automated test coverage: all 165 backend tests (`pytest`) and all frontend tests (`vitest`) must pass.
- CSS changes must respect existing color tokens and responsive layout constraints.
- No auto-decision or keyboard shortcuts firing when focus is inside a form input, textarea, or contentEditable element.

## Review Focus

1. **Start Screen Case Table Filtering**: Switching between *Alle*, *Offen*, *In Bearbeitung*, and *Abgeschlossen* correctly filters document rows and updates counts without losing state.
2. **Review Initialization**: Opening a workspace in review mode automatically includes all authorized package review inputs without forcing users to pre-check checkboxes on the start screen.
3. **Primary Submission CTA in Header**: Submitting a case from the top header triggers the full validation flow (checked layers, error reporting, completion modal) identical to the previous sidebar button.
4. **Context Axes Segmented Chips**: Selecting clinical axes (Assertion, Temporality, Experiencer) using horizontal chips immediately records the axis value and maintains radio accessibility (`role="radio"` / keyboard selection).
5. **Review Keyboard Shortcuts**: Pressing `1`–`4` triggers the corresponding decision on the selected review target without side effects or unexpected navigation when typing in the search bar.

---

### Task 1: Workspace Header, Case Navigation & Action Hierarchy

**Files:**
- Modify: `frontend/src/app/CaseNavigation.tsx`
- Modify: `frontend/src/app/CaseScreen.tsx`
- Modify: `frontend/src/styles.css`
- Modify: `frontend/tests/caseNavigation.test.tsx`
- Modify: `frontend/tests/caseScreen.test.tsx`
- Modify: `frontend/tests/workflow-regressions.test.tsx`

- [x] **Step 1: Write/update test for CaseNavigation compact mode and shortcuts**
  Add tests asserting compact case navigation rendering (`‹`, `›`, dropdown or status badge) and keyboard shortcuts.
- [x] **Step 2: Streamline `CaseNavigation.tsx`**
  Make the case navigation compact, clean, and visually cohesive:
  - Compact arrow buttons (`‹`, `›`)
  - Clear label: `Fall X von Y`
  - Compact case select dropdown styled seamlessly
- [x] **Step 3: Restructure `CaseScreen.tsx` Header**
  - Left: `← Dashboard` breadcrumb button + `CaseNavigation` + Mode badge.
  - Right: Autosave status indicator (`● Gespeichert (Rev X)`), Retry button (if error), Export button as secondary icon/button, and **Prominent Primary Action Button**: `✓ Fall abgeben` (or `✓ Abgeben & Weiter →` when `hasNext` is true).
  - Move `+ Neue Annotation` button from header to the sidebar directly into the `Eigene Annotationen` header section (`.sidebar-header`).
  - Add `Alt + ArrowLeft` and `Alt + ArrowRight` listener for switching cases when not inside text input.
- [x] **Step 4: Update CSS styles for header and action layout**
  Update `.app-header` in `frontend/src/styles.css` with clean flexbox spacing, consistent button styling, and enhanced visual hierarchy.
- [x] **Step 5: Run tests and verify**
  Run `npm test` and `npm run typecheck` to confirm all header, navigation, and workflow regression tests pass.
- [x] **Step 6: Commit Task 1**
  Commit with message `feat(ui): clean up workspace header hierarchy, elevate submission CTA and relocate annotation button`.

---

### Task 2: Detail-Panel Ergonomics & Review Keyboard Shortcuts

**Files:**
- Modify: `frontend/src/editor/AnnotationPanel.tsx`
- Modify: `frontend/src/editor/ReviewActions.tsx`
- Modify: `frontend/src/app/CaseScreen.tsx`
- Modify: `frontend/src/styles.css`
- Modify: `frontend/tests/reviewActions.test.tsx`
- Modify: `frontend/tests/dynamicAxes.test.tsx`
- Modify: `frontend/tests/workflow-regressions.test.tsx`

- [x] **Step 1: Add tests for review keyboard shortcuts and segmented axis chips**
  Add unit tests in `reviewActions.test.tsx` and `workflow-regressions.test.tsx` testing keys `1` (confirm), `2` (reject), `3` (adopt & edit), `4` (uncertain), and `Esc` (deselect).
- [x] **Step 2: Transform Clinical Context Axes into Horizontal Segmented Chips**
  In `AnnotationPanel.tsx` and `ReviewActions.tsx`, style the radio options as `.axis-chips` with compact pills/buttons side-by-side instead of full-width vertical block labels.
- [x] **Step 3: Implement Keyboard Shortcuts for Review in `CaseScreen.tsx`**
  Add a `keydown` listener active when a review target is selected and no input/textarea/select is focused:
  - `1`: Calls `handleReviewDecision({ outcome: "confirmed" })`
  - `2`: Calls `handleReviewDecision({ outcome: "rejected" })`
  - `3`: Calls `handleAdoptAndEditTarget(selectedTarget)`
  - `4`: Calls `handleReviewDecision({ outcome: "uncertain" })`
  - `Escape`: Calls `handleDeselectAll()`
- [x] **Step 4: Add Visual Shortcut Badges in `ReviewActions.tsx`**
  Display subtle shortcut indicators `[1]`, `[2]`, `[3]`, `[4]` on the buttons so users immediately discover the feature.
- [x] **Step 5: Run tests and verify**
  Run `npm test` and verify that all axis selection tests and shortcut behaviors pass cleanly.
- [x] **Step 6: Commit Task 2**
  Commit with message `feat(editor): add compact segmented axis chips and single-key review shortcuts`.

---

### Task 3: Modern Curation Dashboard (Start Screen)

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/styles.css`
- Modify: `frontend/tests/apiClient.test.ts` (if relevant)
- Create or Modify: `frontend/tests/dashboard.test.tsx`

- [x] **Step 1: Write unit tests for Dashboard filtering and navigation**
  Create `frontend/tests/dashboard.test.tsx` to verify:
  - Display of document data table (ID, length, status, actions).
  - Filtering by status: *Alle*, *Offen*, *In Bearbeitung*, *Abgeschlossen*.
  - Search filter by document ID.
  - "Zuletzt bearbeitet" (Resume) card behavior.
  - Automatic loading of all review inputs when opening a review workspace.
- [x] **Step 2: Redesign `App.tsx` into a Dashboard**
  - Header: Ontotator branding, selected package picker, annotator ID input/chip, package upload button.
  - Resume Hero Card: If there is an in-progress or open case, render a high-visibility card: `[ ▶ Fall X fortsetzen ]`.
  - Filter Tabs & Search: Tabs for *Alle (N)*, *Offen (N)*, *In Bearbeitung (N)*, *Abgeschlossen (N)* plus a search input.
  - Data Table:
    - Row: Position `#`, Document ID, Language & Length, Status Badge, Review targets counter, Action `[ Fall öffnen → ]`.
  - Mode Selection: Integrated cleanly above the table or as workspace defaults.
  - Automatic Target Ingestion: Remove the tedious manual checkbox list for review targets on the start screen; when clicking "Fall öffnen" in review mode, automatically load all available package inputs.
- [x] **Step 3: Update CSS styling for Dashboard**
  Add styles in `frontend/src/styles.css` for dashboard tables, status filter tabs, hero resume card, and responsive cards.
- [x] **Step 4: Run full verification suite**
  Run `npm test`, `npm run typecheck`, `npm run build`, and `pytest`.
- [x] **Step 5: Commit Task 3**
  Commit with message `feat(dashboard): transform start screen into comprehensive curation dashboard with case table and resume flow`.
