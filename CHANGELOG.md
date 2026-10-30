# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The assign dialog marks system administrators with an *Administrator* badge (`system_admin` in the assignment batch preview), since the creator of a project is a member with every role (#177).
- The plain-text upload says that each file name without `.txt` becomes the text ID and which names are valid, and the preview lists file name → text ID (#174).
- Handbook screenshots in the in-app Help open at full size in a new tab (#173).
- The handbook in the app shows the running version and Git commit below its chapter list, for every logged-in user; `GET /api/v1/about` returns them. Published images carry the commit as `ONTOTATOR_REVISION`.

### Fixed

- A finding added in the consolidation no longer keeps its default values unchangeable: its values open right after "Add finding" and "Edit values…" changes them later, so a negated finding is exported as absent (#178).
- The consolidation group card shows each person's passage when overlapping passages differ, and a ✓ chooses which one goes into the result (#159).
- The consolidation result line names no term and nothing as "Not taken" until the Term row is chosen (#160).
- The read-only consolidation view tags the kept passage and modifiers with "kept", not only the term and values (#163).
- "Open consolidation" in the text card opens the lead's own running consolidation as their task instead of the read-only view (#145).
- The consolidator sees the lead's consolidation reason above the groups and in My tasks (`consolidation_reason` on the consolidation view and the task list) (#146).
- The consolidation launcher says under "Consolidator" who is listed and links Settings → People (#147).
- The "Submit consolidation?" dialog tells a lead consolidator to accept the result in Documents (#143).
- The full editor of a consolidation has no submit any more; it points back to the consolidation screen, where you submit, and "Replaced by" explains itself (#162).
- "Delete finding" in the editor can be undone with "Undo" in the message or Ctrl+Z, like removing a modifier (#150).
- An unresolved proposal is counted as "unresolved proposal", not as confirmed, and its prefilled values read "Defaults not confirmed" (#148).
- A default on a dropdown value field (such as Experiencer) can be confirmed on its own with "Confirm" (#149).
- After "Move to a new finding" the new finding is selected, not the original (#151).
- A new finding without a text span shows the term's name in "Selected term:"; a carried one lists its note as "Reason for no text span", and re-creating a carried finding keeps its note (#157).
- The submit dialog says what happens to values left unconfirmed: submitted as shown, recorded as defaulted (#164).
- The Work rounds dialog says before "Continue from this submission" that the earlier submission no longer counts as submitted, what the lead sees, and that the new round must be submitted again (#152).
- The text problem dialog no longer keeps "Your task is paused" after "Resume my task" (#155).
- The sidebar's "My tasks (n)" updates right after a submit or a new work round (#156).
- The first-time guidelines notice names where the guidelines are: "More › Guidelines" in the editor, the header button in translation review and consolidation (#154).
- The keyboard shortcut help (`?`) in the editor also lists the finding keys, and in review modes the decision keys, while they need a selection first, marked "not available right now" (#158).
- **Refresh** on Documents starts a new visit of the tab, so rows that left it (for example texts just assigned under To assign) drop out instead of staying until a tab switch (#176).
- **Pinned by** on Administration › Ontologies opens the project's Ontology settings tab; small settings cleanups (#168).

### Changed

- The OpenAPI version comes from the package version instead of a second hard-coded number.

## [0.3.0] - 2026-10-30

### Added

- A public project page with tutorial videos lives in `site/` and deploys to GitHub Pages.
- Leads can change a text's annotation mode after submissions: "Change mode…" names whose submitted work is discarded, the work is kept as discarded (not deleted) and "Restore…" brings it back while no new annotation has started (#109).
- A started project can move to a newer ontology release after a dry-run check; draft terms with one successor or merged ids are rewritten (#81).
- The text card says how a consolidation came about ("6 matching, 2 decided by Carla"), and the final export records per finding whether it was matched automatically, decided or added by the consolidator (`consolidations` in `receipt.json`, export format `ontotator-final-export/v2`) (#133).
- User handbook, shown in the app and kept in sync with the code (#141, #179).
- Synthetic demo project with a guide and upload files (#175).

### Fixed

- HPO releases without a modifier classifier root (Clinical modifier, Frequency, Severity, Onset) are refused (#97).
- The consolidation's duplicate-term warning fires only for findings of the same term on overlapping spans (#132).
- A lead can accept a result before every planned annotator has submitted; a translation review leads on to the next task (#136).
- The consolidation saves Add finding with the search made for it (#172).
- The task profile wins over the project's spanless setting (#130).

### Changed

- The Upload texts dialog is redesigned (#135).
- The text card shows one row per person (#139).
- The Users table folds each person's projects behind a count (#180).
- Clearer lead assign and member UI (#134).
- Deployment runbook for a pinned proxy network and managed hosting (#131).

## [0.2.0] - 2026-10-28

### Added

- `admin ontologies add --sha256` verifies an ontology file before import (#118).
- `admin ontologies check-roots` lists projects whose allowed roots are missing from their pinned release (#118).
- Three-letter HPO translation language codes such as `dtp` and `nna` (#118, migration 0025).
- Contributing guide, changelog, code of conduct and issue/PR templates (#126).

### Fixed

- Upload and background job robustness (#115).
- Ontology release, translation and term search issues (#118).
- Lead pseudonyms, result line punctuation and term search over-matching (#117).
- Issuing a password reset code now ends the user's sessions (#116).
- Query cost and lock-time issues, with new indexes (#114, migration 0024).
- Flaky Playwright tests, fixed at their root causes (#119).

### Changed

- Public documentation is in English and project-neutral (#122).
- Frontend linting with ESLint (#116).
- CI builds the Docker image on pull requests (#120); images are published to GHCR from a separate tag-only workflow (#121).
- GitHub Actions dependency updates (#110, #111, #112, #113).
- New findings must come from the project's allowed ontology roots; the editor search only offers those terms (#118).
- Repository cleanup for public use (#126).

## [0.1.0] - 2026-10-28

First public release.

[Unreleased]: https://github.com/halbritter-lab/ontotator/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/halbritter-lab/ontotator/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/halbritter-lab/ontotator/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/halbritter-lab/ontotator/releases/tag/v0.1.0
