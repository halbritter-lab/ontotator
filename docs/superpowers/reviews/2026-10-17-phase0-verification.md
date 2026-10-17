# Phase 0 local implementation verification

Status: the source subset through `0e8fe52` is independently reviewed and passed the complete local gate on 2026-10-17. Subsequent D3 work is undergoing focused verification and review; the earlier gate does not cover it. Only dependent policy slices await answers; ready D3 and re-anchor work continues. Embedded-web refresh remains open. This record does not claim Phase 0 acceptance or authorize integration.

## Workspace and boundaries

- Plans: `docs/phase0-execution-plans` at `5b8b4b0`, based on `main` at `4de9aaa`.
- Implementation: `feat/phase0-usability` in `.worktrees/phase0-implementation`.
- All commits remain local. No merge or push has been performed.
- The reserved acceptance stack on port 18080 was not written to, migrated, restarted or reseeded. Browser verification uses the disposable fixture on port 18765.
- Docker and locked Python/frontend dependencies are available. Vitest used `--maxWorkers=4 --minWorkers=1`; the complete gate ran through Git Bash with `scripts/check.sh`.

## Completed focused verification

| Deliverable | Commits | Evidence | Independent review |
| --- | --- | --- | --- |
| B0.1 positional scrolling, explicit opt-in, reading-only coupling | `2fcfa34`, `ed9bca9` | 74 initial component tests; 33 tests after two review fixes; typecheck; 17 browser cases plus the remaining clipboard case after a Windows CRLF assertion correction; desktop/narrow screenshots | Two important findings reproduced and fixed: queued follower events after ownership transfer, and marker replacement after payload arrival. Scoped rereview approved. |
| B0.2 Task 1 completion, outcome keys, defaulted-result warnings | `9191b36`, `7b1fd89`, `57f0f1e` | 55 final component tests; 47 navigation/session tests; seven browser cases; 55 final targeted backend tests; typecheck, Ruff, mypy and contract checks | One P2 result-filtering finding reproduced against frontend and backend, then fixed with five mode/non-target regressions. Scoped rereview approved. |
| B0.4 language codes and administrative copy | `312554d` | 47 focused component tests | Approved without actionable findings. Access and other editor work remain separate. |
| B0.4 decided D16 access restrictions | `bf88e37` | 76 UI tests; 68 backend follow-ups; 117 policy/visibility and 16 lineage tests; five output/input/roundtrip tests; initial 6/8 browser run followed by four passing cases covering corrected failures; typecheck and Ruff | Astra reviewed current authority, output-metadata joins, assignment bounds and mixed roles without actionable P1/P2 findings. P0-A remains open, with exact own history retained. |
| B0.2 Task 3 note-required unresolved decisions, plus B0.4 editor cleanups | `9909bd7`, `b0fd793`, `ac0935e`, `defe2ac` | 75 backend tests; 152 integration/component tests; four browser cases; 104 targeted tests after the legacy fix; typecheck | Final review found one P2: untouched legacy missing-note drafts were falsely dirty and could not log out. A regression verified clean historical access while still refusing new note-less submission; scoped rereview approved. |

The broader B0.2 affected backend run passed 289 tests and failed one obsolete malformed-body assertion that relied on the removed layer gate. The test now sends an actually malformed body and passed in the final targeted run. Historical layer fields and snapshots were not rewritten.

The early B0.1 browser runner printed PostgreSQL teardown connection errors after a passing clipboard case while removing its disposable fixture container; the command exited zero. The final combined browser gate subsequently passed all 81 cases. Existing React `act` and Starlette deprecation warnings are recorded in local logs.

## Integrated verification follow-ups

The full frontend run exposed obsolete toggle/payload/label assertions and incomplete project fixtures. Test-only commits `4e81d87`, `a5e4e1a` and `2a35a85` preserve retry envelopes, replacement revision binding, historical snapshot identity and current-role checks. The corrected complete frontend suite passed all 1,263 tests across 121 files without unhandled errors.

Backend integration exposed the missing central `REVIEW_NOTE_REQUIRED` catalog entry. Commit `54a3ea4` adds the code to the Python catalog, generated JSON and UI message mapping; three catalog tests, seven frontend error tests, export drift and Ruff checks passed. Independent scoped review found no actionable issues. Runtime validation did not change.

The first complete backend run passed 2,082 tests, failed seven and skipped one POSIX permissions test on Windows. Commit `bc3af0c` supplies explicit document confirmation in three old submit helpers (28 file tests passed). Commit `665d8d8` preserves four security scenarios with explicit current mixed-role authority, adds annotator-only denials and retains authority-loss/forged-reference checks (40 file tests passed).

The first complete browser run passed 77 of 81 cases. Commit `0e8fe52` opens the Versions disclosure, asserts disabled editor scroll coupling and uses readable own-history labels while checking the exact submission ID in details. All four affected cases then passed, retaining producer identity, native selection, owned scroll and direct permission denials. These were test-only updates.

The final `scripts/check.sh` run exited zero: 1,263 frontend tests, 2,089 backend tests with one Windows POSIX-permissions skip, and all 81 Playwright cases passed. Ruff, formatting, mypy, OpenAPI/TypeScript API drift, frontend typecheck and wheel lock/content checks passed. Total duration was 1,439 seconds; evidence is in `phase0-check-5.log` under the ignored execution ledger. The tested final source/test boundary is `0e8fe52`; the later tracking commit changes documentation only.

A fresh frontend build at production commit `54a3ea4` passed. Its files remain in `frontend/dist` pending embedded-web replacement approval. A file/hash comparison confirmed that the embedded copy differs only in `index.html` and the old/new hashed JavaScript and CSS bundles. The passing wheel check therefore validates packaging of the existing embedded frontend, not delivery of the new UI. No release image or container smoke test was claimed.

## Subsequent D3 work: focused verification, integrated gate pending

Backend commit `a2abec1` adds annotation notes, the project setting, migration 0007 and server-owned routing for genuinely new drafts. Existing draft rows retain their prior behavior while P0-S is unanswered. The bounded backend run passed 350 tests and exposed 38 old positive fixtures missing newly required justifications; all 38 affected cases passed after explicit fixture corrections. Three additional regressions cover policy-marker receipt replay, existing-draft behavior and exact replacement invalidation. Migration upgrade/downgrade, historical snapshot hashes, source-note preservation, static checks and contract drift checks passed.

Independent backend review found one P2: two changed decisions sharing one replacement lost the earlier target's imported notes during export. Commit `7660a08` collects every exact target before stable deduplication. The new regression reproduced the loss before the fix; all 26 mapping tests passed. Scoped independent rereview approved the fix, with no other backend findings.

UI commits `bd12c44` and `1ef8c25` add settings, required reasons, autosave/leave guards and repair of historical spanless proposals. When the project forbids spanless findings, the reviewer selects supporting text before creating the changed copy. A profile requiring evidence still permits the existing intermediate editing flow but refuses approval without evidence. Final focused verification passed 83 UI tests, typecheck and all eight decision browser cases; earlier expanded checks passed 188 UI tests and 17 browser cases. Final independent UI review and the combined gate remain pending. These results do not extend the earlier complete gate to the new source.

## Dependency prerequisite

Ontospan branch `feat/review-resolution-format` contains local commit `738f3d43ca0896c9d146a15fb9538b938229368a`, based on the existing pinned `4105ec1`. It introduces format 1.2 structured review resolution, retains frozen 1.0/1.1 schemas, and rejects lossy Phenopacket conversion. Its full suite passed 251 tests with one Windows symlink skip; lint, format, mypy, schema drift, lock and wheel checks passed. Independent compatibility review approved it, including byte-identical frozen schemas and all nine schemas in the wheel.

Publication approval is pending. Ontocurator has not been pinned to an unreachable remote commit. Flagged export and a reproducible image using that dependency remain unfinished.

## Remaining gates

- The delivered source gate is complete. Astra reviewed the source boundary through `defe2ac` and the narrow catalog addition `54a3ea4`; no actionable P1/P2 findings remain in that subset. The final mechanical scan of 13 changed UI files returned no findings; preserved screenshots were inspected once.
- Update the embedded frontend and verify its exact file/hash match with the fresh build. Automatic approval review rejected both a checked-directory replacement and a narrower operation naming only the two obsolete generated assets, giving only `blocked by policy`. Neither operation executed. Explicit user permission is pending; no workaround is being attempted. Until this is resolved, wheel checks package the old embedded frontend and do not validate the new bundled UI.
- Record answers for P0-S, P0-A, P0-R and P0-U before their dependent policy changes; see the master roadmap. Do not infer approval from the recommendations.
- Complete the ready D3 new-draft and re-anchor storage/action slices, review them and rerun the combined gate on the integrated source. P0-S gates only enforcement on existing open drafts; P0-R gates only the unresolved-item completion policy. Flagged export awaits publication of the reviewed dependency and the dependent P0-U policy.
- Prepare an isolated acceptance candidate only after successful verification and a reproducible dependency pin. No candidate URL, image digest or acceptance result exists yet.

Detailed commands and red/green evidence are retained in the ignored `.superpowers/sdd/2026-10-17-phase0-priorities/` directory. Complete the remaining gates before claiming an acceptance candidate or requesting integration of the full roadmap.
