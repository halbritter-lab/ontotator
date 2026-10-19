# Problem reports: reporter and lead flows: design

Status: design proposal, 2026-10-19; not reviewed, not implemented.
Source findings: F38, F39, the remainder of F43 and F45 in the [walkthrough UX analysis](../reviews/2026-10-19-candidate-walkthrough-ux-analysis.md) (cluster 2) and the [analysis handoff](../reviews/2026-10-19-candidate-walkthrough-analysis-handoff.md). Contracts: [acceptance workflow contracts](2026-10-18-acceptance-workflow-contracts.md). Sibling spec: [Documents as the lead's table](2026-10-19-documents-lead-table-design.md); this spec reuses its shared rules and does not repeat them. Mockups: `.superpowers/mockups/problem-reports/` (`a-reporter-dialog.html`, `b-new-report-form.html`, `c-history-timeline.html`, `d-lead-report-page.html`, `e-lead-restart-and-narrow.html`). Where a mockup and this spec differ, this spec wins.

## Goal

A person who hits a problem in a task can report it in one step, sees at any time what became of the report and of their task, and can continue when the problem turns out to be none. A project lead who opens a report sees what is true now (is the report open, which tasks are paused, by whom were they resumed) and chooses an intent whose consequences are stated before and after the action. Nothing is decided, released or replaced silently.

## Current behaviour (verified in code and live)

- The editor toolbar has two buttons, "Report a problem" and "My problem reports", that open the same dialog "Task problem reports" (`tasks/TaskProblemActions.tsx:38-39`). The list loads only after "My problem reports" or "Reload my reports". Close sits in the scrolling body.
- The form has two explanatory paragraphs, a textarea without `rows` (58 px live) and the action "Report and pause my task" as a secondary button (`tasks/ProblemReportForm.tsx`).
- Each report renders as "My report · {state}" plus the full text. Report state and task pause are not shown as separate facts. Reports of the task are not distinguishable except by text.
- History renders `String(event.action)` and the reason only (`tasks/ReportHistory.tsx:8`); the delivered `created_at` is ignored. `ProblemReportView` (`application/problem_reports.py:40-55`) has no creation time, no reporter label and no event actor; creation is not an event (the audit record exists, `problem_report_events` gets no row).
- The lead page (`tasks/ProblemReportDetail.tsx`) loads all project reports and assignments, offers four actions in one `<select>` with one "Apply report action", lists paused tasks as bare IDs ("Paused tasks: None") and links back to Documents without its query.
- Backend semantics, which this design keeps:
  - `report`: the task owner creates an immutable report and, atomically, a personal hold on the task whose reason is the report text. Allowed for editable and submitted tasks.
  - `resume`: releases this report's holds on the given tasks. The owner can resume only their own task's hold from their own report; a lead can release any of the report's holds. The report state does not change. Allowed on resolved reports.
  - `resolve`: records the outcome (`resolution`) and sets the report to resolved. Holds stay.
  - `extend_hold`: a lead adds a hold from this report to explicit same-project tasks with a separately authored reason; the task owner sees only that reason.
  - `restart`: lead only, only on the reporter's task. Releases this report's hold on that task, creates a clean round (annotation) or archives and resets the translation draft (translation review), and resolves the report. If another hold remains, the round guard raises `TASK_HELD` and the whole transition rolls back.
  - Only the reporter and project leads can read reports. On a resolved report only `resume` is accepted.

## Shared rules

The Documents spec's rules apply unchanged: person label (pseudonym, "(you)"), local times with `<time datetime title>`, icons from `ui/icons.tsx` (no glyphs), status never by colour alone (`StatusBadge` with text and shape), unavailable actions use `aria-disabled` plus a visible reason, `InlineConfirm` and its behaviour, Button `loading` without native `disabled`. Additions:

- **Task label:** "Task {assignment id} · {owner label} · {text ID} · {language}", e.g. "Task 4 · ann-0004 · accepted-translation · de". The task type follows only where it matters ("Translation review"). In running text: "Task 4 (ann-0004)".
- **Report title:** the first line of the report text, cut at 80 characters at a word boundary with an ellipsis. The full text is always one disclosure away and is never cut in confirmations.
- **Report state vocabulary:** "Open" (`StatusBadge tone="info"`, ring) and "Closed" (`tone="success"`, check). The UI says "close" for the API's `resolve` because the user hears "resolve" as "the problem is solved"; the API keeps `resolve`. "Closed by ann-0002 · 19 Oct, 01:31" carries the actor and time.
- **Pause vocabulary:** "Paused" (`tone="warning"`, warning shape), "Resumed" (`tone="neutral"`, dot), "Restarted" (`tone="neutral"`, dot). Never "hold" in the UI; the API keeps `hold`.
- **Two facts, never merged:** wherever a report is shown, its state and the pause state of tasks are separate labelled facts ("Report: Open", "Your task: Resumed").
- **Report text** renders with preserved line breaks (`white-space: pre-wrap`), in the reading serif at body size, as quoted user content (`<blockquote>`), without a `lang` attribute (the language is not known).

## Reporter flow (editor)

Applies to the annotation editor and the translation review screen, which both mount `TaskProblemActions`.

### Toolbar entry

One `Button size="sm"` replaces the two buttons. Visible text and states:

| State | Visible content | Accessible name |
|---|---|---|
| No report of mine on this task, task not paused | "Report problem" | "Report problem Report a problem with this task" (suffix visually hidden) |
| n of my reports on this task open | "Report problem" + count badge "1 open" | "Report problem 1 open report" |
| Task paused (any cause) | "Report problem" + `IconWarning` + "Paused" (+ "· 1 open") | "Report problem Task paused, 1 open report" |

- The visible text is always part of the accessible name (WCAG 2.5.3). The badge is text plus shape, not a coloured dot.
- The count is loaded with the editor (`GET …/problem-reports?assignment_id=`) and refreshed after each own action and on window focus. A failed count load shows "Report problem" without a badge; the dialog then reports the error.
- "Paused" comes from `assignment.held` (any active hold, including a lead's pause from another person's report). The existing editor banner "Task paused: {reason}" stays the primary signal; the badge mirrors it in the toolbar.
- No new keyboard shortcut (the editor's keys are crowded and the action is rare).

### Dialog

`Dialog` titled "Problems with Task 4", `size="md"`, actions in the `footer` prop (fixed footer, F35 fix). The body has three parts in this order.

**1. Task status** (one line, always): "Your task: Paused" or "Your task: Active", followed by the pause causes the owner may know:

- Pause from an own report: "Paused by your report "{report title}"."
- Pause by a lead (hold from another person's report or a lead `extend_hold`): "Paused by a project lead: {hold reason}. Only a project lead can release this pause." The other report is never named.
- Submitted task: "Your submitted result stays unchanged and readable."

**2. Your reports (n)**, newest first. Each report is an `<article aria-labelledby>`:

- Heading (`<h3>`): report title.
- Meta: "Reported {time}".
- Facts (`<dl>`), two rows:
  - "Report": "Open" or "Closed by ann-0002 · {time}". When closed, the outcome follows: "Outcome: {resolution}".
  - "Your task": state of this report's pause on the reporter's task: "Paused since {time}", "Resumed by you · {time}", "Resumed by ann-0002 · {time}", "Restarted with an empty Round 3 · {time}", "Paused again by ann-0002 · {time}" (a lead re-paused the task from this report).
- When this report's pause on the task is active: secondary "Resume my task…" (see below).
- Disclosure "Full report and history ({k} events)": full text, then the history timeline (see "History").

When the reporter has no report on this task, the dialog opens directly in the "New report" view.

Below the list, one quiet line, stating only what exists today: "Reported by mistake? Resume your task with a reason and ask a project lead to close the report." (Withdrawal does not exist; see "Open questions".)

**3. Footer:** secondary "New report", quiet "Close". No "Reload": the list loads when the dialog opens, after every own action and on window focus. Responses older than the latest request are discarded.

**Initial focus:** list view: the first report heading (`tabindex="-1"`) when a report's pause is active, otherwise "New report". New report view: the textarea.

### New report

Same dialog, view switched (the dialog heading becomes "New problem report"; focus moves to the textarea).

- `Textarea` label "What is the problem?", `rows={6}`, resizable vertically, required. Hint (`field-hint`): "Only you and project leads can read this."
- One consequence sentence above the footer, varying with the task:
  - Editable task: "Reporting pauses this task: you cannot save or submit until the pause is released. Your saved work stays."
  - Submitted task: "Reporting pauses this task. Your submitted result stays unchanged and readable."
- Footer: primary "Report and pause my task", quiet "Cancel". Cancel returns to the list (or closes the dialog when there is no report) without a confirmation when the textarea is empty; with text, Cancel and Escape ask inline "Discard this report? Your text will be lost." ("Discard", "Keep writing").
- Empty submit: the button stays enabled; activation shows the field error "Describe the problem." and focuses the textarea.
- Save before report (existing): the editor saves first. If saving fails, nothing is reported and the form shows `InlineMessage tone="error"` "Your latest changes could not be saved. Nothing was reported." with the checkbox "Report anyway. My unsaved changes stay only in this open editor until I resume and save." Activation requires the checkbox (`aria-disabled` with that reason otherwise).
- Success: the view returns to the list, the new report is first, `InlineMessage tone="success"` "Reported. Your task is paused until you or a project lead resume it." Focus moves to the new report's heading; the live region announces the message. The toolbar shows "Paused · 1 open".

### Resume my task

Exists today; the design separates it visually and verbally from the report state.

- "Resume my task…" (secondary) opens an `InlineConfirm` inside the report article: title "Resume Task 4", `Textarea` "Why can you continue?" (`rows={3}`, required; hint "Recorded in the report history. Project leads see it."), consequence lines and primary "Resume my task", quiet "Cancel".
- Consequence lines, computed from data at open:
  - Always: "The report stays open. A project lead decides on it." (or, if closed: "The report is already closed. Only the pause is released.")
  - When other pauses remain: "Your task stays paused by a project lead: {hold reason}."
- Success: "Your task: Resumed by you · {time}" updates in place; message "Resumed. The report stays open." or "Resumed. Your task is still paused by a project lead." Focus to the report heading.

## History

One component renders the timeline for reporter and lead, with view-dependent redaction.

- `<ol>` in chronological order (oldest first), each item a `<li>` with: actor label, a plain-language sentence, `<time>`, and the reason as a quoted block when the action has one.
- **Creation** is the first item, rendered from the report row (`created_at`, reporter), not from an event: "ann-0004 reported the problem. Task 4 paused." The report text itself is not repeated in the timeline.
- Sentences per action:

| Action | Lead view | Reporter view |
|---|---|---|
| creation | "ann-0004 reported the problem. Task 4 paused." | "You reported the problem. Your task paused." |
| `resume` | "ann-0004 resumed Task 4 (ann-0004)." / "ann-0002 released the pause on Task 7 (ann-0005)." Reason: "upsi" | "You resumed your task." / "ann-0002 released the pause on your task." / "ann-0002 released a pause on 1 other task." |
| `resolve` | "ann-0002 closed the report." Outcome: "…" | same, "Outcome" shown |
| `extend_hold` | "ann-0002 paused Task 7 (ann-0005) and Task 9 (ann-0006). Reason shown to their owners:" "…" | "ann-0002 paused your task again." when the own task is affected; otherwise the event is not shown to the reporter (no counts, labels or reasons) |
| `restart` | "ann-0002 agreed an empty restart of Task 4. Round 2 abandoned and kept; Round 3 started empty. Report closed." | "ann-0002 restarted your task with an empty Round 3. Round 2 is kept. Report closed." |
| unknown action | "{actor} recorded "{action}"." | same |

- A translation-review restart keeps the disclosure "Translation draft kept from before the restart" with the archived text and form (existing behaviour, now labelled).
- **Never synthesize:** no item is shown without a stored source (report row or event). If a release has no matching event, the hold shows "Released (no record of who released it)" in the state panel; the timeline shows nothing for it. Events have a non-null actor, so actor labels always exist.
- **Redaction for non-leads:** the reporter never sees other people's task IDs, labels, texts or hold reasons. Independent annotation must not reveal who else works on a text. The API enforces this (see "API changes").

## Lead flow

### Entry points

- **Documents** (sibling spec): the bar category "Problem report or paused task", the row's issue lines (excerpt, reporter, time, task state, "Open report") and the orphaned-pause line with "Resume task". These links carry the `documents_*` query.
- **Closed reports stay findable** (F43 remainder: the resolved report was absent everywhere). The expanded row's "More" section gains "Problem reports (n)": every report of the row, open and closed, newest first, one line each: report title · reporter · time · "Report: Open/Closed" · "Paused tasks: n" · "Open report". This is an addition to the sibling spec's "More" section.
- Direct URL `#/projects/{key}/problem-reports/{report_id}`.

### Page structure

`AppShell density="compact"`, breadcrumb "{project} › Documents › Problem report".

1. **Back link** (top, before the heading): `IconChevronLeft` "Back to Documents". It restores the full `documents_*` query; when entered directly, Documents with `case` and `language` of the report (sibling spec).
2. **Heading** `<h1>` "Problem report" and an identity line: "accepted-translation · de · Task 4 (ann-0004) · Annotation · Round 2". Link "View text" opens the case viewer read-only at the reported document version (and submission, when the report names one).
3. **Report:** `<blockquote>` with the full text, meta "Reported by ann-0004 · 19 Oct, 01:12". When the report names a submission: "About the submitted result Round 2 · 19 Oct, 00:57".
4. **Current state** (`<section aria-labelledby>`, `<h2>`), a `<dl>`:
   - **Report:** "Open" or "Closed by ann-0002 · {time}" plus "Outcome: …".
   - **Paused tasks:** one line per hold this report ever created, active first:
     - Active: "Task 4 · ann-0004 · accepted-translation · de" + "Paused" badge + "since 19 Oct, 01:12".
     - Released: same task label + "Resumed" badge + "by reporter (ann-0004) · 19 Oct, 01:13 · "upsi"" or "by ann-0002 · …", or "Restarted" badge + "Round 3 started empty".
     - When the task has other active pauses: "Also paused by another report" with "Open report" link. These are never released from this page.
     - No holds at all is impossible (creation always pauses); after all releases the line reads "None paused now" above the released lines.
   - **Final result** of the report's text and language: the sibling submission label or "None", with "Actions on this page never change it."
   - **Summary sentence** under the list, computed: "Nothing is paused by this report. The report is open until you close it." / "1 task is paused by this report. The report is closed; release the pause when work can continue." / "Nothing left to decide."
5. **Decide** (`<section>`, `<h2>` "Decide", `Toolbar label="Decide on this report"`): intent buttons, each with its consequence as a visible line below it, linked by `aria-describedby`. Each opens an `InlineConfirm` directly below its own intent (`aria-expanded`, `aria-controls`); one at a time per the sibling rule.
6. **History** (`<h2>`), the timeline in lead view.
7. **Technical details** (collapsed): report, round, submission, hold and event IDs, unabbreviated.

### Intent actions

Availability by state; unavailable actions stay focusable with `aria-disabled` and the stated reason.

| Intent | Label | Consequence line | Available when | API |
|---|---|---|---|---|
| Close | "Close report (pauses stay)" when this report pauses a task, otherwise "Close report" | "Records your outcome for ann-0004. Task 4 stays paused until you release it." / "Records your outcome for ann-0004. No task is paused by this report." | Report open | `resolve` |
| Release | "Release pause…" | "Lets the selected tasks continue. The report stays open. Pauses from other reports stay." (closed report: "The report stays closed.") | Any active hold of this report; otherwise reason "No task is paused by this report." | `resume` |
| Pause | "Pause other tasks…" | "Stops work on related tasks. Their owners see only your reason, not this report." | Report open; otherwise reason "The report is closed." | `extend_hold` |
| Restart | "Agree empty restart…" | "Starts Task 4 again with an empty round and closes this report. Earlier rounds stay in the history. The final result does not change." | Report open and the reporter's task has no active pause from another report; otherwise reason "Task 4 is also paused by another report. Release that pause first." | `restart` |

Button weight: none is primary on the page (no single expected decision); the primary action is the confirm button inside the open `InlineConfirm`. Restart's confirm uses `tone="danger"` because it abandons the active round.

**Confirmations** (all `InlineConfirm`; reasons are required, field error "Enter a reason." on empty activation):

- **Close report:** title "Close report". `Textarea` "Outcome for ann-0004" (`rows={4}`; hint "ann-0004 sees this in the report."). Lines: "Task 4 stays paused. Release it separately with Release pause." when a pause is active, or "No task is paused by this report." Primary "Close report".
- **Release pause:** title "Release pause". Checkbox list of this report's active holds (task label, "paused since …", "Also paused by another report: stays paused" when applicable); preselected when exactly one. `Textarea` "Reason" (`rows={3}`; hint "Recorded in the history. The reporter sees it."). Primary "Release pause" / "Release 2 pauses". Activation with nothing selected: "Choose at least one task."
- **Pause other tasks:** title "Pause other tasks". Task picker: group "Same text: accepted-translation" (all languages, non-revoked tasks), then "Other tasks in this project" behind a search field (text ID or person label). Tasks already paused by this report are listed as unavailable ("Already paused by this report"). The reporter's own task appears when its pause was released, labelled "(reporter's task)". `Textarea` "Reason shown to the task owners" (`rows={3}`; hint "They do not see this report."). Primary "Pause 1 task" / "Pause n tasks".
- **Agree empty restart:** title "Agree empty restart of Task 4". Facts: "Round 2 of Task 4 (ann-0004) is abandoned and kept in the history." "Round 3 starts empty: no earlier or machine findings." (translation review: "The current translation draft is kept in the report history; the text and form start fresh.") "This report closes; its pause on Task 4 is released." "Final result stays: {label | None}." Checkbox "I agreed this restart with ann-0004" (required). `Textarea` "Reason (becomes the outcome ann-0004 sees)". Primary (danger) "Restart with empty round".

**Outcome messages** (`InlineMessage tone="success"`, focus to the message, announced politely). Each names what changed and what did not, computed from the response compared with the state at open:

- Close: "Report closed. Task 4 is still paused by this report; release it when work can continue." / "Report closed. No task was paused by it. The final result did not change."
- Release: "Released the pause on Task 4 (ann-0004). The report is still open." plus "Task 7 is still paused by another report." when applicable.
- Pause: "Paused Task 7 (ann-0005) and Task 9 (ann-0006). Their owners see your reason. The report is still open."
- Restart: "Task 4 restarted with an empty Round 3. Round 2 is kept in the history. Report closed. The final result did not change."
- Each message ends with the link "Back to Documents".

### Errors

| Case | Message and recovery |
|---|---|
| `WORKFLOW_REVISION_CONFLICT` (incl. `REPORT_RESOLVED`) | Confirm stays open read-only: "This report changed since you opened it. Nothing was saved." plus the newest history sentence ("ann-0004 resumed Task 4 at 01:13."). Buttons "Review again" (reloads, keeps the typed reason) and "Close". |
| `TASK_HELD` on restart | "Task 4 is also paused by another report. Nothing changed. Release that pause first." with "Open report" to the other report. |
| `ASSIGNMENT_NOT_FOUND` | "Task 7 is no longer available (revoked or moved). Nothing changed." The picker reloads. |
| `HOLD_TARGET_REQUIRED`, `REPORT_REASON_REQUIRED` | Prevented client-side; the server message maps to the same field errors. |
| `RESTART_AGREEMENT_REQUIRED` | Prevented by the checkbox; mapped to "Confirm that you agreed the restart with ann-0004." |
| Network, 500 | "Could not save. Nothing changed." with "Retry". Retry reuses the same `request_id`, so a request that did commit is replayed from its receipt, never applied twice. |
| 401 | Per sibling spec: confirm kept, "Your session ended. Nothing was saved. Sign in and confirm again." |
| Load fails | Error with "Retry" in place of the page body; the back link stays. |
| Report not found or not readable | `EmptyState` "Problem report not found" with "Back to Documents". Non-leads get the same answer (no existence leak), with "My tasks" as the action. |

Reporter-side errors use the same patterns inside the dialog: create conflict (`WORKFLOW_REVISION_CONFLICT`, `ROUND_KEY_MISMATCH`, `REPORT_SUBMISSION_INVALID`): "Your task changed in another window or by a project lead. Nothing was reported. Your text is kept." with "Try again" after reloading the task; `AMBIGUOUS_REVIEW_ROUND`: "This task's current round is unclear. Nothing was reported. Ask a project lead."; resume conflict: "A project lead changed this report. Nothing was saved." with the updated facts shown.

## State model

Report state and pause state are independent dimensions. Per hold: active or released (with release event). Per report: open or closed.

| From | Event | To | Shown as |
|---|---|---|---|
| (none) | Reporter reports | Report open; reporter task paused | Reporter: "Report: Open · Your task: Paused". Documents: problem report issue. |
| Open, reporter task paused | Reporter or lead resumes | Open; task resumed | "Report: Open · Your task: Resumed by …". Documents: issue stays (open report). |
| Open, any | Lead pauses other tasks | Open; more holds | Lead: extra lines in Paused tasks. Affected owners: banner with the lead's reason. |
| Open, paused | Lead closes | Closed; pause stays | "Report: Closed · Your task: Paused". Documents: orphaned pause (D3), "Resume task". |
| Open, resumed | Lead closes | Closed; nothing paused | Terminal. Documents: no issue; listed under "Problem reports (n)". |
| Closed, paused | Reporter or lead releases | Closed; resumed | Terminal. |
| Open, reporter task paused only by this report (or already resumed) | Lead restarts | Closed; this report's pause on the reporter task released; new empty round | "Restarted with an empty Round 3". Other holds of this report on other tasks stay. |
| Open, reporter task also paused by another report | Lead restarts | Rejected atomically (`TASK_HELD`); nothing changes | Error above. |
| Closed | Any action other than release | Rejected (`REPORT_RESOLVED`) | Actions unavailable in the UI. |

Two holds on one task need two releases; a task is writable only when no active hold remains.

## Keyboard and screen reader

- Toolbar entry, dialog and lead page are fully operable with Tab, Shift+Tab, Enter, Space and Escape. Dialog: Escape closes the dialog unless a write is busy or an inline confirm with text is open (then it asks first). `InlineConfirm`: Escape and Cancel return focus to the trigger.
- Structure: dialog heading `<h2>`, reports `<article aria-labelledby>` with `<h3>`, facts `<dl>`, history `<ol>` with `<time datetime title>`. Lead page: one `<h1>`, sections with `<h2>`.
- Badges are text; shapes are decorative (`aria-hidden`). The "Paused" toolbar state is in the accessible name.
- One polite live region per surface for success and status; errors render inside their form as `role="alert"` (`InlineMessage tone="error"`).
- Focus after each outcome: new report → its heading; resume → report heading; lead outcomes → the success message; conflict → the conflict message.
- Targets at least 24×24 px.

## Narrow viewports

- **Editor (< 700 px):** the toolbar wraps; "Report problem" keeps its text and badge (never icon-only). The dialog becomes a full-height sheet (Dialog `size="md"` at < 700 px fills the viewport width with `space-4` margins); the footer stays fixed; facts stack (term above value); history items wrap with the time on its own line.
- **Lead page (< 700 px):** single column; the Decide toolbar stacks its buttons full width, each followed by its consequence line; `InlineConfirm` is a block directly below its intent; task labels wrap between parts, never inside "Task 4". Reflow verified at 320 CSS px without horizontal scrolling.
- Long IDs only appear under "Technical details" (middle ellipsis elsewhere).

## API changes

All additive; access rules unchanged (reporter and leads only). `contracts/openapi.json` and `frontend/src/api/generated.ts` are regenerated.

| Change | Purpose |
|---|---|
| `ProblemReportView.created_at`, `reporter_label` | Report time and creation entry in the history (from the report row; no event is backfilled). |
| `ProblemReportView.case_id`, `language`, `task`, `round_ordinal`, `submission_label` (nullable) | Identity line without extra requests. |
| `ProblemReportView.events[]`: `event_id`, `action`, `actor_label`, `created_at`, `reason`, `round_id`, `round_ordinal`, `abandoned_translation_draft`, and `affected` | Timeline. `affected` for leads: `[{assignment_id, owner_label, case_id, language, task}]`; for the reporter: `{own_task: bool}` only (events affecting only other tasks are omitted). Raw `details.assignment_ids` are no longer returned to non-leads. |
| `ProblemReportView.holds[]`: `hold_id`, `assignment_id`, `owner_label`, `case_id`, `language`, `task`, `created_at`, `created_by_label`, `active`, `released_at`, `released_by_label`, `release_action` (`resume`/`restart`), `release_event_id`, `other_active_holds` (`[{report_id}]`, leads only) | State panel, reporter "Your task" fact, restart pre-check. Leads get all holds; the reporter gets only holds on their own task. Release fields are derived server-side: the first `resume` or `restart` event of this report after the hold's `created_at` whose `assignment_ids` include the hold's task; no match gives nulls ("no record"). `held_assignment_ids` stays for compatibility. |
| `GET /problem-reports/{report_id}` | Single report for the lead page and after actions (today the page lists all project reports). Unreadable and unknown reports both return `REPORT_NOT_FOUND`. |
| `GET /projects/{key}/problem-reports?assignment_id=` | Toolbar count and dialog list for one task. |
| `AssignmentView.active_holds[]` for the task owner: `reason`, `created_at`, `own_report_id` (null when the hold comes from another person's report or a lead's pause) | Task status line in the dialog and "other pauses remain" in the resume confirm, without revealing other reports. |
| Documents (sibling) `OPEN_PROBLEM_REPORT` issue fields, plus per row `problem_reports[]` (`report_id`, title, `reporter_label`, `created_at`, `state`, `active_hold_count`) | Issue lines and the new "Problem reports (n)" list including closed reports. |
| Report route `documents_*` passthrough (sibling) | Back link restores the Documents query. |

No new error codes. No schema migration is required: everything is derived from existing rows.

## Contracts preserved

- Closing a report and releasing its pauses stay separate actions; the UI never combines them.
- Other holds are never lifted silently: release lists exactly the holds of this report; restart fails atomically when another hold remains; the UI states which pauses remain.
- Restart keeps the abandoned round, its submissions and (for translation review) the archived draft; it never changes the final selection, and both confirm and outcome say so.
- Reports, their text and history are visible only to the reporter and project leads; affected task owners see only the lead's hold reason; the reporter does not learn other assignees' identities.
- Every action needs a reason and is recorded with actor and time; nothing is synthesized in the history.
- Withdrawal of one's own report does not exist and is not presented as existing.

## Testing

- **Unit:** report title cutting; vocabulary mapping (resolve → Closed); "Your task" fact derivation for each release path (resumed by self, by lead, restart, re-paused); release-event derivation incl. no-match; redaction of `affected` for non-leads; outcome-message diff (changed vs unchanged, other pauses remaining).
- **Component:** toolbar states and accessible names; dialog opens in form view without reports; auto-load without Reload, stale response discarded; form `rows=6`, empty submit error, save-failure checkbox gate, Cancel with text asks; resume confirm with and without other pauses; lead intents availability and `aria-disabled` reasons per state; one `InlineConfirm` at a time; conflict read-only state keeps the typed reason.
- **API/contract:** new fields; single-report endpoint returns `REPORT_NOT_FOUND` for an unrelated annotator; reporter view never contains other assignees' IDs or labels; `assignment_id` filter.
- **Browser (Playwright):** report → paused → resume with "upsi" → lead sees "resumed by reporter" → close → reporter sees "Closed" and "Resumed by you"; close while paused → Documents orphaned pause → release; pause other tasks → affected owner sees only the reason; restart rejected while another report pauses the task, then succeeds after release, final result unchanged; back link restores the Documents query; 320 px reflow and 390 px sheet; keyboard-only path through all intents; screen reader names of toolbar entry and badges.

## Resolved questions (user decisions 2026-10-19)

1. **Withdrawal (option B, restricted).** The reporter can withdraw their own report with a required reason while it is open and no lead has acted on it yet. The report gets the auditable state "Withdrawn" (distinct from Closed); only this report's pause on the reporter's own task is released. After any lead action, withdrawal is no longer offered; the reporter resumes with a reason and asks the lead to close.
2. **Reopening.** A lead can reopen a Closed or Withdrawn report with a required reason (new action `reopen`, recorded as an event). Reopening does not re-pause anything.
3. **Close while paused.** No extra confirmation step: the button reads "Close report (pauses stay)" while a pause from the report is active, and the remaining pause surfaces in Documents as "Problem report or paused task" (orphaned pause, D3 of the Documents spec). No combined "close and release".
4. **Reporter visibility of lead pauses on other tasks.** The reporter sees nothing about other tasks, not even a count, to keep independent annotation blind. (Default chosen by the assistant; open to change.)
5. **Pause scope.** The picker offers the report's text (all languages) by default; other texts of the project only via search.
6. **Toolbar label** is "Report problem" (with badges "1 open" / "Paused"), not "Problem?".
