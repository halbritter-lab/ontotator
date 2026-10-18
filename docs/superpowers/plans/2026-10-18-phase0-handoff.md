# Phase 0 handoff for a fresh context

> Update, 2026-10-18: the user explicitly approved all six presented items: P0-S/A/R/U as recommended, the specific ontospan branch push without merge, and local embedded-frontend replacement. The reviewed ontospan commit is now published and its remote ref verified. Earlier pending/blocking statements in this historical handoff are superseded; see the master roadmap's binding approval and current execution ledger. Continue the dependent implementation without asking again. No Ontocurator push or merge is authorized.

## Objective and authorization

Finish the approved usability-first Phase 0 roadmap, implementing decided functions, independently reviewing them, verifying locally, and preparing a separate acceptance candidate when prerequisites permit. The user explicitly authorized autonomous planning followed by implementation, efficient GPT-6.1-sol medium implementers and Astra content review. The user now wants to continue in a fresh context. The previous thread's stored goal is blocked, not complete; this document carries the remaining objective and evidence.

Speak briefly in German; files and commits in English. No AI co-author trailers or generated-by lines. No GitHub Actions. No merge or push without explicit approval. Do not interpret a general acknowledgement or request to resume as answers to domain questions or publication approval.

## Authoritative workspace

- Primary checkout: `C:/Users/jan-p/Development/ontocurator`, branch `docs/phase0-execution-plans` at `5b8b4b0`; `main` remains `4de9aaa`. Preserve the user's untracked `.impeccable/critique/`.
- Implementation worktree: `C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation`, branch `feat/phase0-usability`.
- Last implementation/test commit: `ad23b2870c185b4b232f5385d9811c15ed2def69`. Tracking documentation: `8a07493`. The commit containing this handoff changes documentation only; inspect `git status` and `git log` before proceeding.
- Ontospan prerequisite worktree: `C:/Users/jan-p/Development/ontospan/.worktrees/format-1-2`, branch `feat/review-resolution-format`, reviewed local commit `738f3d43ca0896c9d146a15fb9538b938229368a`.
- Ignored execution ledger and reports: `.superpowers/sdd/2026-10-17-phase0-priorities/` in the implementation worktree. Keep reports/logs/screenshots ignored; never force-add them.
- No implementation or verification process remains running at handoff. Do not restart completed work from an old ledger entry.

Read `PRODUCT.md`, `DESIGN.md`, `docs/superpowers/plans/2026-10-17-phase0-priorities.md` and `docs/superpowers/reviews/2026-10-17-phase0-verification.md`. The original `2026-10-17-next-agentic-work.md` is product background; the dated D3 amendment in `2026-10-17-phase0-decision-semantics.md` supersedes its original unconditional-note wording.

## Implemented and reviewed

- B0.1: explicit opt-in positional scroll coupling, reading-only; paragraph count is not represented as semantic alignment.
- B0.2: one explicit document confirmation, stable decision keys, visible defaulted-axis warnings and navigation; separate Unresolved review decision with mandatory reviewer note. Current export copy truthfully says unresolved proposals are excluded until the flagged exporter lands.
- D3: annotation notes, project settings, preservation of source notes in exports, and backend enforcement for genuinely new drafts. Existing open drafts retain prior enforcement provisionally pending P0-S.
- User correction on 2026-10-18: three project modes are implemented: prohibited, allowed with required reason, allowed with optional reason. Required reason remains the default. Backend `240800c`, UI `1de4616`, migration 0009. Optional mode works for creation, clearing notes, last-mention removal, historical replacement and submission; profile evidence requirements still apply. D2 reviewer-note requirements are separate and unchanged.
- B0.3: frozen per-reviewer pending re-anchor inputs, explicit re-create/dismiss actions, exact-version resolution links and immutable audit. Completion blocking awaits P0-R.
- B0.4/D16: restricted general version browsing in independent mode, assigned translation-review access preserved, exact own history retained pending P0-A; smaller editor/admin usability cleanups.
- Plans B0.1–B0.5 and compact D6–D15 questions exist. Stale `.worktrees/main-integration` operations path was corrected to the real demo configuration location.

## Verification already completed

Full `scripts/check.sh` on `ad23b28` exited zero on 2026-10-18:

- 1,298 frontend tests across 121 files.
- 2,156 backend tests; one POSIX permissions skip on Windows.
- All 87 Playwright cases.
- Ruff, formatting, mypy, frontend typecheck, OpenAPI/TypeScript drift, wheel lock/content checks.
- Total 1,556 seconds. Evidence: ignored `phase0-check-9.log`.

The preceding run's sole failure was a historical migration fixture opening the current application while still at schema 0008. Test-only `ad23b28` retains its original 0007-to-0008 preservation assertions and upgrades to head before opening the current app. Focused reproduction and fix were verified, then the full gate passed. Do not reopen this resolved failure.

The three-mode correction had 136 focused backend tests, 78 frontend tests, nine browser cases and independent Astra approval without actionable findings. One actual Settings screenshot was inspected and a bounded scan of the two changed TSX files found no issues. Do not repeat context gathering, visual scans, screenshots or full suites for this handoff/documentation alone.

Fresh frontend build: `index-C5v_3iqZ.js` and `index-ytX3jISo.css`; assets remain in `frontend/dist`. `spanless-modes-web-manifest-comparison.json` records the differences from the embedded UI. The passing wheel check packaged the OLD embedded frontend. No updated release image or acceptance candidate has been built.

## Open decisions: ask clearly, do not infer

The user asked what was blocked and received explanations, then clarified D3 and accepted the three-mode design. They have not answered these remaining questions:

| ID | Decision needed | Recommendation to present |
| --- | --- | --- |
| P0-S | Should the selected project rule also apply to existing open drafts? | Enforce at their next submission, according to the selected mode; preserve completed submissions. Optional mode must not acquire a mandatory note. |
| P0-A | May independent annotators read their own previous submissions? | Yes, through exact own-history access; general browsing remains restricted. |
| P0-R | Must every frozen re-anchor item be re-created or dismissed before submission? | Yes, with a reason for dismissal and a count/jump to unfinished items. |
| P0-U | How should unresolved proposals with unknown/obsolete terms or incomplete required clinical content be submitted/exported? | Require correction or rejection for new submissions; preserve historical data and make export failures explicit. This differs from a valid finding whose review is simply unresolved. |

The master roadmap is the answer register. D6–D15 are later product questions; recommendations remain undecided. These do not block already decided Phase 0 work.

## Ontospan prerequisite and publication boundary

Local commit `738f3d4` was created on 2026-10-17 at 17:26 MESZ. It adds optional `Annotation.review_resolution` in format/package 1.2.0: outcome `uncertain`, reviewer Actor, optional note for faithful historical data. Clinical axes and original provenance remain separate. Frozen 1.0/1.1 schemas and historical round trips are preserved. Phenopacket conversion explicitly refuses this metadata rather than silently losing it. Full upstream suite: 251 passed, one Windows symlink skip; static/schema/lock/wheel checks passed and independent review approved.

The user has not approved pushing that branch. Ontocurator still pins remotely available `4105ec1259fc04d927d78258fcf4c99f8f014b6a` (format 1.1). Do not pin an unavailable remote commit or substitute a local checkout/moving branch. Once the specific publication is approved, push only the reviewed ontospan branch without merging; then implement B0.2 Task 4 with the immutable pin and updated lock. P0-U gates only its dependent invalid-target validation/materialization semantics.

Task 4 still requires actual flagged export, included-flag counts, source preservation, legacy missing-note warnings, explicit refusal of flagged re-import until storage can preserve the metadata, and real downloaded-bundle/browser evidence. Do not promise this behavior before implementation.

## Embedded UI and reserved demo

- `http://127.0.0.1:18080` and project `ontocurator-t5-acceptance-ready` are reserved for the user. No saves, submissions, seeding, migrations, restart, rebuild or replacement there.
- Its configuration is `build/t5-acceptance/demo-ready` in the primary checkout; do not open secrets or change identity files.
- Automatic approval review previously rejected both checked-directory replacement of embedded assets and a bounded operation deleting only obsolete `assets/index-DSMB-AZ1.js` / `assets/index-vf_X9imy.css`, giving only `blocked by policy`. Neither executed. Explicit user approval is still pending. Do not retry through another interpreter or workaround.
- After approval, update only the implementation worktree's embedded UI from the verified fresh build and verify the exact file/hash match. Never present old packaged assets as the new UI.
- B0.5 defines the separate candidate: preferred app port 18081, PostgreSQL port 15544, project `ontocurator-t5-acceptance-phase0`, ignored output `build/t5-acceptance/phase0-candidate`. Check actual availability and identity first. Build a reproducible image only after prerequisites and final verification; record source SHA/image digest, run disposable container smoke, seed the separate fresh stack once, leave its acceptance tasks to the user.

## Execution order on resume

1. Revalidate the clean worktree and read this handoff plus the master plan. Do not rerun the passing gate merely to resume.
2. Resolve the remaining questions and the two specific approvals with the user; explain their concrete effect. Continue any independently ready slice without waiting on unrelated decisions.
3. Implement approved policy changes and B0.2 Task 4 in coherent bounded batches. Use at most two GPT-6.1-sol medium implementers, explicit file ownership, and a stable diff for independent Astra review. Preserve original agents' reports rather than restarting investigations.
4. Run focused tests, fix actual issues, then one integrated local gate on the final candidate. Keep Vitest at `--maxWorkers=4 --minWorkers=1`; Docker must be running. Use Git Bash `C:/Users/jan-p/scoop/apps/git/current/bin/bash.exe`, not WSL bash.
5. Prepare the isolated candidate only when dependency/assets/policy prerequisites permit. Ask before any merge or further push. Do not mark the overall goal complete while required slices or candidate remain missing.

The user noted low test resource utilization. The backend and Playwright runners are serial; default PostgreSQL containers are process-local. Shared `ONTOCURATOR_TEST_PG_URL` uses a fixed template/role initialization and is unsafe for naive concurrent workers. No parallelism dependency/harness change has been made. Keep at most two heavy runners, no duplicate browser server on port 18765, and do not turn this observation into an unrequested infrastructure rewrite.
