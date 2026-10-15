# T3a project administration acceptance

Task 4 is accepted at `b7f0ff9a5a924fcde6edb89f9604140a2917b9d7`, integrated
through `49f18e952e66f2e7d52b70a2ade2aac2511243cb`. The integrated source,
tests, frontend, scripts, load harness and dependency files are identical to
the tested task tip. Whole-tree Ruff and formatting passed (265 files).

The change adds project templates, settings, pins/profile replacement,
membership management and ontology upload APIs. Templates expose required
ontologies and known axis defaults. Structural changes stop after the first
submission; prepared edits and imports reject changed project structure
before committing writes. Shared project locks preserve independent draft
concurrency. Guideline references propagate into exports.

Independent source review found two Important concurrency defects: queued
requests could retain revoked management rights, and concurrent member
removal could make member listing fail. Both were reproduced and corrected.
The original reviewer approved the scoped correction with no remaining
findings. Current actor authority is checked after lock waits and held through
commit using ordered actor SHARE/target NO KEY UPDATE locks and project
membership locks. Member listing uses a project-scoped read-only snapshot.

Verification evidence:

- Thirteen authenticated regressions failed before correction: twelve
  unauthorized successful writes and one member-list StopIteration. The same
  thirteen passed afterward in 20.21 seconds.
- The final affected project/scope/admin-user/CLI batch passed 113 tests in
  187.69 seconds, with one expected Windows POSIX-permission skip. It includes
  reciprocal account/member changes, independent drafts, rollback and
  submission/structure races.
- Earlier task verification passed 103 project/import tests, 69 runtime tests,
  four final authenticated capture/replay tests and 15 exact registry tests.
  These overlap; they are not an aggregate unique-test total.
- Ruff, formatting, mypy, OpenAPI drift and generated frontend contracts passed.
  The existing Starlette TestClient deprecation warning remains.

Ontology multipart uploads check the aggregate endpoint-copy limit before
storing files, then retain individual-file store semantics. A valid earlier
file may remain if a later file is invalid; the administration UI must refresh
inventory after failed batches. Framework multipart parsing precedes this
endpoint limit. Atomic document import is a separate Task 6 requirement.

Task 5 rules and later administration tasks remain open. The separately tracked
[administrator-write authorization follow-up](2026-10-15-t3a-admin-authority-review.md)
has also passed focused verification and independent review. No fresh
container/full gate or P9 latency acceptance
is claimed for this task; the final administration gate remains required.
