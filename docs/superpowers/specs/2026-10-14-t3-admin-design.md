# T3: Administration (projects, text import, users, distribution)

Date: 2026-10-14 · Status: **design agreed** · Part of the roadmap `2026-10-14-roadmap-web-service-analysis.md` (E3, E8, E9) · Builds on T2

T3 replaces the T2 command-line administration with browser pages for system admins and project leads, and adds distributing documents to people.

## Starting point after T2

- Accounts, sessions, projects, memberships and roles exist. They are managed by `ontocurator admin …` CLI commands.
- Documents and proposals are imported in the T1 format only.
- Every project member sees every document of the project. There is no assignment.

## Decisions

- **A1, upload formats:** T1 bundles and plain-text files. Table formats (CSV/TSV/XLSX) and JSONL are not supported. Scripts produce T1 bundles instead.
  - **T1 bundle** (ZIP or a single annotated-document JSON):
    - It is lossless and validated by the T1 package.
    - Contained annotation sets become proposals (`tool` or `human` provenance kept).
    - The bundle's `allowed_roots` and ontology pins must match the project, otherwise the import is refused with the difference listed.
  - **Plain text:**
    - Input is single `.txt` files or a ZIP of them. The file name without extension becomes `document_id`.
    - Language is chosen once per upload.
    - Files must be UTF-8 (a BOM is stripped). Other encodings are refused with the file named; there is no guessing.
    - Text is normalised to NFC and LF (T1 F2). `source_text_sha256` records the original bytes.
  - **Preview before commit.** Every upload shows a preview first:
    - number of documents;
    - duplicates by `text_sha256` within the project;
    - `document_id` collisions;
    - normalisation changes (count of affected files);
    - validation errors.

    Nothing is written until the project lead confirms. The import then runs as a job (T2 P6) and is recorded in `audit_events`.
  - **Collisions:** an existing `document_id` with different text is refused in T3. Versions of a text are introduced with T5.
- **A2, distribution is primarily manual.**
  - The project lead (or system admin) selects documents (multi-select, filterable by language and status) and assigns them to people.
  - Only **project members** can be assigned. The server rejects anyone else.
  - **Optional automatic proposal.**
    - Every user profile lists the languages the person reads (`user_languages`, ISO 639-1). It is maintained by the user and editable by admins.
    - On request the system proposes a distribution: each selected document goes only to members who read its language. Load is balanced, and the random tie-break uses a recorded seed, so the proposal is reproducible.
    - The proposal is shown as a table, can be edited, and is written only on confirmation.
    - Documents without a suitable member are listed separately and never silently skipped.
  - Every assignment change is recorded in `audit_events`.
- **A3, visibility:** annotators and adjudicators see **only their assigned documents**. Project leads and system admins see all documents of the project, including progress per person. The server enforces this; the UI only reflects it.
- **A4, assignment model.**
  - An assignment is `(project, document, user, task)` with a status: `open`, `in_progress`, `submitted` or `reopened`.
  - Tasks in T3 are `annotate` and `review`, which correspond to today's independent and review modes. T4 adds stage-based tasks (e.g. `adjudicate`) and T5 adds `translation_review`.
  - **Reassignment:** reassigning an assignment that has already started needs confirmation. The previous draft stays attributed to its author (D6 edit log), and the new assignee starts from the document's inputs, not from someone else's draft.
  - The project lead can **reopen** a submitted assignment, for example after a guideline change. A reopened assignment produces a new submission; earlier submissions stay immutable.
- **A5, admin pages.**
  - **Users** (system admin):
    - create users and issue setup codes;
    - deactivate and reactivate users;
    - issue reset codes;
    - set or unset the system admin flag;
    - edit a user's languages.

    Users edit their own display name, languages, ORCID and the consent to be named (T1 F10).
  - **Projects** (system admin creates; project lead configures):
    - name and description;
    - document languages;
    - pinned ontology and `allowed_roots`;
    - profile options (`require_chosen_axes`, adjudicator-not-annotator);
    - annotation guideline as URL plus version label, which is exported as `guideline_ref`;
    - members and their roles.
  - **Ontologies** (system admin): upload OBO Graph JSON and translation files. They are listed with release and SHA-256 and the projects that pin them.
  - **Documents** (project lead): upload (A1), a list with language, status and assignees, and assignment (A2).
  - **Progress** (project lead): per document and per person, the counts of open, in progress and submitted. Live agreement follows in T4 (E7).
  - **Export** (project lead): T1 bundle of submitted results and the optional edit-log export (T2 D6).

## Not in T3

- Due dates for assignments. They were deliberately left out and can be added later.
- Stage-based workflows, merge, blind toggle and live agreement (T4).
- Document variants and translation review (T5).
