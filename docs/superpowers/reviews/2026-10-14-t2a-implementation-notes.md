# T2a implementation notes

Deviations from `docs/superpowers/plans/2026-10-14-t2a-postgres-storage.md` found while executing it.
Each entry: task, what the plan said, what was done instead, why.

## Baseline (Task 0)

- Worktree from `main` at `50cee7e`. Baseline: 661 backend tests, 323 frontend tests, all passing.
- `docker version --format '{{.Server.Version}}'` prints the literal template in Git Bash on this machine; `docker version` without `--format` shows the server (Docker Desktop 4.95.0, engine 29.8.2).

## Deviations

