# Proposal Check, Text Card, Consolidation Table, Text View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement [2026-10-23-proposal-check-text-card-consolidation-design.md](../specs/2026-10-23-proposal-check-text-card-consolidation-design.md) including the user decisions D1–D4 of 2026-10-23: imported tool proposals are the starting point of the annotation step of a text ("Annotate from proposals", Q1–Q3), the legacy "Annotation review" task, the `assisted` workspace mode and stored "keep both" consolidations are removed (D1), the UI uses the D2 names, one click on a Documents row opens a centered text card with the path Translation → Annotation → Finalization, Documents rows become one line, consolidation choices are made in a comparison table with one finding per group, the read-only text view gets one toolbar with a "Show" choice (non-leads never see other people's work, D3), plus the small-fixes list.

**Architecture:** A new workspace mode `proposal_check` ("Annotate from proposals" in the UI) is the review screen over the newest tool proposal set of the text, owned by an ordinary **annotate** assignment, so it counts towards "annotations per text" and its submission is an annotation for Finalization without touching the comparison rules. Which way an annotate assignment works is decided once, at assignment time, from a pure rule (`domain/annotation_modes.py`): project setting `tool_proposal_mode` (`proposals` | `scratch`, default `proposals`), per-text plan override `work_plan_rows.annotation_mode`, "no proposals → from scratch", and a lock once any annotation work exists on the text (non-revoked annotate assignments, revoked ones with submitted work, and submissions; the mode is stored on `assignments.annotation_mode`). Legacy removal (D1) is the first backend WP (L1) with migration 0020 that deletes the legacy rows; afterwards workspace mode `review` exists only inside consolidation rounds and task `review` is created only by "Consolidate…". The read model adds proposal count, annotation mode, assignment dates and consolidation progress to the Documents rows; the frontend replaces the row side panel with a `TextCard` dialog and reuses one `StagePath` component in the card and on the consolidation screen. Consolidation drops `keep_both`/`term_choices`/`term_parts` on server and client and marks findings that come from a tool proposal. The text view gets a layer list endpoint (with unavailable entries and reasons) and a final-result layer.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2, Alembic, PostgreSQL (pytest via testcontainers or `ONTOCURATOR_TEST_PG_URL`, pytest-xdist); React 18, TypeScript, Vitest + Testing Library, Playwright + axe-core; `openapi-typescript` for `generated.ts`. No new dependencies (the Lucide "bot" icon is vendored as SVG paths).

**Binding inputs:** the spec above (sections "Decisions of 2026-10-23", 1, 2, 2b, 3, 4, "Small fixes", "Testing"); mockups in the main checkout only (gitignored, reference, the spec wins; their wording is superseded by D2): `.superpowers/brainstorm/189250-1792745471/content/` (`text-card-path.html`, `text-card-before-after.html`, `consolidation-group.html` variant B, `text-view.html`, `documents-rows-v3.html`, `proposal-icon.html` variant C); findings `.worktrees/manual-20261021/build/t5-acceptance/manual-test-20261021/FINDINGS-20261023.md` (F1–F25, V1–V8); `DESIGN.md`; `PRODUCT.md`.

**Plan decisions on spec ambiguities** (open to veto; each names the WP to change): see "Spec ambiguities resolved by this plan" at the end, which also lists how each finding of the plan review (R1–R25) was resolved. No WP waits for a confirmation.

**Internal names vs UI words (D2).** Internal ids stay technical; the UI never shows them: `AnnotationMode` `"proposals"` = "from proposals", `"scratch"` = "from scratch"; workspace mode `proposal_check` = "Annotate from proposals", `independent` = "Annotate from scratch", `review` = the consolidator's workspace inside a consolidation round; task `review` = "Consolidation"; role id `adjudicator` = "Consolidator". Error codes keep their technical names (`ANNOTATION_MODE_LOCKED` …); only their messages are user-facing.

---

## Global rules (every WP; a subagent reads only this section, "Shared contracts" and its WP block)

Integration worktree: `C:/Users/jan-p/Development/ontocurator/.worktrees/acceptance-20261023` (Git Bash: `/c/Users/jan-p/Development/ontocurator/.worktrees/acceptance-20261023`), branch `feat/acceptance-20261023`. It already exists, created from `main` 6d8bc1b. **Base is `main` at 6d8bc1b or later.** Before the first WP the orchestrator fast-forwards it to the `main` commit that contains this revised plan: `cd /c/Users/jan-p/Development/ontocurator/.worktrees/acceptance-20261023 && git merge --ff-only main` (the branch has no own commits yet; if the fast-forward fails, stop and report), then `uv sync` and `npm --prefix frontend ci` in the worktree. **WP agents never work in the integration worktree:** every WP runs in its own lane worktree branched from `feat/acceptance-20261023` (Global rule 18); the integration worktree only receives the orchestrator's merges, the post-merge checks, G1 and R1. Where a WP block writes `cd /c/Users/jan-p/Development/ontocurator/.worktrees/acceptance-20261023 && …`, the WP runs the command from **its lane root** (the orchestrator names the lane path and port in the dispatch). Line references were verified on `main` 6d8bc1b; a WP re-checks each reference with `grep -n` and reports drift instead of guessing.

1. **Subagents never commit, push, `git reset`, `git checkout -- <file>`, `git stash`, `git clean` or `git merge`.** They edit the working tree of their lane. The orchestrator commits each WP in its lane after its done check with the WP's commit message, staging only the WP's owned files (`git add <files>`, never `git add -A`), and squash-merges it into the feature branch (rule 18). No AI attribution anywhere (no `Co-Authored-By`, no "Generated with").
2. **Exclusive file ownership.** A WP writes only the files in its **Owns** list (tests included). If it needs another file it stops and reports. Shared files follow "Shared-file chains"; **no file is owned by two WPs that are unmerged at the same time** (pre-phases included, rule 19; verified in "Parallel ownership check").
3. **Prerequisite checks first.** Run the WP's prerequisite commands; if one fails, stop and report. Never re-implement a missing prerequisite. A pre-phase (rule 19) checks only the prerequisites its wave-table row names for the pre-phase.
4. **Shell.** Git Bash. `rg` is not installed; use `grep -rnE`.
5. **Machine limits (16 GB RAM; about 5 GB free once the native test server is stopped).** The orchestrator stops the native test server (`ontocurator-local`, about 1.4 GB) before the first WP and starts it again only for M1. **At most four agents at once** (implementers, reviewers and fix agents all count; a WP waiting at a sync point is not an agent). **At most two heavy test runs at once** across all worktrees, enforced by the heavy slots (rule 20). Heavy = any pytest touching PostgreSQL or with `-n` > 1, any Vitest run with more than one file or `--maxWorkers` > 1, Playwright, `npm --prefix frontend run build`, `scripts/check.sh` except `--only static`. Light = editing and reading, `npm --prefix frontend run typecheck`, ruff/mypy, generators, pure-Python pytest without a database, one Vitest file with `--maxWorkers=1`. **A Playwright run takes both slots** (it runs alone, one worker); G1 runs alone on the machine.
6. **Verification.** WP agents run only checks for the modules they touched: one backend file `uv run pytest tests/<file>.py -q`; several `uv run pytest -n 4 tests/<a>.py tests/<b>.py -q`; Vitest files `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/<path>`; `npm --prefix frontend run typecheck`; `uv run ruff check . && uv run ruff format --check . && uv run mypy src`; after a regeneration `bash scripts/check.sh --only static`; or `bash scripts/check.sh --quick <paths…>`. Every heavy command of this list runs inside a heavy slot (rule 20). Batch the heavy runs: write all tests, run red once, implement, run green once, plus one regression run of the touched modules. **No WP runs the full backend, full Vitest or full Playwright suite** (U9 included: it runs only the Vitest files of the modules it touches); the full suites run once, in G1.
7. **Playwright.** Each lane has its own port: lane N uses `HPO_E2E_PORT=1877<N+1>` (lane 1 → 18772 … lane 8 → 18779); the integration worktree (G1) uses 18771 (others: 18765–18768 in older worktrees). Check the port is free with `netstat -ano | grep -c ":<port> "` → `0`, else take the next free port ≥ 18780 and say so in the hand-back. Command: `HPO_E2E_PORT=<port> PLAYWRIGHT_WORKERS=1 npm --prefix frontend run test:e2e -- <spec>` (rebuilds the lane's `frontend/dist`), inside both heavy slots. Evidence (screenshots) only under `/c/Users/jan-p/Development/ontocurator/.worktrees/acceptance-20261023/build/acceptance-20261023/evidence/` (absolute path, lanes are reused); no Playwright scratch in the main checkout.
8. **Isolated browser scenarios.** Every new or changed Playwright test builds its own fresh project through a test-only route (`/__test_proposal_check__`, `/__test_consolidation__`, `/__test_documents__`, `/__test_overview__`, …). No test writes a project another test uses.
9. **Static gate.** `scripts/check.sh --only static` checks the lane's whole tree; in a pre-phase it may fail on references to a prerequisite that is not merged yet. A WP fixes only failures in its own Owns and reports the others. After every merge the orchestrator runs the post-merge check in the integration worktree (rule 18).
10. **Contracts.** `contracts/openapi.json`, `frontend/src/api/generated.ts`, `contracts/admin-error-codes.json` are never hand-edited. Regenerate with `uv run python scripts/export_openapi.py && npm --prefix frontend run api:generate` and `uv run python scripts/export_admin_error_codes.py`. **Contracts token:** one holder at a time, in the order **L1 (token 1) → U0 (only `request` and the `NetworkError` message) → P2 (token 2) → P3 (3) → P4 contract step (4) → P5 contract step (5) → P7 (6) → P8 (7) → U2 (`errors.ts` wording sweep only)** (P1, P6 and T1 change no API). The token covers the chain files `contracts/openapi.json`, `frontend/src/api/generated.ts`, `contracts/admin-error-codes.json`, `src/ontocurator/domain/admin_error_codes.py`, `frontend/src/api/client.ts`, `frontend/tests/documents/fixtures.ts` and `frontend/src/admin/errors.ts`; a WP edits them only while it holds the token, in one contract step. **Taking the token:** the orchestrator syncs the WP's lane onto the feature branch that contains the previous holder's contract (rule 19), then the WP edits the chain files, regenerates and runs `npm --prefix frontend run typecheck` and `bash scripts/check.sh --only static`. **Returning it:** the orchestrator squash-merges that contract step at once, before the WP's review (rule 21); L1, which holds token 1 for its whole run, returns it with its merge. A WP whose API changes after its contract step (for example a review fix) takes the token again for a follow-up regeneration. Any WP whose API change alters `generated.ts` is a contracts writer and regenerates in the same WP. A writer also adds its `frontend/src/api/client.ts` functions, new defaults in `frontend/tests/documents/fixtures.ts`, and the minimal frontend compile fix its type change forces (files named in its block), so the tree typechecks after each writer. New error codes go into `src/ontocurator/domain/admin_error_codes.py` (sorted) and get a message in `frontend/src/admin/errors.ts` (same writer).
11. **API changes are additive** (new response fields have defaults) except the removals the spec and D1 mandate: P7 (`keep_both`, `term_choices`, `term_parts`), L1 (`assisted` mode, task `review` in assign/batch requests, annotation-review next steps and states).
12. **Migration numbering.** Only L1 and P1 create migrations: L1 `0020_remove_legacy_workflows.py` (`revision = "0020"`, `down_revision = "0019"`), P1 `0021_proposal_check.py` (`revision = "0021"`, `down_revision = "0020"`). P1's pre-phase writes its migration file while L1 runs, but runs its migration tests only in its post-phase, after L1 is merged and synced, so `0020` is on its base. Any other WP that finds it needs a migration stops and reports; the orchestrator assigns the next free number on the feature branch, one migration at a time, after the previous one is merged.
13. **DocumentsPage token.** `frontend/src/admin/DocumentsPage.tsx` and `frontend/tests/documentsPage.test.tsx` have one writer at a time, in the order **U3 → U4 → U5** (L1 may touch `DocumentsPage.tsx` only if its compile fix requires it, before U3; U8's link buttons on this page moved to U4; U9 later). The token moves like the contracts token: sync, edit, squash-merge. Frontend WPs build components and component tests first (pre-phase) and wire the page last, after the orchestrator hands them the token.
14. **English** for all files and UI copy; copy is verbatim from the spec or from the "Copy" table and the WP blocks. **D2 words only:** never add or keep "Annotation review", "Independent annotation", a bare "Review", "Keep both", "blind" (user-facing), "check tool proposals" or "Adjudicator" in UI copy (internal ids may keep such names). No `·` in any new or changed copy (spec F11; WP U9 removes the rest). Icons only from `frontend/src/ui/icons.tsx`. Status never by colour alone. Unavailable actions use `aria-disabled` + `aria-describedby` reason (existing `Button`), never native `disabled`. Colours only from `frontend/src/styles/tokens.css` (enforced by `frontend/tests/tokens.test.ts`); U0 is the only WP that adds tokens.
15. **TDD.** Write the listed failing tests first, run them red, implement, run green.
16. **Reviews.** Only WPs flagged "review: yes" (L-sized or backend-critical; not the M frontend WPs, P4 or P5) get one read-only review by the `superpowers:code-reviewer` agent, then one fix agent at effort medium. The review runs on the WP's lane (`git -C <lane> diff feat/acceptance-20261023...HEAD` after the final lane commit) before the squash merge; contract steps are merged before it (rule 10). After the final gate, one review of the whole diff by the same agent (G1). No Codex.
17. **Hand-back** (final message): changed/created/deleted files (subset of Owns), commands with exit status and one-line result, done checklist item by item, skipped parts and deviations, line-reference drift found, open risks, the commit message. A pre-phase ends with a hand-back headed `PRE-PHASE DONE` that lists what is left; a contract step ends with `CONTRACT READY` and the files of the contract commit.
18. **Lanes and merges (orchestrator).** Lanes are worktrees `/c/Users/jan-p/Development/ontocurator/.worktrees/acc-lane-<N>` (N = 1…8), created on demand from the main checkout: `git worktree add .worktrees/acc-lane-<N> -b wp/<WP> feat/acceptance-20261023`, then `uv sync` and `npm --prefix frontend ci` once per lane (light; no new dependencies in this plan). L1 already runs in lane 1 (`.worktrees/acc-lane-1`, branch `wp/L1`; its block calls it the backend lane). A free lane is reused with `git -C <lane> switch -C wp/<WP> feat/acceptance-20261023` (only when `git -C <lane> status --short` is empty). A lane stays bound to its WP until the WP is merged, also while the WP waits at a sync point. **Merge into the feature branch** (integration worktree): `git merge --squash wp/<WP> && git commit -m "<WP commit message>"` (one commit per WP; a contract step gets its own commit `<type>(api): <WP> contract`); when the feature branch has not moved since the lane branched and the lane holds one commit, `git merge --ff-only wp/<WP>` is equivalent. A lane that continues after a merged contract step is synced at once (`git -C <lane> merge --no-edit feat/acceptance-20261023`). **Conflicts:** ownership rules them out. A conflict only in `contracts/openapi.json`, `frontend/src/api/generated.ts` or `contracts/admin-error-codes.json` (token broken, or a review changed an API) is resolved by regenerating those files in the integration worktree from the merged sources (rule 10 commands), `git add`, commit; any other conflict: `git reset --merge`, stop and report. **Post-merge check** (integration worktree, light): `npm --prefix frontend run typecheck`, `bash scripts/check.sh --only static`, and the drift check `uv run python scripts/export_openapi.py && npm --prefix frontend run api:generate && uv run python scripts/export_admin_error_codes.py && git diff --exit-code contracts frontend/src/api/generated.ts`. A red post-merge check blocks further merges until one fix agent (effort medium) repairs it on the feature branch. After R1 the lanes are removed (`git worktree remove`, `wp/*` branches deleted).
19. **Pre-phases and sync points.** A WP marked *pre* in the wave table is dispatched before all its prerequisites are merged. In the pre-phase it edits only files of its Owns that (a) no unmerged WP owns and (b) are not token files (contracts chain of rule 10, `DocumentsPage.tsx`, `documentsPage.test.tsx`); it creates its new modules and tests, writes code against the interfaces this plan states ("Shared contracts" and the prerequisite's WP block), and runs only checks that do not need the missing prerequisite (heavy ones inside a heavy slot). If a stated interface is not enough, it stops and reports instead of guessing. **Sync point:** when the prerequisite is merged, the orchestrator commits the lane's owned files (`wip(<WP>): pre-phase`), runs `git -C <lane> merge --no-edit feat/acceptance-20261023` and resumes the same agent with SendMessage (context kept). The post-phase does the rest, including every run that needs the prerequisite. A WP that needs a newer merge later (P5 for P7's progress helper, U4 for P5's contract step, U2 for P8's contract step) asks for another sync point in its hand-back.
20. **Heavy slots.** The orchestrator creates `/c/Users/jan-p/Development/ontocurator/.worktrees/.heavy-slots`. Before a heavy run an agent takes a slot and releases it right after the run, also when the run failed:

    ```bash
    S=/c/Users/jan-p/Development/ontocurator/.worktrees/.heavy-slots
    FREE_KB=$(powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory" | tr -d '\r')
    SLOT=; [ "$FREE_KB" -ge 2500000 ] && for n in 1 2; do mkdir "$S/$n" 2>/dev/null && { echo "<WP> $(date +%H:%M)" > "$S/$n/owner"; SLOT=$n; break; }; done
    if [ -n "$SLOT" ]; then export ONTOCURATOR_TEST_PG_URL=postgresql://postgres@127.0.0.1:$((15611 + SLOT))/postgres; <heavy command>; rc=$?; rm -rf "${S:?}/${SLOT:?}"; exit $rc; else echo "NO SLOT"; fi
    ```

    Each slot has its own native throwaway PostgreSQL cluster (slot 1 → port 15612, slot 2 → 15613; data under `C:/Users/jan-p/Development/ontocurator-testpg/`, started by the orchestrator), so parallel runs never share template databases and Docker is not needed. A Playwright run (both slots) uses slot 1's cluster. Never point `ONTOCURATOR_TEST_PG_URL` at the native test server (port 15611).

    No slot or less than 2.5 GB free: do the remaining light work first; when only heavy work is left, retry every 30 s with a background until-loop (`run_in_background`); never run a heavy command without a slot. A Playwright run takes both slots (`mkdir "$S/1" && mkdir "$S/2"`, release both). The orchestrator removes slots whose owner has handed back. L1 started before the slots existed: the orchestrator creates them at once and tells L1 to use them for its remaining heavy runs.
21. **Contract-first steps.** P4 (at its start) and P5 (at the start of its post-phase) begin with their contract step: model fields with their defaults, regeneration, `client.ts`, fixtures (see their blocks). This plan adds no new route in P4 or P5, so there are no route stubs; P4's plan handlers answer `HTTPException(status_code=501)` to a request that sets one of its new plan fields until its Steps 1–2 replace that guard, and P5's new row fields keep their defaults until its Steps 1–2 fill them. The WP hands back `CONTRACT READY`; the orchestrator squash-merges it at once (light checks only, the WP's review, if any, covers it later) and resumes the WP. U2, U3, U4 and U5 type against that final API long before the implementations are merged. T2 starts with its `textCard` helpers in `frontend/browser/documentsHelpers.ts` as step T2a, merged at once; from then on T3 owns that file.

## Work packages

| WP | Title | Size | Kind | Review | Wave | Depends on (pre-phase / post-phase) |
|---|---|---|---|---|---|---|
| L1 | Legacy removal (D1): annotation review task, `assisted`, keep-both data; migration 0020 (contracts 1) | L | backend, heavy | yes | W1 (running in lane 1) | – |
| U0 | Design foundations: axis tokens, bot/more icons, `StagePath`, `AssignedDate`, `AxisValue`, network errors, route params | M | frontend, light (L+) | – | W1 pre, W2 | – / L1 (`client.ts`, `errors.ts` with the token after L1) |
| P1 | Migration 0021, ORM, pure annotation-mode rule | M | backend, heavy | yes | W1 pre, W2 | – / L1 |
| P2 | Workspace mode `proposal_check` over the newest proposal set (contracts 2) | L | backend, heavy | yes | W1 pre, W3 | – / P1 (L1 merged before); token 2 after U0 |
| U1 | D2 names everywhere, review-of-submitted UI removed, `editor/modes.ts` (F1, F16, D1, D2) | M | frontend, light | – | W2 | L1 |
| P7 | Consolidation server: one finding per group, keep-both removed, tool-proposal marker, progress helper (contracts 6) | M | backend, heavy | yes | W2 pre, W6 | L1 / P3; token 6 after P5's contract step |
| P5 | Read model: proposals, modes, dates, facet, progress, My tasks (contracts 5, contract-first) | M | backend, heavy | – | W2 pre (first free slot), W7 | L1 / P3, P4 contract step; P7 merged before the progress part |
| P3 | Annotation mode on assignments, per-text limit, remove with draft discard, "Annotate from proposals myself" (contracts 3) | L | backend, heavy | yes | W3 pre, W5 | P1 / P2 |
| U3 | Text card (replaces RowPanel) | L | frontend, L+ | yes | W4 pre, W8 | U0, U1 / P3, P5 contract step; DocumentsPage token 1 |
| U4 | One-line rows, row click, selection bar 2+, robot icon, filter, More menu, overflow, F2/F7/V4/V7 | L | frontend, L+ | yes | W4 pre, W10 | U1 (P5 contract via sync) / U3; DocumentsPage token 2 |
| U6 | Consolidation table screen | L | frontend, L+ | yes | W4 pre (only if idle), W8 | U0 / P7 |
| P6 | Export fields for proposal checks + docs | S | backend, heavy | – | W5 pre, W6 | P2 / P3 (`proposal_check_support.py`) |
| P4 | Project setting, plan override, mode lock, new text versions (contracts 4, contract-first) | M | backend, heavy | – | W6 | P3 |
| P8 | Text view layers and final-result layer (contracts 7) | M | backend, heavy | yes | W6 | P3; token 7 after P7 |
| U5 | "Change plan…" / "Plan…" rework (F5) | M | frontend, L+ | – | W7 pre, W11 | U1, P4 contract step / U4; DocumentsPage token 3 |
| U2 | Annotate from proposals in the editor, My tasks, assign dialog, Settings → Workflow, error copy, F8, V2 | M | frontend, L+ | – | W8 | U1, P4, P5 contract step; `errors.ts` after P8's contract |
| U7 | Text view (replaces CaseViewer fold-out), axis colours in editor list and compare | M | frontend, L+ | – | W9 | U0, P8 |
| T1 | Browser scenarios (proposal check, three-person consolidation) | M | backend, heavy | – | W9 | P5, P7, P8 |
| U8 | Small fixes: F13, F18, V3, V4 (rest), V5, V6 (+ F8 styles) | S | frontend, heavy (one DB pytest file) | – | W11 | U2, U3, U4 |
| U9 | Separator sweep (F11) | S | frontend (Vitest files of the touched modules = heavy slot) | – | W12 | U2–U8 all merged |
| T2 | New browser specs: proposal check e2e, text card, consolidation 3 people, text view, rows | L | browser, heavy (Playwright) | yes | W11 pre (T2a), W13 | T1 / U9 |
| T3 | Existing browser specs on the new UI + spans-resize flake | L | browser, heavy (Playwright) | – | W13 | U9, T2a |
| G1 | Final gate in batches, whole-diff review | – | heavy, alone | final | W14 | all |
| R1 | Embedded bundle rebuild (separate commit) | XS | light | – | W15 | G1 |
| M1 | Manual acceptance on the native test server | – | manual | – | W16 | R1 |

25 WPs (9 backend, 10 frontend, 3 browser, gate, bundle, manual) in 16 waves.

## Wave schedule (L1 first, contract-first, lanes, pre-phases; max four agents, max two heavy runs)

A wave starts when its trigger is merged into the feature branch. *pre* = pre-phase (rule 19), *post* = continuation after the sync point. Times are rough (S ≈ 20 min, M ≈ 40, L ≈ 75 per WP; + 15 min review and fix for "review: yes"; + 5 min merge and post-merge check), counted from the start of L1; the W1 pre-phases start as soon as the orchestrator dispatches them (if L1 is further along, everything moves earlier).

| Wave | Trigger | Dispatch | Heavy runs | ≈ start |
|---|---|---|---|---|
| S0 | – | L1 running in lane 1; native test server stopped (if not yet); lanes 2–4 created (`uv sync`, `npm ci`); `.heavy-slots` created | – | now |
| W1 | start | L1 (lane 1, running) ‖ U0 *pre* (lane 2; not `client.ts`/`errors.ts`) ‖ P1 *pre* (lane 3; migration file, `tables.py`, `plan_tables.py`, `domain/annotation_modes.py`, its new tests; pure tests only) ‖ P2 *pre* (lane 4; only files neither L1 nor P1 owns, see P2 block; no DB tests) | L1 tests; U0 Vitest files | 0:00 |
| W2 | L1 merged | P1 *post* (sync) ‖ U0 *post* (sync; token after L1: `request`, `NetworkError`) ‖ U1 ‖ P7 *pre* (consolidation server files and tests, not the tool-proposal test); P5 *pre* (read-model files) takes the next free agent slot | P1 tests; U0, U1 Vitest files; P7 tests | 1:35 |
| W3 | P1 merged | P2 *post* (sync; token 2 after U0's step) ‖ P3 *pre* (new modules, `memberships.py`, `consolidation_start.py`, `batch.py`, `assignment_routes.py`, `problem_reports.py`, `authz/scoped.py`, new tests) | P2 tests | 2:15 |
| W4 | U1 merged | U3 *pre* ‖ U4 *pre* (components and component tests; no `DocumentsPage`, U4 not `stageLabels.ts`); U6 *pre* (new files only) only if an agent slot and a lane are idle | single Vitest files | 2:20 |
| W5 | P2 merged | P3 *post* (sync; token 3) ‖ P6 *pre* (export module, README and docs text, pure tests) | P3 tests | 3:10 |
| W6 | P3 merged | P4 (contract step first, token 4) ‖ P7 *post* (sync; tool-proposal test; contract step later, token 6) ‖ P6 *post* (heavy tests) ‖ P8 (implementation first; token 7 after P7) | P4, P7, P6, P8 tests | 4:05 |
| W7 | P4 contract merged | P5 *post* (sync; contract step first, token 5) ‖ U5 *pre* (plan dialog pieces, not `RowActions.tsx`) | P5 tests | 4:20 |
| W8 | P5 contract merged | U3 *post* (sync; DocumentsPage token 1) ‖ U4 sync (P5 fields) ‖ P7 contract step (token 6), then U6 *post* once P7 is merged ‖ P8 contract step (token 7 after P7) ‖ U2 (after P4 is merged; `errors.ts` last, token after P8) | P8 tests; Vitest files | 4:40 |
| W9 | P8 merged | U7 ‖ T1 (once P5 and P7 are merged too) | T1 fixture tests | 5:10 |
| W10 | U3 merged | U4 *post* (sync; DocumentsPage token 2, `stageLabels.ts`) | Vitest files | 5:30 |
| W11 | U4 merged | U5 *post* (sync; `RowActions.tsx`, DocumentsPage token 3) ‖ U8 (DB test in a slot); T2 *pre* once T1 is merged (specs written, T2a helpers merged at once) | U8 tests | 6:15 |
| W12 | U2, U3, U4, U5, U6, U7, U8 merged | U9 (only `frontend/src` writer) ‖ T2 *pre* continues (`frontend/browser/` only) | U9 Vitest files (1 slot) | 6:45 |
| W13 | U9 and T2a merged | T2 *post* ‖ T3 (separate lanes and ports; one Playwright run at a time, both slots per run; one agent edits while the other runs) | Playwright | 7:10 |
| W14 | T2, T3 merged | G1 in the integration worktree, alone on the machine; the whole-diff review (read-only) runs alongside | G1 | 9:00 |
| W15 | G1 green | R1 | build | 10:30 |
| W16 | R1 committed | M1 (native test server started again) | manual | 10:40 |

**Dispatch priority** when an agent slot frees (four agents at most): (1) the critical path: L1, P1, P2, P3 (pre and post), U0 (its token step precedes P2's), P4 contract step, P5 contract step, U1, U3, U4, U5 *post*, U8, U9, T2/T3, G1, and the reviews and fix agents of these; (2) P5 rest, P7, P8, U2, U6, T1; (3) P5 *pre*, P6, U7, U5 *pre*, U6 *pre*, T2 *pre*. A slot is never filled with work on files an unmerged WP owns.

**Critical path:** L1 (1:35) → P1 *post* incl. review (0:40) → P2 *post* incl. review (0:55) → P3 *post* incl. review (0:55) → P4 contract step (0:15) → P5 contract step (0:20) → U3 *post* incl. card wiring and review (0:50) → U4 *post* incl. review (0:45) → U5 *post* ‖ U8 ‖ U6 *post* (0:30) → U9 (0:25) → T2 ‖ T3 (≈ 1:50: about 45 + 60 min of serial Playwright time plus T2's review) → G1 (≈ 1:30) → R1 (0:10) ≈ **10.7 h**, about **11.5 h** with agent and slot contention (W6–W8 want more than four agents; priority (1) goes first). The pre-phases of P1, P2, P3, U3 and U4 take 20–45 min of coding off the chain each; P7, P6, P8, P5 rest, U2, U6, U7 and T1 run beside it with slack.

**Compared with the two-lane schedule (L1 → … → T1 in one lane, U0 … T3 in the other after P5):** ≈ 23.5 h → ≈ **11.5 h** (about −50 %). L1 first keeps its 63bfd28 order (migration 0020, P1 = 0021, no `assisted` branches in P1–P3); U0, P1 and P2 use L1's run time for their pre-phases; P7, P5 and later P6 start their pre-phases right after L1; P4 and P5 contract steps unblock U2–U5 early; U4 and U5 build their components in parallel and only the `DocumentsPage` wiring is serial; T2 and T3 overlap editing with each other's Playwright runs.

## Parallel ownership check (no file owned by two unmerged WPs)

- **W1** L1 ‖ U0 *pre* ‖ P1 *pre* ‖ P2 *pre*: L1 owns the token files (contracts, `admin_error_codes.py`, `client.ts`, `errors.ts`, `frontend/tests/documents/fixtures.ts`), its compile-fix files, the seven `assisted` frontend tests and the existing test files of its Step 0 list. U0 *pre* leaves `client.ts`/`errors.ts` to its post-phase; its other files (`tokens.css`, `ui/*`, `components.css`, `router.ts`, `DESIGN.md`, licences, new tests) no other unmerged WP owns. P1 *pre* writes only the migration 0021, `storage/tables.py`, `storage/plan_tables.py`, `domain/annotation_modes.py` and its two new tests; `assignments/service.py` (L1) and the existing test files of its Step 4 (they may be on L1's Step 0 list) wait for the sync. P2 *pre* writes only `storage/proposal_queries.py`, `application/workspace_opening.py`, `reviews.py`, `submissions.py`, `editing.py`, `reanchor_resolutions.py`, `authz/versions.py`, `api/document_projection.py`, `api/routes.py`, `exchange/t1.py` and its two new tests; its files shared with L1 (`domain/workspace.py`, `domain/scopes.py`, `authz/policy.py`, `application/workspaces.py`, `work_rounds.py`, `text_changes.py`, `storage/repository.py`, `domain/submission_labels.py`, `exchange/final_export_guide.py`) and `assignments/service.py` (L1, P1) wait for its post-phase. If L1 reports that it needs one of P2's pre-phase files, P2 leaves that file to its post-phase.
- **W2–W3** P1 *post* ‖ U0 *post* ‖ U1 ‖ P7 *pre* ‖ P5 *pre* ‖ P2 *post* ‖ P3 *pre*: `assignments/service.py` goes P1 → P2 (P2's post-phase starts after P1 is merged). U0's token step is merged before P2 takes token 2. U1 never owns token files, `consolidation/*` (P7 → U6), `CaseViewer.tsx` (U7) or `frontend/tests/consolidationEditor.test.tsx` (P7; a D2 string assertion there is reported, not edited). P2's contract step comes after U1 is merged, so a `Record` over `WorkspaceMode` its typecheck names can join P2's Owns (rule 10) unless an unmerged WP (U3 *pre*, U4 *pre*) owns it; then P2 stops and the orchestrator decides. P7 *pre* touches only the consolidation server files, `domain/review.py` and its tests; its frontend compile fix and regeneration wait for token 6. P5 *pre* writes only the read-model files (`domain/document_rows.py`, `application/document_rows.py`, `document_row_page.py`, `document_row_facets.py`, `api/document_row_routes.py`) and its new tests, not `assignments/service.py` or `api/assignment_routes.py` (P3's). P3 *pre* writes `application/text_targets.py`, `application/annotation_modes.py`, `authz/memberships.py`, `application/consolidation_start.py`, `assignments/batch.py`, `api/assignment_routes.py`, `application/problem_reports.py`, `authz/scoped.py`, `tests/proposal_check_support.py` and its new tests: none is P2's, P5's or P7's; `assignments/service.py`, `work_rounds.py`, `authz/versions.py`, `storage/repository.py` (P2's until merged) and the token files wait for its post-phase. If P3's limit breaks `tests/test_browser_consolidation_fixture.py` (P7's), P3 reports it and P7 fixes it after its sync.
- **W4–W5** U3 *pre* ‖ U4 *pre* ‖ U6 *pre* ‖ P3 *post* ‖ P6 *pre*: U3 and U4 share `stageLabels.ts`/`stageLabels.test.ts` and `DocumentsPage.tsx` → U4 edits those only in its post-phase, after U3 is merged; U3 *pre* leaves `DocumentsPage.tsx` to its token step. U6 *pre* writes new files under `consolidation/` only (P7 owns the compile-fix files until merged). P6 *pre* starts after P2 is merged (`final_export_guide.py` goes L1 → P2 → P6; `docs/scientific-workflow.md` L1 → P6).
- **W6–W9** P4 ‖ P5 ‖ P7 ‖ P6 ‖ P8 ‖ U2 ‖ U3 ‖ U4 ‖ U5 *pre* ‖ U6 ‖ U7 ‖ T1: backend WPs share only token files (token order P4 → P5 → P7 → P8); P4's `projects/service.py`, `work_plan_routes.py`, `work_plans.py`, `work_plan_store.py`, `domain/work_plans.py`, `text_changes.py` ≠ P5's read-model files, `assignments/service.py` and `assignment_routes.py` (P5's after P3) ≠ P8's `authz/versions.py`, `authz/scoped.py`, `storage/repository.py`, `variant_routes.py` (P8's after P3); `frontend/tests/projectSettings.test.tsx` is P4's until P4 is merged, then U2's. U2 owns no CSS and takes `errors.ts` last. U5 *pre* stays off `RowActions.tsx` (U4) and `DocumentsPage.tsx`. `editor.css` is U7's only, `CaseScreen.tsx` U2's only. T1 starts after P5, P7 and P8 are merged (`tests/browser_server.py` after L1, `tests/test_browser_consolidation_fixture.py` after P7).
- **W10–W12** U4 ‖ U5 ‖ U2 ‖ U6 ‖ U7 ‖ T1 ‖ U8 ‖ U9 ‖ T2 *pre*: `RowActions.tsx` is U4's until merged, then U5's; `components.css` U4 → U8; `FinalPanel.tsx` U3 → U8; `MyTasks.tsx` and `TranslationReviewScreen.tsx` U2 → U8; T1 only `tests/browser_*`, its fixture tests and `proposalCheckHelpers.ts`; U9 starts when every other `frontend/src` writer is merged; T2 *pre* writes only new specs and (T2a) `documentsHelpers.ts`.
- **W13** T2 ‖ T3: T2 owns its five new specs; T3 the existing specs, `documentsHelpers.ts` (after T2a) and `documentsOverviewHelpers.ts`.
- Single writer at all times: `router.ts` (U0), `styles/index.css` (U3), `contracts/*` and `generated.ts` (token), `DocumentsPage.tsx` (DocumentsPage token).
- Overlaps found when L1 moved first and resolved above: U0 ↔ L1 (`client.ts`, `errors.ts`: U0 post-phase), P1 ↔ L1 (`assignments/service.py`, possibly P1's Step 4 test files: P1 post-phase), P2 ↔ L1 (nine shared backend files: P2 post-phase), P2 ↔ P1 (`assignments/service.py`: P2 post-phase after P1), P6 ↔ P2 (`final_export_guide.py`: P6 *pre* only after P2 is merged). P4 has no pre-phase (it starts after P3 is merged, with its contract step first, rule 21).

## Shared-file chains (one writer at a time, in this order)

- `contracts/openapi.json`, `frontend/src/api/generated.ts`, `contracts/admin-error-codes.json`, `src/ontocurator/domain/admin_error_codes.py`, `frontend/src/api/client.ts`, `frontend/tests/documents/fixtures.ts`: **L1 → U0 (only `request` and the `NetworkError` class) → P2 → P3 → P4 (contract step) → P5 (contract step) → P7 → P8**.
- `frontend/src/admin/errors.ts`: L1 (`TASK_NOT_ASSIGNABLE`) → U0 (`NetworkError` message) → P2 → P3 → P4 → P5 → P7 → P8 (each only for new codes, in its contract step) → U2 (D2 wording sweep of existing messages, with the token after P8).
- `src/ontocurator/assignments/service.py`: L1 (`assisted`, task `review` not assignable) → P1 (one line in `_create`) → P2 (`TASK_FOR_MODE`) → P3 → P5 (`TaskSummary`, `my_tasks`).
- `src/ontocurator/assignments/batch.py`: L1 (task `review` out) → P3 (shared held-annotation count).
- `src/ontocurator/application/consolidation_start.py`, `src/ontocurator/authz/memberships.py`: P3 only (shared self-grant helper).
- `src/ontocurator/application/work_rounds.py`: L1 (ordinary review rounds refused, `assisted` out) → P2 (targets, `:150` filter) → P3.
- `src/ontocurator/application/text_changes.py`: L1 (`assisted` out) → P2 (`:414` filter) → P4 (from-proposals reasons).
- `src/ontocurator/storage/repository.py`: L1 (only if needed) → P2 → P3 (draft discard) → P8.
- `src/ontocurator/domain/workspace.py`, `domain/scopes.py`, `authz/policy.py`, `domain/submission_labels.py`, `application/workspaces.py`: L1 → P2.
- `src/ontocurator/authz/versions.py`: P2 (`:152` label) → P3 (`may_read_proposals`) → P8. `src/ontocurator/authz/scoped.py`: L1 (comment) → P3 → P8.
- `src/ontocurator/api/assignment_routes.py`: L1 (request task literal) → P3 → P5.
- `src/ontocurator/domain/next_steps.py`, `domain/stage_cells.py`, `application/document_rows.py`: L1 (annotation-review states out) → P5.
- `src/ontocurator/application/consolidation.py`, `api/consolidation_routes.py`: P7 (removal, `from_tool_proposal`, `consolidation_progress`) → P5 (import only, no edit).
- `src/ontocurator/exchange/final_export_guide.py`: L1 (legacy kinds out) → P2 (`submission_kind`) → P6. `docs/scientific-workflow.md`: L1 → P6.
- `src/ontocurator/api/work_plan_routes.py`, `application/work_plans.py`, `storage/work_plan_store.py`: P4 only.
- `tests/browser_server.py`: L1 (legacy scenarios out) → T1 (new routes). `tests/test_browser_consolidation_fixture.py`: P7 → T1.
- `frontend/tests/session.test.tsx`, `assignmentApp.test.tsx`, `layerState.test.ts`, `caseTree.test.tsx`, `layerControls.test.tsx`, `firstRun.test.tsx`: L1 only (`assisted` out). `frontend/tests/decisionSemantics.test.ts`: L1 → U2.
- `frontend/tests/projectSettings.test.tsx`: P4 (payload expectation) → U2.
- `frontend/src/consolidation/*`: P7 (compile fix) → U6 (incl. U1's D2 strings in `consolidationText.ts`, `SummaryDialog.tsx`) → U9.
- `frontend/src/app/CaseScreen.tsx`: L1 (`assisted` compile fix) → U2 → U9.
- `frontend/src/editor/modes.ts`: U1 (create) → U2 (imports only) → U9.
- `frontend/src/documents/nextStepLabels.ts`, `SelectionBar.tsx`, `frontend/src/admin/assignSummary.ts`, `frontend/src/app/submissionLabels.ts`: L1 (compile fix only) → U1 → U4 (`SelectionBar.tsx`) → U9. `frontend/src/documents/stageLabels.ts`: L1 (compile fix only) → U3 (receives `STAGE_TITLES`) → U4 (one-line texts) → U9.
- `frontend/src/documents/RowPanel.tsx`: L1 (compile fix only) → U1 (review button out) → U3 (deleted).
- `frontend/src/documents/planSummary.ts`: U1 (strings) → U5 → U9. `ResolveTranslation.tsx`, `admin/UploadWorkPlan.tsx`, `admin/assignmentUI.tsx`, `ui/PlanChip.tsx`: U1 → U9.
- `frontend/src/documents/FinalPanel.tsx`: U1 (labels) → U3 (embedding) → U8 (V5) → U9.
- `frontend/src/documents/finalPanelText.ts`, `filterModel.ts`, `PlanChips.tsx`, `PlanDialog.tsx`: U1 (strings) → U4 / U5 → U9. `RowActions.tsx`: U1 (strings) → U4 → U5 (`PlanPopover`) → U9.
- `frontend/src/admin/AssignWorkDialog.tsx`: U1 (review rows out) → U2 (mode, dates) → U9.
- `frontend/src/variants/ConsolidationLauncher.tsx`: U1 (role words) → U8 (V4) → U9.
- `frontend/src/documents/RowActivity.tsx`, `StagePopover.tsx`: U3 (import of `STAGE_TITLES` from `stageLabels.ts`) → U9.
- `frontend/src/admin/DocumentsPage.tsx`, `frontend/tests/documentsPage.test.tsx`: (L1 compile fix only if forced) → U3 → U4 (incl. the `:123-124` link buttons, V4) → U5 → U9.
- `frontend/src/app/router.ts`, `frontend/tests/router.test.ts`: U0 only (U3 and U7 only read the params).
- `frontend/src/styles/index.css`: U3 only.
- `frontend/src/styles/components.css`: U0 → U4 (`.shell-main`) → U8 (toast, `.shell-page`, and U2's F8 rules: `.task-loading`, reading-density rule, `.badge-assisted` out) → U9.
- `frontend/src/styles/screens/editor.css`: U7 (viewer rules, and U2's `.app-title .badge-assisted` out) → U9.
- `frontend/src/tasks/MyTasks.tsx`, `frontend/src/translation/TranslationReviewScreen.tsx`: U2 → U8 → U9.
- `frontend/src/variants/CaseViewer.tsx`: U7 (incl. U1's `<h2>` wording) → U9.
- `DESIGN.md`: U0 → U6.
- `frontend/browser/documentsHelpers.ts`: T2 (T2a: adds `textCard` helpers) → T3. `documentsOverviewHelpers.ts`: T3.

---

## Shared contracts

### Names (used across WPs; do not rename)

| Name | Where | Meaning |
|---|---|---|
| `WorkspaceMode = Literal["independent", "review", "proposal_check"]` (after P2) | `domain/workspace.py`, `domain/scopes.py` | `proposal_check` = annotate from proposals; `independent` = annotate from scratch; `review` = the consolidator's workspace of a consolidation round only |
| `REVIEW_LIKE_MODES = frozenset({"review", "proposal_check"})`, `is_review_like(mode)` | `domain/scopes.py` | modes with targets and decisions |
| `AnnotationMode = Literal["proposals", "scratch"]` | `domain/annotation_modes.py` | the way a text's annotation step works |
| `TextMode(mode, source, locked)`; `ModeSource = Literal["no_proposals", "locked", "plan", "project"]` | same | effective mode with its reason |
| `text_mode(*, project_mode, plan_override, proposal_count, work_modes) -> TextMode` | same | pure rule (below) |
| `workspace_mode(task, annotation_mode) -> WorkspaceMode` | same | replaces the lookups `MODE_FOR_TASK[task]` |
| `projects.tool_proposal_mode` (`proposals`/`scratch`, server default `proposals`, existing projects backfilled `scratch`) | migration 0021 | project setting "Texts with tool proposals" |
| `work_plan_rows.annotation_mode` (nullable `proposals`/`scratch`) | migration 0021 | per-text override; NULL = project setting |
| `assignments.annotation_mode` (`proposals`/`scratch` for task `annotate`, NULL otherwise; existing annotate rows backfilled `scratch`) | migration 0021 | mode fixed at assignment time |
| `newest_proposal_refs(conn, project_id, document_id) -> list[AnnotationRef]`, `newest_proposal_counts(conn, project_id) -> dict[str, int]`, `newest_proposal_set(conn, project_id, document_id) -> ProposalSetRef \| None` | `storage/proposal_queries.py` (P2) | the newest tool proposal set of a document (see "Proposal targets") |
| `TextRow(case_id, language)`, `text_row(conn, project_id, document_id) -> TextRow`, `text_documents(conn, project_id, row) -> list[str]`, `text_target_document(conn, project_id, row) -> str` | `application/text_targets.py` (P3) | **the one helper** for "the text of a document" and "the text's target document" (newest counted version); used by P3, P4, P5, P8 |
| `load_text_mode(conn, project_id, document_id) -> TextMode` | `application/annotation_modes.py` (P3) | DB facts → `text_mode` |
| `held_annotations(conn, project_id, document_ids) -> Counter[str]` | `assignments/service.py` (P3) | **the one count** of annotate assignments that fill a version's "annotations per text" slots (not revoked, or revoked with submitted work); used by `_assign_locked` and the batch planner |
| `grant_lead_self_role(conn, actor, project_id, project_key, user_id, username, role, now) -> list[Role]` | `authz/memberships.py` (P3) | **the one self-grant** of a role to the acting lead (caller holds the members lock EXCLUSIVE); used by `AssignmentService.assign` (role `annotator`) and `ConsolidationStartService.start` (role `adjudicator`) |
| `Action.OPEN_PROPOSAL_CHECK` (annotator role) | `authz/policy.py` | may open a `proposal_check` workspace |
| error codes `ANNOTATIONS_PER_TEXT_REACHED`, `ANNOTATION_MODE_LOCKED`, `NO_TOOL_PROPOSALS`, `NO_PROPOSALS_ON_VERSION` (P3/P4), `TASK_NOT_ASSIGNABLE` (L1) | | see WP blocks |
| `POST /api/v1/assignments/{id}/remove` | P3 | remove an unsubmitted assignment and discard its draft |
| `GET /api/v1/projects/{key}/documents/{doc}/layers` | P8 | text view "Show" list |
| submission kind `"proposal_check"` | `domain/submission_labels.py`, `exchange/final_export_guide.py` | export and history kind |
| receipt key `proposal_checks` | `exchange/final_export.py` (P6) | per-proposal decisions |
| member field `from_tool_proposal: bool` | `api/consolidation_routes.py` (P7) | robot icon in consolidation |

### Pure rule `text_mode` (P1)

1. Annotation work exists on any version of the text (text = case + language) → `TextMode(<mode of the oldest work>, "locked", True)`. **Work** = annotate assignments that are not revoked, annotate assignments that are revoked but have submitted work (`last_submission_id IS NOT NULL`), and submissions with mode `independent` (→ `scratch`) or `proposal_check` (→ `proposals`) on the text's documents; ordered by creation time.
2. Else no tool proposals in the newest proposal set of the text's target document → `TextMode("scratch", "no_proposals", False)`.
3. Else a plan override → `TextMode(override, "plan", False)`.
4. Else `TextMode(project_mode, "project", False)`.

Changing the project setting therefore never changes a locked text; changing a text's override is refused while locked (`ANNOTATION_MODE_LOCKED`, P4); removing all annotate assignments (P3 remove, possible only while nothing is submitted) unlocks the text; submitted work keeps the lock forever, even after its assignment is revoked.

### Proposal targets (P2; what drives an "Annotate from proposals" round)

The targets of a `proposal_check` round are fixed when the round is created and are exactly the annotation snapshots of the **newest tool proposal set** of the assignment's document, restricted to the scope's editable layers: `ProposalAnnotationRow` joined to `AnnotationSnapshotRow` on `(project_id, annotation_id, version)` where `document_id` is the assignment's document and `proposal_set_id` = the highest `ProposalSetRow.id` among that document's proposal rows; if the document only has proposals without a set (`proposal_set_id IS NULL`, seed packages), those form the one set. Never drafts, submissions or other people's work. The same function gives the proposal counts of the read model (P3, P5), the text view (P8) and the export (P6), so counts, targets and precision always refer to the same set. Older sets on the same document are not targets (documented in `docs/scientific-workflow.md` by P6).

### Copy (verbatim, all WPs; D2)

| Key | Text |
|---|---|
| Path phases | `Translation`, `Annotation`, `Finalization` |
| Translation actions | `Translation review` (task and plan step), `Assign reviewer…`, `Request correction…`, `Compare with source` |
| Finalization actions | `Compare results…`, `Consolidate…`, `Accept result…` (confirm title `Accept result?`) |
| Roles | `Annotator`, `Consolidator`, `Lead` (role id `adjudicator` shows as `Consolidator`) |
| Setting label | `Texts with tool proposals` |
| Setting options | `Annotate from proposals` (help: `Annotators go through the tool's proposals one by one, confirm, reject or correct each, and add the findings the tool missed.`) / `Annotate from scratch` (help: `Annotators start from the plain text and do not see the proposals.`) |
| Mode, card, assign dialog, My tasks | `Annotation, from proposals` / `Annotation, from scratch` |
| Mode reason, no proposals | `This text has no tool proposals, so it is annotated from scratch.` |
| Lock reason | `The annotation of this text has already started this way, so it cannot change.` |
| Editor badge | `Annotate from proposals` (title: `You see the tool's proposals, never other people's work.`) / `Annotate from scratch` (title: `You see neither the tool's proposals nor other people's work.`) / `Consolidate` (consolidation rounds) |
| Task names (My tasks, history) | `Annotation, from proposals` / `Annotation, from scratch` / `Consolidation` (task `review`) / `Translation review` |
| Submission kinds | `Annotation, from scratch` (`annotation`), `Annotation, from proposals` (`proposal_check`), `Consolidation`, `Carried annotation` |
| Remove dialog | title `Remove assignment?`; body `Remove {name} from the annotation of {case}? Their draft is discarded.`; buttons `Cancel` / `Remove` |
| Myself | `Annotate from proposals myself`; hint when the project rule "consolidator is not an annotator" is on: `You will then not be able to consolidate this text yourself (project rule).` |
| Robot tooltip and accessible text (Documents) | `{n} tool proposals available; the annotation starts from them` |
| Robot in consolidation | title and accessible text `From a tool proposal` |
| Filter group | legend `Tool proposals`, options `With tool proposals` / `Without` |
| Project rule checkbox | `The consolidator of a text may not be one of its annotators` |
| Assigned date | within 7 days `assigned today 10:40` / `assigned yesterday` / `assigned Mon`; older `assigned 14 Oct`; title `Assigned 21 Oct 2026, 16:44 by {name}` |
| Network error | `Connection lost. Try again.` (button `Try again`) |
| More menu | button text `More` with the `IconMore` icon; accessible name `More actions, {case} {language}` |

## WP blocks

### L1: Legacy removal (D1): annotation review task, `assisted` mode, keep-both data (contracts writer)

- **Goal:** the legacy pieces D1 removes are gone from code, API and data: the assignable task "Annotation review" (task `review` outside a consolidation, its ordinary review rounds, its read-model states and next steps), the `assisted` workspace mode, and stored "keep both" consolidations. The review **machinery** (targets, decisions, review submissions) stays: it powers consolidation and, from P2 on, "Annotate from proposals". Afterwards task `review` = the consolidator's task, created only by `ConsolidationStartService.start`; workspace mode `review` = the consolidator's workspace of a consolidation round.
- **Spec:** "Decisions of 2026-10-23" D1; §1 Constraints (legacy removal bullet); §3 (keep both removed, stored data deleted).
- **Owns:** `src/ontocurator/storage/migrations/versions/0020_remove_legacy_workflows.py` (create), `src/ontocurator/storage/work_purge.py` (create), `scripts/purge_annotation_work.py` (create, used in M1), `src/ontocurator/domain/workspace.py`, `src/ontocurator/domain/scopes.py`, `src/ontocurator/authz/policy.py`, `src/ontocurator/authz/scoped.py` (comment `:256` only), `src/ontocurator/application/preferences.py`, `src/ontocurator/auth/preferences.py`, `src/ontocurator/application/workspaces.py` (`assisted` branch `:252`), `src/ontocurator/assignments/service.py` (`TASK_FOR_MODE`, `MODE_FOR_TASK["review"]` use in the open path, public assign guard), `src/ontocurator/assignments/batch.py`, `src/ontocurator/assignments/eligibility.py` (docstrings only, `conflicting_tasks` unchanged), `src/ontocurator/api/assignment_routes.py` (request task literal, open path), `src/ontocurator/api/assignment_batch_routes.py`, the distribution confirmation module (`grep -rln "class DistributionConfirmationService" src`), `src/ontocurator/application/work_rounds.py`, `src/ontocurator/application/text_changes.py` (`:414` only), `src/ontocurator/storage/repository.py` (only if a review-open path needs it), `src/ontocurator/domain/next_steps.py`, `src/ontocurator/domain/stage_cells.py`, `src/ontocurator/application/document_rows.py` (annotation-review facts only), `src/ontocurator/domain/submission_labels.py`, `src/ontocurator/exchange/final_export_guide.py` (legacy kind texts), `docs/scientific-workflow.md` (remove `assisted` and annotation-review passages), `src/ontocurator/domain/admin_error_codes.py`, contracts, `frontend/src/admin/errors.ts` (`TASK_NOT_ASSIGNABLE` message), `frontend/tests/documents/fixtures.ts`, the frontend unit tests that use `assisted` (`grep -rln assisted frontend/tests` on `main` 6d8bc1b: `frontend/tests/session.test.tsx`, `assignmentApp.test.tsx`, `layerState.test.ts`, `caseTree.test.tsx`, `layerControls.test.tsx`, `firstRun.test.tsx`, `decisionSemantics.test.ts`; re-run the grep, a new hit joins this list), the minimal frontend compile fix (only lines the typecheck names, expected in `frontend/src/app/CaseScreen.tsx` (`assisted` badge branch `:2776-2787`), `frontend/src/documents/nextStepLabels.ts`, `frontend/src/documents/stageLabels.ts`, `frontend/src/documents/SelectionBar.tsx`, `frontend/src/admin/assignSummary.ts`, `frontend/src/app/submissionLabels.ts`, `frontend/src/documents/RowPanel.tsx`, `frontend/src/admin/DocumentsPage.tsx`; anything else: stop and report), `tests/browser_server.py` (legacy scenarios), `tests/layered_fixtures.py`, `tests/test_legacy_removal_migration.py` (create), `tests/test_legacy_removal.py` (create), and the existing test files that use the removed paths (fixed by the grep in Step 0; the orchestrator records the exact list).
- **Size / lane / review:** L / backend / yes (first WP of the backend lane).
- **Code to read:** `authz/policy.py:20-150`, `application/preferences.py`, `auth/preferences.py`, `application/workspaces.py:203-360`, `assignments/service.py:60-72, 240-620`, `assignments/batch.py:200-240`, `api/assignment_routes.py:370-520`, `api/assignment_batch_routes.py:30-60`, `application/consolidation_start.py:60-230` (the only legitimate creator of task `review`, through `_assign_locked`), `application/work_rounds.py:115-157, 440-500, 660-700`, `domain/next_steps.py:40-60, 120-200, 340-360`, `domain/stage_cells.py:60-75, 150-160, 455-475, 545-560`, `application/document_rows.py` (`annotation_reviewers`, `open_annotation_reviews`), `domain/submission_labels.py`, `storage/tables.py:310-432, 790-838`, `storage/workflow_tables.py` (all FKs), `storage/overview_tables.py`, `storage/final_tables.py`, `domain/review.py`.

**Step 0 (inventory).** `grep -rlnE '"assisted"|'"'"'assisted'"'"'|task="review"|"task": "review"|open_annotation_reviews|annotation_reviewers|annotation_review_in_progress|in_review' src tests` and `grep -rlnE "assisted|annotation review" frontend/src frontend/tests frontend/browser`; write the list into the hand-back. Profile and fixture **names** such as `make_layered_package("assisted")` / `assisted-mondo-hpo/v1` are test-data names, not the mode; keep them unless the code under test changes.

**Code changes:**
- `WorkspaceMode = Literal["independent", "review"]` (both files; P2 adds `proposal_check`); `Action.OPEN_ASSISTED`, `MODE_ACTIONS["assisted"]` removed; `MODE_ORDER = ("independent",)` (direct opens offer only "from scratch"; `review` and, from P2 on, `proposal_check` are reached through assignments and rounds); `PreferenceMode` / `_MODES` lose `assisted` and `review` only if `review` preferences are no longer reachable (read the callers; keep `review` if the consolidation screen stores a preference); the `assisted` branch in `workspaces.py:252` removed; `TASK_FOR_MODE` without `assisted`.
- Task `review` is not assignable: `AssignmentService.assign` (and the row-list POST, reassign of non-consolidation rows, batch, distribution confirmation) refuse `task == "review"` with `DomainError("TASK_NOT_ASSIGNABLE", {"task": "review"})`; request literals become `Literal["annotate", "translation_review"]` (`BatchTask`, the assign row model). `ConsolidationStartService.start` keeps calling `_assign_locked(..., "review", ...)` (no guard there). Opening a `review` assignment without an active consolidation round → `TASK_INVALID`.
- Ordinary review rounds are gone: `WorkRoundService` refuses `kind="ordinary"` (and `clean_restart`) for mode `review` with `ROUND_KIND_INVALID`; the `mode == "review" and not sources and kind == "ordinary"` target branch (`work_rounds.py:680`) is deleted (P2 adds the `proposal_check` branch). The API `/workspaces/open` refuses mode `review` with `MODE_NOT_ALLOWED` (consolidation opens through its round route). Service-level tests that drive `WorkspaceService` with mode `review` directly (machinery tests such as `tests/test_reviews.py`, `test_review_*_regressions.py`) stay unchanged: that machinery is shared with consolidation and, from P2 on, proposal checks.
- Read model: `open_annotation_reviews`, `annotation_reviewers`, state `in_review`, step `annotation_review_in_progress`, batch option "annotation review" removed (`next_steps.py`, `stage_cells.py`, `document_rows.py`, `batch.py`); consolidators (`facts.consolidators`) unchanged.
- `work_rounds.py:150` and `text_changes.py:414`: `["independent"]` (P2 adds `proposal_check`).
- `submission_labels.submission_kind`: `"review"` leaves `SubmissionKind`; a non-consolidation `review` submission can no longer exist (migration), so `mode == "review"` maps to `"consolidation"`.
- `final_export_guide.py` and `docs/scientific-workflow.md`: drop the `assisted` and "annotation review" explanations (P6 adds the "from proposals" section later).

**Data (migration 0020, D1).** Irreversible clean-up; `downgrade()` only restores nothing and documents that (no data comes back; M1 backs up the test server's database first). The purge works on whole units of work so nothing dangles; `storage/work_purge.py` holds the SQL (plain `sqlalchemy.text`/Core on table names, no ORM models, so the migration can import it and stays valid when models change) and the migration calls it once. `purge_legacy(conn) -> dict[str, int]` returns the rows deleted per table (and `user_preferences_converted`); the migration logs them in one line, `logging.getLogger("ontocurator.migrations").warning("0020 legacy purge: %s", counts)` (WARNING, so the line reaches the app's stderr log without logging setup; M1 records these counts):

| Legacy data | Treatment |
|---|---|
| Assignments with task `review` that never had a work round of kind `consolidation` (the old "Annotation review") | **deleted** with their work (below) |
| Drafts and submissions with `mode = 'assisted'`, and the annotate assignments bound to them | **deleted** with their work |
| Consolidation rounds whose draft decisions (`review_decisions.payload->'consolidation'->>'action'`) or submitted decisions (`submissions.payload` decisions) contain `keep_both` or `term_choices` | **deleted** with their consolidator assignment and work; the text returns to "ready to compare" and the lead consolidates again |
| `user_preferences` rows whose mode is `assisted` (and `review`, if `PreferenceMode` drops it) | **converted** to `independent` |
| Audit events | kept (ids only, no FKs) |

"Work" of a purged assignment or round = its `work_rounds` (and `work_round_state`, `round_inputs`, `round_workspace_bindings`, `round_submission_bindings`), drafts (`drafts` cascade to `draft_annotations`, `draft_evidence`, `review_decisions`; `draft_snapshots`), submissions, `text_change_resolutions`, `task_holds`/`task_hold_state`, `problem_reports` and their state/events, `review_obligation_resolutions`, `workflow_command_receipts` and overview rows that reference them, `final_selections` (+ `final_selection_events`) and `export_selection_snapshots` that point at a purged submission. **Closure:** a consolidation round whose inputs include a purged submission is purged too; repeat until no new ids appear. Order deletes leaf-first; derive the exact FK list with `grep -rn "ForeignKey" src/ontocurator/storage/*.py` and cover every table that references `assignments`, `work_rounds`, `drafts`, `draft_snapshots` or `submissions` (also id columns without FK: `assignments.last_submission_id`, `assignments.active_round_id`, `work_round_state.latest_submission_id`, `final_selections.submission_id`).

`scripts/purge_annotation_work.py --project KEY [--case CASE --language LANG] --confirm` (M1, D4): purges every annotate assignment of the project (or one text) with its work using the same `work_purge` functions, prints a summary, refuses without `--confirm`; test `test_purge_script_removes_annotation_work_of_one_project` (another project untouched).

- [ ] **Step 1: Failing tests.**
  - `tests/test_legacy_removal_migration.py` (fixture shape, `_exec`, downgrade call and URL handling copied from `tests/test_overview_migration.py`, as P1's migration test describes; `REVISION = "0020"`, `PREVIOUS = "0019"`; seed with raw SQL at 0019: one project, two annotators, a consolidator; an ordinary review assignment with a round, draft, decision and submission; an `assisted` draft and an `assisted` submission bound to an annotate assignment; an `independent` submission and a consolidation round that took it and an `assisted` submission as inputs; a second consolidation round with a submitted `keep_both` decision and a final selection on its submission; a clean consolidation round; an `assisted` preference): `test_annotation_review_assignments_are_deleted_with_their_work`, `test_assisted_work_is_deleted`, `test_consolidations_over_deleted_inputs_are_deleted`, `test_keep_both_consolidations_and_their_final_selection_are_deleted`, `test_clean_consolidation_and_independent_work_stay`, `test_assisted_preferences_become_independent`, `test_no_reference_dangles` (for each id column above, a `NOT EXISTS` query returns no rows), `test_purge_logs_the_row_counts` (`caplog` holds one `0020 legacy purge:` record whose counts match the seeded legacy rows).
  - `tests/test_legacy_removal.py`: `test_review_task_is_not_assignable` (single, row-list POST, batch: `TASK_NOT_ASSIGNABLE` / 422 at request validation), `test_consolidation_start_still_assigns_the_consolidator`, `test_assisted_mode_is_unknown` (`/workspaces/open` with `assisted` → 422), `test_review_mode_cannot_be_opened_directly` (`MODE_NOT_ALLOWED`), `test_ordinary_review_round_is_refused` (`ROUND_KIND_INVALID`), `test_rows_have_no_annotation_review_state` (document-rows payload never contains `in_review` or `annotation_review_in_progress`), `test_allowed_modes_offer_only_from_scratch`.
- [ ] **Step 2:** implement; fix every test from Step 0 that used the removed paths (rewrite to a consolidation round, or delete when it only tested the removed feature; never weaken an unrelated assertion); `uv run pytest -n 4 tests/test_legacy_removal_migration.py tests/test_legacy_removal.py <the Step 0 test files> -q` → PASS; `uv run ruff check . && uv run ruff format --check . && uv run mypy src`.
- [ ] **Step 3: Contracts.** Regenerate (`WorkspaceMode` without `assisted`, task literals of assign/batch requests without `review`, next-step and state enums without the annotation-review values, `SubmissionKind` without `review`; error code `TASK_NOT_ASSIGNABLE` with the message `This task can no longer be assigned.`); minimal frontend compile fix in the files named in Owns (delete the removed branches and options, no new UI; U1 does the wording); fixtures drop removed values; `npm --prefix frontend run typecheck`; `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/documents tests/caseScreen.test.tsx tests/session.test.tsx tests/assignmentApp.test.tsx tests/layerState.test.ts tests/caseTree.test.tsx tests/layerControls.test.tsx tests/firstRun.test.tsx tests/decisionSemantics.test.ts` for the touched files' tests (update expectations that asserted removed options; drop `assisted` cases or switch them to `independent`); `bash scripts/check.sh --only static`. Browser specs that use removed scenarios or labels (`frontend/browser/layers.spec.ts`, `reanchor.spec.ts`, `variant-admin.spec.ts`, plus Step 0 hits) are listed for T3 (not edited here).
- **Done:** `grep -rnE '"assisted"|OPEN_ASSISTED|annotation_review_in_progress|open_annotation_reviews' src frontend/src` → empty (generated files included after regeneration); task `review` is created only in `consolidation_start.py`; the migration tests prove deletion, conversion, logged counts and no dangling references; `grep -rln assisted frontend/tests` lists no unit test that uses the mode.
- **Commit:** `refactor(workflow): remove annotation review task, assisted mode and keep-both data`

### P1: Migration 0021, ORM, pure annotation-mode rule

- **Goal:** storage for the project setting, the per-text override and the per-assignment mode; the pure rule `text_mode`.
- **Spec:** §1 Q3 and "Constraints" (mode fixed per text).
- **Owns:** `src/ontocurator/storage/migrations/versions/0021_proposal_check.py` (create), `src/ontocurator/storage/tables.py` (`ProjectRow`, `AssignmentRow`), `src/ontocurator/storage/plan_tables.py` (`WorkPlanFlagsRow`), `src/ontocurator/assignments/service.py` (one line in `_create`, see Step 4), `src/ontocurator/domain/annotation_modes.py` (create), `tests/test_proposal_check_migration.py` (create), `tests/test_annotation_modes_domain.py` (create), and the existing tests that insert annotate rows directly (Step 4): `tests/test_projects_api.py` (`:155`), `tests/test_variants_storage.py` (`:69`), `tests/test_guideline_assignment_view.py` (`:50`), `tests/test_distribution_context.py` (`:298`, `:353`, `:457`), `tests/test_work_plan_store.py` (`:81`), `tests/test_progress_export_api.py` (`:90`), `tests/test_assignments_schema.py` (`:46`, `:106`).
- **Size / lane / review:** M / backend / yes.
- **Prerequisites:** L1 merged for the post-phase (`ls src/ontocurator/storage/migrations/versions/0020_remove_legacy_workflows.py`).
- **Schedule (W1 pre, W2 post):** pre-phase during L1: the migration file `0021_proposal_check.py`, `storage/tables.py`, `storage/plan_tables.py`, `domain/annotation_modes.py`, `tests/test_proposal_check_migration.py` and `tests/test_annotation_modes_domain.py`; only the pure tests run (`uv run pytest tests/test_annotation_modes_domain.py -q`). Post-phase after L1 is merged (sync point): the `_create` line in `assignments/service.py`, the existing-test inserts of Step 4, the migration test and the other DB runs (Global rule 12).
- **Code to read:** `storage/migrations/versions/0016_work_plans.py:140-175` (column + check pattern), `0019_documents_overview.py:1-70` (header, backfill), `tests/test_overview_migration.py:1-130` (fixture pattern, downgrade), `storage/tables.py:84-140` (`ProjectRow`), `:790-830` (`AssignmentRow`), `storage/plan_tables.py:44-64`.

- [ ] **Step 1: Failing pure tests** `tests/test_annotation_modes_domain.py`:

```python
"""The annotation mode of a text (spec 2026-10-23 §1 Q3, plan "Pure rule")."""

import pytest

from ontocurator.domain.annotation_modes import TextMode, text_mode, workspace_mode


def mode(**kw):
    base = dict(
        project_mode="proposals", plan_override=None, proposal_count=17, work_modes=()
    )
    return text_mode(**(base | kw))


def test_project_setting_applies_to_texts_with_proposals():
    assert mode() == TextMode("proposals", "project", False)
    assert mode(project_mode="scratch") == TextMode("scratch", "project", False)


def test_texts_without_proposals_are_always_from_scratch():
    assert mode(proposal_count=0) == TextMode("scratch", "no_proposals", False)
    assert mode(proposal_count=0, plan_override="proposals") == TextMode(
        "scratch", "no_proposals", False
    )


def test_plan_override_wins_over_project_setting():
    assert mode(plan_override="scratch") == TextMode("scratch", "plan", False)
    assert mode(project_mode="scratch", plan_override="proposals") == TextMode(
        "proposals", "plan", False
    )


def test_oldest_work_locks_the_mode():
    locked = mode(
        project_mode="scratch",
        plan_override="scratch",
        work_modes=("proposals", "scratch"),
    )
    assert locked == TextMode("proposals", "locked", True)


def test_lock_holds_without_proposals():
    assert mode(proposal_count=0, work_modes=("proposals",)) == TextMode(
        "proposals", "locked", True
    )


@pytest.mark.parametrize(
    ("task", "annotation_mode", "expected"),
    [
        ("annotate", "proposals", "proposal_check"),
        ("annotate", "scratch", "independent"),
        ("review", None, "review"),
    ],
)
def test_workspace_mode_of_an_assignment(task, annotation_mode, expected):
    assert workspace_mode(task, annotation_mode) == expected


def test_annotate_without_a_mode_is_an_error():
    with pytest.raises(ValueError):
        workspace_mode("annotate", None)


def test_translation_review_has_no_workspace_mode():
    with pytest.raises(ValueError):
        workspace_mode("translation_review", None)
```

- [ ] **Step 2:** `uv run pytest tests/test_annotation_modes_domain.py -q` → FAIL (module missing). Create `src/ontocurator/domain/annotation_modes.py`:

```python
"""The annotation mode of a text (spec 2026-10-23 §1, decisions Q1-Q3, D2).

A text with tool proposals is annotated from proposals ("proposals") or from
scratch ("scratch"); a text without proposals is always annotated from
scratch. The project setting applies unless the text's plan overrides it; the
oldest annotation work on the text fixes the mode (stored on the assignment),
so existing work never mixes modes.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

AnnotationMode = Literal["proposals", "scratch"]
ANNOTATION_MODES: tuple[AnnotationMode, ...] = ("proposals", "scratch")
ModeSource = Literal["no_proposals", "locked", "plan", "project"]
# Mirrors domain.workspace.WorkspaceMode once P2 adds proposal_check; kept
# local so this module stays import-free of the workspace models.
WorkspaceModeName = Literal["independent", "review", "proposal_check"]


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
    work_modes: Iterable[AnnotationMode],
) -> TextMode:
    """``work_modes``: modes of the text's annotation work, oldest first
    (non-revoked annotate assignments, revoked ones with submitted work, and
    annotation submissions; plan "Pure rule" 1). ``proposal_count`` counts
    the newest proposal set of the text's target document."""
    work = list(work_modes)
    if work:
        return TextMode(work[0], "locked", True)
    if proposal_count == 0:
        return TextMode("scratch", "no_proposals", False)
    if plan_override is not None:
        return TextMode(plan_override, "plan", False)
    return TextMode(project_mode, "project", False)


def workspace_mode(
    task: str, annotation_mode: AnnotationMode | None
) -> WorkspaceModeName:
    """The workspace an assignment opens (replaces ``MODE_FOR_TASK[task]``)."""
    if task == "review":
        return "review"  # the consolidator's workspace (L1: consolidation only)
    if task == "annotate":
        if annotation_mode is None:
            raise ValueError(
                "An annotate assignment always has a mode (migration 0021)"
            )
        return "proposal_check" if annotation_mode == "proposals" else "independent"
    raise ValueError(f"Task {task!r} has no annotation workspace")
```

`uv run pytest tests/test_annotation_modes_domain.py -q` → PASS.

- [ ] **Step 3: Failing migration tests** `tests/test_proposal_check_migration.py` (fixture shape, `_exec`, downgrade call and URL handling copied from `tests/test_overview_migration.py`; the fixture yields `(url, engine)` like there):

```python
"""Migration 0021: tool proposal mode, plan override, assignment mode."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from alembic import command
from pg_harness import unmigrated_database_url
from sqlalchemy import Connection, Engine, create_engine, text
from sqlalchemy.exc import IntegrityError

from ontocurator.storage.schema import alembic_config, upgrade

REVISION = "0021"
PREVIOUS = "0020"
S = "ontocurator"


def _exec(conn: Connection, sql: str, **params: Any) -> Any:
    return conn.execute(text(sql), params)


def _seed(conn: Connection) -> None:
    _exec(
        conn,
        f"INSERT INTO {S}.projects (project_key, name, manifest, manifest_sha256,"
        " task_profile, task_profile_sha256) VALUES ('old', 'old', '{}', 'm', '{}', 't')",
    )
    _exec(
        conn,
        f"INSERT INTO {S}.users (username, display_name, pseudonym)"
        " VALUES ('ann', 'Ann', 'ann-0001')",
    )
    _exec(
        conn,
        f"INSERT INTO {S}.documents (project_id, document_id, language, text,"
        " case_id, external_id, version, origin, text_sha256)"
        f" SELECT id, 'd1', 'en', 'x', 'c1', 'c1', 1, 'native', 'h' FROM {S}.projects",
    )
    for task in ("annotate", "review", "translation_review"):
        _exec(
            conn,
            f"INSERT INTO {S}.assignments (project_id, document_id, user_id, task, status)"
            f" SELECT p.id, 'd1', u.id, :task, 'open' FROM {S}.projects p, {S}.users u",
            task=task,
        )
    _exec(
        conn,
        f"INSERT INTO {S}.work_plan_rows (project_id, case_id, language, review,"
        f" annotate, decided) SELECT id, 'c1', 'en', false, true, true FROM {S}.projects",
    )


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


def test_existing_projects_keep_scratch_and_new_projects_get_proposals(migrated):
    _url, engine = migrated
    with engine.begin() as conn:
        assert (
            _exec(conn, f"SELECT tool_proposal_mode FROM {S}.projects").scalar_one()
            == "scratch"
        )
        _exec(
            conn,
            f"INSERT INTO {S}.projects (project_key, name, manifest, manifest_sha256,"
            " task_profile, task_profile_sha256) VALUES ('new', 'new', '{}', 'm', '{}', 't')",
        )
        assert (
            _exec(
                conn,
                f"SELECT tool_proposal_mode FROM {S}.projects"
                " WHERE project_key = 'new'",
            ).scalar_one()
            == "proposals"
        )


def test_existing_annotate_assignments_are_scratch_others_null(migrated):
    _url, engine = migrated
    with engine.begin() as conn:
        rows = dict(
            _exec(conn, f"SELECT task, annotation_mode FROM {S}.assignments").all()
        )
    assert rows == {"annotate": "scratch", "review": None, "translation_review": None}


def test_plan_override_is_null_by_default(migrated):
    _url, engine = migrated
    with engine.begin() as conn:
        assert (
            _exec(conn, f"SELECT annotation_mode FROM {S}.work_plan_rows").scalar_one()
            is None
        )


@pytest.mark.parametrize(
    "sql",
    [
        f"UPDATE {S}.projects SET tool_proposal_mode = 'maybe'",
        f"UPDATE {S}.work_plan_rows SET annotation_mode = 'assisted'",
        f"UPDATE {S}.assignments SET annotation_mode = NULL WHERE task = 'annotate'",
        f"UPDATE {S}.assignments SET annotation_mode = 'proposals' WHERE task = 'review'",
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
        names = _exec(
            conn,
            "SELECT column_name FROM information_schema.columns"
            " WHERE table_schema = :s AND column_name IN"
            " ('tool_proposal_mode', 'annotation_mode')",
            s=S,
        ).all()
    assert names == []
```

(If `alembic_config` takes other arguments, follow `tests/test_overview_migration.py`'s downgrade test exactly.)

- [ ] **Step 4:** `uv run pytest tests/test_proposal_check_migration.py -q` → FAIL. Create the migration:

```python
"""Proposal check: tool proposal mode, per-text override, assignment mode.

``projects.tool_proposal_mode`` is the project setting "Texts with tool
proposals" (new projects: from proposals; existing projects keep today's
annotation from scratch). ``work_plan_rows.annotation_mode`` overrides it per
text (NULL = project setting). ``assignments.annotation_mode`` fixes the mode
of an annotate assignment when it is created (spec 2026-10-23 §1 Q3).
"""

import sqlalchemy as sa
from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None
SCHEMA = "ontocurator"
MODES = "('proposals', 'scratch')"


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "tool_proposal_mode",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'scratch'"),
        ),
        schema=SCHEMA,
    )
    op.alter_column(
        "projects",
        "tool_proposal_mode",
        server_default=sa.text("'proposals'"),
        schema=SCHEMA,
    )
    op.create_check_constraint(
        op.f("ck_projects_tool_proposal_mode"),
        "projects",
        f"tool_proposal_mode IN {MODES}",
        schema=SCHEMA,
    )
    op.add_column(
        "work_plan_rows",
        sa.Column("annotation_mode", sa.Text(), nullable=True),
        schema=SCHEMA,
    )
    op.create_check_constraint(
        op.f("ck_work_plan_rows_annotation_mode"),
        "work_plan_rows",
        f"annotation_mode IN {MODES}",
        schema=SCHEMA,
    )
    op.add_column(
        "assignments",
        sa.Column("annotation_mode", sa.Text(), nullable=True),
        schema=SCHEMA,
    )
    op.execute(
        f"UPDATE {SCHEMA}.assignments SET annotation_mode = 'scratch'"
        " WHERE task = 'annotate'"
    )
    op.create_check_constraint(
        op.f("ck_assignments_annotation_mode"),
        "assignments",
        f"(task = 'annotate' AND annotation_mode IN {MODES})"
        " OR (task <> 'annotate' AND annotation_mode IS NULL)",
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("ck_assignments_annotation_mode"), "assignments", schema=SCHEMA
    )
    op.drop_column("assignments", "annotation_mode", schema=SCHEMA)
    op.drop_constraint(
        op.f("ck_work_plan_rows_annotation_mode"), "work_plan_rows", schema=SCHEMA
    )
    op.drop_column("work_plan_rows", "annotation_mode", schema=SCHEMA)
    op.drop_constraint(
        op.f("ck_projects_tool_proposal_mode"), "projects", schema=SCHEMA
    )
    op.drop_column("projects", "tool_proposal_mode", schema=SCHEMA)
```

ORM (must match exactly; `tests/test_schema.py:41` compares metadata):
- `ProjectRow.__table_args__` += `CheckConstraint("tool_proposal_mode IN ('proposals', 'scratch')", name="tool_proposal_mode")`; column `tool_proposal_mode: Mapped[str] = mapped_column(server_default=text("'proposals'"))` after `import_plan`.
- `AssignmentRow.__table_args__` += `CheckConstraint("(task = 'annotate' AND annotation_mode IN ('proposals', 'scratch')) OR (task <> 'annotate' AND annotation_mode IS NULL)", name="annotation_mode")`; column `annotation_mode: Mapped[str | None]`.
- `WorkPlanFlagsRow.__table_args__` += `CheckConstraint("annotation_mode IN ('proposals', 'scratch')", name="annotation_mode")`; column `annotation_mode: Mapped[str | None]` after `decided`.

**Inserts of annotate assignments must set `annotation_mode`** or the check refuses them. Decision (plan review R3): **NOT NULL for annotate rows, existing test inserts fixed here**, not "NULL = from scratch". Reason: a NULL would be a second spelling of "from scratch" that every reader (lock rule, read model, frontend, export) must remember, and no server default can express "only for annotate" without also hitting `translation_review` and `review` rows; the test edits are one keyword per insert. In `src` only `AssignmentService._create` inserts (`assignments/service.py:460`): add `annotation_mode="scratch" if task == "annotate" else None` to its `.values(...)` (P3 replaces this with the real rule). In tests, add `annotation_mode="scratch"` (ORM `insert(AssignmentRow).values(...)`) or the column `annotation_mode` with `'scratch'` (raw SQL) to every annotate insert listed in Owns; for an insert whose task is a parameter, set `annotation_mode="scratch" if task == "annotate" else None`. Then `grep -rnE "insert\(AssignmentRow\)|INSERT INTO .*assignments" tests scripts` must show no other annotate insert without a mode; if it does, stop and report (the orchestrator extends Owns).

- [ ] **Step 5:** `uv run pytest -n 4 tests/test_proposal_check_migration.py tests/test_schema.py tests/test_annotation_modes_domain.py tests/test_assignments.py tests/test_assignment_batch.py tests/test_projects_api.py tests/test_variants_storage.py tests/test_guideline_assignment_view.py tests/test_distribution_context.py tests/test_work_plan_store.py tests/test_progress_export_api.py tests/test_assignments_schema.py -q` → PASS; `uv run ruff check . && uv run ruff format --check . && uv run mypy src`.
- **Done:** constraints identical in migration and ORM; existing projects `scratch`, new `proposals`; annotate rows always carry a mode; every listed test insert fixed.
- **Commit:** `feat(workflow): store tool proposal mode, plan override and assignment mode`

### P2: Workspace mode `proposal_check` (contracts writer)

- **Goal:** a `proposal_check` workspace ("Annotate from proposals") behaves exactly like a review workspace over the **newest tool proposal set** of the text (targets, decisions, completeness, submission snapshots), belongs to the annotate task, counts as annotation work in every mode filter, and is labelled as such in histories and exports.
- **Spec:** §1 Q1, Q2; "A person annotating from scratch never sees proposals… A person annotating from proposals sees only the tool proposals"; §1 "Targets".
- **Owns:** `src/ontocurator/storage/proposal_queries.py` (create), `src/ontocurator/domain/workspace.py`, `src/ontocurator/domain/scopes.py`, `src/ontocurator/authz/policy.py`, `src/ontocurator/assignments/service.py` (only `TASK_FOR_MODE`), `src/ontocurator/application/workspaces.py`, `src/ontocurator/application/workspace_opening.py`, `src/ontocurator/application/reviews.py`, `src/ontocurator/application/submissions.py`, `src/ontocurator/application/editing.py`, `src/ontocurator/application/reanchor_resolutions.py`, `src/ontocurator/application/work_rounds.py` (sites below), `src/ontocurator/application/text_changes.py` (`:414` only), `src/ontocurator/authz/versions.py` (`:152` only), `src/ontocurator/storage/repository.py` (sites below), `src/ontocurator/api/document_projection.py`, `src/ontocurator/api/routes.py`, `src/ontocurator/domain/submission_labels.py`, `src/ontocurator/exchange/t1.py`, `src/ontocurator/exchange/final_export_guide.py` (`submission_kind` only), contracts (`contracts/openapi.json`, `frontend/src/api/generated.ts`), `tests/test_proposal_check_workspace.py` (create), `tests/test_proposal_queries.py` (create).
- **Size / lane / review:** L / backend / yes.
- **Schedule (W1 pre, W3 post):** pre-phase during L1 and P1: only `storage/proposal_queries.py`, `application/workspace_opening.py`, `application/reviews.py`, `application/submissions.py`, `application/editing.py`, `application/reanchor_resolutions.py`, `authz/versions.py`, `api/document_projection.py`, `api/routes.py`, `exchange/t1.py` and the two new test files, coded against L1's reduced mode set (`WorkspaceMode = Literal["independent", "review"]` before P2 adds `proposal_check`); no DB test run. Post-phase after P1 is merged (sync point; L1 is merged before P1): the files shared with L1 (`domain/workspace.py`, `domain/scopes.py`, `authz/policy.py`, `application/workspaces.py`, `work_rounds.py`, `text_changes.py`, `storage/repository.py`, `domain/submission_labels.py`, `exchange/final_export_guide.py`), `TASK_FOR_MODE`, the DB tests, Step 4 contracts (token 2, after U0's token step).
- **Code to read:** `application/workspaces.py:203-420` (open), `application/submissions.py:123-175, 400-460`, `application/work_rounds.py:115-157, 440-700`, `application/text_changes.py:390-420`, `storage/repository.py:368-400` (`workspace_input_snapshots`), `:1935-1990` (`list_annotations_for_document`, `_proposal_set_metadata_query`), `storage/tables.py:257-290, 733-777` (`ProposalAnnotationRow`, `ProposalSetRow`), `authz/policy.py:88-150`, `authz/versions.py:140-156`, `domain/submission_labels.py`, `exchange/t1.py:548-650`.
- **Facts verified (plan review R7):** today an ordinary review-mode round without sources targets **every** proposal snapshot of the document on editable layers (`work_rounds.py:677-690` via `repository.list_annotations_for_document`, which joins `proposal_annotations`, i.e. only imported tool proposals, never people's work), across **all** proposal sets of that document; the legacy open path without a round does the same through `get_review_inputs` (`workspaces.py:262-357`). `ProposalAnnotationRow.proposal_set_id` names the imported T1 set (NULL for seed packages); `ProposalSetRow` is append-only with an identity `id`. A review submission's `snapshots` are confirmed/uncertain targets + `changed` replacements + added findings (`submissions.py:413-456`), so a proposal-check submission is a complete annotation layer for consolidation. Mode filters that list "annotation work" by mode: `work_rounds.py:150` (`require_independent`, handover) and `text_changes.py:414` (`_work_on_row`), both `["independent", "assisted"]` on `main`, `["independent"]` after L1.

**`storage/proposal_queries.py`** (the only definition of "the newest proposal set"; plan "Proposal targets"):

```python
"""The newest tool proposal set of a document (spec 2026-10-23 §1 Targets).

Targets of an "Annotate from proposals" round, proposal counts (read model,
text view) and export precision all use this set. Seed-package proposals
(``proposal_set_id IS NULL``) form one set, used only when the document has
no imported set.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import Connection, func, select

from ontocurator.domain.annotations import AnnotationRef
from ontocurator.storage.tables import (
    AnnotationSnapshotRow,
    ProposalAnnotationRow,
    ProposalSetRow,
)


@dataclass(frozen=True)
class ProposalSetRef:
    id: int | None  # None: seed proposals without a set
    annotation_set_id: str | None


def newest_proposal_set(
    conn: Connection, project_id: int, document_id: str
) -> ProposalSetRef | None: ...
def newest_proposal_refs(
    conn: Connection, project_id: int, document_id: str
) -> list[AnnotationRef]: ...
def newest_proposal_counts(conn: Connection, project_id: int) -> dict[str, int]:
    """Proposals of the newest set per document id (documents without proposals absent); one query."""
```

Implement with `ProposalAnnotationRow` joined to `AnnotationSnapshotRow` on `(project_id, annotation_id, version)`, `AnnotationSnapshotRow.document_id == document_id`, newest set = `max(proposal_set_id)` among the document's proposal rows (window function or a grouped subquery for the per-document counts); ordered by `(annotation_id, version)` like `list_annotations_for_document`. Layer filtering (editable layers of the scope) stays with the callers. The re-anchor selection of pending proposal sets on open (`pending_proposal_set_ids`, `REANCHOR_PENDING_SELECTION_REQUIRED`, `workspaces.py:210-215`) keeps working for `proposal_check` exactly as for review; the newest-set rule only decides the initial targets.

Edit list (each `mode == "review"` that means "has targets and decisions" becomes `is_review_like(mode)`; those meaning the consolidator's task or consolidation stay `"review"`):

| Site | Change |
|---|---|
| `domain/scopes.py:12`, `domain/workspace.py:14` | `WorkspaceMode = Literal["independent", "review", "proposal_check"]` (L1 already removed `assisted`); in `scopes.py` add `REVIEW_LIKE_MODES: frozenset[str] = frozenset({"review", "proposal_check"})` and `def is_review_like(mode: str) -> bool: return mode in REVIEW_LIKE_MODES`; `build_scope` unchanged (non-independent modes get reference layers; `mode` is part of the scope hash, so the scope id differs from review) |
| `authz/policy.py` | `Action.OPEN_PROPOSAL_CHECK = "open_proposal_check"`, added to `ROLE_ACTIONS["annotator"]`; `MODE_ACTIONS["proposal_check"] = Action.OPEN_PROPOSAL_CHECK`; **`MODE_ORDER` unchanged and `application/preferences.py PreferenceMode` unchanged** (plan review R19: the mode is driven by the assignment, never chosen or remembered as a preference) |
| `assignments/service.py:68-72` | `TASK_FOR_MODE["proposal_check"] = "annotate"` (nothing else in this file) |
| `application/workspaces.py:211` | `key.mode == "review"` → `is_review_like(key.mode)` |
| `application/workspaces.py:262-357` (review `else` branch) | logic unchanged; `list_workspace_keys(..., "review", ...)` → `(..., key.mode, ...)`; `get_review_inputs(project_key, document_id, mode="review")` builds its scope with `mode` and the branch passes `key.mode`; **for `proposal_check` the targets come from `newest_proposal_refs`** (filtered by the scope's editable layers), not from `list_annotations_for_document` |
| `application/workspace_opening.py:43` | `key.mode != "review"` → `not is_review_like(key.mode)` |
| `application/reviews.py:50` | refuse unless `is_review_like(key.mode)` |
| `application/submissions.py:140, 369, 413` | `is_review_like(...)` |
| `application/editing.py:525`, `application/reanchor_resolutions.py:30, 76` | `is_review_like(...)` |
| `application/work_rounds.py:677, 680, 700` | `is_review_like(mode)`; the ordinary round without sources for `proposal_check` targets `newest_proposal_refs(...)` filtered by `scope.editable_layer_ids` (L1 already deleted the ordinary `review` branch); **`:475` stays `mode != "review"`** (consolidation only on the consolidator's task) |
| `application/work_rounds.py:150`, `application/text_changes.py:414` | `SubmissionRow.mode.in_(["independent", "proposal_check"])` (plan review R9: a submitted "from proposals" annotation is annotation work for handover and text-change checks) |
| `authz/versions.py:152` | own-submission label by kind instead of `'review' if … else 'annotate'`: `My annotation, from proposals, {created_at}` (mode `proposal_check`), `My annotation, from scratch, {created_at}` (`independent`), `My consolidation, {created_at}` (`review`) (R9) |
| `storage/repository.py:2041, 2360, 2425, 2941` | `is_review_like(...)` |
| `api/document_projection.py:232, 348, 370` | `is_review_like(mode)` |
| `api/routes.py:384` | `/workspaces/review-inputs` accepts `is_review_like(req.mode)` |
| `domain/submission_labels.py:45` | returns `"proposal_check"` for mode `proposal_check` (extend `SubmissionKind`) |
| `exchange/t1.py:612` | decisions exported for `is_review_like(key.mode)` (proposal URN in `source_refs`, method `adopted`/`edited`); `:763` `blind=key.mode == "independent"` unchanged (internal T1 field name) |
| `exchange/final_export_guide.py:54` | `submission_kind` returns `"proposal_check"` for `origin_key.mode == "proposal_check"` |

Kept `independent`-only on purpose: `application/text_changes.py:495, 1190`, `application/work_rounds.py:481-492, 570`, `api/work_round_routes.py:259` (carrying "from proposals" work to a new text version is not offered, plan decision A6; P4 gives the refusals their own reason).

- [ ] **Step 1: Failing tests** `tests/test_proposal_check_workspace.py` (the seed-package environment of `tests/test_reviews.py`):

```python
"""Workspace mode proposal_check (spec 2026-10-23 §1): the review screen over
the newest tool proposal set of the text, owned by the annotate task."""

from __future__ import annotations

from pathlib import Path

import pytest
from test_reviews import _setup_review_test_env

from ontocurator.application.editing import CheckLayerCommand
from ontocurator.application.reviews import DecisionCommand
from ontocurator.application.submissions import SubmitCommand
from ontocurator.assignments.service import TASK_FOR_MODE
from ontocurator.authz.policy import MODE_ACTIONS, MODE_ORDER, ROLE_ACTIONS, Action
from ontocurator.domain.errors import DomainError, IncompleteReview
from ontocurator.domain.scopes import build_scope, is_review_like
from ontocurator.domain.submission_labels import submission_kind
from ontocurator.domain.workspace import MutationEnvelope, WorkspaceKey
from ontocurator.storage.proposal_queries import newest_proposal_refs


def _key(annotator: str = "checker-1") -> WorkspaceKey:
    return WorkspaceKey(
        project_key="pkg-rev-1",
        document_id="doc-1",
        annotator_id=annotator,
        mode="proposal_check",
        target_set_id="targets-0",
    )


def _env(payload, mutation, revision) -> MutationEnvelope:
    return MutationEnvelope(
        mutation_id=mutation, expected_revision=revision, payload=payload
    )


def test_mode_is_review_like_and_belongs_to_annotate():
    assert is_review_like("proposal_check") and is_review_like("review")
    assert not is_review_like("independent")
    assert TASK_FOR_MODE["proposal_check"] == "annotate"
    assert MODE_ACTIONS["proposal_check"] == Action.OPEN_PROPOSAL_CHECK
    assert Action.OPEN_PROPOSAL_CHECK in ROLE_ACTIONS["annotator"]
    assert Action.OPEN_PROPOSAL_CHECK not in ROLE_ACTIONS["adjudicator"]
    assert "proposal_check" not in MODE_ORDER  # driven by the assignment (R19)


def test_scope_differs_from_review(tmp_path: Path):
    ctx = _setup_review_test_env(tmp_path)
    profile = ctx["repo"].get_task_profile("pkg-rev-1")  # plan review R17
    check = build_scope(profile, "proposal_check")
    review = build_scope(profile, "review")
    assert check.scope_id != review.scope_id
    assert check.reference_layer_ids == review.reference_layer_ids


def test_targets_are_the_newest_proposal_set(tmp_path: Path):
    ctx = _setup_review_test_env(tmp_path)
    view = ctx["ws_svc"].open(_key())
    with ctx["repo"].db.transaction() as conn:
        pid = ctx["repo"].project_id(
            conn, "pkg-rev-1"
        )  # adapt to the repository's lookup
        refs = newest_proposal_refs(conn, pid, "doc-1")
    editable = {
        (s.annotation.annotation_id, s.version)
        for s in ctx["repo"].list_annotations_for_document("pkg-rev-1", "doc-1")
        if s.annotation.layer_id in view.scope.editable_layer_ids
    }
    expected = {(r.annotation_id, r.version) for r in refs} & editable
    assert {(t.annotation_id, t.version) for t in view.targets.targets} == expected
    assert view.key.mode == "proposal_check"


def test_every_proposal_needs_a_decision_and_submission_keeps_confirmed(tmp_path: Path):
    ctx = _setup_review_test_env(tmp_path)
    view = ctx["ws_svc"].open(_key())
    key, targets = view.key, list(view.targets.targets)
    assert len(targets) >= 2
    revision = 0
    ctx["edit_svc"].apply(
        key,
        _env(
            CheckLayerCommand(
                kind="check_layer", layer_id="hpo-layer", checked=True
            ).model_dump(),
            "chk",
            revision,
        ),
    )
    revision += 1
    with pytest.raises((IncompleteReview, DomainError)):
        ctx["sub_svc"].submit(
            key,
            _env(SubmitCommand(document_checked=True).model_dump(), "early", revision),
        )
    outcomes = ["confirmed", "rejected"] + ["confirmed"] * (len(targets) - 2)
    for index, (target, outcome) in enumerate(zip(targets, outcomes, strict=True)):
        ctx["rev_svc"].decide(
            key,
            _env(
                DecisionCommand(target=target, outcome=outcome).model_dump(),
                f"d{index}",
                revision,
            ),
        )
        revision += 1
    submission = ctx["sub_svc"].submit(
        key, _env(SubmitCommand(document_checked=True).model_dump(), "submit", revision)
    )
    kept = {(s.annotation.annotation_id, s.version) for s in submission.snapshots}
    assert (targets[1].annotation_id, targets[1].version) not in kept
    assert (targets[0].annotation_id, targets[0].version) in kept
    assert submission.origin_key.mode == "proposal_check"
    assert len(submission.decisions) == len(targets)


def test_submission_kind_is_proposal_check():
    assert submission_kind(None, "proposal_check") == "proposal_check"
    assert submission_kind(None, "independent") == "annotation"
    assert submission_kind("consolidation", "review") == "consolidation"


def test_handover_refuses_a_person_with_a_submitted_proposal_check(tmp_path: Path):
    """``work_rounds.require_independent`` counts a submitted proposal check (R9)."""
```

The last body: submit a proposal check as in the test above, then call `require_independent(conn, pid, case_id=…, language=…, user_id=…, pseudonym="checker-1", excluding=None)` (read the document's `case_id`/`language` and the user id of `checker-1` from the seed environment; create the user row with `work_plan_support._user` if the seed has none) and expect `DomainError` code `HANDOVER_NOT_INDEPENDENT`. Adapt the project-id lookup line to what `Repository` offers (`grep -n "def .*project_id\|def _project_id" src/ontocurator/storage/repository.py`). If the seed environment has fewer than two proposals on `hpo-layer`, assert on the actual target count instead of `>= 2` and decide with `rejected` on the last one.

`tests/test_proposal_queries.py`:
- `test_newest_set_wins` (heavy: `t1_fixtures.create_project`, import one bundle with set `set-a` (p1, p2) and then a second bundle with set `set-b` (p3) for the same document through `run_import`; `newest_proposal_refs` → only p3; `newest_proposal_counts` → `{doc: 1}`; `newest_proposal_set(...).annotation_set_id == "set-b"`).
- `test_seed_proposals_without_a_set_form_one_set` (seed environment `pkg-rev-1`: refs equal every proposal of `list_annotations_for_document`).
- `test_documents_without_proposals_are_absent_from_the_counts`.

(Check how `t1_builders.bundle` names the annotation set: `grep -n "annotation_set_id\|set_id" tests/t1_builders.py`.)

- [ ] **Step 2:** `uv run pytest -n 4 tests/test_proposal_check_workspace.py tests/test_proposal_queries.py -q` → FAIL. Implement `proposal_queries.py` and the edit list.
- [ ] **Step 3:** `uv run pytest -n 4 tests/test_proposal_check_workspace.py tests/test_proposal_queries.py tests/test_reviews.py tests/test_review_validation_regressions.py tests/test_review_roundtrip_regressions.py tests/test_t1_export.py tests/test_assignment_round_open_api.py tests/test_consolidation_start_api.py tests/test_annotation_versions.py tests/test_handover*.py tests/test_text_change*.py -q` (expand globs with `ls`) and `uv run pytest -n 4 $(ls tests/test_final_export*.py) -q` → PASS; `uv run ruff check . && uv run ruff format --check . && uv run mypy src`.
- [ ] **Step 4: Contracts (token 2).** `uv run python scripts/export_openapi.py && npm --prefix frontend run api:generate` (`WorkspaceMode` and the submission kind gain `proposal_check`; additive); `npm --prefix frontend run typecheck` → clean (an exhaustive `Record` over these unions that now fails: stop and report, the orchestrator adds the file to Owns); `bash scripts/check.sh --only static`.
- **Done:** every site of the edit list changed or explicitly kept; targets and counts come only from `proposal_queries.py`; `review`/`independent` behaviour unchanged (existing tests green).
- **Commit:** `feat(workspace): annotate from proposals over the newest proposal set`

### P3: Annotation mode on assignments, per-text limit, remove with draft discard, "Annotate from proposals myself" (contracts writer)

- **Goal:** an annotate assignment gets its mode from the rule and opens only the matching workspace; "annotations per text" is enforced on every assign path; an unsubmitted assignment can be removed and its draft is really discarded; the lead can annotate a text from proposals themselves; one shared helper answers "which text is this document" and "which document is the text's target".
- **Spec:** §1 Q2, Q3, "Constraints" (lock incl. submitted work, limit per version, new versions); §2 Annotation part (chips ✕, "Annotate from proposals myself", F24); Small fixes "Annotations per text is enforced".
- **Facts verified:** the limit is only enforced by batch assign (`assignments/batch.py:218-220, 570`), whose planner counts only **non-revoked** annotate assignments (`batch.py:205-221`, `_work`); batch saves go through `_assign_locked` (`batch.py:774`), and one refusal there rolls back the whole batch (`batch.py:7`), so the planner and the guard must count the same way; single `AssignmentService.assign` → `_assign_locked` (`service.py:572-616`) and distribution confirmations (calls `_assign_locked`) do not check it, which is how the test-server case cons-three got a third annotation (seeded through `POST /projects/{key}/assignments`). `revoke` (`service.py:743`) has no status guard; `projects/assignments.py:48 revoke_assignments` revokes "preserving submissions and drafts". **A re-assignment would resurface the old draft:** without an active round, `/assignments/{id}/open` opens the workspace by key (`project, document, annotator pseudonym, mode`), and `WorkspaceService.open` resumes an existing draft of that key (`application/workspaces.py:236-300`: `repo.open_draft(key)` for `independent`, `list_workspace_keys(...)` for review-like modes) (plan review R12). Self-consolidation grants a role under the members lock EXCLUSIVE (`application/consolidation_start.py:126-190`, `authz/memberships.py:79 grant_roles`). The text of a document and its target version are derived today in two places (`eligibility.load_variants`/`check_work_plan`, `text_changes.current_target` via `_row_target(_chain(...))`).
- **Owns:** `src/ontocurator/application/text_targets.py` (create), `src/ontocurator/application/annotation_modes.py` (create), `src/ontocurator/assignments/service.py`, `src/ontocurator/assignments/batch.py` (annotate count in `_Rows`/`_target` only), `src/ontocurator/authz/memberships.py` (`grant_lead_self_role`), `src/ontocurator/application/consolidation_start.py` (the inline self-grant replaced by `grant_lead_self_role` only), `src/ontocurator/api/assignment_routes.py`, `src/ontocurator/application/work_rounds.py` (`:447-451` only), `src/ontocurator/application/problem_reports.py` (`:330-335` only), `src/ontocurator/authz/scoped.py` (`require_workable` only), `src/ontocurator/authz/versions.py` (`may_read_proposals` only), `src/ontocurator/storage/repository.py` (`discard_drafts` helper only), `src/ontocurator/domain/admin_error_codes.py`, contracts, `frontend/src/api/client.ts` (`removeAssignment`), `frontend/src/admin/errors.ts` (messages), `frontend/tests/documents/fixtures.ts` (defaults), `tests/proposal_check_support.py` (create), `tests/test_text_targets.py` (create), `tests/test_proposal_check_assignments.py` (create), `tests/test_annotations_per_text_limit.py` (create), plus test files of existing tests that break because they relied on exceeding the limit (list them in the hand-back; expected candidates: `tests/browser_overview_scenarios.py` `assign_and_annotate`, `tests/test_browser_overview_fixture.py`).
- **Size / lane / review:** L / backend / yes.
- **Code to read:** `assignments/service.py:240-620, 743-873`, `assignments/batch.py:160-230, 740-800`, `assignments/eligibility.py:27-60, 120-199` (`load_variants`, `check_work_plan`), `application/text_changes.py:259-283` (`_chain`, `current_target`), `domain/document_rows.py:110-125` (`newest`), `application/consolidation_start.py:97-230`, `application/workspaces.py:203-300`, `projects/assignments.py:48-80`, `storage/repository.py` (`open_draft`, `list_workspace_keys`, draft tables), `api/assignment_routes.py:90-130, 470-560`, `authz/scoped.py:180-205`, `authz/versions.py:35-60`, `tests/work_plan_support.py` (whole), `tests/auth_harness.py:135-160`.
- **Prerequisites:** `grep -n "def newest_proposal_refs" src/ontocurator/storage/proposal_queries.py` (P2); `grep -c '"assisted"' src/ontocurator/domain/workspace.py` → 0 (L1); contracts token 3.
- **Schedule (W3 pre, W5 post):** pre-phase after P1 is merged, during P2's post-phase: only `application/text_targets.py`, `application/annotation_modes.py`, `authz/memberships.py` (`grant_lead_self_role`), `application/consolidation_start.py`, `assignments/batch.py`, `api/assignment_routes.py`, `application/problem_reports.py`, `authz/scoped.py`, `tests/proposal_check_support.py` and the new test files, coded against P2's `storage/proposal_queries.py` names ("Shared contracts"); pure tests only. Post-phase after P2 is merged (sync point): `assignments/service.py`, `work_rounds.py`, `authz/versions.py`, `storage/repository.py`, the DB tests, the existing tests broken by the limit, Step 4 contracts (token 3). Existing tests broken by the limit that P7 owns while P7 is unmerged (`tests/test_browser_consolidation_fixture.py`) are reported, not edited; P7 fixes them after its sync.

**`application/text_targets.py`** (plan review R11: the one helper; P4, P5 and P8 import it, nobody re-derives):

```python
"""The text (case + language) of a document and the text's target document."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import Connection


@dataclass(frozen=True)
class TextRow:
    case_id: str
    language: str


def text_row(conn: Connection, project_id: int, document_id: str) -> TextRow: ...
def text_documents(conn: Connection, project_id: int, row: TextRow) -> list[str]:
    """Every version's document id of the text, oldest first."""


def text_target_document(conn: Connection, project_id: int, row: TextRow) -> str:
    """The newest counted version: the document new work goes to."""
```

Implement by **moving** the existing derivation (the one `text_changes.current_target` uses: `_chain` + `_row_target`, and the `(case_id, language)` of `load_variants`), not by writing a third one; `text_changes.py` keeps its private functions until P4 (its owner) switches to this module. `tests/test_text_targets.py`: native text with one version; translation with versions 1 and 2 (target = 2); a discarded version is never the target; the result equals `TextChangeService.current_target` for the same document.

**`application/annotation_modes.py`** (DB facts for the pure rule; reused by P4, P5, P8):

```python
"""Database facts of the annotation-mode rule (domain/annotation_modes.py)."""

from __future__ import annotations

from sqlalchemy import Connection, select

from ontocurator.application.text_targets import text_documents, text_row
from ontocurator.domain.annotation_modes import AnnotationMode, TextMode, text_mode
from ontocurator.storage.plan_tables import WorkPlanFlagsRow
from ontocurator.storage.proposal_queries import newest_proposal_refs
from ontocurator.storage.tables import AssignmentRow, ProjectRow, SubmissionRow

SUBMISSION_MODES: dict[str, AnnotationMode] = {
    "proposal_check": "proposals",
    "independent": "scratch",
}


def work_modes(
    conn: Connection, project_id: int, documents: list[str]
) -> list[AnnotationMode]:
    """Modes of the text's annotation work, oldest first (plan "Pure rule" 1):
    non-revoked annotate assignments, revoked ones with submitted work, and
    annotation submissions (also without an assignment)."""
    assignments = conn.execute(
        select(AssignmentRow.created_at, AssignmentRow.annotation_mode).where(
            AssignmentRow.project_id == project_id,
            AssignmentRow.task == "annotate",
            AssignmentRow.document_id.in_(documents),
            AssignmentRow.revoked_at.is_(None)
            | AssignmentRow.last_submission_id.is_not(None),
        )
    ).all()
    submissions = conn.execute(
        select(SubmissionRow.recorded_at, SubmissionRow.mode).where(
            SubmissionRow.project_id == project_id,
            SubmissionRow.document_id.in_(documents),
            SubmissionRow.mode.in_(list(SUBMISSION_MODES)),
        )
    ).all()
    work = [(at, mode) for at, mode in assignments] + [
        (at, SUBMISSION_MODES[mode]) for at, mode in submissions
    ]
    return [mode for _at, mode in sorted(work, key=lambda item: item[0])]


def load_text_mode(conn: Connection, project_id: int, document_id: str) -> TextMode:
    """The effective mode of the text holding ``document_id``; the proposal
    count is that of ``document_id`` (callers pass the target document)."""
    row = text_row(conn, project_id, document_id)
    project_mode: AnnotationMode = conn.execute(
        select(ProjectRow.tool_proposal_mode).where(ProjectRow.id == project_id)
    ).scalar_one()
    override = conn.execute(
        select(WorkPlanFlagsRow.annotation_mode).where(
            WorkPlanFlagsRow.project_id == project_id,
            WorkPlanFlagsRow.case_id == row.case_id,
            WorkPlanFlagsRow.language == row.language,
        )
    ).scalar_one_or_none()
    return text_mode(
        project_mode=project_mode,
        plan_override=override,
        proposal_count=len(newest_proposal_refs(conn, project_id, document_id)),
        work_modes=work_modes(conn, project_id, text_documents(conn, project_id, row)),
    )
```

(`created_at`/`recorded_at` are both timestamps; if `SubmissionRow.recorded_at` is not comparable with `AssignmentRow.created_at` in this schema, order assignments and submissions by their own column and take the assignment's mode first when both exist; read `storage/tables.py` first.)

**Service changes (`assignments/service.py`):**
- `Assignment` gains `annotation_mode: AnnotationMode | None = None`; `_assignments()` selects `AssignmentRow.annotation_mode`.
- `MODE_FOR_TASK` is deleted; every use calls `workspace_mode(task, annotation_mode)` (`api/assignment_routes.py:483, 501`, `application/work_rounds.py:447-451` reading `assignment["annotation_mode"]`, `application/problem_reports.py:330-335`). `TASK_FOR_MODE` stays.
- `_create(..., annotation_mode: AnnotationMode | None = None)`: for `task == "annotate"` and `annotation_mode is None` → `mode = load_text_mode(conn, project["id"], document_id)`; if `mode.locked and mode.mode == "proposals"` and the document has no proposals (`newest_proposal_refs(...) == []`) → `DomainError("NO_PROPOSALS_ON_VERSION", {"document_id": document_id})` (plan review R10: a new version of a text whose annotation started from proposals needs its own proposals); stores `mode.mode` (replaces P1's placeholder). `reassign` passes `old["annotation_mode"]`.
- **One count for the limit** (module-level in `assignments/service.py`, used by `_assign_locked` and the batch planner, so a batch save never refuses a row its planner offered):

```python
def held_annotations(
    conn: Connection, project_id: int, document_ids: Iterable[str]
) -> Counter[str]:
    """Annotate assignments that fill a version's "annotations per text" slots:
    not revoked, or revoked with submitted work (that submission is an
    annotation of the version). The one count for ``_assign_locked`` and the
    batch planner."""
    wanted = list(document_ids)
    if not wanted:
        return Counter()
    return Counter(
        dict(
            conn.execute(
                select(AssignmentRow.document_id, func.count())
                .where(
                    AssignmentRow.project_id == project_id,
                    AssignmentRow.document_id.in_(wanted),
                    AssignmentRow.task == "annotate",
                    AssignmentRow.revoked_at.is_(None)
                    | AssignmentRow.last_submission_id.is_not(None),
                )
                .group_by(AssignmentRow.document_id)
            )
            .tuples()
            .all()
        )
    )
```

- `_assign_locked`, after the `existing` checks and before `check_assignable`, for `task == "annotate"`:

```python
            limit = int(project["annotations_per_text"])
            held = held_annotations(conn, project["id"], [document_id])[document_id]
            if held >= limit:
                raise DomainError(
                    "ANNOTATIONS_PER_TEXT_REACHED", {"limit": limit, "assigned": held}
                )
```

- Batch planner (`assignments/batch.py`): `_Rows.__init__` loads `held_annotations(conn, pid, <document ids of the rows>)` once; `_target` computes `remaining = self.facts.annotations_per_text - self.held[version.document_id]` for `annotate` instead of `len(work)` (`_work` stays for the holders and the other tasks).

- **The limit is per version (`document_id`) on purpose, while the mode lock spans the whole text** (plan review R25): an annotation belongs to the version it was made on and Finalization compares annotations of one version; a new version needs its own annotations (earlier versions' work is not counted against it), but it must not switch between "from proposals" and "from scratch", because the text's results would then mix two ways of working. Revoked assignments with submitted work still count (their submission is an annotation of that version).
- The guard sits only in `_assign_locked`, so it covers single assign, the row-list POST, distribution confirmations and batch saves (`batch.py:774`), and **not** `reassign` (which calls `check_assignable(check_plan=False)`, revokes the old row, then `_create`) nor consolidation start (task `review`). The manual seed of cons-three (limit 2, third annotate row) is refused from now on; that is intended (test data only, note it in M1).
- New `remove(self, actor: Actor, assignment_id: int) -> Assignment`: same locking as `revoke`; raises `ASSIGNMENT_REVOKED` when already revoked, `ASSIGNMENT_SUBMITTED` when `status == "submitted"` or `last_submission_id is not None`; else `revoke_assignments(..., reason="removed")` **and discards the draft** (R12): `repo.discard_drafts(conn, project_id, document_id, annotator_pseudonym, mode)` deletes the `drafts` rows of that workspace (children cascade: `draft_annotations`, `draft_evidence`, `review_decisions`) and, when the assignment has an `active_round_id`, appends round state `abandoned` exactly as a clean restart supersedes a round (`work_rounds.py:753`; reuse its helper) so `open` never rebinds it. Edit events and audit stay. The dialog text "Their draft is discarded." is therefore literal.
- `authz/scoped.py` `require_workable`: after `active_for`, an annotate assignment opens **only its own mode** (plan review R8 guard): `if assignment.task == "annotate" and key.mode != workspace_mode(assignment.task, assignment.annotation_mode): raise AccessDenied("MODE_NOT_ALLOWED")`.
- `authz/versions.py` `may_read_proposals`: also true for a qualifying `annotate` assignment with `annotation_mode == "proposals"` on the document (an annotator working from proposals may view them in the text view; an annotator working from scratch never).

**"Annotate from proposals myself"** (no new route, no copied locking): the UI calls the existing assign route (`POST /api/v1/projects/{key}/assignments`, the lead's own username, task `annotate`) and opens the returned task. `AssignmentService.assign` allows it when the target is the acting lead:
- New shared helper `grant_lead_self_role(conn, actor, project_id, project_key, user_id, username, role, now) -> list[Role]` in `authz/memberships.py`: grants `role` with `grant_roles` only when `user_id == actor.user_id`, the actor holds `lead` in the project and lacks `role`; returns the roles added (empty otherwise); the caller holds the members lock EXCLUSIVE. `ConsolidationStartService.start` replaces its inline check and grant (`consolidation_start.py:182-190`, `_holds_role`) by `grant_lead_self_role(..., "adjudicator", now)`; its locks, receipt and `role_granted` stay as they are (`test_consolidation_start_api.py` stays green).
- `AssignmentService.assign` for `task == "annotate"` and `target == actor.user_id`: `_prepare` takes the members lock EXCLUSIVE instead of SHARED (a membership write follows; add a keyword `exclusive_members: bool = False`), then `grant_lead_self_role(..., "annotator", now)` before `_assign_locked`, and `confirm_language` is implied for the lead's own work (`_create` audits the override). The mode follows the rule like for everybody else; the limit applies; a second call returns the same assignment (the existing `existing` path).
The consequence under "consolidator is not an annotator" is shown by the UI (U3); the server rule itself is unchanged.

**Routes:** `POST /api/v1/assignments/{id}/remove` (no body) → `AssignmentView`. `AssignmentView` gains `annotation_mode: Literal["proposals", "scratch"] | None = None`.

**Error codes** (add to `admin_error_codes.py`, sorted; messages in `frontend/src/admin/errors.ts`):

| Code | Message |
|---|---|
| `ANNOTATIONS_PER_TEXT_REACHED` | `This text already has {limit} annotation assignments, the project's limit (Settings, Workflow).` |
| `NO_PROPOSALS_ON_VERSION` | `This version has no tool proposals, but the annotation of this text started from proposals. Import or re-anchor the proposals for this version first.` |
| `ANNOTATION_MODE_LOCKED` (used by P4) | `The annotation of this text has already started this way, so it cannot change.` |
| `NO_TOOL_PROPOSALS` (used by P4) | `This text has no tool proposals, so it is annotated from scratch.` |

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


def proposal_env(
    tmp_path: Any, *, per_text: int = 2, mode: str = "proposals"
) -> SimpleNamespace:
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
        annotation(
            "p2",
            (period, period + len("Neonatalzeit")),
            text=TEXT,
            term_id="HP:0001250",
        ),
        annotation(
            "p3", (second, second + len("Krampfanfälle")), text=TEXT, assertion="absent"
        ),
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
        pid = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == "proj")
        ).scalar_one()
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.id == pid)
            .values(
                annotations_per_text=per_text,
                tool_proposal_mode=mode,
                annotate_accepted_translations_only=False,
            )
        )
        store.write_rows(
            conn,
            pid,
            {
                RowKey("c1", "en"): PlanFlags(False, True),
                RowKey("c2", "en"): PlanFlags(False, True),
            },
            actor_id=None,
        )
    return SimpleNamespace(
        app=app, db=db, pid=pid, lead=lead, c1=doc("c1"), c2=doc("c2")
    )


def client(env: SimpleNamespace, username: str):
    from auth_harness import logged_in

    return logged_in(env.app, username, assignments=[])


def assign(env: SimpleNamespace, document_id: str, username: str) -> dict[str, Any]:
    response = env.lead.post(
        f"{BASE}/assignments",
        json={
            "document_id": document_id,
            "username": username,
            "task": "annotate",
            "confirm_language": True,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def open_task(
    env: SimpleNamespace, username: str, assignment_id: int
) -> dict[str, Any]:
    response = client(env, username).post(f"/api/v1/assignments/{assignment_id}/open")
    assert response.status_code == 200, response.text
    return response.json()
```

(Before writing: check the document ids `native_unit` produces with `case_id` — `grep -n "external_id\|document_id" tests/t1_builders.py tests/t1_fixtures.py` — and the `POST /projects/{key}/assignments` body in `api/assignment_routes.py:373-412` — it is a row list (without `context` it calls `AssignmentService.assign` per row, the path that bypassed the limit); adapt `doc()` and `assign()` to the real shape and return the created `AssignmentView`. `annotation(...)` must use terms present in the pinned test ontology; `HP:0001250` is.)

- [ ] **Step 1: Failing tests** `tests/test_proposal_check_assignments.py`:

```python
"""Annotate assignments from proposals (spec 2026-10-23 §1, §2)."""

from __future__ import annotations

import pytest
from proposal_check_support import BASE, assign, client, open_task, proposal_env
from sqlalchemy import select, update

from ontocurator.storage.tables import ProjectMembershipRow, ProjectRow, UserRow


@pytest.fixture
def env(tmp_path):
    return proposal_env(tmp_path)


def _set_project_mode(env, mode):
    with env.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.id == env.pid)
            .values(tool_proposal_mode=mode)
        )


def test_text_with_proposals_gets_proposals_and_opens_the_proposal_check(env):
    assignment = assign(env, env.c1, "anno")
    assert assignment["annotation_mode"] == "proposals"
    opened = open_task(env, "anno", assignment["id"])
    assert opened["view"]["key"]["mode"] == "proposal_check"
    assert len(opened["view"]["targets"]["targets"]) == 3


def test_text_without_proposals_gets_scratch(env):
    assignment = assign(env, env.c2, "anno")
    assert assignment["annotation_mode"] == "scratch"
    assert (
        open_task(env, "anno", assignment["id"])["view"]["key"]["mode"] == "independent"
    )


def test_project_setting_scratch_gives_scratch(tmp_path):
    env = proposal_env(tmp_path, mode="scratch")
    assert assign(env, env.c1, "anno")["annotation_mode"] == "scratch"


def test_first_assignment_locks_the_mode(env):
    assign(env, env.c1, "anno")
    _set_project_mode(env, "scratch")
    assert assign(env, env.c1, "anno2")["annotation_mode"] == "proposals"


def test_revoked_submitted_work_keeps_the_lock(env):
    """Plan review R1: submitted work counts even after its assignment is revoked."""
    from work_plan_support import submit

    first = assign(env, env.c1, "anno")
    submit(env, first["id"], "sub-anno")
    revoked = env.lead.post(f"/api/v1/assignments/{first['id']}/revoke")
    assert revoked.status_code == 200, revoked.text
    _set_project_mode(env, "scratch")
    assert assign(env, env.c1, "anno2")["annotation_mode"] == "proposals"


@pytest.mark.parametrize(
    ("document", "wrong_mode"), [("c1", "independent"), ("c2", "proposal_check")]
)
def test_an_annotate_assignment_opens_only_its_own_mode(env, document, wrong_mode):
    """Plan review R8 guard (``assisted`` is gone, the rule stays)."""
    document_id = getattr(env, document)
    assign(env, document_id, "anno")
    response = client(env, "anno").post(
        "/api/v1/workspaces/open",
        json={"project_key": "proj", "document_id": document_id, "mode": wrong_mode},
    )
    assert response.status_code == 403, response.text
    assert response.json()["code"] == "MODE_NOT_ALLOWED"


def test_remove_an_open_assignment_unlocks_the_mode(env):
    first = assign(env, env.c1, "anno")
    removed = env.lead.post(f"/api/v1/assignments/{first['id']}/remove")
    assert removed.status_code == 200, removed.text
    assert removed.json()["revoked_at"] is not None
    _set_project_mode(env, "scratch")
    assert assign(env, env.c1, "anno2")["annotation_mode"] == "scratch"


def test_remove_discards_the_draft(env):
    """Plan review R12: remove, assign the same person again, the draft is empty."""
    first = assign(env, env.c1, "anno")
    opened = open_task(env, "anno", first["id"])
    target = opened["view"]["targets"]["targets"][0]
    decided = client(env, "anno").post(
        f"/api/v1/workspaces/{opened['workspace_id']}/decisions",
        json={
            "mutation_id": "d1",
            "expected_revision": opened["view"]["revision"],
            "payload": {"target": target, "outcome": "confirmed"},
        },
    )
    assert decided.status_code == 200, decided.text
    env.lead.post(f"/api/v1/assignments/{first['id']}/remove")
    again = assign(env, env.c1, "anno")
    view = open_task(env, "anno", again["id"])["view"]
    assert view["draft"]["decisions"] == []
    assert view["revision"] == 0


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


def _lead_roles(env):
    with env.db.transaction() as conn:
        return set(
            conn.execute(
                select(ProjectMembershipRow.role)
                .join(UserRow, UserRow.id == ProjectMembershipRow.user_id)
                .where(
                    ProjectMembershipRow.project_id == env.pid,
                    UserRow.username == "leader",
                )
            ).scalars()
        )


def test_myself_grants_annotator_and_assigns(env):
    """The existing assign route, the lead's own username (plan P3 "myself")."""
    assert "annotator" not in _lead_roles(env)
    body = assign(env, env.c1, "leader")
    assert body["task"] == "annotate"
    assert body["annotation_mode"] == "proposals"
    assert "annotator" in _lead_roles(env)
    assert assign(env, env.c1, "leader")["id"] == body["id"]


def test_myself_counts_towards_the_limit(env):
    assign(env, env.c1, "anno")
    assign(env, env.c1, "anno2")
    response = env.lead.post(
        f"{BASE}/assignments",
        json={
            "document_id": env.c1,
            "username": "leader",
            "task": "annotate",
            "confirm_language": True,
        },
    )
    assert response.json()["code"] == "ANNOTATIONS_PER_TEXT_REACHED"


def test_myself_follows_the_mode_rule(env):
    assert assign(env, env.c2, "leader")["annotation_mode"] == "scratch"


def test_self_assign_needs_the_lead(env):
    response = client(env, "anno").post(
        f"{BASE}/assignments",
        json={
            "document_id": env.c1,
            "username": "anno",
            "task": "annotate",
            "confirm_language": True,
        },
    )
    assert response.status_code == 403


def test_proposals_visible_only_when_annotating_from_proposals(env):
    from_proposals = assign(env, env.c1, "anno")
    assert from_proposals["annotation_mode"] == "proposals"
    versions = client(env, "anno").get(f"{BASE}/documents/{env.c1}/annotation-versions")
    assert any(v["kind"] == "proposals" for v in versions.json())
    from_scratch = assign(env, env.c2, "anno2")
    assert from_scratch["annotation_mode"] == "scratch"
    other = client(env, "anno2").get(f"{BASE}/documents/{env.c2}/annotation-versions")
    assert all(v["kind"] != "proposals" for v in other.json())


def test_new_version_without_proposals_is_refused_while_locked_from_proposals(tmp_path):
    """Plan review R10. Build a second version of c1-en without proposals the way
    tests/test_text_change_service.py creates versions; the first version has
    submitted work from proposals; assigning on the new version is refused with
    NO_PROPOSALS_ON_VERSION; after importing proposals for it, it is from proposals."""
```

(Adapt the `annotation-versions` response shape after `grep -n "annotation-versions" -A20 src/ontocurator/api/variant_routes.py`, the decision route and draft fields after `grep -n "decisions\|class WorkspaceView" -A6 src/ontocurator/api/routes.py`, and the revoke route after `grep -n "revoke" src/ontocurator/api/assignment_routes.py`; keep the assertions' meaning. Adapt the `/workspaces/open` body to `OpenWorkspaceRequest`.)

`tests/test_annotations_per_text_limit.py`:

```python
"""Annotations per text is enforced on every assign path (spec "Small fixes")."""

from proposal_check_support import BASE, assign, proposal_env


def test_single_assign_refuses_above_the_limit(tmp_path):
    env = proposal_env(tmp_path, per_text=2)
    assign(env, env.c1, "anno")
    assign(env, env.c1, "anno2")
    response = env.lead.post(
        f"{BASE}/assignments",
        json={
            "document_id": env.c1,
            "username": "tom",
            "task": "annotate",
            "confirm_language": True,
        },
    )
    assert response.json()["code"] == "ANNOTATIONS_PER_TEXT_REACHED"
    assert response.json()["details"] == {"limit": 2, "assigned": 2}


def test_reassign_keeps_the_count(tmp_path):
    env = proposal_env(tmp_path, per_text=1)
    first = assign(env, env.c1, "anno")
    response = env.lead.post(
        f"/api/v1/assignments/{first['id']}/reassign",
        json={"username": "anno2", "confirm_language": True},
    )
    assert response.status_code == 200, response.text
    assert response.json()["annotation_mode"] == "proposals"


def test_removed_assignments_free_the_slot(tmp_path):
    env = proposal_env(tmp_path, per_text=1)
    first = assign(env, env.c1, "anno")
    env.lead.post(f"/api/v1/assignments/{first['id']}/remove")
    assert assign(env, env.c1, "anno2")["annotation_mode"] == "proposals"


def test_revoked_submitted_work_still_counts(tmp_path):
    """Revoke (not remove) a submitted assignment with per_text=1: the next assign is refused."""


def test_distribution_confirmation_respects_the_limit(tmp_path):
    """Calls DistributionConfirmationService.confirm with three people on c1
    (per_text=2): the third row is refused with ANNOTATIONS_PER_TEXT_REACHED."""


def test_batch_counts_revoked_submitted_work_like_single_assign(tmp_path):
    """per_text=1: anno submits on c1, the lead revokes it. A batch annotate
    assign over c1 and c2 offers c1 no slot in its preview and saves c2
    (no ANNOTATIONS_PER_TEXT_REACHED, so the batch is not rolled back)."""
```

The bodies without code: submit with `work_plan_support.submit`, revoke through the revoke route; build the confirmation through the service as `tests/test_distribution_api.py` does (read it; copy its request shape); assert the refusal code; drive the batch through its preview and save routes as `tests/test_assignment_batch.py` does (read it; copy its request shape).

- [ ] **Step 2:** `uv run pytest -n 4 tests/test_text_targets.py tests/test_proposal_check_assignments.py tests/test_annotations_per_text_limit.py -q` → FAIL. Implement.
- [ ] **Step 3:** `uv run pytest -n 4 tests/test_text_targets.py tests/test_proposal_check_assignments.py tests/test_annotations_per_text_limit.py tests/test_assignments.py tests/test_assignment_batch.py tests/test_distribution_api.py tests/test_consolidation_start_api.py tests/test_assignment_round_open_api.py tests/test_browser_overview_fixture.py tests/test_browser_documents_fixture.py tests/test_browser_lead_workflow_fixture.py tests/test_problem_reports*.py tests/test_text_change*.py -q` (expand globs with `ls`) → PASS. A test that relied on more annotate assignments than the limit: raise the project's `annotations_per_text` in that test's setup (never weaken the rule); list each in the hand-back.
- [ ] **Step 4: Contracts (token 3).** `uv run python scripts/export_openapi.py && npm --prefix frontend run api:generate && uv run python scripts/export_admin_error_codes.py`; `client.ts`: `removeAssignment(id: number): Promise<AssignmentView>` (`POST /api/v1/assignments/${id}/remove`); `errors.ts` messages above; `fixtures.ts` defaults (`annotation_mode: null` where `AssignmentView` objects are built); `npm --prefix frontend run typecheck`; `bash scripts/check.sh --only static`.
- **Done:** every assign path refuses above the limit, and the batch planner and `_assign_locked` use the one count `held_annotations`; the lead's self-grant exists once (`grant_lead_self_role`, used by assign and consolidation start); the mode is set once at creation and the lock counts submitted work of revoked assignments; remove discards the draft; an annotate assignment opens only its own mode; `MODE_FOR_TASK` gone (`grep -rn MODE_FOR_TASK src` empty); annotators working from scratch never see proposals (test); `text_targets.py` is the only new derivation of a text's target document.
- **Commit:** `feat(assignments): annotation mode on assignments, per-text limit, remove, annotate from proposals myself`

### P4: Project setting, plan override, mode lock, new text versions (contracts writer)

- **Goal:** Settings → Workflow "Texts with tool proposals"; per-text (and bulk) override of the annotation mode through the existing plan routes; refusal while the mode is locked; a defined rule for new text versions when the annotation works from proposals (plan review R10).
- **Spec:** §1 Q3 (setting, override via "Change plan…", lock), §1 "New text versions"; §2 footer "Change plan…" content (F5) server side.
- **Owns:** `src/ontocurator/projects/service.py`, `src/ontocurator/api/work_plan_routes.py` (models only), `src/ontocurator/application/work_plans.py` (`patch_row`, `bulk_preview`, `bulk_save`, `set_rows`, `_audit_cases`), `src/ontocurator/storage/work_plan_store.py` (read and write `annotation_mode` with the flags), `src/ontocurator/domain/work_plans.py` (only if the flags type must carry the mode), `src/ontocurator/application/text_changes.py` (from-proposals reasons; `current_target` delegates to `application/text_targets.py`), `src/ontocurator/domain/admin_error_codes.py`, contracts, `frontend/src/api/client.ts` (settings type), `frontend/src/admin/errors.ts` (messages of its new codes), `frontend/tests/documents/fixtures.ts`, `frontend/tests/projectSettings.test.tsx` (payload expectation only), `tests/test_annotation_mode_settings_api.py` (create), `tests/test_plan_annotation_mode_api.py` (create), `tests/test_text_change_from_proposals.py` (create).
- **Size / lane / review:** M / backend / –.
- **Code to read:** `projects/service.py:50-80, 330-360` (`ProjectSettingsChange`, `ProjectSettings`, `update_settings` None-keeps pattern for `annotations_per_text`/`import_plan`), `api/project_routes.py:360-380`, `api/work_plan_routes.py:20-160, 275-300` (`PlanFlagsView`, `UndoRowView`, `PlanRowPatch` `:103`, `LanguageChangeView` `:122`, `LanguagePreviewView`, `BulkResult`), `application/work_plans.py:140-170, 292-330, 586-870` (`_audit_cases`, `_lock`, `patch_row`, `bulk_preview`, `bulk_save`, `set_rows`), `storage/work_plan_store.py:221-260, 420-470` (`plan_rows`, `ensure_rows`), `application/text_changes.py:160-170, 280-300, 482-502, 618-680, 867-920` (`_not_applicable`, `_require_open_annotation`, `_check_submission`, `move_to_version`, `carry`), the reason messages of `TEXT_CHANGE_NOT_APPLICABLE` (`grep -rn "not_annotation" frontend/src src/ontocurator`).
- **Prerequisites:** `grep -n "def load_text_mode" src/ontocurator/application/annotation_modes.py` (P3 committed); `grep -n "def text_target_document" src/ontocurator/application/text_targets.py` (P3); contracts token 4.
- **Contract-first (W6, Global rule 21):** start with Step 3 as the contract step: `tool_proposal_mode` in `ProjectSettingsChange`/`ProjectSettings` (default `"proposals"`, written by `update_settings`), the new fields with their defaults on `PlanRowPatch`, `LanguageChangeView`, `PlanFlagsView`, `UndoRowView`, `LanguagePreviewView` and `BulkResult` (no new route, so no route stub), and a guard in `patch_row`/`bulk_preview`/`bulk_save` that answers `HTTPException(status_code=501)` when a request sets `annotation_mode` (not `None`, not `"keep"`); the new error codes; regenerate, `client.ts`, fixtures, `errors.ts` messages; checks: typecheck, `bash scripts/check.sh --only static`, `uv run pytest tests/test_projects_api.py -q` (heavy slot). Hand back `CONTRACT READY`; after the orchestrator has merged it, continue with Steps 1–2 (the tests replace the 501 guard).

**Settings:** `ProjectSettingsChange.tool_proposal_mode: AnnotationMode | None = None` (None keeps, like `annotations_per_text`); `ProjectSettings.tool_proposal_mode: AnnotationMode = "proposals"`; `update_settings` writes it (extend the name loop at `:348`). The settings audit records the change like the other workflow fields.

**Override in the existing plan routes** (no new route, no new module): the mode travels with the flags, so the existing lock (`_lock(conn, key, exclusive=True)`), lead check, row revision, Undo, audit and bulk preview apply unchanged, and **a save is atomic** (flags and mode in one transaction; a refusal saves nothing).
- Models (`api/work_plan_routes.py`): `PlanRowPatch.annotation_mode: Literal["proposals", "scratch", "project"] | None = None` (None keeps; `"project"` clears the override); `LanguageChangeView.annotation_mode: Literal["keep", "proposals", "scratch", "project"] = "keep"`; `PlanFlagsView.annotation_mode: Literal["proposals", "scratch"] | None = None` (the stored override); `UndoRowView.annotation_mode: Literal["proposals", "scratch"] | None = None` (exact restore value; Undo views always carry it); `LanguagePreviewView.mode_locked: int = 0`, `mode_no_proposals: int = 0`; `BulkResult.mode_locked: list[RowRefView] = []`, `mode_no_proposals: list[RowRefView] = []`.
- Rule per row (one function in `application/work_plans.py`, used by all four paths): `TextMode` of the row's target document (`text_target_document`, never a second derivation) via `load_text_mode`; **refused** with `ANNOTATION_MODE_LOCKED` when `locked` and the requested effective mode differs from the locked one (setting the same mode or `"project"` while locked is allowed and stored, it only matters after an unlock); **refused** with `NO_TOOL_PROPOSALS` when the request is `"proposals"` and the text has no proposals; else write `WorkPlanFlagsRow.annotation_mode`. A mode change counts as a row change (revision bump, Undo row, `_audit_cases` records `annotation_mode` beside the flags).
- `patch_row`: a refusal raises (the whole PATCH, flags included, rolls back). `bulk_preview` counts refused rows per language in `mode_locked` / `mode_no_proposals`; `bulk_save` and `set_rows` (bulk Undo) skip the mode of refused rows (their flags are still saved) and list them in `mode_locked` / `mode_no_proposals` (the bulk dialog reports the counts).

**New text versions (R10; spec §1 "New text versions").** The lock spans the text, every version needs its own annotations (P3: limit per version), and "from proposals" work is never moved or carried to another version (A6), because its decisions refer to the proposals of its own version:
- `move_to_version` of an open annotate assignment with `annotation_mode == "proposals"` → `_not_applicable("from_proposals")` (new reason; message `Annotation from proposals stays on its version. Remove the assignment and assign the new version; its draft is discarded.`).
- `carry` / `preview` of a `proposal_check` submission → `_not_applicable("from_proposals")` (message `Annotation from proposals is not carried to a new version. Assign the new version; it is annotated from its own proposals.`) instead of today's generic `not_annotation`.
- Assigning on the new version: P3's `_create` rule applies (locked "from proposals" and no proposals on that version → `NO_PROPOSALS_ON_VERSION`; with proposals → from proposals).
- Texts annotated from scratch keep today's behaviour unchanged.
Add the reason `from_proposals` wherever the reasons of `TEXT_CHANGE_NOT_APPLICABLE` are enumerated (backend literal, `errors.ts` or the text-change UI labels found by the grep above; that file joins this WP's Owns if it is not `errors.ts`, report it).

`tests/test_text_change_from_proposals.py` (versions built as in `tests/test_text_change_service.py`): `test_open_work_from_proposals_is_not_moved` (reason `from_proposals`, the assignment stays), `test_submitted_work_from_proposals_is_not_carried` (reason `from_proposals`), `test_new_version_with_proposals_is_assigned_from_proposals`, `test_new_version_without_proposals_is_refused` (`NO_PROPOSALS_ON_VERSION`), `test_work_from_scratch_still_moves_and_carries` (regression).

- [ ] **Step 1: Failing tests** `tests/test_annotation_mode_settings_api.py`:

```python
from proposal_check_support import BASE, proposal_env


def test_setting_reads_and_writes(tmp_path):
    env = proposal_env(tmp_path)
    assert env.lead.get(f"{BASE}/settings").json()["tool_proposal_mode"] == "proposals"
    response = env.lead.patch(
        f"{BASE}/settings", json={"tool_proposal_mode": "scratch"}
    )
    assert response.status_code == 200, response.text
    assert env.lead.get(f"{BASE}/settings").json()["tool_proposal_mode"] == "scratch"


def test_omitted_setting_keeps_the_value(tmp_path):
    env = proposal_env(tmp_path, mode="scratch")
    env.lead.patch(f"{BASE}/settings", json={"annotations_per_text": 3})
    assert env.lead.get(f"{BASE}/settings").json()["tool_proposal_mode"] == "scratch"


def test_invalid_value_is_refused(tmp_path):
    env = proposal_env(tmp_path)
    assert (
        env.lead.patch(
            f"{BASE}/settings", json={"tool_proposal_mode": "assisted"}
        ).status_code
        == 422
    )
```

(Adapt the settings URL and method to `api/project_routes.py:365-371`.)

`tests/test_plan_annotation_mode_api.py`:

```python
from proposal_check_support import BASE, assign, client, proposal_env
from work_plan_support import revision_of


def patch(env, mode, case="c1", user=None, **flags):
    who = env.lead if user is None else client(env, user)
    return who.patch(
        f"{BASE}/work-plans/{case}/en",
        json={"annotation_mode": mode, "expected_revision": revision_of(env, case)}
        | flags,
    )


def test_override_scratch_then_assignment_is_scratch(tmp_path):
    env = proposal_env(tmp_path)
    response = patch(env, "scratch")
    assert response.status_code == 200, response.text
    assert response.json()["flags"]["annotation_mode"] == "scratch"
    assert assign(env, env.c1, "anno")["annotation_mode"] == "scratch"


def test_project_returns_to_the_project_setting(tmp_path):
    env = proposal_env(tmp_path)
    patch(env, "scratch")
    assert patch(env, "project").json()["flags"]["annotation_mode"] is None
    assert assign(env, env.c1, "anno")["annotation_mode"] == "proposals"


def test_change_is_refused_while_locked(tmp_path):
    env = proposal_env(tmp_path)
    assign(env, env.c1, "anno")
    assert patch(env, "scratch").json()["code"] == "ANNOTATION_MODE_LOCKED"
    assert patch(env, "proposals").status_code == 200


def test_a_refused_mode_saves_no_flags(tmp_path):
    """Flags and mode are one PATCH, one transaction (atomic save)."""
    env = proposal_env(tmp_path)
    assign(env, env.c1, "anno")
    before = revision_of(env, "c1")
    assert patch(env, "scratch", review=True).json()["code"] == "ANNOTATION_MODE_LOCKED"
    assert revision_of(env, "c1") == before


def test_proposals_refused_without_proposals(tmp_path):
    env = proposal_env(tmp_path)
    assert patch(env, "proposals", case="c2").json()["code"] == "NO_TOOL_PROPOSALS"


def test_undo_restores_the_previous_mode(tmp_path):
    env = proposal_env(tmp_path)
    undo = patch(env, "scratch").json()["undo"]
    restored = env.lead.put(
        f"{BASE}/work-plans/rows",
        json={
            "rows": undo["rows"],
            "expected_revisions": undo["revisions"],
            "undo": True,
        },
    )
    assert restored.status_code == 200, restored.text
    assert assign(env, env.c1, "anno")["annotation_mode"] == "proposals"


def test_bulk_preview_and_save_skip_locked_rows(tmp_path):
    env = proposal_env(tmp_path)
    assign(env, env.c1, "anno")
    body = {
        "rows": [
            {"case_id": "c1", "language": "en"},
            {"case_id": "c2", "language": "en"},
        ],
        "languages": {"en": {"annotation_mode": "scratch"}},
    }
    preview = env.lead.post(f"{BASE}/work-plans/bulk/preview", json=body).json()
    assert preview["languages"][0]["mode_locked"] == 1
    saved = env.lead.put(
        f"{BASE}/work-plans/bulk",
        json=body | {"expected_revisions": preview["revisions"]},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["mode_locked"] == [{"case_id": "c1", "language": "en"}]
    assert saved.json()["mode_no_proposals"] == []


def test_override_is_lead_only(tmp_path):
    env = proposal_env(tmp_path)
    assert patch(env, "scratch", user="anno").status_code == 403
```

(Adapt the bulk request shape to `BulkPlanRequest` and its `languages` key for the rows' language, and the Undo request to `PlanRowsSet`; keep the assertions' meaning.)

- [ ] **Step 2:** `uv run pytest -n 4 tests/test_annotation_mode_settings_api.py tests/test_plan_annotation_mode_api.py tests/test_text_change_from_proposals.py -q` → FAIL; implement; → PASS. Then `uv run pytest -n 4 tests/test_projects_settings*.py tests/test_work_plan*.py tests/test_text_change*.py -q` (expand with `ls`).
- [ ] **Step 3: Contracts (token 4; the contract step, done first).** Regenerate; `client.ts`: no new function (the plan PATCH and bulk calls send the new fields through their generated types); settings type gains `tool_proposal_mode`; `frontend/tests/projectSettings.test.tsx:472-501` expects the unchanged payload (the field is added to the form in U2, not here, so only typing changes); `fixtures.ts` defaults for the new plan fields; `npm --prefix frontend run typecheck`; `bash scripts/check.sh --only static`.
- **Done:** setting, single and bulk override work through the existing plan routes (one transaction with the flags; lock, revision, Undo, audit and bulk preview reused); lock refusal and the atomic save tested; new-version rule tested for open and submitted work from proposals; error codes catalogued.
- **Commit:** `feat(workflow): tool proposal setting and per-text annotation mode`

### P6: Export fields for annotation from proposals

- **Goal:** the final export records, per "from proposals" submission (kind `proposal_check`), the proposal set it worked on, the decision on every proposal with the proposal's source ref, and the added findings; precision is defined per proposal set (the newest set of the document at assignment time, plan "Proposal targets", R20); the README and docs explain them.
- **Spec:** §1 "Export", §1 "Targets"; Goal 1 ("tool precision can be measured from the export").
- **Facts verified:** `receipt.json` already carries `review_decisions` (`exchange/final_export.py:175`) as raw `ReviewDecision` dumps without the proposal URN; the T1 bundles map `confirmed`→method `adopted` with the proposal URN in `source_refs` and `changed`→`edited` (`exchange/t1.py:611-650`, extended to proposal checks by P2); `index.csv` column `submission_kind` (P2 adds `proposal_check`); proposal URN: `exchange/t1.py:463 _proposal_ref(annotation_id, project)`.
- **Owns:** `src/ontocurator/exchange/proposal_checks.py` (create), `src/ontocurator/exchange/final_export.py`, `src/ontocurator/exchange/final_export_guide.py` (README text), `docs/scientific-workflow.md` (new section "Annotation from proposals in the export"; after L1's removals), `tests/test_proposal_check_export.py` (create).
- **Size / lane / review:** S / backend / –.
- **Prerequisites:** `grep -n "def newest_proposal_set" src/ontocurator/storage/proposal_queries.py` (P2); L1 committed (`docs/scientific-workflow.md`, `final_export_guide.py` chain); P3 committed for the heavy tests (`tests/proposal_check_support.py`, `open_task`, annotation from proposals). **Schedule (W5 pre, W6 post):** pre-phase after P2 is merged: `exchange/proposal_checks.py`, receipt, README and docs text, the pure tests; post-phase after P3 is merged: the two heavy tests and the export regression run.
- **Code to read:** `storage/proposal_queries.py` (P2), `exchange/final_export.py:100-200`, `exchange/final_export_guide.py:200-260` (README lines), `exchange/t1.py:455-470, 600-650`, one existing final-export test (`ls tests | grep -i final_export`) for the build pattern.

`exchange/proposal_checks.py`:

```python
"""Per-proposal decisions of proposal-check submissions (final export receipt)."""

from __future__ import annotations

from typing import Any

from ontocurator.domain.workspace import Submission
from ontocurator.exchange.t1 import _proposal_ref
from ontocurator.storage.proposal_queries import ProposalSetRef

DECISION_WORDS = {
    "confirmed": "confirmed",
    "rejected": "rejected",
    "changed": "corrected",
    "uncertain": "uncertain",
}


def proposal_check_record(
    submission: Submission, project: str, proposal_set: ProposalSetRef | None
) -> dict[str, Any]:
    """Every proposal of the round with its decision; findings the person added.

    ``proposal_set``: the set the targets belong to (looked up by the caller
    from ``proposal_annotations.proposal_set_id`` of the targets; all targets
    of a round come from one set, plan "Proposal targets")."""
    replaced = {
        d.replacement.annotation_id for d in submission.decisions if d.replacement
    }
    targets = {t.annotation_id for t in submission.targets.targets}
    decisions = [
        {
            "proposal_ref": _proposal_ref(d.target.annotation_id, project),
            "proposal_annotation_id": d.target.annotation_id,
            "proposal_version": d.target.version,
            "decision": DECISION_WORDS[d.outcome],
            "corrected_annotation_id": d.replacement.annotation_id
            if d.replacement
            else None,
            "note": d.note,
        }
        for d in sorted(
            submission.decisions,
            key=lambda d: (d.target.annotation_id, d.target.version),
        )
    ]
    added = sorted(
        s.annotation.annotation_id
        for s in submission.snapshots
        if s.annotation.annotation_id not in replaced
        and s.annotation.annotation_id not in targets
    )
    counts = {
        word: sum(1 for d in decisions if d["decision"] == word)
        for word in ("confirmed", "rejected", "corrected", "uncertain")
    }
    return {
        "proposal_set": None
        if proposal_set is None
        else {
            "id": proposal_set.id,
            "annotation_set_id": proposal_set.annotation_set_id,
        },
        "decisions": decisions,
        "added_annotation_ids": added,
        "counts": counts | {"added": len(added)},
    }
```

`final_export.py` receipt: `"proposal_checks": {sub.submission_id: proposal_check_record(sub, project, set_of(sub)) for sub in content.submissions if sub.origin_key.mode == "proposal_check"}` where `set_of` reads `ProposalAnnotationRow.proposal_set_id` (+ `ProposalSetRow.annotation_set_id`) of the submission's targets in one query per export (additive key; `review_decisions` unchanged). README (`final_export_guide.py`): add after the `receipt.json` line: `"  proposal_checks     Per tool proposal of a proposal check: confirmed,"`, `"                      rejected, corrected or uncertain, with the proposal's"`, `"                      ref; plus the findings the person added."` and in the `submission_kind` explanation the value `proposal_check` ("annotation from proposals: the person went through the tool's proposals one by one"). Keep the guide's 76-column wrap. `docs/scientific-workflow.md`: a section "Annotation from proposals in the export" (where to find decisions; which proposals were targets: **the newest proposal set of the document when the round was created**, older sets on the same document are never targets and are not in the record; a later import does not change an existing round; how to compute tool precision per proposal set = confirmed / (confirmed + rejected + corrected), grouped by `proposal_set.annotation_set_id`; corrected counts the proposal as not exact; uncertain is reported separately and left out of precision).

- [ ] **Step 1: Failing tests** `tests/test_proposal_check_export.py`:
  - `test_record_lists_every_proposal_with_its_decision_and_ref` (pure: build a `Submission` with `origin_key.mode="proposal_check"`, targets p1–p3 with URN ids `urn:ontospan:set:p1`…, decisions confirmed/rejected/changed→replacement `r3`, snapshots `[p1, r3, new1]`, `ProposalSetRef(7, "set-b")`; assert `proposal_set == {"id": 7, "annotation_set_id": "set-b"}`, `decisions[*].decision == ["confirmed", "rejected", "corrected"]`, `proposal_ref` equals the URN, `corrected_annotation_id == "r3"`, `added_annotation_ids == ["new1"]`, `counts == {"confirmed": 1, "rejected": 1, "corrected": 1, "uncertain": 0, "added": 1}`).
  - `test_non_urn_ids_get_the_project_proposals_ref` (`_proposal_ref` fallback).
  - `test_final_export_receipt_has_proposal_checks` (heavy: `proposal_env`, two proposal checks submitted through the API — open via `open_task`, decide all three targets through `POST /workspaces/{id}/decisions`, check the layer, submit — accept one as final through the final-selection API as `work_plan_support.select_final` does, run the final export job as the existing final-export test does, read `receipt.json`: `proposal_checks` has the selected submission with three decisions; `index.csv` row `submission_kind == "proposal_check"`).
  - `test_receipt_names_the_newest_set_only` (heavy: a second proposal set imported for c1-en **before** assignment: the record's `proposal_set.annotation_set_id` is the newer set and its decisions cover only that set's proposals).
  - `test_readme_explains_proposal_checks` (the guide text contains `proposal_checks` and `proposal_check`).
- [ ] **Step 2:** `uv run pytest tests/test_proposal_check_export.py -q` → FAIL; implement; → PASS; `uv run pytest -n 4 $(ls tests/test_final_export*.py) tests/test_t1_export.py -q`.
- **Done:** additive receipt key and README/docs text; existing exports byte-identical for projects without proposal checks (existing tests green).
- **Commit:** `feat(export): per-proposal decisions of proposal checks`

### P7: Consolidation server: one finding per group, tool-proposal marker (contracts writer)

- **Goal:** a group resolves to exactly one finding; `keep_both`, `term_choices` and `term_parts` leave the API and the code (no read path: L1's migration deleted the stored keep-both consolidations, D1); each member says whether its finding comes from a tool proposal (robot icon, D2); a progress helper for the read model.
- **Spec:** §3 ("One group = … exactly one finding. Keep both and any split off are removed"; "The server rules stay consistent with the UI: one term per group; a choice is required for every disagreeing field; Keep both and term_choices are removed from the API (with tests)"; "findings that originate from a tool proposal carry the robot icon").
- **Facts verified:** keep-both code: `application/consolidation_resolve.py:9-25` (docstring), `:181-191` (`ResolveCommand.action`/`term_choices`), `:519-560` (`_plans`), `:233-239` (`cons_ids`); `domain/agreement.py:85-91` (`TermPart`), `:94-110` (`Group.term_parts`), `:342-349`; `application/consolidation.py:477-482` (serialisation); `api/consolidation_routes.py:53-57, 70, 74, 161`; `domain/review.py:10` (`ConsolidationAction`). "Split off" exists nowhere in code. Stored decisions with `keep_both` are gone after migration 0020 (L1), so no read compatibility is needed (plan review R14 moot). A member finding comes from a tool proposal when its annotation id (any version) is a `proposal_annotations` row of the project, or when it is the `replacement` of a decision whose target is one (a corrected proposal) in the member's source submission.
- **Owns:** `src/ontocurator/application/consolidation_resolve.py`, `src/ontocurator/application/consolidation.py`, `src/ontocurator/domain/agreement.py`, `src/ontocurator/api/consolidation_routes.py`, `src/ontocurator/domain/review.py` (`ConsolidationAction`), contracts, `frontend/src/api/client.ts` (`ConsolidationResolvePayload` without `term_choices`), `frontend/tests/consolidation/fixtures.ts`, `frontend/tests/consolidationEditor.test.tsx` (fixture field only), `tests/test_consolidation_relevant_differences.py`, `tests/test_consolidation_resolve_api.py`, `tests/test_consolidation_resolve_validation.py`, `tests/test_consolidation_submit_gating.py`, `tests/test_agreement_groups.py`, `tests/test_browser_consolidation_fixture.py`, `tests/test_consolidation_progress.py` (create), `tests/test_consolidation_tool_proposals.py` (create), plus the frontend compile-fix files of Step 4.
- **Size / lane / review:** M / backend / yes.
- **Prerequisites:** contracts token 6 (after P5's contract step); L1 committed (`grep -n "keep_both" src/ontocurator/storage/work_purge.py` finds the purge); P3 committed for the post-phase (`grep -n "def proposal_env" tests/proposal_check_support.py`).
- **Schedule (W2 pre, W6 post):** pre-phase after L1 is merged: the backend code and tests of Steps 1–2, run in a heavy slot, except `tests/test_consolidation_tool_proposals.py` (needs P3's `tests/proposal_check_support.py` and annotation from proposals). Post-phase after P3 is merged: that test, the fix of `tests/test_browser_consolidation_fixture.py` if P3's limit broke it (P3's hand-back says so), then Steps 3–4 with token 6 (regeneration and the frontend compile fix).

Changes:
- `ResolveCommand.action: Literal["keep", "choose", "leave_out"]`; field `term_choices` removed. Before `ResolveCommand.model_validate`, `resolve()` refuses legacy payloads with a clear message: `if envelope.payload.get("action") == "keep_both" or "term_choices" in envelope.payload: raise _invalid("Keep both is no longer offered: choose one finding and add a second finding on the text")`.
- `_plans`: keep-both branch and the `term_choices` check removed; `keep` and `choose` unchanged (choose: term in the group or the "other term"; every differing axis chosen; span and note from a member).
- `domain/agreement.py`: `TermPart` and `Group.term_parts` removed (and their construction at `:342-349`); nothing else in the grouping changes.
- `application/consolidation.py`: `term_parts` serialisation removed; `_state` has no `keep_both` state; each member gets `from_tool_proposal: bool` (rule under "Facts verified"; proposal ids loaded once per read with one query); new helper:

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
            (
                (ref.annotation_id, ref.version)
                for ref in (
                    member_ref(found.members[i]) for i in group.members.values()
                )
            ),
            decisions,
        )
    )
    return open_count, len(groups)
```

  and `open_group_count` becomes `return consolidation_progress(conn, pid, round_id, decisions)[0]`.
- `api/consolidation_routes.py`: `ConsolidationTermPartView` and `term_parts` removed; `state` Literal without `"keep_both"`; member view gains `from_tool_proposal: bool = False`; route docstring without keep both.
- `domain/review.py:10`: `ConsolidationAction = Literal["auto", "keep", "choose", "leave_out"]`.
- `domain/agreement.py`: `"TermPart"` also leaves `__all__` (`:47`) (plan review R18).
- `_Group.cons_ids` unchanged (the reopen logic stays generic).

- [ ] **Step 1: Failing tests.** In `tests/test_consolidation_resolve_validation.py` replace `test_keep_both_needs_term_differs` with:

```python
def test_keep_both_is_refused(cons):
    refused(
        cons, {"input_ids": inputs(group(cons, "term_differs")), "action": "keep_both"}
    )


def test_term_choices_are_refused(cons):
    item = group(cons, "term_differs")
    refused(
        cons,
        {
            "input_ids": inputs(item),
            "action": "choose",
            "choice": choice(item),
            "term_choices": [choice(item)],
        },
    )


def test_choose_on_term_differs_writes_one_finding(cons):
    item = group(cons, "term_differs")
    response = mutate(
        cons,
        "resolve",
        {
            "input_ids": inputs(item),
            "action": "choose",
            "choice": choice(
                item,
                axes={
                    axis: item["members"][0]["axes"].get(axis, "present")
                    for axis in item["differing_axes"]
                },
            ),
        },
    )
    assert response.status_code == 200, response.text
    resolved = group(cons, "term_differs")
    assert len(resolved["annotation_ids"]) == 1
```

  `tests/test_consolidation_progress.py`: `test_progress_counts_open_and_total_groups` (round of `build_round`: before any decision `(open, total) == (open_group_count, 8)` per the scenario's eight groups — read `tests/test_consolidation_resolve_api.py::build_round` for its real group count and use it; after resolving one open group `open` drops by one) and `test_open_group_count_equals_progress_open`.
  Remove or rewrite every keep-both test listed under "Facts verified" (`grep -rn "keep_both\|term_choices\|term_parts" tests` must end empty except `test_keep_both_is_refused`, `test_term_choices_are_refused`, comments, and the unrelated test name `tests/test_translation_registry.py:174 test_two_translation_uploads_at_once_keep_both_languages`): `test_keep_both_with_three_people_asks_the_values_within_one_term` → delete; `test_term_choices_go_with_keep_both_only` → delete (covered above); `test_keep_both_on_term_differs_writes_two_annotations` → replace by `test_choose_on_term_differs_writes_one_finding`; the `("term_differs", "keep_both")` parametrisations → `("term_differs", "choose")`; `test_term_parts_name_the_decisions_within_one_term` → delete; `term_parts == {}` asserts → delete the line.
  `tests/test_consolidation_tool_proposals.py` (`proposal_env` from `tests/proposal_check_support.py`, two "from proposals" submissions through the API as in P6, consolidation started as in `tests/test_consolidation_start_api.py`): `test_confirmed_proposals_are_marked` (members whose finding is a confirmed proposal: `from_tool_proposal is True`), `test_corrected_proposals_are_marked`, `test_added_findings_are_not_marked`, `test_work_from_scratch_is_not_marked` (the three-person scenario of `build_round`: all `False`).
- [ ] **Step 2:** `uv run pytest -n 4 tests/test_consolidation_resolve_validation.py tests/test_consolidation_resolve_api.py tests/test_consolidation_relevant_differences.py tests/test_consolidation_submit_gating.py tests/test_agreement_groups.py tests/test_consolidation_progress.py tests/test_consolidation_tool_proposals.py tests/test_browser_consolidation_fixture.py tests/test_consolidation_read_api.py tests/test_consolidation_auto_take_over.py -q` → FAIL first, then PASS after the changes.
- [ ] **Step 3: Contracts (token 6).** Regenerate; `client.ts` `ConsolidationResolvePayload.action: "keep" | "choose" | "leave_out"`, no `term_choices`; frontend fixtures drop `term_parts`, add `from_tool_proposal: false` to members.
- [ ] **Step 4: Minimal frontend compile fix** (the screen is rewritten in U6; here only remove what no longer exists, so the tree stays green): in `frontend/src/consolidation/groupModel.ts` delete `KEEP_BOTH` (`:45`), `keepBothAsks` (`:158`), the `keepBoth` parameter and the "Keep both" Term option of `rowsOf` (`:166-199`), `keepsBoth` (`:207`), `keepBothChoices` (`:264`) and the keep-both branch of `resolvePayload` (`:273-279`), the "kept both" summaries (`:287`, `:297-299`, no replacement label); in `GroupCard.tsx` delete the keep-both hint (`:244`) and its option wiring; in `consolidationText.ts` delete the keep-both count (`:71`). Tests: delete `groupCard.test.tsx` "offers one term, keep both or another term when terms differ" (`:74`) and "asks the values that differ within one term before keeping both (three people)" (`:173`), `model.test.ts` "asks the values within one term when both terms are kept (three people)" (`:119`); add `model.test.ts` `it("never offers keep both", …)` asserting no row option label contains `"both"` for the term-differs fixture group. These files join this WP's Owns (`frontend/src/consolidation/groupModel.ts`, `GroupCard.tsx`, `consolidationText.ts`, `frontend/tests/consolidation/groupCard.test.tsx`, `model.test.ts`). Run `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/consolidation`, `npm --prefix frontend run typecheck`, `bash scripts/check.sh --only static`.
- **Done:** `grep -rn "keep_both\|term_choices\|term_parts\|TermPart" src frontend/src` shows only the legacy-payload refusal in `consolidation_resolve.py`, migration 0020 and `storage/work_purge.py`; `grep -rn "keep_both\|term_choices\|term_parts" tests` shows only the two refusal tests, L1's migration test and `tests/test_translation_registry.py:174` (unrelated name).
- **Commit:** `feat(consolidation): one finding per group, keep both removed, tool-proposal marker`

### P5: Read model: proposals, modes, assignment dates, filter, progress, My tasks (contracts writer)

- **Goal:** one Documents request gives the card and the one-line rows everything: proposal count, annotation mode, assignment dates with assigner, consolidation progress; filter "With tool proposals / Without"; My tasks carries mode and date.
- **Spec:** §2 (path states, chips with dates, "Every assignment shown anywhere … carries its assignment date"), §2b (robot icon, filter), §1 (assign dialog and card show the mode).
- **Facts verified:** no proposal count and no assignment date in the row payload (`api/document_row_routes.py:100-116 WorkItemView`, `application/document_rows.py:557-588 _assignments` does not select `created_at`); `TaskSummary` (`assignments/service.py:100`) has only `updated_at`; facets in `application/document_row_facets.py` (`FacetGroup`, `facet_values`); filters parsed in `api/document_row_routes.py:520-579 _filters`; row dict built in `application/document_row_page.py:482-570`.
- **Owns:** `src/ontocurator/domain/document_rows.py` (`AssignmentFact`), `src/ontocurator/application/document_rows.py`, `src/ontocurator/application/document_row_page.py`, `src/ontocurator/application/document_row_facets.py`, `src/ontocurator/api/document_row_routes.py`, `src/ontocurator/assignments/service.py` (`TaskSummary`, `my_tasks`), `src/ontocurator/api/assignment_routes.py` (`TaskSummaryView`), contracts, `frontend/src/api/client.ts` (query param `proposals`), `frontend/tests/documents/fixtures.ts` (defaults), `tests/test_document_rows_proposals.py` (create), `tests/test_my_tasks_dates.py` (create).
- **Size / lane / review:** M / backend / –.
- **Code to read:** `application/document_rows.py:100-130 (RowQuery), 260-310 (RowFacts), 557-620, 900-1020 (load_facts)`, `application/document_row_page.py:380-570, 1140-1170`, `api/document_row_routes.py:95-330, 520-600`, `api/person_views.py` (person references), `application/consolidation.py:548-580` (`_draft`, read without creating), `assignments/service.py:787-873` (`my_tasks`).
- **Prerequisites:** P4's contract step merged (`grep -n "annotation_mode" src/ontocurator/api/work_plan_routes.py`); `grep -n "def text_target_document" src/ontocurator/application/text_targets.py` (P3); `grep -n "def newest_proposal_counts" src/ontocurator/storage/proposal_queries.py` (P2); contracts token 5; for the progress part `grep -n "def consolidation_progress" src/ontocurator/application/consolidation.py` (P7).
- **Schedule (W2 pre, W7 post, contract-first, Global rule 21):** pre-phase after L1 is merged: the tests and the read-model files (`domain/document_rows.py`, `application/document_rows.py`, `document_row_page.py`, `document_row_facets.py`, `api/document_row_routes.py`), coded against the P2/P3/P4 names in "Shared contracts" and their blocks; not `assignments/service.py` or `api/assignment_routes.py` (P3's). Post-phase after P3 and P4's contract step are merged: **Step 3 first** as the contract step: every field of the table below with its default (filled in Step 2), `ConsolidationProgressView`, the `proposals` query parameter accepted, the `TaskSummaryView` fields, regenerate, `client.ts`, fixtures, typecheck + static; hand back `CONTRACT READY`. After the merge, Steps 1–2 fill the fields. The `consolidation_progress` part needs P7 merged; if it is not yet, do the rest first and ask for a sync point.

**`AnnotationModeView`** (in `api/document_row_routes.py`; the card, plan dialog and rows read it):

```python
class AnnotationModeView(BaseModel):
    """The text's annotation mode as the card, plan dialog and rows show it."""

    mode: Literal["proposals", "scratch"]
    source: Literal["no_proposals", "locked", "plan", "project"]
    locked: bool
    override: Literal["proposals", "scratch"] | None = None
    proposal_count: int = 0

    @classmethod
    def of(
        cls, mode: TextMode, override: str | None, proposal_count: int
    ) -> "AnnotationModeView":
        return cls(
            mode=mode.mode,
            source=mode.source,
            locked=mode.locked,
            override=override,
            proposal_count=proposal_count,
        )
```

Additions (all with defaults; additive):

| Where | Field | Value |
|---|---|---|
| `AssignmentFact` | `created_at: datetime \| None = None`, `created_by: int \| None = None`, `annotation_mode: str \| None = None` | from `AssignmentRow` |
| `WorkItemView` | `assigned_at: datetime \| None = None`, `assigned_by: PersonRefView \| None = None`, `annotation_mode: Literal["proposals","scratch"] \| None = None` | `created_at`; the person reference of `created_by` built like `person` |
| `DocumentRowView` | `proposal_count: int = 0` | proposals of the newest proposal set of the row's target document (`storage/proposal_queries.newest_proposal_counts`, loaded once per request in `load_facts`; the target document is the one `application/text_targets.text_target_document` names: the read model's own `newest` must agree, a test compares both for every fixture row, R11) |
| `DocumentRowView` | `annotation_mode: AnnotationModeView \| None = None` | `text_mode(project_mode=…, plan_override=…, proposal_count=…, work_modes=…)` with the row's work in the sense of `application/annotation_modes.work_modes` (non-revoked annotate assignments, revoked ones with submitted work, `proposal_check`/`independent` submissions; one query each per request, grouped per text, oldest first; a test asserts equality with `load_text_mode` for every fixture row); overrides loaded once per request (`select(WorkPlanFlagsRow.case_id, .language, .annotation_mode)` where not null); `None` for rows that are not planned for annotation and have no annotate work |
| `DocumentRowView` | `consolidation_progress: ConsolidationProgressView \| None = None` (`open: int`, `total: int`) | only for **shown** rows (after paging) with an active, editable consolidation round: decisions from the live draft read like `consolidation._draft` (a read never creates a draft), then `consolidation_progress(conn, pid, round_id, decisions)` |
| facets | group `"proposals"` with values `"with"` / `"without"` (`proposal_count > 0`) | `FacetGroup`, `FACET_GROUPS` (append last), `facet_values` |
| filters | query `proposals: list[Literal["with","without"]] = Query(default=[])` | `RowQuery.proposals`, applied with the other facet filters |
| `TaskSummary` / `TaskSummaryView` | `assigned_at: datetime \| None = None`, `annotation_mode: Literal["proposals","scratch"] \| None = None` | `AssignmentRow.created_at`, `.annotation_mode` |

- [ ] **Step 1: Failing tests** `tests/test_document_rows_proposals.py`:

```python
"""Rows carry proposals, modes and assignment dates (spec 2026-10-23 §2, §2b)."""

from proposal_check_support import BASE, assign, client, proposal_env


def rows(env, **params):
    response = env.lead.get(f"{BASE}/document-rows", params=params)
    assert response.status_code == 200, response.text
    return {
        (r["case_id"], r["language"]): r
        for g in response.json()["groups"]
        for r in g["rows"]
    }


def test_proposal_count_and_mode_before_assignment(tmp_path):
    env = proposal_env(tmp_path)
    found = rows(env)
    c1, c2 = found[("c1", "en")], found[("c2", "en")]
    assert c1["proposal_count"] == 3
    assert c1["annotation_mode"] == {
        "mode": "proposals",
        "source": "project",
        "locked": False,
        "override": None,
        "proposal_count": 3,
    }
    assert c2["proposal_count"] == 0
    assert c2["annotation_mode"]["source"] == "no_proposals"


def test_work_items_carry_assignment_date_assigner_and_mode(tmp_path):
    env = proposal_env(tmp_path)
    assign(env, env.c1, "anno")
    item = next(w for w in rows(env)[("c1", "en")]["work"] if w["task"] == "annotate")
    assert item["assigned_at"] is not None
    assert item["assigned_by"]["display_name"]  # the lead's name
    assert item["annotation_mode"] == "proposals"
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

  `tests/test_my_tasks_dates.py`: `test_my_tasks_show_mode_and_assignment_date` (assign c1 and c2 to `anno`; `GET /api/v1/me/tasks` as `anno`: c1 `annotation_mode == "proposals"`, c2 `"scratch"`, both `assigned_at` set; a translation review task has `annotation_mode is None`).
- [ ] **Step 2:** `uv run pytest -n 4 tests/test_document_rows_proposals.py tests/test_my_tasks_dates.py -q` → FAIL; implement; → PASS. Then the read-model regression set: `uv run pytest -n 4 tests/test_document_rows*.py tests/test_final_panel_api.py tests/test_browser_documents_fixture*.py tests/test_browser_overview_fixture.py -q` (expand globs).
- [ ] **Step 3: Contracts (token 5; the contract step, done first).** Regenerate; `client.ts`: `DocumentRowsQuery.proposals?: ("with" | "without")[]` serialised like the other facet lists; `fixtures.ts` defaults `proposal_count: 0`, `annotation_mode: null`, `consolidation_progress: null`, work item `assigned_at: null`, `assigned_by: null`, `annotation_mode: null`; typecheck; `bash scripts/check.sh --only static`.
- **Done:** all fields additive with defaults; progress computed only for shown rows (one query per shown consolidating row, none otherwise).
- **Commit:** `feat(documents): proposals, annotation mode, assignment dates in rows and tasks`

### P8: Text view layers and the final-result layer (contracts writer)

- **Goal:** the text view's "Show" list comes from the server, including entries the viewer may not see (greyed, with the reason) and the final result.
- **Spec:** §4 (incl. D3: non-leads never see other people's work, not even greyed).
- **Facts verified:** `authz/versions.py:105-208` emits only `own`, `submission` (lead: `EXPORT_ALL_WORK`) and `proposals` (`may_read_proposals`); `stage_result`/`release` are never emitted; no final-result layer exists (the final selection is a badge in `CaseViewer.tsx:203-212`); `GET /documents/{doc}/annotation-versions/{kind}/{id}` re-lists refs and 404s an unlisted one (`authz/scoped.py:537`, payloads `storage/repository.py:2086-2110`). Final selections: `storage/final_tables.py:12 FinalSelectionRow(case_id, language, document_id, submission_id, selected_at, actor_id)`.
- **Owns:** `src/ontocurator/authz/versions.py`, `src/ontocurator/authz/scoped.py` (`get_annotation_version` only), `src/ontocurator/storage/repository.py` (`:2086-2110` payload of kind `final`), `src/ontocurator/api/variant_routes.py`, contracts, `frontend/src/api/client.ts` (`listTextLayers`), `tests/test_text_layers_api.py` (create).
- **Size / lane / review:** M / backend / yes.
- **Prerequisites:** contracts token 7; `application/text_targets.py` (P3), `storage/proposal_queries.py` (P2).
- **Schedule (W6):** starts once P3 is merged and an agent slot is free; implementation and tests first, Step 3 when token 7 is free (after P7's contract step).

Model and rule (in `authz/versions.py`):

```python
class TextLayerEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["proposals", "submission", "own", "final", "person"]
    ref: VersionRef | None  # None when not available
    label: str
    state: (
        Literal["submitted", "in_progress", "not_started", "accepted", "not_accepted"]
        | None
    ) = None
    count: int | None = None  # findings (submissions) or proposals
    available: bool
    reason: str | None = None
```

`text_layers(conn, access, project_id, key, doc) -> list[TextLayerEntry]`, order: proposals, people (assignment order), own, final:
- **Tool proposals** (only when the document has proposals; `n` = size of the newest proposal set, `storage/proposal_queries`): `available = may_read_proposals(...)`, label `Tool proposals ({n})`; unavailable reasons: viewer holds an annotate assignment from scratch on the text → `Hidden while you annotate from scratch.`; otherwise `Only the project lead and people annotating from proposals see them.`
- **People** (only for viewers with `EXPORT_ALL_WORK`, i.e. the lead; other viewers get **no** entry for other people's work, not even greyed, D3): one entry per non-revoked annotate assignment (and the consolidator's `review` assignment) of the document: submitted → `kind="submission"`, available, ref of the latest submission, label `{display name}, submitted {d Mon}`, `count` = findings; not submitted → `kind="person"`, unavailable, label `{display name}, {in progress|not started}`, reason `Not submitted yet.`
- **Own** submissions as today (`kind="own"`).
- **Final result** (lead): selection exists for the document → `kind="final"`, available, ref `VersionRef(kind="final", id=<submission_id>, label="Final result", created_at=selected_at)`, label `Final result, accepted {d Mon}`; no selection → unavailable `Final result (not yet accepted)`, reason `Not accepted yet.`; a selection on another version of the text → unavailable, reason `Accepted on version {n}.`
- `VersionRef.kind` Literal gains `"final"`; `get_annotation_version(kind="final")` returns the selected submission's payload (same path as `submission`) only when the ref is listed for this viewer.
- Route `GET /api/v1/projects/{key}/documents/{doc}/layers` → `{"entries": [TextLayerEntry]}` (same visibility gate as `annotation-versions`).

- [ ] **Step 1: Failing tests** `tests/test_text_layers_api.py` (`proposal_env`, submissions through the API as in P6):
  - `test_lead_sees_proposals_people_and_final_placeholder` (one check submitted by `anno`, `anno2` assigned not started: entries kinds `["proposals", "submission", "person", "final"]`; `person` unavailable with reason `Not submitted yet.`; `final` unavailable `Not accepted yet.`).
  - `test_final_layer_after_acceptance_opens_the_selected_submission` (select the submission as final with `select_final`; entry `final` available; `GET .../annotation-versions/final/{submission_id}` returns its snapshots).
  - `test_scratch_annotator_sees_proposals_greyed_and_no_people` (a text from scratch with proposals: set the c1 override to `scratch` before assigning; entries for `anno` = `[proposals (unavailable, "Hidden while you annotate from scratch."), own…]`, no `submission`/`person` entries).
  - `test_annotator_from_proposals_sees_proposals_and_only_own_work`.
  - `test_unlisted_final_ref_is_not_found` (an annotator requesting `annotation-versions/final/<id>` gets 404 `VERSION_NOT_FOUND`).
- [ ] **Step 2:** `uv run pytest -n 4 tests/test_text_layers_api.py tests/test_case_api.py tests/test_annotation_versions.py -q` → FAIL, implement, PASS.
- [ ] **Step 3: Contracts (token 7).** Regenerate; `client.ts`: `listTextLayers(key: string, documentId: string): Promise<TextLayerEntry[]>`; typecheck; `bash scripts/check.sh --only static`.
- **Done:** non-leads never get entries for other people's work (D3, tests); final layer only through the listed ref; "Accepted on version {n}" uses `text_target_document`/`text_documents` (R11).
- **Commit:** `feat(viewer): text layers with reasons and the final-result layer`

### U0: Design foundations

- **Goal:** shared pieces the card, rows, consolidation and text view use: axis value tokens (variant B), `AxisValue`, `IconBot` and `IconMore`, `StagePath`, `AssignedDate`, a "More" option of `MenuButton`, the network-error message (F14), and the route parameters the text card and the text view share (moved here from U7 so U3 and U7 can run in parallel, plan review R4).
- **Spec:** §3 "Axis values use fixed colours defined once … design tokens … Colour is never the only signal"; §2b robot icon (ISC licence noted); §2 path colours; §2 "Every assignment … carries its assignment date"; §2 "a labelled More button (with ⋯ icon), never a bare +n"; Small fixes F14.
- **Owns:** `frontend/src/styles/tokens.css` (axis aliases), `frontend/tests/tokens.test.ts` (axis contrast test), `frontend/src/ui/AxisValue.tsx` (create), `frontend/src/ui/icons.tsx` (`IconBot`, `IconMore`), `frontend/src/ui/StagePath.tsx` (create), `frontend/src/ui/AssignedDate.tsx` (create), `frontend/src/app/assignedDate.ts` (create), `frontend/src/ui/MenuButton.tsx` (`icon` prop), `frontend/src/ui/index.ts` (exports), `frontend/src/styles/components.css` (styles of the new ui pieces only), `frontend/src/api/client.ts` (`request` function only: network errors), `frontend/src/admin/errors.ts` (`NetworkError` message only), `frontend/src/app/router.ts` (params below), `frontend/tests/router.test.ts`, `DESIGN.md` (sections "Axis values", "Stage path", "More menu"), `THIRD_PARTY_NOTICES.md` (section "Lucide icons"), `LICENSES/lucide-ISC.txt` (create), tests `frontend/tests/ui/axisValue.test.tsx`, `frontend/tests/ui/stagePath.test.tsx`, `frontend/tests/ui/assignedDate.test.ts`, `frontend/tests/ui/menuButtonMore.test.tsx`, `frontend/tests/apiNetworkError.test.ts` (all create).
- **Size / lane / review:** M / frontend / –.
- **Schedule (W1 pre, W2 post):** pre-phase during L1: everything except `frontend/src/api/client.ts` and `frontend/src/admin/errors.ts` (token files, L1's until merged) and their test `frontend/tests/apiNetworkError.test.ts`; its Vitest files run in a heavy slot. Post-phase after L1 is merged (sync point): the `request` network-error change, the `NetworkError` message and their test, as the token step between L1 and P2 (Global rule 10).
- **Code to read:** `frontend/src/app/router.ts:110-245` (`projectCase`, Documents panel params), `frontend/src/ui/icons.tsx` (whole: 16×16 viewBox, stroke 1.5), `frontend/src/ui/MenuButton.tsx`, `frontend/tests/tokens.test.ts` (helpers `token`, `contrast`, `below`, `cross`), `frontend/src/api/client.ts:690-735` (`request`), `frontend/src/admin/errors.ts:200-230`, `DESIGN.md:152-190, 334-345`, `THIRD_PARTY_NOTICES.md` (section pattern of `## hpo-span-annotator`).

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

**Route parameters** (`app/router.ts`; parse and build, nothing renders them yet): `projectCase` gains optional `show` and `compare_show` (layer key `text` | `proposals` | `submission:<id>` | `own:<id>` | `final:<id>`, unknown values dropped); the Documents route's `panel_tab` accepts `history` beside the existing values. Tests in `router.test.ts`: `projectCase round-trips show and compare_show`, `unknown show values are dropped`, `panel_tab history round-trips`. U3 and U7 only read these params; the legacy `annotations=` mapping stays in U7 (viewer code).

**DESIGN.md:** add `### Axis values` under Colors (table of the ten slots, rule "the word always stays; colour is a second signal"), `### Stage path` under Components (tones, current, words for the tone), `### More menu` (labelled "More" with the ⋯ icon; never a bare "+n").

- [ ] **Step 1:** write the five test files above and the router tests; `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/ui tests/apiNetworkError.test.ts tests/tokens.test.ts tests/router.test.ts` → FAIL.
- [ ] **Step 2:** implement; same command → PASS; `npm --prefix frontend run typecheck`.
- **Done:** no new colour literal outside `tokens.css`; licence noted; DESIGN.md updated.
- **Commit:** `feat(ui): axis value colours, stage path, assigned dates, bot and more icons`

### U1: D2 names everywhere, review-of-submitted UI removed (F1, F16, D1, D2)

- **Goal:** the same D2 names everywhere before the bigger UI WPs build on them, and the frontend remains of the removed "Annotation review" task (D1) are gone.
- **Spec:** "Decisions of 2026-10-23" D1, D2; §1 "Every place that says just Review for the translation review says Translation review (F1)"; §3 "The final action is called Accept result… everywhere (F16)"; §2 "no Annotate only style labels without context".
- **Owns:** `frontend/src/app/labels.ts`, `frontend/src/app/submissionLabels.ts`, `frontend/src/tasks/ProblemReportDetail.tsx` (task map only), `frontend/src/admin/assignSummary.ts`, `frontend/src/admin/assignmentUI.tsx`, `frontend/src/admin/AssignWorkDialog.tsx` (review rows only), `frontend/src/documents/historyLines.ts`, `frontend/src/documents/labels.ts`, `frontend/src/documents/nextStepLabels.ts`, `frontend/src/documents/finalPanelText.ts`, `frontend/src/documents/FinalPanel.tsx` (labels only), `frontend/src/documents/RowPanel.tsx` (the "Assign annotation review…" button and `canAssignAnnotationReview` only; the file is deleted in U3), `frontend/src/documents/ResolveTranslation.tsx` (strings), `frontend/src/documents/planSummary.ts` (strings), `frontend/src/documents/SelectionBar.tsx` (labels and the removed action), `frontend/src/documents/filterModel.ts` (labels only), `frontend/src/documents/PlanChips.tsx` and `frontend/src/ui/PlanChip.tsx` and `frontend/src/documents/PlanDialog.tsx` and `frontend/src/documents/RowActions.tsx` and `frontend/src/admin/UploadWorkPlan.tsx` (the word "Review" only), `frontend/src/variants/ConsolidationLauncher.tsx` (role words only), `frontend/src/editor/modes.ts` (create; code in the U2 block, moved here so U3 need not wait for U2), `frontend/tests/editorModes.test.ts` (create; cases in U2's Step 1), and the unit tests asserting these strings except those under `frontend/tests/consolidation/` and `frontend/tests/leadConsolidation.test.tsx` (U6's) (find them with the grep below; list them in the hand-back). Never `client.ts`, `errors.ts`, `generated.ts` or `frontend/tests/documents/fixtures.ts` (contracts files, Global rule 10).
- **Size / lane / review:** M / frontend / –.
- **Prerequisites:** L1 committed (`grep -c "annotation_review_in_progress" frontend/src/api/generated.ts` → 0).
- **Moved (schedule revision):** the D2 strings of `consolidation/consolidationText.ts` and `consolidation/SummaryDialog.tsx` in the table below are applied by U6, the `<h2>Review</h2>` of `variants/CaseViewer.tsx` by U7; U1's Step 3 grep may still list those files.

Rename and removal table (exact strings):

| Old | New | Files |
|---|---|---|
| `taskLabels.review: "Review"` | `"Consolidation"` (task `review` is the consolidator's task now, D1) | `app/labels.ts:16`, `tasks/ProblemReportDetail.tsx:18` |
| `roleLabels.adjudicator: "Adjudicator"` | `"Consolidator"` | `app/labels.ts:36` |
| `taskLabels.annotate: "Annotation"` | unchanged (U2 appends `, from proposals` / `, from scratch` where the mode is known) | |
| `submissionLabels review: "Review"` | removed (kind gone, L1); `annotation: "Annotation, from scratch"`, add `proposal_check: "Annotation, from proposals"`; `consolidation: "Consolidation"`, `carry_forward: "Carried annotation"` | `app/submissionLabels.ts` |
| `"Annotation review"` (history, work prefix) | task `review` reads `"Consolidation"` | `documents/historyLines.ts:45, 47` |
| `"Annotation review open"` | `"Consolidation open"` | `documents/labels.ts:107, 114` |
| next step / state labels of annotation review | removed (values gone, L1) | `documents/nextStepLabels.ts`, `documents/stageLabels.ts` was handled by L1's compile fix; only leftover strings here |
| `"Assign annotation review"` action, review rows in assign dialogs, `review` branch of `eligibleMembers` and the reviewer counts in `assignSummary` | **removed** (D1); consolidators are chosen in "Consolidate…" only | `documents/SelectionBar.tsx:52-56`, `admin/AssignWorkDialog.tsx`, `admin/assignmentUI.tsx:18`, `admin/assignSummary.ts:17, 68, 76`, `documents/RowPanel.tsx:109-114, 371, 383` |
| `"Annotate only"` | `"Annotation only, no translation review"` | `documents/SelectionBar.tsx:193` (+ doc comment `:6`) |
| `"Review + annotate translations"` | `"Translation review and annotation"` | `documents/SelectionBar.tsx` |
| Plan flag `"Review"` / `"Don't review"` | `"Translation review"` / `"No translation review"` | `PlanChips.tsx:118`, `ui/PlanChip.tsx:28`, `RowActions.tsx:74`, `PlanDialog.tsx:211-218`, `admin/UploadWorkPlan.tsx:110, 118, 137, 144` (column header and chip names `Translation review, {name}`) |
| `"Turn Review on"`, `"Review on for {name}. Next: Assign translation review."` | `"Turn translation review on"`, `"Translation review on for {name}. Next: Assign reviewer…"` | `documents/ResolveTranslation.tsx:177, 190` |
| `planSummary` words `review` / `review + annotate` | `translation review` / `translation review and annotation` | `documents/planSummary.ts:52, 95` |
| facet legend/chip `"Review"` | `"Translation review"` | `filterModel.ts:53, 92`; `PLAN_LABELS.review` (`:36`) → `"Translation review"`, `review_and_annotate` → `"Translation review and annotation"` |
| `<h2>Review</h2>` | `<h2>Translation review</h2>` | `variants/CaseViewer.tsx:57` |
| `"Accept as final"`, `"Accept as final…"`, `"Accept as final?"` | `"Accept result…"`, confirm title `"Accept result?"` | `FinalPanel.tsx:281, 303, 306, 366`, `finalPanelText.ts:29, 91-94` (`"Accept your consolidation as the result?"`, `"Accept {name}'s annotation as the result?"`), `nextStepLabels.ts:47, 146-153` |
| `"Compare"` / `"Consolidate"` buttons without ellipsis where they open a dialog or screen | `"Compare results…"`, `"Consolidate…"` | `FinalPanel.tsx`, `nextStepLabels.ts` (grep `"Compare\|"Consolidate`) |
| `"You now have the Adjudicator role for this project."`, `"You will get the Adjudicator role for this project."`, `"No member has the Adjudicator role yet."` | `Consolidator` in place of `Adjudicator` | `finalPanelText.ts:23`, `variants/ConsolidationLauncher.tsx:139, 140, 150` |
| `"Consolidation submitted. Accept it as final in Documents."` / `"The lead accepts it as the final result."` | `"Consolidation submitted. Accept the result in Documents."` / `"The lead then accepts the result."` | `consolidationText.ts:56-57`, `SummaryDialog.tsx:25` |

The stage column titles (`Review` in `DocumentsTable.tsx`, `RowCells.tsx`, `StageStrip.tsx`, `DocumentCards.tsx`, `DocumentsPage.tsx:72`) are **not** changed here; U4 renames the columns to `Translation`, `Annotation`, `Finalization` and U3 deletes `StageStrip`. The editor badges (`CaseScreen.tsx`) and the project rule checkbox (`ProjectSettingsPage.tsx`) are U2's; error messages (`errors.ts`) are U2's.

- [ ] **Step 1:** `grep -rnE "\"Review\"|'Review'|Annotation review|annotation review|Annotate only|Accept as final|accepts it as the final|Adjudicator|Turn Review on|Review on for" frontend/src frontend/tests` → list; update the test expectations first (they fail against the old code); delete tests that only covered the removed review assignment UI (list them).
- [ ] **Step 2:** apply the table; `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 <the listed test files>` → PASS; `npm --prefix frontend run typecheck`.
- [ ] **Step 3:** `grep -rnE "Annotation review|annotation review|Accept as final|Annotate only|Adjudicator" frontend/src --include=*.ts --include=*.tsx | grep -v generated.ts` → only `errors.ts`, `CaseScreen.tsx`, `ProjectSettingsPage.tsx` hits (U2's), listed in the hand-back.
- **Done:** the grep in Step 3 is down to U2's files; no "Assign annotation review" anywhere; browser specs that assert old strings are listed for T3 (do not edit browser specs here).
- **Commit:** `feat(ui): D2 names, remove the annotation review assignment UI`

### U2: Annotate from proposals in the editor, My tasks, assign dialog, Settings → Workflow, error copy, F8, V2

- **Goal:** the annotator works through proposals in the existing review screen; My tasks, the assign dialog and Settings show the mode in D2 words; the editor badges, the project rule and every error message use D2 words; the task opens calmly; the editor header shows the language flag.
- **Spec:** §1 Q1 (J/K, 1–4/0), Q3 (assign dialog shows the mode; Settings → Workflow), §2 "Every assignment shown anywhere (… My tasks, history, assign dialog holders) carries its assignment date"; Small fixes F8, V2; D2 (badges, roles, error copy).
- **Owns:** `frontend/src/app/CaseScreen.tsx`, `frontend/src/editor/decisionSemantics.ts`, `frontend/src/variants/SubmissionHistory.tsx` (mode → kind), `frontend/src/tasks/MyTasks.tsx`, `frontend/src/tasks/TaskEditor.tsx` (loading state), `frontend/src/translation/TranslationReviewScreen.tsx:90` (loading state), `frontend/src/admin/AssignWorkDialog.tsx`, `frontend/src/admin/projectFields.tsx`, `frontend/src/admin/ProjectSettingsPage.tsx` (workflow radio group, rule checkbox label), `frontend/src/admin/errors.ts` (D2 wording of existing messages), tests `frontend/tests/proposalCheckScreen.test.tsx` (create), `frontend/tests/myTasks.test.tsx`, `frontend/tests/assignWorkDialog.test.tsx`, `frontend/tests/projectSettings.test.tsx`, `frontend/tests/taskLoading.test.tsx` (create).
- **Size / lane / review:** M / frontend / –.
- **Code to read:** `CaseScreen.tsx` lines from `grep -n 'mode === "review"\|mode !== "review"' frontend/src/app/CaseScreen.tsx` — **the grep is the source of truth** (18 matches on `main` 6d8bc1b: 294, 554, 598, 913, 1093, 1746, 2252, 2333, 2383, 2481, 2653, 2655, 2686, 2776, 2783, 2923, 3269, 3447; plan review R21); `FinalPanel.tsx:267` is **not** a site (it compares `panelMode`, not a workspace mode, R2), `editor/decisionSemantics.ts`, `tasks/MyTasks.tsx`, `admin/AssignWorkDialog.tsx:180-240`, `admin/projectFields.tsx:80-123`, `tasks/TaskEditor.tsx:30-130`, `styles/components.css:610-625` (reading density first child), `tests/caseScreen.test.tsx` (how a review view is rendered in tests).
- **Prerequisites:** `grep -n "proposal_check" frontend/src/api/generated.ts` (P2 contracts), `grep -c '"assisted"' frontend/src/api/generated.ts` → 0 (L1), `grep -n "assigned_at" frontend/src/api/generated.ts` (P5 contract step), `grep -n "export function annotationTaskName" frontend/src/editor/modes.ts` (U1), P4 committed (`grep -n "tool_proposal_mode" frontend/src/api/generated.ts`, `projectSettings.test.tsx`); the `errors.ts` sweep is the last step and takes the contracts token after P8's contract step (sync point).
- **Moved (schedule revision):** `editor/modes.ts` and `editorModes.test.ts` are created by U1 (code and cases below stay the reference); the F8 CSS (`.task-loading`, the reading-density rule) and the removal of `.badge-assisted` in `components.css` are U8's; the removal of `.app-title .badge-assisted` in `editor.css` is U7's. U2's Done greps run without `--include=*.css`.

`editor/modes.ts` (created by U1):

```ts
import type { WorkspaceMode } from "../api/client";

/** Modes with targets and decisions: consolidation (`review`) and annotation from proposals. */
export function isReviewLike(mode: WorkspaceMode | string | undefined): boolean {
  return mode === "review" || mode === "proposal_check";
}

export function modeBadge(mode: string): { label: string; title?: string; className: string } {
  if (mode === "proposal_check") return { label: "Annotate from proposals", title: "You see the tool's proposals, never other people's work.", className: "badge-review" };
  if (mode === "review") return { label: "Consolidate", className: "badge-review" }; // consolidation rounds only (D1)
  return { label: "Annotate from scratch", title: "You see neither the tool's proposals nor other people's work.", className: "badge-independent" };
}

export function annotationTaskName(mode: "proposals" | "scratch" | null | undefined): string {
  return mode === "proposals" ? "Annotation, from proposals" : mode === "scratch" ? "Annotation, from scratch" : "Annotation";
}
```

(If `WorkspaceMode` is not exported from `client.ts`, import the type from `generated.ts` the way `client.ts` does.) Every `view.key.mode === "review"` in `CaseScreen.tsx` and `decisionSemantics.ts:9` becomes `isReviewLike(view.key.mode)`; the badge block at `:2774-2787` uses `modeBadge` (text-change/carry branches unchanged; the consolidation round badge `"Consolidation review"` becomes `"Consolidate"`, D2); the shortcut group name `"Review"` (`:2654-2655`) becomes `"Decisions"` (the help overlay lists J/K and 1–4/0 there). `SubmissionHistory.tsx:27`: kind `proposal_check` for mode `proposal_check`, labels from `submissionLabels.ts`. `.badge-assisted` rules removed from `components.css:275` and `editor.css:1324`.

**D2 copy sweep (U2's files only):** `ProjectSettingsPage.tsx:203` rule label → `The consolidator of a text may not be one of its annotators`; `errors.ts`: every existing message with `Adjudicator`, `adjudicator`, `annotation review`, `Annotation review`, `blind`, a bare `Review` or `Accept as final` gets the D2 word (`grep -nE "[Aa]djudicator|[Aa]nnotation review|blind|\"Review|Accept as final" frontend/src/admin/errors.ts`; list each change in the hand-back; codes unchanged).

**V2:** the editor header `<h1 className="case-title">` gets `<LanguageTag language={view.document.language} />` after the case id (from `ui/LanguageTag.tsx`).

**F8:** `TaskEditor.tsx:40, 123` and `TranslationReviewScreen.tsx:90`: replace the info `InlineMessage` with `<p className="task-loading" role="status">Opening task…</p>` (translation: `Opening translation review…`) and CSS `.task-loading { color: var(--text-muted); padding: var(--space-5) var(--space-6); flex: 0 0 auto; }` so the reading-density rule (`components.css:619`, first child stretches) does not paint a large blue area: also change that rule to `.shell-main.density-reading > div:first-child:not(.task-loading)`.

**My tasks:** task column `annotationTaskName(task.annotation_mode)` for annotate tasks, `"Consolidation"` (task `review`) / `"Translation review"` otherwise; new column "Assigned" with `<AssignedDate at={task.assigned_at} />`.

**Assign dialog:** for task `annotate` on a row, a line `Annotation, from proposals` / `Annotation, from scratch` from `row.annotation_mode.mode` (with the no-proposals reason when `source === "no_proposals"`); "Currently:" lists holders as `{name}, assigned {…}` using `assignedText(new Date(item.assigned_at), now)` (`Already assigned (1 of 2): Tom Reis, assigned today 10:40. Choose 1 more person.` per mockup).

**Settings → Workflow:** `WorkflowDraft.tool_proposal_mode`; a radio group legend `Texts with tool proposals`, options and help texts from the Copy table; saved with the other workflow fields (`ProjectSettingsPage.tsx:106, 118`).

- [ ] **Step 1: Failing tests.**
  - `editorModes.test.ts`: `isReviewLike` for the three modes (`independent`, `review`, `proposal_check`); `modeBadge("review").label === "Consolidate"`; `modeBadge("proposal_check").label === "Annotate from proposals"`; `annotationTaskName` three cases.
  - `proposalCheckScreen.test.tsx` (render `CaseScreen` with a view whose `key.mode` is `"proposal_check"` and three targets, built like the review fixtures in `tests/caseScreen.test.tsx`): `shows the Annotate from proposals badge`, `lists the proposals as review targets`, `J moves to the next proposal and 1 confirms it` (fires `keydown` J then 1; the decision API mock is called with outcome `confirmed` for the second target), `Submit is unavailable until every proposal has a decision` (`aria-disabled="true"` with the reason text), `the header shows the language flag` (V2).
  - `myTasks.test.tsx`: `shows the annotation mode and the assigned date` (`Annotation, from proposals`, `assigned today 10:40` with a fixed `now`).
  - `assignWorkDialog.test.tsx`: `shows the annotation mode of the text`, `lists holders with their assignment date`.
  - `projectSettings.test.tsx`: update the payload expectation at `:472-501` to include `tool_proposal_mode`; new `it("saves Texts with tool proposals")` (options `Annotate from proposals` / `Annotate from scratch` with their help texts); `it("names the consolidator rule in D2 words")`.
  - `taskLoading.test.tsx`: `Opening task… is a calm status line, not an info notice` (no element with class `notice-info`; `role="status"` text `Opening task…`).
- [ ] **Step 2:** run them → FAIL; implement; → PASS: `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/editorModes.test.ts tests/proposalCheckScreen.test.tsx tests/myTasks.test.tsx tests/assignWorkDialog.test.tsx tests/projectSettings.test.tsx tests/taskLoading.test.tsx tests/caseScreen.test.tsx tests/decisionSemantics.test.ts tests/adminErrors*.test.ts` (expand with `ls`; update expectations of changed messages); typecheck.
- **Done:** `grep -rn 'mode === "review"\|mode !== "review"' frontend/src` → empty outside `editor/modes.ts`; `grep -rnE "Adjudicator|[Aa]nnotation review|Independent annotation|Assisted annotation|badge-assisted" frontend/src --include=*.ts --include=*.tsx --include=*.css | grep -v generated.ts` → empty.
- **Commit:** `feat(editor): annotate from proposals screen, task names with mode and dates, D2 copy`

### U6: Consolidation table screen

- **Goal:** the group card becomes the comparison table of the mockup (variant B), every group resolves to one finding, the result is always spelled out, agreed groups sit in the same list, and the screen shows the text path.
- **Spec:** §3 (all bullets, incl. the robot icon on findings from a tool proposal, D2), F9, F10, F11, F12, F15, F16, F17.
- **Facts verified:** `GroupCard.tsx` (305 lines: chips `:61-75` with " · differs", `Comparison` `:78-111`, "Whole finding" chips `:232-241`, action buttons `:248-256`), `GroupList.tsx` puts auto-kept groups in their own `<section aria-label="Kept automatically">` (`:58-64`), `groupModel.ts` builds rows/choices/payload, `ConsolidationScreen.tsx:263` header "Consolidate case-0107 · en v1". After P7 no keep-both code remains.
- **Owns:** `frontend/src/consolidation/*` (all files), `frontend/tests/consolidation/*`, `frontend/tests/leadConsolidation.test.tsx` (strings only), `DESIGN.md` (section "Consolidation view" `:334-345` rewritten).
- **Size / lane / review:** L / frontend / yes.
- **Prerequisites:** `grep -c "term_parts\|keep_both" frontend/src/consolidation/*.ts*` → 0 (P7); `grep -n "export function StagePath" frontend/src/ui/StagePath.tsx` and `grep -n "export function AxisValue" frontend/src/ui/AxisValue.tsx` (U0). **Schedule (W4 pre, W8 post):** pre-phase only if an agent slot and a lane are idle, after U0 is merged: new files under `frontend/src/consolidation/` and new tests only; post-phase after P7 is merged. U6 also applies U1's D2 strings for `consolidationText.ts` and `SummaryDialog.tsx` (U1 label table) and their assertions in `frontend/tests/consolidation/*` and `leadConsolidation.test.tsx`.

Structure (files after this WP):

| File | Content |
|---|---|
| `ConsolidationScreen.tsx` | header: `<StagePath segments={[{id:"translation",…tone:"done"},{id:"annotation",title:"Annotation",state:`${n} submitted`,tone:"done"},{id:"finalization",title:"Finalization",state:`consolidating, ${open} of ${total} groups open`,tone:"now"}]} label="Text path" />` (translation segment `source text` for a native text, else `accepted`/`not reviewed, optional` from the round's text facts already in the view; if the view lacks them, show `Translation` with state `done` — check `ConsolidationView` fields first); `<h1>Consolidate {case} {language} v{n}</h1>` (no `·`); one `GroupList`; `SubmitBar`; `SummaryDialog` |
| `GroupList.tsx` | one `<ul aria-label="Groups">` in document order of `start`; open groups first is **not** done (order by text position, spec "same list style"); agreed (auto-kept) groups render with `GroupCard` in collapsed form marked `agreed`; J/K walk open groups only (unchanged keys) |
| `GroupCard.tsx` | header: `!` icon (`IconWarning`, `aria-hidden`, visually hidden text "Conflict") when the group has decisions, the group name (the text excerpt), `{n} fields to decide` / `agreed` / `decided`; body `ComparisonTable`; `ResultLine`; footer: `Leave out`, `Other term…`, `Edit in editor…` (existing actions, plain buttons, no pills) |
| `ComparisonTable.tsx` (create) | `<table>` with `<caption className="visually-hidden">Comparison of {group}</caption>`; column headers = people (name + lane line swatch `LaneKey`; when that person's finding has `from_tool_proposal`, an `IconBot` with title and accessible text `From a tool proposal` after the name); rows: `Term`, each axis of the layer type, `Text`, `Note`, `Whole finding` |
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
  - `findings from a tool proposal carry the robot icon` (a member with `from_tool_proposal: true` has an element with accessible name `From a tool proposal` in its column header; a member without has none).
  - `the screen shows the text path with Finalization current` (`getByRole("navigation", { name: "Text path" })` with `Finalization` text and `consolidating, 2 of 3 groups open`).
  - `J and K walk the open groups`; `Submit is unavailable until every group is resolved`; `the submitted message says Accept the result in Documents` (unchanged behaviour, new copy).
- [ ] **Step 3:** implement; `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/consolidation tests/leadConsolidation.test.tsx tests/consolidationEditor.test.tsx` → PASS; typecheck.
- [ ] **Step 4:** `DESIGN.md` "Consolidation view" table updated (comparison table, result line, agreed marker, path; remove chips/"Keep both"/banner/"· differs").
- **Done:** every §3 bullet visible in a test; no `·`, no pills, no keep both; robot icon only for findings from a tool proposal.
- **Commit:** `feat(consolidation): comparison table with result line and one finding per group`

### U3: Text card (replaces the row side panel)

- **Goal:** one click on a row opens a centered card with the path and the selected segment's details and actions; the old panel, its tabs and the stage strip go away.
- **Spec:** §2 (all bullets), V1, F4, F6, F17, F20, F21, F22, F24.
- **Owns:** `frontend/src/documents/textCard/` (create: `TextCard.tsx`, `cardModel.ts`, `TranslationPart.tsx`, `AnnotationPart.tsx`, `FinalizationPart.tsx`, `AssignmentChip.tsx`, `RemoveAssignmentDialog.tsx`, `CardFooter.tsx`, `textCard.css`), `frontend/src/documents/RowPanel.tsx` (delete), `frontend/src/documents/StageStrip.tsx` (delete), `frontend/src/documents/StagePopover.tsx` (**kept**: `DocumentCards.tsx:20` (U4's) imports it; only its `STAGE_TITLES` import changes and "Open full details" opens the card), `frontend/src/documents/stageLabels.ts` (receives `STAGE_TITLES` from `StageStrip.tsx:11`, renamed to the path names `Translation`/`Annotation`/`Finalization`), `frontend/src/documents/StageActions.tsx` (create: `StageActions`/`StageActionsProps` moved out of `RowPanel.tsx:354-400`, without the review-of-submitted option, because `admin/DocumentsPage.tsx:34` imports them for the cards view), `frontend/src/styles/screens/documents-panel.css` (delete; card styles in `textCard.css`, imported by `TextCard.tsx`), `frontend/src/styles/index.css` (remove the `documents-panel.css` import; the only `index.css` writer, R4), `frontend/src/documents/RowActivity.tsx` (reused as History; dates via `AssignedDate`; `STAGE_TITLES` from `stageLabels.ts`), `frontend/src/documents/TextVersions.tsx` (reused in the Translation part), `frontend/src/documents/FinalPanel.tsx` (embedding only), `frontend/src/admin/DocumentsPage.tsx` + `frontend/tests/documentsPage.test.tsx` (panel wiring → card wiring), tests `frontend/tests/documents/textCard.test.tsx`, `frontend/tests/documents/cardModel.test.ts`, `frontend/tests/documents/assignmentChip.test.tsx` (create); delete `frontend/tests/documents/rowPanel.test.tsx`, `rowPanelReports.test.tsx` (their still-valid cases move to `textCard.test.tsx`); `frontend/tests/documents/stagePopover.test.tsx` and `stageLabels.test.ts` (import paths and titles only).
- **Size / lane / review:** L / frontend / yes.
- **Importers of deleted files (R5, verified on `main` 6d8bc1b):** `admin/DocumentsPage.tsx:34` imports `RowPanel, StageActions, RowPanelTarget, StageActionsProps` from `RowPanel`; `documents/RowActivity.tsx:15` and `documents/StagePopover.tsx:15` import `STAGE_TITLES` from `StageStrip`; `documents/DocumentCards.tsx:20` imports `StagePopover`. U3 relocates before deleting: `StageActions` → `documents/StageActions.tsx`, `STAGE_TITLES` → `stageLabels.ts`; `StagePopover` stays, so `DocumentCards.tsx` needs no edit. After U3, `grep -rn 'from "\./RowPanel"\|from "\./StageStrip"\|documents/RowPanel\|documents/StageStrip' frontend/src frontend/tests` → empty.
- **Code to read:** `RowPanel.tsx` (whole: props, J/K, focus return, narrow sheet), `admin/DocumentsPage.tsx:500-640` (panel route params, `DecisionBlock` wiring, `onAssign`, `rowExtras`), `documents/stageLabels.ts:181-230` (`stageText`, `waitingOnText`), `documents/RowActivity.tsx`, `documents/TextVersions.tsx`, `ui/Dialog.tsx` (`variant="center"`, `size="lg"`, `returnFocus`), `ui/ConfirmDialog.tsx`.
- **Prerequisites:** pre-phase (W4): U0 and U1 merged; post-phase (W8): P3 merged and P5's contract step merged (`removeAssignment`, `assigned_at`, `annotation_mode`, `proposal_count`, `consolidation_progress`); DocumentsPage token 1 for the wiring step. U3 does not wait for U2: the mode line uses `annotationTaskName` from `editor/modes.ts` (U1).

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
| | `in_progress`, `paused` | `{submitted} of {target} submitted` | now |
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
  onAssign: (row: DocumentRowView, task: "translation_review" | "annotate") => void;  // task review only via Consolidate… (D1)
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
- **AnnotationPart:** mode line `Annotation, from proposals` / `Annotation, from scratch` and the reason when `source === "no_proposals"`; `{n} tool proposals` with `View proposals` (route to the text view, `show=proposals`); one `AssignmentChip` per annotate assignment: name, state (`not started` / `in progress` / `submitted`), `AssignedDate`, and for unsubmitted ones (lead only) an `✕` button `Remove {name}`; `+ Person` (`onAssign(row, "annotate")`, unavailable with reason when the limit is reached: `{target} of {target} assigned`); `Annotate from proposals myself` when `annotation_mode.mode === "proposals"` and the lead holds no annotate assignment on the row (calls `onCheckMyself`, then navigates to the task route of the returned assignment); when the page's `adjudicator_not_annotator` is true, the button carries the hint `You will then not be able to consolidate this text yourself (project rule).` as visible secondary text under it and as `aria-describedby` (plan review R16); a person's chip name links to the text view with that person's layer (`show=submission:<id>` when submitted).
- **RemoveAssignmentDialog:** `ConfirmDialog` title `Remove assignment?`, body `Remove {name} from the annotation of {case}? Their draft is discarded.`, buttons `Cancel` / `Remove` (danger); confirm → `api.removeAssignment(id)` → `onChanged()`; an `ASSIGNMENT_SUBMITTED` error shows its message inline.
- **FinalizationPart:** the state sentence (`Starts when all {target} annotations are submitted: compare the results, consolidate the differences, then accept the result.` while waiting), the `decision` node (Compare results…, Consolidate…, Accept result…), the final result with `Open result` (text view `show=final`).
- **CardFooter:** `History ({n})`, `Text details`, `Change plan…` (`onChangePlan`). No tabs.
- **Narrow (V1):** below 700 px the Dialog is a full-width sheet (`.text-card` media query: `inset: 0; width: 100%; max-height: 100dvh; border-radius: 0`); all text wraps at word boundaries (`overflow-wrap: anywhere` is **not** used; `word-break: normal; overflow-wrap: break-word` on long ids only).

DocumentsPage wiring: replace `<RowPanel …>` by `<TextCard …>` with the same route params (`panel`, `panel_stage` mapped `review→translation`, `annotation→annotation`, `final→finalization` and back; `panel_tab` `activity|versions|details` → `view` `path|path|details`, new value `history`); `onStep` uses the current page order; closing keeps the selection; `onCheckMyself` → the existing assign call `api.createAssignments` (the lead's own username, task `annotate`, `confirm_language: true`; P3 grants the annotator role) then `onNavigate({ name: "task", assignmentId })` with the returned assignment; `rowExtras` and the side-panel non-modal behaviour are removed (the card is modal). The `+n` menu and row actions stay until U4.

- [ ] **Step 1: Failing tests.**
  - `cardModel.test.ts`: one test per state-table line (fixtures via the builders in `tests/documents/fixtures.ts` + a local `cardFixtures.ts`): e.g. `native text reads source text and done`, `machine translation without review reads not reviewed, optional`, `annotation 1 of 2 assigned with 17 proposals is now`, `2 of 2 submitted is done and finalization is ready to compare`, `consolidating shows 2 of 3 groups open`, `accepted shows the date`; `defaultSegment picks the segment that needs work now`.
  - `assignmentChip.test.tsx`: `shows name, state and assigned date`, `the ✕ asks first with the exact text`, `Cancel keeps the assignment`, `Remove calls removeAssignment and reloads`, `submitted chips have no ✕`.
  - `textCard.test.tsx`: `opens on the segment that needs work now`, `the path switches the part below`, `the header shows the version only when the text has more versions`, `the annotation part shows the mode, the proposal count and View proposals`, `+ Person is unavailable with the reason when the limit is reached`, `Annotate from proposals myself assigns and opens the task`, `Annotate from proposals myself shows the consequence when the consolidator rule is on` (and no hint when it is off), `no chip offers a review of a submitted annotation`, `‹ › step through the table order`, `Esc and ✕ close without changing the selection`, `History and Text details open inside the card with Back`, `Change plan… calls onChangePlan`, `the finalization part embeds the decision block`, `narrow screens get a full-width sheet` (class at 600 px via `useMediaQuery` mock).
  - `documentsPage.test.tsx`: replace the panel cases (`:995-1147`) by card cases: `a row's card opens from the route and shows the translation segment for panel_stage=review`, `closing the card keeps the selection`, `Annotate from proposals myself navigates to the task`.
- [ ] **Step 2:** implement; `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/documents/textCard.test.tsx tests/documents/cardModel.test.ts tests/documents/assignmentChip.test.tsx tests/documentsPage.test.tsx tests/documents/a11y.test.tsx` → PASS; typecheck.
- **Done:** `grep -rn "RowPanel\|StageStrip\|panel_tab=\"versions\"" frontend/src frontend/tests` → empty; `npm --prefix frontend run typecheck` clean (no importer of a deleted file left); every §2 card bullet covered by a test; browser specs referencing the panel listed for T3.
- **Commit:** `feat(documents): text card with the path replaces the row panel`

### U7: Text view (replaces the CaseViewer fold-out)

- **Goal:** one toolbar, a language-and-version dropdown, a "Show" dropdown with greyed entries and reasons, read-only findings on the right with the axis colours, "Compare" as a second column.
- **Spec:** §4 (incl. D3: no entries for other people's work for non-leads, not even greyed); Small fixes V8 (language as plain text with flag).
- **Owns:** `frontend/src/variants/CaseViewer.tsx`, `frontend/src/variants/TextViewToolbar.tsx` (create), `frontend/src/variants/ShowSelect.tsx` (create), `frontend/src/variants/VersionSelect.tsx` (create), `frontend/src/variants/LayerFindings.tsx` (create), `frontend/src/variants/useTextLayers.ts` (create), `frontend/src/variants/ComparePane.tsx` (axis values via `AxisValue`), `frontend/src/editor/FindingRow.tsx` (`:46-48` axis values via `AxisValue`; spec §3 "used everywhere axis values appear"), `frontend/tests/findingRow.test.tsx`, `frontend/tests/comparePane.test.tsx`, `frontend/src/variants/textView.css` (create; imported by `CaseViewer.tsx`, so `styles/index.css` stays U3's, R4), `frontend/src/styles/screens/editor.css` (remove the dead `.case-version-controls` viewer rules and `.app-title .badge-assisted`, moved from U2), tests `frontend/tests/textView.test.tsx` (create), `frontend/tests/caseViewer.test.tsx`, `frontend/tests/caseCompareRoute.test.tsx`. The route params `show`/`compare_show` come from U0's `router.ts` (read only). `VariantSelectors.tsx` stays (the editor still uses it, `CaseScreen.tsx:2734-2742`).
- **Size / lane / review:** M / frontend / –.
- **Code to read:** `variants/CaseViewer.tsx` (whole), `variants/VariantSelectors.tsx`, `variants/versionState.ts:36-90`, `variants/useCaseVersions.ts`, `variants/ComparePane.tsx`, `variants/ReadOnlyAnnotationView.tsx`, `app/router.ts:110-245`.
- **Prerequisites:** `grep -n "listTextLayers" frontend/src/api/client.ts` (P8); `grep -n "compare_show" frontend/src/app/router.ts` (U0). U7 also replaces `CaseViewer.tsx`'s `<h2>Review</h2>` with D2 wording (moved from U1).

Route: `#/projects/{key}/cases/{caseId}?variant=<doc>&show=<layer key>&compare=<doc>&compare_show=<layer key>`; layer key = `text` | `proposals` | `submission:<id>` | `own:<id>` | `final:<id>`; the legacy `annotations=` JSON key is read once and mapped to `show` (old links keep working).

Toolbar (`TextViewToolbar.tsx`): `‹ Documents` (back link, keeps the Documents query), the case id, `VersionSelect` (one `<select aria-label="Language and version">`, options `{flag} {language}, version {n} ({origin words})`, e.g. `de, version 1 (machine translation)`, source first, then translations and newer versions, from `useCaseVersions`), `ShowSelect`, `Compare` (toggle; opens the second column), `Text card` (route to Documents with `panel={case}:{language}`). No `·`, no `<h1>Text: …</h1>` with separators; the `<h1>` is `{case id}` with the language as plain text and flag.

`ShowSelect.tsx`: a `<select aria-label="Show">` with `<optgroup label="Text">` (`Text only`), `Proposals` (`Tool proposals (n)`), `Annotations` (people and own), `Result` (`Final result`); unavailable entries are `<option disabled>` with the label and the reason appended (`Mia Berg, in progress (not visible yet)` as in the mockup: label + ` (` + reason without the final period + `)`); entries from `useTextLayers` (`api.listTextLayers`).

`LayerFindings.tsx`: right column `<section aria-label="Findings">` heading `{layer label}` and a list of findings `{term label} ({term id})` with `AxisValue` per axis; first 20 and `{n} more…` (button reveals the rest); no edit controls.

The left/middle uses `ReadOnlyAnnotationView` with the chosen layer (`text` → no marks). Compare: a second column with its own `VersionSelect` and `ShowSelect`, coupled scroll as today (`useCoupledScroll`).

- [ ] **Step 1: Failing tests** (`textView.test.tsx`, api mocked with `vi.spyOn`): `one toolbar with Documents, case id, language and version, Show, Compare, Text card`, `the version select lists source and newer versions with origin words`, `Show lists proposals, people, result with unavailable entries greyed and their reason` (lead), `an annotator's Show list has no entries for other people` (D3: only text, proposals if entitled or greyed with the reason, own work), `choosing a layer draws its marks and lists its findings with axis colours`, `Compare opens a second column with its own selects`, `nothing is editable` (no textbox, no button named Save/Delete), `legacy annotations= links map to show`, `the language is plain text with a flag, not a link` (V8); `findingRow.test.tsx` and `comparePane.test.tsx`: `axis values carry their fixed colour slot` (`Absent` has class `axis-value--absent`). Update `caseViewer.test.tsx`/`caseCompareRoute.test.tsx` expectations (no `Versions` summary, no three selectors).
- [ ] **Step 2:** implement; `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/textView.test.tsx tests/caseViewer.test.tsx tests/caseCompareRoute.test.tsx tests/comparePane.test.tsx tests/findingRow.test.tsx` → PASS; typecheck.
- **Done:** the "Versions" fold-out is gone from the viewer; every §4 bullet has a test.
- **Commit:** `feat(viewer): text view with one toolbar and a Show choice`

### U4: One-line rows, row click, selection bar for 2+, robot icon, filter, More menu, overflow

- **Goal:** about 16 texts per 1280×900 screen; one click selects and opens the card, a second click deselects; the bar only for bulk work; tool proposals visible before anyone is assigned.
- **Spec:** §2b (all bullets), §2 "Row click toggles the selection", "Bottom selection bar … only when 2 or more", "Documents table row actions: … labelled More"; Small fixes F2/V8, F7, V4 (table links), V7, "Documents page … Fix the overflow".
- **Facts verified:** the "never deselects" rule is `documents/DocumentsTable.tsx:68-80` (`openAndSelect` with mode `"select"`), wired at `:138, :140-144, :152-156, :206`; selection modes in `documents/useTextSelection.ts:70-82`; `SelectionBar` shows for `keys.size > 0 || undoState` (`SelectionBar.tsx:176`); "+n" `MenuButton` at `RowActions.tsx:139-145`; language rendered as a link-styled button (`RowCells.tsx:324-330`, `documents-table.css:61-64`); `Open`/`Open my task` stack (`RowCells.tsx:260-275`, `documents-table.css:55`); `.shell-main` has no `position: relative` while rows contain many `position: absolute` `.visually-hidden` spans (`components.css:522, 616`), the likely cause of the 3990 px document height.
- **Owns:** `frontend/src/documents/DocumentsTable.tsx`, `RowCells.tsx`, `RowActions.tsx`, `SelectionBar.tsx`, `useTextSelection.ts`, `DocumentCards.tsx`, `filterModel.ts`, `FilterPopover.tsx`, `stageLabels.ts` (one-line texts), `frontend/src/ui/spaceActivates.ts` (create), `frontend/src/styles/screens/documents-table.css`, `documents-cards.css`, `selection.css`, `frontend/src/styles/components.css` (`.shell-main` rule only), `frontend/src/admin/DocumentsPage.tsx` + `frontend/tests/documentsPage.test.tsx` (columns, skeleton header `:72`, row click, bar), tests `frontend/tests/documents/documentsTable.test.tsx`, `rowActions.test.tsx`, `selectionBar.test.tsx`, `documentCards.test.tsx`, `filterModel.test.ts`, `filterPopover.test.tsx`, `useTextSelection.test.ts`, `stageLabels.test.ts`, `a11y.test.tsx`, `frontend/tests/documents/rowClick.test.tsx` (create).
- **Size / lane / review:** L / frontend / yes.
- **Prerequisites / schedule (W4 pre, W10 post):** pre-phase: U1 merged; components and component tests only, not `stageLabels.ts`, `stageLabels.test.ts`, `DocumentsPage.tsx`, `documentsPage.test.tsx` or tests that render `DocumentsPage`; ask for a sync point once P5's contract step is merged (robot icon, `proposals` facet types). Post-phase: U3 merged; DocumentsPage token 2 and `stageLabels.ts`. **V4 (moved from U8):** the link-styled buttons at `DocumentsPage.tsx:123-124` use `onSpaceActivate`; test in `documentsPage.test.tsx`.

Columns (`DocumentsTable.tsx`): `[checkbox] Text | Translation | Annotation | Finalization | Waiting on | Next step | Last activity` (headers visible except the checkbox column, whose header is the "select all on page" checkbox as today).
- **Text:** `<button className="documents-text-name">` (plain text style, not a link: `color: var(--text)`, no underline; focus ring kept) with `LanguageFlag` + language code; `aria-label={`Open text card, ${case} ${language}`}`; NEW and version marker badges stay after it.
- **Case line** (group label row): `{case id}` and, when the case's source row is not in the plan, `source {lang} (native), {n} translation(s)` in grey; that source row is then not rendered as its own row. A planned native text (Annotate on) stays a normal row.
- **Status cells:** one line each: the short state from `cardModel.translationState/annotationState/finalizationState` (shared with the card; import from `textCard/cardModel.ts`) plus a short grey "who" when it fits (`in review (Ana)`); `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` with the full text in `title`.
- **Robot icon:** in the Annotation cell when `row.proposal_count > 0` and the row has no non-revoked annotate work: `<span className="documents-bot" title={t} aria-label={t} role="img"><IconBot /></span>` with `t = `${n} tool proposals available; the annotation starts from them``. Gone once someone is assigned.
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
- **Owns:** `frontend/src/documents/PlanSteps.tsx` (create), `frontend/src/documents/PlanDialog.tsx`, `frontend/src/documents/PlanChips.tsx`, `frontend/src/documents/RowActions.tsx` (`PlanPopover` → opens the dialog), `frontend/src/documents/planSummary.ts`, `frontend/src/styles/screens/work-plan.css`, `frontend/src/admin/DocumentsPage.tsx` + `frontend/tests/documentsPage.test.tsx`, tests `frontend/tests/documents/planSteps.test.tsx` (create), `planDialog.test.tsx`, `planChips.test.tsx`, `planSummary.test.ts`.
- **Prerequisites / schedule (W7 pre, W11 post):** pre-phase: U1 and P4's contract step merged (`grep -n "mode_locked" frontend/src/api/generated.ts`): `PlanSteps.tsx`, `PlanDialog.tsx`, `PlanChips.tsx`, `planSummary.ts`, `work-plan.css` and their tests; post-phase after U4 is merged: `RowActions.tsx` (`PlanPopover`) and DocumentsPage token 3.
- **Size / lane / review:** M / frontend / –.
- **Code to read:** `PlanDialog.tsx`, `PlanChips.tsx` (`usePlanSaves`, `PlanSaves`), `planSummary.ts`, `api/client.ts` (`patchWorkPlan`, `bulkPlan…`), the generated `PlanRowPatch`, `LanguageChangeView`, `LanguagePreviewView`, `BulkResult` (P4's `annotation_mode`, `mode_locked`, `mode_no_proposals`).

`PlanSteps.tsx` (one text):

```ts
export interface PlanStepsProps {
  row: DocumentRowView;                 // plan_row, annotation_mode, is_source
  value: { review: boolean; annotate: boolean; mode: "proposals" | "scratch" | "project" };
  onChange: (next: PlanStepsProps["value"]) => void;
}
```

Renders two `<fieldset>`s:
1. `Translation review` (only for translations): radios `On` / `Off`; help `On: a person reviews the machine translation before annotation.` / `Off: the translation is annotated as it is.`
2. `Annotation`: radios `Off (not annotated)`, `Annotate from proposals`, `Annotate from scratch`; help `Annotate from proposals: each annotator confirms, rejects or corrects the {n} tool proposals and adds the findings the tool missed.` / `Annotate from scratch: annotators start from the plain text and do not see the proposals.`; `Annotate from proposals` is unavailable (`aria-disabled` + reason) when `proposal_count === 0` (reason `This text has no tool proposals, so it is annotated from scratch.`); both mode radios are unavailable while `annotation_mode.locked` (reason = lock reason), except the current mode; when the text follows the project setting, the matching option shows `(project setting)`.

Single text ("Change plan…" from the card): `Dialog` size `md`, title `Plan for {case} {language}`, `PlanSteps`, footer `Cancel` / `Save`; Save sends the flags and, when it changed, `annotation_mode` (`"project"` when the text follows the project setting) in **one** existing row PATCH (P4: one transaction, so nothing is half saved); a refusal shows inline (`ANNOTATION_MODE_LOCKED`, `NO_TOOL_PROPOSALS` messages from `errors.ts`) and the dialog stays open with the user's choices. The large frame with lone pills is gone (`PlanPopover` in the row is removed; plan changes happen in the card or the bulk dialog).

Bulk "Plan…" (`PlanDialog.tsx`): per language a block with the same two fieldsets in tri-state form (`Keep`, then the options), plus a summary line from `planSummary.ts` (`Will change: {n} texts`); the mode goes as `LanguageChangeView.annotation_mode` through the existing bulk preview and save (P4); the preview line and, after saving, the toast report `{changed} texts changed; {locked} kept their mode because the annotation has started; {no_proposals} have no tool proposals.` from `mode_locked` / `mode_no_proposals` (parts with 0 omitted).

- [ ] **Step 1: Failing tests** (`planSteps.test.tsx`): `lists translation review and annotation in words with an explanation`, `from proposals is unavailable without proposals with the reason`, `mode is unavailable while locked with the reason`, `the project setting is marked`, `the source text has no translation review step`; `planDialog.test.tsx`: `bulk sets the annotation mode and reports locked texts`, `no lone pills` (no element with class `plan-chip` in the dialog); `documentsPage.test.tsx`: `Change plan… from the card saves flags and mode in one request`, `a refused mode shows the reason and keeps the dialog open`.
- [ ] **Step 2:** implement; `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/documents/planSteps.test.tsx tests/documents/planDialog.test.tsx tests/documents/planChips.test.tsx tests/documents/planSummary.test.ts tests/documentsPage.test.tsx` → PASS; typecheck.
- **Commit:** `feat(documents): plan dialogs list the steps in words, with the annotation mode`

### U8: Small fixes F13, F18, V3, V4, V5, V6

- **Goal:** the remaining small fixes of the spec list.
- **Spec:** Small fixes F13, F18, V3, V4 (remaining links), V5, V6.
- **Owns:** `frontend/src/ui/Toast.tsx`, `frontend/src/styles/components.css` (toast `:811-842, 865`, `.shell-page` `:631`, and U2's F8 rules: `.task-loading`, the reading-density rule `:619`, `.badge-assisted` removed; see U2 F8), `src/ontocurator/api/auth_routes.py` (`demo_logins`), `tests/test_demo_logins.py`, `frontend/src/app/LoginScreen.tsx`, `frontend/tests/loginDemoAccounts.test.tsx`, `frontend/src/translation/TranslationReviewScreen.tsx` (`:552-580` labels), `frontend/src/documents/FinalPanel.tsx` (`:311`, `:427` buttons), `frontend/src/tasks/MyTasks.tsx`, `frontend/src/documents/DocumentsTabs.tsx`, `frontend/src/variants/ConsolidationLauncher.tsx`, `frontend/src/variants/TranslationCorrectionAction.tsx`, tests `frontend/tests/toast.test.tsx`, `frontend/tests/translationReviewLabels.test.tsx` (create), `frontend/tests/linkButtons.test.tsx` (create), `frontend/tests/documents/finalPanel.test.tsx` (V5 only).
- **Size / lane / review:** S / frontend (also runs `tests/test_demo_logins.py` against PostgreSQL in one heavy slot, R22) / –.
- **Prerequisites:** U2, U3 and U4 merged (`grep -n "export function onSpaceActivate" frontend/src/ui/spaceActivates.ts`).

Items:
- **F13:** `.ui-toast { flex-wrap: nowrap; max-width: min(50vw, 40rem); }` with the message `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` and the full text in `title`; below 700 px (`:865`) it may wrap. Test: `the undo toast stays on one line` (class/style assertions: computed `flex-wrap: nowrap`, message has `title`).
- **F18:** role words follow D2 (`Annotator`, `Consolidator`, `Lead`; `roleLabels` from U1). Backend `demo_logins` adds `"display_name"` (`app.state.accounts.get_by_username(username).display_name`, `None` when the user does not exist yet); `LoginScreen.tsx:224` button text `{display_name ?? username} ({username}), {label}` → `Tom Reis (demo-annotator), Annotator`. Tests: `tests/test_demo_logins.py::test_demo_logins_carry_display_names`; `loginDemoAccounts.test.tsx` `shows the display name, the username and the role`.
- **V3:** translation review column labels with flags: `Source` + `<LanguageTag language={sourceLanguage} />`, `Translation` + `<LanguageTag language={targetLanguage} />` (the parenthesised codes go). Test `translationReviewLabels.test.tsx`.
- **V4:** every link styled as a button reacts to Space via `onSpaceActivate` (U4): `MyTasks.tsx:145, 153`, `DocumentsTabs.tsx:40` (`DocumentsPage.tsx:123-124` is U4's), `ConsolidationLauncher.tsx:151`, `TranslationCorrectionAction.tsx:67`, viewer links (already in U7's toolbar? check `grep -rn 'className="btn' frontend/src --include=*.tsx | grep "<a "` and cover all). Test `linkButtons.test.tsx`: `Space activates a link-styled Open button` for MyTasks and the Documents tab link.
- **V5:** `How is this counted?` and `Show submissions` use the link style (`Button variant="link"` or class `btn-link`: underline, accent colour) while staying buttons with `aria-expanded`. Test in `finalPanel.test.tsx`.
- **V6:** all page titles start at the standard left padding: check Documents, My tasks, Settings, Export, Text view, Consolidation at 1280 px in the dev server (`npm --prefix frontend run dev` is not needed: use the Playwright run of T2 for measurement); fix offenders by removing local negative margins or extra wrappers so `h1` sits inside `.shell-page` padding (`var(--space-6)`). Unit test: none (layout); T2 asserts `h1` left offsets equal on three pages.
- [ ] Steps: tests first (red), implement, `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 <the six test files>`, `uv run pytest tests/test_demo_logins.py -q`, typecheck.
- **Commit:** `fix(ui): toast on one line, demo login names, language flags, link buttons`

### U9: Separator sweep (F11)

- **Goal:** no `·` anywhere in the UI.
- **Spec:** Small fixes F11.
- **Facts verified:** 390 occurrences in 86 files under `frontend/src` (`grep -rc "·" --include=*.ts --include=*.tsx --include=*.css frontend/src`), top: `finalPanelText.ts` 22, `RowCells.tsx` 13, `nextStepLabels.ts` 10, `GroupCard.tsx`/`groupModel.ts`/`consolidationText.ts` (should be 0 after U6), `CaseScreen.tsx` 9, `editor/rounds/roundLabels.ts` 8, `admin/UploadPreview.tsx` 8, `problems/labels.ts` 7; CSS `content: "·"` in 6 stylesheets.
- **Owns:** every frontend file with a `·` (the grep list), their unit tests; **U9 runs in W12 as the only writer under `frontend/src`** (T2's pre-phase writes only `frontend/browser/`; U9's Vitest run covers only the test files of the modules it touches and uses a heavy slot, R22).
- **Size / lane / review:** S (mechanical, many files) / frontend (one Vitest run in a heavy slot) / –.

Replacement rules (apply by meaning, not blindly):
1. Name and language (`case-109 · de`, `rowName`) → `case-109 de`.
2. A list of facts (`v2 · corrected · accepted`, `Round 1 · Ana Weber`) → comma list: `v2, corrected, accepted`; `Round 1, Ana Weber`.
3. Label then value (`Consolidate case-0107 · en v1`) → `Consolidate case-0107 en v1`; `Tasks · Translation review (de)` → `Tasks: Translation review (de)`.
4. Breadcrumbs (`taskCrumbLabel`) → `failed-translation, Translation review (de)`.
5. CSS `content: "·"` separators → `content: ", "` when the items are inline text, or remove the pseudo-element and use `gap` when they are flex items.
6. Code comments may keep `·` only if they are not UI copy; prefer removing them too.

- [ ] **Step 1:** update the unit tests' expected strings first (`grep -rln "·" frontend/tests`), run them red.
- [ ] **Step 2:** apply the rules; `grep -rn "·" frontend/src --include=*.ts --include=*.tsx --include=*.css` → empty (or comments only, listed in the hand-back).
- [ ] **Step 3:** run once, in a heavy slot, only the Vitest files of the modules it touched (Global rule 6; the list from `grep -rln` over the changed modules' names in `frontend/tests` plus the tests changed in Step 1): `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 <those files>` → PASS; typecheck. No full suite (G1 runs it).
- **Done:** grep empty; browser spec strings with `·` listed for T3.
- **Commit:** `fix(ui): no middle-dot separators`

### T1: Browser scenarios

- **Goal:** isolated, fresh projects for the new browser specs.
- **Owns:** `tests/browser_proposal_check_scenarios.py` (create), `tests/browser_consolidation_scenarios.py` (three-person variant), `tests/browser_server.py` (register the new route only; after L1's legacy clean-up), `tests/test_browser_proposal_check_fixture.py` (create), `tests/test_browser_consolidation_fixture.py` (three-person test), `frontend/browser/proposalCheckHelpers.ts` (create).
- **Prerequisites:** P5, P7 and P8 merged (fixture tests read `proposal_count` and modes; three-person consolidation without keep-both; `tests/test_browser_consolidation_fixture.py` after P7).
- **Size / lane / review:** M / backend / –.
- **Code to read:** `tests/browser_lead_workflow_scenarios.py:40-260` (`lead_project`, `person`, `import_units`, `batch_assign`), `tests/browser_consolidation_scenarios.py` (whole, `FINDINGS`, `build`, route registration), `tests/browser_review_flow_scenarios.py` (submitting through real services), `tests/browser_server.py:1330-1380` (registration order), `tests/t1_fixtures.py:128-200` (`annotation`, `unit`).

`POST /__test_proposal_check__?scenario=NAME` builds `lead-proposal-check-{uuid8}` through the real services (`lead_project(app, "proposal-check", import_plan="review_and_annotate_translations", rule_on=False)`, `person` for `tom` "Tom Reis", `mia` "Mia Berg", `ali` "Ali Kaya" as annotators — extend `PEOPLE` locally, do not edit the lead workflow module), sets `annotations_per_text=2`, `tool_proposal_mode="proposals"`, imports native `en` texts with tool proposals (`native_unit(case, "en", TEXT, case_id=case, annotations=[annotation(...) ×3])`, text and spans like `tests/proposal_check_support.py`) and returns `{project, users: {lead, tom, mia, ali}, display_names, cases: {name: document_id}, assignments: {name: id}, submissions: {name: id}}`:

| Scenario | State |
|---|---|
| `FRESH` | `EN100024` (3 proposals, nobody assigned), `EN100017` (no proposals), `EN100031` (3 proposals, plan override `scratch`) |
| `ONE_ASSIGNED` | `FRESH` + Tom assigned to `EN100024` (from proposals, not started) |
| `CHECKED` | `EN100024` annotated from proposals and submitted by Tom (confirm p1, reject p2, correct p3 to another term present in the browser ontology fixture, e.g. `HP:0002069` if `grep -c HP:0002069 tests/fixtures/*.json` finds it) and Mia (confirm p1, p2, p3) through `WorkspaceService`/`ReviewService`/`SubmissionService` as the review-flow scenarios submit; finalization `ready to compare` |
| `CONSOLIDATING` | `CHECKED` + a consolidation round started by the lead (`ConsolidationStartService.start`), nothing resolved |

`POST /__test_consolidation__?started=true&people=3`: a third annotator `ann-0003` with findings that make the Hypotonia group a three-way term + assertion conflict (Tom Hypotonia present, Mia Hypotonia absent, Ali Axial hypotonia present, all patient/current, overlapping spans), as in `consolidation-group.html`; the default (`people` absent) stays byte-identical to today.

- [ ] **Step 1:** fixture tests first (`tests/test_browser_proposal_check_fixture.py`): `test_fresh_has_proposals_and_modes` (row EN100024 `proposal_count == 3`, mode `proposals`; EN100017 no proposals; EN100031 override `scratch`), `test_checked_has_two_proposal_check_submissions` (`submission_kind` proposal_check ×2; final cell `choose`), `test_consolidating_has_an_open_round`; `tests/test_browser_consolidation_fixture.py::test_three_people_hypotonia_group` (kinds include `term_differs`, `assertion` in `differing_axes`, three members). Run → FAIL; implement → PASS: `uv run pytest -n 4 tests/test_browser_proposal_check_fixture.py tests/test_browser_consolidation_fixture.py -q`.
- [ ] **Step 2:** `frontend/browser/proposalCheckHelpers.ts`: `proposalCheckScenario(page, name)` (POST with `timeout: 120_000`), `loginScenarioUser(page, scenario, name)` (login form as `overviewHelpers.loginOverviewUser`), `textCard(page, caseId, language)` → `page.getByRole("dialog", { name: `${caseId} ${language}` })`, `cardPath(card)` → `card.getByRole("navigation", { name: "Text path" })`.
- **Commit:** `test(browser): proposal check and three-person consolidation scenarios`

### T2: New browser specs

- **Goal:** the spec's "Testing › Browser specs" list, end to end in a real browser.
- **Owns:** `frontend/browser/proposal-check.spec.ts`, `text-card.spec.ts`, `consolidation-three.spec.ts`, `text-view.spec.ts`, `documents-rows.spec.ts` (all create), `frontend/browser/documentsHelpers.ts` (step T2a, first and merged at once: add `textCard` helpers next to the panel helpers; afterwards the file is T3's, which also removes the old ones; further helper needs go through the orchestrator to T3).
- **Size / lane / review:** L / frontend (Playwright, both heavy slots per run) / yes.
- **Prerequisites:** pre-phase (W11–W12): T1 merged (spec writing, T2a); Playwright runs (W13): U9 merged. Port: Global rule 7 (lane port); runs alongside T3, one Playwright run at a time (both heavy slots, Global rule 5).

Specs (each test builds its own scenario; `test.use({ viewport: { width: 1280, height: 900 } })`):
- `proposal-check.spec.ts` — `the lead assigns two annotations from proposals, both work with J/K and 1–4, compare, consolidate and accept`: FRESH; lead opens Documents, the EN100024 row shows the robot icon with `3 tool proposals available; the annotation starts from them`; row click opens the card (Annotation segment current, `Annotation, from proposals`, `3 proposals`); `+ Person` → assign Tom; the robot icon is gone; Tom logs in, My tasks shows `Annotation, from proposals` and `assigned today`; opens the task: badge `Annotate from proposals`, J/K walk the three proposals, `1` confirms, `2` rejects, correcting one via the editor's change flow (as `review-flow.spec.ts` does), Submit; the lead assigns Mia the same way and she annotates from proposals too; lead: Finalization `ready to compare`, `Compare results…`, `Consolidate…` (lead self-consolidation), choose in the table, Submit, `Accept result…`; Finalization reads `accepted {date}`. Second test `an annotator working from scratch never sees proposals`: EN100031 (override `scratch`) assigned to Ali; Ali's editor shows `Annotate from scratch` and no proposals; the text view's Show list has `Tool proposals (3)` greyed with `Hidden while you annotate from scratch`.
- `text-card.spec.ts` — `path segments, details and actions` (ONE_ASSIGNED: the card opens on Annotation; Translation reads `source text`; switching segments; History and Text details open inside the card and Back returns), `remove an assignment after confirming` (✕ on Tom's chip, dialog text exact, Cancel keeps, Remove removes, the robot icon returns in the row), `annotate from proposals myself` (FRESH, the lead clicks `Annotate from proposals myself` and lands in the task; the lead's chip appears in the card; with the consolidator rule on, the hint `You will then not be able to consolidate this text yourself (project rule).` is visible before the click), `row click toggles the selection and the bar needs two texts` (click selects + opens; Esc; click again deselects without opening; name click opens without selecting; one selected → no bar; two → bar), `‹ › step through the table order`, `390 px: the card is a full-width sheet without letter-by-letter wrapping` (each word's bounding box width ≥ one character: assert the case id element's height ≤ 2 lines), axe clean with the card open at 1280 and 390 px.
- `consolidation-three.spec.ts` — three-person scenario: the Hypotonia group shows `!`, `2 fields to decide`, three columns; agreed rows `Patient (all agree)`, `Current (all agree)`; `✓` on Mia's `Absent` → result line says `Absent`; `Take Ali's finding` → result `Axial hypotonia (HP:0008936)` and `Not taken: Hypotonia (Tom Reis, Mia Berg)`; no `Keep both`, no `differs`, no `·` in the page text; in the proposal-check scenario (`CONSOLIDATING`) the columns of findings from tool proposals show the robot icon `From a tool proposal`; the path shows `Finalization` current; `agreed` groups in the same list; submit; axe clean.
- `text-view.spec.ts` — CHECKED, lead: from the card `View proposals` opens the text view with `Show: Tool proposals (3)`, findings listed with axis colours (the `Present` chip has the present token colour, compare computed `color` with the CSS variable value); Show lists Tom and Mia (`submitted {date}`) and `Final result (not yet accepted)` greyed; choosing Tom draws his marks; `Compare` opens a second column with its own selects; logged in as Tom, the Show list has no entry for Mia (D3); the version dropdown reads `en, version 1 (source text)` (adapt to the origin words of the native text); nothing editable.
- `documents-rows.spec.ts` — `one line per text, about 16 rows at 1280×900` (a scenario with ≥ 16 texts: reuse an overview scenario with many cases, e.g. `/__test_lead_workflow__?scenario=D15`; count rows whose bounding box is fully in the viewport ≥ 15; each row height ≤ 44 px), `no D2-removed words on the page` (no `Annotation review`, `Keep both`, `Adjudicator`, `blind`, bare `Review` button), `the page itself does not scroll` (`document.documentElement.scrollHeight <= innerHeight + 1`), `768 px without horizontal scroll` (`scrollWidth <= clientWidth` of the table wrapper), `filter With tool proposals`, `page titles share the left padding` (V6: `h1` x offset equal on Documents, My tasks, Settings).

- [ ] Run each spec alone: `HPO_E2E_PORT=<lane port> PLAYWRIGHT_WORKERS=1 npm --prefix frontend run test:e2e -- browser/proposal-check.spec.ts` (then the others, one per command). Fix product bugs found here in the owning WP's files only with the orchestrator's go (one fix agent).
- **Commit:** `test(browser): proposal check, text card, consolidation table, text view, rows`

### T3: Existing browser specs on the new UI, spans-resize flake

- **Goal:** the existing suite passes on the new UI; the two flaky drag tests are stable.
- **Owns:** every file under `frontend/browser/` that fails or references removed UI (expected: `documentsHelpers.ts`, `documentsOverviewHelpers.ts`, `documents-table.spec.ts`, `documents-decisions.spec.ts`, `documents-a11y.spec.ts`, `documents-overview.spec.ts`, `documents-overview-a11y.spec.ts`, `documents-walkthrough.spec.ts`, `admin.spec.ts`, `lead-workflow.spec.ts`, `lead-workflow-a11y.spec.ts`, `consolidation.spec.ts`, `consolidation-a11y.spec.ts`, `final-workflow.spec.ts`, `problem-reports-lead.spec.ts`, `translation-review.spec.ts`, `variant-admin.spec.ts`, `guidelines.spec.ts`, `editor-layout.spec.ts`, `review-flow.spec.ts`, `spans-resize.spec.ts`, `variants.spec.ts`, `compare.spec.ts`, and the specs L1 listed for its removed scenarios: `layers.spec.ts`, `reanchor.spec.ts`, `variant-admin.spec.ts`). Specs that only tested the removed annotation review task or the `assisted` mode are deleted (list them in the hand-back).
- **Size / lane / review:** L / frontend (Playwright, both heavy slots per run) / –.
- **Prerequisites:** U9 and T2a merged; runs alongside T2 in its own lane, one Playwright run at a time (both heavy slots per run).

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
| `Annotation review`, `Assign annotation review…`, review rows in assign dialogs | removed (D1); review tests of the editor use "Annotate from proposals" |
| `Review` (translation), `Adjudicator`, `Independent annotation`, `Check tool proposals` | D2 names (Copy table) |
| `·` in expected strings | U9 rules |
| bar after one selection | bar only after two |
| `Keep both` (consolidation keyboard test) | removed; the keyboard test chooses with ✓ buttons and Enter |
| viewer `Versions` fold-out, three selectors | text view toolbar `Language and version`, `Show` |

**spans-resize flake** (`spans-resize.spec.ts:61` "pending mark: drag the end handle, choose a term, saved segments equal the adjusted span" and `:84` "the end handle drags onto the next line under the mark bar"): root cause is the target point computed before the press (`pointAtOffset` `:8-24`) while the press re-renders the pending mark (layout shift), and the handle's empty inline box. Fix: in `dragHandle` (`:26-33`) press, then `await page.waitForFunction(() => document.querySelector(".pending-mark")?.getAttribute("data-dragging") === "true")` (or the existing dragging class — check the component), **recompute** the target with `pointAtOffset` after the press, move with `{ steps: 12 }`, and assert the live highlight reached the target before `mouse.up`; use `locator.evaluate(el => el.getBoundingClientRect())` instead of `boundingBox()` for the empty inline handle. Run each test 20 times: `HPO_E2E_PORT=<lane port> PLAYWRIGHT_WORKERS=1 npm --prefix frontend run test:e2e -- browser/spans-resize.spec.ts --repeat-each=20 -g "pending mark"` → 0 failures.

- [ ] Run the specs in batches of at most four files per command (one Playwright run at a time), fix, rerun the batch: `HPO_E2E_PORT=<lane port> PLAYWRIGHT_WORKERS=1 npm --prefix frontend run test:e2e -- browser/documents-table.spec.ts browser/documents-decisions.spec.ts browser/documents-a11y.spec.ts browser/documents-overview.spec.ts`, then the next four, until every listed file passed once.
- **Commit:** `test(browser): existing specs on the text card and one-line rows; stable resize drags`

### G1: Final gate (alone on the machine)

Runs in the integration worktree after every WP is merged; no other agent runs heavy work meanwhile (the read-only whole-diff review below may run alongside). Run in batches so a failure is cheap to repeat:

```bash
cd /c/Users/jan-p/Development/ontocurator/.worktrees/acceptance-20261023
bash scripts/check.sh --only static
CHECK_VITEST_WORKERS=4 bash scripts/check.sh --only frontend
CHECK_PYTEST_WORKERS=4 bash scripts/check.sh --only backend
HPO_E2E_PORT=18771 CHECK_PLAYWRIGHT_WORKERS=2 bash scripts/check.sh --only browser
```

Each must end with its phase's success line. On a failure: one fix agent (effort medium), rerun only that phase; finally `HPO_E2E_PORT=18771 bash scripts/check.sh` once (expected last line `All local checks passed.`). If the browser phase is too heavy at two workers, run `PLAYWRIGHT_WORKERS=1` with the spec list in four batches (`ls frontend/browser/*.spec.ts`, split alphabetically).

- [ ] `git status --short` shows only committed WP files.
- [ ] Migration numbers 0020 and 0021 still free on `main` (`git fetch && git ls-tree --name-only origin/main src/ontocurator/storage/migrations/versions/ | tail -2`); if not, stop and report.
- [ ] Plan review: one `superpowers:code-reviewer` over `git diff main...feat/acceptance-20261023` with this checklist: annotators working from scratch never see proposals and non-leads never see other people's work, not even greyed (workspace, text view, layers; D3); the mode is fixed once (submitted work of revoked assignments included) and "from proposals" never mixes with "from scratch" on one text; targets, counts and precision use the newest proposal set; remove discards the draft; every assign path enforces annotations per text, reassign does not double count; a proposal check counts as one annotation and is consolidated unchanged; `keep_both`/`term_choices`/`term_parts`, the `assisted` mode and the assignable annotation review task gone from code and API; migration 0020 leaves no dangling reference and logs its counts; the batch planner and `_assign_locked` share one count; the lead's self-grant exists once; exports of projects without proposal checks unchanged; copy verbatim with D2 words only; no `·`; `aria-disabled` instead of `disabled`; colours only via tokens.

### R1: Embedded bundle rebuild (separate commit)

Facts: commits `5478ddd` and `d39273f` only replace `src/ontocurator/web/assets/*` and `src/ontocurator/web/index.html`; there is no sync script (deleted in `8638e08`); the Dockerfile does `rm -rf src/ontocurator/web` + copy of `frontend/dist`; `check_wheel.py` requires `licenses/*.txt` from `frontend/public/licenses`.

```bash
cd /c/Users/jan-p/Development/ontocurator/.worktrees/acceptance-20261023
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
- [ ] **Back up the test server's database before installing the branch** (migration 0020 deletes data irreversibly on app start; its `downgrade()` restores nothing). With the app stopped: `pg_dump --format=custom --file "<acceptance build folder>/ontocurator-before-0020.dump" "<database URL from config.ps1, driver suffix such as +psycopg removed>"`; check it with `pg_restore --list <file> | head` (non-empty). Restore if needed, app stopped: `pg_restore --clean --if-exists --dbname "<URL>" <file>`.
- [ ] Install the branch build into the native server as the previous acceptance runs did (`docs/operations/t5-interim-acceptance.md`; the earlier session notes in `.worktrees/manual-20261021/build/t5-acceptance/`), start it, wait for `App ready.`. Migrations 0020 and 0021 run on start: 0020 deletes the test server's legacy annotation-review assignments, `assisted` work and keep-both consolidations (D1; test data). Copy the row counts it logs (`0020 legacy purge: …` in `logs\app-$Port.err.log`) into the findings file.
- [ ] Project **e3c-proposals** (D4): its existing annotation assignments are test data. Remove them with their work so the texts are no longer locked: `uv run python scripts/purge_annotation_work.py --project e3c-proposals --confirm` (L1; run against the test server's database URL from `config.ps1`, with the app stopped). Check in Documents that no text of the project has annotation work left.
- [ ] Project **e3c-proposals**: Settings → Workflow → `Texts with tool proposals` = `Annotate from proposals` (existing projects were migrated to `Annotate from scratch`). Save. Every text with proposals now reads `Annotation, from proposals` in its card.
- [ ] Note: the earlier seed of **cons-three** (third annotation above the limit 2) is now refused if reseeded; existing data stays.

Protocol (record findings as `FINDINGS-<date>.md` in the acceptance build folder; evidence screenshots there, not in the repo):
1. Documents (lead, `demo-lead`): one-line rows, robot icon on texts with proposals, filter `With tool proposals`, page does not scroll beyond the table, 768 px window.
2. Row click: card opens on the right segment; second click deselects; name click; bar only with two texts; ‹ ›; Esc; narrow window sheet.
3. Card: Translation (version, origin, automatic check, reviewer chips with dates, Compare with source, versions, Request correction…), Annotation (`Annotation, from proposals`, proposals, View proposals, + Person, ✕ remove with the exact dialog and an empty draft after re-assigning, `Annotate from proposals myself` with the consolidator-rule hint), Finalization (waiting / ready to compare / consolidating n of m / ready to accept / accepted date).
4. Change plan… on one text (annotation mode, lock reason after assigning; a refused mode saves nothing) and bulk Plan… (locked texts reported).
5. Annotate from proposals as `demo-annotator` (`Tom Reis (demo-annotator), Annotator` on the login screen): J/K, 1–4/0, correct a span and a term, add a missed finding, submit; second annotation from proposals as `demo-annotator2`.
6. Compare results…, Consolidate… (comparison table, ✓, Take …'s finding, result line, Not taken, robot icon on findings from tool proposals), Accept result….
7. Text view: Show list (greyed entries with reasons for the lead; an annotator sees no other people's work), Compare column, final result layer.
8. Final export: `receipt.json` `proposal_checks` (with `proposal_set`) and `index.csv` `submission_kind = proposal_check`.
9. D2 words: nowhere "Annotation review", "Independent annotation", bare "Review", "Keep both", "blind", "check tool proposals", "Adjudicator".
10. Small fixes: no `·`, toast one line, "Connection lost. Try again." (stop the server briefly), link buttons with Space, page title padding, language flags in editor header and translation review columns.

---

## Spec ambiguities resolved by this plan (open to veto; WP to change in brackets)

1. **Existing projects keep annotation from scratch.** The setting defaults to `proposals` for new projects; migration 0020 backfills existing projects with `scratch` so nothing changes under running work; e3c-proposals is cleaned and switched by hand in M1 (D4). [P1, M1]
2. **Mode lock = oldest annotation work, stored per assignment.** The mode is written on each annotate assignment at creation; the text is locked while annotation work exists on any version: non-revoked annotate assignments, revoked ones with submitted work, and annotation submissions. Removing all unsubmitted assignments unlocks it; submitted work never does. Changing the project setting is never refused; it simply does not affect locked texts. [P1, P3, P4]
3. **Annotation from proposals is its own workspace mode on the annotate task** (`proposal_check`, annotator role), not the consolidator's task, so it counts as an annotation and is consolidated without changing the comparison rules. [P2, P3]
4. **"Uncertain" stays a fourth decision.** The review screen offers it (key 4); the export records it as `uncertain` beside `confirmed`, `rejected`, `corrected`; it is left out of precision. [P6]
5. **"Annotate from proposals myself"** is the ordinary assign route with the lead's own username (the role grant shared with self-consolidation); it implies the language confirmation for the lead's own work, counts towards the limit and is offered only on texts annotated from proposals (U3); with "the consolidator is not an annotator" on, the button says beforehand that the lead cannot consolidate this text afterwards, and the later self-consolidation is refused by the existing rule. [P3, U3]
6. **No moving or carrying of work from proposals to a new text version** (its decisions refer to the proposals of its own version); move and carry are refused with their own reason `from_proposals`; the new version is assigned anew and needs its own proposals while the text is locked "from proposals" (`NO_PROPOSALS_ON_VERSION`). [P2, P3, P4]
7. **Text view and other people's work (D3, spec §4):** non-leads never get entries for other people's work, not even greyed; greyed entries with reasons are shown only for layers the viewer is entitled to know about (tool proposals while annotating from scratch; for the lead: people who have not submitted and the not yet accepted final result). [P8, U7]
8. **Remove (✕)** is offered on Annotation-part chips; the endpoint refuses submitted work for any task; "Their draft is discarded" is literal: the draft rows of that workspace are deleted and an active round is abandoned, so a re-assignment of the same person starts empty (edit events and audit stay). [P3, U3]
9. **Optional translation review** gets a fourth path tone `optional` (grey, like later) and is never the segment opened by default. [U0, U3]
10. **Consolidation order:** groups by text position with agreed groups in the same list (earlier: agreed first in their own section); J/K still walk the open ones. [U6]
11. **Plan dialog** offers `Off (not annotated)` beside `Annotate from proposals` / `Annotate from scratch`, because the Annotate flag still exists. [U5]
12. **Bulk mode change** skips locked and proposal-free texts and reports them instead of failing the whole selection. [P4, U5]
13. **Assignment dates** in the assign dialog come from the row's work items (`assigned_at`, `assigned_by`); no new endpoint. [P5, U2]
14. **Consolidation progress** ("2 of 3 groups open") is computed for shown rows only. [P5]
15. **Robot icon** = mockup variant C (Lucide `bot`, scaled to the 16 px grid); **axis colours** = aliases of existing tokens (no new colour values, so the DESIGN.md colour-approval rule is not triggered); the experiencer/temporality palettes are the plan's choice (U0 table). [U0]
16. **Annotations-per-text enforcement** lives in `AssignmentService._assign_locked` (single assign, row-list POST, distribution confirmation); reassign and consolidation start are unaffected; it counts per version, while the mode lock spans the text; the test-server seed of cons-three would now be refused (test data only). [P3]
17. **Legacy data (D1)** is deleted, not converted, except `assisted` preferences (→ `independent`): annotation-review assignments, `assisted` work and keep-both consolidations go with all their work and with consolidations or final selections built on them (closure); the text then reads "ready to compare" again. Deletion was chosen over rewriting stored decisions because decisions and submissions feed hashes and history, and the user declared the data test data. [L1]
18. **Next step column** gets a visible header `Next step` (the old hidden "Action" header). [U4]
19. **Proposal targets = newest proposal set** of the document at round creation; older sets are never targets; precision is reported per set. [P2, P6]
20. **Internal ids stay** (`proposal_check`, `independent`, `review`, `adjudicator`, error codes); only UI words follow D2. [all]

### Resolution of the plan review findings (R1–R25)

| # | Finding | Resolution |
|---|---|---|
| R1 | Mode lock must count submitted work of revoked assignments | Pure rule input `work_modes` (P1); `application/annotation_modes.work_modes` reads non-revoked OR `last_submission_id` assignments plus `SubmissionRow.mode` (P3); test `test_revoked_submitted_work_keeps_the_lock`; P5 uses the same semantics. |
| R2 | `FinalPanel.tsx:267` is `panelMode` | Removed from U2's Owns, edit text and Done grep, and from the `FinalPanel.tsx` chain. |
| R3 | P1's constraint breaks direct annotate inserts in tests | P1 keeps NOT NULL for annotate rows and owns/fixes the ten listed inserts; reason in P1 Step 4 (no second spelling of "from scratch"; no server default can be task-specific). |
| R4 | U3 ‖ U7 conflict on route params and `index.css` | `show`/`compare_show`/`panel_tab=history` moved to U0; `router.ts` U0 only; `index.css` U3 only; U7 imports `variants/textView.css` from its component. |
| R5 | U3 deletes files still imported | U3 moves `StageActions` to `documents/StageActions.tsx`, `STAGE_TITLES` to `stageLabels.ts`, keeps `StagePopover`; owns `RowActivity.tsx`, `StagePopover.tsx`, `stageLabels.ts`; Done grep over importers. |
| R6 | P2 changes the API contract | P2 is contracts writer 2 and regenerates; token order L1 → U0 → P2 → P3 → P4 contract step → P5 contract step → P7 → P8 → U2 (Global rule 10). |
| R7 | What drives a proposal-check round's targets | Mostly moot by D1 (ordinary review gone); stated precisely in "Proposal targets" and P2 "Facts verified": newest proposal set of the assignment's document, editable layers, fixed at round creation. |
| R8 | `assisted` might open for an annotate assignment | Moot by D1 (`assisted` removed in L1); guard kept: `require_workable` lets an annotate assignment open only its own mode; parametrised test in P3. |
| R9 | Mode filters and own label | P2 adds `proposal_check` to `work_rounds.py:150` and `text_changes.py:414` (L1 already dropped `assisted`) and gives `authz/versions.py:152` labels per kind; handover test in P2. |
| R10 | New text versions under "from proposals" | Rule in spec §1 and P3/P4: move/carry refused with reason `from_proposals`; assigning a version without proposals while locked "from proposals" → `NO_PROPOSALS_ON_VERSION`; tests for open and submitted work. |
| R11 | One helper for "the text's target document" | `application/text_targets.py` (P3), moved from the existing derivation; used by P3, P4, P5, P8; equality tests in P3 and P5. |
| R12 | Remove must discard the draft | `remove` deletes the workspace's drafts and abandons an active round; test `test_remove_discards_the_draft`. |
| R13 | e3c-proposals existing work | Handled by D4: M1 purges its annotation work with L1's `scripts/purge_annotation_work.py`, then switches the setting. |
| R14 | Reading stored keep-both marks | Moot by D1: migration 0020 deletes keep-both consolidations; P7 has no read path. |
| R15 | Greyed entries for other people's work | Handled by D3 (spec §4 changed); P8, U7, T2 test that non-leads get no such entries. |
| R16 | "Myself" consequence under the consolidator rule | U3 shows the hint from `page.adjudicator_not_annotator`; Copy table; U3 and T2 tests. |
| R17 | P2 profile lookup | `ctx["repo"].get_task_profile("pkg-rev-1")` in `test_scope_differs_from_review`. |
| R18 | P7 Done grep and `TermPart` export | Done grep excludes `tests/test_translation_registry.py:174`; `TermPart` leaves `domain/agreement.py __all__`. |
| R19 | `proposal_check` in `MODE_ORDER`/`PreferenceMode` | Left out (P2 test asserts it); L1 sets `MODE_ORDER = ("independent",)`. |
| R20 | Multiple proposal sets | Newest set only (targets, counts, precision); documented in `docs/scientific-workflow.md` by P6; `proposal_set` in the receipt. |
| R21 | CaseScreen site list | U2 uses the grep as source of truth (18 matches listed). |
| R22 | Wave notes for U8/U9 | U8 takes one heavy slot for its DB test; U9 runs in W12 as the only `frontend/src` writer and runs only the Vitest files of the modules it touches (one heavy slot). |
| R23 | Mode save fails after the flags PATCH | Moot: P4 carries the mode in the existing row PATCH, so flags and mode are saved in one transaction or not at all (`test_a_refused_mode_saves_no_flags`); U5 shows the refusal inline. |
| R24 | Base and worktree | Global rules: base `main` 6d8bc1b or later; worktree `.worktrees/acceptance-20261023`, branch `feat/acceptance-20261023`, fast-forwarded to the `main` commit with this plan before the first WP. |
| R25 | Limit per version vs lock per text | Stated and justified in P3 and spec §1. |

## Self-review against the spec

| Spec item | WP |
|---|---|
| D1 legacy removal (annotation review task and UI, `assisted`, keep-both data; migration deletes/converts; tests) | L1 (backend, data, compile fix), U1 (UI), P7 (keep-both code), T3 (browser specs) |
| D2 terminology (phases, actions, modes, roles, removed words, robot icon in consolidation) | Copy table; U1, U2 (badges, rule, errors), U3, U5, U6, P7 (`from_tool_proposal`), T2 (no removed words) |
| D3 text view without other people's work for non-leads | P8, U7, T2 |
| D4 e3c-proposals test data removed in M1 | L1 (`purge_annotation_work.py`), M1 |
| Goal 1, §1 Q1 (annotate from proposals in the review screen, J/K, 1–4/0, every proposal decided) | P2, U2, T2 |
| §1 Targets (newest proposal set, fixed at round creation) | P2, P5, P6, P8 |
| §1 Q2 (replaces annotation from scratch, counts as one annotation, 2 per text = two independent annotations from proposals, Finalization unchanged, 1 = single annotator) | P2 (submission = annotation layer), P3 (annotate task, limit), T2 |
| §1 Q3 project setting (default from proposals for new projects), texts without proposals from scratch, per-text override in "Change plan…", one task "Annotation", mode shown in assign dialog and card, no mixing | P1, P3, P4, U2, U3, U5 |
| Mode fixed once annotation work exists (incl. submitted work of revoked assignments), clear refusal | P1 rule, P3 storage and `work_modes`, P4 refusal, U5 reason |
| Limit per version, lock per text | P3 |
| New text versions under "from proposals" | P3 (`NO_PROPOSALS_ON_VERSION`), P4 (move/carry reasons) |
| Annotators from scratch never see proposals; from proposals see only proposals | P2 (targets from proposals only), P3 (`require_workable`, `may_read_proposals`), P8, T2 |
| "Translation review" everywhere (F1) | U1 |
| Export: per proposal decision with source ref and set, added findings; minimal additive fields; documented | P6 |
| e3c-proposals switched to "Annotate from proposals" | M1 |
| §2 centered popup, Esc/✕/outside closes, ‹ ›, row click opens and selects | U3, U4 |
| Header case ID, language with flag, version only when > 1 versions as a warning | U3 |
| Path Translation → Annotation → Finalization with short states, colours, default segment | U0 (`StagePath`), U3 (`cardModel`) |
| Translation details (version/origin, automatic check, reviewer chips with dates, Assign reviewer…, Compare with source, version list, Request correction…) | U3 |
| Annotation details (mode, proposals + View proposals, chips with state and date, + Person, ✕ with confirmation and real draft discard, submitted not removable) | P3, P5, U3 |
| "Annotate from proposals myself" (role granted, counts as an annotation, consequence hint, F24) | P3, U3, T2 |
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
| One group = one finding; keep both / split removed (server, UI, stored data) | P7, U6, L1 |
| Group card header (! icon, name, n fields to decide), comparison table, disagree rows with ✓, agreed one grey line, Text only on genuine conflict, notes never block, Whole finding row, result line with Not taken, robot icon on findings from tool proposals | U6, P7 |
| Fixed axis colours as tokens, used in editor, consolidation, text view, compare; colour never alone | U0 (tokens, `AxisValue`), U6 (consolidation), U7 (text view, compare, editor finding list) |
| Auto-kept groups same style, marked agreed (F9); large pills removed | U6 |
| "Accept result…" everywhere (F16) | U1 |
| Server rules consistent: one term per group, choice for every disagreeing field, keep_both/term_choices removed with tests | P7 |
| §4 text view toolbar, language+version dropdown, Show dropdown with greyed entries and reason, findings with axis colours, Compare column, read only; target of the card links | P8, U7, U3 (links), U0 (route params), T2 |
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
| Testing: backend list | P1–P8, L1 tests |
| Testing: frontend unit (card states, removal confirmation, bar for 2+) | U3, U4 |
| Testing: browser (annotation from proposals e2e on imported T1 bundle, text card flows, consolidation with 3 people, text view Show/Compare) | T1, T2 |
| Manual acceptance on the native server with e3c-proposals | M1 |
| Out of scope (modifiers, family member, user management) | not touched |

Gaps found and fixed during the reviews: (1) the fixed axis colours must appear "everywhere axis values appear (editor, consolidation, text view, compare)": U7 also owns `editor/FindingRow.tsx` and `variants/ComparePane.tsx` with tests; the editor's radio options (`AnnotationPanel.tsx:337-350`) stay neutral (controls, not values). (2) P1 and P2 both need `assignments/service.py` and P1's check constraint affects every test that creates annotate assignments, so P2 runs after P1. (3) P7 removes API fields the consolidation UI uses; P7 therefore also does the minimal frontend compile fix; L1 does the same for its removals. (4) The annotations-per-text bypass is fixed in P3 together with the mode wiring, because both edit `_assign_locked`. (5) L1 runs first, so P1–P3 build on the reduced task and mode set and write each site once (no `assisted`, no "until L1" branches); the review-machinery tests L1 keeps stay valid because the machinery is shared with consolidation. (7) The batch planner and `_assign_locked` share one count of held annotations (`held_annotations`), so a batch save is never rolled back by a refusal its planner did not foresee; the lead's self-grant exists once (`grant_lead_self_role`) for self-assignment and self-consolidation. (6) The legacy purge needs the same closure in the migration and in M1's clean-up of e3c-proposals, so it lives once in `storage/work_purge.py`.

Placeholder scan: no "TBD"/"TODO"/"similar to"; WP blocks that adapt to a verified-but-unread signature say which `grep` to run and keep the assertion's meaning fixed; test bodies given only as descriptions name their inputs and expected codes.

Type consistency: `AnnotationMode = "proposals" | "scratch"`, `TextMode`, `text_mode(..., work_modes=...)`, `workspace_mode` (P1) are used with the same names in P3, P4, P5; `newest_proposal_refs`/`newest_proposal_counts`/`newest_proposal_set`/`ProposalSetRef` (P2) in P3, P5, P6, P8; `TextRow`/`text_row`/`text_documents`/`text_target_document` (P3) in P4, P5, P8; `held_annotations`, `grant_lead_self_role` (P3); `AnnotationModeView` (P5); `consolidation_progress` and `from_tool_proposal` (P7) in P5 and U6; `TextLayerEntry` (P8) in U7; `StagePath`/`PathSegment`/`PathTone` (U0) in U3 and U6; `assignedText`/`AssignedDate` (U0) in U2, U3; `isReviewLike` (U1, `editor/modes.ts`) frontend, `is_review_like` (P2) backend; `rowClick` (U4); `PlanSteps` (U5); `StageActions` (U3, moved).

Parallel file overlap: see "Parallel ownership check" (L1 first; lanes, pre-phases, contract-first steps of P4 and P5; every set of WPs that are unmerged at the same time has disjoint Owns).
