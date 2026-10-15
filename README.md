# Ontocurator

Ontocurator is a self-hosted, multi-user web editor for annotating and reviewing biomedical ontology concepts on clinical text. Users sign in with individual accounts; projects, ontology releases and imports are managed through the administrator CLI.

The server stores accounts, sessions, projects and annotations in PostgreSQL, with blobs, ontology files, translations and exports on a persistent data volume. The image includes the React frontend and local ontology search. It needs no internet access at runtime. Ontology releases are supplied by the operator.

## Deploy the server

This repository ships a Docker image and a Compose contract for PostgreSQL, schema migrations and the application. Your deployment repository supplies the host, DNS, HTTPS certificates and reverse proxy (for example Nginx Proxy Manager). The production application has no published host port.

Follow the [operations guide](docs/operations.md) for building with the private `ontospan` dependency, separate service secrets, first start, users and projects, upgrades, backups and offline administrator recovery. Copy [docker/env.example](docker/env.example) to a private `.env` and replace its image and network settings; the example contains no production credentials. Deploy a verified image digest.

## Try a disposable development stack

Use Docker with Compose v2. All credentials in `docker-compose.dev.yml` and `docker/dev-passwords/` are **public, DEVELOPMENT ONLY** fixtures. Never expose or deploy this stack.

The build needs a GitHub token with read access to the pinned private `ontospan` repository. Set `GITHUB_TOKEN_FILE` to the absolute path of a private token file; Compose passes it as a BuildKit secret. See the [build instructions](docs/operations.md#build-and-verify-an-image) for an alternative build using a process environment secret.

```bash
export GITHUB_TOKEN_FILE=/absolute/path/to/private-github-token
docker compose -f docker-compose.dev.yml up -d --build --wait
```

Open `http://127.0.0.1:8000` and log in as **`admin` / `development-only-password`**. PostgreSQL is bound to `127.0.0.1:55432`. Set `ONTOCURATOR_DEV_PORT` and `ONTOCURATOR_DEV_PG_PORT` before starting to choose other loopback ports; the application origin follows the selected HTTP port. Use `docker compose -f docker-compose.dev.yml` for every command against this stack. Its standalone configuration is not a production override.

## Curation workflow

An administrator loads pinned OBO Graph JSON ontology releases and optional Babelon translations, creates a project with its task profile, gives people project roles, and imports documents and tool proposals in T1 (ontospan) bundles. The browser supports independent annotation, review with visible source provenance, layer-specific completion checks and revision conflict detection. Exported submissions and pseudonymised edit logs support downstream analysis.

See the [scientific workflow](docs/scientific-workflow.md) for a small two-annotator pilot, and the [operations CLI examples](docs/operations.md#users-ontologies-and-projects) for server administration. Historical [V2 work-package documentation](docs/work-package-v2.md) describes the earlier interchange boundary; current server imports and exports use T1 bundles. The running server uses PostgreSQL.

## Development checks

Install Python 3.11+, `uv`, Node.js/npm and Docker. Dependency installation requires GitHub read access to `ontospan` (for example through your existing Git credential helper).

```bash
uv sync --dev --locked
npm --prefix frontend ci
npm --prefix frontend exec -- playwright install chromium
bash scripts/check.sh
CHECK_CONTAINERS=1 bash scripts/check.sh
```

Run the gate from Git Bash, Linux or macOS. It covers linting, formatting, typing, OpenAPI/TypeScript drift, wheel contents, unit tests and browser tests. Docker must be running for the PostgreSQL tests, or `ONTOCURATOR_TEST_PG_URL` must name a disposable test PostgreSQL superuser database. Container checks additionally need Docker and a build secret or a verified reusable image. There is no active CI gate; run the local checks before merging. See [local verification](docs/operations.md#local-verification) and the [representative load-test harness](loadtest/README.md). A passing harness test is not a measured performance result.

## Licensing

Ontocurator does not bundle ontology releases. Observe the license and citation requirements for every release you load, including the [Human Phenotype Ontology](https://hpo.jax.org/license). Bundled dependencies and third-party code are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
