# Phase 0 B0.5: Acceptance candidate implementation plan

> **For agentic workers:** Use superpowers:executing-plans for the sequential operational tasks below. Checkboxes track execution.

**Goal:** Prepare an isolated, verified acceptance candidate containing the usability fixes, while preserving the user's existing T5 acceptance environment.

**Architecture:** Build from a clean, committed candidate and retain its image digest and source SHA. Use a new Compose project, fresh volumes and a separate loopback port. The reserved `http://127.0.0.1:18080` stack, its identity files and its volumes remain unchanged. Replacing that demo or merging the candidate requires separate user approval.

**Tech stack:** Docker Compose, existing Dockerfile, `scripts/container_check.py`, `scripts/seed_t5_acceptance.py`, pytest and Playwright.

**Spec:** D1-D5, D16 and re-anchor decisions in `2026-10-17-next-agentic-work.md`; scope and order in `2026-10-17-phase0-priorities.md`.

## Global constraints

- This plan supersedes the old B0.5 wording to rebuild the reserved demo in place.
- No seed, submit, save, migration, restart or image replacement against port 18080 or project `ontocurator-t5-acceptance-ready`.
- No secrets in terminal output, docs or commits. Existing credential files need not be opened for this task.
- Docker must run; no GitHub Actions. Run `bash scripts/check.sh` from Git Bash, not WSL's `C:\Windows\system32\bash.exe`.
- Candidate startup requires the local implementation review and complete gates to pass. On 2026-10-18, the local immutable image was prepared alongside the final gate after complete functional evidence and a catalog-only correction; this scheduling ruling risked only a rebuild and changed no demo. Gate12 subsequently passed before candidate startup. Merge/push approval remains outstanding; a local branch candidate is sufficient for a separate preview.

## Review focus

1. Project, ports and volumes must be distinct from the reserved demo: Task 2 identity check.
2. A label or tag alone is insufficient: Task 1 checks source SHA and immutable image digest.
3. Seeder rejects populated state: Task 2 treats a partial seed as failure and preserves diagnostics privately.
4. Automated tests must not consume the candidate's user acceptance assignments: Task 1 tests use disposable fixture servers.
5. New D16 behavior changes the old acceptance steps: Task 3 documents roles and own-history policy precisely.

## Task 1: Verify the candidate and image

**Files:** Read `Dockerfile`, `docker-compose.dev.yml`, `scripts/check.sh`, `scripts/container_check.py`. Create `docs/superpowers/reviews/2026-10-17-phase0-verification.md` when execution occurs. No source change is expected.

- [x] Run the full local gate once on the combined implementation and record commit SHA, command, exit status and check summary. The completed gate used `--maxWorkers=4 --minWorkers=1`; subsequent shared-RAM runs default to two workers, minimum one, under the later user constraint.
- [x] Build using the existing BuildKit secret mechanism and an OCI `org.opencontainers.image.revision` label containing the exact source SHA. Reuse the established local credential mechanism; never print a token or add it to a URL or command argument. If no build secret is configured, record the missing prerequisite instead of altering private-demo configuration.
- [x] Resolve the built image to its immutable `sha256:` identifier. Run `uv run python scripts/container_check.py --image <digest> --smoke`; this harness owns its separate temporary project. Record the digest and actual result.
- [x] A format dependency commit unavailable remotely prevents a reproducible Docker build. Complete local ontospan testing first and record this boundary; do not push a dependency to bypass the user's push approval rule.

**Acceptance:** Local checks pass, source/image identities match, container checks operate only on their own project. A skipped image build is explicitly not reported as an accepted demo.

## Task 2: Prepare a separate acceptance candidate

**Files:** Read `scripts/seed_t5_acceptance.py`; create only ignored files under `build/t5-acceptance/phase0-candidate`. Reuse the existing seeder unchanged unless a verified defect requires a separate tested fix.

- [x] From a clean checkout of the candidate commit, check that loopback ports 18081 and 15544 are free and the project `ontocurator-t5-acceptance-phase0` does not already contain data. If occupied, choose free ports and record them in the new identity; never stop an unrelated service.
- [x] Run `uv run python scripts/seed_t5_acceptance.py prepare --project ontocurator-t5-acceptance-phase0 --image <digest> --source-sha <full-sha> --app-port 18081 --pg-port 15544 --output-dir build/t5-acceptance/phase0-candidate` with verified actual values. `prepare` requires a clean tree; the user's untracked `.impeccable/critique/` means an isolated clean checkout is appropriate.
- [x] Read the candidate's generated command vectors privately and start exactly that project with its pinned image, environment file and override. Validate all services and named volumes belong to that project. Run `uv run python scripts/seed_t5_acceptance.py seed --output-dir build/t5-acceptance/phase0-candidate` once on that fresh stack.
- [x] Confirm service health and fixture preparation from the candidate's recorded result without opening or submitting the user's acceptance tasks. No full browser journey runs against this candidate after seeding.

**Acceptance:** Candidate identity records its actual port, source, image and distinct volumes. The port-18080 demo retains its prior stopped state with the same container, data and image identities. Seeding success is distinguished from user acceptance.

## Task 3: Update acceptance instructions

**Files:** Modify `docs/operations/t5-interim-acceptance.md`; create `docs/operations/phase0-acceptance.md` for the separate candidate. Do not overwrite historical image/source assertions with unverified values.

- [x] Document the candidate URL, source/image digest, private credential-file location, role-specific checklist and exact generated startup identity. Keep the original T5 document as the record of the reserved environment, with a link to the candidate.
- [x] The candidate checklist covers: source/translation review with coupling opt-in and disabled while editing; confirm-dialog submission; independent annotation with no general version browser; own submissions according to P0-A; defaulted-axis warning/jump; spanless note/project restriction; unresolved-review export flag and note; per-reviewer re-anchor re-create/dismiss.
- [x] Reference automated browser evidence from `frontend/browser/variants.spec.ts`, `translation-review.spec.ts`, `reanchor.spec.ts` and the new decision/project-rule journeys in B0.2. Do not add unit tests merely for documentation edits. If seeding code changed, run `uv run pytest tests/test_seed_t5_acceptance.py tests/test_container_check.py -q` as well.
- [x] Run `git diff --check`, inspect all links/paths and commit only the documentation with `docs: record phase 0 acceptance candidate`.

**Acceptance:** Instructions describe the actually prepared candidate and its limitations. User acceptance remains pending until the user performs it. No merge, push or replacement of the original demo is implied.


## Completion evidence (2026-10-18)

Gate12 passed all required checks. The immutable image and real disposable container contracts/smoke passed. The separate candidate was prepared from clean seed/tooling revision `87367d8bd963646d7b4ffd05f7c3f9a13bc5b8e1` using runtime revision `001c6729487eee532647f80aa6d0e3442019d1f7`. Startup and seeding exited 0, readiness returned 200, and all intended user tasks remain open.

Resource ruling: the user requested RAM headroom for another process. After validating the candidate, stop only this new Compose project normally and retain its volumes; leave it start-ready rather than running persistently. Cost: one documented start command before acceptance. The reserved demo was not started or changed. See [the actual candidate instructions](../../operations/phase0-acceptance.md) for identity, credentials location, role setup and startup. User acceptance remains pending.
