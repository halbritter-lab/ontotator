# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Leads can change a text's annotation mode after submissions: "Change mode…" names whose submitted work is discarded, the work is kept as discarded (not deleted) and "Restore…" brings it back while no new annotation has started (#109).

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
