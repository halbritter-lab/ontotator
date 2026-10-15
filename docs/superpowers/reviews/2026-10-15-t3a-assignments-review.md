# T3a assignments and document visibility acceptance

Accepted on 2026-10-15 at runtime `3cd59ab2ee3a9854468e3a1a6e28637d98496c63`.
The integrated runtime matches independently reviewed implementation
`f185e0fe574cfd2dc4636bebcf5ce6eae8949aac`; documentation is recorded separately.

Assignments now control ordinary document visibility and work authorization.
Administration supports assignment, reassignment, revocation and reopening;
submitted work opens read-only and preserves earlier submissions. Current
membership, task role, activity and ownership are checked through real service
paths. Leads and administrators still need a task assignment to perform work.

Draft commands keep current authority through their transaction, preserve
successful receipt replay and update assignment status atomically after storage.
Standalone search/tree provenance uses the same transactional authority boundary
without treating submitted read-only searches as new annotation commands.
Document/ID readers, bulk lists, project counts and task metadata use current
scoped visibility. CLI, browser, smoke and test fixtures provision real assignments.

## Review corrections

The independent review required preserving the original load workload and closing
the standalone provenance authorization race. The measured Locust file is now
byte-identical to the accepted Task 6 baseline: every original user chooses from
all 1,000 documents. Seed provisioning uses the real all-document CLI for each
of the 30 users, with explicit audited language confirmation. No resource,
operation weight or latency target changed; no new benchmark run is claimed.

Actual provenance regressions first failed on the old source, then the bounded
correction passed 22 targeted tests and 126 related API/tree/visibility/scope
checks. Original scoped review approved both corrections. Four existing
prepared-profile fixtures gained real assignments while retaining their race
and receipt assertions.

The first complete gate found one route-layer architecture failure: direct
repository database access for the read-only status. A public authorized
repository accessor corrected the boundary without changing tests or policy.
The unchanged architecture/enumeration checks passed, independent scoped review
approved the correction, and five real open/status/revoke/administration checks
passed in 13.40 seconds before the complete retry.

## Final complete local gate

`CHECK_CONTAINERS=0 scripts/check.sh` passed at the exact runtime above:

- Ruff, formatting, mypy, OpenAPI/TypeScript drift and frontend typecheck passed.
- Lock, wheel build and wheel contents passed. Wheel SHA-256:
  `4b2dc8e5867e980e6ea168907098e754183b719431c74390010bab2526f24562`.
- 441 frontend tests passed.
- 1,386 backend tests passed in 601.11 seconds; one expected Windows POSIX
  file-permissions skip and the existing Starlette/httpx deprecation warning.
- All 39 Playwright browser scenarios passed.
- Complete gate exit 0 after 807.34 seconds, with identical starting/final source.

Local evidence is retained under `build/t3a-task7-gate-retry/`; the earlier
one-failure run remains separately under `build/t3a-task7-gate-final/`.
This accepts Task 7, including the harness work pulled forward from Task 10.
Automatic distribution, progress/exports and the final exact-source container
gate remain separate tasks. P9 latency acceptance remains open; T7 stays parked.
No main merge, push or deployment occurred.
