"""Real consolidation with colliding input IDs survives frozen T1 serialization."""

import json
import zipfile

import ontospan
import pytest
from sqlalchemy import insert
from test_editing import FIXTURE_PATH
from test_work_rounds import create_consolidation_fixture
from test_work_rounds import rounds as rounds

from ontocurator.application.editing import EditingService
from ontocurator.application.final_results import FinalResultService
from ontocurator.application.reviews import ReviewService
from ontocurator.application.submissions import SubmissionService
from ontocurator.application.work_rounds import MergeRoundInputsService
from ontocurator.application.workspaces import WorkspaceService
from ontocurator.auth.audit import Actor
from ontocurator.authz.policy import Access
from ontocurator.domain.workspace import MutationEnvelope
from ontocurator.exchange.jobs import HANDLERS
from ontocurator.jobs.queue import JobQueue
from ontocurator.ontology.registry import OntologyRegistry
from ontocurator.ontology.store import OntologyStore
from ontocurator.storage.tables import ProjectOntologyRow


@pytest.mark.parametrize("merged", [False, True])
def test_final_export_freezes_human_sources_notes_and_unresolved_collision(
    rounds, tmp_path, merged
):
    repo, ontology, reviewer, work_round, sources, lead, actor = (
        create_consolidation_fixture(rounds)
    )
    OntologyStore(repo.db, OntologyRegistry(), repo.db.data_dir).add(
        Actor.cli(), FIXTURE_PATH.name, FIXTURE_PATH.read_bytes()
    )
    with repo.db.transaction() as conn:
        conn.execute(
            insert(ProjectOntologyRow).values(
                project_id=repo._require_project(conn, "pkg-1"),
                ontology_id="hp",
                sha256=ontology.ref.sha256,
                allowed_roots=[],
                t1_profile="generic",
            )
        )
    view = WorkspaceService(reviewer, ontology).open(work_round.workspace_key)
    draft = view.draft
    if merged:
        draft = EditingService(reviewer, ontology).apply(
            work_round.workspace_key,
            MutationEnvelope(
                mutation_id="combined",
                expected_revision=draft.revision,
                payload={
                    "command": "create_annotation",
                    "annotation_id": "merged",
                    "term_id": "HP:0001252",
                    "axes_values": {"assertion": "present"},
                    "chosen_axis_ids": ["assertion"],
                    "note": "Combined finding",
                },
            ),
        )
        output = draft.annotations[0]
        inventory = repo.get_round_input_inventory("pkg-1", work_round.round_id)
        draft = MergeRoundInputsService(reviewer).merge(
            work_round.workspace_key,
            MutationEnvelope(
                mutation_id="merge",
                expected_revision=draft.revision,
                payload={
                    "input_ids": [item["input_id"] for item in inventory],
                    "replacement": {
                        "annotation_id": output.annotation.annotation_id,
                        "version": output.version,
                    },
                    "note": "Same clinical finding",
                },
            ),
        )
    else:
        for index, target in enumerate(view.targets.targets):
            draft = ReviewService(reviewer).decide(
                work_round.workspace_key,
                MutationEnvelope(
                    mutation_id=f"decision-{index}",
                    expected_revision=draft.revision,
                    payload={
                        "target": target.model_dump(),
                        "outcome": "uncertain" if index else "confirmed",
                        "note": "Reviewer uncertainty" if index else None,
                    },
                ),
            )
    result = SubmissionService(reviewer, ontology).submit(
        work_round.workspace_key,
        MutationEnvelope(
            mutation_id="submit",
            expected_revision=draft.revision,
            payload={"document_checked": True},
        ),
    )
    lead = Access(
        lead.user_id, lead.pseudonym, False, {"pkg-1": frozenset({"lead", "annotator"})}
    )
    final = FinalResultService(repo.db, actor, lead)
    final.select("pkg-1", "doc-1", result.submission_id, 0, [])
    state = final.preflight("pkg-1")
    queued = final.freeze(
        "pkg-1",
        {
            "request_id": "human-final",
            "state_digest": state["state_digest"],
            "acknowledged_warnings": [
                {"id": w["id"], "cause_revision": w["cause_revision"]}
                for w in state["warnings"]
            ],
            "accepted_omissions": state["omissions"],
        },
    )
    queue = JobQueue(repo.db, HANDLERS)
    job = queue.run(queue.claim(queued["job_id"], "test"), "test")
    assert job.status == "succeeded", job.error
    with zipfile.ZipFile(repo.db.blobs.path(job.result["sha256"])) as artifact:
        receipt = json.loads(artifact.read("receipt.json"))
        assert set(receipt["provenance_only_submission_ids"]) == {
            s.submission_id for s in sources
        }
        assert len(receipt["human_inputs"]) == 2
        for name in ("selected.t1.zip", "provenance.t1.zip"):
            (tmp_path / name).write_bytes(artifact.read(name))
    _, [unit] = ontospan.read_bundle(
        tmp_path / "selected.t1.zip",
        {"hp": ontospan.ObographOntology.load(FIXTURE_PATH)},
    )
    assert unit.annotation_set.set_kind == "stage_result"
    assert unit.annotation_set.stage == "consolidation"
    assert len({a.annotation_id for a in unit.annotation_set.annotations}) == (
        1 if merged else 2
    )
    assert all(
        "Personal source" in a.provenance.notes for a in unit.annotation_set.annotations
    )
    if merged:
        [annotation] = unit.annotation_set.annotations
        assert annotation.provenance.method == "merged"
        assert len(annotation.provenance.source_refs) == 2
        assert "Combined finding" in annotation.provenance.notes
    else:
        assert any(
            a.review_resolution and a.review_resolution.note == "Reviewer uncertainty"
            for a in unit.annotation_set.annotations
        )
    assert all(
        any(
            f"provenance-{receipt['snapshot_id']}" in ref
            for ref in a.provenance.source_refs
        )
        for a in unit.annotation_set.annotations
    )
    _, provenance = ontospan.read_bundle(
        tmp_path / "provenance.t1.zip",
        {"hp": ontospan.ObographOntology.load(FIXTURE_PATH)},
    )
    assert len(provenance) == 2

    individual_id = queue.enqueue("t1_export", {"project": "pkg-1"}, actor=actor)
    individual = queue.run(queue.claim(individual_id, "test"), "test")
    assert individual.status == "succeeded", individual.error
    _, research_units = ontospan.read_bundle(
        repo.db.blobs.path(individual.result["sha256"]),
        {"hp": ontospan.ObographOntology.load(FIXTURE_PATH)},
    )
    assert len(research_units) == 3
