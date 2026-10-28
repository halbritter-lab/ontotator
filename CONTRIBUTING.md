# Contributing

Thanks for your interest in Ontotator. Bug reports, feature ideas and pull requests are welcome.

## Development setup

Follow [Run from source](README.md#run-from-source) and [Development](README.md#development) in the README. In short: `uv sync --dev --locked`, `npm --prefix frontend ci`, and a running Docker for the PostgreSQL and browser tests.

## Checks

Run the full gate locally with `bash scripts/check.sh`, or `bash scripts/check.sh --quick` for static checks plus the tests affected by your change (see [local checks](docs/operations/local-checks.md)). You can also run the single tools for the area you touched and rely on CI: every pull request runs the full gate on GitHub Actions. A pull request is ready for review when CI is green.

API changes must keep the committed OpenAPI and TypeScript contracts in sync; the gate fails on drift.

## Branches and pull requests

- Branch from `main` and name the branch after the change type, for example `fix/term-search`, `feat/export-filter`, `docs/readme` or `chore/repo-tidy`.
- Keep one topic per pull request and reference related issues (`Fixes #123`).
- Pull requests are squash-merged into `main`.

## Commit messages

Use short, imperative subjects in the [Conventional Commits](https://www.conventionalcommits.org/) style seen in the history: `fix: ...`, `feat: ...`, `docs: ...`, `test: ...`, `ci: ...`, `build: ...`, `chore: ...`, optionally with a scope such as `fix(problems): ...`.

## Security

Do not report vulnerabilities in public issues; see [SECURITY.md](SECURITY.md).

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
