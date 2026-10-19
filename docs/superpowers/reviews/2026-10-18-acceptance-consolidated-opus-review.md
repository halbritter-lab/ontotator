<!-- Independent CLI review: Claude Code 2.1.296; requested opus / high; actual model claude-opus-5-5. Completed successfully on 2026-10-18; 65 turns, 483857 ms. Static read-only review; no tests run. -->
<!-- Frozen plan SHA256: 9A6AF0EB21408E9C77199EE30B9C290AD81F96C2157675C1A4BF25BC22B93075; protocol SHA256: 2F5A3107813C5869348F8AF445BC5C9EC859BA80D18117903E96046C81F73D58. Reviewer recommendations below are not automatically adopted decisions. -->
# Independent review: consolidated acceptance-remediation plan (uncommitted, base `ba0b91b`)

I read both documents in full. I checked the plan's claims against `domain/workspace.py`, `application/workspaces.py`, `application/submissions.py`, `application/editing.py`, `storage/repository.py`, `storage/tables.py`, `authz/scoped.py`, `authz/versions.py`, `assignments/service.py`, `assignments/eligibility.py`, `exchange/t1.py`, `exchange/jobs.py`, `exchange/reanchor_job.py`, `exchange/uploads.py`, `domain/variants.py`, `domain/results.py`, `domain/project_rules.py`, the preferences modules, `api/routes.py`, `api/job_routes.py`, `api/document_projection.py` and `api/variant_routes.py`. I did not read the other reviewer's output.

**Overall:** the product decisions in the plan match the protocol's later confirmations. Tasks 1–6, 9 and 13 are well founded. The contract checkpoint before Tasks 10–12 is a real, acknowledged gate, not an omission. But the checkpoint has no concrete acceptance criteria, and several invariants in the current code would be broken silently if it stays generic.

## What I confirmed (no action needed)

- **File references:** all 16 backend test files, all 34 frontend test files, `sidebar.spec.ts`/`reanchor.spec.ts`, `seed_t5_acceptance.py` and `check.sh` exist. The only listed source file that doesn't exist is `axisLabels.ts` (L3).
- **Task 1 inventory claim** (plan :120) holds for the current code:
  - `recreate_reanchor` writes `f"{source_ref.annotation_id}:{source_ref.version}"` pointing at a v1 proposal (`editing.py:535-537`).
  - `t1_export_content` builds `proposals` from `AnnotationSnapshotRow ⋈ ProposalAnnotationRow` across all documents (`repository.py:1115-1163`).
  - The fallback copies raw refs (`t1.py:621-631`).
  - The inventory-first rule is still correct and should stay.
- **Task 5 claim** that editing deletes resolution rows that are no longer valid is accurate (`editing.py:388-397`).
- **Task 9 claim** that an absent list means all loaded languages is accurate (`application/preferences.py:74-76`).
- **Repeated-correction gap** is accurate (`eligibility.py:98-107`).
- **Reanchor excludes submissions** (`reanchor_job.py:458`). Review inputs exclude other members' work (`workspaces.py:161-182`).
- **Correctly acknowledged gates** (not omissions):
  - immutable defaults in strict mode (gate 1)
  - round/migration/consolidated T1 semantics (gate 2)
  - first-use search default (gate 3)
  - warning scope and empty export (gate 4)
  - symbol assets (gate 5)

## Findings, ranked by severity

### High

**H1. Round identity: the checkpoint needs named enforcement points, or a restart can bring back abandoned work** (plan :86, :93, :75, :239)

How the current code would break a restart:
- **Authorization ignores rounds.** `require_workable` finds the workspace's assignment only by `(project, document, user, TASK_FOR_MODE[mode])`. Any `target_set_id` is workable while the assignment is active. The only mutation guard is `status == "submitted"` (`authz/scoped.py:128-145`).
- **The client chooses the key.** `open_workspace` builds the key from client fields (`review_round_target_set_id or "targets-0"`) and encodes it into `workspace_id` (`api/routes.py:411-428`). So an old round's key stays openable and mutable.
- **`target_set_id` can't carry a round in independent mode.** Independent keys alias `"targets-0"` and the empty-target hash together (`repository.py:154-160`), and imports normalize to `targets-0` (`:139-151`).
- **Draft revision decides "latest".** `latest_submissions` picks the highest `draft_revision` per origin (`domain/results.py:16-36`). `submit` continues `previous[0].origin_key` (`submissions.py:262-270`). If a restart reuses an origin, the abandoned work's higher revision wins, or the revisions collide (`CONFLICTING_SUBMISSION_REVISION`).
- **Export ignores rounds.** `t1_export_content` groups by `(document_id, annotator_id, mode)` only (`repository.py:1142-1156`). The legacy export would therefore fall back to abandoned work, or hide one of two rounds.

**Remedy:** make these acceptance criteria of the checkpoint (:93):
1. Add a round component to `WorkspaceKey`/`DraftRow`. Leave the encoding unchanged when the component is empty, so `_key_str` (`repository.py:98-115`) keeps every existing `draft_key`/`local_key` and its injectivity.
2. Make `require_workable` reject superseded rounds for mutation, and serve them read-only.
3. Resolve the current round on the server in `open`; never trust the client key.
4. Give each round its own origin and revision sequence.
5. Decide how the legacy export groups rounds.
6. Cover `list_workspace_keys`, `document_projection`/`_document_statuses`, `MutationReceipt.workspace_key`, and old payloads, given `extra="forbid"` on `WorkspaceKey` and `Submission`.

**H2. Only one active assignment per person, document and task, which conflicts with several rounds per person** (plan :86, :227, :239)

`uq_assignments_active (project_id, document_id, user_id, task)` and `CHECK task IN ('annotate','review','translation_review')` (`tables.py:752-766`) mean one assignment, and one status, per person, document and task. A reviewer who already has an ordinary review on document X and is then given a consolidation round on X would share that assignment. Submitting either one sets `submitted` and makes both read-only. `active_for` uses `one_or_none` (`service.py:229-242`). The same applies to restart versus the old round.

**Remedy:** decide the relationship before Task 10:
- either a new task value with its own assignment (migration of the CHECK constraint, `TASK_FOR_MODE`, `may_take`, `conflicting_tasks`),
- or rounds own their status and the assignment becomes a container.

Add a test: an ordinary review and a consolidation on the same document by the same reviewer, where submitting one leaves the other editable.

**H3. Tasks 10 and 12 invalidate Task 1's "no wider snapshot read model needed"** (plan :120 versus :228 and :253)

- Carry-forward and consolidation will write internal `annotation_id:version` refs to **human submission snapshots**. Those are not in the `proposals` inventory, because submissions are stored only as payload (`repository.py:1767-1791`).
- Under Task 1's rule, a non-hit is preserved if it is a valid URN and fails otherwise. So exports either fail, or, when a client-generated ID is URN-shaped, pass through ambiguous provenance.
- Separately, `t1_export` validates every uncertain decision against `content.proposals` only (`jobs.py:193-229`). Consolidation decisions that target submission snapshots would fail with `TARGET_NOT_FOUND`.

**Remedy:**
- In Task 1, make the inventory an explicit parameter type (an exact snapshot map) rather than "proposals".
- In Tasks 10 and 12, add a required step: extend that inventory with the frozen inputs of each round, define the exported URN for a human-snapshot source (including when that set is not part of a selected-result export), and update the uncertain-decision prevalidation.
- Add a regression test: carry-forward → submit → full T1 validation.

**H4. Carry-forward has no feasible mechanism yet: mode, trigger, source and privacy are all undecided** (plan :226-228)

- Pending reanchor items and resolutions exist only in review mode, tied to `ProposalSetRow.origin == "reanchor"`. `_freeze_reanchor_inputs` rejects non-review modes (`repository.py:1911-1969`), and so does submit (`submissions.py:238`). Independent mode has no inputs at all (`workspaces.py:233-235`).
- Every reader of proposal sets is project-wide with no owner filter: `list_annotations_for_document` (`repository.py:1489-1521`), `get_review_inputs`, `t1_export_content`, `reanchor_sources`, `proposal_rows`/`visible_annotation_versions` (`versions.py:63-186`). Storing Anna's carry-forward as a proposal set would show it to Ben's review and to assisted reference layers.
- The plan correctly forbids "public proposal sets" (:228), but leaves open:
  - **mode:** a seeded independent draft or private review targets
  - **trigger and authority:** who creates the round; whether opening a task creates it implicitly
  - **source:** which of the person's submissions is used (latest in the current round, never an abandoned one)
  - **multi-hop:** v1→v3 when the person never annotated v2
  - **how "requires review" is enforced** (per-item decisions or only whole-text check)

**Remedy:** add these five decisions to the checkpoint. If private storage reuses proposal tables, require an owner filter in all six readers above. Add one negative test per reader.

**H5. Project presets must be applied on the server, or exports will mark unconfirmed values as "chosen"** (plan :66, :200-203)

- `_create_annotation` sets `axes_defaulted=[]` for every non-adoption creation and stores the client's `axes_values` as given (`editing.py:771-789`). T1 then exports them as `basis: chosen` (`t1.py:482-486`).
- So the obvious frontend implementation (prefilling `initialAxisValues`) would export unconfirmed presets as clinical choices. The user explicitly forbade that.
- Also, `require_chosen_axes` blocks empty axes too, not only defaulted ones (`project_rules.py:133-144`). "Reuse where consistent" (:200) therefore also forces a value on axes that have no preset.

**Remedy:** in Task 8:
- An omitted axis gets the project default on the server, and is added to `axes_defaulted`.
- An explicit value from the client counts as chosen only through a deliberate choice path.
- Add a backend test that a preset annotation exports `basis: defaulted`.
- State explicitly what strict mode does with axes that have no preset.

### Medium

**M1. Task 7 is not frontend-only** (plan :186-188)

- Leads have no API that lists submissions per document. `VersionRef` returns only the caller's own submissions and proposals (`versions.py:129-186`; `stage_result`/`release` are declared but never produced). Assignments expose only `last_submission_id` (`assignment_routes.py:52`).
- The required "separate submission histories" and Task 12's selection both need an authorized read model.
- `may_read_proposals` also admits users assigned to review (`versions.py:35-53`). Reusing that rule would break blindness.

**Remedy:** add a backend endpoint to Task 7, or move submission-level tree nodes into Task 12. Restrict it to lead or export rights, with a test that a reviewer gets nothing.

**M2. Hold has no defined state or server enforcement** (plan :87, :238-240)

- Assignment statuses are fixed by a CHECK constraint (`tables.py:755-757`). The only mutation guard is the submitted check (`scoped.py:143`).
- Undefined:
  - whether hold blocks commands and submit
  - how hold relates to open/in_progress/submitted/reopened, including resume after a hold placed on a submitted task
  - who executes restart (annotator request plus lead approval, or lead only)
  - what an "empty" restart means for **review** tasks (whether proposals and pending reanchor inputs are excluded)
- **Privacy:** when a hold is extended to Ben, showing Anna's report text could reveal her annotations.

**Remedy:**
- Write a transition table.
- Enforce hold in `require_workable(mutation=True)` and in submit.
- Show extended-hold recipients a reason written by the lead, never the original report.
- Add tests for each of these.

**M3. Review-obligation producers are missing, and corrected translations keep showing the stale source** (plan :44, :229)

- Original corrections arrive through `exchange/uploads.py:340-358` (upload commit and T1 import, also from the CLI). Task 10 lists `translation_reviews.py`, but not `uploads.py` or `variant_plan.py`.
- `resolve_translation_lineage` pins every correction chain to the *old* original (`variants.py:49-87`). A translation corrected because the original changed would still show and export (`derived_from`, `t1.py:728-736`) the old source.

**Remedy:**
- Derive causes from the immutable variant inventory as a projection, and persist only resolutions. That needs no producer hooks and is atomic by construction.
- Record "reviewed against source X" on the resolution.
- Make the translation-review UI show the new original for obligation-driven corrections.
- Decide what T1 exports in that case.

**M4. Relaxing repeated-correction eligibility needs a scope** (plan :229)

`check_variant_assignable` is also used for bulk allocation (`_assign_locked` docstring, `service.py:411-418`).

**Remedy:** allow a translation review on an accepted correction only through an explicit, obligation-linked or confirmed single-assignment path, never through distribution. Add tests for both paths.

**M5. Export freezing is underspecified, and the current handler contradicts it** (plan :91, :251)

- The job payload contains only the project. The handler reads live content when it runs (`jobs.py:178-180`) and raises `EXPORT_EMPTY` (`jobs.py:181-182`). That contradicts disclosed omissions and an export where every result was omitted.
- "Frozen snapshot **or** renewed acknowledgement" (:251) has to be **both**:
  1. The create request carries the acknowledged warning digest.
  2. The server recomputes it in the creation transaction and returns 409 if it differs.
  3. The snapshot is persisted, and the job references only that snapshot.
- The CLI export (`cli.py:989-1020`) has no acknowledgement step. Decide whether it stays legacy-only or needs explicit flags.

**M6. Consolidation input invariants are missing** (plan :227)

- Require all inputs to share the target's exact `document_id`/`text_sha256`, since evidence offsets depend on the text. Different versions must be carried forward first.
- Keep input authors out of the reviewer role (extend `adjudicator_not_annotator`, `service.py:315-326`).
- Targets must be owned by the server. Today `open` accepts targets from the client, checked only against the proposal inventory (`workspaces.py:248-340`).
- Reconcile the name WorkRound with the existing "review round" target-set concept (`AMBIGUOUS_REVIEW_ROUND`, `review_round_target_set_id`) so the API doesn't end up with two kinds of round.

### Low

- **L1. Global-constraint wording (:20).** "final-selection replacement" and "cross-person copying" literally contradict Task 12's deliberate replacement (:249) and explicit consolidation. Change to "automatic replacement" and "implicit copying".
- **L2. Ownership and sequence (:99, :101).** The CaseScreen owner should also cover Task 11 (entry points) and Task 9. Add the dependencies 2→8 (`ProjectSettingsPage`) and 7→12 (tree selection).
- **L3. `axisLabels.ts` doesn't exist (:138).** Mark it as new, at `frontend/src/editor/axisLabels.ts`.
- **L4. Acknowledgement record (:203).** `MutationEnvelope.expected_revision` already ties acknowledgement to the draft. Add a policy version to the submit command, and decide whether acknowledgement is persisted (audit entry, or a submission field, which would change format v2 because of `extra="forbid"`).
- **L5. Diff invariant (:167).** `ReanchorPanel.tsx:16` says "never run another diff algorithm". Task 5 changes that on purpose, so update the comment and any guarding test explicitly.
- **L6. Export error display (:122).** `JobView.error` is a plain string holding a Python repr (`job_routes.py:43`, `jobs.py:96-105`). The summary must not parse that repr; show a generic summary plus the raw text, or add structured errors.

## Readiness

**Existing focused fixes (Tasks 1–9, 13): close to ready.**
- **Task 1:** ready now. Only change: make the inventory an explicit, extensible parameter (H3).
- **Tasks 2–6, 9, 13:** ready, subject to L2/L3/L5/L6. Task 9 still depends on the acknowledged gate 3.
- **Task 7:** ready for the case → language → version tree. Submission-history nodes need M1's backend read model first.
- **Task 8:** not ready until H5 (server-side presets and strict-mode semantics) and gate 1 are written down.

**New workflow packages (Tasks 10–12): not ready for production code.**
- The checkpoint must first absorb H1–H4 and M2–M6 as explicit acceptance criteria: round binding in key, authorization, origin and export; assignment cardinality; extending the snapshot inventory; carry-forward mode, trigger, source and privacy; the hold state machine; obligation derivation; scoped eligibility; the export freeze protocol; consolidation invariants.
- Red tests for the isolation and non-resurrection invariants can be written before that.

Assumptions: I relied on static reading only, with no tests run. I did not verify frontend-internal claims in depth (`adopt(user, null)`, the mutation queue, `firstAxisVal`). I did not inspect the ontospan package for permitted `set_kind` values, so the consolidated-set representation stays under gate 2.
