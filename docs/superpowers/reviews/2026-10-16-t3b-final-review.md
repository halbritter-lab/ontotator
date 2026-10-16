# T3b final acceptance

All **11 T3b tasks are complete** on `feat/t3b-admin-ui`. The accepted frozen
runtime, frontend, embedded assets and test source is
`ba02ebd787a3e3eb7545278f73a218e873690b9f`. This record and the status update
are documentation-only additions after that verified source.

Navigation, task editor/read-only/leave handling and profile were accepted in the
[navigation record](2026-10-16-t3b-navigation-review.md). Users, one-time codes,
ontologies, projects/settings/members and document uploads were accepted in the
[administration record](2026-10-16-t3b-administration-review.md). Assignment,
distribution, progress, binary exports and proposal provenance, including the
reviewed human-authorship correction, are covered by the
[assignment/export/provenance record](2026-10-16-t3b-assignment-export-review.md).
Every feature bank and integration passed independent specification and quality
review; those accepted banks were preserved rather than re-audited at this gate.

## One complete final gate

Root ran the actual complete local gate, including containers, at unchanged clean
`ba02ebd` using `CHECK_CONTAINERS=1`,
`CHECK_IMAGE=ontocurator:t3b-final-retry` and `CHECK_VITEST_WORKERS=1`.
The native Git Bash command was `scripts/check.sh`. Controller session 14690
closed with **exit 0**; the log ended with **All local checks passed.**
Execution: 2026-10-16 **09:07:52.127021–09:28:52.476793 UTC**, 1260.36 seconds
including controller overhead (script summary: 1259 seconds).

| Verification | Actual result |
|---|---|
| Ruff lint/format, mypy | Passed |
| OpenAPI drift, frontend TypeScript and API drift | Passed |
| Locked wheel build/content checks | Passed |
| Frontend unit/component tests | **828 passed**, 91 files, 142.90 seconds |
| PostgreSQL/backend tests | **1594 passed, 1 expected POSIX skip**, 781.52 seconds |
| Browser tests | **43 passed**, including all four administration journeys |
| Real-stack browser smoke | **1 passed**, 3.4 seconds |
| Container checks | **All nine passed** |

The container checks cover non-root UID1001, read-only root filesystem, writable
data/tmp, dropped capabilities, no published production-app port, application
history/migration privilege restrictions and readiness failure on unavailable
database or pending migrations. The actual stack browser logs in, opens its task,
annotates and submits. Its whole container/smoke stage took 86 seconds.

Wheel SHA-256:
`add0044ca3d528c870ab2ce2268adbf970270e6a13daec874af6ee8bb7ad68ea`.
Ignored actual artifacts: `build/t3b-final-gate-retry/{execution.json,check.log}`.
Recorded final source equals starting source and final git status was empty.
There was no continuation, skipped gate stage or substituted mocked backend.

## Exact-source packaged image

Image `ontocurator:t3b-final-retry`:
`sha256:3a295eac6242bb1c614fa7b803bf7616200883dd50ba965127740900ef068fad`.
Revision label equals the complete accepted source above. Build session 27604
closed exit0 after 43.73 seconds, 09:06:45–09:07:29 UTC. The ephemeral BuildKit
credential was neither printed nor persisted.

Actual installed-image hashes matched **all108 Python files and all31 embedded
web files**, with no extra/missing/mismatched files. Built frontend/dist matched
the committed embedded assets byte-for-byte. Fonts/licenses were retained;
previous web directories were archived before replacement. Evidence:
`build/t3b-final-image-retry/{execution.json,build.log}`.

## Preserved failures and remaining roadmap

The initial gate at `191e67d` really failed: 826/828 frontend tests passed;
backend/browser/container stages were not reached. It exposed an incorrect AI
badge on human-curated annotations and a pre-existing asynchronous tree-test
observation. Narrow corrections `07f331b` and `13db6f9` passed focused tests and
fresh independent reviews before integration, refreshed assets/image and this
complete successful retry. Original failed artifacts remain under
`build/t3b-final-gate`. Earlier administration-test authoring failures and their
preserved traces remain documented separately. None is relabelled as a pass.

T3b completion covers the administration application and its packaged functional
acceptance. **P9 latency acceptance remains open; T7 consumer integrations remain
parked.** Format1.1 is already complete at pin4105; application variants and
translation review are the next T5 work, followed by T4a, T4b and T6b. Isolated
T5 source/pure preparation was authorized during the long gate; its PostgreSQL
and whole-task acceptance still follow the accepted prerequisites. No merge to
main, push, deployment or CI run occurred.
