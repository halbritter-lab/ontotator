# API and MCP case studies

These case studies follow a lab through the life of its annotation projects, using only the HTTP API with [API tokens](../operations.md#api-tokens) and the [MCP server](../../mcp/README.md). Each step names the API route, the token scope the route needs (`x-ontotator-scope` in `contracts/openapi.json`, enforced by `src/ontotator/api/token_scopes.py`) and the MCP tool that calls it. They were written against the code, not against earlier documentation, to find what a script or an assistant cannot do yet.

Status in the tables:

- **covered**: the route and the MCP tool are on `main` already, including the API tokens (#323), the MCP server (#324), the project archive (#325), the Phenopacket export (#322), the blind consolidation (#326) and undo in the editor (#327).
- **added in this PR**: added with these case studies (route, scope rule, MCP tool or tool argument).
- **remaining gap**: still missing; the last section says why each one was left.

A token can only do what both its scopes and its owner's roles allow, so the scope is necessary but never sufficient. Paths below are relative to `/api/v1`; `P` stands for `/projects/{key}`.

## The lab

The renal genetics group of a university hospital runs Ontotator on its own server. Dr. Weber is a system administrator; Dr. Lang leads the projects. Texts are clinical letters in German and English. Proposals come from Phentrieve, which a pipeline in the group's CI runs every night. The group uses:

| Token | Kind | Scopes | Used by |
| --- | --- | --- | --- |
| `weber-admin` | system | `read`, `admin` | Dr. Weber's MCP client, for accounts, ontologies and new projects |
| `lang-mcp` | project (`nephro-2027`) | `read`, `import`, `export`, `project-admin` | Dr. Lang's MCP client for the daily work in one project |
| `ci-import` | project (`nephro-2027`) | `import` | The nightly proposal import |
| `ci-export` | project (`nephro-2027`) | `read`, `export` | The nightly export to the research data warehouse |

## 1. A new project from scratch

Dr. Weber sets up `nephro-2027`: HPO with German translations, a guideline, five people and the first 200 letters with Phentrieve proposals.

| Step | Route | Scope | MCP tool | Status |
| --- | --- | --- | --- | --- |
| Check the token and its expiry | `GET /me/token`, `GET /auth/me`, `GET /about` | any but `admin` alone, project tokens included (#351) | `whoami` | added in this PR (token record and expiry warning) |
| Upload the HPO release and the Babelon translation | `POST /admin/ontologies/upload-results` | `admin` | `upload_ontology_files` | covered |
| See the releases and their SHA-256 | `GET /ontologies` | `read` | `list_ontologies` | covered |
| Choose a template | `GET /projects/templates` | `read` | `list_project_templates` | covered |
| Create the project with pins | `POST /projects/` | `admin` | `create_project` | covered (system token only, as in the web interface) |
| Settings: two annotators per text, consolidator not an annotator, working time | `PATCH P/settings` | `project-admin` | `update_project_settings` | covered |
| Task profile from a file | `PUT P/profile` | `project-admin` | `set_task_profile` | covered |
| Publish the guideline | `POST P/guidelines` | `project-admin` | `publish_guideline` | covered |
| Withdraw a guideline published by mistake | `GET P/guidelines`, `POST P/guidelines/{version}/withdraw` | `read`, `project-admin` | `withdraw_guideline` | added in this PR |
| Accounts for five people, with setup codes | `GET /admin/users/`, `POST /admin/users/` | `admin` | `create_users` | added in this PR |
| Hand the setup codes over | none: the server sends no mail | | `create_users` with `codes_path` writes a private CSV | remaining gap (by design) |
| Add an existing colleague | `GET P/member-candidates`, `PUT P/members/{username}` | `project-admin`; `read`, `project-admin` | `find_people`, `set_member_roles` | added in this PR (`find_people`) / covered |
| Stage and check the letters with proposals | `POST P/uploads`, `GET /jobs/{id}`, `GET P/uploads/{id}` | `import` | `upload_texts`, `get_upload` | covered |
| Import exactly the checked upload | `POST P/uploads/{id}/commit` | `import` | `commit_upload` | covered |
| Work plan: annotate German texts from proposals | `POST P/work-plans/bulk/preview`, `PUT P/work-plans/bulk` | `read`, `project-admin` | `update_work_plan` | covered |
| Give every text to two annotators | `GET P/document-rows/case-ids`, `POST P/assignments/batch/preview`, `POST P/assignments/batch` | `read`, `project-admin` | `distribute_texts` | covered |
| Create a project token for daily work | `POST P/tokens` | session only | none | remaining gap (by design) |

Verdict: **sufficient**. Before this work, accounts and setup codes needed the web interface, which broke the flow for an administrator working in an MCP client. Handing the codes to people stays outside Ontotator.

## 2. A cohort of 30 annotators for the winter term

Thirty medical students join `nephro-2027` for three months. Dr. Weber gets a spreadsheet of names and e-mail addresses.

| Step | Route | Scope | MCP tool | Status |
| --- | --- | --- | --- | --- |
| Create 30 accounts with languages and the annotator role in the project | `GET /admin/users/`, `POST /admin/users/` (with `projects`) | `admin` | `create_users` with `project` | added in this PR |
| Repeat the call after a network error without duplicates | (tool reads the user list first) | `admin` | `create_users` skips existing usernames | added in this PR |
| One bad row does not stop the others | | | `create_users` reports `refused` per person | added in this PR |
| Keep the 30 codes out of the conversation | | | `codes_path`: CSV, mode 0600, inside `ONTOTATOR_MCP_FILES_DIR` | added in this PR |
| Renew codes that lapsed after 24 hours | `POST /admin/users/{username}/reset-code` | `admin` | `issue_setup_codes` (only for people who never set a password, unless asked) | added in this PR |
| Who has not activated the account yet | `GET /admin/users/` (`setup_pending`, `last_login_at`) | `admin` | `list_users` | covered |
| Give existing accounts a role in the project | `PUT P/members/{username}` | `project-admin` | `set_member_roles`, one call per person | covered (no bulk route; remaining gap: minor) |
| Share the 200 letters among the 30 | `POST P/assignments/batch` (`mode: split`) | `read`, `project-admin` | `distribute_texts` (at most 50 people per call) | covered |

Verdict: **sufficient after this work**. Remaining: no bulk membership route for accounts that already exist (one call per person), and `GET /admin/users/` has no paging, which matters only for installations with thousands of accounts.

## 3. A running project: new letters, a leaving annotator, a new consolidator

In week six, 80 new letters arrive, one student leaves for a clinical rotation, and Dr. Lang adds a second consolidator and requires that consolidators did not annotate the text.

| Step | Route | Scope | MCP tool | Status |
| --- | --- | --- | --- | --- |
| Nightly import of new letters (project token `ci-import`) | `POST P/uploads`, `POST P/uploads/{id}/commit`, `GET /jobs/{id}` | `import` | `upload_texts`, `commit_upload` | covered |
| A letter that changed: new version of an existing text | `POST P/uploads` (collisions in the check), `POST P/text-changes/preview` | `import` (the preview also `project-admin`) | `upload_texts` shows `collisions` | covered |
| Distribute the new texts only | `POST P/assignments/batch` with `case_ids` | `read`, `project-admin` | `distribute_texts` with `case_ids` | covered |
| List the leaving person's tasks | `GET P/assignments?username=` | `read` | `list_assignments` | added in this PR |
| Hand the open tasks to two others in turn, dry run first | `GET P/assignments`, `POST /assignments/{id}/reassign` | `read`, `project-admin` | `hand_over_open_tasks` | added in this PR |
| Same with a project token | `POST /assignments/{id}/reassign` | `project-admin` (project token now allowed; another project's task gets `ASSIGNMENT_NOT_FOUND`, #351) | `reassign_task` | added in this PR (route rule and tool) |
| Withdraw, remove or reopen a single task | `POST /assignments/{id}/revoke`, `/remove`, `/reopen` | `project-admin` | `withdraw_task`, `remove_task`, `reopen_task` | added in this PR |
| Deactivate the account afterwards (sessions end, tokens revoked) | `PATCH /admin/users/{username}` | `admin` | `update_user` | added in this PR |
| Add a consolidator | `PUT P/members/{username}` (`adjudicator`) | `read`, `project-admin` | `set_member_roles` | covered |
| Consolidators must not have annotated the text | `PATCH P/settings` (`adjudicator_not_annotator`) | `project-admin` | `update_project_settings` | covered |
| Hide the annotators' names during consolidation | `PATCH P/settings` (`blind_consolidation`) | `project-admin` | `update_project_settings` | covered (#326) |
| Three annotators per text from now on | `PATCH P/settings` (`annotations_per_text`) | `project-admin` | `update_project_settings` | covered |
| Start a consolidation by the new consolidator | `GET P/document-rows/.../final-panel`, `POST P/consolidations` | `read`, `project-admin` | `start_consolidation` | covered |
| A translation reviewer for the English versions | `POST /admin/users/` (`qualification`), `POST P/assignments` (`task: translation_review`) | `admin`; `project-admin` | `create_users`, `assign_texts` | added in this PR / covered |
| Switch texts that already have work from proposals to scratch | `POST P/annotation-mode-changes/preview`, `POST P/annotation-mode-changes` | `project-admin` | `change_annotation_mode` (preview names the discarded submissions; `confirm`) | covered (#346) |
| Undo that mode change | `GET P/annotation-mode-changes`, `POST P/work-plans/bulk/preview`, `POST P/annotation-mode-changes/{id}/restore` | `read`, `project-admin` | `list_annotation_mode_changes`, `restore_annotation_mode` | covered (#346) |
| Undo a work plan change | `PUT P/work-plans/rows` (`undo`) | `project-admin` | `undo_work_plan` with the `undo` of `update_work_plan` | covered (#346) |
| A text gets a new version while it is being annotated | `POST P/text-changes/preview`, `POST /assignments/{id}/move-to-version`, `/text-change-resolution`, `POST P/submissions/{id}/carry` | `read`, `project-admin` (the preview also opens to `project-admin` now; project tokens reach the task routes, #345) | `move_task_to_version`, `handle_text_change`, `carry_submission` | covered (#345, #346) |
| Start a task's round again: carry forward or clean restart | `GET /assignments/{id}/rounds`, `/round-sources`, `POST /assignments/{id}/rounds` | `read`, `project-admin` | `start_new_round` | covered (#346) |
| Problem reports filed by annotators | `GET P/problem-reports` | `read` | `list_problem_reports` | added in this PR (listing) |
| Pause more tasks, release, restart empty or resolve a report | `GET /problem-reports/{id}`, `/pause-candidates`, `POST /problem-reports/{id}/actions` | `read`, `project-admin` | `act_on_problem_report` | covered (#346) |
| A translation reviewer or the lead corrects a rejected translation; discard a translation | `POST P/documents/{doc}/translation-correction-assignment`, `/lead-correction`, `POST P/variants/{doc}/discard` | `read`, `project-admin` (lead correction no longer session only, #345) | `request_translation_correction`, `start_lead_correction`, `discard_translation` | covered (#345, #346) |
| Choose or change the final result of one text | `GET P/document-rows/{case}/{language}/final-panel`, `PUT P/final-selections` | `read`, `project-admin` | `set_final_result` (dry run, `expected_revision`) | covered (#346) |

Verdict: **sufficient after this work**. Before it, the most common change of a running project, a person leaving, needed the web interface for every task, and a project token could not reassign at all because the task routes have no project in their path.

## 4. A new ontology release, other exports, the end of a project

HPO publishes a new release in month four. The data warehouse later also wants the edit log and the results as Phenopackets. At the end of the year the project closes and is moved to the institute's long-term server.

| Step | Route | Scope | MCP tool | Status |
| --- | --- | --- | --- | --- |
| Upload the new release and translation | `POST /admin/ontologies/upload-results` | `admin` | `upload_ontology_files` | covered |
| Which projects use which file; who froze translations | `GET /admin/ontologies/` | `admin` | `list_ontology_files` | covered |
| Dry run of the move: pins, draft terms rewritten or flagged, submitted work counted | `POST P/pins/preview` | `project-admin` | `set_ontology_pins` without `confirm` | covered |
| Apply exactly that dry run | `POST P/pins/apply` (with `report_sha256`) | `project-admin` | `set_ontology_pins` with `confirm` | covered |
| Move to the newest translations | `POST P/translations/refresh` | `project-admin` | `refresh_translations` | covered |
| Choose another export: annotations, edit log, working time, translation reviews | `POST P/exports`, `POST P/exports/translation-reviews` | `export` | `start_export` (`kind`) | covered (a translation review export started with a token runs as the token's job) |
| The accepted results as GA4GH Phenopackets | `POST P/exports/final/preflight`, `POST P/exports/final` (`format: phenopacket`) | `export` | `start_export` (`kind: phenopackets`) | covered (#322); `request_id` added in this PR |
| Close the project: withdraw the open tasks | `POST /assignments/{id}/revoke` | `project-admin` | `withdraw_task`, `hand_over_open_tasks` | added in this PR |
| Close the project: take the roles away | `PUT P/members/{username}` | `read`, `project-admin` | `set_member_roles` with `revoke_assignments` | covered |
| Final export as the record of the project | `POST P/exports/final/preflight`, `POST P/exports/final` | `export` | `start_export` (`kind: final`) | covered |
| Archive the whole project as one file | `POST /admin/project-archives/export`, `GET /admin/project-archives/jobs/{id}`, `GET /admin/project-archives/jobs/{id}/download` | `admin` (system token only) | `export_project_archive`, `download_project_archive` | covered (#325) |
| Import the archive on the long-term server | `POST /admin/project-archives/import` | session only | none | covered by design (#325, #350): an import writes historical rows, audit entries included, and links people by e-mail, so it refuses every token; an administrator runs `ontotator admin projects import-archive` on the host or uses the Projects page |
| Mark the project closed or read-only, or delete it | none | | | remaining gap |

Verdict: **sufficient, one gap remains**. Ontology upgrades are fully covered with a dry run, Phenopackets are an export kind, and a system token archives a whole project into one file that an administrator imports on another server with `ontotator admin projects import-archive` or in the browser; the server keeps the exported file for 24 hours. There is still no project state such as closed or read-only; a project ends by withdrawing its work and its people, and by archiving it.

## 5. Monitoring and the nightly export to a data warehouse

The data warehouse loads the final results every night with `ci-export`, and Dr. Lang asks her MCP client every Monday how the project stands.

| Step | Route | Scope | MCP tool | Status |
| --- | --- | --- | --- | --- |
| Overview: settings, totals per stage, workload, open decisions, export warnings | `GET P/settings`, `GET P/progress`, `GET P/documents/summary`, `GET P/workflow-warnings` | `read` | `project_overview` | covered |
| Texts by language, stage, query or proposals, page by page | `GET P/document-rows` (paged, filtered) | `read` | `list_texts` | covered |
| Progress per text and person | `GET P/progress` | `read` | `get_progress` | covered (not paged: one large answer for big projects) |
| Agreement per text | `GET P/document-rows/{case}/{language}/final-panel` per text | `read` | `agreement_summary` (one call per text, at most 200) | covered; project-wide agreement only in the final export's `agreement.csv` (remaining gap: no route) |
| Working time | `GET P/work-time` | `read` | `working_time_summary` | covered |
| Problem reports that would block or warn the export | `GET P/problem-reports` (paged) | `read` | `list_problem_reports` | added in this PR |
| Accept texts whose annotations agree in full | `PUT P/final-selections` | `read`, `project-admin` | `accept_agreeing_texts` | covered (choosing among differing results stays in the web interface) |
| Check the final export | `GET P/workflow-warnings` | `read` | `final_export_check` | covered |
| Start the nightly export; a retry must not create a second one | `POST P/exports/final` (`request_id`) | `export` | `start_export` with `request_id` | added in this PR (the route already accepted it; the tool always sent a new one) |
| Wait, download, verify the SHA-256 | `GET /jobs/{id}`, `GET /jobs/{id}/download` | `export` | `get_job`, `download_export` | covered |
| Be told when something changed instead of polling | none | | | remaining gap |

Verdict: **sufficient for nightly batches**. Remaining: no change feed or webhook, progress is not paged, and agreement over the whole project is only in the final export.

## 6. Token lifecycle

Tokens last at most 365 days. The CI tokens are project tokens with one or two scopes; they are rotated every 90 days and revoked at once if a CI log ever shows one.

| Step | Route | Scope | MCP tool | Status |
| --- | --- | --- | --- | --- |
| Create a project token for CI | `POST P/tokens` | session only | none (web interface, or `ontotator admin tokens create --project`) | covered by design: a token cannot mint tokens |
| CI checks how long its token lasts and alerts two weeks ahead | `GET /me/token` | `read`, `import`, `export` or `project-admin`; project tokens included | `whoami` (`expires_in_days`, `warning`) | added in this PR |
| A project token works only in its project | middleware, `PROJECT_RESOLVED` routes check the project themselves | | | covered; the task routes are added to that list in this PR, the round, problem report and translation review routes in #351 |
| Rotation: create the successor, install it, revoke the old one | `POST P/tokens`, `POST P/tokens/{id}/revoke` | session only | none | covered by design (no rotation in place) |
| Revoke a leaked token at once | `POST /admin/tokens/{id}/revoke` | session only | none (web interface or `ontotator admin tokens revoke`) | covered by design |
| A person leaves: all their tokens end | `PATCH /admin/users/{username}` (`active: false`) | `admin` | `update_user` | added in this PR (tool) |
| A lead loses the lead role: the project tokens they created end | `PUT P/members/{username}` | `read`, `project-admin` | `set_member_roles` | covered |
| What a token did | audit entries `api_token.use` with token id and name | | `ontotator admin audit` on the server | covered on the server; remaining gap: no API route for a project's audit |
| A missing scope, a revoked token, a foreign project | `401 TOKEN_INVALID`, `403 TOKEN_SCOPE_MISSING`, `403 TOKEN_NOT_ALLOWED`, `404 PROJECT_NOT_FOUND` | | tool errors with a remedy | covered |

Verdict: **sufficient**. Creating and revoking tokens needs a person on purpose; what was missing was a way for a token to see its own expiry, which a project token could not see at all.

## 7. A CI pipeline with project tokens only

The group's CI never sees a personal or system token. `ci-import` stages and commits each night's bundle and polls its job; `ci-export` exports and downloads. In month five the pipeline also rebalances work: a nightly job hands the open tasks of people marked as absent in the lab calendar to the others.

| Step | Route | Scope | MCP tool | Status |
| --- | --- | --- | --- | --- |
| Import with `import` alone, poll the job | `POST P/uploads`, `POST P/uploads/{id}/commit`, `GET /jobs/{id}` | `import` | `upload_texts`, `commit_upload`, `get_job` | covered |
| Export with `export` alone | `POST P/exports/final/preflight`, `POST P/exports/final`, `GET /jobs/{id}/download` | `export` | `start_export`, `download_export` | covered |
| Translation review export with a token | `POST P/exports/translation-reviews` | `export` | `start_export` (`translation_reviews`) | covered |
| Rebalance the open tasks of an absent person | `GET P/assignments`, `POST /assignments/{id}/reassign` | `read`, `project-admin` | `hand_over_open_tasks` | added in this PR (project tokens could not reach the route) |
| The rebalancing job must not touch another project | `require_project_management` in `AssignmentService` | | | covered (tested) |

Verdict: **sufficient after this work**.

## Remaining gaps and why they stay

| Gap | Why it stays |
| --- | --- |
| Creating, listing and revoking tokens with a token | On purpose: a leaked token must not be able to mint successors. A person uses the web interface or `ontotator admin tokens`. |
| Rotation in place | Creating the successor first and then revoking keeps a pipeline working without a moment without a token; an in-place rotation would need the token-minting route above. |
| Annotation, review and translation review (its draft and decision, `PUT /translation-reviews/{id}/draft`, `POST /translation-reviews/{id}/submit`); undo, redo and reset in the editor (`/workspaces/{id}/history`) | Browser only on purpose: the work of people, not of scripts. Starting a lead correction, moving work to a new text version and handling a text change are the lead's steps and take `project-admin` (#345). |
| Importing a project archive | Session and command line only on purpose (#350): an import writes historical rows, audit entries included, and links people by e-mail address, so a stolen token could plant work or audit history. `ontotator admin projects import-archive` on the host does a scripted move. Exporting one is open to a system token. If a real need appears, a separate `archive-import` scope with a dry run. |
| Anonymising an account | Irreversible; the web interface asks for the typed username. |
| `status_overrides` of an upload commit | The web interface does not use it either; `accept_external_review` of `commit_upload` accepts translations reviewed outside Ontotator. |
| Sending setup codes by mail | The server has no mail delivery. `create_users` writes the codes to a private local file for a mail merge. |
| Bulk role changes for existing accounts | One `set_member_roles` call per person is enough for cohorts of tens. A bulk route would need its own dry run. |
| Project state closed or read-only; deleting a project | A new domain feature with its own rules for running tasks. The project archive (#325) keeps a finished project as one file, but the project stays open on the server. |
| Change feed or webhooks | A new delivery mechanism; nightly polling of `project_overview` and the paged `list_texts` is enough for batch pipelines. |
| Paging of `P/progress`, `P/assignments` and `/admin/users/` | The answers are complete lists; `list_assignments` filters and caps on the client. Paging changes the API's shape and the web interface that uses it. |
| Project-wide agreement route | Agreement over the whole project is computed for the final export (`agreement.csv`, `agreement-summary.csv`); `agreement_summary` reads the per-text panels. |
| Project audit through the API | Only `/admin/users/{username}/audit` exists (per user, without token use); the full trail is `ontotator admin audit` on the server. |
