# Synthetic T5 acceptance inputs

These are public, generic inputs for the eventual local T5 acceptance package.
They contain no real people, credentials or benchmark corpus. Their presence
does not mean that a stack has been started or that T5 is accepted.

`demo.zip` was generated once with public `ontospan.write_bundle`, using the
unchanged pinned ontospan1.1.0 revision in `manifest.json`. The manifest hashes
the exact shipped bytes. The ZIP contains three separate synthetic English/German
cases, each with eight paragraphs: ready for review, failed automatic check, and
a separate case for seeded acceptance/annotation. Each German text has two
synthetic tool proposals with exact codepoint evidence and chosen/defaulted axis
provenance. Provider/model/run and checks are examples, not medical assessments.
`cases.json` records external identities and original text hashes. Internal
variant and assignment IDs must come from the real server.

`hp.json` exactly copies the small synthetic excerpt already in
`tests/fixtures/hp.json`, **not a complete HPO release**. `profile.json` derives
from the smoke profile with a separate example profile ID. The seed pins the
exact ontology SHA. See repository third-party notices and
https://hpo.jax.org/license for HPO terms and citation requirements. Do not use
the synthetic excerpt's tiny size as P9 latency evidence.

The host-only `scripts/seed_t5_acceptance.py` uses Python's standard library and
shipped CLI/API, with no test-module imports. `prepare --help` and `seed --help`
describe the actual interface. Preparation requires the caller's final immutable
local image ID, matching full OCI revision label, dedicated Compose project and
distinct loopback ports. It writes identity, image override, Compose environment,
persistent empty unused-build-token and command argument vectors only to a
**new** explicit `build/t5-acceptance/<run>` directory. It never starts, stops,
resets, builds or removes a stack. Generated commands must use their recorded
environment/files; root supplies literal tested commands and the real URL after
final packaging.

Only after that exact stack is running, migration has succeeded, services are
healthy, and the database contains only its bootstrap admin and no
projects/ontologies, `seed` creates the examples. Ordinary accounts are separate:

| Account | Project role | Languages | Initial work |
|---|---|---|---|
| demo-lead | lead only | en, de | Management, assignment, progress/export |
| demo-reviewer | annotator only | en, de; synthetic qualification | Fresh ready and failed-check translation reviews |
| demo-annotator | annotator only | de | Annotation of the separately reviewed/accepted text |

The seed consumes a third review through real open/save/submit to prepare the
independent annotation case. It never opens or submits the user's two pending
reviews. Correction/reanchor/pending-item demonstrations remain final packaged
validation using the proposal-bearing inputs; they are not preseeded or claimed
as completed here.

Random passwords are saved only in the explicitly chosen ignored local
`credentials.json`; setup codes/cookies remain in memory and are never printed.
Files use exclusive creation and POSIX mode0600; retain appropriate local
Windows directory permissions. A start marker prevents retry after partial
failure, and populated state is refused before seed writes. Ordinary restart
uses the same dedicated Compose project/files/environment, preserves both named
volumes and requires **no seed**. There is no automatic reset or volume deletion.

Final root closure must still merge the accepted runtime/UI parent, rebuild and
verify matching assets/image, review this adapter, actually start and seed the
persistent stack, check ordinary-role journeys/restart persistence and provide
the short German handoff. No runtime success, real credentials, free ports,
image identity or working URL is invented here. T4 workflow work, T6b, parked
T7, production operation and representative P9 latency remain separate.

## Separate full-HPO candidate

`full-hpo-sources.json` pins the official HPO **2026-09-01** release and its
translation files from source commit
`920d4eb3608b50a2c19ddb10290224ab35a759c5`. The release asset is
[`hp.json`](https://github.com/obophenotype/human-phenotype-ontology/releases/download/v2026-09-01/hp.json),
SHA-256 `a7b3a012e7b4007a35a7cf8da35f2373b54cc16907f80d13d62470d31f833501`.
The GitHub release API supplies the same digest. Translation paths are
`src/translations/` in that exact commit. Every source file has a SHA-256 pin;
the source manifest also records official Git blob identities.

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
They retain the official files' original statuses, including algorithm-generated
candidate translations; this preparation makes no claim that each translation
has been clinically reviewed. There is no Polish file in the pinned tree.
`dtp` and `nna` files exist upstream but are excluded because the current language
and filename contracts accept two-letter codes. Four synonym files (es, ja, pt,
zh) contribute no compatible name and are explicitly recorded as skipped.

Download the resources in the source manifest into a **new private ignored**
`build/t5-acceptance/<run>-sources` directory. Keep their exact filenames and
verify every SHA-256. Then regenerate a separate input set:

```powershell
uv run python scripts/prepare_full_hpo_acceptance.py `
  --source-dir build/t5-acceptance/<run>-sources `
  --output-dir build/t5-acceptance/<run>/inputs
```

The generator reads the public synthetic text/annotation templates, validates
their real HPO IDs against the full live ontology, regenerates the profile and
bundle with the full release pin and new identities, and writes a separate
`full-hpo/v1` input manifest. It preserves the six synthetic text hashes and exact
evidence coordinates. It never reuses the excerpt-pinned ZIP as the new output.
The old four-file manifest validation stays strict; the explicit new manifest
lists and hashes every contributing Babelon/synonym file.

Pass `--inputs-dir build/t5-acceptance/<run>/inputs` to `seed_t5_acceptance.py
prepare`. Seed then ingests the full ontology and every declared translation via
the existing `ontologies add` CLI **before** creating the pinned project.
Translation filenames are retained in the container so Babelon ingestion can
recognize their language.

The default preparation still requires clean Git source. For the authorized
uncommitted candidate workflow, first freeze `source_tree_digest()` from
`scripts/seed_t5_acceptance.py`, then build an immutable image with both labels:

```text
org.opencontainers.image.revision=<full base Git revision>
org.opencontainers.image.source-snapshot-sha256=<exact source tree digest>
```

Pass that digest as `--snapshot-sha256` to `prepare`, alongside the immutable
image ID and base revision. Preparation writes a private `source-snapshot.json`
with every tracked/unignored source filename and content digest, and checks that
the checkout still matches. Seed rechecks the snapshot and both image labels.
Ignored runtime data, downloaded ontologies and credentials are excluded; the
separate input manifest binds the downloaded and generated inputs. Finish all
source edits before freezing this identity. This mode does not claim the dirty
image is identical to its base revision.

The prepared 2026-10-18 input set is under the ignored
`build/t5-acceptance/full-hpo-20261018-candidate/inputs`. Its proposed Compose
project is `ontocurator-t5-acceptance-full-hpo`, application port **18190** and
PostgreSQL port **15590**, both loopback. These were free when checked; final
startup must recheck them. Final image binding, actual startup/seed and browser
acceptance belong to the integration package. The running phase0 demo on 18081
and its volumes have not been changed.
