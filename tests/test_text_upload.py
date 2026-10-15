import hashlib
import io
import zipfile

import pytest
from t1_fixtures import hpo_profile

from ontocurator.domain.project_rules import ProjectRules
from ontocurator.exchange.plan import ProjectImportState, plan_import
from ontocurator.exchange.text import read_text_upload


def archive(entries):
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as z:
        for name, payload in entries:
            z.writestr(name, payload)
    return data.getvalue()


def test_txt_and_zip_files_become_documents_named_by_stem():
    units, issues = read_text_upload(
        [
            ("a.txt", b"one"),
            (
                "b.zip",
                archive(
                    [
                        ("folder/b.txt", b"two"),
                        ("__MACOSX/x", b"ignored"),
                        ("folder/", b""),
                    ]
                ),
            ),
        ],
        "de",
    )
    assert not issues
    assert [u.document.document_id for u in units] == ["a", "b"]


def test_a_bom_is_stripped_and_crlf_normalised_and_counted():
    raw = b"\xef\xbb\xbfhello\r\nworld"
    units, issues = read_text_upload([("a.txt", raw)], "de")
    assert units[0].document.text == "hello\nworld"
    assert units[0].source_text_sha256 == hashlib.sha256(raw).hexdigest()
    plan = plan_import(
        units, ProjectImportState(), hpo_profile(), ProjectRules(), issues
    )
    assert plan.normalised_count == 1


@pytest.mark.parametrize(
    ("files", "code", "label"),
    [
        ([("latin.txt", b"\xe4")], "TEXT_NOT_UTF8", "latin.txt"),
        ([("a.zip", archive([("b.json", b"{}")]))], "UNSUPPORTED_FILE", "b.json"),
        (
            [("a.txt", b"one"), ("folder/a.txt", b"two")],
            "DUPLICATE_DOCUMENT_ID",
            "folder/a.txt",
        ),
        ([("bad name.txt", b"x")], "DOCUMENT_ID_INVALID", "bad name.txt"),
        ([("empty.txt", b"")], "TEXT_EMPTY", "empty.txt"),
        ([("a.zip", archive([("../a.txt", b"x")]))], "unsafe_path", "../a.txt"),
        ([("a.zip", b"broken")], "invalid_archive", "a.zip"),
    ],
)
def test_invalid_text_uploads_report_the_affected_file(files, code, label):
    _, issues = read_text_upload(files, "de")
    assert any(i.code == code and label in i.unit for i in issues)


def test_language_must_be_in_project_allowlist():
    units, issues = read_text_upload([("a.txt", b"hello")], "de", languages=["en"])
    assert not units
    assert issues[0].code == "LANGUAGE_NOT_IN_PROJECT"


def test_zip_expansion_is_bounded_before_reading_entries(monkeypatch):
    monkeypatch.setattr("ontocurator.exchange.text.MAX_TOTAL_BYTES", 4)
    units, issues = read_text_upload([("a.zip", archive([("a.txt", b"12345")]))], "de")
    assert not units
    assert issues[0].code == "too_large"


def test_expansion_limit_applies_across_files(monkeypatch):
    monkeypatch.setattr("ontocurator.exchange.text.MAX_TOTAL_BYTES", 4)
    _, issues = read_text_upload(
        [("a.txt", b"123"), ("b.zip", archive([("b.txt", b"45")]))], "de"
    )
    assert issues[0].code == "too_large"


def test_text_is_nfc_normalised():
    units, issues = read_text_upload([("a.txt", "a\u0308".encode())], "de")
    assert not issues
    assert units[0].document.text == "ä"
    assert units[0].normalised
