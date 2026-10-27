# Manual acceptance M2 (feat/ux-calm 7d96d38b, native test server :18210)

## F1 Selection bar: plan preset on native sources is a silent no-op; Undo fails with 422
- Steps: e3c-proposals, Documents, select EN100068 en + EN100075 en (both native sources), selection bar "Translation review and annotation", then Undo.
- PUT work-plans/bulk returns changed_rows 0, skipped_rows both texts; the UI still toasts "Plan saved for 2 cases" with Undo.
- Undo sends PUT work-plans/rows with rows [] and gets 422 (min_length 1).
- Fix: when changed_rows is 0, say why ("Nothing changed: the selected texts are native sources") and offer no Undo; never send an empty undo.

## F2 Selection bar controls make little sense (user)
- "Translation review and annotation" and "Annotation only, no translation review" are translation plan presets; they show for any selection, also when it holds no translation.
- To decide with a mockup: hide them unless the selection holds translations, or move them into "Plan…" only (bar: Assign…, Plan…, Clear selection).

## Observations
- Documents table at ~1280 px wide overflows horizontally; the Next step buttons are cut off ("Assign ann…").

## F3 Assign dialog: why only one person, why grey
- e3c-proposals has "annotations per text" = 1, so after one tick every other checkbox is blocked. The dialog says it only in the intro line ("up to 1 per text (project setting)"); a blocked checkbox gives no reason. The user expected two annotators per text (U-3) and read it as the old bug.
- Grey rows mix two meanings: ann-0004/0005 "does not read en" are grey but tickable (language confirmation follows); the lead "Not an annotator in this project" is grey and not tickable.
- Fix ideas: when the limit is reached, a line under the table "Limit reached: 1 person per text. Change in project settings." (link); language mismatch shown as a warning on a normal-coloured row, grey only for rows that cannot be ticked.
- Demo data: demo-annotator and demo-annotator2 read only de, so every en text gives a language mismatch for both.

## F4 Editor: the auto-advance status line is hard to tell apart (U-2)
- Advancing works and the line appears (OK). But the line at the top right of the details pane is poorly separated from the panel content below and does not read as a status message.
- Fix idea: a clearly framed status strip (e.g. InlineMessage tone info with a check icon, own background, spacing below), or place it as a transient toast/strip at the top of the details pane header; decide with a mockup.

## F5 Proposal details: several spans are listed but cannot be visited
- EN100068, proposal "Vaginal bleeding" has two spans; the details pane lists both quotes, but neither can be clicked to scroll to / highlight that span in the text.
- Fix idea: each quote is a button that scrolls the text to the span and frames it (same behaviour as selecting a mark); keyboard reachable.

## F6 Proposal details: axis values small and without the colour coding
- In the proposal details pane (Assertion / Experiencer / Temporality) the values are small plain text. The colour-coded `AxisValue` chips exist (`ui/AxisValue.tsx`, used in FindingRow, ComparisonTable, LayerFindings) but the proposal pane does not use them.
- Fix: render the proposal's axis values with `AxisValue` at the normal text size, "Defaulted" stays as a marker.

## F7 Editor: K, then 1 again does not move on
- After K back to the just-confirmed proposal, pressing 1 again (same outcome) stays there. By design the advance skips a repeated outcome, but the user expects 1 to move on as always.
- Fix: a decision key on an already decided proposal with the same outcome advances to the next open proposal too (nothing is saved, the status line says "Already confirmed. Next open proposal: …").

## F8 Settings chaotic (user) — agentic audit
- Report: build/m2/settings-audit/REPORT.md (screenshots alongside). Decisions D1–D8 need mockups.

## F9 Term search: modifiers cannot be filtered
- Finding a modifier term (e.g. Severe, Chronic) in the term search is hard; there is no way to restrict the search to modifiers.
- User idea: prefix `mod:` in the search (e.g. `mod:sev`) restricts results to modifier terms (HPO profile: the Clinical modifier branch HP:0012823 and whatever the T1 profile classifies as modifier). Alternative: a "Modifiers" filter chip in the picker. Decide with mockup; feasible in the existing term search if the profile's modifier classification is available client- or server-side.

## F10 Proposal check: adding a modifier to a proposal, and the modifier covers both mentions
- In "from proposals" mode the attach flow first asks to select an existing finding; on a proposal the user could only add a modifier via Edit & Replace (right pane, edit), which works.
- But the proposal "Vaginal bleeding" has two spans (two mentions in the text). The modifier now applies to the finding as a whole, i.e. to both mentions, although the user meant only the first occurrence.
- Domain: modifiers belong to a finding, not to a single mention (spec 2026-10-21). Options: (a) keep per-finding modifiers and offer "Split into separate findings" (one per mention) before attaching, in the editor and in Edit & Replace; (b) per-mention modifiers (domain + format change, ontospan). Recommendation (a). User decision needed.
- Also check: is attaching a modifier to a proposal directly (without Edit & Replace) intended in proposal check? Today it requires Edit & Replace, which replaces the proposal; make that path explicit in the attach guidance.
- DECIDED (user, 2026-10-26): no split action in Ontotator. The proposal bundle generator in the benchmark repo must not merge several mentions of a term into one proposal (one proposal per mention). The annotation guidelines must state the rule clearly (one finding per mention; axes and modifiers describe that occurrence).
- CORRECTION (after reading the HPO guide, phentrieve-benchmark-local/docs/annotation-guidelines/hpo-span-annotation.md): principle 3 and R4 say occurrences with the same term and the same attributes belong to ONE annotation; a changed attribute gives a new annotation (A26). So the generator's merging is guideline-conform. Gap in the guide: it does not say whether a modifier counts like an attribute (logically yes: "starke Bauchschmerzen" … later "Bauchschmerzen" gives two annotations). Consequence for Ontotator: an occurrence that gets its own modifier/attribute must leave the merged finding -> "Move this mention to a new finding" is the guideline's own operation. Pending user confirmation.
- Root cause (EN100068 p002): m0 "slight vaginal bleeding" should carry modifier Mild (guide R1), m1 "vaginal bleeding" none -> two annotations. The generator emits no modifiers at all, so it merged them. Note sent to the benchmark session (generator: detect modifiers, merge only on equal term+attributes+modifiers; guide: modifiers count as attributes). Ontotator side: "Move this mention to a new finding" after Edit & Replace (to confirm with mockup).

## F11 Proposal check: a human copy of a proposal without a replacement decision (data integrity)
- demo-annotator, EN100068 (draft 32): draft annotation ann-606e5dd4… is a human copy of proposal p002 (HP:0034263, both mentions) with modifier Mild (HP:0012825) on 493–499 "slight". review_decisions has only p001 confirmed; p002 has NO decision, so it stays "open" although the copy replaces it.
- The user does not remember the path; probably an "Edit" control in the right pane (not "Edit & Replace" / key 3), possibly inside the modifier attach flow (in proposal mode the attach flow asked to select an existing finding first).
- Expected: every path that creates an editable copy of a proposal records a "changed" decision with the replacement (Edit & Replace semantics), or the path does not exist for proposals.
- To investigate: find all code paths in CaseScreen/ReviewActions/attach mode that copy a proposal snapshot into the draft.
- Root cause: the user did use Edit & Replace. `copyDiffersFromTarget` (CaseScreen.tsx:1087) ignores modifiers, so adding Mild to the copy never records the "changed" decision; submit would fail with UNRESOLVED_ADOPTED_COPY (server guard, no data corruption). Second bug: `handleAdoptAndEditTarget` (CaseScreen.tsx:2085) does not copy the proposal's modifiers into the copy. Fix: compare modifiers; copy modifiers on adopt; test.

## F12 Proposal check: a modifier cannot be attached to a proposal
- Attach mode targets only draft annotations (CaseScreen.tsx ~2255); in proposal check most findings are proposals, so a modifier word found in the text cannot be attached ("Create the finding first…").
- Proposal: proposals (open or confirmed) are attach targets too; attaching to a proposal performs Edit & Replace implicitly (copy incl. existing modifiers + the new modifier, "changed" decision), the status line says e.g. "Vaginal hemorrhage replaced by your copy with Mild". Depends on the F11 fix. Decide with mockup (implicit replace vs. a confirm step).

## F13 After submit: a second modal "Case submitted" with up to five buttons
- Submit dialog closes and a second modal opens at once (CaseScreen.tsx ~3807): View submitted result, Stay in case, Back to my tasks, Review next case →, Next task — odd order, too many choices.
- Options: (a) no second modal: go straight to the next task (or My tasks when none) and show a toast "EN100068 submitted · View result"; (b) the submit dialog turns into its success state in place (same modal), with one primary "Next task" (or "Back to my tasks") and a quiet "View submitted result" link; "Stay in case" dropped (the submitted case is read-only anyway?). Recommendation (a). Mockup.

## F14 Term search / HPO preview shows names in every loaded translation language
- demo-reviewer, EN100068 (en): the term preview lists translations in all loaded languages; the user does not want them.
- Cause: `editor/searchLanguages.ts` `activeLanguages`: no stored selection means ALL loaded languages are active (English always on). A language button exists to switch them off, but the default is all.
- Fix idea: default = English + the document's language only (for an en text: English only); the stored per-user choice still wins. Possibly also: the preview shows other-language names only for active languages (check). Small frontend change.

## F15 Documents: the Next step column is off-screen at ~1280 px (raises the earlier observation)
- At 1280 px the table scrolls horizontally and the Next step column (the row's one action) is completely hidden; the user could not find "the Next step button" for EN100068 (ready to compare). Screenshot build/m2/docs-lead.png.
- Fix: Next step must always be visible — sticky last column, or narrower Translation/Annotation cells (truncate the long state texts), or move the action next to the text id. Check widths 1280/1440.

## F16 Axis value colours missing in several places (check all)
- Consolidation EN100068 (task 55), group "cervical adenopathies": the comparison table cells read plain "Absent", "Patient", "Current" (DOM: no `.axis-value` span), although ComparisonTable.tsx:69 renders `AxisValue` for rows of kind "axis" — some path (one-sided group / folded rows / other row builder) bypasses it. Screenshot build/m2/cons-1.png.
- Together with F6 (proposal details pane): audit every place that shows an axis value (editor details, proposal pane, findings list, consolidation table and result line, variants, history/submitted result) and use `AxisValue` everywhere at normal text size.

## F17 Consolidation: "Edit in editor…" on every card
- "Edit in editor…" opens the whole consolidation draft in the full annotation editor (view=editor), the escape hatch for edits consolidation cannot do (spans, new findings beyond "Add finding"). It is repeated on every open, standalone and resolved card, although it acts on the whole text and leaves the consolidation view.
- Proposal: one control for the whole text in the screen header (next to Report problem), labelled "Open in full editor" with a tooltip "For span changes and findings the comparison cannot express"; remove it from the cards. Mockup.

## F18 Consolidation sidebar: button noise (user)
- Every resolved/agreed row carries its own bordered "Change" button (13 identical buttons in a column on EN100068); the open card has five buttons wrapping onto two lines (Keep …, Leave out, Edit values…, Other term…, Edit in editor…).
- Proposal: (1) resolved rows without a visible button: the whole row is the control (click/Enter expands it, "Change" appears inside the expanded row), or a quiet text-style "Change" shown on hover/focus only; (2) open card: one primary (Keep …), one secondary (Leave out), the rest in one "More…" menu (Edit values…, Other term…); "Edit in editor…" moves to the header (F17); one line, no wrap at 1280. Mockup with variants.

## F19 Consolidation: no undo for a decision
- After resolving a group there is no Undo (no toast action, Ctrl+Z does nothing; K only moves to the previous group). Only "Change" (reopen) on the resolved row.
- Proposal: an Undo toast after every resolve (same pattern as the plan Undo on Documents), plus Ctrl+Z while the toast is shown; Undo reopens the group with the previous choices.

## F20 Consolidation: field choice applies at once, and a second "keep whole finding" button
- Group "tenderness of the left iliac fossa" (1 field to decide): clicking one person's value (checkbox/choice) resolves the group immediately; below it a button "Keep <person>'s finding" does nearly the same for the whole finding — two ways that look doubled, and the first one acts without an explicit confirm.
- Earlier decision (modifiers, DN): choices are staged and saved with an explicit "Keep". Make that consistent for fields too: a choice only stages (Result line updates), one "Keep" saves; "Keep <person>'s finding" only as a shortcut when nothing is staged, or dropped. Mockup.

## F21 Consolidation: agreed fields folded into "agreed on …"
- Agreed fields (e.g. axes) are folded into one "agreed on: …" line that must be expanded to see the values, and they are uncoloured. Saves space in the wrong place and hides what the result will contain.
- Proposal: show every row of the finding (term, the three axes, text, modifiers) always; agreed rows muted with one value spanning the columns, conflicting rows highlighted; axis values as `AxisValue` chips (F16).
- Naming: "Leave out" reads like "omit a field"; it means the finding is not in the result (rejected decisions). Rename e.g. "Not in result" / "Drop finding".

## F22 My tasks does not remember the last chosen project
- The project filter/choice on My tasks resets on every visit (also after login). Expected: the last chosen project is remembered per user (same localStorage pattern as "show not in plan" on Documents, or the server preferences).

## F23 Lead takes on work ad hoc; which role does translation review need?
- In the assign dialog the lead shows "Not an annotator in this project" and cannot be ticked. Wish: the lead can make themselves annotator on the spot (e.g. "Add me as annotator" inline in that row, lead only, one click, then ticked), without a detour to Settings → Members.
- Roles today (authz/policy.py TASK_ROLES): annotate → annotator, translation_review → annotator, consolidation (review) → adjudicator/consolidator. There is no reviewer role; demo-reviewer is an annotator named "Translation reviewer".
- Open domain question (user): should translation review have its own role (Translation reviewer) instead of reusing annotator? Options: (a) keep annotator for both; (b) new role translation_reviewer (migration, members table column, eligibility, assign dialog labels). Recommendation needs user decision.
- DECIDED (user): (a) keep annotator for translation review; make the unavailable reason task-specific (e.g. "Cannot review translations in this project" / "Cannot annotate in this project"); plus the lead "Add me as annotator" shortcut.

## F24 Assign dialog: a person who already holds the task is not obvious
- Opening the assign dialog for a text whose translation review is already assigned to demo-reviewer did not make clear that demo-reviewer already has it.
- Expected: that person's row reads "Already assigned" (ticked and locked, or a clear status instead of the checkbox); the dialog intro says "Translation review of EN100022 de is assigned to Translation reviewer (ann-0003). Assign it to someone else?" — or the row action is "Reassign…" instead of "Assign review…" when the task is taken. Check the `already_assigned` field of the batch preview and how the single-text dialog shows it.

## F25 Attach mode does not see a fresh Edit & Replace copy
- EN100046, demo-reviewer: proposal Splenomegaly → 3 (Edit & Replace) → mark "mild", choose Mild → "Mild is a modifier. Create the finding first, then add Mild under Modifiers." Neither the copy in the list nor its mark in the text can be clicked as target.
- Likely cause: attach targets come from `carriedListOrder` "annotation:" keys (CaseScreen.tsx ~2266); a copy without a "changed" decision (deferred until it differs) is not listed as an own finding, so it is no target — chicken-and-egg with F11 (the copy only differs once the modifier is attached).
- Fix: the copy being edited (selected adopted copy) is always an attach target; together with F12 (proposal itself as target with implicit Edit & Replace).

## F26 Consolidation: the Undo toast is easy to miss
- The Undo toast after a resolve exists (and Ctrl/Cmd+Z), but it sits bottom-left under the text column and closes after 10 s; the user did not see it (F19). Fixed meanwhile: Undo restores the previous choices (bf4b1392).
- To decide in M-7: place the undo where the decision happened (inline in the resolved row: "Kept · Undo") or a toast near the sidebar, longer or until the next action.

## Decisions M-1…M-8 (user, 2026-10-26)
- Agreed with all recommendations, with open questions on M-1 (wording "Keep (2 off)" in the Plan dialog), M-5 (attach by clicking a term in the text or the list must work), M-6 (how the next task is reached), M-7d (agreed values still listed one by one). Implementation on hold until the user says go.

## F27 Plan dialog: "Keep (2 off)" is unclear
- The Plan dialog's per-cell select offers "Keep (12 on, 8 off)" = leave the current values of the selected texts unchanged (here: both texts currently not planned). The wording does not say that.
- Proposal: "No change (2 not planned)" / "No change (12 planned, 8 not)" — or a heading "Currently: …" with options "Plan" / "Don't plan" / "Leave as is".
