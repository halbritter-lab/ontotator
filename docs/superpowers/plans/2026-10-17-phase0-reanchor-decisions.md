# Phase 0 B0.3: Re-anchor decisions implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans task by task. Checkboxes track implementation, not planning completion.

**Goal:** Let the assigned reviewer explicitly re-create or dismiss each finding that could not be carried to a corrected text, with durable provenance.

**Architecture:** Keep immutable producer output in `ProposalSetRow.pending_items`. Freeze the relevant pending-item references when a review workspace first opens, and store resolutions per draft, then in its immutable submission. Reuse the existing mutation envelope, revision lock and receipt machinery; do not resolve an item globally for every reviewer.

**Tech stack:** FastAPI/Pydantic, SQLAlchemy/PostgreSQL/Alembic, React/TypeScript, pytest, Vitest, Playwright.

**Spec:** `2026-10-17-next-agentic-work.md`, decided re-anchor behavior; execution order and decision register in `2026-10-17-phase0-priorities.md`.

## Global constraints

- English UI, existing shared UI components and shortcut registry, Unicode codepoint offsets.
- Existing submissions and producer output remain immutable and readable.
- Reviewer means an assigned annotation reviewer in the case; translation review alone does not grant annotation-review mutation rights.
- No requests or writes to the reserved acceptance demo at port 18080.
- Run targeted checks during development and `bash scripts/check.sh` before requesting merge. Vitest: `--maxWorkers=4 --minWorkers=1`; PostgreSQL/browser tests require Docker.
- Execute after B0.2 storage work and B0.4 access policy; allocate migration `0008_reanchor_resolutions.py` after `0007_spanless_rules.py`.
- P0-R decides whether unresolved frozen items block submission. Do not infer the answer from a missing response.

## Review focus

1. Another reviewer's resolution must not disappear from this reviewer's queue: Task 1 isolation test.
2. Retrying a re-create request must not create a second annotation: Task 2 receipt test.
3. A stale target, changed replacement or deleted replacement must not leave a falsely resolved item: Tasks 2 and 3.
4. Late re-anchor jobs must not expand an already opened review round silently: Task 1 frozen-input test.
5. Supplementary Unicode characters, multiple mentions and changed cue spans must retain exact offsets: Task 3 browser test.

## Task 1: Persist frozen pending inputs and per-workspace resolutions

**Files:**
- Create `src/ontocurator/domain/reanchor_resolution.py`.
- Create `src/ontocurator/storage/migrations/versions/0008_reanchor_resolutions.py`.
- Modify `src/ontocurator/domain/workspace.py`, `src/ontocurator/application/workspaces.py`, `src/ontocurator/storage/tables.py`, `src/ontocurator/storage/repository.py`, `src/ontocurator/api/routes.py`, `src/ontocurator/api/assignment_routes.py`, `frontend/src/api/client.ts`.
- Test in new `tests/test_reanchor_resolutions.py` and existing `tests/test_reanchor_job.py`.

**Interfaces:** `PendingReanchorRef(proposal_set_id: int, source_ref: AnnotationRef)` identifies one immutable pending item. `ReanchorResolution(item: PendingReanchorRef, outcome: Literal['recreated', 'dismissed'], replacement: AnnotationRef | None, reason: str | None, reviewer_id: str)` requires an exact replacement for `recreated` and a nonblank reason for `dismissed`. Add `reanchor_inputs` and `reanchor_resolutions` lists to Draft and Submission, defaulting empty for old payloads. Persist the lists in draft JSONB columns; submission payload already stores the immutable model. Add optional `pending_proposal_set_ids: list[int] | None` to `OpenWorkspaceRequest` and its client request type. Include new submission data without rewriting historical payloads.

- [ ] Write tests `test_pending_inputs_frozen_on_first_review_open`, `test_resolution_is_private_to_workspace`, `test_old_submission_without_resolutions_decodes`, `test_upgrade_preserves_pending_producer_payloads`. Assert late producer sets do not enter an existing draft, and reopening the same draft retains its original inputs.
- [ ] Run `uv run pytest tests/test_reanchor_resolutions.py -q`; verify failure on missing behavior.
- [ ] Default first review opening freezes all currently authorized pending refs for that document's editable layers, including pending-only sets absent from `workspace_proposal_sets()`. Custom annotation target rounds must supply explicit `pending_proposal_set_ids` (an empty list explicitly excludes pending items); validate each set against project, document, permissions and layer scope. Preserve canonical `ReviewTargetSet` annotation hashes. Reopening retains the stored queue and rejects conflicting explicit pending selections with `REANCHOR_INPUTS_CONFLICT`; it never silently redefines an existing workspace. The assignment-open route uses default selection when creating a new round.
- [ ] Persist once under the draft lock, never refresh from later document-wide proposals. Extend the workspace response with authorized pending context for those frozen refs, using the existing `ReanchorItem` representation. Test custom rounds, pending-only sets and explicitly empty inputs.
- [ ] Existing drafts need explicit lazy initialization under lock, distinguished from a genuinely empty frozen set by a nullable migration column or initialization marker. Legacy drafts freeze eligible pending refs at their first post-upgrade open; their original queue cannot be reconstructed from the current schema. Record that initialization time for audit and never refresh it again.
- [ ] Run targeted tests including migration upgrade/read-back; commit `feat: persist review-scoped reanchor inputs and resolutions`.

**Acceptance:** Producer JSON remains byte-for-byte unchanged. Independent workspaces receive no pending inputs. Two reviewers see their own state; new jobs do not alter the review already underway.

## Task 2: Resolve items transactionally through workspace commands

**Files:**
- Create `src/ontocurator/application/reanchor_resolutions.py`.
- Modify `src/ontocurator/api/routes.py`, `src/ontocurator/authz/scoped.py`, `src/ontocurator/application/editing.py`, `src/ontocurator/domain/errors.py`.
- Test `tests/test_reanchor_resolutions.py`; create `tests/test_reanchor_resolution_api.py`.
- Regenerate `contracts/openapi.json` and `frontend/src/api/generated.ts`.

**Interfaces:** `ReanchorResolutionService.resolve(key: WorkspaceKey, envelope: MutationEnvelope) -> Draft`. Add `POST /api/v1/workspaces/{workspace_id}/reanchor-resolutions`. Payload carries `item`, `outcome`, `replacement` or `reason`; reviewer identity comes from the authenticated workspace owner. Add `RecreateReanchorCommand(command='recreate_reanchor', item: PendingReanchorRef, annotation_id: str, evidence_id: str, term_id: str, layer_id: str, type_id: str, axes_values: dict[str, str | None], segments: list[Segment])` to the editing command union. Ordinary adoption must keep its same-document restriction: a pending item refers to an older text and cannot pass that path. The dedicated command validates the frozen item, proposal-set correction lineage, source snapshot and current layer/type, then authors provenance server-side from the authenticated reviewer and exact predecessor reference. Reuse snapshot construction, revision locks and mutation receipts. First create/edit the new annotation through the normal queue, then resolve against its exact saved version; cancelled or unsaved editing leaves the item pending.

- [ ] Write API tests for a valid predecessor-text source, forged project/document/set/source version, foreign workspace, revoked assignment, independent mode, duplicate mutation ID, stale expected revision, blank dismissal reason, and a replacement outside this draft. Assert denial without draft changes. Verify ordinary create/adopt still refuses predecessor sources and dedicated re-create retries return the same annotation.
- [ ] Run `uv run pytest tests/test_reanchor_resolution_api.py -q` and observe missing-route/behavior failures.
- [ ] Implement ownership, current assignment and frozen-input checks within the same transaction as `run_mutation`. Resolve one item exactly once per current state; subsequent intentional edits use a new mutation and revision. Reuse annotation provenance source refs; never derive evidence from the old text or from an arbitrary client context window.
- [ ] Pin replacement references. If a linked replacement is subsequently edited, require re-resolution to the new version; if deleted, expose that item as unresolved. Do not leave stale links silently valid.
- [ ] Regenerate contracts with `uv run python scripts/export_openapi.py` and `npm --prefix frontend run api:generate`; run API tests and `npm --prefix frontend run typecheck`; commit `feat: add authorized reanchor resolution commands`.

**Acceptance:** A retry returns the original result without duplicates. A failed save cannot mark an item resolved. Lead visibility alone never confers permission to write another person's draft.

## Task 3: Integrate the reviewer flow and completion

**Files:**
- Modify `frontend/src/variants/ReanchorPanel.tsx`, `frontend/src/app/CaseScreen.tsx`, `frontend/src/api/client.ts`, `src/ontocurator/application/submissions.py`.
- Test `frontend/tests/reanchorPanel.test.tsx`, `frontend/tests/reanchorIntegration.test.tsx`, `frontend/tests/reanchorProvenance.test.tsx`, `tests/test_reanchor_resolutions.py`.
- Browser tests: `frontend/browser/reanchor.spec.ts`; fixture changes in `tests/browser_server.py` only as needed.

**Interfaces:** Panel accepts authorized pending items, resolutions and callbacks `onRecreate(item)` / `onDismiss(item, reason)`; read-only viewers receive no mutation callbacks. CaseScreen stores the active frozen item during selection, prefills term/layer from it, and uses the existing creation/search/editor flow. A cancelled selection leaves the item pending. Use existing save queue and focus handling; do not build a second editor.

- [ ] Add unit tests for disabled actions in read-only view, required dismissal reason, cancelled re-creation, failed save, resolved status with text as well as shape, and resuming after reload.
- [ ] Add a Playwright journey that re-creates one pending item using a newly selected Unicode span, dismisses another with a reason, reloads and submits. Assert the saved replacement contains current-text offsets, source provenance and the chosen term; dismissals remain auditable. Add a second reviewer check and a revoked-assignment check.
- [ ] Implement explicit labels `Re-create here` and `Dismiss with reason`. Retain old/new contexts as information. After successful re-creation focus the new finding; after dismissal focus the next pending item. Failure preserves input and displays the error.
- [ ] Apply the recorded P0-R answer at submission: if blocking is approved, return `REANCHOR_ITEMS_UNRESOLVED` with count and expose a jump to pending items in the submit dialog. Validate exact replacement references server-side. If nonblocking is chosen, preserve pending refs in the submission and display the unresolved count without implying completion.
- [ ] Run `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/reanchorPanel.test.tsx tests/reanchorIntegration.test.tsx tests/reanchorProvenance.test.tsx`; run `npm --prefix frontend run test:e2e -- reanchor.spec.ts`; run the backend resolution tests; commit `feat: let reviewers resolve findings after text corrections`.

**Acceptance:** Every resolution records actor, original item and either exact new annotation version or reason. A reviewer can complete the entire flow without switching to an administrative screen. Historical submissions remain read-only.

## Task 4: Preserve resolutions in submission read-back and audit

**Files:**
- Modify `src/ontocurator/storage/repository.py`, `src/ontocurator/domain/workspace.py`, `src/ontocurator/application/submissions.py`.
- Create `tests/test_reanchor_resolution_roundtrip.py`; extend `tests/test_review_roundtrip_regressions.py`.

- [ ] Test stored submission read-back with one recreated and one dismissed item; assert exact frozen refs, actor, reason and replacement hash. Test old v2 submissions lacking fields, and reject dangling references when producing new submissions.
- [ ] Verify the edit log contains the resolution command and actor, and immutable submission payloads retain the resolutions. Ontospan annotation export carries replacement provenance, while dismissed items remain in the stored submission and edit log; do not fabricate a clinical annotation for a dismissal. Legacy v2 ZIP reader/writer utilities live under `tests/support/` and are not a production exchange interface; do not resurrect them.
- [ ] Run `uv run pytest tests/test_reanchor_resolution_roundtrip.py tests/test_review_roundtrip_regressions.py -q`; commit `feat: preserve reanchor resolutions in submission exchange`.

**Batch gate:** Independent content review, then `bash scripts/check.sh`. Record actual commands/results and remaining limitations in a review record. No merge or push without user approval.
