"""Analysis distinguishes absence of work from evidence of an empty result."""

import hashlib
import json
from pathlib import Path

from test_packages import _create_sample_package
from typer.testing import CliRunner

from ontocurator.application.analysis import analyze_package
from ontocurator.cli import app
from ontocurator.domain.annotations import snapshot
from ontocurator.domain.documents import (
    Document,
    EvidenceMention,
    EvidenceRef,
    EvidenceSnapshot,
    Segment,
)
from ontocurator.domain.review import ReviewTargetSet
from ontocurator.domain.scopes import build_scope
from ontocurator.packages.writer import write_package


def study_package():
    package = _create_sample_package()
    sub = next(iter(package.submissions.values()))
    scope = build_scope(package.manifest.task_profile, sub.origin_key.mode)
    sub = sub.model_copy(
        update={
            "scope": scope,
            "checked_layer_ids": scope.editable_layer_ids,
            "origin_key": sub.origin_key.model_copy(
                update={"scope_id": scope.scope_id}
            ),
        }
    )
    package.submissions = {sub.submission_id: sub}
    return package, sub


def test_missing_work_is_not_a_checked_negative() -> None:
    package, _ = study_package()
    data = analyze_package(package, annotator_ids=["dr-meier", "missing"])
    rows = {row["annotator_id"]: row for row in data["rows"]}
    assert rows["dr-meier"]["status"] == "positive"
    assert rows["missing"]["status"] == "missing"
    assert rows["missing"]["submission_id"] is None
    assert rows["missing"]["annotations"] == []


def test_higher_revision_wins_over_wall_clock_and_is_checked_negative() -> None:
    package, first = study_package()
    # All proposals explicitly rejected, with the entire text and layer checked.
    newer = first.model_copy(
        update={
            "submission_id": "new",
            "draft_revision": first.draft_revision + 2,
            "created_at": "2000-01-01T00:00:00Z",
            "snapshots": [],
            "decisions": [
                d.model_copy(update={"outcome": "rejected"}) for d in first.decisions
            ],
        }
    )
    package.submissions[newer.submission_id] = newer
    row = analyze_package(package)["rows"][0]
    assert row["status"] == "checked_negative"
    assert row["submission_id"] == "new"
    assert row["annotations"] == []
    assert len(row["review_targets"]) == 2
    assert {decision["outcome"] for decision in row["decisions"]} == {"rejected"}


def test_uncertain_review_is_not_a_negative_or_automatic_gold() -> None:
    package, sub = study_package()
    changed = sub.model_copy(
        update={
            "snapshots": [],
            "decisions": [
                d.model_copy(update={"outcome": "uncertain"}) for d in sub.decisions
            ],
        }
    )
    package.submissions = {changed.submission_id: changed}
    row = analyze_package(package)["rows"][0]
    assert row["status"] == "uncertain"
    assert row["uncertain_target_count"] == 2
    assert row["annotations"] == []
    assert len(row["decisions"]) == 2
    assert {target["term_id"] for target in row["review_targets"]} == {
        "HP:0001252",
        "HP:0011146",
    }
    assert row["review_targets"][0]["provenance"]


def test_origin_branches_are_reported_without_choosing_by_clock() -> None:
    package, sub = study_package()
    branch = sub.model_copy(
        update={
            "submission_id": "branch",
            "draft_revision": 999,
            "origin_key": sub.origin_key.model_copy(
                update={"package_id": "other-origin"}
            ),
        }
    )
    package.submissions[branch.submission_id] = branch
    data = analyze_package(package)
    assert data["rows"][0]["status"] == "ambiguous"
    assert data["rows"][0]["submission_id"] is None
    assert set(data["rows"][0]["candidate_submission_ids"]) == {
        sub.submission_id,
        "branch",
    }
    assert data["ambiguities"][0]["reason"] == "multiple_origin_workspaces"


def test_adapter_preserves_codepoint_segments_and_quotes() -> None:
    package, sub = study_package()
    text = "👶 café\nseizure"
    document = Document(
        document_id="doc-1",
        text=text,
        language="en",
        text_sha256=hashlib.sha256(text.encode()).hexdigest(),
    )
    mention = EvidenceMention(
        evidence_id="unicode",
        segments=[Segment(start=0, end=1), Segment(start=2, end=6)],
    )
    ev = EvidenceSnapshot.create(mention, document)
    original = sub.snapshots[0]
    ann = original.annotation.model_copy(
        update={
            "evidence_refs": [EvidenceRef(evidence_id="unicode", version=ev.version)]
        }
    )
    updated = snapshot(ann, [ev], document, package.manifest.task_profile)
    independent = sub.model_copy(
        update={
            "decisions": [],
            "snapshots": [updated],
            "origin_key": sub.origin_key.model_copy(
                update={"mode": "independent", "target_set_id": "targets-0"}
            ),
            "scope": build_scope(package.manifest.task_profile, "independent"),
        }
    )
    package.documents = {"doc-1": document}
    package.submissions = {independent.submission_id: independent}
    evidence = analyze_package(package)["rows"][0]["annotations"][0]["evidence"][0]
    assert evidence["segments"] == [{"start": 0, "end": 1}, {"start": 2, "end": 6}]
    assert evidence["segment_texts"] == ["👶", "café"]
    assert evidence["text_sha256"] == document.text_sha256


def test_analysis_cli_outputs_validated_dataset_and_missing_annotator(
    tmp_path: Path,
) -> None:
    package, _ = study_package()
    source = tmp_path / "study.zip"
    write_package(package, source)
    result = CliRunner().invoke(
        app,
        ["analyze", str(source), "--annotator", "dr-meier", "--annotator", "missing"],
    )
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)
    assert data["format_version"] == "ontocurator-analysis/v1"
    assert {row["status"] for row in data["rows"]} == {"positive", "missing"}


def test_analysis_cli_rejects_corrupt_input_without_writing_result(
    tmp_path: Path,
) -> None:
    source = tmp_path / "broken.zip"
    source.write_bytes(b"not an archive")
    output = tmp_path / "result.json"
    result = CliRunner().invoke(app, ["analyze", str(source), "--output", str(output)])
    assert result.exit_code != 0
    assert not output.exists()


def test_analysis_cli_cannot_overwrite_its_input_package(tmp_path: Path) -> None:
    package, _ = study_package()
    source = tmp_path / "study.zip"
    write_package(package, source)
    original = source.read_bytes()
    result = CliRunner().invoke(app, ["analyze", str(source), "--output", str(source)])
    assert result.exit_code != 0
    assert source.read_bytes() == original


def test_unsubmitted_document_has_missing_rows_for_both_expected_annotators() -> None:
    package, _ = study_package()
    package.documents["unstarted"] = package.documents["doc-1"].model_copy(
        update={"document_id": "unstarted"}
    )
    package.manifest.document_order.append("unstarted")
    data = analyze_package(package, annotator_ids=["dr-meier", "rater-2"])
    rows = [row for row in data["rows"] if row["document_id"] == "unstarted"]
    assert len(rows) == 2
    assert {row["status"] for row in rows} == {"missing"}


def test_unchecked_layer_is_explicitly_unverified() -> None:
    package, sub = study_package()
    package.submissions[sub.submission_id] = sub.model_copy(
        update={"checked_layer_ids": []}
    )
    assert analyze_package(package)["rows"][0]["status"] == "unverified"


def test_multiple_review_rounds_are_kept_separate_and_flagged() -> None:
    package, sub = study_package()
    targets = ReviewTargetSet.create([sub.targets.targets[0]])
    other = sub.model_copy(
        update={
            "submission_id": "other-round",
            "targets": targets,
            "snapshots": [sub.snapshots[0]],
            "decisions": [sub.decisions[0]],
            "origin_key": sub.origin_key.model_copy(
                update={"target_set_id": targets.target_set_id}
            ),
        }
    )
    package.submissions[other.submission_id] = other
    data = analyze_package(package)
    assert len(data["rows"]) == 2
    assert {r["round_id"] for r in data["rows"]} == {
        sub.targets.target_set_id,
        targets.target_set_id,
    }
    assert data["ambiguities"][0]["reason"] == "multiple_scopes_or_review_rounds"


def test_working_modes_are_never_pooled_and_filter_is_explicit() -> None:
    package, review = study_package()
    scope = build_scope(package.manifest.task_profile, "independent")
    independent = review.model_copy(
        update={
            "submission_id": "independent",
            "scope": scope,
            "targets": ReviewTargetSet.create([]),
            "decisions": [],
            "origin_key": review.origin_key.model_copy(
                update={
                    "mode": "independent",
                    "scope_id": scope.scope_id,
                    "target_set_id": "targets-0",
                }
            ),
        }
    )
    package.submissions[independent.submission_id] = independent
    assert {r["mode"] for r in analyze_package(package)["rows"]} == {
        "independent",
        "review",
    }
    filtered = analyze_package(package, mode="independent")
    assert len(filtered["rows"]) == 1
    assert filtered["rows"][0]["submission_id"] == "independent"
