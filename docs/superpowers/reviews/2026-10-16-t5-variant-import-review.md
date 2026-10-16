# T5 variant-import acceptance

Task3's import/export and persisted-override scope is accepted at
`ce3058b1fce90e85bdb14e3e1f7b414aadb7f380` on `feat/t5-variant-import`.
Accepted Task2 proof `6691eb3947f8b4e0d32fd5541966f284c0adac27`, including
final T3b acceptance, was merged before PostgreSQL execution. This record and
the implementation-status update change documentation only.

The planner resolves project-local external/language/version identities before
allocating internal IDs, resolves case-compatible source hashes deterministically,
and preserves immutable metadata/status on identical reimport. Preview and worker
use full variant-state fingerprints and fresh authority. Internal snapshot
mapping retains original proposal payload, actors, notes and defaulted basis.
Typed HTTP/CLI overrides survive in persisted jobs, are freshly authorized and
audited atomically. T1 exports retain external identities, actual case metadata
and ancestry text hashes, including sources without exported submissions.

Independent specification/quality review found two writer regressions: canonical
raw provenance could differ from the preview, and repeated units inside one
bundle lost skipped-document counts. Both were reproduced and corrected through
a scoped review. The writer now uses the first authoritative planned occurrence
and counts every delivered occurrence while retaining actual physical inserts.
An old provenance fixture was changed from two language identities to one; every
existing payload/blob/manifest/order/count/hash assertion was retained. Final
independent source and evidence review passed with no unresolved finding in this
scope.

Actual verification, preserved in ignored `build/t5-task3-pg`:

- **27 new PostgreSQL/API/worker cases passed**, 39.45 seconds at `a0f0eb3`:
  translation/correction import, identity/source/status preservation, persisted
  overrides and restarted workers, current authorization, atomic refusals,
  freshness inputs, CLI and actual T1 export.
- One eight-file affected batch recorded **205 passed, two fixture failures**,
  120.38 seconds at the same source. It covers T1 import/export/mapping, uploads,
  preview jobs, repository scope, administrator-write authority and export APIs.
- Both affected fixture parameters then **passed**, 11.70 seconds at `ce3058b`.
  The original failed invocation is retained; there was no all207-green retry.
- Five new planner/application boundary regressions genuinely failed before the
  writer correction. All six focused cases then passed, 1.29 seconds. They cover
  set/bundle/label ordering, stable ties and new/reimport occurrence counts.
- Earlier pure checks: **62 passed**, 4.55 seconds; affected frontend checks:
  **25 passed**, 4.12 seconds. Ruff/format, mypy112, OpenAPI/error-catalogue/TS
  generation and drift checks passed. The final narrow correction passed its
  scoped Ruff/format, writer mypy and whitespace checks.

Evidence is cumulative across the stated immutable sources and narrow reviewed
correction. The original27 and205 banks were not rerun after that correction;
no successful single combined invocation is claimed. Root and the independent
reviewer read the actual PG logs/metadata. All processes closed and the exclusive
heavy token was returned. Full producer/review records remain in the shared T5
SDD task-3-report.md and task-3-review.md.

The original correction-to-reanchor enqueue acceptance is explicitly **pending
Task7**, which will register the real handler, wire both import and review
producers inside their creation transactions, and execute deferred durability,
rollback and idempotence checks. No placeholder handler or queue bypass was added;
this acceptance does not claim reanchor completion. Task4's case/text/version API
follows, with review services and application UI later. Format1.1 remains complete
and unchanged. P9 latency remains open, T7 parked. No main merge, push or deployment
occurred.
