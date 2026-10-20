# Lead Workflow Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the seven lead-workflow follow-ups F1 to F7 specified in [2026-10-20-lead-followups-design.md](../specs/2026-10-20-lead-followups-design.md): the lead's own correction of a rejected or queried translation, exact Progress → Documents links, complete filters for batch assignment, person references in problem reports, Resolve focus, a CLI connect timeout, and one live region on the translation review screen.

**Architecture:** F1 adds migration `0017_lead_corrections` (`assignments.lead_correction`), one start endpoint in `api/translation_workflow_routes.py`, an authority branch in `authz/visibility.py` and a decision rule in `TranslationReviewService.submit`; the Documents UI reaches it from the Resolve options and the Translation review stage block. F2/F3 widen `RowQuery`/`DocumentRowFilters` (`final=any`, repeatable `step`/`stage`/`plan`, `paused`, `q`, `decision`) and let `application/progress.py` count through the Documents predicate with server-owned link queries. F4 adds `PersonRefView` fields to the problem report read model. F5, F6, F7 are local changes.

**Tech Stack:** as the lead plan (Python 3.12, FastAPI, SQLAlchemy 2, Alembic, PostgreSQL; React 18, TypeScript, Vitest, Playwright + axe-core; `openapi-typescript`).

**Binding inputs:** the follow-up spec above; the lead spec [2026-10-20-lead-workflow-design.md](../specs/2026-10-20-lead-workflow-design.md) (D1 to D26 stay); `build/lead-workflow/orchestration-notes.md`; `PRODUCT.md`; `DESIGN.md`.

---

## Global rules (every WP; a subagent reads only this section and its WP block)

The **Global rules 1 to 14 of [the lead plan](2026-10-20-lead-workflow.md#global-rules-every-wp-a-subagent-reads-only-this-section-and-its-wp-block) apply unchanged** (worktree `C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation`, Git Bash `/c/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation`, branch `feat/lead-workflow`; no commits/stash/reset/checkout/clean by subagents; exclusive Owns; prerequisites first; `grep -rnE` instead of `rg`; ≤ 2 heavy, ≤ 3 light; Vitest `--maxWorkers=4 --minWorkers=1`; Playwright one at a time with `HPO_E2E_PORT=18765`; contracts only regenerated; additive API; English, icons from `ui/icons.tsx`, `aria-disabled` + reason; TDD; hand-back format). A subagent reads that section too. Changes and additions for this plan:

- **R11 (migration):** this plan creates `0017_lead_corrections` (`down_revision = "0016"`). Nothing else adds a migration.
- **R8 (backend tests):** single files `uv run pytest tests/<file>.py -q`. Once T1 (pytest-xdist, commit `da28885` on `feat/review-annotation-flow`) is merged into `feat/lead-workflow` (check: `grep -n "pytest-xdist" pyproject.toml`), multi-file and full backend runs use `uv run pytest -n 4 …`; before that, never pass `-n`.
- **R9 (contracts writers):** F4a, F1a, F2a regenerate contracts, one at a time, in the order they reach their contracts step; the orchestrator grants the slot and commits the writer before the next one regenerates.
- **Branch-foreign WPs:** F1c and F7 run on `feat/review-annotation-flow` in `C:/Users/jan-p/Development/ontocurator/.worktrees/review-annotation` (Git Bash `/c/Users/jan-p/Development/ontocurator/.worktrees/review-annotation`) under that branch's plan rules; the orchestrator of that branch commits them. They never touch `feat/lead-workflow`.
- **Foreign files in flight:** another agent currently edits `tests/browser_server.py` and existing `frontend/browser/*.spec.ts` on this branch. No WP of this plan writes those files; FB starts only after the orchestrator confirms that work is committed.
- **Review:** F1a and F4a get one read-only review (`superpowers:code-reviewer` agent or `agy` with gemini-3.8-flash), then one fix agent at effort medium. No Codex.

## Work packages

| WP | Content | Size | Lane | Branch | Depends on | Review |
|---|---|---|---|---|---|---|
| F1a | Lead correction backend: migration 0017, authority branch, start endpoint, submit rule, Review turn-on, error code, contracts | L | H | lead | — | yes |
| F1b | Documents: "Correct the translation…" panel in Resolve options and Translation block, navigation to the task | M | L+ | lead | F1a, F5, F2b | — |
| F1c | Translation review screen in lead-correction mode | S | L | review-annotation | F1a merged into that branch, F7 | — |
| F2a | Filter vocabulary (`final=any`, repeatable `step`/`stage`/`plan`, `paused`, `q`/`decision` in `DocumentRowFilters`), `bar.finals`, Progress counts via the Documents predicate with link queries, contracts (covers F3 backend) | M | H | lead | — | — |
| F2b | Frontend: router multi-values, client serialization, exact Progress links, Export link from `bar.finals`, `selectionFilters` with all filters (covers F3 frontend) | M | L+ | lead | F2a, F5 | — |
| F4a | PersonRef fields in problem report views, contracts | S | H | lead | — | yes |
| F4b | Problem report UI shows "Name (ann-…)" for leads | S | L+ | lead | F4a | — |
| F5 | Resolve focus into the Translation block | S | L+ | lead | — | — |
| F6 | CLI connect timeout | S | L | lead | — | — |
| F7 | One live region for the submit reason below 1100 px | S | L | review-annotation | — | — |
| FB | Browser: lead correction scenario and Progress click-through | M | PW | lead | F1b, F2b, F4b, foreign browser work committed | — |

## Shared-file chains (one writer at a time, in this order)

| File(s) | Writers in order |
|---|---|
| `contracts/openapi.json`, `frontend/src/api/generated.ts`, `frontend/src/api/client.ts` | F4a, F1a, F2a (order of arrival, R9) |
| `src/ontocurator/domain/admin_error_codes.py`, `contracts/admin-error-codes.json`, `frontend/src/admin/errors.ts`, `src/ontocurator/api/app.py` | F1a only |
| `frontend/tests/documents/fixtures.ts` | F5 → F2a (defaults only) → F2b → F1b |
| `frontend/src/admin/DocumentsPage.tsx`, `frontend/tests/documentsPage.test.tsx` | F5 → F2b → F1b |
| `frontend/src/documents/StageBlocks.tsx`, `frontend/src/documents/ResolveTranslation.tsx`, `frontend/tests/documents/stageBlocks.test.tsx`, `frontend/tests/documents/resolveTranslation.test.tsx` | F5 → F1b |
| `frontend/src/translation/ReviewForm.tsx`, `frontend/tests/reviewForm.test.tsx`, `frontend/tests/translationReview.test.tsx` (branch review-annotation) | F7 → F1c |

## Wave schedule

| Wave | Heavy lane (≤ 2) | Light lane (≤ 3) | Notes |
|---|---|---|---|
| 1 | F1a, F4a | F5 (L+), F6, F7 (other branch) | F4a is small and takes the first contracts slot. |
| 2 | F2a (after F4a) | F4b (L+) | F1a may still run; F2a takes the contracts slot after F1a. |
| 3 | — | F2b (L+) | |
| 4 | — | F1b (L+) | Full Vitest at the end in a heavy slot. |
| 5 | FB (PW) | F1c (other branch, after the branch merge) | FB alone with Playwright. |
| 6 | Final gate (alone) | — | See "Final gate". |

## WP blocks

### F1a: Lead correction backend

- **Goal:** a lead can review a rejected or queried version themselves and submit it only as "Accepted with corrections".
- **Spec:** "F1" (FD1 to FD9, API).
- **Owns:** `src/ontocurator/storage/migrations/versions/0017_lead_corrections.py` (create), `src/ontocurator/storage/tables.py` (`AssignmentRow.lead_correction` only), `src/ontocurator/authz/visibility.py`, `src/ontocurator/assignments/service.py` (`Assignment.lead_correction`, `_assignments()` select, `_create(..., lead_correction=False)`), `src/ontocurator/application/translation_workflow.py` (`start_lead_correction`), `src/ontocurator/application/translation_reviews.py` (decision rule, workspace flag), `src/ontocurator/api/translation_workflow_routes.py`, `src/ontocurator/api/translation_review_routes.py` (workspace view field), `src/ontocurator/api/assignment_routes.py` (`AssignmentView.lead_correction` only), `src/ontocurator/domain/translation_review.py` (issue code only), `src/ontocurator/domain/admin_error_codes.py`, `contracts/admin-error-codes.json`, `frontend/src/admin/errors.ts`, `src/ontocurator/api/app.py` (status of the new code), `tests/test_lead_correction.py` (create), `tests/test_schema.py` (head expectation only, if it pins the head), `contracts/openapi.json`, `frontend/src/api/generated.ts`, `frontend/src/api/client.ts` (`startLeadCorrection`), `frontend/tests/leadCorrectionClient.test.ts` (create). If `domain/next_steps.py` needs a change for FD9, stop and report.
- **Size / lane / review:** L / heavy / yes.
- **Code to read:** `application/translation_workflow.py:41-200` (`assign_correction`, `_plan_review`), `application/translation_reviews.py:100-200, 380-548` (`_authority`, `submit`), `assignments/service.py:260-460`, `assignments/eligibility.py:80-140`, `authz/visibility.py:50-120`, `authz/policy.py:19-30, 148`, `application/work_plans.py` (`turn_review_on`), `domain/translation_review.py` (`next_status`, `check_review`).
- **Prerequisites:** `grep -n "def turn_review_on" src/ontocurator/application/work_plans.py`; `ls src/ontocurator/storage/migrations/versions/ | grep -c "^0017"` prints `0`.

- [ ] **Step 1: Failing tests** (`tests/test_lead_correction.py`, heavy): `test_lead_starts_correction_of_rejected_version` (assignment `lead_correction=True`, user = lead, audit `translation.lead_correction_started`), `test_start_is_idempotent_for_the_same_lead`, `test_lead_submits_accepted_corrected_creates_accepted_child` (child `origin=correction`, `accepted`; parent stays `reviewed`; record reviewer = lead), `test_other_decisions_are_refused` (`REVIEW_INVALID`, issue `LEAD_CORRECTION_DECISION`), `test_child_is_assignable_for_annotation` (`annotate_accepted_translations_only` on), `test_refusals` (parametrized: accepted / pending → `LEAD_CORRECTION_NOT_AVAILABLE` `not_rejected_or_queried`; older version → `not_newest`; open review of another reviewer → `review_open`; stale hash → `VARIANT_REVIEW_STALE`; discarded → `NOT_IN_WORK_PLAN`; annotator caller → the existing management refusal (403, as `assign_correction`)), `test_review_off_is_turned_on` (audit `work_plan.update`, revision +1, no consequences), `test_language_and_qualification_checked_at_start`, `test_authority_ends_with_lead_role`, `test_lead_is_not_offered_as_translation_reviewer` (members eligibility and `TASK_ROLES` unchanged), `test_open_lead_correction_shows_in_progress_owned_by_lead` (`GET document-rows`: `translation_review_in_progress`, owner = lead).
- [ ] **Step 2:** `uv run pytest tests/test_lead_correction.py -q` → FAIL.
- [ ] **Step 3: Implement.** Migration `0017` (`op.add_column("assignments", sa.Column("lead_correction", sa.Boolean(), nullable=False, server_default=sa.false()), schema=SCHEMA)`; downgrade drops it). Authority branch in `qualifying_assignment` and the `TASK_ROLES`-built readable predicate. `start_lead_correction(actor, key, document_id, *, expected_text_sha256, confirm_language)` under the same locks as `assign_correction`: lead check, FD3 checks (latest `TranslationReviewRow.decision` of the version in `rejected`/`query`, newest in chain, no open translation review by another user), FD5 via `_plan_review`, FD6 checks, `_create(..., lead_correction=True)` with the role check bypassed only for this path, audit. `submit`: if `assignment.lead_correction` and decision ≠ `accepted_corrected` → `REVIEW_INVALID` `{"issues": ["LEAD_CORRECTION_DECISION"]}`. Route `POST /projects/{key}/documents/{doc:path}/lead-correction`. New code `LEAD_CORRECTION_NOT_AVAILABLE` (409).
- [ ] **Step 4:** Step 2 → PASS; `uv run pytest tests/test_translation_workflow.py tests/test_translation_review_task.py tests/test_assignments.py tests/test_schema.py -q` (add `-n 4` after T1, R8).
- [ ] **Step 5: Contracts** (slot from the orchestrator, R9): regenerate OpenAPI, TS and error codes; `client.ts` `startLeadCorrection(key, documentId, body)`; `frontend/tests/leadCorrectionClient.test.ts` `it("posts the lead correction")`.
- [ ] **Step 6: Verify:** Step 4 commands; `bash scripts/check.sh --only static`; `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/leadCorrectionClient.test.ts`.
- **Done:** FD1 to FD9 hold; leads are not listed as translation reviewers; additive contract.
- **Commit:** `feat(translation-review): lead corrects a rejected or queried translation`

### F1b: Documents entry to the lead correction

- **Goal:** from Resolve and from the Translation block the lead reaches the review screen in one confirmation.
- **Spec:** "F1 › UI" (Resolve options, expanded row).
- **Owns:** `frontend/src/documents/ResolveTranslation.tsx`, `frontend/src/documents/LeadCorrectionPanel.tsx` (create), `frontend/src/documents/StageBlocks.tsx`, `frontend/src/admin/DocumentsPage.tsx` (`onCorrect` wiring only), tests `frontend/tests/documents/leadCorrectionPanel.test.tsx` (create), `resolveTranslation.test.tsx`, `stageBlocks.test.tsx`, `fixtures.ts`, `frontend/tests/documentsPage.test.tsx`.
- **Size / lane / review:** M / L+ / —.
- **Prerequisites:** `grep -n "startLeadCorrection" frontend/src/api/client.ts`; `grep -n "translationSlot" frontend/src/documents/StageBlocks.tsx` (F5); `grep -n "finals" frontend/src/documents/DecisionBar.tsx frontend/src/admin/DocumentsPage.tsx` (F2b done).

- [ ] **Step 1: Failing tests.** `leadCorrectionPanel.test.tsx`: `it("explains v{n} → v{n+1} and opens the translation review")` (posts with `expected_text_sha256`, navigates to `{ name: "task", assignmentId }`), `it("asks for language confirmation only on LANGUAGE_CONFIRMATION_REQUIRED")`, `it("shows the qualification message with a profile link")`, `it("shows LEAD_CORRECTION_NOT_AVAILABLE reasons in words")`. `resolveTranslation.test.tsx`: `it("Correct the translation… opens the panel")`, `it("reads Continue your correction while the lead holds one")`. `stageBlocks.test.tsx`: `it("offers Correct the translation yourself… only for resolve_rejected and resolve_queried")`. `documentsPage.test.tsx`: `it("no longer navigates to the case viewer for Correct the translation…")`.
- [ ] **Step 2:** run → FAIL; implement; run → PASS.
- [ ] **Step 3: Verify:** owned test files; `npm --prefix frontend run typecheck`; full Vitest suite at the end (heavy slot).
- **Done:** both entries work; no case-viewer detour; copy as the spec.
- **Commit:** `feat(documents): lead corrects a rejected or queried translation from Resolve`

### F1c: Translation review screen in lead-correction mode (branch feat/review-annotation-flow)

- **Goal:** the screen guides the lead to "Accepted with corrections".
- **Spec:** "F1 › UI" (Translation review screen).
- **Worktree:** `C:/Users/jan-p/Development/ontocurator/.worktrees/review-annotation`; that branch's Global rules apply.
- **Owns:** `frontend/src/translation/TranslationReviewScreen.tsx`, `frontend/src/translation/ReviewForm.tsx`, `frontend/src/translation/labels.ts`, `frontend/tests/translationReview.test.tsx`, `frontend/tests/reviewForm.test.tsx`.
- **Size / lane / review:** S / L / —.
- **Prerequisites:** `grep -n "lead_correction" frontend/src/api/generated.ts` (branch merge with regenerated contracts done); F7 committed on that branch.

- [ ] **Step 1: Failing tests.** `translationReview.test.tsx`: `it("lead correction shows only Accepted with corrections, preselected, with the lead note")`, `it("lead correction hides Report a problem and offers Back to Documents after submit")`. `reviewForm.test.tsx`: `it("maps LEAD_CORRECTION_DECISION to its message")`.
- [ ] **Step 2:** run → FAIL; implement; run → PASS.
- [ ] **Step 3: Verify:** owned tests; typecheck; that branch's full Vitest when its orchestrator grants a heavy slot.
- **Commit:** `feat(translation-review): lead-correction mode`

### F2a: Filter vocabulary, project final count, Progress via the Documents predicate

- **Goal:** every Progress count is exactly the rows its link shows; batch filters equal Documents filters.
- **Spec:** "F2" (FD10 to FD12, link table), "F3".
- **Owns:** `src/ontocurator/application/document_rows.py` (`RowQuery`), `src/ontocurator/application/document_row_page.py` (predicates, `finals`), `src/ontocurator/api/document_row_routes.py` (`_filters`, `DecisionBarView.finals`), `src/ontocurator/api/assignment_batch_routes.py` (`DocumentRowFilters`), `src/ontocurator/application/progress.py`, `src/ontocurator/api/project_routes.py` (`ProgressStageView.links`, `DocumentLinkQuery`), `tests/document_rows_support.py`, `tests/test_document_rows_filters_multi.py` (create), `tests/test_progress_links.py` (create), expectation-only edits in `tests/test_progress_stages.py`, `tests/test_document_rows_api.py`, `tests/test_assignment_batch.py`, `contracts/openapi.json`, `frontend/src/api/generated.ts`, `frontend/src/api/client.ts` (types, repeated-parameter serialization), `frontend/tests/documents/fixtures.ts` (defaults only), `frontend/tests/progressExportClient.test.ts`.
- **Size / lane / review:** M / heavy / —.
- **Code to read:** `application/document_row_page.py:700-860` (`_matches_*`, `_row_level_matches`, `_apply_filters`), `application/progress.py`, `api/document_row_routes.py:262-440`, `api/assignment_batch_routes.py:20-80, 140-220`, `assignments/batch.py:313-360`, `domain/next_steps.py` (`WAITING_FOR_REVIEW_STEPS`, `row_stage`).
- **Prerequisites:** `grep -n "def progress_view" src/ontocurator/application/progress.py`.

- [ ] **Step 1: Failing tests.** `tests/test_document_rows_filters_multi.py` (heavy): `test_final_any_lists_rows_with_a_final`, `test_repeated_step_is_or` (one value unchanged), `test_repeated_stage_and_plan_are_or`, `test_paused_yes_no_only_counts_annotate_and_review_holds`, `test_case_ids_endpoint_accepts_the_same_filters`, `test_bar_finals_is_project_wide` (unchanged by filters and paging). `tests/test_progress_links.py` (heavy): `test_every_count_equals_its_documents_link` (D15-like fixture plus a corrected v2, a held annotation, a Review-off accepted package row: for each card and count, `count == bar.shown` of `GET document-rows` with `links[count]`), `test_links_match_the_spec_table`. `tests/test_assignment_batch.py`: `test_summary_not_shown_respects_q_and_decision`, `test_preview_accepts_all_documents_filters` (incl. `q`, `decision`, lists; targets and order unchanged), `test_decision_with_final_or_segment_is_422`.
- [ ] **Step 2:** `uv run pytest tests/test_document_rows_filters_multi.py tests/test_progress_links.py tests/test_assignment_batch.py -q` → FAIL.
- [ ] **Step 3: Implement.** `RowQuery`: `step`, `stage`, `plan` as `tuple[...]` (empty = no filter), `final` adds `"any"`, `paused: Literal["yes","no"] | None`; `_filters` takes `list[...] | None = Query(None)`; `DocumentRowFilters` mirrors `_filters` exactly (incl. `q`, `decision`, the exclusivity validator) and builds `RowQuery`. Progress: one predicate entry `row_matches(ctx, row, query)` exported by `document_row_page.py`; `progress.py` builds the context once, holds the link table (spec) and counts each link; `ProgressStageView.links: dict[str, DocumentLinkQuery] = Field(default_factory=dict)`; list every count whose value changed in the hand-back. `DecisionBarView.finals: int = 0`.
- [ ] **Step 4:** Step 2 → PASS; `uv run pytest tests/test_progress_stages.py tests/test_progress_export_api.py tests/test_document_rows_api.py tests/test_document_rows_page.py tests/test_assignment_batch.py -q` (`-n 4` after T1).
- [ ] **Step 5: Contracts** (slot, R9): regenerate; `client.ts` sends array filters as repeated parameters in `listDocumentRows`, `listDocumentCaseIds`; `progressExportClient.test.ts` `it("reads progress links")`; fixtures defaults (`finals: 0`, `links: {}`).
- [ ] **Step 6: Verify:** Step 4 commands; `bash scripts/check.sh --only static`; `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/progressExportClient.test.ts tests/documents/client.test.ts`.
- **Done:** contract test green for every count; one-value filters behave as before; additive contract.
- **Commit:** `feat(documents): exact filters for Progress links and batch selection`

### F2b: Exact links, Export link and complete selection filters in the frontend

- **Goal:** Progress links are the server's queries; Documents understands them; batch and summary get every filter.
- **Spec:** "F2", "F3".
- **Owns:** `frontend/src/app/router.ts`, `frontend/tests/router.test.ts`, `frontend/src/admin/progressLabels.ts`, `frontend/src/admin/ProgressPage.tsx`, `frontend/src/admin/DocumentsPage.tsx` (`selectionFilters`, request building, Export link), `frontend/src/documents/DecisionBar.tsx`, tests `frontend/tests/progressLabels.test.ts`, `progressPage.test.tsx`, `documentsPage.test.tsx`, `documents/fixtures.ts`, `documents/decisionBar.test.tsx`.
- **Size / lane / review:** M / L+ / —.
- **Prerequisites:** `grep -n "links" frontend/src/api/generated.ts | head -1`; `grep -n "finals" frontend/src/api/generated.ts | head -1`; `grep -n "translationSlot" frontend/src/documents/StageBlocks.tsx` (F5 committed: chain on `DocumentsPage.tsx`).

- [ ] **Step 1: Failing tests.** `router.test.ts`: `it("round-trips comma-joined step, stage and plan")`, `it("keeps final=any and paused")`. `progressLabels.test.ts`/`progressPage.test.tsx`: `it("links every count to the server's query")` (no local query table left). `documentsPage.test.tsx`: `it("selection filters include q and decision")`, `it("shows Export final results… when bar.finals > 0 even if no shown case has a final")`, `it("shows a readable filter label for multi-value filters")`.
- [ ] **Step 2:** run → FAIL; implement; run → PASS.
- [ ] **Step 3: Verify:** owned tests; typecheck; full Vitest at the end (heavy slot).
- **Done:** no "closest filter" comment left; Export link independent of the page.
- **Commit:** `feat(progress): exact Documents links; complete selection filters`

### F4a: PersonRef in problem report views

- **Goal:** leads get display names in problem reports; others keep pseudonyms.
- **Spec:** "F4".
- **Owns:** `src/ontocurator/application/problem_report_views.py`, `tests/test_problem_report_person_refs.py` (create), expectation-only edits in `tests/test_problem_report_views.py`, `tests/test_problem_report_blinding.py`, `contracts/openapi.json`, `frontend/src/api/generated.ts`, `frontend/src/api/client.ts` (types only), `frontend/tests/problems/fixtures.ts` (defaults only).
- **Size / lane / review:** S / heavy / yes.
- **Code to read:** `application/problem_report_views.py` (all label sites: lines ~150-500), `application/people.py`, `api/person_views.py`, `api/problem_report_routes.py`.
- **Prerequisites:** `grep -n "def person_refs" src/ontocurator/application/people.py`.

- [ ] **Step 1: Failing tests** (`tests/test_problem_report_person_refs.py`, heavy): `test_lead_sees_names_for_reporter_holds_candidates_events`, `test_reporter_sees_only_pseudonyms_of_others_and_own_name_marked_is_me`, `test_labels_unchanged` (`*_label` strings identical to before), `test_blinding_rules_still_hold` (no new field leaks to non-leads).
- [ ] **Step 2:** run → FAIL; implement (one `person_refs` call per view build, `viewer_is_lead` from the existing view flag); run → PASS; `uv run pytest tests/test_problem_report_views.py tests/test_problem_report_blinding.py tests/test_problem_reports_api.py -q`.
- [ ] **Step 3: Contracts** (slot, R9); fixture defaults (`reporter: null`, …).
- [ ] **Step 4: Verify:** Step 2 commands; `bash scripts/check.sh --only static`.
- **Commit:** `feat(problem-reports): person references for leads`

### F4b: Problem report UI with display names

- **Owns:** `frontend/src/problems/*` (as needed), `frontend/src/tasks/ProblemReportDetail.tsx` (labels only), tests `frontend/tests/problems/leadReportPage.test.tsx`, `frontend/tests/problems/reportTimeline.test.tsx`, `frontend/tests/problems/fixtures.ts`.
- **Size / lane / review:** S / L+ / —.
- **Prerequisites:** `grep -n "PauseCandidate" -A12 frontend/src/api/generated.ts | grep -n "owner"`.

- [ ] **Step 1: Failing tests.** `leadReportPage.test.tsx`: `it("shows Name (ann-…) for reporter, pauses and candidates to a lead")`, `it("Release pause search matches display names")`, `it("confirmation copy names the reporter as Name (ann-…)")`; `reportTimeline.test.tsx`: `it("event actors use personLabel")`; `reporterDialog.test.tsx` unchanged (pseudonyms).
- [ ] **Step 2:** run → FAIL; implement with `personLabel(ref, { fallback: label })`; run → PASS.
- [ ] **Step 3: Verify:** owned tests; typecheck; full Vitest at the end (heavy slot).
- **Commit:** `feat(problem-reports): display names for leads`

### F5: Resolve focuses the Translation block

- **Owns:** `frontend/src/documents/StageBlocks.tsx` (`translationSlot` prop), `frontend/src/admin/DocumentsPage.tsx` (row panel placement, expansion, focus), `frontend/src/documents/ExpandedRow.tsx` (pass the slot), tests `frontend/tests/documents/stageBlocks.test.tsx`, `frontend/tests/documentsPage.test.tsx`, `frontend/tests/documents/fixtures.ts`.
- **Size / lane / review:** S / L+ / —.
- **Prerequisites:** `grep -n "export function stageBlockHeadingId" frontend/src/documents/StageBlocks.tsx`.

- [ ] **Step 1: Failing tests.** `documentsPage.test.tsx`: `it("Resolve… expands the row and focuses the Translation review heading")`, `it("renders the options inside the Translation review block")`, `it("Cancel and Escape return focus to the row's Resolve… button")`, `it("falls back to options below the row when there is no Translation block")`, `it("cards behave the same")`. `stageBlocks.test.tsx`: `it("renders translationSlot inside the Translation review block")`.
- [ ] **Step 2:** run → FAIL; implement; run → PASS.
- [ ] **Step 3: Verify:** owned tests; typecheck; full Vitest at the end (heavy slot).
- **Commit:** `fix(documents): Resolve focuses the Translation review block`

### F6: CLI connect timeout

- **Owns:** `src/ontocurator/storage/database.py`, `src/ontocurator/storage/schema.py` (`upgrade` engine only), `tests/test_cli_connect_timeout.py` (create).
- **Size / lane / review:** S / light (no database) / —.
- **Prerequisites:** `grep -n "pool_pre_ping=True" src/ontocurator/storage/database.py`.

- [ ] **Step 1: Failing tests** (light): `test_database_sets_connect_timeout` (engine `connect_args` / dialect `create_connect_args` contains `connect_timeout=10`), `test_url_connect_timeout_wins`, `test_upgrade_sets_connect_timeout`, `test_cli_unreachable_database_fails_fast` (Typer `CliRunner`, a command that uses `_open_database` with `--database-url postgresql://u:p@192.0.2.1:5432/x`, `CONNECT_TIMEOUT_SECONDS` monkeypatched to 2: exit 1, output contains `DATABASE_UNAVAILABLE`, elapsed < 8 s).
- [ ] **Step 2:** `uv run pytest tests/test_cli_connect_timeout.py -q` → FAIL; implement (`CONNECT_TIMEOUT_SECONDS = 10`; `connect_args={"connect_timeout": …}` unless `"connect_timeout" in parsed.query`); → PASS.
- [ ] **Step 3: Verify:** `uv run ruff check src tests && uv run ruff format --check src tests && uv run mypy src`; `uv run pytest tests/test_cli.py tests/test_cli_db.py -q` (heavy: run when the orchestrator grants a slot).
- **Commit:** `fix(cli): fail fast when the database is unreachable`

### F7: One live region for the submit reason (branch feat/review-annotation-flow)

- **Worktree:** `C:/Users/jan-p/Development/ontocurator/.worktrees/review-annotation`; that branch's Global rules apply; its orchestrator schedules and commits it when the files are free.
- **Owns:** `frontend/src/translation/ReviewForm.tsx`, `frontend/tests/reviewForm.test.tsx`, `frontend/tests/translationReview.test.tsx`.
- **Size / lane / review:** S / L / —.
- **Prerequisites:** `grep -n 'aria-live="polite"' frontend/src/translation/ReviewForm.tsx` (the double region still exists).

- [ ] **Step 1: Failing tests.** `reviewForm.test.tsx`: `it("issue list is not a live region")`. `translationReview.test.tsx`: `it("below 1100 px exactly one live region carries the submit reason")` (count elements with `aria-live` whose text contains the first issue message: 1), `it("at 1100 px and wider the reason is announced once in the rail")`.
- [ ] **Step 2:** run → FAIL; remove `aria-live` from `ol.review-issues` in `ReviewForm.tsx`; run → PASS.
- [ ] **Step 3: Verify:** owned tests; typecheck.
- **Commit:** `fix(translation-review): announce the submit reason once below 1100 px`

### FB: Browser verification

- **Goal:** the lead correction and the Progress click-through work end to end.
- **Owns:** `tests/browser_lead_workflow_scenarios.py` (one new builder `rejected_translation_for_lead`), `tests/test_browser_lead_workflow_fixture.py`, `frontend/browser/lead-workflow.spec.ts`, `frontend/browser/leadWorkflowHelpers.ts`. Not `tests/browser_server.py` (the existing route serves the new builder).
- **Size / lane / review:** M / PW / —.
- **Prerequisites:** F1b, F2b, F4b committed; orchestrator confirms the foreign browser work is committed (`git status --short tests/browser_server.py frontend/browser` clean).

- [ ] **Step 1:** fixture test `test_rejected_translation_for_lead_builds` → FAIL; builder; → PASS (`uv run pytest tests/test_browser_lead_workflow_fixture.py -q`).
- [ ] **Step 2:** specs: `test("lead corrects a rejected translation and annotation becomes assignable")` (Resolve… focus on the Translation heading, Correct the translation…, review screen, submit, row shows Assign annotation); `test("every Progress count opens Documents with the same number of rows")`; `test("problem report shows Name (ann-…) to the lead")`; axe on the new panel.
- [ ] **Step 3: Verify:** `HPO_E2E_PORT=18765 npm --prefix frontend run test:e2e -- lead-workflow.spec.ts lead-workflow-a11y.spec.ts problem-reports-lead.spec.ts`.
- **Commit:** `test(browser): lead correction and exact Progress links`

## Final gate (alone on the machine, sequential)

```bash
cd /c/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation
bash scripts/check.sh --only static
bash scripts/check.sh --only backend        # with -n 4 via CHECK_PYTEST_WORKERS=4 once T1 is merged
HPO_E2E_PORT=18765 bash scripts/check.sh --only browser
CHECK_VITEST_WORKERS=4 bash scripts/check.sh --only frontend
```

- [ ] Each stage ends with `Selected stage checks passed (partial gate: <stage>).`; first failure → one fix agent (effort medium), rerun that stage.
- [ ] `git status --short` shows only files of this plan's WPs (plus foreign work committed by its owner).
- [ ] One plan review (`superpowers:code-reviewer` or `agy` gemini-3.8-flash) over the follow-up commits against the spec; one fix agent for verified findings.
- [ ] F1c and F7 are tracked on `feat/review-annotation-flow`; F1c is checked after the next merge of `feat/lead-workflow` into that branch.

## Self-review against the spec

| Spec section | WP(s) |
|---|---|
| F1 FD1 to FD9, API | F1a |
| F1 UI: Resolve options, Translation block | F1b (entry), F5 (placement and focus) |
| F1 UI: review screen | F1c (other branch) |
| F2 FD10, FD11, FD12, link table | F2a (backend, contract test), F2b (router, links, Export link) |
| F3 | F2a (`DocumentRowFilters`), F2b (`selectionFilters`) |
| F4 | F4a, F4b |
| F5 | F5 |
| F6 | F6 |
| F7 | F7 (other branch) |
| Testing › Browser | FB |
