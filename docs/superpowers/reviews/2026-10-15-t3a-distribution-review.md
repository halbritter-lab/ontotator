# T3a reproducible distribution acceptance

Accepted on 2026-10-15 at integrated runtime
`6860074e1c5e3a9ad9ae026a46421677d93e5553`, matching tested source
`3fb43f1c813ae59e6742b559a33eac465813212e`.

The proposal API creates a deterministic, language-aware assignment table without
writing assignments or audit events. It preserves all unassignable documents,
actual candidate workload and exclusions, and an explicit server-derived context.
Confirmation accepts human edits, rejects stale inputs before writing, and records
the full original input/proposal separately from the edited rows and actual results.

One transaction uses ordered actor/member/target locks, fresh current authority
and per-row SQL savepoints through a narrow connection-level assignment seam.
Normal row refusals preserve successful rows; unexpected/final-audit failures roll
the whole batch back. Existing manual and idempotent assignment behavior remains.

## Review and actual verification

The pure algorithm, read-only context slice and complete integration each passed
independent source review with no outstanding findings. The complete source review
covered current-authority lock ordering, stale server context, partial savepoint
outcomes, audit reproduction, public service compatibility and HTTP contracts.

After merging accepted Task 7, actual execution at the tested source passed:

- 35 new proposal/confirmation cases in 25.73 seconds, including all 32 new real
  PostgreSQL/HTTP cases, audit rollback, both authority directions, queued stale
  inputs and reciprocal administrator locking. The first execution passed; no
  behavioral failure or correction is invented.
- 82 affected cases in 18.21 seconds: 24 assignment core, 38 snapshot/context and
  20 pure distribution cases, validating the extracted service seam.
- Scoped Ruff/format, mypy, OpenAPI drift, TypeScript drift/typecheck and whitespace
  checks. Integrated whole-tree Ruff/format also passed.

The source merge preserved every reviewed Task 8 path byte-for-byte. There was no
runtime/test correction after source review. Detailed local execution evidence is
retained in the distribution worktree's `build/task-8-full-pg.log`.

This accepts Task 8 with 117 actual passing cases. The complete backend/frontend/
browser gate for Task 7 is recorded separately; final normal/container acceptance
of Tasks 8/9 together remains Task 10. P9 latency acceptance remains open, T7 stays
parked, and no main merge, push or deployment occurred.
