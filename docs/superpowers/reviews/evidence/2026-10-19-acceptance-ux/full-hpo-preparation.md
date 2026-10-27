# Task 13 full-HPO candidate preparation

Task13 implementation, isolated inputs and full-index timing are complete. Runtime remains unbound until Task14 freezes the final source/image identity. No demo containers, credentials or volumes were changed.

## Exact input identity

- Official release: [HPO v2026-09-01](https://github.com/obophenotype/human-phenotype-ontology/releases/tag/v2026-09-01), published 2026-09-03.
- Official hp.json asset: 21,915,519 bytes; SHA-256 `a7b3a012e7b4007a35a7cf8da35f2373b54cc16907f80d13d62470d31f833501`. Downloaded bytes match the GitHub release API digest.
- Official translation source commit: `920d4eb3608b50a2c19ddb10290224ab35a759c5`, actual directory `src/translations/`. Each downloaded translation matches its official Git blob SHA-1 and its recorded SHA-256.
- Public source manifest: `examples/t5-acceptance/full-hpo-sources.json` (metadata only).
- Private verified source cache: `build/t5-acceptance/full-hpo-20261018-sources` (22 resources, 62,305,240 bytes).
- Private generated input set: `build/t5-acceptance/full-hpo-20261018-candidate/inputs`.
- Separate generated bundle pin: `0b152250a7655421c4742f968ad4eb2b629e1307603441255a90979d52bd77c3`; profile pin `e3ee69aca57165cb3734b27fd2bb93bf819fe14c8b1344e40a97ead08c00ad13`.
- Generator writer: installed ontospan 1.2.0 / commit `738f3d43ca0896c9d146a15fb9538b938229368a`. Existing public four-file fixture is unchanged.

## Coverage

20,482 total HPO terms, 19,894 live. Six regenerated synthetic documents / six proposals use real live `HP:0001250` and `HP:0001252`. Existing clinical text hashes and exact evidence coordinates are preserved while bundle/annotation-set/profile identities and every ontology pin are regenerated.

Contributing translation term counts: cs: 16,558; de: 3,615; es: 18,980; fr: 13,570; it: 3,374; ja: 17,292; nl: 12,499; pt: 7,050; tr: 13,797; tw: 82; zh: 18,847. `tw` is Twi. All 17 contributing per-language Babelon/synonym files are declared for CLI ingestion. Four empty/noncontributing synonym files are recorded as skipped. `dtp` and `nna` exist upstream but do not fit the current two-letter language contract; Polish is absent upstream at this pin. Raw official files retain their source translation statuses; no clinical-review claim is added.

## Isolation and source identity

Private `candidate-plan.json` proposes Compose project `ontotator-t5-acceptance-full-hpo`, app 18190 / PostgreSQL 15590 on loopback; these ports were free when inspected. The running phase0 demo remains on 18081. Final runtime must recheck free ports and bind the exact final immutable image.

The seed adapter supports explicit `--inputs-dir` for `full-hpo/v1` manifests while retaining original strict four-file validation. It stages translations under their exact Babelon filenames and ingests them before project creation.

Default preparation still refuses dirty Git source. Explicit `--snapshot-sha256` supports authorized uncommitted work, with a content manifest of tracked/unignored source, exact base revision, and required matching OCI image snapshot label. Seed rechecks source bytes, input pins and immutable image labels. This does not mislabel a dirty candidate as its base HEAD. No build/start was performed before the integration owner's freeze.

## Evidence

- Seed/full-manifest/snapshot additions: red5 → green69 tests.
- Offline builder: expected missing generator red → green71 tests.
- Exact image snapshot identity: missing guard red → green72 tests.
- Latest DB-free verification: `uv run pytest tests/test_seed_t5_acceptance.py tests/test_translation_files.py tests/test_search_translations.py -q --noconftest`:72 passed. This disables only the global PostgreSQL autouse harness; these three files' tested behavior is offline/DB-free. An earlier normal run passed69; a later normal run hit a transient repository indentation error while the workflow owner was editing, so it was not counted as product evidence.
- `uv run ruff check` for both scripts and affected tests: exit0. `ruff format` applied.
- `git diff --check` for Task13 files: exit0.

## Measured standalone responsiveness

Real full-HPO plus all 17 contributing translation files loaded and indexed in 24.667 seconds on this Windows/Python host. The measurements are saved in private `build/t5-acceptance/full-hpo-20261018-candidate/search-measurements.json` with environment, exact pin and returned result identities.

| Query / language mode | First query | Warm median (5 samples) |
| --- | ---: | ---: |
| Krampfanfall / all | 5.46 ms | 4.47 ms |
| Hypotonie / all | 4.96 ms | 5.00 ms |
| Hipotonía / all | 4.85 ms | 4.02 ms |
| Hypotonie / German only | 2,494.09 ms | 1.56 ms |
| Seizure / English only | 2,356.70 ms | 1.37 ms |
| hypoton / all (lexical partial query) | 4.72 ms | 4.87 ms |

German/Spanish aliases return the same checked canonical HPO IDs and English preferred labels (`HP:0001250` / `HP:0001252`). First language-subset queries fit a separate index, causing an approximately 2.4-second cold delay; this is an observed integration/performance limit, not hidden by warm timings. The process exited cleanly. Peak working-set instrumentation was unavailable and is explicitly null; no memory claim is made. No HTTP, concurrency or browser latency claim follows from this host-only measurement.

## Remaining integration work

- Task14 final source snapshot/image freeze, isolated Compose startup/seed, real ordinary-role journeys, restart persistence and browser acceptance. No manual acceptance is claimed here.
