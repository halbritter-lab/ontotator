# T3b assignment, progress, export and provenance acceptance

Tasks 8–10 are accepted on `feat/t3b-admin-ui`, with approved runtime integration
`b9bb8e853ba37ba2eea074f542e6db4043bf1828` and actual browser coverage at
`f034b378a1ffae53795000ceeaceb0cb4bb5313c`. T3b has **10/11 accepted tasks**;
Task 11's final packaged-assets, complete suite and container gates remain pending.

Task 8 source `219ba273` provides role-aware manual assignment, language
confirmation, editable server distribution proposals, exact retained proposal
context/state hashes, partial retries, revocation confirmation and reopening.
Independent review reproduced and corrected filter-input focus loss and projected
load double-counting of existing unrevoked assignments. Five genuine regressions
then passed within 22 affected tests; eight independent selected checks passed.
Source and scoped correction reviews both passed without remaining findings.

Task 9 source `c1be707` provides server-authoritative totals, people and document
progress, encoded Assign links, export jobs scoped by user/project/kind, persisted
job restoration and real authenticated binary downloads. The JSON and binary
methods share the existing authentication/error transport. Filename sanitization,
failed/stale jobs, access loss and object-URL cleanup are covered. All 48 new and
directly affected tests passed; independent review repeated all 48 successfully.

Task 10 source `87aa971` displays actual tool/version/model/run, importer, set,
bundle and annotation notes across proposal/reference/derived sidebar and detail
views. Actor provenance and source references determine origin; imported human
annotations remain human. The workspace-scoped provider deduplicates in-flight
and completed reads, handles missing metadata and aborts stale lifecycle work.
Actual composition and StrictMode regressions passed within 23 focused tests;
independent review repeated all 23 successfully. Clinical axes and read-only
mutation policy remain unchanged.

Final App assembly passed independent specification and quality review without
findings. The reviewer independently ran all eight new assignment/progress/export
App tests (6.44 seconds) and confirmed approved component preservation. The App
production delta from accepted Tasks 1–7 is two imports and two route cases.

Root's complete four-scenario browser run at clean `f034b37` exited 0 on
2026-10-16, 08:57:03–08:58:04 UTC: **4 passed, 56.9 seconds** (60.67 seconds
including build/controller setup). Every scenario creates independent accounts,
project and ordinary roles through real UI; ordinary subjects receive no fixture
assignments. Beyond setup/import, the actual annotator sees only the distributed
document, annotates and submits it, reloads it read-only, and sees Reopened after
the lead verifies actual submitted progress and reopens it with a reason.
The independent export journey downloads nonempty ZIP and parseable JSONL bytes,
restores its job after reload, and checks actual annotator export refusal (403)
without inheriting the lead's download. Source remained unchanged and clean.

Two earlier test-authoring failures remain recorded: synchronous checking of an
asynchronously controlled radio, and retaining the previous account's task route
when switching users. Minimal reviewed test corrections retain all state/count
assertions and the original 30-second per-test timeout. No product fix or relaxed
authorization was needed. Evidence is retained in the browser worktree's ignored
`build/admin-journeys-complete-{initial,retry,home}` directories and the shared
T3b SDD reports/reviews. This four-test pass does not claim a new complete
43-browser/backend/frontend/container execution. P9 latency remains open; T7 is
parked. No main merge, push or deployment occurred.
