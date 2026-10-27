> Historical review of the implementation before the bounded correction batch. Findings are reviewer claims, not all confirmed defects. See the final implementation handoff for dispositions and verification. In particular Argon A3 was rejected against the actual source, and its runtime-port claim is inaccurate; the isolated candidate is port 18190.

# Independent Final Implementation Review (Argon 4)

- **Workspace**: `C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation` (`feat/phase0-acceptance-plan`, base `ba0b91b` + uncommitted working tree)
- **Governing Contracts & Plans**:
  - [2026-10-18-acceptance-workflow-contracts.md](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/docs/superpowers/specs/2026-10-18-acceptance-workflow-contracts.md)
  - [2026-10-18-acceptance-remediation.md](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/docs/superpowers/plans/2026-10-18-acceptance-remediation.md)
  - [contract-review-disposition.md](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/.superpowers/sdd/2026-10-18-acceptance-remediation/contract-review-disposition.md)
  - [2026-10-18-phase0-manual-acceptance.md](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/docs/superpowers/reviews/2026-10-18-phase0-manual-acceptance.md)

---

## Executive Summary & Final Readiness Recommendation

**Recommendation: NOT READY FOR FINAL ACCEPTANCE SIGN-OFF (Conditional Hold Pending Targeted Fixes)**

The uncommitted implementation delivers the core Phase 0 remediation architecture—immutable append-only workflow tables, explicit work rounds (`ordinary`, `carry_forward`, `consolidation`, `clean_restart`), private per-person submission isolation on API routes, lead-only final result selection with optimistic CAS, asynchronous frozen `final_t1_export`, T1 two-part URN source normalization, durable multilingual search preferences, creation-default axis tracking, and the full frontend workflow surface.

However, end-to-end code path tracing across `application/`, `authz/`, `exchange/`, `storage/`, and `frontend/` uncovered **1 Critical**, **3 High**, and **3 Medium** concrete defects that break scientific export provenance, source-obligation audit closure, repository-level cross-person isolation, or repeat translation review assignment in multi-step correction flows:

1. **[Critical — Scientific Provenance Loss on Export]**: Consolidated merged annotations (`method="merged"` with multiple `round-input:<input_id>` `source_refs`) are overwritten during T1 export by [`submission_to_unit`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/exchange/t1.py#L610-L663) into `method="edited"` with only the *last* merged input's `source_ref`.
2. **[High — Final Export Source & Obligation Closure Gap]**: [`freeze_content`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/exchange/final_content.py#L14-L53) and [`run_final_export`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/exchange/final_export.py#L72-L166) never read [`ReviewObligationResolutionRow`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/storage/workflow_tables.py#L148-L176). Consequently, updated original source texts (`new_source_document_id`) reviewed via `no_change` or `accepted_corrected` are omitted from `source-texts.jsonl` (because `derived_from` remains anchored to the original source per contract), and `receipt.json` omits `receipt_source_review` resolution records.
3. **[High — Translation Correction / Source-Obligation Assignment Crash & Multi-Edge Lockout]**: [`TranslationWorkflowService.assign_correction`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/translation_workflow.py#L120-L166) only reopens an existing assignment when its status is in `{"open", "in_progress", "reopened"}`. When a reviewer who previously submitted a review on that translation is assigned a follow-up correction or source-obligation review (which is the normal case in `seed_t5_acceptance.py` where `demo-reviewer` is the sole EN/DE reviewer), `assign_correction` executes `insert(AssignmentRow)` and triggers a PostgreSQL `UniqueViolation` (`uq_assignments_active`). Moreover, [`TranslationWorkflowService.resolve`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/translation_workflow.py#L243) immediately transitions the assignment to `"submitted"` upon resolving a single `no_change` source edge, locking out any remaining unresolved source edges on the same linear source chain.
4. **[High — Repository-Level Cross-Person Isolation Bypass]**: [`ScopedRepository.get_submissions_for_document`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/authz/scoped.py#L780-L785) and [`ScopedRepository.get_search_event`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/authz/scoped.py#L828-L846) check only document-level visibility (`self._document` / `require_document`) and do not enforce per-person ownership (`may_read_human_submission` / `annotator_id == access.pseudonym`).
5. **[Medium — Warning Code & Omission Schema Drift]**: [`Repository.list_workflow_causes`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/storage/repository.py#L590) emits `"TASK_HELD"` instead of contract-specified `"TASK_ON_HOLD"`, [`ROUND_REVIEW_PENDING`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/docs/superpowers/specs/2026-10-18-acceptance-workflow-contracts.md#L163) is never emitted, and [`project_warnings`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/workflow_warnings.py#L34-L38) omits `"reason": "no_selection"` from omission records.
6. **[Medium — Problem Report Post-Resolution State Transitions]**: [`ProblemReportService.act`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/problem_reports.py#L507-L568) does not guard against running `extend_hold` or `restart` on an already-`resolved` report, allowing a resolved report to transition back to `on_hold` or spawn duplicate `clean_restart` rounds.
7. **[Medium — Double `workflow_revision` Bump on First Problem Report Without Prior Round]**: [`ProblemReportService.report`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/problem_reports.py#L331-L346) increments `AssignmentRow.workflow_revision` twice (+2) when lazily creating an initial round (`service.create` + `self._hold`), desynchronizing the optimistic `+1` revision update in [`TaskProblemActions.tsx`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/frontend/src/tasks/TaskProblemActions.tsx#L45).

---

## Concrete Findings

### Finding 1 — Consolidation merge (`method="merged"`) is overwritten to `method="edited"` with a single `source_ref` during T1 export
- **Severity**: **Critical** (Scientific Provenance & Consolidation Contract)
- **Locations**:
  - [`MergeRoundInputsService.merge`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/work_rounds.py#L725-L784)
  - [`submission_to_unit`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/exchange/t1.py#L610-L663)
- **Contract Reference**:
  - [2026-10-18-acceptance-workflow-contracts.md §4 (line 123) & §8 (lines 200–203)](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/docs/superpowers/specs/2026-10-18-acceptance-workflow-contracts.md#L123):
    > *"When two inputs represent one clinical finding, `POST /api/v1/workspaces/{workspace_id}/round-inputs:merge` binds multiple `input_id` values to one replacement snapshot and emits `method: "merged"` with all input `source_refs` in canonical order."*
- **Concrete Trigger Scenario**:
  1. A reviewer starts a consolidation round (`draft.key.mode == "review"`).
  2. The reviewer calls `POST /api/v1/workspaces/{workspace_id}/round-inputs:merge` with two frozen inputs `input_ids=["iid1", "iid2"]` and replacement `(ann_id, ver)`.
  3. [`MergeRoundInputsService.merge`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/work_rounds.py#L754-L782) sets the replacement snapshot's provenance to `Provenance(..., method="merged", source_refs=("round-input:iid1", "round-input:iid2"))` and writes two `ReviewDecision` entries into `draft.decisions`, both with `outcome="changed"` and `replacement=AnnotationVersionRef(annotation_id=ann_id, version=ver)`.
  4. When the submitted consolidation round is exported via [`submission_to_unit`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/exchange/t1.py#L610-L663) (either in standard T1 export or `final_t1_export`), `key.mode == "review"` is true (`line 612`). The loop at `lines 613–631` iterates `submission.decisions`:
     ```python
     elif decision.outcome == "changed" and decision.replacement is not None:
         replacement = (
             decision.replacement.annotation_id,
             decision.replacement.version,
         )
         reviewed[replacement] = ("edited", source)
     ```
     The second decision overwrites `reviewed[replacement]` with `("edited", source_2)`.
  5. At [`exchange/t1.py:660-662`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/exchange/t1.py#L660-L662), `review = reviewed.get((item.annotation_id, snap.version))` matches `("edited", source_2)` and calls `reviewed_provenance(reviewer, "edited", source_2)`, which constructs a fresh `Provenance(method="edited", source_refs=(source_2,))`, wiping out `method="merged"`, dropping `source_1`, and discarding `snap.provenance.notes`.
- **Practical Impact**: Every consolidated merged annotation in `selected.t1.zip` (and research T1 exports) loses its `"merged"` provenance method and all but the final merged input's `source_ref`, corrupting multi-annotator scientific attribution.
- **Evidence Classification**: **Source inference** (verified directly in [`work_rounds.py`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/work_rounds.py#L754-L782) and [`t1.py`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/exchange/t1.py#L612-L662); [`tests/test_work_rounds.py`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/tests/test_work_rounds.py#L168-L176) only asserted the draft provenance before `submission_to_unit` export).
- **Minimal Corrective Direction**:
  - In [`submission_to_unit`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/exchange/t1.py#L612-L663), group `changed` decisions by `replacement` tuple: when multiple decisions target the same `replacement` (or when `snap.provenance.method == "merged"`), emit `method="merged"` with all normalized `source` refs in canonical order and preserve `snap.provenance.notes`.

---

### Finding 2 — Final export omits `ReviewObligationResolutionRow` audit records from `receipt.json` and omits updated original source texts from `source-texts.jsonl`
- **Severity**: **High** (Final Export Provenance & Source Closure)
- **Locations**:
  - [`freeze_content`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/exchange/final_content.py#L14-L53)
  - [`run_final_export`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/exchange/final_export.py#L72-L166)
- **Contract Reference**:
  - [2026-10-18-acceptance-workflow-contracts.md §2 (line 37) & §8 (lines 183, 218–221)](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/docs/superpowers/specs/2026-10-18-acceptance-workflow-contracts.md#L218-L221):
    > *"`export_selection_snapshots` (`snapshot_id` PK, `project_id`, `job_id` UNIQUE, `created_by`, `created_at`, `selections_json`, `omissions_json`, `warnings_json`, `receipt_source_review_json`, `content_json`)"*
    > *"Every source, intermediate correction, reviewed source and translation text needed for ancestry or obligation closure is exported in `source-texts.jsonl` with exact `Document`/`Variant` identities and text hashes, even where no annotation set exists on that text."*
- **Concrete Trigger Scenario**:
  1. English source `doc-en-v1` is translated into German `doc-de-v1` (`derived_from="doc-en-v1"`).
  2. English source is corrected to `doc-en-v2` (`origin="correction", derived_from="doc-en-v1"`).
  3. The reviewer resolves the source-update obligation (`doc-en-v1 -> doc-en-v2`) on `doc-de-v1` via [`TranslationWorkflowService.resolve`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/translation_workflow.py#L207-L277) (either `no_change` on `doc-de-v1` or `corrected` producing `doc-de-v2` with `derived_from="doc-de-v1"`). Per Contract §5 (`line 131`), `doc-de-v1.derived_from` is never mutated and continues to point to `doc-en-v1`.
  4. The project lead selects the German submission on `doc-de-v1` (or `doc-de-v2`) and triggers `POST /api/v1/projects/{key}/final-exports` while English is either omitted or selected on `doc-en-v1`.
  5. [`freeze_content`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/exchange/final_content.py#L42-L47) collects `source-texts.jsonl` documents purely by walking `entry.variant.derived_from` from `{sub.origin_key.document_id for sub in content.submissions}`. Because `doc-de-v2 -> doc-de-v1 -> doc-en-v1`, `doc-en-v2` (`ReviewObligationResolutionRow.new_source_document_id`) is never visited and is absent from `source-texts.jsonl`.
  6. Furthermore, neither [`freeze_content`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/exchange/final_content.py) nor [`run_final_export`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/exchange/final_export.py#L148-L166) queries [`ReviewObligationResolutionRow`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/storage/workflow_tables.py#L148-L176), so `receipt.json` contains no `receipt_source_review` / obligation resolution entries.
- **Practical Impact**: Exported final packages lack the reviewed source text `doc-en-v2` in `source-texts.jsonl` and omit source-obligation resolution records from `receipt.json`.
- **Evidence Classification**: **Source inference** (verified in [`final_content.py`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/exchange/final_content.py#L14-L53) and [`final_export.py`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/exchange/final_export.py#L148-L166)).
- **Minimal Corrective Direction**:
  - In [`freeze_content`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/exchange/final_content.py), query `ReviewObligationResolutionRow` for translation roots on the selected documents' lineages, include `old_source_document_id` and `new_source_document_id` (and their `derived_from` ancestry) in the `pending` document closure for `source-texts.jsonl`, freeze the obligation resolution records into the snapshot payload, and emit them in `receipt.json` inside [`run_final_export`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/exchange/final_export.py#L148-L166).

---

### Finding 3 — Assigning a translation correction on a previously reviewed variant to the same reviewer crashes with `UniqueViolation`, and resolving one `no_change` source edge locks out remaining edges
- **Severity**: **High** (Translation Correction & Source-Obligation Workflow)
- **Locations**:
  - [`TranslationWorkflowService.assign_correction`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/translation_workflow.py#L120-L166)
  - [`TranslationWorkflowService.resolve`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/translation_workflow.py#L207-L277)
  - [`AssignmentRow` (`uq_assignments_active`)](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/storage/tables.py#L778-L786)
- **Contract Reference**:
  - [2026-10-18-acceptance-workflow-contracts.md §5 (lines 126–137)](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/docs/superpowers/specs/2026-10-18-acceptance-workflow-contracts.md#L126-L137)
  - [2026-10-18-acceptance-remediation.md Task 5 (lines 90, 108)](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/docs/superpowers/plans/2026-10-18-acceptance-remediation.md#L90):
    > *"For each translation root, resolve its exact historical source with `resolve_translation_lineage`; enumerate every later correction edge on that source's linear chain... Closing one obligation cannot clear a later source change."*
- **Concrete Trigger Scenario**:
  - **Trigger A (Re-assigning the reviewer who accepted the translation)**:
    1. `demo-reviewer` reviews and accepts German translation `de-v1`. Their `AssignmentRow` on `(project_id, document_id="de-v1", user_id="demo-reviewer", task="translation_review")` now has `status="submitted"` and `revoked_at=None`. (In [`scripts/seed_t5_acceptance.py`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/scripts/seed_t5_acceptance.py#L36-L41), `demo-reviewer` is the *only* user with `["en", "de"]` language eligibility.)
    2. Later, the English source is corrected (`en-v1 -> en-v2`), or the project lead clicks *"Request translation correction"* on `de-v1` and assigns `demo-reviewer` via `POST /api/v1/projects/{key}/variants/de-v1/translation-corrections`.
    3. [`TranslationWorkflowService.assign_correction`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/translation_workflow.py#L120-L166) queries `existing` on `(project_id, document_id, user_id, task="translation_review", revoked_at=None)`.
    4. At [`line 124`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/translation_workflow.py#L124), it checks `if existing is not None and existing.status in {"open", "in_progress", "reopened"}:`. Because `existing.status == "submitted"`, the `if` branch is skipped and execution falls through to [`conn.execute(insert(AssignmentRow).values(...))` at line 155](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/translation_workflow.py#L155).
    5. PostgreSQL immediately raises `IntegrityError` (`UniqueViolation` on partial unique index [`uq_assignments_active`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/storage/tables.py#L778-L786)), returning an unhandled 500 error.
  - **Trigger B (Multi-step source correction chain `en-v1 -> en-v2 -> en-v3`)**:
    1. When two source correction edges exist on the linear chain (`en-v1 -> en-v2` and `en-v2 -> en-v3`), resolving the first edge with `resolution="no_change"` calls [`self.reviews.submit(...)`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/translation_workflow.py#L243), which transitions `AssignmentRow.status` to `"submitted"`.
    2. The reviewer is immediately locked out from resolving the second edge (`en-v2 -> en-v3`), and if the lead tries to assign a new translation review on `de-v1` to the same reviewer, Trigger A crashes with `UniqueViolation`.
- **Practical Impact**: In any project where the same bilingual reviewer is assigned to review a subsequent source update or correction on a translation they previously accepted (including the standard `seed_t5_acceptance.py` persona setup), `assign_correction` fails with an unhandled database `IntegrityError`.
- **Evidence Classification**: **Source inference** (verified across [`translation_workflow.py:120-166, 240-248`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/translation_workflow.py#L120-L166) and [`tables.py:778-786`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/storage/tables.py#L778-L786)).
- **Minimal Corrective Direction**:
  - In [`TranslationWorkflowService.assign_correction`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/translation_workflow.py#L124), handle `existing.status == "submitted"` by reopening the existing `AssignmentRow` (`status="reopened"`, `workflow_revision = existing.workflow_revision + 1`, resetting `TranslationReviewDraftRow` to `variant.text` and `{}`) instead of inserting a duplicate active row.
  - In [`TranslationWorkflowService.resolve`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/translation_workflow.py#L240-L248), if other unresolved `TRANSLATION_SOURCE_UPDATED` edges remain on `document_id` after recording `no_change`, either keep the review assignment `"reopened"`/`"in_progress"` for the remaining edges or allow `resolve` to reopen/continue without requiring a separate assignment.

---

### Finding 4 — `ScopedRepository.get_submissions_for_document` and `ScopedRepository.get_search_event` lack per-person isolation checks
- **Severity**: **High** (Authorization & Cross-Person Input Privacy)
- **Locations**:
  - [`ScopedRepository.get_submissions_for_document`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/authz/scoped.py#L780-L785)
  - [`ScopedRepository.get_search_event`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/authz/scoped.py#L828-L846)
- **Contract Reference**:
  - [2026-10-18-acceptance-workflow-contracts.md §3 (line 88)](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/docs/superpowers/specs/2026-10-18-acceptance-workflow-contracts.md#L88):
    > *"Update the existing generic submission/snapshot readers as well: a new safe endpoint does not compensate for an old reader that exposes cross-person inputs."*
- **Concrete Trigger Scenario**:
  1. [`ScopedRepository.get_submissions_for_document(project_key, document_id)`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/authz/scoped.py#L780-L785) checks only `self._document(project_key, document_id)` (whether the user has any assignment on that document or its lineage) and then returns `super().get_submissions_for_document(project_key, document_id)` ([`repository.py:3397-3420`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/storage/repository.py#L3397-L3420)), returning **every** annotator's `SubmissionRecord` on that document without calling [`may_read_human_submission`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/authz/versions.py#L64-L115).
  2. [`ScopedRepository.get_search_event(event_id, project_key)`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/authz/scoped.py#L828-L846) checks `require_document(conn, self.access, project_id, project_key, owner)` (`line 845`), which succeeds if the caller is assigned to the same document, without checking `WorkspaceKey.from_string(wkey).annotator_id == self.access.pseudonym` (unlike [`get_search_events_for_workspace` at `lines 897–900`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/authz/scoped.py#L897-L900)).
- **Practical Impact**: Although the HTTP routes currently avoid calling `get_submissions_for_document` directly and `EditingService.apply` subsequently checks `event.workspace_key != key`, leaving these two `ScopedRepository` readers without per-person checks directly violates Contract §3 (`line 88`).
- **Evidence Classification**: **Source inference** (verified in [`scoped.py:780-785, 828-846`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/authz/scoped.py#L780-L846)).
- **Minimal Corrective Direction**:
  - In [`ScopedRepository.get_submissions_for_document`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/authz/scoped.py#L780-L785), filter results using `may_read_human_submission(conn, self.access, project_id, project_key, sub.submission_id)`.
  - In [`ScopedRepository.get_search_event`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/authz/scoped.py#L828-L846), require `can(self.access, Action.EXPORT_ALL_WORK, project_key)` or `WorkspaceKey.from_string(wkey).annotator_id == self.access.pseudonym`.

---

### Finding 5 — Shared warning projection emits `"TASK_HELD"` instead of `"TASK_ON_HOLD"`, never emits `"ROUND_REVIEW_PENDING"`, and omits `"reason": "no_selection"` on omissions
- **Severity**: **Medium** (Contract Schema & Warning Code Compliance)
- **Locations**:
  - [`Repository.list_workflow_causes`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/storage/repository.py#L561-L598)
  - [`FinalResultService._projection`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/final_results.py#L199-L266)
  - [`project_warnings`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/workflow_warnings.py#L34-L39)
  - [`FinalOmission`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/api/final_result_routes.py#L44-L46)
- **Contract Reference**:
  - [2026-10-18-acceptance-workflow-contracts.md §7 (lines 155–166) & §8 (line 174)](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/docs/superpowers/specs/2026-10-18-acceptance-workflow-contracts.md#L155-L174):
    - Warning code table specifies `TASK_ON_HOLD` and `ROUND_REVIEW_PENDING`.
    - Omissions array specifies `[{"case_id":"GSC17","language":"de","reason":"no_selection"}]`.
- **Concrete Trigger Scenario**:
  1. When an assignment is held, [`Repository.list_workflow_causes`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/storage/repository.py#L590) emits `"code": "TASK_HELD"` instead of `"TASK_ON_HOLD"`.
  2. When a carry-forward round, consolidation round, or translation review on a selected chain has unresolved work, neither [`list_workflow_causes`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/storage/repository.py#L561-L598) nor [`FinalResultService._projection`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/final_results.py#L199-L266) emits `"ROUND_REVIEW_PENDING"`.
  3. When a `(case_id, language)` pair has no final selection, [`project_warnings`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/workflow_warnings.py#L34-L38) emits `{"case_id": case, "language": language}` without `"reason": "no_selection"`.
- **Practical Impact**: API consumers and exported `receipt.json` snapshots diverge from the contract schema in §7 and §8.
- **Evidence Classification**: **Source inference & automated test inspection** ([`tests/test_workflow_warnings.py`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/tests/test_workflow_warnings.py) was written against `"TASK_HELD"` and 2-key omission dicts).
- **Minimal Corrective Direction**:
  - Emit `"TASK_ON_HOLD"` (or normalize in `workflow_warnings.py`), emit `"ROUND_REVIEW_PENDING"` when an active round/review on the selected lineage has pending work, and include `"reason": "no_selection"` in `project_warnings` and `FinalOmission`.

---

### Finding 6 — Resolved problem reports still accept `extend_hold` and `restart` actions
- **Severity**: **Medium** (Problem Report State Machine & Concurrency Lock Ordering)
- **Locations**:
  - [`ProblemReportService.act`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/problem_reports.py#L494-L568)
  - [`ProblemReportDetail.tsx`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/frontend/src/tasks/ProblemReportDetail.tsx#L44-L59)
- **Contract Reference**:
  - [2026-10-18-acceptance-workflow-contracts.md §2 (line 33) & §6 (lines 140–150)](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/docs/superpowers/specs/2026-10-18-acceptance-workflow-contracts.md#L140-L150)
- **Concrete Trigger Scenario**:
  1. A project lead resolves a problem report via `action="resolve"` or `action="restart"`, putting the report into `state="resolved"`.
  2. [`ProblemReportService.act`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/problem_reports.py#L507-L568) never checks `state["state"]` before executing `extend_hold`, `resolve`, or `restart`.
  3. If the lead invokes `extend_hold` on the resolved report, `act` appends an event with `state_after="on_hold"` (`line 541`), reopening a resolved report. If the lead invokes `restart` again with a new `request_id`, `act` abandons the newly created `clean_restart` round and creates a second `clean_restart` round (`lines 553–565`).
  4. Additionally, in `extend_hold`, [`_prepare`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/problem_reports.py#L74) locks `raw["assignment_id"]` before [`line 533`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/problem_reports.py#L533) locks `selected`; if `selected` includes the reporter's own assignment (which [`ProblemReportDetail.tsx:38`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/frontend/src/tasks/ProblemReportDetail.tsx#L38) does not filter out), [`_hold`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/problem_reports.py#L224) overwrites `AssignmentRow.hold_reason` on the reporter's task.
- **Practical Impact**: Resolved or already-restarted problem reports can be accidentally re-restarted or moved back to `on_hold` from the UI (`ProblemReportDetail.tsx` renders all action buttons unconditionally regardless of `report.state`).
- **Evidence Classification**: **Source inference** (verified in [`problem_reports.py:507-568`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/problem_reports.py#L507-L568) and [`ProblemReportDetail.tsx:100-149`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/frontend/src/tasks/ProblemReportDetail.tsx#L100-L149)).
- **Minimal Corrective Direction**:
  - In [`ProblemReportService.act`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/problem_reports.py#L507), reject `extend_hold`, `resolve`, and `restart` when `state["state"] == "resolved"` (while allowing `resume` to release remaining held assignments without regressing `state_after` from `"resolved"`), exclude `raw["assignment_id"]` from `extend_hold` targets, and disable non-applicable buttons in [`ProblemReportDetail.tsx`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/frontend/src/tasks/ProblemReportDetail.tsx).

---

### Finding 7 — Reporting a problem on an open task without a prior round increments `AssignmentRow.workflow_revision` twice (+2)
- **Severity**: **Medium** (Stale-Write Revision Accounting)
- **Locations**:
  - [`ProblemReportService.report`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/problem_reports.py#L316-L348)
  - [`TaskProblemActions.tsx`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/frontend/src/tasks/TaskProblemActions.tsx#L39-L51)
- **Concrete Trigger Scenario**:
  1. An annotator opens an assignment (`status="open"`, `active_round_id=None`, `workflow_revision=1`) and immediately submits a problem report before starting a work round.
  2. In [`ProblemReportService.report`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/problem_reports.py#L331), `service.create(..., expected_revision=expected_revision, kind="ordinary")` creates the initial round and bumps `AssignmentRow.workflow_revision` from `1` to `2`.
  3. At [`line 346`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/problem_reports.py#L346), `self._hold(...)` bumps `AssignmentRow.workflow_revision` a second time from `2` to `3`.
  4. Meanwhile, [`TaskProblemActions.tsx:45`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/frontend/src/tasks/TaskProblemActions.tsx#L45) optimistically updates local state with `workflow_revision: assignment.workflow_revision + 1` (`2`) before the async `refresh()` completes.
- **Practical Impact**: Single logical mutation (`POST /problem-reports`) increments `workflow_revision` by 2 instead of 1 when lazily creating a round, briefly desynchronizing the client's optimistic revision state.
- **Evidence Classification**: **Source inference** (verified in [`problem_reports.py:331-346`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/problem_reports.py#L331-L346) and [`TaskProblemActions.tsx:45`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/frontend/src/tasks/TaskProblemActions.tsx#L45)).
- **Minimal Corrective Direction**:
  - Return the updated `workflow_revision` on the `ProblemReportItem` response (or avoid double-incrementing `workflow_revision` within the same transaction in `ProblemReportService.report`) and use the server-returned revision in `TaskProblemActions.tsx`.

---

## Verified Contract Invariants & Disproved Hypotheses

The following high-risk contract areas were traced end-to-end and verified to be **sound**:

1. **Exact T1 Two-Part URN + 64-Hex Version Source Normalization (Task 1)**:
   - Verified in [`_export_source_ref`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/exchange/t1.py#L394-L455): inventory lookup against `proposals` and `human_inputs` by `(source_id, version)` runs *before* `ontospan.parse_annotation_ref`, preventing two-part URNs (`urn:ontotator:0.1:proposal:a1`) paired with 64-hex snapshot hashes from being misparsed as three-part URNs.
2. **PostgreSQL Row-Lock Semantics (`FOR NO KEY UPDATE`)**:
   - Confirmed per [contract-review-disposition.md](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/.superpowers/sdd/2026-10-18-acceptance-remediation/contract-review-disposition.md): SQLAlchemy `with_for_update(key_share=True)` without `read=True` compiles to PostgreSQL `FOR NO KEY UPDATE` (an exclusive non-key lock that blocks concurrent `FOR UPDATE` / `FOR NO KEY UPDATE`), not `FOR KEY SHARE`. Combined with the project-level advisory lock [`lock_project_workflow`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/storage/repository.py#L291-L303) (`pg_advisory_xact_lock`), workflow mutations are properly serialized per project.
3. **Append-Only Immutability Triggers**:
   - Verified in [`APPEND_ONLY_TABLES`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/storage/tables.py#L38-L57): `work_round_events`, `work_round_inputs`, `problem_reports`, `problem_report_events`, `problem_report_holds`, `review_obligation_resolutions`, and `export_selection_snapshots` are all protected by `ontotator_forbid_mutation`, while `final_selections` is intentionally excluded so CAS selection updates work.
4. **Creation Defaults & Policy Revision Acknowledgement (Task 8)**:
   - Verified in [`EditingService._create`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/editing.py#L739-L765), [`EditingService._update`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/editing.py#L804-L815), and [`SubmissionService._check_axis_policy`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/submissions.py#L297-L331): `axes_defaulted` is populated only on fresh non-adopted creations, cleared only for axes explicitly present in `chosen_axis_ids`, and `warn` mode requires an exact `(draft_revision, policy_revision, warning_digest)` acknowledgement.
5. **Durable Personal Multilingual Search Preferences (Task 9)**:
   - Verified in [`PreferenceService`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/application/preferences.py#L67-L114) and [`auth/preferences.py`](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/src/ontotator/auth/preferences.py#L24-L106): stored per user with `with_for_update()` row locking and safe fallback on legacy payloads.
6. **Clarified Non-Defects Preserved**:
   - `F09` and `F18` (clarified in [2026-10-18-phase0-manual-acceptance.md](file:///C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation/docs/superpowers/reviews/2026-10-18-phase0-manual-acceptance.md)) were not resurrected; English light UI and absence of new SVG status paths are respected as intentional constraints.

---

## Scope Assessed & Remaining Uncertainty

### Scope Assessed (Read-Only Static & Test Inspection)
- **Specs, Plans & Reviews**: `2026-10-18-acceptance-workflow-contracts.md`, `2026-10-18-acceptance-remediation.md`, `contract-review-disposition.md`, `2026-10-18-phase0-manual-acceptance.md`.
- **Backend Application, Domain, Authz, Storage & Exchange**:
  - `application/work_rounds.py`, `problem_reports.py`, `final_results.py`, `workflow_warnings.py`, `translation_workflow.py`, `translation_reviews.py`, `editing.py`, `submissions.py`, `reviews.py`, `preferences.py`.
  - `authz/workflow.py`, `visibility.py`, `versions.py`, `scoped.py`, `policy.py`.
  - `storage/database.py`, `schema.py`, `tables.py`, `workflow_tables.py`, `final_tables.py`, `repository.py`.
  - `exchange/final_export.py`, `final_content.py`, `human_inputs.py`, `t1.py`, `jobs.py`, `uploads.py`, `reanchor_job.py`, `packages/models.py`.
  - `api/app.py`, `work_round_routes.py`, `problem_report_routes.py`, `final_result_routes.py`, `submission_history_routes.py`, `translation_workflow_routes.py`, `routes.py`, `variant_routes.py`, `project_routes.py`, `assignment_routes.py`.
- **Frontend & Acceptance Seed**:
  - `frontend/src/App.tsx`, `app/CaseScreen.tsx`, `tasks/*`, `variants/*`, `translation/*`, `admin/*`, `editor/*`.
  - `scripts/seed_t5_acceptance.py`, `examples/t5-acceptance/manifest.json`, and backend test modules under `tests/`.

### Remaining Uncertainty
- **No Live Execution in This Session**: Because terminal/command execution tools are disabled by policy in this headless review session, no pytest suites, OpenAPI regeneration checks, Docker Compose health checks, or live browser walkthroughs against the isolated acceptance stack (`18082`) or protected demo (`18081`) were executed during this review pass.
- **Manual Acceptance Gate Remains Open**: Resolving Findings 1–7 and verifying them via automated tests and a live browser walkthrough on the isolated acceptance deployment (`18082`) are required before claiming manual acceptance or production readiness.
