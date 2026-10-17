# UX critique of main (2026-10-17)

An impeccable critique of main at `1bf463f` ran against the local T5 demo with
Playwright screenshots, the impeccable detector and axe. Criteria: a simple,
self-explanatory interface; an orderly, calm interface; easy use for medical
scientists. Score: 20/40 (Nielsen heuristics). The full snapshot is in
`.impeccable/critique/` (untracked).

## Fixed on `feat/ux-critique-fixes`

1. Base typography and page layout for compact pages: scoped element styles,
   page container, capped field width, Progress stat row, one primary action
   on Export, responsive navigation (`7a766b9`).
2. Translation review redesign: one editable translation, sticky decision
   panel, readable checks, confirmation before the immutable submit, summary
   card for submitted reviews (`feat/ux-translation-review`).
3. Plain-language labels outside the editor: assignee and status values,
   Reviews dialog, Export and Upload explanations, date format, My tasks
   actions, Users and Profile pages (`feat/ux-clarify-labels`).

## Deferred to T4a

T4a Part 2 rebuilds `CaseScreen` and `AnnotationPanel`; change these labels
there rather than before:

- "Annotate from scratch" → "Independent annotation"; "Curated Annotations" →
  "Your annotations"; "Context Axes" → "Finding details" (present/absent,
  experiencer, temporality); "Spanless Annotation" needs a plain explanation.
- Hide the "Selection intent" bar unless the user is adding a segment.
- Show "Select text to start" in the empty editor near the text, not only in
  the right pane (and fix the typo "text,or").
- Read-only annotation view (`variants/ReadOnlyAnnotationView.tsx`): move
  layer/type ids, SHA version, run, set and bundle under "Technical details";
  replace "(defaulted)" with plain wording.
- Search: drop the "(ngram)" suffix; review ranking of weak fuzzy hits.
- Focus the term search after a text selection.
- Translation details in the editor: Provider/Model/Run/Source variant in plain
  words.
- Submission success: no "✓" glyph, no inline colours, plain date.

## Deferred to T6b

T6b decomposes `App.tsx` and `CaseScreen.tsx` and reduces clicks:

- Editor at 1024 px: collapse the empty detail pane to a slim rail until an
  annotation is selected, so the text keeps its height; avoid truncated header
  labels.
- Compare mode: keep the annotation list and detail pane usable (right drawer)
  instead of pushing them below both texts.
- One shell pattern for list and reading pages (sidebar vs. "Sections"
  disclosure), one breadcrumb (Project › Documents › Case) and no duplicate
  back link; the lead case viewer needs a way back to Documents.
- Case viewer toolbar: constrain the full-width "Compare" bar and align
  "Translation details".
- Word snapping for text selections.
- Remaining off-ramp font sizes in `editor.css` (e.g. 0.78rem).

## Open decision

Whether Case, Task, Document and Variant collapse into one user-facing noun is
postponed by the user.
