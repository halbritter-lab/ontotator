# T5 assigned translation-review service acceptance

Task5's assigned-service checkpoint is accepted at
`16539aae74d91e968ec7f76937f2adb6d94554d2`, including final accepted Task4 proof
`0d21cd660250cd19a22035eacfa2bcd61ae84539` and the unchanged approved pure decision
bank. This record and the implementation-status update change documentation only.
Actual assignment/distribution/HTTP activation belongs to Task6, and durable
correction triggers remain explicitly pending Task7.

The service opens and autosaves revisioned raw drafts, validates all decisions,
and stores append-only review records with current reviewer snapshots. Submitted
opens return the exact immutable current record read-only. Successful submission
consumes the revision so reopening cannot replay an old submission token.
Corrections require the latest reviewed version and atomically create the next
variant, complete review, assignment transition and audit. The immutable review
is inserted before its child, with no later history patch. Original source/run
context comes from exact immutable lineage; correction translation metadata stays
null. Records retain current exact-document and own/management authority.

Current account/role/ownership/revocation and qualification are rechecked after
ordered locks. Structural submission starts with the global import lock and
project exclusive lock. Reviewers need the annotator work role and no importer
privilege. Immutable review history now locks project pins/profile immediately.
Central task registration is present, while explicit readiness guards keep
unfinished third-task assignment/distribution/annotation dispatch unavailable
until Task6. No third annotation workspace mode was invented.

Independent full specification/quality review passed without findings across
17 new service/integration paths; the three approved pure-bank paths were
verified unchanged. Root read the complete source assessment and actual evidence:

- **35 new real PostgreSQL service cases passed, 55.67 seconds**, at clean
  `16539aa`, from 10:48:14.018309 to 10:49:12.626403 UTC on 2026-10-16.
  Coverage includes all decisions, qualification snapshots, current authority
  after waits, competing saves/corrections, consumed revisions, immutable
  submitted history, exact correction-chain source, final-write rollback and
  review-only structural locks. Seeded real assignments test the service without
  claiming premature Task6 HTTP activation.
- **47 affected cases passed, 38.26 seconds**, at the same clean source, from
  10:50:03.617003 to 10:50:45.982640 UTC. This was one bounded selection of
  assignment administration, project pin/lock behavior, shared import allocation,
  distribution validation/roundtrip and current visibility/guard enumeration.
- **18 new context/catalogue cases passed, 2.47 seconds**, and seven frontend
  error-map cases passed, 1.14 seconds. Ruff/format, mypy117, real generated
  OpenAPI/catalogue checks and frontend type/API drift checks passed. The prior
  45-case pure decision bank was reused without repetition.

Both PG invocations passed on their first execution with no source or fixture
correction between them. Collection-only evidence and earlier pure/static
authoring failures remain distinguished in the detailed producer report; no
missing-service runtime RED or whole-application gate is claimed. Full logs and
exact command/SHA/status/time/exit metadata are retained in ignored
`build/t5-task5-pg` in the service worktree. All heavy processes closed and the
exclusive token returned. Canonical producer/reviewer narratives remain in the
shared T5 SDD records.

Task7 must register the real reanchor handler, wire both import/review correction
producers within their existing creation transactions, and prove deferred
durability/rollback/idempotence behavior. No fake handler, forged job row or
after-commit delivery gap substitutes for that acceptance. UI and final gates
remain downstream. Format1.1 is unchanged, P9 latency remains open, T7 parked;
no main merge, push or deployment occurred.
