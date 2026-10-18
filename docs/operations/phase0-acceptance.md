# Phase 0 local acceptance candidate

The separate candidate is prepared for **http://127.0.0.1:18081**. It was started, seeded and health-checked successfully, then stopped to preserve RAM for the user's other process. Start it with the commands below when ready. It contains the approved Phase 0 annotation, review, export and text-correction changes. User acceptance is pending. The older T5 environment on port 18080 remains separate and was not changed.

## Identity and credentials

- Worktree: `C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation`.
- Source revision: `001c6729487eee532647f80aa6d0e3442019d1f7`.
- Image: `sha256:9c42d4545a3c1cb4331b513b77160edfda3d78574a4fc849140454687167370a`.
- Seed/tooling revision: `87367d8bd963646d7b4ffd05f7c3f9a13bc5b8e1`. Later commits update documentation only.
- Compose project: `ontocurator-t5-acceptance-phase0`.
- Preparation directory: `build/t5-acceptance/phase0-candidate` within that worktree.
- Private account passwords: `credentials.json` within the preparation directory. Do not copy them into issues or commits.
- `identity.json`, `commands.json` and `seed-result.json` retain the exact startup identity and seed evidence.

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

The complete local gate exited 0: 1,305 frontend tests, 2,183 backend tests (one Windows POSIX-permissions skip), and all 87 browser cases passed. Static/type/API/wheel checks passed. The later local-check harness passed independent review and its real static phase, including 26 focused regression/preflight tests. Disposable packaged container contracts and the real annotation smoke passed.

Candidate seeding exited 0 and verified six documents, two open translation reviews and one open annotation assignment. `/readyz` returned 200 before the normal stop. Candidate volumes and private identity/credentials are retained. The reserved older demo's container IDs, image IDs, stopped state and mount identities match the recorded baseline.

Browser evidence includes `decision-semantics.spec.ts`, `variants.spec.ts`, `translation-review.spec.ts` and `reanchor.spec.ts`. Tests used disposable fixture services, not these acceptance assignments. See the [Phase 0 verification record](../superpowers/reviews/2026-10-17-phase0-verification.md).

Report issues with account/role, document, action, actual behavior and expected behavior. This candidate establishes functional review with synthetic data; later workflow decisions D6–D15 remain undecided.
