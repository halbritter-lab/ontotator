# Quick fixes and export clarity: design

Status: design proposal, 2026-10-19; not implemented.
Source findings: F35, F40, F41, F47, F48 and the quick-fix list in the [walkthrough UX analysis](../reviews/2026-10-19-candidate-walkthrough-ux-analysis.md) (clusters 3 and 5). Sibling spec: [Documents as the lead's table](2026-10-19-documents-lead-table-design.md); where both touch the same code, that spec wins and this one says so. Mockups: `.superpowers/mockups/quick-fixes/` (`project-picker.html`, `export-preflight.html`, `export-readme-index.html`). Where a mockup and this spec differ, this spec wins.

## Scope and order

Nine small changes with no workflow-contract questions. Each can ship before the Documents spec and must make sense on its own. They can land as one batch; F48 is the only backend change.

| # | Fix | Files | After the Documents spec |
|---|---|---|---|
| Q1 | F35 dialog Close in footer | `tasks/RoundInputEvidenceDialog.tsx`, `tasks/WorkRoundsDialog.tsx`, `tasks/TaskProblemActions.tsx` | Stays |
| Q2 | F40 My tasks filter label and visibility | `tasks/MyTasks.tsx`, `app/Shell.tsx` | Stays |
| Q3 | F41 project picker with light dismiss | `app/Shell.tsx`, `styles/components.css` | Stays |
| Q4 | F47 export preflight Cancel and button hierarchy | `admin/FinalExportPanel.tsx`, `admin/ProjectDashboardPage.tsx` (`WorkflowWarnings`), `styles/components.css` | Stays; the warning link target is replaced by the Documents spec |
| Q5 | F48 `README.txt` and `index.csv` in the final export | `exchange/final_export.py`, `admin/FinalExportPanel.tsx` (copy) | Stays |
| Q6 | One time zone in `FinalResultSelector` | `variants/FinalResultSelector.tsx` | **Obsolete**: the selector and the Submission history dialog are replaced by the expanded row |
| Q7 | Resize-handle focus ring contrast | `styles/screens/editor.css` | Stays |
| Q8 | Carried-panel list marker overflow | `styles/screens/editor.css` | Stays (obsolete only once the carried-finding redesign of cluster 1 merges the two lists) |
| Q9 | My tasks counts row semantics | `tasks/MyTasks.tsx`, `styles/components.css` | Stays |

Out of scope: a header close button in `Dialog` (changes every dialog including `ConfirmDialog` busy behaviour; see Open questions), the F44 sidebar splitter, report and round redesigns (clusters 1 and 2), and anything the Documents spec covers (Progress warning list, Submissions table, per-row export warning links).

Shared rules (as in the Documents spec): visible text for every state, icons from `ui/icons.tsx`, no Unicode glyphs as icons, local times via `formatDateTime`, unavailable actions use `aria-disabled="true"` plus a visible reason referenced by `aria-describedby` instead of native `disabled` where the reason is not obvious.

## Q1 (F35): dialog Close in the fixed footer

**Today.** All three dialogs pass their Close button as `children`, so it renders inside the scrolling `.ui-dialog-body`: `RoundInputEvidenceDialog.tsx:23` ("Close original evidence"), `WorkRoundsDialog.tsx:23` ("Close"), `TaskProblemActions.tsx:59-60` ("Reload my reports", "Close reports"). `Dialog` already has a `footer` prop (`ui/Dialog.tsx:12, :53`) that renders `.modal-actions` outside the scroll area (`components.css:625-631`: body `overflow: auto`, dialog capped at `100dvh - space-6`). Live: Close at y≈2035 in a 900 px viewport.

**Target.** Move these buttons to `footer`. Labels and accessible names stay unchanged (straight swap rule in DESIGN.md, so existing tests keep working).

- `RoundInputEvidenceDialog`: footer = "Close original evidence".
- `WorkRoundsDialog`: footer = "Close". "Retry round list" stays in the body next to its error.
- `TaskProblemActions`: footer = "Reload my reports", then "Close reports" (last, right-aligned by `.modal-actions`). Both keep `disabled={busy}`; `onClose` keeps ignoring Escape while busy.

**Keyboard and screen reader.** Tab order: heading region, body content, footer buttons; focus trap and Escape unchanged. Footer buttons are outside the scroll container, so a keyboard user reaches Close without scrolling the body.

**Acceptance.**
- At 1440×900 and at 390×844 with a long evidence text, the Close button's bounding box lies inside the viewport without scrolling (browser test, all three dialogs).
- Escape still closes; Tab from the last body control reaches the footer; Shift+Tab from the first control wraps to the footer's last button.
- Busy state in `TaskProblemActions`: both footer buttons disabled, Escape ignored (existing behaviour).

## Q2 (F40): My tasks filter label and visibility

**Today.** `MyTasks.tsx:100` renders `Select` labelled "Project" with options built only from the user's own tasks (`:57`); a lead without tasks sees only "All projects" (screenshot `live-f40-mytasks-lead.png`). The header picker also reads "Project: …" (`Shell.tsx:42`) but lists all memberships (`:40`). Same word, two scopes. Both read the same route parameter (`tasks?project=`, `Shell.tsx:37`), which is intended: choosing a non-managed project in the header filters My tasks.

**Target.**
- Local control label: **"Filter my tasks by project"**. First option: "All my tasks".
- Show it only when the user's tasks span at least two projects, or when a `project` filter is active (so it can be cleared). The existing synthetic option for a filter value without tasks (`:58-61`) stays.
- Header trigger: visible "Project: {name}" / "Choose project"; accessible name "Current project: {name}" / "Choose project" (Q3).

**Keyboard and screen reader.** Unchanged native select. When the filter is hidden nothing replaces it; the counts row (Q9) names the scope.

**Acceptance.**
- Lead with no tasks: no filter control; header trigger reads "Choose project" or the current project.
- User with tasks in one project and no filter: no filter control. With `?project=x`: control visible, value x, "All my tasks" clears it.
- User with tasks in two projects: control visible with both, labelled "Filter my tasks by project".

## Q3 (F41): project picker with light dismiss

**Today.** `Shell.tsx:41-61` uses a native `<details>` with a search field and a `Select` labelled "Current project" whose `onChange` navigates (`:45-54`). Selection does not close it; there is no Escape or outside-click handling; `Shell` stays mounted across routes (`App.tsx:211`), so the menu stays open over the Documents filters (`live-f41-open-after-select.png`). In Chromium and Firefox, arrow keys on a closed native select fire `change`, so keyboard browsing navigates on every key press (WCAG 3.2.2).

**Options.**
- A. Button and popover, keeping the search field and the navigating select. Fixes dismissal but keeps the on-input navigation problem and the second "Current project" label that duplicates the trigger.
- B. **Button and popover listing projects as links** (recommended). Links have real `href`s (open in new tab works), `aria-current` marks the current project, nothing navigates on arrow keys, and the duplicate select disappears.
- C. Projects as links in the sidebar navigation, no popover. Does not scale beyond a handful of projects and does not exist in the reading shell, which has no persistent sidebar.

**Decision: B.**

**Structure.**
- Trigger: `Button variant="quiet" size="sm"` with `aria-expanded`, `aria-controls="shell-project-panel"`, visible text "Project: {name}" or "Choose project", trailing `IconChevronRight` rotated 90° when open (150 ms, instant under reduced motion). Accessible name per Q2.
- Panel (`id="shell-project-panel"`, a plain `div` with `hidden` when closed; not `role="menu"` or `dialog`, it is a disclosure): optional "Find project" search field, then `<ul aria-label="Projects">` of links, then the existing "No matching projects." `role="status"` line.
- Search field shown only when the user has more than 6 projects; filtering is unchanged (name and key, case-insensitive).
- Each item: `<a href={routeHref(destination)}>` with the project name; second line in `text-muted` `size-sm`: "{key} · opens Documents" or "{key} · opens My tasks" (key omitted when equal to the name). Destination unchanged: `can_manage` → `projectDocuments`, otherwise `tasks?project=`.
- Current project: `aria-current="true"`, `IconCheck` and visible text "Current" (never colour alone); `accent-light` fill.
- The "Project key: …" line is dropped; the key now appears per item.

**Behaviour.**
- Plain left click or Enter on a link: `preventDefault`, `onNavigate`, close, clear search, focus the trigger. Modified clicks keep browser behaviour and leave the panel open.
- Escape while focus is in the trigger or panel (including the search field): close, focus the trigger. Handled on the picker's wrapper and stopped there, so no editor Escape action fires at the same time.
- Pointer down outside the wrapper: close; focus is not moved.
- Focus leaves the wrapper (Tab past the last link, or `focusout` with an outside `relatedTarget`): close.
- Route change (any `route` change in `Shell`): close and clear search.
- Opening: focus stays on the trigger (disclosure pattern); Tab enters the panel. When the search field is shown, focus moves to it on open instead.
- Position as today (`.shell-project-menu`, absolute, `z-index: 110`, full width below 700 px); max height 65dvh with internal scroll.

**Acceptance.**
- After selecting a project, the panel is closed (`aria-expanded="false"`, panel `hidden`) and the Documents filters are not covered.
- Escape from the search field and from a link closes and returns focus to the trigger; an open editor selection is not cancelled by the same keypress.
- Outside click, Tab out, and route change via the sidebar each close it.
- Arrow keys never navigate. Ctrl/Cmd+click opens the project in a new tab and the current page does not navigate.
- The current project is announced as "current" and shows the "Current" text.

## Q4 (F47): export preflight Cancel and button hierarchy

**Today.** `FinalExportPanel.tsx:61` keeps "Review final export" as the primary button after the preflight opens; "Create final export" is secondary (`:66`); the only way back is the link "Return to results" to Documents (`:67`); there is no cancel. The warning list (`ProjectDashboardPage.tsx:8`) renders reason `<p>` with its bottom margin before the "Review issue" link and no gap between items, so each link sits closer to the next item than to its own (`live-f47-preflight.png`).

**Target: one primary per state.**

| State | Visible actions |
|---|---|
| Idle | Primary **"Prepare final export"** (renamed from "Review final export"; loading while the preflight request runs). |
| Preflight open | Trigger hidden. Region "Export preflight" with a summary line, the warning list, the acknowledgement checkbox, then a `Toolbar` "Final export actions": primary **"Create final export"**, quiet **"Cancel"**. "Return to results" removed. |
| Creating | "Create final export" loading; Cancel unavailable (`aria-disabled`, reason "The export is being created."). |
| Job running / succeeded | Status line as today; after success primary **"Download final export"**, secondary "Prepare a new export" (returns to Idle). |
| Error | `ErrorNotice` plus the existing hint, Idle actions. |

- Summary line: "{n} selected results · {w} warnings · {o} omitted" (zero parts kept, so the line is stable).
- Create unavailable: no selections → `aria-disabled` described by the existing warning message; warnings present but not acknowledged → `aria-disabled` described by a visible hint "Confirm the warnings and omissions above to continue." directly above the toolbar. Activating it in that state moves focus to the checkbox. Guards in `start()` stay.
- Cancel: increments `generation` (drops any in-flight preflight), clears `state`, `accepted` and `error`, returns to Idle, focuses "Prepare final export". No request is sent.
- Opening the preflight focuses its `<h3 tabindex="-1">` "Export preflight".
- Warning list spacing: each `li` gets `padding-block: var(--space-2)` and a hairline separator; the reason `p` gets `margin: 0 0 var(--space-1)`; the link follows directly. Link text "Review issue" stays until the Documents spec gives it a row target.
- Existing `ontotator:final-selection-changed` invalidation keeps returning to Idle; add an `InlineMessage tone="info"` "Final selections changed. Prepare the export again." so the change is not silent.
- Research export cards stay secondary (unchanged).

**Keyboard and screen reader.** Preflight region is `<section aria-labelledby>`; no Escape binding (not a modal). Status of the job stays in the existing `role="status"` line.

**Acceptance.**
- Exactly one `.btn-primary` inside the final export section in every state.
- Cancel returns to Idle with the checkbox state cleared and focus on "Prepare final export"; a preflight response arriving after Cancel is discarded.
- With unacknowledged warnings, "Create final export" is focusable, announced as unavailable with the hint, and does not start a job.
- In the warning list, the vertical gap between a link and its own reason is smaller than the gap to the next item (browser geometry check).

**After the Documents spec.** Its "Export preflight" change replaces each warning link with a link to the affected row; the rest of Q4 stays.

## Q5 (F48): `README.txt` and `index.csv` in the final export

### Archive structure today (confirmed in code)

`final_t1_export` (`exchange/final_export.py:129-174`) writes one ZIP (downloaded as `{project}-final.zip`, `FinalExportPanel.tsx:56`):

| Entry | Content | Source |
|---|---|---|
| `selected.t1.zip` | T1 (ontospan) bundle `selected-{snapshot_id}`: `manifest.json` plus `documents/{index:05d}.json`, one unit per selected submission in `selected_content.submissions` order; annotation set id `submission-{submission_id}` | `final_export.py:114-124`, `jobs.py:303-317, 346-361`, `ontospan/bundle.py:137-159` |
| `provenance.t1.zip` | Same format, `provenance-{snapshot_id}`; only when carried or merged inputs reference non-selected submissions | `:130-147` |
| `source-texts.jsonl` | One JSON line per frozen text version (`document`, `source_text_sha256`, `variant`), in frozen order | `:125-129` |
| `receipt.json` | `ontotator-final-export/v1`: snapshot id and hash, selections, warnings, omissions, human inputs, source reviews, review decisions, provenance-only ids, `files` = SHA-256 of every other entry | `:148-174` |

### Change

Add two root entries, built from the frozen snapshot only (no live reads, no wall-clock time), inserted into `files` **before** the receipt is computed so `receipt.files` lists their SHA-256. `receipt.json` remains the only unhashed entry. Nothing inside the T1 bundles changes: entry names, `bundle_id`, set ids, `manifest.json` and ontospan field names keep their names. The README explains them instead of renaming them.

Encoding: UTF-8 without BOM. `README.txt` uses LF; `index.csv` uses RFC 4180 (comma, double-quote escaping, CRLF, Python `csv` defaults), one header row.

### `index.csv`

One row per selection, per omission and per provenance-only submission. Sorted by `case_id`, `language`, `row_type` (selected, omitted, provenance), `submission_id`.

| Column | Value | Source |
|---|---|---|
| `row_type` | `selected`, `omitted` or `provenance` | selections, omissions, closure |
| `case_id` | text ID | selection / omission / `document.case_id` |
| `language` | language code | idem |
| `document_id` | text version ID; empty for omitted | selection / `origin_key.document_id` |
| `text_version` | `variant.version`; empty when no variant | frozen document |
| `text_origin` | `native`, `machine_translation`, `human_translation`, `correction`; empty when no variant | `variant.origin` |
| `submission_id` | empty for omitted | selection / closure |
| `submission_kind` | `annotation`, `review`, `consolidation`, `carry_forward` | `round_kinds` first, else `origin_key.mode` (`independent` → annotation) |
| `author` | pseudonym | `origin_key.annotator_id` |
| `submission_created_at` | ISO 8601 as stored | `Submission.created_at` (see Open questions) |
| `findings` | number of annotation snapshots, negated included | `len(snapshots)` |
| `archive_file` | `selected.t1.zip` or `provenance.t1.zip` | |
| `bundle_entry` | `documents/00003.json` | index in the list passed to `serialize_t1_content` |
| `annotation_set_id` | `submission-{submission_id}` | as written by the worker |
| `source_text_line` | 1-based line in `source-texts.jsonl` | frozen document order |
| `warning_codes` | codes for this case and language, `;`-separated, sorted | `state.warnings` |

`bundle_entry` must be derived from the same list and order the worker passes to `serialize_t1_content`; a test opens the inner bundle and checks that `documents/NNNNN.json` carries the listed `annotation_set_id`.

### `README.txt`

Plain English, fixed sections, no Markdown syntax beyond simple underlined headings. Content (full example in the mockup):

1. Title "Ontotator final export", project name and key, snapshot ID, snapshot SHA-256, snapshot time (UTC, from `ExportSelectionSnapshotRow.created_at`).
2. Summary counts: selected results, omitted text-language pairs, warnings acknowledged, provenance-only submissions.
3. "What is in this archive": one line per file, including "receipt.json: audit receipt; lists the SHA-256 of every other file, including this README and index.csv".
4. "How to read it": one row of `index.csv` per result; T1 = ontospan bundle (ZIP with `manifest.json` and `documents/NNNNN.json`, one per submission); text positions are Unicode code points into the text in `source-texts.jsonl`; author labels are pseudonyms; "provenance" means earlier submissions referenced by carried or merged findings, not final results.
5. "Omitted": one line per omission, "{case_id} ({language}): no final result was selected. No other submission was substituted."
6. "Warnings acknowledged at export": grouped by case and language, the stored `reason` sentence plus its code in brackets; "None." when empty.
7. "Verify": compute SHA-256 of each file and compare with `receipt.json` → `files`.

No truncation: every omission and warning is listed.

### Copy change

`FinalExportPanel` intro gains: "The archive includes README.txt and index.csv, a plain-language guide and a table of every result."

### Acceptance

- Archive names: `selected.t1.zip`, `source-texts.jsonl`, `receipt.json`, `README.txt`, `index.csv`, plus `provenance.t1.zip` when applicable.
- `receipt.files` contains `README.txt` and `index.csv` with correct hashes; recomputing every hash matches.
- `index.csv` row count = selections + omissions + provenance-only submissions; each `selected` row's `bundle_entry` resolves to a unit whose set id equals `annotation_set_id`.
- Two exports of the same snapshot produce byte-identical `README.txt` and `index.csv`.
- Existing tests (`test_final_export.py`, `test_final_human_export.py`, `test_final_source_reviews.py`) still pass; inner bundles re-import unchanged.

## Q6: one time zone in `FinalResultSelector` (obsolete after the Documents spec)

**Today.** `FinalResultSelector.tsx:54` renders option labels with raw `row.created_at` (UTC ISO, "…T22:57:…Z"), while `SubmissionHistory.tsx:57` shows `formatDateTime(row.created_at)` (local, "19 Oct 2026, 00:57"). The same two submissions look like four times (`live-f46-submissions.png`).

**Target.** Option label `{author_label} · {formatDateTime(created_at)} · {submission_id}`; same field and formatter as the history rows. No other change.

**Acceptance.** For each submission the option label and the history row show the same local time string (unit test with a fixed `TZ`).

## Q7: resize-handle focus ring contrast

**Today.** `editor.css:628-634` removes the outline and paints `box-shadow: 0 0 0 3px var(--accent-light)` around the 3 px handle bar: about 1.1:1 against the sheet, so keyboard focus is invisible. The bar itself is `--mark-selected`, the same colour as `--focus-ring`, so a plain ring would merge with it.

**Target.** `.resize-handle:focus-visible::before { box-shadow: 0 0 0 2px var(--surface-raised), 0 0 0 4px var(--focus-ring); }`: a sheet-coloured gap then a 2 px focus ring. No geometry change, no text movement.

Also remove the dead rule `components.css:129-132` (`accent-light` ring), which is overridden by `:429-432` and keeps the "borderline" reading of form focus alive in reviews; the effective form focus (2 px of `--focus-ring`) is unchanged.

**Acceptance.** Focus ring ≥ 3:1 against `surface-raised` and every `mark-*-fill` (add the pair to `tokens.test.ts`); visible in a browser screenshot of a focused handle on a selected mark; no layout shift of the text (existing geometry tests).

## Q8: carried-panel list marker overflow

**Today.** `RoundInputPanel.tsx:81-82` renders `<ol>` inside `.sidebar-scroll`; the global reset (`base.css:1-4`) removes list padding and the reading shell does not restore it (only `.shell-page` lists get `padding-inline-start`, `base.css:181-182`), so the "1." marker hangs outside the 260 px panel edge.

**Target.** `.round-input-panel ol { padding-inline-start: var(--space-5); }` (fits two-digit markers at `size-sm`). Same for `.work-round-actions ol` (`WorkRoundActions.tsx:46`, inside the Work rounds dialog).

**Acceptance.** At 260 px and 220 px sidebar widths, the marker's bounding box lies inside the panel (browser geometry check); no horizontal scrollbar in `.sidebar-scroll`.

## Q9: My tasks counts row semantics

**Today.** `MyTasks.tsx:104` uses `<p role="group" aria-label="Task counts">` with "·"-joined text. A paragraph with a group role and no grouped controls is announced oddly, and counts are shown even when the user has no tasks.

**Target.**
- `<ul className="task-counts" aria-label="Task counts">` (or "Task counts in {project}" when filtered) with four `<li>` items "Open: n", "In progress: n", "Submitted: n", "Paused: n". Separators are CSS gaps (`display: flex; gap: var(--space-4); list-style: none`), not glyphs.
- Hidden when the user has no tasks at all (the empty state explains).

**Acceptance.** Screen reader announces "Task counts, list, 4 items"; no "·" characters in the accessible text; no counts row for a user without tasks.

## Resolved questions (user decisions 2026-10-19)

1. **Receipt format** stays `ontotator-final-export/v1`; the two new files are additive.
2. **Snapshot time.** The frozen snapshot also stores the server's `recorded_at` for new exports (hash changes only for new exports); README and index show it as "Submitted".
3. **index.csv** is UTF-8 **with** BOM so spreadsheet tools show non-ASCII text (µ, ±, Greek, umlauts) correctly; the receipt hash covers the file as written.
4. **My tasks counts** show paused tasks as "of which paused: n" next to the status counts, so the numbers add up.
5. **Dialog header close button** comes with the editor spec's Dialog change (F35), not in this batch.
6. Project picker (link panel), export preflight, README.txt and index.csv as designed; README/index details delegated to the assistant.
