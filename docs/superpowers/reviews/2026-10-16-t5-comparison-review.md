# T5 Task11: comparison and native text interaction

Accepted on 2026-10-16 after independent specification/quality reviews of the
comparison source, exact-reference/current-authority corrections, shared worker
fixture, and final layout/test corrections. Runtime sources include `b2d80c1`
and combined `21d0d9a93f2fa56aef63c8454e850e5784d6438a`.

Comparison retains independent language/version/server-offered reference choices,
immutable text, equal or proportional paragraph coupling, and the original left
editor. Responsive rows preserve reading floors and native control reachability.
Actual current revocation conceals historical annotations while permitted sibling
text remains readable. Native Unicode selection, keyboard edge resize and
cross-paragraph pointer resize preserve exact codepoint offsets and markers.

Actual evidence is cumulative: at clean `b2d80c1`, eight of nine selected browser
cases passed; the final new-selection setup failed. A retained real-browser
diagnosis established that collapsed-caret arrows did not extend selection in
this non-editable Chromium surface. The test now uses actual native Shift-click
selection, accurately described, without changing vendor behavior. At clean
`21d0d9a`, that formerly failed case passed in the combined invocation below.
This is not a claim of pure-arrow caret browsing or one all-nine-comparison pass.

The two-line narrow layout correction was independently reviewed after reversible
computed-style/hit-test diagnosis and rebuilt-source checks. Original failures,
source reviews, logs, viewport evidence and verified resource closures remain in
the canonical controller and owning worktrees. Task12 records the shared final
invocation. Embedded assets, the complete final gate and packaged acceptance
remain Task15 work; no remote push occurred.
