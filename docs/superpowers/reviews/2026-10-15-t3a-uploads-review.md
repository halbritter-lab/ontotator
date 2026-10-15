# T3a staged upload acceptance

Task 6 is accepted at `bf4ec42bcd861a78e839ee089a20fe4c1b48de86`, integrated
through `2df3929c84e3188fe433d20d0b5ca6e56ebba03e`. Source, tests, frontend,
scripts, load harness, contracts and dependency files match the tested task
tip. Whole-tree Ruff and formatting passed after integration (282 files).

Uploads support T1 bundles and strict UTF-8 text/ZIP files, a stored preview,
confirmed asynchronous commit and discard. Preview changes no project
documents. Commit replans against the complete current document/set inventory,
profile, rules and pins, rejecting stale previews. Per-source apply, upload
status and audit share one transaction; failed status is recorded only after
rollback. Current import permission is checked after serialization waits.
CLI text import and document-scoped proposal provenance are included.

The reviewed pure reader/planner was reused. Import rules remove only violating
proposals while retaining the complete delivered set payload and original
actors, notes, defaulted basis and exact evidence references. Empty sets import
documents only; prohibited nonempty sets refuse the whole import. Legacy T1
import reads each source once and retains its prepared-structure guard.

Independent integration review found three required corrections: native tuple
materialization for existing-set hashing, source ownership for duplicate set
identities, and two missing scope-test registry entries. All are resolved and
the original reviewer approved the scoped fix with no new findings. Canonical
preview metadata now determines new document language/source-text hash, while
each selected set retains its own actual payload, manifest and source blob.

Verification evidence:

- The independent pure review passed 92 tests; integration subsequently passed
  28 focused planner/apply tests including empty-set source actor retention.
- Initial new integration verification passed 35 database/CLI tests after
  correcting a query-result conversion and new-fixture assumptions.
- The broader affected run passed 136 tests, skipped one Windows POSIX case
  and exposed five failures covered by the review corrections.
- Three additional real-reader/API regressions reproduced the source,
  document-metadata and populated-inventory failures before correction.
- Final targeted verification passed 96 tests in 55.46 seconds: all 36 upload
  API cases, all 53 scope checks, four previously failing legacy cases, text
  CLI, structural rollback and repeated-source apply. Earlier unaffected
  passes were retained; no aggregate unique-test count is claimed.
- The reviewer independently passed four real-reader provenance variants and
  the scope-registry completeness check without a database. Final Ruff,
  formatting, mypy, OpenAPI, TypeScript and generated-contract drift passed.

The default aggregate upload limit is 50 MiB before application blob/store
writes; framework multipart parsing happens earlier. No transport/spooling
limit is implied. Assignment-specific document visibility, the complete
backend/browser gate and fresh container acceptance remain later Task 7/10
requirements. P9 latency acceptance remains open.
