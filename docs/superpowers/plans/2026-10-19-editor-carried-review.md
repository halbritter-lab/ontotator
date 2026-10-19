# Editor: Carried-Finding Review, Rounds and Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan work package by work package. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement [2026-10-19-editor-carried-review-design.md](../specs/2026-10-19-editor-carried-review-design.md) including its "Resolved questions": one findings list with derived check states, the carried section in the inspector, the exception path (Mark in text, link, atomic dismiss, undo dismissal), a submit dialog with per-item "Go to" links and a "Finish & Submit · n open" toolbar state, plain round names, "My submissions" across rounds, lead read-only check states, the `Dialog` header close and fixed footer, translation check explanations, and a resizable findings column.

**Architecture:** The backend gains read-only fields on round, input and source views (computed in a new `application/round_reads.py`, reusing `round_ordinals` from `domain/submission_labels.py`, Documents WP B5), an atomic "dismiss and remove carried finding" resolution, a "clear resolution" mutation that restores a finding removed by that dismissal, a submission-time check that no dismissed input still has its carried finding, and an own-submissions endpoint per assignment. All check-state logic is a pure frontend function (`editor/carried/checkState.ts`) consumed by small components under `editor/carried/` and one hook (`useCarriedReview`). `CaseScreen.tsx` is first split (no behaviour change) so later work packages own separate files and only add thin wiring to `CaseScreen.tsx` in a strict sequence.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2, PostgreSQL (pytest via testcontainers or `ONTOCURATOR_TEST_PG_URL`); React 18, TypeScript, Vitest + Testing Library, Playwright + axe-core; `openapi-typescript` for `generated.ts`.

---

## Ground rules for every implementer

- Work in `C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation`. It holds many **uncommitted** changes from other work. Never `git reset`, `git checkout -- <file>`, `git stash`, `git clean`, or rewrite a file you do not own. Edit on top of the working tree with exact-string edits.
- **Do not commit or push.** Each work package ends with a "Commit point" (files and message) for later; do not run it unless the user explicitly asks. No `Co-Authored-By` or "Generated with" lines anywhere.
- No CI or GitHub Actions. All verification is local. **Every command in this plan is written for the Bash tool (Git Bash) and runs from the worktree root**: start each call with `cd /c/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation && …` (the Bash tool does not keep the working directory between calls). `VAR=value command` prefixes are Bash syntax; do not use the PowerShell tool for these commands.
  - Backend tests need PostgreSQL (Docker running, or `ONTOCURATOR_TEST_PG_URL`). Run single files: `uv run pytest tests/<file>.py -q`.
  - Static: `uv run ruff check . && uv run ruff format --check . && uv run mypy src`.
  - Contracts: `uv run python scripts/export_openapi.py` then `npm --prefix frontend run api:generate`; drift checks `uv run python scripts/export_openapi.py --check` and `npm --prefix frontend run api:check`. Error codes: `uv run python scripts/export_admin_error_codes.py` (check: `--check`).
  - Frontend unit: `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 <paths relative to frontend>`; types: `npm --prefix frontend run typecheck`.
  - Browser: `HPO_E2E_PORT=18793 npm --prefix frontend run test:e2e -- <spec file name>`. Port 18793 is this plan's port. All four sibling plans share this worktree and `test:e2e` rebuilds `frontend/dist`, so **only one Playwright run per worktree at a time across all plans**, whatever the port.
  - Gates: `bash scripts/check.sh --only static`, `CHECK_VITEST_WORKERS=4 bash scripts/check.sh --only frontend`, `bash scripts/check.sh --only backend`, `HPO_E2E_PORT=18793 bash scripts/check.sh --only browser`.
- **At most two test-heavy agents at once on this 16 GB machine, counted across all four plans.** Test-heavy = anything running backend pytest with PostgreSQL, the full Vitest suite, or Playwright. A WP marked "light" runs only single Vitest files, typecheck and generator scripts. A heavy WP of this plan takes one of the two machine-wide slots; the orchestrator counts it together with the sibling plans' heavy WPs.
- **Exclusive file ownership.** A file is written by exactly one WP at a time, across all plans. The "Owns" column is complete: a WP that needs a change in a file it does not own stops and reports. Test files count too; where two WPs would touch one test file, this plan splits the file or serializes the WPs (see "Cross-plan locks").
- All files and UI copy in English. No Unicode glyph icons; use `frontend/src/ui/icons.tsx`. Visible text is part of every accessible name.
- Read only the spec sections and code locations your WP lists. Do not refactor beyond your owned files.

## Prerequisites from sibling plans (check before starting the dependent WP)

This plan reuses, and never duplicates, the shared primitives that [2026-10-19-documents-lead-table.md](2026-10-19-documents-lead-table.md) ("Documents plan") owns (its section "Shared primitives owned by this plan"). Dependencies name the Documents **WP id**. A WP that needs one checks for it first (the `grep` given) and **stops and reports** if it is missing; it does not re-implement it.

| Piece | Documents WP (task) | Check | Needed by |
|---|---|---|---|
| `round_ordinals()` in `src/ontocurator/domain/submission_labels.py` (re-exported by `domain/document_rows.py`; import from `submission_labels`) | B5 (2.1) | `grep -n "def round_ordinals" src/ontocurator/domain/submission_labels.py` | B1 |
| `Button` `loading` keeps focus (`aria-disabled`, not `disabled`) | U1 (3.1) | `grep -n 'aria-disabled={loading' frontend/src/ui/Button.tsx` (`aria-busy` already exists today and proves nothing) | F5b, F6c, F7 |
| `InlineConfirm` in `frontend/src/ui/InlineConfirm.tsx`, exported from `ui/index.ts` | U1 (3.3) | `grep -n "InlineConfirm" frontend/src/ui/index.ts` | F5b |
| `useMediaQuery` in `frontend/src/ui/useMediaQuery.ts` | U1 (3.5) | `test -f frontend/src/ui/useMediaQuery.ts` | F8a |
| `DataTable` (groups, `renderExpanded`, `Column.rowHeader`) | U2 (3.4) | `grep -n "renderExpanded" frontend/src/ui/DataTable.tsx` | F8a |
| `formatTime`, `fullTimestamp` in `frontend/src/app/submissionLabels.ts`; `<Time iso>` in `frontend/src/app/Time.tsx` (never import them from `documents/`) | D1 (5.1) | `grep -n "export function formatTime" frontend/src/app/submissionLabels.ts && test -f frontend/src/app/Time.tsx` | F2, F5b, F8a, F8b |
| Read-only `SubmissionsTable` (`showFinalColumn`, `viewRoute`, `actions` optional) in `frontend/src/documents/SubmissionsTable.tsx` | DX (5.7) | `grep -n "showFinalColumn" frontend/src/documents/SubmissionsTable.tsx` | F8b (optional, see F8b) |
| `submission` VersionRef for leads; `CaseViewer` history rewritten | B1 (2.5), E3 (6.4) | `grep -n "\"submission\"" src/ontocurator/authz/versions.py` and E3 reported done | F9 |
| `DESIGN.md` contracts of the Documents plan | X1 (8.1) | X1 reported done | F11 |

Recommended: run Documents U1, U2 and D1 (no backend dependency) and B5 before Wave 2 of this plan.

## Shared files and ownership

| File | Owning WP (plan) | What this plan assumes or changes |
|---|---|---|
| `frontend/src/ui/Dialog.tsx`, the `.ui-dialog*` block in `styles/components.css` | **F1 (this plan)** | Header close button and fixed footer. Keeps the `footer` prop, the `.modal-actions` class, `size`, `initialFocus` and `onClose` that quick-fixes WP-B and problem-reports WP6/WP7 consume. F1 also implements the narrow-viewport full-height sheet for `size="md"` below 700 px (problem-reports **CR-2**, accepted; noted in spec §8); problem-reports WP6 and WP9d depend on it. |
| `frontend/src/styles/components.css` | Documents U1 (owner); quick-fixes WP-C, WP-D, WP-E, WP-F (anchored regions); F1 (`.ui-dialog*` block) | F1 never runs at the same time as any other writer of this file. |
| `tasks/RoundInputEvidenceDialog.tsx`, `tasks/WorkRoundsDialog.tsx` | quick-fixes **WP-B** first (Close into `footer`), then **F8a** (rewrite) | F8a starts only after WP-B and keeps WP-B's `frontend/tests/dialogFooters.test.tsx` cases for these two dialogs passing (F8a owns that file after WP-B for assertion updates only). `tasks/WorkRoundActions.tsx`: F8a only. `TaskProblemActions.tsx` stays with quick-fixes / problem-reports. |
| `styles/screens/editor.css` | quick-fixes **WP-F** first (Q7 ring, Q8 list padding), then **F4a** (width variable, separator), then **F4b** (removes the dead `.round-input-panel*` / `.work-round-actions ol` rules) | F4a keeps WP-F's Q7 rule (`box-shadow: 0 0 0 2px var(--surface-raised), 0 0 0 4px var(--focus-ring)`) unchanged. |
| `frontend/tests/quickFixStyles.test.ts` | quick-fixes WP-F, then F4b | F4b removes only the Q8 assertion (the rule is dead after F6b and F8a). |
| `frontend/browser/quick-fixes.spec.ts` | quick-fixes WP-H, then problem-reports WP9e (problem-report lines), then F10 | F10 removes or retargets only the `Q1 (B1)` test (if WP-H wrote it; F8a renamed the dialogs and F6b removed "Inspect original evidence") and the `Q8` test (carried panel and round list no longer exist). |
| Editor toolbar `taskActions` slot, `tasks/TaskProblemActions.tsx` | Problem-reports | Untouched here. This plan changes only the mode badge text and the submit control in the toolbar (`editor/SubmitControl.tsx`, created by F0). |
| `ui/Button.tsx`, `ui/InlineConfirm.tsx`, `ui/shortcuts.ts`, `ui/useMediaQuery.ts`, `ui/index.ts` | Documents U1 | Consumed unchanged. `Button` busy = `loading` (focus kept). Inline confirmations use `InlineConfirm`. Shortcuts use `useShortcut` / `useShortcutHint` as is. |
| `ui/DataTable.tsx` | Documents U2 | Consumed unchanged by F8a. |
| `frontend/src/app/submissionLabels.ts`, `app/Time.tsx` | Documents D1 | Imported for all times (`formatTime`, `Time`). Round names use `Round {n}` built from server `round_ordinal`; no second ordinal algorithm in the frontend. |
| `src/ontocurator/domain/submission_labels.py` (`round_ordinals`) | Documents B5 | Imported by `application/round_reads.py`. |
| `src/ontocurator/api/app.py` | Documents B4 → B9 (owner) | B2 (one status-map line) and B3 (one router include) take the file only while no Documents/problem-reports WP holds it. |
| `src/ontocurator/domain/admin_error_codes.py`, `contracts/admin-error-codes.json`, `frontend/src/admin/errors.ts` | Documents B4 (owner) | B2 adds one code, regenerates, adds one message; only after Documents B4 and never concurrently with another writer. |
| `contracts/openapi.json`, `frontend/src/api/generated.ts`, `frontend/src/api/client.ts` | Documents B9 (owner); problem-reports WP4/WP8 | B4 regenerates and adds a carried-review section to `client.ts`; one regeneration at a time across all plans. |
| `src/ontocurator/storage/repository.py` | Documents B1 | **Not modified** by this plan. B2 calls existing methods (`run_mutation(before_operation=…)`, `_draft_events`) only. |
| `tests/browser_server.py` | Documents P1, problem-reports WP9 | F10 adds one import and one registration line; never concurrently with P1 or WP9. |
| `variants/CaseViewer.tsx`, `frontend/tests/caseViewer.test.tsx` | Documents E3 | F9 adds one mount and one test after E3. |
| `DESIGN.md` | Documents X1 | F11 adds rows after X1. |

### Cross-plan locks (ordering the orchestration overview must respect)

1. **F1** after Documents U1 and not concurrently with quick-fixes WP-C/D/E/F (`components.css`). Prefer F1 **before** quick-fixes WP-B and problem-reports WP6/WP7, so their tests are written against the header close; if any of them landed first, F1 scopes their ambiguous `getByRole("button", { name: "Close" })` queries (F1 owns those test files for that query change only).
2. **F4a** after quick-fixes WP-F (`editor.css`).
3. **F8a** after quick-fixes WP-B (`WorkRoundsDialog.tsx`, `RoundInputEvidenceDialog.tsx`) and never concurrently with problem-reports WP6 (both edit `frontend/tests/dialogFooters.test.tsx`: F8a the two round-dialog cases, WP6 the problem-report case).
4. **F4b** after F6b, F8a and quick-fixes WP-F (removes the Q8 rule and its assertion).
5. **B2** after Documents B4 (error-code files, `app.py`); **B3** after Documents B9 or between its holders (`app.py`).
6. **B4** never concurrently with Documents B9 or problem-reports WP4/WP8 (generated contracts, `client.ts`).
7. **F9** after Documents E3. **F10** after Documents P1 and problem-reports WP9a (`tests/browser_server.py`, one at a time), after quick-fixes WP-H, Documents P7 and problem-reports WP9e (existing specs, `quick-fixes.spec.ts`); Playwright alone in the worktree. **F11** after Documents X1.

## Decisions

### Made by the user (2026-10-19)

1. **Undo dismissal restores the carried finding.** When a dismissal removed the carried finding (atomic dismiss), "Undo dismissal" puts that finding back exactly as it was at the moment of the dismissal (same version, values, note and evidence) and resets the input to "Check needed". One server mutation, recorded as an edit event (B2, F6c).
2. **Toolbar open count always.** "Finish & Submit · n open" and the quiet "Next open item" are shown whenever open items exist, not only after the submit dialog was opened; both disappear at 0 (F7).
3. **No authorization change for `GET /api/v1/rounds/{round_id}/inputs`.** It already reads through `ScopedRepository` (owner or `EXPORT_ALL_WORK`). B1 adds regression tests (owner, lead, another annotator on the same document, outsider) and keeps all reads during enrichment scoped.
4. **Check-code explanations** are collected by F3 in a review file and confirmed by the user before release (release gate, not an implementation blocker).

### Taken in this plan (defaults; one-line changes if the user decides otherwise)

1. **"Mark in text" link is client-side.** The new finding is remembered as the input's result in editor state only (no server write) until "Mark as checked"; after a reload the placeholder offers "Link to an existing finding…", which lists it. No auto-complete (spec contract).
2. **"Next open item" has no key.** `N` / `Shift+N` cover carried checks; `C` is "Mark as checked" (spec Resolved 6).
3. **`WorkRoundView` gets one extra field `source_submission_recorded_at`** (not in the spec's API table) so the identity line "continued from Round 2 submission (19 Oct, 00:57)" needs no second request.
4. **Origin of a source on another text version** reads "Round 2 · v1"; the author is omitted because carry sources are always the user's own submissions.
5. **A plain dismissal of a mapping-failed or user-deleted input** has nothing to restore; "Undo dismissal" only clears the resolution.

---

## Work packages, dependencies and lanes

"Heavy" = takes one of the two machine-wide test-heavy slots. `F6` in sibling plans means F6a–F6c.

| WP | Content | Owns (writes) | Depends on | Weight |
|---|---|---|---|---|
| B1 | Read-only round, input and source fields; store `review_reason`; access regression tests | `domain/work_rounds.py`, `application/round_reads.py` (new), `application/work_rounds.py` (create: input payload only), `api/work_round_routes.py` (list/inputs/sources/create responses), `tests/test_round_read_fields.py` (new), `tests/test_round_inputs_access_api.py` (new) | Documents B5 | heavy (pytest) |
| B2 | Atomic dismiss, clear with restore, submission-time guard | `application/work_rounds.py` (`RoundInputResolutionService`, `validate_round_input_resolutions`), `application/editing.py` (`_delete_annotation` extraction only), `api/work_round_routes.py` (resolve + new clear route), `domain/admin_error_codes.py`, `api/app.py` (one status line), `contracts/admin-error-codes.json`, `frontend/src/admin/errors.ts` (one entry), `tests/test_round_input_resolution_contract.py` (new) | B1 (same files); Documents B4 (lock 5) | heavy |
| B3 | Own submissions across rounds; submission detail with round inputs | `api/assignment_submission_routes.py` (new), `application/round_reads.py` (append), `api/submission_history_routes.py` (detail fields), `api/app.py` (router include), `tests/test_assignment_submissions_api.py` (new) | B2 (shared files); lock 5 | heavy |
| B4 | Contracts and client | `contracts/openapi.json`, `frontend/src/api/generated.ts`, `frontend/src/api/client.ts` (carried-review section), `frontend/tests/carriedClient.test.ts` (new) | B1, B2, B3; lock 6 | light |
| F0 | Split `CaseScreen.tsx` (no behaviour change); split one test file | `app/CaseScreen.tsx`, `editor/FindingRow.tsx`, `editor/SubmitCaseDialog.tsx`, `editor/SubmitControl.tsx`, `editor/HistoricalSubmissionDialog.tsx` (new), `frontend/tests/workRoundActions.test.tsx` (move-out only), `frontend/tests/carriedPanelLegacy.test.tsx` (new, moved cases) | none | heavy (full Vitest) |
| F1 | `Dialog` header close and fixed footer; full-height `md` sheet below 700 px (problem-reports CR-2) | `ui/Dialog.tsx`, `.ui-dialog*` block in `styles/components.css` (incl. its `@media (max-width: 699px)` rule), `frontend/tests/ui/dialog.test.tsx`; query-scoping edits in `frontend/tests/caseScreen.test.tsx`, `adminApp.test.tsx`, `codeOnceDialog.test.tsx`, `documentAssignmentsApp.test.tsx`, `ui/shortcutHelp.test.tsx`, `usersPage.test.tsx`, `variantAdmin.test.tsx` and, if landed, `dialogFooters.test.tsx` / problem-reports dialog tests | F0 (shares `caseScreen.test.tsx`); lock 1 | heavy (full Vitest) |
| F2 | Pure model: check state, instructions, round labels | `editor/carried/checkState.ts`, `editor/carried/instructions.ts`, `editor/rounds/roundLabels.ts`, `frontend/tests/carried/checkState.test.ts`, `frontend/tests/carried/instructions.test.ts`, `frontend/tests/rounds/roundLabels.test.ts` | Documents D1 | light |
| F3 | Translation check explanations; review file | `translation/ReviewParts.tsx` (`ChecksSummary` only), `translation/labels.ts` (check section), `translation/translation.css` (append), `frontend/tests/translationChecks.test.tsx` (new), `frontend/tests/translationReview.test.tsx` and `translationLabels.test.ts` (check assertions only), `docs/superpowers/reviews/2026-10-19-translation-check-explanations-review.md` (new) | none | light |
| F4a | Sidebar resizer component, width hook, CSS | `editor/SidebarResizer.tsx`, `editor/sidebarWidth.ts`, `styles/screens/editor.css` (width variables, separator), `frontend/tests/sidebarResizer.test.tsx` | lock 2 | light |
| F5a | Carried list parts | `editor/carried/CarriedRowExtras.tsx`, `editor/carried/PlaceholderRow.tsx`, `editor/carried/CarriedProgress.tsx`, `editor/carried/carried-list.css`, `frontend/tests/carried/listParts.test.tsx` | F2 | light |
| F5b | Carried inspector parts | `editor/carried/CarriedSection.tsx`, `editor/carried/ExceptionPanel.tsx`, `editor/carried/CarriedChecksReadOnly.tsx`, `editor/carried/carried-inspector.css`, `frontend/tests/carried/inspectorParts.test.tsx` | F2, Documents U1, D1 | light |
| F6a | `useCarriedReview` hook with queue state, errors and retry | `editor/carried/useCarriedReview.ts`, `frontend/tests/carried/useCarriedReview.test.tsx` | F2, B4 | light |
| F6b | List and selection wiring: one list, placeholders, progress, `N`, announcements, toolbar badge; remove `RoundInputPanel` | `app/CaseScreen.tsx`, `tasks/RoundInputPanel.tsx` (delete), `frontend/tests/carriedPanelLegacy.test.tsx` (delete), `frontend/tests/carried/carriedList.test.tsx` (new), "Saved findings" assertions in `frontend/tests/caseScreen.test.tsx`, `sidebar.test.tsx` | F0, F1 (test-file order), F5a, F6a | heavy |
| F6c | Inspector wiring: section, exception path, Mark in text, link, dismiss, undo, delete text, `C` | `app/CaseScreen.tsx`, `editor/AnnotationPanel.tsx` (`deleteConfirmMessage` prop only), `editor/carried/ExceptionPanel.tsx` (`data-carried-dismiss` only), `frontend/tests/carried/carriedInspector.test.tsx` (new) | F6b, F5b | heavy |
| F7 | Submit dialog items, Go to, toolbar count, Next open item | `editor/openItems.ts`, `editor/SubmitCaseDialog.tsx`, `editor/SubmitControl.tsx`, `app/CaseScreen.tsx`, `editor/AnnotationPanel.tsx` (`data-axis-field` only), `spans/adapter.ts` and `editor/TextPane.tsx` (scroll to evidence only), `frontend/tests/openItems.test.ts`, `frontend/tests/submitDialog.test.tsx`, `frontend/tests/spanScroll.test.ts` (new); assertion updates in `caseScreen.test.tsx` | F6c, F1 | heavy |
| F8a | Work rounds dialog and original evidence dialog | `tasks/WorkRoundsDialog.tsx`, `tasks/WorkRoundActions.tsx`, `tasks/RoundInputEvidenceDialog.tsx`, `tasks/workRounds.css` (new), `frontend/tests/workRoundsDialog.test.tsx` (new), `frontend/tests/workRoundActions.test.tsx`, `frontend/tests/dialogFooters.test.tsx` (assertions for these two dialogs only) | B4, F1, F2, Documents U1, U2, D1; lock 3 | light |
| F8b | My submissions, historical dialog, toolbar identity, wiring of F8a's new props | `editor/MySubmissions.tsx` (new), `editor/historicalSubmission.ts` (new), `editor/HistoricalSubmissionDialog.tsx`, `tasks/TaskEditor.tsx`, `app/CaseScreen.tsx`, `frontend/tests/mySubmissions.test.tsx`, `frontend/tests/historicalSubmission.test.tsx` (new) | F7 (CaseScreen sequence), F8a, F5b, B4, F1 | heavy |
| F4b | Mount the resizer; mobile tab label; remove dead Q8 CSS | `app/CaseScreen.tsx`, `styles/screens/editor.css` (delete `.round-input-panel*` and `.work-round-actions ol` rules only), `frontend/tests/quickFixStyles.test.ts` (Q8 assertion only), `frontend/tests/sidebarLayout.test.tsx` (new) | F4a, F8b (CaseScreen sequence), F6b, F8a; lock 4 | light |
| F9 | Lead read-only check states in the case viewer | `variants/CaseViewer.tsx` (one mount), `frontend/tests/caseViewer.test.tsx` (append one test) | F5b, B4; lock 7 (Documents E3) | light |
| F10 | Browser fixture and scenarios | `tests/browser_carry_fixture.py` (new), `tests/browser_server.py` (one import, one line), `frontend/browser/carried-review.spec.ts`, `frontend/browser/editor-layout.spec.ts` (new), existing specs that assert removed UI, `Q1 (B1)` and `Q8` tests in `frontend/browser/quick-fixes.spec.ts` | all above; lock 7 | heavy (Playwright, alone) |
| F11 | DESIGN.md and final gate | `DESIGN.md` | F10; lock 7 (Documents X1) | heavy (gate, alone) |

`CaseScreen.tsx` sequence (never two at once): **F0 → F6b → F6c → F7 → F8b → F4b**.
`AnnotationPanel.tsx`: F6c → F7. `ExceptionPanel.tsx`: F5b → F6c. `caseScreen.test.tsx`: F0 (baseline only) → F1 → F6b → later CaseScreen WPs (assertion updates only).

Dependency graph:

```
Documents B5 ─> B1 ─> B2 ─> B3 ─> B4 ─┬─> F6a ─> F6b ─> F6c ─> F7 ─> F8b ─> F4b ─┐
F0 ─> F1 ───────────────────────────────┼────────┘                   │             │
Documents D1 ─> F2 ─┬─> F5a ────────────┘ (F6b)                       │             ├─> F10 ─> F11
                    └─> F5b ─> F6c                                    │             │
B4, F1, F2, U1, U2, D1, QF WP-B ─> F8a ───────────────────────────────┴─> F8b, F4b  │
QF WP-F ─> F4a ─> F4b          F3 (independent) ────────────────────────────────────┤
F9 (F5b, B4, Documents E3) ─────────────────────────────────────────────────────────┘
```

Recommended lanes. Lane A and Lane C each hold at most one heavy slot; Lane B is light only. When a sibling plan needs a heavy slot, pause Lane A first (its WPs are short).

| Wave | Lane A (backend, heavy) | Lane B (light only) | Lane C (frontend, heavy) |
|---|---|---|---|
| 1 | B1 | F3; F2 (after D1); F4a (after QF WP-F) | F0 |
| 2 | B2 (after Documents B4) | F5a; F5b (after U1, D1) | F1 (after F0; lock 1) |
| 3 | B3, then B4 (light, lock 6) | F6a (after B4); F8a (after B4, lock 3) | — |
| 4 | — | F9 (after Documents E3) | F6b |
| 5 | — | — | F6c |
| 6 | — | — | F7 |
| 7 | — | F4b (after F8b) | F8b |
| 8 | F10 alone (Playwright), then F11 gate alone | | |

Parallel-safe (disjoint owned files): any of B1–B3 with F0, F2, F3, F4a, F5a, F5b; F5a ∥ F5b; F2 ∥ F3 ∥ F4a; F6a ∥ F8a; F9 with any Lane C WP. Never parallel: two WPs that own `CaseScreen.tsx`; B1/B2/B3 among each other; F0 with F1 (`caseScreen.test.tsx`); F1 with any other `components.css` writer; F6c with F7 (`AnnotationPanel.tsx`).

---

## B1: Read-only round, input and source fields

**Goal:** `WorkRoundView`, `RoundInputView` and `RoundSourceView` carry ordinals, server times and counts; new carry-forward inputs store the re-anchor `review_reason`.

**Spec sections:** "API and backend changes" (first three rows), "Terms" (source round).
**May read:** `src/ontocurator/application/work_rounds.py:157-520` (create), `src/ontocurator/api/work_round_routes.py`, `src/ontocurator/domain/work_rounds.py:1-60`, `src/ontocurator/storage/repository.py:391-496` (`get_work_round`, `get_round_input_inventory`), `src/ontocurator/storage/workflow_tables.py` (`WorkRoundRow`, `WorkRoundStateRow`, `RoundSubmissionBindingRow`, `RoundInputRow`), `src/ontocurator/storage/tables.py:375-400` (`SubmissionRow.recorded_at`), `src/ontocurator/domain/submission_labels.py` (`round_ordinals`), `src/ontocurator/authz/scoped.py:129-152` (`get_work_round`, `get_round_input_inventory`), `tests/test_work_rounds.py:1-180` (fixture `rounds` and the create → submit → carry flow), `tests/test_assignment_round_open_api.py` (`round_work` fixture, HTTP users).

**Prerequisite check:** `grep -n "def round_ordinals" src/ontocurator/domain/submission_labels.py` must match (Documents B5).

- [ ] **Step 1: Failing tests** in `tests/test_round_read_fields.py`

```python
"""Read-only facts on work rounds, carried inputs and carry sources."""

import pytest
from test_work_rounds import rounds  # noqa: F401  (fixture reuse)

from ontocurator.application.editing import EditingService
from ontocurator.application.round_reads import (
    enrich_inputs,
    enrich_rounds,
    enrich_sources,
)
from ontocurator.application.submissions import SubmissionService
from ontocurator.application.work_rounds import WorkRoundService
from ontocurator.authz.scoped import ScopedRepository
from ontocurator.domain.workspace import MutationEnvelope


def _submit_first_round(rounds):  # noqa: F811
    repo, access, actor, assignment, ontology = rounds
    scoped = ScopedRepository(repo.db, access, actor)
    service = WorkRoundService(repo.db)
    first = service.create(
        access, actor, assignment.id, request_id="r1", expected_workflow_revision=0
    )
    created = EditingService(scoped, ontology).apply(
        first.workspace_key,
        MutationEnvelope(
            mutation_id="c",
            expected_revision=0,
            payload={
                "command": "create_annotation",
                "annotation_id": "a",
                "term_id": "HP:0001252",
                "axes_values": {"assertion": "present"},
                "chosen_axis_ids": ["assertion"],
                "note": "N",
            },
        ),
    )
    submission = SubmissionService(scoped, ontology).submit(
        first.workspace_key,
        MutationEnvelope(
            mutation_id="s",
            expected_revision=created.revision,
            payload={"document_checked": True},
        ),
    )
    carried = service.create(
        access,
        actor,
        assignment.id,
        request_id="r2",
        expected_workflow_revision=1,
        kind="carry_forward",
        source_submission_ids=[submission.submission_id],
    )
    return repo, assignment, first, submission, carried


def test_rounds_have_ordinals_counts_times_and_text_identity(rounds):  # noqa: F811
    repo, assignment, first, submission, carried = _submit_first_round(rounds)
    views = enrich_rounds(
        repo,
        "pkg-1",
        [
            repo.get_work_round("pkg-1", first.round_id),
            repo.get_work_round("pkg-1", carried.round_id),
        ],
    )
    one, two = views
    assert (one.round_ordinal, two.round_ordinal) == (1, 2)
    assert one.submission_count == 1 and two.submission_count == 0
    assert (
        one.latest_submission_recorded_at is not None
        and two.latest_submission_recorded_at is None
    )
    assert one.input_count == 0 and two.input_count == 1
    assert one.source_round_ordinal is None and two.source_round_ordinal == 1
    assert two.source_submission_recorded_at == one.latest_submission_recorded_at
    assert (
        two.created_at is not None
        and two.document_language == "en"
        and two.document_version == 1
    )


def test_inputs_have_source_round_time_language_version(rounds):  # noqa: F811
    repo, _assignment, _first, _submission, carried = _submit_first_round(rounds)
    [item] = enrich_inputs(
        repo, "pkg-1", repo.get_round_input_inventory("pkg-1", carried.round_id)
    )
    assert item.source_round_ordinal == 1
    assert item.source_recorded_at is not None
    assert (item.source_language, item.source_version) == ("en", 1)
    assert item.review_reason is None  # mapped input


def test_sources_have_round_ordinal_server_time_and_finding_count(rounds):  # noqa: F811
    repo, assignment, _first, submission, _carried = _submit_first_round(rounds)
    [source] = enrich_sources(repo, "pkg-1", [submission.submission_id])
    assert source.round_ordinal == 1 and source.finding_count == 1
    assert source.recorded_at is not None
```

Add one test that a needs-review input stores `review_reason`: build the source finding with evidence on text that the second round cannot map (follow the pattern in `tests/test_reanchor.py` that produces `NeedsReview`, or create the carry round on a corrected document as `tests/browser_server.py:1006-1130` does) and assert `item.mapping_status == "needs_review" and item.review_reason in {"missing_evidence", "ambiguous_evidence", "changed_segment", ...}`. If building that fixture costs more than 30 minutes, assert instead at unit level on the payload builder (Step 3 extracts `_input_payload(...)`).

Access regression tests (user decision 3; no authorization change) in `tests/test_round_inputs_access_api.py`, HTTP against the app with the `round_work` fixture pattern of `tests/test_assignment_round_open_api.py`. Build one carry-forward round for annotator A on document D, then `GET /api/v1/rounds/{round_id}/inputs` as:
  - `test_owner_reads_enriched_inputs`: A → 200, one item, `source_round_ordinal == 1`.
  - `test_lead_reads_inputs`: a project lead → 200, same items.
  - `test_other_annotator_on_same_document_is_refused`: annotator B, assigned to D in the same project → the not-found answer that `ScopedRepository.get_work_round` gives today (`ROUND_NOT_FOUND`; assert the status the app maps it to). No item data in the body.
  - `test_outsider_is_refused`: a user without membership in the project → the same not-found answer as an unknown round id (assert both responses are equal in status and code).
These tests pin today's behaviour; if one fails before Step 3, stop and report (do not change access rules).

- [ ] **Step 2: Run** `uv run pytest tests/test_round_read_fields.py tests/test_round_inputs_access_api.py -q`; Expected: `test_round_read_fields.py` FAIL (`ModuleNotFoundError: ontocurator.application.round_reads`); the four access tests PASS already except the enriched-field assertion in `test_owner_reads_enriched_inputs`.

- [ ] **Step 3: Implement**

`src/ontocurator/domain/work_rounds.py`: add optional fields (defaults keep `get_work_round`, archived rounds and packages valid):

```python
class RoundInputView(BaseModel):
    ...  # existing fields
    review_reason: str | None = None
    source_round_ordinal: int | None = None
    source_recorded_at: datetime | None = None
    source_language: str | None = None
    source_version: int | None = None


class WorkRoundView(BaseModel):
    ...  # existing fields
    round_ordinal: int | None = None
    created_at: datetime | None = None
    submission_count: int = 0
    latest_submission_recorded_at: datetime | None = None
    input_count: int = 0
    source_round_ordinal: int | None = None
    source_submission_recorded_at: datetime | None = None
    document_language: str | None = None
    document_version: int | None = None
```

`RoundInputView.decode` must keep accepting stored payloads with or without `review_reason`.

`application/work_rounds.py` (create, the `inputs.append({...})` block at ~436): add `"review_reason": None if target else mapped.reason` when `mapped` is a `NeedsReview` (import it from `domain.reanchor`); for any other non-`Carried` result store `None`. This changes the manifest hash of new rounds only. Run `tests/test_work_rounds.py::test_v3_package_roundtrip_retains_private_input_closure_without_promotion`; if a package schema rejects the key, add `review_reason: str | None = None` to that schema model.

New `src/ontocurator/application/round_reads.py`:

```python
"""Read-only facts for rounds, carried inputs and carry sources (no writes)."""

from collections.abc import Iterable, Sequence
from typing import Any

from sqlalchemy import func, select

from ontocurator.domain.submission_labels import round_ordinals
from ontocurator.domain.work_rounds import RoundInputView, WorkRoundView
from ontocurator.storage.repository import Repository
from ontocurator.storage.tables import SubmissionRow
from ontocurator.storage.workflow_tables import (
    RoundInputRow,
    RoundSubmissionBindingRow,
    WorkRoundRow,
)


def _ordinals(conn: Any, pid: int, assignment_ids: Iterable[int]) -> dict[str, int]:
    rows = conn.execute(
        select(
            WorkRoundRow.round_id,
            WorkRoundRow.predecessor_round_id,
            WorkRoundRow.assignment_id,
        )
        .where(
            WorkRoundRow.project_id == pid,
            WorkRoundRow.assignment_id.in_(list(assignment_ids)),
        )
        .order_by(WorkRoundRow.created_at, WorkRoundRow.round_id)
    ).all()
    return round_ordinals((r.round_id, r.predecessor_round_id) for r in rows)


def _round_of_submission(
    conn: Any, pid: int, sids: Sequence[str]
) -> dict[str, tuple[str, int]]:
    """submission_id -> (round_id, assignment_id)."""
    rows = conn.execute(
        select(
            RoundSubmissionBindingRow.submission_id,
            RoundSubmissionBindingRow.round_id,
            WorkRoundRow.assignment_id,
        )
        .join(WorkRoundRow, WorkRoundRow.round_id == RoundSubmissionBindingRow.round_id)
        .where(
            RoundSubmissionBindingRow.project_id == pid,
            RoundSubmissionBindingRow.submission_id.in_(list(sids)),
        )
    ).all()
    return {r.submission_id: (r.round_id, r.assignment_id) for r in rows}


def _recorded(conn: Any, pid: int, sids: Sequence[str]) -> dict[str, Any]:
    rows = conn.execute(
        select(
            SubmissionRow.submission_id,
            SubmissionRow.recorded_at,
            func.jsonb_array_length(SubmissionRow.payload["snapshots"]).label(
                "findings"
            ),
        ).where(
            SubmissionRow.project_id == pid, SubmissionRow.submission_id.in_(list(sids))
        )
    ).all()
    return {r.submission_id: r for r in rows}
```

Then three public functions, each opening one `repo.db.snapshot()` (read-only) connection:

- `enrich_rounds(repo, project_key, views: list[WorkRoundView]) -> list[WorkRoundView]`: ordinals over all rounds of the involved assignments **and** of the assignments owning their source submissions; `created_at` from `WorkRoundRow`; `submission_count` = bindings per round; `latest_submission_recorded_at` = recorded time of `latest_submission_id`; `input_count` = `RoundInputRow` count (archived rounds: `len(repo.get_round_input_inventory(...))`); for `kind == "carry_forward"`: `source_round_ordinal` and `source_submission_recorded_at` from `input_submission_ids[0]`; `document_language` / `document_version` from `repo.list_variants(project_key)` by `document_id`. Return `view.model_copy(update=...)`.
- `enrich_inputs(repo, project_key, items: list[dict]) -> list[RoundInputView]`: per item `source_round_ordinal` (round of `source_submission_id`, ordinal within its assignment), `source_recorded_at`, `source_language` / `source_version` from the variant of `source_snapshot["document_id"]` (or the snapshot's document id field used by `decode_snapshot`; check `AnnotationSnapshot` for the exact attribute).
- `enrich_sources(repo, project_key, sids: list[str]) -> list[dict]`: `{"round_ordinal", "recorded_at", "finding_count"}` per submission id.

The response model for sources stays `RoundSourceView` in the routes module.

`api/work_round_routes.py`:
- `create_round` and `list_rounds` return `enrich_rounds(...)` of their result(s).
- `round_inputs` returns `enrich_inputs(repo, project, repo.get_round_input_inventory(project, round_id))`, where `repo = get_repo(request)` stays the `ScopedRepository`: the inventory is read through it **before** enrichment, so the owner-or-`EXPORT_ALL_WORK` check runs first. `enrich_inputs` never fetches inputs or rounds itself; its SQL is restricted to the submission ids named by the already authorized items. The same applies to `enrich_rounds` (only views returned by scoped calls) and `enrich_sources` (only ids returned by the scoped source listing).
- `RoundSourceView` gains `round_ordinal: int | None = None`, `recorded_at: datetime | None = None`, `finding_count: int = 0`; `round_sources` fills them from `enrich_sources` (keep `created_at` for compatibility; the UI stops using it).

- [ ] **Step 4: Run** `uv run pytest tests/test_round_read_fields.py tests/test_round_inputs_access_api.py tests/test_work_rounds.py tests/test_work_round_identity.py tests/test_assignment_round_open_api.py -q` and `uv run ruff check . && uv run ruff format --check . && uv run mypy src`. Expected: all PASS, no lint/type errors. (OpenAPI drift is expected until B4; do not run `check.sh --only static` here.)

**Done checklist:** new fields optional with defaults; no change to access checks; access regression tests for owner, lead, other annotator and outsider green; enrichment only after scoped reads; `review_reason` stored only for new rounds; listed test files green; static checks green.
**Commit point (later):** `src/ontocurator/domain/work_rounds.py src/ontocurator/application/round_reads.py src/ontocurator/application/work_rounds.py src/ontocurator/api/work_round_routes.py tests/test_round_read_fields.py tests/test_round_inputs_access_api.py` — `feat: read-only round ordinals, times and counts for rounds and carried inputs`.

---

## B2: Atomic dismiss and clear resolution

**Goal:** Dismissing an input whose carried finding still exists removes that finding and records the dismissal in one mutation; a plain dismissal is rejected while the carried finding exists. **Submission enforces the same invariant**: a dismissed input whose carried finding is in the draft (legacy dismissals, or a finding re-created with the carried ID) blocks submission. A new mutation clears a resolution before submission; when the dismissal removed the carried finding, clearing restores that finding exactly as it was (user decision 1). All are logged as edit events by `run_mutation`.

**Spec sections:** "Resolved questions" 1 and 3; "Contracts preserved".
**May read:** `src/ontocurator/application/work_rounds.py:582-657` (`validate_round_input_resolutions`, `RoundInputResolutionService`), `src/ontocurator/application/submissions.py:425-435` (where validation runs), `src/ontocurator/application/editing.py:1223-1265` (`_delete_annotation`), `src/ontocurator/storage/repository.py:222-260` (`DraftState`, stored as `edit_events.state`), `:1782-1830` (`_insert_snapshots`, snapshot rows), `:2949-3060` (`run_mutation`, `before_operation`), `:3122-3170` (`_log_edit`, `_draft_events`), `:1535-1575` (`edit_log`), `src/ontocurator/api/app.py:390-410` (status map), `tests/test_work_rounds.py:55-180`.

**Lock:** starts only after Documents B4 (owner of the error-code files and the `app.py` status map) and while no other WP holds `app.py` or the error-code files. Does not modify `storage/repository.py`.

- [ ] **Step 1: Failing tests** `tests/test_round_input_resolution_contract.py` (reuse `_submit_first_round` by importing it from `test_round_read_fields`)

```python
import pytest
from test_round_read_fields import _submit_first_round
from test_work_rounds import rounds  # noqa: F401

from ontocurator.application.editing import EditingService
from ontocurator.application.submissions import SubmissionService
from ontocurator.application.work_rounds import RoundInputResolutionService
from ontocurator.authz.scoped import ScopedRepository
from ontocurator.domain.errors import DomainError
from ontocurator.domain.workspace import MutationEnvelope


def _ctx(rounds):  # noqa: F811
    repo, access, actor, _assignment, ontology = rounds
    repo, _a, _first, _submission, carried = _submit_first_round(rounds)
    scoped = ScopedRepository(repo.db, access, actor)
    item = repo.get_round_input_inventory("pkg-1", carried.round_id)[0]
    return repo, scoped, ontology, carried.workspace_key, item


def test_dismiss_is_rejected_while_the_carried_finding_exists(rounds):  # noqa: F811
    repo, scoped, _o, key, item = _ctx(rounds)
    with pytest.raises(DomainError, match="ROUND_INPUT_CARRIED_FINDING_PRESENT"):
        RoundInputResolutionService(scoped).resolve(
            key,
            MutationEnvelope(
                mutation_id="d",
                expected_revision=0,
                payload={
                    "input_id": item["input_id"],
                    "outcome": "dismissed",
                    "reason": "Not in this text",
                },
            ),
        )


def test_dismiss_with_removal_removes_finding_and_records_one_event(rounds):  # noqa: F811
    repo, scoped, ontology, key, item = _ctx(rounds)
    carried_id = item["target_snapshot"]["annotation"]["annotation_id"]
    draft = RoundInputResolutionService(scoped).resolve(
        key,
        MutationEnvelope(
            mutation_id="d",
            expected_revision=0,
            payload={
                "input_id": item["input_id"],
                "outcome": "dismissed",
                "reason": "Not in this text",
                "remove_carried_finding": True,
            },
        ),
    )
    assert draft.revision == 1
    assert all(s.annotation.annotation_id != carried_id for s in draft.annotations)
    assert not any(e.mention.evidence_id.startswith(carried_id) for e in draft.evidence)
    [resolution] = draft.round_input_resolutions
    assert resolution.outcome == "dismissed" and resolution.reason == "Not in this text"
    events = [
        e
        for e in repo.edit_log("pkg-1")
        if e["command"].get("input_id") == item["input_id"]
    ]
    assert len(events) == 1 and events[0]["command"]["remove_carried_finding"] is True
    # submission accepts the dismissed input
    SubmissionService(scoped, ontology).submit(
        key,
        MutationEnvelope(
            mutation_id="s", expected_revision=1, payload={"document_checked": True}
        ),
    )


def test_removal_flag_is_invalid_for_completion(rounds):  # noqa: F811
    _repo, scoped, _o, key, item = _ctx(rounds)
    with pytest.raises(DomainError, match="ROUND_INPUT_INVALID"):
        RoundInputResolutionService(scoped).resolve(
            key,
            MutationEnvelope(
                mutation_id="x",
                expected_revision=0,
                payload={
                    "input_id": item["input_id"],
                    "outcome": "completed",
                    "remove_carried_finding": True,
                    "annotation_ref": {
                        "annotation_id": item["target_snapshot"]["annotation"][
                            "annotation_id"
                        ],
                        "version": item["target_snapshot"]["version"],
                    },
                },
            ),
        )


def test_clear_resets_a_dismissal_restores_the_finding_and_is_logged(rounds):  # noqa: F811
    repo, scoped, _o, key, item = _ctx(rounds)
    carried_id = item["target_snapshot"]["annotation"]["annotation_id"]
    service = RoundInputResolutionService(scoped)
    before = service.resolve(
        key,
        MutationEnvelope(
            mutation_id="d",
            expected_revision=0,
            payload={
                "input_id": item["input_id"],
                "outcome": "dismissed",
                "reason": "R",
                "remove_carried_finding": True,
            },
        ),
    )
    assert all(s.annotation.annotation_id != carried_id for s in before.annotations)
    cleared = service.clear(
        key,
        MutationEnvelope(
            mutation_id="u",
            expected_revision=1,
            payload={
                "command": "clear_round_input_resolution",
                "input_id": item["input_id"],
            },
        ),
    )
    assert cleared.round_input_resolutions == [] and cleared.revision == 2
    [restored] = [
        s for s in cleared.annotations if s.annotation.annotation_id == carried_id
    ]
    assert (
        restored.version == item["target_snapshot"]["version"]
    )  # untouched since round start
    assert repo.edit_log("pkg-1")[-1]["command"] == {
        "command": "clear_round_input_resolution",
        "input_id": item["input_id"],
    }


def test_undo_restores_the_edited_version_with_values_note_and_evidence(rounds):  # noqa: F811
    _repo, scoped, ontology, key, item = _ctx(rounds)
    carried_id = item["target_snapshot"]["annotation"]["annotation_id"]
    # Edit the carried finding first (note and one axis value; add a mention if the fixture text allows),
    # using the same EditingService commands the editor sends; capture the draft after the edit.
    edited = _edit_carried_finding(
        scoped, ontology, key, carried_id
    )  # helper in this file
    snapshot = next(
        s for s in edited.annotations if s.annotation.annotation_id == carried_id
    )
    evidence = sorted(
        (e.mention.evidence_id, e.version)
        for e in edited.evidence
        if any(
            r.evidence_id == e.mention.evidence_id
            for r in snapshot.annotation.evidence_refs
        )
    )
    service = RoundInputResolutionService(scoped)
    service.resolve(
        key,
        MutationEnvelope(
            mutation_id="d",
            expected_revision=edited.revision,
            payload={
                "input_id": item["input_id"],
                "outcome": "dismissed",
                "reason": "R",
                "remove_carried_finding": True,
            },
        ),
    )
    cleared = service.clear(
        key,
        MutationEnvelope(
            mutation_id="u",
            expected_revision=edited.revision + 1,
            payload={
                "command": "clear_round_input_resolution",
                "input_id": item["input_id"],
            },
        ),
    )
    [restored] = [
        s for s in cleared.annotations if s.annotation.annotation_id == carried_id
    ]
    assert restored == snapshot  # same version, values, note, evidence refs
    assert (
        sorted(
            (e.mention.evidence_id, e.version)
            for e in cleared.evidence
            if any(
                r.evidence_id == e.mention.evidence_id
                for r in restored.annotation.evidence_refs
            )
        )
        == evidence
    )


def test_undo_of_a_plain_dismissal_restores_nothing(rounds):  # noqa: F811
    _repo, scoped, ontology, key, item = _ctx(rounds)
    carried_id = item["target_snapshot"]["annotation"]["annotation_id"]
    deleted = _delete_finding(
        scoped, ontology, key, carried_id, expected_revision=0
    )  # user deletes it first
    service = RoundInputResolutionService(scoped)
    service.resolve(
        key,
        MutationEnvelope(
            mutation_id="d",
            expected_revision=deleted.revision,
            payload={
                "input_id": item["input_id"],
                "outcome": "dismissed",
                "reason": "R",
            },
        ),
    )
    cleared = service.clear(
        key,
        MutationEnvelope(
            mutation_id="u",
            expected_revision=deleted.revision + 1,
            payload={
                "command": "clear_round_input_resolution",
                "input_id": item["input_id"],
            },
        ),
    )
    assert cleared.round_input_resolutions == []
    assert all(s.annotation.annotation_id != carried_id for s in cleared.annotations)


def test_submission_rejects_a_legacy_dismissal_while_the_carried_finding_exists(rounds):  # noqa: F811
    repo, scoped, ontology, key, item = _ctx(rounds)
    from ontocurator.domain.workspace import RoundInputResolution

    def legacy(draft):  # what the pre-B2 resolve() allowed
        draft.round_input_resolutions = [
            RoundInputResolution(
                input_id=item["input_id"], outcome="dismissed", reason="R"
            )
        ]
        return draft

    repo.run_mutation(
        key,
        MutationEnvelope(
            mutation_id="legacy", expected_revision=0, payload={"legacy": True}
        ),
        legacy,
    )
    with pytest.raises(DomainError, match="ROUND_INPUT_CARRIED_FINDING_PRESENT"):
        SubmissionService(scoped, ontology).submit(
            key,
            MutationEnvelope(
                mutation_id="s", expected_revision=1, payload={"document_checked": True}
            ),
        )


def test_submission_rejects_a_finding_recreated_with_the_carried_id(rounds):  # noqa: F811
    _repo, scoped, ontology, key, item = _ctx(rounds)
    carried = item["target_snapshot"]["annotation"]
    RoundInputResolutionService(scoped).resolve(
        key,
        MutationEnvelope(
            mutation_id="d",
            expected_revision=0,
            payload={
                "input_id": item["input_id"],
                "outcome": "dismissed",
                "reason": "R",
                "remove_carried_finding": True,
            },
        ),
    )
    EditingService(scoped, ontology).apply(
        key,
        MutationEnvelope(
            mutation_id="c",
            expected_revision=1,
            payload={
                "command": "create_annotation",
                "annotation_id": carried["annotation_id"],
                "term_id": carried["term_id"],
                "axes_values": {},
                "chosen_axis_ids": [],
            },
        ),
    )
    with pytest.raises(DomainError, match="ROUND_INPUT_CARRIED_FINDING_PRESENT"):
        SubmissionService(scoped, ontology).submit(
            key,
            MutationEnvelope(
                mutation_id="s", expected_revision=2, payload={"document_checked": True}
            ),
        )


def test_clear_without_resolution_or_unknown_input_is_invalid(rounds):  # noqa: F811
    _repo, scoped, _o, key, item = _ctx(rounds)
    for payload in (
        {"command": "clear_round_input_resolution", "input_id": item["input_id"]},
        {"command": "clear_round_input_resolution", "input_id": "nope"},
    ):
        with pytest.raises(DomainError, match="ROUND_INPUT_INVALID"):
            RoundInputResolutionService(scoped).clear(
                key,
                MutationEnvelope(
                    mutation_id=payload["input_id"],
                    expected_revision=0,
                    payload=payload,
                ),
            )


def test_clear_after_submission_is_refused(rounds):  # noqa: F811
    repo, scoped, ontology, key, item = _ctx(rounds)
    service = RoundInputResolutionService(scoped)
    service.resolve(
        key,
        MutationEnvelope(
            mutation_id="d",
            expected_revision=0,
            payload={
                "input_id": item["input_id"],
                "outcome": "dismissed",
                "reason": "R",
                "remove_carried_finding": True,
            },
        ),
    )
    SubmissionService(scoped, ontology).submit(
        key,
        MutationEnvelope(
            mutation_id="s", expected_revision=1, payload={"document_checked": True}
        ),
    )
    with pytest.raises(DomainError):
        service.clear(
            key,
            MutationEnvelope(
                mutation_id="u",
                expected_revision=2,
                payload={
                    "command": "clear_round_input_resolution",
                    "input_id": item["input_id"],
                },
            ),
        )
```

`_edit_carried_finding` and `_delete_finding` are small helpers in this file that send the editor's existing commands through `EditingService.apply` (look up the command names and payloads in `application/editing.py`: note update, axis update, mention creation if the fixture text has a free span, `delete_annotation`) and return the resulting draft. The legacy test uses `repo.run_mutation` with a custom operation only to build a pre-B2 state; adapt the payload if `MutationEnvelope` requires a `command` key.

Add one HTTP test in the same file using the app/harness pattern of `tests/test_assignment_round_open_api.py::round_work` (or `tests/test_submission_history_api.py`): `POST /api/v1/workspaces/{id}/round-input-resolutions` with a plain dismissal returns **409** with code `ROUND_INPUT_CARRIED_FINDING_PRESENT`; `POST /api/v1/workspaces/{id}/round-input-resolutions/clear` returns 200 with the draft; another user's workspace id returns the same error as other `own_key` failures.

- [ ] **Step 2: Run** `uv run pytest tests/test_round_input_resolution_contract.py -q`; Expected FAIL (no error raised; `clear` missing).

- [ ] **Step 3: Implement**

`application/editing.py`: extract the body after the scope check of `_delete_annotation` into a module-level function and call it from `_delete_annotation` (behaviour unchanged):

```python
def remove_draft_annotation(draft: Draft, annotation_id: str) -> None:
    """Remove a finding, replacement decisions naming it and orphaned evidence; unchecks its layer."""
    target = next(
        (a for a in draft.annotations if a.annotation.annotation_id == annotation_id),
        None,
    )
    if target:
        draft.checked_layer_ids = [
            lid for lid in draft.checked_layer_ids if lid != target.annotation.layer_id
        ]
    draft.annotations = [
        a for a in draft.annotations if a.annotation.annotation_id != annotation_id
    ]
    draft.decisions = [
        d
        for d in draft.decisions
        if not (d.replacement and d.replacement.annotation_id == annotation_id)
    ]
    active = {
        r.evidence_id for a in draft.annotations for r in a.annotation.evidence_refs
    }
    draft.evidence = [e for e in draft.evidence if e.mention.evidence_id in active]
```

`application/work_rounds.py`, in `RoundInputResolutionService`:

```python
class ResolveRoundInputCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    input_id: str
    outcome: Literal["completed", "dismissed"]
    annotation_ref: AnnotationRef | None = None
    reason: str | None = None
    remove_carried_finding: bool = False


class ClearRoundInputCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command: Literal["clear_round_input_resolution"]
    input_id: str
```

`resolve()`: validate the payload with `ResolveRoundInputCommand`; if `remove_carried_finding and outcome != "dismissed"` raise `DomainError("ROUND_INPUT_INVALID")`; build `RoundInputResolution(**command.model_dump(exclude={"remove_carried_finding"}))` (keeps its own validation). Inside `operation`, for `dismissed`:

```python
target = inputs[resolution.input_id].get("target_snapshot")
carried_id = target["annotation"]["annotation_id"] if target else None
present = carried_id is not None and any(
    s.annotation.annotation_id == carried_id for s in draft.annotations
)
if present and not command.remove_carried_finding:
    raise DomainError(
        "ROUND_INPUT_CARRIED_FINDING_PRESENT",
        {"input_id": resolution.input_id, "annotation_id": carried_id},
    )
if present:
    remove_draft_annotation(draft, carried_id)
```

Keep the existing kind/unknown-input checks first.

`validate_round_input_resolutions` (submission time): for every `dismissed` resolution, if the input has a `target_snapshot` and a draft annotation with that `annotation_id` exists (any version), raise `DomainError("ROUND_INPUT_CARRIED_FINDING_PRESENT", {"input_id": iid, "annotation_id": carried_id})` instead of `continue`. This covers drafts dismissed before B2 and findings re-created with the carried ID. Before finishing, `grep -rn "dismissed" tests/browser_server.py scripts/seed_t5_acceptance.py tests/test_work_rounds.py` and confirm no fixture dismisses a carried input while its finding exists; if one does, stop and report (those files are not owned here).

Add `clear(key, envelope)`: same kind and input checks; `ClearRoundInputCommand.model_validate(envelope.payload)`; if no resolution for the input raise `DomainError("ROUND_INPUT_INVALID", {"input_id": ...})`. Restoration (user decision 1) uses `run_mutation(..., before_operation=load)`, so the lookup runs inside the mutation's transaction after the draft lock:

- `load(conn)`: from `self.repo._draft_events(key)` (refine the statement; do not edit `repository.py`) take the newest event of this draft whose `command` names this `input_id` and is either a resolve or a clear. If it is a resolve with `outcome == "dismissed"` and `remove_carried_finding` true, find the draft state **before** it: the `state` of the event with `revision_after == event.revision_before`, or, when `revision_before == 0` (no earlier event), the round's initial content, i.e. the input's `target_snapshot` and its evidence. From that state take the `(carried_id, version)` pair and the `(evidence_id, version)` pairs the annotation's `evidence_refs` name; load their payloads from `AnnotationSnapshotRow` / `EvidenceSnapshotRow` of this project (content-addressed, written by `_insert_snapshots`) and validate them as the draft's snapshot models. Otherwise restore nothing.
- `operation(draft)`: remove the resolution; if a finding was loaded and no draft annotation has `carried_id`, append the annotation snapshot and every loaded evidence snapshot not already in `draft.evidence`. Checked-layer state is not changed.

`run_mutation` already refuses non-editable rounds (`_check_round_mutation`) and logs the event (one event for the clear, with the full post-restore state).

`api/work_round_routes.py`: new route next to `resolve_input`:

```python
@router.post("/workspaces/{workspace_id}/round-input-resolutions/clear")
def clear_input(
    workspace_id: str,
    envelope: MutationEnvelope,
    request: Request,
    principal: PrincipalDep,
) -> Draft:
    key = own_key(principal, decode_workspace_id(workspace_id))
    return RoundInputResolutionService(get_repo(request)).clear(key, envelope)
```

Register `ROUND_INPUT_CARRIED_FINDING_PRESENT` in `domain/admin_error_codes.py`, as 409 in the status map in `api/app.py` (next to `ROUND_INPUT_RESOLUTION_STALE`), regenerate `contracts/admin-error-codes.json` (`uv run python scripts/export_admin_error_codes.py`), and add to `frontend/src/admin/errors.ts`: `ROUND_INPUT_CARRIED_FINDING_PRESENT: "This carried finding is still on the text. Dismiss it from the finding itself so it is removed at the same time.",`.

- [ ] **Step 4: Run** `uv run pytest tests/test_round_input_resolution_contract.py tests/test_work_rounds.py tests/test_editing.py tests/test_admin_error_codes.py tests/test_review_roundtrip_regressions.py -q`, `uv run python scripts/export_admin_error_codes.py --check`, `uv run ruff check . && uv run ruff format --check . && uv run mypy src`. Expected: all PASS.

**Done checklist:** plain dismissal with carried finding present → 409 code; atomic dismissal removes finding + orphan evidence in one revision and one event; submission refuses a dismissed input whose carried finding is present (legacy and re-created ID); clear works only on resolved inputs of editable rounds and restores the removed finding exactly (version, values, note, evidence); plain dismissals restore nothing; `_delete_annotation` behaviour unchanged (`tests/test_editing.py` green); `repository.py` untouched; error code registered in all three places.
**Commit point (later):** the owned files — `feat: atomic carried dismissal and clearing of carried-input resolutions`.

---

## B3: Own submissions across rounds; submission detail with round inputs

**Goal:** `GET /api/v1/assignments/{assignment_id}/submissions` lists the assignment's submissions across all its rounds (owner and leads). The submission history detail additionally returns what the read-only views need: carried inputs and resolutions (lead read-only check states), checked layers and re-anchor history (historical dialog).

**Spec sections:** "API and backend changes" (row 4), section 7 "My submissions", Resolved question 5.
**May read:** `src/ontocurator/api/submission_history_routes.py`, `src/ontocurator/api/work_round_routes.py:56-77` (owner-or-lead check pattern), `src/ontocurator/application/round_reads.py` (B1), `tests/test_submission_history_api.py`.

- [ ] **Step 1: Failing tests** `tests/test_assignment_submissions_api.py`, modelled on `tests/test_submission_history_api.py` (HTTP, real PostgreSQL):
  - `test_owner_lists_submissions_of_all_rounds_oldest_first`: Round 1 submitted, Round 2 carry-forward submitted → two items, `round_ordinal` 1 then 2, `recorded_at` ascending, `finding_count` equals snapshot count, `submission_id`, `round_id`, `document_id`, `language`, `version` present.
  - `test_lead_can_list_and_other_annotator_gets_not_found`: a lead of the project gets 200; another annotator gets the same error as `GET /assignments/{id}/rounds` (`ASSIGNMENT_NOT_FOUND`).
  - `test_new_round_without_submission_still_lists_earlier_rounds`: after starting Round 2 (editable, no submission) the list still holds Round 1's submission.
  - `test_detail_of_carry_forward_submission_contains_inputs_and_resolutions`: `GET /projects/{key}/documents/{doc}/submissions/{sid}` for the Round 2 submission returns `round_inputs` (one, with `source_round_ordinal == 1`), `round_input_resolutions` (one, `dismissed` with reason), `checked_layer_ids`, `document_checked`, `reanchor_inputs`, `reanchor_resolutions`; for a Round 1 submission both round lists are empty.

- [ ] **Step 2: Run** `uv run pytest tests/test_assignment_submissions_api.py -q`; Expected FAIL (404 route).

- [ ] **Step 3: Implement**

`application/round_reads.py` (append):

```python
def assignment_submissions(
    repo: Repository, project_key: str, assignment_id: int
) -> list[dict[str, Any]]:
    """Submissions bound to any round of the assignment, oldest recorded first."""
```

Query: `RoundSubmissionBindingRow` joined to `WorkRoundRow` (`assignment_id == assignment_id`) joined to `SubmissionRow`; plus the assignment's `last_submission_id` when it has no binding (legacy). Ordinals via `_ordinals`. Language/version from `repo.list_variants`. Order by `recorded_at, submission_id`.

New `api/assignment_submission_routes.py`:

```python
class AssignmentSubmissionView(BaseModel):
    submission_id: str
    round_id: str | None
    round_ordinal: int | None
    recorded_at: datetime
    finding_count: int
    document_id: str
    language: str
    version: int


router = APIRouter(prefix="/api/v1", tags=["work-rounds"])


@router.get("/assignments/{assignment_id}/submissions")
def list_assignment_submissions(
    assignment_id: int, request: Request, principal: PrincipalDep
) -> list[AssignmentSubmissionView]:
    repo = get_repo(request)
    with repo.db.transaction() as conn:
        assignment = AssignmentService._get(conn, assignment_id)
        if assignment.user_id != principal.user_id and not can(
            get_access(request), Action.MANAGE_ASSIGNMENTS, assignment.project_key
        ):
            raise DomainError("ASSIGNMENT_NOT_FOUND")
    return [
        AssignmentSubmissionView(**item)
        for item in assignment_submissions(repo, assignment.project_key, assignment_id)
    ]
```

Include the router in `api/app.py` next to the work-round router (one line; take `app.py` only while no Documents or problem-reports WP holds it, see "Cross-plan locks" 5).

`api/submission_history_routes.py`: `SubmissionHistoryDetail` gains

```python
checked_layer_ids: list[str] = []
document_checked: bool = False
reanchor_inputs: list[ReanchorItem] = []  # same types as on Submission
reanchor_resolutions: list[ReanchorResolution] = []
round_inputs: list[RoundInputView] = []
round_input_resolutions: list[RoundInputResolution] = []
```

Fill the first four from the decoded `Submission`; when the summary's `round_id` is set and that round is `carry_forward`, after leaving the snapshot `with` block call `enrich_inputs(repo, key, repo.get_round_input_inventory(key, round_id))` and take `submission.round_input_resolutions`. Use the exact types used by `Submission` for re-anchor fields (`grep -n "reanchor_inputs" src/ontocurator/domain/workspace.py`). Authorization stays `may_read_human_submission` (leads and owner).

- [ ] **Step 4: Run** `uv run pytest tests/test_assignment_submissions_api.py tests/test_submission_history_api.py -q` and static checks. Expected: PASS.

**Done checklist:** endpoint owner + lead only; oldest first; detail additive (existing tests green); no access rule changed.
**Commit point (later):** owned files — `feat: own submissions across rounds and carried states in submission detail`.

---

## B4: Contracts and frontend client

**Goal:** Regenerate contracts; add client methods.
**May read:** `frontend/src/api/client.ts:660-720`, `frontend/tests/apiClient.test.ts` (method test pattern; read only).
**Lock:** generated contracts and `client.ts` are owned by Documents B9; problem-reports WP4/WP8 also regenerate. Run B4 only while none of them runs (one regeneration at a time, across plans). Regeneration is deterministic from source, so B4 after B9 simply includes both plans' routes.

- [ ] **Step 1: Failing test** in a new `frontend/tests/carriedClient.test.ts` (copy the fetch-mock pattern of `frontend/tests/apiClient.test.ts`; do not edit that file): `clearRoundInputResolution("ws", envelope)` POSTs to `/api/v1/workspaces/ws/round-input-resolutions/clear` with the JSON envelope; `listAssignmentSubmissions(7)` GETs `/api/v1/assignments/7/submissions`.
- [ ] **Step 2: Run** `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/carriedClient.test.ts`; Expected FAIL.
- [ ] **Step 3: Implement**: `uv run python scripts/export_openapi.py && npm --prefix frontend run api:generate`. In `client.ts`, in one block commented `// Carried review (editor-carried-review plan)` next to the work-round methods, add `export type AssignmentSubmissionView = components["schemas"]["AssignmentSubmissionView"];` and

```ts
  async clearRoundInputResolution(workspaceId: string, envelope: MutationEnvelope): Promise<Draft> {
    return this.request(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/round-input-resolutions/clear`, { method: "POST", body: JSON.stringify(envelope) });
  }
  async listAssignmentSubmissions(assignmentId: number): Promise<AssignmentSubmissionView[]> {
    return this.request(`/api/v1/assignments/${assignmentId}/submissions`, { method: "GET" });
  }
```

- [ ] **Step 4: Run** the test file, `npm --prefix frontend run typecheck`, `uv run python scripts/export_openapi.py --check`, `npm --prefix frontend run api:check`. Expected: PASS, no drift.

**Done checklist:** generated types contain the new fields of B1–B3; client methods tested; typecheck green.
**Commit point (later):** `contracts/openapi.json frontend/src/api/generated.ts frontend/src/api/client.ts frontend/tests/carriedClient.test.ts` — `chore: regenerate contracts for carried review`.

---

## F0: Split `CaseScreen.tsx` (no behaviour change)

**Goal:** Move four self-contained render blocks out of `frontend/src/app/CaseScreen.tsx` (2778 lines) into their own files so F6–F8b own separate files. No visible or behavioural change.
**May read:** `frontend/src/app/CaseScreen.tsx` at: findings row `2318-2370`; submission history section `2375-2382`; historical submission dialog `2593-2640`; submit dialog `2675-2756`; toolbar submit button `2098-2110`. Line numbers are as of 2026-10-19; locate by the quoted strings ("Saved findings", "Submission history", `title="Historical submission"`, `title="Submit case"`, "Finish & Submit Case").

- [ ] **Step 1: Baseline**: `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/caseScreen.test.tsx tests/sidebar.test.tsx tests/workRoundActions.test.tsx tests/assignmentEditor.test.tsx tests/reanchorIntegration.test.tsx` and `npm --prefix frontend run typecheck`. Record the result (all PASS expected; if not, report the pre-existing failures and do not fix them).
- [ ] **Step 2: Extract**, moving JSX verbatim and turning closure values into props:
  - `editor/FindingRow.tsx`: `export function FindingRow(props: { snapshot: AnnotationSnapshot; selected: boolean; termLabel: (layer: string, term: string) => string | null; layerName?: string; showLayer: boolean; axes: ReturnType<typeof findingAxes>; defaulted: boolean; proposal?: ProposalLike; onActivate: () => void; children?: ReactNode })`. Renders the existing `<li data-list-key="annotation:{id}" …>` with the same classes, roles and keyboard handler; `children` is rendered after the axis summary (slot for F6b). The click logic stays in CaseScreen and is passed as `onActivate`.
  - `editor/SubmitCaseDialog.tsx`: the whole `<Dialog title="Submit case">` with explicit props for every value it reads (counts, issue lists, flags, callbacks: `onReviewEvidenceIssue`, `onReviewPendingReanchor`, `onReviewCarried`, `onReviewDefaulted`, `onConfirm`, `onCancel`, `setTextChecked`, `setAxisWarningAcknowledged`, `termLabel`, `layers`).
  - `editor/SubmitControl.tsx`: the "Finish & Submit Case" button: `{ onSubmit, disabled, pending }`.
  - `editor/HistoricalSubmissionDialog.tsx`: the historical submission dialog: `{ submission: Submission; heading: string; documentText: string; termLabel; onClose }`.
  Keep the "Submission history" section in CaseScreen (F8b replaces it).
- [ ] **Step 3: Split one test file** (so F6b and F8a own disjoint files later): move the carried-panel cases of `frontend/tests/workRoundActions.test.tsx` (today ~lines 82-140, the ones asserting `RoundInputPanel` / "Review carried findings") **verbatim** into a new `frontend/tests/carriedPanelLegacy.test.tsx`, copying the imports and helpers they use. No assertion changes. Afterwards `workRoundActions.test.tsx` holds only Work-rounds-dialog cases (F8a owns it) and `carriedPanelLegacy.test.tsx` only panel cases (F6b deletes it).
- [ ] **Step 4: Run** the Step 1 commands plus `tests/carriedPanelLegacy.test.tsx`, then the full suite `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1`. Expected: identical results to the baseline (same number of passing tests; no new failures).

F0 does not run concurrently with F1 (F1 edits `caseScreen.test.tsx`, which is part of F0's baseline).

**Done checklist:** four new files; CaseScreen shorter; no assertion changed, only the verbatim test move; DOM unchanged (same roles, names, `data-*` attributes).
**Commit point (later):** `refactor(editor): extract finding row, submit dialog, submit control and historical dialog`.

---

## F1: `Dialog` header close and fixed footer

**Goal:** Spec section 8, plus the narrow-viewport full-height sheet for `size="md"` (problem-reports CR-2, accepted).
**Weight:** heavy (full Vitest run plus query fixes in other test files).
**Lock:** after F0; after Documents U1; never concurrently with quick-fixes WP-C/D/E/F (other `components.css` regions). Prefer running before quick-fixes WP-B and problem-reports WP6/WP7 ("Cross-plan locks" 1).
**May read:** `frontend/src/ui/Dialog.tsx`, `frontend/src/ui/ConfirmDialog.tsx` (already passes `onClose={busy ? undefined : onCancel}`), `frontend/src/ui/IconButton.tsx`, `frontend/src/styles/components.css:606-631`, `frontend/tests/ui/dialog.test.tsx`; the test files listed in Step 4.

- [ ] **Step 1: Failing tests** (append to `frontend/tests/ui/dialog.test.tsx`)

```tsx
it("renders_a_header_close_button_only_with_onClose", () => {
  const close = vi.fn();
  const { rerender } = render(<Dialog open title="T" onClose={close}><button>Body</button></Dialog>);
  const button = screen.getByRole("button", { name: "Close" });
  fireEvent.click(button); expect(close).toHaveBeenCalledOnce();
  rerender(<Dialog open title="T"><button>Body</button></Dialog>);
  expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
});
it("initial_focus_skips_the_header_close_button", () => {
  render(<Dialog open title="T" onClose={vi.fn()}><button>Body</button></Dialog>);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Body" }));
});
it("focuses_the_dialog_when_the_body_has_nothing_focusable", () => {
  render(<Dialog open title="T" onClose={vi.fn()}><p>Text</p></Dialog>);
  expect(document.activeElement).toBe(screen.getByRole("dialog"));
});
it("header_close_is_first_in_tab_order_and_footer_is_outside_the_body", () => {
  render(<Dialog open title="T" onClose={vi.fn()} footer={<button>Done</button>}><button>Body</button></Dialog>);
  const dialog = screen.getByRole("dialog");
  expect(dialog.querySelector(".ui-dialog-header button")).toBe(screen.getByRole("button", { name: "Close" }));
  expect(screen.getByRole("button", { name: "Done" }).closest(".ui-dialog-body")).toBeNull();
});
it("busy_confirm_dialog_has_no_header_close", () => {
  render(<ConfirmDialog open busy title="Delete" message={<p>m</p>} confirmLabel="Delete" onConfirm={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
});
```

- [ ] **Step 2: Run** `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/ui/dialog.test.tsx`; Expected FAIL.
- [ ] **Step 3: Implement**. In `Dialog`:

```tsx
<div className="ui-dialog-header">
  <h2 className="ui-dialog-heading">{heading ?? title}</h2>
  {onClose && <IconButton className="ui-dialog-close" label="Close" icon={<IconClose />} variant="quiet" size="sm" data-dialog-close onClick={onClose} />}
</div>
```

`focusInside` picks `requested` or the first focusable element **that is not `[data-dialog-close]`**, else the dialog element:

```ts
const candidates = focusableElements(element).filter(item => !item.hasAttribute("data-dialog-close"));
(requested && element.contains(requested) ? requested : candidates[0] ?? element).focus();
```

Tab trapping keeps using all focusable elements (the close button is reachable). Import `IconButton` from `./IconButton` and `IconClose` from `./icons` (no `ui/index` import inside `ui/`).

CSS (replace the `.ui-dialog` / `.ui-dialog-heading` / `.ui-dialog-body` block in `components.css`):

```css
.ui-dialog { display: flex; flex-direction: column; gap: var(--space-4); max-height: min(90vh, calc(100dvh - var(--space-6))); padding: var(--space-5); font-size: var(--size-md); line-height: var(--leading-md); }
.ui-dialog-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); flex: none; }
.ui-dialog-close { flex: none; margin: calc(-1 * var(--space-2)) calc(-1 * var(--space-2)) 0 0; min-width: 24px; min-height: 24px; }
.ui-dialog-body { flex: 1 1 auto; min-height: 0; overflow: auto; overflow-wrap: anywhere; }
.ui-dialog > .modal-actions { flex: none; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2); }
```

Narrow viewports (problem-reports CR-2, spec "Narrow viewports" of the problem-reports spec): directly after the `.ui-dialog--md` size rule add a separate block (do not merge it into the shell's existing `@media (max-width: 699px)` block, which quick-fixes WP-D owns):

```css
@media (max-width: 699px) {
  .ui-dialog--md { width: calc(100vw - 2 * var(--space-4)); max-width: none; height: calc(100dvh - 2 * var(--space-4)); max-height: none; }
}
```

The flex column with `.ui-dialog-body { flex: 1 1 auto; overflow: auto }` keeps the footer fixed. Append a style assertion to `frontend/tests/ui/dialog.test.tsx` (jsdom does not evaluate media queries, so read the CSS text as `frontend/tests/tokens.test.ts` does):

```tsx
it("md_dialog_is_a_full_height_sheet_below_700px", () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../src/styles/components.css"), "utf8");
  const block = css.match(/@media \(max-width: 699px\) \{\s*\.ui-dialog--md \{([^}]*)\}/);
  expect(block?.[1]).toMatch(/height: calc\(100dvh - 2 \* var\(--space-4\)\)/);
  expect(block?.[1]).toMatch(/max-width: none/);
});
```

(imports: `readFileSync` from `node:fs`, `dirname`/`resolve` from `node:path`, `fileURLToPath` from `node:url`). Check used by problem-reports WP6/WP9d: `grep -n -A2 "max-width: 699px" frontend/src/styles/components.css | grep "ui-dialog--md"`.

"Case submitted" passes no `onClose` today (verify in CaseScreen: `title="Case submitted"` has no `onClose`), so it keeps no header close.

- [ ] **Step 4: Fix ambiguous queries.** Every dialog with `onClose` now has a header button named "Close", so `getByRole("button", { name: "Close" })` becomes ambiguous where the body or footer also has a "Close" button. Known today (`grep -rln 'name: "Close"' frontend/tests`): `caseScreen.test.tsx` (~896, ~935, historical submission dialog), `adminApp.test.tsx`, `codeOnceDialog.test.tsx`, `documentAssignmentsApp.test.tsx`, `ui/shortcutHelp.test.tsx`, `usersPage.test.tsx`, `variantAdmin.test.tsx`; plus quick-fixes `dialogFooters.test.tsx` and problem-reports dialog tests if they landed before F1. For each ambiguous query, scope it to the intended button: `within(dialog.querySelector(".modal-actions") as HTMLElement)` for footer buttons, `within(dialog.querySelector(".ui-dialog-body") as HTMLElement)` for body buttons. Change only the query; never rename the header button and never weaken an assertion.
- [ ] **Step 5: Run** `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/ui/dialog.test.tsx tests/ui` and the files changed in Step 4, then the full suite `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1` and `npm --prefix frontend run typecheck`. Expected PASS.

**Done checklist:** header close only with `onClose`; initial focus never on it; footer outside scroll; Escape parity unchanged; busy ConfirmDialog without header close; `md` dialog is a full-height sheet below 700 px (CR-2).
**Commit point (later):** `feat(ui): dialog header close and fixed footer`.

---

## F2: Pure model: check state, instructions, round labels

**Goal:** All derivations from spec "Terms" table, section 1 instruction table, section 2 "What to check", section 7 wording, as pure functions with structural input types (so F2 does not wait for B4).
**May read:** spec "Terms", sections 1, 2, 3 (reason sentences), 7; `frontend/src/tasks/RoundInputPanel.tsx:11-15` (`currentRoundInputResolution`, replaced later); `frontend/src/app/submissionLabels.ts` (`formatTime`, Documents D1).

- [ ] **Step 1: Failing tests** `frontend/tests/carried/checkState.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { deriveCarriedStates, nextUncheckedKey, progressText, rowKeyOf } from "../../src/editor/carried/checkState";

const snap = (id: string, version = "v1", evidence = 0) => ({ annotation: { annotation_id: id, layer_id: "hpo", type_id: "phenotype", term_id: "HP:1", evidence_refs: Array.from({ length: evidence }, (_, i) => ({ evidence_id: `e${i}`, version: "1" })), axes_values: {}, axes_defaulted: [] }, version, evidence: [], text_sha256: "t1" }) as any;
const input = (id: string, target: any) => ({ input_id: id, source_submission_id: "s1", source_snapshot: snap("orig"), target_snapshot: target, mapping_status: target ? "carried" : "needs_review" }) as any;

describe("deriveCarriedStates", () => {
  it("needed_without_resolution", () => {
    const [s] = deriveCarriedStates([input("i1", snap("input-i1"))], [], [snap("input-i1")]);
    expect(s).toMatchObject({ variant: "needed", unchecked: true, home: "carried", homeId: "input-i1", missing: null });
  });
  it("checked_when_the_named_version_is_current", () => {
    const [s] = deriveCarriedStates([input("i1", snap("input-i1"))], [{ input_id: "i1", outcome: "completed", annotation_ref: { annotation_id: "input-i1", version: "v1" } }], [snap("input-i1")]);
    expect(s.variant).toBe("checked"); expect(s.unchecked).toBe(false);
  });
  it("changed_after_check_when_the_version_differs", () => {
    const [s] = deriveCarriedStates([input("i1", snap("input-i1"))], [{ input_id: "i1", outcome: "completed", annotation_ref: { annotation_id: "input-i1", version: "v1" } }], [snap("input-i1", "v2")]);
    expect(s.variant).toBe("changed"); expect(s.unchecked).toBe(true);
  });
  it("removed_when_the_linked_finding_is_gone_and_placeholder_when_carried_is_gone_too", () => {
    const [s] = deriveCarriedStates([input("i1", snap("input-i1"))], [{ input_id: "i1", outcome: "completed", annotation_ref: { annotation_id: "input-i1", version: "v1" } }], []);
    expect(s).toMatchObject({ variant: "removed", home: "placeholder", homeId: null, missing: "deleted" });
  });
  it("dismissed", () => {
    const [s] = deriveCarriedStates([input("i1", null)], [{ input_id: "i1", outcome: "dismissed", reason: "No" }], []);
    expect(s).toMatchObject({ variant: "dismissed", unchecked: false, home: "placeholder", missing: "mapping_failed" });
  });
  it("linked_finding_is_the_home_and_two_inputs_can_share_it", () => {
    const states = deriveCarriedStates([input("i1", null), input("i2", null)], [
      { input_id: "i1", outcome: "completed", annotation_ref: { annotation_id: "own", version: "v1" } },
      { input_id: "i2", outcome: "completed", annotation_ref: { annotation_id: "own", version: "v1" } }], [snap("own")]);
    expect(states.map(s => [s.home, s.homeId, s.variant])).toEqual([["linked", "own", "checked"], ["linked", "own", "checked"]]);
  });
  it("legacy_draft_with_carried_present_but_another_finding_linked_shows_on_the_linked_row", () => {
    const [s] = deriveCarriedStates([input("i1", snap("input-i1"))], [{ input_id: "i1", outcome: "completed", annotation_ref: { annotation_id: "own", version: "v1" } }], [snap("input-i1"), snap("own")]);
    expect(s).toMatchObject({ home: "linked", homeId: "own", carriedId: "input-i1", variant: "checked" });
  });
});

describe("progress and navigation", () => {
  it("progress_text_variants", () => {
    const mk = (variant: string) => ({ variant, unchecked: ["needed", "changed", "removed"].includes(variant) }) as any;
    expect(progressText([mk("needed")])).toBe("0 of 1 checked");
    expect(progressText([mk("checked"), mk("checked"), mk("dismissed"), mk("needed"), mk("changed")])).toBe("2 of 5 checked, 1 dismissed");
    expect(progressText([mk("checked"), mk("dismissed")])).toBe("All carried findings checked");
  });
  it("next_unchecked_wraps_and_goes_backwards", () => {
    const order = ["input:a", "annotation:x", "annotation:y", "annotation:z"];
    const open = new Set(["input:a", "annotation:y"]);
    expect(nextUncheckedKey(order, open, "annotation:y", 1)).toBe("input:a");
    expect(nextUncheckedKey(order, open, "annotation:x", 1)).toBe("annotation:y");
    expect(nextUncheckedKey(order, open, null, 1)).toBe("input:a");
    expect(nextUncheckedKey(order, open, "input:a", -1)).toBe("annotation:y");
    expect(nextUncheckedKey(order, new Set(), null, 1)).toBeNull();
  });
  it("row_key_of_home_or_placeholder", () => {
    expect(rowKeyOf({ homeId: "x", input: { input_id: "i" } } as any)).toBe("annotation:x");
    expect(rowKeyOf({ homeId: null, input: { input_id: "i" } } as any)).toBe("input:i");
  });
});
```

`frontend/tests/carried/instructions.test.ts` (cases from the spec tables, exact strings):

```ts
import { describe, expect, it } from "vitest";
import { instructionLine, missingReason, originLine, textSpanLine, valuesLines } from "../../src/editor/carried/instructions";

const base = { sourceOrdinal: 2, sourceVersion: 1, currentVersion: 1, language: "de", hasEvidence: true, sameText: true };
describe("instruction lines", () => {
  it.each([
    [{ ...base, hasEvidence: false }, "needed", "carried", "No text span. Check that it still applies to this text."],
    [base, "needed", "carried", "Check the marked text and the values."],
    [{ ...base, sameText: false }, "needed", "carried", "The text changed since Round 2. Check the marked text and the values."],
    [base, "changed", "carried", "Changed after your check. Check it again."],
    [base, "needed", "placeholder:mapping_failed", "Could not be placed on this text. Mark it again, link it or dismiss it."],
    [base, "needed", "placeholder:deleted", "You deleted the carried finding. Link another finding or dismiss it."],
  ] as const)("%#", (ctx, variant, where, text) => { expect(instructionLine(ctx, variant, where)).toBe(text); });
  it("checked_and_dismissed_have_no_instruction", () => {
    expect(instructionLine(base, "checked", "carried")).toBeNull();
    expect(instructionLine(base, "dismissed", "placeholder:deleted")).toBeNull();
  });
});
describe("inspector lines", () => {
  it("text_span_line", () => {
    expect(textSpanLine({ ...base, hasEvidence: false })).toBe("None. This finding had no text span in Round 2 either.");
    expect(textSpanLine(base)).toBe("Same text as in Round 2 (de v1).");
    expect(textSpanLine({ ...base, sameText: false, currentVersion: 2 })).toBe("The text was corrected since Round 2 (v1 → v2). The span was moved; check that it still covers the finding.");
  });
  it("values_lines_name_defaulted_axes", () => {
    expect(valuesLines([])).toEqual(["Carried unchanged. Carrying does not confirm values."]);
    expect(valuesLines(["Temporality"])).toEqual(["Carried unchanged. Carrying does not confirm values.", "Not confirmed: Temporality."]);
  });
  it("origin_line_and_missing_reason", () => {
    expect(originLine(2, "19 Oct, 00:57")).toBe("Carried from Round 2 (submitted 19 Oct, 00:57)");
    expect(originLine(null, null)).toBe("Carried from an earlier submission");
    expect(missingReason("deleted", null)).toBe("You deleted the carried finding in this round.");
    expect(missingReason("mapping_failed", null)).toBe("Its text span could not be found in this text.");
    expect(missingReason("mapping_failed", "ambiguous_evidence")).toBe("Its text appears more than once in this text, so it could not be placed automatically.");
  });
});
```

The `→` in `textSpanLine` is a text character in copy (spec wording), not an icon.

`frontend/tests/rounds/roundLabels.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { carryUnavailableReason, carriedCell, roundIdentity, roundStateLabel, sourceOptionLabel, submissionCell } from "../../src/editor/rounds/roundLabels";

const now = new Date("2026-10-19T12:00:00");
const r = (o: Partial<any>) => ({ round_id: "r", kind: "ordinary", state: "editable", round_ordinal: 1, document_language: "de", document_version: 1, input_count: 0, submission_count: 0, predecessor_round_id: null, ...o });
describe("round labels", () => {
  it("identity_lines", () => {
    expect(roundIdentity(r({}), { now })).toBe("Round 1 · started empty · de v1");
    expect(roundIdentity(r({ kind: "carry_forward", round_ordinal: 3, source_round_ordinal: 2, source_submission_recorded_at: "2026-10-19T00:57:00" }), { now })).toBe("Round 3 · continued from Round 2 submission (19 Oct, 00:57) · de v1");
    expect(roundIdentity(r({ kind: "clean_restart", round_ordinal: 4 }), { now })).toBe("Round 4 · restarted empty after agreement with the lead");
    expect(roundIdentity(r({ kind: "consolidation", round_ordinal: 2, input_submission_ids: ["a", "b"] }), { now })).toBe("Round 2 · consolidation of 2 submissions");
  });
  it("state_labels_name_the_replacing_round", () => {
    const rounds = [r({ round_id: "a", state: "superseded" }), r({ round_id: "b", round_ordinal: 2, predecessor_round_id: "a", state: "abandoned" }), r({ round_id: "c", round_ordinal: 3, predecessor_round_id: "b" })];
    expect(roundStateLabel(rounds[0], rounds)).toBe("Replaced by Round 2");
    expect(roundStateLabel(rounds[1], rounds)).toBe("Discarded by restart");
    expect(roundStateLabel(rounds[2], rounds)).toBe("Open");
    expect(roundStateLabel(r({ state: "submitted" }), rounds)).toBe("Submitted");
  });
  it("submission_and_carried_cells", () => {
    expect(submissionCell(0, null, { now })).toBe("Not submitted yet");
    expect(submissionCell(1, "2026-10-19T00:16:00", { now })).toBe("Submitted 19 Oct, 00:16");
    expect(submissionCell(2, "2026-10-19T00:57:00", { now })).toBe("2 submissions, latest 19 Oct, 00:57");
    expect(carriedCell(0)).toBe("None"); expect(carriedCell(1)).toBe("1 finding"); expect(carriedCell(3)).toBe("3 findings");
  });
  it("carry_unavailable_reasons", () => {
    expect(carryUnavailableReason({ held: true, openRoundOrdinal: 3, sourceCount: 1 })).toBe("The task is paused. Resume it before starting another round.");
    expect(carryUnavailableReason({ held: false, openRoundOrdinal: 3, sourceCount: 1 })).toBe("You can continue from a submission once Round 3 is submitted. Round 3 is still open.");
    expect(carryUnavailableReason({ held: false, openRoundOrdinal: null, sourceCount: 0 })).toBe("There is no submitted work of yours on this text yet.");
    expect(carryUnavailableReason({ held: false, openRoundOrdinal: null, sourceCount: 2 })).toBeNull();
  });
  it("source_option_label", () => {
    expect(sourceOptionLabel({ round_ordinal: 2, recorded_at: "2026-10-19T00:57:00", language: "de", version: 1, finding_count: 1 }, { now })).toBe("Round 2 submission · 19 Oct, 00:57 · de v1 · 1 finding");
  });
});
```

- [ ] **Step 2: Run** `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/carried tests/rounds`; Expected FAIL (modules missing).
- [ ] **Step 3: Implement**

`frontend/src/editor/carried/checkState.ts`:

```ts
export interface SnapshotLike {
  annotation: { annotation_id: string; layer_id: string; type_id: string; term_id: string; evidence_refs?: readonly unknown[] | null; axes_values?: Record<string, unknown> | null; axes_defaulted?: readonly string[] | null; note?: string | null };
  version: string;
  text_sha256?: string | null;
}
export interface CarriedInputLike {
  input_id: string; source_submission_id: string;
  source_snapshot: SnapshotLike; target_snapshot: SnapshotLike | null;
  mapping_status: "carried" | "needs_review";
  review_reason?: string | null; source_round_ordinal?: number | null; source_recorded_at?: string | null;
  source_language?: string | null; source_version?: number | null;
}
export interface ResolutionLike { input_id: string; outcome: "completed" | "dismissed"; annotation_ref?: { annotation_id: string; version: string } | null; reason?: string | null }
export type CheckVariant = "needed" | "changed" | "removed" | "checked" | "dismissed";
export interface CarriedState {
  input: CarriedInputLike; index: number; variant: CheckVariant; unchecked: boolean;
  resolution?: ResolutionLike; home: "carried" | "linked" | "placeholder"; homeId: string | null;
  carriedId: string | null; missing: "mapping_failed" | "deleted" | null;
}

export function deriveCarriedStates(inputs: readonly CarriedInputLike[], resolutions: readonly ResolutionLike[], annotations: readonly SnapshotLike[]): CarriedState[] {
  const byId = new Map(annotations.map(s => [s.annotation.annotation_id, s]));
  return inputs.map((input, index) => {
    const resolution = resolutions.find(r => r.input_id === input.input_id);
    const carriedRef = input.target_snapshot?.annotation.annotation_id ?? null;
    const carriedId = carriedRef !== null && byId.has(carriedRef) ? carriedRef : null;
    const missing = carriedId ? null : input.target_snapshot ? "deleted" as const : "mapping_failed" as const;
    let variant: CheckVariant = "needed", home: CarriedState["home"] = carriedId ? "carried" : "placeholder", homeId = carriedId;
    if (resolution?.outcome === "dismissed") variant = "dismissed";
    else if (resolution?.outcome === "completed" && resolution.annotation_ref) {
      const linked = byId.get(resolution.annotation_ref.annotation_id);
      if (!linked) variant = "removed";
      else {
        variant = linked.version === resolution.annotation_ref.version ? "checked" : "changed";
        homeId = linked.annotation.annotation_id; home = homeId === carriedRef ? "carried" : "linked";
      }
    }
    return { input, index, variant, unchecked: variant === "needed" || variant === "changed" || variant === "removed", resolution, home, homeId, carriedId, missing };
  });
}

export const rowKeyOf = (state: Pick<CarriedState, "homeId" | "input">) => state.homeId ? `annotation:${state.homeId}` : `input:${state.input.input_id}`;

export function progressText(states: readonly Pick<CarriedState, "variant" | "unchecked">[]): string {
  const checked = states.filter(s => s.variant === "checked").length, dismissed = states.filter(s => s.variant === "dismissed").length;
  if (!states.some(s => s.unchecked)) return "All carried findings checked";
  return `${checked} of ${states.length} checked${dismissed ? `, ${dismissed} dismissed` : ""}`;
}

export function nextUncheckedKey(order: readonly string[], open: ReadonlySet<string>, current: string | null, direction: 1 | -1): string | null {
  const candidates = order.filter(key => open.has(key));
  if (!candidates.length) return null;
  const start = current === null ? -1 : order.indexOf(current);
  for (let step = 1; step <= order.length; step++) {
    const key = order[((start + direction * step) % order.length + order.length) % order.length];
    if (open.has(key)) return key;
  }
  return null;
}
```

`frontend/src/editor/carried/instructions.ts`: implement `instructionLine(ctx, variant, where: "carried" | "linked" | "placeholder:mapping_failed" | "placeholder:deleted")`, `textSpanLine(ctx)`, `valuesLines(defaultedAxisLabels)`, `originLine(ordinal, formattedTime)`, `missingReason(missing, reviewReason)` with exactly the strings in the tests. `roundName = (o) => o ? \`Round ${o}\` : "the earlier round"` (also used in "The text changed since …"). `missingReason` sentences per `ReviewReason` (B1 stores these codes):

| `review_reason` | Sentence |
|---|---|
| `ambiguous_evidence` | "Its text appears more than once in this text, so it could not be placed automatically." |
| `changed_segment`, `changed_cue` | "Its text was changed by the correction, so it could not be placed automatically." |
| `missing_evidence`, `evidence_version_mismatch`, `evidence_source_mismatch`, `invalid_bounds`, `source_text_mismatch` | "Its original text span could not be read reliably, so it could not be placed automatically." |
| null / unknown | "Its text span could not be found in this text." |

Also export `whatToCheckContext(input, currentDocument: { version: number; language: string; text_sha256: string })` returning the `ctx` object (`hasEvidence` from `target_snapshot?.annotation.evidence_refs?.length` (or source when target is null), `sameText` = `target_snapshot.text_sha256 === source_snapshot.text_sha256`).

`frontend/src/editor/rounds/roundLabels.ts`: implement the six functions using `formatTime` from `../../app/submissionLabels` (Documents D1; pass `{ now }` through; never import from `documents/`). Round facts are a structural type with the B1 fields (all optional except `round_id`, `kind`, `state`).

- [ ] **Step 4: Run** the three test files and `npm --prefix frontend run typecheck`; Expected PASS.

**Done checklist:** all spec strings exact; no import from `tasks/`, `documents/` or `app/` except `app/submissionLabels`; structural types only.
**Commit point (later):** `feat(editor): pure carried check-state and round label rules`.

---

## F3: Translation check explanations and review file

**Goal:** Spec section 9; collect the explanation texts for user review (Resolved question 4).
**May read:** `frontend/src/translation/ReviewParts.tsx:1-40`, `frontend/src/translation/labels.ts:60-82`, `frontend/tests/translationReview.test.tsx` (existing check assertions), `frontend/tests/translationLabels.test.ts`.

- [ ] **Step 1: Failing tests** `frontend/tests/translationChecks.test.tsx`

```tsx
import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { ChecksSummary } from "../src/translation/ReviewParts";

it("failed_check_block_has_heading_explanation_detail_location_guidance_and_code", () => {
  render(<ChecksSummary failed={[{ code: "units_added", passed: false, detail: "mg added" }]} all={null} />);
  const block = screen.getByRole("heading", { level: 3, name: "Units added in translation" }).closest("section")!;
  const text = block.textContent!;
  expect(text).toContain("The translation run's check found a unit of measurement in the translation that it did not find in the source.");
  expect(within(block).getByText("“mg added”")).toBeTruthy();
  expect(text).toContain("This check does not point to a text location. Compare the source and the translation yourself.");
  expect(text).toContain("Choose Accepted unchanged and say in the rationale why the difference is correct.");
  const term = within(block).getByText("Technical code");
  expect(term.tagName).toBe("DT");
  expect(term.nextElementSibling?.textContent).toBe("units_added");
});
it("unknown_code_uses_the_fallback_explanation", () => {
  render(<ChecksSummary failed={[{ code: "glossary_miss", passed: false }]} all={null} />);
  expect(screen.getByText(/Ontocurator has no description for it; ask the project lead what it checks\./)).toBeTruthy();
});
it("show_all_checks_lists_the_code_on_its_own_labelled_line", () => {
  const { container } = render(<ChecksSummary failed={[]} all={[{ code: "numbers_changed", passed: true }]} />);
  const item = container.querySelector(".translation-checks-all li")!;
  expect(item.textContent).toContain("Numbers changed in translation");
  expect(item.querySelector("dt")?.textContent).toBe("Technical code");
});
```

- [ ] **Step 2: Run** `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/translationChecks.test.tsx`; Expected FAIL.
- [ ] **Step 3: Implement**. In `translation/labels.ts` next to `checkLabels`:

```ts
/** Draft explanations; confirmed by the user before release (docs/superpowers/reviews/2026-10-19-translation-check-explanations-review.md). */
export const checkExplanations: Readonly<Record<string, string>> = {
  units_added: "The translation run's check found a unit of measurement in the translation that it did not find in the source.",
  numbers_changed: "The translation run's check found numbers in the translation that differ from those in the source.",
};
export const unknownCheckExplanation = "The translation run reported this check as failed. Ontocurator has no description for it; ask the project lead what it checks.";
export const checkNoLocation = "This check does not point to a text location. Compare the source and the translation yourself.";
export const checkDeviationGuidance = "Choose Accepted unchanged and say in the rationale why the difference is correct. If it changes the clinical meaning, choose Query or Rejected with the category Number or unit.";
export function checkExplanation(code: string): string { return Object.hasOwn(checkExplanations, code) ? checkExplanations[code] : unknownCheckExplanation; }
```

In `ChecksSummary`, each failure becomes:

```tsx
<section className="translation-check" aria-labelledby={`${id}-check-${index}`}>
  <h3 id={`${id}-check-${index}`}>{checkLabel(check.code)}</h3>
  <dl className="translation-check-facts">
    <div><dt>What it means</dt><dd>{checkExplanation(check.code)}</dd></div>
    {check.detail && <div><dt>From the translation run</dt><dd><span className="translation-check-detail">“{check.detail}”</span></dd></div>}
  </dl>
  <p>{checkNoLocation}</p>
  <dl className="translation-check-facts">
    <div><dt>If the translation is right anyway</dt><dd>{checkDeviationGuidance}</dd></div>
    <div><dt>Technical code</dt><dd><code>{check.code}</code></dd></div>
  </dl>
</section>
```

`id` comes from `useId()` (no duplicate IDs). The curly quotes are written explicitly (`<q>` adds no text in jsdom). The order follows the spec: heading, meaning, detail, location sentence, guidance, code. "Show all checks" items: badge, label, then `<dl className="translation-check-code-line"><dt>Technical code</dt><dd><code>{code}</code></dd></dl>`. Append minimal CSS to `translation.css` (`.translation-check h3 { font-size: var(--size-md); margin: 0 0 var(--space-2); } .translation-check-facts dt { font-weight: var(--weight-strong); } .translation-check-facts dd { margin: 0 0 var(--space-2); }`).

- [ ] **Step 4: Review file.** Create `docs/superpowers/reviews/2026-10-19-translation-check-explanations-review.md` listing, per code (`units_added`, `numbers_changed`, unknown fallback): label, explanation, plus the shared sentences (`checkNoLocation`, `checkDeviationGuidance`), the source file and constant names, a "Status: draft, awaiting user confirmation" line and an empty "Decision" field per row. Search the backend for further codes the translation run can emit (`grep -rn "units_added" src/ tests/ examples/`) and list any other codes found with a proposed label and explanation marked "new draft".
- [ ] **Step 5: Run** `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/translationChecks.test.tsx tests/translationReview.test.tsx tests/translationLabels.test.ts`; update existing assertions that expected the old one-line text (e.g. "Synthetic check exampleunits_added") to the new structure. `npm --prefix frontend run typecheck`. Expected PASS.

**Done checklist:** accessible text "Technical code units_added" as `dt`/`dd`; no text position invented; review file created with every code.
**Commit point (later):** `feat(translation): explain failed automatic checks` + review file.

---

## F4a: Sidebar resizer component, width rules, CSS

**Goal:** Spec section 10 except mounting.
**May read:** spec section 10; `frontend/src/styles/screens/editor.css` lines 55-70, 620-640, 655-670, 815-860; `frontend/src/ui/shortcuts.ts` (`useShortcutHint`).

- [ ] **Step 1: Failing tests** `frontend/tests/sidebarResizer.test.tsx`

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { clampSidebarWidth, readStoredWidth, sidebarLimits, storageKey } from "../src/editor/sidebarWidth";
import { SidebarResizer } from "../src/editor/SidebarResizer";

beforeEach(() => localStorage.clear());
it("limits_three_and_two_columns", () => {
  expect(sidebarLimits({ viewport: 1600, inspector: 380 })).toEqual({ min: 220, max: 480, fallback: 260 });
  expect(sidebarLimits({ viewport: 1100, inspector: 380 })).toEqual({ min: 220, max: 300, fallback: 260 });
  expect(sidebarLimits({ viewport: 900, inspector: 0 })).toEqual({ min: 220, max: 315, fallback: 220 });
});
it("clamps_and_ignores_invalid_stored_values", () => {
  const limits = { min: 220, max: 480, fallback: 260 };
  expect(clampSidebarWidth(900, limits)).toBe(480);
  expect(clampSidebarWidth(100, limits)).toBe(220);
  localStorage.setItem(storageKey("anna"), "abc"); expect(readStoredWidth("anna")).toBeNull();
  localStorage.setItem(storageKey("anna"), "320"); expect(readStoredWidth("anna")).toBe(320);
  expect(storageKey("anna")).toBe("ontocurator.editor.sidebarWidth.v1:anna");
});
it("keyboard_changes_width_and_reports_aria_values", () => {
  const onChange = vi.fn();
  render(<SidebarResizer width={260} limits={{ min: 220, max: 480, fallback: 260 }} controls="sidebar" onChange={onChange} onReset={vi.fn()} onCommit={vi.fn()} />);
  const sep = screen.getByRole("separator", { name: "Resize findings column" });
  expect(sep.getAttribute("aria-valuenow")).toBe("260");
  expect(sep.getAttribute("aria-valuetext")).toBe("260 pixels (default 260)");
  fireEvent.keyDown(sep, { key: "ArrowRight" }); expect(onChange).toHaveBeenLastCalledWith(276);
  fireEvent.keyDown(sep, { key: "ArrowLeft", shiftKey: true }); expect(onChange).toHaveBeenLastCalledWith(220);
  fireEvent.keyDown(sep, { key: "End" }); expect(onChange).toHaveBeenLastCalledWith(480);
  fireEvent.keyDown(sep, { key: "Home" }); expect(onChange).toHaveBeenLastCalledWith(220);
});
it("enter_and_double_click_reset", () => {
  const onReset = vi.fn();
  render(<SidebarResizer width={300} limits={{ min: 220, max: 480, fallback: 260 }} controls="sidebar" onChange={vi.fn()} onReset={onReset} onCommit={vi.fn()} />);
  const sep = screen.getByRole("separator");
  fireEvent.keyDown(sep, { key: "Enter" }); fireEvent.doubleClick(sep);
  expect(onReset).toHaveBeenCalledTimes(2);
});
it("escape_during_drag_restores_the_start_width", () => {
  const onChange = vi.fn();
  render(<SidebarResizer width={260} limits={{ min: 220, max: 480, fallback: 260 }} controls="sidebar" onChange={onChange} onReset={vi.fn()} onCommit={vi.fn()} />);
  const sep = screen.getByRole("separator");
  fireEvent.pointerDown(sep, { clientX: 260, pointerId: 1 });
  fireEvent.pointerMove(sep, { clientX: 300, pointerId: 1 });
  fireEvent.keyDown(sep, { key: "Escape" });
  expect(onChange).toHaveBeenLastCalledWith(260);
});
```

Two-column max: `min(480, 35vw)` = 315 at 900 px; three-column max: `min(480, 35vw, viewport − inspector − 420)` (1100 → min(480, 385, 300) = 300). Fallback 260 above 1024 px, 220 from 701 to 1024 px.

- [ ] **Step 2: Run**; Expected FAIL.
- [ ] **Step 3: Implement**
  - `editor/sidebarWidth.ts`: `storageKey(username)`, `sidebarLimits({ viewport, inspector })` (two-column when `viewport <= 1024`), `clampSidebarWidth(value, limits)`, `readStoredWidth(username)` (positive finite integer or null), `writeStoredWidth(username, value)`, `clearStoredWidth(username)`, and hook `useSidebarWidth(username: string | undefined)` returning `{ width, limits, setWidth, commit, reset }`: initial = clamp(stored ?? fallback); recompute limits on `resize`; `commit` writes after drag end or 300 ms after the last key (debounce); `reset` removes the key and returns to fallback. Never writes during render.
  - `editor/SidebarResizer.tsx`: `role="separator"`, `aria-orientation="vertical"`, `aria-controls`, `aria-label="Resize findings column"`, `aria-valuenow/min/max`, `aria-valuetext="{w} pixels (default {fallback})"`, `tabIndex={0}`. Keys: Left/Right ±16, Shift ±64, Home/End, Enter → `onReset`. Pointer: `setPointerCapture`, compute `startWidth + (clientX − startX)`, apply via `requestAnimationFrame`, Escape restores `startWidth`, pointer up → `onCommit`. `onDoubleClick` → `onReset`. Register `useShortcutHint(["← / →", "Shift + ← / →", "Home / End", "Enter"], "Resize the findings column (focus the divider)", { group: "Layout" })`. Contains `<span className="sidebar-resizer-grip" aria-hidden="true" />`.
  - `editor.css`: introduce `--sidebar-width` on `.app-layout` (default `260px`; `220px` in the 701–1024 px media block) and replace the fixed widths at lines ~63, ~664 (`width: var(--sidebar-width)`) and the grid templates at ~660, ~821, ~852 (`grid-template-columns: var(--sidebar-width) …`). Separator:

```css
.sidebar-resizer { position: relative; flex: none; width: 16px; margin-inline: -8px; cursor: col-resize; z-index: 2; touch-action: none; }
.sidebar-resizer-grip { position: sticky; top: 50%; display: block; width: 4px; height: 32px; margin-inline: auto; border-radius: 2px; background: var(--border-strong); }
.sidebar-resizer:focus-visible { outline: var(--focus-width) solid var(--focus-ring); outline-offset: var(--focus-offset); }
@media (max-width: 700px) { .sidebar-resizer { display: none; } }
@media (forced-colors: active) { .sidebar-resizer-grip { background: CanvasText; } .sidebar-resizer:focus-visible { outline-color: Highlight; } }
```

  Check how `.app-layout` is laid out (flex vs grid at each breakpoint) and place the separator so the grid templates account for it (in grid layouts use `grid-template-columns: var(--sidebar-width) 0 minmax(0, 1fr) …` with the separator in the zero-width column and negative margins, or position it absolutely on the sidebar's right edge). Choose the variant that leaves text-pane geometry unchanged at the default width (F10 verifies). F4a starts only after quick-fixes WP-F (lock 2): keep WP-F's Q7 ring rule and Q8 list rule exactly as they are (F4b removes the Q8 rule later).
- [ ] **Step 4: Run** `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/sidebarResizer.test.tsx tests/caseResize.test.tsx tests/sidebar.test.tsx tests/quickFixStyles.test.ts tests/tokens.test.ts`, typecheck. Expected PASS.

**Done checklist:** limits and persistence per spec; CSS variable used by all three places; separator hidden ≤700 px; forced-colours rules.
**Commit point (later):** `feat(editor): resizable findings column (component and styles)`.

---

## F5a: Carried list parts

**Goal:** Spec section 1 presentation pieces (no state, no wiring).
**May read:** spec section 1, "Keyboard and screen reader summary" (row names); `editor/carried/checkState.ts`, `instructions.ts` (F2); `frontend/src/editor/FindingRow.tsx` (F0, for the class names of rows); `frontend/src/ui/StatusBadge.tsx`, `Kbd.tsx`.

Components (all presentational; props only):
- `CarriedRowExtras({ state, sourceName: string, instruction: string | null, linkedTerms?: string[] })`: badge ("Check needed" `tone="warning"` / "Checked" `success` / "Dismissed" `neutral`), extra line "Changed after your check" (variant `changed`) or "The linked finding was deleted" (`removed`), meta line "Carried from Round 2" or "Linked to carried Seizure (Round 2)" / "Linked to 2 carried findings", instruction line `<p className="carried-instruction">` while unchecked.
- `PlaceholderRow({ state, termLabel: ReactNode, termText: string, instruction, selected, onActivate, linkedTo?: string })`: `<li role="button" tabIndex={0} aria-pressed data-list-key="input:{id}" aria-label="{term}, carried, not on this text, {check needed|checked|dismissed}">` with term, badge, "Not on this text", instruction; dismissed → class `is-muted` and "Dismissed: {first 60 code points of reason}{… if longer}"; linked → muted "Linked to {term}".
- `CarriedProgress({ text, showNext: boolean, onNext })`: `<p role="status">` (with `IconCheck` when all done) and quiet small Button "Next unchecked" with `<Kbd>N</Kbd>`.

- [ ] **Step 1: Failing tests** `frontend/tests/carried/listParts.test.tsx`: badge text per variant; "Changed after your check" line; meta line for carried, linked (1 and 2 inputs); instruction absent when checked; placeholder accessible name exactly "Seizure, carried, not on this text, check needed"; dismissed placeholder shows "Dismissed: " + 60 characters + "…" for a 70-character reason; progress `role="status"` text and "Next unchecked" button only when `showNext`; Enter and Space on the placeholder call `onActivate`.
- [ ] **Step 2: Run** `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/carried/listParts.test.tsx`; FAIL.
- [ ] **Step 3: Implement** the three components and `carried-list.css` (imported by each component): instruction `color: var(--text-muted); font-size: max(12px, var(--size-sm)); overflow-wrap: anywhere;`, `.is-muted { opacity: .75 }` only if contrast stays ≥4.5:1 (otherwise use `color: var(--text-muted)`), list markers none. Placeholder row uses the same `doc-item` class as `FindingRow` for consistent layout.
- [ ] **Step 4: Run** the test and typecheck; PASS.

**Done checklist:** no colour-only state; names per spec; 60-character truncation by code points.
**Commit point (later):** `feat(editor): carried list row parts`.

---

## F5b: Carried inspector parts

**Goal:** Spec sections 2, 3, 4 (visible change per action), "Loading and errors"; Resolved 3 (Undo dismissal) and 5 (read-only list for leads).
**May read:** spec sections 2, 3, 4, "Loading and errors"; F2 files; `frontend/src/ui/InlineConfirm.tsx` (Documents U1: props `title, message, confirmLabel, cancelLabel, tone, busy, onConfirm, onCancel, children, outcome, headingLevel`); `frontend/src/editor/AnnotationPanel.tsx` (`quoteSegments` export); `frontend/src/editor/axisLabels.ts`.

Components (presentational; async callbacks return promises; they own only local UI state like "chooser open", busy and error):

- `CarriedSection(props)`:
  ```ts
  { state: CarriedState; origin: string; recordedAt?: string | null; whatToCheck: { textSpan: string; values: string[]; noteFirstLine?: string; noteFull?: string };
    readOnly: false | "submitted" | "paused" | "older"; onMarkChecked?: () => Promise<void>; onShowOriginal: () => void;
    onNextUnchecked?: () => void; onDismiss?: (reason: string) => Promise<void>; error?: CarriedError | null; onRetry?: () => void;
    noteUnsaved?: boolean; onSaveNoteAndCheck?: () => Promise<void> }
  ```
  `<section aria-labelledby>` with `<h3>Carried finding</h3>`. Unchecked layout: badge, origin line with `<Time>` (`app/Time.tsx`, Documents D1), "What to check" `<dl>` (Text span / Values / Note with "Show full note" disclosure), actions "Mark as checked" (primary, `data-carried-primary`, `loading` while busy) and "Show original evidence" (secondary), hint "Any later change to this finding needs a new check.", and a quiet "Does not apply…" button that opens `InlineConfirm` (title "Dismiss carried finding", message "It is removed from this text and recorded as dismissed with your reason.", required `Textarea` "Why does this finding not apply to this text?" `rows={3}`, confirm "Dismiss"; empty → message "Give a reason to dismiss this finding." and the confirm stays focusable with `aria-disabled`). Variant `changed` adds "You changed this finding after checking it. Check it again." Checked layout: one line `IconCheck` "Checked · {origin}" (`tabIndex={-1}`, `data-carried-collapsed`) with "Show original evidence" and "Next unchecked" when `onNextUnchecked` is set. Read-only: state + origin + "Show original evidence"; `paused` adds "Checks are unavailable while the task is paused." Errors: `stale` → "This finding changed before the check was saved. Check it again."; `network` → "Could not save the check. Nothing changed." + "Retry"; `session` → `SESSION_ENDED_MESSAGE` from `editor/autosave.ts`, no Retry (the queue retries after the new login); `rejected` → the mapped server message (`admin/errors.ts`), no Retry; `note` → "Save the note first." + "Save note and mark as checked". Export `type CarriedError = { kind: "stale" | "network" | "session" | "rejected" | "note"; message?: string }` from `CarriedSection.tsx` (F6a imports it). While an error is shown the section is not busy: "Mark as checked" is enabled again unless `kind` is `network` or `session` (the original write is still queued; "Retry" is the only write action).
- `ExceptionPanel(props)`:
  ```ts
  { state: CarriedState; origin: string; reason: string; original: { term: ReactNode; values: { label: string; value: string }[]; note?: string; quote: string | null };
    candidates: { annotationId: string; version: string; label: string; technicalId: string }[];
    readOnly: false | "submitted" | "paused" | "older"; onMarkInText?: () => void; onLink?: (annotationId: string) => Promise<void>;
    onDismiss?: (reason: string) => Promise<void>; onUndoDismissal?: () => Promise<void>; onShowOriginal: () => void; error?: CarriedError | null }
  ```
  Order: badge + origin; reason; original (term, values "Assertion: Present", note, quote in quotation marks or "No text span"); actions "Mark in text" (primary, `data-carried-primary`), "Link to an existing finding…" (secondary, opens an inline `<fieldset>` radio group; each option label "Seizure · “Krampfanfälle werden …”" / "Seizure · no text span" with a "Technical details" `<details>` holding the ID; confirm "Link and mark as checked", "Cancel" returns focus to the trigger; empty → "No finding of this type exists on this text. Mark it in the text first." and no confirm), "Dismiss with reason…" (quiet, `data-carried-dismiss`, `InlineConfirm` as above). Dismissed state: reason, "Dismissed by You", "Undo dismissal" (secondary; `onUndoDismissal`) and "Link to an existing finding…".
- `CarriedChecksReadOnly({ items: { term: ReactNode; state: "checked" | "dismissed" | "needed"; reason?: string; origin: string }[] })`: `<section aria-labelledby><h3>Carried findings</h3><ul>` one item per input: term, badge, origin, "Dismissal reason: …". Used by F8b (historical dialog) and F9 (case viewer).

- [ ] **Step 1: Failing tests** `frontend/tests/carried/inspectorParts.test.tsx`:
  - unchecked section: heading "Carried finding", first Tab stop inside the section is "Mark as checked"; `<dl>` terms "Text span", "Values", "Note"; hint text.
  - after `onMarkChecked` resolves and the parent re-renders with variant `checked`: collapsed line has focus (`document.activeElement` has `data-carried-collapsed`) — the component focuses it in an effect when the variant changes from unchecked to checked.
  - busy: "Mark as checked" has `aria-disabled="true"` and keeps focus; "Show original evidence" stays enabled; dismiss trigger `aria-disabled`.
  - errors: stale, network (+ Retry calls `onRetry`; "Mark as checked" stays `aria-disabled`), session (message, no Retry), rejected (mapped message), note (+ "Save note and mark as checked").
  - read-only paused: no "Mark as checked"; sentence shown.
  - exception: link chooser radio labels, empty case text and no confirm, Cancel returns focus to "Link to an existing finding…", confirm calls `onLink("own")`.
  - dismiss: activation without reason shows "Give a reason to dismiss this finding." and does not call `onDismiss`; with reason calls `onDismiss("Not here")`; Escape cancels and returns focus to the trigger.
  - dismissed state shows "Undo dismissal" and calls `onUndoDismissal`; "Dismiss with reason…" carries `data-carried-dismiss`.
  - `CarriedChecksReadOnly` lists badge text and "Dismissal reason: Not here".
- [ ] **Step 2: Run** `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/carried/inspectorParts.test.tsx`; FAIL.
- [ ] **Step 3: Implement** the three components and `carried-inspector.css` (section spacing, `.carried-collapsed` line, radio list with 24 px targets).
- [ ] **Step 4: Run** the test, `tests/carried` folder, typecheck; PASS.

**Done checklist:** only "Mark as checked" and "Show original evidence" as main actions (plus the quiet "Does not apply…"); radio group not select; `InlineConfirm` for dismissal; focus rules; no colour-only state.
**Commit point (later):** `feat(editor): carried inspector section and exception path`.

---

## F6a: `useCarriedReview` hook

**Goal:** All carried-review state and writes in one hook with an explicit interface, tested without `CaseScreen`. Handles the mutation queue's real failure semantics: transport errors, 5xx and ended sessions leave the queued operation **pending** (`frontend/src/editor/autosave.ts:110-130`), so the hook must not wait for a rejection to show an error.
**May read:** spec sections 2–4, "Loading and errors"; `frontend/src/editor/autosave.ts` (whole: `MutationQueue`, `QueueState`, `retry`, `getLastError`, `SESSION_ENDED_MESSAGE`); `frontend/src/app/CaseScreen.tsx` ~359-370 (queue creation, `setQueueError`), ~765-780 (retry after login), ~884-930 (`resolveCarriedInput`: payload, `mutation_id` handling); `frontend/src/api/client.ts` (`ApiError`, `isSessionProblem`, `RoundInputView`, `Draft`); F2 files; `CarriedError` in `editor/carried/CarriedSection.tsx` (F5b).

Interface (new `editor/carried/useCarriedReview.ts`):

```ts
export function useCarriedReview(args: {
  inputs: readonly RoundInputView[]; draft: Draft; workspaceId: string; readOnly: boolean;
  queue: Pick<MutationQueue, "enqueue" | "retry" | "getLastError">;   // CaseScreen's queueRef.current
  queueState: QueueState;                                             // CaseScreen's existing queue state (re-renders on change)
  flushNotes: () => Promise<void>; hasUnsavedNotes: () => boolean; onDraft: (draft: Draft) => void;
  announce: (message: string) => void; termText: (snapshot: SnapshotLike) => string;
}): {
  states: CarriedState[]; byHome: Map<string, CarriedState[]>; placeholders: CarriedState[]; openKeys: Set<string>; progress: string;
  recreatedFor: Record<string, string>;                         // inputId -> new annotationId (plan decision 1)
  busy(inputId: string): boolean;
  markChecked(state: CarriedState, annotationId?: string): Promise<void>;
  link(state: CarriedState, annotationId: string): Promise<void>;
  dismiss(state: CarriedState, reason: string): Promise<void>;  // sends remove_carried_finding: true only when state.carriedId
  undoDismissal(state: CarriedState): Promise<void>;           // api.clearRoundInputResolution; server restores the removed finding
  rememberRecreated(inputId: string, annotationId: string): void;
  errorFor(inputId: string): CarriedError | null;
  retry(inputId: string): void;                                // queue.retry(); never enqueues a second operation
}
```

Write rules:
- Each write: `await flushNotes()`; unsaved note → error `note`, nothing sent. Generate one `mutation_id` per user action **inside** the enqueued closure's captured scope, so the queue's retry resends the identical envelope (same `mutation_id`, same payload); a lost response is then answered by the server's receipt replay.
- While the write is queued, `busy(inputId)` is true. When `queueState` becomes `"error"` while a write for that input is pending, `busy` becomes false and `errorFor` returns `session` if `isSessionProblem(queue.getLastError())`, else `network`. `retry(inputId)` calls `queue.retry()` only. When the pending promise later resolves, the error clears, `onDraft` receives the draft and the normal announcement follows.
- Rejections: `ApiError.code === "ROUND_INPUT_RESOLUTION_STALE"` → `stale`; other 4xx → `rejected` with the mapped message; `ConflictError` → rethrown to CaseScreen's existing conflict handling; `DiscardedChangesError` → clear busy silently.
- Announcements (one polite live region via `announce`): "{term} checked. {progress}.", "{term} dismissed. {progress}.", "{term} restored. {progress}." (undo that restored a finding), "{term} needs a new check. {progress}." when a previously checked state becomes unchecked after an edit (compare previous `states` by input id in an effect).

- [ ] **Step 1: Failing tests** `frontend/tests/carried/useCarriedReview.test.tsx` with `renderHook` and a fake queue (an object implementing `enqueue`/`retry`/`getLastError` whose operations the test resolves, rejects or leaves pending, plus a `queueState` the test re-renders with) and a mocked `api`:
  1. `markChecked` sends `{ input_id, outcome: "completed", annotation_ref: { annotation_id, version } }` once; `busy` true until resolved; announcement "Seizure checked. All carried findings checked.".
  2. Network failure: the operation stays pending and `queueState` becomes `"error"` with a `TypeError` last error → `errorFor` is `network`, `busy` false; `retry` calls `queue.retry` once and `enqueue` was called exactly once in total.
  3. Lost response: the first attempt throws after the server applied it; after `retry` the replay resolves → the envelope sent in both attempts has the same `mutation_id`; error cleared; draft applied.
  4. 401: last error is an `ApiError` with status 401 → `session`; no Retry needed (`retry` still only calls `queue.retry`).
  5. Recovery: `queueState` back to `"saved"` and the operation resolves → `errorFor` null, announcement made.
  6. Stale: rejected `ApiError` with code `ROUND_INPUT_RESOLUTION_STALE` → `stale`. Other 4xx → `rejected`.
  7. Unsaved note: `hasUnsavedNotes()` true after `flushNotes` → `note`, nothing enqueued.
  8. `dismiss` with `carriedId` sends `remove_carried_finding: true`; without `carriedId` it does not send the key. `undoDismissal` sends `{ command: "clear_round_input_resolution", input_id }` through `api.clearRoundInputResolution`; when the returned draft contains the carried finding again, the announcement is "Seizure restored. 0 of 1 checked.".
- [ ] **Step 2: Run** `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/carried/useCarriedReview.test.tsx`; FAIL.
- [ ] **Step 3: Implement** the hook as specified. No JSX; no import from `app/`.
- [ ] **Step 4: Run** the test file, `tests/carried`, typecheck; PASS.

**Done checklist:** no pending-forever busy state; retry never duplicates an operation; same `mutation_id` across retries; session vs network distinguished; interface exactly as above (F6b/F6c depend on it).
**Commit point (later):** `feat(editor): carried review hook with queue-aware errors`.

---

## F6b: List and selection wiring in the editor

**Goal:** One findings list with carried rows and placeholders, progress line, `N`/`Shift+N`, live announcements, toolbar badge; remove `RoundInputPanel`.
**May read:** spec section 1, "Keyboard and screen reader summary", "Narrow viewports" (first two bullets); `frontend/src/app/CaseScreen.tsx` around: `carriedInputs` (~249), `resolveCarriedInput` (~884), sidebar list (~2300-2372), mode badge (~2044), shortcuts (~1936-1981), live region (search `role="status"` / `announce`), selection setters (search `setSelectedAnnotationId(`); F2, F5a, F6a files; `frontend/tests/carriedPanelLegacy.test.tsx` (F0) for the render setup.

- [ ] **Step 1: Failing tests** `frontend/tests/carried/carriedList.test.tsx` (render `CaseScreen` like `carriedPanelLegacy.test.tsx`, mocking `api`):
  1. One list: no "Review carried findings" region; header "Findings (1)"; progress "0 of 1 checked"; the carried row shows "Check needed", "Carried from Round 2" and an instruction line.
  2. Placeholder rows (mapping failed, and carried finding deleted) appear before the findings in input order with the accessible name "Seizure, carried, not on this text, check needed".
  3. Keys: `N` selects the next unchecked row (wraps), `Shift+N` the previous; neither fires while typing in a textarea; `?` help lists "Next unchecked carried finding" and "Previous unchecked carried finding".
  4. Selecting a row or placeholder via click, `N` or `selectListKey` clears every other selection; the row scrolls with `scrollIntoView({ block: "nearest" })` (stub it in jsdom).
  5. After an edit makes a checked input unchecked, the live region reads "Seizure needs a new check. 0 of 1 checked.".
  6. Toolbar badge reads "Round 3 · continued from Round 2" with the full identity in `title` (props `roundBadge`/`roundTitle` supplied by the test; F8b supplies them from TaskEditor); without them it reads "Review carried findings".
- [ ] **Step 2: Run** `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/carried/carriedList.test.tsx`; FAIL.
- [ ] **Step 3: Implement**
  - CaseScreen: call `useCarriedReview` (pass `queueRef.current`, the existing queue-state value, `flushNotes`, `announce`); replace `carriedInputs`/`pendingCarriedCount`/`resolveCarriedInput` (`pendingCarriedCount = states.filter(s => s.unchecked).length` stays available for the submit dialog until F7). Remove the `RoundInputPanel` mount and import; delete `frontend/src/tasks/RoundInputPanel.tsx` and `frontend/tests/carriedPanelLegacy.test.tsx` (its cases are replaced by `carriedList.test.tsx` here and `carriedInspector.test.tsx` in F6c). Do not touch `editor.css` (F4b removes the dead `.round-input-panel*` rules).
  - Sidebar header: "Findings ({n})" (rename "Saved findings"); in carry-forward rounds a second header line with `CarriedProgress`. Render placeholders (input order) before the findings; pass `CarriedRowExtras` as `children` of `FindingRow` for rows in `byHome`.
  - Selection model: add `selectedInputId` and one `selectListKey(key: string | null)` helper that clears all other selections and is used by rows, `N` and (in F7) Go to. Scroll with `scrollIntoView({ block: "nearest" })`. Narrow screens follow the existing `setMobilePane("details")` calls.
  - Inspector for a selected `input:{id}`: render only a minimal placeholder heading for now (F6c mounts `ExceptionPanel`).
  - Shortcuts: `useShortcut("n", e => goNext(e.shiftKey ? -1 : 1), { enabled: carriedActive, group: "Carried findings", description: "Next unchecked carried finding" })` plus `useShortcutHint(["Shift + N"], "Previous unchecked carried finding", { group: "Carried findings" })`. Single-character bindings ignore Shift in `matches()`, so the handler reads `event.shiftKey`. Check no existing `"n"` binding (`grep -rn 'useShortcut(\["\?n"' frontend/src`).
  - Toolbar badge: new optional props `roundBadge?: string; roundTitle?: string` on `CaseScreenProps`; in carry-forward rounds the mode badge shows `roundBadge ?? "Review carried findings"` with `title={roundTitle}`.
- [ ] **Step 4: Run** `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/carried tests/caseScreen.test.tsx tests/sidebar.test.tsx tests/reanchorIntegration.test.tsx tests/workRoundActions.test.tsx`, then the full suite and typecheck. Update assertions on "Saved findings" to "Findings" in `caseScreen.test.tsx` and `sidebar.test.tsx` (assertion text only). Expected PASS.

**Done checklist:** panel and legacy test gone; rows never move on state change; `selectListKey` is the single selection entry point; keys and help entries; announcements; full suite green.
**Commit point (later):** `feat(editor): carried findings in the findings list`.

---

## F6c: Inspector wiring: section, exception path, recreation, delete, `C`

**Goal:** Carried section and exception panel in the inspector; atomic dismiss; undo dismissal (server restores the finding, user decision 1); Mark in text; link; carried-aware delete confirmation; `C`.
**May read:** spec sections 2–4; `frontend/src/app/CaseScreen.tsx` around: pending annotation / re-anchor attach mode (~1095-1230, `activeReanchor`, `pendingAnnotation`), `handleDeleteAnnotation` (~1446), inspector top (~2408-2420, the `ProposalSource` slot); `frontend/src/editor/AnnotationPanel.tsx:395-410` (delete confirmation text); F5b, F6a files; F6b's `selectListKey`.

- [ ] **Step 1: Failing tests** `frontend/tests/carried/carriedInspector.test.tsx` (same render setup as `carriedList.test.tsx`):
  1. Selecting the carried row shows the "Carried finding" section above the term heading; "Mark as checked" sends the completed resolution with the current version; afterwards the row says "Checked", progress "All carried findings checked", focus on the collapsed line, live region "Seizure checked. All carried findings checked.".
  2. Editing the note after the check turns the row back to "Check needed" with "Changed after your check".
  3. "Does not apply…" with reason sends `{ input_id, outcome: "dismissed", reason, remove_carried_finding: true }`; the row becomes a muted placeholder "Dismissed: …"; "Undo dismissal" calls `clearRoundInputResolution` with `{ command: "clear_round_input_resolution", input_id }`; the mocked response contains the carried finding again → the carried row is back with "Check needed", it is selected and "Mark as checked" has focus.
  4. Deleting the carried finding: the confirmation contains "Delete this annotation and all its mentions? This is a carried finding. After deleting it, you must link another finding or dismiss it with a reason."; an ordinary finding's confirmation is unchanged ("Delete this annotation and all its mentions?"). After deletion the placeholder row is selected and `[data-carried-dismiss]` focused; dismissing sends **no** `remove_carried_finding`; "Undo dismissal" then only clears the resolution (mock returns no carried finding) and the placeholder shows "Check needed".
  5. Placeholder (mapping failed): "Mark in text" starts attach mode with message "Select supporting text to re-create Seizure."; after saving the new finding the placeholder links it (state remains "Check needed", the section shows on the new finding) and no resolution request was sent.
  6. Link chooser on a placeholder sends the completed resolution naming the chosen finding.
  7. `C` marks the selected unchecked carried finding as checked; it does not fire in a textarea or in read-only rounds; `?` help lists "Mark carried finding as checked".
  8. Read-only round (submitted): section without "Mark as checked"; paused adds the paused sentence.
  9. Network error while checking: "Could not save the check. Nothing changed." with "Retry"; activating Retry calls the queue's retry (no second resolution request in the mock until the queue resends).
  10. Stale error: "This finding changed before the check was saved. Check it again."
- [ ] **Step 2: Run** `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/carried/carriedInspector.test.tsx`; FAIL.
- [ ] **Step 3: Implement**
  - Inspector: when the selected list key is `input:{id}` render only `ExceptionPanel` (no editable inspector); when the selected annotation is a home of a carried state render `CarriedSection` at the top of the annotation detail pane (the slot where `ProposalSource` sits for proposals). Wire callbacks to the hook; `onRetry` → `retry(inputId)`.
  - Undo: after `undoDismissal` resolves, if `states` now has a `carriedId` for the input, `selectListKey("annotation:" + carriedId)` and focus `[data-carried-primary]`; otherwise keep the placeholder selected.
  - Mark in text: add `carriedInput?: CarriedInputLike` to the pending-annotation shape next to `reanchorItem`; "Mark in text" sets attach mode with that input (layer/type/term from `source_snapshot`), attach message "Select supporting text to re-create {term}."; saving uses the normal `create_annotation` command with a **new** annotation id, `term_id`, `layer_id`, `type_id`, `axes_values` from the source and `chosen_axis_ids: []` (values stay unconfirmed), then `rememberRecreated(input_id, newId)`; never sends a resolution and never reuses the carried annotation id (B2 refuses submission otherwise).
  - Delete: `AnnotationPanel` gains one optional prop `deleteConfirmMessage?: string` (default: today's "Delete this annotation and all its mentions?"); CaseScreen passes today's text plus " This is a carried finding. After deleting it, you must link another finding or dismiss it with a reason." when the finding is a carried home. After deletion select `input:{id}` and focus `[data-carried-dismiss]` (set by F5b; if missing, add it in `ExceptionPanel.tsx`, the only edit F6c makes there).
  - Shortcut: `useShortcut("c", markSelected, { enabled: carriedActive && !readOnly && selectedIsUncheckedCarried, group: "Carried findings", description: "Mark carried finding as checked" })`. Check no existing `"c"` binding.
- [ ] **Step 4: Run** `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/carried tests/caseScreen.test.tsx tests/sidebar.test.tsx tests/reanchorIntegration.test.tsx tests/annotationPanel.test.tsx` (skip a file that does not exist), then the full suite and typecheck. Expected PASS.

**Done checklist:** no auto-complete anywhere; atomic dismiss flag only when the carried finding exists; undo restores and refocuses; delete text only for carried homes; `AnnotationPanel` change limited to the optional prop; keys and help entries; full suite green.
**Commit point (later):** `feat(editor): carried finding inspector, exception path and undo`.

---

## F7: Submit dialog items, Go to, toolbar count

**Goal:** Spec section 5 (including "Every problem … directly reachable" and "Way back to submitting").
**May read:** spec section 5; `editor/SubmitCaseDialog.tsx`, `editor/SubmitControl.tsx` (F0); CaseScreen `submissionIssues` (~1694), `defaulted`/`reviewDefaulted` (~1712), `reviewEvidenceIssue` (~1740), `reviewPendingReanchor` (~1750), axis warning (`axisWarning`), `openReviewTargets`, `handleSubmitWorkspace` (~1795), `selectListKey` (F6b); `frontend/src/editor/AnnotationPanel.tsx:235-260` (axis fieldsets and `Select` ids); `frontend/src/editor/TextPane.tsx:175-195` and `frontend/src/spans/adapter.ts:39-60, 170-180` (`SpanEditorHandle`; `setSelected` only highlights, it does not scroll).

`editor/openItems.ts` (pure):

```ts
export type OpenItemKind = "carried" | "evidence" | "reanchor" | "unconfirmed-values" | "review-target" | "defaulted";
export interface OpenItem { key: string; kind: OpenItemKind; blocking: boolean; term: string; line: string; listKey: string | null; focus: string;
  axisId?: string;        // unconfirmed/defaulted: the axis to focus
  evidenceId?: string;    // first evidence of the finding (or the evidence named by the issue): the mark to scroll to
}
export function collectOpenItems(input: {
  carried: { state: CarriedState; term: string; instruction: string }[];
  evidence: { annotationId: string; term: string; reason: string; remedy: string; focus: string; targetKey?: string }[];
  reanchor: { key: string; term: string }[];
  unconfirmed: { annotationId: string; term: string; axisId: string; axisLabel: string; evidenceId?: string }[];   // axis warning entries, first unspecified axis per finding
  openTargets: { key: string; term: string }[];
  defaulted: { annotationId: string; term: string; axisId: string; targetKey?: string; evidenceId?: string }[];
}): OpenItem[]
export function summaryLine(items: readonly OpenItem[]): string   // "1 carried finding still needs a check" etc.
export function submitBlockedReason(items: readonly OpenItem[]): string | null // "Check 1 carried finding before submitting." / first blocking kind's sentence
```

Order: carried (input order), evidence issues, re-anchor, open review targets, unconfirmed values, defaulted (warnings last). Focus targets: carried → `[data-carried-primary]`; evidence → existing `focus` selector; unconfirmed/defaulted → the first **enabled** control inside `[data-axis-field="{axisId}"]` (the checked radio, else the first enabled radio, else the `Select`); F7 adds `data-axis-field={axis.id}` to the axis `<fieldset>` in `AnnotationPanel` (its only edit there); re-anchor → the re-anchor row button; review target → `[data-repair="edit-proposal"]` or the decision buttons.

- [ ] **Step 1: Failing tests** `frontend/tests/openItems.test.ts` (ordering, summary sentences: "1 carried finding still needs a check", "2 carried findings still need a check"; blocked reason "Check 1 carried finding before submitting."; warnings not blocking) and `frontend/tests/submitDialog.test.tsx` (render CaseScreen with one unchecked carried finding and one finding with an unconfirmed value):
  - the dialog lists one line per item with a "Go to Seizure" button; "Go to first unchecked" above the list; more than five items → "and 3 more".
  - "Go to Seizure" closes the dialog, selects the row (Details pane on narrow: `mobile-pane-details` class), scrolls the text to its mark if any (the span handle's `scrollToEvidence` is called with the item's `evidenceId`) and focuses "Mark as checked"; for the unconfirmed value of a finding with two axes where the **second** axis is unspecified, it focuses that second axis's control (not the first axis); a finding without evidence does not call `scrollToEvidence`.
  - "Submit case" is not natively disabled: `aria-disabled="true"`, `aria-describedby` → element with "Check 1 carried finding before submitting."; activating it announces that sentence and does not submit. The other blocking conditions (text not confirmed, evidence issues, re-anchor, open targets, unacknowledged axis warning) use the same pattern with their own sentence.
  - Submit and Cancel are in the dialog footer (`.modal-actions`).
  - Whenever open items exist, also before the dialog was ever opened (user decision 2), the toolbar button reads "Finish & Submit · 2 open" and "Next open item" appears; activating "Next open item" behaves like "Go to" for the next open item after the current selection; when everything is resolved the count and link disappear; reopening the dialog shows the current state.
  - `frontend/tests/spanScroll.test.ts` (new): `scrollToEvidence(id)` calls `scrollIntoView({ block: "center" })` on the mark element of that evidence and does nothing for an unknown id.
- [ ] **Step 2: Run** `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/openItems.test.ts tests/submitDialog.test.tsx tests/spanScroll.test.ts`; FAIL.
- [ ] **Step 3: Implement** `openItems.ts`; rewrite the body of `SubmitCaseDialog` to render items from `collectOpenItems` (replace the generic "Review these findings"/"Review carried findings"/"Review defaulted annotations"/"Review pending findings after text correction" buttons with per-item Go to links), put actions in `footer`, use `aria-disabled` + `aria-describedby` on Submit (keep `loading` while saving). `SubmitControl` gets `{ openCount: number | null; onNextOpen?: () => void }`: label "Finish & Submit · {n} open" when `openCount` > 0, and a quiet `Button` "Next open item". Scrolling: add `scrollToEvidence(evidenceId: string): void` to `SpanEditorHandle` in `spans/adapter.ts` (find the mark element the vendor editor renders for that evidence id, then `scrollIntoView({ block: "center" })`; read the vendor DOM to pick the selector) and expose it from `TextPane` (an imperative ref method or a `scrollRequest: { evidenceId, nonce }` prop; choose the one that fits `TextPane`'s existing ref pattern). These are F7's only edits in `adapter.ts` and `TextPane.tsx`. In CaseScreen: `goToItem(item)` = close dialog → `selectListKey(item.listKey)` → `setMobilePane("details")` → `setSelectedEvidenceId(item.evidenceId)` (highlight) and, after paint, `scrollToEvidence(item.evidenceId)` when set → focus `item.focus` (resolved with `item.axisId` for axis items) inside the inspector (reuse the `repairFocus` effect). The toolbar count is derived from `collectOpenItems` on every render: `openCount = items.length`, shown whenever it is greater than 0 (user decision 2; no "dialog was opened" state).
- [ ] **Step 4: Run** `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/openItems.test.ts tests/submitDialog.test.tsx tests/spanScroll.test.ts tests/caseScreen.test.tsx tests/carried`, then the full suite and typecheck. Expected PASS (update tests that asserted `toBeDisabled()` on "Submit case" to `aria-disabled="true"`, and tests that expect the plain "Finish & Submit Case" label while open items exist; assertion text only).

**Done checklist:** every listed item has its own Go to; exact focus targets (axis by `axisId`); explicit scroll to the mark; Submit focusable with reason; footer actions; toolbar count + Next open item whenever items are open; `AnnotationPanel`, `adapter.ts`, `TextPane.tsx` changes limited to the named additions.
**Commit point (later):** `feat(editor): submit dialog links every open item and toolbar shows remaining items`.

---

## F8a: Work rounds dialog and original evidence dialog

**Goal:** Spec sections 6 and 7 (Work rounds dialog); builds on quick-fixes WP-B's footer Close for these two dialogs.
**Lock:** starts after quick-fixes WP-B (lock 3), Documents U1, U2, D1, and after F0 (test split) and F1.
**May read:** spec sections 6, 7 ("Identity line", "Work rounds dialog"), "Narrow viewports" (cards); `frontend/src/tasks/WorkRoundsDialog.tsx`, `WorkRoundActions.tsx`, `RoundInputEvidenceDialog.tsx`; callers `frontend/src/tasks/TaskEditor.tsx:160` and `frontend/src/app/CaseScreen.tsx` (`<RoundInputEvidenceDialog`, ~2592) (read only); `frontend/src/ui/DataTable.tsx` (column API); `frontend/src/editor/rounds/roundLabels.ts` (F2); `frontend/tests/workRoundActions.test.tsx` (after F0 it holds only round-dialog cases); `frontend/tests/dialogFooters.test.tsx` (quick-fixes WP-B).

- [ ] **Step 1: Failing tests** `frontend/tests/workRoundsDialog.test.tsx`:
  - title "Work rounds · {text ID} · {language}"; intro sentence exact.
  - table columns Round / Round state / Submission / Carried / Actions; Round 1 row "Replaced by Round 3" and "Submitted 19 Oct, 00:16" together; current round has "You are here" with `aria-current="true"` and no action; other rows "Open Round 2" buttons call `onOpen`.
  - "Technical details" disclosure under the table holds round and submission IDs.
  - Start new round available: radio group "Continue from" with option "Round 2 submission · 19 Oct, 00:57 · de v1 · 1 finding"; consequence sentence; footer primary "Continue from this submission" sends the same `CreateRoundRequest` as today (idempotent `request_id` per identity, `expected_workflow_revision`).
  - Unavailable reasons: editable active round, paused, no submission (exact texts from F2).
  - "Start empty round" only for an untouched open task (existing rule).
  - Footer: primary (when available) and "Close"; header close present.
  - load failure: error + "Retry" in the dialog; empty source list for an unknown reason (sources empty but no reason applies) → "No submission can be continued right now." + "Reload task state".
  - at ≤700 px (`useMediaQuery` mocked) one card per round (`<dl>` label/value pairs).
  - `RoundInputEvidenceDialog`: title "Original finding from Round 2"; first line "Submitted 19 Oct, 00:57 · de v1 · ann-0004"; facts with axis labels ("Assertion: Present"); spanless → "This finding had no text span in Round 2." and text collapsed under "Show Round 2 text"; hash mismatch → facts + technical details still shown with the error in place of the text; Close in footer ("Close original evidence") and header.
  - Without the new optional props (as rendered by today's callers) both dialogs still render: title "Work rounds" and "Original finding from an earlier round".
  Rewrite the existing round-dialog cases in `workRoundActions.test.tsx` to the new labels (radio instead of combobox; "Continue from this submission" instead of "Start carry-forward round"). Keep the two `dialogFooters.test.tsx` cases for these dialogs passing; update only their query or label text if the rewrite changes it ("Close original evidence" and footer "Close" stay).
- [ ] **Step 2: Run** `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/workRoundsDialog.test.tsx tests/workRoundActions.test.tsx tests/dialogFooters.test.tsx`; FAIL.
- [ ] **Step 3: Implement**: `WorkRoundsDialog` props add **optional** `documentLabel?: { textId: string; language: string }` (title falls back to "Work rounds") and `currentRoundId?: string`; F8a does not own the callers, so every new prop is optional and today's call sites keep compiling; F8b passes them; data load unchanged (enriched by B1). `WorkRoundActions` renders `DataTable` (rows oldest first) or cards, the "Start a new round" section, and returns the primary action for the footer (lift `start()` into `WorkRoundsDialog` or render the footer via a render prop). `RoundInputEvidenceDialog` gets **optional** `sourceName?: string` (title falls back to "Original finding from an earlier round"), uses `source_recorded_at`, `source_language`, `source_version`, `source_snapshot.annotation.annotator_id` (or the pseudonym field of the snapshot; check `AnnotationSnapshot`) and `footer`. CSS in new `tasks/workRounds.css` (imported by `WorkRoundActions.tsx`). Do not touch `editor.css` (F4b removes the dead Q8 rule). Remove the local `kindLabels` in `WorkRoundActions.tsx` (not the shared one in `app/submissionLabels.ts`) and every display of raw `state` / "Historical round".
- [ ] **Step 4: Run** the three files from Step 2, `tests/workRoundActions.test.tsx`, and `npm --prefix frontend run typecheck` (must pass with the unchanged callers); PASS.

**Done checklist:** no "superseded", "carry-forward", "Historical round", ISO times or IDs outside "Technical details"; Close in footer and header; reasons derived from data; new props optional, callers untouched, typecheck green.
**Commit point (later):** `feat(tasks): plain round names in Work rounds and original evidence`.

---

## F8b: My submissions, historical dialog, toolbar identity

**Goal:** Spec section 7 "My submissions", identity line in the toolbar title, carried states in the historical dialog (Resolved 5 for the owner side); pass F8a's new optional props from their callers.
**May read:** spec section 7; `frontend/src/tasks/TaskEditor.tsx:50-170` (incl. the `<WorkRoundsDialog` call ~160); `editor/HistoricalSubmissionDialog.tsx` (F0); CaseScreen "Submission history" section (~2375), historical dialog mount (~2593), "View submitted result" (~2643), `<RoundInputEvidenceDialog` (~2592); `src/ontocurator/api/submission_history_routes.py:30-45` (`SubmissionHistoryDetail` shape) and the `Submission` type in `api/client.ts` (the two shapes differ); `editor/rounds/roundLabels.ts`; `editor/carried/CarriedChecksReadOnly.tsx`, `editor/carried/checkState.ts`; `api.listAssignmentSubmissions`, `api.getSubmissionHistory` (B3/B4); `frontend/src/documents/SubmissionsTable.tsx` (DX, if present).

The historical dialog has three entry points with two data shapes: (1) "View" in My submissions → `SubmissionHistoryDetail` (B3); (2) the retained non-assignment "Submission history" list and (3) "View submitted result" in "Case submitted" → raw `Submission` objects. One presentation model covers both:

```ts
// editor/historicalSubmission.ts
export interface HistoricalSubmissionView {
  submissionId: string; heading: string; documentId: string;
  annotations: AnnotationSnapshot[]; evidence: EvidenceSnapshot[]; decisions: ReviewDecision[];
  carried: { items: CarriedChecksReadOnlyItem[] } | null;   // null when the submission has no round inputs
}
export function fromSubmission(submission: Submission, heading: string): HistoricalSubmissionView;            // carried: null
export function fromHistoryDetail(detail: SubmissionHistoryDetail, heading: string, termText: (s: SnapshotLike) => string): HistoricalSubmissionView; // carried from round_inputs + round_input_resolutions via deriveCarriedStates
```

- [ ] **Step 1: Failing tests**
  - `frontend/tests/historicalSubmission.test.tsx`: both adapters on fixtures of each shape (annotations, evidence, decisions mapped; `carried` null for `Submission`; for a carry-forward detail one "Dismissed" item with its reason); the dialog renders a `HistoricalSubmissionView` with heading, footer "Close" and header close.
  - `frontend/tests/mySubmissions.test.tsx`:
    - heading "My submissions"; items oldest first "Round 1 · 19 Oct, 00:16 · 1 finding" each with a "View" button named "View Round 1 submission"; current round without submission adds muted "Round 3 · not submitted yet"; load error → message + "Retry".
    - Entry point 1: "View" opens the dialog with heading "Round 1 · 19 Oct, 00:16"; for a carry-forward submission it lists carried findings read-only with "Dismissed" and "Dismissal reason: …".
    - Entry point 2: a CaseScreen without `versionContext.assignmentId` still shows the "Submission history" list; its buttons open the dialog with the existing heading and content (raw `Submission`).
    - Entry point 3: "View submitted result" after a submission opens the dialog for the just-submitted `Submission`.
    - TaskEditor passes `roundBadge` "Round 3 · continued from Round 2" and `roundTitle` = full identity line to CaseScreen, and `documentLabel` to `WorkRoundsDialog` (title "Work rounds · {text ID} · {language}"); CaseScreen passes `sourceName` to `RoundInputEvidenceDialog` (title "Original finding from Round 2") (render TaskEditor with mocked `api.listWorkRounds` returning enriched rounds).
- [ ] **Step 2: Run** `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/historicalSubmission.test.tsx tests/mySubmissions.test.tsx`; FAIL.
- [ ] **Step 3: Implement**
  - `editor/historicalSubmission.ts` as above; `HistoricalSubmissionDialog` takes `{ view: HistoricalSubmissionView; documentText: string; termLabel; onClose }`, renders `CarriedChecksReadOnly` when `view.carried`, `footer` Close. For a submission on another text version, fetch that text with `api.getVariantText(project, document_id)` for quotes.
  - `editor/MySubmissions.tsx` (`{ assignmentId: number; currentRound?: { ordinal: number; submitted: boolean }; documentText; termLabel; projectKey }`): loads `listAssignmentSubmissions`; "View" loads `getSubmissionHistory(project, document_id, submission_id)` and opens the dialog with `fromHistoryDetail`. Render a `<ul>`. Reuse Documents DX's `SubmissionsTable` only if its props accept these rows without a second data model (`showFinalColumn={false}`, `viewRoute={() => null}`, `actions={row => <View button>}`); otherwise keep the `<ul>`; never create a second table component.
  - CaseScreen: replace the "Submission history" section by `<MySubmissions …/>` when `versionContext?.assignmentId` is set; keep the old list for non-assignment editors and adapt both remaining entry points with `fromSubmission`. Pass `sourceName` (from `roundName(input.source_round_ordinal)`) to `RoundInputEvidenceDialog`.
  - TaskEditor: compute `roundBadge` = `Round {n} · continued from Round {s}` and `roundTitle` = `roundIdentity(roundInfo, …)` from the enriched `rounds` it already loads; pass `documentLabel` and `currentRoundId` to `WorkRoundsDialog`.
- [ ] **Step 4: Run** the two test files, `tests/assignmentEditor.test.tsx`, `tests/caseScreen.test.tsx`, `tests/workRoundsDialog.test.tsx`, then the full suite and typecheck; PASS.

**Done checklist:** submissions across rounds visible in a new round; no "No previous submissions yet" when earlier rounds exist; all three dialog entry points tested and working with their own data shape; dialog heading uses the label; carried states read-only; F8a's props wired.
**Commit point (later):** `feat(editor): my submissions across rounds and round identity in the toolbar`.

---

## F4b: Mount the resizer; mobile tab label; remove dead Q8 CSS

**Goal:** Wire F4a into the layout; "List" tab becomes "Findings" / "Findings, 1 to check"; remove the CSS for the carried panel and round list that F6b and F8a replaced.
**Lock:** after F8b (CaseScreen sequence), F4a, F6b, F8a and quick-fixes WP-F (lock 4).
**May read:** CaseScreen `mobile-pane-tabs` (~2150), `app-layout` element (~2157), `<aside className="sidebar"`; F4a files; `versionContext.username` (or the current user prop used for the storage key); `frontend/src/styles/screens/editor.css` (search `.round-input-panel`, `.work-round-actions`); `frontend/tests/quickFixStyles.test.ts`.

- [ ] **Step 1: Failing tests** in a new `frontend/tests/sidebarLayout.test.tsx`: rendering CaseScreen sets `--sidebar-width` on `.app-layout` from storage (`320px` for a stored 320), the separator has `aria-controls` equal to the sidebar's `id`; tab names "Findings" and, with one unchecked carried input, "Findings, 1 to check".
- [ ] **Step 2: Run** `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/sidebarLayout.test.tsx`; FAIL.
- [ ] **Step 3: Implement**: `const sidebar = useSidebarWidth(username)`; `style={{ "--sidebar-width": `${sidebar.width}px` } as CSSProperties}` on `.app-layout`; `id="findings-column"` on the aside; render `<SidebarResizer …/>` right after the aside; tab label from `openKeys.size`. Confirm with `grep -rn "round-input-panel\|work-round-actions" frontend/src` that no component uses the classes any more, then delete every `.round-input-panel*` rule and the `.round-input-panel ol, .work-round-actions ol` rule (Q8) from `editor.css`, and remove only the Q8 test ("restores list padding in the carried panel and the work round list") from `quickFixStyles.test.ts`. If a class is still used, keep its rules and report.
- [ ] **Step 4: Run** `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/sidebarLayout.test.tsx tests/sidebarResizer.test.tsx tests/caseResize.test.tsx tests/sidebar.test.tsx tests/quickFixStyles.test.ts`, typecheck; PASS.

**Done checklist:** width variable and separator mounted; tab label; dead Q8 and panel CSS gone with its assertion; Q7 rule untouched.
**Commit point (later):** `feat(editor): mount the findings column resizer and drop dead panel styles`.

---

## F9: Lead read-only check states in the case viewer

**Goal:** Resolved question 5: a lead opening a submitted carry-forward submission sees Checked / Dismissed per input with reasons.
**Lock:** after Documents E3 (owner of `CaseViewer.tsx` and `caseViewer.test.tsx`); F9 then owns both files for this one mount and one test.
**May read:** `frontend/src/variants/CaseViewer.tsx` (find where a `submission` VersionRef is displayed, after Documents B1 and E3); `editor/carried/CarriedChecksReadOnly.tsx`; `api.getSubmissionHistory`.

- [ ] **Step 1: Failing test** (append to `frontend/tests/caseViewer.test.tsx`): displaying a submission whose detail has `round_inputs` renders "Carried findings" with "Checked" and "Dismissed" badges and the dismissal reason; a submission without inputs renders nothing.
- [ ] **Step 2: Run** `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/caseViewer.test.tsx`; FAIL.
- [ ] **Step 3: Implement**: when the displayed ref is a submission, fetch the detail (or reuse it if CaseViewer already does) and mount `CarriedChecksReadOnly` below the version controls. Derive per-input state with `deriveCarriedStates(detail.round_inputs, detail.round_input_resolutions, detail.annotations)`. One mount, no other CaseViewer change.
- [ ] **Step 4: Run** `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/caseViewer.test.tsx tests/submissionHistory.test.tsx`, `npm --prefix frontend run typecheck`; PASS.

**Commit point (later):** `feat(variants): carried check states for leads`.

---

## F10: Browser fixture and scenarios

**Goal:** Spec "Testing" → Browser list.
**Lock:** `tests/browser_server.py` only while Documents P1 and problem-reports WP9a do not hold it; existing specs in `frontend/browser/` only after Documents P7 (their owner), quick-fixes WP-H and problem-reports WP9e, never concurrently with another plan's spec edits; Playwright alone in the worktree (lock 7).
**May read:** spec "Testing"; `tests/browser_server.py:380-500` (route registration pattern, `run_fixture_import`), `:1006-1130` (re-anchor fixture building a corrected text and carried/needs-review outcomes); `frontend/browser/helpers.ts`; `frontend/browser/reanchor.spec.ts` (fixture use pattern); `frontend/browser/design.spec.ts` (axe and forced-colours patterns).

- [ ] **Step 1: Fixture.** New `tests/browser_carry_fixture.py` with `register_carry_forward_scenario_route(app)` adding `POST /__test_carry_forward__?scenario=t5|corrected|rounds3` which, through the real services (`WorkRoundService`, `EditingService`, `SubmissionService`):
  - `t5`: annotator `ann-0004` on `de` text: Round 1 submitted with one spanless finding "Seizure"; Round 2 carry-forward with one added finding; returns `{ assignment_id, username, password }`.
  - `corrected`: Round 1 submitted on v1 with a span, text corrected to v2 so mapping fails (needs-review input with `review_reason`).
  - `rounds3`: Rounds 1 (submitted, replaced), 2 (submitted), 3 (open carry-forward).
  Register it in `tests/browser_server.py` with one import and one call next to the other `register_*` calls.
- [ ] **Step 2: Specs** `frontend/browser/carried-review.spec.ts`:
  - T5: check → badge and progress; edit note → "Check needed" + "Changed after your check"; "Does not apply…" with reason → placeholder "Dismissed: …" → "Undo dismissal" → the carried finding is back with the edited note and "Check needed"; delete → placeholder → dismiss with reason → undo dismissal (nothing restored) → link via chooser → submit dialog "Go to Seizure" focuses "Mark as checked"; the toolbar shows "Finish & Submit · 1 open" before the dialog was ever opened; submit succeeds after the check.
  - corrected: placeholder with the specific reason; Mark in text → save → Mark as checked.
  - rounds3: Work rounds table, "Replaced by Round 2"/"Submitted" in one row, "still open" reason; My submissions shows Round 1 and 2 and "Round 3 · not submitted yet".
  - keyboard-only pass through N, C, Go to; axe has no violations on the editor with the section open.
  `frontend/browser/editor-layout.spec.ts`:
  - Original evidence dialog at 1440×900 and 390×844: Close bounding box inside the viewport without scrolling; Work rounds and submit dialog likewise.
  - Sidebar resize by pointer and keyboard; persistence across reload; Enter/double-click reset; 1024 px and 700 px transitions (no separator at 700); text-pane left edge unchanged at the default width compared with a run where the separator is hidden.
  - 320 px reflow without horizontal scrolling; forced colours (`page.emulateMedia({ forcedColors: "active" })`) shows grip and focus; focus ring contrast ≥3:1 for the separator and the mention edge handle (compute from `getComputedStyle` colours as in `design.spec.ts`).
- [ ] **Step 3: Update existing specs** that asserted removed UI ("Review carried findings", "Saved findings", "Submission history", "Original carried finding", "Start carry-forward round", plain "Finish & Submit Case" while items are open): `grep -rln "Review carried findings\|Saved findings\|Submission history\|Original carried finding\|Start carry-forward round\|Finish & Submit Case" frontend/browser`. In `frontend/browser/quick-fixes.spec.ts` remove or retarget only the `Q1 (B1)` test, if present (F8a renamed the dialogs; this file's other dialog checks in `editor-layout.spec.ts` cover Q1 for them), and the `Q8` test (carried panel and round list no longer exist; F4b removed the rule).
- [ ] **Step 4: Run** (alone, no other heavy agent): `HPO_E2E_PORT=18793 npm --prefix frontend run test:e2e -- carried-review.spec.ts editor-layout.spec.ts`, then the updated specs, then `HPO_E2E_PORT=18793 bash scripts/check.sh --only browser`. Expected PASS.

**Commit point (later):** `test(browser): carried review, rounds and editor layout`.

---

## F11: DESIGN.md and final gate

**Goal:** Document new contracts; run the full local gate.
**May read:** `DESIGN.md` component table and Do's (after Documents X1).

- [ ] **Step 1:** `DESIGN.md`: `Dialog` row: header close when `onClose` (never initial focus; suppressed with Escape; "Case submitted" has none), fixed footer, `max-height: min(90vh, …)`. New rows: carried check states (badge texts and shapes), `SidebarResizer` (keys, limits, persistence key), submit dialog rule "every open item has its own Go to; Submit stays focusable with `aria-disabled` and a described reason". Do's: "Name rounds as `Round n`; never show raw round states or IDs outside Technical details."
- [ ] **Step 2: Gate** (one at a time, with no other heavy agent of any plan running): `bash scripts/check.sh --only static`; `CHECK_VITEST_WORKERS=4 bash scripts/check.sh --only frontend`; `bash scripts/check.sh --only backend`; `HPO_E2E_PORT=18793 bash scripts/check.sh --only browser`. Expected: all PASS. Record command, exit status and summary in the report.
- [ ] **Step 3: Release check (user decision 4).** Read `docs/superpowers/reviews/2026-10-19-translation-check-explanations-review.md` (F3). If any row has no user decision, list those codes in the report as "awaiting user confirmation before release"; this does not fail the gate.

**Commit point (later):** `docs: design contracts for carried review, dialogs and resizable column`.

---

## Self-review against the spec

| Spec part | WP |
|---|---|
| Decision 1, section 1 (one list, header, progress, Next unchecked, rows, instruction lines, placeholders, linked meta, toolbar badge) | F2, F5a, F6a, F6b, F8b |
| Section 2 (inspector section, Mark as checked, collapse, focus, announcement, changed after check, read-only) | F2, F5b, F6a, F6c |
| Section 3 (exception path: reason, original, Mark in text, link chooser, dismiss, delete sentence, dismissed state) | F5b, F6c; Resolved 2 in F6c |
| Section 4 (transitions, stale) | F2, F6a, F6c |
| Section 5 (submit dialog, per-item Go to, Finish & Submit · n open, Next open item, aria-disabled, footer) | F7 |
| Section 6 (original evidence dialog) | F8a, F8b (caller wiring) |
| Section 7 (identity line, Work rounds table, start-new-round reasons, My submissions) | B1, B3, F2, F8a, F8b |
| Section 8 (Dialog header close, fixed footer, focus) | F1 |
| Section 9 (translation checks) and Resolved 4 (review file, release check) | F3, F11 |
| Section 10 (resizable sidebar, focus ring, forced colours, narrow tab label) | F4a, F4b; Q7 by quick-fixes WP-F |
| Keyboard summary (N, Shift+N, C, separator keys, Escape) | F4a, F5b, F6b, F6c |
| Loading and errors | F5b, F6a, F6c, F8a, F8b |
| API additions | B1, B3, B4 |
| Resolved 1 (atomic dismiss, enforced at submission too) | B2, F6a, F6c |
| Resolved 3 (undo dismissal restores the removed finding) | B2, F5b, F6a, F6c |
| Resolved 5 (leads read-only) | B3, F5b, F8b, F9 |
| Resolved 6 (C key, other-assignment label, per-user width) | F6c, F2 (plan decision 4), F4a |
| Resolved 7 (toolbar open count always) | F7 |
| Resolved 8 (round inputs access unchanged, regression tests) | B1 |
| Testing (unit, component, browser) | each WP; F10 |
| Contracts preserved | B2 (no auto-complete, reasons required, history kept), F6c/F7 (no auto-complete), F4a (no layout shift on selection), B1 (access rules unchanged) |

## Review disposition

Codex review `ontocurator-reviews/2026-10-19-plan-editor-carried-review-codex.md` (10 findings plus one note). Each finding was checked against the code and the sibling plans before it was applied.

| # | Finding | Verified against | Disposition |
|---|---|---|---|
| 1 | P1 Dismissal invariant only enforced at resolution | `application/work_rounds.py:593` (`continue` for dismissed), `submissions.py:432` | Applied: `validate_round_input_resolutions` refuses a dismissed input whose carried finding is present; tests for a legacy dismissal and a re-created carried ID (B2). |
| 2 | P1 Network errors leave queue promises pending | `editor/autosave.ts:110-130` (transport/5xx/session keep the operation queued) | Applied: new F6a hook package takes `queueState`, `getLastError`, `retry`; error shown from queue state, retry via `queue.retry()` with the original envelope; tests for network failure, lost response, 401 and recovery. |
| 3 | P1 F8a required props without caller update | `TaskEditor.tsx:160`, `CaseScreen.tsx:2592` | Applied: F8a's new props are optional with fallbacks (typecheck green with unchanged callers); F8b, which owns both callers, wires them and tests them. |
| 4 | P1 Historical dialog conversion breaks raw-`Submission` entry points | `CaseScreen.tsx:2593, 2643`; `submission_history_routes.py:38-42` | Applied: `HistoricalSubmissionView` with `fromSubmission` / `fromHistoryDetail` adapters; all three entry points tested (F8b). |
| 5 | P1 Shared-helper checks target obsolete locations | Documents plan "Shared primitives" (`domain/submission_labels.py` B5; `app/submissionLabels.ts`, `app/Time.tsx` D1) | Applied: prerequisites, imports and checks use the canonical modules; all Documents references use WP ids (B1, B4, B5, B9, U1, U2, D1, DX, E3, P1, P7, X1). |
| 6 | P2 Advertised disjoint ownership is false | F6/F8a both on `workRoundActions.test.tsx`; F1 vs F0 baseline; `caseScreen.test.tsx:896,935` Close queries; F1 full suite | Applied: F0 moves the carried cases into `carriedPanelLegacy.test.tsx` (F6b deletes it, F8a keeps `workRoundActions.test.tsx`); F1 reclassified heavy, serialized after F0, with an explicit query-scoping step; heavy accounting counts machine-wide slots; cross-plan locks for `components.css`, `editor.css`, dialogs, `app.py`, error codes, generated contracts, `browser_server.py`, existing specs, `DESIGN.md`. |
| 7 | P2 Deletion warning needs an unowned component | `AnnotationPanel.tsx:403` (hard-coded confirmation text) | Applied: F6c owns an optional `deleteConfirmMessage` prop in `AnnotationPanel.tsx`; tests for carried and ordinary findings. |
| 8 | P2 Go to cannot target the axis or guarantee scrolling | `AnnotationPanel.tsx:239-257` (per-axis fieldsets), `TextPane.tsx:182`, `spans/adapter.ts:176` (`highlight` only) | Applied: `OpenItem` carries `axisId` and `evidenceId`; F7 adds `data-axis-field={axis.id}` and a `scrollToEvidence` method on the span handle (owned edits in `adapter.ts`, `TextPane.tsx`), with tests for the second-axis case and scrolling. |
| 9 | P2 Q-C authorization leak claim is wrong | `api/routes.py:165` (`get_repo` → `ScopedRepository`), `authz/scoped.py:129-152` | Applied (user decision 3): open question removed; B1 adds regression tests for owner, lead, other annotator on the same document, outsider; enrichment only after scoped reads. |
| 10 | P3 F3 test does not parse | The plan line is `getByText("“mg added”")`: typographic quotes inside an ASCII string literal (bytes `22 E2 80 9C … E2 80 9D 22`) | Rejected: valid TypeScript; the review rendered the curly quotes as ASCII. No change. |
| — | Note: F6 too broad for one session | F6 scope (queue, selection, recreation, delete, keys, a11y) | Applied: split into F6a (hook, light), F6b (list and selection), F6c (inspector, exception path, recreation, delete, `C`), with the hook interface fixed in F6a. |

User decisions of 2026-10-19 applied in the same revision: undo restores the removed finding (B2, F6a, F6c, F10); toolbar count always (F7, F10); no access change for round inputs (B1); check-code texts confirmed before release (F3, F11 Step 3). The spec's "Resolved questions" were updated accordingly (3 revised; 7 and 8 added).
