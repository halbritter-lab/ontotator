"""Real local backend for Playwright; synthetic data and temporary storage only."""

import hashlib
import io
import os
import tempfile
from pathlib import Path

import uvicorn
from fastapi.responses import Response

from ontocurator.api.app import create_app
from ontocurator.config import AppConfig
from ontocurator.domain.annotations import ActorRef, Annotation, Provenance, snapshot
from ontocurator.domain.axes import Axes
from ontocurator.domain.documents import (
    Document,
    EvidenceMention,
    EvidenceRef,
    OntologyRef,
    Segment,
    snapshot_evidence,
)
from ontocurator.packages.models import PackageManifest, ValidatedPackage
from ontocurator.packages.writer import PackageWriter

ROOT = Path(__file__).resolve().parents[1]
ONTOLOGY = ROOT / "tests/fixtures/hp.json"
PORT = int(os.environ.get("HPO_E2E_PORT", "18765"))
REF = OntologyRef(
    release="2026-06-23", sha256=hashlib.sha256(ONTOLOGY.read_bytes()).hexdigest()
)


def fixture_package() -> bytes:
    text = "Hypotonia and seizure. A😀e\u0301\r\nB"
    doc = Document(
        document_id="browser-doc",
        text=text,
        language="en",
        text_sha256=hashlib.sha256(text.encode()).hexdigest(),
    )
    annotations, evidence = {}, {}
    for number, (kind, term, start, end) in enumerate(
        [
            ("human", "HP:0001252", 0, 9),
            ("tool", "HP:0001250", 14, 21),
        ]
    ):
        ev = snapshot_evidence(
            EvidenceMention(
                evidence_id=f"ev-{number}", segments=[Segment(start=start, end=end)]
            ),
            doc,
        )
        ann = Annotation(
            annotation_id=f"proposal-{number}",
            document_id=doc.document_id,
            hpo_id=term,
            axes=Axes(assertion="present"),
            evidence_refs=[
                EvidenceRef(evidence_id=ev.mention.evidence_id, version=ev.version)
            ],
            provenance=Provenance(
                actor=ActorRef(actor_id=f"source-{number}", kind=kind), method="fixture"
            ),
        )
        snap = snapshot(ann, [ev], doc, REF)
        annotations[(ann.annotation_id, snap.version)] = snap
        evidence[(ev.mention.evidence_id, ev.version)] = ev
    pkg = ValidatedPackage(
        manifest=PackageManifest(
            package_id="browser-fixture",
            ontology=REF,
            created_at="2026-10-01T00:00:00Z",
        ),
        documents={doc.document_id: doc},
        annotations=annotations,
        evidence=evidence,
    )
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
            database_path=root / "editor.db",
            ontology_path=ONTOLOGY,
            expected_ontology_ref=REF,
            session_token="browser-test-token",
            port=PORT,
            web_dir=ROOT / "frontend/dist",
        )
        app = create_app(config)

        @app.get("/__synthetic_fixture__")
        def fixture() -> Response:
            return Response(fixture_package(), media_type="application/zip")

        # This explicit test-only route must precede the static catch-all.
        app.router.routes.insert(0, app.router.routes.pop())
        uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
