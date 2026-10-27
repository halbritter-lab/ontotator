# T3a administration backend final acceptance

Accepted on 2026-10-16 at runtime and bundled-asset source
`6458b340159ef83999a6f4c2ae1e031293defa89`. All ten T3a tasks are complete.
The implementation remains on `feat/t3a-admin-backend`; no main merge, push or
deployment occurred.

The earlier task records cover schema/policy, accounts, current administrator
authority, projects/settings/members, project rules, staged uploads, assignment
visibility, reproducible distribution and progress/export jobs. Final assembled
source review found one missing browser-harness assignment opt-out. Its narrow
test-only correction passed independent review and eight registered-route tests.

The first final browser run also exposed a legacy presentation mismatch: document
metadata now correctly preserves stored zero-based, sparse or nullable positions,
while the old dashboard expected human ordinals. The frontend now copies that
list into one-based presentation order without sorting or changing API objects.
Three actual App/editor regressions failed before the fix and passed afterward;
independent source review and all three independent regressions passed. Backend
position semantics and existing browser assertions were retained.

## Exact-source verification

All required local-gate stages passed at the same unchanged source:

- Ruff, format, mypy, OpenAPI drift, TypeScript typecheck/API drift and lock/wheel
  checks passed. Wheel SHA-256:
  `c199648a58b67c30f719a24a7b585c7903d645c9600816e9b56d70609172f655`.
- All 444 frontend tests passed in 55 files.
- All 1,539 backend tests passed in 699.48 seconds; the sole skip is the existing
  POSIX file-permission check on Windows. The existing Starlette/httpx deprecation
  warning remains.
- All 39 Playwright browser scenarios passed in the completed continuation.
- All nine container checks passed: non-root execution, read-only root filesystem,
  writable data/tmp, dropped capabilities, no published application port,
  submission-history protection, separate migration authority and both database
  readiness refusal cases.
- The real Docker-stack browser smoke passed: login, open assigned work, annotate
  and submit.

The original `CHECK_CONTAINERS=1` runner reached the browser stage after all
backend/frontend/static checks passed, then suffered a Chromium target crash and
Windows `0xc0000142 STATUS_DLL_INIT_FAILED` worker-start failures. Its controller
did not leave a final exit record; it is not represented as a successful single
script invocation. The source and image remained unchanged. After a successful
standalone headless-browser probe, a guarded continuation checked the exact Git
HEAD, clean worktree, original passing log/hash and image ID, then reran the full
39-case browser stage and the complete container/smoke stage. Both exited zero;
the continuation exited zero with identical starting/final source. Passing
backend/frontend stages were retained as actual same-source evidence.

Local evidence is retained under `build/t3a-final-gate-retry/` and
`build/t3a-final-gate-resume/`. The interrupted browser artifacts and recovery
record are preserved separately; the continuation records the original log hash,
commands, timings, exit codes and source identity.

## Runtime image

The refreshed embedded frontend contains 31 assets, including font licenses.
Its files match the frontend build byte-for-byte. Fresh image
`ontotator:t3a-final-retry` has ID
`sha256:e32a5fa3ea217e02249f10c52050598c380382b1ecaf67c0acb260004aeb981c`
and revision label equal to the accepted source above. An actual installed-image
hash comparison matched all 107 Python files and all 31 web files, with no missing
or extra files. Build/source evidence is in `build/t3a-final-retry/`.

This accepts T3a functional implementation and final gate coverage. T3b UI
integration and its small compatibility additions have their own branches,
reviews and pending checks; they are not included in this image's acceptance.
P9 latency acceptance remains open at the original workload, resources and
targets. T7 is parked. Ontospan format 1.1 is complete; later variant/translation
application workflows remain separate roadmap work.
