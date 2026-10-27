"""Exports reference the guideline version of each result, never its text (G1b)."""

from __future__ import annotations

import csv
import io
import json
import zipfile
from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy import select
from t1_builders import bundle, correction_unit
from t1_fixtures import OPERATOR, run_import
from test_case_api import BASE, SOURCE, TARGET
from test_case_api import case_env as case_env
from test_final_export_guide import payload as guide_payload
from test_guideline_stamps import Guidelines
from test_review_export import exported_env as exported_env
from test_review_export import queued, run
from test_review_export import submit as submit_review
from test_review_export_serialization import record, variants
from test_translation_review_service import review_env as review_env
from test_translation_review_service import save

from ontotator.application.final_results import FinalResultService
from ontotator.application.translation_workflow import TranslationWorkflowService
from ontotator.auth.audit import Actor
from ontotator.domain.errors import DomainError
from ontotator.domain.guidelines import guideline_ref
from ontotator.domain.review import ReviewTargetSet
from ontotator.domain.workspace import Submission, WorkspaceKey
from ontotator.exchange.final_export_guide import (
    INDEX_COLUMNS,
    build_index_csv,
    build_readme,
)
from ontotator.exchange.review_export import serialize_review_export
from ontotator.storage.final_tables import ExportSelectionSnapshotRow
from ontotator.storage.guidelines import guideline_facts
from ontotator.storage.repository import _key_str
from ontotator.storage.tables import ProjectRow

FIRST = "GUIDE-BODY-FIRST: mark every finding."
SECOND = "GUIDE-BODY-SECOND: mark only certain findings."


def _lead(env: Any) -> Guidelines:
    leader = env.app.state.accounts.get_by_username("leader")
    return Guidelines(env.db, "proj", Actor.user(leader.id, "leader"))


def _seed(
    env: Any,
    sid: str,
    version: int | None,
    document: str = SOURCE,
    username: str = "alice",
) -> None:
    """A submitted result as the submit path records it, stamped ``version``."""
    user = env.app.state.accounts.get_by_username(username)
    key = WorkspaceKey(
        project_key="proj",
        document_id=document,
        annotator_id=user.pseudonym,
        mode="independent",
        target_set_id="targets-0",
    )
    record = Submission(
        submission_id=sid,
        origin_key=key,
        targets=ReviewTargetSet.create([]),
        draft_revision=1,
        snapshots=[],
        decisions=[],
        created_at="2026-10-16T12:00:00Z",
    )
    repo = env.app.state.repo
    with env.db.transaction() as conn:
        repo._insert_submission(
            conn,
            repo._require_project(conn, "proj"),
            record,
            local_key=_key_str(key),
            imported=False,
            guideline_version=version,
        )


def _ref(env: Any, version: int) -> str:
    with env.db.transaction() as conn:
        pid = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == "proj")
        ).scalar_one()
        facts = guideline_facts(conn, pid)
    return guideline_ref("proj", version, facts[version].sha256)


def _units(data: bytes) -> dict[str, dict[str, Any]]:
    """Annotation sets of a T1 bundle by set id."""
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        sets = [
            json.loads(archive.read(name))["annotation_set"]
            for name in archive.namelist()
            if name.startswith("documents/")
        ]
    return {item["annotation_set_id"]: item for item in sets}


def _t1_export(env: Any) -> dict[str, dict[str, Any]]:
    queue = env.app.state.jobs
    job_id = queue.enqueue("t1_export", {"project": "proj"}, actor=OPERATOR)
    job = queue.run(queue.claim(job_id, "guide-test"), "guide-test")
    assert job.status == "succeeded", job.error
    sets = _units(env.db.blobs.path(job.result["sha256"]).read_bytes())
    return {set_id.rsplit(":", 1)[-1]: item for set_id, item in sets.items()}


# --- T1 bundles ------------------------------------------------------------- #


def test_t1_annotation_sets_carry_their_own_reference(case_env) -> None:
    guidelines = _lead(case_env)
    guidelines.publish(FIRST)
    _seed(case_env, "under-v1", 1, document=SOURCE)
    guidelines.publish(SECOND)
    _seed(case_env, "under-v2", 2, document=TARGET)

    content = case_env.app.state.repo.t1_export_content("proj")
    assert content.guideline_versions == {"under-v1": 1, "under-v2": 2}
    first, second = _ref(case_env, 1), _ref(case_env, 2)
    assert content.guideline_refs == {"under-v1": first, "under-v2": second}
    assert first != second
    assert first.startswith("urn:ontotator:proj:guidelines:v1#sha256=")
    assert second.startswith("urn:ontotator:proj:guidelines:v2#sha256=")

    sets = _t1_export(case_env)
    assert sets["under-v1"]["guideline_ref"] == first
    assert sets["under-v2"]["guideline_ref"] == second


def test_unstamped_submission_has_no_reference(case_env) -> None:
    _lead(case_env).publish(FIRST)
    _seed(case_env, "unstamped", None)
    content = case_env.app.state.repo.t1_export_content("proj")
    assert content.guideline_refs == {} and content.guideline_versions == {}
    assert _t1_export(case_env)["unstamped"]["guideline_ref"] is None


def test_withdrawn_version_keeps_its_reference(case_env) -> None:
    guidelines = _lead(case_env)
    guidelines.publish(FIRST)
    _seed(case_env, "under-v1", 1)
    before = _ref(case_env, 1)
    guidelines.publish(SECOND)
    guidelines.withdraw(1)
    content = case_env.app.state.repo.t1_export_content("proj")
    assert content.guideline_refs == {"under-v1": before}
    assert content.guideline_versions == {"under-v1": 1}
    assert _t1_export(case_env)["under-v1"]["guideline_ref"] == before


# --- frozen snapshot and final archive -------------------------------------- #


def _final_export(env: Any, selections: list[tuple[str, str]]) -> zipfile.ZipFile:
    for document, sid in selections:
        selected = env.lead.put(
            f"{BASE}/final-selections",
            json={
                "document_id": document,
                "submission_id": sid,
                "expected_revision": 0,
            },
        )
        assert selected.status_code == 200, selected.text
    state = env.lead.post(f"{BASE}/exports/final/preflight").json()
    queued_export = env.lead.post(
        f"{BASE}/exports/final",
        json={
            "request_id": "guidelines-1",
            "state_digest": state["state_digest"],
            "acknowledged_warnings": [
                {"id": w["id"], "cause_revision": w["cause_revision"]}
                for w in state["warnings"]
            ],
            "accepted_omissions": state["omissions"],
        },
    )
    assert queued_export.status_code == 200, queued_export.text
    job_id = queued_export.json()["job_id"]
    queue = env.app.state.jobs
    result = queue.run(queue.claim(job_id, "guide-test"), "guide-test")
    assert result.status == "succeeded", result.error
    downloaded = env.lead.get(f"/api/v1/jobs/{job_id}/download")
    assert downloaded.status_code == 200, downloaded.text
    return zipfile.ZipFile(io.BytesIO(downloaded.content))


def _all_bytes(archive: zipfile.ZipFile) -> list[tuple[str, bytes]]:
    """Every file of the archive, nested T1 bundles opened."""
    out = []
    for name in archive.namelist():
        data = archive.read(name)
        out.append((name, data))
        if name.endswith(".zip"):
            with zipfile.ZipFile(io.BytesIO(data)) as inner:
                out += [(f"{name}/{n}", inner.read(n)) for n in inner.namelist()]
    return out


def test_final_archive_carries_references_only(case_env) -> None:
    guidelines = _lead(case_env)
    guidelines.publish(FIRST)
    _seed(case_env, "under-v1", 1, document=SOURCE)
    guidelines.publish(SECOND)
    _seed(case_env, "under-v2", 2, document=TARGET)
    archive = _final_export(case_env, [(SOURCE, "under-v1"), (TARGET, "under-v2")])

    names = archive.namelist()
    assert not any("guideline" in name.lower() for name in names)
    for name, data in _all_bytes(archive):
        for body in (FIRST, SECOND, "GUIDE-BODY"):
            assert body.encode() not in data, name
    receipt = json.loads(archive.read("receipt.json"))
    assert "guidelines" not in receipt
    sets = _units(archive.read("selected.t1.zip"))
    assert sets["submission-under-v1"]["guideline_ref"] == _ref(case_env, 1)
    assert sets["submission-under-v2"]["guideline_ref"] == _ref(case_env, 2)
    table = list(
        csv.DictReader(
            io.StringIO(archive.read("index.csv").decode("utf-8-sig"), newline="")
        )
    )
    versions = {
        row["submission_id"]: row["guideline_version"]
        for row in table
        if row["row_type"] == "selected"
    }
    assert versions == {"under-v1": "1", "under-v2": "2"}
    assert all(
        row["guideline_version"] == "" for row in table if not row["submission_id"]
    )


def _project_id(env: Any) -> int:
    with env.db.transaction() as conn:
        return conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == "proj")
        ).scalar_one()


def test_frozen_snapshot_keeps_references(review_env) -> None:
    env = review_env
    guidelines = _lead(env)
    guidelines.publish(FIRST)
    update = correction_unit(env.source, "New clinical source reviewed explicitly")
    directory = env.tmp_path / "source-change"
    directory.mkdir()
    imported = run_import(env.db, bundle(directory, [update]))
    assert imported.status == "succeeded", imported.error
    service = TranslationWorkflowService(env.db, env.app.state.jobs)
    [cause] = service.obligations(env.accesses["alice"], env.ids["alice"])
    revision = save(env, "accepted_unchanged", "Übersetzt")
    resolved = service.resolve(
        env.accesses["alice"],
        env.ids["alice"],
        cause["cause_id"],
        expected_revision=revision,
        translation_text_sha256=cause["translation_text_sha256"],
        old_source_text_sha256=cause["old_source_text_sha256"],
        new_source_text_sha256=cause["new_source_text_sha256"],
    )
    assert resolved.guideline_version == 1
    _seed(env, "translation-annotations", 1, document="target")
    first = _ref(env, 1)
    access = env.accesses["leader"]
    final = FinalResultService(env.db, Actor.user(access.user_id, "leader"), access)
    final.select("proj", "target", "translation-annotations", 0, [])
    state = final.preflight("proj")
    queued_export = final.freeze(
        "proj",
        {
            "request_id": "frozen-guidelines",
            "state_digest": state["state_digest"],
            "acknowledged_warnings": [
                {"id": w["id"], "cause_revision": w["cause_revision"]}
                for w in state["warnings"]
            ],
            "accepted_omissions": state["omissions"],
        },
    )
    with env.db.transaction() as conn:
        frozen = conn.execute(
            select(ExportSelectionSnapshotRow.payload).where(
                ExportSelectionSnapshotRow.project_id == _project_id(env)
            )
        ).scalar_one()
    content = frozen["content"]
    assert content["guideline_refs"] == {"translation-annotations": first}
    assert content["guideline_versions"] == {"translation-annotations": 1}
    assert "guideline_ref" not in content
    [resolution] = content["source_reviews"]
    assert resolution["review_record"]["guideline_version"] == 1
    assert "guideline_withdrawn" not in resolution["review_record"]

    # A withdrawal after the freeze changes nothing in the archive (G20, G25).
    guidelines.publish(SECOND)
    guidelines.withdraw(1)
    queue = env.app.state.jobs
    job = queue.run(queue.claim(queued_export["job_id"], "test"), "test")
    assert job.status == "succeeded", job.error
    with zipfile.ZipFile(env.db.blobs.path(job.result["sha256"])) as archive:
        sets = _units(archive.read("selected.t1.zip"))
        receipt = json.loads(archive.read("receipt.json"))
    assert sets["submission-translation-annotations"]["guideline_ref"] == first
    [review] = receipt["source_reviews"]
    assert review["review_record"]["guideline_version"] == 1
    assert "guideline_withdrawn" not in review["review_record"]


# --- index.csv and README (pure) -------------------------------------------- #


def test_index_csv_last_column_guideline_version() -> None:
    assert INDEX_COLUMNS[-1] == "guideline_version"
    data = guide_payload()
    data["content"]["guideline_versions"] = {"final": 3}
    table = list(
        csv.DictReader(
            io.StringIO(
                build_index_csv(data, ["final"], ["earlier"]).decode("utf-8-sig"),
                newline="",
            )
        )
    )
    assert list(table[0])[-1] == "guideline_version"
    by_type = {row["row_type"]: row["guideline_version"] for row in table}
    # "earlier" has no recorded version; omissions have no submission.
    assert by_type == {"selected": "3", "provenance": "", "omitted": ""}


def test_readme_mentions_guidelines() -> None:
    text = build_readme(
        guide_payload(),
        snapshot_id="s",
        snapshot_sha256="0" * 64,
        snapshot_created_at=datetime(2026, 10, 21, tzinfo=UTC),
        provenance_ids=[],
    ).decode()
    how_to_read = text.split("How to read it\n")[1].split("\nOmitted\n")[0]
    flat = " ".join(how_to_read.split())
    assert "guideline_ref" in flat and "guideline_version" in flat
    assert "guideline texts are not part of this archive" in flat


# --- translation review export ---------------------------------------------- #


def test_translation_review_export_rows_carry_guideline_fields(exported_env) -> None:
    env = exported_env
    guidelines = _lead(env)
    guidelines.publish(FIRST)
    reviewed = submit_review(env)
    assert reviewed.guideline_version == 1
    first = _ref(env, 1)
    guidelines.publish(SECOND)
    guidelines.withdraw(1)
    result = run(env, queued(env))
    row = json.loads(env.db.blobs.get(result.result["sha256"]))
    assert row["format"] == "ontotator-translation-review/v1"
    assert list(row)[-3:] == [
        "guideline_version",
        "guideline_ref",
        "guideline_withdrawn",
    ]
    assert row["guideline_version"] == 1
    assert row["guideline_ref"] == first
    assert row["guideline_withdrawn"] is True
    assert FIRST not in json.dumps(row, ensure_ascii=False)


@pytest.mark.parametrize("published", [False, True])
def test_unstamped_translation_review_row_has_null_reference(
    exported_env, published
) -> None:
    env = exported_env
    guidelines = _lead(env)
    if published:
        guidelines.publish(FIRST)
        guidelines.withdraw(1)
    submit_review(env)
    row = json.loads(env.db.blobs.get(run(env, queued(env)).result["sha256"]))
    assert row["guideline_version"] is None
    assert row["guideline_ref"] is None
    assert row["guideline_withdrawn"] is False


def test_review_row_reference_needs_the_recorded_version_hash() -> None:
    stamped = record(guideline_version=2, guideline_withdrawn=True)
    row = json.loads(
        serialize_review_export("project", 7, [stamped], variants(), {2: "ab" * 32})
    )
    assert row["guideline_ref"] == guideline_ref("project", 2, "ab" * 32)
    assert row["guideline_withdrawn"] is True
    with pytest.raises(DomainError):
        serialize_review_export("project", 7, [stamped], variants(), {1: "ab" * 32})
