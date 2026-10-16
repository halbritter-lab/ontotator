"""Apply integration preserves source identity without changing pure planner data."""

from types import SimpleNamespace

import pytest
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


def _incoming_document(*, label, set_id, source_sha, bundle_id="bundle"):
    raw = unit("doc")
    document = document_from_unit(raw)
    aset = raw.annotation_set.model_copy(update={"annotation_set_id": set_id})
    return IncomingUnit(
        label,
        document,
        source_text_sha256=source_sha,
        bundle_id=bundle_id,
        set=IncomingSet(
            set_id,
            aset.set_kind,
            [a.model_dump(mode="json") for a in aset.actors],
            aset.model_dump(mode="json"),
            unit_to_proposals(raw, hpo_profile(), document, bundle_id=bundle_id),
        ),
    )


@pytest.mark.parametrize("ordering", ["set", "bundle", "stable_tie"])
def test_physical_document_keeps_preview_canonical_provenance(monkeypatch, ordering):
    first = _incoming_document(
        label="same.json" if ordering == "stable_tie" else "z.json",
        set_id="same-set"
        if ordering == "stable_tie"
        else ("z-set" if ordering == "bundle" else "a-set"),
        source_sha="a" * 64,
        bundle_id="a-bundle",
    )
    second = _incoming_document(
        label="same.json" if ordering == "stable_tie" else "a.json",
        set_id="same-set"
        if ordering == "stable_tie"
        else ("a-set" if ordering == "bundle" else "z-set"),
        source_sha="b" * 64,
        bundle_id="z-bundle" if ordering == "bundle" else "a-bundle",
    )
    plan = plan_import(
        [first, second], ProjectImportState(), hpo_profile(), ProjectRules(), []
    )
    assert plan.committable
    assert plan.documents[0].source_text_sha256 == "a" * 64
    written = []

    def insert(self, key, documents, sets, **kwargs):
        written.extend(documents)
        return dict(
            documents_added=len(documents),
            documents_skipped=0,
            documents_only=0,
            sets_added=len(sets),
            sets_skipped=0,
            proposals=0,
        )

    monkeypatch.setattr(Repository, "add_documents_and_proposals", insert)
    apply_plan(
        SimpleNamespace(),
        "proj",
        plan,
        [("blob", [first, second])],
        Actor.cli(),
        job_id=1,
    )
    assert len(written) == 1
    assert written[0].source_text_sha256 == plan.documents[0].source_text_sha256
    assert written[0].document.language == plan.documents[0].language


@pytest.mark.parametrize("unchanged", [False, True])
def test_same_source_repeated_document_counts_match_preview(monkeypatch, unchanged):
    first = _incoming_document(label="one.json", set_id="one", source_sha="a" * 64)
    second = _incoming_document(label="two.json", set_id="two", source_sha="a" * 64)
    state = ProjectImportState(
        documents={"doc": first.document.text_sha256} if unchanged else {},
        sets=frozenset({("bundle", "one", "doc"), ("bundle", "two", "doc")})
        if unchanged
        else frozenset(),
    )
    plan = plan_import([first, second], state, hpo_profile(), ProjectRules(), [])
    assert plan.committable
    assert plan.counts["documents_added"] == (0 if unchanged else 1)
    assert plan.counts["documents_skipped"] == (2 if unchanged else 1)

    def insert(self, key, documents, sets, **kwargs):
        return dict(
            documents_added=0 if unchanged else len(documents),
            documents_skipped=len(documents) if unchanged else 0,
            documents_only=0,
            sets_added=len(sets),
            sets_skipped=0,
            proposals=0,
        )

    monkeypatch.setattr(Repository, "add_documents_and_proposals", insert)
    actual = apply_plan(
        SimpleNamespace(),
        "proj",
        plan,
        [("blob", [first, second])],
        Actor.cli(),
        job_id=1,
    )
    assert actual["documents_added"] == plan.counts["documents_added"]
    assert actual["documents_skipped"] == plan.counts["documents_skipped"]
    assert actual["sets_added"] == plan.counts["sets_added"]
    assert actual["sets_skipped"] == plan.counts["sets_skipped"]
