# Phase 0 Decision Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement B0.2: explicit review uncertainty, justified spanless findings, visible defaulted axes, and one completion confirmation with stable decision shortcuts.

**Architecture:** Keep immutable clinical content separate from reviewer resolution. Apply new write validation in application services, retain historical readers, and extend the shared export format through its owning repository before switching the export writer. Deliver four reviewable sub-batches in order; the first has no ontospan dependency.

**Tech Stack:** Python/FastAPI/Pydantic, SQLAlchemy/Alembic/PostgreSQL, React 18/TypeScript/plain CSS, pytest/Vitest/Playwright, ontospan pinned Git dependency.

**Spec:** `PRODUCT.md`, `DESIGN.md`, and `docs/superpowers/plans/2026-10-17-next-agentic-work.md` (approved D2–D5 and B0.2).

## Global Constraints

### Binding D3 clarification, 2026-10-18

The user clarified that requiring a justification must itself be configurable, and approved three project modes: prohibited, allowed with a required reason, and allowed with an optional reason. This supersedes the unconditional D3 note requirement in the original task text below. Keep the current default (allowed with a required reason); the user has not selected a different default or answered P0-S about existing open drafts.

Technical implementation: retain `allow_spanless_findings` and add `require_spanless_note: bool = True` to project storage/settings/rule projection and the read-only workspace view. Migration 0009 follows re-anchor migration 0008 and adds only the project column; do not alter old migrations, draft classification or immutable content. Prohibition takes precedence. When spanless findings are allowed, reject an absent/blank reason only if the new flag is true. Existing evidence/profile requirements and authorization remain unchanged. Use one three-option control in Project Settings, mapping to the two backend fields; optional mode must permit note-less creation, removing the last mention, note clearing, historical proposal replacement and submission. A supplied optional note retains existing autosave, versioning and export behavior.

Execution follow-up:

- [ ] Backend: update `domain/project_rules.py`, `projects/service.py`, `storage/tables.py`, `storage/repository.py`, workspace projection and migration `0009_spanless_note_rule.py`; regenerate OpenAPI/TypeScript contracts. Cover all three modes, partial settings updates, authorization, migration from 0008 and preserved legacy draft/snapshot behavior with focused pytest tests.
- [ ] Frontend: update `admin/ProjectSettingsPage.tsx`, `app/CaseScreen.tsx`, affected editor props/copy and handwritten API types. Cover optional-note creation, clearing/autosave/navigation, last-mention removal, historical replacement, and saved settings with focused Vitest tests (`--maxWorkers=4 --minWorkers=1`) and `frontend/browser/decision-semantics.spec.ts` on the disposable server only. Reuse existing profile/forbidden-mode regression coverage.
- [ ] Review this amendment's complete diff independently, fix confirmed findings, and verify the integrated source locally. Earlier gate evidence applies only through `bf80b24`; no new bundled UI or acceptance candidate is implied. Keep commits local and retain the reserved demo and pending asset/publication approvals.

- English UI only. Light theme only. React 18 single-page app with plain CSS and no UI library.
- Runs in offline and closed networks: no request may leave the app's origin (no CDN, no external fonts).
- Ontologies, documents and annotations are pinned and hashed; Unicode codepoint offsets are exact.
- WCAG 2.2 AA. Functional text is at least 12 px. Full keyboard operation of the editor.
- Meaning never depends on colour alone. The text comes first: nothing may move, hide or crowd the clinical text while it is being read or marked.
- Use `frontend/src/ui/` components, existing tokens and `useShortcut`; no new colour literals, libraries or motion of clinical text.
- D2–D5 are approved. Do not decide D6–D15, change clinical axis values, remove `require_chosen_axes`, or infer a review decision from a clinical axis.
- The user authorized completion of planning followed by autonomous implementation of decided functions. Continue ready tasks without renewed permission; only the dependent clinical gates in the master register pause their affected behavior. Never use the acceptance demo on port 18080 as a test server.
- Existing supported v3 snapshots and v2 submissions remain readable and verifiable. Never rewrite old payloads, decisions, hashes, edit logs or exported blobs.

## Review Focus

- A review proposal with clinical assertion `uncertain` can be confirmed; reviewer uncertainty must remain a separate flag (Tasks 1 and 4).
- Hidden layers and proposals versus replacements can produce a misleading defaulted count; count the exported result once per immutable reference (Task 1).
- Repeated keys, IME input and delayed note saves must not clear a decision or erase a note (Tasks 1 and 3).
- Removing the last evidence span can create a spanless finding through an edit rather than the create button (Task 2).
- Legacy missing notes and unknown/obsolete proposals must remain readable without silently inventing clinical justification or weakening ontology validation (Tasks 2–4 and the policy gate).

## Evidence and execution boundaries

Verified against the repository on 2026-10-17:

- `src/ontocurator/domain/annotations.py`: no annotation note exists; `annotation_content()` explicitly builds hashed content. Empty `axes_defaulted` is omitted for backward compatibility. `src/ontocurator/domain/serialization.py` decodes and verifies v3 only; changing a nested default without conditional serialization would break historical hashes.
- `src/ontocurator/domain/review.py` already has `ReviewDecision.note`; it must remain optional in the read model. `application/reviews.py` accepts optional command notes and stores stable decision IDs keyed by workspace and exact target. Required-note validation belongs in write services, not the historical model validator.
- T1 proposal notes live separately in `ImportedProposals.notes` and `ProposalAnnotationRow.notes`; they are not annotation snapshot content. `exchange/t1.py::submission_to_unit()` currently excludes and counts reviewer uncertainty. `application/submissions.py` also leaves these targets out of `Submission.snapshots`.
- `frontend/src/editor/ReviewActions.tsx` and `frontend/src/app/CaseScreen.tsx` both toggle decisions. Review note changes debounce and flush on unmount. `editor/LayerControls.tsx` renders verification controls; removing only the submit-dialog wording would leave a second completion concept.
- `application/submissions.py::validate_completion()` currently requires every editable layer in `checked_layer_ids`. `SubmitCommand.document_checked` defaults to true, so missing confirmation is currently accepted by the API. Draft `document_checked` is a compatibility property derived from checked layers; do not reuse it for the new explicit submit confirmation.
- Project settings use `projects/service.py::ProjectSettingsChange` and `ProjectService.update_settings()` with `exclude_unset`, project locks and audit. Rule projection goes through `storage/repository.py::get_project_rules()`, `domain/project_rules.py::ProjectRules.of()` and workspace profile projection. The current migration head is `0006_variants.py`; reserve `0007_spanless_rules.py` here. B0.3 reserves 0008 and must rebase onto it.

### Shared-format evidence and selected technical representation

`pyproject.toml` pins `ontospan` to `4105ec1259fc04d927d78258fcf4c99f8f014b6a`. The sibling checkout `C:/Users/jan-p/Development/ontospan` has HEAD `6709c3afe65cb4d439cd676be6349b25460ab205` (old format 1.0); inspect the pinned Git object, not that checkout's working files:

```powershell
git -C C:/Users/jan-p/Development/ontospan show 4105ec1:src/ontospan/models.py
git -C C:/Users/jan-p/Development/ontospan show 4105ec1:src/ontospan/_version.py
git -C C:/Users/jan-p/Development/ontospan show 4105ec1:src/ontospan/schema_export.py
```

The pin declares format/package 1.1.0. Its `Annotation` has no structured review-resolution field. `Provenance.notes: tuple[str, ...]` is supported and can carry an annotation justification. Runtime models preserve unknown fields, but generated versioned schemas close objects; passing an invented `review_status` extra would not make a valid 1.1 export.

Select a **new optional `Annotation.review_resolution` block in ontospan format 1.2.0**, with `outcome: Literal["uncertain"]`, `reviewer: Actor`, and optional `note: str` (omitted when absent for historical exports). Use existing `Provenance.notes` for the clinical annotation justification. Keep all clinical axes unchanged. Uncertain results retain the source annotation's provenance and add its proposal URN to `source_refs`; the separate block identifies the reviewer. They are never labelled `adopted` or `edited`. This is a technical representation decision, not a new clinical decision. The new field must be absent on unflagged exports and absent on 1.0/1.1 reserialization.

Cross-repository prerequisite for Task 4: implement and review that minor-version addition in ontospan, preserving frozen 1.0/1.1 schemas, schema dispatch, package writing, unknown-field round trips and conformance tests. Ensure its phenopacket conversion refuses uncertain reviewer results with an explicit error rather than silently promoting them into accepted findings. Do not implement a text-note sentinel or change the clinical assertion axis to avoid the dependency. Only then update this repository's `pyproject.toml` to the actual reviewed immutable upstream commit and refresh `uv.lock`; no future commit hash can be specified in advance. Do not point at a local checkout or moving branch. Task 4 is blocked on that upstream deliverable; Tasks 1–3 can ship first with accurate interim export copy.

### Clinical policy register and ready work

Use the master [Immediate policy register](2026-10-17-phase0-priorities.md#immediate-policy-register) as the single source of status and answers. **P0-S** concerns whether the spanless note/disable rules apply to existing open drafts; only that legacy enforcement slice of Task 2 waits for its answer. **P0-U** concerns unknown/obsolete/incomplete unresolved targets; only that validation/materialization slice of Task 4 waits for its answer. Never fabricate clinical notes, silently omit unresolved results, or weaken ontology checks while waiting.

D2 already authorizes mandatory notes on new unresolved decisions, including rejection of a new submission carrying a note-less unresolved decision. Historical read models remain permissive; historical exports without a note emit the explicit technical warning specified in Task 4. Neither this warning nor the format field/version requires additional clinical approval. Task 1 and upstream technical format work proceed independently; the ontospan dependency blocks Task 4 only.

### D3 execution boundary while P0-S is pending

P0-S does not block note storage, project-setting storage, export preservation or enforcement for genuinely new drafts. `DraftRow` has no reliable creation timestamp: its `updated_at` changes, and revisions can be restored from historical submissions. Add a server-owned nullable `spanless_policy_version` to the draft row and read model. Migration 0007 leaves existing rows `NULL`; only genuinely newly inserted rows receive `1`, including new drafts initialized from historical submissions. Reopening, editing and insert conflicts must never upgrade an existing row implicitly. This metadata stays outside annotation and submission hashes and cannot be supplied through a mutation command.

For version 1 drafts, enforce D3 on newly created/changed snapshots inside the locked mutation transaction and on all materialized submission results. This permits incremental explicit correction of inherited historical content without rewriting it. Expose read-only `WorkspaceView.enforce_spanless_rules` and `allow_spanless_findings` so UI requirements reflect actual server behavior. Pass an explicit `enforce_spanless` option to rule validation; proposal import remains permissive and imported source notes never become clinical justification automatically.

Existing drafts retain their current enforcement behavior provisionally until P0-S is answered. The marker distinguishes drafts, not newly authored findings within a legacy draft. Record that limitation; neither grandfathering nor full D3 completion is decided by this technical routing. If P0-S selects enforcement for existing drafts, implement that transition explicitly with its own tests.

---

### Task 1: D4/D5 completion warning and idempotent review controls

**Files:**
- Create: `frontend/src/editor/decisionSemantics.ts`, `frontend/tests/decisionSemantics.test.ts`, `frontend/browser/decision-semantics.spec.ts`.
- Modify: `frontend/src/app/CaseScreen.tsx`, `frontend/src/editor/ReviewActions.tsx`, `frontend/src/editor/LayerControls.tsx`, `src/ontocurator/application/submissions.py`.
- Test: `frontend/tests/caseScreen.test.tsx`, `frontend/tests/reviewActions.test.tsx`, `frontend/tests/layerControls.test.tsx`, `tests/test_submission_scope_integrity.py`, `tests/test_api.py`, `tests/browser_server.py`, `frontend/browser/helpers.ts`, `frontend/browser/layers.spec.ts`.

**Interfaces:**
- Produce `resultSnapshots(draft: Draft, proposals: AnnotationSnapshot[]): AnnotationSnapshot[]`: exact-ref deduplicated authored results, confirmed targets, changed replacements, and uncertain targets (the latter must be included for warning purposes before Task 4 exports them); rejected and pending proposals excluded. Do not count abandoned adoption copies.
- Produce `defaultedResults(snapshots: AnnotationSnapshot[]): AnnotationSnapshot[]`: exact-ref unique results with nonempty `axes_defaulted`. Its length counts annotations, not axes.
- Keep decision wire outcomes unchanged. Key `1` sets confirmed, `2` rejected, `3` edits/reopens replacement, `4` starts/sets reviewer uncertainty, `0` resets to open through existing `{ outcome: null }` command. All use `handleReviewDecision`; controls and shortcuts share behavior.
- `SubmitCommand.document_checked: bool = False`; existing explicit true remains supported. Retain legacy `checked_layer_ids` fields/read models and `check_layer` command compatibility, but they cannot substitute for document confirmation or gate new submissions.

- [ ] Add failing unit/API cases `test_submission_needs_explicit_document_confirmation` (omitted and false fail `DOCUMENT_NOT_CHECKED`; true with zero checked layers passes for valid single/multilayer drafts), `test_layer_checks_do_not_replace_document_confirmation`, and preserve all required axes, term, evidence, exact-target and project-rule checks. Add frontend tests: repeated 1/2/4 never resets, 0 resets while preserving note draft, typing/IME/modal suppress keys, same-outcome button is idempotent, and key 3 resumes its exact replacement.
- [ ] Add result-selection tests with rejected, confirmed, changed, authored, uncertain, hidden-layer and duplicate-ref inputs. Assert three marked axes on one annotation count as one annotation. Confirming an already-defaulted axis explicitly clears its badge, while setting the same value without explicit choice does not.
- [ ] Run the named tests below and confirm failures prove these behaviors are absent.
- [ ] Remove verification controls, badges, counts and submit checks from `LayerControls` and `CaseScreen`; keep layer visibility/type selection intact. Remove per-layer completion enforcement from `validate_completion`. Retain historical checked-layer metadata without interpreting it as a new user action. Only the existing “Entire text checked for further findings” checkbox enables submission; reset it every time the dialog opens.
- [ ] Render a text/shape warning badge “Defaulted axes” on result list entries including flagged proposals. The submit dialog says “{N} annotations have defaulted axis values.” and offers “Review defaulted annotations” when N > 0. This action closes the dialog, reveals the first relevant layer, selects the exact annotation/proposal and focuses its axes panel. It never confirms axes or silently skips hidden layers. Reopening submission recomputes from the latest successfully saved draft. Existing `require_chosen_axes=true` continues to block submission.
- [ ] Make outcome controls/keys idempotent; register `0` with the shortcut registry and show it on reset/help. Update tooltips to describe setting outcomes, not toggling. During Task 3's interim state `4` must route through the note editor if a note is absent, then set the decision explicitly.
- [ ] Run `uv run pytest tests/test_submission_scope_integrity.py tests/test_api.py -q` and `npm --prefix frontend test -- tests/decisionSemantics.test.ts tests/caseScreen.test.tsx tests/reviewActions.test.tsx tests/layerControls.test.tsx --maxWorkers=4 --minWorkers=1`. Expected: all pass. Update obsolete layer-verification assertions in the touched suites.
- [ ] Add browser cases in `decision-semantics.spec.ts`: submit a two-layer case through one confirmation, jump from the warning into a hidden layer and explicitly confirm an axis, repeat outcome keys then reset, verify dialog/input suppression. Run `npm --prefix frontend run test:e2e -- browser/decision-semantics.spec.ts browser/layers.spec.ts`; expected all pass on the isolated 18765 fixture server. Extend `tests/browser_server.py` synthetic fixtures only as needed.
- [ ] Review and commit this independently testable deliverable: `feat: clarify completion and review controls` (no trailers).

### Task 2: D3 justified spanless findings and project setting

**Files:**
- Modify: `src/ontocurator/domain/annotations.py`, `src/ontocurator/domain/project_rules.py`, `src/ontocurator/application/editing.py`, `src/ontocurator/application/submissions.py`, `src/ontocurator/projects/service.py`, `src/ontocurator/storage/tables.py`, `src/ontocurator/storage/repository.py`, `src/ontocurator/application/workspaces.py`, `src/ontocurator/exchange/t1.py`, `src/ontocurator/exchange/jobs.py`.
- Create: `src/ontocurator/storage/migrations/versions/0007_spanless_rules.py`.
- Modify: `src/ontocurator/domain/workspace.py` for the server-owned draft policy marker; extend workspace projection and migration tests for old/new draft classification.
- Modify: `frontend/src/admin/ProjectSettingsPage.tsx`, `frontend/src/editor/AnnotationPanel.tsx`, `frontend/src/app/CaseScreen.tsx`, `frontend/src/api/client.ts`, `contracts/openapi.json`, `frontend/src/api/generated.ts`.
- Test: `tests/test_annotation_versions.py`, `tests/test_schema.py`, `tests/test_editing.py`, `tests/test_project_rules.py`, `tests/test_project_rules_integration.py`, `tests/test_project_rules_postgres.py`, `tests/test_projects_api.py`, `tests/test_t1_mapping.py`, `frontend/tests/projectSettings.test.tsx`, `frontend/tests/caseScreen.test.tsx`, `frontend/browser/decision-semantics.spec.ts`.

**Interfaces:**
- `Annotation.note: str | None = None`, excluded when null/empty from serialization and `annotation_content()`. Preserve Unicode; trim new input only. A nonempty note changes the annotation hash; absent notes leave old hash inputs byte-for-byte equivalent. Historical decode must not trim or normalize content.
- `CreateAnnotationCommand.note: str | None = None`; new discriminated `SetAnnotationNoteCommand(command="set_annotation_note", annotation_id: str, note: str | None)` in the existing editing command union. Apply it through the same mutation/revision/snapshot machinery and replacement-ref synchronization as term/axes edits.
- `ProjectRules.allow_spanless_findings: bool = True`, same field/default in `ProjectSettingsChange`, `ProjectSettings`, `ProjectRow`, repository selection and `_ProjectSettings` protocol. `ProjectRules.of()` projects it. New rule violation codes `spanless_disallowed` and `spanless_note_required`, with `annotation_id` in the existing violation structure. Profile evidence requirements still take precedence; this setting cannot permit a type that requires evidence.
- Add `ProjectExport.proposal_notes: dict[tuple[str, str], list[str]]` in `storage/repository.py`, populated from exact-version `ProposalAnnotationRow.notes`. Add optional keyword `proposal_notes: Mapping[tuple[str, str], Sequence[str]] | None = None` to `submission_to_unit`; `exchange/jobs.py` passes the frozen export-content map so notes do not require later unscoped queries.
- Migration 0007 (down_revision 0006) adds `allow_spanless_findings BOOLEAN NOT NULL DEFAULT true` and nullable draft `spanless_policy_version` with existing rows left null and new rows classified as version 1. Add the draft column without a value that backfills existing rows, then establish the new-row default or explicit insertion value. Downgrade drops only these added columns. No immutable JSON backfill or rewrite.

- [ ] Write failing tests for whitespace-only note, spanless create, remove-last-mention, adoption/replacement and submit materialization; isolate existing-open-draft enforcement tests behind the recorded P0-S answer; disabling the project rule rejects each applicable future write. Existing spanless snapshots still decode/verify/display. A valid note does not bypass a profile's required-evidence policy. Annotator cannot PATCH project settings; lead can; omitted PATCH retains the saved false value; audit records the field change.
- [ ] Add golden hash assertions using existing fixture payloads with no note: `verify_snapshot(decode_snapshot(raw))` succeeds, `encode_snapshot()` introduces no note key and stored version remains unchanged. A note edit produces a new version; stale replacement refs cannot submit. Project migration upgrade/downgrade and fresh schema construction match.
- [ ] Run the backend/frontend tests listed below and observe the intended failures; add the note field, command, transactional rule enforcement and setting projection. Inspect create/edit result validation in `EditorService.apply` (the public alias of `EditingService`) so detach/adopt paths cannot bypass it. At submit inspect materialized confirmed/replacement/authored results as current project-rule validation does; Task 4 adds uncertain targets to that set. Preserve snapshot decode and historical submission reads.
- [ ] Rename/demote the create action to quiet “Add finding without a text span”. Hide/disable it with explanatory text when the project prohibits spanless findings. Collect a required “Reason for no text span” before selecting a term commits creation. Provide editable annotation note using shared `Textarea`; keep the value when search fails or no result is chosen. A note on a supported legacy annotation may be supplied by creating a new draft version, never editing historical content. The rule must be enforced server-side even if the UI is bypassed.
- [ ] Export annotation `note` through supported T1 `provenance.notes`; preserve imported notes already stored separately, without silently treating an arbitrary imported note as a clinical justification or losing their order. Import keeps all source notes in existing proposal metadata; export emits the new justification followed by source notes with stable duplicate removal. Thread source-note metadata explicitly through export content if the existing proposal snapshot map does not carry it. Test import/export with zero, one and several notes. This requires no upstream field addition.
- [ ] Regenerate contracts: `uv run python scripts/export_openapi.py`, then `npm --prefix frontend run api:generate`. Mutation payload remains an untyped envelope in the public OpenAPI; update the handwritten edit command/client types as required. Never hand-edit generated TypeScript.
- [ ] Run `uv run pytest tests/test_annotation_versions.py tests/test_schema.py tests/test_editing.py tests/test_project_rules.py tests/test_project_rules_integration.py tests/test_project_rules_postgres.py tests/test_projects_api.py tests/test_t1_mapping.py -q`; `npm --prefix frontend test -- tests/projectSettings.test.tsx tests/caseScreen.test.tsx --maxWorkers=4 --minWorkers=1`; expected all pass. Run `npm --prefix frontend run test:e2e -- browser/decision-semantics.spec.ts` with cases for lead toggle persistence, required spanless note, backend bypass rejection and remove-last-span behavior.
- [ ] Review and commit: `feat: require justification for spanless findings` (no trailers).

### Task 3: D2 note-required reviewer uncertainty with honest interim export copy

**Files:**
- Modify: `src/ontocurator/application/reviews.py`, `src/ontocurator/application/submissions.py`, `frontend/src/editor/ReviewActions.tsx`, `frontend/src/app/CaseScreen.tsx`, `frontend/src/admin/ExportPage.tsx`.
- Test: `tests/test_reviews.py`, `tests/test_review_validation_regressions.py`, `tests/test_api.py`, `frontend/tests/reviewActions.test.tsx`, `frontend/tests/caseScreen.test.tsx`, `frontend/tests/exportPage.test.tsx`, `frontend/browser/decision-semantics.spec.ts`.

**Interfaces:**
- Keep persisted `ReviewOutcome="uncertain"` and optional read-model note. New writes with this outcome require `note.strip()` nonempty; raise `DomainError("REVIEW_NOTE_REQUIRED", {"target": target.model_dump()})` otherwise. Revalidate at submission so old drafts cannot bypass the requirement, as already approved by D2; preserve historical read/export compatibility.
- Visible reviewer decision label is **“Unresolved”**. Clinical axis label/value `uncertain` remains unchanged. Text adjacent to the action: “A reviewer decision, separate from clinical uncertainty. A note is required.”

- [ ] Write failing tests: absent/blank note rejected transactionally without revision increment; valid note saved; API bypass rejected; legacy read succeeds; confirmed proposal with assertion uncertain succeeds; erasing an unresolved decision's note does not persist an invalid decision; resetting retains editable local note. Add a delayed-save/rapid-selection test proving timers never overwrite the next target's note.
- [ ] Run `uv run pytest tests/test_reviews.py tests/test_review_validation_regressions.py tests/test_api.py -q` and `npm --prefix frontend test -- tests/reviewActions.test.tsx tests/caseScreen.test.tsx tests/exportPage.test.tsx --maxWorkers=4 --minWorkers=1`; confirm expected failures. Implement validation at service entry/application, without tightening `ReviewDecision` historical model validation.
- [ ] On button/key 4 without a note, focus the required reviewer-note field and show its error, preserving the existing decision. With a note, explicitly set uncertain. If an existing unresolved note is cleared, retain local unsaved text, show the error, and block submit/target completion until corrected or reset; debounce must not send invalid writes or claim success. Surface service errors accessibly.
- [ ] Until Task 4 lands, state in ReviewActions and Export: “Unresolved proposals require a note. This export version excludes unresolved proposals.” Do not promise inclusion before the new exporter is active. The endpoint still returns unchanged wire outcomes and snapshots at this boundary.
- [ ] Repeat the commands above and `npm --prefix frontend run test:e2e -- browser/decision-semantics.spec.ts`; expected all pass, including reload persistence and failed-note preservation. Review and commit: `feat: distinguish unresolved review decisions` (no trailers).

### Task 4: Export unresolved results with a validated structured flag

**Prerequisites:** Task 3 and the reviewed ontospan 1.2 deliverable described above; consult P0-U before enabling invalid-target submission semantics. Never edit the sibling repository as an incidental unreviewed dependency fix.

**Files:**
- Modify: `pyproject.toml`, `uv.lock`, `src/ontocurator/exchange/t1.py`, `src/ontocurator/exchange/jobs.py`, `src/ontocurator/application/submissions.py`, `frontend/src/editor/ReviewActions.tsx`, `frontend/src/admin/ExportPage.tsx`.
- Test: `tests/test_t1_mapping.py`, `tests/test_t1_export.py`, `tests/test_t1_import.py`, `tests/test_review_roundtrip_regressions.py`, `tests/test_project_rules_integration.py`, `tests/test_progress_export_api.py`, `frontend/tests/exportPage.test.tsx`, `frontend/browser/decision-semantics.spec.ts`.

**Interfaces:**
- `submission_to_unit(...) -> tuple[ontospan.AnnotatedDocument, ExportCounts]` keeps its signature. `ExportCounts.uncertain` now counts **included flagged results**; `rejected` continues counting omitted results. All consumers, assertions and visible count labels must say included rather than excluded.
- For each uncertain exact target, resolve the original immutable proposal from `proposals`, include it once, preserve its term/axes/default basis/mentions and source provenance, and attach `review_resolution={outcome:"uncertain", reviewer: reviewer_actor, note: decision.note}`. Keep the proposal URN in source refs. Missing targets raise `TARGET_NOT_FOUND`; never silently skip.
- Future submissions include uncertain targets in the deduplicated result snapshots and validate them with the same ontology, evidence/profile and project-rule checks as other results according to the recorded P0-U answer for invalid targets. Historical submissions need no mutation: export resolves uncertain references from the existing proposal map.
- `proposals_from_unit()` must refuse a unit containing `review_resolution` as a whole with `DomainError("UNSUPPORTED_REVIEW_RESOLUTION", {"annotation_id": item.annotation_id})` before constructing snapshots. Current proposal storage has only string notes, not a structured resolution block; silently importing it would lose the flag and risk later promotion. A preserved structured re-import path is separate work requiring its own storage/projection design. Document this precise supported-format limitation in Export copy and test the explicit refusal. No extra migration is needed in this task.

- [ ] After pinning the actual reviewed upstream commit, add failing mapping/bundle/API tests: uncertain target with assertion present stays present and flagged; confirmed target with assertion uncertain is unflagged; note and reviewer survive serialization; no adopted/edited method is assigned; rejected remains absent; counts identify included flags; duplicate refs export once. Validate the ZIP through `ontospan.read_bundle`/validation against pinned ontology and declared 1.2 schemas. Historical valid note-less unresolved decisions export with absent note and `result["warnings"]` entries shaped `{code: "LEGACY_UNRESOLVED_NOTE_MISSING", annotation_id: str, version: str}` from the export job, never an invented note; this historical-export warning does not depend on another approval.
- [ ] Add ontospan serialization round-trip tests for the complete block and source notes, including source provenance and defaulted basis; add Ontocurator import tests for explicit flagged-unit refusal and unchanged ordinary-unit acceptance. Preserve original legacy payloads and assert old snapshot hashes unchanged. Cover flagged unknown/obsolete/profile-incomplete targets according to the recorded P0-U answer; failure must return a useful code and produce no success artifact. No ontology-validator exception may be silently swallowed.
- [ ] Run `uv run pytest tests/test_t1_mapping.py tests/test_t1_export.py tests/test_t1_import.py tests/test_review_roundtrip_regressions.py tests/test_project_rules_integration.py tests/test_progress_export_api.py -q` and observe intended failures. Implement materialization/export/import preservation and consistent job count semantics. Update docs/copy only once supported output is real: “Unresolved proposals are included in exports with a separate reviewer flag and note. Clinical axis values are unchanged.”
- [ ] Run those backend tests again; `npm --prefix frontend test -- tests/exportPage.test.tsx tests/reviewActions.test.tsx --maxWorkers=4 --minWorkers=1`; `npm --prefix frontend run test:e2e -- browser/decision-semantics.spec.ts`. Browser proof uses a synthetic review, note, reload, submit, lead-created export and downloaded ZIP inspection; asserts the exact flag/note and unchanged clinical axis, not just a success toast. Expected all pass.
- [ ] Run contract/type checks: `uv run python scripts/export_openapi.py --check`, `npm --prefix frontend run api:check`, `npm --prefix frontend run typecheck`. Review and commit: `feat: export unresolved proposals with review flags` (no trailers).

## Acceptance and merge handoff

- [ ] Confirm all D2–D5 requirements have the unit/API/browser evidence above and the P0-S/P0-U answers needed by the affected enforcement slices are recorded in the master register. Review UI keyboard/focus and warning copy against PRODUCT/DESIGN; no re-anchor or D6–D15 scope changes.
- [ ] After implementation only, run the repository's full merge gate once: `bash scripts/check.sh` (Git Bash on Windows). Docker/PostgreSQL and installed dependencies are prerequisites; the browser fixture uses port 18765 and refuses server reuse. At most two test-heavy workers across parallel plans. Do not target production/acceptance data or port 18080.
- [ ] Obtain fresh code review and fix identified issues, then rerun affected checks and the gate if code changes require it. Preserve the user's no-trailer commit policy. Continue autonomous implementation under the user's existing authorization. Merge/integration follows the user's chosen workflow.

Self-review: four sub-batches; Task 1 is independently shippable; Task 4 has an explicit external dependency and no fabricated pin; all new public model fields include contract generation; legacy snapshot hashing and future-write validation are separated. The master P0-S/P0-U gates pause only their dependent legacy/invalid-target semantics; ready work continues.
