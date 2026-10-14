# T4a: Workflows (stage chains, stage tasks, blind mode, late proposals, workflow UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Lean format: files, interfaces, tables, test cases and acceptance criteria per task. Implementers write the code test-first; code appears only where it defines a contract.

**Goal of Part 1:**
- A project defines an ordered chain of stages (annotate, revise, adjudicate), set up from templates.
- Each document runs its own copy of the chain. A stage starts when the previous one is released for that document.
- Assignments belong to a stage. The server derives the workspace from the assignment, so the client no longer picks a mode.
- Revise and assisted annotate drafts inherit their input and must decide every inherited annotation before release (W2, O5).
- Released results are materialised with lineage (O3). Blind mode (W4) and late proposal sets (O7) are enforced on the server.
- The project lead can intervene per document at any time, and every intervention is audited.

**Architecture of Part 1:**
- **Data:** migration `0007_workflows` adds `workflow_stages` (the project chain), `document_stages` (the per-document instances), the append-only `stage_results`, the stage link on `assignments` and `drafts`, and the blind and late-proposal state on `drafts`.
- **Pure core:** `workflow/chain.py` (templates and validation) and `workflow/machine.py` (`advance`, the stage state machine). Both have no database access. `workflow/results.py` materialises results with lineage, and `workflow/inputs.py` computes a stage's working input.
- **Services:** `WorkflowService` records the machine's transitions, `AssignmentService` (T3a) learns stage tasks, and `WorkspaceService` opens a workspace by assignment.
- **Visibility:** inputs follow U2 and W4. Parallel peers are never part of an input. Tool proposals follow the stage policy. Later-stage results stay invisible to earlier annotators (Q25).
- **Compatibility:** `/workspaces/open` keeps its body for the current UI until Task 17, but only as a lookup hint. The key is always derived on the server.

**Spec:** `docs/superpowers/specs/2026-10-14-t4-workflows-merge-design.md` (W1–W4; W5 adjudication and W6 agreement follow in T4b, W7 and W8 in T4b). T7: `docs/superpowers/specs/2026-10-14-t7-integrations-design.md` (O3, O5, O7). Index: `docs/superpowers/plans/2026-10-14-t3-t5-t4-index.md` (shared contracts, D-q, D-t, U2, U4, U5, Q23, Q25, Q26). Builds on T5.

**Branch / worktree:** `feat/t4a-workflows` from `feat/t5-variants-review`, worktree `.worktrees/t4a-workflows`. Set up with `uv sync` and `npm --prefix frontend ci`. Baseline: `scripts/check.sh`.

**Commit rule:** per task, `uv run ruff check --fix src tests && uv run ruff format src tests && uv run mypy src`, then one conventional commit without AI attribution.

---

## Part 1: Workflow engine (Tasks 1–10)

### Task 1: Tables (migration 0007) and the workflow policy action

**Modify** `storage/tables.py` and `authz/policy.py`. **Create** `storage/migrations/versions/0007_workflows.py`. Add `"stage_results"` to `APPEND_ONLY_TABLES`.

| Table / change | Columns (NOT NULL unless "null") | Keys |
|---|---|---|
| `workflow_stages` | `project_id` → projects; `position` int (1-based); `stage_type` text CHECK in ('annotate','revise','adjudicate'); `k` int default 1 CHECK `k BETWEEN 1 AND 10`; `proposal_policy` text CHECK in ('hidden','toggle','shown'); `label` text | PK (project_id, position) |
| `document_stages` | `id` bigint identity; `project_id`; `document_id`; `position` int; `stage_type`; `k`; `proposal_policy`; `label`; `status` text CHECK in ('pending','active','complete','skipped'); `origin` text CHECK in ('chain','inserted'); `final_result_id` bigint null → stage_results; `activated_at` null; `completed_at` null | PK id; FK (project_id, document_id) → documents; UNIQUE (project_id, document_id, position) DEFERRABLE INITIALLY IMMEDIATE named `uq_document_stages_position`; ix (project_id, status) |
| `stage_results` (append-only) | `id` bigint identity (BY DEFAULT, see Task 6); `project_id`; `document_id`; `document_stage_id` → document_stages; `set_id` text; `set_kind` text CHECK in ('stage_result','adjudicated'); `annotations` jsonb (sorted `[[annotation_id, version], …]`); `source_submission_ids` jsonb; `actors` jsonb (pseudonyms); `blind` bool; `created_at` default now(); `created_by` → users null | PK id; UNIQUE (project_id, set_id); ix (project_id, document_id) |
| `assignments` + | `document_stage_id` bigint null → document_stages; replace `ck_assignments_task` with `task IN ('annotate','review','translation_review','revise','adjudicate')`; replace the partial unique index with one on (project_id, document_id, user_id, task, COALESCE(document_stage_id, 0)) WHERE revoked_at IS NULL | ix (document_stage_id) |
| `drafts` + | `document_stage_id` bigint null → document_stages; `foreign_visible` bool default false; `foreign_seen` bool default false; `proposal_sets_known` jsonb default '{}' | ix (document_stage_id, annotator_id) |

`final_result_id` and `stage_results.document_stage_id` reference each other. Create `document_stages` first, then `stage_results`, then add the `final_result_id` foreign key with `op.create_foreign_key`.

`proposal_sets_known` maps a proposal set id to `input`, `adopted` or `dismissed` (Task 8).

**Grants:** full DML for the application role on `workflow_stages`, `document_stages` and the new columns. `stage_results` gets `SELECT, INSERT` only, plus the T2c trigger pair.

**Data step** (in the same migration, SQL only):
- every project gets the default chain: one row `(position 1, 'annotate', k 1, 'shown', 'Annotate')`;
- the T3 `review` task conversion is in Task 4.

**Policy:** `Action.MANAGE_WORKFLOW` is allowed for system admin and lead. Add its row to the literal matrix in `tests/test_policy.py`.

**Tests:**
- `tests/test_schema.py` counts one more append-only table (3 more statements). Update the expected count in the acceptance line.
- `tests/test_schema.py::test_the_application_cannot_rewrite_stage_results`: an `UPDATE` fails with "permission denied".
- `tests/test_policy.py::test_every_role_and_action` gains the row for `MANAGE_WORKFLOW`.
- `tests/test_workflow_migration.py::test_every_project_has_the_default_chain`: a project created before the migration (via `pg_harness.unmigrated_database_url` at `0006`, then upgraded) has exactly one annotate stage with policy `shown`.

**Acceptance:** `uv run pytest tests/test_schema.py tests/test_policy.py tests/test_workflow_migration.py -q` passes. Commit: `feat(workflow): stage tables, stage results and the workflow policy action`.

---

### Task 2: Chains, templates and validation

**Create** `src/ontocurator/workflow/__init__.py`, `src/ontocurator/workflow/chain.py`, `src/ontocurator/workflow/config.py` and `src/ontocurator/api/workflow_routes.py`.

**Interface (`chain.py`, pure):**
- `StageType = Literal["annotate", "revise", "adjudicate"]`; `ProposalPolicy = Literal["hidden", "toggle", "shown"]`.
- `@dataclass(frozen=True) class StageSpec(stage_type, k=1, proposal_policy=None, label=None)`. A `None` policy is filled by `default_policy(position)`: `shown` for position 1 (U4), `toggle` otherwise. A `None` label becomes "Annotate", "Revise" or "Adjudicate".
- `TEMPLATES: Mapping[str, tuple[StageSpec, ...]]`:
  - `single`: annotate (k=1). This is the default chain.
  - `sequential`: annotate (k=1) → revise.
  - `parallel`: annotate (k=2) → adjudicate.
- `template(name, *, k=None) -> tuple[StageSpec, ...]`. `k` overrides the annotate stage of `parallel` (2–10). An unknown name raises `TEMPLATE_UNKNOWN`.
- `validate_chain(stages: Sequence[StageSpec]) -> None` raises `DomainError("CHAIN_INVALID", {"position": p, "rule": r})` for the first broken rule.

**Chain rules** (the contract; `rule` codes in brackets):

| # | Rule | Code |
|---|---|---|
| 1 | 1 to 10 stages | `length` |
| 2 | Stage 1 is `annotate`, and no other stage is `annotate` | `annotate_first` |
| 3 | `revise` and `adjudicate` have k = 1 | `single_person` |
| 4 | `adjudicate` directly follows an `annotate` stage with k ≥ 2 | `adjudicate_input` |
| 5 | `revise` follows a single-result stage: annotate with k = 1, revise or adjudicate | `revise_input` |
| 6 | An annotate stage with k ≥ 2 is followed by `adjudicate` | `parallel_needs_adjudication` |

Rule 6 implies that the chain always ends in a single-result stage.

> **Open question Q30:** can a workflow contain a second independent annotation round later in the chain, for example annotate → adjudicate → annotate? Provisional default: no (rule 2). Further rounds are revise stages, or a lead reopens the document. Templates are extended by appending stages, for example a second revise at the end (W1).

**`WorkflowConfigService(db, *, now=…)`** (`config.py`):
- `get_chain(project_key) -> list[StageSpec]`;
- `set_chain(actor, project_key, stages)` validates, replaces the rows and audits `workflow.chain_update` with `{before, after}`;
- `apply_template(actor, project_key, name, *, k=None)` is `set_chain(template(name, k=k))`.

A chain change affects only documents whose workflow has not started. Started documents keep their `document_stages` (Task 3).

**API (`workflow_routes.py`):**
- `GET /api/v1/workflow/templates` returns `[{name, stages: [StageSpecOut]}]`.
- `GET /api/v1/projects/{key}/workflow` returns `{stages: [StageSpecOut], started_documents: int}`. It needs `VIEW_PROJECT`.
- `PUT /api/v1/projects/{key}/workflow` with `{stages}` or `{template, k}` needs `MANAGE_WORKFLOW`. A rule violation is 422 `CHAIN_INVALID`.

**Tests:** `tests/test_workflow_chain.py`.
- `test_templates_are_valid_chains`: each template passes `validate_chain`; `parallel` with `k=3` has an annotate stage with k=3.
- `test_chain_rules` is parametrised over one broken chain per rule. It asserts the `rule` code:
  - empty → `length`;
  - revise first → `annotate_first`;
  - revise with k=2 → `single_person`;
  - annotate(k=1) → adjudicate → `adjudicate_input`;
  - annotate(k=2) → revise → `revise_input`;
  - a single annotate(k=2) → `parallel_needs_adjudication`.
- `test_an_extra_revise_round_is_valid`: sequential plus a revise stage passes.
- `test_default_policies`: stage 1 gets `shown` and later stages get `toggle`. An explicit policy is kept.
- `tests/test_workflow_api.py`:
  - `test_a_lead_applies_a_template_and_it_is_audited`;
  - `test_an_annotator_cannot_change_the_chain`: 403;
  - `test_an_invalid_chain_is_refused_with_its_rule`: 422 with `details.rule`.

**Acceptance:** the tests pass. Regenerate the contract. Commit: `feat(workflow): stage chains with templates and validation`.

---

### Task 3: Per-document stages and the state machine

**Create** `src/ontocurator/workflow/machine.py` (pure) and `src/ontocurator/workflow/service.py`.

**Machine interface:** this is the contract.

```python
@dataclass(frozen=True)
class StageState:
    id: int
    position: int
    stage_type: StageType
    k: int
    status: Literal["pending", "active", "complete", "skipped"]
    has_result: bool            # a stage_results row exists for this stage

@dataclass(frozen=True)
class AssignmentState:
    id: int
    document_stage_id: int
    status: Literal["open", "in_progress", "submitted", "reopened"]

Event = (Started | Released | Skipped | Inserted | ReopenedTo
         | DeclaredFinal | ParticipantAdded)          # frozen dataclasses, see the table
Transition = (Activate | Complete | MarkSkipped | ResetToPending
              | RevokeStageAssignments | ReopenStageAssignments
              | SetFinal | ClearFinal | SetK | StageCompleted)

def advance(stages: Sequence[StageState],
            assignments: Sequence[AssignmentState],   # active ones only
            event: Event) -> list[Transition]: ...
```

`advance` never reads the database. `WorkflowService` loads the states under `SELECT … FOR UPDATE` of the document's `document_stages` rows, calls `advance`, applies the transitions in order and audits the event. One transaction covers the whole operation.

**Transition table** (the contract; "next" means the next stage by position whose status is `pending`):

| Event | Precondition (else `DomainError`) | Transitions |
|---|---|---|
| `Started()` | no stage is active or complete (`WORKFLOW_STARTED`) | `Activate(first)` |
| `Released(assignment_id)` | the assignment's stage is active (`STAGE_NOT_ACTIVE`) | if the stage now has `k` submitted assignments: `Complete(stage)`, `StageCompleted(stage, k)`, then `Activate(next)`, or, without a next stage, `SetFinal(stage)` |
| `Skipped(stage_id)` | the stage is pending or active (`STAGE_NOT_SKIPPABLE`) | `RevokeStageAssignments(stage)`, `MarkSkipped(stage)`; if it was active: `Activate(next)`, or `SetFinal(last complete stage)` without a next stage |
| `Inserted(after_position, spec)` | the chain with the new stage still satisfies rules 3–6 (`CHAIN_INVALID`); the new position comes after every complete stage (`INSERT_BEFORE_COMPLETED`) | the service inserts the row (shifting positions under the deferred unique constraint); if the stage before it is complete and no stage is active, `ClearFinal`, `Activate(new)` |
| `ReopenedTo(stage_id)` | the stage is complete (`STAGE_NOT_COMPLETE`) | `ClearFinal`; for each later stage: `RevokeStageAssignments`, `ResetToPending`; `ReopenStageAssignments(stage)`; `Activate(stage)` |
| `DeclaredFinal(stage_id)` | the stage is complete and has a result (`STAGE_HAS_NO_RESULT`) | `SetFinal(stage)`; every later non-complete stage: `RevokeStageAssignments`, `MarkSkipped` |
| `ParticipantAdded(stage_id)` | an active annotate stage (`STAGE_NOT_ACTIVE`, `NOT_AN_ANNOTATE_STAGE`) | `SetK(stage, k + 1)` |

Notes on the transitions:
- `SetFinal(stage)` sets `final_result_id` on that stage to its latest `stage_results` row. `ClearFinal` clears it on every stage of the document.
- `ReopenStageAssignments` uses T3a's reopen semantics: submitted becomes `reopened`, and the earlier submissions stay.
- `StageCompleted` carries the stage's k. T4b subscribes to it to compute agreement when k ≥ 2; T4a only records it in the audit details.
- An annotate stage with k ≥ 2 has no `stage_results` row of its own. Its adjudicate stage consumes the individual submissions (T4b).

**`WorkflowService(db, *, now=…)`:**
- `start(actor, project_key, document_ids) -> StartReport`:
  - copies the current chain into `document_stages` (`origin 'chain'`) and applies `Started`;
  - documents that are already started are listed in `already_started` and left alone;
  - translation variants are checked with T5's V6 gate function and listed in `refused` with `VARIANT_NOT_ACCEPTED`;
  - audits `stage.start` once with the document ids.
- `stages(project_key, document_id) -> list[DocumentStage]`.
- `on_release(conn, assignment, stage_result_id | None)` is called by the submit path (Task 5) inside its transaction.
- `reconcile(actor, project_key) -> int`: for every active stage whose active assignments are all submitted but which is not complete, it materialises the missing results (Task 6) and applies `Released`. It returns the number of advanced stages. It is idempotent and exists for converted T3 data (Task 4) and for repairs.

**API:**
- `POST /api/v1/projects/{key}/workflow/start` with `{document_ids}` (`MANAGE_WORKFLOW`) returns the `StartReport`.
- `GET /api/v1/projects/{key}/documents/{doc}/stages` (`VIEW_ALL_DOCUMENTS`).

**CLI:** `admin workflow start PROJECT [--all | DOC…]` and `admin workflow reconcile PROJECT`.

**Tests:**
- `tests/test_workflow_machine.py` is table-driven: one case per row of the transition table, plus:
  - `test_a_parallel_stage_completes_only_with_k_submissions`: 1 of 2 submitted gives no transition; 2 of 2 give `Complete`, `StageCompleted(k=2)` and `Activate(adjudicate)`;
  - `test_the_last_stage_sets_the_final_result`;
  - `test_skipping_the_last_active_stage_finalises_the_previous_result`;
  - `test_a_reopened_assignment_does_not_count_as_submitted`;
  - `test_every_precondition_raises_its_code` (parametrised over the codes in the table).
- `tests/test_workflow_service.py`:
  - `test_start_copies_the_chain_and_activates_stage_one`;
  - `test_a_chain_change_does_not_touch_started_documents`;
  - `test_an_unaccepted_translation_is_refused_at_start`;
  - `test_start_is_audited_once`;
  - `test_reconcile_advances_a_stage_whose_assignments_are_all_submitted` (twice: the second run returns 0).

**Acceptance:** the tests pass. Commit: `feat(workflow): per-document stages and the stage state machine`.

---

### Task 4: Stage assignments

**Modify** `application/assignments.py` (T3a's `AssignmentService`), `application/distribution.py` and `api/assignment_routes.py`.

**`AssignmentService.assign`** gains `document_stage_id: int | None = None` and `confirm_language: bool = False`. Stage rules:
- `task` must equal the stage's `stage_type` (`TASK_STAGE_MISMATCH`). `annotate`, `revise` and `adjudicate` assignments need a stage (`STAGE_REQUIRED`). `translation_review` never has one.
- The stage must be pending or active (`STAGE_CLOSED`). Pre-assigning a pending stage is allowed; that task appears in "My tasks" only once the stage is active.
- At most `k` active assignments per stage (`STAGE_FULL`).
- **Roles:** `annotate` needs annotator; `revise` needs annotator or adjudicator; `adjudicate` needs adjudicator (`ASSIGNEE_ROLE_MISSING`).

  > **Open question Q29:** which project role may do a revise stage? Provisional default: annotator or adjudicator.

- **Language (W1):** the assignee's `user_languages` must contain the document language. Otherwise `LANGUAGE_NOT_READ` with `{language}`, unless `confirm_language=True`. A confirmed override is audited as `assignment.language_override`.
- **`adjudicator_not_annotator`** (project option, T3a): an adjudicate assignee must not hold an annotate assignment on the same document, and an annotate assignee must not hold an adjudicate assignment there (`ADJUDICATOR_IS_ANNOTATOR`). Revoked assignments that have a submission count too.
- The same person cannot hold two active assignments of one stage. The unique index enforces this, and the service maps the violation to `ALREADY_ASSIGNED`.

**Conversion of T3 assignments** (migration `0007` data step, SQL):
- `assignments.task = 'review'` becomes `'annotate'`.
- For every document with active `annotate` assignments, insert one `document_stages` row: `annotate`, `k` = the number of active assignments, `shown`, `status 'active'`, `origin 'chain'`.
- If `k ≥ 2`, append a pending `adjudicate` stage with `origin 'inserted'`, so the per-document chain stays valid.
- Set `assignments.document_stage_id` and `drafts.document_stage_id` for the drafts of those assignees on that document.
- Completed T3 work is advanced afterwards with `admin workflow reconcile` (Task 3). No production data exists (E6); the conversion keeps developer data usable.

**Distribution per stage:**
- `POST /api/v1/projects/{key}/workflow/distribution-proposal` with `{stage_position, document_ids, per_document, seed}`.
- It calls T3a's `propose_distribution` with:
  - the candidates whose roles allow the stage task;
  - the language requirement of the document;
  - the exclusion of the document's annotate assignees for adjudicate stages when `adjudicator_not_annotator` is on;
  - `per_document` capped at the free places (`k` minus active assignments).
- Confirming uses the existing batch endpoint with `document_stage_id`.

**Tests:** `tests/test_stage_assignments.py`.
- `test_a_stage_task_must_match_its_stage`.
- `test_an_annotate_stage_takes_at_most_k_people`.
- `test_roles_per_stage_task` (3 cases).
- `test_a_missing_language_needs_confirmation_and_is_audited`.
- `test_an_annotator_cannot_adjudicate_the_same_document_when_the_option_is_on` (both directions; allowed with the option off).
- `test_a_pending_stage_can_be_preassigned_but_is_not_a_current_task`.
- `test_the_stage_distribution_respects_roles_languages_and_free_places`.
- `tests/test_workflow_migration.py::test_t3_assignments_become_stage_assignments`: seed at `0006` with one `review` and two `annotate` assignments on two documents. After upgrading, there are no `review` tasks; the document with two annotators has an annotate stage with k=2 and a pending adjudicate stage; the drafts carry their stage id.

**Acceptance:** the tests pass. Commit: `feat(workflow): stage assignments with roles, languages and the adjudicator rule`.

---

### Task 5: Stage drafts, inputs and the checklist

**Create** `src/ontocurator/workflow/inputs.py`. **Modify** `application/workspaces.py`, `application/reviews.py`, `application/submissions.py`, `api/routes.py` and `storage/repository.py` (with its scoped override).

**Opening by assignment (D-q):** `WorkspaceService.open_assignment(access, assignment_id) -> WorkspaceView`.
- The assignment must be active and belong to the caller (404 `ASSIGNMENT_NOT_FOUND` otherwise). Its stage must be active (409 `STAGE_NOT_ACTIVE`).
- The draft is looked up by `(project, document_id, annotator_id = caller pseudonym, document_stage_id)`. This finds converted T3 drafts too.
- Without a draft, the key is derived:
  - `mode = "review"` if the stage has inherited inputs (below), otherwise `"independent"`;
  - `scope_id = build_scope(profile, mode).scope_id`;
  - `target_set_id = f"stage:{document_stage_id}"`, which is constant for the life of the draft.

  `WorkspaceKey.scope_id` must keep the `build_scope` hash because `WorkspaceService.open` validates it. The stage id therefore lives in `target_set_id`.
- The draft is created with the inputs as `targets`, `document_stage_id`, the initial visibility (Task 7) and `proposal_sets_known` (Task 8).
- Translation review assignments are refused here (`WRONG_TASK`); they keep the T5 route.

**`WorkspaceView`** gains:
- `assignment_id`, `task` and `stage {position, type, label, k, proposal_policy}`;
- `inputs_visible: bool`;
- `checklist: Checklist`.

**Inputs (`inputs.py`):**
- `StageInputs(kind: Literal["none", "proposals", "previous_result"], targets: list[AnnotationRef], source_set_ids: list[str])`.
- `inputs_for(conn, stage, document_id) -> StageInputs`:
  - **annotate:** all annotations of the document's proposal sets (`origin` import or reanchor) if the policy is not `hidden`, otherwise `none`. This is O5: the assisted first round.
  - **revise:** the annotations of the previous non-skipped stage's latest `stage_results` row.
  - **adjudicate:** `none` in this plan; T4b fills it.
- **Never inputs:** the drafts or submissions of other assignees of the same stage (W4 peers, U2), and the results of any later stage (Q25).

> **Open question Q25:** may an annotator see the adjudicated or final result of a document they annotated? Provisional default: not before a release contains it. `visible_annotation_versions` adds no stage result for a user whose only link to the document is an earlier stage.

**Target lookup:** `ReviewService` resolves targets through `repo.get_annotation_snapshot(project, id, version)` for any ref in `draft.targets`, instead of the proposal list. Stage-result snapshots then work as targets.

**Implicit decisions (W2):** these make free editing of inherited annotations equivalent to deciding them.
- New command `revise_target {target}` in `application/editing.py`. In one mutation it:
  - creates a draft copy of the target with `provenance = {actor: caller, kind human, method "edited", source_refs: lineage(target)}` (Task 6);
  - records decision `changed` with that copy as `replacement`.

  It refuses targets that already have a decision (`TARGET_DECIDED`). Span edges, term, axes and mentions are then edited on the copy with the existing commands (W3).
- Deleting an inherited annotation is the existing decision `rejected`.
- Deleting the copy clears the decision. This is the existing `_discard_abandoned_adoptions` path; a test pins it.
- Key 1 is `confirmed`, key 2 `rejected`, key 3 `revise_target` and key 4 `uncertain`. The keyboard mapping lives in Task 13.

**Checklist:** `checklist(draft, inputs_visible) -> Checklist{total, confirmed, changed, rejected, uncertain, untouched: list[AnnotationRef]}`.
- **"Inputs were visible"** means the stage is not an annotate stage, or its policy is `shown`, or `draft.foreign_seen` is true.
- **Release** (the existing submit, called "Release" in stage tasks) refuses with 409 `CHECKLIST_INCOMPLETE` and `{untouched, uncertain}` if inputs were visible and any target is not `confirmed`, `changed` or `rejected`.
- If the inputs were never visible (a `toggle` stage worked blind), the targets are ignored and do not enter the result.

> **Open question Q23:** does "uncertain" count as decided? Provisional default: no. Release needs confirm, change or delete for every inherited annotation, and an uncertain item should get a comment (T4b).

**Submit path:** for a draft with `document_stage_id`, the submit in `SubmissionService` runs `materialise` (Task 6), inserts `stage_results` where applicable, updates the assignment status (T3a) and calls `WorkflowService.on_release`, all in one transaction.

**API:**
- `POST /api/v1/assignments/{id}/workspace` returns the `WorkspaceView`. The existing command, decision and submit endpoints keep working with the returned workspace id.
- `GET /api/v1/workspaces/{id}/checklist` returns the `Checklist`.

**Tests:** `tests/test_stage_drafts.py`.
- `test_an_annotate_stage_with_proposals_opens_as_assisted_review` (O5): mode `review`, the targets are the proposals, and `inputs_visible` is true with policy `shown`.
- `test_a_hidden_policy_opens_without_inputs`: mode `independent` and no targets.
- `test_a_revise_stage_inherits_the_previous_result`: the targets equal the previous `stage_results.annotations`.
- `test_peers_never_see_each_other`: in an annotate stage with k=2, the second annotator's view, checklist and `visible_annotation_versions` contain none of the first annotator's snapshots, before and after the first one releases.
- `test_a_later_stage_result_is_invisible_to_the_annotator` (Q25).
- `test_opening_needs_an_active_own_assignment_on_an_active_stage` (3 cases: someone else's, revoked, pending stage).
- `test_revise_target_creates_an_edited_copy_with_lineage`: the decision is `changed` and the copy has `method edited` with `source_refs[0]` equal to the target ref.
- `test_deleting_the_copy_clears_the_decision`.
- `test_release_needs_every_inherited_annotation_decided`: 409 `CHECKLIST_INCOMPLETE` lists the untouched and uncertain refs; after deciding them, the release succeeds.
- `test_a_blind_toggle_stage_releases_without_the_checklist`: policy `toggle`, never shown; the release succeeds and the result has no adopted annotations.
- `test_a_converted_t3_draft_is_found_by_its_stage`.

**Acceptance:** the tests pass, and so does the full `uv run pytest -q`. Regenerate the contract. Commit: `feat(workflow): stage drafts open by assignment with inherited inputs and the release checklist`.

---

### Task 6: Materialised stage results and lineage (O3, D-t)

**Create** `src/ontocurator/workflow/results.py`. **Modify** `storage/repository.py` (`insert_stage_result`, `latest_stage_result`, `final_result`) and its scoped override.

**Lineage rule:** this is the contract.

```python
def lineage(parent_ref: str, parent: AnnotationSnapshot,
            is_imported: Callable[[str], bool]) -> list[str]:
    """Direct parent first, then the parent's imported origins (O3).

    An imported origin is a ref that names an annotation of a proposal set
    with origin 'import'. The ids of imported proposals are their own
    urn:ontospan refs (T2d patch), so a proposal's parent_ref is its id.
    """
    inherited = [r for r in parent.annotation.provenance.source_refs if is_imported(r)]
    return list(dict.fromkeys([parent_ref, *inherited]))
```

`parent_ref` is computed as follows:
- for an imported proposal: its `annotation_id`;
- for an annotation of a stage result or submission: `ontospan.annotation_ref(set_id, annotation_id)`, with the set ids from the index.

`is_imported` is backed by one query over `proposal_annotations` joined to `proposal_sets` with origin `import`, cached per call.

**`materialise(submission, targets, snapshots, *, actor_pseudonym, set_id, is_imported) -> list[AnnotationSnapshot]`:**
- **`confirmed` target:** a new snapshot with the target's content, `provenance = {actor: releasing user, method "adopted", source_refs: lineage(target)}`. The new `annotation_id` is `uuid5(NAMESPACE_ONTOCURATOR, f"{set_id}|{parent_ref}")`, so it is deterministic.
- **`changed` target:** the replacement as it is. It already carries `edited` and the lineage from `revise_target`. A replacement whose `source_refs` lack the lineage is a bug and raises `LINEAGE_MISSING`.
- **New annotations of the user:** kept as they are, with `method "manual"` and no `source_refs`.
- **`rejected` targets, `uncertain` targets and targets of a draft whose inputs were never visible:** left out.
- Evidence snapshots are copied with the same rule. Every new snapshot is inserted idempotently through the content-addressed snapshot tables.

**Stage results:**
- **annotate with k = 1, and revise:** `stage_results(set_kind 'stage_result', set_id "{project}:stage-result:{id}", annotations, source_submission_ids [submission_id], actors [pseudonym], blind = not draft.foreign_seen)`.

  The set id contains the row id, and the table is append-only, so the row cannot be updated afterwards. Take the id from the identity sequence first (`SELECT nextval(pg_get_serial_sequence('ontocurator.stage_results', 'id'))`, with the column declared `GENERATED BY DEFAULT AS IDENTITY`), then insert with the final `set_id`.
- **annotate with k ≥ 2:** no row. `individual_result(submission)` returns the materialised list on demand with `set_id "{project}:{pseudonym}:annotate:{submission_id}"`; T4b uses it.
- `final_result(project, document_id) -> StageResult | None` is the row that `final_result_id` points to.

**Tests:** `tests/test_stage_results.py`.
- `test_lineage_keeps_the_direct_parent_and_imported_origins`: a proposal P (imported) → annotate-adopted A → revise-adopted B. B's `source_refs` are `[ref(A), id(P)]`.
- `test_lineage_drops_non_imported_grandparents`: a manual annotation M → revise-adopted B gives `[ref(M)]` only.
- `test_reanchored_proposals_pass_their_origins_on`: a reanchor proposal R with `source_refs=[id(P)]` → adopted A gives `[id(R), id(P)]`.
- `test_confirmed_changed_new_and_rejected_map_to_methods`: `adopted`, `edited`, `manual`; rejected and uncertain are absent.
- `test_materialised_ids_are_deterministic`: materialising twice gives equal ids and versions.
- `test_a_released_sequential_chain_ends_with_a_final_result`: annotate (k=1) → revise. Two `stage_results` rows exist, and `final_result` is the revise one.
- `test_the_stage_result_records_the_blind_flag`.
- `test_stage_results_validate_as_t1`: the final result mapped with `exchange.t1` (`set_kind stage_result`) passes `ontospan.validate` against `tests/fixtures/hp.json`.

**Acceptance:** the tests pass. Commit: `feat(workflow): materialised stage results with lineage to imported origins`.

---

### Task 7: Blind mode (W4)

**Modify** `application/editing.py`, `application/workspaces.py`, `auth/preferences.py`, `domain/workspace.py` and `api/routes.py`.

**Preference:** `Preferences.open_blind: bool = False` and `PreferencesUpdate.open_blind: bool | None`. This is the personal setting *Always open documents blind*.

**Initial visibility** when a stage draft is created:

| Stage | `foreign_visible` at creation |
|---|---|
| annotate, policy `shown` | `not open_blind` |
| annotate, policy `toggle` | false |
| annotate, policy `hidden` | false, and it cannot be switched on |
| revise, adjudicate | `not open_blind` |

For revise and adjudicate stages, `proposal_policy` governs only the late-proposal notice (Task 8). Their inherited input is always switchable (W4: "can still start blind and reveal it afterwards").

**Command:** `set_foreign_visibility {visible: bool}` is an editing command, so it is written to `edit_events` (D6).
- It sets `foreign_visible`, and `foreign_seen |= visible`. `foreign_seen` never goes back to false.
- With policy `hidden` on an annotate stage, `visible=True` gives 403 `FOREIGN_HIDDEN`.
- Creating a draft with `foreign_visible = true` also sets `foreign_seen = true`.

**What the server returns:** while `foreign_visible` is false, `WorkspaceView` and the review-inputs endpoint return the targets as references only (`annotation_id`, `version`, layer) without terms, axes or segments. Decision endpoints refuse with `FOREIGN_HIDDEN`, and the checklist reports only counts. "Hidden" is therefore enforced on the server, not only in the UI.

**Blind flag (T1 F10):** this is the contract.

```python
blind = not draft.foreign_seen   # nothing foreign was visible at any point of this draft
```

- `Submission` gains `blind: bool | None = None`. It is set at submit for stage drafts.
- A legacy submission (`None`) is exported with the T2d rule (`mode == "independent"`).
- `stage_results.blind` takes the same value (Task 6).

**Tests:** `tests/test_blind_mode.py`.
- `test_initial_visibility_follows_policy_and_preference` (parametrised over the table).
- `test_switching_is_an_edit_event`: two switches give two `edit_events` with the command in `command`.
- `test_hidden_is_enforced_on_the_server`: `set_foreign_visibility(True)` gives 403; the view contains no terms of the proposals; a decision gives `FOREIGN_HIDDEN`.
- `test_a_blind_view_reveals_no_content`: with `toggle`, the targets come back as bare references.
- `test_blind_is_true_only_if_nothing_was_ever_visible`: on, then off, then release gives `blind false`; never on gives `blind true`.
- `test_the_preference_opens_revise_blind`.
- `test_peers_stay_hidden_with_the_switch_on`: the switch never exposes the other annotator's work (W4).

**Acceptance:** the tests pass. Commit: `feat(workflow): blind mode with server-side enforcement and the blind flag`.

---

### Task 8: Late proposal sets (O7)

**Create** `src/ontocurator/workflow/notices.py`. **Modify** `application/editing.py` and `api/routes.py`.

**State:** `drafts.proposal_sets_known` maps a proposal set id to `input`, `adopted` or `dismissed`. When a stage draft is created, every proposal set of the document that exists at that moment is recorded as `input`, whether or not the policy made it an input. Sets that arrive later are therefore exactly the unknown ones. This needs no timestamps.

**Notice:** `notices(conn, draft, stage) -> ProposalNotices{new: [ProposalSetSummary], dismissed: [ProposalSetSummary]}`.
- `ProposalSetSummary = {proposal_set_id, label, actors: [{name, version, model, run_id}], annotation_count, imported_at, origin}`. The label is the first tool actor's `name version`, with the model when present.
- `new` holds the sets of the document that are not in `proposal_sets_known`.
- Both lists are empty when the stage is an annotate stage with policy `hidden` (O7: no notice under `hidden`).

**Commands** (both are editing commands, so they are `edit_events`):
- `adopt_proposal_set {proposal_set_id}`:
  - the set's annotations are appended to `draft.targets` (`ReviewTargetSet.create` over the union) and become open proposals that join the checklist;
  - the set is marked `adopted`;
  - the draft gets `foreign_visible = foreign_seen = true`, because adopting is a deliberate reveal;
  - if the draft was `independent` (no targets), its key keeps the `independent` mode, and the checklist and decision paths read `draft.targets` regardless of mode.
- `dismiss_proposal_set {proposal_set_id}`: the set is marked `dismissed`. It stays adoptable from the dismissed list.
- Unknown or foreign sets give `PROPOSAL_SET_NOT_FOUND`; a set already adopted gives `PROPOSAL_SET_ADOPTED`; under `hidden` both commands give `FOREIGN_HIDDEN`.

Nothing is merged automatically, and no stage is reopened (O7).

**API:** `GET /api/v1/workspaces/{id}/proposal-notices` returns `ProposalNotices`.

**Tests:** `tests/test_late_proposals.py`. They import a second set with the T2d import path after the draft has started.
- `test_a_late_set_shows_a_notice_and_merges_nothing`: the notice lists the set with its tool label; the draft's targets and annotations are unchanged.
- `test_adopting_yields_open_proposals_in_the_checklist`: the set's annotations are targets, `untouched` grows by their number, and release is blocked until they are decided.
- `test_dismissing_keeps_the_set_adoptable`: the set appears under `dismissed`; adopting it later works.
- `test_both_actions_are_edit_events`.
- `test_a_draft_not_yet_started_gets_the_set_as_normal_input` (O5): the set is among the targets and marked `input`, with no notice.
- `test_no_notice_under_a_hidden_policy`.
- `test_a_revise_stage_also_offers_late_sets`: with policy `toggle`, the notice appears.

**Acceptance:** the tests pass. Regenerate the contract. Commit: `feat(workflow): late proposal sets with a notice, adopt and dismiss`.

---

### Task 9: Lead interventions and stage progress

**Modify** `workflow/service.py` and `api/workflow_routes.py`.

**`WorkflowService` interventions.** Each needs `MANAGE_WORKFLOW`, takes `reason: str | None`, runs through `advance` (Task 3) and audits `stage.<action>` with `{document_id, position, stage_type, reason}`. Earlier submissions are never changed (W1).

| Method | Event | Notes |
|---|---|---|
| `reassign(actor, assignment_id, username, *, reason, confirm_started=False)` | – | Delegates to T3a reassignment with the stage rules of Task 4. The new assignee starts from the stage inputs, never from the previous draft. |
| `add_participant(actor, document_stage_id, *, reason)` | `ParticipantAdded` | Raises k by one for that document; the lead then assigns the new place |
| `skip(actor, document_stage_id, *, reason)` | `Skipped` | |
| `insert_stage(actor, project_key, document_id, *, after_position, spec, reason)` | `Inserted` | `origin 'inserted'` |
| `reopen_to(actor, document_stage_id, *, reason)` | `ReopenedTo` | Sends the document back to an earlier stage |
| `declare_final(actor, document_stage_id, *, reason)` | `DeclaredFinal` | |

> **Open question Q26:** can the lead remove a participant who never finishes from a parallel stage? Provisional default: not offered; the lead reassigns the task instead.

The project lead may take any stage role personally through their own memberships (W1); nothing special is needed.

**Progress:** `GET /api/v1/projects/{key}/workflow/progress?status=&language=&stage=` (`VIEW_PROGRESS`) returns a `list[DocumentWorkflow]`, ordered by document position:

```
DocumentWorkflow = {document_id, language, started: bool, final: bool,
                    override: bool,
                    stages: [{id, position, stage_type, label, k, proposal_policy,
                              status, origin,
                              assignees: [{assignment_id, pseudonym,
                                           display_name, status}]}]}
```

`override` is true when the document's stages differ from the project chain in type, k or policy, when a stage was inserted or skipped, or when a result was declared final before the last stage. This is the "per-document override is visible" of W1.

**Routes:**
- `POST /api/v1/document-stages/{id}/skip|reopen|declare-final|add-participant` with `{reason}`.
- `POST /api/v1/projects/{key}/documents/{doc}/stages` with `{after_position, stage_type, k, proposal_policy, label, reason}`.
- `POST /api/v1/assignments/{id}/reassign` (T3a) gains the stage rules.

**Tests:** `tests/test_interventions.py`.
- `test_every_intervention_is_audited_with_its_reason` (parametrised over the six).
- `test_reopen_sends_the_document_back_and_keeps_submissions`: annotate → revise complete → reopen annotate. The revise stage is pending and its assignment revoked; the annotate assignment is `reopened`; the old submissions and `stage_results` are unchanged; `final_result` is None.
- `test_skip_activates_the_next_stage`.
- `test_insert_a_second_revise_round_after_release`: after the sequential chain is final, inserting a revise stage clears the final result and activates the new stage.
- `test_insert_before_a_completed_stage_is_refused`.
- `test_declare_final_skips_the_rest`: declared after annotate in a sequential chain; revise becomes skipped and `final_result` is the annotate result.
- `test_add_participant_raises_k_for_one_document_only`.
- `test_progress_marks_overrides`: one document with an inserted stage shows `override true`; an untouched one shows false.
- `test_an_annotator_cannot_intervene`: 403.

**Acceptance:** the tests pass. Regenerate the contract. Commit: `feat(workflow): lead interventions per document and stage progress`.

---

### Task 10: Export with tasks, server-derived keys and the gate

**Modify** `exchange/t1.py`, `exchange/jobs.py`, `application/workspaces.py`, `api/routes.py` and `tests/auth_harness.py`.

**T1 export (`t1_export`):**
- For submissions of stage drafts, `stage` is the assignment's task (`annotate`, `revise`) and `blind` is `submission.blind` (Task 7).
- The set id is `"{project}:{pseudonym}:{task}:{submission_id}"` (index). Legacy submissions keep the T2d mode-based values.
- "Latest submission per document, annotator and task" replaces "per mode".

**The client no longer chooses a mode (D-q):**
- `POST /api/v1/workspaces/open` keeps its request body for the current UI, which Task 17 replaces. The server resolves the caller's single active assignment on that document whose stage is active, and opens it through `open_assignment`. The `mode`, `annotator_id`, `scope_id` and `target_set_id` from the body are ignored.
- With no assignment the answer is 403 `ASSIGNMENT_REQUIRED`; with several, 409 `ASSIGNMENT_AMBIGUOUS` and the assignment ids.
- `ProjectSummary.allowed_modes` stays until Task 17 removes the mode chooser, and is computed from the caller's active stage tasks (`annotate` → `independent`, `revise` → `review`).
- The policy actions `OPEN_INDEPENDENT`, `OPEN_ASSISTED` and `OPEN_REVIEW` are no longer checked anywhere. Delete them from the policy table and the matrix test. The assignment and role rules of Task 4 replace them.

**Test harness:**
- `auth_harness.open_workspace(client, project, document, annotator, mode)` ensures a membership, starts the workflow for the document if needed and creates a matching assignment. `independent` gives an annotate stage with policy `hidden`; `review` gives an annotate stage with policy `shown` over the seeded proposals. It then calls `POST /api/v1/assignments/{id}/workspace` and returns the same response shape as the old endpoint.
- `AutoLoginClient` does the same transparently for `POST /api/v1/workspaces/open`. Existing API tests therefore keep working without edits; find the stragglers with `uv run pytest -q` and fix them through the helper, not by weakening assertions.
- `tests/browser_server.py`: `/__test_user__` with `projects=` additionally starts the workflow with the default chain for every document and assigns the user, so the current Playwright specs keep passing until Task 17.

**Integration test** (T7 I10, first half): `tests/test_workflow_integration.py::test_import_assisted_round_revise_and_final_result`.
- Import a T1 bundle with one tool set (T2d `t1_import`) and apply the `sequential` template.
- Annotator A confirms one proposal, changes one and deletes one, then releases. Reviser B confirms everything.
- The final result has `adopted` and `edited` annotations whose `source_refs` end with the imported proposal ids (O3), `blind false`, and validates with ontospan. The T1 export lists A's set with `stage "annotate"`.

T4b continues this flow with adjudication; T4b with the release.

**Acceptance:**
- `grep -rnE "OPEN_INDEPENDENT|OPEN_ASSISTED|OPEN_REVIEW" src tests` prints nothing.
- Regenerate the contract and run `npm --prefix frontend run typecheck`. The frontend must still compile; adjust only generated-type imports.
- `scripts/check.sh` passes.
- Commit: `feat(workflow): export stage and blind flag; workspaces open by assignment only`.

---

## Part 2: Workflow UI (Tasks 11–17)

**Goal of Part 2:**
- Annotators, revisers and adjudicators work from a task list. They open a document by its task, never by choosing a mode.
- The editor has the *Show other annotations* switch, honours *Always open documents blind*, lists the inherited annotations still to decide, and shows "new proposals available".
- Project leads configure the chain from templates, start the workflow, distribute each stage and intervene per document.
- The start-of-session mode chooser is gone.

**Architecture of Part 2:**
- **Screens:**
  - the "My tasks" route `#/` from T3b lists stage tasks;
  - the editor screen (`CaseScreen`) is opened through `#/tasks/:assignment` (route from T5) with `POST /assignments/{id}/workspace`;
  - new lead route `#/projects/:key/workflow`.
- **State:** the server owns visibility. The UI only reflects `inputs_visible`, the checklist and the notices that Part 1 returns. A hidden input never reaches the browser, so the UI cannot leak it.
- **New modules** under `frontend/src/workflow/`: `api.ts` (typed calls), `ShowOthersSwitch.tsx`, `ChecklistPanel.tsx`, `ProposalNotice.tsx`, `ChainEditor.tsx`, `StageTimeline.tsx` and `InterventionDialog.tsx`.

**Commit rule in Part 2:** per task, `npm --prefix frontend run typecheck && npm --prefix frontend test`. Backend tasks also run `uv run ruff check --fix src tests && uv run ruff format src tests && uv run mypy src`. Then one conventional commit without AI attribution.

**File names from T3b and T5:** this plan refers to the T3b "My tasks" route component and the T5 task route by their routes (`#/`, `#/tasks/:assignment`). Use the file names those plans created; do not create parallel components.

---

### Task 11: Stage tasks in "My tasks"

**Modify** the `#/` route component (T3b), `frontend/src/api/client.ts` and the API used by "My tasks". **Create** `frontend/src/workflow/api.ts`.

**Backend addition** (small; in this task):
- `GET /api/v1/me/tasks` (T3a) gains, per task, `stage: {position, stage_type, label, status} | null` and `waiting: bool` (a pre-assigned task whose stage is still pending).
- Waiting tasks are listed after the current ones and cannot be opened.
- Test `tests/test_my_tasks.py::test_stage_tasks_show_their_stage_and_waiting_state`.

**`workflow/api.ts`:** typed wrappers over the generated client.
- **Tasks and workspaces:** `openAssignment(id)`, `getChecklist(wsId)`, `setForeignVisibility(wsId, visible, envelope)`, `listProposalNotices(wsId)`, `adoptProposalSet(wsId, setId, envelope)`, `dismissProposalSet(wsId, setId, envelope)`, `reviseTarget(wsId, target, envelope)`.
- **Workflow:** `getWorkflow(key)`, `putWorkflow(key, body)`, `listTemplates()`, `startWorkflow(key, documentIds)`, `getWorkflowProgress(key, filters)`, `proposeStageDistribution(key, body)`.
- **Interventions:** `intervene(stageId, action, reason)`, `insertStage(key, doc, body)`.

The envelopes reuse the existing mutation-id and autosave helper (`editor/autosave.ts`), so the commands are retried idempotently like every other edit.

**Types:** this is the contract between the Part 2 components. Every type is an alias of a generated schema, so a backend change surfaces as a type error in `api:check`. The component props below refer to them.

```ts
type WorkspaceView = components["schemas"]["WorkspaceView"];        // Part 1: + assignment_id, task, stage, inputs_visible, checklist
type Checklist = components["schemas"]["Checklist"];                // {total, confirmed, changed, rejected, uncertain, untouched: AnnotationRef[]}
type ProposalNotices = components["schemas"]["ProposalNotices"];    // {new: ProposalSetSummary[], dismissed: ProposalSetSummary[]}
type ProposalSetSummary = components["schemas"]["ProposalSetSummary"];
type StageSpec = components["schemas"]["StageSpecOut"];             // {stage_type, k, proposal_policy, label}
type ProposalPolicy = StageSpec["proposal_policy"];                 // "hidden" | "toggle" | "shown"
type DocumentWorkflow = components["schemas"]["DocumentWorkflow"];  // Task 9
type TaskItem = components["schemas"]["TaskItem"];                  // T3a, + stage, waiting
type Intervention = "skip" | "reopen" | "declare-final" | "add-participant";
```

**Error codes:** all workflow error codes go through one map, `workflow/messages.ts`: `messageFor(code: string, details?: object) -> string`. It covers:
- `CHAIN_INVALID` per `rule`;
- `STAGE_NOT_ACTIVE`, `ASSIGNMENT_NOT_FOUND`, `ASSIGNMENT_REQUIRED`;
- `CHECKLIST_INCOMPLETE`, `FOREIGN_HIDDEN`;
- `PROPOSAL_SET_NOT_FOUND`, `PROPOSAL_SET_ADOPTED`;
- `STAGE_FULL`, `LANGUAGE_NOT_READ`, `ADJUDICATOR_IS_ANNOTATOR`, `ASSIGNEE_ROLE_MISSING`, `TASK_STAGE_MISMATCH`;
- `STAGE_NOT_SKIPPABLE`, `STAGE_NOT_COMPLETE`, `STAGE_HAS_NO_RESULT`, `INSERT_BEFORE_COMPLETED`, `NOT_AN_ANNOTATE_STAGE`;
- `VARIANT_NOT_ACCEPTED`, `WORKFLOW_STARTED`.

An unknown code falls back to the server message. Test `frontend/tests/workflowMessages.test.ts`: "every listed code has a sentence" (iterating a literal list) and "unknown codes fall back to the server text".

**UI:**
- **Columns per row:**
  - document id, opening the task;
  - language;
  - task label: "Annotate", "Revise", "Translation review", or "Adjudicate" (opened by T4b; until then it opens the Part 1 workspace, which refuses it with `WRONG_TASK`, so the row shows "Available with adjudication" and is disabled);
  - stage "2 of 3" with the stage label;
  - status: "Open", "In progress", "Released", "Reopened" (stage tasks say "Released" where T3 said "Submitted");
  - the action *Open*, or *Continue* when a draft exists.
- **Order:** reopened first (the lead wants changes), then in progress, then open, then released. Within each group, document position. Waiting tasks come last, in a collapsed section *Waiting for an earlier stage*.
- **Grouping and filters:** by project (a heading per project); filter chips by status and by task.
- **Empty state:** "No tasks assigned to you yet." For a lead without own tasks, the text adds a link to the project's documents page.
- **Released rows** stay listed for 30 days after release with *View*, which opens the read-only own version (T5 selector). This is the user's own version (E8), so it is always allowed.

**Tests:**
- `tests/test_my_tasks.py::test_stage_tasks_show_their_stage_and_waiting_state` (backend): a pre-assigned revise task has `waiting true` and its stage `pending`; after the annotate release it is `waiting false` and `active`.
- `tests/test_my_tasks.py::test_revoked_tasks_disappear`: after a reassignment the old assignee's list no longer contains the task.
- `frontend/tests/myTasks.test.tsx` (extended):
  - "lists stage tasks with their stage and status label";
  - "orders reopened, in progress, open, released, then waiting";
  - "shows waiting tasks disabled with 'Starts when the previous stage is released'";
  - "opens a task through #/tasks/:assignment";
  - "says Released instead of Submitted for stage tasks";
  - "shows the empty state with the documents link for a lead".

**Acceptance:** the tests pass; contract regenerated. Commit: `feat(frontend): stage tasks in My tasks`.

---

### Task 12: The editor opened by task; *Show other annotations*; *Always open blind*

**Modify** the `#/tasks/:assignment` route (T5) and `frontend/src/app/CaseScreen.tsx`. **Create** `frontend/src/workflow/ShowOthersSwitch.tsx`. **Modify** the profile route `#/me` (T3b).

**Opening:**
- The task route calls `openAssignment(id)` and passes the `WorkspaceView` to `CaseScreen`. The `mode` passed today is replaced by `view.key.mode`, the internal draft kind, which drives the existing review rendering.
- The header shows the task label and the stage ("Revise, stage 2 of 2") instead of a mode name.
- Error codes are shown as messages:
  - `STAGE_NOT_ACTIVE`: "This task has not started yet or was closed by the project lead.";
  - `ASSIGNMENT_NOT_FOUND`: "This task is no longer assigned to you.";
  - in both cases, with a link back to My tasks.

**`ShowOthersSwitch`:**
- Props: `{visible: boolean, policy: ProposalPolicy, stageType: StageSpec["stage_type"], disabledReason?: string, onChange(visible: boolean): void}`.
- It is a labelled switch, *Show other annotations*, in the editor toolbar (`data-testid="show-others"`, `role="switch"`, `aria-checked`).
- The hint below it says what "other" covers: "Tool proposals and results of earlier stages."
- Under policy `hidden` on an annotate stage the switch is disabled with the explanation "Hidden for this stage by the project lead."

**Switching:**
- The switch calls `setForeignVisibility` through the autosave queue. While the command is in flight, the switch shows a busy state and ignores further clicks.
- On success it reloads the workspace view, because the server sends content only while it is visible. A `FOREIGN_HIDDEN` answer resets the switch and shows the message.
- Switching off clears the selection if an inherited item was selected.

**Display:**
- **While off:** inherited targets render as numbered placeholders in the side panel ("Inherited annotation 3 of 12, hidden") with no term and no span highlight. The text pane shows only the user's own annotations.
- **Foreign styling while on:**
  - tool actors keep the existing AI badge;
  - earlier-stage results get a new "inherited" badge (`data-testid="inherited-badge"`) with the tooltip "From *Annotate*, released by ann-0003";
  - own annotations have no badge.
- **Pseudonyms only:** the inherited annotation's author is shown by pseudonym, never by display name. Display names of other members appear only on the lead's pages (T3b).

**Preference:** the profile page gains the checkbox *Always open documents blind* (`open_blind`, stored through `PUT /preferences`). The explanatory line reads: "Other people's annotations and tool proposals start hidden. You can show them at any time; the switch is recorded."

**Tests:**
- `frontend/tests/showOthers.test.tsx`:
  - "starts on for a shown policy and off for toggle";
  - "is disabled with an explanation under a hidden policy";
  - "switching calls the command and reloads the view";
  - "hidden inherited annotations show placeholders without terms".
- `frontend/tests/profile.test.tsx`: "saves 'Always open documents blind'".
- `frontend/tests/caseScreen.test.tsx` (adjusted): the header shows the task and stage instead of a mode label.

**Acceptance:** the tests pass. Commit: `feat(frontend): open documents by task with the show-others switch and blind preference`.

---

### Task 13: Checklist panel and Release

**Create** `frontend/src/workflow/ChecklistPanel.tsx`. **Modify** `CaseScreen.tsx` (keyboard handler and the submit dialog) and `editor/ReviewActions.tsx`.

**`ChecklistPanel`:**
- Props: `{checklist: Checklist, targets: TargetProposal[], selected, onSelect(ref), visible: boolean}`.
- A side-panel section, *Still to decide*, lists the untouched inherited annotations in text order, with counts "12 inherited · 7 confirmed · 2 changed · 1 deleted · 2 open".
- Uncertain items are listed separately as *Marked uncertain* with the hint "Decide or comment before release." (Q23).
- Clicking an item selects it in the text. The panel is refreshed from `getChecklist` after every decision command.

**Keyboard (W2):**

| Key | Action | Command |
|---|---|---|
| `j` / `k` | next / previous undecided item (untouched first, then uncertain) | – |
| `1` | confirm the selected inherited annotation | decision `confirmed` |
| `2` | delete it | decision `rejected` |
| `3` | change it: create the editable copy and select it | `revise_target` |
| `4` | mark it uncertain | decision `uncertain` |

- A second press of `1`, `2` or `4` clears the decision, as today. `3` on an already changed item selects the existing copy.
- The handler in `CaseScreen.tsx` stays the one that exists today. It is gated on "the view has targets" instead of `view.key.mode === "review"`, so late-adopted sets in an `independent` draft (Task 8) work as well.
- Update `SHORTCUTS`: "j / k Next / previous undecided inherited annotation", "1 Confirm inherited annotation", "2 Delete inherited annotation", "3 Change (editable copy)", "4 Mark uncertain".

**Free editing (W2, W3):**
- Selecting an inherited annotation and changing its term, axes or span edge (drag-resize or keyboard edge move) first calls `reviseTarget` and then applies the edit to the copy, so "change" needs no extra click.
- Deleting an inherited annotation from the annotation panel records `rejected`.
- The existing adopt-and-edit path is replaced by `reviseTarget`.

**Release:**
- In stage tasks the submit button reads *Release* (`data-testid="release"`).
- It is disabled while `untouched` or `uncertain` is not empty and the inputs were visible. The reason is shown next to it: "3 inherited annotations are still undecided."
- A 409 `CHECKLIST_INCOMPLETE` from the server (for example after a concurrent change) re-renders the panel with the server's lists and keeps the dialog open.
- The confirmation dialog says what happens next: "Your result goes to the next stage (Revise). You cannot change it afterwards unless the project lead reopens it."

**Tests:**
- `frontend/tests/checklistPanel.test.tsx`:
  - "lists untouched and uncertain items with counts";
  - "j and k move through undecided items only";
  - "1 to 4 send confirm, reject, revise_target and uncertain";
  - "editing an inherited term first calls reviseTarget";
  - "dragging a span edge of an inherited annotation edits a copy";
  - "Release is disabled with the reason until everything is decided";
  - "a 409 CHECKLIST_INCOMPLETE refreshes the lists".
- `frontend/tests/reviewActions.test.tsx` (adjusted): adopt-and-edit now calls `reviseTarget`.

**Acceptance:** the tests pass. Commit: `feat(frontend): checklist panel with keyboard decisions and release gating`.

---

### Task 14: "New proposals available"

**Create** `frontend/src/workflow/ProposalNotice.tsx`. **Modify** `CaseScreen.tsx` and the detail pane (`editor/AnnotationPanel.tsx` or the detail component that T3b's proposal provenance uses).

**`ProposalNotice`:**
- Props: `{notices: ProposalNotices, busy: boolean, onAdopt(setId: number): void, onDismiss(setId: number): void}`.
- The label of a set is `ProposalSetSummary.label`. Its tooltip lists every tool actor with name, version, model and run id (the T3b provenance format), and the origin "re-anchored from version N" for `reanchor` sets (T5).
- **Banner:** above the text, for each `new` set: "New proposals available: *gpt-x 2026-09 (run 42)*, 37 annotations." with the buttons *Adopt as proposals* and *Ignore* (`data-testid="proposal-notice"`).
- **Adopt:** calls `adoptProposalSet`, reloads the workspace, and shows the adopted annotations as open items in the checklist (Task 13). A visible inline message says "37 proposals added to your checklist."
- **Ignore:** calls `dismissProposalSet` and removes the banner.
- **Detail pane:** a section *Proposal sets not adopted* lists the dismissed sets with tool name, version, model, run id and import time, each with *Adopt*.
- Notices are loaded when the editor opens and after each autosave round trip at most every 60 s. No polling while the tab is hidden.
- The server returns no notices under a `hidden` policy, so the component renders nothing then.

**Tests:** `frontend/tests/proposalNotice.test.tsx`.
- "shows the tool label and count of a new set".
- "adopting calls the command and the items appear in the checklist".
- "ignoring hides the banner and lists the set in the detail pane".
- "a dismissed set can be adopted later".
- "renders nothing without notices".

**Acceptance:** the tests pass. Commit: `feat(frontend): notice for late proposal sets with adopt and ignore`.

---

### Task 15: Chain editor (`#/projects/:key/workflow`)

**Create** `frontend/src/workflow/ChainEditor.tsx` and the route component `frontend/src/workflow/WorkflowPage.tsx`. **Modify** `frontend/src/app/router.ts` (route) and the project navigation (T3b).

**`WorkflowPage`** is visible to users with `MANAGE_WORKFLOW` (the project summary's `rights`, as T3b uses them). It has three sections: *Chain*, *Start*, and *Documents* (Task 16).

**`ChainEditor`:**
- **Template buttons:** *Single annotation*, *Sequential (annotate → revise)*, *Parallel + adjudication*. The last one has a number field "people in parallel" (2–10).
- **Stage list:** each stage has its type (select), k for annotate, the tool-proposal policy (select: *Hidden*, *Off, can be shown*, *Shown*) and a label. Revise stages can be added at the end, and the last stage can be removed.
- **Policy defaults:** shown as the Part 1 defaults (stage 1 *Shown*, later *Off, can be shown*), with the help line "First rounds are assisted: imported proposals are shown and every one is confirmed, changed or deleted." (U4).
- **Editing rules in the form:**
  - stage 1 is always *Annotate*, and its type select is disabled;
  - choosing k ≥ 2 for stage 1 when stage 2 is not *Adjudicate* inserts an *Adjudicate* stage after it, and says so;
  - removing the *Adjudicate* stage sets k back to 1;
  - revise and adjudicate stages have no k field.

  These are conveniences. The server's `validate_chain` stays the authority, and the form never sends a chain without the server checking it.
- **Unsaved changes:** leaving the page with an edited chain asks "Discard the changes to the workflow?".
- **Save:** calls `putWorkflow`. A 422 `CHAIN_INVALID` is shown next to the offending stage with `messageFor`. For example, `adjudicate_input` reads "Adjudication needs a parallel annotation stage with at least two people directly before it."
- **Read-only view** for members without `MANAGE_WORKFLOW` is not offered; the route answers "You cannot change this project's workflow." and links back.
- **Notice:** "Changes apply to documents whose workflow has not started. N documents are already running and keep their stages."

**Start section:** a multi-select of documents that have not started (filter by language), and *Start workflow*. The report lists the refused documents, for example an unaccepted translation: "Translation not accepted yet".

**Tests:** `frontend/tests/chainEditor.test.tsx`.
- "applying the parallel template with 3 people saves annotate(k=3) → adjudicate".
- "setting k=2 on stage 1 adds an adjudicate stage; removing it resets k to 1".
- "leaving with unsaved changes asks for confirmation".
- "policies default to shown for stage 1 and off-can-be-shown later".
- "a CHAIN_INVALID response is shown at the stage with a readable sentence".
- "start lists refused documents with their reason".
- "the page is not offered without the workflow right".

**Acceptance:** the tests pass. Commit: `feat(frontend): chain editor with templates and workflow start`.

---

### Task 16: Per-document stages and interventions

**Create** `frontend/src/workflow/StageTimeline.tsx` and `frontend/src/workflow/InterventionDialog.tsx`. **Modify** `WorkflowPage.tsx` and the progress route `#/projects/:key/progress` (T3b).

**Documents section of `WorkflowPage`:**
- A table from `getWorkflowProgress`, filterable by status (not started, running, final), language and current stage.
- The table is paged by 100 rows on the client. T2e's budget of 1 000 documents per project applies, and the progress endpoint returns all rows in one call.
- Each row has a selection checkbox for the distribution below, the document id (linking to the read-only document view of T5), the language and a `StageTimeline`.

**`StageTimeline`:**
- Props: `{stages: DocumentWorkflow["stages"], override: boolean, final: boolean, onAction(stage, action): void}`.
- One chip per stage, in position order, shows the label, the type icon, k for annotate stages and the status:
  - pending: grey outline;
  - active: filled;
  - complete: check mark;
  - skipped: struck through;
  - inserted stages get a small "added" tag.
- Under each chip: the assignees as pseudonym plus display name with their task status. Empty places of an annotate stage show "1 place free".
- A **final** marker sits on the stage that holds the final result.
- An **override** marker (`data-testid="override-marker"`, text "Changed for this document") appears when `override` is true.
- Each chip has a menu with the actions valid for its state (below).

**Distribution per stage:**
- Select documents and a stage position, then *Propose distribution*. This uses the T3b proposal table component with `proposeStageDistribution`.
- Confirmed rows go through the existing assignment batch call with `document_stage_id`.
- A 422 `LANGUAGE_NOT_READ` for a manual assignment opens a confirmation: "*ann-0004* has not listed *fr* among their languages. Assign anyway? This is recorded." Confirming resends with `confirm_language: true`.

**`InterventionDialog`:**
- Props: `{action: "reassign" | "add_participant" | "skip" | "insert" | "reopen" | "declare_final", stage, document, onDone}`.
- Each action has a one-sentence explanation of its effect:
  - **reopen:** "Sends the document back to *Annotate*. Later stages are reset and their tasks withdrawn. Released work stays recorded.";
  - **declare final:** "The result of *Revise* becomes the document's final result. Remaining stages are skipped.";
  - **skip:** "The stage is skipped; the next stage starts with the last released result.";
  - **add participant:** "Adds one more place to this parallel stage for this document. Assign the new place afterwards.";
  - **insert:** a type, k and policy form, placed after a chosen position;
  - **reassign:** a member picker; for a started task, the confirmation "The current draft stays with its author; the new person starts from the stage input."
- Each action has an optional *Reason* field (up to 500 characters), stored in the audit entry.
- A server error is shown with `messageFor` (Task 11) and keeps the dialog open.
- After success the dialog closes and the row is reloaded from `getWorkflowProgress` for that document.

**Actions offered per chip state** (mirrors the Task 3 transition table, so the UI never offers an action the server would refuse for its state):

| Chip state | Actions |
|---|---|
| pending | skip, insert after, reassign (pre-assigned tasks) |
| active, annotate | reassign, add participant, skip, insert after |
| active, revise or adjudicate | reassign, skip, insert after |
| complete with result | reopen, declare final, insert after |
| complete without result (annotate k ≥ 2) | reopen, insert after |
| skipped | – |

**Progress page (T3b):** the per-document row gains the current stage and the override marker.

**Tests:**
- `frontend/tests/stageTimeline.test.tsx`:
  - "renders chips with status and assignees";
  - "shows the override marker";
  - "offers only the actions valid for the stage state".
- `frontend/tests/interventionDialog.test.tsx`:
  - "reopen sends the reason and refreshes the row";
  - "reassign of a started task asks for confirmation";
  - "insert sends type, k, policy and position".
- `frontend/tests/stageDistribution.test.tsx`: "a missing language asks for confirmation and resends with confirm_language".

**Acceptance:** the tests pass. Commit: `feat(frontend): per-document stages, stage distribution and lead interventions`.

---

### Task 17: The mode chooser goes; browser flows; gate

T3b Task 2 already replaced the dashboard and its mode select with "My tasks". This task removes what is left.

**Remove:**
- any remains of the mode select: `modeLabels`, `modeExplanations`, `mode_by_package` handling, the legacy mode migration (`LEGACY_MODE_PREFIX`), `isMode` and the mode values in the client types;
- `ProjectSummary.allowed_modes` from the API (Task 10 kept it);
- the body-based `POST /api/v1/workspaces/open`, together with its compatibility branch in `application/workspaces.py`;
- the document list's `mode` query parameter.

Tests that still use the old endpoint switch to `auth_harness.open_workspace` (Task 10); `AutoLoginClient`'s transparent mapping is removed. Find them with `grep -rn "workspaces/open" tests`; after this task the command prints only `auth_harness.py`.

**Frontend tests:**
- `frontend/tests/projectModes.test.tsx` (from T2c) is deleted. Its intent moves to `myTasks.test.tsx`: "a member without tasks sees 'No tasks assigned to you yet.'".
- In `review-findings.test.tsx` and `workflow-regressions.test.tsx`, replace mode-selection steps with opening a task through the mocked `openAssignment`.
- Check with `grep -rnE "allowed_modes|modeLabels|mode_by_package|Working mode" frontend/src frontend/tests`, which must print nothing.

**Browser test server (`tests/browser_server.py`):** add the test route `POST /__test_workflow__`, so specs seed workflows without UI clicks. `/__test_user__` keeps Task 10's default-chain behaviour.
- Query: `project`, `template` (`single`, `sequential` or `parallel`), `k`, `policy` (overrides stage 1), and `assign=<pseudonym>:<task>[,…]`.
- It applies the template, starts the workflow for every document of the project and assigns each listed user to the stage of their task. Users who do not exist yet are created as by `/__test_user__`, with the roles their task needs and the document languages in their profile.
- It returns `{assignments: {pseudonym: [assignment_id, …]}}`, so a spec can open `#/tasks/<id>` directly.
- Like the other test routes, it is mounted only by `browser_server.py`, never by `create_app`.

`frontend/browser/helpers.ts` gains:
- `seedWorkflow(page, opts) -> assignments`;
- `openTask(page, assignmentId)`;
- `decide(page, key)`, which presses `1`–`4` with the checklist focused and waits for the autosave indicator.

**Playwright specs** (`frontend/browser/`):
- `workflow-sequential.spec.ts`, "sequential: assisted annotate, release, revise with checklist, final":
  - seed `sequential` with an imported tool proposal;
  - annotator: the proposal is shown, `1` confirms it, *Release*;
  - reviser: the task appears; the checklist lists one item; the release is disabled; `3` and a term change; release;
  - lead: the workflow page shows both stages complete and no override marker.
- `workflow-parallel.spec.ts`, "parallel: peers stay hidden; the stage completes for adjudication":
  - seed `parallel` with k=2 and `toggle`;
  - annotator A annotates and releases; annotator B opens the same document and sees none of A's annotations even with the switch on;
  - B releases; the lead sees the annotate stage complete and the adjudicate stage active (adjudication itself follows in T4b).
- `blind-mode.spec.ts`:
  - "toggle policy starts hidden; showing is possible";
  - "the open-blind preference starts a shown stage hidden".
- `late-proposals.spec.ts`, "a set imported after the start shows a notice; adopt adds checklist items" (import through the existing `/__test_import__` route).
- Existing specs (`workflow.spec.ts`, `spans.spec.ts`, …) keep passing through Task 10's default-chain seeding. Delete any step that chose a working mode.

**Embedded assets:** `npm --prefix frontend run build`, then replace `src/ontocurator/web/` with `frontend/dist/`.

**Acceptance:**
- `npm --prefix frontend run test:e2e -- browser/workflow-sequential.spec.ts browser/workflow-parallel.spec.ts browser/blind-mode.spec.ts browser/late-proposals.spec.ts` passes.
- `uv run python scripts/export_openapi.py --check` and `npm --prefix frontend run api:check` pass.
- `scripts/check.sh` passes.
- Commit: `feat(frontend): tasks replace the mode chooser; workflow browser flows`.

---

## Spec coverage

| Spec item | Task |
|---|---|
| W1: ordered chain of annotate, revise and adjudicate stages; templates sequential and parallel, extendable | 1, 2 |
| W1: a stage starts per document when the previous one is released | 3, 5 |
| W1: language-aware distribution per stage; manual assignment without the language needs confirmation and is audited | 4 |
| W1: ad-hoc lead decisions (reassign, add participant, skip, insert, reopen, declare final), audited with a reason; overrides visible in progress | 9 |
| W2: reviser starts from the previous result, free editing, checklist with confirm/change/delete before release, attributed `adopted`/`edited` with `source_refs`, every step in D6 | 5, 6, 7 |
| W3: span boundaries editable in revise (edited copy with `source_refs`) | 5 |
| W4: show-others switch, open-blind preference, peers hidden until stage completion (server), per-stage tool-proposal policy, show/hide in the edit log, `blind` only if nothing foreign was ever visible | 5, 7 |
| W4 / W2: start-of-session mode choice and the separate review mode replaced (server side; UI in Part 2) | 5, 10 |
| E9: adjudicator-not-annotator option | 4 |
| T7 O3: release lineage prepared (direct parents plus imported origins) | 6 |
| T7 O5: the first stage takes imported proposals as working input with the checklist (U4) | 2, 5 |
| T7 O7: late sets show a notice; adopt or dismiss; both edit events; no automatic merge, no reopening; nothing under `hidden` | 8 |
| T7 I10: import → assisted round → final result (API level) | 10 |
| W5 adjudication, W6 agreement | T4b |
| W7 releases, W8 comments | T4b |
| UI for all of the above | 11–17 |
| W1: templates and chain configuration by the lead; stage distribution with the language confirmation; ad-hoc decisions per document; overrides visible in progress | 15, 16 |
| W2: reviser starts from the previous result; side panel of untouched inherited annotations; release needs every one decided; j/k and 1–4 kept | 13 |
| W3: span edges of inherited annotations editable in revise (edited copy) | 13 |
| W4: *Show other annotations* switch; *Always open documents blind* preference; policy `hidden` reflected; peers hidden (Playwright) | 12, 17 |
| W4 / W2: start-of-session mode choice and the separate review mode removed | 17 |
| T7 O5 / U4: assisted first round in the UI (proposals shown, checklist) | 13, 15, 17 |
| T7 O7 / U5: "new proposals available" with adopt or ignore; dismissed sets stay available in the detail pane | 14 |
| Adjudication view (W5), agreement (W6) | T4b |
| Releases (W7), comments (W8), unread-comment counts in the task list | T4b |
