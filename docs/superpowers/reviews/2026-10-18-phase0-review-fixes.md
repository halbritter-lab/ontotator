# Phase 0 review resolution — 2026-10-18

Scope: all findings in [the independent review](2026-10-18-phase0-opus55-review.md), checked against `afc41e0`. The user authorized implementation and a merge at the appropriate point. The original report remains historical evidence; its broad runtime verdict must be read with its explicit limitations.

## Changes

| Finding | Resolution |
|---|---|
| P1-1 | The dedicated server command copies verified predecessor axes and `axes_defaulted`, regardless of caller defaults. Authorized queue items and the recreation panel show original context. Diagnostic items do not disclose unverified content. Explicit subsequent edits remain possible. |
| P2-1 | Settings explain that current rules apply to every future submission and completed submissions remain unchanged. |
| P2-2 | The submission checklist provides remedies and focuses Add Mention, the annotation note, Change term, or Edit & Replace as appropriate. Prohibited spanless findings do not label their note as required. |
| P2-3 | Known invalid terms join the item-level checklist. Server rule/term rejections offer a reload of current rules/status and no longer claim nonexistent highlights. The duplicate sidebar error is removed. |
| P2-4 | Proposal details mark defaulted axes individually and explain the edit-copy/confirmation path. |
| P2-5 | `EXPORT_UNRESOLVED_INVALID` carries document, submission, exact annotation and cause details. The export UI explains repair. Structured errors are opt-in; existing failed jobs retain compatibility. Exact cause assertions cover unknown, obsolete, profile-invalid and missing historical targets. Corrected submissions demonstrably supersede failing history. |
| P2-6 | Legacy drafts explain submission requirements while retaining the explicitly approved incremental-edit compatibility. |
| P3: heading | The curated-list heading and action wrap independently; neither label nor count is truncated. |
| P3: coupling | Below 1100 px controls explain unavailability and pause coupling. Resize retains an explicit prior opt-in; editable-view restrictions remain. Pair readouts use an accessible status role. |
| P3: queue | Current context and axes are immediately visible; old context/diff and technical replacement IDs use disclosures. IDs wrap. Context windows extend to nearby word boundaries with a bounded Unicode-safe extension. |
| P3: hygiene | Removed stale P0-A comment; recreation save is secondary to case submission; reviewer notes are multiline; singular default-warning grammar is corrected. |

## Review and verification

An independent fresh-context reviewer found no critical or important issue. Its one coverage suggestion was implemented: both empty and conflicting caller axes are tested through re-creation, exact resolution, submission and export. Export assertions require `absent/chosen`, `historical/chosen` and `patient/defaulted`.

Focused verification passed: 105 editor/review/settings tests, 73 coupling/translation tests, 30 re-anchor UI tests, 27 re-anchor database tests, 50 pure re-anchor tests, 24 export/job backend tests, and 21 export UI tests. The extended fidelity regression passed its four targeted cases. These runs overlap; the counts are not additive suite totals.

Browser repairs passed at 1440/1024 px and re-anchor recreation/resolution passed at 1280/600 px. Screenshots, including unavailable coupling at 1024 px, were inspected and retained under `.superpowers/sdd/2026-10-18-phase0-review-fixes/browser/`. The embedded frontend matches all 31 build files by SHA-256. Full-suite follow-up also covers absence of `matchMedia` and multiline reviewer-note saving. Publication was authorized separately after this verification, as recorded below.

### Final verification

| Required stage | Result |
|---|---|
| Static and packaging | Ruff lint/format, mypy (128 source files), frontend typecheck, OpenAPI/error-catalog/TypeScript drift, 26 contract preflight tests and locked wheel build passed. |
| Frontend unit tests | 121 files, 1,320 tests passed (103 seconds). |
| Backend with PostgreSQL | 2,209 passed, one expected Windows skip for POSIX file permissions (1,057 seconds). |
| Browser with production build | All 88 Playwright tests passed, one worker (440 seconds). |
| Embedded distribution | All 31 paths and SHA-256 hashes match the final production build. |

The complete `scripts/check.sh` run passed every stage except one obsolete browser assertion that expected coupling to remain visibly checked below 1100 px (87 other browser tests passed). Only that test was then updated to require the new disabled/unchecked state, its explanation, and automatic restoration of the prior opt-in on widening. The entire browser stage was rerun with `scripts/check.sh --only browser` and exited 0. Application code did not change between those runs; the successful static, unit and backend results remain applicable. This is full stage coverage assembled from those runs, not a claim that the initial combined invocation exited 0.

Ignored logs: `build/review-fixes-full-gate-final.log` and `build/review-fixes-browser-final.log`. Existing React test `act` warnings, the Starlette/httpx deprecation and Vite's chunk-size advisory remain non-failing. The demo image was not rebuilt during the review-fix task. The subsequently authorized refresh and its current identity are documented in the [acceptance instructions](../../operations/phase0-acceptance.md).

### Local integration

Review fixes were committed as `778e3a04c922a4ed6dab0bfb766def3f27990742`. Local `main` was fast-forwarded from `4de9aaa` to that commit, including the reviewed Phase 0 implementation. Both branch trees were verified as `8f55d544523b3c8c7115c1be461d44e34fb16f74`; no merge conflict or source alteration occurred. Completion commit `0e9271a` changed documentation only. The user subsequently authorized the push; `git ls-remote` verified `origin/main` at `0e9271aeb5310c39a7497dc97e0576d6de927628`. The primary checkout's untracked `.impeccable/critique/` and the implementation worktree's ignored evidence were preserved.

## Decisions retained

- Legacy editing remains permissive between saves; current submission validation is authoritative.
- Historical unresolved export errors still stop the entire export rather than omit findings.
- Narrow translation-form layout debt remains outside Phase 0, as explicitly excluded by the reviewed scope.
- Preserve the existing worktree and ignored review evidence after merging; it contains the original review session's only local artifacts.
