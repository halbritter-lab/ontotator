# Annotator acceptance 2026-10-21, UI findings: design

Status: Draft, written from the code on `main` `f6d04bd`; not implemented. The user answered the open questions on 2026-10-21 (table "Decisions"); all are confirmed.
Source: manual acceptance on the :18210 stack, findings 1–4, 7 and 8 in `.superpowers/roadmap-execution/manual-findings-2026-10-21-annotator.md` (findings 5 and 6 are product decisions and stay out of this spec).
Builds on: [Editor axis values and coupled scrolling](2026-10-21-editor-axes-and-coupled-scroll-design.md) ("the axes spec", 1.3 hint, 1.5 keys), [Quick fixes and export](2026-10-19-quick-fixes-and-export-design.md) (Q2 My tasks filter, Q3 project picker), [Lead workflow](2026-10-20-lead-workflow-design.md) (D7 landing). DESIGN.md tokens only; no new tokens.
Mockups (gitignored, in the main checkout): `.superpowers/brainstorm/161693-1792600358/content/` — `index.html` (overview), `a-pending-selection.html` (F1), `b-values-confirm.html` (F3), `c-submit-unconfirmed.html` (F2), `d-term-search.html` (F4), `e-my-tasks.html` (F7), `f-project-switcher.html` (F8). Where a mockup and this spec differ, this spec wins.
Parallel work: [Acceptance fixes](2026-10-21-acceptance-fixes-design.md) on `fix/acceptance-20261021` changes the term search prefill and hint (`SearchPanel.tsx`, `CaseScreen.tsx:1530-1548`, `editor.css`). No functional overlap with this spec, but AP and AR touch the same files and start only after that branch is merged into `main`.

No backend or contract change is needed for any finding here: every write goes through existing commands (`set_axes`, the submit command with `warning_acknowledgement`) and every read through existing endpoints (`listMyTasks`, `listProjects`, `documentsSummary`).

## Decisions (user, 2026-10-21)

| ID  | Topic                                     | Decision                                                                                                                                                                                                                                                                                                                                         |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Acknowledgement round (F2.4)              | Once the user has ticked the values in the dialog they are not asked again: the client resends once with the fresh acknowledgement. If the server's list differs, the updated list is shown instead.                                                                                                                                             |
| D2  | "Confirm all" in the Submit dialog (F2.3) | Kept. The copy states that it confirms the shown default values (for example present / patient / current) of all listed findings; the list stays visible. **Confirmed by the user 2026-10-21.**                                                                                                                                                  |
| D3  | My tasks (F7)                             | Opens on "All". "Done" for annotators is "Submitted"; no backend change.                                                                                                                                                                                                                                                                         |
| D4  | Project landing and switching (F8)        | Common pattern (GitHub, Linear, Vercel, GitLab): land on the last-used project; a searchable project switcher at the top of the sidebar, also reachable by keyboard; a Projects page for everyone; the Projects page is the landing only when there is no last-used project or it is no longer accessible. **Confirmed by the user 2026-10-21.** |
| D5  | Click-to-confirm (F3.1)                   | A click on the highlighted default value counts as an explicit confirmation of that value.                                                                                                                                                                                                                                                       |
| D6  | Term search (F4)                          | Both: a fixed details area above the list and two-line definitions in the rows.                                                                                                                                                                                                                                                                  |

---

## F1. Pending mark: adjust or discard before a term is chosen

Mockup: `a-pending-selection.html` (bar position, mouse and keyboard adjustment side by side, discard).

### Current behaviour

- Marking text creates `pendingAnnotation` (`app/CaseScreen.tsx:244-255`, set at `:1513-1524`); the mark is drawn as a mention without `kind` (`:2578-2585`).
- Drag handles exist only for the selected saved annotation: `resizableEvidenceIds` is empty while anything is pending (`:2066-2072`). A resize of an unknown evidence id resyncs and is dropped (`handleResizeMention`, `:1800-1811`). The vendor editor already draws handles and supports ← / → and Ctrl + ← / → on a focused handle (`vendor/spans.js:201-253`, `:283-318`).
- Discarding: Esc works only while focus is in the term search field (`pendingSearchProps.onEscape`, `:1535-1539`). The global Escape shortcut (`:2494-2498`) ignores a pending mark. The inspector's "Cancel" sits at the bottom of the "New finding" section, below the whole hit list (`:3083`). Below 700 px the "New finding" bar has Choose term / Cancel (`:3002-3012`).
- Marking new text while a mark is pending replaces it (`:1513`), but nothing tells the user.

### Target behaviour

1. **Handles on the pending mark.** The pending evidence id joins `resizableEvidenceIds` while `pendingIsMarkedSpan` (not for re-anchor or carried re-creation, which keep today's flow). `onResizeMention` for the pending id updates `pendingAnnotation.segments` locally (no mutation; nothing is saved before a term is chosen). Snapping and character rules are the vendor's (`spans/resize.ts`).
2. **Search follows the span.** While the user has not typed into the search field (`SearchPanel`'s `userTyped`), an adjusted span re-prefills the query from the new text and searches (normal 250 ms debounce). After the user typed, the query is left alone.
3. **Pending bar at the mark (≥ 700 px).** A small bar anchored below the last line of the pending mark, positioned over the text (absolute, never reflowing it), placed like `Popover` (`ui/Popover.tsx:36-41`, re-placed on scroll and resize, flipped above the mark near the pane bottom). Content: "Drag the edges to adjust" (muted, `size-xs`) and a quiet `Button size="sm"` "Discard" with `Kbd` Esc. Not modal, no focus trap, not in the Tab order before the search field (it follows the text pane in DOM order).
4. **Inspector.** The "New finding" heading row gets "Discard" (quiet, `Kbd` Esc) on its right; the bottom "Cancel" (`:3083`) is removed for marked spans (it stays for spanless, re-anchor and carried, where it means cancel, not discard a mark). Under the quote: "Adjust the marked text with its edge handles, or mark new text to replace it."
5. **Esc anywhere in the editor** (text pane, inspector, search field) discards a pending marked span, unless a dialog, drawer or popover owns the key (same rule as `TextPane.tsx:177-178`). Added as the first branch of the Escape shortcut at `:2494`. Focus returns to the text at the end of the discarded span (today's `setTextFocusRequest`).
6. Below 700 px: the existing "New finding" bar gets the same "Discard" wording (replacing "Cancel"); handles work by touch with the vendor's grab areas. No floating bar (the bottom bar is already at hand).

### Copy

| Where                | Text                                                                            |
| -------------------- | ------------------------------------------------------------------------------- |
| Bar at the mark      | "Drag the edges to adjust" · "Discard" (`Kbd` Esc)                              |
| Inspector hint       | "Adjust the marked text with its edge handles, or mark new text to replace it." |
| Status after discard | "Marked text discarded." (polite, existing announcer)                           |
| `?` help (General)   | "Esc: Discard the marked text / clear selection / cancel adding a mention"      |

### Keyboard and accessibility

- Handles are focusable (vendor), named "Start of mention" / "End of mention"; for the pending mark the vendor gets the names "Start of marked text" / "End of marked text" (new optional label parameter of `setResizable`).
- Tab order unchanged otherwise: the search field keeps autofocus (`autoFocus: !panesLayout`). Shift + Tab from the search field reaches the inspector "Discard"; the handles are reached in the text pane.
- A polite status after a handle move: "Marked text: “{quote}”" (after the vendor's keyboard pause, not per step).
- The bar has `role="group"` and `aria-label="Marked text"`; forced colours: `CanvasText` border.

### Edge cases

| Case                                       | Behaviour                                                                                                                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Handle dragged to zero length              | Vendor refuses (as for saved mentions); the span keeps one character.                                                                                                                                        |
| Multi-segment mark                         | Handles per segment, as for saved mentions.                                                                                                                                                                  |
| Term chosen while a keyboard resize pauses | `createPendingAnnotation` first flushes the vendor's delayed keyboard resize (new `flushResize()` on `SpanEditorHandle`, wrapping `_flushKeyResize`, `spans.js:274-280`), so the adjusted segments are sent. |
| Mark scrolled out of view                  | The bar hides with it (anchored to the mark's rect, clipped by the pane).                                                                                                                                    |
| Read-only / submitted                      | No pending marks exist; nothing changes.                                                                                                                                                                     |

### Tests

- Unit (`tests/caseScreen.test.tsx`): pending id is resizable; resize updates segments without a mutation; re-prefill only while not typed; Esc from text pane and inspector discards; Esc inside a dialog does not; spanless/re-anchor keep "Cancel".
- Browser (`browser/spans-resize.spec.ts`, `annotation-loop.spec.ts`): mark, drag end handle, choose a term, saved segments equal the adjusted span; keyboard: Tab to handle, → twice, Enter in search; Esc from the text discards; bar does not shift the text (bounding box of the first paragraph unchanged).

---

## F3. Confirming defaults with one click

(Before F2 because F2 reuses its write path.) Mockup: `b-values-confirm.html` (three states: three defaults, one confirmed by click, all confirmed). Decision D5.

### Current behaviour

- "Confirm defaults (n)" is a primary small button below the axis rows (`editor/AnnotationPanel.tsx:334-339`); after adding a term the loop focuses it (`CaseScreen.tsx:2426`). The hint under it reads "Highlighted values are defaults. Press D to confirm them, or choose another value." (`:341`), as set by the axes spec 1.3.
- Clicking the highlighted default value itself does nothing: it is the checked radio, so `onChange` (`:313`) never fires. This is the most natural "confirm this" gesture and it silently fails, which leaves D as the only visible way.
- Findings list rows show "Defaults to confirm" (`editor/FindingRow.tsx:37`), not actionable.

### Target behaviour

1. **Click the default to confirm it.** A click (or Space) on the chosen, unconfirmed default segment confirms that axis: one `set_axes` with the current values and `chosen_axis_ids: [axis]` through `handleUpdateAxes` (`CaseScreen.tsx:1765`). Implemented as `onClick` on the radio input when `val === option.value && unconfirmed` (fires for checked radios, unlike `change`). Arrow keys keep today's semantics (they choose, and choosing confirms).
   For `Select` axes (> 4 options) there is no equivalent gesture; the button covers them.
2. **Button above, not below.** "Confirm defaults (n)" moves to the top of the Values block, on the heading row right of "Values" (`h3` stays left), so it is seen before the rows; still primary, `size="sm"`, `Kbd` D inside the button (`aria-hidden`), `aria-keyshortcuts="d"`.
3. **Hint names the click, not only the key.** Replaces `:341`: "Highlighted values are defaults. Click a highlighted value or “Confirm defaults” to confirm, or choose another value." Read-only hint unchanged.
4. Announce per axis: "Confirmed: Assertion Present." (existing `announceCarried`); confirming all keeps today's text.

### Keyboard and accessibility

- D unchanged (all defaults of the selected finding). Space on the focused checked default radio confirms that axis; the radio's accessible name keeps " · default" until confirmed, then loses it.
- The heading-row button keeps its place in the Tab order before the first axis (it now precedes the rows in DOM order too).

### Edge cases

| Case                                                   | Behaviour                                                              |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| Click on a default while a coalesced change is pending | `axes.flush()` first, then confirm (as `confirmDefaults`, `:176-180`). |
| Default value that is no longer available              | Not confirmable (as today, `isUnconfirmedDefault`); no click handler.  |
| Empty value ("Not specified") on an axis               | Not a default; nothing to confirm; choosing a value is the way.        |
| Read-only finding / proposal                           | No handler, no button (as today).                                      |

### Tests

- Unit (`tests/valuesBlock.test.tsx`): click on the checked default calls `onConfirmDefaults([axis], values)`; click on a non-default checked value does nothing; hint copy; button order before the first fieldset.
- Browser (`browser/values-block.spec.ts`): add a finding, click "Present" (default) → tag "Default" disappears for that axis only; button count drops to n − 1.

---

## F2. Submit dialog: unconfirmed values listed and confirmable in place

### Current behaviour

- `SubmitCaseDialog` (`editor/SubmitCaseDialog.tsx`) lists at most 5 open items of all kinds (`:8-9`, `:101-111`), each with "Go to {term}", which closes the dialog (`onGoTo`).
- Before the first submit attempt the defaults appear as kind `defaulted`: "Default values: confirm them or choose values." without values (`editor/openItems.ts:62-66`; summary "n annotations have defaulted axis values", `:78`).
- The submit then returns `AXIS_CONFIRMATION_WARNING` (`application/submissions.py:487-520`; client `CaseScreen.tsx:141-156`, `:2297-2306`). The dialog re-opens with kind `unconfirmed-values` ("Not confirmed: Assertion = Present, …", `CaseScreen.tsx:2132-2146`, `openItems.ts:57-61`), a checkbox "Submit with these unconfirmed values" and "Continue and submit" (`SubmitCaseDialog.tsx:112-115`, `:78`).
- The acknowledgement is bound to `draft_revision`, `policy_revision` and a digest of the snapshot versions and warnings (`submissions.py:503-513`). Any `set_axes` bumps the revision, so an acknowledgement is valid only for the exact draft it was issued for.
- The server warns for every axis whose value is empty **or** defaulted (`domain/project_rules.py:139-150`, run with `require_chosen_axes=True`). With the project rule `require_chosen_axes` on, the same set is a blocking `PROJECT_RULE_VIOLATION`, which the dialog does not anticipate (defaulted items are never `blocking`, `openItems.ts:9`).

### Target behaviour

The dialog gets its own **"Unconfirmed values"** section; `defaulted` and `unconfirmed-values` items leave the generic open-item list in the dialog (the toolbar's "Next open item" keeps them).

1. **List, computed locally and live.** One row per finding in `completionResults` that has at least one axis with an empty or defaulted value (the server rule, mirrored client-side; axis order of the type). The list is shown from the first opening of the dialog, so the user sees it before any server round trip, and it shrinks as findings are confirmed. A server warning only serves to obtain the acknowledgement (step 4).
2. **Row content.** Term (with HPO code, `TermName`), a quote of the first mark (40 characters, `quoteSegments`), and the open values: "Assertion: Present · Experiencer: Patient · Temporality: Current"; an empty value reads "{Axis}: Not specified". Actions: secondary `Button size="sm"` "Confirm" and quiet "Go to" (today's `onGoTo`).
3. **Confirm.** "Confirm" sends one `set_axes` for that finding with its current values and `chosen_axis_ids` = its defaulted, non-empty axes (the F3 write path, `handleUpdateAxes(values, ids, annotationId)`). While saving the row shows "Confirming…" and its buttons are `aria-disabled`; on success the row is removed. **"Confirm all (n)"** in the section header (D2, confirmed) confirms the shown default values of every confirmable row; the line under the intro says so ("“Confirm all” confirms the default values shown below for all listed findings."), and the list stays visible while it runs. It sends one `set_axes` per finding in list order through the mutation queue (no batch command exists, `application/editing.py`). A failure stops the run; the failed row shows "Could not confirm. Try again." with Retry; confirmed rows stay removed.
4. **Acknowledgement without the extra round.** The checkbox reads "Submit with {n} unconfirmed values" and is shown only while rows remain and the project does not require chosen axes. "Submit case" (the label no longer switches to "Continue and submit"):
   - no rows: submit without acknowledgement;
   - rows remain and the checkbox is ticked: submit with the acknowledgement held from an earlier answer, if any. If the server answers `AXIS_CONFIRMATION_WARNING` and its set of (annotation, axis) pairs equals the set the user saw when ticking, the client resends **once** with the fresh acknowledgement (D1); the user is not asked again. Otherwise the list is refreshed, the checkbox is cleared and the polite status says "The unconfirmed values changed. Check the list again."
5. **Rule `require_chosen_axes` on.** The section is blocking: no checkbox, the rows count as blocking items, `submitBlockedReason` gets "Confirm or choose {n} values before submitting."
6. **Rows that cannot be confirmed in one click** keep only "Go to", with the reason as the row's last line:
   - only empty values: "Choose a value in the finding.";
   - review proposals (immutable snapshots, `reviewTargetOf`): "Proposal values change only with Edit & Replace." (matches `ReviewActions.tsx:228`);
   - findings on a layer outside `editable_layer_ids`: "Read-only layer."
     "Confirm all (n)" counts only confirmable rows; it is hidden when there are none.

Mockup: `c-submit-unconfirmed.html` (opened with three findings, after one Confirm, all confirmed, and the variant with the project rule on).

### Copy

| Where                       | Text                                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Section heading (`h3`)      | "Unconfirmed values · {n} finding(s)"                                                                                       |
| Intro line                  | "These values were filled in from defaults or are empty. Confirm them here, or go to the finding to change them."           |
| Bulk                        | "Confirm all ({n})"; line under the intro: "“Confirm all” confirms the default values shown below for all listed findings." |
| Row actions                 | "Confirm" · "Go to"; accessible names "Confirm values of {term}", "Go to {term}"                                            |
| Empty list after confirming | "All values are confirmed." (`role="status"`, replaces the section)                                                         |
| Checkbox                    | "Submit with {n} unconfirmed values"; hint: "Acknowledging does not confirm the values; they stay marked as defaults."      |
| Blocked (rule on)           | "Confirm or choose {n} values before submitting."                                                                           |
| Per-row error               | "Could not confirm. Try again." · "Retry"                                                                                   |

### Keyboard and accessibility

- Rows are a `ul`; each row is an `li` with the term as text, the buttons after it. No grid or listbox semantics.
- Focus after a row's confirm: the next row's "Confirm", else the previous row's, else the "Entire text checked" checkbox when unchecked, else "Submit case". Focus never falls to `body`.
- Polite status per confirm: "Confirmed {term}. {n} left." After "Confirm all": "Confirmed {k} findings." plus "{m} need a value." when rows remain.
- The dialog stays open throughout; Esc and Cancel close it without changing anything already confirmed.

### Edge cases

| Case                                                   | Behaviour                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Values changed in another window (revision conflict)   | Existing queue conflict handling; the dialog list recomputes from the reloaded draft.             |
| Queue paused (session ended, offline)                  | Confirm buttons `aria-disabled` with the queue's reason; Go to still works.                       |
| A finding deleted while the dialog is open             | Row disappears with the recompute.                                                                |
| More than ~10 rows                                     | The section scrolls inside the dialog body (max-height 50dvh); "Confirm all" stays in the header. |
| Server warning lists a pair the client did not compute | The server set wins: the row is added and the checkbox is cleared (step 4).                       |

### Tests

- Unit (`tests/submitDialog.test.tsx`, `tests/openItems.test.ts`): rows from defaulted and empty axes; row removal after confirm; Confirm all sequence and stop on failure; focus targets; non-confirmable rows; checkbox only with rows and rule off; blocked reason with rule on; generic list no longer contains defaulted kinds.
- Unit (`tests/caseScreen.test.tsx`): auto-resend once with an identical warning set; no resend when the set differs; no acknowledgement sent when no rows remain.
- Browser (`browser/annotation-loop.spec.ts` or `review-flow.spec.ts`): three findings with defaults → open Submit → Confirm one, Confirm all → submit without warning round; a second case: tick the checkbox and submit with one row left in one click.

---

## F4. Term search: a stable hit list

### Current behaviour

`editor/SearchPanel.tsx:294-339`: the active hit removes the definition clamp (`candidate-def` without `is-clamped`, `:324`; `editor.css:1090-1094` clamps to one line with ellipsis) and adds `Kbd` Enter to its header (`:320`), which can wrap the label. Every ↓ / ↑ or pointer move (`onPointerEnter`, `:312-314`) therefore changes two row heights and shifts everything below; under the mouse, the shift moves another row under the pointer.

### Target behaviour (D6)

Mockup: `d-term-search.html` (first hit active and third hit active side by side; row positions unchanged).

1. **Constant row heights.** Every row renders the same parts whatever its state: header (label, HPO code, a reserved Enter slot that is `visibility: hidden` unless active), optional match line, and the definition clamped to **two lines** (`-webkit-line-clamp: 2`, replacing the one-line `nowrap` clamp). Activity changes only fill and the inset accent bar (`editor.css:1080-1083`), never layout.
2. **Fixed detail area.** Between the hint line and the list, a box of fixed height (5 lines of `size-sm`, `overflow-y: auto`, `surface-sunken`, `radius-sm`) shows the active hit: label, HPO code, full definition, match line ("Matched: {matched_term}"), and "Obsolete term (assignment not allowed)" where applicable. Without hits the box is not rendered at all (no empty reserved space). Its height never depends on content.
3. Pointer hover still moves the active hit (the detail area follows); since rows no longer change, the pointer stays on its row.

### Keyboard and accessibility

- Unchanged combobox model (↓ / ↑, Enter, Esc; `aria-activedescendant`). The full definition stays in each option's DOM (the clamp is visual), so screen readers read it as today; the detail area is `aria-hidden="true"` (a visual duplicate).
- Reduced motion: no transitions on rows (`transition` at `editor.css:416` removed for `.candidate-card`).

### Edge cases

| Case                           | Behaviour                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------- |
| No definition                  | Row has no definition line (constant for that row); detail shows "No definition." |
| Long label                     | Wraps; the reserved Enter slot keeps the wrap identical in both states.           |
| Inspector below 380 px / sheet | Same rules; detail area keeps its fixed height.                                   |

### Tests

- Unit (`tests/searchPanel.test.tsx`): Enter slot rendered in every row; no `is-clamped` toggling; detail area shows the active hit.
- Browser (`browser/annotation-loop.spec.ts`): 10 hits, press ↓ five times, assert each row's `getBoundingClientRect().top` unchanged (± 0.5 px) and the field's position unchanged.

---

## F7. My tasks: filter by status

### Current behaviour

`tasks/MyTasks.tsx` loads all own tasks once (`api.listMyTasks`, `:51`), filters only by project (`:87`, route `#/?project=`), and shows counts as a plain list "Open · In progress · Submitted · of which paused" (`:151-156`). Statuses are `open | in_progress | submitted | reopened` plus `held` (`api/generated.ts:6422`, `:6441`); there is no "done" beyond submitted; "done" for annotators is "Submitted" (D3). The nav "My tasks (n)" counts non-submitted tasks (`app/Shell.tsx:57`).

### Target behaviour

- The counts list becomes status tabs (existing `ui/Tabs.tsx`, link-driven, with counts): **"To do (n)"** (open, reopened, in progress; the same set as the nav count) · **"Paused (n)"** (held; shown only when n > 0) · **"Submitted (n)"** · **"All (n)"**. Counts respect the project filter.
- Route: `#/?status=todo|paused|submitted|all` next to `project` (`app/router.ts:88`, `:119`, `:190`); absent means **"All"** (D3). Unknown values fall back to the default.
- The table is the tabpanel (`aria-labelledby={tabId(...)}`); the Status column stays (it distinguishes Open / In progress / Reopened inside "To do").
- Empty tab: `EmptyState` "Nothing to do here." / "No submitted tasks yet." / "No paused tasks." with the link "Show all tasks" (to `status=all`). The existing "No documents are assigned to you yet." stays for zero tasks overall.
- Filtering is client-side; no API change.

Mockup: `e-my-tasks.html` ("All" active, empty states).

### Keyboard and accessibility

As `Tabs` (arrows / Home / End move focus, Enter or click selects; modified clicks open a new tab). Tab list label "Task status".

### Tests

- Unit (`tests/myTasks.test.tsx`, `tests/router.test.ts`): counts per tab with and without project filter; default tab; `status` round-trip; empty states; paused tab hidden at 0.
- Browser (`browser/quick-fixes.spec.ts` My tasks block): switch tabs, reload keeps the tab.

---

## F8. Project switching and a Projects page

Decision D4 (confirmed by the user 2026-10-21). Mockup: `f-project-switcher.html` (switcher closed and open side by side, Projects page, landing table).

### Current behaviour

- The only switcher is `ProjectPicker` in the header actions (`app/ProjectPicker.tsx:63-88`): a `quiet`, `size="sm"` button whose visible text is only the project name (`:64-70`; Q3 specified "Project: {name}"), a disclosure panel of links (`:71-87`).
- The sidebar shows the current project's name as the group heading with Documents / Progress / Settings / Export (`app/Shell.tsx:102-110`), but no way to change it. In the reading shell (editor) the sidebar lives in the "Sections" disclosure (`ui/AppShell.tsx:36-43`).
- A lead lands on Documents of the last project (D7, `App.tsx:169-185`, `app/lastProject.ts`); non-leads land on My tasks. There is no page listing one's projects.

### Target behaviour

The pattern of GitHub, Linear, Vercel and GitLab: the current project is named and switchable at the top of the navigation, an overview of all projects exists for everyone, and login returns to the last-used project.

1. **Switcher at the top of the sidebar** (replaces the header `ProjectPicker`; the header keeps product, breadcrumb, user and Log out). A bordered button spanning the nav width, two lines: "Project" (`size-xs`, muted) over the project name (strong), chevron on the right; "Choose project" without a current project. In the reading shell it is the first item of the "Sections" disclosure.
2. **Opening** (click, Enter, Space, or `Alt+P` from anywhere, with the `event.code === "KeyP"` fallback as for `Alt+M` in the axes spec, `allowInInputs: true`, not while a dialog is open) shows a popover below the button with a filter field (`role="combobox"`, focused, `aria-activedescendant`) and a `listbox` "Projects". Without a query all projects are listed, the current one with "✓ Current"; each option shows the name and "{key} · {roles} · opens Documents" or "… · opens My tasks". Filtering by name and key, case-insensitive, at every list length.
3. **Choosing:** ↓ / ↑ move the active option (never navigate); Enter opens the active project (`projectDestination`, `ProjectPicker.tsx:9-13`); Ctrl/Cmd + Enter opens it in a new tab. Each option contains a real link (`tabindex="-1"`), so middle and modified pointer clicks keep browser behaviour. The popover ends with a separator and the link "All projects" (`#/projects`). Esc, an outside pointer-down, Tab out or a route change close it; Esc returns focus to the button. "No matching projects." as a `role="status"` line.
4. **Projects page** `#/projects` (new route `{ name: "projects" }`) for every user: `h1` "Projects", "Find project" field when more than 6 projects (`PROJECT_SEARCH_THRESHOLD`), a `DataTable`: Project (name, the current one marked "✓ Current" and `aria-current="true"`; key below in `text-muted` when it differs), Your roles, Needs your decision (leads only; lazy `documentsSummary` per led project; "–" while loading, on failure or for non-leads), Your open tasks (one `listMyTasks`, non-submitted), Action: "Open" (`projectDestination`) and, for leads, "Settings". Nav link "Projects" in the first nav list after "My tasks", for everyone with at least one project.
5. **Landing after login** (replaces D7's lead rule and the non-lead My tasks landing). "Last-used" is remembered per user for every project route (`rememberProject`, today only for routes with `key`) and for My tasks with `?project=`; `landingProject` (`app/lastProject.ts:25-30`) drops its "first led project" fallback.

| Situation                                           | Lands on                                                                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Last-used project remembered and still accessible   | That project: Documents (Needs your decision when n > 0, as today) for leads, My tasks filtered to it for others |
| No last-used project, or it is no longer accessible | Projects page                                                                                                    |
| No project at all                                   | Projects page with "You are not a member of any project yet."                                                    |

### Copy

"Project" / "{name}" (switcher; accessible name "Project: {name}, switch project", `aria-keyshortcuts="Alt+P"`), "Choose project", "Find project", "No matching projects.", "All projects", "✓ Current", "Projects" (nav, `h1`), "Your roles", "Needs your decision", "Your open tasks", "Open", "Settings", empty: "You are not a member of any project yet." `?` help (Navigation): "Alt + P: Switch project".

### Keyboard and accessibility

- Switcher button: `aria-haspopup="dialog"`, `aria-expanded`; the popover is a non-modal `role="dialog"` labelled "Switch project" holding the combobox and listbox (combobox pattern with `aria-controls`). Forced colours: `CanvasText` borders, active option `Highlight`.
- Projects table: real links; the "Needs your decision" cell reads "{n} documents need your decision". Below 700 px the table becomes cards like other `DataTable`s; the switcher popover becomes the full-width sheet (`Popover`'s narrow mode).

### Tests

- Unit (`tests/router.test.ts`, `tests/shell.test.tsx`, `tests/projectPicker.test.tsx` for the switcher, new `tests/projectsPage.test.tsx` and `tests/lastProject.test.ts`): route; switcher in the nav and in the reading "Sections"; filter, arrows without navigation, Enter, Ctrl + Enter, Esc focus return, `Alt+P` incl. `event.code`; "All projects"; table columns per role; lazy summary failure shows "–"; landing rules (remembered, inaccessible, none, non-lead).
- Browser (`browser/lead-workflow.spec.ts`): demo-lead switches project via the sidebar in two clicks and by keyboard (`Alt+P`, type, Enter); a login with an inaccessible remembered project lands on Projects.

---

## Deviations from earlier specs

1. **Axes spec 1.3:** the hint no longer says "Press D"; the button moves from under the rows to the Values heading row. Clicking the chosen default confirms that axis (new; 1.5 keys unchanged otherwise).
2. **Open items (`openItems.ts`):** `defaulted` and `unconfirmed-values` are no longer listed in the Submit dialog's generic list; they get their own section. The toolbar "Next open item" is unchanged.
3. **Submit dialog primary label:** always "Submit case" (no "Continue and submit").
4. **Q3 (quick fixes spec):** the header project picker is replaced by the sidebar switcher (combobox with listbox instead of a disclosure of links; arrows still never navigate, links kept inside the options for modified clicks).
5. **D7 (lead workflow spec):** landing is the last-used project for every role, the Projects page when there is none (D4, confirmed).

DESIGN.md rows for the values block, term search, submit dialog and shell navigation are updated with the implementation.

## Out of scope

Findings 5 (experiencer "family member") and 6 (modifiers), both product decisions; the consolidation view (acceptance fixes spec); a batch `set_axes` command.

## Work packages

| WP  | Content                                                                                          | Files (main)                                                                                                                                                                              | Size | Notes                                                         |
| --- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------- |
| AV  | F3: click-to-confirm on the default, button on the heading row, hint copy                        | `editor/AnnotationPanel.tsx`, `styles/screens/editor.css`, `DESIGN.md`                                                                                                                    | S    | First; AS builds on its write path                            |
| AS  | F2: Unconfirmed values section, per-row and bulk confirm, acknowledgement flow, rule-on blocking | `editor/SubmitCaseDialog.tsx`, `editor/openItems.ts`, `app/CaseScreen.tsx`                                                                                                                | M    | Behaviour-critical (acknowledgement); one Claude code review  |
| AP  | F1: handles on the pending mark, bar at the mark, inspector Discard, global Esc, re-prefill      | `app/CaseScreen.tsx`, `editor/TextPane.tsx`, `spans/adapter.ts`, `vendor/spans.js` (handle labels), `editor/SearchPanel.tsx`, `editor.css`                                                | M    | After `fix/acceptance-20261021` is merged (same prefill code) |
| AR  | F4: constant rows, two-line clamp, fixed detail area                                             | `editor/SearchPanel.tsx`, `styles/screens/editor.css`                                                                                                                                     | S    | After the acceptance-fixes merge; not in the same wave as AP  |
| AT  | F7: status tabs and `status` route parameter                                                     | `tasks/MyTasks.tsx`, `app/router.ts`                                                                                                                                                      | S    | Independent                                                   |
| AH  | F8: sidebar switcher (`Alt+P`), Projects page, landing rules                                     | new `app/ProjectsPage.tsx`, `app/router.ts`, `app/Shell.tsx`, `app/ProjectPicker.tsx` (becomes the switcher), `app/lastProject.ts`, `App.tsx`, `ui/shortcuts.ts`, `styles/components.css` | M    | Shares `router.ts` with AT: same agent or sequential          |

Waves (max 3 agents): 1 = AV → AS (one agent), AT + AH (one agent) · 2 (after the acceptance-fixes merge) = AP, then AR. Verification local only: `bash scripts/check.sh --quick --base main` per WP, Playwright against `tests/browser_server.py` with its own `HPO_E2E_PORT`, evidence into the worktree evidence directory; full gate once at the end. No Docker rebuild as part of the WPs.

## Open points

None. D2, D4 and `Alt+P` for the switcher were confirmed by the user on 2026-10-21.
