# Phase 0 continuation state (2026-10-18)

Latest follow-up: all [Phase 0 review fixes](../reviews/2026-10-18-phase0-review-fixes.md) were merged and pushed with user approval (`origin/main` verified at `0e9271a`). The user then approved documentation and demo refresh for manual acceptance; see the [current candidate instructions](../../operations/phase0-acceptance.md). The original candidate records below are historical where explicitly marked. Read `PRODUCT.md`, `DESIGN.md`, [the priority roadmap](2026-10-17-phase0-priorities.md) and [verification evidence](../reviews/2026-10-17-phase0-verification.md). Historical pending statements in earlier evidence do not reopen approvals.

## Authority and boundaries

- The user authorized autonomous implementation of decided Phase 0 functions, efficient GPT-6.1-sol medium implementers and independent Astra review.
- The explicit six-item approval settled P0-S/A/R/U, permitted publishing only the reviewed ontospan branch and permitted replacing embedded assets. All six are implemented. A renewed exact-file deletion approval succeeded; no manual deletion remains.
- Subsequent instructions authorized the reviewed Phase 0 merge, push and separate candidate refresh. D6–D15 remain undecided later product questions, already prepared in the roadmap.
- Preserve the reserved port-18080 project `ontocurator-t5-acceptance-ready`, its files and volumes. It was already stopped; do not restart, seed, migrate or replace it.
- Preserve the primary checkout's untracked `.impeccable/critique/` directory. All implementation is in `.worktrees/phase0-implementation`, branch `feat/phase0-usability`.
- German conversation; English files/commits; no co-author/generated-by trailers; no GitHub Actions.

## Implemented and reviewed

B0.1–B0.4 are implemented: opt-in reading-only positional scrolling; stable review keys; one document confirmation; defaulted-axis warnings; independent-mode access restrictions with exact own history; three spanless modes; notes and current-rule validation at every future submission; frozen re-anchor queues with required resolution; editor/admin cleanups.

Backend `873e466` and UI `0480fe2` complete flagged unresolved exports and the approved policies. Clinical axes and original provenance remain separate from `review_resolution`. Valid unresolved results are included with a reviewer/note flag. Historical missing notes receive explicit warnings. Invalid targets fail explicitly; flagged re-import is refused until storage preserves reviewer metadata. Independent review approved these changes and the subsequent fixture/catalog/smoke corrections.

Ontospan `738f3d43ca0896c9d146a15fb9538b938229368a` (format/package 1.2) was pushed with specific approval to `feat/review-resolution-format`, verified remotely and pinned in Ontocurator. Frozen 1.0/1.1 schemas remain unchanged; lossy Phenopacket conversion fails explicitly. No ontospan merge occurred.

## Artifacts and verification

All 31 embedded frontend paths/hashes match the fresh build. Current bundles are `index-DAM43_6Y.js` and `index-Bz01LmIQ.css`; obsolete bundles are replaced as part of the review fixes.

**Current refreshed candidate:** runtime source `0e9271aeb5310c39a7497dc97e0576d6de927628`, image `sha256:74b37290e03e802b281ef0d6dc8639891152f8e84b49e3dba190b8e8950c928d` (local tag `ontocurator-phase0:reviewed`). The image source label and all 31 frontend file hashes were verified. Disposable packaged container checks and the real browser smoke passed. Startup returned `/readyz` 200, all 36 application-table contents matched before/after, and existing credentials and volumes were preserved without reseeding. Evidence and a pre-refresh database backup remain private under `build/t5-acceptance/phase0-review-refresh`.

**Historical pre-review container candidate (does not contain the later review fixes):**

- Runtime source: `001c6729487eee532647f80aa6d0e3442019d1f7`.
- Image: `sha256:9c42d4545a3c1cb4331b513b77160edfda3d78574a4fc849140454687167370a`.
- Local image tag: `ontocurator-phase0:local`. OCI revision and packaged frontend hashes verified.
- Disposable `container_check.py --smoke` exited 0; all contracts and the real login/annotation/submission/reload journey passed. Host smoke correction `06fa716` changes only the test; the image remains valid.
- Full browser preflight: all 87 passed. Corrected integrated gate 12 exited 0: 1,305 frontend, 2,183 backend (one Windows skip), 87 browser passes; 1,863 seconds total.
- Logs/reports/identity snapshots remain ignored under `.superpowers/sdd/2026-10-17-phase0-priorities/`. Do not delete or force-add that evidence.

## Current resource-aware work

The user requested more efficient local CI checks and RAM headroom for another process. This 16 GB host had roughly 1.6–3.4 GB free during the current run. Keep only one heavy runner at a time; do not stop unrelated processes or start additional builds. The complete gate remains sequential. A bounded harness change adds explicit partial-stage runs, early cheap contracts, useful failure/slow-test timings and a two-worker frontend default (explicit override available). Partial runs must never claim full verification. No result cache or additional PostgreSQL/browser workers are introduced.

The original candidate gate used the pre-change harness. The review-fix verification used the current harness: all required stages passed, with the browser stage repeated after correcting one obsolete assertion. The detailed counts and log paths are in the latest review resolution report. Preserve this evidence rather than rerunning unchanged suites.

## Completion and next action

Phase 0 implementation, all review fixes, independent review and full stage verification are complete. Review-fix commit `778e3a0` was fast-forwarded into local `main`; identical branch tree hashes were verified. The final checks passed 1,320 frontend tests, 2,209 backend tests (one expected Windows skip), 88 browser tests and all static/contract/wheel checks. The documentation completion at `0e9271a` was then pushed with explicit user approval and verified remotely. The current demo refresh changes deployment identity and documentation, not application code.

The separate candidate was originally prepared from clean seed/tooling revision `87367d8bd963646d7b4ffd05f7c3f9a13bc5b8e1` and seeded once. Its image has now been refreshed to the reviewed source above. It retains six synthetic documents, two open translation reviews and one open annotation task. Its exact project is `ontocurator-t5-acceptance-phase0`, app port 18081, PostgreSQL port 15544; private files live at `build/t5-acceptance/phase0-candidate` in this worktree. `seed-result.json` records the original seed, while `refresh-result.json` records the current deployment.

It is stopped after verification to preserve the requested RAM headroom. Retain its volumes and use [the acceptance instructions](../../operations/phase0-acceptance.md) to start it without reseeding. Those instructions include actual image/source identity, private credential-file location, the additional Adjudicator role required for annotation review, and the correct order for the test journeys. The reserved old demo's identities/state match the baseline exactly.

The approved merge, push and demo refresh are complete; manual user acceptance is the next step. D6–D15 implementation is not part of this authorization. Keep the local branch/worktree and ignored evidence. The earlier stored `blocked` goal status described an old approval wait; all Phase 0 approvals and required work are now resolved.
