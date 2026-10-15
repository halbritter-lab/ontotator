# T2d final review and fresh gate evidence

Reviewed `36d80f3..82514e1f04fc1bf31f6921de89a2c1dc74200a66` on
`feat/t2d-ontologies-exchange`, against Tasks 4–6 of
`.worktrees/t2-plan/docs/superpowers/plans/2026-10-14-t2d-ontologies-exchange-jobs.md`
(relative to the main repository), the server foundation spec in this worktree,
and the implementation notes' final user decisions. Review performed on 2026-10-15.
No implementation changes were made.

## Finding: P2 — validate exported units against the pinned ontologies

**Location:** `src/ontocurator/exchange/jobs.py:336–348`, particularly the call to
`ontospan.write_bundle` at line 339.

The export calls `write_bundle`, whose pinned ontospan 1.1 implementation validates
units without ontology views. Ontospan's HPO validator returns before checking term
activity, modifier classes and allowed roots when no ontology view is supplied.
Consequently a successful export can produce a bundle that fails validation when
read with the project's pinned ontology. This breaks Task 5's valid-bundle acceptance
condition and the handler's promise to fail invalid units with T1 issue codes.

This is reachable through normal editing: `EditorService._validate_term_for_layer`
(`application/editing.py:415`) and submit-time `validate_draft_terms`
(`application/submissions.py:64`) check whether a term is active, but do not enforce
`project_ontologies.allowed_roots`. For example, an active `HP:0000001` annotation
can be submitted in a project pinned with root `HP:0000118`. The export writes it;
ontology-aware reading rejects it with `outside_allowed_roots`.

**Minimal executed reproduction** (pure Python; no database changes):

```python
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, "tests")
import ontospan
from t1_fixtures import HP_PATH, unit

u = unit()  # HPO layer, allowed_roots = ("HP:0000118",)
a = u.annotation_set.annotations[0].model_copy(update={"term_id": "HP:0000001"})
u = u.model_copy(
    update={"annotation_set": u.annotation_set.model_copy(update={"annotations": (a,)})}
)
ontologies = {"hp": ontospan.ObographOntology.load(HP_PATH)}
print([issue.code for issue in ontospan.validate(u).errors])
print([issue.code for issue in ontospan.validate(u, ontologies).errors])
with tempfile.TemporaryDirectory() as tmp:
    target = Path(tmp) / "out.zip"
    ontospan.write_bundle(
        target, [u], bundle_id="out-of-root", created_at=datetime.now(UTC)
    )
    print(target.exists())
    try:
        ontospan.read_bundle(target, ontologies)
    except ontospan.FormatError as exc:
        print(sorted({issue.code for issue in exc.report.errors}))
```

Observed output: `[]`, `['outside_allowed_roots']`, `True`,
`['outside_allowed_roots']`.

**Recommendation:** load ontology views from `content.pins` and call the existing
`exchange.jobs._validate(units, ontologies)` before writing/storing the bundle.
Add a job-level regression in `tests/test_t1_export.py`: submit an active term outside
the pin's roots, run `t1_export`, and assert failure with `T1_INVALID` and
`outside_allowed_roots`, with no success audit. Its existing `_own`, `_submit` and
`_run` helpers provide the setup; change the snapshot's term through a fresh `snapshot`
to keep its version valid. Keep the valid-bundle test's ontology-aware `read_bundle`.

## Review coverage

- Task 4: project pin/release checks; scoped create/import permissions; complete-bundle
  transaction and document conflicts; proposal-set delivery payload and source identity;
  empty sets; tool provenance; idempotency; append-only triggers and grants; CLI jobs.
- Task 5: latest submissions, reviewer provenance and source references, consenting
  contributors, pseudonymised edit-log fields, output overwrite protection, audit/results.
  The finding above remains open.
- Task 6: removed product routes, readers/writers and UI upload/download code; test-only
  compatibility helpers and browser seeding; regenerated contract/assets. The product
  symbol search for `PackageWriter|read_package|uploadPackage|uploadOntology|downloadExport|analyze_package`
  in `src` and `frontend/src` returned no matches.
- Final fixes: defaulted basis is included in snapshot content only when nonempty,
  unchanged axis values preserve basis, profile HPO options stay within T1, and review
  exports name the reviewer. The focused pure tests below passed.

## Fresh verification

Full gate command, in this worktree at the reviewed head:

```powershell
& 'C:/Program Files/Git/bin/bash.exe' scripts/check.sh
```

**Result: exit 1, stopped at frontend unit tests.** Passed first: Ruff check, Ruff
format (198 files), mypy (77 source files), OpenAPI drift, frontend typecheck,
TypeScript API drift, and wheel lock/build/contents check. Wheel SHA-256:
`ff979245b6f3c77b0d883c849826c29fc7cab4969b2a82afd0593915e900cb67`.

Vitest: **1 failed, 314 passed; 1 failed file, 31 passed files**, duration 39.49 s.
Failure: `frontend/tests/treeBrowser.test.tsx:149`,
`TreeBrowser: one walk > opens at the start term: path open, term selected, focused and asked into view`;
`document.activeElement` was not the start row. **Backend and Playwright were not
reached; this run does not establish a passing full gate.**

Isolated follow-up:

```powershell
npm --prefix frontend test -- tests/treeBrowser.test.tsx --maxWorkers=1 --minWorkers=1
```

Exit 0: **17 passed**, 1 file, 1.89 s. The test and both tree components are unchanged
in the reviewed range. The test waits for row text, then immediately checks focus;
`frontend/src/editor/TermTree.tsx:45` applies focus in a passive React effect.
Inference: row visibility can resolve before that effect runs. Recommend wrapping
the focus/scroll expectations in `waitFor` (already imported), preserving the actual
behavior assertions. The isolated pass alone does not prove the root cause.

Focused final-fix verification:

```powershell
uv run pytest -q tests/test_t1_mapping.py tests/test_domain.py
```

Exit 0: **27 passed in 1.42 s**.

The heavy-test slot was released after the failed full gate. The coordinator requested
that implementation fixes and their regression tests precede the next full gate;
no redundant rerun was started in this review task.

## Assessment

One actionable P2 export-validation finding. The full gate is not green at the
reviewed head: its frontend focus assertion failed intermittently and prevented
backend/browser execution. Fix the validation gap, stabilize the effect-dependent
assertion if confirmed, then run the complete gate once before integration.

## Scoped fix review: `25e1d31..7dda5bf`

Reviewed the two-file fix package and the existing `_validate` helper. **The original
P2 is addressed; no new findings in this scoped diff.** `t1_export` loads views from
each project's pinned blob and validates every assembled unit before creating the
temporary output, storing the artifact, or recording a success audit. The shared
helper raises `T1_INVALID` with ontology validation codes, covering the originally
demonstrated `outside_allowed_roots` case.

The new `test_an_export_outside_the_pinned_roots_fails_without_an_artifact` creates
a fresh, correctly versioned snapshot for the outside-root term, then asserts a
failed job, `T1_INVALID` and `outside_allowed_roots`, no result, and no success audit.
Code ordering establishes that artifact storage is not reached on that failure.

Implementer-provided verification: the regression failed before the fix
(`succeeded != failed`, 17.30 s); all 10 export tests passed after it (16.90 s);
Ruff check and jobs-module mypy passed; the test wrapping was subsequently formatted.
The scoped reviewer ran `git diff 25e1d31..7dda5bf --check` successfully and did not
rerun tests, as requested. This review closes the code finding, but does not replace
the separately required complete gate or change the earlier failed gate evidence.
