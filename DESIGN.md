---
name: Ontocurator
description: Direction C — reading document
colors:
  surface: "#f7f4ee"
  surface-raised: "#fffdf8"
  surface-sunken: "#efebe3"
  text: "#1f1a14"
  text-muted: "#5f574b"
  on-accent: "#ffffff"
  border: "#ddd6c8"
  border-strong: "#8c8170"
  accent: "#1d4e89"
  accent-hover: "#163d6b"
  accent-light: "#e3ebf5"
  success: "#2f6b3a"
  success-light: "#e4efe3"
  warning: "#8a5a00"
  warning-light: "#f6ecd6"
  danger: "#a23b2a"
  danger-light: "#f6e2dd"
  focus-ring: "#1d4e89"
  mark-0-fill: "#f8f1a6"
  mark-1-fill: "#d0edc4"
  mark-2-fill: "#f9cba8"
  mark-3-fill: "#cad6fd"
  mark-4-fill: "#ecd0d6"
  mark-5-fill: "#b8e8ec"
  mark-line: "#3b342b"
  mark-selected: "#1d4e89"
  mark-negated-hatch: "#8c8170"
  review-badge-fill: "#f3e8ff"
  review-badge-text: "#7e22ce"
  assistant-gradient-start: "#7c3aed"
  assistant-gradient-end: "#db2777"
  danger-border: "#fca5a5"
  danger-hover-fill: "#fecaca"
  disabled-fill: "#94a3b8"
  obsolete-fill: "#f1f5f9"
  obsolete-border: "#cbd5e1"
  overlay-scrim: "rgba(15, 23, 42, 0.45)"
  dialog-shadow-colour: "rgba(0, 0, 0, 0.1)"
  dashboard-hero-start: "#eff6ff"
  dashboard-hero-end: "#e0e7ff"
  dashboard-hero-border: "#bfdbfe"
  dashboard-hero-shadow-colour: "rgba(0,0,0,0.05)"
  dashboard-table-shadow-colour: "rgba(0,0,0,0.04)"
  dashboard-row-fill: "#f8fafc"
  notice-success-text: "#166534"
  notice-success-border: "#86efac"
  notice-warning-fill: "#fef9c3"
  notice-warning-text: "#854d0e"
  notice-warning-border: "#facc15"
  notice-info-fill: "#e0f2fe"
  notice-info-text: "#075985"
  notice-info-border: "#7dd3fc"
  getting-started-shadow-colour: "rgba(0, 0, 0, 0.05)"
  session-card-shadow-colour: "rgba(0, 0, 0, 0.08)"
  flag-shadow-colour: "rgba(15, 23, 42, 0.18)"
  language-menu-shadow-colour: "rgba(15, 23, 42, 0.14)"
typography:
  xs:
    fontFamily: "\"Source Sans 3 Variable\", system-ui, -apple-system, \"Segoe UI\", sans-serif"
    fontSize: "0.75rem"
    lineHeight: "1rem"
    fontWeight: 400
  sm:
    fontFamily: "\"Source Sans 3 Variable\", system-ui, -apple-system, \"Segoe UI\", sans-serif"
    fontSize: "0.8125rem"
    lineHeight: "1.125rem"
    fontWeight: 400
  md:
    fontFamily: "\"Source Sans 3 Variable\", system-ui, -apple-system, \"Segoe UI\", sans-serif"
    fontSize: "0.875rem"
    lineHeight: "1.25rem"
    fontWeight: 400
  body:
    fontFamily: "\"Source Sans 3 Variable\", system-ui, -apple-system, \"Segoe UI\", sans-serif"
    fontSize: "0.9375rem"
    lineHeight: "1.375rem"
    fontWeight: 400
  reading:
    fontFamily: "\"Source Serif 4 Variable\", Georgia, \"Times New Roman\", serif"
    fontSize: "1.125rem"
    lineHeight: "1.875rem"
    fontWeight: 400
  title:
    fontFamily: "\"Source Serif 4 Variable\", Georgia, \"Times New Roman\", serif"
    fontSize: "1.375rem"
    lineHeight: "1.75rem"
    fontWeight: 400
  headline:
    fontFamily: "\"Source Serif 4 Variable\", Georgia, \"Times New Roman\", serif"
    fontSize: "1.75rem"
    lineHeight: "2.125rem"
    fontWeight: 400
rounded:
  radius-sm: "3px"
  radius: "6px"
  radius-lg: "10px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-5: "24px"
  space-6: "32px"
  space-7: "48px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.radius-sm}"
    padding: "8px 14px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.radius-sm}"
    padding: "8px 14px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.radius-sm}"
    padding: "8px 14px"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.danger}"
    rounded: "{rounded.radius-sm}"
    padding: "8px 14px"
---
# Design System: Ontocurator

## Overview

**Creative North Star: "Reading document (direction C)"**

Direction C, “reading document”: the text leads and controls recede. Warm paper surfaces, serif clinical text and restrained sans-serif controls support long clinical curation sessions. One primary action per view keeps the next decision clear.

The approved direction and soft highlighter treatment are frozen. This document records the implemented system; it does not introduce a new design direction. English UI and a light theme are the current product constraints.

**Key Characteristics:**

- The text leads; controls recede.
- One primary action per view.
- Meaning never depends on colour alone.
- Keyboard first; every action remains available without a shortcut.
- Offline operation: fonts, icons and other assets come from the app's origin.

This is binding for T3b, T5 and T4: build their screens with `ui/`, these tokens and the shortcut registry. T3b's shell uses `AppShell`, confirmation uses `ConfirmDialog`, and records use `DataTable`. Preserve these contracts or update the dependent plans together. T6b follows T4 with its own spec: click reduction in editor and review flows (keyboard-first operation, fewer confirmations, selection without intermediate steps) and decomposition of `App.tsx` and `app/CaseScreen.tsx`. T6a preserves workflows except the explicitly agreed Escape dismissal and guarded editor logout.

## Colors

The frontmatter records the exact colour values from `frontend/src/styles/tokens.css`. That CSS file is the implementation source of truth; documentation mirrors it. All colour literals in application styles belong there. Changing a colour requires passing `frontend/tests/tokens.test.ts` and user approval.

| Token group | Rule |
| --- | --- |
| `surface`, `surface-raised`, `surface-sunken` | Warm page, brighter document sheet, recessed bars. |
| `text`, `text-muted`, `on-accent` | Main text, secondary text and text on the primary action; text AA contrast ≥ 4.5:1. |
| `border`, `border-strong` | Hairlines decorate; strong borders identify controls (≥ 3:1 against surfaces). |
| `accent`, `accent-hover`, `accent-light` | Primary action, hover state and quiet selection fill. |
| `success`, `warning`, `danger` and their `-light` fills | Semantic states; always pair with text or shape. |
| `focus-ring` | Visible keyboard focus; ≥ 3:1 against every surface. |
| `mark-0-fill` through `mark-5-fill` | Soft highlighter slots, never semantic states. |
| `mark-line`, `mark-selected`, `mark-negated-hatch` | State lines, selected frame, absent-finding hatch. |
| `review-badge-*`, `assistant-gradient-*` | Existing provenance colour vocabulary; shared badges override earlier treatments with restrained tokens. |
| `danger-border`, `danger-hover-fill`, `disabled-fill`, `obsolete-*` | Existing destructive, disabled and obsolete control states. |
| `overlay-scrim`, `dialog-shadow-colour` | Existing overlay vocabulary; shared Dialog uses a text-colour mix and `shadow-2`. |
| `dashboard-hero-*`, `dashboard-table-shadow-colour`, `dashboard-row-fill` | Retained dashboard compatibility tokens. |
| `notice-success-*`, `notice-warning-*`, `notice-info-*` | Existing notice backgrounds, text and borders. |
| `getting-started-shadow-colour`, `session-card-shadow-colour`, `flag-shadow-colour`, `language-menu-shadow-colour` | Retained screen-specific depth. |

### Marks

The six fills and their exact values are `colors.mark-0-fill` through `colors.mark-5-fill` above. They paint the lower half of the line with a feathered upper edge. `editor/markColours.ts` is the sole meaning-to-slot mapping (`MARK_COLOUR_MEANING = "term"`): a stable hash gives the same term the same slot. These are not annotation-layer colours; `LayerControls` identifies layers.

| State | Class and visible treatment |
| --- | --- |
| Own annotation | `run--own`: solid 2 px underline. |
| Proposal under review | `run--target`: dashed 2 px underline. Human and AI proposals share this state; `AiBadge` carries provenance. |
| Read-only reference | `run--source`: dotted 2 px underline. |
| Multiple overlaps | `run--multi`: 3 px underline; own state takes precedence over target/source where they overlap. |
| Negated finding (`absent`) | `run--negated`: diagonal hatch over the fill; axis value stays in the detail pane. |
| Selected mention | `run--hot`, `run--hot-start`, `run--hot-end`: segmented frame with true segment ends; legacy `mention-span selected` retains its outline. |

No horizontal padding or margin may move text when a mark is selected or resized. New mark states need a distinct line style or pattern and a passing `tokens.test.ts`, plus browser verification of the rendered treatment.

The approved tests require text on every mark ≥ 4.5:1; state lines and selection ≥ 3:1 against marks and the sheet; CIEDE2000 pairwise fill separation ≥ 10 and fill-to-sheet ≥ 10 for normal vision; and pairwise separation ≥ 4 under Machado 2009 severity-1 protan, deutan and tritan simulations. These soft-fill thresholds are intentional; line styles carry meaning.

## Typography

Fonts are bundled as variable woff2 through Fontsource: Source Serif 4 for clinical reading, Source Sans 3 for controls and compact surfaces. Exact fallback stacks, the seven size/leading pairs and regular weight are in the frontmatter. `--weight-strong` is 600; `--weight-regular` is 400. Use `--font-mono` (`ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`) for codes and key labels. Reading measure `--measure-reading` is 68ch.

| Role | Size / leading at the default 16 px root | Use |
| --- | --- | --- |
| `xs` | 12 / 16 px | Functional minimum, badges and key labels. |
| `sm` | 13 / 18 px | Labels, secondary controls. |
| `md` | 14 / 20 px | Controls and compact text. |
| `body` | 15 / 22 px | Default application text. |
| `reading` | 18 / 30 px | Clinical document text. |
| `title` | 22 / 28 px | Section and shell titles. |
| `headline` | 28 / 34 px | Main headings. |

Use the paired `--size-*` and `--leading-*` tokens rather than inventing a new ramp. Never shrink functional text below 12 px. Fonts and their SIL OFL 1.1 texts ship locally under `web/assets/` and `web/licenses/`; never use CDN fonts.

## Layout

The spacing scale in frontmatter maps `--space-1` through `--space-7` to the existing rhythm. Use the small steps for control groups, medium steps for panel padding, and large steps for section separation.

Choose `AppShell density="reading"` for editor, document and comparison views; choose `density="compact"` for tables, lists, admin and workflow pages. The shell applies `.density-reading` or `.density-compact` to its main surface. Existing standalone surfaces can apply the class directly. These classes set tokens; descendants must consume them. `DataTable` explicitly chooses compact density even within a reading page.

| Density token | Default / reading | Compact |
| --- | --- | --- |
| `--body-font` | default sans; reading serif | sans |
| `--body-size` | default `size-base`; reading `size-reading` | `size-md` |
| `--body-leading` | default `leading-base`; reading `leading-reading` | `leading-md` |
| `--row-height` | 44px | 34px |
| `--cell-pad-y` | 10px | 6px |
| `--cell-pad-x` | 16px | 12px |
| `--control-height` | 36px | 30px |

The shell provides a skip link to `#main`, header/breadcrumb, user/logout and optional navigation. Reading main surfaces preserve the editor's independent scrolling; compact surfaces scroll their main content. In compact density `AppShell` wraps the page in `.shell-page`: one left-aligned column capped at `--page-max-width` (1100px) with `space-6` padding, in which raw `h1`/`h2`/`h3`, `fieldset`/`legend`, `dl`, lists and native fields take the type ramp, and `.form-control`/`.form-select` stop at `--field-max-width` while tables stay full width; pages add no padding of their own. Below 900 px the compact sidebar becomes a wrapping navigation band above the content; the reading shell keeps its "Sections" disclosure. The shell stacks below 700 px. Existing editor layouts adapt at 1279, 1024 and 700 px; use those incumbent transitions rather than making document content unreadably narrow.

## Elevation & Depth

Warm tonal surfaces and hairlines provide the default hierarchy. `--shadow-1` gives modest sheet/panel depth; `--shadow-2` lifts modal content. Their exact values live in the sidecar's shadow extensions and `tokens.css`. Existing screen shadow colour tokens remain compatibility values, not a reason to add new elevation levels.

Control colour/border transitions use the implemented 0.15s ease-out timing. The loading spinner uses 0.8s linear rotation and stops under reduced motion. Preserve `prefers-reduced-motion` support; do not animate clinical text position or mark geometry.

## Shapes

The three radius tokens in frontmatter correspond to small controls, ordinary containers and larger containers. Shared buttons and fields use `radius-sm`; do not turn controls into pills. Marks have square corners so adjacent and overlapping text segments remain exact. Focus uses `--focus-width: 2px` and `--focus-offset: 2px` with `--focus-ring`.

## Components

Import from `frontend/src/ui/`. Native attributes, event handlers, refs and caller class names remain available where the props extend the native element. Retain existing structural classes, IDs, accessible names and `data-testid` selectors during straight swaps.

| Component | Props / contract | Use and retained classes |
| --- | --- | --- |
| `Button` | Native button attrs except `type`; `variant=primary/secondary/quiet/danger` (secondary default), `size=md/sm`, `type=button/submit`, `loading`, `icon`; forwarded ref. | All actions; one primary per view. `btn`, `btn-{variant}`, `btn-sm`, `btn-spinner`, `btn-leading-icon`. Loading sets `aria-disabled` and `aria-busy` and swallows activation; it is not natively disabled, so a focused button keeps focus. A caller-set `aria-disabled` without `loading` still fires `onClick`, so the caller can explain why the action is unavailable. `.btn[aria-disabled="true"]` looks disabled and does not react to hover. |
| `IconButton` | Button props without children/icon; required `label`, `icon`. | Labelled compact action; `btn-icon` plus Button classes; aria-label and title. |
| `Field` | Required `id`, `label`, one control child; optional `hint`, `error`, `required`. | Shared label/error wiring; `form-group`, `form-label`, `field-hint`, `field-hint-error`; merges descriptions, sets invalid. |
| `TextInput` | `FieldOwn` plus native input attrs; forwarded ref. | Single-line entry; Field classes and `form-control`. |
| `Textarea` | `FieldOwn` plus native textarea attrs; forwarded ref. | Multiline entry; Field classes and `form-control`. |
| `Select` | `FieldOwn` plus native select attrs; forwarded ref. | Native choice; Field classes and `form-select`. |
| `Checkbox` | `id`, `label`, optional hint and native input attrs (no Field error prop); forwarded ref. | Boolean choice; `form-group`, `form-checkbox-row`, `form-checkbox`, `field-hint`. |
| `Dialog` | `open`, `title`, `children`; optional visible `heading`, `onClose`, `closeOnBackdrop=false`, `initialFocus`, `size=sm/md/lg`, `footer`. | Every modal; `modal-overlay`, `modal-content`, `ui-dialog`, `ui-dialog--{size}`, `ui-dialog-header`, `ui-dialog-heading`, `ui-dialog-close`, `ui-dialog-body`, `modal-actions`. Traps/restores focus and locks scroll; only top dialog handles keys. With `onClose` the header shows a labelled Close icon button, reachable by Tab but never given initial focus. The body scrolls; header and `footer` stay fixed. Below 700 px a `md` dialog becomes a full-height sheet. The Close button and Escape exist together, only with `onClose`: a caller suppresses both by omitting `onClose` (pending operations; "Case submitted" has neither). The dialog is capped at `max-height: min(90vh, calc(100dvh - var(--space-6)))`; widths are 400 / 540 / 760 px for `sm` / `md` / `lg`. |
| `ConfirmDialog` | `open`, `title`, `message`, `confirmLabel`, `onConfirm`, `onCancel`; `cancelLabel=Cancel`, `tone=primary/danger`, `busy=false`. | Explicit decisions; composes Dialog and Button classes. Busy blocks dismissal. |
| `InlineConfirm` | `ConfirmDialog` props minus `open`, plus `children`, `outcome` (`conflict` with `changedBy`, `changedAt`, `onReview` / `error` with `onRetry` / `session`), `headingLevel=3/4` (4 default), `conflictMessage` (replaces the default conflict sentence; the "Changed by … at …" suffix stays), `confirmUnavailable` (`reason` shown below the content, or `reasonId` of a reason the caller renders) with `onConfirmUnavailable`. | Confirmation bound to an item on the page, such as a table row; placement and the one-per-page policy belong to the caller. `inline-confirm`, `inline-confirm-title`, `inline-confirm-message`, `inline-confirm-notice`, `inline-confirm-actions`, `action-reason`. A labelled group; focus moves to the heading on open and to the notice on conflict. Escape cancels only while focus is inside, and is consumed without cancelling while busy. Busy keeps focus: Cancel and Retry use `aria-disabled`, confirm uses `loading`. An unavailable confirm stays focusable with `aria-disabled` and `aria-describedby` pointing at the reason; activating it calls `onConfirmUnavailable`. A conflict hides the children and offers "Review again" and "Close"; error and session outcomes say that nothing was saved. |
| `StatusBadge` | `children`; optional `status`, `tone=neutral/info/success/warning/danger`, `title`. | Status plus dot/ring/check/warning/cross shape; `status-pill`, `status-pill--{tone}`, `status-pill-shape`, `status-pill-dot`, `status-pill-ring`. `statusTone(status)` maps workflow statuses. Final marker: `<StatusBadge tone="success">Final</StatusBadge>` (check shape from `IconCheck`) on a row with class `final-row` (`success-light` tint, `success` left edge); `is-selected` stays reserved for selection state. |
| `InlineMessage` | `tone=info/success/warning/error`, `children`; optional `title`, `onDismiss`, `aria-label`. | Errors and feedback; `notice`, `notice-{tone}`, `notice-content`, `notice-title`. Errors are alerts, others statuses. |
| `DataTable<T>` | `label`, `columns`, `rows`, `rowKey`; optional `initialSort`, `empty`, `rowProps`, `className`, `groups`, `renderExpanded(row)`, `busy`. Column: `id`, `header`, `cell`, optional `sortValue`, `width`, `align=start/end`, `rowHeader`. Group (`DataTableGroup<T>`): `key`, `header`, `rows`, `expanded`, optional `headerProps`. | Lists of records; `data-table-scroll`, `data-table`, `density-compact`, `data-table-sort`, `data-table-sort-icon`, `is-selected`, `data-table-group`, `data-table-expanded`. Stable sort, within groups when grouped; `rowProps` retains row handlers/test selectors and selected state. See "Grouped expandable table". |
| `EmptyState` | `title`; optional `children`, `action`. | Explain an empty result and next action; `empty-state`, `empty-state-title`, `empty-state-body`, `empty-state-action`. |
| `Toolbar` | `label`, `children`, optional `className`. | Named, wrapping action group; `toolbar`, role group. |
| `Kbd` | `children`. | Key label; `kbd`. `formatKey` shortens arrows and Escape. |
| `AppShell` | `user`, `children`; optional `onLogout`, `breadcrumb`, `actions`, `nav`, `navLabel=Sections`, `density=compact`. Crumb: `label`, optional `onClick` or `href`. | Shared frame; `shell`, `skip-link`, `app-header`, `shell-header`, `shell-heading`, `shell-product`, `shell-subtitle`, `shell-breadcrumb`, `shell-actions`, `current-user`, `shell-body`, `app-nav`, `shell-main`, `density-*`; `#main`, `current-user` test ID. |
| `useMediaQuery` | `useMediaQuery(query): boolean`. | Hook for layout switches CSS alone cannot make (for example Documents cards below 700 px, `(max-width: 699px)`); false where `matchMedia` is unavailable (tests, server rendering). |
| `ShortcutHelpHost` | No props; `openShortcutHelp()` opens help. | One effective help owner even with nested hosts; `shortcut-help-group`, `shortcut-help-row`, `shortcut-help-note`. AppShell already mounts it. |
| `icons.tsx` | Each exported `Icon*` takes optional `className`. | Inline 16px SVG, 1.5px currentColor stroke; `icon`. Hidden from assistive technology; surrounding control supplies name. Available: ChevronLeft/Right, Sort/SortUp/SortDown, Keyboard, Download, Check, Retry, Close, Pencil, Question, Undo, Trash, Warning, Document. |

### Grouped expandable table

`DataTable` options for records that belong to groups or open in place. All are additive; existing props, sorting and classes are unchanged.

- `groups`: one `tbody` per group, starting with a `tr.data-table-group` whose single `th scope="rowgroup"` spans all columns and holds `header` (typically a disclosure button). A collapsed group (`expanded: false`) renders only its header row. `rows` is ignored when `groups` is given. Sorting applies within groups; groups keep their order.
- `renderExpanded(row)`: non-null content is rendered in a following full-width `tr.data-table-expanded`. The caller owns the disclosure control (`aria-expanded`, `aria-controls`) and the region ID.
- `Column.rowHeader`: renders that column's cells as `th scope="row"`, so every row has a name.
- `busy`: sets `aria-busy` on the table while it refreshes.

Disclosure buttons put an `IconChevronRight` with class `disclosure-chevron` inside the control; it rotates 90 degrees while `aria-expanded="true"`. Small table controls use `target-min` (24 x 24 px minimum). Reference use: the Documents page (`documents/DocumentsTable.tsx`) groups rows by case and expands a row into its issues and submissions; below 700 px it switches to cards (`documents/DocumentCards.tsx`).

### Editor: carried review, rounds and resizable column

Screen parts built on `ui/`, not shared primitives. Reuse them for the same purpose rather than restating their wording.

| Part | Props / contract | Use and retained classes |
| --- | --- | --- |
| Carried check state (`editor/carried/checkState.ts`) | `deriveCarriedStates(inputs, resolutions, annotations)` derives the state; it is never stored. Variants `needed`, `changed`, `removed` (all unchecked), `checked`, `dismissed`. `checkStateBadge(variant)` gives badge text, tone and extra line. | Badges through `CarriedStateBadge` (a `StatusBadge`, so text plus shape): "Check needed" (`warning`; `changed` adds "Changed after your check", `removed` adds "The linked finding was deleted"), "Checked" (`success`), "Dismissed" (`neutral`). Progress line from `progressText`: "2 of 5 checked, 1 dismissed", or "All carried findings checked" with `IconCheck`. |
| `CarriedProgress`, `CarriedRowExtras`, `PlaceholderRow` | List parts of a carry-forward round. Row extras: badge, extra line, meta line ("Carried from Round 2" / "Linked to carried …"), and one instruction line only while unchecked (`instructions.ts`). | `carried-progress`, `carried-extras`, `carried-meta`, `carried-instruction`. A placeholder row stands for an input with no finding on this text: a `li role="button"` with `aria-pressed`, `data-list-key="input:{id}"`, named "{term}, carried, not on this text, {state}"; dismissed rows are muted by colour (`is-muted`, `text-muted`), never by opacity. "Next unchecked" is a quiet button with `Kbd` N. |
| `CarriedSection`, `ExceptionPanel`, `CarriedChecksReadOnly` | Inspector sections; presentational, async callbacks resolve `true` only when the write applied. `readOnly` = `submitted` / `paused` / `older`. | Both sections are a `section` headed "Carried finding" (`carried-section`). Unchecked: "What to check" list, primary "Mark as checked" (`data-carried-primary`, first Tab stop), "Show original evidence", quiet "Does not apply…". Checking collapses the section to "Checked · Carried from Round n (submitted …)" and moves focus there. Exception path: reason sentence, "Original" block, primary "Mark in text", "Link to an existing finding…" (inline radio group, never a select, each option with "Technical details"), "Dismiss with reason…". Dismissal uses `InlineConfirm` with a required reason; an empty reason keeps Dismiss focusable and unavailable. Busy and blocked actions use `aria-disabled`, never `disabled`. Errors are `InlineMessage` alerts inside the section; only network errors offer Retry. Read-only views show badges and origin without actions. |
| `SidebarResizer` + `useSidebarWidth` (`editor/sidebarWidth.ts`) | `width`, `limits` (`min`, `max`, `fallback`), `controls` (sidebar ID), `onChange`, `onReset`, `onCommit(source)`. | `role="separator"`, vertical, named "Resize findings column", `aria-valuenow/min/max`, value text "{n} pixels (default {fallback})". Keys: Left/Right 16 px, Shift 64 px, Home/End to the limits, Enter resets, Escape cancels an active drag; double-click resets. Limits: min 220 px; max the smallest of 480 px, 35% of the viewport and (above 1024 px) viewport minus inspector 380 px minus 420 px text reserve; default 260 px (220 px at or below 1024 px). Stored per user in `localStorage` key `ontocurator.editor.sidebarWidth.v1:{username}`, written on drag end or 300 ms after the last key, removed on reset; the stored value is clamped to current limits. Hidden at 700 px and below and while comparing. `sidebar-resizer`, `sidebar-resizer-grip`. |
| `SubmitCaseDialog`, `SubmitControl`, `openItems.ts` | `collectOpenItems` orders open items: carried, evidence, re-anchor, review proposals, unconfirmed values, defaulted values. Carried, evidence, re-anchor and review items block; value items warn. | The dialog shows one summary line, "Go to first unchecked" when carried items are open, and up to 5 items, each with its own "Go to {term}" (closes the dialog, selects the row, scrolls to the mark and focuses the resolving control); the rest are counted "and n more". "Submit case" stays focusable with `aria-disabled` and `aria-describedby` naming the reason; activating it re-announces the reason assertively. Footer: Submit, Cancel. Toolbar: "Finish & Submit · n open" plus a quiet "Next open item" while items are open; "Finish & Submit Case" otherwise. The count appears whenever the case is editable and items are open. |
| `WorkRoundsDialog`, `RoundInputEvidenceDialog`, `MySubmissions`; wording in `editor/rounds/roundLabels.ts` | Rounds are named `Round n`. Identity line: "Round 3 · continued from Round 2 submission (19 Oct, 00:57) · de v1"; toolbar badge "Round 3 · continued from Round 2". | Work rounds: `lg` dialog titled "Work rounds · {text} · {language}"; no preselected source, so "Continue from this submission" stays focusable with `aria-disabled` and the reason "Choose a submission to continue from."; unavailable starts name their reason (`carryUnavailableReason`). Original evidence: `lg` dialog "Original finding from Round n" with meta line, term, values, note, quote (or "no text span"), the read-only source text and IDs only under "Technical details"; footer "Close original evidence". My submissions: "Round n · {time} · n findings" with a View button each, plus "Round n · not submitted yet" for the open round. |
| Translation check blocks (`translation/ReviewParts.tsx`, texts in `translation/labels.ts`) | One block per failed check inside a warning `InlineMessage` titled "n automatic checks failed". | Each block: `h3` label, "What it means" (`checkExplanation`, fallback for unknown codes), "From the translation run" (quoted detail), the no-location sentence, "If the translation is right anyway", and "Technical code". No failures: one calm sentence. "Show all checks" lists every check with a Passed/Failed `StatusBadge`. Explanation texts stay drafts until confirmed in `docs/superpowers/reviews/2026-10-19-translation-check-explanations-review.md`. |

### Forced colours and motion

- Under `@media (forced-colors: active)`: the Final row gets a `CanvasText` left border instead of the tinted edge; `status-pill` keeps a `CanvasText` outline and its shape icon; `:focus-visible` (and the class-level focus rules of buttons, fields and navigation links) uses a `Highlight` outline; the active segment of the shared `.segment` class (`[aria-current="page"]`) uses `Highlight`. The Documents decision bar styles its own `decision-bar-segment` links the same way (`LinkText` border under forced colours). The sidebar resizer grip uses `CanvasText` and its focus ring `Highlight`.
- Expansion (`data-table-expanded` fade-in) and chevron rotation take 150 ms; both are instant under `prefers-reduced-motion: reduce`.
- The active segment is underlined and bold, not only coloured.

### Shortcuts

Register every new screen's keys through `useShortcut(keys, handler, options)` in `ui/shortcuts.ts`, with a description and useful group so `?` help lists them. `keys` accepts a string or alternatives; `handler` can return false to allow another binding. Example:

```tsx
useShortcut("Ctrl+Enter", submit, {
  scope: "screen", description: "Submit case", group: "Case", enabled: canSubmit,
});
```

Scopes resolve `dialog` before `screen` before `global`; equal-scope conflicts use reverse registration order without promotion on rerender. Dialogs suppress non-dialog shortcuts. Typing in input/textarea/select/contenteditable, composing text and repeated keys are suppressed by default. Opt into `allowInInputs` or `allowRepeat` only for a justified control interaction; `root` excludes inert hosts. `useShortcutHint` registers help for locally managed keys without adding a global handler; `useRegisteredShortcuts` supplies help rows. Preserve review keys and descriptions during migration.

`Dialog` closes on Escape when `onClose` is supplied. `InlineConfirm` registers Escape with `allowInInputs` and its own `root`, and lets the event fall through unless focus is inside it. “Case submitted” intentionally has no Escape action. Backdrop dismissal is opt-in. Pending operations can deliberately suppress close. Editor logout with unsaved changes asks “Save and log out” or “Cancel”; saving must finish before logout.

Carried review keys (group "Carried findings", active only in a carry-forward round): `N` next unchecked, `Shift+N` previous (both wrap), `C` marks the selected unchecked carried finding as checked (plain `c` only; not in read-only views). The sidebar resizer registers its keys as a hint in group "Layout".

## Do's and Don'ts

### Do

- Do use `Button`, for example `<Button variant="primary" onClick={save}>Save</Button>`.
- Do use `DataTable` for lists of records, retaining existing row handlers and selectors.
- Do use `InlineMessage tone="error"` for errors and visible text for every status.
- Do use `Dialog` for every modal and `ConfirmDialog` for confirmation decisions, except confirmations bound to a row inside a table (final-result selection, replacement, reaffirmation), which use `InlineConfirm`.
- Do register every new screen's keys with a description and choose the appropriate density.
- Do give every open item in the submit dialog its own "Go to" action, and keep "Submit case" focusable with `aria-disabled` and a described reason while it is unavailable.
- Do name rounds as `Round n`; never show raw round states or IDs outside "Technical details".

### Don't

- Don't add `<button className="btn …">` for a screen action; use the shared component.
- Don't use inline `style` colours or declare colour literals outside `tokens.css`.
- Don't introduce a new UI library or CDN fonts; assets must work offline.
- Don't use emoji as icons; use the inline SVG icon system with a labelled control.
- Don't distinguish mark states or workflow status by colour alone.
