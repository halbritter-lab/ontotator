# Lead workflow: work plan per text, next step per row, row actions, pipeline: design

Status: Approved by the user 2026-10-20 (decisions D1 to D14; no open question remains); not implemented. Shaped with the impeccable `shape` playbook (discovery interview skipped: goals given by the user; domain questions were answered by the user, see "Decisions").
Sources: critique snapshot `.impeccable/critique/2026-10-20T08-45-58Z__frontend-src.md` (P1 "Assigning ignores row state", P2 "Lead orientation/naming", click counts), screenshots in `build/phase0-ux/evidence/critique-20261020/`, code in `frontend/src/admin`, `frontend/src/documents`, `frontend/src/tasks`, `src/ontocurator/{storage,exchange,domain,assignments}`.
Builds on: [Documents as the lead's table](2026-10-19-documents-lead-table-design.md) (called "the Documents spec" below). Its decisions 1 to 8 stay. Where this spec changes something that spec or the [quick-fixes spec](2026-10-19-quick-fixes-and-export-design.md) settled, it says so under "Changes to approved decisions".
Mockups (static, gitignored): `.superpowers/mockups/lead-workflow-20261020/` — `documents.html` (table with plan, next step, expanded row, 390 px cards), `assign-dialog.html` (two dialog states), `work-plan.html` (setting the plan per text, single and bulk, and the change confirmation), `progress.html` (pipeline and people). Where a mockup and this spec differ, this spec wins.

## Decisions (user, 2026-10-20)

| # | Question | Decision |
|---|---|---|
| D1 | Who sees display names of others | Only leads see "Display name (ann-000x)". Annotators and reviewers see only pseudonyms of other people. |
| D2 | What work a text needs | **New requirement.** The lead sets a **work plan per text**: either "annotate as-is" or "translate into {target languages}, review the translation, then annotate the translation(s)". Next steps, "To assign", Progress and the Documents row follow the plan. See "Work plan". |
| D3 | Independent annotations per text | Project setting "Annotations per text", default 1. |
| D4 | Failed automatic check, no reviewer yet | Counts under "To assign"; the row shows a "Check failed" badge. |
| D5 | Rejected or queried translation | Lead options: (a) assign a new review, (b) correct it themselves, (c) discard this language version. Not "accept without review". |
| D6 | Annotation review by an adjudicator | Optional stage. |
| D7 | Landing | Lead lands on Documents of the last opened project, even with own open tasks; "My tasks (n)" in the nav. |
| D8 | Export | The preflight runs when the Export page opens; the download stays an explicit click. |
| D9 | Progress documents table | Removed; Progress shows stage cards and people; numbers link to filtered Documents. |
| D10 | Assign dialog default | Nobody preselected; best match sorted on top. |
| D11 | Annotate the source too | Yes: per-text checkbox "Also annotate the source text" in the plan dialog, default off. |
| D12 | Where translations come from | Only from the external machine-translation pipeline, by import. A manual translation task is not needed now; see "Out of scope and future" so the model does not block it later. |
| D13 | Final results of rows that leave the plan | Kept in history, not exported. If the language returns, the lead must confirm the old final result (`PLAN_RESTORED`). |
| D14 | Remaining deviations from the approved 2026-10-19 specs | Approved: 6 instead of 7 columns; translation facts in the stage blocks instead of the Issues list; missing-final rule and export preflight only for planned rows; "final k of m" counts only rows planned for annotation. |

## Problem

A case is a set of clinical source texts. Depending on the study, a text is either annotated as it is, or it is first translated (machine translation, imported), checked and corrected by a bilingual reviewer, and then annotated in the target language. Finally the lead chooses one result per text and language and exports. The lead runs this pipeline from Documents, Progress and Export.

Today:

- The app does not know what work a text needs. Whether a German row should exist, whether the English source should be annotated, and whether a missing translation is a gap or intended is in the lead's head only. Every row looks like it needs annotation; nothing says "translation still to import".
- The lead has to work out each row's state from four columns of facts (version and translation status, work, final result, issues). Nothing says "what happens next, and who does it".
- Assigning ignores row state: the dialog always starts at "Annotation", even for a machine translation ready for translation review; it shows no current assignee and no workload. Six clicks per assignment; Assign sits in the body while Close sits in the footer.
- The lead lands on an empty My tasks.
- One person appears under three identities ("Translation reviewer", "demo-reviewer", "ann-0003"); one text under three names (`synthetic-failed`, `failed-source`, `failed-translation`).
- "Needs your decision (1)" counts a failed automatic check although a review is already open on it.
- Progress mixes assignment counts and a second documents table; the pipeline is not visible.
- Rows repeat "v1 · Native", "None" and "No activity"; an expanded row with no submissions still shows an empty table header.

## Users and context

- **Project lead** (primary): sets up the project, decides what each text needs, imports texts and translations, assigns reviews and annotations, follows progress, decides on problems, chooses final results, exports. Desktop, sessions of minutes, often "what changed since this morning". Sees display names of members.
- **Translation reviewer, annotator** (secondary here): affected by the shared text label in My tasks; they keep seeing pseudonyms for other people (D1).

Success: the lead opens the app, sees which rows need them and what to do, and does it from the row in at most three clicks.

## Goals and targets

| Flow | Today | Target | This design |
|---|---|---|---|
| Land where the work is | Login → empty My tasks → Documents | 0 extra | 0 |
| Set the work plan of one text | not possible | — | 3 (Plan…, choice, Save) |
| Set the work plan of many texts | not possible | — | selection + 3 |
| Assign translation review to one row | 6 | ≤ 3 | 3 |
| Assign annotation to one row | 4–6 | ≤ 3 | 3 |
| Choose final result | 4–5 | 2–3 | 2 (one submission) / 3 (several) |
| Confirm (keep) a final result after a change | 4 | — | 3 |
| Problem report decision | 6 + typing | 3–4 | 3 (+ typing where the intent asks) |
| Export final results | 4–5 | 2–3 | 3 without warnings (Export, Create, Download), 4 with warnings (+ acknowledgement) |

Click counts start where the lead already is (Documents for row flows; any lead page for Export) and count activations, not typing or scrolling. Export keeps the explicit download (D8) and the explicit acknowledgement of warnings; both are deliberate.

## Work plan (D2)

### What exists today (backend)

- `projects.languages` (jsonb list): the project's languages; used by the upload language select and filters. No meaning of "needed".
- `documents`: one row per version with `case_id`, `external_id`, `language`, `version`, `origin` (`native`, `machine_translation`, `human_translation`, `correction`), `derived_from`, `translation` (jsonb run metadata: `provider`, `model`, `run_id`, `recipe`, `checks`) and `translation_status`. Translations are linked to their source by `derived_from` and `case_id` (`exchange/variant_plan.py`).
- Translations only arrive **by import** (T1 bundles with ontospan translation metadata; `exchange/uploads.py`, `exchange/t1.py`). There is no in-app machine translation (the app sends no requests outside its origin) and no way to create a new translation root in the app; leads and reviewers can create **corrections** (`TranslationCorrectionAction`, translation review "accepted with corrections").
- `projects.annotate_accepted_translations_only` (default true) gates annotation assignments on unaccepted translations (`assignments/eligibility.py`).
- There is **no** notion of planned work per text, of target languages per text, of a target number of annotations, or of discarding a language version. Documents are never deleted or retired.

### Concept

The **work plan** belongs to a text (`case_id`) and says which rows (text · language) must be produced and annotated:

| Plan | Rows that need work | Stages per row |
|---|---|---|
| **Annotate as-is** | The source row | Annotation → Final |
| **Translate, then annotate** into target languages T (one or more, from the project languages, never the source language) | One row per target language | Translation (import) → Translation review → Annotation → Final |

- In "Translate, then annotate", the source row is the translation source only and is not annotated, unless the lead ticks "Also annotate the source text" (D11; `annotate_source`, default off). Then the source row is a planned annotation row like the targets.
- A row outside the plan (e.g. an imported translation into a language the plan does not name, or a language removed from the plan) is **not in plan**: it shows no next step, does not count in the bar, Progress or the missing-final rule, and is not exported. It stays visible under the filter "Not in plan" and keeps its history.
- Target number of independent annotations: project setting **"Annotations per text"** (D3), default 1, range 1–5. It applies to every row the plan marks for annotation.
- Annotation review by an adjudicator is optional (D6): it is never a planned stage; the lead may assign it from the row's More section or the bulk assign dialog, and while it is open it appears as the row's waiting step.

### Defaults

- New project setting **"Default work plan for new texts"**: "Annotate as-is" (default) or "Translate, then annotate" with default target languages (from the project languages).
- The upload preview shows the plan each new text will get (project default preselected) and lets the lead change it for the whole upload before importing ("Work plan for the 12 new texts: Annotate as-is · Translate into de, then annotate"). Texts that already exist keep their plan.
- An imported translation for a text whose plan is "Annotate as-is" does not change the plan; the upload preview warns: "3 translations are for texts planned as 'annotate as-is'. They will be imported but not in plan. Change the plan of these texts to 'Translate, then annotate'?" with a checkbox (default unchecked, nothing changes silently).

### Migration of existing projects

A migration creates a plan for every existing `case_id`:

- If the text has at least one translation root (`machine_translation` or `human_translation`): "Translate, then annotate" into the languages of those roots.
- Otherwise: "Annotate as-is".
- If the source row of a translated text already has annotation assignments or submissions, the plan also annotates the source (`annotate_source = true`), so no existing work falls out of plan.
- "Annotations per text" is set to 1 for existing projects.
Migration result per project is written to the audit log ("Work plans created: 40 annotate as-is, 12 translate into de").

### Where the lead sets and sees it

- **Documents, group header** (one text): plan as text after the text ID: "Annotate as-is" or "Translate into de, fr · then annotate"; a quiet button "Plan…" (accessible name "Change work plan, {text ID}") opens the plan dialog for that text.
- **Documents, selection bar** (many texts): "Set work plan…" (secondary) applies one plan to all texts of the selected rows.
- **Upload preview**: plan for the new texts (above).
- **Settings › Workflow**: "Default work plan for new texts", "Annotations per text".
- **Filters**: "Work plan" (Annotate as-is · Translate, then annotate · Not in plan rows).

**Plan dialog** (`Dialog size="md"`; `work-plan.html`): title "Work plan · {text ID}" or "Work plan · {n} texts"; source language line ("Source: en"); radio group "What does this text need?" with "Annotate as-is" and "Translate, then annotate"; under the second, checkboxes per project language except the source ("Target languages"), at least one required, and below them the checkbox "Also annotate the source text" (default off, D11). Footer: Cancel · primary "Save plan". Bulk with mixed source languages: a source language that is also a chosen target is skipped for that text, and the dialog says so ("de is the source of 2 texts; those texts get the other target languages").

### Editing after work started

Saving a plan computes its consequences first (server dry-run). Without consequences, it saves at once. With consequences, the dialog shows them and asks for explicit confirmation (`InlineConfirm` inside the dialog body titled "Change plan for {n} texts?", one line per affected row, actions "Back to the plan" and primary "Change plan"; while it is open the footer shows only "Cancel", so there is one primary button):

| Change | Consequence shown | What happens |
|---|---|---|
| Add a target language | "de will need a translation import." | A planned row appears with step "Import translation". |
| Remove a target language (or switch to "Annotate as-is") with no work on that row | "de leaves the plan." | Row becomes "Not in plan". |
| Remove a language whose row has open tasks | "2 open tasks on de will be removed: Translation reviewer (ann-0003) · translation review; Annotator (ann-0004) · annotation, Round 1 (draft kept)." | On confirm the open assignments are revoked (existing revoke; drafts stay with their authors). |
| Remove a language whose row has submissions or a final result | "1 submission and the final result stay in the history. de will not be exported." | Nothing is deleted; the final selection stays stored but the row is not exported while not in plan. |
| Switch "Annotate as-is" → "Translate, then annotate" with work on the source row | "The source row has 1 submission. It stays in history; the source is no longer annotated." plus the option "Keep annotating the source" (checkbox, default checked when work exists) | Sets `annotate_source` accordingly. |
| Lower "Annotations per text" | Settings shows "4 rows have more annotators than the new target. Nobody is removed." | No automatic revocation. |

- Re-adding a language restores the row into the plan with its history; a previous final result becomes active again only after the lead confirms it ("Confirm final result" step, cause `PLAN_RESTORED`).
- Plans carry a `revision`; a save with a stale revision fails with "The plan changed since you opened it. Review the current plan." (no partial bulk save: the bulk save is all-or-nothing, the conflict lists the texts).
- Every change is audited (who, when, old plan, new plan, revoked assignments).

### Discarding a language version (D5 c)

"Discard the de translation…" (from a rejected or queried translation's Resolve options) removes `de` from the text's plan with the consequences above, and marks the translation versions of that row as discarded (reason required, shown in Text versions and Technical details). The documents stay; nothing is deleted. To try again later the lead re-adds the language to the plan and imports a new translation (a new root).

## Concepts

### Stage

Each **planned** row is in one stage:

1. **Translation** — planned target-language row without any translation document: waiting for an import.
2. **Translation review** — a translation exists and is not accepted.
3. **Annotation** — the row is annotated: source row in "annotate as-is" (or with `annotate_source`), or an accepted translation (with `annotate_accepted_translations_only` off, any translation).
4. **Final result** — all planned annotation work submitted (missing-final rule) or a final result exists.
5. **Done** — final result, nothing open, nothing to confirm.

Rows without translation in their plan skip stages 1 and 2. The translation source row in "Translate, then annotate" (without `annotate_source`) has no stage and shows "Translation source" (no step, no counts). Parallel roots: the most advanced chain decides; the step names the chain ("Assign translation review · DeepL v1").

### Next step

Every planned row has exactly one **next step** with an **owner**, derived on the server (one derivation for table, filters, bar and Progress). First matching rule wins:

| # | Condition (planned row) | Next step | Owner | Row action | Counts as |
|---|---|---|---|---|---|
| 1 | `OPEN_PROBLEM_REPORT` | Decide on problem report | You | "Decide on report…" | Decision |
| 2 | `TASK_PAUSED_WITHOUT_REPORT` | Resume paused task | You | "Resume task…" | Decision |
| 3 | Unacknowledged acknowledgeable cause on the final result (incl. `PLAN_RESTORED`) | Confirm final result | You | "Review changes…" | Decision |
| 4 | Newest translation version rejected or queried, no open translation review | Resolve rejected translation / Resolve queried translation | You | "Resolve…" | Decision |
| 5 | Missing-final rule holds (planned annotation rows only) | Choose final result | You | "Choose final…" | Decision |
| 6 | Planned target language, no translation document | Import translation | You | "Upload translations…" (opens upload) | Waiting (not in the bar; see note) |
| 7 | Translation needs a reviewer (`translated`, `automatic_check_failed`, `ready_for_review`, or a correction `ready_for_review`) and no non-revoked translation review on it | Assign translation review (+ "Check failed" badge when applicable, D4) | You | "Assign translation review…" | To assign |
| 8 | Translation review open | Translation review | Reviewer | none | Waiting |
| 9 | Stage annotation and fewer non-revoked annotation assignments than "Annotations per text" | Assign annotation ("1 of 2 assigned" when target > 1) | You | "Assign annotation…" | To assign |
| 10 | Annotation or optional annotation review open | Annotation / Annotation review | Assignee(s) | none | Waiting |
| 11 | Final result, nothing open or to confirm | Done | — | none | — |
| 12 | Annotation waits for translation acceptance (gate on) and nothing above applies | Waiting for translation review | — | none | Waiting |

- Note on rule 6: imports are done in batches through Upload, not per row; these rows are counted in Progress ("Waiting for translation import") and filterable ("Next step: Import translation"), but not in the bar segments.
- A row matching several rules shows the first; "+1 more step" expands the row, where all are listed.
- Secondary line (muted, `size-sm`): the one fact needed to act: "v1 machine translation · ready for review", "Source text · ready to annotate", "2 of 2 annotations submitted", "Round 1 · in progress", a report excerpt (60 characters) with reporter and "task paused", "Final: Annotation · Round 1 · Annotator (ann-0004)", "Planned: translate from en".
- Owner "You" is the lead viewing the page; another lead's own open task shows that lead's name.

### "Needs your decision" and "To assign"

The bar counts only planned rows. **Needs your decision** = rules 1 to 5; **To assign** = rules 7 and 9 (D4: a failed check without reviewer is here, with its badge). A failed check with an open review counts in neither. Segments: **All (n) · Needs your decision (n) · To assign (n) · No final result (n)**. The translation category under "Needs your decision" is renamed "Translation rejected or queried". Other bar rules of the Documents spec stay (project-wide counts, "k of n shown · Clear filters", `decision`, `assign` and `final` mutually exclusive). "No final result" counts only planned annotation rows.

### Identity (D1)

- For leads, one format wherever a person appears: **"Display name (ann-0004)"**; own items "Display name (ann-0002, you)"; in the Owner column a lead's own step is "You". Without a display name, or for former members: the pseudonym alone.
- The username is never shown outside Settings › Members and Technical details.
- Shell header: "Display name (ann-0002)" with the role as a muted second line.
- Annotators and reviewers see their own display name in the header and **only pseudonyms for other people** (waiting lines, report pages, history). The server fills `display_name` of other people only for lead callers. Exports stay pseudonymous.

### Text label

One label per text and language everywhere: **"{text ID} · {language}"** (text ID = `case_id`), with a version only where it matters ("synthetic-failed · de v2"). Document IDs and external IDs move to Technical details. Applies to Documents, Progress, My tasks, dialogs, report page, export preflight, confirmations and announcements.

## Screens

### Landing (D7)

- After login and on `#/`, a user who leads at least one project goes to **Documents** of the last project they opened (per-user `localStorage` key `ontocurator.lastProject.v1:{username}`; a project they no longer lead is skipped), else the first led project in picker order. Replace navigation (Back does not loop). This holds also when the lead has own open tasks.
- Users who lead no project keep landing on My tasks.
- Nav entry "My tasks (n)" with the user's unsubmitted tasks across projects (the shell calls the existing `listMyTasks` once per session and on window focus). Explicit `#/tasks` still opens My tasks.

### Documents

Layout (desktop, compact density), top to bottom; see `documents.html`:

1. **Heading row:** `h1` "Documents"; at the right a quiet "Upload texts…". No other page-level buttons.
2. **Filters:** Language, **Next step** (grouped by stage), Text ID; "More filters": Work plan, Origin, Translation status, Status (assignment status).
3. **Bar:** segments as above; at the right "Updated 10:42 · Refresh" (muted time, quiet link; rows already refetch on focus, after own actions, every 60 s). The Refresh button goes away. A quiet "Export final results…" link appears when the project has at least one final result.
4. **Selection bar** (only with a selection; sticky above the table): "{n} rows selected", their common step ("All: Assign annotation" / "Mixed next steps"), **primary** "Assign …" named after the common step ("Assign annotation…", "Assign translation review…", or "Assign…"), secondary "Set work plan…" and "Propose distribution…", quiet "Clear selection". The page's only primary button. "Select all" moves into the select column header.
5. **Table**, 6 columns:

| Column | Content |
|---|---|
| Select | Bulk checkbox (rules of the Documents spec; "Choose in Text versions" stays). Planned rows without a document (rule 6) have a checkbox for "Set work plan…" only; assign actions skip them and say so. |
| Text · language | Row header: disclosure ("Show details, {text · language}"), language code, "Open", "Open my task". Planned rows without a document have no "Open". |
| Next step | Step, badges ("Your decision", "Check failed", "Paused"), secondary line, "+1 more step". Translation source rows: "Translation source" muted. Not-in-plan rows (only under that filter): "Not in plan" neutral badge. |
| Owner | "You" (`weight-strong`), person, "2 annotators", or "—". |
| Action | One small secondary button for lead-owned steps; empty otherwise. Name "{step}, {text · language}". |
| Last activity | As today. |

- **Group header:** text ID; the plan ("Annotate as-is" / "Translate into de · then annotate"); "{n} languages · final k of m" (m = planned annotation rows); "{n} decision(s)" warning badge; last activity; quiet "Plan…". The warning left edge marks groups with decisions only.
- **Moved into the expanded row:** version and origin, Work, Final result, Issues and notes, translation status.
- Ordering, paging, group expansion, deep links and visit badges stay as in the Documents spec ("Changed: Translation review assigned", "Changed: Work plan changed").

**Row actions:**

| Action | Behaviour | Clicks |
|---|---|---|
| Assign translation review… / Assign annotation… | Assign dialog for the row's version, task preselected | 3 |
| Upload translations… | Upload dialog; the preview lists which planned rows the files fill | — |
| Choose final… | Expands the row. One eligible submission: opens its "Use as final" `InlineConfirm`; several: focuses the Submissions heading | 2 / 3 |
| Review changes… | Expands the row and opens the Keep confirmation | 3 |
| Decide on report… | Report page, Decide section focused | 3 |
| Resume task… | Report page with `action=resume` | 2–3 |
| Resolve… (D5) | Expands the row with the Translation block focused; it offers exactly: "Assign a new review…" (assign dialog, task translation review), "Correct the translation…" (existing correction flow; the correction then follows its existing review rule), "Discard the de translation…" (reason required; consequences and confirmation as in "Editing after work started"). No "accept without review" here. | 3 |

After success: the row updates in place, focus returns to the row's disclosure (or the Documents spec's focus target for final selections), the live region announces the result, and under a decision or to-assign filter the success message offers "Next: {text · language}".

**Expanded row:**

1. **Pipeline summary**: blocks for the row's planned stages only: "1 Translation review" (with the import state when no translation exists: "Waiting for import · planned 20 Oct"), "2 Annotation" ("0 of 2 assigned" with the target), "3 Final result". Annotate-as-is rows show two blocks. Each block: status badge (text + shape), people with state and time, links where the stage is acted on ("Text versions (n)", "Translation reviews", "Assignment actions", "Assign annotation review…" as the optional adjudicator step). The current stage's block has the accent top edge. Report and source-change lines stay in an "Issues" list below.
2. **Submissions (n)**: only when n > 0 or a final result exists.
3. **More**: Start consolidation…, Text versions (n) (discarded versions labelled "Discarded · {reason}"), Problem reports (n), Technical details (external and document IDs per version, plan revision).

### Assign dialog

`Dialog size="md"`; see `assign-dialog.html`.

- **Title** = the action ("Assign translation review", "Assign annotation", "Assign annotation review"; bulk "Assign {task} · {n} rows").
- **Context:** "{text · language}" and the version fact. Bulk: count and "Show rows".
- **Currently:** who holds the task now; for annotation also the target ("1 of 2 annotators assigned").
- **Task:** text with a quiet "Change task" that reveals the existing select (existing eligibility rules). Bulk with mixed steps: select shown at once, no default.
- **Members:** name (identity format), "Reads de, en", open work per type, "{n} open tasks" at the right (open, in progress, reopened; not revoked). Translation review: radio buttons; annotation and annotation review: checkboxes, limited to the remaining target ("Choose up to 1 more annotator"; choosing more shows "This exceeds the project's 2 annotations per text" and asks to confirm, never blocks).
- **Nobody is preselected** (D10). Sorting: language match first, then fewest open tasks, then name.
- **Unavailable members** stay listed, muted, with a visible reason and `aria-disabled`: "Already annotating this text", "Already reviewing this translation", "Not an annotator in this project", "Annotating this text; cannot review it".
- **Language mismatch:** warning line under the member; after Assign, the existing confirmation appears in the dialog above the footer; footer "Cancel · Assign anyway".
- **Footer only:** "Cancel" and primary "Assign" / "Assign 2 annotators", focusable with `aria-disabled` and a reason until a choice exists.
- **Success:** dialog closes; "Translation review of synthetic-ready · de assigned to Translation reviewer (ann-0003)."; focus to the row's disclosure. Partial refusals keep the dialog open with refused rows by text label and person; footer "Close". Rows not in plan or without a document are refused with "Not in the work plan" / "No text to assign yet".
- Text versions' Reassign, Reopen and Remove keep their dialogs; their member selects use the identity format and open-task counts.

### Problem report page (small change)

Entered from "Decide on report…": opens at "Decide" with its `h2` focused. After a decision: success message with "Back to Documents" and, under a decision filter, "Next decision: {text · language}" (links; no automatic navigation).

### Progress (D9)

See `progress.html`. Replaces "Totals" and "Documents"; People in a new form.

- **Lede:** "{n} texts: {a} annotate as-is, {t} translate then annotate ({r} rows to annotate in {k} languages)." plus "{n} need your decision" (link) and the update time.
- **Pipeline:** an ordered list of stage cards with decorative arrows. Each card: title, scope, a done sentence with a thin decorative bar, and states with counts; every count links to Documents filtered to exactly those rows (`step=…` or `stage=…&state=…`); zero counts stay listed, muted.
  - Translation (translated rows only; scope "12 rows planned for translation · 40 texts annotated as-is skip this stage"): Waiting for import · To assign · In review · Check failed, with reviewer (subset, indented) · Rejected or queried (your decision) · Accepted.
  - Annotation (scope: planned annotation rows, with the target "1 annotation per text"): Waiting for translation · To assign · In progress · Paused by a problem report · Submitted. Optional annotation reviews appear as "In annotation review" only when any exist.
  - Final result: Not ready (work open) · To choose (your decision) · To confirm (your decision) · Final. Footer link "Export final results…" "(k final, m would be omitted)".
- **People:** "Person · Translation reviews open · Annotations open · Reviews open · Paused · Submitted"; person in the identity format, linked to Documents filtered by owner (`owner=<pseudonym>`); sorted by open work.
- Refresh as Documents. Empty project: `EmptyState` "No texts yet" with "Upload texts".

### My tasks

"Document" becomes "Text" with the text label; the Language column goes. Task column keeps "Translation review (en to de)". Other people never appear here. A lead reaching an empty My tasks explicitly sees the existing empty state with "Go to Documents".

### Export (D8)

- Opening Export runs the preflight at once (the region "Export preflight" with its summary line is visible; while it runs: "Checking final results…"). "Prepare final export" disappears; "Check again" (quiet) reruns it; the existing invalidation on final-selection changes reruns it automatically when the page is visible, otherwise shows the existing "Final selections changed" notice with "Check again".
- Primary "Create final export"; with warnings the acknowledgement checkbox stays.
- After the job succeeds: primary "Download final export" (explicit click, no automatic download); secondary "Prepare a new export" becomes "Check again".
- Only planned annotation rows are exported. The preflight lists texts' rows not in plan that have a final result under "Not in plan, not exported" (information, no acknowledgement needed).
- Clicks: Export (1) → Create (2) → Download (3); with warnings + acknowledgement (4).

### Settings › Workflow

Two new fields next to the existing workflow switches: "Default work plan for new texts" (radio, with target languages) and "Annotations per text" (number 1–5, default 1; hint "How many people annotate each text independently."). Lowering the number shows the "Nobody is removed" note.

## States

| State | Documents | Assign dialog | Plan dialog | Progress |
|---|---|---|---|---|
| Loading | Skeleton rows (6 columns), bar placeholder | "Loading members…", Assign unavailable | "Checking consequences…" on Save, `loading` | Skeleton stage cards, `aria-busy` |
| Empty project | "No texts yet. Upload texts to start." + "Upload texts…" | — | — | "No texts yet" + link |
| Filter empty | Existing; "To assign": "Nothing to assign" + "Show all texts"; "Not in plan": "Every row is in a work plan." | — | — | Zero counts muted |
| Error | Existing (error + Retry) | Member load: error + Retry; write: error above footer | Save fails: error above footer, choices kept; stale revision: conflict message with "Review again" | Error + Retry |
| Stale step | Rows refetch; an open assign dialog whose row's step changed shows "This row changed: {new step}. Check before assigning." | — | — | — |
| Permission | Non-leads: existing "Documents is for project leads" | — | — | Existing access message |
| Narrow ≤ 700 px | Cards (below) | Full-height sheet | Full-height sheet | Stacked cards; People as cards |

**Narrow (Documents):** one `<article>` card per row: line 1 checkbox, "{text · language}" heading, "Your decision" badge; line 2 next step (`weight-strong`) with badges; line 3 secondary line and "Owner: …"; the row action as a full-width secondary button (≥ 32 px); last line "Open" and "Details". The group heading shows the plan and "Plan…". Selection bar bottom-sticky. Filters collapse into "Filters (n active)". Reflow verified at 320 CSS px.

## Copy

| Place | Text |
|---|---|
| Plans | "Annotate as-is", "Translate, then annotate", "Translate into de, fr · then annotate", "Translation source", "Not in plan" |
| Plan dialog | "Work plan · {text ID}", "What does this text need?", "Target languages", "Save plan", "Change plan", "de will need a translation import.", "de leaves the plan.", "2 open tasks on de will be removed: …", "1 submission and the final result stay in the history. de will not be exported." |
| Bar | "All (n)", "Needs your decision (n)", "To assign (n)", "No final result (n)"; category "Translation rejected or queried" |
| Steps | "Decide on problem report", "Resume paused task", "Confirm final result", "Resolve rejected translation", "Resolve queried translation", "Choose final result", "Import translation", "Assign translation review", "Translation review", "Assign annotation", "Annotation", "Annotation review", "Waiting for translation review", "Done" |
| Row actions | "Decide on report…", "Resume task…", "Review changes…", "Resolve…", "Choose final…", "Upload translations…", "Assign translation review…", "Assign annotation…", "Plan…" |
| Resolve options | "Assign a new review…", "Correct the translation…", "Discard the de translation…" |
| Badges | "Your decision", "Check failed", "Paused", "Not in plan", "Discarded", "{n} decision(s)" |
| Owner | "You", "Display name (ann-0004)", "2 annotators", "—" |
| Dialog | "Currently", "Nobody is reviewing this translation.", "1 of 2 annotators assigned", "Change task", "Reads de, en", "{n} open tasks", "Already annotating this text", "Choose a reviewer first.", "Assign", "Assign {n} annotators", "Assign anyway" |
| Announcements | "{Task} of {text · language} assigned to {person}.", "{n} rows assigned. {k} refused.", "Work plan saved for {n} texts.", "Next: {text · language}" |
| Progress | "{k} of {n} accepted", "{k} of {n} fully submitted", "{k} of {n} final", "Waiting for import", "Check failed, with reviewer" |

No codes, no usernames in visible copy. Ellipses mark actions that open a dialog or a confirmation.

## Accessibility

- WCAG 2.2 AA. Status never by colour alone: every badge has text and shape; the group's warning edge duplicates the badge text.
- Row action names include the row. Tab order per row: checkbox, disclosure, Open, (Open my task), action. Group header: disclosure, "Plan…".
- Native table with `th scope="row"`; expanded row is a `region` labelled by the row header. Selection bar is a `region` "Selection"; count changes are announced.
- Dialogs: focus on open goes to the first choice (assign: first member control or the task select; plan: the checked radio); `fieldset`/`legend` for radio and checkbox groups; unavailable choices use `aria-disabled` + `aria-describedby` to visible reasons, never native `disabled`; the consequence confirmation in the plan dialog receives focus on its heading (`InlineConfirm` rules).
- Progress: `ol` of stage `li`s with headings; decorative bar and arrows `aria-hidden`; count links name state and stage ("In review, translation review: 2 rows").
- Targets ≥ 24 × 24 px (card main action ≥ 32 px). Forced colours: badges keep outline and icon; the current pipeline block uses a `CanvasText` top border. No new motion beyond the existing 150 ms expansion.

## Changes to approved decisions

| # | Approved in | Change | Status |
|---|---|---|---|
| 1 | Documents spec, "Shared rules": person label = pseudonym on Documents | "Display name (ann-0004)" for leads; others see pseudonyms | Decided by the user 2026-10-20 (D1) |
| 2 | Documents spec, "Needs your decision" bar and decision 1 | Fourth segment "To assign"; failed checks without reviewer count there, with an open review nowhere; translation category = rejected or queried without open review | Decided by the user 2026-10-20 (D4) |
| 3 | Documents spec, "Changes elsewhere": Progress keeps totals, people and documents statistics | Totals and documents table replaced by stage cards; People kept | Decided by the user 2026-10-20 (D9) |
| 4 | Quick-fixes spec Q4: idle state with primary "Prepare final export" | Preflight runs on open; download stays explicit | Decided by the user 2026-10-20 (D8) |
| 5 | Documents spec, "Columns": seven columns (Text version(s), Work, Final result, Issues) | Six columns (Next step, Owner, Action); facts move into the expanded row | Decided by the user 2026-10-20 (D14) |
| 6 | Documents spec, expanded row section 1 "Issues" | Translation and reviewer-needed lines move into the pipeline summary blocks | Decided by the user 2026-10-20 (D14) |
| 7 | Documents spec, missing-final rule and "No final result"; export preflight `MISSING_FINAL_SELECTION` (unconditional) | Both apply only to planned annotation rows; rows not in plan are not exported | Decided by the user 2026-10-20 (D13, D14) |
| 8 | Documents spec, group header "final k of m" (m = all language rows) | m = planned annotation rows | Decided by the user 2026-10-20 (D14) |

## Backend and API

`contracts/openapi.json` and `frontend/src/api/generated.ts` are regenerated. Lead-only unless stated.

### New for the work plan (WP L0)

- **Data model** (migration `0016_work_plans`):
  - Table `work_plans`: `project_id`, `case_id` (unique per project), `mode` (`annotate_as_is` | `translate`), `target_languages` (jsonb list, empty for as-is; never contains the source language), `annotate_source` (bool, default false; ignored for as-is), `revision` (bigint), `updated_by`, `updated_at`, `created_at`. Check constraints: `mode = 'translate'` ⇒ at least one target language.
  - Table `discarded_variants`: `project_id`, `document_id` (unique), `reason` (text, required), `discarded_by`, `discarded_at`. Documents stay immutable.
  - `projects`: `annotations_per_text` (int, default 1, 1–5), `default_work_plan` (jsonb `{mode, target_languages}`, default as-is).
  - Data migration: plans for all existing `case_id`s as described under "Migration of existing projects"; `annotations_per_text = 1`.
- **Domain:** `domain/work_plans.py`: planned rows of a text (source language from the native root; targets), stage of a row, consequence computation for a plan change (open assignments, submissions, final selection per affected row). Pure functions with unit tests.
- **API:**
  - `GET /projects/{key}/work-plans?case=…` and inline `plan` on `DocumentGroupView` (`mode`, `target_languages`, `annotate_source`, `revision`).
  - `POST /projects/{key}/work-plans/preview` `{case_ids, plan}` → per text: affected rows and consequences (open tasks to revoke with assignee and task, submissions kept, finals not exported, new import needs).
  - `PUT /projects/{key}/work-plans` `{items: [{case_id, expected_revision}], plan, confirm: bool}` → all-or-nothing; without `confirm` and with consequences → 409 `WORK_PLAN_CONFIRMATION_REQUIRED` with the preview; stale revision → 409 `WORK_PLAN_CHANGED`. Revokes open assignments of removed rows in the same transaction (existing revoke semantics), audits old and new plan.
  - `POST /projects/{key}/variants/{document_id}/discard` `{reason}` → discards the row's translation versions and removes the language from the plan (same preview/confirm contract).
  - Uploads: `createUpload` accepts `work_plan` for new texts and `adopt_translations: bool`; the preview returns per new text the plan it will get and the list of translations that would be "not in plan".
  - Project settings: `annotations_per_text`, `default_work_plan`.
- **Effects elsewhere:**
  - `assignments/eligibility.py`: new allocations on a row not in plan or on a discarded version → `NOT_IN_WORK_PLAN`; on the source row of a translate plan without `annotate_source`, annotation → `NOT_IN_WORK_PLAN` (translation review of targets unaffected). Existing exact retries and reopen keep bypassing new-allocation rules.
  - Final results: rows not in plan keep their `final_selections`; the export (`exchange/final_export.py`) and the preflight include only planned annotation rows; re-adding a row raises the acknowledgeable cause `PLAN_RESTORED:{case}:{language}:{plan revision}` on its existing selection.
  - Document rows: the rows endpoint synthesizes planned rows that have no document yet (`versions: []`, `planned_only: true`).

### Extensions of L1 (next step, identity, counts)

- **Next step** on `DocumentRowView`: `next_step = {code, kind: decision|assign|waiting|done|none, stage, owner: PersonRef | "lead" | null, action, more, detail}`, plus `steps` (all matching rules) and `in_plan`, `plan_role: annotate|translation_source|not_in_plan`. Bar counts derive from it; contract test: bar counts equal per-row step kinds; Documents and Progress counts equal.
- **Bar:** `DecisionBarView.assign`; `translation` excludes chains with an open review; all counts planned rows only.
- **Query:** `step`, `stage`, `owner`, `assign=all`, `plan=annotate_as_is|translate|not_in_plan` on `document-rows`, parser, serializer, `documents_*` passthrough.
- **PersonRef** `{pseudonym, display_name | null, is_me}` on `WorkItemView`, `FinalSelectionSummary`, row submissions and rounds, report excerpts, `ProgressPerson`; `display_name` for others filled only for lead callers (D1).
- **Workload:** `Member.open_tasks: {translation_review, annotate, review}` for lead callers.
- **Text label:** `TaskSummary.case_id`. `ProgressDocument` and `totals` removed from the UI; kept in the API one release.
- **Progress:** `stages` with counts per stage state from the same derivation.
- **Landing, My tasks count, Export preflight on open:** client-only.

## Out of scope and future

In-app machine translation (the app sends no requests outside its origin; translations come only from the external machine-translation pipeline by import, D12); translation review screen and its check block (critique P1, separate spec); annotator term loop (T6b); distribution proposal logic beyond respecting the plan and "Annotations per text"; Settings layout beyond the two new fields; report page beyond focus and success links; export archive format; dark theme; new roles.

**Future: manual translation task (not built now, D12).** A later version may let a bilingual person translate a text in the app: a new task type `translate` assigned on a planned target row that has no translation yet, opening an editor with the source on one side and an empty target text on the other; submitting creates a new translation root with origin `manual` (distinct from the imported `human_translation`) and status `ready_for_review`, after which the normal translation review applies, optionally by a second reviewer. This spec must not block it: the work plan stores target languages independently of how a translation is produced; rule 6 ("Import translation") is the only place that assumes import and would gain a sibling step "Assign translation"; the `assignments.task` and `documents.origin` check constraints are the only schema points to extend.

## Work packages (rough)

| WP | Content | Size | Review |
|---|---|---|---|
| L0 (new) | Work plan backend: migration `0016_work_plans` (tables, project fields, data migration), domain module, preview/save/discard endpoints, upload plan, eligibility `NOT_IN_WORK_PLAN`, export and preflight scope, `PLAN_RESTORED` cause, planned-only rows; contract tests (no silent revocation, all-or-nothing bulk, migration keeps all existing work in plan) | L | yes (backend-critical) |
| L1 | Next-step derivation on top of L0, bar `assign` and translation category, filters, PersonRef with lead-only display names, workload, `TaskSummary.case_id`, progress `stages`; contract tests | L | yes (backend-critical) |
| L2 | Shared `personLabel(PersonRef)` and `textLabel(row)`; apply in Documents, Progress, My tasks, shell header, AssignmentActions, report page, export preflight | M | — |
| L3 | Documents table: 6 columns, step/owner cells, row actions incl. Resolve options, group header plan + "Plan…", selection bar incl. "Set work plan…", filters, bar segment; narrow cards | L | yes |
| L4 | Expanded row: pipeline blocks per planned stage, Submissions only when needed, discarded versions, Technical details | M | — |
| L5 | Assign dialog: preselected task, context, "Currently" with target, workload, sorting, unavailable reasons, target limit, footer actions, success focus, bulk | M | — |
| L5b (new) | Plan dialog (single and bulk, consequences confirm, conflict), upload preview plan step, Settings › Workflow fields | M | yes (plan change confirmation) |
| L6 | Landing redirect, "My tasks (n)", My tasks text label | S | — |
| L7 | Progress stage cards and People | M | — |
| L8 | Report page focus/success links; Export preflight on open, "Check again", plan-scoped preflight lists | S | — |
| L9 | Browser verification (flows and click counts, plan change after work started, 390/320 px, forced colours, keyboard-only); DESIGN.md update | M | per finished plan |

Order: L0 → L1 → L2 → (L3, L5, L5b, L6 in parallel) → L4 → L7 → L8 → L9.

## Testing

- **Unit (backend):** plan derivation (as-is, translate with one and two targets, `annotate_source`, source language never a target); consequence preview for every row in "Editing after work started"; migration cases (no translations, translations, translations plus source work); every next-step rule and precedence, parallel roots, gate on and off, failed check with and without reviewer, "Annotations per text" 1 and 2, not-in-plan and translation-source rows excluded from bar, missing-final and export; display names only for leads.
- **Contract:** no plan change revokes work without `confirm`; bulk plan save is all-or-nothing; stale revision refuses; discard never deletes documents; export and preflight equal on plan scope; Documents bar equals per-row step kinds; Documents and Progress counts equal.
- **Component:** step and owner cells, plan text in the group header, selection bar labels, assign dialog (preselection none, sorting, target limit, unavailable reasons, in-dialog language confirmation, focus on success), plan dialog (single, bulk with mixed sources, consequence confirmation focus, conflict), landing redirect with replace.
- **Browser (Playwright):** set plans for two texts (ID-style example: one en text "translate into de", one fr text "annotate as-is"), upload the de translation, assign review, accept, assign annotation, choose final, export: each step's click count as in "Goals and targets"; remove de after an annotation started (confirmation lists the open task; after confirm the task is revoked and the row is "Not in plan"); "Needs your decision" excludes a failed check under review; same text label and identity across Documents, Progress and dialogs; annotator sees only pseudonyms of others; 390 px cards and 320 px reflow.
