# Phase 0 implementation and UX review — 2026-10-18

Reviewed commit: `afc41e0fbbecd76208cd2906616534161a186796` (`feat/phase0-usability`), compared with `4de9aaa`.

Primary reviewer: Claude Code 2.1.296, requested and verified model `claude-opus-5-5`, effort `high`. A source review was followed by a resumed live-browser review in the same Claude session. Both completed successfully. The report below is the final Claude assessment; it supersedes the initial source-only assessment. An independent GPT-6.1-sol medium helper supplied mechanical UX evidence only.

## Coordinator verification and scope

- No application code changed, no tests or builds were rerun, and no merge or push was performed for this review. Existing passing test counts are historical evidence, not fresh verification.
- Read the verdict together with its evidence table: B0.5 is document-reviewed only; legacy draft guidance and historical export failure were not exercised live. The blanket runtime statement in the reviewer verdict does not mean every requirement was independently executed.
- Independently checked the re-create command (`frontend/src/app/CaseScreen.tsx:1096`, `src/ontotator/application/editing.py:505`): it passes empty clinical axes instead of copying the verified predecessor. The live pass establishes the null-axis result and missing defaulted marker; an actual absent-predecessor regression was not executed.
- Additional source verification: `src/ontotator/exchange/t1.py:478` omits null axes and fills absent HPO axes from `ontospan.default_axes()` at export. Thus a lost original axis can acquire an export default. This downstream risk is source-inferred, not a live export observation.
- The P0-R browser-test coverage gap was checked against `frontend/browser/reanchor.spec.ts`; the live reviewer did exercise the blocker and focus jump manually.
- The stray first screenshot has been moved into the evidence directory. References below to its former worktree-root location describe the reviewer session, not the final filesystem state.
- All live work used disposable synthetic fixtures on port 18765. Ports 18080 and 18081 were not accessed. The owned browser, fixture server and its test containers were closed. Docker Desktop was stopped after checking there were no active containers. Available physical RAM after cleanup was approximately 5.53 GiB of 15.95 GiB; unrelated processes were left running.
- CI/check optimization is present (`d9747af`): explicit partial stages, early preflight failures, stage timings and two default Vitest workers to reduce memory pressure. A shorter full-suite wall time has not been demonstrated. Last recorded full gate was about 31 minutes; the optimized static stage was 49 seconds.
- Questions skipped: review-only request; implementation decisions follow verified findings.

Local evidence is retained under `.superpowers/sdd/2026-10-17-phase0-priorities/opus55-review/`: original reports, model metadata, live-browser screenshots, and independent detector/browser evidence. This ignored directory is not included in repository history. The report is a local review artifact; it does not alter the reviewed implementation revision.

---

# Ontotator Phase 0: final independent review (supersedes the initial report)

**Reviewer:** Claude Opus 5.5 (`claude-opus-5-5`), effort high. **Revision:** candidate `afc41e0` on `feat/phase0-usability`, baseline `4de9aaa`. Source stayed read-only and I ran no tests or builds.

## 1. Verdict, methods, limitations

**Verdict: ready for user acceptance; not yet ready to merge.** I found no P0 blockers. All five Phase 0 deliverables and the approved P0-S/A/R/U semantics work at runtime, and the server enforces them. One P1 clinical-fidelity issue should be fixed, or explicitly accepted by the user, before merge: re-anchor re-creation drops the original clinical axes. The remaining findings are P2 guidance and error-recovery gaps and P3 polish.

**Methods:**
- **Initial pass (source):** read the plans, PRODUCT/DESIGN, the backend and frontend diffs, current source and the relevant tests, and the 7 older screenshots.
- **Live pass (this session):** isolated headless `review_browser` against `http://127.0.0.1:18765` only, in a fresh tab. Fixture state came only from `/__test_user__`, `/__test_translation_review__` and `/__test_reanchor__`, plus one project-settings PATCH (later restored) inside the disposable database.
  - I logged in through the UI as `opus55-reviewer` (all roles), the annotator-only translation reviewer, and the adjudicator in the re-anchor scenario.
  - Viewports were 1440×1000 and 1024×800.
- **Mechanical evidence:** I read `evidence-b/REPORT.md` only after my own live observations.

**Limitations:**
- I did not test these live:
  - legacy (pre-migration) drafts, which the fixtures can't produce;
  - export job failures;
  - the case where a Hypotonia-style axis is carried by a real absent-assertion predecessor (the predecessor isn't readable for the reviewer role, see P1-1);
  - the 700 px width.
- My keyboard checks were targeted, not a full audit. I did no screen-reader or contrast audit.
- **Stray file for root cleanup:** my first screenshot was written to the worktree root as `live-01-review-unresolved-note-1440.png`, because the relative path resolved against the CWD. It is untracked and not a source change, but it should be moved into evidence or deleted before any commit. All later screenshots went to `opus55-review/browser/`.
- I closed my own browser. The root fixture server is untouched.

## 2. Findings

### P1-1: "Re-create here" silently resets the original finding's clinical axes to "Not specified"
- **Trigger (browser-observed):** adjudicator in the `/__test_reanchor__` scenario → *Re-create here* on item 1 → select "Ataxia 😀new" → *Save re-created finding*.
- **What happens:** the saved annotation has `assertion`, `experiencer` and `temporality` all `null` ("Not specified"), `method: "edited"`, and **no `axes_defaulted`** (`live-08-reanchor-recreated-axes-1440.png`). So there is no "Defaulted axes" badge and no submit warning.
- **What the reviewer can't see:** the pending item payload has no axes field. The adjudicator's `annotation-versions` list for the predecessor text was empty. The original assertion (for example `absent`) is therefore not visible anywhere to the reviewer.
- **Source:** `frontend/src/app/CaseScreen.tsx:89-92` (`initialAxisValues` sets every axis to `null`), `:1096`; `src/ontotator/domain/reanchor_resolution.py:50-71` (`ReanchorItem` has no axes); `frontend/src/variants/ReanchorPanel.tsx:129-133`.
- **Impact:** a negated or historical finding can be carried to the corrected text with its clinical context erased. Nothing reports this, and nothing would block it unless the project enables "Every axis must be chosen". That conflicts with PRODUCT principle 2 ("nothing is decided silently").
- **Plan:** B0.3 only required prefilling term and layer, so this is an intent gap, not a missed checkbox. Tests assert term, offsets and provenance but not axes.
- **Fix direction:** add the verified predecessor's axes to the authorized item and show them in the queue. Prefill them on re-create, or mark them for explicit confirmation. Add an `absent`-predecessor test.

### P2-1: Settings hint contradicts P0-S
- **Browser-observed:** the Rules form on `#/projects/browser-fixture/settings` says "Applies to new drafts. Profile requirements for text evidence still apply."
- **Source:** `frontend/src/admin/ProjectSettingsPage.tsx:91`, asserted by `frontend/tests/projectSettings.test.tsx:105`.
- **Why it's wrong:** I created a spanless finding with a reason in an *existing* open draft (task 4) and then switched the project to Prohibited. Submission was rejected under the new rule (`live-04`). So the hint tells leads that in-progress work is grandfathered when it is not.
- **Fix:** "Applies to every future submission; completed submissions are unchanged."

### P2-2: Repair guidance points to the wrong remedy and mixes up concepts
- **Browser-observed (draft, Prohibited mode):**
  - After reload, the submit dialog correctly lists "Seizure: This project requires a text span for findings."
  - Clicking that item focuses the textarea labelled **"Reason for no text span (required)"**, which already contains text (`live-05`).
  - A reason cannot satisfy Prohibited mode. The real remedy, "+ Add Mention" (or Delete), sits below the fold.
  - The field is still labelled *required* in Prohibited mode because `spanlessNotesRequired` ignores `allow_spanless_findings` (`CaseScreen.tsx:168`, used at `:2332` and `AnnotationPanel.tsx:284`). The jump always prefers a `textarea` (`CaseScreen.tsx:1592-1600`).
- **Source-inferred (proposals):** for a confirmed or unresolved spanless *proposal* in required-reason mode, the same jump falls back to the first input or button. That is "Clear selection" or the **Reviewer note**. Typing there doesn't satisfy the rule; the fix is Edit & Replace with an annotation reason. This mixes up the annotation note and the reviewer note, which the plan keeps separate.
- **Fix direction:** choose the jump target by reason (Add Mention for prohibited or evidence-required, the reason field for missing reason, Edit & Replace for proposals). Put the remedy text in the dialog. Don't label the reason as required when spanless findings are prohibited.

### P2-3: Server-side submit rejections give generic, sometimes false guidance
- **Browser-observed:**
  - If the lead changes the rule while the editor is open, the client keeps the stale rules. The dialog shows no issue, and submitting yields "Submission failed: The work does not meet the project's submission rules. **Check the highlighted values.**"
  - Nothing is highlighted, and the message appears twice: a banner and the sidebar footer (`live-04`).
  - "Reload case" recovers, and the dialog then explains the problem correctly.
  - **Source:** `CaseScreen.tsx:1700`, `frontend/src/admin/errors.ts:104`.
- **Source-inferred, same class:** an unknown or obsolete proposal marked Unresolved can only be caught at submit (the backend correctly enforces P0-U at `submissions.py:335-341`). It then gets "Replace or delete terms…" (`errors.ts:137`, `:89`), with no item named, no jump, and an impossible "delete" for a proposal. The inline warning at `ReviewActions.tsx:220-227` partly mitigates this.
- **Fix direction:** map `PROJECT_RULE_VIOLATION` and term-violation details to the item-level repair list in the dialog, or prompt a reload when the rules changed. Drop "highlighted".

### P2-4: Defaulted proposals: the jump lands on details that don't say what is defaulted
- **Browser-observed (task 7):**
  - The list shows "Defaulted axes" on the Confirmed Hypotonia.
  - The submit dialog shows "1 annotations have defaulted axis values." and *Review defaulted annotations*. That reveals the hidden layer and focuses "Proposal details" (`live-02`).
  - The details only say `assertion: present`. There is no defaulted marker and no hint that Edit & Replace → "Reset decision and edit copy" → Confirm axis is the path (`ReviewActions.tsx:182-196`).
- **Fix direction:** mark defaulted axes in proposal details and add a one-line remedy.

### P2-5: Historical invalid unresolved export failure is explicit but raw (source-inferred, not live-tested)
- `exchange/jobs.py:236-262` combined with `jobs/queue.py:167` makes `ExportPage.tsx:97` show `DomainError: [UNKNOWN_TERM] {...}`. There's no document or submission context and no remedy, and one historical item blocks the whole project export.
- This meets the P0-U requirement to fail rather than silently omit, but the lead can't act on it.
- The test `test_t1_export.py:618-621` accepts any of three codes for each variant.
- **Fix direction:** a catalogued error code with structured details and UI guidance; assert the exact code per variant.

### P2-6: Legacy open drafts get editor affordances that conflict with submit enforcement (source-inferred)
- Drafts with `spanless_policy_version = NULL` keep "Add finding without a text span" enabled in Prohibited mode and show "Optional context for this finding." in required mode (`CaseScreen.tsx:1151-1153`, `:2273-2274`). Submission then enforces the current mode.
- The fixtures only produce policy-v1 drafts, so I couldn't observe this live. It will affect every in-progress draft after a real upgrade.

### P3 (polish)
- **Sidebar section title truncated (browser-observed):** "Curated Annotati…" at 1440, and just **"C."** at 1024 (`live-01`, `live-03`/`04`/`05`). The count is lost too. This is a small regression from the longer "Add finding without a text span" button. Cheap fix, worth doing before acceptance.
- **Coupling silently does nothing below 1100 px (browser-observed):** in translation review at 1024 the panes stack, but "Couple scrolling" stays checked and enabled, the warning still shows, the pair readout is empty and the followers don't move (`live-07`). Source: `useCoupledScroll.ts` `matchMedia('(min-width: 1100px)')`.
- **Re-anchor queue density (browser-observed):**
  - Old context, new context and the diff repeat the same text.
  - Context windows start or stop mid-word ("al context remains unchanged.").
  - The resolved row prints the raw replacement UUID and hash, which overflow the 320 px sidebar (`ReanchorPanel.tsx:95-97`, `live-08`).
- **Source-only hygiene:**
  - stale comment `src/ontotator/authz/versions.py:128` ("P0-A remains pending");
  - pair readout uses `aria-label` on a plain `<p>` (`ComparePane.tsx:96`, and the same pattern in TranslationReviewScreen);
  - two primary buttons in the re-create view;
  - the mandatory reviewer note is a single-line TextInput (`ReviewActions.tsx:342`);
  - grammar: "1 annotations".

**Not defects / out of scope:**
- Coupling is unavailable in editable views (D1).
- On narrow layouts the 1024 translation decision form starts at about y=2074 and the review decision buttons fall below the fold (evidence-b measurements). That is existing layout debt for T6b, not a Phase 0 regression.
- Role-union browse rights for mixed-role users are by design.
- D6–D15 and T4a/T4b/T6b are later scope.

## 3. Reconciliation with the initial report

- **P1-1 refined:** I had assumed the defaulted badge and submit warning would at least flag the loss. At runtime the re-created axes are `null` with no `axes_defaulted`, so there is **no** warning. The result is "Not specified", not a forced `present`. The severity stays P1 and the description is corrected.
- **Initial P2-3 extended and now browser-observed:** the wrong-remedy focus also happens for draft annotations in Prohibited mode, not only for proposals. The "required" label in Prohibited mode is new.
- **New P2-3:** stale rules plus the false "Check the highlighted values" message (observed). Merged with the initial unknown-term submit finding.
- **P2-1, P2-4 (defaulted proposals) and the coupling no-op:** now confirmed live.
- **Header truncation:** worse than I first thought ("C." at 1024).
- **P2-5 and P2-6:** remain source-inferred, unchanged.
- **Positive runtime confirmations** matched source expectations; see the traceability table.
- **Mechanical evidence:** the detector reported 0 findings. The single overlay rule ("cream/beige palette") is a false positive against the intentional `DESIGN.md` surface `#f7f4ee`. Its focus observations (dismiss reason focus and return, Ctrl+Enter blocker in translation review) agree with my findings. Its 1024 stacking measurements are existing layout debt. None of it overturns my findings.

## 4. Traceability

| Item | Status | Evidence (B = browser-observed, S = source/test) | Gap |
|---|---|---|---|
| **B0.1** coupling (reading-only, positional, opt-in) | Implemented | **B:** the annotator-only translation reviewer sees coupling disabled while editing ("available in read-only views"). With Show changes on and opt-in, a wheel-led source scroll moves 2 followers. The source stays at 1400 after 800 ms (no snap-back). The exact warning shows with "Source paragraph 2 ↔ Translation paragraph 2 ↔ Comparison paragraph 2" (`live-06`). **S:** merge/split equal-count fixture tests. | P3 no-op at <1100 |
| **B0.2** keys, single confirmation, defaulted warning, three modes | Implemented | **B:** repeated `1` stays Confirmed. `4` without a note focuses the required Reviewer note and keeps the proposal open. One "Entire text checked" confirmation. The defaulted warning and jump reveal the hidden layer. Three-option Settings select, defaulting to required. The required spanless reason blocks term selection, focuses the field and keeps the search. | P2-2, P2-4 |
| **P0-S** current mode on every future submission | Implemented (server) | **B:** an existing open draft was rejected after the switch to Prohibited, and the dialog explains it after reload. **S:** `test_project_rules_postgres.py:393`. | P2-1 copy, P2-3 stale state, P2-6 legacy guidance |
| **D2/P0-U** flagged unresolved export | Implemented | **B:** the submit dialog counts "1 unresolved with reviewer flags". The ReviewActions copy separates the reviewer decision from clinical uncertainty. **S:** materialization and validation at submit, `review_resolution` block, legacy warning, explicit historical failure, import refusal, pin `738f3d4…`, browser ZIP assertions. | P2-3, P2-5 |
| **B0.3/P0-R** frozen per-reviewer re-anchor queue | Implemented | **B:** the submit dialog shows "2 finding(s) after text correction still pending" plus an alert and a jump that focuses the first pending row. Re-create gives "1 pending · 1 resolved" with an exact replacement resolution. **S:** frozen and late-set tests, privacy, invalidation on edit, immutable submission copy. | **P1-1**, P3 density |
| **B0.4/D16/P0-A** access | Implemented | **B:** the annotator-only reviewer (roles `["annotator"]`) gets source, translation and comparison. Switching accounts gives 404 for foreign assignment routes. **S:** `BROWSE_VERSIONS` guards; `variants.spec.ts:340-377` denial codes and own history. | P3 stale comment |
| **B0.4** cleanups | Implemented | **B:** the hidden-axis explanation is visible; no Progress placeholder in source; single replacement path. | P3 header truncation |
| **B0.5** isolated candidate | Documented; not independently verified (by design) | **S:** acceptance doc and plan record. I did not access 18080 or 18081. | None |
| **Harness** | Implemented | **S:** `--only` partial gate is labelled as partial; the full gate stays the default; 2 workers; timings. | None |

## 5. UX assessment

**Strengths (observed):**
- The review card is calm and keyboard-first, with visible key badges and idempotent outcomes.
- The required-note error focuses the right field.
- The submit dialog shows counts, specific blockers and working jumps (defaulted, P0-R).
- The spanless-reason gate keeps the user's search.
- Translation review keeps clinical text primary, and coupling is clearly optional and labelled.
- Restricted roles simply don't see the version controls.

**Highest-impact friction:**
1. Re-anchor drops axes silently (P1-1) and the queue is dense.
2. Repair jumps and server errors often point to the wrong remedy, or to "highlighted" values that don't exist (P2-2, P2-3).
3. Policy copy contradicts actual enforcement (P2-1).

**Keyboard and narrow layout:**
- Review keys and focus management work.
- At 1024 the sidebar label collapses to "C.", the coupling toggle is a silent no-op, and decision controls sit below the fold (existing debt).

**By user type:**
- *First-time annotator:* misleading spanless guidance after rule changes, and generic errors.
- *Expert reviewer:* fast keys, but defaulted and invalid-proposal repairs need hidden multi-step paths.
- *Lead:* the Settings hint is wrong, and export failures are raw.

**Nielsen heuristics (0–4):**

| Heuristic | Score | Evidence |
|---|---|---|
| Visibility of system status | 3 | Saved status, pending/resolved counts, submit counts (B) |
| Match with the real world | 3 | "Unresolved" vs clinical uncertainty is clear; raw axis IDs and UUIDs remain (B) |
| User control and freedom | 3 | Key 0 reset, Cancel, Reload case, note kept (B/S) |
| Consistency and standards | 2 | "Required" reason in Prohibited mode, two primaries, single-line vs multi-line notes (B) |
| Error prevention | 2 | Strong server enforcement; the client allows doomed actions (stale rules, Unresolved on invalid terms) (B/S) |
| Recognition rather than recall | 2 | Edit & Replace remedy must be known; original axes not visible (B) |
| Recognize and recover from errors | 2 | Good dialog jumps; false "highlighted" message, wrong focus targets (B) |
| Flexibility and efficiency | 3 | Idempotent 1/2/4/0 and Ctrl+Enter blockers (B + evidence-b) |
| Aesthetic and minimalist design | 3 | Calm paper reading surface; re-anchor sidebar triple context (B) |
| Help and documentation | — | Not assessed |

## 6. Evidence inspected, coverage gaps, merge readiness

**Live screens captured:**
- `live-01-review-unresolved-note-1440.png` (in the worktree root, see limitations)
- `opus55-review/browser/live-02-submit-defaulted-unresolved-1440.png`
- `live-03-p0s-open-draft-submit-repair-1024.png` (stale view)
- `live-04-stale-rule-submit-error-1024.png`
- `live-05-prohibited-repair-focus-1024.png`
- `live-06-translation-coupled-1440.png`
- `live-07-translation-coupling-noop-1024.png`
- `live-08-reanchor-recreated-axes-1440.png`

I also ran DOM and API checks for focus, payloads, roles and scroll positions. I reviewed the 7 earlier screenshots; the coupling ones are out of date for the CaseViewer layout.

**Tests and evidence examined:**
- `decision-semantics.spec.ts`, `variants.spec.ts:340-377`, `reanchor.spec.ts:49-111`
- `test_reanchor_resolution_api.py`, `test_reanchor_resolutions.py`, `test_t1_export.py:514-621`
- existence of `test_project_rules_postgres.py:393`
- `check.sh`
- `evidence-b/REPORT.md` (detector JSON summary and its measurements; I did not open its screenshots)

**Coverage gaps:**
- no axes-fidelity test for re-anchor re-creation;
- no browser test for the P0-R submit block and jump (Vitest only);
- no test for the reason-specific repair focus;
- no frontend test for legacy-draft guidance or stale rules;
- the export invalid-target assertion is too permissive.

**Merge-readiness recommendation:**
1. Proceed with user acceptance on the prepared candidate.
2. Before merge, fix P1-1 (or record the user's explicit risk acceptance) and P2-1 (a one-line copy change). Also fix the cheap header truncation and the P2-2 focus and label logic.
3. Schedule P2-3 to P2-6 as near-term follow-ups. They concern guidance and recovery; server-side data integrity is not affected.
4. Any code fix needs its affected suites rerun, and the final gate once before merge.
5. No Ontotator merge or push is authorized yet.