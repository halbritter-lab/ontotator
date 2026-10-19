# Documents as the Lead's Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Documents the lead's central table (one row per text and language) with a "Needs your decision" bar, inline final-result decisions and one shared cause projection with the export preflight, as specified in [2026-10-19-documents-lead-table-design.md](../specs/2026-10-19-documents-lead-table-design.md).

**Architecture:** The backend gains one conn-scoped cause derivation (`application/final_causes.py`) used by the export preflight (exclusive lock) and a new read model for Documents (`application/document_rows.py`, shared lock), with pure row rules in `domain/document_rows.py`. Two lead-only read endpoints feed a rewritten `admin/DocumentsPage.tsx` built from new `frontend/src/documents/*` modules and extended `ui/` primitives (`InlineConfirm`, grouped `DataTable`, focus-keeping `Button`). The Submission history dialog, the Progress warning list and the old final-result selector are removed.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2, Alembic, PostgreSQL (pytest via testcontainers or `ONTOCURATOR_TEST_PG_URL`); React 18, TypeScript, Vitest + Testing Library, Playwright + axe-core; `openapi-typescript` for `generated.ts`.

---

## Ground rules for every implementer

- Work in `C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation` (branch `feat/phase0-acceptance-plan`). It holds many **uncommitted** implementation changes. Never `git reset`, `git checkout -- <file>`, `git stash`, or clean. Edit on top of the working tree.
- **Do not commit or push.** Each task ends with a "Commit point" listing the files and message for later; do not run it unless the user explicitly asks.
- No CI. All verification is local:
  - Backend tests need PostgreSQL: Docker running, or `ONTOCURATOR_TEST_PG_URL` set to a throwaway superuser URL. Run single files with `uv run pytest tests/<file>.py -q`.
  - Static: `uv run ruff check . && uv run ruff format --check . && uv run mypy src`.
  - Contracts: `uv run python scripts/export_openapi.py` then `npm --prefix frontend run api:generate`; drift checks `uv run python scripts/export_openapi.py --check` and `npm --prefix frontend run api:check`. Admin error codes: `uv run python scripts/export_admin_error_codes.py` (check with `--check`).
  - Frontend unit: `npm --prefix frontend test -- <path relative to frontend>`; types: `npm --prefix frontend run typecheck`.
  - Browser: `npm --prefix frontend run test:e2e -- <spec file name>` (builds, then runs Playwright against `tests/browser_server.py`, one worker).
  - Full gate before declaring a phase done: `bash scripts/check.sh --only static`, `--only frontend`, `--only backend`, `--only browser`.
- All files and UI copy in English. No Unicode glyph icons; use `ui/icons.tsx`.
- **Execute by work package (WP), not by phase.** The section "Execution: work packages and lanes" below is the dispatch unit for subagents. A WP lists the tasks it covers, the files it **owns** (the only files it may write), the context it needs, verification and a done checklist. The task sections further down hold the detailed steps and code. A WP agent reads only its WP block, the listed tasks and the listed spec sections and code locations.
- **Resource limits (16 GB machine).** At most two test-heavy agents at once. Test-heavy = backend `pytest` against PostgreSQL, a full `npm --prefix frontend test` run, or any Playwright run. Single-file vitest runs are light. Always run vitest with `-- --maxWorkers=4 --minWorkers=1` (for example `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/ui/button.test.tsx`). Playwright builds `frontend/dist` and binds `HPO_E2E_PORT` (default 18765): only one Playwright run per worktree at a time, and every worktree that runs browser tests uses its own port (`HPO_E2E_PORT=18766 npm --prefix frontend run test:e2e -- …`).
- **Generated artifacts** (`contracts/openapi.json`, `frontend/src/api/generated.ts`, `contracts/admin-error-codes.json`) are never hand-edited. Only the WP that owns them regenerates them (B9 for OpenAPI and `generated.ts`, B4 for admin error codes). Before B9, OpenAPI drift is expected: earlier backend WPs verify with `uv run ruff check . && uv run ruff format --check . && uv run mypy src` and their pytest files, not with `check.sh --only static`.

## Open questions (need a user decision; the plan implements the stated default behind one function so it is a one-line change)

1. **`accepted_corrected` parent version.** A correction whose latest review is `accepted_corrected` ends in status `reviewed` and gets an accepted child. Should the parent still raise `SELECTED_TEXT_CORRECTED:{sel}:{parent}:reviewed`? Default: **no** (the accepted child raises its own cause). Implemented in `corrects_selected_text()` (Task 1.3).
2. **Existing acknowledgements of `SELECTED_TEXT_CORRECTED:{sel}:{corr}` (old 3-part ids).** The spec only migrates `SELECTED_ROUND_*`. Default (revised after review): **leave them unchanged**, so each existing correction asks once more after the upgrade. An old acknowledgement records no status, so appending the correction's *current* status could silently acknowledge an acceptance that happened after the lead confirmed (Task 1.2, review finding 2).
3. **"Most recently created root"** (Open target with parallel roots, no final). `documents` has no creation time. Default: the root with the highest `position`, then highest `document_id` (`open_target()`, Task 2.1).
4. **Compare deep link.** The spec does not name a route parameter for the right-hand submission. Default: `projectCase` gains `compare=<refKey>` (JSON `["submission", id]`, the same encoding as `annotations`), forwarded by `App.tsx` to `CaseViewer` (Task 4.1, 6.4).
5. **"Resume task" link.** Default: the problem report route gains `action=resume`, which only preselects "Release selected pauses" and the paused assignment; nothing runs automatically (Task 4.1, 6.3).
6. **Who counts as "lead" for Documents access.** Default: `ProjectSummary.can_manage` (lead role or system admin), the same check that shows the navigation entry today (Task 5.6).
7. **`SELECTED_NEWER_RESULT` vs an acknowledged `SELECTED_RESULT_REVISED`.** "Not already named by `SELECTED_RESULT_REVISED`" is read as: the submission is the subject of a REVISED cause id, raised or acknowledged. Otherwise acknowledging REVISED would immediately raise NEWER for the same submission (Task 1.3).
8. **"Changed: {reason}" wording** beyond the two spec examples. Default reasons: "Work assigned", "Task paused", "Task resumed", "Final result changed", fallback "Updated elsewhere" (Task 5.9).
9. **Resolved badge after a report-page action.** Returning from the report page remounts Documents. Default: the visit state (rows shown under the active decision filter with their categories at that time, and decisions taken) lives in `sessionStorage` keyed by project and filter, and the report page records its resume/resolve there. A reload clears it (`visitState.ts`, Task 5.9). Retained rows are refreshed from the server: the rows request carries their keys as repeated `retain=<case>:<language>` and the server returns them with current data even when they no longer match the decision filter (Task 2.2b, review finding 5).

## Shared primitives owned by this plan

This plan is the **single owner** of the primitives below. Sibling plans (`2026-10-19-quick-fixes-and-export.md`, `2026-10-19-editor-carried-review.md`, `2026-10-19-problem-reports.md`) depend on the named WP and must not reimplement, fork or restyle them; they request changes from this plan instead. The owning WPs have no backend dependency and can run first.

| Primitive | Contract | File(s) | Owning WP |
|---|---|---|---|
| `Button` busy state | `loading` sets `aria-disabled="true"` and `aria-busy="true"`, swallows activation (`preventDefault`, no `onClick`), never sets native `disabled`, so a focused button keeps focus; a caller-set `aria-disabled` without `loading` still fires `onClick` so the caller can explain why | `frontend/src/ui/Button.tsx`, `.btn[aria-disabled="true"]` rule in `styles/components.css` | U1 |
| Shortcuts `allowInInputs` / scope | `useShortcut(key, handler, { allowInInputs, root })`: `allowInInputs` lets the handler run while focus is on an input or checkbox; `root` scopes it to a subtree; a handler returning `false` lets the event fall through to outer handlers | `frontend/src/ui/shortcuts.ts` (behaviour pinned by tests; change only if a test fails) | U1 |
| `InlineConfirm` | `ConfirmDialog` props minus `open`, plus `children`, `outcome` (`conflict` / `error` / `session`), `headingLevel`, optional `conflictMessage` (replaces the fixed conflict sentence; problem-reports CR-1); focus to heading on open; Escape only with focus inside; busy keeps focus | `frontend/src/ui/InlineConfirm.tsx`, `.inline-confirm*` CSS | U1 |
| `useMediaQuery` | `useMediaQuery(query): boolean`, false without `matchMedia` | `frontend/src/ui/useMediaQuery.ts` | U1 |
| `DataTable` groups / `renderExpanded` | additive props `groups: DataTableGroup<T>[]` (one `tbody` per group, `th scope=rowgroup` header), `renderExpanded(row)` (following full-width `tr.data-table-expanded`), `Column.rowHeader`, `busy`; sorting within groups; existing props unchanged | `frontend/src/ui/DataTable.tsx` | U2 |
| Router params and replace navigation | `ProjectDocumentsQuery` (`case`, `decision`, `final`, repeated `open`, `page`, existing filters), `documents_*` passthrough on case and report routes, `projectCase.compare`, `projectProblemReport.action = "resume"`, entries-based `querySuffix`; `NavigateOptions { replace?: boolean }` and `go(route, options)` in `App.tsx` | `frontend/src/app/router.ts`, navigation part of `frontend/src/App.tsx` | U3 |
| Submission label and round-ordinal helpers (frontend) | `formatTime(iso, { now?, seconds? })`, `fullTimestamp(iso)`, `personLabel(pseudonym, isMe)`, `roundCell({ ordinal, author, isMe })`, `submissionLabel({ kind, ordinal, author, isMe, language, version, recordedAt }, { now?, withLanguage? })`, `kindLabels`; `<Time iso>` component | `frontend/src/app/submissionLabels.ts`, `frontend/src/app/Time.tsx` | D1 |
| Round ordinals and submission kinds (backend) | `round_ordinals(rounds: Iterable[tuple[round_id, predecessor_id]]) -> dict[str, int]`, `submission_kind(round_kind, mode)` | `src/ontocurator/domain/submission_labels.py` | B5 |
| Forced-colours / reduced-motion base rules | `.final-row`, `.status-pill`, `:focus-visible`, `.segment[aria-current="page"]`, `.disclosure-chevron` | `styles/components.css` | U1 |

Siblings that need a primitive before this plan is done depend on the WP id (for example "depends on documents-lead-table U1"), not on the whole plan. If a sibling needs a contract change, it is made in the owning WP's files by this plan's lane, not in parallel.

## Execution: work packages and lanes

### Files shared with sibling plans (serialize across plans)

These files are written by this plan **and** likely by a sibling plan. Only one agent at a time (across all plans) may own each; the coordinator sequences them. Inside this plan the owner WP is named.

| File | Owner WP here | Likely sibling writer |
|---|---|---|
| `frontend/src/App.tsx` | U3 → D6 → E2 → E3 (in that order) | then problem-reports WP7b (non-lead branch of `projectProblemReport`) |
| `frontend/src/app/router.ts` | U3 | — (siblings consume only) |
| `frontend/src/ui/Button.tsx`, `ui/shortcuts.ts`, `ui/InlineConfirm.tsx`, `ui/index.ts`, `styles/components.css` | U1 (includes problem-reports CR-1 `conflictMessage`) | `components.css` also: quick-fixes WP-F (before U1), editor F1 (`.ui-dialog*` block, incl. problem-reports CR-2), quick-fixes WP-C → WP-D → WP-E (after U1); one writer at a time |
| `frontend/src/ui/DataTable.tsx` | U2 | — |
| `frontend/src/admin/FinalExportPanel.tsx` | E1 | quick-fixes-and-export (Cancel, primary button) |
| `frontend/src/tasks/ProblemReportDetail.tsx`, `frontend/tests/problemReportRoute.test.tsx` | E2 | then problem-reports WP7 (rewrite, first test) → WP7b (second test) |
| `frontend/src/variants/CaseViewer.tsx`, `SubmissionHistory.tsx`, `ComparePane.tsx` | E3 | editor-carried-review |
| `src/ontocurator/application/final_results.py` | B3 → B4 | quick-fixes-and-export (export) |
| `src/ontocurator/storage/repository.py` | B1 | problem-reports, editor-carried-review |
| `src/ontocurator/api/app.py` | B4 → B9 | then editor B2 (status line) → editor B3 (router include) |
| `src/ontocurator/domain/admin_error_codes.py`, `frontend/src/admin/errors.ts`, `contracts/admin-error-codes.json` | B4 | then editor B2 (one code) |
| `contracts/openapi.json`, `frontend/src/api/generated.ts`, `frontend/src/api/client.ts` | B9 | contract slot after B9: editor B4 → problem-reports WP4 → WP8, one at a time |
| `application/document_rows.py`, `document_row_page.py`, `api/document_row_routes.py`, `frontend/src/documents/ExpandedRow.tsx` | B6, B7, B9, DX | problem-reports WP8 (hook lines and "More" item only; after B9 and DX, not while E4 runs) |
| `tests/browser_server.py` | P1 (one registration line only) | problem-reports WP9a, editor F10 (one line each, one at a time) |
| existing `frontend/browser/*.spec.ts` | P7 | before P7: quick-fixes WP-D (`admin.spec.ts`), WP-E (`final-workflow.spec.ts` export lines); after P7: problem-reports WP9e, then editor F10 |
| `DESIGN.md` | X1 | then editor F11 |

### Dependency graph

```
Backend:   B1 ─┐
           B2 ─┴─► B3 ─► B4
           B5 + B3 ─► B6 ─┬─► B7 ─┐
                          └─► B8 ─┴─► B9      (B9 also needs B1, B4)
UI:        U1, U2, U3, D1                     (no dependencies; can run first)
Documents: B9 + U3 ─► D2 ─┬─► D4 ─► D5 ─┐     (D4 also U2, D1)
                          └─► DX ───────┴─► D6 ─► D7 ─► D8     (DX also U2, U3, D1; D6 also U1)
Elsewhere: B9 + U3 ─► E1;   D8 ─► E2 ─► E3 (also DX, B1) ─► E4 (also E1)
Browser:   B9 ─► P1 ─► P2 ─► P3;   P3 + D8 ─► P4;   P3 + E2 ─► P5;   P3 + E3 ─► P6;   E4 + P4 + P5 + P6 ─► P7
Docs:      U1 + U2 + D6 ─► X1
```

### Work packages

Effort guide: S = under an hour of agent work, M = one focused session, L = full session. Heavy = runs PostgreSQL pytest, full vitest or Playwright.

| WP | Tasks | Size | Heavy | Depends on |
|---|---|---|---|---|
| B1 | 1.1, 2.5 | M | yes | — |
| B2 | 1.2 | S | yes | — |
| B3 | 1.3 | L | yes | B1, B2 |
| B4 | 1.4, 1.5, 1.6 (+ exact warning set) | M | yes | B3 |
| B5 | 2.1 | S | light (no DB) | — |
| B6 | 2.2a | M | yes | B3, B5 |
| B7 | 2.2b | L | yes | B6 |
| B8 | 2.2c (former 2.3) | M | yes | B6 |
| B9 | 2.4, 2.6 | M | yes | B4, B7, B8, B1 |
| U1 | 3.1, 3.2, 3.3, 3.5, 3.6 | M | full vitest once | — |
| U2 | 3.4 | S | full vitest once | — |
| U3 | 4.1, 4.2 | M | full vitest once | — |
| D1 | 5.1 | S | light | — |
| D2 | 5.2, 5.3 | M | light | B9, U3 |
| D4 | 5.4 | L | light | D2, U2, D1 |
| D5 | 5.5 | S | light | D4 |
| DX | 5.7 | L | light | D2, U2, U3, D1 |
| D6 | 5.6 | L | light | D2, D5, DX, U1, U3 |
| D7 | 5.8 | L | light | D6, U1 |
| D8 | 5.9 | M | full vitest once | D7 |
| E1 | 6.1, 6.2 | S | light | B9, U3 |
| E2 | 6.3 | S | light | D8 |
| E3 | 6.4 | M | light | E2, DX, B1 |
| E4 | 6.5 | S | full vitest | E1, E3 |
| P1 | 7.1a | M | yes | B9 |
| P2 | 7.1b | M | yes | P1 |
| P3 | 7.1c | M | yes | P2 |
| P4 | 7.2 | M | Playwright | P3, D8 |
| P5 | 7.3 | L | Playwright | P3, E2 |
| P6 | 7.4, 7.5 | M | Playwright | P3, E3 |
| P7 | 7.6 + final verification | L | Playwright | E4, P4, P5, P6 |
| X1 | 8.1 | S | none | U1, U2, D6 |

D3 is merged into D2 (hooks and DecisionBar are both small); the id is not used.

### Recommended lanes

Two test-heavy lanes plus one light lane. Lanes share the worktree; owned files are disjoint at any moment, so no commits are needed between lanes.

| Order | Lane A (backend, then browser) | Lane B (frontend) | Lane C (light, no heavy tests) |
|---|---|---|---|
| 1 | B1 | B2 | D1, then U2 (its one full-suite run waits for a free heavy slot) |
| 2 | B3 | B5, then U1 | — |
| 3 | B4 | U3 | — |
| 4 | B6 | (wait for B6) | — |
| 5 | B7 | B8 | — |
| 6 | B9 | (wait for B9) | — |
| 7 | P1 | D2 | E1 |
| 8 | P2 | D4, then D5 | DX |
| 9 | P3 | D6 | X1 (after D6) |
| 10 | (wait) | D7, then D8 | — |
| 11 | P4 | E2, then E3 | — |
| 12 | P5 | E4 | — |
| 13 | P6, then P7 | — | — |

Lane C runs only single-file vitest; when a Lane C WP needs its one full-suite run, it waits until one of Lane A/B is between heavy steps. Never run two Playwright WPs at once in the same worktree.

### WP blocks

Every WP ends with the same closing steps: run its verification commands, tick its done checklist, and report changed files plus any deviation from the plan. No commits.

**B1: Conn-scoped reads, orphan-pause cause, `submission` VersionRef**
- Owns: `src/ontocurator/storage/repository.py`, `src/ontocurator/api/final_result_routes.py` (`FinalWarning` only), `src/ontocurator/authz/versions.py`, `tests/test_final_causes.py` (create), `tests/test_annotation_versions.py` (append).
- Context: Tasks 1.1, 2.5; spec "Backend and API changes" (One projection, `TASK_PAUSED_WITHOUT_REPORT` row) and "Shared rules" (access); code `repository.py:391-598` (`get_work_round`, `get_round_for_submission`, `list_workflow_causes`), `repository.py:2000-2062` (`get_annotation_version`), `authz/versions.py:105-195`, fixtures `tests/test_assignment_round_open_api.py::round_work`, `tests/test_annotation_versions.py`.
- Verify: `uv run pytest tests/test_final_causes.py tests/test_problem_reports.py tests/test_problem_reports_api.py tests/test_final_results.py tests/test_final_warning_relevance.py tests/test_annotation_versions.py tests/test_case_api.py -q`; `uv run ruff check . && uv run ruff format --check . && uv run mypy src`.
- Done: `*_in` methods exist and open no second transaction; report and hold causes carry `report_id`/`assignment_id`; orphan pause derived; leads get `submission` refs, annotators and reviewers do not (404 on fetch); non-lead `own` refs unchanged.

**B2: Migration 0014**
- Owns: `src/ontocurator/storage/migrations/versions/0014_final_selection_identity.py`, `src/ontocurator/storage/final_tables.py`, `tests/test_final_selection_migration.py`.
- Context: Task 1.2 (revised); spec "Backend and API changes" (cause table, `selected_at`); `storage/migrations/versions/0013_*.py`, `0001_initial.py`, `0006_variants.py`, `storage/tables.py:150-200` (documents constraints), `tests/pg_harness.py`.
- Verify: `uv run pytest tests/test_final_selection_migration.py tests/test_schema.py -q`; ruff and mypy.
- Done: `selected_at` backfilled per project from events; rule column nullable; round acks rewritten; text-correction acks and all other selection columns and event payloads unchanged; two-project test passes.

**B3: One cause derivation (`final_causes.py`)**
- Owns: `src/ontocurator/application/final_causes.py` (create), `src/ontocurator/application/final_results.py` (`_authorize`, `_projection`, reaffirmation code set), `tests/test_final_causes.py` (append), `tests/tests_support_reviews.py` (create); expectation-only edits in `tests/test_final_results.py`, `tests/test_final_warning_relevance.py` if they assert the old id forms.
- Context: Task 1.3; spec "Backend and API changes" (cause table) and Open questions 1, 7 here; `final_results.py` whole file, `application/workflow_warnings.py`, `tests/test_final_warning_relevance.py::test_empty_carry_forward_is_pending_until_immutable_submission`.
- Verify: `uv run pytest tests/test_final_causes.py tests/test_final_results.py tests/test_final_warning_relevance.py tests/test_workflow_warnings.py tests/test_final_export.py tests/test_final_human_export.py -q`; ruff, mypy.
- Done: `derive_final_state` runs on the caller's connection; round ids without revision; NEWER and status-carrying TEXT_CORRECTED causes; rejected/queried corrections raise nothing; preflight output otherwise unchanged.

**B4: `select()`: selection time, rule state, exact warning set, own result, contracts**
- Owns: `src/ontocurator/application/final_results.py` (`select`), `src/ontocurator/api/final_result_routes.py` (`FinalSelectionView`), `src/ontocurator/api/app.py` (409 map), `src/ontocurator/domain/admin_error_codes.py`, `contracts/admin-error-codes.json` (regenerated), `frontend/src/admin/errors.ts`, `tests/test_final_causes.py` (append), `tests/test_final_warning_relevance.py` (one assertion).
- Context: Tasks 1.4, 1.5, 1.6; spec "Inline confirmation" (Conflict outcome), "Expanded row > 2. Submissions" (D4 own result), "Contracts preserved"; `api/app.py` `RevisionConflict` handler (~line 334); `tests/test_final_results.py:60-95`.
- Verify: `uv run pytest tests/test_final_causes.py tests/test_final_results.py tests/test_final_warning_relevance.py tests/test_admin_error_codes.py -q`; `uv run python scripts/export_admin_error_codes.py --check`; ruff, mypy.
- Done: reaffirmation requires the **exact** current acknowledgeable set (concurrent add, removal and status change each give 409); `selected_at` kept on reaffirmation; 409 details carry `selected_by`/`updated_at`; `OWN_RESULT_NOT_SELECTABLE` enforced for choose and keep; non-acknowledgeable ids refused.

**B5: Pure row rules and shared label rules (backend)**
- Owns: `src/ontocurator/domain/document_rows.py`, `src/ontocurator/domain/submission_labels.py`, `tests/test_document_rows_domain.py`.
- Context: Task 2.1; spec "Data model terms", "Bulk selection", "Missing final result rule", "Needs your decision bar" (categories).
- Verify: `uv run pytest tests/test_document_rows_domain.py -q`; ruff, mypy.
- Done: all domain tests pass without a database; `round_ordinals`/`submission_kind` live in `submission_labels.py` and are re-exported by `document_rows.py`.

**B6: Facts loader and service skeleton**
- Owns: `src/ontocurator/application/document_rows.py` (create: `RowQuery`, `RowFacts`, `load_facts`, `load_last_activity`, `DocumentRowsService`), stubs `src/ontocurator/application/document_row_page.py` and `document_row_submissions.py` (signatures only, `raise NotImplementedError`; ownership passes to B7/B8), `tests/test_document_rows_facts.py`.
- Context: Task 2.2a; spec "Last activity", "Missing final result rule", "Backend and API changes"; `api/document_projection.py:287-306`, `final_causes.py`, `tests/test_case_api.py` (`case_env`), `tests/test_final_warning_relevance.py` (`Access` construction).
- Verify: `uv run pytest tests/test_document_rows_facts.py tests/test_final_causes.py -q`; ruff, mypy.
- Done: one connection, shared lock only; `RowFacts` fields exactly as in Task 2.2a; `ACKNOWLEDGEABLE_CODES == domain.document_rows.ACKNOWLEDGEABLE` asserted.

**B7: Page builder**
- Owns: `src/ontocurator/application/document_row_page.py`, `tests/test_document_rows_page.py`.
- Context: Task 2.2b; spec "Table" (all subsections), "Needs your decision bar", "Route query", "Resolved rows and empty state"; `RowFacts` in `application/document_rows.py` (read only).
- Verify: `uv run pytest tests/test_document_rows_page.py -q`; ruff, mypy.
- Done: row dict and page dict exactly as specified, including `retain`, current project rule and per-row equality test on shared cause codes.

**B8: Submissions builder**
- Owns: `src/ontocurator/application/document_row_submissions.py`, `tests/test_document_rows_submissions.py`.
- Context: Task 2.2c; spec "Expanded row > 2. Submissions (n)", "Data model terms" (rounds, kinds); `tests/test_work_rounds.py::create_consolidation_fixture`.
- Verify: `uv run pytest tests/test_document_rows_submissions.py -q`; ruff, mypy.
- Done: all versions' submissions oldest first with kinds, ordinals, counts; rounds and open translation reviews; `CASE_NOT_FOUND` for unknown rows; current project rule included.

**B9: Routes, contracts, client**
- Owns: `src/ontocurator/api/document_row_routes.py` (create), `src/ontocurator/api/app.py` (router include), `tests/test_document_rows_api.py` (HTTP tests only), `contracts/openapi.json`, `frontend/src/api/generated.ts`, `frontend/src/api/client.ts`, `frontend/tests/documents/client.test.ts`.
- Context: Tasks 2.4, 2.6; `api/final_result_routes.py` (`_service` pattern), `frontend/tests/apiClient.test.ts`.
- Verify: `uv run pytest tests/test_document_rows_api.py tests/test_document_rows_page.py tests/test_document_rows_submissions.py -q`; `uv run python scripts/export_openapi.py --check`; `npm --prefix frontend run api:check`; `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/documents/client.test.ts`; `npm --prefix frontend run typecheck`; then `bash scripts/check.sh --only static` and `bash scripts/check.sh --only backend`.
- Done: both routes lead-only with 422 on conflicting filters; generated types present; client functions encode paths and repeated `retain`.

**U1: Button, shortcuts, InlineConfirm, useMediaQuery, base CSS**
- Owns: `frontend/src/ui/Button.tsx`, `ui/shortcuts.ts` (only if a test fails), `ui/InlineConfirm.tsx`, `ui/useMediaQuery.ts`, `ui/index.ts`, `frontend/src/styles/components.css`, `frontend/src/styles/index.css` (three `@import` lines), new empty `frontend/src/styles/screens/documents-table.css`, `documents-cards.css`, `documents-expanded.css` (ownership passes to D4, D5, DX); tests `frontend/tests/ui/button.test.tsx`, `shortcuts.test.tsx`, `inlineConfirm.test.tsx`, `useMediaQuery.test.tsx`, `styles.test.ts`; assertion-only edits in existing tests that expect a natively disabled loading button.
- Context: Tasks 3.1, 3.2, 3.3 (includes problem-reports CR-1: optional `conflictMessage`), 3.5, 3.6; spec "Inline confirmation", "Design system changes", "Shared rules" (aria-disabled); `ui/ConfirmDialog.tsx`, `ui/shortcuts.ts`, `styles/tokens.css`.
- Verify: single files with `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/ui/<file>`; once at the end the whole suite with the same flags; `npm --prefix frontend run typecheck`.
- Done: primitive contracts from "Shared primitives owned by this plan" hold, including `conflictMessage` (CR-1, checked by `grep -n "conflictMessage" frontend/src/ui/InlineConfirm.tsx`); no existing test weakened (only `toBeDisabled()` on loading buttons changed to `aria-disabled`).

**U2: DataTable groups and expansion**
- Owns: `frontend/src/ui/DataTable.tsx`, `frontend/tests/ui/dataTable.test.tsx`.
- Context: Task 3.4; spec "Structure and semantics", "Design system changes" (grouped expandable table).
- Verify: the file, then the full vitest suite once (all DataTable consumers); typecheck.
- Done: additive API only; existing DataTable tests unchanged and passing.

**U3: Router parameters and replace navigation**
- Owns: `frontend/src/app/router.ts`, `frontend/src/App.tsx` (navigation: `requestRoute`, `go`), `frontend/tests/router.test.ts`, `frontend/tests/navigationReplace.test.tsx`.
- Context: Tasks 4.1, 4.2; spec "Route query"; `frontend/tests/shell.test.tsx` (app mounting).
- Verify: both test files, full vitest once, typecheck.
- Done: round trips including repeated `open`, `documents_*` passthrough, `compare`, `action=resume`; replace navigation keeps history length.

**D1: Shared submission labels and Documents label rules**
- Owns: `frontend/src/app/submissionLabels.ts`, `frontend/src/app/Time.tsx`, `frontend/src/documents/labels.ts`, `frontend/tests/submissionLabels.test.ts`, `frontend/tests/documents/labels.test.ts`.
- Context: Task 5.1; spec "Shared rules", "Work wording", "Columns".
- Verify: both files (light); typecheck.
- Done: shared helpers have no `documents/` imports; `documents/labels.ts` imports them.

**D2: Data hooks, fixtures, DecisionBar**
- Owns: `frontend/src/documents/useDocumentRows.ts`, `useRowSubmissions.ts`, `DecisionBar.tsx`, `frontend/tests/documents/fixtures.ts`, `useDocumentRows.test.tsx`, `decisionBar.test.tsx`.
- Context: Tasks 5.2, 5.3; spec "Needs your decision bar", "Route query", "Loading, refresh and errors", "Testing" (scenario table S0 to S15 for fixture shapes); `api/client.ts` types.
- Verify: the three test files; typecheck.
- Done: stale responses discarded; refetch on focus, 60 s and `reload`; `retain` passed through; bar links correct.

**D4: Row cells and collapsed table**
- Owns: `frontend/src/documents/RowCells.tsx`, `DocumentsTable.tsx`, `frontend/src/styles/screens/documents-table.css`, `frontend/tests/documents/documentsTable.test.tsx`.
- Context: Task 5.4; spec "Table" (Structure, Columns, Work wording, Issues and notes, Last activity, Bulk selection).
- Verify: the test file; typecheck. Done: all Task 5.4 bullets pass.

**D5: Narrow cards**
- Owns: `frontend/src/documents/DocumentCards.tsx`, `frontend/src/styles/screens/documents-cards.css`, `frontend/tests/documents/documentCards.test.tsx`.
- Context: Task 5.5; spec "Narrow viewports". Verify: the test file; typecheck.

**DX: Expanded row**
- Owns: `frontend/src/documents/ExpandedRow.tsx`, `SelectionNotice.tsx`, `SubmissionsTable.tsx`, `TextVersions.tsx`, `frontend/src/styles/screens/documents-expanded.css`, `frontend/tests/documents/expandedRow.test.tsx`, `frontend/tests/documents/submissionsTable.test.tsx`.
- Context: Task 5.7; spec "Expanded row" (1 to 3); existing `variants/ConsolidationLauncher.tsx`, `AssignmentActions`, `TranslationCorrectionAction`, `ReviewHistory` (consume, do not modify).
- Verify: both test files; typecheck. Done: `SubmissionsTable` read-only mode and caller-supplied `viewRoute` work without Documents context (E3 reuses it).

**D6: Page shell**
- Owns: `frontend/src/admin/DocumentsPage.tsx` (rewrite), `frontend/src/App.tsx` (the `projectDocuments` case only), `frontend/src/styles/screens/documents-table.css` (taken over from D4), `frontend/tests/documentsPage.test.tsx`; the cases that render the old `DocumentsPage` in `frontend/tests/documentAssignments.test.tsx`, `frontend/tests/variantAdmin.test.tsx` (~48-69, ~165-175) and `frontend/tests/variantApp.test.tsx` (~72-80), which the rewrite makes obsolete: port each to the new page when the behaviour is preserved (filter round trips, assignment tools, review history), otherwise delete it and name the replacing test in the report. Further failures of the D8 full run that only assert the replaced tree are D8's (assertion updates only).
- Context: Task 5.6; spec "Table", "Needs your decision bar", "Resolved rows and empty state", "Loading, refresh and errors", "Shared rules" (access).
- Verify: the test file; typecheck.

**D7: Final confirmations**
- Owns: `frontend/src/documents/FinalConfirm.tsx`, `DocumentsPage.tsx` (confirmation state), `frontend/tests/documents/finalConfirm.test.tsx`.
- Context: Task 5.8; spec "Inline confirmation", "Expanded row > 2. Submissions" (confirmation texts, D4).
- Verify: test file plus `tests/documentsPage.test.tsx`; typecheck.

**D8: Resolved and Changed badges**
- Owns: `frontend/src/documents/visitState.ts`, `DocumentsPage.tsx` (badges, retain), `frontend/tests/documents/visitState.test.ts`, `frontend/tests/documentsPage.test.tsx` (append).
- Context: Task 5.9; spec "Resolved rows and empty state"; Open questions 8, 9.
- Verify: both test files; then the Phase 5 gate: typecheck and full vitest once (`bash scripts/check.sh --only frontend`).

**E1: Progress link and export preflight row links**
- Owns: `frontend/src/admin/ProgressPage.tsx`, `frontend/src/admin/ProjectDashboardPage.tsx` (delete), `frontend/src/admin/FinalExportPanel.tsx` (warning list only), `frontend/tests/progressPage.test.tsx`, `frontend/tests/projectDashboard.test.tsx` (delete), `frontend/tests/exportPage.test.tsx` (warning assertions only).
- Context: Tasks 6.1, 6.2; spec "Changes elsewhere". Verify: the test files; typecheck.

**E2: Problem report back link, resume preselection, visit-state record**
- Owns: `frontend/src/tasks/ProblemReportDetail.tsx`, `frontend/src/App.tsx` (`projectProblemReport` case), `frontend/tests/problemReportRoute.test.tsx`.
- Context: Task 6.3 (now includes `recordDecision` from Task 5.9); spec "Changes elsewhere", Open question 5. Verify: the test file; typecheck.

**E3: Case viewer history and compare deep link**
- Owns: `frontend/src/variants/SubmissionHistory.tsx`, `CaseViewer.tsx`, `ComparePane.tsx`, `frontend/src/App.tsx` (`projectCase` case), `frontend/src/variants/FinalResultSelector.tsx` (delete), `variants/finalSelectionState.ts`; tests `submissionHistory.test.tsx`, `finalSelection.test.tsx`, `comparePane.test.tsx`, `caseViewer.test.tsx`, `finalResultSelector.test.tsx` (delete), new `frontend/tests/caseCompareRoute.test.tsx`.
- Context: Task 6.4; spec "Changes elsewhere" (Submission history dialog); `authz/versions.py` ref kinds (read only).
- Verify: the test files; typecheck.

**E4: Remove dead paths, frontend gate**
- Owns: deletions found by the Task 6.5 search (`frontend/src/variants/documentTree.ts`, `frontend/tests/documentTree.test.ts` if unused) and import fixes in files owned by earlier D/E WPs.
- Verify: Task 6.5 search; `npm --prefix frontend run typecheck`; `bash scripts/check.sh --only frontend`.

**P1, P2, P3: Browser fixture scenarios**
- P1 owns `tests/browser_documents_scenarios.py` (create: route registration, `BUILDERS` registry, shared helpers, S0 to S5 and S8), stubs `tests/browser_documents_scenarios_rows.py` and `tests/browser_documents_scenarios_decisions.py` (each `BUILDERS: dict = {}`; ownership passes to P2/P3), one line `register_documents_scenario_route(app)` in `tests/browser_server.py` next to line 1277, `tests/test_browser_documents_fixture.py`, `frontend/browser/documentsHelpers.ts` (create: `documentsScenario()` POST helper).
- P2 owns `tests/browser_documents_scenarios_rows.py` (S6, S7, S9, S10, S12) and `tests/test_browser_documents_fixture_rows.py`.
- P3 owns `tests/browser_documents_scenarios_decisions.py` (S11, S13, S14, S15) and `tests/test_browser_documents_fixture_decisions.py`.
- Context: Task 7.1 (revised); spec "Testing"; `tests/browser_server.py:747-900` (`register_translation_review_scenario_route` pattern), `tests/test_browser_translation_review_fixture.py`, `tests/t1_builders.py`.
- Verify: each WP's own pytest file; P3 also runs all three.
- Done: each scenario returns its identities and the rows API shows the expected categories.

**P4, P5, P6: New browser specs**
- P4 owns `frontend/browser/documents-table.spec.ts` (Task 7.2); P5 owns `documents-decisions.spec.ts` (Task 7.3); P6 owns `documents-a11y.spec.ts` (Tasks 7.4, 7.5).
- Context: the task, spec "Testing", `frontend/browser/documentsHelpers.ts`, `frontend/browser/design.spec.ts` (axe pattern), `final-workflow.spec.ts` (login pattern).
- Verify: `npm --prefix frontend run test:e2e -- <spec>` (one Playwright run at a time per worktree; set `HPO_E2E_PORT` when another worktree runs browser tests).

**P7: Update existing specs, full gate**
- Owns: the existing specs listed in Task 7.6.
- Verify: `bash scripts/check.sh --only browser`, then "Final verification".

**X1: DESIGN.md**
- Owns: `DESIGN.md`. Context: Task 8.1; spec "Design system changes". Verify: Task 8.1 Step 2.

## File structure

Backend (create):
- `src/ontocurator/application/final_causes.py`: conn-scoped authorization helper, `derive_final_state`, acknowledgeable codes. Single owner of cause derivation.
- `src/ontocurator/domain/document_rows.py`: pure row rules (chains, names, missing-final, bar, bulk/open targets, prefix match).
- `src/ontocurator/domain/submission_labels.py`: round ordinals and submission kinds (shared primitive).
- `src/ontocurator/application/document_rows.py`: `RowQuery`, `RowFacts`, DB facts loader, `DocumentRowsService`.
- `src/ontocurator/application/document_row_page.py`: page builder (rows, filters, bar, grouping, paging).
- `src/ontocurator/application/document_row_submissions.py`: submissions builder.
- `src/ontocurator/api/document_row_routes.py`: response models and two GET routes.
- `src/ontocurator/storage/migrations/versions/0014_final_selection_identity.py`.
- Tests: `tests/test_final_causes.py`, `tests/test_document_rows_domain.py`, `tests/test_document_rows_facts.py`, `tests/test_document_rows_page.py`, `tests/test_document_rows_submissions.py`, `tests/test_document_rows_api.py`, `tests/test_final_selection_migration.py`, `tests/tests_support_reviews.py`.
- Browser fixtures: `tests/browser_documents_scenarios.py`, `tests/browser_documents_scenarios_rows.py`, `tests/browser_documents_scenarios_decisions.py` and their `tests/test_browser_documents_fixture*.py`.

Backend (modify): `storage/repository.py` (conn-scoped cause and round reads, hold/report cause shape, `submission` ref), `storage/final_tables.py`, `application/final_results.py`, `api/final_result_routes.py`, `api/app.py` (router, 409 code), `authz/versions.py`, `domain/admin_error_codes.py`, `tests/browser_server.py` (one registration line).

Frontend (create):
- `frontend/src/ui/InlineConfirm.tsx`, `frontend/src/ui/useMediaQuery.ts`.
- `frontend/src/app/submissionLabels.ts`, `frontend/src/app/Time.tsx`: shared submission label and time helpers.
- `frontend/src/documents/labels.ts`: Documents-specific label rules.
- `frontend/src/documents/useDocumentRows.ts`, `useRowSubmissions.ts`: fetching, discard of stale responses, refetch on focus/60 s/action.
- `frontend/src/documents/DecisionBar.tsx`, `DocumentsTable.tsx`, `DocumentCards.tsx`, `RowCells.tsx`, `ExpandedRow.tsx`, `SelectionNotice.tsx`, `SubmissionsTable.tsx`, `FinalConfirm.tsx`, `TextVersions.tsx`, `visitState.ts`.
- `frontend/src/styles/screens/documents-table.css`, `documents-cards.css`, `documents-expanded.css`.
- Tests under `frontend/tests/documents/`, `frontend/tests/ui/inlineConfirm.test.tsx`, `frontend/tests/submissionLabels.test.ts`.
- Browser: `frontend/browser/documentsHelpers.ts`, `documents-table.spec.ts`, `documents-decisions.spec.ts`, `documents-a11y.spec.ts`.

Frontend (modify): `ui/Button.tsx`, `ui/DataTable.tsx`, `ui/index.ts`, `styles/components.css`, `styles/index.css`, `app/router.ts`, `App.tsx`, `api/client.ts`, `api/generated.ts` (generated), `admin/DocumentsPage.tsx` (rewrite), `admin/ProgressPage.tsx`, `admin/ProjectDashboardPage.tsx` (delete), `admin/FinalExportPanel.tsx`, `admin/errors.ts`, `tasks/ProblemReportDetail.tsx`, `variants/CaseViewer.tsx`, `variants/ComparePane.tsx`, `variants/SubmissionHistory.tsx`, `variants/FinalResultSelector.tsx` (delete), `variants/finalSelectionState.ts` (keep only the change event), `DESIGN.md`.

---

## Phase 1: Shared cause projection and cause changes

WPs: B1 = 1.1 (+ 2.5), B2 = 1.2, B3 = 1.3, B4 = 1.4 + 1.5 + 1.6.

Outcome: preflight and (later) Documents derive identical causes on the caller's connection; cause ids follow the spec; `final_selections` stores `selected_at` and the rule state; a lead cannot select their own result when `adjudicator_not_annotator` is on.

### Task 1.1: Conn-scoped repository reads and report/hold cause shape

**Files:**
- Modify: `src/ontocurator/storage/repository.py:391-598` (`get_work_round`, `get_round_for_submission`, `list_workflow_causes`)
- Modify: `src/ontocurator/api/final_result_routes.py` (`FinalWarning`)
- Test: `tests/test_final_causes.py` (create)

- [ ] **Step 1: Write the failing tests**

```python
"""One cause derivation on the caller's connection (spec: Backend and API changes)."""

from sqlalchemy import select

from ontocurator.storage.tables import AssignmentRow

pytest_plugins = ("test_assignment_round_open_api", "test_translation_review_task")


def _report(client, row, request_id="report-1"):
    opened = client.post(f"/api/v1/assignments/{row.id}/open").json()["assignment"]
    created = client.post(
        f"/api/v1/assignments/{row.id}/problem-reports",
        json={
            "request_id": request_id,
            "expected_workflow_revision": opened["workflow_revision"],
            "round_id": opened["active_round_id"],
            "reason": "Text is cut off after the second paragraph",
        },
    )
    assert created.status_code == 200, created.text
    return created.json()


def _act(client, report, revision, action, ids=None, request_id=None):
    response = client.post(
        f"/api/v1/problem-reports/{report['report_id']}/actions",
        json={
            "request_id": request_id or f"{action}-{revision}",
            "expected_revision": revision,
            "action": action,
            "reason": f"{action} reason",
            "assignment_ids": ids or [],
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def _causes(app, key):
    repo = app.state.repo
    with repo.db.transaction() as conn:
        pid = repo._require_project(conn, key)
        return repo.workflow_causes_in(conn, key, pid)


def test_open_report_and_its_hold_carry_the_report_id(round_work):
    app, client, row, _service, _legacy = round_work
    report = _report(client, row)
    causes = _causes(app, row.project_key)
    opened = next(c for c in causes if c["code"] == "OPEN_PROBLEM_REPORT")
    held = next(c for c in causes if c["code"] == "TASK_ON_HOLD")
    assert opened["report_id"] == report["report_id"]
    assert held["report_id"] == report["report_id"]
    assert not any(c["code"] == "TASK_PAUSED_WITHOUT_REPORT" for c in causes)


def test_resolved_report_with_kept_hold_becomes_task_paused_without_report(
    round_work,
):
    app, client, row, _service, _legacy = round_work
    report = _report(client, row)
    _act(client, report, 1, "resolve")
    causes = _causes(app, row.project_key)
    assert not any(c["code"] in {"OPEN_PROBLEM_REPORT", "TASK_ON_HOLD"} for c in causes)
    orphan = next(c for c in causes if c["code"] == "TASK_PAUSED_WITHOUT_REPORT")
    hold_id = orphan["cause_id"].removeprefix("TASK_PAUSED_WITHOUT_REPORT:")
    assert hold_id and hold_id != orphan["cause_id"]
    assert orphan["report_id"] == report["report_id"]
    assert orphan["assignment_id"] == row.id
    _act(client, report, 2, "resume", [row.id])
    assert not any(
        c["code"] == "TASK_PAUSED_WITHOUT_REPORT"
        for c in _causes(app, row.project_key)
    )


def test_conn_scoped_reads_do_not_open_a_second_transaction(round_work, monkeypatch):
    app, _client, row, _service, _legacy = round_work
    repo = app.state.repo
    opened: list[int] = []
    original = repo.db.engine.begin

    def counting_begin(*args, **kwargs):
        opened.append(1)
        return original(*args, **kwargs)

    with repo.db.transaction() as conn:
        monkeypatch.setattr(repo.db.engine, "begin", counting_begin)
        pid = repo._require_project(conn, row.project_key)
        repo.workflow_causes_in(conn, row.project_key, pid)
        assert conn.execute(select(AssignmentRow.id).limit(1)).first() is not None
    assert opened == []
```

`round_work` is the fixture from `tests/test_assignment_round_open_api.py` used by `tests/test_problem_reports_api.py`; its `client` is the lead who also owns `row`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_final_causes.py -q`
Expected: FAIL with `AttributeError: 'Repository' object has no attribute 'workflow_causes_in'`.

- [ ] **Step 3: Implement**

In `storage/repository.py`:

1. Split `get_work_round` into a conn-scoped core and keep the public method:

```python
    def get_work_round(self, project_key: str, round_id: str) -> WorkRoundView:
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, project_key)
            return self.work_round_in(conn, project_key, project_id, round_id)

    def work_round_in(
        self, conn: Connection, project_key: str, project_id: int, round_id: str
    ) -> WorkRoundView:
        """The round on the caller's connection; the caller has authorized it."""
        # body of the former get_work_round from `row = (` to the final return,
        # unchanged, using the given conn and project_id
```

2. Same split for `get_round_for_submission` into `round_for_submission_in(conn, project_key, project_id, submission_id)`, which calls `self.work_round_in(...)` instead of `self.get_work_round(...)`.

3. Split `list_workflow_causes` into `workflow_causes_in(conn, project_key, project_id)` and keep `list_workflow_causes` as a wrapper. In the new body:
   - Add `"report_id": row.report_id` to each `OPEN_PROBLEM_REPORT` dict.
   - Extend the holds query with `TaskHoldRow.assignment_id` and `ProblemReportStateRow.state.label("report_state")` (join `ProblemReportStateRow.report_id == TaskHoldRow.report_id`), then:

```python
            for held in holds:
                report_open = held.report_state == "open"
                result.append(
                    {
                        "cause_id": held.hold_id
                        if report_open
                        else f"TASK_PAUSED_WITHOUT_REPORT:{held.hold_id}",
                        "cause_revision": 1,
                        "code": "TASK_ON_HOLD"
                        if report_open
                        else "TASK_PAUSED_WITHOUT_REPORT",
                        "case_id": held.case_id,
                        "language": held.language,
                        "document_id": held.document_id,
                        "report_id": held.report_id,
                        "assignment_id": held.assignment_id,
                        "reason": held.reason
                        if report_open
                        else "This task is paused, but its report is resolved.",
                        "destination": f"#/projects/{quote(project_key, safe='')}/problem-reports/{quote(held.report_id, safe='')}",
                    }
                )
```

   `self._variants(project_key)` inside it joins the ambient transaction (`Database.transaction` joins), so it already runs on `conn`; leave it.

4. `ScopedRepository` keeps overriding only the public wrappers; the `*_in` methods are internal and documented as "caller has authorized".

5. In `api/final_result_routes.py` add to `FinalWarning`: `report_id: str | None = None` and `assignment_id: int | None = None`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/test_final_causes.py tests/test_problem_reports.py tests/test_problem_reports_api.py tests/test_final_results.py tests/test_final_warning_relevance.py -q`
Expected: all PASS.

- [ ] **Step 5: Commit point (later, only on request)**

`git add src/ontocurator/storage/repository.py src/ontocurator/api/final_result_routes.py tests/test_final_causes.py` / message `feat: read workflow causes on the caller's connection and derive orphaned pauses`

### Task 1.2: Migration 0014: `selected_at`, stored rule state, round acknowledgement rewrite

**Files:**
- Create: `src/ontocurator/storage/migrations/versions/0014_final_selection_identity.py`
- Modify: `src/ontocurator/storage/final_tables.py`
- Test: `tests/test_final_selection_migration.py` (create)

- [ ] **Step 1: Write the failing test**

```python
"""0014 keeps selections exact and rewrites only round acknowledgement identities."""

import json

from pg_harness import unmigrated_database_url
from sqlalchemy import create_engine, text

from ontocurator.storage.schema import upgrade

ACKS = [
    "SELECTED_ROUND_SUPERSEDED:round-aa:7",
    "SELECTED_ROUND_ABANDONED:round-bb:2",
    "SELECTED_RESULT_REVISED:sub-2",
    "SELECTED_TEXT_CORRECTED:doc/v1:doc/v2",
]


def _seed_project(conn, key, first_event_at):
    pid = conn.execute(text(
        "INSERT INTO ontocurator.projects (project_key, name, manifest, manifest_sha256, task_profile, task_profile_sha256) "
        "VALUES (:k, :k, '{}', 'm', '{}', 't') RETURNING id"
    ), {"k": key}).scalar_one()
    # Valid root first: documents.derived_from has a (project_id, document_id) foreign key.
    conn.execute(text(
        "INSERT INTO ontocurator.documents (project_id, document_id, language, text, case_id, external_id, version, origin, derived_from, translation_status, text_sha256) "
        "VALUES (:pid, 'doc/v1', 'de', 'x', 'c', 'doc', 1, 'machine_translation', NULL, 'accepted', 'h1')"
    ), {"pid": pid})
    conn.execute(text(
        "INSERT INTO ontocurator.documents (project_id, document_id, language, text, case_id, external_id, version, origin, derived_from, translation_status, text_sha256) "
        "VALUES (:pid, 'doc/v2', 'de', 'y', 'c', 'doc', 2, 'correction', 'doc/v1', 'ready_for_review', 'h2')"
    ), {"pid": pid})
    payload = {"case_id": "c", "language": "de", "document_id": "doc/v1", "submission_id": "sub-1"}
    for at in (first_event_at, "2026-10-18T12:00:00Z"):  # second event = reaffirmation of the same choice
        conn.execute(text(
            "INSERT INTO ontocurator.final_selection_events (project_id, payload, created_at) "
            "VALUES (:pid, CAST(:payload AS jsonb), :at)"
        ), {"pid": pid, "payload": json.dumps(payload), "at": at})
    conn.execute(text(
        "INSERT INTO ontocurator.final_selections (project_id, case_id, language, document_id, submission_id, revision, actor_id, acknowledged_cause_ids, updated_at) "
        "SELECT :pid, 'c', 'de', 'doc/v1', 'sub-1', 2, u.id, CAST(:acks AS jsonb), '2026-10-18T12:00:00Z' FROM ontocurator.users u"
    ), {"pid": pid, "acks": json.dumps(ACKS)})
    return pid


def test_0014_backfills_selected_at_per_project_and_rewrites_only_round_acks(tmp_path):
    url = unmigrated_database_url(tmp_path / "final-0014.db")
    upgrade(url, "0013")
    engine = create_engine(url)
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO ontocurator.users (username, display_name, pseudonym) VALUES ('lead', 'Lead', 'lead-0001')"
        ))
        # Identical document ids in two projects; only the project's own events count.
        first = _seed_project(conn, "p1", "2026-10-18T10:00:00Z")
        second = _seed_project(conn, "p2", "2026-10-18T09:00:00Z")
        before_events = conn.execute(text(
            "SELECT id, payload FROM ontocurator.final_selection_events ORDER BY id")).all()
        before_rows = conn.execute(text(
            "SELECT project_id, case_id, language, document_id, submission_id, revision, actor_id, updated_at "
            "FROM ontocurator.final_selections ORDER BY project_id")).all()
    upgrade(url, "0014")
    with engine.begin() as conn:
        rows = {
            row.project_id: row
            for row in conn.execute(text(
                "SELECT project_id, selected_at, adjudicator_not_annotator, acknowledged_cause_ids FROM ontocurator.final_selections"
            ))
        }
        after_events = conn.execute(text(
            "SELECT id, payload FROM ontocurator.final_selection_events ORDER BY id")).all()
        after_rows = conn.execute(text(
            "SELECT project_id, case_id, language, document_id, submission_id, revision, actor_id, updated_at "
            "FROM ontocurator.final_selections ORDER BY project_id")).all()
    assert rows[first].selected_at.isoformat().startswith("2026-10-18T10:00:00")
    assert rows[second].selected_at.isoformat().startswith("2026-10-18T09:00:00")
    for row in rows.values():
        assert row.adjudicator_not_annotator is None
        assert row.acknowledged_cause_ids == sorted([
            "SELECTED_ROUND_SUPERSEDED:round-aa",
            "SELECTED_ROUND_ABANDONED:round-bb",
            "SELECTED_RESULT_REVISED:sub-2",
            # Old 3-part text acks stay as they are (open question 2): no status can be
            # reconstructed, so they never match a 4-part id and each correction asks once more.
            "SELECTED_TEXT_CORRECTED:doc/v1:doc/v2",
        ])
    assert after_events == before_events  # event payloads are immutable history
    assert after_rows == before_rows      # selections keep their exact identity
```

Adjust the `projects`/`documents`/`users` INSERTs to the NOT NULL columns at revision 0013 if one fails on a missing column (check `0001_initial.py` and `0006_variants.py`); do not change the assertions.

The behavioural side (an acknowledgement taken while the correction was `ready_for_review` must not suppress the cause after acceptance) is covered by `test_text_correction_cause_id_carries_status_and_reraises_on_acceptance` in Task 1.3.

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest tests/test_final_selection_migration.py -q`
Expected: FAIL (`Can't locate revision identified by '0014'`).

- [ ] **Step 3: Implement the migration**

```python
"""Final selections: selection time, rule state and stable round acknowledgement ids."""

import json
import re

import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None
SCHEMA = "ontocurator"
_ROUND = re.compile(r"^(SELECTED_ROUND_(?:ABANDONED|SUPERSEDED):[^:]+):\d+$")


def _rewrite(ack: str) -> str:
    """Only round ids lose their workflow revision; every other id is kept verbatim."""
    match = _ROUND.match(ack)
    return match.group(1) if match else ack


def upgrade() -> None:
    op.add_column(
        "final_selections",
        sa.Column("selected_at", sa.DateTime(timezone=True), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "final_selections",
        sa.Column("adjudicator_not_annotator", sa.Boolean(), nullable=True),
        schema=SCHEMA,
    )
    conn = op.get_bind()
    selections = conn.execute(sa.text(
        f"SELECT id, project_id, case_id, language, document_id, submission_id, updated_at, acknowledged_cause_ids FROM {SCHEMA}.final_selections"
    )).all()
    for sel in selections:
        # Events are scoped by project: document ids are only unique per project.
        events = conn.execute(sa.text(
            f"SELECT payload, created_at FROM {SCHEMA}.final_selection_events "
            "WHERE project_id = :pid AND payload->>'case_id' = :case AND payload->>'language' = :lang ORDER BY id"
        ), {"pid": sel.project_id, "case": sel.case_id, "lang": sel.language}).all()
        selected_at = sel.updated_at
        previous = None
        for event in events:
            current = (event.payload.get("document_id"), event.payload.get("submission_id"))
            if current != previous:
                selected_at = event.created_at
                previous = current
        if previous != (sel.document_id, sel.submission_id):
            selected_at = sel.updated_at
        acks = sorted({_rewrite(a) for a in sel.acknowledged_cause_ids})
        conn.execute(sa.text(
            f"UPDATE {SCHEMA}.final_selections SET selected_at = :at, acknowledged_cause_ids = CAST(:acks AS jsonb) WHERE id = :id"
        ), {"at": selected_at, "acks": json.dumps(acks), "id": sel.id})
    op.alter_column("final_selections", "selected_at", nullable=False, server_default=sa.func.now(), schema=SCHEMA)


def downgrade() -> None:
    raise NotImplementedError("Migrations are forward-only")
```

In `storage/final_tables.py` add to `FinalSelectionRow`:

```python
    selected_at: Mapped[datetime] = mapped_column(server_default=func.now())
    adjudicator_not_annotator: Mapped[bool | None]
```

- [ ] **Step 4: Run the tests**

Run: `uv run pytest tests/test_final_selection_migration.py tests/test_schema.py -q`
Expected: PASS (`test_the_migration_creates_exactly_the_mapped_tables` confirms the mapping matches).

- [ ] **Step 5: Commit point (later)**

Files: migration, `final_tables.py`, test. Message: `feat: store selection time and rule state, stabilise acknowledgement ids`.

### Task 1.3: `final_causes.derive_final_state` with the new cause rules

**Files:**
- Create: `src/ontocurator/application/final_causes.py`
- Modify: `src/ontocurator/application/final_results.py` (`_authorize`, `_projection` delegate)
- Test: `tests/test_final_causes.py` (extend)

- [ ] **Step 1: Write the failing tests** (append to `tests/test_final_causes.py`)

```python
from test_annotation_versions import seed_submission
from test_case_api import BASE, CORRECTED, SOURCE, TARGET
from test_case_api import case_env as case_env

from ontocurator.application.final_causes import ACKNOWLEDGEABLE_CODES
from ontocurator.storage.tables import DocumentRow, TranslationReviewRow


def _select(env, document, sid, revision=0, acks=()):
    response = env.lead.put(f"{BASE}/final-selections", json={
        "document_id": document, "submission_id": sid,
        "expected_revision": revision, "acknowledged_cause_ids": list(acks),
    })
    assert response.status_code == 200, response.text
    return response.json()


def _warnings(env, code):
    state = env.lead.get(f"{BASE}/workflow-warnings").json()
    return [w for w in state["warnings"] if w["code"] == code]


def test_acknowledgeable_codes_are_the_five_selection_codes():
    assert ACKNOWLEDGEABLE_CODES == {
        "SELECTED_ROUND_ABANDONED", "SELECTED_ROUND_SUPERSEDED",
        "SELECTED_RESULT_REVISED", "SELECTED_TEXT_CORRECTED", "SELECTED_NEWER_RESULT",
    }


def test_submission_recorded_after_selection_raises_newer_result(case_env):
    env = case_env
    seed_submission(env, "alice", "first", document=TARGET)
    _select(env, TARGET, "first")
    assert _warnings(env, "SELECTED_NEWER_RESULT") == []
    seed_submission(env, "alice", "later", document=CORRECTED)
    newer = _warnings(env, "SELECTED_NEWER_RESULT")
    assert [w["cause_id"] for w in newer] == ["SELECTED_NEWER_RESULT:later"]
    assert newer[0]["document_id"] == CORRECTED


def test_text_correction_cause_id_carries_status_and_reraises_on_acceptance(case_env):
    env = case_env
    seed_submission(env, "alice", "german", document=TARGET)
    _select(env, TARGET, "german")
    first = _warnings(env, "SELECTED_TEXT_CORRECTED")
    status = _status(env, CORRECTED)
    assert [w["cause_id"] for w in first] == [
        f"SELECTED_TEXT_CORRECTED:{TARGET}:{CORRECTED}:{status}"
    ]
    _select(env, TARGET, "german", revision=1, acks=[first[0]["cause_id"]])
    assert _warnings(env, "SELECTED_TEXT_CORRECTED") == []
    _set_status(env, CORRECTED, "accepted")
    again = _warnings(env, "SELECTED_TEXT_CORRECTED")
    assert [w["cause_id"] for w in again] == [
        f"SELECTED_TEXT_CORRECTED:{TARGET}:{CORRECTED}:accepted"
    ]


def test_rejected_or_queried_correction_raises_no_text_cause(case_env):
    env = case_env
    seed_submission(env, "alice", "german", document=TARGET)
    _select(env, TARGET, "german")
    for decision in ("rejected", "query"):
        _set_status(env, CORRECTED, "reviewed")
        _add_review(env, CORRECTED, decision)
        assert _warnings(env, "SELECTED_TEXT_CORRECTED") == []


def _status(env, document):
    with env.db.transaction() as conn:
        return conn.execute(
            select(DocumentRow.translation_status).where(DocumentRow.document_id == document)
        ).scalar_one() or "native"


def _set_status(env, document, status):
    from sqlalchemy import update
    with env.db.transaction() as conn:
        conn.execute(update(DocumentRow).where(DocumentRow.document_id == document).values(translation_status=status))


def _add_review(env, document, decision):
    # tests/tests_support_reviews.py is created in Step 3.
    from tests_support_reviews import insert_review

    insert_review(env.db, "proj", document, decision)
```

Also add, using the `rounds` fixture pattern from `tests/test_final_warning_relevance.py`, a test that a selected result whose round becomes `superseded` raises `SELECTED_ROUND_SUPERSEDED:{round_id}` (no revision part), that after acknowledging it, placing a hold, resuming and reopening the assignment does **not** raise it again (the id is unchanged), and that `TASK_PAUSED_WITHOUT_REPORT` and `ROUND_REVIEW_PENDING` ids are rejected by reaffirmation with 409:

```python
def test_round_cause_id_is_stable_across_hold_resume_and_reopen(rounds):
    # Build exactly as test_final_warning_relevance.test_empty_carry_forward_is_pending_until_immutable_submission
    # up to a submitted round A, select A's submission, create carry-forward round B
    # (A becomes superseded), then:
    state = service.preflight("proj")
    ids = [w["cause_id"] for w in state["warnings"] if w["code"] == "SELECTED_ROUND_SUPERSEDED"]
    assert ids == [f"SELECTED_ROUND_SUPERSEDED:{round_a.round_id}"]
    service.select("proj", document, submission, 1, ids)
    # report + resolve + resume on the assignment (ProblemReportService.report/act)
    # and AssignmentService reopen; after each step:
    assert not [w for w in service.preflight("proj")["warnings"] if w["code"] == "SELECTED_ROUND_SUPERSEDED"]
```

Write it out fully by copying the setup from `test_final_warning_relevance.py::test_empty_carry_forward_is_pending_until_immutable_submission`; keep the three assertions above verbatim.

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_final_causes.py -q`
Expected: FAIL (`ModuleNotFoundError: ontocurator.application.final_causes`).

- [ ] **Step 3: Implement `final_causes.py`**

Create a small test helper `tests/tests_support_reviews.py` with `insert_review(db, project_key, document_id, decision)` that inserts a `TranslationReviewRow` with all NOT NULL columns (copy values from the existing review service tests). Then implement:

```python
"""The single cause derivation for Documents and the final export preflight.

Runs on the caller's connection. Callers authorize first: Documents with the
shared project lock, preflight/select/freeze with the exclusive one.
"""

from typing import Any
from urllib.parse import quote

from sqlalchemy import Connection, func, select

from ontocurator.application.workflow_warnings import project_warnings
from ontocurator.auth.audit import Actor
from ontocurator.authz.policy import Action
from ontocurator.authz.project_authority import require_project_management
from ontocurator.authz.scoped import project_not_found
from ontocurator.domain.workspace import WorkspaceKey
from ontocurator.storage.final_tables import FinalSelectionRow
from ontocurator.storage.repository import Repository, _key_str, _lock_id
from ontocurator.storage.tables import (
    AssignmentRow, DocumentRow, DraftRow, SubmissionRow,
    TranslationReviewDraftRow, TranslationReviewRow,
)
from ontocurator.storage.workflow_tables import WorkRoundRow, WorkRoundStateRow

ACKNOWLEDGEABLE_CODES = frozenset({
    "SELECTED_ROUND_ABANDONED", "SELECTED_ROUND_SUPERSEDED",
    "SELECTED_RESULT_REVISED", "SELECTED_TEXT_CORRECTED", "SELECTED_NEWER_RESULT",
})
NOT_NEWER_DECISIONS = frozenset({"rejected", "query"})


def authorize_final_results(conn: Connection, actor: Actor, key: str, *, exclusive: bool) -> int:
    conn.execute(select(func.pg_advisory_xact_lock_shared(_lock_id("members", key))))
    lock = func.pg_advisory_xact_lock if exclusive else func.pg_advisory_xact_lock_shared
    conn.execute(select(lock(_lock_id("project", key))))
    pid = Repository._project_id(conn, key)
    if pid is None:
        raise project_not_found(key)
    require_project_management(conn, actor, key, pid, Action.EXPORT_ALL_WORK)
    return pid


def latest_review_decisions(conn: Connection, pid: int) -> dict[str, str]:
    """document_id -> decision of its latest translation review."""
    rows = conn.execute(
        select(TranslationReviewRow.document_id, TranslationReviewRow.decision)
        .where(TranslationReviewRow.project_id == pid)
        .distinct(TranslationReviewRow.document_id)
        .order_by(TranslationReviewRow.document_id, TranslationReviewRow.created_at.desc(), TranslationReviewRow.id.desc())
    ).all()
    return {row.document_id: row.decision for row in rows}


def corrects_selected_text(status: str | None, decision: str | None) -> bool:
    """Whether a correction of the selected version asks the lead to confirm.

    Open question 1: an accepted_corrected parent (status reviewed) is skipped
    because its accepted child raises the cause.
    """
    if decision in NOT_NEWER_DECISIONS:
        return False
    return not (status == "reviewed" and decision == "accepted_corrected")


def derive_final_state(conn: Connection, repo: Repository, key: str, pid: int) -> dict[str, Any]:
    # 1. Move the whole body of FinalResultService._projection here.
    # 2. Replace self.repo.list_workflow_causes(key) with repo.workflow_causes_in(conn, key, pid)
    #    and self.repo.get_round_for_submission(key, sid) with
    #    repo.round_for_submission_in(conn, key, pid, sid).
    # 3. Apply the cause changes below.
    ...
```

Cause changes inside the `for row in rows:` loop (row = `FinalSelectionRow` mapping, now including `selected_at`):

```python
        decisions = latest_review_decisions(conn, pid)   # once, before the loop
        status_of = {item["document_id"]: item["translation_status"] for item in inventory}
        # (add DocumentRow.translation_status to the inventory select)

        # SELECTED_ROUND_*: identity without workflow revision, revision fixed.
        cause_id = f"{code}:{round_view.round_id}"
        ... "cause_revision": 1,

        # SELECTED_RESULT_REVISED: unchanged; remember its subject.
        revised_subjects: set[str] = set()
        if round_view and round_view.latest_submission_id and round_view.latest_submission_id != row["submission_id"]:
            revised_subjects.add(round_view.latest_submission_id)
            ... existing append when not acknowledged ...

        # SELECTED_TEXT_CORRECTED: status in id; skip not-newer corrections.
        for descendant in sorted(descendants - {row["document_id"]}):
            status = status_of[descendant]
            if not corrects_selected_text(status, decisions.get(descendant)):
                continue
            cause_id = f"SELECTED_TEXT_CORRECTED:{row['document_id']}:{descendant}:{status or 'native'}"
            ... "cause_revision": 1, "document_id": descendant ...

        # SELECTED_NEWER_RESULT: any version of the row, recorded after selected_at.
        row_documents = [i["document_id"] for i in inventory if i["case_id"] == row["case_id"] and i["language"] == row["language"]]
        newer = conn.execute(
            select(SubmissionRow.submission_id, SubmissionRow.document_id)
            .where(
                SubmissionRow.project_id == pid,
                SubmissionRow.document_id.in_(row_documents),
                SubmissionRow.recorded_at > row["selected_at"],
                SubmissionRow.submission_id != row["submission_id"],
            )
            .order_by(SubmissionRow.recorded_at, SubmissionRow.submission_id)
        ).all()
        for item in newer:
            if item.submission_id in revised_subjects:   # open question 7
                continue
            cause_id = f"SELECTED_NEWER_RESULT:{item.submission_id}"
            if cause_id in row["acknowledged_cause_ids"]:
                continue
            causes.append({
                "code": "SELECTED_NEWER_RESULT", "cause_id": cause_id, "cause_revision": 1,
                "case_id": row["case_id"], "language": row["language"],
                "document_id": item.document_id,
                "reason": "A result was submitted after the final result was chosen. The final selection remains unchanged.",
                "destination": destination(row["case_id"], item.document_id),
            })
```

Note `revised_subjects` must be computed for **all** REVISED subjects of the row, acknowledged or not, before the NEWER loop. `selected` (the public `selections` list) keeps exactly the five fields so `state_digest` semantics are unchanged.

In `final_results.py`: `_authorize` becomes `return authorize_final_results(conn, self.actor, key, exclusive=exclusive)`; `_projection` becomes `return derive_final_state(conn, self.repo, key, pid)`; the reaffirmation filter uses `warning["code"] in ACKNOWLEDGEABLE_CODES`. Remove the moved imports.

- [ ] **Step 4: Run tests**

Run: `uv run pytest tests/test_final_causes.py tests/test_final_results.py tests/test_final_warning_relevance.py tests/test_workflow_warnings.py tests/test_final_export.py tests/test_final_human_export.py -q`
Expected: PASS. If `test_language_slots_coexist...` asserted the 3-part TEXT_CORRECTED id, update only the id expectation to the 4-part form.

- [ ] **Step 5: Commit point (later)**

Message: `feat: one conn-scoped final cause derivation with newer-result and status-aware correction causes`.

### Task 1.4: `select()` stores `selected_at`, rule state; returns the summary; conflict details

**Files:**
- Modify: `src/ontocurator/application/final_results.py:97-212`
- Modify: `src/ontocurator/api/final_result_routes.py` (`FinalSelectionView`)
- Test: `tests/test_final_causes.py` (extend)

- [ ] **Step 1: Failing tests**

```python
def test_selected_at_survives_reaffirmation_and_changes_on_replacement(case_env):
    env = case_env
    seed_submission(env, "alice", "one", document=TARGET)
    seed_submission(env, "alice", "two", document=TARGET, timestamp="2026-10-16T11:00:00Z")
    first = _select(env, TARGET, "one")
    assert first["selected_at"] and first["updated_at"] and first["selected_by"] == _pseudonym(env, "leader")
    cause = _warnings(env, "SELECTED_TEXT_CORRECTED")[0]
    kept = _select(env, TARGET, "one", revision=1, acks=[cause["cause_id"]])
    assert kept["selected_at"] == first["selected_at"]
    assert kept["updated_at"] >= first["updated_at"]
    replaced = _select(env, TARGET, "two", revision=2)
    assert replaced["selected_at"] > first["selected_at"]
    assert replaced["adjudicator_not_annotator"] is False


def test_revision_conflict_names_who_changed_the_selection(case_env):
    env = case_env
    seed_submission(env, "alice", "one", document=TARGET)
    _select(env, TARGET, "one")
    stale = env.lead.put(f"{BASE}/final-selections", json={
        "document_id": TARGET, "submission_id": "one", "expected_revision": 0})
    assert stale.status_code == 409
    details = stale.json()["details"]
    assert details["current_revision"] == 1
    assert details["selected_by"] == _pseudonym(env, "leader")
    assert details["updated_at"]


def _pseudonym(env, username):
    return env.app.state.accounts.get_by_username(username).pseudonym


def _keep(env, acks, revision):
    return env.lead.put(f"{BASE}/final-selections", json={
        "document_id": TARGET, "submission_id": "one", "expected_revision": revision,
        "acknowledged_cause_ids": acks})


def test_keep_requires_the_exact_current_warning_set(case_env):
    """Spec 'Inline confirmation' > Conflict: the set captured at open must still be the set."""
    env = case_env
    seed_submission(env, "alice", "one", document=TARGET)
    _select(env, TARGET, "one")
    opened = {w["cause_id"] for w in _warnings(env, "SELECTED_TEXT_CORRECTED")}
    assert opened
    # Addition: a newer submission appears after the confirm opened.
    seed_submission(env, "alice", "later", document=TARGET, timestamp="2026-10-17T10:00:00Z")
    added = _keep(env, sorted(opened), 1)
    assert added.status_code == 409, added.text
    current = {w["cause_id"] for w in env.lead.get(f"{BASE}/workflow-warnings").json()["warnings"]
               if w["code"] in ACKNOWLEDGEABLE_CODES and w["language"] == "de"}
    # Status change: the correction moves on, so its id (which carries the status) changes.
    _set_status(env, CORRECTED, "accepted")
    changed = _keep(env, sorted(current), 1)
    assert changed.status_code == 409
    # Removal: the correction is rejected in review, so its cause disappears.
    current = {w["cause_id"] for w in env.lead.get(f"{BASE}/workflow-warnings").json()["warnings"]
               if w["code"] in ACKNOWLEDGEABLE_CODES and w["language"] == "de"}
    _set_status(env, CORRECTED, "reviewed")
    _add_review(env, CORRECTED, "rejected")
    removed = _keep(env, sorted(current), 1)
    assert removed.status_code == 409
    # Exact set: succeeds and clears every acknowledgeable cause of the row.
    exact = {w["cause_id"] for w in env.lead.get(f"{BASE}/workflow-warnings").json()["warnings"]
             if w["code"] in ACKNOWLEDGEABLE_CODES and w["language"] == "de"}
    assert _keep(env, sorted(exact), 1).status_code == 200
    assert not [w for w in env.lead.get(f"{BASE}/workflow-warnings").json()["warnings"]
                if w["code"] in ACKNOWLEDGEABLE_CODES and w["language"] == "de"]
```

The status-change and removal steps rely on `_set_status`/`_add_review` from Task 1.3. If the `case_env` data gives no cause for one of the three changes, build it the same way Task 1.3's tests do; keep one assertion per change (addition, removal, status change) and the final exact-set success.

Check the 409 body shape in `api/app.py` (`RevisionConflict` handler, around line 334) and adapt `stale.json()["details"]` to the actual key carrying details; keep the asserted fields.

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_final_causes.py -k "selected_at or conflict_names or exact_current" -q`
Expected: FAIL (`KeyError: 'selected_at'`).

- [ ] **Step 3: Implement**

In `select()`:

```python
            rule = conn.execute(
                select(ProjectRow.adjudicator_not_annotator).where(ProjectRow.id == pid)
            ).scalar_one()
            if expected_revision != (old["revision"] if old else 0):
                raise RevisionConflict({
                    "current_revision": old["revision"] if old else 0,
                    "selected_by": _pseudonym(conn, old["actor_id"]) if old else None,
                    "updated_at": old["updated_at"].isoformat() if old else None,
                })
            same = bool(old and old["document_id"] == document and old["submission_id"] == submission)
            now = datetime.now(UTC)
            values = {
                ...existing...,
                "updated_at": now,
                "selected_at": old["selected_at"] if same else now,
                "adjudicator_not_annotator": rule,
            }
            result = {
                name: values[name]
                for name in ("case_id", "language", "document_id", "submission_id", "revision", "selected_at", "updated_at", "adjudicator_not_annotator")
            } | {"selected_by": _pseudonym(conn, self.actor.user_id)}
            event = {**result_without_datetimes, "actor_id": ..., "acknowledged_cause_ids": ..., "adjudicator_not_annotator": rule,
                     "selected_at": values["selected_at"].isoformat()}
```

with module helper:

```python
def _pseudonym(conn: Connection, user_id: int) -> str:
    return conn.execute(select(UserRow.pseudonym).where(UserRow.id == user_id)).scalar_one()
```

Event payloads and audit details must stay JSON-serialisable (`isoformat()`).

**Exact warning set (review finding 1).** Replace the subset check in the `if acknowledged_cause_ids:` branch (`final_results.py:135-161` today) by an exact comparison, still under the exclusive lock:

```python
                available = {
                    warning["cause_id"]
                    for warning in self._projection(conn, key, pid)["warnings"]
                    if warning["code"] in ACKNOWLEDGEABLE_CODES
                    and warning["case_id"] == doc.case_id
                    and warning["language"] == doc.language
                }
                if set(acknowledged_cause_ids) != available:
                    raise RevisionConflict({
                        "current_revision": old["revision"],
                        "selected_by": _pseudonym(conn, old["actor_id"]),
                        "updated_at": old["updated_at"].isoformat(),
                        "reason": "warnings_changed",
                    })
```

`available` holds the row's acknowledgeable causes that are raised now (already acknowledged ids are filtered by `derive_final_state`), so the client must send the complete set it showed when the confirm opened (Task 5.8). Additions, removals and status changes (the status is part of the `SELECTED_TEXT_CORRECTED` id) all fail with 409. A PUT with an empty list keeps its current meaning (re-save without acknowledging). Keep the existing merge with `old["acknowledged_cause_ids"]` after the check.

`FinalSelectionView` gains optional fields (preflight `selections` keep only the five):

```python
class FinalSelectionView(BaseModel):
    case_id: str
    language: str
    document_id: str
    submission_id: str
    revision: int
    selected_at: datetime | None = None
    updated_at: datetime | None = None
    selected_by: str | None = None
    adjudicator_not_annotator: bool | None = None
```

- [ ] **Step 4: Run** `uv run pytest tests/test_final_causes.py tests/test_final_results.py -q` (Expected: PASS).

- [ ] **Step 5: Commit point (later)**: `feat: record selection time and rule state on every final selection`.

### Task 1.5: `OWN_RESULT_NOT_SELECTABLE`

**Files:**
- Modify: `src/ontocurator/application/final_results.py`, `src/ontocurator/api/app.py` (409 map), `src/ontocurator/domain/admin_error_codes.py`, `contracts/admin-error-codes.json` (regenerated), `frontend/src/admin/errors.ts`
- Test: `tests/test_final_causes.py`

- [ ] **Step 1: Failing test**

```python
def test_lead_cannot_choose_or_keep_own_result_when_rule_is_on(case_env):
    from sqlalchemy import update

    from ontocurator.storage.tables import ProjectRow

    env = case_env
    seed_submission(env, "leader", "own", document=TARGET)
    seed_submission(env, "alice", "other", document=TARGET)
    with env.db.transaction() as conn:
        conn.execute(update(ProjectRow).where(ProjectRow.project_key == "proj").values(adjudicator_not_annotator=True))
    refused = env.lead.put(f"{BASE}/final-selections", json={
        "document_id": TARGET, "submission_id": "own", "expected_revision": 0})
    assert refused.status_code == 409
    assert refused.json()["code"] == "OWN_RESULT_NOT_SELECTABLE"
    assert _select(env, TARGET, "other")["adjudicator_not_annotator"] is True
    with env.db.transaction() as conn:
        conn.execute(update(ProjectRow).where(ProjectRow.project_key == "proj").values(adjudicator_not_annotator=False))
    own = _select(env, TARGET, "own", revision=1)
    assert own["adjudicator_not_annotator"] is False
    with env.db.transaction() as conn:
        conn.execute(update(ProjectRow).where(ProjectRow.project_key == "proj").values(adjudicator_not_annotator=True))
    # Toggling the rule later neither invalidates nor hides the earlier decision.
    state = env.lead.get(f"{BASE}/workflow-warnings").json()
    assert any(s["submission_id"] == "own" for s in state["selections"])
    cause = _warnings(env, "SELECTED_TEXT_CORRECTED")[0]
    keep = env.lead.put(f"{BASE}/final-selections", json={
        "document_id": TARGET, "submission_id": "own", "expected_revision": 2,
        "acknowledged_cause_ids": [cause["cause_id"]]})
    assert keep.status_code == 409 and keep.json()["code"] == "OWN_RESULT_NOT_SELECTABLE"
```

`seed_submission(env, "leader", ...)` uses the lead's pseudonym as `annotator_id`, which is how "own" is defined.

- [ ] **Step 2: Run** `uv run pytest tests/test_final_causes.py -k own_result -q`; Expected FAIL (200 instead of 409).

- [ ] **Step 3: Implement** in `select()` after the `exact` lookup (select `SubmissionRow.annotator_id` too):

```python
            if rule and exact.annotator_id == _pseudonym(conn, self.actor.user_id):
                raise DomainError(
                    "OWN_RESULT_NOT_SELECTABLE",
                    "This project keeps adjudication separate from annotation. Another lead must choose this result.",
                )
```

Add `"OWN_RESULT_NOT_SELECTABLE": 409` to the map in `api/app.py`, insert `"OWN_RESULT_NOT_SELECTABLE"` in sorted position in `ADMIN_ERROR_CODES`, run `uv run python scripts/export_admin_error_codes.py`, and add to `frontend/src/admin/errors.ts`: `OWN_RESULT_NOT_SELECTABLE: "This project keeps adjudication separate from annotation. Another lead must choose this result.",`.

- [ ] **Step 4: Run** `uv run pytest tests/test_final_causes.py tests/test_admin_error_codes.py -q` and `uv run python scripts/export_admin_error_codes.py --check`; Expected PASS / "up-to-date".

- [ ] **Step 5: Commit point (later)**: `feat: refuse own results as final while adjudication is separated`.

### Task 1.6: Phase 1 contract checks

**Files:** Test: `tests/test_final_causes.py`

- [ ] **Step 1: Write the contract tests**

```python
def test_reaffirmation_refuses_non_acknowledgeable_cause_ids(round_work):
    app, client, row, _service, _legacy = round_work
    report = _report(client, row)
    _act(client, report, 1, "resolve")
    orphan = next(c for c in _causes(app, row.project_key) if c["code"] == "TASK_PAUSED_WITHOUT_REPORT")
    # Select any submission of row.document_id first (seed one like test_annotation_versions.seed_submission
    # with the fixture's project key), then:
    refused = client.put(f"/api/v1/projects/{row.project_key}/final-selections", json={
        "document_id": row.document_id, "submission_id": sid, "expected_revision": 1,
        "acknowledged_cause_ids": [orphan["cause_id"]]})
    assert refused.status_code == 409


def test_no_selection_changes_without_an_explicit_put(case_env):
    env = case_env
    seed_submission(env, "alice", "one", document=TARGET)
    _select(env, TARGET, "one")
    before = env.lead.get(f"{BASE}/workflow-warnings").json()["selections"]
    seed_submission(env, "alice", "newer", document=TARGET, timestamp="2026-10-17T10:00:00Z")
    env.lead.post(f"{BASE}/exports/final/preflight")
    assert env.lead.get(f"{BASE}/workflow-warnings").json()["selections"] == before
```

`ROUND_REVIEW_PENDING` refusal is already covered by `tests/test_final_warning_relevance.py::test_pending_consolidation_warns_until_submit_and_invalidates_acknowledgement`; add one assertion there that a PUT acknowledging the `ROUND_REVIEW_PENDING` cause id returns 409.

- [ ] **Step 2: Run** `uv run pytest tests/test_final_causes.py tests/test_final_warning_relevance.py -q`; Expected PASS.
- [ ] **Step 3: WP gate (B4)**: `uv run ruff check . && uv run ruff format --check . && uv run mypy src`, then `uv run pytest tests/test_final_causes.py tests/test_final_results.py tests/test_final_warning_relevance.py tests/test_final_export.py tests/test_admin_error_codes.py -q`. Do not regenerate OpenAPI here: `FinalWarning`/`FinalSelectionView` drift is expected and is regenerated once by B9.
- [ ] **Step 4: Commit point (later)**: `test: final selection contracts for acknowledgement and explicit choice`.

---

## Phase 2: Read API

WPs: B5 = 2.1, B6 = 2.2a, B7 = 2.2b, B8 = 2.2c, B9 = 2.4 + 2.6 (2.5 belongs to B1 because it writes `storage/repository.py`).

Outcome: `GET /api/v1/projects/{key}/document-rows` and `GET /api/v1/projects/{key}/document-rows/{case}/{language}/submissions`, lead-only, under the shared project lock, using `derive_final_state`; `VersionRef.kind = "submission"` for leads; regenerated contracts.

### Task 2.1: Pure row rules (`domain/document_rows.py`)

**Files:**
- Create: `src/ontocurator/domain/document_rows.py`
- Test: `tests/test_document_rows_domain.py`

- [ ] **Step 1: Failing tests**

```python
"""Pure Documents row rules (no database)."""

from ontocurator.domain.document_rows import (
    AssignmentFact, Version, bar_categories, bar_counts, build_chains, bulk_target,
    missing_final_counts, open_target, prefix_matches, round_ordinals, submission_kind,
    translation_issue, version_label,
)


def v(doc, version=1, origin="machine_translation", derived=None, status="accepted",
      run=None, external="ext", position=1, decision=None):
    return Version(document_id=doc, case_id="c", language="de", external_id=external,
                   version=version, origin=origin, derived_from=derived,
                   translation=run, translation_status=status, position=position,
                   latest_decision=decision)


def test_chain_names_versions_and_duplicates():
    a = v("a", run={"provider": "DeepL", "model": "v3"}, external="x")
    b = v("b", run={"provider": "DeepL", "model": "v3"}, external="y", position=2)
    corr = v("a2", 2, "correction", "a", "ready_for_review", external="x")
    chains = build_chains([a, b, corr])
    assert [c.name for c in chains] == ["DeepL v3 · x", "DeepL v3 · y"]
    assert chains[0].newest.document_id == "a2"
    assert version_label(chains[0], corr, parallel=True) == "DeepL v3 · x v2"
    assert version_label(chains[0], corr, parallel=False) == "v2"
    native = build_chains([v("s", origin="native", status=None)])
    assert native[0].name == "Source"
    human = build_chains([v("h", origin="human_translation")])
    assert human[0].name == "Human translation"
    provider_only = build_chains([v("p", run={"provider": "Google"})])
    assert provider_only[0].name == "Google"


def a(status="submitted", held=False, revoked=False, task="annotate", doc="a"):
    return AssignmentFact(assignment_id=1, document_id=doc, task=task, status=status,
                          held=held, revoked=revoked, pseudonym="ann-1", user_id=1,
                          active_round_id=None)


def test_missing_final_rule():
    assert not missing_final_counts(has_selection=True, submission_count=1, assignments=[a()])
    assert not missing_final_counts(has_selection=False, submission_count=0, assignments=[a()])
    assert missing_final_counts(has_selection=False, submission_count=1, assignments=[])
    assert missing_final_counts(has_selection=False, submission_count=1, assignments=[a(), a(status="open", revoked=True)])
    assert not missing_final_counts(has_selection=False, submission_count=1, assignments=[a(held=True)])
    assert not missing_final_counts(has_selection=False, submission_count=1,
                                    assignments=[a(), a(status="open", task="translation_review", doc="b")])


def test_translation_issue_and_bulk_target():
    root = v("r", status="accepted")
    rejected = v("r2", 2, "correction", "r", "reviewed", decision="rejected")
    chain = build_chains([root, rejected])
    assert translation_issue(chain[0]) == "rejected"
    assert bulk_target(chain) == ("r", "checkbox")
    review = build_chains([root, v("r2", 2, "correction", "r", "ready_for_review")])
    assert bulk_target(review) == (None, "choose_in_versions")
    failed = build_chains([v("f", status="automatic_check_failed")])
    assert translation_issue(failed[0]) == "automatic_check_failed"
    parallel = build_chains([v("p1"), v("p2", external="z", position=2)])
    assert bulk_target(parallel) == (None, "choose_in_versions")


def test_open_target():
    chains = build_chains([v("p1", position=1), v("p2", external="z", position=5),
                           v("p2b", 2, "correction", "p2", "accepted", external="z", position=6)])
    assert open_target(chains, final_document_id=None) == ("p2b", "most_recent_root")
    assert open_target(chains, final_document_id="p1") == ("p1", "final")
    single = build_chains([v("s1"), v("s2", 2, "correction", "s1", "accepted")])
    assert open_target(single, final_document_id=None) == ("s2", "newest")


def test_round_ordinals_and_kinds():
    rounds = [("r3", "r2"), ("r1", None), ("r2", "r1"), ("x1", None)]
    assert round_ordinals(rounds) == {"r1": 1, "r2": 2, "r3": 3, "x1": 1}
    assert submission_kind("consolidation", "review") == "consolidation"
    assert submission_kind("carry_forward", "independent") == "carry_forward"
    assert submission_kind("ordinary", "independent") == "annotation"
    assert submission_kind(None, "review") == "review"


def test_bar_categories_counts_and_prefix():
    one = bar_categories({"OPEN_PROBLEM_REPORT", "SELECTED_NEWER_RESULT"}, translation_failed=False, missing_final=False)
    two = bar_categories({"TASK_PAUSED_WITHOUT_REPORT"}, translation_failed=True, missing_final=True)
    notes = bar_categories({"ROUND_REVIEW_PENDING", "SOURCE_UPDATE_UNREVIEWED", "TASK_ON_HOLD"}, translation_failed=False, missing_final=False)
    assert one == {"report-or-pause", "confirm-final"}
    assert notes == set()
    assert bar_counts([one, two, notes]) == {"total": 2, "report-or-pause": 2, "confirm-final": 1, "translation": 1, "missing-final": 1}
    assert prefix_matches("ｃａｓｅ-0", ["case-0042"])
    assert not prefix_matches("0042", ["case-0042"])
```

- [ ] **Step 2: Run** `uv run pytest tests/test_document_rows_domain.py -q`; Expected FAIL (module missing).

- [ ] **Step 3: Implement**

```python
"""Pure rules of the lead's Documents table. A row is (case_id, language)."""

from __future__ import annotations

import unicodedata
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

BarCategory = Literal["report-or-pause", "confirm-final", "translation", "missing-final"]
CATEGORIES: tuple[BarCategory, ...] = ("report-or-pause", "confirm-final", "translation", "missing-final")
ACKNOWLEDGEABLE = frozenset({"SELECTED_ROUND_ABANDONED", "SELECTED_ROUND_SUPERSEDED",
                             "SELECTED_RESULT_REVISED", "SELECTED_TEXT_CORRECTED", "SELECTED_NEWER_RESULT"})
NOT_NEWER = frozenset({"rejected", "query"})


@dataclass(frozen=True)
class Version:
    document_id: str
    case_id: str
    language: str
    external_id: str
    version: int
    origin: str
    derived_from: str | None
    translation: Mapping[str, Any] | None
    translation_status: str | None
    position: int | None
    latest_decision: str | None = None

    @property
    def not_newer(self) -> bool:
        return self.origin == "correction" and self.translation_status == "reviewed" and self.latest_decision in NOT_NEWER


@dataclass(frozen=True)
class Chain:
    root_id: str
    name: str
    versions: tuple[Version, ...]  # ascending version

    @property
    def root(self) -> Version:
        return self.versions[0]

    @property
    def newest(self) -> Version:
        return self.versions[-1]


@dataclass(frozen=True)
class AssignmentFact:
    assignment_id: int
    document_id: str
    task: str
    status: str
    held: bool
    revoked: bool
    pseudonym: str
    user_id: int
    active_round_id: str | None


def base_chain_name(root: Version) -> str:
    if root.origin == "native":
        return "Source"
    if root.origin == "human_translation":
        return "Human translation"
    run = root.translation or {}
    provider = str(run.get("provider") or "").strip()
    model = str(run.get("model") or "").strip()
    return f"{provider} {model}".strip() if provider else "Machine translation"


def build_chains(versions: Sequence[Version]) -> list[Chain]:
    by_id = {item.document_id: item for item in versions}

    def root(item: Version) -> Version:
        seen: set[str] = set()
        while item.origin == "correction":
            if item.document_id in seen or item.derived_from not in by_id:
                raise ValueError(f"Invalid correction ancestry for {item.document_id}")
            seen.add(item.document_id)
            item = by_id[item.derived_from]
        return item

    groups: dict[str, list[Version]] = {}
    for item in versions:
        groups.setdefault(root(item).document_id, []).append(item)
    names = {rid: base_chain_name(by_id[rid]) for rid in groups}
    counts = Counter(names.values())
    chains = [
        Chain(rid, names[rid] if counts[names[rid]] == 1 else f"{names[rid]} · {by_id[rid].external_id}",
              tuple(sorted(items, key=lambda x: x.version)))
        for rid, items in groups.items()
    ]
    return sorted(chains, key=lambda c: (c.root.position is None, c.root.position or 0, c.root_id))


def version_label(chain: Chain, version: Version, *, parallel: bool) -> str:
    return f"{chain.name} v{version.version}" if parallel else f"v{version.version}"


def missing_final_counts(*, has_selection: bool, submission_count: int, assignments: Iterable[AssignmentFact]) -> bool:
    if has_selection or submission_count == 0:
        return False
    return all(item.status == "submitted" and not item.held for item in assignments if not item.revoked)


def translation_issue(chain: Chain) -> Literal["automatic_check_failed", "rejected", "query"] | None:
    newest = chain.newest
    if newest.translation_status == "automatic_check_failed":
        return "automatic_check_failed"
    if newest.translation_status == "reviewed" and newest.latest_decision in NOT_NEWER:
        return newest.latest_decision  # type: ignore[return-value]
    return None


def bulk_target(chains: Sequence[Chain]) -> tuple[str | None, Literal["checkbox", "choose_in_versions"]]:
    if len(chains) != 1:
        return None, "choose_in_versions"
    target = [item for item in chains[0].versions if not item.not_newer][-1]
    if target.origin == "correction" and target.translation_status == "ready_for_review":
        return None, "choose_in_versions"
    return target.document_id, "checkbox"


def open_target(chains: Sequence[Chain], *, final_document_id: str | None) -> tuple[str, Literal["final", "newest", "most_recent_root"]]:
    if final_document_id is not None:
        return final_document_id, "final"
    if len(chains) == 1:
        return chains[0].newest.document_id, "newest"
    latest = max(chains, key=lambda c: (c.root.position or -1, c.root_id))  # open question 3
    return latest.newest.document_id, "most_recent_root"


def round_ordinals(rounds: Iterable[tuple[str, str | None]]) -> dict[str, int]:
    predecessor = dict(rounds)
    result: dict[str, int] = {}
    for rid in predecessor:
        path: list[str] = []
        current: str | None = rid
        while current is not None and current in predecessor and current not in result:
            path.append(current)
            current = predecessor[current]
        base = result.get(current, 0) if current is not None else 0
        for offset, item in enumerate(reversed(path), start=1):
            result[item] = base + offset
    return result


def submission_kind(round_kind: str | None, mode: str) -> Literal["consolidation", "carry_forward", "annotation", "review"]:
    if round_kind == "consolidation":
        return "consolidation"
    if round_kind == "carry_forward":
        return "carry_forward"
    return "review" if mode == "review" else "annotation"


def bar_categories(codes: Iterable[str], *, translation_failed: bool, missing_final: bool) -> set[BarCategory]:
    present = set(codes)
    result: set[BarCategory] = set()
    if present & {"OPEN_PROBLEM_REPORT", "TASK_PAUSED_WITHOUT_REPORT"}:
        result.add("report-or-pause")
    if present & ACKNOWLEDGEABLE:
        result.add("confirm-final")
    if translation_failed:
        result.add("translation")
    if missing_final:
        result.add("missing-final")
    return result


def bar_counts(rows: Iterable[set[BarCategory]]) -> dict[str, int]:
    counts: dict[str, int] = {"total": 0, **{c: 0 for c in CATEGORIES}}
    for categories in rows:
        counts["total"] += bool(categories)
        for category in categories:
            counts[category] += 1
    return counts


def prefix_matches(q: str, identifiers: Iterable[str]) -> bool:
    prefix = unicodedata.normalize("NFKC", q)
    return any(unicodedata.normalize("NFKC", item).startswith(prefix) for item in identifiers)
```

**Shared primitive split.** Put `round_ordinals` and `submission_kind` (bodies as above) in `src/ontocurator/domain/submission_labels.py` with a module docstring "Round ordinals and submission kinds shared by Documents and the editor history"; `domain/document_rows.py` imports and re-exports them (`from ontocurator.domain.submission_labels import round_ordinals, submission_kind` plus `__all__`), so the test import above stays valid. Sibling plans import from `submission_labels`.

`ACKNOWLEDGEABLE` duplicates `final_causes.ACKNOWLEDGEABLE_CODES` deliberately to keep `domain/` free of application imports; the equality assertion `assert ACKNOWLEDGEABLE_CODES == domain.document_rows.ACKNOWLEDGEABLE` goes into `tests/test_document_rows_facts.py` (B6), because B5 may run before `final_causes.py` exists.

- [ ] **Step 4: Run** `uv run pytest tests/test_document_rows_domain.py -q` and `uv run mypy src`; Expected PASS / no errors.
- [ ] **Step 5: Commit point (later)**: `feat: pure Documents row rules`.

### Task 2.2a: Facts loader and service (`application/document_rows.py`) [WP B6]

The former Task 2.2 is split in three (review finding 9): 2.2a loads facts on one connection and owns the service; 2.2b builds rows and pages from facts (pure, no SQL); 2.2c builds the submissions view. The interface between them is `RowFacts` below. 2.2b and 2.2c can run in parallel after 2.2a.

**Files:**
- Create: `src/ontocurator/application/document_rows.py` (`RowQuery`, `RowFacts` and its fact dataclasses, `load_facts`, `load_last_activity`, `DocumentRowsService`)
- Create stubs (ownership passes on): `src/ontocurator/application/document_row_page.py` with `def build_page(facts: RowFacts, query: RowQuery) -> dict[str, Any]: raise NotImplementedError` (→ B7); `src/ontocurator/application/document_row_submissions.py` with `def build_submissions(conn: Connection, key: str, pid: int, case_id: str, language: str, viewer_user_id: int) -> dict[str, Any]: raise NotImplementedError` (→ B8)
- Create: `tests/document_rows_support.py` (shared test helpers `service(env, username="leader")`, `rows_of(page)`), `tests/test_document_rows_facts.py`

Data the loader reads, all on one connection after `authorize_final_results(conn, actor, key, exclusive=False)`:

| Fact | Source |
|---|---|
| versions | `DocumentRow` (document_id, case_id, language, external_id, version, origin, derived_from, translation, translation_status, position, status_reason) plus `latest_review_decisions()` |
| accepted without review | latest `AuditEventRow` per accepted document with action `variant.status_override` (same query as `api/document_projection.py:287-306`) |
| assignments | non-revoked and revoked `AssignmentRow` joined to `UserRow` (pseudonym, user_id), with `held`, `active_round_id` |
| rounds | `WorkRoundRow` + `WorkRoundStateRow` (state, latest_submission_id, predecessor) |
| submission counts | number of `SubmissionRow` per document |
| selected submissions | `SubmissionRow` + `RoundSubmissionBindingRow` for the submissions named by `final_selections` (annotator_id, document_id, recorded_at, mode, round_id) |
| open translation reviews | `AssignmentRow` task `translation_review`, not revoked, status != submitted, with reviewer pseudonym |
| reports | `ProblemReportRow` + state, reporter pseudonym, first 120 characters of `reason`, task held state via active `TaskHoldRow` for the report's assignment |
| final state | `derive_final_state(conn, repo, key, pid)` |
| selections | `FinalSelectionRow` full rows + actor pseudonym (`selected_by`) |
| last activity | `load_last_activity(conn, pid)`: one `union_all` of the sources in spec "Last activity", grouped by document; final selection `updated_at` per (case, language) |
| source language | not `ProjectRow.languages`: the source-language row is the row whose versions include an `origin == "native"` root |
| current project rule | `ProjectRow.adjudicator_not_annotator` (the rule **now**; the selection-time snapshot stays on each selection) |
| viewer | `UserRow.pseudonym` of the actor |

Interface (field names are binding for B7/B8; types may be refined, report any change):

```python
@dataclass(frozen=True)
class RoundFact:
    round_id: str; assignment_id: int; predecessor_round_id: str | None; document_id: str
    kind: str | None; mode: str | None; state: str; latest_submission_id: str | None; author_pseudonym: str

@dataclass(frozen=True)
class SubmissionFact:
    submission_id: str; document_id: str; annotator_id: str; recorded_at: datetime; mode: str; round_id: str | None

@dataclass(frozen=True)
class ReportFact:
    report_id: str; assignment_id: int | None; excerpt: str; reporter_label: str; created_at: datetime
    task_state: Literal["paused", "resumed"]

@dataclass(frozen=True)
class RowFacts:
    project_key: str
    viewer_user_id: int
    viewer_pseudonym: str
    adjudicator_not_annotator: bool                       # current project rule
    versions: list[rules.Version]
    accepted_without_review: frozenset[str]               # document ids
    assignments: list[rules.AssignmentFact]               # revoked included
    rounds: list[RoundFact]
    submission_counts: dict[str, int]                     # document_id -> count
    selected_submissions: dict[str, SubmissionFact]       # submission_id -> fact
    open_translation_reviews: list[tuple[int, str, str]]  # (assignment_id, document_id, reviewer pseudonym)
    reports: dict[str, ReportFact]
    final_state: dict[str, Any]                           # derive_final_state output
    selections: dict[tuple[str, str], dict[str, Any]]     # (case, language) -> row + selected_by
    last_activity: dict[str, datetime]                    # document_id -> latest
    selection_activity: dict[tuple[str, str], datetime]   # (case, language) -> updated_at
```

```python
"""Lead-only Documents read model. Shared project lock; causes from final_causes."""

PAGE_SIZE = 50
Decision = Literal["all", "report-or-pause", "confirm-final", "translation", "missing-final"]
MAX_RETAIN = 200


@dataclass(frozen=True)
class RowQuery:
    language: str | None = None
    status: str | None = None          # unassigned|open|in_progress|submitted|reopened|held
    q: str | None = None
    origin: str | None = None
    translation_status: str | None = None  # adds accepted_without_review
    decision: Decision | None = None
    final: Literal["missing"] | None = None
    case: str | None = None
    page: int = 1
    retain: tuple[str, ...] = ()       # "{case_id}:{language}" keys kept visible this visit (Task 5.9)

    def __post_init__(self) -> None:
        if self.decision is not None and self.final is not None:
            raise ValueError("decision and final are mutually exclusive")
        if self.page < 1:
            raise ValueError("page starts at 1")
        if len(self.retain) > MAX_RETAIN:
            raise ValueError("too many retained rows")


class DocumentRowsService:
    def __init__(self, db, actor, access):
        self.db, self.actor, self.access = db, actor, access
        self.repo = ScopedRepository(db, access, actor)

    def page(self, key: str, query: RowQuery) -> dict[str, Any]:
        with self.db.transaction() as conn:
            pid = authorize_final_results(conn, self.actor, key, exclusive=False)
            facts = load_facts(conn, self.repo, key, pid, self.actor.user_id)
            return build_page(facts, query)

    def submissions(self, key: str, case_id: str, language: str) -> dict[str, Any]:
        with self.db.transaction() as conn:
            pid = authorize_final_results(conn, self.actor, key, exclusive=False)
            return build_submissions(conn, key, pid, case_id, language, self.actor.user_id)
```

A `retain` key splits at the **last** `:` (case ids may contain `:`; language codes do not).

- [ ] **Step 1: Failing tests** (`tests/test_document_rows_facts.py`; helpers in `tests/document_rows_support.py`)

```python
"""Documents facts loader: one connection, shared lock, complete facts."""

from document_rows_support import service
from test_annotation_versions import seed_submission
from test_case_api import BASE, CASE, CORRECTED, SOURCE, TARGET
from test_case_api import case_env as case_env

from ontocurator.application import document_rows as rows_module
from ontocurator.application.document_rows import RowQuery, load_facts
from ontocurator.application.final_causes import ACKNOWLEDGEABLE_CODES, authorize_final_results
from ontocurator.domain import document_rows as domain_rows


def test_acknowledgeable_codes_match_the_domain_copy():
    assert ACKNOWLEDGEABLE_CODES == domain_rows.ACKNOWLEDGEABLE


def test_documents_takes_only_the_shared_project_lock(case_env, monkeypatch):
    calls = []
    original = rows_module.authorize_final_results

    def spy(conn, actor, key, *, exclusive):
        calls.append(exclusive)
        return original(conn, actor, key, exclusive=exclusive)

    monkeypatch.setattr(rows_module, "authorize_final_results", spy)
    monkeypatch.setattr(rows_module, "build_page", lambda facts, query: {})
    monkeypatch.setattr(rows_module, "build_submissions", lambda *args: {})
    service(case_env).page("proj", RowQuery())
    service(case_env).submissions("proj", CASE, "de")
    assert calls == [False, False]


def test_facts_cover_versions_selection_rule_and_activity(case_env):
    env = case_env
    seed_submission(env, "alice", "german", document=TARGET)
    env.lead.put(f"{BASE}/final-selections", json={"document_id": TARGET, "submission_id": "german", "expected_revision": 0})
    svc = service(env)
    with env.db.transaction() as conn:
        pid = authorize_final_results(conn, svc.actor, "proj", exclusive=False)
        facts = load_facts(conn, svc.repo, "proj", pid, svc.actor.user_id)
    assert {v.document_id for v in facts.versions} >= {SOURCE, TARGET, CORRECTED}
    assert facts.submission_counts[TARGET] == 1
    assert facts.selected_submissions["german"].document_id == TARGET
    assert facts.adjudicator_not_annotator is False
    assert facts.last_activity[TARGET] >= facts.selected_submissions["german"].recorded_at
    assert (CASE, "de") in facts.selection_activity


def test_retain_keys_are_bounded_and_mutual_exclusion_holds():
    import pytest
    with pytest.raises(ValueError):
        RowQuery(decision="all", final="missing")
    with pytest.raises(ValueError):
        RowQuery(retain=tuple(f"c{i}:de" for i in range(201)))
```

`Access(user_id, pseudonym, is_system_admin, {project: roles})` is the same construction `tests/test_final_warning_relevance.py` uses for `FinalResultService`; `service()` in `document_rows_support.py` builds it that way (if `accounts.get_by_username` returns a different shape, take `user_id`/`pseudonym` as that file does).

- [ ] **Step 2: Run** `uv run pytest tests/test_document_rows_facts.py -q`; Expected FAIL (module missing).
- [ ] **Step 3: Implement** the loader and service. One SQL statement per fact row of the table; no query per row or per document.
- [ ] **Step 4: Run** `uv run pytest tests/test_document_rows_facts.py tests/test_final_causes.py -q` and `uv run mypy src`; Expected PASS.
- [ ] **Step 5: Commit point (later)**: `feat: Documents facts loader on the shared lock`.

### Task 2.2b: Page builder (`application/document_row_page.py`) [WP B7]

**Files:** Own `src/ontocurator/application/document_row_page.py` (replace the stub); Test `tests/test_document_rows_page.py`. Read only: `application/document_rows.py` (`RowFacts`, `RowQuery`), `domain/document_rows.py`. Every rule lives in `domain/document_rows.py`; this module only assembles.

- [ ] **Step 1: Failing tests**

```python
"""Documents page: rows, bar, filters, paging, retained rows (service level)."""

import pytest
from document_rows_support import rows_of, service
from test_annotation_versions import seed_submission
from test_case_api import BASE, CASE, CORRECTED, SOURCE, TARGET
from test_case_api import case_env as case_env
from sqlalchemy import update

from ontocurator.application.document_rows import RowQuery
from ontocurator.storage.tables import ProjectRow

# Cause codes the export preflight emits per row (MISSING_FINAL_SELECTION is unconditional
# in the preflight and replaced by the Documents-only MISSING_FINAL rule).
SHARED_CAUSE_CODES = frozenset({
    "OPEN_PROBLEM_REPORT", "TASK_ON_HOLD", "TASK_PAUSED_WITHOUT_REPORT",
    "SOURCE_UPDATE_UNREVIEWED", "ROUND_REVIEW_PENDING",
    "SELECTED_ROUND_ABANDONED", "SELECTED_ROUND_SUPERSEDED", "SELECTED_RESULT_REVISED",
    "SELECTED_TEXT_CORRECTED", "SELECTED_NEWER_RESULT",
})
DOCUMENTS_ONLY_CODES = frozenset({
    "TRANSLATION_CHECK_FAILED", "TRANSLATION_NOT_ACCEPTED", "REVIEWER_NEEDED", "MISSING_FINAL",
})


def test_one_row_per_text_and_language_with_chain_and_final(case_env):
    env = case_env
    seed_submission(env, "alice", "german", document=TARGET)
    env.lead.put(f"{BASE}/final-selections", json={"document_id": TARGET, "submission_id": "german", "expected_revision": 0})
    page = service(env).page("proj", RowQuery())
    rows = rows_of(page)
    assert set(rows) >= {(CASE, "en"), (CASE, "de")}
    de = rows[(CASE, "de")]
    assert [v["document_id"] for v in de["versions"]] == [TARGET, CORRECTED]
    assert de["parallel_roots"] is False
    assert de["final"]["submission_id"] == "german" and de["final"]["version"] == 1
    assert de["final"]["author_label"] == env.app.state.accounts.get_by_username("alice").pseudonym
    assert any(i["code"] == "SELECTED_TEXT_CORRECTED" for i in de["issues"])
    assert page["groups"][0]["rows"][0]["language"] == "en"  # source language first


def test_shared_cause_ids_equal_the_preflight_per_row(case_env):
    env = case_env
    seed_submission(env, "alice", "german", document=TARGET)
    env.lead.put(f"{BASE}/final-selections", json={"document_id": TARGET, "submission_id": "german", "expected_revision": 0})
    preflight = env.lead.post(f"{BASE}/exports/final/preflight").json()
    emitted = {w["code"] for w in preflight["warnings"]} - {"MISSING_FINAL_SELECTION"}
    assert emitted <= SHARED_CAUSE_CODES, emitted - SHARED_CAUSE_CODES  # extend the set if the preflight grows
    expected: dict = {}
    for w in preflight["warnings"]:
        if w["code"] in SHARED_CAUSE_CODES:
            expected.setdefault((w["case_id"], w["language"]), set()).add(w["cause_id"])
    page = service(env).page("proj", RowQuery())
    actual = {
        key: {i["cause_id"] for i in row["issues"] + row["notes"] if i["code"] in SHARED_CAUSE_CODES}
        for key, row in rows_of(page).items()
    }
    assert {k: v for k, v in actual.items() if v} == expected


def test_documents_only_items_are_derived_here_and_absent_from_the_preflight(case_env):
    env = case_env
    seed_submission(env, "alice", "english", document=SOURCE)  # en: submission, no final, no open work
    preflight_codes = {w["code"] for w in env.lead.post(f"{BASE}/exports/final/preflight").json()["warnings"]}
    assert not preflight_codes & DOCUMENTS_ONLY_CODES
    en = rows_of(service(env).page("proj", RowQuery()))[(CASE, "en")]
    missing = [i for i in en["issues"] if i["code"] == "MISSING_FINAL"]
    assert [i["cause_id"] for i in missing] == [f"MISSING_FINAL:{CASE}:en"]
    assert missing[0]["category"] == "missing-final"
    # REVIEWER_NEEDED note: CORRECTED is ready_for_review without a translation_review assignment.
    de = rows_of(service(env).page("proj", RowQuery()))[(CASE, "de")]
    assert any(n["code"] == "REVIEWER_NEEDED" for n in de["notes"])


def test_current_rule_is_exposed_separately_from_the_selection_snapshot(case_env):
    env = case_env
    seed_submission(env, "leader", "own", document=TARGET)
    env.lead.put(f"{BASE}/final-selections", json={"document_id": TARGET, "submission_id": "own", "expected_revision": 0})
    with env.db.transaction() as conn:
        conn.execute(update(ProjectRow).where(ProjectRow.project_key == "proj").values(adjudicator_not_annotator=True))
    page = service(env).page("proj", RowQuery())
    assert page["adjudicator_not_annotator"] is True                      # rule now
    de = rows_of(page)[(CASE, "de")]
    assert de["final"]["adjudicator_not_annotator"] is False              # rule at selection time
    assert de["final"]["is_mine"] is True


def test_bar_counts_are_project_wide_and_ignore_filters(case_env):
    env = case_env
    seed_submission(env, "alice", "english", document=SOURCE)
    all_rows = service(env).page("proj", RowQuery())
    filtered = service(env).page("proj", RowQuery(language="fr"))
    assert all_rows["bar"] == {**filtered["bar"], "shown": all_rows["bar"]["shown"]}
    assert filtered["bar"]["shown"] <= filtered["bar"]["total"]


def test_case_deep_link_keeps_row_visible_and_unknown_case_is_reported(case_env):
    page = service(case_env).page("proj", RowQuery(case=CASE, language="de", decision="confirm-final"))
    pinned = rows_of(page)[(CASE, "de")]
    assert pinned["pinned"] is True and pinned["matches_decision"] is False
    assert service(case_env).page("proj", RowQuery(case="nope"))["case_found"] is False


def test_retained_rows_return_with_current_data_when_they_stop_matching(case_env):
    env = case_env
    seed_submission(env, "alice", "english", document=SOURCE)
    before = rows_of(service(env).page("proj", RowQuery(decision="missing-final")))
    assert (CASE, "en") in before
    env.lead.put(f"{BASE}/final-selections", json={"document_id": SOURCE, "submission_id": "english", "expected_revision": 0})
    plain = rows_of(service(env).page("proj", RowQuery(decision="missing-final")))
    assert (CASE, "en") not in plain
    kept = rows_of(service(env).page("proj", RowQuery(decision="missing-final", retain=(f"{CASE}:en",))))
    row = kept[(CASE, "en")]
    assert row["retained"] is True and row["matches_decision"] is False
    assert row["final"]["submission_id"] == "english" and row["categories"] == []


@pytest.mark.parametrize("q", ["source/id", "ｓｏｕｒｃｅ/id"])
def test_q_matches_case_external_or_document_prefix_with_nfkc(case_env, q):
    page = service(case_env).page("proj", RowQuery(q=q))
    assert (CASE, "en") in rows_of(page)
```

The bar test compares everything except `shown`, which depends on filters by definition. Add further tests in the same style (each one assertion block, all in this file):
- missing-final: with a submission and an open assignment the row has `missing_final.counts is False` and `reason == "work_open"`; after the assignment is submitted `counts is True`; with no submission `reason == "no_submission"`.
- paging: seed 51 cases with **one** `run_import` call (see `tests/t1_builders.py`), `RowQuery(page=2)` returns exactly one group, `page_count == 2`, groups ordered by lowest `position` then `case_id`.
- filters select rows, never narrow content: `RowQuery(origin="correction")` returns the `de` row with both versions and only `CORRECTED` has `matches_filter`.
- last activity: after `seed_submission`, the row's `last_activity_at` equals that submission's `recorded_at`; the group's equals the max of its rows.
- retained rows respect non-decision filters: a retained key whose row does not match `language` is not returned.

- [ ] **Step 2: Run** `uv run pytest tests/test_document_rows_page.py -q`; Expected FAIL (`NotImplementedError`).

- [ ] **Step 3: Implement** `build_row(facts, case_id, language)` and `build_page(facts, query)`.

`build_row` produces, per row (field names are the API contract of Task 2.4):

```python
{
  "case_id", "language", "is_source": bool, "position": min position,
  "versions": [ {"document_id","external_id","version","origin","derived_from","chain_id","chain_name",
                 "translation_status","accepted_without_review","latest_review_decision",
                 "is_newest_in_chain","matches_filter","last_activity_at"} ],
  "parallel_roots": len(chains) > 1,
  "work": [ {"assignment_id","document_id","version","author_label","is_me","task","status","held",
             "round_ordinal","round_state"} ],          # non-revoked only
  "final": None | {"case_id","language","document_id","submission_id","revision","selected_at","updated_at",
                   "selected_by","kind","round_ordinal","author_label","is_mine","version","chain_name","recorded_at",
                   "is_newest_of_chain","adjudicator_not_annotator"},   # snapshot at selection time
  "issues": [...], "notes": [...],      # items: {"code","cause_id","cause_revision","document_id","category",
                                        #  "version","review_decision","report","report_id","assignment_id","author_label"}
  "missing_final": {"counts": bool, "reason": None|"no_submission"|"work_open"},
  "categories": sorted(bar categories),
  "bulk": {"document_id", "mode"},            # rules.bulk_target
  "open": {"document_id", "reason", "label"}, # rules.open_target + version label
  "own_open_assignment_id": int|None,         # viewer's non-submitted, non-revoked assignment on the row
  "last_activity_at": datetime|None,
  "pinned": bool, "retained": bool, "matches_decision": bool,
}
```

`is_mine` = the final submission's `annotator_id` equals the viewer's pseudonym. The UI decides Use/Keep availability from the page-level current rule plus `is_mine` (Task 5.8), never from the snapshot.

Issue items:
- From `facts.final_state["warnings"]` for the row, excluding `MISSING_FINAL_SELECTION` (the preflight's unconditional one) and `ROUND_REVIEW_PENDING` (a waiting line, delivered as a note with `category: None`).
- `OPEN_PROBLEM_REPORT` gets `report = {"report_id","excerpt","reporter_label","created_at","task_state": "paused"|"resumed"}`.
- `TASK_ON_HOLD` stays a note with `report_id` (also for holds from `extend_hold` on another row).
- `TASK_PAUSED_WITHOUT_REPORT` gets `author_label` of the held assignment.
- `SOURCE_UPDATE_UNREVIEWED` is a note (already filtered by `derive_final_state`).
- Derived (Documents only, never in the preflight): `TRANSLATION_CHECK_FAILED` / `TRANSLATION_NOT_ACCEPTED` per chain (`rules.translation_issue`), category `translation`, `cause_id = f"{code}:{newest.document_id}"`; `REVIEWER_NEEDED` note when the newest version is a correction with `ready_for_review` and no non-revoked `translation_review` assignment; `MISSING_FINAL` issue only when `missing_final.counts`, category `missing-final`, `cause_id = f"MISSING_FINAL:{case}:{language}"`.

`build_page`:
1. Build all rows; compute `categories` per row and `bar = rules.bar_counts(...)`, add `no_final = count(rows without final)`.
2. Row matches filters when any version matches (`language` exact; `origin`; `translation_status` or `accepted_without_review`; `q` via `rules.prefix_matches(q, [case_id, *external_ids, *document_ids])`; `status` against the row's non-revoked assignments: `unassigned` = none, `held` = any held, else any with that status). Mark `versions[].matches_filter`.
3. Decision filter: `decision == "all"` keeps rows with categories; a category keeps rows containing it; `final == "missing"` keeps rows without a selection. `bar["shown"]` = rows with categories that match the non-decision filters.
4. `retain`: a row whose key is in `query.retain` and that matches the non-decision filters is kept even when it fails the decision filter, with `retained: true` and its current `matches_decision`. Unknown keys are ignored.
5. `case`: restrict to that `case_id` (exact); if `language` also given, that row is `pinned` and always kept (with `matches_decision` false when it does not match); `case_found = any row has case_id`.
6. Group by `case_id`; within a group, source row first then language code; groups ordered by lowest `position` (None last) then `case_id`; page by `PAGE_SIZE` groups (groups that contain only retained rows count like other groups); return `{"groups": [{"case_id","rows","language_count","final_count","issue_count","note_count","last_activity_at","has_issue"}], "page","page_count","group_count","bar","case_found","adjudicator_not_annotator"}`. `language_count`/`final_count` count all languages of the text, not only shown rows.

- [ ] **Step 4: Run** `uv run pytest tests/test_document_rows_page.py tests/test_document_rows_domain.py -q` and `uv run mypy src`; Expected PASS.
- [ ] **Step 5: Commit point (later)**: `feat: Documents page builder with shared cause projection`.

### Task 2.2c: Submissions builder (`application/document_row_submissions.py`) [WP B8]

Former Task 2.3 merged here.

**Files:** Own `src/ontocurator/application/document_row_submissions.py` (replace the stub); Test `tests/test_document_rows_submissions.py`. Read only: `domain/submission_labels.py`, `domain/document_rows.py` (`build_chains`, `version_label`).

`build_submissions(conn, key, pid, case_id, language, viewer_user_id)` returns `{"case_id","language","adjudicator_not_annotator","submissions":[...],"rounds":[...],"open_translation_reviews":[...]}`:
- `adjudicator_not_annotator`: the current project rule (same meaning as on the page).
- submissions of all versions of the row, oldest `recorded_at` first: `submission_id, document_id, version, chain_name (only when parallel roots), author_label, is_me, recorded_at, mode, kind (submission_labels.submission_kind), round_id, round_ordinal, round_state, is_latest_in_round (None when the round holds one submission), finding_count` (`jsonb_array_length(payload->'snapshots')`).
- rounds (excluding `mode is None` translation-review rounds): `round_id, assignment_id, predecessor_round_id, document_id, version, kind, mode, state, author_label, round_ordinal, submitted` (`latest_submission_id is not None`).
- open translation reviews: `assignment_id, document_id, version, reviewer_label`.
- Raise `DomainError("CASE_NOT_FOUND")` when the row has no versions.
- Runs its own queries on `conn` (the caller already holds the shared lock); it does not call `load_facts`.

- [ ] **Step 1: Failing tests**

```python
"""Documents submissions view (service level)."""

from document_rows_support import service
from test_annotation_versions import seed_submission
from test_case_api import CASE, SOURCE
from test_case_api import case_env as case_env


def test_submissions_cover_all_versions_with_kinds_ordinals_and_counts(rounds):
    # Reuse create_consolidation_fixture(rounds) from tests/test_work_rounds.py:
    # two independent submissions + one consolidation on the same document.
    fixture = create_consolidation_fixture(rounds)
    result = DocumentRowsService(...).submissions(fixture.project, fixture.case_id, fixture.language)
    kinds = [s["kind"] for s in result["submissions"]]
    assert kinds.count("annotation") == 2 and kinds[-1] == "consolidation"
    assert all(s["round_ordinal"] == 1 for s in result["submissions"] if s["kind"] == "annotation")
    assert [s["recorded_at"] for s in result["submissions"]] == sorted(s["recorded_at"] for s in result["submissions"])
    assert all(isinstance(s["finding_count"], int) for s in result["submissions"])
    assert all(r["mode"] is not None for r in result["rounds"])
    assert isinstance(result["adjudicator_not_annotator"], bool)


def test_submission_without_round_has_no_ordinal(case_env):
    seed_submission(case_env, "alice", "loose", document=SOURCE)
    result = service(case_env).submissions("proj", CASE, "en")
    loose = next(s for s in result["submissions"] if s["submission_id"] == "loose")
    assert loose["round_id"] is None and loose["round_ordinal"] is None
    assert loose["finding_count"] == 0


def test_unknown_row_is_case_not_found(case_env):
    import pytest
    from ontocurator.domain.errors import DomainError
    with pytest.raises(DomainError):
        service(case_env).submissions("proj", "missing-case", "de")
```

Fill in the service construction for the `rounds` fixture as in `tests/test_final_warning_relevance.py`; `create_consolidation_fixture` returns the identities you need (read its return statement).

- [ ] **Step 2: Run** `uv run pytest tests/test_document_rows_submissions.py -q`; Expected FAIL (`NotImplementedError`).
- [ ] **Step 3: Implement** `build_submissions`.
- [ ] **Step 4: Run** the file and `uv run mypy src`; Expected PASS.
- [ ] **Step 5: Commit point (later)**: `feat: Documents submissions read model`.

### Task 2.4: Routes and response models [WP B9]

**Files:**
- Create: `src/ontocurator/api/document_row_routes.py`
- Modify: `src/ontocurator/api/app.py` (include router next to `final_result_router`)
- Test: `tests/test_document_rows_api.py`

- [ ] **Step 1: Failing HTTP tests**

```python
def test_routes_are_lead_only_and_validate_query(case_env):
    env = case_env
    assert env.alice.get(f"{BASE}/document-rows").status_code in (403, 404)
    ok = env.lead.get(f"{BASE}/document-rows", params={"decision": "all", "page": 1})
    assert ok.status_code == 200, ok.text
    assert set(ok.json()) >= {"groups", "page", "page_count", "group_count", "bar", "case_found", "adjudicator_not_annotator"}
    retained = env.lead.get(f"{BASE}/document-rows", params=[("decision", "all"), ("retain", f"{CASE}:de"), ("retain", f"{CASE}:en")])
    assert retained.status_code == 200, retained.text
    assert env.lead.get(f"{BASE}/document-rows", params={"decision": "all", "final": "missing"}).status_code == 422
    assert env.lead.get(f"{BASE}/document-rows", params={"decision": "nope"}).status_code == 422
    sub = env.lead.get(f"{BASE}/document-rows/{quote(CASE, safe='')}/de/submissions")
    assert sub.status_code == 200, sub.text
    assert env.alice.get(f"{BASE}/document-rows/{quote(CASE, safe='')}/de/submissions").status_code in (403, 404)
    assert env.lead.get(f"{BASE}/document-rows/missing-case/de/submissions").status_code == 404
```

- [ ] **Step 2: Run**; Expected FAIL (404 for unknown route).

- [ ] **Step 3: Implement** pydantic models mirroring the dicts of Tasks 2.2b and 2.2c (names: `DocumentVersionView`, `WorkItemView`, `ReportIssueView`, `RowItemView`, `FinalSelectionSummary`, `MissingFinalView`, `BulkTargetView`, `OpenTargetView`, `DocumentRowView`, `DocumentGroupView`, `DecisionBarView` (`total`, `report_or_pause`, `confirm_final`, `translation`, `missing_final`, `no_final`, `shown`), `DocumentRowsPage` (with top-level `adjudicator_not_annotator: bool`, the current rule), `RowSubmissionView`, `RowRoundView`, `OpenTranslationReviewView`, `RowSubmissions` (with `adjudicator_not_annotator: bool`)). `FinalSelectionSummary` keeps `adjudicator_not_annotator` as the selection-time snapshot and adds `is_mine: bool`; `DocumentRowView` adds `retained: bool`. Use `Literal` types for `kind`, `category`, `mode`, `reason`. Map the hyphenated categories to underscore keys in `DecisionBarView`. Routes:

```python
router = APIRouter(prefix="/api/v1/projects/{key}", tags=["documents"], route_class=EncodedParameterRoute)


@router.get("/document-rows", response_model=DocumentRowsPage)
def document_rows(
    key: str, principal: PrincipalDep, request: Request,
    language: str | None = None, status: AssignmentFilter | None = None, q: str | None = None,
    origin: VariantOrigin | None = None,
    translation_status: TranslationStatus | Literal["accepted_without_review"] | None = None,
    decision: Literal["all", "report-or-pause", "confirm-final", "translation", "missing-final"] | None = None,
    final: Literal["missing"] | None = None, case: str | None = None, page: int = Query(1, ge=1),
    retain: list[str] = Query(default_factory=list, max_length=200),
) -> dict[str, Any]:
    if decision is not None and final is not None:
        raise RequestValidationError([{"loc": ("query", "final"), "msg": "decision and final are mutually exclusive", "type": "value_error"}])
    return _service(request, principal).page(key, RowQuery(language=language, status=status, q=q, origin=origin,
        translation_status=translation_status, decision=decision, final=final, case=case, page=page,
        retain=tuple(retain)))


@router.get("/document-rows/{case_id:path}/{language}/submissions", response_model=RowSubmissions)
def row_submissions(key: str, case_id: str, language: str, principal: PrincipalDep, request: Request) -> dict[str, Any]:
    return _service(request, principal).submissions(key, case_id, language)
```

`_service` mirrors `final_result_routes._service`. Check how other routes raise 422 for cross-field query validation in this codebase (search `RequestValidationError`); prefer the existing pattern.

- [ ] **Step 4: Run** `uv run pytest tests/test_document_rows_api.py -q`; Expected PASS.
- [ ] **Step 5: Commit point (later)**: `feat: lead-only document-rows endpoints`.

Note for B9: the HTTP 403/404, 422 and `retain` tests live in `tests/test_document_rows_api.py`; service-level tests stay in the B6/B7/B8 files. Import `quote`, `BASE`, `CASE`, `case_env` at the top of the new file.

### Task 2.5: `VersionRef` kind `submission` for leads [WP B1]

**Files:**
- Modify: `src/ontocurator/authz/versions.py` (`VersionRef.kind`, `visible_annotation_versions`)
- Modify: `src/ontocurator/storage/repository.py:2000-2062` (`get_annotation_version`)
- Test: `tests/test_annotation_versions.py`

- [ ] **Step 1: Failing test**

```python
def test_leads_see_every_submission_as_a_submission_ref_and_others_do_not(case_env):
    env = case_env
    seed_submission(env, "alice", "alice-1")
    lead_refs = refs(env.lead, SOURCE)
    assert any(r["kind"] == "submission" and r["id"] == "alice-1" for r in lead_refs)
    fetched = env.lead.get(path(SOURCE, "annotation-versions/submission/alice-1"))
    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["ref"]["kind"] == "submission"
    for client in (env.alice, env.reviewer):
        assert not any(r["kind"] == "submission" for r in refs(client, SOURCE))
        assert client.get(path(SOURCE, "annotation-versions/submission/alice-1")).status_code == 404
    # Non-lead history keeps its own path (review finding 8): the author opens an old
    # submission through the `own` ref, without broadened permissions.
    assert any(r["kind"] == "own" and r["id"] == "alice-1" for r in refs(env.alice, SOURCE))
    assert env.alice.get(path(SOURCE, "annotation-versions/own/alice-1")).status_code == 200
    assert env.reviewer.get(path(SOURCE, "annotation-versions/own/alice-1")).status_code == 404
```

- [ ] **Step 2: Run** `uv run pytest tests/test_annotation_versions.py -k submission_ref -q`; Expected FAIL.

- [ ] **Step 3: Implement**: `kind: Literal["own", "proposals", "stage_result", "release", "submission"]`; in `visible_annotation_versions`, after the own refs, when `can(fresh, Action.EXPORT_ALL_WORK, key)`, append one ref per submission of the document (all authors), `label=f"{row.annotator_id} · {row.recorded_at.isoformat()}"`, `created_at=row.recorded_at`, ordered by `recorded_at`. In `Repository.get_annotation_version`, treat `kind in {"own", "submission"}` identically.

- [ ] **Step 4: Run** `uv run pytest tests/test_annotation_versions.py tests/test_case_api.py -q`; Expected PASS.
- [ ] **Step 5: Commit point (later)**: `feat: lead submission refs for the case viewer`.

### Task 2.6: Regenerate contracts and frontend client [WP B9]

**Files:** `contracts/openapi.json`, `frontend/src/api/generated.ts`, `frontend/src/api/client.ts`, test `frontend/tests/documents/client.test.ts`

- [ ] **Step 1: Regenerate**: `uv run python scripts/export_openapi.py` then `npm --prefix frontend run api:generate`.
- [ ] **Step 2: Failing client test**

```ts
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../src/api/client";

afterEach(() => vi.restoreAllMocks());

it("serialises document-row filters including repeated-free params and encodes the case path", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ groups: [], page: 1, page_count: 1, group_count: 0, bar: {}, case_found: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
  await api.listDocumentRows("p 1", { decision: "confirm-final", language: "de", page: 2 });
  expect(String(fetch.mock.calls[0][0])).toContain("/api/v1/projects/p%201/document-rows?");
  expect(String(fetch.mock.calls[0][0])).toContain("decision=confirm-final");
  await api.listDocumentRows("p", { decision: "all", retain: ["c:1:de", "c2:en"] });
  expect(String(fetch.mock.calls[1][0])).toContain("retain=c%3A1%3Ade&retain=c2%3Aen");
  await api.getRowSubmissions("p", "case/1 #é", "de");
  expect(String(fetch.mock.calls[2][0])).toContain(`/document-rows/${encodeURIComponent("case/1 #é")}/de/submissions`);
});
```

Match the mocking style of `frontend/tests/apiClient.test.ts` (it may stub a request helper instead of `fetch`); keep the URL assertions.

- [ ] **Step 3: Implement** in `client.ts`:

```ts
export type DocumentRowsPage = components["schemas"]["DocumentRowsPage"];
export type DocumentRowView = components["schemas"]["DocumentRowView"];
export type DocumentGroupView = components["schemas"]["DocumentGroupView"];
export type RowItemView = components["schemas"]["RowItemView"];
export type FinalSelectionSummary = components["schemas"]["FinalSelectionSummary"];
export type RowSubmissions = components["schemas"]["RowSubmissions"];
export type RowSubmissionView = components["schemas"]["RowSubmissionView"];
export type RowRoundView = components["schemas"]["RowRoundView"];
export interface DocumentRowsQuery { language?: string; status?: string; q?: string; origin?: string; translation_status?: string; decision?: string; final?: string; case?: string; page?: number; retain?: string[] }
// in api:
  async listDocumentRows(key: string, query: DocumentRowsQuery = {}): Promise<DocumentRowsPage> { /* same request helper as listProjectDocuments, omit undefined; `retain` as repeated params */ },
  async getRowSubmissions(key: string, caseId: string, language: string): Promise<RowSubmissions> { /* `/projects/${enc(key)}/document-rows/${enc(caseId)}/${enc(language)}/submissions` */ },
```

- [ ] **Step 4: Run** `npm --prefix frontend test -- tests/documents/client.test.ts`, `npm --prefix frontend run typecheck`, `uv run python scripts/export_openapi.py --check`, `npm --prefix frontend run api:check`; Expected PASS / up-to-date.
- [ ] **Step 5: Phase gate**: `bash scripts/check.sh --only static` and `--only backend`.
- [ ] **Step 6: Commit point (later)**: `chore: regenerate API contract for Documents rows`.

---

## Phase 3: UI primitives

Independent of the backend. Tasks 3.1, 3.2, 3.3, 3.5, 3.6 form WP U1; Task 3.4 is WP U2. Each task: test in `frontend/tests/ui/`, run with `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/ui/<file>`. These are shared primitives (see "Shared primitives owned by this plan"): keep their contracts exactly as written so sibling plans can rely on them.

### Task 3.1: Button `loading` keeps focus

**Files:** Modify `frontend/src/ui/Button.tsx`; Test `frontend/tests/ui/button.test.tsx`

- [ ] **Step 1: Failing test** (append)

```tsx
it("loading_uses_aria_disabled_keeps_focus_and_swallows_activation", async () => {
  const click = vi.fn();
  const { rerender } = render(<Button onClick={click}>Save</Button>);
  const button = screen.getByRole("button", { name: "Save" });
  button.focus();
  rerender(<Button onClick={click} loading>Save</Button>);
  expect(button.hasAttribute("disabled")).toBe(false);
  expect(button.getAttribute("aria-disabled")).toBe("true");
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(document.activeElement).toBe(button);
  button.click();
  expect(click).not.toHaveBeenCalled();
});
it("aria_disabled_without_loading_still_activates_so_callers_can_explain", () => {
  const click = vi.fn();
  render(<Button aria-disabled="true" onClick={click}>Keep</Button>);
  screen.getByRole("button", { name: "Keep" }).click();
  expect(click).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run**; Expected FAIL (`disabled` present).
- [ ] **Step 3: Implement**

```tsx
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", type = "button", loading = false, icon, disabled, className, children, onClick, ...props },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      className={["btn", `btn-${variant}`, size === "sm" && "btn-sm", className].filter(Boolean).join(" ")}
      disabled={disabled}
      aria-disabled={loading ? true : props["aria-disabled"]}
      aria-busy={loading || props["aria-busy"]}
      onClick={event => { if (loading) { event.preventDefault(); return; } onClick?.(event); }}
    >
      {loading ? <span className="btn-spinner" aria-hidden="true" /> : icon ? <span className="btn-leading-icon" aria-hidden="true">{icon}</span> : null}
      {children}
    </button>
  );
});
```

A `type="submit"` loading button must not submit: `preventDefault` covers it. Add `.btn[aria-disabled="true"] { opacity: .6; cursor: not-allowed; }` to `components.css` next to the existing disabled rule.

- [ ] **Step 4: Run** `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1` (whole suite: other tests may assert `toBeDisabled()` on loading buttons, e.g. `confirmDialog.test.tsx`, `problemReports.test.tsx`; change those assertions to `aria-disabled="true"`, never the component back). Expected PASS.
- [ ] **Step 5: Commit point (later)**: `feat(ui): loading buttons keep focus`.

### Task 3.2: Shortcut behaviour for inline confirmations

**Files:** Test `frontend/tests/ui/shortcuts.test.tsx` (no source change expected)

- [ ] **Step 1: Tests**

```tsx
it("escape_with_allowInInputs_reaches_a_handler_while_a_checkbox_is_focused", () => {
  const handler = vi.fn(() => undefined);
  function Host() { const root = useRef<HTMLDivElement>(null); useShortcut("Escape", handler, { allowInInputs: true, root }); return <div ref={root}><input type="checkbox" aria-label="Reviewed" /></div>; }
  render(<Host />);
  const box = screen.getByRole("checkbox", { name: "Reviewed" }); box.focus();
  fireEvent.keyDown(box, { key: "Escape" });
  expect(handler).toHaveBeenCalledOnce();
});
it("a_handler_returning_false_lets_the_event_through", () => {
  const outer = vi.fn(() => undefined), inner = vi.fn(() => false as const);
  function Host() { useShortcut("Escape", outer); useShortcut("Escape", inner); return <button>x</button>; }
  render(<Host />);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(inner).toHaveBeenCalledOnce(); expect(outer).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run** `npm --prefix frontend test -- tests/ui/shortcuts.test.tsx`; Expected PASS with current `shortcuts.ts` (it already supports `allowInInputs`, `root` and `false` fall-through). If either fails, fix `dispatch` minimally and keep the existing tests green.
- [ ] **Step 3: Commit point (later)**: `test(ui): shortcut guarantees used by inline confirmations`.

### Task 3.3: `InlineConfirm`

**Files:** Create `frontend/src/ui/InlineConfirm.tsx`; Modify `frontend/src/ui/index.ts`; Test `frontend/tests/ui/inlineConfirm.test.tsx`

Contract: props of `ConfirmDialog` minus `open`, plus `children`, `outcome`, `headingLevel` and the optional `conflictMessage` (problem-reports CR-1: when given it replaces the fixed conflict sentence; the "Changed by … at …" suffix stays). Renders a block (`<div role="group" aria-labelledby aria-describedby>`); placement in a `<tr><td colSpan>` is the caller's job (DataTable `renderExpanded`). One-per-page policy and announcements belong to the page (Task 5.8).

- [ ] **Step 1: Failing tests**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { InlineConfirm, type InlineConfirmOutcome } from "../../src/ui/InlineConfirm";

function Harness(props: { busy?: boolean; outcome?: InlineConfirmOutcome | null; onCancel?: () => void; onConfirm?: () => void }) {
  return <>
    <button>Outside</button>
    <InlineConfirm title="Keep final result" message="Keep Annotation · Round 1 · ann-0004 as the final result for c · de?" confirmLabel="Keep as final"
      busy={props.busy} outcome={props.outcome ?? null} onCancel={props.onCancel ?? vi.fn()} onConfirm={props.onConfirm ?? vi.fn()}>
      <input type="checkbox" aria-label="I reviewed these changes and keep this exact result" />
    </InlineConfirm>
  </>;
}

it("focuses_its_heading_on_open_and_is_a_labelled_group", () => {
  render(<Harness />);
  const group = screen.getByRole("group", { name: "Keep final result" });
  expect(document.activeElement?.textContent).toBe("Keep final result");
  expect(group.getAttribute("aria-describedby")).toBeTruthy();
});
it("escape_cancels_when_focus_is_on_the_checkbox_inside", () => {
  const cancel = vi.fn(); render(<Harness onCancel={cancel} />);
  const box = screen.getByRole("checkbox"); box.focus();
  fireEvent.keyDown(box, { key: "Escape" });
  expect(cancel).toHaveBeenCalledOnce();
});
it("escape_outside_is_ignored", () => {
  const cancel = vi.fn(); render(<Harness onCancel={cancel} />);
  const outside = screen.getByRole("button", { name: "Outside" }); outside.focus();
  fireEvent.keyDown(outside, { key: "Escape" });
  expect(cancel).not.toHaveBeenCalled();
});
it("busy_keeps_focus_on_the_primary_consumes_escape_and_makes_cancel_unavailable", () => {
  const cancel = vi.fn(), confirm = vi.fn();
  const { rerender } = render(<Harness onCancel={cancel} onConfirm={confirm} />);
  const primary = screen.getByRole("button", { name: "Keep as final" }); primary.focus();
  rerender(<Harness busy onCancel={cancel} onConfirm={confirm} />);
  expect(document.activeElement).toBe(primary);
  expect(primary.getAttribute("aria-disabled")).toBe("true");
  expect(screen.getByRole("button", { name: "Cancel" }).getAttribute("aria-disabled")).toBe("true");
  fireEvent.keyDown(primary, { key: "Escape" });
  screen.getByRole("button", { name: "Cancel" }).click();
  expect(cancel).not.toHaveBeenCalled();
  expect(screen.getByText("Saving…")).toBeTruthy();
});
it("conflict_outcome_is_read_only_with_review_again_and_close_and_takes_focus", () => {
  const review = vi.fn(), close = vi.fn();
  render(<Harness outcome={{ kind: "conflict", changedBy: "lead-0002", changedAt: "2026-10-19T08:00:00Z", onReview: review }} onCancel={close} />);
  const message = screen.getByText(/The final result or its warnings changed since you opened this\. Nothing was saved\. Review the current state\./);
  expect(document.activeElement).toBe(message);
  expect(screen.getByText(/Changed by lead-0002 at/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Keep as final" })).toBeNull();
  screen.getByRole("button", { name: "Review again" }).click(); expect(review).toHaveBeenCalledOnce();
  screen.getByRole("button", { name: "Close" }).click(); expect(close).toHaveBeenCalledOnce();
});
it("conflict_message_can_be_replaced_by_the_caller", () => {
  render(<InlineConfirm title="Close report" message="m" confirmLabel="Close report" onConfirm={vi.fn()} onCancel={vi.fn()}
    conflictMessage="This report changed since you opened it. Nothing was saved." outcome={{ kind: "conflict", onReview: vi.fn() }} />);
  expect(screen.getByText("This report changed since you opened it. Nothing was saved.")).toBeTruthy();
  expect(screen.queryByText(/The final result or its warnings changed/)).toBeNull();
});
it("network_and_session_outcomes", () => {
  const retry = vi.fn();
  const { rerender } = render(<Harness outcome={{ kind: "error", onRetry: retry }} />);
  expect(screen.getByText("Could not save. Nothing changed.")).toBeTruthy();
  screen.getByRole("button", { name: "Retry" }).click(); expect(retry).toHaveBeenCalledOnce();
  rerender(<Harness outcome={{ kind: "session" }} />);
  expect(screen.getByText("Your session ended. Nothing was saved. Sign in and confirm again.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Keep as final" })).toBeTruthy();
});
```

- [ ] **Step 2: Run** `npm --prefix frontend test -- tests/ui/inlineConfirm.test.tsx`; Expected FAIL (module missing).
- [ ] **Step 3: Implement**

```tsx
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./Button";
import { formatDateTime } from "../app/labels";
import { useShortcut } from "./shortcuts";

export type InlineConfirmOutcome =
  | { kind: "conflict"; changedBy?: string | null; changedAt?: string | null; onReview: () => void }
  | { kind: "error"; onRetry: () => void }
  | { kind: "session" };

export interface InlineConfirmProps {
  title: string; message: ReactNode; confirmLabel: string; cancelLabel?: string;
  tone?: "primary" | "danger"; busy?: boolean; onConfirm: () => void; onCancel: () => void;
  children?: ReactNode; outcome?: InlineConfirmOutcome | null; headingLevel?: 3 | 4;
  conflictMessage?: ReactNode;
}

export function InlineConfirm({ title, message, confirmLabel, cancelLabel = "Cancel", tone = "primary", busy = false, onConfirm, onCancel, children, outcome = null, headingLevel = 4, conflictMessage }: InlineConfirmProps): JSX.Element {
  const id = useId(), headingId = `${id}-title`, messageId = `${id}-message`;
  const root = useRef<HTMLDivElement>(null), heading = useRef<HTMLHeadingElement>(null), notice = useRef<HTMLParagraphElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => { if (outcome?.kind === "conflict") notice.current?.focus(); }, [outcome?.kind]);
  useShortcut("Escape", event => {
    if (!root.current?.contains(event.target as Node)) return false;
    if (!busy) onCancel();
  }, { allowInInputs: true, root });
  const Heading = headingLevel === 3 ? "h3" : "h4";
  const conflict = outcome?.kind === "conflict";
  return <div ref={root} role="group" aria-labelledby={headingId} aria-describedby={messageId} className="inline-confirm">
    <Heading id={headingId} ref={heading} tabIndex={-1} className="inline-confirm-title">{title}</Heading>
    <div id={messageId} className="inline-confirm-message">{message}</div>
    {!conflict && children}
    {conflict && <p ref={notice} tabIndex={-1} className="inline-confirm-notice" role="alert">
      {conflictMessage ?? "The final result or its warnings changed since you opened this. Nothing was saved. Review the current state."}
      {outcome.changedBy && outcome.changedAt && <> Changed by {outcome.changedBy} at <time dateTime={outcome.changedAt}>{formatDateTime(outcome.changedAt)}</time>.</>}
    </p>}
    {outcome?.kind === "error" && <p className="inline-confirm-notice" role="alert">Could not save. Nothing changed.</p>}
    {outcome?.kind === "session" && <p className="inline-confirm-notice" role="alert">Your session ended. Nothing was saved. Sign in and confirm again.</p>}
    {busy && <p className="visually-hidden" role="status">Saving…</p>}
    <div className="inline-confirm-actions">
      {conflict ? <>
        <Button onClick={outcome.onReview}>Review again</Button>
        <Button onClick={onCancel}>Close</Button>
      </> : <>
        <Button aria-disabled={busy || undefined} onClick={() => { if (!busy) onCancel(); }}>{cancelLabel}</Button>
        {outcome?.kind === "error" && <Button onClick={outcome.onRetry}>Retry</Button>}
        <Button variant={tone} loading={busy} onClick={onConfirm}>{confirmLabel}</Button>
      </>}
    </div>
  </div>;
}
```

Button order matches `ConfirmDialog` (Cancel, then primary). Use `formatDateTime` here; Task 5.1 replaces it with `formatTime` from `documents/labels.ts` only if that lives in `app/labels.ts` (keep `ui/` free of `documents/` imports). Export from `ui/index.ts`.

- [ ] **Step 4: Run** the test file; Expected PASS.
- [ ] **Step 5: Commit point (later)**: `feat(ui): InlineConfirm`.

### Task 3.4: `DataTable` groups, expansion and row headers

**Files:** Modify `frontend/src/ui/DataTable.tsx`; Test `frontend/tests/ui/dataTable.test.tsx`

- [ ] **Step 1: Failing tests** (append; existing tests must keep passing unchanged)

```tsx
type Row = { id: string; group: string; name: string; n: number };
const rows: Row[] = [{ id: "a1", group: "A", name: "de", n: 2 }, { id: "a2", group: "A", name: "en", n: 1 }, { id: "b1", group: "B", name: "fr", n: 3 }];
const columns: Column<Row>[] = [{ id: "name", header: "Language", cell: r => r.name, rowHeader: true }, { id: "n", header: "N", cell: r => r.n, sortValue: r => r.n }];

it("renders_one_tbody_per_group_with_a_rowgroup_header_and_row_headers", () => {
  const { container } = render(<DataTable label="T" columns={columns} rows={[]} rowKey={r => r.id}
    groups={[{ key: "A", header: <button>A</button>, rows: rows.slice(0, 2), expanded: true }, { key: "B", header: <button>B</button>, rows: rows.slice(2), expanded: false }]} />);
  const bodies = container.querySelectorAll("tbody");
  expect(bodies).toHaveLength(2);
  expect(bodies[0].querySelector("th[scope=rowgroup]")?.getAttribute("colspan")).toBe("2");
  expect(bodies[0].querySelectorAll("th[scope=row]")).toHaveLength(2);
  expect(bodies[1].querySelectorAll("th[scope=row]")).toHaveLength(0);
});
it("sorts_within_groups_only", () => {
  const { container } = render(<DataTable label="T" columns={columns} rows={[]} rowKey={r => r.id}
    groups={[{ key: "A", header: "A", rows: rows.slice(0, 2), expanded: true }, { key: "B", header: "B", rows: rows.slice(2), expanded: true }]} />);
  screen.getByRole("button", { name: /N/ }).click();
  const names = [...container.querySelectorAll("th[scope=row]")].map(n => n.textContent);
  expect(names).toEqual(["en", "de", "fr"]);
});
it("renders_expanded_content_as_a_following_full_width_row", () => {
  const { container } = render(<DataTable label="T" columns={columns} rows={rows} rowKey={r => r.id} renderExpanded={r => r.id === "a1" ? <p>Details a1</p> : null} />);
  const expanded = screen.getByText("Details a1").closest("td")!;
  expect(expanded.getAttribute("colspan")).toBe("2");
  expect(expanded.closest("tr")?.previousElementSibling?.textContent).toContain("de");
  expect(container.querySelectorAll("tr.data-table-expanded")).toHaveLength(1);
});
```

- [ ] **Step 2: Run** `npm --prefix frontend test -- tests/ui/dataTable.test.tsx`; Expected FAIL.
- [ ] **Step 3: Implement** (additive API):

```tsx
export interface Column<T> { id: string; header: ReactNode; cell: (row: T) => ReactNode; sortValue?: (row: T) => string | number; width?: string; align?: "start" | "end"; rowHeader?: boolean }
export interface DataTableGroup<T> { key: string; header: ReactNode; rows: T[]; expanded: boolean; headerProps?: HTMLAttributes<HTMLTableRowElement> }
export interface DataTableProps<T> { /* existing */ groups?: DataTableGroup<T>[]; renderExpanded?: (row: T) => ReactNode | null; busy?: boolean }
```

Body rendering: extract `sortRows(list)` (the current comparator) and `renderRow(row)` which emits the `<tr>` (cells use `<th scope="row">` when `column.rowHeader`) followed, when `renderExpanded?.(row)` is non-null, by `<tr className="data-table-expanded" key={`${key}-expanded`}><td colSpan={columns.length}>{content}</td></tr>` (wrap both in a keyed `Fragment`). Without `groups`: one `<tbody>` as today. With `groups`: per group `<tbody key={group.key}><tr {...group.headerProps} className="data-table-group"><th scope="rowgroup" colSpan={columns.length}>{group.header}</th></tr>{group.expanded && sortRows(group.rows).map(renderRow)}</tbody>`; empty state when there are no groups. `busy` sets `aria-busy="true"` on the `<table>`.

- [ ] **Step 4: Run** the file and `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1` (all DataTable consumers); Expected PASS.
- [ ] **Step 5: Commit point (later)**: `feat(ui): grouped and expandable DataTable`.

### Task 3.5: `useMediaQuery`

**Files:** Create `frontend/src/ui/useMediaQuery.ts`; export from `ui/index.ts`; Test `frontend/tests/ui/useMediaQuery.test.tsx`

- [ ] **Step 1: Test**

```tsx
it("tracks_a_media_query", () => {
  let listener: (() => void) | null = null; let matches = false;
  vi.stubGlobal("matchMedia", (query: string) => ({ get matches() { return matches; }, media: query, addEventListener: (_: string, l: () => void) => { listener = l; }, removeEventListener: () => { listener = null; } }));
  function Probe() { return <span>{useMediaQuery("(max-width: 699px)") ? "narrow" : "wide"}</span>; }
  render(<Probe />); expect(screen.getByText("wide")).toBeTruthy();
  act(() => { matches = true; listener?.(); }); expect(screen.getByText("narrow")).toBeTruthy();
  vi.unstubAllGlobals();
});
```

- [ ] **Step 2: Implement** with `useSyncExternalStore(subscribe = cb => { const m = window.matchMedia(q); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); }, () => window.matchMedia(q).matches, () => false)`; guard `typeof window.matchMedia !== "function"` → false (jsdom).
- [ ] **Step 3: Run**; Expected PASS. **Commit point (later)**: `feat(ui): useMediaQuery`.

### Task 3.6: Forced colours, reduced motion, target sizes

**Files:** Modify `frontend/src/styles/components.css`; Test `frontend/tests/ui/styles.test.ts`

- [ ] **Step 1: Test** (text-level guard; real rendering is checked in Phase 7)

```ts
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const css = readFileSync(new URL("../../src/styles/components.css", import.meta.url), "utf8");
it("declares_forced_colors_rules_for_final_marker_badges_focus_and_segments", () => {
  const block = css.slice(css.indexOf("@media (forced-colors: active)"));
  for (const selector of [".final-row", ".status-pill", ":focus-visible", ".segment[aria-current=\"page\"]"]) expect(block).toContain(selector);
});
it("disables_disclosure_motion_under_reduced_motion", () => {
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.disclosure-chevron[\s\S]*transition: none/);
});
```

- [ ] **Step 2: Implement** (append):

```css
.disclosure-chevron { transition: transform 150ms ease; }
[aria-expanded="true"] > .disclosure-chevron { transform: rotate(90deg); }
.data-table-expanded > td { animation: expand-in 150ms ease; }
@keyframes expand-in { from { opacity: 0; } to { opacity: 1; } }
.final-row { background: var(--success-light); }
.final-row > :first-child { box-shadow: inset 3px 0 var(--success); }
.inline-confirm { border: 1px solid var(--border-strong); border-radius: var(--radius-md); padding: var(--space-3); background: var(--surface); }
.inline-confirm-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-2); }
.segment { border-bottom: 2px solid transparent; }
.segment[aria-current="page"] { border-bottom-color: currentColor; text-decoration: underline; font-weight: var(--weight-strong); }
.target-min { min-width: 24px; min-height: 24px; }
@media (prefers-reduced-motion: reduce) {
  .disclosure-chevron { transition: none; }
  .data-table-expanded > td { animation: none; }
}
@media (forced-colors: active) {
  .final-row > :first-child { box-shadow: none; border-left: 3px solid CanvasText; }
  .status-pill { border: 1px solid CanvasText; forced-color-adjust: none; color: CanvasText; background: Canvas; }
  :focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
  .segment[aria-current="page"] { border-bottom-color: Highlight; color: Highlight; }
}
```

Use only tokens that exist in `tokens.css` (check `--border-strong`, `--radius-md`, `--surface`; substitute the existing equivalents). Keep the existing `prefers-reduced-motion` block at line ~540 and add to it rather than duplicating if simpler.

Also create the three empty screen stylesheets `frontend/src/styles/screens/documents-table.css`, `documents-cards.css`, `documents-expanded.css` (one comment line each naming the owning WP: D4, D5, DX) and add their `@import` lines to `frontend/src/styles/index.css` after `screens/tree.css`. This keeps later Documents WPs on disjoint files.

- [ ] **Step 3: Run** `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/ui/styles.test.ts`; Expected PASS. WP U1 gate: the whole vitest suite once with the same flags, and `npm --prefix frontend run typecheck`.
- [ ] **Step 4: Commit point (later)**: `feat(ui): forced-colours and reduced-motion rules for the Documents table`.

---

## Phase 4: Router (WP U3)

### Task 4.1: New query parameters and passthrough

**Files:** Modify `frontend/src/app/router.ts`; Test `frontend/tests/router.test.ts`

- [ ] **Step 1: Failing tests** (append)

```ts
it("round_trips_documents_decision_final_case_open_and_page", () => {
  const route: Route = { name: "projectDocuments", key: "p", language: "de", case: "case/1 #é", decision: "confirm-final", open: ["case-1:de", "case-2:en"], page: "2" };
  const href = routeHref(route);
  expect(href).toContain("open=case-1%3Ade&open=case-2%3Aen");
  expect(parseRoute(href)).toEqual(route);
  expect(parseRoute("#/projects/p/documents?final=missing")).toEqual({ name: "projectDocuments", key: "p", final: "missing" });
});
it("passes_the_full_documents_query_through_case_and_report_routes", () => {
  const documents = { decision: "report-or-pause", open: ["c:de"], page: "3", case: "c", language: "de" };
  const viewer: Route = { name: "projectCase", key: "p", caseId: "c", variant: "d", annotations: JSON.stringify(["submission", "s1"]), compare: JSON.stringify(["submission", "s2"]), documents };
  expect(parseRoute(routeHref(viewer))).toEqual(viewer);
  const report: Route = { name: "projectProblemReport", key: "p", reportId: "r 1", action: "resume", documents };
  expect(parseRoute(routeHref(report))).toEqual(report);
});
it("drops_unknown_report_actions", () => {
  expect(parseRoute("#/projects/p/problem-reports/r?action=restart")).toEqual({ name: "projectProblemReport", key: "p", reportId: "r" });
});
```

- [ ] **Step 2: Run** `npm --prefix frontend test -- tests/router.test.ts`; Expected FAIL.
- [ ] **Step 3: Implement**

```ts
export interface ProjectDocumentsQuery {
  language?: string; status?: string; q?: string; select?: string; origin?: string; translation_status?: string;
  case?: string; decision?: string; final?: string; open?: string[]; page?: string;
}
const DOCUMENT_FIELDS = ["language", "status", "q", "select", "origin", "translation_status", "case", "decision", "final", "page"] as const;

function readDocumentsQuery(params: URLSearchParams, prefix = ""): ProjectDocumentsQuery {
  const result: ProjectDocumentsQuery = {};
  for (const field of DOCUMENT_FIELDS) { const value = params.get(`${prefix}${field}`); if (value !== null) result[field] = value; }
  const open = params.getAll(`${prefix}open`); if (open.length) result.open = open;
  return result;
}
function documentsEntries(query: ProjectDocumentsQuery, prefix = ""): [string, string][] {
  const entries: [string, string][] = [];
  for (const field of DOCUMENT_FIELDS) { const value = query[field]; if (value !== undefined) entries.push([`${prefix}${field}`, value]); }
  for (const value of query.open ?? []) entries.push([`${prefix}open`, value]);
  return entries;
}
function querySuffix(entries: [string, string | undefined][]): string {
  const params = new URLSearchParams();
  for (const [key, value] of entries) if (value !== undefined) params.append(key, value);
  const query = params.toString(); return query ? `?${query}` : "";
}
```

Route types: `projectCase` gains `compare?: string`; `projectProblemReport` gains `action?: "resume"` and `documents?: ProjectDocumentsQuery`. Parse report `action` only when it equals `"resume"`; read `documents_*` for case and report routes via `readDocumentsQuery(params, "documents_")`. Rewrite every `querySuffix({...})` call site to the entries form, keeping parameter order (`variant`, `annotations`, `compare`, then `documents_*`). Keep the existing router tests passing unchanged.

- [ ] **Step 4: Run** the file; Expected PASS.
- [ ] **Step 5: Commit point (later)**: `feat(router): Documents deep-link parameters and passthrough`.

### Task 4.2: Replace navigation

**Files:** Modify `frontend/src/app/router.ts` (`NavigateOptions`), `frontend/src/App.tsx` (`requestRoute`, `go`; `go` takes an optional second argument so existing `onNavigate` props stay compatible; `DocumentsPageProps` is widened by D6, not here); Test `frontend/tests/adminApp.test.tsx` (or a new `frontend/tests/navigationReplace.test.tsx`)

- [ ] **Step 1: Failing test**: render `App` with a stub page that calls `onNavigate(route, { replace: true })`; assert `window.history.length` is unchanged and `window.location.hash` equals the new href, and that a following normal navigation increases the length by one. Mirror how `frontend/tests/shell.test.tsx` mounts the app with a fake user and projects.
- [ ] **Step 2: Implement**: `export interface NavigateOptions { replace?: boolean }`; `requestRoute(next, nativeIndex?, options?)`; in the push branch: `if (options?.replace) window.history.replaceState({ ...window.history.state, ontocuratorRouteIndex: acceptedIndex.current }, "", hash); else { acceptedIndex.current++; pushState(...) }`; `go = (next: Route, options?: NavigateOptions) => { void requestRoute(next, undefined, options); }`; `DocumentsPageProps.onNavigate: (route: Route, options?: NavigateOptions) => void`.
- [ ] **Step 3: Run** `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1` and typecheck; Expected PASS. U3 only adds `NavigateOptions` and the `go`/`requestRoute` change in `App.tsx`; the `projectDocuments`, `projectProblemReport` and `projectCase` lines are changed later by D6, E2 and E3 in that order.
- [ ] **Step 4: Commit point (later)**: `feat(router): replace navigation for row expansion`.

---

## Phase 5: Documents page

Requires Phases 2 to 4. WPs: D1 = 5.1, D2 = 5.2 + 5.3, D4 = 5.4, D5 = 5.5, DX = 5.7, D6 = 5.6, D7 = 5.8, D8 = 5.9 (see the WP blocks for owned files). Run vitest single files with `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 <file>`. Unit tests mock `api` with `vi.mock("../../src/api/client", ...)` the way `frontend/tests/documentsPage.test.tsx` does today, using fixtures in a new `frontend/tests/documents/fixtures.ts` built from the generated types (one builder per scenario shape S0 to S6 from the spec table, so later tests share them). D2 creates `fixtures.ts`; later WPs may **append** builders but not change existing ones.

### Task 5.1: Label rules (`app/submissionLabels.ts`, `documents/labels.ts`)

**Files:** Create `frontend/src/app/submissionLabels.ts` (shared primitive: `formatTime`, `fullTimestamp`, `personLabel`, `roundCell`, `submissionLabel`, `kindLabels`), `frontend/src/app/Time.tsx`, `frontend/src/documents/labels.ts` (Documents only: `middleEllipsis`, `versionText`, `issueAriaLabel`, `statusBadgeText`, `workText`; re-exports the shared helpers for convenience); Test `frontend/tests/submissionLabels.test.ts` (the `formatTime`, `personLabel`/`roundCell` and `submissionLabel` cases below) and `frontend/tests/documents/labels.test.ts` (the rest)

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from "vitest";
// Split across the two test files: shared helpers from "../src/app/submissionLabels",
// Documents-only helpers from "../../src/documents/labels".
import { formatTime, issueAriaLabel, middleEllipsis, personLabel, roundCell, submissionLabel, versionText } from "../../src/documents/labels";

const now = new Date("2026-10-19T12:00:00");
describe("labels", () => {
  it("formats_local_time_with_year_only_outside_the_current_year", () => {
    expect(formatTime("2026-10-19T00:57:00", { now })).toBe("19 Oct, 00:57");
    expect(formatTime("2025-03-02T08:05:00", { now })).toBe("2 Mar 2025, 08:05");
    expect(formatTime("2026-10-19T00:57:09", { now, seconds: true })).toBe("19 Oct, 00:57:09");
  });
  it("person_label_marks_the_lead_without_nested_parentheses", () => {
    expect(personLabel("ann-0004", false)).toBe("ann-0004");
    expect(personLabel("lead-0002", true)).toBe("lead-0002 (you)");
    expect(roundCell({ ordinal: 1, author: "lead-0002", isMe: true })).toBe("Round 1 (lead-0002, you)");
  });
  it("submission_label_variants", () => {
    const base = { kind: "annotation" as const, ordinal: 2, author: "ann-0004", isMe: false, language: "de", version: "v1", recordedAt: "2026-10-19T00:57:00" };
    expect(submissionLabel(base, { now })).toBe("Annotation · Round 2 · ann-0004 · de v1 · 19 Oct, 00:57");
    expect(submissionLabel({ ...base, kind: "consolidation", author: "lead-0002", recordedAt: "2026-10-18T10:00:00" }, { now })).toBe("Consolidation · lead-0002 · de v1 · 18 Oct, 10:00");
    expect(submissionLabel({ ...base, ordinal: null }, { now, withLanguage: false })).toBe("Annotation · Initial submission · ann-0004 · v1 · 19 Oct, 00:57");
  });
  it("middle_ellipsis_keeps_both_ends", () => { expect(middleEllipsis("case-2026-10-19-0211", 12)).toBe("case-…-0211"); });
  it("version_text_for_single_chain_and_parallel_roots", () => {
    expect(versionText({ version: 3, origin: "correction", derivedVersion: 2, status: "ready_for_review", decision: null, chainName: "DeepL v3", parallel: false })).toBe("v3 · Correction of v2 · Ready for review");
    expect(versionText({ version: 1, origin: "machine_translation", derivedVersion: null, status: "reviewed", decision: "rejected", chainName: "DeepL v3", parallel: true })).toBe("DeepL v3 v1 · Machine translation · Rejected in review");
  });
  it("issue_aria_label_groups_by_category", () => {
    expect(issueAriaLabel({ "report-or-pause": 1, "confirm-final": 1 }, { "Source text changed": 1 })).toBe("2 issues: problem report or paused task 1; final result to confirm 1. 1 note: source text changed");
  });
});
```

- [ ] **Step 2: Run**; Expected FAIL.
- [ ] **Step 3: Implement** with `Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })` and explicit assembly (`"{day} {month}[ {year}], {HH}:{mm}[:{ss}]"`) via `formatToParts`, so output is stable across locales in tests (pin `"en-GB"` for parts if needed). Also export `fullTimestamp(value)` for the `title` (ISO with zone via `Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "long" })`), `kindLabels` (`Annotation`, `Review`, `Consolidation`, `Carry-forward`), `statusBadgeText(status, decision, acceptedWithoutReview)` (`Rejected in review`, `Queried`, `Accepted without review`, else `translationStatusLabels`), `workText(work)` per "Work wording" (`"ann-0004 annotating (Round 3)"`, `"Annotation review open"`, `"Translation review open (v3)"`, `"Reopened"`, counts `"2 of 3 submitted"` for more than two assignees), and `Time` component in `app/Time.tsx`: `<time dateTime={iso} title={fullTimestamp(iso)}>{formatTime(iso)}</time>`. `app/submissionLabels.ts` and `app/Time.tsx` must not import from `documents/`; `InlineConfirm` (U1) keeps `formatDateTime` from `app/labels.ts` so U1 does not depend on D1.
- [ ] **Step 4: Run**; Expected PASS. **Commit point (later)**: `feat(documents): label rules`.

### Task 5.2: Data hooks with stale-response discard and refresh

**Files:** Create `frontend/src/documents/useDocumentRows.ts`, `frontend/src/documents/useRowSubmissions.ts`; Test `frontend/tests/documents/useDocumentRows.test.tsx`

- [ ] **Step 1: Failing tests**: (a) two overlapping requests where the first resolves last: the hook shows the second's data; (b) a `focus` event on `window` refetches; (c) `vi.useFakeTimers()` + advance 60 000 ms refetches; (d) `reload()` refetches; (e) an error leaves `rows` null and exposes `error` and `retry`; (f) a `retain` list in the query is sent on every refetch, and a change of only the retained keys keeps the shown page while loading.
- [ ] **Step 2: Implement**

```ts
export function useDocumentRows(projectKey: string, query: DocumentRowsQuery) { // query.retain comes from visitState (Task 5.9)
  const generation = useRef(0);
  const [state, setState] = useState<{ page?: DocumentRowsPage; error?: unknown; loading: boolean }>({ loading: true });
  const identity = JSON.stringify([projectKey, query]);
  const load = useCallback(() => {
    const current = ++generation.current;
    setState(previous => ({ ...previous, loading: true }));
    api.listDocumentRows(projectKey, query).then(
      page => { if (current === generation.current) setState({ page, loading: false }); },
      error => { if (current === generation.current) setState({ error, loading: false }); },
    );
  }, [identity]);
  useEffect(() => { setState({ loading: true }); load(); }, [load]);
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(load, 60_000);
    return () => { window.removeEventListener("focus", onFocus); window.clearInterval(timer); };
  }, [load]);
  return { ...state, reload: load };
}
```

`useRowSubmissions(projectKey, caseId, language, enabled)` follows the same pattern keyed by row and exposes `reload`.

- [ ] **Step 3: Run** `npm --prefix frontend test -- tests/documents/useDocumentRows.test.tsx`; Expected PASS. **Commit point (later)**.

### Task 5.3: Decision bar

**Files:** Create `frontend/src/documents/DecisionBar.tsx`; Test `frontend/tests/documents/decisionBar.test.tsx`

- [ ] **Step 1: Failing tests**
  - Heading `h2` "Needs your decision" with `IconWarning` and count when `total > 0`; no warning text when 0, bar still rendered.
  - Segments are links named "All", "Needs your decision (n)", "No final result (m)"; exactly one has `aria-current="page"`; `href` of "Needs your decision" contains `decision=all` and no `final`; "No final result" contains `final=missing` and no `decision`.
  - With `decision` active: per-category links (`decision=report-or-pause`, `confirm-final`, `translation`, `missing-final`) keep `language`, `status`, `q` and drop `page`.
  - When `shown < total` and filters are active: text "k of n shown" and a "Clear filters" link without `language`/`status`/`q`/`origin`/`translation_status`.
- [ ] **Step 2: Implement** `DecisionBar({ bar, query, projectKey, onNavigate })` building hrefs with `routeHref({ name: "projectDocuments", key, ...patch })`, `page: undefined` on every change, links intercepted like existing code (plain left click → `onNavigate(route)`, push navigation). Category labels: "Problem report or paused task", "Final result to confirm", "Translation check or review failed", "Final result missing".
- [ ] **Step 3: Run**; Expected PASS. **Commit point (later)**.

### Task 5.4: Row cells and collapsed table

**Files:** Create `frontend/src/documents/RowCells.tsx`, `frontend/src/documents/DocumentsTable.tsx`; Test `frontend/tests/documents/documentsTable.test.tsx`

- [ ] **Step 1: Failing tests** (fixtures S0, S2, S3, S4 from `fixtures.ts`):
  - One `tbody` per text; group header button named `"synthetic-accepted, 2 languages, final 1 of 2"` with `aria-expanded` and `aria-controls` pointing at existing row ids; visible "2 issues"; no person names in the header.
  - Row header `th[scope=row]` contains the disclosure button named `"Show submissions, synthetic-accepted · de"` (with `IconChevronRight`, `aria-expanded="false"`) and link `"Open synthetic-accepted · de"`; "Open my task" link when `own_open_assignment_id` is set.
  - Seven columns in order: Select, Text · language, Text version(s), Work, Final result, Issues, Last activity.
  - S3: version cell "v3 · Correction of v2 · Ready for review"; Final cell `"Annotation · Round 2 · ann-0004 · 18 Oct, 10:00 · v1"` (marker because final is not the newest), with `IconCheck`.
  - S4: "2 independent translations" plus chain names; select cell shows "Choose in Text versions" text instead of a checkbox; Open link has `aria-describedby` text "Opens Provider B v1, the most recent translation".
  - Issues cell: warning `StatusBadge` "2" whose accessible name equals `issueAriaLabel(...)`; neutral "1 note" text; `ROUND_REVIEW_PENDING` not counted.
  - Last activity is a `<time>` with `title`.
  - Groups with a bar-category issue start expanded; others collapsed when `group_count > 50`.
  - `Matched: v1 · Check failed` appears in a collapsed row whose displayed version does not match the filter.
  - Long IDs render `middleEllipsis` text with the full value in `title`.
- [ ] **Step 2: Implement** (styles in `styles/screens/documents-table.css`) `DocumentsTable` on top of `DataTable` with `groups` and `renderExpanded` (returns `<ExpandedRow …/>` for open rows, built in Task 5.6). Columns use `rowHeader: true` for "Text · language". Group expansion state lives in `DocumentsPage` (Task 5.6) and is passed as `expandedGroups: Set<string>` plus `onToggleGroup`. Row expansion = membership of `"{case}:{language}"` in `query.open`.
- [ ] **Step 3: Run**; Expected PASS. **Commit point (later)**.

### Task 5.5: Narrow cards

**Files:** Create `frontend/src/documents/DocumentCards.tsx`; Test `frontend/tests/documents/documentCards.test.tsx`

- [ ] **Step 1: Failing tests**: each row renders `<article aria-labelledby>` whose heading is "synthetic-accepted · de"; line order (checkbox, heading, issue badge) / version and status / final result / work and last activity / "Open" and "Show submissions"; expanded content stacks inside the article; the same accessible names as the table.
- [ ] **Step 2: Implement** reusing the cell renderers from `RowCells.tsx` (read only for D5); CSS in `styles/screens/documents-cards.css`: `.document-card` grid, `.document-card a, .document-card button, .document-card input[type="checkbox"] { min-height: 24px; min-width: 24px; }` (WCAG 2.5.8 minimum, not a fixed size), `white-space: nowrap` on each link so links wrap whole, `overflow-wrap: anywhere` for IDs.
- [ ] **Step 3: Run**; Expected PASS. **Commit point (later)**.

### Task 5.6: Page shell: access, filters, bar, bulk, paging, deep links

**Files:** Rewrite `frontend/src/admin/DocumentsPage.tsx`; Modify `frontend/src/App.tsx` (`projectDocuments` case only: pass `canManage`, forward `NavigateOptions`); page-level styles go into `styles/screens/documents-table.css` (D4 is done by then; D6 takes over that file); Test `frontend/tests/documentsPage.test.tsx` (rewrite; keep upload/assign tests that still apply)

- [ ] **Step 1: Failing tests**
  - Non-lead (`canManage={false}`): `EmptyState` "Documents is for project leads" with a link to My tasks, and **no** skeleton and no `listDocumentRows` call.
  - Loading: table with `aria-busy="true"` and skeleton rows.
  - Rows error: error with "Retry" replaces table and bar; Retry calls `listDocumentRows` again.
  - Filters: Language, Status (values Unassigned, Open, In progress, Submitted, Reopened, Paused), "ID" input, and "More filters" disclosure with Origin and Translation status (including "Accepted without review"); a change pushes navigation with `page` removed; the live region announces "{k} texts shown" after the new data arrives.
  - Bulk: "Select all" selects every row with a checkbox on the page including collapsed groups and announces "Selected 42 rows. 3 rows need a choice in Text versions."; "Assign …" and "Propose distribution …" open the existing dialogs with the selected **versions** (`bulk.document_id` per row plus per-version checkboxes from Text versions) mapped to `ProjectDocumentSummary` via the existing `api.listProjectDocuments` rows (keep that call for dialogs).
  - Paging controls "Previous"/"Next" and "Page n of m" push `page`.
  - Deep link `case=c&language=de`: that group and row expand, the row header receives focus, row stays when it no longer matches `decision` and shows "This no longer needs your decision."; unknown case: `EmptyState` "Text {case} not found" with "Show all texts".
  - Preflight-only deep link (`case`, `language`, no decision) to a row without a final whose rule does not hold: "No final result. Not counted as a decision yet: no submission." or "...: work still open: {work summary}."
  - Expanding a row calls `onNavigate(route with open added, { replace: true })`.
  - Current rule: `page.adjudicator_not_annotator` is passed to the expanded row and the confirmations (never the final's snapshot).
  - Empty decision filter: `EmptyState` "Nothing needs your decision" with "Show all texts".
- [ ] **Step 2: Implement** the page composition:

```tsx
export interface DocumentsPageProps { projectKey: string; query: ProjectDocumentsQuery; onNavigate: (route: Route, options?: NavigateOptions) => void; canManage: boolean; canOverrideTranslationStatus?: boolean; currentUser?: Pick<CurrentUser, "username" | "pseudonym"> }
```

Sections in order: `<h1>Documents</h1>`, `DecisionBar`, filter `Toolbar` (Language, Status, ID, `<details>` "More filters"), action `Toolbar` (selection count, Upload, Refresh, Assign …, Propose distribution …), table or cards (`useMediaQuery("(max-width: 699px)")`), paging, one polite live region (`<p className="visually-hidden" role="status" aria-live="polite">`). Keep `UploadPanel`, `AssignDialog`, `DistributionDialog`, `ReviewHistory` and `AssignmentActions` usage (moved into Text versions in Task 5.7). Remove the tree view, the free-text summaries and `useFinalSelectionState`.

In `App.tsx`: `canManage={!!currentProject?.can_manage}` (open question 6). Wait for the projects list before rendering the page, so the access check runs before any skeleton.

- [ ] **Step 3: Run** `npm --prefix frontend test -- tests/documentsPage.test.tsx` and typecheck; Expected PASS. **Commit point (later)**: `feat(documents): lead table page`.

### Task 5.7: Expanded row: Issues, Submissions, More

**Files:** Create `frontend/src/documents/ExpandedRow.tsx`, `SelectionNotice.tsx`, `SubmissionsTable.tsx`, `TextVersions.tsx`; Test `frontend/tests/documents/expandedRow.test.tsx`

- [ ] **Step 1: Failing tests**
  - Region `section[role=region]` labelled by the row; `h3` sections "Issues" (only when non-selection issues or notes exist), "Submissions (n)", "More".
  - Issues: report line with excerpt (120 chars), reporter label, time, "task paused"/"task resumed", link "Open report" (route `projectProblemReport` with `documents` = current query); orphan pause line "ann-0004's task is paused, but its report is resolved." with link "Resume task" (route with `action: "resume"`); "v2 was rejected in review." with link "Text versions" (opens More > Text versions and focuses it); source change note with "Review source change"; "v2 needs a translation reviewer".
  - Selection notice lines for each acknowledgeable code exactly as in the spec, the rejected/queried line with "No action needed.", waiting lines for unsubmitted rounds and open translation reviews, and "Keep final result…" only when an acknowledgeable cause exists. S0 example renders exactly the three lines of the spec.
  - Submissions table: columns Final, Round, Kind, Version (hidden when all submissions share a version), By, Submitted, Findings, Actions; oldest first; Final row has `StatusBadge` "Final" with `IconCheck` and class `final-row`, no `aria-selected`; Round cell is the View link named "View {submission label}" with suffixes "· latest" / "· earlier submission" / "· superseded" / "· abandoned"; more than 10 rows collapse to the newest 10 plus "Show all (n)" and the Final row stays visible; unsubmitted rounds as muted last lines "Round 3 · ann-0004 · in progress, not submitted yet" and not counted; actions: "Use as final…" (no final), "Replace…" (non-final rows), none on the final row; Compare / "Different text versions; open each with View." / "Compare…" (choose second submission, preselected when exactly two).
  - View link route: `projectCase` with `variant` = document_id, `annotations` = `refKey({ kind: "submission", id })`, `documents` = current query. Compare route adds `compare` (open question 4) with final on the left. `SubmissionsTable` never builds refs itself: it calls the caller's `viewRoute(row)`, so the editor history (Task 6.4) can map non-lead rows to authorized `own` refs (review finding 8).
  - "Loading submissions…" while loading with actions unavailable (`aria-disabled`); error with "Retry" inside the row.
  - More: collapsed `<details>` items "Start consolidation…" (existing `ConsolidationLauncher`, fed with `RowSubmissions` mapped to its `SubmissionHistorySummary` props), "Text versions (n)" (child rows with origin, status badge with review decision, chain name, `AssignmentActions`, per-version bulk checkboxes when the row shows "Choose in Text versions", View text, `TranslationCorrectionAction`, Translation reviews), "Technical details" (`dl` of document, submission and round IDs and mode, unabbreviated).
- [ ] **Step 2: Implement** (styles in `styles/screens/documents-expanded.css`). `SubmissionsTable` props: `{ rows: RowSubmissionView[]; rounds: RowRoundView[]; final?: FinalSelectionSummary | null; parallel: boolean; showFinalColumn: boolean; actions?: (row) => ReactNode; renderConfirm?: (row) => ReactNode | null; viewRoute: (row) => Route | null }` (`null` renders the round cell as text without a link). Its tests go into `frontend/tests/documents/submissionsTable.test.tsx`, including read-only mode with a `viewRoute` that returns `own` refs. It uses `DataTable` with `renderExpanded={renderConfirm}` so `InlineConfirm` becomes the full-width row below its submission. In read-only mode (`actions` undefined) it renders no Actions column (used by Task 6.4).
- [ ] **Step 3: Run**; Expected PASS. **Commit point (later)**.

### Task 5.8: Final confirmations

**Files:** Create `frontend/src/documents/FinalConfirm.tsx`; Modify `DocumentsPage.tsx` (single confirmation state and announcements); Test `frontend/tests/documents/finalConfirm.test.tsx`

- [ ] **Step 1: Failing tests**
  - Use: title "Use as final result", message "Use {label} as the final result for {text ID} · {language}?", primary "Use as final"; PUT body `{ document_id, submission_id, expected_revision: 0, acknowledged_cause_ids: [] }`.
  - Replace: title "Replace final result", "Replace {old label} with {new label}? The previous choice stays in the history.", primary "Replace", `expected_revision` = captured revision.
  - Keep: title "Keep final result", message, cause lines, checkbox "I reviewed these changes and keep this exact result", primary "Keep as final" with `aria-disabled` while unchecked; activating unchecked shows "Check the box to confirm you reviewed these changes." and sends nothing; checked sends **all** acknowledgeable cause ids of the row captured **at open** (the complete set shown, never a subset) even if the row refreshes meanwhile; the server answers 409 when the current set differs (Task 1.4).
  - Additions: "Still open: {work summary}." when work is open; abandoned/superseded note; "This is your own result."; with the **current** rule on (`page.adjudicator_not_annotator`, not the final's snapshot) and an own result (`final.is_mine` for Keep, `submission.is_me` for Use/Replace; a test toggles the rule after the selection and asserts Keep becomes unavailable): the "Use as final…"/"Keep final result…" trigger keeps focusability, has `aria-disabled` and `aria-describedby` to the visible reason "This project keeps adjudication separate from annotation. Another lead must choose this result.", and activation announces the reason.
  - One per page: opening a second confirm while not busy closes the first and the live region says "Previous confirmation closed."; while busy other triggers are `aria-disabled`.
  - Outcomes: Use/Replace success focuses the new Final row's View link and announces "{label} is now the final result." plus changed bar counts and, with a decision filter active, a "Next decision: {text ID} · {language}" link; Keep success focuses the "Submissions" `h3` and announces "Kept {label}. Still open: {waiting lines}."; 409 → conflict outcome with `selected_by`/`updated_at` from the error details, "Review again" reloads the row; network/500 → error outcome with Retry; 401 → session outcome, busy cleared, no retry.
  - Escape/Cancel return focus to the trigger, or to the row disclosure if the trigger is gone.
  - The confirm closes only when the row's `final.revision` or its set of acknowledgeable cause ids changes on refresh; other refreshes keep it open.
- [ ] **Step 2: Implement**: page state `confirm: { rowKey, kind: "use" | "replace" | "keep", submissionId, expectedRevision, causeIds: string[], triggerId } | null` and `busy`. On success: `notifyFinalSelectionChanged(projectKey)` (kept in `variants/finalSelectionState.ts`), reload rows and the row's submissions. Error mapping uses `ApiError.status` (401, 409) from `api/client.ts`.
- [ ] **Step 3: Run**; Expected PASS. **Commit point (later)**: `feat(documents): inline final-result confirmations`.

### Task 5.9: Resolved and Changed badges, next decision

**Files:** Create `frontend/src/documents/visitState.ts`; Modify `DocumentsPage.tsx`; Test `frontend/tests/documents/visitState.test.ts`, extend `documentsPage.test.tsx`. (`ProblemReportDetail` calls `recordDecision` in Task 6.3, WP E2.)

- [ ] **Step 1: Failing tests**
  - `rememberShown(projectKey, filterKey, rows)` stores each shown row's key **with a snapshot of its categories, work, final and report state**; `retainedKeys(projectKey, filterKey)` returns the keys to send as `retain`; `recordDecision(projectKey, rowKey)`; `badgeFor(snapshot, currentRow, decided)` returns `{ tone: "success", text: "Resolved" }` when a decision on this page or the report page removed the category, else `{ tone: "neutral", text: "Changed: Work assigned" }` etc. (open question 8 list).
  - A row that stops matching stays visible with the badge, collapses automatically, and disappears after a filter change or reload (`sessionStorage` cleared on `beforeunload`/filter change).
  - Retained rows are refreshed from the server (review finding 5): the page passes `retainedKeys(...)` to `useDocumentRows` as `retain`; the badge compares the stored snapshot with the **current** server row (`retained: true`). Tests: a row resolved by the lead's own Keep shows "Resolved"; a row whose category disappeared because work was assigned elsewhere (mocked refetch returns `retained: true`, a new `work` item, `missing_final.reason: "work_open"`) shows "Changed: Work assigned"; a row resumed externally without a local `recordDecision` shows "Changed: Task resumed".
- [ ] **Step 2: Implement** with `sessionStorage` key `ontocurator:documents-visit:{projectKey}:{filterKey}`. "Changed:" reasons compare snapshot and current row: new non-revoked work item → "Work assigned"; a work item became held → "Task paused"; a held item is no longer held → "Task resumed"; `final` changed → "Final result changed"; otherwise "Updated elsewhere".
- [ ] **Step 3: Run**; Expected PASS. **Commit point (later)**.

### Task 5.10: Phase gate

- [ ] (End of WP D8.) Run `npm --prefix frontend run typecheck` and `bash scripts/check.sh --only frontend` (only while at most one other heavy WP runs). Expected: pass. Fix any test still importing removed modules.

---

## Phase 6: Progress, export, report, case viewer, removals

WPs: E1 = 6.1 + 6.2, E2 = 6.3, E3 = 6.4, E4 = 6.5.

### Task 6.1: Progress keeps statistics; link to decisions

**Files:** Modify `frontend/src/admin/ProgressPage.tsx`; Delete `frontend/src/admin/ProjectDashboardPage.tsx` (move `WorkflowWarnings` to `FinalExportPanel.tsx`); Test `frontend/tests/progressPage.test.tsx`, delete/adjust `frontend/tests/projectDashboard.test.tsx`

- [ ] **Step 1: Failing test**: Progress renders no "Final results and open issues" section and shows a link "Needs your decision (3)" whose href is `#/projects/p/documents?decision=all` (count from `api.listDocumentRows(key, { decision: "all" })` `bar.total`); the Documents status table "Assign" link stays.
- [ ] **Step 2: Implement**; remove the `ProjectDashboardPage` import; delete the file and its test.
- [ ] **Step 3: Run** `npm --prefix frontend test -- tests/progressPage.test.tsx`; Expected PASS. **Commit point (later)**.

### Task 6.2: Export preflight links to rows

**Files:** Modify `frontend/src/admin/FinalExportPanel.tsx`; Test `frontend/tests/exportPage.test.tsx`

- [ ] **Step 1: Failing test**: each preflight warning item links to `routeHref({ name: "projectDocuments", key, case: w.case_id, language: w.language })` with link text "Show {case} · {language}" (no generic "Review issue"); omissions are listed with the same links.
- [ ] **Step 2: Implement** `WorkflowWarnings` locally in `FinalExportPanel.tsx`. Do not touch Cancel or the primary button (quick-fix scope). `FinalExportPanel.tsx` is shared with the quick-fixes-and-export plan: E1 must not run while that plan's export WP owns the file.
- [ ] **Step 3: Run**; Expected PASS. **Commit point (later)**.

### Task 6.3: Problem report back link and resume preselection

**Files:** Modify `frontend/src/tasks/ProblemReportDetail.tsx`, `frontend/src/App.tsx` (`projectProblemReport` case only: pass `documents`, `action`); Test `frontend/tests/problemReportRoute.test.tsx`. `ProblemReportDetail.tsx` is shared with the problem-reports plan: serialize with it.

- [ ] **Step 1: Failing tests**: with `documents` in the route, "Back to documents" navigates to `projectDocuments` with exactly that query; without it, to `{ case, language }` of the report, resolved from the report's `document_id` via `api.getVariantMetadata(projectKey, report.document_id)`; with `action: "resume"`, the action select starts at "Release selected pauses" and the report's held assignment is preselected; nothing is submitted until the user applies; after a successful resume or resolve with `documents` in the route, `recordDecision(projectKey, "{case}:{language}")` from `documents/visitState.ts` is called (moved here from Task 5.9).
- [ ] **Step 2: Implement**; render the back link as a link (`<a href>` intercepted) instead of a button so it can open in a new tab.
- [ ] **Step 3: Run**; Expected PASS. **Commit point (later)**.

### Task 6.4: Case viewer history becomes read-only table; compare deep link

**Files:** Modify `frontend/src/variants/SubmissionHistory.tsx`, `frontend/src/variants/CaseViewer.tsx`, `frontend/src/variants/ComparePane.tsx`, `frontend/src/App.tsx` (`projectCase` case only: forward `compare={route.compare}`; review finding 7); Create test `frontend/tests/caseCompareRoute.test.tsx`; Delete `frontend/src/variants/FinalResultSelector.tsx` and its test `frontend/tests/finalResultSelector.test.tsx`; adjust `frontend/tests/submissionHistory.test.tsx`, `frontend/tests/finalSelection.test.tsx`, `frontend/tests/comparePane.test.tsx`, `frontend/tests/caseViewer.test.tsx`

- [ ] **Step 1: Failing tests**
  - `SubmissionHistory` dialog has no selection controls, no "Start consolidation", and renders `SubmissionsTable` read-only; leads see the Final column (data from `getRowSubmissions` + row final), non-leads do not (data from `listSubmissionHistory`, own submissions only).
  - View paths (review finding 8): for leads `viewRoute` uses `refKey({ kind: "submission", id })`; for non-leads `refKey({ kind: "own", id })`, the ref they may already open. Test: an annotator opens an old own submission from the history and the viewer requests `annotation-versions/own/{id}`, never `submission/{id}`.
  - `CaseViewer` with `compare` set opens the compare pane with the right side preselected to that ref; closing it keeps `annotations`.
  - Through `App`, not a directly mounted `CaseViewer`: navigating to `#/projects/p/cases/c?variant=d&annotations=…&compare=…` opens the compare pane with that right side (`caseCompareRoute.test.tsx`, mounted like `frontend/tests/shell.test.tsx`).
  - Back link from the case viewer to Documents restores the full `documents` query (including `open`, `page`, `decision`).
- [ ] **Step 2: Implement**: `ComparePane` gains `initialRight?: { documentId: string; refKey: string }`; `CaseViewer` passes it from `compare` and opens compare when present. `finalSelectionState.ts` keeps `notifyFinalSelectionChanged`/`FINAL_SELECTION_CHANGED`; `useFinalSelectionState` stays only where still used (`CaseViewer` Final marker) or is removed if unused.
- [ ] **Step 3: Run** the changed test files with `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 <files>` and typecheck; Expected PASS (the full suite runs in E4). **Commit point (later)**.

### Task 6.5: Remove dead paths and phase gate

- [ ] **Step 1**: `grep -rnE "FinalResultSelector|ProjectDashboardPage|buildDocumentTree|Selected final result|Review issue" frontend/src frontend/tests frontend/browser` (Git Bash; `rg` is not installed there) returns only intended hits (browser specs are updated in Phase 7; `documentTree.ts` is deleted if unused, with `frontend/tests/documentTree.test.ts`).
- [ ] **Step 2**: `npm --prefix frontend run typecheck` and `bash scripts/check.sh --only frontend`; Expected pass.
- [ ] **Step 3: Commit point (later)**: `refactor: replace submission history dialog and progress warnings by the Documents table`.

---

## Phase 7: Browser scenarios and accessibility

WPs: P1, P2, P3 = 7.1a, 7.1b, 7.1c; P4 = 7.2; P5 = 7.3; P6 = 7.4 + 7.5; P7 = 7.6. All specs run through `npm --prefix frontend run test:e2e -- <spec>`, one Playwright run per worktree at a time; set `HPO_E2E_PORT` to a free port when another worktree runs browser tests. Existing specs that drove the old tree or dialog (`final-workflow.spec.ts`, `variants.spec.ts`, `variant-admin.spec.ts`, `decision-semantics.spec.ts`, `translations.spec.ts`, `workflow.spec.ts`) must be updated in Task 7.6.

### Task 7.1: Fixture route `/__test_documents__` (split into 7.1a, 7.1b, 7.1c)

The scenario builders are split over three modules so each WP stays small and `tests/browser_server.py` changes by one line only (review finding 9):

| Task | WP | Owns | Scenarios |
|---|---|---|---|
| 7.1a | P1 | `tests/browser_documents_scenarios.py` (route `register_documents_scenario_route(app)`, `BUILDERS` registry merging the three modules, shared helpers `new_project(scenario)`, `import_texts(project, texts)` with **one** `run_fixture_import` call per scenario, `submit(...)`, `select(...)`), stub modules `tests/browser_documents_scenarios_rows.py` and `tests/browser_documents_scenarios_decisions.py` (`BUILDERS: dict = {}`), one registration line in `tests/browser_server.py` after line 1277, `tests/test_browser_documents_fixture.py`, `frontend/browser/documentsHelpers.ts` (`documentsScenario(page, name)` POST helper; do not edit the shared `browser/helpers.ts`) | S0, S1, S2, S3, S4, S5, S8 (S8 reuses the S0 builder) |
| 7.1b | P2 | `tests/browser_documents_scenarios_rows.py`, `tests/test_browser_documents_fixture_rows.py` | S6, S7, S9, S10, S12 |
| 7.1c | P3 | `tests/browser_documents_scenarios_decisions.py`, `tests/test_browser_documents_fixture_decisions.py` | S11, S13, S14, S15 |

Interface: every builder is `def build(app: FastAPI) -> dict[str, Any]` returning `{project, users: {lead, ...}, rows: [{case_id, language}], ...ids}`; the registry key is the scenario name. P2 and P3 only add entries to their own module's `BUILDERS`. Large datasets (S7: 300 texts, S15: 55 texts) are generated in memory and imported with one import call, never per-text service calls.

- [ ] **Step 1: Failing test** (per WP, in its own test file): for each scenario of the WP, `POST /__test_documents__?scenario=S3` on the browser fixture app returns the identities and `GET /api/v1/projects/{project}/document-rows` as the lead contains the expected categories (table below). Model on `tests/test_browser_translation_review_fixture.py`.
- [ ] **Step 2: Implement** one builder per scenario using real services (`run_fixture_import`, `AssignmentService`, `WorkspaceService`/`SubmissionService` via the same helpers as `register_translation_review_scenario_route`, `WorkRoundService`, `ProblemReportService`, `FinalResultService`, translation review service). A fresh project per call (`documents-{scenario}-{uuid8}`).

| Scenario | Data shape | Expected on the row |
|---|---|---|
| S0 | `synthetic-accepted`: en native unassigned; de MT accepted, ann-0004 Round 1 submitted and selected, correction v2 `ready_for_review`, ann-0004 Round 3 in progress, ann-0003 review submitted | de: confirm-final (text corrected), waiting line Round 3; en: no final, not counted |
| S1 | `case-0042` en native, two annotators submitted, final chosen | no issues |
| S2 | `case-0108` en source + 6 MT languages, de `automatic_check_failed`, 4 finals | de translation issue; group header "7 languages, final 4 of 7" |
| S3 | `case-0211` de chain v1 MT accepted (final on v1 Round 2), v2 correction accepted, v3 correction `ready_for_review` with open translation review | Final shows "· v1"; SELECTED_TEXT_CORRECTED for v2 and v3; waiting line translation review v3 |
| S4 | `case-0305` fr two MT roots (Provider A, Provider B), two annotators in progress | "2 independent translations"; Choose in Text versions |
| S5 | `case-0377` en, 3 submissions + lead consolidation selected | Consolidation final, no round in label |
| S6 | `case-0390` de, open report with paused task | report-or-pause, report line with excerpt |
| S7 | 300 texts, 3 with issues | paging 6 pages; only issue groups expanded |
| S8 | S0 data, viewport 390 px | cards |
| S9 | fr two MT roots with equal provider and model | chain names suffixed with " · {external_id}" |
| S10 | de: v2 rejected, v3 queried (other chain), v4 accepted_corrected with accepted child v5 | translation issue for rejected/queried newest; no text-corrected cause for rejected/queried |
| S11 | en: Round 1 with two submissions, first selected; then a new submission on another assignment after selection | SELECTED_RESULT_REVISED and SELECTED_NEWER_RESULT; "· latest"/"· earlier submission" |
| S12 | de: report resolved with hold kept; second row paused via `extend_hold` from that report | first row orphan pause (bar), second row "Task paused" note with "Open report" |
| S13 | en: carry-forward round and consolidation round | kinds Carry-forward, Consolidation |
| S14 | de: final chosen, open translation review; plus en: early selection with work still open | waiting line; "Still open: …" in confirm |
| S15 | 55 texts; lead owns a submission; project `adjudicator_not_annotator` on | own result not selectable with reason; paging |

- [ ] **Step 3: Run** the WP's own test file (`uv run pytest tests/test_browser_documents_fixture.py -q`, `..._rows.py`, `..._decisions.py`); P3 finally runs all three. Expected PASS. **Commit point (later)**.

### Task 7.2: Table rendering scenarios (S0 to S10, S13)

**Files:** Create `frontend/browser/documents-table.spec.ts`

- [ ] **Step 1: Write tests**: one `test()` per scenario asserting the visible facts from the table above, using accessible names (`getByRole('button', { name: 'Show submissions, case-0211 · de' })`, `getByRole('rowgroup')`, `getByRole('link', { name: 'Open case-0211 · de' })`). S7: group count 50 on page 1, "Page 1 of 6", only issue groups expanded. S8: `page.setViewportSize({ width: 390, height: 844 })`, `article` cards present, no `table`. Use the helper pattern of `final-workflow.spec.ts` (`loginExisting` from `browser/helpers.ts`, read only) and `documentsScenario()` from `browser/documentsHelpers.ts`.
- [ ] **Step 2: Run** `npm --prefix frontend run test:e2e -- documents-table.spec.ts`; Expected PASS. **Commit point (later)**.

### Task 7.3: Decision flows (S11, S12, S14, S15)

**Files:** Create `frontend/browser/documents-decisions.spec.ts`

- [ ] **Step 1: Write tests**
  - First selection (S1 copy without final): expand, "Use as final…", confirm, focus on the new Final row's View link, live text "{label} is now the final result.".
  - Replace: "Replace…" on another row, message names both labels, "Replace".
  - Keep: activate "Keep as final" unchecked → "Check the box to confirm you reviewed these changes."; check → "Kept …"; focus on "Submissions" heading.
  - Correction accepted after keep raises it again (S3: accept v3 through the API as the reviewer, reload, notice shows "v3 (Accepted) corrects the text of the final result.").
  - Round superseded stays acknowledged after a hold, resume and reopen (S11 variant via API calls).
  - Next decision link moves focus to the next matching row under `decision=all`.
  - Resolved vs Changed: keep on this page → "Resolved"; assign new work through the API on a missing-final row, focus window → "Changed: Work assigned".
  - Conflict: open Keep, change the selection through the API as another lead, confirm → conflict message with "Changed by {lead} at …", "Review again" reloads.
  - 401: open confirm, delete the session cookie (`context.clearCookies()`), confirm → "Your session ended. Nothing was saved. Sign in and confirm again."
  - S12: "Resume task" opens the report page with "Release selected pauses" preselected; applying and going back shows "Resolved".
  - S15: own submission's "Use as final…" has `aria-disabled="true"` and the reason text; activation announces it.
- [ ] **Step 2: Run** `npm --prefix frontend run test:e2e -- documents-decisions.spec.ts`; Expected PASS. **Commit point (later)**.

### Task 7.4: Keyboard, screen reader semantics and deep links

**Files:** Create `frontend/browser/documents-a11y.spec.ts`

- [ ] **Step 1: Write tests**
  - Tab-only order through bar segments, filters, group header, row disclosure, Open, Select (no arrow-key roving).
  - Accessible names of group headers, row disclosures, Open, View; `h2` "Needs your decision"; `aria-current="page"` on the active segment.
  - Live announcements: "{k} texts shown", "Previous confirmation closed.", "Saving…", success/conflict outcomes (read the `role=status` region text).
  - Deep links: `case`, `language`, `decision`, `final`, `open` (repeated), `page`; unknown case EmptyState; pinned row "This no longer needs your decision."; back from report page and from the case viewer restores the query (compare `page.url()`).
  - axe: `new AxeBuilder({ page }).include("main").analyze()` with no violations on: default view, decision filter, expanded S0 row with open Keep confirm, 390 px cards (pattern from `frontend/browser/design.spec.ts`).
- [ ] **Step 2: Run** `npm --prefix frontend run test:e2e -- documents-a11y.spec.ts`; Expected PASS. **Commit point (later)**.

### Task 7.5: Layout, forced colours, reduced motion

**Files:** Extend `frontend/browser/documents-a11y.spec.ts`

- [ ] **Step 1: Write tests**
  - 320 CSS px: `page.setViewportSize({ width: 320, height: 800 })`; `document.documentElement.scrollWidth <= 320`; primary facts (heading, version, final, Open) visible without horizontal scroll.
  - 390 px: every interactive element in a card (links, buttons, checkboxes) has `getBoundingClientRect()` width **and** height ≥ 24 (a minimum, WCAG 2.5.8; never assert an exact size). Exceptions per WCAG 2.5.8 are excluded explicitly and listed in the test: links inside a sentence of running text (the "inline" exception) and targets whose 24 px circle centred on the target does not intersect another target (the "spacing" exception; compute it from the bounding boxes rather than skipping silently).
  - Forced colours: `page.emulateMedia({ forcedColors: "active" })`; the Final row's first cell has a non-zero `border-left-width`; status pills have a border; the focused element has `outline-style` not `none`; the active segment's `border-bottom-color` differs from the inactive one.
  - Reduced motion: `page.emulateMedia({ reducedMotion: "reduce" })`; the chevron's computed `transition-duration` is `0s`.
- [ ] **Step 2: Run**; Expected PASS. **Commit point (later)**.

### Task 7.6: Update existing browser specs and run the full browser gate

These spec files are shared with sibling plans (several are modified in the worktree already): P7 owns them only while no sibling WP does.

- [ ] **Step 1**: In `final-workflow.spec.ts`, `variants.spec.ts`, `variant-admin.spec.ts`, `decision-semantics.spec.ts`, `translations.spec.ts`, `workflow.spec.ts`, `admin.spec.ts`, replace interactions with the Documents tree, `Submissions` dialog button and `FinalResultSelector` select by the new row disclosure, Submissions table and inline confirmations. Keep each test's intent and assertions about server state.
- [ ] **Step 2**: `bash scripts/check.sh --only browser`; Expected: all Playwright specs pass with one worker.
- [ ] **Step 3: Commit point (later)**: `test(browser): Documents table scenarios, decisions and accessibility`.

---

## Phase 8: DESIGN.md (WP X1)

### Task 8.1: Document the new contracts

**Files:** Modify `DESIGN.md` (Components table, Shortcuts, Do's and Don'ts, a new "Grouped expandable table" subsection, a "Forced colours and motion" subsection)

- [ ] **Step 1**: Edit:
  - Components table: add `InlineConfirm` row (props as `ConfirmDialog` minus `open`, plus `children`, `outcome`, `headingLevel`; classes `inline-confirm`, `inline-confirm-title`, `inline-confirm-message`, `inline-confirm-notice`, `inline-confirm-actions`; focus to heading on open; Escape only with focus inside; busy keeps focus via `aria-disabled`).
  - `Button` row: "Loading sets `aria-disabled` and `aria-busy` and swallows activation; it is not natively disabled, so a focused button keeps focus."
  - `DataTable<T>` row: add `groups` (one `tbody` per group, `th scope=rowgroup` header), `renderExpanded(row)` (following full-width `tr.data-table-expanded`), Column `rowHeader`, `busy`; "Sorting applies within groups"; classes `data-table-group`, `data-table-expanded`.
  - Final marker: `StatusBadge tone="success"` "Final" with `IconCheck`, row class `final-row` (`success-light` tint); `is-selected` stays reserved for selection state.
  - Do's: "Use `ConfirmDialog` for confirmation decisions, except confirmations bound to a row inside a table (final-result selection, replacement, reaffirmation), which use `InlineConfirm`."
  - Forced colours and motion: the rules from Task 3.6; expansion and chevron rotation 150 ms, instant under `prefers-reduced-motion`.
  - `useMediaQuery` in the hooks list; `ui/icons.tsx` list unchanged.
- [ ] **Step 2**: Verify the documented class names exist: `grep -rnE "inline-confirm|data-table-expanded|data-table-group|final-row" frontend/src` shows each.
- [ ] **Step 3: Commit point (later)**: `docs: design system for the Documents lead table`.

---

## Final verification (before reporting the feature complete)

- [ ] `bash scripts/check.sh` (complete local gate: static, frontend, backend, browser). Expected final line: "All local checks passed."
- [ ] Manual smoke with the T5 acceptance seed (`examples/t5-acceptance/README.md`): log in as the lead, open Documents, walk S0 (`synthetic-accepted`) through Keep, then check Progress link count and export preflight row links.

## Self-review against the spec

| Spec section | Task(s) |
|---|---|
| Decisions 1 to 8 (central table, row unit, missing-final rule, inline choice, D1 to D4) | 2.1, 2.2a-c, 5.4, 5.6, 5.8, 1.3, 1.5 |
| Data model terms (chains, names, versions, statuses, not newer, rounds, kinds) | 2.1, 2.2a-c, 5.1 |
| Shared rules (person label, rounds, times, recorded_at, findings, labels, long IDs, icons, status shape, aria-disabled, access) | 5.1, 2.2b, 2.2c, 3.1, 5.4, 5.6 |
| Table structure, columns, filters, work wording, issues and notes, missing-final, last activity, bulk, narrow | 3.4, 5.4, 5.5, 5.6, 2.2a, 2.2b |
| Needs your decision bar, route query, behaviour, resolved rows, loading/refresh/errors | 5.3, 4.1, 4.2, 5.6, 5.9, 5.2 |
| Expanded row (Issues, Submissions, notice, table, confirmations, More, InlineConfirm) | 5.7, 5.8, 3.3 |
| Changes elsewhere (Progress, preflight, report back link, history dialog) | 6.1 to 6.4 |
| Design system changes | 3.1, 3.3, 3.4, 3.6, 8.1 |
| Backend and API (one projection, cause changes, selected_at, endpoints, VersionRef) | 1.1 to 1.6, 2.2a to 2.6 |
| Contracts preserved | 1.5, 1.6, 5.8, 7.3 |
| Edge cases | 5.7, 5.8, 7.1 (S4, S14, S15) |
| Testing (unit, component, contract, browser) | 1.x, 2.x, 3.x, 5.x, 7.x |

## Review disposition

Codex review `ontocurator-reviews/2026-10-19-plan-documents-lead-table-codex.md` (10 findings). Each was checked against the code before it was applied.

| # | Finding | Verified against | Disposition |
|---|---|---|---|
| 1 | P1 Keep accepts a subset of the current warnings | `final_results.py:135-161` (`issubset`) | Applied: exact set comparison under the exclusive lock, 409 with details; tests for addition, removal and status change (Task 1.4); client sends the complete set captured at open (Task 5.8). |
| 2 | P1 Migration could acknowledge an unseen acceptance; status lookup not project-scoped | `tables.py` (`documents` primary key `(project_id, document_id)`) | Applied: the migration rewrites only round ids; old 3-part text acks stay unchanged (open question 2 default changed); test with identical ids in two projects (Task 1.2). |
| 3 | P2 Migration test violates the `derived_from` foreign key | `tables.py:176-178` | Applied: valid root inserted first; selections and event payloads asserted unchanged (Task 1.2). |
| 4 | P2 Current adjudication rule missing from the read contract | Task 2.2 row contract | Applied: page and submissions expose the current rule; the final keeps its snapshot plus `is_mine`; UI decides from the current rule; toggle test (Tasks 2.2b, 2.2c, 2.4, 5.8). |
| 5 | P2 Retained rows cannot be refreshed | Task 2.2 decision filter, Task 5.9 | Applied: repeated `retain` query parameter returns retained rows with current data; badge compares stored snapshot with the current row; tests for own and external resolution (Tasks 2.2a, 2.2b, 2.4, 2.6, 5.2, 5.9). |
| 6 | P2 Cause-equality test compares different projections | Task 2.2 test vs issue derivation | Applied: comparison restricted to `SHARED_CAUSE_CODES`; Documents-only derivations tested separately and asserted absent from the preflight (Task 2.2b). |
| 7 | P2 Compare deep link not forwarded by `App` | `App.tsx:197` passes only `variant`, `annotations`, `documents` | Applied: E3 owns the `projectCase` line in `App.tsx`; App-level route test (Task 6.4). |
| 8 | P2 Non-lead history has no authorized View path | `authz/versions.py` (`own` refs only for non-leads) | Applied: `SubmissionsTable` takes a caller-supplied `viewRoute`; non-leads use `own` refs; tests in Tasks 2.5 and 6.4. |
| 9 | P2 Work units too broad | Tasks 2.2 and 7.1 | Applied: 2.2 split into 2.2a/b/c with the `RowFacts` interface and separate modules; 7.1 split into 7.1a/b/c with separate scenario modules; `application/document_rows.py` and `tests/browser_server.py` each have one owner WP. |
| 10 | P3 Target-size assertion requires exactly 24 x 24 px | Plan Task 7.5 ("width and height ≥ 24") and Task 5.5 CSS (`min-height`/`min-width`) | Rejected in substance: the plan already asserted a minimum, not an exact size. Clarified anyway: checkboxes are included in the CSS and the assertion, and the WCAG 2.5.8 inline and spacing exceptions are handled explicitly (Tasks 5.5, 7.5). |
