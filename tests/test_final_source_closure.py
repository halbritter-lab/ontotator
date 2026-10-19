"""Reviewed source updates remain exact exported audit inputs."""

from test_t1_mapping import document_from_unit, hpo_profile, sketch_unit, submission

from ontocurator.exchange.final_content import freeze_content
from ontocurator.exchange.t1 import ImportedDocument
from ontocurator.storage.repository import ProjectExport


def test_reviewed_source_texts_and_exact_review_receipt_join_frozen_closure():
    doc = document_from_unit(sketch_unit())
    record = submission([])
    selected_doc = record.origin_key.document_id
    documents = {
        name: ImportedDocument(doc.model_copy(update={"document_id": name}))
        for name in (selected_doc, "old-source", "reviewed-source", "unrelated")
    }
    content = ProjectExport(
        profile=hpo_profile(),
        pins={},
        documents=documents,
        submissions=[record],
        proposals={},
        contributors=[],
    )
    resolution = {
        "cause_id": "exact-edge",
        "reviewer_id": "reader",
        "payload": {
            "cause": {
                "document_id": selected_doc,
                "old_source_document_id": "old-source",
                "new_source_document_id": "reviewed-source",
            },
            "review_id": 7,
            "decision": "accepted_unchanged",
            "created_variant_id": None,
        },
    }
    unrelated = {
        "cause_id": "other-edge",
        "payload": {
            "cause": {
                "document_id": "unrelated",
                "old_source_document_id": "old-source",
                "new_source_document_id": "unrelated",
            }
        },
    }
    frozen = freeze_content(content, source_reviews=[resolution, unrelated])
    assert set(frozen["documents"]) == {selected_doc, "old-source", "reviewed-source"}
    assert frozen["source_reviews"] == [resolution]
