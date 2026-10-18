# Phase 0 acceptance: Impeccable workflow and interaction analysis

Date: 2026-10-18. Mode: **Operate**. Status: **recommendation for planning and review; no application implementation or design approval**.

## Evidence and authority

This analysis covers the complete [manual acceptance protocol](2026-10-18-phase0-manual-acceptance.md), F01–F33, including clarified suspicions, backend dependencies and deferred scenarios. It applies the Impeccable `shape`, `operate` and critique heuristic references to an existing product. The coordinator already loaded Impeccable context once for this session. No context rerun, detector, design-drift repair, application edit, account login, task opening, export retry or demo mutation was performed for this report.

This is a protocol-led design analysis, **not a fresh `$impeccable critique` command run**: there were no independent detector/browser assessments, new live screenshots, overlay or fresh numerical health score. Reading the previous critique does not make its 20/40 score applicable to today's candidate. Questions skipped: the acceptance interview already supplies the task, audience, failures and constraints; unresolved product choices are documented below for the coordinator rather than restarting discovery.

Sources inspected:

- [PRODUCT.md](../../../PRODUCT.md) and [DESIGN.md](../../../DESIGN.md): clinical text first, explicit traceable decisions, calm reading, English UI, local assets, pinned data, exact Unicode offsets and WCAG 2.2 AA. Direction C, the palette, fonts and soft highlighter treatment remain the visual authority.
- Current source in `frontend/src/app/{Shell,CaseScreen,AuthGate}.tsx`, `App.tsx`, `admin/{DocumentsPage,ProjectSettingsPage,ExportPage}.tsx`, `editor/{AnnotationPanel,ReviewActions}.tsx`, `variants/{CaseViewer,ComparePane,ReanchorPanel,versionState}.tsx`, `translation/DiffView.tsx`, generated API types and editor CSS. Source confirms rendering and available contracts; it does not prove every live state.
- Existing committed [1440 px prototype](t6a-prototype/editor-review-1440x900-v2.png), [1024 px prototype](t6a-prototype/editor-review-1024x768.png) and [390 px prototype](t6a-prototype/editor-review-390x844.png), visually inspected. They demonstrate the reading identity and previous layout alternatives. Different header, button, provenance and detail treatments across these captures show they are historical prototype evidence, not current acceptance screenshots. Current CSS independently confirms the 1024 px reserved lower inspector and fixed side columns in tree mode. Do not reproduce obsolete screenshot details as requirements.
- [Earlier critique summary](2026-10-17-ux-critique.md) and the root checkout's read-only `.impeccable/critique/2026-10-17T11-09-34Z__frontend-src.md`. These provide historical context, including already-fixed work and T4a/T6b overlap. They are not a second acceptance round or a mandate to redo prior fixes.

The user's **requirements and confirmed evidence** are authoritative: smooth HPO work first; representative full HPO with optional official translated-label search; document-first navigation with subordinate revisions; clearer identity, reading space, finding state and saving. The exact navigation design, collapse rules, labels, default policy, correction-request mechanism and reset scope are **not approved**. Every proposed control and sequence below is a recommendation.

## Design verdict and priorities

The existing reading world is appropriate and specific to clinical curation. The major problem is the interaction architecture surrounding it: the same finding appears as a text-change problem, a proposal, a draft annotation and a submission result without a clear account of how these representations relate. At project level, language variants, revisions and tasks appear as peer or mixed records. Styling these records individually would leave the central confusion intact.

The recommended direction is **one recognizable document context, a protected reading area, and a clear transition from work requiring attention to the resulting findings**. Keep provenance and history accessible without giving them the same visual prominence as today's decision.

Priorities, with severity indicating impact rather than implementation order:

1. **P0 — complete the scientific output path (F30).** Submission followed by unusable export prevents the intended outcome. A cleaner export error is necessary but cannot substitute for valid provenance conversion and a verified downloadable bundle.
2. **P1 — make project/document/task hierarchy coherent (F01/F07/F11/F12/F31–F33).** Leads must know which text and revision they are acting on and which task each status describes.
3. **P1 — make the correction-review cycle converge (F21–F29).** Show a persistent next action, readable change context, one clear completion action, and an obvious resulting finding. Preserve the distinct Unresolved decision.
4. **P1 — explain and retain user intent across save/validation/default workflows (F03/F10/F14/F16/F19/F25/F28/F29).** An entered value, a saved draft, a confirmed value and a submitted task have different meanings.
5. **P1 — protect reading space and reliable retrieval (F02/F04/F05/F08/F13/F17/F24/F27).** Users must be able to find a term, their saved result and its note without remembering where the interface put them.

Existing strengths to preserve: accurate clinical text and evidence survived the tested correction; required-reason validation and prohibited-mode repair were understandable; submitted read-only states, reopen/resubmit, reviewer-note persistence and version lineage worked after guidance. Comparison scrolling passed the reported Case-view checks. These are useful foundations, not reasons to close the remaining acceptance work.

## Information architecture: documents lead, tasks retain their own identity

Recommended conceptual hierarchy:

```text
Project
  Case (relationship between source and translated texts)
    Logical document / text lineage (one source or translated text)
      Text revision (language, origin, status, immutable text identity)
        Tasks / assignments (person, task kind, task status)
          Draft and immutable submissions, findings and their notes
```

This is a presentation model, not a proposed database migration. A source and its translation are different logical texts within a case. A correction is a later revision of its own text lineage. A translation-review outcome is not an annotation submission; an annotation note is not a reviewer note; an axis value is not a workflow status.

### Project shell

Give the active project one persistent labelled context, with its display name primary and technical key in secondary details when needed to disambiguate. Separate a clearly labelled **Switch project** action from navigation **inside** that project. Render `Documents`, `Progress`, `Export`, `Settings` once for the active manageable project; keep `My tasks`, `Profile` and administration distinct. On reading screens, preserve concise context without consuming the document width.

A searchable chooser is the preferred many-project alternative to rendering every project and its sections in the sidebar. Do not automatically select the first project after login or assume that every accessible project is manageable. Test long and duplicate display names, no manageable projects, unavailable remembered projects and loss of access. F33's exact horizontal control is unidentified: validate the new identity pattern against the user's concern without claiming the current component was identified.

### Document overview and detail

Recommend a compact document overview showing **one row per logical text lineage**, grouped under a visible case relationship. Keep the current revision, language, translation state and brief task summary in the row. Revisions become subordinate, explicitly expandable history or a document detail section. Use a document link as the main action; do not require users to recognize the repeated Case link in a flat version table.

The row should answer: which case/text/language, which revision is current, what work is active, what is completed, and what action is available? A concise task summary can say `Annotation: 1 reopened · Translation review: submitted`; the detail shows each assignment as separate `Task / Person / Status / Action` data. Avoid the generic `Reviews` shortcut beside an overloaded Assignees cell. In document context, name **Translation review history**, **Annotation tasks** and **Submissions** explicitly and keep their version association visible.

Implementation must derive same-language correction lineage from actual `derived_from` metadata, never by parsing IDs or grouping every `(case, language)` pair into one document. Multiple translation runs or independent roots in the same language remain distinguishable. The current APIs expose `VariantSummary`/case variants with lineage, while the flat document list lacks equivalent lineage detail; use existing case inventory through a view-model join where adequate. Define a backend summary contract only if identity or scale cannot be represented correctly. Do not invent a logical-document key in the UI.

**Current revision needs a deliberate policy.** Recommend latest revision within a lineage as the overview's current text, with a separate accepted/eligible state. Existing `pickVariant` can prefer an older accepted variant; preserve that distinction rather than silently redefining every existing selector. If latest is not eligible for annotation, show why and offer the latest eligible revision separately. Branching histories or multiple leaves must remain explicit until a canonical-current policy is agreed.

For the protocol's original table, the overview should convey three cases and six logical texts; accepted German v1 and its tasks belong together. After a German correction, its v2 belongs to the same translated-text lineage, with v1 in history. Task/submission references remain pinned to the revision on which they occurred.

Recommend reusing the existing Case viewer as the reading/comparison body of a document detail experience, with an explicit breadcrumb and **Documents** return link that retains list filters/selection. This avoids adding a second competing viewer. Existing assignment links must continue to open the assigned editing task, with read-only reading clearly labelled. A simpler initial alternative is grouped expandable rows plus the existing viewer; it is cheaper, but does not by itself provide a complete document context for tasks and notes.

### Comparison and metadata

Place the left and right text identities and their selectors at the same hierarchy level, directly above their own reading panes. Label `Text revision` separately from `Annotations/submission`; selections must describe exactly the content shown. Put comparison-wide controls in one shared toolbar. Keep each pane's language/revision visible even when advanced history is collapsed. Stack the paired pane headers with their corresponding text on narrow screens.

Retain the current deliberate opt-in for coupled scrolling and its read-only/narrow-width explanation. Check preference restoration across narrowing/widening; do not infer this from the already-passed wide Case-view check.

`Translation details` should remain progressive disclosure, grouped into `Source text`, `Translation run` and `Checks`, using a readable definition list. Lead with source language/revision and origin/status; provider/model are secondary; run/recipe identifiers are technical details. Preserve inherited-run wording for corrections and the facts needed for traceability. Do not move relevant failed checks out of sight merely to shorten the panel.

## The HPO annotation and review journey

### Enter, search and create

On entry, state project, document language/revision, task kind and editing/read-only status in a compact header. After an explicit account change, land on **My tasks** or a validated authorized destination; retain direct-link behavior for legitimate entry and safe same-user session recovery. F20 did not demonstrate exposed task contents. A username-scoped route/cache policy must be verified before deciding the precise routing change.

Make the HPO demo representative through a separately prepared, pinned full release and available official translations. Show the active search languages as a labelled control when translations exist; distinguish canonical English term identity from a matched translated label/synonym. Example search evidence can show the canonical term, HP code and `Matched German label` without translating the entire interface. Where translations are unavailable, explain the availability in relevant setup/help rather than showing an empty language menu. Release/translation compatibility and exact sample queries must be verified using the selected files. Preserve the current acceptance demo and its data; this report does not authorize loading a new ontology into it.

For ordinary evidence-backed annotation, preserve the efficient select-text → search → select-term path unless the broader creation model is explicitly changed. Focus search after selection without losing the evidence range. Make the currently active task and cancel route visible. Avoid adding a mandatory modal or extra confirmation to every routine finding.

For F16, retain the selected term and evidence/reason state after validation fails. Show the missing reason inline, then an explicit **Add finding** continuation when the form is complete. Do not require selecting the term again or silently create a clinical record on blur. The alternative is a fully staged composer with explicit Add for every new finding: more consistent, but it adds a click to every common annotation and needs a broader workflow decision. Either approach must have one clear completion action and retain the search result on error.

### Clinical defaults and clear finding details

The user's usual values are `present / patient / current`; their caution about missed correction is equally binding. Recommend **project/type-scoped configured starting values with explicit unconfirmed markers**, applied only to newly created findings. Do not override carried-over proposal values or existing drafts. Retain default provenance until a real value choice or deliberate confirmation is persisted; loading a form, selecting a finding, reviewing a warning or submitting must not silently clear it.

In the inspector, show `Assertion`, `Experiencer`, `Temporality` as stable labelled rows, each with its control, a plain `Preset — not confirmed` indicator where applicable, and a local **Confirm value** action. Changing a value is an explicit choice; a confirmation acts on the named field. Avoid another generic button among unrelated workflow controls. Reuse existing configuration semantics only after checking their meaning: `axis_defaults` being returned by settings does not prove that configurable UI starting values already have a write contract.

At submission, separate blockers from warnings. Preset values currently warn and do not inherently block; universal mandatory confirmation is **not decided**. Present the number of affected findings and a truthful route to inspect them. A summary must not imply those clinical values were confirmed merely because the user checked the whole-text acknowledgment.

Replace the list's dictionary-order `firstAxisVal` with a stable labelled summary, for example `Assertion: Present`, or an equally deliberate configured axis summary. Never substitute Experiencer when Assertion is empty. Keep useful evidence text/mention count and a plain **No text span** label; an icon may supplement it, but italics and color alone are insufficient. Consider `Your findings` for the current draft/result list and `Proposals to review` for incoming evidence. These are candidate labels, not approved vocabulary. Reference findings stay explicitly read-only; human/tool provenance stays available and origin-neutral review rules remain intact.

Make each list result a real keyboard-operable selection control with a visible selected state and consistent inspector-opening behavior. Current curated rows use clickable `li` elements; this is a source-level accessibility concern, separate from the unproven broken-click interpretation in F27. Selecting an already selected row should preferably retain its details, with a labelled Clear selection action for deselection; this is a proposed behavior change requiring focused review.

### Review after a text correction

Use three distinct concepts in the workspace: **Text changes needing review**, **Proposals to decide**, and **Resulting findings**. Counts must describe these distinct units; a resolved text-change item is not an undecided proposal. A repeated term may still represent different evidence/provenance, so do not deduplicate by HP code.

For a pending change, show a short term/title, status, reason for attention and the new supporting context first. Keep the original context, full clinical axes and provenance in labelled details unless they are necessary to choose the next action. Separate a status badge from the action group. Keep **Re-create on corrected text** and **Dismiss with reason** as clearly named alternatives; one is a main continuation, the other a secondary disposition, not two stacked fields.

For F22, the simplest robust initial presentation is labelled **Before** and **After** excerpts. `Krampfanfälle` and `Epileptische Anfälle` must each be readable in their own valid text. This avoids the character-fragment interleaving without changing canonical offsets or domain diff operations. Word/phrase-oriented inline diff is a later alternative if worth its Unicode/tokenization and regression cost. Preserve exact original/current strings and non-color change cues. Limit excerpt display with access to full context; never alter the stored clinical text to improve the diff.

Recommended re-creation sequence:

1. Choose **Re-create on corrected text**. Persistently display the active term and `Select the supporting text` instruction in the reading pane, with **Cancel**. A temporary context highlight may assist orientation but must not be the only instruction or imply a timeout.
2. Select the evidence and **Save re-created finding**. Preserve original clinical values and default markers; show the editable saved result in the inspector.
3. Review/correct clinical details and confirm any values the reviewer intends to confirm. The text-change item remains visibly `Review in progress`; saving the annotation alone has not claimed completion.
4. Choose **Complete text-change review**. Flush pending edits and link the latest saved annotation version explicitly. Only after that succeeds, update the pending/resolved counts and show **Open resulting finding**. Do not close or report completion on save/link failure.

This preferred sequence keeps the server's exact-version resolution invariant while avoiding the common save → resolved → confirm preset → unresolved-looking warning → re-link loop. It is a **recommendation**, not an approved domain-policy change. It requires the orchestration boundary to distinguish saving the finding from completing the text-change review. Genuine later changes can still invalidate a previously linked version. Explain that case specifically: `This finding changed after this text-change review was completed. Review the latest version and complete again.` Do not broadly auto-link every later edit.

An alternative is to complete on the initial save and automatically transfer the link only for confirmation metadata. That minimizes clicks but requires a carefully reviewed domain rule for which changes are safe; it risks weakening the invariant or hiding relevant changes. Keeping today's exact behavior with clearer warning/action text is cheaper, but retains the avoidable second completion in the observed common path.

After completion, remove the full resolved block from the default pending list, put it under **Completed text-change reviews (n)**, and select or visibly link the result in **Your findings**. Preserve completed context, dismissal reason and provenance in history. Offer a next pending item without stealing focus before the user can read the completion. Do not remove the resulting annotation or conflate it with the old problem entry. With no pending items, replace the problem area with a compact completion state.

### Unresolved decisions and defaults on immutable proposals

For Unresolved, preserve the intended outcome while revealing/focusing its required note. Use a small inline form headed `Mark this proposal unresolved` with **Save unresolved decision** and **Cancel**. Once saved, announce the decision and save status; subsequent note edits may use the existing autosave model. Do not require repeating an ambiguously identical Unresolved button, and do not save the outcome automatically because the user blurred its note. Reuse the intent-preserving form pattern from missing spanless reasons, without conflating the two domain operations.

Keep **reviewer uncertainty separate from clinical assertion**. Hypotonia can remain Unresolved with `present/patient/current` and an unconfirmed source default marker. The submission default-review route must explain the immutable source state and that confirming it through Edit & Replace changes the review outcome; it must not present replacement as a routine warning-clearance step. Recommended immediate treatment: preserve Unresolved, show `Source value was preset and is not confirmed`, retain the warning, and allow the already-supported submission. A future independent confirmation of immutable-source metadata would require an explicit model/export decision; do not simulate it by mutating the proposal or resetting the decision.

### Save, submit, correct and retrieve

Use concise persistent **Saving / Saved / Could not save — Retry** feedback for the current draft. Explain once, near task controls, that edits save automatically and **Submit** creates the completed read-only submission. Preserve failed inputs and pending operations during safe navigation/session recovery. A visible reason/note typed before its first decision is committed must not be misleadingly described as server-saved.

Expose **Submissions (n)** in task-level navigation/header actions and in the completed state, independent of the annotation list length. Historical details must render both **Annotation note** and **Reviewer note** in their own contexts and on the applicable snapshots, preserving multiline content and empty/absent distinctions. F13 requires displaying stored notes, not manufacturing a historical note or assuming its exact snapshot contents were verified. Link submissions from document context without merging them into text-revision history.

For correction requests, start with a truthful read-only completion notice: `Need a correction? A project lead can reopen this task.` Offer an in-app **Request correction** action only when its destination, persisted status and lead-visible handling exist. Preferred later complete flow: reason → submitted request linked to task/submission → lead inbox/action → approve/reopen or decline → status visible to requester. This needs backend state and permissions; an email link or nonfunctional notification would not satisfy it. An explicit manual contact process is a cheaper interim alternative, but is not a completed in-app request feature.

Do not solve F10 by adding a generic **Reset**. Recommend initially documenting autosave and exposing targeted existing actions clearly. Candidate later reset scope is the current selected finding or decision, with an exact preview of what will change. Restoring a whole starting task or historical submission must define whose baseline, reopened versus original state, evidence, notes, decisions and audit effects. An immutable submission is never overwritten. Broad undo/restore remains a product decision and should not block the clearer save model.

## Settings: a task-oriented configuration surface

Reorganize the existing content into labelled sections, preferably **General**, **Annotation rules**, **Ontology and profile**, **People**, with guideline content grouped where it makes sense for actual use. Prefer local section links and clear headings before adding a complicated settings router. Keep day-to-day annotation rules visible; place low-frequency technical pin/profile detail behind deliberate navigation/disclosure. Do not hide the locked-project reason or dependencies between rules and profile evidence requirements.

For each independently saved form, put its save action and status inside the same visual section: **Save annotation rules**, `Unsaved changes`, `Saving…`, `Annotation rules saved`, or a local error with Retry. Keep **Discard unsaved rule changes** local and explicit about discarding only client edits in that section. The saved state clears when a relevant value changes. Saving one section must preserve unsaved changes in another; the current implementation intentionally does this. No global Save that silently submits unrelated forms.

For the spanless rule, retain the understandable three modes and explain impact on future submission and existing findings. Read-back/reload must show the persisted value. An existing spanless finding remains inspectable when the rule becomes Prohibited and can be repaired with **Add mention**, as already confirmed. Do not confuse `reason for no text span` with every optional annotation comment or clear either field automatically on rule changes.

## Component boundaries and implementation implications

These boundaries describe ownership, not a requirement to create every named file. Extract cohesive behavior while changing it; avoid a separate speculative decomposition project.

| Boundary / current owner | Recommended responsibility | Contract that must remain explicit |
| --- | --- | --- |
| `Shell.tsx`, `AppShell.tsx` | Active-project context, project switcher, section navigation, breadcrumb | Permissions and task/document routes; one active context; keyboard and narrow-screen operation |
| `DocumentsPage.tsx` plus lineage view model | Logical document rows, current revision summary, subordinate versions | Real metadata joins; no ID parsing, task reassignment or history merging; current/eligible distinction |
| Document detail composed around `CaseViewer.tsx` | Reading context, tasks, history access and return destination | Exact text identity and route/query retention; editor remains task-specific |
| `CaseViewer.tsx`, `ComparePane.tsx`, `VariantSelectors.tsx` | Symmetric pane identity/selection and comparison-wide controls | Language/revision/annotation source remain separate; access and stale-request safeguards |
| `VariantDetails` | Structured source/run/check metadata | Inherited provenance stays accurate; technical identifiers remain reachable |
| `CaseScreen.tsx` orchestration with a focused text-change review controller | Active re-creation intent, save/flush/link sequence, selected result and cancellation | Separate annotation save from exact-version completion; preserve error recovery and independent reviewer state |
| `ReanchorPanel.tsx` | Pending queue and compact completed history, context navigation | Status versus actions; stable item keys; no domain resolution inferred by presentation |
| Context/change presentation beside `DiffView.tsx` | Before/after readability and optional detailed diff | Codepoint correctness and exact old/new text; no offset mutation |
| Finding list and shared finding summary | Stable axis labels, evidence/spanless state, selection | Same selected finding as inspector/text; semantic controls; provenance available |
| `AnnotationPanel.tsx` | Clinical field controls, preset indicators, named confirmation | Explicit saved confirmation; note versus reason semantics; read-only handling |
| `ReviewActions.tsx` | Proposal outcome intent, required-note form, immutable-source explanation | Unresolved does not alter clinical axes; no implicit outcome reset |
| `CaseScreen.tsx` history/submission presenters | Task submission list, snapshot notes, blocker/warning navigation | Immutable snapshots, correct version context, truthful save state |
| `ProjectSettingsPage.tsx` section forms | Grouping, dirty/saved state, local actions and feedback | Existing section persistence and lock semantics; default-policy API changes separately scoped |
| `ExportPage.tsx` plus backend export adapter | Actionable job state, error summary and technical details | Backend must produce valid provenance; show Download only for a successful authorized result |
| HPO acceptance setup/search-language controls | Representative pinned content and recognizable translation matching | Preserve current demo; local/offline search; no UI-wide translation implied |

Reuse `Button`, `Field`, `InlineMessage`, `StatusBadge`, `DataTable`, `Dialog`, `ConfirmDialog`, `Toolbar`, bundled icons and shortcut registry. Keep the frozen tokens/fonts and restrained status vocabulary. A clickability fix should use a semantic button/link, not a new decorative card or color. Decompose the large editor around these state ownership boundaries, retaining flush/navigation/auth and provenance safeguards.

## Finding-by-finding disposition

`Accept` below means include the observed requirement in planning, **not user approval of the proposed solution**. Related IDs remain separate trace references but need not become separate implementation tickets.

| ID | Evidence/disposition | Proposed treatment and acceptance proof |
| --- | --- | --- |
| F01 | Accept: orientation problem | Active project/display name and project→document→task context recognizable without explaining T5 or the technical key. Cover with F33. |
| F02 | Accept: realistic HPO setup | Separate pinned full-HPO candidate with compatible official search translations; demonstrate agreed German and English query matches and identity. No reseed of the current demo. |
| F03 | Accept need; policy unresolved | Project/type preset recommendation with unconfirmed markers; do not silently confirm. Scope, configured values and submission policy need approval. |
| F04 | Accept: text squeezed | Empty/secondary panes no longer consume primary reading space; verify normal and half-screen-equivalent widths, without inventing the original viewport size. |
| F05 | Accept: history hard to find | Submissions discoverable at task level and after submit; still accessible with a long finding list. |
| F06 | Accept workflow gap; backend-dependent | Explain reopen now; plan a complete persisted correction request only with handling/status. Requester can identify outcome without pretending a message was sent. |
| F07 | Accept document-first requirement | Group logical texts; subordinate revisions; task/person/status separately scannable; demonstrate original six-row scenario and corrected German v2. |
| F08 | Accept source-supported presentation bug | Stable named-axis summary; Assertion empty plus Experiencer Other person never produces an unlabeled `other` as if Assertion changed. |
| F09 | Clarified, fold into F08 | No separate axis-persistence repair. Regression checks must distinguish the two axes and not fabricate data corruption. |
| F10 | Accept save-model problem; broad reset deferred | Draft versus submission explained; save/failure visible; document targeted actions. Define baseline and scope before any whole-task restore. |
| F11 | Accept, join F07 | Explicit Translation review history distinct from assignment management, annotation review and annotation submissions. |
| F12 | Accept orientation/return problem | Reading view labelled; direct Documents return restores useful context. Do not claim browser Back was broken. |
| F13 | Accept display omission | Render stored snapshot annotation notes independently from decision notes; verify both historical submissions' actual stored contents. No inferred loss/reconstruction. |
| F14 | Accept section hierarchy issue | Task-oriented settings groups with bounded forms and local scope; the spanless rule and its save are found without page-search guidance. |
| F15 | Defer broader scenarios | HPO first; preserve model generality and existing layer/provenance distinctions. Define an actual additional-ontology scenario later; no unsupported-multi-ontology claim. |
| F16 | Accept retained-intent issue | Missing reason retains selected term; inline error plus explicit Add continuation saves once. Validating the rule remains mandatory. |
| F17 | Accept optional presentation improvement | Plain No text span label, optionally supplemented by an icon; readable without color/italics; no claim the old label was absent. |
| F18 | Clarified, fold into F19 | Optional mode worked after actual Save rules. No backend optional-mode repair from this report; remaining optional submission/note-clear coverage stays open. |
| F19 | Accept save discoverability/scope | Section-owned dirty/save/success/error state; saved optional setting survives reload; feedback is recognized, not just present in source. |
| F20 | Accept navigation issue; cause unverified | Account switch starts in appropriate task context or explains unavailable deep link; no stale contents. Distinguish explicit switch from same-user session recovery. |
| F21 | Accept review hierarchy issue | Compact pending title/status/reason, clearly grouped actions and optional clinical/context details; no full dot-separated block as the primary interface. |
| F22 | Accept readable diff issue | Exact before/after words readable separately; no mixed `KramEpfaileptische Anfälle`; no stored-text or offset change. |
| F23 | Accept persistent guidance issue | Active selection mode has durable term, next-step instruction and Cancel; no dependence on 2-second highlight. |
| F24 | Accept completion discoverability issue | Completed context leaves the pending presentation; resulting finding opens directly; completed history retained. No missing-annotation repair assumed. |
| F25 | Accept field/action hierarchy issue | Preset marker and named confirmation next to its axis, visibly distinct from save/delete/review actions; preservation of original values tested. |
| F26 | Accept exact-version interaction issue | Prefer save→review values→Complete latest version; later edits explain invalidation specifically. Backend exact-version checks retained; no broad automatic linking. |
| F27 | Accept terminology/selection problem | Clear relationship between pending problem and resulting finding; semantic list control and text mark both open the same inspector. No assumed broken existing click handler. |
| F28 | Accept repeated-action recovery issue | Retain Unresolved intent; note form's Save commits it once; note and outcome survive reload; clinical axes unchanged. |
| F29 | Accept warning/destination mismatch | Immutable source defaults explained; Unresolved preserved without forced Edit & Replace. Submission warning remains truthful and nonblocking under current policy. |
| F30 | Confirmed release blocker; backend first | Normalize export provenance correctly and verify ZIP contents including recreated finding and Unresolved flag/note/axes. Plain failure summary plus expandable diagnostics; never remove provenance or modify demo data to make it pass. |
| F31 | Accept paired-pane hierarchy issue | Matching selector/header roles above their respective panes; current identities visible when history collapsed and when stacked. |
| F32 | Accept metadata scanability issue | Source/run/check groups, readable label/value alignment and retained technical detail; no unsupported claim of missing facts. |
| F33 | Accept identity concern and scaling risk | One active project, explicit switcher and bounded sections; exercise realistic many-project fixture. Exact old horizontal control and real scale performance remain unverified. |

## Responsive, accessibility and state acceptance requirements

The product is a long-session desktop tool, including narrow desktop windows. Mobile support should retain task access and state; it does not justify shrinking clinical text or permanently stacking empty controls into the reading area.

- **Wide:** allow a compact findings pane and an inspector only when useful. Text should approach the existing 68ch reading measure when space permits, retain its reading type size and not move because a mark is selected. Empty inspector content should not reserve a large column. Show list/inspector toggles with their state; restore context when reopened.
- **Intermediate:** choose a two-pane/drawer arrangement that protects the reading surface; do not reserve a large lower strip for an empty inspector. When editing details, provide a clear return to the same text position/selection. Tree browsing and comparison must follow the same space budget rather than adding another simultaneous permanent pane. A resizable layout is a possible later enhancement; collapsible useful panes address the immediate problem with less state complexity.
- **Narrow:** retain the existing List/Document/Details concept where appropriate, with labelled active state and counts. On evidence selection, move to search/details deliberately and offer Return to document. No annotation/evidence/note loss on pane switches. Compare texts stack with their identities attached; explain unavailable coupled scrolling. Avoid nested page-width scrollbars for ordinary forms.
- **Widths and zoom:** test at existing 1440×900, 1024×768, 390×844 fixtures plus 1280 and 768 px transition cases, and at 200% zoom. The user's half-screen report is not a specific breakpoint. Test 320 CSS px reflow where applicable. Data tables may retain a labelled horizontal-scrolling region, while document identity and primary row action remain findable.
- **Keyboard and assistive technology:** every result, switcher, disclosure, form, review outcome, text-selection route and pane control is operable without a pointer; preserve existing keyboard evidence selection or provide an equivalent explicit mechanism. Use visible focus, semantic headings/regions, meaningful names and current/expanded state. Report source-level gaps separately from measured conformance. Restore focus after dialogs/disclosures, announce save/error/queue changes without repeatedly reading an entire document, and put errors next to the relevant control. Never make a transient highlight the only next-step cue.
- **Visual/access constraints:** preserve functional type ≥12 px, reading font/measure, existing AA text/control/mark contrasts and non-color status cues. Touch actions should have usable target size/spacing. Do not introduce palette, display font, motion or icon changes to express a new world. Respect reduced motion and local/offline assets.
- **State coverage:** empty, one, many and long-label findings; multiple equal HP terms with different evidence; spanless rules in all modes; immutable source/defaults; loading, failed save, failed link, canceled intent, stale response, permission loss, submitted read-only and reopened task. Queue filtering must not conceal undecided blockers or count completed history as pending.
- **Scale coverage:** use synthetic fixtures for many manageable projects, multiple same-language text roots, long names/IDs, several revisions, multiple people/tasks and enough findings to push history below the fold. These are test ranges, not claims about measured production scale. Preserve selection and route context when filters change; use paging/search if observed data size warrants it rather than rendering all detail eagerly.

## Efficient delivery and proof

Plan coherent vertical slices; F IDs are traceability, not 33 separate redesign tasks. Resolve boundary contracts early, then share presenters and state rather than creating one-off fixes in the large editor.

1. **Output correctness and immediate trust:** fix F30 in the export boundary with focused integration/contract coverage. Add snapshot note rendering (F13) and stable axis summary (F08/F09), each with a regression that proves a formerly unobservable or misleading fact. Improve the technical export failure's summary without promising a user correction that cannot repair the exporter.
2. **Project/document orientation:** settle lineage/current-selection semantics, active-project shell and document overview/detail composition together (F01/F07/F11/F12/F31–F33). Use the actual acceptance table as a fixture. Build selectors/metadata and direct return in the shared viewer rather than inventing a second reader. Do not ship a label-only lead-table change as completion of the document hierarchy.
3. **Annotation and correction-review interaction:** protect reading space; implement retained term/outcome intent; reorganize pending versus completed work and result selection; stage explicit final text-change completion while keeping exact-version semantics (F04/F16/F17/F21–F28). Preserve keyboard paths during extraction. F26 requires integration coverage across annotation version changes, not only a panel rendering test.
4. **Saving, settings, history and clinical-default policy:** settings sections and save scope, clear draft/submission language and accessible history can ship without deciding broad resets. Configure starting defaults only after scope/policy approval and backend contract review; apply the immutable-proposal warning treatment without resetting Unresolved (F03/F05/F10/F14/F18/F19/F25/F29). F06's complete request feature is a separately scoped extension; its honest interim explanation can be small.
5. **Representative HPO acceptance and bounded verification:** prepare full HPO/translation inputs in a separate authorized candidate, then run the complete journey below. Defer F15's additional-ontology demo, whole-task restore and speculative layout personalization. Do not rebuild, replace or reseed the preserved acceptance runtime during planning.

Approval-dependent choices can be presented together as a short direction brief before application work: document-first hierarchy/current rule; active-project switcher; pane adaptation; staged text-change completion; preset scope/confirmation policy; retained-intent forms. Show alternatives and costs from this report. Correction requests, broad reset and new source-confirmation semantics need their own scope decisions; do not ask the user to repeat the factual acceptance interview.

The decisive acceptance script should demonstrate one coherent HPO job: choose project/document and revision → find canonical HPO term through available English/German search → create and correct evidence-backed/spanless findings → recognize preset clinical values → save/reload → submit and inspect notes in history → reopen/resubmit → review corrected translation → identify the new revision → re-create a changed finding with durable guidance → review its values and complete the exact latest version → find the normal saved result → mark another proposal Unresolved with one explicit note completion → submit with the source default marker explained → export/download and inspect the resulting annotations, reviewer flag/note, clinical axes and provenance. Preserve the user's existing demo as evidence; reproduce this on isolated authorized data for changed code.

Use focused component tests for field/selection semantics; backend/integration checks for export, defaults/version contracts and request state; and a small set of browser journeys for the cross-component sequence. Extend existing suites rather than snapshotting every cosmetic row. Previous test totals are historical; obtain fresh results for the changed code. Do not re-run the entire completed manual round just to rediscover the protocol.

Carry forward the protocol's remaining checks explicitly: historical note comparison after F13; prohibited-mode creation blocking; optional-mode submission and clearing an existing annotation note; exported Unresolved representation after F30; coupled scrolling in translation-review read-only mode and preference restoration after narrowing/widening; independent second-reviewer queues; Dismiss with reason; and replacement deletion/clinical changes beyond confirmation metadata. Additional-ontology scenarios remain deferred. Reset scope, correction-request handling, many-project behavior and the unidentified horizontal project control remain decision/evidence gaps rather than passed tests.

For visual verification, follow Impeccable's bounded passes: implement the agreed slice fully, inspect desktop/intermediate/narrow states in one batched round, fix the observed defects together, then perform at most one confirmation round. Accessibility, data integrity and export failures remain gates even if screenshots look calm. Acceptance remains open until F30 is fixed and the outstanding protocol checks are explicitly passed, deferred or blocked; successful submit alone does not close it.
