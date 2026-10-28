# Phase 0 local acceptance candidate

The separate candidate at **http://127.0.0.1:18081** includes the completed Phase 0 review fixes from pushed source `0e9271a`. Its image was refreshed while preserving existing data, credentials, volumes and acceptance tasks; it was not seeded again. It was subsequently started at the user's request and is running for guided manual acceptance. The older T5 environment on port 18080 remains stopped. For a later restart, start Docker Desktop and use the commands below.

Manual acceptance is in progress. The user has already created and submitted annotations and reopened an assignment. Preserve those edits and collect feedback before implementing changes.

## Identity and credentials

- Worktree: `.worktrees/phase0-implementation` (relative to the repository root).
- Runtime source revision: `0e9271aeb5310c39a7497dc97e0576d6de927628`.
- Image: `sha256:74b37290e03e802b281ef0d6dc8639891152f8e84b49e3dba190b8e8950c928d` (local tag `ontotator-phase0:reviewed`; startup uses the immutable ID).
- Original seed/tooling revision: `87367d8bd963646d7b4ffd05f7c3f9a13bc5b8e1`. This identifies the initial fixture preparation, not the current application image. The refresh from `001c6729` to `0e9271a` includes application fixes; subsequent acceptance-documentation changes do not change runtime code.
- Compose project: `ontotator-t5-acceptance-phase0`.
- Preparation directory: `build/t5-acceptance/phase0-candidate` within that worktree.
- Private account passwords: `credentials.json` within the preparation directory. Do not copy them into issues or commits.
- `identity.json` and `commands.json` describe current startup. `seed-result.json` remains historical initial-seed evidence; `refresh-result.json` records the updated image, readiness and preserved database contents.
- Refresh evidence and the pre-refresh database backup are private under `build/t5-acceptance/phase0-review-refresh`. Do not commit those files or replace them with the older demo's identities.

| Account | Role | Prepared starting point |
| --- | --- | --- |
| demo-lead | Project lead | Documents, assignments, Settings, Progress and Export |
| demo-reviewer | Bilingual annotator | Two open translation review tasks |
| demo-annotator | Annotator | One open accepted-text annotation task |

The existing seeder creates six synthetic document variants. It prepares one accepted-unchanged translation to make the annotation assignment available. The two remaining translation reviews and the annotation assignment have not been consumed by automated acceptance tests. It does not pre-seed an annotation adjudication or text-correction journey.

## Prioritized acceptance checklist

1. **Prepare review access.** As `demo-lead`, open the `t5-acceptance` project's **Settings → Members**. Add **Adjudicator** to `demo-reviewer`, retaining **Annotator**. This is additional acceptance setup; the seed only supplies translation-review access. Use separate browser profiles, or log out between accounts.

2. **Annotate and check project modes before submitting.** As `demo-annotator`, open the accepted German **Annotation** task using **Start**. Mark text and choose a term; inspect the axes. Keep the draft open. As lead, change **Findings without a text span** among prohibited, required reason and optional reason, saving each mode. Reload the annotator's task after each settings change. Prohibited mode blocks spanless submission; required mode needs a nonblank annotation reason; optional mode permits no reason. For an existing spanless draft result, check the next submit dialog applies the newly selected rule and its repair link selects the finding. Finish repairs, choose a final mode and submit once using the whole-document checkbox. Reload and inspect that exact own record under **Previous Submissions**. If already submitted before mode checks, have lead reopen the assignment first.

3. **Correct the ready translation.** As `demo-reviewer`, open the **Translation review** task for **ready-translation** (not the already submitted accepted case). Check coupled scrolling in a read-only presentation, then turn off **Show changes** to edit. Replace **Krampfanfälle** with **Epileptische Anfälle**, leaving **Hypotonie** unchanged. Select **Accepted with corrections**, provide a rationale, and set the clinical-change fields truthfully (a clinical change also requires a category). Submit and note the newly created corrected version. The source and original translation remain historical versions.

4. **Create the annotation Review only after carry-over finishes.** As lead, find the new corrected German variant in **Documents** / its case and inspect its offered proposal version. Wait until carried proposals and pending findings are available. Select that exact corrected document, choose **Assign …**, set **Task = Review**, select `demo-reviewer` and **Assign**. The reviewer must first open this assignment after the carry/reanchor output exists. If checking the optional second queue in step 6, prepare that assignment now before opening either task. In the review task, verify **Needs review after the text change** is populated. Use **Re-create here**, select the corrected phrase and save the finding, or **Dismiss with reason**. **Finish & Submit Case** must count and block unfinished pending items and return focus to their queue. Changing or deleting a replacement makes its saved resolution pending again.

5. **Unresolved result and export.** In that same Review task, mark the valid carried **Hypotonie** proposal **Unresolved**, enter a reviewer note and reload to verify persistence. Decide every other ordinary proposal and resolve every pending correction item before submitting. When a result has defaulted axis values, check the warning and **Review defaulted annotations** navigation. Submit. As lead, use **Export → Annotation results → Create export → Download**. Inspect the downloaded ZIP: the Hypotonie result has a separate `review_resolution` outcome `uncertain`, the exact reviewer note and reviewer, and its original clinical assertion remains `present`. An unknown/obsolete term or incomplete required clinical data must be repaired or rejected before submission. Reviewer-flag bundles cannot currently be re-imported into proposal storage without metadata loss; import must explicitly refuse them.

6. **Optional independent second queue (set up before step 4).** Before either reviewer's first open, grant `demo-lead` Adjudicator while retaining Project lead and assign that account a separate **Review** task for the same corrected document. Resolve an item as `demo-reviewer`; reload the other account's task and confirm its own item remains pending. No fourth account is preseeded.

Additional annotation-review roles and assignments are explicit acceptance setup; the seed does not consume these journeys. Automated isolated tests cover the flows. User acceptance remains pending.

During those journeys, check the review fixes explicitly:

- At 1024 px, the curated-list heading remains readable and the submission repair link focuses the relevant evidence, reason or term control. A server rejection after changed rules offers **Reload current rules**; reload before continuing repairs.
- Below 1100 px, **Couple scrolling** is disabled and unchecked with a width explanation. Widening restores a previously enabled choice in a read-only comparison. Reviewer notes accept multiple lines.
- Before saving **Re-create here**, compare the displayed original clinical axes and default markers. The replacement must preserve them; a subsequent deliberate axis edit is separate. Old context and technical IDs can be expanded when needed.
- Proposal details identify defaulted axes and explain **Edit & Replace** followed by explicit axis confirmation. After recreating/resolving, finish the queue and submit as described above.

## Start and inspect this candidate

Run PowerShell in the implementation worktree:

```powershell
$candidateDirectory = (Resolve-Path 'build/t5-acceptance/phase0-candidate').Path
$candidateConfig = Get-Content -Raw (Join-Path $candidateDirectory 'identity.json') | ConvertFrom-Json
$candidateConfig.environment.PSObject.Properties | ForEach-Object {
    [Environment]::SetEnvironmentVariable($_.Name, [string]$_.Value, 'Process')
}
$candidateComposeArgs = @('compose', '--project-name', $candidateConfig.project,
    '--env-file', $candidateConfig.env_file, '-f', $candidateConfig.base_compose, '-f', $candidateConfig.override)
& docker @candidateComposeArgs ps --all
& docker @candidateComposeArgs up -d --no-build --wait
```

For a normal stop, use `& docker @candidateComposeArgs stop`; retain the volumes. Do not seed again or use `down --volumes` for a restart. Do not substitute the older demo's identity files.

## Verification

The reviewed source passed all required stages: 1,320 frontend tests, 2,209 backend tests (one expected Windows POSIX-permissions skip), 88 browser tests, static/type/contract checks and wheel validation. The browser stage was rerun after updating one obsolete assertion; the initial combined invocation did not exit 0.

The refreshed image's OCI source label and all 31 packaged frontend paths/hashes match the reviewed source and build. `container_check.py --image <immutable-id> --smoke` exited 0, including the real login/annotation/submission journey and container permission/readiness checks, entirely on a disposable stack.

Initial seeding verified six documents, two open translation reviews and one open annotation assignment. The refresh backed up the existing database and verified unchanged row counts and content hashes for all 36 application tables before and after startup. `/readyz` returned 200. Existing data-volume identities, credentials and initial seed records are retained. The reserved older demo's container IDs, image IDs, stopped state and mount identities match the baseline exactly.

Browser evidence includes `decision-semantics.spec.ts`, `variants.spec.ts`, `translation-review.spec.ts` and `reanchor.spec.ts`. Tests used disposable fixture services, not these acceptance assignments.

Report issues with account/role, document, action, actual behavior and expected behavior. This candidate establishes functional review with synthetic data; later workflow decisions D6–D15 remain undecided.
