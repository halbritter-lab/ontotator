# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `CITATION.cff` and `.zenodo.json` with the citation metadata of the project, and a **How to cite** section in the README (#300).
- Test coverage reports in CI: `pytest-cov` writes `coverage.xml` for the Python tests and Vitest writes a V8 report (`npm run test:coverage`); both are uploaded as workflow artifacts. No thresholds are enforced (#301).
- Undo, redo and reset in the editor (#320): **Undo** and **Redo** in the header (with a tooltip naming the step, for example *Undo: delete finding Seizure*), `Ctrl+Z`/`Cmd+Z` and `Ctrl+Shift+Z`/`Cmd+Shift+Z`/`Ctrl+Y` outside text fields, and **More** › **Reset all my changes…**, which returns an annotation task to the start of its round (proposals open again, the carried findings, or no findings) after a confirmation; the reset is one undoable step. One step is one user action: the commands of an action share the new optional `step_id` of the mutation envelope. Each undo, redo or reset is saved as a new edit that puts a logged state back, so the history is built from the edit log of the current round and survives a reload; it starts after the last submit or server-side rewrite. `GET /api/v1/workspaces/{id}/history` describes the next undo and redo step, `POST /api/v1/workspaces/{id}/history` takes `{"command": "undo_step" | "redo_step", "step": n}` or `{"command": "reset_changes"}` (refusals: `HISTORY_STEP_UNAVAILABLE`, `HISTORY_NOTHING_TO_RESET`, `HISTORY_NOT_AVAILABLE` in a consolidation, all 422). The Undo messages after deleting a finding or removing a modifier use the same history while their action is the newest step. Migration 0033 adds `edit_events.step_id` and `drafts.initial_state` (the content a draft started with); both are nullable, so no existing row changes. The edit log export carries `step_id`. Clearing a dismissed carried finding after an undo now restores the finding from the history that is still in effect. The step view's `outcome` also names a layer step (`checked`/`unchecked`), an Edit & Replace copy (`copy`) and a carried finding that was checked or linked (`checked`/`linked`). The history reads only the edits of the current round and loads a logged state only when it needs it. The header buttons are named *Undo last change* and *Redo last change* for screen readers, apart from the **Undo** of a message; **Reset all my changes…** is unavailable, with the reason, while nothing changed.
- Final export: `findings.csv` has one row per finding of every selected and provenance submission, with the text and its version, the line of `source-texts.jsonl`, the submission and bundle entry, the pseudonym, layer, term ID and name, ontology release, one `value_<axis>` column per value field, the defaulted values, modifiers, how the finding came about (`origin`: `scratch`, `confirmed`, `changed`, `added`, `uncertain`, `carried`, or for a consolidation `matched`, `decided`, `added`) and its passages as `start-end`, joined by `+` within an interrupted passage and by `;` between passages, with the quoted text in the same form. A finding of the whole text has empty passage columns (#296).
- Final export: `agreement.csv` gives, per text version, the agreement of every two annotators of each text with a final result, computed with `ontospan.agreement`: strict and tolerant F1 per finding and per passage, term F1, modifier agreement and all counts. For a consolidated text it compares the submissions the consolidation merged, not work submitted after it; for a text accepted directly (the selected result is an annotation or a proposal check), the other people's latest annotations of it, which the export now carries in `compared-results.ontospan.zip` (`row_type` `compared` in `index.csv`, `compared_submission_ids` in the snapshot and in `receipt.json`). A text whose result was carried or consolidated from work on an earlier version also has rows for that version. `agreement-summary.csv` gives the project's mean over the texts (`macro_mean`) and the F1 of the summed counts (`pooled`), both empty when there is no pair. Only F1 values are given, since span annotation has no countable negatives (#295).
- Final export: `proposals.csv` counts, per tool and version as the imported bundle recorded them and per annotator, the proposals decided and how many were confirmed, rejected, changed or left uncertain, and the findings added without a proposal. Per tool it also gives precision and recall of its proposals against the selected final result of each text, with the tolerant matching of `agreement.csv`. Recall counts every text with a selected result on which an imported proposal set names the tool, also where the tool proposed nothing there: all final findings of such a text are misses. This includes a unit whose tool set holds no finding at all: the import now records such a set per text in the new table `empty_proposal_sets` (migration 0032) instead of dropping it; the text is still imported without a proposal set, and a set without findings never becomes the newest proposal set of a round. Texts imported before the migration have no such record, so a tool's silent texts among them are not counted (#297).
- README.txt of the final export and **What is in the file?** on the Export page name the new tables; `receipt.json` hashes them under `files` like every other file of the archive. The format stays `ontotator-final-export/v2`: nothing in the receipt changed shape.
- Final results as Phenopackets: on Export › **Final results**, **Format** › **Phenopackets (derived, lossy)** creates one GA4GH Phenopacket (schema v2) per text from the same check and accepted results as the final export, with the conversion of ontospan. The ZIP holds a report per text and a summary (`report.json`) of what was left out, such as findings about family members, uncertain findings and findings left unresolved in consolidation, a README.txt, and the selected results as an Ontospan bundle (`selected-results.ontospan.zip`), the same file as the final export's selected results of that check, with its SHA-256 in the receipt. Each feature's evidence refers to its finding in that bundle. Onset comes only from onset modifiers; a historical finding is exported like a current one and counted as `historical`. The Phenopacket and subject IDs are the document ID; texts of the same patient are not grouped yet. New job kind `final_phenopacket_export` (`format` on `POST /api/v1/projects/{key}/exports/final`, default `t1`), and `ontotator admin export PROJECT OUT --format phenopacket` exports the Phenopackets of the newest final export (#308).
- Blinded consolidation: Settings › Workflow › **Hide annotator names during consolidation** (off by default, leads only, recorded in the `project.update` audit entry). When it is on, a consolidator sees the annotators of a text as *Annotator A*, *Annotator B*, … in the order they submitted, instead of names or pseudonyms, in every payload about the round's inputs: the consolidation view (`people`, member `person_id`, `rejected_by`, new `annotators_hidden`), the round's inputs, the full editor's available inputs and the input submissions' history (author, provenance, decision and re-anchor reviewer ids become `annotator-a`, …). A person keeps their letter in later consolidation rounds of the same task; someone new gets the next letter. Snapshot versions and every id derived from them (round input ids, `input-…` annotation and evidence ids, target set ids, decision ids, `sub-…` submission ids, group ids, manifests) would let a consolidator recompute the author from the hash, so for a consolidator of such a project the server sends them as opaque tokens (`z` and a keyed permutation per user, from a secret kept in `instance_state`) and maps them back on every request; leads, system admins and downloads get the real values. Tool proposals keep their tool actor. Leads and exports still name everyone. Migration 0034 adds `projects.blind_consolidation` (`NOT NULL DEFAULT false`) and changes no existing row (#302).
- Project archives: a system administrator exports one complete project as a ZIP (`manifest.json` with format `ontotator-project-archive`, schema version 1, versions, per-file SHA-256 and row counts, one JSONL file per project table, the people it names and its stored files, with or without the ontology files) and imports it on another server as a new project, on the Projects page under **Project archives** or with `ontotator admin projects export-archive` and `import-archive`. The import renumbers every id, keeps immutable records with their timestamps, gives a taken key a suffix, refuses a changed archive, one of another database revision or one whose rows point to another project and checks every table against the manifest before it commits. People are matched by e-mail address (an archive carries the e-mail address only of people who worked in the project); the others become pseudonym-only people without login, which `ontotator admin users link-person` links to an account later. Work under annotator ids without an account is checked against the pseudonyms here as well, and `--rename-pseudonyms` changes only the fields that record who did the work, never texts. An archive never contains earlier archives or export results; the server deletes an exported archive after 24 hours (and every stored archive when an account is erased) and an uploaded one when its import ends. The import refuses archives that would expand beyond `ONTOTATOR_ARCHIVE_MAX_EXPANDED_BYTES` (default 8 GiB) or too far per byte (`ARCHIVE_TOO_LARGE`) and file names other than the archive's own, streams stored files to disk and writes them only after every check. Migration 0035 adds `imported_people` and changes no existing row (`/api/v1/admin/project-archives`) (#306).
- API tokens for scripts and integrations: `Authorization: Bearer ott_...` instead of a session. Personal tokens (Profile › **API tokens**) act as their owner; project tokens (Settings › People › **Project API tokens**) work in one project only, as the lead who created them; system tokens (**Server settings** › **API tokens**, administrators) are the only kind with the `admin` scope. Scopes are `read`, `import`, `export`, `project-admin` and `admin`; a token can do only what both its scopes and its owner's roles allow, never annotation work, and cannot create tokens. Tokens are shown once, stored as SHA-256 and expire after 1 to 365 days (default 90). Only the `Bearer` scheme selects a token, so a proxy's HTTP Basic auth header leaves browser sessions working. Bearer requests skip only the CSRF check; a request with both a token and the session cookie is refused. Every write with a token is audited with the token's id and name, as are creation and revocation, and a new or reset password, deactivation and anonymisation revoke all of the owner's tokens. A lost role revokes only the tokens it backed: losing the lead role in a project revokes the owner's project tokens there (unless the owner is a system admin), losing the admin role the system tokens and the project tokens of projects the owner does not lead; a personal token is kept and loses the role's rights at once, because every request checks the owner's current roles. Granting a role revokes nothing; the confirmation dialogs and Profile › **Change password** say what is revoked. A job's status is open to `read`, `import` and `export`, so a token can poll the import or export it started. Each operation in the OpenAPI contract names its scope (`x-ontotator-scope`, a list when any of several is enough). On the server: `ontotator admin tokens create|list|revoke`. Undo and redo in the editor are session-only; project archives are exported only with a system token and imported only in a browser session, and an archive never carries the `api_tokens` table. Migration 0036 adds the empty table `api_tokens` (`/api/v1/me/tokens`, `/api/v1/projects/{key}/tokens`, `/api/v1/admin/tokens`) (#305).
- MCP server `ontotator-mcp` in `mcp/`, a separate Python package that runs on the user's computer, speaks MCP over stdio and calls the API with an API token (`ONTOTATOR_URL`, `ONTOTATOR_TOKEN`); its tools read or write local files only inside the folders named in `ONTOTATOR_MCP_FILES_DIR` (symbolic links resolved) and refuse without it, while the other tools work. Its 37 tools set up a project (ontology and Babelon translation uploads, project creation, settings, task profile, pins, guideline, text and Ontospan proposal imports with a check before the commit, roles, assignments, work plan and annotation mode), report status (overview, progress per text and person, agreement per text) and handle results (start a consolidation, accept texts whose annotations agree in full, final, Phenopacket, annotation, edit log and translation review exports, job polling, downloads to a local path, and with a system token the project archive export and its download). Resources give the project settings, the current guideline and the README of a final export. Each tool names its token scopes and whether it changes data, with matching MCP annotations; tools that withdraw work, take roles away or assign many texts do a dry run unless confirmed. API refusals such as `TOKEN_SCOPE_MISSING` become tool errors with a remedy. No tool reads or writes annotation, review or translation review work. CI runs ruff, mypy and pytest for it (#309).
- API tokens after setup: a token reads its own record (kind, scopes, project, expiry, last use; never the secret) at `GET /api/v1/me/token` with any scope but `admin` alone, a project token included, so a pipeline sees when its token must be replaced. A project token with `project-admin` may now reassign, withdraw, remove and reopen tasks of its own project (`POST /api/v1/assignments/{id}/reassign|revoke|remove|reopen`); the routes find the task's project themselves and answer `PROJECT_NOT_FOUND` for another project's task.
- MCP server: `whoami` reports the token's kind, scopes, project and expiry with any scope but `admin` alone and warns two weeks before it expires; new tools for a cohort's accounts (`create_users`, which skips existing usernames and writes the setup codes to a local CSV file readable only by the user when `codes_path` is given, `issue_setup_codes`, `update_user`), for finding people to add (`find_people`), for changes while a project runs (`list_assignments`, `reassign_task`, `withdraw_task`, `remove_task`, `reopen_task`, and `hand_over_open_tasks`, which hands a leaving person's open tasks to others in turn after a dry run), for monitoring (`list_problem_reports`), and `withdraw_guideline` for a guideline version published by mistake, 49 tools in all. `start_export` takes a `request_id` for the final and Phenopackets exports, so a pipeline can repeat a call without a second export. [API and MCP case studies](docs/operations/api-mcp-case-studies.md) walk through a project's life with the scope and tool of each step and the remaining gaps.

### Changed

- Final export: the Ontospan bundles in the ZIP carry the time of the check they were made from instead of the time the job ran, also as the time of their ZIP entries, so exporting the same check again gives the same bundle files (#308).
- Final export: the result bundles in the archive are now named for what they hold and for their format, the Ontospan bundle: `selected-results.ontospan.zip` (was `selected.t1.zip`), `provenance-results.ontospan.zip` (was `provenance.t1.zip`) and the new `compared-results.ontospan.zip`. `archive_file` in `index.csv`, the file list and hashes under `files` in `receipt.json` and README.txt use the new names, and README.txt speaks of Ontospan bundles. The contents of the bundles do not change, and the format stays `ontotator-final-export/v2`; scripts that open the bundles by their old names need the new ones (#321).
- README and `docs/operations.md`: releases are tagged `vX.Y.Z` from `v0.1.0` on and follow Semantic Versioning; the image build fetches the public `ontospan` repository from GitHub, a token is optional, and only the build needs network access (#300).
- Text card: every remove action is called **Remove…** (it was **Remove assignment** in the version list and **Remove assignment…** in the Finalization warning); its dialog still says whether the assignment is revoked or removed with its draft. A submitted translation review or consolidation in the version list offers **Reopen…** like a submitted annotation, and no longer **Reassign…** (#329).
- Text card: the lead's steps stand where they act instead of in a row above the path. **Decide on report…** is in the problem report's notice next to **Open**; **Resolve…**, **Carry to v2…**, **Resume task…** and the other steps sit at the top of their part under *Next step*, and the card opens on that part when it is the row's first step. A stage's **Assign a new review…** and **Change final…** join the part's action row, so **Open result** and **Change final…** share one row (#332).

### Fixed

- The scientific workflow guide and the work package format no longer describe an `ontotator analyze` command, which never existed. They now describe the real exports: the files of the final export (`index.csv`, `findings.csv`, `agreement.csv`, `agreement-summary.csv`, `proposals.csv`, `receipt.json`), the annotation results bundle and the edit log (#299).
- Text card: the card no longer jumps up and down when you switch between **Translation**, **Annotation** and **Finalization** or open **History** or **Details**. From 700 px it hangs from a fixed top edge and only its height changes; from 1280 px it is up to 960 px wide instead of 760 px (#330).
- Text card at phone width: **Final result** lists the submissions one under the other, with **Open submission** and **Use as final** on their own line, instead of a table wider than the screen that hid both buttons (#333).
- Text card: the keyboard focus ring of the path segments is drawn inside the arrow, so the chevrons no longer cut it, and in white on the current (filled) segment, where it was invisible (#334).
- Text card: **History** and **Details** show their name as a heading next to **Back**, and a problem report under **Details** reads as its title, a line with who reported it, when, its state and the paused tasks, and **Open report**, instead of one comma-joined line (#335).
- Text card, **Translation**: the people of each version are person rows with the name, the task, a status pill in one column and **Reopen…** / **Remove…** on the right, as in **Annotation**, instead of a sentence with a remove button that wrapped onto its own line. **View text** is a button, the versions share the part's left edge without a second left rule, and **Older versions** groups parallel versions by chain (#329).
- Text card, **Finalization** and footer: the decision block is no longer a box inside the part, the table's first column, **How is this counted?** and **History** / **Details** sit on the part's edge, and **Remove…** in the warning about open annotations is a button instead of grey text. The part now has one edge plus the warning's inset instead of seven different left edges (#331).
- Text card: a stage without actions no longer leaves an empty block and an extra 16 px gap before the footer, and at phone width **Open text** and **Other languages** share one line, so the path starts about 50 px higher (#332).
- After a reviewer rejected or queried a translation, the lead can let the same person review it again: **Resolve…** offers *Reopen Ana Weber's review…* (with an optional reason), and in **Assign a new review…** the person shows *Review submitted* with **Reopen their review…** instead of a dead *Already assigned*. The stage actions under **Translation** offer **Reopen…** for a submitted translation review of the newest version, like for an annotation; the version list no longer offers **Reopen** for a submitted lead correction, which the server refuses. A reopened review starts from the version's current text with an empty form; the earlier decision stays in the history, and submitting **Accepted with corrections** creates the next version as usual. Assigning a translation review to someone whose review of that version is already submitted is refused with `ASSIGNMENT_ALREADY_SUBMITTED` (hint: reopen) instead of silently returning the old assignment; a still open assignment stays idempotent, and a batch skips the person as *already assigned*. **Assign a new review…** from **Resolve…** now assigns another reviewer to the rejected or queried version; before, its preview skipped the text for everyone (#340).

## [0.9.0] - 2026-11-04

### Added

- Working time: a lead can tick **Record working time** in Settings › Workflow (off by default; the change is kept in the project's settings history like the other rules). Annotation and translation review tasks then show the person working a timer of their own active time on the task, with **Pause timer** and **Resume timer**, and a one-time notice on their first task in the project. The timer pauses after 3 minutes without input (those 3 minutes still count) and while the tab is hidden, and goes on with the next input; a manual pause holds until **Resume timer** or a change to the work. The browser reports work intervals in batches (on pause and close, and a heartbeat every minute); the server keeps its own receipt times, ignores repeated items and ends an interval no later than 4 minutes after its last heartbeat, as `lost` when the heartbeats stopped. Progress shows **Working time** per task type (texts, total, median per text) without naming anyone, and **Export** › **Research data** › **Working time** writes the pseudonymised `<project>-work-time-<timestamp>.jsonl`, one line per interval plus a total per task, described in the scientific workflow guide. Migration 0031 adds `projects.record_working_time` and the append-only tables `work_time_events` and `work_intervals` (`GET`/`POST /api/v1/assignments/{assignment_id}/work-time`, `GET /api/v1/projects/{key}/work-time`, export kind `work_time`) (#298).

## [0.8.1] - 2026-11-02

### Fixed

- Documents below 1600 px: every stage state that would be cut has a short form, for example *1/2 submitted*, *to compare* or *on old text*, and the **Text** cell keeps *source*, the version marker and **NEW** on the same line, cutting a long case ID instead. The narrow table now starts at 1600 px instead of 1400 px, so the table fits the page at 1280, 1400 and 1440 px without sideways scrolling (#248, #279). The Annotation count no longer reads *2 of 1 submitted* when more people hold a text than *annotators per text* allows after the limit was lowered; it counts them all. With parallel translations it counts the people of one version, not the open tasks of all versions, so it reads *1 of 2 submitted*, not *1 of 3* (#248, #283).
- Documents below 1600 px: the robot icon no longer cuts the short state of the **Annotation** cell (*2/2 submit…*), and **Waiting on** cuts only the name, so *+n* stays visible (*Carla Consol… +1*).
- Opening the same task twice at the same moment, for example from two tabs, no longer answers 500: both opens get the same workspace (#272).
- A crash on a screen outside the editor, such as My tasks, Documents or Administration, no longer leaves a blank page. The screen reads *Something went wrong while displaying this page.* inside the shell, with **Reload page**, **Go to My tasks** and **Report a technical problem…**, which adds the error message to the report. Opening another screen clears it. The editor keeps its own crash screen with **Reload case** (#273).
- Translation review: checked-sentence marks are no longer lost with the review open in two tabs, on closing the tab or on **Reload from server**. A save sends the marks it was made from (`base` on `PUT /api/v1/translation-reviews/{assignment_id}/checked-sentences`), so the server applies only that tab's change and answers the stored marks, which the tab then shows. Waiting marks are sent when the tab closes, before leaving the review and before **Reload from server** reads the review again. A save without `base` replaces the marks as before (#284).
- Settings › Ontology, card **Translations**: who moved the project to the newest translations or ended its translations is no longer sent to every member as the login name (`user:<login>`) or the operating-system user of the command line (`cli:<name>`). Leads and system administrators see the person as display name and pseudonym, or *from the command line*; other members see only when. `by` on `frozen_translations.updated` and `history[]` is now a person reference or `null`, with the new `by_command_line` (#281).
- Package exports now carry the project's ended search conditions (`earlier_search_conditions`) and their captured translation files, so search events from before a move to the newest translations or a change of pins still name a condition in the package. Conditions a change of pins or profile before 0.8.0 deleted cannot be recovered: the export lists them in `unrecoverable_search_condition_ids` instead. Import checks that every search event names a condition of the package or a declared unrecoverable one (#282).
- **Use the newest translations** run twice around an upload can no longer write the older file back: a refresh that captured the files before the upload captures again, or reports that the project already uses the newest translations (#285).
- Practice projects no longer carry their owner's name: every one is called *Practice project*, so the `project.create` audit entry keeps no display name after the account is anonymised. Migration 0030 renames existing practice projects and rewrites `details.name` of their `project.create` entries; entries of real projects do not change (#280).
- Practice cleanup and failures: deactivating or anonymising an account, and the expiry sweep, now also remove the practice project's stored files once the change is committed. A second **Try it out** at the same time returns the practice project the first one built instead of an error. A practice project and its owner row are created in one transaction; the sweep removes a practice project left without one by an earlier crash, and the downgrade of migration 0029 counts it. **Reset…** checks first that a new practice project can start, so it no longer deletes the old one and then answers 409. A technical report sent from a practice task reads *A practice task* instead of naming the private project and text (`practice` on the technical report) (#286).
- Practice: the translation review step says that **Mark checked sentences** and **Show changes** must be off to edit the text. At phone width the practice group on My tasks shows the status under the task name, so **Start** no longer touches or clips the right edge (#287).
- After submitting an independent annotation, the read-only note reads *Read-only. To change it, use More › Work rounds.* instead of saying that only the project lead can reopen it. Consolidations, proposal checks and paused tasks keep the lead wording (#292).

## [0.8.0] - 2026-11-01

### Added

- Practice projects: annotators and translation reviewers can try the work in a private practice project with short, invented texts in German, from the card **New here? Try it out first** on My tasks or from Profile › Practice (**Start practice**, **Continue**, **Reset…**, **Delete…**). It has a task from scratch, one from proposals, a translation review and, for consolidators, a consolidation against two virtual colleagues. Each practice task shows a practice banner and the panel **Your practice**, whose steps tick themselves from the real work. Practice projects are never listed, counted or exported with real projects, admin rights do not reach them, and their audit entries are marked practice. They are deleted after 30 days without activity. Administrators see them on Projects with **Show practice projects** and can delete them; **Server settings** › **Practice projects** switches the offer off. Migration 0028 adds `projects.practice` and `practice_projects` and changes no existing row (`/api/v1/me/practice`, `/api/v1/admin/practice-projects`, `/api/v1/admin/settings/practice`) (#266).
- A lead or a system admin can move a frozen project to the newest translations with **Use the newest translations** in Settings › Ontology, at any time (`POST /api/v1/projects/{key}/translations/refresh`, `ontotator admin projects refresh-translations`). Findings do not change. The earlier search conditions are kept in the `project.translations_refresh` audit entry, so earlier searches stay resolvable, and the card lists them under **Earlier translations** (`updated` and `history` on `frozen_translations`). A change of pins or profile now also keeps the conditions it ends and their captured files, and re-importing a seed package with earlier conditions of the project is accepted (#254).
- Translation review: **Mark checked sentences** splits source and translation into sentences that the reviewer ticks off one by one, with Shift+click or a drag for a range, a counter in the head of each text and **Next unchecked**. A checked translation sentence that is edited later shows as *changed*. All text controls of the review now share one line above the texts, and **Compare** names the version in its tooltip. The mode is not offered on touch-only devices. The marks are a working aid saved with the draft (`checked_sentences` on the review workspace, `PUT /api/v1/translation-reviews/{assignment_id}/checked-sentences`); saving them does not start the task, and they are not part of the review, the exports or the lead's views (#256).

### Fixed

- Documents below 1400 px: the stage cells keep one line per text without cutting the state. They leave out the names that **Waiting on** already shows and read *not started* or *after review*; **Waiting on** shows one name and *+n*. The tooltip and screen readers keep the full text (#248).
- A change of pins or profile, such as a move to another ontology release, no longer deletes the project's search conditions and captured translation files. Searches and submitted selections made before the change stay resolvable; the ended conditions go into the `project.update` audit entry. Changes made before this version cannot be recovered (#254).

## [0.7.0] - 2026-11-01

### Added

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

[Unreleased]: https://github.com/phentrieve/ontotator/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/phentrieve/ontotator/compare/v0.8.1...v0.9.0
[0.8.1]: https://github.com/phentrieve/ontotator/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/phentrieve/ontotator/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/phentrieve/ontotator/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/phentrieve/ontotator/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/phentrieve/ontotator/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/phentrieve/ontotator/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/phentrieve/ontotator/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/phentrieve/ontotator/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/phentrieve/ontotator/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/phentrieve/ontotator/releases/tag/v0.1.0
