# Editor: carried-finding review, rounds and sidebar: design

Status: design proposal, 2026-10-19; not agreed, not implemented.
Source findings: F34, F35, F36, F37 and F44 in the [walkthrough UX analysis](../reviews/2026-10-19-candidate-walkthrough-ux-analysis.md) (cluster 1 and the F44 proposal) and the [analysis handoff](../reviews/2026-10-19-candidate-walkthrough-analysis-handoff.md).
Mockups: `.superpowers/mockups/editor-carried-review/` (`index.html` links all five). Where a mockup and this spec differ, this spec wins.
Sibling spec: [Documents as the lead's table](2026-10-19-documents-lead-table-design.md). Its **Shared rules** (person label, round numbers, times, submission label, long IDs, icons, status shapes, disabled actions) apply here unchanged and are not repeated. `InlineConfirm` is defined there.

## Goal

An annotator who continues from their own submitted work sees one list of findings, knows which carried findings still need a check and what exactly to check, and finishes each check with one explicit action. Rounds and submissions are told apart by plain names and numbers, not by states such as "superseded" or by IDs. Dialogs can always be closed without scrolling. Translation reviewers understand what a failed automatic check means and what to do about it. The left editor column can be widened.

## Current state (verified in code and live)

- `tasks/RoundInputPanel.tsx` renders "Review carried findings" as a second list above "Saved findings" (`app/CaseScreen.tsx:2174` and `:2306`). Each input row has up to four actions ("Inspect original evidence" in quiet style, "Open saved finding", "Complete carried finding review", "Dismiss carried input") and a "Result finding" select, even when `mapping_status === "carried"` already defines the target. In the 260px column the select is truncated ("Seizure · No text span · input-c…") and the list marker hangs outside the panel.
- Carry-forward seeds every mapped input into the draft as a finding with ID `input-{input_id}` (`application/work_rounds.py:396-431`, `repository._create_draft`). Inputs whose evidence could not be mapped get `target_snapshot = null` and `mapping_status = "needs_review"`. The `ReviewReason` from `domain/reanchor.py` (for example `missing_evidence`, `ambiguous_evidence`) is not stored in the input payload.
- `RoundInputResolution` is `{input_id, outcome: completed|dismissed, annotation_ref?, reason?}`. "Completed" must name a current finding of the same layer and type (any finding, not necessarily the carried one). A later edit of that finding makes the completion stale: the frontend ignores it (`currentRoundInputResolution`), the backend rejects submission with `ROUND_INPUT_RESOLUTION_STALE`. There is no operation that clears a resolution.
- The submit dialog blocks with "N carried finding(s) still need review" and a button that focuses the first pending select (`CaseScreen.tsx:2704-2713`). Submit is natively disabled.
- `RoundInputEvidenceDialog` and `WorkRoundsDialog` pass Close as children, so it scrolls with the body. `ui/Dialog.tsx` has an unused `footer` prop and no header close control.
- `WorkRoundActions` shows the raw round state ("superseded", "editable") and "Historical round". Kinds read "Ordinary round", "Carry-forward annotation". Sources read `v{n} · lang · document_id · ISO time`. When the active round is editable, the assignment's `last_submission_id` is cleared, so the source list is empty and the dialog says "No eligible submitted work is available to carry forward" without the reason.
- The editor's "Submission history" lists `view.submissions`, which are the submissions of the current workspace key only (`application/workspaces.py:378`). A new round has none, so it says "No previous submissions yet" while the lead sees two submissions of the same task.
- `translation/ReviewParts.tsx` writes label, detail and `<code>` in one line; the accessible text reads "Synthetic check exampleunits_added". Only two codes have labels (`units_added`, `numbers_changed`); check records carry no text position.
- Sidebar width is fixed: 260px (`editor.css:63`, again in the tree grid `:821`), 220px at ≤1024px (`:660`, `:664`, `:852`), inspector 380px. The mention resize handle's focus ring uses `--accent-light` (`editor.css:632`), about 1.1:1 against the sheet.

## Decisions proposed

1. **One findings list.** The carried-input panel is removed. Carried findings are ordinary rows of "Findings" with a check state.
2. **Check in the inspector.** Selecting a carried finding shows a "Carried finding" section at the top of the inspector with what to check, "Show original evidence" (secondary) and "Mark as checked" (primary).
3. **Exception path only without a carried target.** "Link to an existing finding" and "Dismiss with reason" appear only when the input has no finding on this text (mapping failed, or the carried finding was deleted). A carried finding that exists can additionally be dismissed with a reason from the inspector ("Does not apply…"), which removes it from the draft atomically (see Resolved questions 1).
4. **Rounds and submissions are two labelled facts.** "Round: replaced by Round 3" and "Submission: submitted 19 Oct, 00:57" are shown side by side; "superseded", "carry-forward" and "Historical round" disappear from the UI.
5. **The editor shows all own submissions of the task**, across rounds, in the sibling spec's table format without the Final column.
6. **`Dialog` gets a header close button and a fixed footer**; every long dialog puts its actions in the footer.
7. **Each translation check code gets a plain explanation**, a separate "Technical code" line, the statement that it has no text location, and guidance for justified deviations.
8. **The left column is resizable** with a keyboard-operable separator, persisted per user in `localStorage`.

## Terms

- **Carried input:** one row of `round_inputs` in a carry-forward round, frozen at round creation.
- **Carried finding:** the draft finding whose `annotation_id` equals the input's `target_snapshot.annotation.annotation_id` (any version). It exists from round creation unless the input could not be mapped or the user deleted it.
- **Source round:** the round of the input's `source_submission_id`, numbered per the shared round-number rule.
- **Check state** of an input (derived, never stored separately):

| State | Derivation | Badge (text + shape) |
|---|---|---|
| Check needed | No resolution | `StatusBadge tone="warning"` "Check needed" (ring) |
| Check needed, changed after check | Resolution `completed`, the named finding still exists but in another version | "Check needed" plus the line "Changed after your check" |
| Check needed, finding removed | Resolution `completed`, the named finding no longer exists | "Check needed" plus the line "The linked finding was deleted" |
| Checked | Resolution `completed` naming the current version of a draft finding | `tone="success"` "Checked" (check) |
| Dismissed | Resolution `dismissed` | `tone="neutral"` "Dismissed" (cross) |

The "changed after check" rule is today's `currentRoundInputResolution` behaviour, made visible. Unchecked = the three "Check needed" variants.

## 1. Findings list (sidebar)

The sidebar section header reads **"Findings (n)"** (today "Saved findings"). In a carry-forward round it adds a second header line:

- Progress, `role="status"`: "0 of 1 checked"; with dismissals "2 of 5 checked, 1 dismissed"; when nothing is left: `IconCheck` + "All carried findings checked".
- **"Next unchecked"** (quiet small button with `Kbd` "N") while any input is unchecked. It selects the next unchecked row after the current selection, wrapping around, and scrolls it into view (`block: "nearest"`).

Rows keep their draft order; a state change never moves a row. Carried findings were seeded first, so they lead the list. Each row keeps today's content (term, "Spanless" or mention count, axis summary, existing "Defaulted axes" badge, provenance badge) and adds, only for carried inputs:

- The check-state badge after the term.
- A meta line "Carried from Round 2" (for "Checked" rows too, so the origin stays visible).
- While unchecked, one instruction line derived from data (see table). It is plain text in `text-muted`, at least 12px, and wraps.

| Data | Instruction line |
|---|---|
| Carried finding without evidence | "No text span. Check that it still applies to this text." |
| Carried finding with evidence, same text hash as the source | "Check the marked text and the values." |
| Carried finding with evidence, other text hash (corrected text) | "The text changed since Round 2. Check the marked text and the values." |
| Changed after check | "Changed after your check. Check it again." |
| No carried finding (mapping failed) | "Could not be placed on this text. Mark it again, link it or dismiss it." |
| No carried finding (deleted in this round) | "You deleted the carried finding. Link another finding or dismiss it." |

Inputs without a carried finding appear as **placeholder rows** at their input position (before the seeded findings, in input order): term name, badge, "Not on this text" in place of the mention count, the instruction line. They are selectable like findings (`data-list-key="input:{input_id}"`) and open the exception inspector (section 3). Dismissed placeholder rows stay in the list, muted, with "Dismissed: {first 60 characters of the reason}".

A finding linked through the exception path shows "Checked" and the meta line "Linked to carried Seizure (Round 2)". If several inputs link one finding, the meta line reads "Linked to 2 carried findings" and the inspector lists them.

The editor toolbar badge "Review carried findings" becomes **"Round 3 · continued from Round 2"** (full identity in `title`). Ordinary rounds keep their mode badge.

## 2. Inspector: carried finding

When a carried finding is selected, a section **"Carried finding"** (`<section aria-labelledby>`, `<h3>`) sits above the term heading, in the slot where `ProposalSource` sits for proposals. Content while unchecked:

1. Badge "Check needed".
2. Origin line: "Carried from Round 2 (submitted 19 Oct, 00:57)" with the time as `<time>`.
3. "What to check", a short `<dl>` built from data:
   - **Text span:** "None. This finding had no text span in Round 2 either." / "Same text as in Round 2 (de v1)." / "The text was corrected since Round 2 (v1 → v2). The span was moved; check that it still covers the finding."
   - **Values:** "Carried unchanged. Carrying does not confirm values." plus, when the finding has defaulted axes, "Not confirmed: Temporality." (existing defaulted rule; nothing is confirmed by this section).
   - **Note:** the first line of the source note, with "Show full note" when longer. Omitted when there is no note.
4. Actions: **"Mark as checked"** (primary) and **"Show original evidence"** (secondary). No other actions here; editing, deleting and term change stay in the normal inspector below.
5. Hint under the actions: "Any later change to this finding needs a new check."

"Mark as checked" first flushes unsaved annotation notes (as `resolveCarriedInput` does today), then saves `outcome: "completed"` with the carried finding's current `annotation_id` and `version`. It never changes values, evidence or the defaulted marker.

After success the section collapses to one line: `IconCheck` "Checked · Carried from Round 2 (submitted 19 Oct, 00:57)" with "Show original evidence". If unchecked inputs remain, "Next unchecked" appears in that line. Focus moves to the collapsed line (`tabindex="-1"`). The live region announces "Seizure checked. 1 of 1 checked." The selection does not move.

When the finding changes after the check (term, values, evidence, note), the section returns to the unchecked layout with the extra line "You changed this finding after checking it. Check it again." No dialog interrupts the edit.

Read-only (submitted round, paused task, viewing an older version): the section shows the state and origin, "Show original evidence", and no "Mark as checked". A paused task adds "Checks are unavailable while the task is paused."

## 3. Exception path (no carried finding)

Selecting a placeholder row shows the **"Carried finding"** section without the editable inspector below it:

1. Badge "Check needed" and the origin line.
2. The reason: "Its text span could not be found in this text." (mapping failed; with a stored `ReviewReason`, a specific sentence, see API) or "You deleted the carried finding in this round."
3. The original, read-only: term, values with labels, note, original quote in quotation marks (or "No text span").
4. Actions, in this order:
   - **"Mark in text"** (primary): starts the existing attach mode with the original term preselected ("Select supporting text to re-create Seizure."). Saving the new finding links it automatically as the result **finding only**; the input stays "Check needed" until "Mark as checked" (no auto-complete). See open question 2.
   - **"Link to an existing finding…"** (secondary): opens an inline chooser below the button (radio group, not a select). Each option is labelled by term and quote: "Seizure · “Krampfanfälle werden …”" or "Seizure · no text span"; options are findings of the same layer and type. A disclosure "Technical details" under each option holds its ID. Confirm with "Link and mark as checked"; "Cancel" returns focus to the trigger. With no eligible finding the chooser says "No finding of this type exists on this text. Mark it in the text first." and offers no confirm.
   - **"Dismiss with reason…"** (quiet): opens `InlineConfirm` with a required textarea "Why does this finding not apply to this text?" (at least 3 rows), primary "Dismiss", "Cancel". Activation without a reason shows "Give a reason to dismiss this finding." (button stays focusable, `aria-disabled`).

Deleting a carried finding uses the existing delete confirmation with one added sentence: "This is a carried finding. After deleting it, you must link another finding or dismiss it with a reason." The row then becomes a placeholder row, selected, with "Dismiss with reason…" focused.

A dismissed input shows its reason, who dismissed it ("You") and "Link to an existing finding…" (a link replaces the dismissal, which the API already allows). There is no undo of a dismissal (open question 3).

## 4. State transitions

| From | Action | To | Visible change |
|---|---|---|---|
| Check needed | "Mark as checked" | Checked | Badge, section collapses, progress, announcement |
| Check needed (placeholder) | "Link and mark as checked" | Checked | Placeholder row stays muted with "Linked to {term}"; the linked row shows "Checked" |
| Check needed (placeholder) | "Dismiss" with reason | Dismissed | Badge, reason line, progress |
| Checked | Edit of the finding | Check needed, changed after check | Badge and instruction line; progress decreases |
| Checked | Delete of the finding | Check needed, finding removed → placeholder | Row becomes placeholder; progress decreases |
| Dismissed | "Link and mark as checked" | Checked | As above |
| any | Server rejects as stale | unchanged | Error in the section: "This finding changed before the check was saved. Check it again." |

Nothing moves to Checked or Dismissed without one of these explicit actions. The round's history (inputs, source snapshots, earlier submissions) is never changed.

## 5. Submit dialog

The dialog keeps its checks; the carried part changes:

- Summary line: "1 carried finding still needs a check" (error `InlineMessage`), followed by one line per unchecked input: term, instruction line, and a button **"Go to Seizure"**. It closes the dialog, selects the row (switching to the Details pane on narrow screens), and focuses "Mark as checked" (or, on a placeholder, the first exception action).
- Above the list, **"Go to first unchecked"** does the same for the first one. Up to five rows are listed; more show "and 3 more" (reached with "Next unchecked").
- **Every problem in the dialog is directly reachable (user request 2026-10-19).** Not only carried checks: each listed item (unchecked carried finding, finding with unconfirmed clinical values, any other blocking or warning condition that refers to a finding or text place) has its own "Go to {term}" button. It closes the dialog, selects the finding, scrolls the text to its mark (if it has one) and focuses the exact control that resolves it: "Mark as checked" for carried checks, the first unspecified axis field for unconfirmed values. The generic "Review these findings" button is replaced by these per-item links (more than five items: "and n more", reachable via "Next unchecked" / a "Next open item" shortcut).
- **Way back to submitting.** While items from the dialog are still open, the toolbar's submit button shows the remaining count ("Finish & Submit · 1 open") and a quiet "Next open item" link appears next to it, so the user can work through the list without reopening the dialog each time. Reopening the dialog shows the current state.
- "Submit case" stays focusable with `aria-disabled="true"` and `aria-describedby` pointing to "Check 1 carried finding before submitting." Activation announces that sentence. It is no longer natively disabled; the other existing blocking conditions follow the same pattern.
- Submit and Cancel move into the dialog footer.

## 6. Original evidence dialog

Title "Original finding from Round 2". Content order:

1. One line: "Submitted 19 Oct, 00:57 · de v1 · ann-0004".
2. The original facts: term, values with axis labels ("Assertion: Present"), note, and either the quote(s) or "This finding had no text span in Round 2."
3. The original text with its marks (`ReadOnlyAnnotationView`). For a finding without evidence the text starts collapsed under "Show Round 2 text".
4. "Technical details" (collapsed): submission ID, original annotation ID and version.

When the exact original text is unavailable (hash mismatch), items 1, 2 and 4 still show, with the error in place of item 3. Close is in the fixed footer and in the header.

## 7. Rounds (F37)

### Identity line

One wording everywhere a round is named (toolbar title, Work rounds, My submissions):
"Round 3 · continued from Round 2 submission (19 Oct, 00:57) · de v1". Variants: "Round 1 · started empty · de v1"; "Round 4 · restarted empty after agreement with the lead"; "Round 2 · consolidation of 2 submissions". The text version uses the sibling spec's version wording.

### Work rounds dialog

Title "Work rounds · {text ID} · {language}". Intro sentence only: "Each round keeps its starting point and its submissions. Starting a round does not change the final result."

A table (`DataTable`, compact) with one row per round, oldest first:

| Column | Content |
|---|---|
| Round | "Round 3" and the identity line's starting point ("from Round 2 submission"); "You are here" marker (`aria-current="true"`, text and shape) on the round open in the editor |
| Round state | "Open" (editable), "Submitted" (submitted), "Replaced by Round 3" (superseded), "Discarded by restart" (abandoned) |
| Submission | "Submitted 19 Oct, 00:57"; "2 submissions, latest 19 Oct, 00:57"; "Not submitted yet" |
| Carried | "1 finding" (input count); "None" |
| Actions | "Open" (named "Open Round 3"); none on the current round |

Round state and submission are separate columns, so "Replaced by Round 3" and "Submitted 19 Oct, 00:16" appear together for Round 1. Technical IDs move to a "Technical details" disclosure under the table.

**Start a new round** section below the table:

- Available: a radio group "Continue from" with one option per eligible own submission, labelled "Round 2 submission · 19 Oct, 00:57 · de v1 · 1 finding". One consequence sentence: "Round 2 stays in the history. Every carried finding must be checked again; carried values are not confirmed." Primary footer action "Continue from this submission".
- Unavailable, with the reason derived from data:
  - Active round editable: "You can continue from a submission once Round 3 is submitted. Round 3 is still open."
  - Task paused: "The task is paused. Resume it before starting another round."
  - No own submission on this text: "There is no submitted work of yours on this text yet."
- "Start empty round" stays as today (only for an untouched open task).

Footer: the primary action when available, and "Close".

### My submissions (editor sidebar)

"Submission history" becomes **"My submissions"**: a read-only list of the user's own submissions on this task across all rounds, oldest first, in the sibling spec's table format without the Final column and without selection actions: "Round 1 · 19 Oct, 00:16 · 1 finding · View". When the current round has none, the list adds the muted line "Round 3 · not submitted yet". "View" opens the existing historical-submission dialog, which gets the submission label as heading and the footer Close.

## 8. Dialog component (F35)

- `Dialog` renders a header row: the heading and, when `onClose` is set, an `IconButton` "Close" (`IconClose`, quiet, small). It obeys the same suppression as Escape (busy dialogs pass no `onClose` or ignore it).
- `.ui-dialog-body` scrolls; the header and `.modal-actions` footer stay visible (`max-height: min(90vh, …)` with a flex column).
- Close or Cancel always sits in the footer of: original evidence, Work rounds, historical submission, submit, task problem reports.
- "Case submitted" keeps no Escape and no header close (DESIGN.md rule).
- Below 700 px a `size="md"` dialog is a full-height sheet with `space-4` margins and the footer fixed (from the problem-reports spec "Narrow viewports"; implemented with this section, plan WP F1).
- Focus: the header close button is first in DOM order, but initial focus goes to `initialFocus` or the first focusable element of the body, never to the close button. When the body has no focusable element, the dialog itself receives focus (as today).

## 9. Translation checks (F36)

Each failed check in "Automatic translation checks" becomes a small block:

1. `<h3>` the check label ("Units added in translation").
2. **What it means:** the plain explanation for the code (table below).
3. **From the translation run:** the `detail` string, if any, as quoted text.
4. "This check does not point to a text location. Compare the source and the translation yourself."
5. **If the translation is right anyway:** "Choose Accepted unchanged and say in the rationale why the difference is correct. If it changes the clinical meaning, choose Query or Rejected with the category Number or unit."
6. "Technical code: `units_added`" on its own line (`<dl>`), so screen readers read "Technical code: units_added".

| Code | Plain explanation (draft, to be confirmed by the translation pipeline owners) |
|---|---|
| `units_added` | "The translation run's check found a unit of measurement in the translation that it did not find in the source." |
| `numbers_changed` | "The translation run's check found numbers in the translation that differ from those in the source." |
| unknown | "The translation run reported this check as failed. Ontocurator has no description for it; ask the project lead what it checks." |

The "Show all checks" list uses the same structure in one line per check: badge, label, and the technical code as a separate labelled line. No text position is ever derived or invented; there is no highlight in the text for a check.

## 10. Resizable sidebar (F44)

- **Separator:** an element between sidebar and text pane, `role="separator"`, `aria-orientation="vertical"`, `aria-controls` the sidebar, `aria-label="Resize findings column"`, `aria-valuenow` (px), `aria-valuemin`, `aria-valuemax`, `aria-valuetext="320 pixels (default 260)"`, `tabindex="0"`. Hit area 16px centred on the border; visible grip 4×32px in `border-strong` (≥3:1), centred vertically in the viewport-visible part; the border line itself stays 1px.
- **Pointer:** drag with pointer capture; `cursor: col-resize`; width updates per animation frame; Escape during a drag restores the width from drag start; double-click resets.
- **Keyboard:** Left/Right ±16px, Shift+Left/Right ±64px, Home = minimum, End = maximum, Enter = default. Registered through `useShortcutHint` (group "Layout") so `?` lists "Resize the findings column (focus the divider)".
- **Limits:** minimum 220px; maximum `min(480px, 35vw, viewport − inspector − 420px)` in three columns, `min(480px, 35vw)` in the two-column layout (701–1024px). The text column keeps its reading measure as its maximum (`--measure-reading`); a wider sidebar may narrow and re-wrap the text, which is the deliberate result of resizing. Selecting or checking a finding never changes any width.
- **Variable:** `.app-layout` gets `--sidebar-width`, used by `.sidebar` and by both tree grids (`editor.css` 821, 852, 660). The default is 260px above 1024px and 220px from 701 to 1024px.
- **Persistence:** the preferred width is stored per user in `localStorage` under `ontocurator.editor.sidebarWidth.v1:{username}` after drag end or 300ms after the last key; applied clamped to the current limits; invalid values are ignored. Reset (Enter, double-click) removes the key. No server storage.
- **Narrow:** at ≤700px the separator is not rendered; the pane tabs apply. The tab "List" becomes "Findings" and, in a carry-forward round, "Findings, 1 to check".
- **Focus:** the separator's focus ring is `--focus-width` solid `--focus-ring` with `--focus-offset`. The same fix applies to the existing mention edge handle: `.resize-handle:focus-visible::before` uses a `--focus-ring` outline (2px) instead of the `--accent-light` shadow.
- **Forced colors:** grip in `CanvasText`, focus in `Highlight`.

## Keyboard and screen reader summary

| Key | Where | Action |
|---|---|---|
| N | Editor, carry-forward round, not typing | Next unchecked (wraps) |
| Shift+N | same | Previous unchecked (handler checks `event.shiftKey`; single-character bindings ignore Shift) |
| Tab | Inspector | Reaches "Mark as checked" first in the carried section |
| Left/Right, Shift, Home/End, Enter | Separator | Resize, reset |
| Escape | Dialogs, `InlineConfirm`, drag | Close / cancel / restore width |

"Mark as checked" has no single-key shortcut (open question 4). Announcements go to one polite live region: check results, progress changes after edits ("Seizure needs a new check. 0 of 1 checked."), dismissals, separator value is announced natively. Badges have text, never colour alone. Placeholder rows are `button` items like other rows, named "{term}, carried, not on this text, check needed".

## Narrow viewports

- ≤700px: one pane at a time. Selecting a row switches to Details as today; the carried section is first in Details. "Next unchecked" exists in the list header and in the carried section, so the user can move on without switching panes.
- The submit dialog's "Go to Seizure" switches to Details.
- Work rounds table becomes one card per round (label/value pairs); the radio group stacks.
- All targets are at least 24×24px; reflow verified at 320 CSS px.

## Loading and errors

- "Mark as checked", link and dismiss show `loading` on the button (focus kept, `aria-disabled`); other check actions in the section are unavailable meanwhile.
- Network or 500: "Could not save the check. Nothing changed." with "Retry" in the section.
- Stale (`ROUND_INPUT_RESOLUTION_STALE`): the message in section 4; the section re-renders from the current draft.
- Revision conflict: the existing editor conflict banner applies; no check state is assumed.
- Unsaved note: "Save the note first." with "Save note and mark as checked".
- 401: `AuthGate` keeps the screen; nothing is reported as checked.
- Work rounds load failure: error with "Retry" inside the dialog (as today). Source list empty for an unknown reason: "No submission can be continued right now." plus "Reload task state".

## API and backend changes

All additions are read-only fields unless stated; access rules unchanged.

| Addition | Purpose |
|---|---|
| `RoundInputView`: `source_round_ordinal`, `source_recorded_at`, `source_language`, `source_version`, `review_reason` (nullable; the `ReviewReason` of a failed mapping, stored in the input payload for new rounds, null for existing ones) | Origin line, identity, specific exception reason |
| `WorkRoundView`: `round_ordinal`, `created_at`, `submission_count`, `latest_submission_recorded_at`, `input_count`, `source_round_ordinal`, `document_language`, `document_version` | Work rounds table and identity line |
| `RoundSourceView`: `round_ordinal`, `recorded_at` (server time; today the client-supplied `created_at`), `finding_count` | "Continue from" options |
| `GET /assignments/{id}/submissions`: own submissions of the assignment across rounds (owner and leads), with `round_ordinal`, `recorded_at`, `finding_count`, `submission_id` | My submissions |

The state derivation stays in the frontend (a pure function replacing `currentRoundInputResolution`, returning the variant), backed by the unchanged backend validation. `contracts/openapi.json` and `frontend/src/api/generated.ts` are regenerated.

## Contracts preserved

- Every carried input needs an explicit resolution before submission (`ROUND_INPUTS_INCOMPLETE`, `ROUND_INPUT_RESOLUTION_STALE` unchanged).
- Nothing completes automatically: not unchanged spans, not "Mark in text", not linking without the confirm action.
- Carried values are never confirmed by checking; defaulted markers stay.
- Dismissal always has a reason; dismissed inputs stay in the round and submission history.
- The original snapshot stays viewable, read-only, with exact text and marks.
- Round history, inputs and earlier submissions are never changed or hidden; starting a round never changes a final result.
- Exact text coordinates are untouched; no check position is invented; selecting a finding never shifts the layout.

## Testing

- **Unit:** check-state derivation (all five variants, linked finding, two inputs to one finding, legacy draft where a carried finding exists but another finding is linked); instruction lines per data case; identity line wording per round kind; carry-forward unavailable reasons; sidebar clamp (viewport sizes, stored values out of range, invalid values).
- **Component:** findings row badges and meta line; inspector section states and focus after check; exception chooser (radio labels, empty case, cancel focus); dismiss `InlineConfirm`; `Dialog` header close and fixed footer (Escape parity, busy suppression); separator keyboard (16/64px, Home/End, Enter reset, aria values); translation check block (accessible text "Technical code: units_added", unknown code).
- **Browser (Playwright):** carry-forward round with a spanless carried finding and one added finding (the T5 data shape): check, edit after check, delete then dismiss, link, submit dialog "Go to Seizure"; needs-review input from a corrected text; Work rounds with Rounds 1–3 and the "still open" reason; My submissions across rounds; original evidence dialog at 900px height with Close visible; sidebar resize by pointer and keyboard, persistence across reload, reset, 1024px and 700px transitions; 320px reflow; forced colors; focus-ring contrast ≥3:1 on separator and mention handle.

## Resolved questions (user decisions 2026-10-19)

1. **Dismissal is atomic.** "Dismiss with reason" on a carried finding that still exists removes it from the draft and records the dismissal in one mutation; the backend rejects a dismissal while the carried finding remains in the draft.
2. **"Mark in text" is part of this batch** for inputs without a carried finding (re-create with the original term via the existing attach/re-anchor mode, then "Mark as checked").
3. **Dismissal can be undone** until the round is submitted: "Undo dismissal" resets the input to "Check needed" (new API operation that clears the resolution; recorded as an event, history kept). If the dismissal removed the carried finding (Resolved 1), undo restores that finding exactly as it was at the moment of the dismissal (same values, note and evidence) in the same operation (user decision 2026-10-19).
4. **Check-code explanations** (`units_added`, `numbers_changed`, …) are drafted in this spec and confirmed by the user before release.
5. **Leads see check states read-only:** opening a submitted carry-forward round shows Checked / Dismissed per input with dismissal reasons.
6. Decided by default: single key **C** for "Mark as checked" (listed in keyboard help, never fires in inputs); a source submission from another assignment is named "Round n · {author} · v{version}" per the shared label rule; sidebar width is stored per user for all projects.
7. **The toolbar open count is shown whenever open items exist** ("Finish & Submit · n open" with "Next open item"), not only after the submit dialog was opened (user decision 2026-10-19; overrides "While items from the dialog are still open" in section 5).
8. **Round inputs access stays as it is.** `GET /api/v1/rounds/{round_id}/inputs` already reads through the scoped repository (owner or users allowed to export all work); there is no cross-user leak. The implementation adds regression tests (owner, lead, another annotator on the same document, outsider) and keeps reads scoped during enrichment (user decision 2026-10-19).

## Out of scope

The Documents table and final-result selection (sibling spec), problem reports and lead actions (cluster 2), project picker and My tasks filter (F40, F41), export (F47, F48), the re-anchor panel after text correction (it keeps its own panel; aligning it with this model is a follow-up), and consolidation merge inputs.
