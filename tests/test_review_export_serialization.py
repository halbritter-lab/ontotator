"""Database-free JSONL contract tests over actual immutable review carriers."""

import hashlib
import json
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest

from ontocurator.application.translation_reviews import TranslationReviewRecord
from ontocurator.domain.errors import DomainError
from ontocurator.domain.variants import VariantInfo
from ontocurator.exchange.review_export import serialize_review_export


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def variants():
    source = VariantInfo(
        "internal-source",
        "case/1",
        "EN 1/7",
        "en",
        1,
        "native",
        None,
        None,
        None,
        None,
        digest("Source"),
    )
    run = dict(
        provider="test-mt",
        model="m1",
        run_id="run-1",
        checks=[dict(code="units_added", passed=False)],
    )
    target = VariantInfo(
        "internal-target",
        source.case_id,
        "DE 1/7",
        "de",
        1,
        "machine_translation",
        source.document_id,
        run,
        "ready_for_review",
        None,
        digest("Ziel"),
    )
    corrected = replace(
        target,
        document_id="target-v2",
        version=2,
        origin="correction",
        derived_from=target.document_id,
        translation=None,
        text_sha256=digest("Ziel zwei"),
    )
    third = replace(
        corrected,
        document_id="target-v3",
        version=3,
        derived_from=corrected.document_id,
        text_sha256=digest("Ziel drei"),
    )
    return {v.document_id: v for v in [source, target, corrected, third]}


def record(**changes):
    fields = dict(
        id=12,
        project_id=7,
        document_id="internal-target",
        assignment_id=22,
        reviewer_user_id=42,
        reviewer_pseudonym="ann-0003",
        reviewer_qualification="Recorded qualification",
        reviewer_languages=["de", "en"],
        decision="query",
        clinical_change=True,
        categories=["source"],
        rationale="Check source",
        machine_text_sha256=digest("Ziel"),
        proposed_text="Ziel",
        proposed_text_sha256=digest("Ziel"),
        status_before="ready_for_review",
        status_after="reviewed",
        created_variant_id=None,
        review_policy="ontocurator-translation-review/v1",
        created_at=datetime(
            2026, 10, 16, 12, 0, 5, 123456, tzinfo=timezone(timedelta(hours=2))
        ),
    )
    return TranslationReviewRecord(**(fields | changes))


def export(records, inventory=None):
    return serialize_review_export("project", 7, records, inventory or variants())


def test_exact_jsonl_contract_and_recorded_snapshot():
    data = export([record()])
    row = json.loads(data)
    assert list(row) == [
        "format",
        "review_id",
        "project",
        "case_id",
        "reviewed_variant",
        "source_variant",
        "reviewer",
        "decision",
        "clinical_change",
        "categories",
        "rationale",
        "machine_text_sha256",
        "proposed_text",
        "proposed_text_sha256",
        "created_variant",
        "status_before",
        "status_after",
        "review_policy",
        "reviewed_at",
    ]
    assert row["reviewed_variant"] == dict(
        document_id="DE 1/7",
        language="de",
        version=1,
        origin="machine_translation",
        text_sha256=digest("Ziel"),
        translation=dict(
            provider="test-mt",
            model="m1",
            run_id="run-1",
            recipe=None,
            checks=[dict(code="units_added", passed=False, detail=None)],
        ),
    )
    assert row["source_variant"] == dict(
        document_id="EN 1/7", language="en", version=1, text_sha256=digest("Source")
    )
    assert row["reviewer"] == dict(
        pseudonym="ann-0003",
        qualification="Recorded qualification",
        languages=["de", "en"],
    )
    assert row["reviewed_at"] == "2026-10-16T10:00:05Z"
    assert row["created_variant"] is None
    assert data.endswith(b"\n")
    assert set(row["reviewer"]) == {"pseudonym", "qualification", "languages"}


def test_correction_of_correction_keeps_exact_baseline_and_inherited_run():
    inventory = variants()
    row = json.loads(
        export(
            [
                record(
                    document_id="target-v2",
                    machine_text_sha256=digest("Ziel zwei"),
                    decision="accepted_corrected",
                    proposed_text="Ziel drei",
                    proposed_text_sha256=digest("Ziel drei"),
                    created_variant_id="target-v3",
                )
            ],
            inventory,
        )
    )
    assert row["reviewed_variant"]["version"] == 2
    assert row["reviewed_variant"]["origin"] == "correction"
    assert (
        row["reviewed_variant"]["text_sha256"]
        == row["machine_text_sha256"]
        == digest("Ziel zwei")
    )
    assert row["reviewed_variant"]["translation"]["run_id"] == "run-1"
    assert row["source_variant"]["document_id"] == "EN 1/7"
    assert row["created_variant"] == dict(
        document_id="DE 1/7", version=3, text_sha256=digest("Ziel drei")
    )
    assert (
        inventory["target-v2"].translation is inventory["target-v3"].translation is None
    )


def test_orders_review_ids_and_preserves_unicode_and_exact_proposed_text():
    text = "Ä😀\n  significant  "
    data = export(
        [
            record(id=5, proposed_text=text, proposed_text_sha256=digest(text)),
            record(id=2),
        ]
    )
    rows = [json.loads(line) for line in data.splitlines()]
    assert [r["review_id"] for r in rows] == [2, 5]
    assert rows[1]["proposed_text"] == text
    assert text.encode("utf-8")[:6] in data
    assert len(data.splitlines()) == 2
    assert export([]) == b""


@pytest.mark.parametrize(
    "change",
    [
        dict(project_id=8),
        dict(document_id="missing"),
        dict(machine_text_sha256="a" * 64),
        dict(proposed_text_sha256="f" * 64),
        dict(proposed_text_sha256="A" * 64),
        dict(created_at=datetime(2026, 1, 1)),
        dict(created_variant_id="missing", decision="accepted_corrected"),
        dict(created_variant_id="target-v3"),
        dict(created_variant_id="target-v3", decision="accepted_corrected"),
    ],
)
def test_corrupt_record_or_variant_association_fails_closed(change):
    with pytest.raises(DomainError):
        export([record(**change)])


def test_corrupt_lineage_and_missing_metadata_fail_closed():
    inventory = variants()
    inventory["target-v2"] = replace(inventory["target-v2"], derived_from="missing")
    with pytest.raises(DomainError):
        export(
            [record(document_id="target-v2", machine_text_sha256=digest("Ziel zwei"))],
            inventory,
        )
