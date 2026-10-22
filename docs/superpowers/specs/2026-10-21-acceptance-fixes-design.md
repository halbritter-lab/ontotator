# Acceptance fixes 2026-10-21 — design

Source: manual acceptance on the :18210 stack (main `f6d04bd`), findings 1–11 and wish W1 in `.superpowers/roadmap-execution/manual-findings-2026-10-21.md`. Mockups (gitignored): `.superpowers/brainstorm/148565-1792589249/content/` — `wpa-ce-mockup.html` (WP-A, chosen), `wpa-scenarios.html` (scenario analysis), `wpe-consolidation-v2.html` (WP-E, chosen). Revised after the technical review (`ontocurator-reviews/2026-10-21-acceptance-fixes-spec-claude.md`, items T1–T17) and the UX review (`…-spec-ux.md`, items X1–X21).

Branch `fix/acceptance-20261021`, worktree `.worktrees/acceptance-fixes`. Implementation plan: `docs/superpowers/plans/2026-10-21-acceptance-fixes.md`.

## Decisions (2026-10-21)

| ID  | Topic                                 | Decision                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| U1  | Row expansion (finding 1)             | Variant **C+E**: no inline expansion; one row panel with two entry points (text name = everything, stage cell = filtered to that stage). Below 700 px a popover at the cell.                                                                                                                                 |
| U2  | Consolidation (findings 10, 11)       | Variant **B**: dedicated consolidation view, clinical text and finding groups side by side; matches are kept automatically (with the X3 mitigations); one decision per open group.                                                                                                                           |
| U3  | Different terms on one span           | Overlapping spans with different terms form **one** group "Term differs" (choose one term, keep both, or search another).                                                                                                                                                                                    |
| U4  | Who may consolidate (finding 8)       | The lead is always offered as consolidator ("You"); when no member has the Adjudicator role, the launcher explains it and links Settings → Members.                                                                                                                                                          |
| U5  | Axis defaults (finding 5)             | New projects start with clinical creation defaults (assertion present, experiencer patient, temporality current); editable in Settings; existing projects unchanged; seed sets them.                                                                                                                         |
| U6  | Term search prefill (finding 2)       | Always prefill the marked text (selected, so typing replaces it). When the document language is not searched, the hint "Names are searched in English…" stays visible under the field.                                                                                                                       |
| U7  | Full agreement (W1)                   | One click "Accept as final" — offered only when every group of the consolidation grouping is `match` (identical spans, so W1 and consolidation agree, T7); selects the earliest **eligible** submission; zero findings everywhere → "Both submissions have no findings" + "Accept as final".                 |
| U8  | Names for the consolidator (T1)       | The assignee of a consolidation round sees the input authors' **display names** ("Luc Martin (ann-0004)"). **Deliberate deviation** from D1 of `2026-10-20-lead-workflow-design.md`, for consolidation only; all other reviewers keep pseudonyms. T1 is resolved by this decision, not by pseudonyms.        |
| U9  | Lead read of a consolidation (T2, X4) | Refused with `ROUND_NOT_FOUND` until the round is submitted; afterwards the lead gets a read-only "Open consolidation" view with the final states.                                                                                                                                                           |
| U10 | Row panel modality (X2, X13)          | Non-modal labelled `aside`, **no dimming or opacity**; only the active row is highlighted; clicking another row's entry switches the panel; Esc only while focus is inside; width `min(480px, 45vw)` (the prior spec's 480 px); DESIGN.md side-panel note updated.                                           |
| U11 | Shortcuts (X9, T15)                   | J/K through the existing `useShortcut` (never while typing), listed in "?" help; no ↑/↓ row or group shortcuts anywhere.                                                                                                                                                                                     |
| U12 | Person marks (X1)                     | One underline **lane** per person in a fixed order (offset lanes), not the solid/dashed/dotted semantics of DESIGN.md; up to 4 lanes; names always in the group card and the legend.                                                                                                                         |
| U13 | Consolidation view widths (X13)       | ≥ 1100 px text left, groups right; 700–1099 px text above (collapsible), groups below; below 700 px groups only, each with a text snippet.                                                                                                                                                                   |
| U14 | Auto take-over (X3)                   | Stays (U2) with mitigations: banner "n findings matched and were kept automatically. Check them in the text.", matched marks stay, a reopened match group offers Keep / Leave out / Edit values… / Other term…, the flag is allowed on matches, summary and Activity say "kept automatically (all matched)". |
| U15 | Search warm-up (T11)                  | Warm only when search conditions already exist, on workspace open only, through the existing single-flight build; no new subset cache.                                                                                                                                                                       |
| U16 | `merge-inputs` backend (T16)          | The backend endpoint and its tests stay (resolve shares its core); the frontend `MergeInputs.tsx`, `tests/mergeInputs.test.tsx`, its CSS in `editor.css` and the client method go.                                                                                                                           |

Finding 6 (display name + pseudonym) stays as is. Guidelines F2/F3 and narrow layout G are out of scope.

## WP-A Row panel (finding 1)

### Behaviour

- The inline expansion (`ExpandedRow.tsx`, `HistoryToggle` in `RowCells.tsx`, `ExpandedRowLoader` in `DocumentsPage.tsx`, `documents-expanded.css`) is removed. Today's final panel content becomes the **decision block** of a new **row panel**.
- **Frame (U10):** an `aside` labelled by its `h2` ("case-107 · de v2"; region name "Details, case-107 · de"). From 700 px it sits on the right below the AppShell header, full height, width `min(480px, 45vw)`, over the page without moving it (the table never shifts, nothing becomes `inert`, no opacity). The active row gets the active-row highlight. Focus moves to the panel heading on open. Clicking another row's entry switches the panel. Esc closes only while focus is inside (registered after the filter popover's Escape, `DocumentsPage.tsx:602`) and returns focus to the opening control; so does Close. Below 700 px the panel is a full-screen sheet with Back.
- **Entry points:**
  - Text name: a link-styled button, accessible name "Details, case-107 · de"; the editor link becomes "Open in editor, case-107 · de".
  - Stage cell (Review, Annotation, Final): a `button` without frame or chevron. The status word has a permanent subtle dotted underline (`border-strong`), a solid accent underline on hover/focus. Accessible name "Annotation: 0 of 2 submitted. Show history, case-108 · de". Opens the panel with Activity filtered to that stage (chip "Annotation ✕", "Show all stages").
  - Row actions that open the final decision ("Compare results…", "Accept as final…") → panel with the decision block on top.
- **Content, top to bottom:**
  1. Header: text name + version, Previous / Next (J / K, U11), Close. At the first/last visible row the button is `aria-disabled` and the key announces "First row" / "Last row". Group header rows are skipped.
  2. Stage strip: three compact tiles with the stage status; clicking a tile switches the filter.
  3. Decision block, only when the lead must decide (WP-B).
  4. Banner slot: "1 open problem report · Open" and "1 finding flagged: guidelines unclear · Open" (opens the read-only consolidation view at that group, X5).
  5. Tabs **Activity · Versions (n) · Details**. Activity: `historyLines` with a stage tag each, newest first, review reason inline; under the filtered list the stage's admin actions (Annotation → "Reassign…", "Assign annotation review…"; Review → "Request correction…" (D26), "Assign a new review…" (D25); Final → "Change final…" for a decided row without a final decision step (implementation note: it opens the decision block on the compare table; the spec first said none)). Empty: "Nothing has happened yet." / filtered "No annotation activity yet." Versions: `TextVersions` with its tools. Details: technical details.
- **Previous / Next** walks the visible table rows, keeps tab and stage filter, swaps content without remounting the frame: the header updates at once, the body shows "Loading case-109 · de…", a polite status announces the new row. Unsaved decision-block input (open `InlineConfirm`, typed reason) asks "Discard your unsaved choice?" before switching.
- **Route (X17):** `panel={case}:{language}` plus optional `panel_stage` (`review|annotation|final`) and `panel_tab` (`activity|versions|details`) (implemented as `panel_stage`/`panel_tab` because `stage` is already the table's stage filter); Back from the editor restores the filtered panel. The legacy `open=` value (used by `ProblemReportDetail.tsx:173`) opens the panel for that row.
- **Consolidation** starts only from the decision block ("Consolidate…"), which exists only when a text version has ≥ 2 eligible submissions (fixes the en-source bug). "Start consolidation…" disappears from the row.
- **Not-planned rows:** one wording everywhere, "Not planned"; the panel shows it with "Plan…" and "Nothing has happened yet."
- **Below 700 px (cards):** the card's "History" button becomes "Details" (the only way into the sheet, X19). A stage cell opens a popover with that stage's last 3 events, its admin actions and "Open full details" (the sheet).
- Calm rules: the panel fades in (150 ms, none under reduced motion), no width animation.

### Acceptance

Scenario click counts from `wpa-scenarios.html` hold: S1 1, S2 1, S3 4, S4 3, S6 1, S7 1, S8 2, S9 (10 rows) 1 + 9 × Next, S11 1. No layout shift (browser test: first row's bounding box unchanged on open/close). Focus lands on the panel heading; Esc from the table does not close the panel.

## WP-B Final panel and consolidation start (findings 7, 8, W1)

- **Consolidate… (7):** a normal secondary button with the hint "Resolve the n differences together"; primary when agreement is not full and no submission is preselected.
- **Consolidator list (8, U4):** "You (Mia Kühn)" first, then members with the Adjudicator role. Choosing yourself shows "You will get the Adjudicator role for this project." Disabled entries with reasons: `ADJUDICATOR_IS_ANNOTATOR` → "You annotated this text" / "Luc Martin annotated this text"; the missing-language confirmation keeps its checkbox (T17). No other adjudicator → "No member has the Adjudicator role yet. Give it in Settings → Members." with a link.
- **Start command (T3):** `POST /api/v1/projects/{key}/consolidations` with `{document_id, reviewer, source_submission_ids, reason, confirm_language, request_id, expected_workflow_revision}`, lead only, one transaction:
  1. lock members **exclusive**, then the project (same order as `create`);
  2. reviewer = acting lead without the role → `grant_roles` (`authz/memberships.py:79`): audits `project.member_add` and ends **no** session; an additive self-grant keeps the session because `current_access` re-reads access per request. Other reviewers must already hold the role;
  3. create or reuse the review assignment (same checks as `createAssignments`, incl. `ADJUDICATOR_IS_ANNOTATOR` and language confirmation), then `create_in` (which seeds the automatic take-overs, WP-E);
  4. one receipt (idempotent per `request_id`) and the audit `round.create`.
     The launcher uses this command for every reviewer; its two client calls (`createAssignments` + `startWorkRound`) go.
- **Full agreement (W1, U7):** the panel read (`FinalPanelView`) gets `all_match: bool` and `all_match_submission_id` computed with `groups()` (WP-E) over the compared eligible submissions. When ≥ 2 eligible submissions are compared, no consolidation covers them (VD16), and every group is `match`: "All findings match (n of n)" and one primary **"Accept as final"**, selecting `all_match_submission_id` (the earliest **eligible** one) through `PUT /final-selections`. Zero findings in all: "Both submissions have no findings" ("No submission has findings" for 3+). Confirm dialog: "Both submissions contain the same findings. Accept them as the final result?" ("All 3 submissions…") with "Open result" before "Accept as final". The per-submission table moves under "Show submissions". Refusals as today (`OWN_RESULT_NOT_SELECTABLE`, revision conflict).
- **After consolidation (X4):** the consolidation submission is labelled "Consolidated by Ana Weber" and preselected (VD16); W1 is not shown; "Open consolidation" opens the read-only view (U9).
- **Flags (X5):** the row read carries the number of findings flagged "guidelines unclear" in the submitted consolidation of the current version; the Final cell shows a second line "1 flagged", the banner slot shows it, and the Documents filter gets the facet "Flagged: guidelines unclear".
- **Copy (X14):** "Accept as final" everywhere (row action "Accept as final…", W1, per-submission button); "Both submissions" instead of "All 2 submissions".

## WP-C Editor and project defaults (findings 2, 3, 4, 5)

- **Prefill (2, U6):** `canPrefill` no longer blocks the prefill (also its call in `CaseScreen.tsx:1542`); the marked text is always prefilled, selected and searched. The "Names are searched in English…" hint renders when the document language is not an active search language, and the no-hits message then starts with it (X20). First verify on the :18210 stack that the observed case was a German text without German HPO names (if not, fix that bug in the same WP). DESIGN.md's term-search row is updated.
- **First search latency (3, U15):** measure first and second query on a fresh worker for a German project (target: first query after login < 1.5 s, later < 300 ms on the dev machine). On workspace open, when `get_search_conditions` is not `None` (warming never writes conditions, so translations are not frozen early), start a background warm-up through the single-flight `_package_builds` that builds the pinned view and the active language subset in the existing LRUs (`registry.py:390`, `translations.py:284-289`). No warm-up at worker start, no new cache. Ranking unchanged (regression test).
- **Half-width layout (4):** reproduce at 960 × 1000 with tree open/closed and the guidelines drawer open/closed; the text column keeps at least 420 px; otherwise the inspector stacks under the text (as in the 701–1024 px grid) and the sidebar collapses to its rail. Browser test at 960 px: the first paragraph of the clinical text is visible.
- **Creation defaults (5, U5, T12):** project creation fills `creation_defaults` per editable `layer → type` with `assertion=present`, `experiencer=patient`, `temporality=current` (the values of `ontospan.default_axes()`) where the type has the axis and the value is allowed and not hidden. A profile or pin change before the first submission prunes defaults that no longer validate instead of raising `SETTINGS_INVALID`. Existing projects are not migrated. The t5 seed sets the same defaults. Settings → Creation defaults shows them as normal values.

## WP-D Guidelines settings (finding 9)

The publish form gets an action bar above the preview: file + note inputs, then "Publish as vN" (primary) and "Discard", then facts, then the preview. The bar is sticky at the top of the form while the preview scrolls. Withdraw/Republish stay in the current-version block and the versions table.

## WP-E Consolidation view (findings 10, 11)

### Grouping (pure domain)

`domain/agreement.py` gets `groups(findings, order) -> tuple[Group, ...]`:

- **Clusters** use the existing rule (≥ 1 character overlap or both spanless; one finding per submission per cluster) bucketed by `(layer_id, type_id, term_id)` (T5). `_Cluster.members` stores `{submission_id: finding_key}` (T6). `compare()` results stay unchanged (regression tests).
- **Term merge (U3, T4):** only clusters that are **not complete** merge, only within the same `(layer_id, type_id)`, only with disjoint submission sets. Overlap is measured on the union of member spans. Greedy over all candidate pairs, globally by largest pairwise overlap (measured once between the original clusters), then lowest rank; a pair merges while the submission sets of the merged groups stay disjoint. In a chain X(s1)–Y(s2)–Z(s1) only one of X, Z joins Y; the other stays its own group.
- **Kinds are a set (T4, X7):** `match` (exclusive: all submissions present, same term, equal axes, spans, cue segments and notes), `values_differ` (one row per differing axis), `span_differs` (spans or cue segments), `notes_differ`, `term_differs` (one row per term; each term's members may carry their own value/span rows), `partial` (some submission absent; combines with the rows among the present members; copy "Luc, Ana marked this · Tom has nothing here", no preselection). Modifiers are not compared (never populated, T6).
- The member taken over by default is the earliest input in `order` (T6). Groups are ordered by first span start, spanless last. With 3+ people a value chosen by a majority is labelled "2 of 3", never preselected.

| Kind(s)                 | Decision offered                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `match`                 | kept automatically; reopened: Keep / Leave out / Edit values… / Other term… (U14)         |
| `values_differ`         | per axis: one person's value ("absent · Tom Reis")                                        |
| `span_differs`          | one person's span                                                                         |
| `notes_differ`          | one person's note, or none (always offered); not both, see below                          |
| `term_differs`          | one term plus every other differing field, a whole finding, keep both, or "Other term…"   |
| `partial` (+ any above) | "Keep Luc Martin's finding" (optionally "Edit values…") or "Leave out", plus the rows     |

A group resolves when every row has a choice (X6).

**Every differing field, deviation (acceptance 2026-10-22):** differences are measured across **all** members of a group, also across terms (`Group.differing_axes`, `span_differs`, `notes_differ`; the majority label still counts members of one term only). A `term_differs` group therefore shows a term row **and** a row per other differing field (axis, text, note); choosing a term no longer settles them. With two or more rows the card also offers "Take Luc Martin's finding: Ataxia (HP:0001251) · absent · patient · current", which fills every row from that person and names everything it adopts; "Other term…" adds the found term to the term row and leaves the other rows to choose. The backend refuses `keep` on a group whose members differ in term or values and a `choose` that does not name every differing axis (`ROUND_INPUT_INVALID`), so an unresolved field always leaves the group open and blocks submit.

**Notes, deviation (final review 2026-10-21):** the note row offers each person's note and always "No note". "Both notes" is not offered: the resolve command takes one person's note (`note_from_input_id`); joining notes needs backend support and is deferred.

### Backend

- **Persistence (T8):** `ReviewDecision` (`domain/review.py`) gets `consolidation: ConsolidationMark | None = Field(None, exclude_if=lambda v: v is None)` with `{action: "auto" | "keep" | "choose" | "keep_both" | "leave_out", guidelines_unclear: bool, content_sha256: str}`. Existing decision hashes stay unchanged; no SQL migration (payload is JSONB). A group is **open** when any member lacks a decision or has only an uncertain decision (also covers rounds started before this change; submit gating `CONSOLIDATION_GROUPS_OPEN` uses the same rule); otherwise its state comes from `action` (decided in the editor without a mark: `leave_out` when all decisions reject, else `keep`); it is **edited** when the consolidated annotation's current content hash differs from `content_sha256` (edited in the editor, still resolved: an editor edit of a `cons-…` annotation keeps the marked decisions and points them at the new version, so the round submits without reopening). Deleting the consolidated annotation in the editor drops its decisions, so the group reads **open** again (submit refuses a missing replacement). A decision's resulting annotation is its replacement, else the target itself when `confirmed`; `content_sha256` is stored on decisions with a resulting annotation.
- **People (U8):** display name + pseudonym for the assignee and for leads (via `application/people.person_refs`, with the consolidation exception).
- **Read (U9):** `GET /api/v1/rounds/{round_id}/consolidation`. Assignee: full live state. Lead who is not the assignee: `ROUND_NOT_FOUND` until the round is submitted, afterwards read-only with the submitted states. Everyone else: `ROUND_NOT_FOUND` (as `_visible_round`). Payload: people, document reference (text, version, language), groups with a stable id (hash of sorted input ids), kinds, rows, members (`input_id`, person, term id + label + HPO code, axes, spans, cue segments, note), state, edited, note, flag and resulting annotation ids.
- **Resolve:** `POST /api/v1/workspaces/{workspace_id}/consolidation-groups/resolve` (MutationEnvelope) `{input_ids, action, choice?: {term_id, span_from_input_id, axes, note_from_input_id?}, note?, guidelines_unclear?}`. One transaction, the `MergeRoundInputsService` core without the "save a draft first" step: consolidated annotation(s) with deterministic ids `cons-{hash(round, sorted input_ids, n)}`, provenance `method: "merged"`, `source_refs: ["round-input:…"]`, and the resolving decisions with `consolidation`. `leave_out` records reject decisions only. Like merge it clears `checked_layer_ids`.
- **Annotate:** `POST …/consolidation-groups/annotate` `{input_ids, note?, guidelines_unclear}` changes note/flag of a resolved group, including automatic ones (U14).
- **Reopen:** `POST …/consolidation-groups/reopen` `{input_ids}` deletes the group's consolidated annotation(s) and decisions.
- **Automatic take-over (T9):** in `create_in` right after `_create_draft` (both start paths reach it): every `match` group gets the result of "Keep" (the `cons-…` annotation with `n` = 0 from the earliest member, provenance `merged` with the members' `round-input:…` refs, `changed` decisions) with `consolidation.action = "auto"` and `reviewer_id` = the consolidator, so automatic groups export like resolved ones and an editor edit reads edited; one edit event for the edit-log export, whose user is the caller who starts the round (the lead in the start command, or the consolidator), like every other write of `create_in`. Groups already decided are skipped, so it is idempotent.
- **Submit (T10):** the round submit (`application/submissions.py`) refuses `CONSOLIDATION_GROUPS_OPEN` with the count while groups are open. The view's Submit sends `document_checked: true` and handles `AXIS_CONFIRMATION_WARNING` like the editor.
- **Lead reads (X4, X5):** `application/document_row_submissions.py` / row read: "Consolidated by …" label and the flag count (WP-B).
- Authorization and contract changes → backend review.

### Frontend

- **Route** `#/projects/{key}/consolidations/{round_id}` with optional `group`; opened from the task list (as today's consolidation editor) and, read-only, from the row panel ("Open consolidation", flag links).
- **Header:** "Consolidate case-107 · de v2 · Luc Martin, Tom Reis · 4 open" and Submit.
- **Layout (U13):** ≥ 1100 px text left, groups right; 700–1099 px text on top ("Hide text"), groups below with the selected group in view; below 700 px groups only, each with a text snippet of its passage.
- **Text:** read-only; one underline lane per person in fixed order (lane 1 closest to the text), distinct offset, and (acceptance 2026-10-22) a distinct hue and line style per lane (`--lane-N-line`: 1 solid accent, 2 dashed warning, 3 dotted success, 4 double mark line; aliases of existing tokens) with the same key next to each person's column, take-over and value chip; with more than 4 people lane 4 combines the rest ("+n"). Legend names every lane. Kept findings (automatic or decided) get a neutral background and keep their lanes. The selected group is framed and scrolled into view only when off-screen, instantly under reduced motion (X18).
- **Groups:** banner "4 findings matched and were kept automatically. Check them in the text." with the list (expanded by default when ≤ 3, else "Show"); then groups in reading order. Exactly one is expanded: comparison table (rows = term, text, differing axes, note; columns = people; differences marked by weight and the word "differs", not colour only), choice chips naming the person, "+ note", "Guidelines unclear here". A resolved group collapses to "Hypotonia ✓ absent (Tom Reis) · Change" and the next open group opens; an Undo toast (Ctrl+Z) reopens it.
- **Keys (U11):** J / K next / previous group via `useShortcut`, never while typing, listed in "?" help.
- **Add finding:** selecting text offers "Add finding" (term search popover, standard axes with creation defaults) for something everyone missed; saved through the existing draft save.
- **Edit in editor…:** opens today's editor in consolidation mode; its sidebar shows the person's name per entry (finding 11, U8); `MergeInputs.tsx` is removed (U16). The group then shows "edited in editor"; reopening it warns "Reopening drops your edit from the editor."
- **States (X8):** groups show a loading placeholder; a revision conflict (second tab, reopened input, new text version, reassigned round) shows the `InlineConfirm` conflict outcome in the group card ("Changed by … at … · Review again" reloads); a withdrawn input or lost assignment makes the view read-only with the reason; a failed resolve keeps the group open with Retry.
- **Submit (X12):** while groups are open, "Submit · 4 open" stays focusable with `aria-disabled`, a reason and "Next open group". Otherwise a summary: "8 decisions → 7 findings: 4 kept automatically (all matched) · 2 decided · 1 kept from Luc Martin · 1 left out · 1 note · 1 flagged". After submit: primary "Next task: {text} ({language})" or "Back to my tasks", as in translation review.
- **Copy (X14):** "Keep Luc Martin's finding", "Leave out", "decided"; HPO codes are shown, internal IDs never.

### Acceptance

Example with 8 groups (4 match, 1 value, 1 span, 1 partial, 1 term, each open group one row): 6 consolidator clicks from opening to submitted; no internal IDs; a person label on every member; keyboard-only completion possible; read-only view for the lead after submission.

## Testing

- Pure: `groups()` table tests (every kind and combination, 3 submissions, spanless, term merge incl. chain and 2-of-3 + 1-of-3, type separation, ordering, majority label, earliest member); `compare()` unchanged.
- Backend: consolidation read authorization (assignee, lead before/after submit, other member → `ROUND_NOT_FOUND`); resolve/annotate/reopen; automatic take-over idempotent; submit gating; start command incl. self-grant (audit, session kept), `ADJUDICATOR_IS_ANNOTATOR`, idempotency; W1 `all_match`; flags and facet; creation defaults on creation and pruning; warm-up only with existing conditions (same ranking).
- Frontend unit: row panel entry points, filter, Previous/Next, route params, popover below 700 px, W1 block, launcher list states, prefill always, consolidation view interactions and states.
- Browser (own `HPO_E2E_PORT` per WP): Documents row panel (no layout shift), consolidation end-to-end (lead without Adjudicator role starts → consolidates → submits → accepts final), editor at 960 px, guidelines publish without scrolling.
- Gate: `bash scripts/check.sh --quick --base main` per WP; full gate once at the end.

## Work packages and waves

Details, files and steps: the implementation plan. Contract-touching WPs (`contracts/openapi.json`, `frontend/src/api/generated.ts`, `client.ts`) never share a wave.

| WP  | Content                                                                                       | Size | Review |
| --- | --------------------------------------------------------------------------------------------- | ---- | ------ |
| E1a | `groups()`, `ReviewDecision.consolidation`, consolidation read API, panel `all_match`         | L    | yes    |
| C1  | Creation defaults + pruning + seed; search warm-up                                            | M    | no     |
| C2  | Prefill always, no-hits hint, 960 px layout                                                   | S/M  | no     |
| B1  | Start command (self-grant), lead reads (consolidated by, flags, facet)                        | L    | yes    |
| A1  | Row panel (replaces the expansion), route params, DESIGN.md                                   | L    | yes    |
| E1b | Resolve / annotate / reopen, automatic take-over, submit gating                               | L    | yes    |
| B2  | Decision block: W1, Consolidate…, launcher on the command, flags UI, consolidation route stub | M    | no     |
| A3  | Cards below 700 px: stage popover                                                             | S    | no     |
| E2a | Consolidation view                                                                            | L    | yes    |
| E2b | Editor consolidation mode names, `MergeInputs` removal                                        | S/M  | no     |
| D1  | Guidelines action bar                                                                         | S    | no     |

Waves (max 3 agents): 1 = E1a, C1, C2 · 2 = B1, A1 · 3 = E1b, B2, A3 · 4 = E2a, E2b, D1. Then one code review over the branch, one fix agent, full gate, rebuild the embedded bundle, fast-forward main, rebuild the :18210 stack.
