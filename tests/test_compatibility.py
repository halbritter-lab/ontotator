import hashlib
import json
import shutil
from pathlib import Path

from ontocurator.domain.workspace import WorkspaceKey
from ontocurator.packages.reader import read_package
from ontocurator.storage.database import Database
from ontocurator.storage.repository import Repository

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "legacy_v1"


def _load_expected() -> dict:
    return json.loads((FIXTURES_DIR / "expected.json").read_text(encoding="utf-8"))


def test_frozen_legacy_package() -> None:
    expected = _load_expected()
    zip_path = FIXTURES_DIR / "review.zip"
    assert zip_path.exists()

    # Check zip sha256 digest
    raw_zip = zip_path.read_bytes()
    assert hashlib.sha256(raw_zip).hexdigest() == expected["review_zip_sha256"]

    # Read package and verify format and axes definitions
    pkg = read_package(zip_path)
    assert pkg.manifest.package_id == expected["package_id"]
    assert pkg.manifest.format_version == expected["format_version"]
    assert pkg.manifest.axes_definition == expected["axes_definition"]

    # Verify manifest hash
    manifest_dict = pkg.manifest.model_dump()
    manifest_bytes = json.dumps(manifest_dict, sort_keys=True).encode("utf-8")
    assert hashlib.sha256(manifest_bytes).hexdigest() == expected["manifest_sha256"]

    # Verify snapshot versions
    snap_versions = expected["snapshot_versions"]
    assert ("ann-1", snap_versions["ann1_v1"]) in pkg.annotations
    assert ("ann-1", snap_versions["ann1_v2"]) in pkg.annotations
    assert ("ann-2", snap_versions["ann2"]) in pkg.annotations
    assert ("ev-1", snap_versions["ev1"]) in pkg.evidence
    assert ("ev-2", snap_versions["ev2"]) in pkg.evidence

    # Verify submission and decisions
    sub = pkg.submissions[expected["package_submission_id"]]
    assert sub.targets.target_set_id == expected["target_set_id"]
    assert len(sub.decisions) == len(expected["decisions"])
    for dec_exp, dec_act in zip(expected["decisions"], sub.decisions, strict=True):
        assert dec_act.decision_id == dec_exp["decision_id"]
        assert dec_act.outcome == dec_exp["outcome"]
        if dec_exp["replacement_version"]:
            assert dec_act.replacement is not None
            assert dec_act.replacement.version == dec_exp["replacement_version"]
        else:
            assert dec_act.replacement is None


def test_frozen_v2_workspace(tmp_path: Path) -> None:
    expected = _load_expected()
    db_source = FIXTURES_DIR / "workspace-v2.sqlite"
    assert db_source.exists()

    # Verify database digest
    db_sha256 = hashlib.sha256(db_source.read_bytes()).hexdigest()
    assert db_sha256 == expected["sqlite_sha256"]

    # Copy to tmp_path before opening to ensure no side effects
    db_copy = tmp_path / "workspace.sqlite"
    shutil.copy2(db_source, db_copy)

    db = Database(db_copy)
    repo = Repository(db)

    # Verify package was imported
    docs = repo.list_documents(expected["package_id"])
    assert len(docs) == 1
    assert docs[0].document_id == "doc-1"

    # Verify independent draft
    indep_key = WorkspaceKey(
        package_id=expected["package_id"],
        document_id="doc-1",
        annotator_id="dr-schmidt",
        mode="independent",
        target_set_id="",
    )
    draft_indep = repo.open_draft(indep_key)
    assert draft_indep is not None
    assert draft_indep.revision == expected["draft_revisions"]["independent"]
    assert len(draft_indep.annotations) == 1

    # Verify review draft
    rev_key = WorkspaceKey(
        package_id=expected["package_id"],
        document_id="doc-1",
        annotator_id="dr-meier",
        mode="review",
        target_set_id=expected["target_set_id"],
    )
    draft_rev = repo.open_draft(rev_key)
    assert draft_rev is not None
    assert draft_rev.revision == expected["draft_revisions"]["review"]

    # Verify submissions (both imported and locally created)
    subs = repo.get_submissions_for_workspace(rev_key)
    assert len(subs) == 2
    sub_ids = [s.submission_id for s in subs]
    assert expected["package_submission_id"] in sub_ids
    assert expected["workspace_submission_id"] in sub_ids

    # Verify receipts directly in DB
    conn = db.get_connection()
    cursor = conn.cursor()
    for mut_id, r_info in expected["receipts"].items():
        cursor.execute(
            "SELECT request_hash, response_json "
            "FROM mutation_receipts WHERE mutation_id = ?;",
            (mut_id,),
        )
        row = cursor.fetchone()
        assert row is not None
        assert row[0] == r_info["request_hash"]

    # Verify receipt idempotency replay
    from ontocurator.domain.workspace import MutationEnvelope

    env_retry = MutationEnvelope(
        mutation_id="mut-edit-1",
        expected_revision=0,
        payload={"action": "create_annotation", "term_id": "HP:0001252"},
    )
    replayed = repo.run_mutation(indep_key, env_retry, lambda d: d)
    assert replayed.revision == 1

    db.close()
