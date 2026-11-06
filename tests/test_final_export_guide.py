"""README.txt and index.csv are pure functions of the frozen snapshot."""

import csv
import io
from datetime import UTC, datetime

from ontotator.exchange.final_export_guide import (
    INDEX_COLUMNS,
    PLANNED_OUT_COLUMNS,
    build_index_csv,
    build_readme,
    guide_files,
)


def _doc(doc_id, language, variant=None):
    return {
        "document": {
            "document_id": doc_id,
            "text": "x",
            "language": language,
            "text_sha256": "h",
        },
        "source_text_sha256": "s",
        "variant": variant,
    }


def _variant(doc_id, case_id, language, version, origin):
    return {
        "document_id": doc_id,
        "case_id": case_id,
        "external_id": case_id,
        "language": language,
        "version": version,
        "origin": origin,
        "derived_from": None,
        "translation": None,
        "translation_status": None,
        "status_reason": None,
        "text_sha256": "h",
    }


def _sub(sid, doc_id, author="reader-0001", mode="independent", findings=1):
    return {
        "submission_id": sid,
        "origin_key": {"document_id": doc_id, "annotator_id": author, "mode": mode},
        "snapshots": [{}] * findings,
    }


def payload(**extra):
    return {
        "project": "t5",
        "project_name": "T5 acceptance",
        "state": {
            "selections": [
                {
                    "case_id": "case-µ",
                    "language": "de",
                    "document_id": "de/v1",
                    "submission_id": "final",
                    "revision": 1,
                },
            ],
            "warnings": [
                {
                    "id": "w2",
                    "code": "SELECTED_ROUND_SUPERSEDED",
                    "case_id": "case-µ",
                    "language": "de",
                    "reason": "The selected result belongs to an earlier work round. Review the selection.",
                },
                {
                    "id": "w1",
                    "code": "OPEN_PROBLEM_REPORT",
                    "case_id": "case-µ",
                    "language": "de",
                    "reason": "An open problem report needs a lead decision.",
                },
                {
                    "id": "w3",
                    "code": "MISSING_FINAL_SELECTION",
                    "case_id": "case, two",
                    "language": "en",
                    "reason": "No final result selected.",
                },
            ],
            "omissions": [{"case_id": "case, two", "language": "en"}],
        },
        "content": {
            "documents": {
                "en/v1": _doc(
                    "en/v1", "en", _variant("en/v1", "case-µ", "en", 1, "native")
                ),
                "de/v1": _doc(
                    "de/v1",
                    "de",
                    _variant("de/v1", "case-µ", "de", 1, "machine_translation"),
                ),
            },
            "submissions": [
                _sub("earlier", "de/v1", author="reader-0002"),
                _sub("final", "de/v1", findings=3),
            ],
            "guideline_versions": {},
        },
        "round_kinds": {"final": "consolidation", "earlier": "ordinary"},
        "selected_submission_ids": ["final"],
        "submission_recorded_at": {
            "final": "2026-10-19T08:40:00.000000Z",
            "earlier": "2026-10-18T22:57:00.000000Z",
        },
        **extra,
    }


def rows(data: bytes):
    assert data.startswith(b"\xef\xbb\xbf")
    text = data.decode("utf-8-sig")
    assert "\r\n" in text and "\n" not in text.replace("\r\n", "")
    return list(csv.DictReader(io.StringIO(text, newline="")))


def test_index_has_one_row_per_selection_omission_and_provenance_in_order():
    data = build_index_csv(payload(), ["final"], ["earlier"])
    table = rows(data)
    assert tuple(table[0].keys()) == INDEX_COLUMNS
    assert [(r["case_id"], r["language"], r["row_type"]) for r in table] == [
        ("case, two", "en", "omitted"),
        ("case-µ", "de", "selected"),
        ("case-µ", "de", "provenance"),
    ]
    omitted, selected, provenance = table
    assert (
        omitted["document_id"]
        == omitted["submission_id"]
        == omitted["bundle_entry"]
        == ""
    )
    assert omitted["warning_codes"] == "MISSING_FINAL_SELECTION"
    assert selected == {
        "row_type": "selected",
        "case_id": "case-µ",
        "language": "de",
        "document_id": "de/v1",
        "text_version": "1",
        "text_origin": "machine_translation",
        "submission_id": "final",
        "submission_kind": "consolidation",
        "author": "reader-0001",
        "submitted_at": "2026-10-19T08:40:00.000000Z",
        "findings": "3",
        "archive_file": "selected-results.ontospan.zip",
        "bundle_entry": "documents/00000.json",
        "annotation_set_id": "submission-final",
        "source_text_line": "2",
        "warning_codes": "OPEN_PROBLEM_REPORT;SELECTED_ROUND_SUPERSEDED",
        "guideline_version": "",
    }
    assert provenance["archive_file"] == "provenance-results.ontospan.zip"
    assert provenance["bundle_entry"] == "documents/00000.json"
    assert provenance["submission_kind"] == "annotation"
    assert provenance["author"] == "reader-0002"


def test_submission_kind_falls_back_to_mode():
    data = payload()
    data["content"]["submissions"][0]["origin_key"]["mode"] = "review"
    data["round_kinds"] = {"earlier": "carry_forward"}
    table = rows(build_index_csv(data, ["final"], ["earlier"]))
    assert {
        r["submission_id"]: r["submission_kind"] for r in table if r["submission_id"]
    } == {
        "final": "annotation",
        "earlier": "carry_forward",
    }
    data["round_kinds"] = {}
    table = rows(build_index_csv(data, ["final"], ["earlier"]))
    assert {
        r["submission_id"]: r["submission_kind"] for r in table if r["submission_id"]
    }["earlier"] == "consolidation"  # D1: every review submission is one


def test_old_snapshots_without_recorded_time_leave_submitted_at_empty():
    data = payload()
    del data["submission_recorded_at"]
    assert {
        r["submitted_at"] for r in rows(build_index_csv(data, ["final"], ["earlier"]))
    } == {""}


AT = datetime(2026, 10, 19, 8, 42, 17, tzinfo=UTC)


def test_readme_lists_everything_in_plain_text():
    text = build_readme(
        payload(),
        snapshot_id="snap-1",
        snapshot_sha256="ab" * 32,
        snapshot_created_at=AT,
        provenance_ids=["earlier"],
    ).decode("utf-8")
    assert "\r" not in text and not text.startswith("\ufeff")
    assert text.startswith("Ontotator final export\n======================\n")
    for line in [
        "Project:          T5 acceptance (t5)",
        "Snapshot ID:      snap-1",
        f"Snapshot SHA-256: {'ab' * 32}",
        "Snapshot time:    2026-10-19 08:42:17 UTC",
        "Selected final results:            1",
        "Omitted text and language pairs:   1",
        "Warnings acknowledged at export:   3",
        "Provenance-only submissions:       1",
        "provenance-results.ontospan.zip",
        "case, two (en): no final result was selected. No other submission was",
        "case-µ (de)",
        "[OPEN_PROBLEM_REPORT]",
        "Verify\n------",
    ]:
        assert line in text, line
    assert "submitted_at" in text


def test_readme_says_none_and_hides_provenance_when_empty():
    data = payload()
    data["state"]["warnings"] = []
    data["state"]["omissions"] = []
    text = build_readme(
        data,
        snapshot_id="s",
        snapshot_sha256="0" * 64,
        snapshot_created_at=AT,
        provenance_ids=[],
    ).decode()
    assert (
        "Warnings acknowledged at export\n-------------------------------\nNone.\n"
        in text
    )
    assert "Omitted\n-------\nNone.\n" in text
    assert "provenance-results.ontospan.zip" not in text


def test_guide_files_are_deterministic_and_follow_content_order():
    first = guide_files(
        payload(), snapshot_id="s", snapshot_sha256="0" * 64, snapshot_created_at=AT
    )
    second = guide_files(
        payload(), snapshot_id="s", snapshot_sha256="0" * 64, snapshot_created_at=AT
    )
    assert first == second
    assert set(first) == {"README.txt", "index.csv"}
    selected = [r for r in rows(first["index.csv"]) if r["row_type"] == "selected"]
    assert selected[0]["bundle_entry"] == "documents/00000.json"


def test_project_name_falls_back_to_key():
    data = payload()
    del data["project_name"]
    text = build_readme(
        data,
        snapshot_id="s",
        snapshot_sha256="0" * 64,
        snapshot_created_at=AT,
        provenance_ids=[],
    ).decode()
    assert "Project:          t5\n" in text


PLANNED_OUT = [
    {
        "case_id": "case, two",
        "language": "de",
        "revision": 3,
        "planned_out_at": "2026-10-18T09:15:02.123456Z",
        "reason": "Out of scope: adult cases only.",
        "final_result_kept": True,
    },
    {
        "case_id": "case-µ",
        "language": "fr",
        "revision": 2,
        "planned_out_at": "2026-10-17T07:00:00.000000Z",
        "reason": None,
        "final_result_kept": False,
    },
]


def test_planned_out_texts_have_index_rows_and_their_own_table():
    files = guide_files(
        payload(planned_out=PLANNED_OUT),
        snapshot_id="s",
        snapshot_sha256="0" * 64,
        snapshot_created_at=AT,
    )
    assert set(files) == {"README.txt", "index.csv", "planned-out.csv"}
    table = rows(files["index.csv"])
    assert [(r["case_id"], r["language"], r["row_type"]) for r in table] == [
        ("case, two", "de", "planned_out"),
        ("case, two", "en", "omitted"),
        ("case-µ", "de", "selected"),
        ("case-µ", "de", "provenance"),
        ("case-µ", "fr", "planned_out"),
    ]
    assert {name for name, value in table[0].items() if value} == {
        "row_type",
        "case_id",
        "language",
    }
    planned = rows(files["planned-out.csv"])
    assert tuple(planned[0].keys()) == PLANNED_OUT_COLUMNS
    assert planned == [
        {
            "case_id": "case, two",
            "language": "de",
            "plan_revision": "3",
            "planned_out_at": "2026-10-18T09:15:02.123456Z",
            "reason": "Out of scope: adult cases only.",
            "final_result_kept": "yes",
        },
        {
            "case_id": "case-µ",
            "language": "fr",
            "plan_revision": "2",
            "planned_out_at": "2026-10-17T07:00:00.000000Z",
            "reason": "",
            "final_result_kept": "",
        },
    ]
    text = files["README.txt"].decode()
    assert "Taken out of the work plan:        2\n" in text
    assert "\nplanned-out.csv     The texts taken out of the work plan" in text
    assert "Taken out of the work plan\n--------------------------\n" in text
    flat = " ".join(text.split())
    for sentence in [
        "case, two (de): taken out in plan revision 3 on 2026-10-18 09:15:02 UTC. "
        "Reason: Out of scope: adult cases only. Its final result stays in "
        "Ontotator and is not exported.",
        "case-µ (fr): taken out in plan revision 2 on 2026-10-17 07:00:00 UTC. "
        "No reason was given.",
        '"planned_out" rows are texts a lead took out of the work plan',
    ]:
        assert sentence in flat, sentence
    again = guide_files(
        payload(planned_out=PLANNED_OUT),
        snapshot_id="s",
        snapshot_sha256="0" * 64,
        snapshot_created_at=AT,
    )
    assert again == files


def test_no_planned_out_texts_say_none_and_add_no_file():
    files = guide_files(
        payload(planned_out=[]),
        snapshot_id="s",
        snapshot_sha256="0" * 64,
        snapshot_created_at=AT,
    )
    assert set(files) == {"README.txt", "index.csv"}
    text = files["README.txt"].decode()
    assert "Taken out of the work plan:        0" in text
    assert "Taken out of the work plan\n--------------------------\nNone.\n" in text
    assert "planned-out.csv" not in text


def test_snapshots_before_planned_out_keep_their_files():
    """A snapshot frozen before #338 has no "planned_out": nothing changes."""
    old = guide_files(
        payload(), snapshot_id="s", snapshot_sha256="0" * 64, snapshot_created_at=AT
    )
    assert "work plan" not in old["README.txt"].decode()
    assert "planned_out" not in old["index.csv"].decode("utf-8-sig")
