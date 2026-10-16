"""The review browser carrier exports the built documents, not raw input."""

from browser_server import translation_review_fixture_texts
from t1_builders import native_unit, translation_unit


def test_review_fixture_texts_match_all_three_built_unicode_documents():
    source = native_unit("source /é", "en", "Source A😀e\u0301\n\nSecond paragraph.")
    target = translation_unit(
        "source /é", "de", "Ziel A😀e\u0301\n\nZweiter Absatz.", source=source
    )
    failed = translation_unit(
        "other /é",
        "de",
        "Alternative A😀e\u0301\n\nDritter Absatz.",
        source=source,
        checks=(("units_added", False),),
    )
    texts = translation_review_fixture_texts(source, target, failed)
    assert texts == {
        "source": source.document.text,
        "target": target.document.text,
        "failed": failed.document.text,
    }
    for value in texts.values():
        assert "A😀é" in value
        assert "e\u0301" not in value
        assert "\n\n" in value
