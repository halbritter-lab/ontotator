# Lead workflow: work plan per language version, case selection, next step per row, bulk assignment, pipeline: design

Status: Approved by the user 2026-10-20 (decisions D1 to D21; D2, D11 and D12 corrected by the user 2026-10-20; work-plan flow D15 to D21 approved in the visual companion 2026-10-20; no open question remains); not implemented. Shaped with the impeccable `shape` playbook (discovery interview skipped: goals given by the user; domain questions were answered by the user, see "Decisions").
Sources: critique snapshot `.impeccable/critique/2026-10-20T08-45-58Z__frontend-src.md` (P1 "Assigning ignores row state", P2 "Lead orientation/naming", click counts), screenshots in `build/phase0-ux/evidence/critique-20261020/`, code in `frontend/src/admin`, `frontend/src/documents`, `frontend/src/tasks`, `src/ontocurator/{storage,exchange,domain,assignments}`, `.venv/Lib/site-packages/ontospan/models.py`.
Builds on: [Documents as the lead's table](2026-10-19-documents-lead-table-design.md) (called "the Documents spec" below). Its decisions 1 to 8 stay. Where this spec changes something that spec or the [quick-fixes spec](2026-10-19-quick-fixes-and-export-design.md) settled, it says so under "Changes to approved decisions".

**Mockups.** Approved (binding for layout and copy of the work-plan flow), in `.superpowers/mockups/lead-workflow-20261020/approved/` (copied from `.superpowers/brainstorm/59467-1792488444/content/`):

| File | Shows |
|---|---|
| `work-plan-flow.html` | The three planning flows and their clicks: import (0 extra), one language row (1 chip click), many texts (filter, select all, one action) |
| `work-plan-by-language.html` | Scenario: 50 cases, 20 × de and 30 × fr; "nothing planned" default; "Select by case IDs…"; plan dialog for 20 cases; annotate without review |
| `work-plan-shift-select.html` | Case selection by Shift-click range, Ctrl-click, keyboard |
| `work-plan-step3.html` | Plan dialog for several cases (keep → on → off cycle, "Will change", confirmation inside the dialog, result with Undo) |
| `work-plan-step4-assign.html` | Assign dialog for many cases (One person / Split evenly), result, later annotation batch via the bar |

Earlier, non-binding mockups (gitignored, same folder): `documents.html` (table, expanded row, 390 px cards), `assign-dialog.html` (single-row assign), `work-plan.html` (superseded by the approved files), `progress.html` (pipeline and people). Where any mockup and this spec differ, this spec wins; where an earlier mockup and an approved mockup differ, the approved one wins.

## Decisions (user, 2026-10-20)

| # | Question | Decision |
|---|---|---|
| D1 | Who sees display names of others | Only leads see "Display name (ann-000x)". Annotators and reviewers see only pseudonyms of other people. |
| D2 | What work a text needs | **Corrected by the user 2026-10-20.** Translations always come with the import; the lead does not choose which translations should exist. The lead sets a **work plan per text and per existing language version** (the source and each delivered translation) with two independent selections: **Review** and **Annotate**. Next steps, "To assign", Progress and the Documents row follow the plan. |
| D3 | Independent annotations per text | Project setting "Annotations per text", default 1. |
| D4 | Failed automatic check, no reviewer yet | Counts under "To assign"; the row shows a "Check failed" badge. |
| D5 | Rejected or queried translation | Lead options: (a) assign a new review, (b) correct it themselves, (c) discard this language version. Not "accept without review" (the plan-level acceptance of D20 is a different action for translations reviewed outside Ontocurator). |
| D6 | Annotation review by an adjudicator | Optional stage. |
| D7 | Landing | Lead lands on Documents of the last opened project, even with own open tasks; "My tasks (n)" in the nav. |
| D8 | Export | The preflight runs when the Export page opens; the download stays an explicit click. |
| D9 | Progress documents table | Removed; Progress shows stage cards and people; numbers link to filtered Documents. |
| D10 | Assign dialog default | Nobody preselected; best match sorted on top. |
| D11 | Annotate the source | **Corrected by the user 2026-10-20.** The source is one of the language versions in the plan; it has only "Annotate", no "Review". |
| D12 | Where translations come from | **Corrected by the user 2026-10-20.** Always delivered with the import from the external machine-translation pipeline. No "import translation" step, no "waiting for import", no request for target languages. A manual translation task is not needed now (see "Out of scope and future"). |
| D13 | Final results of versions that leave the plan | Kept in history, not exported. If the version returns to "Annotate", the lead must confirm the old final result (`PLAN_RESTORED`). |
| D14 | Remaining deviations from the approved 2026-10-19 specs | Approved: 6 instead of 7 columns; translation facts in the stage blocks; missing-final rule and export preflight only for rows planned for annotation; "final k of m" counts only rows planned for annotation. |
| D15 | Reference scenario | **Approved by the user 2026-10-20.** One package, 50 cases with several translations each; 20 cases → only de reviewed and annotated, 30 → only fr. About 13 clicks plus two pasted ID lists for the plan; import → assigned reviews ≈ 9–11 clicks per language batch. |
| D16 | Project default for imports | **Approved by the user 2026-10-20.** Selectable project setting: "Nothing planned" (every imported version arrives "Not in plan") or "Review and annotate all translations" (source annotated only when the text has no translation). The upload preview shows the default per language with the same Review/Annotate chips and can be changed before import. |
| D17 | Selection on Documents | **Approved by the user 2026-10-20.** The case checkbox selects the whole case; the header checkbox selects all filtered cases; Shift-click selects a range, Ctrl-click toggles one case; Space and Shift+↓ on the keyboard; the selection survives scrolling and paging. New "Select by case IDs…" dialog (paste a list, shows found / unknown). |
| D18 | Inline plan chips | **Approved by the user 2026-10-20.** Each language row shows "Review" and "Annotate" chips; a click toggles and saves at once, with an Undo toast (1 click per change). |
| D19 | Plan dialog for several cases | **Approved by the user 2026-10-20.** Rows = languages present in the selection with counts ("fr · 18 of 20"); cells cycle keep → ✓ on → ✕ off → keep; "mixed" shown when cases differ; live "Will change" summary; Save unavailable while everything is "keep"; a confirmation with a checkbox inside the same dialog only when existing work is affected (names open tasks and persons to be withdrawn, finals no longer exported). After save: Undo toast, the selection stays. |
| D20 | Annotate without review | **Approved by the user 2026-10-20.** Allowed when the package metadata marks the translation as reviewed. Otherwise the plan dialog shows how many are not marked and offers "These translations were reviewed outside Ontocurator — accept them as they are" with a required reason (recorded with person and time). That acceptance makes them eligible for annotation under `annotate_accepted_translations_only`. |
| D21 | Assign dialog for many cases and bar segments | **Approved by the user 2026-10-20.** Task preselected from the plan; "Distribute: One person \| Split evenly"; members sorted by language match, then fewest open tasks; ineligible people visible with the reason; a summary line; Split evenly assigns contiguous blocks in list order. Bar segments: Needs your decision · To assign · In progress; rows whose review is still running show "waiting for review". |

## Problem

A case is a set of clinical source texts. Cases are imported as packages together with their machine translations from an external pipeline; one package can hold dozens of cases with several translations each. Depending on the study, the lead has some translations checked and corrected by a bilingual reviewer, and has some language versions (source, translations, or both) annotated. Finally the lead chooses one result per text and language and exports. The lead runs this from Documents, Progress and Export.

Today:

- The app does not know what work a language version needs. Every row looks like it needs annotation; whether a German translation should be reviewed, or the English source annotated, is in the lead's head only.
- There is no fast way to act on many cases: selection is per row and version, one page at a time, with no range selection and no way to paste a list of case IDs.
- The lead has to work out each row's state from four columns of facts. Nothing says "what happens next, and who does it".
- Assigning ignores row state: the dialog always starts at "Annotation", shows no current assignee and no workload, and cannot split a batch between people. Six clicks per assignment.
- The lead lands on an empty My tasks.
- One person appears under three identities; one text under three names.
- "Needs your decision (1)" counts a failed automatic check although a review is already open on it.
- Progress mixes assignment counts and a second documents table; the pipeline is not visible.
- Rows repeat "v1 · Native", "None" and "No activity"; an empty Submissions table header appears in expanded rows.

## Users and context

- **Project lead** (primary): sets up the project, imports packages, decides per language version what needs review and annotation, assigns in batches, follows progress, decides on problems, chooses final results, exports. Desktop, sessions of minutes; often works from a list of case IDs prepared elsewhere. Sees display names of members.
- **Translation reviewer, annotator** (secondary here): affected by the shared text label in My tasks; they keep seeing pseudonyms for other people (D1).

Success: the lead imports a package, plans and assigns a batch of 20–50 cases in about a dozen clicks, then sees which rows need them and acts from the row in at most three clicks.

## Goals and targets

| Flow | Today | Target | This design |
|---|---|---|---|
| Land where the work is | Login → empty My tasks → Documents | 0 extra | 0 |
| Import with a fitting project default | — | 0 extra | 1 ("Import") |
| Change one language version's plan | not possible | 1 | 1 chip click (Undo in toast) |
| Re-plan many cases with one common action | not possible | 3 | 3: filter, header checkbox, bar action |
| Plan a batch from an ID list (one language) | not possible | — | 6: Select by case IDs…, Select n, Plan…, Review, Annotate, Save (+ paste) |
| D15 scenario: 50 cases, 20 × de, 30 × fr | not possible | ≈ 13 + 2 pastes | 1 import + 6 + 6 = 13, plus 2 pasted ID lists |
| Assign a planned batch to one person | 6 per row | 3 | 3: Assign…, person, Assign n |
| Assign a planned batch split between two | not possible | — | 5: Assign…, Split evenly, person, person, Assign n |
| Import → assigned reviews, one language batch | — | ≈ 9–11 | ≈ 9–11 |
| Later annotation batch | — | — | 5: "To assign", header checkbox, Assign…, annotator, Assign n |
| Assign translation review / annotation to one row | 4–6 | ≤ 3 | 3 |
| Choose final result | 4–5 | 2–3 | 2 (one submission) / 3 (several) |
| Confirm (keep) a final result after a change | 4 | — | 3 |
| Problem report decision | 6 + typing | 3–4 | 3 (+ typing where the intent asks) |
| Export final results | 4–5 | 2–3 | 3 without warnings (Export, Create, Download), 4 with warnings |

Click counts start where the lead already is and count activations, not typing, pasting or scrolling. The export download and the acknowledgement of export warnings are explicit by design (D8).

## Work plan

### What exists today (backend)

- `projects.languages`: the project's languages. No meaning of "needed".
- `documents`: one row per version with `case_id`, `external_id`, `language`, `version`, `origin` (`native`, `machine_translation`, `human_translation`, `correction`), `derived_from`, `translation` (jsonb run metadata) and `translation_status` (`translated`, `automatic_check_failed`, `ready_for_review`, `reviewed`, `accepted`).
- Translations arrive **by import** (T1 bundles, `exchange/uploads.py`, `exchange/t1.py`, `exchange/variant_plan.py`). At import a translation gets `automatic_check_failed` or `ready_for_review` from its checks. The upload preview offers "Accept without review" per translation with a required reason, for leads with the override right (`exchange/variant_overrides.py`).
- **Bundle metadata:** ontospan `Translation` has `provider`, `model`, `run_id`, `recipe`, `checks` — **no field that says the translation was reviewed**. ontospan models accept unknown fields (`extra="allow"`), so a newer pipeline can send one without breaking older readers.
- `projects.annotate_accepted_translations_only` (default **true**): a new annotation or annotation-review assignment on a translation whose version is not `accepted` is refused (`TRANSLATION_NOT_ACCEPTED`, `assignments/eligibility.py`). A translation review cannot be assigned on an `accepted` version.
- There is **no** notion of planned work, no target number of annotations, no discarding of a language version, and no case-level selection.

### Concept

A **language version** is one row of Documents: a case in one language (`case_id` + `language`), i.e. the source or a delivered translation with all its versions and corrections. The plan stores two independent flags per language version:

| Flag | Applies to | Meaning |
|---|---|---|
| **Review** | Translations only | This translation gets a translation review. |
| **Annotate** | Source and translations | This language version is annotated, gets a final result and is exported. |

| Review | Annotate | Behaviour |
|---|---|---|
| on | off | Translation review only; done when the translation is accepted. Not annotated, not exported. |
| off | on | Annotation without review. With `annotate_accepted_translations_only` **on** (default) the translation must be accepted: either the package marks it as reviewed (D20, imported as accepted), or the lead accepts it as "reviewed outside Ontocurator" with a reason, or it was accepted earlier. Otherwise the plan refuses this combination and offers that acceptance (see "Annotate without review"). With the rule **off**, annotation can start at once. |
| on | on | Rule on: annotation waits until the review accepts the translation (step "Waiting for translation review"; the row shows "waiting for review" in bulk assignment). Rule off: review and annotation can run in parallel; a correction accepted after a final result is chosen raises the existing `SELECTED_TEXT_CORRECTED`. |
| off | off | **Not in plan**: no step, not counted in the bar, Progress or the missing-final rule, not exported. |

- Parallel roots (two delivered translations into the same language) share the row's flags; review applies to each root's newest version.
- "Annotations per text" (D3), default 1, range 1–5, applies to every row with Annotate.
- Annotation review by an adjudicator is optional (D6): never planned; assignable from the row's More section or the assign dialog; while open it is the row's waiting step.

### Project default for imports (D16)

Settings › Workflow, **"Plan for imported texts"** (radio):

| Option | Effect on each newly imported language version |
|---|---|
| **Nothing planned** | Everything arrives "Not in plan"; the lead plans afterwards (approved scenario D15). |
| **Review and annotate all translations** (default for new projects) | Translations: Review on, Annotate on; source: Annotate on only when the case has no translation. Translations marked as reviewed in the package: Review off, Annotate on (they arrive accepted). |

- Existing projects keep their behaviour through the migration and get "Review and annotate all translations" as the setting (it only affects future imports; the setting says "Applies to texts imported from now on.").
- A translation delivered later for an existing case gets the default for its new row; existing rows keep their flags.

### Planning at import (upload preview)

The upload preview gains a step **"Work plan"** before "Import" (`approved/work-plan-flow.html` 1, `approved/work-plan-by-language.html` step 1):

- A table by language, prefilled from the project default: columns "Language", "Versions" ("in bundle"), "Review", "Annotate"; rows "Sources (50)", "de · MT (50)", "fr · MT (50)", "es · MT (50)". The cells are the same **Review / Annotate chips** as on Documents (pressed = on). The source row has no Review chip ("–"); its Annotate chip shows "✓ if no translation" under "Review and annotate all translations".
- Clicking a chip changes it for all versions of that row in this upload. "Adjust per case…" (disclosure) shows the same chips per case for exceptions.
- Primary "Import {n} cases" (or "Import {n} texts"); with the default fitting, this is the only click (0 extra).
- With the rule on, Annotate without Review on translations not marked as reviewed shows the count and the "reviewed outside Ontocurator" acceptance with reason inline (same as the plan dialog); "Import" stays focusable with `aria-disabled` and names the row until resolved.
- New language versions of existing cases are listed with the default; existing rows "keep their plan".

### Selection on Documents (D17)

See `approved/work-plan-shift-select.html` and `approved/work-plan-flow.html` 3.

- **Case checkbox** in each case's header row selects the whole case (all its language rows); dialogs then decide which languages are affected. There are no per-row bulk checkboxes any more; "Choose in Text versions" of the Documents spec is replaced by the plan (parallel roots share flags) and by the assign dialog counting versions.
- **Header checkbox** ("Select all {n} filtered cases") selects every case matching the current filters across all pages (server list of IDs, see API). Its label states the count; if more than 2000 cases match, it says "Select the first 2000" and the bar says so.
- **Shift-click** on a case checkbox selects the range from the last clicked case to this one, in the current list order (within the loaded page); **Ctrl-click** (Cmd on macOS) adds or removes one case without losing the range anchor.
- **Keyboard:** Space toggles the focused case checkbox; Shift+↓ / Shift+↑ moves focus to the next / previous case checkbox and selects it (registered with `useShortcut`, scope screen, group "Selection", described in `?` help).
- The selection is a set of case IDs that **survives scrolling, paging and filter changes**; the selection bar always shows "{n} cases selected", plus "{k} not shown with these filters" when applicable, and "Clear selection".
- **"Select by case IDs…"** (quiet button above the table; `approved/work-plan-by-language.html` step 2): dialog with a textarea "Paste case IDs" (separators: newline, comma, semicolon, space, tab; duplicates ignored; exact match after trimming and NFKC). Live result "20 found · 0 unknown"; unknown IDs listed (first 20, "and k more") with "Copy unknown IDs". Primary "Select {n}" replaces the selection (if a selection exists, the dialog shows "This replaces the current selection of 5 cases." and a checkbox "Add to the current selection instead"). 2 clicks plus the paste.

### Selection bar

Shown while at least one case is selected, sticky above the table (bottom-sticky below 700 px):

- "{n} cases selected" · the common next step when there is one ("next step: Assign translation review (de)") · "{k} not shown with these filters" · quiet "Clear selection".
- **Primary "Assign…"** (bulk assign dialog, D21). It is the page's only primary button.
- Plan actions (secondary): **"Review + annotate translations"** and **"Annotate only"** apply at once without a dialog when no existing work is affected (`approved/work-plan-flow.html` 3); **"Plan…"** opens the plan dialog. "Annotate only" sets Annotate on and leaves Review unchanged for all translations of the selected cases; with the rule on and translations not accepted it opens the plan dialog with the acceptance section instead of saving.
- Quick actions that affect existing work (only possible when they turn something off; the two one-click actions only turn flags on, except for `PLAN_RESTORED`) open the plan dialog's confirmation.
- After any plan save: Undo toast; the selection stays, so the next click can be "Assign…".

### Inline plan chips (D18)

Each language row has a **Plan** column with two chips, "Review" and "Annotate" (`approved/work-plan-flow.html` 2):

- A chip is a toggle button (`aria-pressed`), named "Review, case-0101 · fr" / "Annotate, case-0101 · fr"; pressed shows "✓ Review" on `success-light` with the check icon, unpressed shows "Review" outlined in `border-strong`, muted text (state never by colour alone: check icon and `aria-pressed`). The source row has only "Annotate".
- One click toggles and saves immediately (`PATCH`, see API). Success: the row's next step updates and an **Undo toast** appears: "fr of case-0101: Review off · Undo" (10 s, polite; Undo restores the previous flags with the returned revision).
- If the toggle would affect existing work (open tasks, a final result leaving the export, `PLAN_RESTORED`), the chip does not save; an `InlineConfirm` opens below the row with the consequence lines and the checkbox "I understand — withdraw the open tasks" where tasks are withdrawn (primary "Save").
- If the toggle makes an invalid combination (Annotate without Review on a not-accepted translation while the rule is on), the `InlineConfirm` offers "This translation was reviewed outside Ontocurator — accept it as it is" with a required reason (primary "Accept and annotate"), or Cancel.
- Busy: the chip keeps focus with `aria-disabled` and "Saving…" announced; errors appear as an inline message under the row with Retry; a stale revision says "This plan changed. Reloaded the current plan." and shows the current chips.
- Language rows that are not in plan are collapsed into one line per case, "en, fr, es not in plan · show"; "show" expands them (with their chips) inline.

### Plan dialog for several cases (D19)

See `approved/work-plan-step3.html` and `approved/work-plan-by-language.html` step 3.

- `Dialog size="md"`, title "Work plan · {n} cases".
- A table: columns "Language", "In selection", "Review", "Annotate". Rows = languages present in the selection: "Source (en) · 20", "de · MT · 20", "fr · MT · 18" (shown as "fr · 18 of 20" where not every case has the language), "es · MT · 17". Source rows group by source language ("Source (en, fr)" with counts) and have no Review cell ("–").
- Each cell is a **tri-state button** cycling on click: **keep** → **✓ on** → **✕ off** → keep. "keep" leaves that language exactly as it is in each case. When the selected cases currently differ, the keep state reads **"mixed"** instead of "keep" (title: "12 on, 8 off").
- **"Will change"** summary below the table, live: "de in 20 cases → review, then annotate after the review is accepted. Nothing else changes. 20 translation reviews and 20 annotations become 'to assign'." With the rule off: "… review and annotate in parallel."
- Footer: Cancel · primary "Save for {n} cases", focusable with `aria-disabled` and the reason "Nothing to change yet." while every cell is keep.
- **Confirmation inside the same dialog**, only when existing work is affected: the table stays (read-only), a warning block lists per language "fr has work in 3 of these cases. 2 open translation reviews will be withdrawn (Ana Weber, ann-0004 · Ben Roth, ann-0007). 1 final result (case-0108 · fr) stays in history but is no longer exported." with the checkbox **"I understand — withdraw the open tasks"** (required when tasks are withdrawn; when only finals are affected: "I understand"). Footer: Back · primary "Save for {n} cases" (unavailable until checked, with the reason).
- **Annotate without review (D20):** when a cell sets Annotate on for translations that are not accepted and Review is not on, the dialog shows below the row: "fr: 12 of 30 translations are not marked as reviewed in the package. Annotation needs an accepted translation." with the checkbox "These translations were reviewed outside Ontocurator — accept them as they are" and a required "Reason" field; "18 already marked as reviewed in the package metadata need nothing." "The acceptance is recorded with your name, the reason and the time." Save stays unavailable until the box is checked and a reason entered, or the lead turns Review on. Only shown while the project rule is on.
- After save: dialog closes, Undo toast "Plan saved for 20 cases · de: review + annotate · Undo", the selection stays (`approved/work-plan-step3.html` c). Undo reverts flags only; withdrawn tasks are not restored by Undo (the toast says "Undo restores the plan, not withdrawn tasks." when tasks were withdrawn), and an external-review acceptance is not undone by Undo (it is a recorded decision; reverting needs a new translation review).
- Opening "Plan…" with a single case selected shows the same dialog with "In selection" = 1 and the current values instead of keep/mixed.

### Annotate without review: acceptance record (D20)

- **From the package:** a translation whose bundle metadata says it was reviewed is imported as `accepted`, with an acceptance record `source = package`. The T1/ontospan `Translation` model has no such field today; this spec defines it as the optional object `translation.review = {status: "reviewed", reviewer?: str, reviewed_at?: datetime, note?: str}`, read through ontospan's `extra="allow"` until ontospan adds it formally (format 1.2; coordinated change in the pipeline and in ontospan). Any other value or absence means "not marked".
- **By the lead:** "reviewed outside Ontocurator" creates an acceptance record `source = lead` with person, reason and time, sets the newest version to `accepted`, and audits it. It is a translation acceptance, not a plan flag; it makes the version eligible for annotation under `annotate_accepted_translations_only`. It is distinct from "accept without review" (import override, unchanged) and is not offered in the Resolve options of a rejected or queried translation (D5).
- Text versions and Technical details show the acceptance: "Accepted: reviewed outside Ontocurator · Project lead (ann-0002) · 20 Oct, 11:40 · {reason}" or "Accepted: marked as reviewed in the package · {reviewer, date if given}".

### Editing after work started

Saving (chip, quick action or dialog) computes consequences first (server dry-run). Without consequences it saves at once. With consequences, the chip opens an `InlineConfirm` under the row, and the dialog switches to its confirmation step:

| Change | Consequence shown | What happens |
|---|---|---|
| Review on / Annotate on (no earlier work) | none | Next steps appear ("Assign translation review", "Assign annotation" or "Waiting for translation review"). |
| Review off with open review tasks | "2 open translation reviews will be withdrawn (Ana Weber, ann-0004 · Ben Roth, ann-0007)." | Open review assignments revoked; submitted reviews and corrections stay; translation status unchanged. |
| Annotate off with open annotation tasks | "1 open annotation will be withdrawn (Annotator, ann-0004; draft kept)." | Open annotation and annotation-review assignments revoked; drafts stay with their authors. |
| Annotate off with submissions or a final result | "1 final result (case-0108 · fr) stays in history but is no longer exported." | Nothing deleted; not exported while not planned (D13). |
| Annotate on where a final result existed before | "fr of case-0108 returns to the plan. Its earlier final result needs your confirmation." | Step "Confirm final result", cause `PLAN_RESTORED`. |
| Lower "Annotations per text" (Settings) | "4 rows have more annotators than the new target. Nobody is removed." | No revocation. |

- Each case's plan has a `revision`; a stale save fails with "The plan changed since you opened it. Review the current plan." Bulk saves are all-or-nothing; the conflict lists the cases.
- Every change is audited (who, when, old flags, new flags, withdrawn assignments, acceptances).

### Discarding a language version (D5 c)

"Discard the de translation…" (Resolve option of a rejected or queried translation) sets Review and Annotate off for that row with the consequences above and marks its translation versions as discarded (reason required). Nothing is deleted. A later import may deliver a new translation (new root) for the same language; the row then gets the project default again, shown in the upload preview.

### Migration of existing projects

- **Review** on for a translation row with any translation review (assignment ever started, or a `translation_reviews` record); off otherwise for rows with other work; never for the source.
- **Annotate** on for any row with annotation or annotation-review assignments, submissions or a final selection.
- Rows with no work: the project's new setting ("Review and annotate all translations") applied as at import.
- Existing accepted-without-review overrides become acceptance records `source = override` (read-only history).
- `annotations_per_text = 1`. Result per project written to the audit log. A row with work never ends up "not in plan".

## Concepts

### Stage

1. **Translation review** — Review on and the translation is not accepted.
2. **Annotation** — Annotate on and the row may be annotated (source; accepted translation; any translation when the rule is off).
3. **Final result** — Annotate on and all annotation work submitted (missing-final rule) or a final result exists.
4. **Done** — review-only row: translation accepted; annotate row: final result, nothing open, nothing to confirm.

### Next step

Every row in the plan has exactly one **next step** with an **owner**, derived on the server (one derivation for table, filters, bar, selection bar and Progress). First matching rule wins:

| # | Condition (row in plan) | Next step | Owner | Row action | Counts as |
|---|---|---|---|---|---|
| 1 | `OPEN_PROBLEM_REPORT` | Decide on problem report | You | "Decide on report…" | Decision |
| 2 | `TASK_PAUSED_WITHOUT_REPORT` | Resume paused task | You | "Resume task…" | Decision |
| 3 | Annotate on and an unacknowledged acknowledgeable cause on the final result (incl. `PLAN_RESTORED`) | Confirm final result | You | "Review changes…" | Decision |
| 4 | Review on, newest translation version rejected or queried, no open review | Resolve rejected translation / Resolve queried translation | You | "Resolve…" | Decision |
| 5 | Annotate on and the missing-final rule holds | Choose final result | You | "Choose final…" | Decision |
| 6 | Review on, translation needs a reviewer (`translated`, `automatic_check_failed`, `ready_for_review`, or a correction `ready_for_review`), no non-revoked review | Assign translation review (+ "Check failed" badge, D4) | You | "Assign translation review…" | To assign |
| 7 | Translation review open | Translation review in progress | Reviewer | none | In progress |
| 8 | Annotate on, stage annotation, fewer non-revoked annotation assignments than "Annotations per text" | Assign annotation ("1 of 2 assigned" when target > 1) | You | "Assign annotation…" | To assign |
| 9 | Annotation or optional annotation review open | Annotation in progress / Annotation review in progress | Assignee(s) | none | In progress |
| 10 | Annotate on, Review on, rule on, not accepted, nothing above | Waiting for translation review | — | none | In progress |
| 11 | Stage done | Done ("Translation accepted" for review-only rows) | — | none | — |

- A row matching several rules shows the first; "+1 more step" expands the row.
- Secondary line (muted, `size-sm`): "v1 machine translation · ready for review", "Source text · ready to annotate", "2 of 2 annotations submitted", "Round 1 · in progress", a report excerpt (60 characters) with reporter and "task paused", "Final: Annotation · Round 1 · Annotator (ann-0004)", "Review only · not annotated".
- Owner "You" is the lead viewing the page; another lead's own open task shows that lead's name.

### Bar (D21)

The bar counts rows in the plan. Segments: **All (n) · Needs your decision (n) · To assign (n) · In progress (n)** (`approved/work-plan-step4-assign.html` d). Needs your decision = rules 1–5; To assign = rules 6 and 8 (D4: failed check without reviewer is here, with its badge); In progress = rules 7, 9 and 10 (rows waiting for their review count here and show "waiting for review"). A failed check with an open review is "In progress", never a decision. The translation category under "Needs your decision" is "Translation rejected or queried". "No final result" moves from the bar to the filter "Final result: none" under More filters (unchanged semantics: rows with Annotate on and no final selection). Other bar rules of the Documents spec stay (project-wide counts, "k of n shown · Clear filters", segments mutually exclusive). Counts update on refetch (focus, own actions, every 60 s).

### Identity (D1)

- For leads: **"Display name (ann-0004)"** everywhere; own items "Display name (ann-0002, you)"; a lead's own step in the Owner column is "You". Without display name or for former members: the pseudonym alone.
- The username is never shown outside Settings › Members and Technical details. Shell header: "Display name (ann-0002)" with the role as a muted second line.
- Annotators and reviewers see their own display name and **only pseudonyms for other people**; the server fills `display_name` of others only for lead callers. Exports stay pseudonymous.

### Text label

**"{case ID} · {language}"** everywhere (Documents, Progress, My tasks, dialogs, report page, export preflight, confirmations, announcements), a version only where it matters ("case-0101 · de v2"). Document and external IDs move to Technical details.

## Screens

### Landing (D7)

- After login and on `#/`, a lead goes to **Documents** of the last project they opened (per-user `localStorage` key `ontocurator.lastProject.v1:{username}`; projects they no longer lead are skipped), else the first led project. Replace navigation. Also with own open tasks.
- Users who lead no project land on My tasks. Nav "My tasks (n)" (unsubmitted tasks; the shell calls `listMyTasks` once per session and on focus).

### Documents

Layout (desktop, compact density), top to bottom:

1. **Heading row:** `h1` "Documents"; at the right quiet "Upload texts…".
2. **Filters:** Language, **Next step** (grouped by stage), **Plan** (Review · Annotate · Review and annotate · Not in plan), Case ID; "More filters": Final result (any · none), Origin, Translation status, Status, Sort (Case ID · Import batch · Last activity).
3. **Bar:** segments as above; at the right "Updated 10:42 · Refresh". A quiet "Export final results…" link when the project has at least one final result.
4. **Above the table:** quiet "Select by case IDs…".
5. **Selection bar** (see above).
6. **Table.** Each case is a rowgroup; its header row: case checkbox, disclosure, "case-0101 · en source + 2 translations", "{n} decision(s)" warning badge, last activity. Language rows, 6 columns:

| Column | Content |
|---|---|
| Text · language | Row header: disclosure ("Show details, {case · language}"), language code, "source" for the source, "Open", "Open my task". |
| Plan | Review / Annotate chips (source: Annotate only). |
| Next step | Step, badges ("Your decision", "Check failed", "Paused"), secondary line, "+1 more step". |
| Owner | "You" (`weight-strong`), person, "2 annotators", or "—". |
| Action | One small secondary button for lead-owned steps. Name "{step}, {case · language}". |
| Last activity | As today. |

- Not-in-plan rows are collapsed per case into "en, fr, es not in plan · show".
- **Moved into the expanded row:** version and origin, Work, Final result, Issues and notes, translation status and acceptance.
- Ordering, paging (50 cases per page), group expansion, deep links and visit badges stay as in the Documents spec ("Changed: Work plan changed").

**Row actions:**

| Action | Behaviour | Clicks |
|---|---|---|
| Assign translation review… / Assign annotation… | Assign dialog for this row, task preselected | 3 |
| Choose final… | Expands the row. One eligible submission: its "Use as final" `InlineConfirm`; several: focus on Submissions | 2 / 3 |
| Review changes… | Expands the row and opens the Keep confirmation | 3 |
| Decide on report… | Report page, Decide section focused | 3 |
| Resume task… | Report page with `action=resume` | 2–3 |
| Resolve… (D5) | Translation block focused; options exactly: "Assign a new review…", "Correct the translation…" (existing flow), "Discard the de translation…" (reason, consequences as above). | 3 |

After success: the row updates in place, focus returns to the row's disclosure (or the Documents spec's focus target for final selections), the live region announces the result; under a segment filter the message offers "Next: {case · language}".

**Expanded row:** (1) pipeline blocks for the row's planned stages ("Translation review", "Annotation" with "0 of 2 assigned", "Final result"; review-only rows show one block plus "Not annotated in this plan"); each with status badge, people, times and links ("Text versions (n)", "Translation reviews", "Assignment actions", "Assign annotation review…"); current stage with accent top edge; report and source-change lines in an "Issues" list below. (2) **Submissions (n)** only when n > 0 or a final result exists. (3) **More**: Start consolidation…, Text versions (n) (discarded versions and acceptances labelled), Problem reports (n), Technical details (IDs, plan revision).

### Assign dialog

`Dialog size="md"` (below 700 px a full-height sheet). Two entry points, one dialog.

**From a row** (`assign-dialog.html`): title = the action ("Assign translation review"); context "{case · language}" and the version fact; "Currently" (who holds it; "1 of 2 annotators assigned"); task as text with "Change task"; members as below with radio (review) or checkboxes (annotation, up to the remaining target); footer Cancel · "Assign".

**From the selection bar, many cases** (`approved/work-plan-step4-assign.html`, D21):

- Title "Assign · {n} cases".
- **Task** line preselected from the plan: "Translation review · de · 20 versions" ("from the plan"). When the selection holds several assignable steps, a select lists them with counts ("Translation review · de · 20 versions", "Annotation · fr · 12 versions"); default = the step with most versions. Rows of the selection whose step is not this one are skipped and counted ("6 still in translation review: waiting for review, they join the next batch"; "4 not in plan for de").
- **Distribute:** segmented control "One person | Split evenly" (radio group).
- **Members table:** "Person · Reads · Open tasks" (+ "Gets" in Split evenly). Sorted: reads the task language(s) first, then fewest open tasks, then name. **Nobody preselected** (D10). People who cannot take the task stay visible, muted, with the reason inline ("does not read de", "Not an annotator in this project", "Already annotating 3 of these cases" — the latter still selectable; those cases go to the next person in Split evenly or are skipped in One person, stated in the summary).
- **One person:** radio per member. Summary: "Ana Weber gets 20 translation reviews (de). Her open tasks: 3 → 23."
- **Split evenly:** checkbox per member; "Gets" shows the live share; the cases are split into **contiguous blocks in the current list order** (the Documents sort), remainder to the first people in the members order. Summary: "Cases in list order: case-0101…0110 → Ana, case-0111…0120 → Ben." With "Annotations per text" > 1, each version needs that many distinct people: blocks rotate so every version gets n different people from the chosen ones; fewer chosen people than n → "Choose at least 2 annotators for 2 annotations per text."
- **Language mismatch** for a chosen person: warning in the summary; after Assign, the existing confirmation appears in the dialog above the footer ("Assign anyway").
- Footer: Cancel · primary "Assign {n}", `aria-disabled` with a reason until a choice exists.
- **Result:** the dialog closes; toast/announcement "20 translation reviews assigned to Ana Weber" (or "… split between Ana Weber (10) and Ben Roth (10)"); rows show "Translation review in progress · Ana Weber (ann-0004)"; bar counts update; the selection is cleared after a successful assign (the planned work is done for it) and the count of skipped cases stays selectable via "Select the 6 skipped cases" in the toast. Partial refusals keep the dialog open listing refused cases by case · language and person.
- The former "Propose distribution…" (seeded random proposal) stays reachable from this dialog as a quiet link "Random distribution…", not from the selection bar.
- Text versions' Reassign, Reopen and Remove keep their dialogs; member selects use the identity format and open-task counts.

### Problem report page (small change)

Entered from "Decide on report…": opens at "Decide" with its `h2` focused. After a decision: "Back to Documents" and, under a segment filter, "Next decision: {case · language}" (links only).

### Progress (D9)

Replaces "Totals" and "Documents"; People in a new form (`progress.html`).

- **Lede:** "{n} cases · {r} translations to review · {a} language versions to annotate ({k} not in plan)." plus links "{n} need your decision" and "{m} to assign", and the update time.
- **Stage cards** (ordered list, decorative arrows): Translation review (rows with Review on: To assign · In review · Check failed, with reviewer (subset) · Rejected or queried (your decision) · Accepted); Annotation (rows with Annotate on, with "1 annotation per text": Waiting for translation review · To assign · In progress · Paused by a problem report · Submitted); Final result (Not ready · To choose · To confirm · Final; footer "Export final results…" "(k final, m would be omitted)"). Each card: scope, done sentence ("2 of 7 accepted"), thin decorative bar, counts linking to filtered Documents; zero counts muted.
- **People:** "Person · Translation reviews open · Annotations open · Reviews open · Paused · Submitted", identity format, linked to Documents filtered by owner; sorted by open work.

### My tasks

"Document" becomes "Text" with the text label; Language column removed. Other people never appear. A lead reaching an empty My tasks sees "Go to Documents".

### Export (D8)

Preflight runs on opening Export ("Checking final results…"); "Check again" reruns it; final-selection changes rerun it when visible. Primary "Create final export"; warnings keep the acknowledgement. After the job: primary "Download final export" (explicit). Only rows with Annotate on are exported; rows with a final result but Annotate off are listed as "Not in plan, not exported" (information). Clicks: Export → Create → Download (3); with warnings 4.

### Settings › Workflow

"Plan for imported texts" (Nothing planned · Review and annotate all translations) and "Annotations per text" (1–5, default 1; hint "How many people annotate each text independently."). Lowering the number shows "Nobody is removed." Changing the import plan says "Applies to texts imported from now on."

## States

| State | Documents | Plan chips / dialog | Select by case IDs | Assign dialog | Progress |
|---|---|---|---|---|---|
| Loading | Skeleton rows, bar placeholder | Chip "Saving…" (`aria-disabled`); dialog "Checking consequences…" | "Looking up…" under the textarea | "Loading members…"; preview "Calculating…" | Skeleton cards |
| Empty | "No texts yet. Upload texts to start." | — | "Paste case IDs, one per line or separated by commas." | "No cases in the selection need this task." | "No texts yet" |
| Filter empty | "To assign": "Nothing to assign"; "In progress": "Nothing in progress"; "Plan: not in plan": "Every language version is in the plan." | — | "0 found · 20 unknown" (Select unavailable with reason) | — | Zero counts muted |
| Invalid | — | Acceptance offer with required reason | — | Reasons per member; "Choose at least 2 annotators…" | — |
| Error | Error + Retry | Inline error under the row / above the footer, choices kept; stale revision reloads with a message | Error + Retry in the dialog | Errors above the footer; partial refusals listed | Error + Retry |
| Narrow ≤ 700 px | Cards; case checkbox in the case card header; chips under the heading; selection bar bottom-sticky | Dialog full-height sheet; the table keeps three columns, language names wrap | Full-height sheet | Full-height sheet; members as list items with "Reads" and "Open" on a second line | Stacked cards |

**Narrow (Documents):** one `<article>` per language row inside a case card: heading "{case · language}", the two chips, next step (`weight-strong`) with badges, secondary line and "Owner: …", the row action full width (≥ 32 px), "Open" and "Details". Shift/Ctrl range selection is a desktop affordance; on touch, "Select by case IDs…" and the header checkbox cover bulk selection. Reflow verified at 320 CSS px.

## Copy

| Place | Text |
|---|---|
| Chips and plan | "Review", "Annotate", "✓ Review", "✓ Annotate", "en, fr, es not in plan · show", "Review only · not annotated", "✓ if no translation" |
| Undo toasts | "fr of case-0101: Review off · Undo", "Plan saved for 20 cases · de: review + annotate · Undo", "Undo restores the plan, not withdrawn tasks." |
| Selection | "Select all {n} filtered cases", "{n} cases selected", "next step: Assign translation review (de)", "{k} not shown with these filters", "Clear selection", "Select by case IDs…", "Paste case IDs", "20 found · 0 unknown", "Copy unknown IDs", "Select {n}", "This replaces the current selection of 5 cases.", "Add to the current selection instead" |
| Selection bar | "Assign…", "Review + annotate translations", "Annotate only", "Plan…" |
| Plan dialog | "Work plan · {n} cases", "Language", "In selection", "keep", "mixed", "fr · 18 of 20", "Will change:", "Nothing to change yet.", "Save for {n} cases", "fr has work in 3 of these cases.", "2 open translation reviews will be withdrawn (…)", "1 final result (case-0108 · fr) stays in history but is no longer exported.", "I understand — withdraw the open tasks", "Back" |
| Acceptance | "fr: 12 of 30 translations are not marked as reviewed in the package. Annotation needs an accepted translation.", "These translations were reviewed outside Ontocurator — accept them as they are", "Reason (required)", "18 already marked as reviewed in the package metadata need nothing.", "The acceptance is recorded with your name, the reason and the time." |
| Upload step | "Work plan", "Versions in bundle", "Adjust per case…", "Import {n} cases", "keeps its plan" |
| Assign many | "Assign · {n} cases", "Translation review · de · 20 versions", "from the plan", "Distribute", "One person", "Split evenly", "Person", "Reads", "Open tasks", "Gets", "does not read de", "Ana Weber gets 20 translation reviews (de). Her open tasks: 3 → 23.", "Cases in list order: case-0101…0110 → Ana, case-0111…0120 → Ben.", "6 still in translation review: waiting for review, they join the next batch", "Assign {n}", "Random distribution…" |
| Bar | "All (n)", "Needs your decision (n)", "To assign (n)", "In progress (n)"; category "Translation rejected or queried" |
| Steps | "Decide on problem report", "Resume paused task", "Confirm final result", "Resolve rejected translation", "Resolve queried translation", "Choose final result", "Assign translation review", "Translation review in progress", "Assign annotation", "Annotation in progress", "Annotation review in progress", "Waiting for translation review", "Done", "Translation accepted" |
| Row actions | "Decide on report…", "Resume task…", "Review changes…", "Resolve…", "Choose final…", "Assign translation review…", "Assign annotation…" |
| Resolve options | "Assign a new review…", "Correct the translation…", "Discard the de translation…" |
| Badges | "Your decision", "Check failed", "Paused", "Not in plan", "Discarded", "{n} decision(s)" |

No codes, no usernames in visible copy. Ellipses mark actions that open a dialog or a confirmation.

## Accessibility

- WCAG 2.2 AA; status never by colour alone (chips: check icon + `aria-pressed`; tri-state cells: "keep" / "mixed" / "✓ on" / "✕ off" as text; badges with shape).
- **Case checkbox** named "Select case-0101 (3 languages)"; header checkbox "Select all {n} filtered cases"; range selection announced ("20 cases selected"). Shift+↓/↑ and Space work without a mouse; Ctrl-click has a keyboard equivalent (Space on a single focused case). Listed in `?` help, group "Selection".
- **Chips:** `button` with `aria-pressed`, names include the row; Undo toast is a polite live region with a real button; the toast is placed right after the table in the DOM, its Undo button is reachable by Tab and by the shortcut Ctrl+Z while the toast is visible (registered with `useShortcut`, not active in text fields). The toast stays 10 s, longer while focused or hovered; it never takes focus.
- **Tri-state cells:** `button` with `aria-label` "{Review|Annotate}, {language}, {state}" and `aria-describedby` to the "Will change" summary; the cycle order is announced on first focus via the hint "Click to change: keep, on, off."
- **Assign many:** "Distribute" is a radio group; members table uses radios or checkboxes in the first cell with labels including name and the reason when unavailable (`aria-disabled` + `aria-describedby`, never native `disabled`); the summary line is a polite live region.
- Native tables with `th scope`; expanded rows as labelled `region`s; selection bar `region` "Selection".
- Targets ≥ 24 × 24 px (chips at least 24 px high; card main action ≥ 32 px). Forced colours: pressed chips get a `CanvasText` border and keep the check icon; the current pipeline block a `CanvasText` top border. No new motion beyond the 150 ms expansion; the toast appears without animation under reduced motion.

## Changes to approved decisions

| # | Approved in | Change | Status |
|---|---|---|---|
| 1 | Documents spec, "Shared rules": pseudonym on Documents | "Display name (ann-0004)" for leads; others see pseudonyms | Decided by the user 2026-10-20 (D1) |
| 2 | Documents spec, "Needs your decision" bar and decision 1 | Segments All · Needs your decision · To assign · In progress; failed checks without reviewer under To assign; "No final result" becomes a filter | Decided by the user 2026-10-20 (D4, D21) |
| 3 | Documents spec, "Changes elsewhere": Progress keeps totals and documents statistics | Stage cards and People | Decided by the user 2026-10-20 (D9) |
| 4 | Quick-fixes spec Q4: "Prepare final export" | Preflight on open; download explicit | Decided by the user 2026-10-20 (D8) |
| 5 | Documents spec, "Columns": seven columns with a Select column | Six columns (Text · language, Plan, Next step, Owner, Action, Last activity); facts in the expanded row | Decided by the user 2026-10-20 (D14, D17, D18) |
| 6 | Documents spec, expanded row "Issues" | Translation lines in the stage blocks | Decided by the user 2026-10-20 (D14) |
| 7 | Documents spec, missing-final rule; export preflight `MISSING_FINAL_SELECTION` | Only rows with Annotate on | Decided by the user 2026-10-20 (D13, D14) |
| 8 | Documents spec, "final k of m" | m = rows with Annotate on | Decided by the user 2026-10-20 (D14) |
| 9 | Documents spec, "Bulk selection": per-row/version checkboxes, "Choose in Text versions", selection reset on filter change | Case-level selection that survives paging and filters; header selects all filtered cases | Decided by the user 2026-10-20 (D17) |

## Backend and API

`contracts/openapi.json` and `frontend/src/api/generated.ts` are regenerated. Lead-only unless stated.

### Work plan, selection, acceptance (WP L0)

- **Data model** (migration `0016_work_plans`):
  - `work_plan_rows`: `project_id`, `case_id`, `language` (unique together), `review` (bool), `annotate` (bool), `updated_by`, `updated_at`, `created_at`. The source row never has `review = true` (validated in the save path).
  - `work_plans`: `project_id`, `case_id` (unique), `revision`.
  - `translation_acceptances`: `project_id`, `document_id`, `source` (`package` | `lead` | `override`), `reason` (required for `lead` and `override`), `accepted_by` (null for `package`), `accepted_at`, `upload_id` (for `package`/`override`), `metadata` (jsonb: reviewer, reviewed_at, note from the package).
  - `discarded_variants`: `project_id`, `document_id` (unique), `reason`, `discarded_by`, `discarded_at`.
  - `projects`: `annotations_per_text` (int, default 1, 1–5), `import_plan` (`nothing` | `review_and_annotate_translations`; default `review_and_annotate_translations` for new projects).
  - Data migration as described above.
- **Import:** `exchange/variant_plan.py` reads `translation.review.status == "reviewed"` (extra field on ontospan `Translation`, see D20) and imports such a version as `accepted` with a `package` acceptance. The upload preview returns per language and per case the default flags, the count of translations marked as reviewed, and validity; `commit` accepts plan overrides (by language row and per `(case_id, language)`), lead acceptances with reason, and the existing accept-without-review overrides.
- **Domain:** `domain/work_plans.py` (pure, unit-tested): default flags at import for both settings; validity under `annotate_accepted_translations_only`; tri-state merge (keep/on/off) over many cases; consequence computation (open assignments with assignee, finals leaving the export, `PLAN_RESTORED`); stage of a row.
- **Endpoints:**
  - `PATCH /projects/{key}/work-plans/{case_id}/{language}` `{review?, annotate?, expected_revision, confirm?: bool, accept_external_review?: {reason}}` → the row's new flags, the case revision, and `undo = {review, annotate, revision}`; 409 `WORK_PLAN_CONFIRMATION_REQUIRED` with consequences; 422 `WORK_PLAN_INVALID` (annotate without accepted translation, rule on) with the acceptance offer; 409 `WORK_PLAN_CHANGED`.
  - `POST /projects/{key}/work-plans/bulk/preview` and `PUT /projects/{key}/work-plans/bulk` `{case_ids, languages: {"de": {review: "keep"|"on"|"off", annotate: "keep"|"on"|"off"}, "source": {annotate: …}}, preset?: "review_and_annotate_translations" | "annotate_only", accept_external_review?: {languages: ["fr"], reason}, expected_revisions?: {case_id: revision}, confirm: bool}` → all-or-nothing; preview returns per language: cases in selection, current mixed counts, will-change summary, invalid counts (not accepted, not marked in package), consequences (tasks with persons, finals). `preset` is the one-click form of the selection bar (expanded server-side over every translation row of those cases). Response includes an undo payload (previous flags per row and new revisions).
  - `POST /projects/{key}/case-ids/lookup` `{ids: [...]}` → `{found: [...], unknown: [...]}` (exact match after trim and NFKC; max 5000 ids).
  - `GET /projects/{key}/document-rows/case-ids?{filters}` → all case IDs matching the filters (max 2000, with `truncated`), for the header checkbox.
  - `POST /projects/{key}/variants/{document_id}/discard` `{reason}`.
  - Project settings: `annotations_per_text`, `import_plan`.
- **Effects elsewhere:** eligibility refuses new `translation_review` on rows with Review off and new `annotate`/`review` on rows with Annotate off or discarded versions (`NOT_IN_WORK_PLAN`; retries and reopen bypass as today); `TRANSLATION_NOT_ACCEPTED` unchanged (lead and package acceptances set `accepted`); export and preflight only rows with Annotate on; `PLAN_RESTORED:{case}:{language}:{revision}` acknowledgeable.

### Bulk assignment (WP L1b)

- `POST /projects/{key}/assignments/batch/preview` `{task, language, case_ids (in list order), mode: "one"|"split", usernames}` → per case the target version(s) (newest version per root), skipped cases with reasons (`waiting_for_review`, `not_in_plan`, `already_assigned`, `step_differs`), per person the cases and new open-task totals, language mismatches, and the block layout for `split` (contiguous in the given order, remainder to the first people; rotation when "Annotations per text" > 1).
- `POST /projects/{key}/assignments/batch` with the same body plus `expected_preview_digest` and `confirm_language` → creates the assignments in one transaction using the existing assignment service (same refusals as `createAssignments`); returns created and refused rows.
- The selection bar's "next step" summary comes from `GET …/document-rows/selection-summary` `{case_ids}` → assignable steps with counts (task, language, versions), skipped counts.

### Next step, identity, counts (WP L1)

- `DocumentRowView.next_step = {code, kind: decision|assign|in_progress|done|none, stage, owner, action, more, detail}` plus `steps`; `plan_row = {review, annotate, review_applicable}`; group `plan_revision`.
- Bar: `needs_decision`, `to_assign`, `in_progress` (+ categories); `translation` excludes chains with an open review; filter `final=none` keeps the old "No final result" semantics.
- Query: `step`, `stage`, `owner`, `segment=decision|assign|progress`, `plan=review|annotate|review_and_annotate|not_in_plan`, `final=none`, `sort`; parser, serializer and `documents_*` passthrough.
- PersonRef `{pseudonym, display_name | null, is_me}` on work items, final summaries, submissions, rounds, report excerpts, progress people; display names of others only for leads.
- `Member.open_tasks: {translation_review, annotate, review}`; `TaskSummary.case_id`; progress `stages`.
- Landing, My tasks count, Export preflight on open: client only.

## Design system changes

- **Plan chip** (`ui/PlanChip`): toggle button with `aria-pressed`, check icon when pressed, `success-light` fill and `success` border when on, outline `border-strong` when off; sizes for table and card.
- **Tri-state cell** (`ui/TriStateButton`): cycles keep → on → off; shows "keep", "mixed", "✓ on", "✕ off" as text.
- **Toast** (`ui/Toast`, new): one polite region, bottom of the viewport, one toast at a time (a new one replaces the old); optional action button ("Undo"); 10 s, paused while focused or hovered; never takes focus; Ctrl+Z triggers its action while visible. DESIGN.md gains the component and the rule: toasts only for reversible saved changes with Undo; errors stay inline.
- **Case selection** in the grouped `DataTable`: `groupSelection` option (checkbox in the group header, range and toggle modifiers, keyboard), documented with the grouped table.
- **Segmented control** for "Distribute": the existing `.segment` class as a radio group.

## Out of scope and future

In-app machine translation and any request for translations (D12); translation review screen and its check block (separate spec); annotator term loop (T6b); export archive format; dark theme; new roles; drag selection; saved selections.

**Future: manual translation task (not built now, D12).** A later version may let a bilingual person translate a text in the app: a new task type `translate`, an editor with the source on one side and an empty target text on the other; submitting creates a new translation root with origin `manual` (distinct from the imported `human_translation`) and status `ready_for_review`, after which the normal translation review applies, optionally by a second reviewer. This spec does not block it: work-plan rows are keyed by `(case_id, language)`, not by a document, so a future flag "Translate" on a language without a version fits the same table; the next-step rules would gain "Assign translation" before rule 6; the `assignments.task` and `documents.origin` check constraints are the only schema points to extend.

## Work packages (rough)

| WP | Content | Size | Review |
|---|---|---|---|
| L0 | Work plan backend: migration (plan rows, revisions, acceptances, discards, project fields, data migration), import metadata `translation.review` and acceptance records, domain module, PATCH row / bulk preview + PUT (tri-state, presets, acceptance, undo payload), case-ID lookup and filtered case-ID list, discard, eligibility, export scope, `PLAN_RESTORED`; contract tests | L | yes (backend-critical) |
| L1 | Next-step derivation, bar segments (decision / assign / in progress), filters and sort, PersonRef, workload, `TaskSummary.case_id`, progress `stages`; contract tests | L | yes (backend-critical) |
| L1b | Bulk assignment preview and batch endpoints (one person / split evenly, contiguous blocks, rotation for n annotators, skip reasons), selection summary | M | yes |
| L2 | Shared `personLabel` and `textLabel`; apply everywhere | M | — |
| L3 | Documents table: case rowgroups with case checkbox, Plan column chips with Undo toast and inline confirmations, collapsed not-in-plan rows, 6 columns, row actions incl. Resolve, bar segments, filters; narrow cards | L | yes |
| L3b | Selection model: header select-all-filtered, Shift/Ctrl range, keyboard, persistence across paging and filters, selection bar with quick actions, "Select by case IDs…" dialog | M | yes |
| L4 | Expanded row: stage blocks, Submissions only when needed, acceptance and discard labels, Technical details | M | — |
| L5 | Assign dialog: single-row and many-cases modes, Distribute One person / Split evenly, sorting, reasons, summary, results and toast | M | yes |
| L5b | Plan dialog for several cases (tri-state, mixed, Will change, in-dialog confirmation, acceptance with reason), upload preview "Work plan" step with chips, Settings › Workflow fields | M | yes |
| L6 | Landing redirect, "My tasks (n)", My tasks text label | S | — |
| L7 | Progress stage cards and People | M | — |
| L8 | Report page focus/success links; Export preflight on open, plan-scoped preflight lists | S | — |
| L9 | `ui/PlanChip`, `ui/TriStateButton`, `ui/Toast`, grouped-table selection; DESIGN.md update | S | — |
| L10 | Browser verification of the D15 scenario and all flows with click counts, keyboard-only selection, 390/320 px, forced colours | M | per finished plan |

Order: L0 → L1 → (L1b, L2, L9) → (L3, L3b, L5, L5b, L6 in parallel) → L4 → L7 → L8 → L10.

## Testing

- **Unit (backend):** import defaults for both settings (cases with and without translations, translations marked as reviewed in the package, later-delivered translations); validity with the rule on and off; tri-state merge with mixed cases; consequence preview for every row of "Editing after work started"; acceptance records (package, lead with reason, override migration); migration cases; every next-step rule and precedence, parallel roots, failed check with and without reviewer, review-only rows done on acceptance, "Annotations per text" 1 and 2; bar segments; batch assign layout (contiguous blocks, remainders, rotation for n annotators, skip reasons); case-ID lookup (separators, duplicates, NFKC, unknown).
- **Contract:** no plan change withdraws work without `confirm`; bulk saves and batch assigns are all-or-nothing; invalid combinations refused; stale revisions refused; undo payload restores flags; discard never deletes documents; export and preflight equal on plan scope; Documents bar equals per-row step kinds; Documents and Progress counts equal.
- **Component:** chip toggle (save, Undo, busy, confirmation, acceptance offer); case checkbox with Shift/Ctrl and keyboard; header select-all-filtered; selection persistence; Select by case IDs (found/unknown, replace vs add); plan dialog (cycle, mixed, Will change, Save unavailable while all keep, confirmation checkbox, acceptance reason); assign many (task preselection, One person / Split evenly, sorting, reasons, summary, skipped cases); toast (one at a time, timeout pause, Ctrl+Z).
- **Browser (Playwright):** the D15 scenario with "Nothing planned": import 50 cases (1), select 20 by pasted IDs (2–3), plan de review + annotate (4–7), same for 30 fr (8–13); assign the 20 de reviews to one person (3 clicks) and split the 30 fr reviews between two (5 clicks); after accepting 14 de reviews, the annotation batch via "To assign" (5 clicks) while 6 show "waiting for review"; the default "Review and annotate all translations" import with 0 extra clicks; one chip click with Undo; turning fr off for cases with open reviews (confirmation names persons; tasks withdrawn); annotate without review with package-marked and lead-accepted translations; keyboard-only range selection; annotator sees only pseudonyms; 390 px and 320 px reflow.
