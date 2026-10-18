# Phase 0 manual acceptance findings

The guided manual acceptance session is in progress. The user wants to collect and discuss findings before changing the interface or behavior. This is the running record of observations, confirmed working paths and remaining checks; it is not a redesign approval or a completed acceptance.

## Session context

- Demo: `http://127.0.0.1:18081`, project `t5-acceptance`, displayed as `T5 synthetic acceptance`.
- Runtime source: `0e9271aeb5310c39a7497dc97e0576d6de927628`, containing the completed automated review fixes. Later documentation commits do not change this runtime.
- Accounts used: `demo-lead` and `demo-annotator`. The user granted `demo-reviewer` the Adjudicator role while retaining existing access.
- The user requested the new server remain available. The port-18081 demo is running; the old port-18080 demo is stopped. Earlier instructions describing the new demo as stopped predate this session.
- The annotation view was tested with the browser at roughly half the screen width. Exact viewport dimensions have not been recorded; do not translate this observation into a specific pixel breakpoint.
- The demo now contains the user's acceptance edits and submissions. Preserve this state; do not reset, reseed or replace it during collection.
- Continue using the [acceptance checklist](../../operations/phase0-acceptance.md). Record subsequent feedback here, retaining stable finding IDs and updating clarified findings rather than duplicating them.

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
- In Allowed with a required reason mode, the user found the missing-reason guidance clear and confirmed that adding a spanless finding without a reason was blocked. This confirms the creation-form behavior, not yet the remaining mode changes or submission repair paths.
- After providing a reason and selecting the term again, the user could add the spanless annotation. The finding and reason remained present after reload, and the list displayed Spanless. The recovery sequence and visual distinction raised F16 and F17.
- After guidance to explicitly save optional-reason mode, reload Settings and the annotation view, and add Status epilepticus without a text span or reason, the user confirmed that the sequence now works. This confirms the setting change and creation path; it does not yet confirm submission or a subsequent reload of the new annotation.
- After switching to Prohibited, saving and reloading the annotator view, the user confirmed that existing spanless annotations remained visible and the submission dialog understandably identified the need for text spans and how to correct it. This confirms preservation and understandable guidance; completing a repair and submitting remain unverified.
- The user then confirmed the repair sequence: select the Hypotonia issue in the submission dialog, use Add Mention to link the matching Hypotonie text, wait for Saved and reopen the dialog. The annotation is linked and its missing-span warning disappears. Final submission under Prohibited remains unverified.
- After guidance to remove unsupported test-only findings, resolve remaining issues and submit with the whole-document confirmation, the user confirmed successful submission under Prohibited and that the assignment was read-only again. The exact final annotation inventory was not independently inspected.

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

Acceptance concern: a lead should be able to identify which rows belong together, which text they represent, what has already happened, what is currently actionable and which person's task each status describes. This does not yet prescribe grouping, a timeline or another specific UI design.

Status: observed usability issue; a replacement organization has not been decided.

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

Status: reported layout/orientation and return-navigation problem. The precise aspect of the view's appearance still needs clarification. Ask which content or arrangement is unexpected before selecting a redesign.

The subsequent pasted evidence is the Documents table described in F07/F11, not the separate Case viewer. It clarifies the repeated-case and mixed-assignment complaint but does not resolve the separate viewer-layout or return-navigation observation.

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

Status: open usability and acceptance-coverage question, not evidence that multiple ontologies are unsupported. Clarify whether the concern is project configuration, simultaneous annotation in the editor, or both. A representative additional-ontology scenario and its expected workflow have not yet been agreed.

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

Follow-up: after reloading Settings, the user confirmed that the selection had returned to the old required-reason value. The optional setting therefore did not persist through this interaction. This explains why optional-mode behavior has not yet been exercised successfully; the creation block does not establish a defect in optional-mode validation. The possible duplicate remains an unconfirmed factor.

Clarification: the user subsequently found Save rules and explained that the button had been almost invisible and its scope unclear. This identifies a save-action discoverability problem; the earlier interaction is not evidence of a failed save request or backend persistence defect.

Resolution: after the explicit-save and reload instructions, followed by adding Status epilepticus without a text span or reason, the user confirmed that it now works. The initial block is clarified by the unapplied setting; no optional-mode validation defect was established. Retain this ID for the test history. The save-action usability issue remains open under F19, and submission/repair paths still need testing.

### F19 Settings save action and its scope are not recognizable

The user reports that Settings does not indicate whether a setting was saved. This makes the optional-reason test ambiguous: changing the visible selection alone does not establish which rule was persisted.

Source evidence: ProjectSettingsPage implements section-specific success feedback such as Rules saved. after a successful request, rendered after the section's fieldset. This is evidence of an implemented feedback path, not proof that the user saw it or that a save succeeded.

Clarification: after the setting reverted on reload, the user discovered Save rules and described it as almost invisible because of the page's structure and overload. It was unclear which controls the button applied to. The confirmed issue is the discoverability and scope of the explicit save action. The original report does not establish that success feedback is missing after an actual save.

Status: confirmed usability issue, a concrete consequence of F14. Retain this ID for the save-action and feedback concern. No backend persistence defect has been established and no presentation fix has been selected.

### F20 Login opens an unexpected task reported as unassigned to the account

When switching to demo-reviewer for the translation-review check, the user reported being taken directly into another task that was not assigned to that account. They could return to the task list.

Status: reported navigation/account-switch issue. The task identity, prior URL, visible content and available actions have not yet been established. Retaining the previous task route is a possible explanation, not a verified cause. This report alone does not establish unauthorized access: distinguish a task route showing an access-denied message from document/annotation content actually being visible or editable. No changes should be made in that task to test access.

Next clarification: what was visible immediately after login (task contents or an access/assignment error), and whether the task appeared editable. Then resume the intended ready-translation review from My tasks. No navigation or authorization fix has been selected.

## Current checkpoint and remaining manual checks

The annotation task has now been submitted successfully under Prohibited and is read-only again. The previously tested correction note persists; F13 still blocks comparing historical notes. Required- and optional-reason creation paths, prohibited-mode guidance, and repairing Hypotonia with Add Mention have been manually confirmed. The Settings save-action findings remain open (F14/F19). On switching to demo-reviewer, an unexpected task reportedly not assigned to that account opened; the user returned to the task list (F20). Clarify what that view exposed, then open the intended Translation review for ready-translation and collect orientation feedback before editing or submitting it. Project spanless mode remains Prohibited unless deliberately changed later.

- [ ] Clarify what specifically looks wrong in the Case view, beyond the missing obvious return action.
- [ ] Clarify the unexpected task shown after login as demo-reviewer: route/error presentation versus visible contents and apparent editability (F20).
- [x] Confirm the correction note is saved and two submissions exist.
- [ ] Compare the note in the two historical submissions; blocked by F13, not a failed persistence check.
- [x] Confirm required-reason mode clearly blocks creation of a spanless finding without a reason.
- [x] Add a spanless finding with a reason and verify its persistence after reload.
- [x] Explicitly save optional-reason mode and confirm creation without a reason after reloading the settings and editor.
- [x] Confirm that prohibited mode preserves existing spanless findings and the submission dialog explains the required correction.
- [x] Follow the submission repair link, attach supporting text with Add Mention and confirm that the repaired finding's missing-span warning disappears under prohibited mode.
- [x] Complete final submission under prohibited mode and confirm the assignment becomes read-only.
- [ ] Check remaining mode coverage: prohibited-mode creation blocking, optional-mode submission and clearing an existing annotation note remain unverified.
- [ ] Clarify and agree an additional-ontology acceptance scenario covering project configuration, annotation, or both.
- [ ] Exercise translation correction and the resulting annotation-review assignment.
- [ ] Resolve pending re-anchor findings and check clinical context preservation.
- [ ] Check unresolved review notes, defaulted-axis guidance and exported results.
- [ ] Check coupled scrolling, including its unavailable state at narrow widths, in the relevant read-only views.
- [ ] Review the collected findings together and decide scope and priority before implementation.

Manual acceptance remains open. Successful automated checks and working basic paths do not close the usability findings above.
