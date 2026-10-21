# Editor axis values and coupled scrolling while editing: design

Status: Decisions approved by the user 2026-10-20; the detailed rules below (fit rule, leader rule, recompute timing, shortcut) were set while writing this spec and are open to the user's veto before implementation. Not implemented.
Mockup: `.superpowers/mockups/overview-editor-guidelines/editor-axes.html` (variants "Heute", A, B, C). Where the mockup and this spec differ, this spec wins; in particular the mockup's abbreviated values ("Uncert.", "Historic.") are not adopted.
Builds on: [Translation review, annotation term loop and editor polish](2026-10-20-review-and-annotation-flow-design.md) ("the review-flow spec": B.2 values block, B.7 keys, A.1 item 10, A.2, A.6) and decision D1 of [Next agentic work](../plans/2026-10-17-next-agentic-work.md) (lines 83, 102, B0.1). Deviations are listed under "Deviations from earlier specs". DESIGN.md tokens only; no new tokens.

Two independent parts:

- **Part 1. Axis values in the inspector** are visually one run of chips; the axes do not read as separate rows.
- **Part 2. Coupled scrolling in translation review** is hidden while the reviewer edits, which is exactly when it is most useful.

---

## Part 1. Axis values

### 1.0 Current state (verified in code)

- `frontend/src/editor/AnnotationPanel.tsx:266-330`: one `fieldset.axis-field` per axis, `legend.axis-legend` with "(required)", up to four options as `label.axis-option` with a native radio and the visible tag " · default" (`axis-default-tag`) on an unconfirmed default; more than four options render a `Select` (option text " · default"). Options: "Not specified" first when `allow_empty`, then the profile options (`axisOptionLabel`), then an unavailable stored value as a disabled option "{value} (current unavailable value)" (`:274-281`). "Confirm defaults (n)" with `Kbd` D and the hint "Defaults are not confirmed until you confirm them or choose another value." (`:322-330`).
- Styles exist in three places and partly override each other: `styles/components.css:69-115` (pill chips, `gap: 5px`, radius 9999px), `components.css:429-445` (radius `radius-sm`, transparent fill), `styles/screens/editor.css:1960-2014` (grid with a 96 px legend column, `calc(2 * var(--space-7))`, dashed border for `is-default`, forced-colours rules), plus focus rules in `styles/base.css:22` and `:49`.
- Result in the 380 px inspector (`editor.css:361`, content width ≈348 px after `detail-section` padding, so ≈244 px for the options): separate chips with 4–5 px gaps and the same border on every chip; rows are separated by only `space-1`. A defaulted value differs from a chosen one only by a dashed border and the muted word "default".
- Axes (`src/ontocurator/domain/axes.py:63-81`): Assertion (present, absent, uncertain), Experiencer/Subject (patient, other), Temporality (current, historical, future); all three `allow_empty=True`, so each shows "Not specified" too. Profile labels were long German ones until the final review (now "Assertion", "Experiencer", "Temporality"; IDs and options unchanged); projects can configure further axes with any labels and option counts.
- Estimated widths at `size-sm` (13 px): "Not specified · Present · Absent · Uncertain" needs ≈250 px as connected segments with `space-1`/`space-2` padding. That is at or just over the ≈244 px option column. The standard profile is therefore the borderline case and must be measured in the browser (WP X1), not assumed to fit.

### 1.1 Decisions (user, 2026-10-20)

1. **Variant B:** a grid, axis label in a left column, the values as one connected segmented control on the right, one row per axis.
2. **Unconfirmed default in warning colours:** `warning-light` fill, `warning` text, plus the hint "press D to confirm".
3. **Fallback variant A** (one tinted box per axis, dashed `warning` border for an unconfirmed default) when B does not work in practice. The switch is a fixed rule (1.4), not a judgement call.
4. Unchanged: native radio semantics, keyboard model (`V`, arrows, Tab, `D`, all other editor keys), focus-visible style, the meaning of the "· default" tag, the handling of unavailable values, `Select` for more than four options, coalesced saving.

### 1.2 Layout B (default)

- `section.values-section` keeps its heading "Values" with `Kbd` V. Each `fieldset.axis-field` is one grid row: columns `calc(2 * var(--space-7))` (96 px) and `minmax(0, 1fr)`, `column-gap: var(--space-2)`, `align-items: center`. Rows are separated by `var(--space-2)` (today `space-1`).
- Label cell: the legend, `size-sm`, weight 500, `text`; "(required)" muted. Long labels wrap to at most two lines at word boundaries; they are never truncated. A second line inside the label cell shows the tag for an unconfirmed default (1.3).
- Control cell: `.axis-options` becomes one control: `display: flex; flex-wrap: nowrap`, one 1 px `border-strong` outline around the group, `radius-sm` on the outer corners, no gap. Segments (`.axis-option`): `flex: 1 1 auto`, text centred, `white-space: nowrap`, padding `var(--space-1) var(--space-2)`, min height 28 px (target size ≥ 24 × 24 px), 1 px `border-strong` separator on the left of every segment except the first. No pill radius (DESIGN.md: "do not turn controls into pills"); the three competing rule sets in `components.css` and `editor.css` collapse into one block in `editor.css` (straight swap of classes, no new class names except `values-grid` if needed).
- The group must not use `overflow: hidden` (it would clip the focus ring). The focused segment gets `position: relative; z-index: 1` so the 2 px `focus-ring` outline with 2 px offset draws above its neighbours.
- The native radio stays in the DOM, focusable and operable, visually reduced to zero size (`opacity: 0`, absolute, 1 px); the segment is its `label`. Arrow keys, Space and Tab behave natively, as today.

Segment states:

| State                                    | Fill                                                   | Text                                  | Shape cue (never colour alone)                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Not chosen                               | `surface-raised`                                       | `text`, weight 500                    | none                                                                                                                                          |
| Hover (not chosen, editable)             | `surface-sunken`                                       | `text`                                | none                                                                                                                                          |
| Chosen (confirmed or chosen by the user) | `accent`                                               | `on-accent`, weight strong            | filled segment, bold text                                                                                                                     |
| Chosen, unconfirmed default              | `warning-light`                                        | `warning`, weight strong              | 1 px dashed `warning` inner outline (`outline-offset: -3px`), bold text, tag "Default" in the label cell, " · default" in the accessible name |
| Disabled (read-only)                     | as above, no hover                                     | `text-muted` for not-chosen segments  | `cursor: default`                                                                                                                             |
| Unavailable stored value                 | its own last segment, disabled, chosen look (`accent`) | "{value} (current unavailable value)" | as today; counts for the fit rule                                                                                                             |

Contrast: `warning` #8a5a00 on `warning-light` #f6ecd6 ≈ 4.9:1, `on-accent` on `accent` well above 4.5:1; `border-strong` against the surfaces ≥ 3:1 (DESIGN.md).

Axes with more than four options keep the `Select` in the control cell (`width: 100%`), with " · default" in the option text as today; the label cell shows the same "Default" tag.

### 1.3 Default tag and hint

- The visible word moves from inside the segment to the label cell: second line "Default" (`size-xs`, `warning`, weight strong, class `axis-default-tag`). This keeps the segments narrow and the textual cue in the same row.
- Inside the segment the text " · default" stays as visually hidden text, so the radio's accessible name is unchanged ("Present · default") and screen-reader users hear the same as today.
- Under the rows, when at least one default is unconfirmed and the finding is editable: "Highlighted values are defaults. Press D to confirm them, or choose another value." with `Kbd` D. It replaces "Defaults are not confirmed until you confirm them or choose another value." "Confirm defaults (n)" stays above it, unchanged.
- Read-only finding with unconfirmed defaults: tag "Default" stays, the hint reads "Highlighted values are defaults that were not confirmed." (no key, no button).

### 1.4 Fit rule and fallback A

One layout for the whole Values block (all rows the same, so the eye can scan one column). Evaluated in this order:

1. **B (row):** every segmented control's max-content width fits its control cell.
2. **B (stacked):** otherwise, if every control fits the full content width of the section, the label moves above the control (grid becomes one column, label cell `margin-bottom: var(--space-1)`), still segmented. This covers the standard profile in the 380 px inspector if the measurement in 1.0 is confirmed.
3. **A (boxes):** otherwise.

Measurement: a hidden measuring copy is not needed; each control is laid out with `nowrap`, and a `ResizeObserver` on the section compares each control's intrinsic width (sum of each segment's inner text `scrollWidth` plus its horizontal padding, plus outline and separators) with the space of the candidate layout. The stretched segment's own `scrollWidth` is not used: segments grow with `flex: 1 1 auto`, so it would report the stretched width and the block could never return to a better layout. Re-evaluated on mount, on a change of the axis configuration or of the option set (an unavailable value appears or disappears), on section resize and after `document.fonts.ready`. Hysteresis: return from a fallback to a better layout only when the free space exceeds the required width by 8 px, so a window resize at the boundary does not flicker. The chosen layout is a `data-values-layout="row|stacked|boxes"` attribute on the section (used by tests). Selected values, focus and the radio state never change when the layout switches.

Values are never abbreviated or truncated in any layout; clinical values are read in full.

**Layout A (boxes):** each `fieldset` is a box: `surface-sunken` fill, 1 px `border`, `radius`, padding `var(--space-2)`, gap `var(--space-2)` between boxes. Legend on top (`size-sm`, weight 500); options as separate wrapping chips (`flex-wrap: wrap`, gap `var(--space-1)`, `radius-sm`, today's chip look). An axis whose value is an unconfirmed default: box border 1 px dashed `warning`, the same "Default" tag under the legend as in B (final review 2026-10-21: one marking in every layout; it replaced the earlier legend suffix " · default, not confirmed"); the chosen chip keeps the `warning-light` fill and `warning` text of 1.2. Hint and button as in 1.3.

### 1.5 Keyboard and accessibility

- No key changes. `V` focuses the first defaulted axis (else the first axis); ← → choose within the axis (native radio group); Tab moves to the next axis; `D` confirms all defaults in one `set_axes` mutation and returns focus to the text after the mark; plain letters only and never in text fields (review-flow spec B.7). Arrow presses stay coalesced (300 ms).
- Each axis stays a `fieldset` with its `legend`; no ARIA roles are added (native radios already give "radio, 1 of 4").
- Forced colours: group outline and separators `CanvasText`; chosen segment `Highlight` fill with `HighlightText`; unconfirmed default keeps the dashed outline in `CanvasText`; A boxes keep a dashed `CanvasText` border; focus uses `Highlight`.
- Reduced motion: no transitions on segments (today `transition: all 0.15s` in `components.css:93` is removed).

### 1.6 Edge cases

| Case                                            | Behaviour                                                                           |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| Axis with one option (no `allow_empty`)         | One-segment control; still a radio group.                                           |
| Axis label of one very long word                | Wraps with `overflow-wrap: anywhere` only in the label cell; never widens the grid. |
| Required axis without value                     | No segment chosen; "(required)" in the label; unchanged submit warning.             |
| Inspector below the text (≤1024 px, full width) | Normally B (row).                                                                   |
| Font loads late                                 | Layout re-evaluated after `document.fonts.ready`.                                   |
| Save fails                                      | The saved value is shown again (existing coalescer); layout unaffected.             |

### 1.7 Testing (Part 1)

- Unit (Vitest, `frontend/tests/`): layout choice from mocked widths (row, stacked, boxes, hysteresis); the accessible names keep " · default"; "Default" tag and hint copy for editable and read-only; `annotationPanelStyles.test.ts` updated for the merged rule set (no `9999px`, no `transition: all`).
- Browser (Playwright against `tests/browser_server.py`, `annotation-loop.spec.ts`): at 1440×900 with the standard profile, record `data-values-layout` and assert no segment has `scrollWidth > clientWidth`; a project profile with long option labels yields `boxes`; `V`, arrows, Tab, `D` flow unchanged; focus ring fully visible on the first, middle and last segment (screenshot); forced-colours emulation screenshot. Evidence into the worktree evidence directory.

---

## Part 2. Coupled scrolling while editing and "Show matching paragraph"

### 2.0 Current state (verified in code)

- `translation/TranslationReviewScreen.tsx:117` `canCouple = readOnly || showChanges`; `:414` renders "Couple scrolling" only when `canCouple && pairing.available` (review-flow spec A.1 item 10 and A.2: hidden while unavailable). So while the reviewer edits the translation, there is no coupling at all.
- `:118` `couplingIdentity` depends on `text`: any edit invalidates the request, so coupling would switch itself off on the first keystroke even if it were offered.
- `:114-116` paragraph starts are recomputed on every render of a new `text`; `:121-125` `panes` changes with them, and `useCoupledScroll` (`variants/useCoupledScroll.ts:108`, dependency `panes`) unbinds and rebinds all listeners, resetting the leader.
- `useCoupledScroll.ts:11-19` is available only at ≥1100 px (`matchMedia('(min-width: 1100px)')`). The translation review shows the texts side by side down to 700 px, each with its own scroll (`translation/translation.css`, `@media (max-width: 1099px)` and `(max-width: 699px)`; review-flow spec A.6), so the 1100 px limit is inherited from the editor's compare layout, not needed here.
- Leader model (`useCoupledScroll.ts:72-79`): wheel, touch, pointer or a navigation key makes a pane the leader; only the leader's scroll moves the others; followers move proportionally within the paired paragraph (`:43-69`); programmatic positions are ignored (`:30-32`, no feedback). Pairing is by index, mapped linearly when counts differ (`:53`).
- Markers: `TranslationEditor.tsx:24-34` renders a hidden mirror with `[data-paragraph]` markers (`DiffView.tsx:11-33` `paragraphNodes`) inside the scrollport `div.translation-editor`; the textarea grows and does not scroll itself. Markers therefore exist while editing; the mirror updates on every keystroke and the hook's `MutationObserver` (`:86-103`) refreshes geometry without moving panes (`sync(source, false)`).
- Paragraphs: `variants/paragraphs.ts:2-31` splits on blank lines; a text without any blank line falls back to one paragraph per line (`:27-31`). Paragraph numbers in the gutter and the active pair come from `editor.css:1874-1890` (`[data-paragraph-number]`, `[data-coupled-active]`).
- Copy today: "Paragraphs are paired by position, not by meaning", live pair "Source paragraph 3 ↔ Translation paragraph 3" (`role="status"`), "Paragraphs differ (12 / 13); scrolling is approximate." (`:359`, `:415-420`).
- Browser test `frontend/browser/translation-review.spec.ts:336-337` asserts that the checkbox is absent beside the editable translation.
- The editor's `variants/ComparePane.tsx:70-80`, `:104` keeps its own "never while editing" rule for annotation drafts; it is out of scope here.

### 2.1 Decisions (user, 2026-10-20; partially reverses D1)

1. **Coupling is available while editing** the translation: opt-in checkbox "Couple scrolling", off by default, not stored, paragraph-based pairing as before ("previously one could at least scroll along, even if not perfect").
2. **Kept from D1:** no snap-back, visible pairing (numbers, highlighted pair, note).
3. **While editing, only the follower panes scroll.** The caret, the selection, the focus and the scroll position of the edited translation are never changed by coupling or by a pairing recompute.
4. **"Show matching paragraph"**: a button and a shortcut that scroll the other pane(s) once to the paragraph paired with the caret's or the clicked paragraph. Independent of the checkbox.
5. **Width:** coupling is offered wherever the texts are side by side (≥700 px in the translation review); see 2.5.

### 2.2 Coupling rules

| Mode                                           | Who leads                                                  | Who moves                  |
| ---------------------------------------------- | ---------------------------------------------------------- | -------------------------- |
| Read-only, or Show changes on                  | Any pane, by deliberate input (today's ownership transfer) | The others                 |
| Editing (editable `TranslationEditor` visible) | **Always the translation pane** (fixed leader)             | Source and comparison only |

- Editing mode: a scroll of the translation scrollport (wheel, touch, scrollbar, navigation keys, Page keys, and the browser keeping the caret visible while typing) moves the followers proportionally inside the paired paragraph, as today.
- A follower scrolled by hand moves only itself. It is not pulled back on its own; it follows again on the next scroll of the translation pane. This is not snap-back: no pane the reviewer is scrolling is ever moved.
- Turning the checkbox on aligns nothing by itself (no jump); the first translation scroll does.
- The coupling request survives edits and toggling Show changes (both surfaces carry markers; the hook rebinds to the new element and keeps the request). It resets to off when the workspace reloads, when the comparison selection changes, and after submit (the screen becomes read-only; the reviewer may turn it on again).

### 2.3 Pairing recompute while editing

- The translation's paragraph starts are recomputed from the current editor text **300 ms after the last edit** (same idle time as the value coalescer), at once on blur of the textarea, and never during IME composition (wait for `compositionend`).
- Until the recompute, the previous pairing holds: the hook ignores marker mutations inside the edited pane (the mirror still updates live for the change underline). Source and comparison markers refresh immediately as today.
- A recompute updates paragraph numbers, the highlighted pair, the count note and the internal geometry. **It never scrolls any pane**; the new pairing takes effect on the next translation scroll.
- Starts are passed to the hook through a ref plus a revision number, so a recompute does not unbind listeners or reset the leader (fixes `useCoupledScroll.ts:108` rebinding on every keystroke).
- Mode flip: the first blank line typed into a text that had none switches `paragraphStarts` from line mode to paragraph mode; the count can drop sharply. This is shown by the count note (2.6), not prevented.

### 2.4 "Show matching paragraph"

Anchor (the paragraph the action starts from), first that applies:

1. Focus in the translation textarea: the paragraph containing the caret (`selectionStart`, converted to code points, `paragraphAt(starts, offset)` with freshly computed starts; the action flushes a pending recompute first).
2. The last click inside the source, comparison or translation text: the paragraph whose marker is the last one above the click point.
3. Otherwise the paragraph at the top of the last focused or last scrolled pane.

Targets: from the translation, the source and the comparison (if shown); from the source or the comparison, the translation and the other read-only pane. Pairing uses the same index mapping as coupling (linear when counts differ).

Effect, once:

- Each target pane scrolls instantly (no smooth scrolling) so that its paired paragraph starts at the same vertical offset inside its pane as the anchor paragraph inside the anchor pane, clamped to the scroll range; if the anchor paragraph starts above the visible area, the target paragraph is placed at the top with `space-3` offset.
- The written positions are registered as programmatic, so they never make the target a leader and never feed back.
- The paired paragraph numbers get `data-coupled-active`; the polite status reads the result (copy 2.6).
- Focus, caret and selection stay where they were. Moving the translation pane from a source anchor is allowed because the reviewer asked for it; the caret does not move.
- With coupling on, this is a one-off re-alignment; normal following continues from there.

Controls:

- Button "Show matching paragraph" (`Button variant="quiet" size="sm"`, `Kbd` "Alt M") in the translation column head next to "Show changes" and "Couple scrolling"; one instance per screen.
- Shortcut `Alt+M`, scope screen, group "Translation review", `allowInInputs: true` (it must work from the textarea), not while a dialog is open. `matches()` (`ui/shortcuts.ts:112-124`) compares `event.key`; on macOS Option+M yields "µ", so Alt bindings with a single letter fall back to `event.code === "KeyM"`. `preventDefault` so no character is typed. Listed in `?` help: "Alt + M: Show the paragraph paired with the one at your cursor".

### 2.5 Width rule

| Width       | Coupling checkbox                             | Show matching paragraph                                                                                                                                                        |
| ----------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ≥1100 px    | shown, works in all modes                     | shown                                                                                                                                                                          |
| 700–1099 px | shown (texts side by side with own scroll)    | shown                                                                                                                                                                          |
| <700 px     | hidden (texts stack; nothing to scroll along) | shown; scrolls the target pane internally, then brings it into view with `scrollIntoView({ block: "nearest" })`; focus and caret stay, so typing returns the view to the caret |

`useCoupledScroll` gets an option `minWidth` (default 1100 for `ComparePane`, 700 for the translation review). Review-flow A.1 item 10 still holds: an unavailable checkbox is hidden, not disabled with a sentence.

### 2.6 Copy

| Where                                     | Text                                                                                                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checkbox                                  | "Couple scrolling" (unchanged)                                                                                                                                         |
| Note while coupled, always                | "Paragraphs are paired by position, not by meaning. Merged or split paragraphs shift the pairing."                                                                     |
| Additional note while coupled and editing | "While you edit, only the other texts follow your translation."                                                                                                        |
| Counts differ                             | "Paragraphs differ (source 12, translation 13); the other text may show a neighbouring paragraph." (replaces "Paragraphs differ (12 / 13); scrolling is approximate.") |
| Count changed by the reviewer's edits     | "Your edits changed the number of paragraphs (12 → 13). Pairing after that point may be off."                                                                          |
| Live pair (unchanged format)              | "Source paragraph 4 ↔ Translation paragraph 4"                                                                                                                         |
| Button                                    | "Show matching paragraph"; `title`: "Scroll the other text to the paragraph paired with the one at your cursor or the one you clicked."                                |
| Status after the action                   | "Source paragraph 4 is shown next to translation paragraph 4." With differing counts, append " Paragraph counts differ, so this is an estimate."                       |

The merge/split risk is real and silent: a merge plus a split with equal counts pairs the wrong paragraphs without any count difference (D1 findings, plan section 1.1). The always-visible note names it; there is no automatic detection.

### 2.7 Keyboard and screen reader

- Keys 1–4, Ctrl+Enter unchanged; `Alt+M` new (2.4). The checkbox and button are in the Tab order of the column head, after "Show changes".
- Live regions: the pair line updates only after a scroll comes to rest (150 ms idle), not on every scroll frame and not on a recompute, to avoid chatter while typing; a count change from a recompute is announced once through the count note. The action's result uses the existing polite status.
- Paragraph numbers stay `aria-hidden` decorations; the information is in the status text.
- Reduced motion: all programmatic scrolling is instant anyway.

### 2.8 Edge cases

| Case                                | Behaviour                                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------------------------- |
| Empty translation                   | One paragraph; pairing maps to source paragraph 1; action scrolls the source to its start.   |
| Single paragraph on either side     | Index mapping returns 0 (existing rule); following is proportional inside the one paragraph. |
| Large paste or undo                 | One recompute after 300 ms; no scroll.                                                       |
| Saving / busy (`disabled` editor)   | Coupling continues; the action works.                                                        |
| Show changes toggled while coupled  | Coupling stays on; the leader rule switches between 2.2 rows.                                |
| Comparison column                   | Follows in editing mode; may lead in read-only mode.                                         |
| Caret moved by click without scroll | No follower movement (no scroll event); the action is the way to align.                      |
| Window crosses 700 px while coupled | Below: coupling stops and the checkbox hides; the request is kept and resumes above 700 px.  |

### 2.9 Testing (Part 2)

- Unit (`frontend/tests/useCoupledScroll.test.tsx`): fixed leader ignores follower input as a leader; a starts revision updates pairs without unbinding and without writing `scrollTop`; `minWidth` 700 vs 1100; programmatic positions from the action never feed back.
- Unit (`frontend/tests/translationReview.test.tsx`): checkbox present while editing, unchecked by default; stays checked across edits and Show changes; resets on comparison change and reload; recompute debounced (fake timers) and deferred during composition; anchor rules 1–3; status copy with equal and differing counts; `Alt+M` from the textarea, also via `event.code`.
- Unit (`frontend/tests/paragraphs.test.ts`): line mode to paragraph mode flip case.
- Browser (`frontend/browser/translation-review.spec.ts`): replace the assertion at `:336-337`; at 1440×900 and 800×900: turn coupling on while editing, type and add a paragraph, assert the textarea's `selectionStart` and the translation scrollport's `scrollTop` are unchanged by recompute, wheel on the translation moves the source, wheel on the source does not move the translation; merge two paragraphs and check the note; "Show matching paragraph" from caret and from a source click aligns the paired paragraph within a 4 px tolerance; at 390×844 checkbox hidden, action works. Screenshots into the worktree evidence directory.

---

## Deviations from earlier specs

1. **D1** (plan 2026-10-17, lines 83, 102, B0.1): "never while editing" is reversed for the translation review; opt-in, off by default, visible pairing and no snap-back stay. D1 option (b) "Show matching paragraph" is added alongside coupling instead of replacing it.
2. **Review-flow spec A.1 item 10 / A.2** (`canCouple && pairing.available`): availability no longer requires read-only or Show changes; the "hidden while unavailable" rule stays. Its Out-of-scope line "Coupled scrolling while editing" is superseded.
3. **Coupling width:** 1100 px stays for `ComparePane`; the translation review uses 700 px.
4. **Review-flow spec B.2 / DESIGN.md "Values block" row:** compact separate chips with a dashed default border become a connected segmented control with a warning-coloured default, the "Default" tag in the label cell and the new hint; the 96 px label column stays; fit rule and fallback added. DESIGN.md rows "Values block" and "Translation review layout" and the "Shortcuts" section (`Alt+M`) are updated with the implementation.

## Out of scope

- Stored or computed sentence alignment between source and translation (D1 option c).
- Coupling in the editor's `ComparePane` while annotating.
- Per-option letter keys for axis values (review-flow resolved question 6).

## Work packages

| WP  | Content                                                                                                                                                                                   | Files (main)                                                                                                                                                                | Size | Notes                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------ |
| X1  | Values block: layout B, default styling, tag and hint copy, fit rule with stacked step and fallback A, merged CSS, forced colours, DESIGN.md row                                          | `editor/AnnotationPanel.tsx`, `styles/screens/editor.css`, `styles/components.css`, `styles/base.css`, `DESIGN.md`                                                          | M    | First task: measure the standard profile at 1440×900 to confirm which layout it gets |
| S1  | `useCoupledScroll`: fixed-leader option, `minWidth` option, starts via ref + revision (no rebind), deferred marker refresh for the edited pane, programmatic scroll helper for the action | `variants/useCoupledScroll.ts`, `frontend/tests/useCoupledScroll.test.tsx`                                                                                                  | M    | Behaviour-critical; review with S2                                                   |
| S2  | Translation review: coupling while editing, request identity without `text`, debounced recompute, notes and count copy, 700 px rule, browser tests                                        | `translation/TranslationReviewScreen.tsx`, `translation/TranslationEditor.tsx` (composition events), `translation/labels.ts`, `frontend/browser/translation-review.spec.ts` | M    | Depends on S1                                                                        |
| S3  | "Show matching paragraph": anchor rules, alignment, status, button, `Alt+M` with `event.code` fallback in `matches()`, help row, DESIGN.md shortcuts                                      | `TranslationReviewScreen.tsx`, `ui/shortcuts.ts`, `DESIGN.md`                                                                                                               | S    | Depends on S1                                                                        |

Order: X1 independent; S1 → S2 → S3. Verification local only (unit tests, Playwright against `tests/browser_server.py`), no CI. One review for S1+S2 together and one per finished plan.

## Open questions

1. **Stacked step in the fit rule (1.4 step 2):** keep it (segmented control with the label above when the row does not fit), or go directly from B to A? The standard profile with "Not specified" is borderline in the 380 px inspector.
2. **Shortcut for "Show matching paragraph":** `Alt+M` proposed; alternatives would need a modifier too because it must work in the textarea.
3. **Below 700 px:** is "Show matching paragraph" wanted there, given it scrolls the page away from the caret?
