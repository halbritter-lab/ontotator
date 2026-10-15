# T2e final source review and outstanding acceptance

Whole-branch review covered `bd86fb0..0d51f54`: health, production settings,
Docker/Compose, migration targets, disposable container checks, real seeded
browser smoke, representative load harness, operations instructions, runtime
ontology discovery and the two contained performance fixes. It was independent
of the task reviews. No CI, push, main-branch merge or deployment was performed.

## Finding and resolution

The review found one Important defect, no Critical defects and no additional
actionable Minor defects. Readiness inferred ontology availability from absence
of failure records, although startup registration and preload could silently
skip a missing persisted pin. Altered blob bytes could also register under a
different digest. Consequently `/readyz` could return 200 for an unusable pin.

Fix `a370c9c` snapshots required pins, closes/disposes the independent health
database connection, then discovers/preloads required content-addressed files.
Readiness requires every pin to have a loaded service. Missing/hash-mismatched
files can recover after repair; valid hot-added pins load without search or
restart. Already-loaded services require no probe-time file hashing or index
rebuild. Existing coalescing, short cache, HTTP deadline and boolean-only public
responses remain. Unused malformed ontologies remain tolerated.

Regression evidence: missing/corrupt startup and hot-add cases failed before
the fix. Afterward, 48 focused health/store/registry/construction tests and Ruff,
formatting, mypy and whitespace checks passed. Cold-load coverage checks that
the health connection is released, the deadline/liveness hold, and evaluation
remains coalesced. The original whole-branch reviewer approved the scoped fix
and identified no new breakage. It was integrated as `3ba229c`.

**Source review is approved after this fix. Final acceptance remains open.**

## Decisions retained for review

- The explicit owner/runtime role split governs bootstrap and migration, with
  separate credential directories; runtime never receives owner credentials.
- Production DB startup failure exposes a health-only, fail-closed app. Recovery
  requires restarting the normal server; direct development app construction
  retains its existing startup failure behavior.
- BuildKit passes the private dependency credential through a temporary secret
  and credential helper. It is absent from Git URLs/layer instructions; local
  build credentials are cleared afterward.
- Public dev-only file configurations replace inline Compose configurations
  because the tested read-only Compose runtime rejected inline content.
- Fixture bytes stream through `exec -T` into tmpfs because `compose cp` failed
  against the tested read-only root. Production hardening is retained.
- The failed initial P9 result remains recorded. Separate scoped fixes deduplicate
  pinned service construction, share data only for exactly equal captured
  resources, resolve editing services before mutation transactions, and batch
  status facts without changing immutable-history or authorization semantics.
- Existing npm development-tool advisories require an unrelated major toolchain
  upgrade and remain tracked. The production image ships Python/static assets,
  with no Node runtime/dependencies. Existing Starlette/httpx warnings remain
  visible. No new GitHub Actions are added, per the user's no-CI decision.
- One final complete gate on the reviewed merged T2e/T6a descendant will cover
  both source sets. Its actual tested commit/image must be reported; this is
  not a claim that separate parent-commit gates were run.

## Acceptance and limits

[The measurement report](../../operations/load-test-2026-10.md) retains both
failed P9 runs, workload, exact images/resources and observations. The second
run completed with no request failures, but all four p95 targets still failed.
Observed CPU saturation does not identify a function-level hotspot; temporary
diagnostic profiling precedes any further optimization. No resources, pools,
workload or thresholds have been relaxed.

The final rebuilt-image/container/full local gate is pending. Earlier-image
checks and focused correctness tests do not validate that later image or prove
latency acceptance.

The review explicitly leaves these bounds visible:

- Production TLS/DNS/proxy/host provisioning belongs to deployment infrastructure;
  no live deployment or paired backup/restore/recovery drill was performed here.
- Review-confirmation and submission still have analogous cold service-resolution
  paths inside their mutations. They were outside the contained P9 editing fix
  and measured workload; general freedom from cold-build transaction retention
  has not been established.
- Many distinct translation conditions, larger histories/corpora and arbitrary
  ontology counts exceed P9. Active service references can outlive the LRU, each
  worker owns a registry, and batch status still validates submission history.
- Readiness samples pins and honors immutable content-addressed storage. It does
  not continuously rehash loaded files to audit out-of-band disk changes.
- Downloaded artifact supply-chain attestation was not independently performed.
  Smoke ZIP generation/validation and final image behavior remain executable
  gate responsibilities, rather than claims from source inspection.
- Parallel UI redesign and later administration/workflow/variant plans are
  separate deliverables. This review does not establish their completion.
