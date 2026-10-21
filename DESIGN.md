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

Editor hierarchy 22 : 18 : 14: the document name is the page's `h1` in the toolbar after the case navigation (`case-title`, `title` size, serif, regular, one line with ellipsis; the case navigation shows only "Case n of m"); the inspector `h2` (term or "New finding") uses `reading` size in the serif, regular, with its code in mono `xs` muted; section `h3` ("Values", "Mentions") use `md`, strong, `text-muted`; body and controls stay `md`.

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

### Marking-mode line

While adding a mention or a segment, the editor shows one line above the text (`attach-mention-banner` / `pane-intent` in `editor/TextPane.tsx`). The text never moves (spec C.5): the line is positioned absolutely over the top of the text sheet (`center-pane` is the positioning context, `styles/screens/editor.css`) instead of taking space in the flow. It is one 32 px line (24 px button plus `space-1` padding top and bottom, a 1 px `--border` shadow line below, `z-index: 2`), which fits the sheet's top padding (`space-6`, also at <=1024 px), so the first line of text stays visible. In the grid layouts (versions, comparison) its grid area is the empty row above the text.

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
| `Dialog` | `open`, `title`, `children`; optional visible `heading`, `onClose`, `closeOnBackdrop=false`, `initialFocus`, `size=sm/md/lg`, `footer`. | Every modal; `modal-overlay`, `modal-content`, `ui-dialog`, `ui-dialog--{size}`, `ui-dialog-header`, `ui-dialog-heading`, `ui-dialog-close`, `ui-dialog-body`, `modal-actions`. Traps/restores focus and locks scroll; only top dialog handles keys. With `onClose` the header shows a labelled Close icon button, reachable by Tab but never given initial focus. The body scrolls; header and `footer` stay fixed. Below 700 px a `md` dialog becomes a full-height sheet. The Close button and Escape exist together, only with `onClose`: a caller suppresses both by omitting `onClose` (pending operations; "Case submitted" has neither). The dialog is capped at `max-height: min(90vh, calc(100dvh - var(--space-6)))`; widths are 400 / 540 / 760 px for `sm` / `md` / `lg`. Without a custom `heading` the dialog is labelled by its `h2` (`aria-labelledby`). `variant="side"` (`modal-overlay--side`, `ui-dialog--side`): a modal right panel, 480 px wide and full height, a full-screen sheet below 700 px, 150 ms slide-in (none under reduced motion); it ignores `size`, focuses its heading on open (unless `initialFocus`) and makes the rest of the page `inert` while open; Escape and Close return focus to the trigger. Used by the Documents final-result panel. |
| `Drawer` | `open`, `title`, `onClose`, `returnFocusRef`, `children`; optional `headingId`, `footer`. | Reading panel next to the work (task guidelines). From 1100 px a non-modal `aside.ui-drawer` labelled by its `h2`, on the right below the AppShell header, width `min(30rem, 34vw)`; it does not cover the page: while open, the root carries `data-ui-drawer-open` and `--ui-drawer-inset` (its width) and `.shell-main` narrows by that inset, so the text beside it stays readable and operable. 700 to 1099 px: a modal `lg` `Dialog` (`ui-drawer-dialog`); below 700 px a full-height sheet (`ui-drawer-sheet`). Focus moves to the heading on open and back to `returnFocusRef` on close; Escape closes (non-modal: only while focus is inside). Keys pressed inside the non-modal drawer do not reach page shortcuts (it stops `keydown` propagation except Escape), so editor keys such as `D` do nothing while reading. The scroll position is kept across close and reopen. Classes `ui-drawer`, `ui-drawer-body`, `ui-drawer-content`, `ui-drawer-footer`. |
| `ConfirmDialog` | `open`, `title`, `message`, `confirmLabel`, `onConfirm`, `onCancel`; `cancelLabel=Cancel`, `tone=primary/danger`, `busy=false`. | Explicit decisions; composes Dialog and Button classes. Busy blocks dismissal. |
| `InlineConfirm` | `ConfirmDialog` props minus `open`, plus `children`, `outcome` (`conflict` with `changedBy`, `changedAt`, `onReview` / `error` with `onRetry` / `session`), `headingLevel=3/4` (4 default), `conflictMessage` (replaces the default conflict sentence; the "Changed by … at …" suffix stays), `confirmUnavailable` (`reason` shown below the content, or `reasonId` of a reason the caller renders) with `onConfirmUnavailable`. | Confirmation bound to an item on the page, such as a table row; placement and the one-per-page policy belong to the caller. `inline-confirm`, `inline-confirm-title`, `inline-confirm-message`, `inline-confirm-notice`, `inline-confirm-actions`, `action-reason`. A labelled group; focus moves to the heading on open and to the notice on conflict. Escape cancels only while focus is inside, and is consumed without cancelling while busy. Busy keeps focus: Cancel and Retry use `aria-disabled`, confirm uses `loading`. An unavailable confirm stays focusable with `aria-disabled` and `aria-describedby` pointing at the reason; activating it calls `onConfirmUnavailable`. A conflict hides the children and offers "Review again" and "Close"; error and session outcomes say that nothing was saved. |
| `StatusBadge` | `children`; optional `status`, `tone=neutral/info/success/warning/danger`, `title`. | Status plus dot/ring/check/warning/cross shape; `status-pill`, `status-pill--{tone}`, `status-pill-shape`, `status-pill-dot`, `status-pill-ring`. `statusTone(status)` maps workflow statuses. Final marker: `<StatusBadge tone="success">Final</StatusBadge>` (check shape from `IconCheck`) on a row with class `final-row` (`success-light` tint, `success` left edge); `is-selected` stays reserved for selection state. |
| `InlineMessage` | `tone=info/success/warning/error`, `children`; optional `title`, `onDismiss`, `aria-label`. | Errors and feedback; `notice`, `notice-{tone}`, `notice-content`, `notice-title`. Errors are alerts, others statuses. |
| `DataTable<T>` | `label`, `columns`, `rows`, `rowKey`; optional `initialSort`, `empty`, `rowProps`, `className`, `groups`, `renderExpanded(row)`, `busy`. Column: `id`, `header`, `cell`, optional `sortValue`, `width`, `align=start/end`, `rowHeader`. Group (`DataTableGroup<T>`): `key`, `header`, `rows`, `expanded`, optional `headerProps`. Optional `groupSelection` (`GroupSelection`, with `state` for the mixed checkbox), `rowSelection`, `groupLayout=header/label`, `selectionHeader`, `rowEdge(row)`, server `sort` with `onSort`. `label` is the table's visually hidden `caption`. | Lists of records; `data-table-scroll`, `data-table`, `density-compact`, `data-table-sort`, `data-table-sort-icon`, `is-selected`, `data-table-group`, `data-table-group--label`, `data-table-expanded`, `data-table-group-select`, `data-table-select-cell`, `data-table-row-select`, `data-table-row--decision`. Stable sort, within groups when grouped; `rowProps` retains row handlers/test selectors and selected state. See "Documents table with stage columns". |
| `StageCell` | `symbol`, `word`, `tone=none/undecided/waiting/todo/running/decision/rejected/done`; optional `detail`, `muted`. | Two-line workflow stage cell: line 1 symbol + status word (`weight-strong`, tone colour), line 2 muted `size-sm` detail; `stage-cell`, `stage-cell--{tone}`, `stage-cell--muted`, `stage-cell-status`, `stage-cell-symbol`, `stage-cell-detail`. The symbol is `aria-hidden`; the word carries the meaning. Narrow cards reuse the tone classes on their "Review: …" lines. |
| `Tabs` | `label`, `tabs` (`id`, `label`, `count`, `href`, optional `emphasised`), `active`, `panelId`, `onSelect(id)`; `tabId(panelId, id)`. | Link-driven `tablist` with counts; `ui-tabs`, `ui-tab`, `ui-tab-label`, `ui-tab-count`, `ui-tab-count--emphasised` (filled `warning` pill). Manual activation: arrows, Home and End move focus; Enter, Space or a plain click selects; modified clicks keep the link. Each tab is named "{label}, {count}" and controls the caller's `role="tabpanel"`, which is labelled by the active tab. |
| `Popover` | `open`, `anchorRef`, `label`, `onClose`, `children`; optional `width=360`, `footer`. | Anchored, non-modal `role="dialog"` below its button (`ui-popover`, `ui-popover-body`, `ui-popover-footer`); focus moves to the first control, Tab cycles inside, Escape closes and returns focus to the anchor, a pointer down outside closes. Below 700 px it is a modal full-height sheet (`Dialog` with `ui-popover-sheet`). The anchor carries `aria-expanded` and `aria-controls`. |
| `FilterChip` | `label`, `onRemove`. | An active filter as a button "Remove filter {label}" with a close icon; `ui-filter-chip`, `ui-filter-chip-icon`. The caller moves focus to the next chip (or the search field) after a removal. |
| `MenuButton` | `label`, `buttonLabel`, `items` (`id`, `label`, `onSelect`). | Menu button pattern for "+n" more actions; `ui-menu-button`, `ui-menu`, `ui-menu-item`. `aria-haspopup="menu"`; Enter, Space, click or ArrowDown open at the first item, ArrowUp at the last; arrows wrap, Home/End; Escape closes and returns focus; Tab or a pointer down outside close. Fixed position, so a scrolling table does not clip it. |
| `PlanChip` | `kind=review/annotate`, `pressed`, `name` (accessible name with the row, "Review, case-0101 · fr"), `onToggle`; optional `busy`, `size=table/card`. | Inline work-plan toggle on a language row; `ui-plan-chip`, `data-size`, `data-busy`. A `button` with `aria-pressed`; pressed shows `IconCheck` plus "Review"/"Annotate" on `success-light` with a `success` border, unpressed is outlined in `border-strong` with muted text (state never by colour alone). At least 24 px high (32 px for `card`). Busy keeps focus with `aria-disabled` and ignores clicks; the chip has no live region, the page announces "Saving…" in its one shared polite region. |
| `TriStateButton` | `value=keep/on/off`, `label` ("Review, fr"), `onChange(next)`; optional `mixed` (title such as "12 on, 8 off"), `describedBy`, `disabled`. `nextTriState` cycles keep → on → off → keep. | Cell of a bulk plan matrix; `ui-tristate`, `data-state=keep/mixed/on/off`. Shows "keep", "mixed" (when `mixed` is set and the value is keep), "on" with `IconCheck`, "off" with `IconClose` as text. `aria-label` "{label}, {state}"; `aria-describedby` points at a hidden per-instance hint "Click to change: keep, on, off." plus `describedBy`. Unavailable cells use `aria-disabled`. |
| `Toast`, `useToast` | `useToast()` returns `toast`, `show({ message, actionLabel?, onAction?, note? })`, `dismiss`; `<Toast toast onDismiss durationMs=10000 />`. | Undo feedback after a reversible saved change; `ui-toast-region`, `ui-toast`, `ui-toast-message`, `ui-toast-note`, `ui-toast-action`, `ui-toast-close`. The region (`role="status"`, polite) is always rendered; place it right after the content it reports on. Rules: toasts only for reversible saved changes with Undo; errors stay inline; one toast at a time (a new one replaces the old); 10 s, paused while hovered or focused; never takes focus; the action button is reachable by Tab and Ctrl+Z / Meta+Z runs it while visible, also from a focused checkbox or radio (not from text fields, selects or editable content). Running the action closes the toast. Appears without animation under reduced motion. |
| `EmptyState` | `title`; optional `children`, `action`. | Explain an empty result and next action; `empty-state`, `empty-state-title`, `empty-state-body`, `empty-state-action`. |
| `Toolbar` | `label`, `children`, optional `className`. | Named, wrapping action group; `toolbar`, role group. |
| `Kbd` | `children`. | Key label; `kbd`. `formatKey` shortens arrows and Escape. |
| `AppShell` | `user`, `children`; optional `onLogout`, `breadcrumb`, `actions`, `nav`, `navLabel=Sections`, `density=compact`. Crumb: `label`, optional `onClick` or `href`. | Shared frame; `shell`, `skip-link`, `app-header`, `shell-header`, `shell-heading`, `shell-product`, `shell-subtitle`, `shell-breadcrumb`, `shell-actions`, `current-user`, `shell-body`, `app-nav`, `shell-main`, `density-*`; `#main`, `current-user` test ID. |
| `useMediaQuery` | `useMediaQuery(query): boolean`. | Hook for layout switches CSS alone cannot make (for example Documents cards below 700 px, `(max-width: 699px)`); false where `matchMedia` is unavailable (tests, server rendering). |
| `ShortcutHelpHost` | No props; `openShortcutHelp()` opens help. | One effective help owner even with nested hosts; `shortcut-help-group`, `shortcut-help-row`, `shortcut-help-note`. AppShell already mounts it. |
| `icons.tsx` | Each exported `Icon*` takes optional `className`. | Inline 16px SVG, 1.5px currentColor stroke; `icon`. Hidden from assistive technology; surrounding control supplies name. Available: ChevronLeft/Right, Sort/SortUp/SortDown, Keyboard, Download, Check, Retry, Close, Pencil, Question, Undo, Trash, Warning, Document, Book. |

### Documents table with stage columns

`DataTable` options for records that belong to groups or open in place, as used by the Documents page (`documents/DocumentsTable.tsx`). All are additive; other tables keep their props, sorting and classes.

- `label` is a visually hidden `caption` ("Documents").
- `groups`: one `tbody` per group. With `rowSelection` (or `groupLayout="label"`) the group row is a checkbox `td` plus one left-aligned `th scope="rowgroup"` spanning the other columns (`data-table-group--label`); the Documents group row is 28 px, `surface-sunken`, and holds the case ID and "· en source + 1 translation" (no disclosure, no badge, no activity). Without it the single rowgroup `th` spans all columns and starts with the group checkbox (`groupLayout="header"`). A collapsed group renders only its header row. Sorting applies within groups; groups keep their order.
- `rowSelection` (`{ selected(row), onSelect(row, mode), label(row) }`): a 40 px first column of row checkboxes ("Select case-107 · de"), header a visually hidden "Select". `groupSelection` (`{ selected(key), onSelect(key, mode), checkboxLabel(key), state? }`) names the case checkbox "Select case-107 (2 texts)"; `state` = `"some"` makes it `indeterminate` (announced "mixed"). The caller owns the selection; `onSelect` reports the mode: plain click or Space `toggle`, Shift-click `range` (from the caller's anchor, in list order), Ctrl-click or Cmd-click `toggle-keep-anchor`, Shift+↓ / Shift+↑ (focus moves to the next / previous checkbox of the same kind, no wrap) `select`. The caller lists Shift+↓/↑ and Space in `?` help with `useShortcutHint`, group "Selection".
- `Column.rowHeader`: that column's cells are `th scope="row"`; the Documents Text cell is named "{case} · {language}" and indented 20 px with a 1 px `border` rule.
- `rowEdge(row) = "decision"`: `data-table-row--decision`, a 3 px `warning` inset edge on the first cell; the row header adds the visually hidden "Needs your decision" (status never by colour alone).
- `sort` + `onSort`: server-driven sort; sortable headers contain a `button` (`data-table-sort`) and carry `aria-sort`.
- `renderExpanded(row)`: non-null content in a following full-width `tr.data-table-expanded`. The caller owns the disclosure control (`aria-expanded`, `aria-controls`) and the region ID.
- `busy`: sets `aria-busy` on the table while it refreshes.

Documents columns: checkbox · Text · Review · Annotation · Final · Waiting on · Action (visually hidden header) · Last activity with the ▸ disclosure ("Show history, case-107 · de"). Each stage column is a `StageCell` derived by the server; the tone sets the colour, the word the meaning:

| Tone | Symbol | Colour | Meaning |
| --- | --- | --- | --- |
| `none` | — | `text-muted` | Stage does not exist for this text |
| `undecided` | ? | `text-muted` | Plan not decided |
| `waiting` | ○ | `text-muted` | Waits for an earlier stage |
| `todo` | ○ | `warning` text | You must assign |
| `running` | ◐ | `accent` | Others are working |
| `decision` | ● ⚠ ? ⏸ | `warning`, bold | Needs your decision |
| `rejected` | ✕ | `danger` | Rejected |
| `done` | ✓ | `success` | Finished |

Rows outside the plan keep the same structure, muted (`stage-cell--muted`, `documents-row--not-in-plan`). Waiting on shows "You" (`weight-strong`), one person, or two names and "+n" with the full list for assistive technology.

**A button only where the lead must act.** The Action column holds at most one small secondary button, the first lead-owned step ("Assign review…", "Accept result…", "Review changes…", "Plan…"), plus a `MenuButton` "+n" for further lead steps. Rows waiting on others, done rows and stages without a lead step have no button; history, text versions and optional assignments sit in the ▸ expansion. Above the table: `Tabs` "Needs your decision · To assign · In progress · Done · All" with counts, a search field, the "Filter" `Popover` (fieldsets with facet counts, Order, Clear all) and `FilterChip`s; the final-result choice opens a `Dialog variant="side"`.

Below 700 px the table switches to cards (`documents/DocumentCards.tsx`): one case card per case (case checkbox + case heading), one `article` per text with its heading "{case} · {language}", three labelled lines "Review: ✓ Accepted · unchanged", "Annotation: …", "Final: …", "Waiting on: …", the row action full width (at least 32 px) with "+n", "Open" and "History". The decision edge is the article's 3 px `warning` left border with the same hidden text; not-in-plan articles are muted. Card and case headings carry the row-header and group-label IDs, so deep links and focus returns work in both layouts. Tabs scroll horizontally; popovers, the panel and dialogs become full-height sheets.

Disclosure buttons put an `IconChevronRight` with class `disclosure-chevron` inside the control; it rotates 90 degrees while `aria-expanded="true"`. Small table controls use `target-min` (24 x 24 px minimum).

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
| Task guidelines (`tasks/TaskGuidelines.tsx`) | `assignment`, `readOnly` (the editor's real read-only state: submitted, held or a read-only round); render prop with `button`, `notice`, `drawer`. | Toolbar entry "Guidelines v3" (`Button size="sm"`, `IconBook`) before "Report problem" in both task screens (annotation: in `taskActions`; translation review: `guidelineActions`, also in lead correction); badge "New" (text) while the version in force is newer than the user's latest opened one; name "Guidelines v3, open the project guidelines" (+ ", updated"). Absent without a version in force. Opens a `Drawer` with the version's text and footer "All versions" (new tab) and "Close". Editable tasks only: a dismissible info `InlineMessage` below the toolbar (above the bar in the translation review), "Guidelines updated to v3" with change notes or "This project has guidelines (v3)", and "Read guidelines v3"; showing it records `notified` once; it never blocks saving or submitting. Refreshed with the task metadata on window focus. |
| Translation check band (`ChecksSummary` in `translation/ReviewParts.tsx`, texts in `translation/labels.ts`) | `failed`, `all` check records. One 40 px band (`translation-checks-band`) plus a "Details" disclosure (`translation-checks-toggle`, `aria-expanded`, chevron rotates 90 degrees). Details start collapsed on every load and the state is never stored. | Band states: failed checks get the `warning-light` fill, `IconWarning` and "1 automatic check failed: {label}" / "2 automatic checks failed: {a} and {b}" / "{n} automatic checks failed: {a}, {b} and {n−2} more" (`checkBandText`, short labels); all passed: muted `IconCheck` line "All n automatic checks passed." ("1 automatic check passed."); none recorded: "No automatic checks were recorded for this translation." "Details" (toggle text "Hide details" while open) is shown whenever checks exist. Per failed check (`translation-check`): `h3` label, the explanation (`checkExplanation`, fallback for unknown codes) followed by the no-location sentence, "From the translation run" (quoted detail), "If the translation is right anyway" (`checkDeviationGuidance`), and a "Technical details" disclosure holding "Technical code". Last line: "All checks: n passed, m failed · Show all checks"; the latter lists every check with a Passed/Failed `StatusBadge` and its technical code. Explanation texts stay drafts until confirmed in `docs/superpowers/reviews/2026-10-19-translation-check-explanations-review.md`. |
| Translation review layout (`translation/TranslationReviewScreen.tsx`, `translation/translation.css`) | `useMediaQuery("(min-width: 1100px)")` switches rail and pinned bar; exactly one Submit ("Submit review…"), one reason and one key hint in the DOM. | Top: "Skip to decision" link, a 52 px review bar (`translation-review-bar`: document name `h1`, languages, "Translation details" popover closed by Escape or a click outside, save status, "Reload from server"), then the check band. At ≥1100 px the texts own the viewport: only the texts and a 360 px decision rail (`translation-decision`) scroll; the rail's sticky footer holds the reason (full "Before submitting:" issue list), the key hint "Ctrl + Enter submits · 1–4 choose a decision outside the text" and Submit. 700–1099 px: one scrolling page, texts side by side with a measured height (`--review-bands`, `--review-bar` from a `ResizeObserver`), and a pinned bottom bar (`translation-pinned-bar`, about 60 px, `role="region"` "Decision and submit") with "Decision: {label}", quiet "Change ↓" (focuses the decision legend), one reason line ("{first issue} and n more", ellipsis) and Submit; `scroll-padding-bottom` keeps focus clear of the bar. Below 700 px the texts stack. From 700 px the column heads, panes and notes of all columns share the rows of the columns grid (`subgrid`), so every pane starts at the same height however a head wraps. The translation column head holds "Show changes", "Couple scrolling" and the quiet small "Show matching paragraph" (`Kbd` "Alt M", `aria-keyshortcuts="Alt+M"`, one per screen, also below 700 px). "Couple scrolling" is shown wherever the texts are side by side (≥700 px), also while editing; it is off by default, not stored, and reset on reload, comparison change and submit. While the editable translation is shown it is the fixed leader: only source and comparison follow, a follower scrolled by hand moves only itself, and the translation's paragraph starts are recomputed 300 ms after the last edit, at once on blur and never during IME composition; a recompute never scrolls. Notes while coupled, in one wrapping line (`translation-column-hint`) below the panes spanning the text columns: "Paragraphs are paired by position, not by meaning. Merged or split paragraphs shift the pairing." plus, while editing, "While you edit, only the other texts follow your translation."; differing counts name both counts; the pair line (`role="status"`) updates after 150 ms of scroll rest, never on a recompute or a "Show matching paragraph". "Show matching paragraph" aligns the other text(s) once to the paragraph at the caret, else the last clicked paragraph, else the paragraph at the top of the last focused or scrolled pane: instant, `space-3` inset when the anchor starts above or below the view, never moving focus, caret or selection; below 700 px the target is brought into view with `block: "nearest"`. A visually hidden polite status reads "Source paragraph 4 is shown next to translation paragraph 4." (with differing counts plus " Paragraph counts differ, so this is an estimate."); an identical repeated result is cleared and set again on the next frame so it is announced again. A focused Submit or reason keeps focus across the 1100 px switch. Unavailable Submit uses `aria-disabled` + `aria-describedby="review-submit-reason"`. After submit: primary "Next task: {text} ({language})" (or primary "Back to my tasks" when none is left), otherwise a "Back to my tasks" link, and the line "n more open tasks in this project." |
| Term search combobox (`editor/SearchPanel.tsx`, `editor/termSearch.ts`) | `#search-input` with `role="combobox"`, `aria-autocomplete="list"`, `aria-activedescendant`; hits are `role="option"` `.candidate-card` items of a `listbox` "Terms"; focus stays in the field. | Label "Search term", placeholder "Name or code". Keys inside the field: ↓/↑ move the active hit (the first usable hit is active), Enter adds the active hit (a pending or stale search runs first, its hits need a second Enter), Esc cancels (a new finding is discarded and focus returns to the text after the mark; "Change term" closes and focus returns to its button). Hint line: "n terms · ↓ ↑ choose · Enter add · Esc cancel" with `Kbd`; no hits: "No terms match “…”. Change the words, try a code (HP:0001250) or switch search languages." Each hit: label, code, `Kbd` Enter on the active one, a match line (`matchLine`: "Matched the code", "Matched the start of “…”", "Similar wording “…”", "Matched {language} name “…”", "Matched synonym “…”", "Matched “…”"; none for label matches) and its definition clamped to one line (`candidate-def is-clamped`) except on the active hit. Obsolete hits are `aria-disabled` with "Obsolete term (assignment not allowed)". Prefill for a new finding: the marked text of all segments, whitespace collapsed, cut at 80 code points on a word boundary, searched at once and selected in the focused field; only for English documents or when the document language is an active search language, otherwise the field stays empty with the hint "Names are searched in English. Type an English name or a code." |
| Values block (`editor/AnnotationPanel.tsx`, `editor/valuesLayout.ts`, `editor/useCoalescedAxisChange.ts`) | Section `data-values-section` headed "Values" with `Kbd` V; one `fieldset` per axis (`data-axis-field`); the section carries `data-values-layout="row|stacked|boxes"`. | One row per axis: legend in a 96 px column (`size-sm`, weight 500, "(required)" muted, wraps at word boundaries, never truncated), up to four options as one connected segmented control (`axis-options`: 1 px `border-strong` outline, `radius-sm`, no gap, no pill radius, no clipping; segments `axis-option` stretch, `nowrap`, min height 28 px, 1 px `border-strong` separators, native radio visually hidden but focusable), more as a `Select`. Option text comes from `axisOptionLabel`: known values have fixed wording, other snake_case profile identifiers are shown as words ("clinically_suspected_only" → "Clinically suspected only"), never raw. Segment states: not chosen `surface-raised`; hover `surface-sunken`; chosen `accent` / `on-accent`, bold; unconfirmed default `warning-light` / `warning`, bold, 1 px dashed `warning` inner outline; read-only not-chosen `text-muted`; an unavailable stored value is the last disabled chosen segment. An unconfirmed default shows the tag "Default" (`axis-default-tag`, `size-xs`, `warning`, bold) on the second line of the label cell; the segment keeps " · default" as visually hidden text (in a `Select` the option text gets " · default"), never colour alone. Fit rule (`chooseValuesLayout`, measured intrinsic segment widths, `ResizeObserver` and `document.fonts.ready`): row when every control fits its control cell, else stacked (label above the control) when every control fits the full width, else boxes (one `surface-sunken` box per axis, separate wrapping chips; a defaulted axis gets a dashed `warning` border and the same "Default" tag as the other layouts); a better layout returns only with 8 px to spare; selection and focus never change on a switch. Forced colours: outline, separators and the default's dashed outline `CanvasText`, chosen `Highlight` / `HighlightText`, focus `Highlight`, boxes dashed `CanvasText`. No transitions. Primary small "Confirm defaults (n)" with `Kbd` D (`values-confirm`, `data-confirm-defaults`) and under it the hint "Highlighted values are defaults. Press D to confirm them, or choose another value." (`Kbd` D); read-only: "Highlighted values are defaults that were not confirmed." Radio changes are coalesced: sent 300 ms after the last change within an axis, at once on a change of another axis, on leaving the block, and before leave, submit or logout; a failed save shows the saved value again. Focus loop: after a term is added, focus goes to the first empty required axis, else "Confirm defaults", else back to the text after the mark (at ≤700 px "Back to text"); confirming defaults returns focus to the text after the mark and announces "Confirmed: …". |

### Settings sections

Project settings show one section at a time, each with its own address (`#/projects/{key}/settings/{section}`; `…/settings` opens General). Sections in order: General, Guideline, Annotation rules, Workflow, Creation defaults, Ontology and profile, Members (`SETTINGS_SECTIONS` in `app/router.ts`). The section bar is a `nav` "Settings sections" (`settings-tabs`) of links (`settings-tab`) with `aria-current="page"` on the current one, not ARIA tabs: each section is a page. Leaving a section with unsaved edits asks "Save {section}", "Discard" or "Cancel" in a `sm` Dialog titled "Unsaved changes in {section}".

### Forced colours and motion

- Under `@media (forced-colors: active)`: the Final row gets a `CanvasText` left border instead of the tinted edge; `status-pill` keeps a `CanvasText` outline and its shape icon; `:focus-visible` (and the class-level focus rules of buttons, fields and navigation links) uses a `Highlight` outline; the active segment of the shared `.segment` class (`[aria-current="page"]`) and the selected `ui-tab` use `Highlight`. The Documents decision edge (table row and card) becomes a `CanvasText` left border; stage symbols are kept and drawn in `CanvasText`; the emphasised tab count and the Filter count invert to `CanvasText` on `Canvas`; popovers and menus get a `CanvasText` outline. The sidebar resizer grip uses `CanvasText` and its focus ring `Highlight`.
- Pressed plan chips and "on" tri-state cells get a `CanvasText` border and keep their check icon; the toast gets a `CanvasText` outline.
- Expansion (`data-table-expanded` fade-in) and chevron rotation take 150 ms; both are instant under `prefers-reduced-motion: reduce`. The toast's 150 ms fade-in is dropped there too.
- The active segment is underlined and bold, not only coloured.

### Shortcuts

Register every new screen's keys through `useShortcut(keys, handler, options)` in `ui/shortcuts.ts`, with a description and useful group so `?` help lists them. `keys` accepts a string or alternatives; `handler` can return false to allow another binding. Example:

```tsx
useShortcut("Ctrl+Enter", submit, {
  scope: "screen", description: "Submit case", group: "Case", enabled: canSubmit,
});
```

Scopes resolve `dialog` before `screen` before `global`; equal-scope conflicts use reverse registration order without promotion on rerender. Dialogs suppress non-dialog shortcuts. Typing in text inputs, textarea, select and contenteditable, composing text and repeated keys are suppressed by default; checkboxes and radios are not typing targets, so screen shortcuts still fire while one has focus. Opt into `allowInInputs` or `allowRepeat` only for a justified control interaction; `root` excludes inert hosts. `useShortcutHint` registers help for locally managed keys without adding a global handler; `useRegisteredShortcuts` supplies help rows. Preserve review keys and descriptions during migration. Letter bindings compare `event.key` case-insensitively; an `Alt` + letter binding also matches `event.code` `Key{Letter}`, because macOS Option+letter types another character (Option+M gives "µ"). Plain letter bindings never use `event.code`.

`Dialog` closes on Escape when `onClose` is supplied. `InlineConfirm` registers Escape with `allowInInputs` and its own `root`, and lets the event fall through unless focus is inside it. “Case submitted” intentionally has no Escape action. Backdrop dismissal is opt-in. Pending operations can deliberately suppress close. Editor logout with unsaved changes asks “Save and log out” or “Cancel”; saving must finish before logout.

Carried review keys (group "Carried findings", active only in a carry-forward round): `N` next unchecked, `Shift+N` previous (both wrap), `C` marks the selected unchecked carried finding as checked (plain `c` only; not in read-only views). The sidebar resizer registers its keys as a hint in group "Layout".

Group "Selection" (lead workflow): Ctrl+Z / Meta+Z "Undo the last plan change" (registered by `Toast` while its toast has an action), Shift+↓ / Shift+↑ and Space for case checkboxes in a grouped table with `groupSelection` (hints registered by the page).

Group "Translation review": `1`–`4` choose a decision (editable reviews only; not while typing in the translation or rationale); Ctrl+Enter "Submit review (asks for confirmation)" (editable reviews only), also from text fields (`allowInInputs`); `Alt+M` "Show the paragraph paired with the one at your cursor" (every review, also from the translation textarea with `allowInInputs`, not while a dialog is open; the key press is consumed, so no character is typed). The decision cards show their key as `Kbd`.

Group "Finding" (own editable findings and the new finding only; never proposals, sources or read-only views): `/` focuses the term search (opens "Change term" for an existing finding), `V` focuses the values (first defaulted axis, else the first), `D` confirms all default values. Plain letters only (Shift+V, Shift+D do nothing); never in text fields. `SearchPanel` adds the hint "↓ / ↑, Enter: Move through term hits; add the active hit" with `useShortcutHint`; those keys work only inside the search field.

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
