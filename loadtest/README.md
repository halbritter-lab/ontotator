# Representative P9 load test

Use a fresh, disposable **dev** Compose project. The script refuses the small
fixture ontology: pass a real `hp.json` release from 2026-06-23 or newer. Its SHA256
and release are recorded in the generated manifest. All documents, proposals and
accounts are synthetic. Credentials come from CLI/environment and are never
written into the corpus or manifest.

From the repository root (PowerShell example):

```powershell
uv sync --dev --locked
# Supply a synthetic password of at least 12 characters through your environment.
# ONTOCURATOR_LOAD_PASSWORD must match for seeding and Locust.
uv run python loadtest/seed.py --hpo C:/path/to/hp.json --compose-project t2e-load-unique --compose-file docker-compose.dev.yml --host http://127.0.0.1:8000
```

Start the dev stack beforehand with its normal database/admin bootstrap settings.
`--compose-project` is mandatory for seeding; `--compose-file` and `--host` target
the same stack. `--compose-file` defaults to `docker-compose.dev.yml`; override it
explicitly for another Compose configuration. The service is named `app`, and
its CLI obtains the database and data directory from the service environment.
Seeding streams file bytes over `docker compose exec -T` into the app container's
writable `/tmp`, and uses `ontocurator admin` for the project, users, memberships
and one T1 import,
and HTTP code redemption for passwords. It does not start or stop containers.
Rerun against a fresh project/volume: existing users/projects intentionally cause
an error rather than modifying an unknown dataset. Do not reuse real credentials.

For offline corpus validation only:

```powershell
uv run python loadtest/seed.py --hpo C:/path/to/hp.json --prepare-only
```

The fixed RNG seed is 20261014. The corpus contains 1,000 documents of 1,500–3,000
characters with real active HPO phenotype labels, three proposals per document,
and a tool actor named `ontocurator-load`, version `1.0.0`. The T1 bundle, pinned
profile and Locust manifest are under `loadtest/results/seed/` by default; use
`--out` to change that and `--load-manifest` when invoking Locust.

Workers discover uploaded ontologies automatically and load them on first use.
Warm the stack and its lazy indexes separately, then take a fresh five-minute
measurement. Keep the warmup artifacts separate from the report:

```powershell
uv run locust -f loadtest/locustfile.py --headless -u 30 -r 5 -t 1m --host http://127.0.0.1:8000 --csv loadtest/results/warmup
uv run locust -f loadtest/locustfile.py --headless -u 30 -r 5 -t 5m --host http://127.0.0.1:8000 --csv loadtest/results/measured --html loadtest/results/measured.html
```

Use one local Locust process; distributed runs are refused to prevent duplicate
account assignment. Thirty users each log in once with a session cookie, Origin
and CSRF token. The seed raises the project's annotations per text to five
(the maximum) through a synthetic lead and assigns each user one sixth of the
corpus, so every text has five annotators. Tasks open random documents from the
user's own assignments in `proposal_check` mode (the seeded tool proposals make
that the assignments' mode), send a note with each spanless finding, and use
4–12 character HPO-label substrings using a deterministic per-user RNG. Weights are search 5, open 2,
write 4 and dashboard 1, with 0.5–1.5 seconds think time. Each write task sends
two commands, `create_annotation` and `set_axes`; the `write` measurement pools
both command requests, so it has twice as many requests as write task executions.
Each draft uses its returned revision and each command a fresh mutation ID.
Reopening a draft refreshes the revision. Requests are never retried after an
ambiguous failure; failed users stop and the run fails acceptance.

The command URL is `/api/v1/workspaces/{id}/commands`, as defined by the current
router. Search carries the returned workspace key and layer `hpo`. The final
table prints request p50/p95/p99 for search/open/write/dashboard. Strict p95
limits are respectively **150/300/150/500 ms**; equality, missing samples,
HTTP failures, auth/setup failures or unexpected revisions fail the run with exit
code 1. Locust percentiles are histogram estimates. The measured run includes its
six-second user ramp; warmup is a distinct process and contributes no samples.

Record the real machine CPU/RAM, Docker Desktop version, image digest, HPO
release/SHA, document count, workload/think time, full Locust table and outcomes
in `docs/operations/load-test-2026-10.md`. Verify the measured stack has app
**2 CPU / 2 GiB and 2 workers**, PostgreSQL **1 CPU / 1 GiB**; record the actual
Compose limits. A harness parse/test pass is not a performance result. If a
measured target misses, record it and profile the slowest endpoint with `py-spy
dump` or PostgreSQL `EXPLAIN ANALYZE`; stop before tuning. Preserve CSV/HTML and
container resource evidence alongside the report. Generated results may contain
session-derived workspace IDs; keep them local unless deliberately publishing.
