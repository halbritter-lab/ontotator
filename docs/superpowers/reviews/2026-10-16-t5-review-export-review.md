# T5 Task 8: generic translation-review export

Implementation and focused verification accepted on 2026-10-16 at runtime
`2db4f5b2a0248ee3dcb87ac18e1576b1a04cc597`, based on accepted Task7 proof
`dfbb225`. The complete Part1 normal gate subsequently passed at runtime `b8d48b1`,
as recorded below. The complete T5 user interface and packaged result remain pending.

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

## Complete Part1 gate and reviewed corrections

The first complete gate at `51f59d4` passed static checks and 828 frontend
cases, then recorded 1990 backend passes, 12 failures and one POSIX skip.
Browser coverage was not reached. All failure artifacts remain preserved.
Independent review approved the six-path correction at `b8d48b1`: canonical
JSON-native distribution snapshots preserve exact prior hash bytes and complete
audit inputs; older assignment/audit/visibility fixtures now follow the accepted
current policies, with sibling text, unrelated-case and exact-work/privacy
assertions retained. Actual focused evidence was 35 passes followed by three
fixture-hash-corrected passes; no single 38-pass run is claimed.

One complete normal `scripts/check.sh` retry at clean unchanged
`b8d48b1b59e0f5f712d7d87392f5906238dd4cb8` then exited zero:

- 828 frontend cases across 91 files passed in 154.48 seconds.
- 2003 backend cases passed, one POSIX skip, one existing warning, in 968.72 seconds.
- All 43 existing Playwright browser cases passed (stage 195 seconds).
- Ruff, formatting, mypy, OpenAPI/TypeScript drift, typecheck, lock and wheel checks passed.

Actual UTC 2026-10-16T12:39:13.443009Z to 13:01:31.872413Z, 1338.43 seconds.
Root execution 28535 closed with exit zero; before/after source was exact and
clean. Full immutable execution metadata and output are retained under
`build/t5-part1-gate-retry/{execution.json,check.log}` in the central T5 worktree.
This was one complete successful invocation. Optional container/image checks
were excluded; final rebuilt T5 UI/assets/image and packaged acceptance remain
Task15 work. Task8 and Part1 are accepted; Tasks9–15 are not accepted by this gate.

P9 latency remains open. Format1.1 is complete, T7 remains parked. User-authorized
local main integration already contains the stable T3b proof `b9544a6`; final gated
T5 follows before functional interim acceptance. No remote push/deployment occurred.
