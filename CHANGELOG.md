# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Practice projects: annotators and translation reviewers can try the work in a private practice project with short, invented texts in German, from the card **New here? Try it out first** on My tasks or from Profile › Practice (**Start practice**, **Continue**, **Reset…**, **Delete…**). It has a task from scratch, one from proposals, a translation review and, for consolidators, a consolidation against two virtual colleagues. Each practice task shows a practice banner and the panel **Your practice**, whose steps tick themselves from the real work. Practice projects are never listed, counted or exported with real projects, admin rights do not reach them, and their audit entries are marked practice. They are deleted after 30 days without activity. Administrators see them on Projects with **Show practice projects** and can delete them; **Server settings** › **Practice projects** switches the offer off. Migration 0028 adds `projects.practice` and `practice_projects` and changes no existing row (`/api/v1/me/practice`, `/api/v1/admin/practice-projects`, `/api/v1/admin/settings/practice`) (#266).

## [0.7.0] - 2026-11-01

### Added

- Translation review: **Mark checked sentences** splits source and translation into sentences that the reviewer ticks off one by one, with Shift+click or a drag for a range, a counter in the head of each text and **Next unchecked**. A checked translation sentence that is edited later shows as *changed*. All text controls of the review now share one line above the texts, and **Compare** names the version in its tooltip. The mode is not offered on touch-only devices. The marks are a working aid saved with the draft (`checked_sentences` on the review workspace, `PUT /api/v1/translation-reviews/{assignment_id}/checked-sentences`); saving them does not start the task, and they are not part of the review, the exports or the lead's views (#256).

### Fixed
- **Technical problem…** in the sidebar and **Report a technical problem…** in the editor's **More** menu and on the crash screen send an error message, a page that does not load, a crash or general feedback to the system administrators, not to the project leads, and pauses no task. The user only describes what happened; Ontotator adds the app version, the task with its kind, project and text, the screen, the browser, the window size, the last refused API request and, from the crash screen, the error message. The dialog shows a reference such as `TR-12`. Administrators read the reports under **Administration** › **Technical reports** (with the number of open reports), mark them done or reopen them, and copy one into an issue by hand: nothing is sent out. Sending, closing and reopening are audited; erasing an account clears the browser of its reports. New endpoints `POST /api/v1/technical-reports` and `/api/v1/admin/technical-reports`; migration 0028 adds the `technical_reports` table only (#259).
- A translation file uploaded after a project froze its translations no longer reaches it silently. The upload result and the ontology inventory (**Frozen without**) name the projects that froze their translations without the file (`frozen_without` on the admin ontology list), and `ontotator admin ontologies add` names them on stderr. Settings › Ontology shows the frozen files in the card **Translations**, and the newer server files the project does not use (`frozen_translations` on the project settings). The freeze itself is unchanged (#254).

### Changed

- From the first click on **Edit & Replace**, the proposal reads **Being replaced** while its copy has no changes, then **Replaced**. The copy is indented under its proposal, reads *replaces this proposal* and shows *No changes yet* or what changed. The proposal's button reads **Open your copy** while the copy exists (#240).
- New project: allowed roots and annotation scheme filled from an uploaded profile say "Loaded from the profile." until you change them (#239).

### Fixed

- After **Edit & Replace** there is a visible way back: **Discard copy**, in the copy's details and in the proposal's details (key `0`), removes the copy and selects the open proposal again. A copy without changes goes at once; a changed copy asks first and names the changes. **Done, back to the proposal** removes a copy without changes (#257).
- Documents: an assigned translation review or annotation that nobody has saved yet reads *Assigned, not started* with the person's name, no longer *In progress*. A task starts with its first saved change; opening it does not. With several people or parallel versions the Translation and Annotation cells, the text card and the row's tooltip count them, for example *1 of 2 started* (`started` and `open_tasks` on the stage cell detail) (#258).
- The submit dialog names proposals left Unresolved, for example "34 findings, 1 unresolved, nothing open." (#248).
- Consolidation: a person who rejected the tool proposal a finding comes from is named so, for example "Tom Reis rejected the proposal.", instead of "has nothing here" (`ConsolidationGroupView.rejected_by`) (#248).
- The accept card of a consolidation names the groups left out of the result, for example "32 matching, 1 decided by Carla, 2 groups left out" (`ConsolidationOriginsView.left_out`) (#248).
- Problem reports name a task by its kind, text and owner instead of the internal task number, for example "Problems with case-107 de" and "Close and resume the annotation of case-107 de by Ana Weber (ann-0004)" (#248).
- After Assign, the confirmation appears once the refreshed rows are shown, no longer about 1.5 s before the row updates (#248).
- Documents: the *Resolve…* options of a row close when the filter, tab, order or page changes, as *Cancel* does. They no longer open again once the row is back on the page (#238).
- *Select by case IDs…* finds a case ID in another case, as the Documents search does: `fr100907` finds `Fr100907`. An exact match wins. Case IDs stay case sensitive, so when several case IDs fit and none exactly, the dialog lists them and asks for the exact ID instead of guessing (`case_insensitive` and `ambiguous` on the case ID lookup) (#237).

## [0.6.1] - 2026-10-31

### Fixed

- The Docker image bundles the handbook again: every chapter showed "Chapter not found". The image build now fails when the handbook is missing (#245).
- An Unresolved finding and its note stay visible to whoever decides: an Unresolved finding no longer counts as matching another annotator's finding, so it is never taken over automatically or accepted in one click. Compare, accept and review-changes cards list it with every person's note, the consolidation group is open and tagged **Unresolved**, and the export of the selected result keeps the note (`FinalPanelView.unresolved`, group kind `unresolved`) (#246).
- Term search: a hit that does not match the query closely is tagged **Weak match** and listed last (`weak_match` on the search candidates), and Enter adds it only after it was chosen with the arrow keys. If all hits are weak, the hint line says "no close match" (#247).

## [0.6.0] - 2026-10-31

### Changed

- Exports name the ontology release recorded with the work instead of the project's current one, and check each text against that release. When the texts of one export were made under different releases, the newest keeps the layer ID and each older one gets its own layer `<layer id>@<digest prefix>`; an export of one release keeps its shape (#81).
- The check before moving to another release also lists proposals on retired terms that an open draft still carries; they are never rewritten. Drafts of submitted work are no longer rewritten (#81).
- The assign dialog marks a skipped step as *(skipped)*, no longer as done, and stops counting annotation that waits for a skipped review. Steps keep their order (#233).
- History in the text card lists reassignments and mode changes with their reason (`changes` on the row submissions).
- My tasks clips a long paused reason to two lines; the full text stays in the task.

### Fixed

- After a move to another ontology release every task opened before it refused to open or save (`INVALID_SCOPE`), and consolidations and carries of earlier work were refused (`ROUND_INPUT_INVALID`). Stored workspaces now keep their identity across the move, with no repair needed (#81).
- *Remove from project* and removing the annotator role list and revoke open translation reviews too.
- *Distribute evenly…*: **Assign anyway** works after a partial save, a text still without anyone keeps its step open and is named, and the outcome of **Confirm** scrolls into view.
- After submitting, the next task is never a paused one.
- The final panel names the number of the *Needs your decision* tab, and says "in this view" while a filter hides other decisions.
- Reassigning started work says what really happens to the draft: it stays stored, but nobody can open it.
- The dialogs for reassigning, reopening and removing work, the member removal list and refused distribution rows name texts and people, not internal IDs.
- A text card outside the plan opens on Annotation, not on Finalization. "the 0 tool proposals" and "to from scratch" no longer appear; "Fixed: … has started" only appears once someone has. After a carry to a new version the round reads "continued from Round 1 of an earlier version". The final export's counts match its lists, with one row per text. A version chip no longer widens the Documents table at 1280 px. The offer to link a modifier's text span ends once it has one.

## [0.5.0] - 2026-10-31

### Added

- With *Annotate only after the translation review is accepted* on, a lead can assign annotators (one by one, in bulk and with *Distribute evenly…*) while the text's translation review is assigned or underway. The task shows in *My tasks* as *Waiting for translation review*, the server refuses to open, save or submit it (`TASK_WAITING_FOR_TRANSLATION_REVIEW`), and it opens by itself once the review is accepted, also on a corrected version. The review must run on that version or an ancestor: with parallel translations, the others are skipped with a reason. A task that cannot follow a correction (from proposals, paused, or on a correction that was rejected) shows *Waiting for the project lead*, and the lead withdraws it in *Handle text change…* (#213).
- Documents: **Show selected** in the selection bar lists only the selected texts, across pages and past the filters, with a chip; leaving it restores the filters and the page (`POST document-rows/selected`) (#210).
- Documents: **Assigned to** in the Filter popover shows the texts given to one person, in every task, open and submitted, without revoked assignments. It shows as a chip, stays in the URL and works with the selection (`assignee` on the rows, case IDs and selection filters) (#215).

### Changed

- Whoever creates a project gets only the Lead role, no longer every role; existing projects keep their members. **Add me as annotator** and a lead's self-consolidation add the other roles when needed (#177).
- Login without a remembered project: people without a lead role in any project land on **My tasks**, leads stay on **Projects** (#153).
- The assign dialog works through the whole selection: reviews first, then annotation, one language at a time. It stays open after each step and after *Distribute evenly…*, says what comes next, shows up front what the selection needs and where you are, and a step can be skipped with *Skip this task*. The closing message names what is left unassigned and offers to select those cases (#218).
- The Documents search finds any part of a case, external or document ID in any case (`fr100994` and `100994` find `FR100994`). The field now reads "Case ID…", since it never searched the words of a text (#216).
- A search without hits in the open tab says so and offers its hits under All, with the search kept (`all_tab_shown` on the decision bar) (#216).
- A task profile can set `allowed_roots` and `t1_profile` per ontology. New projects take them from the profile, in `admin projects create` and on the New project form; options and form values still win, and today's defaults apply only where the profile sets nothing. `[]` means the whole ontology, and the form says so. Hashes of profiles without the fields do not change (#208).

### Fixed

- Final result: findings that match but differ in a note, a text span or a modifier text span are named under the agreement, for example "Notes differ on 1 finding: Ataxia", and count in the Consolidate hint (`detail_differences` on the agreement) (#230).
- Edit & Replace: confirming a defaulted value on the copy, or a note that differs only in surrounding spaces, no longer marks the proposal as replaced (#231).
- Editor: the paused banner shows the reason in one line; **Show more** opens all of it (#232).
- Assign dialog: **This selection needs** lists every step (one task in one language), ticks the steps you are through and marks the current one (#233).
- Resolve rejected translation names who waits for the decision with an annotation task (#234).
- Handle text change: for a task from proposals, the dialog explains why only Withdraw is possible and what to do next (#235).
- Upload: the Work plan says to check it before importing, sources read "only cases without a translation", and the line next to the import button repeats the plan (#236).
- Editor: the paused banner has its own row under the toolbar; term hits stay visible with the search field in the stacked editor; the Sections panel closes on an outside click; save errors show their text at every width and keep the title. Documents: the header checkbox shows checked when every filtered text is ticked by hand, the distribution proposal names texts, not internal IDs, and the text card spaces its assignment actions. The Assign dialog names a failed load, a failed project list no longer leaves a loading line, and the Documents and My tasks counters update after a closed report or a submitted consolidation.
- An import no longer stops the project while it plans (#209). The preview takes no project lock, and the commit holds it exclusively only for the last part of the writes: about 15 to 19 s instead of over two minutes for 3,000 documents with 10 proposals each. These figures hold for proposal bundles; translation or correction bundles with many per-row updates were not measured. A project change behind the plan is still detected, and the import still applies fully or not at all. A commit also refuses (`UPLOAD_STALE`) when the work plan of a case in the upload changed since it planned: its work plan rows, or a translation review of that case assigned, submitted or decided in between. A commit request with work plan choices checks them against the stored preview instead of parsing the upload again.
- At a width of exactly 700 px the annotation editor collapsed to no width, so the Document tab showed no text (#144).
- The selection bar names what the filters hide, for example "4 texts in 2 cases selected (2 source texts not shown)", and the header checkbox counts texts, not cases (`text_count`, `not_shown_sources`) (#210).
- *Distribute evenly…* replaces the assign dialog instead of opening on top of it; the walk-through goes on from there (#210).
- An Edit & Replace copy is listed with the proposal it replaces, not under *Your own findings*, and the result line counts it as a replaced proposal (#211).
- A Documents row reads **Accept result…** only when submissions also agree on notes and modifier text spans, as the card does; otherwise it reads **Compare results…** (`all_match`) (#211).
- Opening the text list right after a bundle import no longer takes minutes and blocks the project: the query for each document's newest proposal set no longer depends on fresh planner statistics.
- One slow read or one queued writer can no longer stop a project or the instance (#217). Web requests wait at most 20 s for a lock (`ONTOTATOR_LOCK_TIMEOUT_MS`) and run a statement for at most 60 s (`ONTOTATOR_STATEMENT_TIMEOUT_MS`); a full connection pool fails after 10 s. All three answer 503 `PROJECT_BUSY` with `Retry-After`, the work is rolled back, and the user reads that the project is busy and nothing was changed. Jobs, the CLI, migrations and backups have no limit.
- `admin projects create --allowed-roots <id>=` allows every term, as its help says, instead of failing with exit 2 (#208).
- Changing the profile source or the file on the New project form no longer keeps branches, scheme and version chosen for the previous profile (#208).

## [0.4.0] - 2026-10-30

### Added

- The assign dialog marks system administrators with an *Administrator* badge (`system_admin` in the assignment batch preview), since the creator of a project is a member with every role (#177).
- The plain-text upload says that each file name without `.txt` becomes the text ID and which names are valid, and the preview lists file name → text ID (#174).
- Handbook screenshots in the in-app Help open at full size in a new tab (#173).
- The handbook in the app shows the running version and Git commit below its chapter list, for every logged-in user; `GET /api/v1/about` returns them. Published images carry the commit as `ONTOTATOR_REVISION`.
- `GET /api/v1/auth/session` answers 200 with the logged-in user or `null` and whether demo logins are offered. The login page uses it, so an anonymous visit no longer logs a failed `401 /auth/me` and `404 /auth/demo-logins` in the browser console (#198). `/auth/me` is unchanged.

### Fixed

- A finding added in the consolidation no longer keeps its default values unchangeable: its values open right after "Add finding" and "Edit values…" changes them later, so a negated finding is exported as absent (#178).
- The consolidation group card shows each person's passage when overlapping passages differ, and a ✓ chooses which one goes into the result (#159).
- The consolidation result line names no term and nothing as "Not taken" until the Term row is chosen (#160).
- The read-only consolidation view tags the kept passage and modifiers with "kept", not only the term and values (#163).
- "Open consolidation" in the text card opens the lead's own running consolidation as their task instead of the read-only view (#145).
- The consolidator sees the lead's consolidation reason above the groups and in My tasks (`consolidation_reason` on the consolidation view and the task list) (#146).
- The consolidation launcher says under "Consolidator" who is listed and links Settings → People (#147).
- The "Submit consolidation?" dialog tells a lead consolidator to accept the result in Documents (#143).
- The full editor of a consolidation has no submit any more; it points back to the consolidation screen, where you submit, and "Replaced by" explains itself (#162).
- "Delete finding" in the editor can be undone with "Undo" in the message or Ctrl+Z, like removing a modifier (#150).
- An unresolved proposal is counted as "unresolved proposal", not as confirmed, and its prefilled values read "Defaults not confirmed" (#148).
- A default on a dropdown value field (such as Experiencer) can be confirmed on its own with "Confirm" (#149).
- After "Move to a new finding" the new finding is selected, not the original (#151).
- A new finding without a text span shows the term's name in "Selected term:"; a carried one lists its note as "Reason for no text span", and re-creating a carried finding keeps its note (#157).
- The submit dialog says what happens to values left unconfirmed: submitted as shown, recorded as defaulted (#164).
- The Work rounds dialog says before "Continue from this submission" that the earlier submission no longer counts as submitted, what the lead sees, and that the new round must be submitted again (#152).
- The text problem dialog no longer keeps "Your task is paused" after "Resume my task" (#155).
- The sidebar's "My tasks (n)" updates right after a submit or a new work round (#156).
- The first-time guidelines notice names where the guidelines are: "More › Guidelines" in the editor, the header button in translation review and consolidation (#154).
- The keyboard shortcut help (`?`) in the editor also lists the finding keys, and in review modes the decision keys, while they need a selection first, marked "not available right now" (#158).
- **Refresh** on Documents starts a new visit of the tab, so rows that left it (for example texts just assigned under To assign) drop out instead of staying until a tab switch (#176).
- **Pinned by** on Administration › Ontologies opens the project's Ontology settings tab; small settings cleanups (#168).
- The final export leaves out texts without a final result only after a tick box that names the count (#194).
- The Finalization row reads "Accept result…" when all compared findings match (#198).
- Edit & Replace names what the copy changed ("Assertion: Present → Absent") next to "Replaced by" and has a "Done, back to the proposal" button (#198).
- A consolidation's note shows under the closed group in the list, not only after opening it; Undo updates the screen reader status (#198).
- The submit dialog no longer says only the lead can reopen a submitted task: it points to More › Work rounds, which annotators can use themselves (#197).
- After a submit, the next task is one of the same type when there is one, so a translation review leads to the next translation review (#198).
- Opening **My tasks** or **Projects** reloads the project list and the *My tasks (n)* count, so a project you were added to while logged in shows up without a page reload (#192).
- Documents, tab **All**: while texts not in plan are hidden, the toolbar says how many of the tab's texts the table holds, for example *246 of 307* (#198).
- The final-result links in the text card read **Open submission** instead of "Open in editor", since they open the read-only text view; the row's **Open** is named "Open text, …" for screen readers (#198).

### Changed

- The OpenAPI version comes from the package version instead of a second hard-coded number.

## [0.3.0] - 2026-10-30

### Added

- A public project page with tutorial videos lives in `site/` and deploys to GitHub Pages.
- Leads can change a text's annotation mode after submissions: "Change mode…" names whose submitted work is discarded, the work is kept as discarded (not deleted) and "Restore…" brings it back while no new annotation has started (#109).
- A started project can move to a newer ontology release after a dry-run check; draft terms with one successor or merged ids are rewritten (#81).
- The text card says how a consolidation came about ("6 matching, 2 decided by Carla"), and the final export records per finding whether it was matched automatically, decided or added by the consolidator (`consolidations` in `receipt.json`, export format `ontotator-final-export/v2`) (#133).
- User handbook, shown in the app and kept in sync with the code (#141, #179).
- Synthetic demo project with a guide and upload files (#175).

### Fixed

- HPO releases without a modifier classifier root (Clinical modifier, Frequency, Severity, Onset) are refused (#97).
- The consolidation's duplicate-term warning fires only for findings of the same term on overlapping spans (#132).
- A lead can accept a result before every planned annotator has submitted; a translation review leads on to the next task (#136).
- The consolidation saves Add finding with the search made for it (#172).
- The task profile wins over the project's spanless setting (#130).

### Changed

- The Upload texts dialog is redesigned (#135).
- The text card shows one row per person (#139).
- The Users table folds each person's projects behind a count (#180).
- Clearer lead assign and member UI (#134).
- Deployment runbook for a pinned proxy network and managed hosting (#131).

## [0.2.0] - 2026-10-28

### Added

- `admin ontologies add --sha256` verifies an ontology file before import (#118).
- `admin ontologies check-roots` lists projects whose allowed roots are missing from their pinned release (#118).
- Three-letter HPO translation language codes such as `dtp` and `nna` (#118, migration 0025).
- Contributing guide, changelog, code of conduct and issue/PR templates (#126).

### Fixed

- Upload and background job robustness (#115).
- Ontology release, translation and term search issues (#118).
- Lead pseudonyms, result line punctuation and term search over-matching (#117).
- Issuing a password reset code now ends the user's sessions (#116).
- Query cost and lock-time issues, with new indexes (#114, migration 0024).
- Flaky Playwright tests, fixed at their root causes (#119).

### Changed

- Public documentation is in English and project-neutral (#122).
- Frontend linting with ESLint (#116).
- CI builds the Docker image on pull requests (#120); images are published to GHCR from a separate tag-only workflow (#121).
- GitHub Actions dependency updates (#110, #111, #112, #113).
- New findings must come from the project's allowed ontology roots; the editor search only offers those terms (#118).
- Repository cleanup for public use (#126).

## [0.1.0] - 2026-10-28

First public release.

[Unreleased]: https://github.com/halbritter-lab/ontotator/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/halbritter-lab/ontotator/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/halbritter-lab/ontotator/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/halbritter-lab/ontotator/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/halbritter-lab/ontotator/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/halbritter-lab/ontotator/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/halbritter-lab/ontotator/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/halbritter-lab/ontotator/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/halbritter-lab/ontotator/releases/tag/v0.1.0
