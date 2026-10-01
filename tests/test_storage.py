import hashlib
from pathlib import Path

import pytest

from ontocurator.domain.annotations import (
    ActorRef,
    Annotation,
    Provenance,
    snapshot,
)
from ontocurator.domain.axes import Axes
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.documents import (
    Document,
    EvidenceMention,
    EvidenceRef,
    EvidenceSnapshot,
    OntologyRef,
    Segment,
)
from ontocurator.domain.errors import InvalidPackage, RevisionConflict
from ontocurator.domain.review import ReviewTargetSet
from ontocurator.domain.workspace import (
    Draft,
    MutationEnvelope,
    Submission,
    WorkspaceKey,
)
from ontocurator.packages.models import PackageManifest, ValidatedPackage
from ontocurator.storage.database import Database
from ontocurator.storage.repository import Repository


def _sample_package(pkg_id: str = "pkg-1") -> ValidatedPackage:
    text = "Patient exhibits hypotonia."
    doc = Document(
        document_id="doc-1",
        text=text,
        language="de",
        text_sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(),
    )
    ont = OntologyRef(release="2026-06-23", sha256="ont-123")
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
        hpo_id="HP:0001252",
        axes=Axes(assertion="present", experiencer="patient", temporality="current"),
        evidence_refs=[EvidenceRef(evidence_id="ev-1", version=ev.version)],
        provenance=Provenance(
            actor=ActorRef(actor_id="dr-meier", kind="human"),
            method="manual",
        ),
    )
    snap = snapshot(ann, [ev], doc, ont)

    manifest = PackageManifest(
        package_id=pkg_id,
        ontology=ont,
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

    # Same package_id with different ontology / manifest hash -> rejection
    pkg_colliding = _sample_package("pkg-idem")
    pkg_colliding.manifest.ontology.release = "2026-09-01"
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
        key, env, lambda d: d.model_copy(update={"document_checked": True})
    )

    db1.close()

    # Restart simulated with new DB connection
    db2 = Database(db_path)
    repo2 = Repository(db2)

    draft2 = repo2.open_draft(key)
    assert draft2.revision == 1
    assert draft2.document_checked is True
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


def test_upgrade_v2_preserves_payloads_and_receipts(tmp_path: Path) -> None:
    import json
    import shutil

    from ontocurator.domain.axes import EDITOR_AXES_CONFIG, AxesConfig

    fixtures_dir = Path(__file__).parent / "fixtures" / "legacy_v1"
    expected = json.loads((fixtures_dir / "expected.json").read_text(encoding="utf-8"))
    db_source = fixtures_dir / "workspace-v2.sqlite"
    db_copy = tmp_path / "upgraded.sqlite"
    shutil.copy2(db_source, db_copy)

    # Opening Database triggers _ensure_migrated() to v3
    db = Database(db_copy)
    repo = Repository(db)

    # Verify migration v3 applied
    conn = db.get_connection()
    c = conn.cursor()
    c.execute("SELECT MAX(version) FROM schema_migrations;")
    assert c.fetchone()[0] == 3

    # Table package_axes_profiles exists and populated for legacy package
    c.execute(
        "SELECT profile_json, profile_sha256 FROM package_axes_profiles "
        "WHERE package_id = ?;",
        (expected["package_id"],),
    )
    row = c.fetchone()
    assert row is not None

    profile = AxesConfig.model_validate_json(row[0])
    assert profile == EDITOR_AXES_CONFIG
    assert row[1] == EDITOR_AXES_CONFIG.config_sha256

    # get_axes_config returns profile
    assert repo.get_axes_config(expected["package_id"]) == EDITOR_AXES_CONFIG

    # Check original payloads in annotation_snapshots are preserved
    c.execute("SELECT annotation_id, version, payload_json FROM annotation_snapshots;")
    for _ann_id, _ver, p_json in c.fetchall():
        snap_data = json.loads(p_json)
        assert "schema_version" not in snap_data
        assert "hpo_id" in snap_data["annotation"]

    # Check receipts are preserved
    for mut_id, r_info in expected["receipts"].items():
        c.execute(
            "SELECT request_hash, response_json FROM mutation_receipts "
            "WHERE mutation_id = ?;",
            (mut_id,),
        )
        r_row = c.fetchone()
        assert r_row is not None
        assert r_row[0] == r_info["request_hash"]

    # Replay mutation envelope
    indep_key = WorkspaceKey(
        package_id=expected["package_id"],
        document_id="doc-1",
        annotator_id="dr-schmidt",
        mode="independent",
        target_set_id="",
    )
    env_retry = MutationEnvelope(
        mutation_id="mut-edit-1",
        expected_revision=0,
        payload={"action": "create_annotation", "term_id": "HP:0001252"},
    )
    replayed = repo.run_mutation(indep_key, env_retry, lambda d: d)
    assert replayed.revision == 1

    db.close()


def test_migration_failure_rolls_back(tmp_path: Path) -> None:
    import json
    import sqlite3

    db_path = tmp_path / "rollback_test.sqlite"
    conn = sqlite3.connect(str(db_path))
    init_sql = (
        Path(__file__).parent.parent
        / "src"
        / "ontocurator"
        / "storage"
        / "migrations"
        / "001_initial.sql"
    ).read_text(encoding="utf-8")
    conn.executescript(init_sql)
    conn.execute("INSERT INTO schema_migrations VALUES (1, '2026-10-01T00:00:00Z');")
    mem_sql = (
        Path(__file__).parent.parent
        / "src"
        / "ontocurator"
        / "storage"
        / "migrations"
        / "002_membership.sql"
    ).read_text(encoding="utf-8")
    conn.executescript(mem_sql)
    conn.execute("INSERT INTO schema_migrations VALUES (2, '2026-10-01T00:00:00Z');")

    bad_manifest = {
        "package_id": "pkg-unresolvable",
        "format_version": "hpo-editor-work-package/v1",
        "ontology": {"release": "2026-06-23", "sha256": "abc"},
        "axes_definition": "unknown-nonexistent-axes/v999",
        "file_hashes": {},
        "created_at": "2026-10-01T00:00:00Z",
    }
    conn.execute(
        "INSERT INTO packages (package_id, manifest_hash, manifest_json, created_at) "
        "VALUES (?, ?, ?, ?);",
        (
            "pkg-unresolvable",
            "dummy-hash",
            json.dumps(bad_manifest),
            "2026-10-01T00:00:00Z",
        ),
    )
    conn.commit()
    conn.close()

    # Now initializing Database should attempt migration to v3 and fail, rolling back
    from ontocurator.domain.errors import DomainError

    with pytest.raises(DomainError, match="UNRESOLVABLE_PROFILE"):
        Database(db_path)

    # Verify rollback: schema_migrations is still at 2
    verify_conn = sqlite3.connect(str(db_path))
    c = verify_conn.cursor()
    c.execute("SELECT MAX(version) FROM schema_migrations;")
    assert c.fetchone()[0] == 2
    c.execute(
        "SELECT name FROM sqlite_master "
        "WHERE type='table' AND name='package_axes_profiles';"
    )
    row = c.fetchone()
    if row:
        c.execute("SELECT COUNT(*) FROM package_axes_profiles;")
        assert c.fetchone()[0] == 0
    verify_conn.close()
