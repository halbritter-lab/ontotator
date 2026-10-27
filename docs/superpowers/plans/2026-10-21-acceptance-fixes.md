# Acceptance Fixes 2026-10-21 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the acceptance fixes of [2026-10-21-acceptance-fixes-design.md](../specs/2026-10-21-acceptance-fixes-design.md): row panel instead of the inline expansion, final panel W1 and consolidation start as one command (lead self-grant), editor prefill/latency/layout, creation defaults, guidelines action bar, and a dedicated consolidation view with grouped findings.

**Architecture:** A pure `groups()` in `domain/agreement.py` drives both the consolidation view and W1. Consolidation state lives in the consolidator's review draft: decisions carry an optional `ReviewDecision.consolidation` mark (no migration). New backend endpoints: consolidation read, resolve/annotate/reopen (workspace mutations) and `POST /projects/{key}/consolidations` (start command with self-grant). The frontend replaces `ExpandedRow` with a non-modal `RowPanel` aside and adds `frontend/src/consolidation/`.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2, PostgreSQL (pytest + xdist, testcontainers), pydantic 2; React 18, TypeScript, Vitest + Testing Library, Playwright + axe-core; `openapi-typescript` for `generated.ts`.

**Binding inputs:** the spec (decisions U1–U16, review items T1–T17 / X1–X21 referenced there), `DESIGN.md`, `PRODUCT.md`, [lead workflow spec](../specs/2026-10-20-lead-workflow-design.md) (D1 relaxed by U8), [documents overview spec](../specs/2026-10-21-documents-overview-redesign-design.md) (VD16, `panel=` route), mockups in `.superpowers/brainstorm/148565-1792589249/content/` (gitignored, read-only).

**Plan review applied** (`ontotator-reviews/2026-10-21-acceptance-fixes-plan-claude.md`, items 1–15) to the global rules and waves 2–5. Wave 1 E1a also: `consolidation_groups` takes `conn`; axis defaults like `findings_of`; one `content_sha256` helper (these were sent to the E1a agent directly). Wave 2 additionally relies on `consolidation_group_id(input_ids)` exported from `application/consolidation.py` (for B1's `flagged_group_id`); if E1a did not export it, the E1a review fix adds it before wave 2 starts.

---

## Global rules (every WP; an agent reads this section, "Shared contracts" and its WP block)

Worktree `C:/Users/jan-p/Development/ontocurator/.worktrees/acceptance-fixes` (Git Bash `/c/Users/jan-p/Development/ontocurator/.worktrees/acceptance-fixes`), branch `fix/acceptance-20261021`. All agents of a wave share this worktree. Line references were checked on `fd667c1`; re-check with `grep -n` and report drift instead of guessing.

1. **Ownership.** A WP writes only the files in its **Owns** list (tests included). Within a wave the Owns lists are disjoint. Need another file → stop and report. Never `git add -A`, `git add .`, `git stash`, `git reset`, `git checkout -- <file>`, `git clean`, never push.
2. **Commits.** The agent commits its own files only: `git add <owned paths>` then `git commit -m "<message>" -- <owned paths>` (the path list keeps a sibling's staged files out). If `.git/index.lock` exists, retry after 10 s. Conventional message (`feat(consolidation): …`), English, **no AI co-author trailer or "Generated with" line**. One or more commits per WP; report every SHA.
3. **TDD.** Write the listed failing tests, run them red, implement, run green, then the WP gate.
4. **WP gate (explicit paths).** `CHECK_PYTEST_WORKERS=4 CHECK_VITEST_WORKERS=3 bash scripts/check.sh --quick <owned paths>` (verified: `--quick` forwards to `scripts/check-affected.sh`, which accepts `[PATH...]`; with paths it runs the static checks plus only the tests affected by those paths and ignores `--base`). Do **not** use `--base main`: from wave 2 on it diffs `main...HEAD` and re-runs every earlier WP's suites plus siblings' uncommitted tests. List your Owns paths that exist (deleted files left out). The static part (lint, format, typecheck, contract drift) still sees siblings' uncommitted files: fix only failures in your Owns; report others with file names and rerun after the sibling's commit.
5. **Backend lock (16 GB RAM).** Never more than one backend suite at a time. Hold `build/backend.lock` for every pytest run against PostgreSQL and for **every gate whose path list contains `src/**.py` or `tests/*.py`**, including `tests/browser_server.py` (A1, B2, E2a). Pure-Python test files without a database (`tests/test_agreement_groups.py`) and gates over frontend-only paths need no lock. Playwright runs start PostgreSQL too (`tests/browser_server.py` → `pg_harness`): they hold only the Playwright lock, but never run one while your own backend suite runs.
6. **Playwright lock.** Only one Playwright run at a time across all agents: hold `build/playwright.lock`. `test:e2e` rebuilds the shared `frontend/dist`, so the build happens inside the lock. Command: `HPO_E2E_PORT=<your port> npm --prefix frontend run test:e2e -- <spec files>`. Ports: wave slot 1 → 18774, slot 2 → 18775, slot 3 → 18776, final phase → 18777.
7. **Lock protocol** (both locks). Use the **Bash tool** (Git Bash), never PowerShell, and absolute paths only (cwd resets between calls; Monitor has its own cwd). Acquire, run and release in one wrapper with `trap … EXIT`, so a failure or a background run still releases. The main session creates `/c/Users/jan-p/Development/ontocurator/.worktrees/acceptance-fixes/build/with-lock.sh` once before dispatching wave 2; agents only call it:

   ```bash
   #!/usr/bin/env bash
   # Usage: WP=<ID> bash /c/Users/jan-p/Development/ontocurator/.worktrees/acceptance-fixes/build/with-lock.sh <backend|playwright> <command...>
   set -u
   : "${WP:?set WP=<ID>}"
   root=/c/Users/jan-p/Development/ontocurator/.worktrees/acceptance-fixes
   lock="$root/build/$1.lock"
   shift
   mkdir -p "$root/build"
   until ( set -o noclobber; echo "$WP $(date -Iseconds)" > "$lock" ) 2>/dev/null; do
       echo "waiting for $lock (held by: $(cat "$lock" 2>/dev/null))"
       sleep 15
   done
   trap 'grep -q "^$WP " "$lock" 2>/dev/null && rm -f "$lock"' EXIT
   cd "$root" || exit 1
   "$@"
   exit $?
   ```

   Example: `WP=B1 CHECK_PYTEST_WORKERS=4 CHECK_VITEST_WORKERS=3 bash /c/…/build/with-lock.sh backend bash scripts/check.sh --quick <owned paths>`. Run every Playwright call and every call that may wait or exceed 10 min with `run_in_background: true` (you are notified on exit); never foreground `sleep`; never delete another agent's lock. A lock older than 45 min whose owner has reported is removed by the main session only.

8. **Contracts.** `contracts/openapi.json`, `frontend/src/api/generated.ts`, `frontend/src/api/client.ts`, `contracts/admin-error-codes.json`, `src/ontotator/domain/admin_error_codes.py`, `frontend/src/admin/errors.ts`, `src/ontotator/api/app.py` have **one owner per wave** (see "Shared-file chains"). Regenerate, never hand-edit: `uv run python scripts/export_openapi.py && npm --prefix frontend run api:generate`, and `uv run python scripts/export_admin_error_codes.py` after a catalog change. API changes are additive; new response fields have defaults. openapi-typescript makes non-null defaulted fields **required** in `generated.ts` (e.g. `guideline_withdrawn: boolean`), so every new field breaks typed test fixtures: the contract owner runs `npm --prefix frontend run typecheck` right after regenerating and fixes `frontend/tests/documents/fixtures.ts` (owned by E1a in wave 1, B1 in wave 2, B2 in wave 3; nobody else, A1 included, edits it). Any other typecheck break outside your Owns: stop and report.
9. **Frontend rules.** English copy verbatim from the spec; status never by colour alone; unavailable actions use `aria-disabled` + reason (existing `Button`), not `disabled`; icons from `frontend/src/ui/icons.tsx`; no colour literals outside `tokens.css`; shortcuts only through `useShortcut` (`frontend/src/ui/shortcuts.ts:85`).
10. **Evidence** (screenshots) only under `build/acceptance-fixes/evidence/` in the worktree; delete Playwright scratch output.
11. **Reviews.** WPs marked "Review: yes" get one read-only `superpowers:code-reviewer` pass after their commit, then one fix agent (effort medium). **Timing:** a WP's review and its fix land (committed) before the next wave is dispatched, because review fixes touch files that the next wave owns (E1a's fix touches B1/E1b files, A1's touches B2's, B1's touches E1b's contracts). If a fix cannot land in time, its open findings go verbatim into the dispatch prompt of the next WP that owns the affected files, and that WP fixes them (with tests) as part of its work. Others: no per-WP review.
12. **Hand-back** (report format): changed/created/deleted files; tests added/updated with counts (e.g. "pytest tests/test_agreement_groups.py: 24 passed"); gate command + result; Playwright specs + result; commit SHA(s); deviations, line drift, open risks. Max 250 words.

## Shared contracts

### Domain (E1a): `src/ontotator/domain/agreement.py`

```python
@dataclass(frozen=True)
class Finding:
    key: str
    layer_id: str
    term_id: str
    axes: Mapping[str, str]
    modifiers: frozenset[str]
    spans: tuple[Span, ...]
    order: int
    type_id: str = ""  # new; groups() bucket (layer, type, term)
    note: str | None = None  # new; compared by groups() only
    cues: tuple[Span, ...] = ()  # new; cue segments, compared with spans


GroupKind = Literal[
    "match", "values_differ", "span_differs", "notes_differ", "term_differs", "partial"
]


@dataclass(frozen=True)
class Group:
    members: Mapping[str, str]  # submission id -> finding key
    kinds: frozenset[GroupKind]  # {"match"} alone, or a set of the others
    differing_axes: tuple[
        str, ...
    ]  # sorted axis names whose values differ among members
    terms: tuple[str, ...]  # distinct term ids, in order of first member
    keep: str  # submission id of the default member (earliest in order)
    start: int | None  # first span start; None = spanless
    majority: Mapping[
        str, str
    ]  # axis -> value held by > half of >= 3 members (label only)


def groups(
    findings: Mapping[str, Sequence[Finding]], order: Sequence[str]
) -> tuple[Group, ...]: ...
```

`compare()` and `match()` keep their bucket `(layer_id, term_id)` and results.

### Review mark (E1a): `src/ontotator/domain/review.py`

```python
ConsolidationAction = Literal["auto", "keep", "choose", "keep_both", "leave_out"]


class ConsolidationMark(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: ConsolidationAction
    guidelines_unclear: bool = False
    content_sha256: str | None = (
        None  # hash of the created annotation content; None for leave_out
    )


class ReviewDecision(BaseModel):
    ...
    consolidation: ConsolidationMark | None = Field(
        default=None, exclude_if=lambda v: v is None
    )
```

### API

| Endpoint                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Owner WP | Client method (`client.ts`)                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/rounds/{round_id}/consolidation` → `ConsolidationView`                                                                                                                                                                                                                                                                                                                                                                                                      | E1a      | `getConsolidation(roundId)`                                                                                       |
| `FinalPanelView.all_match: bool = False`, `all_match_submission_id: str \| None = None`                                                                                                                                                                                                                                                                                                                                                                                  | E1a      | (existing `finalPanel`)                                                                                           |
| `POST /api/v1/projects/{key}/consolidations` → `StartConsolidationResponse {round: WorkRoundView, role_granted: bool}`                                                                                                                                                                                                                                                                                                                                                   | B1       | `startConsolidation(key, body)`                                                                                   |
| Row/panel reads: `DocumentRowView.flagged_unclear: int = 0`, `DocumentRowView.flagged_group_id: str \| None = None` (first flagged group, for `?group=`), `DocumentRowView.flagged_round_id: str \| None = None` (the submitted consolidation round of that group and of `flagged_unclear`, for `#/projects/{key}/consolidations/{round_id}?group=`; with several live chains the first chain's), `RowSubmissionView.kept_automatically: int = 0` (consolidation submissions: decisions with mark `auto`), facet group `flags` (value `guidelines_unclear`). The consolidator is the existing `RowSubmissionView.author: PersonRefView` of the `kind == "consolidation"` submission (no `consolidated_by` field) | B1       | (existing reads)                                                                                                  |
| `POST /api/v1/workspaces/{workspace_id}/consolidation-groups/{resolve,annotate,reopen}` (MutationEnvelope) → `Draft`                                                                                                                                                                                                                                                                                                                                                     | E1b      | `resolveConsolidationGroup`, `annotateConsolidationGroup`, `reopenConsolidationGroup` (`(workspaceId, envelope)`) |
| Error `CONSOLIDATION_GROUPS_OPEN` (409, `details.count`)                                                                                                                                                                                                                                                                                                                                                                                                                 | E1b      | message in `admin/errors.ts`                                                                                      |

`ConsolidationView` (pydantic, `api/consolidation_routes.py`):

```python
class ConsolidationPersonView(
    _View
):  # display name only for leads and the assignee (U8)
    person_id: str  # pseudonym, e.g. "ann-0004"
    label: str  # "Luc Martin (ann-0004)" or the pseudonym
    lane: int  # 1..4 (lane 4 also for every further person)


class ConsolidationMemberView(_View):
    input_id: str
    person_id: str
    annotation_id: str
    term_id: str
    term_label: str
    layer_id: str
    type_id: str
    axes: dict[str, str]
    spans: list[tuple[int, int]]
    cues: list[tuple[int, int]]
    note: str | None = None


class ConsolidationGroupView(_View):
    group_id: str  # sha256 of sorted input ids, first 16 hex
    kinds: list[str]
    differing_axes: list[str]
    majority: dict[str, str]
    keep_input_id: str
    start: int | None
    members: list[ConsolidationMemberView]
    state: Literal["open", "auto", "keep", "choose", "keep_both", "leave_out"]
    edited: bool = False
    note: str | None = None
    guidelines_unclear: bool = False
    annotation_ids: list[str] = []


class ConsolidationView(_View):
    round_id: str
    workspace_id: str | None  # None in read-only mode
    read_only: bool
    read_only_reason: str | None = (
        None  # "submitted", "input_withdrawn", "not_assigned"
    )
    case_id: str
    language: str
    document_version: int
    document_id: str
    people: list[ConsolidationPersonView]
    groups: list[ConsolidationGroupView]
    workflow_revision: int
```

Resolve payload (`envelope.payload`): `{input_ids: list[str] (min 1), action: "keep" | "choose" | "keep_both" | "leave_out", choice?: {term_id: str, span_from_input_id: str, axes: dict[str, str], note_from_input_id?: str | None}, note?: str, guidelines_unclear?: bool}`. Annotate: `{input_ids, note?: str | None, guidelines_unclear: bool}`. Reopen: `{input_ids}`. Deterministic annotation id: `"cons-" + sha256(f"{round_id}|{'|'.join(sorted(input_ids))}|{n}")[:16]` (`n` = 0, 1 for keep_both).

Start body: `{document_id: str, reviewer: str, source_submission_ids: list[str] (min 2), reason: str | None, confirm_language: bool = False, request_id: str, expected_workflow_revision: int | None}`.

### Frontend

- Route (B2): `{ name: "projectConsolidation"; key: string; roundId: string; group?: string }` ↔ `#/projects/{key}/consolidations/{roundId}?group=…` (the spec's route line was updated to match); `frontend/src/consolidation/ConsolidationScreen.tsx` exports `ConsolidationScreen({ projectKey, roundId, group?, readOnly? })`.
- Route (E2a): `task` route gets `view?: "editor"`; `TaskEditor` renders `ConsolidationScreen` for an active consolidation round unless `view === "editor"`.
- Documents query (A1): `panel`, plus `stage?: "review" | "annotation" | "final"`, `tab?: "activity" | "versions" | "details"`.
- Row panel (A1): `frontend/src/documents/RowPanel.tsx` exports `RowPanel({ row, rows, stage, tab, onNavigate, onClose, returnFocusRef, banner?, onBack?, … })` (`onBack` renders "Back" in the sheet, used by A3's "Open full details"); B2 fills the flags banner inside `RowPanel.tsx` in wave 3; the former `FinalPanel` content is `DecisionBlock` (`FinalPanel.tsx` keeps the file, exports `DecisionBlock`).

## Shared-file chains (one writer per wave)

| File(s)                                                                                                               | Writers (wave)                                                           |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `contracts/openapi.json`, `frontend/src/api/generated.ts`, `frontend/src/api/client.ts`, `src/ontotator/api/app.py` | E1a (1) → B1 (2) → E1b (3) → E2b (4, removal of `mergeRoundInputs` only) |
| `src/ontotator/domain/admin_error_codes.py`, `contracts/admin-error-codes.json`, `frontend/src/admin/errors.ts`     | B1 (2) → E1b (3)                                                         |
| `DESIGN.md`                                                                                                           | C2 (1) → A1 (2) → B2 (3) → E2a (4)                                       |
| `frontend/src/app/router.ts`, `frontend/src/App.tsx`                                                                  | A1 (2) → B2 (3) → E2a (4)                                                |
| `src/ontotator/application/document_row_panel.py`, `src/ontotator/api/document_row_routes.py`                     | E1a (1) → B1 (2)                                                         |
| `src/ontotator/application/consolidation.py`, `src/ontotator/api/consolidation_routes.py`                         | E1a (1) → E1b (3)                                                        |
| `frontend/src/documents/FinalPanel.tsx`, `finalPanelText.ts`, `RowCells.tsx`, `tests/documents/finalPanel.test.tsx`   | A1 (2) → B2 (3)                                                          |
| `frontend/src/app/CaseScreen.tsx`, `frontend/src/styles/screens/editor.css`, `frontend/tests/caseScreen.test.tsx`     | C2 (1) → E2b (4)                                                         |
| `frontend/tests/documents/fixtures.ts`                                                                                | E1a (1) → B1 (2) → B2 (3)                                                |
| `frontend/src/documents/RowPanel.tsx`, `frontend/tests/documents/rowPanel.test.tsx`                                   | A1 (2) → B2 (3, flags banner)                                            |
| `frontend/src/documents/historyLines.ts`, `frontend/tests/documents/historyLines.test.ts`                             | A1 (2) → B2 (3, "kept automatically (all matched)")                      |
| `frontend/src/documents/filterModel.ts`                                                                               | B2 (3)                                                                   |
| `tests/browser_server.py`                                                                                             | A1 (2) → B2 (3) → E2a (4)                                                |
| `frontend/browser/final-workflow.spec.ts`, `frontend/browser/documentsHelpers.ts`                                     | A1 (2) → B2 (3) → E2a (4)                                                |

## Waves

| Wave | Slot 1 (port 18774)                                       | Slot 2 (18775)           | Slot 3 (18776)     | Contract owner |
| ---- | --------------------------------------------------------- | ------------------------ | ------------------ | -------------- |
| 1    | E1a (L, backend, review)                                  | C1 (M, backend)          | C2 (S/M, frontend) | E1a            |
| 2    | B1 (L, backend, review)                                   | A1 (L, frontend, review) | —                  | B1             |
| 3    | E1b (L, backend, review)                                  | B2 (M, frontend)         | A3 (S, frontend)   | E1b            |
| 4    | E2a (L, frontend, review)                                 | E2b (S/M, frontend)      | D1 (S, frontend)   | E2b            |
| 5    | Final phase (main session + one reviewer + one fix agent) |                          |                    |                |

Dependencies: B1 ← E1a (panel file, `groups()` not needed); A1 ← nothing; E1b ← E1a; B2 ← A1, B1, E1a; A3 ← A1; E2a ← E1a, E1b, B2 (route stub); E2b ← E1a (read endpoint for names), C2 (CaseScreen); D1 ← nothing (placed in wave 4 to balance). Reviews and their fixes follow rule 11: a wave-n review fix is committed before wave n+1 is dispatched, otherwise its findings go to the next owner WP.

## Dispatch prompt template

```text
You implement WP <ID> of docs/superpowers/plans/2026-10-21-acceptance-fixes.md
in the worktree C:/Users/jan-p/Development/ontocurator/.worktrees/acceptance-fixes
(branch fix/acceptance-20261021; Git Bash path /c/Users/jan-p/Development/ontocurator/.worktrees/acceptance-fixes).
Read: "Global rules", "Shared contracts", "Shared-file chains" and the block "### <ID>" of the plan,
and the spec docs/superpowers/specs/2026-10-21-acceptance-fixes-design.md sections named in the block.
Use the Bash tool (Git Bash) with absolute paths for every shell command, never PowerShell.
Set WP=<ID> in every shell. Your Playwright port: HPO_E2E_PORT=<port>.
Rules: write only your Owns files; TDD; commit only your files with
`git commit -m "<msg>" -- <paths>` (no AI co-author trailer, no push); run PostgreSQL pytest,
backend gates and Playwright only through build/with-lock.sh (rules 5–7); gate
`CHECK_PYTEST_WORKERS=4 CHECK_VITEST_WORKERS=3 bash scripts/check.sh --quick <your owned paths>`
(rule 4; under the backend lock when the list has src/**.py or tests/*.py).
Contract owners: `npm --prefix frontend run typecheck` right after regenerating (rule 8).
Siblings working in parallel: <IDs + their Owns summary>. Do not touch their files.
Open review findings handed to you (rule 11): <findings or "none">.
Report (max 250 words): changed files; tests added/updated and run with pass counts; gate result;
Playwright specs and result; commit SHA(s); deviations and risks.
```

---

## WP blocks

### E1a — `groups()`, consolidation mark, consolidation read API, W1 data

**Goal:** pure grouping, the decision mark, `GET /rounds/{id}/consolidation` with the U8/U9 visibility, and `all_match` on the final panel. Spec: "WP-E Grouping", "Backend" (Persistence, People, Read), "WP-B Full agreement". **Size L. Review: yes (contract + authorization).**

**Owns:** `src/ontotator/domain/agreement.py`, `src/ontotator/domain/review.py`, `src/ontotator/application/consolidation.py` (new), `src/ontotator/api/consolidation_routes.py` (new), `src/ontotator/api/app.py`, `src/ontotator/application/document_row_panel.py`, `src/ontotator/api/document_row_routes.py`, contracts trio (`openapi.json`, `generated.ts`, `client.ts`), `tests/test_agreement_groups.py` (new), `tests/test_review_consolidation_mark.py` (new), `tests/test_consolidation_read_api.py` (new), `tests/test_agreement_domain.py`, `tests/test_final_panel_api.py` (W1 cases), `frontend/tests/documents/fixtures.ts` (`all_match` breaks `finalPanel()` typing).

**Tests to add:**

- `tests/test_agreement_groups.py` (pure, no DB). Helper `f(key, sub_order, term, spans, axes=None, type_id="phenotype", note=None, cues=())`. Cases, each asserting `kinds`, `members`, `keep`, order:
  1. `test_identical_two_is_match` — same term, axes, spans → `{"match"}`.
  2. `test_overlapping_not_identical_spans_is_span_differs` — (0,5) vs (2,5) → `{"span_differs"}`.
  3. `test_cue_difference_is_span_differs`.
  4. `test_axis_difference_lists_axes` — assertion present/absent → `{"values_differ"}`, `differing_axes == ("assertion",)`.
  5. `test_note_difference_is_notes_differ`.
  6. `test_span_and_value_combine` → `{"span_differs", "values_differ"}`.
  7. `test_partial_two_people` → `{"partial"}`, one member.
  8. `test_partial_two_of_three_with_value_difference` → `{"partial", "values_differ"}`.
  9. `test_term_merge_overlapping_incomplete_clusters` — s1 HP:A (0,8), s2 HP:B (3,8) → one group `{"term_differs"}`, `terms == ("HP:A", "HP:B")`.
  10. `test_term_merge_only_within_layer_and_type` — same span, other `type_id` → two groups.
  11. `test_term_merge_never_merges_complete_clusters` — s1/s2 both HP:A + s1 HP:B overlapping → HP:B stays `partial`.
  12. `test_term_merge_chain_picks_largest_overlap` — X(s1) (0,4), Y(s2) (2,10), Z(s1) (5,10) → Y joins Z (overlap 5 > 2); X stays `partial`.
  13. `test_term_merge_tie_takes_lowest_rank`.
  14. `test_term_merge_two_of_three_with_one_of_three` — s1,s2 HP:A (values differ) + s3 HP:B overlapping → `{"term_differs", "values_differ"}`.
  15. `test_union_of_member_spans_measures_overlap`.
  16. `test_spanless_groups_last_and_spanless_pair_matches`.
  17. `test_reading_order_by_first_span_start`.
  18. `test_majority_label_three_people` — `majority == {"assertion": "absent"}` for 2 of 3; empty for two people.
  19. `test_keep_is_earliest_in_order`.
  20. `test_zero_findings_gives_no_groups`.
  21. `test_compare_unchanged_with_type_and_note` — `compare()` result equal before/after adding `type_id`/`note`.
- `tests/test_review_consolidation_mark.py`: decision without mark dumps without the key (hash of an existing decision unchanged: compare `canonical_hash(d.model_dump())` with a literal hash computed on `fd667c1`); with mark round-trips; `extra="forbid"`.
- `tests/test_consolidation_read_api.py` (PostgreSQL; build the round with the helpers used in `tests/test_work_rounds.py` for consolidation rounds): assignee gets 200, `read_only == False`, people labels with display names (U8), states `open` for every group (no decisions yet); a non-assignee **lead** gets 404 `ROUND_NOT_FOUND` before submit, 200 `read_only == True` after submit; another annotator / a reviewer of the project → 404 `ROUND_NOT_FOUND`; a non-consolidation round → 404 `ROUND_NOT_FOUND`; group state from decisions with marks (insert decisions directly into the draft); no field contains internal ids other than `input_id`/`annotation_id`/`round_id`/`workspace_id`.
- W1 (in the existing `tests/test_final_panel_api.py`): two submissions with identical findings → `all_match True`, `all_match_submission_id` = earliest **eligible** (make the earliest one the lead's own so it is not eligible → the second); overlapping-but-different spans → `all_match False`; zero findings in both → `all_match True`; a consolidation covering both → `all_match False`.

**Steps:**

- [ ] Write `tests/test_agreement_groups.py`; run `uv run pytest tests/test_agreement_groups.py -q` → FAIL (ImportError `groups`).
- [ ] Implement in `agreement.py`: add the three `Finding` fields (defaults, at the end); `_Cluster` gets `keys: dict[str, str]` (submission → finding key) next to `members` (kept for `compare`). `groups()`:
  1. cluster per bucket `(layer_id, type_id, term_id)` with the existing `_assign` against each open cluster's first finding;
  2. merge pass: candidates = incomplete clusters; iterate in `rank` order; for each unmerged cluster find partners in the same `(layer_id, type_id)` with another term, disjoint submission set, overlap on the union of member spans ≥ 1 (both spanless counts as overlap 0 → no merge); pick max overlap then lowest rank; merged group keeps going while sets stay disjoint;
  3. kinds: complete + one term + equal axes/spans/cues/notes → `{"match"}`; else collect `partial` (incomplete), `term_differs` (> 1 term), `values_differ` (axes differ among members of the same term), `span_differs`, `notes_differ`;
  4. `keep` = member with the lowest index in `order`; `start` = min span start or `None`; sort by `(start is None, start, rank)`; `majority` only when ≥ 3 members.
- [ ] Run → PASS. Run `uv run pytest tests/test_agreement_domain.py -q` → PASS (compare unchanged). Commit `feat(agreement): consolidation groups`.
- [ ] Write `tests/test_review_consolidation_mark.py` (red), add `ConsolidationMark` + field to `domain/review.py` (green), commit `feat(review): consolidation mark on review decisions`.
- [ ] In `document_row_panel.py` `findings_of` (line 100): fill `type_id`, `note`, `cues` (from `evidence.mention.cue_segments`). Add `all_match`/`all_match_submission_id` to `final_panel()` using `groups()` over the compared eligible submissions (`eligible` flag, line ~404), not when VD16 label rule is `accept` through a consolidation; add the two fields to `FinalPanelView` (`document_row_routes.py:473`).
- [ ] Write `tests/test_consolidation_read_api.py` (red under `build/backend.lock`).
- [ ] Implement `application/consolidation.py`: `ConsolidationReader(repo).read(round_id, principal, access) -> ConsolidationView`; `consolidation_groups(conn, pid, round_id, profile, defaults) -> list[tuple[Group, dict[str, input_id]]]` (shared with E1b; runs on the caller's connection and reads `RoundInputRow` on `conn`, never through `Repository.get_round_input_inventory`, which opens its own transaction; fills axis defaults like `findings_of` (`with_defaults`, the same `axis_defaults` from `_profile()`); builds `Finding`s from the source snapshots, one "submission" per `source_submission_id`, order = inventory order); visibility: assignee (pseudonym of round owner == principal) → live draft; lead (`access` manages project) and round state submitted → submitted snapshot read-only; else `DomainError("ROUND_NOT_FOUND")` mapped to 404 exactly like `_visible_round` (`work_round_routes.py:47`). People via `application/people.person_refs(conn, ids, viewer_id=…, viewer_is_lead=True)` for assignee and lead. State per group from the draft's decisions on the members' target refs (open when any member lacks a decision); `edited` when `consolidated_content_sha256(annotation)` (exported, the one hash definition E1b also uses) ≠ `content_sha256`; export `consolidation_group_id(input_ids)` (the `group_id` formula) for B1.
- [ ] `api/consolidation_routes.py`: router with the GET; register in `app.py` next to `work_round_router`. Green.
- [ ] Regenerate contracts; add `getConsolidation` and types to `client.ts`. Commit `feat(consolidation): read endpoint and W1 agreement data`.
- [ ] Gate (backend lock). Hand back.

**Acceptance:** all listed tests green; `compare()` tests unchanged; contracts drift-free; read refusals all `ROUND_NOT_FOUND`.

### C1 — Creation defaults, pruning, seed, search warm-up

**Goal:** spec "WP-C" items 3 and 5 (U5, U15, T11, T12). **Size M. Review: no.**

**Owns:** `src/ontotator/projects/service.py`, `src/ontotator/ontology/registry.py`, `src/ontotator/application/workspace_opening.py`, `scripts/seed_t5_acceptance.py`, `tests/test_project_creation_defaults.py` (new), `tests/test_search_warmup.py` (new), `tests/test_seed_t5_acceptance.py`, `tests/test_project_settings_validation.py`.

**Tests to add:**

- `test_project_creation_defaults.py`: creating a project with the standard profile yields `creation_defaults[layer][type] == {"assertion": "present", "experiencer": "patient", "temporality": "current"}` for every editable layer/type that has the axis with the value allowed and not hidden; a profile without `temporality` gets only the other two; a hidden value is skipped; existing projects untouched (no migration); a profile/pin change before the first submission prunes now-invalid defaults (no `SETTINGS_INVALID`, `service.py:439`), after the first submission behaviour unchanged.
- `test_search_warmup.py`: workspace open with `get_search_conditions(...) is None` → no warm-up call and no conditions written; with conditions → one background warm-up through `_package_builds` (a second open while in flight reuses the future: assert the builder ran once); the warmed subset gives identical ranking to a cold query (same hits and scores for 3 queries on the test ontology).
- `test_seed_t5_acceptance.py`: the seed plan includes setting the creation defaults; idempotent on an existing project.

**Steps:**

- [ ] Measure first: on the :18210 stack (read-only; credentials in `.worktrees/manual-20261021/build/t5-acceptance/manual-test-20261021/runtime/credentials.json`, never copy them) time first and second term search in a German annotation task after `oc restart`; record numbers in the hand-back.
- [ ] Red tests for defaults; implement in `projects/service.py` `create` (line ~229): fill from `ontospan.default_axes()` per editable layer → type through `validate_creation_defaults` (line 82) to filter; pruning in the profile/pin change path (line ~439): drop entries failing validation before validating. Green.
- [ ] Red tests for warm-up; implement `OntologyRegistry.warm(project_key, languages)` in `registry.py`: returns at once when `get_search_conditions` is `None`; else submits to the existing single-flight `_package_builds` (line 71/373) and then builds the language subset via the existing translations subset LRU; call it from `WorkspaceOpeningService` open path in a daemon thread (no warm-up at worker start). Green.
- [ ] Seed: `scripts/seed_t5_acceptance.py` sets the same defaults through the project settings API (idempotent: skip when equal). Green.
- [ ] Commit `feat(projects): clinical creation defaults` and `perf(search): warm pinned search on workspace open`. Gate (backend lock). Hand back with the before/after timing.

**Acceptance:** tests green; ranking unchanged; no conditions written by warm-up; seed idempotent.

### C2 — Prefill always, no-hits language hint, 960 px layout

**Goal:** spec "WP-C" items 2 and 4 (U6, X20). **Size S/M. Review: no.**

**Owns:** `frontend/src/editor/termSearch.ts`, `frontend/src/editor/SearchPanel.tsx`, `frontend/src/app/CaseScreen.tsx`, `frontend/src/styles/screens/editor.css`, `frontend/tests/termSearch.test.ts`, `frontend/tests/searchPanel.test.tsx`, `frontend/tests/caseScreen.test.tsx`, `frontend/browser/editor-layout.spec.ts`, `DESIGN.md` (term-search row, line ~324).

**Tests (update/add):** `termSearch.test.ts` — `canPrefill` tests that expect `false` for non-searched languages now expect the prefill (replace `canPrefill` with `prefillHint(documentLanguage, active): string | null` returning `NO_PREFILL_HINT` or `null`; prefill always); `searchPanel.test.tsx` — German document, German not active: field prefilled and selected, hint visible, no-hits message starts with "Names are searched in English."; `caseScreen.test.tsx` — tests asserting an empty field for German documents are updated. Browser `editor-layout.spec.ts`: new test at 960 × 1000 (tree open/closed, guidelines drawer open/closed): first paragraph of the clinical text visible, text column ≥ 420 px or inspector stacked below.

**Steps:**

- [ ] On :18210 check finding 2 (German text, German HPO names present?) and note the result; if it is another bug, fix it here.
- [ ] Red unit tests → implement `termSearch.ts`/`SearchPanel.tsx`/`CaseScreen.tsx:1542` → green.
- [ ] Reproduce 960 px; red browser test (Playwright lock); fix `editor.css` (min text column 420 px; stack inspector; sidebar rail) → green.
- [ ] Update DESIGN.md term-search row (prefill always; hint; no-hits wording).
- [ ] Commit `fix(editor): always prefill the term search` and `fix(editor): keep the text readable at half width`. Gate. Hand back.

**Acceptance:** unit + `editor-layout.spec.ts` green; DESIGN.md row matches.

### B1 — Consolidation start command and lead reads

**Goal:** spec "WP-B" start command (T3, T17, U4), "After consolidation" label and "Flags" data (X4, X5). **Size L. Review: yes (authorization, contract).**

**Owns:** `src/ontotator/application/consolidation_start.py` (new), `src/ontotator/api/consolidation_start_routes.py` (new), `src/ontotator/api/app.py`, `src/ontotator/application/document_row_submissions.py`, `src/ontotator/application/document_row_facets.py`, `src/ontotator/application/document_row_page.py`, `src/ontotator/application/document_row_panel.py`, `src/ontotator/api/document_row_routes.py`, `src/ontotator/domain/admin_error_codes.py`, `contracts/*`, `frontend/src/api/generated.ts`, `frontend/src/api/client.ts`, `frontend/src/admin/errors.ts`, `frontend/tests/documents/fixtures.ts` (`flagged_unclear` and the other new defaulted fields break `row()` typing), `tests/test_consolidation_start_api.py` (new), `tests/test_document_rows_submissions.py`, `tests/test_document_rows_facets.py` (the `GROUPS` tuple gains `flags`), `tests/test_document_row_flags.py` (new).

**Tests:** `test_consolidation_start_api.py`:

- lead without Adjudicator role, reviewer = self → 200, `role_granted True`, membership row added, audit `project.member_add` with `{"roles": ["adjudicator"]}` (check the role literal in `authz`), audit `round.create`, **session still valid** (next request with the same cookie → 200), assignment + consolidation round exist, receipt stored;
- same `request_id` again → same response, no second round/grant;
- reviewer = another member with the role → no grant; without the role → 403/409 with the existing assignment error code (no grant for others);
- lead annotated an input → `ADJUDICATOR_IS_ANNOTATOR`, nothing written (role not granted either);
- missing language and `confirm_language False` → the existing language error; with `True` → 200;
- non-lead caller → refused like `createAssignments`;
- stale `expected_workflow_revision` → `WORKFLOW_REVISION_CONFLICT`; `expected_workflow_revision: null` with no active adjudication assignment of the reviewer → new assignment, 200; `null` while such an assignment exists → `WORKFLOW_REVISION_CONFLICT`, nothing written;
- lock order: members exclusive then project (assert via a concurrency test like `tests/test_project_admin_concurrency.py`, or code review note if impractical).

`test_document_row_flags.py`: submitted consolidation with 2 decisions `guidelines_unclear=True` → row `flagged_unclear == 2`, `flagged_group_id == consolidation_group_id(<first flagged group's input ids>)` (reading order), facet `flags=guidelines_unclear` counts the row, the `kind == "consolidation"` panel submission's `author` = consolidator `PersonRefView` (display name for the lead); 3 decisions with mark `auto` → that submission's `kept_automatically == 3`; no flags → 0, `flagged_group_id is None` and facet count 0. Existing `test_document_rows_submissions.py` expectations updated for the new default fields; `test_document_rows_facets.py` `GROUPS` gains `flags`.

**Steps:**

- [ ] Red tests (backend lock).
- [ ] `consolidation_start.py`: `ConsolidationStartService(db, now).start(actor, access, key, body)` in one transaction. Three code facts to follow:
  1. **Locks.** The members lock is an advisory lock, not row `FOR UPDATE`: take it exclusive, `pg_advisory_xact_lock(_lock_id("members", key))` (as `MembershipService._lock_project`, `authz/memberships.py:219`), not the shared variant `AssignmentService._prepare` uses (`assignments/service.py:~262`); then the project lock `pg_advisory_xact_lock(_lock_id("project", key))` (as `_prepare` and `work_rounds.py:300-304`); then the target as `AssignmentService._target` does. Re-check project management authority under the locks (as `_prepare`).
  2. **Assignment seam.** Not a public service call (those open their own transaction): call `AssignmentService._assign_locked(conn, actor, project, document_id, target, <adjudication task>, confirm_language)` (`assignments/service.py:572`), which expects the authority and target locks above to be held already; it keeps `ADJUDICATOR_IS_ANNOTATOR` (`:433-444`) and the language confirmation, so no checks are duplicated. If `reviewer == actor.username` and the role is missing, `grant_roles` (`authz/memberships.py:79`, no `revoke_user_sessions`) runs before `_assign_locked`, after the conflict checks that must refuse without granting (assert "nothing written" in tests).
  3. **Revision.** `WorkRoundService.create_in(conn, …, expected_workflow_revision: int, …)` (`work_rounds.py:421`) requires an `int`. `expected_workflow_revision=None` in the start body means "new assignment": no active adjudication assignment of the reviewer may exist (else `WORKFLOW_REVISION_CONFLICT`); after `_assign_locked` creates it, pass the fresh assignment's workflow revision to `create_in`. An `int` must equal the existing assignment's revision (else `WORKFLOW_REVISION_CONFLICT`) and is passed through.

  Then `create_in(conn, …, kind="consolidation", sources=source_submission_ids, lead=True, owner=<reviewer pseudonym>, …)`; receipt by `request_id`; audit `round.create`. Docstring states that an additive self-grant keeps the session (`current_access` re-reads per request).

- [ ] Route `POST /api/v1/projects/{key}/consolidations`; register in `app.py`. Green.
- [ ] Row reads: `flagged_unclear` (decisions of the submitted consolidation of the current version with `consolidation.guidelines_unclear`), `flagged_group_id` (first flagged group in reading order, via `consolidation_groups()` + `consolidation_group_id()` from `application/consolidation.py`), `kept_automatically` (decisions with mark `auto`) on consolidation submissions, facet group `flags` in `document_row_facets.py` (`FACET_GROUPS` line 23) + page filter param; the consolidator stays the existing `author` (no new field). Green.
- [ ] Regenerate contracts and the error catalog if a code was added; `npm --prefix frontend run typecheck` and fix `fixtures.ts`; add `startConsolidation` to `client.ts`. Commit `feat(consolidation): start command with lead self-assignment` and `feat(documents): consolidation flags and consolidator in row reads`. Gate (backend lock). Hand back.

**Acceptance:** tests green; session survives the self-grant; idempotent; contracts drift-free.

### A1 — Row panel

**Goal:** spec "WP-A" except the cards' stage popover (A3). U1, U10, U11, X2, X9–X11, X14 (Not planned, Accept as final… row label), X17, X19, T13 (`open=` compat), T15. **Size L. Review: yes.**

**Owns:** `frontend/src/documents/RowPanel.tsx` (new), `frontend/src/documents/StageStrip.tsx` (new), `frontend/src/documents/RowActivity.tsx` (new), `frontend/src/documents/ExpandedRow.tsx` (delete), `frontend/src/documents/FinalPanel.tsx`, `frontend/src/documents/useFinalPanel.ts`, `frontend/src/documents/RowCells.tsx`, `frontend/src/documents/DocumentsTable.tsx`, `frontend/src/documents/DocumentCards.tsx`, `frontend/src/documents/RowActions.tsx`, `frontend/src/documents/nextStepLabels.ts`, `frontend/src/documents/labels.ts`, `frontend/src/documents/historyLines.ts`, `frontend/src/admin/DocumentsPage.tsx`, `frontend/src/tasks/ProblemReportDetail.tsx` (writes `open:` at line 173 → `panel`), `frontend/src/app/router.ts`, `frontend/src/App.tsx` (only if needed for route params), `frontend/src/styles/index.css` (drops the `documents-expanded.css` import at line 10, adds `documents-panel.css`), `frontend/tests/ui/styles.test.ts` (line 47 lists `documents-expanded`), `frontend/src/styles/screens/documents-expanded.css` (delete), `frontend/src/styles/screens/documents-table.css`, `frontend/src/styles/screens/documents-cards.css`, `frontend/src/styles/screens/documents-panel.css` (new), `DESIGN.md`, `tests/browser_server.py`, tests below.

A1 does **not** edit `frontend/tests/documents/fixtures.ts` (B1 owns it in wave 2); build extra rows inside your own test files with spreads over the existing builders.

**Tests that break and must be rewritten (budget for this, T14):** `frontend/tests/documents/expandedRow.test.tsx` and `expandedRowReports.test.tsx` (delete; their cases move to new `frontend/tests/documents/rowPanel.test.tsx` and `rowPanelReports.test.tsx`), `frontend/tests/documentsPage.test.tsx` (expansion, `open=` and `panel=` tests), `documents/documentCards.test.tsx`, `documents/documentsTable.test.tsx`, `documents/a11y.test.tsx`, `documents/finalPanel.test.tsx` (panel frame → `DecisionBlock`), `documents/rowActions.test.tsx` ("Accept as final…"), `frontend/tests/leadConsolidation.test.tsx` (no "Start consolidation…" in the row), `frontend/tests/problemReportRoute.test.tsx` (`open=` link still opens the panel), `documents/historyLines.test.ts`, `documents/labels.test.ts`. Browser: `documents-table.spec.ts`, `documents-decisions.spec.ts`, `documents-walkthrough.spec.ts`, `documents-a11y.spec.ts`, `documents-overview.spec.ts`, `documents-overview-a11y.spec.ts`, `final-workflow.spec.ts`, `lead-workflow.spec.ts`, `lead-workflow-a11y.spec.ts`, `problem-reports-lead.spec.ts`, `problem-reports-a11y.spec.ts`, helpers `documentsHelpers.ts`, `documentsOverviewHelpers.ts`, `leadWorkflowHelpers.ts` (find all with `grep -rlnE "expanded|ExpandedRow|History|Start consolidation|Accept result" frontend/browser frontend/tests`).

**New unit tests (`rowPanel.test.tsx`):** text-name button named "Details, case-107 · de" opens the panel unfiltered, focus on the `h2`; stage cell named "Annotation: 0 of 2 submitted. Show history, case-108 · de" opens filtered (chip, "Show all stages"); `aside` with accessible name "Details, case-107 · de", no `inert` on the page, no opacity class on rows, active row marked; clicking another row's stage cell switches the panel; Esc with focus in the table does nothing, Esc inside closes and returns focus to the opener; J/K move (via `useShortcut`, not while typing in the search field), first/last row `aria-disabled` + status "First row"/"Last row", group rows skipped; header updates at once, body "Loading case-109 · de…", polite status; unsaved decision input → "Discard your unsaved choice?"; empty Activity "Nothing has happened yet.", filtered "No annotation activity yet."; route `panel`, `stage`, `tab` round-trip; legacy `open=` opens the panel; not-planned row "Not planned" + "Plan…"; filter popover open + Esc closes only the popover; "?" help lists J/K. Cards: "Details" button opens the sheet.

**Browser (Playwright lock, port 18775):** new test in `documents-table.spec.ts`: first row bounding box unchanged after open/close; scenario click counts S1, S2, S9 (1 + 9 × Next).

**Steps:**

- [ ] Rewrite/red unit tests listed above.
- [ ] Router: extend `ProjectDocumentsQuery` with `stage`, `tab` (keys list line ~57), map legacy `open` to `panel` on parse.
- [ ] `RowPanel.tsx`: `aside` (`aria-labelledby` its `h2`, region "Details, …"), fixed right below the shell header, width `min(480px, 45vw)`, full-screen sheet below 700 px (`useMediaQuery`); stage strip; `DecisionBlock` from `FinalPanel.tsx`; banner slot (problem reports; flags banner left for B2, which owns `RowPanel.tsx` in wave 3: render `props.banner` children); optional `onBack` renders "Back" in the sheet (for A3); tabs Activity/Versions/Details (`historyLines` with stage tags, admin actions per stage, `TextVersions`, details). J/K with `useShortcut(["j"], …)`/`["k"]` scoped to the Documents screen; Esc via `useShortcut("Escape", …, { root: panelRef })` registered after the filter popover's.
- [ ] Remove `ExpandedRow`, `HistoryToggle`, `ExpandedRowLoader`, `documents-expanded.css`; stage cells become buttons with the dotted status underline (`border-strong`), solid accent on hover/focus; name link + "Open in editor, …"; row action label "Accept as final…"; "Not planned" wording in `labels.ts`.
- [ ] Unit tests green; fix the listed browser specs and helpers; run them in two batches under the Playwright lock.
- [ ] DESIGN.md: replace the `Dialog variant="side"` usage note ("Used by the Documents final-result panel") and the Documents paragraph ("history … sit in the ▸ expansion", "final-result choice opens a `Dialog variant="side"`") with the row panel (non-modal `aside`, no dimming, width, keys, entry points, stage-cell underline).
- [ ] Commits `feat(documents): row panel replaces the inline expansion` (+ test commits as fit). Gate with your owned paths under the backend lock (the list contains `tests/browser_server.py`). Hand back.

**Acceptance:** spec WP-A acceptance; no `inert`/opacity; all listed tests green.

### E1b — Resolve, annotate, reopen, automatic take-over, submit gating

**Goal:** spec "WP-E Backend" (Resolve, Annotate, Reopen, Automatic take-over, Submit), T8–T10, U14, U16. **Size L. Review: yes (authorization, contract, submission integrity).**

**Owns:** `src/ontotator/application/consolidation.py`, `src/ontotator/application/consolidation_resolve.py` (new), `src/ontotator/api/consolidation_routes.py`, `src/ontotator/api/app.py`, `src/ontotator/application/work_rounds.py`, `src/ontotator/application/submissions.py`, `src/ontotator/domain/admin_error_codes.py`, contracts trio, `contracts/admin-error-codes.json`, `frontend/src/admin/errors.ts`, `tests/test_consolidation_resolve_api.py` (new), `tests/test_consolidation_resolve_validation.py` (new), `tests/test_consolidation_auto_take_over.py` (new), `tests/test_consolidation_submit_gating.py` (new), `tests/test_work_rounds.py` (only merge-inputs regressions), `tests/test_final_human_export.py` (only if provenance assertions change).

**Tests:**

- resolve: `keep` on a partial group → one annotation `cons-…` with `provenance.method == "merged"`, `source_refs == ["round-input:<id>"]`, decisions `changed` with mark `keep` and `content_sha256`; `choose` with axes from two people → annotation axes as chosen; `keep_both` on term_differs → two annotations (`n` 0 and 1); `leave_out` → reject decisions only, mark `leave_out`; repeated identical resolve → same ids (idempotent, no duplicate); input ids from another round → `ROUND_INPUT_INVALID`; non-assignee workspace → existing workspace refusal; `checked_layer_ids` cleared like merge; the annotation's `content_sha256` equals `consolidated_content_sha256(annotation)` (E1a helper, no second hash definition).
- resolve validation (`tests/test_consolidation_resolve_validation.py`): `input_ids` must equal exactly one group's member set (a subset, a superset and ids spanning two groups → `ROUND_INPUT_INVALID`, nothing written); `keep_both` only on a group with kind `term_differs` (else refused); `choice.term_id` must be one of the group's terms or another valid term of the span member's layer ("Other term…"; layer and type always come from the span member; unknown/obsolete or another layer's term → refused; an alternative id is stored as its canonical `term_id`, checked before the draft lock); `choice.span_from_input_id`/`note_from_input_id` must be members of the group.
- annotate: sets note/flag on an `auto` group without changing annotations.
- annotate: the group note lives on the decisions, never on the annotation, so annotate leaves every `content_sha256` valid and the group does not read `edited` (E1a review item 9).
- reopen: deletes the group's annotations and decisions → state `open`; reopen of an `edited` group also works (warning is frontend).
- editor: editing a `cons-…` annotation keeps the marked decisions (pointed at the new version) → `edited: true`, submit works without reopening; deleting it → `open`.
- auto take-over: starting a consolidation (both the B1 command and the old `POST /assignments/{id}/rounds` path) seeds every `match` group with the result of `keep` (`cons-…` annotation, merged provenance, `changed` decisions) and mark `auto`, `reviewer_id` = consolidator pseudonym, one edit event (its user is the caller who starts the round); calling the seeding twice changes nothing; a round started before this change (no decisions) reads all groups `open`.
- submit gating: submit with an open group → 409 `CONSOLIDATION_GROUPS_OPEN`, `details.count == n`; all resolved + `document_checked` → 200; `AXIS_CONFIRMATION_WARNING` path unchanged; ordinary rounds unaffected.
- merge-inputs endpoint regression in `test_work_rounds.py` still green (U16).

**Steps:**

- [ ] Red tests (backend lock).
- [ ] Extract the annotation/decision building of `MergeRoundInputsService.merge` (`work_rounds.py:1075`) into `consolidation_resolve.py` helpers used by both merge and resolve (merge behaviour unchanged).
- [ ] Resolve/annotate/reopen as draft mutations (same `run_mutation` pattern as `merge-inputs`, `work_round_routes.py:290`) in `consolidation_routes.py`; deterministic ids per "Shared contracts".
- [ ] Auto take-over in `create_in` right after `_create_draft` for kind `consolidation`: `consolidation_groups(conn, pid, round_id, profile, defaults)` from E1a on the caller's connection (it reads `RoundInputRow` on `conn`; `Repository.get_round_input_inventory` would open its own transaction and see no inputs), marks carry `content_sha256 = consolidated_content_sha256(annotation)`; one edit event.
- [ ] Gating in `submissions.py` (near line 206) for consolidation rounds; add `CONSOLIDATION_GROUPS_OPEN` to the catalog + `errors.ts` message "Resolve the open groups first ({count} open).".
- [ ] Regenerate contracts and catalog; `npm --prefix frontend run typecheck` (a break in `fixtures.ts`, owned by B2 in wave 3 → report); client methods. Commits `feat(consolidation): resolve, annotate and reopen groups`, `feat(consolidation): keep matching findings automatically`, `feat(submissions): refuse consolidation submit with open groups`. Gate (backend lock). Hand back.

**Acceptance:** tests green; merge-inputs regression green; contracts drift-free.

### B2 — Decision block: W1, Consolidate…, launcher, flags UI, consolidation route stub

**Goal:** spec "WP-B" frontend (findings 7, 8, W1, X4, X5, X14, X3 "Open result"). **Size M. Review: no.**

**Owns:** `frontend/src/documents/FinalPanel.tsx`, `frontend/src/documents/finalPanelText.ts`, `frontend/src/documents/FinalConfirm.tsx`, `frontend/src/documents/RowCells.tsx`, `frontend/src/documents/RowPanel.tsx` (flags banner), `frontend/src/documents/historyLines.ts` (Activity line), `frontend/src/documents/filterModel.ts`, `frontend/src/documents/FilterPopover.tsx`, `frontend/src/variants/ConsolidationLauncher.tsx`, `frontend/tests/documents/fixtures.ts`, `frontend/tests/documents/rowPanel.test.tsx`, `frontend/tests/documents/historyLines.test.ts`, `frontend/src/app/router.ts`, `frontend/src/App.tsx`, `frontend/src/consolidation/ConsolidationScreen.tsx` (new stub), `DESIGN.md` (Documents final decision paragraph), `tests/browser_server.py`, `tests/browser_documents_scenarios_decisions.py`, `frontend/tests/documents/finalPanel.test.tsx`, `frontend/tests/documents/finalConfirm.test.tsx`, `frontend/tests/documents/filterModel.test.ts`, `frontend/tests/documents/filterPopover.test.tsx`, `frontend/tests/leadConsolidation.test.tsx`, `frontend/tests/router.test.ts` (or the existing router test file; check with `grep -l parseRoute frontend/tests`), `frontend/browser/final-workflow.spec.ts`, `frontend/browser/documentsHelpers.ts`.

**Tests:** `finalPanel.test.tsx` — `all_match` with 2 submissions: "All findings match (2 of 2)", primary "Accept as final", confirm text "Both submissions contain the same findings. Accept them as the final result?", "Open result" before "Accept as final", selects `all_match_submission_id`, submissions under "Show submissions"; zero findings: "Both submissions have no findings"; 3 submissions: "All 3 submissions…", "No submission has findings"; Consolidate… secondary with hint "Resolve the 2 differences together", primary when not full agreement and nothing preselected; "Consolidate…" is offered only with ≥ 2 **eligible** submissions (regression for the en-source bug: 2 submissions of which 1 is not eligible, e.g. the lead's own or a source-language submission → no "Consolidate…"); after consolidation: "Consolidated by Ana Weber" (from the `kind == "consolidation"` submission's `author`), preselected, W1 hidden, "Open consolidation" link to `#/projects/{key}/consolidations/{roundId}`. `rowPanel.test.tsx` — flags banner "1 finding flagged: guidelines unclear · Open" links to `#/projects/{key}/consolidations/{roundId}?group=<flagged_group_id>`; without `flagged_group_id` the link has no `group`; no banner when `flagged_unclear == 0`. `historyLines.test.ts` — a consolidation submission with `kept_automatically == 4` yields an Activity line containing "4 kept automatically (all matched)"; with 0 the phrase is absent. `leadConsolidation.test.tsx` — launcher lists "You (Mia Kühn)" first, then adjudicators; choosing self shows "You will get the Adjudicator role for this project."; own annotation → disabled "You annotated this text"; other annotator → "Luc Martin annotated this text"; no adjudicator → note with Settings → Members link; start calls `startConsolidation` once (no `createAssignments`/`startWorkRound`). Final cell second line "1 flagged". Filter facet "Flagged: guidelines unclear"; `filterModel.test.ts` expects "Not planned" (was "Not in plan", `filterModel.ts:36` and `:75`). Router: `projectConsolidation` parse/href round-trip.

**Browser (port 18775/18776 per slot):** `final-workflow.spec.ts`: lead without Adjudicator role starts consolidation as "You" (role granted, still logged in), W1 accept on an all-match scenario; scenario builders in `tests/browser_documents_scenarios_decisions.py` (+ fixture test `tests/test_browser_documents_fixture_decisions.py` if it asserts scenario lists — then add it to Owns and report).

**Steps:** red tests → router stub + `ConsolidationScreen` stub ("Loading consolidation…", replaced by E2a) → decision block changes (incl. the ≥ 2 eligible rule for "Consolidate…") → launcher on `startConsolidation` → flags UI (Final cell, facet, banner in `RowPanel.tsx` with `flagged_group_id`) → Activity line "kept automatically (all matched)" in `historyLines.ts` → "Not in plan" → "Not planned" in `filterModel.ts` (both labels) → green → browser under lock → DESIGN.md paragraph → commits `feat(documents): accept full agreement in one click`, `feat(documents): lead can consolidate without the role`. Gate with your owned paths under the backend lock (the list contains `tests/browser_server.py`). Hand back.

**Acceptance:** tests green; launcher makes one request; spec WP-B copy exact.

### A3 — Cards below 700 px: stage popover

**Goal:** spec "WP-A" "Below 700 px": stage cell popover with the stage's last 3 events, its admin actions and "Open full details". **Size S. Review: no.**

**Owns:** `frontend/src/documents/DocumentCards.tsx`, `frontend/src/documents/StagePopover.tsx` (new), `frontend/src/styles/screens/documents-cards.css`, `frontend/tests/documents/documentCards.test.tsx`, `frontend/tests/documents/stagePopover.test.tsx` (new), `frontend/browser/documents-overview-a11y.spec.ts`.

**Tests:** popover (`ui/Popover`) anchored to the stage cell: 3 newest events of that stage, admin actions as in the panel, "Open full details" opens the sheet with Back; Escape returns focus to the cell; 320 px browser check in `documents-overview-a11y.spec.ts` (axe clean).

**Steps:** red → implement → green → browser under lock → commit `feat(documents): stage popover on cards` → gate → hand back.

### E2a — Consolidation view

**Goal:** spec "WP-E Frontend" (all bullets except the editor sidebar names and the `MergeInputs` removal), U11–U14, X1, X3, X6–X8, X12–X14, X16, X18, X21. **Size L. Review: yes.**

**Owns:** `frontend/src/consolidation/*` (`ConsolidationScreen.tsx`, `TextPane.tsx`, `GroupList.tsx`, `GroupCard.tsx`, `SubmitBar.tsx`, `SummaryDialog.tsx`, `useConsolidation.ts`, `lanes.ts`, `consolidationText.ts`, `consolidation.css`), `frontend/src/tasks/TaskEditor.tsx`, `frontend/src/tasks/MyTasks.tsx` (only if the task link needs a change), `frontend/src/app/router.ts`, `frontend/src/App.tsx`, `DESIGN.md` (new "Consolidation view" entry), `tests/browser_server.py`, `tests/browser_consolidation_scenarios.py` (new), `tests/test_browser_consolidation_fixture.py` (new), `frontend/tests/consolidation/*.test.tsx` (new), `frontend/browser/consolidation.spec.ts` (new), `frontend/browser/consolidation-a11y.spec.ts` (new), `frontend/browser/final-workflow.spec.ts`.

**Tests (unit):** `lanes.test.ts` — lane per person in order, 5 people → lane 4 "+2"; `groupCard.test.tsx` — value group with two axes resolves only after both choices, then collapses to "Hypotonia ✓ absent (Tom Reis) · Change" and opens the next open group; chips "absent · Tom Reis"; partial copy "Luc Martin, Ana Weber marked this · Tom Reis has nothing here" with "Keep Luc Martin's finding" / "Leave out"; majority label "2 of 3", nothing preselected; match reopened offers Keep / Leave out / Edit values… / Other term…; "Guidelines unclear here" on any group calls annotate; Undo toast + Ctrl+Z reopens; failed resolve keeps the group open with Retry; conflict shows `InlineConfirm` conflict outcome; `screen.test.tsx` — banner "4 findings matched and were kept automatically. Check them in the text." with list expanded when ≤ 3; J/K via `useShortcut` (not in the note field), "?" lists them; Submit "Submit · 4 open" `aria-disabled` with reason and "Next open group"; summary "8 decisions → 7 findings: 4 kept automatically (all matched) · 2 decided · 1 kept from Luc Martin · 1 left out · 1 note · 1 flagged"; submit sends `document_checked: true`, handles `AXIS_CONFIRMATION_WARNING`; after submit "Next task: …" / "Back to my tasks"; read-only mode (lead) has no actions and opens `group` from the route; layout switches at 1100/700 px (`useMediaQuery`), "Hide text"; under 700 px each group shows a snippet; no internal ids rendered (HPO codes shown); "Edit in editor…" navigates to the task route with `view: "editor"`; edited group shows "edited in editor" and reopen asks "Reopening drops your edit from the editor."; scroll into view only when off-screen, `behavior: "auto"` under reduced motion; "Add finding" (spec "WP-E Frontend"): selecting text in the text pane offers "Add finding", which opens the term search popover; choosing a term saves the annotation with the creation-default axes through the existing draft save (assert one save call with the selected span and term) and the new finding is shown in the text.

**Browser (port 18774):** `consolidation.spec.ts` — the spec's 8-group example: 6 clicks to submitted, keyboard-only run; lead without Adjudicator role → consolidates → submits → accepts final (end-to-end, uses B1/B2); `consolidation-a11y.spec.ts` axe at 1280, 900, 360 px. Scenario builder `tests/browser_consolidation_scenarios.py` (two annotators with 8 designed groups) registered in `browser_server.py`, fixture test in `tests/test_browser_consolidation_fixture.py` (backend lock).

**Note (E1b review):** while an input is withdrawn the view is read-only (`read_only_reason: "input_withdrawn"`), but the group commands are still accepted by the backend (as merge-inputs); the view must not offer any action then.

**Steps:** red unit tests → `useConsolidation` (load, resolve/annotate/reopen with MutationEnvelope, conflict/error states) → text pane with lanes → group list/cards → submit bar + summary → TaskEditor switch + `task.view` route → green → scenario builder + browser specs under locks → DESIGN.md entry (lanes, layout, keys) → commits `feat(consolidation): consolidation view` (+ test commits) → gate with your owned paths under the backend lock (the list contains `tests/*.py`) → hand back. The Activity line "kept automatically (all matched)" is B2's (wave 3), not E2a's.

**Acceptance:** spec WP-E acceptance; all tests green.

### E2b — Editor consolidation mode: names, MergeInputs removal

**Goal:** finding 11 (names per entry in the editor's consolidation mode, U8), U16 frontend removal, "Back to consolidation" link. **Size S/M. Review: no.**

**Owns:** `frontend/src/app/CaseScreen.tsx`, `frontend/src/tasks/MergeInputs.tsx` (delete), `frontend/tests/mergeInputs.test.tsx` (delete), `frontend/src/styles/screens/editor.css` (merge CSS only), `frontend/src/api/client.ts` (remove `mergeRoundInputs` only; no regeneration needed), `frontend/tests/caseScreen.test.tsx`, `frontend/tests/consolidationEditor.test.tsx` (new), `frontend/browser/review-flow.spec.ts` (only if it uses the merge panel).

**Tests:** `consolidationEditor.test.tsx` — in a consolidation round the sidebar entries show "Luc Martin (ann-0004)" (from `getConsolidation`), no "Merge overlapping submitted findings" panel, header link "Back to consolidation" to the task route without `view`; `caseScreen.test.tsx` merge assertions removed.

**Steps:** red → implement → green → `grep -rn "mergeRoundInputs\|MergeInputs\|merge-inputs" frontend/src frontend/tests` empty → commit `refactor(editor): names in consolidation mode, drop the merge panel` → gate → hand back.

### D1 — Guidelines action bar

**Goal:** spec "WP-D". **Size S. Review: no.**

**Owns:** `frontend/src/admin/GuidelinesSection.tsx`, `frontend/src/guidelines/guidelines.css`, `frontend/tests/guidelinesSettings.test.tsx`, `frontend/browser/guidelines.spec.ts`.

**Tests:** unit — order in the publish form: file + note inputs, then "Publish as vN" (primary) and "Discard", then facts, then preview; browser — at 1280 × 800 with a long preview, "Publish as v2" is in the viewport without scrolling and stays visible (sticky) after scrolling the preview.

**Steps:** red → implement → green → browser under lock → commit `fix(guidelines): publish actions above the preview` → gate → hand back.

## Final phase (wave 5, main session)

- [ ] Wait until every WP and every flagged review fix is committed; `git status` clean; remove stale locks.
- [ ] One `superpowers:code-reviewer` pass over `git diff main...fix/acceptance-20261021` against the spec (focus: authorization of the new endpoints, U8 scope, deterministic ids, submit gating, a11y of the row panel and the consolidation view, contract additivity). Findings to `C:/Users/jan-p/Development/ontocurator-reviews/2026-10-21-acceptance-fixes-branch-claude.md`.
- [ ] One fix agent (effort medium) applies the findings, TDD, commits.
- [ ] Full gate alone on the machine: `CHECK_PYTEST_WORKERS=4 CHECK_VITEST_WORKERS=3 HPO_E2E_PORT=18777 bash scripts/check.sh` (no `CHECK_CONTAINERS`; container checks need `GITHUB_TOKEN_FILE` and are skipped). Fix failures through the fix agent.
- [ ] Rebuild the embedded bundle: `npm --prefix frontend run build`; replace `src/ontotator/web/index.html` and the `index-*.js`/`index-*.css` in `src/ontotator/web/assets/` with `frontend/dist/` (remove the superseded `index-*` files; keep fonts unless dist changed them); `uv run python scripts/check_wheel.py` (or `bash scripts/check.sh --only static`); commit `build: update embedded frontend bundle`.
- [ ] Fast-forward main: `git -C C:/Users/jan-p/Development/ontocurator merge --ff-only fix/acceptance-20261021` from the main checkout (on `main`, clean). No push.
- [ ] Rebuild the :18210 stack (compose project `ontotator-t5-acceptance-manual-20261021`, keep volumes; prep dir `C:/Users/jan-p/Development/ontocurator/.worktrees/manual-20261021/build/t5-acceptance/manual-test-20261021`; all paths absolute):
  1. `git -C C:/Users/jan-p/Development/ontocurator/.worktrees/manual-20261021 checkout --detach main`;
  2. check the secret first: `: "${GITHUB_TOKEN_FILE:?GITHUB_TOKEN_FILE is not set}" && test -r "$GITHUB_TOKEN_FILE"` (stop and ask the user if it fails); then build the image from that worktree (`cd` into its absolute path in the same command) with the BuildKit secret as before: `docker build --secret id=github_token,src="$GITHUB_TOKEN_FILE" -t ontotator-manual:20261021-fixes .`;
  3. write the new image id (`docker image inspect -f '{{.Id}}' ontotator-manual:20261021-fixes`) into `runtime/image.override.json` for `app` and `migrate`;
  4. `oc stop`, `oc start` (commands in `runtime/commands.json`; `up -d --no-build --wait` runs migrations, volumes stay); never `down --volumes`, never reseed;
  5. creation defaults for the existing project: add `seed_creation_defaults.py` to the prep dir (same style as `seed_extra.py`: `base.load_prepared(RUNTIME)`, `base.Stack(cfg)`, log in as `demo-lead`, PATCH the project settings with the U5 defaults, idempotent) and run it with `uv run python`;
  6. smoke: log in as `demo-lead`, Documents shows the row panel, Settings → Creation defaults shows the values; update `TESTPROTOKOLL.md` header (revision, image) and add checklist items for findings 1–11 and W1.
- [ ] Report to the user (German, short): commits, gate result, stack ready.

## Self-review against the spec

| Spec item                                                         | WP                                         |
| ----------------------------------------------------------------- | ------------------------------------------ |
| U1, U10, U11 row panel, keys, route, Not planned, Accept as final | A1 (A3 cards popover)                      |
| U2, U3, U12–U14, X1, X3, X6–X8, X12, X13, X16, X18, X21           | E1a (grouping), E1b (backend), E2a (view)  |
| U14 Activity "kept automatically (all matched)"                   | B1 (data), B2 (Activity line)              |
| U4, T3, T17 start command, launcher                               | B1, B2                                     |
| U5, T12 creation defaults, seed, stack defaults                   | C1, final phase                            |
| U6, X20 prefill                                                   | C2                                         |
| U7, T7 W1                                                         | E1a (data), B2 (UI)                        |
| U8, T1 names for the consolidator                                 | E1a (read), E2b (editor)                   |
| U9, T2 lead read                                                  | E1a, B2 (links), E2a (read-only mode)      |
| U15, T11 warm-up                                                  | C1                                         |
| U16, T16 merge-inputs                                             | E1b (backend kept), E2b (frontend removed) |
| T4–T6 grouping rules                                              | E1a                                        |
| T8 mark, T9 auto take-over, T10 submit                            | E1a, E1b, E2a                              |
| T13–T15 waves, test churn, Esc order                              | this plan, A1                              |
| X4, X5 lead result and flags                                      | B1, B2, A1 (banner slot)                   |
| X9 first/last row, X10 stage cells, X11 row switching             | A1                                         |
| X14 copy                                                          | A1, B2, E2a                                |
| X15 W1 zero findings                                              | E1a, B2                                    |
| X17 deep links                                                    | A1, B2                                     |
| X19 cards Details                                                 | A1                                         |
| Finding 3 latency, finding 4 960 px, finding 9                    | C1, C2, D1                                 |
| Embedded bundle, ff main, :18210 rebuild                          | final phase                                |
