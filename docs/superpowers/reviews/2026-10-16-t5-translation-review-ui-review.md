# T5 Task12: translation review interface

Accepted on 2026-10-16 after independent specification/quality source and browser
reviews. Final source corrections preserve raw draft semantics, actual clinical
form fields, current qualification/revision authority, guarded navigation and
same-user versus different-user session recovery. The actual case dispatcher
uses assignment metadata and the dedicated review endpoint. Immutable submitted
records remain read-only and management reopen preserves their history.

At clean runtime `21d0d9a93f2fa56aef63c8454e850e5784d6438a`, one actual command
ran the previously failed comparison case plus all eight new review cases:

`npm.cmd run test:e2e -- browser/compare.spec.ts:275 browser/translation-review.spec.ts --workers=1`

All nine passed without retry, UTC14:45:57.484426–14:47:11.714071, exit0,
74.229645 seconds including build/startup. Review coverage includes lead
assignment, clinical correction/diff/form/save/submit, actual new variant,
read-only reload and reopen; independent failed checks and unchanged refusal;
qualification/profile/conflict/leave guards; real session expiry with retained
same-user work or protected-state removal; and1280/1024/600 geometry/Unicode.

Independent review checked the full raw log, exact tested source, all recorded
artifact hashes and clean closure. No own process/listener/test container remains.
Pre-existing M365/WebView PID matches were preserved and correctly classified.
Three actual viewport screenshots are retained. Successful traces were not
generated under retain-on-failure, and the line reporter did not persist buffered
fixture attachments; numeric job IDs are not retrospectively claimed.

Task11's other eight passes remain their separately recorded bank. The canonical
controller reports and owning build/task12-browser/b67-actual directory retain
the detailed evidence. Tasks13–15 browser/package completion, final main merge
and the runnable interim remain pending; no remote push or deployment occurred.
