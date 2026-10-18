# Acceptance remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended for the independent work packages below) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make the HPO annotation and review journey understandable and reliably exportable, addressing the recorded acceptance findings without changing clinical decisions implicitly.

**Architecture:** Retain the existing APIs, immutable annotation snapshots, exact-version assignments and reanchor validation. Organize the interface around a project, logical documents and their versions, with the clinical text primary inside a task. Separate pending review work from resulting findings and fix exchange serialization at its boundary.

**Tech Stack:** Python/FastAPI, existing PostgreSQL repository, React 18/TypeScript/plain CSS, pytest, Vitest and Playwright.

**Spec:** [Full acceptance protocol](../reviews/2026-10-18-phase0-manual-acceptance.md), [Sol 6.1 repository analysis](../reviews/2026-10-18-acceptance-sol61-analysis.md), [Impeccable protocol analysis](../reviews/2026-10-18-acceptance-impeccable-analysis.md), repository `PRODUCT.md` and `DESIGN.md`. The protocol is evidence; the design choices below are recommendations for implementation, not retroactive user approval.

## Global Constraints

- Planning branch: `feat/phase0-acceptance-plan`. This document does not authorize application implementation or a merge into main.
- Preserve the live demo, its volumes, credentials, user submissions and both saved runtime directories. All new manual acceptance uses a separate disposable candidate; never reseed or rebuild the current demo.
- React 18 single-page app with plain CSS and no UI library; English UI only; light theme only. Preserve local fonts and no requests outside the app origin.
- Ontologies, documents and annotations are pinned and hashed; Unicode codepoint offsets are exact. Presentation changes must not alter stored evidence or immutable snapshots.
- Preserve role isolation, independent annotation, unresolved decisions, explicit confirmation and exact-version review invalidation. Defaults are not confirmed values.
- HPO first. German official labels are search aliases, not a German UI requirement. Additional ontology workflows are deferred.
- No per-interaction documentation commits. Use one coherent commit per reviewed work package, then one consolidated acceptance record.

## Review Focus

1. Recreated provenance containing colon-rich external IDs, unknown hashes or already-valid external references: normalize only proven internal references (Task 1).
2. Two unrelated document lineages sharing case/language, filtered historical assignments and unauthorized versions: group safely without retargeting tasks (Task 7).
3. Autosave failure or a last-moment axis confirmation before completing reanchor review: resolve only the persisted latest snapshot (Task 5).
4. Narrow windows, long translated labels, keyboard-only use and zoom: text remains usable and controls discoverable (Tasks 3, 6, 7, 9).
5. An unresolved immutable proposal retaining defaulted axes: explain the warning without replacing its decision or claiming confirmation (Tasks 4, 5, 9).

## Proposed product direction and explicit boundaries

The working hierarchy is **Project → Case → logical text/translation lineage → text version → tasks/results/history**. Cases associate source texts and translations; source and translation are not revisions of each other. The main document list shows current logical texts, with expandable exact versions and their assignments. A task always opens its assigned document ID, even when that version is historical.

The editor gives text the central space. On narrow screens the findings list and detail editor become independently opened panels, with a persistent way back to the text. A selected finding is reachable from its list row as well as its text mark. Axis labels come from the active profile, including Assertion, Experiencer and Temporality for HPO; a missing value uses the same wording everywhere. Spanless findings have a plain text label, not italics or color alone. A new icon is unnecessary for this package.

Text-correction review follows an explicit sequence: **inspect old/new evidence → select corrected text → save editable finding → inspect/confirm its attributes → complete text-change review**. Creation does not immediately resolve the item. Completed items collapse into a history summary; the resulting finding appears in the ordinary findings list. Editing a completed result still invalidates its exact-version resolution and exposes an actionable explanation.

The following extensions require product decisions and are not silently included in this first implementation:

| Gate | Recommended next decision | Immediate deliverable |
| --- | --- | --- |
| F03 new annotation defaults | Consider project/type-specific opt-in defaults, with origin badges and explicit confirmation; do not globally force present/patient/current | Keep existing policy; expose default provenance and confirmation clearly in Tasks 3–5 |
| F06 annotator correction request | Decide between an in-app request and existing lead contact; no messaging infrastructure implied | Explain submitted/read-only state and the existing lead reopen capability |
| F10 reset | Define whether reset means one finding, local unsaved form, or return to a frozen proposal baseline | Show saving/saved/error states accurately and state that leaving does not undo saved changes; no destructive global reset |
| F15 other ontologies | Request representative examples after HPO acceptance | Retain generic existing types; do not add new ontology-specific workflows |

F29 defaulted unresolved proposals retain their value and decision. The submission warning remains advisory where the existing rules allow it; it links to an explanation, not an unavailable confirmation action. If `require_chosen_axes` blocks submission, show that actual blocker and preserve the decision; do not silently bypass the rule or replace the proposal. Adding independent source-default confirmation or overriding this conflict requires a separate policy decision. Replacing a proposal remains an explicit separate clinical decision.

The overview's proposed current row means latest revision in a proven linear chain, not automatically accepted/eligible. Preserve `pickVariant`'s existing accepted-first default in the Case viewer and exact-document links; changing that policy is outside this plan. With ambiguous/branching lineage, show explicit separate rows rather than pick a canonical winner. Active project comes from an explicit project route, otherwise the resolved current task's project, otherwise an explicit in-memory project choice for that user. With no such context, show My tasks and no inferred project; do not pick the first project or persist the choice across identities. Universal explicit Add for ordinary annotation is also outside scope: preserve its efficient complete-input creation path.

## Execution topology and efficiency

There are nine independently reviewable packages. Start Task 1 first; Tasks 2 and 8 can proceed independently. Use at most three implementers, with one owner for `CaseScreen.tsx` through Tasks 3–5 and one owner for navigation/management through Tasks 6–7. Do not run competing whole-file rewrites or parallel heavy test suites.

```text
1 Export correctness ───────────────────────────────┐
2 Settings/actions → 3 Editor → 4 Decisions → 5 Review ├→ 9 Integration/acceptance
6 Navigation → 7 Documents/comparison ───────────────┤
8 Realistic HPO candidate ───────────────────────────┘
```

Task 2's settings work is independent; its `CaseScreen` form integration must precede Task 3. Task 4 owns `ReviewActions.tsx` and Task 5 owns `ReanchorPanel.tsx`; their parent integration is serialized. Task 8 must use a separate worktree/runtime while code changes are in flight. Review each package's focused tests, then run the complete gate once after integration. Use one batched visual review and one confirmation pass, with further passes only for concrete failures.

## File responsibilities and interfaces

Existing backend mapping remains in `src/ontocurator/exchange/t1.py`; export orchestration remains in `exchange/jobs.py`; storage changes are conditional on demonstrated missing provenance inventory. No schema migration is planned.

Existing editor orchestration remains in `frontend/src/app/CaseScreen.tsx`. Extract only the touched presentation units if needed: `frontend/src/editor/FindingSummary.tsx` for labelled axes and spanless/default markers, and `frontend/src/variants/ReanchorWorkflow.tsx` for staged review controls. Neither owns persistence. Continue using the existing API client types and commands; do not invent a parallel annotation model.

Create `frontend/src/variants/documentLineages.ts` as a pure authorized-metadata grouping helper. Its exported `groupDocumentLineages(variants: readonly VariantSummary[]): DocumentLineage[]` uses `VariantSummary` from `api/client`; `DocumentLineage` is `{ key: string; currentDocumentId: string; documentIds: string[]; language: string }`. Join only when the child has `origin === 'correction'` and its explicit parent has identical `case_id`, `external_id`, `language`, and `parent.version === child.version - 1`, matching `domain/variants.py`. Translation edges and imported non-correction revisions stay separate even when external IDs match. Missing/inaccessible parents, cycles, invalid edges or branching ambiguity fall back to separate identifiable groups. Order valid-chain IDs by version ascending and use the last as current; use the root document ID as the view key. Consumers retain full original records by ID.

The planned `FindingSummary` props are `{ annotation: AnnotationSnapshot['annotation']; axes: readonly AxisDefinition[]; termLabel: string; selected: boolean; onSelect: () => void }`, importing `AnnotationSnapshot` from `api/client` and using `components['schemas']['AxisDefinition']` from `api/generated` for `AxisDefinition`. The caller supplies labels from the existing term lookup and active type profile; no axis-label React context exists. Create a small shared `frontend/src/editor/axisLabels.ts` helper `axisValueLabel(axis: AxisDefinition, value: string | null): string`, preserving the existing HPO label vocabulary, the common unspecified wording, and raw-value fallback for generic options. Use it in both radio and select detail controls and the list; do not hardcode three HPO axes. Default-confirmation actions remain in the detail editor.

## Task 1: Repair T1 export provenance and prove a downloadable result

**Findings:** F30. **Files:** modify `src/ontocurator/exchange/t1.py`, `frontend/src/admin/ExportPage.tsx`, only if necessary `src/ontocurator/storage/repository.py` and `src/ontocurator/exchange/jobs.py`; tests `tests/test_t1_mapping.py`, `tests/test_t1_export.py`, `tests/test_reanchor_resolution_api.py`, `tests/test_reanchor_resolution_roundtrip.py`, `tests/test_progress_export_api.py`, `frontend/tests/exportPage.test.tsx`.

**Interfaces:** consumes `submission_to_unit`'s existing proposal inventory and frozen submission annotations. Produces valid T1 provenance through the existing export job/download interface; internal `annotation_id:version` references remain unchanged in storage and reanchor checks.

- [ ] Add a regression reproducing recreated seizure → confirm Experiencer → re-resolve latest snapshot → submit → actual bundle validation and download. In the same submission include Hypotonia as Unresolved with its reviewer note and defaulted Experiencer; assert exact exported `source_refs`, `review_resolution.note`, unchanged clinical values and `basis: defaulted`. Replace the existing raw-internal-reference expectation. Update direct mapper fixtures in `test_t1_mapping.py`, `test_reanchor_resolution_api.py` and `test_reanchor_resolution_roundtrip.py` to pass the real `repo.t1_export_content('proj').proposals` map (or an equivalent explicit exact snapshot map), not `{}` for internal-reference cases.
- [ ] Run `uv run pytest tests/test_t1_mapping.py tests/test_t1_export.py tests/test_reanchor_resolution_api.py tests/test_reanchor_resolution_roundtrip.py tests/test_progress_export_api.py -q` and confirm new failures demonstrate incorrect references or `source_ref_syntax`, not fixture setup.
- [ ] Add `_export_source_ref(source_ref: str, project: str, proposals: Mapping[tuple[str, str], AnnotationSnapshot]) -> str` in `exchange/t1.py`. **Inventory lookup precedes parser acceptance:** use `rpartition(':')`; only a 64-hex suffix AND exact `(source_id, version)` inventory hit permits `_proposal_ref(source_id, project)`. A two-component external URN plus internal hash also parses as a different valid three-component URN, so parser-first handling silently corrupts identity. For non-hits preserve syntactically valid external references; fail invalid references. A syntactically valid non-hit is intrinsically ambiguous and must not be destructively guessed from a hash-looking tail. Use frozen reanchor input identity when available to reject mismatches known to be internal. Do not rewrite stored provenance. Preserve raw internal refs for exact source-note lookup; normalize only the exported copy. The inventory already covers both reanchor and ordinary adoption sources; no wider snapshot read model is currently needed.
- [ ] Test two- and three-component external URNs plus verified hashes, a second-generation text correction, ordinary independent-mode adoption, already-valid external refs (including hash-like annotation IDs), colon-rich IDs, mismatched/unknown invalid refs and mixed references. Assert exact reference strings in addition to full validation, unchanged internal provenance and retained source notes. No normalization may follow from regex alone.
- [ ] Give export failures a concise job-associated summary and expandable raw diagnostics in `ExportPage`; keep Download exclusive to successful jobs and do not suggest changing clinical values to fix serializer errors. Add `exportPage.test.tsx` assertions using existing job error data; no new error contract unless demonstrated necessary.
- [ ] Re-run the backend command and `npm --prefix frontend test -- tests/exportPage.test.tsx --maxWorkers=2 --minWorkers=1`; all pass. Review the downloaded bundle, then commit `fix: normalize verified provenance references in T1 exports`.

## Task 2: Make settings saves and term creation explicit

**Findings:** F14, F16, F18, F19. **Files:** `frontend/src/admin/ProjectSettingsPage.tsx`, `frontend/src/app/CaseScreen.tsx`, associated existing CSS; tests `frontend/tests/projectSettings.test.tsx`, `projectRulesAxes.test.tsx`, `caseScreen.test.tsx`.

**Interfaces:** existing project-settings save endpoints and term-creation command; produces visibly scoped forms without changing validation policies.

- [ ] Add interaction tests: selecting a spanless term with a required missing reason keeps that term selected; entering a reason and pressing an explicit Add finding action creates it once. Prohibited mode still blocks it, optional mode permits no reason, duplicate handling remains explicit. Add a failed-save test that retains dirty settings and does not claim success.
- [ ] Run `npm --prefix frontend test -- tests/projectSettings.test.tsx tests/projectRulesAxes.test.tsx tests/caseScreen.test.tsx --maxWorkers=2 --minWorkers=1` and observe new retained-intent/grouping failures. Existing save/failure/discard assertions can already pass; retain them as guards.
- [ ] Improve the hierarchy of existing separate settings forms with each action inside its section. Keep existing success/failure feedback and cross-section dirty-state preservation; add a truthful unsaved indicator where absent. Preserve one-click creation for complete evidence-backed input. Only blocked creation (such as a missing spanless reason) retains the term and offers explicit Add finding after repair. Do not require an extra click universally or create on blur. Serialize shared createPendingAnnotation edits with Task 5. Do not label the initial F18 observation a backend persistence defect.
- [ ] Re-run the focused tests and `npm --prefix frontend run typecheck`; commit the coherent form changes.

## Task 3: Give the text space and findings a consistent identity

**Findings:** F04, F05, F08, F09, F10 immediate clarity, F13, F17, F25, F27. **Files:** `frontend/src/app/CaseScreen.tsx`, `frontend/src/editor/AnnotationPanel.tsx`, `axisLabels.ts`, optional `FindingSummary.tsx`, existing editor CSS; tests `caseScreen.test.tsx`, `caseResize.test.tsx`, `caseNavigation.test.tsx`, `submissionHistoryLabel.test.ts`, `dynamicAxes.test.tsx` under `frontend/tests`; `frontend/browser/sidebar.spec.ts` for actual geometry.

**Interfaces:** consumes existing annotation snapshots and saving status; produces the ordinary findings list and detail selection used by Tasks 4–5. No global reset endpoint.

- [ ] Add tests asserting all three labelled axes remain identifiable when Assertion is unspecified and Experiencer changes to other person. Use profile order and shared option labels; test no axes, a non-HPO axis and more than four options so radio/select/list wording agrees. History must render two submissions with distinct stored annotation notes, both different from the current draft note, plus a deliberate empty state. Keep annotation and reviewer notes distinct and render multiline text without HTML interpretation.
- [ ] Add keyboard selection and narrow-window assertions: a finding can be opened from its row, history is discoverable, and the text is not trapped between two mandatory sidebars. Save/error indicators reflect actual persistence; navigation is not presented as reset.
- [ ] Run `npm --prefix frontend test -- tests/caseScreen.test.tsx tests/caseResize.test.tsx tests/caseNavigation.test.tsx tests/submissionHistoryLabel.test.ts tests/dynamicAxes.test.tsx --maxWorkers=2 --minWorkers=1`; confirm new tests fail for their target behavior.
- [ ] Implement labelled compact finding summaries; label spanless findings with plain text; put default confirmation beside the affected axis with clear separation from other actions. Use the existing responsive and focus patterns to allow side panels to collapse at constrained widths. Promote previous submissions into a labelled history access point. Distinguish saved findings from proposal and pending-review sections using task language instead of unexplained “curated” terminology.
- [ ] Re-run focused tests and typecheck. Build, then from `frontend` run `npx playwright test browser/sidebar.spec.ts --workers=1` with narrow/desktop geometry assertions; jsdom cannot prove text width or overflow. Commit. F09 is closed as clarification through F08, not an extra storage fix.

## Task 4: Save review decisions once and explain unresolved defaults

**Findings:** F28, F29; F03 existing-default visibility. **Files:** `frontend/src/editor/ReviewActions.tsx`, `frontend/src/app/CaseScreen.tsx`, `frontend/src/editor/AnnotationPanel.tsx`; tests `frontend/tests/reviewActions.test.tsx`, `review-findings.test.tsx`, `caseScreen.test.tsx`, `decisionSemantics.test.ts`.

**Interfaces:** existing decision persistence and proposal immutability. Produces explicit draft decision forms; retains existing submitted-decision semantics and flags.

- [ ] Add tests for Unresolved → reason entry → explicit Save decision (one persistence action), missing reason, retry after failure, and switching decision while text is dirty. Explicitly test existing Confirmed → Unresolved intent → note entry → 800 ms/blur: the note must not autosave onto Confirmed. Keyboard shortcut 4 must open the same intent form. Existing saved-decision note editing remains covered.
- [ ] Add a submission-warning test for an unresolved immutable proposal with defaulted Experiencer: navigation exposes why direct confirmation is unavailable; its Unresolved decision and note remain intact. Editable findings still offer actual axis confirmation. Add the stricter require_chosen_axes case: preserve the real submission blocker and explain the rule conflict without changing the outcome or bypassing validation.
- [ ] Run `npm --prefix frontend test -- tests/reviewActions.test.tsx tests/review-findings.test.tsx tests/caseScreen.test.tsx tests/decisionSemantics.test.ts --maxWorkers=2 --minWorkers=1` and see targeted failures.
- [ ] Separate outcome selection from a clearly named save/confirm action whenever additional input is required. Use one persistence path for a draft; coordinate or remove competing note autosave for that draft. Explain advisory defaults on immutable proposals without offering a misleading confirm button or silently invoking Edit/Replace. Rewrite the existing “Reset decision and edit copy” hint so replacement is described as a separate decision with consequences.
- [ ] Re-run focused tests; commit. Do not introduce configurable defaults in this package.

## Task 5: Make text-correction review a staged, readable workflow

**Findings:** F21–F27, F29 integration. **Files:** `frontend/src/variants/ReanchorPanel.tsx`, optional `ReanchorWorkflow.tsx`, `frontend/src/app/CaseScreen.tsx`, relevant CSS (leave the shared `frontend/src/translation/DiffView.tsx` unchanged); tests `frontend/tests/reanchorPanel.test.tsx`, `reanchorIntegration.test.tsx`, `reanchorProvenance.test.tsx`, `reanchorContext.test.tsx`, `readOnlyAnnotationView.test.tsx`; browser `frontend/browser/reanchor.spec.ts`.

**Interfaces:** consumes Task 3 selection/list and Task 4 default explanation. Uses existing recreate, save and resolve commands; final resolution uses the persisted latest annotation ID/version. Existing backend exact-version validation stays authoritative.

- [ ] Add an integration test: recreate on selected corrected evidence → saved ordinary finding visible → confirm a default → explicit Complete text-change review → reload remains resolved. Before completion, submission is blocked by pending review. A failed annotation save cannot resolve; retries cannot create a second replacement; editing after completion makes it pending again with a route to the result.
- [ ] Add presentation tests for the recorded Krampfanfälle/Epileptische Anfälle example, repeated text, Unicode and malformed windows. Use separately labelled Before/After views showing literal old_context.text/new_context.text only after pendingDiffParts validates them. Keep shared DiffView and its coupled-scroll paragraph markers unchanged. Do not interleave deleted and inserted character fragments into a fake readable sentence. Keep original codepoint offsets, opcodes and evidence selection unchanged; malformed data shows an unavailable-context explanation.
- [ ] Run `npm --prefix frontend test -- tests/reanchorPanel.test.tsx tests/reanchorIntegration.test.tsx tests/reanchorProvenance.test.tsx tests/reanchorContext.test.tsx tests/readOnlyAnnotationView.test.tsx --maxWorkers=2 --minWorkers=1`; verify targeted failures.
- [ ] Separate recreate from resolve in CaseScreen (currently chained), and replace the early Resolve saved finding branch with the same explicit completion path. Reuse beginReanchor existing-replacement recovery; do not build a second controller for it. Route completion through flushAnnotationNotes and the existing mutation queue, which reads the latest snapshot when resolve executes. After reload, persisted state can distinguish saved-but-unlinked result from no result; it cannot reliably distinguish never-linked from stale because editing deletes invalid resolution rows. Use truthful copy for those two states and explain that later changes require completion again. A failed save cannot resolve; retries select/recover the existing replacement.
- [ ] Keep selection instructions visible until selection/cancel; focus the next required action rather than relying on a two-second highlight. Put dismiss behind its own reason form. Collapse completed rows into a count/history group and link directly to the ordinary finding. Preserve a separate route to inspect original evidence.
- [ ] Re-run focused tests and `uv run pytest tests/test_reanchor_resolutions.py tests/test_reanchor_resolution_api.py -q`; run the existing browser scenario plus the new scenario with `npm --prefix frontend run build`, then from `frontend`: `npx playwright test browser/reanchor.spec.ts --workers=1`. Commit after review.

## Task 6: Clarify project context and account transitions

**Findings:** F01, F06 immediate guidance, F12 navigation, F20, F33. **Files:** `frontend/src/app/Shell.tsx`, `frontend/src/ui/AppShell.tsx`, `frontend/src/App.tsx`, `frontend/src/app/AuthGate.tsx`, `frontend/src/app/router.ts`, `frontend/src/variants/CaseViewer.tsx`; tests `frontend/tests/shell.test.tsx`, `ui/appShell.test.tsx`, `variantRoutes.test.ts`, `caseNavigation.test.tsx`, `session.test.tsx`, `adminApp.test.tsx`, `translationTaskApp.test.tsx`.

**Interfaces:** existing authorized project list and route types. Produces one active project context and a safe post-login landing route. Exact document/task routes remain shareable subject to authorization.

- [ ] Add tests with many manageable projects: navigation shows only current-project sections, switching projects changes context without leaking unauthorized projects. Label project name and technical key separately. After an actual identity change, clear stale task selection and land on My tasks; a fresh-tab login with no prior identity retains its permitted deep link, and same-user session-expiry recovery retains draft/route. Add cross-tab identity-change coverage. Keep the last authenticated username in a ref surviving explicit logout; adopt(user, null) currently loses that distinction.
- [ ] Run `npm --prefix frontend test -- tests/shell.test.tsx tests/ui/appShell.test.tsx tests/variantRoutes.test.ts tests/caseNavigation.test.tsx tests/session.test.tsx tests/adminApp.test.tsx tests/translationTaskApp.test.tsx --maxWorkers=2 --minWorkers=1` and confirm target failures.
- [ ] Implement a compact accessible project selector using the active-project precedence defined above and stable project navigation. Task routes obtain their project from existing authorized task metadata; no first-project fallback or cross-user persistence. Add a direct Documents/back path from Case view, with a safe fallback for direct links. Label the demo's project/key meaning through context, not by renaming persisted project identities. Clarify that submitted work is read-only and a lead can reopen it; do not invent a contact address or notification.
- [ ] Re-run tests and typecheck; commit. F20 remains a routing issue: the protocol found no unauthorized content exposure.

## Task 7: Group documents, subordinate versions and align comparison controls

**Findings:** F07, F11, F12 structure, F31, F32. **Files:** create `frontend/src/variants/documentLineages.ts`; modify `frontend/src/admin/DocumentsPage.tsx`, `frontend/src/admin/assignmentUI.tsx`, `frontend/src/variants/CaseViewer.tsx`, `ComparePane.tsx`, `VariantSelectors.tsx`, `versionState.ts`, associated CSS; tests `frontend/tests/documentsPage.test.tsx`, `documentAssignmentsApp.test.tsx`, `caseViewer.test.tsx`, `variantSelectors.test.tsx`, `versionState.test.ts`, `comparePane.test.tsx`, `caseVersions.test.tsx`, new `documentLineages.test.ts`.

**Interfaces:** consumes authorized `listCases` variant metadata, document records and Task 6 navigation. Produces pure lineage groups described above; all selection/assignment API payloads continue to carry exact document IDs.

- [ ] Add grouping tests for source plus translation, corrected translation v1/v2, two independent same-language translations, missing parent, cycles, and unauthorized/missing metadata; include an imported non-correction v2 sharing external_id that must remain separate. Invalid/cyclic chains fall back to separate identifiable rows rather than hiding documents. Never infer identity from `~de~v2` strings or case/language alone.
- [ ] Add UI tests: latest version is the main row; expand reveals historical versions and exact-version assignments. A filter matching only an old version keeps its group visible, identifies that historical match, and never presents the current version as that task. While listCases is loading/failed, retain the authorized flat filtered document list with an explanation. Select all visible includes only IDs in the server-filtered listProjectDocuments rows. If current is filtered out, its contextual header is not selectable/assignable; matching historical rows are. Collapsing does not silently change selected IDs. Translation reviews and annotation tasks have distinct labels and progression.
- [ ] Run `npm --prefix frontend test -- tests/documentLineages.test.ts tests/documentsPage.test.tsx tests/documentAssignmentsApp.test.tsx tests/caseViewer.test.tsx tests/variantSelectors.test.tsx tests/versionState.test.ts tests/comparePane.test.tsx tests/caseVersions.test.tsx --maxWorkers=2 --minWorkers=1`; observe failures.
- [ ] Implement grouping using the exact correction predicate and fallback rules above. Keep latest-overview and accepted-first viewer defaults distinct; current does not imply eligible. Use explicit document links to open the displayed row. Show concise task summaries and place detailed assignee/status/history/actions in expanded content. Rename generic Reviews to Translation reviews where that is its actual destination. Align left/right comparison selectors at the same level; select a document lineage before versions where multiple lineages share a language. Group translation metadata by provenance, status and review rather than an unstructured fact list.
- [ ] Re-run tests and typecheck; verify keyboard expansion, labelled selectors and no horizontal overflow at narrow width; commit.

## Task 8: Prepare a realistic, isolated HPO acceptance candidate

**Finding:** F02; F15 deliberate defer. **Files:** inspect/extend `scripts/seed_t5_acceptance.py`, `examples/t5-acceptance/` setup documentation and existing ontology preparation utilities as necessary; tests `tests/test_seed_t5_acceptance.py`, `test_translation_files.py`, `test_search_translations.py`.

**Interfaces:** existing pinned ontology and official-translation ingestion/search APIs. Produces a separate candidate with documented HPO release/hash and compatible translation provenance; no live demo mutation.

- [ ] Prepare a separate full-HPO input set and manifest; the current profile and demo.zip pin the excerpt and cannot be reused unchanged. Regenerate profile.json and the synthetic bundle with ontospan.write_bundle against the full pin and valid real HPO IDs; update/parameterize the four-file verify_inputs contract for this separate manifest without relaxing original-fixture checks. Wire compatible Babelon translation files via the existing translations-dir or admin ingestion path, since the seed alone does not load them. Record an exact full HPO release and checksum plus compatible official label-translation source/version in candidate preparation documentation. Use primary upstream release data at execution time; do not hardcode an unverified release here. If an official compatible German label is unavailable, record that limitation and test known official aliases instead of inventing translations.
- [ ] Add small local fixtures proving English preferred labels and official translated aliases resolve to the same HPO ID and that the displayed preferred label remains clear. Keep tests offline and small; do not commit the full ontology or credentials. Run `uv run pytest tests/test_seed_t5_acceptance.py tests/test_translation_files.py tests/test_search_translations.py -q` before/after the minimal preparation changes.
- [ ] Prepare the full dataset in a new private candidate directory and distinct Compose project/port using existing preparation safeguards. Record loaded term count, release identity and representative searches, including the user's seizure query when supplied by the official translation dataset. Measure search responsiveness with this dataset; investigate concrete problems without redesigning search pre-emptively.
- [ ] Commit only setup/documentation/test changes; retain private runtime artifacts locally. No claim of full-HPO manual acceptance until Task 9.

## Task 9: Integrated acceptance, visual verification and release handoff

**Coverage:** all implemented findings; all previously untested paths remain explicit. **Files:** extend existing `frontend/browser/reanchor.spec.ts`, `translation-review.spec.ts`, `variants.spec.ts`, `decision-semantics.spec.ts` only where focused unit tests cannot prove the complete journey; one new consolidated review record under `docs/superpowers/reviews/`.

**Interfaces:** consumes Tasks 1–8, a disposable seeded candidate and the unchanged original protocol. Produces evidence of passing checks and a clear remaining-policy list, not an automatic main merge.

- [ ] Run `bash scripts/check.sh` from a configured shell at repository root. It serializes static checks, frontend tests (two workers), backend tests and browser tests (one worker). Use only disposable PostgreSQL; never set `ONTOCURATOR_TEST_PG_URL` to the user's demo. Fix failures and rerun affected stages; rerun the full gate only when cross-cutting changes justify it.
- [ ] In the new candidate, verify annotate/save/reload → submit → lead reopen → resubmit/history; translation review with corrections → reanchor/default confirmation → unresolved with note → submit → valid downloadable T1 export. Verify the failed-translation path and no unauthorized task content. Include reason-required, optional and prohibited settings with visible successful saves. Explicitly cover historical note comparison, prohibited-mode creation blocking, optional-mode submission, clearing an existing annotation note, read-only translation-review coupled scrolling and preference restoration after narrow/wide changes, a second reviewer’s independent queue, Dismiss with reason, and replacement deletion/clinical changes. Record each as passed, blocked or explicitly deferred; do not infer manual success from old automated tests.
- [ ] Perform one Impeccable-informed visual pass at desktop and half-window widths (for example 1440 and 720 CSS pixels), plus intermediate 1024/768 and narrow 390 CSS-pixel cases, applicable 320 CSS-pixel reflow, 200% zoom and keyboard navigation. Preserve existing ≥12 px functional type and non-color status/contrast requirements. Check text room, focus return, axis clarity, form grouping, project switching, historical versions, paired comparison controls and long HPO labels. Capture only synthetic examples. Do not claim a live browser audit solely from source inspection.
- [ ] Confirm official translated HPO alias search on the actual full dataset and inspect the downloaded T1 result with its validator. Record any remaining limitations, policy gates and exact tested revision in one acceptance document. User acceptance remains separate from automated checks.
- [ ] Review the complete diff for role/provenance invariants and unintended scope, then commit the consolidated record. Implementation-branch publishing, merge and deployment require the authorization applicable at execution time; the present push authorization covers planning artifacts only. Merge/deploy only when separately authorized; preserve the old candidate until the user chooses a replacement.

## Complete finding disposition

| Finding | Owner/disposition |
| --- | --- |
| F01 | Task 6, contextual project identity |
| F02 | Task 8, full HPO and official aliases |
| F03 | Tasks 3–5 existing defaults clarity; configurable creation policy gated |
| F04 | Task 3, text-first responsive workspace |
| F05 | Task 3, discoverable submission history |
| F06 | Task 6 guidance; notification/request mechanism gated |
| F07 | Task 7, logical documents and exact-version tasks |
| F08 | Task 3, labelled consistent axes |
| F09 | Clarified; no separate persistence defect, covered by F08 |
| F10 | Task 3 saving clarity; reset baseline policy gated |
| F11 | Task 7, translation-review naming and task hierarchy |
| F12 | Tasks 6–7, back path and readable Case view |
| F13 | Task 3, historical annotation notes |
| F14 | Task 2, structured settings |
| F15 | Deferred pending concrete additional-ontology examples |
| F16 | Task 2, selected term plus explicit creation form |
| F17 | Task 3, accessible spanless identification |
| F18 | Clarified unsaved settings; Task 2 prevents confusion |
| F19 | Task 2, scoped save actions and feedback |
| F20 | Task 6, identity-change routing; no security leak claimed |
| F21 | Task 5, staged pending-review panel |
| F22 | Task 5, literal labelled Before/After context |
| F23 | Task 5, persistent next-step guidance |
| F24 | Task 5, collapse completed work and expose result |
| F25 | Tasks 3 and 5, axis confirmation hierarchy |
| F26 | Task 5, latest-snapshot completion; retain invalidation |
| F27 | Tasks 3 and 5, ordinary findings and result links |
| F28 | Task 4, explicit decision form |
| F29 | Tasks 4–5, preserve unresolved decision and explain defaults |
| F30 | Task 1, validated T1 export boundary |
| F31 | Task 7, aligned comparison selectors |
| F32 | Task 7, structured translation metadata |
| F33 | Task 6, scalable current-project navigation |

## Review record

The [Claude Code Opus/high review](../reviews/2026-10-18-acceptance-opus-plan-review.md) records the original two high-priority findings, nine medium clarifications, lower-priority improvements and their disposition. Actual model: `claude-opus-5-5`, effort high. All items were incorporated into this plan, including inventory-first export normalization, exact grouping predicates, observable reanchor states and authentic account-transition recovery. No application tests or manual acceptance are claimed by this planning document.
