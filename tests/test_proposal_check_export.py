"""Per-proposal decisions of proposal checks in the final export (plan P6)."""

from datetime import UTC, datetime
from types import SimpleNamespace

from test_final_export_guide import _sub, payload

from ontotator.domain.annotations import AnnotationRef
from ontotator.domain.review import ReviewDecision, ReviewTargetSet
from ontotator.domain.workspace import Submission
from ontotator.exchange.final_export_guide import build_readme
from ontotator.exchange.proposal_checks import proposal_check_record
from ontotator.storage.proposal_queries import ProposalSetRef


def _ref(annotation_id: str) -> AnnotationRef:
    return AnnotationRef(annotation_id=annotation_id, version="v1")


def _decision(target: str, outcome: str, replacement: str | None = None):
    return ReviewDecision(
        decision_id=f"d-{target}",
        target=_ref(target),
        outcome=outcome,
        replacement=_ref(replacement) if replacement else None,
        reviewer_id="reader-0001",
    )


def _submission(targets: list[str], decisions, snapshot_ids: list[str]):
    # Only the fields the record reads; full snapshots need hashes and evidence.
    return Submission.model_construct(
        submission_id="sub-1",
        origin_key=SimpleNamespace(mode="proposal_check"),
        targets=ReviewTargetSet.create([_ref(t) for t in targets]),
        decisions=decisions,
        snapshots=[
            SimpleNamespace(annotation=SimpleNamespace(annotation_id=a))
            for a in snapshot_ids
        ],
    )


def test_record_lists_every_proposal_with_its_decision_and_ref():
    p1, p2, p3 = (f"urn:ontospan:set:p{n}" for n in (1, 2, 3))
    sub = _submission(
        [p1, p2, p3],
        [
            _decision(p3, "changed", "r3"),
            _decision(p1, "confirmed"),
            _decision(p2, "rejected"),
        ],
        [p1, "r3", "new1"],
    )
    record = proposal_check_record(sub, "t5", ProposalSetRef(7, "set-b"))
    assert record["proposal_set"] == {"id": 7, "annotation_set_id": "set-b"}
    decisions = record["decisions"]
    assert [d["decision"] for d in decisions] == ["confirmed", "rejected", "corrected"]
    assert [d["proposal_ref"] for d in decisions] == [p1, p2, p3]
    assert [d["corrected_annotation_id"] for d in decisions] == [None, None, "r3"]
    assert record["added_annotation_ids"] == ["new1"]
    assert record["counts"] == {
        "confirmed": 1,
        "rejected": 1,
        "corrected": 1,
        "uncertain": 0,
        "added": 1,
    }


def test_non_urn_ids_get_the_project_proposals_ref():
    sub = _submission(["p1"], [_decision("p1", "uncertain")], [])
    record = proposal_check_record(sub, "t5", None)
    assert record["proposal_set"] is None
    assert record["decisions"][0]["proposal_ref"] == "urn:ontospan:t5%3Aproposals:p1"
    assert record["decisions"][0]["decision"] == "uncertain"
    assert record["counts"]["uncertain"] == 1


def _readme(data) -> str:
    return build_readme(
        data,
        snapshot_id="s",
        snapshot_sha256="0" * 64,
        snapshot_created_at=datetime(2026, 10, 23, tzinfo=UTC),
        provenance_ids=[],
    ).decode()


def test_readme_explains_proposal_checks():
    data = payload()
    data["content"]["submissions"].append(_sub("pc", "de/v1", mode="proposal_check"))
    text = _readme(data)
    assert "proposal_checks" in text
    assert "proposal_check" in text.replace("proposal_checks", "")
    assert all(len(line) <= 76 for line in text.splitlines() if "proposal" in line)


def test_readme_without_proposal_checks_is_unchanged():
    assert "proposal_check" not in _readme(payload())


def _proposal_check(env, username: str, outcomes: list[str]) -> str:
    """Open the assigned proposal check, decide every target, submit; its ID."""
    from proposal_check_support import assign, client, open_task

    opened = open_task(env, username, assign(env, env.c1, username)["id"])
    workspace = opened["workspace_id"]
    revision = opened["view"]["draft"]["revision"]
    targets = opened["view"]["targets"]["targets"]
    assert len(targets) == len(outcomes)
    person = client(env, username)
    for n, (target, outcome) in enumerate(zip(targets, outcomes, strict=True)):
        decided = person.post(
            f"/api/v1/workspaces/{workspace}/decisions",
            json={
                "mutation_id": f"d{n}",
                "expected_revision": revision,
                "payload": {
                    "target": target,
                    "outcome": outcome,
                    # An uncertain decision needs a note (REVIEW_NOTE_REQUIRED).
                    "note": "unsure" if outcome == "uncertain" else None,
                },
            },
        )
        assert decided.status_code == 200, decided.text
        revision = decided.json()["revision"]
    payload: dict = {"document_checked": True}
    for attempt in ("submit", "submit-ack"):
        submitted = person.post(
            f"/api/v1/workspaces/{workspace}/submit",
            json={
                "mutation_id": attempt,
                "expected_revision": revision,
                "payload": payload,
            },
        )
        if submitted.json().get("code") != "AXIS_CONFIRMATION_WARNING":
            break
        # Confirmed proposals leave axes unchosen; acknowledge as the editor does.
        payload["warning_acknowledgement"] = submitted.json()["details"][
            "acknowledgement"
        ]
    assert submitted.status_code == 200, submitted.text
    return str(submitted.json()["submission_id"])


def _final_export(env, submission_id: str):
    import csv
    import io
    import json
    import zipfile

    from proposal_check_support import BASE
    from work_plan_support import select_final

    select_final(env, env.c1, submission_id)
    state = env.lead.post(f"{BASE}/exports/final/preflight").json()
    queued = env.lead.post(
        f"{BASE}/exports/final",
        json={
            "request_id": "p6-1",
            "state_digest": state["state_digest"],
            "acknowledged_warnings": [
                {"id": w["id"], "cause_revision": w["cause_revision"]}
                for w in state["warnings"]
            ],
            "accepted_omissions": state["omissions"],
        },
    )
    assert queued.status_code == 200, queued.text
    job_id = queued.json()["job_id"]
    jobs = env.app.state.jobs
    result = jobs.run(jobs.claim(job_id, "p6-test"), "p6-test")
    assert result.status == "succeeded", result.error
    downloaded = env.lead.get(f"/api/v1/jobs/{job_id}/download")
    assert downloaded.status_code == 200, downloaded.text
    archive = zipfile.ZipFile(io.BytesIO(downloaded.content))
    index = list(
        csv.DictReader(
            io.StringIO(archive.read("index.csv").decode("utf-8-sig"), newline="")
        )
    )
    return json.loads(archive.read("receipt.json")), index


def test_final_export_receipt_has_proposal_checks(tmp_path):
    from proposal_check_support import proposal_env

    env = proposal_env(tmp_path)
    selected = _proposal_check(env, "anno", ["confirmed", "rejected", "uncertain"])
    _proposal_check(env, "anno2", ["confirmed", "confirmed", "confirmed"])
    receipt, index = _final_export(env, selected)

    record = receipt["proposal_checks"][selected]
    assert [d["decision"] for d in record["decisions"]] == [
        "confirmed",
        "rejected",
        "uncertain",
    ]
    assert all(d["proposal_ref"].startswith("urn:") for d in record["decisions"])
    assert record["decisions"][2]["note"] == "unsure"
    assert record["proposal_set"]["annotation_set_id"] is not None
    assert record["counts"] == {
        "confirmed": 1,
        "rejected": 1,
        "corrected": 0,
        "uncertain": 1,
        "added": 0,
    }
    row = next(r for r in index if r["submission_id"] == selected)
    assert row["submission_kind"] == "proposal_check"


def test_receipt_names_the_newest_set_only(tmp_path):
    from proposal_check_support import proposal_env
    from t1_builders import native_unit
    from t1_fixtures import TEXT, annotation, bundle, run_import

    env = proposal_env(tmp_path)
    period = TEXT.index("Neonatalzeit")
    newer = native_unit(
        env.c1,
        "en",
        TEXT,
        case_id="c1",
        annotations=[annotation("q1", (period, period + len("Neonatalzeit")))],
    )
    newer = newer.model_copy(
        update={
            "annotation_set": newer.annotation_set.model_copy(
                update={"annotation_set_id": "set-newer"}
            )
        }
    )
    job = run_import(env.db, bundle(tmp_path / "newer.zip", [newer], "b-2"))
    assert job.status == "succeeded", job.error

    selected = _proposal_check(env, "anno", ["rejected"])
    receipt, _ = _final_export(env, selected)

    record = receipt["proposal_checks"][selected]
    assert record["proposal_set"]["annotation_set_id"] == "set-newer"
    assert [d["proposal_ref"] for d in record["decisions"]] == [
        "urn:ontospan:b-2:set-newer:q1"
    ]
