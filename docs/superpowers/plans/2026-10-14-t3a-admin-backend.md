# T3a: Administration Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Lean format: files, interfaces, tables, test cases and acceptance criteria per task. Implementers write the code test-first; code appears only where it defines a contract.

**Goal:**
- Everything the T2 CLI does for users, projects, ontologies, documents and exports is available through an authorised HTTP API.
- Leads upload T1 bundles and plain text with a preview before anything is written.
- Leads assign documents to members, by hand or from a reproducible distribution proposal.
- Annotators and adjudicators see and work on assigned documents only.
- Project rules (O4) are enforced at submission and on proposal import.

**Architecture:**
- **Rename:** `package_id` becomes `project_key` everywhere outside the stored v2 seed format (T2 index D-e).
- **Data:** migration `0005_admin` adds `user_languages`, project settings columns, `assignments` and `uploads`.
- **Policy:** new actions in `authz/policy.py` (index, shared contracts). Document visibility lives in one module, `authz/visibility.py`, used by `ScopedRepository`.
- **Import:** one pure planner `exchange/plan.py::plan_import` serves the CLI, the upload preview and the commit (index D-r). The T2d `t1_import` handler is rebuilt on it. Plain text gets its own reader.
- **Assignments:** `assignments/service.py` owns assign, reassign, reopen and revoke. Status follows the edit log inside `run_mutation`'s transaction. A gate refuses work without an active assignment.
- **Distribution:** a pure function `assignments/distribution.py::propose_distribution` (index D-s).
- **API:** new routers `api/admin_routes.py` (system admin), `api/me_routes.py` (self), `api/project_routes.py` (lead), `api/assignment_routes.py` and `api/job_routes.py`.

**Spec:** `docs/superpowers/specs/2026-10-14-t3-admin-design.md` (A1–A5). T7 requirements O1, O2, O4, I1, I3: `docs/superpowers/specs/2026-10-14-t7-integrations-design.md`. Index: `docs/superpowers/plans/2026-10-14-t3-t5-t4-index.md` (shared contracts, D-o…D-aa, Q15–Q18). Builds on T2e.

**Branch / worktree:** `feat/t3a-admin-backend` from `feat/t2e-docker-operations`, worktree `.worktrees/t3a-admin-backend`. Set up with `uv sync`, `npm --prefix frontend ci` and `npx --prefix frontend playwright install chromium`. Baseline: `scripts/check.sh` (expected `All local checks passed.`).

**Commit rule:** per task, `uv run ruff check --fix src tests && uv run ruff format src tests && uv run mypy src`, then one conventional commit without AI attribution. After any API change: `uv run python scripts/export_openapi.py && npm --prefix frontend run api:generate`.

---

### Task 1: Rename `package_id` to `project_key` (D-e)

A mechanical rename. No behaviour changes; the full suite is the test.

**Scope:**
- `WorkspaceKey.package_id` → `project_key` (`domain/workspace.py`), every repository and service parameter named `package_id`, the request and response models in `api/`, and the path parameters.
- **Paths:** `/api/v1/packages/{package_id}/…` → `/api/v1/projects/{project_key}/…`. That covers `documents` and `ontologies`. `GET /api/v1/projects` (T2c) is unchanged.
- **Frontend:** `packageId` → `projectKey` in `frontend/src`, `frontend/tests` and `frontend/browser`. `listPackages` → `listProjects`, `#package-select` → `#project-select`, `PackageManifest` usages in the client → `ProjectSummary` where they mean the project list.
- **Not renamed:** the stored v2 seed format. `packages/models.py` (`PackageManifest.package_id`, `ValidatedPackage`), `tests/support/v2_*.py` and `tests/fixtures/**` keep `package_id`, because they mirror the v2 files kept as fixtures (T2 index D-f). Code that reads `manifest.package_id` stays as it is.

**Persisted keys:**
- The repository's `_key_str` joins key components without field names, so `drafts.draft_key`, `submissions.local_key` and receipts are unaffected.
- Immutable submission payloads written before the rename contain `origin_key.package_id`. `WorkspaceKey` therefore accepts both names on input and always dumps `project_key`:

```python
project_key: str = Field(validation_alias=AliasChoices("project_key", "package_id"))
```

`model_config` keeps `extra="forbid"`; add `populate_by_name=True`.

**Procedure:** run a one-off script outside the repository. It applies `sed -i -E 's/\bpackage_id\b/project_key/g; s/\bpackageId\b/projectKey/g; s/\blistPackages\b/listProjects/g; s/package-select/project-select/g'` to every `*.py`, `*.ts` and `*.tsx` file under `src`, `tests`, `frontend/src`, `frontend/tests` and `frontend/browser`. It excludes the files named above, `frontend/src/api/generated.ts` and `contracts/openapi.json`. Then rewrite the route paths by hand, regenerate the contract, and let mypy, `tsc` and the suites find the remaining spots (mainly `manifest.project_key` that must go back to `manifest.package_id`).

**Tests:**
- `tests/test_workspace_key.py::test_old_payloads_with_package_id_still_load`: a `Submission` payload dict with `origin_key.package_id` validates, and its `model_dump()` contains `project_key` and no `package_id`.
- The existing suites are the rest of the test.

**Acceptance:**
- `grep -rnE "\bpackage_id\b|/packages/" src/ontotator --include=*.py | grep -v "packages/models.py"` prints only reads of `manifest.package_id` (list them in the commit message; at most a handful).
- `grep -rnE "packageId|listPackages|package-select" frontend/src frontend/tests frontend/browser | grep -v generated.ts` prints nothing.
- `scripts/check.sh` passes.
- Commit: `refactor: rename package_id to project_key (T2 D-e)`.

---

### Task 2: Schema and policy (migration 0005)

**Modify** `storage/tables.py`, `authz/policy.py`, `tests/test_policy.py`; **create** `storage/migrations/versions/0005_admin.py`.

| Table / change | Columns (NOT NULL unless "null") | Keys |
|---|---|---|
| `user_languages` | `user_id` → users ON DELETE CASCADE; `language` text CHECK `language ~ '^[a-z]{2}$'` | PK (user_id, language) |
| `projects` + | `languages` jsonb default '[]'; `guideline_url` text null; `guideline_version` text null; `require_chosen_axes` bool default false; `adjudicator_not_annotator` bool default false; `contiguous_mentions_only` bool default false; `hidden_axis_values` jsonb default '{}' (`{layer_id: {axis_id: [value, …]}}`); `updated_at` timestamptz default now() | |
| `assignments` | `id` bigint identity; `project_id` → projects; `document_id` text; `user_id` → users; `task` text; `status` text default 'open'; `created_at` default now(); `created_by` → users null; `updated_at` default now(); `revoked_at` null; `revoked_by` → users null; `last_submission_id` text null | PK id; FK (project_id, document_id) → documents; CHECK `ck_assignments_task`: `task IN ('annotate','review')`; CHECK `ck_assignments_status`: `status IN ('open','in_progress','submitted','reopened')`; UNIQUE INDEX `uq_assignments_active` ON (project_id, document_id, user_id, task) WHERE revoked_at IS NULL; ix (project_id, user_id); ix (project_id, document_id) |
| `uploads` | `id` bigint identity; `project_id` → projects; `created_by` → users null; `kind` text CHECK in ('t1','text'); `files` jsonb (`[{filename, sha256, size}]`); `language` text null; `status` text CHECK in ('previewing','ready','invalid','committing','committed','failed','discarded'); `preview` jsonb null; `plan_sha256` text null; `preview_job_id` → jobs null; `commit_job_id` → jobs null; `created_at`, `updated_at` default now() | PK id; ix (project_id, created_at) |

Grants: full DML for the application role on all four; `GRANT USAGE, SELECT ON ALL SEQUENCES …` again. Later plans widen `ck_assignments_task` with `DROP CONSTRAINT … ADD CONSTRAINT` under the same name.

**Policy:** add `MANAGE_PROJECT_SETTINGS`, `MANAGE_ASSIGNMENTS`, `VIEW_ALL_DOCUMENTS` and `VIEW_PROGRESS` (admin and lead: yes; everyone else: no), and flip `MANAGE_MEMBERS` to yes for the lead (index, shared contracts). Add `TASK_ROLES: Mapping[Task, frozenset[Role]] = {"annotate": {"annotator"}, "review": {"adjudicator"}}`. Add `may_take(access, project, task) -> bool`, true if the user holds one of the task's roles in that project.

**Tests:**
- `tests/test_schema.py`: the comparison test still passes (count unchanged: no new append-only table).
- `tests/test_policy.py::test_every_role_and_action`: the literal matrix gains the five rows.
- `test_tasks_need_their_role`: an annotator may take `annotate` and not `review`; `{lead}` alone may take neither (Q2).
- `tests/test_assignments_schema.py::test_only_one_active_assignment_per_task`: a second active row for the same (document, user, task) violates `uq_assignments_active`; after setting `revoked_at` on the first, it inserts.

**Acceptance:** `uv run pytest tests/test_schema.py tests/test_policy.py tests/test_assignments_schema.py -q` passes. Commit: `feat(admin): schema for languages, project settings, assignments and uploads`.

---

### Task 3: Users and the own profile

**Modify** `auth/accounts.py`; **create** `api/admin_routes.py`, `api/me_routes.py`, `tests/test_admin_users_api.py`, `tests/test_me_api.py`.

**`AccountService` additions:**
- `set_languages(actor, username, languages: Iterable[str])`: replaces the rows. Each value is lower-cased and must match `^[a-z]{2}$`, otherwise `LANGUAGE_INVALID`. Audits `user.languages`.
- `languages_of(user_ids) -> dict[int, frozenset[str]]`.
- `update_profile(actor, username, *, display_name=None, email=None, orcid=None, orcid_consent=None)`:
  - a display name is 1–120 characters (`DISPLAY_NAME_INVALID`);
  - the ORCID matches `\d{4}-\d{4}-\d{4}-\d{3}[\dX]` and passes the ISO 7064 mod 11-2 checksum (`ORCID_INVALID`);
  - consent without an ORCID is allowed, because consent also covers the display name (T1 F10);
  - audits `user.profile` with the changed field names, not the values.
- `change_password(user_id, current, new, *, keep_session_id) -> None`:
  - verifies `current`. A failure is recorded in `login_attempts` (so it counts towards the Q8 lockout) and raises `PASSWORD_WRONG` (403);
  - checks `PASSWORD_RULES`, sets the hash and increments `credential_generation`;
  - revokes all other sessions of the user and keeps `keep_session_id`;
  - audits `user.password_set`.

**Admin API** (`/api/v1/admin/users`; every route calls `require_system_admin`):

| Route | Body → result |
|---|---|
| `GET /` | `list[AdminUser]`; `AdminUser = {username, display_name, email, pseudonym, is_system_admin, active, languages, projects: [{project_key, roles}]}` |
| `POST /` | `{username, display_name, email?, system_admin=false, languages=[]}` → `{user: AdminUser, code, expires_at}` |
| `POST /{username}/reset-code` | → `{code, expires_at}` |
| `PATCH /{username}` | `{display_name?, email?, active?, is_system_admin?, languages?}` → `AdminUser` |

- The code appears only in this one response, never in a listing or log (D2).
- An admin cannot deactivate themselves or remove their own admin flag: `SELF_LOCKOUT` (409).

**Self API** (`/api/v1/me`):

| Route | Body → result |
|---|---|
| `GET /profile` | `Profile = {username, display_name, email, pseudonym, orcid, orcid_consent, languages}` |
| `PATCH /profile` | `{display_name?, email?, orcid?, orcid_consent?, languages?}` → `Profile` |
| `POST /password` | `{current_password, new_password}` → 204 |

`GET /api/v1/auth/me` (T2b) is unchanged.

**Tests** (`tests/test_admin_users_api.py`):
- `test_an_admin_creates_a_user_and_sees_the_code_once`: the response holds a code; `GET /` does not; `audit_events` holds `user.create` without the code.
- `test_the_new_user_redeems_the_code_and_logs_in`.
- `test_non_admins_get_403` (all four routes, as a lead).
- `test_deactivation_ends_the_users_sessions`.
- `test_an_admin_cannot_lock_themselves_out` (2 cases).
- `test_languages_are_validated_and_replaced`: `["DE", "en"]` is stored as `{de, en}`; `["deu"]` gives `LANGUAGE_INVALID`.

**Tests** (`tests/test_me_api.py`):
- `test_users_edit_their_own_profile_and_languages`.
- `test_an_invalid_orcid_is_refused`: the checksum is wrong.
- `test_changing_the_password_keeps_this_session_and_ends_others`: a second client's session no longer resolves; the current one still works.
- `test_a_wrong_current_password_counts_as_a_failed_login`: after 5 failures, a login with the right password is refused (Q8).

**Acceptance:** the tests pass; contract regenerated. Commit: `feat(admin): user administration and own profile API`.

---

### Task 4: Projects, members and ontologies

**Create** `domain/profile_templates.py`, `projects/service.py`, `api/project_routes.py`, `tests/test_projects_api.py`, `tests/test_ontologies_api.py`. **Modify** `exchange/t1.py` and `exchange/jobs.py` (guideline reference), `api/admin_routes.py`.

**Profile templates:** `PROFILE_TEMPLATES: Mapping[str, Callable[[OntologyFile], TaskProfile]]` with one entry, `"hpo-phenotype"`. It builds the single HP layer with the three axes, the same profile as T2e's `tests/fixtures/smoke-profile.json`. The template only pre-fills a profile; the stored project holds the resulting `TaskProfile` like any uploaded one. Nothing in it is specific to a consumer (U1).

**`ProjectService(db, store: OntologyStore)`:**
- `create(actor, *, key, name, description, profile: TaskProfile, pins, languages) -> ProjectSettings`: wraps T2d's `create_project`. Key: `^[a-z0-9][a-z0-9-]{1,62}$` (`PROJECT_KEY_INVALID`), unique (`PROJECT_EXISTS`). Audits `project.create`.
- `settings(key) -> ProjectSettings`.
- `update_settings(actor, key, change: ProjectSettingsChange) -> ProjectSettings`:
  - `languages` are validated as in Task 3;
  - `guideline_url` must be `http(s)://…` and `guideline_version` is 1–64 characters; both are set or both are empty (`GUIDELINE_INCOMPLETE`);
  - `hidden_axis_values` may only name existing layers, axes and values, and never the axis' default value (`SETTINGS_INVALID` with the offending path);
  - audits `project.update` with the changed field names.
- `update_pins(actor, key, pins)` and `update_profile(actor, key, profile)`: refused with `PROJECT_IN_USE` (409) once the project has a submission (Q16).

> **Open question Q16:** can a project's ontology version or annotation profile change after work has started? Provisional default: no. Pins and profile are locked once a submission exists; an ontology upgrade means a new project.

**`ProjectSettings`:** `{project_key, name, description, languages, guideline_url, guideline_version, require_chosen_axes, adjudicator_not_annotator, contiguous_mentions_only, hidden_axis_values, profile: TaskProfile, pins: [{ontology_id, sha256, release, allowed_roots, t1_profile}], locked: bool}`. `locked` tells the UI that pins and profile are read-only.

**Members:** `MembershipService` (T2c) gains `set_roles(actor, key, username, roles)`, which replaces the user's roles; an empty set removes the member.
- Removing the lead role from the project's last lead is refused with `LAST_LEAD` (409), unless the actor is a system admin.
- A member with active, unsubmitted assignments can be removed or lose the role a task needs only with `revoke_assignments: true`. Otherwise `MEMBER_HAS_ASSIGNMENTS` (409) lists them. With the flag, those assignments are revoked (Task 7, audited each).

> **Open question Q27:** what happens to the open work of a member who is removed from a project? Provisional default: removal needs a confirmation and revokes their open and in-progress assignments. Submitted work and drafts stay, attributed to them.

**Routes** (`/api/v1/projects`):

| Route | Guard | Body → result |
|---|---|---|
| `POST /` | `CREATE_PROJECT` | `{key, name, description, languages, template?: "hpo-phenotype", profile?: TaskProfile, pins: [{ontology_id, sha256, allowed_roots, t1_profile}]}`; exactly one of `template`/`profile` (`PROFILE_REQUIRED`) → `ProjectSettings` |
| `GET /templates` | logged in | `[{id, label}]` |
| `GET /{key}/settings` | `VIEW_PROJECT` | `ProjectSettings` |
| `PATCH /{key}/settings` | `MANAGE_PROJECT_SETTINGS` | `ProjectSettingsChange` → `ProjectSettings` |
| `PUT /{key}/pins`, `PUT /{key}/profile` | `MANAGE_PROJECT_SETTINGS` | locked rule above |
| `GET /{key}/members` | `VIEW_PROJECT` | `[{username, display_name, pseudonym, roles, languages}]` |
| `PUT /{key}/members/{username}` | `MANAGE_MEMBERS` | `{roles, revoke_assignments=false}` → member |

`GET /api/v1/projects` (T2c `ProjectSummary`) gains `can_manage: bool` (true with `MANAGE_PROJECT_SETTINGS`).

**Ontologies** (`/api/v1/admin/ontologies`, system admin):
- `POST /` takes multipart `files[]`. Each file is streamed to a temporary file and then passed to `OntologyStore.add`. The limit is `AppConfig.max_ontology_bytes` (default 300 MB, `PAYLOAD_TOO_LARGE` 413).
- `GET /` returns `[{sha256, kind, prefix, release, filename, language, uploaded_at, projects: [project_key]}]`. `projects` lists the projects that pin the file.

**Guideline reference:** T2d's `t1_export` sets `guideline_ref = f"{guideline_url}@{guideline_version}"` when both are set, otherwise `None` (T1 F10 shape `name@version`).

**Tests** (`tests/test_projects_api.py`):
- `test_an_admin_creates_a_project_from_the_template`: the profile has the HP layer; pins hold the file's release; `project.create` is audited.
- `test_a_lead_edits_settings_but_not_another_project`: 404 for the other project.
- `test_hidden_values_must_exist_and_not_be_the_default` (3 cases).
- `test_pins_lock_after_the_first_submission`: `PROJECT_IN_USE` after one submission; `locked` is true.
- `test_a_lead_manages_members_but_not_the_last_lead`: `LAST_LEAD`; a system admin may do it.
- `test_removing_a_member_with_open_work_needs_confirmation`: `MEMBER_HAS_ASSIGNMENTS`; with the flag, the assignments are revoked and audited.
- `test_the_export_carries_the_guideline_reference`: the exported set's `guideline_ref` is `https://example.org/g@v2`.

**Tests** (`tests/test_ontologies_api.py`):
- `test_an_admin_uploads_an_ontology_and_sees_its_projects`.
- `test_a_second_upload_of_the_same_file_is_idempotent`.
- `test_a_lead_cannot_upload_ontologies`.

**Acceptance:** the tests pass; contract regenerated. Commit: `feat(admin): projects, settings, members and ontology upload API`.

---

### Task 5: Project rules at submission and import (O4)

**Create** `domain/project_rules.py`, `tests/test_project_rules.py`. **Modify** `application/submissions.py`, the axes-config read path in `storage/repository.py` (`get_axes_config`), `exchange/plan.py` (Task 6; write the rule call there).

**Interface:**
- `@dataclass(frozen=True) class ProjectRules`: `contiguous_mentions_only: bool`, `require_chosen_axes: bool`, `hidden_axis_values: Mapping[str, Mapping[str, frozenset[str]]]`. It is read from the project row with `ProjectRules.of(row)`.
- `@dataclass(frozen=True) class RuleViolation`: `annotation_id`, `rule` (`"discontinuous_mention"` | `"hidden_axis_value"` | `"axis_not_chosen"`) and `detail` (e.g. `{"axis": "presence", "value": "unknown"}`).
- `rule_violations(snapshots, evidence_by_id, profile, rules, *, at_submission: bool) -> list[RuleViolation]`:
  - **discontinuous:** an evidence mention with more than one segment, if `contiguous_mentions_only` is set;
  - **hidden value:** an axis value listed in `hidden_axis_values[layer][axis]`;
  - **not chosen:** only when `at_submission` and `require_chosen_axes`, an axis that the annotation's type defines has an empty value (T1 F8).

**Where the rules apply:**
- **Submission:** `SubmissionService.submit` validates the snapshots of the result (own annotations plus review replacements) before creating the submission. Any violation gives `DomainError("PROJECT_RULE_VIOLATION", {"violations": [...]})` (422). Nothing is written, and the draft stays editable.
- **Import (O4):** `plan_import` (Task 6) calls it with `at_submission=False` per proposal. A violating proposal is listed under the set's `refused` entries and left out. The rest of the set is imported. Its `proposal_sets.payload` still holds the full set as delivered (D-u).
- **Editor:** the axes config the API returns for a project drops hidden values from each axis' options. A draft value that is now hidden stays visible as it is and is reported at submission, so nothing changes silently.

**Tests** (`tests/test_project_rules.py`):
- `test_a_two_segment_mention_violates_contiguous_only` and `test_it_passes_when_the_option_is_off`.
- `test_hidden_axis_values_are_violations`.
- `test_unchosen_axes_only_matter_at_submission`.
- `test_submission_is_refused_with_the_annotation_ids` (API): 422 `PROJECT_RULE_VIOLATION`, with the ids in the details; the draft's revision is unchanged.
- `test_the_axes_config_hides_values`: `unknown` is missing from `presence` options.
- `test_import_drops_only_the_violating_proposals` (through `plan_import`, Task 6 fixture): 1 of 3 refused with rule `discontinuous_mention`; 2 are inserted; the payload holds 3.

**Acceptance:** the tests pass. Commit: `feat(admin): project rules O4 and require_chosen_axes at submission and import`.

---

### Task 6: Upload preview and commit (A1, O1, O2, I1, I3)

**Create** `exchange/plan.py`, `exchange/text.py`, `exchange/uploads.py`, `tests/test_import_plan.py`, `tests/test_text_upload.py`, `tests/test_uploads_api.py`. **Modify** `exchange/jobs.py` (`t1_import` uses the planner), `cli.py` (`admin import` accepts `.txt` and `--language`).

**Incoming units.** Both readers produce the same structure, so the planner does not care where a unit came from:
- `IncomingUnit`: `label` (file name or bundle path); `document: Document`; `source_text_sha256`; `normalised: bool`; `bundle_id`; `manifest_sha256`; and `set: IncomingSet | None`.
- `IncomingSet`: `annotation_set_id`, `set_kind`, `actors`, `payload`, `proposals: ImportedProposals`. It is `None` for plain text and for an empty set (O2).

> **Resolved Q33 (2026-10-15, user: whether human annotations must be imported is not known yet):** an import may carry empty sets of any kind (documents only, O2) and non-empty sets of kind `tool_output` whose actors are all tools. A non-empty set of any other kind (`individual`, `stage_result`, `adjudicated`, `release`) refuses the whole import with error `T1_SET_KIND`, and the preview lists the affected units. Keep `set_kind` an open text column validated in one place, so a future kind (e.g. imported human annotations for review) can be added without a schema change. Tests: `test_an_import_with_a_human_set_is_refused_and_lists_the_units`, `test_the_ontospan_release_bundle_is_refused_as_input`.

**T1 reader** `read_t1_upload(path, pins, profile) -> tuple[list[IncomingUnit], list[Issue]]`:
- It wraps T2d's `read_bundle` / `load_annotated_document` and the pin check (`PIN_MISMATCH`).
- It applies `unit_to_proposals(…, bundle_id=…)`.
- It checks tool provenance (`T1_TOOL_PROVENANCE`).
- It turns ontospan report issues into `Issue{code, unit, annotation_id?, message, severity}`.

**Text reader** `read_text_upload(files: Sequence[tuple[str, bytes]], language) -> tuple[list[IncomingUnit], list[Issue]]`:
- **Files:** `.txt` files, or ZIP files whose entries are `.txt`. Directory entries and `__MACOSX/` are ignored. Any other entry is `UNSUPPORTED_FILE`.
- **Ids:** `document_id` is the basename without extension. It must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` (`DOCUMENT_ID_INVALID`). Two files with the same stem are `DUPLICATE_DOCUMENT_ID`.
- **Encoding:** strip a leading UTF-8 BOM, then `bytes.decode("utf-8")` with strict errors. A failure is `TEXT_NOT_UTF8`, naming the file. There is no guessing.
- **Text:** `text = ontospan.canonical_text(decoded)`. `normalised = text != raw_decoded_with_bom`. `source_text_sha256 = sha256(original bytes)`. An empty text is `TEXT_EMPTY`.
- **Language:** must be one of the project's `languages`, if the project lists any (`LANGUAGE_NOT_IN_PROJECT`).

**Planner** (pure, no database; index D-r):

```python
def plan_import(
    units: Sequence[IncomingUnit],
    state: ProjectImportState,
    profile: TaskProfile,
    rules: ProjectRules,
    reader_issues: Sequence[Issue],
) -> ImportPlan: ...
```

- `ProjectImportState`: `documents: Mapping[str, str]` (document_id → text_sha256), `texts: Mapping[str, list[str]]` (text_sha256 → document_ids) and `sets: frozenset[tuple[str | None, str, str]]` (bundle_id, set id, document_id).
- `ImportPlan` (pydantic, serialised into `uploads.preview`):
  - `documents: [{document_id, language, text_sha256, action: "add" | "unchanged", normalised, label}]`;
  - `duplicates: [{document_id, text_sha256, same_text_as: [document_id]}]`, within the project and within the upload. These are a warning; the documents are still added;
  - `collisions: [{document_id, existing_sha256, new_sha256}]`, an error (A1: refused in T3);
  - `proposal_sets: [{document_id, annotation_set_id, bundle_id, set_kind, actors: [{actor_id, kind, name, version, model, run_id}], proposals, refused: [{annotation_id, rule, detail}], action: "add" | "already_imported"}]`;
  - `documents_only: [document_id]` (O2);
  - `normalised_count`;
  - `errors: [Issue]` and `warnings: [Issue]`;
  - `counts`;
  - `plan_sha256`: the canonical hash (RFC 8785, `canonical_hash`) of the plan without `plan_sha256` itself;
  - `committable = not errors`.
- `apply_plan(conn, project, plan, units, actor) -> ImportCounts` writes the documents and sets marked `add` through `add_documents_and_proposals`. It leaves out refused proposals.

**`t1_import` (T2d) is rebuilt** on `read_t1_upload` + `plan_import` + `apply_plan`. A plan with errors fails the job with the error codes, so the CLI behaviour stays, and the T2d tests keep passing unchanged.

**Upload flow** (`exchange/uploads.py`, job kinds `upload_preview` and `upload_commit`):
1. `POST /api/v1/projects/{key}/uploads` (`IMPORT_DOCUMENTS`), multipart with `kind` (`t1` | `text`), `language` (text only, required) and `files[]`:
   - stores each file in the blob store; the total is capped by `AppConfig.max_upload_bytes`, default 50 MB (413);
   - inserts an `uploads` row with `status = "previewing"`, enqueues `upload_preview` and returns `{upload_id, job_id}`.
2. The **`upload_preview` handler** reads, plans and stores `preview` and `plan_sha256`. The status becomes `ready`, or `invalid` if not committable. Nothing else is written. It audits `upload.preview` with the counts.
3. `GET /api/v1/projects/{key}/uploads/{id}` returns `UploadView = {id, kind, language, files, status, preview, plan_sha256, commit_job_id, created_at}`.
4. `POST …/uploads/{id}/commit {plan_sha256}`:
   - needs `status == "ready"` and an equal hash (`UPLOAD_STALE` 409 otherwise);
   - sets `committing` and enqueues `upload_commit`.
5. The **`upload_commit` handler** re-reads and re-plans inside its transaction. A different plan hash fails the job with `UPLOAD_STALE`, and the status becomes `failed`. Otherwise it runs `apply_plan`, sets `committed` and audits `project.import` with the T2d details (`bundle_id`, `manifest_sha256`, `producers`, counts) plus `upload_id` (I1, I9).
6. `POST …/uploads/{id}/discard` sets `discarded` from `ready` or `invalid`.
7. `GET /api/v1/projects/{key}/uploads` lists the last 50 uploads.

**Proposal provenance for the detail pane (I3):** `GET /api/v1/projects/{key}/proposal-sets/{id}` returns `{id, document_id, annotation_set_id, bundle_id, set_kind, actors, imported_at, imported_by_pseudonym}`.
- Proposal annotations in the editor responses gain `proposal_set_id` and `notes`. The display lives in T3b Task 10.
- Access: the same document visibility as the proposals themselves (Task 7). It is 404 otherwise.

**Tests** (`tests/test_import_plan.py`, pure, with units built by `ontospan.write_bundle` against `tests/fixtures/hp.json`):
- `test_a_new_bundle_plans_documents_and_sets`.
- `test_an_empty_set_is_planned_as_document_only` (O2).
- `test_a_known_text_under_a_known_id_is_unchanged` and `test_a_changed_text_under_a_known_id_is_a_collision`.
- `test_the_same_text_under_two_ids_is_a_duplicate_warning` (project and within the upload, 2 cases).
- `test_an_already_imported_set_is_skipped` (re-upload of the same bundle).
- `test_tool_actors_without_version_are_errors` (I3).
- `test_the_plan_hash_is_stable_and_changes_with_the_project`: the same inputs give the same hash; adding a document to `state` changes it.
- `test_plan_lists_tool_labels_with_model_and_run`.

**Tests** (`tests/test_text_upload.py`):
- `test_txt_and_zip_files_become_documents_named_by_stem`.
- `test_a_bom_is_stripped_and_crlf_normalised_and_counted`: `normalised_count == 1`; `source_text_sha256` is the hash of the original bytes.
- `test_latin1_is_refused_with_the_file_named`.
- `test_other_zip_entries_and_duplicate_stems_are_refused` (2 cases).

**Tests** (`tests/test_uploads_api.py`, jobs run inline through `claim` + `run` in the test):
- `test_preview_writes_nothing_until_commit`: documents count unchanged after the preview; after the commit the documents and proposals exist.
- `test_commit_with_a_stale_hash_is_refused`: a document added between preview and commit gives `UPLOAD_STALE`.
- `test_an_invalid_preview_cannot_be_committed`.
- `test_the_commit_is_audited_with_bundle_and_manifest` (I1).
- `test_imported_ids_are_kept_through_the_upload` (O1): `parse_annotation_ref` of a stored proposal gives the producer's bundle, set and annotation ids.
- `test_annotators_cannot_upload` (403).
- `test_proposal_set_metadata_is_visible_with_the_document` (I3): name, version, model and run id are returned; a user without the document gets 404.
- `tests/test_admin_cli.py::test_cli_imports_plain_text` (`admin import KEY dir/a.txt --language de`).

**Acceptance:** the tests and the T2d import tests pass; contract regenerated. Commit: `feat(admin): upload preview and commit for T1 bundles and plain text`.

---

### Task 7: Assignments, status and visibility (A3, A4)

**Create** `assignments/__init__.py`, `assignments/service.py`, `authz/visibility.py`, `api/assignment_routes.py`, `tests/test_assignments.py`, `tests/test_visibility.py`. **Modify** `authz/scoped.py`, `storage/repository.py` (`run_mutation` hook), `api/routes.py` (gate), `application/workspaces.py`.

**Model:**
- `Task = Literal["annotate", "review"]`.
- `MODE_FOR_TASK = {"annotate": "independent", "review": "review"}`. `TASK_FOR_MODE` is its inverse plus `"assisted": "annotate"`.
- `Assignment` dataclass: `id, project_key, document_id, user_id, username, pseudonym, task, status, created_at, updated_at, revoked_at, last_submission_id`.

**`AssignmentService(db, *, now=…)`** (every change audited with `target_type="assignment"`):
- `assign(actor, key, document_id, username, task, *, confirm_language=False) -> Assignment`:
  - the user must be a member (`NOT_A_MEMBER`) holding a role for the task (`ASSIGNEE_ROLE_MISSING`, policy `may_take`);
  - if the user's languages do not include the document's language, it needs `confirm_language` (`LANGUAGE_CONFIRMATION_REQUIRED` 409, details `{document_language, user_languages}`). With it, it also audits `assignment.language_override` (T4 W1 rule, applied from T3);
  - for `review` with `adjudicator_not_annotator`, the user must not have an active `annotate` assignment on that document (`ADJUDICATOR_IS_ANNOTATOR` 409), and vice versa;
  - an existing active assignment for the same (document, user, task) is returned unchanged (idempotent);
  - audits `assignment.create`.
- `reassign(actor, assignment_id, username, *, confirm_started=False, confirm_language=False) -> Assignment`:
  - if the old status is not `open`, it needs `confirm_started` (`REASSIGN_CONFIRMATION_REQUIRED` 409);
  - it revokes the old row (`revoked_at`, `revoked_by`) and creates a new `open` one;
  - the old draft stays with its author; the new assignee's draft key holds their own pseudonym, so they start from the document's inputs (A4);
  - audits `assignment.reassign` with `{from, to}`.
- `reopen(actor, assignment_id, reason=None)`: from `submitted` to `reopened`; audits `assignment.reopen`.
- `revoke(actor, assignment_id, reason=None)`: sets `revoked_at`; audits `assignment.revoke`.
- `active_for(conn, project_id, document_id, user_id, task) -> Assignment | None`.
- `list(key, *, document_ids=None, user=None, include_revoked=False)`.
- `my_tasks(user_id) -> list[TaskSummary]`, across projects, active only. Order: `reopened`, `in_progress`, `open`, `submitted`, then document position. `TaskSummary = {assignment_id, project_key, project_name, document_id, language, task, status, updated_at}`.

**Status hook** (inside `Repository.run_mutation`, the same transaction as the `edit_events` row of T2c Task 4):
- with a principal in the context and an active assignment for (project, document, principal's user, `TASK_FOR_MODE[key.mode]`):
  - an `edit` event moves `open` → `in_progress`;
  - a `submit` event sets `submitted` and `last_submission_id`, from `open`, `in_progress` or `reopened`;
- without a principal (CLI, repository tests) nothing happens.

**Gate:** `ScopedRepository.open_draft` and `run_mutation` call `require_workable(access, key)`:
- no active assignment for (document, user, task from the mode): `AccessDenied("ASSIGNMENT_REQUIRED")` (403);
- status `submitted`: `DomainError("ASSIGNMENT_SUBMITTED")` (409) for mutations. Opening a submitted assignment is read-only: the API returns the draft with `read_only: true`.

> **Open question Q15:** may a project lead (or an admin with the annotator role) work on a document without assigning it to themselves? Provisional default: no. Every piece of work goes through an assignment; a lead assigns themselves with one click.

> **Open question Q17:** after submitting, may annotators correct their own work? Provisional default: no. Submitted work is locked; the lead reopens it.

**Visibility** (`authz/visibility.py`, the single place; index shared contracts):
- `@dataclass(frozen=True) class DocumentFilter`: `all: bool`, `document_ids: frozenset[str]`.
- `visible_documents(conn, access, project_id, project_key) -> DocumentFilter`:
  - `all=True` with `VIEW_ALL_DOCUMENTS`;
  - otherwise the documents with an active (not revoked) assignment of the user, in any status.
- `require_document(conn, access, project_id, project_key, document_id)` raises `DomainError("DOCUMENT_NOT_FOUND")` (404) outside the filter.
- `ScopedRepository` applies it in `list_documents`, `get_document`, `list_annotations_for_document`, `get_document_status`, `open_draft`, `run_mutation`, `get_submissions_for_document`, the search-event and tree methods that take a document, and the Task 6 proposal-set read. The T2c enumeration test is extended: every document-taking method must call `require_document`. A test spy counts the calls.

**Routes:**

| Route | Guard | Body → result |
|---|---|---|
| `GET /api/v1/me/tasks` | logged in | `list[TaskSummary]` |
| `POST /api/v1/assignments/{id}/open` | assignee | `WorkspaceView` as `/workspaces/open`, plus `assignment` and `read_only`. The server builds the key: project, document, own pseudonym, `MODE_FOR_TASK[task]`, scope and targets as the existing open does |
| `GET /api/v1/projects/{key}/assignments` | `MANAGE_ASSIGNMENTS` | query `document_id?`, `username?`, `include_revoked?` → `list[AssignmentView]` (`Assignment` plus `display_name`) |
| `POST /api/v1/projects/{key}/assignments` | `MANAGE_ASSIGNMENTS` | `{rows: [{document_id, username}], task, confirm_language=false, seed?: int}` → `{created: [AssignmentView], refused: [{document_id, username, code}]}`. Each row is assigned on its own, so one refusal does not stop the others |
| `POST /api/v1/assignments/{id}/reassign` | `MANAGE_ASSIGNMENTS` | `{username, confirm_started, confirm_language}` |
| `POST /api/v1/assignments/{id}/reopen`, `/revoke` | `MANAGE_ASSIGNMENTS` | `{reason?}` |

`/workspaces/open` stays for now and is gated the same way. T4a removes the client-chosen mode.

**Tests** (`tests/test_assignments.py`):
- `test_only_members_with_the_task_role_can_be_assigned` (`NOT_A_MEMBER`, `ASSIGNEE_ROLE_MISSING`).
- `test_a_language_mismatch_needs_confirmation_and_is_audited`.
- `test_adjudicator_not_annotator_is_enforced_when_set` (both directions).
- `test_status_follows_edits_and_submission`: `open` → `in_progress` after the first command → `submitted` with the id.
- `test_a_submitted_assignment_is_read_only_until_reopened`: a command gives `ASSIGNMENT_SUBMITTED`; after `reopen` it works; the next submission is a new one, and the old one stays unchanged.
- `test_reassigning_a_started_assignment_needs_confirmation`: the new assignee opens an empty draft (no annotations of the old assignee); the old draft still exists with its author.
- `test_work_without_an_assignment_is_refused` (`ASSIGNMENT_REQUIRED`, also for a lead with the annotator role; Q15).
- `test_every_assignment_change_is_audited` (create, reassign, reopen, revoke).
- `test_my_tasks_lists_active_assignments_in_order`.

**Tests** (`tests/test_visibility.py`):
- `test_an_annotator_lists_only_assigned_documents`.
- `test_an_unassigned_document_is_404_on_every_route` (documents, annotations, open, commands, proposal set, tree).
- `test_a_revoked_assignment_hides_the_document_again`.
- `test_leads_and_admins_see_all_documents`.
- `test_every_document_method_checks_visibility` (enumeration).

**Acceptance:** the tests pass, and the full suite passes with the harness change of Task 10 (implement the harness part first if needed). Contract regenerated. Commit: `feat(admin): assignments with status, visibility of assigned documents only`.

---

### Task 8: Distribution proposal (A2)

**Create** `assignments/distribution.py`, `tests/test_distribution_proposal.py`; **modify** `api/assignment_routes.py`.

**Interface** (pure; index D-s):

```python
@dataclass(frozen=True)
class Candidate:
    user_id: int
    username: str
    languages: frozenset[str]
    load: int  # active assignments not yet submitted


@dataclass(frozen=True)
class DocumentItem:
    document_id: str
    language: str
    excluded_user_ids: frozenset[
        int
    ]  # already assigned this task, or barred by adjudicator_not_annotator


@dataclass(frozen=True)
class DistributionProposal:
    rows: tuple[tuple[str, int], ...]  # (document_id, user_id)
    unassignable: tuple[Unassignable, ...]  # (document_id, reason, eligible_count)
    seed: int
    per_document: int


def propose_distribution(
    documents: Sequence[DocumentItem],
    candidates: Sequence[Candidate],
    *,
    per_document: int,
    seed: int,
    required_languages: Callable[[DocumentItem], frozenset[str]] = lambda d: frozenset(
        {d.language}
    ),
) -> DistributionProposal: ...
```

**Rules** (the contract):
- `rng = random.Random(seed)`. Documents are processed in the given order (document position).
- For each document:
  - **eligible:** candidates whose `languages ⊇ required_languages(doc)` and who are not in `excluded_user_ids`;
  - **draw:** a tie-break value `rng.random()` per candidate, drawn in `user_id` order for all candidates, so the stream does not depend on eligibility;
  - **too few:** if `len(eligible) < per_document`, the document gets no rows and is listed as `Unassignable(document_id, "NO_READER" if eligible == 0 else "TOO_FEW_READERS", len(eligible))`. It is never skipped silently;
  - **pick:** otherwise the `per_document` eligible candidates with the smallest `(load, tie_break, user_id)`; each picked candidate's load is incremented.
- T5 passes `required_languages` for `translation_review` (both languages).

> **Open question Q18:** how many people should the automatic distribution give each document? Provisional default: the lead sets a number per run (default 1); load counts open and in-progress assignments.

**Routes:**
- `POST /api/v1/projects/{key}/assignments/proposal` (`MANAGE_ASSIGNMENTS`) takes `{document_ids, task, per_document=1, seed?: int}`.
  - The seed defaults to `secrets.randbelow(2**31)`.
  - It returns `{rows: [{document_id, language, username, display_name, load_before}], unassignable: [{document_id, language, reason, eligible_count}], seed, per_document}`.
  - It writes nothing.
- The (possibly edited) table is confirmed through `POST /api/v1/projects/{key}/assignments` with `seed`. That route audits each `assignment.create` and one `assignment.distribute` with `{seed, per_document, rows, unassignable}`, so the proposal is reproducible from the audit log (A2).

**Tests** (`tests/test_distribution_proposal.py`):
- `test_the_same_seed_gives_the_same_proposal` and `test_another_seed_may_differ`.
- `test_load_is_balanced_within_one`: 10 documents, 3 candidates reading everything; the max−min of the new load is ≤ 1.
- `test_only_readers_of_the_language_are_proposed`.
- `test_documents_without_readers_are_listed`: `NO_READER` and `TOO_FEW_READERS` with `per_document=2`.
- `test_existing_load_is_respected`: a candidate with load 5 gets nothing while others have less.
- `test_excluded_users_are_never_proposed`.
- `test_the_api_proposes_writes_nothing_and_confirm_audits_the_seed`.

**Acceptance:** the tests pass; contract regenerated. Commit: `feat(admin): reproducible, language-aware distribution proposal`.

---

### Task 9: Progress, exports and jobs API (A5)

**Create** `api/job_routes.py`, `tests/test_progress_export_api.py`; **modify** `api/project_routes.py`.

**Progress:** `GET /api/v1/projects/{key}/progress` (`VIEW_PROGRESS`) returns:
- `documents: [{document_id, language, position, assignees: [{assignment_id, username, pseudonym, task, status}]}]`, in position order;
- `people: [{username, display_name, pseudonym, open, in_progress, submitted, reopened}]`, for active assignments;
- `totals: {documents, unassigned, open, in_progress, submitted, reopened}`.

One query groups assignments per document and per user; there is no per-document status call, which keeps the T2e dashboard budget.

**Document list for leads:** `GET /api/v1/projects/{key}/documents` (renamed in Task 1) accepts `language?`, `status?` (`unassigned` | an assignment status) and `q?` (id prefix). For holders of `VIEW_ALL_DOCUMENTS`, every item gains `assignees` as above. The visibility of Task 7 applies to everyone else.

**Exports:** `POST /api/v1/projects/{key}/exports` takes `{kind: "t1" | "edit_log"}`.
- It needs `EXPORT_ALL_WORK` or `EXPORT_EDIT_LOG` (Q5).
- It enqueues `t1_export` or `edit_log_export` (T2d) with `requested_by` and returns `{job_id}`.

**Jobs:**
- `GET /api/v1/jobs/{id}` returns `JobView = {id, kind, status, result, error, created_at, finished_at}`. Visible to the requester, and to holders of `VIEW_PROGRESS` in the job's project; otherwise 404.
- `GET /api/v1/jobs/{id}/download`:
  - only for succeeded `t1_export` and `edit_log_export` jobs, with the same export guard as the request;
  - streams the blob from `result.sha256` with `Content-Disposition: attachment; filename="<project>-<kind>-<UTC stamp>.zip|.jsonl"`;
  - audits `project.export_download`.
- The upload preview uses `GET /jobs/{id}` too.

**Tests:**
- `test_progress_counts_per_document_and_person`.
- `test_progress_is_for_leads_only` (annotator 403).
- `test_documents_filter_by_language_status_and_prefix`.
- `test_a_lead_exports_and_downloads_a_bundle`: the download reads with `ontospan.read_bundle`.
- `test_an_annotator_cannot_export_or_download_others_work`.
- `test_the_edit_log_download_is_pseudonymised`.
- `test_jobs_of_other_projects_are_invisible`.

**Acceptance:** the tests pass; contract regenerated. Commit: `feat(admin): progress, export and job API`.

---

### Task 10: Test harness, browser server and the gate

**Modify** `tests/auth_harness.py`, `tests/browser_server.py`, `frontend/browser/helpers.ts` (only if a selector changed in Task 1), `frontend/src/api/client.ts` (only the minimum to keep the old dashboard working: `openWorkspace` unchanged, `listProjects` renamed).

**Harness:**
- `AutoLoginClient` (T2b/T2c) additionally ensures an active assignment for the request's document. It takes the document from `json["document_id"]`, `json["workspace_key"]["document_id"]` or the decoded workspace id, with the task `TASK_FOR_MODE[mode]`. It inserts the assignment directly through `AssignmentService.assign(Actor.cli(), …, confirm_language=True)`.
- New helpers: `ensure_assignment(app, project_key, document_id, username, task)` and `logged_in(..., projects=…, assignments="all" | [(doc, task)])`. Tests that check that something is refused pass `assignments=[]`.

**Browser server:**
- `/__test_user__` also creates active `annotate` and `review` assignments for every document of the listed projects (`assign=all`, the default; `assign=none` to skip).
- New test-only route `POST /__test_ontology__?name=hp.json` adds a fixture ontology through `OntologyStore.add`. T3b's admin spec needs it.

**Acceptance:**
- `scripts/check.sh` passes, Playwright included.
- `CHECK_CONTAINERS=1 scripts/check.sh` passes; the T2e seed script now creates an assignment for the smoke annotator (add `ontotator admin assign smoke DOC USER --task annotate`, a CLI wrapper of `AssignmentService.assign`, and call it from `scripts/seed_stack.py`).
- Commit: `test: assignments in the harness and the browser server; CLI assign`.

---

## Spec coverage

| Spec item | Task |
|---|---|
| A1: T1 bundles and plain text; proposals keep provenance; pins and `allowed_roots` must match; UTF-8 only, BOM stripped, NFC/LF, `source_text_sha256`; one language per upload; file stem = `document_id` | 6 |
| A1: preview with count, duplicates, collisions, normalisation count, validation errors; nothing written before confirmation; job; audit | 6 |
| A1: an existing `document_id` with different text is refused | 6 |
| A2: manual multi-select assignment; members only; language-aware proposal with balanced load and recorded seed; editable, written on confirmation; unassignable documents listed; audited | 7, 8 |
| A3: annotators and adjudicators see only assigned documents; leads and admins see all with progress; server-enforced | 7, 9 |
| A4: `(project, document, user, task)` with `open`/`in_progress`/`submitted`/`reopened`; tasks `annotate` and `review`; reassignment with confirmation, the new assignee starts from the inputs; reopen with immutable earlier submissions | 2, 7 |
| A5 users: create with setup code, (de)activate, reset codes, admin flag, languages; self profile with display name, languages, ORCID, consent | 3 |
| A5 projects: name, description, languages, pinned ontology and `allowed_roots`, `require_chosen_axes`, adjudicator-not-annotator, guideline as `guideline_ref`, members and roles | 4, 5 |
| A5 ontologies: upload with release, SHA-256 and pinning projects | 4 |
| A5 documents, progress, export (T1 bundle and edit log) | 6, 7, 9 |
| T2 D-e: `package_id` → `project_key` | 1 |
| T7 O1, O2, I1, I3 through the upload path; O4 at submission and import | 5, 6 |
| T4 W1 language rule (manual assignment of a non-reader needs confirmation, audited), applied from T3 | 7 |
| Admin UI | T3b |
