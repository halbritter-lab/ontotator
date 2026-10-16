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
