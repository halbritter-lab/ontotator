import hashlib
from pathlib import Path

import pytest

from ontocurator.domain.annotations import (
    ActorRef,
    Annotation,
    Provenance,
    snapshot,
)
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.documents import (
    Document,
    EvidenceMention,
    EvidenceRef,
    EvidenceSnapshot,
    Segment,
)
from ontocurator.domain.errors import InvalidPackage, RevisionConflict
from ontocurator.domain.profiles import (
    AnnotationTypeDefinition,
    AxisDefinition,
    LayerDefinition,
    OntologyDefinition,
    TaskProfile,
    profile_hash,
)
from ontocurator.domain.review import ReviewTargetSet
from ontocurator.domain.workspace import (
    Draft,
    MutationEnvelope,
    Submission,
    WorkspaceKey,
)
from ontocurator.packages.models import PackageManifest, ValidatedPackage
from ontocurator.storage.sqlite_database import Database
from ontocurator.storage.sqlite_repository import Repository

HP_DIGEST = "279123a1ae5314e4632a0f85be2d82efd50f44ebf0d98e0100ed6859d7cb83e4"


def _create_storage_sample_profile() -> TaskProfile:
    hp_ont = OntologyDefinition(
        ontology_id="hp",
        label="Human Phenotype Ontology",
        release="2026-06-23",
        sha256=HP_DIGEST,
        format="obo-graph-json",
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
            AxisDefinition(
                id="experiencer",
                label="Experiencer",
                options=["patient", "other"],
                allow_empty=True,
            ),
            AxisDefinition(
                id="temporality",
                label="Temporality",
                options=["current", "historical", "future"],
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
    return TaskProfile(
        profile_id="hpo-context-example/v1",
        version="1.0.0",
        preset="editor-axes/v1",
        ontologies=[hp_ont],
        layers=[layer],
        default_layer_id="hpo-layer",
    )


def _sample_package(pkg_id: str = "pkg-1") -> ValidatedPackage:
    text = "Patient exhibits hypotonia."
    doc = Document(
        document_id="doc-1",
        text=text,
        language="de",
        text_sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(),
    )
    profile = _create_storage_sample_profile()
    ev = EvidenceSnapshot.create(
        mention=EvidenceMention(
            evidence_id="ev-1",
            segments=[Segment(start=17, end=26)],
        ),
        document=doc,
    )
    ann = Annotation(
        annotation_id="ann-1",
        document_id="doc-1",
        layer_id="hpo-layer",
        type_id="phenotype",
        term_id="HP:0001252",
        axes_values={
            "assertion": "present",
            "experiencer": "patient",
            "temporality": "current",
        },
        evidence_refs=[EvidenceRef(evidence_id="ev-1", version=ev.version)],
        provenance=Provenance(
            actor=ActorRef(actor_id="dr-meier", kind="human"),
            method="manual",
        ),
    )
    snap = snapshot(ann, [ev], doc, profile)

    manifest = PackageManifest(
        package_id=pkg_id,
        format_version="ontocurator-work-package/v2",
        document_order=["doc-1"],
        task_profile=profile,
        task_profile_sha256=profile_hash(profile),
        created_at="2026-10-01T20:00:00Z",
    )
    return ValidatedPackage(
        manifest=manifest,
        documents={doc.document_id: doc},
        annotations={(snap.annotation.annotation_id, snap.version): snap},
        evidence={(ev.mention.evidence_id, ev.version): ev},
        submissions={},
        search_events=[],
    )


def test_storage_concurrency_and_revision_protection(tmp_path: Path) -> None:
    db_path = tmp_path / "editor.db"
    db = Database(db_path)
    repo = Repository(db)

    pkg = _sample_package()
    repo.import_package(pkg)

    target_set = ReviewTargetSet.create([])
    key = WorkspaceKey(
        package_id="pkg-1",
        document_id="doc-1",
        annotator_id="user-a",
        mode="independent",
        target_set_id=target_set.target_set_id,
    )

    draft = repo.open_draft(key, target_set)
    assert draft.revision == 0

    # First write on revision 0 -> revision becomes 1
    env1 = MutationEnvelope(
        mutation_id="mut-1",
        expected_revision=0,
        payload={"action": "check_document", "checked": True},
    )

    def op1(d: Draft) -> Draft:
        d.document_checked = True
        return d

    res1 = repo.run_mutation(key, env1, op1)
    assert res1.revision == 1
    assert res1.document_checked is True

    # Concurrent write from stale tab expecting revision 0 -> raises RevisionConflict
    env_stale = MutationEnvelope(
        mutation_id="mut-2",
        expected_revision=0,
        payload={"action": "check_document", "checked": False},
    )

    def op_stale(d: Draft) -> Draft:
        d.document_checked = False
        return d

    with pytest.raises(RevisionConflict, match="REVISION_CONFLICT"):
        repo.run_mutation(key, env_stale, op_stale)

    # Content in DB remains the one from first write
    current_draft = repo.open_draft(key)
    assert current_draft.revision == 1
    assert current_draft.document_checked is True


def test_committed_write_with_lost_response_replays_once(tmp_path: Path) -> None:
    db_path = tmp_path / "editor.db"
    db = Database(db_path)
    repo = Repository(db)

    pkg = _sample_package()
    repo.import_package(pkg)

    target_set = ReviewTargetSet.create([])
    key = WorkspaceKey(
        package_id="pkg-1",
        document_id="doc-1",
        annotator_id="user-b",
        mode="independent",
        target_set_id=target_set.target_set_id,
    )

    draft = repo.open_draft(key, target_set)
    assert draft.revision == 0

    env = MutationEnvelope(
        mutation_id="mut-retry-1",
        expected_revision=0,
        payload={"action": "set_checked", "val": True},
    )

    op_call_count = 0

    def op(d: Draft) -> Draft:
        nonlocal op_call_count
        op_call_count += 1
        d.document_checked = True
        return d

    # First attempt commits
    res1 = repo.run_mutation(key, env, op)
    assert op_call_count == 1
    assert res1.revision == 1

    # Simulate client retry of same envelope after lost connection
    res2 = repo.run_mutation(key, env, op)
    assert op_call_count == 1  # Operation NOT re-executed!
    assert res2.revision == 1  # Revision NOT re-incremented!

    # Reusing same mutation ID with different payload raises RevisionConflict (409)
    env_tampered = MutationEnvelope(
        mutation_id="mut-retry-1",
        expected_revision=0,
        payload={"action": "tampered_payload"},
    )
    with pytest.raises(
        RevisionConflict, match="Mutation ID reused with different payload"
    ):
        repo.run_mutation(key, env_tampered, op)

    # Next legitimate edit works on revision 1
    env_next = MutationEnvelope(
        mutation_id="mut-next",
        expected_revision=1,
        payload={"action": "set_checked", "val": False},
    )

    def op_next(d: Draft) -> Draft:
        d.document_checked = False
        return d

    res3 = repo.run_mutation(key, env_next, op_next)
    assert res3.revision == 2
    assert res3.document_checked is False


def test_package_idempotent_import_and_hash_collision_rejection(tmp_path: Path) -> None:
    db_path = tmp_path / "editor.db"
    db = Database(db_path)
    repo = Repository(db)

    pkg = _sample_package("pkg-idem")
    # First import
    id1 = repo.import_package(pkg)
    assert id1 == "pkg-idem"

    # Second identical import -> idempotent success
    id2 = repo.import_package(pkg)
    assert id2 == "pkg-idem"

    # Same package_id with different manifest hash -> rejection
    pkg_colliding = _sample_package("pkg-idem")
    pkg_colliding.manifest.created_at = "2026-10-02T12:00:00Z"
    with pytest.raises(InvalidPackage, match="exists with different manifest hash"):
        repo.import_package(pkg_colliding)


def test_persistence_across_process_restart(tmp_path: Path) -> None:
    db_path = tmp_path / "editor.db"
    db1 = Database(db_path)
    repo1 = Repository(db1)

    pkg = _sample_package("pkg-restart")
    repo1.import_package(pkg)

    target_set = ReviewTargetSet.create([])
    key = WorkspaceKey(
        package_id="pkg-restart",
        document_id="doc-1",
        annotator_id="dr-frank",
        mode="independent",
        target_set_id=target_set.target_set_id,
    )
    repo1.open_draft(key, target_set)

    env = MutationEnvelope(
        mutation_id="mut-1",
        expected_revision=0,
        payload={"action": "check"},
    )
    repo1.run_mutation(
        key, env, lambda d: d.model_copy(update={"checked_layer_ids": ["hpo"]})
    )

    db1.close()

    # Restart simulated with new DB connection
    db2 = Database(db_path)
    repo2 = Repository(db2)

    draft2 = repo2.open_draft(key)
    assert draft2.revision == 1
    assert draft2.document_checked is True
    assert draft2.checked_layer_ids == ["hpo"]
    db2.close()


def test_import_package_rollback_on_failure(tmp_path: Path) -> None:
    db_path = tmp_path / "editor.db"
    db = Database(db_path)
    repo = Repository(db)

    pkg = _sample_package("pkg-fail")

    class BadDoc:
        document_id = "doc-bad"
        language = "de"
        text_sha256 = "123"

        @property
        def text(self) -> str:
            raise RuntimeError("Simulated failure during document import")

    pkg.documents["doc-bad"] = BadDoc()  # type: ignore[assignment]

    with pytest.raises(RuntimeError, match="Simulated failure"):
        repo.import_package(pkg)

    # Verify atomic rollback: no packages or partial data remained
    c = db.get_connection().cursor()
    c.execute("SELECT COUNT(*) FROM packages WHERE package_id = 'pkg-fail';")
    assert c.fetchone()[0] == 0
    c.execute("SELECT COUNT(*) FROM documents WHERE package_id = 'pkg-fail';")
    assert c.fetchone()[0] == 0


def test_export_p_import_q_preserves_historical_submission(tmp_path: Path) -> None:
    # 1. DB 1 has package P
    db1 = Database(tmp_path / "db1.db")
    repo1 = Repository(db1)
    pkg_p = _sample_package("pkg-P")
    repo1.import_package(pkg_p)

    target_set = ReviewTargetSet.create([])
    key_p = WorkspaceKey(
        package_id="pkg-P",
        document_id="doc-1",
        annotator_id="reviewer-1",
        mode="independent",
        target_set_id=target_set.target_set_id,
    )
    repo1.open_draft(key_p, target_set)

    submission_p = Submission(
        submission_id="sub-hist-1",
        origin_key=key_p,
        targets=target_set,
        draft_revision=1,
        snapshots=list(pkg_p.annotations.values()),
        decisions=[],
        document_checked=True,
        created_at="2026-10-01T21:00:00Z",
    )
    env = MutationEnvelope(
        mutation_id="mut-sub",
        expected_revision=0,
        payload={"action": "submit"},
    )
    repo1.run_mutation(key_p, env, lambda d: submission_p)

    # Export as package Q with origin reference to P
    exported_q = repo1.export_package("pkg-P")
    manifest_q = exported_q.manifest.model_copy(
        update={
            "package_id": "pkg-Q",
            "origin_package_id": "pkg-P",
            "origin_manifest_hash": canonical_hash(pkg_p.manifest.model_dump()),
        }
    )
    pkg_q = ValidatedPackage(
        manifest=manifest_q,
        documents={
            doc_id: doc.model_copy() for doc_id, doc in exported_q.documents.items()
        },
        annotations=dict(exported_q.annotations),
        evidence=dict(exported_q.evidence),
        submissions=dict(exported_q.submissions),
        search_events=list(exported_q.search_events),
    )

    # 2. Fresh DB 2: P is NOT installed, import Q only
    db2 = Database(tmp_path / "db2.db")
    repo2 = Repository(db2)
    repo2.import_package(pkg_q)

    # Verify P is not in packages table
    c2 = db2.get_connection().cursor()
    c2.execute("SELECT COUNT(*) FROM packages WHERE package_id = 'pkg-P';")
    assert c2.fetchone()[0] == 0

    # Verify submission imported and accessible with original hash/id
    loaded_q = repo2.export_package("pkg-Q")
    assert "sub-hist-1" in loaded_q.submissions
    sub_loaded = loaded_q.submissions["sub-hist-1"]
    assert sub_loaded.origin_key.package_id == "pkg-P"  # Historical origin preserved!
    assert sub_loaded.submission_id == "sub-hist-1"

    # Fortsetzen under local Q workspace
    key_q = WorkspaceKey(
        package_id="pkg-Q",
        document_id="doc-1",
        annotator_id="reviewer-2",
        mode="independent",
        target_set_id=target_set.target_set_id,
    )
    draft_q = repo2.open_draft(key_q, target_set)
    assert draft_q.revision == 0
    assert draft_q.key.package_id == "pkg-Q"


def test_legacy_v2_database_rejected_byte_identically(tmp_path: Path) -> None:
    import shutil

    from ontocurator.domain.errors import DomainError

    fixtures_dir = Path(__file__).parent / "fixtures" / "legacy_v1"
    db_source = fixtures_dir / "workspace-v2.sqlite"
    db_copy = tmp_path / "upgraded.sqlite"
    shutil.copy2(db_source, db_copy)

    before_bytes = db_copy.read_bytes()

    with pytest.raises(DomainError) as exc_info:
        Database(db_copy)

    assert exc_info.value.code == "UNSUPPORTED_WORKSPACE_VERSION"
    assert db_copy.read_bytes() == before_bytes


def test_legacy_v1_database_rejected_byte_identically(tmp_path: Path) -> None:
    import sqlite3

    from ontocurator.domain.errors import DomainError

    db_path = tmp_path / "legacy_v1.sqlite"
    conn = sqlite3.connect(str(db_path))
    conn.execute("CREATE TABLE schema_migrations (version INTEGER, applied_at TEXT);")
    conn.execute("INSERT INTO schema_migrations VALUES (1, '2026-10-01T00:00:00Z');")
    conn.commit()
    conn.close()

    before_bytes = db_path.read_bytes()

    with pytest.raises(DomainError) as exc_info:
        Database(db_path)

    assert exc_info.value.code == "UNSUPPORTED_WORKSPACE_VERSION"
    assert db_path.read_bytes() == before_bytes
