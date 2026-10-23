# Proposal check, text card, consolidation table, text view

Date: 2026-10-23. Status: approved by the user in the mockup round of 2026-10-23; revised the
same day with the user decisions D1–D4 and the plan review.
Source: manual acceptance findings in
`.worktrees/manual-20261021/build/t5-acceptance/manual-test-20261021/FINDINGS-20261023.md`
(F1–F25, V1–V8). Mockups: `.superpowers/brainstorm/189250-1792745471/content/`
(`text-card-path.html`, `text-card-before-after.html`, `consolidation-group.html`,
`text-view.html`; `consolidation-split.html` shows a rejected variant). Wording in the mockups
is superseded by D2.

## Goals

1. Imported tool proposals can be worked on (F19, F25). Today nobody can: "Annotation" is
   always done from scratch and "Annotation review" only reviews a submitted human annotation.
2. One click on a Documents row shows where the text stands and lets the lead act right
   there (F4, F6, F17, F20, F21, F22, F24).
3. Consolidation choices are made in the comparison table, conflicts are obvious, and the
   result is always spelled out (F9, F10, F11, F12, F15, F16).
4. The read-only text view is understandable (F22, F23).
5. Legacy workflow pieces that confuse the new flow are removed (D1).
6. A batch of small fixes from the same session (see "Small fixes").

Out of scope: modifiers and family member (postponed spec on `spec/modifiers`), user
management redesign.

## Decisions of 2026-10-23 (D1–D4)

**D1. Legacy removed completely.** Test data may be dropped or migrated away; no read
compatibility is kept.
- The assignable task "Annotation review" (review of a submitted annotation) goes: no
  "Assign annotation review…", no review rows in the assign dialogs or the bulk bar, no
  "annotation review" states or next steps in the Documents read model, no ordinary review
  rounds. The consolidator's task stays; it is created only by "Consolidate…".
- The `assisted` workspace mode goes.
- Stored "keep both" consolidation decisions, `term_choices` and `term_parts` go.
- The review **machinery** (targets, decisions, review submissions) stays where it powers
  annotation from proposals and consolidation.
- A migration deletes the existing legacy rows with all the work that hangs on them
  (drafts, submissions, rounds, holds, problem reports, and consolidations or final
  selections built on deleted work); the text then reads "ready to compare" again where a
  consolidation was deleted. Only remembered `assisted` mode preferences are converted (to
  annotation from scratch). Deletion and conversion are covered by tests.

**D2. Terminology (exact UI wording).**
- Path phases: **Translation**, **Annotation**, **Finalization**.
- Translation: "Translation review", "Request correction…".
- Annotation: **"Annotate from scratch"** (no proposals; formerly blind / independent) and
  **"Annotate from proposals"** (confirm, reject or correct the tool's proposals and add the
  missing findings). The card and My tasks show e.g. "Annotation, from proposals". The
  project setting options read "Annotate from proposals" / "Annotate from scratch".
- Finalization: "Compare results…", "Consolidate…", "Accept result…".
- Roles are shown as Annotator, Consolidator and Lead (the internal role id `adjudicator`
  may stay).
- Gone from the UI: "Annotation review", "Independent annotation", a bare "Review", "Keep
  both", "blind" as a user-facing word, and "check tool proposals" phrasing.
- In consolidation, findings that originate from a tool proposal carry the robot icon.

**D3. Text view:** people who are not the lead never see other people's work there, not
even as greyed entries (§4).

**D4. e3c-proposals on the test server:** its existing annotation assignments are test
data; the manual acceptance run removes them (with their work) so the texts can switch to
"Annotate from proposals".

## 1. Annotate from proposals (decisions Q1–Q3)

**Q1 = A.** A second way to do the annotation step: **Annotate from proposals**. The person
goes through the text's tool proposals one by one and confirms, rejects or corrects each
(term, axes, text span), and adds findings the tool missed. It uses the existing review
screen (J/K to move, 1–4/0 to decide). Every proposal gets an explicit decision, so tool
precision can be measured from the export.

**Targets.** The proposals worked on are the **newest tool proposal set** of the version
being annotated, fixed when the work starts. Older sets on the same version are not
targets. Proposal counts in the Documents table, the card and the text view, and the
precision figures of the export, refer to the same set.

**Q2 = A.** Annotating from proposals *replaces* annotating from scratch for that text; it
does not add a step. A submitted annotation from proposals counts as one annotation towards
the project's "annotations per text". With 2 per text, two people work through the same
proposals independently; afterwards Finalization (compare, consolidate, accept) runs
unchanged. "Annotations per text = 1" gives the single-annotator flow.

**Q3 = A.** The lead decides per project, with an exception per text:
- Project setting (Settings → Workflow) "Texts with tool proposals": **Annotate from
  proposals** (default for new projects) or **Annotate from scratch** (existing projects
  keep annotating from scratch).
- Texts without tool proposals are always annotated from scratch.
- The text's plan can override the mode for that text ("Change plan…" in the text card).
- Assigning stays one task, "Annotation". The assign dialog and the text card show which
  mode applies ("Annotation, from proposals" / "Annotation, from scratch"); nobody picks
  the mode while assigning.
- Mixing modes within one text is not offered.

Constraints:
- The mode is fixed per text once annotation work exists on any version of the text:
  an annotation assignment that is not revoked, a revoked assignment whose work was
  submitted, or a submitted annotation. Changing the plan afterwards is refused with a clear
  reason (existing work would mix modes). Removing all unsubmitted assignments frees the
  text again; submitted work never does.
- "Annotations per text" is counted **per version** of the text (an annotation belongs to
  the version it was made on; a new version needs its own), while the mode lock spans the
  **whole text** (all versions are annotated the same way).
- **New text versions.** Work from proposals stays on its version: it is neither moved nor
  carried to a new version (its decisions refer to that version's proposals); both
  operations are refused with that reason. While the text is locked to "from proposals", a
  new version can only be assigned once it has its own tool proposals (imported or
  re-anchored); otherwise the assignment is refused with a reason saying so. Texts annotated
  from scratch behave as today.
- A person annotating from scratch never sees proposals (unchanged). A person annotating
  from proposals sees only the tool proposals, never other people's work.
- An annotation assignment opens only its own mode.
- Legacy removal per D1; every place that says just "Review" for the translation review
  says "Translation review" (F1).
- Export: submissions annotated from proposals record per proposal the decision (confirmed /
  rejected / corrected / uncertain) with the proposal's source ref and the proposal set,
  plus added findings. Existing export formats get the minimal additive fields; document
  them, including that precision is computed per proposal set.
- The project e3c-proposals on the test server is switched to "Annotate from proposals"
  once this ships, after its test assignments are removed (D4).

## 2. Text card (replaces the row side panel)

Container: a **centered popup** over the dimmed Documents table. Esc, ✕ or a click outside
closes it; ‹ › step to the previous/next row of the current table order. Clicking a row
opens the card and (unchanged) selects the row.

Header: case ID, language with flag. The version is shown in the header **only** when the
text has more than one version, as a warning, e.g. "v2, newer than the annotations".

Below the header a **path** of three segments: **Translation → Annotation →
Finalization**. Each segment shows a short state:
- Translation: e.g. "not reviewed, optional", "in review (Ana)", "accepted", "source text"
  (native texts show "source text" and nothing to do).
- Annotation: e.g. "1 of 2 assigned, 17 proposals", "2 of 2 submitted".
- Finalization: "waiting", "ready to compare", "consolidating (2 of 3 groups open)",
  "ready to accept", "accepted 23 Oct".

Colours: green = done, light blue = needs work now, grey = later, dark blue = the segment
currently shown below. On open, the segment that needs work now is shown.

Below the path: the selected segment's details and its own actions.
- **Translation:** version and origin ("Version 1, machine translation from English"),
  automatic check result, reviewer chips (with state and "assigned <date>"), "Assign
  reviewer…", "Compare with source", the version list (moved here from the footer),
  "Request correction…".
- **Annotation:** mode ("Annotation, from proposals" / "Annotation, from scratch"), number
  of proposals with "View proposals", one chip per assigned person with state (not started /
  in progress / submitted) and the date it was assigned ("assigned 23 Oct"), "+ Person", and
  on each chip an ✕ that removes the assignment after a confirmation dialog ("Remove Tom Reis
  from the annotation of EN100024? Their draft is discarded." Cancel / Remove). The draft is
  really discarded: assigning the same person again starts from an empty draft. Submitted
  work cannot be removed this way.
- The lead can annotate from proposals themselves from the Annotation part: "Annotate from
  proposals myself" assigns the annotation to the lead (granting the Annotator role in this
  project automatically, as for self-consolidation) and opens the task. It counts as one of
  the annotations per text like any other (F24). When the project rule "the consolidator of
  a text may not be one of its annotators" is on, the button says beforehand that the lead
  then cannot consolidate this text themselves.
- **Finalization:** "Compare results…", "Consolidate…", "Accept result…", final result
  with "Open result".

Every assignment shown anywhere (card chips, My tasks, history, assign dialog holders)
carries its assignment date.

Documents table row actions: the overflow button labelled "+1" / "+n" is replaced. With
the text card as the place to act, the table row keeps one primary action (e.g. "Open my
task" or "Open") and the rest live in the card; if an overflow menu remains anywhere, it
is a labelled "More" button (with "⋯" icon), never a bare "+n".

Footer: "History (n)", "Text details", "Change plan…". "Change plan…" (and the bulk
"Plan…") is reworked (F5): instead of a large frame with lone pills it lists the text's
steps in words, "Translation review: on / off" and "Annotation: from proposals / from
scratch", each with a short explanation of what it changes. If saving the steps succeeds
but the annotation mode cannot be changed, the dialog says that the steps were saved. The
Activity / Versions / Details tabs of the old panel go away (history and details open
inside the card).

Bottom selection bar: appears only when **2 or more** texts are selected (bulk assign /
plan). With one or zero selected texts there is no bar; the card is the place to act. The
bar keeps its floating position. Its buttons and labels are reviewed against the new task
names (no "Annotate only" style labels without context).

Row click toggles the selection (F3, replaces the 2026-10-22 "never deselects" rule):
- click on an unselected row: select it and open its card;
- click on a selected row: deselect it, the card does not open;
- click on the text name (flag + language): open the card without changing the selection;
- checkbox, Shift- and Ctrl-click behave as before. Closing the card never changes the
  selection.

## 2b. Documents table rows

Mockups: `documents-rows-v3.html`, `proposal-icon.html`. Today a text row is 70–100 px
high (about 7 texts per 1280×900 screen); target is one line of about 40 px (about 16
texts).
- Columns: checkbox, Text (flag + language), Translation, Annotation, Finalization,
  Waiting on, Next step, Last activity (names match the card path).
- A source text that is not in the plan is folded into the case line ("source en
  (native), 1 translation"); a planned native text stays a normal row.
- At most one button per row: the viewer's next step (Open my task, Compare results…,
  Consolidate…, Accept result…, Assign person…). No per-row "Open" (the row click opens
  the card) and no "+n".
- Status cells are one line; a short "who" may follow in grey.
- Tool proposals: while nobody is assigned to the annotation, the Annotation cell shows a
  **robot icon** (Lucide "bot", vendored into `ui/icons.tsx` in the house icon style:
  16 px, currentColor, aria-hidden; ISC licence noted) with the tooltip and accessible text
  "17 tool proposals available; the annotation starts from them". Once someone is assigned
  the icon is gone; the card always shows the count. A Documents filter "With tool
  proposals / Without" is added.

## 3. Consolidation

Top of the screen: the same three-part path as the text card, with Finalization current,
so it is clear this is the consolidation of the annotation, not the translation (F17).

One group = one set of overlapping spans = **exactly one finding**. "Keep both" and any
"split off" are removed, and stored "keep both" consolidations are deleted (D1). If the
consolidator believes a second, different finding is meant, they add it with the existing
"Add finding" on the text.

Group card:
- Header: conflict marker "!" (icon, no "differs" text), group name, "n fields to decide".
- Comparison table: one column per person (header with the person's line style from the
  text; a robot icon "From a tool proposal" when that person's finding comes from a tool
  proposal, confirmed or corrected), one row per field. Rows: Term, each axis, Text, Note.
  - A row where people disagree gets the "!" marker and a light tint; each value has a ✓
    button to take it. Only these rows need a choice.
  - Rows where all agree are shown as one grey line ("patient (all agree)").
  - Text is only a decision when spans genuinely conflict (existing rule); otherwise it
    reads "(overlapping, comes with the chosen finding)".
  - Notes never block; shown as information.
- Row "Whole finding" with "Take <name>'s finding" per column.
- **Result line** (always visible): what will be saved, e.g. "1 finding, Hypotonia
  (HP:0001252), assertion not chosen yet, patient, current" and "Not taken: Axial
  hypotonia (Ali), Muscle weakness (Eva)".
- Axis values use **fixed colours** defined once (variant B), e.g. assertion present =
  green, absent = red, uncertain = amber; experiencer and temporality get their own fixed
  palettes. Defined as design tokens and used everywhere axis values appear (editor,
  consolidation, text view, compare). Colour is never the only signal: the value text
  stays.
- Auto-kept (fully agreed) groups use the same list style as open ones, marked "agreed"
  (F9); no visual break.
- The large pill buttons are removed.
- The final action is called "Accept result…" everywhere (F16).
- The server rules stay consistent with the UI: one term per group; a choice is required
  for every disagreeing field; "Keep both" and `term_choices` are removed from the API
  (with tests).

## 4. Text view (read only)

Replaces the case viewer's "Versions" fold-out and its three selectors (F23). It is the
target of the card's links ("View proposals", "Compare with source", a person's chip,
"Open result").

- One toolbar: "‹ Documents", case ID, a dropdown **language + version** (e.g. "de,
  version 1 (machine translation)"; lists the source and newer versions), a dropdown
  **Show** (Text only / Tool proposals (n) / each person's annotation with state / Final
  result), "Compare", "Text card".
- Who sees what (D3): the lead sees every person's annotation; people who have not
  submitted yet and a final result that is not accepted yet stay in the Show list, greyed,
  with the reason. Everyone else sees only their own work and, where they may, the tool
  proposals; **other people's work never appears for them, not even greyed**. Tool
  proposals the viewer may not see (for example while annotating from scratch) stay in the
  list, greyed, with the reason.
- Right side: the findings of the shown layer, read only, with the fixed axis colours.
- "Compare" opens a second column with its own language/version and Show dropdowns.
- Nothing can be edited here.

## Small fixes (no design decision needed)

- F2/V8: the row's language code is plain text with flag, not a link.
- F7: "Open my task" no longer stacks under "Open" in the table row (one compact action).
- F8: opening a task shows a calm loading state, not a large blue area.
- F11: no "·" separators anywhere in the UI.
- F13: undo toast stays on one line at half screen width.
- F14: network failures show "Connection lost. Try again." with a retry, never the raw
  browser message.
- F18: demo login buttons show the display name, e.g. "Tom Reis (demo-annotator),
  Annotator".
- V1: text card on narrow screens is a full-width sheet without letter-by-letter wrapping.
- V2/V3: language flag in the annotation editor header and the translation review column
  labels.
- V4: link-styled "Open" buttons react to Space.
- V5: "How is this counted?" / "Show submissions" read as clickable (link style).
- V6: page titles keep the standard left padding.
- V7: filter popover option list fully visible; documents table fits 768 px without
  horizontal scroll where possible.
- "Annotations per text" is enforced: the seeded case cons-three got a third annotation
  assignment although the project limit is 2. Find out whether that path bypasses the limit
  (seed via API) and refuse it with a clear reason, or document why it is allowed.
- Documents page: the document itself is about 3990 px tall while the app shell is 900 px;
  scrolling the page instead of the main column shows an empty page. Fix the overflow.
- The two flaky spans-resize pending-mark drag browser tests are fixed or stabilised.
- Native test server: `ontocurator-local/config.ps1` readiness wait longer than 5 minutes
  (first start takes longer).

## Testing

- Backend: annotation-from-proposals workspace (targets = newest tool proposal set),
  counting towards annotations per text (per version), mode lock per text (including
  submitted work of revoked assignments), an assignment opening only its own mode, project
  setting and plan override, new text versions, removal that discards the draft, export
  fields; consolidation one-term rule, removal of keep-both, tool-proposal marker; legacy
  removal (task, mode, migration deleting and converting the legacy rows).
- Frontend unit tests for the text card states (each segment, each state above), assignment
  removal confirmation, the "myself" hint, selection bar only for 2+, D2 wording.
- Browser specs: annotation from proposals end to end on an imported T1 bundle (assign,
  work with J/K and 1–4, submit, compare, consolidate, accept); text card flows;
  consolidation table with 3 people; text view Show/Compare (lead and annotator).
- Manual acceptance afterwards on the native test server with e3c-proposals.
