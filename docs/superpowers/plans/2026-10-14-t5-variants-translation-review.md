# T5: Document Variants and Translation Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Lean format: files, interfaces, tables, test cases and acceptance criteria per task. Implementers write the code test-first; code appears only where it defines a contract.

**Goal of Part 1:**
- One case can exist in several languages and text versions. Each version is a document variant with its origin, its source and, for translations, the translation run and its automatic checks.
- Translations and text versions are imported in ontospan format 1.1, with a translation status derived from the checks.
- A translation is reviewed in its own task. The decision table is enforced on the server, the review is an immutable record, and an accepted correction becomes a new variant.
- A translation can be annotated only after its review is accepted (project option, default on).
- Annotations on an old text version are carried over to a corrected version where the text did not change.
- Review records are exported as generic JSONL.

**Architecture of Part 1:**
- **Format (ontospan 1.1, D-aa):** optional `case_id`, `variant` and `translation` on the document, and the optional manifest `release` block (T7 I7). Task 1 builds this in the ontospan repository; Ontocurator re-pins.
- **Data (D-o):** a variant is a `documents` row. `document_id` is the internal variant id; `external_id` keeps the T1 `document_id`. Drafts, submissions, edit events, assignments and proposals keep working per variant without change.
- **Import:** T3a's pure `plan_import` (D-r) learns variants: cases, `derived_from` by text hash, version rules, translation status and the lead's override.
- **Viewing (V3):** `authz/versions.py::visible_annotation_versions` is the single place that decides which annotation versions a user may open (U2).
- **Review:** a pure decision-table validator (`domain/translation_review.py`), an autosaved draft (D-v), an append-only `translation_reviews` record and status transitions.
- **Re-anchoring (V2, D-w):** a pure code-point mapping plus the `reanchor` job, which writes a proposal set with `origin = 'reanchor'` and a "needs review" list.
- **Export (D-z):** the `translation_review_export` job writes `ontocurator-translation-review/v1` JSONL.

**Spec:** `docs/superpowers/specs/2026-10-14-t5-variants-translation-review-design.md` (V1–V6), T7 I2 and I7 (`…-t7-integrations-design.md`), T3 A2 and A4. Index with shared contracts, D-o…D-aa and Q15–Q26: `docs/superpowers/plans/2026-10-14-t3-t5-t4-index.md`. Builds on T3b.

**Branch / worktree:** `feat/t5-variants-review` from `feat/t3b-admin-ui`, worktree `.worktrees/t5-variants-review`. Task 1 additionally works in the ontospan repository on `feat/format-1-1` (worktree `../ontospan/.worktrees/format-1-1`). Baseline: `scripts/check.sh`.

**Commit rule:** per task, `uv run ruff check --fix src tests && uv run ruff format src tests && uv run mypy src`, then one conventional commit without AI attribution. In ontospan: `uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run pytest -q`.

**T3a names:** this plan refers to T3a modules by role (`plan_import` in `exchange/plan.py`, `AssignmentService`, `propose_distribution`, the upload, assignment, profile, admin-user and export routes). If T3a chose other file names, extend those files; the interfaces named here are what matters.

**Shared test helper (create in Task 3, used throughout):** `tests/t1_builders.py` with
- `native_unit(external_id, language, text, *, case_id=None, annotations=()) -> ontospan.AnnotatedDocument`;
- `translation_unit(external_id, language, text, *, source: AnnotatedDocument, checks=(("units_added", True),), provider="test-mt", model="m1", run_id="run-1", origin="machine_translation")`;
- `correction_unit(previous: AnnotatedDocument, text, *, version=None)`;
- `bundle(tmp_path, units) -> Path` (calls `ontospan.write_bundle`).

All units use the HP fixture layer of `tests/fixtures/hp.json` and an empty or tool-authored set (tool actor `name="test-tool"`, `version="1"`).

---

## Part 1: Backend (Tasks 1–8)

### Task 1: ontospan format 1.1 (variants and the release block)

Work in the ontospan repository: `git -C ../ontospan worktree add .worktrees/format-1-1 -b feat/format-1-1 main`. The frozen 1.0 schema files must stay byte-identical.

**Modify** `src/ontospan/models.py`, `bundle.py`, `validate.py`, `schema_export.py` (no logic change, it generates 1.1 now), `_version.py`, `pyproject.toml`, `__init__.py`, `README.md`, `CHANGELOG.md` (create if missing).

**Models (the contract):**

```python
VariantOrigin = Literal[
    "native", "machine_translation", "human_translation", "correction"
]


class Variant(_Model):
    version: int = Field(ge=1)
    origin: VariantOrigin
    derived_from: str | None = Field(
        default=None, pattern=SHA256
    )  # text_sha256 of the source / previous version


class TranslationCheck(_Model):
    code: str = Field(min_length=1)
    passed: bool
    detail: str | None = None


class Translation(_Model):
    provider: str = Field(min_length=1)
    model: str | None = None
    run_id: str | None = None
    recipe: str | None = None
    checks: tuple[TranslationCheck, ...] = ()


class Document(_Model):  # existing fields unchanged, plus:
    case_id: str | None = Field(default=None, min_length=1)
    variant: Variant | None = None
    translation: Translation | None = None


class Producer(_Model):
    name: str = Field(min_length=1)
    version: str = Field(min_length=1)


class SupersededRelease(_Model):
    bundle_id: str = Field(min_length=1)
    manifest_sha256: str = Field(pattern=SHA256)


class ReleaseInfo(_Model):
    name: str = Field(min_length=1)
    description: str | None = None
    project_id: str | None = None
    producer: Producer | None = None
    supersedes: tuple[SupersededRelease, ...] = ()


class Manifest(_Model):  # existing fields unchanged, plus:
    release: ReleaseInfo | None = None
```

Export the new names from `ontospan/__init__.py` (`Variant`, `VariantOrigin`, `Translation`, `TranslationCheck`, `ReleaseInfo`, `Producer`, `SupersededRelease`).

**Versions:** `SCHEMA_VERSION = "1.1.0"`, package version `1.1.0` (`_version.py` and `pyproject.toml`). `python -m ontospan.schema_export` writes `annotated-document-1.1.json`, `bundle-manifest-1.1.json` and `hpo-phenotype-annotation-1.1.json`; the three 1.0 files are not touched.

**Validation rules** (`validate._check_variant(unit, report)`, called from `_check_content`; codes are the contract):

| Rule | Code | Level |
|---|---|---|
| `origin` is `machine_translation`, `human_translation` or `correction` and `derived_from` is missing | `variant_derived_from_missing` | error |
| `origin == "native"` with `derived_from` set, or with `version != 1` | `variant_native_invalid` | error |
| `origin == "correction"` with `version < 2` | `variant_version_invalid` | error |
| `derived_from == document.text_sha256` | `variant_self_reference` | error |
| `translation` set and `origin` not a translation | `translation_unexpected` | error |
| `origin` is a translation and `translation` missing | `translation_missing` | warning (a human translation may have no run data) |

**Bundle rules** (`bundle.py`):
- `write_bundle(target, units, *, bundle_id, created_at, release_name=None, contributors=(), release: ReleaseInfo | None = None) -> Manifest`. If `release` is given and `release_name` is None, `release_name = release.name`.
- Reading and writing: `release_name` and `release.name` both set and different → error `release_name_mismatch`.
- Two units with the same `document_id`, language and `variant.version` but different `text_sha256` → error `variant_duplicate`. Resolving `derived_from` across units is **not** ontospan's job (the source may live in the consumer's project); the README says so.

**Tests (ontospan):**
- `tests/test_variants.py`:
  - `test_a_translation_unit_round_trips` (dump, `load_annotated_document`, equal; `validate` OK);
  - `test_variant_rules` parametrised over the six table rows, asserting the code and level;
  - `test_units_without_variant_stay_valid_1_0` (a 1.0 unit validates against the frozen 1.0 schema).
- `tests/test_bundle.py`:
  - `test_the_release_block_round_trips` (`write_bundle(..., release=…)`, `read_bundle` gives an equal `release` and `release_name == release.name`);
  - `test_release_name_must_match_the_release_block`;
  - `test_duplicate_variant_versions_are_refused`.
- `tests/test_schema_export.py::test_frozen_1_0_schemas_are_unchanged`: the SHA-256 of each 1.0 file equals the value recorded in the test (taken from `main` before the change).
- **Newer-minor tests move up one minor:** `tests/conformance_cases.py`, `tests/test_validate.py` and `tests/test_bundle.py` use `"1.2.0"` (and `"1.2.3"`) where they used `"1.1.0"` / `"1.1.3"`; regenerate `conformance/valid/newer-minor.json` with `uv run python tests/conformance_cases.py` (or the existing generator command named in the README).
- **Conformance fixtures:** valid `variant-translation.json`, `variant-correction.json`; invalid `variant-missing-derived-from.json`, `translation-on-native.json`; one bundle manifest case `invalid/manifest-release-name-mismatch.json`; entries in `conformance/cases.json`.

**Release of the change:** open a PR in ontospan and stop. **Merging and pushing ontospan needs the user's confirmation** (index: nothing is pushed without it). Continue with Task 2 only after the user has merged the PR on `main`.

**Ontocurator re-pin (after the merge):**
- `uv add "ontospan @ git+https://github.com/janpower/ontospan.git@<full 40-character merge hash>"` (index D-n pattern; take the hash with `git -C ../ontospan rev-parse origin/main`).
- `uv run python -c "import ontospan; assert ontospan.SCHEMA_VERSION == '1.1.0'"`.
- The T2d exports now declare `1.1.0`; `uv run pytest tests/test_t1_export.py tests/test_t1_import.py -q` passes unchanged, and a 1.0 bundle still imports (`test_a_1_0_bundle_still_imports`, new, in `tests/test_t1_import.py`).

**Acceptance:**
- In ontospan: `uv run python -m ontospan.schema_export --check && uv run pytest -q && uv run ruff check . && uv run mypy src`.
- In Ontocurator: `uv run pytest tests/test_t1_import.py tests/test_t1_export.py -q`.
- Commits: ontospan `feat: format 1.1 with document variants, translations and release metadata`; Ontocurator `build: pin ontospan 1.1`.

---

### Task 2: Variant tables (migration 0006)

**Modify** `storage/tables.py`, `authz/policy.py`, `tests/test_policy.py`; **create** `storage/migrations/versions/0006_variants.py`. Add `"translation_reviews"` to `APPEND_ONLY_TABLES`.

| Table / change | Columns | Keys / checks |
|---|---|---|
| `documents` + | `case_id` text NOT NULL; `external_id` text NOT NULL; `version` int NOT NULL default 1; `origin` text NOT NULL default 'native'; `derived_from` text null; `translation` jsonb null; `translation_status` text null; `status_reason` text null | CHECK `version >= 1`; CHECK `origin IN ('native','machine_translation','human_translation','correction')` (`ck_documents_origin`); CHECK `translation_status IN ('translated','automatic_check_failed','ready_for_review','reviewed','accepted')` (`ck_documents_translation_status`); CHECK `origin NOT IN ('machine_translation','human_translation') OR translation_status IS NOT NULL`; FK (project_id, derived_from) → documents (project_id, document_id); UNIQUE (project_id, external_id, language, version) `uq_documents_variant`; ix (project_id, case_id) |
| `users` + | `qualification` text null | |
| `projects` + | `annotate_accepted_translations_only` bool NOT NULL default true | |
| `translation_reviews` (append-only) | `id` bigint identity; `project_id` → projects; `document_id` text (the reviewed variant); `assignment_id` → assignments; `reviewer_user_id` → users; `reviewer_pseudonym` text; `reviewer_qualification` text; `reviewer_languages` jsonb; `decision` text; `clinical_change` bool; `categories` jsonb default '[]'; `rationale` text null; `machine_text_sha256` text; `proposed_text` text; `proposed_text_sha256` text; `status_before` text; `status_after` text; `created_variant_id` text null; `review_policy` text; `created_at` default now() | PK id; CHECK `decision IN ('accepted_unchanged','accepted_corrected','query','rejected')`; FK (project_id, document_id) → documents; ix (project_id, document_id, id) |
| `translation_review_drafts` | `assignment_id` → assignments; `text` text; `form` jsonb default '{}'; `revision` int default 0; `updated_at` default now(); `updated_by` → users null | PK assignment_id |
| `proposal_sets` + | `origin` text NOT NULL default 'import'; `pending_items` jsonb NOT NULL default '[]'; `source_sha256` becomes nullable (`ALTER COLUMN … DROP NOT NULL`; re-anchored sets have no file) | CHECK `origin IN ('import','reanchor')` |
| `assignments` | replace `ck_assignments_task` with `task IN ('annotate','review','translation_review')` | |

**Backfill (in the migration):** `UPDATE documents SET case_id = document_id, external_id = document_id` before the `NOT NULL`; `version` and `origin` take their defaults. Existing documents become cases with one native variant (V4).

**Grants:** `SELECT, INSERT` on `translation_reviews`; full DML on `translation_review_drafts`. The new `ALTER`s on the append-only `proposal_sets` run as the owner and do not fire its row triggers.

**Policy:** `Action.OVERRIDE_TRANSLATION_STATUS` (admin and lead yes; others no). Extend the literal expected-matrix in `test_every_role_and_action`.

**Domain:** `src/ontocurator/domain/variants.py`:
- `VariantOrigin`, `TranslationStatus` (the five values) as `Literal`s;
- `TRANSLATION_ORIGINS = frozenset({"machine_translation", "human_translation"})`;
- `@dataclass(frozen=True) class VariantInfo(document_id, case_id, external_id, language, version, origin, derived_from, translation: dict | None, translation_status, status_reason, text_sha256)`;
- `is_translation_chain(variant, lookup) -> bool`: true for a translation, and for a correction whose `derived_from` chain reaches a translation.

**Repository** (scoped in `ScopedRepository`; add each to the method enumeration test): `get_variant(key, document_id) -> VariantInfo`, `list_variants(key, *, case_id=None) -> list[VariantInfo]`, `find_variants_by_text_sha256(key, sha) -> list[VariantInfo]`.

**Tests:**
- `tests/test_schema.py`: the mapping/migration comparison passes; the append-only parametrisation covers `translation_reviews` (3 more cases).
- `tests/test_variants_storage.py`:
  - `test_existing_documents_become_native_variants`: a database with documents migrated to `0005`, then upgraded, has `case_id == external_id == document_id`, version 1, origin `native` (use the `unmigrated_database_url` helper of T2e Task 1 with `upgrade(cfg, "0005")`);
  - `test_a_translation_needs_a_status`: inserting a `machine_translation` row without status violates the CHECK;
  - `test_variant_identity_is_unique_per_language_and_version`;
  - `test_the_application_cannot_rewrite_reviews`: `UPDATE translation_reviews` fails with "permission denied".

**Acceptance:** `uv run pytest tests/test_schema.py tests/test_policy.py tests/test_variants_storage.py -q`. Commit: `feat(variants): document variants, translation review tables and the annotation gate option`.

---

### Task 3: Variant import (T7 I2, T7d)

**Modify** `src/ontocurator/exchange/plan.py` (T3a's `plan_import`), `exchange/t1.py`, `exchange/jobs.py` (`upload_commit`, `t1_import`), `api/upload_routes.py` (T3a), `cli.py`; **create** `tests/t1_builders.py`, `tests/test_variant_import.py`.

**`ImportPlan` additions** (each planned document gets a `PlannedVariant`; the preview JSON lists them in a `variants` table):

```python
@dataclass(frozen=True)
class PlannedVariant:
    document_id: str  # internal id (D-o)
    external_id: str
    language: str
    case_id: str
    version: int
    origin: VariantOrigin
    derived_from: str | None  # internal id of the source / previous version
    derived_in_upload: bool  # the source arrives in the same upload
    translation: dict | None  # the 1.1 translation object as delivered
    status: TranslationStatus | None
    failed_checks: tuple[str, ...]
```

**Planning rules** (in this order; every refusal names the unit by external id, language and version):
1. A unit without `variant` is native version 1.
2. **`derived_from`** is a text hash. It is resolved first among the upload's units, then among the project's variants (`find_variants_by_text_sha256`). With several project matches, the one with the same `case_id` wins; otherwise `VARIANT_SOURCE_AMBIGUOUS`. No match: `VARIANT_SOURCE_UNKNOWN`.
3. **`case_id`:** the unit's `case_id`; otherwise the case of its source; otherwise the external id. A unit whose `case_id` differs from its source's case is `VARIANT_CASE_MISMATCH`.
4. **Collisions** (T3 A1 extended, T7 I2):
   - same `(external_id, language, version)` and same text: skipped as identical (as in T3);
   - same `(external_id, language, version)` and different text: `DOCUMENT_CONFLICT` (as in T3);
   - same `(external_id, language)`, different text and a higher `version`: accepted only if `origin == "correction"` and `derived_from` resolves to the variant with `version - 1` of the same external id and language; otherwise `VARIANT_VERSION_INVALID`.
5. **Internal id (D-o):** the external id itself if no variant in the project or earlier in the upload uses it; otherwise `f"{external_id}~{language}~v{version}"`. If that id is taken too: `VARIANT_ID_COLLISION`.
6. **Order:** planned documents are topologically sorted so that sources are inserted before derived variants (`derived_from` FK).
7. **Translation status (I2):** for a translation, `automatic_check_failed` if any check has `passed: false`, otherwise `ready_for_review`. A correction in a translation chain gets `ready_for_review`. Native variants and corrections of native texts have no status.
8. Cross-language projection is never planned (V2): proposals in a translation unit are imported as that variant's own proposals only.

**Lead override (I2):** the commit request of T3a gains `status_overrides: list[{external_id, language, version, reason}]`; the CLI `admin import` gains `--accept-translation EXTERNAL_ID:LANG:VERSION=REASON` (repeatable).
- Each override must name a planned translation variant (`OVERRIDE_NOT_APPLICABLE`) and carry a non-blank reason (`OVERRIDE_REASON_REQUIRED`). The user needs `OVERRIDE_TRANSLATION_STATUS` (`NOT_ALLOWED`).
- The variant is stored with `translation_status = 'accepted'` and `status_reason = reason`. Each override is audited as `variant.status_override` with `{document_id, from, to: "accepted", reason}`.
- The overrides are part of the commit request, not of the plan hash; the re-plan at commit (D-r) checks them again.

**Storing:** `add_documents_and_proposals` writes the variant columns. A new correction version enqueues `reanchor` (Task 7) with `old = derived_from`, after the commit.

**T1 export (1.1 fields):** `submission_to_unit` and `document_to_t1(variant, text)` write `document_id = external_id`, `case_id`, `variant = {version, origin, derived_from: <text_sha256 of the derived_from variant> | null}` and `translation` as stored. A native version-1 variant without other variants in its case writes no `variant` object, so plain projects export exactly as before.

**Tests:** `tests/test_variant_import.py`.
- `test_a_source_and_its_translation_arrive_in_one_bundle`: two documents, one case; the translation's `derived_from` is the source's internal id; status `ready_for_review`.
- `test_a_failed_check_marks_the_translation`: `automatic_check_failed`; the preview lists the failed check code.
- `test_a_translation_of_an_existing_document_resolves_by_hash`: the source was imported earlier as plain text.
- `test_an_unknown_source_is_refused`: `VARIANT_SOURCE_UNKNOWN`; nothing written.
- `test_an_ambiguous_source_prefers_the_same_case`, and `VARIANT_SOURCE_AMBIGUOUS` without a case match.
- `test_a_new_version_needs_the_previous_version_as_source`: version 2 correction accepted; version 3 skipping 2 gives `VARIANT_VERSION_INVALID`; a changed text without `variant` stays `DOCUMENT_CONFLICT`.
- `test_internal_ids_follow_the_variant_rule`: the second variant of `EN100017` gets `EN100017~de~v1`.
- `test_reimporting_variants_adds_nothing`.
- `test_the_lead_can_accept_a_translation_with_a_reason`: status `accepted`, `status_reason` stored, audit row `variant.status_override`; a blank reason gives `OVERRIDE_REASON_REQUIRED`; an annotator gets `NOT_ALLOWED`; an override on a native variant gives `OVERRIDE_NOT_APPLICABLE`.
- `test_the_preview_lists_variants`: the preview JSON of `upload_preview` has one `variants` row per document with origin, version, source and status.
- `test_variants_export_with_1_1_fields`: import → submit on the translation → T1 export → `read_bundle` validates; the unit's `variant.derived_from` equals the source text hash; `document_id` is the external id.
- `test_plain_projects_export_without_variant_objects`.
- `test_a_correction_import_enqueues_reanchoring`: one queued `reanchor` job with the old and new ids.

**Acceptance:** `uv run pytest tests/test_variant_import.py tests/test_t1_import.py tests/test_t1_export.py -q`; regenerate the API contract. Commit: `feat(variants): import translations and text versions with translation status`.

---

### Task 4: Cases, variants and annotation versions API (V3)

**Create** `src/ontocurator/authz/versions.py`, `src/ontocurator/api/variant_routes.py`, `tests/test_annotation_versions.py`, `tests/test_case_api.py`. **Modify** `authz/visibility.py`, `api/app.py`.

**Text access within a case.** `visibility.require_document` (T3a) is extended:
- `readable_documents(access, project)` = the visible documents (T3a) plus every variant of a case in which the user has an active assignment on any variant. These are read-only; working still needs an assignment on that exact variant.
- Leads and admins read everything (`VIEW_ALL_DOCUMENTS`).

> **Open question Q28:** may an annotator of a translation see the other language versions and text versions of the same case (texts only, no annotations)? Provisional default: yes. V3 shows "original | translation" as its main example, and the source text is input, not another member's work.

**`visible_annotation_versions(access, project, document_id, *, assignment=None) -> list[VersionRef]`** (the index contract; `VersionRef = {kind, id, label, created_at}`):

| Kind | Who sees it | Label |
|---|---|---|
| `own` | the user's own submissions on this variant, every task | "My submission (annotate), 2026-10-14 12:00" |
| `proposals` | proposal sets of this variant (both origins), for a user whose active assignment on this variant may see proposals (task `review`; the annotate task in T3 is blind), and for leads and admins | the tool label (`name version`, plus `model` if set); re-anchored sets: "Carried over from version N" |
| other members' drafts or submissions | **nobody**, leads and admins included (U2, Q3; T4a adds stage inputs) | – |

The list is ordered: own (newest first), then proposals. T4a and T4b extend this function; it is the only place that decides.

**Endpoints** (`/api/v1/projects/{key}`; all go through `require_document` / `readable_documents`):

| Route | Response |
|---|---|
| `GET /cases?language=&origin=&status=` | `list[CaseSummary]`: `{case_id, variants: list[VariantSummary]}` with only readable variants |
| `GET /cases/{case_id}` | `CaseDetail`: variants with `{document_id, external_id, language, version, origin, derived_from, translation: {provider, model, run_id, recipe, checks}, translation_status, status_reason, assigned_to_me: bool}`; 404 `CASE_NOT_FOUND` if no variant is readable |
| `GET /documents/{doc}/annotation-versions?assignment=` | `list[VersionRef]` |
| `GET /documents/{doc}/annotation-versions/{kind}/{id}` | `AnnotationVersion`: `{ref, annotations, evidence}` in the editor's existing snapshot DTOs, read-only; 404 `VERSION_NOT_FOUND` unless the ref is in the visible list |
| `GET /documents/{doc}/reanchor-items` | the `pending_items` of re-anchored sets on this variant, same visibility as `proposals` |

The existing document list (T3a) gains `case_id`, `external_id`, `version`, `origin` and `translation_status` per row, and the filters `origin` and `translation_status`.

**Tests:**
- `tests/test_annotation_versions.py`:
  - `test_own_submissions_are_listed_newest_first`;
  - `test_other_members_work_never_appears`: annotator B submits on d; for annotator A (assigned), for the lead and for a system admin, no `own` ref of B is listed, and `GET …/annotation-versions/own/<B's submission id>` is 404;
  - `test_proposals_follow_the_task`: listed for a `review` assignee, absent for an `annotate` assignee, listed for the lead;
  - `test_an_unassigned_user_gets_404`;
  - `test_reanchored_sets_are_labelled_with_their_version`.
- `tests/test_case_api.py`:
  - `test_a_case_lists_its_variants_with_translation_data`;
  - `test_an_assignment_on_one_variant_opens_the_case_texts` (Q28) and `test_working_needs_an_assignment_on_that_variant` (opening a workspace on the sibling gives 403 `ASSIGNMENT_REQUIRED`);
  - `test_cases_without_readable_variants_are_hidden`;
  - `test_the_document_list_filters_by_origin_and_status`.

**Acceptance:** the tests pass; regenerate the API contract. Commit: `feat(variants): case and annotation-version endpoints with one visibility function`.

---

### Task 5: Translation review domain and service

**Create** `src/ontocurator/domain/translation_review.py`, `src/ontocurator/application/translation_reviews.py`, `tests/test_translation_review_rules.py`, `tests/test_translation_review_service.py`, `contracts/translation-review-cases.json` (shared test vectors; Task 12's client-side check reads the same file).

**Decision table (V1; the contract):**

```python
ReviewDecisionCode = Literal[
    "accepted_unchanged", "accepted_corrected", "query", "rejected"
]
ClinicalCategory = Literal[
    "omission", "addition", "assertion", "value", "anatomy", "terminology", "source"
]
REVIEW_POLICY = "ontocurator-translation-review/v1"


class ReviewForm(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: ReviewDecisionCode
    clinical_change: bool
    categories: list[ClinicalCategory] = []
    rationale: str | None = None


def check_review(
    form: ReviewForm, *, machine_text: str, proposed_text: str
) -> list[str]:
    """Issue codes; empty means valid. Texts are compared after canonical_text()."""
    issues: list[str] = []
    changed = canonical_text(proposed_text) != canonical_text(machine_text)
    if not canonical_text(proposed_text).strip():
        issues.append("TEXT_EMPTY")
    explained = bool(form.categories) and bool((form.rationale or "").strip())
    match form.decision:
        case "accepted_unchanged":
            if changed:
                issues.append("TEXT_CHANGED")
            if form.clinical_change:
                issues.append("CLINICAL_CHANGE_NOT_ALLOWED")
        case "accepted_corrected":
            if not changed:
                issues.append("TEXT_UNCHANGED")
        case "query" | "rejected":
            if not form.clinical_change:
                issues.append("CLINICAL_CHANGE_REQUIRED")
    if form.clinical_change and not form.categories:
        issues.append("CATEGORY_REQUIRED")
    if form.clinical_change and not (form.rationale or "").strip():
        issues.append("RATIONALE_REQUIRED")
    if not form.clinical_change and form.categories:
        issues.append("CATEGORIES_WITHOUT_CHANGE")
    return issues
```

Duplicate categories are removed and the list sorted before storing.

**Status transitions** (Q20; `next_status(decision) -> (reviewed_variant_status, created_variant_status | None)`):

| Decision | Reviewed variant | New variant |
|---|---|---|
| `accepted_unchanged` | `accepted` | – |
| `accepted_corrected` | `reviewed` | correction variant, `accepted` |
| `query` | `reviewed` | – |
| `rejected` | `reviewed` | – |

A review is allowed from any status; `status_before` records it. A reopened review (T3 A4) produces a new record; earlier records stay.

> **Open question Q20** (index) is implemented as above: after `query` or `rejected` the variant stays out of annotation until the lead reopens the review or a new translation version is imported.

**`TranslationReviewService(db, jobs, *, now=…)`:**
- `open(access, assignment_id) -> ReviewWorkspace`: the assignment must be the user's, active and of task `translation_review` (`ASSIGNMENT_REQUIRED`). Returns `{assignment, variant: VariantInfo, text: machine text, source: {variant, text}, comparisons: list[{variant, text}], failed_checks: list[TranslationCheck], draft: {text, form, revision}, qualification, previous_reviews: list[record]}`. On first open the draft text is the machine text (revision 0).
  - **Comparisons:** sibling variants with the same `derived_from`, the same language, a translation origin, and a different id (e.g. a second engine's output).
- `save_draft(access, assignment_id, *, expected_revision, text, form: dict) -> int`: `REVISION_CONFLICT` (409) on mismatch; stores `text` and the raw `form` (incomplete forms are allowed in a draft); the first save moves the assignment `open → in_progress`, as edits do in T3a.
- `submit(access, assignment_id, *, expected_revision) -> TranslationReviewRecord`, in one transaction:
  1. the user's `qualification` must be non-blank (`QUALIFICATION_REQUIRED`, 422);
  2. `ReviewForm.model_validate(draft.form)` and `check_review(...)`; issues give `DomainError("REVIEW_INVALID", {"issues": [...]})` (422);
  3. for `accepted_corrected`, create the correction variant: `external_id`, `language` and `case_id` of the reviewed variant; `version = max(version) + 1` for that external id and language; `origin = "correction"`; `derived_from` = the reviewed variant; text = canonical proposed text; `translation_status = "accepted"`; `status_reason = "translation review <id>"`; internal id by D-o;
  4. insert the `translation_reviews` row with the reviewer snapshot (pseudonym, qualification, `user_languages`), `machine_text_sha256`, `proposed_text_sha256`, `review_policy = REVIEW_POLICY`, `created_variant_id`;
  5. update the reviewed variant's status; mark the assignment `submitted` with `last_submission_id = f"tr-{id}"`;
  6. audit `translation.review` with `{document_id, decision, status_before, status_after, created_variant_id}`;
  7. after commit, enqueue `reanchor` from the reviewed variant to the new variant (Task 7).
- `records(access, project, document_id) -> list[TranslationReviewRecord]`: leads and admins see all; a reviewer sees their own.

**Tests:**
- `tests/test_translation_review_rules.py`:
  - `test_the_shared_cases` parametrised over `contracts/translation-review-cases.json` (at least 16 cases: each decision valid and each issue code at least once); each case is `{form, machine_text, proposed_text, issues}`;
  - `test_texts_are_compared_canonically` (CRLF and NFD forms of the same text count as unchanged);
  - `test_next_status_follows_the_table` (4 cases).
- `tests/test_translation_review_service.py`:
  - `test_opening_starts_from_the_machine_text_and_shows_failed_checks`;
  - `test_drafts_autosave_with_revisions` (409 on a stale revision; the assignment becomes `in_progress`);
  - `test_an_unchanged_acceptance_accepts_the_translation`;
  - `test_a_corrected_acceptance_creates_a_new_version`: version 2, `origin == "correction"`, `derived_from` = the machine translation, status `accepted`; the machine translation's text is unchanged and its status `reviewed` (V4);
  - `test_query_and_rejection_mark_the_variant_reviewed`;
  - `test_an_invalid_form_is_refused_with_issue_codes` (nothing written);
  - `test_a_review_needs_a_qualification`;
  - `test_the_record_is_immutable_and_audited`;
  - `test_a_reopened_review_adds_a_second_record`;
  - `test_comparison_translations_are_offered`.

**Acceptance:** the tests pass. Commit: `feat(review): translation review decision table, drafts and immutable records`.

---

### Task 6: The translation review task, distribution and the annotation gate

**Modify** `application/assignments.py` (T3a `AssignmentService`), `application/distribution.py` (T3a `propose_distribution`), `api/assignment_routes.py`, `api/profile_routes.py` and `api/admin_user_routes.py` (T3a), `api/app.py`; **create** `api/translation_review_routes.py`, `tests/test_translation_review_task.py`.

**Assignment rules** (`AssignmentService.assign`, one function `check_assignable(project, variant, user, task) -> list[str]` that T4a reuses for stage tasks):
- `translation_review` targets a variant with a translation origin, or a correction in a translation chain that is not yet accepted; otherwise `NOT_A_TRANSLATION`.
- Role: the annotator role (Q19); otherwise `ASSIGNEE_ROLE_MISSING`.

> **Open question Q19** (index) is implemented as above: translation review needs the annotator role, and the person must read both languages.

- **Languages:** `required_languages(variant, task)` gives `{variant.language}` for `annotate` and `review`, and `{variant.language, source.language}` for `translation_review`. A manual assignment of someone who lacks one needs `confirm_language: true` and is audited as `assignment.language_override` (the T3a mechanism).
- **Gate V6:** with `annotate_accepted_translations_only` on, `annotate` and `review` on a variant in a translation chain need `translation_status == 'accepted'`; otherwise `TRANSLATION_NOT_ACCEPTED` (409). With the option off the gate is skipped.

**Distribution proposal:** `propose_distribution` takes its eligibility from `required_languages`, so translation review is proposed only to members who read both languages (V5). Variants blocked by the gate are listed separately with the reason `translation_not_accepted`, like documents without a suitable member (A2).

**Project setting:** `annotate_accepted_translations_only` joins the project settings API (T3a) and its audit (`project.update`).

**Profile:** `qualification` (free text, at most 200 characters) is editable by the user (`PATCH /api/v1/me/profile`) and by system admins (`PATCH /api/v1/admin/users/{username}`). Assigning does not need it; submitting a review does (Task 5).

**Endpoints** (`/api/v1/translation-reviews`):

| Route | Behaviour |
|---|---|
| `GET /{assignment_id}` | `ReviewWorkspace` |
| `PUT /{assignment_id}/draft {expected_revision, text, form}` | `{revision}` |
| `POST /{assignment_id}/submit {expected_revision}` | `TranslationReviewRecord` |
| `GET /api/v1/projects/{key}/documents/{doc}/translation-reviews` | records (lead: all; reviewer: own) |

"My tasks" (T3a `/me/assignments`) already lists every task; `translation_review` rows carry `{source_language, target_language}` additionally.

**Tests:** `tests/test_translation_review_task.py`.
- `test_only_translations_get_a_review_task` (`NOT_A_TRANSLATION` for a native variant).
- `test_the_reviewer_needs_the_annotator_role`.
- `test_the_proposal_offers_only_readers_of_both_languages`: with members reading {en}, {de} and {en, de}, only the third is proposed for an en→de translation; with nobody eligible, the variant is listed as unassignable.
- `test_a_manual_assignment_without_the_languages_needs_confirmation`.
- `test_annotating_a_translation_waits_for_acceptance`: `TRANSLATION_NOT_ACCEPTED` before; allowed after an `accepted_unchanged` review; allowed on the correction variant after `accepted_corrected`; allowed at once with the option off.
- `test_the_proposal_lists_gated_variants_separately`.
- `test_the_review_endpoints_round_trip` (open, save, submit through HTTP with CSRF).
- `test_another_user_cannot_open_my_review` (403 `ASSIGNMENT_REQUIRED`).
- `test_qualification_is_editable_by_the_user_and_admins`.

**Acceptance:** the tests pass; regenerate the API contract. Commit: `feat(review): translation review task, language-aware distribution and the annotation gate`.

---

### Task 7: Re-anchoring on a new text version (V2)

**Create** `src/ontocurator/domain/reanchor.py`, `src/ontocurator/exchange/reanchor_job.py`, `tests/test_reanchor.py`, `tests/test_reanchor_job.py`. **Modify** `exchange/jobs.py` (register the handler).

**Mapping (D-w; the contract):**

```python
@dataclass(frozen=True)
class TextMap:
    blocks: tuple[
        tuple[int, int, int], ...
    ]  # (old_start, new_start, length) of equal blocks


def text_map(old: str, new: str) -> TextMap:
    matcher = difflib.SequenceMatcher(None, old, new, autojunk=False)
    return TextMap(tuple((a, b, n) for a, b, n in matcher.get_matching_blocks() if n))


def map_span(m: TextMap, start: int, end: int) -> tuple[int, int] | None:
    """The span in the new text, or None if it touches a changed region."""
    for a, b, n in m.blocks:
        if a <= start and end <= a + n:
            return start - a + b, end - a + b
    return None
```

**Annotation rule:** `reanchor_annotation(snapshot, evidence, old_text, new_text, m) -> Carried | NeedsReview`.
- Every segment and cue segment of every mention must map, and each mapped segment's text must equal the old segment text (T1 F2 re-check). Then the annotation is `Carried`, with the same term, axes and layer.
- If any segment fails, the **whole annotation** is `NeedsReview`; partial evidence is never carried, because a dropped mention can change what the annotation claims.
- A document-level annotation (no evidence) is always carried.
- `NeedsReview` holds `{source_ref, term_id, layer_id, old_segments: [{start, end, text}], old_context, new_context, diff}`. `old_context` is the old text from 40 code points before the first segment to 40 after the last; `new_context` is the corresponding window of the new text, taken from the nearest equal blocks; `diff` is the opcodes inside the window as `[{op: equal|replace|insert|delete, old, new}]`.

**Job `reanchor`** (payload `{project, old_document_id, new_document_id}`):
- Sources: `reanchor_sources(conn, project, old_document_id) -> list[ReanchorSource]`. In T5 these are the old variant's proposal sets (both origins). **T4b adds the document's final result** here (Q21). Individual submissions are never sources.
- Per source a proposal set on the new variant:
  - `origin = 'reanchor'`, `set_kind = 'tool_output'`, `bundle_id` and `manifest_sha256` NULL, `source_sha256` NULL;
  - `annotation_set_id = f"{project}:reanchor:{new_document_id}:{source.set_id}"`; the unique key makes the job idempotent;
  - actor `{actor_id: "ontocurator-reanchor", kind: "tool", name: "ontocurator-reanchor", version: ontocurator.__version__}`;
  - each carried annotation: id `ontospan.annotation_ref(annotation_set_id, f"a{n}")` (n in source order), provenance `{actor: ontocurator-reanchor, method: "tool", source_refs: [<the original's reference>]}`; the original's reference is its id if it is an imported URN, otherwise `annotation_ref(source.set_id, annotation_id)`;
  - `payload` is the T1 annotation set built with the export mapping, so a release can re-emit it (D-u); `pending_items` holds the `NeedsReview` entries.
- Sources without any annotation produce no set. The result is `{sets, carried, needs_review}`; the job audits `variant.reanchor` with the same counts.
- Translations are never sources or targets of re-anchoring across languages (V2): the handler refuses `old` and `new` with different languages (`REANCHOR_LANGUAGE_MISMATCH`).

> **Open question Q21** (index) is implemented as above: imported and re-anchored proposals are carried over in T5, the final result is added in T4b, and individual submissions stay with their version.

Re-anchored annotations are proposals: they appear and are confirmed exactly like imported proposals (V2 "do not count as done until a person confirms them").

**Tests:**
- `tests/test_reanchor.py`:
  - `test_unchanged_text_maps_identically`;
  - `test_offsets_shift_after_an_insertion_before_the_span` ("Hypotonie" moves by the inserted length; text re-check passes);
  - `test_a_span_touching_a_change_is_not_carried` (replace inside, at the left edge, at the right edge: 3 cases);
  - `test_one_failing_mention_sends_the_whole_annotation_to_review`;
  - `test_cue_segments_must_map_too`;
  - `test_document_level_annotations_are_carried`;
  - `test_offsets_are_code_points` (an astral character before the span, e.g. "𝔸", shifts by 1);
  - `test_needs_review_has_contexts_and_a_diff`.
- `tests/test_reanchor_job.py`:
  - `test_a_correction_carries_the_proposals_over`: import v1 with a tool set, import a v2 correction; after the job the new variant has one `reanchor` set whose annotations have `source_refs` to the originals and validate as T1 (`ontospan.validate`) on the new text;
  - `test_the_job_is_idempotent`;
  - `test_needs_review_items_are_stored_and_served` (`GET …/reanchor-items`);
  - `test_submissions_are_not_carried` (an annotator's submission on v1 produces nothing on v2);
  - `test_a_corrected_translation_review_triggers_reanchoring` (the end of Task 5's flow);
  - `test_languages_must_match`.

**Acceptance:** the tests pass. Commit: `feat(variants): re-anchor proposals onto corrected text versions`.

---

### Task 8: Translation review export (D-z)

**Create** `src/ontocurator/exchange/review_export.py`, `tests/test_review_export.py`. **Modify** `exchange/jobs.py`, `api/export_routes.py` (T3a), `cli.py`.

**Job `translation_review_export`** (payload `{project}`): one JSON line per `translation_reviews` row in id order, written to the blob store with a `stored_files` row, audited as `project.translation_review_export`. The record (the contract; all hashes are lower-case hex SHA-256, timestamps UTC to the second):

```json
{"format": "ontocurator-translation-review/v1", "review_id": 12, "project": "e3c-de",
 "case_id": "EN100017",
 "reviewed_variant": {"document_id": "EN100017-de", "language": "de", "version": 1,
                      "origin": "machine_translation", "text_sha256": "…",
                      "translation": {"provider": "…", "model": "…", "run_id": "…", "recipe": null,
                                      "checks": [{"code": "units_added", "passed": true, "detail": null}]}},
 "source_variant": {"document_id": "EN100017", "language": "en", "version": 1, "text_sha256": "…"},
 "reviewer": {"pseudonym": "ann-0003", "qualification": "physician", "languages": ["de", "en"]},
 "decision": "accepted_corrected", "clinical_change": true, "categories": ["value"],
 "rationale": "…", "machine_text_sha256": "…", "proposed_text": "…", "proposed_text_sha256": "…",
 "created_variant": {"document_id": "EN100017-de", "version": 2, "text_sha256": "…"},
 "status_before": "ready_for_review", "status_after": "reviewed",
 "review_policy": "ontocurator-translation-review/v1", "reviewed_at": "2026-10-14T12:00:05Z"}
```

- `document_id` values are external ids. There is no user id or display name (T1 F10); the reviewer is the pseudonym.
- Codes are the English internal codes (V1). Mapping to a consumer's record format is the consumer's job (U1, D-z).

**API and CLI:**
- `POST /api/v1/projects/{key}/exports/translation-reviews` enqueues the job (`EXPORT_ALL_WORK`) and returns the job id; the download uses T3a's job download route.
- `admin export-translation-reviews PROJECT OUT.jsonl [--no-wait]`, with the T2d behaviour (inline by default, refuses to overwrite).

**Tests:** `tests/test_review_export.py`.
- `test_records_export_as_jsonl_in_review_order`.
- `test_the_record_fields_match_the_contract`: the keys of each line equal the documented set; `created_variant` is null for `query`.
- `test_the_export_is_pseudonymised` (no `user_id`, no username, no display name).
- `test_only_leads_and_admins_export` (403 for an annotator).
- `test_the_cli_writes_and_refuses_to_overwrite`.

**Acceptance:** `scripts/check.sh` passes (backend and contract; the UI follows in Part 2). Commit: `feat(review): generic JSONL export of translation review records`.

---

## Part 2: User interface (Tasks 9–15)

**Goal of Part 2:**
- In the editor, a user switches between the languages and text versions of a case and between the annotation versions they may see.
- A second pane shows another text or annotation version next to the first, with scrolling coupled by paragraph.
- A reviewer reviews a machine translation side by side with its source: they edit the translation, see a live diff against the machine text, and decide with a form that enforces the decision table.
- Leads see variants and translation status in the documents page, accept already-reviewed translations on import, and assign translation reviews.
- Annotators see which carried-over annotations need review after a text correction.

**Architecture of Part 2:**
- **API client:** typed wrappers in `frontend/src/api/client.ts` for the Part 1 endpoints. Types come from the regenerated `generated.ts`.
- **Variants (`frontend/src/variants/`):** pure state helpers (`versionState.ts`, `paragraphs.ts`) and components (`VariantSelectors`, `ReadOnlyAnnotationView`, `ComparePane`, `CaseViewer`, `ReanchorPanel`).
- **Translation review (`frontend/src/translation/`):** `reviewRules.ts` mirrors the server's decision table and is tested against the same vectors (`contracts/translation-review-cases.json`, Task 5). `textDiff.ts` wraps `jsdiff`; `draftSaver.ts` autosaves; `TranslationReviewScreen` renders the three columns and the decision form.
- **Routing:** `#/projects/:key/cases/:case` (case viewer) and `#/tasks/:assignment` (opens any task: the translation review screen, or the editor for annotate and review), as listed in the index.
- **Labels:** every review label lives in `translation/labels.ts`, keyed by code, so a later i18n layer can replace the English strings (V1 "UI labels are translatable").

**Commit rule in Part 2:** per task, `npm --prefix frontend run typecheck && npm --prefix frontend test`, plus `uv run ruff check --fix src tests && uv run ruff format src tests && uv run mypy src` when Python changed; then one conventional commit without AI attribution.

**T3b names:** this plan extends T3b's pages by role: the router (`frontend/src/app/router.ts`), "My tasks", the documents page with its upload preview and assignment dialog, the project settings page, the profile page and the users page. If T3b chose other file names, extend those files.

**Technical decision (this plan):** the live diff uses the `diff` package (jsdiff, BSD-3-Clause, no dependencies) with `diffWordsWithSpace`. A hand-written word diff would need its own Myers implementation and tests; jsdiff is small, widely used and fast enough for texts of a few thousand words. `THIRD_PARTY_NOTICES.md` is regenerated with `uv run python scripts/license_notices.py`.

---

### Task 9: API client and the version state

**Modify** `frontend/src/api/client.ts`; **create** `frontend/src/variants/versionState.ts`, `frontend/tests/versionState.test.ts`, `frontend/tests/variantClient.test.ts`.

**Client functions** (all send the CSRF header for writes, as the T2b client does):

| Function | Endpoint |
|---|---|
| `listCases(projectKey, filters?)` | `GET /projects/{key}/cases` |
| `getCase(projectKey, caseId)` | `GET /projects/{key}/cases/{case}` |
| `listAnnotationVersions(projectKey, documentId, assignmentId?)` | `GET …/documents/{doc}/annotation-versions` |
| `getAnnotationVersion(projectKey, documentId, kind, id)` | `GET …/annotation-versions/{kind}/{id}` |
| `getReanchorItems(projectKey, documentId)` | `GET …/documents/{doc}/reanchor-items` |
| `openTranslationReview(assignmentId)` | `GET /translation-reviews/{id}` |
| `saveTranslationReviewDraft(assignmentId, {expected_revision, text, form})` | `PUT …/draft` |
| `submitTranslationReview(assignmentId, expectedRevision)` | `POST …/submit` |
| `listTranslationReviews(projectKey, documentId)` | `GET …/documents/{doc}/translation-reviews` |
| `exportTranslationReviews(projectKey)` | `POST /projects/{key}/exports/translation-reviews` |

Types: `type CaseDetail = components["schemas"]["CaseDetail"]`, and likewise `VariantSummary`, `VersionRef`, `AnnotationVersion`, `ReviewWorkspace`, `TranslationReviewRecord`, `ReanchorItem`.

**`versionState.ts`** (pure):
- `languagesOf(caseDetail) -> string[]`: the languages of readable variants, sorted with the current variant's language first.
- `versionsOf(caseDetail, language) -> VariantOption[]`: `{documentId, version, origin, status, label}`, newest first. Labels: "v2 · corrected", "v1 · machine translation · accepted".
- `pickVariant(caseDetail, language, version?) -> documentId`: the newest accepted variant if `version` is missing, otherwise the newest one.
- `annotationOptions(refs: VersionRef[], hasDraft: boolean) -> AnnotationOption[]`: "My draft" first (only with a draft), then the refs in server order. The client never adds options of its own; it shows exactly what the server offers (U2).

**Tests:**
- `versionState.test.ts`:
  - "lists the current language first";
  - "orders versions newest first with origin and status labels";
  - "picks the newest accepted variant by default";
  - "offers exactly the server's annotation versions after 'My draft'";
  - "offers no draft entry without a draft".
- `variantClient.test.ts`: "sends the CSRF token when saving a review draft"; "encodes case ids with special characters" (`EN 1/7`).

**Acceptance:** `npm --prefix frontend test -- tests/versionState.test.ts tests/variantClient.test.ts`. Commit: `feat(frontend): API client and version state for variants`.

---

### Task 10: Selectors in the editor and the case viewer

**Create** `frontend/src/variants/VariantSelectors.tsx`, `frontend/src/variants/ReadOnlyAnnotationView.tsx`, `frontend/src/variants/CaseViewer.tsx`, `frontend/tests/variantSelectors.test.tsx`, `frontend/tests/caseViewer.test.tsx`. **Modify** `frontend/src/app/CaseScreen.tsx`, `frontend/src/app/router.ts`.

**`VariantSelectors`** props: `{caseDetail, currentDocumentId, annotationOptions, selectedAnnotation, onLanguage, onVersion, onAnnotation}`. Three labelled `<select>`s: "Language", "Text version", "Annotations". With a single variant the language and version selectors are shown disabled with their only value, so the layout does not jump.

**In `CaseScreen`** (header, next to the case title):
- It loads `getCase` and `listAnnotationVersions` for the open document when the document has a `case_id`.
- **Annotations selector:** "My draft" is the editable default. Choosing another option loads `getAnnotationVersion` and replaces the text pane's mentions with that version's, read-only. A banner reads "Viewing <label> (read-only)" with a "Back to my draft" button. All editing commands are disabled while it is shown.
- **Language and version selectors:** another variant cannot be edited in this workspace (working needs an assignment on that variant). Choosing one navigates to `#/projects/:key/cases/:case?variant=<id>`. If the user has an assignment on that variant (`assigned_to_me`), the viewer offers "Open my task".
- A badge next to the title shows origin and status for translations ("Machine translation · accepted").

**`ReadOnlyAnnotationView`** props: `{text, annotations, evidence, labelFor}`. It renders `TextPane` with the mentions and no-op handlers (no selection, no resizing) and a compact list of the annotations (term label, axes). It is shared by the viewer, the editor's read-only mode and the second pane.

**`CaseViewer`** (route `#/projects/:key/cases/:case`, query `variant`, `annotations`):
- Header: case id and the three selectors. Body: `ReadOnlyAnnotationView` for the chosen variant and annotation version, or the plain text when "Text only" is chosen.
- A 404 (`CASE_NOT_FOUND`) shows "This case is not available to you."
- Leads reach it from the documents page; annotators from the editor's language selector (Q28).

**Tests:**
- `variantSelectors.test.tsx`:
  - "shows language, text version and annotation selectors";
  - "disables single-value selectors";
  - "calls back with the chosen variant".
- `caseViewer.test.tsx`:
  - "shows the chosen variant's text with its translation badge";
  - "loads a read-only annotation version";
  - "shows the not-available message on 404";
  - "offers 'Open my task' for an assigned variant".
- `caseScreen.test.tsx` (extended):
  - "switching to a submitted version shows it read-only and disables editing";
  - "back to my draft restores editing";
  - "choosing another language navigates to the case viewer".

**Acceptance:** `npm --prefix frontend test -- tests/variantSelectors.test.tsx tests/caseViewer.test.tsx tests/caseScreen.test.tsx`. Commit: `feat(frontend): language, version and annotation-version selectors; case viewer`.

---

### Task 11: The second pane with paragraph-coupled scrolling

**Create** `frontend/src/variants/paragraphs.ts`, `frontend/src/variants/useCoupledScroll.ts`, `frontend/src/variants/ComparePane.tsx`, `frontend/tests/paragraphs.test.ts`, `frontend/tests/comparePane.test.tsx`. **Modify** `CaseScreen.tsx`, `CaseViewer.tsx`, `styles.css`.

**Paragraphs (pure, the contract):**
- `paragraphStarts(text) -> number[]`: code-point offsets where paragraphs begin. A paragraph boundary is one or more blank lines (`\n` followed by optional spaces or tabs and another `\n`). If that gives a single paragraph and the text contains `\n`, every line is a paragraph. Offset 0 is always the first start.
- `paragraphAt(starts, offset) -> number`: the index of the paragraph containing `offset`.
- Offsets are code points, as everywhere in the editor (`spans/offsets.ts` converts to UTF-16 for the DOM).

**Rendering hook:** the text pane marks each paragraph start with an element carrying `data-paragraph="<index>"` (an empty, zero-width marker inserted by the span adapter's render, so selection offsets are not affected). The existing span tests must stay green; add a test that markers do not change selection offsets.

**`useCoupledScroll(left, right, {leftStarts, rightStarts})`:**
- On a scroll of one pane it finds the topmost visible paragraph marker and scrolls the other pane so the same paragraph index is at its top.
- If the paragraph counts differ, it maps by proportion (`round(i * (m - 1) / (n - 1))`) and the pane shows the hint "Paragraphs differ (12 / 11); scrolling is approximate."
- A programmatic scroll suppresses the echo event for 150 ms, so the panes do not oscillate.
- A "Couple scrolling" checkbox (default on) switches it off.

**`ComparePane`:**
- Opened with the "Compare" button in `CaseScreen` and `CaseViewer`; closed with ×. The editor gets a two-column layout; below 1100 px width the panes stack and coupling is off.
- It has its own `VariantSelectors` (any readable variant of the case) and its own annotation options, from `listAnnotationVersions` for that variant. It never offers more than the server returns, so the blind rule (and T4's rules later) apply automatically (V3).
- Default content: in a translation, the source variant with "Text only"; otherwise the same variant with the newest offered annotation version.

**Tests:**
- `paragraphs.test.ts`:
  - "splits on blank lines";
  - "falls back to lines without blank lines";
  - "treats whitespace-only lines as blank";
  - "counts code points, not UTF-16 units" (an astral character before the second paragraph);
  - "finds the paragraph of an offset".
- `comparePane.test.tsx` (jsdom with stubbed `getBoundingClientRect` and `scrollTop`):
  - "scrolling the left pane brings the same paragraph to the top of the right pane";
  - "maps proportionally and shows a hint when paragraph counts differ";
  - "does not echo programmatic scrolls";
  - "turning coupling off stops syncing";
  - "offers only the server's annotation versions";
  - "defaults to the source text for a translation".
- `spans.test.ts` (extended): "paragraph markers do not change selection offsets".

**Acceptance:** `npm --prefix frontend test -- tests/paragraphs.test.ts tests/comparePane.test.tsx tests/spans.test.ts`. Commit: `feat(frontend): second pane with paragraph-coupled scrolling`.

---

### Task 12: The translation review screen

**Create** `frontend/src/translation/labels.ts`, `reviewRules.ts`, `textDiff.ts`, `draftSaver.ts`, `DiffView.tsx`, `ReviewForm.tsx`, `TranslationReviewScreen.tsx`, and the tests `frontend/tests/reviewRules.test.ts`, `textDiff.test.ts`, `draftSaver.test.ts`, `translationReview.test.tsx`. **Modify** `frontend/src/app/router.ts`, "My tasks", `package.json` (`npm --prefix frontend install diff@^7` and `@types/diff` if the package has no bundled types), `THIRD_PARTY_NOTICES.md`.

**Route `#/tasks/:assignment`:** it loads the assignment from "My tasks" data (or `GET /me/assignments`). `translation_review` renders `TranslationReviewScreen`; `annotate` and `review` open the editor exactly as "My tasks" did in T3b (move that code here, so there is one way to open a task). "My tasks" rows link to this route. A translation review row reads "Review translation en → de" with the variant's external id.

**`reviewRules.ts`** mirrors `check_review` (Task 5) one to one: `checkReview(form, machineText, proposedText) -> IssueCode[]`, comparing texts after NFC and LF normalisation (`text.normalize("NFC").replace(/\r\n?/g, "\n")`, BOM stripped). The vitest suite reads `../../contracts/translation-review-cases.json` and must produce exactly the server's issue lists. This parity test is the guard against drift.

**`labels.ts`:**
- decisions: `accepted_unchanged` "Accepted unchanged", `accepted_corrected` "Accepted with corrections", `query` "Query", `rejected` "Rejected";
- categories: `omission` "Omission", `addition` "Addition", `assertion` "Negation or certainty", `value` "Number or unit", `anatomy` "Anatomy or laterality", `terminology` "Terminology", `source` "Problem in the source";
- one message per issue code, e.g. `RATIONALE_REQUIRED` "A clinical change needs a rationale."

**`textDiff.ts`:** `diffText(before, after) -> {op: "equal" | "insert" | "delete", text}[]` from `diffWordsWithSpace`; consecutive parts of the same op are merged.

**`draftSaver.ts`:** `createDraftSaver({save, delayMs = 800}) -> {update(draft), flush(): Promise<void>, state}`.
- Saves are debounced and strictly sequential, and each carries the last confirmed revision.
- A 409 sets `state = "conflict"` and stops saving.
- `flush()` runs before submit and before leaving the route; `beforeunload` warns while `state` is `"dirty"` or `"saving"`.

**Layout (`TranslationReviewScreen`):**
- **Header:** external id, "en → de", provider and model, the autosave state ("Saved", "Saving…", "Conflict: reload"), and a "Back to my tasks" link.
- **Failed checks:** a warning list above the texts, one line per failed check with its code and detail (V5). Passed checks are behind a "Show all checks" toggle.
- **Columns:**
  - left, "Source (en)": read-only text;
  - middle, "Translation (de)": a `<textarea>` with the draft text, and below it the live `DiffView` against the machine text (insertions underlined in green, deletions struck through in red), with a "Show changes" toggle (default on);
  - right, optional "Comparison": only if `comparisons` is non-empty; a selector picks one when there are several; read-only.
- The left and right text columns couple scrolling by paragraph (`useCoupledScroll`) with the middle column's diff view.
- **Decision form (`ReviewForm`):**
  - four decision radios;
  - "Clinically relevant change" checkbox;
  - category checkboxes, enabled only with a clinical change;
  - rationale text area;
  - live issues from `checkReview`, shown under the form with `labels.ts` messages;
  - "Submit review" is disabled while there are issues, while the saver is not `"saved"`, or while the user's qualification is empty. In the last case a link "Add your qualification in your profile" goes to `#/me`.
- **Submit:** `flush()`, then `submitTranslationReview`. A 422 `REVIEW_INVALID` shows the server's issues (they should never differ from the client's). Success shows "Review submitted" with the resulting status and, for `accepted_corrected`, "A corrected version v2 was created", then returns to "My tasks".
- **After submission** the screen opens read-only, with the record's decision and a list of earlier records (reopened reviews).

**Tests:**
- `reviewRules.test.ts`: "matches the server's decision table for every shared case"; "compares texts after normalisation".
- `textDiff.test.ts`: "marks inserted and deleted words"; "keeps whitespace changes visible"; "returns one equal part for identical texts".
- `draftSaver.test.ts` (fake timers): "debounces and saves the latest draft"; "saves sequentially with the confirmed revision"; "stops on conflict"; "flush waits for the pending save".
- `translationReview.test.tsx` (mocked client):
  - "shows the source, the editable translation and the failed checks";
  - "shows the comparison column only when a comparison exists";
  - "highlights an edited word in the diff";
  - "enables categories only with a clinical change";
  - "blocks submission until the form is valid" (each decision once);
  - "blocks submission without a qualification and links to the profile";
  - "autosaves edits and shows the conflict state on 409";
  - "submits after flushing and reports the created version";
  - "opens read-only after submission".
- `dashboard.test.tsx` (extended): "a translation review task links to its review screen".

**Acceptance:** `npm --prefix frontend test -- tests/reviewRules.test.ts tests/textDiff.test.ts tests/draftSaver.test.ts tests/translationReview.test.tsx tests/dashboard.test.tsx`; `npm --prefix frontend run typecheck`. Commit: `feat(frontend): translation review screen with live diff and the decision table`.

---

### Task 13: Variants in the admin pages

**Modify** T3b's documents page, upload preview, assignment dialog, distribution proposal table, project settings page, profile page and users page; their tests.

**Documents page:**
- New columns: Case, Language, Version, Origin, Translation status.
- Status badges: "Ready for review", "Check failed", "Reviewed", "Accepted", "Translated". An override shows "Accepted without review" with the reason as a tooltip.
- New filters: origin and translation status. The case id links to the case viewer.
- A "Reviews" action on translation rows lists the records (`listTranslationReviews`).
- An "Export translation reviews" button sits on the export page with the other exports (T3b), using the same job polling.

**Upload preview:**
- A "Variants" table with external id, language, version, origin, source ("in this upload" or the internal id), status and failed check codes.
- For translation rows, and only for users with the override right (lead or admin): an "Accept without review" checkbox that opens a required reason field. The commit sends `status_overrides`. Client-side, a ticked box with an empty reason blocks the commit button; the server's `OVERRIDE_REASON_REQUIRED` is shown if it ever comes back.
- The refusal codes from Task 3 get readable messages:
  - `VARIANT_SOURCE_UNKNOWN`: "The source text of this translation is neither in the upload nor in the project";
  - `VARIANT_SOURCE_AMBIGUOUS`;
  - `VARIANT_VERSION_INVALID`;
  - `VARIANT_CASE_MISMATCH`;
  - `VARIANT_ID_COLLISION`.

**Assignment dialog and distribution proposal:**
- The task list gains "Translation review"; it is enabled only if every selected row is a translation that is not yet accepted.
- `TRANSLATION_NOT_ACCEPTED` reads "This translation can be annotated once its review is accepted."
- `NOT_A_TRANSLATION` reads "Only translations can be reviewed."
- The proposal's unassignable list shows the reasons "Nobody reads en and de" and "Translation not accepted yet".
- The language confirmation of T3b lists both languages for translation review.

**Project settings:** a checkbox "Annotate translations only after an accepted review" (default on, V6).

**Profile and users pages:** a "Qualification" field (free text, up to 200 characters, hint "e.g. physician, native German speaker"), editable by the user and by system admins.

**Tests** (extend the T3b test files):
- documents page: "shows variant columns and filters by translation status"; "shows the override reason on an accepted-without-review badge".
- upload preview: "lists variants with their source and status"; "requires a reason to accept a translation without review"; "sends the overrides with the commit"; "hides the override for annotators".
- assignment dialog: "offers translation review only for unaccepted translations"; "explains the annotation gate".
- project settings: "saves the accepted-translations option".
- profile: "edits the qualification".

**Acceptance:** `npm --prefix frontend test`; `npm --prefix frontend run typecheck`. Commit: `feat(frontend): variants, translation status and review assignment in the admin pages`.

---

### Task 14: Carried-over annotations that need review

**Create** `frontend/src/variants/ReanchorPanel.tsx`, `frontend/tests/reanchorPanel.test.tsx`. **Modify** `CaseScreen.tsx` (side panel), `AiBadge.tsx` if needed.

- `CaseScreen` loads `getReanchorItems` for the open document. The server returns items only to users who may see proposals there (Task 4), so the panel follows the same rules.
- **Panel:** a collapsible section "Needs review after the text change (n)", collapsed when empty and hidden without items. Each item shows:
  - the term label and id;
  - the old context with the old segments highlighted;
  - the new context;
  - the inline diff of the window (`DiffView` with the server's opcodes).
- Clicking an item scrolls the text pane to the new context and briefly highlights that window (a temporary display mention of kind `context`, removed after 2 s).
- The panel is informational: the annotator re-creates or skips the annotation with the normal tools. Nothing is written by the panel.
- **Proposal badges:** re-anchored proposals carry the existing AI badge with the tool label "ontocurator-reanchor" and, in the detail pane, "Carried over from version N" (from the `VersionRef` label).

**Tests:** `reanchorPanel.test.tsx`.
- "lists items with old and new context and the diff".
- "is hidden without items".
- "clicking an item scrolls to the new context".
- "labels re-anchored proposals as carried over".

**Acceptance:** `npm --prefix frontend test -- tests/reanchorPanel.test.tsx tests/caseScreen.test.tsx`. Commit: `feat(frontend): show carried-over annotations that need review`.

---

### Task 15: Browser tests, embedded assets and the gate

**Modify** `tests/browser_server.py`, `frontend/browser/helpers.ts`; **create** `frontend/browser/translation-review.spec.ts`, `frontend/browser/variants.spec.ts`.

**Browser server:** a scenario `variants` seeded at start-up with `tests/t1_builders.py` (Task 3) through the import path:
- project `variants-demo` with an English native case `EN1` of three paragraphs, a German machine translation `EN1-de` (`ready_for_review`, all checks passed), and a second case `EN2` with a German translation whose check `units_added` failed;
- a third case `EN3` whose German translation is already `accepted`, assigned for annotation;
- members: `lead-1` (lead), `reviewer-1` (annotator, languages en and de, qualification "physician"), `annotator-1` and `annotator-2` (annotators, languages en and de).

**`helpers.ts`:** `loginAs(page, username)` as in T2b; `apiAs(page)` returns a request context with the session cookie and CSRF header for test-only setup steps.

**`translation-review.spec.ts`:**
- "a lead assigns a translation review and the reviewer accepts it with a correction":
  - the lead opens Documents, selects `EN1-de` and assigns "Translation review" to `reviewer-1`;
  - `reviewer-1` opens it from My tasks and sees source and translation side by side;
  - the reviewer edits a number; the diff shows the deletion and the insertion;
  - "Accepted with corrections" with "Clinically relevant change", category "Number or unit" and a rationale; "Submit review" is disabled until the rationale is filled;
  - after submitting, My tasks shows the review as submitted;
  - the lead's documents page shows `EN1-de` v1 "Reviewed" and v2 "Accepted".
- "a failed automatic check is shown above the translation" (`EN2-de`).
- "an unchanged acceptance refuses an edited text": after an edit, "Accepted unchanged" shows "The text differs from the machine translation".

**`variants.spec.ts`:**
- "switch language and compare with coupled scrolling": `annotator-1` opens the `EN3-de` task; the language selector lists de and en; "Compare" opens the second pane; choosing en shows the English text; scrolling the main pane to paragraph 3 brings paragraph 3 to the top of the second pane (`[data-paragraph="2"]` within 20 px of the pane's top).
- "annotation versions show my submission but never a colleague's": `annotator-2` submits on `EN3-de` (through `apiAs` setup, with an assignment); `annotator-1` submits too; `annotator-1`'s "Annotations" selector lists "My submission" once and nothing of `annotator-2`.
- "an annotator cannot open the annotation task of an unaccepted translation": assigning `EN2-de` for annotation in the lead's dialog shows the gate message.

**Finish:**
- Rebuild the embedded assets (`npm --prefix frontend run build`, then replace `src/ontocurator/web/` with `frontend/dist/`).
- `grep -rn "unverändert\|korrigiert\|Rückfrage\|abgelehnt" src frontend/src` prints nothing (U1: no consumer vocabulary in the product).

**Acceptance:** `npm --prefix frontend run test:e2e -- browser/translation-review.spec.ts browser/variants.spec.ts`; then `scripts/check.sh` passes. Commit: `test(browser): translation review and variant switching; rebuild embedded assets`.

---

## Spec coverage

| Spec item | Task |
|---|---|
| V1: four decisions, clinical-change flag, seven categories with rationale, decision table on the server; English codes | 5 |
| V1: export of review records (generic, D-z; deviation recorded in the index) | 8 |
| V2: diff-based re-anchoring of unchanged regions; proposal set `ontocurator-reanchor` with `source_refs`; needs-review list with old text, new text and diff; old version unchanged; no cross-language projection | 7 |
| V3: annotation versions offered per E8 and the blind rule (backend) | 4, 9–11 |
| V4: cases and variants with origin, `derived_from`, translation run and checks; translation status; correction as a new variant; existing documents become native variants; format 1.1 | 1, 2, 3, 5 |
| V5: `translation_review` task on one translation variant; immutable record; status moves; reviewers read both languages; `qualification` | 5, 6 |
| V6: `annotate_accepted_translations_only`, default on | 2, 6 |
| T7 I2: translations and versions on import; `derived_from` resolution; status from checks; lead override with reason, audited and shown | 3 |
| T7 I7 / O6 (format part): manifest `release` block in format 1.1 | 1 |
| T7 I10: variant import tests | 3 |
| T3 A2: distribution proposal per language rules; unassignable variants listed | 6 |
| U2: no other member's work in the version list | 4 |
| V3: three selectors (language, text version, annotation version) | 9, 10 |
| V3: annotation versions per E8; only what the server offers (blind rules) | 9, 10, 11 |
| V3: second pane with its own selectors; scrolling coupled by paragraph | 11 |
| V3: the translation review task opens with source and translation side by side | 12 |
| V5: layout (source read-only; editable translation with live diff; optional comparison column); failed checks above the text; decision form enforcing the table; immutable record on submit | 12 |
| V1: translatable UI labels; English codes | 12 |
| V5: distribution of reviews to readers of both languages; `qualification` | 13 |
| V6: gate shown in assignment; project option | 13 |
| V2: needs-review list with old text, new text and diff; re-anchored proposals labelled | 14 |
| T7 I2: lead accepts reviewed translations on import with a reason; status shown on the variant | 13 |
| U1: no consumer-specific vocabulary in the product | 15 |
| U2: no other member's work in any selector | 9, 11, 15 |
