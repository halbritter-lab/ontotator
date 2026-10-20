"""Real local backend for Playwright; synthetic data and temporary storage only.

Every scenario project is seeded at start-up (T2d: there is no upload in the
product any more). Test-only routes create users with project memberships,
add a fixture translation and import a T1 bundle.
"""

import base64
import hashlib
import os
import re
import sys
import tempfile
import unicodedata
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from time import monotonic, sleep
from typing import Literal
from uuid import uuid4

import uvicorn
from fastapi import FastAPI, HTTPException, Query, Request
from ontospan import AnnotatedDocument
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
from ontocurator.exchange.jobs import store_file
from ontocurator.jobs.queue import Job

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from support.v2_import import PackageImportService  # noqa: E402

from ontocurator.packages.models import PackageManifest, ValidatedPackage  # noqa: E402
from ontocurator.storage.tables import (  # noqa: E402
    JobRow,
    ProjectOntologyRow,
    ProjectRow,
)
from tests.layered_fixtures import HP_DIGEST, make_layered_package  # noqa: E402
from tests.t1_fixtures import (  # noqa: E402
    bundle,
    create_project,
    run_import,
    unit,
)
from tests.work_plan_support import plan_all  # noqa: E402

ONTOLOGY = ROOT / "tests/fixtures/hp.json"
MONDO_ONTOLOGY = ROOT / "tests/fixtures/mondo.json"
PORT = int(os.environ.get("HPO_E2E_PORT", "18765"))
# The password of every user that ``/__test_user__`` sets up (frontend/browser/helpers.ts).
TEST_PASSWORD = "browser test passphrase"


def fixture_package(
    project_key: str = "browser-fixture",
    created_at: str = "2026-10-01T00:00:00Z",
    proposals: list[tuple[str, str, int, int]] | None = None,
    canonical: bool = False,
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
    if canonical:
        text = unicodedata.normalize("NFC", text.replace("\r\n", "\n"))
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
            package_id=project_key,
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


def decision_semantics_package() -> ValidatedPackage:
    """A hidden defaulted proposal exercises warning navigation without patient data."""
    pkg = fixture_package(project_key="pkg-defaulted-decisions")
    profile = pkg.manifest.task_profile
    profile.layers.append(
        profile.layers[0].model_copy(
            update={
                "layer_id": "hidden-layer",
                "label": "Hidden findings",
                "default_visible": False,
            },
            deep=True,
        )
    )
    pkg.manifest.task_profile_sha256 = profile_hash(profile)
    proposals = {}
    for number, original in enumerate(pkg.annotations.values()):
        annotation = original.annotation.model_copy(
            update={
                "layer_id": "hidden-layer" if number == 0 else "hpo-layer",
                "axes_defaulted": ["assertion"] if number == 0 else [],
            }
        )
        updated = snapshot(
            annotation, original.evidence, pkg.documents[original.document_id], profile
        )
        proposals[(annotation.annotation_id, updated.version)] = updated
    pkg.annotations = proposals
    return pkg


def spanless_decisions_package() -> ValidatedPackage:
    """Historical spanless proposal for repairing a new draft without rewriting its source."""
    pkg = fixture_package(project_key="pkg-spanless-decisions")
    profile = pkg.manifest.task_profile
    profile.layers[0].annotation_types[0].evidence_policy = "required_on_complete"
    pkg.manifest.task_profile_sha256 = profile_hash(profile)
    proposals = {}
    for number, original in enumerate(pkg.annotations.values()):
        if number == 0:
            annotation = original.annotation.model_copy(update={"evidence_refs": []})
            original = snapshot(
                annotation, [], pkg.documents[original.document_id], profile
            )
        original = snapshot(
            original.annotation,
            original.evidence,
            pkg.documents[original.document_id],
            profile,
        )
        proposals[(original.annotation.annotation_id, original.version)] = original
    pkg.annotations = proposals
    return pkg


def seed_packages() -> list[ValidatedPackage]:
    """Every project the specs use, oldest first."""
    return [
        fixture_package(),
        fixture_package(project_key="pkg-unresolved-export", canonical=True),
        decision_semantics_package(),
        spanless_decisions_package(),
        fixture_package(project_key="pkg-many-proposals", proposals=MANY_PROPOSALS),
        fixture_package(project_key="translation-fixture"),
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


def register_test_user_route(
    app: FastAPI, grant_project_roles: Callable[[int, str, str], None]
) -> None:
    """Register the browser fixture user route ahead of the static frontend."""

    @app.post("/__test_user__")
    def test_user(
        request: Request,
        username: str = Query(...),
        pseudonym: str = Query(...),
        setup: bool = Query(False),
        display_name: str | None = Query(None),
        projects: str | None = Query(None),
        assign: Literal["all", "none"] = Query("all"),
        system_admin: bool = Query(False),
    ) -> dict[str, str]:
        """Create a fixture user; system administrator requires explicit opt-in.

        The display name is ``display_name``, by default the pseudonym.
        ``projects`` (comma-separated keys) gives the user every role there,
        also when the user exists already. ``assign=all`` (the default) also
        provisions assignments; ``assign=none`` skips only that provisioning.
        ``system_admin=true`` bootstraps a new administrator for administration
        UI tests. It never promotes an existing ordinary fixture user.

        With ``setup`` the user keeps a fresh setup (or, if it exists, reset)
        code, which is returned for the login screen to redeem. Otherwise the
        code is redeemed with ``TEST_PASSWORD`` at once; an existing user is
        left as it is, so a repeated call changes nothing.
        """
        accounts: AccountService = request.app.state.accounts
        existing = accounts.get_by_username(username)
        if system_admin and existing is not None and not existing.is_system_admin:
            raise HTTPException(409, "The fixture user is not an administrator.")
        if existing is None:
            issued = accounts.create_user(
                Actor.cli(),
                username,
                display_name or pseudonym,
                pseudonym=pseudonym,
                system_admin=system_admin,
            )
            if not setup:
                accounts.redeem_code(username, issued.code, TEST_PASSWORD)
            user = issued.user
        else:
            user = existing
        for key in filter(None, (projects or "").split(",")):
            grant_project_roles(user.id, user.username, key)
            if assign == "all":
                from auth_harness import provision_assignments

                provision_assignments(app, user.username, key, ROLES)
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


def run_fixture_import(
    app: FastAPI, path: Path, project: str, *, timeout: float = 30
) -> Job:
    """Import through this server's real worker; never compete for its job claim."""
    db = app.state.repo.db
    digest = store_file(db, path.read_bytes())
    with db.transaction() as conn:
        project_id = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == project)
        ).scalar_one()
    payload = {"project": project, "blob_sha256": digest, "filename": path.name}
    job_id = app.state.jobs.enqueue(
        "t1_import", payload, project_id=project_id, actor=Actor.cli()
    )
    deadline = monotonic() + timeout
    while True:
        # JobQueue.get closes its read transaction before returning, so the
        # worker can commit and no DB connection is retained during sleep.
        job = app.state.jobs.get(job_id)
        if (
            job is None
            or job.kind != "t1_import"
            or job.project_id != project_id
            or job.payload != payload
        ):
            raise HTTPException(
                500, {"error": "Import job identity changed", "job_id": job_id}
            )
        if job.status == "failed":
            raise HTTPException(500, {"job_id": job.id, "error": job.error})
        if job.status == "succeeded":
            return job
        if monotonic() >= deadline:
            raise HTTPException(
                500,
                {
                    "error": "Import job did not finish",
                    "job_id": job.id,
                    "status": job.status,
                },
            )
        sleep(0.05)


def register_variant_scenario_route(app: FastAPI) -> None:
    """Fresh synthetic variants with optional browser roles; never shipped."""

    @app.post("/__test_variants__")
    def variants_scenario(
        comparison: bool = Query(False),
        merge_split: bool = Query(False),
        browse: bool = Query(False),
    ) -> dict[str, object]:
        from t1_builders import bundle as variant_bundle
        from t1_builders import correction_unit, native_unit, translation_unit
        from t1_fixtures import annotation

        from ontocurator.application.translation_reviews import TranslationReviewService
        from ontocurator.assignments.service import AssignmentService
        from ontocurator.authz.policy import Access

        db = app.state.repo.db
        key = f"variants-{uuid4().hex[:12]}"
        create_project(db, key)
        case_id = "EN 1/7 #é"
        source_id = "source/annotation-versions/own/y %2F #é"
        source_text = "Hypotonia and seizure. A😀e\u0301\n\n" + DESIGN_TEXT
        target_text = "Hypotonia und Anfälle. A😀e\u0301\n\n" + DESIGN_TEXT
        other_text = target_text + "\n\nAlternative translation run."
        if comparison:
            # Real wrapping/scroll range, not test-only DOM padding. Keep enough
            # paragraphs after the measured ones to avoid native EOF clamping.
            source_text = "Hypotonia and seizure. A😀e\u0301\n\n" + "\n\n".join(
                f"Source paragraph {number}. " + DESIGN_TEXT.split("\n\n")[1]
                for number in range(1, 13)
            )
            target_text = "Hypotonia und Anfälle. A😀e\u0301\n\n" + "\n\n".join(
                f"Translation paragraph {number}. "
                + DESIGN_TEXT.split("\n\n")[1]
                + " Additional synthetic clinical explanation." * 5
                for number in range(1, 13)
            )
            other_text = "Alternative translation. A😀e\u0301\n\n" + "\n\n".join(
                f"Alternative paragraph {number}. " + DESIGN_TEXT.split("\n\n")[1]
                for number in range(1, 9)
            )
        if merge_split:
            paragraphs = [
                f"Finding {i}. µ ± \u03b1 😀 " + "Synthetic clinical detail. " * 120
                for i in range(1, 5)
            ]
            source_text = "\n\n".join(paragraphs)
            target_text = "\n\n".join(
                [
                    paragraphs[0] + " " + paragraphs[1],
                    paragraphs[2],
                    paragraphs[3][:900],
                    paragraphs[3][900:],
                ]
            )
        source = native_unit(
            source_id,
            "en",
            source_text,
            case_id=case_id,
            annotations=[
                annotation(
                    "source-proposal", (0, 9), text=source_text, term_id="HP:0001252"
                )
            ],
        )
        target = translation_unit(
            source_id,
            "de",
            target_text,
            source=source,
            provider="Browser translation A",
            run_id="run A/1 %é",
        )
        other = translation_unit(
            "translation/variant %2F #é",
            "de",
            other_text,
            source=source,
            provider="Browser translation B",
            run_id="run B/1",
        )
        corrected = correction_unit(target, target_text + "\n\nCorrected conclusion.")
        with tempfile.TemporaryDirectory() as folder:
            imported = run_fixture_import(
                app,
                variant_bundle(Path(folder), [source, target, other, corrected]),
                key,
            )
        if imported.status != "succeeded":
            raise HTTPException(500, imported.error)
        # Assignments need the work plan: every language version in it (Annotate
        # on, Review on translations); the import default leaves the source off.
        plan_all(db, key)
        expected_pairs = {
            (pair["old_document_id"], pair["new_document_id"])
            for pair in (imported.result or {}).get("reanchor_pairs", [])
        }
        if not expected_pairs:
            raise HTTPException(
                500, "The correction import did not record its child pair"
            )
        deadline = monotonic() + 20
        while True:
            # Read only this project's children of this exact import producer.
            with db.transaction() as conn:
                children = [
                    {
                        "id": row.id,
                        "status": row.status,
                        "error": row.error,
                        "result": row.result,
                        "old_document_id": row.payload["old_document_id"],
                        "new_document_id": row.payload["new_document_id"],
                    }
                    for row in conn.execute(
                        select(JobRow)
                        .join(ProjectRow, JobRow.project_id == ProjectRow.id)
                        .where(
                            ProjectRow.project_key == key,
                            JobRow.kind == "reanchor",
                            JobRow.payload["project"].as_string() == key,
                            JobRow.payload["producer"]["kind"].as_string() == "import",
                            JobRow.payload["producer"]["job_id"].as_integer()
                            == imported.id,
                        )
                        .order_by(JobRow.id)
                    ).mappings()
                ]
            actual_pairs = {
                (child["old_document_id"], child["new_document_id"])
                for child in children
            }
            if any(child["status"] == "failed" for child in children):
                raise HTTPException(
                    500, {"import_job_id": imported.id, "children": children}
                )
            if (
                actual_pairs == expected_pairs
                and len(children) == len(expected_pairs)
                and all(child["status"] == "succeeded" for child in children)
            ):
                break
            if monotonic() >= deadline:
                raise HTTPException(
                    500,
                    {
                        "error": "Import children did not finish",
                        "import_job_id": imported.id,
                        "children": children,
                    },
                )
            sleep(0.05)
        inventory = app.state.repo.list_variants(key, case_id=case_id)

        def identity(external_id: str, language: str, version: int) -> str:
            return next(
                row.document_id
                for row in inventory
                if (row.external_id, row.language, row.version)
                == (external_id, language, version)
            )

        documents = {
            "source": identity(source_id, "en", 1),
            "target": identity(source_id, "de", 1),
            "other": identity(other.document.document_id, "de", 1),
            "corrected": identity(source_id, "de", 2),
        }
        accounts = app.state.accounts
        users = {}
        for name, role in [
            ("alice", "annotator"),
            ("bob", "annotator"),
            ("reviewer", "annotator"),
            ("reader", "adjudicator"),
            ("lead", "lead"),
        ]:
            username = f"{key}-{name}"
            issued = accounts.create_user(Actor.cli(), username, username)
            accounts.redeem_code(username, issued.code, TEST_PASSWORD)
            roles = (
                [role, "adjudicator"]
                if name == "alice" and (browse or comparison)
                else [role]
            )
            app.state.memberships.add(Actor.cli(), key, username, roles)
            accounts.set_languages(Actor.cli(), username, ["en", "de"])
            users[name] = accounts.get_by_username(username)
        accounts.update_profile(
            Actor.cli(), users["reviewer"].username, qualification="Physician"
        )
        service = AssignmentService(db)
        review = TranslationReviewService(db, app.state.jobs)
        reviewer = users["reviewer"]
        access = Access(
            reviewer.id,
            reviewer.pseudonym,
            False,
            {key: frozenset({"annotator"})},
        )
        # Accepted state comes from actual eligible, qualified review submissions.
        for name in ("target", "other", "corrected"):
            assignment = service.assign(
                Actor.cli(),
                key,
                documents[name],
                reviewer.username,
                "translation_review",
            )
            opened = review.open(access, assignment.id)
            revision = review.save_draft(
                access,
                assignment.id,
                expected_revision=opened.draft.revision,
                text=opened.text,
                form={"decision": "accepted_unchanged", "clinical_change": False},
            )
            review.submit(access, assignment.id, expected_revision=revision)
        assignments = {}
        for name, document, task in [
            ("alice", "target", "annotate"),
            ("alice_source", "source", "annotate"),
            ("bob", "target", "annotate"),
            ("reader", "source", "review"),
        ]:
            username = users["alice" if name == "alice_source" else name].username
            assignments[name] = service.assign(
                Actor.cli(), key, documents[document], username, task
            ).id
        return {
            "project": key,
            "import_job_id": imported.id,
            "children": children,
            "case_id": case_id,
            "documents": documents,
            "texts": {
                "source": source.document.text,
                "target": target.document.text,
            },
            "users": {name: user.username for name, user in users.items()},
            "assignments": assignments,
        }

    app.router.routes.insert(0, app.router.routes.pop())


def translation_review_fixture_texts(
    source: AnnotatedDocument, target: AnnotatedDocument, failed: AnnotatedDocument
) -> dict[str, str]:
    """Export the actual builder/import carrier, including canonical Unicode."""
    return {
        "source": source.document.text,
        "target": target.document.text,
        "failed": failed.document.text,
    }


def register_translation_review_scenario_route(app: FastAPI) -> None:
    """Fresh pending translations for ordinary-role review journeys only."""

    @app.post("/__test_translation_review__")
    def translation_review_scenario(
        assignment: Literal["none", "target", "failed"] = "none",
        unequal: bool = False,
        merge_split: bool = False,
        manager: bool = False,
        workflow: bool = False,
        source_update: bool = False,
    ) -> dict[str, object]:
        from t1_builders import bundle as variant_bundle
        from t1_builders import correction_unit, native_unit, translation_unit

        from ontocurator.assignments.service import AssignmentService

        db = app.state.repo.db
        key = f"review-{uuid4().hex[:12]}"
        create_project(db, key)
        case_id = "Review EN /7 #é"
        external_id = "Dose /5 %é"
        source_text = "\n\n".join(
            f"Paragraph {index + 1}. Dose 5 mg. A😀e\u0301 "
            + "The patient describes symptoms and the clinician checks each detail. "
            * 18
            for index in range(14)
        )
        target_text = "\n\n".join(
            f"Absatz {index + 1}. Dosis 5 mg. A😀e\u0301 "
            + "Die Patientin beschreibt Symptome und die Ärztin prüft jede Angabe. "
            * 18
            for index in range(14)
        )
        if merge_split:
            paragraphs = [
                f"Finding {i}. Dose 5 mg. µ ± \u03b1 😀 "
                + "Synthetic clinical detail. " * 120
                for i in range(1, 5)
            ]
            source_text = "\n\n".join(paragraphs)
            target_text = "\n\n".join(
                [
                    paragraphs[0] + " " + paragraphs[1],
                    paragraphs[2],
                    paragraphs[3][:900],
                    paragraphs[3][900:],
                ]
            )
        if workflow:
            source_text = "Hypotonia. " + source_text
        source = native_unit(external_id, "en", source_text, case_id=case_id)
        target = translation_unit(
            external_id,
            "de",
            target_text,
            source=source,
            provider="Review fixture MT",
            model="clinical-example-1",
            run_id="review run /1 %é",
        )
        comparison_text = target_text.replace("Absatz", "Vergleich")
        if unequal:
            comparison_text += "\n\nZusätzlicher Absatz.\n\nWeiterer Absatz."
        failed = translation_unit(
            "Alternative /run %é",
            "de",
            comparison_text,
            source=source,
            checks=(("units_added", False), ("numbers_changed", True)),
            provider="Review fixture alternative",
            run_id="review failed run /2",
        )
        imported_units = [source, target, failed]
        if source_update:
            imported_units.append(
                correction_unit(
                    source,
                    source_text + "\n\nUpdated source: additional clinical detail.",
                )
            )
        with tempfile.TemporaryDirectory() as folder:
            imported = run_fixture_import(
                app,
                variant_bundle(Path(folder), imported_units),
                key,
            )
        if imported.status != "succeeded":
            raise HTTPException(500, imported.error)
        # Every language version in the work plan, the source with Annotate on.
        plan_all(db, key)
        inventory = app.state.repo.list_variants(key, case_id=case_id)
        documents = {
            name: next(
                row.document_id
                for row in inventory
                if (row.external_id, row.language)
                == (unit.document.document_id, unit.document.language)
            )
            for name, unit in [
                ("source", source),
                ("target", target),
                ("failed", failed),
            ]
        }
        accounts = app.state.accounts
        users = {}
        roles = [
            ("lead", "lead"),
            ("reviewer", "annotator"),
            ("other", "annotator"),
        ]
        if manager:
            roles.extend([("manager", "lead"), ("historian", "annotator")])
        if workflow:
            roles.append(("consolidator", "adjudicator"))
        for name, role in roles:
            username = f"{key}-{name}"
            issued = accounts.create_user(Actor.cli(), username, username)
            accounts.redeem_code(username, issued.code, TEST_PASSWORD)
            app.state.memberships.add(Actor.cli(), key, username, [role])
            accounts.set_languages(Actor.cli(), username, ["en", "de"])
            users[name] = username
        accounts.update_profile(
            Actor.cli(), users["reviewer"], qualification="Physician"
        )
        assigned_id = None
        if assignment != "none":
            assigned_id = (
                AssignmentService(db)
                .assign(
                    Actor.cli(),
                    key,
                    documents[assignment],
                    users["reviewer"],
                    "translation_review",
                )
                .id
            )
        return {
            "project": key,
            "case_id": case_id,
            "external_id": external_id,
            "documents": documents,
            "texts": translation_review_fixture_texts(source, target, failed),
            "users": users,
            "assignment_id": assigned_id,
            "import_job_id": imported.id,
            "initial_statuses": {
                row.document_id: row.translation_status for row in inventory
            },
        }

    app.router.routes.insert(0, app.router.routes.pop())


def register_variant_admin_scenario_routes(app: FastAPI) -> None:
    """Unimported public bytes and exact real-worker child proof; test server only."""

    @app.post("/__test_admin_upload__")
    def admin_upload() -> dict[str, object]:
        from t1_builders import bundle as variant_bundle
        from t1_builders import native_unit, translation_unit

        key = f"admin-upload-{uuid4().hex[:12]}"
        create_project(app.state.repo.db, key)
        external = "Dose /5 %é"
        source = native_unit(external, "en", "Dose 5 mg.", case_id="Public case /7")
        target = translation_unit(
            external,
            "de",
            "Dosis 5 mg.",
            source=source,
            checks=(("units_added", False), ("numbers_changed", True)),
            provider="Generic browser MT",
            run_id="admin upload run /1",
        )
        with tempfile.TemporaryDirectory() as folder:
            data = variant_bundle(Path(folder), [source, target]).read_bytes()
        username = f"{key}-lead"
        issued = app.state.accounts.create_user(Actor.cli(), username, username)
        app.state.accounts.redeem_code(username, issued.code, TEST_PASSWORD)
        app.state.memberships.add(Actor.cli(), key, username, ["lead"])
        return {
            "project": key,
            "username": username,
            "external_id": external,
            "filename": "public-variants.zip",
            "sha256": hashlib.sha256(data).hexdigest(),
            "base64": base64.b64encode(data).decode("ascii"),
        }

    app.router.routes.insert(0, app.router.routes.pop())

    @app.get("/__test_review_child__")
    def review_child(project: str, review_id: int) -> dict[str, object]:
        from ontocurator.exchange.reanchor_job import ReviewProducer
        from ontocurator.storage.tables import TranslationReviewRow

        db = app.state.repo.db
        producer = ReviewProducer(review_id=review_id)
        with db.transaction() as conn:
            record = conn.execute(
                select(
                    TranslationReviewRow.document_id,
                    TranslationReviewRow.created_variant_id,
                )
                .join(ProjectRow, TranslationReviewRow.project_id == ProjectRow.id)
                .where(
                    ProjectRow.project_key == project,
                    TranslationReviewRow.id == review_id,
                )
            ).one_or_none()
        if record is None or record.created_variant_id is None:
            raise HTTPException(404, "No correction for this exact review/project")
        deadline = monotonic() + 30
        while True:
            with db.transaction() as conn:
                children = [
                    dict(row)
                    for row in conn.execute(
                        select(
                            JobRow.id,
                            JobRow.status,
                            JobRow.error,
                            JobRow.payload,
                            JobRow.result,
                        )
                        .join(ProjectRow, JobRow.project_id == ProjectRow.id)
                        .where(
                            ProjectRow.project_key == project,
                            JobRow.kind == "reanchor",
                            JobRow.payload["project"].as_string() == project,
                            JobRow.payload["producer"]["kind"].as_string()
                            == producer.kind,
                            JobRow.payload["producer"]["review_id"].as_integer()
                            == review_id,
                        )
                    ).mappings()
                ]
            if len(children) > 1 or any(
                child["status"] == "failed" for child in children
            ):
                raise HTTPException(500, {"review_id": review_id, "children": children})
            if children and children[0]["status"] == "succeeded":
                payload = children[0]["payload"]
                if (payload["old_document_id"], payload["new_document_id"]) != (
                    record.document_id,
                    record.created_variant_id,
                ):
                    raise HTTPException(500, "Review child pair mismatch")
                return {"review_id": review_id, "children": children}
            if monotonic() >= deadline:
                raise HTTPException(
                    500, {"error": "Review child timeout", "children": children}
                )
            sleep(0.05)

    app.router.routes.insert(0, app.router.routes.pop())


def register_reanchor_scenario_route(app: FastAPI) -> None:
    """Fresh real import/reanchor results; never registered in the shipped app."""

    @app.post("/__test_reanchor__")
    def reanchor_scenario(assisted: bool = False) -> dict[str, object]:
        from t1_builders import bundle as variant_bundle
        from t1_builders import correction_unit, native_unit
        from t1_fixtures import PIN, annotation, hpo_profile

        from ontocurator.api.variant_routes import ReanchorItem
        from ontocurator.assignments.service import AssignmentService
        from ontocurator.projects.service import ProjectService

        db = app.state.repo.db
        key = f"reanchor-{uuid4().hex[:12]}"
        profile = hpo_profile()
        if assisted:
            original = profile.layers[0]
            profile = profile.model_copy(
                update={
                    "default_layer_id": "target",
                    "layers": [
                        original.model_copy(update={"access": "reference"}),
                        original.model_copy(
                            update={
                                "layer_id": "target",
                                "label": "Target",
                                "access": "editable",
                            }
                        ),
                    ],
                }
            )
        ProjectService(db, app.state.ontology_store).create(
            Actor.cli(),
            key=key,
            name="Pending context browser",
            description=None,
            profile=profile,
            pins={"hp": PIN},
            languages=["en"],
        )
        external = "Pending /1 %é"
        paragraphs = [
            f"Paragraph {i}. " + "Clinical context remains unchanged. " * 20
            for i in range(14)
        ]
        paragraphs[0] = "Hypotonia. " + paragraphs[0]
        paragraphs[8] = "Seizure 😀old <literal>. " + paragraphs[8]
        paragraphs[10] = "Another Seizure 😀old finding. " + paragraphs[10]
        old_text = "\n\n".join(paragraphs)
        start = old_text.index("Seizure")
        source = native_unit(
            external,
            "en",
            old_text,
            case_id="Pending case /1 %é",
            annotations=[
                annotation("carried", (0, 9), text=old_text, term_id="HP:0001252"),
                annotation(
                    "refused", (start, start + len("Seizure 😀old")), text=old_text
                ),
                annotation(
                    "refused-second",
                    (
                        old_text.index("Seizure", start + 1),
                        old_text.index("Seizure", start + 1) + len("Seizure 😀old"),
                    ),
                    text=old_text,
                ),
            ],
        )
        corrected = correction_unit(
            source, old_text.replace("Seizure 😀old", "Ataxia 😀new")
        )
        with tempfile.TemporaryDirectory() as folder:
            imported = run_fixture_import(
                app, variant_bundle(Path(folder), [source, corrected]), key
            )
        pairs = (imported.result or {}).get("reanchor_pairs", [])
        if len(pairs) != 1:
            raise HTTPException(
                500, {"error": "Expected one exact correction pair", "pairs": pairs}
            )
        pair = pairs[0]
        deadline = monotonic() + 30
        while True:
            with db.transaction() as conn:
                children = [
                    dict(row)
                    for row in conn.execute(
                        select(
                            JobRow.id,
                            JobRow.status,
                            JobRow.error,
                            JobRow.result,
                            JobRow.payload,
                        )
                        .join(ProjectRow, ProjectRow.id == JobRow.project_id)
                        .where(
                            ProjectRow.project_key == key,
                            JobRow.kind == "reanchor",
                            JobRow.payload["project"].as_string() == key,
                            JobRow.payload["producer"]["kind"].as_string() == "import",
                            JobRow.payload["producer"]["job_id"].as_integer()
                            == imported.id,
                        )
                        .order_by(JobRow.id)
                    ).mappings()
                ]
            if any(child["status"] == "failed" for child in children):
                raise HTTPException(500, {"import": imported.id, "children": children})
            if len(children) == 1 and children[0]["status"] == "succeeded":
                child = children[0]
                if any(
                    child["payload"].get(name) != pair[name]
                    for name in ("old_document_id", "new_document_id")
                ):
                    raise HTTPException(
                        500, "Correction child identity differs from producer"
                    )
                result = child["result"] or {}
                if result.get("carried", 0) < 1 or result.get("needs_review", 0) < 1:
                    raise HTTPException(
                        500,
                        {
                            "error": "Missing real carried/refused outcomes",
                            "child": child,
                        },
                    )
                break
            if monotonic() >= deadline:
                raise HTTPException(
                    500,
                    {"error": "Exact reanchor child timed out", "children": children},
                )
            sleep(0.05)
        document = app.state.repo.get_document(key, pair["new_document_id"])
        predecessor = app.state.repo.get_document(key, pair["old_document_id"])
        if (
            document is None
            or predecessor is None
            or document.text != corrected.document.text
        ):
            raise HTTPException(
                500, "Imported canonical text does not match the actual builder"
            )
        pending = [
            ReanchorItem.model_validate(item).model_dump(mode="json")
            for item in app.state.repo.get_reanchor_items(key, document.document_id)
        ]
        sets = sorted({item["proposal_set_id"] for item in pending})
        if not pending or len(sets) != 1:
            raise HTTPException(500, "Missing exact reanchor proposal-set association")
        metadata = app.state.repo.get_proposal_set(key, sets[0])
        if (
            metadata["source_document_id"] != predecessor.document_id
            or metadata["source_version"] != 1
        ):
            raise HTTPException(
                500, "Reanchor provenance does not match the actual predecessor"
            )
        accounts = app.state.accounts
        users = {}
        pseudonyms = {}
        for name, role in [
            ("annotator", "annotator"),
            ("adjudicator", "adjudicator"),
            ("second_reviewer", "adjudicator"),
            ("lead", "lead"),
        ]:
            username = f"{key}-{name}"
            issued = accounts.create_user(Actor.cli(), username, username)
            accounts.redeem_code(username, issued.code, TEST_PASSWORD)
            app.state.memberships.add(Actor.cli(), key, username, [role])
            accounts.set_languages(Actor.cli(), username, ["en"])
            users[name] = username
            pseudonyms[name] = issued.user.pseudonym
        service = AssignmentService(db)
        owner = "annotator" if assisted else "adjudicator"
        task = "annotate" if assisted else "review"
        assignment = service.assign(
            Actor.cli(), key, document.document_id, users[owner], task
        )
        second_assignment = service.assign(
            Actor.cli(), key, document.document_id, users["second_reviewer"], "review"
        )
        return {
            "project": key,
            "document_id": document.document_id,
            "old_document_id": predecessor.document_id,
            "text": document.text,
            "old_text": predecessor.text,
            "case_id": source.document.case_id,
            "users": users,
            "pseudonyms": pseudonyms,
            "assignment_id": assignment.id,
            "second_assignment_id": second_assignment.id,
            "task": task,
            "import_job_id": imported.id,
            "children": children,
            "pending": pending,
            "metadata": metadata,
        }

    app.router.routes.insert(0, app.router.routes.pop())


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
        for ontology_path in (ONTOLOGY, MONDO_ONTOLOGY):
            app.state.ontology_store.add(
                Actor.cli(), ontology_path.name, ontology_path.read_bytes()
            )
        importer = PackageImportService(app.state.repo, app.state.ontology_registry)
        for package in seed_packages():
            importer.import_package(package)
            # The retired package importer creates no server export pins.
            # Only this dedicated canonical fixture exercises the export API.
            if package.manifest.package_id != "pkg-unresolved-export":
                continue
            with app.state.repo.db.transaction() as conn:
                project_id = conn.execute(
                    select(ProjectRow.id).where(
                        ProjectRow.project_key == package.manifest.package_id
                    )
                ).scalar_one()
                for definition in package.manifest.task_profile.ontologies:
                    conn.execute(
                        ProjectOntologyRow.__table__.insert().values(
                            project_id=project_id,
                            ontology_id=definition.ontology_id,
                            sha256=definition.sha256,
                            allowed_roots=[],
                            t1_profile="generic",
                        )
                    )

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

        register_test_user_route(app, grant_all)
        register_variant_scenario_route(app)
        register_translation_review_scenario_route(app)
        register_variant_admin_scenario_routes(app)
        register_reanchor_scenario_route(app)
        from browser_documents_scenarios import register_documents_scenario_route

        register_documents_scenario_route(app)
        from browser_problem_report_scenarios import (
            register_problem_report_scenario_route,
        )

        register_problem_report_scenario_route(app)
        from browser_carry_fixture import register_carry_forward_scenario_route

        register_carry_forward_scenario_route(app)
        from browser_lead_workflow_scenarios import (
            register_lead_workflow_scenario_route,
        )

        register_lead_workflow_scenario_route(app)
        from browser_review_flow_scenarios import register_review_flow_scenario_route

        register_review_flow_scenario_route(app)
        from browser_values_scenarios import register_values_scenario_route

        register_values_scenario_route(app)

        @app.post("/__test_ontology__")
        def test_ontology(name: str = Query(...)) -> dict[str, str]:
            """Register only the public ontology fixtures through the real store."""
            if name not in {"hp.json", "mondo.json"}:
                raise HTTPException(400, "not a fixture ontology")
            stored = app.state.ontology_store.add(
                Actor.cli(), name, (ROOT / "tests/fixtures" / name).read_bytes()
            )
            return {"sha256": stored.sha256}

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
            from auth_harness import provision_assignments

            provision_assignments(app, user.username, T1_PROJECT, ROLES)
            return dict(job.result or {})

        app.router.routes.insert(0, app.router.routes.pop())

        uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
