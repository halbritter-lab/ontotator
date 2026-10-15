"""Real local backend for Playwright; synthetic data and temporary storage only.

Every scenario project is seeded at start-up (T2d: there is no upload in the
product any more). Test-only routes create users with project memberships,
add a fixture translation and import a T1 bundle.
"""

import hashlib
import os
import re
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path

import uvicorn
from fastapi import HTTPException, Query, Request
from pg_harness import database_url_for
from sqlalchemy import select

from ontocurator.api.app import create_app
from ontocurator.auth.accounts import AccountService
from ontocurator.auth.audit import Actor
from ontocurator.authz.memberships import grant_roles
from ontocurator.authz.policy import ROLES
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

from support.v2_import import PackageImportService  # noqa: E402

from ontocurator.packages.models import PackageManifest, ValidatedPackage  # noqa: E402
from ontocurator.storage.tables import ProjectRow  # noqa: E402
from tests.layered_fixtures import HP_DIGEST, make_layered_package  # noqa: E402
from tests.t1_fixtures import (  # noqa: E402
    bundle,
    create_project,
    run_import,
    unit,
)

ONTOLOGY = ROOT / "tests/fixtures/hp.json"
MONDO_ONTOLOGY = ROOT / "tests/fixtures/mondo.json"
PORT = int(os.environ.get("HPO_E2E_PORT", "18765"))
# The password of every user that ``/__test_user__`` sets up (frontend/browser/helpers.ts).
TEST_PASSWORD = "browser test passphrase"


def fixture_package(
    package_id: str = "browser-fixture",
    created_at: str = "2026-10-01T00:00:00Z",
    proposals: list[tuple[str, str, int, int]] | None = None,
) -> ValidatedPackage:
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
    return pkg


# 30 tool proposals: enough to overflow the case sidebar at any window height.
MANY_PROPOSALS = [
    ("tool", "HP:0001252", 0, 9) if number % 2 == 0 else ("tool", "HP:0001250", 14, 21)
    for number in range(30)
]


DESIGN_TEXT = (
    "Clinical summary\n\n"
    "The patient is a 14-month-old girl referred for evaluation of developmental "
    "delay. Since the age of six months she has had recurrent seizures, most of them "
    "brief dialeptic seizures with staring and loss of contact; one episode of status "
    "epilepticus at 11 months required intensive care.\n\n"
    "On examination she shows marked generalized hypotonia with head lag and poor "
    "truncal control. Deep tendon reflexes cannot be elicited at the knees or ankles "
    "(areflexia). There is no hearing impairment: newborn hearing screening and a "
    "follow-up audiogram at 12 months were normal.\n\n"
    "Family history is notable for a maternal cousin with spinal muscular atrophy. "
    "An epileptic encephalopathy is considered the working diagnosis; genetic testing "
    "(exome sequencing, trio) is pending."
)

# (layer, term, quoted text, occurrence index) of the design scenario's annotations.
DESIGN_PROPOSALS = [
    ("target-layer", "HP:0001250", "seizures", 1),
    ("target-layer", "HP:0011146", "dialeptic seizures", 0),
    ("target-layer", "HP:0002133", "status epilepticus", 0),
    ("target-layer", "HP:0001252", "generalized hypotonia", 0),
    ("target-layer", "HP:0001284", "areflexia", 0),
    ("target-layer", "HP:0000365", "hearing impairment", 0),
    ("reference-layer", "MONDO:0001250", "spinal muscular atrophy", 0),
    ("reference-layer", "MONDO:0005071", "epileptic encephalopathy", 0),
]


def design_package() -> ValidatedPackage:
    """A longer synthetic letter for the design screenshots (T6a): tool proposals
    with evidence, one overlap, and two read-only references."""
    base = make_layered_package("assisted")
    profile = base.manifest.task_profile
    text = DESIGN_TEXT
    doc = Document(
        document_id="doc-design",
        text=text,
        language="en",
        text_sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(),
    )
    annotations, evidence = {}, {}
    for number, (layer, term, quote, occurrence) in enumerate(DESIGN_PROPOSALS):
        start = -1
        for _ in range(occurrence + 1):
            start = text.index(quote, start + 1)
        ev = EvidenceSnapshot.create(
            mention=EvidenceMention(
                evidence_id=f"ev-design-{number}",
                segments=[Segment(start=start, end=start + len(quote))],
            ),
            document=doc,
        )
        reference = layer == "reference-layer"
        ann = Annotation(
            annotation_id=f"design-{number}",
            document_id=doc.document_id,
            layer_id=layer,
            type_id="disease" if reference else "phenotype",
            term_id=term,
            axes_values={} if reference else {"assertion": "present"},
            evidence_refs=[
                EvidenceRef(evidence_id=ev.mention.evidence_id, version=ev.version)
            ],
            provenance=Provenance(
                actor=ActorRef(actor_id="source-tool", kind="tool"), method="import"
            ),
        )
        snap = snapshot(ann, [ev], doc, profile)
        annotations[(ann.annotation_id, snap.version)] = snap
        evidence[(ev.mention.evidence_id, ev.version)] = ev
    pkg = ValidatedPackage(
        manifest=PackageManifest(
            package_id="pkg-design-states",
            format_version="ontocurator-work-package/v2",
            document_order=[doc.document_id],
            task_profile=profile,
            task_profile_sha256=profile_hash(profile),
            created_at="2026-10-15T00:00:00Z",
        ),
        documents={doc.document_id: doc},
        annotations=annotations,
        evidence=evidence,
    )
    return pkg


def scenario_package(scenario: str) -> ValidatedPackage:
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
    return pkg


def seed_packages() -> list[ValidatedPackage]:
    """Every project the specs use, oldest first."""
    return [
        fixture_package(),
        fixture_package(package_id="pkg-many-proposals", proposals=MANY_PROPOSALS),
        fixture_package(package_id="translation-fixture"),
        design_package(),
        *(
            scenario_package(scenario)
            for scenario in (
                "single",
                "assisted",
                "multi_editable",
                "review_references",
            )
        ),
    ]


T1_PROJECT = "t1-browser"
# Fixture files ``/__test_translation__`` may add.
TRANSLATION_NAME = re.compile(r"[a-z]+-[a-z]{2}\.babelon\.tsv")


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
        importer = PackageImportService(app.state.repo, app.state.ontology_registry)
        for package in seed_packages():
            importer.import_package(package)

        def grant_all(user_id: int, username: str, project_key: str) -> None:
            """Every role in the project, without ending the user's sessions."""
            with app.state.repo.db.transaction() as conn:
                project_id = conn.execute(
                    select(ProjectRow.id).where(ProjectRow.project_key == project_key)
                ).scalar_one_or_none()
                if project_id is None:
                    raise HTTPException(404, f"no project {project_key!r}")
                grant_roles(
                    conn,
                    Actor.cli(),
                    project_id,
                    user_id,
                    username,
                    ROLES,
                    datetime.now(UTC),
                )

        @app.post("/__test_user__")
        def test_user(
            request: Request,
            username: str = Query(...),
            pseudonym: str = Query(...),
            setup: bool = Query(False),
            display_name: str | None = Query(None),
            projects: str | None = Query(None),
        ) -> dict[str, str]:
            """Create the user ``username`` with ``pseudonym`` (no system admin).

            The display name is ``display_name``, by default the pseudonym.
            ``projects`` (comma-separated keys) gives the user every role there,
            also when the user exists already.

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
                    display_name or pseudonym,
                    pseudonym=pseudonym,
                )
                if not setup:
                    accounts.redeem_code(username, issued.code, TEST_PASSWORD)
                user = issued.user
            else:
                user = existing
            for key in filter(None, (projects or "").split(",")):
                grant_all(user.id, user.username, key)
            if existing is not None:
                if not setup:
                    return {"username": user.username, "pseudonym": user.pseudonym}
                issued = accounts.issue_reset_code(Actor.cli(), username)
            if setup:
                return {"code": issued.code}
            return {
                "username": issued.user.username,
                "pseudonym": issued.user.pseudonym,
            }

        app.router.routes.insert(0, app.router.routes.pop())

        @app.post("/__test_translation__")
        def test_translation(name: str = Query(...)) -> dict[str, str]:
            """Add a fixture translation file as the admin CLI does (D5)."""
            if not TRANSLATION_NAME.fullmatch(name):
                raise HTTPException(400, "not a fixture translation")
            path = ROOT / "tests/fixtures" / name
            stored = app.state.ontology_store.add(Actor.cli(), name, path.read_bytes())
            return {"sha256": stored.sha256}

        app.router.routes.insert(0, app.router.routes.pop())

        @app.post("/__test_import__")
        def test_import(username: str = Query(...)) -> dict[str, object]:
            """Import a T1 bundle into ``t1-browser`` inline; the user joins it."""
            db = app.state.repo.db
            if app.state.repo.manifest_hash(T1_PROJECT) is None:
                create_project(db, T1_PROJECT)
            with tempfile.TemporaryDirectory() as folder:
                job = run_import(
                    db,
                    bundle(Path(folder) / "t1.zip", [unit("t1-case")], "browser-t1"),
                    T1_PROJECT,
                )
            if job.status != "succeeded":
                raise HTTPException(500, job.error)
            user = app.state.accounts.get_by_username(username)
            grant_all(user.id, user.username, T1_PROJECT)
            return dict(job.result or {})

        app.router.routes.insert(0, app.router.routes.pop())

        uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
