# T5 Task 8: generic translation-review export

Implementation and focused verification accepted on 2026-10-16 at runtime
`2db4f5b2a0248ee3dcb87ac18e1576b1a04cc597`, based on accepted Task7 proof
`dfbb225`. The mandatory complete Part1 normal gate remains pending; this
record does not claim Part1 or all of T5 complete.

The real API/worker/CLI export emits the documented generic pseudonymised
UTF-8 JSONL from immutable review snapshots. Reviewed identity/hash remain
exact; reviewed corrections inherit translation-ancestor run/check context only
in this export, and source identity is the original translation source. Stored
and T1 correction metadata remain unchanged. Current persisted project/requester
authority protects enqueue, execution and authenticated download, including after
lock waits. File metadata and audit share the transaction; successful artifacts
have verified digest/count, filename and NDJSON media type. Existing T1/edit-log
request and output contracts are preserved.

Independent full specification/quality review passed with no actionable findings.
Root read its complete report, actual source interfaces, new/affected execution
metadata and logs. A one-line ScopedRepository nullable source-SHA annotation
matches the accepted Task7 base method; its guards and forwarding are unchanged.
The original full-mypy mismatch remains recorded, followed by full122-file PASS.
Generated changes add the actual export route only (OpenAPI42/TS48 lines).

Actual focused evidence at clean unchanged runtime2db4f5b:

- All29 new PG/API/worker/CLI cases passed in71.43s, UTC
  11:58:21.478896Z–11:59:35.310878Z, exit0. This includes exact historical
  context/snapshots, all decisions, correction chains, current and post-wait
  authority, association/CSRF denials, blob integrity, rollback and real CLI.
- One narrowed existing13-selector invocation expanded to18 passing cases in
  31.27s, UTC12:00:40.754510Z–12:01:14.950643Z, exit0. It covers existing
  T1/edit-log API downloads, project/requester/current permissions, terminal
  results and real two-kind CLI output/count/overwrite behavior.
- Earlier new serializer/registration pure15 passed atbef3501; relevant files
  stayed unchanged through prerequisite merges and were not needlessly rerun.
- Scoped Ruff/format, full mypy122, catalogue/OpenAPI/TypeScript/API drift and
  whitespace checks passed, with precommit source attribution retained.

Full actual logs and execution metadata remain in the owning review-export
worktree's build/t5-task8-pg/{new-export,affected-export}.{log,execution.json};
static and prior pure artifacts retain their separately named directories.
All invoked processes closed and returned the sole heavy token.

Next is the complete normal scripts/check.sh Part1 gate, including existing
frontend, backend PostgreSQL and browser coverage. UI Tasks9–15, rebuilt matching
assets/image and final packaged acceptance remain pending. P9 latency is open;
format1.1 remains complete, T7 parked, no main merge/push/deployment occurred.
