# Translation review, annotation term loop and editor polish: design

Status: Approved by the user 2026-10-20; not implemented.
Source: UX critique snapshot `.impeccable/critique/2026-10-20T08-45-58Z__frontend-src.md` (P1 "translation review buries the texts", P1 "check guidance contradicts the form", P2 "term loop", minor list) and its screenshots in `build/phase0-ux/evidence/critique-20261020/`.
Mockups: `.superpowers/mockups/review-annotation-20261020/` (`index.html` links all three). Where a mockup and this spec differ, this spec wins.
Builds on: [Editor: carried-finding review](2026-10-19-editor-carried-review-design.md) (its section 9 "Translation checks", the carried keys N/C, the `Dialog` footer) and [Quick fixes and export](2026-10-19-quick-fixes-and-export-design.md) (Q2/Q9 My tasks). Deviations from them are listed in "Deviations from earlier specs". The shared rules of the [Documents spec](2026-10-19-documents-lead-table-design.md) (person label, times, icons, status shapes, unavailable actions with `aria-disabled` and a described reason) apply unchanged.
Method: impeccable `shape` brief inside the established Direction C world (no new visual direction, no new tokens). The discovery interview was skipped on request; the domain decisions are recorded under "Resolved questions".

## Job, users and outcome

| Part | Who arrives | State of mind | Must do | Success |
| --- | --- | --- | --- | --- |
| A. Translation review | Bilingual reviewer (clinician or trained translator), one text after another from My tasks | Comparing two texts sentence by sentence; checks are a hint, the texts are the evidence | Read source and translation side by side, correct the translation if needed, decide, submit, continue | Both texts dominate the first viewport; the form never contradicts its own guidance; next task in one step |
| B. Annotation term loop | Annotator, hours per session | Reading closely, marking finding after finding | Mark text, choose the term, confirm or set the values | One finding in 3 actions when the top hit and defaults are right; no mouse trip to the search; keys for values |
| C. Polish | Everyone in the editor; leads in Settings | First-time users read labels literally | Understand where they are and what a control does | No jargon, one way back, a visible type hierarchy |

Product truths that bind every choice: the text comes first (nothing moves, hides or crowds it while it is read or marked); every decision is explicit and traceable; meaning never by colour alone; calm over clever. English UI, light theme, offline, WCAG 2.2 AA, full keyboard operation.

## How clicks are counted

An **action** is one pointer click or one non-typing keystroke that the task requires (Enter, a shortcut, Tab to a control counts as zero when focus already lands there). Typing a query or a rationale is listed separately as "typing". Scrolling the page to reach a control is listed as "+scroll". Counts assume the decisive control is visible after the previous action.

---

## A. Translation review

### A.0 Current state (verified in code and screenshots)

- At 1440×900 the screen stacks: shell header (64 px), review bar with "Back to my tasks", title, meta (≈120 px), the "Automatic translation checks" block (`ReviewParts.tsx` `ChecksSummary`, ≈340 px for one failed check: label, "What it means", "From the translation run", no-location sentence, "If the translation is right anyway", "Technical code"), "Show all checks", the text toolbar ("Show changes", "Couple scrolling" disabled with "Coupled scrolling is available in read-only views."), then the texts. About 4 lines of each text are visible; the decision rail shows two of four options; 554 words above the fold.
- At 800 px everything is one scrolling page; Submit is at y≈1930.
- `labels.ts:87` `checkDeviationGuidance`: "Choose Accepted unchanged and say in the rationale why the difference is correct." `ReviewForm.tsx` hides the rationale for Accepted unchanged (`showRationale` is false unless text is already present). The guidance cannot be followed.
- The backend (`domain/translation_review.py`) accepts a rationale for every decision. It **requires** `clinical_change = true` for Query and Rejected (`CLINICAL_CHANGE_REQUIRED`), and with a clinical change at least one category and a non-blank rationale. Accepted unchanged forbids a clinical change and changed text; Accepted with corrections requires changed text.
- The reviewer must pick "Accepted with corrections" by hand after editing, although `checkReview` already knows the text changed (`TEXT_UNCHANGED` / `TEXT_CHANGED`).
- After submit the rail shows "Review submitted" and nothing else; the reviewer goes back to My tasks and presses Start on the next row. The annotation editor already has "Next task" after submit (`CaseScreen.tsx:3027`).
- My tasks (`TaskSummary`) carries no check information; a failed-check text looks like any other.
- `Ctrl+Enter` submits (asks for confirmation). There are no decision keys.

### A.1 Decisions

1. **Texts own the viewport.** Header compressed to one bar; checks to one line; text toolbar folded into the translation column head; texts fill the remaining height.
2. **Checks: one-line summary plus disclosure.** "1 automatic check failed: Units added in translation · Details". Details hold the explanation, the run's detail, the guidance and, under "Technical details", the code. "Show all checks" moves inside Details.
3. **Decision rail pinned** at ≥1100 px: own scroll, footer with Submit always visible. Below 1100 px the decision follows the texts and a pinned bottom bar keeps decision and Submit reachable.
4. **Rationale is shown for every decision** once a decision is chosen: optional for both Accepted decisions, required with a clinical change. When checks failed and the decision is Accepted unchanged, the hint asks for it (resolved question 1).
5. **Auto-select "Accepted with corrections"** when the text is edited, visibly, and undo the auto-selection when the edit is reverted (A.4).
6. **Clinical change implied for Query and Rejected.** The checkbox is replaced by a fact line; categories and rationale appear as required at once.
7. **"Next task" after submit**, focused.
8. **Failed-check flag in My tasks** (needs one backend field).
9. **Decision keys 1–4** outside the text field, matching the order of the editor's review keys.
10. **"Couple scrolling" is hidden while it is unavailable**; no explanatory sentence in the toolbar.

### A.2 Layout at ≥1100 px (mockup 01, "After A1")

Top to bottom, budget at 1440×900:

| Band | Height | Content |
| --- | --- | --- |
| Shell header | 56–64 | Breadcrumb "My tasks / failed-translation · Translation review (de)" (C.4), project, user |
| Review bar | 52 | h1 document name (`title` 22/28 serif) · meta "English → German · Translation details" (disclosure, unchanged content) · right: Report problem, save badge, Reload from server. The "Back to my tasks" link is removed (the breadcrumb is the way back; see C.3). |
| Check summary | 40 | See A.3 |
| Work area | rest (≈690) | Grid: texts `minmax(0,1fr)`, rail 360 px |

Texts: two columns (three with a comparison translation, unchanged), gap `space-5`, padding `space-3 space-5 space-4`. Column head 28 px: "Source (en)" / "Translation (de)" and, in the translation head, the "Show changes" checkbox. The comparison select stays in the comparison column head. Each text box fills the column height (`flex: 1`, own scroll); the fixed `min(60vh, 40rem)` height goes. Result: ≈19 lines per text at 30 px leading (today ≈4).

"Couple scrolling" checkbox renders only when coupling is possible (`canCouple && pairing.available`). While coupled, the existing pairing notes appear in the translation column head as one muted line. The "Skip to decision" link stays.

Rail (`aside`, `surface-raised`, left hairline): body scrolls independently; footer pinned (`position: sticky` today, kept) with the submit reason/issues and "Submit review…" plus a muted key hint line "Ctrl + Enter submits · 1–4 choose a decision outside the text". Decision options get shorter hints (copy in A.8) and a `Kbd` with their number at the right edge. "Previous reviews" stays at the end of the rail body.

### A.3 Check summary and details

States of the band:

| Data | Band | Tone |
| --- | --- | --- |
| No checks recorded | "No automatic checks were recorded for this translation." | muted text, no fill |
| All passed | `IconCheck` "All 5 automatic checks passed." + "Details" | muted, no fill |
| 1 failed | `IconWarning` "**1 automatic check failed:** Units added in translation" + "Details" | `warning-light` fill (band, not a boxed notice) |
| n failed | "**3 automatic checks failed:** Units added, Numbers changed and 1 more" + "Details" | as above |

The labels in the line use `checkLabel` without the words "in translation" when more than one is listed (`shortCheckLabel`, new, falls back to `checkLabel`).

"Details" is a disclosure button (`aria-expanded`, `aria-controls`), `IconChevronRight` rotating 90° (instant under reduced motion). Expanded, a region below the band (max width 1080 px, `surface-raised`, max height 40vh with its own scroll) contains per failed check:

1. `h3` label.
2. Explanation + "It does not point to a text location; compare the texts yourself." (one paragraph instead of two).
3. "From the translation run" quoted detail, if any.
4. "If the translation is right anyway" with the corrected guidance (A.8).
5. `details` "Technical details" containing "Technical code: `units_added`".

Then one line "All checks: 4 passed, 1 failed · Show all checks" (the existing list). Expanding pushes the work area down; this is a user-initiated change, so the texts are allowed to move. Collapsed by default on every load (resolved question 2). The disclosure state is not stored.

The whole band is a `section aria-labelledby` with a visually hidden `h2` "Automatic translation checks", so screen-reader navigation by heading is unchanged.

### A.4 Decision form behaviour

Fields shown by state (replaces the rules in the `ReviewForm` comment):

| Decision | Clinically relevant change | Categories | Rationale |
| --- | --- | --- | --- |
| none | hidden | hidden | hidden |
| Accepted unchanged | hidden (not allowed; shown only if a stored draft has it set, so it can be cleared, as today) | hidden (same exception) | shown, optional; hint "Optional." or, when checks failed, "Optional. Say why the flagged difference is correct." |
| Accepted with corrections | checkbox, hint "Tick this if your correction changes the clinical meaning." | when ticked: required, ≥1 | shown; optional, required when ticked |
| Query / Rejected | **fact line** "Clinically relevant change: yes, always for a query." / "…for a rejection." | shown, required, ≥1 | shown, required |

Implied clinical change: choosing Query or Rejected writes `clinical_change: true` into the draft in the same edit as the decision. Switching from Query/Rejected to Accepted with corrections keeps `clinical_change: true` and the categories (the reviewer may untick); switching to Accepted unchanged sets `clinical_change: false` and clears categories (the rule forbids them); the rationale text is always kept. No backend change.

**Auto-selected "Accepted with corrections".** Client-side state `decisionOrigin: "auto" | "user"`, not stored in the draft (the backend form is `extra="forbid"`; adding a key would break submission).

| Situation | Effect |
| --- | --- |
| Text becomes different from the machine text (canonical comparison as in `checkReview`) and decision is none or Accepted unchanged | Decision set to Accepted with corrections, origin auto. A `role="status"` note under the option: "Selected because you edited the translation. You can choose another decision." Announced once politely. If the previous decision was Accepted unchanged chosen by the user, the note reads "Changed from Accepted unchanged because you edited the translation." |
| Text edited while decision is Query, Rejected or Accepted with corrections | Nothing changes. |
| Text becomes equal to the machine text again and origin is auto | Decision returns to what it was before (none, or Accepted unchanged), note "Your edits are undone, so the decision is back to {Accepted unchanged / not chosen}." Announced. |
| Text becomes equal again and origin is user | Decision stays; the existing issue "Accepted with corrections needs changed text." appears in the footer, as today. |
| User picks any decision | Origin user; the note disappears. |
| Reload or reopen | The stored decision is treated as origin user (the auto note is not shown again). |

Equality uses the same canonicalisation as `checkReview` (BOM, line endings, NFC), so whitespace-only line-ending differences do not flip the decision. Auto-selection reacts on the draft update, not on each keystroke render (same debounce as the draft saver is not needed; the comparison is cheap).

This is a silent default only in the sense that the reviewer did not click it; it is visible, announced, reversible and still confirmed in the submit dialog, which lists the decision. See resolved question 3.

### A.5 After submit: Next task

The success state in the rail:

1. `InlineMessage tone="success"` "Review submitted" with the outcome sentence (existing `decisionOutcomes`, plus "A corrected version v2 was created.").
2. Primary **"Next task: {external_id} ({language})"**, focused after success (`focus({ preventScroll: true })`). It opens the next task of the reviewer in My tasks order that is not submitted, in the same project, any task type (resolved question 4).
3. Quiet link "Back to my tasks".
4. Muted line "{n} more open tasks in this project." / "No more open tasks in this project." When there is none, item 2 is omitted and "Back to my tasks" becomes the primary button.

The task list comes from `api.listMyTasks()` fetched after success (fresh, so a task assigned meanwhile counts). The order is `orderTasks` from `app/caseOrder.ts`, which the editor already uses. While loading, the button is `loading`; on error, "Back to my tasks" only plus an inline error with Retry.

The confirmation dialog stays (submission is immutable). Its confirm button stays "Submit review"; focus starts on it, so Ctrl+Enter, Enter submits.

### A.6 Narrow widths

| Width | Layout |
| --- | --- |
| ≥1100 px | A.2 |
| 700–1099 px (mockup "After A5" at 800×900) | Header bands wrap (bar may take two rows). Texts stay side by side (a bilingual reviewer compares in parallel; at 800 px each column is ≈360 px, ≈40 characters of 18 px serif). The text area height is `calc(100dvh - header bands - 60px)`, min 18rem. The decision form follows the texts in the page flow. A **pinned bottom bar** (60 px, `surface-raised`, top hairline, `position: sticky; bottom: 0`) shows "Decision: {label or Not chosen}", a "Change ↓" link that moves focus to the decision legend, and "Submit review…" with the same unavailable/aria rules as the rail footer. |
| <700 px | Texts stack (source, then translation), each 50dvh max with own scroll; decision form below; same pinned bar. The existing `translation-skip` link stays. |

At 800×900 with one failed check: ≈19 lines across both columns are visible before the bar; Submit is always visible (today at y≈1930).

### A.7 My tasks: failed-check flag

Backend: `TaskSummary` gains `failed_check_count: int | null` (null for non-translation tasks; for `translation_review` the number of failed checks of the reviewed variant's translation run, the same list as `workspace.failed_checks`). Read-only, no migration (derived at query time from the stored run checks). Size S.

Frontend (`tasks/MyTasks.tsx`): for rows with `failed_check_count > 0`, the Task cell gets a second line with `IconWarning` and text "1 automatic check failed" / "n automatic checks failed" in `warning` colour on no fill (text plus icon, never colour alone). The row's accessible name includes it. No new column, no sort change. Quick-fix Q9 counts are unaffected.

### A.8 Copy (A)

| Where | Today | New |
| --- | --- | --- |
| Check band | (block) | "{n} automatic check(s) failed: {labels}" · "Details" / "Hide details" |
| Calm band | "All automatic checks passed." | "All {n} automatic checks passed." |
| Guidance (`checkDeviationGuidance`) | "Choose Accepted unchanged and say in the rationale why the difference is correct. If it changes the clinical meaning, choose Query or Rejected with the category Number or unit." | "Choose Accepted unchanged (or Accepted with corrections if you edited it). You can say in the rationale why the difference is correct. If it changes the clinical meaning, choose Query or Rejected with the category Number or unit." Same wording for every code; "Number or unit" stays only for `units_added`/`numbers_changed`, other codes end after "…choose Query or Rejected." |
| No-location sentence | own paragraph | merged: "It does not point to a text location; compare the texts yourself." |
| Decision hints | long sentences | Accepted unchanged "Correct as it stands. No edits." · Accepted with corrections "Your corrected version is accepted." · Query "Meaning may differ clinically. Not accepted." · Rejected "Changes clinical meaning. Not accepted." |
| Fact line | checkbox + "Required for a query." | "Clinically relevant change: yes, always for a query." / "…for a rejection." |
| Rationale hint | "Optional." / "Required for a clinically relevant change." | as today, plus "Optional. Say why the flagged difference is correct." for Accepted unchanged with failed checks |
| Auto note | — | see A.4 |
| Next task | — | "Next task: {external_id} ({language})", "Back to my tasks", "{n} more open tasks in this project." |
| My tasks | — | "1 automatic check failed" |
| Removed | "Coupled scrolling is available in read-only views." | (control hidden instead) |

Check explanations remain drafts pending `docs/superpowers/reviews/2026-10-19-translation-check-explanations-review.md`.

### A.9 Keyboard and screen reader (A)

| Key | Action | Scope / rule |
| --- | --- | --- |
| 1 / 2 / 3 / 4 | Choose Accepted unchanged / Accepted with corrections / Query / Rejected | screen, group "Translation review", not while typing (so never in the translation textarea or rationale), not when read-only. Same effect as clicking the radio, origin user, focus stays. |
| Ctrl+Enter | Submit review (confirmation) | existing, works in inputs |
| Enter (after submit) | Open next task | focus is on the button; no shortcut needed |

Order matches the editor's review keys (1 confirm, 2 reject …) only by position, not by meaning; help text names each decision so nobody relies on the analogy. The decision radiogroup keeps native arrow-key behaviour. Live announcements: auto-selection notes, submit outcome, "Next task" readiness. Disclosure buttons expose `aria-expanded`. The pinned bar's Submit uses `aria-describedby` to the same reason element as the rail.

### A.10 Click counts (A)

| Flow | Today | After |
| --- | --- | --- |
| Accept unchanged, check failed, then open next task | Accepted unchanged (1), Submit (2), Confirm (3), Back to my tasks (4), Start (5); +scroll at 800 px | 1 (or key 1), Submit (2), Confirm (3), Next task (4, Enter on focused button) → **4, no scroll**; keyboard only: `1`, `Ctrl+Enter`, `Enter`, `Enter` |
| Correct one word, accept, next | typing, Accepted with corrections (1), Submit (2), Confirm (3), back (4), Start (5) | typing, Submit (1), Confirm (2), Next (3) → **3** |
| Accept unchanged with a note on the failed check | impossible without a workaround (rationale hidden) | 1, click rationale (2), typing, Submit (3), Confirm (4) |
| Query | Query (1), tick clinical change (2), category (3), rationale click (4), typing, Submit (5), Confirm (6) | Query (1), category (2), rationale (3), typing, Submit (4), Confirm (5) |

The critique's target "2–3" for accept-unchanged is reached for the decision itself (decision, Submit, Confirm = 3); the fourth action replaces the two-step return to My tasks. Removing the confirmation would reach 2 but is not proposed (immutable submission).

---

## B. Annotation term loop

### B.0 Current state

- Marking text (`handleSelection…` → `setPendingAnnotation`, `CaseScreen.tsx:1479`) opens "Select term for highlighted text / The annotation will be saved upon selecting a term." with an **empty, unfocused** search field (`SearchPanel`, `id="search-input"`). The annotator moves the mouse to the field, types an English or translated name, waits for the 250 ms debounce, clicks a hit.
- Enter in the field re-runs the search; it never picks a hit. Hits are `li role="button"` cards with the full definition (often 4–8 lines), so only 4–5 hits fit.
- After creation, axes start `null` (`initialAxisValues`) merged with the project's `creation_defaults`; preset values are stored as `axes_defaulted` and must be confirmed one by one with "Confirm {axis} value" (`AnnotationPanel.tsx:271`). Defaulted values are warning items in the submit dialog.
- `set_axes` already accepts `chosen_axis_ids` as a list (`application/editing.py:769`), so confirming several axes is one mutation. No backend change.
- Registered editor keys: `?`, `Esc`, `Alt+←/→`, `J/K` and `1 2 3 4 0` (review mode with a proposal selected), `N`/`Shift+N` and `C` (carry-forward round), resizer hints. There is no key for the search or the values.
- The match line shows raw kinds: "Match: »Absence seizure« (ngram)". Kinds in the backend: `label`, `id`, synonym predicates, `prefix:{pred}`, `ngram`, `ngram:{lang}`, `translation`.

Today per finding (mouse): mark (1), click search field (2), typing, click hit (3), then up to three "Confirm … value" clicks (4–6) = **6**, plus one click per changed value; plus the hand travel the critique calls "+3".

### B.1 Decisions

1. **After marking, focus moves to the term search, prefilled with the marked text, selected**, and the search runs immediately (no debounce).
2. **The search is a combobox**: the first usable hit is active; ↓/↑ move; **Enter adds the active hit**.
3. **One-line definitions**; the active hit shows its full definition.
4. **Values become a compact block with "Confirm defaults (n)"**, one mutation, and focus follows the loop: after adding a term focus goes to "Confirm defaults" (or the first required empty value), after confirming it returns to the text.
5. **Keys**: `/` term search, `V` values, `D` confirm defaults. No conflict with N/C, J/K, digits.
6. **The text never moves**: every programmatic focus uses `preventScroll`; the text pane's scroll position is never changed by the loop.

### B.2 Flow (mockup 02)

**Step 1, marked.** Inspector heading "New finding" (was "Select term for highlighted text"), the quote "“Krampfanfälle”" (serif, `quoteSegments`), field label "Search term", the field prefilled and fully selected, focused. Prefill rule: the covered text of all segments joined with a space, whitespace collapsed, trimmed, cut at 80 characters on a word boundary. The query runs at once with the current search languages. The muted line under the field: "8 terms · ↓↑ choose · Enter add · Esc cancel" (`Kbd`), or "Searching…", or the empty/error states (B.4).

When the document language is neither English nor among the active search languages, the field is **not** prefilled (a German phrase against English-only names returns noise); it is focused empty with the hint "Names are searched in English. Type an English name or a code." (resolved question 5).

**Step 2, term added.** Enter (or click) on the active hit calls the existing `createPendingAnnotation`. The finding is selected; the inspector shows term heading, "Change term" (`Kbd` /), "Show in tree", then **Values**, Note, Mentions, Delete (Values move above Note; they are decided for every finding, the note rarely). Focus target, in order:

1. the first required value that is empty (its first radio);
2. else "Confirm defaults (n)" when defaulted values exist;
3. else the text (`.text-container`), caret after the mark's end.

The live region says "Seizure added. Values from defaults: Present, Patient, Current. Confirm defaults or change a value." (or "Seizure added." when nothing is defaulted).

**Step 3, confirmed.** "Confirm defaults (n)" (primary within the section, `Kbd` D) sends one `set_axes` with the current values and `chosen_axis_ids` = all defaulted axis IDs. On success: announcement "Confirmed: Assertion Present, Subject Patient, Temporality Current.", focus returns to the text after the mark, so `Shift+arrows` starts the next selection. On failure: inline error in the Values section, focus stays on the button.

**Changing a value instead.** `V` focuses the Values group (first defaulted axis, else the first axis). Each axis is a native radio group in one row: label at left (96 px), options as compact segmented radios. Arrow keys choose (native), Tab moves to the next axis. A changed value becomes chosen (existing `handleUpdateAxes`). Rapid arrow presses are coalesced: the mutation is sent 300 ms after the last change within the same axis. "Confirm defaults (n)" then counts only the remaining defaulted axes.

Unconfirmed defaults are drawn with a dashed option border and the text "· default" after the value ("Present · default"); confirmed values have a solid border. The findings-row badge "Defaulted axes" is renamed "Defaults to confirm".

### B.3 Term search component

`SearchPanel` becomes an ARIA 1.2 combobox: input `role="combobox"`, `aria-expanded`, `aria-controls` the listbox, `aria-activedescendant` the active option, `aria-autocomplete="list"`. Hits are `li role="option"` with `aria-selected` for the active one (no nested interactive elements). Obsolete terms stay listed, `aria-disabled="true"`, skipped by ↓/↑ and never active; Enter on an obsolete active hit is impossible.

| Input | Behaviour |
| --- | --- |
| Typing | Debounced search (250 ms, unchanged); active hit resets to the first usable hit when results arrive. |
| ↓ / ↑ | Move the active hit (no wrap); the list scrolls the active hit into view inside the inspector only. |
| Enter | If results belong to the current query and are not loading: add the active hit. If a search for this query is pending or the results are stale: run it at once and **do not** auto-add when it arrives (a second Enter is needed). Never adds an obsolete or disabled hit. |
| Esc | Cancel the new finding (existing `cancelPending`), focus back to the text at the selection end. With an existing finding ("Change term"), Esc closes the search and focuses "Change term". |
| Pointer hover | Moves the active hit (so the full definition follows the pointer). Click adds, as today. |
| Home / End | Native text caret behaviour (not list navigation). |

Hit layout: name (strong) · code (mono, right) · on the active hit a `Kbd` "Enter". Second line only when the match is not the name: match line (B.6 copy). Third line definition: one line with ellipsis (`text-overflow`), full text on the active hit (`white-space: normal`, no max). The selected term of an existing finding keeps "Currently selected" with `IconCheck` (not "✓").

The search event logging is unchanged: the prefilled query creates a search event like a typed one; the event id is passed on as today (`search_event_id`).

### B.4 States

| State | Inspector |
| --- | --- |
| Searching | Line "Searching…" (`role="status"`); previous hits for another query are removed, so Enter cannot pick them. |
| No hits | "No terms match “{query}”. Change the words, try a code (HP:0001250) or switch search languages." The field keeps focus and selection. |
| Error | `InlineMessage tone="error"` "The term search failed. Retry" with a Retry button; Enter retries. |
| Read-only / paused | No pending finding can be created (unchanged); `/`, `V`, `D` are disabled. |
| Spanless finding ("Add finding without a text span") | No prefill; focus to the reason field when reasons are required, else to the empty search (unchanged otherwise). |
| Add segment / add mention mode | No prefill; the term is already chosen. The pane toolbar shows "Adding a segment to mention {n} of {term}. Mark the text. Esc cancels." (C.6). |
| Re-anchor / carried re-create | Unchanged (term preselected; no search prefill). |
| Review mode, proposal selected | B keys disabled for proposals; enabled for the reviewer's own adopted copies. |

### B.5 Narrow widths

| Width | Behaviour |
| --- | --- |
| ≥1280 / 1025–1279 px | Inspector beside the text: as above. |
| 701–1024 px (inspector below the text, screenshot 26) | Focus moves to the field with `preventScroll`; then, only if the field is outside the viewport, the page scrolls the inspector into view with `block: "nearest"`. The text pane's own scroll offset is not touched, so the mark stays where it was inside the pane. |
| ≤700 px (panes) | No automatic pane switch while marking. A bar appears at the bottom of the text pane: "New finding “Krampfanfälle” · Choose term" (primary) · Cancel. Choose term switches to the details pane with the prefilled, focused search. After confirming, "Back to text" returns to the text pane at the mark. |

### B.6 Copy (B)

| Where | Today | New |
| --- | --- | --- |
| Pending heading | "Select term for highlighted text" | "New finding" |
| Pending sentence | "The annotation will be saved upon selecting a term." | removed (the hint line explains Enter); the quote replaces it |
| Field label | "Search ontology term" | "Search term" |
| Field help | "Search by name or code (e.g. HP:0001250)" | in the empty state only: "Name or code, for example HP:0001250" (placeholder stays "Name or code") |
| Match line | "Match: »Absence seizure« (ngram)" | `label`: none · synonym kinds: "Matched synonym “Absence seizure”" · `prefix:*`: "Matched the start of “…”" · `ngram`: "Similar wording “…”" · `ngram:{lang}` / `translation`: "Matched {Language} name “Krampfanfall”" · `id`: "Matched the code" · unknown: "Matched “…”". Raw kind in `title` only. |
| Values heading | "Context Axes" | "Values" |
| Required marker | red "* (Required)" | "(required)" in text, no colour-only star |
| Confirm one | "Confirm {axis} value" | removed in favour of "Confirm defaults (n)"; choosing any value also confirms that axis |
| Default hint | "Default value; confirm it or choose a value." | "Defaults are not confirmed until you confirm them or choose another value." (once per section) |
| Row badge | "Defaulted axes" | "Defaults to confirm" |

### B.7 Keyboard map of the editor (after)

| Key | Action | Active when | Group |
| --- | --- | --- | --- |
| ? | Show / hide shortcuts | always | General |
| Esc | Clear selection / cancel adding a mention; in the term search: cancel the new finding | always | General |
| Shift + arrows, release Shift | Mark text (opens the prefilled term search) | text focused | General |
| Alt + ← / → | Previous / next case | always | Navigation |
| J / K; 1 2 3 4 0 | Proposals: next/previous; confirm, reject, adopt, unresolved, reset | review mode, proposal selected | Review |
| N / Shift+N; C | Next / previous unchecked; mark as checked | carry-forward round | Carried findings |
| **/** | Focus the term search (new finding) or open "Change term" and focus it (own editable finding) | pending finding or own editable finding selected | Finding |
| **↓ / ↑, Enter** | Move through hits; add the active hit | focus in the term search (local, listed via `useShortcutHint`) | Finding |
| **V** | Focus the values; ← → choose; Tab next value | own editable finding with values | Finding |
| **D** | Confirm all default values | own editable finding with defaults | Finding |

Conflict check: `/`, `v`, `d` are unused; single-character bindings ignore Shift in `matches()`, so `?` (Shift+/ on US layouts) still reaches help because its `event.key` is `?`, not `/`; on German layouts `/` is Shift+7 with `event.key === "/"`, which matches. `D` and `V` follow the `C` precedent: plain letter only, handler returns `false` when Shift is held. All are suppressed in text fields, so typing "d" in the search or note never confirms. Digits stay reserved for review decisions; values never use digits, so a reviewer's `1` cannot change an axis. The carried "Mark as checked" (`C`) and the new `D` both act on the selected finding; a carried finding with defaults needs both, deliberately (checking does not confirm values, per the carried spec).

### B.8 Accessibility (B)

- Programmatic focus moves are announced through the editor's existing polite live region (one message per step, B.2).
- Focus never lands inside the clinical text by surprise: returning to the text puts the caret after the mark, matching where the selection ended.
- Dashed/solid borders plus the word "default" carry the defaulted state; forced-colours mode keeps the border style and the text.
- Combobox follows the APG pattern; `aria-activedescendant` IDs are stable per hit.
- Segment radios have a visible 2 px focus ring (`focus-ring`) with a 2 px offset; target size ≥24×24 px.

### B.9 Click counts (B)

| Flow per finding | Today | After |
| --- | --- | --- |
| Top hit right, defaults right | mark (1), click field (2), typing, click hit (3), confirm ×3 (4–6) → **6** | mark (1), Enter (2), Enter/D (3) → **3**, no typing |
| Top hit right, one value differs | 6 + 1 radio click → 7 | mark, Enter, `V`, → (value chosen), `D` for the rest → **5** keystrokes; mouse: mark, Enter, click value, click Confirm defaults → **4** |
| Query must be retyped (no prefill match) | 6 + typing | mark, typing, Enter, Enter → **3** + typing |
| Second hit right | 6 | mark, ↓, Enter, Enter → **4** |
| No defaults configured, values optional | 3 + typing | mark, Enter → **2** |

Critique target "6 (+3) → 3–4" is met.

---

## C. Polish package

### C.1 Typo in the empty inspector

`AnnotationPanel.tsx:115-116` renders "text,or". New copy, heading "No finding selected":
- editable: "Select a finding in the list or in the text, or mark text to add one."
- read-only: "Select a finding in the list or in the text to see its details."

### C.2 Inline styles → CSS

All `style={…}` in `editor/AnnotationPanel.tsx` (replacement banner, term heading row, axis required marker, mentions header, no-span box, mention cards, confirm groups, delete section) and `editor/SearchPanel.tsx` (field row, help line, loading, error box, match line, selected marker) move to classes in `styles/screens/editor.css` using tokens (`--size-*`, `--space-*`, colour tokens). Raw `rem`/px sizes such as `0.82rem`, `0.85rem`, `1.1rem` are replaced by the nearest ramp token (`size-sm`, `size-md`, `size-reading` for the term heading). The error box becomes `InlineMessage tone="error"`; "↳" and "✓" glyphs become text or `ui/icons.tsx` icons. Visual result equal except for the ramp alignment. Straight-swap rule: classes, IDs, `data-*` and accessible names stay.

### C.3 One way back in the editor and the review

The editor toolbar's "← My tasks" button and the translation review's "Back to my tasks" link are removed when the shell breadcrumb is present (assignment routes). The legacy "← Dashboard" path without `assignmentNavigation` keeps its button because it has no breadcrumb. The breadcrumb link runs the same leave guard (`routeLeaveRef`) as today's button.

### C.4 Breadcrumb names the task

`App.tsx:240` "Task {assignmentId}" becomes "{external_id or document_id} · {task label} ({language})", e.g. "failed-translation · Translation review (de)", "accepted-translation · Annotation (de)". Task labels: `annotate` → "Annotation", `review` → "Review", `translation_review` → "Translation review" (shared with My tasks). Data: the task's `TaskSummary` from the list App already loads for assignment navigation; fallback "Task" while it loads (never the bare number). The assignment number stays available in `title` for support.

### C.5 Type hierarchy in the editor

| Element | Today | New (existing tokens) |
| --- | --- | --- |
| h1 | case label in the toolbar, 15 px | document name as `h1` in the toolbar after the case navigation, `title` 22/28 serif; case navigation shows "Case 1 of 1" only |
| Inspector h2 (term / "New finding") | 14 px (0.875–1.1rem mixed) | `reading` 18 px serif, regular, code in mono `size-xs` muted |
| Section h3 ("Values", "Mentions", "Note") | 14 px bold | `md` 14 px, strong, `text-muted` |
| Body, controls | 14 px | `md` 14 px (unchanged) |

Ratio 22 : 18 : 14 instead of 15 : 14 : 14. The toolbar keeps its height (52 px); no text moves.

### C.6 Jargon

| Today | New |
| --- | --- |
| Mode badge "Annotate from scratch" | "Independent annotation"; `title` "You do not see proposals from other people or tools." |
| "Selection intent: New mention" (always visible above the text) | Hidden in the normal state. Only while adding a segment: "Adding a segment to mention {n} of {term}. Mark the text. Esc cancels." While adding a mention: "Adding a mention to {term}. Mark the text. Esc cancels." |
| "(ngram)" and other match kinds | B.6 |
| "+ Add Mention", "+ Segment" | "Add mention", "Add segment" (icon-free; "+" removed) |
| "Delete Annotation" | "Delete finding" |
| "Annotating as Annotator (ann-0004)" | "as Annotator (ann-0004)" next to the mode badge (identity rule of the Documents spec unchanged) |

"Annotation" vs "finding": the inspector already says "Findings (n)"; user-facing text uses "finding" consistently, code names stay.

### C.7 Settings sections

`admin/ProjectSettingsPage.tsx` renders seven sections (General, Guideline, Annotation rules, Workflow, Creation defaults, Ontology and profile, Members) on one page with an anchor-button bar and one Save per section. Decided (resolved question 9): **one section at a time with its own address** (`…/settings/{section}`), the bar becoming a tab-like `nav` of links with `aria-current="page"` (not ARIA tabs; each is a page). Leaving a section with unsaved edits asks "Save {section}", "Discard", "Cancel" through the existing route-leave guard. The default address `…/settings` opens General. Mockup 03 shows it.

---

## Deviations from earlier specs

1. **Editor carried-review spec §9 (translation checks)** defined the full per-check block visible by default and the guidance sentence. This spec keeps the content but collapses it behind "Details", merges the no-location sentence, moves "Technical code" under "Technical details" and rewrites the guidance. DESIGN.md's "Translation check blocks" row must be updated with this spec.
2. **Carried-review spec, Shortcuts:** N, Shift+N, C unchanged. New keys `/`, `V`, `D` are added to DESIGN.md "Shortcuts" in group "Finding".
3. **Quick-fixes Q2/Q9 (My tasks):** unchanged; A.7 adds a line in the Task cell, not a column.
4. **Translation review footer:** the existing sticky footer is kept; the rail becomes independently scrolling at ≥1100 px instead of the page scrolling.
5. **`decisionDescriptions`** are shortened; the confirmation dialog keeps the longer `decisionConsequences`.

## Out of scope

- Removing the submit confirmation for translation reviews.
- Per-option letter keys for values (they need key letters in the annotation profile; see resolved question 6).
- Changing search ranking, the language button, or adding fuzzy matching for inflected German forms.
- Lead pages (Documents, Progress, assign dialog): covered by the lead-workflow spec being implemented now.
- Check explanation texts beyond the guidance sentence (their review document stays the authority).
- Coupled scrolling while editing (stays read-only/Show changes only).

## Resolved questions (user decisions 2026-10-20)

1. **Rationale for Accepted unchanged with failed checks:** optional, with the prompting hint "Optional. Say why the flagged difference is correct." No backend change; policy stays `ontocurator-translation-review/v1`.
2. **Check details:** always collapsed by default; the disclosure state is not stored.
3. **Edited text:** "Accepted with corrections" is selected automatically with the visible note, and reverted when the edit is undone (A.4).
4. **Next task:** the next unsubmitted task of any type in the same project, in My tasks order.
5. **Document language not searchable:** no prefill; focused empty field with the hint to type an English name or a code. With a loaded translation for the document language, always prefill.
6. **Value keys:** only `V` + arrows + `D` now; no per-option letters.
7. **Focus after "Confirm defaults":** back to the text after the mark.
8. **Inspector order:** Values above the note.
9. **Settings:** one section per address (C.7).
10. **My tasks flag:** only on translation-review tasks, not on annotation tasks.

## Work packages

| WP | Content | Files (main) | Size | Notes |
| --- | --- | --- | --- | --- |
| R1 | Translation review layout: bar, check band + Details, column heads, pinned rail, 700–1099/<700 layouts, pinned bottom bar, hide unavailable coupling | `translation/TranslationReviewScreen.tsx`, `ReviewParts.tsx`, `translation.css`, `labels.ts` | L | Browser checks at 1440×900, 800×900, 390×844 |
| R2 | Decision form: rationale always, implied clinical change, auto-select/revert, copy, keys 1–4 | `ReviewForm.tsx`, `TranslationReviewScreen.tsx`, `labels.ts` | M | Unit tests for every A.4 row |
| R3 | Next task after submit | `TranslationReviewScreen.tsx`, `app/caseOrder.ts` reuse | S | |
| R4 | Failed-check flag: `TaskSummary.failed_check_count` + My tasks line | `api/assignment_routes.py` (+ application query), `api/generated.ts`, `tasks/MyTasks.tsx` | S + S | Only backend change of this spec |
| A1 | Term search combobox: prefill, focus, Enter, active hit, one-line definitions, match copy, states, SearchPanel inline styles | `editor/SearchPanel.tsx`, `app/CaseScreen.tsx` (pending pane), `editor.css` | M | |
| A2 | Values block: Confirm defaults (one mutation), focus loop, `/` `V` `D`, coalesced arrow changes, narrow-width behaviour, help rows, DESIGN.md shortcuts | `editor/AnnotationPanel.tsx`, `app/CaseScreen.tsx`, `editor/openItems.ts` (badge text) | M | |
| P1 | Polish: typo, AnnotationPanel inline styles → CSS, one way back, breadcrumb label, type hierarchy, jargon | `AnnotationPanel.tsx`, `editor/TextPane.tsx`, `App.tsx`, `CaseScreen.tsx`, `editor.css` | M | `App.tsx` after the Documents work lands |
| P2 | Settings sections with addresses | `admin/ProjectSettingsPage.tsx`, `app/router.ts` | M | Decided: one section per address |

Order: R2 → R1 → R3 → R4 (review), A1 → A2 (annotation), P1 after A1 (shared files), P2 independent. `CaseScreen.tsx` is touched by A1, A2 and P1; run them sequentially. Verification is local (unit tests, Playwright against `tests/browser_server.py`), no CI and not the live test server. Review: R1 and A2 as the L/critical packages, plus one review per finished plan.

## Acceptance (summary)

- At 1440×900 with one failed check, ≥15 lines of each text are visible without scrolling, and all four decision options plus Submit are visible.
- At 800×900, Submit is visible without scrolling; texts are side by side.
- Accepted unchanged shows an optional rationale; the guidance sentence never asks for a hidden field.
- Every A.4 row holds (unit tests), including revert to the previous decision and reload as origin user.
- Query/Rejected never show `CLINICAL_CHANGE_REQUIRED`.
- After submit, Enter opens the next task; with no task left, "Back to my tasks" is primary.
- My tasks shows "1 automatic check failed" on the failed-translation row.
- Marking text focuses the prefilled, selected search without moving the text pane (geometry check); Enter adds the active hit; Enter before results arrive never adds a stale hit.
- `D` confirms all defaults in one `set_axes` mutation; `C`, `N`, `D`, `V`, `/` never fire in text fields; `?` help lists group "Finding".
- No `style=` attribute remains in `AnnotationPanel.tsx` and `SearchPanel.tsx`; the empty inspector has no "text,or".
- The breadcrumb never shows "Task {number}"; the editor has one "My tasks" link.
