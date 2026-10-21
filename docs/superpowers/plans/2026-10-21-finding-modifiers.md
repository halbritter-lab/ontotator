# Finding Modifiers and Family-Member Experiencer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Execution starts after `feat/annotator-ui` is merged into main. Step 0: new worktree from main, cherry-pick the spec/plan commits; re-check line references.** The plan was written against the code of `feat/annotator-ui` (= main `a4ab560` + annotator UI: AV click-to-confirm, AS submit dialog with `editor/unconfirmedValues.ts`, AR `SearchPanel`, AT tabs; AP pending mark and AH project switcher were still in progress). Line numbers below are from that state; every one is marked `~` and is re-checked with `grep -n` before editing (report drift, never guess).

**Goal:** Implement [2026-10-21-finding-modifiers-design.md](../specs/2026-10-21-finding-modifiers-design.md): modifiers on findings (data model, validation, editing commands, subtree search, editor UI, consolidation, T1 import/export, re-anchoring) and the experiencer value `family_member`. Delivered as a separate GitHub PR from branch `feat/modifiers` (not fast-forwarded into main).

**Architecture:** `Annotation.modifiers: list[Modifier]` (omitted from the content hash while empty, so no stored hash changes and no migration). A per-ontology classifier (`ontology/modifiers.py`) decides modifier / cohort / exclusive class from the HP:0012823, HP:0040279, HP:0012824, HP:0003674 subtrees and serves validation, search (`within`, `role`), submit rules and grouping. Grouping (`domain/agreement.py`) compares modifiers with segments (`modifiers_differ`, `modifier_as_finding`), `compare()` keeps comparing term-id sets. The editor gets a Modifiers section, an "Attach to finding" popover and modifier marks; consolidation gets a Modifiers row with the U-rule union. ontospan 1.2.1 adds `duplicate_modifier` and `exclusive_modifier_class`.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, SQLAlchemy + PostgreSQL (`pg_harness`), pytest; React 18, TypeScript, Vitest + Testing Library, Playwright + axe-core against `tests/browser_server.py`; ontospan (private Git dependency, `janpower/ontospan`).

**Binding inputs:** the spec (decisions M1–M11, rules R1–R12, scenarios S1–S23, copy), `DESIGN.md`, `PRODUCT.md`, T1 spec `2026-10-14-t1-shared-annotation-format-design.md` (F5, F6, F9, F11).

**Plan decisions (not fixed by the spec; the main session confirms them with the user before wave 3 only if the user asks, otherwise they stand):**

- D-a Classifier location: new module `ontology/modifiers.py` (the spec names `ontology/registry.py`); `OntologyRegistry` installs itself as the process-wide service source, so DB-side code (consolidation read, take-over, final panel) classifies without threading a registry through every service.
- D-b Term roles also reach `TermLabel` (`role`, `exclusive_class`) and `TreeNode` (`role`), so chips, "Cohort term" tags and "Two severities" work after a reload and the tree browser can disable modifier terms.
- D-c Consolidation modifier views carry `exclusive_class` (needed for the "Two severities" warning on options).
- D-d Modifier lists in the UI are ordered alphabetically by term label (spec examples are inconsistent; "sorted" in S2).
- D-e `modifier_majority` counts all members of a group (identical to "same-term members" for one-term groups; in a `term_differs` group the Modifiers row compares all members, S11/S12).
- D-f Submit warning copy (M7, M5): kinds "Modifier used as a finding" (blocking), "Cohort term as modifier", "Two severities" / "Two onsets"; acknowledgement checkbox "Submit with {n} unconfirmed values and {m} modifier warnings" / "Submit with {m} modifier warnings" (unchanged label when only values remain); consolidation summary adds "{m} findings have modifier warnings (cohort term or two of one kind)." and the checkbox reads "I checked these values and modifiers" when modifier warnings exist.
- D-g ontospan: branch `feat/modifier-checks` from the pinned commit `738f3d4` (branch `feat/review-resolution-format`, not merged into ontospan main); first tag of the repo `v1.2.1`.

---

## Step 0 (main session, once, after the merge)

- [ ] Confirm `feat/annotator-ui` is merged: `git -C C:/Users/jan-p/Development/ontocurator log --oneline -3 main` shows the annotator-ui tip (or its bundle commit) and the annotator-ui final phase is finished.
- [ ] **Ask the user once (German, short):** "Darf ich nach O1 den ontospan-Branch `feat/modifier-checks` und den Tag `v1.2.1` nach `janpower/ontospan` pushen? (nötig für den Pin in `pyproject.toml`)". Without a yes, wave 1 still runs; the pin bump (between wave 1 and 2) waits for it, and M3's export tests that need the new ontospan codes are marked `xfail(strict=True, reason="ontospan 1.2.1 pin")` until then.
- [ ] Create the implementation worktree and bring the spec and this plan over:

  ```bash
  git -C C:/Users/jan-p/Development/ontocurator worktree add C:/Users/jan-p/Development/ontocurator/.worktrees/modifiers -b feat/modifiers main
  base=$(git -C C:/Users/jan-p/Development/ontocurator merge-base main spec/modifiers)
  git -C C:/Users/jan-p/Development/ontocurator/.worktrees/modifiers cherry-pick "$base"..spec/modifiers
  ```

- [ ] Dependencies: `uv sync` and `npm --prefix C:/Users/jan-p/Development/ontocurator/.worktrees/modifiers/frontend ci`.
- [ ] Create `build/with-lock.sh` (content in rule 7, `root=/c/Users/jan-p/Development/ontocurator/.worktrees/modifiers`), `chmod +x`.
- [ ] ontospan checkout: `C:/Users/jan-p/Development/ontospan` exists (main checkout on `feat/shared-annotation-format`; worktree `.worktrees/format-1-2` on the pinned `738f3d4`). If it is absent: `git clone https://github.com/janpower/ontospan.git C:/Users/jan-p/Development/ontospan`. Then:

  ```bash
  git -C C:/Users/jan-p/Development/ontospan fetch origin
  git -C C:/Users/jan-p/Development/ontospan worktree add C:/Users/jan-p/Development/ontospan/.worktrees/modifier-checks -b feat/modifier-checks 738f3d43ca0896c9d146a15fb9538b938229368a
  cd C:/Users/jan-p/Development/ontospan/.worktrees/modifier-checks && uv sync && uv run pytest -q
  ```

  The pytest run must be green before O1 is dispatched.

- [ ] Re-check line references (`grep -n`) of the anchors named in the WP blocks of wave 1 and 2, especially after AP and AH: `frontend/src/app/CaseScreen.tsx` (`submissionAxisWarning`, `mentionsDisplay`, `pendingSearchProps`, `createPendingAnnotation`, `unconfirmedRows(`, `collectOpenItems(`, `<FindingRow`, `<AnnotationPanel`, `<TreeBrowser`, `<SubmitCaseDialog`), `frontend/src/editor/AnnotationPanel.tsx` (`values-heading-row`, `Mentions (`), `frontend/src/spans/adapter.ts` (`MentionDisplay`, `SpanEditorHandle`), `frontend/src/vendor/spans.js` (`run--${m.kind}`, `_onHover`), `src/ontocurator/exchange/t1.py` (`_refuse_unrepresentable`, `ontospan.Annotation(`). Put the drift into the dispatch prompts.
- [ ] Baseline: `WP=base bash /c/Users/jan-p/Development/ontocurator/.worktrees/modifiers/build/with-lock.sh backend env CHECK_PYTEST_WORKERS=4 CHECK_VITEST_WORKERS=3 bash scripts/check.sh --quick src/ontocurator/domain/agreement.py src/ontocurator/domain/annotations.py frontend/src/app/CaseScreen.tsx` is green; a red baseline is fixed or reported first.

## Global rules (every WP; an agent reads this section, "Shared contracts", "Shared-file chains" and its WP block)

Worktree `C:/Users/jan-p/Development/ontocurator/.worktrees/modifiers` (Git Bash `/c/Users/jan-p/Development/ontocurator/.worktrees/modifiers`), branch `feat/modifiers`. All agents of a wave share this worktree. O1 works only in `C:/Users/jan-p/Development/ontospan/.worktrees/modifier-checks`.

1. **Ownership.** A WP writes only the files in its **Owns** list (tests included). Within a wave the Owns lists are disjoint. "Conditional" Owns may be edited only if the WP's change breaks them. Need another file → stop and report. Never `git add -A`, `git add .`, `git stash`, `git reset`, `git checkout -- <file>`, `git clean`, never push, never `uv sync`/`uv lock` (main session only).
2. **Commits.** The agent commits its own files only: `git add <owned paths>` then `git commit -m "<message>" -- <owned paths>`. If `.git/index.lock` exists, retry after 10 s. Conventional message (`feat(modifiers): …`), English, **no AI co-author trailer or "Generated with" line**. One or more commits per WP; report every SHA.
3. **TDD.** Write the listed failing tests, run them red, implement, run green, then the WP gate.
4. **WP gate (explicit paths).** `CHECK_PYTEST_WORKERS=4 CHECK_VITEST_WORKERS=3 bash scripts/check.sh --quick <owned paths>` (static checks plus the tests affected by those paths). Do **not** use `--base main`. A gate that runs pytest runs inside the backend lock (rule 5). The static part (ruff, mypy, eslint, tsc, prettier, contract drift) sees siblings' uncommitted files: fix only failures in your Owns; report others with file names and rerun after the sibling's commit. Also run, by hand, every Vitest file that renders a component you changed but lives outside your Owns and report failures instead of editing them.
5. **Backend lock (16 GB RAM).** Every command that runs pytest against PostgreSQL (the gate included when Python paths are affected) holds `build/backend.lock`. Never run one while your own Playwright run is going. Pure tests (`tests/test_agreement_*.py`, `tests/test_modifier_classifier.py`) may run outside the lock with `uv run pytest -p no:cacheprovider <file>`.
6. **Playwright lock.** Only one Playwright run at a time across all agents: hold `build/playwright.lock`. `test:e2e` rebuilds the shared `frontend/dist` inside the lock. Command: `HPO_E2E_PORT=<port> npm --prefix frontend run test:e2e -- <spec files>`. Ports: wave slot 1 → 18774, slot 2 → 18775, slot 3 → 18776, final phase → 18777. At most ~6 spec files per locked run; release between batches.
7. **Lock protocol** (both locks). Use the **Bash tool** (Git Bash), never PowerShell, absolute paths only (cwd resets between calls). Acquire, run and release in one wrapper with `trap … EXIT`. Step 0 creates `/c/Users/jan-p/Development/ontocurator/.worktrees/modifiers/build/with-lock.sh`; agents only call it:

   ```bash
   #!/usr/bin/env bash
   # Usage: WP=<ID> bash /c/Users/jan-p/Development/ontocurator/.worktrees/modifiers/build/with-lock.sh <backend|playwright> <command...>
   set -u
   : "${WP:?set WP=<ID>}"
   root=/c/Users/jan-p/Development/ontocurator/.worktrees/modifiers
   lock="$root/build/$1.lock"
   shift
   mkdir -p "$root/build"
   until ( set -o noclobber; echo "$WP $(date -Iseconds)" > "$lock" ) 2>/dev/null; do
       echo "waiting for $lock (held by: $(cat "$lock" 2>/dev/null))"
       sleep 15
   done
   trap 'grep -q "^$WP " "$lock" 2>/dev/null && rm -f "$lock"' EXIT
   cd "$root" || exit 1
   "$@"
   exit $?
   ```

   Examples: `WP=M1 bash /c/Users/jan-p/Development/ontocurator/.worktrees/modifiers/build/with-lock.sh backend env CHECK_PYTEST_WORKERS=4 CHECK_VITEST_WORKERS=3 bash scripts/check.sh --quick src/ontocurator/domain/annotations.py tests/test_annotation_modifiers.py` and `WP=M4 HPO_E2E_PORT=18775 bash /c/Users/jan-p/Development/ontocurator/.worktrees/modifiers/build/with-lock.sh playwright npm --prefix frontend run test:e2e -- browser/modifiers.spec.ts`. Run every Playwright call and every call that may wait or exceed 10 min with `run_in_background: true`; never foreground `sleep`; never delete another agent's lock. A lock older than 45 min whose owner has reported is removed by the main session only.

8. **Contracts.** Only the wave's **contract owner** (wave 2: M1, wave 3: M2) changes `contracts/openapi.json` (`uv run python scripts/export_openapi.py`), `frontend/src/api/generated.ts` (`npm --prefix frontend run api:generate`) and `frontend/src/api/client.ts`. New fields are optional or defaulted so existing clients keep working. Typecheck fallout of the regenerated types in frontend files that no sibling owns is fixed by the contract owner with minimal additive edits (listed in the hand-back); fallout in a sibling's Owns is reported to the main session.
9. **Backend rules.** Domain modules stay pure (no DB, no ontology loading); error codes are `DomainError("<CODE>", {...})` with the codes of "Shared contracts"; no SQL migration (snapshot payloads are JSONB); `exclude_if` keeps every empty new field out of hashes and dumps.
10. **Frontend rules.** English copy verbatim from the spec (or D-f); status never by colour alone; unavailable actions use `aria-disabled` + reason (existing `Button`), never `disabled`; icons from `frontend/src/ui/icons.tsx`; no colour literals outside `tokens.css`, DESIGN.md tokens only; shortcuts only through `useShortcut`; no `style={…}` and no glyphs `↳ ✓` in `AnnotationPanel.tsx` / `SearchPanel.tsx` (`tests/annotationPanelStyles.test.ts`); no `line-clamp`/`text-overflow: ellipsis` inside the editor.css Values block markers. Offsets are Unicode code points (`Array.from(text)`), never UTF-16 indices.
11. **Evidence** (screenshots) only under `build/modifiers/evidence/` in the worktree; delete Playwright scratch output (`frontend/test-results`, traces) before committing.
12. **Reviews.** WPs marked "Review: yes" get one read-only `superpowers:code-reviewer` pass after their commit (findings to `C:/Users/jan-p/Development/ontocurator-reviews/2026-10-21-modifiers-<ID>-claude.md`), then one fix agent (effort medium) that owns the WP's files. M1's review and fix land before wave 3; M2's and M4's before wave 4; M5's before the final phase. The M2 reviewer also reviews G1's `domain/agreement.py` diff.
13. **Hand-back** (report format): changed/created/deleted files; tests added/updated with counts (e.g. "pytest tests/test_editing_modifiers.py: 21 passed"); gate command + result; Playwright specs + result; commit SHA(s); deviations, line drift, open risks. Max 250 words.

## Shared contracts

### C1 Data model (M1) — `src/ontocurator/domain/annotations.py`

```python
from ontocurator.domain.documents import Document, EvidenceRef, EvidenceSnapshot, Segment

class Modifier(BaseModel):
    """A clinical modifier of one finding (T1 F6): a term and 0..n segments."""

    model_config = ConfigDict(extra="forbid")

    term_id: str
    segments: list[Segment] = Field(
        default_factory=list, exclude_if=lambda value: not value
    )

# Annotation, after `note`:
    modifiers: list[Modifier] = Field(
        default_factory=list, exclude_if=lambda value: not value
    )
```

`validate_and_sort`: each `term_id` matches `CURIE_PATTERN`; a repeated `term_id` raises `InvalidAnnotation("Duplicate modifier term '<id>'")`; segments of one modifier are sorted by `(start, end)` and overlapping ones raise `InvalidAnnotation("Modifier segments overlap: …")`; modifiers are sorted by `term_id`. `annotation_content` adds `content["modifiers"] = [m.model_dump() for m in annotation.modifiers]` only when non-empty (`model_dump` drops empty `segments` through `exclude_if`). `snapshot()` calls `validate_segments(document.text, [s for m in annotation.modifiers for s in m.segments])`.

`ConsolidationMark` (`domain/review.py`, M2): `attached_to: str | None = Field(default=None, exclude_if=lambda value: value is None)`.

### C2 Classifier (M1) — new `src/ontocurator/ontology/modifiers.py`

```python
CLINICAL_MODIFIER = "HP:0012823"
FREQUENCY = "HP:0040279"
SEVERITY = "HP:0012824"
ONSET = "HP:0003674"
MODIFIER_ROOTS: tuple[str, ...] = (CLINICAL_MODIFIER, FREQUENCY)  # "+ Add modifier…" `within`
ModifierKind = Literal["modifier", "cohort"]
ExclusiveClass = Literal["severity", "onset"]
TermRole = Literal["finding", "modifier", "cohort"]

@dataclass(frozen=True)
class ModifierClassifier:
    clinical: frozenset[str]  # HP:0012823 subtree, root included
    cohort: frozenset[str]    # HP:0040279 subtree, root included
    severity: frozenset[str]
    onset: frozenset[str]

    def kind(self, term_id: str) -> ModifierKind | None: ...      # cohort first, then clinical
    def exclusive_class(self, term_id: str) -> ExclusiveClass | None: ...
    def role(self, term_id: str) -> TermRole: ...                 # kind or "finding"

NO_MODIFIERS = ModifierClassifier(frozenset(), frozenset(), frozenset(), frozenset())

def subtree(service: OntologyService, root: str) -> frozenset[str]: ...
    # root + descendants (children_of, breadth first); unknown root -> frozenset();
    # cached per (service.ref.sha256, root) under a lock
def classifier_of(service: OntologyService) -> ModifierClassifier: ...  # cached per sha256

class TermRoles:
    """Classifiers of a project's layers whose pin has the T1 profile hpo-phenotype."""
    def __init__(self, by_layer: Mapping[str, ModifierClassifier]) -> None: ...
    def supports(self, layer_id: str) -> bool: ...
    def kind(self, layer_id: str, term_id: str) -> ModifierKind | None: ...
    def exclusive_class(self, layer_id: str, term_id: str) -> ExclusiveClass | None: ...
    def role(self, layer_id: str, term_id: str) -> TermRole: ...   # "finding" for other layers

NO_TERM_ROLES = TermRoles({})

def install_service_source(source: Callable[[str], OntologyService | None]) -> None: ...
    # OntologyRegistry.__init__ calls install_service_source(self.get_service)
def term_roles(profile: TaskProfile, pins: Mapping[str, _PinLike]) -> TermRoles: ...
    # every layer whose pins[layer.ontology_id].t1_profile == "hpo-phenotype";
    # a sha256 the source cannot load raises DomainError("ONTOLOGY_NOT_FOUND", {"sha256": sha})
def term_roles_for_services(
    profile: TaskProfile, pins: Mapping[str, _PinLike], services: Mapping[str, OntologyService]
) -> TermRoles: ...  # editing: uses the already resolved per-layer services
```

`_PinLike` is a `Protocol` with `sha256: str` and `t1_profile: str` (no import from `exchange`). `domain/project_rules.py` gets a structural `ModifierRoles` `Protocol` (`kind`, `exclusive_class`) so the domain does not import `ontology`.

### C3 Editing commands and error codes (M1) — `application/editing.py`

```python
class AddModifierCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command: Literal["add_modifier"] = "add_modifier"
    annotation_id: str
    term_id: str
    segments: list[Segment] = Field(default_factory=list)

class SetModifierSegmentsCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command: Literal["set_modifier_segments"] = "set_modifier_segments"
    annotation_id: str
    term_id: str
    segments: list[Segment]

class RemoveModifierCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command: Literal["remove_modifier"] = "remove_modifier"
    annotation_id: str
    term_id: str

class ConvertToModifierCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command: Literal["convert_to_modifier"] = "convert_to_modifier"
    annotation_id: str
    target_annotation_id: str
    link_span: bool = True
```

| Code                      | Details                                            | Raised by                                                                                                                          |
| ------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `MODIFIERS_NOT_SUPPORTED` | `{layer_id}`                                       | modifier commands, resolve `choice.modifiers`, `attach_to` on a layer whose pin is not `hpo-phenotype`                             |
| `MODIFIER_NOT_ALLOWED`    | `{term_id}`                                        | term not under HP:0012823 / HP:0040279                                                                                             |
| `DUPLICATE_MODIFIER`      | `{term_id}`                                        | term already on the finding (not for `add_modifier` of a spanless existing term with segments: that links)                         |
| `MODIFIER_NOT_FOUND`      | `{term_id}`                                        | `set_modifier_segments`, `remove_modifier` of a term the finding does not have                                                     |
| `MODIFIER_AS_FINDING`     | `{term_id}`                                        | `create_annotation`, `set_term`, adoption, `recreate_reanchor` with a modifier term; resolve `choice.term_id` with a modifier term |
| `UNKNOWN_TERM`            | as today                                           | unknown modifier term                                                                                                              |
| `OBSOLETE_TERM`           | as today                                           | obsolete modifier term                                                                                                             |
| `PROJECT_RULE_VIOLATION`  | `{violations: [{rule: "modifier_as_finding", …}]}` | submit with a standalone modifier finding                                                                                          |

Client payload types (`client.ts`, M1): `AddModifierPayload`, `SetModifierSegmentsPayload`, `RemoveModifierPayload`, `ConvertToModifierPayload` mirroring the classes (segments `{ start: number; end: number }[]`), and `export type Modifier = components["schemas"]["Modifier"]`.

### C4 Search, labels, tree (M1)

- `SearchRequest.within: list[str] | None = Field(default=None, max_length=8)` (each a CURIE, else 422). `SearchCandidate.role: Literal["finding", "modifier", "cohort"] = "finding"` (filled by the route for `hpo-phenotype` layers). `SearchEventRecord.within: list[str] | None = Field(default=None, exclude_if=lambda value: value is None)`.
- `TermLabel` (`api/routes.py`): `role: Literal["finding", "modifier", "cohort"] = "finding"`, `exclusive_class: Literal["severity", "onset"] | None = None`.
- `TreeNode` (`ontology/tree.py`): `role: Literal["finding", "modifier", "cohort"] = "finding"` (filled by `api/tree_routes.py` for `hpo-phenotype` layers).
- `WorkspaceView` (`application/workspaces.py`): `modifier_layer_ids: list[str] = Field(default_factory=list)` (layers whose pin has the T1 profile `hpo-phenotype`; the editor shows the Modifiers section and treats modifier hits specially only there).

### C5 Submit rules and warnings (M1) — `domain/project_rules.py`, `application/submissions.py`

- `RuleViolation.rule` gains `"modifier_as_finding"`, `"cohort_modifier"`, `"exclusive_modifier_class"`.
- `rule_violations(..., modifier_findings: frozenset[str] = frozenset())`: one blocking `RuleViolation(annotation_id, "modifier_as_finding", {"term_id": term})` per snapshot whose annotation id is in `modifier_findings` (the caller computes the set with `TermRoles.kind(layer, term) is not None`).
- New pure `modifier_warnings(snapshots, roles: ModifierRoles) -> list[RuleViolation]`: per snapshot, per modifier with `kind == "cohort"`: `RuleViolation(id, "cohort_modifier", {"term_id": term})`; per exclusive class with ≥ 2 modifiers: `RuleViolation(id, "exclusive_modifier_class", {"class": "severity" | "onset"})`. Snapshot order, then modifier order.
- `_create_submission`: `warnings = (axis warnings when not require_chosen_axes) + [asdict(v) for v in modifier_warnings(...)]`; the acknowledgement digest covers the whole list (unchanged shape `{annotation_id, rule, detail}`), error code still `AXIS_CONFIRMATION_WARNING`. Without modifiers the list and digest are byte-identical to today.

### C6 Re-anchoring (M1) — `domain/reanchor.py`

```python
ReviewReason = Literal[..., "changed_cue", "changed_modifier_segment"]

@dataclass(frozen=True)
class MappedModifier:
    term_id: str
    segments: tuple[Span, ...]

@dataclass(frozen=True)
class OldModifier:
    term_id: str
    segments: tuple[TextSpan, ...]

# Carried: modifiers: tuple[MappedModifier, ...] = ()
# NeedsReview: old_modifiers: tuple[OldModifier, ...] = ()
```

Every modifier segment is mapped with `map_span` plus the text-equality check; a failure sets `failure = failure or "changed_modifier_segment"` (the whole claim needs review). Every caller that builds the carried annotation writes `modifiers=[Modifier(term_id=m.term_id, segments=[Segment(start=s.start, end=s.end) for s in m.segments]) for m in carried.modifiers]`.

### C7 Grouping (G1) — `src/ontocurator/domain/agreement.py`

```python
ModifierSpans = tuple[tuple[str, tuple[Span, ...]], ...]  # sorted (term, sorted segments)
GroupKind = Literal["match", "values_differ", "span_differs", "notes_differ", "term_differs",
                    "partial", "modifiers_differ", "modifier_as_finding"]

# Finding (new fields, after cues):
    modifier_spans: ModifierSpans = ()
    standalone_modifier: bool = False

# Group (new last field):
    modifier_majority: ModifierSpans | None = None
```

### C8 Consolidation API (M2) — `api/consolidation_routes.py`, `application/consolidation_resolve.py`

```python
class ConsolidationModifierView(_View):
    term_id: str
    term_label: str
    kind: Literal["modifier", "cohort"]
    exclusive_class: Literal["severity", "onset"] | None = None
    segments: list[tuple[int, int]] = []

class ModifierRefView(_View):
    term_id: str
    segments: list[tuple[int, int]] = []

# ConsolidationMemberView: modifiers: list[ConsolidationModifierView] = []
# ConsolidationGroupView:  modifier_majority: list[ModifierRefView] | None = None
#                          attached_to: str | None = None   # leave_out with attach (S18)

class ModifierIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    term_id: str
    segments: list[Segment] = Field(default_factory=list)

# ResolveChoice: modifiers: list[ModifierIn] | None = None   (omitted: the span member's)
# ResolveCommand: attach_to: str | None = None   (a cons-… annotation id; only with leave_out
#                 on a modifier_as_finding group, else DomainError("INVALID_RESOLUTION"))
# ConsolidationView: modifier_layer_ids: list[str] = []   (as WorkspaceView, for "Edit values…")
```

`client.ts` (M2): `ConsolidationResolvePayload.choice.modifiers?: { term_id: string; segments: { start: number; end: number }[] }[]` and `attach_to?: string`; type aliases `ConsolidationModifierView`, `ModifierRefView`.

### C9 Marks display (E1) — `spans/adapter.ts`, `vendor/spans.js`, `editor/TextPane.tsx`

```ts
// spans/adapter.ts
export interface MentionDisplay {
  // existing fields …
  kind?: "own" | "target" | "source" | "context" | "modifier";
  /** Run title and accessible description, e.g. "Severe, modifier of Seizure". */
  label?: string;
}
export interface SpanEditorHandle {
  // existing …
  /** Evidence ids whose runs get the `run--framed` frame (hover, focus, selection of a finding). */
  setFramed: (evidenceIds: string[]) => void;
}
export type HoverCallback = (evidenceIds: string[]) => void; // [] when the pointer leaves a run

// editor/TextPane.tsx (TextPaneProps, additive)
framedIds?: readonly string[];
onHoverMentions?: (evidenceIds: string[]) => void;
```

Modifier runs: `run--modifier` (1 px double underline in `--mark-line`), fill slot of their finding (`colorIndex` = the finding's slot), never a tab stop, never resizable; a click reports the modifier's display id through `onPick`. Display ids are built only by `modifierDisplayId(annotationId, termId)` = `` `mod:${annotationId}:${termId}` `` and parsed by `parseModifierDisplayId` (`editor/modifiers.ts`).

### C10 Pure editor helpers (E1) — new `frontend/src/editor/modifiers.ts`

```ts
export interface Seg {
  start: number;
  end: number;
}
export interface ModifierLike {
  term_id: string;
  segments?: readonly Seg[];
}
export interface TermInfo {
  label: string;
  role: "finding" | "modifier" | "cohort";
  exclusiveClass: "severity" | "onset" | null;
}
export const COHORT_TAG = "Cohort term";
export const MODIFIER_ROOTS = ["HP:0012823", "HP:0040279"] as const; // "+ Add modifier…" `within`
export function modifierDisplayId(annotationId: string, termId: string): string;
export function parseModifierDisplayId(
  id: string,
): { annotationId: string; termId: string } | null;
/** [start, end) code points of the sentence around `offset`. */
export function sentenceBounds(text: string, offset: number): [number, number];
export interface AttachFinding {
  annotationId: string;
  term: string;
  termId: string;
  segments: readonly Seg[];
  quote: string;
}
export interface AttachCandidate extends AttachFinding {
  distance: number;
  after: boolean;
}
/** Findings with a mention segment in the mark's sentence, nearest first; on a tie the one after the mark. */
export function attachCandidates(
  text: string,
  mark: Seg,
  findings: readonly AttachFinding[],
): AttachCandidate[];
/** "Severe · “schwere”", "Recurrent", "Frequent · “oft” · Cohort term". */
export function chipText(
  label: string,
  quote: string | null,
  role: TermInfo["role"],
): string;
/** "Two severities" / "Two onsets" lines for a finding's modifiers, in that order. */
export function exclusiveWarnings(
  modifiers: readonly ModifierLike[],
  info: (termId: string) => TermInfo | undefined,
): string[];
/** Labels sorted case-insensitively (D-d). */
export function sortByLabel<T extends ModifierLike>(
  modifiers: readonly T[],
  info: (termId: string) => TermInfo | undefined,
): T[];
/** Mark displays for the modifier segments of the given findings. */
export function modifierMarks(
  findings: readonly {
    annotationId: string;
    term: string;
    termId: string;
    colorIndex: number;
    modifiers: readonly ModifierLike[];
  }[],
  text: string,
  info: (termId: string) => TermInfo | undefined,
): MentionDisplay[];
/** "Seizure, modifiers: Severe (“schwere”)"; null without modifiers. */
export function findingDescription(
  term: string,
  modifiers: readonly ModifierLike[],
  text: string,
  info: (termId: string) => TermInfo | undefined,
): string | null;
```

### C11 Consolidation modifier sets (E1) — new `frontend/src/consolidation/modifierSets.ts`

```ts
export interface ModifierView {
  term_id: string;
  term_label: string;
  kind: "modifier" | "cohort";
  exclusive_class: "severity" | "onset" | null;
  segments: [number, number][];
}
export interface MemberSet {
  inputId: string;
  personId: string;
  personName: string;
  modifiers: readonly ModifierView[];
}
export interface SetOption {
  id: string;
  modifiers: ModifierView[];
  personIds: string[];
  inputIds: string[];
  union: boolean;
  majority: string | null /* "(2 of 3)" */;
  warnings: string[]; /* "Two severities" … */
}
export interface SegmentConflict {
  termId: string;
  termLabel: string;
  options: { id: string; segments: [number, number][]; personIds: string[] }[];
}
export function setKey(modifiers: readonly ModifierView[]): string;
export function modifierSetOptions(
  members: readonly MemberSet[],
  majority: readonly { term_id: string; segments: [number, number][] }[] | null,
): { options: SetOption[]; conflicts: SegmentConflict[] };
export function resolveUnion(
  option: SetOption,
  conflicts: readonly SegmentConflict[],
  picks: Readonly<Record<string, string>>,
): ModifierView[];
export function setText(
  modifiers: readonly ModifierView[],
  text: string,
  noTextTerms?: ReadonlySet<string>,
): string; // "Severe “schwere”, Recurrent" / "None"
export function optionLabel(
  option: SetOption,
  text: string,
  people: number,
): string; // "Severe “schwere” · Ana Weber" / "No modifiers · Cem Arslan" / "Both: …" / "All: …"
export interface CrossLink {
  personId: string;
  personName: string;
  termLabel: string;
  quote: string;
  groupId: string;
  findingLabel: string;
}
export function crossLinks(
  groupId: string,
  groups: readonly {
    groupId: string;
    members: readonly (MemberSet & { termLabel: string })[];
  }[],
  text: string,
): CrossLink[];
```

U-rule exactly as the spec ("Consolidation scenarios", U-rule): union = every term of every compared member; per term one distinct non-empty segment list → taken; none → none; ≥ 2 → a `SegmentConflict` (sub-row "Text of {term}"). The union option is offered when some resolution of its conflicts gives a set different from every person's set (S6, S7: not offered; S8: offered). Majority label on the option whose `setKey` equals the majority's. No computed majority or intersection option.

## Shared-file chains (one writer per wave)

| File(s)                                                                                                             | Writers (wave)                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `contracts/openapi.json`, `frontend/src/api/generated.ts`, `frontend/src/api/client.ts`                             | M1 (2) → M1 review fix → M2 (3) → M2 review fix                                                                               |
| `pyproject.toml`, `uv.lock`                                                                                         | main session only (pin bump between waves 1 and 2)                                                                            |
| `tests/fixtures/hp.json`, `tests/fixtures/hp-de.babelon.tsv`, `examples/t5-acceptance/hp.json`                      | F0 (1)                                                                                                                        |
| `src/ontocurator/domain/agreement.py`                                                                               | G1 (1) → M2 (3, conditional: fixes only)                                                                                      |
| `tests/browser_server.py`                                                                                           | M1 (2, modifier editor scenario) → M2 (3, conditional)                                                                        |
| `tests/browser_consolidation_scenarios.py`                                                                          | M2 (3)                                                                                                                        |
| `frontend/src/spans/adapter.ts`, `frontend/src/vendor/spans.js`, `frontend/src/editor/TextPane.tsx`                 | E1 (2)                                                                                                                        |
| `frontend/src/styles/screens/editor.css`, `frontend/tests/tokens.test.ts`, `frontend/src/editor/markColours.ts`     | E1 (2)                                                                                                                        |
| `DESIGN.md`                                                                                                         | E1 (2, mark state) → M4 (3, editor rows) → M5 (4, consolidation rows) → M5 review-fix agent (M7's submit rows)                |
| `frontend/src/app/CaseScreen.tsx`, `frontend/tests/caseScreen.test.tsx`                                             | M4 (3) → M4 review fix → M7 (4)                                                                                               |
| `frontend/src/editor/AnnotationPanel.tsx`, `SearchPanel.tsx`, `TreeBrowser.tsx`, `searchState.ts`, `FindingRow.tsx` | M4 (3)                                                                                                                        |
| `frontend/src/editor/openItems.ts`, `SubmitCaseDialog.tsx`, `UnconfirmedValuesSection.tsx`, `unconfirmedValues.ts`  | M7 (4)                                                                                                                        |
| `frontend/src/consolidation/*`, `frontend/tests/consolidation/*`                                                    | E1 (2, only the new `modifierSets.ts` + its test) → M2 (3, conditional: `tests/consolidation/fixtures.ts` typecheck) → M5 (4) |
| `frontend/src/documents/finalPanelText.ts`                                                                          | E1 (2, on behalf of M6)                                                                                                       |
| `src/ontocurator/exchange/t1.py`, `src/ontocurator/exchange/jobs.py`                                                | M3 (3)                                                                                                                        |
| `src/ontocurator/application/work_rounds.py`                                                                        | M1 (2)                                                                                                                        |
| ontospan worktree `C:/Users/jan-p/Development/ontospan/.worktrees/modifier-checks`                                  | O1 (1)                                                                                                                        |

## Waves

| Wave | Slot 1 (port 18774)                                                                                                         | Slot 2 (18775)   | Slot 3 (18776)                | Contract owner |
| ---- | --------------------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------- | -------------- |
| 1    | G1 (M, pure grouping)                                                                                                       | O1 (S, ontospan) | F1 then F0 (S + S, one agent) | none           |
| —    | main session: push ontospan (user OK from Step 0), bump the pin, `uv lock`, `uv sync`, commit `build(deps): ontospan 1.2.1` |                  |                               |                |
| 2    | M1 (L, review)                                                                                                              | E1 (M, incl. M6) | —                             | M1             |
| —    | M1 review → one fix agent (before wave 3)                                                                                   |                  |                               |                |
| 3    | M2 (L, review)                                                                                                              | M4 (L, review)   | M3 (M)                        | M2             |
| —    | M2 review and M4 review (parallel) → one fix agent each (before wave 4)                                                     |                  |                               |                |
| 4    | M5 (L, review)                                                                                                              | M7 (M)           | —                             | none           |
| —    | M5 review → one fix agent (also writes M7's DESIGN.md rows)                                                                 |                  |                               |                |
| 5    | Final phase (main session + one reviewer + one fix agent)                                                                   |                  |                               |                |

Dependencies: M1 ← F0 (fixture modifier subtree), F1 (`family_member` in the standard axes, used by M1's browser scenario profile). M2 ← G1 (`Finding` fields, kinds), M1 (model, classifier, `TermRoles`, contract). M3 ← M1 (model), pin bump (ontospan codes). M4 ← M1 (commands, `role`, `within`, `TermLabel.role`), E1 (`editor/modifiers.ts`, marks display). M5 ← M2 (contract), E1 (`modifierSets.ts`). M7 ← M4 (`CaseScreen.tsx`, attach popover for "Turn into modifier…"), M1 (warning rules). Critical path: G1 → M1 → M1 review/fix → M2 → M2 review/fix → M5 → M5 review/fix → final phase. Wave 2 slot 3 and wave 4 slot 3 stay idle (nothing is ready: every remaining WP needs M1's or M2's contract).

## Dispatch prompt template

```text
You implement WP <ID> of docs/superpowers/plans/2026-10-21-finding-modifiers.md
in the worktree C:/Users/jan-p/Development/ontocurator/.worktrees/modifiers
(branch feat/modifiers; Git Bash path /c/Users/jan-p/Development/ontocurator/.worktrees/modifiers).
Read: the "Plan decisions", "Global rules", "Shared contracts", "Shared-file chains" and the block
"### <ID>" of the plan, and the spec docs/superpowers/specs/2026-10-21-finding-modifiers-design.md
sections named in the block.
Use the Bash tool (Git Bash) with absolute paths for every shell command, never PowerShell.
Set WP=<ID> in every shell. Your Playwright port: HPO_E2E_PORT=<port>.
Rules: write only your Owns files; TDD; commit only your files with
`git commit -m "<msg>" -- <paths>` (no AI co-author trailer, no push); run PostgreSQL pytest and
Playwright only through build/with-lock.sh (rules 5–7); gate
`CHECK_PYTEST_WORKERS=4 CHECK_VITEST_WORKERS=3 bash scripts/check.sh --quick <your owned paths>` (rule 4).
Contract owner of this wave: <ID or "none">; only it changes the contract files (rule 8).
Line drift found in Step 0: <notes or "none">.
Siblings working in parallel: <IDs + their Owns summary>. Do not touch their files.
Open review findings handed to you (rule 12): <findings or "none">.
Report (max 250 words): changed files; tests added/updated and run with pass counts; gate result;
Playwright specs and result; commit SHA(s); deviations and risks.
```

O1's prompt replaces the worktree with `C:/Users/jan-p/Development/ontospan/.worktrees/modifier-checks` (branch `feat/modifier-checks`) and its gate with `uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run pytest -q` in that worktree (no locks). The F agent's prompt names "WP F1, then WP F0 (separate commits)".

---

## WP blocks

### O1 — ontospan 1.2.1: `duplicate_modifier`, `exclusive_modifier_class`

**Goal:** spec WP O1, R12, "Validation" rows "term already on the finding" and "a finding with two modifiers of one exclusive class". **Size S. Review: no.**

**Owns (ontospan worktree):** `src/ontospan/profiles/hpo.py`, `tests/test_profiles.py`, `src/ontospan/_version.py`, `pyproject.toml`, `uv.lock` (ontospan's own), `tests/test_package.py`, `CHANGELOG.md`, `README.md` (validation codes list). `SCHEMA_VERSION` stays `"1.2.0"` (no schema change).

**Tests that break:** `tests/test_package.py::test_the_package_states_its_version_and_schema_version` (`__version__ == "1.2.0"` → `"1.2.1"`).

**Tests to add (`tests/test_profiles.py`, builders from `tests/builders.py`):**

```python
def test_a_modifier_term_twice_is_an_error_even_without_ontology() -> None:
    modifiers = [(SEVERE, [(55, 62)]), (SEVERE, [])]
    item = annotation("a1", SEIZURE, [(63, 76)], modifiers=modifiers)
    assert codes(item, None) == [("error", "duplicate_modifier")]


def test_two_severities_or_two_onsets_only_warn(hp: ObographOntology) -> None:
    modifiers = [
        ("HP:0012824", []),  # Severity (the root counts as its class)
        (SEVERE, []),
        ("HP:0410280", []),  # Pediatric onset
        ("HP:0003593", []),  # Infantile onset
    ]
    item = annotation("a1", SEIZURE, [(63, 76)], modifiers=modifiers)
    assert codes(item, hp) == [
        ("warning", "exclusive_modifier_class"),
        ("warning", "exclusive_modifier_class"),
    ]


def test_one_severity_and_one_onset_do_not_warn(hp: ObographOntology) -> None:
    item = annotation(
        "a1", SEIZURE, [(63, 76)], modifiers=[(SEVERE, []), ("HP:0003593", [])]
    )
    assert codes(item, hp) == []
```

Also assert the issue path: the duplicate is reported at `a.modifiers[1].term_id`, the class warning at `a.modifiers` with the message naming the class (`"2 severity modifiers: ['HP:0012824', 'HP:0012828']"`).

**Steps:**

- [ ] Red: the three tests and the version assertion `"1.2.1"`; `uv run pytest tests/test_profiles.py tests/test_package.py -q` fails.
- [ ] `profiles/hpo.py`, the ontology-free modifier loop becomes:

  ```python
  seen: set[str] = set()
  for index, modifier in enumerate(annotation.modifiers):
      where = f"{path}.modifiers[{index}].term_id"
      if not _HPO_ID.match(modifier.term_id):
          add("not_an_hpo_id", where, f"{modifier.term_id!r} is not an HPO id")
      if modifier.term_id in seen:
          add(
              "duplicate_modifier",
              where,
              f"{modifier.term_id} is already a modifier of this annotation",
          )
      seen.add(modifier.term_id)
  ```

  and after the ontology loop over the modifiers:

  ```python
  for root, name in ((SEVERITY, "severity"), (ONSET, "onset")):
      under = sorted(
          {
              m.term_id
              for m in annotation.modifiers
              if ontology.is_active(m.term_id) and is_under(ontology, m.term_id, root)
          }
      )
      if len(under) > 1:
          add(
              "exclusive_modifier_class",
              f"{path}.modifiers",
              f"{len(under)} {name} modifiers: {under}",
              "warning",
          )
  ```

- [ ] Version `1.2.1` in `pyproject.toml` and `_version.py`; `uv lock` in the ontospan worktree; CHANGELOG `## 1.2.1` ("Validation: `duplicate_modifier` (error) for a modifier term repeated on one annotation; `exclusive_modifier_class` (warning) for two or more modifiers under Severity HP:0012824 or Onset HP:0003674. No schema change."); README validation-codes paragraph names both codes.
- [ ] Gate (ontospan): `uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run pytest -q`.
- [ ] Commit `feat(hpo): duplicate modifiers and exclusive modifier classes`; tag `git -C C:/Users/jan-p/Development/ontospan/.worktrees/modifier-checks tag -a v1.2.1 -m "ontospan 1.2.1"`. **No push** (main session, after the user's OK). Hand back the full commit SHA.

**Acceptance:** green ontospan suite; `to_phenopackets` unchanged (first severity → `severity`, the rest → `modifiers[]`, existing test).

### F1 — Experiencer `family_member` (M7)

**Goal:** spec "Experiencer “Family member” (M7)". **Size S. Review: no.** Done by the F agent before F0.

**Owns:** `src/ontocurator/domain/axes.py`, `src/ontocurator/domain/profile_templates.py`, `examples/t5-acceptance/profile.json`, `tests/test_axes.py`, `tests/test_profile_template_family_member.py` (new). Conditional: tests that assert `STANDARD_CLINICAL_AXES` options or its `config_sha256` (find with `grep -rn '"patient", "other"' tests`). **Not** `tests/fixtures/smoke-profile.json`, `tests/layered_fixtures.py` (spec: unchanged).

**Tests that break:** `tests/test_axes.py` ~`:131-133` (`("experiencer", "Experiencer", ["patient", "other"])`).

**Tests to add:**

- `tests/test_axes.py`: experiencer options `["patient", "family_member", "other"]`; `validate_axes({"experiencer": "family_member"}, …)` accepts it.
- `tests/test_profile_template_family_member.py`: `profile_templates.TEMPLATES["hpo-phenotype"](ontology_file)` (use the existing template test's ontology argument; `grep -rn "hpo_phenotype(" tests`) has experiencer options in that order and the creation default stays `patient`; `check_t1_profile(profile, {ontology_id: Pin(sha256="x", t1_profile="hpo-phenotype")})` raises nothing; `examples/t5-acceptance/profile.json` loads and lists `family_member` between `patient` and `other`.

**Steps:**

- [ ] Red, then `axes.py`: `ExperiencerType = Literal["patient", "family_member", "other"]`; `STANDARD_CLINICAL_AXES` experiencer `options=["patient", "family_member", "other"]` (~`:73`); `profile_templates.py` ~`:48` the same; `examples/t5-acceptance/profile.json` ~`:42` insert `"family_member"` after `"patient"`. If the axis definition model has a description field, set the experiencer description to "Patient: the patient. Family member: a relative (“Mutter mit Epilepsie”). Other person: someone who is not a relative."; otherwise none (there is no guidelines file to edit).
- [ ] Green; gate (backend lock) with the owned paths. Commit `feat(axes): family member experiencer`.

**Acceptance:** standard profile shows Patient · Family member · Other person (editor labels exist in `editor/axisLabels.ts`).

### F0 — Fixture ontology with the modifier subtree

**Goal:** spec "Testing > Fixture ontology". **Size S. Review: no.** Done by the F agent after F1.

**Owns:** `tests/fixtures/hp.json`, `tests/fixtures/hp-de.babelon.tsv`, `examples/t5-acceptance/hp.json`, `examples/t5-acceptance/manifest.json` (if it records the ontology sha256), `tests/test_fixture_ontology.py` (new). Conditional: tests and fixtures that pin the fixture's sha256, term count or search hit lists (find with `grep -rln "hp.json\|HP_SHA\|HP_DIGEST" tests` and the failures of the full run below), `tests/fixtures/demo_package.zip` and `tests/fixtures/smoke-bundle.zip` (regenerate with `uv run python scripts/make_smoke_bundle.py` only if a test compares their embedded ontology), browser specs whose expected hit lists change (conditional, report each).

**Terms to add** (obographs nodes `{"id": "http://purl.obolibrary.org/obo/HP_xxxxxxx", "lbl": …, "type": "CLASS"}` and `is_a` edges, same shape as the existing ones):

| Id         | Label               | Parent (`is_a`)      |
| ---------- | ------------------- | -------------------- |
| HP:0012823 | Clinical modifier   | HP:0000001 All       |
| HP:0012824 | Severity            | HP:0012823           |
| HP:0012825 | Mild                | HP:0012824           |
| HP:0012828 | Severe              | HP:0012824           |
| HP:0031797 | Clinical course     | HP:0012823           |
| HP:0003674 | Onset               | HP:0031797           |
| HP:0410280 | Pediatric onset     | HP:0003674           |
| HP:0003623 | Neonatal onset      | HP:0410280           |
| HP:0011008 | Temporal pattern    | HP:0031797           |
| HP:0031796 | Recurrent           | HP:0011008           |
| HP:0012830 | Position            | HP:0012823           |
| HP:0012831 | Laterality          | HP:0012830           |
| HP:0012832 | Bilateral           | HP:0012831           |
| HP:0040279 | Frequency           | HP:0000001           |
| HP:0040282 | Frequent            | HP:0040279           |
| HP:0007359 | Focal-onset seizure | HP:0001250 (Seizure) |

Check every label and parent against the pinned HPO release (ontospan's `tests/fixtures/hp-mini.json` in the ontospan checkout has Clinical course, Pediatric onset, Position, Laterality, Bilateral, Frequency, Frequent with their parents; for the rest use the full HPO if `examples/full-hpo-sources.json` points at a local copy, else hpo.jax.org); report every difference and follow the release. German (`hp-de.babelon.tsv`, same column layout): `HP:0012828 rdfs:label en Severe de Schwer OFFICIAL` and `HP:0031796 rdfs:label en Recurrent de Wiederkehrend OFFICIAL`. `examples/t5-acceptance/hp.json` gets the same nodes and edges.

**Tests to add (`tests/test_fixture_ontology.py`, load the fixture like `tests/test_search_translations.py` does):** every table term exists with its label and parent; `all_ancestors_of("HP:0003623")` contains HP:0003674 and HP:0012823; `all_ancestors_of("HP:0040282")` contains HP:0040279 but not HP:0012823; a German search `SearchRequest(query="schwere", languages=["de"], …)` lists HP:0012828 among its candidates; `examples/t5-acceptance/hp.json` has the same 16 nodes.

**Steps:**

- [ ] Red (`tests/test_fixture_ontology.py`), add nodes, edges, German rows; green.
- [ ] Full backend run once (fixture is shared by most tests), in the background: `WP=F0 bash …/build/with-lock.sh backend env CHECK_PYTEST_WORKERS=4 bash scripts/check.sh --only backend`. Fix hash/count/hit-list expectations in conditional Owns (recompute, never weaken an assertion to `any`); report anything that looks like a behaviour change.
- [ ] Browser specs that search terms (port 18776): `annotation-loop.spec.ts tree.spec.ts spans.spec.ts values-block.spec.ts consolidation.spec.ts review-flow.spec.ts`; fix expected hit lists only.
- [ ] Commit `test(fixtures): HPO clinical modifier subtree`. Gate with the owned paths.

**Acceptance:** fixture and example ontology carry the subtree; full backend suite green.

### G1 — Grouping with modifiers (pure domain)

**Goal:** spec "Agreement and grouping (pure domain)", R4, R5, R6 (the domain part), M9; scenarios S1–S20 at the `groups()`/`compare()` level. **Size M. Review: no (the M2 reviewer reviews this diff).**

**Owns:** `src/ontocurator/domain/agreement.py`, `tests/test_agreement_modifiers.py` (new). Run (do not edit) `tests/test_agreement_domain.py`, `tests/test_agreement_groups.py`.

**Tests that break:** none expected (new fields have defaults).

**Tests to add (`tests/test_agreement_modifiers.py`, pure, no DB):**

```python
TEXT = "Seit 2 Wochen wiederholt schwere Krampfanfälle und eine Muskelhypotonie."
SEIZURE, HYPOTONIA, FOCAL = "HP:0001250", "HP:0001252", "HP:0007359"
SEVERE, MILD, RECURRENT = "HP:0012828", "HP:0012825", "HP:0031796"
AXES = {"assertion": "present", "experiencer": "patient", "temporality": "current"}


def at(word: str, nth: int = 0) -> tuple[int, int]:
    start = -1
    for _ in range(nth + 1):
        start = TEXT.index(word, start + 1)
    return (start, start + len(word))


def f(key, term, spans=(), mods=(), *, standalone=False, order=0, axes=AXES):
    return Finding(
        key=key, layer_id="hpo", term_id=term, axes=dict(axes),
        modifiers=frozenset(t for t, _ in mods), spans=tuple(spans), order=order,
        type_id="phenotype",
        modifier_spans=tuple(sorted((t, tuple(sorted(s))) for t, s in mods)),
        standalone_modifier=standalone,
    )
```

One test per scenario, asserting `kinds` (and where named `modifier_majority`, number of groups, and `compare()`'s `matching` / `context_differences` / `only_here`):

| Test                                         | Input (A = "a", B = "b", C = "c")                                                                          | Expected                                                                                  |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `test_s1_same_modifier_and_text_match`       | A, B Seizure `at("Krampfanfälle")` `{SEVERE: [at("schwere")]}`                                             | `{"match"}`; compare matching 1                                                           |
| `test_s2_spanless_modifier_sets_match`       | A, B `{SEVERE: [], RECURRENT: []}`                                                                         | `{"match"}`                                                                               |
| `test_s3_subset_differs`                     | A `{SEVERE}`, B `{SEVERE, RECURRENT}`                                                                      | `{"modifiers_differ"}`; compare context_differences 1                                     |
| `test_s5_none_versus_one`                    | A `{}`, B `{SEVERE: [schwere]}`                                                                            | `{"modifiers_differ"}`                                                                    |
| `test_s6_text_versus_no_text`                | A `{SEVERE: [schwere]}`, B `{SEVERE: []}`                                                                  | `{"modifiers_differ"}`; compare **matching 1** (R4)                                       |
| `test_s7_different_texts`                    | A `{SEVERE: [at("schwere")]}`, B `{SEVERE: [at("wiederholt schwere")]}`                                    | `{"modifiers_differ"}`; compare matching 1                                                |
| `test_s9_same_text_on_different_findings`    | A Seizure `{SEVERE: [schwere]}`, Hypotonia `{}`; B Seizure `{}`, Hypotonia `{SEVERE: [schwere]}`           | two groups, each `{"modifiers_differ"}`                                                   |
| `test_s10_combined_rows`                     | A present, span "Krampfanfälle", `{SEVERE}`; B uncertain, span "schwere Krampfanfälle", `{}`               | `{"values_differ", "span_differs", "modifiers_differ"}`                                   |
| `test_s11_term_differs_compares_all_members` | A Seizure `{SEVERE: [schwere]}`, B Focal `{RECURRENT}` overlapping                                         | `{"term_differs", "modifiers_differ"}`; compare only_here a 1, b 1                        |
| `test_s12_three_people_term_differs`         | A Seizure `{SEVERE}`, B Seizure `{}`, C Focal `{MILD}`                                                     | one group ⊇ `{"term_differs", "modifiers_differ"}`; `modifier_majority is None`           |
| `test_s13_partial`                           | A Seizure `{SEVERE: [schwere]}`, B nothing                                                                 | `{"partial"}`                                                                             |
| `test_s14_partial_with_three`                | A `{SEVERE}`, B `{}`, C nothing                                                                            | `{"partial", "modifiers_differ"}`                                                         |
| `test_s15_majority_label_source`             | A `{SEVERE}`, B `{SEVERE}`, C `{}`                                                                         | `{"modifiers_differ"}`; `modifier_majority == ((SEVERE, ()),)`                            |
| `test_s16_no_majority`                       | A `{SEVERE}`, B `{SEVERE, RECURRENT}`, C `{MILD}`                                                          | `modifier_majority is None`                                                               |
| `test_s18_standalone_never_merges`           | A standalone Severe on "schwere Krampfanfälle"; B Seizure on "schwere Krampfanfälle" `{SEVERE: [schwere]}` | two groups: A's `{"modifier_as_finding", "partial"}`, B's `{"partial"}` (overlap ignored) |
| `test_s19_both_standalone`                   | A, B standalone Severe on "schwere"                                                                        | `{"modifier_as_finding"}`; compare matching 1                                             |
| `test_s20_one_more_character_differs`        | A `[at("schwere")]`, B `[at("schwere ")]`                                                                  | `{"modifiers_differ"}`; compare matching 1                                                |
| `test_without_modifiers_nothing_changes`     | the fixtures of `test_agreement_groups.py`'s main table with default fields                                | identical `groups()` and `compare()` results (call both modules' helpers)                 |

**Steps:**

- [ ] Red: `uv run pytest -p no:cacheprovider tests/test_agreement_modifiers.py -q`.
- [ ] `agreement.py`: C7 types; extend the module docstring (modifier sets compared by `compare` as term-id sets; `groups` compares `modifier_spans` exactly). In `groups()`: `candidates = [i for i, cluster in enumerate(clusters) if len(cluster.members) < len(order) and not cluster.first.standalone_modifier]` (standalone clusters never join the term merge, and a merge partner that is standalone is excluded by the same filter). In `_group`, after the existing loop:

  ```python
  modifier_sets = [finding.modifier_spans for _, finding in members]
  # D-e: a person's exact set (with segments) held by > half of >= 3 members.
  majority_set: ModifierSpans | None = None
  if len(members) >= 3:
      counts: dict[ModifierSpans, int] = {}
      for value in modifier_sets:
          counts[value] = counts.get(value, 0) + 1
      majority_set = next(
          (value for value, count in counts.items() if count * 2 > len(members)), None
      )
  ```

  kinds: `if len(set(modifier_sets)) > 1: kinds.add("modifiers_differ")`; `if any(f.standalone_modifier for _, f in members): kinds.add("modifier_as_finding")` (both before the `match` fallback); `Group(..., modifier_majority=majority_set if "modifiers_differ" in kinds else None)`. `_relation` and `compare` stay unchanged.

- [ ] Green, plus `uv run pytest -p no:cacheprovider tests/test_agreement_domain.py tests/test_agreement_groups.py -q`. Gate (backend lock: the quick gate may pick DB tests that import the module). Commit `feat(agreement): group modifiers with their text spans`.

**Acceptance:** S1–S20 domain tests green; existing agreement tests unchanged.

### M1 — Data model, classifier, editing commands, search, submit rules, re-anchoring, contract

**Goal:** spec "Data model and content hash", "Validation (server side)", "Editing commands", "Search subtree filter", "Text versions", R1–R3, R9–R12; contract C1–C6. **Size L. Review: yes (L, contract, data model).** Contract owner of wave 2.

**Owns:** `src/ontocurator/domain/annotations.py`, `src/ontocurator/domain/project_rules.py`, `src/ontocurator/domain/reanchor.py`, `src/ontocurator/domain/reanchor_resolution.py` (reason literal), `src/ontocurator/application/editing.py`, `src/ontocurator/application/submissions.py`, `src/ontocurator/application/work_rounds.py`, `src/ontocurator/application/text_changes.py`, `src/ontocurator/exchange/reanchor_job.py`, `src/ontocurator/ontology/modifiers.py` (new), `src/ontocurator/ontology/registry.py`, `src/ontocurator/ontology/service.py`, `src/ontocurator/ontology/provenance.py`, `src/ontocurator/ontology/tree.py`, `src/ontocurator/api/tree_routes.py`, `src/ontocurator/api/routes.py`, `src/ontocurator/packages/models.py`, `src/ontocurator/application/workspaces.py` (`modifier_layer_ids`), `contracts/openapi.json`, `frontend/src/api/generated.ts`, `frontend/src/api/client.ts`, `frontend/src/editor/carried/instructions.ts` and `frontend/src/variants/ReanchorPanel.tsx` (only the `changed_modifier_segment` entry), tests: `tests/test_annotation_modifiers.py`, `tests/test_modifier_classifier.py`, `tests/test_editing_modifiers.py`, `tests/test_search_within.py`, `tests/test_submission_modifier_rules.py`, `tests/test_reanchor.py`, `tests/test_reanchor_job.py`, `tests/browser_modifier_scenarios.py` (new), `tests/browser_server.py`, `tests/test_browser_modifier_fixture.py` (new). Conditional: other Python tests broken by the new error paths (report each); frontend typecheck fallout (rule 8).

**Tests that break:** none by design (empty modifiers are invisible); `tests/test_search_*` seeds must stay identical (written first as characterization, below).

**Tests to add:**

- `tests/test_annotation_modifiers.py` (pure):
  1. `test_existing_versions_and_submission_id_are_unchanged` — **written and run green on the unchanged code first**: build three snapshots with fixed inputs (a spanless finding, a finding with one mention and `axes_defaulted`, a finding with a note and two mentions; fixed `ontology_sha256`, `layer_config_sha256` from a fixed small `TaskProfile`) and one `canonical_hash` of a submission content dict built like `_create_submission` (`key`, `scope`, `targets`, `draft_revision`, `snapshots`, `decisions`); paste the four values as literals.
  2. modifiers sorted by `term_id`; segments sorted; duplicate term → `InvalidAnnotation`; overlapping segments in one modifier → `InvalidAnnotation`; overlap between modifiers and with the mention allowed.
  3. `annotation_content` without modifiers has no `modifiers` key; with `[Modifier("HP:0031796"), Modifier("HP:0012828", [Segment(25, 32)])]` it is `[{"term_id": "HP:0012828", "segments": [{"start": 25, "end": 32}]}, {"term_id": "HP:0031796"}]`.
  4. `snapshot()` refuses a modifier segment beyond `len(document.text)`.
  5. `decode_snapshot` of an old payload (no `modifiers`) round-trips to the same version.
- `tests/test_modifier_classifier.py` (pure, fixture ontology from F0): `kind`: Severe → `modifier`, Frequent → `cohort`, Seizure → `None`, the roots themselves classified; `exclusive_class`: Mild/Severe → `severity`, Neonatal onset → `onset`, Recurrent → `None`; `subtree(service, "HP:0011008")` = {HP:0011008, HP:0031796}; unknown root → empty; `classifier_of` returns the cached object on the second call; `TermRoles` gives `finding` for a layer that is not `hpo-phenotype`; `term_roles` raises `ONTOLOGY_NOT_FOUND` for an unknown sha256.
- `tests/test_editing_modifiers.py` (PostgreSQL; project with `t1_fixtures.PIN` = `hpo-phenotype`, fixture text "Seit 2 Wochen wiederholt schwere Krampfanfälle und eine Muskelhypotonie."; reuse the editing test helpers of `tests/test_editing.py`): add without and with segments; add of a spanless existing term with segments links them; add duplicate with segments when one exists → `DUPLICATE_MODIFIER`; `MODIFIER_NOT_ALLOWED` (Seizure as modifier); `UNKNOWN_TERM`, `OBSOLETE_TERM` (HP:0000123); alternative id stored as primary; Frequency accepted; Mild + Severe accepted; segment out of bounds → `InvalidAnnotation` error code as today; `set_modifier_segments` replace and `[]`; `MODIFIER_NOT_FOUND`; `remove_modifier`; layer pinned `generic` → `MODIFIERS_NOT_SUPPORTED`; reference layer → `REFERENCE_LAYER_READ_ONLY`; `create_annotation` with Severe → `MODIFIER_AS_FINDING` `{term_id}`; `set_term` to Severe → `MODIFIER_AS_FINDING`; `set_term` keeps modifiers; adoption of a proposal whose term is Severe → `MODIFIER_AS_FINDING`; delete removes the modifiers with the finding; every command clears `checked_layer_ids` of the layer and repoints a consolidation-marked decision (`_update_decision_replacements`); the workspace view lists the `hpo-phenotype` layer in `modifier_layer_ids` and not a `generic` one; `convert_to_modifier` with `link_span=True` deletes the standalone finding and adds Severe with its first mention's segments to the target in one revision, with `link_span=False` without segments, refusals `ANNOTATION_NOT_FOUND`, `DUPLICATE_MODIFIER`, `MODIFIER_NOT_ALLOWED` (source is not a modifier term).
- `tests/test_search_within.py` (pure service tests on the fixture ontology plus one API test): **characterization first** — seeds of three existing searches (`auto` keyword, `lexical`, with and without `languages`) recorded on the unchanged code; `within=["HP:0012823", "HP:0040279"]` with query "se" returns only subtree terms and as many as exist up to `k` (filter before the cut: a query whose top 10 unfiltered hits contain fewer than `k` modifier terms still returns `k` when they exist); `within` changes the seed, its absence does not; `route="browse"` with `within` uses them as roots; the stored event has `within`; `SearchCandidate.role` is `modifier`/`cohort`/`finding` on an `hpo-phenotype` layer and always `finding` on a `generic` one; `/terms/labels` returns `role` and `exclusive_class`; tree node `role`.
- `tests/test_submission_modifier_rules.py` (PostgreSQL): a standalone Severe finding (inserted through the repository like old data, bypassing the command) → `PROJECT_RULE_VIOLATION` with rule `modifier_as_finding`; a finding with Frequent → `AXIS_CONFIRMATION_WARNING` whose `warnings` contains `{"rule": "cohort_modifier", "detail": {"term_id": "HP:0040282"}}`, the returned acknowledgement submits; Mild + Severe → `exclusive_modifier_class` `{"class": "severity"}`; with `require_chosen_axes` the modifier warnings still need the acknowledgement; without modifiers the warnings list and digest equal today's (compare with a draft that has only defaulted axes).
- `tests/test_reanchor.py`: modifier segment mapped (Carried.modifiers); text of the modifier changed → `NeedsReview` reason `changed_modifier_segment` with `old_modifiers`; spanless modifiers carried unchanged. `tests/test_reanchor_job.py`: a carried annotation keeps its mapped modifiers in the target draft. Round creation carry (`work_rounds.py` ~`:621`) covered in `tests/test_reanchor_job.py` or the existing round carry test module (`grep -rln "reanchor_annotation\|carry" tests`).
- `tests/test_browser_modifier_fixture.py`: the new scenario builds (project pinned `hpo-phenotype` with the F1 standard axes, document "Seit 2 Wochen wiederholt schwere Krampfanfälle und eine Muskelhypotonie.", one annotator task, German search language on; variant `with_finding=1` pre-creates Seizure on "Krampfanfälle"; variant `standalone=1` pre-inserts a standalone Severe finding on "schwere").

**Steps:**

- [ ] Characterization tests (golden versions, search seeds) green on the unchanged code; commit them first: `test(modifiers): pin existing hashes and search seeds`.
- [ ] Red for the rest.
- [ ] `domain/annotations.py` per C1. `validate_and_sort` additions:

  ```python
  seen: set[str] = set()
  for modifier in self.modifiers:
      if not CURIE_PATTERN.match(modifier.term_id):
          raise InvalidAnnotation(
              f"Invalid ontology CURIE format for modifier: '{modifier.term_id}'"
          )
      if modifier.term_id in seen:
          raise InvalidAnnotation(f"Duplicate modifier term '{modifier.term_id}'")
      seen.add(modifier.term_id)
      ordered = sorted(modifier.segments, key=lambda s: (s.start, s.end))
      for left, right in zip(ordered, ordered[1:]):
          if left.end > right.start:
              raise InvalidAnnotation(
                  f"Modifier segments overlap: {left} and {right}"
              )
      modifier.segments = ordered
  self.modifiers = sorted(self.modifiers, key=lambda m: m.term_id)
  ```

  `annotation_content`: `if annotation.modifiers: content["modifiers"] = [m.model_dump() for m in annotation.modifiers]`. `snapshot()`: `validate_segments(document.text, [s for m in annotation.modifiers for s in m.segments])` after the evidence check.

- [ ] `ontology/modifiers.py` per C2 (`subtree` walks `service.ontology.children_of`; caches are module dicts guarded by one `threading.Lock`, keyed by sha256). `registry.py`: `install_service_source(self.get_service)` at the end of `__init__`.
- [ ] `editing.py`: the four commands (C3) into `EditCommand`; add them to the preparation tuple next to `SetTermCommand` (they need the layer's service); read `pins = self.repo.project_pins(key.project_key)` once before `operation`; helpers:

  ```python
  def _modifier_layer(self, profile, pins, layer_id, services) -> ModifierClassifier:
      roles = term_roles_for_services(profile, pins, {layer_id: services[layer_id]})
      if not roles.supports(layer_id):
          raise DomainError("MODIFIERS_NOT_SUPPORTED", {"layer_id": layer_id})
      return classifier_of(services[layer_id])

  def _modifier_term(self, service, classifier, term_id) -> str:
      primary = self._validate_term_for_layer(service, term_id)  # UNKNOWN/OBSOLETE
      if classifier.kind(primary) is None:
          raise DomainError("MODIFIER_NOT_ALLOWED", {"term_id": primary})
      return primary

  def _replace(self, draft, existing, annotation, doc, profile) -> None:
      new_snap = snapshot(annotation, existing.evidence, doc, profile)
      draft.annotations = [
          new_snap if a.annotation.annotation_id == annotation.annotation_id else a
          for a in draft.annotations
      ]
      layer = annotation.layer_id
      draft.checked_layer_ids = [lid for lid in draft.checked_layer_ids if lid != layer]
      self._update_decision_replacements(draft, annotation.annotation_id, new_snap)
  ```

  `add_modifier`: existing term without segments + given segments → link; existing term otherwise → `DUPLICATE_MODIFIER`; else append `Modifier(term_id=primary, segments=cmd.segments)`; `validate_segments(doc.text, cmd.segments)`. `set_modifier_segments` / `remove_modifier`: `MODIFIER_NOT_FOUND` when absent (term compared after primary-id resolution). `convert_to_modifier`: source must be in the draft, in an editable layer, with `classifier.kind(source.term_id)` set (else `MODIFIER_NOT_ALLOWED`); target in the same layer; segments = the source's first evidence (by `evidence_refs` order) mention segments when `link_span`; refuses `DUPLICATE_MODIFIER` when the target has the term with other segments; then `remove_draft_annotation(draft, source_id)` and `_replace(target)`. `_create_annotation`, `_set_term`, recreate and adoption (also the branch with `source.annotation.term_id == cmd.term_id`): after the term is resolved, `if layer supports modifiers and classifier.kind(term_id) is not None: raise DomainError("MODIFIER_AS_FINDING", {"term_id": term_id})`. `set_term` keeps `modifiers` (only `term_id` changes). Adoption copies the source's modifiers if it copies its axes and note (check `_create_annotation`; same rule).

- [ ] Search (`provenance.py`, `service.py`, `api/routes.py`, `packages/models.py`, `tree.py`, `tree_routes.py`) per C4. `OntologyService.search`: with `request.within`, `allowed = frozenset().union(*(subtree(self, root) for root in request.within))`; `_auto_hits` filters the exact block by `allowed` and fetches the similar block with a widening depth until `remaining` hits survive or the ranking is exhausted:

  ```python
  depth = request.k + len(exact)
  while True:
      fetched = self._similar(query, depth, languages)
      ranked = [h for h in fetched if h["hpo_id"] not in taken and (allowed is None or h["hpo_id"] in allowed)]
      if len(ranked) >= remaining or len(fetched) < depth:
          break
      depth = depth * 10 if depth < request.k * 10 else len(self.ontology)  # k × 10, then all
  ranked = ranked[:remaining]
  ```

  (`len(self.ontology)` = the term count; use the existing accessor.) `_route_hits` filters the same way; `browse` with `within` returns the `within` roots in their order. `_seed`: keep the current code path byte-identical and only when `request.within` is set hash once more: `hashlib.sha256(f"{seed}|within:{','.join(sorted(request.within))}".encode()).hexdigest()[:16]`. The search route sets `event.within = req.within` and, when the layer's pin is `hpo-phenotype`, `candidate.role = classifier_of(ontology).role(candidate.term_id)`; the labels route fills `role`/`exclusive_class` the same way; tree routes fill `TreeNode.role`.

- [ ] Submit rules per C5: `project_rules.py` (`modifier_findings` parameter, `modifier_warnings`, `ModifierRoles` protocol); `submissions.py` builds `roles = term_roles(task_profile, self.repo.project_pins(key.project_key))`, `modifier_findings = frozenset(s.annotation.annotation_id for s in deduped_snaps if roles.kind(s.annotation.layer_id, s.annotation.term_id) is not None)` and passes it to the blocking `rule_violations` call; the warnings list as in C5. `validate_draft_terms` also validates modifier terms (unknown/obsolete modifier → the same error codes as findings, message names the modifier).
- [ ] Re-anchoring per C6: `reanchor.py` maps modifier segments after the evidence loop (same `TextSpan`/`map_span` checks); `_needs_review` carries `old_modifiers`. Writers: `exchange/reanchor_job.py` ~`:140`, `application/work_rounds.py` ~`:621`, `application/text_changes.py` ~`:105` (list every other path that copies an annotation onto another text: `grep -rn "model_copy(.*evidence_refs\|evidence_refs=" src/ontocurator/application src/ontocurator/exchange`; handle each or report why it does not apply). `reanchor_resolution.py`: extend the reason literal. Frontend copy: `carried/instructions.ts` `changed_modifier_segment: "The text of one of its modifiers was changed by the correction, so it could not be placed automatically."`; `ReanchorPanel.tsx` `changed_modifier_segment: "The text of a modifier changed."`; "What to check" names the modifier ("Text of Severe changed: “schwere”") where the panel lists the old segments: render `old_modifiers` as `Text of {label} changed: “{text}”` (label via the panel's existing term label lookup).
- [ ] Contract: `uv run python scripts/export_openapi.py`, `npm --prefix frontend run api:generate`; `client.ts` payload types and aliases (C3); fix typecheck fallout (rule 8).
- [ ] Browser scenario `tests/browser_modifier_scenarios.py` (pattern of `tests/browser_values_scenarios.py`, but `Pin(…, t1_profile="hpo-phenotype")`), registered in `tests/browser_server.py`; `tests/test_browser_modifier_fixture.py`.
- [ ] Green; gate (backend lock) with all owned paths; also `uv run pytest tests/test_editing.py tests/test_layered_editing.py tests/test_search_auto.py tests/test_reanchor*.py tests/test_t1_*.py` under the lock. Commits: `test(modifiers): pin existing hashes and search seeds`, `feat(annotations): finding modifiers in the data model`, `feat(ontology): modifier classifier and subtree search`, `feat(editing): modifier commands and refusals`, `feat(submit): modifier rules and warnings`, `feat(reanchor): carry modifier segments`, `test(browser): modifier editor scenario`.

**Acceptance:** golden versions and seeds unchanged; every refusal code tested; contract regenerated; no migration.

### E1 — Frontend pure helpers, modifier marks, final panel copy (incl. M6)

**Goal:** spec "Display (M4)" (marks layer only), "Attach to finding" steps 3 (pure ranking), "Consolidation > Frontend" U-rule (pure), "Final panel copy" (WP M6); contracts C9–C11. No contract change; uses local input types. **Size M. Review: no.**

**Owns:** `frontend/src/editor/modifiers.ts` (new), `frontend/src/consolidation/modifierSets.ts` (new), `frontend/src/spans/adapter.ts`, `frontend/src/vendor/spans.js`, `frontend/src/editor/TextPane.tsx`, `frontend/src/editor/markColours.ts` (doc comment only), `frontend/src/styles/screens/editor.css`, `frontend/src/documents/finalPanelText.ts`, `DESIGN.md` ("Mark states" table), tests: `frontend/tests/editorModifiers.test.ts` (new), `frontend/tests/consolidation/modifierSets.test.ts` (new), `frontend/tests/textPaneMarkers.test.tsx`, `frontend/tests/tokens.test.ts`, the test that asserts `AGREEMENT_EXPLANATION` (find with `grep -rln "AGREEMENT_EXPLANATION\|set of modifiers" frontend/tests`).

**Tests to add:**

- `editorModifiers.test.ts`: `sentenceBounds` — mid sentence, first and last sentence, "Dr. med." is a boundary only when followed by whitespace (document the limitation in the test name), `!`/`?`, line break, text with an emoji before the offset (code points); `attachCandidates` — same-sentence filter, distance ordering, tie → the finding after the mark ("schwere" between "Krampfanfälle" after and an equally distant one before), overlap distance 0, spanless findings excluded; `chipText` ("Severe · “schwere”", "Recurrent", "Frequent · “oft” · Cohort term"); `exclusiveWarnings` (["Two severities"], ["Two severities", "Two onsets"], []); `sortByLabel`; `modifierDisplayId`/`parseModifierDisplayId` round trip incl. a term id with ":"; `modifierMarks` (kind `modifier`, finding's `colorIndex`, label "Severe, modifier of Seizure", spanless modifiers produce no mark); `findingDescription` ("Seizure, modifiers: Severe (“schwere”), Recurrent").
- `consolidation/modifierSets.test.ts`: S3 (two options, no union), S4 (union "Both: Recurrent “wiederholt”, Severe “schwere”" per D-d), S5, S6 (no union; `setText` with `noTextTerms` gives "Severe (no text)"), S7 (no union), S8 (union offered, one conflict "Text of Severe" with two options; `resolveUnion` with Ana's pick → Recurrent + Severe “schwere”), S12/S16 ("All: Mild, Recurrent, Severe" with warning "Two severities"), S15 (option of Ana and Ben has majority "(2 of 3)", no preselection field), S17 (cohort label "Frequent · Cohort term · Ana Weber"), `crossLinks` S9 ("Ben Roth linked “schwere” (Severe) to Hypotonia." data for the Seizure group and the reverse).
- `textPaneMarkers.test.tsx`: a `kind: "modifier"` mention renders runs with `run--modifier` and its `colorIndex` slot, `title` = label, not focusable, no resize handles; `framedIds` adds `run--framed` to exactly those runs and removes it on change; hovering a run calls `onHoverMentions` with its ids and `[]` on leave; a click on a modifier run calls `onPick` with the modifier display id.
- `tokens.test.ts`: the `.run--modifier` rule uses `--mark-line` and `text-decoration-style: double` (or a double box-shadow: whatever E1 uses, asserted), `.run--framed` uses `--mark-selected` via box shadow and no padding/margin; forced-colours block maps them to `CanvasText` / `Highlight`.
- Final panel copy test: `AGREEMENT_EXPLANATION` ends with "Modifier text spans do not count here. “All findings match” also needs the same text spans, notes and modifier text spans."

**Steps:**

- [ ] Red, then `editor/modifiers.ts` per C10:

  ```ts
  export function sentenceBounds(
    text: string,
    offset: number,
  ): [number, number] {
    const chars = Array.from(text);
    const at = Math.max(0, Math.min(offset, chars.length));
    const isBreak = (i: number) => chars[i] === "\n" || chars[i] === "\r";
    const ends = (i: number) =>
      /[.!?]/.test(chars[i]) &&
      (i + 1 >= chars.length || /\s/.test(chars[i + 1]));
    let start = 0;
    for (let i = at - 1; i >= 0; i -= 1) {
      if (isBreak(i) || ends(i)) {
        start = i + 1;
        break;
      }
    }
    let end = chars.length;
    for (let i = at; i < chars.length; i += 1) {
      if (isBreak(i)) {
        end = i;
        break;
      }
      if (ends(i)) {
        end = i + 1;
        break;
      }
    }
    return [start, end];
  }

  export function attachCandidates(
    text: string,
    mark: Seg,
    findings: readonly AttachFinding[],
  ): AttachCandidate[] {
    const [from, to] = sentenceBounds(text, mark.start);
    const gap = (s: Seg) =>
      s.start >= mark.end
        ? s.start - mark.end
        : mark.start >= s.end
          ? mark.start - s.end
          : 0;
    return findings
      .map((finding, index) => {
        const inside = finding.segments.filter(
          (s) => s.start < to && s.end > from,
        );
        if (!inside.length) return null;
        const nearest = inside.reduce((best, s) =>
          gap(s) < gap(best) ? s : best,
        );
        return {
          ...finding,
          distance: gap(nearest),
          after: nearest.start >= mark.end,
          index,
        };
      })
      .filter((c): c is AttachCandidate & { index: number } => c !== null)
      .sort(
        (a, b) =>
          a.distance - b.distance ||
          Number(b.after) - Number(a.after) ||
          a.index - b.index,
      )
      .map(({ index: _index, ...candidate }) => candidate);
  }
  ```

- [ ] `consolidation/modifierSets.ts` per C11 (pure; the union enumeration over conflict resolutions is bounded by ≤ 4 people per term).
- [ ] Marks per C9: vendor — `kind === "modifier"` runs get `run--modifier`, `title` from the mention's label (`label` already flows through `mentionsToVendor`; pass it on), are skipped by the resize-handle and keyboard-mark logic, and `setFramed(ids)` toggles `run--framed` on runs that contain any of the ids (same loop pattern as `run--hot`); adapter — `setFramed`, `onHoverMentions` wiring into the existing vendor `_onHover`; TextPane — `framedIds`, `onHoverMentions` props (effect on `framedIds` like `selectedEvidenceId`). `editor.css` (outside the Values block markers):

  ```css
  .run--modifier {
    text-decoration-line: underline;
    text-decoration-style: double;
    text-decoration-thickness: 1px;
    text-decoration-color: var(--mark-line);
    text-underline-offset: 3px;
  }
  .run--framed {
    box-shadow: 0 0 0 2px var(--mark-selected);
  }
  @media (forced-colors: active) {
    .run--modifier {
      text-decoration-color: CanvasText;
    }
    .run--framed {
      box-shadow: none;
      outline: 2px solid Highlight;
    }
  }
  @media (prefers-reduced-motion: no-preference) {
    .run--framed {
      transition: box-shadow 120ms ease-out;
    }
  }
  ```

  (Check how `run--target`/`run--source` draw their lines and follow the same technique if they use box shadows; `run--multi` keeps its rule.)

- [ ] `markColours.ts`: doc comment: a modifier segment takes its finding's slot. DESIGN.md "Mark states" table: new row "Modifier of a finding | `run--modifier`: 1 px double underline in `mark-line`, fill of its finding's term slot; not a tab stop; title "Severe, modifier of Seizure"" and "Framed (hover / focus / selected finding) | `run--framed`: 2 px `mark-selected` box shadow, no layout shift; `Highlight` outline in forced colours".
- [ ] `finalPanelText.ts`: append the sentence (verbatim from the spec) to `AGREEMENT_EXPLANATION`.
- [ ] Green; gate with the owned paths; `npm --prefix frontend run test -- textPane spans` for siblings' renders. Browser: `spans.spec.ts spans-resize.spec.ts annotation-loop.spec.ts` (port 18775) must stay green (no modifier data yet). Commits `feat(editor): modifier helpers and marks`, `feat(consolidation): modifier set options`, `docs(final): modifier text spans in the agreement explanation`.

**Acceptance:** pure tests cover sentence rules, ranking, U-rule (S3–S8, S12, S15–S17), cross links; marks render without changing existing mark tests.

### M2 — Grouping inputs, consolidation read and resolve, W1, contract

**Goal:** spec "Agreement and grouping" (`finding_of`, W1), "Consolidation > Backend", S1–S23 backend behaviour, R5–R8; contract C8. **Size L. Review: yes (L, contract; the reviewer also covers G1's diff).** Contract owner of wave 3.

**Owns:** `src/ontocurator/domain/review.py`, `src/ontocurator/application/document_row_panel.py`, `src/ontocurator/application/consolidation.py`, `src/ontocurator/application/consolidation_resolve.py`, `src/ontocurator/application/document_row_submissions.py` (only if a signature changes), `src/ontocurator/api/consolidation_routes.py`, `src/ontocurator/domain/agreement.py` (conditional: fixes), `contracts/openapi.json`, `frontend/src/api/generated.ts`, `frontend/src/api/client.ts`, `frontend/tests/consolidation/fixtures.ts` (conditional: typecheck), `tests/browser_consolidation_scenarios.py`, `tests/test_browser_consolidation_fixture.py`, tests: `tests/test_consolidation_modifiers_read.py` (new), `tests/test_consolidation_modifiers_resolve.py` (new), `tests/test_final_panel_modifiers.py` (new), `tests/test_consolidation_auto_take_over.py`, `tests/test_review_consolidation_mark.py`.

**Tests that break:** none by design; `tests/test_review_consolidation_mark.py` decision-hash tests must stay unchanged (add a case that `attached_to=None` is not dumped).

**Tests to add (PostgreSQL; build rounds with the helpers of `tests/test_consolidation_resolve_api.py` / `test_consolidation_read_api.py`; text and terms of the spec scenarios; fixture ontology from F0; project pinned `hpo-phenotype`):**

- `test_consolidation_modifiers_read.py`: `modifier_layer_ids` on the view; member `modifiers` with `term_label`, `kind` (Frequent → `cohort`), `exclusive_class`, `segments`; `_added` findings carry modifiers; group `modifier_majority` for S15, `None` for S16; kinds per S1, S3, S9, S18 (`modifier_as_finding`, `partial`) through the API; standalone findings are flagged only on `hpo-phenotype` layers.
- `test_consolidation_modifiers_resolve.py`: S3 choose with explicit `modifiers` (Ben's set) → `cons-…` has them; omitted `modifiers` → the span member's (S10: B's span with A's modifiers sent explicitly); S4/S8 union list sent by the client stored as given (sorted, one Severe); "Edit values…" may add a modifier nobody had; refusals in `choice.modifiers`: `MODIFIER_NOT_ALLOWED`, `DUPLICATE_MODIFIER`, `UNKNOWN_TERM`; `choice.term_id` a modifier term → `MODIFIER_AS_FINDING`; `keep` keeps the member's modifiers; S11 `keep_both` keeps each term's earliest member's modifiers; S12 `keep_both` takes A's `{Severe}` not B's `{}`; `leave_out` none; S18 `attach_to`: target gains Severe with A's segments, target decisions' `content_sha256` updated (group does not read edited), mark `attached_to`; target already has Severe with another span → `DUPLICATE_MODIFIER`; `attach_to` on a non-`modifier_as_finding` group → `INVALID_RESOLUTION`; S21 reopen of the S18 group removes the attached modifier when unchanged; reopen of the target group drops it and S18's group reads open (`state == "open"`, counted by `open_group_count`, submit gated); S22 editor edit of a `cons-…` annotation's modifiers reads `edited` and stays resolved.
- `test_consolidation_auto_take_over.py`: S1 identical sets with segments → `auto`; S6, S20 → not taken over; S19 → not taken over.
- `test_final_panel_modifiers.py`: `all_match` false for S3, S6, S18; true for S1, S2; `compare` counts for S6 (match) and S11 (two only-here).
- `tests/test_browser_consolidation_fixture.py`: the `modifiers` scenario builds with the kinds listed below.

**Steps:**

- [ ] Red.
- [ ] `review.py`: `ConsolidationMark.attached_to` (C1).
- [ ] `document_row_panel.py`: `finding_of(..., roles: ModifierRoles = NO_TERM_ROLES)` fills

  ```python
  modifiers=frozenset(m.term_id for m in annotation.modifiers),
  modifier_spans=tuple(
      sorted(
          (m.term_id, tuple(sorted((s.start, s.end) for s in m.segments)))
          for m in annotation.modifiers
      )
  ),
  standalone_modifier=roles.kind(annotation.layer_id, annotation.term_id) is not None,
  ```

  `findings_of(..., roles=…)`; new `project_roles(conn, pid, profile) -> TermRoles` (`term_roles(profile, Repository._pins(conn, pid))`). Pass real roles at every production call site: `consolidation.py` ~`:189`, ~`:380`, `document_row_panel.py` ~`:286`, ~`:315` (`grep -rn "finding_of(\|findings_of(" src`); the default exists only for pure tests. Update the `findings_of` docstring ("modifiers are not part of the annotation model" is obsolete).

- [ ] `consolidation.py`: member payload `modifiers` (labels filled by the route like `term_label`, ~`consolidation_routes.py:121`), `kind`/`exclusive_class` from the roles; group `modifier_majority`; `is_open(targets, decisions, annotations=None)`: a `leave_out` decision with `consolidation.attached_to` whose target annotation is missing from `annotations` or lacks the attached term → open; pass the draft's annotations from `open_group_count`, `_state` and the submit gating.
- [ ] `consolidation_resolve.py`: `ModifierIn`, `ResolveChoice.modifiers`, `ResolveCommand.attach_to` (C8); in `choose`, `annotation.model_copy(update={"modifiers": final})` where `final` = explicit list validated with the round's `TermRoles` and `self.valid_term` (canonical id or `UNKNOWN_TERM`; `kind is None` → `MODIFIER_NOT_ALLOWED`; repeated → `DUPLICATE_MODIFIER`; layer not supported → `MODIFIERS_NOT_SUPPORTED`), else the span member's modifiers; `choice.term_id` with `kind is not None` → `MODIFIER_AS_FINDING`. `leave_out` + `attach_to`: find the target `cons-…` snapshot in the draft (else `INVALID_RESOLUTION`), add `Modifier(term_id=standalone.term_id, segments=<first mention segments of the standalone member>)` (link when the term is there without segments; same segments → no-op; other segments → `DUPLICATE_MODIFIER`), re-snapshot the target, repoint the target group's decisions to the new version and set their mark's `content_sha256` to `consolidated_content_sha256(new.annotation)`; the S18 group's decisions get `ConsolidationMark(action="leave_out", attached_to=target_id)`. Reopen of a group with `attached_to`: remove the modifier from the target if the target still has exactly that term and segments, then update the target marks' hash again. `take_over_matches` needs no change (kinds already exclude differences); test it.
- [ ] Routes and contract (C8); `client.ts`; typecheck fallout in `frontend/tests/consolidation/fixtures.ts` (`modifiers: []`, `modifier_majority: null`).
- [ ] Browser scenario `modifiers` in `tests/browser_consolidation_scenarios.py` (route query parameter `scenario=modifiers`; default unchanged), two annotators A, B, English text, for example "Recurrent focal seizures. Severe seizures and hypotonia since birth. Bilateral hearing loss. Reduced reflexes.": S4 on "focal seizures" (Focal-onset seizure HP:0007359, A `{Recurrent “Recurrent”}`, B `{Severe}`); S9 on "seizures"/"hypotonia" of the second sentence (A Seizure `{Severe “Severe”}`, Hypotonia `{}`; B the reverse); S1 on "hearing loss" (HP:0000407, both `{Bilateral “Bilateral”}`); S13 on "Reduced reflexes" (HP:0001284, A only, `{Bilateral}`). Expected kinds asserted in the fixture test: S1 `match` (auto), S4 and both S9 groups `modifiers_differ`, S13 `partial`.
- [ ] Green; gate (backend lock); also `uv run pytest tests/test_consolidation_*.py tests/test_document_rows_submissions.py tests/test_agreement_*.py` under the lock. Commits `feat(consolidation): modifiers in grouping and the read view`, `feat(consolidation): resolve modifiers and attach standalone modifiers`, `test(browser): consolidation modifier scenario`.

**Acceptance:** S1–S22 backend tests green; W1 false whenever modifiers or their segments differ; decision hashes of existing data unchanged.

### M3 — T1 import and export of modifiers, Phenopacket check

**Goal:** spec "Import and export", M6, R10 and R12 report counts; S23. **Size M. Review: no (final branch review).** Needs the ontospan 1.2.1 pin (main session, between waves 1 and 2).

**Owns:** `src/ontocurator/exchange/t1.py`, `src/ontocurator/exchange/jobs.py`, `tests/test_t1_modifiers.py` (new), `tests/test_t1_import.py`, `tests/test_t1_export.py`, `tests/t1_builders.py` (conditional).

**Tests that break:** the import test that expects `T1_UNSUPPORTED` for modifiers (`grep -n "T1_UNSUPPORTED" tests/test_t1_*.py`): it now expects acceptance on `hpo-phenotype` layers and `T1_UNSUPPORTED` on `generic` layers.

**Tests to add (`tests/test_t1_modifiers.py`, PostgreSQL where jobs run):**

- import: proposals keep `Modifier(term_id, segments)` (offsets only) on an `hpo-phenotype` layer; a modifier on a `generic` layer → `T1_UNSUPPORTED` `{annotations: [...]}`; a standalone modifier annotation → `T1_INVALID` with ontospan `modifier_as_annotation`; `not_a_modifier` → `T1_INVALID`; duplicate modifier → `T1_INVALID` with `duplicate_modifier`; Frequent and Mild + Severe accepted with `cohort_frequency` / `exclusive_modifier_class` in the import report's warnings; `family_member` experiencer accepted where the profile has it, `T1_UNKNOWN_AXIS_VALUE` where it does not.
- export: S23 — a consolidated finding `{Recurrent, Severe “schwere”}` exports `modifiers: [{term_id: "HP:0012828", segments: [{start, end, text: "schwere"}]}, {term_id: "HP:0031796"}]` with provenance `merged`; Frequent and two severities appear as job warnings and report counts; export → import round trip keeps modifiers and segments.
- Phenopacket: `ontospan.to_phenopacket(unit, ontology)` on an exported unit maps Severe to `severity`, a second severity (Mild) into `modifiers[]`, Neonatal onset to `onset.ontologyClass`, Frequent into `modifiers[]` with `report.frequency_modifiers == 1`; a `family_member` finding is omitted (`report.omitted_family == 1`).

**Steps:**

- [ ] Red.
- [ ] `t1.py`: `_refuse_unrepresentable` (~`:325-336`) refuses modifiers only on layers whose T1 profile is not `hpo-phenotype`; `unit_to_proposals` (~`:392`) maps `item.modifiers` to `Modifier(term_id=m.term_id, segments=_segments(m.segments))`; the export (`ontospan.Annotation(` ~`:731`) passes `modifiers=tuple(ontospan.Modifier(term_id=m.term_id, segments=tuple(<ontospan.Segment with text from the document text>)) for m in snap.annotation.modifiers)` (reuse the segment-with-text builder of `_mentions` ~`:517`).
- [ ] `jobs.py`: `_warnings` (~`:111`) already lists ontospan warnings; add per-code counts to the import and export job results (`warning_counts: {code: n}`) if they are not there yet (check the result dict); `_validate` unchanged.
- [ ] Green; gate (backend lock). Commit `feat(t1): import and export finding modifiers`.

**Acceptance:** round trip keeps modifiers; Phenopacket mapping as specified; reports count cohort and exclusive-class warnings.

### M4 — Editor UI: Modifiers section, attach popover, search roles, link-a-span, marks wiring, convert

**Goal:** spec "Editor" (Modifiers section, Attach to finding 1–8, Display M4 wiring), "Accessibility" (editor parts), acceptance bullets 1–3 and "Two severities" at the finding; the "Turn into modifier…" action of R3 (popover in convert mode + `convert_to_modifier`). **Size L. Review: yes.**

**Owns:** `frontend/src/editor/ModifiersSection.tsx` (new), `frontend/src/editor/AttachPopover.tsx` (new), `frontend/src/editor/useModifierCommands.ts` (new), `frontend/src/editor/modifiers.css` (new, imported by both components), `frontend/src/editor/AnnotationPanel.tsx`, `frontend/src/editor/SearchPanel.tsx`, `frontend/src/editor/searchState.ts`, `frontend/src/editor/TreeBrowser.tsx`, `frontend/src/editor/TermTree.tsx` (if node rendering lives there), `frontend/src/editor/FindingRow.tsx`, `frontend/src/editor/useTermLabels.ts`, `frontend/src/app/CaseScreen.tsx`, `DESIGN.md` (editor rows), tests: `frontend/tests/modifiersSection.test.tsx` (new), `frontend/tests/attachPopover.test.tsx` (new), `frontend/tests/searchPanel.test.tsx`, `frontend/tests/treeBrowser.test.tsx`, `frontend/tests/findingRow.test.tsx`, `frontend/tests/caseScreen.test.tsx`, `frontend/tests/valuesBlock.test.tsx` (conditional), `frontend/browser/modifiers.spec.ts` (new). Conditional: `frontend/tests/annotationPanelStyles.test.ts` (only if a new allowed file must be listed).

**Tests that break:** SearchPanel snapshot/row tests if a role tag appears for `finding` (it must not: tags only for `modifier`/`cohort`).

**Tests to add:**

- `modifiersSection.test.tsx`: `h3` "Modifiers" in `[data-modifiers-section]` under Values; `ul` labelled "Modifiers of Seizure"; chips "Severe · “schwere”", "Recurrent", Frequent chip with "Cohort term" text in `warning` style class; "Two severities" line for Mild + Severe; chip menu button "Actions, Severe" with "Link a text span…" (no span) / "Change text span…" (span), "Remove text span" (span only), "Remove modifier"; "+ Add modifier…" opens the search in modifier mode (label "Search modifier", placeholder "Severity, onset, pattern…", empty query, request `within: ["HP:0012823", "HP:0040279"]`); Enter adds (`add_modifier` without segments), focus returns to "+ Add modifier…", polite status "Added Severe to Seizure. Link a text span?" with action "Link a text span"; remove → Undo toast "Removed Severe from Seizure" and Ctrl+Z restores (`add_modifier` with the old segments); read-only shows chips without actions.
- `attachPopover.test.tsx`: `role="dialog"` named "Attach Severe to a finding", non-modal; radio group "Finding" with options "Seizure · “Krampfanfälle”", nearest preselected and focused; Enter = Attach (`onAttach(annotationId)`), Esc = Discard; "Other finding…" expands every finding (incl. spanless) with a filter field "Filter findings"; none in the sentence → "No finding in this sentence.", "Other finding…" expanded, Attach `aria-disabled` with reason "Choose a finding first." (`aria-describedby`); no finding at all → "Severe is a modifier. Create the finding first, then add Severe under Modifiers." and only "OK"; already has Severe without span → button "Link “schwere” to Severe"; with another span → line "Seizure already has Severe (“sehr schwere”). Attaching replaces its text span." and button "Replace text span"; convert mode (R3) title "Turn Severe into a modifier", primary "Turn into modifier", the source finding excluded from the options; axe has no violations (`vitest-axe` or the project's axe helper if one exists; else covered in the browser test).
- `searchPanel.test.tsx`: hits with `role: "modifier"` show the tag "Modifier", `cohort` "Cohort term" (text, not colour only); with `assignMode="change"` modifier hits are `aria-disabled` with "Modifier — add it under Modifiers instead." and Enter skips them; modifier mode passes `within` to the search request.
- `treeBrowser.test.tsx`: nodes with `role` `modifier` are `aria-disabled` for "Change term" with the same reason.
- `findingRow.test.tsx`: muted second line "Severe · Recurrent" (D-d order).
- `caseScreen.test.tsx`: (1) new mark → Enter on a modifier hit opens the popover (no `create_annotation`), Enter sends `add_modifier` with the mark segment to the preselected finding, the finding is selected, chip focused, status "Attached Severe to Seizure"; (2) Discard drops the mark and focuses the text after it; (3) link-a-span mode: status "Select the text for Severe, then press Enter. Esc cancels.", a selection sends `set_modifier_segments`, Esc returns focus to the chip; (4) hovering or focusing a finding row passes its mention and modifier display ids as `framedIds`; hovering a modifier run frames its finding; clicking a modifier run selects the finding and focuses the chip; (5) "Change term" never offers a modifier term; (6) a standalone modifier finding shows the notice "Severe is a modifier. Turn it into a modifier of another finding." with "Turn into modifier…", which opens the popover in convert mode and sends `convert_to_modifier` with `link_span: true`.
- `browser/modifiers.spec.ts` (port 18775; scenario of M1 with `with_finding=1`): mark "schwere" with `selectText` → prefilled search shows Severe with "Modifier" → Enter → popover with Seizure preselected → Enter: two keys after marking; chip "Severe · “schwere”" focused; hover the Seizure mark → the "schwere" run has `run--framed`, no layout shift (bounding boxes of the text block unchanged); "+ Add modifier…" with "Frequent" shows "Cohort term"; Mild + Severe show "Two severities"; axe on the popover and the Modifiers section; scenario `standalone=1`: "Turn into modifier…" flow. Evidence screenshot `modifiers-attach.png`.

**Steps:**

- [ ] Red.
- [ ] `useTermLabels.ts`: keep `role` and `exclusive_class` of `TermLabel` and expose `termInfo(termId): TermInfo | undefined` (C10).
- [ ] `searchState.ts`: `SearchContext.within?: string[]`, sent in the request when set. `SearchPanel.tsx`: props `mode?: "finding" | "modifier"` (modifier: label "Search modifier", placeholder "Severity, onset, pattern…", `within = MODIFIER_ROOTS`, a frontend constant `["HP:0012823", "HP:0040279"]` exported from `editor/modifiers.ts`), `assignMode?: "new" | "change" | "modifier"`; role tags in `.candidate-header` (`<span className="candidate-role">Modifier</span>` / "Cohort term", tokens only, no `style`); in "change" mode a modifier hit is not usable (`isUsable` false, the reason line as text). New-mark mode keeps modifier hits usable but reports them through `onPickModifier(candidate)` instead of assigning.
- [ ] `ModifiersSection.tsx` (props: `finding`, `modifiers`, `text`, `termInfo`, `readOnly`, `onAdd(termId)`, `onLinkSpan(termId)`, `onRemoveSpan(termId)`, `onRemove(termId)`, `searchProps`), using `chipText`, `exclusiveWarnings`, `sortByLabel`; menu via the existing `ui` menu/popover component (check `frontend/src/ui` for a menu button; reuse it). Rendered by `AnnotationPanel.tsx` between the Values block and "Mentions (n)" only when the finding's layer is in `view.modifier_layer_ids` (prop `modifiersSupported`).
- [ ] `AttachPopover.tsx` (props: `termLabel`, `markQuote`, `candidates: AttachCandidate[]`, `allFindings: AttachFinding[]`, `existing(annotationId) → { segmentsQuote: string | null } | undefined`, `mode: "attach" | "convert"`, `anchor`, `onAttach(annotationId)`, `onDiscard()`), anchored at the mark like AP's `PendingMarkBar` (reuse its positioning helper if exported; else position from the mark's `getBoundingClientRect` inside the text element, flip above near the bottom).
- [ ] `useModifierCommands.ts`: wraps `add_modifier`, `set_modifier_segments`, `remove_modifier`, `convert_to_modifier` through the existing command queue (same envelope helper as `set_axes`), the Undo toast, the link-a-span mode state (`{ annotationId, termId } | null`) and status texts.
- [ ] `CaseScreen.tsx` wiring: pending mark + modifier hit (`onPickModifier` on the pending `SearchPanel` ~`:3227-3233`) → popover with `attachCandidates(view.document.text, mark, ownEditableFindings)`; Attach → `add_modifier` then select the finding, focus its chip; Discard → AP's `discardPending()`; selection callback while link-a-span mode is on → `set_modifier_segments` instead of a new mark; `mentionsDisplay` (~`:492`) gets `modifierMarks(...)` appended and the finding marks' `label` gets `findingDescription(...)`; `framedIds` from hovered/focused/selected finding (mention ids + its modifier display ids) and from a hovered modifier run (its finding's mention ids); `onPick` with a modifier display id selects the finding and focuses the chip; "Change term" `SearchPanel` gets `assignMode="change"`; `TreeBrowser` gets the same rule; R3 notice and convert flow for snapshots whose `termInfo(term).role !== "finding"`.
- [ ] `FindingRow.tsx`: second line (muted) with the modifier labels.
- [ ] DESIGN.md: rows "Modifiers section (`editor/ModifiersSection.tsx`)" and "Attach popover (`editor/AttachPopover.tsx`)" with the spec copy, states, focus rules, forced colours; "Term search" row: role tags and disabled modifier hits in "Change term".
- [ ] Green (unit); browser batches under the lock (port 18775): `modifiers.spec.ts annotation-loop.spec.ts spans.spec.ts tree.spec.ts values-block.spec.ts editor-layout.spec.ts`.
- [ ] Commits `feat(editor): modifiers section`, `feat(editor): attach a modifier to a finding`, `feat(editor): modifier marks and hover framing`, `feat(editor): turn a standalone modifier into a modifier`, `docs(design): modifier rows`. Gate.

**Acceptance:** spec acceptance bullets 1–3 (two keys after marking; "+ Add modifier…" only modifier subtrees with "Cohort term"; creating a finding with a modifier term impossible through the UI); "Two severities" at the finding; no layout shift on hover.

### M5 — Consolidation UI: Modifiers row, union, sub-rows, cross links, standalone card

**Goal:** spec "Consolidation > Frontend", S1–S23 UI behaviour, M5, M9, R12 option warning, acceptance "5 consolidator clicks" (S1, S4, S9 ×2, S13); summary dialog warnings (D-f). **Size L. Review: yes.**

**Owns:** `frontend/src/consolidation/GroupCard.tsx`, `groupModel.ts`, `consolidationText.ts`, `TextPane.tsx`, `lanes.ts`, `ConsolidationScreen.tsx`, `GroupList.tsx`, `SummaryDialog.tsx`, `useConsolidation.ts`, `TermPicker.tsx` (Edit values… modifier search), `consolidation.css`, `modifierSets.ts` (fixes only), `frontend/tests/consolidation/*`, `frontend/tests/consolidationEditor.test.tsx`, `frontend/tests/leadConsolidation.test.tsx`, `frontend/browser/consolidation-modifiers.spec.ts` (new), `frontend/browser/consolidation.spec.ts` and `consolidation-a11y.spec.ts` (conditional), `DESIGN.md` (consolidation rows).

**Tests to add:**

- `tests/consolidation/groupCard.test.tsx`: table row "Modifiers" only when a member has modifiers, each person's `setText` or "None", "· differs" word for `modifiers_differ`; S6 "Severe (no text)".
- `tests/consolidation/model.test.ts`: `rowsOf` adds row id `modifiers` (label "Modifiers") with options from `modifierSetOptions`, no preselection, "(2 of 3)" label, "Two severities" warning text on the union of S16; sub-row "Text of Severe" appears only after the union option is chosen and has the conflicting lists with names; `choosePayload` sends `choice.modifiers` (resolved union or the chosen set; segments as `{start, end}`) whenever a Modifiers row exists; `KIND_LABELS` gains `modifiers_differ: "modifiers differ"`, `modifier_as_finding: "modifier used as a finding"`; `choiceSummary` names the modifier choice ("Severe, Recurrent (both)"); S11 term choice then a Modifiers row comparing all members, "Keep both" sends `keep_both` without a Modifiers row.
- `tests/consolidation/screen.test.tsx`: cross-link hint "Ben Roth linked “schwere” (Severe) to Hypotonia." is a link that selects that group; S18 card text "Ana Weber marked a modifier as a finding. Severe can only describe another finding." with "Attach to a finding…" (resolved findings of the round in the same sentence, nearest first, via `attachCandidates`) and "Leave out"; attach sends `leave_out` with `attach_to`; "Edit values…" shows the Modifiers section with chips and "+ Add modifier…" (search `within` the modifier roots); text pane draws members' modifier segments in their lanes with the `run--modifier` stroke class and frames them for the selected group; `SummaryDialog` with modifier warnings shows the D-f line and checkbox label.
- `browser/consolidation-modifiers.spec.ts` (port 18774; M2's `modifiers` scenario): open → S1 kept automatically → S4: choose "Both: …" → S9 Seizure: choose Ana's → S9 Hypotonia: choose Ben's (hint visible and linked) → S13 keep → Submit; count user clicks from opening to "submitted" = 5 (if the existing flow needs more, e.g. the summary dialog's Submit, record the real count and report; do not change the flow outside modifiers); axe on a group card with a Modifiers row. Evidence `consolidation-modifiers.png`.

**Steps:**

- [ ] Red; implement with `modifierSets.ts` (E1) mapped from `ConsolidationMemberView.modifiers` (`MemberSet.personName` from `lanes.personName`); `useConsolidation.axisWarningOf` keeps rule counts (`axis` vs modifier rules) for the summary dialog.
- [ ] DESIGN.md "Consolidation view" rows: Modifiers row, sub-row, cross-link hint, standalone card, lanes stroke.
- [ ] Green; browser (port 18774): `consolidation-modifiers.spec.ts consolidation.spec.ts consolidation-a11y.spec.ts final-workflow.spec.ts`. Commits `feat(consolidation): modifiers row and union`, `feat(consolidation): attach a standalone modifier`, `docs(design): consolidation modifier rows`. Gate.

**Acceptance:** scenario UI behaviour per S1–S22; no computed majority set; five clicks (or the reported real count).

### M7 — Submit check: modifier open items and warnings

**Goal:** spec "Open items (submit check)", R3 (blocking item), R10, R12 (warnings in the submit list), acceptance "A finding with Mild and Severe … submit is not blocked"; D-f copy. **Size M. Review: no.**

**Owns:** `frontend/src/editor/openItems.ts`, `frontend/src/editor/SubmitCaseDialog.tsx`, `frontend/src/editor/UnconfirmedValuesSection.tsx` (only if the acknowledgement block moves), `frontend/src/editor/ModifierWarningsSection.tsx` (new), `frontend/src/editor/unconfirmedValues.ts`, `frontend/src/editor/submitDialog.css`, `frontend/src/app/CaseScreen.tsx`, tests: `frontend/tests/openItems.test.ts`, `frontend/tests/submitDialog.test.tsx`, `frontend/tests/unconfirmedValues.test.ts`, `frontend/tests/caseScreen.test.tsx`, `frontend/browser/modifier-submit.spec.ts` (new).

**Tests to add:**

- `openItems.test.ts`: kinds `modifier-as-finding` (blocking, line "Severe is a modifier. Turn it into a modifier of another finding.", focus `[data-turn-into-modifier]`), `cohort-modifier` (warning, line "Frequent is a cohort term."), `exclusive-modifiers` (warning, line "Two severities: Mild, Severe."); `summaryLine` phrases "1 finding uses a modifier term" / "1 finding has a cohort term as modifier" / "1 finding has two modifiers of one kind"; `submitBlockedReason` "Turn 1 modifier used as a finding into a modifier before submitting." (plural "Turn 2 modifiers used as findings into modifiers before submitting."), before the values reason.
- `submitDialog.test.tsx`: section `h3` "Modifier warnings · {m}" listing rows "{term}: {line}" with "Go to {term}"; the acknowledgement checkbox label per D-f; blocked reason with that label; the blocking item listed in the generic list with "Go to".
- `unconfirmedValues.test.ts` / `caseScreen.test.tsx`: `submissionAxisWarning` keeps every warning as a pair key (`axis:<id>`, `cohort:<term>`, `exclusive:<class>`); the D1 single resend compares the full set (axis rows + client-computed modifier warnings); a server warning set with an extra modifier pair does not resend and shows "The unconfirmed values changed. Check the list again."; submit with only modifier warnings and the box ticked submits with the acknowledgement (two requests, one user action).
- `browser/modifier-submit.spec.ts` (port 18775; M1 scenario): Mild + Severe on Seizure → Submit lists "Two severities" → tick the box → submitted; Frequent → "Cohort term as modifier" listed; standalone scenario: Submit blocked with the reason, "Go to Severe" focuses "Turn into modifier…".

**Steps:**

- [ ] Red; implement; client-side warnings computed from the draft with `termInfo` (`kind`, `exclusive_class`) so the set matches the server's `cohort_modifier` / `exclusive_modifier_class` warnings.
- [ ] Hand back the final copy and DOM facts for DESIGN.md (the M5 review-fix agent writes the row "Submit dialog: modifier warnings").
- [ ] Green; browser (port 18775): `modifier-submit.spec.ts submit-unconfirmed.spec.ts decision-semantics.spec.ts`. Commit `feat(submit): modifier warnings and the modifier-as-finding item`. Gate.

**Acceptance:** "Two severities" in the submit list, never blocking; standalone modifier blocks with a path to fix it.

## Between-wave steps (main session)

- **After wave 1:** with the user's OK from Step 0: `git -C C:/Users/jan-p/Development/ontospan/.worktrees/modifier-checks push -u origin feat/modifier-checks` and `git -C C:/Users/jan-p/Development/ontospan/.worktrees/modifier-checks push origin v1.2.1`; in Ontocurator replace the commit in `pyproject.toml` (`ontospan @ git+https://github.com/janpower/ontospan.git@<O1 full sha>`), `uv lock`, `uv sync`, run `WP=pin bash …/build/with-lock.sh backend uv run pytest tests/test_t1_export.py tests/test_t1_import.py tests/test_t1_mapping.py -q`, commit `build(deps): ontospan 1.2.1` with `pyproject.toml uv.lock`. Do not open an ontospan PR (not asked).
- **After wave 2:** M1 review → fix agent; dispatch wave 3 when committed.
- **After wave 3:** M2 and M4 reviews in parallel → one fix agent each (disjoint Owns); dispatch wave 4 when both are committed.
- **After wave 4:** M5 review → one fix agent (also writes M7's DESIGN.md row from M7's hand-back, commit `docs(design): submit modifier warnings`).

## Final phase (main session)

- [ ] Every WP and review fix committed; `git status` clean; stale locks removed.
- [ ] One `superpowers:code-reviewer` pass over `git diff main...feat/modifiers` against the spec (focus: hash compatibility, refusal codes, classifier caching and the process-wide source, `within` filter before the cut, grouping kinds vs W1 and take-over, attach/reopen consistency, T1 round trip, attach popover keyboard/a11y, U-rule). Findings to `C:/Users/jan-p/Development/ontocurator-reviews/2026-10-21-modifiers-branch-claude.md`.
- [ ] One fix agent (effort medium) applies the findings, TDD, commits.
- [ ] Full gate alone on the machine: `CHECK_PYTEST_WORKERS=4 CHECK_VITEST_WORKERS=3 HPO_E2E_PORT=18777 bash scripts/check.sh` (no `CHECK_CONTAINERS`). Failures go to the same fix agent.
- [ ] Rebuild the embedded bundle: `npm --prefix frontend run build`; replace `src/ontocurator/web/index.html` and the `index-*.js`/`index-*.css` in `src/ontocurator/web/assets/` with `frontend/dist/` (remove superseded `index-*` files); `bash scripts/check.sh --only static`; commit `build: update embedded frontend bundle`.
- [ ] **No fast-forward of main.** Report to the user (German, short): commits, gate result, open points, the plan decisions D-a…D-g, and ask: "Darf ich `feat/modifiers` nach GitHub pushen und einen PR gegen `main` öffnen?" Only after a yes: `git -C C:/Users/jan-p/Development/ontocurator/.worktrees/modifiers push -u origin feat/modifiers` and `gh pr create --base main --head feat/modifiers --title "Finding modifiers and family-member experiencer" --body-file <body>` (body: summary, spec link, test evidence; no AI attribution line, no GitHub Actions — the gate ran locally).

## Self-review against the spec

| Spec item                                                                        | WP                                                     |
| -------------------------------------------------------------------------------- | ------------------------------------------------------ |
| M1, R1 data model, R11 hash, `snapshot()` bounds, overlap rules                  | M1                                                     |
| M2, R2, R10, R12 validation table, classifier cache                              | M1 (O1 for ontospan)                                   |
| R3 refusals (create, set_term, adoption), submit rule, open item, group kind     | M1, M7, G1/M2, M4 (convert)                            |
| Editing commands incl. `convert_to_modifier`, contract                           | M1                                                     |
| Search `within`, `role`, seeds, browse, stored event                             | M1                                                     |
| Editor Modifiers section, attach popover 1–8, link-a-span                        | M4 (E1 pure ranking)                                   |
| Display M4 (double underline, framing, colour slot, a11y)                        | E1 (marks), M4 (wiring)                                |
| Open items (three kinds)                                                         | M7                                                     |
| `Finding` fields, `groups()` kinds, majority (M9), W1                            | G1, M2                                                 |
| Consolidation backend read/resolve/attach_to/reopen/edited (S1–S22)              | M2                                                     |
| Consolidation frontend (row, union U-rule, sub-row, hints, card, lanes, summary) | E1 (pure), M5                                          |
| T1 import/export, Phenopacket test (M6, S23)                                     | M3, O1                                                 |
| Experiencer `family_member` (M7, M11)                                            | F1                                                     |
| Final panel copy                                                                 | E1 (WP M6 of the spec)                                 |
| Text versions R9                                                                 | M1                                                     |
| Fixture ontology + German label                                                  | F0                                                     |
| Accessibility (popover, chips, marks, consolidation)                             | M4, M5, E1                                             |
| Acceptance bullets                                                               | M4 (1–3), M1 (4), M2/M5 (5), M3 (6), F1 (7), M4/M7 (8) |
| Separate PR, no GitHub Actions                                                   | Final phase                                            |
