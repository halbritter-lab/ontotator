# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Upload and background job robustness (#115).
- Ontology release, translation and term search issues (#118).
- Lead pseudonyms, result line punctuation and term search over-matching (#117).
- Sessions now end when a reset code is used (#116).
- Query cost and lock-time issues (#114).
- Flaky Playwright tests, fixed at their root causes (#119).

### Changed

- Public documentation is in English and project-neutral (#122).
- Frontend linting with ESLint (#116).
- CI builds the Docker image on pull requests (#120); images are published to GHCR from a separate tag-only workflow (#121).
- GitHub Actions dependency updates (#110, #111, #112, #113).

## [0.1.0] - 2026-10-28

First public release.

[Unreleased]: https://github.com/halbritter-lab/ontotator/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/halbritter-lab/ontotator/releases/tag/v0.1.0
