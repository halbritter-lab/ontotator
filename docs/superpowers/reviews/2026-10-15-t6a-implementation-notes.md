# T6a Task 1 implementation notes

The second editor prototype keeps direction C (reading document), the approved
Source Serif 4 / Source Sans 3 fonts, and lighter highlighter marks. These are
draft tokens until the D7 screenshot approval gate; this record does not freeze
them or start Task 2.

## What mark colours mean

`frontend/src/editor/markColours.ts` is the semantic mapping layer. Its
`MARK_COLOUR_MEANING` currently selects `term`: the same term ID hashes to the
same one of six palette slots wherever it occurs. Hash collisions are possible;
a fill does not uniquely identify a term.

Callers supply term ID, layer ID and annotation kind to `markColourSlot`.
Changing `MARK_COLOUR_MEANING` to `layer` hashes the layer ID instead; choosing
`kind` uses fixed slots (own 1, target 0, source 3). A new meaning belongs in this
module, with its tests, rather than in rendering callers or CSS.

The layers of this mapping are separate:

- `markColours.ts` selects a slot from semantic attributes.
- `.run--color-N` in `frontend/src/styles.css` binds that slot to `--mark-N-fill`.
- `frontend/src/styles/tokens.css` owns the six physical fill colours.

Changing a palette colour therefore changes a token; changing what colour means
changes the mapping module. The previous `termColorIndex` helper in the span
adapter is removed.

Annotation state remains readable through line styles and patterns: own marks
have a solid underline, proposals a dashed underline, references a dotted
underline, negation adds a diagonal hatch, and selection adds a frame. Multiple
annotations thicken the underline. These state cues do not depend on the chosen
colour meaning.

## Softer fills and revised thresholds

The fills are `#f8f1a6`, `#d0edc4`, `#f9cba8`, `#cad6fd`, `#ecd0d6` and
`#b8e8ec`. A gradient leaves the upper portion transparent (through 40%) and
reaches the fill at 54%, continuing to the bottom. This keeps the highlight
mainly behind the lower half of the line; the negation hatch is layered over it.

`frontend/tests/tokens.test.ts` records and enforces the following floors:

| Check | Current floor | Previous floor |
| --- | --- | --- |
| Pairwise fill CIEDE2000, normal vision | 10 | 12 |
| Every fill versus the raised document sheet, CIEDE2000 | 10 | 10 |
| Pairwise fill CIEDE2000 after protan, deutan and tritan simulation | 4 | 8 |
| Text contrast on every fill | 4.5:1 (WCAG AA) | 4.5:1 |
| Focus/control boundaries and mark lines/selection contrast | 3:1 | 3:1 |

The rationale follows the token-test comment: normal-vision differences of at
least 10 keep neighbouring fills visibly different (a just-noticeable difference
is approximately 1–2, and approximately 5 is commonly described as obviously
different). Each fill also differs from the sheet by at least 10. Under Machado
2009 severity-1 dichromacy simulation, the floor of 4 prevents slots collapsing
to an identical colour. Requiring 8 with light, low-chroma fills would make them
heavy again, which the user rejected. The independent line styles and patterns
carry state; these colour-distance checks are palette regression floors, not a
claim that hue alone makes every term identifiable to every viewer.

WCAG text contrast was not relaxed. `--text` on every current fill exceeds 11:1;
the automated minimum remains AA at 4.5:1. The token suite also checks text on
surfaces and status backgrounds and the contrast of focus rings, strong control
boundaries, mark lines and selection frames.

## Prototype verification

The Task 1 close reran TypeScript checking and scanned all prototype source files
changed since the T2c merge base with Impeccable's detector. Typecheck passed;
the detector returned `[]`, so no finding required an exception or suppression.
The full Vitest suite passed (36 files, 334 tests). The first full Playwright run
passed 37 of 38 tests; the remaining failure was the exact panel/tree height
table in `frontend/browser/tree.spec.ts`. The approved font and compact header
change the available column height and content metrics. All assertions for
column placement, minimum sizes, scrolling and control visibility passed at all
eight viewport sizes. The expected pixel table was updated to those new metrics,
with those behavioral assertions preserved. Detailed suite results are in
`.superpowers/sdd/2026-10-15-t6a-design-foundation/task-1-close-report.md`.
The confirmation build and complete Playwright suite passed all 38 tests.

The v2 desktop screenshots for the D7 gate are in `t6a-prototype/`:
`editor-states-1440x900-v2.png`, `editor-review-1440x900-v2.png` and
`editor-states-deuteranopia-1440x900-v2.png`. The earlier unsuffixed screenshots
show the first iteration and should not be treated as the current appearance.
