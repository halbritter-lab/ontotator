# Acceptance fixes 2026-10-21 — design

Source: manual acceptance on the :18210 stack (main `f6d04bd`), findings 1–11 and wish W1 in `.superpowers/roadmap-execution/manual-findings-2026-10-21.md`. Mockups (gitignored): `.superpowers/brainstorm/148565-1792589249/content/` — `wpa-ce-mockup.html` (WP-A, chosen), `wpa-scenarios.html` (scenario analysis), `wpe-consolidation-v2.html` (WP-E, chosen).

Branch `fix/acceptance-20261021`, worktree `.worktrees/acceptance-fixes`.

## User decisions (2026-10-21)

| ID  | Topic                           | Decision                                                                                                                                                                                                   |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | Row expansion (finding 1)       | Variant **C+E**: no inline expansion; one side panel per row with two entry points (text name = everything, stage cell = filtered to that stage). Below 700 px a popover at the cell.                      |
| U2  | Consolidation (findings 10, 11) | Variant **B**: dedicated consolidation view, clinical text left, finding groups right; matches taken over automatically; one decision per open group.                                                      |
| U3  | Different terms on one span     | Overlapping spans with different terms form **one** group "Term differs" (choose one term, keep both, or search another).                                                                                  |
| U4  | Who may consolidate (finding 8) | The lead is always offered as consolidator ("You"); when no member has the Adjudicator role, the launcher explains it and links Settings → Members.                                                        |
| U5  | Axis defaults (finding 5)       | New projects start with clinical creation defaults (assertion present, experiencer patient, temporality current) for the standard axes; editable in Settings; existing projects unchanged; seed sets them. |
| U6  | Term search prefill (finding 2) | Always prefill the marked text (selected, so typing replaces it). When the document language is not searched, the hint "Names are searched in English…" stays visible under the field.                     |
| U7  | Full agreement (W1)             | Final panel offers one click "All findings match – accept as final".                                                                                                                                       |

Finding 6 (display name + pseudonym) stays as is. Guidelines F2/F3 and narrow layout G are out of scope.

## WP-A Row panel (finding 1)

### Behaviour

- The inline expansion (`ExpandedRow.tsx`, `HistoryToggle` in `RowCells.tsx:344-370`, `ExpandedRowLoader` in `DocumentsPage.tsx`) is removed. The final panel (`FinalPanel.tsx`) becomes the **row panel**: one non-modal right-side panel per text row, the table stays visible and dimmed except the active row.
- **Entry points:**
  - Text name (now a link) → panel, Activity unfiltered.
  - Stage cell (Review, Annotation, Final) → panel, Activity filtered to that stage (chip "Annotation ✕", "show all stages").
  - Row action buttons that open the final decision ("Compare results…", "Accept result…") → panel with the decision on top (as today).
- Cells carry no frame and no chevron; hover and keyboard focus underline them; the cell is a `button` with accessible name "{stage} history, case-107 · de".
- **Panel content, top to bottom:**
  1. Header: text name + version; Previous / Next (shortcuts K / J, also ↑/↓ while focus is on the panel header) and Close (Esc returns focus to the opening cell).
  2. Stage strip: three compact tiles with the stage status (replaces the dimmed Final/Action columns); clicking a tile switches the filter.
  3. Decision block, only when the lead must decide (final choice, W1 accept, Consolidate…), unchanged logic from today's final panel apart from WP-B.
  4. Problem reports banner when open reports exist ("1 open problem report · Open").
  5. Tabs **Activity · Versions (n) · Details**.
     - Activity: history lines (`historyLines`) with a stage tag each, newest first, review reason quote inline; filtered by the stage chip. Under the filtered list the stage's admin actions: Annotation → "Reassign…", "Assign annotation review…"; Review → "Request correction…" (D26), "Assign a new review…" (D25 condition); Final → none.
     - Versions: today's `TextVersions` with its Reassign/Reopen/Remove tools.
     - Details: today's technical details (IDs, plan revision, acceptances, discards, rounds).
- Previous/Next walks the visible table rows in order; the panel keeps the active tab and stage filter.
- **"Start consolidation…"** leaves the expansion entirely; consolidation starts only from the decision block ("Consolidate…"), which exists only when a text version has ≥ 2 eligible submissions (fixes the en-source bug).
- **Not-planned rows:** the panel shows "Not in plan" with the existing "Plan…" action and an empty Activity ("Nothing has happened yet.").
- **Below 700 px (cards):** a stage cell opens a popover anchored to the cell with that stage's last 3 events, its admin actions and "Open full details" (opens the panel as full-screen sheet with Back). The text name opens the sheet directly.
- Calm rules: the panel fades in (no width animation); Previous/Next swaps content without remounting the panel frame; the table never shifts.

### Acceptance

Scenario click counts from `wpa-scenarios.html` hold: S1 1, S2 1, S3 4, S4 3, S6 1, S7 1, S8 2, S9 (10 rows) 1 + 9 × Next, S11 1. No table layout shift when opening/closing (browser test asserts the first row's bounding box is unchanged).

## WP-B Final panel (findings 7, 8, W1)

- **Consolidate… (7):** rendered as a normal (secondary, not quiet) button with its hint "Resolve the n differences together"; it is the primary button when agreement is not full and no submission is preselected.
- **Consolidator list (8, U4):** the launcher lists "You (Mia Kühn)" first, then members with the Adjudicator role. Choosing yourself shows "You will get the Adjudicator role for this project." The backend start-consolidation command grants the role to the acting lead in the same transaction when they lack it (audited role change), then creates the review assignment. `adjudicator_not_annotator` still applies: a lead who annotated one of the inputs is listed disabled with the reason "You annotated this text". When no other member has the Adjudicator role a note says "No member has the Adjudicator role yet. Give it in Settings → Members." with a link.
- **Full agreement (W1, U7):** when at least two submissions are compared, `matching == total`, `context_differences == 0` and every `only_here == 0`, the decision block shows "All findings match (n of n)" and one primary button **"Accept as final"**, which selects the earliest submitted submission through the existing `PUT /final-selections` (confirm dialog text "All 2 submissions contain the same findings. Accept them as the final result?"). The per-submission table moves under "Show submissions". Same refusal rules as today (`OWN_RESULT_NOT_SELECTABLE`, revision conflict).

## WP-C Editor (findings 2, 3, 4, 5)

- **Prefill (2, U6):** `canPrefill` no longer blocks the prefill; the marked text is always prefilled, selected and searched immediately. The "Names are searched in English…" hint renders when the document language is not an active search language. First verify on the :18210 stack that the observed case was a German text without German HPO names (if not, it is a separate bug to fix in the same WP). Note: the embedded bundle `src/ontocurator/web/assets/` is stale (last built Oct 18); Docker images rebuild it, the local `ontocurator serve` without `web_dir` does not. Rebuild it at the end of this branch.
- **First search latency (3):** measure first and second query on a fresh worker for a German project (target: first query after login < 1.5 s, later queries < 300 ms on the dev machine). Expected causes: lazy `pinned_view` deep copy, per-language-set TF-IDF subset build (`translations.py:280-289`), condition capture on first use. Fix by warming the project's pinned search service and its active language subset in the background when a workspace or project is opened (and at worker start for projects with open rounds), and caching subset indices per language set on the pinned service. Keep the result identical (regression test on ranking).
- **Half-width layout (4):** reproduce at 960 × 1000 with tree open/closed and the guidelines drawer open/closed; the text column keeps a minimum of 420 px; when it cannot, the inspector stacks under the text (the 701–1024 px grid already does this) and the sidebar collapses to its rail. Browser test at 960 px asserts the first paragraph of the clinical text is visible.
- **Creation defaults (5, U5):** project creation fills `creation_defaults` with `assertion=present`, `experiencer=patient`, `temporality=current` for each of these axes that the project's profile contains and whose allowed values include that value. Existing projects are not migrated. The t5 acceptance seed sets the same defaults. Settings → Creation defaults shows them as normal editable values.

## WP-D Guidelines settings (finding 9)

The publish form gets an action bar above the preview: file + note inputs, then a row with "Publish as vN" (primary) and "Discard", then facts, then the preview. The bar is sticky at the top of the form while the preview scrolls. Withdraw/Republish stay in the current-version block and the versions table.

## WP-E Consolidation view (findings 10, 11)

### Grouping (pure domain)

`domain/agreement.py` gets a public `groups(findings, order) -> tuple[Group, ...]` built on the existing cluster rule (same layer + term, ≥ 1 character overlap or both spanless; one finding per submission per cluster). A second pass merges clusters of the same layer with **different terms**, overlapping spans and disjoint submission sets into one group (U3). Each `Group` has members `{submission_id: finding_key}` and a kind:

| Kind            | Rule                                                                                     | Decision offered                                           |
| --------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `match`         | all submissions present, all exact, identical spans                                      | taken over automatically (undo possible)                   |
| `value_differs` | all present, same term, at least one axis or modifier differs                            | per differing axis: choose one person's value              |
| `span_differs`  | all present, same term, spans differ (may combine with `value_differs`: both rows shown) | choose one person's span                                   |
| `term_differs`  | merged clusters with different terms                                                     | choose one term, keep both, or "Other term…" (term search) |
| `partial`       | present in some but not all submissions (with 2 people: "only Luc Martin")               | Take over (optionally "edit values…") or Discard           |

Groups are ordered by the first span start (reading order), spanless groups last. With three or more people, a value chosen by a majority is labelled "2 of 3" but never preselected.

### Backend

- **Read:** `GET /api/v1/rounds/{round_id}/consolidation` (assignee of the round or project lead) returns the people (display name + pseudonym, same format as the lead workflow), the document text reference, and the groups with, per member, `input_id`, person, term id + label, axes, modifiers, spans, plus the group's state (`open`, `taken_over`, `chosen`, `discarded`, `kept_both`) and the resulting annotation id.
- **Resolve:** `POST /api/v1/workspaces/{workspace_id}/consolidation-groups/resolve` (MutationEnvelope) with `{input_ids, action: "take_over" | "choose" | "keep_both" | "discard", choice?: {term_id, span_from_input_id, axes}, note?, guidelines_unclear?: bool}`. One transaction: creates the consolidated annotation(s) with provenance `method: "merged"`, `source_refs: ["round-input:…"]` and records the resolving decisions — the existing `MergeRoundInputsService` logic, without the "save a draft first" step. `discard` records reject decisions only.
- **Undo:** `POST …/consolidation-groups/reopen` `{input_ids}` deletes the group's consolidated annotation(s) and decisions.
- **Automatic take-over:** when a consolidation round starts, all `match` groups are resolved with `take_over` in the same transaction (provenance as above, actor = system on behalf of the consolidator). Idempotent if repeated.
- **Note and flag:** stored with the resolving decision; the row panel's Activity shows "1 finding flagged: guidelines unclear" for the lead after submission.
- **Submit:** the existing round submit refuses while open groups remain (`CONSOLIDATION_GROUPS_OPEN`, count in the error); the frontend disables Submit with "(n open)".
- Authorization and contracts change → backend review WP (security-sensitive).

### Frontend

- New route/screen for a consolidation round (opened from the task list / Documents as today's consolidation editor): header "Consolidate case-107 · de v2 · Luc Martin, Tom Reis · n open", Submit.
- Left: clinical text read-only with one mark style per person (solid / dashed / dotted underline, plus name on hover and in the legend; colour is not the only cue); taken-over findings get a neutral background; the selected group is framed and scrolled into view.
- Right: "✓ n matching findings taken over · show" (collapsed list with undo), then the groups in reading order. Exactly one group is expanded: comparison table (rows = axes, text, term; columns = people; differences highlighted), choice chips naming the person ("absent · Tom Reis"), "+ note", "Guidelines unclear here". Choosing resolves immediately and moves to the next open group (J/K and ↑/↓ also move).
- Selecting text in the left pane offers "Add finding" (term search popover, standard axes with creation defaults) for something everyone missed.
- "Edit in editor…" opens today's editor in consolidation mode for special cases; there the sidebar shows the person's name per entry (finding 11) and the old "Merge overlapping submitted findings" panel (`MergeInputs.tsx`) is removed.
- Submit opens a summary ("7 findings: 4 matching · 2 chosen from differences · 1 taken over from Luc Martin · 1 discarded · 1 note · 1 flagged").

### Acceptance

Example with 8 groups (4 match, 1 value, 1 span, 1 partial, 1 term): 6 consolidator clicks from opening to submitted; no raw IDs anywhere in the view; names on every member; keyboard-only completion possible.

## Testing

- Pure: `groups()` table tests (all kinds, 3 submissions, spanless, term merge, ordering, majority label).
- Backend: resolve/reopen/auto take-over/submit gating/authorization (assignee, lead, other member refused), lead self-assign with role grant + audit, creation defaults on project creation, search warm-up and subset cache (same ranking).
- Frontend unit: row panel entry points, filter, Previous/Next, popover below 700 px, W1 block, launcher list states, prefill always, consolidation view interactions.
- Browser (own `HPO_E2E_PORT` per WP): Documents row panel (no layout shift), consolidation end-to-end (start as lead without Adjudicator role → consolidate → submit → accept final), editor at 960 px, guidelines publish without scrolling.
- Gate: `bash scripts/check.sh --quick --base main` per WP; full gate once at the end.

## Work packages and order

| WP  | Content                                                                         | Size | Files (disjoint)                                                                                      | Review        |
| --- | ------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------- | ------------- |
| E1  | `groups()` + consolidation read/resolve/reopen/auto take-over/submit gating API | L    | `domain/agreement.py`, `application/work_rounds.py` (+ new module), `api/work_round_routes.py`, tests | yes (backend) |
| B1  | Lead self-consolidation (role grant) backend                                    | M    | `application/document_rows.py` or consolidation start, `assignments/service.py`, tests                | yes (authz)   |
| C1  | Creation defaults + search warm-up/cache                                        | M    | `projects/service.py`, `ontology/registry.py`, `ontology/translations.py`, seed                       | no            |
| A1  | Row panel (replaces expansion)                                                  | L    | `documents/*`, `admin/DocumentsPage.tsx`                                                              | yes           |
| B2  | Final panel W1 + Consolidate button + launcher list                             | M    | `documents/FinalPanel.tsx`, `finalPanelText.ts`, `variants/ConsolidationLauncher.tsx`                 | no            |
| C2  | Prefill always + 960 px layout                                                  | S/M  | `editor/termSearch.ts`, `editor/SearchPanel.tsx`, `styles/screens/editor.css`                         | no            |
| D1  | Guidelines action bar                                                           | S    | `admin/GuidelinesSection.tsx`, `guidelines/guidelines.css`                                            | no            |
| E2  | Consolidation view frontend                                                     | L    | new `consolidation/*`, route, `tasks/MergeInputs.tsx` removal, `CaseScreen.tsx` sidebar names         | yes           |

Waves (max 3 agents): 1 = E1, C1, D1 · 2 = B1, C2, A1 · 3 = B2 (after A1, same panel), E2 (after E1). Then one code review over the branch, one fix agent, full gate, rebuild embedded bundle, fast-forward main, rebuild the :18210 stack.
