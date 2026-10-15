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

The shell provides a skip link to `#main`, header/breadcrumb, user/logout and optional navigation. Reading main surfaces preserve the editor's independent scrolling; compact surfaces scroll their main content. The shell stacks below 700 px. Existing editor layouts adapt at 1279, 1024 and 700 px; use those incumbent transitions rather than making document content unreadably narrow.

## Elevation & Depth

Warm tonal surfaces and hairlines provide the default hierarchy. `--shadow-1` gives modest sheet/panel depth; `--shadow-2` lifts modal content. Their exact values live in the sidecar's shadow extensions and `tokens.css`. Existing screen shadow colour tokens remain compatibility values, not a reason to add new elevation levels.

Control colour/border transitions use the implemented 0.15s ease-out timing. The loading spinner uses 0.8s linear rotation and stops under reduced motion. Preserve `prefers-reduced-motion` support; do not animate clinical text position or mark geometry.

## Shapes

The three radius tokens in frontmatter correspond to small controls, ordinary containers and larger containers. Shared buttons and fields use `radius-sm`; do not turn controls into pills. Marks have square corners so adjacent and overlapping text segments remain exact. Focus uses `--focus-width: 2px` and `--focus-offset: 2px` with `--focus-ring`.

## Components

Import from `frontend/src/ui/`. Native attributes, event handlers, refs and caller class names remain available where the props extend the native element. Retain existing structural classes, IDs, accessible names and `data-testid` selectors during straight swaps.

| Component | Props / contract | Use and retained classes |
| --- | --- | --- |
| `Button` | Native button attrs except `type`; `variant=primary/secondary/quiet/danger` (secondary default), `size=md/sm`, `type=button/submit`, `loading`, `icon`; forwarded ref. | All actions; one primary per view. `btn`, `btn-{variant}`, `btn-sm`, `btn-spinner`, `btn-leading-icon`. Loading disables and sets busy. |
| `IconButton` | Button props without children/icon; required `label`, `icon`. | Labelled compact action; `btn-icon` plus Button classes; aria-label and title. |
| `Field` | Required `id`, `label`, one control child; optional `hint`, `error`, `required`. | Shared label/error wiring; `form-group`, `form-label`, `field-hint`, `field-hint-error`; merges descriptions, sets invalid. |
| `TextInput` | `FieldOwn` plus native input attrs; forwarded ref. | Single-line entry; Field classes and `form-control`. |
| `Textarea` | `FieldOwn` plus native textarea attrs; forwarded ref. | Multiline entry; Field classes and `form-control`. |
| `Select` | `FieldOwn` plus native select attrs; forwarded ref. | Native choice; Field classes and `form-select`. |
| `Checkbox` | `id`, `label`, optional hint and native input attrs (no Field error prop); forwarded ref. | Boolean choice; `form-group`, `form-checkbox-row`, `form-checkbox`, `field-hint`. |
| `Dialog` | `open`, `title`, `children`; optional visible `heading`, `onClose`, `closeOnBackdrop=false`, `initialFocus`, `size=sm/md/lg`, `footer`. | Every modal; `modal-overlay`, `modal-content`, `ui-dialog`, `ui-dialog--{size}`, `ui-dialog-heading`, `ui-dialog-body`, `modal-actions`. Traps/restores focus and locks scroll; only top dialog handles keys. |
| `ConfirmDialog` | `open`, `title`, `message`, `confirmLabel`, `onConfirm`, `onCancel`; `cancelLabel=Cancel`, `tone=primary/danger`, `busy=false`. | Explicit decisions; composes Dialog and Button classes. Busy blocks dismissal. |
| `StatusBadge` | `children`; optional `status`, `tone=neutral/info/success/warning/danger`, `title`. | Status plus dot/ring/check/warning/cross shape; `status-pill`, `status-pill--{tone}`, `status-pill-shape`, `status-pill-dot`, `status-pill-ring`. `statusTone(status)` maps workflow statuses. |
| `InlineMessage` | `tone=info/success/warning/error`, `children`; optional `title`, `onDismiss`, `aria-label`. | Errors and feedback; `notice`, `notice-{tone}`, `notice-content`, `notice-title`. Errors are alerts, others statuses. |
| `DataTable<T>` | `label`, `columns`, `rows`, `rowKey`; optional `initialSort`, `empty`, `rowProps`, `className`. Column: `id`, `header`, `cell`, optional `sortValue`, `width`, `align=start/end`. | Lists of records; `data-table-scroll`, `data-table`, `density-compact`, `data-table-sort`, `data-table-sort-icon`, `is-selected`. Stable sort; `rowProps` retains row handlers/test selectors and selected state. |
| `EmptyState` | `title`; optional `children`, `action`. | Explain an empty result and next action; `empty-state`, `empty-state-title`, `empty-state-body`, `empty-state-action`. |
| `Toolbar` | `label`, `children`, optional `className`. | Named, wrapping action group; `toolbar`, role group. |
| `Kbd` | `children`. | Key label; `kbd`. `formatKey` shortens arrows and Escape. |
| `AppShell` | `user`, `children`; optional `onLogout`, `breadcrumb`, `actions`, `nav`, `navLabel=Sections`, `density=compact`. Crumb: `label`, optional `onClick` or `href`. | Shared frame; `shell`, `skip-link`, `app-header`, `shell-header`, `shell-heading`, `shell-product`, `shell-subtitle`, `shell-breadcrumb`, `shell-actions`, `current-user`, `shell-body`, `app-nav`, `shell-main`, `density-*`; `#main`, `current-user` test ID. |
| `ShortcutHelpHost` | No props; `openShortcutHelp()` opens help. | One effective help owner even with nested hosts; `shortcut-help-group`, `shortcut-help-row`, `shortcut-help-note`. AppShell already mounts it. |
| `icons.tsx` | Each exported `Icon*` takes optional `className`. | Inline 16px SVG, 1.5px currentColor stroke; `icon`. Hidden from assistive technology; surrounding control supplies name. Available: ChevronLeft/Right, Sort/SortUp/SortDown, Keyboard, Download, Check, Retry, Close, Pencil, Question, Undo, Trash, Warning, Document. |

### Shortcuts

Register every new screen's keys through `useShortcut(keys, handler, options)` in `ui/shortcuts.ts`, with a description and useful group so `?` help lists them. `keys` accepts a string or alternatives; `handler` can return false to allow another binding. Example:

```tsx
useShortcut("Ctrl+Enter", submit, {
  scope: "screen", description: "Submit case", group: "Case", enabled: canSubmit,
});
```

Scopes resolve `dialog` before `screen` before `global`; equal-scope conflicts use reverse registration order without promotion on rerender. Dialogs suppress non-dialog shortcuts. Typing in input/textarea/select/contenteditable, composing text and repeated keys are suppressed by default. Opt into `allowInInputs` or `allowRepeat` only for a justified control interaction; `root` excludes inert hosts. `useShortcutHint` registers help for locally managed keys without adding a global handler; `useRegisteredShortcuts` supplies help rows. Preserve review keys and descriptions during migration.

`Dialog` closes on Escape when `onClose` is supplied. “Case submitted” intentionally has no Escape action. Backdrop dismissal is opt-in. Pending operations can deliberately suppress close. Editor logout with unsaved changes asks “Save and log out” or “Cancel”; saving must finish before logout.

## Do's and Don'ts

### Do

- Do use `Button`, for example `<Button variant="primary" onClick={save}>Save</Button>`.
- Do use `DataTable` for lists of records, retaining existing row handlers and selectors.
- Do use `InlineMessage tone="error"` for errors and visible text for every status.
- Do use `Dialog` for every modal and `ConfirmDialog` for confirmation decisions.
- Do register every new screen's keys with a description and choose the appropriate density.

### Don't

- Don't add `<button className="btn …">` for a screen action; use the shared component.
- Don't use inline `style` colours or declare colour literals outside `tokens.css`.
- Don't introduce a new UI library or CDN fonts; assets must work offline.
- Don't use emoji as icons; use the inline SVG icon system with a labelled control.
- Don't distinguish mark states or workflow status by colour alone.
