# Independent Assessment A — design and workflow

Method: isolated design assessment by `/root/ux_design_a`, before receiving Assessment B or other final review findings. Impeccable critique Assessment A, Operate mode. No source changes and no test suites run. Questions skipped: parent requested a bounded independent review without user questions and owns synthesis/fixes.

## Target and evidence limits

Reviewed the immutable candidate at `http://127.0.0.1:18190`, image `sha256:44186e3c2f685d693cea1f583f86613c1115bc57699a4670b61eb203f3c6a3e6`, source commit label `ba0b91b4ff3c73ae8d358896957a4dd84d20d57f`, source snapshot SHA256 `bd9e039462665507359af72c7a8a2e264e97f8a17a9ef8bd8f9d31fa050bd875`. The snapshot manifest, rather than the commit label alone, identifies uncommitted candidate content. Hash comparisons confirmed the inspected CaseScreen, AnnotationPanel-related behavior, ReanchorPanel, ReviewActions, ProjectSettingsPage, CaseViewer and SubmissionHistory source files matched the candidate manifest for the six explicitly checked principal files (AnnotationPanel was inspected but not included in that six-file hash batch). Later root fixes are outside this assessment.

Read PRODUCT.md, DESIGN.md, the original F01–F33 protocol, accepted remediation plan and workflow contract addendum. Impeccable context ran successfully; no ignore file content was returned. No B findings or other final reviews were read.

Used one fresh native Playwright tab, then closed it and logged out. Never visited protected port 18081. Desktop was 1440×1000; half-width editor 800×900; narrow translation review and export 390×844. These were real viewport captures and were visually inspected. Attempted real browser zoom with Ctrl+0 and four Ctrl+plus actions: innerWidth stayed 1440, DPR stayed 1, visual viewport scale stayed 1. Therefore **actual 200% browser zoom is unverified**; no CSS zoom or resized viewport is being claimed as browser zoom. Keyboard Space → Tab → Enter completed the submission dialog; Escape closed history/report dialogs. This does not establish complete editor keyboard accessibility.

## Design specificity and overall judgment

The warm paper sheet, serif clinical prose, restrained sans-serif controls and gentle highlighter vocabulary are well matched to prolonged clinical reading. This is recognizably a curation workspace rather than a generic dashboard. The strongest product-specific structure is the distinction between clinical values, submitted records, reviewer decisions and final lead selection.

The candidate improves recovery and auditability substantially, but the implementation often adds the right information without finishing its hierarchy. Settings and document administration remain lengthy inventories of controls; the editor header now competes with the text through several equally weighted workflow actions. Green technical checks would not resolve these visible burdens. I would retain the visual identity and improve progressive disclosure and completion feedback before describing the original UX concerns as closed.

## Heuristic scores

Scale: 0 absent/severe failure, 1 poor, 2 partial, 3 good, 4 excellent. All ten apply in Operate mode.

| # | Heuristic | Score | Evidence |
|---|---|---:|---|
| 1 | Visibility of system status | 2 | Saving→Saved and submission/report feedback work; newly submitted history remains falsely empty until reload. |
| 2 | Match with real world | 2 | Named clinical axes now make sense; technical round IDs, raw timestamps and export-preflight jargon still surface in ordinary choices. |
| 3 | User control and freedom | 3 | Visible return links, cancel/Escape, report/pause and explicit selection; no ordinary undo or restore should be inferred. |
| 4 | Consistency and standards | 2 | Coherent typography and buttons; comparison selector levels remain uneven, and final-selection access is hidden behind Submissions. |
| 5 | Error prevention | 3 | Reason recovery, explicit final selection and warning acknowledgement avoid silent actions; full correction/strict-default paths were not exercised. |
| 6 | Recognition rather than recall | 2 | Stable labelled axes and translation metadata help; long expanded trees and buried Rules still require searching and remembering locations. |
| 7 | Flexibility and efficiency | 3 | Keyboard submit works; search languages are adjustable; desktop text space improves. Full shortcut/tree workflow not verified. |
| 8 | Aesthetic and minimalist design | 2 | Strong reading surface; administration still gives details and histories too much default prominence. |
| 9 | Error recovery | 3 | Missing reason retains term and exposes Add annotation; report explanation is clear. Save/network failure and correction recovery not directly tested. |
| 10 | Help and documentation | 3 | Contextual reason, report/pause and export copy explain consequences; routine saved-work versus leaving behavior still lacks an obvious explanation. |
| | **Total** | **25/40** | Useful, coherent foundations; important orientation and completion gaps remain. |

## Strengths

1. At 1440 px, the clinical document receives roughly 800 px between a 260 px finding list and detail pane. At 800 px the inspector stacks below the text instead of squeezing a third column into the line measure. Both actual captures are readable without horizontal document overflow.
2. F16 recovery now holds the selected canonical term after a missing reason, focuses the required field, and offers a disabled→enabled Add annotation button. The ordinary search/result context remains visible. I completed this path successfully without selecting the term again.
3. Submitted history contains the actual annotation note, and final export separates exact selected results from research/latest-individual exports. The warning review names text/language omissions and the open report; acknowledgement is explicit, and the synthetic export job reached succeeded.

## Five priorities

### P1 — Successful submission leaves history visibly false (F05/F13 completion)

After submitting task 4 and choosing Stay in case, the editor showed Submitted/read-only while Submission history still said **No previous submissions yet**. Hash navigation to the same task did not fix it. A full page reload revealed Submission 1 with the correct timestamp and stored annotation note. This undermines the moment when a curator most needs assurance that their work is recorded. Update the editor's immutable-history view from the successful submission response or refetch it before presenting completion; keep selection/scroll stable. The history access also remains at the bottom of the left sidebar. Add a consistently visible task-level Submissions entry near the submitted status, with a direct View submitted result action in the success dialog. Suggested command: harden, then clarify.

### P1 — Settings still bury the rule and its save state (F14/F19)

The 1440×1000 initial Settings capture contains General and Guideline only. Rules begins below the viewport, and Save rules follows five rule choices plus all Hidden axis values. Changing the first spanless dropdown produces Unsaved changes in rules **after** that entire fieldset. Section-specific save logic and feedback are real improvements, but the original discovery failure remains plausible in precisely the same task. Introduce local section navigation (General, Annotation rules/defaults, Ontology/profile, Members), and place a clearly scoped save/status row within the active section near changed controls. Keep secondary hidden-value configuration in disclosure. I changed optional mode and discarded it; no setting was saved. Suggested command: layout/shape.

### P2 — The document tree is grouped correctly but expanded too deeply (F07/F11)

The default Documents page opens logical text, both languages, each version, all assignments and action rows. At 1440×1000, the first logical text consumes almost the entire page; the second and third are below it despite a six-document dataset. The group headings establish the accepted relationship, but details remain permanently prominent by default. Collapse versions/assignments until needed, show one compact language-level summary with selected result and actionable status, and expose current/older version details deliberately. Keep existing independent translation roots and exact version identity. Suggested command: distill/layout.

### P2 — Comparison still fails the original aligned-selector requirement (F31)

The actual compare capture places the left selectors below a Versions summary and the right selectors below a separate Compare header containing Couple scrolling/close. Their controls are visibly at different vertical levels. Both texts start aligned, but the identity controls still feel scoped differently. Render equal-height pane identity headers at the same hierarchy level; keep comparison-global coupling/close controls in a shared toolbar above both. Also consider replacing the full-width Request translation correction strip, which visually separates metadata and comparison with a large action bar. Suggested command: layout.

### P2 — Project picker opens off-screen at 390 px (F33)

The actual narrow export capture shows the project picker anchored off the left edge: labels and the beginnings of input/select content are clipped. documentElement.scrollWidth still equals 390, so a no-overflow assertion alone would miss this. Constrain the disclosure to available inline width and anchor it to the viewport or the start edge below the header at narrow widths; keep Find project and Current project labels readable. The closed selector and current-project-only section navigation are improvements. Suggested command: adapt.

## Cognitive load

Intrinsic load remains high: users must interpret text, choose ontology identity, judge evidence and confirm clinical axes. The interface should spend fewer of their remaining resources on navigation.

Checklist: single focus **partial/fail** (five top-level editor utilities plus primary submit); chunking **fail** (Rules and fully expanded tree); grouping **pass** for axes/metadata but weak for admin tasks; visual hierarchy **partial/fail** on Settings/tree; one decision at a time **pass** for missing-reason recovery and report; minimal choices **fail** in Rules and 10-result search; working memory **partial/fail** for final selection via Submissions and generic missing-selection destinations; progressive disclosure **fail** in default tree, **pass** for technical metadata. Overall administration is high cognitive load (at least four failed checks); ordinary annotation is moderate.

Concrete >4-option points: editor workflow strip contains keyboard help, Work rounds, Report a problem, My problem reports and Finish & Submit; Documents starts with five filter dimensions; Rules has five policy choices before nested hidden values; German search showed ten result buttons with long definitions. These counts do not mean domain choices should be removed indiscriminately. Group utilities and defer secondary configuration; keep enough clinical context to choose safely.

## Emotional journey and personas

The reading surface is calm on entry. German query success and the retained-term recovery provide confident progress. Saved status reassures during editing. Submission offers an explicit whole-text check and success receipt, then immediately undercuts that peak with empty history. Reporting is another reassuring point: the dialog states whose task pauses, who can read the report, and that history remains. The lead's warning list is truthful but repetitive, including two entries for one report/hold with the same destination.

**First-time annotator:** Saved findings and labelled axes are understandable. Case, accepted-translation and Task 4 still coexist in identity; Submissions is not in the header, and there is no visible routine statement that leaving does not undo saved work.

**Experienced clinical curator:** The 800 px text layout remains readable and stable, and explicit action recovery saves effort. Repeatedly scanning the workflow strip, tall axis summaries and the long sidebar costs attention across hours. Default confirmation remains a secondary button beneath each field in source; I did not directly exercise a preset and cannot claim F25 solved.

**Project lead managing many texts:** The tree's grouping is conceptually right; its expansion defaults make scanning worse as versions/tasks accumulate. Final selection is available within Submissions, but a No final result selected language heading does not itself communicate that destination. Progress contains the dashboard rather than a Dashboard-labelled navigation item. A single-project seed cannot establish many-project usability.

## F01–F33 dispositions

“Observed” means native browser interaction/visual evidence. “Source only” is a matching inspected implementation path, not acceptance. “Not exercised” is intentionally unresolved verification.

| ID | Evidence | Disposition against original pain point |
|---|---|---|
| F01 | Observed | Improved: explicit Project label, searchable disclosure, current project sections, secondary key. Fixture's T5 name remains; many-project scaling untested. |
| F02 | Observed | German Krampfanfälle found Seizure HP:0001250 with German matched label; EN/DE active. Full-release settings show hp 2026-09-01. All-language availability/persistence not exercised. |
| F03 | Observed settings + source only creation | Three configurable default controls and warning-policy description exist. Seed has No preset; my new finding began unspecified. Preset creation/confirmation not exercised. |
| F04 | Observed | Improved at 800 px: left 220 px, inspector below text, no page overflow. Complete small-device editor and real 200% zoom unverified. |
| F05 | Observed | Partial/open: explicit Submission history section exists but remains bottom-left; after submit it falsely stays empty until reload. |
| F06 | Observed | Report and pause works on submitted task; own/lead privacy and preserved-work consequences explained. Lead clean restart not exercised. |
| F07 | Observed | Partial: logical text→language→version grouping present, but default expanded assignments/actions overwhelm scanability. Multi-version tree not exercised. |
| F08 | Observed | Unlabelled changing-axis defect resolved in displayed path: stable Assertion/Experiencer/Temporality labels and values. Text fallback is tall rather than compact symbols. |
| F09 | Original clarification | Retain folded into F08; no separate data-integrity defect established or claimed. |
| F10 | Observed + source only | Saving→Saved, reload persistence and explicit work/report controls present. Ordinary leaving-save model remains unexplained in visible workspace; reset/restart not exercised. |
| F11 | Observed | Translation reviews renamed clearly and assignments separated. Default expansion still burdens the relationship. |
| F12 | Observed | Back to Documents visible in viewer; de/v1 and selected-result identity visible. Filter-retention behavior only source-supported, not exercised. |
| F13 | Observed | Historical submission displays saved synthetic annotation note. Two-submission note comparison/review-note distinction not exercised; source separately renders review reasons. |
| F14 | Observed | Partial/open: named section forms are real, but page remains long with Rules below initial viewport and no local navigation. |
| F15 | Not exercised | Intentionally deferred beyond HPO; no multi-ontology UX conclusion. |
| F16 | Observed | Improved and completed: missing reason retains chosen term; repair enables Add annotation, no repeat term selection. |
| F17 | Observed | Spanless text displayed separately from labelled axes. Extra symbol treatment not present; original suggestion not a missing-label defect. |
| F18 | Original clarification + partial observed | No independent optional-validation defect inferred. Optional-mode save/create/submit not retested; local selection was discarded. |
| F19 | Observed + source only save | Local dirty message exists, scoped Save rules/Discard exist; placement is still below full Rules section. Successful settings save feedback not exercised. |
| F20 | Observed | Different-account login returned lead/reviewer to My tasks before direct navigation; no other person's task content shown. Same-user expiry recovery not exercised. |
| F21 | Source only | Pending queue still uses term/layer, reason, original axes, current context and stacked Pending/Re-create/Dismiss. Completion history is separated, but pending hierarchy not visually accepted. |
| F22 | Source only | Validated server-window check retained; DiffView now receives before/after for word display. Krampfanfälle correction regression not visually exercised. |
| F23 | Source only | Persistent supporting-text instruction and save→review→complete wording added; 2-second context highlight remains. Actual orientation not exercised. |
| F24 | Source only | Resolved items filter out of pending list into collapsed Completed text-change reviews; resulting regular finding workflow not exercised. |
| F25 | Source only | Confirmation remains secondary small button under axis with Default value hint. No live preset/defaulted finding inspected; cannot close visual hierarchy issue. |
| F26 | Source only | Saved finding explains current-version review need and has Complete text-change review; later edits require completion again. Live confirm/save/recomplete/reload not exercised. |
| F27 | Observed ordinary list + source only correction | Saved findings row opened details; Curated terminology replaced. Correction history has Open saved finding in source. Correction-specific discovery not exercised. |
| F28 | Source only | Unresolved now drafts intent, focuses reason and offers Save decision, distinct from ordinary note autosave. Actual proposal-review recovery not exercised. |
| F29 | Source only | Immutable proposal copy explains inability to confirm directly and warns that Edit & Replace changes decision. Strict-policy conflict explicitly explained. Live submission/default navigation not exercised. |
| F30 | Not exercised original reproduction | My simple selected-result export succeeded; this does **not** verify recreated-finding provenance or unresolved-note export. Original blocker scenario remains unverified here. |
| F31 | Observed | Still open: left/right selector blocks have different hierarchy/header heights; actual screenshot attached. |
| F32 | Observed | Improved: Source / Translation / Review groups and technical disclosure clearly organize metadata. |
| F33 | Observed | Improved desktop searchable selector and one current-project group; narrow open picker clips off left edge. Many-project navigation not exercised. |

## Actions performed and artifacts

Candidate mutations only: task 4/demo-annotator created spanless Seizure with present/patient/current and note `Synthetic UX acceptance: spanless recovery demonstration.`; submitted `sub-f568003ee202f17a`; opened report `report-6851e7c9c3c1493296288dffd762b02b` (task 4 held) with an explicitly synthetic reason; demo-lead selected that exact result for synthetic-accepted/de; acknowledged displayed warnings and five language omissions; final export job 2 reached UI succeeded. The archive was not downloaded or inspected. Report remains open/task held for reproducible dashboard review. No reset, reopen, correction or source edit performed. Task 1 and task 2 unchanged; task 1 was read only. Temporary credential automation files were removed; credentials are not part of this report.

Screenshots in this directory: `ux-a-editor-desktop.png`, `ux-a-editor-800.png`, `ux-a-documents.png`, `ux-a-compare.png`, `ux-a-settings.png`, `ux-a-export.png`, `ux-a-export-390.png`, `ux-a-review-390.png`. No detector output was consumed. No local server started by A. Browser access released to root/B before report writing.

Design questions for parent synthesis (not user questions): Can a completed submission link directly to its immutable result? Can the tree begin with one compact text/language decision instead of every task? Can annotation policy editing expose its save scope next to the field the lead just changed?
