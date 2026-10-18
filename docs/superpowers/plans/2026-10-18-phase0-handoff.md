# Phase 0 continuation state (2026-10-18)

This file describes the current state, replacing the earlier blocked handoff. Read `PRODUCT.md`, `DESIGN.md`, [the priority roadmap](2026-10-17-phase0-priorities.md) and [verification evidence](../reviews/2026-10-17-phase0-verification.md). Historical pending statements in earlier evidence do not reopen approvals.

## Authority and boundaries

- The user authorized autonomous implementation of decided Phase 0 functions, efficient GPT-6.1-sol medium implementers and independent Astra review.
- The explicit six-item approval settled P0-S/A/R/U, permitted publishing only the reviewed ontospan branch and permitted replacing embedded assets. All six are implemented. A renewed exact-file deletion approval succeeded; no manual deletion remains.
- No Ontocurator merge or push is authorized. Keep its branches local. D6–D15 remain undecided later product questions, already prepared in the roadmap.
- Preserve the reserved port-18080 project `ontocurator-t5-acceptance-ready`, its files and volumes. It was already stopped; do not restart, seed, migrate or replace it.
- Preserve the primary checkout's untracked `.impeccable/critique/` directory. All implementation is in `.worktrees/phase0-implementation`, branch `feat/phase0-usability`.
- German conversation; English files/commits; no co-author/generated-by trailers; no GitHub Actions.

## Implemented and reviewed

B0.1–B0.4 are implemented: opt-in reading-only positional scrolling; stable review keys; one document confirmation; defaulted-axis warnings; independent-mode access restrictions with exact own history; three spanless modes; notes and current-rule validation at every future submission; frozen re-anchor queues with required resolution; editor/admin cleanups.

Backend `873e466` and UI `0480fe2` complete flagged unresolved exports and the approved policies. Clinical axes and original provenance remain separate from `review_resolution`. Valid unresolved results are included with a reviewer/note flag. Historical missing notes receive explicit warnings. Invalid targets fail explicitly; flagged re-import is refused until storage preserves reviewer metadata. Independent review approved these changes and the subsequent fixture/catalog/smoke corrections.

Ontospan `738f3d43ca0896c9d146a15fb9538b938229368a` (format/package 1.2) was pushed with specific approval to `feat/review-resolution-format`, verified remotely and pinned in Ontocurator. Frozen 1.0/1.1 schemas remain unchanged; lossy Phenopacket conversion fails explicitly. No ontospan merge occurred.

## Artifacts and verification

All 31 embedded frontend paths/hashes match the fresh build. Current bundles are `index-Bh_N9xcP.js` and `index-ytX3jISo.css`; obsolete bundles were removed in `4688ebb`.

- Runtime source: `001c6729487eee532647f80aa6d0e3442019d1f7`.
- Image: `sha256:9c42d4545a3c1cb4331b513b77160edfda3d78574a4fc849140454687167370a`.
- Local image tag: `ontocurator-phase0:local`. OCI revision and packaged frontend hashes verified.
- Disposable `container_check.py --smoke` exited 0; all contracts and the real login/annotation/submission/reload journey passed. Host smoke correction `06fa716` changes only the test; the image remains valid.
- Full browser preflight: all 87 passed. Corrected integrated gate 12 exited 0: 1,305 frontend, 2,183 backend (one Windows skip), 87 browser passes; 1,863 seconds total.
- Logs/reports/identity snapshots remain ignored under `.superpowers/sdd/2026-10-17-phase0-priorities/`. Do not delete or force-add that evidence.

## Current resource-aware work

The user requested more efficient local CI checks and RAM headroom for another process. This 16 GB host had roughly 2–3.4 GB free during the current run. Keep only one heavy runner at a time; do not stop unrelated processes or start additional builds. The complete gate remains sequential. A bounded harness change adds explicit partial-stage runs, early cheap contracts, useful failure/slow-test timings and a two-worker frontend default (explicit override available). Partial runs must never claim full verification. No result cache or additional PostgreSQL/browser workers are introduced.

The completed full gate used the pre-change harness. Validate the harness change with focused behavioral tests and static checks; preserve the full product evidence rather than rerunning unchanged product suites. The prepared replacement is installed only after the gate has exited; no executing shell script was overwritten.

## Remaining completion work

1. Harness installation and independent review are complete. Actual `--only static` passed with 26 preflight tests and all static/type/API/wheel checks in 49 seconds. Preserve this evidence and the full product gate; no repeat is needed.
2. Prepare the isolated candidate only after the full gate succeeds and the checkout is clean. Preferred project `ontocurator-t5-acceptance-phase0`, app port18081, PostgreSQL port15544, ignored directory `build/t5-acceptance/phase0-candidate`. Recheck identity/ports before startup. Use the verified immutable image; do not rebuild for host-test/docs-only changes.
3. Seed the fresh candidate once with the existing seeder. Confirm health and open tasks without consuming them. Publish exact identity, private credential-file location and an executable role-specific checklist in `docs/operations/phase0-acceptance.md`.
4. Update roadmap/verification/handoff to actual final status, compare the reserved demo identities, commit local documentation, and report the reviewable result. User acceptance, later D6–D15 choices and any Ontocurator merge/push remain separate.

The stored goal previously remained `blocked` despite resumed execution because the available goal API cannot set `active`. That stale status is not an approval blocker. Do not repeat completed approvals or implemented work because of it.
