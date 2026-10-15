# T6a final source review and acceptance record

Independent whole-source review covered `427c9b7..10a7d16`, including all ten
design-foundation tasks, the span adapter and negation/rendering changes,
components, keyboard registry, dialogs, shell, editor, browser assertions,
design documentation, bundled fonts, notices and wheel requirements.

**Source approved: no Critical, Important or actionable Minor findings.**
This was source inspection; the reviewer did not run the acceptance suite.
The final integrated gate remains pending and does not resolve P9 latency.

## Resolved finish-review findings

- Logout now captures the rejected-command count when confirmation opens. A
  rejection while waiting for the queue prevents logout and retains its error.
- Search clearing uses the shared SVG icon control with its accessible name.
- The redundant ontology label was removed while retaining the term heading/ID.

The original finish reviewer approved these scoped fixes after regression
coverage and settled desktop/mobile captures. The harness did not expose the
named finish-review role; a fresh reviewer followed the same review contract.
The substitution was disclosed rather than represented as a named tool run.

## Supplied verification

- Full frontend suite before the last scoped fixes: 434 passing tests. The
  final fix batch passed 43 focused tests, typecheck and frontend build.
- Browser coverage passed across the full run and targeted reruns, including
  the final eight-viewport tree geometry check. This is not a claim of one
  uninterrupted final full-suite run.
- Generated frontend and embedded assets match byte for byte (31 files).
  Public font licences retain exact installed-package bytes and LF endings.
- Real notice generation succeeded; the generated notices contain both fonts.
  The external-font/CDN scan had no matches.
- `uv run python scripts/check_wheel.py --out-dir build/t6a-static-wheel`
  passed at `10a7d16`, including lock and required licence-content checks.
  Wheel SHA256:
  `6da8bcd19f23202550d0191badf14587df9dd514860aaf2e2441d4441a8ae652`.

## Decisions and review bounds

- The approved direction C and soft lower-half highlights govern this change.
  The established colour-distance floors are 10/4, with contrast checks and
  non-colour state cues retained. No new visual-direction review is implied.
- The smaller-height tree floors reflect measured available space: 240/360 at
  1025/1280 by 720, and 230/350 at 1100 by 700. Relational geometry and viewport
  containment remain tested. Removing the label changed the measured 1920px
  split to rounded 480/494; the corresponding browser check passed.
- T2d's removal of ZIP import/export/upload UI remains authoritative. Earlier
  plan wording does not restore these retired controls.
- Continuation authorization covers the established visual direction. No new
  prototype approval date is invented. Task 1 notes are historical; DESIGN.md
  describes the current implementation.
- T2e backend behavior is separately reviewed. P9 latency, rebuilt-image
  behavior and the final complete gate require their own execution evidence.
- Future administration/workflow/variant screens, dark mode, i18n and
  App/CaseScreen decomposition remain later scope.
- The pre-existing comma-containing reference-ID text-click limitation and
  unchanged authentication overlay were not redesigned or freshly certified.
- Field's error-owned aria-invalid and printable-character Shift matching
  follow the explicit contracts. No speculative control migration, CSS
  deduplication or barrel-export expansion was requested.
- Existing development-tool advisories and React/Starlette warnings remain
  tracked baseline conditions. Binary-byte and detector checks were supplied
  executor evidence rather than independent reviewer execution.

No source-fix dispatch is required by this review. Local feature integration
does not imply a main-branch merge, publication or deployment.
