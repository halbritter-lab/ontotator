# Synthetic acceptance inputs

Public, synthetic inputs for seeding a local demo stack that can be used for
manual acceptance testing. They contain no real people, credentials or
benchmark corpus.

`demo.zip` was generated with public `ontospan.write_bundle`, using the pinned
ontospan 1.1.0 revision in `manifest.json`. The manifest hashes the exact shipped
bytes. The ZIP contains three separate synthetic English/German cases, each with
eight paragraphs: ready for review, failed automatic check, and a separate case
for seeded annotation. Each German text has two synthetic tool proposals with
exact codepoint evidence and chosen/defaulted axis provenance. Provider/model/run
and checks are examples, not medical assessments. `cases.json` records external
identities and original text hashes. Internal variant and assignment IDs must
come from the real server.

`hp.json` exactly copies the small synthetic excerpt in `tests/fixtures/hp.json`,
**not a complete HPO release**. `profile.json` derives from the smoke profile with
a separate example profile ID. The seed pins the exact ontology SHA. See the
repository third-party notices and https://hpo.jax.org/license for HPO terms and
citation requirements. Do not use the excerpt for performance measurements.

## Seeding a stack

The host-only `scripts/seed_acceptance.py` uses Python's standard library and the
shipped CLI/API, with no test-module imports. `prepare --help` and `seed --help`
describe the interface. Preparation requires an immutable local image ID, a
matching full OCI revision label, a dedicated Compose project
(`ontotator-acceptance[-suffix]`) and distinct loopback ports. It writes identity,
image override, Compose environment, an empty unused-build-token file and command
argument vectors only to a **new** explicit `build/acceptance/<run>` directory. It
never starts, stops, resets, builds or removes a stack.

Only after that exact stack is running, migration has succeeded, services are
healthy, and the database contains only its bootstrap admin and no
projects/ontologies, `seed` creates the examples. Ordinary accounts are separate:

| Account | Project role | Languages | Initial work |
|---|---|---|---|
| demo-lead | lead only | en, de | Management, assignment, progress/export |
| demo-reviewer | annotator only | en, de; synthetic qualification | Fresh ready and failed-check translation reviews |
| demo-annotator | annotator only | de | Annotation of the separately reviewed/accepted text |

The seed consumes a third review through real open/save/submit to prepare the
independent annotation case. It never opens or submits the two pending reviews.

Random passwords are saved only in the explicitly chosen ignored local
`credentials.json`; setup codes and cookies stay in memory and are never printed.
Files use exclusive creation and POSIX mode 0600; keep appropriate local Windows
directory permissions. A start marker prevents retry after partial failure, and
populated state is refused before seed writes. An ordinary restart uses the same
Compose project, files and environment, preserves both named volumes and needs
**no seed**. There is no automatic reset or volume deletion.

## Full-HPO input set

`full-hpo-sources.json` pins the official HPO **2026-09-01** release and its
translation files from source commit
`920d4eb3608b50a2c19ddb10290224ab35a759c5`. The release asset is
[`hp.json`](https://github.com/obophenotype/human-phenotype-ontology/releases/download/v2026-09-01/hp.json),
SHA-256 `a7b3a012e7b4007a35a7cf8da35f2373b54cc16907f80d13d62470d31f833501`.
Translation paths are `src/translations/` in that exact commit. Every source file
has a SHA-256 pin; the source manifest also records official Git blob identities.

The full ontology has 20,482 terms, including 19,894 live terms. Compatible
translations contribute names for these live-term counts:

| Code | Terms with translated names |
| --- | ---: |
| cs | 16,558 |
| de | 3,615 |
| es | 18,980 |
| fr | 13,570 |
| it | 3,374 |
| ja | 17,292 |
| nl | 12,499 |
| pt | 7,050 |
| tr | 13,797 |
| tw (Twi) | 82 |
| zh | 18,847 |

These are search aliases for the canonical HPO IDs and English preferred names.
They keep the official files' original statuses, including algorithm-generated
candidate translations; no claim is made that each translation has been clinically
reviewed. `dtp` and `nna` files exist upstream but are excluded because the
language and filename contracts accept two-letter codes. Four synonym files (es,
ja, pt, zh) contribute no compatible name and are recorded as skipped.

Download the resources in the source manifest into a **new private ignored**
`build/acceptance/<run>-sources` directory. Keep their exact filenames and verify
every SHA-256. Then generate a separate input set:

```powershell
uv run python scripts/prepare_full_hpo_acceptance.py `
  --source-dir build/acceptance/<run>-sources `
  --output-dir build/acceptance/<run>/inputs
```

The generator reads the synthetic text/annotation templates, validates their HPO
IDs against the full live ontology, regenerates the profile and bundle with the
full release pin and new identities, and writes a separate `full-hpo/v1` input
manifest. It preserves the six synthetic text hashes and exact evidence
coordinates and never reuses the excerpt-pinned ZIP. The four-file manifest
validation stays strict; the full-HPO manifest lists and hashes every
contributing Babelon/synonym file.

Pass `--inputs-dir build/acceptance/<run>/inputs` to `seed_acceptance.py prepare`.
Seed then ingests the full ontology and every declared translation via the
`ontologies add` CLI **before** creating the pinned project. Translation filenames
are kept in the container so Babelon ingestion can recognize their language.

## Uncommitted source trees

Preparation requires a clean Git checkout by default. To seed an image built from
uncommitted changes, first freeze `source_tree_digest()` from
`scripts/seed_acceptance.py`, then build an immutable image with both labels:

```text
org.opencontainers.image.revision=<full base Git revision>
org.opencontainers.image.source-snapshot-sha256=<exact source tree digest>
```

Pass that digest as `--snapshot-sha256` to `prepare`, alongside the immutable image
ID and base revision. Preparation writes a private `source-snapshot.json` with every
tracked/unignored source filename and content digest, and checks that the checkout
still matches. Seed rechecks the snapshot and both image labels. Ignored runtime
data, downloaded ontologies and credentials are excluded; the separate input
manifest binds the downloaded and generated inputs. This mode does not claim the
image is identical to its base revision.
