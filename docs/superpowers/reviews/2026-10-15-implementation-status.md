# Implementation status

Status after the reviewed combined-source gate at `a17fb6a` on 2026-10-15.
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
- [ ] T3a: administration backend in progress; project-key rename accepted, schema/policy accepted, user/profile API under verification.
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
tests after correcting its exact migration constraint names. Later T3a tasks
remain open.
