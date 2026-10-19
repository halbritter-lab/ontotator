# Quick Fixes and Export Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan work package by work package. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the nine quick fixes Q1 to Q9 of [2026-10-19-quick-fixes-and-export-design.md](../specs/2026-10-19-quick-fixes-and-export-design.md), including its "Resolved questions", as independent, locally verified work packages.

**Architecture:** Eight small frontend changes (dialog footers, My tasks filter and counts, a link-based project picker, a one-primary export preflight, two CSS fixes, one formatter swap) and one backend change: the final export worker adds `README.txt` and `index.csv`, built by a new pure module `exchange/final_export_guide.py` from the frozen snapshot only. The snapshot gains two additive keys for new exports (`project_name`, `submission_recorded_at`); the receipt format stays `ontocurator-final-export/v1`.

**Tech Stack:** Python 3.12, SQLAlchemy 2, PostgreSQL (pytest), `csv`/`textwrap` from the standard library; React 18, TypeScript, Vitest + Testing Library, Playwright.

---

## Ground rules for every implementer

- Work in `C:/Users/jan-p/Development/ontocurator/.worktrees/phase0-implementation`. It holds many **uncommitted** changes that must survive. Never run `git reset`, `git checkout -- <file>`, `git stash`, `git clean`, or overwrite a whole file you do not own with Write. Edit on top of the working tree with the Edit tool.
- **Do not commit or push.** Each WP ends with a "Commit point" (files and message) for the user to run later.
- Only edit the files your WP **owns**. You may read the files it lists as "Read".
- **Exclusive file ownership across plans** (same rule as the Documents plan, "Files shared with sibling plans"): while a WP runs, it is the only agent in any plan that may write its owned files. A WP whose owned file is also written by a sibling WP starts only when the coordinator has confirmed that no sibling WP holding that file is running, and respects the cross-plan order in "Cross-plan sequencing" below. Inside a shared file a WP still edits only the hunk or anchored region named in the WP, but separate hunks never justify running in parallel.
- `frontend/src/styles/components.css` is written by WP-C, WP-D, WP-E and WP-F here and by Documents U1 and editor F1 elsewhere. These WPs never run at the same time; each edits only its anchored region. Always Read the file right before each Edit. Never reorder or reformat other rules.
- **Obsolescence applies to tests too.** When a sibling WP has replaced a component, this plan neither edits the component nor adds or keeps tests that assert the replaced UI. Each WP states its skip check; a skipped part is reported as "obsolete (replaced by <plan> <WP>)".
- English for all files and UI copy. Icons only from `frontend/src/ui/icons.tsx`; no Unicode glyphs as icons ("·" as a text separator is fine where the spec uses it).
- **Shell: every command in this plan is written for the Bash tool (Git Bash), run from the worktree root** (`VAR=value cmd`, `test -f`, `grep`). Do not run them in PowerShell. `rg` is not installed in Git Bash; searches use `grep -rnE`.
- No CI or GitHub Actions. Local verification only, from the worktree root:
  - Backend tests need PostgreSQL (Docker running, or `ONTOCURATOR_TEST_PG_URL` set to a throwaway superuser URL): `uv run pytest tests/<file>.py -q`.
  - Backend static: `uv run ruff check . && uv run ruff format --check . && uv run mypy src`.
  - Frontend unit (always with these worker flags on this 16 GB machine): `npm --prefix frontend test -- <path relative to frontend> --maxWorkers=4 --minWorkers=1`.
  - Types: `npm --prefix frontend run typecheck`.
  - Browser: set a port unique to this worktree, then build and run one spec: `HPO_E2E_PORT=18791 npm --prefix frontend run test:e2e -- <spec file name>` (one Playwright worker; it starts `tests/browser_server.py`).
  - Full gates: `CHECK_VITEST_WORKERS=4 bash scripts/check.sh --only static`, `--only frontend`, `--only backend`, `--only browser` (set `HPO_E2E_PORT` for the browser stage too).
- At most two test-heavy agents at once (backend pytest with PostgreSQL, Playwright, full gates), counted across all plans. Single-file Vitest runs count as light. Only one Playwright run per worktree at a time, across all plans.

## Decisions taken in this plan (beyond the spec text)

1. **`submitted_at` replaces `submission_created_at`** in `index.csv` (Resolved question 2). Value: the server's `SubmissionRow.recorded_at`, frozen into the snapshot as `submission_recorded_at` (`{submission_id: "YYYY-MM-DDTHH:MM:SS.ffffffZ"}`); empty for snapshots frozen before this change.
2. **`index.csv` is written with a UTF-8 BOM** (Resolved question 3), CRLF, Python `csv` defaults. `README.txt` is UTF-8 without BOM, LF.
3. **Project name is frozen** into the snapshot as `project_name` so the README needs no live read; older snapshots fall back to the project key.
4. **Provenance rows without a variant** use the document ID as `case_id` and the document language as `language` (selections and omissions use the stored `case_id`/`language` as before).
5. **Job running** (queued or running final export): the only primary button is "Download final export", `aria-disabled="true"`, described by the visible hint "The download is available when the export has finished." This keeps "exactly one primary per state" true in every state.
6. **My tasks counts** (Resolved question 4): four list items "Open: n", "In progress: n", "Submitted: n", "of which paused: n"; Open counts `open` and `reopened`, so the first three add up to the total.

## Shared files and ownership across sibling plans

Sibling WP IDs: **Documents** = `2026-10-19-documents-lead-table.md` (B1-B9, U1-U3, D1, D2, D4-D8, DX, E1-E4, P1-P7, X1; there is no D3); **Editor** = `2026-10-19-editor-carried-review.md` (B1-B4, F0-F11; written "editor F1" etc.); **Problem reports** = `2026-10-19-problem-reports.md` (WP1-WP10; written "problem-reports WP6" etc.).

| File | Writers across plans | What this plan does / assumes |
|---|---|---|
| `frontend/src/ui/Dialog.tsx` | Editor F1 (header close, fixed footer) | Not modified. WP-B uses the existing `footer` prop, which renders `.modal-actions` outside `.ui-dialog-body`. After editor F1 every dialog with `onClose` also has a header button named "Close", so every test in this plan locates footer buttons inside `.modal-actions` and never by the bare name "Close" alone. |
| `frontend/src/tasks/TaskProblemActions.tsx` | Problem-reports WP6 (rewrite: footer "New report"/"Close", no Reload) | WP-B part B2 moves "Reload my reports"/"Close reports" into `footer` **only if WP6 has not landed** (check: `grep -c "Reload my reports" frontend/src/tasks/TaskProblemActions.tsx` prints more than 0). If WP6 runs later, it takes over the B2 `describe` block of `frontend/tests/dialogFooters.test.tsx` and replaces its case by "puts New report then Close in the problem dialog footer" (problem-reports WP6). If WP6 landed first, B2 and its test case are skipped (problem-reports CR-3). |
| `frontend/src/tasks/RoundInputEvidenceDialog.tsx`, `WorkRoundsDialog.tsx` | Editor F8a (rewrite: Close in footer and header, new titles) | WP-B part B1 swaps Close into `footer` **only if F8a has not landed** (check: `grep -c 'title="Original carried finding"' frontend/src/tasks/RoundInputEvidenceDialog.tsx` prints more than 0). If F8a runs later, it takes over the B1 `describe` block of `frontend/tests/dialogFooters.test.tsx` and updates its assertions to the rewritten dialogs (editor F8a owns that block afterwards; F8a and problem-reports WP6 never edit the file at the same time). |
| `frontend/src/styles/screens/editor.css` | This plan WP-F (Q7 ring, Q8 padding); editor F4a (width variables, separator; applies Q7 itself if missing); editor F4b (deletes the dead Q8 selectors after editor F6b and F8a) | WP-F runs **before editor F4a**. Q8 per selector: `.round-input-panel ol` only while `frontend/src/tasks/RoundInputPanel.tsx` exists (editor F6b deletes it); `.work-round-actions ol` only while editor F8a has not landed. Editor F4b later deletes the dead selectors together with the matching `it` in `frontend/tests/quickFixStyles.test.ts` (one `it` per selector, see WP-F). |
| `frontend/src/styles/components.css` | Documents U1 (whole file, incl. `.btn[aria-disabled]`, forced-colours block), editor F1 (`.ui-dialog*` block), this plan WP-C, WP-D, WP-E, WP-F | One writer at a time. This plan edits only anchored regions: WP-F removes the dead rule at ~129-132; WP-D replaces the `.shell-project-*` block (~696-707) and keeps the `@media (max-width: 699px)` lines; WP-C inserts after the `.stat-row dd` rule; WP-E inserts after `.historical-note`. Nothing is appended at the end of the file. |
| `frontend/src/ui/Button.tsx` | Documents U1 (Task 3.1: `loading` keeps focus via `aria-disabled`, never native `disabled`) | Not modified. **WP-E depends on Documents U1** (it puts `loading` on the focused Create button; before U1 a loading button is natively disabled and drops focus). Check before WP-E: `grep -n 'aria-disabled={loading' frontend/src/ui/Button.tsx` must hit; otherwise stop and report. WP-D relies only on `ref` forwarding (present today). |
| `frontend/src/admin/FinalExportPanel.tsx` | This plan WP-E (state, actions, copy); Documents E1 (Task 6.2: local `WorkflowWarnings` with row links) | **WP-E runs before Documents E1.** E1 must keep the `final-warning-list` class and must not touch Cancel or the primary buttons (its plan says so). If E1 has already landed, WP-E adds the class to the local `WorkflowWarnings` copy and does not touch `ProjectDashboardPage.tsx`. |
| `frontend/src/admin/ProjectDashboardPage.tsx`, `frontend/tests/projectDashboard.test.tsx` | Documents E1 (Task 6.1 deletes both) | WP-E adds `className="final-warning-list"` to the `<ul>` in `WorkflowWarnings` only, and only while the file exists. |
| `frontend/tests/finalSelection.test.tsx` | This plan WP-E; Documents E3 (Task 6.4 adjusts it) | **WP-E runs before Documents E3**; E3 keeps WP-E's export-panel tests. |
| `frontend/src/variants/FinalResultSelector.tsx`, `frontend/tests/finalResultSelector.test.tsx` | Documents E3 (Task 6.4 deletes both) | WP-G only while the file exists, never while E3 runs. |
| `frontend/src/app/router.ts`, `frontend/src/App.tsx` | Documents U3 and later | Not modified. WP-D uses `routeHref` and the existing routes only. |
| `src/ontocurator/application/final_results.py` | Documents B3 → B4 (`_authorize`, `_projection`, `select()`) | WP-A edits only the `freeze()` payload construction. **WP-A runs after Documents B4** (or, if it can finish first, before Documents B3 starts); never between B3 and B4 or concurrently with either. |
| `frontend/browser/final-workflow.spec.ts`, `frontend/browser/admin.spec.ts` | Documents P7 (Task 7.6), problem-reports WP9 (`final-workflow.spec.ts` report steps), editor F10 (specs asserting removed UI) | **WP-E (export lines ~109-112) and WP-D (`selectProject` ~111-116) run before Documents P7, problem-reports WP9 and editor F10.** |
| `tests/browser_server.py` | Documents P1, problem-reports WP9, editor F10 (one registration line each) | Not modified. WP-H uses the existing `/__test_translation_review__?workflow=true` fixture. |

## Cross-plan sequencing

Constraints the coordinator enforces (in addition to "at most two heavy agents" and "one Playwright run per worktree"):

| Quick-fix WP | Must start after | Must finish before | Never concurrently with | Skip (obsolete) when |
|---|---|---|---|---|
| WP-A | Documents B4 (preferred; alternatively finish before Documents B3 starts) | — | Documents B3, B4 | — |
| WP-B | — | editor F8a and problem-reports WP6, if it is to do any work | editor F8a, problem-reports WP6 | Part B1 when editor F8a landed; part B2 when problem-reports WP6 landed; the whole WP when both landed, or when both are scheduled in the same release (Q1 then ships with them) |
| WP-F | — | editor F4a, F6, F8a | Documents U1, editor F1, editor F4a, WP-C, WP-D, WP-E | Q7 CSS edit when F4a already applied Q7's rule (keep the tests); Q8 per selector as in "Shared files" |
| WP-C | Documents U1 | — | any other `components.css` writer | — |
| WP-D | Documents U1, WP-C | Documents P7 | any other `components.css` writer; Documents P7 | — |
| WP-E | Documents U1 (Button busy state), WP-D | Documents E1, E3, P7; problem-reports WP9; editor F10 | any other `components.css` writer; Documents E1, E3, P7; problem-reports WP9; editor F10 | — |
| WP-G | — | Documents E3 | Documents E3 | `test -f frontend/src/variants/FinalResultSelector.tsx` fails |
| WP-H | WP-B, WP-D, WP-E, WP-F | — | every other Playwright run in this worktree; any WP writing `final-workflow.spec.ts`, `admin.spec.ts`, `sidebar.spec.ts`, `spans-resize.spec.ts` or `design.spec.ts` | Q1 subtests per dialog as in WP-B; Q8 test when editor F6 landed |
| WP-I | all of the above | — | every other heavy agent | — |

`components.css` writers in this plan therefore run one after another: **WP-F early (before Documents U1, or between U1 and editor F1), then after Documents U1: WP-C → WP-D → WP-E**.

## Work packages, dependencies and lanes

| WP | Fix | Owns (writes) | Heavy tests? | Depends on |
|---|---|---|---|---|
| WP-A | Q5 backend: `README.txt`, `index.csv`, frozen keys | `src/ontocurator/exchange/final_export_guide.py` (new), `src/ontocurator/exchange/final_export.py`, `src/ontocurator/application/final_results.py` (`freeze()` payload only), `tests/test_final_export_guide.py` (new), `tests/test_final_export_archive.py` (new) | yes (pytest + PostgreSQL) | Documents B4 (see sequencing) |
| WP-B | Q1 dialog Close in footer | B1: `frontend/src/tasks/RoundInputEvidenceDialog.tsx`, `frontend/src/tasks/WorkRoundsDialog.tsx`; B2: `frontend/src/tasks/TaskProblemActions.tsx`; `frontend/tests/dialogFooters.test.tsx` (new) | no | none; parts skipped per sequencing |
| WP-C | Q2 filter + Q9 counts | `frontend/src/tasks/MyTasks.tsx`, `frontend/tests/myTasks.test.tsx`, components.css region "after `.stat-row dd`" | no | Documents U1 (`components.css` slot) |
| WP-D | Q3 project picker + Q2 header names | `frontend/src/app/ProjectPicker.tsx` (new), `frontend/src/app/Shell.tsx`, `frontend/tests/projectPicker.test.tsx` (new), `frontend/tests/shell.test.tsx`, `frontend/browser/admin.spec.ts` (`selectProject` only), components.css region `.shell-project-*` | no | Documents U1 (`components.css` slot), WP-C |
| WP-E | Q4 preflight + Q5 copy | `frontend/src/admin/FinalExportPanel.tsx`, `frontend/src/admin/ProjectDashboardPage.tsx` (one class, while it exists), `frontend/tests/finalSelection.test.tsx`, `frontend/browser/final-workflow.spec.ts` (export lines only), components.css region "after `.historical-note`" | no | **Documents U1**, WP-D |
| WP-F | Q7 focus ring + Q8 list markers | `frontend/src/styles/screens/editor.css`, `frontend/tests/tokens.test.ts`, `frontend/tests/quickFixStyles.test.ts` (new), components.css dead rule ~129-132 | no | none (before editor F4a) |
| WP-G | Q6 one time zone (conditional) | `frontend/src/variants/FinalResultSelector.tsx`, `frontend/tests/finalResultSelector.test.tsx` | no | skip if Documents E3 landed |
| WP-H | Browser acceptance for Q1, Q3, Q4, Q7, Q8 | `frontend/browser/quick-fixes.spec.ts` (new) | yes (Playwright) | WP-B, WP-D, WP-E, WP-F |
| WP-I | Final gate | none (fixes go back to the owning WP) | yes | all |

```
Documents B4 ──> WP-A ──────────────────────────────────────────────┐
WP-B (gated) ───────────────────────────┐                           │
WP-F (before editor F4a) ───────────────┤                           │
Documents U1 ──> WP-C ──> WP-D ──> WP-E ┴──> WP-H (browser) ────────┼──> WP-I (gate)
WP-G (conditional, before Documents E3) ────────────────────────────┘
```

Recommended lanes (at most two heavy at once across all plans):

- **Lane 1 (heavy):** WP-A (after Documents B4), then WP-H once WP-B/D/E/F are done.
- **Lane 2 (light, holds `components.css`):** WP-F first (before editor F4a; not alongside Documents U1 or editor F1), then after Documents U1: WP-C → WP-D → WP-E.
- **Lane 3 (light):** WP-B (gated parts), then WP-G (before Documents E3).
- **Then alone:** WP-I.

---

## WP-A: `README.txt` and `index.csv` in the final export (Q5 backend)

**Goal:** The final export ZIP gains `README.txt` and `index.csv`, derived only from the frozen snapshot, hashed in `receipt.files`, byte-identical for the same snapshot.

**Spec sections:** Q5 (all subsections), Resolved questions 1 to 3.

**Sequencing:** after Documents B4 (preferred) or entirely before Documents B3 starts; never concurrently with B3 or B4 (`final_results.py`). If B3/B4 already landed, Read `freeze()` again before editing; the anchor is still the `payload = {` construction.

**Owns:** `src/ontocurator/exchange/final_export_guide.py` (create), `src/ontocurator/exchange/final_export.py`, `src/ontocurator/application/final_results.py` (only the `payload = {...}` construction in `freeze()`, ~line 512), `tests/test_final_export_guide.py` (create), `tests/test_final_export_archive.py` (create).

**Read:** `src/ontocurator/exchange/final_content.py` (`freeze_content` output shape), `src/ontocurator/exchange/jobs.py:217-375` (`serialize_t1_content`: units appended in `content.submissions` order; `ontospan.write_bundle` names them `documents/{index:05d}.json`, 0-based; set id `submission-{id}`), `tests/test_final_export.py` (fixture pattern), `src/ontocurator/storage/tables.py` (`SubmissionRow.recorded_at`, `ProjectRow.name`).

**Facts:** snapshot `payload` keys today: `format`, `project`, `request`, `state` (`selections[{case_id, language, document_id, submission_id, revision}]`, `warnings[{id, code, case_id, language, reason, ...}]`, `omissions[{case_id, language}]`), `immutable_submissions`, `content` (`documents` dict in frozen order with `document`, `source_text_sha256`, `variant` or null; `submissions` list of `Submission` JSON with `submission_id`, `origin_key{document_id, annotator_id, mode}`, `snapshots`), `round_inputs`, `round_kinds` (`{submission_id: "ordinary"|"carry_forward"|"clean_restart"|"consolidation"}`), `selected_submission_ids`.

### Task A1: Pure guide builders, test first

- [ ] **Step 1: Write the failing test** `tests/test_final_export_guide.py`:

```python
"""README.txt and index.csv are pure functions of the frozen snapshot."""

import csv
import io
from datetime import UTC, datetime

from ontocurator.exchange.final_export_guide import (
    INDEX_COLUMNS,
    build_index_csv,
    build_readme,
    guide_files,
)


def _doc(doc_id, language, variant=None):
    return {
        "document": {"document_id": doc_id, "text": "x", "language": language, "text_sha256": "h"},
        "source_text_sha256": "s",
        "variant": variant,
    }


def _variant(doc_id, case_id, language, version, origin):
    return {
        "document_id": doc_id, "case_id": case_id, "external_id": case_id, "language": language,
        "version": version, "origin": origin, "derived_from": None, "translation": None,
        "translation_status": None, "status_reason": None, "text_sha256": "h",
    }


def _sub(sid, doc_id, author="reader-0001", mode="independent", findings=1):
    return {
        "submission_id": sid,
        "origin_key": {"document_id": doc_id, "annotator_id": author, "mode": mode},
        "snapshots": [{}] * findings,
    }


def payload(**extra):
    return {
        "project": "t5",
        "project_name": "T5 acceptance",
        "state": {
            "selections": [
                {"case_id": "case-µ", "language": "de", "document_id": "de/v1", "submission_id": "final", "revision": 1},
            ],
            "warnings": [
                {"id": "w2", "code": "SELECTED_ROUND_SUPERSEDED", "case_id": "case-µ", "language": "de", "reason": "The selected result belongs to an earlier work round. Review the selection."},
                {"id": "w1", "code": "OPEN_PROBLEM_REPORT", "case_id": "case-µ", "language": "de", "reason": "An open problem report needs a lead decision."},
                {"id": "w3", "code": "MISSING_FINAL_SELECTION", "case_id": "case, two", "language": "en", "reason": "No final result selected."},
            ],
            "omissions": [{"case_id": "case, two", "language": "en"}],
        },
        "content": {
            "documents": {
                "en/v1": _doc("en/v1", "en", _variant("en/v1", "case-µ", "en", 1, "native")),
                "de/v1": _doc("de/v1", "de", _variant("de/v1", "case-µ", "de", 1, "machine_translation")),
            },
            "submissions": [
                _sub("earlier", "de/v1", author="reader-0002"),
                _sub("final", "de/v1", findings=3),
            ],
        },
        "round_kinds": {"final": "consolidation", "earlier": "ordinary"},
        "selected_submission_ids": ["final"],
        "submission_recorded_at": {"final": "2026-10-19T08:40:00.000000Z", "earlier": "2026-10-18T22:57:00.000000Z"},
        **extra,
    }


def rows(data: bytes):
    assert data.startswith(b"\xef\xbb\xbf")
    text = data.decode("utf-8-sig")
    assert "\r\n" in text and "\n" not in text.replace("\r\n", "")
    return list(csv.DictReader(io.StringIO(text, newline="")))


def test_index_has_one_row_per_selection_omission_and_provenance_in_order():
    data = build_index_csv(payload(), ["final"], ["earlier"])
    table = rows(data)
    assert tuple(table[0].keys()) == INDEX_COLUMNS
    assert [(r["case_id"], r["language"], r["row_type"]) for r in table] == [
        ("case, two", "en", "omitted"),
        ("case-µ", "de", "selected"),
        ("case-µ", "de", "provenance"),
    ]
    omitted, selected, provenance = table
    assert omitted["document_id"] == omitted["submission_id"] == omitted["bundle_entry"] == ""
    assert omitted["warning_codes"] == "MISSING_FINAL_SELECTION"
    assert selected == {
        "row_type": "selected", "case_id": "case-µ", "language": "de", "document_id": "de/v1",
        "text_version": "1", "text_origin": "machine_translation", "submission_id": "final",
        "submission_kind": "consolidation", "author": "reader-0001",
        "submitted_at": "2026-10-19T08:40:00.000000Z", "findings": "3",
        "archive_file": "selected.t1.zip", "bundle_entry": "documents/00000.json",
        "annotation_set_id": "submission-final", "source_text_line": "2",
        "warning_codes": "OPEN_PROBLEM_REPORT;SELECTED_ROUND_SUPERSEDED",
    }
    assert provenance["archive_file"] == "provenance.t1.zip"
    assert provenance["bundle_entry"] == "documents/00000.json"
    assert provenance["submission_kind"] == "annotation"
    assert provenance["author"] == "reader-0002"


def test_submission_kind_falls_back_to_mode():
    data = payload()
    data["content"]["submissions"][0]["origin_key"]["mode"] = "review"
    data["round_kinds"] = {"earlier": "carry_forward"}
    table = rows(build_index_csv(data, ["final"], ["earlier"]))
    assert {r["submission_id"]: r["submission_kind"] for r in table if r["submission_id"]} == {
        "final": "annotation", "earlier": "carry_forward",
    }
    data["round_kinds"] = {}
    table = rows(build_index_csv(data, ["final"], ["earlier"]))
    assert {r["submission_id"]: r["submission_kind"] for r in table if r["submission_id"]}["earlier"] == "review"


def test_old_snapshots_without_recorded_time_leave_submitted_at_empty():
    data = payload()
    del data["submission_recorded_at"]
    assert {r["submitted_at"] for r in rows(build_index_csv(data, ["final"], ["earlier"]))} == {""}


AT = datetime(2026, 10, 19, 8, 42, 17, tzinfo=UTC)


def test_readme_lists_everything_in_plain_text():
    text = build_readme(payload(), snapshot_id="snap-1", snapshot_sha256="ab" * 32, snapshot_created_at=AT, provenance_ids=["earlier"]).decode("utf-8")
    assert "\r" not in text and not text.startswith("\ufeff")
    assert text.startswith("Ontocurator final export\n========================\n")
    for line in [
        "Project:          T5 acceptance (t5)",
        "Snapshot ID:      snap-1",
        f"Snapshot SHA-256: {'ab' * 32}",
        "Snapshot time:    2026-10-19 08:42:17 UTC",
        "Selected final results:            1",
        "Omitted text and language pairs:   1",
        "Warnings acknowledged at export:   3",
        "Provenance-only submissions:       1",
        "provenance.t1.zip",
        "case, two (en): no final result was selected. No other submission was",
        "case-µ (de)",
        "[OPEN_PROBLEM_REPORT]",
        "Verify\n------",
    ]:
        assert line in text, line
    assert "submitted_at" in text


def test_readme_says_none_and_hides_provenance_when_empty():
    data = payload()
    data["state"]["warnings"] = []
    data["state"]["omissions"] = []
    text = build_readme(data, snapshot_id="s", snapshot_sha256="0" * 64, snapshot_created_at=AT, provenance_ids=[]).decode()
    assert "Warnings acknowledged at export\n-------------------------------\nNone.\n" in text
    assert "Omitted\n-------\nNone.\n" in text
    assert "provenance.t1.zip" not in text


def test_guide_files_are_deterministic_and_follow_content_order():
    first = guide_files(payload(), snapshot_id="s", snapshot_sha256="0" * 64, snapshot_created_at=AT)
    second = guide_files(payload(), snapshot_id="s", snapshot_sha256="0" * 64, snapshot_created_at=AT)
    assert first == second
    assert set(first) == {"README.txt", "index.csv"}
    selected = [r for r in rows(first["index.csv"]) if r["row_type"] == "selected"]
    assert selected[0]["bundle_entry"] == "documents/00000.json"


def test_project_name_falls_back_to_key():
    data = payload()
    del data["project_name"]
    text = build_readme(data, snapshot_id="s", snapshot_sha256="0" * 64, snapshot_created_at=AT, provenance_ids=[]).decode()
    assert "Project:          t5\n" in text
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_final_export_guide.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'ontocurator.exchange.final_export_guide'`.

- [ ] **Step 3: Implement** `src/ontocurator/exchange/final_export_guide.py`:

```python
"""Plain-language guide (README.txt) and result table (index.csv) for a final export.

Both are derived only from the frozen snapshot payload and the snapshot row, so
the same snapshot always yields byte-identical files. Nothing inside the T1
bundles is renamed; the README explains the ontospan names instead.
"""

import csv
import io
import textwrap
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any

INDEX_COLUMNS = (
    "row_type",
    "case_id",
    "language",
    "document_id",
    "text_version",
    "text_origin",
    "submission_id",
    "submission_kind",
    "author",
    "submitted_at",
    "findings",
    "archive_file",
    "bundle_entry",
    "annotation_set_id",
    "source_text_line",
    "warning_codes",
)
_ROW_ORDER = {"selected": 0, "omitted": 1, "provenance": 2}
_WIDTH = 76


def bundle_entry(index: int) -> str:
    """The entry name ``ontospan.write_bundle`` gives the unit at 0-based ``index``."""
    return f"documents/{index:05d}.json"


def submission_kind(submission: Mapping[str, Any], round_kinds: Mapping[str, str]) -> str:
    kind = round_kinds.get(submission["submission_id"])
    if kind in {"consolidation", "carry_forward"}:
        return kind
    return "review" if submission["origin_key"]["mode"] == "review" else "annotation"


def _warning_codes(payload: Mapping[str, Any]) -> dict[tuple[str, str], list[str]]:
    codes: dict[tuple[str, str], set[str]] = {}
    for warning in payload["state"]["warnings"]:
        codes.setdefault((warning["case_id"], warning["language"]), set()).add(warning["code"])
    return {key: sorted(values) for key, values in codes.items()}


def build_index_csv(
    payload: Mapping[str, Any],
    selected_order: Sequence[str],
    provenance_order: Sequence[str],
) -> bytes:
    """One row per selection, omission and provenance-only submission."""
    content = payload["content"]
    documents: Mapping[str, Any] = content["documents"]
    submissions = {sub["submission_id"]: sub for sub in content["submissions"]}
    lines = {doc_id: number for number, doc_id in enumerate(documents, start=1)}
    recorded: Mapping[str, str] = payload.get("submission_recorded_at", {})
    round_kinds: Mapping[str, str] = payload["round_kinds"]
    codes = _warning_codes(payload)

    def codes_for(case_id: str, language: str) -> str:
        return ";".join(codes.get((case_id, language), []))

    def submission_row(
        row_type: str, case_id: str, language: str, document_id: str, sid: str, archive: str, index: int
    ) -> dict[str, str]:
        sub = submissions[sid]
        variant = documents[document_id]["variant"] or {}
        return {
            "row_type": row_type,
            "case_id": case_id,
            "language": language,
            "document_id": document_id,
            "text_version": str(variant.get("version", "")),
            "text_origin": variant.get("origin") or "",
            "submission_id": sid,
            "submission_kind": submission_kind(sub, round_kinds),
            "author": sub["origin_key"]["annotator_id"],
            "submitted_at": recorded.get(sid, ""),
            "findings": str(len(sub["snapshots"])),
            "archive_file": archive,
            "bundle_entry": bundle_entry(index),
            "annotation_set_id": f"submission-{sid}",
            "source_text_line": str(lines[document_id]),
            "warning_codes": codes_for(case_id, language),
        }

    selected_index = {sid: index for index, sid in enumerate(selected_order)}
    table: list[dict[str, str]] = []
    for selection in payload["state"]["selections"]:
        sid = selection["submission_id"]
        table.append(
            submission_row(
                "selected", selection["case_id"], selection["language"],
                selection["document_id"], sid, "selected.t1.zip", selected_index[sid],
            )
        )
    for omission in payload["state"]["omissions"]:
        row = dict.fromkeys(INDEX_COLUMNS, "")
        row.update(
            row_type="omitted",
            case_id=omission["case_id"],
            language=omission["language"],
            warning_codes=codes_for(omission["case_id"], omission["language"]),
        )
        table.append(row)
    for index, sid in enumerate(provenance_order):
        document_id = submissions[sid]["origin_key"]["document_id"]
        entry = documents[document_id]
        variant = entry["variant"]
        case_id = variant["case_id"] if variant else document_id
        language = variant["language"] if variant else entry["document"]["language"]
        table.append(
            submission_row("provenance", case_id, language, document_id, sid, "provenance.t1.zip", index)
        )
    table.sort(key=lambda r: (r["case_id"], r["language"], _ROW_ORDER[r["row_type"]], r["submission_id"]))
    out = io.StringIO(newline="")
    writer = csv.DictWriter(out, fieldnames=INDEX_COLUMNS)
    writer.writeheader()
    writer.writerows(table)
    return out.getvalue().encode("utf-8-sig")


def _heading(title: str, rule: str = "-") -> list[str]:
    return [title, rule * len(title)]


def _wrap(text: str, first: str = "", rest: str = "") -> list[str]:
    return textwrap.wrap(text, width=_WIDTH, initial_indent=first, subsequent_indent=rest)


def _utc(value: datetime) -> str:
    moment = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    return moment.strftime("%Y-%m-%d %H:%M:%S UTC")


def build_readme(
    payload: Mapping[str, Any],
    *,
    snapshot_id: str,
    snapshot_sha256: str,
    snapshot_created_at: datetime,
    provenance_ids: Sequence[str],
) -> bytes:
    key = payload["project"]
    name = payload.get("project_name") or key
    state = payload["state"]
    out: list[str] = [*_heading("Ontocurator final export", "="), ""]
    out += [
        f"Project:          {name if name == key else f'{name} ({key})'}",
        f"Snapshot ID:      {snapshot_id}",
        f"Snapshot SHA-256: {snapshot_sha256}",
        f"Snapshot time:    {_utc(snapshot_created_at)}",
        "",
        *_heading("Summary"),
        f"{'Selected final results:':<35}{len(state['selections'])}",
        f"{'Omitted text and language pairs:':<35}{len(state['omissions'])}",
        f"{'Warnings acknowledged at export:':<35}{len(state['warnings'])}",
        f"{'Provenance-only submissions:':<35}{len(provenance_ids)}",
        "",
        *_heading("What is in this archive"),
        "README.txt          This guide.",
        "index.csv           One row per selected result, omission and provenance",
        "                    submission, with the file and entry that holds it.",
        "selected.t1.zip     The selected final results as a T1 (ontospan) bundle.",
    ]
    if provenance_ids:
        out += [
            "provenance.t1.zip   Earlier submissions that selected results refer to",
            "                    through carried or merged findings. Not final results.",
        ]
    out += [
        "source-texts.jsonl  The exact text versions the results refer to, one JSON",
        "                    object per line.",
        "receipt.json        Audit receipt: selections, warnings, omissions, review",
        "                    decisions and the SHA-256 of every other file, including",
        "                    this README and index.csv.",
        "",
        *_heading("How to read it"),
        *_wrap('Start with index.csv. Rows with row_type "selected" are the final results.', "- ", "  "),
        *_wrap(
            "A T1 bundle is a ZIP with manifest.json and documents/NNNNN.json, one file "
            'per submission. index.csv names the file in "bundle_entry".',
            "- ", "  ",
        ),
        *_wrap(
            "Text positions are Unicode code points into the text of the matching line "
            'of source-texts.jsonl (column "source_text_line").',
            "- ", "  ",
        ),
        *_wrap("Author labels are pseudonyms.", "- ", "  "),
        *_wrap(
            'submitted_at is the time the server recorded the submission, in UTC. '
            "It is empty for exports prepared before this column existed.",
            "- ", "  ",
        ),
        *_wrap(
            '"provenance" rows are earlier submissions referenced by carried or merged '
            "findings, not final results.",
            "- ", "  ",
        ),
        *_wrap(
            "Names inside the bundles (bundle_id, set ids, field names) follow the "
            "ontospan format and are kept unchanged on purpose.",
            "- ", "  ",
        ),
        "",
        *_heading("Omitted"),
    ]
    omissions = sorted(state["omissions"], key=lambda o: (o["case_id"], o["language"]))
    out += [
        line
        for o in omissions
        for line in _wrap(
            f"{o['case_id']} ({o['language']}): no final result was selected. "
            "No other submission was substituted."
        )
    ] or ["None."]
    out += ["", *_heading("Warnings acknowledged at export")]
    groups: dict[tuple[str, str], list[Mapping[str, Any]]] = {}
    for warning in state["warnings"]:
        groups.setdefault((warning["case_id"], warning["language"]), []).append(warning)
    if not groups:
        out.append("None.")
    for (case_id, language), items in sorted(groups.items()):
        out.append(f"{case_id} ({language})")
        for warning in items:
            out += _wrap(f"{warning['reason']} [{warning['code']}]", "  - ", "    ")
    out += [
        "",
        *_heading("Verify"),
        *_wrap(
            'Compute the SHA-256 of each file and compare it with "files" in '
            "receipt.json. receipt.json itself is not listed there."
        ),
    ]
    return ("\n".join(out) + "\n").encode("utf-8")


def guide_files(
    payload: Mapping[str, Any],
    *,
    snapshot_id: str,
    snapshot_sha256: str,
    snapshot_created_at: datetime,
) -> dict[str, bytes]:
    """README.txt and index.csv, ordered exactly as the worker serializes bundles."""
    selected_ids = set(payload["selected_submission_ids"])
    ordered = [sub["submission_id"] for sub in payload["content"]["submissions"]]
    selected_order = [sid for sid in ordered if sid in selected_ids]
    provenance_order = [sid for sid in ordered if sid not in selected_ids]
    return {
        "README.txt": build_readme(
            payload,
            snapshot_id=snapshot_id,
            snapshot_sha256=snapshot_sha256,
            snapshot_created_at=snapshot_created_at,
            provenance_ids=provenance_order,
        ),
        "index.csv": build_index_csv(payload, selected_order, provenance_order),
    }
```

Note: the order in `guide_files` equals the worker's order because the worker thaws `payload["content"]["submissions"]` into `content.submissions` and filters it with the same `selected_ids` (`final_export.py:108-113, 130-132`).

- [ ] **Step 4: Run** `uv run pytest tests/test_final_export_guide.py -q` — Expected: PASS (7 tests). Then `uv run ruff format src/ontocurator/exchange/final_export_guide.py tests/test_final_export_guide.py` and `uv run ruff check src/ontocurator/exchange/final_export_guide.py tests/test_final_export_guide.py`.

### Task A2: Freeze project name and server submission time

- [ ] **Step 1: Write the failing integration test** `tests/test_final_export_archive.py`:

```python
"""The final archive carries README.txt and index.csv, hashed in the receipt."""

import csv
import hashlib
import io
import json
import zipfile

from sqlalchemy import select
from test_annotation_versions import seed_submission
from test_case_api import BASE, SOURCE
from test_case_api import case_env as case_env

from ontocurator.exchange.final_export_guide import guide_files
from ontocurator.storage.final_tables import ExportSelectionSnapshotRow


def _export(env):
    seed_submission(env, "alice", "original")
    selected = env.lead.put(
        f"{BASE}/final-selections",
        json={"document_id": SOURCE, "submission_id": "original", "expected_revision": 0},
    )
    assert selected.status_code == 200, selected.text
    state = env.lead.post(f"{BASE}/exports/final/preflight").json()
    queued = env.lead.post(
        f"{BASE}/exports/final",
        json={
            "request_id": "guide-1",
            "state_digest": state["state_digest"],
            "acknowledged_warnings": [
                {"id": w["id"], "cause_revision": w["cause_revision"]} for w in state["warnings"]
            ],
            "accepted_omissions": state["omissions"],
        },
    )
    assert queued.status_code == 200, queued.text
    job_id = queued.json()["job_id"]
    result = env.app.state.jobs.run(env.app.state.jobs.claim(job_id, "guide-test"), "guide-test")
    assert result.status == "succeeded", result.error
    downloaded = env.lead.get(f"/api/v1/jobs/{job_id}/download")
    assert downloaded.status_code == 200, downloaded.text
    return state, zipfile.ZipFile(io.BytesIO(downloaded.content))


def test_archive_contains_hashed_readme_and_index(case_env):
    state, archive = _export(case_env)
    names = set(archive.namelist())
    assert {"selected.t1.zip", "source-texts.jsonl", "receipt.json", "README.txt", "index.csv"} <= names
    receipt = json.loads(archive.read("receipt.json"))
    assert receipt["format"] == "ontocurator-final-export/v1"
    assert set(receipt["files"]) == names - {"receipt.json"}
    for name, digest in receipt["files"].items():
        assert hashlib.sha256(archive.read(name)).hexdigest() == digest, name
    table = list(csv.DictReader(io.StringIO(archive.read("index.csv").decode("utf-8-sig"), newline="")))
    assert len(table) == (
        len(state["selections"]) + len(state["omissions"]) + len(receipt["provenance_only_submission_ids"])
    )
    selected_rows = [row for row in table if row["row_type"] == "selected"]
    assert [row["submission_id"] for row in selected_rows] == ["original"]
    assert selected_rows[0]["submitted_at"].endswith("Z")
    with zipfile.ZipFile(io.BytesIO(archive.read("selected.t1.zip"))) as bundle:
        for row in selected_rows:
            unit = json.loads(bundle.read(row["bundle_entry"]))
            assert unit["annotation_set"]["annotation_set_id"] == row["annotation_set_id"]
    readme = archive.read("README.txt").decode("utf-8")
    assert readme.startswith("Ontocurator final export\n")
    assert f"Snapshot ID:      {receipt['snapshot_id']}" in readme


def test_guide_files_are_a_pure_function_of_the_stored_snapshot(case_env):
    _state, archive = _export(case_env)
    receipt = json.loads(archive.read("receipt.json"))
    with case_env.db.transaction() as conn:
        row = conn.execute(
            select(ExportSelectionSnapshotRow).where(
                ExportSelectionSnapshotRow.snapshot_id == receipt["snapshot_id"]
            )
        ).mappings().one()
    assert "project_name" in row["payload"]
    assert set(row["payload"]["submission_recorded_at"]) == {"original"}
    again = guide_files(
        row["payload"],
        snapshot_id=row["snapshot_id"],
        snapshot_sha256=row["sha256"],
        snapshot_created_at=row["created_at"],
    )
    assert again["README.txt"] == archive.read("README.txt")
    assert again["index.csv"] == archive.read("index.csv")
```

If `case_env` does not expose `db`, use `case_env.app.state.repo.db` (both appear in `tests/test_case_api.py:37-40`).

- [ ] **Step 2: Run** `uv run pytest tests/test_final_export_archive.py -q` — Expected: FAIL (`README.txt` missing from the archive).

- [ ] **Step 3: Freeze the two keys** in `src/ontocurator/application/final_results.py`, inside `freeze()`, directly before `payload = {` (~line 512). Add `ProjectRow` and `SubmissionRow` to the existing `from ontocurator.storage.tables import (...)` block if they are not imported yet; `UTC` is already imported.

```python
            recorded_at = {
                sid: at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
                for sid, at in conn.execute(
                    select(SubmissionRow.submission_id, SubmissionRow.recorded_at).where(
                        SubmissionRow.project_id == pid,
                        SubmissionRow.submission_id.in_(closure_ids),
                    )
                ).all()
            }
            project_name = conn.execute(
                select(ProjectRow.name).where(ProjectRow.id == pid)
            ).scalar_one()
```

and add to the payload dict, after `"selected_submission_ids": selected_ids,`:

```python
                "project_name": project_name,
                "submission_recorded_at": recorded_at,
```

The snapshot hash changes only for new exports; old snapshots keep verifying because `state_digest(row["payload"])` is computed over the stored payload.

- [ ] **Step 4: Write the files in the worker.** In `src/ontocurator/exchange/final_export.py` add `from ontocurator.exchange.final_export_guide import guide_files` and, directly before `receipt = {` (~line 148), insert:

```python
    files.update(
        guide_files(
            payload,
            snapshot_id=row["snapshot_id"],
            snapshot_sha256=row["sha256"],
            snapshot_created_at=row["created_at"],
        )
    )
```

Nothing else changes: `receipt["files"]` already hashes every entry of `files`, and the ZIP loop writes them.

- [ ] **Step 5: Run**

```
uv run pytest tests/test_final_export_archive.py tests/test_final_export_guide.py tests/test_final_export.py tests/test_final_human_export.py tests/test_final_source_reviews.py tests/test_final_results.py tests/test_snapshot_privacy.py -q
uv run ruff check . && uv run ruff format --check . && uv run mypy src
```

Expected: all PASS; ruff and mypy clean.

**Done checklist (WP-A):**
- [ ] Archive names include `README.txt` and `index.csv`; `receipt.files` hashes them; every hash recomputes.
- [ ] `index.csv` has a BOM, CRLF, the 16 columns in order, one row per selection, omission and provenance submission, sorted as specified.
- [ ] Each `selected` row's `bundle_entry` opens to a unit with the listed `annotation_set_id`.
- [ ] README/index are a pure function of the stored snapshot row.
- [ ] Existing final export tests pass unchanged.
- [ ] **Commit point:** `src/ontocurator/exchange/final_export_guide.py src/ontocurator/exchange/final_export.py src/ontocurator/application/final_results.py tests/test_final_export_guide.py tests/test_final_export_archive.py` — `feat(export): add README.txt and index.csv to the final export`.

---

## WP-B: Dialog Close in the fixed footer (Q1)

**Goal:** Close buttons of the three dialogs render in `Dialog`'s `footer`, outside the scrolling body. Labels unchanged.

**Spec section:** Q1.

**Owns:** part **B1** `frontend/src/tasks/RoundInputEvidenceDialog.tsx`, `frontend/src/tasks/WorkRoundsDialog.tsx`; part **B2** `frontend/src/tasks/TaskProblemActions.tsx`; `frontend/tests/dialogFooters.test.tsx` (create, one `describe` per part).

**Step 0: Obsolescence check** (Bash, worktree root). Skip a part, including its `describe` block and its implementation bullet, when its replacement has landed; report it as "obsolete (replaced by …)". If both parts are obsolete, stop and mark WP-B obsolete.
- B1 is obsolete when editor F8a landed: `grep -c 'title="Original carried finding"' frontend/src/tasks/RoundInputEvidenceDialog.tsx` prints `0`.
- B2 is obsolete when problem-reports WP6 landed: `grep -c "Reload my reports" frontend/src/tasks/TaskProblemActions.tsx` prints `0`. Then do not write the B2 `describe` block ("puts Reload my reports then Close reports in the footer …") either (problem-reports CR-3).

Handover: the `describe` blocks are self-contained so that editor F8a (B1) and problem-reports WP6 (B2), when they run after WP-B, delete their block instead of editing it.

**Read:** `frontend/src/ui/Dialog.tsx` (the `footer` prop renders `<div className="modal-actions">` after `.ui-dialog-body`; after editor F1 the header also has a "Close" button, so footer buttons are always found inside `.modal-actions`).

- [ ] **Step 1: Write the failing test** `frontend/tests/dialogFooters.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type AssignmentView, type RoundInputView } from "../src/api/client";
import { RoundInputEvidenceDialog } from "../src/tasks/RoundInputEvidenceDialog";
import { WorkRoundsDialog } from "../src/tasks/WorkRoundsDialog";
import { TaskProblemActions } from "../src/tasks/TaskProblemActions";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const never = <T,>() => new Promise<T>(() => undefined);
/** The footer of the open dialog; header buttons (editor F1) are never matched. */
const footer = (dialog: HTMLElement = screen.getByRole("dialog")) => {
  const actions = dialog.querySelector<HTMLElement>(":scope > .modal-actions");
  expect(actions, "dialog has a footer").not.toBeNull();
  return within(actions!);
};
const notInBody = (button: HTMLElement) => expect(button.closest(".ui-dialog-body")).toBeNull();
const assignment = { id: 7, task: "annotate", project_key: "p", document_id: "d", held: false, hold_reason: null, workflow_revision: 0 } as unknown as AssignmentView;

// B1: obsolete after editor F8a (F8a deletes this block).
describe("B1 task dialogs: Close in the footer", () => {
  it("puts Close original evidence in the footer", () => {
    vi.spyOn(api, "getVariantText").mockReturnValue(never());
    const input = { source_submission_id: "s", source_snapshot: { document_id: "d", text_sha256: "h", evidence: [] } } as unknown as RoundInputView;
    render(<RoundInputEvidenceDialog projectKey="p" input={input} onClose={vi.fn()} labelFor={() => null} />);
    notInBody(footer().getByRole("button", { name: "Close original evidence" }));
  });

  it("puts Close in the Work rounds footer and keeps Retry in the body", async () => {
    vi.spyOn(api, "listWorkRounds").mockRejectedValue(new Error("offline"));
    vi.spyOn(api, "listRoundSources").mockResolvedValue([]);
    render(<WorkRoundsDialog assignment={assignment} onClose={vi.fn()} onCreate={vi.fn()} onOpen={vi.fn()} onReload={vi.fn()} />);
    notInBody(footer(screen.getByRole("dialog", { name: "Work rounds" })).getByRole("button", { name: "Close" }));
    const retry = await screen.findByRole("button", { name: "Retry round list" });
    expect(retry.closest(".ui-dialog-body")).not.toBeNull();
  });
});

// B2: obsolete after problem-reports WP6 (WP6 deletes this block).
describe("B2 task problem reports: footer actions", () => {
  it("puts Reload my reports then Close reports in the footer, both disabled while busy", async () => {
    vi.spyOn(api, "listProblemReports").mockReturnValue(never());
    vi.spyOn(api, "getAssignmentMetadata").mockReturnValue(never());
    render(<TaskProblemActions assignment={assignment} onSaveBeforeReport={vi.fn()} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "My problem reports" }));
    const dialog = screen.getByRole("dialog", { name: "Task problem reports" });
    const reload = footer(dialog).getByRole("button", { name: "Reload my reports" });
    const close = footer(dialog).getByRole("button", { name: "Close reports" });
    notInBody(reload); notInBody(close);
    expect(reload.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((close as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Task problem reports" })).toBeDefined();
  });
});
```

If an `AssignmentView` field the components read is missing from the cast object (TypeScript is satisfied by the cast; runtime may not be), add it with a neutral value.

- [ ] **Step 2: Run** `npm --prefix frontend test -- tests/dialogFooters.test.tsx --maxWorkers=4 --minWorkers=1` — Expected: FAIL (buttons are inside `.ui-dialog-body`).

- [ ] **Step 3: Implement.**
  - (B1) `RoundInputEvidenceDialog.tsx`: delete line 23 (`<Button onClick={onClose}>Close original evidence</Button>`) and open the dialog with `<Dialog open title="Original carried finding" onClose={onClose} size="lg" footer={<Button onClick={onClose}>Close original evidence</Button>}>`.
  - (B1) `WorkRoundsDialog.tsx`: delete line 23 (`<Button onClick={onClose}>Close</Button>`); `<Dialog open title="Work rounds" onClose={onClose} size="lg" footer={<Button onClick={onClose}>Close</Button>}>`. "Retry round list" stays in the body.
  - (B2) `TaskProblemActions.tsx`: delete lines 59-60 and pass

    ```tsx
    footer={<>
      <Button disabled={busy} onClick={() => { void load(); }}>Reload my reports</Button>
      <Button disabled={busy} onClick={() => setOpen(false)}>Close reports</Button>
    </>}
    ```

    on the `<Dialog open title="Task problem reports" ...>` element. `onClose` keeps `if (!busy) setOpen(false)`.

- [ ] **Step 4: Run** the new test plus neighbours: `npm --prefix frontend test -- tests/dialogFooters.test.tsx tests/problemReports.test.tsx tests/workRoundActions.test.tsx tests/ui --maxWorkers=4 --minWorkers=1` and `npm --prefix frontend run typecheck` — Expected: PASS.

**Done checklist (WP-B):** every non-obsolete dialog has Close in `.modal-actions`; obsolete parts reported with the replacing WP; labels unchanged; busy behaviour unchanged; typecheck clean. Viewport and Tab-wrap checks happen in WP-H.
**Commit point:** the changed components (B1 and/or B2) and `frontend/tests/dialogFooters.test.tsx` — `fix(ui): keep dialog close actions in the fixed footer`.

---

## WP-C: My tasks filter label, visibility and counts (Q2 local part, Q9)

**Goal:** The local filter is labelled "Filter my tasks by project", first option "All my tasks", shown only for two or more task projects or an active filter. Counts are a labelled list, hidden without tasks.

**Spec sections:** Q2 (Target first two bullets, Acceptance), Q9, Resolved question 4.

**Sequencing:** after Documents U1; holds `components.css` exclusively (see "Cross-plan sequencing").

**Owns:** `frontend/src/tasks/MyTasks.tsx`, `frontend/tests/myTasks.test.tsx`, components.css region directly after the line `.stat-row dd { ... }` (~line 726).

- [ ] **Step 1: Update and add tests** in `frontend/tests/myTasks.test.tsx`:
  - Replace every `screen.getByRole("combobox", { name: "Project" })` with `screen.getByRole("combobox", { name: "Filter my tasks by project" })`, and the option name `"All projects"` with `"All my tasks"` (test "keeps an empty raw route filter distinct from All projects"; rename its title to "... from All my tasks").
  - Replace `screen.getByLabelText("Task counts")` with `screen.getByRole("list", { name: /^Task counts/ })` and `Paused: n` in the regexes with `of which paused: n`.
  - Append:

```tsx
describe("My tasks filter and counts", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  const counts = () => screen.getByRole("list", { name: /^Task counts/ });

  it("hides filter and counts for a lead without tasks", async () => {
    vi.spyOn(api, "listMyTasks").mockResolvedValue([]);
    render(<MyTasks projects={[project("p", "Project P", true)]} onNavigate={vi.fn()} />);
    await screen.findByText("No documents are assigned to you yet.");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("list", { name: /^Task counts/ })).toBeNull();
  });

  it("hides the filter for tasks in one project until a filter is active", async () => {
    vi.spyOn(api, "listMyTasks").mockResolvedValue([task(1, "open"), task(3, "submitted")]);
    const view = render(<MyTasks projects={[]} onNavigate={vi.fn()} />);
    await screen.findAllByTestId("task-row");
    expect(screen.queryByRole("combobox")).toBeNull();
    view.rerender(<MyTasks project="p" projects={[]} onNavigate={vi.fn()} />);
    const select = screen.getByRole("combobox", { name: "Filter my tasks by project" }) as HTMLSelectElement;
    expect(select.value).toBe("p");
    expect(within(select).getByRole("option", { name: "All my tasks" })).toBeDefined();
  });

  it("shows the filter for tasks in two projects", async () => {
    vi.spyOn(api, "listMyTasks").mockResolvedValue(tasks);
    render(<MyTasks projects={[]} onNavigate={vi.fn()} />);
    await screen.findAllByTestId("task-row");
    const select = screen.getByRole("combobox", { name: "Filter my tasks by project" });
    expect(within(select).getAllByRole("option").map(o => o.textContent)).toEqual(["All my tasks", "Project P (p)", "Project Q (q)"]);
  });

  it("renders four count items without glyph separators that add up", async () => {
    vi.spyOn(api, "listMyTasks").mockResolvedValue([{ ...task(1, "open"), held: true }, task(2, "in_progress"), task(3, "submitted"), task(4, "reopened")]);
    render(<MyTasks projects={[]} onNavigate={vi.fn()} />);
    await screen.findAllByTestId("task-row");
    expect(within(counts()).getAllByRole("listitem").map(item => item.textContent)).toEqual([
      "Open: 2", "In progress: 1", "Submitted: 1", "of which paused: 1",
    ]);
    expect(counts().textContent).not.toContain("·");
    expect(counts().getAttribute("aria-label")).toBe("Task counts");
  });

  it("names the filtered scope in the counts label", async () => {
    vi.spyOn(api, "listMyTasks").mockResolvedValue(tasks);
    render(<MyTasks project="q" projects={[]} onNavigate={vi.fn()} />);
    await screen.findAllByTestId("task-row");
    expect(counts().getAttribute("aria-label")).toBe("Task counts in Project Q (q)");
  });
});
```

(The option order above follows the `Map` insertion order of the fixture `tasks`: `p` first, then `q`. If the existing code orders differently, assert the set instead of the order.)

- [ ] **Step 2: Run** `npm --prefix frontend test -- tests/myTasks.test.tsx --maxWorkers=4 --minWorkers=1` — Expected: FAIL on the new label and list.

- [ ] **Step 3: Implement** in `frontend/src/tasks/MyTasks.tsx`. After the `allProjectsValue` loop (~line 65) add:

```tsx
  const showFilter = new Set(tasks.map(task => task.project_key)).size >= 2 || project !== undefined;
  const count = (predicate: (task: TaskSummary) => boolean) => filtered.filter(predicate).length;
  const countsLabel = project === undefined ? "Task counts" : `Task counts in ${options.get(project) ?? project}`;
```

Replace the `<Select ...>…</Select>` and the `<p role="group" aria-label="Task counts">…</p>` (lines 100-104) with:

```tsx
      {showFilter && <Select id="project-select" label="Filter my tasks by project" value={project ?? allProjectsValue} onChange={event => onNavigate(event.target.value === allProjectsValue ? { name: "tasks" } : { name: "tasks", project: event.target.value })}>
        <option value={allProjectsValue}>All my tasks</option>
        {[...options].map(([key, name]) => <option key={key} value={key}>{name}</option>)}
      </Select>}
      {tasks.length > 0 && <ul className="task-counts" aria-label={countsLabel}>
        <li>Open: {count(task => task.status === "open" || task.status === "reopened")}</li>
        <li>In progress: {count(task => task.status === "in_progress")}</li>
        <li>Submitted: {count(task => task.status === "submitted")}</li>
        <li>of which paused: {count(task => task.held)}</li>
      </ul>}
```

Update the comment above `allProjectsValue` to say "All my tasks".

- [ ] **Step 4: CSS.** In `frontend/src/styles/components.css` insert directly after the `.stat-row dd { ... }` line (the `ul.` prefix outranks `.shell-page ul` padding from `base.css`):

```css

/* My tasks counts: a list whose separators are gaps, not glyphs. */
ul.task-counts { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-4); list-style: none; padding: 0; margin-block: var(--space-3); font-variant-numeric: tabular-nums; }
```

- [ ] **Step 5: Run** `npm --prefix frontend test -- tests/myTasks.test.tsx tests/translationTaskApp.test.tsx tests/adminApp.test.tsx --maxWorkers=4 --minWorkers=1` and `npm --prefix frontend run typecheck` — Expected: PASS.

**Done checklist (WP-C):** label/option renamed; visibility rule; synthetic option for an unknown filter kept; counts list with 4 items and scoped label; hidden without tasks.
**Commit point:** `frontend/src/tasks/MyTasks.tsx frontend/tests/myTasks.test.tsx frontend/src/styles/components.css` — `fix(tasks): clarify the My tasks filter and counts`.

---

## WP-D: Project picker as a link panel with light dismiss (Q3, Q2 header names)

**Goal:** Replace the header `<details>` + navigating `<select>` with a disclosure button and a panel of project links that closes on selection, Escape, outside pointer, focus leaving and route change.

**Spec sections:** Q3 (Decision B, Structure, Behaviour, Acceptance), Q2 third bullet.

**Sequencing:** after Documents U1 and WP-C; before Documents P7 (`admin.spec.ts`); holds `components.css` exclusively.

**Owns:** `frontend/src/app/ProjectPicker.tsx` (create), `frontend/src/app/Shell.tsx`, `frontend/tests/projectPicker.test.tsx` (create), `frontend/tests/shell.test.tsx` (only the test "searches authorized projects and shows sections only for the current project", ~lines 62-72), `frontend/browser/admin.spec.ts` (only `selectProject`, ~lines 111-116), components.css region: the `.shell-project-selector` / `.shell-project-menu` rules (~696-702) and the `.shell-project-selector summary:focus-visible` part of the selector list (~707).

**Read:** `frontend/src/app/router.ts` (`routeHref`, `Route`), `frontend/src/ui/Button.tsx` (forwards `ref`), `frontend/src/ui/icons.tsx` (`IconChevronRight`, `IconCheck`), `frontend/src/ui/shortcuts.ts` (shortcuts listen on `window` keydown in the bubble phase, so `stopPropagation` in a React handler prevents them).

- [ ] **Step 1: Write the failing test** `frontend/tests/projectPicker.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ProjectSummary } from "../src/api/client";
import { ProjectPicker } from "../src/app/ProjectPicker";
import type { Route } from "../src/app/router";

const project = (key: string, name = key, can_manage = true): ProjectSummary => ({
  project_key: key, name, description: null, roles: [], allowed_modes: [], document_count: 0, can_manage,
});
const projects = [project("first", "First study"), project("reader", "reader", false)];
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const setup = (extra: Partial<Parameters<typeof ProjectPicker>[0]> = {}) => {
  const props = { projects, current: projects[0], route: { name: "projectDocuments", key: "first" } as Route, onNavigate: vi.fn(), onChoose: vi.fn(), ...extra };
  const view = render(<><ProjectPicker {...props} /><button>Outside</button></>);
  const trigger = screen.getByRole("button", { name: "Current project: First study" });
  const panel = view.container.querySelector<HTMLElement>("#shell-project-panel")!;
  return { props, view, trigger, panel };
};

it("is a closed disclosure with the visible project name", () => {
  const { trigger, panel } = setup();
  expect(trigger.textContent).toContain("Project: First study");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(trigger.getAttribute("aria-controls")).toBe("shell-project-panel");
  expect(panel.hidden).toBe(true);
});

it("reads Choose project without a current project", () => {
  render(<ProjectPicker projects={projects} route={{ name: "tasks" }} onNavigate={vi.fn()} onChoose={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Choose project" }).textContent).toContain("Choose project");
});

it("lists projects as links with destinations, keys and a visible current marker", () => {
  const { trigger, panel } = setup();
  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(panel.hidden).toBe(false);
  const list = within(panel).getByRole("list", { name: "Projects" });
  const [first, reader] = within(list).getAllByRole("link");
  expect(first.getAttribute("href")).toBe("#/projects/first/documents");
  expect(first.getAttribute("aria-current")).toBe("true");
  expect(first.textContent).toContain("first · opens Documents");
  expect(first.textContent).toContain("Current");
  expect(reader.getAttribute("href")).toBe("#/tasks?project=reader");
  expect(reader.textContent).toContain("opens My tasks");
  expect(reader.textContent).not.toContain("reader · ");
  expect(reader.hasAttribute("aria-current")).toBe(false);
  expect(within(panel).queryByRole("searchbox")).toBeNull();
});

it("navigates on a plain click, closes and returns focus to the trigger", () => {
  const { props, trigger, panel } = setup();
  fireEvent.click(trigger);
  fireEvent.click(within(panel).getAllByRole("link")[1]);
  expect(props.onChoose).toHaveBeenCalledWith("reader");
  expect(props.onNavigate).toHaveBeenCalledWith({ name: "tasks", project: "reader" });
  expect(panel.hidden).toBe(true);
  expect(document.activeElement).toBe(trigger);
});

it("keeps browser behaviour and the panel for modified clicks", () => {
  const { props, trigger, panel } = setup();
  fireEvent.click(trigger);
  fireEvent.click(within(panel).getAllByRole("link")[1], { ctrlKey: true });
  expect(props.onNavigate).not.toHaveBeenCalled();
  expect(panel.hidden).toBe(false);
});

it("never navigates on arrow keys", () => {
  const { props, trigger, panel } = setup();
  fireEvent.click(trigger);
  const link = within(panel).getAllByRole("link")[1];
  link.focus();
  fireEvent.keyDown(link, { key: "ArrowDown" });
  fireEvent.keyDown(link, { key: "ArrowUp" });
  expect(props.onNavigate).not.toHaveBeenCalled();
});

it("closes on Escape, refocuses the trigger and stops the key from reaching window shortcuts", () => {
  const shortcut = vi.fn();
  window.addEventListener("keydown", shortcut);
  try {
    const { trigger, panel } = setup();
    fireEvent.click(trigger);
    const link = within(panel).getAllByRole("link")[0];
    link.focus();
    fireEvent.keyDown(link, { key: "Escape" });
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(shortcut).not.toHaveBeenCalled();
  } finally { window.removeEventListener("keydown", shortcut); }
});

it("closes on outside pointer down without moving focus", () => {
  const { trigger, panel } = setup();
  fireEvent.click(trigger);
  trigger.focus();
  fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
  expect(panel.hidden).toBe(true);
  expect(document.activeElement).toBe(trigger);
});

it("closes when focus leaves the picker", () => {
  const { trigger, panel } = setup();
  fireEvent.click(trigger);
  const link = within(panel).getAllByRole("link")[1];
  fireEvent.blur(link, { relatedTarget: screen.getByRole("button", { name: "Outside" }) });
  expect(panel.hidden).toBe(true);
});

it("closes on route change", () => {
  const { props, view, trigger, panel } = setup();
  fireEvent.click(trigger);
  view.rerender(<><ProjectPicker {...props} route={{ name: "projectSettings", key: "first" }} /><button>Outside</button></>);
  expect(panel.hidden).toBe(true);
});

it("shows and focuses a search field only above six projects", () => {
  const many = Array.from({ length: 7 }, (_, n) => project(`p${n}`, `Study ${n}`));
  const view = render(<ProjectPicker projects={many} route={{ name: "tasks" }} onNavigate={vi.fn()} onChoose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Choose project" }));
  const search = screen.getByRole("searchbox", { name: "Find project" });
  expect(document.activeElement).toBe(search);
  fireEvent.change(search, { target: { value: "study 3" } });
  expect(within(view.container.querySelector("#shell-project-panel")!).getAllByRole("link")).toHaveLength(1);
  fireEvent.change(search, { target: { value: "zzz" } });
  expect(screen.getByRole("status").textContent).toBe("No matching projects.");
});
```

If `routeHref({ name: "tasks", project: "reader" })` produces a different string, assert against `routeHref(...)` imported from the router instead of the literal.

- [ ] **Step 2: Run** `npm --prefix frontend test -- tests/projectPicker.test.tsx --maxWorkers=4 --minWorkers=1` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `frontend/src/app/ProjectPicker.tsx`:

```tsx
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from "react";
import type { ProjectSummary } from "../api/client";
import { Button, IconCheck, IconChevronRight, TextInput } from "../ui";
import { routeHref, type Route } from "./router";

/** The search field only appears when the list is too long to scan. */
export const PROJECT_SEARCH_THRESHOLD = 6;

export function projectDestination(project: ProjectSummary): Route {
  return project.can_manage
    ? { name: "projectDocuments", key: project.project_key }
    : { name: "tasks", project: project.project_key };
}

export interface ProjectPickerProps {
  projects: ProjectSummary[];
  current?: ProjectSummary;
  route: Route;
  onNavigate: (route: Route) => void;
  onChoose: (projectKey: string) => void;
}

/** Disclosure (not a menu): a button and a panel of real project links. */
export function ProjectPicker({ projects, current, route, onNavigate, onChoose }: ProjectPickerProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const showSearch = projects.length > PROJECT_SEARCH_THRESHOLD;
  const query = search.toLocaleLowerCase();
  const matches = projects.filter(item => `${item.name} ${item.project_key}`.toLocaleLowerCase().includes(query));
  const dismiss = () => { setOpen(false); setSearch(""); };
  const close = () => { dismiss(); trigger.current?.focus(); };
  const routeKey = JSON.stringify(route);
  useEffect(dismiss, [routeKey]);
  useEffect(() => {
    if (!open) return;
    if (showSearch) searchField.current?.focus();
    const outside = (event: PointerEvent) => {
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) dismiss();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, showSearch]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (open && next && !event.currentTarget.contains(next)) dismiss();
  };
  const choose = (event: MouseEvent<HTMLAnchorElement>, item: ProjectSummary) => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onChoose(item.project_key);
    onNavigate(projectDestination(item));
    close();
  };
  return <div ref={wrapper} className="shell-project-selector" onKeyDown={onKeyDown} onBlur={onBlur}>
    <Button ref={trigger} variant="quiet" size="sm" className="shell-project-trigger"
      aria-expanded={open} aria-controls="shell-project-panel"
      aria-label={current ? `Current project: ${current.name}` : "Choose project"}
      onClick={() => { if (open) dismiss(); else setOpen(true); }}>
      {current ? `Project: ${current.name}` : "Choose project"}
      <span className="shell-project-chevron" aria-hidden="true"><IconChevronRight /></span>
    </Button>
    <div id="shell-project-panel" className="shell-project-menu" hidden={!open}>
      {showSearch && <TextInput ref={searchField} id="shell-project-search" type="search" label="Find project" value={search} onChange={event => setSearch(event.target.value)} />}
      <ul className="shell-project-list" aria-label="Projects">
        {matches.map(item => {
          const isCurrent = item.project_key === current?.project_key;
          const opens = item.can_manage ? "opens Documents" : "opens My tasks";
          return <li key={item.project_key}>
            <a className="shell-project-link" href={routeHref(projectDestination(item))} aria-current={isCurrent ? "true" : undefined} onClick={event => choose(event, item)}>
              <span className="shell-project-name">{item.name}</span>
              <span className="shell-project-meta">{item.name === item.project_key ? opens : `${item.project_key} · ${opens}`}</span>
              {isCurrent && <span className="shell-project-current"><span aria-hidden="true"><IconCheck /></span> Current</span>}
            </a>
          </li>;
        })}
      </ul>
      {!matches.length && <p role="status">No matching projects.</p>}
    </div>
  </div>;
}
```

- [ ] **Step 4: Use it in `Shell.tsx`.** Remove the `search` state, the `matches` line and the whole `<details className="shell-project-selector">…</details>` block (lines 36, 40-61); change the `../ui` import to nothing (delete it if unused) and add `import { ProjectPicker } from "./ProjectPicker";`. New `selector`:

```tsx
  const selector = projects.length > 0 && <ProjectPicker projects={projects} current={current} route={route}
    onNavigate={onNavigate} onChoose={key => setChoice({ username: user.username, key })} />;
```

`Shell` stays mounted across routes, so the picker's `route` effect closes it on every route change.

- [ ] **Step 5: Update `frontend/tests/shell.test.tsx`** test "searches authorized projects and shows sections only for the current project": delete the `Project key: first` assertion and replace the search/select lines with:

```tsx
    fireEvent.click(screen.getByRole("button", { name: /^Current project: / }));
    const panel = document.querySelector<HTMLElement>("#shell-project-panel")!;
    const target = routeHref({ name: "projectDocuments", key: "second / α" });
    // Every fixture project is named "Research", so the link is found by its destination, not its name.
    const link = within(panel).getAllByRole("link").find(item => item.getAttribute("href") === target);
    expect(link, `link to ${target}`).toBeDefined();
    fireEvent.click(link!);
    expect(state.onNavigate).toHaveBeenCalledWith({ name: "projectDocuments", key: "second / α" });
```

Add `import { routeHref } from "../src/app/router";` (`within` is already imported). Rename the test to "lists authorized projects and shows sections only for the current project".

- [ ] **Step 6: CSS.** In `frontend/src/styles/components.css` replace the block from `.shell-project-selector { position: relative; ...` through `.shell-project-menu p { ... }` (~696-702) with:

```css
.shell-project-selector { position: relative; min-width: 0; font-size: var(--size-md); }
.shell-project-trigger { max-width: 32ch; overflow-wrap: anywhere; text-align: start; }
.shell-project-chevron { display: inline-flex; margin-inline-start: var(--space-1); transition: transform 150ms ease; }
.shell-project-trigger[aria-expanded="true"] .shell-project-chevron { transform: rotate(90deg); }
.shell-project-menu { position: absolute; inset-inline-end: 0; top: calc(100% + var(--space-1)); z-index: 110;
  width: min(23rem, calc(100vw - 2 * var(--space-4))); max-height: 65dvh; overflow: auto;
  padding: var(--space-3); background: var(--surface-raised); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); }
.shell-project-menu[hidden] { display: none; }
.shell-project-menu .form-control { width: 100%; }
.shell-project-menu p { margin: var(--space-2) 0 0; overflow-wrap: anywhere; }
ul.shell-project-list { list-style: none; padding: 0; margin: 0; }
.shell-project-link { display: grid; gap: 0 var(--space-2); grid-template-columns: 1fr auto; padding: var(--space-2); border-radius: var(--radius-sm); color: var(--text); text-decoration: none; overflow-wrap: anywhere; }
.shell-project-link:hover { background: var(--surface-sunken); }
.shell-project-link:focus-visible { outline: var(--focus-width) solid var(--focus-ring); outline-offset: calc(-1 * var(--focus-width)); }
.shell-project-link[aria-current="true"] { background: var(--accent-light); }
.shell-project-name { grid-column: 1; font-weight: var(--weight-strong); }
.shell-project-meta { grid-column: 1; color: var(--text-muted); font-size: var(--size-sm); }
.shell-project-current { grid-column: 2; grid-row: 1 / span 2; align-self: center; display: inline-flex; align-items: center; gap: var(--space-1); font-size: var(--size-sm); }
@media (prefers-reduced-motion: reduce) { .shell-project-chevron { transition: none; } }
```

In the selector list on ~line 707 remove `, .shell-project-selector summary:focus-visible` (keep `.document-tree summary:focus-visible`). Keep the two `@media (max-width: 699px)` lines that mention `.shell-project-selector` and `.shell-project-menu`. Use only tokens that exist in `frontend/src/styles/tokens.css`; if `--surface-sunken` or `--radius-sm` is missing, use the nearest existing token.

- [ ] **Step 7: Update `frontend/browser/admin.spec.ts`** `selectProject`:

```ts
async function selectProject(page: Page, key: string) {
  await page.locator(".shell-project-trigger").click();
  await page.locator(`#shell-project-panel a[href="#/projects/${encodeURIComponent(key)}/documents"]`).click();
  await expect(page).toHaveURL(new RegExp(`#/projects/${key}/documents$`));
  await expect(page.locator("#shell-project-panel")).toBeHidden();
}
```

(Run in WP-H.)

- [ ] **Step 8: Run** `npm --prefix frontend test -- tests/projectPicker.test.tsx tests/shell.test.tsx tests/adminApp.test.tsx tests/accountNavigation.test.tsx --maxWorkers=4 --minWorkers=1` and `npm --prefix frontend run typecheck` — Expected: PASS. Then `grep -rnE 'Current project"|shell-current-project|summary.*shell-project' frontend/src frontend/tests frontend/browser` — Expected: no output.

**Done checklist (WP-D):** link panel with `aria-current` and visible "Current"; closes on select, Escape (focus to trigger, no window shortcut), outside pointer, focus out, route change; modified clicks untouched; search only above 6 projects; header names per Q2.
**Commit point:** `frontend/src/app/ProjectPicker.tsx frontend/src/app/Shell.tsx frontend/tests/projectPicker.test.tsx frontend/tests/shell.test.tsx frontend/browser/admin.spec.ts frontend/src/styles/components.css` — `fix(shell): project picker as a link panel with light dismiss`.

---

## WP-E: Export preflight with Cancel and one primary per state (Q4, Q5 copy)

**Goal:** Idle "Prepare final export"; preflight region with summary, warnings, acknowledgement, hint, Toolbar "Create final export" (primary) + "Cancel" (quiet); no "Return to results"; info message after an invalidation; archive copy line.

**Spec sections:** Q4 (all), Q5 "Copy change", Decision 5 above.

**Owns:** `frontend/src/admin/FinalExportPanel.tsx`, `frontend/src/admin/ProjectDashboardPage.tsx` (only the `<ul>` in `WorkflowWarnings`), `frontend/tests/finalSelection.test.tsx`, `frontend/browser/final-workflow.spec.ts` (only ~lines 109-112), components.css region directly after `.historical-note { ... }` (~line 721).

**Prerequisite: Documents U1** (`Button` busy state: `loading` sets `aria-disabled`/`aria-busy`, swallows activation, never sets native `disabled`, so the focused Create button keeps focus). Check (Bash): `grep -n 'aria-disabled={loading' frontend/src/ui/Button.tsx` must print a line; if not, stop and report "blocked on Documents U1". Do not implement a local busy variant. Sequencing: after WP-D (shared `components.css`), before Documents E1, E3, P7, problem-reports WP9 and editor F10.

**Read:** `frontend/src/admin/useJob.ts`, `frontend/src/ui/Toolbar.tsx`, `frontend/src/ui/Checkbox.tsx` (forwards `ref`), `frontend/src/ui/Button.tsx` (U1 contract).

- [ ] **Step 1: Update and add tests** in `frontend/tests/finalSelection.test.tsx`:
  - Replace all `{ name: "Review final export" }` with `{ name: "Prepare final export" }`.
  - First test: replace the `.disabled` assertion with `expect(screen.getByRole("button", { name: "Create final export" }).getAttribute("aria-disabled")).toBe("true");`.
  - Third test ("blocks empty exports…"): rename to "blocks empty exports and offers Cancel instead of a link back"; replace the `.disabled` assertion as above, then click Create and keep `expect(start).not.toHaveBeenCalled()`; replace the "Return to results" assertion with `expect(screen.queryByRole("link", { name: "Return to results" })).toBeNull(); expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();`.
  - Append:

```tsx
const primaries = () => document.querySelectorAll('section[aria-label="Selected final results"] .btn-primary');
const job = (status: string) => ({ id: 8, kind: "final_t1_export", status, result: null, error: null, created_at: "2026-10-18T12:00:00Z", finished_at: null });

it("has exactly one primary action in every state", async () => {
  vi.spyOn(api, "finalExportPreflight").mockResolvedValue(preflight);
  vi.spyOn(api, "startFinalExport").mockResolvedValue({ job_id: 8 });
  const getJob = vi.spyOn(api, "getJob").mockResolvedValue(job("queued") as never);
  render(<FinalExportPanel projectKey="p" username="lead" />);
  expect([...primaries()].map(b => b.textContent)).toEqual(["Prepare final export"]);
  fireEvent.click(screen.getByRole("button", { name: "Prepare final export" }));
  await screen.findByText("Wording under review");
  expect([...primaries()].map(b => b.textContent)).toEqual(["Create final export"]);
  fireEvent.click(screen.getByLabelText("Export these selected results with the listed warnings and omissions"));
  fireEvent.click(screen.getByRole("button", { name: "Create final export" }));
  await screen.findByText("Final export 8: queued");
  expect([...primaries()].map(b => b.textContent)).toEqual(["Download final export"]);
  expect(screen.getByRole("button", { name: "Download final export" }).getAttribute("aria-disabled")).toBe("true");
  getJob.mockResolvedValue(job("succeeded") as never);
  await screen.findByText("Final export 8: succeeded", undefined, { timeout: 5000 });
  expect([...primaries()].map(b => b.textContent)).toEqual(["Download final export"]);
  fireEvent.click(screen.getByRole("button", { name: "Prepare a new export" }));
  expect([...primaries()].map(b => b.textContent)).toEqual(["Prepare final export"]);
  expect(document.activeElement?.textContent).toBe("Prepare final export");
});

it("opens the preflight with a summary and focuses its heading", async () => {
  vi.spyOn(api, "finalExportPreflight").mockResolvedValue({ ...preflight, omissions: [{ case_id: "other", language: "de" }] });
  render(<FinalExportPanel projectKey="p" username="lead" />);
  expect(screen.getByText("The archive includes README.txt and index.csv, a plain-language guide and a table of every result.")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Prepare final export" }));
  const heading = await screen.findByRole("heading", { name: "Export preflight" });
  expect(document.activeElement).toBe(heading);
  expect(screen.getByRole("region", { name: "Export preflight" })).toBeDefined();
  expect(screen.getByText("1 selected results · 1 warnings · 1 omitted")).toBeDefined();
  expect(screen.getByRole("group", { name: "Final export actions" })).toBeDefined();
});

it("explains unacknowledged warnings and moves focus to the checkbox instead of starting", async () => {
  vi.spyOn(api, "finalExportPreflight").mockResolvedValue(preflight);
  const start = vi.spyOn(api, "startFinalExport");
  render(<FinalExportPanel projectKey="p" username="lead" />);
  fireEvent.click(screen.getByRole("button", { name: "Prepare final export" }));
  const create = await screen.findByRole("button", { name: "Create final export" });
  const hint = screen.getByText("Confirm the warnings and omissions above to continue.");
  expect(create.getAttribute("aria-describedby")).toBe(hint.id);
  create.focus();
  fireEvent.click(create);
  expect(start).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByLabelText("Export these selected results with the listed warnings and omissions"));
});

it("cancels back to idle without a request, clears the acknowledgement and focuses Prepare", async () => {
  const read = vi.spyOn(api, "finalExportPreflight").mockResolvedValue(preflight);
  const start = vi.spyOn(api, "startFinalExport");
  render(<FinalExportPanel projectKey="p" username="lead" />);
  fireEvent.click(screen.getByRole("button", { name: "Prepare final export" }));
  fireEvent.click(await screen.findByLabelText("Export these selected results with the listed warnings and omissions"));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("region", { name: "Export preflight" })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Prepare final export" }));
  expect(read).toHaveBeenCalledTimes(1);
  expect(start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Prepare final export" }));
  expect((await screen.findByLabelText("Export these selected results with the listed warnings and omissions") as HTMLInputElement).checked).toBe(false);
});

it("keeps focus on Create while the export is being created", async () => {
  vi.spyOn(api, "finalExportPreflight").mockResolvedValue({ ...preflight, warnings: [] });
  const start = vi.spyOn(api, "startFinalExport").mockReturnValue(new Promise(() => undefined));
  render(<FinalExportPanel projectKey="p" username="lead" />);
  fireEvent.click(screen.getByRole("button", { name: "Prepare final export" }));
  const create = await screen.findByRole("button", { name: "Create final export" });
  create.focus();
  fireEvent.click(create);
  await waitFor(() => expect(create.getAttribute("aria-busy")).toBe("true"));
  expect(start).toHaveBeenCalledTimes(1);
  expect(create.getAttribute("aria-disabled")).toBe("true");
  expect(create.hasAttribute("disabled")).toBe(false);
  expect(document.activeElement).toBe(create);
  fireEvent.click(create);
  expect(start).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("region", { name: "Export preflight" })).toBeDefined();
});

it("says so when final selections change while the preflight is open", async () => {
  vi.spyOn(api, "finalExportPreflight").mockResolvedValue(preflight);
  render(<FinalExportPanel projectKey="p" username="lead" />);
  fireEvent.click(screen.getByRole("button", { name: "Prepare final export" }));
  await screen.findByRole("heading", { name: "Export preflight" });
  act(() => { window.dispatchEvent(new CustomEvent("ontocurator:final-selection-changed", { detail: { projectKey: "p" } })); });
  expect(screen.getByText("Final selections changed. Prepare the export again.")).toBeDefined();
  expect(screen.queryByRole("region", { name: "Export preflight" })).toBeNull();
});
```

If `useJob` polls on a timer longer than the `findByText` timeout, use `vi.useFakeTimers({ shouldAdvanceTime: true })` in that test and advance with `await act(() => vi.advanceTimersByTimeAsync(<interval>))`; read the interval from `useJob.ts`.

- [ ] **Step 2: Run** `npm --prefix frontend test -- tests/finalSelection.test.tsx --maxWorkers=4 --minWorkers=1` — Expected: FAIL.

- [ ] **Step 3: Implement.** Replace `FinalExportContent` in `frontend/src/admin/FinalExportPanel.tsx` (keep `FinalExportPanel` and the imports, adding `Toolbar` to the `../ui` import):

```tsx
function FinalExportContent({ projectKey }: { projectKey: string }): JSX.Element {
  const [state, setState] = useState<FinalPreflight>();
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [jobId, setJobId] = useState<number | null>(null);
  const [changed, setChanged] = useState(false);
  const requestId = useRef("");
  const alive = useRef(false);
  const pending = useRef(false);
  const generation = useRef(0);
  const preflightOpen = useRef(false);
  const focusPrepare = useRef(false);
  const prepareButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const acknowledgement = useRef<HTMLInputElement>(null);
  const { job, error: jobError } = useJob(jobId);
  preflightOpen.current = state !== undefined;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const invalidate = (event: Event) => {
      if ((event as CustomEvent<{ projectKey: string }>).detail.projectKey !== projectKey) return;
      if (preflightOpen.current || pending.current) setChanged(true);
      generation.current += 1;
      setState(undefined); setAccepted(false);
    };
    window.addEventListener("ontocurator:final-selection-changed", invalidate);
    return () => window.removeEventListener("ontocurator:final-selection-changed", invalidate);
  }, [projectKey]);
  useEffect(() => { if (state) heading.current?.focus(); }, [state]);
  useEffect(() => {
    if (focusPrepare.current && prepareButton.current) { focusPrepare.current = false; prepareButton.current.focus(); }
  });
  const review = async () => {
    if (pending.current) return;
    pending.current = true;
    const current = ++generation.current;
    setBusy(true); setAccepted(false); setError(undefined); setState(undefined); setChanged(false);
    try { const next = await api.finalExportPreflight(projectKey); if (alive.current && current === generation.current) { setState(next); requestId.current = crypto.randomUUID(); } }
    catch (err) { if (alive.current) setError(err); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const start = async () => {
    if (!state || pending.current || !state.selections.length) return;
    if (state.warnings.length > 0 && !accepted) { acknowledgement.current?.focus(); return; }
    pending.current = true;
    setBusy(true); setError(undefined);
    try {
      const result = await api.startFinalExport(projectKey, { request_id: requestId.current, state_digest: state.state_digest, acknowledged_warnings: state.warnings.map(({ id, cause_revision }) => ({ id, cause_revision })), accepted_omissions: state.omissions });
      if (alive.current) { setJobId(result.job_id); setState(undefined); setAccepted(false); }
    } catch (err) { if (alive.current) { setError(err); setState(undefined); setAccepted(false); focusPrepare.current = true; } }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const creating = busy && state !== undefined;
  const cancel = () => {
    if (creating) return;
    generation.current += 1;
    setState(undefined); setAccepted(false); setError(undefined); setChanged(false);
    focusPrepare.current = true;
  };
  const download = async () => {
    if (!jobId || pending.current || job?.kind !== "final_t1_export" || job.status !== "succeeded") return;
    pending.current = true;
    setBusy(true); setError(undefined);
    try { const file = await api.downloadJob(jobId); if (alive.current) saveDownload(file, `${projectKey}-final.zip`); }
    catch (err) { if (alive.current) setError(err); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const newExport = () => { setJobId(null); setError(undefined); focusPrepare.current = true; };
  const failed = job?.status === "failed";
  const succeeded = job?.kind === "final_t1_export" && job.status === "succeeded";
  const phase = state ? "preflight" : jobId !== null && !failed && jobError == null ? "job" : "idle";
  const blockedBy = !state ? undefined
    : !state.selections.length ? "final-export-empty"
    : state.warnings.length > 0 && !accepted ? "final-export-ack-hint" : undefined;
  return <section className="detail-section" aria-label="Selected final results"><h2>Selected final results</h2>
    <p>Export the exact results selected by the lead, with an audit receipt. Missing selections are disclosed; another submission is never substituted.</p>
    <p>The archive includes README.txt and index.csv, a plain-language guide and a table of every result.</p>
    {changed && <InlineMessage tone="info">Final selections changed. Prepare the export again.</InlineMessage>}
    {phase === "idle" && <Button ref={prepareButton} variant="primary" loading={busy} onClick={() => { void review(); }}>Prepare final export</Button>}
    {error != null && <><ErrorNotice error={error} /><p>Prepare the final export again to confirm the current selections and warnings.</p></>}
    {state && <section className="final-export-preflight" aria-labelledby="final-export-preflight-heading">
      <h3 id="final-export-preflight-heading" ref={heading} tabIndex={-1}>Export preflight</h3>
      <p>{state.selections.length} selected results · {state.warnings.length} warnings · {state.omissions.length} omitted</p>
      <WorkflowWarnings state={state} />
      {state.warnings.length > 0 && <Checkbox ref={acknowledgement} id="final-export-ack" label="Export these selected results with the listed warnings and omissions" checked={accepted} disabled={creating} onChange={event => setAccepted(event.target.checked)} />}
      {!state.selections.length && <InlineMessage tone="warning"><span id="final-export-empty">Select at least one submitted result before exporting.</span></InlineMessage>}
      {blockedBy === "final-export-ack-hint" && <p id="final-export-ack-hint" className="field-hint">Confirm the warnings and omissions above to continue.</p>}
      {creating && <p id="final-export-cancel-hint" className="field-hint">The export is being created.</p>}
      <Toolbar label="Final export actions">
        <Button variant="primary" loading={creating} aria-disabled={blockedBy ? "true" : undefined} aria-describedby={blockedBy} onClick={() => { void start(); }}>Create final export</Button>
        <Button variant="quiet" aria-disabled={creating ? "true" : undefined} aria-describedby={creating ? "final-export-cancel-hint" : undefined} onClick={cancel}>Cancel</Button>
      </Toolbar>
    </section>}
    {jobError != null && <ErrorNotice error={jobError} />}
    {job && <p role="status">Final export {job.id}: {job.status}</p>}
    {failed && <InlineMessage tone="error"><p>Final export could not be created.</p><details><summary>Technical diagnostics</summary><pre>{job.error}</pre></details></InlineMessage>}
    {phase === "job" && (succeeded
      ? <Toolbar label="Final export download">
          <Button variant="primary" loading={busy} onClick={() => { void download(); }}>Download final export</Button>
          <Button onClick={newExport}>Prepare a new export</Button>
        </Toolbar>
      : <>
          <p id="final-export-download-hint" className="field-hint">The download is available when the export has finished.</p>
          <Button variant="primary" aria-disabled="true" aria-describedby="final-export-download-hint">Download final export</Button>
        </>)}
  </section>;
}
```

Check that `InlineMessage` accepts element children (it does for the existing `<p>` usage). If `.field-hint` is not a suitable visible style, use `className="cell-secondary"` (both exist in components.css).

- [ ] **Step 4: Warning list class.** In `frontend/src/admin/ProjectDashboardPage.tsx` change `<><ul>{state.warnings.map(` to `<><ul className="final-warning-list">{state.warnings.map(`. (If Documents E1 (Tasks 6.1/6.2) has already moved `WorkflowWarnings` into `FinalExportPanel.tsx` and deleted `ProjectDashboardPage.tsx`, apply the class to the `<ul>` of the local copy instead.)

- [ ] **Step 5: CSS.** In `frontend/src/styles/components.css` insert directly after the `.historical-note { ... }` line:

```css

/* Export preflight: each warning's link sits closer to its own reason than to the next item. */
.final-warning-list > li { padding-block: var(--space-2); border-block-end: 1px solid var(--border); }
.final-warning-list > li > p { margin: 0 0 var(--space-1); }
```

- [ ] **Step 6: Browser spec lines.** In `frontend/browser/final-workflow.spec.ts` (~109-112) change `{ name: 'Review final export', exact: true }` to `{ name: 'Prepare final export', exact: true }` and `await expect(create).toBeDisabled();` to `await expect(create).toHaveAttribute('aria-disabled', 'true');`. (Run in WP-H.)

- [ ] **Step 7: Run** `npm --prefix frontend test -- tests/finalSelection.test.tsx tests/exportPage.test.tsx tests/projectDashboard.test.tsx --maxWorkers=4 --minWorkers=1` and `npm --prefix frontend run typecheck` — Expected: PASS. `grep -rnE 'Review final export"|Return to results' frontend/src frontend/tests frontend/browser` — Expected: only the `ProjectDashboardPage` link "Review final export" (a link to the Export page, unchanged) and its test while that file exists; no output once Documents E1 has deleted it. (If Documents E1 already landed, also drop `tests/projectDashboard.test.tsx` from the Vitest command above.)

**Done checklist (WP-E):** one primary per state; Create keeps focus while creating (U1 busy state); Cancel resets and focuses Prepare; unacknowledged Create is `aria-disabled`, described by the visible hint, focuses the checkbox; heading focus on open; summary line; info message on invalidation; archive copy; warning spacing class.
**Commit point:** `frontend/src/admin/FinalExportPanel.tsx frontend/src/admin/ProjectDashboardPage.tsx frontend/tests/finalSelection.test.tsx frontend/browser/final-workflow.spec.ts frontend/src/styles/components.css` — `fix(export): preflight with Cancel and one primary action per state`.

---

## WP-F: Resize-handle focus ring and carried-panel list markers (Q7, Q8)

**Goal:** A visible ≥3:1 focus ring on the mention resize handle; list markers inside the carried panel and Work rounds list; the dead `accent-light` form-focus rule removed.

**Spec sections:** Q7, Q8.

**Owns:** `frontend/src/styles/screens/editor.css`, `frontend/tests/tokens.test.ts` (one assertion), `frontend/tests/quickFixStyles.test.ts` (create), components.css lines ~129-132 only (the first `.form-control:focus, .form-select:focus` rule with `--accent-light`).

**Sequencing:** run before editor F4a (which then finds Q7 done) and never alongside Documents U1, editor F1, editor F4a or another `components.css` writer of this plan.

**Step 0: Obsolescence check** (Bash, worktree root). Q8 is applied per selector; drop the CSS rule and the matching `it` for a selector whose component is gone:
- `.round-input-panel ol`: only if `test -f frontend/src/tasks/RoundInputPanel.tsx` succeeds (editor F6 deletes the panel).
- `.work-round-actions ol`: only if `grep -c '<ol' frontend/src/tasks/WorkRoundActions.tsx` prints more than 0 (editor F8a replaces the list by a table).
- Q7: if `editor.css` already has Q7's exact rule (editor F4a applied it), skip the Q7 CSS edit and keep the tests.
Handover: after editor F6b and F8a remove the components, editor F4b deletes the matching selector rules and the matching `it` blocks in `quickFixStyles.test.ts` (named after the selector).

- [ ] **Step 1: Write the failing tests.** In `frontend/tests/tokens.test.ts`, inside `it("non_text_contrast", ...)`, add:

```ts
    // The resize-handle focus ring sits on the sheet and next to every mark fill (Q7).
    expect(below(cross(["--focus-ring"], ["--surface-raised", ...FILLS]), contrast, 3)).toEqual([]);
```

Create `frontend/tests/quickFixStyles.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const editor = read("../src/styles/screens/editor.css");
const components = read("../src/styles/components.css");

describe("quick-fix styles", () => {
  it("draws a sheet-coloured gap and a focus-ring ring around a focused resize handle", () => {
    expect(editor).toMatch(/\.resize-handle:focus-visible::before\s*\{\s*box-shadow:\s*0 0 0 2px var\(--surface-raised\),\s*0 0 0 4px var\(--focus-ring\);\s*\}/);
    expect(editor).not.toMatch(/\.resize-handle:focus-visible::before\s*\{[^}]*--accent-light/);
  });
  // Q8: one `it` per selector; editor F4b deletes them together with the rules once F6b / F8a removed the components.
  it(".round-input-panel ol keeps its markers inside the panel", () => {
    expect(editor).toMatch(/\.round-input-panel ol\s*\{\s*padding-inline-start:\s*var\(--space-5\);\s*\}/);
  });
  it(".work-round-actions ol keeps its markers inside the dialog", () => {
    expect(editor).toMatch(/\.work-round-actions ol\s*\{\s*padding-inline-start:\s*var\(--space-5\);\s*\}/);
  });
  it("keeps no accent-light form focus rule", () => {
    expect(components).not.toMatch(/\.form-select:focus\s*\{[^}]*--accent-light/);
  });
});
```

- [ ] **Step 2: Run** `npm --prefix frontend test -- tests/quickFixStyles.test.ts tests/tokens.test.ts --maxWorkers=4 --minWorkers=1` — Expected: `quickFixStyles` FAIL; `tokens` PASS (the pair already meets 3:1; it now guards it).

- [ ] **Step 3: Implement.**
  - `editor.css` ~632-634: replace `box-shadow: 0 0 0 3px var(--accent-light);` inside `.resize-handle:focus-visible::before` with `box-shadow: 0 0 0 2px var(--surface-raised), 0 0 0 4px var(--focus-ring);` (box-shadow does not change layout).
  - `editor.css`, directly before `.round-input-panel li,` (~line 233), insert:

    ```css
    .round-input-panel ol { padding-inline-start: var(--space-5); }
    .work-round-actions ol { padding-inline-start: var(--space-5); }

    ```

    Two separate rules on purpose, so each can be removed with its component (see Step 0).
  - `components.css` ~129-132: delete the rule `.form-control:focus,\n.form-select:focus {\n  border-color: var(--accent);\n  box-shadow: 0 0 0 2px var(--accent-light);\n}` (the later rule at ~429-432 with `--focus-ring` stays and is the effective one).

- [ ] **Step 4: Run** `npm --prefix frontend test -- tests/quickFixStyles.test.ts tests/tokens.test.ts tests/caseResize.test.tsx --maxWorkers=4 --minWorkers=1` — Expected: PASS. Screenshot and geometry checks run in WP-H.

**Done checklist (WP-F):** ring rule; list padding for each list whose component still exists (others reported obsolete); dead rule gone; token pair guarded.
**Commit point:** `frontend/src/styles/screens/editor.css frontend/src/styles/components.css frontend/tests/tokens.test.ts frontend/tests/quickFixStyles.test.ts` — `fix(editor): visible resize-handle focus ring and contained list markers`.

---

## WP-G: One time zone in `FinalResultSelector` (Q6) — conditional

**Skip if Documents E3 (Task 6.4, selector removal) landed first**: run (Bash) `test -f frontend/src/variants/FinalResultSelector.tsx && echo present || echo gone`; if it prints `gone`, mark WP-G "obsolete (replaced by Documents E3)" and stop. Never run WP-G while Documents E3 runs.

**Spec section:** Q6.

**Owns:** `frontend/src/variants/FinalResultSelector.tsx`, `frontend/tests/finalResultSelector.test.tsx`.

- [ ] **Step 1: Failing test** (append to `frontend/tests/finalResultSelector.test.tsx`; add `import { formatDateTime } from '../src/app/labels';`):

```tsx
it('labels options with the same local time string as the submission history', async () => {
  vi.spyOn(api, 'getWorkflowWarnings').mockResolvedValue(projection());
  render(<FinalResultSelector {...props} />);
  const select = await screen.findByLabelText('Submitted result') as HTMLSelectElement;
  const labels = [...select.options].slice(1).map(option => option.textContent);
  expect(labels).toEqual(expect.arrayContaining(rows.map(row => `${row.author_label} · ${formatDateTime(row.created_at)} · ${row.submission_id}`)));
  expect(labels.join(' ')).not.toMatch(/T\d\d:\d\d:\d\dZ/);
});
```

- [ ] **Step 2: Run** `npm --prefix frontend test -- tests/finalResultSelector.test.tsx --maxWorkers=4 --minWorkers=1` — Expected: FAIL (raw ISO in labels).
- [ ] **Step 3: Implement:** add `import { formatDateTime } from "../app/labels";` and change the option text (~line 54) to `{row.author_label} · {formatDateTime(row.created_at)} · {row.submission_id}`.
- [ ] **Step 4: Run** the same command plus `tests/submissionHistory.test.tsx` — Expected: PASS.

**Commit point:** both files — `fix(variants): show final result options in local time`.

---

## WP-H: Browser acceptance for Q1, Q3, Q4, Q7, Q8

**Goal:** One Playwright spec proving the geometry and keyboard acceptance criteria that unit tests cannot, plus the specs touched by WP-D and WP-E.

**Depends on:** WP-B, WP-D, WP-E, WP-F done (WP-C and WP-G are not needed). Runs alone as the only Playwright run in this worktree, and not while any WP of any plan writes `final-workflow.spec.ts`, `admin.spec.ts`, `design.spec.ts`, `spans-resize.spec.ts` or `sidebar.spec.ts`.

**Owns:** `frontend/browser/quick-fixes.spec.ts` (create). Fixes to failing specs go back to the owning WP's files.

**Step 0: Obsolescence check** (Bash, worktree root). Leave out a test whose UI a sibling WP has replaced, and report it as "obsolete (replaced by …)":
- `Q1 (B1)` test: only if WP-B part B1 was applied (editor F8a not landed: `grep -c 'title="Original carried finding"' frontend/src/tasks/RoundInputEvidenceDialog.tsx` prints more than 0). Otherwise editor F10 covers Q1 for these dialogs.
- `Q1 (B2)` test: only if WP-B part B2 was applied (problem-reports WP6 not landed: `grep -c "Reload my reports" frontend/src/tasks/TaskProblemActions.tsx` prints more than 0). Otherwise Q1 for the reporter dialog belongs to problem-reports WP6/WP9.
- `Q8` test: only if `test -f frontend/src/tasks/RoundInputPanel.tsx` succeeds (editor F6 not landed).
Handover: the tests are separate `test()` blocks with these prefixes, so the later owners touch exactly the matching block: editor F10 removes or retargets `Q1 (B1)` and `Q8`; problem-reports WP9e replaces `Q1 (B2)` (problem-reports CR-3 when WP6 landed first: the block is not written at all).

**Read:** `frontend/browser/final-workflow.spec.ts:1-90` (scenario `/__test_translation_review__?workflow=true`, helpers `actor`, `value`, `assign`, `finding`, the carry-forward round flow that shows "Review carried findings" and "Inspect original evidence"), `frontend/browser/helpers.ts`, `frontend/playwright.config.ts` (`HPO_E2E_PORT`).

- [ ] **Step 1: Write the spec** `frontend/browser/quick-fixes.spec.ts`. Copy the `Scenario` type and the `actor`, `value`, `assign` and `finding` helpers from `final-workflow.spec.ts` (do not import from another spec file). Build one carry-forward state in `test.beforeAll`-free style (inside each test, or one serial `test.describe.configure({ mode: 'serial' })` group sharing a page) as in `final-workflow.spec.ts` lines 46-65: lead assigns, reviewer submits a finding, reviewer starts a carry-forward round. This state is **required** for Q4 too: the submitted result without a final selection guarantees at least one `MISSING_FINAL_SELECTION` warning in the preflight. Then implement these tests:

```ts
async function inViewport(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  const size = page.viewportSize()!;
  expect(box, 'element has a box').not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(size.height);
}

/** The dialog's own footer; never the header close button added by editor F1. */
const footer = (dialog: Locator) => dialog.locator(':scope > .modal-actions');

/**
 * Makes the dialog body overflow so a fixed footer is actually tested. The filler is a
 * test-only node appended after the content has rendered and removed before closing.
 */
async function withOverflow(dialog: Locator, check: () => Promise<void>) {
  const body = dialog.locator('.ui-dialog-body');
  await expect(body).not.toBeEmpty();
  const overflow = await body.evaluate(el => {
    const filler = document.createElement('div');
    filler.dataset.testFiller = 'true';
    filler.style.height = '200vh';
    el.append(filler);
    return el.scrollHeight - el.clientHeight;
  });
  expect(overflow, 'dialog body overflows').toBeGreaterThan(0);
  try { await check(); } finally { await body.evaluate(el => el.querySelector('[data-test-filler]')?.remove()); }
}

/** Close is in view, below the scrolling body, and focus wraps to and from it. */
async function assertFixedFooter(page: Page, dialog: Locator, close: Locator) {
  await withOverflow(dialog, async () => {
    await inViewport(page, close);
    const body = (await dialog.locator('.ui-dialog-body').boundingBox())!;
    const box = (await close.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(body.y + body.height - 1);
    await dialog.press('Shift+Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Tab'); // Tab out of the last element wraps inside the dialog
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await expect(close).not.toBeFocused();
  });
}

const sizes = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];

test('Q1 (B1): original evidence and Work rounds keep Close in a fixed footer', async ({ page }) => {
  // ... reach the carry-forward task as the reviewer (author.page in final-workflow.spec.ts)
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.getByRole('button', { name: 'Inspect original evidence' }).first().click();
    const evidence = page.getByRole('dialog', { name: 'Original carried finding' });
    const closeEvidence = footer(evidence).getByRole('button', { name: 'Close original evidence' });
    await assertFixedFooter(page, evidence, closeEvidence);
    await closeEvidence.click();
    await expect(evidence).toBeHidden();
    await page.getByRole('button', { name: 'Work rounds', exact: true }).click();
    const rounds = page.getByRole('dialog', { name: 'Work rounds', exact: true });
    const closeRounds = footer(rounds).getByRole('button', { name: 'Close', exact: true });
    await assertFixedFooter(page, rounds, closeRounds);
    await closeRounds.click();
    await expect(rounds).toBeHidden();
  }
});

test('Q1 (B2): task problem reports keep Close reports in a fixed footer', async ({ page }) => {
  // ... same reviewer task
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.getByRole('button', { name: 'My problem reports' }).click();
    const reports = page.getByRole('dialog', { name: 'Task problem reports' });
    const close = footer(reports).getByRole('button', { name: 'Close reports' });
    await expect(close).toBeEnabled(); // the initial load has finished
    await assertFixedFooter(page, reports, close);
    await close.click();
    await expect(reports).toBeHidden();
  }
});

test('Q8: carried-panel list markers stay inside the panel', async ({ page }) => {
  for (const width of [1440, 1000]) { // 260 px and 220 px sidebar
    await page.setViewportSize({ width, height: 900 });
    const panel = page.getByRole('region', { name: 'Review carried findings' });
    const geometry = await panel.evaluate(section => {
      const list = section.querySelector('ol')!; const item = list.querySelector('li')!;
      const scroller = section.closest('.sidebar-scroll') as HTMLElement | null;
      return {
        indent: item.getBoundingClientRect().left - section.getBoundingClientRect().left,
        markerWidth: (() => { const c = document.createElement('canvas').getContext('2d')!; c.font = getComputedStyle(item).font; return c.measureText('10. ').width; })(),
        overflow: scroller ? scroller.scrollWidth - scroller.clientWidth : 0,
      };
    });
    expect(geometry.indent).toBeGreaterThanOrEqual(geometry.markerWidth);
    expect(geometry.overflow).toBeLessThanOrEqual(0);
  }
});

test('Q7: focused resize handle shows a focus-ring ring without moving text', async ({ page }) => {
  // In the reviewer's task: select the carried or own mark so its resize handles render.
  const handle = page.locator('.resize-handle').first();
  const text = page.locator('.text-container');
  const before = await text.evaluate(el => [...el.querySelectorAll('mark, .mention')].map(m => m.getBoundingClientRect().toJSON()));
  await handle.focus();
  await page.keyboard.press('Shift'); // ensures :focus-visible after keyboard interaction
  const ring = await handle.evaluate(el => getComputedStyle(el, '::before').boxShadow);
  expect(ring).toContain('rgb(29, 78, 137)'); // --focus-ring #1d4e89
  const after = await text.evaluate(el => [...el.querySelectorAll('mark, .mention')].map(m => m.getBoundingClientRect().toJSON()));
  expect(after).toEqual(before);
  await page.screenshot({ path: test.info().outputPath('q7-handle-focus.png') });
});

test('Q3: project picker closes on select, Escape, outside click and Tab-out; arrows and ctrl-click do not navigate', async ({ page, context }) => {
  // As the lead (s.users.lead), on /#/tasks.
  const trigger = page.locator('.shell-project-trigger');
  const panel = page.locator('#shell-project-panel');
  const links = panel.getByRole('link');
  // Escape returns focus to the trigger.
  await trigger.click(); await expect(panel).toBeVisible();
  await page.keyboard.press('Tab'); await expect(links.first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden(); await expect(trigger).toBeFocused();
  // Outside pointer.
  await trigger.click(); await page.mouse.click(5, page.viewportSize()!.height - 5); await expect(panel).toBeHidden();
  // Tab-out: Tab from the last link leaves the picker and closes it.
  await trigger.click();
  await links.last().focus();
  await page.keyboard.press('Tab');
  await expect(panel).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(await page.locator('.shell-project-selector').evaluate(el => el.contains(document.activeElement))).toBe(false);
  // Arrow keys never navigate: the URL is captured before the keypresses.
  await trigger.click();
  const link = links.first();
  const url = page.url();
  await link.focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp');
  await expect(panel).toBeVisible();
  expect(page.url()).toBe(url);
  // Ctrl-click opens a new tab and leaves this page and the panel as they were.
  const popup = context.waitForEvent('page');
  await link.click({ modifiers: ['Control'] });
  await (await popup).close();
  expect(page.url()).toBe(url);
  await expect(panel).toBeVisible();
  // Plain click navigates and closes.
  await link.click();
  await expect(page).not.toHaveURL(url);
  await expect(panel).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  // Route change closes; the panel never stays over the page.
  await trigger.click();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Profile' }).click();
  await expect(panel).toBeHidden();
});

test('Q4: export preflight has one primary, Cancel, and tight warning items', async ({ page }) => {
  // As the lead on /#/projects/<s.project>/export after the reviewer submitted (no final selection yet).
  const section = page.getByRole('region', { name: 'Selected final results' });
  await expect(section.locator('.btn-primary')).toHaveCount(1);
  await page.getByRole('button', { name: 'Prepare final export' }).click();
  await expect(page.getByRole('heading', { name: 'Export preflight' })).toBeFocused();
  await expect(section.locator('.btn-primary')).toHaveCount(1);
  // Required: the scenario guarantees at least one warning; an empty list is a failure.
  const item = section.locator('.final-warning-list > li').first();
  await expect(item).toBeVisible();
  const gaps = await item.evaluate(li => {
    const p = li.querySelector('p')!.getBoundingClientRect(); const a = li.querySelector('a')!.getBoundingClientRect();
    const box = li.getBoundingClientRect(); const top = parseFloat(getComputedStyle(li).paddingTop);
    return { own: a.top - p.bottom, next: box.bottom - a.bottom + top };
  });
  expect(gaps.own).toBeLessThan(gaps.next);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Prepare final export' })).toBeFocused();
});
```

Fill in the setup for each test (login, which page, which actor) from `final-workflow.spec.ts`; keep `test.setTimeout(180_000)` and `test.use({ actionTimeout: 15_000 })`. Do not weaken the required assertions: no overflow in Q1, no warning item in Q4, or a Tab-out that does not close the picker in Q3 is a failure to report, not a reason to skip. Do not invent fixture changes in `tests/browser_server.py` (owned by Documents P1, problem-reports WP9 and editor F10). If Documents E1 has landed, the warning item's reason and row link may use different elements; adapt the two `querySelector` calls to its markup, keeping the comparison.

- [ ] **Step 2: Run** (Bash; heavy; the only Playwright run in this worktree):

```bash
HPO_E2E_PORT=18791 npm --prefix frontend run test:e2e -- quick-fixes.spec.ts
cd frontend && HPO_E2E_PORT=18791 npx playwright test final-workflow.spec.ts admin.spec.ts design.spec.ts spans-resize.spec.ts sidebar.spec.ts
```

(The second command reuses the build from the first; the `cd` is local to that Bash call.)
Expected: all PASS. Attach `q7-handle-focus.png` to the report.

**Done checklist (WP-H):** Q1 for every non-obsolete dialog: body overflows, Close in view below the body, Shift+Tab wraps to Close and Tab wraps back inside, at both sizes; Q3 dismissal by select, Escape, outside pointer, Tab-out and route change, arrow keys inert (URL captured first), ctrl-click new tab; Q4 one primary, Cancel focus, required warning geometry; Q7 ring colour and no text shift; Q8 (if not obsolete) marker inside at 260/220 px and no horizontal scroll; touched existing specs green; obsolete tests listed with the replacing WP.
**Commit point:** `frontend/browser/quick-fixes.spec.ts` — `test(browser): quick-fix acceptance for dialogs, picker, preflight and editor styles`.

---

## WP-I: Final gate

**Depends on:** all WPs (WP-G possibly marked obsolete).

- [ ] Run (Bash), one at a time, as the only heavy agent:

```bash
CHECK_VITEST_WORKERS=4 bash scripts/check.sh --only static
CHECK_VITEST_WORKERS=4 bash scripts/check.sh --only frontend
bash scripts/check.sh --only backend
HPO_E2E_PORT=18791 bash scripts/check.sh --only browser
```

Expected: each stage exits 0. A failure goes back to the owning WP (by file ownership above); do not fix outside your ownership. A failure caused by a sibling WP still in progress (for example OpenAPI drift before Documents B9) is reported with that WP's ID, not fixed here.

- [ ] Leftover UI identifiers (Bash):

```bash
grep -rnE 'Review final export"|Return to results|All projects|role="group" aria-label="Task counts"|shell-current-project|summary.*shell-project' frontend/src
```

Expected: no output, except the unchanged `ProjectDashboardPage` link "Review final export" while that file exists (Documents E1 deletes it).

- [ ] Obsolete focus rules (Bash). Only the two `accent-light` focus shadows are checked; `accent-light` stays a valid background token elsewhere:

```bash
grep -rnE 'box-shadow: *0 0 0 [0-9]+px var\(--accent-light\)' frontend/src/styles
```

Expected: no output.
- [ ] `git status --short` — Expected: the pre-existing uncommitted changes are still present, plus only files listed in the WPs.
- [ ] Report the commit points of all WPs in order A, B, C, D, E, F, G, H for the user to run later.

---

## Self-review against the spec

| Spec item | WP |
|---|---|
| Q1 footer Close, labels unchanged, busy behaviour, viewport + Tab wrap | WP-B (unit), WP-H (browser); per dialog delivered by editor F8a/F10 or problem-reports WP6/WP9 when those landed first |
| Q2 filter label, "All my tasks", visibility rule, synthetic option kept | WP-C |
| Q2 header visible text and accessible name | WP-D |
| Q3 link panel, current marker, search >6, all dismiss paths, no arrow navigation, Escape not reaching editor | WP-D (unit), WP-H (browser) |
| Q4 states, summary, Cancel, aria-disabled + hint + focus, heading focus, spacing, invalidation message | WP-E (unit), WP-H (geometry) |
| Q5 archive entries, receipt hashes, index columns/order/BOM, README sections, determinism, bundle_entry check; Resolved 1-3 | WP-A |
| Q5 copy line | WP-E |
| Q6 local time in options (conditional) | WP-G |
| Q7 ring rule, dead rule removal, token pair, screenshot, no text shift | WP-F, WP-H |
| Q8 list padding both lists, geometry at 260/220 px | WP-F, WP-H (obsolete per list after editor F6 / F8a) |
| Q9 list semantics, scoped label, hidden without tasks; Resolved 4 | WP-C |
| Resolved 5 (Dialog header close) | out of scope; editor plan |

## Review disposition

Codex review `ontocurator-reviews/2026-10-19-plan-quick-fixes-and-export-codex.md` (8 findings), each checked against the code and the three sibling plans.

| # | Finding | Verified against | Disposition |
|---|---|---|---|
| 1 | P1 Parallel execution by separate hunks is unsafe across plans | Documents "Files shared with sibling plans" (exclusive owner per file; U1 owns `components.css`, E1 `FinalExportPanel.tsx`, E3 `finalSelection.test.tsx`, B3 → B4 `final_results.py`, P7 existing specs) | Applied: exclusive ownership rule in the ground rules; "Shared files" rewritten with sibling WP IDs; new "Cross-plan sequencing" table; `components.css` writers serialized (WP-F, then WP-C → WP-D → WP-E after U1); lanes and graph updated. |
| 2 | P1 Obsolescence handling ignores tests | Problem-reports WP6 (no Reload, new footer), editor F6 (deletes `RoundInputPanel`), F8a (new titles, table), editor plan "Shared files" rows for Q1/Q8 | Applied: obsolescence rule covers tests; WP-B split into parts B1/B2 with `grep` checks and one `describe` per part; WP-F has one rule and one `it` per Q8 selector; WP-H Step 0 drops obsolete tests; handover of the blocks to F8a, WP6, F6, F10, WP9 stated. |
| 3 | P2 Bare "Close" queries become ambiguous after editor F1 | Editor F1 (header IconButton named "Close"; its Step 4 asks for footer-scoped queries) | Applied: unit and browser tests query footer buttons inside `:scope > .modal-actions`. |
| 4 | P2 Shell test cannot find `second / α` by name | `frontend/tests/shell.test.tsx:9` (every fixture project is named "Research") | Applied: the link is found in the panel by its `routeHref` destination. |
| 5 | P2 WP-E relies on focus-keeping `loading` without declaring it | `frontend/src/ui/Button.tsx:23` (`disabled={disabled \|\| loading}` today); Documents "Shared primitives" (U1 owns the busy state; siblings must not reimplement) | Applied: Documents U1 is a declared prerequisite of WP-E with a `grep` check; no local variant (the Documents plan forbids forks); new test keeps focus on Create during creation. The old claim "tests pass before and after Task 3.1" is removed. |
| 6 | P2 Acceptance assertions can pass vacuously | WP-H Q1, Q3, Q4 code; `application/workflow_warnings.py` (missing selection is a warning) | Applied: URL captured before the arrow keys; Q4 warning item required (scenario guarantees `MISSING_FINAL_SELECTION`); Q1 forces and asserts body overflow before footer geometry; Tab-out covered for the picker and Tab wrap out of the dialog footer. |
| 7 | P2 Commands mix shells | Ground rules and WP-G/WP-H/WP-I commands | Applied: all commands declared as Bash tool (Git Bash) at the top; `rg` (not installed in Git Bash) replaced by `grep -rnE`; WP-G check prints an explicit result. |
| 8 | P3 Final grep rejects legitimate `accent-light` backgrounds | `components.css:12,112,336`, `base.css:43` | Applied: the final check searches only `accent-light` focus box-shadows (today exactly `components.css:132` and `editor.css:633`) plus removed UI identifiers. |

No finding was rejected.
