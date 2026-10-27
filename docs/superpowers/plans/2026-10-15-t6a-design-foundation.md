# T6a: Design Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Lean format: files, interfaces, tokens, test cases and acceptance criteria per task. Implementers write the code test-first; code appears only where it defines a contract. Every UI task is done with the Impeccable skill (`impeccable:impeccable`, see "Working with Impeccable").

**Goal:**
- Direction C ("reading document") becomes the visual language of Ontotator: paper-like surfaces, clinical text in a serif with room to read, controls that recede.
- Semantic design tokens, two density modes, a small in-house component set, an `AppShell` and one keyboard-shortcut registry, so that T3b, T5 and T4 build their screens on them.
- Login, dashboard and editor get the new look. **No workflow changes.**

**Architecture:**
- **Tokens:** `frontend/src/styles/tokens.css` holds every custom property (colour, marks, type, spacing, radius, shadow, focus, density). Nothing else declares a colour literal.
- **Styles:** `styles.css` (1 662 lines) is split into `styles/tokens.css`, `styles/base.css` (reset, typography, focus, density), `styles/components.css` (the `ui/` components) and screen files (`styles/screens/*.css`) that keep the existing structural class names.
- **Components:** `frontend/src/ui/`, one file per component, each with a vitest test. They keep the existing class vocabulary (`btn`, `btn-primary`, `form-control`, `modal-content`, …) where one exists, so the existing tests and Playwright selectors keep working.
- **Shortcuts:** `frontend/src/ui/shortcuts.ts`, a module-level registry with one `window` keydown listener (bubble phase) and `useShortcut`. The editor's review keys, case navigation, Escape and `?` move onto it unchanged.
- **Fonts:** self-hosted through two Fontsource packages (woff2 bundled by Vite, SIL OFL 1.1). No request leaves the app's origin.
- **Design record:** `DESIGN.md` at the repository root (binding for T3b, T5 and T4), with Impeccable's sidecar `.impeccable/design.json` and the product brief `PRODUCT.md`.

**Spec:** `docs/superpowers/specs/2026-10-15-t6a-design-foundation-design.md` (D1–D7, §3–§9). Roadmap order (spec §9): T0 → T1 → T2a–c → (T2d ∥ T2e ∥ T6a) → T3a → T3b → T5 → T4 → T6b.

**Branch / worktree:** `feat/t6a-design-foundation` from the reviewed head of `feat/t2c-projects-authorization-audit` (after its Task 6, the project list on the dashboard), worktree `.worktrees/t6a-design-foundation`. Set it up as in T2b (`npm --prefix frontend ci`, `uv sync`). Baseline: `scripts/check.sh` must print `All local checks passed.` before Task 1. T6a must be merged before T3b starts.

**Commit rule:** per task `npm --prefix frontend run typecheck && npm --prefix frontend test`; for tasks that change markup or CSS also `npm --prefix frontend run test:e2e`; the Python commit rule (`uv run ruff check --fix src tests scripts && uv run ruff format src tests scripts && uv run mypy src`) when Python files change (Task 10). Then one conventional commit without AI attribution. Nothing is pushed.

**Files at the end of this plan:**

```
PRODUCT.md, DESIGN.md, .impeccable/config.json, .impeccable/design.json   design record
frontend/src/styles/tokens.css, base.css, components.css                  tokens, base, components
frontend/src/styles/screens/{auth,dashboard,editor,tree}.css               screen rules (old class names)
frontend/src/styles/index.css                                              import order
frontend/src/ui/*.tsx, shortcuts.ts, icons.tsx, index.ts                   components and registry
frontend/src/editor/negation.ts                                            "negated" for the mark style
frontend/public/licenses/*-OFL.txt                                         font licences shipped with the UI
frontend/browser/design.spec.ts                                            screenshots, contrast, colour vision
frontend/tests/ui/*.test.tsx, frontend/tests/tokens.test.ts, frontend/tests/support/colour.ts
```

---

## Working with Impeccable

- Load the skill with the Skill tool (`impeccable:impeccable`). Its base directory is printed when it loads; below, `$IMPECCABLE` is `<that directory>/scripts/impeccable` (in Git Bash the `sh` launcher works; `impeccable.cmd` is the fallback).
- Run `"$IMPECCABLE" context` once per session from the worktree root, and follow its directives. Read the skill's `reference/craft-floor.md` before the first UI edit of each task.
- **The brief wins** (skill rule): direction C, the two densities, light-only, the fonts below and the token names of this plan are pinned. Impeccable chooses values and details inside them, not a different world.
- **Mode:** Operate for the dashboard, admin and compact tables; Read for the document text in the editor. The build path is code-first (an app screen); do not generate image comps.
- **Detector:** the Impeccable hook runs after each edit. Before each commit run `"$IMPECCABLE" detect --json <changed files>` and triage every finding as the skill's `reference/hooks.md` says: fix it, or add the narrowest ignore with a `--reason` naming the evidence. Never ignore to get a commit through.
- **Bounded verification** (skill rule): build, inspect once at desktop and mobile, fix in one batch, confirm with at most one more round.

## Fonts (pinned)

| Role | Family | Package (npm, production dependency) | Licence | Use |
|---|---|---|---|---|
| Serif, clinical text and page titles | **Source Serif 4** (variable: weight 200–900, optical size) | `@fontsource-variable/source-serif-4@^5.3.1`, files `opsz.css`, `opsz-italic.css`; family `"Source Serif 4 Variable"` | SIL OFL 1.1 (Adobe) | document text, reading-density headings, login and page titles |
| Sans, interface | **Source Sans 3** (variable: weight 200–900) | `@fontsource-variable/source-sans-3@^5.3.1`, files `index.css`, `wght-italic.css`; family `"Source Sans 3 Variable"` | SIL OFL 1.1 (Adobe) | controls, labels, tables, compact density, the editor's side panes |
| Mono | system stack (unchanged `--font-mono`) | none | – | term ids, offsets, hashes |

Why these: designed as a pair (matching x-height and rhythm), full Latin Extended plus Greek and Cyrillic subsets (clinical texts in de, en, es, fr, nl, pl, pt with µ, ±, ≥, Greek letters), optical sizing for 18 px reading text, actively maintained, OFL. The Fontsource CSS uses `unicode-range`, so a browser loads only the subsets a page needs.

**Type ramp** (tokens `--size-*` / `--leading-*`; px values are the contract, rem in CSS with a 16 px root):

| Token | Size / line height | Family | Use |
|---|---|---|---|
| `xs` | 12 / 16 | sans | badges, key hints, table meta; the floor for any functional text (spec §3) |
| `sm` | 13 / 18 | sans | field hints, breadcrumbs, secondary cells |
| `md` | 14 / 20 | sans | compact body, table cells, controls in compact density |
| `base` | 15 / 22 | sans | interface body and buttons in reading density |
| `reading` | 18 / 30 (1.67) | serif | clinical text; measure `--measure-reading: 68ch` |
| `xl` | 22 / 28 | serif, weight 600 | page and dialog titles |
| `2xl` | 28 / 34 | serif, weight 600 | login title, empty-state titles |

## Tokens (names are the contract; values are the Task 1 draft, frozen in Task 2)

| Group | Tokens (draft value) |
|---|---|
| Surfaces | `--surface` `#f7f4ee` (page, paper), `--surface-raised` `#fffdf8` (document sheet, panels, dialogs), `--surface-sunken` `#efebe3` (toolbars, table header) |
| Text | `--text` `#1f1a14`, `--text-muted` `#5f574b`, `--on-accent` `#ffffff` |
| Lines | `--border` `#ddd6c8` (decorative hairlines), `--border-strong` `#8c8170` (control boundaries, ≥ 3:1) |
| Accent and states | `--accent` `#1d4e89`, `--accent-hover` `#163d6b`, `--accent-light` `#e3ebf5`; `--success` `#2f6b3a` / `--success-light` `#e4efe3`; `--warning` `#8a5a00` / `--warning-light` `#f6ecd6`; `--danger` `#a23b2a` / `--danger-light` `#f6e2dd` |
| Focus | `--focus-ring` `#1d4e89`, `--focus-width` `2px`, `--focus-offset` `2px` |
| Mark fills | `--mark-0-fill` `#b1ae68`, `--mark-1-fill` `#cff3e3`, `--mark-2-fill` `#ffdba8`, `--mark-3-fill` `#ddd9f6`, `--mark-4-fill` `#d49da8`, `--mark-5-fill` `#78afed` |
| Mark states | `--mark-line` `#3b342b` (underline of every mark), `--mark-selected` `#1d4e89` (selection frame), `--mark-negated-hatch` `#8c8170` |
| Type | `--font-serif`, `--font-sans`, `--font-mono`, `--size-{xs,sm,md,base,reading,xl,2xl}`, `--leading-{…}`, `--weight-regular` 400, `--weight-strong` 600, `--measure-reading` |
| Space | `--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4` 16px, `--space-5` 24px, `--space-6` 32px, `--space-7` 48px |
| Shape | `--radius-sm` 3px, `--radius` 6px, `--radius-lg` 10px; `--shadow-1` (raised hairline), `--shadow-2` (dialog) |
| Density (set by `.density-reading` / `.density-compact`) | `--body-font`, `--body-size`, `--body-leading`, `--row-height` (44 / 34 px), `--cell-pad-y`, `--cell-pad-x`, `--control-height` (36 / 30 px) |

Rules: colour tokens are `#rrggbb` literals in `tokens.css` (the token tests parse them); every other file uses `var(--…)`. The draft colours already pass the checks of Task 1 (computed while writing this plan: text on every mark fill ≥ 7.5:1; mark fills pairwise CIEDE2000 ≥ 17 in normal vision and ≥ 13 under each simulated deficiency).

**Mark styles** (the meaning is carried by the line style or pattern, not by hue; spec §3):

| State | Class (set by `vendor/spans.js`) | Style |
|---|---|---|
| Own annotation | `run--own` | fill + 2px **solid** underline `--mark-line` |
| Proposal under review (AI or other tool suggestion) | `run--target` | fill + 2px **dashed** underline `--mark-line` |
| Reference (read-only input) | `run--source` | fill + 2px **dotted** underline `--mark-line` |
| Several annotations on the run | `run--multi` | underline 3px |
| Negated (assertion "absent") | `run--negated` (new) | fill + diagonal **hatch** `repeating-linear-gradient(135deg, transparent 0 5px, var(--mark-negated-hatch) 5px 6px)` |
| Selected | `run--hot`, `run--hot-start`, `run--hot-end` | 2px **frame** `--mark-selected` (the existing per-segment box-shadow mechanics stay) |

---

### Task 1: Direction-C prototype on the editor, screenshots, approval gate (D7)

**Create** `PRODUCT.md`, `.impeccable/config.json`, `frontend/src/styles/tokens.css` (draft), `frontend/src/editor/negation.ts`, `frontend/tests/support/colour.ts`, `frontend/tests/tokens.test.ts`, `frontend/tests/negation.test.ts`, `frontend/browser/design.spec.ts`. **Modify** `frontend/package.json` (+ lock), `frontend/src/main.tsx`, `frontend/src/styles.css`, `frontend/src/spans/adapter.ts`, `frontend/src/vendor/spans.js`, `frontend/src/editor/TextPane.tsx`, `frontend/src/app/CaseScreen.tsx` (class names, layout wrappers and the `negated` flag; no behaviour), `frontend/tests/spans.test.ts`, `frontend/browser/spans.spec.ts`, `.gitignore`.

**1. Product brief.** Run `/impeccable init` and write `PRODUCT.md` from the spec, `README.md` and these facts, without inventing claims:
- Ontotator is a web service for annotating clinical texts with ontology terms (HPO and others), used by curators, annotators, adjudicators and project leads, often for hours at a time, on desktop screens.
- Users read carefully and decide term by term; mistakes matter. The text is the primary object; controls support it.
- Constraints: offline and closed networks (no CDN), WCAG 2.2 AA, light theme only, English UI, React 18 with plain CSS and no UI library, keyboard use is common.
- Surfaces: login, dashboard ("My tasks" from T3b), editor (reading), admin and workflow pages (compact).
- `.impeccable/config.json`: `"buildPath": "code"`. Add `.impeccable/config.local.json` and `.impeccable/review/` to `.gitignore`.
If `init` asks something these facts do not answer, stop and ask the user; do not guess.

**2. Fonts and tokens.**
- `npm --prefix frontend install @fontsource-variable/source-serif-4@^5.3.1 @fontsource-variable/source-sans-3@^5.3.1` and `npm --prefix frontend install -D @axe-core/playwright@^4.10.0`.
- `main.tsx` imports, before `styles.css`: `@fontsource-variable/source-serif-4/opsz.css`, `…/opsz-italic.css`, `@fontsource-variable/source-sans-3/index.css`, `…/wght-italic.css`, then `./styles/tokens.css`.
- `tokens.css` with every token of the table above. `--font-serif: "Source Serif 4 Variable", Georgia, "Times New Roman", serif`; `--font-sans: "Source Sans 3 Variable", system-ui, -apple-system, "Segoe UI", sans-serif`.
- The `:root` block of `styles.css` becomes aliases so the whole app takes the new colours at once: `--bg-primary: var(--surface)`, `--bg-surface: var(--surface-raised)`, `--border-color: var(--border)`, `--text-main: var(--text)`, `--primary: var(--accent)`, `--primary-hover: var(--accent-hover)`, `--primary-light: var(--accent-light)`, `--span-color-N: var(--mark-N-fill)`, `--span-color-N-border: var(--mark-line)`, `--span-selected` and `--span-highlight` likewise; the state colours keep their names. Task 2 removes the aliases.

**3. Colour checks** (`tests/support/colour.ts`, test-only, no dependency):

```ts
export function parseColourTokens(css: string): Record<string, string>; // "--name" -> "#rrggbb", :root only
export function contrast(fg: string, bg: string): number;              // WCAG 2.x relative-luminance ratio
export type Deficiency = "protan" | "deutan" | "tritan";
export function simulate(hex: string, d: Deficiency): string;           // Machado, Oliveira & Fernandes 2009, severity 1.0,
                                                                         // matrix applied to linear sRGB, result clamped
export function deltaE2000(a: string, b: string): number;               // CIEDE2000 via CIELAB (D65)
export const MACHADO_2009 = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
} as const;
```

`tests/tokens.test.ts` (`// @vitest-environment node`, reads `src/styles/tokens.css`):
- `colour_helpers_match_reference_values`: `contrast("#000000", "#ffffff")` is 21; `contrast("#777777", "#ffffff")` rounds to 4.48; `deltaE2000` of the Sharma, Wu & Dalal (2005) test pair 1 (`L 50, a 2.6772, b −79.7751` vs `L 50, a 0, b −82.7485`, given as Lab through an exported `deltaE2000Lab`) is 2.0425 ± 0.0001; `simulate("#ffffff", d)` stays white for each `d`.
- `text_meets_aa_on_every_surface`: `--text` and `--text-muted` on `--surface`, `--surface-raised`, `--surface-sunken` ≥ 4.5.
- `state_text_meets_aa`: `--accent`, `--success`, `--warning`, `--danger` on `--surface`, `--surface-raised` and on their own `-light` variant ≥ 4.5; `--on-accent` on `--accent` and on `--accent-hover` ≥ 4.5; `--text` on every `-light` variant ≥ 4.5.
- `text_on_marks_meets_aa`: `--text` on each `--mark-N-fill` ≥ 4.5 (spec §3).
- `non_text_contrast`: `--focus-ring` and `--border-strong` on all three surfaces ≥ 3; `--mark-line` and `--mark-selected` on `--surface-raised` and on each mark fill ≥ 3 (WCAG 1.4.11).
- `mark_fills_are_distinct_for_normal_vision`: every pair of the six fills has CIEDE2000 ≥ 12; every fill against `--surface-raised` ≥ 10.
- `mark_fills_are_distinct_under_colour_vision_deficiencies`: for protan, deutan and tritan, every pair of simulated fills ≥ 8. (Against the paper the underline carries visibility under CVD; it is covered by `non_text_contrast`.)

**4. The negated mark.**
- `editor/negation.ts`: `export function isNegated(annotation: { axes_values?: Record<string, string | null> | null }): boolean` — true when `axes_values.assertion === "absent"` (the standard clinical axis, `domain/axes.py`).
- `MentionDisplay` and `VendorMention` gain `negated?: boolean`; `mentionsToVendor` passes it; `TextPane`'s `mentionsSignature` includes it; `spans.js` `render()` adds `run--negated` when any mention of the run is negated.
- `CaseScreen`: own mentions take `isNegated(owner.annotation)`, review targets and references take it from their snapshot's annotation.
- Tests: `negation.test.ts` (`absent_is_negated`, `present_uncertain_and_missing_are_not`); `spans.test.ts` gains `a_negated_mention_marks_its_runs` (class on the runs of that mention only, also when it overlaps a non-negated one).

**5. The prototype (Impeccable, direction C) on the editor only:**
- **Text pane:** `.text-container` gets `density-reading`: serif `reading` size, `--measure-reading`, the document on a `--surface-raised` sheet with generous margins; the pane toolbar recedes (sans `sm`, muted).
- **Marks:** the six fills and the state styles of the table above (`.run--own`, `--target`, `--source`, `--multi`, `--negated`, `--hot`). No horizontal padding or margin on marks (the existing rule: marking never moves the text).
- **Side panes** (`sidebar`, `inspector-pane`, `tree-host`): sans, compact density, hairline separators instead of boxed cards, muted headings.
- **Case header:** flat, sans, the primary action ("Finish & Submit Case") as the only filled button.
- Keep every class name, `data-testid`, label and accessible name. Layout breakpoints (1024 px, 700 px) stay.

**6. Screenshots and checks** (`browser/design.spec.ts`; writes PNGs to `build/design-screenshots/` at the repository root, which Git ignores):
- Helpers: `shoot(page, name)` writes `build/design-screenshots/<width>x<height>/<name>.png`; viewports 1440×900, 1024×768, 390×844.
- `test("design: editor in reading density")`: `importPackage(page, "?scenario=many_proposals", "pkg-many-proposals", "design-many")`, review mode, open the case → `editor-review-many`; then `importPackage(page, "?scenario=review_references", "pkg-review-references", "design-states")`, review mode, open the case, press `j` then `3` (an own copy of the first proposal), set its "Assertion" axis to "Absent" (negated), click a reference mark (selected) → `editor-states`. If the scenario's profile has no assertion axis, add the standard axes to that scenario in `tests/browser_server.py`.
- `test("design: marks keep their meaning under colour-vision deficiencies")`: on `editor-states`, through `page.context().newCDPSession(page)` and `Emulation.setEmulatedVisionDeficiency` with `protanopia`, `deuteranopia`, `tritanopia` and `achromatopsia`, shoot `editor-states-<type>`. Then assert in the page that the computed styles of one run each of `.run--own`, `.run--target`, `.run--source`, `.run--negated` and `.run--hot` differ pairwise in at least one of `border-bottom-style`, `background-image`, `box-shadow` (hue ignored).
- `test("design: WCAG AA contrast and text size on the editor")`: `new AxeBuilder({ page }).withRules(["color-contrast"]).analyze()` has no violations; every visible element with its own non-empty text has a computed `font-size` ≥ 12 px.
- `test("design: no request leaves the origin")`: collect `page.on("request")` while logging in and opening a case; every URL starts with the `baseURL` origin.
- `browser/spans.spec.ts`: the three literal `rgb(…)` expectations of the old pastel palette become "equals one of the six `--mark-N-fill` values read from `getComputedStyle(document.documentElement)`". **Reason (recorded):** the test pinned old palette literals; it still checks that a mark is coloured from the palette.

**7. Verify and stop.**
- `npm --prefix frontend test`, `npm --prefix frontend run test:e2e` (all specs, including `design.spec.ts`), `"$IMPECCABLE" detect --json frontend/src` triaged.
- Commit: `feat(frontend): direction C prototype on the editor with draft tokens and self-hosted fonts`.
- **STOP — user approval gate (spec D7).** Report to the user: the screenshot folder `build/design-screenshots/`, the fonts, the six mark fills and the state styles. Do not start Task 2 without the user's explicit approval. Change requests are applied within Task 1 (amend with new commits, re-run step 6) and shown again. Record the approval date in the Task 2 commit body.

**Acceptance:** all existing vitest and Playwright tests pass (only the `spans.spec.ts` change above); the token tests pass; the screenshots exist for all three viewports; the user approved.

---

### Task 2: Freeze the tokens and split `styles.css`

**Create** `frontend/src/styles/base.css`, `components.css` (empty sections for Tasks 3–8), `screens/auth.css`, `screens/dashboard.css`, `screens/editor.css`, `screens/tree.css`, `styles/index.css`. **Delete** `frontend/src/styles.css`. **Modify** `frontend/src/main.tsx`, `frontend/index.html`, `frontend/tests/tokens.test.ts`, every `.tsx` that uses a legacy variable name.

- `index.css` imports, in order: `tokens.css`, `base.css`, `components.css`, `screens/auth.css`, `screens/dashboard.css`, `screens/editor.css`, `screens/tree.css`. `main.tsx` imports the fonts, then `./styles/index.css`. `index.html` drops its duplicate `<link rel="stylesheet" href="/src/styles.css">`.
- **Where rules go:** reset, `body`, `#root`, headings, links, `kbd`, `:focus-visible` (ring from the focus tokens) and the density classes → `base.css`. `.btn*`, `.form-*`, `.field-hint*`, `.badge*`, `.notice*`, `.modal-*` → `components.css`. Login, session notices and `.current-user` → `auth.css`; `.dashboard-*`, `.getting-started*`, `.fixed-mode` → `dashboard.css`; header, layout, panes, marks, resize handles, candidates, search language, responsive rules → `editor.css`; `.tree-*` → `tree.css`. Rules move unchanged except the variable renames.
- **Legacy names go:** replace `--bg-primary`, `--bg-surface`, `--border-color`, `--text-main`, `--primary*` and `--span-*` in CSS and in inline `style={{…}}` of `.tsx` files with the semantic tokens.
- **Density classes** in `base.css`: `.density-reading` (serif body, `reading` size, 44 px rows) and `.density-compact` (sans `md`, 34 px rows) set only the density tokens; components read the tokens.
- `tokens.test.ts` gains:
  - `no_legacy_token_names_remain`: no file under `frontend/src` (excluding `vendor/`) contains `--bg-primary`, `--bg-surface`, `--border-color`, `--text-main`, `--primary`, `--span-color`, `--span-selected`, `--span-highlight`;
  - `only_tokens_css_declares_colours`: no `.css` file under `src/styles` other than `tokens.css` contains `#[0-9a-fA-F]{3,8}\b`, `rgb(`, `rgba(`, `hsl(` or a named colour other than `transparent`/`currentColor`/`inherit` in a colour property.
- Values: apply the values the user approved in Task 1; from here on a colour change needs the token tests and the user (`DESIGN.md`, Task 10).

**Acceptance:** the token tests pass; `git grep -n "styles.css" frontend/src frontend/index.html` prints nothing; vitest and Playwright pass unchanged; the editor screenshots of `design.spec.ts` look the same as Task 1's (compare by eye; no rule changed besides names). Commit: `refactor(frontend): freeze design tokens and split the stylesheet` (body: "Direction C approved by the user on <date>.").

---

### Task 3: Actions and feedback components

**Create** `frontend/src/ui/Button.tsx`, `IconButton.tsx`, `icons.tsx`, `Kbd.tsx`, `StatusBadge.tsx`, `InlineMessage.tsx`, `EmptyState.tsx`, `Toolbar.tsx`, `index.ts`, and one test each under `frontend/tests/ui/`. **Modify** `styles/components.css`.

```ts
type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  variant?: ButtonVariant;            // default "secondary"
  size?: "md" | "sm";                 // "sm" adds btn-sm
  type?: "button" | "submit";         // default "button"
  loading?: boolean;                  // disabled + aria-busy, spinner before the unchanged label
  icon?: React.ReactNode;             // aria-hidden, before the label
}
// renders <button className="btn btn-<variant>[ btn-sm]">

interface IconButtonProps extends Omit<ButtonProps, "children" | "icon"> {
  label: string;                      // aria-label and title
  icon: React.ReactNode;
}

// icons.tsx: inline SVG, 16 px, stroke currentColor, aria-hidden:
// IconKeyboard, IconDownload, IconCheck, IconRetry, IconClose, IconChevronLeft, IconChevronRight, IconSort, IconSortUp, IconSortDown

export function Kbd(props: { children: React.ReactNode }): JSX.Element;      // <kbd className="kbd">
export function formatKey(key: string): string;  // "ArrowLeft" -> "←", "ArrowRight" -> "→", "ArrowUp" -> "↑", "ArrowDown" -> "↓", "Escape" -> "Esc", "Alt" -> "Alt", others unchanged

type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";
export function statusTone(status: string): StatusTone;
// not_started, open, unassigned -> neutral; in_progress -> info; completed, submitted, succeeded -> success;
// reopened, queued, running -> warning; failed, invalid, revoked -> danger; unknown -> neutral
export function StatusBadge(props: { status?: string; tone?: StatusTone; children: React.ReactNode; title?: string }): JSX.Element;
// <span className="status-pill status-pill--<tone>">, a leading shape per tone (dot, ring, check, …) so tone is not colour-only

export function InlineMessage(props: {
  tone: "info" | "success" | "warning" | "error";
  title?: string; children: React.ReactNode;
  onDismiss?: () => void;             // shows an IconButton "Dismiss message"
  "aria-label"?: string;
}): JSX.Element;                      // role "alert" for error, "status" otherwise; className "notice notice-<tone>"

export function EmptyState(props: { title: string; children?: React.ReactNode; action?: React.ReactNode }): JSX.Element;
export function Toolbar(props: { label: string; children: React.ReactNode; className?: string }): JSX.Element; // role="group" aria-label
```

`StatusBadge` uses a new class (`status-pill`) because `.status-badge` is the editor's save indicator and a Playwright selector.

**Tests** (`tests/ui/*.test.tsx`):
- `button`: `renders_variant_and_size_classes`; `loading_disables_and_sets_aria_busy_keeping_the_label`; `defaults_to_type_button`.
- `iconButton`: `label_is_the_accessible_name_and_title`; `icon_is_hidden_from_assistive_tech`.
- `kbd`: `formats_arrow_and_escape_keys`.
- `statusBadge`: `maps_document_and_workflow_states_to_tones` (table-driven over the list above); `explicit_tone_wins`.
- `inlineMessage`: `error_is_an_alert_others_are_status`; `dismiss_calls_back`; `passes_the_aria_label` (`getByRole("status", { name: "Import result" })`).
- `emptyState`, `toolbar`: `renders_title_body_and_action`; `toolbar_is_a_labelled_group`.

**Acceptance:** the tests pass; `"$IMPECCABLE" detect --json frontend/src/ui frontend/src/styles/components.css` triaged. Commit: `feat(ui): buttons, key hints, status badges, messages and toolbars`.

---

### Task 4: Form fields

**Create** `frontend/src/ui/Field.tsx`, `TextInput.tsx`, `Select.tsx`, `Checkbox.tsx`, `Textarea.tsx`, tests under `frontend/tests/ui/`. **Modify** `styles/components.css`, `ui/index.ts`.

```ts
interface FieldProps {
  id: string; label: React.ReactNode; hint?: React.ReactNode; error?: React.ReactNode;
  required?: boolean; children: React.ReactElement;   // the control; Field sets its id
}
// <div className="form-group"><label className="form-label" htmlFor={id}>…</label>{control}
//   <div id={`${id}-hint`} className="field-hint">…</div><div id={`${id}-error`} className="field-hint field-hint-error" role="alert">…</div></div>
// Field adds aria-describedby (hint, then error ids that exist) and aria-invalid={!!error} to its child.

type FieldOwn = { id: string; label: React.ReactNode; hint?: React.ReactNode; error?: React.ReactNode };
export const TextInput: React.ForwardRefExoticComponent<FieldOwn & React.InputHTMLAttributes<HTMLInputElement>>;      // className "form-control"
export const Select: React.ForwardRefExoticComponent<FieldOwn & React.SelectHTMLAttributes<HTMLSelectElement>>;       // className "form-select"
export const Textarea: React.ForwardRefExoticComponent<FieldOwn & React.TextareaHTMLAttributes<HTMLTextAreaElement>>; // className "form-control"
export const Checkbox: React.ForwardRefExoticComponent<{ id: string; label: React.ReactNode; hint?: React.ReactNode } & React.InputHTMLAttributes<HTMLInputElement>>;
// the box before its label, the whole row clickable, hint below
```

Required fields show "(required)" in the label text, not only an asterisk. Controls use `--control-height` and `--border-strong`.

**Tests:** `field`: `label_is_associated_with_the_control`; `hint_and_error_are_described_by`; `error_sets_aria_invalid_and_is_announced`; `required_is_in_the_label_text`. `textInput`/`select`/`textarea`: `forwards_ref_and_change_events`. `checkbox`: `clicking_the_label_toggles`.

**Acceptance:** tests pass, detector triaged. Commit: `feat(ui): labelled form fields with hints and errors`.

---

### Task 5: Shortcut registry (spec §5)

**Create** `frontend/src/ui/shortcuts.ts`, `frontend/tests/ui/shortcuts.test.tsx`.

```ts
export type ShortcutScope = "dialog" | "screen" | "global";   // precedence: dialog > screen > global
export interface ShortcutOptions {
  scope?: ShortcutScope;              // default "screen"
  description?: string;               // shown in the help overlay; without it the binding is hidden there
  group?: string;                     // help heading, e.g. "Review", "Navigation"; default "General"
  enabled?: boolean;                  // default true; false = neither dispatched nor listed
  allowRepeat?: boolean;              // default false: KeyboardEvent.repeat is ignored
  allowInInputs?: boolean;            // default false: ignored in input, textarea, select and contenteditable
  root?: React.RefObject<HTMLElement>; // the binding sleeps while root is inside an [inert] ancestor
}
export function useShortcut(
  keys: string | string[],            // "j", "?", "Escape", "Alt+ArrowRight"; several keys share one handler and one help row
  handler: (event: KeyboardEvent) => void | false, // return false = not handled (no preventDefault, lower bindings may run)
  options?: ShortcutOptions,
): void;
export function useShortcutHint(keysLabel: string[], description: string, options?: { group?: string; enabled?: boolean }): void;
// a help-only entry for keys handled elsewhere (span editor: Shift+arrows, ←/→ on a handle)
export function useRegisteredShortcuts(): ReadonlyArray<{ keys: string[]; description: string; group: string }>;
// enabled, described bindings and hints, in registration order (useSyncExternalStore)
export function matches(binding: string, event: KeyboardEvent): boolean;
export function isTypingTarget(target: EventTarget | null): boolean;   // moved from CaseScreen.tsx unchanged
```

**Semantics (the contract the tests pin):**
- **One listener:** a single `keydown` listener on `window`, bubble phase, installed with the first registration and removed with the last. Handles of the span editor that stop propagation keep working (`spanResize.test.ts`).
- **Matching:** modifiers Alt, Ctrl and Meta must match exactly (a binding without Alt never fires with Alt held). For a single printable character (`j`, `?`, `1`) Shift is ignored and letters compare case-insensitively (`j` matches `J`). For named keys (`Escape`, `ArrowRight`) Shift must match too.
- **Blocking:** while an element `[aria-modal="true"]` is in the document, only `dialog`-scope bindings dispatch (the old `modalOpen` and foreign-dialog rules, and the login overlay). A binding whose `root` is inside `[inert]` never dispatches (the old `isEditorBlocked`).
- **Conflicts:** among matching, active bindings the highest scope wins; within one scope the most recently registered wins. Only one handler runs per event, unless it returns `false`, then the next candidate runs.
- **Handled events** get `preventDefault()`.
- **Without a provider:** the registry is module state, so a component test that renders `CaseScreen` alone works.

**Tests** (`shortcuts.test.tsx`, React hooks in small test components, keys fired on `window` and on elements):
- `ignores_keys_typed_in_inputs_textareas_selects_and_contenteditable`, `allow_in_inputs_opts_in` (spec §7).
- `dialog_beats_screen_beats_global` and `the_latest_registration_wins_within_a_scope` (spec §7).
- `an_open_aria_modal_dialog_blocks_screen_and_global_bindings`.
- `a_binding_whose_root_is_inert_does_not_fire`.
- `modifiers_must_match_exactly` (`j` does not fire with Ctrl; `Alt+ArrowRight` does not fire without Alt).
- `letters_are_case_insensitive_and_shift_is_ignored_for_characters` (`?` with Shift fires; `J` fires `j`).
- `repeat_is_ignored_unless_allowed`.
- `returning_false_passes_the_event_on`.
- `disabled_bindings_neither_fire_nor_list`; `hints_are_listed_but_never_fire`.
- `unmount_unregisters_and_the_last_unmount_removes_the_listener`.

**Acceptance:** tests pass. Commit: `feat(ui): keyboard shortcut registry with scopes`.

---

### Task 6: Dialogs, the help overlay and the data table

**Create** `frontend/src/ui/Dialog.tsx`, `ConfirmDialog.tsx`, `ShortcutHelp.tsx`, `DataTable.tsx`, tests under `frontend/tests/ui/`. **Modify** `styles/components.css`, `ui/index.ts`.

```ts
interface DialogProps {
  open: boolean;
  title: string;                       // accessible name (aria-label) and, unless `heading` is given, the visible <h2>
  heading?: React.ReactNode;
  onClose?: () => void;                // Escape (dialog-scope shortcut, allowInInputs) calls it; without onClose Escape does nothing
  closeOnBackdrop?: boolean;           // default false
  initialFocus?: React.RefObject<HTMLElement>; // default: first focusable element inside
  size?: "sm" | "md" | "lg";
  footer?: React.ReactNode;            // right-aligned action row ("modal-actions")
  children: React.ReactNode;
}
// Inline (no portal, so an `inert` ancestor still covers it): <div className="modal-overlay"><div className="modal-content" role="dialog" aria-modal="true" aria-label={title}>
// Tab and Shift+Tab cycle inside; on close focus returns to the element focused before opening.

interface ConfirmDialogProps {
  open: boolean; title: string; message: React.ReactNode;
  confirmLabel: string; cancelLabel?: string;   // default "Cancel"
  tone?: "primary" | "danger";                  // confirm button variant, default "primary"
  busy?: boolean;                               // confirm shows loading, both disabled
  onConfirm: () => void; onCancel: () => void;  // Escape = cancel
}

export function ShortcutHelpHost(): JSX.Element | null;
// Registers "?" (global, description "Show / hide this help") and renders the help Dialog "Keyboard shortcuts":
// rows from useRegisteredShortcuts grouped by `group`, keys as <Kbd>{formatKey(key)}</Kbd> joined by " / ",
// the note "Shortcuts are disabled while typing in a field or when a dialog is open."
// While open, the host also binds "?" at dialog scope, so "?" closes it again (screen and global bindings are blocked then).
// Only the first mounted host renders (hosts register in the same module store), so a nested screen adds no second overlay.
export function openShortcutHelp(): void;  // for the header button

interface Column<T> {
  id: string; header: React.ReactNode; cell: (row: T) => React.ReactNode;
  sortValue?: (row: T) => string | number;  // sortable when present
  width?: string; align?: "start" | "end";
}
interface DataTableProps<T> {
  label: string;                             // aria-label of <table>
  columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string;
  initialSort?: { column: string; direction: "asc" | "desc" };
  empty?: React.ReactNode;                   // one full-width cell when rows is empty
  rowProps?: (row: T) => React.HTMLAttributes<HTMLTableRowElement> & { selected?: boolean };
  className?: string;
}
// compact density; <th scope="col" aria-sort> with a button for sortable columns; stable sort; selected -> aria-selected + "is-selected"
```

**Tests:**
- `dialog`: `has_dialog_role_modal_flag_and_name`; `focuses_initial_or_first_focusable`; `traps_tab_and_shift_tab`; `escape_closes_and_focus_returns`; `without_onClose_escape_does_nothing`; `backdrop_closes_only_when_enabled`; `blocks_screen_shortcuts_while_open` (a screen `useShortcut("1")` does not fire; a dialog-scope one does).
- `confirmDialog`: `confirm_and_cancel_call_back`; `escape_cancels`; `busy_disables_both`.
- `shortcutHelp`: `question_mark_toggles_the_help`; `lists_described_bindings_and_hints_by_group`; `two_hosts_render_one_overlay`; `open_shortcut_help_opens_it`.
- `dataTable`: `renders_headers_with_col_scope_and_the_label`; `sorts_by_a_sortable_column_and_sets_aria_sort`; `shows_the_empty_state`; `row_props_select_and_handle_events`.

**Acceptance:** tests pass, detector triaged. Commit: `feat(ui): dialogs, shortcut help and a compact data table`.

---

### Task 7: Editor shortcuts and dialogs on the registry

**Modify** `frontend/src/app/CaseScreen.tsx`, `frontend/src/App.tsx` (round-selection dialog), tests only where a reason is recorded below.

**Shortcuts** (bindings unchanged; each moves from the two `window` listeners to `useShortcut` with `root: rootRef`):

| Keys | Scope | Options | Behaviour (unchanged) |
|---|---|---|---|
| `Alt+ArrowLeft`, `Alt+ArrowRight` | screen | group "Navigation", description "Previous / next case" | only with an adjacent case, `onNavigateCase` and no save in flight; through `leaveCase` |
| `Escape` | screen | `allowRepeat`, group "General", description "Clear selection / cancel adding a mention" | cancel "adding a mention", else deselect; returns `false` when nothing was selected |
| `j`, `k` | screen | `enabled: review && targets.length > 0`, group "Review", description "Next / previous review proposal" | cycle through the targets |
| `1` | screen | `enabled: review && !!selectedTarget`, "Confirm selected proposal" | toggle confirmed; returns `false` for obsolete or unknown terms |
| `2` | screen | as above, "Reject selected proposal" | toggle rejected |
| `3` | screen | as above, "Adopt proposal as editable copy" | adopt and edit |
| `4` | screen | as above, "Mark selected proposal as uncertain" | toggle uncertain |
| hints | – | `useShortcutHint(["Shift + arrows, then release Shift"], "Select text with the keyboard to create a mention")`, `useShortcutHint(["←", "→", "Ctrl + ← / →"], "Move the focused mention edge (Tab to an edge handle of the selected annotation)")` | handled by the span editor |

- `?` and the help overlay: CaseScreen renders `<ShortcutHelpHost />`; the "⌨ ?" header button becomes `<IconButton label="Keyboard shortcuts" icon={<IconKeyboard/>} onClick={openShortcutHelp} />` (title "Keyboard shortcuts (?)").
- Remove `SHORTCUTS`, `showShortcutHelp`, `isTypingTarget` (now in `ui/shortcuts.ts`), the two keydown effects and `modalOpen` where it only served the shortcuts.

**Dialogs** (straight swaps to `Dialog` / `ConfirmDialog`, names and texts unchanged): "Submit case", the confirm request, "Case submitted", "Historical submission" (CaseScreen) and "Select review round" (App).
- **Escape** closes "Submit case", the confirm request, "Historical submission" and "Select review round" through their existing Cancel/Close action. "Case submitted" gets no `onClose` (Escape does nothing, as today). **Behaviour change (recorded):** Escape used to do nothing in the first four; ARIA dialog practice and spec §4 ("Escape closes") require it. Resolved T6a-Q3.
- All dialogs now carry `aria-modal="true"` and trap focus; the old ones did partly.

**Tests:**
- Unchanged and passing: `review-findings.test.tsx` ("ignores auto-repeat … '?' shows help"), `workflow-regressions.test.tsx` (review keys 1, 2, Escape, J/K), `caseScreen.test.tsx` (Alt+arrows), `session.test.tsx` (inert editor ignores keys), `spanResize.test.ts`.
- New in `caseScreen.test.tsx`: `escape_cancels_the_submit_dialog`; `the_case_submitted_dialog_ignores_escape`; `the_help_lists_review_keys_only_in_review_mode`.

**Acceptance:**
- `git grep -nE "addEventListener\(\"keydown\"" frontend/src/app frontend/src/App.tsx` prints nothing.
- `git grep -n "SHORTCUTS" frontend/src frontend/tests` prints nothing.
- vitest and Playwright pass. Commit: `refactor(editor): shortcuts and dialogs on the shared registry and components`.

---

### Task 8: AppShell, login and dashboard in the new look

**Create** `frontend/src/ui/AppShell.tsx`, `frontend/tests/ui/appShell.test.tsx`. **Modify** `frontend/src/App.tsx`, `frontend/src/app/LoginScreen.tsx`, `frontend/src/app/AuthGate.tsx`, `styles/components.css`, `styles/screens/auth.css`, `styles/screens/dashboard.css`, `frontend/browser/design.spec.ts`.

```ts
interface Crumb { label: string; onClick?: () => void; href?: string }
interface AppShellProps {
  user: CurrentUser | null;
  onLogout?: () => void;               // without it, no "Log out" button
  breadcrumb?: Crumb[];                // <nav aria-label="Breadcrumb">, the last crumb aria-current="page"
  actions?: React.ReactNode;           // header, before the user
  nav?: React.ReactNode;               // side navigation (T3b admin pages); none = no side column
  navLabel?: string;                   // aria-label of the side <nav>, default "Sections"
  density?: "reading" | "compact";     // class on <main id="main">, default "compact"
  children: React.ReactNode;
}
// <a className="skip-link" href="#main">Skip to content</a>
// <header className="app-header">product name "Ontotator", breadcrumb, actions,
//   <span className="current-user" data-testid="current-user" title="Logged in as <username>">{display_name} · {pseudonym}</span>, Log out</header>
// [<nav className="app-nav">{nav}</nav>] <main id="main" className="density-…">{children}</main>, <ShortcutHelpHost />
```

The header keeps `app-header` and `current-user`, which `firstRun.test.tsx`, `translations.spec.ts` and the Playwright helpers use. The root class is `shell` (not `app-shell`, which is AuthGate's inert wrapper).

**Screens** (straight swaps, no behaviour change):
- **Login** (`LoginScreen`, AuthGate's "Checking your session" card): a centred paper card, serif `2xl` title, `TextInput` for each field, primary `Button`, `InlineMessage` for problems and the session notice. Form names, labels and button names stay ("Log in to Ontotator", "Username", "Password", "Log in", "I have a setup or reset code").
- **Dashboard** (`App.tsx` without an open case): `AppShell` with `onLogout`, breadcrumb = the selected project's name, `actions` = the ontology summary, "Add ontology …" and "Import work package (.zip)" (`Button` size `sm`; names unchanged).
  - Project and mode selects → `Select` (ids `package-select`, `mode-select` kept).
  - Hero card → a quiet panel with `StatusBadge`; "Open case" primary.
  - Status tabs keep `dashboard-tab` buttons; the cases table → `DataTable` (label "Clinical Cases"; `rowProps` keeps click-select, double-click and Enter open, Space select, `tabIndex 0`, the title).
  - The missing-ontology prompt, notice (`aria-label="Import result"`) and error → `InlineMessage`; "Get started" → `EmptyState` with the same steps.
  - All inline colour styles go; layout styles move to `dashboard.css`.
- **Editor in the shell:** `App.tsx` renders `CaseScreen` inside `AppShell` with `density="reading"`, breadcrumb `[project, "Case <document id>"]` as plain text (leaving stays with CaseScreen's "← Dashboard" button and its unsaved-changes path) and, in this task, no `onLogout` yet (Task 9 adds logout from the editor behind the unsaved-changes guard, resolved T6a-Q2); `main` is a flex column filling the viewport so the editor keeps its full height. CaseScreen's own header becomes a `Toolbar` row under the shell header in Task 9.
- `design.spec.ts` gains `test("design: login and dashboard")`: login page → `login`; dashboard with the default fixture → `dashboard-compact-table`; axe `color-contrast` and the 12 px rule on both; the origin test now also covers the login page.

**Tests** (`appShell.test.tsx`): `shows_product_user_and_logout`; `no_logout_without_handler`; `breadcrumb_marks_the_current_page`; `side_nav_only_when_given`; `skip_link_targets_main`; `density_class_on_main`.

**Acceptance:**
- vitest and Playwright pass. Changed selectors only with a recorded reason (none expected: ids, names and the classes above are kept).
- `git grep -nE "#[0-9a-fA-F]{6}|rgba?\(" frontend/src/App.tsx frontend/src/app/LoginScreen.tsx frontend/src/app/AuthGate.tsx` prints nothing.
- Detector triaged. Commit: `feat(frontend): app shell, login and dashboard in the new design`.

---

### Task 9: Editor in the final look; final screenshot review

**Modify** `frontend/src/app/CaseScreen.tsx`, `frontend/src/App.tsx` (editor logout), `frontend/src/app/CaseNavigation.tsx`, `frontend/src/editor/*.tsx` (straight swaps only), `styles/screens/editor.css`, `styles/screens/tree.css`, `frontend/browser/design.spec.ts`, `frontend/tests/tokens.test.ts`.

- **Case header → `Toolbar`** (`className="case-toolbar"`, label "Case"): case navigation, mode badge, identity badge (`annotator-identity`, `annotator-name` kept), save status (`.status-badge` with `role="status"` and the revision title kept), then `IconButton` keyboard, "Retry" (`IconRetry`), "Export (.zip)" (`IconDownload`), primary "Finish & Submit Case" (`IconCheck`). Emoji glyphs go; the accessible names keep their words ("Retry", "Export (.zip)", "Finish & Submit Case").
- **Buttons, fields and messages** in `CaseScreen`, `CaseNavigation`, `AnnotationPanel`, `ReviewActions`, `LayerControls`, `SearchPanel`, `TreeBrowser` → `Button`, `IconButton`, `Select`, `Textarea`, `InlineMessage` where it is a straight swap (same names, same handlers). The conflict banner and action errors → `InlineMessage` (`aria-label="Revision conflict"` kept).
- **No inline colours:** `tokens.test.ts` gains `no_colour_literals_in_components` — no `.tsx` under `frontend/src` contains `#[0-9a-fA-F]{3,8}\b` or `rgba?\(` (the flag SVGs are `.svg` and stay).
- Apply Impeccable `polish` to the editor; then run the skill's finish handoff (`impeccable-finish-reviewer`) once and apply its material fixes.
- **Logout from the editor (resolved T6a-Q2):**
  - `CaseScreen` gains `leaveGuardRef?: React.MutableRefObject<((proceed: () => void) => void) | null>`. While mounted it sets the ref to a guard; on unmount it clears it.
  - The guard: with no pending edits (`queueRef.current.pendingCount() === 0` and no save in flight) it calls `proceed()` at once. Otherwise it opens a `ConfirmDialog` "Unsaved changes" ("Your latest changes are not saved yet."), confirm "Save and log out", cancel "Cancel". Confirm awaits `queueRef.current.flush()`, then calls `proceed()`. If the flush fails (error or revision conflict), it stays in the editor, shows the existing save error and does not log out. Cancel and Escape close the dialog and keep the session.
  - `App.tsx` passes `onLogout` to the editor's `AppShell` as `() => leaveGuardRef.current ? leaveGuardRef.current(onLogout) : onLogout()`.
  - Tests (`caseScreen.test.tsx` and `firstRun.test.tsx` or a new `editorLogout.test.tsx`): `logout_with_pending_changes_asks_first_and_cancel_keeps_the_session` (dialog shown, `onLogout` not called, editor still mounted); `save_and_log_out_flushes_the_draft_before_logging_out` (the pending command reaches `/workspaces/ws/commands` before `onLogout`); `a_failed_flush_does_not_log_out`; `logout_without_changes_has_no_dialog` (`onLogout` called at once, no dialog).
- **`.app-header` in the editor:** `CaseScreen`'s header element was `app-header`; it is now the toolbar, and the shell header carries `app-header`. Any test that located the case header by `.app-header` switches to `.case-toolbar`. **Reason (recorded):** two headers would otherwise share the class.
- `design.spec.ts`: all screenshots (login, dashboard, both editor states, the four deficiency shots, three viewports) are regenerated; axe and the 12 px rule run on all three screens.

**Final review:** show the user the regenerated `build/design-screenshots/` (spec §7, "at the end"). Changes requested here are made in this task before Task 10.

**Acceptance:** vitest and Playwright pass; the token tests pass; detector triaged; the user has seen the final screenshots. Commit: `feat(editor): editor toolbar, panels, dialogs and guarded logout in the new design`.

---

### Task 10: `DESIGN.md`, licences, embedded assets and the gate

**Create** `DESIGN.md`, `.impeccable/design.json`, `frontend/public/licenses/source-serif-4-OFL.txt`, `frontend/public/licenses/source-sans-3-OFL.txt`. **Modify** `THIRD_PARTY_NOTICES.md`, `scripts/check_wheel.py` (`REQUIRED_WHEEL_FILES`), `src/ontotator/web/` (rebuilt).

- **`DESIGN.md`** through `/impeccable document` (it records the shipped system, frontmatter tokens plus the sidecar `.impeccable/design.json`). It must contain, in English:
  1. **Principles:** direction C; the text leads, controls recede; one primary action per view; meaning never by colour alone; keyboard first; offline (no external assets).
  2. **Tokens:** every group with its values and its rule (colour literals only in `tokens.css`; changing a colour requires the token tests and the user).
  3. **Density rules:** `reading` for the editor, document and comparison views; `compact` for tables, lists, admin and workflow pages; how to switch (`AppShell density`, `.density-*`).
  4. **Typography:** the fonts and the ramp of this plan.
  5. **Marks:** the six fills, the state table, and that new mark states need a distinct line style or pattern and a passing `tokens.test.ts`.
  6. **Component inventory:** each `ui/` component with its props, when to use it, and the class names it keeps.
  7. **Shortcuts:** `useShortcut`, scopes, `?` help; every new screen registers its keys with a description.
  8. **Do / don't** with short examples: use `Button` not `<button className="btn …">`; use `DataTable` for lists of records; use `InlineMessage` for errors; no inline `style` colours; no new UI library; no CDN fonts; no emoji as icons; `Dialog` for every modal.
  9. **Binding for T3b, T5 and T4** (spec §6.5), and what T6b will change (spec §1).
- **Licences:** copy `node_modules/@fontsource-variable/source-serif-4/LICENSE` and `…/source-sans-3/LICENSE` to `frontend/public/licenses/` (Vite copies `public/` into the build, so the licence ships next to the fonts in the wheel and the image). `THIRD_PARTY_NOTICES.md` gains a "Fonts" section: Source Serif 4 and Source Sans 3, © Adobe, SIL Open Font License 1.1, bundled as woff2 via Fontsource, licence files in `web/licenses/`. `check_wheel.py` requires `ontotator/web/licenses/source-serif-4-OFL.txt` and `…/source-sans-3-OFL.txt`.
- **Embedded assets:** `npm --prefix frontend run build`, then replace `src/ontotator/web/` with `frontend/dist/`.
- **Checks:**
  - `uv run python scripts/license_notices.py --out-dir build/licenses && grep -c "SIL OPEN FONT LICENSE" build/licenses/npm-packages.txt` prints 2 or more.
  - `grep -rlE "fonts\.googleapis|fonts\.gstatic|https?://cdn" src/ontotator/web` prints nothing.
  - `"$IMPECCABLE" detect --json frontend/src` reports no untriaged finding (spec §7).
  - `scripts/check.sh` prints `All local checks passed.`

**Acceptance:** the checks above. Commit: `docs(design): record the design system; ship font licences; rebuild embedded assets`.

---

## Spec coverage

| Spec item | Task |
|---|---|
| D1 direction C, reading document | 1, 8, 9 |
| D2 two density modes | 1, 2, 8 (AppShell `density`), 10 |
| D3 light only, semantic tokens | 1, 2 |
| D4 own tokens and components, no UI dependency | 2–6 (only font packages and the dev-only `@axe-core/playwright` are added) |
| D5 self-hosted OFL fonts, no CDN | 1 (packages, origin test), 10 (licences, grep) |
| D6 English UI | all (no i18n added) |
| D7 prototype and approval before freeze | 1 (gate), 2 (freeze) |
| §3 token file and groups; styles split | 1, 2 |
| §3 marks distinguishable incl. colour-vision deficiencies; AA on marks | 1 (token tests, CVD emulation, computed-style test), 9 |
| §3 all text AA, functional text ≥ 12 px | 1, 8, 9 (axe `color-contrast`, size rule), token tests |
| §4 components with vitest tests | 3, 4, 6, 8 |
| §4 AppShell with breadcrumb, user, logout, optional side nav | 8; logout from the editor 9 |
| §4 existing screens use components where a straight swap | 7, 8, 9 |
| §5 registry, input suppression, scope precedence, `?` help, review keys moved unchanged | 5, 6, 7 |
| §6.1 prototype screenshots | 1 |
| §6.2–6.4 tokens, base, components, fonts; components and registry; three screens | 2–9 |
| §6.5 `DESIGN.md` | 10 |
| §7 tests unchanged except recorded selector changes; Playwright screenshots reviewed twice; detector clean; `scripts/check.sh` | 1, 9, 10 |
| §9 effect on T3b | the T3b plan is amended (2026-10-15 note) |

## Deviations from the spec

- **Mark token names:** the six colours are `--mark-N-fill` (with the shared `--mark-line`), not `--layer-N`. The editor assigns a colour per term (`termColorIndex`, a hash of the term id), not per annotation layer; layers are told apart by `LayerControls`. Naming them "layer" would mislead later plans.
- **"AI suggestion" state:** marks do not know a proposal's producer. The dashed style marks every proposal under review (`run--target`), which is where AI suggestions appear; the sidebar's `AiBadge` names the tool (T3b Task 10 adds the tool label).
- **Escape in four dialogs** now closes them without an action (Task 7); spec §4 requires it of `Dialog`, and the old dialogs ignored it (resolved T6a-Q3).
- **Logout from the editor** is new (Task 9, resolved T6a-Q2): a guarded logout with a save-or-cancel dialog when changes are pending.
- **Test tooling:** `@axe-core/playwright` (MPL-2.0) is a dev dependency only; it is not bundled.

## Resolved Q1–Q3 (2026-10-15, user)

| # | Question | Decision | Task |
|---|---|---|---|
| T6a-Q1 | Should a negated finding ("absent") look different in the text? | Yes: a hatch over the mark fill; the axis value stays in the detail pane. | 1 |
| T6a-Q2 | May a user log out from inside the editor? | Yes. With unsaved changes a `ConfirmDialog` asks first: "Save and log out" (flush, then log out) or "Cancel" (stay logged in). Without unsaved changes the logout is immediate. | 9 |
| T6a-Q3 | Should Escape close dialogs? | Yes: Escape closes every dialog without an action, except "Case submitted". | 7 |

## Open question

| # | Question | Provisional default | Task |
|---|---|---|---|
| T6a-Q4 | Fonts: Source Serif 4 and Source Sans 3? | Yes; the user confirms or swaps them at the Task 1 gate (any OFL pair; the plan's token names stay). | 1 |

## Risks

- **Merge with T2d:** T2d removes the ZIP import from `App.tsx` and the helpers while T6a restyles the same dashboard. Whichever merges second resolves; the dashboard is replaced by "My tasks" in T3b anyway, so T6a keeps its dashboard changes to straight swaps.
- **Pixel-sensitive Playwright specs:** `spans-resize.spec.ts`, `translations.spec.ts` and `tree.spec.ts` measure boxes. Serif text and new line heights shift them; the specs assert relations (inside, aligned), not absolute pixels, but every task with CSS runs the full e2e suite.
- **Font metrics in tests:** jsdom ignores fonts; only Playwright sees them. Screenshots vary slightly by OS, so they are for human review, not baselines.
- **CVD simulation:** Machado 2009 at severity 1.0 models dichromacy; anomalous trichromats see more. The thresholds are a floor, the line styles are the guarantee.
- **Bundle size:** the font subsets add about 1–2 MB of woff2 to the wheel and the image; browsers fetch only the subsets a page uses.
- **T3b expectations:** T3b plans its `Shell` on `AppShell`, `ConfirmDialog` from `ui/` and `DataTable`. Changing these contracts after T6a needs a matching T3b plan edit.

## Notes for implementers

- **Straight swap means:** same accessible name, same handler, same `id`/`data-testid`/structural class, same visible text. Anything else is a behaviour change and needs a recorded reason in the task and the commit body.
- **Do not split `App.tsx` or `CaseScreen.tsx`** (T6b). Swaps happen in place.
- **T5 and T4** use the `ui/` components, `DESIGN.md` and the shortcut registry for their UI tasks (spec §9); their plans reference this one when they start.
