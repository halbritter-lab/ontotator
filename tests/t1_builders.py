"""Real format-1.1 units on the accepted HP fixture, shared by variant tests."""

from pathlib import Path

import ontospan
from t1_fixtures import bundle as write_fixture_bundle
from t1_fixtures import unit


def native_unit(external_id, language, text, *, case_id=None, annotations=()):
    document = ontospan.make_document(external_id, language, text).model_copy(
        update={"case_id": case_id}
    )
    base = unit(
        external_id,
        annotations=list(annotations),
        actors=[
            {
                "actor_id": "phentrieve",
                "kind": "tool",
                "name": "test-tool",
                "version": "1",
            }
        ],
    )
    aset = base.annotation_set.model_copy(
        update={
            "annotation_set_id": f"run-{external_id}-{language}-{document.text_sha256[:12]}"
        }
    )
    return base.model_copy(update={"document": document, "annotation_set": aset})


def translation_unit(
    external_id,
    language,
    text,
    *,
    source,
    checks=(("units_added", True),),
    provider="test-mt",
    model="m1",
    run_id="run-1",
    origin="machine_translation",
):
    result = native_unit(
        external_id,
        language,
        text,
        case_id=source.document.case_id or source.document.document_id,
    )
    return result.model_copy(
        update={
            "document": result.document.model_copy(
                update={
                    "variant": ontospan.Variant(
                        version=1,
                        origin=origin,
                        derived_from=source.document.text_sha256,
                    ),
                    "translation": ontospan.Translation(
                        provider=provider,
                        model=model,
                        run_id=run_id,
                        checks=tuple(
                            ontospan.TranslationCheck(code=code, passed=passed)
                            for code, passed in checks
                        ),
                    ),
                }
            )
        }
    )


def correction_unit(previous, text, *, version=None):
    document = previous.document
    result = native_unit(
        document.document_id, document.language, text, case_id=document.case_id
    )
    return result.model_copy(
        update={
            "document": result.document.model_copy(
                update={
                    "variant": ontospan.Variant(
                        version=version
                        or ((document.variant.version if document.variant else 1) + 1),
                        origin="correction",
                        derived_from=document.text_sha256,
                    ),
                }
            )
        }
    )


def bundle(tmp_path, units) -> Path:
    return write_fixture_bundle(tmp_path / "variants.zip", list(units))
