"""Apply integration preserves source identity without changing pure planner data."""

from types import SimpleNamespace

from t1_fixtures import hpo_profile, unit

from ontocurator.auth.audit import Actor
from ontocurator.domain.project_rules import ProjectRules
from ontocurator.exchange.plan import (
    IncomingSet,
    IncomingUnit,
    ProjectImportState,
    plan_import,
)
from ontocurator.exchange.t1 import document_from_unit, unit_to_proposals
from ontocurator.exchange.uploads import apply_plan
from ontocurator.storage.repository import Repository


def test_repeated_set_identity_keeps_the_first_planned_add(monkeypatch):
    raw = unit("doc")
    document = document_from_unit(raw)
    profile = hpo_profile()
    aset = raw.annotation_set
    item = IncomingUnit(
        "source.json",
        document,
        set=IncomingSet(
            aset.annotation_set_id,
            aset.set_kind,
            [a.model_dump(mode="json") for a in aset.actors],
            aset.model_dump(mode="json"),
            unit_to_proposals(raw, profile, document, bundle_id=None),
        ),
    )
    plan = plan_import([item, item], ProjectImportState(), profile, ProjectRules(), [])
    assert [s.action for s in plan.proposal_sets] == ["add", "already_imported"]
    calls = []

    def insert(self, key, documents, sets, **kwargs):
        calls.append((sets, kwargs))
        return {
            "documents_added": int(len(calls) == 1),
            "documents_skipped": int(len(calls) > 1),
            "documents_only": 0,
            "sets_added": len(sets),
            "sets_skipped": 0,
            "proposals": sum(len(s.proposals.annotations) for s in sets),
        }

    monkeypatch.setattr(Repository, "add_documents_and_proposals", insert)
    result = apply_plan(
        SimpleNamespace(),
        "proj",
        plan,
        [("a" * 64, [item]), ("b" * 64, [item])],
        Actor.cli(),
        job_id=1,
    )
    assert result["sets_added"] == 1
    assert result["sets_skipped"] == 1
    assert result["documents_added"] == result["documents_skipped"] == 1
    set_calls = [call for call in calls if call[0]]
    assert len(set_calls) == 1
    assert set_calls[0][0][0].payload == aset.model_dump(mode="json")
    assert set_calls[0][1]["source_sha256"] == "a" * 64
    assert not calls[-1][0]  # the repeated identity never steals source ownership
