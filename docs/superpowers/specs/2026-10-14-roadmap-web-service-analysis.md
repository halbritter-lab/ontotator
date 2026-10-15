# Ontocurator Roadmap: Web Service, Formats, Workflows, Translations – Analysis & Open Questions

As of: 2026-10-14 · Status: **Planning in progress. The core decisions E1–E10 have been made (§5).**

## 1. Current State (facts from the three repos)

### 1.1 Ontocurator (HEAD `9692ff1`)

**Technology**
- FastAPI, Pydantic v2, React 18 and Vite.
- Storage is SQLite (`ontocurator-workspace/v4`, WAL). `storage/repository.py` has about 1600 lines of raw SQL.

**Operating model: local and single-user**
- Binds only to loopback; every start generates a new bearer token.
- One instance per workspace, secured by a lock file.
- The annotator ID consists of typed-in initials and is not authenticated.
- There is **no** user management, no roles, no text assignment and no Docker.

**Exchange**
- Exclusively `ontocurator-work-package/v2` (ZIP).
- The work package contains `documents.jsonl`, `annotations.jsonl` (`ontocurator-annotation/v3`), submissions, search events and the embedded ontology.
- There is no text import, no Phenopacket export and no GA4GH format at all.

**Data model (highly reusable)**
- Offsets are Unicode codepoints `[start, end)`. Discontinuous mentions are represented by multiple segments.
- Axes are freely configurable (assertion, experiencer, temporality, etc.).
- Provenance distinguishes human and tool.
- Snapshots are content-addressed (RFC-8785).
- Submissions are immutable.

**Review today**
- There are the modes `independent` (blind on the server side), `review` (confirm, reject, adopt and modify, uncertain) and `assisted`.
- Review rounds are identified by `target_set_id`.
- Submissions from different annotators are combined into a union.
- **Missing:** comparison view, merge and adjudication, agreement statistics and tolerant span matching.

**Further findings**
- **Tree:** The rows show only the label. The ID appears only in the detail pane. There are no external links (`TermTree.tsx:112-118`, `TreeBrowser.tsx:247-313`).
- **Translations:** Only HPO translations for term search (babelon TSV). The document language is stored but not used.
- **Frontend:** monolithic, with `App.tsx` (about 1150 lines) and `CaseScreen.tsx` (about 2050 lines).

### 1.2 Phentrieve (HEAD `8433995`)

**Phenopacket v2 (`phenopackets` Python package, protobuf)**
- Export only: via CLI, REST `/api/v1/phenopackets/export`, MCP and a frontend download.
- Populated fields are `type`, `excluded`, `evidence` (always ECO:0007636, "computational"), `metaData` and `subject`.
- `onset`, `modifiers`, `severity` and `extensions` are **never** populated.

**Spans**
- In the package they appear only as free text in `evidence.reference.description`.
- In structured form they are in the sidecar `phenotype_annotation_bundle` v1.0.0 (JSON Schema). The link is made via `phenopacket_id` and `phenotypic_feature_index`.
- **Inconsistency:** In the CLI path the offsets are document-relative (whole chunk), in the REST/MCP path they are chunk-relative. The sidecar does not state which convention applies.

**Assertion vocabulary**
- Values are `affirmed|negated|normal|uncertain|family_history`.
- `uncertain` and `family_history` are exported as `excluded:false`. This information is therefore lost in the package.

**Gold format for tests**
- Per document: `{doc_id, language, full_text, annotations:[{hpo_id, assertion_status, evidence_spans:[{start_char,end_char,text_snippet}]}]}`, with document-relative offsets.

**Languages, operations, auth**
- Languages: en, de, es, fr, nl. Search is cross-lingual via a multilingual embedding.
- Operations: Docker Compose (API plus nginx frontend), SQLite and ChromaDB.
- Auth: optional, with JWT and refresh cookie, CSRF protection, email verification and lockout after failed attempts. This is **a template for Ontocurator.**

### 1.3 phentrieve-benchmark (HEAD `4a58691`)

**Models**
- `Document` with `document_sha256` and `translation_status`.
- `AnnotationSet` with `evidence_spans[{start_char,end_char,text_snippet}]`.
- `curated-annotation-set/v1` with content-hash IDs and `derivations`.
- `ReviewDecision` and `TranslationRecord`.

**Ontocurator interface**
- **Export works:** `scripts/build_editor_packages.py` builds v2 work packages with LLM suggestions as `tool` annotations. EN, ES and FR are built; DE is pending.
- **Import is only specified:** Spec §8.2 provides that the editor export becomes a `ReviewDecisionSet` and a `curated-annotation-set/v2`. This is not implemented.

**Phentrieve interface**
- There is no code yet that calls Phentrieve. The adapter is an open item on the checklist.

**Translations**
- E3C EN/FR/ES → DE with Google Translation LLM, 246 texts. Of these, 185 are `ready_for_review`, 61 `automatic_check_failed` and 0 reviewed.
- Review currently runs via an Excel workbook roundtrip. The associated model `TranslationReviewRecord` knows the decisions accepted, corrected, query and rejected.
- For projecting spans onto translations: the benchmark spec plans **no** automatic projection. German texts are annotated in German, and a text correction creates a new document version.

**Versioning**
- SHA-256 throughout. Texts are NFC-canonical. Runs and manifests are immutable.

### 1.4 hpo-span-annotator (predecessor in this role)

- Stdlib HTTP server with file storage per annotator and HF OAuth. Docker targets an HF Space.
- Agreement calculation and merge (`merge.py`) are available.
- The assessment of 2026-09-13: parts are reusable; it is unsuitable as a backend.

---

## 2. Assessment of the Individual Points

### 2.1 Unified format with Phentrieve and GA4GH

**What Phenopacket v2 provides (GA4GH, ISO 4454:2022)**
- It is a **patient-centric** record: PhenotypicFeature with `type`, `excluded`, `onset`, `resolution`, `severity`, `modifiers` and `evidence`.
- It has **no** concept of document, text location or annotator round.
- Not representable, or only poorly:
  - `uncertain`: there is only the boolean `excluded`.
  - Findings in family members: the `Family`/pedigree level is meant for that, not the patient.
  - Spans, multiple annotators and review status.

**Other GA4GH standards**
- **VRS** (variants), **Beacon v2** (data discovery) and **DUO** (data use conditions) are not relevant for annotation.
- **GA4GH Passports/AAI** are relevant at most for login, if federated later.
- Only Phenopacket, including `Family`, is relevant.

**Established standards for span annotations** (not from GA4GH)
- BioC (NCBI), W3C Web Annotation, BRAT standoff and PubAnnotation.

**Recommendation: three levels**
1. **Internal:** The Ontocurator model stays rich. It has segments, axes, provenance, hashes and rounds.
2. **Shared exchange format for span annotations:** a v2 of the Phentrieve sidecar `phenotype_annotation_bundle`. It is unified with the benchmark `AnnotationSet` and maintained as a JSON Schema in one repo (which one is an open question). It should contain:
   - document-relative codepoint offsets, NFC note and text hash;
   - separate axes `assertion`, `experiencer` and `temporality` instead of the mixed Phentrieve vocabulary;
   - provenance, i.e. human or tool, annotator and round;
   - language and document version.
3. **Phenopacket v2:** as a derived export. One package is produced per document or case; the sidecar references it. The mapping is:
   - `excluded` = `assertion == absent`;
   - `onset` and `resolution` from `temporality`;
   - evidence code for human curation ECO:0000218 ("manual assertion") instead of ECO:0007636;
   - `experiencer=family_member` is not recorded as a patient feature.

**Consequences**
- Phentrieve can read Ontocurator results directly as a gold standard.
- Ontocurator can import Phentrieve outputs as suggestions. This does **not** apply to benchmark annotations, see circularity.
- The offset inconsistency in Phentrieve (CLI document-relative, REST chunk-relative) must be fixed.

### 2.2 Web service with login and database

**Which database?** Relational, because the data is highly interconnected (user → assignment → document version → round → submission) and needs transactional consistency. Revision conflicts (409) and idempotency already exist.

**PostgreSQL** is the target server:
- JSONB for the content-addressed snapshot payloads;
- real concurrency for many users;
- row-level locks;
- good Docker images.

**SQLite** remains for local or single-user operation and for tests.

**Adapter:** SQLAlchemy 2 (Core or ORM) with Alembic migrations. This supports PostgreSQL and SQLite; MariaDB would be possible. It means migrating the existing raw-SQL repository to this layer.

**Document databases** such as MongoDB are unsuitable. They lack foreign-key and transaction guarantees for workflow states, and the team has no need for a flexible schema.

**Auth**
- Local accounts with Argon2 password hash. The Phentrieve implementation with JWT, refresh and CSRF serves as a template.
- Optional OIDC for Charité SSO or Keycloak.
- Roles: **Admin**, **Annotator**, **Reviewer/Adjudicator**. They are assigned per project.

**Docker**
- One image contains FastAPI and the embedded SPA.
- A Compose setup starts it together with PostgreSQL.
- The loopback restriction becomes a configurable operating mode.

**Admin page**
- Manage projects and work packages.
- Import texts, e.g. as TXT/ZIP, JSONL, the shared format or benchmark corpora.
- Manage ontologies.
- Manage users.
- Maintain assignments and workflow configuration.
- View progress and agreement.

### 2.3 Workflows

A project gets a configurable **sequence of stages**:
- **Sequential:** A annotates and releases, then B works on the result. This is close to today's `review` mode.
- **Parallel with adjudication:** A and B annotate independently. Then C merges or decides.

**New to build**
- **Assignment**, manual or automatic: random, balanced, k annotators per text.
- **Release** as a status transition.
- **Comparison view.**
- **Merge** with **tolerant span matching**:
  - Spans are normalized, i.e. whitespace and punctuation at the edges are trimmed.
  - After that, exactly equal spans count as identical.
  - Overlapping spans with the same term count as "compatible" and are suggested.
  - Only real differences produce a conflict.
- **Span suggestions:** Any user can suggest an alternative span for an annotation. This is modeled as a counterproposal, like `counterproposal` in the benchmark.
- **Agreement:** Inter-annotator agreement at term and span level. Algorithms from `hpo-span-annotator/merge.py` can be adopted.

### 2.4 Showing and hiding other annotators' annotations

- Instead of a mode choice at the start, the editor has a toggle "Show other annotations" and an option "open blind".
- **Scientifically important:** Whether someone has seen other annotators' annotations should be recorded in the submission.
- The admin should be able to "enforce blind" per project or stage. Today the `independent` mode guarantees this on the server side.

### 2.5 Tree: term ID and link (quick win)

- The ID is shown in the tree row, and there is a "view" link.
  - HPO: `https://hpo.jax.org/browse/term/HP:0001250`
  - Other ontologies: link template per ontology in the profile, OLS as fallback.
- Can be implemented immediately, independently of everything else.

### 2.6 Translation review and version switching

**New task type "Review translation"**
- Source text and translation are shown side by side.
- The translation is editable; changes are shown as a diff.
- Decisions per `TranslationReviewRecord`: unverändert akzeptiert, korrigiert akzeptiert, Rückfrage, abgelehnt. In addition there is a category for clinical changes.
- Replaces the benchmark's Excel roundtrip.

**Data model**
- A **document stem** (e.g. `EN100017`) has **variants** (language × text version). Each variant has a hash chain and `previous_*`.
- Annotation sets are attached to a variant and are themselves versioned.
- The UI switches between language, text version and annotation version.

**Spans across languages** are **not** projected automatically, in line with the benchmark decision. Sentence alignment for side-by-side reading would be possible later.

### 2.7 UI overhaul with Impeccable

- Comes at the end, after the backend.
- Goal: fewer clicks, e.g. more keyboard operation, fewer confirmation dialogs, selection without intermediate steps.
- On this occasion `App.tsx` and `CaseScreen.tsx` should be split up.
- **Note:** The Impeccable skill is **not installed** in the current Claude Code environment. It must be added back before this phase.

---

## 3. Proposed Breakdown into Subprojects

| # | Subproject | Depends on | Size |
|---|---|---|---|
| T0 | Tree: ID + external link | – | S |
| T1 | Shared span annotation format + Phenopacket export (spec across all three repos) | – | M |
| T2 | Server foundation: DB abstraction (SQLAlchemy/Alembic, PG+SQLite), accounts/auth/roles, Docker | T1 (schema principles) | L |
| T3 | Admin: projects, text import, users, assignment | T2 | M–L |
| T4 | Workflows: stages, release, parallel + adjudication, tolerant merge, span suggestions, blind toggle, agreement | T2, T3 | L |
| T5 | Document variants (language/version) + translation review | T2, T3 | M–L |
| T6 | UI overhaul (Impeccable), click reduction | T3–T5 | M |
| T7 | Integrations: benchmark import/export, Phentrieve reads gold/releases (no Phentrieve suggestions, E5) | T1 | M |

---

**Fixed order (E10):** T0 → T1 → T2 → T3 → T5 → T4 → T6. T7 runs alongside T1 and T3 and is connected there in each case.

## 4. Open Questions (to be resolved one by one)

Status: Questions 1–8 are answered, see §5. New detailed questions are resolved in the subproject specs.

1. **Operating mode:** Server only (Docker), or server **and** continued offline single-user operation (portable EXE)?
2. **Home of the shared format:** Phentrieve repo, benchmark repo, Ontocurator, or a separate small schema package?
3. **Users and login:** local accounts only, or integration with Charité SSO/OIDC? Who hosts, and are there data protection requirements (clinical texts, pseudonymization)?
4. **Phentrieve as a suggestion source:** allow in general, but block in the benchmark context (circularity)?
5. **Agreement and statistics:** in Ontocurator, or only export and evaluation in the benchmark?
6. **Backward compatibility:** Do v2 work packages and existing workspaces have to be migrated, or is an import sufficient?
7. **Order:** T0 immediately, then T1? And T5 (translations) before T4 (workflows), because 185 translations are awaiting review?
8. **Granularity of annotation versions:** Is every submission a version, or are there named releases such as "Gold v1"?

## 5. Decisions

- **E1 (question 1): server only.**
  - Ontocurator becomes a pure web service in Docker. The portable EXE and the loopback token model are dropped.
  - Locally it runs only via `docker compose up`.
  - Consequence for the database: PostgreSQL is the target. SQLAlchemy and Alembic stay nonetheless, so that the concrete database remains open.
  - Whether tests use SQLite or PostgreSQL via Testcontainers is decided in the T2 spec.
- **E2 (question 3, login): local accounts now, OIDC later.**
  - The admin creates users: email and password with Argon2 hash, invitation or password-setting link.
  - The auth layer is structured so that an OIDC provider (Charité SSO, Keycloak, GitHub) can be connected later.
  - Roles are always managed in Ontocurator.
  - The Phentrieve auth (JWT, refresh cookie, CSRF) serves as a template.
- **E3 (data protection): still open, but designed to be retrofittable.**
  - Projects are strictly isolated from each other. Every query is filtered by project membership.
  - An audit hook logs write actions. It remains extensible for read access.
  - Export permission is a separate right.
  - A deletion concept and hosting requirements are only developed once clinical texts are used.
- **E4 (question 2, format home): a separate, lightweight package.**
  - It is a new repo and PyPI package; the working title is `phenotype-annotation-schema`, the name is still open.
  - Contents: JSON Schema (draft 2020-12), Pydantic models, the Phenopacket v2 mapping and conformance fixtures.
  - It has no heavy dependencies. The `phenopackets` package is an optional extra.
  - Ontocurator, Phentrieve and the benchmark depend on it. The Phentrieve sidecar v1 is migrated to v2 of this schema.
- **E5 (question 4): Ontocurator stays free of Phentrieve.**
  - There is no live integration and no Phentrieve pre-annotation.
  - Phentrieve and the benchmark only **read** the Ontocurator results via the shared format.
  - This shrinks T7: benchmark import and export and the gold reader in Phentrieve remain; the suggestion source is dropped.
  - External suggestions, such as LLM suggestions from the benchmark, still come in via file import.
- **E6 (question 6): legacy data is not carried over.**
  - Real annotation has not started yet. There is no migration of `editor.db` and no requirement to import v2 packages.
  - The data model may be restructured for the server. Proven domain concepts are retained: codepoint segments, axes, provenance, hashes, immutable submissions.
  - Consequence for the benchmark: `build_editor_packages.py` is switched to the new import format, i.e. the shared format plus project import via the admin API.
- **E7 (question 5): agreement as a live overview in Ontocurator.**
  - Admin and adjudicator see agreement per project, per document and per annotator pair.
  - The values are F1 at term and span level, the latter tolerant, see 2.3.
  - The scientifically cited evaluation is produced reproducibly in the benchmark from the export.
  - There is only one definition of the matching rules. It lives in the shared schema package (E4), so that the live overview and the benchmark count the same way.
- **E8 (question 8): Who sees which annotation versions?**
  - Every user sees their **own versions**, i.e. their submissions.
  - All authorized users see the **releases**. A release is a named, frozen state such as "Gold v1".
  - Releases are created by the admin or by a person authorized per project or dataset, the *project lead*.
  - Other users' intermediate states are visible only in a workflow context, e.g. as adjudicator during merge or as the next editor in the sequential chain. This applies only as long as the blind rule allows it.
  - Terms:
    - **Version** is one's own submission.
    - **Stage result** is the released state of a workflow stage.
    - **Release** is a frozen, published state. The benchmark cites only releases.
- **E9 (roles):**
  - **Globally** there is the *system admin*. They manage users and ontologies and create projects.
  - **Per project** there are three roles:
    - *Project lead*: imports texts, configures assignment and workflow, creates releases and sees agreement.
    - *Annotator*.
    - *Adjudicator*: merges and makes the final decision.
  - Project roles can be combined freely.
  - As a project option, it can be enforced that the adjudicator of a document is not also an annotator of it.
- **E10 (question 7, order):** T0 tree → T1 format → T2 server → T3 admin → T5 variants and translation review → T4 workflows and merge → T6 UI.
  - Rationale: 185 translations are awaiting review.
  - Translation review has only one stage.
  - T4 needs the variant model anyway.

- **E11 (backend language): the backend stays in Python** (FastAPI, SQLAlchemy, Alembic). The frontend stays in TypeScript, and the OpenAPI contract with generated types connects the two.
  - Reason: E4/E7 require one shared implementation of validation and matching, and the benchmark and Phentrieve are Python. The backend's domain, ontology and search code (~12.8k lines, ~18.7k lines of tests) is kept.
  - The user's concern was performance. Measured on 2026-10-14 with the current code and HPO 2026-06-23 (no translation files):
    - ontology load ≈ 5.5 s once per process, ≈ 140 MB;
    - term search median 53 ms, p95 69 ms, max 84 ms (200 calls).
  - Implications:
    - Most requests are database-bound, where the language makes no difference.
    - One process handles ≈ 19 searches/s.
    - Scaling means more worker processes at ≈ 150 MB each.
    - Search latency is a matter of the algorithm (caching, prefix index), not of Python versus Node.
- **E12 (scale assumption):** 5–30 concurrent users; projects with hundreds to a few thousand documents. T2 sets concrete latency targets for this load and verifies them with a load test in the Docker setup.

## 6. Status of the Subprojects

| # | Spec | Status |
|---|---|---|
| T0 | `2026-10-14-t0-tree-term-id-link-design.md` | implemented and reviewed (branch `feat/tree-term-links`) |
| T1 | `2026-10-14-t1-shared-annotation-format-design.md` | implemented and reviewed in the private repository `janpower/ontospan` (PR #1) |
| T2 | `2026-10-14-t2-server-foundation-design.md` | design agreed |
| T3 | `2026-10-14-t3-admin-design.md` | design agreed |
| T5 | `2026-10-14-t5-variants-translation-review-design.md` | design agreed |
| T4 | `2026-10-14-t4-workflows-merge-design.md` | design agreed |
| T6 | UI overhaul with Impeccable | open. The Impeccable skill is not installed in the current environment. |
| T7 | `2026-10-14-t7-integrations-design.md` | plan written (`docs/superpowers/plans/2026-10-15-t7-integrations.md`), **parked** until a concrete consumer need (2026-10-15) |

Changes to the roadmap made while specifying:
- The format allows all HPO terms (including history and interventions) and modifiers. MAxO is planned (T1 F5–F7).
- Comments on annotations are part of T4 (W8).
- The start-of-session mode choice is replaced by stage tasks and the blind switch (T4 W2, W4).
