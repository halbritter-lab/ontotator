# Implementation status

Status after the reviewed T3a progress/export slice at `efba2df` on 2026-10-15.
Administration continues on `feat/t3a-admin-backend` from that integrated source;
no main merge, push or deployment has occurred.

- [x] Ontospan format 1.1: variant/translation/release schemas available; dependency pinned to `4105ec1`.
- [x] T2a: PostgreSQL persistence and migrations.
- [x] T2b: accounts and sessions.
- [x] T2c: projects, authorization and audit.
- [x] T2d: ontology management, T1 import/export and jobs; defaulted axes and pinned-root export validation.
- [x] T2e: reviewed Docker/Compose/health/operations implementation and functional container acceptance.
- [x] T6a: all ten design-foundation tasks, final review, bundled assets/fonts and integrated acceptance.
- [ ] T2e P9: latency acceptance; latest run has zero client failures but misses all four p95 targets.
- [ ] T3a: administration backend in progress (9/10 tasks accepted: project-key rename, schema/policy, users/profile API, projects/settings/members, project rules, upload preview/commit, assignments/visibility, reproducible distribution, progress/exports/jobs); final combined/container acceptance follows.
- [ ] T3b: administration UI.
- [ ] T5: variants and translation-review application workflows; the format-1.1 prerequisite is already complete.
- [ ] T4a: workflows and stage tasks.
- [ ] T4b: adjudication, releases and comments.
- [ ] T6b: subsequent UX simplification and screen decomposition.

T7 consumer integrations and its remaining helper work are explicitly parked.
Format 1.1 completion does not imply the later application workflows exist.

Fresh combined verification: 1,050 backend tests passed, one POSIX skip; 436
frontend tests; 39 browser scenarios; one real-stack browser smoke; all nine
container checks; lint/types/contracts/wheel passed. See the
[T6a final record](2026-10-15-t6a-final-review.md#final-integrated-gate) and the
[load-test measurements](../../operations/load-test-2026-10.md#combined-reviewed-image-rerun).

The subsequent T3a rename passed its full local gate: 1,053 backend tests plus one
POSIX skip, 436 frontend tests and 39 browser cases, with all static/contract/wheel
checks. See the [rename acceptance](2026-10-15-t3a-task1-review.md). The following
schema/policy slice passed independent review and 123 focused PostgreSQL/policy
tests after correcting its exact migration constraint names. The subsequent
[users/profile slice](2026-10-15-t3a-users-review.md) passed review and 127 focused
PostgreSQL/auth tests after a reproduced audit-lock deadlock was corrected.
The [project administration slice](2026-10-15-t3a-projects-review.md) passed
independent scoped review after thirteen reproduced concurrency failures were
fixed; all thirteen regressions and 113 affected tests then passed, with one
expected Windows skip. The subsequent
[administrator-write authority correction](2026-10-15-t3a-admin-authority-review.md)
also passed independent review, 160 affected tests plus one Windows skip,
and 38 final focused tests. The
[project rules slice](2026-10-15-t3a-rules-review.md) passed independent review,
55 pure/service tests, 64 frontend tests, three new database regressions and
affected scope/submission checks. The
[staged upload slice](2026-10-15-t3a-uploads-review.md) passed independent
integration and scoped fix review, with 96 final targeted tests after correcting
existing-set hashing and duplicate-source provenance. The subsequent
[assignment and visibility slice](2026-10-15-t3a-assignments-review.md) passed
independent review and its complete local gate: 1,386 backend tests with one
expected POSIX skip, 441 frontend tests and all 39 browser scenarios.
The [distribution slice](2026-10-15-t3a-distribution-review.md) then passed
independent review and 117 actual new/affected cases. The
[progress/export slice](2026-10-15-t3a-progress-review.md) then passed independent
review, all 50 new API cases, 90 affected cases and its static/contract checks.
The final combined/browser/container gate remains open.
