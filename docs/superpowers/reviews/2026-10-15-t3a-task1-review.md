# T3a project-key rename acceptance

Runtime change `eaaf1514e5020c4cb6614bbebd2354c7505a371f` renames workspace/API
project identifiers and routes to `project_key`. Stored v2 seed fields retain
their format. Historical nested workspace keys accept `package_id` on input;
new output uses `project_key`. Component-based persisted identities and mutation
receipt lookup remain unchanged. Frontend, browser helpers and load callers
follow the new routes; embedded assets were rebuilt.

An independent task review approved the change with no findings. A separate
documentation correction, `bf5ead0eb9bad539a7bf55ea88f5bc5a1ef2a3a4`, formats
Python examples in ten imported plans/specifications. Scoped review independently
confirmed unchanged Python ASTs, prose and non-Python fences. The first full gate
stopped on those documentation formatting checks; its failure evidence is retained.

The complete local gate then passed at exact source `bf5ead0`, with unchanged
final source, on 2026-10-15 at 18:26:05 UTC:

- 1,053 backend tests passed; one expected POSIX skip.
- 436 frontend tests passed in 53 files.
- All 39 Playwright browser cases passed.
- Ruff, formatting, mypy, OpenAPI, TypeScript/API drift, lock and wheel checks passed.
- Elapsed time: 678.62 seconds.
- Wheel SHA-256: `660ab8e2e5607ae02dc9e733187d5fe1b147abf2be3560d5665f73eb27f70521`.

Local evidence is retained in
`build/t3a-task1-gate-final/{check.log,execution.json}`. This task ran the normal
local gate; a fresh administration container/image gate belongs to Task 10.
Existing Starlette/React warnings remain unchanged. This acceptance makes no
claim that the separate P9 latency targets pass.
