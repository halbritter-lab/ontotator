# Lead workflow follow-ups: design

Status: Scope F1 to F7 approved by the user 2026-10-20; the detailed choices below (FD1 to FD14) were made while writing this spec and are open to the user's veto before implementation. Not implemented.
Builds on: [Lead workflow design](2026-10-20-lead-workflow-design.md) (called "the lead spec" below; decisions D1 to D26 stay) and the gaps recorded in `build/lead-workflow/orchestration-notes.md`. Plan: [2026-10-20-lead-followups.md](../plans/2026-10-20-lead-followups.md).

## Gaps verified in the code (branch `feat/lead-workflow`, 2026-10-20)

| ID | Gap | Evidence |
|---|---|---|
| F1 | "Correct the translation…" (D5 b) only opens the case viewer; the correction flow only works for accepted versions; a lead without the annotator role cannot hold a translation review | `DocumentsPage.tsx` `onCorrect` navigates to `projectCase`; `TranslationCorrectionAction` returns `null` unless `translation_status === "accepted"`; `TranslationWorkflowService.assign_correction` raises `TRANSLATION_NOT_ACCEPTED`; `TASK_ROLES["translation_review"] == {"annotator"}` gates `_require_target` and `qualifying_assignment` (used by `TranslationReviewService._authority`) |
| F2 | Progress count links are approximate | `RowQuery.step` is one code, `final` only `missing`/`none`, `plan` and `stage` single values; `progressLabels.ts` says "the link uses the closest filter"; e.g. "Rejected or queried" links `decision=translation`, "Accepted" links `translation_status=accepted` without the Review scope, "Paused" links `status=held` (also translation reviews) |
| F2 | Export link on Documents depends on the shown page | `DocumentsPage.tsx`: `exportFinals={page.groups.some(group => group.final_count > 0)}`; `DecisionBarView` has no project-wide final count |
| F3 | Batch and selection-summary filters miss `q` and `decision` | `DocumentRowFilters` (`api/assignment_batch_routes.py`, `extra="forbid"`) has no `q`/`decision`; `selectionFilters()` in `DocumentsPage.tsx` drops them ("no ID prefix"), so `not_shown` is wrong under a Case ID prefix or a decision filter |
| F4 | Problem report views carry pseudonym labels only | `ProblemReportView.reporter_label`, `state_changed_by_label`, `ReportHoldView.owner_label`/`created_by_label`/`released_by_label`, `PauseCandidate.owner_label` are `str` pseudonyms (`problem_report_views.py`); no `PersonRefView` |
| F5 | "Resolve…" does not focus the Translation block | `stageBlockHeadingId` is used only inside `StageBlocks.tsx`; `ResolveTranslation` renders under the row (`DocumentsPage.tsx` row panel) |
| F6 | An unreachable database hangs the CLI on Windows | `Database.__init__` and `schema.upgrade` call `create_engine` without `connect_args`; only `api/health.py` sets `connect_timeout` |
| F7 | Below 1100 px a submit reason is announced twice | branch `feat/review-annotation-flow`: `TranslationReviewScreen.tsx` `#review-submit-reason` is `aria-live="polite"` and, below 1100 px, `ReviewForm.tsx` renders the issue list `ol.review-issues` with `aria-live="polite"` as well |

## F1: The lead corrects a rejected or queried translation (D5 b)

### Behaviour

On a row whose next step is `resolve_rejected` or `resolve_queried`, the lead chooses "Correct the translation…" (Resolve options) or "Correct the translation yourself…" (Translation review block of the expanded row). Ontocurator opens the ordinary translation review screen for that exact version, with the lead as reviewer. The lead edits the text and submits "Accepted with corrections". The corrected text becomes the next version (`origin = correction`, `translation_status = accepted`), exactly as when a reviewer submits that decision; the rejected or queried version keeps its review record. Annotation can follow under `annotate_accepted_translations_only`.

### Decisions

| ID | Topic | Decision |
|---|---|---|
| FD1 | What represents the lead's review | An ordinary `translation_review` assignment of the lead to themselves with a new flag `assignments.lead_correction = true` (migration `0017_lead_corrections`, `down_revision = "0016"`, `server_default false`). The submitted review is an ordinary `translation_reviews` record (reviewer = the lead, qualification and languages snapshot as today). No acceptance record (D20) is written: the review record is the evidence. |
| FD2 | Permission | Only a project lead (`Action.MANAGE_ASSIGNMENTS`, membership role `lead`) can start it, only for themselves. The task-role check (`_require_target`, `TASK_ROLES`) is bypassed only for `lead_correction` rows; `qualifying_assignment` (and the readable-documents predicate built from `TASK_ROLES`) gains one branch: `task = 'translation_review' AND lead_correction AND role 'lead'`. A lead who loses the lead role loses access (`ASSIGNMENT_NOT_FOUND`), as for any task. Leads are not added to `TASK_ROLES`: the assign dialogs keep listing only annotators. |
| FD3 | Which version, when | The newest version of its chain whose latest review decision is `rejected` or `query` (status `reviewed`). Refused otherwise with new admin error `LEAD_CORRECTION_NOT_AVAILABLE` (`details.reason`: `not_rejected_or_queried`, `not_newest`, `review_open` when someone else holds an open translation review of the version). Stale text hash → `VARIANT_REVIEW_STALE`; discarded version → `NOT_IN_WORK_PLAN`. Idempotent: an open lead correction of the same lead and version is returned unchanged. |
| FD4 | Decision on submit | A lead correction can only be submitted as `accepted_corrected`. Any other decision is refused as `REVIEW_INVALID` with issue `LEAD_CORRECTION_DECISION`; the usual check (`check_review`) still requires a changed text. Accepting the rejected text unchanged is not offered (D5: no "accept without review"). |
| FD5 | Review flag (D26 pattern) | Starting a lead correction on a row with Review off turns Review on (`turn_review_on`, audited `work_plan.update`, no consequences, case revision +1), as D26. With Review on nothing changes in the plan. |
| FD6 | Languages and qualification | Checked at start, not only at submit: missing languages → `LANGUAGE_CONFIRMATION_REQUIRED` (the lead confirms inline), empty qualification → `QUALIFICATION_REQUIRED` (inline message with "Add your qualification in your profile"). |
| FD7 | Audit and revision | Start: `assignment.create` (existing) plus `translation.lead_correction_started` `{document_id, text_sha256, assignment_id}`. Submit: the existing `translation.review` audit and the existing re-anchoring job. The plan revision changes only through FD5. |
| FD8 | D25 and D26 afterwards | The corrected version is accepted through a review, so D25 "Assign a new review…" (lead/override acceptances only) is not offered for it; "Request translation correction" (D26, accepted versions) is, as for any reviewed acceptance. |
| FD9 | Rows, Progress, My tasks | No new step code. While open, the row shows `translation_review_in_progress` with the lead as owner; withdrawing uses the existing assignment actions. The task appears in the lead's My tasks and in People workload as an open translation review. Problem reports are not offered on a lead correction (the server refuses as today through `may_take`; the screen hides the action). |

### API

- `POST /api/v1/projects/{key}/documents/{doc}/lead-correction`, body `{expected_text_sha256: str, confirm_language: bool = false}` → `AssignmentView` (200). Errors as FD3, FD6, the existing management refusal (403) for non-leads.
- `AssignmentView.lead_correction: bool = False`, `ReviewWorkspace` response `lead_correction: bool = False` (additive).

### UI

- **Resolve options** (`ResolveTranslation`, mode `resolve`): "Correct the translation…" opens an inline panel inside the Translation review block (see F5): "You review v{n} yourself and submit it as Accepted with corrections. The corrected text becomes v{n+1} and counts as accepted." A language checkbox appears only on `LANGUAGE_CONFIRMATION_REQUIRED` ("Correct despite missing {languages} in your profile"). Primary button "Open translation review" posts and navigates to `#/tasks/{assignment_id}`. If the lead already holds an open lead correction of this version, the option reads "Continue your correction" and navigates directly.
- **Expanded row, Translation review block**: the same panel through "Correct the translation yourself…" for rows with `resolve_rejected`/`resolve_queried`; "Continue your correction" while one is open.
- **Translation review screen** (branch `feat/review-annotation-flow`, after `feat/lead-workflow` is merged there): with `lead_correction`, the decision group shows only "Accepted with corrections", preselected; a note above it: "You are correcting this translation as project lead."; no "Report a problem"; after submit a "Back to Documents" link instead of the next-task offer; issue message for `LEAD_CORRECTION_DECISION`: "A lead correction is submitted as Accepted with corrections."

## F2: Exact Progress links and Documents filters

| ID | Decision |
|---|---|
| FD10 | Documents query parameters (`document-rows`, `document-rows/case-ids`, batch and selection-summary filters): `final` gains `any` (the row has a final result); `step`, `stage` and `plan` become repeatable (OR within one parameter, AND across parameters; one value behaves as today); new `paused: "yes" \| "no"` (the row has a held annotate or review task). Hash routes keep one string per field, comma-joined (`step=resolve_rejected,resolve_queried`); the client sends repeated parameters. |
| FD11 | Each Progress count is defined as the number of rows its Documents query returns. `application/progress.py` computes every stage count by applying the Documents row predicate with that query (one shared predicate, no second derivation) and returns the query per count: `ProgressStageView.links: dict[str, DocumentLinkQuery]` (additive). The frontend links exactly these queries; `progressLabels.ts` keeps only copy. A contract test asserts, for every count, `count == bar.shown` of `GET document-rows` with its link. |
| FD12 | `DecisionBarView.finals: int = 0`: rows with a final result in the whole project, independent of filters and paging. Documents shows "Export final results…" when `bar.finals > 0`. |

Link table (Review on = `plan=review,review_and_annotate`; Annotate on = `plan=annotate,review_and_annotate`):

| Card · count | Query |
|---|---|
| Translation review · To assign | Review on, `step=assign_translation_review` |
| · In review | Review on, `step=translation_review_in_progress` |
| · Check failed, with reviewer | Review on, `translation_status=automatic_check_failed`, `step=translation_review_in_progress` |
| · Rejected or queried | Review on, `step=resolve_rejected,resolve_queried` |
| · Accepted | Review on, `translation_status=accepted` |
| Annotation · Waiting for translation review | Annotate on, `step=` the codes of `WAITING_FOR_REVIEW_STEPS` |
| · To assign | Annotate on, `step=assign_annotation` |
| · In progress | Annotate on, `step=annotation_in_progress,annotation_review_in_progress`, `paused=no` |
| · Paused by a problem report | Annotate on, `paused=yes` |
| · Submitted | Annotate on, `stage=final,done`, `paused=no` |
| Final result · Not ready | Annotate on, `stage=translation_review,annotation` |
| · To choose / To confirm | Annotate on, `step=choose_final` / `step=confirm_final` |
| · Final | Annotate on, `final=any` |

Where a current Progress count differs from its query (e.g. "Accepted" today needs every version accepted; `translation_status=accepted` matches the row's version filter), the query wins and the count follows it (FD11); the WP lists every changed count in its hand-back. The lede counts "needs your decision" and "to assign" keep their segment links (already exact).

## F3: Batch assign and selection summary use all Documents filters

`DocumentRowFilters` gains `q` (Case ID prefix) and `decision`, plus the F2 forms (repeatable `step`/`stage`/`plan`, `final=any`, `paused`); the `decision` exclusivity with `final` and `segment` is validated as on the rows endpoint (422). `selectionFilters()` passes every Documents filter except paging, `select` and `retain`. Semantics unchanged: filters never change the batch targets, their order, `steps`, `common` or `skipped` (the selection is what is assigned); they drive `not_shown` and the "n selected cases are hidden by the current filters" note, which are now exact.

## F4: Person references in problem reports (D1)

`ProblemReportView` gains `reporter: PersonRefView | None = None`, `state_changed_by: PersonRefView | None = None`; `ReportHoldView` gains `owner`, `created_by`, `released_by`; `PauseCandidate` gains `owner`; `ReportEventView` gains `actor: PersonRefView | None = None` beside `actor_label`. Built with `application/people.person_refs(viewer_is_lead=view.viewer_is_lead)`: display names only for leads and the viewer's own record (D1); the `*_label` strings stay (rule 10). The lead's report page, Decide section, pause list and confirmation copy use `personLabel()` ("Ana Weber (ann-0004)"); reporters and other non-leads keep seeing pseudonyms. Search in "Release pause" matches pseudonym and display name.

## F5: "Resolve…" focuses the Translation block

"Resolve…" (and "Assign review or accept…") expands the row if collapsed, renders the options inside the expanded row's Translation review stage block (`StageBlocks` gets a slot for that block) and moves focus to its heading (`stageBlockHeadingId(case, language, "translation_review")`, `tabIndex=-1` exists). Cancel, Done and Escape return focus to the row's action button. If the row has no Translation review block (Review off, D24 `not_accepted`), the options render below the row as today and their first heading takes focus. Cards (narrow layout) behave the same.

## F6: The CLI fails fast on an unreachable database

`Database` and `schema.upgrade` pass `connect_args={"connect_timeout": n}` with `n = 10` seconds by default (constant `CONNECT_TIMEOUT_SECONDS` in `storage/database.py`), unless the URL already sets `connect_timeout`. The CLI then reports the existing `DATABASE_UNAVAILABLE` message and exits 1 within about `n` seconds instead of hanging. Test: a CLI command against `postgresql://user:pw@192.0.2.1:5432/x` (TEST-NET-1, not routed) with the timeout patched to 2 s exits 1 with `DATABASE_UNAVAILABLE` in under 8 s, on Windows and Linux.

## F7: One announcement of the submit reason below 1100 px

Apply on `feat/review-annotation-flow`. `#review-submit-reason` stays the only live region for submit reasons at every width. Below 1100 px `ReviewForm`'s full issue list stays visible but is not a live region (no `aria-live`); at 1100 px and wider the list is not rendered in the form (unchanged). Screen readers announce the reason once.

## Out of scope

A lead correction of an accepted or pending translation (accepted versions use D26 "Request translation correction"; pending ones are reviewed normally); lead corrections assigned to another person; new Progress counts; problem-report display names in exports (exports stay pseudonymous).

## Testing

Backend: lead correction start/submit/authority/refusals, Review-off turn-on, annotation eligibility of the child (F1); filter semantics and the Progress-equals-Documents contract for every count (F2); `q`/`decision` in batch and summary (F3); person refs for lead and non-lead viewers (F4); CLI timeout (F6). Frontend: Resolve panel and navigation (F1), exact links and Export link (F2), filters passed (F3), labels (F4), focus (F5), single live region (F7). Browser: one scenario "rejected translation → lead correction → annotation assignable" and the Progress → Documents click-through with equal counts.
