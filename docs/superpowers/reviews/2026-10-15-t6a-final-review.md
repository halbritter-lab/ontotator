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

## Integrated gate follow-up

The first attempts found one Ruff line wrap and a stale frontend assertion for
the deliberately removed decorative ontology label. Commits `5e9c309` and
`41de35c` fix these without product behavior changes. The replacement assertion
requires the accessible level-2 MONDO term heading. The original whole-source
reviewer approved this scoped follow-up; the complete frontend suite then
passed all 436 tests.

The backend step exposed a shared mutable pinned-ontology regression in the
previously reviewed T2e base (1,022 passed, one failed, one POSIX skip). Its
independently reviewed correction is recorded in the
[T2e follow-up](2026-10-15-t2e-final-review.md#integrated-cache-isolation-follow-up).
The complete combined gate will be rerun on the corrected descendant; these
partial runs do not establish final browser/container success.

## Final integrated gate

At `a17fb6a4bad16af6656916091fff51fddb0ecc59`, the complete command
`CHECK_CONTAINERS=1 CHECK_IMAGE=ontocurator:t6a-final scripts/check.sh` passed
with exit 0 in 787 seconds. The tested image, built from that same source, is
`sha256:eb0dcc146d5952026ae9ce64b5b46a95bab4eccf096879d0d3abc177cf7483ed`.

- Ruff, formatting, mypy, OpenAPI drift, TypeScript/API drift and wheel checks passed.
- Frontend: 436 tests in 53 files passed.
- PostgreSQL backend: 1,050 passed, one POSIX-only test skipped; 496.45 seconds.
- Playwright: all 39 scenarios passed in 2.4 minutes.
- Real stack browser smoke: one passed; all nine container checks passed.
- Wheel SHA256: `1207e1c4495ec11ac07e3e6598224add28b939a496f8137f5992a89ede508533`.

All ten T6a tasks and the integrated functional gate are complete. The source
and follow-up reviews are approved. Existing React/Starlette warnings remain.
This tested descendant covers both T2e and T6a source; it does not claim fresh
gates at the separate parent commits. P9 latency is independently still open,
as recorded in the load-test report. No main merge, push or deployment occurred.
