# Task 2 implementation report

## Delivered behavior

Packages now pin their search resources at first package-specific ontology use.
The package-aware registry resolver is shared by search, tree, term labels,
workspace term status, editing, review confirmation and submission validation.
Later ambient translation uploads still update global ontology management and
new packages, while captured packages keep their original resources and language
options. The case editor obtains its languages from a package-scoped endpoint.

The existing selected-language fitting change from commit `589d505` is retained.
The algorithm identity is now `selected-language-char-wb-tfidf/2`; search index
identities include the actual selected corpus, relevant translation identities,
index configuration and execution runtime. Disabled translation resources do
not change English-only ranks, scores or fitting identity. Language-specific
indexes retain the prerequisite's four-entry LRU; package services have an
eight-entry LRU.

## Schema and resource lifecycle

Optional `manifest.search_conditions` contains one condition per distinct
ontology digest, including valid unused declarations and aliases sharing a
digest. Each `ontotator-search-condition/v1` condition records:

- Canonical `condition_id`, covering every condition field except itself.
- Bound ontology SHA-256 and translation filename, digest, languages and path.
- Index configuration, ranking and display-shuffle algorithm identities.
- Captured application version, actual artifact/source digest and artifact kind,
  plus Python, NumPy, SciPy and scikit-learn versions.

Translation resources use `search-resources/<sha256>/<filename>`. Loaded
translations retain the exact bytes parsed, including BOM bytes. Parsing uses a
copy of those bytes, so capture cannot reread a later replacement under the same
global filename. Package services rebuild only from captured files and compare
their parsed filename/digest/languages to the declarations.

New events and results record `search_condition_id`, `execution` (current index
configuration/runtime, fitting languages and request size) and `runtime_drift`.
Imported condition metadata and historical event execution identities survive
roundtrip unchanged. Old events retain absent/nullable capture metadata and are
never retrospectively attributed to the current runtime. Pinned bytes do not
promise numerical equivalence under changed software; explicit execution drift
records that boundary.

Runtime identification hashes shipped Python sources, including local changes.
Frozen builds without those files hash the executable artifact; bytecode-only
Python deployments have a Python-artifact fallback. Standalone packaging now
includes the additive SQL resource and explicit NumPy/SciPy/scikit-learn
distribution metadata; focused packaging argument/wheel-content tests cover
these requirements. Root owns the actual standalone smoke test.

## Persistence, validation and isolation

An additive/idempotent v4 `package_search_conditions` table stores captures.
Captured resource bytes use the existing package resource table. Original
`packages.manifest_json`, source manifest hashes, profiles, annotation snapshots
and histories are untouched. Both generated export paths attach captures and
all declared resources; independent exports project conditions/resources with
the projected task profile. Raw repository exports also attach captures, while
the export service requests the immutable original manifest view for origin
hash calculation.

Archive reader and writer validate condition hashes, complete distinct-digest
ontology coverage, content-addressed paths, translation names, resource hashes,
declared resource sets, per-translation size limits and event bindings. Existing
archive traversal/symlink and total compressed/uncompressed limits remain in
force. Event validation rejects unknown conditions, contradictory runtime drift
and fitting-language metadata. Import parses captured translations before
database commit. External ontologies retain the existing hash-pinned external
resource requirement; root owns the matching workflow/format documentation.

First-use capture reads services under the registry change lock, releases that
lock, then performs an insert-once database transaction. Concurrent captures
use the first committed condition set. Term mutations and submission/review
operations capture before entering their draft write transaction. Pinned
service publication never replaces ambient registry services.

## Additional review integrity correction

The Task 1 reviewer identified a supplied `Submission.scope` integrity gap.
Six regressions first demonstrated accepted scope mode/identity/layer and
checked-layer tampering. Reader validation now checks supplied scope against its
origin and the current profile's allowed layer lists, checks checked-layer
membership/duplicates, and preserves `scope=None` legacy handling. It compares
the origin scope ID directly rather than recomputing it from an independently
projected profile. Root's scoped Task 1 re-review approved this correction.

## Verification

RED regressions demonstrated ambient-upload mutation, missing exported capture,
missing package language endpoint, missing historical runtime capture,
selected-language identity ambiguity, scope tampering and standalone packaging
omissions. Subsequent focused checks cover fresh-workspace imports without
ambient translations, historical/current runtime separation, restart after
global file removal, concurrent first capture, independent resource projection,
unused declarations/digest aliases, resource tampering and raw repository
export completeness. Older tests intentionally expecting active packages to
follow ambient mutations were updated to the documented capture boundary.

Final verification:

- Targeted backend/API/search/tree/import/export/storage/review/packaging suites:
  **296 passed** (one existing Starlette/httpx deprecation warning).
- Full frontend unit/component suite: **315 passed across 33 files**.
- Whole-repository Ruff lint: passed; Ruff format check: 141 files formatted.
- Mypy: passed for all 56 application source files.
- Frontend TypeScript typecheck: passed.
- OpenAPI export check and generated TypeScript API drift check: passed.
- `git diff --check`: passed.

Root's independent full backend run found two outdated tests: imported review
revision was incorrectly expected to reset to zero, and a repository export spy
did not accept the new optional original-manifest-view keyword. Root owns those
test adjustments and the ensuing full verification. They are outside this
task's targeted tests; no implementation failure was reported by that run.

Root owns full-backend acceptance, browser acceptance, rebuilt embedded assets,
release/standalone packaging and frozen runtime smoke verification. This task
did not run `npm ci`, browser builds or release builds. Existing frontend React
act warnings and backend Starlette/httpx deprecation warnings were observed;
they are unrelated to this change.
