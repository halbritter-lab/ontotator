"""Real local backend for Playwright; synthetic data and temporary storage only."""

import hashlib
import io
import os
import sys
import tempfile
from pathlib import Path

import uvicorn
from fastapi import Query, Request
from fastapi.responses import Response
from pg_harness import database_url_for

from ontocurator.api.app import create_app
from ontocurator.auth.accounts import AccountService
from ontocurator.auth.audit import Actor
from ontocurator.config import AppConfig
from ontocurator.domain.annotations import ActorRef, Annotation, Provenance, snapshot
from ontocurator.domain.documents import (
    Document,
    EvidenceMention,
    EvidenceRef,
    EvidenceSnapshot,
    Segment,
)
from ontocurator.domain.profiles import (
    AnnotationTypeDefinition,
    AxisDefinition,
    LayerDefinition,
    OntologyDefinition,
    TaskProfile,
    profile_hash,
)

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ontocurator.packages.models import PackageManifest, ValidatedPackage  # noqa: E402
from ontocurator.packages.writer import PackageWriter  # noqa: E402
from tests.layered_fixtures import HP_DIGEST, make_layered_package  # noqa: E402

ONTOLOGY = ROOT / "tests/fixtures/hp.json"
MONDO_ONTOLOGY = ROOT / "tests/fixtures/mondo.json"
PORT = int(os.environ.get("HPO_E2E_PORT", "18765"))
# The password of every user that ``/__test_user__`` sets up (frontend/browser/helpers.ts).
TEST_PASSWORD = "browser test passphrase"


def fixture_package(
    package_id: str = "browser-fixture",
    created_at: str = "2026-10-01T00:00:00Z",
    proposals: list[tuple[str, str, int, int]] | None = None,
) -> bytes:
    hp_ont = OntologyDefinition(
        ontology_id="hp",
        label="Human Phenotype Ontology",
        release="2026-06-23",
        sha256=HP_DIGEST,
        format="obo-graph-json",
        resource_path="ontologies/hp.json",
    )
    pheno_type = AnnotationTypeDefinition(
        type_id="phenotype",
        label="Phenotype",
        axes=[
            AxisDefinition(
                id="assertion",
                label="Assertion",
                options=["present", "absent", "uncertain"],
                allow_empty=True,
            ),
        ],
        evidence_policy="optional",
    )
    layer = LayerDefinition(
        layer_id="hpo-layer",
        label="Phenotypes",
        ontology_id="hp",
        access="editable",
        default_visible=True,
        default_type_id="phenotype",
        annotation_types=[pheno_type],
    )
    profile = TaskProfile(
        profile_id="hpo-context-browser/v1",
        version="1.0.0",
        ontologies=[hp_ont],
        layers=[layer],
        default_layer_id="hpo-layer",
    )

    text = "Hypotonia and seizure. A😀e\u0301\r\nB"
    doc = Document(
        document_id="browser-doc",
        text=text,
        language="en",
        text_sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(),
    )
    annotations, evidence = {}, {}
    for number, (kind, term, start, end) in enumerate(
        proposals
        or [
            ("human", "HP:0001252", 0, 9),
            ("tool", "HP:0001250", 14, 21),
        ]
    ):
        ev = EvidenceSnapshot.create(
            mention=EvidenceMention(
                evidence_id=f"ev-{number}", segments=[Segment(start=start, end=end)]
            ),
            document=doc,
        )
        ann = Annotation(
            annotation_id=f"proposal-{number}",
            document_id=doc.document_id,
            layer_id="hpo-layer",
            type_id="phenotype",
            term_id=term,
            axes_values={"assertion": "present"},
            evidence_refs=[
                EvidenceRef(evidence_id=ev.mention.evidence_id, version=ev.version)
            ],
            provenance=Provenance(
                actor=ActorRef(actor_id=f"source-{number}", kind=kind), method="fixture"
            ),
        )
        snap = snapshot(ann, [ev], doc, profile)
        annotations[(ann.annotation_id, snap.version)] = snap
        evidence[(ev.mention.evidence_id, ev.version)] = ev

    pkg = ValidatedPackage(
        manifest=PackageManifest(
            package_id=package_id,
            format_version="ontocurator-work-package/v2",
            document_order=["browser-doc"],
            task_profile=profile,
            task_profile_sha256=profile_hash(profile),
            created_at=created_at,
        ),
        documents={doc.document_id: doc},
        annotations=annotations,
        evidence=evidence,
    )
    result = io.BytesIO()
    PackageWriter.write_to_stream(pkg, result)
    return result.getvalue()


# 30 tool proposals: enough to overflow the case sidebar at any window height.
MANY_PROPOSALS = [
    ("tool", "HP:0001252", 0, 9) if number % 2 == 0 else ("tool", "HP:0001250", 14, 21)
    for number in range(30)
]


def scenario_package(scenario: str) -> bytes:
    fixture_scenario = "assisted" if scenario == "review_references" else scenario
    pkg = make_layered_package(fixture_scenario)  # type: ignore[arg-type]
    if scenario == "review_references":
        pkg.manifest.package_id = "pkg-review-references"
        annotation = Annotation(
            annotation_id="review-proposal",
            document_id="doc-beta",
            layer_id="target-layer",
            type_id="phenotype",
            term_id="HP:0001250",
            axes_values={},
            evidence_refs=[],
            provenance=Provenance(
                actor=ActorRef(actor_id="source", kind="tool"), method="import"
            ),
        )
        proposal = snapshot(
            annotation, [], pkg.documents["doc-beta"], pkg.manifest.task_profile
        )
        pkg.annotations[(annotation.annotation_id, proposal.version)] = proposal
    result = io.BytesIO()
    PackageWriter.write_to_stream(pkg, result)
    return result.getvalue()


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(
        prefix="hpo-browser-", ignore_cleanup_errors=True
    ) as tmp:
        root = Path(tmp)
        config = AppConfig(
            workspace_dir=root,
            database_url=database_url_for(root / "editor.db"),
            ontology_paths=[ONTOLOGY, MONDO_ONTOLOGY],
            port=PORT,
            web_dir=ROOT / "frontend/dist",
        )
        app = create_app(config)

        @app.get("/__synthetic_fixture__")
        def fixture(scenario: str | None = Query(None)) -> Response:
            if scenario in (
                "single",
                "assisted",
                "multi_editable",
                "review_references",
            ):
                data = scenario_package(scenario)
            elif scenario == "many_proposals":
                data = fixture_package(
                    package_id="pkg-many-proposals", proposals=MANY_PROPOSALS
                )
            elif scenario == "translations":
                data = fixture_package(package_id="translation-fixture")
            else:
                data = fixture_package()
            return Response(data, media_type="application/zip")

        # The explicit test-only routes must precede the static catch-all.
        app.router.routes.insert(0, app.router.routes.pop())

        @app.post("/__test_user__")
        def test_user(
            request: Request,
            username: str = Query(...),
            pseudonym: str = Query(...),
            setup: bool = Query(False),
        ) -> dict[str, str]:
            """Create a system admin called ``username`` with ``pseudonym``.

            With ``setup`` the user keeps a fresh setup (or, if it exists, reset)
            code, which is returned for the login screen to redeem. Otherwise the
            code is redeemed with ``TEST_PASSWORD`` at once; an existing user is
            left as it is, so a repeated call changes nothing.
            """
            accounts: AccountService = request.app.state.accounts
            existing = accounts.get_by_username(username)
            if existing is None:
                issued = accounts.create_user(
                    Actor.cli(),
                    username,
                    pseudonym,
                    system_admin=True,
                    pseudonym=pseudonym,
                )
                if not setup:
                    accounts.redeem_code(username, issued.code, TEST_PASSWORD)
            elif setup:
                issued = accounts.issue_reset_code(Actor.cli(), username)
            else:
                return {"username": existing.username, "pseudonym": existing.pseudonym}
            if setup:
                return {"code": issued.code}
            return {
                "username": issued.user.username,
                "pseudonym": issued.user.pseudonym,
            }

        app.router.routes.insert(0, app.router.routes.pop())
        uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
