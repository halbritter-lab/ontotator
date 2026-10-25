# M1 Follow-ups: Tool Proposal Icon and Translation Review Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement [2026-10-25-m1-followups-design.md](../specs/2026-10-25-m1-followups-design.md): (1) the robot icon means "this text has tool proposals" and shows in every annotation mode, muted (`IconBotOff`) when the text is annotated from scratch, and the card always shows the count; (2) the rule "Annotate translations only after an accepted review" moves to Settings → Workflow, every path that creates or moves annotate work onto a translation whose review is not accepted needs an explicit acknowledgement while the rule is off (`confirm_unreviewed_translation`, refusal `TRANSLATION_NOT_REVIEWED`, audited, shown in History), and the assign check uses the same "all roots accepted" test as next steps.

**Architecture:** One pure predicate in `domain/next_steps.py` (`translations_accepted`, `unreviewed_translation`) feeds the next steps, the read model (new row field `unreviewed_translation`, batch preview target field of the same name) and the assign check. The assign check lives in one place, `AssignmentService.check_assignable`, which every annotate allocation already passes (single, self, batch, distribution, reassign, move-to-version, carry); it loads the statuses of all live roots of the text (`application/text_targets.py`) and returns the acknowledgement in its eligibility tuple, so `_create` audits it next to the language override. The History line reads that audit event through the existing assignment loader of the read model (no migration). The frontend gates its dialogs on the preview flag (assign dialog, single and bulk) or on the 409 (reassign, move, carry).

**Tech Stack:** unchanged (Python 3.12, FastAPI, SQLAlchemy 2, PostgreSQL tests; React 18, TypeScript, Vitest, Playwright). No new dependencies, no migration (`0021` stays the last one).

**Open question pending a user decision (only one):** spec "Open questions" 1, icon after assignment. **This plan implements the proposal: the icon stays after someone is assigned.** If the user decides otherwise, only WP F1 changes (one condition in `proposalIconState` and two tests).

---

## Global rules (every WP)

Integration worktree `C:/Users/jan-p/Development/ontocurator/.worktrees/acceptance-20261023` (Git Bash `/c/Users/jan-p/Development/ontocurator/.worktrees/acceptance-20261023`), branch `feat/acceptance-20261023`. Lanes, heavy slots, ports and evidence paths as in Global rules 5, 7, 18 and 20 of [2026-10-23-proposal-check-text-card-consolidation.md](2026-10-23-proposal-check-text-card-consolidation.md); this plan needs at most two lanes (`acc-lane-1`, `acc-lane-2`).

1. Subagents never commit, push, `git reset`, `git checkout -- <file>`, `git stash`, `git clean` or `git merge`. The orchestrator commits each WP (`git add <owned files>`, never `git add -A` outside R1) with the WP's commit message, squash-merges into the feature branch. **No AI attribution, no `Co-Authored-By` trailer.**
2. A WP writes only the files in its **Owns** list. If it needs another file it stops and reports.
3. Run the WP's prerequisite command first; if it fails, stop and report.
4. Git Bash; `rg` is not installed, use `grep -rnE`.
5. **Contracts** (`contracts/openapi.json`, `frontend/src/api/generated.ts`, `contracts/admin-error-codes.json`) are never hand-edited: `uv run python scripts/export_openapi.py && npm --prefix frontend run api:generate` and `uv run python scripts/export_admin_error_codes.py`. Only B2 regenerates.
6. API changes are additive: every new request and response field has a default (`False`).
7. Verification per WP: only the touched modules (`uv run pytest -n 4 tests/<a>.py tests/<b>.py -q`, `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/<path>`, `npm --prefix frontend run typecheck`, `uv run ruff check . && uv run ruff format --check . && uv run mypy src`, after a regeneration `bash scripts/check.sh --only static`). Heavy runs inside a heavy slot. The full suites run once, in G1.
8. English for all files and UI copy; copy is verbatim from the "Copy" table. No `·` in new copy.
9. TDD: write the listed tests, run red, implement, run green.
10. Reviews: only B2 (backend-critical) gets one read-only `superpowers:code-reviewer` review, then one fix agent at effort medium. The whole diff gets one review in G1.
11. Hand-back: changed files, commands with exit status, done checklist, deviations, line-reference drift, commit message.

## Work packages

| WP | Title | Size | Kind | Review | Lane | Depends on |
|---|---|---|---|---|---|---|
| F1 | Proposal icon in every mode, `IconBotOff`, card count, browser test for switch and Undo | S | frontend, Playwright once | – | 1 | – |
| F2 | Rule checkbox to Settings → Workflow | S | frontend | – | 1 | F1 merged (same lane, no shared file) |
| B1 | Shared "all roots accepted" check; assign check closes the gap | S | backend, heavy | – | 2 | – |
| B2 | `confirm_unreviewed_translation` on every annotate path, `TRANSLATION_NOT_REVIEWED`, audit, read-model flags, CLI, fixture sweep (contracts) | L | backend, heavy | yes | 2 | B1 |
| F3 | Card note, assign dialog checkbox (single, bulk, self, random), reassign/move/carry confirmation, History line, error copy | M | frontend | – | 1 | B2 merged (contracts), F2 merged |
| G1 | Final gate, browser sweep for the new acknowledgement, whole-diff review | M | heavy, alone | final | integration | all |
| R1 | Embedded bundle rebuild (separate commit) | XS | light | – | integration | G1 |
| M1 | Manual check on the native test server | – | manual | – | – | R1 |

**Lanes.** Lane 1: F1 → F2 → F3. Lane 2: B1 → B2. F1, F2 run in parallel with B1, B2 (no shared file: frontend vs backend; contracts only in B2). F3 starts once B2 and F2 are merged. Then G1 → R1 → M1.

## Parallel ownership check

- F1 ‖ B1/B2: F1 owns only `frontend/src/ui/icons.tsx`, `frontend/src/documents/RowCells.tsx`, `frontend/src/styles/screens/documents-table.css`, `frontend/src/documents/textCard/AnnotationPart.tsx`, `THIRD_PARTY_NOTICES.md`, its tests and `frontend/browser/proposal-check.spec.ts`; B1/B2 own only files under `src/` and `tests/`, the contracts, `frontend/src/api/client.ts`, `frontend/src/api/generated.ts`, `frontend/tests/documents/fixtures.ts`.
- F2 ‖ B2: F2 owns `frontend/src/admin/ProjectSettingsPage.tsx`, `frontend/src/admin/projectFields.tsx`, `frontend/tests/variantAdmin.test.tsx`, `frontend/tests/projectSettings.test.tsx`.
- F3 owns `AnnotationPart.tsx` after F1 (same lane, after F1 merged) and `frontend/src/admin/errors.ts`, which no other WP touches.

## Shared contracts

### Names (do not rename)

| Name | Where | Meaning |
|---|---|---|
| `translations_accepted(is_source: bool, statuses: Iterable[str \| None]) -> bool` | `domain/next_steps.py` | every live root's target version is `accepted`; sources always true |
| `unreviewed_translation(facts: StepFacts) -> bool` | `domain/next_steps.py` | `not facts.is_source and not facts.rule_on and not translations_accepted(...)` |
| `text_translation_statuses(conn, project_id, row: TextRow) -> tuple[str \| None, ...]` | `application/text_targets.py` | `_target(chain).translation_status` of every live chain (`_live(_chains(...), discarded)`) |
| `confirm_unreviewed_translation: bool = False` | request models `AssignRequest`, `ReassignRequest`, `BatchAssignBody`, `MoveToVersionRequest`, `CarryRequest`; service kwargs | the lead's acknowledgement |
| `TRANSLATION_NOT_REVIEWED` (409) | `api/app.py`, `domain/admin_error_codes.py`, `errors.ts` | refusal without the acknowledgement; `details = {"document_ids": [<document id>]}` |
| audit action `assignment.unreviewed_translation` | `AssignmentService._create` | target the new assignment; details `{"document_id": …}` |
| `DocumentRowView.unreviewed_translation: bool = False` | read model | the card note |
| `WorkItemView.unreviewed_translation: bool = False` | read model | the History line |
| `BatchTargetView.unreviewed_translation: bool = False` | batch preview | the dialog checkbox |

### Copy (verbatim)

| Where | Text |
|---|---|
| Icon, from proposals | `{n} tool proposals; the annotation starts from them` (`1 tool proposal; …` for one) |
| Icon, from scratch | `{n} tool proposals; this text is annotated from scratch, the annotators do not see them` |
| Card, Annotation part (both modes) | `{n} tool proposals` (`1 tool proposal`) |
| Card note (rule off, translation not accepted) | `Translation not reviewed yet` |
| Settings → Workflow checkbox label | `Annotate translations only after an accepted review` |
| Settings hint | `Translations can be annotated only after their review is accepted. Native source texts are never held back.` |
| Dialog checkbox label | `Annotate before the translation review is accepted` |
| Dialog line naming texts | `Translation review not accepted yet: {text labels, joined with ", "}` |
| Dialog footer reason while unticked | `Confirm annotating before the translation review is accepted.` |
| Reassign/move/carry confirm button | `Annotate before the review is accepted` |
| History line | `Annotation assigned before the translation review was accepted (confirmed by {name})` |
| `errors.ts` `TRANSLATION_NOT_REVIEWED` | `This translation's review is not accepted yet. Confirm that it is annotated before the review is accepted.` |

---

## WP blocks

### F1: Proposal icon in every mode, `IconBotOff`, card count

- **Goal:** spec §1 "Change".
- **Owns:** `frontend/src/ui/icons.tsx`, `frontend/src/documents/RowCells.tsx`, `frontend/src/styles/screens/documents-table.css`, `frontend/src/documents/textCard/AnnotationPart.tsx`, `THIRD_PARTY_NOTICES.md`, `frontend/tests/documents/documentsTable.test.tsx`, `frontend/tests/documents/textCard.test.tsx`, `frontend/browser/proposal-check.spec.ts`.
- **Size / lane / review:** S / lane 1 / –.
- **Code to read:** `RowCells.tsx:346-358` (`proposalsWaiting`, `ProposalsIcon`), `:401` (the call in `RowStageCell`); `icons.tsx:109-121` (`IconBot`, Lucide paths scaled by `0.6667`); `documents-table.css:93-94, 158`; `AnnotationPart.tsx:40-58`; `PlanSteps.tsx:196-204, 222-232` (`cardChoiceLine`, the count rule of `CardPlanSelect`); `PlanChips.tsx:258-290` (`saveRow`: the "plan saved" toast with Undo already exists); `documentsTable.test.tsx:280-312` (three icon tests); `THIRD_PARTY_NOTICES.md:72-76`; `frontend/browser/proposal-check.spec.ts:166-180` and `proposalCheckHelpers.ts` (`proposalCheckScenario`, `openTextCard`, `showSegment`).
- **Prerequisites:** `grep -n "export function ProposalsIcon" frontend/src/documents/RowCells.tsx`.

Steps:
- [ ] **Tests first.** `documentsTable.test.tsx`: replace the three icon tests by
  - `the robot icon names the proposals and that the annotation starts from them` (mode `proposals`, 17 → title, `aria-label`, `role="img"` = `17 tool proposals; the annotation starts from them`; no `.documents-bot--off`);
  - `the robot icon stays after someone is assigned` (the case-141 rows of today's test: `case-141 de` with annotate work keeps the icon);
  - `a text annotated from scratch shows the muted robot icon` (mode `scratch`, 9 → class `documents-bot--off`, name `9 tool proposals; this text is annotated from scratch, the annotators do not see them`, the svg differs from the normal one: `querySelectorAll("path").length` of IconBotOff);
  - `no robot icon without proposals, outside the plan or with annotation off` (count 0; `notInPlanRow`; a planned row with `annotation_mode: null`).
  `textCard.test.tsx`: `the Annotation part shows the proposal count in both modes` (row with `proposal_count: 17` and mode `proposals`, then `scratch`: `17 tool proposals` visible both times; with `proposal_count: 0` no count line).
- [ ] **`IconBotOff`** in `icons.tsx` after `IconBot`, same wrapper (`scale(0.6667)`, `strokeWidth="2.25"`), paths verbatim from Lucide `bot-off` (`icons/bot-off.svg` of lucide-icons/lucide; check them there, they are expected to be):
  ```tsx
  <path d="M13.67 8H18a2 2 0 0 1 2 2v4.33" />
  <path d="M2 14h2" />
  <path d="M20 14h2" />
  <path d="M22 22 2 2" />
  <path d="M8 8H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 1.414-.586" />
  <path d="M9 13v2" />
  <path d="M9.67 4H12v2.33" />
  ```
  Comment line as for `IconBot`. `THIRD_PARTY_NOTICES.md`: the Icon line names `bot` and `bot-off` (`IconBot`, `IconBotOff`).
- [ ] **`RowCells.tsx`:** replace `proposalsWaiting` by
  ```ts
  /** The robot icon's state: the text is in the plan, has tool proposals and is planned for annotation (spec 2026-10-25 §1). */
  export function proposalIconState(row: DocumentRowView): { count: number; scratch: boolean } | null {
    const mode = row.annotation_mode?.mode;
    return isActiveRow(row) && row.proposal_count > 0 && mode ? { count: row.proposal_count, scratch: mode === "scratch" } : null;
  }
  ```
  `ProposalsIcon` renders `IconBotOff` and class `documents-bot documents-bot--off` when `scratch`, else `IconBot`; text from the Copy table with `plural(count, "tool proposal")` (`app/labels`). Update the doc comments (`:346`, `:352` "gone once someone is assigned" goes). `grep -rn "proposalsWaiting" frontend/src frontend/tests` must be empty afterwards.
- [ ] **CSS:** `.documents-bot--off { color: var(--text-muted); }` next to `.documents-bot`; the forced-colours rule at `:158` adds `.documents-bot--off { color: GrayText; }`. Update the comment at `:93` ("the text has tool proposals").
- [ ] **`AnnotationPart.tsx`:** after the plan control / mode lines, `{row.proposal_count > 0 && <p className="text-card-muted">{plural(row.proposal_count, "tool proposal")}</p>}`, in both branches (with and without `planControl`).
- [ ] **Browser test** in `proposal-check.spec.ts`: `switching a text with proposals to From scratch keeps the muted icon and Undo restores it` — `proposalCheckScenario(page, "FRESH")`, lead, `EN100024 en` (3 proposals, nobody assigned): the row's icon has name `3 tool proposals; the annotation starts from them`; open the card, Annotation segment, click radio `From scratch`; expect `Saved` in the card and the toast button `Undo`; the row icon now has name `3 tool proposals; this text is annotated from scratch, the annotators do not see them`; the card still shows `3 tool proposals`; click `Undo`; the icon name returns to the first text and radio `From proposals` is checked. Update the old text `3 tool proposals available; …` wherever the spec file asserts it (`grep -n "proposals available" frontend/browser/*.ts`; any other spec file found joins Owns, report it).
- [ ] Run: the two Vitest files, `npm --prefix frontend run typecheck`, then `HPO_E2E_PORT=<lane port> PLAYWRIGHT_WORKERS=1 npm --prefix frontend run test:e2e -- browser/proposal-check.spec.ts` (both heavy slots).
- **Commit:** `feat(documents): robot icon for every text with tool proposals, muted from scratch`

### F2: Rule checkbox to Settings → Workflow

- **Goal:** spec §2 "Move the checkbox".
- **Owns:** `frontend/src/admin/ProjectSettingsPage.tsx`, `frontend/src/admin/projectFields.tsx`, `frontend/tests/variantAdmin.test.tsx`, `frontend/tests/projectSettings.test.tsx`.
- **Size / lane / review:** S / lane 1 / –.
- **Code to read:** `ProjectSettingsPage.tsx:53` (`rulesOf`), `:105-106` (save bodies per section), `:188-213` (Rules and Workflow forms); `projectFields.tsx:81-82` (`WorkflowDraft`, `workflowOf`), `:96-138` (`WorkflowFields`, the "Texts with tool proposals" group); `projects/service.py:350-353` (PATCH uses `exclude_unset`, so a section sending fewer fields keeps the others); `variantAdmin.test.tsx:231-243, 289-296` (two tests use "Save rules").
- **Prerequisites:** `grep -n "project-rule-translations" frontend/src/admin/ProjectSettingsPage.tsx`.

Steps:
- [ ] **Tests first.** `variantAdmin.test.tsx`: both gate tests move to `section="workflow"` and `Save workflow`; the payload still contains `annotate_accepted_translations_only`. `projectSettings.test.tsx`: `the translation rule sits in Workflow below Texts with tool proposals` (the checkbox with the label of the Copy table and the hint text; it is not in the Rules section; Rules save does not send the field).
- [ ] `projectFields.tsx`: `WorkflowDraft` gets `annotate_accepted_translations_only: boolean`; `workflowOf` reads `settings.annotate_accepted_translations_only ?? true`; `WorkflowFields` renders `<Checkbox id={`${prefix}-translation-gate`} label=… hint=… />` directly after the "Texts with tool proposals" group.
- [ ] `ProjectSettingsPage.tsx`: drop the field from `rulesOf` and the Rules form (`:205`); the Workflow save (`:106`) sends `annotate_accepted_translations_only: workflow.annotate_accepted_translations_only`.
- [ ] Run the two Vitest files and typecheck.
- **Commit:** `feat(settings): translation review rule in the Workflow section`

### B1: Shared "all roots accepted" check

- **Goal:** spec §2 "Close the gap".
- **Owns:** `src/ontocurator/domain/next_steps.py`, `src/ontocurator/application/text_targets.py`, `src/ontocurator/assignments/eligibility.py`, `src/ontocurator/assignments/service.py` (`check_assignable` only), `tests/test_next_steps_domain.py`, `tests/test_unreviewed_translation_gate.py` (create).
- **Size / lane / review:** S / lane 2 / –.
- **Code to read:** `next_steps.py:106-179` (`StepFacts.translation_statuses`, `_accepted`, `_may_annotate`); `document_row_page.py:894, 980` (statuses are `_target` of each live chain); `text_targets.py` (whole; `_chains`, `_live`, `_target` from `work_plans`); `eligibility.py:93-123` (`check_variant_assignable`, rule-on branch looks at `variant.translation_status` only), `:186-200` (`require_annotation_gate`); `service.py:448-506` (`check_assignable`); `tests/test_translation_review_task.py:30-75` (`case_env`, `assigned`), `tests/t1_builders.py` (`native_unit`, `translation_unit`, `bundle`), `tests/t1_fixtures.py` (`create_project`, `run_import`), `tests/work_plan_support.py` (`plan_all`).
- **Prerequisites:** `grep -n "def _accepted" src/ontocurator/domain/next_steps.py`.

Steps:
- [ ] **Tests first.** `test_next_steps_domain.py`: `test_translations_accepted_needs_every_root` (sources true; `("accepted", "ready_for_review")` false; `("accepted", "accepted")` true). `tests/test_unreviewed_translation_gate.py` (new; fixture `gate_env`: project with source `en` and **two** translation units `de` of the same case (`DE_A`, `DE_B`, parallel roots), `plan_all`, lead and annotator `alice` reading `en`/`de`; helper `assign(env, document, **extra)` posting `{BASE}/assignments` with `confirm_language: True`): `test_rule_on_refuses_when_one_root_is_not_accepted` (set `DE_A` `translation_status="accepted"` in the DB, `DE_B` stays `ready_for_review`; assigning `DE_A` is refused with `TRANSLATION_NOT_ACCEPTED`; with both accepted it is created).
- [ ] `next_steps.py`: add `translations_accepted` (Names table); `_accepted(facts)` returns `translations_accepted(facts.is_source, facts.translation_statuses)`. (`stage_cells.py:298` keeps its own copy; not in scope.)
- [ ] `text_targets.py`: add `text_translation_statuses` (Names table), export it in `__all__`.
- [ ] `eligibility.py`: `check_variant_assignable(..., *, row_statuses: Sequence[str | None] | None = None)`; the rule-on branch tests `not translations_accepted(False, row_statuses if row_statuses is not None else (variant.translation_status,))`. Other callers (`proposals.py:349`, `translation_workflow.py:254`, `require_annotation_gate`) keep the one-version check: see "Plan decisions" D3.
- [ ] `service.py` `check_assignable`: for `task == "annotate"` and a translation (`translation_context(...) is not None`), load `text_translation_statuses(conn, project["id"], TextRow(variant.case_id, variant.language))` (local import, as `assign` imports `enable_review_for_accepted` from `work_plans`) and pass `row_statuses`.
- [ ] Run `uv run pytest -n 4 tests/test_next_steps_domain.py tests/test_unreviewed_translation_gate.py tests/test_translation_review_task.py -q`, ruff, mypy.
- **Commit:** `fix(assignments): annotation needs every translation root accepted, as next steps`

### B2: Explicit acknowledgement for unreviewed translations (contracts)

- **Goal:** spec §2 "With the rule off, … explicit acknowledgement" (backend), plus the read-model flags the frontend needs.
- **Owns:** `src/ontocurator/domain/next_steps.py` (`unreviewed_translation`), `src/ontocurator/assignments/service.py`, `src/ontocurator/assignments/batch.py`, `src/ontocurator/assignments/confirmations.py`, `src/ontocurator/application/text_changes.py`, `src/ontocurator/application/document_rows.py` (`_assignments`), `src/ontocurator/application/document_row_page.py` (`_work_item`, row dict), `src/ontocurator/domain/document_rows.py` (`AssignmentFact`), `src/ontocurator/api/assignment_routes.py`, `src/ontocurator/api/assignment_batch_routes.py`, `src/ontocurator/api/text_change_routes.py`, `src/ontocurator/api/document_row_routes.py`, `src/ontocurator/api/app.py` (status map), `src/ontocurator/domain/admin_error_codes.py`, `src/ontocurator/cli.py` (`assign`), contracts, `frontend/src/api/client.ts`, `frontend/tests/documents/fixtures.ts` (only if typecheck needs the new fields), `tests/test_unreviewed_translation_gate.py`, and the existing test helpers and fixtures that the sweep step changes (expected: `tests/test_translation_review_task.py`, `tests/proposal_check_support.py`, `tests/work_plan_support.py`, `tests/browser_carry_fixture.py`, `tests/browser_documents_scenarios.py`, `tests/browser_guideline_scenarios.py`, `tests/browser_lead_workflow_scenarios.py`, `tests/browser_overview_scenarios.py`, `tests/browser_problem_report_scenarios.py`, `tests/browser_values_scenarios.py`, `tests/test_text_change_*.py`, `tests/test_distribution_api.py`, `tests/test_case_api.py`; report the final list).
- **Size / lane / review:** L / lane 2 / yes.
- **Code to read:** `service.py:448-567` (`check_assignable` returns `(language, languages, mismatch, required)`; `_create` audits `assignment.language_override` then `assignment.create`), `:569-648` (`assign`; the lead's self-assignment confirms the language at `:608`), `:681-726` (`_assign_locked`), `:728-800` (`reassign`); `batch.py:115-130` (`_Target`), `:228-258` (`_Rows._target`), `:575-597` (target views), `:703-812` (`commit`; refusals become `ASSIGNMENT_BATCH_REFUSED` with `refused[].code`); `confirmations.py:67-180`; `text_changes.py:635-720` (`move_to_version`), `:893-1000` (`carry`), `:1047-1135` (`_carry_round`), `:1200-1260` (`_auto_carry`, `confirm_language=True`); `assignment_routes.py:197-238, 375-412, 526-535`; `assignment_batch_routes.py:134-160, 286-298`; `text_change_routes.py:40-70, 121-175`; `document_rows.py:579-615` (`_assignments`), `:548-576` (an audit read for the pattern); `document_row_page.py:556-580` (row dict), `:647-684` (`_work_item`), `:960-1000` (`StepFacts` per row in `ctx.step_facts`); `document_row_routes.py:102-124, 320-372`; `app.py:405-420`; `cli.py:862-910`; `tests/test_translation_review_task.py:205-233` (rule-off assign that now needs the flag).
- **Prerequisites:** B1 merged: `grep -n "def translations_accepted" src/ontocurator/domain/next_steps.py`.

Contract step first (all fields with defaults, then regenerate): request fields `confirm_unreviewed_translation: bool = False` on `AssignRequest`, `ReassignRequest`, `BatchAssignBody`, `MoveToVersionRequest`, `CarryRequest`; response fields `DocumentRowView.unreviewed_translation`, `WorkItemView.unreviewed_translation`, `BatchTargetView.unreviewed_translation` (all `bool = False`); `TRANSLATION_NOT_REVIEWED` in `admin_error_codes.py` and `app.py` (409); regenerate (Global rule 5); `client.ts`: if a generated request type marks the new field required, add it to that type's `Defaulted` list as `confirm_language` is (`client.ts:85`).

Steps:
- [ ] **Tests first** in `tests/test_unreviewed_translation_gate.py` (fixture `gate_env` from B1 with `annotate_accepted_translations_only=False`; `DE_A` `ready_for_review`):
  - `test_single_assign_needs_the_acknowledgement` — without the flag `refused[0].code == "TRANSLATION_NOT_REVIEWED"`; with `confirm_unreviewed_translation: True` created, and one audit event `assignment.unreviewed_translation` with `target_id == str(id)`, actor the lead.
  - `test_lead_assigning_themselves_needs_it_too` — rows with the lead's own username, task `annotate`.
  - `test_native_source_and_accepted_translation_never_ask` — the `en` source and a fully accepted row are created without the flag, no audit event.
  - `test_batch_needs_it` — `POST {BASE}/assignments/batch/preview` target has `unreviewed_translation: true`; commit without the flag → 409 `ASSIGNMENT_BATCH_REFUSED`, every `refused[].code == "TRANSLATION_NOT_REVIEWED"`, nothing created; with the flag created.
  - `test_confirmed_distribution_needs_it` — `POST {BASE}/assignments/proposal`, then `POST {BASE}/assignments` with its `context`: refused rows without the flag, created with it.
  - `test_reassign_needs_it` — an acknowledged assignment, `POST /api/v1/assignments/{id}/reassign` to another annotator: 409 `TRANSLATION_NOT_REVIEWED`, `details.document_ids == [DE_A]`; with the flag 200 and a new audit event on the replacement.
  - `test_move_to_version_and_carry_need_it` — build a correction `v2` of `DE_A` (`correction_unit`) that is not accepted, as `tests/test_text_change_service.py` builds versions; move an open annotate assignment and carry a submission (`mode="author"`): 409 without, success with the flag.
  - `test_rule_on_is_unchanged` — rule on: `TRANSLATION_NOT_ACCEPTED`; the flag does not bypass it.
  - `test_read_model_flags` — `GET` document rows: `DE_A` row `unreviewed_translation: true`, the source row `false`; after an acknowledged assignment the work item has `unreviewed_translation: true`; with the rule on the row flag is `false`.
- [ ] `next_steps.py`: add `unreviewed_translation(facts)` (Names table).
- [ ] `service.py`:
  - `check_assignable(..., confirm_unreviewed_translation: bool = False)`: for `task == "annotate"`, a translation, rule **off** and `not translations_accepted(False, statuses)` (statuses as B1 loads them) → `unreviewed = True`; without the flag raise `DomainError("TRANSLATION_NOT_REVIEWED", {"document_ids": [document_id]})`. Return the tuple with a fifth element `unreviewed`.
  - `_create`: unpack five; when `unreviewed`, `record_audit(conn, actor, "assignment.unreviewed_translation", target_type="assignment", target_id=assignment_id, project_id=…, details={"document_id": document_id}, at=now)` next to the language override.
  - `assign`, `_assign_locked`, `reassign`: new kwarg `confirm_unreviewed_translation: bool = False`, passed to `check_assignable`. The self-assignment does **not** auto-confirm it (unlike the language).
- [ ] `batch.py`: `_Target.unreviewed_translation: bool = False`, set in `_Rows._target` for `task == "annotate"` from the row dict (`row["unreviewed_translation"]`; pass the row into `_target` or set it in `match` after building the candidates); add it to the target views (`:589`); `commit(..., confirm_unreviewed_translation=False)` passes it to `_assign_locked`.
- [ ] `confirmations.py` `confirm(..., confirm_unreviewed_translation=False)` → `_assign_locked`; add it to the `assignment.distribute` audit details next to `confirm_language`.
- [ ] `text_changes.py`: `move_to_version(..., confirm_unreviewed_translation: bool = False)` (add it to its request hash), `carry` and `_carry_round` likewise (hash too); both pass it to `check_assignable`. `_auto_carry` passes `True` (D2).
- [ ] Routes: pass the body field through in `assignment_routes.assign` (both branches) and `reassign` (`**body.model_dump()` already), `assignment_batch_routes.commit_assignment_batch`, `text_change_routes` (`**body.model_dump()` already for move and carry).
- [ ] Read model: `AssignmentFact.unreviewed_translation: bool = False`; `_assignments` loads the set of assignment ids with an `assignment.unreviewed_translation` audit event of the project in one query (`select(AuditEventRow.target_id).where(project_id == pid, action == ...)`) and sets the flag; `_work_item` emits it; the row dict adds `"unreviewed_translation": steps_rules.unreviewed_translation(ctx.step_facts[key])` (check `ctx.step_facts[key]` is set before the row dict is built; else compute it where `step_facts` is built and keep it in `ctx`).
- [ ] CLI `assign`: option `--confirm-unreviewed-translation` (help `Explicitly confirm annotating translations whose review is not accepted.`), passed to `service.assign` (D1).
- [ ] **Sweep:** run the backend files that assign annotation with the rule off (`grep -rlnE "annotate_accepted_translations_only.*(False|rule_on)" tests`, plus `tests/test_text_change_*.py`, `tests/test_assignment_batch.py`, `tests/test_distribution_api.py`); where a helper or scenario assigns annotation on a translation that is not accepted on purpose, pass `confirm_unreviewed_translation=True` (service calls) or `"confirm_unreviewed_translation": True` (API calls) in the **shared helper**, not per test. Tests that assert a refusal keep failing deliberately and are adapted only where the spec changed the behaviour (e.g. `test_current_acceptance_gate_assignments_proposals_and_option_false` now needs the flag after switching the rule off).
- [ ] Run: `uv run pytest -n 4 tests/test_unreviewed_translation_gate.py tests/test_translation_review_task.py tests/test_assignment_batch.py tests/test_text_change_api.py tests/test_text_change_service.py tests/test_text_change_auto_carry.py tests/test_distribution_api.py tests/test_admin_error_codes.py -q` plus the sweep files, then `bash scripts/check.sh --only static`.
- **Commit:** `feat(assignments): explicit acknowledgement for annotating unreviewed translations`

### F3: Frontend acknowledgement, card note, History line

- **Goal:** spec §2 frontend: card note, required checkbox in the assign dialog (single and bulk), the History line; reassign, move and carry ask on the 409.
- **Owns:** `frontend/src/documents/textCard/AnnotationPart.tsx`, `frontend/src/admin/AssignWorkDialog.tsx`, `frontend/src/admin/DistributionDialog.tsx`, `frontend/src/admin/AssignmentActions.tsx`, `frontend/src/documents/HandleTextChangeDialog.tsx`, `frontend/src/documents/CarryDialog.tsx`, `frontend/src/documents/historyLines.ts`, `frontend/src/admin/errors.ts`, `frontend/tests/documents/textCard.test.tsx`, `frontend/tests/assignWorkDialog.test.tsx`, `frontend/tests/assignmentActions.test.tsx`, `frontend/tests/documents/handleTextChangeDialog.test.tsx`, `frontend/tests/documents/carryDialog.test.tsx`, `frontend/tests/documents/historyLines.test.ts`.
- **Size / lane / review:** M / lane 1 / –.
- **Code to read:** `AssignWorkDialog.tsx:140-205` (`reason` chain, `commit`, the self path via `createAssignments` with `confirm_language: true`, `assign`), `:285-359` (summary, `Random distribution…`, confirm section, `DistributionDialog` props); `DistributionDialog.tsx:40-60` (`batch.submit` body); `AssignmentActions.tsx:24-60` (`mutate`, the language `ConfirmDialog` pattern); `HandleTextChangeDialog.tsx:60-90`; `CarryDialog.tsx:60-170` (`confirming` for the language); `historyLines.ts:83-101` (work lines), `app/submissionLabels.ts` `personLabel`; `ui/Checkbox` usage in `ProjectSettingsPage.tsx:202`.
- **Prerequisites:** B2 and F2 merged: `grep -n "unreviewed_translation" frontend/src/api/generated.ts`.

Steps:
- [ ] **Tests first.**
  - `textCard.test.tsx`: `shows Translation not reviewed yet only for a flagged row` (`unreviewed_translation: true` → note; `false` → none).
  - `assignWorkDialog.test.tsx`: `the acknowledgement appears only for unreviewed targets and gates Assign` (preview mock with one target `unreviewed_translation: true`: checkbox with the Copy label, the line naming the text, `Assign` has `aria-disabled="true"` and the footer reason; ticking enables it; commit body has `confirm_unreviewed_translation: true`); `no acknowledgement for reviewed targets` (no checkbox; commit body without the flag or `false`); `bulk mode names every affected text`; `assigning myself sends the acknowledgement` (`createAssignments` body).
  - `assignmentActions.test.tsx`: `reassign asks before annotating an unreviewed translation` (first call rejects `ApiError(409, …, "TRANSLATION_NOT_REVIEWED")`, the confirm shows, confirming resends with `confirm_unreviewed_translation: true`).
  - `handleTextChangeDialog.test.tsx` and `carryDialog.test.tsx`: the same 409 → confirm → resend.
  - `historyLines.test.ts`: `an acknowledged annotation adds its line` (work item `unreviewed_translation: true`, `assigned_by` Ana Weber → `Annotation assigned before the translation review was accepted (confirmed by Ana Weber)`, stage `annotation`; shown also when the item is submitted and submissions are loaded).
- [ ] `AnnotationPart.tsx`: `{annotating && row.unreviewed_translation && <p className="text-card-muted">Translation not reviewed yet</p>}` below the count line.
- [ ] `AssignWorkDialog.tsx`: `const unreviewed = task === "annotate" && fresh ? fresh.targets.filter(t => t.unreviewed_translation) : []`; state `acknowledged` (reset in `changeStep`); render `<Checkbox>` with the Copy label and the naming line (`textLabel(target)` per target) above the summary; the `reason` chain adds the footer reason when `unreviewed.length && !acknowledged` (before "Choose a person first."); `commit` sends `confirm_unreviewed_translation: acknowledged` in the batch body and in the self `createAssignments` body; pass `confirmUnreviewedTranslation={acknowledged}` to `DistributionDialog`, which adds it to its `batch.submit` body. Random distribution stays reachable; its own Assign is not gated (the acknowledgement of the parent dialog applies; a refusal shows in its refused list with the `errors.ts` copy).
- [ ] `AssignmentActions.tsx`, `HandleTextChangeDialog.tsx`, `CarryDialog.tsx`: on `TRANSLATION_NOT_REVIEWED` show the existing confirmation pattern of each file with the text `Translation not reviewed yet.` and the confirm button `Annotate before the review is accepted`; confirming resends the same request with `confirm_unreviewed_translation: true` (keep the language flag and `confirm_started` already given).
- [ ] `historyLines.ts`: in the work loop, for `item.task === "annotate" && item.unreviewed_translation`, push `{ key: `unreviewed-${item.assignment_id}`, stage: "annotation", text: … }` before the `submitted` skip; the name is `personLabel(item.assigned_by.pseudonym, !!item.assigned_by.is_me, item.assigned_by)` (`app/submissionLabels`, as `who` formats people; fallback `the lead` when `assigned_by` is null); the test asserts what `personLabel` yields for the fixture person.
- [ ] `errors.ts`: `TRANSLATION_NOT_REVIEWED` with the Copy text.
- [ ] Run the six Vitest files and typecheck.
- **Commit:** `feat(documents): acknowledge annotating translations before their review is accepted`

### G1: Final gate (alone on the machine)

Integration worktree, all WPs merged:

```bash
cd /c/Users/jan-p/Development/ontocurator/.worktrees/acceptance-20261023
bash scripts/check.sh --only static
CHECK_VITEST_WORKERS=4 bash scripts/check.sh --only frontend
CHECK_PYTEST_WORKERS=4 bash scripts/check.sh --only backend
HPO_E2E_PORT=18771 CHECK_PLAYWRIGHT_WORKERS=2 bash scripts/check.sh --only browser
```

- [ ] **Browser sweep:** specs that assign annotation through the dialog on rule-off scenarios with unreviewed translations now meet the checkbox. Fix them once in the shared helper that assigns (`grep -rn "Assign annotators\|assignPerson" frontend/browser/*Helpers.ts`): tick `Annotate before the translation review is accepted` when it is visible. One fix agent (effort medium), only `frontend/browser/` files; rerun the failing specs alone (`HPO_E2E_PORT=18771 PLAYWRIGHT_WORKERS=1 npm --prefix frontend run test:e2e -- browser/<spec>.ts`), then the browser phase.
- [ ] Any other failure: one fix agent, rerun only that phase. Finally `HPO_E2E_PORT=18771 bash scripts/check.sh` once (last line `All local checks passed.`).
- [ ] Whole-diff review (`superpowers:code-reviewer`, read-only) over `git diff <base of F1>..feat/acceptance-20261023` with this checklist: every path that creates or moves annotate work calls `check_assignable` with the caller's flag (single, self, batch, distribution, reassign, move, carry, CLI, auto-carry); native sources and accepted translations never ask; the rule on still refuses with `TRANSLATION_NOT_ACCEPTED`; one audit event per acknowledged assignment; request hashes of move and carry include the flag; no UI copy outside the Copy table; the icon never shows on rows outside the plan.
- [ ] `git status --short` shows only committed WP files.

### R1: Embedded bundle rebuild (separate commit)

```bash
cd /c/Users/jan-p/Development/ontocurator/.worktrees/acceptance-20261023
npm --prefix frontend run build
rm -rf src/ontocurator/web && cp -r frontend/dist src/ontocurator/web
git status --short src/ontocurator/web
uv run python scripts/check_wheel.py
git add -A src/ontocurator/web
git commit -m "build: update embedded frontend bundle"
```

Only `src/ontocurator/web/**` changes; `check_wheel.py` passes.

### M1: Manual check on the native test server

Install the branch build as in the last run (`.worktrees/acceptance-20261023/build/m1-20261024/`), then on **e3c-proposals** (rule now on) and a project with the rule switched off for the check: (1) a text with proposals: switch From proposals ↔ From scratch in the card, muted icon, `Saved`, Undo; assign someone, the icon stays; (2) Settings → Workflow shows the rule below "Texts with tool proposals" with its hint; (3) rule off: EN100022 de (review running) shows `Translation not reviewed yet`, the assign dialog asks, History shows the line after assigning; bulk assign over two texts names both; (4) rule on: no "Assign annotation…" on EN100022 de. Findings into `FINDINGS-<date>.md` in the acceptance build folder, not the repo.

---

## Verification commands (local only; there is no CI)

| Check | Command |
|---|---|
| Lint, format, types, OpenAPI drift, error-code drift, TS API drift, wheel | `bash scripts/check.sh --only static` (runs `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy src`, `uv run python scripts/export_openapi.py --check`, `uv run python scripts/export_admin_error_codes.py --check`, `npm --prefix frontend run typecheck`, `npm --prefix frontend run api:check`, `uv run python scripts/check_wheel.py`) |
| Regenerate contracts | `uv run python scripts/export_openapi.py && npm --prefix frontend run api:generate && uv run python scripts/export_admin_error_codes.py` |
| Backend tests | `CHECK_PYTEST_WORKERS=4 bash scripts/check.sh --only backend` (single files: `uv run pytest -n 4 tests/<file>.py -q`) |
| Frontend unit tests | `CHECK_VITEST_WORKERS=4 bash scripts/check.sh --only frontend` (single files: `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/<path>`) |
| Browser spec of this plan | `HPO_E2E_PORT=18771 PLAYWRIGHT_WORKERS=1 npm --prefix frontend run test:e2e -- browser/proposal-check.spec.ts` |
| Browser suite | `HPO_E2E_PORT=18771 CHECK_PLAYWRIGHT_WORKERS=2 bash scripts/check.sh --only browser` |
| Everything | `HPO_E2E_PORT=18771 bash scripts/check.sh` → `All local checks passed.` |
| Bundle | R1 |

---

## Spec deviations (found against the code)

1. **Single assign does not answer 409 per text.** `POST /projects/{key}/assignments` returns 200 with `refused[].code` for each row (as `LANGUAGE_CONFIRMATION_REQUIRED` and `TRANSLATION_NOT_ACCEPTED` today, `assignment_routes.py:394-412`); the batch commit answers 409 `ASSIGNMENT_BATCH_REFUSED` with `refused[]` carrying `document_id` and the code (`batch.py:801-812`). Only reassign, move-to-version and carry raise `TRANSLATION_NOT_REVIEWED` 409 with `details.document_ids`. The plan keeps these existing envelopes.
2. **Route paths.** The batch route is `POST /api/v1/projects/{key}/assignments/batch`, not `/assignments/batch`; confirmed distribution proposals do not use it, they go through `POST /projects/{key}/assignments` with a `context` (`DistributionConfirmationService.confirm`). Both are covered.
3. **Two more paths create annotate work:** the CLI `ontocurator admin assign` (`cli.py:862`) and the automatic carry after a "finish, then carry" decision (`text_changes._auto_carry`, `confirm_language=True`). See D1, D2.
4. **Undo after a mode switch already exists.** The card's mode switch saves at once, shows `Saved` and the "plan saved" toast with Undo (`PlanSteps.tsx:249-282`, `PlanChips.tsx:258-290`), and Undo restores `annotation_mode` (`planUndo.ts:25-28`). F1 only adds the browser test.
5. **Filter and icon agree only on planned rows.** The facet counts every text with proposals (`document_row_facets.py:51-53`), also texts outside the plan, which never show the icon (spec: "and the text is in the plan"). In the default view (rows outside the plan hidden) they agree; with "show not in plan" a listed text can lack the icon. Not changed.
6. **Existing fixtures rely on annotating unreviewed translations with the rule off** (`tests/browser_*_scenarios.py`, `proposal_check_support.py`, `browser_carry_fixture.py`, `work_plan_support.py`, `test_translation_review_task.py:205`). They now need the flag; B2's sweep and G1's browser sweep handle this.

## Plan decisions (open to veto; WP to change in brackets)

- **D1** CLI `assign` gets `--confirm-unreviewed-translation` (default off), so the CLI follows the API rule [B2].
- **D2** The automatic carry passes the acknowledgement as `True`: the lead decided "finish, then carry" earlier, and the system actor is audited as the confirmer, so the History line reads "confirmed by" the stored assigner (fallback `the lead`) [B2, F3].
- **D3** The all-roots test applies to new allocations only (`check_assignable`). `require_annotation_gate` (workspace open and submit, rounds, scoped authorization) and the distribution proposal's preview (`proposals.py:349`) keep the one-version check, so importing a parallel translation later does not lock out running work [B1].
- **D4** Annotation **Off** on a planned text (Review on): no icon; the icon states how the proposals are used, and with Off they are not used [F1].
- **D5** The self-assignment ("Annotate from proposals myself" and the lead's entry in the dialog) does not auto-confirm the unreviewed translation, unlike the language; the dialog checkbox covers it [B2, F3].
- **D6** The History line is derived from the audit event (no new column, no migration) [B2].
