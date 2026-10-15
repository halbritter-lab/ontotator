# T2c implementation notes

Deviations from `docs/superpowers/plans/2026-10-14-t2c-projects-authorization-audit.md` (kept in the
`t2-plan` worktree), decisions the plan left open, and one requirement added outside the plan.
Each entry: task, what the plan said, what was done instead, why.
Entries marked **[open question]** are user-flow or domain questions the plan and the index did not
answer; the most conservative option was taken and should be confirmed.

## Baseline

- Worktree `.worktrees/t2c-projects-authorization-audit`, branch `feat/t2c-projects-authorization-audit`
  from `feat/t2b-accounts-sessions` at `e4bcdb8` (the plan named `feat/t2c-projects-authorization`;
  the branch was created under the longer name). The baseline gate was not rerun: `e4bcdb8` only adds
  documentation to `31f5fad`, whose gate was green (T2b notes).
- The plan was written before the T2b review fixes. Its steps did not touch the login lock order or
  the pseudonym reservation, so no conflict with the current code arose there.

## Added requirement: never leave the system without an active system admin

- `AccountService.set_system_admin(..., False)` and `set_active(..., False)` refuse to demote or
  deactivate the last active system admin with `DomainError("LAST_SYSTEM_ADMIN", "'<name>' is the
  last active system admin. Make another user a system admin first.")`. The CLI (`admin users
  deactivate`, `admin users set-admin --off`) goes through the service and prints
  `Error: LAST_SYSTEM_ADMIN: ...` with exit 1. There is no user-management API route yet (T2b has
  none, T3 adds it); any route built on the service inherits the rule.
- Concurrency: every change that could remove an admin takes the transaction-level advisory lock
  `advisory_lock_id("system-admins")` first, then locks the user row, then counts the other active
  admins inside the same transaction (READ COMMITTED, so the count sees a concurrent removal that
  committed while it waited). Lock order: this lock, then the user row; no path takes them the
  other way round. A single lock was chosen over locking every admin row, because it needs no
  ordered multi-row lock and does not wait for logins (`FOR NO KEY UPDATE` on user rows).
- Adding or activating never takes the lock. Demoting an inactive admin, or deactivating a non-admin,
  is allowed (it does not change the number of active admins).
- Tests: `tests/test_accounts.py::test_the_last_active_admin_can_be_neither_demoted_nor_deactivated`,
  `::test_an_admin_may_go_while_another_active_admin_stays`,
  `::test_two_admins_removed_at_once_leave_one[demote|deactivate]` (the first removal holds its
  transaction open; the second is released only once it waits for a lock or has finished; exactly
  one is refused) and `tests/test_admin_cli.py::test_the_last_active_admin_is_kept`. The existing
  tests that removed the only admin (`test_changes_revoke_sessions`, `test_every_change_is_audited`,
  `test_reset_deactivate_and_admin_flag`) now keep a second admin.
- This closes the T2b open risk "Deactivating or demoting the last active system admin is not
  prevented". The offline recovery (`recover-admin`) is unchanged; it only works for an active admin,
  which now always exists.

## Deviations and decisions

- Task 1: acceptance "`tests/test_schema.py` gives `19 passed`" -> `23 passed`: the file already had
  19 before T2c (T2b review), `edit_events` adds three append-only cases, and one new test checks
  `ck_project_memberships_role`. Not in the plan: `edit_events.kind` has a `CHECK (kind IN ('edit',
  'submit'))` named `ck_edit_events_kind`, and the new foreign key of `submissions` is named
  `fk_submissions_last_edit_event_id`.
- Task 2: the policy table is a literal matrix in `tests/test_policy.py` (12 actions x 5 role sets =
  60 cases) plus a check that it names every `Action`. `can(access, SYSTEM_ACTION, project)` ignores
  the project. `allowed_modes` for a system admin without roles is `[]` (Q2).
- Task 3: `MembershipService.add` / `remove` with roles the user already has (or lacks) change
  nothing: no audit row, no revoked session (as T2b's `set_active` with the current value). `add`
  with no role is `ROLE_INVALID`. Both return the user's roles afterwards. The audit row's
  `target_type` is `user`, `target_id` the username, `details` `{username, roles}` with the roles that
  actually changed.
- Task 3: the plan's `import_package` rule ("CREATE_PROJECT for a new key, IMPORT_DOCUMENTS for an
  existing one") -> allowed iff `CREATE_PROJECT` or `IMPORT_DOCUMENTS` in that key, without looking
  up whether the key exists. A lead only holds `IMPORT_DOCUMENTS` in projects that exist, so the
  outcome is the same, and a missing and a foreign key are refused alike (`NOT_ALLOWED`), revealing
  nothing.
- Task 3: "if the project is new, the uploader becomes a member" -> `Repository.import_package`
  takes an `on_create(conn, project_id)` hook that runs in the creating transaction only when the
  project is new; `ScopedRepository` uses it to audit `project.create` and grant the creator all three
  roles (`project.member_add`) atomically with the creation. **The creator's session is not revoked**:
  revoking it would log the uploader out in the middle of the dashboard flow the plan wants to keep
  usable; access is computed per request anyway, so the new roles apply at once. A re-upload of an
  existing project grants nothing.
- Task 3: the scoped repository gets an `actor` (the API passes `Actor.user(...)`) for that audit.
  `get_repo` and `get_access` cache the scoped repository and the access on `request.state`.
- Task 3: the 404 mapping covers `PROJECT_NOT_FOUND` and `PACKAGE_NOT_FOUND` in the general
  `DomainError` handler (`NOT_FOUND_CODES` in `api/app.py`). For a system admin an unknown project is
  therefore 404 instead of the former 422 `PACKAGE_NOT_FOUND`.
- Task 3: `ScopedRepository.list_manifests` (and Task 5's `list_projects`) filter instead of
  refusing; the enumeration test lists them separately.
- Task 3: `tests/test_tree_api.py::test_a_failing_draft_lookup_does_not_skip_the_layer_check`
  patched `open_draft` on `app.state.repo`; requests now read through their own scoped repository,
  so it patches `Repository.open_draft` on the class.
- Task 3: `auth/context.py` imports `Principal` only for type checking, because the storage layer
  now imports the module and `auth.sessions` imports back into the storage layer (circular import).
- Task 3: `tests/test_auth_api.py`: the non-admin users of the identity tests are annotators of the
  package (`MEMBER`), since a non-member now gets 404 before the identity check.
- Task 3 (harness): `AutoLoginClient` grants its user every role in the project a request names
  through `MembershipService.add` and logs in again, because the grant ends the session (D2). A
  project that does not exist yet is skipped and tried again on the next request.
- Task 4: `DraftState` (sorted `(id, version)` pairs, decision payloads in order, checked layers in
  stored order) and `EditEvent` are frozen dataclasses in `storage/repository.py`. For a submit the
  state is taken from the draft before the operation runs (the operation may change it in place);
  the submit event is inserted first and its id goes into the submission's INSERT, so the
  append-only submission row is never updated. `draft_state_at` raises `REVISION_NOT_FOUND` for a
  revision no logged command produced (e.g. the revision a draft resumed from a submission started
  at); revision 0 is the empty state, as the plan says, even for such a resumed draft.
- Task 4: `edit_events` / `draft_state_at` raise `PACKAGE_NOT_FOUND` for an unknown project and
  return `[]` for an unknown draft.
- Task 5: "the document list with `mode=review` requires `OPEN_REVIEW`" and "review inputs are
  revealed in the document list only when the user may review" contradict each other -> the list
  keeps answering 200 and only `has_review_inputs` is hidden (`None`) for a user who may not review,
  as the deleted distribution test did ("review disallowed hides proposals"). **[open question]**
  Should the list instead refuse `mode=review` with 403?
- Task 5: `require_mode` first checks `VIEW_PROJECT`, so a foreign project is 404 everywhere, also
  on the mode-checked routes.
- Task 5: reading other annotators' document status and exports (`annotator_id` of another
  pseudonym on `/packages/{id}/documents` and `/packages/{id}/export`) now follows
  `can(access, EXPORT_ALL_WORK, project)`, i.e. system admins and leads (resolved Q5); before it was
  system admins only. The plan did not mention these routes. Test:
  `tests/test_project_modes.py::test_a_lead_reads_other_members_work_and_an_annotator_does_not`.
- Task 5: `ModeNotAllowed` and its handler are deleted; `MODE_NOT_ALLOWED` is an
  `AccessDenied` (403, same body).
- Task 5: project listing is a new public repository method `list_projects()` (`ProjectInfo`:
  key, name, description, document count; newest first), scoped like the manifests. `ProjectSummary`
  lists the roles sorted alphabetically.
- Task 5: CLI output formats (not in the plan): `projects list` prints `key\tname\tN documents\tN
  members` (singular for 1); `members` prints `username\tpseudonym\troles` (roles sorted, comma
  separated); `add-member` / `remove-member` print `'<user>' in '<project>': <roles>.` (or `no
  role`). `remove-member` without `--role` removes every role.
- Task 5: tests changed for Q3 (review inputs are proposals only):
  `test_scientific_review_integrity.py::test_new_reviewer_targets_latest_version_without_promoting_history`
  deleted (it checked the union of submissions); `::test_selecting_review_inputs_does_not_export_entire_package`
  now expects the proposals; `::test_review_round_continues_after_export_reimport` expects a new
  reviewer of the re-imported project to start from that project's proposals (an export carries its
  annotations as proposals); `::test_new_reviewer_does_not_guess_between_origin_branches` lost its
  `AMBIGUOUS_REVIEW_INPUTS` half and is now `test_a_reviewer_does_not_guess_between_origin_branches`
  (the reviewer's own restore still refuses two origins). `tests/test_distribution.py` is deleted;
  its API cases live on in `tests/test_project_modes.py` and in the role-based
  `test_tree_api.py::test_tree_requests_are_refused_in_a_mode_the_roles_do_not_give`. Callers of
  `GET /api/v1/packages` in tests use `/api/v1/projects`.
- Task 6: removing `GET /api/v1/packages` removed `PackageManifest` (and `AxesConfig`) from the
  contract, since the upload answers an untyped object -> `client.ts` declares a small local
  `PackageManifest` interface (`package_id`, `document_order`) for the upload answer; the backend
  contract is unchanged otherwise.
- Task 6: the select options show `name (key)`, or only the key when the name equals it (projects
  created from uploads are named after their key). **[open question]** Confirm the label format.
- Task 6: a project without a working role shows "You have no working role in this project." in the
  hero's place and no mode chooser; the case table is still listed (the document list needs only
  `VIEW_PROJECT`). The old "Preselects the configured package" test is replaced by "names the
  projects and selects the first".
- Task 6: "the specs need no change" -> `workflow.spec.ts` mocked `GET /api/v1/packages` for the
  empty-dashboard check and now mocks `/api/v1/projects`. The Playwright fixture server
  (`tests/browser_server.py`) gained a test-only middleware: after a successful upload the uploading
  test user gets every role in the project (without ending the session), because the specs share one
  server and later specs re-upload projects an earlier spec created (the server itself only makes the
  creator of a new project a member).

## Open questions (user flow or domain logic)

- Document list with `mode=review` for a user without the adjudicator role: hide the review inputs
  (done) or refuse with 403?
- Project select label: `name (key)`, key alone when equal (done)?
- Should a system admin who re-uploads an existing project become a member (today: only the creator
  of a new project)?

## Open risks

- Membership changes end the user's sessions (D2) even though access is computed per request; a
  user added to a second project is logged out of the first. This follows the plan.
- `GET /api/v1/projects` computes the document count with one subquery per project; fine for the
  expected number of projects.

## Final gate

- `bash scripts/check.sh` at `84ef2ed`: all steps green ("All local checks passed.", 575 s).
  Backend 875 passed, 1 skipped (the POSIX-only recovery file permission test on Windows); vitest
  320 passed in 33 files; Playwright 34 passed. The one pytest warning (Starlette's `httpx` test
  client deprecation) predates T2c.
