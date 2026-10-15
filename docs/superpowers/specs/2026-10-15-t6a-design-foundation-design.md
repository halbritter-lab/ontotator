# T6a: Design Foundation

As of: 2026-10-15 · Status: **design agreed**

## 1. Purpose and scope

The roadmap (§2.7) put the whole UI overhaul (T6) at the end. Since then the Impeccable skill has become available, and it is cheaper to fix the visual direction now: T3b (admin UI), T5 (variants, translation review) and T4 (workflows, adjudication) all add screens. If they are built on the old styles, they have to be redone later.

T6 is therefore split:

- **T6a (this spec):** visual direction, design tokens, base components, app shell and a shared keyboard-shortcut mechanism. The existing screens (login, dashboard, editor) get the new look. **No workflow changes.**
- **T6b (later, after T4):** click reduction in the editor and review flows (keyboard-first operation, fewer confirmations, selection without intermediate steps), and splitting `App.tsx` and `CaseScreen.tsx`. T6b gets its own spec.

T6a is frontend-only. It branches from the T2c head and can run in parallel with T2d and T2e. It must be merged before T3b starts.

## 2. Decisions

| # | Decision | Reason |
|---|----------|--------|
| D1 | Direction **C, "reading document"**: paper-like, editorial; the clinical text is set in a serif and gets space, controls recede. | Chosen by the user in the visual comparison (alternatives: A calm clinical, B dense workbench). Supports careful reading of clinical text. |
| D2 | **Two density modes:** `reading` (editor, document and comparison views; serif body text, generous line height) and `compact` (tables, lists, admin and workflow screens; sans-serif, tight rows). Same palette and type family in both. | Admin and review screens are table-heavy; direction C everywhere would show too few rows. |
| D3 | **Light theme only.** Tokens are semantic (`--surface`, `--text`, `--accent`, …), not literal (`--white`), so a dark theme can be added later without touching components. | YAGNI; the paper look is light by nature. |
| D4 | **Own tokens and a small in-house component set; no new UI dependency.** | Fits the existing code (React 18, plain CSS, custom properties); keeps direction C exact. Radix UI and full libraries (MUI, Mantine) were considered and rejected. |
| D5 | **Fonts are self-hosted** (woff2 in the frontend bundle, SIL OFL licensed); nothing loads from third-party CDNs. | Clinical texts; the app must work offline and on closed networks. |
| D6 | The UI language stays **English**; no i18n framework. | Current state; not requested. |
| D7 | **Prototype before freeze.** Direction C is first applied to the real editor with Impeccable; the user approves it (screenshots) before tokens are frozen and the other screens follow. | The direction is reversible in tokens but expensive once T3b–T4 screens are built on its density. |

## 3. Design tokens

- New file `frontend/src/styles/tokens.css` holds all custom properties; `styles.css` is split into `tokens.css`, `base.css` (reset, typography, focus), `components.css` and the existing screen-specific rules.
- Token groups: colour (surface, text, muted text, border, accent, success, warning, danger, each with a light variant), annotation layers (`--layer-0` … `--layer-5`, each with fill and mark), annotation states (selected, negated, AI suggestion), typography (serif and sans families, size ramp, line heights per density), spacing scale, radius, shadow, focus ring.
- Density is a class on a container (`.density-reading`, `.density-compact`) that switches spacing, row height and body font through tokens.
- **Annotation marks:** the six layer colours, "negated", "selected" and "AI suggestion" must be distinguishable from each other, including for common colour-vision deficiencies (the mark style, e.g. underline or pattern, carries meaning in addition to hue). Text on marks meets WCAG AA (4.5:1).
- All text meets WCAG AA contrast; functional text is at least 12 px.

## 4. Components

Located in `frontend/src/ui/`, one file per component, each with a vitest test:

- `Button` (primary, secondary, quiet, danger; loading and disabled states), `IconButton`
- `Field` with `TextInput`, `Select`, `Checkbox`, `Textarea` (label, hint, error)
- `DataTable` (compact density; sortable header, empty state, row selection hook-in)
- `Dialog` (focus trap, Escape closes, returns focus), `ConfirmDialog`
- `StatusBadge` (workflow and document states)
- `Kbd` (key hint)
- `Toolbar`, `EmptyState`, `InlineMessage` (info, warning, error)
- `AppShell`: header with product name, project breadcrumb, current user and logout; optional side navigation for admin pages (used by T3b with the hash router planned there, D-p)

Existing screens replace ad-hoc markup with these components where it is a straight swap; no behaviour changes.

## 5. Keyboard shortcuts

- `frontend/src/ui/shortcuts.ts`: a small registry with `useShortcut(keys, handler, {scope, description})`. It ignores keys while focus is in inputs, textareas and contenteditable elements, and resolves conflicts by scope (dialog > screen > global).
- `?` opens a help overlay listing the active shortcuts with `Kbd`. The existing "Keyboard shortcuts" dialog and the review keys (`1`–`4`, `Esc`) move onto the registry without changing their bindings.
- T3b, T5 and T4 register their shortcuts through it; T6b extends the bindings.

## 6. Deliverables

1. Prototype of direction C on the editor screen; screenshots for user approval (D7).
2. `tokens.css`, `base.css`, `components.css`; self-hosted fonts.
3. Components and `AppShell` (§4), shortcut registry (§5).
4. Login, dashboard and editor in the new look.
5. `DESIGN.md` at the repository root: principles, tokens, density rules, component inventory, do/don't examples. T3b, T5 and T4 plans reference it as binding.

## 7. Testing and acceptance

- All existing backend, vitest and Playwright tests pass unchanged, except for selectors that change for a reason recorded in the plan.
- New vitest tests per component and for the shortcut registry (focus-in-input suppression, scope precedence).
- Playwright screenshot run of login, dashboard, editor (reading density) and one compact table; reviewed by the user at the prototype gate and at the end.
- Impeccable design hooks report no unaddressed findings on changed files.
- Gate: `scripts/check.sh`.

## 8. Out of scope

- Workflow and click-count changes, splitting `App.tsx` and `CaseScreen.tsx` (T6b).
- Dark theme, i18n.
- New screens of T3b, T5, T4 (they adopt T6a).

## 9. Effect on other plans

- **T3b:** replace "use the existing styles in `styles.css` and add `admin-` layout classes" with "use T6a components, `AppShell` and `DESIGN.md`".
- **T5, T4:** UI tasks use T6a components and the shortcut registry.
- **Roadmap order:** T0 → T1 → T2a–c → (T2d ∥ T2e ∥ T6a) → T3a → T3b → T5 → T4 → T6b.
