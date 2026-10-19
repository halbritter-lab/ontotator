# Acceptance remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans when implementation is explicitly authorized. Steps use checkbox syntax. Implementation is authorized by the subsequent user request; preserve the demo and do not create intermediate commits.

**Goal:** Deliver an understandable HPO workflow from annotation and correction to an explicitly selected result per text/language, with reliable history, review, problem handling and export.

**Architecture:** Keep immutable text versions/submissions, exact evidence coordinates and per-person isolation. Add explicit records for work rounds, reports, final selections and review obligations instead of overloading text-version or clinical-axis fields. Lead dashboard and final-export preflight share one server-side warning projection.

**Tech Stack:** Existing Python/FastAPI/PostgreSQL/Alembic, React 18/TypeScript/plain CSS, pytest, Vitest and Playwright. Reuse API/client generation and local assets.

**Spec:** The confirmed design below consolidates the [running protocol](../reviews/2026-10-18-phase0-manual-acceptance.md), including the scenario walkthrough. Supporting evidence: [Sol analysis](../reviews/2026-10-18-acceptance-sol61-analysis.md), [Impeccable analysis](../reviews/2026-10-18-acceptance-impeccable-analysis.md), PRODUCT.md and DESIGN.md. User decisions supersede earlier recommendations.

**Status:** Implementation authorized on 2026-10-18 by the subsequent user request, including independent Argon 4, Codex and protocol-based UX reviews. The [three-review synthesis](../reviews/2026-10-18-acceptance-consolidated-review-summary.md) remains supporting evidence; dependent technical contracts are resolved in the [workflow contract addendum](../specs/2026-10-18-acceptance-workflow-contracts.md). Implementation and verification are complete in the isolated worktree; the [execution handoff](../reviews/2026-10-19-acceptance-implementation-handoff.md) records exact results, review dispositions and remaining human/manual acceptance limits. Historical checklists below are retained as the original plan, not a live progress tracker. Preserve the existing demo; no intermediate commits or push.

## Global Constraints

- Preserve the running demo, both runtime directories, user work, credentials and volumes. Verification uses isolated fixtures/candidates.
- English UI, light theme, existing reading identity and offline/local assets. German conversation labels do not imply UI localization.
- Exact Unicode codepoint offsets, immutable snapshots, provenance, authorization and independent annotation remain invariant.
- No automatic clinical confirmation, implicit cross-person copying, winning-by-timestamp, automatic final-selection replacement or silent export omission. Explicit consolidation and deliberate lead replacement remain supported.
- Preserve abandoned work as history; never mutate historical submissions to implement restart or correction.
- HPO first, full pinned release and all available compatible official search translations. Additional ontologies remain deferred; preserve generic profile support.
- No SVG paths for the new summary/status symbols. Exact assets are undecided; use accessible text fallback until selected.
- Planning stays local, without per-interaction commits. Later publishing follows the authorization then in force.

## Confirmed product design

### Texts, versions and results

One logical text such as GSC17 appears once: **logical text → language → text version → annotation results/submissions**. Independent translation runs remain distinguishable within a language. Highlight selected results; expand histories/details on demand. Preserve translation-source links and linear correction ancestry; navigation grouping changes neither.

Annotation-only correction creates a new submission on the same text version. Translation accepted unchanged creates a review submission without a text version. Text correction creates a new text version. Existing translations retain their exact original source even after that original changes.

The lead selects **one exact text version plus one exact annotation result per logical text and language**. The result can be individual or consolidated. Later changes flag that selection for review, never replace it. Independent work is not implicitly consensus.

### Correction, independent work and clean restart

Carry human annotations forward to corrected text as a starting point for renewed review/submission. Anna and Ben each receive only their own previous work. Unchanged evidence coordinates do not prove unchanged clinical meaning; new text still needs review. Original-to-translation annotation transfer is outside scope; current reanchoring is same-language correction only.

When a common result is needed, the lead initiates review of explicit frozen submissions. A reviewer produces a separate consolidated result; originals remain intact. Current proposal review does not automatically implement that process.

An annotator can report a problem and put their whole personal document task on hold at any time, including after submission. The lead sees it and may extend the hold to other affected tasks. Resume preserved work, continue on corrected text, or agree a clean restart with the lead. Restart creates an empty annotation round without reloading suspect annotations/proposals/decisions; it changes no text by itself. Keep abandoned work as history, not an automatic latest-result fallback. An already explicit final selection remains pinned with a warning until the lead changes it.

Correction of an original flags related translations for review. Explicit no-change confirmation records which source update was checked, without rewriting historical linkage. Otherwise create a corrected translation and re-review annotations. Also support correction of a previously corrected-and-accepted translation through normal assignment APIs; current allocation rules leave a gap.

### Shared warnings and final export

The lead dashboard shows text, language, reason and direct destination for each open issue. Final export displays the **same warnings**. The lead can return or consciously export anyway; warned selected results are not silently excluded. Missing final selection produces a warning and an explicitly disclosed omission if the lead continues, never substitution of the latest submission.

Workflow warning overrides do not bypass authorization, invalid provenance, malformed output or missing immutable inputs. Final export must freeze exact selections and acknowledged warning state for its job. Existing all-individual export behavior is not the newly selected-result export.

### Annotation workspace

Keep layout stable; first narrow the left list. Selecting a finding must not shift/resize text. No automatic sidebar opening/closing. Assess further right-side savings in a concrete view.

Compact clinical-axis summaries use stable profile-defined positions; workflow-state symbols have a distinct fixed position. Highlight relevant states only. Provide full hover/focus wording and accessible names; distinguish unspecified/defaulted values. Completion is not axis confirmation. Spanless status is separate from workflow state. Full labelled controls remain in details.

Show saving/saved/error truthfully; navigation does not undo saved work. Visible Submissions access lists timestamps and historical annotations/comments; distinguish annotation notes from review reasons, keep history read-only.

After a missing spanless reason retain the term and offer Add annotation after repair; preserve fast ordinary complete-input creation. Unresolved retains intent, collects reason and explicitly saves; no repeat ambiguous click or note autosave onto an earlier outcome.

Text-change review is **associate evidence → inspect/confirm values → Complete review**. Save before completion, then link the exact persisted latest snapshot. Completed notices move to expandable history; resulting annotations are ordinary list entries. Later edits still invalidate resolutions. Retain readable word-level diff; use TDD for the reported mixed-word regression without changing original/current text or evidence coordinates.

### Settings, search and navigation

Settings save by section with local dirty/saving/saved/error feedback. The lead configures new HPO annotation defaults per project; present/patient/current are examples, not forced values. Never overwrite carried-over values. Presets remain unconfirmed until chosen/confirmed. Warning with conscious acknowledgement is default submission policy; the lead can require confirmation. Warning acceptance does not confirm clinical values.

Personal search preferences persist across texts: multilingual on/off, preferred languages and optional automatic document-language activation. Ad-hoc overrides are temporary. Explicitly disabled automation remains disabled. Official translated matches share canonical IDs; show English preferred name plus matched translation. UI language is independent.

Use a searchable project selector, current-project sections and a secondary technical key. Different-account login goes to that person's tasks; same-user recovery preserves work and legitimate fresh-tab deep links remain valid. Text viewer returns directly with filters where available. Comparison selectors align above their panes; metadata groups source/translation/review.

## Review Focus

1. A two-part external URN plus hash can parse as a different valid URN: inventory lookup before parser acceptance (Task 1).
2. Correction/restart must not leak other people's work or resurrect abandoned annotations after reload (Tasks 10–11).
3. Save, final selection and export can race: bind exact persisted identities and reject/re-present stale state (Tasks 5/12).
4. Language grouping must preserve independent roots, exact historical assignments and missing/unauthorized metadata (Task 7).
5. Immutable Unresolved proposals must not be replaced/confirmed silently to satisfy mandatory default checking (Tasks 4/8).

## Proposed workflow records and contract checkpoint

These are proposed boundaries, not existing APIs. Persist project ownership, authorization and audit using reviewed Alembic migrations and regenerated contracts/client.

| Record | Required identity and behavior |
| --- | --- |
| WorkRound | Stable ID, exact document/task/person, kind (ordinary, carry-forward, clean restart, consolidation), frozen input submission IDs, predecessor and state. Distinguish restart from old workspace across reload/retry. |
| ProblemReport | ID, reporter, exact task/document/round and optional submission, reason, state and resolution history; task-wide hold remains separate from immutable content. |
| FinalSelection | Project + case/logical text + language; exact document/submission IDs, revision, lead and audit history. One active selection per key; compare-and-set updates. |
| ReviewObligation | Exact cause/subject refs, pending/resolved state, actor and resolution. Resolving one source change cannot clear unrelated causes. |
| WorkflowWarning | Stable code, text/language/task/selection refs, cause revision, reason and authorized destination. Shared server projection, not duplicate dashboard/export state. |
| ExportSelectionSnapshot | Exact selected pairs, disclosed missing selections, acknowledged warning identities/revisions and requester. Freeze/revalidate at job creation. |

Before Tasks 10–12, finalize these contracts against `domain/workspace.py`, `assignments/service.py`, storage tables/repository and exchange formats. Round identity affects workspace lookup, existing immutable formats and migration compatibility; do not merely add an unreviewed optional field. Define T1 representation of consolidated results explicitly rather than falsely exporting them as individual work.

### Checkpoint deliverable and acceptance criteria

The workflow owner writes one bounded contract addendum before production code: record identities, state/permission transitions, API payloads, migration/format compatibility and T1 examples. Review it against the criteria below. This is design work within Tasks 10–12, not a claim that their contracts are already resolved. Do not expand the initial provenance repair to implement future workflows.

Cross-cutting implementation requirement for Tasks 7/10–12: every new public Repository method needs the matching `authz/scoped.py` authorization wrapper; preserve `tests/test_project_scope.py::test_no_public_method_escapes_the_scope`. Migrations grant only required `APP_ROLE` privileges and register genuinely immutable tables/triggers consistently with `APPEND_ONLY_TABLES`; mutable workflow state is not automatically append-only. Run `tests/test_project_scope.py` and `tests/test_schema.py` with the affected package and exercise migrations using the application role, not owner-only fixtures.

| Contract | Required decisions and executable acceptance criteria |
| --- | --- |
| Round identity and assignment relationship | Choose how round identity enters workspace/draft/origin keys without changing old keys or aliasing distinct independent rounds. Decide whether assignment is a container or rounds require separate assignments; submitting one active round must not silently submit another. Cover `uq_assignments_active`, `active_for`, `_workspace_aliases`, strict payload parsing, `latest_submissions`, document status projections and legacy export. Server resolves and authorizes exact round; stale client keys cannot create/reopen superseded work. Migration preserves existing immutable payloads, history and import/export continuation. |
| Hold/restart concurrency | Define state transitions for editable and submitted tasks, resume, corrected-text continuation, abandonment and clean restart. Define actor and idempotency per transition. Apply guards to existing editing/submission/translation-review routes, not just new endpoints. Serialize hold/restart with save/submit; two-session tests prove no new write after hold takes effect and no stale receipt/client response replaces the current round. Read access and historical receipts remain intact. Resume of a held submitted task restores read-only submitted state unless explicitly reopened. |
| Private carry-forward | Decide mode, creation authority/trigger, exact source submission from the active non-abandoned round, skipped-version mapping and review requirements for unchanged/changed anchors. Keep ordinary annotator permissions; no accidental adjudicator requirement. Freeze inputs; no hidden newest-result fallback. Resolve inputs privately across open/adopt/review/submit/export/version listing. If proposal storage is reused, every reader must enforce visibility. Negative tests cover Anna/Ben isolation, assisted layers, version listings and export authority. |
| Consolidation | Lead chooses frozen submissions on the exact same document/text hash; other versions require explicit prior carry-forward. Inputs and output retain exact contributor/provenance identity, including identical annotation IDs from different submissions. Server owns target resolution. Preserve existing configurable separation-of-duty policy; do not introduce a blanket new reviewer exclusion. Distinguish WorkRound from existing proposal target-set rounds in routes and labels. |
| Human-input provenance | Extend Task 1's exact inventory only in Tasks 10/12 with frozen human input snapshots and their owning submission/set IDs. Update open, adoption, decision validation, submit and export consistently. Define T1 references and evidence closure when source sets are outside final selection, output ID collision handling and consolidated set semantics. Validate carry-forward→submit→export and consolidation→submit→export, including Unresolved decisions and notes. |
| Source-change obligations | Cover original corrections arriving through uploads/imports/CLI as well as interactive services, using inventory-derived causes or transactionally complete producers. Resolution binds exact old/new source and translation. Show the reviewed new source in the obligation flow while retaining original historical lineage. Define both relationships in T1. Closing one obligation cannot clear a later source change. |
| Export job boundary | At job creation, compare the acknowledged selection/warning revisions with current authorized state in the same transaction, rejecting stale state for renewed acknowledgement. Persist an immutable ExportSelectionSnapshot and bind the worker to it; never reselect live latest results. Preserve worker/download authorization. Define source closure, audit receipt and disclosed omissions. Keep legacy all-individual/CLI mode distinct; final CLI mode, if exposed, must use the same preflight protocol. |

### User actions, destinations and owners

These are additions to existing views, not a requirement for more top-level screens. Every destination rechecks authorization and exact identities; a dashboard link alone does not implement its resolving action.

| Action | Surface and task owner | Exact context / authority |
| --- | --- | --- |
| Inspect submission history | Text tree/version detail, Task 7 | Lead-authorized submission summary/detail API; own history for annotators. No broad proposal-read permission reused for human submissions. |
| Start consolidation | Selected version's results section, Task 10 | Lead selects input submission IDs and eligible reviewer; server freezes inputs and returns round ID. |
| Open/resume carry-forward or consolidation | Task list → TaskEditor, Task 10 | Authorized assignment + round ID; kind and frozen inputs visible, distinct from ordinary proposal review. |
| Request another translation correction | Version detail deliberate action, Task 10 | Lead, exact accepted translation; explicit single-task path, preserving language/role/stale-parent checks. Bulk distribution remains unchanged. |
| Confirm no translation change / correct translation | Translation-review view opened from obligation, Task 10 | Assigned reviewer, exact obligation and source-update IDs; inspect current reviewed source, then explicit resolution. |
| Report and hold | Editable/read-only task view, Task 11 | Task owner, exact task/round and optional submission; preserve unsaved recovery on failure. |
| Resolve report, extend hold, agree restart | Lead report detail within version/task detail, Task 11 | Lead sees report; explicit affected task IDs and resolution. Other assignees see a lead-authored reason, not private reporter content. Restart creates/opens new round after recorded agreement. |
| Select final result / resolve warnings | Version results and project dashboard, Task 12 | Lead chooses exact document/submission per language; warning links open the authorized action above. |

## Execution topology and ownership

Fourteen packages reflect the expanded scope: 1–9 correctness/UI/configuration, 10–12 new workflow, 13 representative HPO, 14 integration. Start export correctness first. Settings, navigation and dataset preparation can proceed independently when execution is authorized.

- One owner integrates CaseScreen/TaskEditor across Tasks 2–5/8–11; one owns shell/documents/viewers across 6–7 and their 10–12 entry points. Shared settings changes run 2→8; tree/history precedes final selection (7→12). No competing whole-file rewrites.
- Finalize workflow contracts before 10–12; serialize shared schema/repository work. Task 12 consumes reports, rounds and obligations.
- Suggested sequence: `1 → 2–5`, `6 → 7`, `8–9`, contract checkpoint `→ 10 → 11 → 12`; `13` prepares separately; all feed `14`.
- If parallel execution is later chosen, at most three workers with disjoint ownership. Heavy runners stay serial: Vitest two workers, Playwright one.
- Each package uses meaningful red→green tests, focused verification and review. Full gate after integration; further reruns require changes/failures. Batch visual checks once, fix together, confirm once. Any commit steps below apply only under subsequent publication authorization, never to this planning/review round; no per-interaction commits.

## Shared frontend boundaries

Keep persistence in existing services/CaseScreen; extract only cohesive touched presenters. FindingSummary consumes an annotation snapshot, active AxisDefinition array, resolved term label, selected state and callback. Shared `axisValueLabel(axis: AxisDefinition, value: string | null): string` gives consistent radio/select/list labels and generic/no-axis/many-option behavior. Axis definitions come from API data, not a nonexistent context.

Group authorized VariantSummary data by case/language, preserving separate translation identities. Correction edges require correction origin, identical case/external_id/language and exact preceding version. Translation edges stay source relationships. Missing/invalid metadata never hides records or guesses ancestry. Highlight explicit final selections, not latest/accepted heuristics; exact-document routes remain exact.


## Task 1: Repair T1 export provenance and prove a downloadable result

**Findings:** F30. **Files:** modify `src/ontocurator/exchange/t1.py`, `frontend/src/admin/ExportPage.tsx`, only if necessary `src/ontocurator/storage/repository.py` and `src/ontocurator/exchange/jobs.py`; tests `tests/test_t1_mapping.py`, `tests/test_t1_export.py`, `tests/test_reanchor_resolution_api.py`, `tests/test_reanchor_resolution_roundtrip.py`, `tests/test_progress_export_api.py`, `frontend/tests/exportPage.test.tsx`.

**Interfaces:** consumes `submission_to_unit`'s existing exact proposal snapshot inventory and frozen submission annotations. Produces valid T1 provenance through the existing export job/download interface; internal `annotation_id:version` references remain unchanged in storage and reanchor checks. This package covers existing proposal/adoption sources only. Tasks 10/12 own the later human-input resolver and set-aware export references; they must not reuse `_proposal_ref` for human submission sources.

- [ ] Add a regression reproducing recreated seizure → confirm Experiencer → re-resolve latest snapshot → submit → actual bundle validation and download. In the same submission include Hypotonia as Unresolved with its reviewer note and defaulted Experiencer; assert exact exported `source_refs`, `review_resolution.note`, unchanged clinical values and `basis: defaulted`. Replace the existing raw-internal-reference expectation. Update direct mapper fixtures in `test_t1_mapping.py`, `test_reanchor_resolution_api.py` and `test_reanchor_resolution_roundtrip.py` to pass the real `repo.t1_export_content('proj').proposals` map (or an equivalent explicit exact snapshot map), not `{}` for internal-reference cases.
- [ ] Run `uv run pytest tests/test_t1_mapping.py tests/test_t1_export.py tests/test_reanchor_resolution_api.py tests/test_reanchor_resolution_roundtrip.py tests/test_progress_export_api.py -q` and confirm new failures demonstrate incorrect references or `source_ref_syntax`, not fixture setup.
- [ ] Add `_export_source_ref(source_ref: str, project: str, proposals: Mapping[tuple[str, str], AnnotationSnapshot]) -> str` in `exchange/t1.py`. **Inventory lookup precedes parser acceptance:** use `rpartition(':')`; only a 64-hex suffix AND exact `(source_id, version)` inventory hit permits `_proposal_ref(source_id, project)`. A two-component external URN plus internal hash also parses as a different valid three-component URN, so parser-first handling silently corrupts identity. For non-hits preserve syntactically valid external references; fail invalid references. A syntactically valid non-hit is intrinsically ambiguous and must not be destructively guessed from a hash-looking tail. Use frozen reanchor input identity when available to reject mismatches known to be internal. Do not rewrite stored provenance. Preserve raw internal refs for exact source-note lookup; normalize only the exported copy. The inventory already covers both reanchor and ordinary adoption sources; no wider snapshot read model is currently needed.
- [ ] Test two- and three-component external URNs plus verified hashes, a second-generation text correction, ordinary independent-mode adoption, already-valid external refs (including hash-like annotation IDs), colon-rich IDs, mismatched/unknown invalid refs and mixed references. Assert exact reference strings in addition to full validation, unchanged internal provenance and retained source notes. No normalization may follow from regex alone.
- [ ] Give export failures a concise job-associated summary and expandable raw diagnostics in `ExportPage`; keep Download exclusive to successful jobs and do not suggest changing clinical values to fix serializer errors. Current job errors are strings: use a generic summary plus raw text, never parse Python repr for a pseudo-structured message. Add `exportPage.test.tsx` assertions using existing job error data; no new error contract unless demonstrated necessary.
- [ ] Re-run the backend command and `npm --prefix frontend test -- tests/exportPage.test.tsx --maxWorkers=2 --minWorkers=1`; all pass. Review the downloaded bundle, then commit `fix: normalize verified provenance references in T1 exports`.

## Task 2: Make settings saves and term creation explicit

**Findings:** F14, F16, F18, F19. **Files:** `frontend/src/admin/ProjectSettingsPage.tsx`, `frontend/src/app/CaseScreen.tsx`, associated existing CSS; tests `frontend/tests/projectSettings.test.tsx`, `projectRulesAxes.test.tsx`, `caseScreen.test.tsx`.

**Interfaces:** existing project-settings save endpoints and term-creation command; produces visibly scoped forms without changing validation policies.

- [ ] Add interaction tests: selecting a spanless term with a required missing reason keeps that term selected; entering a reason and pressing an explicit Add annotation action creates it once. Prohibited mode still blocks it, optional mode permits no reason, duplicate handling remains explicit. Add a failed-save test that retains dirty settings and does not claim success.
- [ ] Run `npm --prefix frontend test -- tests/projectSettings.test.tsx tests/projectRulesAxes.test.tsx tests/caseScreen.test.tsx --maxWorkers=2 --minWorkers=1` and observe new retained-intent/grouping failures. Existing save/failure/discard assertions can already pass; retain them as guards.
- [ ] Improve the hierarchy of existing separate settings forms with each action inside its section. Keep existing success/failure feedback and cross-section dirty-state preservation; add a truthful unsaved indicator where absent. Preserve one-click creation for complete evidence-backed input. Only blocked creation (such as a missing spanless reason) retains the term and offers explicit Add annotation after repair. Do not require an extra click universally or create on blur. Serialize shared createPendingAnnotation edits with Task 5. Do not label the initial F18 observation a backend persistence defect.
- [ ] Re-run the focused tests and `npm --prefix frontend run typecheck`; commit the coherent form changes.

## Task 3: Give the text space and findings a consistent identity

**Findings:** F04, F05, F08, F09, F10 immediate clarity, F13, F17, F25, F27. **Files:** `frontend/src/app/CaseScreen.tsx`, `frontend/src/editor/AnnotationPanel.tsx`, proposed new `frontend/src/editor/axisLabels.ts`, optional new `frontend/src/editor/FindingSummary.tsx`, existing editor CSS; tests `caseScreen.test.tsx`, `caseResize.test.tsx`, `caseNavigation.test.tsx`, `submissionHistoryLabel.test.ts`, `dynamicAxes.test.tsx` under `frontend/tests`; `frontend/browser/sidebar.spec.ts` for actual geometry.

**Interfaces:** consumes existing annotation snapshots and saving status; produces the ordinary findings list and detail selection used by Tasks 4–5. Task 11 owns task-wide hold/restart; this package only renders actual save state.

- [ ] Add tests asserting all three labelled axes remain identifiable when Assertion is unspecified and Experiencer changes to other person. Use profile order and shared option labels; test no axes, a non-HPO axis and more than four options so radio/select/list wording agrees. History must render two submissions with distinct stored annotation notes, both different from the current draft note, plus a deliberate empty state. Keep annotation and reviewer notes distinct and render multiline text without HTML interpretation.
- [ ] Add keyboard selection and narrow-window assertions: a finding can be opened from its row, history is discoverable, and the text is not trapped between two mandatory sidebars. Save/error indicators reflect actual persistence; navigation is not presented as reset.
- [ ] Run `npm --prefix frontend test -- tests/caseScreen.test.tsx tests/caseResize.test.tsx tests/caseNavigation.test.tsx tests/submissionHistoryLabel.test.ts tests/dynamicAxes.test.tsx --maxWorkers=2 --minWorkers=1`; confirm new tests fail for their target behavior.
- [ ] Implement labelled compact finding summaries; keep compact axis symbols separate from workflow-state symbols, with full hover/focus labels and no SVG paths; use accessible text fallback until icons are selected; label spanless independently of workflow state; put default confirmation beside the affected axis with clear separation from other actions. First narrow the left list while preserving stable text geometry. Selecting a finding must not shift or resize the reading pane. Do not introduce automatic opening/closing; assess further right-side changes in a concrete view. Retain existing essential narrow-screen access without implicitly redesigning it. Promote previous submissions into a labelled history access point. Distinguish saved findings from proposal and pending-review sections using task language instead of unexplained “curated” terminology.
- [ ] Re-run focused tests and typecheck. Build, then from `frontend` run `npx playwright test browser/sidebar.spec.ts --workers=1` with narrow/desktop geometry assertions; jsdom cannot prove text width or overflow. Commit. F09 is closed as clarification through F08, not an extra storage fix.

## Task 4: Save review decisions once and explain unresolved defaults

**Findings:** F28, F29; F03 existing-default visibility. **Files:** `frontend/src/editor/ReviewActions.tsx`, `frontend/src/app/CaseScreen.tsx`, `frontend/src/editor/AnnotationPanel.tsx`; tests `frontend/tests/reviewActions.test.tsx`, `review-findings.test.tsx`, `caseScreen.test.tsx`, `decisionSemantics.test.ts`.

**Interfaces:** existing decision persistence and proposal immutability. Produces explicit draft decision forms; retains existing submitted-decision semantics and flags.

- [ ] Add tests for Unresolved → reason entry → explicit Save decision (one persistence action), missing reason, retry after failure, and switching decision while text is dirty. Explicitly test existing Confirmed → Unresolved intent → note entry → 800 ms/blur: the note must not autosave onto Confirmed. Keyboard shortcut 4 must open the same intent form. Existing saved-decision note editing remains covered.
- [ ] Add a submission-warning test for an unresolved immutable proposal with defaulted Experiencer: navigation exposes why direct confirmation is unavailable; its Unresolved decision and note remain intact. Editable findings still offer actual axis confirmation. Add the stricter require_chosen_axes case: preserve the real submission blocker and explain the rule conflict without changing the outcome or bypassing validation.
- [ ] Run `npm --prefix frontend test -- tests/reviewActions.test.tsx tests/review-findings.test.tsx tests/caseScreen.test.tsx tests/decisionSemantics.test.ts --maxWorkers=2 --minWorkers=1` and see targeted failures.
- [ ] Separate outcome selection from a clearly named save/confirm action whenever additional input is required. Use one persistence path for a draft; coordinate or remove competing note autosave for that draft. Explain advisory defaults on immutable proposals without offering a misleading confirm button or silently invoking Edit/Replace. Rewrite the existing “Reset decision and edit copy” hint so replacement is described as a separate decision with consequences.
- [ ] Re-run focused tests; commit. Task 8 owns configurable defaults and warning policy; warning acknowledgement is never clinical confirmation.

## Task 5: Make text-correction review a staged, readable workflow

**Findings:** F21–F27, F29 integration. **Files:** `frontend/src/variants/ReanchorPanel.tsx`, optional `ReanchorWorkflow.tsx`, `frontend/src/app/CaseScreen.tsx`, relevant CSS (leave the shared `frontend/src/translation/DiffView.tsx` unchanged); tests `frontend/tests/reanchorPanel.test.tsx`, `reanchorIntegration.test.tsx`, `reanchorProvenance.test.tsx`, `reanchorContext.test.tsx`, `readOnlyAnnotationView.test.tsx`, `textDiff.test.ts`, `diffView.test.tsx`; browser `frontend/browser/reanchor.spec.ts`.

**Interfaces:** consumes Task 3 selection/list and Task 4 default explanation. Uses existing recreate, save and resolve commands; final resolution uses the persisted latest annotation ID/version. Existing backend exact-version validation stays authoritative. Update the panel's current “never run another diff algorithm” comment and any guarding tests to distinguish exact server-window validation from word-level display; alignment lives in `domain/reanchor.py` and remains unchanged.

- [ ] Add an integration test: recreate on selected corrected evidence → saved ordinary finding visible → confirm a default → explicit Complete text-change review → reload remains resolved. Before completion, submission is blocked by pending review. A failed annotation save cannot resolve; retries cannot create a second replacement; editing after completion makes it pending again with a route to the result.
- [ ] Add presentation tests for the recorded Krampfanfälle/Epileptische Anfälle example, repeated text, Unicode and malformed windows. After pendingDiffParts validates server windows/opcodes, render a readable word-level diff of the exact old/new text. Existing textDiff.ts supplies a word diff; the panel currently bypasses it with server character parts. Keep backend alignment/opcodes unchanged and preserve paragraph markers. Do not replace the requested diff with Before/After-only excerpts. Do not interleave deleted and inserted character fragments into a fake readable sentence. Keep original codepoint offsets, opcodes and evidence selection unchanged; malformed data shows an unavailable-context explanation.
- [ ] Run `npm --prefix frontend test -- tests/reanchorPanel.test.tsx tests/reanchorIntegration.test.tsx tests/reanchorProvenance.test.tsx tests/reanchorContext.test.tsx tests/readOnlyAnnotationView.test.tsx tests/textDiff.test.ts tests/diffView.test.tsx --maxWorkers=2 --minWorkers=1`; verify targeted failures.
- [ ] Separate recreate from resolve in CaseScreen (currently chained), and replace the early Resolve saved finding branch with the same explicit completion path. Reuse beginReanchor existing-replacement recovery; do not build a second controller for it. Route completion through flushAnnotationNotes and the existing mutation queue, which reads the latest snapshot when resolve executes. After reload, persisted state can distinguish saved-but-unlinked result from no result; it cannot reliably distinguish never-linked from stale because editing deletes invalid resolution rows. Use truthful copy for those two states and explain that later changes require completion again. A failed save cannot resolve; retries select/recover the existing replacement.
- [ ] Keep selection instructions visible until selection/cancel; focus the next required action rather than relying on a two-second highlight. Put dismiss behind its own reason form. Collapse completed rows into a count/history group and link directly to the ordinary finding. Preserve a separate route to inspect original evidence.
- [ ] Re-run focused tests and `uv run pytest tests/test_reanchor_resolutions.py tests/test_reanchor_resolution_api.py -q`; run the existing browser scenario plus the new scenario with `npm --prefix frontend run build`, then from `frontend`: `npx playwright test browser/reanchor.spec.ts --workers=1`. Commit after review.

## Task 6: Clarify project context and account transitions

**Findings:** F01, F06 immediate guidance, F12 navigation, F20, F33. **Files:** `frontend/src/app/Shell.tsx`, `frontend/src/ui/AppShell.tsx`, `frontend/src/App.tsx`, `frontend/src/app/AuthGate.tsx`, `frontend/src/app/router.ts`, `frontend/src/variants/CaseViewer.tsx`; tests `frontend/tests/shell.test.tsx`, `ui/appShell.test.tsx`, `variantRoutes.test.ts`, `caseNavigation.test.tsx`, `session.test.tsx`, `adminApp.test.tsx`, `translationTaskApp.test.tsx`.

**Interfaces:** existing authorized project list and route types. Produces one active project context and a safe post-login landing route. Exact document/task routes remain shareable subject to authorization.

- [ ] Add tests with many manageable projects: navigation shows only current-project sections, switching projects changes context without leaking unauthorized projects. Label project name and technical key separately. After an actual identity change, clear stale task selection and land on My tasks; a fresh-tab login with no prior identity retains its permitted deep link, and same-user session-expiry recovery retains draft/route. Add cross-tab identity-change coverage. Keep the last authenticated username in a ref surviving explicit logout; adopt(user, null) currently loses that distinction.
- [ ] Run `npm --prefix frontend test -- tests/shell.test.tsx tests/ui/appShell.test.tsx tests/variantRoutes.test.ts tests/caseNavigation.test.tsx tests/session.test.tsx tests/adminApp.test.tsx tests/translationTaskApp.test.tsx --maxWorkers=2 --minWorkers=1` and confirm target failures.
- [ ] Implement a searchable compact accessible project selector using explicit project-route context, otherwise the current authorized task project, otherwise an explicit in-memory choice for this user and stable project navigation. Task routes obtain their project from existing authorized task metadata; no first-project fallback or cross-user persistence. Add a direct Documents/back path from Case view, with a safe fallback for direct links. Label the demo's project/key meaning through context, not by renaming persisted project identities. Clarify submitted/read-only and existing lead reopen. Task 11 supplies actual in-app report/hold behavior; do not invent an external contact or pretend notification.
- [ ] Re-run tests and typecheck; commit. F20 remains a routing issue: the protocol found no unauthorized content exposure.

## Task 7: Logical-text tree and consistent comparison

**Findings:** F07/F11/F12/F31/F32. **Files:** new `frontend/src/variants/documentTree.ts`; existing `admin/DocumentsPage.tsx`, `admin/assignmentUI.tsx`, `variants/CaseViewer.tsx`, `ComparePane.tsx`, `VariantSelectors.tsx`, `versionState.ts` under `frontend/src`; existing tests plus new `frontend/tests/documentTree.test.ts`.

**Interfaces:** authorized case/variant inventory and exact document/task/submission refs → case/language/version/result tree. Task 12 adds exact final-selection decoration; do not invent selections meanwhile.

**Backend addition:** own the authorized submission-history read model here, using storage/submission access and proposed `api/submission_history_routes.py` plus generated clients. Return immutable submission IDs, round context when available, author label, time and authorized detail destination. Existing `visible_annotation_versions` supplies only own history/proposals and is insufficient for the lead. New `tests/test_submission_history_api.py` must prove lead access, cross-project denial, own-history retention and no access to another annotator's submission through ordinary reviewer/proposal permission. Do not duplicate a broader read model in Task 12.

**Task-level history access:** coordinate Task 3's Submissions entry with `TaskEditor.tsx`, `variants/useVersionAccess.ts` and `useCaseVersions.ts`. Their current project-role affordance must not hide an annotator's authorized own history. Test an annotator-only account opening its own prior submissions. Do not grant project-wide browsing or fetch an unrestricted case tree merely to show own history; any comparison remains bounded by server-authorized text/version inventory.

- [ ] Write red tests: GSC17 once, two languages, independent same-language translations, correction chains, separate submission histories; annotation-only resubmission creates no text version. Include missing parent, cycles, unauthorized metadata and non-correction imported v2.
- [ ] Test historical-only filter matches, loading/error fallback, exact assignments, keyboard expansion and filter-preserving return. Select-all uses explicit visible filtered document IDs, never contextual group headers. Expansion does not grant access or assignment rights.
- [ ] Implement the hierarchy and distinct translation-review/annotation/submission actions. Keep source links inspectable; do not parse ID suffixes. Preserve exact routes and accepted-first legacy viewer default where no explicit result is selected. Distinguish final selection from newest revision.
- [ ] Align comparison controls over their panes; group source/translation/review metadata with technical disclosure. Preserve failed checks, coupled scrolling and unavailable versions.
- [ ] Run `uv run pytest tests/test_submission_history_api.py -q` and generated contract checks; tree tests use real API-shaped histories, not invented client-only records.
- [ ] Run `npm --prefix frontend test -- tests/documentTree.test.ts tests/documentsPage.test.tsx tests/documentAssignmentsApp.test.tsx tests/caseViewer.test.tsx tests/variantSelectors.test.tsx tests/versionState.test.ts tests/comparePane.test.tsx tests/caseVersions.test.tsx --maxWorkers=2 --minWorkers=1`, then typecheck. Browser geometry is covered in Task 14.

## Task 8: Project creation defaults and submission policy

**Findings:** F03/F25/F29. **Files:** `src/ontocurator/domain/project_rules.py`, `application/editing.py`, `application/submissions.py`, project-settings persistence/API owners; `frontend/src/admin/ProjectSettingsPage.tsx`, `editor/AnnotationPanel.tsx`, `app/CaseScreen.tsx`; existing project-rule/settings/axis tests.

**Interfaces:** project defaults keyed by layer/type/axis and warning/required policy; retain axes_defaulted provenance. Reuse require_chosen_axes where consistent instead of introducing conflicting flags. Warning is the default; migration must not silently downgrade existing strict projects.

- [ ] Define the creation command distinction between omitted/defaulted axes and deliberate choices. Apply configured omitted-axis values server-side with `axes_defaulted`; prefilled client values alone are not proof of confirmation. Explicit confirmation clears only the chosen marker, even when the value equals the preset. Test create→save→submit→T1 preserves `basis: defaulted` until actual confirmation. Do not change unrelated project policy defaults.
- [ ] Bind warning acknowledgement to draft revision and policy revision, validate server-side and record it in the existing audit/event path without silently changing immutable submission format. Decide strict treatment of unset axes without presets in the contract below; preserve existing strict validation until that decision is explicit.

- [ ] Test lead-only configuration, invalid/hidden/profile-mismatched values, unset/configured defaults and generic profiles. Only new creation uses defaults; carried-over/imported/existing snapshots stay unchanged. Confirmation clears only deliberately selected markers.
- [ ] Test warning acknowledgement permits submission with default basis retained; strict mode blocks until actual confirmation. Changed policy/defaulted annotations invalidate stale acknowledgement. Acknowledgement never invokes clinical confirmation.
- [ ] Preserve immutable Unresolved source values/decision. Resolve the mandatory-source-confirmation contract below before extending behavior; no silent Edit/Replace, source mutation or validation bypass.
- [ ] Implement section-owned configuration plus server validation/serialization; migrate safely and regenerate actual API contracts.
- [ ] Run `uv run pytest tests/test_project_settings_validation.py tests/test_project_rules.py tests/test_project_rules_integration.py -q` and `npm --prefix frontend test -- tests/projectRulesAxes.test.tsx tests/dynamicAxes.test.tsx tests/caseScreen.test.tsx --maxWorkers=2 --minWorkers=1`; add focused tests for the new acknowledgement contract.

## Task 9: Persistent personal multilingual search preferences

**Finding:** F02. **Files:** `src/ontocurator/application/preferences.py`, `auth/preferences.py`, existing preferences API; `frontend/src/editor/searchLanguages.ts`, `SearchPanel.tsx`, `frontend/src/me/ProfilePage.tsx`, CaseScreen language binding. Tests: `tests/test_preferences_api.py`, `frontend/tests/searchLanguages.test.tsx`, `searchPanel.test.tsx`, `profilePage.test.tsx`.

**Interfaces:** durable user multilingual enablement/preferred languages/document-language automation, separate from temporary per-text overrides. Canonical English remains available; translated search uses actually loaded compatible translations.

- [ ] Test disable survives next document/login, automation uses available document language only, ad-hoc toggles do not overwrite durable choices, and stale responses/account changes cannot leak preferences.
- [ ] Test unavailable languages retain saved preference without false availability; canonical IDs, preferred labels and matched translation remain clear. Preference save errors are visible/retryable.
- [ ] Extend existing preference store/API and personal settings. Current code treats an absent stored list as all loaded languages and persists each toggle; replace deliberately with a documented compatibility rule, not accidental preference loss.
- [ ] Run `uv run pytest tests/test_preferences_api.py tests/test_search_translations.py tests/test_translation_files.py -q` and `npm --prefix frontend test -- tests/searchLanguages.test.tsx tests/searchPanel.test.tsx tests/profilePage.test.tsx --maxWorkers=2 --minWorkers=1`, typecheck and API drift checks.

## Task 10: Exact-input work rounds, carry-forward and consolidation

**Scope:** scenario requirements extending F07/F26. **Files:** proposed `src/ontocurator/domain/work_rounds.py`, `application/work_rounds.py`, `api/work_round_routes.py`; existing workspaces/submissions/reviews, `exchange/reanchor_job.py`, `application/translation_reviews.py`, `assignments/eligibility.py`, storage tables/repository/migrations and generated clients. New `tests/test_work_rounds.py`, `tests/test_work_rounds_api.py`; existing reanchor/translation/scientific-review suites.

**Interfaces:** exact immutable input submissions and source/target texts → distinct authorized WorkRound, frozen review inputs/provenance and immutable output. Ordinary proposal review and explicit consolidation remain distinguishable.

**Additional owners/files:** Task 10 owns the action table's frontend flows in version detail, `frontend/src/tasks/TaskEditor.tsx`, translation-review views and `frontend/src/admin/assignmentUI.tsx`/`AssignDialog.tsx`. Add `frontend/tests/workRoundActions.test.tsx`; preserve bulk distribution behavior. Source-obligation coverage includes `exchange/uploads.py` and imported variant inventory, not only `application/translation_reviews.py`. Implement the checkpoint's round-input resolver throughout open/adopt/decide/submit/export, including uncertain-target validation.

- [ ] Complete the contract checkpoint before production code: round-creation idempotency, target-set identity, snapshot collisions, provenance/evidence mapping, participant permissions and old workspace/submission format compatibility.
- [ ] Add red integration scenarios: Anna/Ben v1 submissions → corrected v2 → two private carry-forward rounds. Neither sees the other's work. Unchanged anchors remain starting proposals requiring text review; changed evidence/cues need explicit treatment. No clinical confirmation follows merely from unchanged coordinates.
- [ ] Test lead-started consolidation of explicit submissions: reviewer sees only selected inputs, distinguishes identical terms with different evidence, submits a separate result, and leaves originals intact. Reopening own output differs from starting a round with changed input submissions.
- [ ] Implement human-result carry-forward explicitly: current reanchor_sources intentionally excludes individual submissions. Reuse mapping without globally exposing members' work as public proposal sets. Cross-language transfer stays excluded.
- [ ] Enable repeated correction of accepted corrected translations through the deliberate UI action and normal assignment API, not SQL-only fixtures. Update the accepted-status frontend eligibility gate only for that explicit path. Keep bulk distribution restrictions, stale-parent rejection and linear ancestry. Test accepted v2→assigned correction→v3 through the UI/API, including current `next_status` effects on historical access and pinned selections. Source changes create exact ReviewObligations; no-change confirmation records the reviewed source update without relinking historical ancestry.
- [ ] Test lead selection of consolidation inputs→reviewer opens exact new round and source obligation→no-change confirmation via real APIs. Run `npm --prefix frontend test -- tests/workRoundActions.test.tsx --maxWorkers=2 --minWorkers=1`, typecheck and contract checks before Task 14's browser journeys.
- [ ] Run `uv run pytest tests/test_work_rounds.py tests/test_work_rounds_api.py tests/test_reanchor_job.py tests/test_translation_review_service.py tests/test_scientific_review_integrity.py -q`. Verify migration compatibility; add a real-API browser journey in Task 14.

## Task 11: Problem reports, whole-task hold and clean restart

**Findings:** F06/F10 plus scenarios. **Files:** proposed `src/ontocurator/domain/problem_reports.py`, `application/problem_reports.py`, `api/problem_report_routes.py`; Task 10 round service, assignments/authorization/storage; new `frontend/src/tasks/ProblemReportForm.tsx`, existing editable/read-only task entry points. New `tests/test_problem_reports.py`, `tests/test_problem_reports_api.py`, `frontend/tests/problemReports.test.tsx`.

**Interfaces:** exact task/round/document and optional submitted result → report/hold with preserved work. Lead-agreed restart produces an empty new round, not destructive reset. These states feed Task 12 warnings.

**Lead surface:** proposed `frontend/src/admin/ProblemReportDetail.tsx`, mounted in version/task detail and linked from Task 12. Own report resolution, explicit hold extension and recorded restart agreement here. Recipients of extended holds receive a lead-authored reason without the original private report. Implement the checkpoint transition table across assignment status/filter/count projections, TaskEditor, MyTasks and existing mutation guards; do not assume adding a report endpoint enforces a hold.

**Separate translation path:** include `frontend/src/translation/TranslationReviewScreen.tsx`, `api/translation_review_routes.py` and `application/translation_reviews.py` explicitly in hold coverage; these saves/submissions do not pass through annotation-edit guards. Provide the task-owner report action there when that task is in scope, and test extended holds rejecting both translation save and submit. This does not grant new reporting authority to arbitrary viewers.

- [ ] Test reporting before/after submission, whole personal-task hold, lead visibility and deliberate extension to other affected tasks. Submitted content stays unchanged. Failed save/flush cannot silently discard input; retain local recovery and show failure.
- [ ] Test resume, corrected-text continuation and lead-approved restart separately. Restart has no old annotations/proposals/decisions, remains empty after reload, retries do not duplicate it, history remains, and abandoned work never becomes automatic current-result fallback. An explicitly selected older result stays selected with warning until the lead changes it.
- [ ] Define authorized transitions/idempotency with reason, actor and exact refs. Make reporting reachable in submitted and editable states. No email/Slack integration or assertion that restarting repairs the underlying system defect.
- [ ] Add two-session save/submit-versus-hold/restart tests, including old command receipts and stale UI responses. Lead action tests cover resolution, extension, agreement and opening the new empty round; closing a report alone neither confirms clinical values nor changes final selection.
- [ ] Run `uv run pytest tests/test_problem_reports.py tests/test_problem_reports_api.py tests/test_work_rounds.py -q` and `npm --prefix frontend test -- tests/problemReports.test.tsx tests/caseScreen.test.tsx --maxWorkers=2 --minWorkers=1`; add report-after-submit/restart journeys in Task 14.

## Task 12: Final selection, dashboard warnings and deliberate export

**Scope:** per-language final selection/dashboard, extending F06/F07/F30. **Files:** proposed `src/ontocurator/domain/final_results.py`, `application/final_results.py`, `application/workflow_warnings.py`, `api/final_result_routes.py`; storage/migrations, `exchange/jobs.py`/mapping; new `frontend/src/admin/ProjectDashboardPage.tsx`, selection UI in tree/detail, `admin/ExportPage.tsx`. New `tests/test_final_results.py`, `tests/test_workflow_warnings.py`, `tests/test_final_export.py`, `frontend/tests/projectDashboard.test.tsx`, `finalSelection.test.tsx`.

**Interfaces:** FinalSelection pins exact document/submission per project/case/language. One server warning projection feeds both dashboard/export. ExportSelectionSnapshot freezes the acknowledged selection/warning/omission state.

- [ ] Test lead-only compatible exact selection, coexistence across languages, deliberate replacement within one language and audited history. No selection inferred from newest/accepted/newly submitted results. Later changes cause review need rather than reassignment.
- [ ] Test reports, corrections, translation-source updates and missing-selection warnings share IDs/reasons in dashboard/export. Resolve only the relevant cause; closing a report does not automatically select its replacement result.
- [ ] Test override exports warned selected results; missing-selection override explicitly discloses omissions; no fallback to latest or all-individual mode. Invalid T1, unavailable immutable records and unauthorized data remain errors. At job creation reject stale preflight revisions for renewed acknowledgement, then atomically freeze accepted selections/warnings/omissions. Worker reads that snapshot only; test a later selection change while the job waits. Preserve live authorization checks without substituting live content.
- [ ] Extend request validation in `api/project_routes.py` and job payload validation in `exchange/jobs.py` to reference the persisted snapshot; add shared preflight projection/API. Keep legacy CLI export explicitly all-individual unless a final-mode client implements the same protocol. Test human-input provenance closure and consolidated T1 representation from the reviewed checkpoint, not just Task 1's proposal mapping.
- [ ] Implement dashboard entries with text/language/reason/action and explicit selection in the tree. Final export offers return or conscious continue. Preserve any retained research/all-individual export as a clearly separate mode, not a silent semantic change.
- [ ] Review consolidated-result T1 representation and export audit receipt before production code. Run `uv run pytest tests/test_final_results.py tests/test_workflow_warnings.py tests/test_final_export.py tests/test_t1_export.py -q` and `npm --prefix frontend test -- tests/projectDashboard.test.tsx tests/finalSelection.test.tsx tests/exportPage.test.tsx --maxWorkers=2 --minWorkers=1`, plus generated contract checks.

## Task 13: Representative isolated full-HPO candidate

**Finding:** F02; F15 deferred. **Files:** `scripts/seed_t5_acceptance.py`, `examples/t5-acceptance/` preparation docs, existing ingestion tools; `tests/test_seed_t5_acceptance.py`, `test_translation_files.py`, `test_search_translations.py`.

- [ ] Verify an exact full HPO release/hash and compatible official translations using primary sources at execution time. Document available languages; do not invent absent translations.
- [ ] Use a separate manifest/input set, regenerating profile and synthetic bundle against the full pin/real HPO IDs. Do not reuse excerpt-pinned demo.zip. Support the separate manifest without relaxing original four-file fixture validation; wire Babelon ingestion explicitly.
- [ ] Keep fixtures small/offline and prove alias→canonical-ID identity. Run `uv run pytest tests/test_seed_t5_acceptance.py tests/test_translation_files.py tests/test_search_translations.py -q` around the changes.
- [ ] Prepare a separate private directory/Compose project/port. Record term counts, pins, searches and responsiveness. Preserve existing demo. Do not commit credentials/full ontology or claim manual acceptance before Task 14.

## Task 14: Integrated acceptance and handoff

**Files:** existing browser reanchor/translation-review/variants/decision-semantics/sidebar suites and focused new workflow scenarios. Use disposable fixtures, never the user's demo/database.

- [ ] Run `bash scripts/check.sh` serially: static, frontend, backend, browser. Check generated contracts/catalogs and schema upgrades. Resolve focused failures first; repeat the full gate only for justified integration changes.
- [ ] Verify one complete journey: multilingual search → presets → warning/strict submission → history/reopen → corrected text → private carry-forward → staged review → optional consolidation → lead selection per language → report/hold/restart → dashboard/preflight warnings → conscious export and full T1 validation.
- [ ] Explicitly cover original remaining checks: historical notes, prohibited creation, optional submission, clearing a note, read-only translation-review coupled scroll and narrow/wide restoration, second-reviewer queue, Dismiss, deletion/clinical edits after completion, failed translation checks. Record passed/blocked/deferred; do not infer manual success from old tests.
- [ ] Batch visual checks at 1440/1024/768/720/390 CSS pixels, applicable 320px reflow, 200% zoom and keyboard. Check stable text geometry, narrow list, accessible no-SVG symbols, long labels, paired comparison, tree filters and warnings. Preserve ≥12px functional type, contrast and non-color cues. One fix batch plus one confirmation pass.
- [ ] Record tested revision, candidate, schema/API changes, artifact contents and limitations in one acceptance report. User acceptance, commit/push, deployment and merge need their applicable authorization; this planning discussion grants none.

## Remaining contract details and small visual examples

The main product decisions above are settled. Resolve these details before their dependent implementation without reopening the full interview:

1. **Immutable defaults in strict mode:** preserve Unresolved; define reviewer-owned confirmation metadata/export meaning or explicitly expose the rule conflict. Also decide required-policy treatment of axes without presets. Do not create a clinical replacement merely to clear a warning. Task 8's server defaults and acknowledgement criteria are mandatory regardless of that choice.
2. **Round identity/migration and consolidated export:** produce the bounded addendum against every checkpoint row above, including assignment cardinality, hold transitions, carry-forward mode/trigger/source and exact human-input provenance. Review before Tasks 10–12; the initial no-migration assumption no longer applies.
3. **Initial search preferences:** persistent scope/overrides are settled; choose a documented first-use default and migration of existing per-annotator lists. Missing translations need truthful availability.
4. **Warning scope:** define which later changes affect a selection, expected text/language coverage for missing-selection warnings, and a completely empty export. Unrelated branches should not indefinitely warn on everything. New causes invalidate old acknowledgements.
5. **Symbols:** compare a few non-SVG examples for actual axis values/states, including unspecified/defaulted, before selecting assets. Do not invent a backend taxonomy to fill icon positions.

## Complete finding disposition

| Finding | Owner / decision |
| --- | --- |
| F01 | Task 6, active project identity |
| F02 | Tasks 9/13, all available official aliases and personal search preferences |
| F03 | Task 8, lead presets and warning-default policy |
| F04 | Task 3, narrower left list and stable text geometry |
| F05 | Task 3, discoverable immutable submissions |
| F06 | Task 11, actual report/hold/lead-handling workflow |
| F07 | Tasks 7/10/12, logical text/language tree, rounds and selection |
| F08 | Task 3, compact labelled/symbol axis summary |
| F09 | Clarified through F08; no invented persistence bug |
| F10 | Tasks 3/11, saving clarity and lead-agreed clean round |
| F11 | Task 7, distinct review/tasks/submission roles |
| F12 | Tasks 6/7, return path and viewer context |
| F13 | Task 3, actual historical annotation notes |
| F14 | Task 2, structured settings |
| F15 | Deferred; preserve generic profiles |
| F16 | Task 2, retained term and explicit repair continuation |
| F17 | Task 3, spanless distinct from workflow state |
| F18 | Clarified unsaved setting; Task 2 |
| F19 | Task 2, section saves/status |
| F20 | Task 6, account change versus same-user recovery |
| F21 | Task 5, staged pending-review presentation |
| F22 | Task 5, readable word diff and TDD; no Before/After-only replacement |
| F23 | Task 5, persistent selection guidance |
| F24 | Task 5, completed history and ordinary result |
| F25 | Tasks 3/8, explicit named confirmation |
| F26 | Task 5, latest persisted snapshot, later invalidation retained |
| F27 | Tasks 3/5, semantic row selection/result identity |
| F28 | Task 4, explicit decision save and autosave race |
| F29 | Tasks 4/8, immutable Unresolved/default distinction |
| F30 | Task 1, provenance correctness; Task 12, selected-result export |
| F31 | Task 7, aligned comparison controls |
| F32 | Task 7, source/translation/review grouping |
| F33 | Task 6, searchable selector/current navigation |

## Review and verification status

The [original Opus/high review](../reviews/2026-10-18-acceptance-opus-plan-review.md), actual model claude-opus-5-5, remains evidence for the code/initial plan it inspected. Preserve inventory-first provenance, complete mapper test inventory, observable reanchor states, exact ancestry predicates, auth recovery, generic labels and matching HPO input pins. The user's later diff choice supersedes the review's Before/After proposal while retaining offset/scroll safeguards.

The expanded consolidation received [Codex, Opus and Argon reviews](../reviews/2026-10-18-acceptance-consolidated-review-summary.md), followed by a [second independent Codex/Argon review and verified dispositions](../reviews/2026-10-18-acceptance-revised-review-summary.md). This revision incorporates verified findings and excludes incorrect Argon references and unapproved policy changes. The follow-up summary records the reviewed hash and subsequent narrow clarifications. No application tests or code changes occurred during planning. Verify links, F01–F33 coverage, package references, confirmed decisions and whitespace; the still-open contract addendum is not approved by a plan review.
