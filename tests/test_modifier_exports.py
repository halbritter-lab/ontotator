"""Serialisers of annotation content keep an open key set (modifiers spec,
"Data model": ``modifiers`` appears once non-empty, never otherwise).

Checked serialisers (grep of ``annotation_content(`` / ``model_dump(`` in
application, api and exchange): stored drafts and submissions (snapshot
``model_dump``), the final-export content (``exchange/final_content.py``,
frozen and thawed by ``exchange/final_export.py``), the consolidation content
hash (``application/consolidation.py``). The edit-log export
(``Repository.edit_log``) and the proposal-check receipt
(``exchange/proposal_checks.py``) carry ids, versions and counts only. The
translation review export (``exchange/review_export.py``) carries no
annotation content at all.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

import pytest
from modifier_fixtures import modifier_profile

from ontocurator.application.consolidation import consolidated_content_sha256
from ontocurator.domain.annotations import (
    ActorRef,
    Annotation,
    AnnotationSnapshot,
    Modifier,
    Provenance,
    snapshot,
)
from ontocurator.domain.documents import (
    Document,
    EvidenceMention,
    EvidenceRef,
    Segment,
    snapshot_evidence,
)
from ontocurator.domain.review import ReviewTargetSet
from ontocurator.domain.serialization import decode_snapshot
from ontocurator.domain.workspace import (
    Draft,
    MutationEnvelope,
    Submission,
    WorkspaceKey,
)
from ontocurator.exchange.final_content import freeze_content, thaw_content
from ontocurator.exchange.proposal_checks import proposal_check_record
from ontocurator.exchange.t1 import ImportedDocument
from ontocurator.storage.repository import ProjectExport

TEXT = "Seit 2 Wochen wiederholt schwere Krampfanfälle und eine Muskelhypotonie."
DOCUMENT = Document(
    document_id="doc-1",
    text=TEXT,
    language="de",
    text_sha256=hashlib.sha256(TEXT.encode()).hexdigest(),
)
KEY = WorkspaceKey(
    project_key="mods",
    document_id="doc-1",
    annotator_id="ann-0001",
    mode="independent",
    target_set_id="targets-0",
)


def at(word: str, text: str = TEXT) -> Segment:
    start = text.index(word)
    return Segment(start=start, end=start + len(word))


def severe(text: str = TEXT) -> list[Modifier]:
    word = "schwere" if "schwere" in text else "severe"
    return [Modifier(term_id="HP:0012828", segments=[at(word, text)])]


def finding(modifiers: list[Modifier]) -> AnnotationSnapshot:
    evidence = snapshot_evidence(
        EvidenceMention(evidence_id="ev-1", segments=[at("Krampfanfälle")]),
        DOCUMENT,
    )
    return snapshot(
        Annotation(
            annotation_id="seizure",
            document_id=DOCUMENT.document_id,
            layer_id="hpo",
            term_id="HP:0001250",
            evidence_refs=[EvidenceRef(evidence_id="ev-1", version=evidence.version)],
            modifiers=modifiers,
            provenance=Provenance(
                actor=ActorRef(actor_id="ann-0001", kind="human"), method="manual"
            ),
        ),
        [evidence],
        DOCUMENT,
        modifier_profile(),
    )


def submission(snap: AnnotationSnapshot) -> Submission:
    return Submission(
        submission_id="sub-1",
        origin_key=KEY,
        targets=ReviewTargetSet.create([]),
        draft_revision=1,
        snapshots=[snap],
        decisions=[],
        created_at="2026-10-25T00:00:00Z",
    )


EXPECTED = [{"term_id": "HP:0012828", "segments": [{"start": 25, "end": 32}]}]


@pytest.mark.parametrize("modifiers", [[], "severe"])
def test_snapshot_dump_and_decode(modifiers: Any) -> None:
    snap = finding(severe() if modifiers else [])
    dumped = snap.model_dump(mode="json")
    if modifiers:
        assert dumped["annotation"]["modifiers"] == EXPECTED
    else:
        assert "modifiers" not in dumped["annotation"]
    assert decode_snapshot(dumped).version == snap.version


@pytest.mark.parametrize("modifiers", [[], "severe"])
def test_final_content_freezes_and_thaws_modifiers(modifiers: Any) -> None:
    snap = finding(severe() if modifiers else [])
    frozen = freeze_content(
        ProjectExport(
            profile=modifier_profile(),
            pins={},
            documents={"doc-1": ImportedDocument(DOCUMENT, DOCUMENT.text_sha256, None)},
            submissions=[submission(snap)],
            proposals={},
            contributors=[],
        )
    )
    annotation = frozen["submissions"][0]["snapshots"][0]["annotation"]
    if modifiers:
        assert annotation["modifiers"] == EXPECTED
    else:
        assert "modifiers" not in annotation
    thawed = thaw_content(frozen)
    assert thawed.submissions[0].snapshots[0] == snap


def test_consolidation_content_hash_covers_modifiers() -> None:
    plain = finding([]).annotation
    with_mods = finding(severe()).annotation
    assert consolidated_content_sha256(plain) != consolidated_content_sha256(with_mods)


def test_proposal_check_record_names_ids_and_counts_only() -> None:
    record = proposal_check_record(submission(finding(severe())), "mods", None)
    assert record == {
        "proposal_set": None,
        "decisions": [],
        "added_annotation_ids": ["seizure"],
        "counts": {
            "confirmed": 0,
            "rejected": 0,
            "corrected": 0,
            "uncertain": 0,
            "added": 1,
        },
    }


def test_stored_draft_and_edit_log(tmp_path: Path) -> None:
    """PostgreSQL: the draft keeps the modifiers; the edit log names ids and
    versions only."""
    from test_editing import _setup_test_env

    repo, _, workspaces, _, document = _setup_test_env(tmp_path)
    key = workspaces.open(
        WorkspaceKey(
            project_key="pkg-1",
            document_id="doc-1",
            annotator_id="ann-0001",
            mode="independent",
            target_set_id="targets-0",
        )
    ).key
    profile = repo.get_task_profile("pkg-1")
    evidence = snapshot_evidence(
        EvidenceMention(evidence_id="ev-1", segments=[at("seizure", document.text)]),
        document,
    )
    made = snapshot(
        Annotation(
            annotation_id="seizure",
            document_id="doc-1",
            layer_id="hpo-layer",
            term_id="HP:0001250",
            evidence_refs=[EvidenceRef(evidence_id="ev-1", version=evidence.version)],
            modifiers=severe(document.text),
            provenance=Provenance(
                actor=ActorRef(actor_id="ann-0001", kind="human"), method="manual"
            ),
        ),
        [evidence],
        document,
        profile,
    )

    def operation(draft: Draft) -> Draft:
        draft.evidence.append(evidence)
        draft.annotations.append(made)
        return draft

    repo.run_mutation(
        key,
        MutationEnvelope(
            mutation_id="m-1", expected_revision=0, payload={"command": "test"}
        ),
        operation,
    )
    stored = repo.open_draft(key).annotations[0]
    assert stored == made
    assert stored.model_dump(mode="json")["annotation"]["modifiers"] == [
        {"term_id": "HP:0012828", "segments": [{"start": 19, "end": 25}]}
    ]
    (event,) = repo.edit_log("pkg-1")
    assert event["state"]["annotations"] == [["seizure", made.version]]
    assert "modifiers" not in str(event)
