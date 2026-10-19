# Native final UX confirmation

Date: 2026-10-19 Europe/Berlin (browser/server timestamps 2026-10-18 UTC).

This is one bounded confirmation pass of the five requested fixes, not another independent review or human user acceptance. Native Playwright MCP interacted only with http://127.0.0.1:18190. Port18081 was never visited. No source fixes, PostgreSQL runners, exports, or final-selection writes were performed. The browser was signed out and browser_close completed at the end.

Candidate identity from current-runtime.json:
- image sha256:93a9ee49d143fa91c9eb4caf9709ca88170f81e5a1002ea5b8f2aada03df15f6
- source snapshot da15c693f0e0fb56e426612649e0e5bfd1b736935bc0ced5648e5cda1b6da6a4
- project key t5-acceptance

Credentials remained private. They were loaded from the original private credentials file into a transient hidden local file input solely to populate the native login form, then the input was removed before login. No credential values were printed, saved into these reports, sent to another origin, or included in screenshot artifacts.

## Observed outcomes

1. **Submission history after successful carry-forward: confirmed.** As demo-lead, opened report report-6851e7c9c3c1493296288dffd762b02b, deliberately selected Release selected pauses and Task4, supplied the synthetic reason below and applied the action. UI displayed Paused tasks: None and the report remained open. As demo-annotator, opened Task4 and Work rounds; chose exact own submission sub-f568003ee202f17a and started a carry-forward round. Its one spanless carried finding began pending and preserved Present/Patient/Current plus its original note. Open saved finding led to its ordinary reason editor. Appended the synthetic confirmation sentence below, then clicked Complete carried finding review, which saved the note and moved the count to0pending/1completed. Explicit whole-text checkbox and Submit produced sub-e6197456dcd77cba at2026-10-18T22:57:08.674927+00:00. Chose Stay in case. Without any navigation or reload, Submission1 appeared immediately in that round's history. Opening it showed both note lines, and the historical dialog had zero textboxes; Finish & Submit Case was disabled. Separately reopened historical Round1 and its original submission: its original note was unchanged and contained no appended confirmation sentence. Returning as lead showed the final selection still pinned to accepted-translation / sub-f568003ee202f17a. No new final selection was made.

2. **Settings local section jumps and scoped feedback: confirmed.** At1440x1000, Annotation rules button scrolled and focused the existing Rules form. Save rules top75px and dirty status top121px preceded the first rule control top185px. Hidden axis values disclosure was closed. Changed required spanless reason to optional, jumped to General and back: optional draft remained. Discard rule changes restored required. No settings save was made.

3. **Compact Documents and exact final pin: confirmed.** Initial document tree had3logical texts and6language summaries; all version bodies, assignment actions and secondary text details were closed. German synthetic-accepted summary visibly retained Final result selected: accepted-translation / sub-f568003ee202f17a. Expanded that exact version only to use View text. Other documents remained compact. This does not claim every logical text fits simultaneously within one viewport.

4. **CaseViewer comparison alignment: confirmed at1440x1000.** One shared Comparison controls toolbar above both columns (x12,y213,width1416,height50) contained Couple scrolling and close. Current text identity and Comparison text identity both had top272px,height114px. Each of their three selectors had top334px,height40px. Captured visual inspection confirmed the matched hierarchy and aligned selector rows. Did not enable coupling or perform a scroll synchronization experiment; no new scrolling claim is made.

5. **Open project picker bounds: confirmed at390x844 and320x844.** At390, the menu was left16/right374 (width358); both Find project and Current project labels plus input/select were left33/right357 (width324). At320, menu left16/right304 (width288); labels/input/select left33/right287 (width254). All rectangles had nonzero dimensions and stayed within the viewport. Visual inspection confirmed label starts and input/select starts visible; the native select truncates the trailing long project key at320, while its start and dropdown arrow remain readable. This is actual element geometry, not an inference from page scrollWidth.

## Mutations and final state

- Lead report resume reason: Synthetic final UX confirmation: release the prior test pause to review a carry-forward round; saved history is retained.
- Report remains open with no held tasks; Task4 is unheld.
- New active personal round: Round2, carry-forward, submitted. Prior ordinary Round1 is superseded and readable.
- Carried annotation source: exact old submission sub-f568003ee202f17a.
- Original note kept: Synthetic UX acceptance: spanless recovery demonstration.
- Appended line: Synthetic final UX confirmation: carried finding and original note reviewed on unchanged text.
- New submitted receipt: sub-e6197456dcd77cba.
- Old immutable history and lead-selected exact result remain unchanged.
- Other tasks, source/translation text, settings and final selection were not changed.

## Evidence

Six screenshots, captured during the same pass and visually inspected together:
- docs/superpowers/reviews/evidence/2026-10-19-acceptance-ux/confirmation/settings-rules.png
- docs/superpowers/reviews/evidence/2026-10-19-acceptance-ux/confirmation/documents-compact.png
- docs/superpowers/reviews/evidence/2026-10-19-acceptance-ux/confirmation/compare-aligned.png
- docs/superpowers/reviews/evidence/2026-10-19-acceptance-ux/confirmation/project-picker-390.png
- docs/superpowers/reviews/evidence/2026-10-19-acceptance-ux/confirmation/project-picker-320.png
- docs/superpowers/reviews/evidence/2026-10-19-acceptance-ux/confirmation/history-immediate-after-submit.png

One automation locator timeout was corrected in-place: the carried spanless note is labelled Reason for no text span, rather than Annotation note. The initial click had selected the finding correctly; no mutation or product failure occurred during that timeout.

Actual200%browser zoom remains unverified from prior A/B; it was not retried or simulated in this pass. Full multilingual ontology response timing and original correction/reanchor/provenance export scenarios are outside these five confirmations and remain covered only by their separately recorded evidence.
