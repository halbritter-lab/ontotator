# Candidate walkthrough UX analysis (F34–F48)

Analysis of the findings collected in the [walkthrough handoff](2026-10-19-candidate-walkthrough-analysis-handoff.md). Method: impeccable `critique`, run as an isolated source and design review plus a detector and browser pass, followed by a read-only live check on the candidate (http://127.0.0.1:18190, project `t5-acceptance`) with `demo-lead`, `demo-annotator` and `demo-reviewer`. No data was changed. Nothing was implemented. Nothing was committed. Screenshots are in `docs/superpowers/reviews/evidence/2026-10-19-candidate-walkthrough/`. The impeccable snapshot is in `.impeccable/critique/2026-10-19T07-50-44Z__frontend-src.md`.

User observations come from the handoff. The cause column is this analysis's diagnosis, confirmed in source and, where marked, in the live app.

## Score

Nielsen heuristics: **20/40** (Acceptable, lower bound). The earlier UX review scored 25/40, but these governance flows were not exercised then.

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | System status | 2 | Report state and task pause shown as one block; resolved reports vanish; no selected marker in submission history |
| 2 | Real-world match | 1 | carry-forward, superseded, independent, round UUIDs, `units_added`, `selected.t1.zip` |
| 3 | Control and freedom | 2 | Export preflight cannot be cancelled; project picker cannot be dismissed; Close sits at the end of a scrolling dialog |
| 4 | Consistency | 2 | Two "Project" controls with different scopes; back links lead to Documents |
| 5 | Error prevention | 3 | Explicit-decision contracts are strong; "Create final export" is not the primary action |
| 6 | Recognition over recall | 1 | Submissions, reports, tasks and rounds are told apart only by IDs |
| 7 | Flexibility | 2 | No "next unchecked" shortcut, fixed column widths, no report inbox |
| 8 | Minimalism | 2 | Policy paragraph before every control; four actions per carried row |
| 9 | Error recovery | 3 | Save and conflict recovery are solid; reloading is manual |
| 10 | Help | 2 | Policy copy instead of task copy; export has no readme |

Design specificity: the reading surface (paper tones, line-style marks, colour never alone) is product-specific. The workflow and admin layer is generic: stacks of explanatory paragraphs, raw IDs and equally weighted secondary buttons.

Detector: the static scan is clean (0 findings in 96 files). The browser overlay only reached the login page (`cream-palette`, the intended surface token, so a false positive). Static accessibility check: `.resize-handle:focus-visible` uses `--accent-light` as its ring, which gives 1.1:1 contrast, so focus is invisible (`frontend/src/styles/screens/editor.css` ~628). Form-control focus is borderline (`components.css` ~125).

## Findings

| ID | Live | Cause |
|---|---|---|
| F34 | confirmed | `tasks/RoundInputPanel.tsx:77` renders a second list next to "Saved findings" (`app/CaseScreen.tsx:2174` vs `:2306`). The mapping select appears even when `mapping_status === "carried"` already defines the target. Each row has four actions; "Inspect original evidence" is `variant="quiet"`, the borderless one. The submit dialog's review button focuses the select (`CaseScreen.tsx:2709`). Live: the select is truncated in the 260px column ("Seizure · No text span · input-c…") and the list marker "1." hangs outside the panel edge. |
| F35 | confirmed | The Close button is passed as dialog children, so it renders inside the scrolling `.ui-dialog-body` (`tasks/RoundInputEvidenceDialog.tsx:23`); the `footer` prop of `ui/Dialog.tsx` is unused. Same pattern in `WorkRoundsDialog.tsx` and `TaskProblemActions.tsx`. `Dialog` has no header close control. Live: Close at y≈2035 in a 900px viewport. Escape works. |
| F36 | source only | `translation/ReviewParts.tsx:19-37`: label, detail and `<code>` are concatenated; the code is separated only by margin, so its accessible text reads "exampleunits_added". No "what to do" copy. Checks carry no text positions, and none may be invented. Not opened live: task 2 requires "Start", which changes state. |
| F37 | confirmed | `tasks/WorkRoundActions.tsx:48` shows the raw round state; the editor shows the assignment status. These are two dimensions, shown with no labels. Carry-forward options show `v{n} · lang · document_id · ISO time`; no round number. Live: rounds are only labelled "superseded · Historical round". The dialog also says "No eligible submitted work is available to carry forward" although submissions exist; the reason is the editable round 3, which the copy does not state. The editor sidebar says "No previous submissions yet" while the lead sees two submissions for the same text. |
| F38 | confirmed | Two toolbar entries (`TaskProblemActions.tsx:38-39`) open the same dialog, titled "Task problem reports". Two explanatory paragraphs. Textarea without `rows` (58px live). The primary action "Report and pause my task" is a secondary button. The report list loads only after "Reload my reports". Withdrawal does not exist. |
| F39 | partial | `ReportHistory.tsx:8` renders only `String(event.action)` and the reason, and ignores the delivered `created_at`. `ProblemReportView` (`application/problem_reports.py:40-55`) has no creation time or actor; creation is not an event. Live: two blocks, "My report · open" (old synthetic) and "My report · resolved" (the user's). |
| F40 | confirmed | `tasks/MyTasks.tsx:57` builds the local "Project" filter only from the user's own tasks; a lead without tasks gets "All projects" only. The global picker lists all memberships (`app/Shell.tsx:40`). Same label, different scope. Not an authorization defect. |
| F41 | confirmed | Native `<details>` (`Shell.tsx:41-61`): selection navigates but does not close it; no outside-click or Escape handling; Shell stays mounted across routes (`App.tsx:211`). Live: stays open after Escape, outside click, route change and project selection, and then covers the Documents filters. |
| F42 | confirmed | `admin/DocumentsPage.tsx:126-198`: nested `<details>` with free-text summaries. The final selection appears as raw `document_id · submission_id`. `ProjectDocumentSummary` has no last-activity timestamp (`api/generated.ts:2972`). |
| F43 | confirmed | The report appears only as a warning in Progress → "Final results and open issues", with the fixed text from `storage/repository.py:558`. While the task was paused, the `TASK_ON_HOLD` warning carried the report text; after the reporter resumed ("upsi") only the generic warning remained. Resolved reports are filtered out (`repository.py:543`). No lead report list exists. Live: the remaining open warning belongs to the old synthetic report (`report-6851…`), and the user's resolved report is absent everywhere. 5 of 8 "Review issue" links point to the generic Documents page. The detail page's back link goes to Documents. |
| F44 | n/a | Fixed widths: sidebar 260px (`editor.css:62`, hard-coded again in the tree grid at `:821`), 220px at ≤1024px, inspector 380px. |
| F45 | confirmed | `ProblemReportDetail.tsx:47-59`: four actions in a `<select>`, one generic "Apply report action", paused tasks as bare IDs. Report state and pause state are not shown as two facts. |
| F46 | confirmed | `variants/SubmissionHistory.tsx` + `FinalResultSelector.tsx`: the selection is shown as a hash ID; history rows have no selected marker; the dialog mixes history, reaffirmation, replacement and consolidation. **New:** the replacement select shows UTC ISO times (22:57Z, 22:16Z) while the rows show local times (00:57, 00:16), so the same two submissions look like four different times. At 390px the submission list is below the fold. The API summary lacks round ordinal and finding count. |
| F47 | confirmed | `admin/FinalExportPanel.tsx:63-67`: no cancel; "Return to results" is a link to Documents; "Review final export" stays primary after the preflight opens while "Create final export" is secondary. Live: in the warning list, each "Review issue" link sits visually closer to the next item than to its own. |
| F48 | source | `exchange/final_export.py:129-173`: no human-readable index or readme in the archive. |

## Problem clusters and proposals

Contracts preserved in every proposal: explicit decisions only; no automatic clinical confirmation; no silent change or newest-wins replacement of a final selection; no loss of historical work; other holds are never lifted silently; exact text coordinates untouched; selecting a finding never shifts the layout.

### 1. Work guidance in carry-forward rounds (F34, F35, F36, F37)

- **One findings list.** A carried finding stays in "Findings" with a text-and-shape badge "Check needed" and a one-line instruction derived from data. The inspector shows "Carried from Round 1 (submitted 19 Oct, 00:16)", a secondary "Show original evidence" and one primary "Mark as checked". The panel header shows progress ("2 of 5 checked") and "Next unchecked" with a shortcut. The submit dialog jumps to the first unchecked row.
- **Exception path.** "Link to an existing finding" (labelled by term and quote, IDs under details) or "Dismiss with reason" appears only when no carried target exists.
- **Transitions.** Check needed → Checked or Dismissed with reason. A later edit sets it back to Check needed, as `currentRoundInputResolution` already does on version change.
- **Rounds.** One identity line everywhere, e.g. "Round 3 · from Round 2 submission (19 Oct, 00:57) · text de v1". Show "Round: replaced by Round 3" and "Submission: submitted" as separate labelled facts. When carry-forward is unavailable, say why ("Round 3 is still open").
- **Dialogs.** Long dialogs put Close in the fixed footer; `Dialog` renders a header close button whenever `onClose` is set.
- **Checks (F36).** Plain explanation per check code, a separate "Technical code" line, the statement "This check does not point to a text location", and what to do with a justified deviation.

### 2. Problem reports and lead decisions (F38, F39, F43, F45)

- **Reporter.** One toolbar entry "Problem?" with a count badge. The dialog loads the list automatically. Each report shows its first line, the report time, and two separate facts: "Report: open/resolved" and "Your task: paused/resumed". "New report" opens a textarea of at least 6 rows, one sentence of consequence copy, a primary "Report and pause my task" and a quiet "Cancel".
- **History.** Chronological events with actor and time, starting with creation. This needs API additions: `created_at` and reporter label on the report view, actor label on events, and a creation event (or creation rendered from the report row). Missing events are never synthesized.
- **Lead inbox.** An "Open problems (n)" section in Progress lists each report with excerpt, text and language, reporter, report time, task state and "Open", plus a "Resolved" filter. The warning projection must carry excerpt, time and reporter. The detail's back link returns to its origin.
- **Lead actions.** A state panel ("Report: open · Paused tasks: Task 4 (ann-0004): resumed by reporter") followed by intent buttons with stated consequences: "Close report (pauses stay)", "Release pause…", "Pause other tasks…", "Agree empty restart…". The result message names what changed and what did not.

### 3. Project context and navigation (F40, F41, F44)

- **F41.** Replace `<details>` with a button plus popover (`aria-expanded`) that closes on selection, Escape (focus returns to the trigger), outside click and route change; or list projects as links.
- **F40.** Label the local control "Filter my tasks by project" and show it only when the user's tasks span more than one project. The global control is "Current project".
- **F44.** A splitter with `role="separator"`, `aria-valuenow/min/max` and a visible grip. Arrow keys change the width by 16px, Shift+arrow by 64px, Home/End jump to the limits, Enter or double-click resets. Limits: 220px to min(480px, 35vw); the text keeps its reading measure. The width persists per user in localStorage and has a reset; the splitter is off at ≤700px, where pane tabs apply. Replace the hard-coded widths with `--sidebar-width`. Fix the focus ring contrast at the same time.

### 4. Where the key information lives: tables (F42, F46)

To be designed in detail next; see the discussion that follows this document. Starting proposal:

- **Documents (F42).** A treegrid (`role="treegrid"`, `aria-level`, `aria-expanded`). Rows: logical text → language → text version (with corrections and derived translations as children). Columns: text/language/version, origin, text status, work (assignees and state), final result ("Round 2 · ann-0004 · 19 Oct 00:57" or "None"), issues (icon with visible count and accessible label), last activity, actions. "Last activity" needs a new per-row API field and has a different meaning per row type. Technical IDs go into a row detail. Below 700px each row becomes a two-line card.
- **Submissions (F46).** A comparison table: selected marker (icon and text), round, author, submitted (one time zone), findings count, View, Compare with selected. Causes for reaffirmation sit on the selected row. "Use as final result" per row goes through a confirmation naming old → new. Consolidation is a separate action; IDs go under technical details.

### 5. Export (F47, F48)

- **F47.** "Prepare final export" (secondary) → preflight with primary "Create final export" and a quiet "Cancel". Cancel returns to idle, clears the acknowledgement and restores focus. Each warning links to the affected text, not to Documents.
- **F48.** Add `README.txt` and `index.csv` at the archive root (text, language, version, selected submission → file entry, warnings and omissions in plain words, a short format note), included in the receipt hashes. T1/ontospan internals keep their names.

## Quick fixes

Small, low-risk changes with no contract questions: F41 popover, F40 label, F47 cancel and primary button, F35 footer Close, consistent local time in `FinalResultSelector.tsx:54`, resize-handle focus ring, list marker overflow in the carried panel.

## Open contract questions

1. Withdrawing one's own report does not exist. Should withdrawal close the report as "withdrawn" (auditable, with a reason), release only this report's pause on the reporter's task, and can a lead reopen it?
2. Should "Close report" prompt when that report's pause is still active?
3. Does the lead need one "Decisions" page (open reports, results needing review, omissions) instead of spreading these over Progress, Documents and Export?
