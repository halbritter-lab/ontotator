# Phase 0 manual acceptance findings

The guided manual acceptance session is in progress. The user wants to collect and discuss findings before changing the interface or behavior. This is the running record of observations, confirmed working paths and remaining checks; it is not a redesign approval or a completed acceptance.

## Start here in the next session — handoff, 2026-10-18

**Subsequent authorization, 2026-10-18:** The user explicitly requested pushing this completed record on a new branch, agentic repository analysis with Sol 6.1 at high effort, a full-protocol Impeccable analysis, an efficient implementation plan, and review of that plan against findings and repository by Claude Code Opus at high effort. This supersedes the local-only restriction for these documentation/analysis/planning artifacts. It does not authorize implementing application changes or altering the live demo. The earlier collection instructions and Git history below describe the state before this new request.

This document is the authoritative handoff for the manual acceptance round. Read this section, the current checkpoint and the relevant findings before acting. The chat transcript is not needed to resume. Detailed findings retain IDs F01–F33; those are stable references, not 33 independently confirmed bugs. F09 and F18 are clarified initial suspicions, and several IDs describe related usability problems.

**Authoritative local file:**

```text
C:\Users\jan-p\Development\ontocurator\.worktrees\phase0-implementation\docs\superpowers\reviews\2026-10-18-phase0-manual-acceptance.md
```

The root checkout on `main` remains older. The completed record was published on the new branch `feat/phase0-acceptance-plan` in commit `14b5b63`; use that branch when opening it on GitHub. Do not overwrite this worktree copy with the old main-branch record. Work in `C:\Users\jan-p\Development\ontocurator\.worktrees\phase0-implementation` when updating this record.

Planning follow-up: [repository analysis](2026-10-18-acceptance-sol61-analysis.md), [full-protocol Impeccable analysis](2026-10-18-acceptance-impeccable-analysis.md), and [consolidated implementation plan](../plans/2026-10-18-acceptance-remediation.md). These are planning artifacts; the observed runtime state below is unchanged.

### Latest user request and boundaries

- The user requested a complete single-document handoff before starting a new session. Finish recording and consolidating this round first. Do not start implementation, redesign or a new demo setup from this request.
- Collect and discuss before changing application behavior. Source inspection and read-only verification have supported the findings; application fixes have not been made during this collection round.
- Immediate product priority: a smooth HPO workflow. A realistic full HPO and optional official translated search labels matter. Additional ontologies need concrete examples later; do not expand the immediate scope into a multi-ontology demo.
- Keep subsequent notes local. No commits, merges or pushes without a new explicit request. The user objected to committing every interaction.
- Continue in German and guide a few concrete actions at a time. Whenever an account switch is requested, include its username and password in the chat, obtained from the private credentials file below. Do not put passwords in repository documents.
- Keep the new demo available; preserve all user edits, submissions and Docker volumes. Do not reseed, reset, delete, silently repair demo data or rebuild/replace the running candidate during collection.
- Current authorization covers this documentation handoff. A compact consolidated work list and concrete HPO workflow proposals were suggested as a subsequent discussion, but the user asked to complete this record first. Their observations are requirements/evidence, not approval of any particular UI design.

### Current application state

| Item | State at handoff |
| --- | --- |
| Demo | http://127.0.0.1:18081, project t5-acceptance / T5 synthetic acceptance |
| Current user/view | Last guided account was demo-lead, in Case synthetic-ready / Compare, reached through ready-translation~de~v2 |
| Initial annotation task | accepted-translation in synthetic-accepted; annotated, submitted, reopened, corrected, submitted again; final prohibited-mode submission succeeded and is read-only |
| Project spanless rule | Prohibited, explicitly saved; required- and optional-reason creation were tested earlier |
| Corrected text | ready-translation~de~v2, version 2, de, case synthetic-ready, accepted correction derived from ready-translation |
| Text change | Krampfanfälle → Epileptische Anfälle; Hypotonie left unchanged in the guided edit; corrected text verified via read-only API |
| Translation review | Submitted as Accepted with corrections; corrected-version notice and read-only state confirmed. Exact rationale/clinical-change field values were not independently recorded |
| Annotation Review | Reported by user as task 5, assigned to demo-reviewer; now submitted and read-only |
| Seizure result | Re-created onto Epileptische Anfälle; present/patient/current preserved. Experiencer default confirmed, resolution re-linked, and 1 resolved with no confirmation prompt persisted after reload |
| Hypotonia result | Unresolved with a reviewer note; persistence confirmed. Experiencer remains defaulted. Do not replace this decision merely to clear the default warning |
| Reviewer note | Suggested test text: `Abnahmetest: Unresolved-Workflow prüfen.` User confirmed note persistence, but exact stored text was not independently retrieved |
| Review submission summary | 2 annotations: 0 confirmed proposals, 1 unresolved with reviewer flags, 1 curated; 1/1 proposals decided; 0 pending after text correction; 1 annotation with defaulted axes |
| Export | Attempted as lead; failed with T1_INVALID/source_ref_syntax (F30). No ZIP contents verified |
| Other demo task | failed-translation was not exercised in this round; do not assume it was completed |

Do not confuse the submitted annotation task on accepted-translation with the later annotation Review on ready-translation~de~v2. `ann-0003` / `ann-0004` shown in assignment cells are user pseudonyms, not task IDs. Translation review, annotation Review and annotation editing are different tasks.

### Runtime, login and restart information

- Worktree branch at collection: `feat/phase0-usability`; now `feat/phase0-acceptance-plan` for the explicitly requested planning follow-up. Root checkout branch: `main`.
- Private directory, relative to the worktree: `build/t5-acceptance/phase0-candidate`.
- `credentials.json` has `host` and an `accounts` array with `username`, `password`, `role`. Use accounts demo-lead (lead), demo-reviewer (translation reviewer and now also Adjudicator), demo-annotator (annotator). The user's Adjudicator grant is runtime state; the seed's original role description may not include it.
- `identity.json` supplies `project`, `environment`, `env_file`, `base_compose` and `override`. `commands.json` contains preparation/start information. Do not print the environment or credential contents into logs or commits.
- Compose project: `ontocurator-t5-acceptance-phase0`; running containers: `ontocurator-t5-acceptance-phase0-app-1` and `ontocurator-t5-acceptance-phase0-postgres-1`.
- Runtime source: `0e9271aeb5310c39a7497dc97e0576d6de927628`. Documentation commits do not change the running image.
- Immutable image: `sha256:74b37290e03e802b281ef0d6dc8639891152f8e84b49e3dba190b8e8950c928d`.
- Old demo: Compose project `ontocurator-t5-acceptance-ready`, port 18080, stopped at the user's request. Preserve its files and volumes too.
- Handoff read-only check on 2026-10-18: both new containers healthy; `/readyz` returned HTTP 200. Credentials and identity files exist. Status may change between sessions; check before assuming the server is offline or restarting it.

If the new demo has stopped, use PowerShell from the worktree, without reseeding or rebuilding:

```powershell
$candidateDirectory = (Resolve-Path 'build/t5-acceptance/phase0-candidate').Path
$candidateConfig = Get-Content -Raw (Join-Path $candidateDirectory 'identity.json') | ConvertFrom-Json
$candidateConfig.environment.PSObject.Properties | ForEach-Object {
    [Environment]::SetEnvironmentVariable($_.Name, [string]$_.Value, 'Process')
}
$candidateComposeArgs = @('compose', '--project-name', $candidateConfig.project,
    '--env-file', $candidateConfig.env_file, '-f', $candidateConfig.base_compose,
    '-f', $candidateConfig.override)
& docker @candidateComposeArgs ps --all
& docker @candidateComposeArgs up -d --no-build --wait
```

Use the identity paths rather than guessing database ports or mounting a different environment. Do not run `down --volumes`. For read-only API inspection, authenticate using the private account file and an independent HTTP session; POST login requires `Origin: http://127.0.0.1:18081`. Do not open/create workspaces merely to inspect them, because opening a task can initialize draft state.

### Git history and local preservation

At the user's request, the 14 intermediate acceptance-documentation commits were squashed into `20b2fe4fc174891d6a3c4f7b40049a7e1c080d8d` (`docs: collect phase 0 manual acceptance findings`), parent `e49bea1`. Root main, origin/main and the worktree branch were synchronized to that commit. The tree was verified identical to the pre-squash committed tree; the push used an exact force-with-lease. Do not repeat that history rewrite.

Everything recorded since the user's stop-committing instruction, including this handoff, remains an uncommitted modification of this worktree file. The worktree's tracked change is this document only. The root checkout has user-owned untracked `.impeccable/critique/`; preserve it. A private backup of the pre-squash history and the then-local notes exists under root `.git/acceptance-history-backup-20261018/` (`before-squash.bundle`, `manual-acceptance-local.md`). That backup is older than this handoff, not a source for restoring the current notes. No application code was changed during this collection phase.

### Finding map and evidence cautions

| Area | Findings | Interpretation for continuation |
| --- | --- | --- |
| Functional export blocker | F30 | Investigated internal/export provenance mismatch; exact error and reproduction below. Successful submission does not imply export passed |
| Historical comments | F13 | UI omits annotation notes from snapshots; current note persistence passed, no data loss demonstrated |
| Project/document navigation | F01, F07, F11, F12, F20, F31–F33 | Hierarchy, duplicate-looking rows, return path, account-switch route and metadata layout |
| Editor space and labels | F04, F05, F08/F09, F17, F24, F27 | Central text width, list meaning, discoverability, completed work and spanless distinction |
| Defaults, saving and correction | F03, F06, F10, F14, F16, F18/F19, F25/F26, F28/F29 | Explicit saving, recovery after missing input, confirmation and its interaction with review state |
| Text-change review | F21–F24 | Dense panel, character-fragment diff, transient highlight, unresolved-looking resolved items |
| Demo scope | F02, F15 | Full HPO / official translated-label search wanted; additional ontologies deferred |

Avoid carrying forward disproved interpretations: F09 is not a proven axis persistence bug; F18 was an unapplied setting caused by an undiscoverable Save rules action, not a demonstrated backend save failure; F20 exposed no task contents; F22 did not corrupt the corrected text; F24/F27 did not establish a missing saved annotation or broken list click. Source inspection is distinguished from manual user confirmation throughout. Exact viewport size, many-project scaling in practice, the precise horizontal project-name control and some entered form values remain unknown.

Before this manual round, the reviewed implementation passed 1,320 frontend tests, 2,209 backend tests (one expected Windows POSIX-permissions skip), 88 browser tests and static/type/contract/wheel checks. Those were prior automated results on isolated data, not proof that the user journey or current export passes. No full test suite was rerun for these documentation changes. In particular, F30 is new manual evidence despite that earlier verification.

### Suggested continuation, not implementation approval

1. Use this record as the starting point and preserve the current demo data. Do not repeat completed tests merely to reconstruct chat history.
2. Separate the confirmed functional failures (especially F30/F13), related HPO workflow issues, and layout/information hierarchy concerns. Retain original IDs and clarification history when consolidating them into work items.
3. Discuss concrete HPO workflow proposals and scope with the user before implementation. Project/document hierarchy and the relationship between proposals, curated results and resolved text-change items need to be considered together.
4. If further manual testing is wanted, use the unchecked items at the end. Exports and historical-note comparison remain blocked; additional ontologies are explicitly deferred. Do not mark the acceptance complete just because the main editing/submission path worked.

## Session context

- Demo: `http://127.0.0.1:18081`, project `t5-acceptance`, displayed as `T5 synthetic acceptance`.
- Runtime source: `0e9271aeb5310c39a7497dc97e0576d6de927628`, containing the completed automated review fixes. Later documentation commits do not change this runtime.
- Accounts used: `demo-lead`, `demo-annotator` and `demo-reviewer`. The user granted `demo-reviewer` the Adjudicator role while retaining existing access.
- The user requested the new server remain available. The port-18081 demo is running; the old port-18080 demo is stopped. Earlier instructions describing the new demo as stopped predate this session.
- The annotation view was tested with the browser at roughly half the screen width. Exact viewport dimensions have not been recorded; do not translate this observation into a specific pixel breakpoint.
- The demo now contains the user's acceptance edits and submissions. Preserve this state; do not reset, reseed or replace it during collection.
- Continue using the [acceptance checklist](../../operations/phase0-acceptance.md). Record subsequent feedback here, retaining stable finding IDs and updating clarified findings rather than duplicating them.
- The user requested that ongoing documentation updates remain local. Do not commit, merge or push further acceptance notes unless explicitly requested.
- Whenever guiding an account switch, include that account's username and password in the conversation. Keep passwords out of this document and repository changes.

## Confirmed working paths

These are the user's observations during manual acceptance, separate from the earlier automated verification.

- The lead could grant the reviewer Adjudicator access.
- The central document text was clearly recognizable, initially without annotations.
- After manually selecting axis values, their association with the finding and text span was understandable.
- The annotation, text marking, term and chosen axis values remained present after a page reload.
- The submission dialog and its confirmation were understandable.
- After submission, the annotator saw a read-only task.
- After navigation guidance, the annotator found Previous Submissions and could recognize the submitted annotation, values and completed-submission state.
- The lead found Reopen, reopened the assignment, and the annotator confirmed that editing was available again.
- After the correction, the user confirmed that the Annotation note remained visible in the current annotation after reload and that two submissions were available. Both were already present before the follow-up check. Comparing the note across historical submissions remains blocked by F13.
- In Allowed with a required reason mode, the user found the missing-reason guidance clear and confirmed that adding a spanless finding without a reason was blocked. This confirms the creation-form behavior; mode coverage still outstanding is listed in the final checklist.
- After providing a reason and selecting the term again, the user could add the spanless annotation. The finding and reason remained present after reload, and the list displayed Spanless. The recovery sequence and visual distinction raised F16 and F17.
- After guidance to explicitly save optional-reason mode, reload Settings and the annotation view, and add Status epilepticus without a text span or reason, the user confirmed that the sequence now works. This confirms the setting change and creation path; it does not yet confirm submission or a subsequent reload of the new annotation.
- After switching to Prohibited, saving and reloading the annotator view, the user confirmed that existing spanless annotations remained visible and the submission dialog understandably identified the need for text spans and how to correct it.
- The user then confirmed the repair sequence: select the Hypotonia issue in the submission dialog, use Add Mention to link the matching Hypotonie text, wait for Saved and reopen the dialog. The annotation is linked and its missing-span warning disappears.
- After guidance to remove unsupported test-only findings, resolve remaining issues and submit with the whole-document confirmation, the user confirmed successful submission under Prohibited and that the assignment was read-only again. The exact final annotation inventory was not independently inspected.
- In demo-reviewer's intended ready-translation review, the user confirmed that source text, translation and the area for the review decision are clearly recognizable.
- After replacing Krampfanfälle with Epileptische Anfälle, leaving Hypotonie unchanged, waiting for saving and reloading, the user confirmed that the correction remains present and changes are highlighted in color.
- In response to the check of Accepted with corrections, rationale, clinical-change assessment and the submission confirmation summary, the user replied "ok". The decision fields and summary were understandable; exact entered rationale and clinical-change field values were not independently recorded.
- The user subsequently confirmed successful translation-review submission, a notice that a corrected version was created, and a read-only review view.
- The user identified ready-translation~de~v2, version 2. Read-only API checks confirmed case synthetic-ready, language de, origin correction, derived_from ready-translation, translation status accepted, and proposal set 4 (Carried over from version 1) with one changed-segment Seizure item (HP:0001250). This output existed before the annotation Review was assigned/opened. Null type/axis fields on the document reanchor endpoint were an intermediate observation, not a proven data loss; later workspace interaction and comparison with the original proposal verified preservation of present/patient/current and the Experiencer default marker.
- The reviewer opened the corrected document's Review, found the pending text-change item, selected Epileptische Anfälle and saved the re-created finding. The counter changed to 1 resolved. After guidance, the regular Seizure entry was found under Curated Annotations.
- Confirming the defaulted Experiencer triggered a version-link warning. Resolve with this finding restored 1 resolved; after reload, the warning was gone and patient remained without the confirmation prompt.
- Hypotonia's Unresolved decision and reviewer note persisted after the repeated decision click and reload. It counted as a decided proposal, and Review defaulted annotations navigated to its still-defaulted Experiencer.
- The reviewer submitted the result with 2 annotations, all proposals decided, no pending reanchor items and one remaining default warning. Submission succeeded and the task became read-only. Export subsequently failed (F30), so export correctness is not a confirmed working path.
- In the Case viewer, Versions exposes the text/version state, and Sections provides an indirect return route. In Compare, narrow-width disabling and its explanation, activation after widening, and paired scrolling all passed manual checks.

## Findings and requirements to clarify

### F01 Project identity and navigation levels are unclear

The interface felt confusing immediately on entry. The user did not understand what `T5 synthetic acceptance (t5-acceptance)` meant or which level it represented.

It is the project's display name followed by its technical project key. `T5` is internal development terminology. The distinction between project, document, task and version needs to be understandable without that explanation.

Status: observed usability issue; no presentation change selected.

### F02 The demo ontology does not support realistic search acceptance

The user could find `Convulsion` but not `Krampfanfälle`. The demo imports a small synthetic HPO excerpt rather than a full release. Its Seizure entry includes Convulsion as a synonym. The seed does not load official translation files.

The user clarified that the ontology itself need not be German. The expected setup is the full HPO with the existing optional search through official translations. The translation-search feature still exists: loaded languages can be enabled alongside English, but its language control is absent when no translations are loaded.

User requirement: use a representative full HPO in the demo and make the official translation search available. Do not reinterpret this as a request to translate the ontology or the entire interface into German.

During the optional-reason check, the user tried Hypotonia again because they did not know which other terms the fixture contained. This constrained the acceptance test to a possible duplicate. The fixture also contains Status epilepticus (HP:0002133), which can be used as a distinct test finding if it is not already present.

Evidence: [demo inputs](../../../examples/t5-acceptance/README.md), [translation loading](../../../src/ontocurator/ontology/translations.py), [search languages](../../../frontend/src/editor/searchLanguages.ts).

### F03 New annotation defaults do not match the usual workflow

Assertion, Experiencer and Temporality initially show Not specified. New annotation values are currently initialized to null, and there is no setting to configure their starting values. Settings for hiding axis values are a different feature.

The user normally expects `present`, `patient`, `current`, but explicitly cautions that a necessary correction must not be overlooked. Record this together with the desired defaults, not as permission to silently mark preset values as confirmed.

Open design questions: whether and at which scope defaults should be configurable, how preset values remain recognizable, and what confirmation is appropriate. Mandatory confirmation of every axis has not been decided.

Evidence: `initialAxisValues` in [CaseScreen](../../../frontend/src/app/CaseScreen.tsx), [axis definitions](../../../src/ontocurator/domain/axes.py).

### F04 Sidebars leave too little room for the document

At roughly half-screen browser width, both sidebars appeared wider than their contents required. The user clarified that the problem is the central text receiving too little space. Horizontal overflow or clipped content was not reported as the primary issue.

Status: observed layout problem; sidebar sizes, collapse behavior and breakpoints have not been chosen.

### F05 Previous Submissions is not intuitively discoverable

After submitting, the user asked where Previous Submissions could be found. It was present below the annotation list in the left sidebar and became usable after guidance.

Status: discoverability issue. The section was not missing, and the submitted content was displayed correctly once opened.

### F06 There is no in-app request to correct a submitted task

The user asked how to report a mistake after submission, contact the project lead and obtain permission to change it.

The lead can reopen a submitted assignment, optionally recording a reason. The annotator can then edit and resubmit; previous submissions remain immutable. The lead also has reassign and remove-assignment actions. There is no built-in correction-request or notification action for the annotator.

The reopen path was manually confirmed. An understandable way to request correction remains an open workflow requirement; no communication mechanism has been selected.

### F07 The lead document list obscures assignments and version sequence

The lead found the list generally difficult to scan, with the Assignees column particularly overloaded. It was unclear in which order work happens and which versions exist.

This concerns the relationship between documents, text versions, tasks, assigned people, status and submissions, as well as the amount of information and actions in one cell. Record it as an information-structure problem, not just a cosmetic spacing issue.

The user supplied the following concrete document-list contents, normalized from a pasted table. All six rows show text Version 1:

| Document ID | Case | Language | Origin | Translation status | Assignees and task states |
| --- | --- | --- | --- | --- | --- |
| accepted-source | synthetic-accepted | en | Native | — | Unassigned |
| failed-source | synthetic-failed | en | Native | — | Unassigned |
| ready-source | synthetic-ready | en | Native | — | Unassigned |
| accepted-translation | synthetic-accepted | de | Machine translation | Accepted | Annotator (ann-0004): Annotation, Reopened; Translation reviewer (ann-0003): Translation review, Submitted |
| failed-translation | synthetic-failed | de | Machine translation | Check failed | Translation reviewer (ann-0003): Translation review, Open |
| ready-translation | synthetic-ready | de | Machine translation | Ready for review | Translation reviewer (ann-0003): Translation review, Open |

Every German row also has a Reviews button; each assigned task has Assignment actions. English and German documents belonging to the same case are separated in the pasted order. The user experiences this as the same case appearing repeatedly, without a clear explanation of the relationship.

These rows represent three cases with two language variants each, not evidence of duplicate submissions. In the fourth row, the submitted translation-review assignment and the reopened annotation assignment both belong to the accepted German document. The current annotation work and the preceding completed review occupy the same Assignees cell. The intended sequence and distinction between text version, language variant and task history are not apparent from that presentation.

Acceptance concern: a lead should be able to identify which rows belong together, which text they represent, what has already happened, what is currently actionable and which person's task each status describes.

Further observation after translation correction: the user could identify the corrected German version and its relationship to the earlier version. However, both appeared as peer rows, one above the other. The user questioned why a lead's document overview exposes every version equally and expects documents to be primary entries, with versions subordinate to their document. They also expect annotations and comments to be accessible in that document context.

User requirement: provide an overview of logical text documents with a recognizable current version and subordinate version history. Preserve the distinction between a case, its source/translation language variants, and revisions of a given text. Annotations, comments and tasks are related information with their own meaning and must retain their association with the applicable document or text version; they are not interchangeable history entries. The exact grouping of language variants and the choice of expandable rows, detail pages or another presentation remain undecided.

Status: observed information-structure issue with a clarified document-first hierarchy requirement. No concrete UI redesign or implementation has been approved.

### F08 The annotation list shows an unlabeled value from changing axes

Next to the term, the left annotation list shows values such as `present`, `current` or `other` without identifying the axis. The implementation takes the first nonempty value from the annotation's axis dictionary, rather than consistently summarizing a named axis.

Reproduction supplied by the user:

1. Set Assertion to Not specified.
2. Set Experiencer to Other person.
3. The left list shows `other`.

The displayed value is from Experiencer, while the empty value on the right belongs to Assertion. The changing meaning and unlabeled/raw value make the overview misleading.

Status: reproducible presentation issue, supported by the `firstAxisVal` rendering in [CaseScreen](../../../frontend/src/app/CaseScreen.tsx).

### F09 The initially suspected value mismatch is clarified by F08

The earlier report of `other` on the left versus Not specified on the right initially looked like inconsistent values. The reproduction identifies different axes: empty Assertion and Experiencer set to Other person.

Status: clarified and folded into F08. This reproduction does not establish a persistence error or a mismatched Experiencer value. Keep this ID to preserve the conversation's finding history; do not count it as a separate confirmed data-integrity defect.

### F10 Saving and restoring an earlier editing state are unclear

The user asked whether leaving the document discards inputs, whether intermediate edits are saved, and how to return to the provided starting state.

Current behavior: edits are automatically saved to the server-side draft; annotation notes save on leaving the field, and application navigation attempts to flush pending edits. Leaving the document is not a discard action. A Saved indicator describes the persisted draft, while submission creates a completed record.

Individual values can be changed or cleared where allowed, an annotation can be deleted, and a review decision can be reset to open. There is no general undo or Restore starting state action, and no action to restore a historical submission as the current draft. Discard dialogs for unsaved/failed edits do not revert edits already saved successfully.

Open requirement: explain the save model and define the desired reset scope. Resetting one field, one annotation, a review decision, all changes since reopening or an entire task are different operations; the user has not yet selected the required scopes.

### F11 Reviews does not fit clearly with Assignees

The lead finds the Reviews button inconsistent with the Assignees column and its information. The relationship and division of responsibility between those entry points are unclear.

The current Reviews button opens translation-review history, while Assignees shows assignments, their states and management actions. The generic label does not communicate that distinction clearly in context.

The pasted accepted-translation row makes this concrete: Accepted describes the translation's status, Submitted describes its translation-review assignment, and Reopened describes its annotation assignment. The adjacent Reviews entry exposes translation-review history again. Those different meanings and overlapping entry points are difficult to distinguish from the row alone.

Status: observed usability issue related to F07. No revised labels or navigation structure have been chosen.

### F12 The Case view is unfamiliar and lacks an obvious return path

Opening a document through the Case link leads to a view the user described as strange, with no apparent Back action.

The route opens a separate read-only Case viewer rather than the assigned annotation editor. Its own toolbar has no explicit return-to-document-list action. Global navigation or browser history may still be available; this is not evidence that browser Back fails.

Status: observed layout/orientation and return-navigation problem. Later checks identified the indirect Sections return path and concrete appearance concerns F31/F32; the precise horizontal project-name control in F33 remains unidentified. No redesign has been selected.

The subsequent pasted evidence is the Documents table described in F07/F11, not the separate Case viewer. It clarifies the repeated-case and mixed-assignment complaint but does not resolve the separate viewer-layout or return-navigation observation.

Later follow-up: when asked to open synthetic-ready, the user first noted multiple occurrences of that case name. Guidance identified the Case link specifically in the ready-translation~de~v2 / version 2 row, reinforcing F07. In the opened viewer, the user could expand Versions and see the text/version state there. Version information is therefore available; the report does not establish that it is missing. Whether the selected text version is sufficiently apparent with Versions collapsed remains unverified. No new visual defect is inferred merely from using the expandable section.

Return-navigation clarification: the user could find only the route through the expandable Sections menu. An in-app route exists, but no direct return to Documents was apparent. Record this as an indirect, poorly discoverable return path, not a complete absence of navigation or a requirement to use browser Back. The separate original description of the view as visually strange remains only partly clarified.

Evidence: [document links and Reviews](../../../frontend/src/admin/DocumentsPage.tsx), [Case viewer](../../../frontend/src/variants/CaseViewer.tsx).

### F13 Historical submissions omit annotation notes

During the suggested comparison of an original submission and a correction containing an Annotation note, the user reported that Previous Submissions shows no comment.

The historical-submission dialog renders the term, axis values and evidence text for each annotation snapshot, but does not render `snap.annotation.note`. It does render notes attached to review decisions, which are a different field. A stored annotation note would therefore still be invisible in this dialog.

Status: confirmed display omission in [CaseScreen](../../../frontend/src/app/CaseScreen.tsx), consistent with the user's observation. In the follow-up, the user confirmed the note is still present in the current annotation after reload and that two submissions exist; both were already present before that follow-up. This verifies saved-note persistence and the second submission's existence, but not the note's exact contents in each immutable snapshot. The proposed note-based historical comparison cannot be completed through this UI as implemented.

Acceptance impact: users cannot inspect annotation comments or compare their changes across submissions in this view. No loss of the saved current note was observed.

### F14 Project Settings is overloaded and lacks a clear structure

While changing Findings without a text span, the user described the Settings page as completely overloaded and unstructured. The specific required-reason setting could be used, but the overall page did not provide a clear organization.

Concrete consequence: the user later described Save rules as almost invisible amid the page's structure and overload, with no clear indication of which settings it belonged to. The section's save action was not recognizable as the step needed to apply the changed rule (see F18/F19).

Status: observed usability issue in project configuration. Record the whole-page organization concern separately from the successful validation of the spanless-finding rule. No regrouping, navigation or progressive-disclosure design has been selected.

### F15 The experience with additional ontologies is unclear

The user could not see how the setup would work when other ontologies are involved. The current demo contains only the HPO example, so the session does not show how users would configure, distinguish or work with additional ontologies.

User clarification: the concern is general; concrete examples will likely be needed to assess additional ontologies. The immediate priority is a smooth HPO workflow. Do not expand this collection phase into configuring additional ontologies or treat their demonstration as a prerequisite for the first usability improvements.

Status: broader scenario deferred behind the HPO workflow. A representative additional-ontology example and its expected behavior remain to be agreed later; this is not evidence that multiple ontologies are unsupported.

### F16 Correcting a missing reason requires selecting the term again

The user reported this creation sequence:

1. Search for a term and select it before entering a spanless-finding reason.
2. Receive the missing-reason validation message; the finding is not added.
3. Enter the reason.
4. Click the already chosen term again to actually create the annotation.

The required-reason rule is clear, but the recovery and completion action feel awkward. Selecting a term triggers creation; filling the reason after a rejected attempt does not complete that earlier selection. The user has to repeat the term action rather than having an obvious continuation after correcting the field.

Status: user-reproduced interaction issue, consistent with `createPendingAnnotation` and the term-selection handler in [CaseScreen](../../../frontend/src/app/CaseScreen.tsx). Keep this separate from a validation failure: blocking incomplete input is working. No change to automatic creation, selection retention or explicit save controls has been decided.

### F17 Spanless findings could be easier to distinguish visually

The user sees the Spanless label and suggested considering an additional visual distinction, for example a symbol or italic styling.

Status: presentation suggestion, not an absent-label defect. The underlying need is to identify annotations without a text marking more readily in the list. Symbols and italics are candidate ideas only; neither is approved or selected.

### F18 Optional-reason mode did not unblock the reported creation attempt

After the instruction to switch to Allowed with an optional reason, save and reload, the user reported that the warning remained and they could not add the term. Their attempted term was Hypotonia, which would duplicate an existing finding. The reported action was another creation attempt, not confirmation that clearing the note on an existing annotation had persisted.

Follow-up at that point: after reloading Settings, the user confirmed that the selection had returned to the old required-reason value. The optional setting therefore had not persisted through that interaction, so the blocked attempt had not exercised optional-mode behavior. It did not establish a defect in optional-mode validation. The possible duplicate remained an unconfirmed factor; the later successful retry is recorded below.

Clarification: the user subsequently found Save rules and explained that the button had been almost invisible and its scope unclear. This identifies a save-action discoverability problem; the earlier interaction is not evidence of a failed save request or backend persistence defect.

Resolution: after the explicit-save and reload instructions, followed by adding Status epilepticus without a text span or reason, the user confirmed that it now works. The initial block is clarified by the unapplied setting; no optional-mode validation defect was established. Retain this ID for the test history. The save-action usability issue remains open under F19. Prohibited-mode repair/submission later passed; optional-mode submission and clearing an existing annotation note remain untested.

### F19 Settings save action and its scope are not recognizable

The user reports that Settings does not indicate whether a setting was saved. This makes the optional-reason test ambiguous: changing the visible selection alone does not establish which rule was persisted.

Source evidence: ProjectSettingsPage implements section-specific success feedback such as Rules saved. after a successful request, rendered after the section's fieldset. This is evidence of an implemented feedback path, not proof that the user saw it or that a save succeeded.

Clarification: after the setting reverted on reload, the user discovered Save rules and described it as almost invisible because of the page's structure and overload. It was unclear which controls the button applied to. The confirmed issue is the discoverability and scope of the explicit save action. The original report does not establish that success feedback is missing after an actual save.

Status: confirmed usability issue, a concrete consequence of F14. Retain this ID for the save-action and feedback concern. No backend persistence defect has been established and no presentation fix has been selected.

### F20 Login opens an unexpected task reported as unassigned to the account

When switching to demo-reviewer for the translation-review check, the user reported being taken directly into another task that was not assigned to that account. They could return to the task list.

Clarification: the user explicitly confirmed that no contents were visible in the unexpected task. No exposure of another task's document or annotations was observed. Record this as a navigation/account-switch issue, not a demonstrated authorization failure. The task identity, prior URL and exact empty/error presentation remain unspecified. Retaining the previous task route is a possible explanation, not a verified cause.

The user resumed and completed the intended ready-translation review from My tasks. No navigation fix has been selected.

### F21 The pending text-change review panel is cluttered and visually restless

After assigning and opening the corrected document's annotation Review, the user confirmed seeing Needs review after the text change, but described the area as confusing and visually restless. Numerous values are shown together with middle-dot separators, making the pending finding hard to scan.

Further clarification: the user specifically identified the Pending, Re-create and Dismiss elements as looking merely stacked together rather than organized. They described them collectively as fields or buttons. In the implementation, Pending is a status badge and the other two are actions; their different roles are not sufficiently apparent in this presentation. This is a concrete hierarchy/grouping problem within the resolution area, in addition to the dense contextual values above it. Re-create was subsequently used successfully after guidance (F23–F26).

Source evidence: ReanchorPanel combines counts, term/code/layer information, reason, available original clinical axes, current context, expandable original context/diff and resolution actions. Middle dots separate counts, term/layer and axis values. This supports the reported density concern; the exact values visible in the user's viewport have not been enumerated.

Status: observed usability issue. The finding's meaning, reason for review, clinical context and next action need a clearer hierarchy. No new layout or styling has been selected.

### F22 Character-level text changes interleave words into an unreadable mixed string

In the pending Seizure finding for ready-translation~de~v2, the user reported that the diff appears to put changes in the wrong order, quoting:

> Übersetzung sorgfältig verglichen werden können.
>
> KramEpfaileptische Anfälle werden als positiver künstlicher Befund

Read-only verification against the running demo reproduced that exact mixed phrase by concatenating the displayed inline diff parts. The saved corrected document and its current-context field contain Epileptische Anfälle, without the mixed phrase. Reconstructing the old and new strings separately from the diff operations matches both original context windows exactly.

Cause of the confusing presentation: the backend uses character-level SequenceMatcher operations; for this replacement it preserves shared letters inside the words. ReanchorPanel renders each replacement as deletion followed by insertion, and DiffView displays these fragments inline. This produces deleted Kram, inserted E, unchanged p, deleted fa, inserted ileptische A, followed by unchanged nfälle. The resulting visual/text sequence is difficult to interpret as the simple phrase replacement Krampfanfälle → Epileptische Anfälle.

Status: reproducible diff readability/presentation issue; the checked corrected text is intact and this example does not establish an incorrect reconstruction order. Capture the need to understand the phrase-level change clearly, without selecting a new diff algorithm or layout during collection. Evidence: domain/reanchor.py, variants/ReanchorPanel.tsx and translation/DiffView.tsx, plus live text/reanchor API reads.

### F23 Re-create gives a brief highlight without an apparent next step

After being asked to click Re-create here and inspect the guidance, the user reported a short yellow text highlight that then disappeared. They thought it covered the entire preview/context associated with the confusing diff, but were unsure of the exact location. No understandable continuation was reported.

Source evidence: beginReanchor activates text selection for the pending finding and calls useReanchorContext.reveal with its new context. That hook highlights the context window and clears the highlight after 2,000 ms. The intended highlight is in the main text pane; the user's impression that it appeared in the diff preview has not been visually verified. CaseScreen also supplies a persistent instruction to select supporting text while re-creation is active. Whether that instruction appeared, was outside the viewport or was overlooked in this session remains unverified.

Status: observed workflow-guidance/orientation problem. A temporary context highlight does not make the active task and next selection step sufficiently apparent to this user. It is not evidence that the finding was saved and then lost or that the re-creation mode itself timed out. No behavior or layout change has been selected.

Follow-up: after selecting Epileptische Anfälle, the user confirmed the re-creation panel appeared and went on to save. The queue then showed 1 resolved. The unclear initial guidance remains a finding; the action can be completed after guidance. Clinical values were checked after saving against the original proposal, as recorded in F25.

### F24 Resolved text-change items still dominate the finding presentation

After saving the re-created finding, the user saw 1 resolved but said that the clutter on the left did not clear. The term was not recognizable as a normal finding; it remained associated with the full expandable problem/context block.

Source evidence: ReanchorPanel keeps rendering every item, including resolved ones, with the finding header, reason, clinical context and current/original text sections. Resolution changes the status/actions portion, but does not automatically collapse the item or remove it from that panel. CaseScreen places this panel before the ordinary proposal and annotation lists.

Follow-up: after guidance to collapse the pending-review section and inspect Curated Annotations, the user found the regular Seizure entry and reported a Default Axes notice. The annotation is therefore present in the regular list; the problem is its discoverability beneath the resolved context block, not an observed missing annotation.

Status: observed completion-state and discoverability problem, consistent with the rendering structure. The desired outcome is that completion and the usable resulting finding are clear, with the review history still accessible. No collapse, filtering or replacement design has been selected.

The later value/marker check is recorded in F25 and the confirmation/reload outcome in F26. The presence of a regular annotation is confirmed; its discoverability remains a problem.

### F25 Per-axis default confirmation is poorly distinguished from other buttons

On the re-created Seizure finding, the user read Assertion = present, Experiencer = patient and Temporality = current, with Confirm Experiencer value available. They reported that this confirmation control is poorly differentiated from the other buttons.

A read-only check of the original ready-translation proposal (proposal set 1, HP:0001250) confirmed those same three values and axes_defaulted = [experiencer]. Together with the user's report, this supports preservation of the original clinical values and the default marker through re-creation. Subsequent confirmation and persistence after reload passed after re-linking the resolution (F26).

Status: observed action-hierarchy/discoverability issue. Confirming a supplied clinical value should be recognizable in relation to that field and distinct from other editing or workflow actions. This is separate from configurable starting defaults for new findings (F03). No styling, grouping or confirmation-policy change has been selected.

The subsequent confirmation caused the resolution to require linking again; see F26. This extra workflow step does not resolve the confirmation control's visual-discoverability concern.

### F26 Confirming a default value triggers an unclear re-linking warning

After being guided to confirm the existing patient value for Experiencer, the user reported this message above the finding:

> This finding has changed or has not yet been linked to the text-correction review.

Source evidence: Confirm Experiencer value calls handleUpdateAxes with the existing axis values and the confirmed axis ID. The reanchor resolution references an exact saved annotation version; currentReanchorResolution no longer treats it as resolved when that referenced version is absent from the current draft. Thus confirmation metadata can require linking the finding again even when the clinical value is unchanged. CaseScreen provides Resolve with this finding beside the reported warning to link the current saved version.

Status: observed workflow and explanation issue, consistent with version-bound resolution behavior. The generic warning does not explain why the immediately preceding confirmation requires another resolution step. The intermediate counter immediately after confirmation was not reported; the successful final state was verified after re-linking as described below. No policy change to automatic resolution or version checks has been selected.

Follow-up: the user confirmed that after Resolve with this finding, saving and reloading, the warning is gone, the queue shows 1 resolved, and Experiencer remains patient without Confirm Experiencer value. Persistence and the recovery action are manually confirmed. The additional explanation/workflow concern remains open.

### F27 Opening the saved finding seems possible only through its text marking

After the successful reload check, the user reported that they apparently could open the finding only by clicking its marking in the text. This adds a navigation/discoverability concern to F24: finding an entry in a list does not necessarily make its detail-opening behavior understandable.

Source evidence: a Curated Annotations row is intended to select its annotation and show details; clicking an already selected row deselects it. The term/header in the separate text-change review panel instead reveals the text context. The user's exact click target is not yet known, so do not conclude that the regular annotation row is broken or that the only implemented route is the text marking.

Follow-up: the user acknowledged that the entry is under Curated Annotations and said that this is also confusing. The alternate list entry is present; no broken list-click behavior has been established. The issue is the terminology and organization of the finding across the text-change review panel and the regular annotation list, whose relationship is not evident. The original attempted click target was not explicitly identified.

Status: clarified navigation/discoverability issue, related to F24. Keep the finding open for the confusing Curated Annotations label and split presentation; do not classify it as a demonstrated missing navigation route. No replacement terminology or interaction has been selected.

### F28 Unresolved requires repeating the decision after entering its note

In the Hypotonia review, the user clicked Unresolved, entered a reviewer note and then had to click Unresolved again for it to save. They found this sequence odd.

Source evidence: ReviewActions.handleOutcomeClick returns without creating a decision when Unresolved is chosen with a blank note, and focuses the note field. Entering the note does not retain and complete that attempted decision. Without an existing decision, saveNote also does nothing on blur; the note is submitted with the next explicit decision click. Once a decision exists, subsequent note edits have a separate automatic-save path. A hint says the initial note is saved together with the next decision, but the user still experienced the repeated click as unexpected.

Status: user-reproduced recovery/completion issue supported by the implementation. The required-note validation is functioning; the initial decision intent and how to complete it after supplying the note are unclear. This repeats the interaction pattern recorded for spanless creation in F16. No automatic completion, explicit-save or form-order redesign has been selected.

Follow-up: after the second decision click, Saved and reload, the user confirmed that Unresolved and the reviewer note persist. The repeated-click usability issue remains open; persistence has now passed the manual check. The exact note text has not been independently read from the saved draft.

### Review submission checkpoint: ready-translation~de~v2

The user supplied this submission-dialog summary:

- 2 annotation(s) will be submitted (0 confirmed proposal(s), 1 unresolved with reviewer flags, 1 curated).
- 1 of 1 review proposal(s) decided.
- 0 finding(s) after text correction still pending.
- 1 annotation has defaulted axis values.
- Review defaulted annotations action and Entire text checked for further findings checkbox are visible.

This confirms that the unresolved decision counts as decided and that the re-created finding's text-change resolution is complete in the submission checklist. The user then followed Review defaulted annotations and confirmed Hypotonia/Experiencer as the remaining defaulted result (F29). Final submission subsequently succeeded with this marker retained.

### F29 Default-axis review navigation does not expose a clear confirmation path

The user confirmed that Review defaulted annotations selects Hypotonia and identifies Experiencer as defaulted, but could not see how to confirm the value from there.

Source evidence: the proposal detail view displays immutable source values and default badges. Its hint instructs the reviewer to use Edit & Replace, reset an existing decision if prompted, and confirm the axis in the editable copy. handleAdoptAndEditTarget explicitly resets an existing Unresolved decision when that path is accepted; changing confirmation metadata in the copy can make the decision Replaced. Thus this is not a direct confirmation of a field while keeping the current Unresolved outcome.

Status: observed guidance/action mismatch with a workflow tradeoff. The submission dialog directs users to review defaults, but the destination has no direct per-axis confirmation control and the available editing route affects a separate review decision. The confirmation requirement and preservation of the Unresolved outcome need consideration together; no behavior change has been selected.

For the unresolved-export test, Hypotonia's source default marker and Unresolved decision were deliberately left intact. The default-axis notice itself is a warning, not a submission blocker: the submit handler/button gate on unresolved reanchor items, undecided proposals, submission issues and the whole-text confirmation, not the defaulted count. Do not present the warning as evidence that the clinical value was explicitly confirmed.

The user subsequently confirmed successful submission of this review and that the task is read-only. The remaining default warning did not prevent completion. The exported representation of the unresolved decision and clinical values has not yet been checked.

### F30 Annotation-results export fails on a re-created finding's provenance reference

As demo-lead, the user attempted the annotation-results export after successfully submitting the corrected document's annotation Review. The UI reported:

```text
DomainError: [T1_INVALID] {'codes': ['source_ref_syntax'], 'issues': ["source_ref_syntax at units[1].annotation_set.annotations[1].provenance.source_refs[0]: 'urn:ontospan:t5-synthetic-acceptance-v1:demo-ready-translation-v1:seizure:ac40acbe8f47966d686dd18ad969e7dd2ab892813ebc84ec1cf071f2cb345e3e' needs a set id and an annotation id"]}
```

Reproduction context: correct ready-translation to version 2, re-create the pending Seizure finding, confirm its defaulted Experiencer, re-link its resolution, mark Hypotonia Unresolved with a reviewer note, submit, then request Annotation results export. These are the observed steps, not a claim that every step is necessary to trigger the defect.

Read-only investigation identified an internal/export reference mismatch. The recreate_reanchor path in application/editing.py records provenance.source_refs as annotation_id:version, as required by internal resolution matching. For the independently re-created annotation, exchange/t1.py's submission_to_unit fallback copies those internal strings directly into ontospan provenance. The normalized reviewed-provenance path is keyed by ordinary confirmed/changed review decisions and does not cover this re-created result. The source Seizure annotation URN is valid by itself; appending its snapshot hash produces an invalid exported annotation reference.

Verification: running ontospan.parse_annotation_ref in the existing demo app container accepted the original Seizure URN and rejected that same URN plus the version hash with the exact error above. This check only parsed literal strings; no export was retried, no task was opened/mutated, and no code or demo data was changed. The full export failure is user-observed; the isolated parser failure and source path corroborate the cause.

Status: confirmed functional acceptance blocker. A successfully submitted review cannot complete the tested annotation-results export path. The user-facing error also exposes a technical validation path rather than explaining which action can recover. This does not implicate the user's note or establish loss of the submitted review. Mark ZIP download and unresolved-result export verification blocked, not passed. Do not remove provenance or alter demo data as a workaround during collection; no implementation fix has been authorized in this phase.

### F31 Version selectors appear at different levels in the comparison

During the Case-view comparison check, the user reported that one version selector appears at a higher level than the other on the right. The two controls do not appear consistently positioned or scoped for the paired texts.

Source evidence: CaseViewer places the primary VariantSelectors in an expandable Versions section above the comparison-reading area, whereas ComparePane puts its selector within the right comparison controls. This supports the reported asymmetry. Exact pixel alignment and whether the main concern is vertical position, hierarchy or both have not been separately measured.

Status: observed layout/information-hierarchy issue. Each selector's association with its corresponding text should be clear. No rearrangement has been selected.

### F32 Translation details appears as unstructured facts on separate lines

In the same Case viewer, the user described Translation details as poorly presented: facts separated into lines without a clear structure. This concerns grouping and scanability of metadata, not a reported missing fact or wrong translation value.

Status: observed presentation issue. The relationship between the individual facts and their relative importance needs to be clearer; no metadata grouping, layout or content reduction has been chosen.

### F33 Project identity, project switching and section navigation are unclear and may scale poorly

The user finds the project name's button-like presentation in the horizontal bar inappropriate. They also found its placement in the vertical sidebar abrupt and asked whether all projects would simply be listed vertically, which would be problematic with many projects. The precise horizontal control being referenced has not yet been identified; retain that as a user observation rather than attributing it to a particular component.

Source evidence: Shell.tsx renders every project with can_manage as its own navigation group, headed by its name (and technical key when different), followed by Settings, Documents, Progress and Export. This is all manageable projects, not necessarily every project the account can access. AppShell reuses this navigation in the expanded Sections menu in reading views. There is no project search or selective project switcher in that navigation implementation.

Status: observed navigation/identity concern with a source-supported scaling risk. The current single-demo-project session does not measure performance or usability with many projects. The user needs a comprehensible current project context and navigation that remains usable across many projects. How to distinguish project identity, project switching and navigation within the active project remains a design question; no specific replacement control or layout is approved. Related to the initial project-level confusion (F01) and indirect Sections return path (F12).

## Current checkpoint and remaining manual checks

This round has been consolidated for a fresh-session handoff at the user's request; no next UI action is currently pending from the user. The annotation Review for ready-translation~de~v2 (reported task 5) was submitted successfully and is read-only. Annotation-results export remains blocked by F30; preserve the submitted state and leave remediation for post-collection work. Case-view comparison scrolling passed the three manual checks, with layout concerns F31/F32 recorded. The immediate priority is a smooth HPO workflow; additional-ontology examples are deferred (F15). Project identity/navigation and scaling are recorded in F33. Start from the handoff section above, then discuss consolidation/priorities or continue specific unchecked tests as requested. No implementation changes are approved by this handoff. Include credentials for later account switches. Project spanless mode remains Prohibited; further protocol updates remain local.

- [x] Collect concrete Case-view appearance concerns beyond return navigation: asymmetric version selectors (F31) and unstructured Translation details (F32).
- [x] Clarify Case-view return navigation: the user finds the indirect route through expandable Sections, with no obvious direct return to Documents.
- [x] Clarify whether the unexpected task after reviewer login exposed contents: the user confirmed no contents were visible (F20); the navigation issue remains open.
- [x] Confirm the correction note is saved and two submissions exist.
- [ ] Compare the note in the two historical submissions; blocked by F13, not a failed persistence check.
- [x] Confirm required-reason mode clearly blocks creation of a spanless finding without a reason.
- [x] Add a spanless finding with a reason and verify its persistence after reload.
- [x] Explicitly save optional-reason mode and confirm creation without a reason after reloading the settings and editor.
- [x] Confirm that prohibited mode preserves existing spanless findings and the submission dialog explains the required correction.
- [x] Follow the submission repair link, attach supporting text with Add Mention and confirm that the repaired finding's missing-span warning disappears under prohibited mode.
- [x] Complete final submission under prohibited mode and confirm the assignment becomes read-only.
- [ ] Check remaining mode coverage: prohibited-mode creation blocking, optional-mode submission and clearing an existing annotation note remain unverified.
- [x] Clarify immediate ontology priority: a smooth HPO workflow first; broader ontology coverage needs examples later.
- [ ] Define and demonstrate representative additional-ontology scenarios later, after the HPO workflow improvements; not part of the immediate requested scope.
- [x] Submit the corrected translation review and confirm the corrected-version notice and read-only state.
- [x] Locate the corrected German version and confirm its relationship to the previous version is understandable; record the objection to flat version rows in F07.
- [x] Record ready-translation~de~v2 / version 2 and verify that proposal set 4 and a pending Seizure reanchor item exist before the review assignment is first opened.
- [x] Assign the corrected document's annotation Review to demo-reviewer, open it and confirm that Needs review after the text change is visible.
- [x] Confirm that the translation draft correction survives reload and changes are highlighted in color.
- [x] Re-create the pending finding on corrected text and observe 1 resolved after saving.
- [x] Locate the re-created Seizure finding under Curated Annotations; the user also sees a Default Axes notice.
- [x] Verify re-created clinical values and the default marker against the original proposal: present/patient/current, with only experiencer defaulted.
- [x] Confirm persistence after reload following per-axis confirmation and renewed resolution: warning gone, 1 resolved, Experiencer patient without its confirmation prompt.
- [x] Clarify that the re-created finding is available under Curated Annotations; terminology and split presentation remain confusing (F27), with no broken list-click behavior established.
- [x] Confirm that Hypotonia's Unresolved decision and reviewer note persist after reload.
- [x] Inspect review submission readiness and follow default-axis navigation to Hypotonia/Experiencer; record the unclear confirmation path and decision-reset consequence (F29).
- [x] Submit the annotation review with its unresolved result and remaining default warning; confirm read-only state.
- [ ] Create/download the annotation-results export and verify the unresolved result, reviewer note and unchanged clinical assertion — blocked by F30 (T1_INVALID/source_ref_syntax after re-creation).
- [x] Check coupled scrolling in the Case-view comparison: narrow-width disabling and explanation, activation after widening, and paired scrolling all confirmed by the user.
- [ ] Check coupled scrolling separately in the translation-review read-only presentation; restoring an enabled preference after narrowing/widening also remains unverified.
- [ ] Optional coverage not exercised: independent second-reviewer pending-item queue, Dismiss with reason, and deleting/changing a replacement beyond the observed default-confirmation invalidation. Do not imply these passed from the single-reviewer path.
- [ ] If needed for design, identify the precise horizontal project-name control (F33), observe navigation with many projects, and agree reset/correction-request scopes (F06/F10). These remain requirements questions, not demonstrated backend defects.
- [ ] Review the collected findings together and decide scope and priority before implementation.

Manual acceptance remains open. Successful automated checks and working basic paths do not close the usability findings above.
