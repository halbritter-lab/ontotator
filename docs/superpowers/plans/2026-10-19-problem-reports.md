# Problem Reports (Reporter and Lead Flows) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan work package by work package. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement [2026-10-19-problem-reports-design.md](../specs/2026-10-19-problem-reports-design.md) including its "Resolved questions": a one-step reporter flow with honest status, restricted withdrawal ("Withdrawn"), lead reopen, a lead report page with a state panel and intent actions, and a history timeline that never reveals other people's tasks to the reporter.

**Architecture:** The backend keeps `ProblemReportService` as the only writer and gains two actions (`withdraw`, `reopen`), a recorded release per hold (migration 0015) and pure lifecycle rules in `domain/problem_reports.py`. A new read module `application/problem_report_views.py` builds one rich `ProblemReportView` per viewer (lead or reporter) with redaction applied at the source. The frontend gets pure label rules and one timeline component in `frontend/src/problems/`, a rewritten reporter dialog (`tasks/TaskProblemActions.tsx`) and a rewritten lead page (`tasks/ProblemReportDetail.tsx`) built on the Documents plan's shared primitives: `InlineConfirm` and `Button loading` (WP U1), router passthrough (WP U3), `app/submissionLabels.ts` and `app/Time.tsx` (WP D1), `round_ordinals` in `domain/submission_labels.py` (WP B5).

**Verification commands** in this plan are written for the **Bash tool (Git Bash)**: POSIX syntax, forward slashes, `VAR=value cmd` prefixes. Run them from the worktree root.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2, Alembic, PostgreSQL (pytest via testcontainers or `ONTOCURATOR_TEST_PG_URL`); React 18, TypeScript, Vitest + Testing Library, Playwright + axe-core; `openapi-typescript` for `generated.ts`.

---

## Ground rules for every implementer

- Work in `C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation`. It holds many **uncommitted** changes from other work. Never `git reset`, `git checkout -- <file>`, `git stash`, `git clean`. Edit on top of the working tree.
- **Exclusive file ownership (same rule as the Documents plan).** A WP writes only the files listed under its "Owns". A file shared with a sibling plan has exactly **one** owner WP at any moment across all four plans; the coordinator sequences owners in the order given in "Cross-plan schedule" below. Shared primitives owned by a sibling (Documents U1/U3/D1/B5, Editor F1 `Dialog`) are never modified here; a needed change is a **change request (CR)** executed by the owning WP (see "Change requests to sibling plans"). A WP that finds a prerequisite missing stops and reports; it does not re-implement it.
- **No commits, no pushes.** Each WP ends with a "Commit point" (files and message) for later; do not run it.
- **No CI / GitHub Actions.** All verification is local:
  - Backend tests need PostgreSQL: Docker running, or `ONTOCURATOR_TEST_PG_URL` set. Single files: `uv run pytest tests/<file>.py -q`.
  - Static: `uv run ruff check . && uv run ruff format --check . && uv run mypy src`.
  - Contracts: `uv run python scripts/export_openapi.py` then `npm --prefix frontend run api:generate`; drift checks `uv run python scripts/export_openapi.py --check` and `npm --prefix frontend run api:check`. No new error codes in this plan, so `scripts/export_admin_error_codes.py --check` must stay green unchanged.
  - Frontend unit (always with the worker cap on this 16 GB machine): `npm --prefix frontend test -- <path relative to frontend> --maxWorkers=4 --minWorkers=1`. Types: `npm --prefix frontend run typecheck`.
  - Browser: each worktree uses its own port: `HPO_E2E_PORT=18781 npm --prefix frontend run test:e2e -- <spec file name>`. (`test:e2e` builds, then runs Playwright with one worker against `tests/browser_server.py`.) **Playwright runs strictly one at a time** on the machine (all plans).
  - Phase gates: `bash scripts/check.sh --only static`, `--only frontend`, `--only backend`, `--only browser`.
- **At most two test-heavy agents at once** (backend pytest with PostgreSQL, full Vitest suite, Playwright). Single Vitest files count as light.
- All files and UI copy in English. Icons only from `ui/icons.tsx`; no Unicode glyph icons. Status never by colour alone (`StatusBadge` text + shape).
- UI vocabulary (spec "Shared rules"): "Open" / "Closed" / "Withdrawn" for the report; "Paused" / "Resumed" / "Restarted" for tasks; never "hold" or "resolve" in UI text (the API keeps `hold`, `resolve`).

## Spec deviations decided in this plan (read once)

1. **Migration.** The spec says "no schema migration"; the resolved questions (withdraw, reopen) and the user's request add one: migration `0015` records each hold release (`released_at`, `released_by`, `release_action`, `release_event_id`), constrains report states to `open|resolved|withdrawn`, adds read indexes, and backfills old releases with the spec's derivation rule ("first `resume`/`restart` event of this report at or after the hold's `created_at` whose `assignment_ids` include the task"; no match stays null = "no record").
2. **Withdraw** (`action: "withdraw"`): reporter only, report `open`, and every existing event of the report is a `resume` by the reporter (no lead has acted). Sets state `withdrawn`; releases only this report's active hold on the reporter's own task. Conflict reason `REPORT_LEAD_ACTED` otherwise.
3. **Reopen** (`action: "reopen"`): lead only, report `resolved` or `withdrawn`; sets `open`, clears `resolution`; changes no hold. Conflict reason `REPORT_OPEN` on an open report.
4. Conflicts use the existing code `WORKFLOW_REVISION_CONFLICT` with `details.reason` in `REPORT_RESOLVED | REPORT_WITHDRAWN | REPORT_OPEN | REPORT_LEAD_ACTED` (no new error codes).
5. `submission_label` becomes `submission: {submission_id, round_ordinal, recorded_at} | null`; the client formats it. The lead page reads the row's final result from the Documents read API (`api.listDocumentRows`), not from the report view.
6. Reporter events carry `affected: []` and `own_task: bool`; events whose only effect is on other tasks (`resume`, `extend_hold` not touching the reporter's task) are omitted for the reporter.
7. Added read-only fields: `viewer_label`, `viewer_is_lead`, `withdrawable`, `state_changed_at`, `state_changed_by_label`. Added lead-only endpoint `GET /problem-reports/{report_id}/pause-candidates` for the "Pause other tasks" picker.
8. Spec line "Withdrawal does not exist" (Dialog part 2 and "Contracts preserved") is replaced by resolved question 1.
9. **Round references for restart.** Restart abandons the assignment's **current** active round (`application/work_rounds.py`: `prior_id = assignment["active_round_id"]`, new round's `predecessor_round_id = prior_id`), which can differ from the round the report was filed in (`round_ordinal`). The view therefore adds `current_round_id`/`current_round_ordinal` (the reporter's assignment's active round now; used by the restart confirmation) and, per event, `abandoned_round_id`/`abandoned_round_ordinal` (for `restart`: the `predecessor_round_id` of the new round `details.round_id`; used by the history sentence). The spec's "Round 2 abandoned … Round 3 started empty" is built from these, never from the report's own round.

## Open questions (defaults implemented; a one-line change each)

1. "No lead has acted" counts any event by another person and any non-`resume` event (a lead who is also the reporter and pauses other tasks has acted). Default as stated (`domain/problem_reports.withdrawable`).
2. A lead `resume` naming a task that this report does not pause is accepted today (bumps the task revision, releases nothing). Default: unchanged; the UI never sends it. Alternative: reject with `WORKFLOW_REVISION_CONFLICT` / `HOLD_NOT_ACTIVE`.
3. The narrow-viewport "full-height sheet" for `Dialog size="md"` (< 700 px, spec "Narrow viewports") is a Dialog layout rule. `ui/Dialog.tsx` and the `.ui-dialog*` CSS block belong to Editor WP F1, whose current text has no mobile rule. Decision: change request **CR-2** to Editor F1 (below), **accepted**: the editor plan's F1 now implements the rule (and its spec §8 notes it); this plan depends on it (WP6, WP9d) and verifies the sheet geometry at 390×844 in WP9d.
4. "Withdrawn" badge tone: `neutral` (dot). Lead page summary for a withdrawn report: "The reporter withdrew this report. Nothing is paused by it."

---

## Shared files with sibling plans

Sibling plans: **Documents** = `2026-10-19-documents-lead-table.md` (WP IDs B1–B9, U1–U3, D1, D2, D4–D8, DX, E1–E4, P1–P7, X1; there is no D3), **Editor** = `2026-10-19-editor-carried-review.md`, **Quick** = `2026-10-19-quick-fixes-and-export.md`.

| File | Owner(s), in order | What this plan assumes / does |
|---|---|---|
| `src/ontocurator/storage/repository.py` (`workflow_causes_in`, `TASK_PAUSED_WITHOUT_REPORT`, `report_id` on causes) | Documents B1 | Not modified. Assumes "open" means `state == "open"`; a withdrawn report raises nothing (withdraw leaves no hold of the report active); reopen re-raises `OPEN_PROBLEM_REPORT`. |
| `storage/migrations/versions/0014_final_selection_identity.py` | Documents B2 | WP1 creates `0015_problem_report_lifecycle.py` with `down_revision = "0014"`. **WP1 starts only after B2 is done.** No other plan adds a migration; any later one is `0016+`. |
| `src/ontocurator/domain/submission_labels.py` (`round_ordinals`, re-exported by `domain/document_rows.py`) | Documents B5 | WP2 imports `round_ordinals` from `ontocurator.domain.submission_labels`; does not modify it. |
| `application/document_rows.py` (facts), `application/document_row_page.py` (row dict), `api/document_row_routes.py` (models) | Documents B6, B7, B9 | WP8 takes ownership **after B9** and adds only hook lines that call its new module `application/document_row_reports.py`. `OPEN_PROBLEM_REPORT` issue fields stay Documents'. |
| `contracts/openapi.json`, `frontend/src/api/generated.ts`, `frontend/src/api/client.ts` | **contract slot**: Documents B9 → Editor B4 → this plan WP4 → WP8 | One contract writer at a time across all plans (see "Cross-plan schedule"). WP4 adds only problem-report types and methods to `client.ts`. |
| `frontend/src/ui/Button.tsx` (`loading`), `ui/shortcuts.ts`, `ui/InlineConfirm.tsx` | Documents U1 | Consumed unchanged. The optional `conflictMessage` prop needed by WP7 is **CR-1** to U1. |
| `frontend/src/app/router.ts` (`documents_*` passthrough, `action: "resume"` on `projectProblemReport`) | Documents U3 | Consumed, not modified. |
| `frontend/src/App.tsx` | Documents U3 → D6 → E2 → E3 → this plan **WP7b** | WP7b edits only the non-lead branch of the `projectProblemReport` case. |
| `frontend/src/app/submissionLabels.ts` (`formatTime`, `fullTimestamp`, `personLabel`, `submissionLabel`), `frontend/src/app/Time.tsx` (`Time`) | Documents D1 | Consumed by `problems/labels.ts` and components (import paths `../app/submissionLabels`, `../app/Time`). Never import them via `documents/labels.ts`. |
| `frontend/src/documents/visitState.ts` (`recordDecision`) | Documents D8 | Consumed by WP7 after every successful lead action when the route carries `documents`. |
| `frontend/src/documents/ExpandedRow.tsx` ("More" section) | Documents DX (E4 may fix imports) → this plan WP8 | WP8 adds the "Problem reports (n)" item; not while E4 runs. |
| `frontend/src/tasks/ProblemReportDetail.tsx`, `frontend/tests/problemReportRoute.test.tsx` | Documents E2 → WP7 → WP7b (test only) | E2 (back link, `action=resume` preselection, `recordDecision`) lands **first**. WP7 rewrites the page and keeps all three behaviours: back link restores the full `documents_*` query (or `{case, language}` of the report), `action=resume` opens the "Release pause" confirm with the paused task preselected, nothing runs automatically. |
| `frontend/src/tasks/TaskProblemActions.tsx`, `frontend/tests/dialogFooters.test.tsx` (problem-report case), `frontend/browser/quick-fixes.spec.ts` (problem-report lines) | Quick WP-B / WP-H → this plan WP6 / WP9e | Quick should run WP-B before WP6 (its `TaskProblemActions` part is then superseded). If WP6 ran first, CR-3 applies (Quick skips all problem-report parts). WP6 replaces the obsolete test case; WP9e replaces the browser lines. |
| `frontend/src/ui/Dialog.tsx`, `.ui-dialog*` CSS | Editor F1 | Consumed only: `footer`, `size="md"`, `initialFocus`, `onClose`, header Close button. Full-height sheet < 700 px is **CR-2** to F1. Tests scope "Close" to the footer (`.modal-actions`) because F1 adds a header "Close". |
| `TaskEditor.tsx`, `CaseScreen.tsx`, `TranslationReviewScreen.tsx` toolbar | Editor (F0, F6, F7, F8b, F4b) | Not modified: `TaskProblemActions` keeps its props `{assignment, onSaveBeforeReport, onRefresh}`. |
| `tests/browser_server.py` | Documents P1, Editor F10, this plan WP9a (one registration line each, one at a time) | WP9a adds one import and one call for `tests/browser_problem_report_scenarios.py`. |
| `frontend/browser/final-workflow.spec.ts` | Quick WP-E (export lines) and Documents P7 → this plan WP9e | WP9e changes only the report steps (old labels "Report a problem", "Task problem reports", "Apply report action"). |

## Change requests to sibling plans

These changes are made by the owning WP in its own files, never here. Status (2026-10-19 reconciliation): CR-1 is folded into Documents U1 (Task 3.3 and the U1 block), CR-2 into Editor F1, CR-3 into Quick WP-B Step 0 and WP-H Step 0. The coordinator folds them into the owning WP (preferred; both owners run early) or runs them as a short follow-up owned by that WP's lane before the dependent WP here starts.

- **CR-1 → Documents U1 (`ui/InlineConfirm.tsx`, `tests/ui/inlineConfirm.test.tsx`).** Backward-compatible optional prop `conflictMessage?: ReactNode`; when given it replaces the fixed sentence "The final result or its warnings changed since you opened this. Nothing was saved. Review the current state." (the "Changed by … at …" suffix stays). Test:

  ```tsx
  it("conflict_message_can_be_replaced_by_the_caller", () => {
    render(<InlineConfirm title="Close report" message="m" confirmLabel="Close report" onConfirm={vi.fn()} onCancel={vi.fn()}
      conflictMessage="This report changed since you opened it. Nothing was saved." outcome={{ kind: "conflict", onReview: vi.fn() }} />);
    expect(screen.getByText("This report changed since you opened it. Nothing was saved.")).toBeTruthy();
    expect(screen.queryByText(/The final result or its warnings changed/)).toBeNull();
  });
  ```
  Check before WP7: `grep -n "conflictMessage" frontend/src/ui/InlineConfirm.tsx`.
- **CR-2 → Editor F1 (`.ui-dialog*` block in `styles/components.css`, plus a style assertion in F1's tests).** Spec "Narrow viewports": below 700 px a `size="md"` dialog is a full-height sheet with `space-4` margins and the footer fixed:

  ```css
  @media (max-width: 699px) {
    .ui-dialog--md { width: calc(100vw - 2 * var(--space-4)); max-width: none; height: calc(100dvh - 2 * var(--space-4)); max-height: none; }
  }
  ```
  (F1's flex column with `.ui-dialog-body { flex: 1 1 auto; overflow: auto }` keeps the footer fixed.) Check before WP6 and WP9d: `grep -n -A2 "max-width: 699px" frontend/src/styles/components.css | grep "ui-dialog--md"`.
- **CR-3 → Quick WP-B / WP-H (only if this plan's WP6 lands first).** The existing skip rule ("the file no longer contains `Reload my reports`") must also skip writing the third case of `frontend/tests/dialogFooters.test.tsx` ("puts Reload my reports then Close reports in the footer …") and the problem-report lines of `frontend/browser/quick-fixes.spec.ts` ("My problem reports", "Task problem reports", "Close reports"). Recommended instead: run Quick WP-B before WP6 and Quick WP-H before WP9e; then WP6 and WP9e own and replace those parts and no Quick change is needed.

## Cross-plan schedule (constraints the orchestration must respect)

1. **Migrations:** Documents B2 (`0014`) → this plan WP1 (`0015`, `down_revision = "0014"`). Never renumber.
2. **Contract slot** (`openapi.json`, `generated.ts`, `client.ts`): Documents B9 → Editor B4 → WP4 → WP8, strictly one at a time, and never while any plan's backend WP that changes API models is mid-edit (the export reads all routes). Each later writer re-runs both drift checks. WP4 needs B9 (`api.listDocumentRows` is used by WP7).
3. **`App.tsx`:** Documents U3 → D6 → E2 → E3 → WP7b.
4. **`ProblemReportDetail.tsx` / `problemReportRoute.test.tsx`:** Documents E2 → WP7 → WP7b.
5. **Documents row backend and `ExpandedRow.tsx`:** Documents B6/B7/B9 and DX done, E4 not running → WP8.
6. **`tests/browser_server.py`:** Documents P1, Editor F10, WP9a: one at a time (any order).
7. **`final-workflow.spec.ts`:** Quick WP-E/WP-H and Documents P7 → WP9e.
8. **`TaskProblemActions.tsx` and its Quick test/spec parts:** Quick WP-B → WP6; Quick WP-H → WP9e (or CR-3). `frontend/tests/dialogFooters.test.tsx`: Quick WP-B (creates) → Editor F1 (query scoping, if needed) → Editor F8a and WP6 one at a time (each only its own cases). `frontend/browser/quick-fixes.spec.ts`: Quick WP-H → WP9e → Editor F10.
9. **CRs:** CR-1 (Documents U1) before WP7; CR-2 (Editor F1) before WP6 and WP9d.
10. **Playwright:** one run at a time on the machine; WP9b–WP9e run serially.

---

## Work packages, dependencies and lanes

| WP | Content | Depends on (this plan) | Depends on (sibling WPs) | Load |
|---|---|---|---|---|
| WP1 | Lifecycle: migration 0015, withdraw/reopen, recorded releases, permission/state rules, hold contract tests | none | Documents B2 | heavy (pg) |
| WP2 | Read model: rich view, redaction, round references, `GET /problem-reports/{id}`, `?assignment_id=`, pause candidates, blinding contract tests | WP1 | Documents B5 (B1 for `test_final_causes.py`) | heavy (pg) |
| WP3 | `AssignmentView.active_holds` for the task owner | WP1 (fixture module) | none | heavy (pg) |
| WP4 | OpenAPI + generated types + client methods | WP2, WP3 | Documents B9; contract slot (Editor B4 not running) | light |
| WP5 | `problems/labels.ts`, `ReportTimeline`, CSS, fixtures | WP4 | Documents D1 | light |
| WP6 | Reporter toolbar entry, dialog, new report, resume, withdraw, focus refresh | WP5 | Documents U1; Editor F1 (+CR-2); Quick WP-B (or CR-3) | medium (vitest) |
| WP7 | Lead report page: state panel, intents, confirms, errors, back link | WP5 | Documents B9, U1 (+CR-1), U3, D1, D8, E2 | medium (vitest) |
| WP7b | `App.tsx` non-lead answer for the report route | WP7 | Documents E3 (`App.tsx` chain) | light |
| WP8 | Documents "Problem reports (n)": per-row list (backend + More item) | WP1, WP4 | Documents B9, DX (E4 not running); contract slot | heavy (pg) then light |
| WP9a | Browser fixture route and its pytest | WP1 | `browser_server.py` slot (Documents P1 / Editor F10 not running) | heavy (pg) |
| WP9b | Reporter browser scenarios | WP6, WP7, WP8, WP9a | — | heavy (e2e) |
| WP9c | Lead and restart browser scenarios | WP7b, WP8, WP9a | — | heavy (e2e) |
| WP9d | Keyboard, accessibility and layout browser checks | WP6, WP7b, WP9a | Editor F1 + CR-2 | heavy (e2e) |
| WP9e | Update existing browser specs | WP6, WP7b | Documents P7; Quick WP-E, WP-H | heavy (e2e) |
| WP10 | Removal of `ReportHistory.tsx`, full gates | all | — | heavy |

```
WP1 ──┬── WP2 ──┐
      ├── WP3 ──┴── WP4 ── WP5 ──┬── WP6 ──────────────┐
      │                          └── WP7 ── WP7b ───────┼── WP9b, WP9c, WP9d, WP9e (serial) ── WP10
      │                 WP1+WP4 ── WP8 ─────────────────┤
      └── WP9a ─────────────────────────────────────────┘
```

Parallel (disjoint owned files): WP2 ‖ WP3; WP6 ‖ WP7; WP8 ‖ WP6 or WP7 (not both: two heavy max); WP9a ‖ any frontend WP. Never parallel: two Playwright WPs; WP4 ‖ WP8 (contract slot).

Recommended lanes (never more than two test-heavy agents):
- **Lane A:** WP1 → WP2 → WP4 → WP5 → WP6 → WP9b → WP9c → WP9d → WP9e → WP10
- **Lane B:** (after WP1) WP3 → WP9a → (after WP5) WP7 → WP7b (when Documents E3 is done) → WP8
- WP1 runs alone (it defines the fixture module WP2/WP3 use). WP4 and WP5 run alone (short).

---

## WP1: Lifecycle (migration 0015, withdraw, reopen, recorded releases)

**Goal:** Report states `open|resolved|withdrawn`; actions `withdraw` and `reopen`; each hold release records who, when, how and which event; permission and state rules as pure functions; contract tests that holds are never lifted silently.

**Owns (writes):**
- Create `src/ontocurator/domain/problem_reports.py`
- Create `src/ontocurator/storage/migrations/versions/0015_problem_report_lifecycle.py`
- Modify `src/ontocurator/storage/workflow_tables.py` (`ProblemReportRow`, `TaskHoldRow`, `TaskHoldStateRow`, `ProblemReportEventRow` only)
- Modify `src/ontocurator/application/problem_reports.py` (`ReportAction`, `ProblemReportView.state`, `_release`, `act`)
- Create `tests/problem_report_team.py` (fixture + helpers, used by WP2, WP3, WP8)
- Create `tests/test_problem_report_rules.py`, `tests/test_problem_report_lifecycle.py`, `tests/test_problem_report_migration.py`

**May read:** spec sections "Backend semantics" (Current behaviour), "State model", "Contracts preserved", "Resolved questions" 1–3; `storage/migrations/versions/0013_problem_reports.py`, Documents migration `0014_final_selection_identity.py` (B2; for the revision id), `tests/test_problem_reports_api.py`, `tests/test_assignment_round_open_api.py` (`round_work` fixture), `tests/auth_harness.py` (`logged_in`), `tests/pg_harness.py`, `tests/test_schema.py` (ORM vs migration comparison).

### Step 1.1: Pure rules (test first)

- [ ] Write `tests/test_problem_report_rules.py`:

```python
"""Pure lifecycle rules of problem reports (no database)."""

import pytest

from ontocurator.domain.errors import AccessDenied, DomainError
from ontocurator.domain.problem_reports import (
    EventFact,
    check_permission,
    check_state,
    next_resolution,
    next_state,
    withdrawable,
)


def test_withdrawable_only_while_open_and_only_reporter_resumes_happened():
    assert withdrawable("open", 7, [])
    assert withdrawable("open", 7, [EventFact(7, "resume")])
    assert not withdrawable("open", 7, [EventFact(2, "resume")])
    assert not withdrawable("open", 7, [EventFact(7, "extend_hold")])
    assert not withdrawable("resolved", 7, [])
    assert not withdrawable("withdrawn", 7, [])


@pytest.mark.parametrize(
    ("action", "lead", "reporter", "allowed"),
    [
        ("resume", False, True, True),
        ("resume", True, False, True),
        ("resume", False, False, False),
        ("withdraw", False, True, True),
        ("withdraw", True, True, True),
        ("withdraw", True, False, False),
        ("reopen", True, False, True),
        ("reopen", False, True, False),
        ("resolve", False, True, False),
        ("extend_hold", True, False, True),
        ("restart", False, True, False),
    ],
)
def test_permission_matrix(action, lead, reporter, allowed):
    if allowed:
        check_permission(action, lead=lead, reporter=reporter)
    else:
        with pytest.raises(AccessDenied):
            check_permission(action, lead=lead, reporter=reporter)


@pytest.mark.parametrize(
    ("action", "state", "can_withdraw", "reason"),
    [
        ("resolve", "resolved", False, "REPORT_RESOLVED"),
        ("extend_hold", "withdrawn", False, "REPORT_WITHDRAWN"),
        ("withdraw", "resolved", False, "REPORT_RESOLVED"),
        ("withdraw", "open", False, "REPORT_LEAD_ACTED"),
        ("reopen", "open", False, "REPORT_OPEN"),
    ],
)
def test_state_conflicts(action, state, can_withdraw, reason):
    with pytest.raises(DomainError) as raised:
        check_state(action, state, withdrawable_now=can_withdraw)
    assert raised.value.code == "WORKFLOW_REVISION_CONFLICT"
    assert raised.value.details == {"reason": reason}


@pytest.mark.parametrize(
    ("action", "state"),
    [
        ("resume", "resolved"),
        ("resume", "withdrawn"),
        ("reopen", "resolved"),
        ("reopen", "withdrawn"),
        ("withdraw", "open"),
        ("restart", "open"),
    ],
)
def test_state_allows(action, state):
    check_state(action, state, withdrawable_now=True)


def test_transitions():
    assert next_state("resolve", "open") == "resolved"
    assert next_state("restart", "open") == "resolved"
    assert next_state("withdraw", "open") == "withdrawn"
    assert next_state("reopen", "withdrawn") == "open"
    assert next_state("resume", "resolved") == "resolved"
    assert next_state("extend_hold", "open") == "open"
    assert next_resolution("resolve", None, "Fixed text") == "Fixed text"
    assert next_resolution("reopen", "Fixed text", "Needs more") is None
    assert next_resolution("withdraw", None, "By mistake") is None
    assert next_resolution("resume", "Fixed text", "continue") == "Fixed text"
```

- [ ] Run `uv run pytest tests/test_problem_report_rules.py -q`. Expected: FAIL, `ModuleNotFoundError: ontocurator.domain.problem_reports`.
- [ ] Create `src/ontocurator/domain/problem_reports.py`:

```python
"""Pure lifecycle rules of problem reports and their task pauses (no I/O)."""

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

from ontocurator.domain.errors import AccessDenied, DomainError

ReportState = Literal["open", "resolved", "withdrawn"]
ReportAction = Literal[
    "resume", "resolve", "extend_hold", "restart", "withdraw", "reopen"
]
ReleaseAction = Literal["resume", "restart", "withdraw"]
CLOSED_STATES: frozenset[str] = frozenset({"resolved", "withdrawn"})
LEAD_ONLY: frozenset[str] = frozenset({"resolve", "extend_hold", "restart", "reopen"})


@dataclass(frozen=True)
class EventFact:
    actor_id: int
    action: str


def withdrawable(state: str, reporter_id: int, events: Iterable[EventFact]) -> bool:
    """Open and nobody but the reporter has acted (only own resumes so far)."""
    return state == "open" and all(
        event.actor_id == reporter_id and event.action == "resume" for event in events
    )


def check_permission(action: str, *, lead: bool, reporter: bool) -> None:
    if action == "withdraw":
        allowed = reporter
    elif action == "resume":
        allowed = lead or reporter
    else:
        allowed = lead and action in LEAD_ONLY
    if not allowed:
        raise AccessDenied("NOT_ALLOWED")


def _conflict(reason: str) -> DomainError:
    return DomainError("WORKFLOW_REVISION_CONFLICT", {"reason": reason})


def check_state(action: str, state: str, *, withdrawable_now: bool) -> None:
    if action == "reopen":
        if state not in CLOSED_STATES:
            raise _conflict("REPORT_OPEN")
        return
    if state in CLOSED_STATES and action != "resume":
        raise _conflict(
            "REPORT_RESOLVED" if state == "resolved" else "REPORT_WITHDRAWN"
        )
    if action == "withdraw" and not withdrawable_now:
        raise _conflict("REPORT_LEAD_ACTED")


def next_state(action: str, state: str) -> str:
    if action in {"resolve", "restart"}:
        return "resolved"
    if action == "withdraw":
        return "withdrawn"
    if action == "reopen":
        return "open"
    return state


def next_resolution(action: str, current: str | None, reason: str) -> str | None:
    if action in {"resolve", "restart"}:
        return reason
    if action == "reopen":
        return None
    return current
```

- [ ] Run the test file again. Expected: PASS.

### Step 1.2: Migration 0015 and ORM (test first)

- [ ] Confirm `ls src/ontocurator/storage/migrations/versions/` shows `0014_final_selection_identity.py` (Documents WP B2). If it is missing, stop and report; do not renumber.
- [ ] Write `tests/test_problem_report_migration.py`. It builds two releases at revision 0014 with raw SQL (one with a matching `resume` event, one without), upgrades to 0015 and checks the backfill and the state constraint:

```python
"""0015 records hold releases, backfilled from events; states are constrained."""

import pytest
from pg_harness import unmigrated_database_url
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError

from ontocurator.storage.schema import upgrade

S = "ontocurator"


def _seed(conn) -> None:
    conn.execute(
        text(
            f"INSERT INTO {S}.projects (project_key, name, manifest, manifest_sha256, task_profile, task_profile_sha256) "
            "VALUES ('p', 'p', '{}', 'm', '{}', 't')"
        )
    )
    for name, pseudonym in (("rep", "ann-0004"), ("lead", "lead-0002")):
        conn.execute(
            text(
                f"INSERT INTO {S}.users (username, display_name, pseudonym) VALUES (:u, :u, :p)"
            ),
            {"u": name, "p": pseudonym},
        )
    conn.execute(
        text(
            f"INSERT INTO {S}.documents (project_id, document_id, language, text, case_id, external_id, version, origin, derived_from, translation_status, text_sha256) "
            f"SELECT id, 'd', 'de', 'x', 'c', 'd', 1, 'native', NULL, NULL, 'h' FROM {S}.projects"
        )
    )
    conn.execute(
        text(
            f"INSERT INTO {S}.assignments (project_id, document_id, user_id, task) "
            f"SELECT p.id, 'd', u.id, 'annotate' FROM {S}.projects p, {S}.users u WHERE u.username = 'rep'"
        )
    )
    ids = "(SELECT id FROM {S}.projects), (SELECT id FROM {S}.assignments), (SELECT id FROM {S}.users WHERE username = 'rep')".format(
        S=S
    )
    conn.execute(
        text(
            f"INSERT INTO {S}.problem_reports (report_id, project_id, assignment_id, reporter_id, reason, created_at) "
            f"VALUES ('r1', {ids}, 'broken', '2026-10-19T01:00:00Z')"
        )
    )
    conn.execute(
        text(
            f"INSERT INTO {S}.problem_report_state (report_id, state, revision) VALUES ('r1', 'open', 3)"
        )
    )
    for hold, at in (("h1", "2026-10-19T01:00:00Z"), ("h2", "2026-10-19T03:00:00Z")):
        conn.execute(
            text(
                f"INSERT INTO {S}.task_holds (hold_id, project_id, assignment_id, report_id, reason, created_by, created_at) "
                f"SELECT '{hold}', a.project_id, a.id, 'r1', 'broken', a.user_id, '{at}' FROM {S}.assignments a"
            )
        )
        conn.execute(
            text(
                f"INSERT INTO {S}.task_hold_state (hold_id, active) VALUES ('{hold}', false)"
            )
        )
    conn.execute(
        text(
            f"INSERT INTO {S}.problem_report_events (event_id, project_id, report_id, actor_id, action, details, created_at) "
            f"SELECT 'e1', a.project_id, 'r1', u.id, 'resume', jsonb_build_object('reason', 'upsi', 'assignment_ids', jsonb_build_array(a.id)), '2026-10-19T02:00:00Z' "
            f"FROM {S}.assignments a, {S}.users u WHERE u.username = 'lead'"
        )
    )


def test_0015_backfills_matching_releases_and_leaves_unmatched_null(tmp_path):
    url = unmigrated_database_url(tmp_path / "reports-0015.db")
    upgrade(url, "0014")
    engine = create_engine(url)
    with engine.begin() as conn:
        _seed(conn)
    upgrade(url, "0015")
    with engine.begin() as conn:
        rows = {
            r.hold_id: r
            for r in conn.execute(
                text(
                    f"SELECT s.hold_id, s.release_action, s.release_event_id, u.username AS by "
                    f"FROM {S}.task_hold_state s LEFT JOIN {S}.users u ON u.id = s.released_by"
                )
            )
        }
    assert (rows["h1"].release_action, rows["h1"].release_event_id, rows["h1"].by) == (
        "resume",
        "e1",
        "lead",
    )
    # h2 was created after e1: no matching event, so "no record".
    assert (rows["h2"].release_action, rows["h2"].release_event_id, rows["h2"].by) == (
        None,
        None,
        None,
    )


def test_0015_rejects_unknown_report_states(tmp_path):
    url = unmigrated_database_url(tmp_path / "reports-0015-check.db")
    upgrade(url, "0014")
    engine = create_engine(url)
    with engine.begin() as conn:
        _seed(conn)
    upgrade(url, "0015")
    with pytest.raises(IntegrityError), engine.begin() as conn:
        conn.execute(text(f"UPDATE {S}.problem_report_state SET state = 'closed'"))
```

If an `INSERT` fails on a NOT NULL column without default, add the column with a neutral literal (check `\d` or `storage/tables.py`); do not change the scenario.

- [ ] Run `uv run pytest tests/test_problem_report_migration.py -q`. Expected: FAIL (`Migration target must be head or an exact known revision` for `0015`).
- [ ] Create `src/ontocurator/storage/migrations/versions/0015_problem_report_lifecycle.py`:

```python
"""Problem report lifecycle: withdrawn state and recorded hold releases."""

import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None
SCHEMA = "ontocurator"

BACKFILL = f"""
UPDATE {SCHEMA}.task_hold_state AS s
SET released_at = m.created_at, released_by = m.actor_id,
    release_action = m.action, release_event_id = m.event_id
FROM (
  SELECT h.hold_id, e.event_id, e.created_at, e.actor_id, e.action
  FROM {SCHEMA}.task_holds h
  JOIN {SCHEMA}.task_hold_state hs ON hs.hold_id = h.hold_id AND NOT hs.active
  JOIN LATERAL (
    SELECT ev.event_id, ev.created_at, ev.actor_id, ev.action
    FROM {SCHEMA}.problem_report_events ev
    WHERE ev.report_id = h.report_id
      AND ev.action IN ('resume', 'restart')
      AND ev.created_at >= h.created_at
      AND ev.details -> 'assignment_ids' @> to_jsonb(h.assignment_id)
    ORDER BY ev.created_at, ev.event_id
    LIMIT 1
  ) e ON TRUE
) AS m
WHERE s.hold_id = m.hold_id
"""


def upgrade() -> None:
    op.add_column(
        "task_hold_state",
        sa.Column("released_at", sa.DateTime(timezone=True)),
        schema=SCHEMA,
    )
    op.add_column(
        "task_hold_state",
        sa.Column("released_by", sa.BigInteger(), sa.ForeignKey(f"{SCHEMA}.users.id")),
        schema=SCHEMA,
    )
    op.add_column(
        "task_hold_state", sa.Column("release_action", sa.Text()), schema=SCHEMA
    )
    op.add_column(
        "task_hold_state", sa.Column("release_event_id", sa.Text()), schema=SCHEMA
    )
    # The event row is inserted after the release in the same transaction.
    op.create_foreign_key(
        "fk_task_hold_state_release_event",
        "task_hold_state",
        "problem_report_events",
        ["release_event_id"],
        ["event_id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
        deferrable=True,
        initially="DEFERRED",
    )
    op.execute(BACKFILL)
    op.create_check_constraint(
        "ck_problem_report_state_state",
        "problem_report_state",
        "state IN ('open', 'resolved', 'withdrawn')",
        schema=SCHEMA,
    )
    op.create_check_constraint(
        "ck_task_hold_state_release",
        "task_hold_state",
        "(release_action IS NULL OR release_action IN ('resume', 'restart', 'withdraw'))"
        " AND (NOT active OR (released_at IS NULL AND release_event_id IS NULL))",
        schema=SCHEMA,
    )
    op.create_index(
        "ix_problem_reports_project_assignment",
        "problem_reports",
        ["project_id", "assignment_id"],
        schema=SCHEMA,
    )
    op.create_index("ix_task_holds_report", "task_holds", ["report_id"], schema=SCHEMA)
    op.create_index(
        "ix_task_holds_assignment", "task_holds", ["assignment_id"], schema=SCHEMA
    )
    op.create_index(
        "ix_problem_report_events_report",
        "problem_report_events",
        ["report_id", "created_at"],
        schema=SCHEMA,
    )


def downgrade() -> None:
    raise NotImplementedError("Migrations are forward-only")
```

- [ ] Mirror the schema in `storage/workflow_tables.py` so `tests/test_schema.py::test_the_migration_creates_exactly_the_mapped_tables` (alembic `compare_metadata`) stays empty:
  - `TaskHoldStateRow`: `released_at: Mapped[datetime | None]`, `released_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey(f"{SCHEMA}.users.id"))`, `release_action: Mapped[str | None]`, `release_event_id: Mapped[str | None] = mapped_column(ForeignKey(f"{SCHEMA}.problem_report_events.event_id", name="fk_task_hold_state_release_event", deferrable=True, initially="DEFERRED"))`.
  - `__table_args__` indexes: `ProblemReportRow`: `Index("ix_problem_reports_project_assignment", "project_id", "assignment_id")`; `TaskHoldRow`: `Index("ix_task_holds_report", "report_id")`, `Index("ix_task_holds_assignment", "assignment_id")`; `ProblemReportEventRow`: `Index("ix_problem_report_events_report", "report_id", "created_at")`. Keep the existing `schema` table arg (copy how neighbouring classes declare `__table_args__`).
- [ ] Run `uv run pytest tests/test_problem_report_migration.py tests/test_schema.py -q`. Expected: PASS.

### Step 1.3: Team fixture module

- [ ] Create `tests/problem_report_team.py` (a pytest plugin module; test files load it with `pytest_plugins = ("test_assignment_round_open_api", "problem_report_team")`):

```python
"""A lead and two annotators with tasks, plus report helpers (problem report tests)."""

from types import SimpleNamespace
from typing import Any

import pytest
from auth_harness import logged_in

from ontocurator.assignments.service import AssignmentService


@pytest.fixture
def team(round_work):
    app, lead, lead_task, _service, _rounds = round_work
    key = lead_task.project_key
    bob = logged_in(
        app,
        "bob",
        pseudonym="ann-0004",
        projects={key: ["annotator"]},
        assignments=[(key, "doc-1", "annotate")],
    )
    carol = logged_in(
        app,
        "carol",
        pseudonym="ann-0005",
        projects={key: ["annotator"]},
        assignments=[(key, "doc-other", "annotate")],
    )
    service = AssignmentService(app.state.repo.db)
    return SimpleNamespace(
        app=app,
        key=key,
        lead=lead,
        lead_task=lead_task,
        bob=bob,
        bob_task=service.list(key, user="bob")[0],
        carol=carol,
        carol_task=service.list(key, user="carol")[0],
    )


def report(
    client,
    task_id: int,
    reason: str = "Text is cut off after paragraph 2",
    request_id: str | None = None,
) -> dict[str, Any]:
    current = client.get(f"/api/v1/assignments/{task_id}").json()
    response = client.post(
        f"/api/v1/assignments/{task_id}/problem-reports",
        json={
            "request_id": request_id
            or f"report-{task_id}-{current['workflow_revision']}",
            "expected_workflow_revision": current["workflow_revision"],
            "round_id": current["active_round_id"],
            "reason": reason,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def act(
    client,
    report_id: str,
    revision: int,
    action: str,
    reason: str | None = None,
    ids: list[int] | None = None,
    *,
    status: int = 200,
    request_id: str | None = None,
):
    response = client.post(
        f"/api/v1/problem-reports/{report_id}/actions",
        json={
            "request_id": request_id or f"{action}-{report_id}-{revision}",
            "expected_revision": revision,
            "action": action,
            "reason": reason or f"{action} reason",
            "assignment_ids": ids or [],
        },
    )
    assert response.status_code == status, response.text
    return response.json()


def held(app, task_id: int) -> tuple[bool, str | None]:
    """Pause flag and banner reason of a task (existing reader, no new service method)."""
    with app.state.repo.db.transaction() as conn:
        current = AssignmentService._get(conn, task_id)
    return current.held, current.hold_reason
```

### Step 1.4: Withdraw, reopen and recorded releases (test first)

- [ ] Write `tests/test_problem_report_lifecycle.py`:

```python
"""Withdraw, reopen, recorded releases; holds are never lifted silently."""

from problem_report_team import act, held, report
from sqlalchemy import select

from ontocurator.storage.workflow_tables import TaskHoldRow, TaskHoldStateRow

pytest_plugins = ("test_assignment_round_open_api", "problem_report_team")


def _hold_states(app, report_id):
    with app.state.repo.db.transaction() as conn:
        return [
            dict(r)
            for r in conn.execute(
                select(
                    TaskHoldRow.assignment_id,
                    TaskHoldStateRow.active,
                    TaskHoldStateRow.release_action,
                    TaskHoldStateRow.release_event_id,
                    TaskHoldStateRow.released_by,
                    TaskHoldStateRow.released_at,
                )
                .join(TaskHoldStateRow, TaskHoldStateRow.hold_id == TaskHoldRow.hold_id)
                .where(TaskHoldRow.report_id == report_id)
                .order_by(TaskHoldRow.created_at)
            ).mappings()
        ]


def test_reporter_withdraws_untouched_report_and_only_own_pause_is_released(team):
    created = report(team.bob, team.bob_task.id)
    withdrawn = act(
        team.bob, created["report_id"], 1, "withdraw", "Reported by mistake"
    )
    assert withdrawn["state"] == "withdrawn" and withdrawn["resolution"] is None
    assert held(team.app, team.bob_task.id) == (False, None)
    [state] = _hold_states(team.app, created["report_id"])
    assert state["active"] is False and state["release_action"] == "withdraw"
    assert state["release_event_id"] and state["released_at"] is not None


def test_withdraw_after_own_resume_is_allowed_and_releases_nothing_more(team):
    created = report(team.bob, team.bob_task.id)
    act(team.bob, created["report_id"], 1, "resume", "upsi", [team.bob_task.id])
    withdrawn = act(team.bob, created["report_id"], 2, "withdraw", "By mistake")
    assert withdrawn["state"] == "withdrawn"
    [state] = _hold_states(team.app, created["report_id"])
    assert state["release_action"] == "resume"  # first release record kept


def test_withdraw_is_refused_after_any_lead_action_and_for_non_reporters(team):
    created = report(team.bob, team.bob_task.id)
    denied = act(team.lead, created["report_id"], 1, "withdraw", "Not mine", status=403)
    assert denied["code"] == "NOT_ALLOWED"
    act(
        team.lead,
        created["report_id"],
        1,
        "extend_hold",
        "Pause too",
        [team.carol_task.id],
    )
    refused = act(
        team.bob, created["report_id"], 2, "withdraw", "By mistake", status=409
    )
    assert refused["details"] == {"reason": "REPORT_LEAD_ACTED"}


def test_lead_reopens_closed_and_withdrawn_reports_without_pausing_again(team):
    created = report(team.bob, team.bob_task.id)
    act(team.bob, created["report_id"], 1, "withdraw", "By mistake")
    reopened = act(team.lead, created["report_id"], 2, "reopen", "Still a problem")
    assert reopened["state"] == "open" and reopened["held_assignment_ids"] == []
    assert held(team.app, team.bob_task.id) == (False, None)
    assert act(team.bob, created["report_id"], 3, "withdraw", "Again", status=409)[
        "details"
    ] == {"reason": "REPORT_LEAD_ACTED"}
    act(team.lead, created["report_id"], 3, "resolve", "Fixed the source text")
    again = act(team.lead, created["report_id"], 4, "reopen", "Came back")
    assert again["state"] == "open" and again["resolution"] is None
    assert act(team.lead, created["report_id"], 5, "reopen", "Twice", status=409)[
        "details"
    ] == {"reason": "REPORT_OPEN"}
    assert (
        act(team.bob, created["report_id"], 5, "reopen", "Me", status=403)["code"]
        == "NOT_ALLOWED"
    )


def test_closed_and_withdrawn_reports_accept_only_resume_and_reopen(team):
    created = report(team.bob, team.bob_task.id)
    act(team.lead, created["report_id"], 1, "resolve", "Outcome")
    for action in ("resolve", "extend_hold", "restart"):
        refused = act(
            team.lead,
            created["report_id"],
            2,
            action,
            "x",
            [team.carol_task.id],
            status=409,
        )
        assert refused["details"] == {"reason": "REPORT_RESOLVED"}
    resumed = act(
        team.lead, created["report_id"], 2, "resume", "Continue", [team.bob_task.id]
    )
    assert resumed["state"] == "resolved"
    [state] = _hold_states(team.app, created["report_id"])
    assert state["release_action"] == "resume" and state["released_by"] is not None


def test_release_from_one_report_never_lifts_another_reports_pause(team):
    first = report(team.bob, team.bob_task.id, "First problem")
    second = report(team.carol, team.carol_task.id, "Second problem")
    act(
        team.lead,
        second["report_id"],
        1,
        "extend_hold",
        "Hold Bob as well",
        [team.bob_task.id],
    )
    act(team.lead, first["report_id"], 1, "resume", "First is fine", [team.bob_task.id])
    assert held(team.app, team.bob_task.id) == (True, "Hold Bob as well")
    assert any(
        s["active"]
        for s in _hold_states(team.app, second["report_id"])
        if s["assignment_id"] == team.bob_task.id
    )
    # Report-level actions never touch any hold.
    act(team.lead, first["report_id"], 2, "resolve", "Done")
    act(team.lead, first["report_id"], 3, "reopen", "Not done")
    assert held(team.app, team.bob_task.id) == (True, "Hold Bob as well")


def test_restart_is_atomic_when_another_report_pauses_the_task(team):
    first = report(team.bob, team.bob_task.id, "First problem")
    second = report(team.carol, team.carol_task.id, "Second problem")
    act(
        team.lead, second["report_id"], 1, "extend_hold", "Hold Bob", [team.bob_task.id]
    )
    refused = act(
        team.lead,
        first["report_id"],
        1,
        "restart",
        "Agreed",
        [team.bob_task.id],
        status=409,
    )
    assert refused["code"] == "TASK_HELD"
    assert held(team.app, team.bob_task.id)[0] is True
    assert all(s["active"] for s in _hold_states(team.app, first["report_id"]))
    act(team.lead, second["report_id"], 2, "resume", "Released", [team.bob_task.id])
    restarted = act(
        team.lead, first["report_id"], 1, "restart", "Agreed", [team.bob_task.id]
    )
    assert restarted["state"] == "resolved" and restarted["new_round"] is not None
    assert [
        s["release_action"] for s in _hold_states(team.app, first["report_id"])
    ] == ["restart"]


def test_replayed_withdraw_returns_the_same_result(team):
    created = report(team.bob, team.bob_task.id)
    one = act(
        team.bob, created["report_id"], 1, "withdraw", "By mistake", request_id="w-1"
    )
    two = act(
        team.bob, created["report_id"], 1, "withdraw", "By mistake", request_id="w-1"
    )
    assert one == two
```

If `TASK_HELD` is answered with a status other than 409, read `api/app.py` and assert that status instead (do not change the mapping).

- [ ] Run `uv run pytest tests/test_problem_report_lifecycle.py -q`. Expected: FAIL (`withdraw` is not a valid `action`, 422).
- [ ] Implement in `application/problem_reports.py`:
  1. Replace `ReportAction = Literal[...]` by `from ontocurator.domain.problem_reports import ReportAction, EventFact, check_permission, check_state, next_resolution, next_state, withdrawable` (keep the name `ReportAction` exported; `api/problem_report_routes.py` imports it).
  2. `ProblemReportView.state: Literal["open", "resolved", "withdrawn"]`.
  3. `_release(self, conn, report_id, assignment_ids, now, *, released_by: int, release_action: str, event_id: str)`: select only **active** holds of this report on those tasks and record the release:

```python
        ids = list(
            conn.execute(
                select(TaskHoldRow.hold_id)
                .join(TaskHoldStateRow, TaskHoldStateRow.hold_id == TaskHoldRow.hold_id)
                .where(
                    TaskHoldRow.report_id == report_id,
                    TaskHoldRow.assignment_id.in_(assignment_ids),
                    TaskHoldStateRow.active.is_(True),
                )
            ).scalars()
        )
        conn.execute(
            update(TaskHoldStateRow)
            .where(TaskHoldStateRow.hold_id.in_(ids))
            .values(
                active=False,
                released_at=now,
                released_by=released_by,
                release_action=release_action,
                release_event_id=event_id,
            )
        )
        # the per-assignment held/hold_reason recomputation below stays unchanged
```

  4. In `act`, after `_prepare`:

```python
            lead = can(fresh, Action.MANAGE_ASSIGNMENTS, project)
            check_permission(action, lead=lead, reporter=raw["reporter_id"] == fresh.user_id)
```

  and after the revision check (replacing the old `resolved` check):

```python
            facts = [
                EventFact(r.actor_id, r.action)
                for r in conn.execute(
                    select(ProblemReportEventRow.actor_id, ProblemReportEventRow.action).where(
                        ProblemReportEventRow.report_id == report_id
                    )
                )
            ]
            check_state(
                action,
                state["state"],
                withdrawable_now=withdrawable(state["state"], raw["reporter_id"], facts),
            )
            now = datetime.now(UTC)
            event_id = f"report-event-{uuid4().hex}"
```

  5. Action branches: `extend_hold` unchanged. `resume`/`restart` unchanged except the call `self._release(conn, report_id, selected, now, released_by=fresh.user_id, release_action=action, event_id=event_id)`. New:

```python
            elif action == "withdraw":
                own = raw["assignment_id"]
                active_own = conn.execute(
                    select(TaskHoldRow.hold_id)
                    .join(TaskHoldStateRow, TaskHoldStateRow.hold_id == TaskHoldRow.hold_id)
                    .where(
                        TaskHoldRow.report_id == report_id,
                        TaskHoldRow.assignment_id == own,
                        TaskHoldStateRow.active.is_(True),
                    )
                ).first()
                selected = [own] if active_own else []
                if selected:
                    AssignmentService._locked(conn, own)
                    self._release(conn, report_id, selected, now, released_by=fresh.user_id, release_action="withdraw", event_id=event_id)
            elif action == "reopen":
                selected = []
```

  `resolve` sets `selected = []` as today.
  6. State update uses `state=next_state(action, state["state"])`, `resolution=next_resolution(action, state["resolution"], reason)`. The event insert uses `event_id=event_id`.
- [ ] Run `uv run pytest tests/test_problem_report_rules.py tests/test_problem_report_lifecycle.py tests/test_problem_report_migration.py tests/test_problem_reports.py tests/test_problem_reports_api.py tests/test_schema.py -q`. Expected: all PASS.
- [ ] Run `uv run ruff check . && uv run ruff format --check . && uv run mypy src`. Expected: clean.

**Done checklist WP1**
- [ ] 0015 exists, `down_revision = "0014"`, backfill test green, `compare_metadata` empty.
- [ ] `withdraw`/`reopen` accepted per matrix; conflicts carry `details.reason`.
- [ ] Every release writes `released_at/by/action/event_id`; already released holds are never overwritten.
- [ ] Contract tests: another report's pause survives resume/resolve/reopen; restart fails atomically with `TASK_HELD`.
- [ ] Existing problem report tests unchanged and green.

**Commit point (later):** `src/ontocurator/domain/problem_reports.py src/ontocurator/storage/migrations/versions/0015_problem_report_lifecycle.py src/ontocurator/storage/workflow_tables.py src/ontocurator/application/problem_reports.py tests/problem_report_team.py tests/test_problem_report_rules.py tests/test_problem_report_lifecycle.py tests/test_problem_report_migration.py` / `feat: withdraw and reopen problem reports with recorded pause releases`

---

## WP2: Read model, redaction and read endpoints

**Goal:** One `ProblemReportView` builder per viewer. Leads see everything; the reporter sees only their own task. New `GET /problem-reports/{report_id}`, `?assignment_id=` filter and `GET /problem-reports/{report_id}/pause-candidates`. Contract tests for blinding.

**Owns:**
- Create `src/ontocurator/application/problem_report_views.py`
- Modify `src/ontocurator/application/problem_reports.py` (`ProblemReportView` fields, `_view`, `_receipt` replay, `list`, new `get`, `pause_candidates`)
- Modify `src/ontocurator/api/problem_report_routes.py`
- Create `tests/test_problem_report_views.py`, `tests/test_problem_report_blinding.py`
- Modify `tests/test_problem_reports_api.py` only where an assertion reads the old `events[].details` shape

**May read:** spec "History" (sentences table, "Never synthesize", "Redaction"), "API changes", "Lead flow > Page structure 4"; `domain/submission_labels.py::round_ordinals` (Documents B5); `application/work_rounds.py` (restart: `prior_id = assignment["active_round_id"]`, `predecessor_round_id`); `storage/workflow_tables.py` (`WorkRoundRow`, `RoundSubmissionBindingRow`); `storage/tables.py` (`UserRow.pseudonym`, `DocumentRow.case_id/language`, `SubmissionRow`); `tests/problem_report_team.py`.

### Response models (put in `application/problem_report_views.py`; re-export from `problem_reports.py`)

```python
class AffectedTask(BaseModel):
    model_config = ConfigDict(extra="forbid")
    assignment_id: int
    owner_label: str
    case_id: str
    language: str
    task: Task


class ReportEventView(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: str
    action: str
    actor_label: str
    created_at: datetime
    reason: str | None = None
    round_id: str | None = None
    round_ordinal: int | None = None
    abandoned_round_id: str | None = (
        None  # restart: predecessor of round_id (the round actually abandoned)
    )
    abandoned_round_ordinal: int | None = None
    abandoned_translation_draft: dict[str, Any] | None = None
    affected: list[AffectedTask] = Field(default_factory=list)  # leads only
    own_task: bool = False  # the event touched the reporter's task


class OtherActiveHold(BaseModel):
    model_config = ConfigDict(extra="forbid")
    report_id: str


class ReportHoldView(BaseModel):
    model_config = ConfigDict(extra="forbid")
    hold_id: str
    assignment_id: int
    owner_label: str
    case_id: str
    language: str
    task: Task
    created_at: datetime
    created_by_label: str
    active: bool
    released_at: datetime | None = None
    released_by_label: str | None = None
    release_action: Literal["resume", "restart", "withdraw"] | None = None
    release_event_id: str | None = None
    other_active_holds: list[OtherActiveHold] = Field(
        default_factory=list
    )  # leads only


class ReportSubmissionRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    submission_id: str
    round_ordinal: int | None
    recorded_at: datetime


class PauseCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    assignment_id: int
    owner_label: str
    case_id: str
    language: str
    task: Task
    same_text: bool
    paused_by_this_report: bool
    reporter_task: bool
```

`ProblemReportView` (in `problem_reports.py`) keeps every existing field and gains (all with defaults so stored receipts still validate): `created_at: datetime | None = None`, `reporter_label: str = ""`, `case_id: str = ""`, `language: str = ""`, `task: Task | None = None`, `round_ordinal: int | None = None` (round the report was filed in), `current_round_id: str | None = None`, `current_round_ordinal: int | None = None` (the reporter's assignment's active round now; the round a restart would abandon), `submission: ReportSubmissionRef | None = None`, `state_changed_at: datetime | None = None`, `state_changed_by_label: str | None = None`, `withdrawable: bool = False`, `viewer_label: str = ""`, `viewer_is_lead: bool = False`, `holds: list[ReportHoldView] = []`. `events` becomes `list[ReportEventView]`.

### Rules the builder implements

- `build_report_view(conn, report_id, *, viewer_id: int, viewer_is_lead: bool) -> ProblemReportView` loads the report, state, project key, the reporter's assignment (document, task), its `DocumentRow` (`case_id`, `language`), pseudonyms (labels), all holds of this report (with owner, creator and releaser labels, task document `case_id`/`language`), events (actor label), the rounds of the reporter's assignment (`round_ordinals`), the named submission (`recorded_at`, its round via `RoundSubmissionBindingRow`).
- `state_changed_at/by`: the latest event with action in `resolve|restart|withdraw|reopen`; `None` when none.
- `withdrawable`: `domain.problem_reports.withdrawable(...)` and `viewer_id == reporter_id`.
- Event `affected` (leads): one `AffectedTask` per id in `details["assignment_ids"]`, in that order; unknown ids are skipped. `own_task = reporter_assignment_id in details["assignment_ids"]` (always `True` for `restart`; `False` for `resolve`/`reopen`).
- `round_ordinal` of an event: ordinal of `details["round_id"]` if present. For `restart` events, `abandoned_round_id` = `WorkRoundRow.predecessor_round_id` of `details["round_id"]` and `abandoned_round_ordinal` its ordinal (never the report's `round_ordinal`). `current_round_id/ordinal` come from the reporter's assignment's `active_round_id`. Ordinals use `round_ordinals` over **all** rounds of the reporter's assignment (Documents B5).
- **Redaction for non-leads** (applied inside the builder, never after serialization):
  - `holds`: only holds with `assignment_id == reporter_assignment_id`; `other_active_holds = []`.
  - `held_assignment_ids`: only the reporter's task when its hold is active.
  - `events`: drop events with action `resume` or `extend_hold` whose `own_task` is false; all kept events get `affected = []`.
- Receipt replay: `_receipt` returns the stored dict; `report`/`act` then return `build_report_view(...)` for the current viewer with `new_round` taken from the stored dict (`ProblemReportView.model_validate` is no longer used on receipts). `_remember` stores `result.model_dump(mode="json")` as today.
- `list(access, project, document_id=None, assignment_id=None)`: as today plus `.where(ProblemReportRow.assignment_id == assignment_id)` when given; ordering **newest first** (`created_at DESC, report_id DESC`).
- `get(access, project_key_unknown, report_id)`: finds the report's project, checks `VIEW_PROJECT` and (lead or reporter); otherwise `DomainError("REPORT_NOT_FOUND")` (same for unknown ids).
- `pause_candidates(access, report_id)`: lead only (`REPORT_NOT_FOUND` otherwise). All non-revoked assignments of the project, `same_text = document.case_id == report case_id`, `paused_by_this_report` = an active hold of this report exists, `reporter_task = assignment_id == report.assignment_id`; order: same text first, then `case_id`, `language`, `assignment_id`.

### Steps

- [ ] Write `tests/test_problem_report_views.py` (lead view):

```python
"""Lead view: identity, labels, holds with releases, events with actors."""

from problem_report_team import act, report

pytest_plugins = ("test_assignment_round_open_api", "problem_report_team")


def test_lead_view_has_identity_labels_and_release_records(team):
    created = report(team.bob, team.bob_task.id, "Text is cut off\nsecond line")
    act(team.bob, created["report_id"], 1, "resume", "upsi", [team.bob_task.id])
    act(
        team.lead,
        created["report_id"],
        2,
        "extend_hold",
        "Wait for new source",
        [team.carol_task.id],
    )
    act(team.lead, created["report_id"], 3, "resolve", "Source fixed")
    view = team.lead.get(f"/api/v1/problem-reports/{created['report_id']}").json()
    assert view["reporter_label"] == "ann-0004" and view["created_at"]
    assert view["case_id"] and view["language"] and view["task"] == "annotate"
    assert (
        view["state"] == "resolved" and view["state_changed_by_label"] == "own-reviewer"
    )
    assert view["viewer_is_lead"] is True and view["withdrawable"] is False
    own, other = sorted(view["holds"], key=lambda h: h["created_at"])
    assert own["owner_label"] == "ann-0004" and own["active"] is False
    assert own["release_action"] == "resume" and own["released_by_label"] == "ann-0004"
    assert other["owner_label"] == "ann-0005" and other["active"] is True
    assert [e["action"] for e in view["events"]] == ["resume", "extend_hold", "resolve"]
    assert view["events"][1]["affected"][0]["owner_label"] == "ann-0005"
    assert (
        view["events"][0]["actor_label"] == "ann-0004"
        and view["events"][0]["reason"] == "upsi"
    )


def test_restarts_name_the_round_actually_abandoned_not_the_reported_round(team):
    created = report(team.bob, team.bob_task.id)
    filed = team.lead.get(f"/api/v1/problem-reports/{created['report_id']}").json()[
        "round_ordinal"
    ]
    act(team.lead, created["report_id"], 1, "restart", "Agreed", [team.bob_task.id])
    act(team.lead, created["report_id"], 2, "reopen", "Still broken")
    act(
        team.lead,
        created["report_id"],
        3,
        "restart",
        "Agreed again",
        [team.bob_task.id],
    )
    view = team.lead.get(f"/api/v1/problem-reports/{created['report_id']}").json()
    restarts = [e for e in view["events"] if e["action"] == "restart"]
    # The second restart acts on an old report: it abandons the restarted round, not the reported one.
    assert [(e["abandoned_round_ordinal"], e["round_ordinal"]) for e in restarts] == [
        (filed, filed + 1),
        (filed + 1, filed + 2),
    ]
    assert view["round_ordinal"] == filed
    assert view["current_round_ordinal"] == filed + 2
    mine = team.bob.get(f"/api/v1/problem-reports/{created['report_id']}").json()
    assert [
        e["abandoned_round_ordinal"] for e in mine["events"] if e["action"] == "restart"
    ] == [filed, filed + 1]


def test_other_active_holds_name_the_other_report_for_leads(team):
    first = report(team.bob, team.bob_task.id)
    second = report(team.carol, team.carol_task.id)
    act(
        team.lead, second["report_id"], 1, "extend_hold", "Hold Bob", [team.bob_task.id]
    )
    view = team.lead.get(f"/api/v1/problem-reports/{first['report_id']}").json()
    [hold] = view["holds"]
    assert hold["other_active_holds"] == [{"report_id": second["report_id"]}]


def test_assignment_filter_returns_newest_first(team):
    one = report(team.bob, team.bob_task.id, "One", request_id="r-one")
    act(team.bob, one["report_id"], 1, "resume", "ok", [team.bob_task.id])
    two = report(team.bob, team.bob_task.id, "Two", request_id="r-two")
    listed = team.bob.get(
        f"/api/v1/projects/{team.key}/problem-reports",
        params={"assignment_id": team.bob_task.id},
    ).json()
    assert [r["report_id"] for r in listed] == [two["report_id"], one["report_id"]]
    assert (
        team.bob.get(
            f"/api/v1/projects/{team.key}/problem-reports",
            params={"assignment_id": team.carol_task.id},
        ).json()
        == []
    )


def test_pause_candidates_for_leads_only(team):
    created = report(team.bob, team.bob_task.id)
    rows = team.lead.get(
        f"/api/v1/problem-reports/{created['report_id']}/pause-candidates"
    ).json()
    bob = next(r for r in rows if r["assignment_id"] == team.bob_task.id)
    assert bob["reporter_task"] and bob["paused_by_this_report"] and bob["same_text"]
    assert rows[0]["same_text"] is True
    assert (
        team.bob.get(
            f"/api/v1/problem-reports/{created['report_id']}/pause-candidates"
        ).status_code
        == 404
    )
```

(`own-reviewer` is the pseudonym of the lead `alice` in `round_work`.) In the restart test, if `filed` is `None` (the fixture task has no active round yet), open Bob's first round the way `round_work` does for the lead before reporting; do not weaken the assertions.

- [ ] Write `tests/test_problem_report_blinding.py` (contract tests; keep them exhaustive and string-based so any leak fails):

```python
"""The reporter never learns about other tasks: IDs, labels, texts or reasons."""

import json

from problem_report_team import act, report

pytest_plugins = ("test_assignment_round_open_api", "problem_report_team")

SECRET = "Lead-only reason for Carol"


def _all_reporter_payloads(team, report_id):
    yield team.bob.get(f"/api/v1/problem-reports/{report_id}").json()
    yield team.bob.get(f"/api/v1/projects/{team.key}/problem-reports").json()
    yield team.bob.get(
        f"/api/v1/projects/{team.key}/problem-reports",
        params={"assignment_id": team.bob_task.id},
    ).json()


def _task_ids(value):
    """Every task ID anywhere in a payload (keys assignment_id, *_assignment_ids, assignment_ids)."""
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "assignment_id" and isinstance(item, int):
                yield item
            elif key.endswith("assignment_ids") and isinstance(item, list):
                yield from (i for i in item if isinstance(i, int))
            else:
                yield from _task_ids(item)
    elif isinstance(value, list):
        for item in value:
            yield from _task_ids(item)


def _assert_blind(team, payload):
    text = json.dumps(payload)
    assert "ann-0005" not in text
    assert SECRET not in text
    assert team.carol_task.id not in set(_task_ids(payload))


def test_reporter_view_hides_lead_pauses_on_other_tasks_entirely(team):
    created = report(team.bob, team.bob_task.id)
    act(team.lead, created["report_id"], 1, "extend_hold", SECRET, [team.carol_task.id])
    act(
        team.lead,
        created["report_id"],
        2,
        "resume",
        "Carol may go on",
        [team.carol_task.id],
    )
    for payload in _all_reporter_payloads(team, created["report_id"]):
        _assert_blind(team, payload)
    view = team.bob.get(f"/api/v1/problem-reports/{created['report_id']}").json()
    assert view["events"] == []  # both events touched only Carol's task
    assert [h["assignment_id"] for h in view["holds"]] == [team.bob_task.id]
    assert view["held_assignment_ids"] == [team.bob_task.id]


def test_reporter_sees_a_mixed_event_without_the_other_task(team):
    created = report(team.bob, team.bob_task.id)
    act(
        team.lead,
        created["report_id"],
        1,
        "resume",
        "Both continue",
        [team.bob_task.id],
    )
    act(
        team.lead,
        created["report_id"],
        2,
        "extend_hold",
        SECRET,
        [team.bob_task.id, team.carol_task.id],
    )
    view = team.bob.get(f"/api/v1/problem-reports/{created['report_id']}").json()
    paused = view["events"][-1]
    assert (
        paused["action"] == "extend_hold"
        and paused["own_task"] is True
        and paused["affected"] == []
    )
    # The reason is shown to Bob as an affected owner, but Carol is never named.
    _assert_blind(
        team,
        {k: v for k, v in view.items() if k != "events"}
        | {"events": [{**e, "reason": None} for e in view["events"]]},
    )


def test_replayed_reporter_action_is_redacted_too(team):
    created = report(team.bob, team.bob_task.id)
    act(team.lead, created["report_id"], 1, "extend_hold", SECRET, [team.carol_task.id])
    first = act(
        team.bob,
        created["report_id"],
        2,
        "resume",
        "upsi",
        [team.bob_task.id],
        request_id="same",
    )
    again = act(
        team.bob,
        created["report_id"],
        2,
        "resume",
        "upsi",
        [team.bob_task.id],
        request_id="same",
    )
    _assert_blind(team, first)
    _assert_blind(team, again)


def test_unrelated_annotator_gets_report_not_found_for_existing_and_unknown_ids(team):
    created = report(team.bob, team.bob_task.id)
    for report_id in (created["report_id"], "report-does-not-exist"):
        response = team.carol.get(f"/api/v1/problem-reports/{report_id}")
        assert (
            response.status_code == 404
            and response.json()["code"] == "REPORT_NOT_FOUND"
        )
    assert team.carol.get(f"/api/v1/projects/{team.key}/problem-reports").json() == []
```

- [ ] Run both files: `uv run pytest tests/test_problem_report_views.py tests/test_problem_report_blinding.py -q`. Expected: FAIL (404 on `GET /problem-reports/{id}`).
- [ ] Implement `application/problem_report_views.py` (models above + `build_report_view`, `build_pause_candidates`), switch `ProblemReportService._view` to `build_report_view(conn, rid, viewer_id=..., viewer_is_lead=...)` everywhere (`report`, `act`, `list`), implement replay as described, add `get` and `pause_candidates`.
- [ ] Routes in `api/problem_report_routes.py`:

```python
@router.get("/projects/{key}/problem-reports")
def reports(
    key: str,
    request: Request,
    principal: PrincipalDep,
    document_id: str | None = None,
    assignment_id: int | None = None,
) -> list[ProblemReportView]:
    return ProblemReportService(request.app.state.repo.db).list(
        get_access(request), key, document_id, assignment_id
    )


@router.get("/problem-reports/{report_id}")
def get_report(
    report_id: str, request: Request, principal: PrincipalDep
) -> ProblemReportView:
    return ProblemReportService(request.app.state.repo.db).get(
        get_access(request), report_id
    )


@router.get("/problem-reports/{report_id}/pause-candidates")
def pause_candidates(
    report_id: str, request: Request, principal: PrincipalDep
) -> list[PauseCandidate]:
    return ProblemReportService(request.app.state.repo.db).pause_candidates(
        get_access(request), report_id
    )
```

- [ ] If `tests/test_problem_reports_api.py` or `tests/test_problem_reports.py` read `events[...]["details"]`, change them to the new fields (`reason`, `abandoned_translation_draft`, `round_id`). Do not weaken any other assertion.
- [ ] Run `uv run pytest tests/test_problem_report_views.py tests/test_problem_report_blinding.py tests/test_problem_report_lifecycle.py tests/test_problem_reports.py tests/test_problem_reports_api.py tests/test_final_causes.py tests/test_workflow_warnings.py -q` (skip `test_final_causes.py` if Documents B1 has not created it). Expected: PASS. Then ruff + mypy clean.

**Done checklist WP2**
- [ ] Lead view carries all spec "API changes" fields (with the deviations listed above).
- [ ] Restart events name the round actually abandoned; `current_round_ordinal` is the assignment's active round (test with two restarts separated by reopen).
- [ ] Reporter payloads (GET one, list, list by task, action responses, replays) never contain other owners' labels, task IDs or lead reasons for other tasks.
- [ ] `REPORT_NOT_FOUND` (404) for unrelated users and unknown IDs alike.
- [ ] No events synthesized: creation is not an event; `events` only from rows.

**Commit point (later):** `src/ontocurator/application/problem_report_views.py src/ontocurator/application/problem_reports.py src/ontocurator/api/problem_report_routes.py tests/test_problem_report_views.py tests/test_problem_report_blinding.py tests/test_problem_reports_api.py` / `feat: per-viewer problem report read model with reporter redaction`

---

## WP3: `AssignmentView.active_holds` for the task owner

**Goal:** The dialog's "Your task: Paused" causes without revealing other reports.

**Owns:** Modify `src/ontocurator/api/assignment_routes.py`; Create `tests/test_assignment_active_holds.py`.
**May read:** spec "Dialog > 1. Task status", "API changes" row `AssignmentView.active_holds`; `tests/problem_report_team.py`; `storage/workflow_tables.py`.

- [ ] Test first, `tests/test_assignment_active_holds.py`:

```python
"""The owner sees each active pause's reason and whether it is their own report."""

from problem_report_team import act, report

pytest_plugins = ("test_assignment_round_open_api", "problem_report_team")


def test_owner_sees_own_report_pause_and_lead_pause_without_other_report_id(team):
    own = report(team.bob, team.bob_task.id, "My problem")
    other = report(team.carol, team.carol_task.id, "Carol problem")
    act(
        team.lead,
        other["report_id"],
        1,
        "extend_hold",
        "Wait for source",
        [team.bob_task.id],
    )
    view = team.bob.get(f"/api/v1/assignments/{team.bob_task.id}").json()
    holds = sorted(view["active_holds"], key=lambda h: h["created_at"])
    assert [(h["reason"], h["own_report_id"]) for h in holds] == [
        ("My problem", own["report_id"]),
        ("Wait for source", None),
    ]
    assert other["report_id"] not in str(view)


def test_lead_listing_does_not_carry_active_holds(team):
    report(team.bob, team.bob_task.id)
    rows = team.lead.get(f"/api/v1/projects/{team.key}/assignments").json()
    assert all(row["active_holds"] == [] for row in rows)
```

- [ ] Run `uv run pytest tests/test_assignment_active_holds.py -q`. Expected: FAIL (`KeyError: 'active_holds'`).
- [ ] Implement: `class ActiveHoldView(BaseModel): reason: str; created_at: datetime; own_report_id: str | None`; `AssignmentView.active_holds: list[ActiveHoldView] = Field(default_factory=list)`. `_views(request, assignments, owner_id: int | None = None)` loads, in the same transaction, active holds (`TaskHoldRow` ⨝ `TaskHoldStateRow.active` ⨝ `ProblemReportRow`) for rows whose `user_id == owner_id`; `own_report_id = report_id if ProblemReportRow.reporter_id == owner_id else None`; ordered by `created_at, hold_id`. Pass `owner_id=principal.user_id` from `assignment_metadata` and both `open_assignment` returns; all other callers keep the default.
- [ ] Run `uv run pytest tests/test_assignment_active_holds.py tests/test_assignment_round_open_api.py -q`, then ruff + mypy. Expected: PASS / clean.

**Done checklist WP3:** owner-only field; other report IDs never present; existing assignment tests green.
**Commit point (later):** `src/ontocurator/api/assignment_routes.py tests/test_assignment_active_holds.py` / `feat: owner sees the causes of their task pauses`

---

## WP4: Contracts and client methods

**Goal:** Regenerated OpenAPI and TS types; three client methods.

**Owns (contract slot, see "Cross-plan schedule" 2):** `contracts/openapi.json`, `frontend/src/api/generated.ts` (both generated), `frontend/src/api/client.ts` (problem report section only: type exports and methods); Create `frontend/tests/problemReportClient.test.ts`. Also `frontend/src/tasks/ReportHistory.tsx` (typecheck fix only, see below).
**Precondition:** Documents B9 done (`grep -n "listDocumentRows" frontend/src/api/client.ts`) and no other contract writer (Editor B4, WP8) running.
**May read:** `frontend/src/api/client.ts` lines around `createProblemReport` (~690-705).

- [ ] Run `uv run python scripts/export_openapi.py` and `npm --prefix frontend run api:generate`. Never while Documents B9, Editor B4 or WP8 holds the contract slot, and never while a backend WP of any plan is mid-edit on API models.
- [ ] Test first (`frontend/tests/problemReportClient.test.ts`): mock `fetch` the way `frontend/tests/variantClient.test.ts` does and assert URLs:
  - `api.getProblemReport("r/1")` → `GET /api/v1/problem-reports/r%2F1`
  - `api.listTaskProblemReports("p/key", 4)` → `GET /api/v1/projects/p%2Fkey/problem-reports?assignment_id=4`
  - `api.listPauseCandidates("r 1")` → `GET /api/v1/problem-reports/r%201/pause-candidates`
- [ ] Implement in `client.ts`: export types `ReportEventView`, `ReportHoldView`, `AffectedTask`, `PauseCandidate`, `ActiveHoldView` from `components["schemas"]`; widen `ProblemActionRequest["action"]` automatically via generated types; add the three methods next to `listProblemReports`.
- [ ] Run `npm --prefix frontend test -- tests/problemReportClient.test.ts --maxWorkers=4 --minWorkers=1`, `npm --prefix frontend run typecheck` (existing `ProblemReportDetail.tsx`/`ReportHistory.tsx` may now fail on `events[].details`; fix only by reading `event.reason` / `event.abandoned_translation_draft` in `ReportHistory.tsx`, which WP5 replaces), `uv run python scripts/export_openapi.py --check`, `npm --prefix frontend run api:check`. Expected: all green.

**Done checklist WP4:** drift checks green; typecheck green; client test green.
**Commit point (later):** `contracts/openapi.json frontend/src/api/generated.ts frontend/src/api/client.ts frontend/tests/problemReportClient.test.ts frontend/src/tasks/ReportHistory.tsx` / `feat(api): problem report read endpoints in the client`

---

## WP5: Label rules, timeline component, fixtures, CSS

**Goal:** All user-visible problem report wording in one pure module; one timeline for both views.

**Owns:** Create `frontend/src/problems/labels.ts`, `frontend/src/problems/ReportTimeline.tsx`, `frontend/src/problems/problems.css`, `frontend/tests/problems/fixtures.ts`, `frontend/tests/problems/labels.test.ts`, `frontend/tests/problems/reportTimeline.test.tsx`.
**May read:** spec "Shared rules", "History" (table), "Reporter flow > Dialog" facts, "Lead flow > Intent actions", "Outcome messages", "Errors"; `frontend/src/app/submissionLabels.ts` and `frontend/src/app/Time.tsx` (Documents D1, shared primitives); `frontend/src/ui/StatusBadge.tsx`.
**Precondition:** `grep -n "export function formatTime" frontend/src/app/submissionLabels.ts` and `ls frontend/src/app/Time.tsx` succeed; otherwise stop and report.

### Fixture builders (`frontend/tests/problems/fixtures.ts`)

```ts
import type { ProblemReportView, ReportEventView, ReportHoldView } from "../../src/api/client";

export const T0 = "2026-10-19T01:12:00Z";
export function hold(over: Partial<ReportHoldView> = {}): ReportHoldView {
  return { hold_id: "h1", assignment_id: 4, owner_label: "ann-0004", case_id: "accepted-translation", language: "de", task: "annotate",
    created_at: T0, created_by_label: "ann-0004", active: true, released_at: null, released_by_label: null, release_action: null,
    release_event_id: null, other_active_holds: [], ...over };
}
export function event(over: Partial<ReportEventView> = {}): ReportEventView {
  return { event_id: "e1", action: "resume", actor_label: "ann-0004", created_at: "2026-10-19T01:13:00Z", reason: "upsi", round_id: null,
    round_ordinal: null, abandoned_round_id: null, abandoned_round_ordinal: null, abandoned_translation_draft: null, affected: [], own_task: true, ...over };
}
export function report(over: Partial<ProblemReportView> = {}): ProblemReportView {
  return { report_id: "r1", project_key: "p", assignment_id: 4, document_id: "accepted-translation/de", reporter_id: 9, round_id: "round-2",
    submission_id: null, reason: "Text is cut off after the second paragraph\nMore detail", state: "open", revision: 1, resolution: null,
    held_assignment_ids: [4], events: [], new_round: null, created_at: T0, reporter_label: "ann-0004", case_id: "accepted-translation",
    language: "de", task: "annotate", round_ordinal: 2, current_round_id: "round-2", current_round_ordinal: 2, submission: null, state_changed_at: null, state_changed_by_label: null,
    withdrawable: true, viewer_label: "ann-0004", viewer_is_lead: false, holds: [hold()], ...over } as ProblemReportView;
}
```

### `problems/labels.ts` contract

```ts
export function reportTitle(text: string, max = 80): string;            // first line, cut at a word boundary + "…"
export function reportStateBadge(r: ProblemReportView): { text: "Open" | "Closed" | "Withdrawn"; tone: StatusTone };
export function reportStateFact(r: ProblemReportView, now?: Date): string; // "Open" | "Closed by ann-0002 · 19 Oct, 01:31" | "Withdrawn by you · …"
export function taskLabel(t: { assignment_id: number; owner_label: string; case_id: string; language: string }): string; // "Task 4 · ann-0004 · accepted-translation · de"
export function taskRef(t: { assignment_id: number; owner_label: string }): string;      // "Task 4 (ann-0004)"
export type TaskFactKind = "paused" | "repaused" | "resumed" | "restarted" | "withdrawn" | "unknown-release";
export function yourTaskFact(r: ProblemReportView): { kind: TaskFactKind; text: string; at: string | null };
export interface HistoryItem { key: string; sentence: string; at: string; quoteLabel?: "Reason" | "Outcome" | "Reason shown to their owners"; quote?: string; draft?: { text?: string; form?: Record<string, unknown> } }
export function historyItems(r: ProblemReportView): HistoryItem[];      // view from r.viewer_is_lead
export function toolbarEntry(reports: ProblemReportView[] | null, held: boolean): { badge: string | null; paused: boolean; accessibleSuffix: string };
export type Intent = "close" | "release" | "pause" | "restart" | "reopen";
export function intentState(r: ProblemReportView): Record<Intent, { label: string; consequence: string; unavailable: string | null }>;
export function leadSummary(r: ProblemReportView): string;
export function leadOutcome(intent: Intent, before: ProblemReportView, after: ProblemReportView, released?: number[]): string;
export function conflictReasonText(details: unknown): string | null;    // REPORT_* reasons to sentences
```

Sentences (exact): see spec "History" table plus:
- withdraw: lead "ann-0004 withdrew the report." + " Task 4 resumed." when `affected` non-empty; reporter "You withdrew the report." + " Your task resumed." when `own_task`. Quote label "Reason".
- reopen: "{actor} reopened the report." (reporter: same; actor "You" never applies since only leads reopen). Quote label "Reason".
- In reporter view the actor equal to `reporter_label` reads "You"; in lead view the viewer's own label reads `personLabel(label, true)` ("lead-0002 (you)").
- Creation item first, from `created_at`/`reporter_label`: lead "ann-0004 reported the problem. Task 4 paused."; reporter "You reported the problem. Your task paused."
- Unknown action: `{actor} recorded "{action}".`
- restart: rounds come from the event (`abandoned_round_ordinal`, `round_ordinal`), never from the report's `round_ordinal`: lead "lead-0002 agreed an empty restart of Task 4. Round {abandoned} abandoned and kept; Round {new} started empty. Report closed."; reporter "lead-0002 restarted your task with an empty Round {new}. Round {abandoned} is kept. Report closed." When `abandoned_round_ordinal` is null: "The previous round" / "The previous round is kept."; translation review: the draft disclosure as described for `ReportTimeline`.

`yourTaskFact` rules (holds on `r.assignment_id`, oldest → newest; take the newest): active and more than one such hold → `repaused` "Paused again by {created_by_label}"; active → `paused` "Paused since"; `release_action` `restart` → `restarted` "Restarted with an empty Round {n}" (n = `round_ordinal` of the event `release_event_id`); `withdraw` → `withdrawn` "Resumed when you withdrew the report"; `resume` → "Resumed by you" when `released_by_label === r.reporter_label` else "Resumed by {label}"; no release record → `unknown-release` "Released (no record of who released it)". `at` is `created_at` for paused kinds, else `released_at`.

`intentState` (labels/consequences exactly as in spec "Intent actions"; additions):
- `close.label` "Close report (pauses stay)" if any active hold else "Close report"; unavailable when state ≠ open: "The report is closed." / "The report is withdrawn."
- `release` unavailable when no active hold: "No task is paused by this report."
- `pause` and `restart` unavailable when state ≠ open (same reasons as close); restart also when the reporter's active hold has `other_active_holds.length > 0` or another active pause exists: "Task 4 is also paused by another report. Release that pause first."
- `reopen`: label "Reopen report…", consequence "Makes the report open again. Nothing is paused again.", unavailable when open: "The report is open."

`leadSummary`: "Nothing is paused by this report. The report is open until you close it." / "{n} task(s) is/are paused by this report. The report is closed; release the pause when work can continue." / "{n} task(s) paused by this report. The report is open." / "The reporter withdrew this report. Nothing is paused by it." / "Nothing left to decide." (closed, no active hold).

### Steps

- [ ] Write `frontend/tests/problems/labels.test.ts` with at least these cases (exact strings):

```ts
import { describe, expect, it } from "vitest";
import { historyItems, intentState, leadOutcome, leadSummary, reportStateBadge, reportTitle, taskLabel, toolbarEntry, yourTaskFact } from "../../src/problems/labels";
import { event, hold, report } from "./fixtures";

describe("problem report labels", () => {
  it("title_is_first_line_cut_at_a_word_boundary", () => {
    expect(reportTitle("Short\nsecond")).toBe("Short");
    expect(reportTitle("word ".repeat(30).trim())).toBe(`${"word ".repeat(16).trim()}…`);
    expect(reportTitle("a".repeat(100))).toBe(`${"a".repeat(80)}…`); // no boundary: hard cut
  });
  it("state_vocabulary", () => {
    expect(reportStateBadge(report()).text).toBe("Open");
    expect(reportStateBadge(report({ state: "resolved" }))).toEqual({ text: "Closed", tone: "success" });
    expect(reportStateBadge(report({ state: "withdrawn" }))).toEqual({ text: "Withdrawn", tone: "neutral" });
  });
  it("task_label", () => { expect(taskLabel(hold())).toBe("Task 4 · ann-0004 · accepted-translation · de"); });
  it("your_task_fact_for_each_release_path", () => {
    expect(yourTaskFact(report()).text).toBe("Paused since");
    expect(yourTaskFact(report({ holds: [hold({ active: false, release_action: "resume", released_by_label: "ann-0004", released_at: "2026-10-19T01:13:00Z" })] })).text).toBe("Resumed by you");
    expect(yourTaskFact(report({ holds: [hold({ active: false, release_action: "resume", released_by_label: "lead-0002", released_at: "2026-10-19T01:13:00Z" })] })).text).toBe("Resumed by lead-0002");
    expect(yourTaskFact(report({ events: [event({ event_id: "e9", action: "restart", round_ordinal: 3 })], holds: [hold({ active: false, release_action: "restart", release_event_id: "e9", released_by_label: "lead-0002", released_at: "2026-10-19T02:00:00Z" })] })).text).toBe("Restarted with an empty Round 3");
    expect(yourTaskFact(report({ holds: [hold({ active: false }), hold({ hold_id: "h2", created_by_label: "lead-0002", created_at: "2026-10-19T03:00:00Z" })] })).text).toBe("Paused again by lead-0002");
    expect(yourTaskFact(report({ holds: [hold({ active: false })] })).text).toBe("Released (no record of who released it)");
  });
  it("history_creation_first_and_view_dependent_sentences", () => {
    const lead = report({ viewer_is_lead: true, viewer_label: "lead-0002", events: [event(), event({ event_id: "e2", action: "extend_hold", actor_label: "lead-0002", own_task: false, reason: "Wait", affected: [{ assignment_id: 7, owner_label: "ann-0005", case_id: "c", language: "de", task: "annotate" }] })] });
    expect(historyItems(lead).map(i => i.sentence)).toEqual([
      "ann-0004 reported the problem. Task 4 paused.",
      "ann-0004 resumed Task 4 (ann-0004).",
      "lead-0002 (you) paused Task 7 (ann-0005). Reason shown to their owners:",
    ]);
    const mine = report({ events: [event(), event({ event_id: "e3", action: "resolve", actor_label: "lead-0002", own_task: false, reason: "Fixed" })] });
    const items = historyItems(mine);
    expect(items.map(i => i.sentence)).toEqual(["You reported the problem. Your task paused.", "You resumed your task.", "lead-0002 closed the report."]);
    expect(items[2]).toMatchObject({ quoteLabel: "Outcome", quote: "Fixed" });
    expect(historyItems(report({ events: [event({ action: "withdraw" })] })).at(-1)?.sentence).toBe("You withdrew the report. Your task resumed.");
    expect(historyItems(report({ events: [event({ action: "mystery", actor_label: "lead-0002" })] })).at(-1)?.sentence).toBe('lead-0002 recorded "mystery".');
    const restarted = report({ round_ordinal: 1, current_round_ordinal: 3, events: [event({ action: "restart", actor_label: "lead-0002", own_task: true, round_ordinal: 3, abandoned_round_ordinal: 2 })] });
    expect(historyItems(restarted).at(-1)?.sentence).toBe("lead-0002 restarted your task with an empty Round 3. Round 2 is kept. Report closed.");
  });
  it("toolbar_entry_states", () => {
    expect(toolbarEntry([], false)).toEqual({ badge: null, paused: false, accessibleSuffix: "Report a problem with this task" });
    expect(toolbarEntry([report({ holds: [hold({ active: false })] })], false)).toEqual({ badge: "1 open", paused: false, accessibleSuffix: "1 open report" });
    expect(toolbarEntry([report()], true)).toEqual({ badge: "Paused · 1 open", paused: true, accessibleSuffix: "Task paused, 1 open report" });
    expect(toolbarEntry(null, true).accessibleSuffix).toBe("Task paused");
  });
  it("intent_availability", () => {
    const open = intentState(report({ viewer_is_lead: true }));
    expect(open.close.label).toBe("Close report (pauses stay)");
    expect(open.reopen.unavailable).toBe("The report is open.");
    const closed = intentState(report({ viewer_is_lead: true, state: "resolved", holds: [hold({ active: false })] }));
    expect(closed.release.unavailable).toBe("No task is paused by this report.");
    expect(closed.pause.unavailable).toBe("The report is closed.");
    const blocked = intentState(report({ viewer_is_lead: true, holds: [hold({ other_active_holds: [{ report_id: "r2" }] })] }));
    expect(blocked.restart.unavailable).toBe("Task 4 is also paused by another report. Release that pause first.");
  });
  it("summary_and_outcomes", () => {
    expect(leadSummary(report({ state: "resolved" }))).toBe("1 task is paused by this report. The report is closed; release the pause when work can continue.");
    const before = report({ viewer_is_lead: true });
    const after = report({ viewer_is_lead: true, state: "resolved" });
    expect(leadOutcome("close", before, after)).toBe("Report closed. Task 4 is still paused by this report; release it when work can continue.");
    expect(leadOutcome("reopen", after, before)).toBe("Report reopened. No task was paused again.");
  });
});
```

- [ ] Run `npm --prefix frontend test -- tests/problems/labels.test.ts --maxWorkers=4 --minWorkers=1`. Expected: FAIL (module missing).
- [ ] Implement `labels.ts` importing `formatTime`, `personLabel`, `submissionLabel` from `../app/submissionLabels` and `StatusTone` from `../ui`. Keep it pure (no React). Never import from `documents/`.
- [ ] `ReportTimeline.tsx`: `export function ReportTimeline({ report, headingLevel }: { report: ProblemReportView; headingLevel?: 2 | 3 | 4 })` renders `<ol className="report-timeline">` of `historyItems(report)`: each `<li>` with the sentence, `<Time iso={item.at} />` (`import { Time } from "../app/Time"`, Documents D1), and when `quote` exists `<p className="report-quote-label">{quoteLabel}</p><blockquote className="report-text">{quote}</blockquote>`; for `draft` a `<details><summary>Translation draft kept from before the restart</summary>…</details>` with the text and form `<dl>` (port from `tasks/ReportHistory.tsx`).
- [ ] `reportTimeline.test.tsx`: renders an `<ol>` with `<time dateTime>` per item, blockquote for reasons, the draft disclosure label, and in reporter view no element contains "ann-0005" for a fixture whose lead events are already redacted.
- [ ] `problems.css`: `.report-text { white-space: pre-wrap; font-family: var(--font-serif); font-size: var(--text-body); margin: 0; }`, timeline list spacing with tokens, `.report-facts` `<dl>` grid that stacks below 700 px (`@media (max-width: 699px) { .report-facts { grid-template-columns: 1fr; } }`), `.problem-badge` text+icon inline-flex. Import it once from `ReportTimeline.tsx` (`import "./problems.css";`). Use existing tokens from `styles/tokens.css` only.
- [ ] Run both test files and `npm --prefix frontend run typecheck`. Expected: PASS.

**Done checklist WP5:** all sentences in one module; no React in `labels.ts`; timeline is an `<ol>` with `<time>`; reasons are blockquotes without `lang`.
**Commit point (later):** `frontend/src/problems/ frontend/tests/problems/` / `feat(problems): label rules and history timeline`

---

## WP6: Reporter flow (toolbar entry, dialog, new report, resume, withdraw)

**Goal:** Spec "Reporter flow (editor)" plus resolved questions 1 (withdraw) and 6 (label "Report problem").

**Owns:** Rewrite `frontend/src/tasks/TaskProblemActions.tsx`, `frontend/src/tasks/ProblemReportForm.tsx`; Create `frontend/src/problems/ReporterReportCard.tsx`, `frontend/src/problems/useTaskReports.ts`; Rewrite `frontend/tests/problemReports.test.tsx`; Create `frontend/tests/problems/reporterDialog.test.tsx`; Modify `frontend/tests/dialogFooters.test.tsx` (only its problem-report case, when Quick WP-B created the file).
**Preconditions:** Documents U1 (`grep -n "InlineConfirm" frontend/src/ui/index.ts`), Editor F1 (`grep -n "data-dialog-close" frontend/src/ui/Dialog.tsx`) and CR-2 (see "Change requests to sibling plans"); Quick WP-B done or CR-3 agreed.
**May read:** spec "Reporter flow (editor)", "Keyboard and screen reader", "Errors" (reporter paragraph); `ui/Dialog.tsx`, `ui/InlineConfirm.tsx`, `ui/Button.tsx`, `ui/Textarea.tsx`, `ui/Checkbox.tsx`, `ui/InlineMessage.tsx`; `problems/labels.ts`; `tasks/TaskEditor.tsx:41,146` (mount points, do not edit).

### Behaviour to implement (exact copy)

- Toolbar: `<Button size="sm" aria-describedby? no>` with visible "Report problem"; when `toolbarEntry(...).badge`: `<span className="problem-badge">{paused && <IconWarning aria-hidden />}{badge}</span>`; accessible name = visible text + `<span className="visually-hidden"> {accessibleSuffix}</span>`. The button keeps its text at all widths.
- `useTaskReports(assignment, onRefresh)`: loads `api.listTaskProblemReports(project_key, id)` on mount, on `window` `focus`, when the dialog opens and after each own action. On `focus` and on dialog open it also loads `api.getAssignmentMetadata(id)` in parallel, so the task status and remaining-pause lines never contradict the reports after a lead released, restarted or paused elsewhere (`TaskEditor` keeps its assignment until `onRefresh`). One request counter covers both requests: a response pair older than the newest is discarded as a whole. When the fresh assignment differs from the current one in `workflow_revision`, `held`, `hold_reason`, `status` or `active_holds`, it calls `onRefresh(fresh)` (no call when nothing changed, so no refresh loop). Exposes `{ reports, error, reload }`. A failed report load leaves `reports` as `null` (toolbar shows no badge) and the dialog shows `ErrorNotice` with "Retry"; a failed metadata load keeps the previous assignment.
- Dialog: `Dialog open title="Problems with Task {id}" size="md" footer={…} onClose={busy ? undefined : close}`. When the form view is active the title is "New problem report".
  - Part 1 status line: "Your task: Paused" / "Your task: Active"; causes from `assignment.active_holds`: own → `Paused by your report "{reportTitle(reason)}".`; `own_report_id === null` → `Paused by a project lead: {reason}. Only a project lead can release this pause.`; `assignment.status === "submitted"` → "Your submitted result stays unchanged and readable."
  - Part 2 heading "Your reports ({n})", newest first, each `ReporterReportCard`.
  - Below list: if any open report has `withdrawable === false`: "A project lead has acted on this report. Resume your task with a reason and ask a project lead to close it." (no line otherwise).
  - Footer (list view): secondary "New report", quiet "Close". Footer (form view): primary "Report and pause my task", quiet "Cancel".
  - No reports → open directly in the form view.
  - Initial focus: list view → first report heading (`tabIndex={-1}`) whose own pause is active, else "New report"; form view → textarea (`initialFocus` ref).
- `ReporterReportCard` (`<article aria-labelledby>`): `<h3 tabIndex={-1}>` title; meta "Reported <Time>"; `<dl className="report-facts">` rows "Report" (`reportStateFact` plus `Outcome: {resolution}` when closed, `Reason: {withdraw reason}` when withdrawn) and "Your task" (`yourTaskFact` text + `<Time>`); actions:
  - "Resume my task…" (secondary) when the own hold is active → `InlineConfirm` title "Resume Task {id}", Textarea "Why can you continue?" `rows={3}` hint "Recorded in the report history. Project leads see it."; message lines: "The report stays open. A project lead decides on it." (closed: "The report is already closed. Only the pause is released."), plus for each `active_holds` entry other than this report: "Your task stays paused by a project lead: {reason}."; confirm "Resume my task". Success message: "Resumed. The report stays open." or "Resumed. Your task is still paused by a project lead."
  - "Withdraw report…" (quiet) when `report.withdrawable` → `InlineConfirm` title "Withdraw report", Textarea "Why are you withdrawing it?" `rows={3}` required, lines "The report is marked Withdrawn. Project leads can still read it." and, when the own pause is active, "Your task's pause from this report is released."; confirm "Withdraw report". Success: "Withdrawn. Your task is no longer paused by this report." (or "…Your task is still paused by a project lead." when other pauses remain).
  - One `InlineConfirm` open per dialog. Empty reason activation: field error "Enter a reason." and focus the textarea.
  - Disclosure `<details>` "Full report and history ({k} events)" (k = events + 1 for creation): `<blockquote className="report-text">{reason}</blockquote>` then `<ReportTimeline report={r} />`.
- New report form (`ProblemReportForm`): `Textarea` label "What is the problem?" `rows={6}` hint "Only you and project leads can read this." (`style={{ resize: "vertical" }}` via CSS); consequence line: editable → "Reporting pauses this task: you cannot save or submit until the pause is released. Your saved work stays."; submitted → "Reporting pauses this task. Your submitted result stays unchanged and readable."; empty submit → error "Describe the problem." + focus; save failure → `InlineMessage tone="error"` "Your latest changes could not be saved. Nothing was reported." + Checkbox "Report anyway. My unsaved changes stay only in this open editor until I resume and save."; primary gets `aria-disabled` + `aria-describedby` to "Check the box to report without saving." until checked. Cancel/Escape with text → inline "Discard this report? Your text will be lost." with "Discard" / "Keep writing"; without text → back to list (or close when no reports). Keep the existing idempotent `request_id` map logic.
- Success after report: list view, new report first, `InlineMessage tone="success"` "Reported. Your task is paused until you or a project lead resume it.", focus the new heading, call `onRefresh(await api.getAssignmentMetadata(id))`.
- Errors (inside the form / card, `role="alert"`): `WORKFLOW_REVISION_CONFLICT`, `ROUND_KEY_MISMATCH`, `REPORT_SUBMISSION_INVALID` → "Your task changed in another window or by a project lead. Nothing was reported. Your text is kept." + "Try again" (reload assignment then resubmit with a new request); `AMBIGUOUS_REVIEW_ROUND` → "This task's current round is unclear. Nothing was reported. Ask a project lead."; resume/withdraw conflict → "A project lead changed this report. Nothing was saved." and reload the list.
- Escape: the Dialog's `onClose` is `undefined` while a write is busy; when an `InlineConfirm` with text or the form with text is open, Escape asks first (handled by the confirm/form, which stop propagation by returning nothing from their `useShortcut` handler).

### Steps

- [ ] Write `frontend/tests/problems/reporterDialog.test.tsx` (mock `api` like the current `tests/problemReports.test.tsx`), one `it` per bullet:
  - toolbar names: "Report problem Report a problem with this task"; with one open report "Report problem 1 open report"; held "Report problem Task paused, 1 open report" and visible `IconWarning` + "Paused · 1 open"; failed count load → no badge.
  - opens in "New problem report" view when the list is empty, focus on the textarea, textarea has `rows="6"`.
  - list loads on open without any "Reload" button; a slower first response resolved after a second one is ignored.
  - external lead action: dialog open with "Your task: Paused" from the own report; a `focus` event returns metadata with empty `active_holds` and reports whose own hold has `release_action: "resume"` by `lead-0002` → `onRefresh` called once with the fresh assignment, status "Your task: Active", card fact "Resumed by lead-0002"; an older (slower) response pair from a previous focus is discarded; a lead pause added elsewhere (`active_holds` gains `own_report_id: null`) shows "Paused by a project lead: {reason}. Only a project lead can release this pause." after focus.
  - footer buttons are queried inside `.modal-actions` (Editor F1 adds a header "Close" button).
  - empty submit → "Describe the problem." and focus textarea; nothing sent.
  - save failure gate: primary `aria-disabled="true"` until the checkbox is checked; activation without the checkbox sends nothing.
  - Cancel with text asks "Discard this report? Your text will be lost."; "Keep writing" keeps the text.
  - success: success message, new report heading focused, `onRefresh` called.
  - resume confirm lines with and without another active pause; success message variant.
  - withdraw offered only when `withdrawable`; confirm sends `{ action: "withdraw", assignment_ids: [] }`; unavailable line shown for a non-withdrawable open report.
  - reporter never renders other tasks: with a fixture whose `holds` contain only the own task, no text "Task 7".
  - footer contains exactly "New report" and "Close" in the list view.
- [ ] Rewrite `frontend/tests/problemReports.test.tsx` to the new labels (keep its idempotency/request-id assertions: the same text and revision reuse the same `request_id` on retry). Leave its three `ProblemReportDetail` cases ("requires exact task selection for hold extension and lead agreement for restart", "does not fetch private reports when management access is unavailable", "offers only remaining pause releases after report resolution") and the `ProblemReportDetail` import untouched; WP7 owns them.
- [ ] If `frontend/tests/dialogFooters.test.tsx` exists (Quick WP-B ran), replace its case "puts Reload my reports then Close reports in the footer, both disabled while busy" by "puts New report then Close in the problem dialog footer": open via "Report problem" with one existing report, both buttons inside `.modal-actions` and outside `.ui-dialog-body`, "New report" before "Close", no "Reload" button. Leave its other two cases untouched.
- [ ] Run `npm --prefix frontend test -- tests/problems/reporterDialog.test.tsx tests/problemReports.test.tsx --maxWorkers=4 --minWorkers=1`. Expected: FAIL.
- [ ] Implement the four files. `TaskProblemActions` props stay `{ assignment, onSaveBeforeReport, onRefresh }`.
- [ ] Run the two files (plus `tests/dialogFooters.test.tsx` if it exists), then `npm --prefix frontend test -- tests/translationTaskApp.test.tsx tests/caseScreen.test.tsx --maxWorkers=4 --minWorkers=1` (mount points), then `npm --prefix frontend run typecheck`. Expected: PASS.

**Done checklist WP6:** one toolbar button; no "Reload"; footer actions; withdraw restricted; resume confirm states remaining pauses; focus rules; focus/open refresh updates reports and assignment together; no other task data rendered; no obsolete Quick test case left.
**Commit point (later):** `frontend/src/tasks/TaskProblemActions.tsx frontend/src/tasks/ProblemReportForm.tsx frontend/src/problems/ReporterReportCard.tsx frontend/src/problems/useTaskReports.ts frontend/tests/problemReports.test.tsx frontend/tests/problems/reporterDialog.test.tsx frontend/tests/dialogFooters.test.tsx` / `feat(tasks): one-step problem report with honest status and withdrawal`

---

## WP7: Lead report page

**Goal:** Spec "Lead flow" (page structure, intents, confirmations, outcomes, errors) plus Reopen.

**Owns:** Rewrite `frontend/src/tasks/ProblemReportDetail.tsx` (after Documents E2); Create `frontend/src/problems/LeadStatePanel.tsx`, `frontend/src/problems/LeadDecide.tsx`, `frontend/src/problems/LeadConfirms.tsx`, `frontend/src/problems/useLeadReport.ts`, `frontend/tests/problems/leadReportPage.test.tsx`; Modify `frontend/tests/problemReportRoute.test.tsx` (first test only: back link, `action=resume`, `recordDecision` against the new page); Modify `frontend/tests/problemReports.test.tsx` (only its three `ProblemReportDetail` cases and import, made obsolete by the rewrite: delete them; port "does not fetch private reports when management access is unavailable" to `leadReportPage.test.tsx` as `canManage={false}` → no `api.getProblemReport` call; the other two are covered by the Release/Pause/Restart cases below). Not owned: `App.tsx` (WP7b), `ui/InlineConfirm.tsx` (Documents U1; CR-1).
**Preconditions:** Documents E2 done (`grep -n "recordDecision" frontend/src/tasks/ProblemReportDetail.tsx`), D8 (`frontend/src/documents/visitState.ts` exists), B9 (`listDocumentRows` in `client.ts`), CR-1 (`grep -n "conflictMessage" frontend/src/ui/InlineConfirm.tsx`).
**May read:** spec "Lead flow", "Errors", "Keyboard and screen reader", "Narrow viewports"; Documents WP blocks U1 (Task 3.3), U3 (Task 4.1), D8 (Task 5.9), E2 (Task 6.3); `app/router.ts` (`projectProblemReport` type), `documents/visitState.ts`, `app/submissionLabels.ts`, `app/Time.tsx`, `problems/labels.ts`, `ui/Toolbar.tsx`.

### Page (exact structure)

`ProblemReportDetail({ projectKey, reportId, canManage, onNavigate, documents, action })` (props as left by Documents E2):
1. Back link first: `<a href={routeHref(back)} onClick={intercept}>` with `<IconChevronLeft aria-hidden />` "Back to Documents"; `back` = `{ name: "projectDocuments", key, ...documents }` when `documents` is set, else `{ name: "projectDocuments", key, case: report.case_id, language: report.language }` (no extra metadata request now that the view carries both).
2. `<h1>` "Problem report"; identity line "{case_id} · {language} · Task {id} ({reporter_label}) · {Annotation|Review|Translation review} · Round {round_ordinal}" and link "View text" → `projectCase` route with `variant: report.document_id`, `annotations: refKey({kind:"submission", id})` when `report.submission`, and `documents` passthrough.
3. Report: `<blockquote className="report-text">`, meta "Reported by {reporter_label} · <Time>", and when `report.submission`: "About the submitted result Round {n} · <Time>".
4. `<section aria-labelledby>` `<h2>` "Current state" → `LeadStatePanel`: `<dl>` "Report" (badge + `reportStateFact` + "Outcome: …"/"Reason: …"), "Paused tasks" (active holds first: `taskLabel` + `StatusBadge tone="warning"` "Paused" + "since <Time>"; released: "Resumed" badge + "by reporter (ann-0004) · <Time> · "{reason}"" / "by {label} · <Time>", or "Restarted" badge + "Round {n} started empty", or "Released (no record of who released it)"; "Also paused by another report" + link "Open report" per `other_active_holds` (same route with `documents` passthrough); "None paused now" above released lines when no hold is active), "Final result" (from `api.listDocumentRows(projectKey, { case, language })` row `final` → `submissionLabel(...)` from `app/submissionLabels` or "None", plus "Actions on this page never change it."), then the `leadSummary` sentence.
5. `<section>` `<h2>` "Decide" → `LeadDecide`: `<Toolbar label="Decide on this report">` with five intent buttons in this order: Close, Release pause…, Pause other tasks…, Agree empty restart…, Reopen report…. Each button: `aria-expanded`, `aria-controls` (its confirm), `aria-describedby` to its visible consequence line (`<p id>` right below it) and, when unavailable, `aria-disabled="true"` plus the reason text in that line; activation of an unavailable intent announces the reason in the page's polite live region. No button has `variant="primary"`.
6. `<h2>` "History" → `<ReportTimeline report={report} />`.
7. `<details>` "Technical details": report, round, submission, hold and event IDs unabbreviated.

`useLeadReport(reportId)`: `api.getProblemReport` + `api.listPauseCandidates` (lazily on first "Pause other tasks…") with stale-response discard; `reload()` returns the fresh view.

### Confirmations (`LeadConfirms.tsx`, each an `InlineConfirm` rendered directly below its intent; one open at a time)

- Close: title "Close report"; Textarea "Outcome for {reporter_label}" `rows={4}` hint "{reporter_label} sees this in the report."; message "Task {id} stays paused. Release it separately with Release pause." or "No task is paused by this report."; confirm "Close report"; action `resolve`.
- Release: title "Release pause"; checkboxes of active holds (`taskLabel` + "paused since …" + "Also paused by another report: stays paused" when `other_active_holds` non-empty), preselected when exactly one, or when `action === "resume"` (route) the reporter's task; Textarea "Reason" `rows={3}` hint "Recorded in the history. The reporter sees it."; confirm "Release pause" / "Release {n} pauses"; none selected → "Choose at least one task."; action `resume` with the selected ids.
- Pause other tasks: title "Pause other tasks"; group "Same text: {case_id}" (candidates with `same_text`), then `TextInput` "Search other tasks" filtering the rest by `case_id` prefix or `owner_label` substring; `paused_by_this_report` rows are listed with `aria-disabled` and "Already paused by this report"; the reporter's task (when not paused) carries "(reporter's task)"; Textarea "Reason shown to the task owners" `rows={3}` hint "They do not see this report."; confirm "Pause 1 task" / "Pause {n} tasks"; action `extend_hold`.
- Agree empty restart: title "Agree empty restart of Task {id}"; facts as spec (annotation vs translation review wording) with rounds from `current_round_ordinal` ("Round {current} is abandoned and kept; Round {current + 1} starts empty."; when null: "The current round is abandoned and kept; a new empty round starts."), never from the report's `round_ordinal`; "Final result stays: {label | None}."; Checkbox "I agreed this restart with {reporter_label}" (required, error "Confirm that you agreed the restart with {reporter_label}."); Textarea "Reason (becomes the outcome {reporter_label} sees)"; confirm `tone="danger"` "Restart with empty round"; action `restart` with `[report.assignment_id]`.
- Reopen: title "Reopen report"; Textarea "Reason" `rows={3}` hint "Recorded in the history. {reporter_label} sees it."; message "The report becomes open again. No task is paused again."; confirm "Reopen report"; action `reopen`.
- All: empty reason → "Enter a reason."; `request_id` reused for the same `[report_id, revision, action, reason, ids]` (Retry never applies twice); `busy` via `InlineConfirm busy`.
- Outcomes: `InlineMessage tone="success"` with `leadOutcome(...)`, focused (`tabIndex={-1}`), followed by link "Back to Documents"; call `recordDecision(projectKey, \`${report.case_id}:${report.language}\`)` when `documents` is set.
- Errors: `WORKFLOW_REVISION_CONFLICT` → `outcome={{ kind: "conflict", changedBy: newest event actor_label, changedAt: its created_at, onReview: reload keeping the reason }}` and `conflictMessage` "This report changed since you opened it. Nothing was saved." + newest `historyItems` sentence; `TASK_HELD` → `InlineMessage tone="error"` "Task {id} is also paused by another report. Nothing changed. Release that pause first." + "Open report" link to the first `other_active_holds` report; `ASSIGNMENT_NOT_FOUND` → "Task {n} is no longer available (revoked or moved). Nothing changed." and reload candidates; `RESTART_AGREEMENT_REQUIRED` → the checkbox error; network/500 → `{kind:"error", onRetry}`; 401 → `{kind:"session"}`.
- Load failure: `ErrorNotice` + "Retry" in place of the body; back link stays. `REPORT_NOT_FOUND` → `EmptyState title="Problem report not found"` with the back link.

### `InlineConfirm` conflict text

Use `conflictMessage` (CR-1, implemented in Documents U1). Do not edit `ui/InlineConfirm.tsx` or its test here.

### Steps

- [ ] Write `frontend/tests/problems/leadReportPage.test.tsx` (mock `api.getProblemReport`, `api.actOnProblemReport`, `api.listPauseCandidates`, `api.listDocumentRows`; fixtures from `tests/problems/fixtures.ts`):
  - structure: one `h1`, `h2`s "Current state", "Decide", "History"; back link is the first link and has href with `documents_decision=…` when `documents` is passed, else `case`/`language`.
  - state panel lines for: active hold; resumed by reporter with reason; resumed by lead; restarted; no record; "Also paused by another report" link; "None paused now".
  - intents availability per state (open with pause, open without pause, resolved with pause, withdrawn): `aria-disabled` + visible reason; unavailable activation announces the reason and opens nothing.
  - one confirm at a time; Escape/Cancel return focus to the intent button.
  - Close sends `resolve` with the outcome and shows "Report closed. Task 4 is still paused by this report; release it when work can continue."
  - Release preselects a single hold; `action="resume"` preselects the reporter task without sending; "Release 2 pauses" label; empty selection error.
  - Pause: same-text group first, search reveals other tasks, already-paused rows unavailable, label "Pause 2 tasks".
  - Restart: requires checkbox; danger confirm; `TASK_HELD` error text with "Open report".
  - Reopen available only when closed/withdrawn; sends `reopen`.
  - conflict keeps the typed reason after "Review again".
  - `recordDecision` called after success when `documents` is set (spy on `documents/visitState`).
  - restart confirm names the current round, not the reported one: fixture `round_ordinal: 2, current_round_ordinal: 3` → "Round 3 is abandoned and kept; Round 4 starts empty."; history shows the event's `abandoned_round_ordinal`.
- [ ] Run `npm --prefix frontend test -- tests/problems/leadReportPage.test.tsx tests/problemReportRoute.test.tsx --maxWorkers=4 --minWorkers=1`. Expected: FAIL.
- [ ] Implement; delete the `<Select>`-based form entirely.
- [ ] Run the two files and `tests/ui/inlineConfirm.test.tsx` (unchanged, must stay green), `npm --prefix frontend run typecheck`. Expected: PASS.

**Done checklist WP7:** no single "Apply report action"; five intents with consequences; InlineConfirm per intent; outcomes say what changed and what did not; restart confirm names the current round; back link restores the full Documents query.
**Commit point (later):** `frontend/src/tasks/ProblemReportDetail.tsx frontend/src/problems/Lead*.tsx frontend/src/problems/useLeadReport.ts frontend/tests/problems/leadReportPage.test.tsx frontend/tests/problemReportRoute.test.tsx frontend/tests/problemReports.test.tsx` / `feat(problems): lead report page with state panel and intent actions`

---

## WP7b: Non-lead answer on the report route (`App.tsx`)

**Goal:** Non-leads opening a report URL get "Problem report not found" instead of `NotFound noAccess`.

**Owns:** `frontend/src/App.tsx` (non-lead branch of `case 'projectProblemReport'` only), `frontend/tests/problemReportRoute.test.tsx` (second test only).
**Preconditions:** WP7 done; Documents E3 done (last Documents owner of `App.tsx`; check `grep -n "compare={route.compare}" frontend/src/App.tsx`). No other agent owns `App.tsx` meanwhile.

- [ ] Update the second test in `tests/problemReportRoute.test.tsx` to expect heading "Problem report not found" and a "My tasks" button that navigates to `{ name: "tasks" }`. Run it: Expected FAIL.
- [ ] In `case 'projectProblemReport'`, replace `<NotFound noAccess …/>` for non-leads by `<EmptyState title="Problem report not found"><Button onClick={() => go({ name: "tasks" })}>My tasks</Button></EmptyState>` (`tasks` is the `MyTasks` route name in `router.ts`). Leave the rest of the case as E2/WP7 left it.
- [ ] Run `npm --prefix frontend test -- tests/problemReportRoute.test.tsx tests/shell.test.tsx --maxWorkers=4 --minWorkers=1` and `npm --prefix frontend run typecheck`. Expected: PASS.

**Done checklist WP7b:** non-leads get "Problem report not found" with "My tasks"; no other `App.tsx` line changed.
**Commit point (later):** `frontend/src/App.tsx frontend/tests/problemReportRoute.test.tsx` / `feat(problems): non-leads get report not found`

---

## WP8: Documents "Problem reports (n)" (closed reports stay findable)

**Goal:** Spec "Lead flow > Entry points", bullet "Closed reports stay findable".

**Owns (after Documents B9 and DX are done and while no Documents WP owns these files):**
- Create `src/ontocurator/application/document_row_reports.py` (`load_row_reports(conn, pid, row_keys) -> dict[tuple[str, str], list[dict]]`, the per-row query and `title` rule)
- Modify `src/ontocurator/application/document_rows.py` (B6 file: one `RowFacts` field `row_reports` filled by `load_row_reports`; nothing else)
- Modify `src/ontocurator/application/document_row_page.py` (B7 file: copy `row_reports[(case, language)]` into each row dict as `problem_reports`; nothing else)
- Modify `src/ontocurator/api/document_row_routes.py` (B9 file: model `RowProblemReport`, field `DocumentRowView.problem_reports: list[RowProblemReport] = []`)
- Contract slot: regenerated `contracts/openapi.json`, `frontend/src/api/generated.ts` (Editor B4 and WP4 not running)
- Modify `frontend/src/documents/ExpandedRow.tsx` ("More" item only; not while Documents E4 runs)
- Create `tests/test_document_rows_problem_reports.py`, `frontend/tests/documents/expandedRowReports.test.tsx`

**May read:** Documents Tasks 2.2a (B6: `RowFacts`, `ReportFact`), 2.2b (B7: row dict), 2.4 (B9: models), 5.7 (DX: More section); `tests/document_rows_support.py`, `tests/test_document_rows_api.py`; `problems/labels.ts` (`reportTitle`, `reportStateBadge`).

- [ ] Backend test first (`tests/test_document_rows_problem_reports.py`, `pytest_plugins = ("test_assignment_round_open_api", "problem_report_team")`): Bob reports on doc-1, lead resolves it, Bob files a second report that he withdraws; the lead's Documents row for doc-1's `(case, language)` (use the Documents rows endpoint and query exactly as `tests/test_document_rows_api.py` does) has `problem_reports` newest first with `{report_id, title, reporter_label, created_at, state, active_hold_count}` and states `["withdrawn", "resolved"]`; `title` is the first line cut to 80 chars server-side (same rule as the client; word boundary + "…").
- [ ] Run it: Expected FAIL. Implement `load_row_reports`: one query per page for all reports of the page's rows (`ProblemReportRow` ⨝ state ⨝ assignment document ⨝ reporter pseudonym, active hold count via correlated count of active holds of the report); the three hook lines in the B6/B7/B9 files; `RowProblemReport` model with default `[]`.
- [ ] Regenerate contracts (`uv run python scripts/export_openapi.py`, `npm --prefix frontend run api:generate`), drift checks green.
- [ ] Frontend test first: the "More" section contains `<details>` "Problem reports (2)" listing lines "{title} · {reporter} · <time> · Report: Withdrawn · Paused tasks: 0 · Open report", "Open report" links to `projectProblemReport` with the current `documents` query; hidden when the list is empty.
- [ ] Implement in `ExpandedRow.tsx`; run `npm --prefix frontend test -- tests/documents/expandedRowReports.test.tsx tests/documents/expandedRow.test.tsx --maxWorkers=4 --minWorkers=1` and `uv run pytest tests/test_document_rows_problem_reports.py tests/test_document_rows_api.py tests/test_document_rows_page.py tests/test_document_rows_facts.py -q`; `uv run python scripts/export_openapi.py --check`; `npm --prefix frontend run api:check`. Expected: PASS.

**Done checklist WP8:** closed and withdrawn reports reachable from the row; no change to Documents' issue/bar logic; B6/B7/B9 files changed only by the hook lines.
**Commit point (later):** listed files / `feat(documents): list every problem report of a row`

---

## WP9: Browser verification (split into WP9a–WP9e)

**Goal:** Spec "Testing > Browser" plus withdraw and reopen; update the old report steps in existing specs. Every spec WP runs Playwright alone on the machine (`HPO_E2E_PORT=18781`), WP9b → WP9c → WP9d → WP9e in this order.

### WP9a: Fixture route

**Owns:** Create `tests/browser_problem_report_scenarios.py` (`register_problem_report_scenario_route(app)`, builders), `tests/test_browser_problem_report_fixture.py`, `frontend/browser/problemReportHelpers.ts` (`problemReportScenario(page, name)` POST helper; do not edit the shared `browser/helpers.ts`); Modify `tests/browser_server.py` (one import and one registration call only; not while Documents P1 or Editor F10 owns the file).
**May read:** `tests/browser_server.py` (`register_translation_review_scenario_route` pattern and its translation-review helpers), Documents `tests/browser_documents_scenarios.py` (registry pattern), `tests/test_browser_translation_review_fixture.py`.

- [ ] `POST /__test_problem_reports__?scenario=<name>` creates a fresh project `problems-{scenario}-{uuid8}` with real services only (`run_fixture_import`, `AssignmentService`, submission helpers, `FinalResultService`, `ProblemReportService` only where a scenario needs a pre-existing report). Users: lead `lead-0002`, annotators `ann-0004` (doc A de), `ann-0005` (doc A en), `ann-0006` (doc B de). Scenarios:
  - `base`: tasks only; returns `{project, users, tasks: {reporter, same_text, other_text}}`.
  - `final`: as `base`, plus a **selected final result** on the reporter's row (an earlier submitted round of another annotator selected via `FinalResultService.select`); returns `final: {submission_id, label_parts}`.
  - `translation`: a `translation_review` task of `ann-0004` with a saved draft text and form values; returns the task id and the draft text.
- [ ] Test first (`tests/test_browser_problem_report_fixture.py`, modelled on `tests/test_browser_translation_review_fixture.py`): each scenario returns its identities; for `final` the lead's Documents row (or the final-result API) names `final.submission_id`; for `translation` the task's draft text is stored. Run `uv run pytest tests/test_browser_problem_report_fixture.py -q`: FAIL, then implement, then PASS; ruff + mypy clean.

**Commit point (later):** `tests/browser_problem_report_scenarios.py tests/test_browser_problem_report_fixture.py tests/browser_server.py frontend/browser/problemReportHelpers.ts` / `test(browser): problem report fixture route`

### WP9b: Reporter scenarios

**Owns:** Create `frontend/browser/problem-reports-reporter.spec.ts`.
- [ ] Scenarios (each from a fresh `base` fixture):
  1. Reporter: "Report problem" → form → report → "Paused · 1 open" in toolbar → resume with "upsi" → lead page shows "Resumed by reporter (ann-0004)" and "upsi" → lead closes → reporter dialog shows "Report: Closed by lead-0002" and "Your task: Resumed by you".
  2. Withdraw: reporter withdraws an untouched report → "Report: Withdrawn", task active; lead reopens with a reason → reporter sees "Open" and no withdraw action, and the task stays active (reopen does not pause again).
  3. External lead action while the dialog is open: the lead releases the pause in a second browser context; the reporter's window gets focus (`page.bringToFront()` / dispatch `focus`) → dialog shows "Your task: Active" and the editor banner is gone without reload.
  4. Pause other tasks: same-text task (ann-0005) paused by the lead → ann-0005's editor banner shows only the lead's reason; reporter dialog contains neither "ann-0005" nor that reason.
- [ ] Run `HPO_E2E_PORT=18781 npm --prefix frontend run test:e2e -- problem-reports-reporter.spec.ts`. Expected: pass.

### WP9c: Lead and restart scenarios

**Owns:** Create `frontend/browser/problem-reports-lead.spec.ts`.
- [ ] Scenarios:
  1. (`base`) Close while paused → Documents shows "Problem report or paused task" for the row → "Resume task" → Release confirm preselected → release → Documents row has no issue; "Problem reports (1)" lists it as Closed.
  2. (`final`) Restart rejected while another report pauses the reporter task (error with "Open report"); succeeds after releasing that pause. Before and after the restart, the "Final result" line names the **same** submission (`final.submission_id`'s label, never "None"), and the restart confirm and outcome say the final result stays.
  3. (`base`) Restart, reopen, restart again: the second confirmation names the round created by the first restart (reported Round n: "Round n+1 is abandoned and kept; Round n+2 starts empty.") and the history shows both restarts with their actual abandoned rounds.
  4. (`translation`) Restart of a translation review: the history shows the disclosure "Translation draft kept from before the restart" with the archived draft text and form values; the reporter's editor opens with a fresh, empty draft.
  5. (`base`) Back link from the report page restores the full Documents query (`decision`, `open`, `page`).
- [ ] Run `HPO_E2E_PORT=18781 npm --prefix frontend run test:e2e -- problem-reports-lead.spec.ts`. Expected: pass.

### WP9d: Keyboard, accessibility and layout

**Owns:** Create `frontend/browser/problem-reports-a11y.spec.ts`. **Precondition:** CR-2 landed (see "Change requests").
- [ ] Checks (`base` fixture):
  1. Keyboard-only path through all five intents (Tab/Enter/Escape; focus returns to the trigger).
  2. Lead page at 320 px: `document.documentElement.scrollWidth <= 320`; Decide buttons stacked full width.
  3. Reporter dialog at 390×844: the dialog box is a full-height sheet (`getBoundingClientRect()`: width ≥ 390 − 2·16 − 1 and height ≥ 844 − 2·16 − 1, both edges inside the viewport); the footer "Close" (scoped to `.modal-actions`) is inside the viewport with a long report list; no horizontal scroll.
  4. axe-core on the dialog and the lead page: no violations; toolbar button accessible name contains "Report problem" and "Task paused".
- [ ] Run `HPO_E2E_PORT=18781 npm --prefix frontend run test:e2e -- problem-reports-a11y.spec.ts`. Expected: pass.

### WP9e: Existing specs

**Owns:** `frontend/browser/final-workflow.spec.ts` (report steps around lines 189-203 only; after Documents P7 and Quick WP-E/WP-H); `frontend/browser/quick-fixes.spec.ts` (problem-report lines only, if Quick WP-H created them).
- [ ] Update `final-workflow.spec.ts` report steps to: button `Report problem`, dialog `Problems with Task {id}` / `New problem report`, label `What is the problem?`, lead page intent "Agree empty restart…", checkbox "I agreed this restart with …", confirm "Restart with empty round".
- [ ] In `quick-fixes.spec.ts`, replace "My problem reports" / "Task problem reports" / "Close reports" by "Report problem" / "Problems with Task {id}" / footer "Close" (scoped to `.modal-actions`); keep the viewport assertion.
- [ ] Run `HPO_E2E_PORT=18781 npm --prefix frontend run test:e2e -- final-workflow.spec.ts quick-fixes.spec.ts`. Expected: pass.

**Done checklist WP9:** fixture test green; all three new specs and both updated specs green, run serially.
**Commit point (later):** `frontend/browser/problem-reports-reporter.spec.ts frontend/browser/problem-reports-lead.spec.ts frontend/browser/problem-reports-a11y.spec.ts frontend/browser/final-workflow.spec.ts frontend/browser/quick-fixes.spec.ts` / `test(browser): problem report reporter and lead flows`

---

## WP10: Cleanup and full gates

**Owns:** Delete `frontend/src/tasks/ReportHistory.tsx` (and any test importing it only).

- [ ] `grep -rnE "ReportHistory|Report a problem|My problem reports|Task problem reports|Apply report action|Reload my reports|Close reports" frontend/src frontend/tests frontend/browser` (Git Bash; `rg` is not installed there) returns no hits (except the accessible-name suffix "Report a problem with this task").
- [ ] `bash scripts/check.sh --only static` → pass.
- [ ] `bash scripts/check.sh --only frontend` → pass (uses the worker cap).
- [ ] `bash scripts/check.sh --only backend` → pass.
- [ ] `HPO_E2E_PORT=18781 bash scripts/check.sh --only browser` → pass (alone on the machine).

**Commit point (later):** `frontend/src/tasks/ReportHistory.tsx` (deleted) / `refactor: remove the old report history component`

---

## Self-review against the spec

| Spec item | WP |
|---|---|
| Toolbar entry states, accessible names, count load/refresh, no shortcut | WP5 (`toolbarEntry`), WP6 |
| Dialog parts 1–3, footer, auto-load, stale discard, initial focus | WP6 |
| New report form (rows 6, hint, consequence, empty submit, save failure gate, discard ask, success focus) | WP6 |
| Resume my task (confirm, remaining pauses, messages) | WP6, WP3 (`active_holds`) |
| History (creation item, sentence table, redaction, never synthesize, draft disclosure, restart rounds) | WP2, WP5, WP9c |
| Lead entry points (Documents issue lines owned by Documents; "Problem reports (n)") | Documents plan, WP8 |
| Lead page structure 1–7, back link | WP7, WP7b (+ Documents E2) |
| Intent actions, confirmations, outcome messages, errors | WP5, WP7 |
| State model incl. withdraw/reopen | WP1 |
| Keyboard/screen reader, narrow viewports | WP6, WP7, WP9d (Dialog sheet: CR-2 to Editor F1, verified in WP9d) |
| API changes (fields, GET by id, `?assignment_id=`, `active_holds`, Documents fields, passthrough) | WP2, WP3, WP4, WP8, Documents U3 |
| Contracts preserved (holds never lifted silently, reporter blind, every action with reason and actor, restart keeps the final selection and archived draft) | WP1, WP2 tests, WP9c |
| Resolved questions 1–6 | WP1 (1, 2), WP7 (3 label, 5 picker), WP2 (4), WP5/WP6 (6) |

## Review disposition

Codex review `ontocurator-reviews/2026-10-19-plan-problem-reports-codex.md` (8 findings, no P0). Each was checked against the code, the spec and the sibling plans before it was applied.

| # | Finding | Verified against | Disposition |
|---|---|---|---|
| 1 | P1 Restart confirmation/history can name the wrong abandoned round | `application/work_rounds.py` (`prior_id = assignment["active_round_id"]`, new round `predecessor_round_id = prior_id`); `application/problem_reports.py` (restart event stores only the new `round_id`) | Applied: view adds `current_round_id/ordinal`, events add `abandoned_round_id/ordinal` (deviation 9); WP2 test with two restarts separated by reopen on an old report; WP5 sentence and WP7 confirm use them; browser check in WP9c. |
| 2 | P1 Cross-plan serialization incomplete (Editor B4 contracts; `App.tsx` after Documents E3) | Editor plan B4 owns `openapi.json`, `generated.ts`, `client.ts`; Documents "Files shared": `App.tsx` U3 → D6 → E2 → E3 | Applied: "Cross-plan schedule" with one contract slot (B9 → Editor B4 → WP4 → WP8) and the `App.tsx` chain; the `App.tsx` edit moved to new WP7b after E3; `InlineConfirm` change turned into CR-1 to Documents U1 (exclusive ownership of shared primitives). |
| 3 | P1 Timeline import path `documents/Time.tsx` does not exist | Documents D1 owns `frontend/src/app/Time.tsx`, `app/submissionLabels.ts` | Applied: all imports use `../app/Time` and `../app/submissionLabels`; WP5 precondition check added. |
| 4 | P2 Quick's obsolete report test survives | Quick WP-B (`dialogFooters.test.tsx` third case) and WP-H (`quick-fixes.spec.ts` report lines) | Applied: WP6 owns and replaces the test case, WP9e the browser lines; preferred order Quick WP-B/WP-H first, otherwise CR-3 (Quick skips them); WP10 search extended. |
| 5 | P2 Focus refresh updates reports but leaves task status stale | `frontend/src/tasks/TaskEditor.tsx:146` (`onRefresh` is the only way the editor's assignment changes) | Applied: `useTaskReports` reloads assignment metadata with the reports on focus and dialog open under one stale-response counter, calls `onRefresh` only on change; unit test for external lead actions; browser scenario WP9b.3. |
| 6 | P2 Narrow-viewport sheet has no owner | Editor F1 CSS has only `max-height`, no mobile rule; spec "Narrow viewports" | Applied as CR-2 to Editor F1 (owner of `Dialog`/`.ui-dialog*`), dependency added for WP6/WP9d, geometry verified at 390×844 in WP9d. This plan does not edit the Dialog itself (exclusive ownership). |
| 7 | P2 Restart verification passes without a final result; no translation restart scenario | Original WP9 fixture had no selection | Applied: fixture scenarios `final` (real selected submission, identity asserted before/after restart) and `translation` (archived draft disclosure, fresh draft) in WP9a/WP9c. |
| 8 | P2 WP9 oversized | Original WP9 scope | Applied: split into WP9a (fixture module, one `browser_server.py` line), WP9b (reporter), WP9c (lead/restart), WP9d (keyboard/a11y/layout), WP9e (existing specs), run serially. |

No finding was rejected. User decisions kept unchanged: restricted withdrawal ("Withdrawn" only before any lead action), lead reopen without re-pausing, no extra confirmation on close, pause picker scoped to the report's text by default, reporter sees nothing about other tasks, label "Report problem".
