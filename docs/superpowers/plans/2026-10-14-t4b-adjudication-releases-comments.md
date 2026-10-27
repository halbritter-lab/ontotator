# T4b: Adjudication, Agreement, Releases and Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Lean format: files, interfaces, tables, test cases and acceptance criteria per task. Implementers write the code test-first; code appears only where it defines a contract.

**Goal of Part 1:**
- The adjudicator of a document sees the released results of a parallel annotate stage grouped by the one T1 matcher.
- Groups where everyone agrees are confirmed with one action. Every other group is decided one by one: take one annotator's version, edit it (term, axes, span boundaries), or reject it.
- The released result is an `adjudicated` set whose annotations name every contributing annotation and their imported origins (O3).
- Project leads see live agreement per document, annotator pair, language and project. Annotators never see it.

**Architecture of Part 1:**
- **Grouping (pure):** `workflow/grouping.py` turns the k released task results of an annotate stage into groups. It runs `ontospan.match_annotations` for every annotator pair, joins the matched pairs with union-find and classifies each group (index D-x). Groups are computed on request and never stored; a group id is the canonical hash of its member references.
- **Adjudication draft:** a new internal draft kind `adjudicate` (index D-q). The draft keeps its normal annotations plus one decision per group in `drafts.adjudication_decisions`. New editing commands go through `run_mutation`, so every step is an edit event (D6).
- **Materialisation:** at release, T4a's materialiser writes a `stage_results` row with `set_kind = "adjudicated"`. This plan adds the rule for `method` and `source_refs` of adjudicated annotations.
- **Agreement:** when the T4a state machine reports that an annotate stage with k ≥ 2 has completed, the same transaction enqueues an `agreement` job. The job writes pairwise rows to `agreement_results` and one summary row per document stage to `agreement_documents`.
- **UI:** an adjudication screen behind `#/tasks/:assignment` for `adjudicate` tasks, and an agreement page `#/projects/:key/agreement` for leads.

**Spec:** `docs/superpowers/specs/2026-10-14-t4-workflows-merge-design.md` (W3, W5, W6; W1 for the adjudicator rule). T7: `…-t7-integrations-design.md` (O3). T1 F11 (`ontospan.matching`). Index: `docs/superpowers/plans/2026-10-14-t3-t5-t4-index.md` (D-q, D-t, D-x, U2). Builds on T4a.

**Branch / worktree:** `feat/t4b-adjudication-releases` from `feat/t4a-workflows`, worktree `.worktrees/t4b-adjudication-releases`. Set up with `uv sync`, `npm --prefix frontend ci`, `npx --prefix frontend playwright install chromium`. Baseline: `scripts/check.sh`.

**Commit rule:** per task, `uv run ruff check --fix src tests && uv run ruff format src tests && uv run mypy src`, then one conventional commit without AI attribution.

**T4a interfaces used here** (from `2026-10-14-t4a-workflows.md`):
- `materialise(submission, targets, snapshots, *, actor_pseudonym, set_id, is_imported)` and the lineage rule (direct parent plus imported origins, D-t). This plan adds a branch for `adjudicate` drafts (Task 2).
- `individual_result(submission)`: the materialised annotations of an annotate task release with k ≥ 2, with `set_id "{project}:{pseudonym}:annotate:{submission_id}"`. No `stage_results` row exists for such a stage.
- `advance(...)` (`workflow/machine.py`) and the place where `WorkflowService` applies its transitions; `final_result(project, document_id)`.

This plan adds one helper on top: `WorkflowService.released_task_results(document_stage_id) -> list[TaskResult]`, with `TaskResult = (assignment_id, user_id, pseudonym, submission_id, set_id, snapshots, evidence)`. It returns `individual_result` for every submitted, non-revoked assignment of the stage, ordered by `assignment_id`. Create it in Task 1 (`workflow/service.py`) with the test `test_released_task_results_follow_assignment_order`.

---

## Part 1: Adjudication and live agreement (Tasks 1–6)

### Task 1: k-way grouping (pure)

**Create:** `src/ontotator/workflow/grouping.py`, `tests/test_grouping.py`. **Modify:** `src/ontotator/exchange/t1.py`.

**Refactor in `exchange/t1.py`:** extract `annotation_from_snapshot(snapshot, evidence: Mapping[ref, EvidenceSnapshot], document, *, annotation_id: str) -> ontospan.Annotation` from `submission_to_unit`. Axes follow Q13, segments quote the canonical text. `submission_to_unit` calls it; its tests stay green.

**Interface:**

```python
GroupKind = Literal["agreed_equal", "agreed_compatible", "axis_conflict",
                    "term_conflict", "modifier_conflict", "partial"]

@dataclass(frozen=True)
class Member:
    ref: str              # ontospan.annotation_ref(task_result.set_id, annotation_id)
    annotator: int        # index of the task result, 0..k-1, ordered by assignment_id
    snapshot_id: str
    snapshot_version: str
    annotation: ontospan.Annotation

@dataclass(frozen=True)
class Group:
    group_id: str
    layer_id: str
    kind: GroupKind
    members: tuple[Member, ...]       # sorted by (annotator, text position, ref)
    contributors: frozenset[int]      # annotator indexes present
    ancestor: bool                    # some pair is a term conflict with an ancestor relation
    preselected: str | None           # member ref proposed for agreed groups
    start: int | None                 # first code point, None for document-level groups

def group_results(results: Sequence[TaskResult], document: Document, profile: TaskProfile,
                  ontology: ontospan.OntologyView | None) -> list[Group]
```

**The grouping rule** is the contract:
1. Convert every annotation of every task result with `annotation_from_snapshot`. Annotator indexes follow the order of `assignment_id`.
2. For every pair of annotators `i < j`, call `ontospan.match_annotations(A_i, A_j, text, ontology)`. Every returned `MatchGroup` where both `a` and `b` are set (`equal`, `compatible`, `axis_conflict`, `term_conflict`) adds an edge between the two members. `a_only` and `b_only` add no edge.
3. Union-find over all members gives the groups. A member without an edge is a group of its own.
4. Classify each group, in this order of precedence:
   - `partial` if not every annotator contributes, or one annotator contributes more than one member;
   - `term_conflict` if any edge is a term conflict (`ancestor` is true if any such edge has `ancestor`);
   - `axis_conflict` if any edge is an axis conflict;
   - `modifier_conflict` if any edge has `modifiers_differ`;
   - `agreed_equal` if every edge is `equal` and all members are pairwise connected;
   - otherwise `agreed_compatible`.
5. For `agreed_compatible` groups, `preselected` is the member with the most covered code points after F11 normalisation (`ontospan.normalize_segment`), then the earliest start, then the lowest annotator index. For `agreed_equal` groups it is the member of annotator 0.
6. `group_id = canonical_hash(sorted(member.ref for member in members))`.
7. Groups are ordered by `(start is None, start, layer_id, group_id)`, so document-level groups come last.

Edge whitespace and punctuation never create a conflict, because the matcher compares normalised mentions (T1 F11). Modifiers cannot be represented in Ontotator (Resolved Q11), so `modifier_conflict` does not occur in practice. It is kept so the rule matches the matcher.

**Tests (`tests/test_grouping.py`):** a 3-sentence German text, an HPO profile, three task results built in the test.
- `test_identical_annotations_form_one_agreed_equal_group`: k = 2, same term, axes and span gives one group, `agreed_equal`, `contributors == {0, 1}`.
- `test_edge_punctuation_is_not_a_conflict`: "Hypotonie." against "Hypotonie" gives `agreed_equal`.
- `test_longer_span_is_preselected_in_compatible_groups`: "muskuläre Hypotonie" against "Hypotonie" gives `agreed_compatible` with the longer member preselected.
- `test_axis_and_term_conflicts_are_classified` (2 cases); the term case with parent and child terms of `tests/fixtures/hp.json` has `ancestor == True`.
- `test_only_some_annotators_is_partial`: k = 3, two annotators annotate a span; the group is `partial` with `contributors == {0, 2}`.
- `test_chained_overlaps_join_one_group`: A overlaps B and B overlaps C, but A does not overlap C; one group with three members.
- `test_two_members_of_one_annotator_make_a_partial_group`.
- `test_unmatched_annotations_are_singleton_groups`.
- `test_group_ids_are_stable_and_order_independent`: shuffling the input order gives the same ids and order.
- `test_groups_follow_the_text`: starts ascend; document-level groups come last.
- `test_layers_never_mix`: equal spans in two layers give two groups.

**Steps:**
- [ ] Write the tests above. Run `uv run pytest tests/test_grouping.py -q`; they fail (missing module, command or assertion).
- [ ] Extract `annotation_from_snapshot` first and keep `tests/test_t1_mapping.py` green before adding grouping.
- [ ] Implement union-find, classification and ordering exactly as the rule above; no database access in `grouping.py`.
- [ ] Run `uv run pytest tests/test_grouping.py -q` until it passes, then `uv run pytest -q` for regressions.
- [ ] Apply the commit rule and commit.

**Acceptance:** `uv run pytest tests/test_grouping.py tests/test_t1_mapping.py -q` passes. Commit: `feat(adjudication): k-way grouping of parallel results with the shared matcher`.

---

### Task 2: The adjudication draft and the adjudicated result (O3)

**Create:** `src/ontotator/workflow/adjudication.py`, `src/ontotator/storage/migrations/versions/0008_agreement.py` (this task's column plus Task 5's tables, one migration), `tests/test_adjudication.py`. **Modify:** `domain/scopes.py`, `domain/workspace.py`, `application/editing.py`, the T4a materialiser and `storage/tables.py`.

**Draft kind:** `WorkspaceMode` gains `"adjudicate"`. `build_scope` treats it like `review` (reference layers included). The T4a mapping from task to draft kind maps `adjudicate` to it. The draft's targets are the members of all groups, so the edit log records which inputs the adjudicator worked from.

**Column (migration 0008):** `drafts.adjudication_decisions jsonb NOT NULL DEFAULT '{}'`, a map from group id to a decision:

```json
{"<group_id>": {"action": "confirmed" | "taken" | "edited" | "rejected",
                "from_ref": "<member ref>" | null,
                "result": ["<annotation_id>", "<version>"] | null}}
```

The edit-event `state` (T2c Task 1) gains the key `adjudication` with this map, so `draft_state_at` reconstructs it.

**Commands** (in `application/editing.py`; each is a `MutationEnvelope` payload and thus one edit event):

| Command | Payload | Effect |
|---|---|---|
| `confirm_agreed_groups` | – | For every undecided `agreed_*` group, create the result from `preselected` and record `confirmed` |
| `take_version` | `group_id`, `from_ref` | Replace the group's result (if any) with a copy of the member; record `taken` with `from_ref` |
| `take_span` | `group_id`, `from_ref` | Replace the result's mentions with the member's mentions; the decision becomes `edited` |
| `reject_group` | `group_id` | Remove the group's result (if any); record `rejected` |
| `reopen_group` | `group_id` | Remove the decision and the result |

- A result is a new draft annotation authored by the adjudicator: a copy of the chosen member's term, axes and mentions. Its provenance is set at materialisation, not here.
- The existing editing commands (`set_term`, `set_axes`, `edit_mention`, `attach_mention`, `detach_mention`) work on results. When one changes a result, its group decision becomes `edited` with the new version. Drawing new boundaries is `edit_mention` (W3).
- `delete_draft_annotation` on a result is the same as `reject_group`.
- Annotations created with `create_annotation` belong to no group. They are allowed and become `manual`.
- A `group_id` that is not a current group gives `DomainError("GROUP_UNKNOWN")`. A `from_ref` that is not a member gives `GROUP_MEMBER_UNKNOWN`.

**Release rule** (contract): submitting the draft requires that every current group has a decision. Otherwise `DomainError("ADJUDICATION_UNDECIDED", {"groups": [ids in text order]})`, mapped to 409. The groups are recomputed from the stage's immutable inputs at submit time, so a decision for an id that no longer exists cannot satisfy the rule.

**Materialisation of the adjudicated set** (contract, extends D-t):

```python
def adjudicated_method(decision, group) -> Literal["adopted", "merged", "edited"]:
    if decision.action == "edited":
        return "edited"
    if decision.action == "confirmed" and len(group.contributors) >= 2:
        return "merged"
    return "adopted"  # taken, or confirmed with a single contributor


source_refs = [m.ref for m in group.members] + imported_origins(group.members)
```

- `source_refs` name **every** member of the group, not only the chosen one (W5), followed by the members' imported origins (`lineage_refs`, O3), without duplicates and in that order.
- Rejected groups produce nothing. Manual annotations have `method = "manual"` and no `source_refs`.
- The `stage_results` row has `set_kind = "adjudicated"`, `set_id = "{project}:adjudicated:{stage_result_id}"` and `actors = [adjudicator pseudonym]`. `blind` is false.

**Adjudicator rule:** with the project option `adjudicator_not_annotator` (T3a), opening an adjudication draft whose user has an assignment in the document's annotate stage gives `AccessDenied("ADJUDICATOR_IS_ANNOTATOR")`. T3a and T4a already refuse such an assignment; this check covers assignments made before the option was switched on.

**Tests (`tests/test_adjudication.py`):** two annotators release on a two-stage parallel workflow (helper `parallel_stage_released(app, texts, annotations_a, annotations_b)` in `tests/workflow_harness.py`, created or extended from T4a).
- `test_confirm_agreed_groups_decides_only_agreed_groups`: after the command, agreed groups have `confirmed` and conflict groups stay undecided.
- `test_release_is_refused_while_a_group_is_undecided`: 409 `ADJUDICATION_UNDECIDED` lists the ids in text order.
- `test_take_version_copies_the_member`: term, axes and mentions equal the member's.
- `test_take_span_changes_only_the_boundaries` and the decision becomes `edited`.
- `test_editing_a_result_marks_the_group_edited`.
- `test_reject_and_reopen`.
- `test_every_command_is_an_edit_event`: five commands give five events; `draft_state_at` reproduces `adjudication` after each.
- `test_adjudicated_methods`: confirmed agreement gives `merged`, take gives `adopted`, edit gives `edited`, a new annotation gives `manual`.
- `test_adjudicated_annotations_name_every_contributor_and_imported_origin`: annotator A adopted a tool proposal, B annotated the same span manually; the result's `source_refs` are A's ref, B's ref and the proposal's URN (O3).
- `test_the_result_is_an_adjudicated_stage_result`: `set_kind`, `set_id` pattern, actors.
- `test_unknown_group_and_member_are_refused` (2 cases).
- `test_an_annotator_of_the_document_cannot_adjudicate_it` (`ADJUDICATOR_IS_ANNOTATOR`, with the option on).

**Steps:**
- [ ] Write the tests above. Run `uv run pytest tests/test_adjudication.py -q`; they fail (missing module, command or assertion).
- [ ] Write migration 0008 with the `drafts.adjudication_decisions` column (Task 5 adds its tables to the same file), then `uv run pytest tests/test_schema.py -q`.
- [ ] Add the draft kind, the commands and the release rule; extend the materialiser with `adjudicated_method` and the `source_refs` rule.
- [ ] Extend the edit-event `state` with `adjudication` and check `tests/test_edit_log.py`.
- [ ] Run `uv run pytest tests/test_adjudication.py -q` until it passes, then `uv run pytest -q` for regressions.
- [ ] Apply the commit rule and commit.

**Acceptance:** `uv run pytest tests/test_adjudication.py tests/test_schema.py tests/test_edit_log.py -q` passes. Commit: `feat(adjudication): adjudication draft with group decisions and adjudicated results`.

---

### Task 3: Adjudication API

**Modify:** `api/routes.py` (or T4a's workflow router), `api/models.py`. **Create:** `tests/test_adjudication_api.py`.

**Endpoint:** `GET /api/v1/workspaces/{workspace_id}/adjudication` returns `AdjudicationView`. The workspace must be an `adjudicate` draft of the requesting user (`own_key`, T2b); otherwise 404.

```text
AdjudicationView = {
  annotators: [{index, label}],          # label "A", "B", "C" … (Q32)
  groups: [{group_id, layer_id, kind, ancestor, contributors: [index], contributor_count, k,
            preselected_ref, decision: {action, from_ref, result_ref} | null,
            members: [{ref, annotator_index, term_id, term_label, axes, mentions, document_level}]}],
  counts: {groups, decided, undecided, agreed_undecided},
  release_ready: bool
}
```

- The commands use the existing `POST /api/v1/workspaces/{id}/commands`, and release uses `/submit`. No new write endpoint is needed.
- Term labels come from the pinned ontology in the document language when available, as in the editor.

> **Open question Q32:** Should the adjudicator see who made each version (their pseudonyms) or only neutral letters? Provisional default: neutral letters A, B, C per document, in assignment order. The pseudonyms stay in the stored result and are visible to the lead in the progress view. This reduces bias towards particular colleagues.

**Tests:**
- `test_the_view_lists_groups_with_letters_not_pseudonyms`: no pseudonym of an annotator appears in the response body.
- `test_counts_follow_decisions`: after `confirm_agreed_groups`, `agreed_undecided == 0` and `release_ready` reflects the conflict groups.
- `test_only_the_draft_owner_reads_the_view`: another adjudicator and an annotator of the document get 404.
- `test_a_lead_without_assignment_cannot_open_it` (Q15: work needs an assignment).

**Steps:**
- [ ] Write the tests above. Run `uv run pytest tests/test_adjudication_api.py -q`; they fail (missing module, command or assertion).
- [ ] Add the response models and the endpoint; reuse `group_results` and the draft's decisions.
- [ ] Regenerate the contract: `uv run python scripts/export_openapi.py && npm --prefix frontend run api:generate`.
- [ ] Run `uv run pytest tests/test_adjudication_api.py -q` until it passes, then `uv run pytest -q` for regressions.
- [ ] Apply the commit rule and commit.

Regenerate the contract. **Acceptance:** the tests pass; `uv run python scripts/export_openapi.py --check` passes after regeneration. Commit: `feat(adjudication): adjudication view endpoint`.

---

### Task 4: Adjudication screen

**Create:** `frontend/src/adjudication/AdjudicationScreen.tsx`, `frontend/src/adjudication/GroupList.tsx`, `frontend/src/adjudication/adjudicationState.ts`, `frontend/tests/adjudication.test.tsx`, `frontend/browser/adjudication.spec.ts`. **Modify:** the T5 task route component that opens `#/tasks/:assignment` (dispatch on the task `adjudicate`), `frontend/src/api/client.ts`, `frontend/src/spans/adapter.ts`, `styles.css`, `tests/browser_server.py`.

**Behaviour:**
- **Layout:** the text pane on the left, the group list on the right, the existing term search and axes panel for the selected result.
- **Text:** every member mention is drawn in its annotator's colour (`--annotator-0` … `--annotator-5`, colour-blind-safe and distinguishable in light and dark). The selected group's members are outlined. `adapter.ts` gains an optional `colourIndex` per span.
- **Group list:**
  - an "Agreed" section, collapsed, with "Confirm all agreed (n)" (`confirm_agreed_groups`); each agreed group can be expanded and changed;
  - a "To decide" section with the remaining groups in text order, each showing kind, "2 of 3", the ancestor flag, and one row per member with the letter, term, axes and span text;
  - per member: "Take A" (`take_version`) and "Take A's span" (`take_span`, only if spans differ); per group: "Reject" and, once decided, "Undo" (`reopen_group`).
- **Keyboard:** `j` / `k` move between undecided groups; `1`–`6` take the member with that letter; `x` rejects; `Enter` confirms an agreed group. Keys are ignored while an input has focus.
- **Release** is enabled only when `release_ready`; otherwise its tooltip names the count of undecided groups. A 409 `ADJUDICATION_UNDECIDED` selects the first listed group.
- Every action goes through the existing autosave and mutation queue, so revisions and retries behave as in the editor.

**Vitest (`frontend/tests/adjudication.test.tsx`), with a mocked client:**
- "collapses agreed groups and confirms them with one action" (one `confirm_agreed_groups` command).
- "shows each annotator in its own colour" (spans carry `data-annotator` 0 and 1).
- "moves between undecided groups with j and k".
- "takes a version with a number key" (`take_version` with the member ref).
- "keeps Release disabled until every group is decided".
- "selects the first undecided group after a 409".

**Browser:** `tests/browser_server.py` gains the test route `POST /__test_parallel_released__?project=`. It calls T4a's `/__test_workflow__` logic with `template=parallel&k=2` and the users `ann-a:annotate,ann-b:annotate,adj-c:adjudicate`, then writes and releases fixed annotations for `ann-a` and `ann-b` through the services (one agreed group, one term conflict, one partial group). The specs call this seed "scenario `parallel-adjudication`".

`frontend/browser/adjudication.spec.ts`, "parallel flow: adjudicate and release":
- log in as the adjudicator and open the task from "My tasks";
- confirm all agreed groups, take B's version of the term conflict, reject the partial group;
- release; "My tasks" shows the task as submitted;
- log in as the lead; the document's stage view (T4a) shows the adjudicate stage complete and the result final.

**Steps:**
- [ ] Write the tests above. Run `npm --prefix frontend test -- tests/adjudication.test.tsx`; they fail (missing module, command or assertion).
- [ ] Add the client method and types from the generated contract.
- [ ] Build `adjudicationState.ts` (selection, undecided order, key handling) as pure functions first, then the components.
- [ ] Add the browser scenario and the Playwright spec; run `npm --prefix frontend run test:e2e -- browser/adjudication.spec.ts`.
- [ ] Run `npm --prefix frontend test -- tests/adjudication.test.tsx` until it passes, then `uv run pytest -q` for regressions.
- [ ] Apply the commit rule and commit.

**Acceptance:**
- `npm --prefix frontend test -- tests/adjudication.test.tsx` passes.
- `npm --prefix frontend run typecheck` passes.
- `npm --prefix frontend run test:e2e -- browser/adjudication.spec.ts` passes.
- Commit: `feat(frontend): adjudication screen with grouped decisions and annotator colours`.

---

### Task 5: Live agreement (W6)

**Modify:** `0008_agreement.py` (from Task 2), `storage/tables.py`, `authz/policy.py`, `tests/test_policy.py`, the T4a workflow service where `advance` transitions are applied. **Create:** `src/ontotator/workflow/agreement.py`, `src/ontotator/workflow/agreement_jobs.py`, `tests/test_agreement.py`.

| Table | Columns | Keys |
|---|---|---|
| `agreement_results` | `id` bigint identity; `project_id` → projects; `document_id`; `document_stage_id` → document_stages; `annotator_a` text; `annotator_b` text (pseudonyms, `annotator_a < annotator_b`); `metrics` jsonb; `computed_at` default now(); `job_id` → jobs null | PK id; UNIQUE (document_stage_id, annotator_a, annotator_b); ix (project_id) |
| `agreement_documents` | `document_stage_id` → document_stages; `project_id`; `document_id`; `language` text; `k` int; `groups` int; `conflict_groups` int; `mean` jsonb; `computed_at` default now(); `job_id` → jobs null | PK document_stage_id; ix (project_id, conflict_groups) |

Both tables are recomputed, not history: the application role gets `SELECT, INSERT, UPDATE, DELETE`. A recomputation replaces the rows of its document stage in one transaction. The history of what was shown is not needed (W6: a steering aid).

**Trigger:** where T4a applies `advance` transitions, a transition of an `annotate` stage with `k >= 2` to `complete` enqueues `jobs.enqueue("agreement", {"document_stage_id": id}, project_id=…)` in the same transaction. A stage that is reopened and completes again enqueues again. No other path enqueues it, except the CLI `ontotator admin agreement recompute PROJECT` (enqueues one job per completed parallel stage; for operators after a fix).

**Job `agreement`** (`agreement_jobs.py`):
- loads `released_task_results(document_stage_id)`, the document, and the pinned ontology as `ObographOntology` (cached per job run);
- for each pair `i < j`: `ontospan.agreement(A_i, A_j, text, ontology)` (converted with `annotation_from_snapshot`), stored as `dataclasses.asdict(Agreement)` in `metrics`;
- `agreement_documents`: `groups` and `conflict_groups` from `group_results` (every kind except `agreed_*` counts as a conflict); `mean` is the arithmetic mean over pairs of the five F1 values and `modifier_agreement` (null values skipped; W6: mean over pairs for k > 2);
- a stage that is no longer `complete` when the job runs is skipped with the result `{"skipped": "stage_not_complete"}`.

**Metrics** (W6; no kappa): the stored `Agreement` holds pairwise mention F1 strict and tolerant, term-level F1 on `(layer, term_id, axes)`, and modifier agreement, plus the counts for micro-averaging. The aggregations (`workflow/agreement.py`, pure):

```python
def micro(rows: Iterable[Agreement]) -> AgreementSummary:
    # F1 from summed counts, per metric:
    #   mention strict:   tp = Σ mentions_equal,                     n_a = Σ mentions_a, n_b = Σ mentions_b
    #   mention tolerant: tp = Σ (mentions_equal + mentions_compatible)
    #   term:             tp = Σ terms_equal,                        n_a = Σ terms_a,    n_b = Σ terms_b
    # F1 = 2·tp / (n_a + n_b), and 1.0 when n_a + n_b == 0 (as ontospan's _f1)
```

- **Per document:** the `mean` row.
- **Per annotator pair:** `micro` over that pair's rows across documents.
- **Per language and per project:** `micro` over every pair row of the documents in that language, or of the project.

**Policy:** `VIEW_AGREEMENT` (admin, lead). Add the row to the expected matrix.

**API:** `GET /api/v1/projects/{key}/agreement?language=&stage_position=` returns

```text
{project: Summary, languages: [{language, documents, summary}],
 pairs: [{annotator_a, annotator_b, documents, summary}],
 documents: [{document_id, external_id, language, k, groups, conflict_groups, mean, computed_at}]}
```

`documents` is sorted by `conflict_groups` descending, then `document_id`. Pairs show pseudonyms (leads see pseudonyms anyway, T2 Q10). Without `VIEW_AGREEMENT`: 403 `NOT_ALLOWED`.

**Tests (`tests/test_agreement.py`):**
- `test_completing_a_parallel_stage_enqueues_one_agreement_job`; a k = 1 stage enqueues none.
- `test_the_job_stores_every_pair_once`: k = 3 gives 3 rows with `annotator_a < annotator_b`.
- `test_metrics_equal_ontospan_agreement`: the stored values equal a direct `ontospan.agreement` call.
- `test_recomputation_replaces_rows`: run twice; still 3 rows, new `computed_at`.
- `test_a_reopened_stage_is_skipped`.
- `test_micro_averaging_uses_counts`: two hand-made rows give the hand-computed F1.
- `test_documents_with_most_conflicts_come_first`.
- `test_language_filter`.
- `test_annotators_and_adjudicators_never_see_agreement`: both get 403 from the endpoint; the task list and document responses contain no agreement fields (`"agreement"` not in their JSON).
- `tests/test_admin_cli.py::test_agreement_recompute_enqueues_jobs`.

**Steps:**
- [ ] Write the tests above. Run `uv run pytest tests/test_agreement.py -q`; they fail (missing module, command or assertion).
- [ ] Add both tables to migration 0008 and the policy row; run `uv run pytest tests/test_schema.py tests/test_policy.py -q`.
- [ ] Implement `micro` and the aggregations as pure functions, then the job handler and its registration in the job table of `api/app.py` and the CLI.
- [ ] Hook the enqueue into the place where T4a applies `advance` transitions, in the same transaction.
- [ ] Run `uv run pytest tests/test_agreement.py -q` until it passes, then `uv run pytest -q` for regressions.
- [ ] Apply the commit rule and commit.

**Acceptance:** `uv run pytest tests/test_agreement.py tests/test_policy.py tests/test_schema.py tests/test_admin_cli.py -q` passes; regenerate the contract. Commit: `feat(agreement): live pairwise agreement per document stage as a job`.

---

### Task 6: Agreement page for leads

**Create:** `frontend/src/agreement/AgreementPage.tsx`, `frontend/tests/agreement.test.tsx`, `frontend/browser/agreement.spec.ts`. **Modify:** `frontend/src/app/router.ts` (route `#/projects/:key/agreement`), the project navigation (shown only with `VIEW_AGREEMENT`; the project summary of T3a carries the user's allowed actions), `frontend/src/api/client.ts`.

**Page:**
- **Header:** project summary as four figures (mention F1 strict and tolerant, term F1, modifier agreement or "–"), with the number of documents and pairs. A language selector filters everything below.
- **"Documents with the most conflicts":** a table of documents sorted by conflict groups; columns document, language, k, groups, conflict groups, mean term F1, mean tolerant mention F1, computed at. A row opens the document's stage view (T4a).
- **Pairs:** a table per annotator pair with documents and the three F1 values.
- **By language:** one row per language.
- **Empty state:** "No parallel stage has completed yet."
- A short note under the header: "A steering aid while the project runs. Cite agreement from releases." (W6).
- Figures use the existing number formatting with two decimals.

**Vitest:** "lists documents with the most conflicts first", "filters by language", "shows a dash for missing modifier agreement", "shows the empty state", "is not linked for annotators" (navigation without `VIEW_AGREEMENT` has no "Agreement" entry).

**Browser (`agreement.spec.ts`):** "lead sees agreement after a parallel stage": scenario `parallel-adjudication`; the lead opens the agreement page and sees one document row and one pair row. An annotator going to `#/projects/<key>/agreement` sees "You do not have access to this page."

**Steps:**
- [ ] Write the tests above. Run `npm --prefix frontend test -- tests/agreement.test.tsx`; they fail (missing module, command or assertion).
- [ ] Add the route, the navigation entry guarded by the allowed actions, and the page.
- [ ] Run `npm --prefix frontend run test:e2e -- browser/agreement.spec.ts`.
- [ ] Run `npm --prefix frontend test -- tests/agreement.test.tsx` until it passes, then `uv run pytest -q` for regressions.
- [ ] Apply the commit rule and commit.

**Final gate:**
- Rebuild the embedded assets.
- `scripts/check.sh` passes.
- Commit: `feat(frontend): agreement page for project leads`.

---

## Error codes of Part 1 (contract)

New codes and their HTTP status. The existing handler maps `DomainError` subclasses; add the codes to its table.

| Code | Status | Raised by | Details |
|---|---|---|---|
| `GROUP_UNKNOWN` | 422 | adjudication commands | `{group_id}` |
| `GROUP_MEMBER_UNKNOWN` | 422 | `take_version`, `take_span` | `{group_id, from_ref}` |
| `ADJUDICATION_UNDECIDED` | 409 | submit of an `adjudicate` draft | `{groups: [ids in text order]}` |
| `ADJUDICATOR_IS_ANNOTATOR` | 403 | opening an adjudication draft | `{document_id}` |
| `NOT_ALLOWED` | 403 | agreement endpoint without `VIEW_AGREEMENT` | – |

## Edge cases the tests must not miss

- A document-level annotation and a mention-based one with the same term and axes are `compatible` (ontospan review decision D3). They form one agreed group; the mention-based member is preselected, because it covers more code points.
- A mention that normalises to nothing (only whitespace or punctuation) never matches (ontospan). Its annotation becomes a singleton `partial` group and must still be decided.
- An annotator who released an empty result still counts towards k. Every group is then `partial` ("1 of 2"), and agreement is computed with F1 = 0 for that pair, or 1.0 if both are empty.
- A stage reopened after adjudication started (T4a intervention) changes the inputs. The adjudication draft keeps its decisions, but the release rule recomputes the groups, so stale decisions do not count and the screen shows the new groups as undecided.

---

## Part 2: Releases, comments and the integration round trip (Tasks 7–14)

**Goal of Part 2:**
- A project lead creates a named, frozen release. It is a self-describing ontospan bundle with the final set of every selected document plus the pseudonymised individual, stage and adjudicated sets and the imported proposal sets it descends from (U3, T7 I5).
- Every release annotation leads back to the producer's ids inside the bundle (O3), and the manifest carries the `release` block (O6, I7).
- All members see releases; leads and system admins download them (Q22).
- Members comment on annotations and documents in threads that follow the blind rules (W8).
- One API test and one local script prove the whole chain: import → assisted round → adjudication → release → export (T7 I10).

**Architecture of Part 2:**
- **Data (migration 0009):** the append-only `releases`, `comments` and `comment_thread_events`, and the mutable `comment_reads`.
- **Release builder (pure):** `release/builder.py` composes the units and the manifest data from plain inputs and checks the lineage. The `release_build` job loads the inputs, calls the builder, writes the bundle with `ontospan.write_bundle(…, release=…)`, reads it back with validation, stores it in the blob store (D3) and inserts the `releases` row last.
- **Versions:** `authz/versions.py::visible_annotation_versions` gains releases and stage results. The re-anchor job of T5 gains the document's final result (Q21).
- **Comments:** `comments/service.py` writes and reads threads; `authz/comments.py::visible_comments` is the single visibility rule (index). Comments are their own append-only log and appear in the edit-log export (D-y).

**Commit rule in Part 2:** per task, `uv run ruff check --fix src tests && uv run ruff format src tests && uv run mypy src`, then one conventional commit without AI attribution.

---

### Task 7: Tables and policy (migration 0009)

**Create:** `storage/migrations/versions/0009_releases_comments.py`. **Modify:** `storage/tables.py` (add `releases`, `comments`, `comment_thread_events` to `APPEND_ONLY_TABLES`), `authz/policy.py`, `tests/test_policy.py`.

| Table | Columns | Keys |
|---|---|---|
| `releases` (append-only) | `release_id` text (generated by the API, `uuid4().hex[:16]`); `project_id` → projects; `name` text; `description` text; `bundle_id` text; `manifest_sha256` text; `blob_sha256` → stored_files; `documents` jsonb; `excluded` jsonb; `supersedes_release_id` text null → releases; `created_by` → users; `created_at` default now(); `job_id` → jobs | PK release_id; UNIQUE (project_id, name); UNIQUE (bundle_id) |
| `comments` (append-only) | `id` bigint identity; `project_id` → projects; `document_id`; `thread_id` bigint (the root's id; the root points to itself); `parent_id` bigint null → comments; `annotation_id` text null; `annotation_version` text null; `target_owner_user_id` → users null; `document_stage_id` → document_stages null; `author_user_id` → users; `body` text CHECK (length 1–5000); `addressed_user_ids` jsonb default '[]'; `corrects_comment_id` bigint null → comments; `created_at` default now() | PK id; FK (project_id, document_id) → documents; ix (project_id, document_id, id) |
| `comment_thread_events` (append-only) | `id` bigint identity; `thread_id` → comments; `action` text CHECK in ('resolve','reopen'); `user_id` → users; `at` default now() | PK id; ix (thread_id, id) |
| `comment_reads` | `user_id` → users; `project_id`; `document_id`; `last_read_comment_id` bigint | PK (user_id, project_id, document_id) |

- `releases.documents` is a list of `{document_id, external_id, language, final_result_id, set_ids: [...]}`; `excluded` is a list of `{document_id, reason}`.
- `target_owner_user_id` is the user whose draft or task result holds the commented annotation, fixed when the comment is written; it is null for document comments and for imported proposals. It lets the visibility rule hide comments on a peer's annotations (W8) without re-deriving ownership.
- The root comment's `thread_id` equals its own `id`. Because the table is append-only, the id cannot be filled in afterwards: take `nextval(pg_get_serial_sequence('ontotator.comments', 'id'))` first, then `INSERT … OVERRIDING SYSTEM VALUE` with `id = thread_id = <that value>`. The application role needs `USAGE` on the sequence (T2c grants it for all sequences). The test below checks it.
- Grants: `SELECT, INSERT` on the three append-only tables; full DML on `comment_reads`.

**Policy:** `CREATE_RELEASE` and `DOWNLOAD_RELEASE` for admins and leads; `VIEW_RELEASES` for admins and every project role. Add the rows to the expected matrix.

> **Open question Q22:** Who may download a release? Provisional default: project leads and system admins. All members see the list of releases and their descriptions.

**Tests:** `tests/test_schema.py` (the comparison holds; the append-only parametrisation covers the three new tables); `tests/test_policy.py` (new rows); `tests/test_comments.py::test_a_root_comment_is_its_own_thread`.

**Steps:**
- [ ] Write the tests above. Run `uv run pytest tests/test_schema.py tests/test_policy.py -q`; they fail (missing module, command or assertion).
- [ ] Add the mappings to `storage/tables.py` and write migration 0009 with the triggers and grants of T2c Task 1.
- [ ] Run `uv run pytest tests/test_schema.py tests/test_policy.py -q` until it passes, then `uv run pytest -q` for regressions.
- [ ] Apply the commit rule and commit.

**Acceptance:** `uv run pytest tests/test_schema.py tests/test_policy.py -q` passes. Commit: `feat(release): release and comment tables with append-only history`.

---

### Task 8: The release builder (pure)

**Create:** `src/ontotator/release/__init__.py`, `src/ontotator/release/builder.py`, `tests/test_release_builder.py`.

**Inputs** (plain dataclasses; the job in Task 9 loads them):

```python
@dataclass(frozen=True)
class DocumentInput:
    document: Document                       # internal id, external_id, language, variant fields (T5)
    final: SetInput                          # the final stage result (T4a final_result_id)
    contributing: Sequence[SetInput]         # individual task results, stage_result and adjudicated sets
    proposals: Sequence[ProposalSetInput]    # proposal_sets rows of the document: id, bundle_id, payload

@dataclass(frozen=True)
class SetInput:
    set_id: str                              # index "T1 set identifiers"
    set_kind: Literal["individual", "stage_result", "adjudicated"]
    stage: str | None                        # stage label, e.g. "annotate-1", "adjudicate"
    actors: Sequence[str]                    # pseudonyms
    blind: bool | None
    created_at: datetime
    annotations: Sequence[ontospan.Annotation]   # via annotation_from_snapshot (Task 1)

def build_release(project: ReleaseProject, documents: Sequence[DocumentInput], *, release_id: str,
                  name: str, description: str, created_by: str, created_at: datetime,
                  supersedes: Sequence[SupersededRelease]) -> ReleasePlan
```

`ReleasePlan` holds `units: list[ontospan.AnnotatedDocument]`, `bundle_id`, `release` (the ontospan 1.1 manifest block, named as in T5 Task 1), `contributors` and `documents` (for `releases.documents`).

**Unit composition** (contract; one unit per set, so every document gives several units with the same document part):
1. **Final set:** `set_kind = "release"`, `annotation_set_id = "{project}:release:{release_id}:{document_id}"`, `actors = [Actor(created_by pseudonym, "human")]`, `stage = None`, `guideline_ref` of the project (T3a), `blind = None`. Each annotation is the final set's annotation with the same `annotation_id`, term, axes and mentions, and
   - `provenance.method = "adopted"`, `provenance.actor` = the release creator;
   - `source_refs = [annotation_ref(final.set_id, annotation_id)] + imported origins of the final annotation` (O3: direct parent plus transitive imported origins, D-t).
2. **Contributing sets:** every `SetInput` as its own unit with its `set_kind`, `stage`, `actors` (pseudonyms only, `kind = "human"`), `blind` and `created_at`; annotations unchanged. The final set itself is one of them (its `stage_result` or `adjudicated` unit).
3. **Imported proposal sets:** every proposal set of the document that any annotation in steps 1–2 reaches through `source_refs`, re-emitted from `payload` with `AnnotationSet.model_validate(payload)` unchanged (D-u): `set_kind = "tool_output"`, the producer's ids, actors, `basis` and notes. Proposal sets nobody descends from are left out.
4. **Document part:** `document_id = external_id`, the language, the canonical text and the T5 variant fields (`case_id`, `variant`, `translation`). The release covers exactly the selected variants (I5).
5. **Layers:** `layers_for(profile, pins)` (T2d), so the ontology pins and `allowed_roots` are recorded.

**Lineage check** (contract): a reference resolves if `parse_annotation_ref(ref)` gives `(set_id, annotation_id)` of an annotation in a unit of the same document in this bundle. The bundle component, when present, is not used for resolution, because set ids are unique within the bundle.

```python
for unit in units:
    for annotation in unit.annotation_set.annotations:
        for ref in annotation.provenance.source_refs:
            if not resolves(ref):            -> RELEASE_LINEAGE_BROKEN {document_id, set_id, annotation_id, ref}
release_annotation = …                       # each annotation of a "release" set:
    parents = closure(release_annotation)    # transitive over source_refs inside the bundle
    imported = {r for r in parents if set_kind_of(r) == "tool_output"}
    if not imported <= set(release_annotation.provenance.source_refs):
                                             -> RELEASE_LINEAGE_BROKEN {…, "missing": sorted(imported - refs)}
```

**Other refusals:**
- `RELEASE_SET_ID_COLLISION` if two units of the bundle share an `annotation_set_id` (for example two import bundles that both used `run-1` for a document). The details list the documents, set ids and the proposal set ids in the database. The release is refused; nothing is renamed (index, risks).
- `RELEASE_EMPTY` if no document is selected.

**Pseudonymisation:**
- Actors are pseudonyms only. `contributors` lists `Contributor(actor_id=pseudonym, name, orcid)` only for users with `orcid_consent` (T1 F10); other actors are not listed.
- Comments and the edit log are never part of a release (W8, D6). The builder takes no comment input.

**Manifest data:**
- `bundle_id = "{project}-release-{release_id}"`;
- `release = {name, description, project_id: project key, producer: {name: "ontotator", version: ontotator.__version__}, supersedes: [{bundle_id, manifest_sha256}]}` (I7);
- `release_name = name` (equal to `release.name`, I7).

**Tests (`tests/test_release_builder.py`):** inputs built in the test from a two-annotator parallel workflow on one document, where annotator A adopted a tool proposal and B annotated manually, and from a revise chain on a second document.
- `test_every_document_has_its_final_and_contributing_sets`: set kinds per document are `{release, individual, adjudicated, tool_output}` for the parallel document and `{release, stage_result}` (two `stage_result` units: annotate k = 1, then revise) for the revise document.
- `test_release_annotations_point_to_the_final_set_and_imported_origins` (O3).
- `test_tool_output_sets_are_reemitted_verbatim`: the unit's set equals `payload` field by field, including `basis` and an unknown extra field.
- `test_unused_proposal_sets_are_left_out`.
- `test_human_actors_are_pseudonyms`: no username or display name appears in `dump_json` of any unit.
- `test_only_consenting_contributors_are_named`.
- `test_variant_fields_are_kept`: a German translation variant keeps `case_id`, `variant` and `translation`, and `document_id` is the external id.
- `test_a_dangling_reference_breaks_the_lineage` (`RELEASE_LINEAGE_BROKEN` with the ref).
- `test_a_missing_imported_origin_breaks_the_lineage`.
- `test_colliding_set_ids_are_refused`.
- `test_the_release_block_names_project_producer_and_supersedes`.
- `test_the_plan_is_deterministic`: the same inputs give equal units and manifest data.

**Steps:**
- [ ] Write the tests above. Run `uv run pytest tests/test_release_builder.py -q`; they fail (missing module, command or assertion).
- [ ] Implement the unit composition, then the lineage check, then the refusals; keep `builder.py` free of database access.
- [ ] Build the test inputs with a small factory in `tests/release_factory.py`; Task 9 and Task 14 reuse it.
- [ ] Run `uv run pytest tests/test_release_builder.py -q` until it passes, then `uv run pytest -q` for regressions.
- [ ] Apply the commit rule and commit.

**Acceptance:** `uv run pytest tests/test_release_builder.py -q` passes. Commit: `feat(release): pure release builder with lineage sets and the release block`.

---

### Task 9: Release job, storage, API and CLI

**Create:** `src/ontotator/release/jobs.py`, `src/ontotator/release/service.py`, `api/release_routes.py`, `tests/test_releases.py`. **Modify:** `api/app.py`, `cli.py`, `tests/test_admin_cli.py`.

**`ReleaseService(db, jobs, *, now=…)`:**
- `candidates(project) -> {included: [DocumentSummary], excluded: [{document_id, reason}]}`: included are documents whose stage chain has a final result (T4a `final_result_id`). Excluded with reasons `no_final_result` (work in progress) or `no_workflow`.
- `create(actor, project, *, name, description, document_ids: list[str] | None, supersedes_release_id: str | None) -> job_id`:
  - needs `CREATE_RELEASE`;
  - `document_ids = None` means all candidates; a listed document without a final result gives `RELEASE_DOCUMENT_NOT_FINAL` with the ids;
  - a name already used in the project gives `RELEASE_NAME_TAKEN`; an unknown or foreign `supersedes_release_id` gives `RELEASE_NOT_FOUND`;
  - generates `release_id` and enqueues `release_build` with `{project, release_id, name, description, document_ids, excluded, supersedes_release_id, created_by}`.
- `list(project) -> list[ReleaseSummary]` (needs `VIEW_RELEASES`): `release_id, name, description, created_at, created_by (pseudonym), documents count, excluded count, supersedes, superseded_by, manifest_sha256`.
- `open_bundle(actor, project, release_id) -> Path` (needs `DOWNLOAD_RELEASE`): the blob path. Audits `release.download`.

**Job `release_build`:**
- loads, for each selected document, the final stage result, every `stage_results` row of the document, the individual results of its completed parallel annotate stages (`released_task_results`, Task 1; stages with one person are represented by their `stage_results` row), and its `proposal_sets`;
- calls `build_release`;
- writes `target.zip` with `ontospan.write_bundle(target, units, bundle_id=…, created_at=…, release_name=name, contributors=…, release=…)`. `write_bundle` validates; a `FormatError` fails the job with the issue codes;
- reads it back with `ontospan.read_bundle(target, {ontology_id: ObographOntology.load(pin blob)})` and fails on any error;
- stores the bytes in the blob store (`stored_files` row), computes the manifest SHA-256 from the `manifest.json` entry, and inserts the `releases` row as the last statement;
- audits `release.create` with `{release_id, bundle_id, manifest_sha256, documents, excluded}` (I9);
- returns `{release_id, sha256, units, documents}`.

The bundle bytes never change after the insert (W7). A correction is a new release whose `supersedes_release_id` names the earlier one; its manifest `supersedes` carries that release's `bundle_id` and `manifest_sha256`.

**API (`/api/v1/projects/{key}/releases`):**

| Route | Behaviour |
|---|---|
| `GET /candidates` | `CREATE_RELEASE`; included and excluded documents |
| `POST /` `{name, description, document_ids?, supersedes_release_id?}` | `CREATE_RELEASE`; returns `{job_id, release_id}` |
| `GET /` | `VIEW_RELEASES`; the list |
| `GET /{release_id}/download` | `DOWNLOAD_RELEASE`; `application/zip`, filename `"{project}-{name slug}.zip"`, the stored bytes |

Job status uses T3a's `GET /api/v1/jobs/{id}`.

**CLI:** `ontotator admin export-release PROJECT RELEASE OUT.zip`. `RELEASE` is the id or the name. It copies the stored bytes and refuses to overwrite `OUT`. It audits `release.download` with the actor `Actor.cli()` (T7 I5: the same bytes as the download).

**Tests (`tests/test_releases.py`):**
- `test_candidates_list_excluded_documents_with_reasons`.
- `test_a_release_is_built_stored_and_listed`: the job succeeds; the row exists; the blob's SHA-256 equals `blob_sha256`; `read_bundle` with the HP ontology passes.
- `test_the_stored_manifest_hash_matches_the_bundle`.
- `test_a_document_without_final_result_cannot_be_selected`.
- `test_release_names_are_unique_per_project`.
- `test_a_correction_supersedes_the_earlier_release`: the second manifest's `release.supersedes` names the first bundle id and manifest hash; the list shows `superseded_by`.
- `test_releases_are_immutable`: `UPDATE ontotator.releases` fails with "permission denied".
- `test_every_member_sees_the_list_but_only_leads_download`: an annotator gets the list and 403 on download; the lead downloads; `release.download` is audited.
- `test_a_lineage_error_fails_the_job_and_writes_no_row`.
- `tests/test_admin_cli.py::test_export_release_writes_the_identical_bytes`.

**Steps:**
- [ ] Write the tests above. Run `uv run pytest tests/test_releases.py -q`; they fail (missing module, command or assertion).
- [ ] Implement the loader in `release/jobs.py` on top of T4a's queries and register `release_build` with the job queue.
- [ ] Add `ReleaseService`, the routes and the CLI command; regenerate the contract.
- [ ] Run `uv run pytest tests/test_releases.py -q` until it passes, then `uv run pytest -q` for regressions.
- [ ] Apply the commit rule and commit.

**Acceptance:** `uv run pytest tests/test_releases.py tests/test_admin_cli.py -q` passes; regenerate the contract. Commit: `feat(release): release job, storage, API and CLI export`.

---

### Task 10: Release page

**Create:** `frontend/src/releases/ReleasesPage.tsx`, `frontend/src/releases/CreateReleaseDialog.tsx`, `frontend/tests/releases.test.tsx`, `frontend/browser/releases.spec.ts`. **Modify:** `router.ts` (`#/projects/:key/releases`), the project navigation (visible to every member), `client.ts`.

**Page:**
- A list of releases, newest first: name, description, date, creator pseudonym, documents, "supersedes X" / "superseded by Y", and the manifest SHA-256 (shortened, copyable).
- "Download" appears only with `DOWNLOAD_RELEASE` (from the project summary's allowed actions).
- With `CREATE_RELEASE`, "New release" opens the dialog:
  - name (required) and description;
  - the candidate documents as a multi-select table (all selected by default; filter by language and case), and below it "Not included (no final result)" with the excluded documents and reasons (W7: listed, never silent);
  - "Supersedes" as an optional select of earlier releases;
  - "Create release" enqueues the job; the dialog shows the job state and closes on success. A failed job shows the error code and its details (for `RELEASE_LINEAGE_BROKEN` and `RELEASE_SET_ID_COLLISION` the listed items).
- Empty state: "No release yet."

**Vitest:** "lists releases with supersede links", "hides Download without the right", "selects all candidates and lists excluded documents", "creates a release and shows the job result", "shows a lineage error with its items".

**Browser (`releases.spec.ts`):** "lead creates a release, annotator sees it": the lead creates "Gold v1" from scenario `parallel-adjudication` after adjudication, and the download returns a ZIP (`page.waitForEvent("download")`, size > 0); the annotator sees "Gold v1" and no Download button.

**Steps:**
- [ ] Write the tests above. Run `npm --prefix frontend test -- tests/releases.test.tsx`; they fail (missing module, command or assertion).
- [ ] Add the client methods, the page and the dialog; poll the job through the T3b job helper.
- [ ] Run `npm --prefix frontend run test:e2e -- browser/releases.spec.ts`.
- [ ] Run `npm --prefix frontend test -- tests/releases.test.tsx` until it passes, then `uv run pytest -q` for regressions.
- [ ] Apply the commit rule and commit.

**Acceptance:** `npm --prefix frontend test -- tests/releases.test.tsx`, `npm --prefix frontend run typecheck` and `npm --prefix frontend run test:e2e -- browser/releases.spec.ts` pass. Commit: `feat(frontend): release page with creation and download`.

---

### Task 11: Releases and stage results in the viewer; re-anchoring final results

**Modify:** `authz/versions.py`, the T5 version-loading endpoint, the T5 re-anchor job, `tests/test_annotation_versions.py`, `tests/test_reanchor.py`.

**`visible_annotation_versions` additions** (the function stays the only place for these rules):
- `release`: for every member with `VIEW_RELEASES`, each release that contains the document, labelled with the release name. Its annotations are read from `releases.documents[].final_result_id` (the same content as the bundle's release set), so no ZIP is parsed.
- `stage_result`: only inside an assignment (`assignment` argument). Offered are the results of earlier stages of the same document that this task takes as input (T4a), and only once the blind state allows foreign annotations (`foreign_visible`, W4; V3: the second pane follows the blind rules). Leads and system admins see every stage result of a document.
- Never offered: other annotators' drafts or individual results outside such a task (U2), and results of later stages to earlier stages' assignees.

> **Open question Q25:** May an annotator see the adjudicated or final result of a document they annotated? Provisional default: not before a release contains it. Then it is visible to everyone through the release.

**Re-anchoring (Q21):** when T5's re-anchor runs for a new text version, the sources are the old version's proposal sets (T5) **plus the old version's final stage result**, if one exists. The final result becomes one more proposal set with `origin = "reanchor"`, the tool actor `ontotator-reanchor`, and `source_refs` to the final result's annotations. Individual submissions are not carried over.

> **Open question Q21:** When a text gets a corrected version, which annotations are carried over automatically? Provisional default: imported proposals and the document's final result; individual annotators' submissions stay with the old version.

**Tests:**
- `test_annotation_versions.py::test_members_see_releases_of_the_document`.
- `…::test_an_annotator_does_not_see_the_final_result_before_a_release` (Q25).
- `…::test_a_reviser_sees_the_previous_stage_result_only_when_revealed`: with `foreign_visible = false` it is not offered; after the show command it is.
- `…::test_parallel_peers_are_never_offered`.
- `…::test_a_lead_sees_every_stage_result`.
- `test_reanchor.py::test_the_final_result_is_reanchored_as_a_proposal_set`: the new set's `source_refs` point to the final result; a segment in a changed region is listed as needs review.

**Steps:**
- [ ] Write the tests above. Run `uv run pytest tests/test_annotation_versions.py tests/test_reanchor.py -q`; they fail (missing module, command or assertion).
- [ ] Extend `visible_annotation_versions` only; the loading endpoint reads the new kinds through it.
- [ ] Add the final result as a re-anchor source in the T5 job.
- [ ] Run `uv run pytest tests/test_annotation_versions.py tests/test_reanchor.py -q` until it passes, then `uv run pytest -q` for regressions.
- [ ] Apply the commit rule and commit.

**Acceptance:** `uv run pytest tests/test_annotation_versions.py tests/test_reanchor.py -q` passes. Commit: `feat(versions): releases and stage results in the viewer; re-anchor final results`.

---

### Task 12: Comments backend (W8)

**Create:** `src/ontotator/comments/__init__.py`, `src/ontotator/comments/service.py`, `src/ontotator/authz/comments.py`, `api/comment_routes.py`, `tests/test_comments.py`. **Modify:** the edit-log export handler (T2d), the "My tasks" endpoint (T3a), `api/app.py`.

**`CommentService(db, *, now=…)`:**
- `post(actor, project, document_id, *, body, assignment_id=None, annotation=None, parent_id=None, corrects_comment_id=None, addressed: list[str] = []) -> Comment`:
  - the author must see the document (`require_document`, T3a);
  - `document_stage_id` comes from the assignment (it must be the author's own, active, and on this document); without one it is null (a lead's comment);
  - an `annotation` `(id, version)` must be visible to the author in that context (the draft, the stage inputs, a proposal set, or a visible version); otherwise `COMMENT_TARGET_UNKNOWN`. `target_owner_user_id` is its owner;
  - a reply's `parent_id` must be in a thread the author sees; `thread_id` is the parent's thread;
  - a correction's `corrects_comment_id` must be the author's own comment (`NOT_COMMENT_AUTHOR`); it is a reply in the same thread;
  - `addressed` are pseudonyms; each must be a user who will see the comment (`ADDRESSEE_CANNOT_SEE`), so addressing never breaks the blind rule.
- `set_thread_state(actor, project, thread_id, action)` with `resolve` or `reopen`: any user who sees the thread; a no-op change (resolving a resolved thread) gives `THREAD_STATE_UNCHANGED`.
- `threads(actor, project, document_id, *, assignment_id=None) -> list[Thread]`: the visible threads with comments in order, `resolved` state, `corrected_by` links and author pseudonyms.
- `mark_read(actor, project, document_id, last_read_comment_id)`: upsert, never moves backwards.
- `unread_counts(actor, project) -> dict[document_id, (unread, addressed_unread)]`.

**The visibility rule** (contract; `authz/comments.py::visible_comments(access, project, document_id, viewer_assignments)` returns a SQL filter, and `can_see_comment(...)` the same rule for one comment):

| Comment | Visible to |
|---|---|
| any | its author |
| made in stage S (`document_stage_id = S`) | assignees of S, except while S is an `annotate` stage with k ≥ 2 that is not complete (then only the author); assignees of every later stage of the document |
| made in a `revise` or `adjudicate` stage S | additionally the assignees of every earlier stage of the document (W8: the adjudicator's queries reach the annotators; Q31) |
| without stage (a lead's comment) | every assignee of the document and the project's leads |
| on an annotation with `target_owner_user_id = O` | additionally restricted: hidden from assignees of an incomplete parallel `annotate` stage of this document other than O (W8: comments on a peer's annotations stay hidden until the stage is complete) |
| any | leads and system admins of the project (Q24), unless the viewer is an assignee of an incomplete parallel annotate stage of this document; then the rows above apply to them |

Translation-review assignments have no stage; they see lead comments and their own.

> **Open question Q24:** Which comments does a project lead see? Provisional default: all comments of the project, unless the lead is also an annotator of that document in a stage still in progress; then the annotator rule applies.

> **Open question Q31:** May the reviser's comments (not only the adjudicator's) reach the annotators of earlier stages of the document? Provisional default: yes. A reviser's question to the annotator is the same kind of query as an adjudicator's, and comments never show annotations.

**Edit-log export (D-y):** after the `edit_events` lines, the export adds, ordered by `(at, id)`:

```json
{"kind": "comment", "comment": 41, "thread": 40, "parent": 40, "at": "2026-10-14T12:00:05Z",
 "document_id": "EN100017", "author": "ann-0003", "stage": 2, "annotation_id": "…", "annotation_version": "…",
 "body": "…", "addressed": ["ann-0001"], "corrects": null}
{"kind": "comment_thread", "thread": 40, "action": "resolve", "by": "ann-0001", "at": "…"}
```

`stage` is the document stage's position. Pseudonyms only, UTC to the second (Q14). Comments are never part of a T1 export or a release.

**API (`/api/v1/projects/{key}/documents/{document_id}/comments`):** `GET ?assignment=` (threads), `POST` (post), `POST /threads/{thread_id}/resolve` and `/reopen`, `POST /read {last_read_comment_id}`. "My tasks" items gain `unread_comments` and `addressed_unread`.

**Tests (`tests/test_comments.py`):**
- `test_a_root_comment_is_its_own_thread` (from Task 7).
- `test_replies_and_corrections_keep_the_earlier_text`: the corrected comment still exists and has `corrected_by`.
- `test_only_the_author_corrects`.
- `test_comments_cannot_be_changed`: `UPDATE` and `DELETE` on `comments` fail.
- `test_parallel_peers_do_not_see_each_others_comments_until_complete`: A's comment on A's annotation is hidden from B; after both release (stage complete) B still does not see it because B has no later-stage assignment, while the adjudicator does.
- `test_a_lead_comment_on_a_peer_annotation_is_hidden_from_the_other_peer`.
- `test_comments_reach_later_stages`.
- `test_adjudicator_queries_reach_the_annotators` (W8).
- `test_reviser_comments_reach_earlier_stages` (Q31).
- `test_leads_see_all_comments_unless_annotating_in_progress` (Q24).
- `test_addressing_someone_who_cannot_see_is_refused`.
- `test_unread_counts_and_addressed_highlights`: counts drop after `mark_read`; `mark_read` never moves backwards.
- `test_resolve_and_reopen_are_events`.
- `test_comments_appear_in_the_edit_log_export`: pseudonyms, no user ids, ordered by time.
- `test_comments_never_appear_in_a_release`: no comment body text in the release ZIP bytes.

**Steps:**
- [ ] Write the tests above. Run `uv run pytest tests/test_comments.py -q`; they fail (missing module, command or assertion).
- [ ] Implement `can_see_comment` first as a pure function over a small context object and test the table row by row; then derive the SQL filter and assert both agree on the same fixtures.
- [ ] Implement `CommentService`, the routes (including `addressable`) and the unread counts in "My tasks".
- [ ] Extend the edit-log export handler and run `uv run pytest tests/test_t1_export.py -q`.
- [ ] Run `uv run pytest tests/test_comments.py -q` until it passes, then `uv run pytest -q` for regressions.
- [ ] Apply the commit rule and commit.

**Acceptance:** `uv run pytest tests/test_comments.py tests/test_t1_export.py -q` passes; regenerate the contract. Commit: `feat(comments): append-only comment threads with blind-aware visibility`.

---

### Task 13: Comments UI

**Create:** `frontend/src/comments/CommentThreads.tsx`, `frontend/src/comments/CommentComposer.tsx`, `frontend/src/comments/commentsState.ts`, `frontend/tests/comments.test.tsx`, `frontend/browser/comments.spec.ts`. **Modify:** the editor's detail pane (T4a) and the adjudication screen (Task 4) to host the threads, the "My tasks" list (T4a), `client.ts`, `styles.css`.

**Behaviour:**
- **Detail pane:** for the selected annotation, its threads and "Comment on this annotation". Without a selection: "Document comments" with the document's threads and "Comment on the document".
- **Thread:** comments in order with author pseudonym and time; a corrected comment shows its earlier text struck through with "corrected" and the correction below; "Reply", "Correct" (own comments only), "Resolve" / "Reopen". Resolved threads are collapsed with a "Resolved" label.
- **Composer:** plain text, 5000 characters, an "Address" multi-select of the people offered by the server (`GET …/comments/addressable?assignment=` returns the pseudonyms that can see a new comment in this context; add this route in Task 12's router).
- **Addressed:** comments that address the current user are highlighted until read.
- **Read state:** opening the document's comments marks them read (`POST …/read` with the newest visible id).
- **Annotation marker:** annotations with open threads show a small comment count in the annotation list.
- **"My tasks":** an unread badge per document ("3 new comments"), emphasised when the user is addressed.
- No e-mail or push notification (T2 D2).

**Vitest:** "shows threads of the selected annotation", "shows document comments without a selection", "replies and corrects with the earlier text struck through", "offers only addressable people", "highlights comments addressed to me until read", "shows unread badges in My tasks", "resolves and reopens a thread".

**Browser (`comments.spec.ts`):** "adjudicator asks, annotator sees the query": scenario `parallel-adjudication`; the adjudicator comments on a group member and addresses annotator A; A logs in, "My tasks" shows the badge, A opens the document (read-only after release) and sees the highlighted comment; annotator B does not see A's earlier comment on A's own annotation.

**Steps:**
- [ ] Write the tests above. Run `npm --prefix frontend test -- tests/comments.test.tsx`; they fail (missing module, command or assertion).
- [ ] Add `commentsState.ts` (threads, read state) and the components; mount them in the detail pane and the adjudication screen.
- [ ] Run `npm --prefix frontend run test:e2e -- browser/comments.spec.ts`.
- [ ] Run `npm --prefix frontend test -- tests/comments.test.tsx` until it passes, then `uv run pytest -q` for regressions.
- [ ] Apply the commit rule and commit.

**Acceptance:** `npm --prefix frontend test -- tests/comments.test.tsx`, `npm --prefix frontend run typecheck` and `npm --prefix frontend run test:e2e -- browser/comments.spec.ts` pass. Commit: `feat(frontend): comment threads in the detail pane with unread badges`.

---

### Task 14: Integration round trip (T7 I10)

**Create:** `scripts/make_integration_fixtures.py`, `tests/fixtures/integration/documents-and-proposals.zip`, `tests/fixtures/integration/late-proposals.zip`, `tests/test_integration_roundtrip.py`, `scripts/check_integration_roundtrip.py`. **Modify:** `docs/operations.md` (a short section "Integration round trip before tagging").

**Fixtures** (`scripts/make_integration_fixtures.py`, committed together with its output; it uses only `ontospan` and `tests/fixtures/hp.json`):
- `documents-and-proposals.zip`: two native documents (`case-1`, `case-2`, English) and one German machine translation of `case-1` (format 1.1: `case_id = "case-1"`, `variant.origin = "machine_translation"`, `derived_from` = the source text hash, `translation.checks` all passed). One `tool_output` set for `case-1` with three annotations (tool actor with `name`, `version`, `model`, `run_id`, and a `notes` entry; one axis with `basis: "defaulted"`). `case-2` and the translation carry empty sets (O2).
- `late-proposals.zip`: a second `tool_output` set for `case-1` from another run.

**API test (`tests/test_integration_roundtrip.py::test_import_assisted_round_adjudication_release_export`)**, all through the HTTP API with logged-in clients (`auth_harness`), except the user creation:
1. An admin creates the project with the HP pin and the parallel template (annotate k = 2 with proposal policy `shown` → adjudicate) and imports `documents-and-proposals.zip` through the upload preview and commit (T3a). The preview lists 3 documents, 1 proposal set with its tool label, and 2 "document only" units.
2. The lead accepts the translation in the preview with a reason (T7 I2), starts the workflow for `case-1` and assigns annotators A and B and adjudicator C.
3. **Assisted first round (O5):** A opens the task; the three proposals are targets; A confirms one, changes one and deletes one.
4. **Late set (O7):** the lead imports `late-proposals.zip`. A's draft reports "new proposals available" with the second tool label; A adopts it and confirms its annotation. B's draft, opened after the import, has both sets as normal input; B toggles foreign annotations off and on (an edit event; B's result is not blind) and works through the checklist.
5. Both release. The agreement job runs (Task 5) and stores one pair row.
6. C adjudicates: confirms the agreed groups, takes A's version of one conflict, rejects one partial group, and releases.
7. The lead creates release "Gold v1" for `case-1`; `case-2` and the translation appear as excluded (`no_final_result`). The lead downloads it.
8. **Assertions on the download**, read with `ontospan.read_bundle` and the HP ontology:
   - set kinds for `case-1`: one `release`, one `adjudicated`, two `individual`, two `tool_output`;
   - the `tool_output` sets keep the producer's `annotation_set_id`, annotation ids, `basis: "defaulted"` and notes (O1, D-u);
   - every release annotation's `source_refs` starts with the adjudicated annotation and contains the proposal URNs it descends from (O3); every reference resolves inside the bundle;
   - `manifest.release` has the name, description, project key, `producer.name == "ontotator"` and empty `supersedes` (O6, I7);
   - no username or display name occurs in the ZIP bytes;
   - the audit log has `project.import` twice with bundle ids and manifest hashes, and `release.create` with the manifest hash (I9).
9. A second release "Gold v1.1" superseding "Gold v1" has `release.supersedes == [{bundle_id, manifest_sha256}]` of the first.
10. The edit-log export contains the adopt and toggle commands of step 4 as edit events (O7).

**Script (`scripts/check_integration_roundtrip.py`):** the same flow against the dev compose stack, run by hand before tagging a release:
- precondition: `docker compose -f docker-compose.dev.yml up -d --build --wait`;
- users through `docker compose … exec app ontotator admin users create`, codes redeemed through `POST /api/v1/auth/redeem-code` (as `scripts/seed_stack.py`, T2e; reuse its helpers);
- the HTTP steps with `httpx` and CSRF headers, against `http://127.0.0.1:8000`, using a unique project key per run (`rt-<timestamp>`);
- downloads the release to a temporary directory, checks it with `ontospan.read_bundle` and the assertions of step 8, and prints `PASS`/`FAIL` per step; exit code non-zero on any failure;
- it leaves the stack running and does not delete the project (the data shows what was checked).

```bash
docker compose -f docker-compose.dev.yml up -d --build --wait
uv run python scripts/check_integration_roundtrip.py --base-url http://127.0.0.1:8000
docker compose -f docker-compose.dev.yml down -v
```

The script is not part of `scripts/check.sh`, because it needs a running stack; the API test covers the same flow in the gate.

**Steps:**
- [ ] Write the tests above. Run `uv run pytest tests/test_integration_roundtrip.py -q`; they fail (missing module, command or assertion).
- [ ] Write and run `uv run python scripts/make_integration_fixtures.py`; commit the script with its output.
- [ ] Write the API test step by step; each numbered step is one helper in the test module, so a failure names the step.
- [ ] Write the script on top of the same step helpers where possible, run it against the dev stack as shown below.
- [ ] Run `uv run pytest tests/test_integration_roundtrip.py -q` until it passes, then `uv run pytest -q` for regressions.
- [ ] Apply the commit rule and commit.

**Final gate:**
- `uv run pytest tests/test_integration_roundtrip.py -q` passes.
- The script passes against the dev stack.
- Rebuild the embedded assets.
- `scripts/check.sh` passes.
- Commit: `test(integration): import to release round trip with lineage checks`.

---

## Error codes of Part 2 (contract)

| Code | Status | Raised by | Details |
|---|---|---|---|
| `RELEASE_EMPTY` | 422 | create, builder | – |
| `RELEASE_DOCUMENT_NOT_FINAL` | 422 | create | `{document_ids}` |
| `RELEASE_NAME_TAKEN` | 409 | create | `{name}` |
| `RELEASE_NOT_FOUND` | 404 | supersedes, download, CLI | `{release}` |
| `RELEASE_LINEAGE_BROKEN` | job error | builder | `{document_id, set_id, annotation_id, ref}` or `{…, missing}` |
| `RELEASE_SET_ID_COLLISION` | job error | builder | `{documents: [{document_id, set_id, proposal_set_ids}]}` |
| `COMMENT_TARGET_UNKNOWN` | 422 | post | `{annotation_id, annotation_version}` |
| `NOT_COMMENT_AUTHOR` | 403 | post with `corrects_comment_id` | `{comment_id}` |
| `ADDRESSEE_CANNOT_SEE` | 422 | post | `{pseudonyms}` |
| `THREAD_STATE_UNCHANGED` | 409 | resolve, reopen | `{thread_id, state}` |
| `COMMENT_NOT_FOUND` | 404 | reply, resolve, reopen on an invisible or unknown thread | – |

Job errors appear in the job's `error` as `"<CODE>: <json details>"`, so the release dialog can show the listed items.

## Comment API shapes

```text
Thread  = {thread_id, document_id, annotation: {annotation_id, annotation_version} | null,
           resolved: bool, comments: [Comment]}
Comment = {id, parent_id, author: pseudonym, created_at, body, addressed: [pseudonym],
           addressed_to_me: bool, unread: bool, corrects: id | null, corrected_by: id | null}
POST body = {body, assignment_id?, annotation?: {annotation_id, annotation_version},
             parent_id?, corrects_comment_id?, addressed?: [pseudonym]}
```

## Spec coverage

| Spec item | Task |
|---|---|
| W5 grouping with the T1 F11 matcher; k > 2 clustering with "2 of 3" | 1 |
| W5 agreed groups (equal, compatible with longer span) prefilled, collapsed, one confirming action, each still changeable | 1, 2, 4 |
| W5 groups to decide (axis, term with ancestor flag, modifier, only-some, any without full agreement): take, edit, reject | 1, 2, 4 |
| W5 text view: annotator colours, selected group highlighted, j/k between undecided groups | 4 |
| W5 result `adjudicated` with `adopted`/`merged`/`edited` and `source_refs` to every contributing annotation | 2 |
| W5 release only without undecided groups | 2, 4 |
| W3 adjudicate: take A's or B's span or draw new boundaries; F11 differences are not conflicts | 1, 2, 4 |
| W1 / E9 adjudicator not an annotator of the document (project option) | 2 |
| T7 O3 imported origins on adjudicated annotations | 2 |
| D6 every adjudication step is an edit event | 2 |
| W6 computed as a job when a parallel stage completes; T1 F11 matcher | 5 |
| W6 metrics: mention F1 strict/tolerant, term-level F1, modifier agreement, mean over pairs, no kappa | 5 |
| W6 aggregation per document, pair, language, project; most conflicts first | 5, 6 |
| W6 visible to leads and system admins only | 5, 6 |
| Releases, comments, viewer versions | 7–14 |
| W7 release with name and description by the lead; default all documents with a final result; others excluded and listed; selection can be narrowed | 8, 9, 10 |
| W7 frozen bundle with source submissions, guideline references and ontology pins; stored on `/data` with its hash; immutable; correction supersedes | 7, 8, 9 |
| W7 / E8 all members see releases | 9, 10, 11 |
| T7 I5 final set plus individual, stage_result, adjudicated and the imported `tool_output` sets; pseudonyms; consent for names; no comments or edit log; variants | 8 |
| T7 I5 download needs the export right; `admin export-release` writes identical bytes | 9 (Q22) |
| T7 O3 direct parents and transitive imported origins; references resolve inside the bundle | 8, 14 |
| T7 O6 / I7 lineage sets and the manifest `release` block | 8, 9, 14 |
| T7 I9 releases audited with the manifest hash; hash-linked chain | 9, 14 |
| T7 I10 API round trip and `scripts/check_integration_roundtrip.py` | 14 |
| V3 annotation versions: releases and stage results the task may see; blind rules in the second pane | 11 |
| V2 / Q21 re-anchoring of the final result | 11 |
| W8 comments on annotations and documents; threads; resolve and reopen | 12, 13 |
| W8 append-only with corrections; recorded with author | 7, 12 |
| W8 visibility follows the blind rules; later stages see earlier comments; adjudicator queries reach annotators | 12 |
| W8 unread counts in the task list; addressed comments highlighted; no e-mail | 12, 13 |
| W8 comments in the edit-log export, not in releases | 12 |
