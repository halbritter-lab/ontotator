# T5 functional interim: local acceptance

The newer, separate [Phase 0 acceptance candidate](phase0-acceptance.md) is prepared on port 18081 and initially stopped to preserve RAM. This document remains the record of the reserved port-18080 environment.

The reserved demo address is **http://127.0.0.1:18080**; that environment is currently stopped and has not been refreshed. Use the separate Phase 0 candidate above for the latest fixes. The remaining sections record its original T5 preparation.
Implementation and main contain the completed T5 functionality; user acceptance
is the next checkpoint before T4.

## Accounts and prepared data

In the main checkout, open the private file
`build/t5-acceptance/demo-ready/credentials.json` for the generated passwords.
It inherits Windows access limited to the local user, SYSTEM and Administrators.

| Account | Role | Starting point |
| --- | --- | --- |
| demo-lead | Lead only | Documents, assignments, progress and exports in t5-acceptance |
| demo-reviewer | Qualified bilingual annotator | Two OPEN translation reviews in My tasks |
| demo-annotator | Annotator only | One OPEN accepted-text annotation assignment |

All cases are synthetic. `synthetic-ready` has passed automatic translation
checks; `synthetic-failed` displays a failed check; `synthetic-accepted` has an
immutable accepted review and is ready for annotation. Six documents comprise
three English sources and three German translations. The automated correction
journey used a separate project and did not consume these user tasks.

## Acceptance steps

1. Log in as demo-lead and inspect the Documents, assignments and progress.
2. As demo-reviewer, open the ready review from My tasks. Compare source and
   translation, edit a marked term, choose Accepted with corrections, enter the
   required clinical-change/category/rationale fields, and submit.
3. As demo-lead, inspect the original and new accepted version, carried proposals,
   pending old/new contexts and review history. Download the review export.
4. Inspect the failed-check review. Confirm an edited text cannot be submitted as
   Accepted unchanged. Save a draft or leave it open for another visit.
5. As demo-annotator, open the accepted-text task, annotate and submit. Inspect
   your own historical submission; another annotator's work must remain hidden.
6. Try language/version selection, comparison and paragraph scrolling. Record any
   issue with account, case, action, observed result and expected result.

Use separate browser profiles or log out when changing accounts. The demo
credentials contain no system-administrator account.

## Tested start, status and stop

Run PowerShell from the main checkout that prepared the demo. The actual
prepared environment and immutable image must be reused:

```powershell
$demo = (Resolve-Path 'build/t5-acceptance/demo-ready').Path
$cfg = Get-Content -Raw (Join-Path $demo 'identity.json') | ConvertFrom-Json
$cfg.environment.PSObject.Properties | ForEach-Object {
    [Environment]::SetEnvironmentVariable($_.Name, [string]$_.Value, 'Process')
}
$composeArgs = @('compose', '--project-name', $cfg.project,
    '--env-file', $cfg.env_file, '-f', $cfg.base_compose, '-f', $cfg.override)
& docker @composeArgs ps --all
```

Stop while retaining data:

```powershell
& docker @composeArgs stop
```

Start again without rebuilding or seeding:

```powershell
& docker @composeArgs up -d --no-build --wait
```

`commands.json` in the same directory retains the exact argument vectors.
Normal restart needs no seed or build token; keep the prepared unused-build-token
file because Compose reads its declared path. Do not use `down --volumes` for an
ordinary stop. The real stop/start test preserved all checked state and blob
bytes, with both named volumes unchanged:

- `ontotator-t5-acceptance-ready_postgres-data`
- `ontotator-t5-acceptance-ready_ontotator-data`

Runtime/source: `e72e2fa10c8f9527814ffb7e0f9127867ae5d26b`.
Image: `sha256:f89b1437fcc36f46eb5cc040c5d42ff6c664cfcc2e4dd9c90ae88d08a1612ff1`.
Prepared project: `ontotator-t5-acceptance-ready`; app18080 is bound to loopback.
PG15543 is configured for loopback, but Docker reports no active PostgreSQL host
publication after restart. The app uses the healthy internal database connection.
Do not reuse the separately retained failed `demo-final` preparation.

P9 performance acceptance, T4a/T4b and T6b remain open; T7 is parked. This local
functional review uses small synthetic data and does not establish load targets.
