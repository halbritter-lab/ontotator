# Phase 0: Version Access and Small Cleanups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce D16's independent-annotation version restrictions in the backend and UI, then complete B0.4's six small usability cleanups.

**Architecture:** Restrict public variant/history browsing at the existing scoped authorization boundary, using fresh project roles and qualifying assignments. Keep assigned workspaces and dedicated translation review authority separate from general version browsing. Apply small UI changes through the existing components, with no new workflow or dependency.

**Tech Stack:** FastAPI, SQLAlchemy/PostgreSQL, Python 3.11+, React 18, TypeScript, plain CSS, pytest, Vitest, Playwright.

**Spec:** `PRODUCT.md`, `DESIGN.md`, `docs/superpowers/plans/2026-10-17-next-agentic-work.md` (D16, B0.4); T5 index Q19/Q28 in `docs/superpowers/plans/2026-10-14-t3-t5-t4-index.md`.

## Global Constraints

- English UI only. Light theme only. React 18 single-page app with plain CSS and no UI library.
- No request may leave the app's origin (no CDN, no external fonts).
- Unicode codepoint offsets are exact. Every decision is explicit and traceable; nothing is decided silently.
- WCAG 2.2 AA. Functional text is at least 12 px. Full keyboard operation of the editor.
- D16: version selectors and compare only for leads and adjudicators; annotators see their task text (enforce in the backend too).
- Q19: translation review needs the annotator role and both languages. D16 must preserve the assigned translation-review source, target, draft, comparison and submission journey.
- No new dependencies, permission-by-query-parameter bypass, new clinical/domain rules or demo operations.

## Review Focus

- A hidden selector is bypassable through a copied URL or HTTP call; Task 1 covers all public text/metadata and annotation-version routes.
- Annotator-only translation reviewers need source and target access; Task 1 tests the dedicated workspace, save and submit with no adjudicator role.
- Assignment revocation/role removal after listing must invalidate subsequent payload reads; Tasks 1–2 exercise current authorization and stale UI state.
- Own historical work differs from someone else's proposals; P0-A explicitly settles its scope and Tasks 1–2 preserve the approved route without broadening proposal access.
- Long language lists and duplicate submission timestamps remain distinguishable without flags or raw IDs as primary labels; Tasks 3–4 test these conditions.

## Evidence and decision gate

D16 is an authorization change, and takes priority over the cosmetic cleanups. Current backend behavior is deliberate T5 behavior, not an unguarded proposal leak:

- `authz/visibility.py:readable_case_documents` and `require_case_text` expand any qualifying assignment to immutable same-case sibling texts (Q28).
- `authz/scoped.py:list_variants`, `get_variant`, `get_variant_text` consume those guards. `api/variant_routes.py` exposes `/cases`, `/cases/{case_id}`, `/documents/{doc}/variant` and `/documents/{doc}/text` using them.
- `authz/versions.py:visible_annotation_versions` offers an exact assignee their own submission history. `may_read_proposals` separately requires lead/admin authority or a qualifying `review` assignment. `ScopedRepository.get_annotation_version` rechecks exact offered refs before returning payload. Preserve this guard; do not call its replacement from internal assisted-work proposal metadata.
- `application/translation_reviews.py:TranslationReviewService.open` authorizes a `translation_review` assignment and directly builds source, target and comparisons; it must continue doing so for a bilingual annotator. `assignments/service.py` maps both independent and assisted workspace modes to task `annotate`; a public read cannot infer which mode is open merely from the task name.
- Existing `tests/test_case_api.py` explicitly permits Q28 sibling texts, and `tests/test_annotation_versions.py` explicitly permits own refs. Some assertions must change for D16; do not preserve them accidentally or remove them without replacement tests.

### P0-A: Own previous submissions during independent annotation

The newer D16 decision supersedes Q28's blanket sibling-text allowance during independent annotation. It does **not** revoke Q19. The only pending product question here is the master plan's P0-A: **Can independent annotators still read their own previous submissions?** Recommendation: yes, through own-history access while restricting general version browsing/comparison. Interim acceptance step 5 explicitly requires own-history inspection. Record the user's answer in the master plan and apply it consistently to assigned-workspace history and any exact own-ref API needed by that surface; do not silently remove history or retain a generic browser as a workaround.

The following are existing technical constraints, not additional approval questions:

- Preserve administrative access and the existing union of mixed project roles. Lead/adjudicator browse affordances do not grant adjudicators all project documents; their existing assignment-based visibility and exact proposal checks remain in force. Admin working modes still need their project task role and assignment.
- Apply D16 to independent annotation without changing authority for other assigned tasks. Independent and assisted modes share the `annotate` task vocabulary; scope any mode-specific exception to verified server workspace/assignment context. Internal assisted proposal inputs remain exact and authorized. A client-supplied `assignment` or mode hint cannot elevate authority.
- Preserve every qualifying assigned text, including when a user has multiple assignments. Unrelated cases and projects remain inaccessible.
- Translation-review source, target and comparisons remain scoped to the existing authorized review assignment and its resolved inputs, whether provided by the dedicated workspace or an existing direct read. Do not turn this into blanket sibling browsing or deny required review inputs merely because the assignee has only the annotator role.

P0-A gates only own-history decisions and their dependent assertions. The decided independent browsing restriction and unrelated ready work can proceed. The small cleanups must not be reported as completion of B0.4 while D16 remains unimplemented.

## Sequencing and files

Follow `2026-10-17-phase0-priorities.md`: B0.1, then B0.2 Task 1, then this plan's access Tasks 1–2, followed by D3/D2 and re-anchor correctness work; this plan's cosmetic Tasks 3–4 follow at P0.7. Preserve B0.1's `editing` prop and reading-only coupling gate. Rebase shared CaseScreen/ReviewActions/ComparePane edits in that order; do not run separate agents on these files concurrently. Implementation of decided functions is already authorized; do not ask again for routine execution.

- Modify `src/ontocurator/authz/policy.py`, `visibility.py`, `versions.py`, `scoped.py`: browsing permission, bounded assigned text projection and exact version guards.
- Inspect/modify `src/ontocurator/api/variant_routes.py` only where route-level responses need the policy; preserve existing contracts and task-scoped authorization.
- Test `tests/test_case_api.py`, `tests/test_annotation_versions.py`, `tests/test_visibility.py`, `tests/test_translation_review_task.py`, `tests/test_translation_review_context.py`.
- Create `frontend/src/variants/useVersionAccess.ts`; modify `tasks/TaskEditor.tsx`, `app/CaseScreen.tsx`, `variants/CaseViewer.tsx`, `variants/useCaseVersions.ts` for capability-gated fetching/rendering.
- Modify `frontend/src/editor/ReviewActions.tsx`, `editor/SearchLanguageButton.tsx`, `admin/ProgressPage.tsx`, `admin/HiddenAxisValuesField.tsx`, `styles/screens/editor.css` for cleanups.
- Modify relevant frontend tests listed in each task and browser specs `variants.spec.ts`, `compare.spec.ts`, `workflow.spec.ts`, `admin.spec.ts`, `translation-review.spec.ts`.

### Task 1: Authorize public browsing without breaking assigned work

**Interfaces:** Add `Action.BROWSE_VERSIONS = "browse_versions"` in `authz/policy.py` for lead/adjudicator roles and existing administrative access, preserving role unions. Use `can(current_access(...), Action.BROWSE_VERSIONS, key)` inside existing guard signatures; do not trust cached `Access.roles`. Keep `readable_case_documents(...) -> DocumentFilter`, `require_case_text(...) -> None`, `visible_annotation_versions(..., assignment: int | None = None) -> list[VersionRef]` and scoped repository signatures. Resolve task-specific text exceptions from current authorized assignment/workspace context; they do not imply general browsing permission. Retain `require_proposals` as the additional exact proposal guard. P0-A controls only the own-history branch.

- [ ] Record a role/task/endpoint matrix preserving existing administration, mixed-role unions and other assigned tasks, with only own-history marked pending P0-A. Translate decided cells into parametrized API tests; continue those cells while the own-history answer is pending. When P0-A arrives, add its exact own-history assertions before implementing that branch.
- [ ] In `tests/test_case_api.py`, replace Q28 blanket-sibling assertions for the restricted user with: lists include assigned texts only; source assignment does not expose unassigned target/correction metadata or text; assigned text/variant reads remain 200; a second qualifying assignment exposes its own text; unrelated case/project and encoded opaque IDs remain safe. Retain bounded metadata-only query assertions and the no-new-draft assertion.
- [ ] In `tests/test_annotation_versions.py`, add `test_restricted_annotator_cannot_browse_versions_or_fetch_known_ref` for approved P0-A semantics, trying list, guessed own ID, foreign own ID, known proposal ID, encoded opaque ID and a foreign/revoked assignment hint. Denied payloads return existing 404 `VERSION_NOT_FOUND`; text/metadata denials use 404 `DOCUMENT_NOT_FOUND`, absent cases 404 `CASE_NOT_FOUND`. For list denial, use an empty offered-ref list for a readable assigned text; do not leak a ref then fail only its payload.
- [ ] Add tests for lead, assigned adjudicator, mixed-role user and admin according to the recorded matrix. Adjudicator role alone must not bypass existing case visibility or exact proposal guards. Test a role removal/revocation between ref listing and fetch; submitted but nonrevoked assignments retain their approved own-work behavior.
- [ ] Add translation-review regression in `tests/test_translation_review_task.py`: a qualified bilingual user with only annotator role opens a real review assignment, receives exact source/target/comparison text, edits/saves and submits with existing validation; revoked assignment or removed annotator role denies reopening. Preserve `test_internal_assisted_metadata_stays_exact_while_public_annotate_refs_are_blind` and ordinary assigned annotation reads.
- [ ] Run `.venv/Scripts/python.exe -m pytest tests/test_case_api.py tests/test_annotation_versions.py tests/test_translation_review_task.py tests/test_translation_review_context.py -q`; expect new D16 tests to fail on current behavior. Docker/test PostgreSQL is required; no dependency installation.
- [ ] Implement fresh-role browsing checks and exact assigned-text filtering in the named authorization files. Apply the independent annotation restriction consistently to case lists/detail, variant metadata, immutable text and annotation versions, preserving other assigned tasks. Preserve `TranslationReviewService.open`'s assignment-scoped input construction and workspace own-history behavior selected in P0-A. Resolve direct review input IDs from the same authorized lineage/comparison context, never all siblings by default.
- [ ] Run `.venv/Scripts/python.exe -m pytest tests/test_case_api.py tests/test_annotation_versions.py tests/test_visibility.py tests/test_translation_review_task.py tests/test_translation_review_context.py -q`; expect PASS. Review changed old tests one by one against the matrix; no existing ownership/proposal check may disappear without a narrower replacement.

### Task 2: Hide restricted version controls and disclose permitted versions

**Interfaces:** Create `useVersionAccess(projectKey: string, username: string): { allowed: boolean; loading: boolean; error: unknown; retry: () => void }` in `variants/useVersionAccess.ts`. Consume existing `api.listProjects(): Promise<ProjectSummary[]>`, whose actual fields are `roles`, `allowed_modes`, `can_manage` (there is no `rights` field). Derive general browse affordance from existing administration/role-union behavior: `can_manage || roles.includes('lead') || roles.includes('adjudicator')`; task-specific authorized inputs remain distinct. This is UI affordance only; Task 1 remains authoritative. Add required `canBrowseVersions: boolean` to `CaseScreenProps.versionContext`; TaskEditor supplies it. Extend `useCaseVersions` to skip and invalidate general-browser state when that value is false, preserving other task-specific flows.

- [ ] Add failing cases in `frontend/tests/caseVersions.test.tsx`, `caseViewer.test.tsx`, `assignmentEditor.test.tsx`: restricted task opens its assigned text without version-list/compare requests or controls; explicit own-history behavior matches P0-A; allowed role exposes a collapsed `Versions` disclosure containing Language/Text version/Annotations; old/deep-linked forbidden versions cannot display stale text/annotations. Use two users and two projects to prove identity changes clear cached access.
- [ ] Add `frontend/tests/useVersionAccess.test.tsx`: loading/failure denies affordances; retry can recover; project roles do not cross projects; role/admin combinations preserve the existing union and administrative policy. Run `npm --prefix frontend test -- tests/useVersionAccess.test.tsx tests/caseVersions.test.tsx tests/caseViewer.test.tsx tests/assignmentEditor.test.tsx`; expect FAIL before implementation.
- [ ] Implement the hook and callers. Keep permitted selectors inside native `<details><summary>Versions</summary>…</details>` in CaseScreen and CaseViewer, collapsed initially. Restricted task has no disclosure or Compare button. The CaseViewer restricted assigned-text path may show that exact text and Open my task, but cannot fetch general annotation-version refs or expose selection/comparison. A forbidden deep link shows the existing unavailable message with no prior identity's payload. Reset selected version/comparison when access is lost, and disable controls during pending permission checks.
- [ ] Preserve existing task navigation and save-before-leave behavior. Close comparison safely and restore focus to a remaining control when permissions change. Preserve B0.1's effective reading-only coupling restriction. Keep the dedicated TranslationReviewScreen source/target interface available to its annotator assignee.
- [ ] Run `npm --prefix frontend test -- tests/useVersionAccess.test.tsx tests/caseVersions.test.tsx tests/caseViewer.test.tsx tests/assignmentEditor.test.tsx tests/comparePane.test.tsx tests/translationReview.test.tsx tests/variantApp.test.tsx` and `npm --prefix frontend run typecheck`; expect PASS.

### Task 3: Remove duplicate replacement flow and clarify language selection

**Interfaces:** Keep `ReviewActionsProps` and `SearchLanguageControl` unchanged. Remove ReviewActions' manual draft-replacement selector and its private `selectedReplacementId`, `showReplacementSelect`, `handleConfirmChanged` machinery if no longer used; retain `onAdoptAndEdit`, `onEditReplacement`, current decision rendering and decision notes. Search language button continues always searching English, showing English first, then active languages, at most three visible codes plus `+n`.

- [ ] Add failing assertions in `frontend/tests/reviewActions.test.tsx`: “Assign replacement from draft...” and “Confirm replacement” are absent; Edit & Replace/continue-edit still invokes the correct callbacks and retains an existing changed decision/note. Add cases in `frontend/tests/searchLanguages.test.tsx`: visible uppercase `EN DE ES +1`, no flag images, menu lists each language code once, EN checked and disabled, toggles and Escape focus restoration unchanged.
- [ ] Run `npm --prefix frontend test -- tests/reviewActions.test.tsx tests/searchLanguages.test.tsx`; expect FAIL for new assertions.
- [ ] Remove only the duplicate manual replacement UI and unused private code in `editor/ReviewActions.tsx`. Replace `Flag` rendering in `editor/SearchLanguageButton.tsx` with text codes in trigger/menu, use shared `Button` with native ref/aria attributes, and preserve `data-language` selectors on code spans. Update `.lang-code`/button CSS where needed for 12 px minimum and wrapping. Do not remove bundled flag assets unless repository-wide search proves no remaining consumer; deleting unused assets is not required.
- [ ] Run `npm --prefix frontend test -- tests/reviewActions.test.tsx tests/searchLanguages.test.tsx tests/review-findings.test.tsx`; expect PASS.

### Task 4: Readable history and honest administrative copy

**Interfaces:** Add `submissionHistoryLabel(createdAt: string, ordinal: number): string` in new `frontend/src/editor/submissionHistoryLabel.ts`; returns `Submission {ordinal} · {formatted date/time}`, using `Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' })`, and `Submission {ordinal} · Date unavailable` for invalid input. Ordinals follow the existing displayed history order and distinguish matching timestamps. Keep submission IDs in the history dialog's secondary details for traceability, not the list's primary label.

- [ ] Add failing unit/component cases in new `frontend/tests/submissionHistoryLabel.test.ts` and existing `caseScreen.test.tsx`: readable label, duplicate timestamp rows distinct, invalid dates safe, opening a row shows its exact snapshot/ID. If P0-A removes own-history surface, omit that UI change and record the explicit decision; do not leave dead helper code.
- [ ] Add assertions in `frontend/tests/progressPage.test.tsx` that “Agreement between annotators is not shown here yet.” is absent with totals/table/filter unchanged. In `hiddenAxisValuesField.test.tsx`, assert visible explanation: “Hiding a value removes it from new selections; it does not rewrite existing annotations. An annotation using a hidden value must be updated before it can be saved or submitted.” This reflects `domain/axis_visibility.py`, `domain/project_rules.py` and `tests/test_project_rules.py::test_hidden_axis_values_are_violations_in_the_correct_layer`; existing unavailable values remain visible in AnnotationPanel. Keep default-value disabling and current selection/validation semantics unchanged.
- [ ] Run `npm --prefix frontend test -- tests/submissionHistoryLabel.test.ts tests/caseScreen.test.tsx tests/progressPage.test.tsx tests/hiddenAxisValuesField.test.tsx`; expect new assertions FAIL.
- [ ] Apply the label helper to CaseScreen's own Previous submissions if retained, retain exact ID inside historical details, remove Progress's placeholder paragraph, and add the lead-facing hidden-axis explanation to `admin/HiddenAxisValuesField.tsx` (already used in project settings). Do not invent an agreement number or new axis policy.
- [ ] Run `npm --prefix frontend test -- tests/submissionHistoryLabel.test.ts tests/caseScreen.test.tsx tests/progressPage.test.tsx tests/hiddenAxisValuesField.test.tsx tests/projectSettings.test.tsx tests/projectRulesAxes.test.tsx` and `npm --prefix frontend run typecheck`; expect PASS.

### Task 5: Verify complete authorized browser journeys

**Interfaces:** Reuse synthetic fixtures in `tests/browser_server.py` and existing browser helpers; only extend fixture roles/assignments when required for matrix coverage. Use lead/adjudicator accounts for B0.1/general browser scenarios, annotator-only accounts for assigned work and translation review.

- [ ] Add restricted annotator browser scenario to `frontend/browser/variants.spec.ts`: open assigned task, no Versions/Compare controls, annotate/save/submit, inspect own history exactly as P0-A decides, then try known sibling and annotation-version URLs by direct HTTP request and deep link. Assert Task 1 denial codes, no hidden payload in rendered UI, and assigned text still accessible.
- [ ] Update `frontend/browser/compare.spec.ts` for collapsed Versions and permitted-role fixtures; open the disclosure by keyboard, select a version and compare, and retain B0.1's opt-in/warning/no-feedback assertions. Exercise 1024 px and 700 px so the disclosure does not crowd the reading surface.
- [ ] In `frontend/browser/translation-review.spec.ts`, run the source/target edit-save-submit journey as an annotator-only bilingual assignee. General version restrictions must not prevent review input display or successful submission.
- [ ] In `frontend/browser/workflow.spec.ts`, verify Edit & Replace remains the one replacement path and code-based language selection remains keyboard accessible. In `frontend/browser/admin.spec.ts`, verify no Progress placeholder and the hidden-axis explanation in settings.
- [ ] Run `npm --prefix frontend run test:e2e -- browser/variants.spec.ts browser/compare.spec.ts browser/workflow.spec.ts browser/admin.spec.ts browser/translation-review.spec.ts`; expect PASS with no unauthorized payloads or console errors. Run selected backend tests from Task 1 after any backend follow-up fixes.
- [ ] Review access matrix coverage before cosmetic completion. At eventual integration run `bash scripts/check.sh` once for combined Phase 0 changes and record its evidence. Do not run full tests or acceptance demo operations as part of writing this plan.

## Acceptance

D16 is enforced by backend checks across metadata, immutable text and annotation-version reads, with approved exceptions captured explicitly. Independent annotators can still read their assigned task texts and complete their tasks; bilingual annotator-only translation reviewers retain their authorized source/target review journey. P0-A's own-history choice is tested rather than silently assumed. Allowed users get a collapsed Versions disclosure, language codes replace flags, duplicate manual replacement is gone, history is readable, and administrative copy accurately describes available behavior.
