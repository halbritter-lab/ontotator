# Tasks 6–7 navigation and version surfaces

Tasks 6–7 implementation complete for this owner. No commits and no demo/runtime changes.

## Decisions

- Use the approved plan and confirmed protocol decisions as the UI brief; preserve Direction C and shared controls.
- Current project priority is explicit project route, authorized opened-task metadata, then an explicit in-memory choice scoped to the current username. No first-project or cross-user fallback.
- Reuse TaskEditor's existing authorized metadata response through an optional callback instead of duplicating the request in App.
- Preserve Documents return filters as named query fields scoped to the current project; arbitrary return URLs are ignored.
- Build hierarchy only from authorized case metadata and explicit filtered document IDs. Correction origin and same-case/language metadata establish ancestry; imported non-correction v2 remains an independent root. Contextual ancestors confer no selection or assignment rights.
- Existing CaseScreen own immutable `view.submissions` history stays the task entry; the new API history component serves lead/all and own history in Documents and CaseViewer without reusing proposal-browsing permissions.

## Changes

- Searchable native project selector, secondary technical key, and current-project-only sections. Opened task metadata feeds the shell through TaskEditor's existing authorized request.
- AuthGate remembers the last username through logout; different-account and cross-tab account changes land on My tasks. Same-user recovery preserves the mounted editor, route and queued work; fresh-tab deep links remain valid.
- Logical-text → language → independent version roots → correction ancestry. Contextual ancestors remain unselectable. Missing/cyclic/foreign metadata stays unavailable, and failed/loading inventory retains the filtered flat list fallback.
- Per-document assignment controls retain exact assignment identities. Translation reviews and submission history have distinct labels. Filtered Documents return state is encoded in scoped route fields.
- Read-only immutable submission list/detail component uses the parent-supplied authorized history API, exposes timestamps/authors/modes, historical annotations and notes, and separates review reasons. Data is discarded on account/document replacement and requests run only after explicit entry.
- Viewer language/version/result controls now share the comparison's first grid row above their respective texts. Source, translation and review metadata are grouped; technical identities and failed/inherited checks remain inspectable.

## Verification

- Initial focused red run: 10 failed / 33 passed plus expected missing tree module. Missing selector, return route, tree and comparison control placement reproduced.
- First implementation run: shell, tree, Documents, viewer, route suites 43 passing; 3 new account tests exposed fixture username/display-name mismatch, corrected before final retest.
- History/metadata red run reproduced missing history component, metadata grouping and keyboard toggle behavior; subsequent account/history/viewer/Documents/session batch passed all 40 tests.
- Final 17-file Task6–7 regression batch: 155 passed, 2 stale expectations failed (old all-project region label and different-account unassigned-task landing). Updated those expectations to the confirmed behavior; focused rerun of adminApp/translationTaskApp/accountNavigation passed all 23 tests. The other 15 suites passed in the broad batch.
- `npm --prefix frontend run typecheck`: exit 0.
- `npm --prefix frontend run api:check`: exit 0; OpenAPI and generated types in sync.
- `git diff --check` for owned files: exit 0.
- Existing React act warnings remain in editor/session regression fixtures; no test failure was suppressed.

## Integration follow-up

- Browser geometry and final visual inspection remain Task14 integration work, as assigned by parent.
- Task12 will decorate exact final selections; this change invents no selected result or latest-submission replacement.
- Submitted task guidance and the live task's own immutable history remain with the editor owner; Task11 supplies report/hold behavior.

## Task12 frontend integration addendum

- Shared authorized projection hook uses the project-scoped `ontotator:final-selection-changed` event. Successful explicit selection invalidates mounted Documents/viewer/dashboard projections. Root owns export-panel invalidation.
- The tree decorates only the exact selected document/submission and discloses a selected text outside the active filters. Version detail shows the pinned submission and links to another selected text without automatically changing the reader's current text or annotation snapshot.
- The selector never chooses the newest timestamp. It verifies the selected row remains in this document's authorized history, sends exact immutable IDs and the current slot's CAS revision, and requires an explicit reload plus fresh choice after a stale/error response. In-flight guards prevent duplicate writes; replaced component identities discard stale results.
- Dashboard tests cover server-projected text/language/reason, exact issue destination, explicit missing-selection omission, empty/error recovery and project replacement. Both dashboard and export continue consuming the same server warning schema.
- Focused red: four expected failures across new event/removed-history and decoration checks. Green:31 tests across finalResultSelector/projectDashboard/Documents/CaseViewer/SubmissionHistory.
- Typecheck at this checkpoint has only in-progress required workflow_revision additions in TaskEditor/shared old test fixtures; owned final-selection production files have no reported errors.
- Next: lead consolidation launch in submission history (agreed with editor; owner task actions remain separate), then supplied translation correction/obligation entry points. No translation endpoint is invented while backend contracts are pending.


## Task10 lead launch and translation obligations addendum

- Submission history now offers a deliberate consolidation launch for leads: at least two exact immutable inputs from the current document, an explicit authorized reviewer, optional reason, and missing-language confirmation. It reuses or deliberately creates a review assignment, then starts a consolidation round with its workflow revision and a stable request ID per intent. Refused stale inputs or unfinished work stay visible; no timestamp replacement, implicit latest result, or final selection mutation occurs. Editor owns ordinary/carry/restart actions separately.
- Accepted translation leaves, including previously corrected accepted translations, offer a separate correction-review assignment from Documents and the exact viewer. Reviewer and reason are required; exact text hash and reading-language confirmation are passed to the dedicated API. Missing lineage blocks assignment rather than guessing. Native text has no translation-correction action. The server remains authoritative for current leaf, role, active assignment and language rules.
- Translation reviews display authorized pending source-update causes. Each explicit source-update dialog shows original source, updated source and current translation, plus exact identity details. Its deliberate submit flushes the draft and uses its saved revision with the immutable cause translation pin and both exact source hashes. Both accepted-unchanged and accepted-corrected paths use the atomic resolve endpoint; ordinary review submit remains separate. A refusal retains the same cause, dialog and current draft. Success uses the existing immutable review/read-only outcome and refreshes pending causes.
- TranslationReviewScreen exposes an optional reportActions slot in its existing header tools for the editor owner's Task11 integration.
- Shared Assignment/TaskSummary test fixtures include required workflow_revision:0 and held:false from the newly generated contracts. The TaskEditor owner handles its production fallback.
- Focused red tests reproduced missing correction action and source-update review UI. Initial green:7/7 across leadConsolidation, translationCorrection and sourceObligationReview. Additional corrected-draft/hash-pin and missing-language/native cases plus Documents duplicate-key correction:18/18 across those three suites and Documents, with no duplicate-key warning.
- Broader regression:70/70 across translationReview, translationTaskApp, Documents, CaseViewer, finalResultSelector, projectDashboard and SubmissionHistory. All Vitest runs used maxWorkers=2/minWorkers=1 and runner ownership was coordinated with editor.
- Last typecheck reported only the editor-owned TaskEditor fallback missing workflow_revision/held; every owned production surface and aligned fixture typechecked. git diff --check exit0 (repository line-ending notices only).
- Browser verification of these newly integrated workflows and final consolidated build remain the parent's Task14 gate. No commit, candidate build/start or existing demo modification was performed.


## Task14 integrated disposable browser evidence

- Added `frontend/browser/final-workflow.spec.ts` with two real-backend journeys. Existing fixture route gains opt-in workflow/source_update flags; default fixtures remain unchanged. Each run uses the existing disposable Playwright PostgreSQL/server harness and its exact run-label teardown, with fresh ordinary-role accounts and real T1 imports.
- Green source-update journey: imported native source v1 plus exact corrected source v2, ordinary assigned translation reviewer sees both immutable source texts and current translation, deliberately chooses accepted unchanged, waits for saved draft, resolves the exact displayed cause with revision1 and all three immutable hash pins; subsequent authorized causes list is empty. This passed in two runs, including the final visual confirmation run (4.7s scenario).
- Green connected workflow: two ordinary human annotators submit independent findings on the same native text; first author explicitly carries their exact submission onto the SAME text, inspects original evidence, completes every carried-input review, and submits another immutable result. Their version API exposes only their own result while a second author's result already exists. Lead selects the two current exact human submission IDs for a separate ordinary adjudicator; adjudicator confirms both frozen proposals and submits. Lead deliberately selects that exact consolidated result, sees the selected badge, reviews final export, must acknowledge listed warnings/omissions, creates a successful final export and sees its download button. Final preflight is asserted to retain only that exact selected result and immutable history retains all four source/result IDs. Focused scenario passed36.6s; runner exit0 /1 passed53.1s including server startup.
- Coverage boundary: this is SAME-TEXT carry. Corrected-text carry in the browser remains for the candidate/manual gate; no claim of corrected-text carry is made. The browser proves successful export-job creation and download-button availability, not downloaded ZIP bytes; backend tests own exact ZIP/receipt validation.
- Harness corrections: annotation notes save on blur (no separate Save note button); own-submission history is intentionally authorized200 rather than403; consolidation kind is a visible badge rather than a heading. No product behavior was changed to satisfy these selectors.
- Bounded visual inspection at1280×720 and390×844 found source dialog's default initial focus scrolled past its introduction/labels. Added a failing focus regression, then fixed explicit introductory focus and bounded pane heights; source tests3/3 green. Final desktop/mobile confirmation shows visible labels, scrollable exact texts, and reachable deliberate action. Final export screenshots at both sizes show no horizontal overflow. Stable captures: `.superpowers/sdd/2026-10-18-acceptance-remediation/browser-integration/`.
- Problem-report lead destination registered as encoded `#/projects/{key}/problem-reports/{reportId}`. Router red→green69/69; App authority tests2/2 prove no detail mount until current project inventory loads and no mount for an ordinary nonmanager. Component is keyed by username/project/report; editor owns its action implementation.
- Disposable Vite build passed after integrated changes. Existing large-chunk advisory remains. A worker connection-close log occurred during successful fixture teardown after the final test; test and API assertions had passed and teardown targeted only its run-labeled temporary database.

## Candidate preparation readiness

- Private `candidate-runtime-preparation.json` records both intended loopback ports18190/15590 free and existing GitHub build credential availability. No credential content was printed or stored.
- Private `build_candidate_runtime.py` is ready to run ONLY with the parent's explicit base revision and frozen source digest. It refuses mismatched source/occupied ports/existing image receipt, transports the credential as a BuildKit secret from child-process environment only, labels the image with base revision+snapshot digest, records immutable image ID, verifies labels, and prepares the isolated full-HPO runtime files. It does not start/seed the candidate automatically.
- No actual candidate image build/start has occurred; awaiting the parent source freeze. Existing demo project remains untouched.
