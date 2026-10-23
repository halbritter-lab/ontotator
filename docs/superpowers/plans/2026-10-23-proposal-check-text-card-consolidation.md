# Proposal Check, Text Card, Consolidation Table, Text View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement [2026-10-23-proposal-check-text-card-consolidation-design.md](../specs/2026-10-23-proposal-check-text-card-consolidation-design.md): imported tool proposals can be checked as the annotation step of a text (Q1–Q3), one click on a Documents row opens a centered text card with the path Translation → Annotation → Finalization, Documents rows become one line, consolidation choices are made in a comparison table with one finding per group, the read-only text view gets one toolbar with a "Show" choice, plus the small-fixes list.

**Architecture:** A new workspace mode `proposal_check` is the review screen over the text's tool proposals, owned by an ordinary **annotate** assignment, so it counts towards "annotations per text" and its submission is an annotation for Finalization without touching the comparison rules. Which mode an annotate assignment gets is decided once, at assignment time, from a pure rule (`domain/annotation_modes.py`): project setting `tool_proposal_mode` (default `check`), per-text plan override `work_plan_rows.annotation_mode`, "no proposals → blind", and a lock once any annotate assignment exists (the mode is stored on `assignments.annotation_mode`). The read model adds proposal count, annotation mode, assignment dates and consolidation progress to the Documents rows; the frontend replaces the row side panel with a `TextCard` dialog and reuses one `StagePath` component in the card and on the consolidation screen. Consolidation drops `keep_both`/`term_choices`/`term_parts` on server and client. The text view gets a layer list endpoint (with unavailable entries and reasons) and a final-result layer.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2, Alembic, PostgreSQL (pytest via testcontainers or `ONTOCURATOR_TEST_PG_URL`, pytest-xdist); React 18, TypeScript, Vitest + Testing Library, Playwright + axe-core; `openapi-typescript` for `generated.ts`. No new dependencies (the Lucide "bot" icon is vendored as two SVG paths).

**Binding inputs:** the spec above (sections 1, 2, 2b, 3, 4, "Small fixes", "Testing"); mockups in the main checkout only (gitignored, reference, the spec wins): `.superpowers/brainstorm/189250-1792745471/content/` (`text-card-path.html`, `text-card-before-after.html`, `consolidation-group.html` variant B, `text-view.html`, `documents-rows-v3.html`, `proposal-icon.html` variant C); findings `.worktrees/manual-20261021/build/t5-acceptance/manual-test-20261021/FINDINGS-20261023.md` (F1–F25, V1–V8); `DESIGN.md`; `PRODUCT.md`.

**Plan decisions on spec ambiguities** (open to veto; each names the WP to change): see "Spec ambiguities resolved by this plan" at the end. No WP waits for a confirmation.

---

## Global rules (every WP; a subagent reads only this section, "Shared contracts" and its WP block)

Worktree: `C:/Users/jan-p/Development/ontocurator/.worktrees/proposal-check` (Git Bash: `/c/Users/jan-p/Development/ontocurator/.worktrees/proposal-check`), branch `feat/proposal-check-text-card`. Create it from the main checkout **from `main` after `docs/acceptance-20261023-design` is merged**; if it is not merged yet, from `docs/acceptance-20261023-design` (docs-only commits on top of `main` 5478ddd): `git worktree add .worktrees/proposal-check -b feat/proposal-check-text-card <base>`, then `uv sync` and `npm --prefix frontend ci` in the worktree. Every command runs from the worktree root: `cd /c/Users/jan-p/Development/ontocurator/.worktrees/proposal-check && …`. Line references were verified on `docs/acceptance-20261023-design` at `80dde72` (code identical to `main` 5478ddd); a WP re-checks each reference with `grep -n` and reports drift instead of guessing.

1. **Subagents never commit, push, `git reset`, `git checkout -- <file>`, `git stash` or `git clean`.** They edit the working tree. The orchestrator commits each WP after its done check with the WP's commit message, staging only the WP's owned files (`git add <files>`, never `git add -A`). No AI attribution anywhere (no `Co-Authored-By`, no "Generated with").
2. **Exclusive file ownership.** A WP writes only the files in its **Owns** list (tests included). If it needs another file it stops and reports. Shared files follow "Shared-file chains".
3. **Prerequisite checks first.** Run the WP's prerequisite commands; if one fails, stop and report. Never re-implement a missing prerequisite.
4. **Shell.** Git Bash. `rg` is not installed; use `grep -rnE`.
5. **Machine limits (16 GB RAM).** At most **two test-heavy agents at once** on the machine (across all worktrees). Heavy = pytest touching PostgreSQL, a full Vitest run, Playwright, `scripts/check.sh` except `--quick` on frontend-only changes. Light = pure-Python pytest without a database, single Vitest files, `npm --prefix frontend run typecheck`, ruff/mypy, generators; at most three light agents at once. **One Playwright run per machine at a time.**
6. **Verification.** WP agents run only affected checks: one backend file `uv run pytest tests/<file>.py -q`; several `uv run pytest -n 4 tests/<a>.py tests/<b>.py -q`; Vitest files `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/<path>`; `npm --prefix frontend run typecheck`; `uv run ruff check . && uv run ruff format --check . && uv run mypy src`; after a regeneration `bash scripts/check.sh --only static`; or `bash scripts/check.sh --quick <paths…>`. **No WP runs the full backend, full Vitest or full Playwright suite**; the full gate runs once (WP G1).
7. **Playwright.** This worktree uses `HPO_E2E_PORT=18771` (others: 18765–18768 in older worktrees; check it is free with `netstat -ano | grep -c ":18771 "` → `0`, else take the next free port ≥ 18772 and say so in the hand-back): `HPO_E2E_PORT=18771 PLAYWRIGHT_WORKERS=1 npm --prefix frontend run test:e2e -- <spec>` (rebuilds `frontend/dist`). Evidence (screenshots) only under `build/proposal-check/evidence/` in the worktree; no Playwright scratch in the main checkout.
8. **Isolated browser scenarios.** Every new or changed Playwright test builds its own fresh project through a test-only route (`/__test_proposal_check__`, `/__test_consolidation__`, `/__test_documents__`, `/__test_overview__`, …). No test writes a project another test uses.
9. **Static gate during parallel work.** `scripts/check.sh --only static` checks the whole tree and may fail on a sibling WP's in-progress files; a WP fixes only failures in its own Owns and reports the others.
10. **Contracts.** `contracts/openapi.json`, `frontend/src/api/generated.ts`, `contracts/admin-error-codes.json` are never hand-edited. Regenerate with `uv run python scripts/export_openapi.py && npm --prefix frontend run api:generate` and `uv run python scripts/export_admin_error_codes.py`. **One contracts writer at a time, in the order P3 → P4 → P7 → P5 → P8** (orchestrator hands over a "contracts token"). A writer also adds its `frontend/src/api/client.ts` functions and new defaults in `frontend/tests/documents/fixtures.ts`, so the tree typechecks after each writer. New error codes go into `src/ontocurator/domain/admin_error_codes.py` (sorted) and get a message in `frontend/src/admin/errors.ts` (same writer).
11. **API changes are additive** (new response fields have defaults) except the spec-mandated removals in P7 (`keep_both`, `term_choices`, `term_parts`).
12. **Migration numbering.** P1 creates `0020_proposal_check.py`, `revision = "0020"`, `down_revision = "0019"`. If another branch lands `0020` on `main` first, rename to the next free number before the merge, set `revision`/`down_revision`, update `tests/test_proposal_check_migration.py` (`REVISION`, `PREVIOUS`); never renumber a migration already on `main`.
13. **DocumentsPage token.** `frontend/src/admin/DocumentsPage.tsx` and `frontend/tests/documentsPage.test.tsx` have one writer at a time, in the order **U3 → U4 → U5 → U8 → U9**. Frontend WPs build components and component tests first and wire the page last, after the orchestrator hands them the token.
14. **English** for all files and UI copy; copy is verbatim from the spec or from the "Copy" lists in the WP blocks. No `·` in any new or changed copy (spec F11; WP U9 removes the rest). Icons only from `frontend/src/ui/icons.tsx`. Status never by colour alone. Unavailable actions use `aria-disabled` + `aria-describedby` reason (existing `Button`), never native `disabled`. Colours only from `frontend/src/styles/tokens.css` (enforced by `frontend/tests/tokens.test.ts`); U0 is the only WP that adds tokens.
15. **TDD.** Write the listed failing tests first, run them red, implement, run green.
16. **Reviews.** Only WPs flagged "review: yes" (L or backend-critical) get one read-only review by the `superpowers:code-reviewer` agent, then one fix agent at effort medium. After the final gate, one review of the whole diff by the same agent. No Codex.
17. **Hand-back** (final message): changed/created/deleted files (subset of Owns), commands with exit status and one-line result, done checklist item by item, skipped parts and deviations, line-reference drift found, open risks, the commit message.

## Work packages

| WP | Title | Size | Lane | Review | Wave | Depends on |
|---|---|---|---|---|---|---|
| P1 | Migration 0020, ORM, pure annotation-mode rule | M | heavy | yes | 1 | – |
| U0 | Design foundations: axis tokens, bot/more icons, `StagePath`, `AssignedDate`, `AxisValue`, network errors | M | light (L+) | – | 1 | – |
| P2 | Workspace mode `proposal_check` (review-like) | L | heavy | yes | 2 | P1 |
| P3 | Annotation mode on assignments, per-text limit, remove, "Check proposals myself" (contracts 1) | L | heavy | yes | 3 | P1, P2, U0 |
| P4 | Project setting, plan override, mode lock (contracts 2) | M | heavy | yes | 4 | P3 |
| P6 | Export fields for proposal checks + docs | S | heavy | – | 4 | P2 |
| P7 | Consolidation server: one finding per group, keep-both removed, progress helper (contracts 3) | M | heavy | yes | 5 | P4 (token) |
| P5 | Read model: proposals, modes, dates, facet, progress, My tasks (contracts 4) | M | heavy | yes | 6 | P7 |
| P8 | Text view layers and final-result layer (contracts 5) | M | heavy | yes | 7 | P5 |
| U1 | Task and action names (F1, F16) | S | light | – | 7 | P7 |
| U2 | Proposal check in the editor, My tasks, assign dialog, Settings → Workflow, F8, V2 | M | L+ | – | 8 | U1, P5 |
| U6 | Consolidation table screen | L | L+ | yes | 8 | U0, U1, P7 |
| U3 | Text card (replaces RowPanel) | L | L+ | yes | 9 | U0, U1, U2, P5 |
| U7 | Text view (replaces CaseViewer fold-out), axis colours in editor list and compare | M | L+ | – | 9 | U0, P8 |
| U4 | One-line rows, row click, selection bar 2+, robot icon, filter, More menu, overflow, F2/F7/V4/V7 | L | L+ | yes | 10 | U3 |
| U5 | "Change plan…" / "Plan…" rework (F5) | M | L+ | – | 11 | U4, P4 |
| U8 | Small fixes: F13, F18, V3, V4 (rest), V5, V6 | S | light | – | 12 | U5 |
| T1 | Browser scenarios (proposal check, three-person consolidation) | M | heavy | – | 12 | P8 |
| U9 | Separator sweep (F11) | S | light (one full Vitest run) | – | 13 | U8 |
| T2 | New browser specs: proposal check e2e, text card, consolidation 3 people, text view, rows | L | heavy (Playwright) | yes | 14 | T1, U9 |
| T3 | Existing browser specs on the new UI + spans-resize flake | L | heavy (Playwright) | – | 15 | T2 |
| G1 | Final gate in batches | – | heavy, alone | – | 16 | all |
| R1 | Embedded bundle rebuild (separate commit) | XS | light | – | 17 | G1 |
| M1 | Manual acceptance on the native test server | – | manual | – | 18 | R1 |

24 WPs (8 backend, 10 frontend, 3 browser, gate, bundle, manual) in 18 waves.

## Wave schedule (max two heavy agents; parallel only with disjoint Owns)

| Wave | Runs in parallel | Notes |
|---|---|---|
| 1 | P1 ‖ U0 | P1 heavy; U0 light frontend (its `client.ts`/`errors.ts` edit is committed before P3 takes token 1) |
| 2 | P2 | heavy; after P1 because P1's check constraint and `_create` line affect every test that creates annotate assignments, and both edit `assignments/service.py` |
| 3 | P3 | heavy, contracts token 1 |
| 4 | P4 ‖ P6 | both heavy; P4 contracts token 2; P6 no contracts |
| 5 | P7 | heavy, contracts token 3 (includes the minimal consolidation UI compile fix) |
| 6 | P5 | heavy, contracts token 4 |
| 7 | P8 ‖ U1 | P8 heavy (token 5); U1 light, labels only |
| 8 | U2 ‖ U6 | L+; their wider Vitest runs one at a time |
| 9 | U3 ‖ U7 | L+; U3 takes DocumentsPage token 1 |
| 10 | U4 | L+; DocumentsPage token 2 |
| 11 | U5 | L+; DocumentsPage token 3 |
| 12 | U8 ‖ T1 | U8 light (DocumentsPage token 4, two link lines); T1 heavy backend |
| 13 | U9 | the only frontend writer (touches ~86 files); its one full Vitest run uses a heavy slot |
| 14 | T2 | Playwright, alone |
| 15 | T3 | Playwright, alone (batches) |
| 16 | G1 | alone on the machine |
| 17 | R1 | build only |
| 18 | M1 | manual |

Parallelism summary: waves 1, 4, 7, 8, 9 and 12 run two WPs; everything else is sequential because of the contracts token, the DocumentsPage token or Playwright.

## Shared-file chains (one writer at a time, in this order)

- `contracts/openapi.json`, `frontend/src/api/generated.ts`, `contracts/admin-error-codes.json`, `src/ontocurator/domain/admin_error_codes.py`, `frontend/src/api/client.ts`, `frontend/src/admin/errors.ts`, `frontend/tests/documents/fixtures.ts`: **U0 (only `request` and the `NetworkError` message) → P3 → P4 → P7 → P5 → P8**.
- `src/ontocurator/assignments/service.py`: P1 (one line in `_create`) → P2 (`TASK_FOR_MODE`) → P3 → P5 (`TaskSummary`, `my_tasks`).
- `src/ontocurator/application/work_rounds.py`: P2 → P3.
- `src/ontocurator/storage/repository.py`: P2 → P8.
- `src/ontocurator/authz/versions.py`, `src/ontocurator/authz/scoped.py`: P3 → P8.
- `src/ontocurator/api/assignment_routes.py`: P3 → P5.
- `src/ontocurator/application/consolidation.py`: P7 (removal + `consolidation_progress`) → P5 (import only, no edit).
- `src/ontocurator/exchange/final_export_guide.py`: P2 (`submission_kind`) → P6.
- `src/ontocurator/api/work_plan_routes.py`: P4 only.
- `frontend/src/consolidation/*`: P7 (compile fix) → U1 (`consolidationText.ts`, `SummaryDialog.tsx` strings) → U6 → U9.
- `frontend/src/documents/FinalPanel.tsx`: U1 (labels) → U2 (`:267`) → U3 (embedding) → U8 (V5) → U9.
- `frontend/src/documents/nextStepLabels.ts`, `finalPanelText.ts`, `SelectionBar.tsx`, `filterModel.ts`, `PlanChips.tsx`, `PlanDialog.tsx`, `RowActions.tsx`: U1 (strings) → U4 / U5 → U9.
- `frontend/src/admin/DocumentsPage.tsx`, `frontend/tests/documentsPage.test.tsx`: U3 → U4 → U5 → U8 → U9.
- `frontend/src/styles/components.css`: U0 → U2 (`density-reading` rule) → U4 (`.shell-main`) → U8 (toast, `.shell-page`) → U9.
- `frontend/src/tasks/MyTasks.tsx`: U2 → U8 → U9.
- `frontend/src/variants/CaseViewer.tsx`: U1 (`<h2>`) → U7 → U9.
- `frontend/src/app/CaseScreen.tsx`: U2 → U9.
- `frontend/browser/documentsHelpers.ts`, `documentsOverviewHelpers.ts`: T2 (adds `textCard` helpers) → T3.

---

## Shared contracts

### Names (used across WPs; do not rename)

| Name | Where | Meaning |
|---|---|---|
| `WorkspaceMode` value `"proposal_check"` | `domain/workspace.py`, `domain/scopes.py` | the review screen over the text's tool proposals, owned by an annotate assignment |
| `REVIEW_LIKE_MODES = frozenset({"review", "proposal_check"})`, `is_review_like(mode)` | `domain/scopes.py` | modes with targets and decisions |
| `AnnotationMode = Literal["check", "blind"]` | `domain/annotation_modes.py` | the mode of a text's annotation step |
| `TextMode(mode, source, locked)`; `ModeSource = Literal["no_proposals", "locked", "plan", "project"]` | same | effective mode with its reason |
| `text_mode(*, project_mode, plan_override, proposal_count, assigned_modes) -> TextMode` | same | pure rule (below) |
| `workspace_mode(task, annotation_mode) -> WorkspaceMode` | same | replaces the lookups `MODE_FOR_TASK[task]` |
| `projects.tool_proposal_mode` (`check`/`blind`, server default `check`, existing projects backfilled `blind`) | migration 0020 | project setting "Texts with tool proposals" |
| `work_plan_rows.annotation_mode` (nullable `check`/`blind`) | migration 0020 | per-text override; NULL = project setting |
| `assignments.annotation_mode` (`check`/`blind` for task `annotate`, NULL otherwise; existing annotate rows backfilled `blind`) | migration 0020 | mode fixed at assignment time |
| `Action.OPEN_PROPOSAL_CHECK` (annotator role) | `authz/policy.py` | may open a `proposal_check` workspace |
| `load_text_mode(conn, project_id, document_id) -> TextMode` | `application/annotation_modes.py` (P3) | DB facts → `text_mode` |
| error codes `ANNOTATIONS_PER_TEXT_REACHED`, `ANNOTATION_MODE_LOCKED`, `NO_TOOL_PROPOSALS`, `PROPOSAL_CHECK_NOT_APPLICABLE` | P3/P4 | see WP blocks |
| `POST /api/v1/assignments/{id}/remove` | P3 | remove an unsubmitted assignment |
| `POST /api/v1/projects/{key}/proposal-checks/self` | P3 | "Check proposals myself" |
| `GET /api/v1/projects/{key}/documents/{doc}/layers` | P8 | text view "Show" list |
| submission kind `"proposal_check"` | `domain/submission_labels.py`, `exchange/final_export_guide.py` | export and history label |
| receipt key `proposal_checks` | `exchange/final_export.py` (P6) | per-proposal decisions |

### Pure rule `text_mode` (P1)

1. Annotate assignments that are not revoked exist on any version of the text (row = case + language) → `TextMode(<mode of the earliest of them>, "locked", True)`.
2. Else no tool proposals on the newest version → `TextMode("blind", "no_proposals", False)`.
3. Else a plan override → `TextMode(override, "plan", False)`.
4. Else `TextMode(project_mode, "project", False)`.

Changing the project setting therefore never changes a locked text; changing a text's override is refused while locked (`ANNOTATION_MODE_LOCKED`, P4); removing all annotate assignments (P3 remove, nothing submitted) unlocks the text.

### Copy (verbatim, all WPs)

| Key | Text |
|---|---|
| Setting label | `Texts with tool proposals` |
| Setting options | `Check tool proposals` (help: `Annotators go through the tool's proposals one by one and confirm, reject or correct each, then add what the tool missed.`) / `Annotate blind` (help: `Annotators do not see the proposals.`) |
| Mode, card and assign dialog | `Annotation: check tool proposals` / `Annotation: blind` |
| Mode reason, no proposals | `This text has no tool proposals, so it is annotated blind.` |
| Lock reason | `The annotation has started in this mode. Remove the annotation assignments first to change it.` |
| Editor badge | `Check tool proposals` (title: `You see the tool's proposals, never other people's work.`) |
| Task name annotate (My tasks) | `Annotation: check tool proposals` / `Annotation: blind` |
| Task name review | `Review a submitted annotation` |
| Translation review everywhere | `Translation review` |
| Submission kinds | `Annotation`, `Proposal check`, `Review of a submitted annotation`, `Consolidation`, `Carried annotation` |
| Final action | `Accept result…` (confirm title `Accept result?`) |
| Remove dialog | title `Remove assignment?`; body `Remove {name} from the annotation of {case}? Their draft is discarded.`; buttons `Cancel` / `Remove` |
| Check myself | `Check proposals myself` |
| Robot tooltip and accessible text | `{n} tool proposals available; annotation will check them` |
| Filter group | legend `Tool proposals`, options `With tool proposals` / `Without` |
| Assigned date | within 7 days `assigned today 10:40` / `assigned yesterday` / `assigned Mon`; older `assigned 14 Oct`; title `Assigned 21 Oct 2026, 16:44 by {name}` |
| Network error | `Connection lost. Try again.` (button `Try again`) |
| More menu | button text `More` with the `IconMore` icon; accessible name `More actions, {case} {language}` |

---

## WP blocks

### P1: Migration 0020, ORM, pure annotation-mode rule

- **Goal:** storage for the project setting, the per-text override and the per-assignment mode; the pure rule `text_mode`.
- **Spec:** §1 Q3 and "Constraints" (mode fixed per text).
- **Owns:** `src/ontocurator/storage/migrations/versions/0020_proposal_check.py` (create), `src/ontocurator/storage/tables.py` (`ProjectRow`, `AssignmentRow`), `src/ontocurator/storage/plan_tables.py` (`WorkPlanFlagsRow`), `src/ontocurator/assignments/service.py` (one line in `_create`, see Step 4), `src/ontocurator/domain/annotation_modes.py` (create), `tests/test_proposal_check_migration.py` (create), `tests/test_annotation_modes_domain.py` (create).
- **Size / lane / review:** M / heavy / yes.
- **Code to read:** `storage/migrations/versions/0016_work_plans.py:140-175` (column + check pattern), `0019_documents_overview.py:1-70` (header, backfill), `tests/test_overview_migration.py:1-130` (fixture pattern, downgrade), `storage/tables.py:84-140` (`ProjectRow`), `:790-830` (`AssignmentRow`), `storage/plan_tables.py:44-64`.

- [ ] **Step 1: Failing pure tests** `tests/test_annotation_modes_domain.py`:

```python
"""The annotation mode of a text (spec 2026-10-23 §1 Q3, plan "Pure rule")."""

import pytest

from ontocurator.domain.annotation_modes import TextMode, text_mode, workspace_mode


def mode(**kw):
    base = dict(project_mode="check", plan_override=None, proposal_count=17, assigned_modes=())
    return text_mode(**(base | kw))


def test_project_setting_applies_to_texts_with_proposals():
    assert mode() == TextMode("check", "project", False)
    assert mode(project_mode="blind") == TextMode("blind", "project", False)


def test_texts_without_proposals_are_always_blind():
    assert mode(proposal_count=0) == TextMode("blind", "no_proposals", False)
    assert mode(proposal_count=0, plan_override="check") == TextMode("blind", "no_proposals", False)


def test_plan_override_wins_over_project_setting():
    assert mode(plan_override="blind") == TextMode("blind", "plan", False)
    assert mode(project_mode="blind", plan_override="check") == TextMode("check", "plan", False)


def test_first_assignment_locks_the_mode():
    locked = mode(project_mode="blind", plan_override="blind", assigned_modes=("check", "blind"))
    assert locked == TextMode("check", "locked", True)


def test_lock_holds_without_proposals():
    assert mode(proposal_count=0, assigned_modes=("check",)) == TextMode("check", "locked", True)


@pytest.mark.parametrize(
    ("task", "annotation_mode", "expected"),
    [
        ("annotate", "check", "proposal_check"),
        ("annotate", "blind", "independent"),
        ("annotate", None, "independent"),
        ("review", None, "review"),
    ],
)
def test_workspace_mode_of_an_assignment(task, annotation_mode, expected):
    assert workspace_mode(task, annotation_mode) == expected


def test_translation_review_has_no_workspace_mode():
    with pytest.raises(ValueError):
        workspace_mode("translation_review", None)
```

- [ ] **Step 2:** `uv run pytest tests/test_annotation_modes_domain.py -q` → FAIL (module missing). Create `src/ontocurator/domain/annotation_modes.py`:

```python
"""The annotation mode of a text (spec 2026-10-23 §1, decisions Q1-Q3).

A text with tool proposals is annotated by checking them ("check") or blind;
a text without proposals is always blind. The project setting applies unless
the text's plan overrides it; the first annotation assignment fixes the mode
(stored on the assignment), so existing work never mixes modes.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

AnnotationMode = Literal["check", "blind"]
ANNOTATION_MODES: tuple[AnnotationMode, ...] = ("check", "blind")
ModeSource = Literal["no_proposals", "locked", "plan", "project"]
# Mirrors domain.workspace.WorkspaceMode; kept local so this module stays
# import-free of the workspace models.
WorkspaceModeName = Literal["independent", "review", "assisted", "proposal_check"]


@dataclass(frozen=True)
class TextMode:
    mode: AnnotationMode
    source: ModeSource
    locked: bool


def text_mode(
    *,
    project_mode: AnnotationMode,
    plan_override: AnnotationMode | None,
    proposal_count: int,
    assigned_modes: Iterable[AnnotationMode | None],
) -> TextMode:
    """``assigned_modes``: modes of the text's non-revoked annotate
    assignments, oldest first (``None`` cannot occur after migration 0020;
    it reads as blind)."""
    assigned = list(assigned_modes)
    if assigned:
        first: AnnotationMode = next((m for m in assigned if m is not None), "blind")
        return TextMode(first, "locked", True)
    if proposal_count == 0:
        return TextMode("blind", "no_proposals", False)
    if plan_override is not None:
        return TextMode(plan_override, "plan", False)
    return TextMode(project_mode, "project", False)


def workspace_mode(task: str, annotation_mode: AnnotationMode | None) -> WorkspaceModeName:
    """The workspace an assignment opens (replaces ``MODE_FOR_TASK[task]``)."""
    if task == "review":
        return "review"
    if task == "annotate":
        return "proposal_check" if annotation_mode == "check" else "independent"
    raise ValueError(f"Task {task!r} has no annotation workspace")
```

`uv run pytest tests/test_annotation_modes_domain.py -q` → PASS.

- [ ] **Step 3: Failing migration tests** `tests/test_proposal_check_migration.py` (fixture shape, `_exec`, downgrade call and URL handling copied from `tests/test_overview_migration.py`; the fixture yields `(url, engine)` like there):

```python
"""Migration 0020: tool proposal mode, plan override, assignment mode."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from alembic import command
from pg_harness import unmigrated_database_url
from sqlalchemy import Connection, Engine, create_engine, text
from sqlalchemy.exc import IntegrityError

from ontocurator.storage.schema import alembic_config, upgrade

# Renumbering (plan Global rule 12) only touches these two constants.
REVISION = "0020"
PREVIOUS = "0019"
S = "ontocurator"


def _exec(conn: Connection, sql: str, **params: Any) -> Any:
    return conn.execute(text(sql), params)


def _seed(conn: Connection) -> None:
    _exec(conn, f"INSERT INTO {S}.projects (project_key, name, manifest, manifest_sha256,"
          " task_profile, task_profile_sha256) VALUES ('old', 'old', '{}', 'm', '{}', 't')")
    _exec(conn, f"INSERT INTO {S}.users (username, display_name, pseudonym)"
          " VALUES ('ann', 'Ann', 'ann-0001')")
    _exec(conn, f"INSERT INTO {S}.documents (project_id, document_id, language, text,"
          " case_id, external_id, version, origin, text_sha256)"
          f" SELECT id, 'd1', 'en', 'x', 'c1', 'c1', 1, 'native', 'h' FROM {S}.projects")
    for task in ("annotate", "review", "translation_review"):
        _exec(conn, f"INSERT INTO {S}.assignments (project_id, document_id, user_id, task, status)"
              f" SELECT p.id, 'd1', u.id, :task, 'open' FROM {S}.projects p, {S}.users u",
              task=task)
    _exec(conn, f"INSERT INTO {S}.work_plan_rows (project_id, case_id, language, review,"
          f" annotate, decided) SELECT id, 'c1', 'en', false, true, true FROM {S}.projects")


@pytest.fixture
def migrated(tmp_path) -> Iterator[tuple[str, Engine]]:
    url = unmigrated_database_url(tmp_path / "proposal-check-migration.db")
    upgrade(url, PREVIOUS)
    engine = create_engine(url)
    with engine.begin() as conn:
        _seed(conn)
    upgrade(url, REVISION)
    yield url, engine
    engine.dispose()


def test_existing_projects_keep_blind_and_new_projects_check(migrated):
    _url, engine = migrated
    with engine.begin() as conn:
        assert _exec(conn, f"SELECT tool_proposal_mode FROM {S}.projects").scalar_one() == "blind"
        _exec(conn, f"INSERT INTO {S}.projects (project_key, name, manifest, manifest_sha256,"
              " task_profile, task_profile_sha256) VALUES ('new', 'new', '{}', 'm', '{}', 't')")
        assert _exec(conn, f"SELECT tool_proposal_mode FROM {S}.projects"
                     " WHERE project_key = 'new'").scalar_one() == "check"


def test_existing_annotate_assignments_are_blind_others_null(migrated):
    _url, engine = migrated
    with engine.begin() as conn:
        rows = dict(_exec(conn, f"SELECT task, annotation_mode FROM {S}.assignments").all())
    assert rows == {"annotate": "blind", "review": None, "translation_review": None}


def test_plan_override_is_null_by_default(migrated):
    _url, engine = migrated
    with engine.begin() as conn:
        assert _exec(conn, f"SELECT annotation_mode FROM {S}.work_plan_rows").scalar_one() is None


@pytest.mark.parametrize(
    "sql",
    [
        f"UPDATE {S}.projects SET tool_proposal_mode = 'maybe'",
        f"UPDATE {S}.work_plan_rows SET annotation_mode = 'assisted'",
        f"UPDATE {S}.assignments SET annotation_mode = NULL WHERE task = 'annotate'",
        f"UPDATE {S}.assignments SET annotation_mode = 'check' WHERE task = 'review'",
    ],
)
def test_checks_refuse_invalid_values(migrated, sql):
    _url, engine = migrated
    with pytest.raises(IntegrityError), engine.begin() as conn:
        _exec(conn, sql)


def test_downgrade_removes_the_columns(migrated):
    url, engine = migrated
    command.downgrade(alembic_config(url), PREVIOUS)
    with engine.begin() as conn:
        names = _exec(conn, "SELECT column_name FROM information_schema.columns"
                      " WHERE table_schema = :s AND column_name IN"
                      " ('tool_proposal_mode', 'annotation_mode')", s=S).all()
    assert names == []
```

(If `alembic_config` takes other arguments, follow `tests/test_overview_migration.py`'s downgrade test exactly.)

- [ ] **Step 4:** `uv run pytest tests/test_proposal_check_migration.py -q` → FAIL. Create the migration:

```python
"""Proposal check: tool proposal mode, per-text override, assignment mode.

``projects.tool_proposal_mode`` is the project setting "Texts with tool
proposals" (new projects: check; existing projects keep today's blind
annotation). ``work_plan_rows.annotation_mode`` overrides it per text (NULL =
project setting). ``assignments.annotation_mode`` fixes the mode of an
annotate assignment when it is created (spec 2026-10-23 §1 Q3).
"""

import sqlalchemy as sa
from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None
SCHEMA = "ontocurator"
MODES = "('check', 'blind')"


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("tool_proposal_mode", sa.Text(), nullable=False,
                  server_default=sa.text("'blind'")),
        schema=SCHEMA,
    )
    op.alter_column("projects", "tool_proposal_mode",
                    server_default=sa.text("'check'"), schema=SCHEMA)
    op.create_check_constraint(op.f("ck_projects_tool_proposal_mode"), "projects",
                               f"tool_proposal_mode IN {MODES}", schema=SCHEMA)
    op.add_column("work_plan_rows", sa.Column("annotation_mode", sa.Text(), nullable=True),
                  schema=SCHEMA)
    op.create_check_constraint(op.f("ck_work_plan_rows_annotation_mode"), "work_plan_rows",
                               f"annotation_mode IN {MODES}", schema=SCHEMA)
    op.add_column("assignments", sa.Column("annotation_mode", sa.Text(), nullable=True),
                  schema=SCHEMA)
    op.execute(f"UPDATE {SCHEMA}.assignments SET annotation_mode = 'blind'"
               " WHERE task = 'annotate'")
    op.create_check_constraint(
        op.f("ck_assignments_annotation_mode"), "assignments",
        f"(task = 'annotate' AND annotation_mode IN {MODES})"
        " OR (task <> 'annotate' AND annotation_mode IS NULL)",
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_assignments_annotation_mode"), "assignments", schema=SCHEMA)
    op.drop_column("assignments", "annotation_mode", schema=SCHEMA)
    op.drop_constraint(op.f("ck_work_plan_rows_annotation_mode"), "work_plan_rows",
                       schema=SCHEMA)
    op.drop_column("work_plan_rows", "annotation_mode", schema=SCHEMA)
    op.drop_constraint(op.f("ck_projects_tool_proposal_mode"), "projects", schema=SCHEMA)
    op.drop_column("projects", "tool_proposal_mode", schema=SCHEMA)
```

ORM (must match exactly; `tests/test_schema.py:41` compares metadata):
- `ProjectRow.__table_args__` += `CheckConstraint("tool_proposal_mode IN ('check', 'blind')", name="tool_proposal_mode")`; column `tool_proposal_mode: Mapped[str] = mapped_column(server_default=text("'check'"))` after `import_plan`.
- `AssignmentRow.__table_args__` += `CheckConstraint("(task = 'annotate' AND annotation_mode IN ('check', 'blind')) OR (task <> 'annotate' AND annotation_mode IS NULL)", name="annotation_mode")`; column `annotation_mode: Mapped[str | None]`.
- `WorkPlanFlagsRow.__table_args__` += `CheckConstraint("annotation_mode IN ('check', 'blind')", name="annotation_mode")`; column `annotation_mode: Mapped[str | None]` after `decided`.

**Inserts of annotate assignments must set `annotation_mode`** or the check refuses them. In `src` only `AssignmentService._create` inserts (`assignments/service.py:460`): add `annotation_mode="blind" if task == "annotate" else None` to its `.values(...)` (P3 replaces this with the real rule). Then `grep -rnE "insert\(AssignmentRow\)|INSERT INTO .*assignments" tests scripts` and list every raw insert of an annotate row in the hand-back; the orchestrator adds those files to Owns and they get `annotation_mode='blind'`.

- [ ] **Step 5:** `uv run pytest -n 4 tests/test_proposal_check_migration.py tests/test_schema.py tests/test_annotation_modes_domain.py tests/test_assignments.py tests/test_assignment_batch.py -q` → PASS; `uv run ruff check . && uv run ruff format --check . && uv run mypy src`.
- **Done:** constraints identical in migration and ORM; existing projects `blind`, new `check`; annotate rows always carry a mode.
- **Commit:** `feat(workflow): store tool proposal mode, plan override and assignment mode`

### P2: Workspace mode `proposal_check`

- **Goal:** a `proposal_check` workspace behaves exactly like a review workspace over the text's tool proposals (targets, decisions, completeness, submission snapshots), belongs to the annotate task, and is labelled as a proposal check in histories and exports.
- **Spec:** §1 Q1, Q2; "A blinded annotator never sees proposals… In a proposal check the person sees only the tool proposals".
- **Owns:** `src/ontocurator/domain/workspace.py`, `src/ontocurator/domain/scopes.py`, `src/ontocurator/authz/policy.py`, `src/ontocurator/assignments/service.py` (only `TASK_FOR_MODE`), `src/ontocurator/application/workspaces.py`, `src/ontocurator/application/workspace_opening.py`, `src/ontocurator/application/reviews.py`, `src/ontocurator/application/submissions.py`, `src/ontocurator/application/editing.py`, `src/ontocurator/application/reanchor_resolutions.py`, `src/ontocurator/application/work_rounds.py` (sites below), `src/ontocurator/storage/repository.py` (sites below), `src/ontocurator/api/document_projection.py`, `src/ontocurator/api/routes.py`, `src/ontocurator/domain/submission_labels.py`, `src/ontocurator/exchange/t1.py`, `src/ontocurator/exchange/final_export_guide.py` (`submission_kind` only), `tests/test_proposal_check_workspace.py` (create).
- **Size / lane / review:** L / heavy / yes.
- **Code to read:** `application/workspaces.py:203-420` (open), `application/submissions.py:123-175, 400-460`, `application/work_rounds.py:440-700`, `storage/repository.py:368-400` (`workspace_input_snapshots`), `authz/policy.py:88-150`, `domain/submission_labels.py`, `exchange/t1.py:548-650`.
- **Facts verified:** a review-mode ordinary round without sources already targets every proposal of the text on editable layers (`work_rounds.py:680-690`, `repository.list_annotations_for_document` joins `proposal_annotations`, i.e. only imported tool proposals, never people's work). A review submission's `snapshots` are confirmed/uncertain targets + `changed` replacements + added findings (`submissions.py:413-456`), so a proposal-check submission is a complete annotation layer for consolidation.

Edit list (each `mode == "review"` that means "has targets and decisions" becomes `is_review_like(mode)`; those meaning the review task or consolidation stay `"review"`):

| Site | Change |
|---|---|
| `domain/scopes.py:12`, `domain/workspace.py:14` | `WorkspaceMode = Literal["independent", "review", "assisted", "proposal_check"]`; in `scopes.py` add `REVIEW_LIKE_MODES: frozenset[str] = frozenset({"review", "proposal_check"})` and `def is_review_like(mode: str) -> bool: return mode in REVIEW_LIKE_MODES`; `build_scope` unchanged (non-independent modes get reference layers; `mode` is part of the scope hash, so the scope id differs from review) |
| `authz/policy.py` | `Action.OPEN_PROPOSAL_CHECK = "open_proposal_check"`, added to `ROLE_ACTIONS["annotator"]`; `MODE_ACTIONS["proposal_check"] = Action.OPEN_PROPOSAL_CHECK`; `MODE_ORDER = ("independent", "review", "assisted", "proposal_check")` |
| `assignments/service.py:68-72` | `TASK_FOR_MODE["proposal_check"] = "annotate"` (nothing else in this file) |
| `application/workspaces.py:211` | `key.mode == "review"` → `is_review_like(key.mode)` |
| `application/workspaces.py:262-357` (review `else` branch) | logic unchanged; `list_workspace_keys(..., "review", ...)` → `(..., key.mode, ...)`; `get_review_inputs(project_key, document_id, mode="review")` builds its scope with `mode` and the branch passes `key.mode` |
| `application/workspace_opening.py:43` | `key.mode != "review"` → `not is_review_like(key.mode)` |
| `application/reviews.py:50` | refuse unless `is_review_like(key.mode)` |
| `application/submissions.py:140, 369, 413` | `is_review_like(...)` |
| `application/editing.py:525`, `application/reanchor_resolutions.py:30, 76` | `is_review_like(...)` |
| `application/work_rounds.py:677, 680, 700` | `is_review_like(mode)`; **`:475` stays `mode != "review"`** (consolidation only on the review task) |
| `storage/repository.py:2041, 2360, 2425, 2941` | `is_review_like(...)` |
| `api/document_projection.py:232, 348, 370` | `is_review_like(mode)` |
| `api/routes.py:384` | `/workspaces/review-inputs` accepts `is_review_like(req.mode)` |
| `domain/submission_labels.py:45` | returns `"proposal_check"` for mode `proposal_check` (extend the return `Literal`) |
| `exchange/t1.py:612` | decisions exported for `is_review_like(key.mode)` (proposal URN in `source_refs`, method `adopted`/`edited`); `:763` `blind=key.mode == "independent"` unchanged |
| `exchange/final_export_guide.py:54` | `submission_kind` returns `"proposal_check"` for `origin_key.mode == "proposal_check"` |

Kept `independent`-only on purpose: `application/text_changes.py:495, 1190`, `application/work_rounds.py:481-492, 570`, `api/work_round_routes.py:259` (carrying a proposal check to a new text version is not offered, plan decision A6).

- [ ] **Step 1: Failing tests** `tests/test_proposal_check_workspace.py` (the seed-package environment of `tests/test_reviews.py`):

```python
"""Workspace mode proposal_check (spec 2026-10-23 §1): the review screen over
the text's tool proposals, owned by the annotate task."""

from __future__ import annotations

from pathlib import Path

import pytest
from test_reviews import _setup_review_test_env

from ontocurator.application.editing import CheckLayerCommand
from ontocurator.application.reviews import DecisionCommand
from ontocurator.application.submissions import SubmitCommand
from ontocurator.assignments.service import TASK_FOR_MODE
from ontocurator.authz.policy import MODE_ACTIONS, ROLE_ACTIONS, Action
from ontocurator.domain.errors import DomainError, IncompleteReview
from ontocurator.domain.scopes import build_scope, is_review_like
from ontocurator.domain.submission_labels import submission_kind
from ontocurator.domain.workspace import MutationEnvelope, WorkspaceKey


def _key(annotator: str = "checker-1") -> WorkspaceKey:
    return WorkspaceKey(project_key="pkg-rev-1", document_id="doc-1",
                        annotator_id=annotator, mode="proposal_check",
                        target_set_id="targets-0")


def _env(payload, mutation, revision) -> MutationEnvelope:
    return MutationEnvelope(mutation_id=mutation, expected_revision=revision, payload=payload)


def test_mode_is_review_like_and_belongs_to_annotate():
    assert is_review_like("proposal_check") and is_review_like("review")
    assert not is_review_like("independent")
    assert TASK_FOR_MODE["proposal_check"] == "annotate"
    assert MODE_ACTIONS["proposal_check"] == Action.OPEN_PROPOSAL_CHECK
    assert Action.OPEN_PROPOSAL_CHECK in ROLE_ACTIONS["annotator"]
    assert Action.OPEN_PROPOSAL_CHECK not in ROLE_ACTIONS["adjudicator"]


def test_scope_differs_from_review(tmp_path: Path):
    ctx = _setup_review_test_env(tmp_path)
    check = build_scope(ctx["profile"], "proposal_check")
    review = build_scope(ctx["profile"], "review")
    assert check.scope_id != review.scope_id
    assert check.reference_layer_ids == review.reference_layer_ids


def test_targets_are_the_texts_proposals(tmp_path: Path):
    ctx = _setup_review_test_env(tmp_path)
    view = ctx["ws_svc"].open(_key())
    proposals = {(s.annotation.annotation_id, s.version)
                 for s in ctx["repo"].list_annotations_for_document("pkg-rev-1", "doc-1")
                 if s.annotation.layer_id in view.scope.editable_layer_ids}
    assert {(t.annotation_id, t.version) for t in view.targets.targets} == proposals
    assert view.key.mode == "proposal_check"


def test_every_proposal_needs_a_decision_and_submission_keeps_confirmed(tmp_path: Path):
    ctx = _setup_review_test_env(tmp_path)
    view = ctx["ws_svc"].open(_key())
    key, targets = view.key, list(view.targets.targets)
    assert len(targets) >= 2
    revision = 0
    ctx["edit_svc"].apply(key, _env(CheckLayerCommand(
        kind="check_layer", layer_id="hpo-layer", checked=True).model_dump(), "chk", revision))
    revision += 1
    with pytest.raises((IncompleteReview, DomainError)):
        ctx["sub_svc"].submit(key, _env(SubmitCommand(document_checked=True).model_dump(),
                                        "early", revision))
    outcomes = ["confirmed", "rejected"] + ["confirmed"] * (len(targets) - 2)
    for index, (target, outcome) in enumerate(zip(targets, outcomes, strict=True)):
        ctx["rev_svc"].decide(key, _env(DecisionCommand(target=target, outcome=outcome)
                                        .model_dump(), f"d{index}", revision))
        revision += 1
    submission = ctx["sub_svc"].submit(key, _env(SubmitCommand(document_checked=True)
                                                 .model_dump(), "submit", revision))
    kept = {(s.annotation.annotation_id, s.version) for s in submission.snapshots}
    assert (targets[1].annotation_id, targets[1].version) not in kept
    assert (targets[0].annotation_id, targets[0].version) in kept
    assert submission.origin_key.mode == "proposal_check"
    assert len(submission.decisions) == len(targets)


def test_submission_kind_is_proposal_check():
    assert submission_kind(None, "proposal_check") == "proposal_check"
    assert submission_kind(None, "review") == "review"
    assert submission_kind(None, "independent") == "annotation"
```

(Check `submission_kind`'s signature with `grep -n "def submission_kind" src/ontocurator/domain/submission_labels.py` and adapt the three calls; the expected values stay. If the seed environment has fewer than two proposals on `hpo-layer`, assert on the actual target count instead of `>= 2` and decide with `rejected` on the last one.)

- [ ] **Step 2:** `uv run pytest tests/test_proposal_check_workspace.py -q` → FAIL. Implement the edit list.
- [ ] **Step 3:** `uv run pytest -n 4 tests/test_proposal_check_workspace.py tests/test_reviews.py tests/test_review_validation_regressions.py tests/test_review_roundtrip_regressions.py tests/test_t1_export.py tests/test_assignment_round_open_api.py tests/test_consolidation_start_api.py -q` and `uv run pytest -n 4 $(ls tests/test_final_export*.py) -q` → PASS; `uv run ruff check . && uv run ruff format --check . && uv run mypy src`.
- **Done:** every site of the edit list changed or explicitly kept; `review`/`independent`/`assisted` behaviour unchanged (existing tests green).
- **Commit:** `feat(workspace): proposal check mode over the text's tool proposals`

### P3: Annotation mode on assignments, per-text limit, remove, "Check proposals myself" (contracts writer 1)

- **Goal:** an annotate assignment gets its mode from the rule and opens the matching workspace; "annotations per text" is enforced on every assign path; an unsubmitted assignment can be removed; the lead can check a text's proposals themselves.
- **Spec:** §1 Q2, Q3, "Constraints"; §2 Annotation part (chips ✕, "Check proposals myself", F24); Small fixes "Annotations per text is enforced".
- **Facts verified:** the limit is only enforced by batch assign (`assignments/batch.py:218-220, 570`); single `AssignmentService.assign` → `_assign_locked` (`service.py:572-616`) and distribution confirmations (`confirmations.py`, calls `_assign_locked`) do not check it, which is how the test-server case cons-three got a third annotation (seeded through `POST /projects/{key}/assignments`). `revoke` (`service.py:743`) has no status guard. Self-consolidation grants a role under the members lock EXCLUSIVE (`application/consolidation_start.py:126-190`, `authz/memberships.py:79 grant_roles`).
- **Owns:** `src/ontocurator/assignments/service.py`, `src/ontocurator/application/annotation_modes.py` (create), `src/ontocurator/application/proposal_checks.py` (create), `src/ontocurator/api/proposal_check_routes.py` (create), `src/ontocurator/api/app.py` (router include only), `src/ontocurator/api/assignment_routes.py`, `src/ontocurator/application/work_rounds.py` (`:447-451` only), `src/ontocurator/application/problem_reports.py` (`:330-335` only), `src/ontocurator/authz/scoped.py` (`require_workable` only), `src/ontocurator/authz/versions.py` (`may_read_proposals` only), `src/ontocurator/domain/admin_error_codes.py`, contracts (token 1), `frontend/src/api/client.ts` (`removeAssignment`, `checkProposalsMyself`), `frontend/src/admin/errors.ts` (messages), `frontend/tests/documents/fixtures.ts` (defaults), `tests/proposal_check_support.py` (create), `tests/test_proposal_check_assignments.py` (create), `tests/test_annotations_per_text_limit.py` (create), plus test files of existing tests that break because they relied on exceeding the limit (list them in the hand-back; expected candidates: `tests/browser_overview_scenarios.py` `assign_and_annotate`, `tests/test_browser_overview_fixture.py`).
- **Size / lane / review:** L / heavy / yes.
- **Code to read:** `assignments/service.py:240-620, 743-873`, `assignments/eligibility.py:120-199` (`check_work_plan`: how `(case_id, language)` of a document is derived), `application/consolidation_start.py:97-230`, `api/assignment_routes.py:90-130, 470-560`, `authz/scoped.py:180-205`, `authz/versions.py:35-60`, `tests/work_plan_support.py` (whole), `tests/auth_harness.py:135-160`.

**`application/annotation_modes.py`** (DB facts for the pure rule; reused by P4, P5, P8):

```python
"""Database facts of the annotation-mode rule (domain/annotation_modes.py)."""

from __future__ import annotations

from sqlalchemy import Connection, func, select

from ontocurator.domain.annotation_modes import AnnotationMode, TextMode, text_mode
from ontocurator.storage.plan_tables import WorkPlanFlagsRow
from ontocurator.storage.tables import (
    AnnotationSnapshotRow,
    AssignmentRow,
    DocumentRow,
    ProjectRow,
    ProposalAnnotationRow,
)


def proposal_counts(conn: Connection, project_id: int) -> dict[str, int]:
    """Tool proposals per document id (documents without proposals absent)."""
    rows = conn.execute(
        select(AnnotationSnapshotRow.document_id, func.count())
        .join(
            ProposalAnnotationRow,
            (ProposalAnnotationRow.project_id == AnnotationSnapshotRow.project_id)
            & (ProposalAnnotationRow.annotation_id == AnnotationSnapshotRow.annotation_id)
            & (ProposalAnnotationRow.version == AnnotationSnapshotRow.version),
        )
        .where(AnnotationSnapshotRow.project_id == project_id)
        .group_by(AnnotationSnapshotRow.document_id)
    )
    return {document_id: int(count) for document_id, count in rows}


def load_text_mode(conn: Connection, project_id: int, document_id: str) -> TextMode:
    """The effective mode of the text (case + language) holding ``document_id``."""
    case_id, language = _row_key(conn, project_id, document_id)
    project_mode: AnnotationMode = conn.execute(
        select(ProjectRow.tool_proposal_mode).where(ProjectRow.id == project_id)
    ).scalar_one()
    override = conn.execute(
        select(WorkPlanFlagsRow.annotation_mode).where(
            WorkPlanFlagsRow.project_id == project_id,
            WorkPlanFlagsRow.case_id == case_id,
            WorkPlanFlagsRow.language == language,
        )
    ).scalar_one_or_none()
    siblings = _row_documents(conn, project_id, case_id, language)
    assigned = conn.execute(
        select(AssignmentRow.annotation_mode)
        .where(
            AssignmentRow.project_id == project_id,
            AssignmentRow.task == "annotate",
            AssignmentRow.revoked_at.is_(None),
            AssignmentRow.document_id.in_(siblings),
        )
        .order_by(AssignmentRow.id)
    ).scalars().all()
    count = proposal_counts_for(conn, project_id, document_id)
    return text_mode(project_mode=project_mode, plan_override=override,
                     proposal_count=count, assigned_modes=assigned)
```

`_row_key`, `_row_documents` and `proposal_counts_for` (one-document variant of `proposal_counts`) derive `(case_id, language)` and the row's document ids **exactly as `eligibility.check_work_plan` / `load_variants` do** (read them first; do not invent a second derivation).

**Service changes (`assignments/service.py`):**
- `Assignment` gains `annotation_mode: AnnotationMode | None = None`; `_assignments()` selects `AssignmentRow.annotation_mode`.
- `MODE_FOR_TASK` is deleted; every use calls `workspace_mode(task, annotation_mode)` (`api/assignment_routes.py:483, 501`, `application/work_rounds.py:447-451` reading `assignment["annotation_mode"]`, `application/problem_reports.py:330-335`). `TASK_FOR_MODE` stays.
- `_create(..., annotation_mode: AnnotationMode | None = None)`: for `task == "annotate"` and `annotation_mode is None` → `load_text_mode(conn, project["id"], document_id).mode`; stores it (replaces P1's placeholder). `reassign` passes `old["annotation_mode"]`.
- `_assign_locked`, after the `existing` checks and before `check_assignable`, for `task == "annotate"`:

```python
            limit = int(project["annotations_per_text"])
            held = conn.execute(
                select(func.count()).select_from(AssignmentRow).where(
                    AssignmentRow.project_id == project["id"],
                    AssignmentRow.document_id == document_id,
                    AssignmentRow.task == "annotate",
                    AssignmentRow.revoked_at.is_(None),
                )
            ).scalar_one()
            if held >= limit:
                raise DomainError(
                    "ANNOTATIONS_PER_TEXT_REACHED", {"limit": limit, "assigned": held}
                )
```

- The guard sits only in `_assign_locked`, so it covers single assign, the row-list POST and distribution confirmations, and **not** `reassign` (which calls `check_assignable(check_plan=False)`, revokes the old row, then `_create`) nor consolidation start (task `review`). The manual seed of cons-three (limit 2, third annotate row) is refused from now on; that is intended (test data only, note it in M1).
- New `remove(self, actor: Actor, assignment_id: int) -> Assignment`: same locking as `revoke`; raises `ASSIGNMENT_REVOKED` when already revoked, `ASSIGNMENT_SUBMITTED` when `status == "submitted"` or `last_submission_id is not None`; else `revoke_assignments(..., reason="removed")`.
- `authz/scoped.py` `require_workable`: after `active_for`, refuse a key whose mode does not match the assignment: `if key.mode in ("independent", "proposal_check") and key.mode != workspace_mode(assignment.task, assignment.annotation_mode): raise AccessDenied("MODE_NOT_ALLOWED")`.
- `authz/versions.py` `may_read_proposals`: also true for a qualifying `annotate` assignment with `annotation_mode == "check"` on the document (a checker may view the proposals in the text view; a blind annotator never).

**"Check proposals myself"** (`application/proposal_checks.py`, route `POST /api/v1/projects/{key}/proposal-checks/self`, body `{"document_id": str}`, response `{"assignment": AssignmentView, "role_granted": bool}`): copy the lock order and authority checks of `ConsolidationStartService.start` (members EXCLUSIVE, project lock, `require_project_management(..., Action.MANAGE_ASSIGNMENTS, target_user_id=actor.user_id)`, `current_access`, `require_document`); then `mode = load_text_mode(...)`; `mode.mode != "check"` → `DomainError("PROPOSAL_CHECK_NOT_APPLICABLE", {"source": mode.source})`; grant `["annotator"]` with `grant_roles` when the actor holds `lead` but not `annotator`; then `_assign_locked(conn, actor, project, document_id, actor.user_id, "annotate", True)` (language confirmed implicitly for the lead's own check; `_create` audits the override). A second call returns the same assignment with `role_granted: false`.

**Routes:** `POST /api/v1/assignments/{id}/remove` (no body) → `AssignmentView`. `AssignmentView` gains `annotation_mode: Literal["check", "blind"] | None = None`.

**Error codes** (add to `admin_error_codes.py`, sorted; messages in `frontend/src/admin/errors.ts`):

| Code | Message |
|---|---|
| `ANNOTATIONS_PER_TEXT_REACHED` | `This text already has {limit} annotation assignments, the project's limit (Settings, Workflow).` |
| `PROPOSAL_CHECK_NOT_APPLICABLE` | `This text is annotated blind, so there are no proposals to check.` |
| `ANNOTATION_MODE_LOCKED` (used by P4) | `The annotation has started in this mode. Remove the annotation assignments first to change it.` |
| `NO_TOOL_PROPOSALS` (used by P4) | `This text has no tool proposals, so it is annotated blind.` |

**`tests/proposal_check_support.py`** (shared by P3, P4, P5, P6, P8):

```python
"""A project whose c1-en text has three tool proposals and c2-en none."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from sqlalchemy import select, update

BASE = "/api/v1/projects/proj"
PEOPLE = (("anno", "Anne Notator"), ("anno2", "Arne Notator"), ("tom", "Tom Reis"))


def doc(case: str) -> str:
    return f"{case}-en"


def proposal_env(tmp_path: Any, *, per_text: int = 2, mode: str = "check") -> SimpleNamespace:
    from auth_harness import grant, logged_in
    from t1_builders import bundle, native_unit
    from t1_fixtures import TEXT, annotation, create_project, run_import
    from test_auth_api import _app
    from work_plan_support import _user

    from ontocurator.domain.work_plans import PlanFlags, RowKey
    from ontocurator.storage import work_plan_store as store
    from ontocurator.storage.tables import ProjectRow

    app = _app(tmp_path)
    db = app.state.repo.db
    create_project(db)
    seizure = TEXT.index("Krampfanfälle")
    second = TEXT.rindex("Krampfanfälle")
    period = TEXT.index("Neonatalzeit")
    proposals = [
        annotation("p1", (seizure, seizure + len("Krampfanfälle")), text=TEXT),
        annotation("p2", (period, period + len("Neonatalzeit")), text=TEXT, term_id="HP:0001250"),
        annotation("p3", (second, second + len("Krampfanfälle")), text=TEXT, assertion="absent"),
    ]
    units = [
        native_unit(doc("c1"), "en", TEXT, case_id="c1", annotations=proposals),
        native_unit(doc("c2"), "en", f"{TEXT} c2", case_id="c2"),
    ]
    job = run_import(db, bundle(tmp_path, units))
    assert job.status == "succeeded", job.error
    for username, name in PEOPLE:
        _user(app, username, name)
        assert grant(app, username, "proj", ["annotator"])
    lead = logged_in(app, "leader", projects={"proj": ["lead"]}, assignments=[])
    with db.transaction() as conn:
        pid = conn.execute(select(ProjectRow.id).where(ProjectRow.project_key == "proj")).scalar_one()
        conn.execute(update(ProjectRow).where(ProjectRow.id == pid)
                     .values(annotations_per_text=per_text, tool_proposal_mode=mode,
                             annotate_accepted_translations_only=False))
        store.write_rows(conn, pid, {RowKey("c1", "en"): PlanFlags(False, True),
                                     RowKey("c2", "en"): PlanFlags(False, True)}, actor_id=None)
    return SimpleNamespace(app=app, db=db, pid=pid, lead=lead, c1=doc("c1"), c2=doc("c2"))


def client(env: SimpleNamespace, username: str):
    from auth_harness import logged_in

    return logged_in(env.app, username, assignments=[])


def assign(env: SimpleNamespace, document_id: str, username: str) -> dict[str, Any]:
    response = env.lead.post(f"{BASE}/assignments", json={
        "document_id": document_id, "username": username, "task": "annotate",
        "confirm_language": True})
    assert response.status_code == 200, response.text
    return response.json()


def open_task(env: SimpleNamespace, username: str, assignment_id: int) -> dict[str, Any]:
    response = client(env, username).post(f"/api/v1/assignments/{assignment_id}/open")
    assert response.status_code == 200, response.text
    return response.json()
```

(Before writing: check the document ids `native_unit` produces with `case_id` — `grep -n "external_id\|document_id" tests/t1_builders.py tests/t1_fixtures.py` — and the `POST /projects/{key}/assignments` body in `api/assignment_routes.py:373-412` — it is a row list (without `context` it calls `AssignmentService.assign` per row, the path that bypassed the limit); adapt `doc()` and `assign()` to the real shape and return the created `AssignmentView`. `annotation(...)` must use terms present in the pinned test ontology; `HP:0001250` is.)

- [ ] **Step 1: Failing tests** `tests/test_proposal_check_assignments.py`:

```python
"""Annotate assignments in proposal-check mode (spec 2026-10-23 §1, §2)."""

from __future__ import annotations

import pytest
from proposal_check_support import BASE, assign, client, open_task, proposal_env
from sqlalchemy import select, update

from ontocurator.storage.tables import ProjectMembershipRow, ProjectRow


@pytest.fixture
def env(tmp_path):
    return proposal_env(tmp_path)


def test_text_with_proposals_gets_check_and_opens_the_proposal_check(env):
    assignment = assign(env, env.c1, "anno")
    assert assignment["annotation_mode"] == "check"
    opened = open_task(env, "anno", assignment["id"])
    assert opened["view"]["key"]["mode"] == "proposal_check"
    assert len(opened["view"]["targets"]["targets"]) == 3


def test_text_without_proposals_gets_blind(env):
    assignment = assign(env, env.c2, "anno")
    assert assignment["annotation_mode"] == "blind"
    assert open_task(env, "anno", assignment["id"])["view"]["key"]["mode"] == "independent"


def test_project_setting_blind_gives_blind(tmp_path):
    env = proposal_env(tmp_path, mode="blind")
    assert assign(env, env.c1, "anno")["annotation_mode"] == "blind"


def test_first_assignment_locks_the_mode(env):
    assign(env, env.c1, "anno")
    with env.db.transaction() as conn:
        conn.execute(update(ProjectRow).where(ProjectRow.id == env.pid)
                     .values(tool_proposal_mode="blind"))
    assert assign(env, env.c1, "anno2")["annotation_mode"] == "check"


def test_blind_key_is_refused_for_a_check_assignment(env):
    assignment = assign(env, env.c1, "anno")
    response = client(env, "anno").post("/api/v1/workspaces/open", json={
        "project_key": "proj", "document_id": env.c1, "mode": "independent"})
    assert response.status_code == 403, response.text
    assert response.json()["code"] == "MODE_NOT_ALLOWED"
    assert assignment["annotation_mode"] == "check"


def test_remove_an_open_assignment_unlocks_the_mode(env):
    first = assign(env, env.c1, "anno")
    removed = env.lead.post(f"/api/v1/assignments/{first['id']}/remove")
    assert removed.status_code == 200, removed.text
    assert removed.json()["revoked_at"] is not None
    with env.db.transaction() as conn:
        conn.execute(update(ProjectRow).where(ProjectRow.id == env.pid)
                     .values(tool_proposal_mode="blind"))
    assert assign(env, env.c1, "anno2")["annotation_mode"] == "blind"


def test_remove_is_refused_for_submitted_work(env):
    from work_plan_support import submit

    first = assign(env, env.c1, "anno")
    submit(env, first["id"], "sub-anno")
    response = env.lead.post(f"/api/v1/assignments/{first['id']}/remove")
    assert response.json()["code"] == "ASSIGNMENT_SUBMITTED"


def test_remove_needs_the_lead(env):
    first = assign(env, env.c1, "anno")
    response = client(env, "anno").post(f"/api/v1/assignments/{first['id']}/remove")
    assert response.status_code == 403


def test_check_myself_grants_annotator_and_assigns(env):
    response = env.lead.post(f"{BASE}/proposal-checks/self", json={"document_id": env.c1})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["role_granted"] is True
    assert body["assignment"]["task"] == "annotate"
    assert body["assignment"]["annotation_mode"] == "check"
    again = env.lead.post(f"{BASE}/proposal-checks/self", json={"document_id": env.c1}).json()
    assert again["assignment"]["id"] == body["assignment"]["id"]
    assert again["role_granted"] is False
    with env.db.transaction() as conn:
        roles = set(conn.execute(select(ProjectMembershipRow.role).where(
            ProjectMembershipRow.project_id == env.pid)).scalars())
    assert "annotator" in roles


def test_check_myself_counts_towards_the_limit(env):
    assign(env, env.c1, "anno")
    assign(env, env.c1, "anno2")
    response = env.lead.post(f"{BASE}/proposal-checks/self", json={"document_id": env.c1})
    assert response.json()["code"] == "ANNOTATIONS_PER_TEXT_REACHED"


def test_check_myself_refused_on_a_blind_text(env):
    response = env.lead.post(f"{BASE}/proposal-checks/self", json={"document_id": env.c2})
    assert response.json()["code"] == "PROPOSAL_CHECK_NOT_APPLICABLE"
    assert response.json()["details"]["source"] == "no_proposals"


def test_check_myself_needs_the_lead(env):
    response = client(env, "anno").post(f"{BASE}/proposal-checks/self",
                                        json={"document_id": env.c1})
    assert response.status_code == 403


def test_checker_may_read_proposals_blind_annotator_not(env):
    checker = assign(env, env.c1, "anno")
    assert checker["annotation_mode"] == "check"
    versions = client(env, "anno").get(f"{BASE}/documents/{env.c1}/annotation-versions")
    assert any(v["kind"] == "proposals" for v in versions.json())
    blind = assign(env, env.c2, "anno2")
    assert blind["annotation_mode"] == "blind"
    other = client(env, "anno2").get(f"{BASE}/documents/{env.c2}/annotation-versions")
    assert all(v["kind"] != "proposals" for v in other.json())
```

(Adapt the `annotation-versions` response shape after `grep -n "annotation-versions" -A20 src/ontocurator/api/variant_routes.py`; keep the assertions' meaning. Adapt the `/workspaces/open` body to `OpenWorkspaceRequest`.)

`tests/test_annotations_per_text_limit.py`:

```python
"""Annotations per text is enforced on every assign path (spec "Small fixes")."""

from proposal_check_support import BASE, assign, proposal_env


def test_single_assign_refuses_above_the_limit(tmp_path):
    env = proposal_env(tmp_path, per_text=2)
    assign(env, env.c1, "anno")
    assign(env, env.c1, "anno2")
    response = env.lead.post(f"{BASE}/assignments", json={
        "document_id": env.c1, "username": "tom", "task": "annotate", "confirm_language": True})
    assert response.json()["code"] == "ANNOTATIONS_PER_TEXT_REACHED"
    assert response.json()["details"] == {"limit": 2, "assigned": 2}


def test_reassign_keeps_the_count(tmp_path):
    env = proposal_env(tmp_path, per_text=1)
    first = assign(env, env.c1, "anno")
    response = env.lead.post(f"/api/v1/assignments/{first['id']}/reassign",
                             json={"username": "anno2", "confirm_language": True})
    assert response.status_code == 200, response.text
    assert response.json()["annotation_mode"] == "check"


def test_removed_assignments_free_the_slot(tmp_path):
    env = proposal_env(tmp_path, per_text=1)
    first = assign(env, env.c1, "anno")
    env.lead.post(f"/api/v1/assignments/{first['id']}/remove")
    assert assign(env, env.c1, "anno2")["annotation_mode"] == "check"


def test_distribution_confirmation_respects_the_limit(tmp_path):
    """Calls DistributionConfirmationService.confirm with three people on c1
    (per_text=2): the third row is refused with ANNOTATIONS_PER_TEXT_REACHED."""
```

The last test body: build the confirmation through the service as `tests/test_distribution_api.py` does (read it; copy its request shape); assert the refusal code on the third row.

- [ ] **Step 2:** `uv run pytest -n 4 tests/test_proposal_check_assignments.py tests/test_annotations_per_text_limit.py -q` → FAIL. Implement.
- [ ] **Step 3:** `uv run pytest -n 4 tests/test_proposal_check_assignments.py tests/test_annotations_per_text_limit.py tests/test_assignments.py tests/test_assignment_batch.py tests/test_distribution_api.py tests/test_consolidation_start_api.py tests/test_assignment_round_open_api.py tests/test_browser_overview_fixture.py tests/test_browser_documents_fixture.py tests/test_browser_lead_workflow_fixture.py tests/test_problem_reports*.py -q` (expand globs with `ls`) → PASS. A test that relied on more annotate assignments than the limit: raise the project's `annotations_per_text` in that test's setup (never weaken the rule); list each in the hand-back.
- [ ] **Step 4: Contracts (token 1).** `uv run python scripts/export_openapi.py && npm --prefix frontend run api:generate && uv run python scripts/export_admin_error_codes.py`; `client.ts`: `removeAssignment(id: number): Promise<AssignmentView>` (`POST /api/v1/assignments/${id}/remove`), `checkProposalsMyself(key: string, documentId: string): Promise<{ assignment: AssignmentView; role_granted: boolean }>`; `errors.ts` messages above; `fixtures.ts` defaults (`annotation_mode: null` where `AssignmentView` objects are built); `npm --prefix frontend run typecheck`; `bash scripts/check.sh --only static`.
- **Done:** every assign path refuses above the limit; the mode is set once at creation; `MODE_FOR_TASK` gone (`grep -rn MODE_FOR_TASK src` empty); blind annotators never see proposals (test).
- **Commit:** `feat(assignments): proposal-check assignments, per-text limit, remove, check myself`

### P4: Project setting, plan override, mode lock (contracts writer 2)

- **Goal:** Settings → Workflow "Texts with tool proposals"; per-text (and bulk) override of the annotation mode; refusal while the mode is locked.
- **Spec:** §1 Q3 (setting, override via "Change plan…", lock); §2 footer "Change plan…" content (F5) server side.
- **Owns:** `src/ontocurator/projects/service.py`, `src/ontocurator/api/annotation_mode_views.py` (create), `src/ontocurator/application/plan_annotation_modes.py` (create), `src/ontocurator/api/work_plan_routes.py` (two routes + models), `src/ontocurator/domain/admin_error_codes.py`, contracts (token 2), `frontend/src/api/client.ts` (`setAnnotationMode`, `setAnnotationModes`, settings type), `frontend/tests/documents/fixtures.ts`, `frontend/tests/projectSettings.test.tsx` (payload expectation only), `tests/test_annotation_mode_settings_api.py` (create), `tests/test_plan_annotation_mode_api.py` (create).
- **Size / lane / review:** M / heavy / yes.
- **Code to read:** `projects/service.py:50-80, 330-360` (`ProjectSettingsChange`, `ProjectSettings`, `update_settings` None-keeps pattern for `annotations_per_text`/`import_plan`), `api/project_routes.py:360-380`, `api/work_plan_routes.py:100-130, 275-300`, `application/work_plans.py:292-330` (`_lock`, audit pattern), `storage/work_plan_store.py:221-260, 420-470` (`plan_rows`, `ensure_rows`).
- **Prerequisites:** `grep -n "def load_text_mode" src/ontocurator/application/annotation_modes.py` (P3 committed); contracts token 2.

**Settings:** `ProjectSettingsChange.tool_proposal_mode: AnnotationMode | None = None` (None keeps, like `annotations_per_text`); `ProjectSettings.tool_proposal_mode: AnnotationMode = "check"`; `update_settings` writes it (extend the name loop at `:348`). The settings audit records the change like the other workflow fields.

**Shared view** `api/annotation_mode_views.py`:

```python
from typing import Literal

from pydantic import BaseModel

from ontocurator.domain.annotation_modes import TextMode


class AnnotationModeView(BaseModel):
    """The text's annotation mode as the card, plan dialog and rows show it."""

    mode: Literal["check", "blind"]
    source: Literal["no_proposals", "locked", "plan", "project"]
    locked: bool
    override: Literal["check", "blind"] | None = None
    proposal_count: int = 0

    @classmethod
    def of(cls, mode: TextMode, override: str | None, proposal_count: int) -> "AnnotationModeView":
        return cls(mode=mode.mode, source=mode.source, locked=mode.locked,
                   override=override, proposal_count=proposal_count)
```

**Override service** `application/plan_annotation_modes.py`, class `PlanAnnotationModes(db, actor, access)`:
- `set_one(key, case_id, language, mode: AnnotationMode | None) -> AnnotationModeView`: project lock exclusive (as `WorkPlanService._lock(conn, key, exclusive=True)`), lead only (`MANAGE_ASSIGNMENTS`, as `WorkPlanService`), `store.ensure_rows` for the row; `TextMode` of the row's newest document via `load_text_mode`; refuse `ANNOTATION_MODE_LOCKED` when `locked` and the requested effective mode differs from the locked one (setting the same mode or clearing the override while locked is allowed and stored, it only matters after an unlock); refuse `NO_TOOL_PROPOSALS` when `mode == "check"` and the text has no proposals; write `WorkPlanFlagsRow.annotation_mode`; audit `plan.annotation_mode` with `{case_id, language, from, to}`; return the new view.
- `set_many(key, rows: list[RowKey], mode) -> {"changed": [RowRef], "locked": [RowRef], "no_proposals": [RowRef]}`: same rules per row, skipping refused rows instead of failing (the bulk dialog shows the counts).

**Routes** (`api/work_plan_routes.py`):
- `PUT /api/v1/projects/{key}/work-plans/{case_id:path}/{language}/annotation-mode`, body `{"mode": "check" | "blind" | null}` (`extra="forbid"`) → `AnnotationModeView`. Register it **before** the PATCH `/{case_id:path}/{language}` route so the path converter does not swallow `/annotation-mode` (verify with a test).
- `PUT /api/v1/projects/{key}/work-plans/annotation-modes`, body `{"rows": [RowRefView], "mode": "check" | "blind" | null}` (max `MAX_SELECTED_ROWS`) → `{"changed": [...], "locked": [...], "no_proposals": [...]}`.

- [ ] **Step 1: Failing tests** `tests/test_annotation_mode_settings_api.py`:

```python
from proposal_check_support import BASE, proposal_env


def test_setting_reads_and_writes(tmp_path):
    env = proposal_env(tmp_path)
    assert env.lead.get(f"{BASE}/settings").json()["tool_proposal_mode"] == "check"
    response = env.lead.patch(f"{BASE}/settings", json={"tool_proposal_mode": "blind"})
    assert response.status_code == 200, response.text
    assert env.lead.get(f"{BASE}/settings").json()["tool_proposal_mode"] == "blind"


def test_omitted_setting_keeps_the_value(tmp_path):
    env = proposal_env(tmp_path, mode="blind")
    env.lead.patch(f"{BASE}/settings", json={"annotations_per_text": 3})
    assert env.lead.get(f"{BASE}/settings").json()["tool_proposal_mode"] == "blind"


def test_invalid_value_is_refused(tmp_path):
    env = proposal_env(tmp_path)
    assert env.lead.patch(f"{BASE}/settings", json={"tool_proposal_mode": "assisted"}).status_code == 422
```

(Adapt the settings URL and method to `api/project_routes.py:365-371`.)

`tests/test_plan_annotation_mode_api.py`:

```python
from proposal_check_support import BASE, assign, client, proposal_env

URL = f"{BASE}/work-plans/c1/en/annotation-mode"


def test_override_blind_then_assignment_is_blind(tmp_path):
    env = proposal_env(tmp_path)
    response = env.lead.put(URL, json={"mode": "blind"})
    assert response.status_code == 200, response.text
    assert response.json() == {"mode": "blind", "source": "plan", "locked": False,
                               "override": "blind", "proposal_count": 3}
    assert assign(env, env.c1, "anno")["annotation_mode"] == "blind"


def test_clearing_the_override_returns_to_the_project_setting(tmp_path):
    env = proposal_env(tmp_path)
    env.lead.put(URL, json={"mode": "blind"})
    body = env.lead.put(URL, json={"mode": None}).json()
    assert (body["mode"], body["source"], body["override"]) == ("check", "project", None)


def test_change_is_refused_while_locked(tmp_path):
    env = proposal_env(tmp_path)
    assign(env, env.c1, "anno")
    response = env.lead.put(URL, json={"mode": "blind"})
    assert response.json()["code"] == "ANNOTATION_MODE_LOCKED"
    same = env.lead.put(URL, json={"mode": "check"})
    assert same.status_code == 200 and same.json()["locked"] is True


def test_check_is_refused_without_proposals(tmp_path):
    env = proposal_env(tmp_path)
    response = env.lead.put(f"{BASE}/work-plans/c2/en/annotation-mode", json={"mode": "check"})
    assert response.json()["code"] == "NO_TOOL_PROPOSALS"


def test_bulk_skips_locked_and_proposal_free_rows(tmp_path):
    env = proposal_env(tmp_path)
    assign(env, env.c1, "anno")
    body = env.lead.put(f"{BASE}/work-plans/annotation-modes", json={
        "rows": [{"case_id": "c1", "language": "en"}, {"case_id": "c2", "language": "en"}],
        "mode": "blind"}).json()
    assert body["locked"] == [{"case_id": "c1", "language": "en"}]
    assert body["changed"] == [{"case_id": "c2", "language": "en"}]
    assert body["no_proposals"] == []


def test_override_is_lead_only(tmp_path):
    env = proposal_env(tmp_path)
    assert client(env, "anno").put(URL, json={"mode": "blind"}).status_code == 403


def test_override_route_does_not_clash_with_the_plan_patch(tmp_path):
    env = proposal_env(tmp_path)
    assert env.lead.put(URL, json={"mode": "blind"}).status_code == 200
    rows = env.lead.get(f"{BASE}/document-rows").json()
    assert rows  # the plan of c1-en is still readable
```

- [ ] **Step 2:** `uv run pytest -n 4 tests/test_annotation_mode_settings_api.py tests/test_plan_annotation_mode_api.py -q` → FAIL; implement; → PASS. Then `uv run pytest -n 4 tests/test_projects_settings*.py tests/test_work_plan*.py -q` (expand with `ls`).
- [ ] **Step 3: Contracts (token 2).** Regenerate; `client.ts`: `setAnnotationMode(key, caseId, language, mode: "check" | "blind" | null): Promise<AnnotationModeView>`, `setAnnotationModes(key, rows: RowRef[], mode): Promise<{ changed: RowRef[]; locked: RowRef[]; no_proposals: RowRef[] }>`; settings type gains `tool_proposal_mode`; `frontend/tests/projectSettings.test.tsx:472-501` expects the unchanged payload (the field is added to the form in U2, not here, so only typing changes); `npm --prefix frontend run typecheck`; `bash scripts/check.sh --only static`.
- **Done:** setting, single and bulk override work; lock refusal tested; error codes catalogued.
- **Commit:** `feat(workflow): tool proposal setting and per-text annotation mode`

### P6: Export fields for proposal checks

- **Goal:** the final export records, per proposal-check submission, the decision on every proposal with the proposal's source ref, and the added findings; the README and docs explain them.
- **Spec:** §1 "Export"; Goal 1 ("tool precision can be measured from the export").
- **Facts verified:** `receipt.json` already carries `review_decisions` (`exchange/final_export.py:175`) as raw `ReviewDecision` dumps without the proposal URN; the T1 bundles map `confirmed`→method `adopted` with the proposal URN in `source_refs` and `changed`→`edited` (`exchange/t1.py:611-650`, extended to proposal checks by P2); `index.csv` column `submission_kind` (P2 adds `proposal_check`); proposal URN: `exchange/t1.py:463 _proposal_ref(annotation_id, project)`.
- **Owns:** `src/ontocurator/exchange/proposal_checks.py` (create), `src/ontocurator/exchange/final_export.py`, `src/ontocurator/exchange/final_export_guide.py` (README text), `docs/scientific-workflow.md` (new section "Proposal checks in the export"), `tests/test_proposal_check_export.py` (create).
- **Size / lane / review:** S / heavy / –.
- **Code to read:** `exchange/final_export.py:100-200`, `exchange/final_export_guide.py:200-260` (README lines), `exchange/t1.py:455-470, 600-650`, one existing final-export test (`ls tests | grep -i final_export`) for the build pattern.

`exchange/proposal_checks.py`:

```python
"""Per-proposal decisions of proposal-check submissions (final export receipt)."""

from __future__ import annotations

from typing import Any

from ontocurator.domain.workspace import Submission
from ontocurator.exchange.t1 import _proposal_ref

DECISION_WORDS = {
    "confirmed": "confirmed",
    "rejected": "rejected",
    "changed": "corrected",
    "uncertain": "uncertain",
}


def proposal_check_record(submission: Submission, project: str) -> dict[str, Any]:
    """Every proposal of the check with its decision; findings the person added."""
    replaced = {d.replacement.annotation_id for d in submission.decisions if d.replacement}
    targets = {t.annotation_id for t in submission.targets.targets}
    decisions = [
        {
            "proposal_ref": _proposal_ref(d.target.annotation_id, project),
            "proposal_annotation_id": d.target.annotation_id,
            "proposal_version": d.target.version,
            "decision": DECISION_WORDS[d.outcome],
            "corrected_annotation_id": d.replacement.annotation_id if d.replacement else None,
            "note": d.note,
        }
        for d in sorted(submission.decisions, key=lambda d: (d.target.annotation_id, d.target.version))
    ]
    added = sorted(
        s.annotation.annotation_id
        for s in submission.snapshots
        if s.annotation.annotation_id not in replaced
        and s.annotation.annotation_id not in targets
    )
    counts = {word: sum(1 for d in decisions if d["decision"] == word)
              for word in ("confirmed", "rejected", "corrected", "uncertain")}
    return {"decisions": decisions, "added_annotation_ids": added,
            "counts": counts | {"added": len(added)}}
```

`final_export.py` receipt: `"proposal_checks": {sub.submission_id: proposal_check_record(sub, project) for sub in content.submissions if sub.origin_key.mode == "proposal_check"}` (additive key; `review_decisions` unchanged). README (`final_export_guide.py`): add after the `receipt.json` line: `"  proposal_checks     Per tool proposal of a proposal check: confirmed,"`, `"                      rejected, corrected or uncertain, with the proposal's"`, `"                      ref; plus the findings the person added."` and in the `submission_kind` explanation the value `proposal_check` ("the person checked the tool's proposals one by one"). Keep the guide's 76-column wrap. `docs/scientific-workflow.md`: a section "Proposal checks in the export" (where to find decisions; how to compute tool precision = confirmed / (confirmed + rejected + corrected) per tool run; corrected counts the proposal as not exact).

- [ ] **Step 1: Failing tests** `tests/test_proposal_check_export.py`:
  - `test_record_lists_every_proposal_with_its_decision_and_ref` (pure: build a `Submission` with `origin_key.mode="proposal_check"`, targets p1–p3 with URN ids `urn:ontospan:set:p1`…, decisions confirmed/rejected/changed→replacement `r3`, snapshots `[p1, r3, new1]`; assert `decisions[*].decision == ["confirmed", "rejected", "corrected"]`, `proposal_ref` equals the URN, `corrected_annotation_id == "r3"`, `added_annotation_ids == ["new1"]`, `counts == {"confirmed": 1, "rejected": 1, "corrected": 1, "uncertain": 0, "added": 1}`).
  - `test_non_urn_ids_get_the_project_proposals_ref` (`_proposal_ref` fallback).
  - `test_final_export_receipt_has_proposal_checks` (heavy: `proposal_env`, two proposal checks submitted through the API — open via `open_task`, decide all three targets through `POST /workspaces/{id}/decisions`, check the layer, submit — accept one as final through the final-selection API as `work_plan_support.select_final` does, run the final export job as the existing final-export test does, read `receipt.json`: `proposal_checks` has the selected submission with three decisions; `index.csv` row `submission_kind == "proposal_check"`).
  - `test_readme_explains_proposal_checks` (the guide text contains `proposal_checks` and `proposal_check`).
- [ ] **Step 2:** `uv run pytest tests/test_proposal_check_export.py -q` → FAIL; implement; → PASS; `uv run pytest -n 4 $(ls tests/test_final_export*.py) tests/test_t1_export.py -q`.
- **Done:** additive receipt key and README/docs text; existing exports byte-identical for projects without proposal checks (existing tests green).
- **Commit:** `feat(export): per-proposal decisions of proposal checks`

### P7: Consolidation server: one finding per group (contracts writer 3)

- **Goal:** a group resolves to exactly one finding; `keep_both`, `term_choices` and `term_parts` leave the API; a progress helper for the read model.
- **Spec:** §3 ("One group = … exactly one finding. Keep both and any split off are removed"; "The server rules stay consistent with the UI: one term per group; a choice is required for every disagreeing field; Keep both and term_choices are removed from the API (with tests)").
- **Facts verified:** keep-both code: `application/consolidation_resolve.py:9-25` (docstring), `:181-191` (`ResolveCommand.action`/`term_choices`), `:519-560` (`_plans`), `:233-239` (`cons_ids`); `domain/agreement.py:85-91` (`TermPart`), `:94-110` (`Group.term_parts`), `:342-349`; `application/consolidation.py:477-482` (serialisation); `api/consolidation_routes.py:53-57, 70, 74, 161`; `domain/review.py:10` (`ConsolidationAction`). "Split off" exists nowhere in code. Stored decisions of earlier rounds may carry `consolidation.action == "keep_both"`.
- **Owns:** `src/ontocurator/application/consolidation_resolve.py`, `src/ontocurator/application/consolidation.py`, `src/ontocurator/domain/agreement.py`, `src/ontocurator/api/consolidation_routes.py`, `src/ontocurator/domain/review.py` (comment only), contracts (token 3), `frontend/src/api/client.ts` (`ConsolidationResolvePayload` without `term_choices`), `frontend/tests/consolidation/fixtures.ts`, `frontend/tests/consolidationEditor.test.tsx` (fixture field only), `tests/test_consolidation_relevant_differences.py`, `tests/test_consolidation_resolve_api.py`, `tests/test_consolidation_resolve_validation.py`, `tests/test_consolidation_submit_gating.py`, `tests/test_agreement_groups.py`, `tests/test_browser_consolidation_fixture.py`, `tests/test_consolidation_progress.py` (create).
- **Size / lane / review:** M / heavy / yes.
- **Prerequisites:** contracts token 3 (after P4).

Changes:
- `ResolveCommand.action: Literal["keep", "choose", "leave_out"]`; field `term_choices` removed. Before `ResolveCommand.model_validate`, `resolve()` refuses legacy payloads with a clear message: `if envelope.payload.get("action") == "keep_both" or "term_choices" in envelope.payload: raise _invalid("Keep both is no longer offered: choose one finding and add a second finding on the text")`.
- `_plans`: keep-both branch and the `term_choices` check removed; `keep` and `choose` unchanged (choose: term in the group or the "other term"; every differing axis chosen; span and note from a member).
- `domain/agreement.py`: `TermPart` and `Group.term_parts` removed (and their construction at `:342-349`); nothing else in the grouping changes.
- `application/consolidation.py`: `term_parts` serialisation removed; `_state` keeps reading a stored `keep_both` mark (earlier rounds) and reports it as state `"keep_both"`; new helper:

```python
def consolidation_progress(
    conn: Connection, pid: int, round_id: str, decisions: Sequence[ReviewDecision]
) -> tuple[int, int]:
    """``(open, total)`` groups of the round under ``decisions``."""
    profile, defaults = project_profile(conn, pid)
    found = round_members(conn, pid, round_id, profile, defaults)
    groups = list(round_groups(found))
    open_count = sum(
        1
        for group in groups
        if is_open(
            ((ref.annotation_id, ref.version)
             for ref in (member_ref(found.members[i]) for i in group.members.values())),
            decisions,
        )
    )
    return open_count, len(groups)
```

  and `open_group_count` becomes `return consolidation_progress(conn, pid, round_id, decisions)[0]`.
- `api/consolidation_routes.py`: `ConsolidationTermPartView` and `term_parts` removed; `state` Literal keeps `"keep_both"` (comment: "stored by rounds before 2026-10-23; never written again"); route docstring without keep both.
- `domain/review.py:10`: `ConsolidationAction` keeps `"keep_both"` for reading stored marks; add the comment "never written since 2026-10-23 (one finding per group)".
- `_Group.cons_ids` unchanged (reopen still clears results of earlier keep-both resolutions).

- [ ] **Step 1: Failing tests.** In `tests/test_consolidation_resolve_validation.py` replace `test_keep_both_needs_term_differs` with:

```python
def test_keep_both_is_refused(cons):
    refused(cons, {"input_ids": inputs(group(cons, "term_differs")), "action": "keep_both"})


def test_term_choices_are_refused(cons):
    item = group(cons, "term_differs")
    refused(cons, {"input_ids": inputs(item), "action": "choose", "choice": choice(item),
                   "term_choices": [choice(item)]})


def test_choose_on_term_differs_writes_one_finding(cons):
    item = group(cons, "term_differs")
    response = mutate(cons, "resolve", {"input_ids": inputs(item), "action": "choose",
                                        "choice": choice(item, axes={
                                            axis: item["members"][0]["axes"].get(axis, "present")
                                            for axis in item["differing_axes"]})})
    assert response.status_code == 200, response.text
    resolved = group(cons, "term_differs")
    assert len(resolved["annotation_ids"]) == 1
```

  `tests/test_consolidation_progress.py`: `test_progress_counts_open_and_total_groups` (round of `build_round`: before any decision `(open, total) == (open_group_count, 8)` per the scenario's eight groups — read `tests/test_consolidation_resolve_api.py::build_round` for its real group count and use it; after resolving one open group `open` drops by one) and `test_open_group_count_equals_progress_open`.
  Remove or rewrite every keep-both test listed under "Facts verified" (`grep -rn "keep_both\|term_choices\|term_parts" tests` must end empty except `test_keep_both_is_refused`, the stored-mark read test below and comments): `test_keep_both_with_three_people_asks_the_values_within_one_term` → delete; `test_term_choices_go_with_keep_both_only` → delete (covered above); `test_keep_both_on_term_differs_writes_two_annotations` → replace by `test_choose_on_term_differs_writes_one_finding`; the `("term_differs", "keep_both")` parametrisations → `("term_differs", "choose")`; `test_term_parts_name_the_decisions_within_one_term` → delete; `term_parts == {}` asserts → delete the line. Add `test_a_stored_keep_both_mark_still_reads` in `tests/test_consolidation_resolve_api.py` (write a decision with `ConsolidationMark(action="keep_both")` into the draft through the repository as the existing reopen test does; the read returns state `"keep_both"`).
- [ ] **Step 2:** `uv run pytest -n 4 tests/test_consolidation_resolve_validation.py tests/test_consolidation_resolve_api.py tests/test_consolidation_relevant_differences.py tests/test_consolidation_submit_gating.py tests/test_agreement_groups.py tests/test_consolidation_progress.py tests/test_browser_consolidation_fixture.py tests/test_consolidation_read_api.py tests/test_consolidation_auto_take_over.py -q` → FAIL first, then PASS after the changes.
- [ ] **Step 3: Contracts (token 3).** Regenerate; `client.ts` `ConsolidationResolvePayload.action: "keep" | "choose" | "leave_out"`, no `term_choices`; frontend fixtures drop `term_parts`.
- [ ] **Step 4: Minimal frontend compile fix** (the screen is rewritten in U6; here only remove what no longer exists, so the tree stays green): in `frontend/src/consolidation/groupModel.ts` delete `KEEP_BOTH` (`:45`), `keepBothAsks` (`:158`), the `keepBoth` parameter and the "Keep both" Term option of `rowsOf` (`:166-199`), `keepsBoth` (`:207`), `keepBothChoices` (`:264`) and the keep-both branch of `resolvePayload` (`:273-279`), the "kept both" summaries (`:287`, `:297-299` keep a read-only label `"kept both (earlier version)"` for stored marks); in `GroupCard.tsx` delete the keep-both hint (`:244`) and its option wiring; in `consolidationText.ts` delete the keep-both count (`:71`). Tests: delete `groupCard.test.tsx` "offers one term, keep both or another term when terms differ" (`:74`) and "asks the values that differ within one term before keeping both (three people)" (`:173`), `model.test.ts` "asks the values within one term when both terms are kept (three people)" (`:119`); add `model.test.ts` `it("never offers keep both", …)` asserting no row option label contains `"both"` for the term-differs fixture group. These files join this WP's Owns (`frontend/src/consolidation/groupModel.ts`, `GroupCard.tsx`, `consolidationText.ts`, `frontend/tests/consolidation/groupCard.test.tsx`, `model.test.ts`). Run `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/consolidation`, `npm --prefix frontend run typecheck`, `bash scripts/check.sh --only static`.
- **Done:** `grep -rn "keep_both\|term_choices\|term_parts" src frontend/src` shows only the stored-mark read paths, the `"kept both (earlier version)"` label and comments.
- **Commit:** `feat(consolidation): one finding per group, keep both removed`

### P5: Read model: proposals, modes, assignment dates, filter, progress, My tasks (contracts writer 4)

- **Goal:** one Documents request gives the card and the one-line rows everything: proposal count, annotation mode, assignment dates with assigner, consolidation progress; filter "With tool proposals / Without"; My tasks carries mode and date.
- **Spec:** §2 (path states, chips with dates, "Every assignment shown anywhere … carries its assignment date"), §2b (robot icon, filter), §1 (assign dialog and card show the mode).
- **Facts verified:** no proposal count and no assignment date in the row payload (`api/document_row_routes.py:100-116 WorkItemView`, `application/document_rows.py:557-588 _assignments` does not select `created_at`); `TaskSummary` (`assignments/service.py:100`) has only `updated_at`; facets in `application/document_row_facets.py` (`FacetGroup`, `facet_values`); filters parsed in `api/document_row_routes.py:520-579 _filters`; row dict built in `application/document_row_page.py:482-570`.
- **Owns:** `src/ontocurator/domain/document_rows.py` (`AssignmentFact`), `src/ontocurator/application/document_rows.py`, `src/ontocurator/application/document_row_page.py`, `src/ontocurator/application/document_row_facets.py`, `src/ontocurator/api/document_row_routes.py`, `src/ontocurator/assignments/service.py` (`TaskSummary`, `my_tasks`), `src/ontocurator/api/assignment_routes.py` (`TaskSummaryView`), contracts (token 4), `frontend/src/api/client.ts` (query param `proposals`), `frontend/tests/documents/fixtures.ts` (defaults), `tests/test_document_rows_proposals.py` (create), `tests/test_my_tasks_dates.py` (create).
- **Size / lane / review:** M / heavy / yes.
- **Code to read:** `application/document_rows.py:100-130 (RowQuery), 260-310 (RowFacts), 557-620, 900-1020 (load_facts)`, `application/document_row_page.py:380-570, 1140-1170`, `api/document_row_routes.py:95-330, 520-600`, `api/person_views.py` (person references), `application/consolidation.py:548-580` (`_draft`, read without creating), `assignments/service.py:787-873` (`my_tasks`).
- **Prerequisites:** `grep -n "def consolidation_progress" src/ontocurator/application/consolidation.py` (P7); `grep -n "class AnnotationModeView" src/ontocurator/api/annotation_mode_views.py` (P4); contracts token 4.

Additions (all with defaults; additive):

| Where | Field | Value |
|---|---|---|
| `AssignmentFact` | `created_at: datetime \| None = None`, `created_by: int \| None = None`, `annotation_mode: str \| None = None` | from `AssignmentRow` |
| `WorkItemView` | `assigned_at: datetime \| None = None`, `assigned_by: PersonRefView \| None = None`, `annotation_mode: Literal["check","blind"] \| None = None` | `created_at`; the person reference of `created_by` built like `person` |
| `DocumentRowView` | `proposal_count: int = 0` | proposals of the row's newest target document (`application/annotation_modes.proposal_counts`, loaded once per request in `load_facts`) |
| `DocumentRowView` | `annotation_mode: AnnotationModeView \| None = None` | `text_mode(project_mode=…, plan_override=…, proposal_count=…, assigned_modes=…)` with the row's non-revoked annotate facts ordered by `assignment_id`; overrides loaded once per request (`select(WorkPlanFlagsRow.case_id, .language, .annotation_mode)` where not null); `None` for rows that are not planned for annotation and have no annotate work |
| `DocumentRowView` | `consolidation_progress: ConsolidationProgressView \| None = None` (`open: int`, `total: int`) | only for **shown** rows (after paging) with an active, editable consolidation round: decisions from the live draft read like `consolidation._draft` (a read never creates a draft), then `consolidation_progress(conn, pid, round_id, decisions)` |
| facets | group `"proposals"` with values `"with"` / `"without"` (`proposal_count > 0`) | `FacetGroup`, `FACET_GROUPS` (append last), `facet_values` |
| filters | query `proposals: list[Literal["with","without"]] = Query(default=[])` | `RowQuery.proposals`, applied with the other facet filters |
| `TaskSummary` / `TaskSummaryView` | `assigned_at: datetime \| None = None`, `annotation_mode: Literal["check","blind"] \| None = None` | `AssignmentRow.created_at`, `.annotation_mode` |

- [ ] **Step 1: Failing tests** `tests/test_document_rows_proposals.py`:

```python
"""Rows carry proposals, modes and assignment dates (spec 2026-10-23 §2, §2b)."""

from proposal_check_support import BASE, assign, client, proposal_env


def rows(env, **params):
    response = env.lead.get(f"{BASE}/document-rows", params=params)
    assert response.status_code == 200, response.text
    return {(r["case_id"], r["language"]): r
            for g in response.json()["groups"] for r in g["rows"]}


def test_proposal_count_and_mode_before_assignment(tmp_path):
    env = proposal_env(tmp_path)
    found = rows(env)
    c1, c2 = found[("c1", "en")], found[("c2", "en")]
    assert c1["proposal_count"] == 3
    assert c1["annotation_mode"] == {"mode": "check", "source": "project", "locked": False,
                                     "override": None, "proposal_count": 3}
    assert c2["proposal_count"] == 0
    assert c2["annotation_mode"]["source"] == "no_proposals"


def test_work_items_carry_assignment_date_assigner_and_mode(tmp_path):
    env = proposal_env(tmp_path)
    assign(env, env.c1, "anno")
    item = next(w for w in rows(env)[("c1", "en")]["work"] if w["task"] == "annotate")
    assert item["assigned_at"] is not None
    assert item["assigned_by"]["display_name"]  # the lead's name
    assert item["annotation_mode"] == "check"
    assert rows(env)[("c1", "en")]["annotation_mode"]["locked"] is True


def test_filter_with_and_without_tool_proposals(tmp_path):
    env = proposal_env(tmp_path)
    assert set(rows(env, proposals="with")) == {("c1", "en")}
    assert set(rows(env, proposals="without")) == {("c2", "en")}
    facets = env.lead.get(f"{BASE}/document-rows").json()["bar"]["facets"]["proposals"]
    assert facets == {"with": 1, "without": 1}


def test_consolidation_progress_only_while_consolidating(tmp_path):
    env = proposal_env(tmp_path)
    assert rows(env)[("c1", "en")]["consolidation_progress"] is None
```

  plus `test_consolidation_progress_counts_open_groups` (two submitted proposal checks with one differing decision built through the API as in P6's heavy test, start a consolidation via `POST {BASE}/consolidations` with the lead as reviewer as `tests/test_consolidation_start_api.py` does; the row has `consolidation_progress == {"open": k, "total": n}` with `n >= 1` and `k <= n`; after resolving one group through the resolve route `open` is one less). Adapt the `PersonRefView` field name (`grep -n "class PersonRefView" -A8 src/ontocurator/api/*.py`).

  `tests/test_my_tasks_dates.py`: `test_my_tasks_show_mode_and_assignment_date` (assign c1 and c2 to `anno`; `GET /api/v1/me/tasks` as `anno`: c1 `annotation_mode == "check"`, c2 `"blind"`, both `assigned_at` set; a translation review task has `annotation_mode is None`).
- [ ] **Step 2:** `uv run pytest -n 4 tests/test_document_rows_proposals.py tests/test_my_tasks_dates.py -q` → FAIL; implement; → PASS. Then the read-model regression set: `uv run pytest -n 4 tests/test_document_rows*.py tests/test_final_panel_api.py tests/test_browser_documents_fixture*.py tests/test_browser_overview_fixture.py -q` (expand globs).
- [ ] **Step 3: Contracts (token 4).** Regenerate; `client.ts`: `DocumentRowsQuery.proposals?: ("with" | "without")[]` serialised like the other facet lists; `fixtures.ts` defaults `proposal_count: 0`, `annotation_mode: null`, `consolidation_progress: null`, work item `assigned_at: null`, `assigned_by: null`, `annotation_mode: null`; typecheck; `bash scripts/check.sh --only static`.
- **Done:** all fields additive with defaults; progress computed only for shown rows (one query per shown consolidating row, none otherwise).
- **Commit:** `feat(documents): proposals, annotation mode, assignment dates in rows and tasks`

### P8: Text view layers and the final-result layer (contracts writer 5)

- **Goal:** the text view's "Show" list comes from the server, including entries the viewer may not see (greyed, with the reason) and the final result.
- **Spec:** §4.
- **Facts verified:** `authz/versions.py:105-208` emits only `own`, `submission` (lead: `EXPORT_ALL_WORK`) and `proposals` (`may_read_proposals`); `stage_result`/`release` are never emitted; no final-result layer exists (the final selection is a badge in `CaseViewer.tsx:203-212`); `GET /documents/{doc}/annotation-versions/{kind}/{id}` re-lists refs and 404s an unlisted one (`authz/scoped.py:537`, payloads `storage/repository.py:2086-2110`). Final selections: `storage/final_tables.py:12 FinalSelectionRow(case_id, language, document_id, submission_id, selected_at, actor_id)`.
- **Owns:** `src/ontocurator/authz/versions.py`, `src/ontocurator/authz/scoped.py` (`get_annotation_version` only), `src/ontocurator/storage/repository.py` (`:2086-2110` payload of kind `final`), `src/ontocurator/api/variant_routes.py`, contracts (token 5), `frontend/src/api/client.ts` (`listTextLayers`), `tests/test_text_layers_api.py` (create).
- **Size / lane / review:** M / heavy / yes.
- **Prerequisites:** contracts token 5.

Model and rule (in `authz/versions.py`):

```python
class TextLayerEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["proposals", "submission", "own", "final", "person"]
    ref: VersionRef | None  # None when not available
    label: str
    state: Literal["submitted", "in_progress", "not_started", "accepted", "not_accepted"] | None = None
    count: int | None = None  # findings (submissions) or proposals
    available: bool
    reason: str | None = None
```

`text_layers(conn, access, project_id, key, doc) -> list[TextLayerEntry]`, order: proposals, people (assignment order), own, final:
- **Tool proposals** (only when the document has proposals): `available = may_read_proposals(...)`, label `Tool proposals ({n})`; unavailable reasons: viewer holds a blind annotate assignment on the text → `Hidden while you annotate blind.`; otherwise `Only the project lead and people checking the proposals see them.`
- **People** (only for viewers with `EXPORT_ALL_WORK`, i.e. the lead; other viewers never learn about other people's work, blinding): one entry per non-revoked annotate or review assignment of the document: submitted → `kind="submission"`, available, ref of the latest submission, label `{display name}, submitted {d Mon}`, `count` = findings; not submitted → `kind="person"`, unavailable, label `{display name}, {in progress|not started}`, reason `Not submitted yet.`
- **Own** submissions as today (`kind="own"`).
- **Final result** (lead): selection exists for the document → `kind="final"`, available, ref `VersionRef(kind="final", id=<submission_id>, label="Final result", created_at=selected_at)`, label `Final result, accepted {d Mon}`; no selection → unavailable `Final result (not yet accepted)`, reason `Not accepted yet.`; a selection on another version of the text → unavailable, reason `Accepted on version {n}.`
- `VersionRef.kind` Literal gains `"final"`; `get_annotation_version(kind="final")` returns the selected submission's payload (same path as `submission`) only when the ref is listed for this viewer.
- Route `GET /api/v1/projects/{key}/documents/{doc}/layers` → `{"entries": [TextLayerEntry]}` (same visibility gate as `annotation-versions`).

- [ ] **Step 1: Failing tests** `tests/test_text_layers_api.py` (`proposal_env`, submissions through the API as in P6):
  - `test_lead_sees_proposals_people_and_final_placeholder` (one check submitted by `anno`, `anno2` assigned not started: entries kinds `["proposals", "submission", "person", "final"]`; `person` unavailable with reason `Not submitted yet.`; `final` unavailable `Not accepted yet.`).
  - `test_final_layer_after_acceptance_opens_the_selected_submission` (select the submission as final with `select_final`; entry `final` available; `GET .../annotation-versions/final/{submission_id}` returns its snapshots).
  - `test_blind_annotator_sees_proposals_greyed_and_no_people` (blind text needs proposals: set the c1 override to blind before assigning; entries for `anno` = `[proposals (unavailable, "Hidden while you annotate blind."), own…]`, no `submission`/`person` entries).
  - `test_checker_sees_proposals_and_only_own_work`.
  - `test_unlisted_final_ref_is_not_found` (an annotator requesting `annotation-versions/final/<id>` gets 404 `VERSION_NOT_FOUND`).
- [ ] **Step 2:** `uv run pytest -n 4 tests/test_text_layers_api.py tests/test_case_api.py tests/test_annotation_versions.py -q` → FAIL, implement, PASS.
- [ ] **Step 3: Contracts (token 5).** Regenerate; `client.ts`: `listTextLayers(key: string, documentId: string): Promise<TextLayerEntry[]>`; typecheck; `bash scripts/check.sh --only static`.
- **Done:** blinding unchanged for non-leads (tests); final layer only through the listed ref.
- **Commit:** `feat(viewer): text layers with reasons and the final-result layer`

### U0: Design foundations

- **Goal:** shared pieces the card, rows, consolidation and text view use: axis value tokens (variant B), `AxisValue`, `IconBot` and `IconMore`, `StagePath`, `AssignedDate`, a "More" option of `MenuButton`, and the network-error message (F14).
- **Spec:** §3 "Axis values use fixed colours defined once … design tokens … Colour is never the only signal"; §2b robot icon (ISC licence noted); §2 path colours; §2 "Every assignment … carries its assignment date"; §2 "a labelled More button (with ⋯ icon), never a bare +n"; Small fixes F14.
- **Owns:** `frontend/src/styles/tokens.css` (axis aliases), `frontend/tests/tokens.test.ts` (axis contrast test), `frontend/src/ui/AxisValue.tsx` (create), `frontend/src/ui/icons.tsx` (`IconBot`, `IconMore`), `frontend/src/ui/StagePath.tsx` (create), `frontend/src/ui/AssignedDate.tsx` (create), `frontend/src/app/assignedDate.ts` (create), `frontend/src/ui/MenuButton.tsx` (`icon` prop), `frontend/src/ui/index.ts` (exports), `frontend/src/styles/components.css` (styles of the new ui pieces only), `frontend/src/api/client.ts` (`request` function only: network errors), `frontend/src/admin/errors.ts` (`NetworkError` message only), `DESIGN.md` (sections "Axis values", "Stage path", "More menu"), `THIRD_PARTY_NOTICES.md` (section "Lucide icons"), `LICENSES/lucide-ISC.txt` (create), tests `frontend/tests/ui/axisValue.test.tsx`, `frontend/tests/ui/stagePath.test.tsx`, `frontend/tests/ui/assignedDate.test.ts`, `frontend/tests/ui/menuButtonMore.test.tsx`, `frontend/tests/apiNetworkError.test.ts` (all create).
- **Size / lane / review:** M / light (L+ for the final tokens/ui run) / –.
- **Code to read:** `frontend/src/ui/icons.tsx` (whole: 16×16 viewBox, stroke 1.5), `frontend/src/ui/MenuButton.tsx`, `frontend/tests/tokens.test.ts` (helpers `token`, `contrast`, `below`, `cross`), `frontend/src/api/client.ts:690-735` (`request`), `frontend/src/admin/errors.ts:200-230`, `DESIGN.md:152-190, 334-345`, `THIRD_PARTY_NOTICES.md` (section pattern of `## hpo-span-annotator`).

**Tokens** (aliases of existing colours only, so no new colour values; append to `tokens.css` in a block commented "Axis values (spec 2026-10-23 §3, variant B)"):

```css
  --axis-present-text: var(--success);        --axis-present-fill: var(--success-light);
  --axis-absent-text: var(--danger);          --axis-absent-fill: var(--danger-light);
  --axis-uncertain-text: var(--warning);      --axis-uncertain-fill: var(--warning-light);
  --axis-patient-text: var(--accent);         --axis-patient-fill: var(--accent-light);
  --axis-family-text: var(--review-badge-text); --axis-family-fill: var(--review-badge-fill);
  --axis-other-text: var(--text-muted);       --axis-other-fill: var(--surface-sunken);
  --axis-current-text: var(--notice-info-text); --axis-current-fill: var(--notice-info-fill);
  --axis-historical-text: var(--text-muted);  --axis-historical-fill: var(--surface-sunken);
  --axis-future-text: var(--notice-warning-text); --axis-future-fill: var(--notice-warning-fill);
  --axis-neutral-text: var(--text);           --axis-neutral-fill: var(--surface-raised);
```

(one declaration per line in the real file.) Test `axis_value_tokens_reach_aa` in `tokens.test.ts`: for each pair `--axis-X-text` on `--axis-X-fill`, `contrast >= 4.5`; and `axis_value_tokens_are_aliases` (each value matches `/^var\(--[a-z0-9-]+\)$/`).

**`ui/AxisValue.tsx`:**

```tsx
import { axisOptionLabel } from "../editor/axisLabels";

const SLOTS: Readonly<Record<string, string>> = {
  present: "present", absent: "absent", uncertain: "uncertain",
  patient: "patient", family_member: "family", other: "other",
  current: "current", historical: "historical", future: "future",
};

/** An axis value as text on its fixed colour (spec §3 variant B); the word always stays. */
export function AxisValue({ value }: { value: string | null | undefined }): JSX.Element {
  const slot = (value && SLOTS[value]) || "neutral";
  return <span className={`axis-value axis-value--${slot}`}>{axisOptionLabel(value)}</span>;
}
```

CSS: `.axis-value { display: inline-block; padding: 0 var(--space-1); border-radius: var(--radius-sm); font-size: var(--size-sm); }` and per slot `.axis-value--present { color: var(--axis-present-text); background: var(--axis-present-fill); }` …, `.axis-value--neutral { border: 1px solid var(--border); }`; forced colours: `@media (forced-colors: active) { .axis-value { border: 1px solid CanvasText; } }`.
Tests (`axisValue.test.tsx`): `renders the word for every known value` (present → "Present", family_member → "Family member"), `uses the fixed slot class` (absent → `axis-value--absent`), `unknown values are neutral and keep their words` (`clinically_suspected_only` → class `axis-value--neutral`, text "Clinically suspected only"), `empty value reads Not specified`.

**Icons** (`icons.tsx`, 16×16 house style; Lucide "bot" scaled from 24 to 16 by `transform="scale(0.6667)"` on a group so the paths stay verbatim; add a comment `// Lucide "bot" (ISC, https://lucide.dev, see THIRD_PARTY_NOTICES.md)`):

```tsx
export const IconBot = (p: IconProps) => (
  <Icon {...p}>
    <g transform="scale(0.6667)" strokeWidth="2.25">
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </g>
  </Icon>
);
export const IconMore = (p: IconProps) => (
  <Icon {...p}><circle cx="3.5" cy="8" r="0.75" /><circle cx="8" cy="8" r="0.75" /><circle cx="12.5" cy="8" r="0.75" /></Icon>
);
```

(`strokeWidth="2.25"` × 0.6667 ≈ 1.5, the house stroke.) `THIRD_PARTY_NOTICES.md` section `## Lucide icons` (Source `https://github.com/lucide-icons/lucide`, icon `bot`, License ISC → `LICENSES/lucide-ISC.txt`, Modification "scaled to the 16 px grid"); `LICENSES/lucide-ISC.txt` = the Lucide ISC licence text (copy from the Lucide repository's `LICENSE`, "ISC License, Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022." followed by the ISC permission text). If `scripts/license_notices.py --check` (or `check_wheel.py`) validates the notices file, run it.

**`ui/StagePath.tsx`** (used by the text card with `onSelect`, by the consolidation screen without):

```tsx
export type PathTone = "done" | "now" | "later" | "optional";
export interface PathSegment { id: string; title: string; state: string; tone: PathTone }
export interface StagePathProps {
  segments: readonly PathSegment[];
  /** The segment shown below (dark blue); none on the consolidation screen. */
  current?: string;
  onSelect?: (id: string) => void;
  label?: string; // default "Text path"
}
```

Renders `<nav aria-label={label}><ol className="stage-path">` with one `<li>` per segment; with `onSelect` each is a `<button type="button" aria-current={id === current ? "step" : undefined}>` containing `<span className="stage-path-title">{title}</span><span className="stage-path-state">{state}</span>` and a visually hidden tone word (`", done"`, `", needs work now"`, `", later"`, `", optional"`) so colour is never the only signal; without `onSelect`, `<span>`s with the same content. Classes `stage-path-seg--{tone}` and `stage-path-seg--current`. Colours: done `--success-light`/`--success` border, now `--accent-light`, later/optional `--surface-sunken` with `--text-muted`, current `--accent` fill with `--on-accent` text. Arrow shapes via CSS `clip-path` with a plain-border fallback under `forced-colors`.
Tests (`stagePath.test.tsx`): `renders three segments with title and state`, `marks the current segment with aria-current=step`, `announces the tone in words`, `calls onSelect with the id`, `renders no buttons without onSelect`.

**`app/assignedDate.ts`** (pure; spec mockup rule):

```ts
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = (n: number) => String(n).padStart(2, "0");

/** "assigned today 10:40", "assigned yesterday", "assigned Mon" (within 7 days), else "assigned 14 Oct". */
export function assignedText(at: Date, now: Date): string {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days <= 0) return `assigned today ${two(at.getHours())}:${two(at.getMinutes())}`;
  if (days === 1) return "assigned yesterday";
  if (days < 7) return `assigned ${WEEKDAYS[at.getDay()]}`;
  return `assigned ${at.getDate()} ${MONTHS[at.getMonth()]}`;
}

/** Hover text: "Assigned 21 Oct 2026, 16:44 by Project lead". */
export function assignedTitle(at: Date, by: string | null): string {
  const base = `Assigned ${at.getDate()} ${MONTHS[at.getMonth()]} ${at.getFullYear()}, ${two(at.getHours())}:${two(at.getMinutes())}`;
  return by ? `${base} by ${by}` : base;
}
```

`ui/AssignedDate.tsx`: `({ at, by, now = new Date() }: { at: string | null | undefined; by?: string | null; now?: Date }) => at ? <time dateTime={at} title={assignedTitle(new Date(at), by ?? null)}>{assignedText(new Date(at), now)}</time> : null`.
Tests (`assignedDate.test.ts`, fixed local dates): today → `assigned today 10:40`; yesterday → `assigned yesterday`; 3 days ago on a Monday → `assigned Mon`; 9 days ago → `assigned 14 Oct`; title with and without `by`.

**`MenuButton` "More":** new optional prop `icon?: ReactNode`; when given, the button shows `{icon}<span>{buttonLabel}</span>`. Callers that replace "+n" pass `buttonLabel="More"` and `icon={<IconMore />}`; `label` stays the accessible name. Test (`menuButtonMore.test.tsx`): `shows More with the icon and keeps the accessible name` (`getByRole("button", { name: "More actions, case-1 de" })`, text content `More`, an `svg` inside).

**Network errors (F14):** in `client.ts` `request`, wrap the `fetch` call:

```ts
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
      throw new NetworkError(cause);
    }
```

with `export class NetworkError extends Error { constructor(readonly cause: unknown) { super("Connection lost. Try again."); this.name = "NetworkError"; } }`. `errors.ts` `errorMessage` returns `"Connection lost. Try again."` for `NetworkError` (never `error.message` of a raw `TypeError`). Where a retry exists the callers keep their own "Try again" button; `ErrorNotice` shows a `Try again` button when given an `onRetry` (add the optional prop if missing — `ErrorNotice.tsx` then joins Owns). Test (`apiNetworkError.test.ts`): `a failed fetch becomes NetworkError with the calm message` (`vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"))`; `await expect(api.listProjects()).rejects.toBeInstanceOf(NetworkError)`; `errorMessage(error) === "Connection lost. Try again."`), `aborts stay aborts`.

**DESIGN.md:** add `### Axis values` under Colors (table of the ten slots, rule "the word always stays; colour is a second signal"), `### Stage path` under Components (tones, current, words for the tone), `### More menu` (labelled "More" with the ⋯ icon; never a bare "+n").

- [ ] **Step 1:** write the five test files above; `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/ui tests/apiNetworkError.test.ts tests/tokens.test.ts` → FAIL.
- [ ] **Step 2:** implement; same command → PASS; `npm --prefix frontend run typecheck`.
- **Done:** no new colour literal outside `tokens.css`; licence noted; DESIGN.md updated.
- **Commit:** `feat(ui): axis value colours, stage path, assigned dates, bot and more icons`

### U1: Task and action names (F1, F16)

- **Goal:** the same names everywhere before the bigger UI WPs build on them.
- **Spec:** §1 "Annotation review … renamed … 'Review a submitted annotation'. Every place that says just 'Review' for the translation review says 'Translation review' (F1)"; §3 "The final action is called 'Accept result…' everywhere (F16)"; §2 "no 'Annotate only' style labels without context".
- **Owns:** `frontend/src/app/labels.ts`, `frontend/src/app/submissionLabels.ts`, `frontend/src/tasks/ProblemReportDetail.tsx` (task map only), `frontend/src/admin/assignSummary.ts`, `frontend/src/documents/historyLines.ts`, `frontend/src/documents/labels.ts`, `frontend/src/documents/nextStepLabels.ts`, `frontend/src/documents/finalPanelText.ts`, `frontend/src/documents/FinalPanel.tsx` (labels only), `frontend/src/consolidation/consolidationText.ts`, `frontend/src/consolidation/SummaryDialog.tsx`, `frontend/src/documents/SelectionBar.tsx` (labels only), `frontend/src/documents/filterModel.ts` (labels only), `frontend/src/documents/PlanChips.tsx` and `frontend/src/ui/PlanChip.tsx` and `frontend/src/documents/PlanDialog.tsx` and `frontend/src/documents/RowActions.tsx` and `frontend/src/admin/UploadWorkPlan.tsx` (the word "Review" only), `frontend/src/variants/CaseViewer.tsx` (`<h2>Review</h2>` only), and the unit tests asserting these strings (find them with the grep below; list them in the hand-back).
- **Size / lane / review:** S / light / –.

Rename table (exact strings):

| Old | New | Files |
|---|---|---|
| `taskLabels.review: "Review"` | `"Review a submitted annotation"` | `app/labels.ts:16`, `tasks/ProblemReportDetail.tsx:18` |
| `taskLabels.annotate: "Annotation"` | unchanged (the mode is appended by U2 where known) | |
| `submissionLabels review: "Review"` | `"Review of a submitted annotation"`; add `proposal_check: "Proposal check"` | `app/submissionLabels.ts:11` |
| `"Annotation review"` | `"Review of a submitted annotation"` | `documents/historyLines.ts:45, 47`, `admin/assignSummary.ts:17` (`review: "Review a submitted annotation"`) |
| `"Annotation review open"` | `"Review of a submitted annotation open"` | `documents/labels.ts:107, 114` |
| `annotation_review_in_progress: "Annotation review in progress"` | `"Review of a submitted annotation in progress"` | `documents/nextStepLabels.ts:31` |
| `"Assign annotation review"` | `"Assign review of a submitted annotation"` | `documents/SelectionBar.tsx:52-56` |
| `"Annotate only"` | `"Annotation only, no translation review"` | `documents/SelectionBar.tsx:193` (+ doc comment `:6`) |
| `"Review + annotate translations"` | `"Translation review and annotation"` | `documents/SelectionBar.tsx` |
| Plan flag `"Review"` / `"Don't review"` | `"Translation review"` / `"No translation review"` | `PlanChips.tsx:118`, `ui/PlanChip.tsx:28`, `RowActions.tsx:74`, `PlanDialog.tsx:211-218`, `admin/UploadWorkPlan.tsx:110, 137` (column header `Translation review`) |
| facet legend/chip `"Review"` | `"Translation review"` | `filterModel.ts:53, 92`; `PLAN_LABELS.review` (`:36`) → `"Translation review"`, `review_and_annotate` → `"Translation review and annotation"` |
| `<h2>Review</h2>` | `<h2>Translation review</h2>` | `variants/CaseViewer.tsx:57` |
| `"Accept as final"`, `"Accept as final…"`, `"Accept as final?"` | `"Accept result…"`, confirm title `"Accept result?"` | `FinalPanel.tsx:281, 303, 306, 366`, `finalPanelText.ts:29, 91-94` (`"Accept your consolidation as the result?"`, `"Accept {name}'s annotation as the result?"`), `nextStepLabels.ts:47, 146-153` |
| `"Consolidation submitted. Accept it as final in Documents."` / `"The lead accepts it as the final result."` | `"Consolidation submitted. Accept the result in Documents."` / `"The lead then accepts the result."` | `consolidationText.ts:56-57`, `SummaryDialog.tsx:25` |

The stage column titles (`Review` in `DocumentsTable.tsx`, `RowCells.tsx`, `StageStrip.tsx`, `DocumentCards.tsx`, `DocumentsPage.tsx:72`) are **not** changed here; U4 renames the columns to `Translation`, `Annotation`, `Finalization` and U3 deletes `StageStrip`.

- [ ] **Step 1:** `grep -rnE "\"Review\"|'Review'|Annotation review|Annotate only|Accept as final|accepts it as the final" frontend/src frontend/tests` → list; update the test expectations first (they fail against the old code).
- [ ] **Step 2:** apply the table; `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 <the listed test files>` → PASS; `npm --prefix frontend run typecheck`.
- [ ] **Step 3:** `grep -rnE "Annotation review|Accept as final|Annotate only" frontend/src` → empty.
- **Done:** the grep in Step 3 is empty; browser specs that assert old strings are listed for T3 (do not edit browser specs here).
- **Commit:** `feat(ui): name translation review, review of a submitted annotation and Accept result`

### U2: Proposal check in the editor, My tasks, assign dialog, Settings → Workflow, F8, V2

- **Goal:** the annotator works through proposals in the existing review screen; My tasks, the assign dialog and Settings show the mode; the task opens calmly; the editor header shows the language flag.
- **Spec:** §1 Q1 (J/K, 1–4/0), Q3 (assign dialog shows the mode; Settings → Workflow), §2 "Every assignment shown anywhere (… My tasks, history, assign dialog holders) carries its assignment date"; Small fixes F8, V2.
- **Owns:** `frontend/src/editor/modes.ts` (create), `frontend/src/app/CaseScreen.tsx`, `frontend/src/editor/decisionSemantics.ts`, `frontend/src/variants/SubmissionHistory.tsx` (mode → kind), `frontend/src/documents/FinalPanel.tsx:267` (review-like check only), `frontend/src/tasks/MyTasks.tsx`, `frontend/src/tasks/TaskEditor.tsx` (loading state), `frontend/src/translation/TranslationReviewScreen.tsx:90` (loading state), `frontend/src/admin/AssignWorkDialog.tsx`, `frontend/src/admin/projectFields.tsx`, `frontend/src/admin/ProjectSettingsPage.tsx`, `frontend/src/styles/components.css` (loading state rule only), tests `frontend/tests/editorModes.test.ts` (create), `frontend/tests/proposalCheckScreen.test.tsx` (create), `frontend/tests/myTasks.test.tsx`, `frontend/tests/assignWorkDialog.test.tsx`, `frontend/tests/projectSettings.test.tsx`, `frontend/tests/taskLoading.test.tsx` (create).
- **Size / lane / review:** M / L+ / –.
- **Code to read:** `CaseScreen.tsx` lines from `grep -n 'mode === "review"\|mode !== "review"' frontend/src/app/CaseScreen.tsx` (14 sites: 294, 554, 598, 913, 1093, 1746, 2252, 2333, 2383, 2481, 2653, 2655, 2686, 2776-2787, 2923, 3269, 3447), `editor/decisionSemantics.ts`, `tasks/MyTasks.tsx`, `admin/AssignWorkDialog.tsx:180-240`, `admin/projectFields.tsx:80-123`, `tasks/TaskEditor.tsx:30-130`, `styles/components.css:610-625` (reading density first child), `tests/caseScreen.test.tsx` (how a review view is rendered in tests).
- **Prerequisites:** `grep -n "proposal_check" frontend/src/api/generated.ts` (P2/P3 contracts), `grep -n "assigned_at" frontend/src/api/generated.ts` (P5).

`editor/modes.ts`:

```ts
import type { WorkspaceMode } from "../api/client";

/** Modes with targets and decisions: the review of a submitted annotation and the proposal check. */
export function isReviewLike(mode: WorkspaceMode | string | undefined): boolean {
  return mode === "review" || mode === "proposal_check";
}

export function modeBadge(mode: string): { label: string; title?: string; className: string } {
  if (mode === "proposal_check") return { label: "Check tool proposals", title: "You see the tool's proposals, never other people's work.", className: "badge-review" };
  if (mode === "review") return { label: "Review proposals", className: "badge-review" };
  if (mode === "assisted") return { label: "Assisted annotation", className: "badge-assisted" };
  return { label: "Independent annotation", title: "You do not see proposals from other people or tools.", className: "badge-independent" };
}

export function annotationTaskName(mode: "check" | "blind" | null | undefined): string {
  return mode === "check" ? "Annotation: check tool proposals" : mode === "blind" ? "Annotation: blind" : "Annotation";
}
```

(If `WorkspaceMode` is not exported from `client.ts`, import the type from `generated.ts` the way `client.ts` does.) Every `view.key.mode === "review"` in `CaseScreen.tsx` and `decisionSemantics.ts:9` becomes `isReviewLike(view.key.mode)`; the badge block at `:2774-2787` uses `modeBadge` (consolidation/text-change/carry branches unchanged); the shortcut group name `"Review"` (`:2654-2655`) becomes `"Decisions"` (the help overlay lists J/K and 1–4/0 there). `SubmissionHistory.tsx:27`: kind `proposal_check` for mode `proposal_check`. `FinalPanel.tsx:267`: review-like check.

**V2:** the editor header `<h1 className="case-title">` gets `<LanguageTag language={view.document.language} />` after the case id (from `ui/LanguageTag.tsx`).

**F8:** `TaskEditor.tsx:40, 123` and `TranslationReviewScreen.tsx:90`: replace the info `InlineMessage` with `<p className="task-loading" role="status">Opening task…</p>` (translation: `Opening translation review…`) and CSS `.task-loading { color: var(--text-muted); padding: var(--space-5) var(--space-6); flex: 0 0 auto; }` so the reading-density rule (`components.css:619`, first child stretches) does not paint a large blue area: also change that rule to `.shell-main.density-reading > div:first-child:not(.task-loading)`.

**My tasks:** task column `annotationTaskName(task.annotation_mode)` for annotate tasks, `"Review a submitted annotation"` / `"Translation review"` otherwise; new column "Assigned" with `<AssignedDate at={task.assigned_at} />`.

**Assign dialog:** for task `annotate` on a row, a line `Annotation: check tool proposals` / `Annotation: blind` from `row.annotation_mode.mode` (with the no-proposals reason when `source === "no_proposals"`); "Currently:" lists holders as `{name}, assigned {…}` using `assignedText(new Date(item.assigned_at), now)` (`Already assigned (1 of 2): Tom Reis, assigned today 10:40. Choose 1 more person.` per mockup).

**Settings → Workflow:** `WorkflowDraft.tool_proposal_mode`; a radio group legend `Texts with tool proposals`, options and help texts from the Copy table; saved with the other workflow fields (`ProjectSettingsPage.tsx:106, 118`).

- [ ] **Step 1: Failing tests.**
  - `editorModes.test.ts`: `isReviewLike` for the four modes; `modeBadge("proposal_check").label === "Check tool proposals"`; `annotationTaskName` three cases.
  - `proposalCheckScreen.test.tsx` (render `CaseScreen` with a view whose `key.mode` is `"proposal_check"` and three targets, built like the review fixtures in `tests/caseScreen.test.tsx`): `shows the Check tool proposals badge`, `lists the proposals as review targets`, `J moves to the next proposal and 1 confirms it` (fires `keydown` J then 1; the decision API mock is called with outcome `confirmed` for the second target), `Submit is unavailable until every proposal has a decision` (`aria-disabled="true"` with the reason text), `the header shows the language flag` (V2).
  - `myTasks.test.tsx`: `shows the annotation mode and the assigned date` (`Annotation: check tool proposals`, `assigned today 10:40` with a fixed `now`).
  - `assignWorkDialog.test.tsx`: `shows the annotation mode of the text`, `lists holders with their assignment date`.
  - `projectSettings.test.tsx`: update the payload expectation at `:472-501` to include `tool_proposal_mode`; new `it("saves Texts with tool proposals")`.
  - `taskLoading.test.tsx`: `Opening task… is a calm status line, not an info notice` (no element with class `notice-info`; `role="status"` text `Opening task…`).
- [ ] **Step 2:** run them → FAIL; implement; → PASS: `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/editorModes.test.ts tests/proposalCheckScreen.test.tsx tests/myTasks.test.tsx tests/assignWorkDialog.test.tsx tests/projectSettings.test.tsx tests/taskLoading.test.tsx tests/caseScreen.test.tsx tests/decisionSemantics.test.ts`; typecheck.
- **Done:** `grep -n 'mode === "review"\|mode !== "review"' frontend/src` → empty outside `editor/modes.ts`.
- **Commit:** `feat(editor): proposal check screen, task names with mode and dates`

### U6: Consolidation table screen

- **Goal:** the group card becomes the comparison table of the mockup (variant B), every group resolves to one finding, the result is always spelled out, agreed groups sit in the same list, and the screen shows the text path.
- **Spec:** §3 (all bullets), F9, F10, F11, F12, F15, F16, F17.
- **Facts verified:** `GroupCard.tsx` (305 lines: chips `:61-75` with " · differs", `Comparison` `:78-111`, "Whole finding" chips `:232-241`, action buttons `:248-256`), `GroupList.tsx` puts auto-kept groups in their own `<section aria-label="Kept automatically">` (`:58-64`), `groupModel.ts` builds rows/choices/payload, `ConsolidationScreen.tsx:263` header "Consolidate case-0107 · en v1". After P7 no keep-both code remains.
- **Owns:** `frontend/src/consolidation/*` (all files), `frontend/tests/consolidation/*`, `frontend/tests/leadConsolidation.test.tsx` (strings only), `DESIGN.md` (section "Consolidation view" `:334-345` rewritten).
- **Size / lane / review:** L / L+ / yes.
- **Prerequisites:** `grep -c "term_parts\|keep_both" frontend/src/consolidation/*.ts*` → 0 except the stored-mark label (P7); `grep -n "export function StagePath" frontend/src/ui/StagePath.tsx` and `grep -n "export function AxisValue" frontend/src/ui/AxisValue.tsx` (U0).

Structure (files after this WP):

| File | Content |
|---|---|
| `ConsolidationScreen.tsx` | header: `<StagePath segments={[{id:"translation",…tone:"done"},{id:"annotation",title:"Annotation",state:`${n} submitted`,tone:"done"},{id:"finalization",title:"Finalization",state:`consolidating, ${open} of ${total} groups open`,tone:"now"}]} label="Text path" />` (translation segment `source text` for a native text, else `accepted`/`not reviewed, optional` from the round's text facts already in the view; if the view lacks them, show `Translation` with state `done` — check `ConsolidationView` fields first); `<h1>Consolidate {case} {language} v{n}</h1>` (no `·`); one `GroupList`; `SubmitBar`; `SummaryDialog` |
| `GroupList.tsx` | one `<ul aria-label="Groups">` in document order of `start`; open groups first is **not** done (order by text position, spec "same list style"); agreed (auto-kept) groups render with `GroupCard` in collapsed form marked `agreed`; J/K walk open groups only (unchanged keys) |
| `GroupCard.tsx` | header: `!` icon (`IconWarning`, `aria-hidden`, visually hidden text "Conflict") when the group has decisions, the group name (the text excerpt), `{n} fields to decide` / `agreed` / `decided`; body `ComparisonTable`; `ResultLine`; footer: `Leave out`, `Other term…`, `Edit in editor…` (existing actions, plain buttons, no pills) |
| `ComparisonTable.tsx` (create) | `<table>` with `<caption className="visually-hidden">Comparison of {group}</caption>`; column headers = people (name + lane line swatch `LaneKey`); rows: `Term`, each axis of the layer type, `Text`, `Note`, `Whole finding` |
| `ResultLine.tsx` (create) | always visible `<p className="cons-result" aria-live="polite">`: `Result: 1 finding, {label} ({id}), {axis values or "{axis} not chosen yet"}` and a second line `Not taken: {label} ({person}), …` when other terms exist |
| `groupModel.ts` | pure: `comparisonRows(group, people, choices) -> ComparisonRow[]`, `resultLine(group, people, choices) -> { saved: string; notTaken: string \| null }`, `choicesComplete`, `resolvePayload` (`keep` when nothing differs, else `choose` with term, every differing axis, `span_from_input_id`) |
| `consolidationText.ts` | copy below |
| `consolidation.css` | table styles; no pill styles (`.cons-chip` removed); row tint `.cons-row--conflict { background: var(--warning-light); }` |

`ComparisonRow` model:

```ts
export type RowKind = "term" | "axis" | "text" | "note" | "whole";
export interface ComparisonCell { inputId: string; value: string; display: string; chosen: boolean }
export interface ComparisonRow {
  kind: RowKind;
  id: string;            // "term", axis id, "text", "note", "whole"
  label: string;         // "Term", axis label, "Text", "Note", "Whole finding"
  conflict: boolean;     // people disagree and a choice is needed
  agreed: string | null; // "patient (all agree)" when everyone agrees, else null
  info: string | null;   // Text: "(overlapping, comes with the chosen finding)"; Note: never blocks
  cells: ComparisonCell[];
}
```

Rules: a row is `conflict` for the term when `kinds` has `term_differs`, for an axis in `group.differing_axes`, for the text only when `group.span_conflict` (existing server rule), never for the note. An agreeing row renders as one grey line `<td colSpan>`: `{value} (all agree)`. A conflicting row: `!` marker in the row header, tint, and in each cell the value (axis values via `AxisValue`) plus a `✓` toggle button `aria-pressed`, accessible name `Take {value} from {person} for {label}`. Text row without conflict: `"{excerpt}" (overlapping, comes with the chosen finding)`. Note row: each person's note as text, no button. Whole finding row: `Take {first name}'s finding` per column (sets term, every axis, text and note from that person).

Copy (`consolidationText.ts`, verbatim): `{n} fields to decide`, `1 field to decide`, `agreed`, `decided`, `Result: `, `not chosen yet`, `Not taken: `, `(all agree)`, `(overlapping, comes with the chosen finding)`, `Whole finding`, `Take {name}'s finding`, `Leave out`, `Other term…`, `Edit in editor…`, `Submit consolidation`, `Next open group`. Summary dialog: `{n} groups, {k} findings, {m} left out`. No `·` anywhere in the folder.

- [ ] **Step 1: Failing model tests** (`frontend/tests/consolidation/model.test.ts`, fixtures from `tests/consolidation/fixtures.ts`; add a three-person group fixture `hypotoniaThree` mirroring the mockup: Tom Hypotonia present patient current, Mia Hypotonia absent patient current, Ali Axial hypotonia present patient current):
  - `comparison rows mark term and assertion as conflicts and the rest as agreed` (rows `term` and `assertion` have `conflict: true`; `experiencer.agreed === "Patient (all agree)"`, `temporality.agreed === "Current (all agree)"`).
  - `text is information unless spans conflict` (`text.conflict === false`, `info` as above; with `span_conflict: true` it is a conflict with one cell per person).
  - `notes never block` (`note.conflict === false` even when notes differ).
  - `result line names the open choices` (no choices → `Result: 1 finding, Hypotonia (HP:0001252), assertion not chosen yet, Patient, Current` — the term is the majority/first member's until chosen; `notTaken === "Not taken: Axial hypotonia (Ali)"`).
  - `taking a whole finding fills every row` (`Take Ali's finding` → term Axial hypotonia, result line complete, `notTaken` names Hypotonia (Tom, Mia)).
  - `payload is keep when everyone agrees and choose otherwise` (`resolvePayload` of an agreed group → `{action: "keep"}`; of the three-person group after choosing term and assertion → `{action: "choose", choice: {term_id, axes: {assertion}, span_from_input_id}}`).
  - `never offers keep both` (no label contains `both`).
- [ ] **Step 2: Failing component tests** (`groupCard.test.tsx`, `screen.test.tsx` rewritten):
  - `the card shows the conflict marker, the name and the count of fields to decide` (`2 fields to decide`; an element with accessible text `Conflict`).
  - `a conflicting row has a ✓ per person and takes the value` (click `Take Absent from Mia Berg for Assertion` → `aria-pressed="true"`, result line says `Absent`).
  - `agreed rows are one grey line` (`Patient (all agree)` present once).
  - `axis values use the fixed colour slots` (the cell for `Present` has class `axis-value--present`).
  - `no pill buttons and no "differs" text` (`queryByText(/differs/)` null; no element with class `cons-chip`).
  - `agreed groups are in the same list, marked agreed` (screen: one list `Groups`; an auto-kept group's card shows `agreed`; no section `Kept automatically`).
  - `the screen shows the text path with Finalization current` (`getByRole("navigation", { name: "Text path" })` with `Finalization` text and `consolidating, 2 of 3 groups open`).
  - `J and K walk the open groups`; `Submit is unavailable until every group is resolved`; `the submitted message says Accept the result in Documents` (unchanged behaviour, new copy).
- [ ] **Step 3:** implement; `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/consolidation tests/leadConsolidation.test.tsx tests/consolidationEditor.test.tsx` → PASS; typecheck.
- [ ] **Step 4:** `DESIGN.md` "Consolidation view" table updated (comparison table, result line, agreed marker, path; remove chips/"Keep both"/banner/"· differs").
- **Done:** every §3 bullet visible in a test; no `·`, no pills, no keep both.
- **Commit:** `feat(consolidation): comparison table with result line and one finding per group`

### U3: Text card (replaces the row side panel)

- **Goal:** one click on a row opens a centered card with the path and the selected segment's details and actions; the old panel, its tabs and the stage strip go away.
- **Spec:** §2 (all bullets), V1, F4, F6, F17, F20, F21, F22, F24.
- **Owns:** `frontend/src/documents/textCard/` (create: `TextCard.tsx`, `cardModel.ts`, `TranslationPart.tsx`, `AnnotationPart.tsx`, `FinalizationPart.tsx`, `AssignmentChip.tsx`, `RemoveAssignmentDialog.tsx`, `CardFooter.tsx`, `textCard.css`), `frontend/src/documents/RowPanel.tsx` (delete), `frontend/src/documents/StageStrip.tsx` (delete), `frontend/src/documents/StagePopover.tsx` (delete if only the cards used it for the panel; else keep and point "Open full details" to the card), `frontend/src/styles/screens/documents-panel.css` (delete; card styles in `textCard.css`), `frontend/src/documents/RowActivity.tsx` (reused as History; dates via `AssignedDate`), `frontend/src/documents/TextVersions.tsx` (reused in the Translation part), `frontend/src/documents/FinalPanel.tsx` (embedding only), `frontend/src/admin/DocumentsPage.tsx` + `frontend/tests/documentsPage.test.tsx` (**DocumentsPage token 1**: panel wiring → card wiring), tests `frontend/tests/documents/textCard.test.tsx`, `frontend/tests/documents/cardModel.test.ts`, `frontend/tests/documents/assignmentChip.test.tsx` (create); delete `frontend/tests/documents/rowPanel.test.tsx`, `rowPanelReports.test.tsx` (their still-valid cases move to `textCard.test.tsx`), `stagePopover.test.tsx` if `StagePopover` is deleted.
- **Size / lane / review:** L / L+ / yes.
- **Code to read:** `RowPanel.tsx` (whole: props, J/K, focus return, narrow sheet), `admin/DocumentsPage.tsx:500-640` (panel route params, `DecisionBlock` wiring, `onAssign`, `rowExtras`), `documents/stageLabels.ts:181-230` (`stageText`, `waitingOnText`), `documents/RowActivity.tsx`, `documents/TextVersions.tsx`, `ui/Dialog.tsx` (`variant="center"`, `size="lg"`, `returnFocus`), `ui/ConfirmDialog.tsx`.
- **Prerequisites:** U0, U1, U2 committed; P3/P5 contracts (`removeAssignment`, `checkProposalsMyself`, `assigned_at`, `annotation_mode`, `proposal_count`, `consolidation_progress`).

`cardModel.ts` (pure):

```ts
import type { DocumentRowView } from "../../api/client";
import type { PathSegment, PathTone } from "../../ui/StagePath";

export type SegmentId = "translation" | "annotation" | "finalization";

export function translationState(row: DocumentRowView): { state: string; tone: PathTone } { /* table below */ }
export function annotationState(row: DocumentRowView): { state: string; tone: PathTone } { /* table below */ }
export function finalizationState(row: DocumentRowView, now: Date): { state: string; tone: PathTone } { /* table below */ }

export function cardSegments(row: DocumentRowView, now = new Date()): PathSegment[] {
  return [
    { id: "translation", title: "Translation", ...translationState(row) },
    { id: "annotation", title: "Annotation", ...annotationState(row) },
    { id: "finalization", title: "Finalization", ...finalizationState(row, now) },
  ];
}

/** On open: the segment that needs work now; else the first that is not done; else Finalization. */
export function defaultSegment(segments: readonly PathSegment[]): SegmentId {
  const now = segments.find(s => s.tone === "now") ?? segments.find(s => s.tone === "later");
  return (now?.id ?? "finalization") as SegmentId;
}
```

State table (inputs: `row.is_source`, `row.stages.review|annotation|final.state` and `.detail`, `row.work`, `row.proposal_count`, `row.consolidation_progress`, `row.final`):

| Segment | Condition | State text | Tone |
|---|---|---|---|
| Translation | native source row (`is_source` or review state `source`) | `source text` | done |
| | review state `accepted` | `accepted` | done |
| | review state `not_planned` or note `review_off` (no review wanted) | `not reviewed, optional` | optional |
| | `in_progress`, `re_review` | `in review ({short names of translation_review holders})` | now |
| | `unassigned`, `undecided`, `check_failed`, `rejected`, `query`, `not_accepted`, `source_changed`, `paused` | the existing `stageText("review", …)` short label | now |
| Annotation | annotation state `not_planned` | `not planned` | optional |
| | `after_review`, `blocked` | `after translation review` | later |
| | `unassigned`, `partly_assigned`, `undecided` | `{assigned} of {target} assigned` + (`, {n} proposals` when `proposal_count > 0`) | now |
| | `in_progress`, `in_review`, `paused` | `{submitted} of {target} submitted` | now |
| | `submitted`, `consolidating` and later | `{submitted} of {target} submitted` | done |
| Finalization | final state `none`, `after_annotation`, `after_review` | `waiting` | later |
| | `choose` with ≥ 2 submissions | `ready to compare` | now |
| | annotation state `consolidating` | `consolidating ({open} of {total} groups open)` from `consolidation_progress` (without progress: `consolidating`) | now |
| | `confirm` | `ready to accept` | now |
| | `final` | `accepted {d Mon}` (from `row.final.selected_at` or the cell's `detail.at`) | done |
| | `old_text`, `may_be_outdated` | the existing `stageText("final", …)` label | now |

(`assigned`, `target`, `submitted` come from `stages.annotation.detail`; verify the field names in `generated.ts`.)

`TextCard.tsx` props and layout:

```ts
export interface TextCardProps {
  projectKey: string;
  row: DocumentRowView;
  /** Rows of the current table order, for ‹ ›. */
  rows: readonly DocumentRowView[];
  query: ProjectDocumentsQuery;
  segment?: SegmentId;                       // from the route (panel_stage); default via defaultSegment
  view?: "path" | "history" | "details";     // from the route (panel_tab)
  onSegment: (segment: SegmentId) => void;
  onView: (view: "path" | "history" | "details") => void;
  onStep: (direction: -1 | 1) => void;       // ‹ › previous/next row of the table order
  onClose: () => void;                        // never changes the selection
  onNavigate: (route: Route) => void;
  onAssign: (row: DocumentRowView, task: "translation_review" | "annotate" | "review") => void;
  onRequestCorrection?: (row: DocumentRowView) => void;
  onChangePlan: (row: DocumentRowView) => void;
  onCheckMyself: (row: DocumentRowView) => Promise<void>;
  onChanged: () => void;                      // reload rows after remove
  decision?: ReactNode;                       // the existing DecisionBlock (Compare/Consolidate/Accept result)
  textVersionTools?: TextVersionsTools;
  canManage: boolean;                         // lead
  me?: { username: string } | null;
  now?: Date;
}
```

- `Dialog` `variant="center"`, `size="lg"`, `title={`${case_id} ${language}`}`, `closeOnBackdrop`, `returnFocus` to the opener; header: case id, `LanguageTag`, a version warning only when `row.versions.length > 1` (`v{newest}` plus `, newer than the annotations` when any annotate work item has a lower version), buttons `‹` (`IconChevronLeft`, label `Previous text`) `›` (`Next text`) and `✕` (`IconClose`, `Close`). Esc closes (Dialog); ‹ › are the buttons plus the old panel's shortcuts J (next text) and K (previous text).
- `<StagePath segments={cardSegments(row, now)} current={segment} onSelect={onSegment} />`, then the part of the selected segment; `view === "history"` shows `RowActivity` with a `Back` button; `view === "details"` shows the old `RowDetails` content (moved into `CardFooter.tsx` as `TextDetails`).
- **TranslationPart:** `Version {n}, {origin words}` (`machine translation from English` from the version's origin/source language; native → `Source text`), the automatic check result (`Automatic check passed` / `Automatic check failed: {n} checks`), reviewer chips (`AssignmentChip` for `translation_review` work, with `assigned …`), `Assign reviewer…` (`onAssign(row, "translation_review")`), `Compare with source` (route to the text view with `compare=<source doc>`), the version list (`TextVersions` with `textVersionTools`), `Request correction…`.
- **AnnotationPart:** mode line `Annotation: check tool proposals` / `Annotation: blind` and the reason when `source === "no_proposals"`; `{n} tool proposals` with `View proposals` (route to the text view, `show=proposals`); one `AssignmentChip` per annotate (and review-of-submitted) assignment: name, state (`not started` / `in progress` / `submitted`), `AssignedDate`, and for unsubmitted ones (lead only) an `✕` button `Remove {name}`; `+ Person` (`onAssign(row, "annotate")`, unavailable with reason when the limit is reached: `{target} of {target} assigned`); `Check proposals myself` when `annotation_mode.mode === "check"` and the lead holds no annotate assignment on the row (calls `onCheckMyself`, then navigates to the task route of the returned assignment); a person's chip name links to the text view with that person's layer (`show=submission:<id>` when submitted).
- **RemoveAssignmentDialog:** `ConfirmDialog` title `Remove assignment?`, body `Remove {name} from the annotation of {case}? Their draft is discarded.`, buttons `Cancel` / `Remove` (danger); confirm → `api.removeAssignment(id)` → `onChanged()`; an `ASSIGNMENT_SUBMITTED` error shows its message inline.
- **FinalizationPart:** the state sentence (`Starts when all {target} annotations are submitted: compare the results, consolidate the differences, then accept the result.` while waiting), the `decision` node (Compare results…, Consolidate…, Accept result…), the final result with `Open result` (text view `show=final`).
- **CardFooter:** `History ({n})`, `Text details`, `Change plan…` (`onChangePlan`). No tabs.
- **Narrow (V1):** below 700 px the Dialog is a full-width sheet (`.text-card` media query: `inset: 0; width: 100%; max-height: 100dvh; border-radius: 0`); all text wraps at word boundaries (`overflow-wrap: anywhere` is **not** used; `word-break: normal; overflow-wrap: break-word` on long ids only).

DocumentsPage wiring (token 1): replace `<RowPanel …>` by `<TextCard …>` with the same route params (`panel`, `panel_stage` mapped `review→translation`, `annotation→annotation`, `final→finalization` and back; `panel_tab` `activity|versions|details` → `view` `path|path|details`, new value `history`); `onStep` uses the current page order; closing keeps the selection; `onCheckMyself` → `api.checkProposalsMyself` then `onNavigate({ name: "task", assignmentId })`; `rowExtras` and the side-panel non-modal behaviour are removed (the card is modal). The `+n` menu and row actions stay until U4.

- [ ] **Step 1: Failing tests.**
  - `cardModel.test.ts`: one test per state-table line (fixtures via the builders in `tests/documents/fixtures.ts` + a local `cardFixtures.ts`): e.g. `native text reads source text and done`, `machine translation without review reads not reviewed, optional`, `annotation 1 of 2 assigned with 17 proposals is now`, `2 of 2 submitted is done and finalization is ready to compare`, `consolidating shows 2 of 3 groups open`, `accepted shows the date`; `defaultSegment picks the segment that needs work now`.
  - `assignmentChip.test.tsx`: `shows name, state and assigned date`, `the ✕ asks first with the exact text`, `Cancel keeps the assignment`, `Remove calls removeAssignment and reloads`, `submitted chips have no ✕`.
  - `textCard.test.tsx`: `opens on the segment that needs work now`, `the path switches the part below`, `the header shows the version only when the text has more versions`, `the annotation part shows the mode, the proposal count and View proposals`, `+ Person is unavailable with the reason when the limit is reached`, `Check proposals myself assigns and opens the task`, `‹ › step through the table order`, `Esc and ✕ close without changing the selection`, `History and Text details open inside the card with Back`, `Change plan… calls onChangePlan`, `the finalization part embeds the decision block`, `narrow screens get a full-width sheet` (class at 600 px via `useMediaQuery` mock).
  - `documentsPage.test.tsx`: replace the panel cases (`:995-1147`) by card cases: `a row's card opens from the route and shows the translation segment for panel_stage=review`, `closing the card keeps the selection`, `Check proposals myself navigates to the task`.
- [ ] **Step 2:** implement; `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/documents/textCard.test.tsx tests/documents/cardModel.test.ts tests/documents/assignmentChip.test.tsx tests/documentsPage.test.tsx tests/documents/a11y.test.tsx` → PASS; typecheck.
- **Done:** `grep -rn "RowPanel\|StageStrip\|panel_tab=\"versions\"" frontend/src` → empty; every §2 card bullet covered by a test; browser specs referencing the panel listed for T3.
- **Commit:** `feat(documents): text card with the path replaces the row panel`

### U7: Text view (replaces the CaseViewer fold-out)

- **Goal:** one toolbar, a language-and-version dropdown, a "Show" dropdown with greyed entries and reasons, read-only findings on the right with the axis colours, "Compare" as a second column.
- **Spec:** §4; Small fixes V8 (language as plain text with flag).
- **Owns:** `frontend/src/variants/CaseViewer.tsx`, `frontend/src/variants/TextViewToolbar.tsx` (create), `frontend/src/variants/ShowSelect.tsx` (create), `frontend/src/variants/VersionSelect.tsx` (create), `frontend/src/variants/LayerFindings.tsx` (create), `frontend/src/variants/useTextLayers.ts` (create), `frontend/src/variants/ComparePane.tsx` (axis values via `AxisValue`), `frontend/src/editor/FindingRow.tsx` (`:46-48` axis values via `AxisValue`; spec §3 "used everywhere axis values appear"), `frontend/tests/findingRow.test.tsx`, `frontend/tests/comparePane.test.tsx`, `frontend/src/app/router.ts` (`projectCase` params `show`, `compare_show`), `frontend/src/styles/screens/viewer.css` (create or the existing viewer stylesheet: `grep -rln "case-version-controls" frontend/src/styles`), tests `frontend/tests/textView.test.tsx` (create), `frontend/tests/caseViewer.test.tsx`, `frontend/tests/caseCompareRoute.test.tsx`, `frontend/tests/router.test.ts` (params). `VariantSelectors.tsx` stays (the editor still uses it, `CaseScreen.tsx:2734-2742`).
- **Size / lane / review:** M / L+ / –.
- **Code to read:** `variants/CaseViewer.tsx` (whole), `variants/VariantSelectors.tsx`, `variants/versionState.ts:36-90`, `variants/useCaseVersions.ts`, `variants/ComparePane.tsx`, `variants/ReadOnlyAnnotationView.tsx`, `app/router.ts:110-245`.
- **Prerequisites:** `grep -n "listTextLayers" frontend/src/api/client.ts` (P8).

Route: `#/projects/{key}/cases/{caseId}?variant=<doc>&show=<layer key>&compare=<doc>&compare_show=<layer key>`; layer key = `text` | `proposals` | `submission:<id>` | `own:<id>` | `final:<id>`; the legacy `annotations=` JSON key is read once and mapped to `show` (old links keep working).

Toolbar (`TextViewToolbar.tsx`): `‹ Documents` (back link, keeps the Documents query), the case id, `VersionSelect` (one `<select aria-label="Language and version">`, options `{flag} {language}, version {n} ({origin words})`, e.g. `de, version 1 (machine translation)`, source first, then translations and newer versions, from `useCaseVersions`), `ShowSelect`, `Compare` (toggle; opens the second column), `Text card` (route to Documents with `panel={case}:{language}`). No `·`, no `<h1>Text: …</h1>` with separators; the `<h1>` is `{case id}` with the language as plain text and flag.

`ShowSelect.tsx`: a `<select aria-label="Show">` with `<optgroup label="Text">` (`Text only`), `Proposals` (`Tool proposals (n)`), `Annotations` (people and own), `Result` (`Final result`); unavailable entries are `<option disabled>` with the label and the reason appended (`Mia Berg, in progress (not visible yet)` as in the mockup: label + ` (` + reason without the final period + `)`); entries from `useTextLayers` (`api.listTextLayers`).

`LayerFindings.tsx`: right column `<section aria-label="Findings">` heading `{layer label}` and a list of findings `{term label} ({term id})` with `AxisValue` per axis; first 20 and `{n} more…` (button reveals the rest); no edit controls.

The left/middle uses `ReadOnlyAnnotationView` with the chosen layer (`text` → no marks). Compare: a second column with its own `VersionSelect` and `ShowSelect`, coupled scroll as today (`useCoupledScroll`).

- [ ] **Step 1: Failing tests** (`textView.test.tsx`, api mocked with `vi.spyOn`): `one toolbar with Documents, case id, language and version, Show, Compare, Text card`, `the version select lists source and newer versions with origin words`, `Show lists proposals, people, result with unavailable entries greyed and their reason`, `choosing a layer draws its marks and lists its findings with axis colours`, `Compare opens a second column with its own selects`, `nothing is editable` (no textbox, no button named Save/Delete), `legacy annotations= links map to show`, `the language is plain text with a flag, not a link` (V8); `findingRow.test.tsx` and `comparePane.test.tsx`: `axis values carry their fixed colour slot` (`Absent` has class `axis-value--absent`). Update `caseViewer.test.tsx`/`caseCompareRoute.test.tsx` expectations (no `Versions` summary, no three selectors).
- [ ] **Step 2:** implement; `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/textView.test.tsx tests/caseViewer.test.tsx tests/caseCompareRoute.test.tsx tests/router.test.ts tests/comparePane.test.tsx` → PASS; typecheck.
- **Done:** the "Versions" fold-out is gone from the viewer; every §4 bullet has a test.
- **Commit:** `feat(viewer): text view with one toolbar and a Show choice`

### U4: One-line rows, row click, selection bar for 2+, robot icon, filter, More menu, overflow

- **Goal:** about 16 texts per 1280×900 screen; one click selects and opens the card, a second click deselects; the bar only for bulk work; tool proposals visible before anyone is assigned.
- **Spec:** §2b (all bullets), §2 "Row click toggles the selection", "Bottom selection bar … only when 2 or more", "Documents table row actions: … labelled More"; Small fixes F2/V8, F7, V4 (table links), V7, "Documents page … Fix the overflow".
- **Facts verified:** the "never deselects" rule is `documents/DocumentsTable.tsx:68-80` (`openAndSelect` with mode `"select"`), wired at `:138, :140-144, :152-156, :206`; selection modes in `documents/useTextSelection.ts:70-82`; `SelectionBar` shows for `keys.size > 0 || undoState` (`SelectionBar.tsx:176`); "+n" `MenuButton` at `RowActions.tsx:139-145`; language rendered as a link-styled button (`RowCells.tsx:324-330`, `documents-table.css:61-64`); `Open`/`Open my task` stack (`RowCells.tsx:260-275`, `documents-table.css:55`); `.shell-main` has no `position: relative` while rows contain many `position: absolute` `.visually-hidden` spans (`components.css:522, 616`), the likely cause of the 3990 px document height.
- **Owns:** `frontend/src/documents/DocumentsTable.tsx`, `RowCells.tsx`, `RowActions.tsx`, `SelectionBar.tsx`, `useTextSelection.ts`, `DocumentCards.tsx`, `filterModel.ts`, `FilterPopover.tsx`, `stageLabels.ts` (one-line texts), `frontend/src/ui/spaceActivates.ts` (create), `frontend/src/styles/screens/documents-table.css`, `documents-cards.css`, `selection.css`, `frontend/src/styles/components.css` (`.shell-main` rule only), `frontend/src/admin/DocumentsPage.tsx` + `frontend/tests/documentsPage.test.tsx` (**DocumentsPage token 2**: columns, skeleton header `:72`, row click, bar), tests `frontend/tests/documents/documentsTable.test.tsx`, `rowActions.test.tsx`, `selectionBar.test.tsx`, `documentCards.test.tsx`, `filterModel.test.ts`, `filterPopover.test.tsx`, `useTextSelection.test.ts`, `stageLabels.test.ts`, `a11y.test.tsx`, `frontend/tests/documents/rowClick.test.tsx` (create).
- **Size / lane / review:** L / L+ / yes.
- **Prerequisites:** U3 committed (DocumentsPage token).

Columns (`DocumentsTable.tsx`): `[checkbox] Text | Translation | Annotation | Finalization | Waiting on | Next step | Last activity` (headers visible except the checkbox column, whose header is the "select all on page" checkbox as today).
- **Text:** `<button className="documents-text-name">` (plain text style, not a link: `color: var(--text)`, no underline; focus ring kept) with `LanguageFlag` + language code; `aria-label={`Open text card, ${case} ${language}`}`; NEW and version marker badges stay after it.
- **Case line** (group label row): `{case id}` and, when the case's source row is not in the plan, `source {lang} (native), {n} translation(s)` in grey; that source row is then not rendered as its own row. A planned native text (Annotate on) stays a normal row.
- **Status cells:** one line each: the short state from `cardModel.translationState/annotationState/finalizationState` (shared with the card; import from `textCard/cardModel.ts`) plus a short grey "who" when it fits (`in review (Ana)`); `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` with the full text in `title`.
- **Robot icon:** in the Annotation cell when `row.proposal_count > 0` and the row has no non-revoked annotate work: `<span className="documents-bot" title={t} aria-label={t} role="img"><IconBot /></span>` with `t = `${n} tool proposals available; annotation will check them``. Gone once someone is assigned.
- **Next step:** at most one button: the viewer's next step from `leadSteps(row)[0]` / own task (`Open my task`, `Compare results…`, `Consolidate…`, `Accept result…`, `Assign person…`); no per-row `Open`, no `+n`. If a row still has further actions they live in the card; when a list of more than one action is unavoidable (none expected), use `MenuButton` with `buttonLabel="More"`, `icon={<IconMore />}`, `label={`More actions, ${case} ${language}`}`.
- **Row height:** CSS target 40 px (`--row-height` stays the token; the documents table uses `height: 40px` rows with `padding-block: var(--space-1)`); test in T2 measures ≥ 15 rows visible at 1280×900.
- **Filter:** facet group `proposals` legend `Tool proposals`, options `With tool proposals` / `Without` (`filterModel.ts FACET_GROUPS`, chip prefix `Tool proposals`), query param `proposals`.
- **V7:** `.documents-filter-groups` single column below 900 px, the popover body `max-height: min(70vh, 32rem); overflow-y: auto` so every option is reachable; at 768 px the table fits without horizontal scroll: `Last activity` and `Waiting on` hide below 900 px (their content is in the card), status cells ellipsize.
- **Overflow:** `.shell-main { position: relative; }` (contains the absolutely positioned visually hidden spans); verify in T2 that `document.documentElement.scrollHeight <= window.innerHeight + 1` on Documents.
- **V4 (table part):** `ui/spaceActivates.ts` exports `onSpaceActivate(event: KeyboardEvent<HTMLAnchorElement>)` (Space → `preventDefault()` + `event.currentTarget.click()`); `RouteLink` uses it when its class contains `btn`. U8 applies it to the remaining link-styled buttons.

Row click (replaces `openAndSelect`):

```ts
/** Spec §2: unselected row → select and open the card; selected row → deselect, no card;
 *  the text name → open the card, selection unchanged. Checkbox, Shift and Ctrl keep their behaviour. */
export function rowClick(
  row: DocumentRowView,
  target: "row" | "name",
  selection: TableSelection | undefined,
  order: readonly string[],
  open: (row: DocumentRowView) => void,
): void {
  const key = rowKeyOf(row);
  if (target === "name" || !selection) { open(row); return; }
  if (selection.keys.has(key)) { selection.select(key, "toggle", order); return; }
  selection.select(key, "select", order);
  open(row);
}
```

Shift-click and Ctrl-click on the row area keep calling `select(key, "range" | "toggle-keep-anchor", order)` without opening the card (as today via `rowSelection.onSelect`).

Selection bar: shown when `selection.keys.size >= 2 || undoState`; labels reviewed: `Assign…`, `Translation review and annotation` / `Annotation only, no translation review` (U1 names), `Plan…`, `Clear selection`; the floating position (`useFloatingBar`) unchanged.

- [ ] **Step 1: Failing tests.**
  - `rowClick.test.tsx`: `a click on an unselected row selects it and opens the card`, `a click on a selected row deselects it and opens nothing`, `a click on the text name opens the card and keeps the selection`, `shift-click selects a range without opening`, `ctrl-click toggles without opening`, `closing the card keeps the selection` (page-level, in `documentsPage.test.tsx`).
  - `documentsTable.test.tsx`: `has the columns Text, Translation, Annotation, Finalization, Waiting on, Next step, Last activity`, `status cells are one line with the full text as title`, `a not-planned source is folded into the case line`, `a planned native text stays a row`, `at most one button per row and no +n`, `the robot icon shows while nobody is assigned and names the proposals`, `the robot icon is gone once someone is assigned`, `the language is plain text with a flag` (no `a`/`link` role; button style class without underline).
  - `selectionBar.test.tsx`: `hidden with one selected text`, `shown with two`, `labels name the task and its context`.
  - `filterModel.test.ts` / `filterPopover.test.tsx`: `proposals facet round-trips through the route`, `shows With tool proposals and Without with counts`.
  - `rowActions.test.tsx`: rewrite to `one next-step button` and `More menu when several actions remain` (label `More actions, case-109 de`, text `More`).
  - `a11y.test.tsx`: axe clean for the new table markup.
- [ ] **Step 2:** implement; `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/documents tests/documentsPage.test.tsx` → PASS; typecheck.
- **Done:** `grep -rn "buttonLabel={\`+" frontend/src` → empty; `openAndSelect` removed.
- **Commit:** `feat(documents): one-line rows, toggling row click, bar for two or more texts`

### U5: "Change plan…" and "Plan…" rework (F5)

- **Goal:** the plan dialogs list the text's steps in words with an explanation each, including the annotation mode.
- **Spec:** §2 footer "Change plan…" (and bulk "Plan…") reworked (F5); §1 Q3 (override per text, mixing modes not offered, lock reason).
- **Owns:** `frontend/src/documents/PlanSteps.tsx` (create), `frontend/src/documents/PlanDialog.tsx`, `frontend/src/documents/PlanChips.tsx`, `frontend/src/documents/RowActions.tsx` (`PlanPopover` → opens the dialog), `frontend/src/documents/planSummary.ts`, `frontend/src/styles/screens/work-plan.css`, `frontend/src/admin/DocumentsPage.tsx` + `frontend/tests/documentsPage.test.tsx` (**DocumentsPage token 3**), tests `frontend/tests/documents/planSteps.test.tsx` (create), `planDialog.test.tsx`, `planChips.test.tsx`, `planSummary.test.ts`.
- **Size / lane / review:** M / L+ / –.
- **Code to read:** `PlanDialog.tsx`, `PlanChips.tsx` (`usePlanSaves`, `PlanSaves`), `planSummary.ts`, `api/client.ts` (`patchWorkPlan`, `bulkPlan…`, `setAnnotationMode`, `setAnnotationModes`).

`PlanSteps.tsx` (one text):

```ts
export interface PlanStepsProps {
  row: DocumentRowView;                 // plan_row, annotation_mode, is_source
  value: { review: boolean; annotate: boolean; mode: "check" | "blind" | "project" };
  onChange: (next: PlanStepsProps["value"]) => void;
}
```

Renders two `<fieldset>`s:
1. `Translation review` (only for translations): radios `On` / `Off`; help `On: a person reviews the machine translation before annotation.` / `Off: the translation is annotated as it is.`
2. `Annotation`: radios `Off (not annotated)`, `Check tool proposals`, `Blind`; help `Check tool proposals: each annotator confirms, rejects or corrects the {n} tool proposals and adds what the tool missed.` / `Blind: annotators do not see the proposals.`; `Check tool proposals` is unavailable (`aria-disabled` + reason) when `proposal_count === 0` (reason `This text has no tool proposals, so it is annotated blind.`); both mode radios are unavailable while `annotation_mode.locked` (reason = lock reason), except the current mode; when the text follows the project setting, the matching option shows `(project setting)`.

Single text ("Change plan…" from the card): `Dialog` size `md`, title `Plan for {case} {language}`, `PlanSteps`, footer `Cancel` / `Save`; Save sends the flags through the existing row PATCH and, when the mode changed, `api.setAnnotationMode(key, case, language, mode === "project" ? null : mode)`; errors show inline (`ANNOTATION_MODE_LOCKED`, `NO_TOOL_PROPOSALS` messages from `errors.ts`). The large frame with lone pills is gone (`PlanPopover` in the row is removed; plan changes happen in the card or the bulk dialog).

Bulk "Plan…" (`PlanDialog.tsx`): per language a block with the same two fieldsets in tri-state form (`Keep`, then the options), plus a summary line from `planSummary.ts` (`Will change: {n} texts`); after `setAnnotationModes` the toast reports `{changed} texts changed; {locked} kept their mode because the annotation has started; {no_proposals} have no tool proposals.` (parts with 0 omitted).

- [ ] **Step 1: Failing tests** (`planSteps.test.tsx`): `lists translation review and annotation in words with an explanation`, `check is unavailable without proposals with the reason`, `mode is unavailable while locked with the reason`, `the project setting is marked`, `the source text has no translation review step`; `planDialog.test.tsx`: `bulk sets the annotation mode and reports locked texts`, `no lone pills` (no element with class `plan-chip` in the dialog); `documentsPage.test.tsx`: `Change plan… from the card saves flags and mode`.
- [ ] **Step 2:** implement; `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/documents/planSteps.test.tsx tests/documents/planDialog.test.tsx tests/documents/planChips.test.tsx tests/documents/planSummary.test.ts tests/documentsPage.test.tsx` → PASS; typecheck.
- **Commit:** `feat(documents): plan dialogs list the steps in words, with the annotation mode`

### U8: Small fixes F13, F18, V3, V4, V5, V6

- **Goal:** the remaining small fixes of the spec list.
- **Spec:** Small fixes F13, F18, V3, V4 (remaining links), V5, V6.
- **Owns:** `frontend/src/ui/Toast.tsx`, `frontend/src/styles/components.css` (toast `:811-842, 865`, `.shell-page` `:631`), `src/ontocurator/api/auth_routes.py` (`demo_logins`), `tests/test_demo_logins.py`, `frontend/src/app/LoginScreen.tsx`, `frontend/tests/loginDemoAccounts.test.tsx`, `frontend/src/translation/TranslationReviewScreen.tsx` (`:552-580` labels), `frontend/src/documents/FinalPanel.tsx` (`:311`, `:427` buttons), `frontend/src/tasks/MyTasks.tsx`, `frontend/src/documents/DocumentsTabs.tsx`, `frontend/src/variants/ConsolidationLauncher.tsx`, `frontend/src/variants/TranslationCorrectionAction.tsx`, `frontend/src/admin/DocumentsPage.tsx` (`:123-124` links only; **DocumentsPage token 4**), tests `frontend/tests/toast.test.tsx`, `frontend/tests/translationReviewLabels.test.tsx` (create), `frontend/tests/linkButtons.test.tsx` (create), `frontend/tests/documents/finalPanel.test.tsx` (V5 only).
- **Size / lane / review:** S / light / –.

Items:
- **F13:** `.ui-toast { flex-wrap: nowrap; max-width: min(50vw, 40rem); }` with the message `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` and the full text in `title`; below 700 px (`:865`) it may wrap. Test: `the undo toast stays on one line` (class/style assertions: computed `flex-wrap: nowrap`, message has `title`).
- **F18:** backend `demo_logins` adds `"display_name"` (`app.state.accounts.get_by_username(username).display_name`, `None` when the user does not exist yet); `LoginScreen.tsx:224` button text `{display_name ?? username} ({username}), {label}` → `Tom Reis (demo-annotator), Annotator`. Tests: `tests/test_demo_logins.py::test_demo_logins_carry_display_names`; `loginDemoAccounts.test.tsx` `shows the display name, the username and the role`.
- **V3:** translation review column labels with flags: `Source` + `<LanguageTag language={sourceLanguage} />`, `Translation` + `<LanguageTag language={targetLanguage} />` (the parenthesised codes go). Test `translationReviewLabels.test.tsx`.
- **V4:** every link styled as a button reacts to Space via `onSpaceActivate` (U4): `MyTasks.tsx:145, 153`, `DocumentsTabs.tsx:40`, `DocumentsPage.tsx:123-124`, `ConsolidationLauncher.tsx:151`, `TranslationCorrectionAction.tsx:67`, viewer links (already in U7's toolbar? check `grep -rn 'className="btn' frontend/src --include=*.tsx | grep "<a "` and cover all). Test `linkButtons.test.tsx`: `Space activates a link-styled Open button` for MyTasks and the Documents tab link.
- **V5:** `How is this counted?` and `Show submissions` use the link style (`Button variant="link"` or class `btn-link`: underline, accent colour) while staying buttons with `aria-expanded`. Test in `finalPanel.test.tsx`.
- **V6:** all page titles start at the standard left padding: check Documents, My tasks, Settings, Export, Text view, Consolidation at 1280 px in the dev server (`npm --prefix frontend run dev` is not needed: use the Playwright run of T2 for measurement); fix offenders by removing local negative margins or extra wrappers so `h1` sits inside `.shell-page` padding (`var(--space-6)`). Unit test: none (layout); T2 asserts `h1` left offsets equal on three pages.
- [ ] Steps: tests first (red), implement, `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 <the six test files>`, `uv run pytest tests/test_demo_logins.py -q`, typecheck.
- **Commit:** `fix(ui): toast on one line, demo login names, language flags, link buttons`

### U9: Separator sweep (F11)

- **Goal:** no `·` anywhere in the UI.
- **Spec:** Small fixes F11.
- **Facts verified:** 390 occurrences in 86 files under `frontend/src` (`grep -rc "·" --include=*.ts --include=*.tsx --include=*.css frontend/src`), top: `finalPanelText.ts` 22, `RowCells.tsx` 13, `nextStepLabels.ts` 10, `GroupCard.tsx`/`groupModel.ts`/`consolidationText.ts` (should be 0 after U6), `CaseScreen.tsx` 9, `editor/rounds/roundLabels.ts` 8, `admin/UploadPreview.tsx` 8, `problems/labels.ts` 7; CSS `content: "·"` in 6 stylesheets.
- **Owns:** every frontend file with a `·` (the grep list), their unit tests; **no other WP runs at the same time on frontend files** (wave 12 has only T1 beside it, backend).
- **Size / lane / review:** S (mechanical, many files) / light / –.

Replacement rules (apply by meaning, not blindly):
1. Name and language (`case-109 · de`, `rowName`) → `case-109 de`.
2. A list of facts (`v2 · corrected · accepted`, `Round 1 · Ana Weber`) → comma list: `v2, corrected, accepted`; `Round 1, Ana Weber`.
3. Label then value (`Consolidate case-0107 · en v1`) → `Consolidate case-0107 en v1`; `Tasks · Translation review (de)` → `Tasks: Translation review (de)`.
4. Breadcrumbs (`taskCrumbLabel`) → `failed-translation, Translation review (de)`.
5. CSS `content: "·"` separators → `content: ", "` when the items are inline text, or remove the pseudo-element and use `gap` when they are flex items.
6. Code comments may keep `·` only if they are not UI copy; prefer removing them too.

- [ ] **Step 1:** update the unit tests' expected strings first (`grep -rln "·" frontend/tests`), run them red.
- [ ] **Step 2:** apply the rules; `grep -rn "·" frontend/src --include=*.ts --include=*.tsx --include=*.css` → empty (or comments only, listed in the hand-back).
- [ ] **Step 3:** this WP may run the full Vitest suite once (heavy slot): `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1` → PASS; typecheck.
- **Done:** grep empty; browser spec strings with `·` listed for T3.
- **Commit:** `fix(ui): no middle-dot separators`

### T1: Browser scenarios

- **Goal:** isolated, fresh projects for the new browser specs.
- **Owns:** `tests/browser_proposal_check_scenarios.py` (create), `tests/browser_consolidation_scenarios.py` (three-person variant), `tests/browser_server.py` (register the new route only), `tests/test_browser_proposal_check_fixture.py` (create), `tests/test_browser_consolidation_fixture.py` (three-person test), `frontend/browser/proposalCheckHelpers.ts` (create).
- **Size / lane / review:** M / heavy / –.
- **Code to read:** `tests/browser_lead_workflow_scenarios.py:40-260` (`lead_project`, `person`, `import_units`, `batch_assign`), `tests/browser_consolidation_scenarios.py` (whole, `FINDINGS`, `build`, route registration), `tests/browser_review_flow_scenarios.py` (submitting through real services), `tests/browser_server.py:1330-1380` (registration order), `tests/t1_fixtures.py:128-200` (`annotation`, `unit`).

`POST /__test_proposal_check__?scenario=NAME` builds `lead-proposal-check-{uuid8}` through the real services (`lead_project(app, "proposal-check", import_plan="review_and_annotate_translations", rule_on=False)`, `person` for `tom` "Tom Reis", `mia` "Mia Berg", `ali` "Ali Kaya" as annotators — extend `PEOPLE` locally, do not edit the lead workflow module), sets `annotations_per_text=2`, `tool_proposal_mode="check"`, imports native `en` texts with tool proposals (`native_unit(case, "en", TEXT, case_id=case, annotations=[annotation(...) ×3])`, text and spans like `tests/proposal_check_support.py`) and returns `{project, users: {lead, tom, mia, ali}, display_names, cases: {name: document_id}, assignments: {name: id}, submissions: {name: id}}`:

| Scenario | State |
|---|---|
| `FRESH` | `EN100024` (3 proposals, nobody assigned), `EN100017` (no proposals), `EN100031` (3 proposals, plan override blind) |
| `ONE_ASSIGNED` | `FRESH` + Tom assigned to `EN100024` (check mode, not started) |
| `CHECKED` | `EN100024` checked and submitted by Tom (confirm p1, reject p2, correct p3 to another term present in the browser ontology fixture, e.g. `HP:0002069` if `grep -c HP:0002069 tests/fixtures/*.json` finds it) and Mia (confirm p1, p2, p3) through `WorkspaceService`/`ReviewService`/`SubmissionService` as the review-flow scenarios submit; finalization `ready to compare` |
| `CONSOLIDATING` | `CHECKED` + a consolidation round started by the lead (`ConsolidationStartService.start`), nothing resolved |

`POST /__test_consolidation__?started=true&people=3`: a third annotator `ann-0003` with findings that make the Hypotonia group a three-way term + assertion conflict (Tom Hypotonia present, Mia Hypotonia absent, Ali Axial hypotonia present, all patient/current, overlapping spans), as in `consolidation-group.html`; the default (`people` absent) stays byte-identical to today.

- [ ] **Step 1:** fixture tests first (`tests/test_browser_proposal_check_fixture.py`): `test_fresh_has_proposals_and_modes` (row EN100024 `proposal_count == 3`, mode check; EN100017 no proposals; EN100031 override blind), `test_checked_has_two_proposal_check_submissions` (`submission_kind` proposal_check ×2; final cell `choose`), `test_consolidating_has_an_open_round`; `tests/test_browser_consolidation_fixture.py::test_three_people_hypotonia_group` (kinds include `term_differs`, `assertion` in `differing_axes`, three members). Run → FAIL; implement → PASS: `uv run pytest -n 4 tests/test_browser_proposal_check_fixture.py tests/test_browser_consolidation_fixture.py -q`.
- [ ] **Step 2:** `frontend/browser/proposalCheckHelpers.ts`: `proposalCheckScenario(page, name)` (POST with `timeout: 120_000`), `loginScenarioUser(page, scenario, name)` (login form as `overviewHelpers.loginOverviewUser`), `textCard(page, caseId, language)` → `page.getByRole("dialog", { name: `${caseId} ${language}` })`, `cardPath(card)` → `card.getByRole("navigation", { name: "Text path" })`.
- **Commit:** `test(browser): proposal check and three-person consolidation scenarios`

### T2: New browser specs

- **Goal:** the spec's "Testing › Browser specs" list, end to end in a real browser.
- **Owns:** `frontend/browser/proposal-check.spec.ts`, `text-card.spec.ts`, `consolidation-three.spec.ts`, `text-view.spec.ts`, `documents-rows.spec.ts` (all create), `frontend/browser/documentsHelpers.ts` (add `textCard` helpers next to the panel helpers; the old ones are removed in T3).
- **Size / lane / review:** L / Playwright (alone) / yes.
- **Prerequisites:** T1, U9 committed. Port: Global rule 7.

Specs (each test builds its own scenario; `test.use({ viewport: { width: 1280, height: 900 } })`):
- `proposal-check.spec.ts` — `the lead assigns two checks, both check with J/K and 1–4, compare, consolidate and accept`: FRESH; lead opens Documents, the EN100024 row shows the robot icon with `3 tool proposals available; annotation will check them`; row click opens the card (Annotation segment current, `Annotation: check tool proposals`, `3 proposals`); `+ Person` → assign Tom; the robot icon is gone; Tom logs in, My tasks shows `Annotation: check tool proposals` and `assigned today`; opens the task: badge `Check tool proposals`, J/K walk the three proposals, `1` confirms, `2` rejects, correcting one via the editor's change flow (as `review-flow.spec.ts` does), Submit; the lead assigns Mia the same way and she checks too; lead: Finalization `ready to compare`, `Compare results…`, `Consolidate…` (lead self-consolidation), choose in the table, Submit, `Accept result…`; Finalization reads `accepted {date}`. Second test `a blind annotator never sees proposals`: EN100031 (override blind) assigned to Ali; Ali's editor shows `Independent annotation` and no proposals; the text view's Show list has `Tool proposals (3)` greyed with `Hidden while you annotate blind`.
- `text-card.spec.ts` — `path segments, details and actions` (ONE_ASSIGNED: the card opens on Annotation; Translation reads `source text`; switching segments; History and Text details open inside the card and Back returns), `remove an assignment after confirming` (✕ on Tom's chip, dialog text exact, Cancel keeps, Remove removes, the robot icon returns in the row), `check proposals myself` (FRESH, the lead clicks it and lands in the proposal check task; the lead's chip appears in the card), `row click toggles the selection and the bar needs two texts` (click selects + opens; Esc; click again deselects without opening; name click opens without selecting; one selected → no bar; two → bar), `‹ › step through the table order`, `390 px: the card is a full-width sheet without letter-by-letter wrapping` (each word's bounding box width ≥ one character: assert the case id element's height ≤ 2 lines), axe clean with the card open at 1280 and 390 px.
- `consolidation-three.spec.ts` — three-person scenario: the Hypotonia group shows `!`, `2 fields to decide`, three columns; agreed rows `Patient (all agree)`, `Current (all agree)`; `✓` on Mia's `Absent` → result line says `Absent`; `Take Ali's finding` → result `Axial hypotonia (HP:0008936)` and `Not taken: Hypotonia (Tom Reis, Mia Berg)`; no `Keep both`, no `differs`, no `·` in the page text; the path shows `Finalization` current; `agreed` groups in the same list; submit; axe clean.
- `text-view.spec.ts` — CHECKED, lead: from the card `View proposals` opens the text view with `Show: Tool proposals (3)`, findings listed with axis colours (the `Present` chip has the present token colour, compare computed `color` with the CSS variable value); Show lists Tom and Mia (`submitted {date}`) and `Final result (not yet accepted)` greyed; choosing Tom draws his marks; `Compare` opens a second column with its own selects; the version dropdown reads `en, version 1 (source text)` (adapt to the origin words of the native text); nothing editable.
- `documents-rows.spec.ts` — `one line per text, about 16 rows at 1280×900` (a scenario with ≥ 16 texts: reuse an overview scenario with many cases, e.g. `/__test_lead_workflow__?scenario=D15`; count rows whose bounding box is fully in the viewport ≥ 15; each row height ≤ 44 px), `the page itself does not scroll` (`document.documentElement.scrollHeight <= innerHeight + 1`), `768 px without horizontal scroll` (`scrollWidth <= clientWidth` of the table wrapper), `filter With tool proposals`, `page titles share the left padding` (V6: `h1` x offset equal on Documents, My tasks, Settings).

- [ ] Run each spec alone: `HPO_E2E_PORT=18771 PLAYWRIGHT_WORKERS=1 npm --prefix frontend run test:e2e -- browser/proposal-check.spec.ts` (then the others, one per command). Fix product bugs found here in the owning WP's files only with the orchestrator's go (one fix agent).
- **Commit:** `test(browser): proposal check, text card, consolidation table, text view, rows`

### T3: Existing browser specs on the new UI, spans-resize flake

- **Goal:** the existing suite passes on the new UI; the two flaky drag tests are stable.
- **Owns:** every file under `frontend/browser/` that fails or references removed UI (expected: `documentsHelpers.ts`, `documentsOverviewHelpers.ts`, `documents-table.spec.ts`, `documents-decisions.spec.ts`, `documents-a11y.spec.ts`, `documents-overview.spec.ts`, `documents-overview-a11y.spec.ts`, `documents-walkthrough.spec.ts`, `admin.spec.ts`, `lead-workflow.spec.ts`, `lead-workflow-a11y.spec.ts`, `consolidation.spec.ts`, `consolidation-a11y.spec.ts`, `final-workflow.spec.ts`, `problem-reports-lead.spec.ts`, `translation-review.spec.ts`, `variant-admin.spec.ts`, `guidelines.spec.ts`, `editor-layout.spec.ts`, `review-flow.spec.ts`, `spans-resize.spec.ts`, `variants.spec.ts`, `compare.spec.ts`).
- **Size / lane / review:** L / Playwright (alone) / –.

Mapping (old → new):

| Old | New |
|---|---|
| `rowPanel(page, case, lang)` (complementary "Details, …") | `textCard(page, case, lang)` (dialog `{case} {lang}`) |
| `openRowPanel` (+ Activity tab) | row click, then footer `History (n)` |
| `detailsButton` | the text name button `Open text card, {case} {lang}` |
| `moreActions` / `+1 more action` | the action is in the card (segment part) or the `More` menu |
| tab `Versions (n)` | Translation segment version list |
| stage columns `review/annotation/final/waiting/action/activity` | `translation/annotation/finalization/waiting/next/activity` (`STAGE_COLUMNS` updated) |
| `Accept as final` | `Accept result…` |
| `Annotation review`, `Review` (translation) | U1 names |
| `·` in expected strings | U9 rules |
| bar after one selection | bar only after two |
| `Keep both` (consolidation keyboard test) | removed; the keyboard test chooses with ✓ buttons and Enter |
| viewer `Versions` fold-out, three selectors | text view toolbar `Language and version`, `Show` |

**spans-resize flake** (`spans-resize.spec.ts:61` "pending mark: drag the end handle, choose a term, saved segments equal the adjusted span" and `:84` "the end handle drags onto the next line under the mark bar"): root cause is the target point computed before the press (`pointAtOffset` `:8-24`) while the press re-renders the pending mark (layout shift), and the handle's empty inline box. Fix: in `dragHandle` (`:26-33`) press, then `await page.waitForFunction(() => document.querySelector(".pending-mark")?.getAttribute("data-dragging") === "true")` (or the existing dragging class — check the component), **recompute** the target with `pointAtOffset` after the press, move with `{ steps: 12 }`, and assert the live highlight reached the target before `mouse.up`; use `locator.evaluate(el => el.getBoundingClientRect())` instead of `boundingBox()` for the empty inline handle. Run each test 20 times: `HPO_E2E_PORT=18771 PLAYWRIGHT_WORKERS=1 npm --prefix frontend run test:e2e -- browser/spans-resize.spec.ts --repeat-each=20 -g "pending mark"` → 0 failures.

- [ ] Run the specs in batches of at most four files per command (one Playwright run at a time), fix, rerun the batch: `HPO_E2E_PORT=18771 PLAYWRIGHT_WORKERS=1 npm --prefix frontend run test:e2e -- browser/documents-table.spec.ts browser/documents-decisions.spec.ts browser/documents-a11y.spec.ts browser/documents-overview.spec.ts`, then the next four, until every listed file passed once.
- **Commit:** `test(browser): existing specs on the text card and one-line rows; stable resize drags`

### G1: Final gate (alone on the machine)

Run in batches so a failure is cheap to repeat:

```bash
cd /c/Users/jan-p/Development/ontocurator/.worktrees/proposal-check
bash scripts/check.sh --only static
CHECK_VITEST_WORKERS=4 bash scripts/check.sh --only frontend
CHECK_PYTEST_WORKERS=4 bash scripts/check.sh --only backend
HPO_E2E_PORT=18771 CHECK_PLAYWRIGHT_WORKERS=2 bash scripts/check.sh --only browser
```

Each must end with its phase's success line. On a failure: one fix agent (effort medium), rerun only that phase; finally `HPO_E2E_PORT=18771 bash scripts/check.sh` once (expected last line `All local checks passed.`). If the browser phase is too heavy at two workers, run `PLAYWRIGHT_WORKERS=1` with the spec list in four batches (`ls frontend/browser/*.spec.ts`, split alphabetically).

- [ ] `git status --short` shows only committed WP files.
- [ ] Migration number still free on `main` (`git fetch && git ls-tree --name-only origin/main src/ontocurator/storage/migrations/versions/ | tail -2`); renumber per Global rule 12 if needed.
- [ ] Plan review: one `superpowers:code-reviewer` over `git diff main...feat/proposal-check-text-card` with this checklist: blind annotators and non-leads never see proposals or other people's work (workspace, text view, layers); the mode is fixed once and a check never mixes with blind work on one text; every assign path enforces annotations per text, reassign does not double count; a proposal check counts as one annotation and is consolidated unchanged; `keep_both`/`term_choices`/`term_parts` gone from requests; stored keep-both marks still read; exports of projects without proposal checks unchanged; copy verbatim; no `·`; `aria-disabled` instead of `disabled`; colours only via tokens.

### R1: Embedded bundle rebuild (separate commit)

Facts: commits `5478ddd` and `d39273f` only replace `src/ontocurator/web/assets/*` and `src/ontocurator/web/index.html`; there is no sync script (deleted in `8638e08`); the Dockerfile does `rm -rf src/ontocurator/web` + copy of `frontend/dist`; `check_wheel.py` requires `licenses/*.txt` from `frontend/public/licenses`.

```bash
cd /c/Users/jan-p/Development/ontocurator/.worktrees/proposal-check
npm --prefix frontend run build
rm -rf src/ontocurator/web && cp -r frontend/dist src/ontocurator/web
git status --short src/ontocurator/web
uv run python scripts/check_wheel.py
git add -A src/ontocurator/web
git commit -m "build: update embedded frontend bundle"
```

(`git add -A` is allowed here for this one directory only.) Expected: only `src/ontocurator/web/**` changed; `check_wheel.py` passes.

### M1: Manual acceptance on the native test server

Outside the repository: `C:/Users/jan-p/Development/ontocurator-local/config.ps1` (not in git). Before the run:
- [ ] `config.ps1` `Start-App`: readiness deadline `(Get-Date).AddMinutes(5)` (`:96`) → `AddMinutes(12)` and the message at `:105` → `"App not ready after 12 minutes; see logs\app-$Port.err.log"` (first start migrates and warms ontologies). Show the diff to the user; it is their local tool.
- [ ] Install the branch build into the native server as the previous acceptance runs did (`docs/operations/t5-interim-acceptance.md`; the earlier session notes in `.worktrees/manual-20261021/build/t5-acceptance/`), start it, wait for `App ready.`.
- [ ] Project **e3c-proposals**: Settings → Workflow → `Texts with tool proposals` = `Check tool proposals` (existing projects were migrated to `Annotate blind`). Save.
- [ ] Note: the earlier seed of **cons-three** (third annotation above the limit 2) is now refused if reseeded; existing data stays.

Protocol (record findings as `FINDINGS-<date>.md` in the acceptance build folder; evidence screenshots there, not in the repo):
1. Documents (lead, `demo-lead`): one-line rows, robot icon on texts with proposals, filter `With tool proposals`, page does not scroll beyond the table, 768 px window.
2. Row click: card opens on the right segment; second click deselects; name click; bar only with two texts; ‹ ›; Esc; narrow window sheet.
3. Card: Translation (version, origin, automatic check, reviewer chips with dates, Compare with source, versions), Annotation (mode, proposals, View proposals, + Person, ✕ remove with the exact dialog, Check proposals myself), Finalization (waiting / ready to compare / consolidating n of m / ready to accept / accepted date).
4. Change plan… on one text (annotation mode, lock reason after assigning) and bulk Plan… (locked texts reported).
5. Proposal check as `demo-annotator` (`Tom Reis (demo-annotator), Annotator` on the login screen): J/K, 1–4/0, correct a span and a term, add a missed finding, submit; second check as `demo-annotator2`.
6. Compare, consolidate (comparison table, ✓, Take …'s finding, result line, Not taken), Accept result….
7. Text view: Show list (greyed entries with reasons), Compare column, final result layer.
8. Final export: `receipt.json` `proposal_checks` and `index.csv` `submission_kind = proposal_check`.
9. Small fixes: no `·`, toast one line, "Connection lost. Try again." (stop the server briefly), link buttons with Space, page title padding, language flags in editor header and translation review columns.

---

## Spec ambiguities resolved by this plan (open to veto; WP to change in brackets)

1. **Existing projects keep blind annotation.** The setting defaults to `check` for new projects; migration 0020 backfills existing projects with `blind` so nothing changes under running work; e3c-proposals is switched by hand in M1. [P1, M1]
2. **Mode lock = stored per assignment.** The mode is written on each annotate assignment at creation; the text is locked while any non-revoked annotate assignment exists on any version of the text; removing all of them (nothing submitted) unlocks it. Changing the project setting is never refused; it simply does not affect locked texts. [P1, P3, P4]
3. **Proposal check is its own workspace mode on the annotate task** (`proposal_check`, annotator role), not the review task (adjudicator role), so it counts as an annotation and is consolidated without changing the comparison rules. [P2, P3]
4. **"Uncertain" stays a fourth decision.** The review screen offers it (key 4); the export records it as `uncertain` beside `confirmed`, `rejected`, `corrected`. [P6]
5. **"Check proposals myself"** implies the language confirmation for the lead's own check, counts towards the limit, is refused on blind texts (`PROPOSAL_CHECK_NOT_APPLICABLE`); with "adjudicator is not annotator" on, the lead's later self-consolidation is refused by the existing rule and message. [P3, U3]
6. **No carrying of a proposal check to a new text version** (text change, carry-forward, handover stay `independent`-only; the existing refusal applies). [P2]
7. **Text view and blinding:** non-leads never get entries for other people's work, not even greyed (blinding wins); greyed entries with reasons are shown for layers the viewer knows exist (tool proposals during a blind annotation; people and the final result for the lead). [P8, U7]
8. **Remove (✕)** is offered on Annotation-part chips as the spec says; the endpoint refuses submitted work for any task; "Their draft is discarded" means the assignment is revoked and the draft is no longer reachable (kept in the database for audit). [P3, U3]
9. **Optional translation review** gets a fourth path tone `optional` (grey, like later) and is never the segment opened by default. [U0, U3]
10. **Consolidation order:** groups by text position with agreed groups in the same list (earlier: agreed first in their own section); J/K still walk the open ones. [U6]
11. **Plan dialog** offers `Off (not annotated)` beside `Check tool proposals` / `Blind`, because the Annotate flag still exists. [U5]
12. **Bulk mode change** skips locked and proposal-free texts and reports them instead of failing the whole selection. [P4, U5]
13. **Assignment dates** in the assign dialog come from the row's work items (`assigned_at`, `assigned_by`); no new endpoint. [P5, U2]
14. **Consolidation progress** ("2 of 3 groups open") is computed for shown rows only. [P5]
15. **Robot icon** = mockup variant C (Lucide `bot`, scaled to the 16 px grid); **axis colours** = aliases of existing tokens (no new colour values, so the DESIGN.md colour-approval rule is not triggered); the experiencer/temporality palettes are the plan's choice (U0 table). [U0]
16. **Annotations-per-text enforcement** lives in `AssignmentService._assign_locked` (single assign, row-list POST, distribution confirmation); reassign and consolidation start are unaffected; the test-server seed of cons-three would now be refused (test data only). [P3]
17. **A review of a submitted annotation** stays possible after a proposal check too (batch offers it once any annotate work is submitted). [none]
18. **Next step column** gets a visible header `Next step` (the old hidden "Action" header). [U4]

## Self-review against the spec

| Spec item | WP |
|---|---|
| Goal 1, §1 Q1 (check tool proposals in the review screen, J/K, 1–4/0, every proposal decided) | P2, U2, T2 |
| §1 Q2 (replaces blind annotation, counts as one annotation, 2 per text = two independent checks, Finalization unchanged, 1 = single checker) | P2 (submission = annotation layer), P3 (annotate task, limit), T2 |
| §1 Q3 project setting (default check for new projects), texts without proposals blind, per-text override in "Change plan…", one task "Annotation", mode shown in assign dialog and card, no mixing | P1, P3, P4, U2, U3, U5 |
| Mode fixed once the first annotation assignment exists, clear refusal | P1 rule, P3 storage, P4 refusal, U5 reason |
| Blinded annotator never sees proposals; checker sees only proposals | P2 (targets from proposals only), P3 (`require_workable`, `may_read_proposals`), P8, T2 |
| Rename "Annotation review" → "Review a submitted annotation"; "Translation review" everywhere (F1) | U1 |
| Export: per proposal decision with source ref, added findings; minimal additive fields; documented | P6 |
| e3c-proposals switched to "Check tool proposals" | M1 |
| §2 centered popup, Esc/✕/outside closes, ‹ ›, row click opens and selects | U3, U4 |
| Header case ID, language with flag, version only when > 1 versions as a warning | U3 |
| Path Translation → Annotation → Finalization with short states, colours, default segment | U0 (`StagePath`), U3 (`cardModel`) |
| Translation details (version/origin, automatic check, reviewer chips with dates, Assign reviewer…, Compare with source, version list, Request correction…) | U3 |
| Annotation details (mode, proposals + View proposals, chips with state and date, + Person, ✕ with confirmation, submitted not removable) | P3, P5, U3 |
| "Check proposals myself" (role granted, counts as an annotation, F24) | P3, U3, T2 |
| Finalization details (Compare results…, Consolidate…, Accept result…, Open result) | U3 (embeds DecisionBlock), U1 (wording) |
| Every assignment shown anywhere carries its date (chips, My tasks, history, assign dialog holders) | P5, U0, U2, U3 (`RowActivity` with `AssignedDate`) |
| Row actions: no "+n"; one primary action; "More" with ⋯ if any overflow | U0, U4 |
| Footer History / Text details / Change plan…; old tabs gone | U3 |
| "Change plan…" and bulk "Plan…" reworked (F5) | U5 |
| Selection bar only for 2+, floating, labels reviewed | U1, U4 |
| Row click toggles the selection; name click; checkbox/Shift/Ctrl unchanged; closing never changes the selection | U4, T2 |
| §2b columns, source folded into the case line, planned native stays, one button, one-line cells, ~40 px rows | U4, T2 |
| Robot icon (Lucide bot, house style, ISC noted), tooltip/accessible text, gone after assignment, filter With/Without | U0, P5, U4 |
| §3 path on top (F17) | U6 |
| One group = one finding; keep both / split removed (server and UI) | P7, U6 |
| Group card header (! icon, name, n fields to decide), comparison table, disagree rows with ✓, agreed one grey line, Text only on genuine conflict, notes never block, Whole finding row, result line with Not taken | U6 |
| Fixed axis colours as tokens, used in editor, consolidation, text view, compare; colour never alone | U0 (tokens, `AxisValue`), U6 (consolidation), U7 (text view, compare, editor finding list) |
| Auto-kept groups same style, marked agreed (F9); large pills removed | U6 |
| "Accept result…" everywhere (F16) | U1 |
| Server rules consistent: one term per group, choice for every disagreeing field, keep_both/term_choices removed with tests | P7 |
| §4 text view toolbar, language+version dropdown, Show dropdown with greyed entries and reason, findings with axis colours, Compare column, read only; target of the card links | P8, U7, U3 (links), T2 |
| Small fixes F2/V8 | U4 (row), U7 (viewer) |
| F7 | U4 (no per-row Open) |
| F8 | U2 |
| F11 | U9 (+ no new `·` rule for all WPs) |
| F13 | U8 |
| F14 | U0 |
| F18 | U8 |
| V1 | U3, T2 |
| V2/V3 | U2 (editor header), U8 (translation review columns) |
| V4 | U4 (`spaceActivates`, table), U8 (other links) |
| V5 | U8 |
| V6 | U8, T2 (measurement) |
| V7 | U4, T2 |
| Annotations per text enforced (cons-three) | P3 |
| Documents page overflow | U4, T2 |
| Flaky spans-resize drag tests | T3 |
| Native test server readiness wait > 5 minutes | M1 |
| Testing: backend list | P1–P8 tests |
| Testing: frontend unit (card states, removal confirmation, bar for 2+) | U3, U4 |
| Testing: browser (proposal check e2e on imported T1 bundle, text card flows, consolidation with 3 people, text view Show/Compare) | T1, T2 |
| Manual acceptance on the native server with e3c-proposals | M1 |
| Out of scope (modifiers, family member, user management) | not touched |

Gaps found and fixed during the review: (1) the fixed axis colours must appear "everywhere axis values appear (editor, consolidation, text view, compare)": U7 now also owns `editor/FindingRow.tsx` and `variants/ComparePane.tsx` with tests; the editor's radio options (`AnnotationPanel.tsx:337-350`) stay neutral (controls, not values). (2) P1 and P2 both need `assignments/service.py` and P1's check constraint affects every test that creates annotate assignments, so P2 runs after P1 (wave 2), not beside it. (3) P7 removes API fields the consolidation UI uses; P7 therefore also does the minimal frontend compile fix so the tree typechecks before U6. (4) The annotations-per-text bypass (row-list `POST /projects/{key}/assignments` without `context`) is fixed in P3 together with the mode wiring, because both edit `_assign_locked`.

Placeholder scan: no "TBD"/"TODO"/"similar to"; WP blocks that adapt to a verified-but-unread signature say which `grep` to run and keep the assertion's meaning fixed.

Type consistency: `AnnotationMode`/`TextMode`/`text_mode`/`workspace_mode` (P1) are used with the same names in P3, P4, P5; `AnnotationModeView` (P4) in P5; `consolidation_progress` (P7) in P5; `TextLayerEntry` (P8) in U7; `StagePath`/`PathSegment`/`PathTone` (U0) in U3 and U6; `assignedText`/`AssignedDate` (U0) in U2, U3; `isReviewLike` (U2) frontend, `is_review_like` (P2) backend; `rowClick` (U4); `PlanSteps` (U5).
