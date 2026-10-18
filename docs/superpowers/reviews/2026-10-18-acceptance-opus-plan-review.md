# Claude Code Opus review of the acceptance plan

Date: 2026-10-18. Requested reviewer: local Claude Code, Opus, effort **high**. CLI 2.1.296; invocation used `--model opus --effort high`. Result metadata confirms **claude-opus-5-5**, successful completion, 91 turns, 502,368 ms, no web searches. Tools were limited to Read/Glob/Grep, with safe mode, no MCP and no persisted session. No application changes or tests were performed by the reviewer.

Reviewed the initial [plan](../plans/2026-10-18-acceptance-remediation.md), [complete protocol](2026-10-18-phase0-manual-acceptance.md), [technical analysis](2026-10-18-acceptance-sol61-analysis.md), [Impeccable analysis](2026-10-18-acceptance-impeccable-analysis.md), PRODUCT/DESIGN and repository code/tests at planning base `14b5b63`. The plan now incorporates the dispositions below; the original findings are retained unchanged as review evidence. Private raw output: `build/acceptance-plan-review/result.json` (not committed).

## Coordinator disposition

| Review item | Plan revision |
| --- | --- |
| H1 | Task 1 checks exact inventory identity before parser acceptance; adds two-component URNs, second-generation correction and exact-string assertions. Syntactically valid unmatched external references remain unchanged; frozen reanchor identity can identify known internal mismatches. No hash-only stripping. |
| H2 | Task 1 includes mapping/API/roundtrip tests with real proposal inventories, independent adoption and unchanged raw-reference note lookup. |
| M1 | Task 5 uses existing replacement recovery and queued flush/resolve. Copy distinguishes only persisted observable states; no fictional stale-versus-never-linked history. |
| M2 | Exact correction predicate, imported non-correction separation, loading/error flat fallback and filtered-only selection. Overview latest differs explicitly from preserved accepted-first viewer default; ambiguous histories do not get an invented winner. |
| M3 | Explicit profile definitions/term label props, shared axis option labels, generic/no-axis/many-option tests. |
| M4 | Auth username memory across logout, same-user recovery/deep-link cases, actual session suites; explicit route/task/in-memory project precedence with no first-project default. |
| M5 | Confirmed-to-Unresolved autosave race, shortcut 4 and replacement hint explicitly covered; strict chosen-axis policy remains an honest blocker rather than an automatic replacement. |
| M6 | Separate full-HPO manifest, regenerated matching profile/bundle and explicit Babelon ingestion; preserve original fixture validation. |
| M7 | Literal validated Before/After in ReanchorPanel; shared DiffView/scroll markers unchanged, read-only consumer tested. |
| M8 | Preserve ordinary complete-input creation; explicit continuation only after blocked form; CaseScreen edits serialized. |
| M9 | Task 1 adds concise export failure summary with technical disclosure and existing job contract. |
| Low: combined export | Same submission tests recreated seizure plus unresolved Hypotonia with exact note/default basis. |
| Low: existing settings | Do not claim existing failed-save behavior must fail; new retained-intent/hierarchy behavior is the red regression. |
| Low: layout/history/icon | Browser geometry checks; two historical notes distinct from draft; plain spanless label, no new icon. |
| Low: test coverage | Adds dynamicAxes, decisionSemantics, versionState, comparePane, caseVersions and auth suites. |
| Low: manual/publishing | Names every remaining protocol check; planning push does not preauthorize application-branch publication. |

The proposed conservative defaults resolve the review's additional design gates without silently broadening scope: preserve accepted-first viewer selection, use nonpersistent explicit project context, preserve normal creation speed, and enforce actual chosen-axis rules. Changing those defaults requires a later product decision.

## Original reviewer response

# Plan review: `2026-10-18-acceptance-remediation.md`

I read the plan, the full protocol and both analyses in full, then checked the plan against the source and tests. All the test files, browser specs, `scripts/check.sh` stages, the npm scripts (`test`, `typecheck`, `build`) and the exported types the plan names (`VariantSummary`, `AnnotationSnapshot` and others in `api/client.ts`) exist as written. The defects below are about substance, not paths. Nothing was run and no files were changed.

## High

**H1 — Task 1: "keep any ref the T1 parser accepts" lets wrong refs through without an error.**
- **Plan step:** Task 1, step 3 says to keep a reference the parser already accepts before checking it against the proposal inventory.
- **Evidence:**
  - `ontospan/refs.py:41-45` accepts **2 or 3** parts, and a 64-hex hash is a valid component.
  - Many proposal IDs have only 2 parts:
    - single-`.json` imports use `bundle_id=None` (`exchange/plan.py:178,229`), which gives `urn:ontospan:<set>:<ann>`;
    - carried-over reanchor proposals are `urn:ontospan:<set>:a<n>` (`exchange/reanchor_job.py:147`).
  - Re-creating such a proposal stores `urn:ontospan:<set>:<ann>:<sha256>` (`application/editing.py:536`, same at `:763`). The parser reads that as bundle=`set`, set=`ann`, annotation=`hash`. It passes validation but names the wrong annotation.
  - This happens on a second correction of the same translation, or with any single-JSON import. Today's F30 only fails because the demo used a 3-part bundle URN.
- **Fix:**
  - Check the inventory first. Split each ref at the last colon with `rpartition(":")`. If the suffix is 64-hex and `(id, version)` is an exact key in `proposals`, emit `_proposal_ref(id, project)`.
  - Only keep a ref unchanged if it is not an inventory hit and the parser accepts it. Otherwise fail.
  - Add tests for a 2-part URN plus hash and for a second-generation reanchor. Assert the exact exported ref string; passing validation alone proves nothing here.

**H2 — Task 1's file and test list misses tests that hold the current behaviour in place and will break.**
- **Plan step:** Task 1 Files and the focused command.
- **Evidence:**
  - `tests/test_t1_mapping.py:789-814`: an independent-mode adoption copy with an internal ref, using `{}` as the proposal map. It is also the only guard for the exact source-note lookup at `exchange/t1.py:636-640`.
  - `tests/test_reanchor_resolution_api.py:195-201`: the `submit_and_export` branch, also with `{}`.
  - `tests/test_reanchor_resolution_roundtrip.py:71`: also `{}`.
  - Under "unknown refs fail clearly", all three will raise. The focused command doesn't run the first two, so the breakage only shows up in Task 9's full gate.
- **Fix:**
  - Add both files to Task 1 and its command.
  - Change these tests to pass the real map (`repo.t1_export_content("proj").proposals`). Do not weaken the rule.
  - State that note lookup keeps using the raw internal `(id, version)` refs, so normalizing must happen after `note_refs` is built.
  - The adoption path (`editing.py:761-763`) is a second legitimate writer of internal refs. Its sources are proposals only (`repository.py:1489-1521`), so the existing inventory is enough. Test it explicitly as well as the reanchor case.

## Medium

**M1 — Task 5 asks for a distinction the stored data can't support.**
- **Plan step:** Task 5 says to distinguish "missing link, stale result and deleted result" in the error text.
- **Evidence:** after every edit, `application/editing.py:388-397` deletes any resolution whose replacement version is no longer in the draft. After a reload, "stale" and "never linked" look identical.
- **Fix:** use two states: a saved result exists but isn't linked (link it now), or no result exists. The copy should say that any change to the result, including confirming a default, requires completing the review again.
- **What already works:** the queue stops on transport errors (`editor/autosave.ts:95-130`), and `resolveReanchor` builds its request when it runs (`CaseScreen.tsx:775-782`). So "resolve only the latest saved snapshot" is safe as long as Complete goes through the queue after `flushAnnotationNotes`. Require that explicitly.
- **Less work than planned:** recovering an existing replacement already works (`beginReanchor`, `CaseScreen.tsx:801-812`). The real change is removing the chained resolve at `CaseScreen.tsx:1101` and the "Resolve saved finding" branch at `:2288`.

**M2 — Task 7: the rule for joining versions is looser than the backend's, and how data is loaded isn't specified.**
- **Plan sections:** "File responsibilities" and Task 7.
- **Join rule:**
  - Use the backend's exact predicate from `domain/variants.py:55-73`: `origin == "correction"`, and the parent has the same `case_id`, `external_id` and `language`, with `version - 1`.
  - For translations, `derived_from` points to the source in another language (`variants.py:77`). It must never count as a revision edge.
  - Decide and test how to treat an imported non-correction v2 with the same `external_id`.
- **Data loading:**
  - Table rows come from the server-filtered `listProjectDocuments` (`DocumentsPage.tsx:72`).
  - Lineage comes from a separate `listCases` call (`:51-53`) that can still be loading (`null`) or fail on its own.
  - Specify a flat fallback while cases are loading or have failed.
  - Specify that "Select all visible" (`:84`) only includes IDs in the filtered rows.
  - If a group's current version is filtered out, its header must not be selectable or assignable.
- **"Current" version:** the plan makes the latest version the main row, but `pickVariant` (`versionState.ts:63-64`) prefers the accepted one. Say whether the Case viewer's default stays as it is. This is a policy gate.

**M3 — Task 3: the `FindingSummary` interface can't render labelled axes.**
- **Plan sections:** "File responsibilities" and Task 3.
- **Evidence:**
  - The props have no axis definitions.
  - The only React context in the codebase is the proposal-metadata one (`editor/ProposalSource.tsx:50`), not axis labels.
  - Axis labels come from `AxisDefinition {id, label, options, allow_empty}` (`api/generated.ts:1475`).
  - Option labels like "Other person" live in an inline map (`AnnotationPanel.tsx:229-233`) that only applies to axes with 4 or fewer options. The select path for larger axes shows raw values (`:264`). So the detail control is itself inconsistent.
- **Fix:**
  - Pass `axes: AxisDefinition[]` and `termLabel` as props.
  - Pull the option labels into one shared helper used by both the list and the detail control.
  - Phrase the tests generically: no axes, a non-HPO axis, and more than 4 options. Add `dynamicAxes.test.tsx`.

**M4 — Task 6: no way to tell an account switch from a deep link, and no defined source for the active project.**
- **Evidence:**
  - `App` is keyed by username and reads the route from `window.location.hash` (`App.tsx:42`).
  - Logout followed by login calls `adopt(user, null)` (`AuthGate.tsx:146`), which forgets who was logged in before.
  - Keeping the route for the same user after an expired session is intended (`:45-53`).
- **Fix:**
  - Keep the last authenticated username in a ref that survives logout. Reset to My tasks only when a different user logs in.
  - A fresh-tab login with no earlier user keeps the deep link.
  - The tests live in `session.test.tsx`, plus `adminApp.test.tsx` and `translationTaskApp.test.tsx`. Task 6 lists none of them.
- **Active project:** task routes only carry `assignmentId`. Define where the active project comes from: the route key, otherwise in-memory state, and never auto-select the first project.

**M5 — Task 4: name the actual race and the hint text that has to change.**
- **The race:**
  - With an existing Confirmed decision, clicking Unresolved on an empty note does nothing.
  - Typing the note then autosaves it onto **Confirmed**: after 800 ms (`ReviewActions.tsx:130-131`), or on blur (`:350`).
  - Make this an explicit test.
- **Keyboard path:** key 4 goes through `requireNote` (`:61-62`, `:120-122`) and must open the same form.
- **Hint text:** the hint at `:207` actively tells the reviewer to "Reset decision and edit copy". That's the path F29 says must not be presented as a routine fix, so the hint must be rewritten.
- **Blocker case:** `require_chosen_axes` (`domain/project_rules.py:133-144`) treats defaulted axes as violations. If unresolved targets are rule-checked at submission, as the 2026-10-17 decision-semantics plan states, the "advisory" warning becomes a blocker. State the explanation for that case, or add it as a policy gate.

**M6 — Task 8: the full HPO won't import against the existing synthetic inputs.**
- **Evidence:**
  - `profile.json:9-10` pins release `2026-06-23` and the excerpt's sha256.
  - `demo.zip` was built with `ontospan.write_bundle` (README line 7), and the import check `pin_differences` compares version and sha256 (`exchange/t1.py:260-264`).
  - `verify_inputs` hardcodes exactly four file names (`seed_t5_acceptance.py:199-211`).
  - Translations load as babelon files via `--translations-dir` or admin upload (`cli.py:136-141`, `:1060`). The seed has neither.
- **Fix:** plan a separate input set and manifest, regenerate `profile.json` and the synthetic bundle against the new pin using real HPO IDs, and wire in the translation files.

**M7 — Task 5 shouldn't modify `DiffView`.**
- **Evidence:**
  - `DiffView` is shared with `TranslationReviewScreen.tsx:274`, and its paragraph markers (`DiffView.tsx:11-31`) drive coupled scrolling. Read-only coupled scrolling in translation review is still unverified in the protocol.
  - The literal Before/After windows already exist: `ReanchorPanel.tsx:136-139` renders the `new_context` text and the marked `oldContext`.
- **Fix:**
  - Show the validated `old_context.text` and `new_context.text` only when `pendingDiffParts(item) !== null`. There's no need to rebuild them from opcodes, and `DiffView` can stay unchanged.
  - Add `readOnlyAnnotationView.test.tsx`, since `PendingReanchorPanel` is reused there (`ReadOnlyAnnotationView.tsx:50`).

**M8 — Task 2/F16: unclear how far "separate selection from creation" goes.**
- **Evidence:** `createPendingAnnotation` (`CaseScreen.tsx:1075-1101`) handles ordinary creation, spanless creation and term picks during re-creation (`:2289-2298`).
- **Fix:**
  - Say that one-click creation stays for complete, evidence-backed input. Keep the selected term and show **Add finding** only when the form is blocked, e.g. a missing reason. Making explicit Add universal is a policy gate.
  - Serialize this with Task 5, which edits the same function.

**M9 — The user-facing F30 error isn't covered.**
- **Evidence:** both analyses recommend a small change to `ExportPage.tsx` (with `exportPage.test.tsx`), because unstructured job errors show raw. The protocol flags the raw technical message itself.
- **Fix:** add that change to Task 1, or explicitly defer it in the disposition table.

## Low

- **Task 1:** spell out the combined regression in the same submission. It should include Hypotonia as Unresolved with its note and the defaulted Experiencer, then assert the exported `review_resolution.note`, the `basis: defaulted` value and the exact refs.
- **Task 2:** sectioned forms, success messages, kept-on-failure state and Discard already exist (`ProjectSettingsPage.tsx:48-70`, `:104`). The failed-save test will probably pass immediately. Only the new "Unsaved changes" and grouping assertions will fail first.
- **Task 3:**
  - jsdom can't check layout; add `browser/sidebar.spec.ts` (or `design.spec.ts`) to Task 3.
  - The F13 test should use two submissions with different notes plus a different current draft note, to show nothing leaks from the draft.
  - `icons.tsx` has no spanless icon (DESIGN.md:256). F17 doesn't need one, so a text label is enough, or add the icon and update DESIGN.md.
- **Missing test files:**
  - Task 7 changes `versionState.ts` and `ComparePane.tsx` but doesn't list `versionState.test.ts`, `comparePane.test.tsx` or `caseVersions.test.tsx`.
  - Task 4 doesn't list `decisionSemantics.test.ts`.
- **Task 9:**
  - List the protocol's remaining checks by name: the historical note comparison, prohibited-mode creation blocking, optional-mode submission, clearing an existing note, read-only coupled scrolling and preference restoration, the second-reviewer queue, Dismiss with reason, and deleting or clinically changing a replacement.
  - "Push the implementation branch" needs separate authorization. The current authorization covers pushing documents only.

## Policy gates, not omissions

These are handled correctly as gates: F03 configurable defaults, the F06 request mechanism, the F10 reset scope, F15 other ontologies, and direct confirmation of an immutable source in F29.

The review adds these gates:
- the "current version" rule (latest vs. accepted), from M2;
- the active-project default and whether it persists, from M4;
- universal explicit Add, from M8;
- `require_chosen_axes` combined with an Unresolved proposal that keeps a defaulted axis, from M5;
- the branch push.

## Coverage and readiness

- **Coverage:** every finding F01–F33 has an owner or a disposition, and F09/F18 are clarified correctly. The gaps are the F30 error text (M9), how F20 actually works (M4), and listing the remaining protocol checks in Task 9.
- **Feasibility:** the plan matches the code in most places:
  - the export inventory already covers reanchor and adoption sources;
  - the queue already supports exact-version completion;
  - `VariantSummary` has the lineage fields Task 7 needs;
  - every command path is valid.
- **Readiness:** ready once H1 and H2 are fixed in Task 1's text and M1–M8 are clarified. Those are short edits, not a redesign. With H1/H2 fixed, Tasks 1, 2 and 8 can start immediately. Tasks 4–7 should wait for M1, M2, M4, M5 and M7.
