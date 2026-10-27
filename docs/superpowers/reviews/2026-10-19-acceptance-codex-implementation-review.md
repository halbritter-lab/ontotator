> Independent source review before the bounded correction batch. See the final implementation handoff for dispositions and subsequent verification.

# Final acceptance implementation review — Codex

Date: 2026-10-19. Reviewed the uncommitted working tree, including new files, in `C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation`, against base `ba0b91b`. This is an independent source review, not user acceptance or a browser acceptance result.

## Scope and method

Read the final-review brief, acceptance-remediation plan, resolved workflow contracts and prior contract-review disposition. Traced frontend controls through generated/client request shapes and the corresponding backend services, with particular attention to reports/holds/restart, round navigation, private carry-forward, consolidation, translation corrections/source obligations, immutable history, final selection, warning preflight and export. Also inspected mutation/review-note and translation draft handling, personal search preferences and account navigation.

No application files, database state or demo runtime were changed. No suites or browser journeys were run; the coordinator owns those gates. The sole authored artifact is this report. All findings below are source-inferred deterministic paths, with concrete triggers; they are not claimed as runtime reproductions. Deep backend authorization/concurrency/provenance review is separately assigned and is outside this review's completeness claim.

## Findings

### C1 — P2: Pending consolidation/carry/translation work never contributes its required warning

**Location:** `src/ontotator/application/final_results.py:199` (projection assembly); `src/ontotator/storage/repository.py:498` (complete shared cause producer).

**Trigger:** Select a submitted annotation result on a text. Create a consolidation review on that same text using two eligible submitted inputs, assigned to a different reviewer whose review assignment has no prior round, and leave its decisions pending. The selected submission's own round remains submitted and unchanged. With final coverage otherwise complete and no reports/source changes, request final-export preflight.

**Evidence and impact:** The shared cause producer reads source obligations, open reports and active holds. The selection projection adds only selected-round abandoned/superseded, revised-result and corrected-text causes. No production code emits `ROUND_REVIEW_PENDING` or inspects the unfinished consolidation's decisions. Thus this scenario can report no open workflow warnings and create the final export without acknowledging the pending review. The resolved contract §7 explicitly requires active carry-forward/consolidation or translation review with unresolved required work on the selected chain to appear in the shared dashboard/preflight projection.

**Correction:** Derive pending required-work causes for the relevant selected chain from exact active rounds/drafts, with stable identities and revisions. Preserve the selected result and allow conscious warned export. Verify both the pending case and disappearance after completion, plus an unrelated round that must not warn.

### C2 — P2: The UI cannot reaffirm a selection after reviewing finite selection causes

**Location:** `frontend/src/variants/FinalResultSelector.tsx:32`.

**Trigger:** A selected result receives `SELECTED_TEXT_CORRECTED`, `SELECTED_RESULT_REVISED`, `SELECTED_ROUND_SUPERSEDED` or `SELECTED_ROUND_ABANDONED`. The lead reviews the change and deliberately retains the same exact document/submission pair through the selection UI.

**Evidence and impact:** The only frontend call to `selectFinalResult` always sends `acknowledged_cause_ids: []`; no frontend control collects or submits these cause IDs. `FinalResultService.select` accepts current finite causes only for the same existing pair, and `_projection` suppresses them only when those IDs are recorded. Re-selecting the same result increments its revision but leaves the warning indefinitely. Export acknowledgement is snapshot-specific and does not resolve selection warnings. The required §7 reaffirmation flow is available in the API and backend test but unavailable to the user.

**Correction:** Present the current eligible finite causes for this slot and allow explicit reaffirmation of the same pair with those exact IDs. Keep report/hold/source-obligation resolution separate and retain CAS/stale-warning validation.

### C3 — P2: An inactive unrelated translation branch adds warnings to the selected branch's export

**Location:** `src/ontotator/storage/repository.py:510` (unfiltered obligation production), propagated by `src/ontotator/application/final_results.py:199`.

**Trigger:** A case has two independent source roots and German translation chains A and B. Select the final German result on A. Correct B's source, leaving B's translation unassigned and with no active work. Request workflow warnings or final-export preflight.

**Evidence and impact:** `derive_source_obligations` enumerates every translation leaf in the project. `list_workflow_causes` forwards every unresolved cause, without checking selected ancestry or active work. `project_warnings` filters only by case/language coverage, so B's cause is retained for the same German slot and must be acknowledged for an export containing A. Contract §7 limits source-update warnings to the selected translation chain, with other chains exposed as project issues when they have active work; independent unrelated chains must not invalidate the selection. This creates irrelevant permanent export warnings and can make a new source change on B invalidate A's reviewed preflight digest.

**Correction:** Keep the complete obligation inventory, but filter its warning projection using exact selected-chain/active-work relevance. Test unrelated independent roots and same-root corrections separately.

### C4 — P2: Selection-warning links send the lead to another user's owner-only editor

**Location:** `src/ontotator/application/final_results.py:217` and `:236`.

**Trigger:** A lead selects an annotator's submitted result; that annotator's round is later superseded/abandoned or receives another submission. The lead follows **Review issue** from the dashboard or final-export preflight.

**Evidence and impact:** `SELECTED_ROUND_ABANDONED`, `SELECTED_ROUND_SUPERSEDED` and `SELECTED_RESULT_REVISED` point to `#/tasks/{round_view.assignment_id}`. `WorkflowWarnings` renders that destination directly. `TaskEditor` first calls `GET /assignments/{id}`, whose `_owned_assignment` (`src/ontotator/api/assignment_routes.py:293`) requires `qualifying_assignment(user_id)` for the caller; management authority does not substitute task ownership. The usual lead reviewing someone else's result therefore gets `ASSIGNMENT_NOT_FOUND`, displayed as no longer assigned, instead of a usable review destination. This breaks the contract's authorized actionable warning destination.

**Correction:** Link leads to the authorized case/submission-history/final-selection view for the exact selected text, or implement an explicitly read-only lead history destination. Preserve owner-only write authority.

### C5 — P2: The task queue conceals active holds and offers paused tasks as actionable work

**Location:** `frontend/src/tasks/MyTasks.tsx:72`, `:77` and `:101`.

**Trigger:** An owner reports a problem or a lead extends a hold onto their open/in-progress assignment, then the owner returns to **My tasks** or refreshes it.

**Evidence and impact:** The API supplies `held` and `hold_reason`, but the queue renders only underlying `task.status`, chooses **Start/Continue/View** only from that status, and counts only open/in-progress/submitted assignments. There is no paused marker, pause reason or held count anywhere in this component. Consequently a held open task is advertised as **Start**, and users cannot distinguish paused work in their queue until they open each editor. The resolved contract §2 explicitly requires task-list counts to distinguish held from underlying task status; holds are deliberately orthogonal, so replacing the underlying status is also inappropriate.

**Correction:** Expose held state and its authorized assignee-visible reason alongside the underlying task status, include a held count, and name the row action appropriately while retaining access to saved work/report controls.

## Readiness and remaining uncertainty

Request changes before calling Tasks 11–12 or integrated acceptance complete. The principal gaps are in the user-facing warning/selection workflow and the shared warning relevance calculation; exact selection and frozen export architecture should be retained while correcting them.

This review does not establish native-browser usability, responsive/keyboard acceptance, full migration correctness, passing automated gates or race behavior. Those remain subject to the coordinator's serial gate and separate browser/backend reviews. Candidate paths involving merged-result edits were traced through backend decision invalidation and were not reported as stale-reference defects because the server deliberately removes the affected decisions.
