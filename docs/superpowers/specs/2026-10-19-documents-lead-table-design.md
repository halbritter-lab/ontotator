# Documents as the lead's table: design

Status: design agreed in conversation on 2026-10-19, revised after review and three scenario walkthroughs on 2026-10-19 (user decisions D1 to D3 included); not implemented.
Source findings: F42, F43, F46 and parts of F47 in the [walkthrough UX analysis](../reviews/2026-10-19-candidate-walkthrough-ux-analysis.md). Mockups: `.superpowers/brainstorm/21890-1792397555/content/` (`documents-scenarios.html`, `final-inline.html`, `final-three-variants.html`). Where a mockup and this spec differ, this spec wins.

## Goal

A project lead finds every key fact about the texts in one place: what state each text and language is in, who works on it, which result is final, and what needs the lead's decision. They act on it without leaving the page. Today these facts are spread over the Documents tree (free-text summaries, raw IDs), the Progress warning list (generic "Review issue" links) and the Submission history dialog (history, reaffirmation, replacement and consolidation mixed together).

## Decisions taken

1. **Documents becomes the central table** (option C of three). A compact "Needs your decision" bar above the table filters it. No new page. Progress keeps only statistics.
2. **One row = one text in one language** (option A of three). This is the unit a final result is chosen for. Text versions, corrections and independent translations are expanded child content, not top-level rows.
3. **A missing final result counts as a decision only once at least one submission exists and all work on that text and language is submitted** (option C of three). Before that it appears only under the "No final result" filter and in the export preflight. See "Missing final result rule".
4. **The final result is chosen inline in the expanded row** (option A of three; side panel and dialog were rejected).
5. **D1, newer result:** a submission recorded after the final result was chosen raises the acknowledgeable cause `SELECTED_NEWER_RESULT` (category "Final result to confirm").
6. **D2, text correction:** `SELECTED_TEXT_CORRECTED` is raised again when the correction becomes accepted; rejected or queried corrections raise no cause.
7. **D3, orphaned pause:** a task paused while no open report holds it needs a decision (category "Problem report or paused task", link "Resume task"). Resolving a report and releasing its pauses stay separate actions.
8. **D4, own results (2026-10-19):** with `adjudicator_not_annotator` on, a lead cannot select their own submission as final; without it, the confirmation only notes "This is your own result." The rule stays a lead-editable project setting.

## Data model terms

- **Text ID** = `case_id`. A row is (`case_id`, `language`).
- **Chain:** a root version (native, machine or human translation) plus its corrections (`origin = correction`, linked by `derived_from`). Versions are numbered per chain (per `external_id`), so parallel roots are both v1.
- **Chain name:** the root's translation run, "{provider} {model}" (provider alone without a model; "Human translation"; "Source" for native text). Corrections have no run and inherit the root's name. If two roots of a row share a name, " · {external_id}" is appended. A version is written "{chain name} v{n}" when the row has parallel roots, otherwise "v{n}". There is no other version wording (no "on DeepL · v3 v1").
- **Newest version** = the highest version of one chain. A row with parallel roots has no row-level newest version.
- **Translation status** (`documents.translation_status`): `translated`, `automatic_check_failed`, `ready_for_review`, `reviewed`, `accepted`; null for native chains, including native corrections (these never block bulk selection). There is no "rejected" status: rejected and queried reviews set the version to `reviewed` (`domain/translation_review.next_status`). `accepted_corrected` sets the reviewed version to `reviewed` and creates an accepted child correction. The review decision comes from the latest `translation_reviews` row of the version.
- **Not newer:** a correction whose latest review is rejected or queried does not count as newer for bulk selection and does not raise `SELECTED_TEXT_CORRECTED`.
- **Rounds:** an assignment's rounds form a `predecessor_round_id` chain; a round can hold several submissions (`work_round_state.latest_submission_id` is the latest). Translation-review assignments also create rounds (`mode` null); these are never listed in Submissions.
- **Submission kind:** Consolidation (round kind `consolidation`), Carry-forward (round kind `carry_forward`), otherwise Annotation (mode `independent`) or Review (mode `review`).

## Shared rules

- **Person label:** the pseudonym (`author_label`, today the submission's `annotator_id`, e.g. "ann-0004") everywhere on this page and in confirmations. The lead's own items carry "(you)" after the label; inside parentheses it becomes ", you" ("Round 1 (lead-0002, you)"), never nested parentheses. Display names stay where they appear today (assignment controls in "Text versions").
- **Round numbers** count per assignment from 1 along the `predecessor_round_id` chain. A submission without a round (`round_id` null) is "Initial submission"; this comes before Round 1 by design.
- **Times:** local, e.g. "19 Oct, 00:57"; the year is added when it is not the current year. Seconds only where two otherwise identical labels share a minute. Every time is a `<time datetime>` whose `title` carries the full timestamp with time zone.
- **"Submitted" time** = the server's `submissions.recorded_at` (not the client-supplied `created_at`).
- **Findings count** = annotation snapshots in the submission, including negated findings.
- **Submission label** (Final column, confirmations, notices): "{kind} · {Round n | Initial submission} · {author} · {language} {version} · {time}", e.g. "Annotation · Round 2 · ann-0004 · de v1 · 19 Oct, 00:57". Consolidations omit the round: "Consolidation · lead-0002 · de v1 · 18 Oct, 10:00". The Final column omits the language. IDs are never part of a label; they are under "Technical details".
- **Long IDs:** middle ellipsis in cells (`case-…-0211`), full value in `title` and "Technical details"; confirmations never truncate.
- **Icons** from `ui/icons.tsx` (`IconCheck`, `IconWarning`, `IconChevronRight`, `IconClose`); no Unicode glyphs in the UI.
- **Status** never by colour alone: every badge has text and a shape (`StatusBadge`).
- **Disabled actions:** never natively disabled. Unavailable actions use `aria-disabled="true"` plus `aria-describedby` pointing to a visible reason; activation shows or announces the reason.
- **Access:** Documents is lead-only. Non-leads do not see the navigation entry; a direct visit shows `EmptyState` "Documents is for project leads" with a link to My tasks. The access check runs before any skeleton is shown.

## Table

### Structure and semantics

A native `<table>` (no `role="treegrid"`). Keyboard navigation is Tab and Shift+Tab only.

- Each text is one `<tbody>` rowgroup. Its first row is a group header: one `<th scope="rowgroup" colspan>` with a disclosure `<button aria-expanded aria-controls>` named "{text ID}, {n} languages, final {n} of {m}", followed by visible "n issues" (bar categories only) and "n notes" (other causes) counts. No names in the header.
- Each language row has a `<th scope="row">` with the row disclosure `<button aria-expanded aria-controls>` (`IconChevronRight`, rotated when open) named "Show submissions, {text ID} · {language}" and the link "Open" named "Open {text ID} · {language}".
- Expanded content is a following `<tr>` with one `<td colspan>` containing `<section role="region" aria-labelledby>` with `<h3>` sections.
- Group expansion: groups with a bar-category issue start expanded; others start collapsed when the project has more than 50 texts (counted after filtering).
- **Paging:** 50 text groups per page, groups ordered by the lowest `documents.position` of their versions, then `case_id`; a group is never split. Sorting applies within groups; within a group the source-language row comes first, then by language code. Changing a filter or category resets to page 1.

### Columns (language row), 7 columns

| Column | Content | Notes |
|---|---|---|
| Select | Bulk-assignment checkbox | See "Bulk selection" |
| Text · language | Row header: disclosure, language code, "Open"; "Open my task" when the lead has an open own task here | "Open" opens the case at the final result's version; without a final result the newest version of the chain; with parallel roots and no final result the newest version of the most recently created root, and the link's description says so ("Opens DeepL v2, the most recent translation"). "Open my task" opens the lead's own task on the newest version. |
| Text version(s) | Single chain: newest version, origin and badge, e.g. "v3 · Correction of v2 · Ready for review". Parallel roots: "2 independent translations" plus chain names | Version badge shows the review decision where relevant: "Rejected in review", "Queried" (status `reviewed` from a rejected or queried review) |
| Work | Aggregated over all versions of the row | See "Work wording" |
| Final result | `IconCheck` + label without language; " · {chain name} v{n}" or " · v{n}" when the final version is not the newest of its chain or the row has parallel roots; or "None" | Always the full row, regardless of filters |
| Issues | Warning `StatusBadge` with the count of bar-category causes; neutral "n notes" text for other causes | Accessible label grouped by category, e.g. "2 issues: problem report or paused task 1; final result to confirm 1. 1 note: source text changed". `ROUND_REVIEW_PENDING` is not counted (it appears as the waiting line). |
| Last activity | Date and time | See "Last activity" |

Filters "Origin" and "Translation status" move under "More filters" next to Language, Status and ID. Status values: Unassigned, Open, In progress, Submitted, Reopened, Paused (`held`). Translation status values add "Accepted without review" (`accepted_without_review`).

**Filter semantics:** filters select rows, never narrow row content. A row matches when any of its versions matches; matching versions are marked in "Text versions", and a collapsed row whose displayed version does not match shows "Matched: v1 · Check failed". `q` matches a prefix of the `case_id` or of any `external_id` or `document_id` in the row (both sides NFKC-normalized); the row is shown whole.

### Work wording

- Per assignment state: "ann-0004 annotating (Round 3)", "Annotation review open", "Translation review open (v3)", "Reopened", a "Paused" badge for an active hold. More than two assignees become counts ("2 of 3 submitted"); names on expand.
- Built from `ProjectDocumentSummary.assignees`, rounds and holds across all versions of the row.

### Issues and notes per row

| Item | Source | Bar category | Row wording |
|---|---|---|---|
| Open problem report | `OPEN_PROBLEM_REPORT` | Problem report or paused task | Report line (Issues section) |
| Task paused without open report | Active `TASK_ON_HOLD` whose report is not open (derived code `TASK_PAUSED_WITHOUT_REPORT`, cause id `TASK_PAUSED_WITHOUT_REPORT:{hold_id}`) | Problem report or paused task | "ann-0004's task is paused, but its report is resolved." Link "Resume task" (report page, action resume) |
| Final result to confirm | Unacknowledged `SELECTED_ROUND_ABANDONED`, `SELECTED_ROUND_SUPERSEDED`, `SELECTED_RESULT_REVISED`, `SELECTED_TEXT_CORRECTED`, `SELECTED_NEWER_RESULT` | Final result to confirm | Selection notice |
| Translation check failed | Newest version of a chain has `automatic_check_failed`, no accepted correction | Translation check or review failed | Issues section, link "Text versions" |
| Translation not accepted | Newest version of a chain is `reviewed` with a rejected or queried latest review, no accepted correction | Translation check or review failed | "v2 was rejected in review." / "v2 was queried in review." Link "Text versions" |
| Final result missing | Missing-final rule holds | Final result missing | Issues section, link to Submissions |
| Waiting for work | All unsubmitted rounds and open translation reviews of the row (includes `ROUND_REVIEW_PENDING`) | No | Waiting line in the selection notice |
| Source text changed | `SOURCE_UPDATE_UNREVIEWED` | No (note) | Issues section, link "Review source change" (case viewer at that version) |
| Task paused | `TASK_ON_HOLD` with an open report, including holds placed by `extend_hold` from another row's report | No (note) | "Task paused" with "Open report" linking to the report that caused it |
| Reviewer needed | Newest version is a translation correction `ready_for_review` without a non-revoked translation_review assignment | No (note) | "v2 needs a translation reviewer" |

`SOURCE_UPDATE_UNREVIEWED` uses the same filter as the preflight: only chains with a final selection or active work (`_projection` today). `MISSING_FINAL_SELECTION` appears in the Issues column only when the missing-final rule holds; otherwise the Final result column shows "None".

### Missing final result rule

A missing final result counts (bar, Issues column, "Needs your decision" filter) only when all hold for the row:

1. No final selection exists.
2. At least one submission exists on any version of the row.
3. Every non-revoked assignment of any task type (annotate, review, translation_review) on any version of the row has status `submitted`. A paused assignment counts as not submitted. If no non-revoked assignment remains, this holds.

A lead's own open task counts like any other. The export preflight's `MISSING_FINAL_SELECTION` stays unconditional; "No final result" = all rows without a selection.

### Last activity

The latest of these on any version of the row:

| Event | Source |
|---|---|
| Assignment created, updated, revoked | `assignments.created_at`, `updated_at`, `revoked_at` |
| Draft saved | `drafts.updated_at`, `translation_review_drafts.updated_at` |
| Round created | `work_rounds.created_at` |
| Submission | `submissions.recorded_at` |
| Translation review decision, including a correction it creates | `translation_reviews.created_at` |
| Source review resolved | `review_obligation_resolutions.created_at` |
| Final selection change | `final_selections.updated_at` |
| Problem report and hold | `problem_reports.created_at`, `task_holds.created_at`, `problem_report_events.created_at` |

`documents` has no creation timestamp. Corrections created by translation review are covered by `translation_reviews.created_at`; imported versions and corrections are import, which is not activity. The group header shows the maximum of its rows.

### Bulk selection

- A row with a single chain has a checkbox that selects the chain's newest version, skipping corrections that are not newer (rejected or queried). If that version is a translation correction `ready_for_review`, the checkbox is replaced by "Choose in Text versions".
- A row with parallel roots always shows "Choose in Text versions"; per-version checkboxes appear in its "Text versions" child rows.
- "Select all" selects every row with a checkbox on the current page, including collapsed groups, and reports skipped rows ("Selected 42 rows. 3 rows need a choice in Text versions.").
- Bulk "Assign …" and "Propose distribution …" act on the selected versions as today.

### Narrow viewports (< 700px)

- Each row is an `<article aria-labelledby>` card in a list (not restyled table rows). Line 1: checkbox, text · language (heading), issue badge. Line 2: version and status. Line 3: final result (wraps after the label's author; the version marker stays with the time). Line 4: work and last activity. Last line: "Open" and "Show submissions" (wraps as a whole link, never mid-link).
- Expanded content stacks below the card; submissions become two-line items (label and Final badge; findings and actions). `InlineConfirm` renders as a block below its item.
- Long IDs use the middle ellipsis. No horizontal scrolling for primary facts; reflow is verified at 320 CSS px.
- Interactive targets are at least 24×24 px at all widths.

## "Needs your decision" bar

A `<h2>` "Needs your decision" (visually small) and `IconWarning` with the count n; while the decision filter is active, per-category links. Next to it, a segmented filter: **All · Needs your decision (n) · No final result (m)**, rendered as links with `aria-current`; the active segment is marked by border and underline, not fill alone. It stays visible when n = 0 (warning text then omitted).

| Category | Counts a row when | Route |
|---|---|---|
| Problem report or paused task | `OPEN_PROBLEM_REPORT` or `TASK_PAUSED_WITHOUT_REPORT` | `decision=report-or-pause` |
| Final result to confirm | Any unacknowledged acknowledgeable cause (five codes) | `decision=confirm-final` |
| Translation check or review failed | Translation check failed or translation not accepted | `decision=translation` |
| Final result missing | Missing-final rule holds | `decision=missing-final` |

Four categories are kept: the orphaned pause is merged with problem reports because both are resolved on the report page (resume, resolve, restart) and a lead reads them as one "stuck work" question.

- Counts are rows; n counts distinct rows, a row in two categories counts once per category.
- Counts are project-wide and ignore other filters. Category links keep Language, Status and ID filters; when these hide affected rows, the bar adds "k of n shown · Clear filters".
- Notes (`ROUND_REVIEW_PENDING`, `SOURCE_UPDATE_UNREVIEWED`, `TASK_ON_HOLD` with open report, reviewer needed) are not counted.
- `decision` and `final` are mutually exclusive; setting one clears the other.

### Route query

`ProjectDocumentsQuery` (parser, serializer and the `projectCase` `documents_*` passthrough) gains:

- `case=<text ID>`: exact `case_id`, unlike `q`.
- `language=<code>`: the existing exact filter, used for deep links.
- `decision=all|report-or-pause|confirm-final|translation|missing-final`; `final=missing`.
- `open=<case>:<language>`, repeatable: expanded rows.
- `page=<n>`.

Behaviour:

- Filter, category and page changes push history; expansion (`open`) uses replace navigation (the router gains a replace option on the hash).
- `case` (with optional `language`) expands that group or row, scrolls to it and focuses its row header. A row named by `case` + `language` is never hidden by filters; if it no longer matches `decision`, it shows "This no longer needs your decision." An unknown `case` shows `EmptyState` "Text {case} not found" with "Show all texts".
- The problem report route gains the same `documents_*` passthrough, so its back link restores the full Documents query.
- Export preflight deep links: for a preflight-only `MISSING_FINAL_SELECTION` the row shows "No final result. Not counted as a decision yet: {no submission | work still open: {work summary}}."
- After a filter change, the live region announces "{k} texts shown".

### Resolved rows and empty state

A row that stops matching the active decision filter during this visit stays visible until the filter changes or the page reloads, with a `StatusBadge`:

- "Resolved" (tone success) only when a decision on this page or the report page removed the cause (selection, keep, resume, resolve).
- Otherwise "Changed: {reason}" (tone neutral), e.g. "Changed: Work assigned", "Changed: Task paused".

Resolved rows collapse automatically. When no row matches: `EmptyState` "Nothing needs your decision" with "Show all texts".

### Loading, refresh and errors

- Initial load: skeleton rows inside the table with `aria-busy="true"`. An expanded row shows "Loading submissions…"; its actions are unavailable until loaded. Responses older than the latest request for the same data are discarded.
- Document rows fail: an error with "Retry" replaces table and bar. Submissions fail: an error with "Retry" inside that row. Final selections come with the rows, so there is no separate "unavailable" state.
- Rows and bar refetch on window focus, after every own action and every 60 s. An open confirmation closes only when the row's selection revision or its set of acknowledgeable cause ids changes; other changes (e.g. a waiting line's draft revision) update the row without closing it.
- Success messages include changed bar counts and, while a decision filter is active, "Next decision: {text ID} · {language}" as a link that expands and focuses the next matching row.
- Session expiry (401) is handled by `AuthGate`, which keeps page state; see "Inline confirmation" for confirm behaviour.

## Expanded row

Sections in order, each with an `<h3>`:

### 1. Issues (only if any non-selection issue or note exists)

One line per item in plain words (see "Issues and notes per row"); selection causes and waiting lines live in the selection notice.

- Problem report: description excerpt (first 120 characters), reporter label, report time, task state ("task paused" or "task resumed"), link "Open report".
- Other items: one sentence with a link to where they are resolved.

### 2. Submissions (n)

**Selection notice** (when selection causes or waiting work exist), directly above the table:

- Acknowledgeable causes, one line each:
  - `SELECTED_ROUND_ABANDONED`: "Round 1 (ann-0004) is abandoned."
  - `SELECTED_ROUND_SUPERSEDED`: "Round 1 (ann-0004) has been superseded by Round 2."
  - `SELECTED_RESULT_REVISED`: "Round 1 (ann-0004) has a newer submission ({time})."
  - `SELECTED_NEWER_RESULT`: "Round 2 · ann-0004 · v1 was submitted after the final result was chosen ({selected_at})."
  - `SELECTED_TEXT_CORRECTED`: "v2 (Ready for review) corrects the text of the final result." and, after acceptance, "v2 (Accepted) corrects the text of the final result." Hint: "Keep v1, or choose a result on v2 once one exists (assign work in Text versions)."
- Non-actionable lines: a rejected or queried correction reads "v2 was rejected in review. No action needed."
- Waiting lines, without action, built from all unsubmitted rounds and open translation reviews of the row: "Waiting: Round 3 (ann-0004) is in progress. You can choose again once it is submitted." / "Waiting: translation review of v3 by ann-0009 is open. You can choose again once it is submitted."
- Action (only with at least one acknowledgeable cause): "Keep final result…", opening the Keep confirmation.

Example (S0): final Round 1 · ann-0004, correction v2 in review, ann-0004 on Round 3:

> v2 (Ready for review) corrects the text of the final result.
> Waiting: Round 3 (ann-0004) is in progress. You can choose again once it is submitted.
> [Keep final result…]

**Submissions table:**

| Final | Round | Kind | Version | By | Submitted | Findings | Actions |
|---|---|---|---|---|---|---|---|
| `StatusBadge tone="success"` "Final" with `IconCheck`, row tinted `success-light`; or empty | "Round n" or "Initial submission" as the View link; "· latest" / "· earlier submission" when the round holds several; "· superseded" / "· abandoned" for such rounds | Annotation, Review, Consolidation, Carry-forward | "v2"; "{chain name} v1" with parallel roots | Author label | `recorded_at` | Count | At most two: a selection action and a compare action |

- Sorted oldest first; the final result is not pinned. More than 10 rows collapse to the newest 10 plus "Show all (n)"; the Final row is always shown.
- The Version column is hidden when all submissions share one version.
- The final marker does not reuse `is-selected` or `aria-selected`.
- "Use as final…" when nothing is selected; "Replace…" on non-final rows when a final result exists; none on the final row.
- Compare: with a final result on the same text version, "Compare" (final left, this right). Across versions: "Different text versions; open each with View." Without a final result, "Compare…" asks for a second submission on the same text version (preselects the other one if exactly two).
- Unsubmitted rounds (excluding translation-review rounds) are muted lines sorted last and not counted in n: "Round 3 · ann-0004 · in progress, not submitted yet". No actions.
- Accessible names: View "View {submission label}"; other actions have `aria-describedby` pointing to the label.
- **View** opens the case viewer (`projectCase` with `variant=<document_id>` and `annotations=submission:<submission_id>`) read-only, keeping the Documents query in `documents_*`.
- **Compare** opens the case viewer's compare pane with two `submission` refs. Differences come only from data; time order never implies quality.

**Confirmations** (all `InlineConfirm`, labels never truncated):

- First selection: title "Use as final result", message "Use {label} as the final result for {text ID} · {language}?" Primary "Use as final".
- Replace: title "Replace final result", message "Replace {old label} with {new label}? The previous choice stays in the history." Primary "Replace".
- Keep: title "Keep final result", message "Keep {label} as the final result for {text ID} · {language}?", then the cause lines, the checkbox "I reviewed these changes and keep this exact result" and primary "Keep as final". The button stays enabled (`aria-disabled` while unchecked); activating it unchecked shows "Check the box to confirm you reviewed these changes." It acknowledges the acknowledgeable causes present at open.
- Additions to Use and Replace: when work is still open, "Still open: {work summary}."; for a result from an abandoned or superseded round, "This result belongs to an abandoned round; you will be asked to confirm it again after choosing."; for the lead's own result, "This is your own result." When the project sets `adjudicator_not_annotator`, the lead cannot choose or keep their own submission as final: "Use as final…" and "Keep … as final…" stay focusable with `aria-disabled` and the reason "This project keeps adjudication separate from annotation. Another lead must choose this result." The backend enforces the same rule in `FinalResultService.select` (new domain error `OWN_RESULT_NOT_SELECTABLE`). The rule is a project setting that leads can change in Settings; every final selection stores the rule state at selection time, so a later toggle neither invalidates nor hides earlier decisions.
- Success messages: "{label} is now the final result." / "Kept {label}. Still open: {waiting lines}."

### 3. More

Collapsed until used:

- "Start consolidation…": the existing consolidation flow, unchanged.
- "Text versions (n)": child rows per version with origin, status (with review decision), chain name, assignments with the existing `AssignmentActions` (unchanged, they stay here), per-version bulk checkboxes where required, and View text, Correct translation, Translation reviews.
- "Technical details": document, submission and round IDs, and mode, unabbreviated.

### Inline confirmation

New component `ui/InlineConfirm`:

- Props as `ConfirmDialog` (`title`, `message`, `confirmLabel`, `cancelLabel=Cancel`, `tone`, `busy`, `onConfirm`, `onCancel`) plus optional `children`. Button order as `ConfirmDialog`.
- Renders as a full-width row (`<tr><td colspan>`) below the target submission row (or below the selection notice for Keep); on narrow viewports as a block below the item. `role="group"`, `aria-labelledby` its heading, `aria-describedby` its message. The heading has `tabindex="-1"` and receives focus on open.
- One per page. Opening another while not busy closes the first and announces "Previous confirmation closed."; while busy, other confirm triggers are unavailable.
- Escape is registered via `useShortcut` with `allowInInputs` (the checkbox counts as an input for `isTypingTarget`) and `root` = the confirm element; the handler acts only while focus is inside. Escape and Cancel return focus to the trigger; if the trigger is gone, to the row disclosure.
- Busy: the focused button gets `aria-disabled` and "Saving…" is announced; it is never natively disabled. Escape is consumed and Cancel unavailable while busy.
- `submission_id`, `expected_revision` and acknowledged cause ids are captured at open and never refreshed silently.
- Outcomes:
  - Use or Replace success: focus to the View link of the new Final row. Keep success: focus to the "Submissions" `<h3>` (`tabindex="-1"`).
  - Conflict (revision or warnings): the confirm stays open read-only with "The final result or its warnings changed since you opened this. Nothing was saved. Review the current state." plus "Changed by {selected_by} at {time}." when known; buttons "Review again" (reloads the row) and "Close". Focus to the message.
  - Network or 500: "Could not save. Nothing changed." with "Retry".
  - 401: busy cleared, confirm kept, "Your session ended. Nothing was saved. Sign in and confirm again."; no automatic retry.
- Success and status outcomes are announced in one polite live region outside the table; error messages render inside the confirm.

## Changes elsewhere

- **Progress:** remove the "Final results and open issues" warning list. Keep totals, people and documents statistics. Add the link "Needs your decision (n)" to Documents with `decision=all`.
- **Export preflight:** each warning links to its row (`case`, `language`). Cancel and the primary-button fix belong to the quick-fix work.
- **Problem report detail:** the back link returns to Documents with the full `documents_*` query, or with `case` and `language` of the report when entered directly.
- **Submission history dialog:** replaced by the expanded row. The editor's history keeps a read-only list in the same table format without selection actions; for non-leads without the Final column.

## Design system changes

DESIGN.md is updated with the implementation:

- **InlineConfirm** joins the component table. Documented exception to "confirmation uses `ConfirmDialog`": confirmations bound to a row inside a table (selection, replacement, reaffirmation) use `InlineConfirm`.
- **Button:** `loading` uses `aria-disabled` and swallows activation instead of the native `disabled`, so a focused button keeps focus.
- **Grouped expandable table:** `DataTable` gains optional `groups` (rowgroup header renderer), `renderExpanded(row)` and a row-header column flag; existing props, sort and classes stay unchanged. Sorting applies within groups.
- **Final marker:** `StatusBadge tone="success"` "Final" with `IconCheck` and `success-light` tint; `is-selected` stays reserved for selection state.
- **Forced colors** (new `@media (forced-colors: active)` rules; none exist today): the Final row gets a `CanvasText` left border, badges keep outline and icon, focus ring and active segment use `Highlight`.
- **Motion:** expansion and chevron rotation 150 ms; instant under `prefers-reduced-motion`.

## Backend and API changes

All additions are read-only and lead-only unless stated. Access rules are unchanged; report text stays visible only to reporter and leads.

**One projection.** Documents and the export preflight share one cause derivation. `FinalResultService._projection` is refactored to run on the caller's connection, including `Repository.list_workflow_causes` (today it opens its own transaction), so it can run under the shared project advisory lock for Documents; preflight and freeze keep their exclusive lock. A contract test asserts per-row equality of cause ids between both paths.

**Cause changes:**

| Cause | Change |
|---|---|
| `SELECTED_ROUND_SUPERSEDED`, `SELECTED_ROUND_ABANDONED` | Cause id becomes `{code}:{round_id}` (today `{code}:{round_id}:{workflow_revision}`), so holds, resumes and reopens no longer raise it again. A migration rewrites stored `acknowledged_cause_ids` of the old form. |
| `SELECTED_NEWER_RESULT` (new) | Raised per submission on any version of the row with `recorded_at` after the selection's `selected_at`, that is not the final result and not already named by `SELECTED_RESULT_REVISED`. Id `SELECTED_NEWER_RESULT:{submission_id}`. Acknowledgeable. |
| `SELECTED_TEXT_CORRECTED` | Id becomes `SELECTED_TEXT_CORRECTED:{selected document}:{correction}:{translation_status}`, so acceptance raises it again. Not raised for corrections whose latest review is rejected or queried. Native corrections (status null) raise it once. |
| `TASK_PAUSED_WITHOUT_REPORT` (new, derived) | Active hold whose report is not open; id `TASK_PAUSED_WITHOUT_REPORT:{hold_id}`. Not acknowledgeable; resolved by resuming. |
| `ROUND_REVIEW_PENDING` | Unchanged: open translation_review assignments and editable carry-forward or consolidation rounds on a chain with a selection (not ordinary rounds); its revision follows draft edits. |

`final_selections` gains `selected_at`, set when the selected submission changes and kept on reaffirmation (`updated_at` changes on every write). The reaffirmation endpoint accepts the five acknowledgeable codes.

**Endpoints:**

| Addition | Purpose |
|---|---|
| `GET /projects/{key}/document-rows?…filters,page`: one entry per row with versions (chain, chain name, status, latest review decision, filter match), `last_activity_at` per row and version, work summary, final selection summary, issues and notes (each with `code`, `cause_id`, `cause_revision`, `document_id`), the missing-final result, and project-wide bar counts | Table, bar and filters without N+1 requests |
| `GET /projects/{key}/document-rows/{case}/{language}/submissions`: submissions of all versions with `submission_id`, `document_id`, `version`, `author_label`, `recorded_at`, `mode`, `kind`, `round_id`, `round_ordinal`, `is_latest_in_round`, `finding_count` | Submissions table |
| Same endpoint: rounds with `round_id`, `assignment_id`, `predecessor_round_id`, `document_id`, `version`, `kind`, `mode`, `state`, `author_label`, `round_ordinal`; open translation reviews with version and reviewer label | Round cells, waiting lines, cause wording |
| `FinalSelectionView` summary: submission label fields, `revision`, `selected_at`, `updated_at`, `selected_by` | Final column, confirmations, conflict message |
| `OPEN_PROBLEM_REPORT` issue: `report_id`, description excerpt, reporter label, `created_at`, hold state; `TASK_ON_HOLD` notes carry the causing `report_id` | Issue lines |
| `VersionRef` gains `kind: "submission"` for leads | View and Compare |

`contracts/openapi.json` and `frontend/src/api/generated.ts` are regenerated.

## Contracts preserved

- A final result is only ever set, replaced or reaffirmed by an explicit lead action with a confirmation that names the exact submission (label never truncated).
- Nothing selects or replaces a result automatically: not the newest submission, not a newer text version, not a consolidation.
- Selections stay exact and immutable per row; previous selections remain in the history.
- Reaffirmation only acknowledges the five acknowledgeable codes; `ROUND_REVIEW_PENDING` and `TASK_PAUSED_WITHOUT_REPORT` cannot be acknowledged.
- Resolving a report and releasing its pauses stay separate actions.
- No automatic clinical confirmation. Defaulted values stay defaulted.
- Status is never conveyed by colour alone. Technical IDs remain available under details.

## Edge cases

- A row with only an unsubmitted round: Submissions shows the muted line and no actions.
- Early selection (work still open) is allowed and says what is still open.
- Parallel roots: versions and the Final column use "{chain name} v{n}"; Compare only within one text version; bulk via Text versions.
- Lead as annotator: "(you)" on own items; an own open task blocks the missing-final rule; "Open my task" next to "Open".

## Testing

- **Unit:** chain and newest version, chain names and duplicates, parallel roots, `q` matching with NFKC; missing-final rule (revoked, paused, mixed task types, versions, no assignments); bar counts (distinct rows, project-wide, notes excluded, category merge); `round_ordinal`; submission kinds and labels; last-activity sources; cause derivation for `SELECTED_NEWER_RESULT`, `SELECTED_TEXT_CORRECTED` by status, `TASK_PAUSED_WITHOUT_REPORT`, stable `SELECTED_ROUND_*` ids across hold, resume and reopen, and the acknowledged-id migration.
- **Component:** `InlineConfirm` (focus to heading, one per page with announcement, Escape with focus on the checkbox, Escape outside ignored, busy keeps focus via `aria-disabled`, conflict read-only state, 401 and network outcomes), Button `loading`, extended `DataTable` groups and expansion, router round-trip of all new parameters including repeated `open`.
- **Contract:** no selection change without explicit confirmation; revision or warning conflict leaves the selection unchanged; `ROUND_REVIEW_PENDING` and `TASK_PAUSED_WITHOUT_REPORT` cannot be acknowledged; Documents does not take the exclusive lock; Documents and preflight cause ids are equal per row.
- **Browser (Playwright),** data shapes S0 to S8 from `documents-scenarios.html` plus:
  - S9 parallel roots with equal provider names; S10 rejected and queried translation reviews, accepted_corrected; S11 multi-submission round and a submission after selection (`SELECTED_NEWER_RESULT`); S12 resolved report with kept hold, and `extend_hold` on another row; S13 consolidation and carry-forward rounds; S14 open translation review with a final result (waiting line) and early selection; S15 lead's own result with `adjudicator_not_annotator` on, more than 50 texts.
  - Decision flows: first selection, replace, keep (unchecked activation, checked), correction accepted after keep raises it again, round superseded stays acknowledged after a hold, next-decision link, Resolved vs Changed badges, conflict with "Review again", 401 during confirm.
  - Keyboard and screen reader: Tab-only order, accessible names of disclosures, Open, View and group headers, `h2` and `aria-current` in the bar, live announcements (filter count, previous confirmation closed, Saving…, outcomes), focus targets after each outcome.
  - Deep links: `case`, `language`, `decision`, `final`, `open`, `page`; unknown case; row kept visible with "This no longer needs your decision."; back from report page and case viewer restores the query.
  - Layout: 320 CSS px reflow and 390px cards with 24×24 px targets; forced-colors emulation (Final border, badges, focus, active segment); reduced motion.

## Out of scope

The editor's carried-finding review, the lead actions on the problem report page, report history and withdrawal, the export readme, and the quick fixes (project picker, dialog footers, export cancel, time-zone display in the old selector, focus ring). Each gets its own spec or fix batch.
