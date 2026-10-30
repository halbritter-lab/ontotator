# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Leads can change a text's annotation mode after submissions: "Change mode…" names whose submitted work is discarded, the work is kept as discarded (not deleted) and "Restore…" brings it back while no new annotation has started (#109).
- A started project can move to a newer ontology release after a dry-run check; draft terms with one successor or merged ids are rewritten (#81).
- The text card says how a consolidation came about ("6 matching, 2 decided by Carla"), and the final export records per finding whether it was matched automatically, decided or added by the consolidator (`consolidations` in `receipt.json`, export format `ontotator-final-export/v2`) (#133).

### Fixed

- HPO releases without a modifier classifier root (Clinical modifier, Frequency, Severity, Onset) are refused (#97).
- The consolidation's duplicate-term warning fires only for findings of the same term on overlapping spans (#132).
- "Open consolidation" in the text card opens the lead's own running consolidation as their task instead of the read-only view (#145).
- The consolidator sees the lead's consolidation reason above the groups and in My tasks (`consolidation_reason` on the consolidation view and the task list) (#146).
- The consolidation launcher says under "Consolidator" who is listed and links Settings → People (#147).
- The "Submit consolidation?" dialog tells a lead consolidator to accept the result in Documents (#143).
- In a consolidation's full editor the submit button reads "Submit consolidation", and "Replaced by" explains itself (#162).

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

[Unreleased]: https://github.com/halbritter-lab/ontotator/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/halbritter-lab/ontotator/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/halbritter-lab/ontotator/releases/tag/v0.1.0
