# T2c: Projects, Authorization and the Edit Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Lean format: files, interfaces, tables, test cases and acceptance criteria per task. Implementers write the code test-first; code appears only where it defines a contract.

**Goal:** Projects have members with roles. One policy function decides what a user may do. Project data is reachable only through a membership. Every editing command and every administrative action is recorded append-only.

**Architecture:**
- **Data:** a migration adds `project_memberships` (one row per role), the append-only `edit_events` and `submissions.last_edit_event_id`.
- **Policy:** `authz/policy.py` holds the single `can(access, action, project)` with an explicit role/action table (P5).
- **Scoping:** `ScopedRepository` wraps the repository for one request and refuses every project the user cannot see, with 404 so the project's existence is not revealed (E3).
- **Edit log:** `Repository.run_mutation` writes one `edit_events` row per committed command in the same transaction, with the actor taken from the request context (D6, index D-k). A submission references the event that produced it.
- **Modes:** working modes follow the roles and replace the installation-wide distribution presets.
- **UI:** the dashboard lists the user's projects.

**Spec:** `docs/superpowers/specs/2026-10-14-t2-server-foundation-design.md` (P5, D6, E3, E9). Index: `docs/superpowers/plans/2026-10-14-t2-index.md`. Builds on T2b.

**Branch / worktree:** `feat/t2c-projects-authorization` from `feat/t2b-accounts-sessions`, worktree `.worktrees/t2c-projects-authorization`; set it up as in T2b. Baseline: `scripts/check.sh`.

**Commit rule:** per task, `uv run ruff check --fix src tests && uv run ruff format src tests && uv run mypy src`, then one conventional commit without AI attribution.

---

### Task 1: Memberships, edit events (migration 0003)

**Modify** `storage/tables.py`; **create** `storage/migrations/versions/0003_projects_edit_log.py`. Add `"edit_events"` to `APPEND_ONLY_TABLES`.

| Table / change | Columns | Keys |
|---|---|---|
| `projects` + | `description` text null | |
| `project_memberships` | `project_id` → projects; `user_id` → users; `role` text; `added_at` default now(); `added_by` → users null | PK (project_id, user_id, role); CHECK `role IN ('lead','annotator','adjudicator')` named `ck_project_memberships_role`; ix (user_id) |
| `edit_events` (append-only) | `id` bigint identity; `project_id` → projects; `draft_id` → drafts; `user_id` → users null; `session_id` → sessions null; `at` default now(); `mutation_id` text; `kind` text (`edit` or `submit`); `command` jsonb (the envelope payload); `revision_before` int; `revision_after` int; `state` jsonb; `submission_id` text null | PK id; ix (project_id, draft_id, id) |
| `submissions` + | `last_edit_event_id` bigint null → edit_events | |

The `state` of an event is the complete draft content after the command:

```json
{"annotations": [["<annotation_id>", "<version>"], ...],
 "evidence": [["<evidence_id>", "<version>"], ...],
 "decisions": [<ReviewDecision payload>, ...],
 "checked_layer_ids": ["..."]}
```

The pairs are sorted. Together with the content-addressed snapshot tables this reconstructs any revision of a draft without replaying commands. That satisfies D6's "reconstructed by replaying events over content-addressed snapshots": the replay is a lookup.

The grants and triggers are the contract:

```python
op.execute(
    f"CREATE TRIGGER edit_events_append_only BEFORE UPDATE OR DELETE ON {SCHEMA}.edit_events"
    f" FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.forbid_history_change()"
)
op.execute(
    f"CREATE TRIGGER edit_events_no_truncate BEFORE TRUNCATE ON {SCHEMA}.edit_events"
    f" FOR EACH STATEMENT EXECUTE FUNCTION {SCHEMA}.forbid_history_change()"
)
op.execute(
    f"GRANT SELECT, INSERT, UPDATE, DELETE ON {SCHEMA}.project_memberships TO {APP_ROLE}"
)
op.execute(f"GRANT SELECT, INSERT ON {SCHEMA}.edit_events TO {APP_ROLE}")
op.execute(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA {SCHEMA} TO {APP_ROLE}")
```

Adding the nullable `submissions.last_edit_event_id` is an `ALTER TABLE … ADD COLUMN` by the owner. It does not conflict with the append-only trigger, which fires only on row changes.

**Acceptance:** `uv run pytest tests/test_schema.py -q` gives `19 passed` (the comparison test plus 5 append-only tables × 3 statements plus 3). Commit: `feat(authz): project memberships and the append-only edit log`.

---

### Task 2: The policy

**Create** `src/ontocurator/authz/__init__.py`, `src/ontocurator/authz/policy.py` and `tests/test_policy.py`.

**Interface:**
- `Role = Literal["lead", "annotator", "adjudicator"]`.
- `class Action(StrEnum)`: `VIEW_PROJECT`, `OPEN_INDEPENDENT`, `OPEN_ASSISTED`, `OPEN_REVIEW`, `EXPORT_OWN_WORK`, `EXPORT_ALL_WORK`, `EXPORT_EDIT_LOG`, `IMPORT_DOCUMENTS`, `MANAGE_MEMBERS`, `CREATE_PROJECT`, `MANAGE_USERS`, `MANAGE_ONTOLOGIES`.
- `@dataclass(frozen=True) class Access`: `user_id: int`, `pseudonym: str`, `is_system_admin: bool`, `roles: Mapping[str, frozenset[Role]]`. The mapping goes from project key to roles.
- `can(access, action, project_key: str | None = None) -> bool`.
- `allowed_modes(access, project_key) -> list[WorkspaceMode]`, in the order independent, review, assisted, filtered by `can`.

**The policy table** (the contract; `MODE_ACTIONS = {"independent": OPEN_INDEPENDENT, "assisted": OPEN_ASSISTED, "review": OPEN_REVIEW}`):

| Action | System admin | Lead | Annotator | Adjudicator | Non-member |
|---|---|---|---|---|---|
| VIEW_PROJECT | yes | yes | yes | yes | no |
| OPEN_INDEPENDENT, OPEN_ASSISTED | no (needs annotator) | no | yes | no | no |
| OPEN_REVIEW | no (needs adjudicator) | no | no | yes | no |
| EXPORT_OWN_WORK | yes | yes | yes | yes | no |
| EXPORT_ALL_WORK, EXPORT_EDIT_LOG | yes | yes | no | no | no |
| IMPORT_DOCUMENTS | yes | yes | no | no | no |
| MANAGE_MEMBERS | yes | no (T3) | no | no | no |
| CREATE_PROJECT, MANAGE_USERS, MANAGE_ONTOLOGIES (no project) | yes | no | no | no | no |

Roles combine freely (E9): a user's rights are the union of their roles.

> **Resolved Q2:** `independent` and `assisted` need the annotator role, and `review` the adjudicator role. A lead or a system admin needs that role too.

> **Resolved Q4 (continued):** a system admin sees every project and its exports without a membership; annotating needs a membership.

> **Resolved Q5:** exports of other people's work and of the edit log are for the lead and the system admin.

**Tests:** `tests/test_policy.py`.
- `test_every_role_and_action` is parametrised over every (role set, action) cell of the table above for the role sets `{admin}`, `{lead}`, `{annotator}`, `{adjudicator}` and `{}`. It asserts exactly the table, about 60 cases. Implement it as a literal expected-matrix in the test, so the table is reviewable.
- `test_roles_combine`: `{lead, annotator}` can do `OPEN_INDEPENDENT` and `EXPORT_ALL_WORK`.
- `test_rights_do_not_leak_between_projects`: an annotator in A cannot `VIEW_PROJECT` B.
- `test_allowed_modes_follow_roles`: annotator gives `["independent", "assisted"]`, adjudicator `["review"]`, both together `["independent", "review", "assisted"]`, non-member `[]`.
- `test_project_actions_need_a_project`: `can(access, VIEW_PROJECT, None)` is False for everyone except a system admin.

Commit: `feat(authz): one policy for system and project roles`.

---

### Task 3: Memberships, access and project scoping

**Create:**
- `src/ontocurator/authz/memberships.py`:
  - `MembershipService(db, *, now=…)` with `add(actor, project_key, username, roles: Iterable[Role])`, `remove(actor, project_key, username, roles=None)`, `members(project_key) -> list[(username, pseudonym, frozenset[Role])]` and `access_for(principal) -> Access`;
  - `add` and `remove` audit `project.member_add` / `project.member_remove` with the `project_id` and the details `{username, roles}`;
  - they **revoke the user's sessions** (D2: a role change revokes the affected sessions);
  - unknown project: `PROJECT_NOT_FOUND`; unknown user: `USER_NOT_FOUND`; unknown role: `ROLE_INVALID`.
- `src/ontocurator/authz/scoped.py`: `class ScopedRepository(Repository)`, constructed as `ScopedRepository(db, access)`.
  - It overrides every public method that takes a `package_id`, a `WorkspaceKey` or a `SearchEventRecord`. Each first calls `self._visible(package_id)`, which raises `DomainError("PROJECT_NOT_FOUND")` unless `can(access, VIEW_PROJECT, package_id)`, then delegates.
  - `list_manifests` returns only visible projects.
  - Lookups without a project (`get_search_event`, `get_submission`, `get_annotation_snapshot`, `get_evidence_snapshot` with `package_id=None`) raise `DomainError("PROJECT_REQUIRED")`.
  - `import_package` additionally needs `can(access, CREATE_PROJECT)` for a new key, or `IMPORT_DOCUMENTS` for an existing one; otherwise `AccessDenied("NOT_ALLOWED")`.
- `src/ontocurator/auth/context.py`: move `current_principal: ContextVar[Principal | None]` here from `api/security.py`. `security.py` imports it; the repository reads it in Task 4.

Overridden methods (all public methods of `Repository` that touch project data): `import_package`, `get_search_conditions`, `capture_search_conditions`, `get_embedded_files`, `get_manifest`, `manifest_hash`, `list_manifests`, `get_task_profile`, `get_axes_config`, `get_document`, `list_documents`, `get_annotation_snapshot`, `get_evidence_snapshot`, `list_annotations_for_document`, `list_workspace_keys`, `open_draft`, `run_mutation`, `get_document_status`, `get_submissions_for_workspace`, `get_submissions_for_document`, `get_submission`, `save_search_event`, `get_search_event`, `append_search_event_candidates`, `get_search_events_for_workspace`, `export_package`.

A test enumerates `Repository`'s public methods and fails if a new one is not overridden or explicitly listed as project-free, so new methods cannot bypass the scope. Only `ontology_resources` and `package_manifest_hash` are project-free.

**Wiring (`api/routes.py`, `api/tree_routes.py`, `api/app.py`):**
- `get_repo(request)` returns `ScopedRepository(app.state.repo.db, access)`, where `access = memberships.access_for(principal)` is cached on `request.state`. All services are built per request from it, so they see only the scoped repository.
- `app.state.repo` stays the unscoped repository for start-up work (ontology restoration) and the CLI.
- An exception handler maps `PROJECT_NOT_FOUND` and `PACKAGE_NOT_FOUND` to 404, so a non-member cannot tell "missing" from "not yours".
- `POST /packages` (seed upload, admin only until T2d): if the project is new, the uploader becomes a member with all three roles (audited `project.create` plus the membership add). This keeps the UI flow usable until T2d replaces uploads with CLI imports.

**Tests:** `tests/test_project_scope.py`.
- `test_a_member_sees_only_their_projects`: alice is a member of A; `list_manifests` returns A only; `get_document("B", …)` raises `PROJECT_NOT_FOUND`.
- `test_every_project_method_checks_the_scope`: each overridden method called for B raises `PROJECT_NOT_FOUND`, with arguments built per method.
- `test_no_public_method_escapes_the_scope`: the enumeration test described above.
- `test_lookups_without_a_project_are_refused`: `PROJECT_REQUIRED`.
- `test_a_system_admin_sees_every_project`.
- `test_membership_changes_are_audited_and_end_sessions`: after `add`, the user's previous session no longer resolves; `audit_events` has `project.member_add` with the project id.
- `test_the_api_hides_foreign_projects`: in the API, alice gets 404 for `/api/v1/packages/B/documents`, and 404 again for an unknown project.

**Test harness update (`tests/auth_harness.py`):** `AutoLoginClient` additionally ensures that the current user is a member with all three roles of the project a request names. The project comes from `json["package_id"]`, `json["workspace_key"]["package_id"]`, a `/packages/<id>/` path or the decoded workspace ID. This keeps the converted API tests working. `logged_in(..., projects={key: roles})` grants explicit memberships for the new tests.

**Acceptance:** the full `uv run pytest -q` passes. Commit: `feat(authz): memberships, request access and project-scoped repository`.

---

### Task 4: The edit log (D6)

**Modify:**
- `storage/repository.py` `run_mutation`: after the operation succeeded and before the receipt, insert one `edit_events` row, in the same transaction:
  - `project_id` and `draft_id`;
  - `user_id` and `session_id` from `current_principal.get()` (NULL outside a request, e.g. the CLI or repository tests);
  - `mutation_id`; `kind = "submit"` for a `Submission` result, otherwise `"edit"`; `command = envelope.payload`;
  - `revision_before` and `revision_after`;
  - `state` as defined in Task 1 (for a submission: the draft's state at submit);
  - `submission_id`.

  For a submission, insert the event **first** and write its `id` to `submissions.last_edit_event_id`. A replayed receipt writes no event.
- `Repository` gets two new methods, which `ScopedRepository` scopes:
  - `edit_events(key) -> list[EditEvent]` (dataclass with the columns above, oldest first);
  - `draft_state_at(key, revision) -> DraftState`, the `state` of the event whose `revision_after == revision`, or the empty state for revision 0.

**Tests:** `tests/test_edit_log.py`.
- `test_every_committed_command_is_logged_once`: 3 mutations give 3 events with revisions 0→1→2→3; replaying a mutation ID adds none.
- `test_a_failed_command_logs_nothing`.
- `test_the_event_names_the_user_and_the_session`: via the API, `user_id` and `session_id` match the logged-in session.
- `test_any_revision_can_be_reconstructed`: after create, edit and delete commands, `draft_state_at(key, r)` equals the draft content observed after mutation r, for every r.
- `test_a_submission_references_its_last_event`: the submission row's `last_edit_event_id` is the `submit` event's id.
- `test_the_application_cannot_rewrite_the_log`: `UPDATE ontocurator.edit_events` fails with "permission denied".

**Acceptance:** the new tests pass and the full suite stays green. Commit: `feat(audit): append-only edit log for every editing command`.

---

### Task 5: Working modes from roles; the distribution presets go

**Delete:** `src/ontocurator/distribution_settings.py`, the field `AppConfig.distribution`, the route `GET /api/v1/settings`, `require_mode_allowed` and `tests/test_distribution.py`.

**New API:**
- `GET /api/v1/projects` returns `list[ProjectSummary]`, with `ProjectSummary = {package_id, name, description, roles: list[Role], allowed_modes: list[WorkspaceMode], document_count}`. It lists the user's visible projects, newest first. The project key keeps the field name `package_id` (index D-e) until T3.
- `GET /api/v1/packages` (manifest list) is removed; the frontend uses `/projects`.
- Mode enforcement: `open_workspace`, `get_review_inputs`, `apply_command`, `record_decision`, `submit_workspace` and the document list with `mode=review` require `can(access, MODE_ACTIONS[mode], project)`. Otherwise `AccessDenied("MODE_NOT_ALLOWED")`, which is 403, the same status as the old `ModeNotAllowed`.
- Review inputs are revealed in the document list only when the user may review (same blinding rule as before).

> **Resolved Q3 (changed behaviour):** a reviewer sees only what is assigned to them, because anything else could bias them. T2 has no assignments, so review mode shows **only the document's proposal sets**. It never shows other members' submissions or drafts. Their work becomes visible only through T4 workflow assignments (E8).

**Review inputs are proposals only (Q3):**
- `WorkspaceService.get_review_inputs(package_id, document_id)` returns `repo.list_annotations_for_document(...)`, filtered by the review scope's editable layers. It no longer reads `get_submissions_for_document`, and the `AMBIGUOUS_REVIEW_INPUTS` error goes, because it existed only for the union of several submitted origins.
- `WorkspaceService.open` in review mode takes its default targets from the same proposals.
- A reviewer's *own* earlier review submissions still restore into their draft, because a draft resumes the latest submission of its own key (T2a). That is the reviewer's own work, not other members'.
- `Repository.get_submissions_for_document` has no caller in the API after this change. Keep it for T4, and add a comment that it is not to be used for review inputs.

Tests:
- New `tests/test_project_modes.py::test_review_never_shows_other_members_work`: annotator A submits work on document d; adjudicator B opens review mode on d; B's review inputs and targets are exactly the proposals, and none of A's snapshots appear. The same holds through `POST /api/v1/workspaces/review-inputs`.
- Existing tests that relied on other annotators' submissions becoming review inputs: find them with `grep -rnE "AMBIGUOUS_REVIEW_INPUTS|get_review_inputs|review-inputs" tests` and with the failures after the change.
  - If a test checks behaviour *after* the inputs are chosen (decisions, adoption, rounds, submission integrity), seed the annotations it reviews as proposals (`ValidatedPackage.annotations`, or `pg_harness.insert_proposal`) instead of submitting them as another annotator.
  - If a test checks the union of submissions itself, or `AMBIGUOUS_REVIEW_INPUTS` (for example in `test_scientific_review_integrity.py`), delete it, and name it in the commit message.

**CLI (`cli.py`, `admin projects …`):**
- `list`: key, name, document count, member count.
- `members PROJECT`.
- `add-member PROJECT USERNAME --role lead|annotator|adjudicator` (repeatable).
- `remove-member PROJECT USERNAME [--role …]`.

All use `MembershipService` with `Actor.cli()`.

**Tests:**
- `tests/test_project_modes.py`:
  - `test_project_list_shows_roles_and_modes`: an annotator sees `allowed_modes == ["independent", "assisted"]`;
  - `test_an_annotator_cannot_open_review_mode`: 403 `MODE_NOT_ALLOWED`;
  - `test_an_adjudicator_reviews`;
  - `test_document_list_hides_review_inputs_from_annotators`;
  - `test_a_lead_without_annotator_role_cannot_annotate`.
- `tests/test_admin_cli.py` (extended): `test_members_can_be_added_listed_and_removed` (the output lists the roles; audit rows exist).
- The tests ported from `test_distribution.py` keep their intent with roles instead of presets: "review disallowed hides proposals", "disallowed mode rejected server-side".

**Acceptance:** `uv run pytest -q` passes. Regenerate the contract with `uv run python scripts/export_openapi.py && npm --prefix frontend run api:generate`. Commit: `feat(authz): working modes from project roles; review shows proposals only; project list endpoint`.

---

### Task 6: The dashboard lists the user's projects

**Modify** `frontend/src/api/client.ts`, `frontend/src/App.tsx` and the affected tests.

- `client.ts`:
  - `type ProjectSummary = components["schemas"]["ProjectSummary"]`;
  - `listPackages()` now calls `GET /api/v1/projects` and returns `ProjectSummary[]`. The method name stays until the T3 rename (index D-e), so the many existing spies on `listPackages` keep working;
  - `getSettings()` and `EffectiveSettings` are removed.
- `App.tsx`:
  - the select label "Work package" becomes "Project"; options show `name` (key);
  - the allowed modes come from the selected project's `allowed_modes`. If they are missing (old mocks), all modes; if there is exactly one, the fixed-mode display with the hint "Set by your role in this project.";
  - `settings` state, `loadSettings` and `openPackage` are removed. The preferred project is the last selected one, otherwise the first;
  - a project with no allowed mode shows "You have no working role in this project." instead of the hero card.
- Frontend tests:
  - `tests/distribution.test.tsx` becomes `tests/projectModes.test.tsx`. Its cases move from `getSettings` presets to `allowed_modes` in the `listPackages` mock: "hides the mode chooser and shows the fixed mode when only one mode is allowed", "offers only allowed modes and starts with the first", "shows a notice without a working role";
  - in `review-findings.test.tsx`, the tests "opens a zero-proposal case in a review-only distribution…" and "requires and sends explicit round selection…" replace their `getSettings` spy with `allowed_modes: ["review"]` on the mocked project;
  - check with `grep -rn "getSettings\|EffectiveSettings" frontend/src frontend/tests`, which must print nothing.
- Browser: `tests/browser_server.py` and the specs need no change. Uploading makes the test user a member with all roles (Task 3), and `#package-select` keeps its id.
- Rebuild the embedded assets as in T2b Task 9.

**Acceptance:** `scripts/check.sh` passes. Commit: `feat(frontend): projects with role-based working modes on the dashboard`.

---

## Spec coverage

| Spec item | Task |
|---|---|
| P5: `can(user, action, resource)` with system admin and lead/annotator/adjudicator; tests for every role × action incl. non-members | 2 |
| P5 / E3: every project query scoped by membership; isolation test (A never reads B) | 3 |
| P5: audit hook records every write (administrative: `audit_events`; editing: `edit_events`) | 3, 4 |
| D6: every editing command in `edit_events` in the same transaction; user, session, time, draft, revisions, command, resulting snapshot versions; INSERT/SELECT only; reconstruction; submission references its last event | 1, 4 |
| D2: role changes revoke the affected sessions | 3 |
| E9: roles combine freely | 2 |
| D5: memberships via CLI until T3 | 5 |
| Edit-log export (pseudonymised JSONL), T1 import/export, ontologies, jobs | T2d |
