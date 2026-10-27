# Assessment B: detector and native browser evidence

Assessment: independent B (`/root/ux_evidence_b`), 2026-10-18 UTC. No A output or other-review output was read. Findings were withheld until root explicitly confirmed A complete. No application source edits, suites, commits, candidate state transitions or port-18081 operations were performed. Only candidate logins/logouts, local view selection, historical viewing and a reverted unsaved settings-name probe occurred.

## Identity and detector setup

Concrete target `frontend/src`; derived slug `frontend-src`. `.impeccable/critique/ignore.md` does not exist. Context loaded successfully once with the bundled launcher. Source scope has 142 files, below the 500-file threshold. Bundled `impeccable detect --json frontend/src` exited 0 and returned `[]`: **0 findings / 0 rules / 0 affected files**. Exact JSON is archived in `ux-b-detector.json`. No CLI false positives exist to adjudicate. This is a source-pattern scan, not proof of accessibility or acceptance.

Browser target: isolated original-freeze `http://127.0.0.1:18190`; source SHA `ba0b91b4ff3c73ae8d358896957a4dd84d20d57f`; image `sha256:44186e3c2f685d693cea1f583f86613c1115bc57699a4670b61eb203f3c6a3e6`; source snapshot SHA256 `bd9e039462665507359af72c7a8a2e264e97f8a17a9ef8bd8f9d31fa050bd875`. This immutable candidate can lag later source fixes. The detector scans the current worktree; runtime observations apply only to this image and state. Prior acceptance activity left task 4 submitted/paused with one synthetic Seizure annotation and one submission, a German final result and an open report.

## Native browser and overlay provenance

Initial native fresh-tab attempt failed because A's browser service still owned profile `mcp-chrome-23b7283`. After root confirmed A called native browser_close, retry created B's own new tab. A mutable preflight changed document.title to `[Human] Ontotator Assessment B`, appended an inline script and verified its window flag true. The native Playwright run-code API supports mutation. No Browser visibility.set/get API is exposed by this harness; no explicit presentation/visibility claim is made. Native screenshots were captured and inspected.

Started bundled `impeccable live-server --background`, PID 19364 / port 8400. Actual `detect.js` injection and detector console output were confirmed on **five views**: login, Documents tree, Settings, Progress/warnings, task-4 annotation editor. Fresh full navigations were used from Settings onward so overlays would not accumulate across hash-only navigation. Overlay DOM was present (editor had five `.impeccable-overlay` nodes). The overlay banner intercepted a header logout click; it was dismissed before functional checks. This is tool interference, not an application failure. No persistent user-visible overlay remains after cleanup.

Observed browser console signals (occurrences, not deduplicated product defects):

| View | Rule signals and context |
| --- | --- |
| Login | `cream-palette`; `ai-color-palette` (purple/violet). |
| Documents | `heading-rhythm` on three visible Assignments h3 instances (12 px above vs 42 px below); `text-occlusion` on collapsed Current project label; `skipped-heading` h1 Documents → h3 Assignments; `cream-palette`. Detector summary separately reported 5 anti-patterns; raw emitted rows are preserved here instead of claiming an inconsistent aggregate. |
| Settings | `line-length`, approximately 135 chars/line; `cream-palette`. |
| Progress/warnings | `cream-palette` only. |
| Editor | `low-contrast`, white text on #8c8170 at 3.8:1; three `text-occlusion` signals on Find project, Current project and Project key inside the collapsed project selector; `cream-palette`. |

False-positive/context adjudication:

- Cream palette is the explicitly frozen Direction C visual brief. Do not replace the paper palette because the detector dislikes a common pattern.
- Purple/violet was a broad login signal, not a demonstrated visible accent defect; source contains retained compatibility tokens and the pinned design controls the palette. No redesign follows from this signal.
- Project-selector occlusion signals refer to content inside a collapsed details disclosure. Its accessible snapshot exposes only the summary until opened. They do not prove visible text is covered.
- The contrast signal targets the **disabled** Finish & Submit Case button in a submitted/held task. WCAG inactive-control contrast exemption applies; this is not a demonstrated AA failure of an active action.
- Assignments heading level/rhythm is a credible minor semantic/hierarchy cleanup opportunity (P2/P3), not a task blocker. Validate headings against the details/tree grouping before changing tags.
- Long Settings prose is a credible minor readability issue on large screens, but controls remain clearly grouped and section saves are visible.

## Responsive, keyboard and history evidence

All required viewport widths were exercised at height 960: **1440, 1024, 768, 720, 390, 320**. Documents, Settings and editor were measured across all six. Screenshots in `ux-b-evidence/` were reviewed.

- Documents tree: root scrollWidth matched viewport at every tested width. Filters/actions wrap. At 320 px the five filters occupy most of the first screen before texts appear: a secondary mobile efficiency concern for this desktop-first product, not inaccessible content.
- Editor with overlay removed: root scrollWidth matched every viewport. Left sidebar was 260 px at 1440 and 220 px at 1024/768/720. Below 700 it switches to List/Document/Details. Keyboard Enter on the saved Seizure row opened Details; mobile history remained reachable from List. At 768, text and details share the right column and the document remains readable; see `editor-768.png`. An earlier 5 px excess while overlay labels remained disappeared after their removal, so it is tool-generated, not an app overflow defect.
- Settings: no root excess at widths 720 and above. At 390/320 documentElement.scrollWidth was 499 while body width matched viewport. The only elements beyond viewport belonged to the intentionally scrolling Members table, whose container is 343/273 px wide with scrollWidth 546 and overflow-x:auto. At 320 its visible rect was x16–289 and its native horizontal scrollbar was visible (`settings-members-320.png`). No uncontained visible control was found. Treat the extra root metric as an investigation note, not proof that members controls are inaccessible.
- History: Submission 1 displayed the synthetic annotation note, Seizure identity, all three values and verified-layer state. This supports F13's annotation-note presentation in this one submission. It does not compare two historical notes because only one submission was available.
- History dialog: Tab stayed inside; Close showed `rgb(29,78,137) solid 2px` focus outline; Escape closed the dialog and restored focus to the Submission 1 trigger at desktop width. A first immediate DOM read raced the React dismissal; the bounded confirmed check awaited 200 ms and passed.
- Settings: temporary General name input edit showed `Unsaved changes in general.`; original input value was restored; no Save action was clicked. Section headings and local save buttons are clearly visible (`settings-clean-1440.png`).
- Submitted/held editor retained saved finding, visible Saved status, clear paused reason and submitted notice. Axis radios and Add Mention/Delete/Submit were disabled. Spanless is stated separately from clinical values/workflow state.
- Progress showed the explicit selected German result, missing-language omissions, open-report and hold-related entries with Review issue links. Two warnings for the same case/report destination are visible as separate causes; group presentation is a possible P2 clarity improvement, not evidence of an authorization failure.

Actual browser zoom: attempted native keyboard Control+Add (unsupported key) then Control+= four times. Before/after remained DPR 1, innerWidth 1440, visualViewport.scale 1. **Actual 200% browser zoom was not achieved or verified.** No CSS zoom surrogate was used. The 720 px resize is responsive evidence only. Screen-reader operation, full contrast matrix, full keyboard annotation creation and screen-magnification behavior were not exercised.

## Original manual protocol boundaries

This B pass independently supports F04 responsive geometry; F05 discoverable Submission history; F08/F09 labelled clinical values; F10 Saved explanation/status; F13 one historical annotation note; F14/F19 sectioned Settings/dirty feedback; F17 separate Spanless label; F33 current project disclosure/active project sections. It observes the submitted/held report surface from the extended accepted workflow contract.

Not exercised by B: complete re-create/default-confirm/relink pipeline F21–F29, actual final export content/provenance F30, prohibited-mode creation, optional-mode submission, clearing a saved note, additional-ontology scenarios F15 (explicitly deferred), second-reviewer pending queue, Dismiss with reason, deleting/changing a replacement, translation-review read-only coupled scrolling and preference restoration, large-project selector scaling, two-submission note comparison, complete account-expiry recovery, full report/hold resolution and clean restart/consolidation. Do not convert the detector or these focused checks into full manual acceptance. A/root have independent broader evidence; B did not read it.

## Cleanup and fallbacks

Logged out the candidate lead; own browser closed with native browser_close (tool reported no open tabs). Stopped the helper using `impeccable live-server stop --keep-inject`; exit 0, `Stopped live server on port 8400.` The keep-inject option avoided any source-entry rewrite; injection was browser-only. No temporary helper script was created. Screenshots and detector evidence intentionally remain. Failed Node require/dynamic-import credential attempts were abandoned; successful logins read the private credential file through a silent local tool result and did not print credentials. No passwords or runtime tokens are recorded in this report or evidence files.

Parent owns the combined critique snapshot and user close. Questions skipped for this subagent: parent synthesizes A+B and handles the final user-facing close under the already authorized acceptance scope.
